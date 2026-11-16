/**
 * TCONTROL · Completa el nombre de la ficha 2023 (registro propio: figuraba como "JESSICA QUINGA").
 * El nombre completo sale de la matriz de EPP (nuevo/EPP_2026.xlsx): QUINGA CUICHAN JESSICA MARISELA.
 * Solo cambia el campo nombre en Firestore y en la hoja EMPLEADOS; no toca área, cargo, teléfono ni contraseña.
 *
 * Editor (▶): corregirNombre2023()   (se puede repetir: si ya está completo no hace nada)
 * Independiente: usa fetchFirestore_ y notifBaseFirestore_ (firestore_servidor.gs), valorFirestore_, leerEmpleadoFirestore_, HOJA_EMPLEADOS y COLUMNAS_EMPLEADOS.
 */
function corregirNombre2023() {
  var id = '2023', nuevo = 'QUINGA CUICHAN JESSICA MARISELA';
  var f = leerEmpleadoFirestore_(id);
  if (!f) return Logger.log('No existe la ficha ' + id);
  Logger.log('Ficha ' + id + ': "' + f.nombre + '" (' + f.area + ' · ' + f.cargo + ')');
  if (f.nombre === nuevo) return Logger.log('Ya tiene el nombre completo.');
  var r = fetchFirestore_(notifBaseFirestore_() + '/empleados/' + encodeURIComponent(id) + '?updateMask.fieldPaths=nombre&currentDocument.exists=true', {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ fields: { nombre: valorFirestore_(nuevo) } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS), filas = 0;
  if (hoja && hoja.getLastRow() > 1) {
    var C = COLUMNAS_EMPLEADOS, ids = hoja.getRange(2, C.ID + 1, hoja.getLastRow() - 1, 1).getValues();
    ids.forEach(function (r, i) {
      if (String(r[0]).trim() === id) { hoja.getRange(i + 2, C.NOMBRE + 1).setValue(nuevo); filas++; }
    });
  }
  CacheService.getScriptCache().remove('emp_acc_' + id);
  Logger.log('LISTO: nombre = "' + nuevo + '" · filas actualizadas en la hoja: ' + filas);
}
