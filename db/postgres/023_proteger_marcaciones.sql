-- TCONTROL · Ediciones de archivados: proteger las marcaciones (2026-11-23)
--
-- Caso: «Justificar Asistencias» de la app convertía la ENTRADA o la SALIDA de un día trabajado en FALTA 00:00.
-- Ahora, si llega protegerMarcaciones = 'SI' (o el formato antiguo de la app: tipo FALTA con razón 'FALTA') y el día
-- tiene marcaciones que no son autocompletadas, se rechaza. Mismo cambio en Apps Script (actualizarRegistroArchivado).
-- Los cambios que un supervisor hace desde Gestionar jornada siguen igual.
-- Re-ejecutable: redefine api.encolar_cambio_archivado a partir de la definición vigente (011).

CREATE OR REPLACE FUNCTION api.encolar_cambio_archivado(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'historico', 'public'
AS $function$
DECLARE
    v_accion   text := p->>'accion';
    v_eid      text := btrim(coalesce(p->>'empleadoId', ''));
    v_fecha    date := historico.fecha_param(p->>'fecha');
    v_tipo     text := upper(btrim(coalesce(p->>'tipo', '')));
    v_campo    text := coalesce(p->>'campo', '');
    v_valor    text := p->>'valor';
    v_obj      bigint;
    v_hora     time;
    v_f2       date;
    v_ts       text;
    v_col      text;
    v_n        integer := 0;
    v_mins     integer;
    v_resp     jsonb := jsonb_build_object('ok', true);
    v_id       bigint;
BEGIN
    -- Primero el bloqueo de la cola (mismo orden que la sincronización): evita interbloqueos
    -- y que una sincronización en curso pise este cambio.
    LOCK TABLE cambios_pendientes IN ROW EXCLUSIVE MODE;

    IF v_accion NOT IN ('actualizarRegistroArchivado', 'guardarPermisoSupervisor', 'eliminarRegistroArchivado') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Acción no permitida: ' || coalesce(v_accion, ''));
    END IF;
    IF v_eid = '' OR v_fecha IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Faltan parámetros empleadoId o fecha');
    END IF;

    -- ------------------------------------------------------------- eliminar
    IF v_accion = 'eliminarRegistroArchivado' THEN
        IF v_tipo IN ('', 'TODOS') THEN
            DELETE FROM marcaciones WHERE hoja_origen = 'REGISTROS' AND empleado_id = v_eid AND fecha = v_fecha;
            GET DIAGNOSTICS v_n = ROW_COUNT;
        ELSE
            DELETE FROM marcaciones WHERE id = (
                SELECT id FROM marcaciones
                WHERE hoja_origen = 'REGISTROS' AND empleado_id = v_eid AND fecha = v_fecha AND tipo = v_tipo
                ORDER BY id DESC LIMIT 1);
            GET DIAGNOSTICS v_n = ROW_COUNT;
        END IF;
        DELETE FROM marcaciones WHERE hoja_origen = 'VACACIONES' AND empleado_id = v_eid AND fecha = v_fecha;
        GET DIAGNOSTICS v_mins = ROW_COUNT;
        v_resp := jsonb_build_object('ok', true, 'eliminados', v_n + v_mins);

    -- ------------------------------------------------------------- permisos
    ELSIF v_accion = 'guardarPermisoSupervisor' THEN
        IF coalesce(p->>'mins', '') !~ '^\s*\d+' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Parámetros inválidos.');
        END IF;
        v_mins := substring(p->>'mins' FROM '\d+')::int;
        SELECT id INTO v_obj FROM marcaciones
        WHERE hoja_origen = 'REGISTROS' AND empleado_id = v_eid AND fecha = v_fecha
        ORDER BY (tipo = 'ENTRADA') DESC, id DESC LIMIT 1;
        IF v_obj IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'error', format('No se encontró registro para empleado %s en %s.', v_eid, v_fecha));
        END IF;
        v_tipo := lower(btrim(coalesce(p->>'tipo', '')));
        UPDATE marcaciones SET
            permiso_personal_mins   = CASE WHEN v_tipo = 'personal' THEN v_mins ELSE permiso_personal_mins END,
            permiso_medico_mins     = CASE WHEN v_tipo = 'medico' THEN v_mins ELSE permiso_medico_mins END,
            tiempo_justificado_mins = CASE WHEN v_tipo NOT IN ('personal', 'medico') THEN v_mins ELSE tiempo_justificado_mins END,
            razon_permiso           = CASE WHEN p ? 'comentario' THEN btrim(coalesce(p->>'comentario', '')) ELSE razon_permiso END
        WHERE id = v_obj;

    -- ------------------------------------------------------------- actualizar
    ELSE
        -- Ausencia declarada desde la app: un día con marcaciones reales no se convierte en ausencia.
        IF v_campo = 'justificado'
           AND (p->>'protegerMarcaciones' = 'SI'
                OR (v_tipo = 'FALTA' AND upper(btrim(coalesce(p->>'razon_justificac', ''))) = 'FALTA'))
           AND EXISTS (SELECT 1 FROM marcaciones x
                       WHERE x.hoja_origen = 'REGISTROS' AND x.empleado_id = v_eid AND x.fecha = v_fecha
                         AND x.tipo IN ('ENTRADA','SALIDA','ENTRADA_CAMPO','SALIDA_CAMPO','RETORNO_CAMPO','SALIDA_PASANTE')
                         AND upper(coalesce(x.dispositivo, '')) <> 'AUTO_COMPLETAR') THEN
            RETURN jsonb_build_object('ok', false, 'tieneMarcaciones', true,
                                      'error', format('El día %s tiene marcaciones registradas: no se convierte en ausencia.', v_fecha));
        END IF;

        SELECT id INTO v_obj FROM marcaciones m
        WHERE m.hoja_origen = 'REGISTROS' AND m.empleado_id = v_eid AND m.fecha = v_fecha
          -- Hora de ENTRADA/SALIDA: solo una fila del mismo tipo o una ausencia del día (se convierte).
          -- Antes, sin fila del tipo, tomaba cualquiera: la SALIDA pisaba la hora de la ENTRADA.
          AND NOT (v_campo IN ('timestamp', 'hora') AND v_tipo <> ''
                   AND m.tipo <> v_tipo
                   AND NOT (m.tipo IN ('ENTRADA', 'ENTRADA_CAMPO', 'RETORNO_CAMPO') AND v_tipo IN ('ENTRADA', 'ENTRADA_CAMPO'))
                   AND NOT (historico.es_ausencia(m.tipo) OR m.tipo = 'FALTA'))
        ORDER BY (v_tipo = '' OR m.tipo = v_tipo
                  OR (m.tipo IN ('ENTRADA', 'ENTRADA_CAMPO', 'RETORNO_CAMPO') AND v_tipo IN ('ENTRADA', 'ENTRADA_CAMPO'))) DESC,
                 m.id DESC
        LIMIT 1;

        -- Hora / timestamp: valor 'DD/MM/YYYY HH:MM:SS' (timestamp) o 'HH:MM[:SS]' (hora)
        IF v_campo IN ('timestamp', 'hora') THEN
            v_f2 := CASE WHEN v_campo = 'timestamp' THEN coalesce(historico.fecha_param(v_valor), v_fecha) ELSE v_fecha END;
            v_hora := historico.hora_param(v_valor);
            IF v_hora IS NULL THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Formato de hora inválido: ' || coalesce(v_valor, ''));
            END IF;
            v_ts := to_char(v_f2, 'DD/MM/YYYY') || ' ' || to_char(v_hora, 'HH24:MI:SS');
            v_resp := jsonb_build_object('ok', true, 'timestamp', v_ts,
                                         'fecha', to_char(v_f2, 'YYYY-MM-DD'), 'hora', to_char(v_hora, 'HH24:MI:SS'));
        END IF;

        IF v_obj IS NULL THEN
            IF NOT (v_campo IN ('hora', 'timestamp', 'justificado') OR v_tipo = 'JUSTIFICACION') THEN
                RETURN jsonb_build_object('ok', false, 'error', 'No se encontró el registro a actualizar');
            END IF;
            INSERT INTO marcaciones (legacy_hash, hoja_origen, fecha, empleado_id, nombre, tipo, almuerzo, hora,
                                     ts_original, dia, modo, horas_extra, quien_justifica, razon_permiso, justificado,
                                     razon_justificac, permiso_personal_mins, permiso_medico_mins, tiempo_justificado_mins)
            SELECT 'pendiente:' || gen_random_uuid(), 'REGISTROS', coalesce(v_f2, v_fecha), v_eid,
                   coalesce((SELECT nombre FROM empleados WHERE id = v_eid), v_eid),
                   coalesce(nullif(v_tipo, ''), 'JUSTIFICACION'),
                   coalesce(nullif(p->>'almuerzo', ''), 'NO'),
                   coalesce(v_hora, '00:00:00'),
                   coalesce(v_ts, to_char(v_fecha, 'DD/MM/YYYY') || ' 00:00:00'),
                   historico.dia_es(coalesce(v_f2, v_fecha)),
                   coalesce(nullif(p->>'modo', ''), 'EMPRESA'),
                   coalesce(nullif(p->>'horasExtra', ''), 'NO'),
                   CASE WHEN v_campo = 'justificado' OR v_tipo = 'JUSTIFICACION' THEN p->>'quien_justifica' END,
                   p->>'razon_permiso',
                   CASE WHEN v_campo = 'justificado' OR v_tipo = 'JUSTIFICACION' THEN 'SI' END,
                   CASE WHEN v_campo = 'justificado' OR v_tipo = 'JUSTIFICACION' THEN p->>'razon_justificac' END,
                   coalesce(substring(p->>'permiso_personal_mins' FROM '\d+')::int, 0),
                   coalesce(substring(p->>'permiso_medico_mins' FROM '\d+')::int, 0),
                   coalesce(substring(p->>'tiempo_justificado_mins' FROM '\d+')::int, 0);

        ELSIF v_campo IN ('timestamp', 'hora') THEN
            UPDATE marcaciones SET
                fecha = v_f2, hora = v_hora, ts_original = v_ts, dia = historico.dia_es(v_f2),
                tipo  = CASE WHEN v_tipo <> '' AND (historico.es_ausencia(tipo) OR tipo = 'FALTA') THEN v_tipo ELSE tipo END,
                modo        = coalesce(nullif(p->>'modo', ''), modo),
                almuerzo    = coalesce(nullif(p->>'almuerzo', ''), almuerzo),
                horas_extra = coalesce(nullif(p->>'horasExtra', ''), horas_extra)
            WHERE id = v_obj;

        ELSIF v_campo = 'justificado' THEN
            UPDATE marcaciones SET
                tipo             = coalesce(nullif(v_tipo, ''), tipo),
                hora             = '00:00:00',
                justificado      = 'SI',
                quien_justifica  = coalesce(nullif(p->>'quien_justifica', ''), quien_justifica),
                razon_justificac = coalesce(nullif(coalesce(p->>'razon_justificac', p->>'razon_ausencia'), ''), razon_justificac),
                modo             = coalesce(nullif(p->>'modo', ''), modo)
            WHERE id = v_obj;

        ELSE
            v_col := CASE v_campo
                WHEN 'almuerzo' THEN 'almuerzo'
                WHEN 'modo' THEN 'modo' WHEN 'ubicacion' THEN 'modo' WHEN 'modalidad' THEN 'modo'
                WHEN 'horasExtra' THEN 'horas_extra'
                WHEN 'tipo' THEN 'tipo'
                WHEN 'razon_entrada_tardia' THEN 'razon_entrada_tardia'
                WHEN 'razon_salida' THEN 'razon_salida_temprana'
                WHEN 'permiso_personal_mins' THEN 'permiso_personal_mins'
                WHEN 'permiso_medico_mins' THEN 'permiso_medico_mins'
                WHEN 'tiempo_justificado_mins' THEN 'tiempo_justificado_mins'
                WHEN 'razon_permiso' THEN 'razon_permiso'
                WHEN 'razon_ausencia' THEN 'razon_justificac'
                WHEN 'autoriza' THEN 'autoriza'  -- "SUPERVISOR: nombre" al autorizar extras desde el panel
            END;
            IF v_col IS NULL THEN
                RETURN jsonb_build_object('ok', false, 'error', 'Campo no mapeado para Sheets');
            END IF;
            IF v_col LIKE '%_mins' THEN
                EXECUTE format('UPDATE marcaciones SET %I = $1 WHERE id = $2', v_col)
                    USING coalesce(substring(v_valor FROM '\d+')::int, 0), v_obj;
            ELSE
                EXECUTE format('UPDATE marcaciones SET %I = $1 WHERE id = $2', v_col)
                    USING CASE WHEN v_col = 'tipo' THEN upper(btrim(v_valor)) ELSE v_valor END, v_obj;
            END IF;
            UPDATE marcaciones SET
                tipo             = CASE WHEN v_col <> 'tipo' AND v_tipo <> '' THEN v_tipo ELSE tipo END,
                hora             = CASE WHEN v_col = 'tipo' AND historico.es_ausencia(v_valor) THEN '00:00:00' ELSE hora END,
                modo             = CASE WHEN v_col <> 'modo' THEN coalesce(nullif(p->>'modo', ''), modo) ELSE modo END,
                almuerzo         = CASE WHEN v_col <> 'almuerzo' THEN coalesce(nullif(p->>'almuerzo', ''), almuerzo) ELSE almuerzo END,
                horas_extra      = CASE WHEN v_col <> 'horas_extra' THEN coalesce(nullif(p->>'horasExtra', ''), horas_extra) ELSE horas_extra END,
                razon_justificac = coalesce(nullif(coalesce(p->>'razon_justificac', p->>'razon_ausencia'), ''), razon_justificac),
                quien_justifica  = coalesce(nullif(p->>'quien_justifica', ''), quien_justifica)
            WHERE id = v_obj;
        END IF;
    END IF;

    INSERT INTO cambios_pendientes (accion, params) VALUES (v_accion, p) RETURNING id INTO v_id;
    RETURN v_resp || jsonb_build_object('encolado', v_id);
END $function$;

NOTIFY pgrst, 'reload schema';
