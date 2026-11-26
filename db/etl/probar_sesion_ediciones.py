"""
Prueba 025_sesion_ediciones.sql contra la base real DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE
(empleados ficticios T9xx; no deja nada).

    python db/etl/probar_sesion_ediciones.py              # prueba (revierte todo)
    python db/etl/probar_sesion_ediciones.py --firmar     # solo la firma de la cola (paso 1, no cambia permisos)
    python db/etl/probar_sesion_ediciones.py --aplicar    # firma y permisos (paso 3, con la app ya publicada)
"""
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

SQL = Path(__file__).resolve().parent.parent / "postgres" / "025_sesion_ediciones.sql"
CORTE = "-- La lógica actual pasa a historico (una sola vez)"
fallos = 0


def check(nombre, ok, detalle=None):
    global fallos
    fallos += not ok
    print(("  OK  " if ok else "  FALLA ") + nombre + ("" if ok else f" → {detalle}"))


def clave_cola():
    secreto = os.environ.get("PGRST_JWT_SECRET")
    if not secreto:
        sys.exit("Falta PGRST_JWT_SECRET en db/.env")
    return hmac.new(secreto.encode(), b"cola-apps-script", hashlib.sha256).hexdigest()


def preparar(cur, solo_firma=False):
    texto = SQL.read_text(encoding="utf-8")
    assert CORTE in texto
    if solo_firma:
        texto = texto.split(CORTE)[0]
    # La clave antes que el resto: lo que ya espera en la cola se firma en la misma transacción
    ini = texto.index("CREATE TABLE IF NOT EXISTS historico.secretos")
    fin = texto.index("CREATE OR REPLACE FUNCTION historico.firma_cola")
    cur.execute(texto[ini:fin])
    cur.execute("INSERT INTO historico.secretos (nombre, valor) VALUES ('cola', %s) "
                "ON CONFLICT (nombre) DO UPDATE SET valor = excluded.valor, actualizado_en = now()", (clave_cola(),))
    cur.execute(texto)


def main():
    leer_env_local()
    if "--aplicar" in sys.argv or "--firmar" in sys.argv:
        with conectar() as con, con.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '10s'")
            preparar(cur, solo_firma="--firmar" in sys.argv)
            con.commit()
        print("025 aplicado:", "solo la firma de la cola" if "--firmar" in sys.argv else "firma y permisos")
        return

    k = clave_cola()
    with conectar() as con, con.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout = '5s'")
        preparar(cur, solo_firma=True)
        preparar(cur)
        preparar(cur)   # re-ejecutable

        cur.execute("""INSERT INTO historico.empleados (id, nombre, activo, jefe_inmediato_id, evaluador_id, raw) VALUES
                       ('T901','PRUEBA UNO',true,'T910',NULL,'{}'), ('T902','PRUEBA DOS',true,NULL,'T911','{}')""")
        for f in ("2026-01-05", "2026-01-06"):
            cur.execute("INSERT INTO historico.marcaciones (legacy_hash, hoja_origen, empleado_id, nombre, fecha, tipo, hora) "
                        "VALUES (%s,'REGISTROS','T901','PRUEBA UNO',%s,'ENTRADA','07:30')", ("prueba-" + f, f))

        def como(**claims):
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "tcontrol_lector", **claims}),))
            cur.execute("SET LOCAL ROLE tcontrol_lector")

        def rpc(p):
            cur.execute("SAVEPOINT s")
            try:
                cur.execute("SELECT api.encolar_cambio_archivado(%s::jsonb)", (json.dumps(p),))
                return cur.fetchone()[0]
            except Exception as e:
                cur.execute("ROLLBACK TO SAVEPOINT s")
                return {"ok": False, "error": str(e)}

        def ultimo():
            cur.execute("RESET ROLE")
            cur.execute("SELECT id, accion, params FROM historico.cambios_pendientes ORDER BY id DESC LIMIT 1")
            return cur.fetchone()

        def sesion(uid, **x):
            como(sesion=True, uid=uid, **x)

        hora = {"accion": "actualizarRegistroArchivado", "empleadoId": "T901", "fecha": "2026-01-05", "tipo": "ENTRADA",
                "campo": "timestamp", "valor": "05/01/2026 07:45:00"}
        permiso = {"accion": "guardarPermisoSupervisor", "empleadoId": "T901", "fecha": "2026-01-05", "tipo": "personal", "mins": "30"}
        borrar = {"accion": "eliminarRegistroArchivado", "empleadoId": "T901", "fecha": "2026-01-06", "tipo": "ENTRADA"}
        falta = {"accion": "actualizarRegistroArchivado", "empleadoId": "T901", "fecha": "2026-01-08", "tipo": "PERMISO_MEDICO",
                 "campo": "justificado", "valor": "SI", "razon_justificac": "cita", "quien_justifica": "Colaborador (app)",
                 "protegerMarcaciones": "SI"}

        print("token sin sesión")
        for nombre, claims in (("token antiguo", {"empleado_id": "T901"}), ("sesion falsa sin uid", {"sesion": True}),
                               ("gestor sin sesion", {"gestor": True, "uid": "T901"}), ("token de evaluación", {"eval": True, "empleado_id": "1058", "master": True})):
            como(**claims)
            check(f"{nombre}: no edita", all(rpc(p).get("sesion") for p in (hora, permiso, borrar, falta)))

        print("gestor")
        sesion("T920", gestor=True, rol="supervisor")
        r = rpc(hora)
        check("cambia una hora", r.get("ok") is True, r)
        i, a, p = ultimo()
        esperada = hashlib.sha256(f"{k}|{i}|{a}|T901|2026-01-05|{k}".encode()).hexdigest()
        check("queda firmado y con quien lo hizo", p.get("firma") == esperada and p.get("colaId") == str(i) and p.get("sesionUid") == "T920", p)
        sesion("T920", gestor=True)
        check("guarda un permiso", rpc(permiso).get("ok") is True)
        sesion("T920", gestor=True)
        check("elimina una marcación", rpc(borrar).get("eliminados") == 1)
        sesion("T920", gestor=True)
        rpc({**hora, "firma": "falsa", "colaId": "1", "sesionUid": "OTRO"})
        i, a, p = ultimo()
        check("no se puede falsear la firma ni el autor", p["sesionUid"] == "T920" and p["colaId"] == str(i), p)

        print("colaborador")
        sesion("T901")
        check("no cambia horas propias", "permiso" in rpc(hora).get("error", ""))
        check("no guarda permisos", "permiso" in rpc(permiso).get("error", ""))
        check("no elimina", "permiso" in rpc(borrar).get("error", ""))
        check("no crea ENTRADA como ausencia", "permiso" in rpc({**falta, "tipo": "ENTRADA"}).get("error", ""))
        check("sin protegerMarcaciones no", "permiso" in rpc({**falta, "protegerMarcaciones": None}).get("error", ""))
        check("no pisa un día con marcaciones", rpc({**falta, "fecha": "2026-01-05"}).get("ok") is not True)
        check("justifica su propia ausencia", rpc(falta).get("ok") is True)
        sesion("T902")
        check("no justifica la de otra persona", "permiso" in rpc({**falta, "fecha": "2026-01-09"}).get("error", ""))
        sesion("T910")
        check("el jefe inmediato sí (permiso aprobado)", rpc({**falta, "fecha": "2026-01-09"}).get("ok") is True)
        sesion("T911")
        check("el evaluador sí", rpc({**falta, "empleadoId": "T902", "fecha": "2026-01-09"}).get("ok") is True)
        sesion("T930", tthh=True)
        check("TTHH sí", rpc({**falta, "fecha": "2026-01-12"}).get("ok") is True)
        check("TTHH no cambia horas", "permiso" in rpc(hora).get("error", ""))
        sesion("", gestor=True)
        check("uid vacío no edita", rpc(hora).get("sesion") is True)

        print("base")
        como(sesion=True, uid="T901")
        for nombre, sql in (("historico.secretos", "SELECT * FROM historico.secretos"),
                            ("la función base", "SELECT historico.encolar_cambio_archivado_base('{}')"),
                            ("la firma", "SELECT historico.firma_cola(1,'x','{}')")):
            cur.execute("SAVEPOINT x")
            try:
                cur.execute(sql)
                check(f"la app no alcanza {nombre}", False)
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT x")
                check(f"la app no alcanza {nombre}", True)
        cur.execute("RESET ROLE")
        cur.execute("INSERT INTO historico.cambios_pendientes (accion, params) VALUES ('notificarVisita', '{\"evento\":\"x\"}') RETURNING id, params")
        i, p = cur.fetchone()
        check("los avisos (sin empleado ni fecha) también se firman",
              p.get("firma") == hashlib.sha256(f"{k}|{i}|notificarVisita|||{k}".encode()).hexdigest(), p)
        cur.execute("SELECT count(*) FROM historico.cambios_pendientes WHERE estado = 'pendiente' AND NOT params ? 'firma'")
        check("nada pendiente queda sin firma", cur.fetchone()[0] == 0)
        con.rollback()
    print(f"\n{'Todo OK' if not fallos else f'{fallos} prueba(s) fallaron'} · transacción revertida, la base queda igual")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
