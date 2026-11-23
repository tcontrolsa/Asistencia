"""
Prueba api.examenes (019_examenes.sql) contra la base real DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE.

    python db/etl/probar_examenes.py            # prueba (revierte todo)
    python db/etl/probar_examenes.py --aplicar  # aplica 019_examenes.sql de verdad
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

SQL = Path(__file__).resolve().parent.parent / "postgres" / "019_examenes.sql"
fallos = 0


def check(nombre, condicion, detalle=""):
    global fallos
    fallos += not condicion
    print(f"  {'OK ' if condicion else 'FALLA'} {nombre}" + (f"  → {detalle}" if detalle and not condicion else ""))


def main():
    leer_env_local()
    if "--aplicar" in sys.argv:
        with conectar() as con:
            con.execute(SQL.read_text(encoding="utf-8"))
            con.commit()
        print("019_examenes.sql aplicado")
        return

    with conectar() as con, con.cursor() as cur:
        cur.execute(SQL.read_text(encoding="utf-8"))

        def como(claims):
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
            cur.execute("SET LOCAL ROLE tcontrol_lector")

        def rpc(p):
            return cur.execute("SELECT api.examenes(%s::jsonb)", (json.dumps(p),)).fetchone()[0]

        master = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T900", "master": True}
        evalu = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T901"}
        otro = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T902"}

        print("Permisos")
        como(evalu)
        check("sin perfil de evaluador no entra", rpc({"accion": "inicio"})["ok"] is False)
        como(master)
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T901", "nombre": "Jefe Prueba", "correo": "jefe@x.com"})
        check("master asigna evaluador", r["ok"], r)
        como(evalu)
        check("el evaluador ya entra", rpc({"accion": "inicio"})["ok"])
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T902", "nombre": "Otro", "correo": "otro@x.com"})
        check("un evaluador no asigna evaluadores", r["ok"] is False)
        como(otro)
        check("quien no es evaluador sigue sin entrar", rpc({"accion": "inicio"})["ok"] is False)

        print("Personas")
        como(evalu)
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Juan Pérez", "correo": "Juan@Ext.com", "perfil": "Pasante", "lineas": ["Media Tensión"]})
        check("candidato externo (sin ID)", r["ok"], r)
        pj = r["id"]
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Ana", "correo": "ana@x.com", "perfil": "Ingeniero", "lineas": []})
        pa = r["id"]
        check("perfil inexistente se rechaza", rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "X", "correo": "x@x.com", "perfil": "Rey"})["ok"] is False)
        check("correo inválido se rechaza", rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "X", "correo": "x", "perfil": "Pasante"})["ok"] is False)

        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "empleadoId": "T950", "nombre": "Lider Uno", "correo": "lider@x.com", "perfil": "Líder", "lineas": ["Baja Tensión"]})
        check("perfil Líder y vínculo con ID", r["ok"], r)
        r2 = rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "empleadoId": "T950", "nombre": "Lider Uno", "correo": "nuevo@x.com", "perfil": "Especialista de ingeniería", "lineas": []})
        check("volver a guardar al mismo ID actualiza, no duplica", r2["ok"] and r2["id"] == r["id"], r2)
        como(master)
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T951", "nombre": "Sin Correo", "correo": ""})
        r2 = rpc({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T952", "nombre": "Sin Correo 2", "correo": ""})
        check("evaluadores sin correo (varios)", r["ok"] and r2["ok"], (r, r2))
        check("evaluado sin correo se rechaza", rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "empleadoId": "T953", "nombre": "X", "correo": "", "perfil": "Pasante"})["ok"] is False)
        r = rpc({"accion": "perfil_guardar", "rol": "EVALUADO", "empleadoId": "T951", "nombre": "Sin Correo", "correo": "sc@x.com", "perfil": "Pasante"})
        check("la misma persona puede ser evaluador y evaluado", r["ok"], r)
        cur.execute("RESET ROLE")
        cur.execute("SELECT coalesce(correo,'') FROM historico.empleados WHERE coalesce(correo,'')<>'' LIMIT 1")
        fila = cur.fetchone()
        cur.execute("SELECT id FROM historico.empleados WHERE coalesce(correo,'')<>'' LIMIT 1")
        eid = cur.fetchone()[0]
        como(evalu)
        r = rpc({"accion": "directorio_correos", "ids": [eid, "NOEXISTE"]})
        check("correos desde la nómina", r["ok"] and eid in r["correos"] and "NOEXISTE" not in r["correos"], r)

        print("Banco")
        filas = [
            {"fila": 2, "codigo": "P001", "perfiles": ["Pasante", "Ingeniero"], "lineas": ["Baja Tensión"], "tipo": "Técnica", "pregunta": "¿Seccionador vs disyuntor?", "respuestaModelo": "..."},
            {"fila": 3, "codigo": "P016", "perfiles": ["Ingeniero"], "lineas": ["Baja Tensión", "Media Tensión"], "tipo": "Técnica", "pregunta": "¿Coordinación de protecciones?"},
            {"fila": 4, "codigo": "P069", "perfiles": ["Pasante"], "lineas": ["Motion y Automation"], "tipo": "Proceso", "pregunta": "¿Qué revisar al recibir un tablero?"},
            {"fila": 5, "codigo": "P100", "perfiles": [], "lineas": [], "tipo": "Capacitación", "pregunta": "General para todos"},
            {"fila": 6, "codigo": "X", "perfiles": ["Pasante"], "lineas": ["Marte"], "tipo": "Técnica", "pregunta": "Línea mala"},
            {"fila": 7, "codigo": "", "tipo": "Técnica", "pregunta": "Sin ID"},
        ]
        r = rpc({"accion": "banco_importar", "preguntas": filas})
        check("guarda 4 y rechaza 2", r["guardadas"] == 4 and len(r["errores"]) == 2, r)
        check("el error trae la fila", {e["fila"] for e in r["errores"]} == {6, 7}, r)
        r = rpc({"accion": "banco_importar", "preguntas": filas[:1]})
        check("reimportar actualiza, no duplica", rpc({"accion": "banco_listar"})["preguntas"].__len__() == 4)

        print("Generar")
        r = rpc({"accion": "examen_generar", "nombre": "Prueba", "perfilIds": [pj, pa], "cantidad": 10, "minutos": 30})
        check("genera", r["ok"], r)
        det = {d["nombre"]: d for d in r["detalle"]}
        # Juan: Pasante + Media Tensión → P100 (general) y nada más (P001 es Baja, P069 es Motion)
        check("Pasante/Media Tensión recibe solo lo que le aplica", det["Juan Pérez"]["preguntas"] == 1, det)
        # Ana: Ingeniero sin línea → P001, P016, P100
        check("Ingeniero sin línea recibe todas sus líneas", det["Ana"]["preguntas"] == 3, det)
        check("avisa cuántas faltan", det["Ana"]["faltan"] == 7, det)
        ex = r["examenId"]
        r2 = rpc({"accion": "examen_generar", "nombre": "Filtro", "perfilIds": [pa], "cantidad": 2, "minutos": 10,
                  "filtros": {"tipos": ["Capacitación"], "perfiles": ["Pasante"]}})
        check("filtro de tipo y perfil del evaluador", r2["ok"] and r2["detalle"][0]["preguntas"] == 1, r2)
        r3 = rpc({"accion": "examen_generar", "nombre": "Vacío", "perfilIds": [pa], "cantidad": 2, "minutos": 10, "filtros": {"tipos": ["Ejercicio"]}})
        check("sin preguntas no deja examen vacío", r3["ok"] is False)

        print("Envío")
        r = rpc({"accion": "envio_preparar", "examenId": ex})
        check("prepara 2 envíos con token", r["ok"] and len(r["envios"]) == 2 and all(len(e["token"]) == 64 for e in r["envios"]), r)
        ids = [e["intentoId"] for e in r["envios"]]
        cur.execute("RESET ROLE")
        n = cur.execute("SELECT count(*) FROM historico.exam_intentos WHERE examen_id = %s AND token_hash IS NOT NULL", (ex,)).fetchone()[0]
        t = r["envios"][0]["token"]
        guardado = cur.execute("SELECT count(*) FROM historico.exam_intentos WHERE token_hash = %s", (t,)).fetchone()[0]
        check("en la base solo queda el hash", n == 2 and guardado == 0)
        como(evalu)
        rpc({"accion": "envio_marcar", "ok": [ids[0]], "fallos": [{"id": ids[1], "error": "buzón lleno"}]})
        est = {i["id"]: i for i in rpc({"accion": "inicio"})["examenes"][0]["intentos"]}
        check("marca enviado y error", est[ids[0]]["estado"] == "ENVIADO" and est[ids[1]]["errorEnvio"] == "buzón lleno", est)
        como(master)
        check("master ve el examen de otros", any(e["id"] == ex for e in rpc({"accion": "inicio"})["examenes"]))

        con.rollback()
    print("\nFALLÓ" if fallos else "\nTodo bien", f"({fallos} fallos)" if fallos else "")
    sys.exit(1 if fallos else 0)


main()
