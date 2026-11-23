"""
Prueba la página pública del examen (020_examen_publico.sql) y la revisión del evaluador (019_examenes.sql)
DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE.

    python db/etl/probar_examen_publico.py            # prueba (revierte todo)
    python db/etl/probar_examen_publico.py --aplicar  # aplica 019 y 020 de verdad
"""
import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

PG = Path(__file__).resolve().parent.parent / "postgres"
SQLS = [PG / "019_examenes.sql", PG / "020_examen_publico.sql"]
fallos = 0


def check(nombre, condicion, detalle=""):
    global fallos
    fallos += not condicion
    print(f"  {'OK ' if condicion else 'FALLA'} {nombre}" + (f"  → {detalle}" if detalle and not condicion else ""))


def main():
    leer_env_local()
    if "--aplicar" in sys.argv:
        with conectar() as con:
            for f in SQLS:
                con.execute(f.read_text(encoding="utf-8"))
            con.commit()
        print("019 y 020 aplicados")
        return

    with conectar() as con, con.cursor() as cur:
        for f in SQLS:
            cur.execute(f.read_text(encoding="utf-8"))

        def como(claims):
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims or {}),))
            cur.execute("SET LOCAL ROLE " + ("tcontrol_lector" if claims else "tcontrol_anon"))

        def adm(p):
            return cur.execute("SELECT api.examenes(%s::jsonb)", (json.dumps(p),)).fetchone()[0]

        def pub(p):
            return cur.execute("SELECT api.examen_publico(%s::jsonb)", (json.dumps(p),)).fetchone()[0]

        master = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T900", "master": True}
        como(master)
        pa = adm({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Ana Prueba", "correo": "ana@x.com", "perfil": "Ingeniero"})["id"]
        adm({"accion": "banco_importar", "preguntas": [
            {"fila": 2, "codigo": "Q1", "tipo": "Técnica", "pregunta": "Pregunta uno", "respuestaModelo": "SECRETA1"},
            {"fila": 3, "codigo": "Q2", "tipo": "Técnica", "pregunta": "Pregunta dos", "respuestaModelo": "SECRETA2"}]})
        ex = adm({"accion": "examen_generar", "nombre": "Pub", "perfilIds": [pa], "cantidad": 2, "minutos": 30})["examenId"]
        envio = adm({"accion": "envio_preparar", "examenId": ex})["envios"][0]
        intento, tok = envio["intentoId"], envio["token"]

        print("Antes de empezar")
        como(None)
        check("token mal formado", pub({"accion": "abrir", "token": "xx"})["ok"] is False)
        check("token inexistente", pub({"accion": "abrir", "token": "a" * 64})["ok"] is False)
        r = pub({"accion": "abrir", "token": tok})
        check("abre y no trae preguntas", r["ok"] and r["preguntas"] == 2 and r["nombre"] == "Ana" and "texto" not in json.dumps(r), r)
        check("no se puede guardar sin empezar", pub({"accion": "guardar", "token": tok, "respuestas": []})["ok"] is False)
        check("iniciar exige aceptar el aviso", pub({"accion": "iniciar", "token": tok})["ok"] is False)

        print("Rindiendo")
        r = pub({"accion": "iniciar", "token": tok, "acepto": True, "pantalla": True})
        check("inicia y entrega 2 preguntas", r["ok"] and len(r["preguntas"]) == 2 and r["restante"] == 1800, r)
        txt = json.dumps(r)
        check("no filtra respuestas modelo ni códigos", "SECRETA" not in txt and "Q1" not in txt)
        r = pub({"accion": "guardar", "token": tok, "respuestas": [{"n": 1, "texto": "mi respuesta uno"}, {"n": 9, "texto": "fuera de rango"}]})
        check("guarda y ignora números inválidos", r["ok"] and r["guardadas"] == 1, r)
        pub({"accion": "guardar", "token": tok, "respuestas": [{"n": 1, "texto": "mi respuesta uno editada"}]})
        r = pub({"accion": "iniciar", "token": tok, "acepto": True})
        check("al recargar conserva la respuesta y no reinicia el reloj", r["ok"] and r["preguntas"][0]["respuesta"] == "mi respuesta uno editada" and r["restante"] <= 1800, r)
        r = pub({"accion": "evento", "token": tok, "eventos": [{"tipo": "oculta", "detalle": "cambió de pestaña", "segundos": 12}, {"tipo": "hackeo"}]})
        check("registra eventos válidos", r["ok"])
        img = base64.b64encode(b"\xff\xd8\xff" + b"0" * 500).decode()
        r = pub({"accion": "captura", "token": tok, "motivo": "periodica", "imagen": "data:image/jpeg;base64," + img})
        check("guarda captura", r["ok"] and not r.get("omitida"), r)
        check("rechaza imagen vacía", pub({"accion": "captura", "token": tok, "imagen": "data:image/jpeg;base64,AAAA"})["ok"] is False)

        print("Revisión del evaluador")
        como(master)
        i = adm({"accion": "inicio"})["examenes"][0]["intentos"][0]
        check("el listado muestra estado, respondidas, incidencias y capturas",
              i["estado"] == "INICIADO" and i["respondidas"] == 1 and i["incidencias"] == 1 and i["capturas"] == 1, i)
        d = adm({"accion": "intento_detalle", "intentoId": intento})
        check("detalle con respuesta y modelo", d["ok"] and len(d["preguntas"]) == 2
              and any(p["respuesta"] == "mi respuesta uno editada" for p in d["preguntas"]) and any(p["respuestaModelo"] for p in d["preguntas"]), d)
        check("detalle con eventos y capturas", len(d["eventos"]) >= 2 and len(d["capturas"]) == 1)
        v = adm({"accion": "captura_ver", "capturaId": d["capturas"][0]["id"]})
        check("ver captura", v["ok"] and v["imagen"].startswith("data:image/jpeg;base64,"))
        adm({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T777", "nombre": "Otro", "correo": ""})
        como({"role": "tcontrol_lector", "eval": True, "empleado_id": "T777"})
        check("otro evaluador no ve el intento", adm({"accion": "intento_detalle", "intentoId": intento})["ok"] is False)

        print("Cierre")
        como(None)
        r = pub({"accion": "entregar", "token": tok})
        check("entrega", r["ok"] and r["estado"] == "ENTREGADO", r)
        r = pub({"accion": "abrir", "token": tok})
        check("después de entregar solo dice entregado", r["estado"] == "ENTREGADO" and "preguntas" not in r, r)
        check("ya no guarda", pub({"accion": "guardar", "token": tok, "respuestas": [{"n": 1, "texto": "tarde"}]}).get("estado") == "ENTREGADO")

        print("Tiempo vencido")
        como(master)
        pb = adm({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Beto", "correo": "beto@x.com", "perfil": "Ingeniero"})["id"]
        ex2 = adm({"accion": "examen_generar", "nombre": "Tiempo", "perfilIds": [pb], "cantidad": 1, "minutos": 5, "exigirPantalla": False})["examenId"]
        tok2 = adm({"accion": "envio_preparar", "examenId": ex2})["envios"][0]["token"]
        como(None)
        pub({"accion": "iniciar", "token": tok2, "acepto": True})
        cur.execute("RESET ROLE")
        cur.execute("UPDATE historico.exam_intentos SET limite_en = now() - interval '1 minute' WHERE examen_id = %s", (ex2,))
        como(None)
        r = pub({"accion": "guardar", "token": tok2, "respuestas": [{"n": 1, "texto": "tarde"}]})
        check("pasado el tiempo se cierra y no acepta respuestas", r.get("estado") == "ENTREGADO" and r.get("motivoCierre") == "tiempo", r)
        como(master)
        i2 = [e for e in adm({"accion": "inicio"})["examenes"] if e["id"] == ex2][0]
        check("exigirPantalla = false se conserva", i2["exigirPantalla"] is False)

        con.rollback()
    print("\nFALLÓ" if fallos else "\nTodo bien", f"({fallos} fallos)" if fallos else "")
    sys.exit(1 if fallos else 0)


main()
