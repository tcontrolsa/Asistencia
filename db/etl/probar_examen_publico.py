"""
Prueba la página pública del examen (020_examen_publico.sql, 021_examen_adjuntos.sql) y la revisión del evaluador (019_examenes.sql)
DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE.

    python db/etl/probar_examen_publico.py            # prueba (revierte todo)
    python db/etl/probar_examen_publico.py --aplicar  # aplica 019, 021 y 020 de verdad
"""
import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

PG = Path(__file__).resolve().parent.parent / "postgres"
SQLS = [PG / "019_examenes.sql", PG / "021_examen_adjuntos.sql", PG / "020_examen_publico.sql"]
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
        print("019, 021 y 020 aplicados")
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


        print("Adjuntos")
        como(master)

        def arch(p):
            return cur.execute("SELECT api.examenes_archivos(%s::jsonb)", (json.dumps(p),)).fetchone()[0]
        banco = adm({"accion": "banco_listar"})["preguntas"]
        q1 = [q for q in banco if q["codigo"] == "Q1"][0]["id"]
        contenido = bytes(range(256)) * 1500                      # 384.000 bytes = 2 partes
        r = arch({"accion": "subir_inicio", "preguntaId": q1, "nombre": "../../diagrama final.png", "mime": "image/png", "tamano": len(contenido)})
        check("inicia subida de material (2 partes)", r["ok"] and r["partes"] == 2, r)
        aid = r["archivoId"]
        arch({"accion": "subir_parte", "archivoId": aid, "n": 1, "datos": base64.b64encode(contenido[:300000]).decode()})
        r = arch({"accion": "subir_fin", "archivoId": aid})
        check("no cierra con partes faltantes", r["ok"] is False, r)
        r = arch({"accion": "subir_inicio", "preguntaId": q1, "nombre": "../../diagrama final.png", "mime": "image/png", "tamano": len(contenido)})
        aid = r["archivoId"]
        for n, ini in ((1, 0), (2, 300000)):
            arch({"accion": "subir_parte", "archivoId": aid, "n": n, "datos": base64.b64encode(contenido[ini:ini + 300000]).decode()})
        check("cierra con todas las partes", arch({"accion": "subir_fin", "archivoId": aid})["ok"])
        check("rechaza SVG", arch({"accion": "subir_inicio", "preguntaId": q1, "nombre": "x.svg", "mime": "image/svg+xml", "tamano": 10})["ok"] is False)
        check("rechaza ejecutable", arch({"accion": "subir_inicio", "preguntaId": q1, "nombre": "x.exe", "mime": "application/x-msdownload", "tamano": 10})["ok"] is False)
        check("rechaza más de 25 MB", arch({"accion": "subir_inicio", "preguntaId": q1, "nombre": "x.mp4", "mime": "video/mp4", "tamano": 30000000})["ok"] is False)
        check("enlace https", arch({"accion": "enlace_agregar", "preguntaId": q1, "url": "https://youtu.be/abc123", "titulo": "Video"})["ok"])
        check("enlace http se rechaza", arch({"accion": "enlace_agregar", "preguntaId": q1, "url": "http://x.com/a"})["ok"] is False)
        check("enlace javascript se rechaza", arch({"accion": "enlace_agregar", "preguntaId": q1, "url": "javascript:alert(1)"})["ok"] is False)
        adj = [q for q in adm({"accion": "banco_listar"})["preguntas"] if q["codigo"] == "Q1"][0]["adjuntos"]
        check("la pregunta lista archivo y enlace, con el nombre limpio", len(adj) == 2 and adj[0]["nombre"] == "diagrama final.png" and adj[1]["tipo"] == "enlace", adj)
        r = arch({"accion": "archivo_parte", "archivoId": aid, "n": 2})
        check("el evaluador baja la parte 2 íntegra", r["ok"] and base64.b64decode(r["datos"]) == contenido[300000:], r.get("error"))
        r = adm({"accion": "banco_importar", "preguntas": [{"fila": 2, "codigo": "Q1", "tipo": "Técnica", "pregunta": "Pregunta uno", "enlaces": ["https://a.com/doc", "ftp://malo", "https://a.com/doc"]}]})
        adj2 = [q for q in adm({"accion": "banco_listar"})["preguntas"] if q["codigo"] == "Q1"][0]["adjuntos"]
        check("reimportar conserva el archivo y reemplaza enlaces (solo https, sin repetir)",
              r["guardadas"] == 1 and [a["tipo"] for a in adj2] == ["archivo", "enlace"] and adj2[1]["url"] == "https://a.com/doc", adj2)
        adm({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T778", "nombre": "Ajeno", "correo": ""})
        como({"role": "tcontrol_lector", "eval": True, "empleado_id": "T778"})
        check("otro evaluador no baja el archivo", arch({"accion": "archivo_parte", "archivoId": aid, "n": 1})["ok"] is False)
        como(master)

        # El evaluado ve el material en su examen y sube un archivo a su respuesta
        exa = adm({"accion": "examen_generar", "nombre": "Con adjuntos", "perfilIds": [pa], "cantidad": 2, "minutos": 30, "permitirAdjuntos": True})["examenId"]
        toka = adm({"accion": "envio_preparar", "examenId": exa})["envios"][0]["token"]
        como(None)
        ra = pub({"accion": "iniciar", "token": toka, "acepto": True})
        pq = [q for q in ra["preguntas"] if len(q["adjuntos"]) == 2]
        check("el evaluado recibe los adjuntos de la pregunta", ra["permitirAdjuntos"] is True and len(pq) == 1, ra)
        n1 = pq[0]["n"]
        r = pub({"accion": "archivo_parte", "token": toka, "archivoId": aid, "n": 1})
        check("el evaluado baja el material de su pregunta", r["ok"] and base64.b64decode(r["datos"]) == contenido[:300000], r.get("error"))
        nota = bytes(range(200)) * 100                                  # 20.000 bytes
        r = pub({"accion": "subir_inicio", "token": toka, "n": n1, "nombre": "mi respuesta.pdf", "mime": "application/pdf", "tamano": len(nota)})
        check("inicia subida de su archivo", r["ok"] and r["partes"] == 1, r)
        fid = r["archivoId"]
        pub({"accion": "subir_parte", "token": toka, "archivoId": fid, "n": 1, "datos": base64.b64encode(nota).decode()})
        check("cierra su subida", pub({"accion": "subir_fin", "token": toka, "archivoId": fid})["ok"])
        ri = pub({"accion": "iniciar", "token": toka, "acepto": True})
        check("al recargar ve su archivo", any(a["id"] == fid for q in ri["preguntas"] for a in q["archivos"]), ri)
        check("el evaluado baja su propio archivo", base64.b64decode(pub({"accion": "archivo_parte", "token": toka, "archivoId": fid, "n": 1})["datos"]) == nota)
        check("rechaza SVG", pub({"accion": "subir_inicio", "token": toka, "n": n1, "nombre": "a.svg", "mime": "image/svg+xml", "tamano": 10})["ok"] is False)
        check("rechaza más de 10 MB", pub({"accion": "subir_inicio", "token": toka, "n": n1, "nombre": "a.mp4", "mime": "video/mp4", "tamano": 11000000})["ok"] is False)
        for k in range(2):
            pub({"accion": "subir_inicio", "token": toka, "n": n1, "nombre": f"x{k}.png", "mime": "image/png", "tamano": 10})
        check("máximo 3 archivos por pregunta", pub({"accion": "subir_inicio", "token": toka, "n": n1, "nombre": "y.png", "mime": "image/png", "tamano": 10})["ok"] is False)
        check("no puede bajar el archivo de otro intento", "datos" not in pub({"accion": "archivo_parte", "token": tok, "archivoId": fid, "n": 1}))
        como(master)
        pc = adm({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Carla", "correo": "carla@x.com", "perfil": "Ingeniero"})["id"]
        exc = adm({"accion": "examen_generar", "nombre": "Otra persona", "perfilIds": [pc], "cantidad": 2, "minutos": 30, "permitirAdjuntos": True})["examenId"]
        tokc = adm({"accion": "envio_preparar", "examenId": exc})["envios"][0]["token"]
        como(None)
        pub({"accion": "iniciar", "token": tokc, "acepto": True})
        check("otra persona activa no puede bajar mi archivo ni el material de una pregunta que no tiene",
              pub({"accion": "archivo_parte", "token": tokc, "archivoId": fid, "n": 1}).get("ok") is False)
        como(master)
        intentos = [i for e in adm({"accion": "inicio"})["examenes"] if e["id"] == exa for i in e["intentos"]]
        det = adm({"accion": "intento_detalle", "intentoId": intentos[0]["id"]})
        check("el evaluador ve el archivo del evaluado y baja su contenido",
              any(a["id"] == fid for q in det["preguntas"] for a in q["archivos"])
              and base64.b64decode(arch({"accion": "archivo_parte", "archivoId": fid, "n": 1})["datos"]) == nota, det)
        r = arch({"accion": "adjunto_quitar", "preguntaId": q1, "indice": 0})
        cur.execute("RESET ROLE")
        quedan = cur.execute("SELECT count(*) FROM historico.exam_archivos WHERE id = %s", (aid,)).fetchone()[0]
        check("quitar un adjunto borra el archivo", r["ok"] and quedan == 0, r)

        con.rollback()
    print("\nFALLÓ" if fallos else "\nTodo bien", f"({fallos} fallos)" if fallos else "")
    sys.exit(1 if fallos else 0)


main()
