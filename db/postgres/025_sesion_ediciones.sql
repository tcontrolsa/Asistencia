-- TCONTROL · Seguridad fase 2: editar días archivados exige sesión (2026-11-25)
--
-- 1. Cada cambio que entra a la cola va firmado por la base (params.colaId y params.firma). sync-historico reenvía los
--    parámetros tal cual y Apps Script comprueba la firma: el servidor de la oficina no cambia.
--    La clave está en historico.secretos ('cola'); la carga db/etl/probar_sesion_ediciones.py (no va en el repositorio).
-- 2. api.encolar_cambio_archivado pasa a ser la puerta con permisos; la lógica de siempre queda en
--    historico.encolar_cambio_archivado_base. Si una migración futura redefine api.encolar_cambio_archivado (como 011 y
--    023), debe redefinir historico.encolar_cambio_archivado_base o se perderían los permisos.
-- 3. El token (emitirTokenHistorico, Apps Script) trae: sesion, uid, rol, gestor, tthh.
--
-- Re-ejecutable. Volver atrás: ver el final.

CREATE TABLE IF NOT EXISTS historico.secretos (
    nombre         text PRIMARY KEY,
    valor          text NOT NULL,
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON historico.secretos FROM PUBLIC;

CREATE OR REPLACE FUNCTION historico.firma_cola(p_id bigint, p_accion text, p_params jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'historico', 'public' AS $$
    SELECT encode(sha256(convert_to(s.valor || '|' || p_id || '|' || p_accion || '|' ||
                  coalesce(p_params->>'empleadoId', '') || '|' || coalesce(p_params->>'fecha', '') || '|' || s.valor, 'UTF8')), 'hex')
    FROM historico.secretos s WHERE s.nombre = 'cola'
$$;
REVOKE EXECUTE ON FUNCTION historico.firma_cola(bigint, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION historico.firmar_cola() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'historico', 'public' AS $$
DECLARE v_firma text := historico.firma_cola(NEW.id, NEW.accion, NEW.params);
BEGIN
    IF v_firma IS NOT NULL THEN
        NEW.params := NEW.params || jsonb_build_object('colaId', NEW.id::text, 'firma', v_firma);
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION historico.firmar_cola() FROM PUBLIC;

DROP TRIGGER IF EXISTS firmar_cola ON historico.cambios_pendientes;
CREATE TRIGGER firmar_cola BEFORE INSERT ON historico.cambios_pendientes
    FOR EACH ROW EXECUTE FUNCTION historico.firmar_cola();

-- Lo que ya estaba esperando también se firma
UPDATE historico.cambios_pendientes c
SET params = c.params || jsonb_build_object('colaId', c.id::text, 'firma', historico.firma_cola(c.id, c.accion, c.params))
WHERE c.estado = 'pendiente' AND historico.firma_cola(c.id, c.accion, c.params) IS NOT NULL;

-- La lógica actual pasa a historico (una sola vez)
DO $$
BEGIN
    IF to_regprocedure('historico.encolar_cambio_archivado_base(jsonb)') IS NULL THEN
        ALTER FUNCTION api.encolar_cambio_archivado(jsonb) SET SCHEMA historico;
        ALTER FUNCTION historico.encolar_cambio_archivado(jsonb) RENAME TO encolar_cambio_archivado_base;
    END IF;
END $$;
REVOKE EXECUTE ON FUNCTION historico.encolar_cambio_archivado_base(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION historico.encolar_cambio_archivado_base(jsonb) FROM tcontrol_lector;

-- Gestor (master, admin o supervisor): todo, como hasta hoy.
-- Los demás: solo registrar una ausencia en un día sin marcaciones (protegerMarcaciones = 'SI') propio, de su gente
-- (jefe inmediato o evaluador, al aprobar un permiso) o si es de TTHH.
CREATE OR REPLACE FUNCTION api.encolar_cambio_archivado(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'historico', 'public' AS $$
DECLARE
    c     jsonb := historico.eval_claims();
    v_uid text := btrim(coalesce(c->>'uid', ''));
    v_eid text := btrim(coalesce(p->>'empleadoId', ''));
BEGIN
    IF coalesce(c->>'sesion', '') <> 'true' OR v_uid = '' THEN
        RETURN jsonb_build_object('ok', false, 'sesion', true,
            'error', 'Tu sesión de seguridad no está activa. Recarga la página y confirma tu contraseña.');
    END IF;
    IF coalesce(c->>'gestor', '') <> 'true' AND NOT coalesce(
           p->>'accion' = 'actualizarRegistroArchivado'
       AND p->>'campo' = 'justificado'
       AND upper(coalesce(p->>'protegerMarcaciones', '')) = 'SI'
       AND upper(btrim(coalesce(p->>'tipo', ''))) NOT IN
           ('', 'ENTRADA', 'SALIDA', 'ENTRADA_CAMPO', 'SALIDA_CAMPO', 'RETORNO_CAMPO', 'SALIDA_PASANTE')
       AND (v_eid = v_uid OR coalesce(c->>'tthh', '') = 'true' OR EXISTS (
               SELECT 1 FROM historico.empleados e
               WHERE e.id = v_eid AND v_uid IN (coalesce(e.jefe_inmediato_id, ''), coalesce(e.evaluador_id, '')))), false) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No tienes permiso para cambiar este registro.');
    END IF;
    RETURN historico.encolar_cambio_archivado_base((p - 'firma' - 'colaId') || jsonb_build_object('sesionUid', v_uid));
END $$;
REVOKE EXECUTE ON FUNCTION api.encolar_cambio_archivado(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.encolar_cambio_archivado(jsonb) TO tcontrol_lector;

NOTIFY pgrst, 'reload schema';

-- Volver atrás (solo los permisos; la firma puede quedarse):
--   DROP FUNCTION api.encolar_cambio_archivado(jsonb);
--   ALTER FUNCTION historico.encolar_cambio_archivado_base(jsonb) RENAME TO encolar_cambio_archivado;
--   ALTER FUNCTION historico.encolar_cambio_archivado(jsonb) SET SCHEMA api;
--   GRANT EXECUTE ON FUNCTION api.encolar_cambio_archivado(jsonb) TO tcontrol_lector; NOTIFY pgrst, 'reload schema';
