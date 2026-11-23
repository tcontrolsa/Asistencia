-- =====================================================================
-- TCONTROL · Plataforma de evaluación técnica · fase 3: adjuntos
--
-- Dos usos:
--   * El evaluador adjunta material a una pregunta (imagen, audio, video, PDF, documento) o un enlace https
--     (YouTube, Drive, SharePoint…). El evaluado lo ve dentro de la pregunta.
--   * Si el examen lo permite, el evaluado adjunta archivos a sus respuestas (hasta 3 por pregunta,
--     10 MB cada uno, 40 MB por examen) y el evaluador los revisa.
-- Los archivos se guardan en PostgreSQL en partes de 300 KB (exam_archivo_partes) y se suben y bajan por
-- partes, así pasan por PostgREST y por el respaldo de Apps Script. Hasta 25 MB por archivo de pregunta.
-- Tipos permitidos: imágenes (sin SVG), PDF, audio, video, texto y documentos de Office. Nada ejecutable.
--
-- La parte pública (api.examen_publico) está en 020_examen_publico.sql.
-- Requiere 019_examenes.sql. Aplicar en orden 019, 021, 020. Re-ejecutable.
-- =====================================================================
SET search_path = historico, public;

CREATE TABLE IF NOT EXISTS historico.exam_archivos (
    id          bigserial PRIMARY KEY,
    origen      text NOT NULL CHECK (origen IN ('PREGUNTA', 'RESPUESTA')),
    propietario text,                                   -- evaluador dueño (origen PREGUNTA)
    intento_id  bigint REFERENCES historico.exam_intentos (id) ON DELETE CASCADE,   -- origen RESPUESTA
    pregunta_id bigint,
    nombre      text NOT NULL,
    mime        text NOT NULL,
    tamano      bigint NOT NULL CHECK (tamano > 0),
    partes      int NOT NULL,
    estado      text NOT NULL DEFAULT 'SUBIENDO' CHECK (estado IN ('SUBIENDO', 'LISTO')),
    creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_archivos_intento ON historico.exam_archivos (intento_id, pregunta_id);
CREATE TABLE IF NOT EXISTS historico.exam_archivo_partes (
    archivo_id  bigint NOT NULL REFERENCES historico.exam_archivos (id) ON DELETE CASCADE,
    n           int NOT NULL,
    datos       bytea NOT NULL,
    PRIMARY KEY (archivo_id, n)
);
REVOKE ALL ON historico.exam_archivos, historico.exam_archivo_partes FROM PUBLIC, tcontrol_lector, tcontrol_anon;

CREATE OR REPLACE FUNCTION historico.exam_mime_ok(m text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(coalesce(m, '')) ~ '^(image/(jpeg|png|gif|webp|bmp)|application/pdf|audio/(mpeg|mp3|mp4|x-m4a|m4a|wav|x-wav|webm|ogg|aac)|video/(mp4|webm|quicktime|ogg)|text/plain|application/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)|application/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$'
$$;

-- Nombre sin rutas ni caracteres raros, máximo 120
CREATE OR REPLACE FUNCTION historico.exam_nombre_archivo(n text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(nullif(left(regexp_replace(regexp_replace(coalesce(n, ''), '^.*[\\/]', ''), '[^[:alnum:] ._()\-]', '_', 'g'), 120), ''), 'archivo')
$$;

-- ---------------------------------------------------------------------
-- Lado del evaluador (mismo permiso que api.examenes)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.examenes_archivos(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    v_yo     text := historico.exam_evaluador();
    v_master boolean := coalesce(historico.eval_claims()->>'master', '') = 'true';
    v_acc    text := coalesce(p->>'accion', '');
    v_q      historico.exam_preguntas;
    v_a      historico.exam_archivos;
    v_tam    bigint;
    v_np     int;
    v_img    bytea;
    v_n      int;
BEGIN
    IF v_yo IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No tienes permiso de evaluador.'); END IF;

    -- ===== material de una pregunta: subir un archivo =====
    IF v_acc IN ('subir_inicio', 'enlace_agregar', 'adjunto_quitar') THEN
        SELECT * INTO v_q FROM exam_preguntas WHERE id = (p->>'preguntaId')::bigint AND (v_master OR propietario = v_yo) FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pregunta no encontrada.'); END IF;
    END IF;

    IF v_acc = 'subir_inicio' THEN
        v_tam := (p->>'tamano')::bigint;
        IF coalesce(v_tam, 0) < 1 OR v_tam > 26214400 THEN RETURN jsonb_build_object('ok', false, 'error', 'El archivo debe pesar entre 1 byte y 25 MB.'); END IF;
        IF NOT historico.exam_mime_ok(p->>'mime') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo de archivo no permitido (imágenes, PDF, audio, video, texto o documentos de Office).'); END IF;
        IF jsonb_array_length(v_q.adjuntos) >= 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'Máximo 5 adjuntos por pregunta.'); END IF;
        INSERT INTO exam_archivos (origen, propietario, pregunta_id, nombre, mime, tamano, partes)
        VALUES ('PREGUNTA', v_q.propietario, v_q.id, historico.exam_nombre_archivo(p->>'nombre'), lower(p->>'mime'), v_tam, ceil(v_tam / 300000.0)::int)
        RETURNING * INTO v_a;
        RETURN jsonb_build_object('ok', true, 'archivoId', v_a.id, 'partes', v_a.partes);
    END IF;

    IF v_acc IN ('subir_parte', 'subir_fin') THEN
        SELECT * INTO v_a FROM exam_archivos WHERE id = (p->>'archivoId')::bigint AND origen = 'PREGUNTA' AND estado = 'SUBIENDO' AND (v_master OR propietario = v_yo);
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Subida no válida.'); END IF;
        IF v_acc = 'subir_parte' THEN
            v_n := (p->>'n')::int;
            v_img := decode(coalesce(p->>'datos', ''), 'base64');
            IF v_n IS NULL OR v_n < 1 OR v_n > v_a.partes OR length(v_img) < 1 OR length(v_img) > 310000 THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Parte no válida.');
            END IF;
            INSERT INTO exam_archivo_partes (archivo_id, n, datos) VALUES (v_a.id, v_n, v_img)
            ON CONFLICT (archivo_id, n) DO UPDATE SET datos = EXCLUDED.datos;
            RETURN jsonb_build_object('ok', true);
        END IF;
        SELECT count(*), coalesce(sum(length(datos)), 0) INTO v_np, v_tam FROM exam_archivo_partes WHERE archivo_id = v_a.id;
        IF v_np <> v_a.partes OR v_tam <> v_a.tamano THEN
            DELETE FROM exam_archivos WHERE id = v_a.id;
            RETURN jsonb_build_object('ok', false, 'error', 'El archivo no llegó completo. Inténtalo de nuevo.');
        END IF;
        UPDATE exam_archivos SET estado = 'LISTO' WHERE id = v_a.id;
        UPDATE exam_preguntas SET actualizado_en = now(),
               adjuntos = adjuntos || jsonb_build_array(jsonb_build_object('tipo', 'archivo', 'id', v_a.id, 'nombre', v_a.nombre, 'mime', v_a.mime, 'tamano', v_a.tamano))
         WHERE id = v_a.pregunta_id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== enlace (solo https) =====
    IF v_acc = 'enlace_agregar' THEN
        IF coalesce(p->>'url', '') !~* '^https://[^\s]{4,250}$' THEN RETURN jsonb_build_object('ok', false, 'error', 'Escribe un enlace que empiece con https://'); END IF;
        IF jsonb_array_length(v_q.adjuntos) >= 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'Máximo 5 adjuntos por pregunta.'); END IF;
        UPDATE exam_preguntas SET actualizado_en = now(),
               adjuntos = adjuntos || jsonb_build_array(jsonb_build_object('tipo', 'enlace', 'url', btrim(p->>'url'), 'titulo', left(btrim(coalesce(p->>'titulo', '')), 80)))
         WHERE id = v_q.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== quitar un adjunto (por su posición) =====
    IF v_acc = 'adjunto_quitar' THEN
        v_n := (p->>'indice')::int;
        IF v_n IS NULL OR v_n < 0 OR v_n >= jsonb_array_length(v_q.adjuntos) THEN RETURN jsonb_build_object('ok', false, 'error', 'Adjunto no encontrado.'); END IF;
        IF v_q.adjuntos->v_n->>'tipo' = 'archivo' THEN DELETE FROM exam_archivos WHERE id = (v_q.adjuntos->v_n->>'id')::bigint AND origen = 'PREGUNTA'; END IF;
        UPDATE exam_preguntas SET adjuntos = adjuntos - v_n, actualizado_en = now() WHERE id = v_q.id;
        RETURN jsonb_build_object('ok', true);
    END IF;

    -- ===== bajar un archivo por partes (material propio o lo que subió un evaluado de mis exámenes) =====
    IF v_acc = 'archivo_parte' THEN
        SELECT a.* INTO v_a FROM exam_archivos a
         WHERE a.id = (p->>'archivoId')::bigint AND a.estado = 'LISTO'
           AND (v_master
                OR (a.origen = 'PREGUNTA' AND a.propietario = v_yo)
                OR (a.origen = 'RESPUESTA' AND EXISTS (SELECT 1 FROM exam_intentos i JOIN exam_examenes e ON e.id = i.examen_id
                                                        WHERE i.id = a.intento_id AND e.propietario = v_yo)));
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Archivo no encontrado.'); END IF;
        RETURN coalesce((SELECT jsonb_build_object('ok', true, 'nombre', v_a.nombre, 'mime', v_a.mime, 'tamano', v_a.tamano, 'partes', v_a.partes, 'datos', encode(x.datos, 'base64'))
                  FROM exam_archivo_partes x WHERE x.archivo_id = v_a.id AND x.n = (p->>'n')::int),
                jsonb_build_object('ok', false, 'error', 'Parte no encontrada.'));
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
END $$;

REVOKE EXECUTE ON FUNCTION api.examenes_archivos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.examenes_archivos(jsonb) TO tcontrol_lector;

NOTIFY pgrst, 'reload schema';
