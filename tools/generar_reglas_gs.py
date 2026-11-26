"""Copia JS/reglas_jornada.js a backend/apps_script/reglas_jornada.gs para Apps Script (cargo_jornada.gs).

Correr cada vez que cambie JS/reglas_jornada.js:  python tools/generar_reglas_gs.py
"""
import io, os
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js = io.open(os.path.join(raiz, 'JS', 'reglas_jornada.js'), encoding='utf-8').read()
cab = ('/**\n * NO EDITAR: copia de JS/reglas_jornada.js generada con tools/generar_reglas_gs.py.\n'
       ' * Apps Script no tiene window: se usa el objeto global (cargo_jornada.gs llama a window.ReglasJornada).\n */\n'
       'var window = (typeof window !== \'undefined\') ? window : globalThis;\n\n')
io.open(os.path.join(raiz, 'backend', 'apps_script', 'reglas_jornada.gs'), 'w', encoding='utf-8', newline='\n').write(cab + js)
print('reglas_jornada.gs actualizado')
