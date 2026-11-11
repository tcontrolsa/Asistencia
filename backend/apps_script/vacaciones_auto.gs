/**
 * TCONTROL · Saldos de vacaciones automáticos (hoja CALCULAR_vacaciones) · 2026-10-29
 *
 * Reglas (definidas por el usuario el 29/10/2026):
 *   E  Años de servicio  = años cumplidos al 31/12 del año de vacaciones, desde la fecha de ingreso (D)
 *   G  Días del año      = 0 con menos de 1 año; 11 (15 días calendario) y, desde el 6.º año, 1 día más por año
 *                          (máximo 15 adicionales): 6 años = 12, 13 años = 19, 16 años = 22
 *   I  Tomadas           = días de VACACIONES del período 1/dic del año anterior → 30/nov del año (hasta hoy):
 *                          las de diciembre se descuentan del año siguiente (como diciembre 2025 en 2026)
 *                          + 1 día por cada 8 h de permiso personal cargadas a vacaciones (hoja VACACIONES_HORAS, 2026-11-11)
 *   H = F + G,  J = H − I,  K = fechas tomadas del período.   F (saldo anterior) lo pone el cierre de año.
 * El año de vacaciones está en una sola celda (rango con nombre VAC_ANIO, celda M1): las fórmulas no tienen
 * el año escrito. La app y la foto diaria de Postgres leen F–J por posición: las columnas no se mueven.
 *
 * Desde el editor (▶):
 *   1. revisarVacacionesAuto()      NO cambia nada: muestra por persona qué valores cambiarían
 *   2. aplicarVacacionesAuto()      pone las fórmulas en todas las filas y crea VAC_ANIO
 *   3. instalarVacacionesAuto()     activador diario (06:30): actualiza y hace el cierre de año el 1 de enero
 *   revisarCierreAnioVacaciones()   muestra cómo quedaría el año siguiente (sin cambios)
 *
 * Usa ingresoEnVacaciones_ y leerEmpleadosFirestoreNomina_ (nomina.gs) y crearNotificacion_ (notificaciones.gs).
 */

var VAC_HOJA = 'CALCULAR_vacaciones';
var VAC_CELDA_ANIO = 'M1';                 // valor del año; L1 lleva la etiqueta
var VAC_ANIO_INICIAL = 2026;
var VAC_ARCHIVO_HISTORICO = 'HISTORICO_VACACIONES';   // libro aparte con una hoja por año cerrado
// Horas de permiso personal cargadas a vacaciones (fase 2 de permisos, 2026-11-11): las escribe
// permisos_escalado.gs desde Firestore. Cada 480 min (8 h) acumulados en el año cuentan como 1 día tomado (columna I).
var VAC_HOJA_HORAS = 'VACACIONES_HORAS';
var VAC_MIN_DIA = 480;
// Columnas (1 = A)
var VC = { ID: 1, NOMBRE: 2, INGRESO: 4, ANIOS: 5, ANTERIOR: 6, DEL_ANIO: 7, TOTAL: 8, TOMADAS: 9, RESTANTES: 10, FECHAS: 11 };

// ---------------------------------------------------------------- reglas (iguales en las fórmulas y en la revisión)
function vacAnios_(ingreso, anio) {
  if (!(ingreso instanceof Date) || isNaN(ingreso.getTime())) return null;
  var a = anio - ingreso.getFullYear();               // al 31/12 del año: el aniversario ya pasó
  return Math.max(0, a);
}
function vacDiasDelAnio_(anios) {
  if (anios === null || anios < 1) return 0;
  return 11 + Math.min(15, Math.max(0, anios - 5));
}
function vacPeriodo_(anio) {
  return { inicio: new Date(anio - 1, 11, 1), fin: new Date(anio, 10, 30, 23, 59, 59) };
}

// Fórmulas de una fila (sep: separador de argumentos de la hoja)
function vacFormulas_(f, sep) {
  var s = sep;
  var ini = 'DATE(VAC_ANIO-1' + s + '12' + s + '1)';
  var fin = 'MIN(TODAY()' + s + 'DATE(VAC_ANIO' + s + '11' + s + '30))';
  return {
    E: '=IF($D' + f + '=""' + s + '""' + s + 'MAX(0' + s + 'VAC_ANIO-YEAR($D' + f + ')))',
    G: '=IF($E' + f + '=""' + s + '""' + s + 'IF($E' + f + '<1' + s + '0' + s + '11+MIN(15' + s + 'MAX(0' + s + '$E' + f + '-5))))',
    H: '=N($F' + f + ')+N($G' + f + ')',
    I: '=COUNTIFS(VACACIONES!$B:$B' + s + '$A' + f + s + 'VACACIONES!$D:$D' + s + '"VACACIONES"' + s +
       'VACACIONES!$A:$A' + s + '">="&' + ini + s + 'VACACIONES!$A:$A' + s + '"<="&' + fin + ')' +
       '+IFERROR(INT(SUMIFS(' + VAC_HOJA_HORAS + '!$C:$C' + s + VAC_HOJA_HORAS + '!$B:$B' + s + '$A' + f + '&""' + s +
       VAC_HOJA_HORAS + '!$A:$A' + s + '">="&' + ini + s + VAC_HOJA_HORAS + '!$A:$A' + s + '"<="&DATE(VAC_ANIO' + s + '11' + s + '30)' + ')/' + VAC_MIN_DIA + ')' + s + '0)',
    J: '=$H' + f + '-$I' + f,
    K: '=IFERROR(TEXTJOIN(", "' + s + 'TRUE' + s + 'ARRAYFORMULA(TEXT(SORT(FILTER(VACACIONES!$A:$A' + s +
       'VACACIONES!$B:$B&""=$A' + f + '&""' + s + 'VACACIONES!$D:$D="VACACIONES"' + s + 'ISNUMBER(VACACIONES!$A:$A)' + s +
       'VACACIONES!$A:$A>=' + ini + s + 'VACACIONES!$A:$A<=' + fin + '))' + s + '"dd/mm/yyyy")))' + s + '"")'
  };
}

// ---------------------------------------------------------------- lectura común
function vacHoja_() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(VAC_HOJA);
  if (!hoja) throw new Error('No existe la hoja ' + VAC_HOJA);
  return hoja;
}
function vacAnioActual_() {
  var r = SpreadsheetApp.getActive().getRangeByName('VAC_ANIO');
  var v = r ? Number(r.getValue()) : 0;
  return v > 2000 ? v : VAC_ANIO_INICIAL;
}
function vacSeparador_(hoja) {
  var fs = hoja.getRange(2, VC.TOMADAS, Math.max(1, hoja.getLastRow() - 1), 1).getFormulas();
  for (var i = 0; i < fs.length; i++) if (fs[i][0]) return fs[i][0].indexOf(';') >= 0 ? ';' : ',';
  return ';';
}
// Filas de colaboradores: ID numérico en A
function vacFilas_(hoja) {
  var datos = hoja.getDataRange().getValues();
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    if (/^\d+$/.test(String(datos[i][VC.ID - 1] || '').trim())) filas.push({ fila: i + 1, v: datos[i] });
  }
  return filas;
}
// Días de VACACIONES por ID dentro del período (fechas reales; duplicados se cuentan como hoy)
function vacTomadas_(anio) {
  var vac = SpreadsheetApp.getActive().getSheetByName(HOJA_VACACIONES).getDataRange().getValues();
  var p = vacPeriodo_(anio), hoy = new Date();
  var fin = hoy < p.fin ? hoy : p.fin;
  var out = {}, dup = {}, vistos = {}, tz = Session.getScriptTimeZone();
  for (var j = 1; j < vac.length; j++) {
    var f = vac[j][0];
    if (!(f instanceof Date) || isNaN(f.getTime()) || f < p.inicio || f > fin) continue;
    if (String(vac[j][3] || '').trim().toUpperCase() !== 'VACACIONES') continue;
    var id = String(vac[j][1] || '').trim();
    out[id] = (out[id] || 0) + 1;
    var clave = id + '|' + Utilities.formatDate(f, tz, 'yyyy-MM-dd');
    if (vistos[clave]) dup[id] = (dup[id] || []).concat(Utilities.formatDate(f, tz, 'dd/MM/yyyy'));
    vistos[clave] = true;
  }
  return { porId: out, duplicados: dup };
}

// La hoja de horas debe existir ANTES de escribir las fórmulas: una fórmula que nombra una hoja inexistente queda
// rota (#REF, oculto por IFERROR) aunque la hoja se cree después. Mismas columnas que permisos_escalado.gs.
function vacAsegurarHojaHoras_() {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(VAC_HOJA_HORAS);
  if (hoja) return hoja;
  hoja = ss.insertSheet(VAC_HOJA_HORAS);
  hoja.getRange(1, 1, 1, 6).setValues([['FECHA', 'ID', 'MINUTOS', 'SOLICITUD', 'NOMBRE', 'REGISTRADO']]).setFontWeight('bold');
  hoja.getRange('B:B').setNumberFormat('@');
  hoja.setFrozenRows(1);
  return hoja;
}

// Días completos por horas de permiso personal cargadas a vacaciones (8 h = 1 día) en el año de vacaciones
function vacHorasCargadas_(anio) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(VAC_HOJA_HORAS);
  var out = {};
  if (!hoja || hoja.getLastRow() < 2) return out;
  var p = vacPeriodo_(anio), min = {};
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 3).getValues().forEach(function (f) {
    if (!(f[0] instanceof Date) || f[0] < p.inicio || f[0] > p.fin) return;
    var id = String(f[1] || '').trim();
    min[id] = (min[id] || 0) + (Number(f[2]) || 0);
  });
  Object.keys(min).forEach(function (id) { out[id] = Math.floor(min[id] / VAC_MIN_DIA); });
  return out;
}

// ---------------------------------------------------------------- 1 y 2: pasar a fórmulas
function revisarVacacionesAuto() { return vacAplicar_(false); }
function aplicarVacacionesAuto() { return vacAplicar_(true); }

function vacAplicar_(aplicar) {
  var hoja = vacHoja_();
  var anio = vacAnioActual_();
  var tom = vacTomadas_(anio);
  var horas = vacHorasCargadas_(anio);
  var filas = vacFilas_(hoja);
  var cambios = [];
  filas.forEach(function (r) {
    var v = r.v, id = String(v[VC.ID - 1]).trim();
    var anios = vacAnios_(v[VC.INGRESO - 1], anio);
    var g = vacDiasDelAnio_(anios);
    var i = (tom.porId[id] || 0) + (horas[id] || 0);
    var h = (Number(v[VC.ANTERIOR - 1]) || 0) + g;
    var d = [];
    if (anios !== null && Number(v[VC.ANIOS - 1]) !== anios) d.push('años ' + v[VC.ANIOS - 1] + '→' + anios);
    if (Number(v[VC.DEL_ANIO - 1]) !== g) d.push('días del año ' + v[VC.DEL_ANIO - 1] + '→' + g);
    if (Number(v[VC.TOMADAS - 1]) !== i) d.push('tomadas ' + v[VC.TOMADAS - 1] + '→' + i);
    if (Number(v[VC.RESTANTES - 1]) !== h - i) d.push('SALDO ' + v[VC.RESTANTES - 1] + '→' + (h - i));
    if (d.length) cambios.push(id + ' ' + String(v[VC.NOMBRE - 1] || '') + ': ' + d.join(' · '));
  });

  if (aplicar) {
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Hay otra operación en el libro: vuelve a ejecutar en un minuto');
    try {
      var ss = SpreadsheetApp.getActive();
      if (!ss.getRangeByName('VAC_ANIO')) {
        hoja.getRange('L1').setValue('AÑO VACACIONES').setFontWeight('bold');
        hoja.getRange(VAC_CELDA_ANIO).setValue(anio).setFontWeight('bold');
        ss.setNamedRange('VAC_ANIO', hoja.getRange(VAC_CELDA_ANIO));
      }
      vacAsegurarHojaHoras_();
      var sep = vacSeparador_(hoja);
      filas.forEach(function (r) { vacEscribirFormulas_(hoja, r.fila, sep); });
      vacEncabezados_(hoja, anio);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
  var dupTxt = Object.keys(tom.duplicados).map(function (id) { return id + ' (' + tom.duplicados[id].join(', ') + ')'; });
  var txt = (aplicar ? 'APLICADO' : 'REVISIÓN (sin cambios)') + ' · año de vacaciones ' + anio +
    ' (período 01/12/' + (anio - 1) + ' – 30/11/' + anio + ') · filas: ' + filas.length +
    '\nPersonas con valores distintos: ' + cambios.length + (cambios.length ? '\n  ' + cambios.join('\n  ') : '') +
    (dupTxt.length ? '\nDías repetidos en VACACIONES (se descuentan dos veces): ' + dupTxt.join('; ') : '');
  Logger.log(txt);
  if (aplicar) Logger.log(vacErroresFormulas_(hoja));
  return txt;
}

function vacEscribirFormulas_(hoja, f, sep) {
  var fx = vacFormulas_(f, sep);
  hoja.getRange(f, VC.ANIOS).setFormula(fx.E);
  hoja.getRange(f, VC.DEL_ANIO).setFormula(fx.G);
  hoja.getRange(f, VC.TOTAL).setFormula(fx.H);
  hoja.getRange(f, VC.TOMADAS).setFormula(fx.I);
  hoja.getRange(f, VC.RESTANTES).setFormula(fx.J);
  hoja.getRange(f, VC.FECHAS).setFormula(fx.K);
}

function vacEncabezados_(hoja, anio) {
  hoja.getRange(1, VC.ANTERIOR).setValue('Vacaciones restantes del año anterior (A) · saldo al 30/11/' + (anio - 1));
  hoja.getRange(1, VC.DEL_ANIO).setValue('vacaciones para ' + anio + ' (11 días; desde el 6.º año de servicio 1 día adicional por año, máx. 15) fecha corte 31/12/' + anio + ' (B)');
  hoja.getRange(1, VC.TOTAL).setValue('vacaciones a ' + anio + ' (A+B)');
  hoja.getRange(1, VC.TOMADAS).setValue('Vacaciones tomadas (01/12/' + (anio - 1) + ' al día de hoy)');
}

function vacErroresFormulas_(hoja) {
  var n = hoja.getLastRow() - 1;
  if (n < 1) return 'Sin filas';
  var vals = hoja.getRange(2, VC.ANIOS, n, VC.FECHAS - VC.ANIOS + 1).getDisplayValues();
  var err = [];
  vals.forEach(function (fila, k) { fila.forEach(function (x, c) { if (/^#/.test(x)) err.push('fila ' + (k + 2) + ' col ' + String.fromCharCode(64 + VC.ANIOS + c) + ': ' + x); }); });
  return err.length ? '⚠ Celdas con error: ' + err.slice(0, 15).join('; ') : 'Fórmulas OK: sin errores';
}

// ---------------------------------------------------------------- 3: actualización diaria
function instalarVacacionesAuto() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'actualizarVacacionesDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('actualizarVacacionesDiario').timeBased().everyDays(1).atHour(6).nearMinute(30).create();
  Logger.log('Activador diario instalado (06:30). Primera ejecución ahora:');
  actualizarVacacionesDiario();
}

function actualizarVacacionesDiario() {
  var hoja = vacHoja_();
  var anioHoy = Number(Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy'));
  // Cierre de año: el primer día del año nuevo (o el siguiente en que corra)
  if (anioHoy > vacAnioActual_()) cerrarAnioVacaciones_(true);

  // Fechas de ingreso desde la nómina y filas para quienes ingresaron (copian las fórmulas de la última fila)
  ingresoEnVacaciones_(true);

  vacAsegurarHojaHoras_();
  // Toda fila de colaborador con sus fórmulas (por si alguien escribió un valor encima)
  var sep = vacSeparador_(hoja), corregidas = [];
  var formulas = hoja.getDataRange().getFormulas();
  vacFilas_(hoja).forEach(function (r) {
    var fx = formulas[r.fila - 1];
    var falta = [VC.ANIOS, VC.DEL_ANIO, VC.TOTAL, VC.TOMADAS, VC.RESTANTES].some(function (c) { return !fx[c - 1]; });
    // Fórmula de tomadas anterior a la hoja de horas (fase 2 de permisos): se repone con la nueva
    if (!falta && String(fx[VC.TOMADAS - 1] || '').indexOf(VAC_HOJA_HORAS) === -1) falta = true;
    if (falta) { vacEscribirFormulas_(hoja, r.fila, sep); corregidas.push(String(r.v[0])); }
  });
  SpreadsheetApp.flush();

  // Avisos para RR.HH.: repetidos, saldos negativos con más de 1 año, filas sin fecha de ingreso, inactivos
  var anio = vacAnioActual_();
  var tom = vacTomadas_(anio);
  var empleados = leerEmpleadosFirestoreNomina_();
  var negativos = [], sinIngreso = [], inactivos = [];
  vacFilas_(hoja).forEach(function (r) {
    var id = String(r.v[0]).trim(), nom = String(r.v[1] || '');
    var e = empleados[id];
    if (!(r.v[VC.INGRESO - 1] instanceof Date)) sinIngreso.push(id + ' ' + nom);
    if (Number(r.v[VC.RESTANTES - 1]) < 0 && Number(r.v[VC.ANIOS - 1]) >= 1) negativos.push(id + ' ' + nom + ' (' + r.v[VC.RESTANTES - 1] + ')');
    if (!e || String(e.activo || 'SI').toUpperCase() === 'NO') inactivos.push(id + ' ' + nom);
  });
  var dup = Object.keys(tom.duplicados).map(function (id) { return id + ': ' + tom.duplicados[id].join(', '); });
  var partes = [];
  if (dup.length) partes.push('Días de vacación repetidos (se descuentan dos veces): ' + dup.join('; '));
  if (negativos.length) partes.push('Saldo negativo: ' + negativos.join(', '));
  if (sinIngreso.length) partes.push('Sin fecha de ingreso: ' + sinIngreso.join(', '));
  if (inactivos.length) partes.push('Inactivos o desvinculados con fila: ' + inactivos.join(', '));
  if (partes.length) {
    try {
      crearNotificacion_({ para: 'rol:rrhh', tipo: 'general', clave: 'vacaciones_revision', reemplazar: true,
        titulo: 'Vacaciones: revisar', texto: partes.join(' · ') });
    } catch (e) { Logger.log('Aviso no creado: ' + e); }
  }
  Logger.log('Vacaciones ' + anio + ' actualizadas' + (corregidas.length ? ' · fórmulas repuestas en: ' + corregidas.join(', ') : '') +
    (partes.length ? '\n' + partes.join('\n') : '\nSin observaciones') + '\n' + vacErroresFormulas_(hoja));
}

// ---------------------------------------------------------------- cierre de año
function revisarCierreAnioVacaciones() { return cerrarAnioVacaciones_(false); }

// F = saldo final (J, incluidos negativos); se guarda una copia del año en HISTORICO_VACACIONES y VAC_ANIO sube 1
function cerrarAnioVacaciones_(aplicar) {
  var ss = SpreadsheetApp.getActive();
  var hoja = vacHoja_();
  var anio = vacAnioActual_();
  SpreadsheetApp.flush();
  var filas = vacFilas_(hoja);
  var lineas = filas.map(function (r) {
    return String(r.v[0]) + ' ' + String(r.v[1] || '') + ': saldo ' + anio + ' = ' + r.v[VC.RESTANTES - 1] + ' → pasa a F de ' + (anio + 1);
  });
  if (aplicar) {
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Hay otra operación en el libro');
    try {
      // Copia del año (solo valores) en el libro histórico
      var archivo = vacArchivoHistorico_(ss);
      var nombre = 'VACACIONES_' + anio;
      var previa = archivo.getSheetByName(nombre);
      if (previa) archivo.deleteSheet(previa);
      var datos = hoja.getDataRange().getDisplayValues();
      var destino = archivo.insertSheet(nombre);
      destino.getRange(1, 1, datos.length, datos[0].length).setValues(datos);
      // F = J (valores) y año nuevo
      filas.forEach(function (r) { hoja.getRange(r.fila, VC.ANTERIOR).setValue(Number(r.v[VC.RESTANTES - 1]) || 0); });
      ss.getRangeByName('VAC_ANIO').setValue(anio + 1);
      vacEncabezados_(hoja, anio + 1);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    try {
      crearNotificacion_({ para: 'rol:rrhh', tipo: 'general', clave: 'vacaciones_cierre_' + anio, reemplazar: true,
        titulo: 'Vacaciones: cierre de ' + anio,
        texto: 'Los saldos de ' + anio + ' pasaron al año ' + (anio + 1) + ' y la copia quedó en ' + VAC_ARCHIVO_HISTORICO + ' (hoja VACACIONES_' + anio + ').' });
    } catch (e) { }
  }
  var txt = (aplicar ? 'CIERRE APLICADO' : 'REVISIÓN DEL CIERRE (sin cambios)') + ' · ' + anio + ' → ' + (anio + 1) + '\n  ' + lineas.join('\n  ');
  Logger.log(txt);
  return txt;
}

function vacArchivoHistorico_(ss) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('VAC_HISTORICO_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { } }
  var nuevo = SpreadsheetApp.create(VAC_ARCHIVO_HISTORICO);
  var carpetas = DriveApp.getFileById(ss.getId()).getParents();
  if (carpetas.hasNext()) DriveApp.getFileById(nuevo.getId()).moveTo(carpetas.next());
  props.setProperty('VAC_HISTORICO_ID', nuevo.getId());
  return nuevo;
}

// ---------------------------------------------------------------- días de vacación repetidos (2026-11-11)
// La misma persona con dos filas VACACIONES el mismo día se descuenta dos veces (aviso del cálculo diario).
//   revisarVacacionesRepetidas()   NO cambia nada: muestra las filas repetidas
//   corregirVacacionesRepetidas()  deja la primera fila de cada día; las demás se copian a la hoja
//                                  VACACIONES_REPETIDAS_BORRADAS (respaldo) y se borran de VACACIONES.
//   Después correr aplicarVacacionesAuto() para recalcular los saldos.
function revisarVacacionesRepetidas() { return vacRepetidas_(false); }
function corregirVacacionesRepetidas() { return vacRepetidas_(true); }

// 'yyyy-MM-dd' de una celda de fecha: Date, texto 'dd/mm/aaaa' o 'aaaa-mm-dd' (con o sin hora)
function vacDiaDeCelda_(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var t = String(v || '').trim(), m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function vacRepetidas_(aplicar) {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(HOJA_VACACIONES);
  var datos = hoja.getDataRange().getValues();
  var tz = Session.getScriptTimeZone(), vistos = {}, sobran = [];
  for (var j = 1; j < datos.length; j++) {
    var dia = vacDiaDeCelda_(datos[j][0], tz);   // fecha real o escrita como texto
    if (!dia) continue;
    if (String(datos[j][3] || '').trim().toUpperCase() !== 'VACACIONES') continue;
    var id = String(datos[j][1] || '').trim();
    if (!id) continue;
    var clave = id + '|' + dia;
    if (vistos[clave]) sobran.push({ fila: j + 1, primera: vistos[clave], v: datos[j], clave: clave });
    else vistos[clave] = j + 1;
  }
  if (!sobran.length) { Logger.log('Sin días de vacación repetidos.'); return 0; }
  sobran.forEach(function (s) {
    Logger.log((aplicar ? 'Se borra' : 'Se borraría') + ' la fila ' + s.fila + ' (' + s.clave.replace('|', ' · ') + (s.v[0] instanceof Date ? '' : ', fecha escrita como texto') +
      '), repetida de la fila ' + s.primera + ': ' + s.v.map(function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'dd/MM/yyyy HH:mm') : x; }).join(' | '));
  });
  if (!aplicar) { Logger.log(sobran.length + ' fila(s) repetida(s). Para corregir: corregirVacacionesRepetidas()'); return sobran.length; }

  var resp = ss.getSheetByName('VACACIONES_REPETIDAS_BORRADAS');
  if (!resp) {
    resp = ss.insertSheet('VACACIONES_REPETIDAS_BORRADAS');
    var cab = datos[0].slice();
    cab.push('FILA_ORIGINAL', 'BORRADA_EN');
    resp.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    resp.setFrozenRows(1);
  }
  var ahora = new Date();
  var copia = sobran.map(function (s) { return s.v.concat([s.fila, ahora]); });
  resp.getRange(resp.getLastRow() + 1, 1, copia.length, copia[0].length).setValues(copia);
  SpreadsheetApp.flush();
  var antes = hoja.getLastRow();
  sobran.map(function (s) { return s.fila; }).sort(function (a, b) { return b - a; }).forEach(function (fila) { hoja.deleteRow(fila); });
  SpreadsheetApp.flush();
  // Comprobación: la hoja debe tener menos filas y ya no debe haber repetidos
  var despues = hoja.getLastRow();
  Logger.log('Libro ' + ss.getName() + ' (' + ss.getId() + ') · hoja ' + hoja.getName() + ': ' + antes + ' → ' + despues + ' filas.');
  var quedan = 0, vistos2 = {};
  hoja.getDataRange().getValues().forEach(function (r, i) {
    if (!i) return;
    var dia = vacDiaDeCelda_(r[0], tz), id = String(r[1] || '').trim();
    if (!dia || !id || String(r[3] || '').trim().toUpperCase() !== 'VACACIONES') return;
    if (vistos2[id + '|' + dia]) quedan++; else vistos2[id + '|' + dia] = true;
  });
  Logger.log(quedan ? '⚠️ Siguen ' + quedan + ' repetido(s) después de borrar.' : 'Comprobado: ya no hay repetidos.');
  Logger.log(sobran.length + ' fila(s) borrada(s) (copia en VACACIONES_REPETIDAS_BORRADAS). Ahora corre aplicarVacacionesAuto().');
  return sobran.length;
}
