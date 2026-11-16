/**
 * TCONTROL · Fusión de dos fichas de la misma persona
 *
 * Caso: 2007 (ficha antigua, con contraseña, marcaciones y equipo a su cargo) y 2026 (ficha creada por registro
 * propio el 2026-11-11, con correo y fecha de nacimiento). Se conserva el ID 2007 y su estado de cargo "Sin Asistencia".
 *
 * Qué hace (mismo patrón que la migración de externos 2018–2022 → 9001–9005):
 *   - A la ficha que se conserva solo le completa los datos que le faltan (correo, fechaNacimiento, telefono,
 *     foto_url) con los de la otra. Nunca cambia nombre, área, cargo, rol, contraseña ni evaluación.
 *   - La ficha que se retira queda inactiva, sin teléfono, con migrado_a = <ID que se conserva> (la app y el panel
 *     siguen a migrado_a). Las reglas de Firestore impiden borrar fichas desde el navegador; esta queda como historial.
 *   - Si alguien tenía a la ficha retirada como evaluador o jefe inmediato, pasa a la que se conserva.
 *   - En la hoja EMPLEADOS: completa correo y nacimiento de la que se conserva si están vacíos; la retirada queda en
 *     ACTIVO = NO y sin teléfono.
 *   - SE DETIENE sin escribir nada si la ficha retirada tiene marcaciones, permisos, avisos, teléfonos vinculados o
 *     consumos de almuerzo (esos datos habría que moverlos aparte).
 *
 * Editor (▶): revisarFusion2007_2026()  → solo muestra qué haría
 *             fusionar2007_2026()       → lo aplica
 * Usa fetchFirestore_ (firestore_servidor.gs), leerEmpleadoFirestore_, listarEmpleadosFirestore_ y valorFirestore_.
 */

var FUSION_CAMPOS_COPIAR = ['correo', 'fechaNacimiento', 'telefono', 'foto_url'];
// Colecciones donde se busca algo ligado a la ficha que se retira: [colección, campo]
var FUSION_LIGADOS = [['registros', 'empleadoId'], ['solicitudes_permiso', 'empleadoId'], ['notificaciones', 'empleadoId'],
                      ['dispositivos', 'id_empleado'], ['consumo_almuerzos', 'empleadoId']];

function revisarFusion2007_2026() { return fusionarFichas_('2007', '2026', false); }
function fusionar2007_2026() { return fusionarFichas_('2007', '2026', true); }

function fusionVacio_(v) { return v === undefined || v === null || String(v).trim() === ''; }

function fusionContar_(coleccion, campo, id) {
  var res = fetchFirestore_(notifBaseFirestore_() + ':runQuery', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: coleccion }],
      where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: id } } },
      limit: 100 } })
  });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo consultar ' + coleccion + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText()).filter(function (r) { return r.document; }).length;
}

function fusionParchar_(id, campos) {
  var nombres = Object.keys(campos);
  var mask = nombres.map(function (c) { return 'updateMask.fieldPaths=' + encodeURIComponent(c); }).join('&');
  var fields = {};
  nombres.forEach(function (c) { fields[c] = valorFirestore_(campos[c]); });
  var r = fetchFirestore_(notifBaseFirestore_() + '/empleados/' + encodeURIComponent(id) + '?' + mask + '&currentDocument.exists=true', {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ fields: fields })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode() + ' al guardar ' + id + ': ' + r.getContentText().slice(0, 200));
}

function fusionarFichas_(conserva, retira, aplicar) {
  var a = leerEmpleadoFirestore_(conserva), b = leerEmpleadoFirestore_(retira);
  if (!a) return Logger.log('No existe la ficha ' + conserva);
  if (!b) return Logger.log('No existe la ficha ' + retira);
  Logger.log((aplicar ? 'FUSIÓN' : 'REVISIÓN (no se escribe nada)') + ': se conserva ' + conserva + ' (' + a.nombre + ', cargo "' + a.cargo + '") y se retira ' + retira + ' (' + b.nombre + ')');
  if (String(b.migrado_a || '') === conserva) return Logger.log('La ficha ' + retira + ' ya está fusionada con ' + conserva + '.');

  // 1) Nada ligado a la ficha que se retira
  var ligados = [];
  FUSION_LIGADOS.forEach(function (p) {
    var n = fusionContar_(p[0], p[1], retira);
    Logger.log('  ' + p[0] + ' de ' + retira + ': ' + n);
    if (n) ligados.push(p[0] + ' (' + n + ')');
  });
  if (ligados.length) return Logger.log('SE DETIENE: la ficha ' + retira + ' tiene datos ligados: ' + ligados.join(', ') + '. No se escribió nada.');

  // 2) Datos que se completan en la ficha que se conserva
  var copiar = {};
  FUSION_CAMPOS_COPIAR.forEach(function (c) { if (fusionVacio_(a[c]) && !fusionVacio_(b[c])) copiar[c] = String(b[c]); });
  Logger.log('  Se completan en ' + conserva + ': ' + (Object.keys(copiar).join(', ') || '(nada, ya los tiene)'));

  // 3) Quién tenía a la ficha retirada como evaluador o jefe inmediato
  var apuntan = listarEmpleadosFirestore_().filter(function (e) {
    return e.id !== retira && e.id !== conserva && (String(e.evaluador_id || '') === retira || String(e.jefe_inmediato_id || '') === retira);
  });
  Logger.log('  Fichas que apuntaban a ' + retira + ' como evaluador/jefe: ' + (apuntan.map(function (e) { return e.id; }).join(', ') || 'ninguna'));
  Logger.log('  Rol de evaluación de ' + conserva + ' se mantiene: ' + (a.evaluacion_rol || '(sin rol)') + (b.evaluacion_rol ? ' (' + retira + ' era ' + b.evaluacion_rol + ': no se copia)' : ''));

  if (!aplicar) return Logger.log('Revisión terminada. Si está bien, ejecuta fusionar' + conserva + '_' + retira + '().');

  // 4) Escribir
  var ahora = new Date().toISOString();
  var datosConserva = { fusionado_de: retira, fusion_en: ahora };
  Object.keys(copiar).forEach(function (c) { datosConserva[c] = copiar[c]; });
  fusionParchar_(conserva, datosConserva);
  fusionParchar_(retira, { activo: 'NO', telefono: '', migrado_a: conserva, fusion_en: ahora });
  apuntan.forEach(function (e) {
    var cambios = {};
    if (String(e.evaluador_id || '') === retira) cambios.evaluador_id = conserva;
    if (String(e.jefe_inmediato_id || '') === retira) { cambios.jefe_inmediato_id = conserva; cambios.jefe_inmediato = a.nombre || ''; }
    fusionParchar_(e.id, cambios);
  });

  // 5) Hoja EMPLEADOS
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
  if (hoja && hoja.getLastRow() > 1) {
    var C = COLUMNAS_EMPLEADOS, COL_CORREO = 11;
    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, Math.max(hoja.getLastColumn(), C.FECHA_NACIMIENTO + 1)).getValues();
    datos.forEach(function (f, i) {
      var id = String(f[C.ID] || '').trim();
      if (id === conserva) {
        if (fusionVacio_(f[COL_CORREO]) && copiar.correo) hoja.getRange(i + 2, COL_CORREO + 1).setValue(copiar.correo);
        if (fusionVacio_(f[C.FECHA_NACIMIENTO]) && copiar.fechaNacimiento) hoja.getRange(i + 2, C.FECHA_NACIMIENTO + 1).setValue(copiar.fechaNacimiento);
        if (fusionVacio_(f[C.TELEFONO]) && copiar.telefono) hoja.getRange(i + 2, C.TELEFONO + 1).setValue(copiar.telefono);
      } else if (id === retira) {
        hoja.getRange(i + 2, C.ACTIVO + 1).setValue('NO');
        hoja.getRange(i + 2, C.TELEFONO + 1).setValue('');
      }
    });
  }
  var cache = CacheService.getScriptCache();
  cache.remove('emp_acc_' + conserva); cache.remove('emp_acc_' + retira);
  if (typeof registrarAcceso_ === 'function') registrarAcceso_(conserva, 'fusionFichas', 'ok', 'fusionada con ' + retira);
  Logger.log('LISTO: ' + retira + ' quedó inactiva con migrado_a ' + conserva + '. Ejecuta revisarFusion' + conserva + '_' + retira + '() para comprobar.');
}
