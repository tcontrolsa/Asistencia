"""
Prueba api.epp (016_epp.sql) contra la base real DENTRO DE UNA TRANSACCIÓN QUE SE REVIERTE: no deja nada.

    python db/etl/probar_epp.py            # prueba (revierte todo)
    python db/etl/probar_epp.py --aplicar  # aplica 016_epp.sql de verdad
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

SQL = Path(__file__).resolve().parent.parent / "postgres" / "016_epp.sql"
SQL_MATRIZ = Path(__file__).resolve().parent.parent / "postgres" / "017_epp_matriz.sql"
FIRMA = "data:image/png;base64,iVBORw0KGgo="
fallos = 0


def check(nombre, condicion, detalle=""):
    global fallos
    fallos += not condicion
    print(f"  {'OK   ' if condicion else 'FALLA'} {nombre}" + (f"  → {detalle}" if detalle and not condicion else ""))


def main():
    leer_env_local()
    if "--aplicar" in sys.argv:
        with conectar() as con:
            con.execute(SQL.read_text(encoding="utf-8"))
            con.commit()
        print("016_epp.sql aplicado")
        return

    with conectar() as con, con.cursor() as cur:
        for _ in range(2):   # re-ejecutable
            cur.execute(SQL.read_text(encoding="utf-8"))
            cur.execute(SQL_MATRIZ.read_text(encoding="utf-8"))
        cur.execute("""INSERT INTO historico.empleados (id, nombre, area, activo, cargo, raw) VALUES
            ('T900', 'Mecánico Prueba', 'TALLER', true, 'OPERADOR MECÁNICO', '{}'),
            ('T901', 'Bodega Prueba', 'TALLER', true, 'Especialista Bodega', '{}'),
            ('T902', 'Calidad Prueba', 'BODEGA', true, 'Gestión de Calidad', '{}'),
            ('T903', 'Contador Prueba', 'CONTABILIDAD', true, 'CONTADOR', '{}'),
            ('T904', 'Inactivo Prueba', 'TALLER', false, 'SOLDADOR', '{}')""")
        # T900: Mecanizado; T905: Taller pesado y Pintura (dos áreas); T903 (contador) sin asignación
        cur.execute("""INSERT INTO historico.empleados (id, nombre, area, activo, cargo, raw) VALUES ('T905', 'Doble Area Prueba', 'TALLER', true, 'SOLDADOR', '{}')""")
        cur.execute("""INSERT INTO historico.epp_asignaciones (empleado_id, area_id) VALUES
            ('T900', 'mecanizado'), ('T905', 'taller_pesado_pulido'), ('T905', 'pintura')""")

        def como(eid, **extra):
            cur.execute("RESET ROLE")
            claims = {"role": "tcontrol_lector", **({"eval": True, "empleado_id": eid} if eid else {}), **extra}
            cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
            cur.execute("SET LOCAL ROLE tcontrol_lector")

        def rpc(accion, **p):
            return cur.execute("SELECT api.epp(%s::jsonb)", (json.dumps({"accion": accion, **p}),)).fetchone()[0]

        def stock(epp, talla):
            cur.execute("RESET ROLE")
            n = cur.execute("SELECT cant FROM historico.epp_stock WHERE epp_id=%s AND talla=%s", (epp, talla)).fetchone()[0]
            return n

        def estado(codigo):
            cur.execute("RESET ROLE")
            return cur.execute("SELECT estado, firma_origen FROM historico.epp_solicitudes WHERE id=%s", (int(codigo[4:]),)).fetchone()

        linea = lambda e="guantes_anticorte", t="M", c=1: {"eppId": e, "talla": t, "cant": c, "motivo": "Primera entrega"}

        print("acceso")
        como(None)
        check("token sin eval → rechazado", not rpc("inicio").get("ok"))
        como("T904")
        check("inactivo → rechazado", not rpc("inicio").get("ok"))
        como("NOEXISTE")
        check("sin ficha → rechazado", not rpc("inicio").get("ok"))
        como("T900")
        r = rpc("inicio")
        check("colaborador entra", r.get("ok") and not r["bodega"] and len(r["mi"]) == 1 and r["mi"][0]["id"] == "mecanizado", r)
        check("matriz: 2 puestos en Mecanizado con EPP", len(r["mi"][0]["puestos"]) == 2 and len(r["mi"][0]["puestos"][0]["epp"]) == 7)
        check("catálogo con 40 artículos", len(r["catalogo"]) == 40)
        como("T905")
        check("dos áreas → las dos en inicio", sorted(a["id"] for a in rpc("inicio")["mi"]) == ["pintura", "taller_pesado_pulido"])
        como("T903")
        check("sin asignación → mi vacío", rpc("inicio")["mi"] == [])
        como("T900")
        check("no ve despacho", not rpc("despacho").get("ok"))
        check("no puede ingresar stock", not rpc("ingreso", eppId="guantes_anticorte", talla="M", cant=5).get("ok"))
        como("T902")
        check("área BODEGA sin cargo de bodega → no despacha", not rpc("inicio")["bodega"] and not rpc("despacho").get("ok"))
        como("T901")
        check("cargo de bodega → despacha", rpc("inicio")["bodega"] and rpc("despacho").get("ok"))
        como("T903", master=True)
        check("admin master → despacha", rpc("despacho").get("ok"))
        try:
            como("T900")
            cur.execute("SAVEPOINT s")
            cur.execute("SELECT * FROM historico.epp_solicitudes")
            check("tabla sin acceso directo", False)
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT s")
            check("tabla sin acceso directo", True)

        print("solicitar")
        como("T903")
        check("sin asignación → rechazado", "puesto" in rpc("solicitar", items=[linea("arnes", "Única")]).get("error", ""))
        como("T900")
        check("EPP de otra área → rechazado", "puesto" in rpc("solicitar", items=[linea("arnes", "Única")]).get("error", ""))
        como("T905")
        check("EPP de su segunda área → aceptado", rpc("solicitar", items=[linea("overol_pintura", "M")]).get("ok") and rpc("solicitar", items=[linea("arnes", "Única")]).get("ok"))
        como("T900")
        check("talla inválida → rechazada", "Talla" in rpc("solicitar", items=[linea("guantes_anticorte", "XXL")]).get("error", ""))
        check("cantidad 6 → rechazada", not rpc("solicitar", items=[linea(c=6)]).get("ok"))
        check("sin artículos → rechazada", not rpc("solicitar", items=[]).get("ok"))
        a = rpc("solicitar", items=[linea(c=2), linea("botas_puntera", "42")], comentario="x" * 400)
        check("solicitud creada", a.get("ok"), a)
        ida = a["id"]
        mia = rpc("inicio")["solicitudes"]
        check("aparece en mis solicitudes con 2 líneas", mia[0]["id"] == ida and len(mia[0]["items"]) == 2 and len(mia[0]["comentario"]) == 300)
        como("T903")
        check("otro no la cancela", not rpc("cancelar", id=ida).get("ok"))
        check("otro no ve la solicitud", all(s["id"] != ida for s in rpc("inicio")["solicitudes"]))

        print("despacho y stock")
        como("T901")
        check("no entrega sin preparar", not rpc("entregar", id=ida).get("ok"))
        check("preparar", rpc("preparar", id=ida).get("ok"))
        como("T900")
        check("ya no se puede cancelar", not rpc("cancelar", id=ida).get("ok"))
        como("T901")
        r = rpc("entregar", id=ida)
        check("sin stock → no entrega", "Sin stock" in r.get("error", ""), r)
        check("sigue PREPARADA", estado(ida)[0] == "PREPARADA")
        como("T901")
        check("ingreso negativo → rechazado", not rpc("ingreso", eppId="guantes_anticorte", talla="M", cant=-3).get("ok"))
        g0, c0 = stock("guantes_anticorte", "M"), stock("botas_puntera", "42")
        como("T901")
        rpc("ingreso", eppId="guantes_anticorte", talla="M", cant=1)
        rpc("ingreso", eppId="botas_puntera", talla="42", cant=4)
        check("stock parcial → no entrega nada", "Sin stock" in rpc("entregar", id=ida).get("error", "") and stock("botas_puntera", "42") == c0 + 4)
        como("T901")
        rpc("ingreso", eppId="guantes_anticorte", talla="M", cant=9)
        check("entrega sin firma", rpc("entregar", id=ida).get("ok"))
        check("queda ENTREGADA y baja stock", estado(ida)[0] == "ENTREGADA" and stock("guantes_anticorte", "M") == g0 + 8 and stock("botas_puntera", "42") == c0 + 3)

        print("firma")
        como("T901")
        check("recordatorio", rpc("recordar", id=ida).get("ok"))
        check("segundo recordatorio del día → rechazado", "hoy" in rpc("recordar", id=ida).get("error", ""))
        como("T903")
        check("otro no firma", not rpc("firmar", id=ida, firma=FIRMA).get("ok"))
        check("otro no ve la firma", not rpc("ver_firma", id=ida).get("ok"))
        como("T900")
        check("firma inválida → rechazada", not rpc("firmar", id=ida, firma="<script>").get("ok"))
        b = rpc("solicitar", items=[linea()])["id"]
        como("T901")
        rpc("preparar", id=b)
        check("con firma cubre la pendiente", rpc("entregar", id=b, firma=FIRMA, pendientes=[ida]).get("ok"))
        check("ambas firmadas en bodega", estado(ida) == ("CONFIRMADA", "BODEGA") and estado(b) == ("CONFIRMADA", "BODEGA"))
        como("T900")
        check("dueño ve su firma", rpc("ver_firma", id=b).get("firma") == FIRMA)
        d = rpc("solicitar", items=[linea()])["id"]
        como("T901")
        rpc("preparar", id=d)
        rpc("entregar", id=d)
        lista = rpc("despacho")["solicitudes"]
        check("la lista no lleva la firma", all("firma" not in s for s in lista))
        como("T900")
        check("firma desde la app", rpc("firmar", id=d, firma=FIRMA).get("ok") and estado(d) == ("CONFIRMADA", "APP"))

        print("otros")
        como("T900")
        e = rpc("solicitar", items=[linea()])["id"]
        como("T901")
        check("rechazo exige motivo", not rpc("rechazar", id=e).get("ok"))
        check("rechazar", rpc("rechazar", id=e, motivo="Sin stock").get("ok"))
        como("T900")
        f = rpc("solicitar", items=[linea()])["id"]
        check("cancelar", rpc("cancelar", id=f).get("ok"))
        check("acción desconocida", not rpc("nada").get("ok"))

        cur.execute("RESET ROLE")
        con.rollback()
    print(f"\n{'TODO OK' if not fallos else f'{fallos} FALLOS'} (nada quedó guardado)")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
