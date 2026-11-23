-- =====================================================================
-- TCONTROL · Plataforma de evaluación técnica · fase 2: la página del examen (sin contraseña)
--
-- api.examen_publico(p) la usa examen.html. La persona se identifica solo con el token de su enlace
-- (64 hex, en la base solo queda su hash; el enlace viaja en #t= y no llega a ningún servidor).
-- Acciones:
--   abrir     datos del examen antes de empezar (sin preguntas)
--   iniciar   acepta el aviso, arranca el reloj (una sola vez, en el servidor) y entrega las preguntas.
--             Si ya había empezado (recarga de la página) continúa con el tiempo que le quede.
--   guardar   autoguardado de respuestas (solo mientras corre el tiempo)
--   evento    cambios de pestaña, pegados, salida de pantalla completa, etc.
--   captura   imagen JPEG de la pantalla compartida (máx. 120 por intento, 250 KB cada una)
--   entregar  cierra el examen
-- El reloj es del servidor: el navegador solo lo muestra. Pasado el tiempo (+20 s de gracia) ya no
-- se aceptan respuestas y el intento se cierra por tiempo.
-- Nunca se devuelven respuestas modelo, códigos ni datos de otras personas.
--
-- Adjuntos (fase 3): archivo_parte (leer lo adjunto a la pregunta o lo que subió él), subir_inicio / subir_parte /
-- subir_fin / archivo_quitar (solo si el examen permite adjuntos en las respuestas).
--
-- Requiere 019_examenes.sql, 021_examen_adjuntos.sql y 008_visitas.sql (visita_hash). Re-ejecutable.
-- =====================================================================
SET search_path = historico, public;

CREATE OR REPLACE FUNCTION api.examen_publico(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    v_acc  text := coalesce(p->>'accion', '');
    v_tok  text := btrim(coalesce(p->>'token', ''));
    v_i    historico.exam_intentos;
    v_e    historico.exam_examenes;
    v_nom  text;
    v_rest int;
    v_n    int;
    v_x    jsonb;
    v_pid  bigint;
    v_img  bytea;
    v_ok   int := 0;
    v_resp jsonb;
    v_a    historico.exam_archivos;
    v_tam  bigint;
    v_np   int;
    v_tipos text[] := ARRAY['oculta', 'blur', 'foco', 'visible', 'sale_pantalla_completa', 'copiar', 'cortar', 'pegar', 'menu_contextual',
                            'tecla', 'recarga', 'reanudo', 'compartir_iniciado', 'compartir_detenido', 'sin_compartir_pantalla_completa',
                            'sin_pantalla', 'cierre_pagina'];
BEGIN
    IF v_tok !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El enlace no es válido.');
    END IF;
    SELECT * INTO v_i FROM exam_intentos WHERE token_hash = historico.visita_hash(v_tok) FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'El enlace no es válido o fue reemplazado por uno más reciente.'); END IF;
    SELECT * INTO v_e FROM exam_examenes WHERE id = v_i.examen_id;
    SELECT split_part(btrim(nombre), ' ', 1) INTO v_nom FROM exam_perfiles WHERE id = v_i.perfil_id;

    IF v_i.estado = 'ANULADO' THEN RETURN jsonb_build_object('ok', false, 'error', 'Este examen fue anulado.'); END IF;

    -- Pasó el tiempo: se cierra
    IF v_i.estado = 'INICIADO' AND now() > v_i.limite_en + interval '20 seconds' THEN
        UPDATE exam_intentos SET estado = 'ENTREGADO', entregado_en = limite_en, motivo_cierre = 'tiempo' WHERE id = v_i.id RETURNING * INTO v_i;
    END IF;

    IF v_i.estado = 'ENTREGADO' THEN
        RETURN jsonb_build_object('ok', true, 'estado', 'ENTREGADO', 'nombre', v_nom, 'examen', v_e.nombre, 'motivoCierre', v_i.motivo_cierre);
    END IF;

    IF v_i.estado IN ('GENERADO', 'ENVIADO') AND v_i.expira_en < now() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este enlace venció. Pide al evaluador que te envíe uno nuevo.');
    END IF;

    v_rest := CASE WHEN v_i.limite_en IS NULL THEN v_e.minutos * 60 ELSE greatest(0, ceil(extract(epoch FROM v_i.limite_en - now()))::int) END;

    -- ===== abrir =====
    IF v_acc = 'abrir' THEN
        RETURN jsonb_build_object('ok', true, 'estado', v_i.estado, 'nombre', v_nom, 'examen', v_e.nombre, 'minutos', v_e.minutos,
            'preguntas', cardinality(v_i.preguntas), 'exigirPantalla', v_e.exigir_pantalla, 'permitirAdjuntos', v_e.permitir_adjuntos, 'restante', v_rest);
    END IF;

    -- ===== iniciar (o continuar) =====
    IF v_acc = 'iniciar' THEN
        IF v_i.estado IN ('GENERADO', 'ENVIADO') THEN
            IF coalesce((p->>'acepto')::boolean, false) IS NOT TRUE THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Debes aceptar el aviso para empezar.');
            END IF;
            UPDATE exam_intentos SET estado = 'INICIADO', acepto_en = now(), iniciado_en = now(), limite_en = now() + make_interval(mins => v_e.minutos),
                   pantalla_ok = coalesce((p->>'pantalla')::boolean, false)
             WHERE id = v_i.id RETURNING * INTO v_i;
            v_rest := v_e.minutos * 60;
        ELSE
            INSERT INTO exam_eventos (intento_id, tipo, detalle) VALUES (v_i.id, 'reanudo', 'Volvió a abrir el examen');
            UPDATE exam_intentos SET pantalla_ok = coalesce((p->>'pantalla')::boolean, pantalla_ok) WHERE id = v_i.id;
        END IF;
        RETURN jsonb_build_object('ok', true, 'estado', 'INICIADO', 'nombre', v_nom, 'examen', v_e.nombre, 'minutos', v_e.minutos, 'restante', v_rest,
            'permitirAdjuntos', v_e.permitir_adjuntos,
            'preguntas', (SELECT coalesce(jsonb_agg(jsonb_build_object('n', u.ord, 'tipo', q.tipo, 'texto', q.pregunta,
                    'respuesta', coalesce(r.respuesta, ''), 'adjuntos', q.adjuntos,
                    'archivos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'mime', a.mime, 'tamano', a.tamano) ORDER BY a.id), '[]')
                                   FROM exam_archivos a WHERE a.intento_id = v_i.id AND a.pregunta_id = u.pid AND a.origen = 'RESPUESTA' AND a.estado = 'LISTO')) ORDER BY u.ord), '[]')
                FROM unnest(v_i.preguntas) WITH ORDINALITY u(pid, ord)
                JOIN exam_preguntas q ON q.id = u.pid
                LEFT JOIN exam_respuestas r ON r.intento_id = v_i.id AND r.pregunta_id = u.pid));
    END IF;

    IF v_i.estado <> 'INICIADO' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El examen todavía no ha empezado.');
    END IF;

    -- ===== guardar respuestas =====
    IF v_acc = 'guardar' THEN
        IF jsonb_typeof(p->'respuestas') <> 'array' OR jsonb_array_length(p->'respuestas') > 100 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Respuestas no válidas.');
        END IF;
        FOR v_x IN SELECT * FROM jsonb_array_elements(p->'respuestas') LOOP
            v_n := (v_x->>'n')::int;
            IF v_n IS NULL OR v_n < 1 OR v_n > cardinality(v_i.preguntas) THEN CONTINUE; END IF;
            v_pid := v_i.preguntas[v_n];
            INSERT INTO exam_respuestas (intento_id, pregunta_id, respuesta) VALUES (v_i.id, v_pid, left(coalesce(v_x->>'texto', ''), 20000))
            ON CONFLICT (intento_id, pregunta_id) DO UPDATE SET respuesta = EXCLUDED.respuesta, actualizada = now();
            v_ok := v_ok + 1;
        END LOOP;
        RETURN jsonb_build_object('ok', true, 'guardadas', v_ok, 'restante', v_rest);
    END IF;

    -- ===== eventos de la prueba =====
    IF v_acc = 'evento' THEN
        IF jsonb_typeof(p->'eventos') = 'array' AND jsonb_array_length(p->'eventos') <= 30
           AND (SELECT count(*) FROM exam_eventos WHERE intento_id = v_i.id) < 3000 THEN
            INSERT INTO exam_eventos (intento_id, tipo, detalle, segundos)
            SELECT v_i.id, x->>'tipo', left(x->>'detalle', 200), nullif(x->>'segundos', '')::int
              FROM jsonb_array_elements(p->'eventos') x WHERE x->>'tipo' = ANY (v_tipos);
        END IF;
        RETURN jsonb_build_object('ok', true, 'restante', v_rest);
    END IF;

    -- ===== captura de pantalla =====
    IF v_acc = 'captura' THEN
        IF (SELECT count(*) FROM exam_capturas WHERE intento_id = v_i.id) >= 120 THEN
            RETURN jsonb_build_object('ok', true, 'omitida', true, 'restante', v_rest);
        END IF;
        v_img := decode(regexp_replace(coalesce(p->>'imagen', ''), '^data:image/jpeg;base64,', ''), 'base64');
        IF length(v_img) < 100 OR length(v_img) > 250000 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Imagen no válida.');
        END IF;
        INSERT INTO exam_capturas (intento_id, motivo, imagen) VALUES (v_i.id, left(coalesce(p->>'motivo', ''), 60), v_img);
        RETURN jsonb_build_object('ok', true, 'restante', v_rest);
    END IF;

    -- ===== adjuntos: leer por partes lo adjunto a la pregunta o lo que subió la persona =====
    IF v_acc = 'archivo_parte' THEN
        SELECT * INTO v_a FROM exam_archivos WHERE id = (p->>'archivoId')::bigint AND estado = 'LISTO';
        IF NOT FOUND OR NOT (
               (v_a.origen = 'RESPUESTA' AND v_a.intento_id = v_i.id)
            OR (v_a.origen = 'PREGUNTA' AND EXISTS (SELECT 1 FROM exam_preguntas q WHERE q.id = ANY (v_i.preguntas) AND q.adjuntos @> jsonb_build_array(jsonb_build_object('id', v_a.id))))) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Archivo no disponible.');
        END IF;
        RETURN coalesce((SELECT jsonb_build_object('ok', true, 'nombre', v_a.nombre, 'mime', v_a.mime, 'tamano', v_a.tamano, 'partes', v_a.partes,
                    'datos', encode(x.datos, 'base64'), 'restante', v_rest)
                  FROM exam_archivo_partes x WHERE x.archivo_id = v_a.id AND x.n = (p->>'n')::int),
                jsonb_build_object('ok', false, 'error', 'Parte no encontrada.'));
    END IF;

    -- ===== adjuntos: subir un archivo a una respuesta (solo si el examen lo permite) =====
    IF v_acc = 'subir_inicio' THEN
        IF NOT v_e.permitir_adjuntos THEN RETURN jsonb_build_object('ok', false, 'error', 'Este examen no permite adjuntar archivos.'); END IF;
        v_n := (p->>'n')::int;
        IF v_n IS NULL OR v_n < 1 OR v_n > cardinality(v_i.preguntas) THEN RETURN jsonb_build_object('ok', false, 'error', 'Pregunta no válida.'); END IF;
        v_tam := (p->>'tamano')::bigint;
        IF coalesce(v_tam, 0) < 1 OR v_tam > 10485760 THEN RETURN jsonb_build_object('ok', false, 'error', 'El archivo debe pesar entre 1 byte y 10 MB.'); END IF;
        IF NOT historico.exam_mime_ok(p->>'mime') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo de archivo no permitido (usa imágenes, PDF, audio, video, texto o documentos de Office).'); END IF;
        IF (SELECT count(*) FROM exam_archivos WHERE intento_id = v_i.id AND pregunta_id = v_i.preguntas[v_n] AND origen = 'RESPUESTA') >= 3 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Máximo 3 archivos por pregunta.');
        END IF;
        IF (SELECT coalesce(sum(tamano), 0) FROM exam_archivos WHERE intento_id = v_i.id AND origen = 'RESPUESTA') + v_tam > 41943040 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Superaste el máximo de 40 MB de archivos en este examen.');
        END IF;
        INSERT INTO exam_archivos (origen, intento_id, pregunta_id, nombre, mime, tamano, partes)
        VALUES ('RESPUESTA', v_i.id, v_i.preguntas[v_n], historico.exam_nombre_archivo(p->>'nombre'), lower(p->>'mime'), v_tam, ceil(v_tam / 300000.0)::int)
        RETURNING * INTO v_a;
        RETURN jsonb_build_object('ok', true, 'archivoId', v_a.id, 'partes', v_a.partes, 'restante', v_rest);
    END IF;

    IF v_acc = 'subir_parte' THEN
        SELECT * INTO v_a FROM exam_archivos WHERE id = (p->>'archivoId')::bigint AND origen = 'RESPUESTA' AND intento_id = v_i.id AND estado = 'SUBIENDO';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Subida no válida.'); END IF;
        v_n := (p->>'n')::int;
        v_img := decode(coalesce(p->>'datos', ''), 'base64');
        IF v_n IS NULL OR v_n < 1 OR v_n > v_a.partes OR length(v_img) < 1 OR length(v_img) > 310000 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Parte no válida.');
        END IF;
        INSERT INTO exam_archivo_partes (archivo_id, n, datos) VALUES (v_a.id, v_n, v_img)
        ON CONFLICT (archivo_id, n) DO UPDATE SET datos = EXCLUDED.datos;
        RETURN jsonb_build_object('ok', true, 'restante', v_rest);
    END IF;

    IF v_acc = 'subir_fin' THEN
        SELECT * INTO v_a FROM exam_archivos WHERE id = (p->>'archivoId')::bigint AND origen = 'RESPUESTA' AND intento_id = v_i.id AND estado = 'SUBIENDO';
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Subida no válida.'); END IF;
        SELECT count(*), coalesce(sum(length(datos)), 0) INTO v_np, v_tam FROM exam_archivo_partes WHERE archivo_id = v_a.id;
        IF v_np <> v_a.partes OR v_tam <> v_a.tamano THEN
            DELETE FROM exam_archivos WHERE id = v_a.id;
            RETURN jsonb_build_object('ok', false, 'error', 'El archivo no llegó completo. Inténtalo de nuevo.');
        END IF;
        UPDATE exam_archivos SET estado = 'LISTO' WHERE id = v_a.id;
        RETURN jsonb_build_object('ok', true, 'restante', v_rest);
    END IF;

    IF v_acc = 'archivo_quitar' THEN
        DELETE FROM exam_archivos WHERE id = (p->>'archivoId')::bigint AND origen = 'RESPUESTA' AND intento_id = v_i.id;
        RETURN jsonb_build_object('ok', true, 'restante', v_rest);
    END IF;

    -- ===== entregar =====
    IF v_acc = 'entregar' THEN
        UPDATE exam_intentos SET estado = 'ENTREGADO', entregado_en = now(),
               motivo_cierre = CASE WHEN p->>'motivo' = 'tiempo' THEN 'tiempo' ELSE 'manual' END WHERE id = v_i.id;
        RETURN jsonb_build_object('ok', true, 'estado', 'ENTREGADO');
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
END $$;

REVOKE EXECUTE ON FUNCTION api.examen_publico(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.examen_publico(jsonb) TO tcontrol_anon, tcontrol_lector;

NOTIFY pgrst, 'reload schema';
