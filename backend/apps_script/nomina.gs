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

// ---------------------------------------------------------------- fecha de ingreso en CALCULAR_vacaciones
// La columna D (Fecha Ingreso) define los años de servicio (E) y los días del año (G). La fuente es la
// nómina (fecha_ingreso en Firestore). Colaboradores de la nómina sin fila: se agregan copiando las
// fórmulas de la última fila de colaborador (los valores escritos a mano quedan vacíos).

/** Solo informa en el registro qué cambiaría (no escribe). */
function revisarIngresoEnVacaciones() {
  ingresoEnVacaciones_(false);
}

/** Escribe las fechas de la nómina en la columna D y agrega las filas que faltan. */
function actualizarIngresoEnVacaciones() {
  ingresoEnVacaciones_(true);
}

function ingresoEnVacaciones_(aplicar) {
  var tz = Session.getScriptTimeZone();
  var empleados = leerEmpleadosFirestoreNomina_();
  var hoja = SpreadsheetApp.getActive().getSheetByName('CALCULAR_vacaciones');
  if (!hoja) throw new Error('No existe la hoja CALCULAR_vacaciones');
  var COL_FECHA = 4; // D
  var datos = hoja.getDataRange().getValues();
  var aFecha = function (iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
  var textoDe = function (v) {
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var m = String(v || '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : String(v || '').trim();
  };

  var enHoja = {}, ultimaFilaId = 0, cambios = [];
  for (var i = 1; i < datos.length; i++) {
    var id = String(datos[i][0] || '').trim();
    if (!/^\d+$/.test(id)) continue;
    enHoja[id] = true;
    ultimaFilaId = i + 1;
    var emp = empleados[id];
    if (!emp || !/^\d{4}-\d{2}-\d{2}$/.test(emp.fecha_ingreso || '')) continue;
    var actual = textoDe(datos[i][COL_FECHA - 1]);
    if (actual === emp.fecha_ingreso) continue;
    cambios.push(id + ' ' + (emp.nombre || '') + ': ' + (actual || '(vacía)') + ' → ' + emp.fecha_ingreso);
    if (aplicar) hoja.getRange(i + 1, COL_FECHA).setValue(aFecha(emp.fecha_ingreso));
  }

  // Colaboradores activos de la nómina (con unidad) que no tienen fila
  var faltan = Object.keys(empleados).filter(function (id) {
    var e = empleados[id];
    return !enHoja[id] && e.unidad && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha_ingreso || '') && String(e.activo || 'SI').toUpperCase() !== 'NO';
  });
  if (aplicar && faltan.length && ultimaFilaId) {
    var nCols = hoja.getLastColumn();
    var modelo = hoja.getRange(ultimaFilaId, 1, 1, nCols);
    var formulasModelo = modelo.getFormulas()[0];
    faltan.forEach(function (id, k) {
      var fila = ultimaFilaId + 1 + k;
      hoja.insertRowAfter(fila - 1);
      modelo.copyTo(hoja.getRange(fila, 1, 1, nCols));
      // Solo se conservan las fórmulas; los valores escritos a mano del modelo se vacían
      formulasModelo.forEach(function (f, c) { if (!f) hoja.getRange(fila, c + 1).clearContent(); });
      hoja.getRange(fila, 1).setValue(Number(id));
      hoja.getRange(fila, 2).setValue(empleados[id].nombre || '');
      hoja.getRange(fila, COL_FECHA).setValue(aFecha(empleados[id].fecha_ingreso));
    });
  }

  Logger.log((aplicar ? 'APLICADO' : 'REVISIÓN (sin cambios)') + ' · fechas distintas: ' + cambios.length +
    (cambios.length ? '\n  ' + cambios.join('\n  ') : '') +
    '\nFilas que faltan: ' + faltan.length + (faltan.length ? ' → ' + faltan.map(function (id) {
      return id + ' ' + (empleados[id].nombre || '') + ' (' + empleados[id].fecha_ingreso + ')';
    }).join(', ') : ''));
}

// ---------------------------------------------------------------- años de servicio (columna E)
// E = años cumplidos a la fecha de corte del encabezado de la hoja (31/12 del año en curso), calculados
// desde D. La columna G (días del año) la define RR.HH.: aquí solo se avisa a quién le cambiaron los años.

/** Solo informa qué años de servicio cambiarían. */
function revisarAniosServicioEnVacaciones() {
  aniosServicioEnVacaciones_(false);
}

/** Recalcula la columna E desde la fecha de ingreso (D). */
function actualizarAniosServicioEnVacaciones() {
  aniosServicioEnVacaciones_(true);
}

function aniosServicioEnVacaciones_(aplicar) {
  var hoja = SpreadsheetApp.getActive().getSheetByName('CALCULAR_vacaciones');
  if (!hoja) throw new Error('No existe la hoja CALCULAR_vacaciones');
  var COL_FECHA = 4, COL_ANIOS = 5; // D, E
  var corte = new Date(new Date().getFullYear(), 11, 31);
  var datos = hoja.getDataRange().getValues();
  var cambios = [];
  for (var i = 1; i < datos.length; i++) {
    var id = String(datos[i][0] || '').trim();
    var ingreso = datos[i][COL_FECHA - 1];
    if (!/^\d+$/.test(id) || !(ingreso instanceof Date) || isNaN(ingreso.getTime())) continue;
    var anios = corte.getFullYear() - ingreso.getFullYear();
    if (corte.getMonth() < ingreso.getMonth() || (corte.getMonth() === ingreso.getMonth() && corte.getDate() < ingreso.getDate())) anios--;
    anios = Math.max(0, anios);
    var actual = datos[i][COL_ANIOS - 1];
    if (actual !== '' && Number(actual) === anios) continue;
    cambios.push(id + ' ' + String(datos[i][1] || '') + ': ' + (actual === '' ? '(vacío)' : actual) + ' → ' + anios + ' años · revisar días del año (G): ' + datos[i][6]);
    if (aplicar) hoja.getRange(i + 1, COL_ANIOS).setValue(anios);
  }
  Logger.log((aplicar ? 'APLICADO' : 'REVISIÓN (sin cambios)') + ' · años de servicio distintos: ' + cambios.length +
    (cambios.length ? '\n  ' + cambios.join('\n  ') : ''));
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

// ---------------------------------------------------------------- duplicados en VACACIONES
// CALCULAR_vacaciones cuenta filas: un día registrado dos veces descuenta dos días.
// Duplicado = mismo ID (B), misma fecha (A) y mismo tipo (D). Se conserva la primera fila.

/** Solo informa en el registro qué filas sobran (no borra). */
function revisarDuplicadosVacaciones() {
  duplicadosVacaciones_(false);
}

/** Borra las filas repetidas de VACACIONES (de abajo hacia arriba) y deja la primera de cada día. */
function eliminarDuplicadosVacaciones() {
  duplicadosVacaciones_(true);
}

function duplicadosVacaciones_(aplicar) {
  var hoja = SpreadsheetApp.getActive().getSheetByName('VACACIONES');
  if (!hoja) throw new Error('No existe la hoja VACACIONES');
  var tz = Session.getScriptTimeZone();
  var datos = hoja.getDataRange().getValues();
  var fechaDe = function (v) {
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var s = String(v || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : s;
  };
  var vistos = {}, sobrantes = [];
  for (var i = 1; i < datos.length; i++) {
    var id = String(datos[i][1] || '').trim();
    var tipo = String(datos[i][3] || '').trim().toUpperCase();
    var fecha = fechaDe(datos[i][0]);
    if (!id || !tipo || !fecha) continue;
    var clave = id + '|' + fecha + '|' + tipo;
    if (vistos[clave]) sobrantes.push({ fila: i + 1, texto: id + ' ' + String(datos[i][2] || '') + ' ' + fecha + ' (repite la fila ' + vistos[clave] + ')' });
    else vistos[clave] = i + 1;
  }
  if (aplicar) {
    sobrantes.slice().sort(function (a, b) { return b.fila - a.fila; }).forEach(function (s) { hoja.deleteRow(s.fila); });
  }
  Logger.log((aplicar ? 'APLICADO · filas borradas: ' : 'REVISIÓN (sin cambios) · filas sobrantes: ') + sobrantes.length +
    (sobrantes.length ? '\n  ' + sobrantes.map(function (s) { return 'fila ' + s.fila + ': ' + s.texto; }).join('\n  ') : ''));
}
