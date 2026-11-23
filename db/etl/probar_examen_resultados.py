"""
Prueba la fase 4 (022_examen_resultados.sql): puntos por pregunta, calificación, Excel de resultados y servicio de envío
DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE.

    python db/etl/probar_examen_resultados.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

PG = Path(__file__).resolve().parent.parent / "postgres"
SQLS = [PG / "019_examenes.sql", PG / "021_examen_adjuntos.sql", PG / "020_examen_publico.sql", PG / "022_examen_resultados.sql"]
fallos = 0


def check(nombre, condicion, detalle=""):
    global fallos
    fallos += not condicion
    print(f"  {'OK ' if condicion else 'FALLA'} {nombre}" + (f"  → {detalle}" if detalle and not condicion else ""))


def main():
    leer_env_local()
    with conectar() as con, con.cursor() as cur:
        for f in SQLS:
            cur.execute(f.read_text(encoding="utf-8"))

        def como(claims):
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims or {}),))
            cur.execute("SET LOCAL ROLE " + ("tcontrol_lector" if claims else "tcontrol_anon"))

        def llamar(fn, p):
            return cur.execute(f"SELECT api.{fn}(%s::jsonb)", (json.dumps(p),)).fetchone()[0]

        adm = lambda p: llamar("examenes", p)
        res = lambda p: llamar("examenes_resultados", p)
        pub = lambda p: llamar("examen_publico", p)
        srv = lambda p: llamar("examenes_servicio", p)

        master = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T900", "master": True}
        otro = {"role": "tcontrol_lector", "eval": True, "empleado_id": "T777"}
        servicio = {"role": "tcontrol_lector", "servicio": "examenes"}

        como(master)
        adm({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T900", "nombre": "Jefe", "correo": "jefe@x.com"})
        adm({"accion": "perfil_guardar", "rol": "EVALUADOR", "empleadoId": "T777", "nombre": "Otro", "correo": ""})
        pa = adm({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Ana Prueba", "correo": "ana@x.com", "perfil": "Ingeniero"})["id"]
        pb = adm({"accion": "perfil_guardar", "rol": "EVALUADO", "nombre": "Beto Prueba", "correo": "beto@x.com", "perfil": "Ingeniero"})["id"]

        print("Puntos por pregunta")
        r = adm({"accion": "banco_importar", "preguntas": [
            {"fila": 2, "codigo": "Q1", "tipo": "Técnica", "pregunta": "Pregunta uno", "respuestaModelo": "SECRETA1"},
            {"fila": 3, "codigo": "Q2", "tipo": "Técnica", "pregunta": "Pregunta dos", "puntos": "5"},
            {"fila": 4, "codigo": "Q3", "tipo": "Técnica", "pregunta": "Pregunta tres", "puntos": "abc"},
            {"fila": 5, "codigo": "Q4", "tipo": "Técnica", "pregunta": "Pregunta cuatro", "puntos": "2,5"}]})
        check("el Excel acepta puntos y rechaza los inválidos", r["guardadas"] == 3 and len(r["errores"]) == 1 and r["errores"][0]["fila"] == 4, r)
        bd = {q["codigo"]: q for q in adm({"accion": "banco_listar"})["preguntas"]}
        check("por defecto una pregunta vale 10; con coma decimal vale 2,5", bd["Q1"]["puntos"] == 10 and bd["Q2"]["puntos"] == 5 and bd["Q4"]["puntos"] == 2.5, {k: v["puntos"] for k, v in bd.items()})
        adm({"accion": "banco_importar", "preguntas": [{"fila": 2, "codigo": "Q1", "tipo": "Técnica", "pregunta": "Pregunta uno", "respuestaModelo": "SECRETA1"}]})
        bd = {q["codigo"]: q for q in adm({"accion": "banco_listar"})["preguntas"]}
        check("reimportar sin columna de puntos los conserva", bd["Q1"]["puntos"] == 10 and bd["Q2"]["puntos"] == 5)
        r = adm({"accion": "pregunta_guardar", "id": bd["Q2"]["id"], "codigo": "Q2", "tipo": "Técnica", "pregunta": "Pregunta dos", "puntos": "8"})
        check("el formulario cambia los puntos", r["ok"] and {q["codigo"]: q for q in adm({"accion": "banco_listar"})["preguntas"]}["Q2"]["puntos"] == 8)
        check("puntos cero o enormes se rechazan", adm({"accion": "pregunta_guardar", "tipo": "Técnica", "pregunta": "x", "puntos": "0"})["ok"] is False
              and adm({"accion": "pregunta_guardar", "tipo": "Técnica", "pregunta": "x", "puntos": "5000"})["ok"] is False)
        adm({"accion": "pregunta_baja", "id": bd["Q4"]["id"]})

        # Dos evaluados, un examen con Q1 (10) y Q2 (8): máximo 18 por persona
        ex = adm({"accion": "examen_generar", "nombre": "Resultados", "perfilIds": [pa, pb], "cantidad": 2, "minutos": 30, "exigirPantalla": False})["examenId"]
        envios = {e["nombre"]: e for e in adm({"accion": "envio_preparar", "examenId": ex})["envios"]}
        ta, tb = envios["Ana Prueba"]["token"], envios["Beto Prueba"]["token"]
        ia = envios["Ana Prueba"]["intentoId"]

        como(None)
        ra = pub({"accion": "iniciar", "token": ta, "acepto": True})
        pub({"accion": "guardar", "token": ta, "respuestas": [{"n": 1, "texto": "Respuesta de Ana 1"}, {"n": 2, "texto": "Respuesta de Ana 2"}]})
        pub({"accion": "evento", "token": ta, "eventos": [{"tipo": "oculta", "detalle": "cambió de pestaña", "segundos": 7}]})
        pub({"accion": "entregar", "token": ta})
        pub({"accion": "iniciar", "token": tb, "acepto": True})        # Beto empezó y no ha entregado

        print("Calificar a mano")
        como(master)
        det = adm({"accion": "intento_detalle", "intentoId": ia})
        check("el detalle trae puntos máximos y total", det["maximo"] == 18 and det["puntos"] is None and all("puntosMax" in q for q in det["preguntas"]), det)
        n_q1 = [q["n"] for q in det["preguntas"] if q["codigo"] == "Q1"][0]
        n_q2 = [q["n"] for q in det["preguntas"] if q["codigo"] == "Q2"][0]
        r = res({"accion": "calificar", "intentoId": ia, "items": [{"n": n_q1, "puntos": "11", "comentario": "x"}]})
        check("no deja pasar el valor de la pregunta", r["ok"] is False and "vale máximo" in r["error"], r)
        r = res({"accion": "calificar", "intentoId": ia, "items": [{"n": n_q1, "puntos": "7,5", "comentario": "Falta detalle"}, {"n": n_q2, "puntos": "8", "comentario": "Completa"}]})
        check("califica con decimales y suma", r["ok"] and r["guardadas"] == 2 and float(r["puntos"]) == 15.5 and float(r["maximo"]) == 18, r)
        det = adm({"accion": "intento_detalle", "intentoId": ia})
        q1 = [q for q in det["preguntas"] if q["codigo"] == "Q1"][0]
        check("el detalle muestra la calificación y el comentario", float(q1["calificacion"]) == 7.5 and q1["comentario"] == "Falta detalle" and q1["origenCalif"] == "MANUAL", q1)
        r = res({"accion": "calificar", "intentoId": ia, "items": [{"n": n_q2, "puntos": "", "comentario": ""}]})
        check("dejar vacío quita la calificación", float(r["puntos"]) == 7.5, r)
        res({"accion": "calificar", "intentoId": ia, "items": [{"n": n_q2, "puntos": "8", "comentario": "Completa"}]})
        i = [x for e in adm({"accion": "inicio"})["examenes"] if e["id"] == ex for x in e["intentos"] if x["id"] == ia][0]
        check("el listado trae puntos y máximo", float(i["puntos"]) == 15.5 and float(i["maximo"]) == 18 and i["calificadas"] == 2, i)

        print("Excel de resultados")
        r = res({"accion": "resultados", "examenId": ex})
        hojas = {h["nombre"]: h["filas"] for h in r["resultados"]["hojas"]}
        check("trae 4 hojas", list(hojas) == ["Resumen", "Respuestas", "Incidencias", "Instrucciones para IA"], list(hojas))
        check("Resumen: encabezado + 2 personas", len(hojas["Resumen"]) == 3 and hojas["Resumen"][0][0] == "Evaluado", hojas["Resumen"])
        ana = [f for f in hojas["Resumen"] if f[0] == "Ana Prueba"][0]
        check("Resumen de Ana: entregó, 2 respondidas, 1 incidencia, 15.5 de 18 = 86.1 %",
              ana[3] == "ENTREGADO" and ana[8] == 2 and ana[9] == 1 and float(ana[11]) == 15.5 and float(ana[12]) == 18 and float(ana[13]) == 86.1, ana)
        beto = [f for f in hojas["Resumen"] if f[0] == "Beto Prueba"][0]
        check("Resumen de Beto: sin calificar, sin %", beto[3] == "INICIADO" and beto[11] is None and beto[13] is None, beto)
        check("Respuestas: una fila por persona y pregunta, con la respuesta modelo", len(hojas["Respuestas"]) == 5 and any(f[7] == "SECRETA1" for f in hojas["Respuestas"]))
        fila_ana_q1 = [f for f in hojas["Respuestas"] if f[1] == "Ana Prueba" and f[3] == "Q1"][0]
        check("Respuestas: ID_RESPUESTA intento-pregunta, respuesta y calificación", fila_ana_q1[0].startswith(f"{ia}-") and fila_ana_q1[8] == f"Respuesta de Ana {n_q1}" and float(fila_ana_q1[11]) == 7.5 and fila_ana_q1[12] == "Falta detalle", fila_ana_q1)
        check("Incidencias y hoja de instrucciones", len(hojas["Incidencias"]) == 2 and hojas["Incidencias"][1][2] == "oculta" and len(hojas["Instrucciones para IA"]) > 5)
        check("el destinatario es el correo del evaluador", r["destinatario"] == "jefe@x.com", r["destinatario"])

        print("Cargar calificaciones desde el Excel")
        fila_beto_q2 = [f for f in hojas["Respuestas"] if f[1] == "Beto Prueba" and f[3] == "Q2"][0]
        r = res({"accion": "calificar_lote", "examenId": ex, "items": [
            {"id": fila_ana_q1[0], "puntos": "9", "comentario": "IA: mejor de lo previsto"},
            {"id": fila_beto_q2[0], "puntos": "99", "comentario": "fuera de rango"},
            {"id": "999999-1", "puntos": "1"},
            {"id": "malformado", "puntos": "1"},
            {"id": fila_ana_q1[0].replace("-", "-0"), "puntos": ""}]})
        check("guarda las válidas y reporta las erróneas", r["guardadas"] == 1 and len(r["errores"]) == 3, r)
        det = adm({"accion": "intento_detalle", "intentoId": ia})
        q1 = [q for q in det["preguntas"] if q["codigo"] == "Q1"][0]
        check("la carga reemplaza la anterior y marca el origen EXCEL", float(q1["calificacion"]) == 9 and q1["origenCalif"] == "EXCEL", q1)


        print("Calificación con IA")
        como(master)
        r = res({"accion": "ia_pendientes", "examenId": ex})
        check("un examen sin «IA permitida» rechaza la calificación con IA", r["ok"] is False and "no tiene activada" in r["error"], r)
        r = res({"accion": "calificar_ia", "examenId": ex, "items": []})
        check("y tampoco guarda calificaciones de IA", r["ok"] is False)

        exi = adm({"accion": "examen_generar", "nombre": "Con IA", "perfilIds": [pa, pb], "cantidad": 2, "minutos": 30, "exigirPantalla": False, "iaPermitida": True, "permitirAdjuntos": True})["examenId"]
        check("el examen guarda iaPermitida", [e for e in adm({"accion": "inicio"})["examenes"] if e["id"] == exi][0]["iaPermitida"] is True)
        env = {e["nombre"]: e for e in adm({"accion": "envio_preparar", "examenId": exi})["envios"]}
        tia, tib = env["Ana Prueba"]["token"], env["Beto Prueba"]["token"]
        iia, iib = env["Ana Prueba"]["intentoId"], env["Beto Prueba"]["intentoId"]
        como(None)
        check("la página pública sabe que debe avisar", pub({"accion": "abrir", "token": tia})["iaPermitida"] is True)
        ra = pub({"accion": "iniciar", "token": tia, "acepto": True})
        pub({"accion": "guardar", "token": tia, "respuestas": [{"n": 1, "texto": "Respuesta A1 con datos"}, {"n": 2, "texto": "   "}]})
        pub({"accion": "entregar", "token": tia})
        rb = pub({"accion": "iniciar", "token": tib, "acepto": True})
        pub({"accion": "guardar", "token": tib, "respuestas": [{"n": 1, "texto": "Solo archivo en la 1"}, {"n": 2, "texto": "Respuesta B2"}]})
        fid = pub({"accion": "subir_inicio", "token": tib, "n": 1, "nombre": "esquema.png", "mime": "image/png", "tamano": 4})["archivoId"]
        import base64 as _b64
        pub({"accion": "subir_parte", "token": tib, "archivoId": fid, "n": 1, "datos": _b64.b64encode(b"\x89PNG").decode()})
        pub({"accion": "subir_fin", "token": tib, "archivoId": fid})
        pub({"accion": "guardar", "token": tib, "respuestas": [{"n": 1, "texto": ""}]})        # la 1 queda vacía pero con archivo
        pub({"accion": "entregar", "token": tib})
        como(master)
        r = res({"accion": "ia_pendientes", "examenId": exi})
        ids = {it["id"] for it in r["items"]}
        check("pendientes: 4 respuestas menos la que solo trajo archivo", r["ok"] and r["restantes"] == 3 and len(r["items"]) == 3, r)
        txt = json.dumps(r)
        check("no viajan nombres, correos ni tokens de personas", "Ana" not in txt and "Beto" not in txt and "@x.com" not in txt and ta not in txt)
        check("trae pregunta, modelo, respuesta y puntos máximos", all(k in r["items"][0] for k in ("pregunta", "respuestaModelo", "respuesta", "puntosMax", "archivos")), r["items"][0])
        r2 = res({"accion": "ia_pendientes", "examenId": exi, "limite": 2})
        check("respeta el tamaño del lote y avisa cuántas faltan", len(r2["items"]) == 2 and r2["restantes"] == 3, r2)
        r3 = res({"accion": "ia_pendientes", "examenId": exi, "intentoId": iia})
        check("se puede limitar a un solo intento", r3["restantes"] == 2 and all(it["id"].startswith(f"{iia}-") for it in r3["items"]), r3)

        lista = r["items"]
        mio = lista[0]["id"]
        codigos = {q["id"]: q["codigo"] for q in adm({"accion": "banco_listar"})["preguntas"]}
        int_mio = int(mio.split("-")[0])
        n_mio = [q["n"] for q in adm({"accion": "intento_detalle", "intentoId": int_mio})["preguntas"] if q["codigo"] == codigos[int(mio.split("-")[1])]][0]
        res({"accion": "calificar", "intentoId": int_mio, "items": [{"n": n_mio, "puntos": "1", "comentario": "manual"}]})
        r4 = res({"accion": "calificar_ia", "examenId": exi, "items": [{"id": i["id"], "puntos": "3", "comentario": "IA: bien"} for i in lista]})
        check("la IA guarda sus calificaciones pero no pisa la manual", r4["ok"] and r4["guardadas"] == len(lista) - 1, r4)
        det = adm({"accion": "intento_detalle", "intentoId": int(mio.split("-")[0])})
        origs = sorted(q["origenCalif"] for q in det["preguntas"] if q["origenCalif"])
        check("quedan marcadas MANUAL e IA", "MANUAL" in origs and ("IA" in origs or len(lista) == 1), origs)
        r5 = res({"accion": "calificar_ia", "examenId": exi, "items": [{"id": lista[-1]["id"], "puntos": "999", "comentario": "x"}, {"id": "9999-1", "puntos": "1"}, {"id": "malo", "puntos": "1"}]})
        check("fuera de rango o de otro examen se rechaza", r5["guardadas"] == 0 and len(r5["errores"]) == 3, r5)
        r6 = res({"accion": "ia_pendientes", "examenId": exi})
        check("ya calificadas dejan de estar pendientes", r6["restantes"] == 0, r6)
        r7 = res({"accion": "ia_pendientes", "examenId": exi, "recalificar": True})
        check("recalificar vuelve a incluir solo las de IA, no las manuales", r7["restantes"] == len(lista) - 1, r7)
        como(otro)
        check("otro evaluador no usa la IA sobre mis exámenes", res({"accion": "ia_pendientes", "examenId": exi})["ok"] is False)
        como(master)

        print("Permisos")
        como(otro)
        check("otro evaluador no ve resultados de mi examen", res({"accion": "resultados", "examenId": ex})["ok"] is False)
        check("otro evaluador no califica mis intentos", res({"accion": "calificar", "intentoId": ia, "items": [{"n": 1, "puntos": "1"}]})["ok"] is False)
        check("otro evaluador no carga calificaciones en mi examen", res({"accion": "calificar_lote", "examenId": ex, "items": []})["ok"] is False)
        cur.execute("RESET ROLE")
        anon = cur.execute("SELECT has_function_privilege('tcontrol_anon', 'api.examenes_resultados(jsonb)', 'EXECUTE'), has_function_privilege('tcontrol_anon', 'api.examenes_servicio(jsonb)', 'EXECUTE')").fetchone()
        check("la página pública (rol anónimo) no puede llamar a resultados ni al servicio", anon == (False, False), anon)

        print("Servicio (activador de Apps Script)")
        como(master)
        check("un token de evaluador no sirve para el servicio", srv({"accion": "pendientes"})["ok"] is False)
        como(servicio)
        r = srv({"accion": "pendientes"})
        check("mientras Beto sigue con tiempo, el examen no está pendiente", r["ok"] and not any(e["examenId"] == ex for e in r["examenes"]), r)
        cur.execute("RESET ROLE")
        cur.execute("UPDATE historico.exam_intentos SET limite_en = now() - interval '1 minute' WHERE id <> %s AND examen_id = %s", (ia, ex))
        como(servicio)
        r = srv({"accion": "pendientes"})
        mio = [e for e in r["examenes"] if e["examenId"] == ex]
        check("vencido el tiempo, Beto se cierra por tiempo y el examen queda pendiente", len(mio) == 1 and mio[0]["destinatario"] == "jefe@x.com", r)
        r = srv({"accion": "resultados", "examenId": ex})
        check("el servicio obtiene las hojas", r["ok"] and len(r["resultados"]["hojas"]) == 4 and r["destinatario"] == "jefe@x.com")
        srv({"accion": "marcar", "examenId": ex})
        check("marcado como enviado deja de estar pendiente", not any(e["examenId"] == ex for e in srv({"accion": "pendientes"})["examenes"]))
        como(master)
        inicio = [e for e in adm({"accion": "inicio"})["examenes"] if e["id"] == ex][0]
        check("el panel muestra cuándo se enviaron", inicio["resultadosEnviadoEn"] is not None and inicio["resultadosError"] is None)
        como(servicio)
        ex2 = None
        cur.execute("RESET ROLE")
        cur.execute("UPDATE historico.exam_examenes SET resultados_enviados_en = NULL WHERE id = %s", (ex,))
        como(servicio)
        srv({"accion": "marcar", "examenId": ex, "error": "Sin correo del evaluador"})
        check("un error de envío lo saca de la cola automática", not any(e["examenId"] == ex for e in srv({"accion": "pendientes"})["examenes"]))
        como(master)
        inicio = [e for e in adm({"accion": "inicio"})["examenes"] if e["id"] == ex][0]
        check("y el panel lo muestra", inicio["resultadosError"] == "Sin correo del evaluador", inicio)
        res({"accion": "resultados_marcar", "examenId": ex})
        inicio = [e for e in adm({"accion": "inicio"})["examenes"] if e["id"] == ex][0]
        check("el envío manual exitoso limpia el error", inicio["resultadosError"] is None and inicio["resultadosEnviadoEn"] is not None, inicio)

        con.rollback()
    print("\nFALLÓ" if fallos else "\nTodo bien", f"({fallos} fallos)" if fallos else "")
    sys.exit(1 if fallos else 0)


main()
