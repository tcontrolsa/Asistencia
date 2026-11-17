"""
Asigna cada persona de la matriz de EPP (nuevo/EPP_2026.xlsx, columna A = ID de usuario) a su(s) área(s)
en historico.epp_asignaciones. Verifica que cada ID exista y esté activo en historico.empleados.

    python db/etl/cargar_epp_personas.py            # solo informa (no escribe)
    python db/etl/cargar_epp_personas.py --aplicar  # reemplaza las asignaciones (requiere 016 y 017 aplicados)
"""
import os
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrar_sheets_a_postgres import conectar, leer_env_local  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
XLSX = RAIZ / 'nuevo' / 'EPP_2026.xlsx'


def sin_tildes(t):
    return t.upper().translate(str.maketrans('ÁÉÍÓÚÜ', 'AEIOUU'))


def leer_matriz():
    """→ {area_id: [(id, apellidos, nombres)]}; el ID va en la columna A, una línea por persona"""
    filas = list(openpyxl.load_workbook(XLSX, data_only=True).active.iter_rows(values_only=True))
    por_area, area = {}, None
    for r in filas[7:]:
        if not any(c is not None for c in r):
            continue
        if r[0] is None and r[3] and not r[7] and not r[1]:
            nombre = re.sub(r'^[ÁA]rea de ', '', r[3].strip())
            area = re.sub(r'[^a-z]+', '_', sin_tildes(nombre).lower()).strip('_')
            por_area[area] = []
        elif r[1] and r[1] != 'Apellidos' and area:
            ids = str(r[0] or '').split('\n')
            aps = str(r[1]).split('\n')
            nos = str(r[2] or '').split('\n')
            for i, ap in enumerate(aps):
                por_area[area].append((ids[i].strip() if i < len(ids) else '', ap.strip(), nos[i].strip() if i < len(nos) else ''))
    return por_area


def main():
    leer_env_local()
    por_area = leer_matriz()
    with conectar() as con, con.cursor() as cur:
        cur.execute('SELECT id, nombre, activo FROM historico.empleados')
        emp = {e[0]: e for e in cur.fetchall()}
        asign, problemas = [], []
        for area, personas in por_area.items():
            for pid, ap, no in personas:
                if not pid:
                    problemas.append((area, ap, no, 'sin ID en la columna A'))
                elif pid not in emp:
                    problemas.append((area, ap, no, 'el ID %s no existe en empleados' % pid))
                elif not emp[pid][2]:
                    problemas.append((area, ap, no, 'el ID %s está inactivo' % pid))
                else:
                    asign.append((pid, area))
        print('Áreas:', len(por_area), '| asignaciones:', len(set(asign)), '| personas distintas:', len({a[0] for a in asign}))
        print('Problemas:', len(problemas))
        for p in problemas:
            print('   ', p)
        if '--aplicar' not in sys.argv:
            print('Nada escrito. Para aplicar: --aplicar')
            return
        if problemas:
            print('No se aplica mientras haya problemas.')
            return
        cur.execute('DELETE FROM historico.epp_asignaciones')
        for emp_id, area in sorted(set(asign)):
            cur.execute('INSERT INTO historico.epp_asignaciones (empleado_id, area_id) VALUES (%s, %s)', (emp_id, area))
        con.commit()
        print('Asignaciones guardadas:', len(set(asign)))


main()
