/**
 * TCONTROL · Recordatorio "no registró entrada" desde Apps Script — FASE 1: SOLO SIMULACIÓN
 *
 * Hoy el recordatorio lo envía el panel de supervisor (supervisor_whatsapp.js → calcularSinMarcarHoy) y solo
 * sale si alguien tiene el panel abierto. Antes de pasarlo a Apps Script, este archivo calcula cada día, a la
 * hora de corte, a quién se lo enviaría con las MISMAS reglas del panel y lo guarda en Firestore
 * `configuracion/recordatorio_sim_YYYY-MM-DD` (no envía ningún WhatsApp). El panel guarda en
 * `configuracion/whatsapp_autocheck` los IDs a los que sí envió; se comparan unos días y, cuando coincidan,
 * se activa el envío desde aquí y se apaga el del panel.
 *
 * Reglas (copiadas de calcularSinMarcarHoy y _reglasChequeoHoy):
 *   - Días: los de configuracion/whatsapp.diasEnvio (L–V por defecto); nunca sábado, domingo ni feriado.
 *   - Hora: desde configuracion/whatsapp.horaCorteNoRegistro (08:15 por defecto).
 *   - Personas: fichas activas que no son "solo almuerzo"/"sin asistencia"/comensal ni MASTER/VISITANTE.
 *   - Quedan fuera quienes hoy tienen ENTRADA, o un registro de ausencia con motivo (vacaciones, permiso,
 *     justificación), o están en campo (modo CAMPO en la ficha o en un registro de hoy).
 *   - Registros de hoy: Firestore y, para quien no tiene nada hoy en Firestore, las hojas REGISTROS y VACACIONES
 *     (igual que el panel, que une ambos orígenes).
 *
 * Ejecutar una vez desde el editor (▶): instalarSimulacionRecordatorio()
 * Prueba inmediata, sin guardar (▶): probarSimulacionRecordatorio()
 */

var REC_TZ = 'America/Guayaquil';
var REC_FERIADOS = ['1/1', '2/16', '2/17', '4/3', '4/30', '5/1', '5/25', '8/10', '10/9', '11/2', '11/3', '12/6', '12/25'];
var REC_FERIADOS_FECHA = ['2026-06-26'];
var REC_DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

// ---------------------------------------------------------------- activador (cada 5 min)
function simulacionRecordatorioDiario() {
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, REC_TZ, 'yyyy-MM-dd');
  var cfg = leerDocRec_('configuracion/whatsapp') || {};
  var regla = reglaDiaRec_(hoy, Utilities.formatDate(ahora, REC_TZ, 'HH:mm'), cfg);
  if (!regla.ok) return;
  if (leerDocRec_('configuracion/recordatorio_sim_' + hoy)) return;   // ya simulado hoy

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    if (leerDocRec_('configuracion/recordatorio_sim_' + hoy)) return;
    var lista = calcularSinMarcarHoyRec_(hoy);
    guardarDocRec_('configuracion/recordatorio_sim_' + hoy, {
      fecha: hoy, calculado_en: new Date().toISOString(), hora_corte: regla.horaCorte,
      total: lista.length, ids: lista.map(function (e) { return e.id; }),
      nombres: lista.map(function (e) { return e.id + ' ' + e.nombre; })
    });
    Logger.log('Simulación ' + hoy + ': ' + lista.length + ' sin marcar');
  } finally {
    lock.releaseLock();
  }
}

function reglaDiaRec_(hoy, hm, cfg) {
  var d = new Date(hoy + 'T12:00:00');
  var dia = REC_DIAS[d.getDay()];
  if (dia === 'SABADO' || dia === 'DOMINGO') return { ok: false, motivo: 'fin de semana' };
  if (REC_FERIADOS_FECHA.indexOf(hoy) !== -1 || REC_FERIADOS.indexOf((d.getMonth() + 1) + '/' + d.getDate()) !== -1) return { ok: false, motivo: 'feriado' };
  var dias = Array.isArray(cfg.diasEnvio) && cfg.diasEnvio.length ? cfg.diasEnvio : ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'];
  if (dias.indexOf(dia) === -1) return { ok: false, motivo: 'día no configurado' };
  var corte = /^\d{1,2}:\d{2}$/.test(String(cfg.horaCorteNoRegistro || '')) ? cfg.horaCorteNoRegistro : '08:15';
  if (('0' + corte).slice(-5) > hm) return { ok: false, motivo: 'antes del corte ' + corte };
  return { ok: true, horaCorte: corte };
}

// ---------------------------------------------------------------- reglas de calcularSinMarcarHoy
function calcularSinMarcarHoyRec_(hoy) {
  var emps = listarEmpleadosFirestore_();
  var regsFs = consultaAvisoAlm_('registros', 'fecha', hoy);   // aviso_almuerzos.gs
  var porEmp = {};
  regsFs.forEach(function (r) {
    var id = String(r.empleadoId || '').trim();
    if (id) (porEmp[id] = porEmp[id] || []).push(r);
  });
  // Hojas: solo para quien no tiene nada hoy en Firestore (el panel hace lo mismo)
  var conFirestore = {};
  Object.keys(porEmp).forEach(function (id) { conFirestore[id] = true; });
  regsHojasHoyRec_(hoy).forEach(function (r) {
    if (!r.empleadoId || conFirestore[r.empleadoId]) return;
    (porEmp[r.empleadoId] = porEmp[r.empleadoId] || []).push(r);
  });

  return emps.filter(function (e) {
    var act = String(e.activo || '').trim().toUpperCase();
    var est = String(e.estado || '').trim().toUpperCase();
    if (act === 'NO' || act === 'FALSE' || e.activo === false || est === 'INACTIVO') return false;
    if (esSoloAlmuerzoRec_(e)) return false;
    var tipo = String(e.tipoRegistro || e.tipo || '').toUpperCase();
    if (tipo === 'MASTER' || tipo === 'VISITANTE') return false;

    var regs = porEmp[e.id] || [];
    if (regs.some(function (r) { return String(r.tipo || '').toUpperCase() === 'ENTRADA'; })) return false;
    var fReg = regs.filter(function (r) {
      var t = String(r.tipo || '').toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO';
    })[0];
    var razon = fReg ? String(fReg.razon_ausencia || fReg.razon_permiso || fReg.razon_justificac || '') : '';
    if (razon.length > 0) return false;   // vacaciones, permiso, justificación, campo…
    if (String(e.modo || '').toUpperCase().indexOf('CAMPO') !== -1) return false;
    if (regs.some(function (r) { return r.modo === 'CAMPO'; })) return false;
    return true;
  }).map(function (e) { return { id: e.id, nombre: e.nombre || '', telefono: e.telefono || '' }; });
}

function esSoloAlmuerzoRec_(e) {
  if (e.isSinAsistencia || e.isVisitante) return true;
  var cargo = String(e.cargo || '').toUpperCase().trim();
  var area = String(e.area || e.departamento || '').toUpperCase().trim();
  var tipo = String(e.tipo || e.tipoRegistro || '').toUpperCase().trim();
  if (cargo.indexOf('SIN ASISTENCIA') !== -1 || cargo.indexOf('SOLO ALMUERZO') !== -1 || cargo.indexOf('COMENSAL') !== -1) return true;
  if (area.indexOf('SOLO ALMUERZO') !== -1 || area.indexOf('COMENSAL') !== -1) return true;
  if (tipo.indexOf('SOLO ALMUERZO') !== -1 || tipo.indexOf('COMENSAL') !== -1) return true;
  if (e.soloAlmuerzo === true || String(e.soloAlmuerzo).toUpperCase() === 'SI') return true;
  return false;
}

// Filas de hoy en REGISTROS y VACACIONES (A FECHA, B ID, D TIPO, L MODO, T RAZON_PERMISO, V RAZON_JUSTIFICAC)
function regsHojasHoyRec_(hoy) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];
  ['REGISTROS', 'VACACIONES'].forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 22).getValues();
    vals.forEach(function (f) {
      var fecha = f[0] instanceof Date ? Utilities.formatDate(f[0], REC_TZ, 'yyyy-MM-dd') : String(f[0] || '').trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) { var p = fecha.split('/'); fecha = p[2] + '-' + p[1] + '-' + p[0]; }
      if (fecha !== hoy) return;
      out.push({ empleadoId: String(f[1] || '').trim(), tipo: String(f[3] || ''), modo: String(f[11] || ''),
                 razon_permiso: String(f[19] || ''), razon_justificac: String(f[21] || ''), origen: nombre });
    });
  });
  return out;
}

// ---------------------------------------------------------------- Firestore
function leerDocRec_(ruta) {
  var res = fetchFirestore_(notifBaseFirestore_() + '/' + ruta + '?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  return valorAvisoAlm_({ mapValue: { fields: JSON.parse(res.getContentText()).fields || {} } });   // aviso_almuerzos.gs
}

function guardarDocRec_(ruta, datos) {
  var fields = {};
  Object.keys(datos).forEach(function (k) { fields[k] = valorFirestore_(datos[k]); });   // notificaciones.gs
  fetchFirestore_(notifBaseFirestore_() + '/' + ruta + '?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ fields: fields })
  });
}

// ---------------------------------------------------------------- editor (▶)
function instalarSimulacionRecordatorio() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'simulacionRecordatorioDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('simulacionRecordatorioDiario').timeBased().everyMinutes(5).create();
  Logger.log('Activador instalado: simulacionRecordatorioDiario cada 5 minutos (solo calcula y guarda; no envía).');
}

/** Calcula ahora mismo a quién iría el recordatorio de hoy, sin guardar ni enviar. */
function probarSimulacionRecordatorio() {
  var hoy = Utilities.formatDate(new Date(), REC_TZ, 'yyyy-MM-dd');
  var lista = calcularSinMarcarHoyRec_(hoy);
  Logger.log(lista.length + ' sin marcar hoy (' + hoy + '):\n' + lista.map(function (e) { return e.id + ' ' + e.nombre; }).join('\n'));
}
