/**
 * TCONTROL · Datos de nómina en la hoja EMPLEADOS
 *
 * Copia desde Firestore (empleados) a la hoja EMPLEADOS los datos de NOMINA_CARGO_JEFE:
 *   - columnas existentes:  P "Jefe Inmediato (APELLIDOS NOMBRES)"  y  R "NACIMINETO"
 *   - columnas nuevas al final (se crean si faltan): UNIDAD, AREA_NOMINA, CARGO_NOMINA,
 *     CARGO_CONTRATO, JEFE_INMEDIATO_ID, FECHA_INGRESO
 * No toca las demás columnas (ID, nombre, área, PIN, teléfono, cargo TCONTROL…) que usan otras funciones.
 *
 * Ejecutar desde el editor (▶): sincronizarNominaEnEmpleados()
 * Usa notifBaseFirestore_ (notificaciones.gs), EVAL_API_KEY_FIREBASE y camposFirestore_ (evaluacion_desempeno.gs).
 */

var NOMINA_COLUMNAS_NUEVAS = [
  ['UNIDAD', 'unidad'],
  ['AREA_NOMINA', 'area_nomina'],
  ['CARGO_NOMINA', 'cargo_nomina'],
  ['CARGO_CONTRATO', 'cargo_contrato'],
  ['JEFE_INMEDIATO_ID', 'jefe_inmediato_id'],
  ['FECHA_INGRESO', 'fecha_ingreso']
];

function sincronizarNominaEnEmpleados() {
  var empleados = leerEmpleadosFirestoreNomina_();
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
  if (!hoja) throw new Error('No existe la hoja ' + HOJA_EMPLEADOS);

  // Columnas nuevas: se buscan por encabezado; si no existen se agregan al final
  var ultimaCol = hoja.getLastColumn();
  var encabezados = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  var colDe = {};
  NOMINA_COLUMNAS_NUEVAS.forEach(function (par) {
    var idx = encabezados.indexOf(par[0]);
    if (idx === -1) {
      ultimaCol++;
      hoja.getRange(1, ultimaCol).setValue(par[0]).setFontWeight('bold');
      idx = ultimaCol - 1;
      encabezados[idx] = par[0];
    }
    colDe[par[1]] = idx;
  });
  var COL_JEFE = 15;        // P
  var COL_NACIMIENTO = COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO; // R

  var filas = hoja.getLastRow() - 1;
  if (filas < 1) return Logger.log('La hoja EMPLEADOS no tiene filas');
  var datos = hoja.getRange(2, 1, filas, ultimaCol).getValues();
  var actualizadas = 0, sinDatos = [];
  datos.forEach(function (fila) {
    var id = String(fila[COLUMNAS_EMPLEADOS.ID] || '').trim();
    var emp = id ? empleados[id] : null;
    if (!emp) { if (id) sinDatos.push(id); return; }
    var antes = JSON.stringify(fila);
    NOMINA_COLUMNAS_NUEVAS.forEach(function (par) { fila[colDe[par[1]]] = emp[par[1]] || ''; });
    if (emp.jefe_inmediato) fila[COL_JEFE] = emp.jefe_inmediato;
    if (emp.fechaNacimiento) fila[COL_NACIMIENTO] = emp.fechaNacimiento;
    if (JSON.stringify(fila) !== antes) actualizadas++;
  });
  hoja.getRange(2, 1, filas, ultimaCol).setValues(datos);
  Logger.log('Filas actualizadas: ' + actualizadas + ' de ' + filas +
    (sinDatos.length ? ' · sin documento en Firestore: ' + sinDatos.join(', ') : ''));
}

function leerEmpleadosFirestoreNomina_() {
  var out = {}, token = '';
  do {
    var url = notifBaseFirestore_() + '/empleados?pageSize=300&key=' + EVAL_API_KEY_FIREBASE + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Firestore respondió ' + res.getResponseCode());
    var cuerpo = JSON.parse(res.getContentText());
    (cuerpo.documents || []).forEach(function (d) {
      out[d.name.split('/').pop()] = camposFirestore_(d.fields || {});
    });
    token = cuerpo.nextPageToken || '';
  } while (token);
  return out;
}
