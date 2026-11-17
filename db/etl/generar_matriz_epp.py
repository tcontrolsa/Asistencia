"""
Lee nuevo/EPP_2026.xlsx (matriz oficial de EPP) y genera, SIN datos personales:
  - db/postgres/epp_matriz.json  (modelo normalizado: áreas, puestos, EPP, cadencias)
  - JS/epp_matriz.js             (el mismo modelo, para la demostración local)
Las cédulas de cada área NO se guardan aquí: las asigna db/etl/cargar_epp_personas.py leyendo el Excel.

    python db/etl/generar_matriz_epp.py
"""
import json
import re
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parents[2]
XLSX = RAIZ / 'nuevo' / 'EPP_2026.xlsx'

S_ROPA = ['S', 'M', 'L', 'XL', 'XXL']
S_GUANTE = ['S', 'M', 'L', 'XL']
S_BOTA = [str(n) for n in range(35, 47)]
U = ['Única']
# id → (nombre, categoría, icono, tallas)
CAT = {
    'ropa_gabardina': ('Ropa de trabajo (overol gabardina)', 'Ropa', 'fa-shirt', S_ROPA),
    'ropa_jean': ('Ropa de trabajo (overol tipo jean)', 'Ropa', 'fa-shirt', S_ROPA),
    'ropa_camisa': ('Ropa de trabajo (camisa y pantalón)', 'Ropa', 'fa-shirt', S_ROPA),
    'ropa_ignifugo': ('Ropa de trabajo (gabardina o ignífugo)', 'Ropa', 'fa-shirt', S_ROPA),
    'overol_pintura': ('Overol de pintura', 'Ropa', 'fa-shirt', S_ROPA),
    'traje_sandblasting': ('Traje de protección para sandblasting', 'Ropa', 'fa-user-shield', S_ROPA),
    'mandil_cuero': ('Mandil de cuero', 'Ropa', 'fa-vest', U),
    'mangas_cuero': ('Mangas de cuero', 'Ropa', 'fa-vest', U),
    'guantes_anticorte': ('Guantes anticorte', 'Manos', 'fa-mitten', S_GUANTE),
    'guantes_estibaje': ('Guantes de estibaje', 'Manos', 'fa-mitten', S_GUANTE),
    'guantes_cuero': ('Guantes de cuero (napa)', 'Manos', 'fa-mitten', S_GUANTE),
    'guantes_antiimpacto': ('Guantes anti impacto', 'Manos', 'fa-mitten', S_GUANTE),
    'guantes_nitrilo': ('Guantes de nitrilo', 'Manos', 'fa-mitten', S_GUANTE),
    'guantes_dielectricos': ('Guantes dieléctricos', 'Manos', 'fa-bolt', S_GUANTE),
    'botas_puntera': ('Botas de seguridad con puntera', 'Pies', 'fa-shoe-prints', S_BOTA),
    'botas_dielectricas': ('Botas de seguridad dieléctricas', 'Pies', 'fa-shoe-prints', S_BOTA),
    'botas_caucho': ('Botas de caucho', 'Pies', 'fa-shoe-prints', S_BOTA),
    'rodillera': ('Rodilleras', 'Cuerpo', 'fa-shield', U),
    'casco': ('Casco de seguridad', 'Cabeza', 'fa-hard-hat', U),
    'casco_sandblasting': ('Casco para sandblasting', 'Cabeza', 'fa-hard-hat', U),
    'capucha_suelda': ('Capucha para suelda', 'Cabeza', 'fa-hard-hat', U),
    'gafas': ('Gafas de seguridad', 'Ojos y rostro', 'fa-glasses', U),
    'gafas_laser': ('Gafas con protección para rayos láser', 'Ojos y rostro', 'fa-glasses', U),
    'gafas_uv': ('Gafas con protección UV', 'Ojos y rostro', 'fa-glasses', U),
    'pantalla_facial': ('Pantalla facial', 'Ojos y rostro', 'fa-head-side-mask', U),
    'careta_suelda': ('Careta para suelda', 'Ojos y rostro', 'fa-head-side-mask', U),
    'careta_suelda_tubular': ('Careta para suelda tubular', 'Ojos y rostro', 'fa-head-side-mask', U),
    'careta_suelda_laser': ('Careta para suelda láser', 'Ojos y rostro', 'fa-head-side-mask', U),
    'careta_suelda_mig': ('Careta para suelda MIG', 'Ojos y rostro', 'fa-head-side-mask', U),
    'micas_suaves': ('Micas suaves (sandblasting)', 'Ojos y rostro', 'fa-glasses', U),
    'micas_duras': ('Micas duras (sandblasting)', 'Ojos y rostro', 'fa-glasses', U),
    'auditiva': ('Protección auditiva (tapones)', 'Oídos', 'fa-ear-deaf', U),
    'mascarilla_media': ('Mascarilla media cara', 'Respiración', 'fa-lungs', U),
    'cartuchos_p100': ('Cartuchos P100', 'Respiración', 'fa-lungs', U),
    'mascarilla_n95': ('Mascarilla N95', 'Respiración', 'fa-lungs', U),
    'filtro_inorganico': ('Filtro para vapores inorgánicos (amarillo 6003)', 'Respiración', 'fa-lungs', U),
    'filtro_organico': ('Filtro para vapores orgánicos (negro 6001)', 'Respiración', 'fa-lungs', U),
    'respirador_full': ('Respirador full face', 'Respiración', 'fa-lungs', U),
    'arnes': ('Arnés de seguridad', 'Altura', 'fa-person-falling', U),
    'eslinga': ('Eslinga', 'Altura', 'fa-person-falling', U),
}

# texto normalizado del Excel → id de catálogo
IGUALES = {
    'overol de pintura': 'overol_pintura', 'mandil de cuero': 'mandil_cuero', 'mangas de cuero': 'mangas_cuero',
    'guantes anticorte': 'guantes_anticorte', 'guantes de estibaje': 'guantes_estibaje',
    'guantes anti impacto': 'guantes_antiimpacto', 'botas de seguridad dielectrica': 'botas_dielectricas',
    'botas de caucho': 'botas_caucho', 'rodillera': 'rodillera', 'casco de seguridad': 'casco', 'casco': 'casco',
    'casco para sandblasting': 'casco_sandblasting', 'capucha para suelda': 'capucha_suelda',
    'gafas de seguridad': 'gafas', 'gafas de seguridad con proteccion uv': 'gafas_uv', 'pantalla facial': 'pantalla_facial',
    'careta para suelda tubular': 'careta_suelda_tubular', 'careta para suelda laser': 'careta_suelda_laser',
    'careta para suelda mig': 'careta_suelda_mig', 'careta para suelda': 'careta_suelda',
    'micas suaves': 'micas_suaves', 'micas duras': 'micas_duras',
    'tapon auditivo': 'auditiva', 'proteccion auditiva': 'auditiva',
    'mascarilla media cara': 'mascarilla_media', 'cartuchos p100': 'cartuchos_p100',
    'mascarillas n95': 'mascarilla_n95', 'mascarilla n95': 'mascarilla_n95',
    'respirador full face': 'respirador_full', 'arnes': 'arnes', 'eslinga': 'eslinga',
    'botas de seguridad con puntera': 'botas_puntera', 'botas punta de acero': 'botas_puntera', 'botas de seguridad': 'botas_puntera',
}
EMPIEZA = [
    ('ropa de trabajo (overol gabardina', 'ropa_gabardina'), ('ropa de trabajo (tipo jean', 'ropa_jean'),
    ('ropa de trabajo (overol tipo jean', 'ropa_jean'), ('ropa de trabajo (camisa y pantalon', 'ropa_camisa'),
    ('ropa de trabajo (gabardina o ignifugo', 'ropa_ignifugo'), ('traje de proteccion para sandblasting', 'traje_sandblasting'),
    ('guantes de cuero', 'guantes_cuero'), ('guantes de nitrilo', 'guantes_nitrilo'), ('guantes dielectricos', 'guantes_dielectricos'),
    ('gafas de seguridad con proteccion para rayos laser', 'gafas_laser'),
    ('filtro para vapores inorganicos', 'filtro_inorganico'), ('filtro para vapores organicos', 'filtro_organico'),
]


def sin_tildes(t):
    for a, b in zip('áéíóúü', 'aeiouu'):
        t = t.replace(a, b)
    return t


def ident(txt):
    t = sin_tildes(re.sub(r'\s+', ' ', txt.lower()).strip())
    if t in IGUALES:
        return IGUALES[t]
    for pref, eid in EMPIEZA:
        if t.startswith(pref):
            return eid
    raise ValueError('EPP sin catálogo: %r' % txt)


def dias(txt):
    t = txt.lower().replace('•', '').strip()
    if 'hora' in t:
        return 1
    m = re.match(r'(\d+)\s*(d[ií]a|semana|mes|a[nñ]o)', t)
    if not m:
        raise ValueError('Duración no entendida: %r' % txt)
    return int(m.group(1)) * {'d': 1, 's': 7, 'm': 30, 'a': 365}[m.group(2)[0]]


def partes(celda):
    return [x.strip() for x in re.split(r'\n|•', str(celda or '')) if x.strip()]


# Artículos de uso diario: se piden en más cantidad
CONSUMIBLES = {'guantes_nitrilo', 'micas_suaves', 'micas_duras', 'mascarilla_n95', 'guantes_cuero'}


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def escribir_sql(modelo):
    L = ['-- Generado por db/etl/generar_matriz_epp.py desde nuevo/EPP_2026.xlsx. Re-ejecutable: actualiza la matriz, no toca stock ni solicitudes.',
         '-- Requiere 016_epp.sql.',
         '-- Actualiza la versión provisional (catálogo por meses y perfiles por cargo) si todavía existe. Se detiene si ya hay movimientos reales.',
         'DO $mig$ BEGIN',
         "  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'historico' AND table_name = 'epp_catalogo' AND column_name = 'vida_meses') THEN",
         '    IF EXISTS (SELECT 1 FROM historico.epp_solicitudes) OR EXISTS (SELECT 1 FROM historico.epp_movimientos) THEN',
         "      RAISE EXCEPTION 'Hay solicitudes o movimientos con el catálogo provisional: migrar a mano';",
         '    END IF;',
         '    DELETE FROM historico.epp_stock;',
         '    DELETE FROM historico.epp_catalogo;',
         '    ALTER TABLE historico.epp_catalogo DROP COLUMN vida_meses;',
         '    ALTER TABLE historico.epp_catalogo ADD COLUMN IF NOT EXISTS stock_min integer NOT NULL DEFAULT 2;',
         '    ALTER TABLE historico.epp_catalogo ADD COLUMN IF NOT EXISTS max_cant integer NOT NULL DEFAULT 5;',
         '    ALTER TABLE historico.epp_items DROP CONSTRAINT IF EXISTS epp_items_cant_check;',
         '    ALTER TABLE historico.epp_items ADD CONSTRAINT epp_items_cant_check CHECK (cant BETWEEN 1 AND 50);',
         '  END IF;',
         'END $mig$;',
         'DROP FUNCTION IF EXISTS historico.epp_perfil(text);',
         'DROP TABLE IF EXISTS historico.epp_perfiles;']
    for i, c in enumerate(modelo['catalogo']):
        maxc = 20 if c['id'] in CONSUMIBLES else 5
        tallas = '{' + ','.join(c['tallas']) + '}'
        L.append('INSERT INTO historico.epp_catalogo (id, nombre, categoria, icono, tallas, stock_min, max_cant, orden) VALUES (%s, %s, %s, %s, %s, %d, %d, %d) '
                 'ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, categoria = EXCLUDED.categoria, icono = EXCLUDED.icono, tallas = EXCLUDED.tallas, '
                 'max_cant = EXCLUDED.max_cant, orden = EXCLUDED.orden, activo = true;' % (
                     q(c['id']), q(c['nombre']), q(c['categoria']), q(c['icono']), q(tallas), c['stockMin'], maxc, (i + 1) * 10))
    L.append('DELETE FROM historico.epp_puesto_items;')
    L.append('DELETE FROM historico.epp_puestos;')
    for n, a in enumerate(modelo['areas']):
        L.append('INSERT INTO historico.epp_areas (id, nombre, orden) VALUES (%s, %s, %d) '
                 'ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden;' % (q(a['id']), q(a['nombre']), (n + 1) * 10))
        for m, p in enumerate(a['puestos']):
            pid = '%s-%d' % (a['id'], m + 1)
            L.append('INSERT INTO historico.epp_puestos (id, area_id, nombre, actividad, orden) VALUES (%s, %s, %s, %s, %d);' % (
                q(pid), q(a['id']), q(p['nombre']), q(p['actividad']), (m + 1) * 10))
            for k, e in enumerate(p['epp']):
                L.append('INSERT INTO historico.epp_puesto_items (puesto_id, epp_id, tipo, dias, texto, riesgo, obs, orden) VALUES (%s, %s, %s, %d, %s, %s, %s, %d);' % (
                    q(pid), q(e['eppId']), q(e['tipo']), e['duracionDias'], q(e['duracionTexto']), q(e['riesgo']), q(e['obs']), (k + 1) * 10))
    L.append('INSERT INTO historico.epp_stock (epp_id, talla, minimo) SELECT c.id, t, c.stock_min FROM historico.epp_catalogo c, unnest(c.tallas) t '
             'ON CONFLICT (epp_id, talla) DO NOTHING;')
    L += ["NOTIFY pgrst, 'reload schema';", '']
    (RAIZ / 'db' / 'postgres' / '017_epp_matriz.sql').write_text('\n'.join(L), encoding='utf-8')


def main():
    ws = openpyxl.load_workbook(XLSX, data_only=True)['LISTA MAESTRA EPPs']
    rows = list(ws.iter_rows(values_only=True))
    areas, a, pu = [], None, None
    for r in rows[7:]:
        if not any(c is not None for c in r):
            continue
        if r[0] is None and r[3] and not r[7]:
            nombre = re.sub(r'^[ÁA]rea de ', '', r[3].strip())
            clave = re.sub(r'[^a-z]+', '_', sin_tildes(nombre.lower())).strip('_')
            a = {'id': clave, 'nombre': nombre, 'puestos': []}
            areas.append(a)
            continue
        if r[0] in ('CI', 'ID') or a is None:
            continue
        if r[4] or r[0]:
            pu = {'nombre': (r[4] or '').strip() or a['nombre'], 'actividad': ' · '.join(partes(r[5])), 'epp': []}
            a['puestos'].append(pu)
        if r[7]:
            nombres = [x.strip() for x in re.split(r'\n|•|(?<=cara)\s{2,}', str(r[7])) if x.strip()]
            durs = partes(r[10])
            for i, n in enumerate(nombres):
                d = durs[i] if i < len(durs) else (durs[-1] if durs else None)
                pu['epp'].append({
                    'eppId': ident(n), 'riesgo': (r[6] or '').strip().replace('\n', ' / '),
                    'tipo': 'Condicional' if str(r[12]).strip().lower().startswith('cond') else 'Obligatorio',
                    'duracionDias': dias(d) if d else 365, 'duracionTexto': d.replace('•', '').strip() if d else '1 año',
                    'obs': str(r[13]).replace('\n', ' ').replace('•', '').strip() if r[13] else '',
                    'min': r[8] if isinstance(r[8], (int, float)) else None})
    usados = {}
    for ar in areas:
        for p in ar['puestos']:
            sin_repetir = []
            for e in p['epp']:
                if all(e['eppId'] != x['eppId'] for x in sin_repetir):
                    sin_repetir.append(e)
            p['epp'] = sin_repetir
            for e in p['epp']:
                u = usados.setdefault(e['eppId'], {'min': 0})
                u['min'] = max(u['min'], e['min'] or 0)
    catalogo = [{'id': k, 'nombre': v[0], 'categoria': v[1], 'icono': v[2], 'tallas': v[3], 'stockMin': usados[k]['min'], 'maxCant': 20 if k in CONSUMIBLES else 5}
                for k, v in CAT.items() if k in usados]
    modelo = {'catalogo': catalogo, 'areas': areas}
    (RAIZ / 'db' / 'postgres' / 'epp_matriz.json').write_text(json.dumps(modelo, ensure_ascii=False, indent=1), encoding='utf-8')
    (RAIZ / 'JS' / 'epp_matriz.js').write_text(
        '// Matriz oficial de EPP 2026 (generada por db/etl/generar_matriz_epp.py desde nuevo/EPP_2026.xlsx). Sin datos personales.\n'
        'window.EppMatriz = ' + json.dumps(modelo, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    escribir_sql(modelo)
    print('artículos', len(catalogo), '| áreas', len(areas), '| puestos', sum(len(x['puestos']) for x in areas))
    for ar in areas:
        for p in ar['puestos']:
            print('  %s / %s: ' % (ar['nombre'], p['nombre']) + ', '.join(
                '%s(%sd%s)' % (e['eppId'], e['duracionDias'], '*' if e['tipo'] == 'Condicional' else '') for e in p['epp']))


main()
