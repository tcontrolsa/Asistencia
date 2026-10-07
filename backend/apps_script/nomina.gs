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

// ---------------------------------------------------------------- fórmulas de CALCULAR_vacaciones
// Solo lectura: muestra encabezados, fórmulas y, para algunos IDs, los valores de cada columna y
// cuántos días de VACACIONES tienen por año. Sirve para ver si la columna I (tomadas) cuenta
// también los días de años anteriores que ya descuenta la columna F (año anterior).
function revisarFormulasVacaciones() {
  var IDS = ['5', '1099', '1056', '1057', '34'];
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName('CALCULAR_vacaciones');
  if (!hoja) throw new Error('No existe la hoja CALCULAR_vacaciones');
  var tz = Session.getScriptTimeZone();
  var rango = hoja.getDataRange();
  var valores = rango.getDisplayValues();
  var formulas = rango.getFormulas();
  var letra = function (c) { return String.fromCharCode(65 + c); };
  var lineas = ['ENCABEZADOS: ' + valores[0].map(function (v, c) { return letra(c) + '=' + v; }).join(' | ')];

  // Fórmulas distintas por columna (normalmente se repiten fila a fila con otra referencia)
  for (var c = 0; c < valores[0].length; c++) {
    var vistas = {};
    for (var i = 1; i < formulas.length; i++) {
      var f = formulas[i][c];
      if (!f) continue;
      var patron = f.replace(/\d+/g, '#');
      if (!vistas[patron]) vistas[patron] = { ejemplo: 'fila ' + (i + 1) + ': ' + f, veces: 0 };
      vistas[patron].veces++;
    }
    Object.keys(vistas).forEach(function (p) {
      lineas.push('FÓRMULA ' + letra(c) + ' (' + vistas[p].veces + ' filas) · ' + vistas[p].ejemplo);
    });
  }

  // Días de VACACIONES por ID y año
  var vac = ss.getSheetByName('VACACIONES').getDataRange().getValues();
  var porAnio = {};
  for (var j = 1; j < vac.length; j++) {
    var id = String(vac[j][1] || '').trim();
    if (IDS.indexOf(id) < 0) continue;
    var v = vac[j][0];
    var anio = (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'yyyy') : String(v).slice(0, 4);
    var tipo = String(vac[j][3] || '').trim().toUpperCase();
    porAnio[id] = porAnio[id] || {};
    porAnio[id][anio + ' ' + tipo] = (porAnio[id][anio + ' ' + tipo] || 0) + 1;
  }

  for (var r = 1; r < valores.length; r++) {
    var idFila = String(valores[r][0] || '').trim();
    if (IDS.indexOf(idFila) < 0) continue;
    lineas.push('ID ' + idFila + ' (fila ' + (r + 1) + '): ' + valores[r].map(function (v, c) {
      return letra(c) + '=' + v + (formulas[r][c] ? ' [' + formulas[r][c] + ']' : '');
    }).join(' | '));
    lineas.push('   VACACIONES por año/tipo: ' + JSON.stringify(porAnio[idFila] || {}));
  }
  Logger.log('REVISIÓN (sin cambios)\n' + lineas.join('\n'));
}

// ---------------------------------------------------------------- tomadas solo del año en curso
// La columna I contaba todos los días de VACACIONES hasta hoy, también los de años anteriores,
// que ya están descontados en F (restantes del año anterior, valor manual de RR.HH.).
// La nueva fórmula cuenta solo desde el 1 de enero del año de la columna G.
var VAC_ANIO_ACTUAL = 2026;

function formulaTomadasAnio_(fila) {
  return '=COUNTIFS(VACACIONES!$B:$B;$A' + fila + ';VACACIONES!$D:$D;"VACACIONES";' +
    'VACACIONES!$A:$A;">="&DATE(' + VAC_ANIO_ACTUAL + ';1;1);VACACIONES!$A:$A;"<="&TODAY())';
}

/** Solo informa a quién le cambia el saldo y cuánto (no toca la hoja). */
function revisarTomadasDelAnio() {
  tomadasDelAnio_(false);
}

/** Reemplaza la fórmula de la columna I por la que cuenta solo el año en curso. */
function actualizarTomadasDelAnio() {
  tomadasDelAnio_(true);
}

function tomadasDelAnio_(aplicar) {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName('CALCULAR_vacaciones');
  if (!hoja) throw new Error('No existe la hoja CALCULAR_vacaciones');
  var COL_I = 9;
  var datos = hoja.getDataRange().getValues();
  var inicio = new Date(VAC_ANIO_ACTUAL, 0, 1);

  // Días de VACACIONES anteriores al año en curso (hasta hoy), por ID
  var vac = ss.getSheetByName('VACACIONES').getDataRange().getValues();
  var previos = {};
  for (var j = 1; j < vac.length; j++) {
    var f = vac[j][0];
    if (!(f instanceof Date) || isNaN(f.getTime()) || f >= inicio) continue;
    if (String(vac[j][3] || '').trim().toUpperCase() !== 'VACACIONES') continue;
    var id = String(vac[j][1] || '').trim();
    previos[id] = (previos[id] || 0) + 1;
  }

  var formulas = hoja.getDataRange().getFormulas();
  var cambios = [], omitidas = [], filas = 0;
  for (var i = 1; i < datos.length; i++) {
    var idFila = String(datos[i][0] || '').trim();
    if (!idFila) continue;
    var n = previos[idFila] || 0;
    if (n) {
      var j0 = Number(datos[i][9]);
      cambios.push(idFila + ' ' + String(datos[i][1] || '') + ': F (año anterior) = ' + datos[i][5] +
        ' · días antes de ' + VAC_ANIO_ACTUAL + ' contados en I: ' + n +
        ' · tomadas ' + datos[i][8] + ' → ' + (Number(datos[i][8]) - n) +
        ' · restantes ' + j0 + ' → ' + (j0 + n));
    }
    if (!aplicar) continue;
    // Se edita la fórmula existente (mismo separador que usa la hoja) agregando el límite de inicio de año
    var actual = formulas[i][COL_I - 1];
    if (actual.indexOf('DATE(' + VAC_ANIO_ACTUAL) >= 0) continue; // ya corregida
    var sep = actual.indexOf(';') >= 0 ? ';' : ',';
    var ancla = 'VACACIONES!$A:$A' + sep + '"<="&TODAY()';
    if (actual.indexOf(ancla) < 0) { omitidas.push(idFila + ' (fórmula distinta: ' + actual + ')'); continue; }
    hoja.getRange(i + 1, COL_I).setFormula(actual.replace(ancla,
      'VACACIONES!$A:$A' + sep + '">="&DATE(' + VAC_ANIO_ACTUAL + sep + '1' + sep + '1)' + sep + ancla));
    filas++;
  }
  var errores = [];
  if (aplicar) {
    SpreadsheetApp.flush();
    errores = hoja.getRange(2, COL_I, datos.length - 1, 1).getDisplayValues()
      .map(function (v) { return v[0]; }).filter(function (v) { return /^#/.test(v); });
  }
  Logger.log((aplicar ? 'APLICADO · fórmula de I corregida en ' + filas + ' filas' : 'REVISIÓN (sin cambios)') +
    ' · nueva fórmula (fila 2): ' + formulaTomadasAnio_(2) +
    '\nSaldos que cambian: ' + cambios.length + (cambios.length ? '\n  ' + cambios.join('\n  ') : '') +
    (omitidas.length ? '\nNo modificadas: ' + omitidas.join('; ') : '') +
    (errores.length ? '\n⚠ ' + errores.length + ' celdas de I con error (' + errores[0] + '): revisar la hoja' : ''));
}

// ---------------------------------------------------------------- FALTA sobre días de vacación
// Días que ya estaban en VACACIONES y a los que después un supervisor les registró una FALTA en
// REGISTROS (tipo FALTA, justificado SI, quién justifica "Supervisor", razón "FALTA"). La ficha
// los mostraba como falta aunque descuentan del saldo de vacaciones. Se borra solo esa fila FALTA;
// la vacación queda intacta.

/** Solo informa qué filas FALTA se borrarían (no toca la hoja). */
function revisarFaltasSobreVacaciones() {
  faltasSobreVacaciones_(false);
}

/** Copia las filas a la hoja RESPALDO_FALTAS_VACACIONES y las borra de REGISTROS. */
function eliminarFaltasSobreVacaciones() {
  faltasSobreVacaciones_(true);
}

function faltasSobreVacaciones_(aplicar) {
  var ss = SpreadsheetApp.getActive();
  var hojaReg = ss.getSheetByName(HOJA_REGISTROS);
  var hojaVac = ss.getSheetByName(HOJA_VACACIONES);
  if (!hojaReg || !hojaVac) throw new Error('No existen las hojas REGISTROS / VACACIONES');
  var tz = Session.getScriptTimeZone();
  var fechaDe = function (v) {
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var s = String(v || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : s;
  };
  var txt = function (v) { return String(v || '').trim().toUpperCase(); };

  // Días de vacación por ID
  var vac = hojaVac.getDataRange().getValues();
  var enVacacion = {};
  for (var j = 1; j < vac.length; j++) {
    if (txt(vac[j][3]) !== 'VACACIONES') continue;
    enVacacion[String(vac[j][1] || '').trim() + '|' + fechaDe(vac[j][0])] = true;
  }

  var datos = hojaReg.getDataRange().getValues();
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var r = datos[i];
    if (txt(r[COLUMNAS.TIPO]) !== 'FALTA') continue;
    if (txt(r[COLUMNAS.JUSTIFICADO]) !== 'SI' || txt(r[COLUMNAS.QUIEN_JUSTIFICA]) !== 'SUPERVISOR' || txt(r[COLUMNAS.RAZON_JUSTIFICAC]) !== 'FALTA') continue;
    var id = String(r[COLUMNAS.ID] || '').trim();
    var fecha = fechaDe(r[COLUMNAS.FECHA]);
    if (!enVacacion[id + '|' + fecha]) continue;
    filas.push({ fila: i + 1, valores: r, texto: id + ' ' + String(r[COLUMNAS.NOMBRE] || '') + ' · ' + fecha });
  }

  if (aplicar && filas.length) {
    // Mismo candado que archivarRegistros: no borrar mientras se archiva
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Hay un archivado en curso: vuelve a ejecutar en un minuto');
    try {
    // Con el candado tomado, confirmar que cada fila sigue siendo la misma (ID, fecha y tipo)
    var ancho = datos[0].length;
    filas = filas.filter(function (f) {
      var actual = hojaReg.getRange(f.fila, 1, 1, ancho).getValues()[0];
      return String(actual[COLUMNAS.ID] || '').trim() === String(f.valores[COLUMNAS.ID] || '').trim() &&
        fechaDe(actual[COLUMNAS.FECHA]) === fechaDe(f.valores[COLUMNAS.FECHA]) && txt(actual[COLUMNAS.TIPO]) === 'FALTA';
    });
    var nombreResp = 'RESPALDO_FALTAS_VACACIONES';
    var resp = ss.getSheetByName(nombreResp);
    if (!resp) {
      resp = ss.insertSheet(nombreResp);
      resp.appendRow(['FILA_ORIGEN', 'RESPALDADO_EN'].concat(datos[0]));
    }
    var ahora = new Date();
    filas.forEach(function (f) { resp.appendRow([f.fila, ahora].concat(f.valores)); });
    SpreadsheetApp.flush();
    filas.slice().sort(function (a, b) { return b.fila - a.fila; }).forEach(function (f) { hojaReg.deleteRow(f.fila); });
    } finally {
      lock.releaseLock();
    }
  }
  Logger.log((aplicar ? 'APLICADO · respaldadas en RESPALDO_FALTAS_VACACIONES y borradas: ' : 'REVISIÓN (sin cambios) · filas FALTA sobre días de vacación: ') +
    filas.length + (filas.length ? '\n  ' + filas.map(function (f) { return 'fila ' + f.fila + ': ' + f.texto; }).join('\n  ') : ''));
}
