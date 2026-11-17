-- =====================================================================
-- TCONTROL · Módulo de EPP (equipos de protección personal)
--
-- Flujo: el colaborador pide directo al despachador → PENDIENTE → PREPARADA → ENTREGADA → CONFIRMADA.
-- También RECHAZADA (bodega) y CANCELADA (el colaborador, mientras esté pendiente).
--
-- Firma: ENTREGADA significa entregada sin firma y es válida. La firma se toma en la pantalla del
-- despachador o desde la app. Una firma en bodega cubre también las entregas pendientes de esa
-- persona. Nunca se niega un EPP por falta de firma; el plazo de 7 días solo marca seguimiento.
--
-- Acceso: token de PIN (claims eval, empleado_id), el mismo de Desempeño y Visitas.
--   * Colaborador: solo lo suyo, y solo los EPP de la matriz de su(s) área(s) (epp_asignaciones).
--   * Despachador: cargo con BODEGA en historico.empleados, o el admin master.
--
-- Catálogo, áreas y puestos: 017_epp_matriz.sql (generado de la matriz oficial SSOMA 2026). Personas: db/etl/cargar_epp_personas.py.
-- El stock inicia en 0: lo carga bodega. Re-ejecutable.
-- Requiere 003_evaluaciones.sql (eval_claims, eval_es_master).
-- =====================================================================

CREATE TABLE IF NOT EXISTS historico.epp_catalogo (
    id          text PRIMARY KEY,
    nombre      text NOT NULL,
    categoria   text NOT NULL,
    icono       text NOT NULL DEFAULT 'fa-box',
    tallas      text[] NOT NULL,
    stock_min   integer NOT NULL DEFAULT 2 CHECK (stock_min >= 0),
    max_cant    integer NOT NULL DEFAULT 5 CHECK (max_cant BETWEEN 1 AND 50),
    orden       integer NOT NULL DEFAULT 100,
    activo      boolean NOT NULL DEFAULT true
);

-- Matriz oficial de EPP (SSOMA 2026): área → puesto → EPP con su cadencia de reposición.
-- Las personas se asignan a un área (una persona puede estar en varias) con db/etl/cargar_epp_personas.py.
CREATE TABLE IF NOT EXISTS historico.epp_areas (
    id      text PRIMARY KEY,
    nombre  text NOT NULL,
    orden   integer NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS historico.epp_puestos (
    id         text PRIMARY KEY,
    area_id    text NOT NULL REFERENCES historico.epp_areas(id) ON DELETE CASCADE,
    nombre     text NOT NULL,
    actividad  text NOT NULL DEFAULT '',
    orden      integer NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS historico.epp_puesto_items (
    puesto_id  text NOT NULL REFERENCES historico.epp_puestos(id) ON DELETE CASCADE,
    epp_id     text NOT NULL REFERENCES historico.epp_catalogo(id),
    tipo       text NOT NULL CHECK (tipo IN ('Obligatorio', 'Condicional')),
    dias       integer NOT NULL CHECK (dias > 0),
    texto      text NOT NULL DEFAULT '',
    riesgo     text NOT NULL DEFAULT '',
    obs        text NOT NULL DEFAULT '',
    orden      integer NOT NULL DEFAULT 100,
    PRIMARY KEY (puesto_id, epp_id)
);
CREATE TABLE IF NOT EXISTS historico.epp_asignaciones (
    empleado_id  text NOT NULL,
    area_id      text NOT NULL REFERENCES historico.epp_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (empleado_id, area_id)
);

CREATE TABLE IF NOT EXISTS historico.epp_stock (
    epp_id  text NOT NULL REFERENCES historico.epp_catalogo(id),
    talla   text NOT NULL,
    cant    integer NOT NULL DEFAULT 0 CHECK (cant >= 0),
    minimo  integer NOT NULL DEFAULT 2 CHECK (minimo >= 0),
    PRIMARY KEY (epp_id, talla)
);

CREATE TABLE IF NOT EXISTS historico.epp_solicitudes (
    id              bigserial PRIMARY KEY,
    empleado_id     text NOT NULL,
    nombre          text NOT NULL,
    area            text,
    cargo           text,
    estado          text NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE', 'PREPARADA', 'ENTREGADA', 'CONFIRMADA', 'RECHAZADA', 'CANCELADA')),
    comentario      text NOT NULL DEFAULT '',
    creada          timestamptz NOT NULL DEFAULT now(),
    preparada_en    timestamptz,
    preparada_por   text,
    entregada_en    timestamptz,
    entregada_por   text,
    confirmada_en   timestamptz,
    firma           text,
    firma_origen    text CHECK (firma_origen IN ('BODEGA', 'APP')),
    recordatorios   timestamptz[] NOT NULL DEFAULT '{}',
    rechazada_en    timestamptz,
    rechazada_por   text,
    motivo_rechazo  text,
    cancelada_en    timestamptz
);
CREATE INDEX IF NOT EXISTS epp_solicitudes_empleado ON historico.epp_solicitudes (empleado_id, creada DESC);
CREATE INDEX IF NOT EXISTS epp_solicitudes_estado ON historico.epp_solicitudes (estado, creada);

CREATE TABLE IF NOT EXISTS historico.epp_items (
    solicitud_id  bigint NOT NULL REFERENCES historico.epp_solicitudes(id) ON DELETE CASCADE,
    linea         integer NOT NULL,
    epp_id        text NOT NULL REFERENCES historico.epp_catalogo(id),
    talla         text NOT NULL,
    cant          integer NOT NULL CHECK (cant BETWEEN 1 AND 50),
    motivo        text NOT NULL,
    PRIMARY KEY (solicitud_id, linea)
);

CREATE TABLE IF NOT EXISTS historico.epp_movimientos (
    id      bigserial PRIMARY KEY,
    en      timestamptz NOT NULL DEFAULT now(),
    epp_id  text NOT NULL,
    talla   text NOT NULL,
    delta   integer NOT NULL,
    quien   text NOT NULL,
    nota    text NOT NULL DEFAULT ''
);

-- El catálogo, las áreas, los puestos y el stock inicial los carga 017_epp_matriz.sql (generado desde la matriz oficial).

CREATE OR REPLACE FUNCTION historico.epp_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(upper(coalesce(t, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') $$;

-- Lo que le corresponde a una persona: sus áreas con los puestos y el EPP de cada uno
CREATE OR REPLACE FUNCTION historico.epp_mi(v_emp text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'puestos', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'actividad', p.actividad, 'epp', (
            SELECT coalesce(jsonb_agg(jsonb_build_object('eppId', i.epp_id, 'tipo', i.tipo, 'dias', i.dias, 'texto', i.texto,
                                                         'riesgo', i.riesgo, 'obs', i.obs) ORDER BY i.orden), '[]')
              FROM historico.epp_puesto_items i WHERE i.puesto_id = p.id)) ORDER BY p.orden), '[]')
          FROM historico.epp_puestos p WHERE p.area_id = a.id)) ORDER BY a.orden), '[]')
      FROM historico.epp_asignaciones x JOIN historico.epp_areas a ON a.id = x.area_id WHERE x.empleado_id = v_emp
$$;

CREATE OR REPLACE FUNCTION historico.epp_codigo(v_id bigint) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'EPP-' || lpad(v_id::text, 4, '0') $$;

-- La firma no viaja en las listas: se pide aparte (accion ver_firma)
CREATE OR REPLACE FUNCTION historico.epp_json(s historico.epp_solicitudes) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'id', historico.epp_codigo(s.id), 'empleadoId', s.empleado_id, 'nombre', s.nombre, 'area', s.area, 'cargo', s.cargo,
        'estado', s.estado, 'comentario', s.comentario, 'creada', s.creada,
        'preparadaEn', s.preparada_en, 'preparadaPor', s.preparada_por,
        'entregadaEn', s.entregada_en, 'entregadaPor', s.entregada_por, 'confirmadaEn', s.confirmada_en,
        'firmaOrigen', s.firma_origen, 'tieneFirma', s.firma IS NOT NULL, 'recordatorios', to_jsonb(s.recordatorios),
        'motivoRechazo', s.motivo_rechazo,
        'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('eppId', i.epp_id, 'talla', i.talla, 'cant', i.cant, 'motivo', i.motivo) ORDER BY i.linea), '[]')
                    FROM historico.epp_items i WHERE i.solicitud_id = s.id)))
$$;

CREATE OR REPLACE FUNCTION historico.epp_firma_valida(f text) RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(length(f) <= 40000 AND f ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$', false) $$;

CREATE OR REPLACE FUNCTION api.epp(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c         jsonb := historico.eval_claims();
    v_yo      text := btrim(coalesce(c->>'empleado_id', ''));
    v_acc     text := coalesce(p->>'accion', 'inicio');
    v_emp     historico.empleados;
    v_mi      jsonb;
    v_bodega  boolean;
    v_quien   text;
    v_id      bigint := nullif(left(regexp_replace(coalesce(p->>'id', ''), '\D', '', 'g'), 12), '')::bigint;
    v_s       historico.epp_solicitudes;
    v_firma   text := p->>'firma';
    v_item    jsonb;
    v_cat     historico.epp_catalogo;
    v_ids     bigint[];
    v_cant    integer;
    v_linea   integer := 0;
    v_r       record;
    v_n       integer;
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión no válida. Vuelve a ingresar tu PIN.');
    END IF;
    SELECT * INTO v_emp FROM historico.empleados e WHERE e.id = v_yo AND coalesce(e.activo, true);
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No encontramos tu ficha de colaborador.');
    END IF;
    v_quien := v_emp.nombre;
    v_bodega := historico.epp_norm(v_emp.cargo) LIKE '%BODEGA%' OR historico.eval_es_master(c);
    v_mi := historico.epp_mi(v_yo);

    -- ---------------------------------------------------- colaborador
    IF v_acc = 'inicio' THEN
        RETURN jsonb_build_object('ok', true,
            'yo', jsonb_build_object('id', v_emp.id, 'nombre', v_emp.nombre, 'area', v_emp.area, 'cargo', v_emp.cargo),
            'bodega', v_bodega, 'mi', v_mi,
            'catalogo', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'categoria', x.categoria, 'icono', x.icono,
                            'tallas', to_jsonb(x.tallas), 'maxCant', x.max_cant) ORDER BY x.orden), '[]')
                           FROM historico.epp_catalogo x WHERE x.activo),
            'solicitudes', (SELECT coalesce(jsonb_agg(historico.epp_json(s) ORDER BY s.creada DESC), '[]')
                              FROM historico.epp_solicitudes s WHERE s.empleado_id = v_yo));
    END IF;

    IF v_acc = 'solicitar' THEN
        IF jsonb_typeof(p->'items') <> 'array' OR jsonb_array_length(p->'items') NOT BETWEEN 1 AND 15 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Agrega entre 1 y 15 artículos.');
        END IF;
        FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
            SELECT * INTO v_cat FROM historico.epp_catalogo x WHERE x.id = v_item->>'eppId' AND x.activo;
            IF NOT FOUND OR NOT EXISTS (
                    SELECT 1 FROM historico.epp_asignaciones x JOIN historico.epp_puestos q ON q.area_id = x.area_id
                      JOIN historico.epp_puesto_items i ON i.puesto_id = q.id
                     WHERE x.empleado_id = v_yo AND i.epp_id = v_cat.id) THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Hay un EPP que no corresponde a tu puesto.');
            END IF;
            IF NOT (v_item->>'talla' = ANY (v_cat.tallas)) THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Talla no válida para ' || v_cat.nombre || '.');
            END IF;
            IF coalesce(v_item->>'cant', '') !~ '^[0-9]{1,2}$' OR (v_item->>'cant')::int NOT BETWEEN 1 AND v_cat.max_cant THEN
                RETURN jsonb_build_object('ok', false, 'error', format('La cantidad de %s debe ser de 1 a %s.', v_cat.nombre, v_cat.max_cant));
            END IF;
            IF coalesce(v_item->>'motivo', '') NOT IN ('Primera entrega', 'Reposición por desgaste', 'Reposición por daño', 'Pérdida') THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Motivo no válido.');
            END IF;
        END LOOP;
        INSERT INTO historico.epp_solicitudes (empleado_id, nombre, area, cargo, comentario)
        VALUES (v_yo, v_emp.nombre, v_emp.area, v_emp.cargo, left(coalesce(p->>'comentario', ''), 300)) RETURNING * INTO v_s;
        FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
            v_linea := v_linea + 1;
            INSERT INTO historico.epp_items (solicitud_id, linea, epp_id, talla, cant, motivo)
            VALUES (v_s.id, v_linea, v_item->>'eppId', v_item->>'talla', (v_item->>'cant')::int, v_item->>'motivo');
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'id', historico.epp_codigo(v_s.id));
    END IF;

    IF v_acc IN ('cancelar', 'firmar', 'ver_firma', 'preparar', 'rechazar', 'entregar', 'recordar') THEN
        SELECT * INTO v_s FROM historico.epp_solicitudes s WHERE s.id = v_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya no existe.'); END IF;
    END IF;

    IF v_acc = 'ver_firma' THEN
        IF v_s.empleado_id <> v_yo AND NOT v_bodega THEN
            RETURN jsonb_build_object('ok', false, 'error', 'No tienes acceso a esta firma.');
        END IF;
        RETURN jsonb_build_object('ok', true, 'firma', v_s.firma);
    END IF;

    IF v_acc = 'cancelar' THEN
        IF v_s.empleado_id <> v_yo THEN RETURN jsonb_build_object('ok', false, 'error', 'Esta solicitud no es tuya.'); END IF;
        IF v_s.estado <> 'PENDIENTE' THEN RETURN jsonb_build_object('ok', false, 'error', 'Ya no se puede cancelar: bodega la está atendiendo.'); END IF;
        UPDATE historico.epp_solicitudes SET estado = 'CANCELADA', cancelada_en = now() WHERE id = v_s.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'firmar' THEN
        IF v_s.empleado_id <> v_yo THEN RETURN jsonb_build_object('ok', false, 'error', 'Esta entrega no es tuya.'); END IF;
        IF v_s.estado <> 'ENTREGADA' THEN RETURN jsonb_build_object('ok', false, 'error', 'Esta entrega ya no está pendiente de firma.'); END IF;
        IF NOT historico.epp_firma_valida(v_firma) THEN RETURN jsonb_build_object('ok', false, 'error', 'Falta la firma.'); END IF;
        UPDATE historico.epp_solicitudes SET estado = 'CONFIRMADA', confirmada_en = now(), firma = v_firma, firma_origen = 'APP' WHERE id = v_s.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ---------------------------------------------------- despachador
    IF v_acc NOT IN ('despacho', 'preparar', 'rechazar', 'entregar', 'firmar_bodega', 'recordar', 'ingreso') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
    END IF;
    IF NOT v_bodega THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Solo para el personal de bodega.');
    END IF;

    IF v_acc = 'despacho' THEN
        RETURN jsonb_build_object('ok', true,
            'stock', (SELECT coalesce(jsonb_agg(jsonb_build_object('eppId', k.epp_id, 'talla', k.talla, 'cant', k.cant, 'min', k.minimo)), '[]') FROM historico.epp_stock k),
            'solicitudes', (SELECT coalesce(jsonb_agg(historico.epp_json(s) ORDER BY s.creada DESC), '[]') FROM (
                SELECT * FROM historico.epp_solicitudes WHERE estado IN ('PENDIENTE', 'PREPARADA', 'ENTREGADA')
                UNION ALL
                (SELECT * FROM historico.epp_solicitudes WHERE estado = 'CONFIRMADA' ORDER BY entregada_en DESC LIMIT 300)) s));
    END IF;

    IF v_acc = 'preparar' THEN
        IF v_s.estado <> 'PENDIENTE' THEN RETURN jsonb_build_object('ok', false, 'error', 'La solicitud cambió de estado. Actualiza la pantalla.'); END IF;
        UPDATE historico.epp_solicitudes SET estado = 'PREPARADA', preparada_en = now(), preparada_por = v_quien WHERE id = v_s.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'rechazar' THEN
        IF v_s.estado NOT IN ('PENDIENTE', 'PREPARADA') THEN RETURN jsonb_build_object('ok', false, 'error', 'La solicitud cambió de estado. Actualiza la pantalla.'); END IF;
        IF btrim(coalesce(p->>'motivo', '')) = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Indica el motivo.'); END IF;
        UPDATE historico.epp_solicitudes SET estado = 'RECHAZADA', rechazada_en = now(), rechazada_por = v_quien,
               motivo_rechazo = left(btrim(p->>'motivo'), 300) WHERE id = v_s.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'recordar' THEN
        IF v_s.estado <> 'ENTREGADA' THEN RETURN jsonb_build_object('ok', false, 'error', 'Esta entrega ya no está pendiente de firma.'); END IF;
        IF EXISTS (SELECT 1 FROM unnest(v_s.recordatorios) r WHERE (r AT TIME ZONE 'America/Guayaquil')::date = historico.eval_hoy()) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Ya se recordó hoy.');
        END IF;
        UPDATE historico.epp_solicitudes SET recordatorios = recordatorios || now() WHERE id = v_s.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'ingreso' THEN
        v_n := CASE WHEN coalesce(p->>'cant', '') ~ '^[0-9]{1,4}$' THEN (p->>'cant')::int ELSE 0 END;
        IF v_n <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Indica una cantidad mayor a 0.'); END IF;
        UPDATE historico.epp_stock SET cant = cant + v_n WHERE epp_id = p->>'eppId' AND talla = p->>'talla';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Artículo no encontrado.'); END IF;
        INSERT INTO historico.epp_movimientos (epp_id, talla, delta, quien, nota) VALUES (p->>'eppId', p->>'talla', v_n, v_quien, 'Ingreso');
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'firmar_bodega' THEN
        IF NOT historico.epp_firma_valida(v_firma) THEN RETURN jsonb_build_object('ok', false, 'error', 'Falta la firma.'); END IF;
        SELECT array_agg(nullif(left(regexp_replace(x, '\D', '', 'g'), 12), '')::bigint) INTO v_ids FROM jsonb_array_elements_text(coalesce(p->'ids', '[]')) x;
        IF coalesce(cardinality(v_ids), 0) = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'No hay entregas para firmar.'); END IF;
        PERFORM 1 FROM historico.epp_solicitudes s WHERE s.id = ANY (v_ids) FOR UPDATE;
        IF (SELECT count(DISTINCT s.empleado_id) FROM historico.epp_solicitudes s WHERE s.id = ANY (v_ids)) <> 1
           OR EXISTS (SELECT 1 FROM unnest(v_ids) i LEFT JOIN historico.epp_solicitudes s ON s.id = i WHERE s.id IS NULL OR s.estado <> 'ENTREGADA') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Una entrega ya no está pendiente de firma. Actualiza la pantalla.');
        END IF;
        UPDATE historico.epp_solicitudes SET estado = 'CONFIRMADA', confirmada_en = now(), firma = v_firma, firma_origen = 'BODEGA' WHERE id = ANY (v_ids);
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- entregar: el stock baja aquí; si falta algo no se entrega nada. Con firma, cubre también las pendientes indicadas
    IF v_s.estado <> 'PREPARADA' THEN RETURN jsonb_build_object('ok', false, 'error', 'La solicitud cambió de estado. Actualiza la pantalla.'); END IF;
    IF v_firma IS NOT NULL AND NOT historico.epp_firma_valida(v_firma) THEN RETURN jsonb_build_object('ok', false, 'error', 'Falta la firma.'); END IF;
    PERFORM 1 FROM historico.epp_stock k JOIN historico.epp_items i ON i.epp_id = k.epp_id AND i.talla = k.talla
      WHERE i.solicitud_id = v_s.id ORDER BY k.epp_id, k.talla FOR UPDATE OF k;
    FOR v_r IN SELECT i.epp_id, i.talla, sum(i.cant)::int AS cant, coalesce(max(k.cant), 0) AS hay, max(x.nombre) AS nombre
                 FROM historico.epp_items i LEFT JOIN historico.epp_stock k ON k.epp_id = i.epp_id AND k.talla = i.talla
                 JOIN historico.epp_catalogo x ON x.id = i.epp_id
                WHERE i.solicitud_id = v_s.id GROUP BY i.epp_id, i.talla LOOP
        IF v_r.hay < v_r.cant THEN
            RETURN jsonb_build_object('ok', false, 'error', format('Sin stock: %s (%s)', v_r.nombre, v_r.talla));
        END IF;
    END LOOP;
    FOR v_r IN SELECT i.epp_id, i.talla, sum(i.cant)::int AS cant FROM historico.epp_items i WHERE i.solicitud_id = v_s.id GROUP BY i.epp_id, i.talla LOOP
        UPDATE historico.epp_stock SET cant = cant - v_r.cant WHERE epp_id = v_r.epp_id AND talla = v_r.talla;
        INSERT INTO historico.epp_movimientos (epp_id, talla, delta, quien, nota)
        VALUES (v_r.epp_id, v_r.talla, -v_r.cant, v_quien, historico.epp_codigo(v_s.id));
    END LOOP;
    UPDATE historico.epp_solicitudes SET estado = 'ENTREGADA', entregada_en = now(), entregada_por = v_quien WHERE id = v_s.id;
    IF v_firma IS NOT NULL THEN
        SELECT array_agg(nullif(left(regexp_replace(x, '\D', '', 'g'), 12), '')::bigint) INTO v_ids FROM jsonb_array_elements_text(coalesce(p->'pendientes', '[]')) x;
        UPDATE historico.epp_solicitudes SET estado = 'CONFIRMADA', confirmada_en = now(), firma = v_firma, firma_origen = 'BODEGA'
         WHERE estado = 'ENTREGADA' AND empleado_id = v_s.empleado_id AND (id = v_s.id OR id = ANY (coalesce(v_ids, '{}')));
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON historico.epp_catalogo, historico.epp_areas, historico.epp_puestos, historico.epp_puesto_items, historico.epp_asignaciones, historico.epp_stock, historico.epp_solicitudes,
    historico.epp_items, historico.epp_movimientos FROM PUBLIC, tcontrol_lector, tcontrol_anon;
REVOKE EXECUTE ON FUNCTION api.epp(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.epp(jsonb) TO tcontrol_lector;

NOTIFY pgrst, 'reload schema';
