/**
 * TCONTROL · Corrección de TIMESTAMP con día y mes invertidos en el histórico (hoja REGISTROS)
 *
 * En 346 filas del 11 y 12 de mayo de 2026 la columna TIMESTAMP (J) quedó con día y mes cruzados
 * (5 de noviembre y 5 de diciembre). La FECHA (A), la HORA (F) y el DIA (K) están bien. Al leer el
 * histórico, obtenerRegistrosArchivados toma la fecha del TIMESTAMP ("Regla: Extraer fecha y hora desde
 * TIMESTAMP"), así que esos días salían como fechas futuras. La base histórica (Postgres) ya los tiene bien.
 *
 * Uso (desde el editor de Apps Script, ▶):
 *   1. revisarFechasInvertidas()   → solo informa qué filas cambiaría (no modifica nada).
 *   2. corregirFechasInvertidas()  → respalda los valores anteriores en RESPALDO_FECHAS y corrige el
 *                                    TIMESTAMP a FECHA + la hora que ya tenía el TIMESTAMP.
 * Criterio (conservador): solo filas cuyo TIMESTAMP cae en otro día que la FECHA y que, al intercambiar
 * su día y su mes, coincide exactamente con la FECHA. La FECHA no se modifica.
 */
function revisarFechasInvertidas() { corregirFechasInvertidas_(false); }
function corregirFechasInvertidas() { corregirFechasInvertidas_(true); }

function corregirFechasInvertidas_(aplicar) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Guayaquil';
  var hoja = ss.getSheetByName('REGISTROS');
  if (!hoja) throw new Error('No existe la hoja REGISTROS');
  var COL_FECHA = 0, COL_ID = 1, COL_TIPO = 3, COL_HORA = 5, COL_TS = 9;

  var fechaDe = function (v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  };
  // TIMESTAMP: Date de la hoja, texto "d-m-aaaa H:mm:ss" (lo escribe el archivado) o texto de fecha JS
  var tsDe = function (v) {
    if (v instanceof Date) return v;
    var s = String(v || '').trim(), m;
    if (!s) return null;
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
      return Utilities.parseDate(m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00'), tz, 'yyyy-M-d H:mm:ss');
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  var datos = hoja.getDataRange().getValues();
  var cambios = [], porFecha = {}, otrosDistintos = 0;
  for (var i = 1; i < datos.length; i++) {
    var r = datos[i];
    var fecha = fechaDe(r[COL_FECHA]);
    var ts = tsDe(r[COL_TS]);
    if (!fecha || !ts) continue;
    var fTs = Utilities.formatDate(ts, tz, 'yyyy-MM-dd');
    if (fTs === fecha) continue;
    var p = fTs.split('-');
    var invertida = p[0] + '-' + p[2] + '-' + p[1];
    if (invertida !== fecha) { otrosDistintos++; continue; }
    var hora = Utilities.formatDate(ts, tz, 'HH:mm:ss');
    porFecha[fTs + ' → ' + fecha] = (porFecha[fTs + ' → ' + fecha] || 0) + 1;
    cambios.push({ fila: i + 1, id: String(r[COL_ID]).trim(), tipo: String(r[COL_TIPO]).trim(), fecha: fecha, hora: hora,
      antes: r[COL_TS], nuevo: Utilities.parseDate(fecha + ' ' + hora, tz, 'yyyy-MM-dd HH:mm:ss') });
  }

  if (aplicar && cambios.length) {
    // Mismo candado que archivarRegistros: no escribir mientras se archiva
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Hay un archivado en curso: vuelve a ejecutar en un minuto');
    try {
      var resp = ss.getSheetByName('RESPALDO_FECHAS');
      if (!resp) { resp = ss.insertSheet('RESPALDO_FECHAS'); resp.appendRow(['FILA', 'ID', 'TIPO', 'FECHA', 'TIMESTAMP_ANTERIOR', 'TIMESTAMP_NUEVO', 'CORREGIDO_EN']); }
      var ahora = new Date();
      resp.getRange(resp.getLastRow() + 1, 1, cambios.length, 7).setValues(cambios.map(function (c) {
        return [c.fila, c.id, c.tipo, c.fecha, c.antes, c.nuevo, ahora];
      }));
      cambios.forEach(function (c) {
        // Confirmar con el candado tomado que la fila sigue siendo la misma antes de escribir
        var actual = hoja.getRange(c.fila, 1, 1, COL_TS + 1).getValues()[0];
        var tsAct = tsDe(actual[COL_TS]);
        if (String(actual[COL_ID]).trim() === c.id && fechaDe(actual[COL_FECHA]) === c.fecha && tsAct &&
            Utilities.formatDate(tsAct, tz, 'HH:mm:ss') === c.hora) {
          hoja.getRange(c.fila, COL_TS + 1).setValue(c.nuevo);
        } else {
          c.omitida = true;
        }
      });
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
  var omitidas = cambios.filter(function (c) { return c.omitida; }).length;
  Logger.log((aplicar ? 'APLICADO · respaldo en RESPALDO_FECHAS · ' : 'REVISIÓN (sin cambios) · ') +
    'filas con TIMESTAMP de día y mes invertidos: ' + cambios.length +
    (omitidas ? ' (omitidas por haber cambiado: ' + omitidas + ')' : '') +
    '\nPor fecha (TIMESTAMP → FECHA): ' + JSON.stringify(porFecha) +
    '\nOtras filas con TIMESTAMP en otro día que la FECHA (no se tocan): ' + otrosDistintos +
    (cambios.length ? '\nEjemplos:\n  ' + cambios.slice(0, 6).map(function (c) {
      return 'fila ' + c.fila + ' · ' + c.id + ' ' + c.tipo + ' · FECHA ' + c.fecha + ' · TIMESTAMP ' + Utilities.formatDate(tsDe(c.antes), tz, 'yyyy-MM-dd HH:mm:ss') + ' → ' + c.fecha + ' ' + c.hora;
    }).join('\n  ') : ''));
}
