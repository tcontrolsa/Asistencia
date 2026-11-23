-- =====================================================================
-- TCONTROL · Plataforma de evaluación técnica · fase 4: calificación y resultados
--
--   * El evaluador califica cada respuesta con puntos (hasta el valor de la pregunta) y un comentario,
--     a mano en «Revisar» o cargando de vuelta el Excel que haya completado una IA.
--   * historico.exam_resultados arma las hojas del Excel de resultados (Resumen, Respuestas, Incidencias e
--     Instrucciones para la IA) como arreglos de filas; la página y Apps Script solo las dibujan.
--   * El Excel se envía por correo al evaluador cuando el examen termina (activador de Apps Script, que usa
--     api.examenes_servicio con un token firmado con la clave de PostgREST y el claim servicio='examenes')
--     o cuando él lo pide desde la página.
-- Requiere 019_examenes.sql. Orden: 019, 021, 020, 022. Re-ejecutable.
-- =====================================================================
SET search_path = historico, public;

-- Correo del evaluador: el de su perfil de exámenes o, si no tiene, el de la nómina
CREATE OR REPLACE FUNCTION historico.exam_correo_evaluador(p_emp text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT nullif(btrim(coalesce(
        (SELECT p.correo FROM historico.exam_perfiles p WHERE p.empleado_id = p_emp AND p.rol = 'EVALUADOR' AND p.activo AND btrim(p.correo) <> '' LIMIT 1),
        (SELECT e.correo FROM historico.empleados e WHERE e.id = p_emp AND btrim(coalesce(e.correo, '')) <> '' LIMIT 1))), '')
$$;

CREATE OR REPLACE FUNCTION historico.exam_resultados(p_examen bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    v_e       historico.exam_examenes;
    v_resumen jsonb;
    v_resp    jsonb;
    v_inc     jsonb;
    v_fmt     text := 'YYYY-MM-DD HH24:MI';
    v_tz      text := 'America/Guayaquil';
BEGIN
    SELECT * INTO v_e FROM exam_examenes WHERE id = p_examen;
    IF NOT FOUND THEN RETURN NULL; END IF;

    v_resumen := jsonb_build_array(jsonb_build_array('Evaluado', 'Correo', 'Perfil', 'Estado', 'Inició', 'Entregó', 'Minutos usados', 'Preguntas',
                     'Respondidas', 'Incidencias', 'Capturas', 'Puntos', 'Máximo', '%')) ||
        coalesce((SELECT jsonb_agg(jsonb_build_array(
                f.nombre, f.correo, f.perfil, i.estado,
                to_char(i.iniciado_en AT TIME ZONE v_tz, v_fmt), to_char(i.entregado_en AT TIME ZONE v_tz, v_fmt),
                round((extract(epoch FROM (i.entregado_en - i.iniciado_en)) / 60)::numeric, 1),
                cardinality(i.preguntas),
                (SELECT count(*) FROM exam_respuestas r WHERE r.intento_id = i.id AND btrim(r.respuesta) <> ''),
                (SELECT count(*) FROM exam_eventos v WHERE v.intento_id = i.id AND v.tipo IN ('oculta', 'blur', 'sale_pantalla_completa', 'pegar', 'copiar', 'cortar', 'compartir_detenido')),
                (SELECT count(*) FROM exam_capturas c WHERE c.intento_id = i.id),
                (SELECT sum(k.puntos) FROM exam_calificaciones k WHERE k.intento_id = i.id),
                (SELECT sum(q.puntos) FROM exam_preguntas q WHERE q.id = ANY (i.preguntas)),
                CASE WHEN EXISTS (SELECT 1 FROM exam_calificaciones k WHERE k.intento_id = i.id)
                     THEN round(100 * (SELECT sum(k.puntos) FROM exam_calificaciones k WHERE k.intento_id = i.id)
                                / nullif((SELECT sum(q.puntos) FROM exam_preguntas q WHERE q.id = ANY (i.preguntas)), 0), 1) END
            ) ORDER BY f.nombre)
            FROM exam_intentos i JOIN exam_perfiles f ON f.id = i.perfil_id
           WHERE i.examen_id = p_examen AND i.estado <> 'ANULADO'), '[]');

    v_resp := jsonb_build_array(jsonb_build_array('ID_RESPUESTA', 'Evaluado', 'N°', 'Código', 'Tipo', 'Dificultad', 'Pregunta', 'Respuesta modelo',
                     'Respuesta del evaluado', 'Archivos adjuntos', 'Puntos máximos', 'Puntos obtenidos', 'Comentario')) ||
        coalesce((SELECT jsonb_agg(jsonb_build_array(
                i.id || '-' || q.id, f.nombre, u.ord, q.codigo, q.tipo, q.dificultad, q.pregunta, q.respuesta_modelo, coalesce(r.respuesta, ''),
                (SELECT string_agg(a.nombre, ', ' ORDER BY a.id) FROM exam_archivos a WHERE a.intento_id = i.id AND a.pregunta_id = q.id AND a.origen = 'RESPUESTA' AND a.estado = 'LISTO'),
                q.puntos, cal.puntos, cal.comentario
            ) ORDER BY f.nombre, u.ord)
            FROM exam_intentos i JOIN exam_perfiles f ON f.id = i.perfil_id
            CROSS JOIN LATERAL unnest(i.preguntas) WITH ORDINALITY u(pid, ord)
            JOIN exam_preguntas q ON q.id = u.pid
            LEFT JOIN exam_respuestas r ON r.intento_id = i.id AND r.pregunta_id = q.id
            LEFT JOIN exam_calificaciones cal ON cal.intento_id = i.id AND cal.pregunta_id = q.id
           WHERE i.examen_id = p_examen AND i.estado <> 'ANULADO'), '[]');

    v_inc := jsonb_build_array(jsonb_build_array('Evaluado', 'Hora', 'Tipo', 'Detalle', 'Segundos fuera')) ||
        coalesce((SELECT jsonb_agg(jsonb_build_array(f.nombre, to_char(v.creado_en AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI:SS'), v.tipo, v.detalle, v.segundos) ORDER BY f.nombre, v.id)
            FROM exam_intentos i JOIN exam_perfiles f ON f.id = i.perfil_id JOIN exam_eventos v ON v.intento_id = i.id
           WHERE i.examen_id = p_examen AND i.estado <> 'ANULADO'), '[]');

    RETURN jsonb_build_object(
        'examen', jsonb_build_object('id', v_e.id, 'nombre', v_e.nombre, 'minutos', v_e.minutos, 'creadoEn', v_e.creado_en),
        'hojas', jsonb_build_array(
            jsonb_build_object('nombre', 'Resumen', 'filas', v_resumen),
            jsonb_build_object('nombre', 'Respuestas', 'filas', v_resp),
            jsonb_build_object('nombre', 'Incidencias', 'filas', v_inc),
            jsonb_build_object('nombre', 'Instrucciones para IA', 'filas', jsonb_build_array(
                jsonb_build_array('CÓMO CALIFICAR ESTE EXCEL CON UNA IA (y volver a cargarlo en la plataforma)'),
                jsonb_build_array(''),
                jsonb_build_array('1. Sube este archivo a la IA que uses (ChatGPT, Claude, Copilot…). Usa una herramienta aprobada por la empresa: las respuestas contienen datos de personas.'),
                jsonb_build_array('2. Pega este mensaje:'),
                jsonb_build_array('   «En la hoja Respuestas, cada fila es una pregunta respondida por un evaluado. Compara la columna "Respuesta del evaluado" con la "Respuesta modelo" (si está vacía, usa tu criterio técnico). Rellena "Puntos obtenidos" con un número entre 0 y "Puntos máximos" (acepta decimales) y escribe en "Comentario" una justificación breve de una o dos frases. No cambies ninguna otra columna, en especial ID_RESPUESTA. Entrégame el mismo archivo Excel.»'),
                jsonb_build_array('3. Revisa lo que calificó la IA: es una sugerencia, la decisión es del evaluador.'),
                jsonb_build_array('4. En la plataforma, en el examen, usa «Cargar calificaciones» y elige el Excel calificado. Si no hay respuesta, deja los puntos vacíos o en 0.'),
                jsonb_build_array(''),
                jsonb_build_array('Notas: la columna ID_RESPUESTA une cada fila con su respuesta; no la borres ni la cambies. Las filas sin "Puntos obtenidos" se ignoran. Una calificación cargada reemplaza a la anterior.')))
        ));
END $$;

REVOKE EXECUTE ON FUNCTION historico.exam_resultados(bigint), historico.exam_correo_evaluador(text) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Evaluador: calificar y pedir resultados
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.examenes_resultados(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    v_yo     text := historico.exam_evaluador();
    v_master boolean := coalesce(historico.eval_claims()->>'master', '') = 'true';
    v_acc    text := coalesce(p->>'accion', '');
    v_e      historico.exam_examenes;
    v_i      historico.exam_intentos;
    v_x      jsonb;
    v_pts    numeric;
    v_max    numeric;
    v_pid    bigint;
    v_n      int;
    v_ok     int := 0;
    v_errs   jsonb := '[]';
    v_partes text[];
    v_lim    int;
    v_cnt    int;
    v_items  jsonb;
BEGIN
    IF v_yo IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No tienes permiso de evaluador.'); END IF;

    -- ===== Resultados de un examen (hojas del Excel) =====
    IF v_acc IN ('resultados', 'resultados_marcar', 'calificar_lote', 'ia_pendientes', 'calificar_ia') THEN
        SELECT * INTO v_e FROM exam_examenes WHERE id = (p->>'examenId')::bigint AND (v_master OR propietario = v_yo);
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Examen no encontrado.'); END IF;
    END IF;

    IF v_acc = 'resultados' THEN
        RETURN jsonb_build_object('ok', true, 'resultados', historico.exam_resultados(v_e.id), 'destinatario', historico.exam_correo_evaluador(v_yo));
    END IF;

    IF v_acc = 'resultados_marcar' THEN
        UPDATE exam_examenes SET resultados_enviados_en = CASE WHEN nullif(p->>'error', '') IS NULL THEN now() ELSE resultados_enviados_en END,
               resultados_error = left(nullif(p->>'error', ''), 200) WHERE id = v_e.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== Calificar un intento a mano =====
    IF v_acc = 'calificar' THEN
        SELECT i.* INTO v_i FROM exam_intentos i JOIN exam_examenes e ON e.id = i.examen_id
         WHERE i.id = (p->>'intentoId')::bigint AND (v_master OR e.propietario = v_yo);
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Intento no encontrado.'); END IF;
        IF jsonb_typeof(p->'items') <> 'array' OR jsonb_array_length(p->'items') > 200 THEN RETURN jsonb_build_object('ok', false, 'error', 'Calificaciones no válidas.'); END IF;
        FOR v_x IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
            v_n := (v_x->>'n')::int;
            IF v_n IS NULL OR v_n < 1 OR v_n > cardinality(v_i.preguntas) THEN CONTINUE; END IF;
            v_pid := v_i.preguntas[v_n];
            v_pts := historico.exam_puntos(v_x->>'puntos');
            SELECT puntos INTO v_max FROM exam_preguntas WHERE id = v_pid;
            IF v_pts IS NULL THEN                                      -- vacío = quitar la calificación
                DELETE FROM exam_calificaciones WHERE intento_id = v_i.id AND pregunta_id = v_pid;
                CONTINUE;
            END IF;
            IF v_pts < 0 OR v_pts > v_max THEN
                RETURN jsonb_build_object('ok', false, 'error', 'La pregunta ' || v_n || ' vale máximo ' || v_max || ' puntos.');
            END IF;
            INSERT INTO exam_calificaciones (intento_id, pregunta_id, puntos, comentario, origen, calificado_por)
            VALUES (v_i.id, v_pid, v_pts, left(nullif(btrim(coalesce(v_x->>'comentario', '')), ''), 2000), 'MANUAL', v_yo)
            ON CONFLICT (intento_id, pregunta_id) DO UPDATE SET puntos = EXCLUDED.puntos, comentario = EXCLUDED.comentario,
                origen = 'MANUAL', calificado_por = v_yo, actualizada = now();
            v_ok := v_ok + 1;
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'guardadas', v_ok,
            'puntos', (SELECT sum(k.puntos) FROM exam_calificaciones k WHERE k.intento_id = v_i.id),
            'maximo', (SELECT sum(q.puntos) FROM exam_preguntas q WHERE q.id = ANY (v_i.preguntas)));
    END IF;

    -- ===== Cargar calificaciones desde el Excel de resultados =====
    IF v_acc = 'calificar_lote' THEN
        IF jsonb_typeof(p->'items') <> 'array' OR jsonb_array_length(p->'items') > 300 THEN RETURN jsonb_build_object('ok', false, 'error', 'Envía hasta 300 filas por llamada.'); END IF;
        FOR v_x IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
            v_partes := regexp_split_to_array(btrim(coalesce(v_x->>'id', '')), '-');
            IF cardinality(v_partes) <> 2 OR v_partes[1] !~ '^[0-9]{1,15}$' OR v_partes[2] !~ '^[0-9]{1,15}$' THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'ID_RESPUESTA no válido');
                CONTINUE;
            END IF;
            SELECT * INTO v_i FROM exam_intentos WHERE id = v_partes[1]::bigint AND examen_id = v_e.id;
            IF NOT FOUND OR NOT (v_partes[2]::bigint = ANY (v_i.preguntas)) THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'No pertenece a este examen');
                CONTINUE;
            END IF;
            v_pts := historico.exam_puntos(v_x->>'puntos');
            IF v_pts IS NULL THEN CONTINUE; END IF;                    -- fila sin calificar: se ignora
            SELECT puntos INTO v_max FROM exam_preguntas WHERE id = v_partes[2]::bigint;
            IF v_pts < 0 OR v_pts > v_max THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'Puntos fuera de rango (0 a ' || v_max || ')');
                CONTINUE;
            END IF;
            INSERT INTO exam_calificaciones (intento_id, pregunta_id, puntos, comentario, origen, calificado_por)
            VALUES (v_i.id, v_partes[2]::bigint, v_pts, left(nullif(btrim(coalesce(v_x->>'comentario', '')), ''), 2000), 'EXCEL', v_yo)
            ON CONFLICT (intento_id, pregunta_id) DO UPDATE SET puntos = EXCLUDED.puntos, comentario = EXCLUDED.comentario,
                origen = 'EXCEL', calificado_por = v_yo, actualizada = now();
            v_ok := v_ok + 1;
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'guardadas', v_ok, 'errores', v_errs);
    END IF;

    -- ===== Calificación con IA (fase 5): solo en exámenes que lo anunciaron al evaluado =====
    IF v_acc IN ('ia_pendientes', 'calificar_ia') AND NOT v_e.ia_permitida THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este examen no tiene activada la calificación con IA.');
    END IF;

    -- Respuestas por calificar (entregadas, sin calificación; con «recalificar» también las que ya calificó la IA).
    -- Nunca se incluyen las que tienen calificación manual ni las que solo trajeron archivos. Sin nombres de personas.
    IF v_acc = 'ia_pendientes' THEN
        v_lim := least(greatest(coalesce((p->>'limite')::int, 6), 1), 10);
        WITH pend AS (
            SELECT i.id || '-' || q.id AS id, q.tipo, q.dificultad, q.pregunta, q.respuesta_modelo AS modelo, coalesce(r.respuesta, '') AS respuesta, q.puntos AS pmax,
                   (SELECT count(*)::int FROM exam_archivos a WHERE a.intento_id = i.id AND a.pregunta_id = q.id AND a.origen = 'RESPUESTA' AND a.estado = 'LISTO') AS archivos,
                   i.id * 1000000 + u.ord AS ord
              FROM exam_intentos i
              CROSS JOIN LATERAL unnest(i.preguntas) WITH ORDINALITY u(pid, ord)
              JOIN exam_preguntas q ON q.id = u.pid
              LEFT JOIN exam_respuestas r ON r.intento_id = i.id AND r.pregunta_id = q.id
              LEFT JOIN exam_calificaciones k ON k.intento_id = i.id AND k.pregunta_id = q.id
             WHERE i.examen_id = v_e.id AND i.estado = 'ENTREGADO'
               AND (nullif(p->>'intentoId', '') IS NULL OR i.id = (p->>'intentoId')::bigint)
               AND (k.intento_id IS NULL OR (coalesce((p->>'recalificar')::boolean, false) AND k.origen = 'IA'))
               AND NOT (btrim(coalesce(r.respuesta, '')) = '' AND EXISTS (SELECT 1 FROM exam_archivos a WHERE a.intento_id = i.id AND a.pregunta_id = q.id AND a.origen = 'RESPUESTA' AND a.estado = 'LISTO')))
        SELECT (SELECT count(*) FROM pend),
               (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'tipo', t.tipo, 'dificultad', t.dificultad, 'pregunta', t.pregunta, 'respuestaModelo', t.modelo,
                        'respuesta', t.respuesta, 'puntosMax', t.pmax, 'archivos', t.archivos) ORDER BY t.ord), '[]')
                  FROM (SELECT * FROM pend ORDER BY ord LIMIT v_lim) t)
          INTO v_cnt, v_items;
        RETURN jsonb_build_object('ok', true, 'items', v_items, 'restantes', v_cnt);
    END IF;

    -- Guarda lo que calificó la IA: ni sale del rango ni pisa una calificación manual
    IF v_acc = 'calificar_ia' THEN
        IF jsonb_typeof(p->'items') <> 'array' OR jsonb_array_length(p->'items') > 20 THEN RETURN jsonb_build_object('ok', false, 'error', 'Envía hasta 20 filas por llamada.'); END IF;
        FOR v_x IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
            v_partes := regexp_split_to_array(btrim(coalesce(v_x->>'id', '')), '-');
            IF cardinality(v_partes) <> 2 OR v_partes[1] !~ '^[0-9]{1,15}$' OR v_partes[2] !~ '^[0-9]{1,15}$' THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'ID_RESPUESTA no válido'); CONTINUE;
            END IF;
            SELECT * INTO v_i FROM exam_intentos WHERE id = v_partes[1]::bigint AND examen_id = v_e.id AND estado = 'ENTREGADO';
            IF NOT FOUND OR NOT (v_partes[2]::bigint = ANY (v_i.preguntas)) THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'No pertenece a este examen'); CONTINUE;
            END IF;
            v_pts := historico.exam_puntos(v_x->>'puntos');
            SELECT puntos INTO v_max FROM exam_preguntas WHERE id = v_partes[2]::bigint;
            IF v_pts IS NULL OR v_pts < 0 OR v_pts > v_max THEN
                v_errs := v_errs || jsonb_build_object('id', v_x->>'id', 'error', 'Puntos fuera de rango (0 a ' || v_max || ')'); CONTINUE;
            END IF;
            INSERT INTO exam_calificaciones (intento_id, pregunta_id, puntos, comentario, origen, calificado_por)
            VALUES (v_i.id, v_partes[2]::bigint, v_pts, left(nullif(btrim(coalesce(v_x->>'comentario', '')), ''), 2000), 'IA', v_yo)
            ON CONFLICT (intento_id, pregunta_id) DO UPDATE SET puntos = EXCLUDED.puntos, comentario = EXCLUDED.comentario,
                origen = 'IA', calificado_por = v_yo, actualizada = now() WHERE exam_calificaciones.origen <> 'MANUAL';
            IF FOUND THEN v_ok := v_ok + 1; END IF;
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'guardadas', v_ok, 'errores', v_errs);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
END $$;

-- ---------------------------------------------------------------------
-- Servicio: lo usa el activador de Apps Script (token firmado con claim servicio = 'examenes')
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.examenes_servicio(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    v_acc text := coalesce(p->>'accion', '');
    v_e   historico.exam_examenes;
BEGIN
    IF coalesce(historico.eval_claims()->>'servicio', '') <> 'examenes' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No autorizado.');
    END IF;

    -- Exámenes terminados cuyos resultados aún no se han enviado: ya no queda nadie con tiempo para rendirlos
    IF v_acc = 'pendientes' THEN
        UPDATE exam_intentos SET estado = 'ENTREGADO', entregado_en = limite_en, motivo_cierre = 'tiempo'
         WHERE estado = 'INICIADO' AND limite_en IS NOT NULL AND now() > limite_en + interval '20 seconds';
        RETURN jsonb_build_object('ok', true, 'examenes', (
            SELECT coalesce(jsonb_agg(jsonb_build_object('examenId', e.id, 'nombre', e.nombre, 'destinatario', historico.exam_correo_evaluador(e.propietario)) ORDER BY e.id), '[]')
              FROM (SELECT * FROM exam_examenes x
                     WHERE x.resultados_enviados_en IS NULL AND x.resultados_error IS NULL
                       AND EXISTS (SELECT 1 FROM exam_intentos i WHERE i.examen_id = x.id AND i.estado = 'ENTREGADO')
                       AND NOT EXISTS (SELECT 1 FROM exam_intentos i WHERE i.examen_id = x.id
                                          AND (i.estado = 'INICIADO' OR (i.estado = 'ENVIADO' AND i.expira_en > now())))
                     ORDER BY x.id LIMIT 20) e));
    END IF;

    IF v_acc IN ('resultados', 'marcar') THEN
        SELECT * INTO v_e FROM exam_examenes WHERE id = (p->>'examenId')::bigint;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Examen no encontrado.'); END IF;
        IF v_acc = 'resultados' THEN
            RETURN jsonb_build_object('ok', true, 'resultados', historico.exam_resultados(v_e.id), 'destinatario', historico.exam_correo_evaluador(v_e.propietario));
        END IF;
        UPDATE exam_examenes SET resultados_enviados_en = CASE WHEN nullif(p->>'error', '') IS NULL THEN now() ELSE resultados_enviados_en END,
               resultados_error = left(nullif(p->>'error', ''), 200) WHERE id = v_e.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
END $$;

REVOKE EXECUTE ON FUNCTION api.examenes_resultados(jsonb), api.examenes_servicio(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.examenes_resultados(jsonb), api.examenes_servicio(jsonb) TO tcontrol_lector;

NOTIFY pgrst, 'reload schema';
