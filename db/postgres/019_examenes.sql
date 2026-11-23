-- =====================================================================
-- TCONTROL · Plataforma de evaluación técnica (exámenes con preguntas abiertas)
--
-- Fase 1: perfiles, banco de preguntas (carga desde Excel), generación de exámenes con
-- sorteo por persona y envío de enlaces por correo. Fases siguientes: página del examen,
-- anti-copia, adjuntos y Excel de resultados.
--
-- Quién puede qué (claims del JWT de tokenEvaluacion, igual que Desempeño y EPP):
--   * Evaluador = perfil con rol EVALUADOR y empleado_id = quien llama, o el admin master.
--   * Todo pasa por api.examenes(p) (acción en p->>'accion'); las tablas no se exponen.
--   * Las respuestas modelo solo las ve un evaluador; nunca viajan al evaluado.
--   * Cada evaluador ve solo sus bancos y exámenes; el master ve todo.
-- El enlace del examen lleva un token aleatorio; en la base solo queda su hash.
--
-- Requiere 003_evaluaciones.sql (eval_claims) y 008_visitas.sql (visita_hash, visita_token). Re-ejecutable.
-- =====================================================================
SET search_path = historico, public;

-- Catálogos editables: LINEA, PERFIL, TIPO, DIFICULTAD
CREATE TABLE IF NOT EXISTS historico.exam_catalogo (
    tipo   text NOT NULL CHECK (tipo IN ('LINEA', 'PERFIL', 'TIPO', 'DIFICULTAD')),
    valor  text NOT NULL,
    orden  int NOT NULL DEFAULT 0,
    PRIMARY KEY (tipo, valor)
);
INSERT INTO historico.exam_catalogo (tipo, valor, orden) VALUES
    ('LINEA', 'Baja Tensión', 1), ('LINEA', 'Media Tensión', 2), ('LINEA', 'Electromecánica', 3),
    ('LINEA', 'Motion y Automation', 4),
    ('PERFIL', 'Pasante', 1), ('PERFIL', 'Ingeniero', 2),
    ('TIPO', 'Técnica', 1), ('TIPO', 'Proceso', 2), ('TIPO', 'Ejercicio', 3), ('TIPO', 'Capacitación', 4),
    ('DIFICULTAD', 'Bajo', 1), ('DIFICULTAD', 'Medio', 2), ('DIFICULTAD', 'Alto', 3)
ON CONFLICT DO NOTHING;

-- Personas: evaluadores (empleados) y evaluados (empleados o candidatos externos, solo con correo)
CREATE TABLE IF NOT EXISTS historico.exam_perfiles (
    id           bigserial PRIMARY KEY,
    empleado_id  text,                              -- vacío = candidato externo
    nombre       text NOT NULL,
    correo       text NOT NULL,
    rol          text NOT NULL CHECK (rol IN ('EVALUADO', 'EVALUADOR')),
    perfil       text,                              -- catálogo PERFIL (evaluados)
    lineas       text[] NOT NULL DEFAULT '{}',      -- catálogo LINEA (evaluados)
    activo       boolean NOT NULL DEFAULT true,
    creado_por   text,
    creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_perfiles_correo_rol ON historico.exam_perfiles (lower(correo), rol);

-- Banco de preguntas. Arreglo vacío en perfiles / lineas = aplica a todos.
CREATE TABLE IF NOT EXISTS historico.exam_preguntas (
    id               bigserial PRIMARY KEY,
    propietario      text NOT NULL,                  -- empleado_id del evaluador
    codigo           text NOT NULL,                  -- ID del Excel (P001)
    perfiles         text[] NOT NULL DEFAULT '{}',
    lineas           text[] NOT NULL DEFAULT '{}',
    tipo             text NOT NULL,
    dificultad       text,
    pregunta         text NOT NULL,
    respuesta_modelo text,
    adjuntos         jsonb NOT NULL DEFAULT '[]',    -- fase 3
    activa           boolean NOT NULL DEFAULT true,
    creado_en        timestamptz NOT NULL DEFAULT now(),
    actualizado_en   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (propietario, codigo)
);

CREATE TABLE IF NOT EXISTS historico.exam_examenes (
    id            bigserial PRIMARY KEY,
    propietario   text NOT NULL,
    nombre        text NOT NULL,
    filtros       jsonb NOT NULL DEFAULT '{}',       -- perfiles, lineas, tipos, dificultades
    cantidad      int NOT NULL CHECK (cantidad BETWEEN 1 AND 100),
    minutos       int NOT NULL CHECK (minutos BETWEEN 1 AND 600),
    vigencia_dias int NOT NULL DEFAULT 7 CHECK (vigencia_dias BETWEEN 1 AND 60),
    creado_en     timestamptz NOT NULL DEFAULT now()
);

-- Un intento por evaluado: sus preguntas sorteadas, su enlace y su estado
CREATE TABLE IF NOT EXISTS historico.exam_intentos (
    id          bigserial PRIMARY KEY,
    examen_id   bigint NOT NULL REFERENCES historico.exam_examenes (id) ON DELETE CASCADE,
    perfil_id   bigint NOT NULL REFERENCES historico.exam_perfiles (id),
    preguntas   bigint[] NOT NULL,
    token_hash  text UNIQUE,
    estado      text NOT NULL DEFAULT 'GENERADO' CHECK (estado IN ('GENERADO', 'ENVIADO', 'INICIADO', 'ENTREGADO', 'ANULADO')),
    enviado_en  timestamptz,
    error_envio text,
    expira_en   timestamptz NOT NULL,
    iniciado_en timestamptz,
    entregado_en timestamptz,
    creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_intentos_examen ON historico.exam_intentos (examen_id);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Evaluador autorizado: devuelve su empleado_id o NULL
CREATE OR REPLACE FUNCTION historico.exam_evaluador() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c    jsonb := historico.eval_claims();
    v_yo text := btrim(coalesce(c->>'empleado_id', ''));
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN RETURN NULL; END IF;
    IF coalesce(c->>'master', '') = 'true' THEN RETURN v_yo; END IF;
    IF EXISTS (SELECT 1 FROM exam_perfiles WHERE empleado_id = v_yo AND rol = 'EVALUADOR' AND activo) THEN RETURN v_yo; END IF;
    RETURN NULL;
END $$;

-- Texto → arreglo limpio sin vacíos ni repetidos (acepta arreglo JSON o texto con ';')
CREATE OR REPLACE FUNCTION historico.exam_lista(j jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(array_agg(DISTINCT v ORDER BY v), '{}')
      FROM (SELECT btrim(x) AS v FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END) x) s
     WHERE v <> ''
$$;

-- Valores que no están en el catálogo (para rechazar la fila con un mensaje claro)
CREATE OR REPLACE FUNCTION historico.exam_fuera_catalogo(p_tipo text, p_vals text[]) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT coalesce(array_agg(v), '{}') FROM unnest(p_vals) v
     WHERE NOT EXISTS (SELECT 1 FROM historico.exam_catalogo c WHERE c.tipo = p_tipo AND c.valor = v)
$$;

CREATE OR REPLACE FUNCTION historico.exam_pregunta_json(q historico.exam_preguntas) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('id', q.id, 'codigo', q.codigo, 'perfiles', to_jsonb(q.perfiles),
        'lineas', to_jsonb(q.lineas), 'tipo', q.tipo, 'dificultad', q.dificultad, 'pregunta', q.pregunta,
        'respuestaModelo', q.respuesta_modelo, 'adjuntos', q.adjuntos, 'activa', q.activa)
$$;

CREATE OR REPLACE FUNCTION historico.exam_perfil_json(f historico.exam_perfiles) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('id', f.id, 'empleadoId', f.empleado_id, 'nombre', f.nombre, 'correo', f.correo,
        'rol', f.rol, 'perfil', f.perfil, 'lineas', to_jsonb(f.lineas), 'activo', f.activo)
$$;

-- ---------------------------------------------------------------------
-- Función única de la plataforma
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.examenes(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c        jsonb := historico.eval_claims();
    v_yo     text := historico.exam_evaluador();
    v_master boolean := coalesce(c->>'master', '') = 'true';
    v_acc    text := coalesce(p->>'accion', '');
    r        jsonb;
    v_i      jsonb;
    v_n      int;
    v_ok     int := 0;
    v_errs   jsonb := '[]';
    v_fila   int := 0;
    v_perf   text[]; v_lin text[]; v_tipo text; v_dif text; v_cod text; v_bad text[];
    v_id     bigint;
    v_ex     historico.exam_examenes;
    v_f      jsonb;
    v_ev     historico.exam_perfiles;
    v_pool   bigint[];
    v_sel    bigint[];
    v_filt_perf text[]; v_filt_lin text[]; v_filt_tipo text[]; v_filt_dif text[];
    v_usa_perf text[]; v_usa_lin text[];
    v_res    jsonb := '[]';
    v_tok    text;
    v_pid    bigint;
BEGIN
    IF v_yo IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No tienes permiso de evaluador. Pide al administrador que te agregue.');
    END IF;

    -- ===== Inicio: catálogos, personas, exámenes y conteo del banco =====
    IF v_acc = 'inicio' THEN
        RETURN jsonb_build_object('ok', true, 'yo', v_yo, 'master', v_master,
            'catalogo', (SELECT coalesce(jsonb_object_agg(t, vs), '{}') FROM (
                SELECT tipo AS t, jsonb_agg(valor ORDER BY orden, valor) AS vs FROM exam_catalogo GROUP BY tipo) z),
            'perfiles', (SELECT coalesce(jsonb_agg(historico.exam_perfil_json(f) ORDER BY f.rol, f.nombre), '[]')
                           FROM exam_perfiles f WHERE f.activo),
            'preguntas', (SELECT count(*) FROM exam_preguntas q WHERE q.activa AND (v_master OR q.propietario = v_yo)),
            'examenes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'cantidad', e.cantidad,
                    'minutos', e.minutos, 'creadoEn', e.creado_en, 'filtros', e.filtros,
                    'intentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'perfilId', i.perfil_id, 'nombre', f.nombre,
                            'correo', f.correo, 'estado', i.estado, 'enviadoEn', i.enviado_en, 'errorEnvio', i.error_envio,
                            'preguntas', cardinality(i.preguntas), 'expiraEn', i.expira_en) ORDER BY f.nombre), '[]')
                         FROM exam_intentos i JOIN exam_perfiles f ON f.id = i.perfil_id WHERE i.examen_id = e.id)
                ) ORDER BY e.creado_en DESC), '[]') FROM exam_examenes e WHERE v_master OR e.propietario = v_yo));
    END IF;

    -- ===== Catálogo: agregar un valor (perfil, línea, tipo o dificultad) =====
    IF v_acc = 'catalogo_agregar' THEN
        IF btrim(coalesce(p->>'valor', '')) = '' OR coalesce(p->>'tipo', '') NOT IN ('LINEA', 'PERFIL', 'TIPO', 'DIFICULTAD') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Catálogo o valor no válido.');
        END IF;
        INSERT INTO exam_catalogo (tipo, valor, orden)
        VALUES (p->>'tipo', btrim(p->>'valor'), (SELECT coalesce(max(orden), 0) + 1 FROM exam_catalogo WHERE tipo = p->>'tipo'))
        ON CONFLICT DO NOTHING;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== Personas =====
    IF v_acc = 'perfil_guardar' THEN
        IF btrim(coalesce(p->>'nombre', '')) = '' OR coalesce(p->>'correo', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Escribe el nombre y un correo válido.');
        END IF;
        IF coalesce(p->>'rol', '') NOT IN ('EVALUADO', 'EVALUADOR') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Rol no válido.');
        END IF;
        IF p->>'rol' = 'EVALUADOR' AND NOT v_master THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Solo el administrador master asigna evaluadores.');
        END IF;
        IF p->>'rol' = 'EVALUADOR' AND btrim(coalesce(p->>'empleadoId', '')) = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Un evaluador debe ser un empleado (ID).');
        END IF;
        IF p->>'rol' = 'EVALUADO' THEN
            IF coalesce(p->>'perfil', '') = '' OR cardinality(historico.exam_fuera_catalogo('PERFIL', ARRAY[p->>'perfil'])) > 0 THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Elige un perfil válido.');
            END IF;
            v_lin := historico.exam_lista(p->'lineas');
            IF cardinality(historico.exam_fuera_catalogo('LINEA', v_lin)) > 0 THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Alguna línea de negocio no existe en el catálogo.');
            END IF;
        END IF;
        IF nullif(p->>'id', '') IS NOT NULL THEN
            UPDATE exam_perfiles SET nombre = btrim(p->>'nombre'), correo = lower(btrim(p->>'correo')),
                   empleado_id = nullif(btrim(coalesce(p->>'empleadoId', '')), ''),
                   perfil = CASE WHEN rol = 'EVALUADO' THEN p->>'perfil' END,
                   lineas = CASE WHEN rol = 'EVALUADO' THEN v_lin ELSE '{}' END,
                   activo = coalesce((p->>'activo')::boolean, true)
             WHERE id = (p->>'id')::bigint RETURNING id INTO v_id;
        ELSE
            INSERT INTO exam_perfiles (empleado_id, nombre, correo, rol, perfil, lineas, creado_por)
            VALUES (nullif(btrim(coalesce(p->>'empleadoId', '')), ''), btrim(p->>'nombre'), lower(btrim(p->>'correo')), p->>'rol',
                    CASE WHEN p->>'rol' = 'EVALUADO' THEN p->>'perfil' END,
                    CASE WHEN p->>'rol' = 'EVALUADO' THEN v_lin ELSE '{}' END, v_yo)
            ON CONFLICT (lower(correo), rol) DO UPDATE SET nombre = EXCLUDED.nombre, empleado_id = EXCLUDED.empleado_id,
                perfil = EXCLUDED.perfil, lineas = EXCLUDED.lineas, activo = true
            RETURNING id INTO v_id;
        END IF;
        RETURN jsonb_build_object('ok', true, 'id', v_id);
    END IF;

    IF v_acc = 'perfil_baja' THEN
        UPDATE exam_perfiles SET activo = false
         WHERE id = (p->>'id')::bigint AND (rol = 'EVALUADO' OR v_master);
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== Banco de preguntas =====
    IF v_acc = 'banco_listar' THEN
        RETURN jsonb_build_object('ok', true, 'preguntas', (
            SELECT coalesce(jsonb_agg(historico.exam_pregunta_json(q) ORDER BY q.codigo), '[]')
              FROM exam_preguntas q WHERE q.activa AND (v_master OR q.propietario = v_yo)));
    END IF;

    IF v_acc = 'banco_importar' THEN
        -- Cada fila se valida y se guarda aparte: una fila mala no tumba las demás
        IF jsonb_typeof(p->'preguntas') <> 'array' OR jsonb_array_length(p->'preguntas') > 60 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Envía hasta 60 preguntas por llamada.');
        END IF;
        FOR v_i IN SELECT * FROM jsonb_array_elements(p->'preguntas') LOOP
            v_fila := coalesce((v_i->>'fila')::int, v_fila + 1);
            v_cod := btrim(coalesce(v_i->>'codigo', ''));
            v_tipo := btrim(coalesce(v_i->>'tipo', ''));
            v_dif := nullif(btrim(coalesce(v_i->>'dificultad', '')), '');
            v_perf := historico.exam_lista(v_i->'perfiles');
            v_lin := historico.exam_lista(v_i->'lineas');
            IF v_cod = '' OR btrim(coalesce(v_i->>'pregunta', '')) = '' THEN
                v_errs := v_errs || jsonb_build_object('fila', v_fila, 'error', 'Falta el ID o la pregunta');
                CONTINUE;
            END IF;
            v_bad := historico.exam_fuera_catalogo('PERFIL', v_perf);
            IF cardinality(v_bad) > 0 THEN
                v_errs := v_errs || jsonb_build_object('fila', v_fila, 'codigo', v_cod, 'error', 'Usuario/perfil desconocido: ' || array_to_string(v_bad, ', '));
                CONTINUE;
            END IF;
            v_bad := historico.exam_fuera_catalogo('LINEA', v_lin);
            IF cardinality(v_bad) > 0 THEN
                v_errs := v_errs || jsonb_build_object('fila', v_fila, 'codigo', v_cod, 'error', 'Línea de negocio desconocida: ' || array_to_string(v_bad, ', '));
                CONTINUE;
            END IF;
            IF cardinality(historico.exam_fuera_catalogo('TIPO', ARRAY[v_tipo])) > 0 THEN
                v_errs := v_errs || jsonb_build_object('fila', v_fila, 'codigo', v_cod, 'error', 'Tipo de pregunta desconocido: ' || v_tipo);
                CONTINUE;
            END IF;
            IF v_dif IS NOT NULL AND cardinality(historico.exam_fuera_catalogo('DIFICULTAD', ARRAY[v_dif])) > 0 THEN
                v_errs := v_errs || jsonb_build_object('fila', v_fila, 'codigo', v_cod, 'error', 'Dificultad desconocida: ' || v_dif);
                CONTINUE;
            END IF;
            INSERT INTO exam_preguntas (propietario, codigo, perfiles, lineas, tipo, dificultad, pregunta, respuesta_modelo)
            VALUES (v_yo, v_cod, v_perf, v_lin, v_tipo, v_dif, btrim(v_i->>'pregunta'), nullif(btrim(coalesce(v_i->>'respuestaModelo', '')), ''))
            ON CONFLICT (propietario, codigo) DO UPDATE SET perfiles = EXCLUDED.perfiles, lineas = EXCLUDED.lineas,
                tipo = EXCLUDED.tipo, dificultad = EXCLUDED.dificultad, pregunta = EXCLUDED.pregunta,
                respuesta_modelo = EXCLUDED.respuesta_modelo, activa = true, actualizado_en = now();
            v_ok := v_ok + 1;
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'guardadas', v_ok, 'errores', v_errs);
    END IF;

    IF v_acc = 'pregunta_baja' THEN
        UPDATE exam_preguntas SET activa = false, actualizado_en = now()
         WHERE id = (p->>'id')::bigint AND (v_master OR propietario = v_yo);
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== Generar examen: sortea las preguntas de cada evaluado =====
    IF v_acc = 'examen_generar' THEN
        v_f := coalesce(p->'filtros', '{}');
        v_filt_perf := historico.exam_lista(v_f->'perfiles');
        v_filt_lin  := historico.exam_lista(v_f->'lineas');
        v_filt_tipo := historico.exam_lista(v_f->'tipos');
        v_filt_dif  := historico.exam_lista(v_f->'dificultades');
        IF btrim(coalesce(p->>'nombre', '')) = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Ponle un nombre al examen.');
        END IF;
        IF coalesce((p->>'cantidad')::int, 0) NOT BETWEEN 1 AND 100 OR coalesce((p->>'minutos')::int, 0) NOT BETWEEN 1 AND 600 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cantidad de preguntas (1-100) y tiempo en minutos (1-600) no válidos.');
        END IF;
        IF jsonb_typeof(p->'perfilIds') <> 'array' OR jsonb_array_length(p->'perfilIds') = 0 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Elige al menos un evaluado.');
        END IF;

        INSERT INTO exam_examenes (propietario, nombre, filtros, cantidad, minutos, vigencia_dias)
        VALUES (v_yo, btrim(p->>'nombre'), jsonb_build_object('perfiles', to_jsonb(v_filt_perf), 'lineas', to_jsonb(v_filt_lin),
                'tipos', to_jsonb(v_filt_tipo), 'dificultades', to_jsonb(v_filt_dif)),
                (p->>'cantidad')::int, (p->>'minutos')::int, coalesce((p->>'vigenciaDias')::int, 7))
        RETURNING * INTO v_ex;

        FOR v_pid IN SELECT x::bigint FROM jsonb_array_elements_text(p->'perfilIds') x LOOP
            SELECT * INTO v_ev FROM exam_perfiles WHERE id = v_pid AND rol = 'EVALUADO' AND activo;
            IF NOT FOUND THEN CONTINUE; END IF;
            -- Perfil: el que eligió el evaluador en los filtros o, si no eligió, el del evaluado
            v_usa_perf := CASE WHEN cardinality(v_filt_perf) > 0 THEN v_filt_perf ELSE ARRAY[v_ev.perfil] END;
            -- Líneas: las del filtro o, si no hay, las del evaluado; sin ninguna = todas
            v_usa_lin := CASE WHEN cardinality(v_filt_lin) > 0 THEN v_filt_lin ELSE v_ev.lineas END;
            SELECT coalesce(array_agg(q.id ORDER BY random()), '{}') INTO v_pool
              FROM exam_preguntas q
             WHERE q.activa AND q.propietario = v_ex.propietario
               AND (cardinality(q.perfiles) = 0 OR q.perfiles && v_usa_perf)
               AND (cardinality(q.lineas) = 0 OR cardinality(v_usa_lin) = 0 OR q.lineas && v_usa_lin)
               AND (cardinality(v_filt_tipo) = 0 OR q.tipo = ANY (v_filt_tipo))
               AND (cardinality(v_filt_dif) = 0 OR q.dificultad IS NULL OR q.dificultad = ANY (v_filt_dif));
            v_sel := v_pool[1:v_ex.cantidad];
            IF cardinality(v_sel) = 0 THEN
                v_res := v_res || jsonb_build_object('perfilId', v_pid, 'nombre', v_ev.nombre, 'ok', false,
                         'error', 'No hay preguntas que coincidan con su perfil y los filtros.');
                CONTINUE;
            END IF;
            INSERT INTO exam_intentos (examen_id, perfil_id, preguntas, expira_en)
            VALUES (v_ex.id, v_pid, v_sel, now() + make_interval(days => v_ex.vigencia_dias));
            v_res := v_res || jsonb_build_object('perfilId', v_pid, 'nombre', v_ev.nombre, 'ok', true,
                     'preguntas', cardinality(v_sel), 'faltan', GREATEST(v_ex.cantidad - cardinality(v_sel), 0));
        END LOOP;
        -- Sin ningún intento no queda examen vacío
        IF NOT EXISTS (SELECT 1 FROM exam_intentos WHERE examen_id = v_ex.id) THEN
            DELETE FROM exam_examenes WHERE id = v_ex.id;
            RETURN jsonb_build_object('ok', false, 'error', 'No se pudo armar ningún examen: no hay preguntas que coincidan.', 'detalle', v_res);
        END IF;
        RETURN jsonb_build_object('ok', true, 'examenId', v_ex.id, 'detalle', v_res);
    END IF;

    -- ===== Envío por correo (lo llama Apps Script con el token del evaluador) =====
    -- Rota el token de cada intento pendiente y lo devuelve en claro solo a Apps Script, que lo manda por correo.
    IF v_acc = 'envio_preparar' THEN
        SELECT * INTO v_ex FROM exam_examenes WHERE id = (p->>'examenId')::bigint AND (v_master OR propietario = v_yo);
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Examen no encontrado.'); END IF;
        FOR v_id IN SELECT i.id FROM exam_intentos i
                     WHERE i.examen_id = v_ex.id AND i.estado IN ('GENERADO', 'ENVIADO')
                       AND (p->'intentoIds' IS NULL OR jsonb_typeof(p->'intentoIds') <> 'array'
                            OR p->'intentoIds' @> to_jsonb(i.id))
                     ORDER BY i.id LOOP
            v_tok := historico.visita_token();
            UPDATE exam_intentos SET token_hash = historico.visita_hash(v_tok),
                   expira_en = GREATEST(expira_en, now() + make_interval(days => v_ex.vigencia_dias))
             WHERE id = v_id;
            SELECT * INTO v_ev FROM exam_perfiles WHERE id = (SELECT perfil_id FROM exam_intentos WHERE id = v_id);
            v_res := v_res || jsonb_build_object('intentoId', v_id, 'nombre', v_ev.nombre, 'correo', v_ev.correo, 'token', v_tok,
                     'preguntas', (SELECT cardinality(preguntas) FROM exam_intentos WHERE id = v_id),
                     'expiraEn', (SELECT expira_en FROM exam_intentos WHERE id = v_id));
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'examen', jsonb_build_object('id', v_ex.id, 'nombre', v_ex.nombre, 'minutos', v_ex.minutos),
                                  'envios', v_res);
    END IF;

    IF v_acc = 'envio_marcar' THEN
        -- ok: ids enviados; fallos: [{id, error}]
        UPDATE exam_intentos SET estado = 'ENVIADO', enviado_en = now(), error_envio = NULL
         WHERE estado IN ('GENERADO', 'ENVIADO') AND id IN (SELECT x::bigint FROM jsonb_array_elements_text(coalesce(p->'ok', '[]')) x)
           AND examen_id IN (SELECT id FROM exam_examenes WHERE v_master OR propietario = v_yo);
        UPDATE exam_intentos i SET error_envio = left(f->>'error', 200)
          FROM jsonb_array_elements(coalesce(p->'fallos', '[]')) f
         WHERE i.id = (f->>'id')::bigint AND i.estado IN ('GENERADO', 'ENVIADO')
           AND i.examen_id IN (SELECT id FROM exam_examenes WHERE v_master OR propietario = v_yo);
        RETURN jsonb_build_object('ok', true);
    END IF;

    IF v_acc = 'examen_anular' THEN
        UPDATE exam_intentos SET estado = 'ANULADO', token_hash = NULL
         WHERE id = (p->>'intentoId')::bigint AND estado IN ('GENERADO', 'ENVIADO')
           AND examen_id IN (SELECT id FROM exam_examenes WHERE v_master OR propietario = v_yo);
        RETURN jsonb_build_object('ok', true);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
END $$;

REVOKE EXECUTE ON FUNCTION api.examenes(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.examenes(jsonb) TO tcontrol_lector;
REVOKE EXECUTE ON FUNCTION historico.exam_evaluador() FROM PUBLIC;
