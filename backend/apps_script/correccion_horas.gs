/**
 * TCONTROL · Corrección de horas desfasadas en el histórico (hoja REGISTROS)
 *
 * El 8 y 9 de octubre de 2026 se archivaron desde un panel abierto en un equipo con otra zona horaria:
 * la columna TIMESTAMP (J) quedó 7 horas adelantada respecto de la HORA (F), que sí es la correcta.
 * El panel calcula la hora mostrada a partir del TIMESTAMP, por eso salían entradas a las 14:00.
 *
 * Uso (desde el editor de Apps Script, ▶):
 *   1. revisarDesfaseHoras()   → solo informa qué filas cambiaría (no modifica nada).
 *   2. corregirDesfaseHoras()  → respalda los valores anteriores en RESPALDO_HORAS y corrige el TIMESTAMP
 *                                 a FECHA + HORA (zona horaria de la hoja).
 * Solo toca filas del rango DESFASE_DESDE..DESFASE_HASTA cuya TIMESTAMP difiera de la HORA en 1 hora o más
 * (las ausencias con HORA 00:00:00 no se tocan).
 */
var DESFASE_DESDE = '2026-10-08';
var DESFASE_HASTA = '2026-10-09';

function revisarDesfaseHoras() { corregirDesfaseHoras_(false); }
function corregirDesfaseHoras() { corregirDesfaseHoras_(true); }

function corregirDesfaseHoras_(aplicar) {
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
  var horaDe = function (v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm:ss');
    var m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00') : '';
  };
  var tsDe = function (v) {
    if (v instanceof Date) return v;
    var s = String(v || '').trim(), m;
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
      return Utilities.parseDate(m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00'), tz, 'yyyy-M-d H:mm:ss');
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  var datos = hoja.getDataRange().getValues();
  var cambios = [], porDesfase = {};
  for (var i = 1; i < datos.length; i++) {
    var r = datos[i];
    var fecha = fechaDe(r[COL_FECHA]);
    if (!fecha || fecha < DESFASE_DESDE || fecha > DESFASE_HASTA) continue;
    var hora = horaDe(r[COL_HORA]);
    if (!hora || hora === '00:00:00') continue;
    var ts = tsDe(r[COL_TS]);
    if (!ts) continue;
    var correcto = Utilities.parseDate(fecha + ' ' + hora, tz, 'yyyy-MM-dd HH:mm:ss');
    var difMin = Math.round((ts.getTime() - correcto.getTime()) / 60000);
    if (Math.abs(difMin) < 60) continue;
    var h = Math.round(difMin / 60);
    porDesfase[h] = (porDesfase[h] || 0) + 1;
    cambios.push({ fila: i + 1, id: String(r[COL_ID]).trim(), tipo: String(r[COL_TIPO]).trim(), fecha: fecha, hora: hora, antes: r[COL_TS], nuevo: correcto });
  }

  if (aplicar && cambios.length) {
    // Mismo candado que archivarRegistros: no escribir mientras se archiva
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Hay un archivado en curso: vuelve a ejecutar en un minuto');
    try {
      var resp = ss.getSheetByName('RESPALDO_HORAS');
      if (!resp) { resp = ss.insertSheet('RESPALDO_HORAS'); resp.appendRow(['FILA', 'ID', 'TIPO', 'FECHA', 'HORA', 'TIMESTAMP_ANTERIOR', 'TIMESTAMP_NUEVO', 'CORREGIDO_EN']); }
      var ahora = new Date();
      resp.getRange(resp.getLastRow() + 1, 1, cambios.length, 8).setValues(cambios.map(function (c) {
        return [c.fila, c.id, c.tipo, c.fecha, c.hora, c.antes, c.nuevo, ahora];
      }));
      cambios.forEach(function (c) {
        // Confirmar con el candado tomado que la fila sigue siendo la misma antes de escribir
        var actual = hoja.getRange(c.fila, 1, 1, COL_TS + 1).getValues()[0];
        if (String(actual[COL_ID]).trim() === c.id && fechaDe(actual[COL_FECHA]) === c.fecha && horaDe(actual[COL_HORA]) === c.hora) {
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
  Logger.log((aplicar ? 'APLICADO · respaldo en RESPALDO_HORAS · ' : 'REVISIÓN (sin cambios) · ') +
    'filas con TIMESTAMP desfasado del ' + DESFASE_DESDE + ' al ' + DESFASE_HASTA + ': ' + cambios.length +
    (omitidas ? ' (omitidas por haber cambiado: ' + omitidas + ')' : '') +
    '\nPor desfase en horas: ' + JSON.stringify(porDesfase) +
    (cambios.length ? '\nEjemplos:\n  ' + cambios.slice(0, 8).map(function (c) {
      return 'fila ' + c.fila + ' · ' + c.id + ' ' + c.tipo + ' ' + c.fecha + ' ' + c.hora + ' · TIMESTAMP ' + Utilities.formatDate(tsDe(c.antes), tz, 'HH:mm:ss') + ' → ' + c.hora;
    }).join('\n  ') : ''));
}
