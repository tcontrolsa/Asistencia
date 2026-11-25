-- =====================================================================
-- TCONTROL · Evaluación de desempeño: recibida al abrir, feedback obligatorio, intervención y sesgo
-- (documento «SISTEMA DE EVALUACION» de Psicología Organizacional, 2026-11-24)
--
--  * Categorías nuevas con color, mensaje e «i» (requiere intervención inmediata: menos de 70 %).
--  * La evaluación queda RECIBIDA (estado 'confirmada') cuando el colaborador la abre; sin plazo.
--    El evaluador corrige hasta entonces; el admin master puede reabrirla (eval_reabrir 'corregir').
--  * Feedback obligatorio si requiere intervención o si cierra trimestre (mar, jun, sep, dic);
--    plazo plazos.feedbackDias (7). El evaluador marca la reunión realizada con los compromisos.
--  * Sesgo: todo en el valor más bajo o todo en el más alto → estado 'revision'; el colaborador no la
--    ve hasta que TTHH / Sup. Admin la apruebe (o la devuelva al evaluador: estado 'devuelta').
--  * Textos: mínimo 3 palabras y sin «no aplica».
--
-- Requiere 003, 006 y 007. Re-ejecutable.
-- =====================================================================
SET search_path = historico, public;

-- ---------------------------------------------------------------------
-- 1. Columnas y estados
-- ---------------------------------------------------------------------
ALTER TABLE historico.evaluaciones
    ADD COLUMN IF NOT EXISTS feedback_exigido boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS feedback_motivo  text,         -- 'intervencion' | 'trimestre'
    ADD COLUMN IF NOT EXISTS feedback_vence   date,
    ADD COLUMN IF NOT EXISTS feedback_en      timestamptz,  -- cuándo se registró la reunión realizada
    ADD COLUMN IF NOT EXISTS feedback_por     text,
    ADD COLUMN IF NOT EXISTS sesgo            jsonb,        -- {tipo, estado: revision|aprobada|devuelta, por, en, motivo}
    ADD COLUMN IF NOT EXISTS correccion_hasta date;
ALTER TABLE historico.evaluaciones DROP CONSTRAINT IF EXISTS evaluaciones_estado_check;
ALTER TABLE historico.evaluaciones ADD CONSTRAINT evaluaciones_estado_check
    CHECK (estado IN ('enviada', 'confirmada', 'revision', 'devuelta'));

-- ---------------------------------------------------------------------
-- 2. Reglas comunes
-- ---------------------------------------------------------------------
-- Umbral de intervención inmediata (cuestionario vigente; 70 %)
CREATE OR REPLACE FUNCTION historico.eval_umbral() RETURNS numeric
LANGUAGE sql STABLE AS $$ SELECT coalesce(((historico.eval_config_activa()).config->>'meta')::numeric, 0.70) $$;

-- ¿El feedback es obligatorio? 'intervencion', 'trimestre' (cierre de trimestre calendario) o NULL (opcional)
CREATE OR REPLACE FUNCTION historico.eval_feedback_motivo(tipo text, periodo text, pct numeric, cfg jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN pct < coalesce((cfg->>'meta')::numeric, 0.70) THEN 'intervencion'
                WHEN tipo = 'TRIMESTRAL' OR (tipo = 'MENSUAL' AND right(periodo, 2) IN ('03', '06', '09', '12')) THEN 'trimestre' END
$$;

-- Estado del feedback: 'realizada', 'agendada', 'pendiente' (obligatorio sin agendar) u 'opcional'
CREATE OR REPLACE FUNCTION historico.eval_feedback_estado(e historico.evaluaciones) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN e.feedback_en IS NOT NULL THEN 'realizada'
                WHEN e.reunion->>'estado' = 'agendada' THEN 'agendada'
                WHEN e.feedback_exigido THEN 'pendiente' ELSE 'opcional' END
$$;

-- Texto con sentido: 3 palabras o más (al menos 2 distintas) y que no sea «no aplica», «ninguno», «sin comentarios»…
-- La misma regla está en JS/evaluacion_desempeno.js (textoValido).
CREATE OR REPLACE FUNCTION historico.eval_texto_ok(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    WITH w AS (
        SELECT x FROM regexp_split_to_table(
            regexp_replace(translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g'), ' ') x
         WHERE x ~ '[a-z]')
    SELECT count(*) >= 3 AND count(DISTINCT x) >= 2
       AND coalesce(bool_or(x <> ALL (ARRAY['no','aplica','aplicable','n','a','na','corresponde','ninguno','ninguna','ningun','nada','sin',
           'observacion','observaciones','comentario','comentarios','novedad','novedades','hay','tengo','existe','existen',
           'en','este','esta','esto','caso','por','el','la','los','las','lo','de','del','al','para','momento','ahora','mes',
           'periodo','trimestre','item','pregunta','punto','criterio','su','cargo','se','es','que','y','o','un','una'])), false)
      FROM w
$$;

CREATE OR REPLACE FUNCTION historico.eval_validar_config(cfg jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    x       jsonb;
    v_suma  int := 0;
    v_dims  text[] := '{}';
    v_vals  int[] := '{}';
    v_n     int;
BEGIN
    IF jsonb_typeof(cfg) <> 'object' THEN RETURN 'Configuración no válida.'; END IF;
    IF jsonb_typeof(cfg->'dimensiones') <> 'array' OR jsonb_array_length(cfg->'dimensiones') = 0 OR jsonb_array_length(cfg->'dimensiones') > 12 THEN
        RETURN 'Define entre 1 y 12 dimensiones.';
    END IF;
    FOR x IN SELECT y FROM jsonb_array_elements(cfg->'dimensiones') y LOOP
        IF coalesce(x->>'k', '') !~ '^[a-z0-9_]{1,30}$' OR btrim(coalesce(x->>'t', '')) = '' THEN
            RETURN 'Cada dimensión necesita un nombre.';
        END IF;
        IF (x->>'k') = ANY (v_dims) THEN RETURN 'Hay dimensiones repetidas.'; END IF;
        v_dims := v_dims || (x->>'k');
    END LOOP;
    IF jsonb_typeof(cfg->'items') <> 'array' OR jsonb_array_length(cfg->'items') = 0 OR jsonb_array_length(cfg->'items') > 40 THEN
        RETURN 'Define entre 1 y 40 preguntas.';
    END IF;
    FOR x IN SELECT y FROM jsonb_array_elements(cfg->'items') y LOOP
        IF btrim(coalesce(x->>'c', '')) = '' OR length(x->>'c') > 120 THEN RETURN 'Cada pregunta necesita una competencia (máx. 120 caracteres).'; END IF;
        IF length(coalesce(x->>'m', '')) > 400 OR length(coalesce(x->>'d75', '')) > 400 OR length(coalesce(x->>'a', '')) > 400 THEN RETURN 'Las descripciones admiten hasta 400 caracteres.'; END IF;
        IF NOT ((x->>'dim') = ANY (v_dims)) THEN RETURN 'La pregunta "' || (x->>'c') || '" no tiene una dimensión válida.'; END IF;
        BEGIN v_n := (x->>'peso')::int; EXCEPTION WHEN others THEN v_n := NULL; END;
        IF v_n IS NULL OR v_n < 1 OR v_n > 100 THEN RETURN 'El peso de "' || (x->>'c') || '" debe ser un número entero de 1 a 100.'; END IF;
        v_suma := v_suma + v_n;
    END LOOP;
    IF v_suma <> 100 THEN RETURN 'Los pesos deben sumar 100 % (suman ' || v_suma || ' %).'; END IF;
    IF jsonb_typeof(cfg->'escala') <> 'array' OR jsonb_array_length(cfg->'escala') < 2 OR jsonb_array_length(cfg->'escala') > 10 THEN
        RETURN 'La escala debe tener entre 2 y 10 valores.';
    END IF;
    FOR x IN SELECT y FROM jsonb_array_elements(cfg->'escala') y LOOP
        BEGIN v_n := (x->>'v')::int; EXCEPTION WHEN others THEN v_n := NULL; END;
        IF v_n IS NULL OR v_n < 1 OR v_n = ANY (v_vals) OR btrim(coalesce(x->>'t', '')) = '' THEN
            RETURN 'Cada valor de la escala necesita un número distinto (desde 1) y un nombre.';
        END IF;
        v_vals := v_vals || v_n;
    END LOOP;
    IF jsonb_typeof(cfg->'niveles') <> 'array' OR jsonb_array_length(cfg->'niveles') = 0 THEN RETURN 'Define al menos un nivel.'; END IF;
    FOR x IN SELECT y FROM jsonb_array_elements(cfg->'niveles') y LOOP
        IF btrim(coalesce(x->>'n', '')) = '' OR (x->>'min') IS NULL OR (x->>'min')::numeric < 0 OR (x->>'min')::numeric > 1 THEN
            RETURN 'Cada nivel necesita un nombre y un mínimo entre 0 y 100 %.';
        END IF;
        IF coalesce(x->>'color', 'verde') NOT IN ('rojo', 'ambar', 'verde', 'azul') THEN RETURN 'Color de categoría no válido.'; END IF;
        IF length(coalesce(x->>'msg', '')) > 300 THEN RETURN 'El mensaje de cada categoría admite hasta 300 caracteres.'; END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'niveles') y WHERE (y->>'min')::numeric = 0) THEN
        RETURN 'Un nivel debe empezar en 0 % (el más bajo).';
    END IF;
    IF coalesce(cfg->>'frecuencia', 'MENSUAL') NOT IN ('MENSUAL', 'TRIMESTRAL') THEN RETURN 'La frecuencia debe ser mensual o trimestral.'; END IF;
    IF (cfg->>'meta') IS NULL OR (cfg->>'meta')::numeric <= 0 OR (cfg->>'meta')::numeric > 1 THEN RETURN 'La meta debe estar entre 1 y 100 %.'; END IF;
    IF coalesce((cfg->'plazos'->>'evaluarDia')::int, 0) NOT BETWEEN 1 AND 28 THEN RETURN 'El día límite para evaluar debe estar entre 1 y 28.'; END IF;
    IF coalesce((cfg->'plazos'->>'confirmarDias')::int, 0) NOT BETWEEN 1 AND 60 THEN RETURN 'Los días para confirmar deben estar entre 1 y 60.'; END IF;
    IF coalesce((cfg->'plazos'->>'vigenciaDias')::int, 0) NOT BETWEEN 7 AND 400 THEN RETURN 'La vigencia debe estar entre 7 y 400 días.'; END IF;
    IF coalesce((cfg->'plazos'->>'avisoDias')::int, -1) NOT BETWEEN 0 AND 15 THEN RETURN 'Los días de aviso deben estar entre 0 y 15.'; END IF;
    IF coalesce((cfg->'plazos'->>'feedbackDias')::int, 7) NOT BETWEEN 1 AND 60 THEN RETURN 'Los días para el feedback deben estar entre 1 y 60.'; END IF;
    IF length(cfg::text) > 60000 THEN RETURN 'La configuración es demasiado grande.'; END IF;
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION historico.eval_json(e historico.evaluaciones) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', e.id, 'tipo', e.tipo, 'periodo', e.periodo, 'fechaAplicacion', e.fecha_aplicacion,
        'empleadoId', e.empleado_id, 'empleadoNombre', e.empleado_nombre, 'area', e.area, 'cargo', e.cargo,
        'evaluadorId', e.evaluador_id, 'evaluadorNombre', e.evaluador_nombre,
        'calificaciones', to_jsonb(e.calificaciones), 'observaciones', to_jsonb(e.observaciones),
        'puntaje', e.puntaje, 'puntajeMaximo', e.puntaje_maximo, 'porcentaje', e.porcentaje,
        'nivel', e.nivel, 'dimensiones', e.dimensiones,
        'fortalezas', e.fortalezas, 'mejoras', e.mejoras, 'compromisos', e.compromisos,
        'proximaEvaluacion', e.proxima_evaluacion, 'estado', e.estado,
        'confirmadaEn', e.confirmada_en, 'comentarioColaborador', e.comentario_colaborador,
        'creadoEn', e.creado_en, 'actualizadoEn', e.actualizado_en,
        'configVersion', e.config_version, 'cuestionario', e.cuestionario,
        'meta', e.meta, 'cumpleMeta', (e.porcentaje >= coalesce(e.meta, 0.80)),
        'venceConfirmar', e.vence_confirmar,
        'confirmacionVencida', false,
        'sesgo', e.sesgo, 'correccionHasta', CASE WHEN e.correccion_hasta >= historico.eval_hoy() THEN e.correccion_hasta END,
        'feedback', jsonb_build_object('exigido', e.feedback_exigido, 'motivo', e.feedback_motivo, 'vence', e.feedback_vence,
            'realizadoEn', e.feedback_en, 'realizadoPor', e.feedback_por,
            'estado', historico.eval_feedback_estado(e),
            'vencido', (e.feedback_exigido AND e.feedback_en IS NULL AND e.feedback_vence IS NOT NULL AND e.feedback_vence < historico.eval_hoy())),
        'vigenteHasta', e.vigente_hasta,
        'vigente', (e.vigente_hasta IS NULL OR e.vigente_hasta >= historico.eval_hoy()),
        'reunion', e.reunion)
$$;

CREATE OR REPLACE FUNCTION historico.eval_params_sheets(e historico.evaluaciones) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'evaluacionId', e.id, 'tipo', e.tipo, 'periodo', e.periodo,
        'fechaAplicacion', to_char(e.fecha_aplicacion, 'YYYY-MM-DD'),
        'empleadoId', e.empleado_id, 'empleadoNombre', e.empleado_nombre, 'area', e.area, 'cargo', e.cargo,
        'evaluadorId', e.evaluador_id, 'evaluadorNombre', e.evaluador_nombre,
        'calificaciones', array_to_string(e.calificaciones, ','),
        'observaciones', to_jsonb(e.observaciones),
        'puntaje', e.puntaje, 'porcentaje', round(e.porcentaje * 100, 1), 'nivel', e.nivel,
        'dimensiones', e.dimensiones,
        'fortalezas', e.fortalezas, 'mejoras', e.mejoras, 'compromisos', e.compromisos,
        'proximaEvaluacion', to_char(e.proxima_evaluacion, 'YYYY-MM-DD'),
        'estado', e.estado,
        'confirmadaEn', to_char(e.confirmada_en AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD HH24:MI'),
        'comentarioColaborador', e.comentario_colaborador,
        'actualizadoEn', to_char(e.actualizado_en AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD HH24:MI'),
        'configVersion', e.config_version,
        'meta', round(coalesce(e.meta, 0.80) * 100, 1),
        'cumpleMeta', CASE WHEN e.porcentaje >= coalesce(e.meta, 0.80) THEN 'SI' ELSE 'NO' END,
        'venceConfirmar', to_char(e.vence_confirmar, 'YYYY-MM-DD'),
        'vigenteHasta', to_char(e.vigente_hasta, 'YYYY-MM-DD'),
        'reunion', CASE
            WHEN e.reunion->>'estado' = 'realizada' THEN 'Realizada ' || coalesce(e.reunion->>'realizadaEn', '')
            WHEN e.reunion->>'estado' = 'agendada' THEN 'Agendada ' || coalesce(e.reunion->>'fecha', '') || ' ' || coalesce(e.reunion->>'hora', '')
            WHEN e.reunion->>'estado' = 'solicitada' THEN 'Solicitada ' || left(coalesce(e.reunion->>'solicitadaEn', ''), 10)
            ELSE '' END,
        'feedback', CASE historico.eval_feedback_estado(e) WHEN 'realizada' THEN 'Realizado' WHEN 'agendada' THEN 'Agendado'
            WHEN 'pendiente' THEN 'Pendiente' ELSE 'Opcional' END,
        'feedbackVence', to_char(e.feedback_vence, 'YYYY-MM-DD'),
        'feedbackMotivo', coalesce(e.feedback_motivo, ''),
        'intervencion', CASE WHEN e.porcentaje < historico.eval_umbral() THEN 'SI' ELSE 'NO' END)
$$;

-- ---------------------------------------------------------------------
-- 3. Guardar (con validación de textos, feedback y sesgo)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.eval_guardar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c          jsonb := historico.eval_claims();
    v_yo       text := btrim(coalesce(c->>'empleado_id', ''));
    v_master   boolean := historico.eval_es_master(historico.eval_claims());
    v_eid      text := btrim(coalesce(p->>'empleadoId', ''));
    v_tipo     text := upper(btrim(coalesce(p->>'tipo', '')));
    v_periodo  text := btrim(coalesce(p->>'periodo', ''));
    v_cfgrow   historico.eval_config := historico.eval_config_activa();
    cfg        jsonb := v_cfgrow.config;
    v_items    jsonb := cfg->'items';
    v_nitems   int := jsonb_array_length(cfg->'items');
    v_escmax   int := (SELECT max((x->>'v')::int) FROM jsonb_array_elements(cfg->'escala') x);
    v_escmin   int := (SELECT min((x->>'v')::int) FROM jsonb_array_elements(cfg->'escala') x);
    v_meta     numeric := coalesce((cfg->>'meta')::numeric, 0.70);
    v_cal      smallint[] := '{}';
    v_obs      text[] := '{}';
    v_n        int;
    v_o        text;
    v_peso     int;
    v_dim      text;
    v_pts      int := 0;
    v_max      int := 0;
    v_dpts     jsonb := '{}';
    v_dmax     jsonb := '{}';
    v_pct      numeric;
    v_dims     jsonb := '{}';
    v_prev     historico.evaluaciones;
    v_ant      numeric;
    v_row      historico.evaluaciones;
    v_prox     date;
    v_limite   date;
    v_params   jsonb;
    d          jsonb;
    i          int;
    v_sesgo    boolean;
    v_motivo   text;
    v_campo    text;
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    IF v_eid = '' OR NOT coalesce(c->'equipo', '[]'::jsonb) ? v_eid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No eres el evaluador asignado de este colaborador.');
    END IF;
    IF v_eid = v_yo THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No puedes evaluarte a ti mismo.');
    END IF;
    IF v_tipo IN ('MENSUAL', 'TRIMESTRAL') THEN
        IF v_tipo = 'MENSUAL' AND v_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Mes evaluado no válido.');
        END IF;
        IF v_tipo = 'TRIMESTRAL' AND v_periodo !~ '^\d{4}-T[1-4]$' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Trimestre evaluado no válido.');
        END IF;
        -- Frecuencia vigente del cuestionario (se pueden corregir las ya registradas con la otra)
        IF v_tipo <> coalesce(cfg->>'frecuencia', 'MENSUAL')
           AND NOT EXISTS (SELECT 1 FROM evaluaciones WHERE tipo = v_tipo AND empleado_id = v_eid AND periodo = v_periodo) THEN
            RETURN jsonb_build_object('ok', false, 'error', CASE WHEN coalesce(cfg->>'frecuencia', 'MENSUAL') = 'TRIMESTRAL'
                THEN 'Por ahora las evaluaciones son trimestrales.' ELSE 'Por ahora las evaluaciones son mensuales.' END, 'configCambio', true);
        END IF;
    ELSIF v_tipo = 'DIA75' THEN
        v_periodo := 'DIA75';
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'Tipo de evaluación no válido.');
    END IF;
    -- El formulario se armó con otra versión del cuestionario
    IF nullif(p->>'configVersion', '') IS NOT NULL AND (p->>'configVersion')::int <> v_cfgrow.version THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El cuestionario de evaluación cambió mientras lo llenabas. Vuelve a abrir el formulario.', 'configCambio', true);
    END IF;
    -- Plazo para evaluar el mes (el admin master puede reabrirlo)
    v_limite := historico.eval_limite_evaluar(v_periodo, cfg);
    IF v_tipo <> 'DIA75' AND v_limite < historico.eval_hoy() AND NOT v_master
       AND NOT historico.eval_reabierta('evaluar', v_eid, v_periodo) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El plazo para evaluar ' || v_periodo || ' venció el ' || to_char(v_limite, 'DD/MM/YYYY')
            || '. Pide al administrador que lo reabra.', 'plazoVencido', true);
    END IF;

    IF jsonb_typeof(p->'calificaciones') <> 'array' OR jsonb_array_length(p->'calificaciones') <> v_nitems THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Responde los ' || v_nitems || ' comportamientos.');
    END IF;
    FOR i IN 1..v_nitems LOOP
        BEGIN
            v_n := (p->'calificaciones'->>(i - 1))::int;
        EXCEPTION WHEN others THEN v_n := NULL;
        END;
        IF v_n IS NULL OR v_n < v_escmin OR v_n > v_escmax THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Calificación no válida en el ítem ' || i || '.');
        END IF;
        v_o := left(btrim(coalesce(p->'observaciones'->>(i - 1), '')), 200);
        IF coalesce(cfg->'obligatoriaObs', '[]'::jsonb) @> to_jsonb(v_n) AND v_o = '' THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'El ítem ' || i || ' tiene calificación ' || v_n || ': escribe una observación que la sustente.');
        END IF;
        IF v_o <> '' AND NOT historico.eval_texto_ok(v_o) THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'La observación del ítem ' || i || ' necesita al menos 3 palabras y no admite «no aplica».');
        END IF;
        v_peso := (v_items->(i - 1)->>'peso')::int;
        v_dim := v_items->(i - 1)->>'dim';
        v_cal := v_cal || v_n::smallint;
        v_obs := v_obs || v_o;
        v_pts := v_pts + v_peso * v_n;
        v_max := v_max + v_peso * v_escmax;
        v_dpts := jsonb_set(v_dpts, ARRAY[v_dim], to_jsonb(coalesce((v_dpts->>v_dim)::int, 0) + v_peso * v_n));
        v_dmax := jsonb_set(v_dmax, ARRAY[v_dim], to_jsonb(coalesce((v_dmax->>v_dim)::int, 0) + v_peso * v_escmax));
    END LOOP;
    FOREACH v_campo IN ARRAY ARRAY['fortalezas', 'mejoras', 'compromisos'] LOOP
        IF btrim(coalesce(p->>v_campo, '')) <> '' AND NOT historico.eval_texto_ok(p->>v_campo) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'En ' || CASE v_campo WHEN 'fortalezas' THEN 'Fortalezas observadas'
                WHEN 'mejoras' THEN 'Oportunidades de mejora' ELSE 'Compromisos' END
                || ' escribe al menos 3 palabras; no se admite «no aplica».');
        END IF;
    END LOOP;
    v_pct := round(v_pts::numeric / v_max, 4);
    -- Sesgo: todas las calificaciones en el mismo extremo → la revisa TTHH antes de que la vea el colaborador
    v_sesgo := v_escmin = ALL (v_cal) OR v_escmax = ALL (v_cal);
    v_motivo := historico.eval_feedback_motivo(v_tipo, v_periodo, v_pct, cfg);
    FOR d IN SELECT x FROM jsonb_array_elements(cfg->'dimensiones') x LOOP
        CONTINUE WHEN coalesce((v_dmax->>(d->>'k'))::int, 0) = 0;
        v_dims := v_dims || jsonb_build_object(d->>'k', jsonb_build_object(
            'puntaje', (v_dpts->>(d->>'k'))::int, 'maximo', (v_dmax->>(d->>'k'))::int,
            'porcentaje', round((v_dpts->>(d->>'k'))::numeric / (v_dmax->>(d->>'k'))::int, 4),
            'nivel', historico.eval_nivel_cfg(round((v_dpts->>(d->>'k'))::numeric / (v_dmax->>(d->>'k'))::int, 4), cfg)));
    END LOOP;
    BEGIN
        v_prox := nullif(p->>'proximaEvaluacion', '')::date;
    EXCEPTION WHEN others THEN v_prox := NULL;
    END;

    -- Mismo orden de bloqueo que la sincronización y las ediciones de archivados
    LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;

    SELECT * INTO v_prev FROM evaluaciones
     WHERE tipo = v_tipo AND empleado_id = v_eid AND periodo = v_periodo FOR UPDATE;
    IF FOUND AND v_prev.estado = 'confirmada' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El colaborador ya recibió esta evaluación; no se puede modificar. Pide al administrador que la reabra.');
    END IF;

    BEGIN
    INSERT INTO evaluaciones AS e (tipo, periodo, empleado_id, empleado_nombre, area, cargo,
        evaluador_id, evaluador_nombre, calificaciones, observaciones, puntaje, puntaje_maximo,
        porcentaje, nivel, dimensiones, fortalezas, mejoras, compromisos, proxima_evaluacion,
        config_version, cuestionario, meta, vigente_hasta,
        estado, sesgo, feedback_exigido, feedback_motivo, feedback_vence)
    VALUES (v_tipo, v_periodo, v_eid, left(p->>'empleadoNombre', 120), left(p->>'area', 80), left(p->>'cargo', 120),
        v_yo, left(p->>'evaluadorNombre', 120), v_cal, v_obs, v_pts, v_max, v_pct, historico.eval_nivel_cfg(v_pct, cfg), v_dims,
        left(btrim(coalesce(p->>'fortalezas', '')), 500), left(btrim(coalesce(p->>'mejoras', '')), 500),
        left(btrim(coalesce(p->>'compromisos', '')), 500), v_prox,
        v_cfgrow.version, jsonb_build_object('dimensiones', cfg->'dimensiones', 'items', cfg->'items', 'escala', cfg->'escala'),
        v_meta, historico.eval_hoy() + coalesce((cfg->'plazos'->>'vigenciaDias')::int, 45),
        CASE WHEN v_sesgo THEN 'revision' ELSE 'enviada' END,
        CASE WHEN v_sesgo THEN jsonb_build_object('tipo', CASE WHEN v_escmax = ALL (v_cal) THEN 'maximo' ELSE 'minimo' END,
            'estado', 'revision', 'desde', clock_timestamp()) END,
        v_motivo IS NOT NULL, v_motivo,
        CASE WHEN v_motivo IS NOT NULL AND NOT v_sesgo THEN historico.eval_hoy() + coalesce((cfg->'plazos'->>'feedbackDias')::int, 7) END)
    ON CONFLICT (tipo, empleado_id, periodo) DO UPDATE SET
        empleado_nombre = EXCLUDED.empleado_nombre, area = EXCLUDED.area, cargo = EXCLUDED.cargo,
        evaluador_id = EXCLUDED.evaluador_id, evaluador_nombre = EXCLUDED.evaluador_nombre,
        calificaciones = EXCLUDED.calificaciones, observaciones = EXCLUDED.observaciones,
        puntaje = EXCLUDED.puntaje, puntaje_maximo = EXCLUDED.puntaje_maximo, porcentaje = EXCLUDED.porcentaje,
        nivel = EXCLUDED.nivel, dimensiones = EXCLUDED.dimensiones, fortalezas = EXCLUDED.fortalezas,
        mejoras = EXCLUDED.mejoras, compromisos = EXCLUDED.compromisos, proxima_evaluacion = EXCLUDED.proxima_evaluacion,
        config_version = EXCLUDED.config_version, cuestionario = EXCLUDED.cuestionario, meta = EXCLUDED.meta,
        vence_confirmar = NULL, vigente_hasta = EXCLUDED.vigente_hasta,
        estado = EXCLUDED.estado, sesgo = EXCLUDED.sesgo, correccion_hasta = NULL, confirmada_en = NULL,
        feedback_exigido = EXCLUDED.feedback_exigido, feedback_motivo = EXCLUDED.feedback_motivo,
        feedback_vence = CASE WHEN e.feedback_en IS NULL THEN EXCLUDED.feedback_vence ELSE e.feedback_vence END,
        fecha_aplicacion = historico.eval_hoy(),
        actualizado_en = clock_timestamp()
    RETURNING * INTO v_row;

    v_params := historico.eval_params_sheets(v_row);
    IF historico.largo_url(v_params::text) > 7000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'eval_textos_largos';
    END IF;
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'eval_textos_largos' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Los comentarios son demasiado largos; acórtalos un poco.');
        END IF;
        RAISE;
    END;
    -- Alerta a RR.HH.: requiere intervención (bajo el umbral) o caída de 10 pts frente a la evaluación anterior
    SELECT porcentaje INTO v_ant FROM evaluaciones
     WHERE empleado_id = v_eid AND id <> v_row.id
       AND (CASE WHEN periodo = 'DIA75' THEN '0000' ELSE periodo END) < (CASE WHEN v_periodo = 'DIA75' THEN '0000' ELSE v_periodo END)
     ORDER BY (CASE WHEN periodo = 'DIA75' THEN '0000' ELSE periodo END) DESC LIMIT 1;
    v_params := v_params || jsonb_build_object(
        'evento', CASE WHEN v_sesgo THEN 'sesgo_revision'
                       WHEN v_prev.id IS NULL OR v_prev.estado IN ('revision', 'devuelta') THEN 'enviada' ELSE 'corregida' END,
        'alerta', NOT v_sesgo AND (v_row.porcentaje < v_meta OR (v_ant IS NOT NULL AND v_row.porcentaje - v_ant <= -0.10)));
    INSERT INTO cambios_pendientes (accion, params) VALUES ('guardarEvaluacion', v_params);
    RETURN jsonb_build_object('ok', true, 'enRevision', v_sesgo, 'evaluacion', historico.eval_json(v_row));
END $$;

-- ---------------------------------------------------------------------
-- 4. Recibida al abrir (y comentario opcional del colaborador)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.eval_confirmar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c       jsonb := historico.eval_claims();
    v_yo    text := btrim(coalesce(c->>'empleado_id', ''));
    v_com   text := left(btrim(coalesce(p->>'comentario', '')), 500);
    v_id    bigint;
    v_corr  boolean;
    v_prev  historico.evaluaciones;
    v_row   historico.evaluaciones;
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    BEGIN v_id := (p->>'id')::bigint; EXCEPTION WHEN others THEN v_id := NULL; END;
    LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;
    SELECT * INTO v_prev FROM evaluaciones
     WHERE id = v_id AND empleado_id = v_yo AND estado IN ('enviada', 'confirmada') FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Evaluación no encontrada.'); END IF;
    IF v_com <> '' AND NOT historico.eval_texto_ok(v_com) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'En tu comentario escribe al menos 3 palabras.');
    END IF;
    v_corr := coalesce(v_prev.correccion_hasta >= historico.eval_hoy(), false);   -- reabierta para corregir
    IF v_com = '' AND (v_prev.estado = 'confirmada' OR v_corr) THEN
        RETURN jsonb_build_object('ok', true, 'evaluacion', historico.eval_json(v_prev));
    END IF;
    UPDATE evaluaciones SET
           estado = CASE WHEN v_corr THEN estado ELSE 'confirmada' END,
           confirmada_en = CASE WHEN v_corr THEN confirmada_en ELSE coalesce(confirmada_en, clock_timestamp()) END,
           comentario_colaborador = CASE WHEN v_com <> '' THEN v_com ELSE comentario_colaborador END,
           actualizado_en = clock_timestamp()
     WHERE id = v_id RETURNING * INTO v_row;
    INSERT INTO cambios_pendientes (accion, params)
    VALUES ('guardarEvaluacion', historico.eval_params_sheets(v_row)
        || jsonb_build_object('evento', CASE WHEN v_com <> '' THEN 'comentario' ELSE 'recibida' END));
    RETURN jsonb_build_object('ok', true, 'evaluacion', historico.eval_json(v_row));
END $$;

-- ---------------------------------------------------------------------
-- 5. Listar, reabrir y reunión
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.eval_listar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c        jsonb := historico.eval_claims();
    v_yo     text := btrim(coalesce(c->>'empleado_id', ''));
    v_modo   text := coalesce(p->>'modo', 'mias');
    v_per    text := nullif(btrim(coalesce(p->>'periodo', '')), '');
    v_desde  text := nullif(btrim(coalesce(p->>'desde', '')), '');
    v_eid    text := nullif(btrim(coalesce(p->>'empleadoId', '')), '');
    v_res    jsonb;
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    IF v_modo = 'todas' AND coalesce(c->>'rrhh', '') <> 'true' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sin permiso para ver todas las evaluaciones.');
    END IF;
    SELECT coalesce(jsonb_agg(historico.eval_json(e) ORDER BY e.periodo DESC, e.empleado_nombre), '[]')
      INTO v_res
      FROM evaluaciones e
     WHERE CASE v_modo
               WHEN 'mias'   THEN e.empleado_id = v_yo AND e.estado NOT IN ('revision', 'devuelta')
               WHEN 'equipo' THEN e.evaluador_id = v_yo
                                  OR coalesce(c->'equipo', '[]'::jsonb) ? e.empleado_id
               -- Nadie ve su propia evaluación mientras TTHH la revisa
               WHEN 'todas'  THEN NOT (e.empleado_id = v_yo AND e.estado IN ('revision', 'devuelta'))
               ELSE false END
       AND (v_per IS NULL OR e.periodo = v_per)
       AND (v_desde IS NULL OR e.periodo = 'DIA75' OR e.periodo >= v_desde)
       AND (v_eid IS NULL OR e.empleado_id = v_eid);
    RETURN jsonb_build_object('ok', true, 'evaluaciones', v_res);
END $$;

CREATE OR REPLACE FUNCTION api.eval_reabrir(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c       jsonb := historico.eval_claims();
    v_yo    text := btrim(coalesce(c->>'empleado_id', ''));
    v_dias  int;
    v_id    bigint;
    v_row   historico.evaluaciones;
    v_mot   text := left(btrim(coalesce(p->>'motivo', '')), 300);
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    IF NOT historico.eval_es_master(c) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Solo el administrador puede reabrir plazos.');
    END IF;
    BEGIN v_dias := (p->>'dias')::int; EXCEPTION WHEN others THEN v_dias := NULL; END;
    IF v_dias IS NULL OR v_dias < 1 OR v_dias > 60 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Indica de 1 a 60 días.');
    END IF;
    IF p->>'tipo' = 'evaluar' THEN
        IF coalesce(p->>'periodo', '') !~ '^\d{4}-((0[1-9]|1[0-2])|T[1-4])$' OR btrim(coalesce(p->>'empleadoId', '')) = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Colaborador o período no válido.');
        END IF;
        INSERT INTO eval_reaperturas (tipo, empleado_id, periodo, hasta, motivo, creado_por)
        VALUES ('evaluar', btrim(p->>'empleadoId'), p->>'periodo', historico.eval_hoy() + v_dias, nullif(v_mot, ''), v_yo);
        RETURN jsonb_build_object('ok', true, 'hasta', historico.eval_hoy() + v_dias);
    ELSIF p->>'tipo' = 'corregir' THEN
        -- El evaluador puede corregir una evaluación ya recibida; mientras tanto, abrirla no la vuelve a marcar
        BEGIN v_id := (p->>'id')::bigint; EXCEPTION WHEN others THEN v_id := NULL; END;
        LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;
        UPDATE evaluaciones SET estado = 'enviada', confirmada_en = NULL, correccion_hasta = historico.eval_hoy() + v_dias,
               actualizado_en = clock_timestamp()
         WHERE id = v_id AND estado IN ('enviada', 'confirmada') RETURNING * INTO v_row;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Evaluación no encontrada.'); END IF;
        IF v_row.tipo <> 'DIA75' THEN
            INSERT INTO eval_reaperturas (tipo, empleado_id, periodo, hasta, motivo, creado_por)
            VALUES ('evaluar', v_row.empleado_id, v_row.periodo, historico.eval_hoy() + v_dias, nullif(v_mot, ''), v_yo);
        END IF;
        INSERT INTO cambios_pendientes (accion, params)
        VALUES ('guardarEvaluacion', historico.eval_params_sheets(v_row) || jsonb_build_object('evento', 'correccion_abierta',
            'correccionHasta', to_char(v_row.correccion_hasta, 'YYYY-MM-DD')));
        RETURN jsonb_build_object('ok', true, 'evaluacion', historico.eval_json(v_row));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo no válido.');
END $$;

CREATE OR REPLACE FUNCTION api.eval_reunion(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c        jsonb := historico.eval_claims();
    v_yo     text := btrim(coalesce(c->>'empleado_id', ''));
    v_id     bigint;
    v_row    historico.evaluaciones;
    v_reu    jsonb;
    v_fecha  date;
    v_hora   text := btrim(coalesce(p->>'hora', ''));
    v_lugar  text := left(btrim(coalesce(p->>'lugar', '')), 150);
    v_evento text;
    v_comp   text := left(btrim(coalesce(p->>'compromisos', '')), 500);
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    BEGIN v_id := (p->>'id')::bigint; EXCEPTION WHEN others THEN v_id := NULL; END;
    LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;
    SELECT * INTO v_row FROM evaluaciones WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Evaluación no encontrada.'); END IF;
    IF v_row.estado IN ('revision', 'devuelta') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'La evaluación está en revisión de TTHH.');
    END IF;
    v_reu := coalesce(v_row.reunion, '{}');

    IF p->>'accion' = 'solicitar' THEN
        IF v_row.empleado_id <> v_yo THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Solo el colaborador evaluado puede pedir la reunión.');
        END IF;
        IF v_reu->>'estado' = 'agendada' AND (v_reu->>'fecha')::date >= historico.eval_hoy() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Ya tienes una reunión agendada para esta evaluación.');
        END IF;
        v_reu := jsonb_build_object('estado', 'solicitada', 'solicitadaEn', clock_timestamp(),
            'motivo', left(btrim(coalesce(p->>'motivo', '')), 300));
        v_evento := 'reunion_solicitada';
    ELSIF p->>'accion' = 'agendar' THEN
        IF v_row.evaluador_id <> v_yo AND NOT coalesce(c->'equipo', '[]'::jsonb) ? v_row.empleado_id THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Solo el evaluador puede agendar la reunión.');
        END IF;
        BEGIN v_fecha := (p->>'fecha')::date; EXCEPTION WHEN others THEN v_fecha := NULL; END;
        IF v_fecha IS NULL OR v_fecha < historico.eval_hoy() OR v_fecha > historico.eval_hoy() + 120 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Elige una fecha desde hoy y dentro de los próximos 4 meses.');
        END IF;
        IF v_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Indica la hora de la reunión.');
        END IF;
        IF v_lugar = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Indica el lugar o el enlace de la reunión.');
        END IF;
        v_reu := v_reu || jsonb_build_object('estado', 'agendada', 'fecha', v_fecha, 'hora', v_hora, 'lugar', v_lugar,
            'nota', left(btrim(coalesce(p->>'nota', '')), 300), 'agendadaPor', v_yo, 'agendadaEn', clock_timestamp());
        v_evento := 'reunion_agendada';
    ELSIF p->>'accion' = 'realizar' THEN
        -- Feedback hecho: el evaluador registra la fecha y los compromisos (obligatorios si requiere intervención)
        IF v_row.evaluador_id <> v_yo AND NOT coalesce(c->'equipo', '[]'::jsonb) ? v_row.empleado_id THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Solo el evaluador puede registrar la reunión.');
        END IF;
        BEGIN v_fecha := (p->>'fecha')::date; EXCEPTION WHEN others THEN v_fecha := NULL; END;
        IF v_fecha IS NULL OR v_fecha > historico.eval_hoy() OR v_fecha < v_row.fecha_aplicacion THEN
            RETURN jsonb_build_object('ok', false, 'error', 'La fecha de la reunión debe estar entre el ' || to_char(v_row.fecha_aplicacion, 'DD/MM/YYYY') || ' y hoy.');
        END IF;
        IF v_comp = '' AND v_row.porcentaje < historico.eval_umbral() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Registra los compromisos acordados: son obligatorios con un resultado que requiere intervención.');
        END IF;
        IF v_comp <> '' AND NOT historico.eval_texto_ok(v_comp) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'En Compromisos escribe al menos 3 palabras; no se admite «no aplica».');
        END IF;
        v_reu := v_reu || jsonb_build_object('estado', 'realizada', 'realizadaEn', v_fecha, 'registradaPor', v_yo);
        UPDATE evaluaciones SET feedback_en = clock_timestamp(), feedback_por = v_yo,
               compromisos = CASE WHEN v_comp <> '' THEN v_comp ELSE compromisos END WHERE id = v_row.id;
        v_evento := 'feedback_realizado';
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
    END IF;

    UPDATE evaluaciones SET reunion = v_reu, actualizado_en = clock_timestamp() WHERE id = v_row.id RETURNING * INTO v_row;
    INSERT INTO cambios_pendientes (accion, params)
    VALUES ('guardarEvaluacion', historico.eval_params_sheets(v_row) || jsonb_build_object('evento', v_evento,
        'reunionFecha', v_reu->>'fecha', 'reunionHora', v_reu->>'hora', 'reunionLugar', v_reu->>'lugar',
        'reunionMotivo', left(coalesce(v_reu->>'motivo', ''), 150)));
    RETURN jsonb_build_object('ok', true, 'evaluacion', historico.eval_json(v_row));
END $$;

-- ---------------------------------------------------------------------
-- 6. Revisión por sesgo: TTHH / Sup. Admin (claim rrhh); nunca la propia ni la que uno mismo hizo
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.eval_sesgo(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = historico, public AS $$
DECLARE
    c       jsonb := historico.eval_claims();
    v_yo    text := btrim(coalesce(c->>'empleado_id', ''));
    v_id    bigint;
    v_mot   text := left(btrim(coalesce(p->>'motivo', '')), 300);
    v_acc   text := coalesce(p->>'accion', '');
    v_cfg   jsonb := (historico.eval_config_activa()).config;
    v_row   historico.evaluaciones;
BEGIN
    IF coalesce(c->>'eval', '') <> 'true' OR v_yo = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Sesión de evaluación no válida. Vuelve a confirmar tu PIN.');
    END IF;
    IF coalesce(c->>'rrhh', '') <> 'true' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Solo TTHH y los supervisores administradores revisan estas evaluaciones.');
    END IF;
    BEGIN v_id := (p->>'id')::bigint; EXCEPTION WHEN others THEN v_id := NULL; END;
    LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;
    SELECT * INTO v_row FROM evaluaciones WHERE id = v_id AND estado = 'revision' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'La evaluación ya no está en revisión.'); END IF;
    IF v_yo IN (v_row.evaluador_id, v_row.empleado_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No puedes revisar una evaluación tuya o hecha por ti: debe revisarla otra persona.');
    END IF;
    IF v_acc = 'aprobar' THEN
        UPDATE evaluaciones SET estado = 'enviada', actualizado_en = clock_timestamp(),
               sesgo = sesgo || jsonb_build_object('estado', 'aprobada', 'por', v_yo, 'en', clock_timestamp(), 'motivo', v_mot),
               feedback_vence = CASE WHEN feedback_exigido AND feedback_en IS NULL
                   THEN historico.eval_hoy() + coalesce((v_cfg->'plazos'->>'feedbackDias')::int, 7) ELSE feedback_vence END
         WHERE id = v_row.id RETURNING * INTO v_row;
        INSERT INTO cambios_pendientes (accion, params)
        VALUES ('guardarEvaluacion', historico.eval_params_sheets(v_row) || jsonb_build_object('evento', 'enviada', 'sesgoAprobada', true,
            'alerta', v_row.porcentaje < historico.eval_umbral()));
    ELSIF v_acc = 'devolver' THEN
        IF NOT historico.eval_texto_ok(v_mot) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Explica al evaluador qué debe revisar (al menos 3 palabras).');
        END IF;
        UPDATE evaluaciones SET estado = 'devuelta', actualizado_en = clock_timestamp(),
               sesgo = sesgo || jsonb_build_object('estado', 'devuelta', 'por', v_yo, 'en', clock_timestamp(), 'motivo', v_mot)
         WHERE id = v_row.id RETURNING * INTO v_row;
        -- Puede corregirla aunque el plazo del período haya vencido
        IF v_row.tipo <> 'DIA75' THEN
            INSERT INTO eval_reaperturas (tipo, empleado_id, periodo, hasta, motivo, creado_por)
            VALUES ('evaluar', v_row.empleado_id, v_row.periodo,
                    historico.eval_hoy() + coalesce((v_cfg->'plazos'->>'feedbackDias')::int, 7), 'Devuelta por TTHH (sesgo)', v_yo);
        END IF;
        INSERT INTO cambios_pendientes (accion, params)
        VALUES ('guardarEvaluacion', historico.eval_params_sheets(v_row) || jsonb_build_object('evento', 'sesgo_devuelta'));
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'Acción no válida.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'evaluacion', historico.eval_json(v_row));
END $$;

REVOKE EXECUTE ON FUNCTION api.eval_sesgo(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.eval_sesgo(jsonb) TO tcontrol_lector;

-- ---------------------------------------------------------------------
-- 7. Cuestionario: categorías, escala, mensajes y aclaración de conceptos (una sola vez)
-- ---------------------------------------------------------------------
INSERT INTO historico.eval_config (config, creado_por, comentario)
SELECT a.config || $cfg${
  "meta": 0.70,
  "niveles": [
    {"min": 0.90, "n": "Supera las expectativas de desempeño", "color": "azul", "msg": "Desempeño sobresaliente, aplica innovación, genera valor adicional en sus actividades y puede servir de referente para otros."},
    {"min": 0.80, "n": "Cumple plenamente lo esperado", "color": "verde", "msg": "Mantener desempeño, requiere apoyo esporádico y existen oportunidades de desarrollo."},
    {"min": 0.70, "n": "Cumple lo esperado en términos generales", "color": "verde", "msg": "Requiere apoyo y/o supervisión ocasional, y existen oportunidades de desarrollo."},
    {"min": 0.60, "n": "En desarrollo", "color": "ambar", "i": true, "msg": "Existen oportunidades de mejora."},
    {"min": 0, "n": "Requiere intervención", "color": "rojo", "i": true, "msg": "Plan de mejora y acompañamiento."}
  ],
  "escala": [
    {"v": 1, "t": "Requiere intervención", "d": "Plan de mejora y acompañamiento."},
    {"v": 2, "t": "En desarrollo", "d": "Existen oportunidades de mejora."},
    {"v": 3, "t": "Cumple lo esperado en términos generales", "d": "Requiere apoyo y/o supervisión ocasional, y existen oportunidades de desarrollo."},
    {"v": 4, "t": "Cumple plenamente lo esperado", "d": "Mantener desempeño, requiere apoyo esporádico y existen oportunidades de desarrollo."},
    {"v": 5, "t": "Supera las expectativas de desempeño", "d": "Desempeño sobresaliente, aplica innovación, genera valor adicional en sus actividades y puede servir de referente para otros."}
  ],
  "recomendaciones": {
    "Requiere intervención": "Solicita a tu evaluador una reunión de feedback para establecer planes de mejora.",
    "En desarrollo": "Solicita a tu evaluador una reunión de feedback para establecer tus oportunidades y compromisos.",
    "Cumple lo esperado en términos generales": "Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre tus oportunidades de desarrollo.",
    "Cumple plenamente lo esperado": "Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre tus oportunidades de desarrollo.",
    "Supera las expectativas de desempeño": "Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre los proyectos innovadores que estás llevando a cabo y en los que necesitas apoyo."
  }
}$cfg$::jsonb
  || jsonb_build_object(
       'plazos', coalesce(a.config->'plazos', '{}') || '{"feedbackDias": 7}',
       'items', (SELECT jsonb_agg(x || CASE x->>'c'
            WHEN 'Aplicación de procedimientos' THEN '{"a": "Métodos, pasos, flujos e instrucciones de trabajo para ejecutar una actividad."}'::jsonb
            WHEN 'Calidad técnica del trabajo' THEN '{"a": "Exactitud, integridad y conformidad del entregable frente a requisitos definidos."}'::jsonb
            WHEN 'Cumplimiento de resultados y plazos' THEN '{"a": "Logro de objetivos y entregables comprometidos dentro de fechas y condiciones acordadas."}'::jsonb
            WHEN 'Cumplimiento normativo' THEN '{"a": "Obligaciones legales, regulatorias, contractuales y políticas internas aplicables."}'::jsonb
            ELSE '{}'::jsonb END ORDER BY n)
          FROM jsonb_array_elements(a.config->'items') WITH ORDINALITY t(x, n))),
  'SISTEMA', 'Documento SISTEMA DE EVALUACION: categorías, colores, escala, conceptos y feedback'
  FROM historico.eval_config_activa() a
 WHERE NOT EXISTS (SELECT 1 FROM historico.eval_config
                    WHERE comentario = 'Documento SISTEMA DE EVALUACION: categorías, colores, escala, conceptos y feedback');

-- ---------------------------------------------------------------------
-- 8. Vigencia desde octubre 2026: feedback pendiente en las menores a 70 % (plazo desde hoy) y sin plazo de confirmación
-- ---------------------------------------------------------------------
UPDATE historico.evaluaciones SET
    feedback_exigido = true, feedback_motivo = 'intervencion',
    feedback_vence = historico.eval_hoy() + 7
 WHERE feedback_motivo IS NULL AND porcentaje < 0.70 AND estado IN ('enviada', 'confirmada')
   AND ((tipo = 'MENSUAL' AND periodo >= '2026-10') OR (tipo = 'DIA75' AND fecha_aplicacion >= DATE '2026-10-01'));
UPDATE historico.evaluaciones SET vence_confirmar = NULL WHERE estado = 'enviada' AND vence_confirmar IS NOT NULL;

NOTIFY pgrst, 'reload schema';
