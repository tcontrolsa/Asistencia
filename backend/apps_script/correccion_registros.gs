/**
 * TCONTROL · Corrección de REGISTROS con una lista revisada (2026-11-23)
 *
 * Desde el 26/10/2026 las columnas A–J de REGISTROS quedaron ordenadas por nombre sin mover K–Y: el día, el modo, las horas
 * extra, quién autoriza y los minutos de permiso de una persona quedaron en la fila de otra. Además «Justificar
 * Asistencias» convirtió en FALTA días con marcaciones. La lista se prepara aparte (tiene datos personales y no va al
 * repositorio) y se importa en este libro como la hoja CORRECCION_REGISTROS.
 *
 * Uso (editor de Apps Script, ▶):
 *   1. revisarOrdenRegistros()      → informa filtros que no cubren todas las columnas y filas con modo contradictorio.
 *   2. simularCorreccionRegistros() → comprueba cada renglón de la lista. NO modifica REGISTROS.
 *   3. aplicarCorreccionRegistros() → copia REGISTROS completa (RESPALDO_REGISTROS_fecha) y aplica los APLICAR = SI.
 *
 * Cada renglón se busca por FECHA + ID + TIPO + HORA (columnas A–J, coherentes entre sí), nunca por número de fila, y
 * se omite si no aparece exactamente una vez o si su valor actual ya no es el de la lista.
 * Los renglones REVISAR se aplican solo si alguien los cambia a SI.
 */
var HOJA_CORRECCION = 'CORRECCION_REGISTROS';
var CORRECCION_DESDE = '2026-10-26';

function simularCorreccionRegistros() { return corregirRegistros_(false); }
function aplicarCorreccionRegistros() { return corregirRegistros_(true); }

function corregirRegistros_(aplicar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Guayaquil';
  var hoja = ss.getSheetByName('REGISTROS');
  var lista = ss.getSheetByName(HOJA_CORRECCION);
  if (!hoja || !lista) throw new Error('Falta la hoja REGISTROS o ' + HOJA_CORRECCION);

  var lock = LockService.getDocumentLock(); // el mismo candado del archivado
  if (!lock.tryLock(30000)) throw new Error('Hay un archivado en curso: vuelve a ejecutar en un minuto');
  try {
    var datosLista = lista.getDataRange().getValues();
    var cab = datosLista[0].map(function (h) { return String(h).trim().toUpperCase(); });
    var renglones = datosLista.slice(1).map(function (f, n) {
      var o = { _n: n + 2 };
      cab.forEach(function (h, c) {
        o[h] = h === 'FECHA' ? crFecha_(f[c], tz) : (h === 'HORA' || h === 'HORA_NUEVA') ? crHora_(f[c], tz) : String(f[c] === null || f[c] === undefined ? '' : f[c]).trim();
      });
      return o;
    }).filter(function (o) { return o.APLICAR.toUpperCase() === 'SI'; });

    var ancho = Math.max(hoja.getLastColumn(), 25);
    var datos = hoja.getRange(1, 1, hoja.getLastRow(), ancho).getValues();
    var indice = {}, porDia = {};
    for (var i = 1; i < datos.length; i++) {
      var f = crFecha_(datos[i][COLUMNAS.FECHA], tz), id = String(datos[i][COLUMNAS.ID]).trim();
      if (!f || !id) continue;
      var t = String(datos[i][COLUMNAS.TIPO]).trim().toUpperCase();
      var k = [f, id, t, crHora_(datos[i][COLUMNAS.HORA], tz)].join('|');
      (indice[k] = indice[k] || []).push(i + 1);
      porDia[f + '|' + id + '|' + t] = true;
    }

    var celdas = [], inserciones = [], borrados = [], omitidos = [];
    var omitir = function (r, por) { omitidos.push('renglón ' + r._n + ' · ' + r.ACCION + ' ' + r.ID + ' ' + r.FECHA + ' ' + r.TIPO + ' ' + r.HORA + ': ' + por); };
    var borrarClave = {};
    renglones.forEach(function (r) { if (r.ACCION === 'ELIMINAR') borrarClave[r.FECHA + '|' + r.ID + '|' + r.TIPO.toUpperCase()] = true; });

    renglones.forEach(function (r) {
      var tipo = r.TIPO.toUpperCase();
      if (r.ACCION === 'INSERTAR') {
        if (porDia[r.FECHA + '|' + r.ID + '|' + tipo]) { omitir(r, 'ya existe una fila de ese tipo en el día'); return; }
        var fila = new Array(ancho).fill('');
        fila[COLUMNAS.FECHA] = r.FECHA; fila[COLUMNAS.ID] = r.ID; fila[COLUMNAS.NOMBRE] = r.NOMBRE; fila[COLUMNAS.TIPO] = tipo;
        fila[COLUMNAS.ALMUERZO] = 'NO'; fila[COLUMNAS.HORA] = r.HORA; fila[COLUMNAS.DISPOSITIVO] = 'CORRECCION_BITACORA';
        fila[COLUMNAS.TIMESTAMP] = Utilities.parseDate(r.FECHA + ' ' + r.HORA, tz, 'yyyy-MM-dd HH:mm:ss');
        fila[COLUMNAS.DIA] = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][new Date(r.FECHA + 'T12:00:00Z').getUTCDay()];
        fila[COLUMNAS.MODO] = r.MODO_NUEVO; fila[COLUMNAS.HORAS_EXTRA] = r.HE_NUEVO || 'NO'; fila[COLUMNAS.AUTORIZA] = r.AUTORIZA_NUEVO;
        inserciones.push(fila);
        return;
      }
      var filas = indice[[r.FECHA, r.ID, tipo, r.HORA].join('|')] || [];
      if (filas.length !== 1) { omitir(r, filas.length ? 'aparece ' + filas.length + ' veces' : 'no aparece'); return; }
      var n = filas[0], d = datos[n - 1];
      var actual = String(d[COLUMNAS.MODO] || '').trim();
      var poner = function (col, v) { celdas.push({ fila: n, col: col, valor: v, antes: d[col] }); };
      if (r.ACCION === 'ELIMINAR') {
        if (tipo !== 'FALTA' && String(d[COLUMNAS.DISPOSITIVO]).trim().toUpperCase() !== 'AUTO_COMPLETAR') { omitir(r, 'no es FALTA ni autocompletada: no se borra'); return; }
        borrados.push(n);
      } else if (r.ACCION === 'PERMISO') {
        [['PERSONAL_NUEVO', COLUMNAS.PERMISO_PERSONAL_MINS], ['MEDICO_NUEVO', COLUMNAS.PERMISO_MEDICO_MINS], ['JUSTIFICADO_NUEVO', COLUMNAS.TIEMPO_JUSTIFICADO_MINS]].forEach(function (x) {
          if (r[x[0]] === '') return;
          var antes = (r.ACTUAL.match(/(\d+) min/) || [])[1];
          if (Number(d[x[1]] || 0) !== Number(antes || 0)) { omitir(r, 'los minutos actuales ya no son ' + antes); return; }
          poner(x[1], Number(r[x[0]]));
        });
      } else if (r.ACCION === 'NOTA') {
        // «No registró salida» en una marcación hecha con el teléfono: se vacían O, P, U y V
        if (!/^No registr/.test(String(d[COLUMNAS.RAZON_JUSTIFICAC])) || !/^DEV_/.test(String(d[COLUMNAS.DISPOSITIVO]))) { omitir(r, 'ya no tiene la nota'); return; }
        [COLUMNAS.RAZON_SALIDA_TEMPRANA, COLUMNAS.QUIEN_JUSTIFICA, COLUMNAS.JUSTIFICADO, COLUMNAS.RAZON_JUSTIFICAC].forEach(function (c) { poner(c, ''); });
      } else if (r.ACCION === 'MODO') {
        if (actual !== r.ACTUAL.split(' · ')[0].trim()) { omitir(r, 'el modo actual ya no es el de la lista (' + actual + ')'); return; }
        poner(COLUMNAS.MODO, r.MODO_NUEVO);
        if (r.HE_NUEVO) poner(COLUMNAS.HORAS_EXTRA, r.HE_NUEVO);
        if (r.AUTORIZA_NUEVO) poner(COLUMNAS.AUTORIZA, r.AUTORIZA_NUEVO === '(VACIO)' ? '' : r.AUTORIZA_NUEVO);
      } else if (r.ACCION === 'CAMBIAR') {
        // La fila del tipo nuevo solo puede existir si esta misma lista la elimina (salida autocompletada)
        var kNuevo = r.FECHA + '|' + r.ID + '|' + r.TIPO_NUEVO.toUpperCase();
        if (porDia[kNuevo] && !borrarClave[kNuevo]) { omitir(r, 'ya existe ' + r.TIPO_NUEVO + ' ese día'); return; }
        poner(COLUMNAS.TIPO, r.TIPO_NUEVO); poner(COLUMNAS.HORA, r.HORA_NUEVA);
        poner(COLUMNAS.TIMESTAMP, Utilities.parseDate(r.FECHA + ' ' + r.HORA_NUEVA, tz, 'yyyy-MM-dd HH:mm:ss'));
        poner(COLUMNAS.MODO, r.MODO_NUEVO); poner(COLUMNAS.HORAS_EXTRA, r.HE_NUEVO); poner(COLUMNAS.AUTORIZA, r.AUTORIZA_NUEVO);
      } else omitir(r, 'acción desconocida');
    });

    // DIA (K) también se cruzó: se recalcula desde la FECHA en todo el período afectado
    var diasCorregidos = 0;
    for (var q = 1; q < datos.length; q++) {
      var fq = crFecha_(datos[q][COLUMNAS.FECHA], tz);
      if (!fq || fq < CORRECCION_DESDE) continue;
      var diaOk = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][new Date(fq + 'T12:00:00Z').getUTCDay()];
      var diaHoy = String(datos[q][COLUMNAS.DIA] || '').trim().toUpperCase();
      if (diaHoy && diaHoy !== diaOk) { celdas.push({ fila: q + 1, col: COLUMNAS.DIA, valor: diaOk }); diasCorregidos++; }
    }

    var respaldo = '';
    if (aplicar && (celdas.length || inserciones.length || borrados.length)) {
      respaldo = 'RESPALDO_REGISTROS_' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
      hoja.copyTo(ss).setName(respaldo).hideSheet();
      SpreadsheetApp.flush();
      celdas.forEach(function (c) { hoja.getRange(c.fila, c.col + 1).setValue(c.valor); });
      if (inserciones.length) hoja.getRange(hoja.getLastRow() + 1, 1, inserciones.length, ancho).setValues(inserciones);
      borrados.sort(function (a, b) { return b - a; }).forEach(function (n) { hoja.deleteRow(n); });
      SpreadsheetApp.flush();
    }
    var res = { renglones: renglones.length, celdas: celdas.length, dias: diasCorregidos, inserciones: inserciones.length, borrados: borrados.length, omitidos: omitidos.length, respaldo: respaldo };
    Logger.log((aplicar ? 'APLICADO · ' : 'SIMULACIÓN (sin cambios) · ') + JSON.stringify(res) +
      (omitidos.length ? '\nOmitidos:\n  ' + omitidos.slice(0, 60).join('\n  ') : ''));
    return res;
  } finally {
    lock.releaseLock();
  }
}

/** Informa filtros de REGISTROS que no cubren todas las columnas y filas cuyo modo contradice al GPS. No modifica nada. */
function revisarOrdenRegistros() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Guayaquil';
  var hoja = ss.getSheetByName('REGISTROS');
  var filtro = hoja.getFilter();
  var txt = filtro
    ? 'Filtro en ' + filtro.getRange().getA1Notation() + (filtro.getRange().getLastColumn() < hoja.getLastColumn() ? '  ⚠️ NO cubre todas las columnas (hasta la ' + hoja.getLastColumn() + '): ordenar con él cruza los datos' : '  (cubre todo)')
    : 'Sin filtro básico';
  var EMP_LAT = -0.1316, EMP_LNG = -78.4786, LIM = new Date(Date.now() - 30 * 86400000);
  var desde = Utilities.formatDate(LIM, tz, 'yyyy-MM-dd'), mal = {}, total = 0;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 12).getValues().forEach(function (r) {
    var f = crFecha_(r[COLUMNAS.FECHA], tz), la = parseFloat(r[COLUMNAS.LAT]), lo = parseFloat(r[COLUMNAS.LNG]);
    if (!f || f < desde || !la || !lo || ['ENTRADA', 'SALIDA'].indexOf(String(r[COLUMNAS.TIPO])) < 0) return;
    var km = 111.2 * Math.sqrt(Math.pow(la - EMP_LAT, 2) + Math.pow(lo - EMP_LNG, 2));
    var m = String(r[COLUMNAS.MODO]).toUpperCase();
    if ((km > 30 && (m === 'OFICINA' || m === 'EMPRESA')) || (km < 1 && m === 'CAMPO')) { mal[f] = (mal[f] || 0) + 1; total++; }
  });
  Logger.log(txt + '\nFilas con modo contradictorio al GPS (30 días): ' + total + '\n' +
    Object.keys(mal).sort().map(function (f) { return f + ': ' + mal[f]; }).join('\n'));
}

function crFecha_(v, tz) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function crHora_(v, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm:ss');
  var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00') : '';
}
