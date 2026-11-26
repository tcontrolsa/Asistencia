/**
 * TCONTROL · ARCHIVADO AUTOMÁTICO NOCTURNO (Firestore → Sheets)
 *
 * Hace solo lo que hacía el botón «Archivar Datos Históricos» del panel de supervisor: pasa a las hojas REGISTROS,
 * VACACIONES y ALMUERZOS_EXTRA todo lo anterior a los últimos días que se conservan (ARCHIVADO_AUTO_DIAS_CONSERVAR)
 * y después lo borra de Firestore. Corre dentro de mantenimientoDiario() (04:00), DESPUÉS de confirmar las horas
 * extra, para que el día ya esté completo.
 *
 *  - Mismo guardado que el panel: archivarRegistrosEnHojas_ (api_completa.gs), con deduplicación y candado.
 *  - Solo borra de Firestore lo que Sheets confirmó, por lotes (igual que el panel).
 *  - Si algo falla, no borra nada y lo deja para la noche siguiente. El resultado queda en la propiedad
 *    ARCHIVADO_AUTO_ULTIMO (ver estadoArchivadoAutomatico()).
 *  - La base histórica (Postgres) se pone al día sola en el siguiente ciclo de sync-historico (desde las 05:00).
 *  - El botón del panel sigue funcionando.
 *
 * Desde el editor (▶):
 *   simularArchivadoAutomatico()  → solo cuenta qué archivaría (no escribe ni borra nada)
 *   ejecutarArchivadoAutomatico() → lo hace de verdad ahora
 *   estadoArchivadoAutomatico()   → muestra el resultado de la última ejecución
 */

var ARCHIVADO_AUTO_ACTIVO = true;
var ARCHIVADO_AUTO_DIAS_CONSERVAR = 1;     // se conserva ayer y hoy (como poner 1 día en el panel)
var ARCHIVADO_AUTO_LOTE = 200;             // registros por lote (igual que el panel)
var ARCHIVADO_AUTO_MAX_MS = 3 * 60 * 1000; // si se pasa, lo que falte queda para la noche siguiente

// ---------------------------------------------------------------- fechas (siempre hora de Ecuador, UTC−5)
function archAutoEc_(dt) { return new Date(dt.getTime() - 5 * 3600 * 1000); }   // leer con getUTC*
function archAutoPad_(n) { return (n < 10 ? '0' : '') + n; }
function archAutoISO_(ec) { return ec.getUTCFullYear() + '-' + archAutoPad_(ec.getUTCMonth() + 1) + '-' + archAutoPad_(ec.getUTCDate()); }

// Día de corte 'aaaa-mm-dd': se archiva lo anterior a este día
function archAutoLimite_(ahora, dias) {
  var l = archAutoEc_(ahora || new Date());
  l.setUTCDate(l.getUTCDate() - dias);
  return archAutoISO_(l);
}

// Día del documento 'aaaa-mm-dd' (a partir de fecha o, si falta, del timestamp); '' si no se puede saber
function archAutoDia_(fecha, timestamp) {
  var fechaDe = function (v) {
    if (v === undefined || v === null || v === '') return '';
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m) return m[3] + '-' + archAutoPad_(+m[2]) + '-' + archAutoPad_(+m[1]);
    m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?!\d)/);
    if (m && !/[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return m[1] + '-' + archAutoPad_(+m[2]) + '-' + archAutoPad_(+m[3]);
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : archAutoISO_(archAutoEc_(d));
  };
  return fechaDe(fecha) || fechaDe(timestamp);
}

// 'aaaa-mm-dd' → 'dd-mm-aaaa' (como formatearFechaA_DMY del panel)
function archAutoDMY_(iso) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || '');
}

// Marca de tiempo para la hoja, en hora de Ecuador: 'd-m-aaaa hh:mm:ss' (igual que el panel)
function archAutoTimestamp_(ts) {
  if (ts === undefined || ts === null || ts === '') return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  var ec = archAutoEc_(d);
  return ec.getUTCDate() + '-' + (ec.getUTCMonth() + 1) + '-' + ec.getUTCFullYear() + ' ' +
    archAutoPad_(ec.getUTCHours()) + ':' + archAutoPad_(ec.getUTCMinutes()) + ':' + archAutoPad_(ec.getUTCSeconds());
}

// ---------------------------------------------------------------- Firestore
function archAutoValor_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  return undefined;   // mapas y listas: no se usan en estos documentos
}

function archAutoCampos_(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) {
    var x = archAutoValor_(fields[k]);
    if (x !== undefined) out[k] = x;
  });
  return out;
}

function archAutoLeerColeccion_(col) {
  var docs = [], token = '';
  do {
    var res = fetchFirestore_(notifBaseFirestore_() + '/' + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (res.getResponseCode() !== 200) throw new Error('Firestore ' + col + ': HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 150));
    var d = JSON.parse(res.getContentText());
    (d.documents || []).forEach(function (x) { docs.push({ name: x.name, id: x.name.split('/').pop(), data: archAutoCampos_(x.fields) }); });
    token = d.nextPageToken || '';
  } while (token);
  return docs;
}

function archAutoBorrar_(nombres) {
  for (var i = 0; i < nombres.length; i += 400) {
    var writes = nombres.slice(i, i + 400).map(function (n) { return { 'delete': n }; });
    var r = fetchFirestore_(notifBaseFirestore_() + ':commit', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ writes: writes }) });
    if (r.getResponseCode() !== 200) throw new Error('Firestore (borrar): HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 150));
  }
}

// ---------------------------------------------------------------- selección (igual que el panel)
// Devuelve { registros: [{ doc, fila }], almuerzos: [{ doc, fila }], sinFecha: n }
function archAutoSeleccionar_(regs, invitados, limite) {
  var out = { registros: [], almuerzos: [], sinFecha: 0 };
  regs.forEach(function (doc) {
    var dia = archAutoDia_(doc.data.fecha, doc.data.timestamp);
    if (!dia) { out.sinFecha++; return; }
    if (dia >= limite) return;
    var fila = {};
    Object.keys(doc.data).forEach(function (k) { fila[k] = doc.data[k]; });
    fila.id = doc.id;
    fila.fecha = archAutoDMY_(dia);
    fila.timestamp = archAutoTimestamp_(doc.data.timestamp);
    out.registros.push({ doc: doc, fila: fila });
  });
  invitados.forEach(function (doc) {
    var d = doc.data;
    var dia = archAutoDia_(d.fecha, d.timestamp);
    if (!dia || dia >= limite) return;
    out.almuerzos.push({
      doc: doc,
      fila: {
        id: doc.id,
        fecha: archAutoDMY_(dia),
        nombre: (d.invitado || 'Invitado') + (d.empleadoNombre ? ' (Inv. de ' + d.empleadoNombre + ')' : ''),
        empresa: d.empresa || '',
        tipo: d.subtipo || d.tipoSolicitud || 'ALMUERZO_EXTRA',
        cantidad: d.cantidad || 1,
        hora: d.hora || '',
        timestamp: d.horaServicio ? '[Hora req: ' + d.horaServicio + ']' : '',
        observaciones: d.observacionesCompletas || d.observaciones || '',
        supervisorId: d.empleadoId || ''
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------- proceso
function archAutoGuardarEstado_(obj) {
  try { PropertiesService.getScriptProperties().setProperty('ARCHIVADO_AUTO_ULTIMO', JSON.stringify(obj)); } catch (e) { }
}

/**
 * simular=true: solo cuenta. Devuelve un resumen { ok, archivados, almuerzos, borrados, pendientes, error }.
 */
function archivarFirestoreAutomatico_(simular) {
  var inicio = Date.now();
  var resumen = { cuando: new Date().toISOString(), simulado: !!simular, ok: false, archivados: 0, almuerzos: 0, borrados: 0, pendientes: 0, sinFecha: 0, error: '' };
  try {
    var limite = archAutoLimite_(new Date(), ARCHIVADO_AUTO_DIAS_CONSERVAR);
    resumen.limite = limite;
    var regs = archAutoLeerColeccion_('registros');
    var invitados = [];
    try { invitados = archAutoLeerColeccion_('solicitudes_invitados'); } catch (e) { Logger.log('Archivado: no se leyeron solicitudes_invitados: ' + e); }
    var sel = archAutoSeleccionar_(regs, invitados, limite);
    resumen.sinFecha = sel.sinFecha;
    resumen.pendientes = sel.registros.length + sel.almuerzos.length;
    Logger.log('Archivado automático: ' + regs.length + ' registros en Firestore; antes de ' + limite + ': ' + sel.registros.length +
      ' asistencias y ' + sel.almuerzos.length + ' pedidos de catering (' + sel.sinFecha + ' sin fecha, se dejan).');
    if (simular || resumen.pendientes === 0) { resumen.ok = true; return resumen; }

    var nReg = sel.registros.length;
    var lotes = Math.max(1, Math.ceil(nReg / ARCHIVADO_AUTO_LOTE));
    var almPendientes = sel.almuerzos;
    for (var i = 0, lote = 0; i < Math.max(nReg, 1); i += ARCHIVADO_AUTO_LOTE, lote++) {
      if (Date.now() - inicio > ARCHIVADO_AUTO_MAX_MS) { Logger.log('Archivado: se acabó el tiempo, el resto sigue mañana.'); break; }
      var trozo = sel.registros.slice(i, i + ARCHIVADO_AUTO_LOTE);
      var alm = lote === 0 ? almPendientes : [];
      if (!trozo.length && !alm.length) break;
      var res = archivarRegistrosEnHojas_({ registros: trozo.map(function (x) { return x.fila; }), almuerzosExtra: alm.map(function (x) { return x.fila; }) });
      if (!res || !res.ok) throw new Error('Sheets no confirmó el lote ' + (lote + 1) + ': ' + ((res && res.error) || 'sin respuesta'));
      // Sheets confirmó: recién ahora se borra de Firestore
      var nombres = trozo.map(function (x) { return x.doc.name; }).concat(alm.map(function (x) { return x.doc.name; }));
      archAutoBorrar_(nombres);
      resumen.archivados += trozo.length;
      resumen.almuerzos += alm.length;
      resumen.borrados += nombres.length;
    }
    resumen.pendientes -= resumen.borrados;
    resumen.ok = true;
  } catch (e) {
    resumen.error = String(e && e.message || e);
    Logger.log('❌ Archivado automático: ' + resumen.error);
  }
  archAutoGuardarEstado_(resumen);
  return resumen;
}

// Llamado desde mantenimientoDiario() (mantenimiento_registros.gs)
function archivadoAutomaticoDiario() {
  if (!ARCHIVADO_AUTO_ACTIVO) { Logger.log('Archivado automático desactivado.'); return; }
  var r = archivarFirestoreAutomatico_(false);
  Logger.log('Archivado automático: ' + (r.ok ? 'listo' : 'FALLÓ') + ' — ' + r.archivados + ' asistencias, ' + r.almuerzos + ' pedidos de catering, ' + r.borrados + ' borrados de Firestore.');
}

// ---------------------------------------------------------------- editor (▶)
function simularArchivadoAutomatico() {
  var r = archivarFirestoreAutomatico_(true);
  Logger.log(JSON.stringify(r));
}

function ejecutarArchivadoAutomatico() {
  var r = archivarFirestoreAutomatico_(false);
  Logger.log(JSON.stringify(r));
}

function estadoArchivadoAutomatico() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('ARCHIVADO_AUTO_ULTIMO') || 'Todavía no se ejecutó.');
}
