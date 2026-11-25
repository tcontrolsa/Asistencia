"""
Prueba 024_evaluacion_feedback.sql contra la base real DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE:
aplica el esquema, prueba con empleados ficticios (T9xx) y no deja nada.

    python db/etl/probar_evaluacion_feedback.py            # prueba (revierte todo)
    python db/etl/probar_evaluacion_feedback.py --aplicar  # aplica 024 de verdad
"""
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

SQL = Path(__file__).resolve().parent.parent / "postgres" / "024_evaluacion_feedback.sql"
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
        print("024_evaluacion_feedback.sql aplicado")
        return

    with conectar() as con, con.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout = '5s'")
        cur.execute(SQL.read_text(encoding="utf-8"))
        cur.execute(SQL.read_text(encoding="utf-8"))   # re-ejecutable

        def como(claims):
            cur.execute("RESET ROLE")
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
            cur.execute("SET LOCAL ROLE tcontrol_lector")

        def rpc(fn, p):
            return cur.execute(f"SELECT api.{fn}(%s::jsonb)", (json.dumps(p),)).fetchone()[0]

        def sql(q, *a):
            cur.execute("RESET ROLE")
            return cur.execute(q, a).fetchone()[0]

        def evento():
            return sql("SELECT params->>'evento' FROM historico.cambios_pendientes WHERE accion = 'guardarEvaluacion' ORDER BY id DESC LIMIT 1")

        hoy = sql("SELECT historico.eval_hoy()")
        mes = f"{hoy:%Y-%m}"
        base_c = {"role": "tcontrol_lector", "eval": True, "equipo": []}
        jefe = {**base_c, "empleado_id": "T900", "equipo": ["T901", "T902", "T903"]}
        colab = {**base_c, "empleado_id": "T901"}
        rrhh = {**base_c, "empleado_id": "T905", "rrhh": True}
        jefe_rrhh = {**jefe, "rrhh": True}
        eval_rrhh = {**base_c, "empleado_id": "T902", "rrhh": True}
        master = {**base_c, "empleado_id": "T906", "rrhh": True, "master": True}
        o = "Hecho concreto observado en el período"

        def ev(emp="T901", cal=None, periodo=None, **k):
            cal = cal or [4] * 14
            return {"empleadoId": emp, "tipo": "MENSUAL", "periodo": periodo or mes, "empleadoNombre": "Prueba Uno Dos",
                    "evaluadorNombre": "Jefe Prueba Uno", "calificaciones": cal,
                    "observaciones": [o if v in (1, 2, 5) else "" for v in cal], **k}

        print("textos")
        for t, ok in [("no aplica", False), ("No aplica en este caso", False), ("N/A", False), ("Sin novedades en el mes", False),
                      ("bla bla bla", False), ("muy bueno", False), ("No aplica los procedimientos del SGC", True),
                      ("Entregó el informe a tiempo", True), ("", False), ("...", False), ("1 2 3", False)]:
            check(f"«{t}» → {ok}", sql("SELECT historico.eval_texto_ok(%s)", t) is ok)

        print("cuestionario")
        cfg = sql("SELECT config FROM historico.eval_config ORDER BY version DESC LIMIT 1")
        check("umbral 70 %", float(cfg["meta"]) == 0.7)
        check("5 categorías con color", [n["color"] for n in sorted(cfg["niveles"], key=lambda n: n["min"])] == ["rojo", "ambar", "verde", "verde", "azul"])
        check("4 aclaraciones", [i + 1 for i, x in enumerate(cfg["items"]) if x.get("a")] == [2, 4, 7, 9])
        check("pesos y frecuencia intactos", sum(int(x["peso"]) for x in cfg["items"]) == 100 and cfg["frecuencia"] == "MENSUAL")
        check("config válida", sql("SELECT historico.eval_validar_config(%s::jsonb)", json.dumps(cfg)) is None)
        check("una sola versión nueva al re-ejecutar", sql("SELECT count(*) FROM historico.eval_config WHERE comentario LIKE 'Documento SISTEMA%%'") == 1)

        print("octubre")
        n = sql("SELECT count(*) FROM historico.evaluaciones WHERE feedback_exigido AND empleado_id NOT LIKE 'T9%%'")
        print(f"    {n} evaluaciones quedan con feedback pendiente")
        check("solo menores a 70 %", sql("SELECT count(*) FROM historico.evaluaciones WHERE feedback_exigido AND porcentaje >= 0.70") == 0)
        check("sin plazos de confirmación", sql("SELECT count(*) FROM historico.evaluaciones WHERE estado = 'enviada' AND vence_confirmar IS NOT NULL") == 0)

        print("guardar")
        como(jefe)
        mala = ev(cal=[5] + [4] * 13)
        mala["observaciones"][0] = "no aplica"
        check("observación «no aplica» → error", "3 palabras" in rpc("eval_guardar", mala).get("error", ""))
        check("observación opcional corta → error", "3 palabras" in rpc("eval_guardar", {**ev(), "observaciones": [""] * 13 + ["bien"]}).get("error", ""))
        check("fortalezas cortas → error", "Fortalezas" in rpc("eval_guardar", ev(fortalezas="ninguna")).get("error", ""))
        r = rpc("eval_guardar", ev())
        e = r["evaluacion"]
        cierre = mes[-2:] in ("03", "06", "09", "12")
        check("80 % → feedback " + ("por trimestre" if cierre else "opcional"), e["feedback"]["exigido"] is cierre, e["feedback"])
        check("nivel nuevo", e["nivel"] == "Cumple plenamente lo esperado", e["nivel"])
        check("sin plazo de confirmación", e["venceConfirmar"] is None and not e["confirmacionVencida"])
        check("cierre de trimestre obligatorio", sql("SELECT historico.eval_feedback_motivo('MENSUAL', '2026-12', 0.85, '{}')") == "trimestre")
        check("enero opcional", sql("SELECT historico.eval_feedback_motivo('MENSUAL', '2027-01', 0.85, '{}')") is None)
        check("69,9 % en diciembre → intervención", sql("SELECT historico.eval_feedback_motivo('MENSUAL', '2026-12', 0.699, '{}')") == "intervencion")
        check("70 % exacto no requiere intervención", sql("SELECT historico.eval_feedback_motivo('MENSUAL', '2027-01', 0.70, '{}')") is None)
        como(jefe)
        e = rpc("eval_guardar", ev(cal=[3] * 14))["evaluacion"]
        check("60 % (corrección) → feedback pendiente a 7 días", e["feedback"]["estado"] == "pendiente"
              and e["feedback"]["vence"] == str(hoy + dt.timedelta(days=7)) and e["feedback"]["motivo"] == "intervencion", e["feedback"])
        id_ = e["id"]

        print("recibida al abrir")
        como({**colab, "empleado_id": "T902"})
        check("otro no la abre", not rpc("eval_confirmar", {"id": id_}).get("ok"))
        como(colab)
        r = rpc("eval_confirmar", {"id": id_})
        check("queda recibida", r["evaluacion"]["estado"] == "confirmada" and r["evaluacion"]["confirmadaEn"])
        check("evento recibida", evento() == "recibida")
        como(colab)
        n0 = sql("SELECT count(*) FROM historico.cambios_pendientes")
        como(colab)
        check("abrir otra vez no cambia", rpc("eval_confirmar", {"id": id_})["ok"] and sql("SELECT count(*) FROM historico.cambios_pendientes") == n0)
        como(colab)
        r = rpc("eval_confirmar", {"id": id_, "comentario": "Estoy de acuerdo con el resultado"})
        check("comentario opcional", r["evaluacion"]["comentarioColaborador"].startswith("Estoy") and evento() == "comentario")
        como(jefe)
        check("el evaluador ya no corrige", "recibió" in rpc("eval_guardar", ev()).get("error", ""))
        check("reabrir solo master", not rpc("eval_reabrir", {"tipo": "corregir", "id": id_, "dias": 3}).get("ok"))
        como(master)
        r = rpc("eval_reabrir", {"tipo": "corregir", "id": id_, "dias": 3})
        check("master reabre", r["ok"] and r["evaluacion"]["estado"] == "enviada" and r["evaluacion"]["correccionHasta"], r)
        como(colab)
        check("abrir durante la corrección no la bloquea", rpc("eval_confirmar", {"id": id_})["evaluacion"]["estado"] == "enviada")
        como(jefe)
        r = rpc("eval_guardar", ev(cal=[3] * 14))
        check("el evaluador corrige", r.get("ok") and r["evaluacion"]["correccionHasta"] is None, r)
        como(colab)
        check("vuelve a quedar recibida", rpc("eval_confirmar", {"id": id_})["evaluacion"]["estado"] == "confirmada")

        print("feedback")
        como(colab)
        check("el colaborador pide reunión", rpc("eval_reunion", {"id": id_, "accion": "solicitar"})["ok"])
        check("el colaborador no la marca realizada", not rpc("eval_reunion", {"id": id_, "accion": "realizar", "fecha": str(hoy)}).get("ok"))
        como(jefe)
        r = rpc("eval_reunion", {"id": id_, "accion": "agendar", "fecha": str(hoy), "hora": "10:00", "lugar": "Sala 1"})
        check("agendada", r["evaluacion"]["feedback"]["estado"] == "agendada")
        check("realizar sin compromisos → error", "compromisos" in rpc("eval_reunion", {"id": id_, "accion": "realizar", "fecha": str(hoy)}).get("error", ""))
        check("compromisos «no aplica» → error", "3 palabras" in rpc("eval_reunion", {"id": id_, "accion": "realizar", "fecha": str(hoy), "compromisos": "no aplica"}).get("error", ""))
        check("fecha futura → error", not rpc("eval_reunion", {"id": id_, "accion": "realizar", "fecha": str(hoy + dt.timedelta(days=1)), "compromisos": o}).get("ok"))
        r = rpc("eval_reunion", {"id": id_, "accion": "realizar", "fecha": str(hoy), "compromisos": "Entregar reportes cada viernes"})
        check("realizada con compromisos", r["evaluacion"]["feedback"]["estado"] == "realizada" and r["evaluacion"]["compromisos"].startswith("Entregar"), r)
        check("evento feedback_realizado", evento() == "feedback_realizado")
        p = sql("SELECT params FROM historico.cambios_pendientes WHERE accion = 'guardarEvaluacion' ORDER BY id DESC LIMIT 1")
        check("réplica: intervención y feedback", p["intervencion"] == "SI" and p["feedback"] == "Realizado", p)

        print("sesgo")
        como(jefe)
        r = rpc("eval_guardar", ev("T902", [5] * 14))
        s = r["evaluacion"]
        check("todo 5 → en revisión", r["enRevision"] and s["estado"] == "revision" and s["sesgo"]["tipo"] == "maximo", r)
        check("evento sesgo_revision sin alerta", evento() == "sesgo_revision")
        como(eval_rrhh)
        check("el colaborador no la ve", rpc("eval_listar", {"modo": "mias"})["evaluaciones"] == [])
        check("ni como Sup. Admin en 'todas'", not any(x["id"] == s["id"] for x in rpc("eval_listar", {"modo": "todas"})["evaluaciones"]))
        check("no la abre", not rpc("eval_confirmar", {"id": s["id"]}).get("ok"))
        check("no revisa la suya", "tuya" in rpc("eval_sesgo", {"id": s["id"], "accion": "aprobar"}).get("error", ""))
        como(jefe)
        check("sin permiso rrhh no revisa", not rpc("eval_sesgo", {"id": s["id"], "accion": "aprobar"}).get("ok"))
        check("no se agenda en revisión", not rpc("eval_reunion", {"id": s["id"], "accion": "agendar", "fecha": str(hoy), "hora": "10:00", "lugar": "x"}).get("ok"))
        como(jefe_rrhh)
        check("el evaluador no revisa la que hizo", not rpc("eval_sesgo", {"id": s["id"], "accion": "aprobar"}).get("ok"))
        como(rrhh)
        check("rrhh la ve en 'todas'", any(x["id"] == s["id"] for x in rpc("eval_listar", {"modo": "todas"})["evaluaciones"]))
        check("devolver exige motivo", not rpc("eval_sesgo", {"id": s["id"], "accion": "devolver", "motivo": "no"}).get("ok"))
        r = rpc("eval_sesgo", {"id": s["id"], "accion": "devolver", "motivo": "Sustenta cada calificación con hechos"})
        check("devuelta", r["evaluacion"]["estado"] == "devuelta" and evento() == "sesgo_devuelta", r)
        como(jefe)
        r = rpc("eval_guardar", ev("T902", [5] * 13 + [4]))
        check("corregida sin extremo → enviada", r["evaluacion"]["estado"] == "enviada" and r["evaluacion"]["sesgo"] is None and evento() == "enviada", r)
        como(jefe)
        r = rpc("eval_guardar", ev("T903", [1] * 14))
        check("todo 1 → en revisión", r["evaluacion"]["estado"] == "revision" and r["evaluacion"]["feedback"]["vence"] is None, r)
        como(rrhh)
        r = rpc("eval_sesgo", {"id": r["evaluacion"]["id"], "accion": "aprobar"})
        check("aprobada → enviada con feedback a 7 días", r["evaluacion"]["estado"] == "enviada"
              and r["evaluacion"]["feedback"]["vence"] == str(hoy + dt.timedelta(days=7)), r)
        como({**base_c, "empleado_id": "T903"})
        check("ahora sí la ve", len(rpc("eval_listar", {"modo": "mias"})["evaluaciones"]) == 1)

        con.rollback()
    print(f"\n{'Todo OK' if not fallos else f'{fallos} prueba(s) fallaron'} · transacción revertida, la base queda igual")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
