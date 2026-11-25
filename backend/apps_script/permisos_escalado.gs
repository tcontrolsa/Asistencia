/**
 * TCONTROL · Permisos: recordatorio al jefe y caducidad (flujo de permisos)
 *
 * Desde 2026-11-25 toda solicitud (colección solicitudes_permiso, JS/permisos.js) espera la aprobación o el rechazo
 * del jefe inmediato; ya NO pasa a TTHH por falta de respuesta. Cada 15 minutos este activador revisa las pendientes:
 *   · Plazo cumplido (caduca_en: el inicio del permiso, o 8 horas laborables si al pedirlo ya había empezado) →
 *     estado CADUCADA («No válida»), con aviso al colaborador y a quien debía responder. TTHH no recibe nada.
 *   · Sin responder → recordatorio a quien debe responder: uno por día laborable (hasta 3) y uno final cuando quedan
 *     4 horas laborables o menos.
 * Quien responde: el jefe inmediato (PENDIENTE_JEFE) o TTHH si el colaborador no tiene un jefe que pueda responder
 * (PENDIENTE_TTHH; configuracion/permisos.tthh o, si está vacía, los supervisores administradores).
 * La escritura exige que el documento no haya cambiado desde la lectura: si el jefe responde en ese instante, no se
 * pisa su respuesta.
 *
 * Usa: fetchFirestore_ (firestore_servidor.gs), notifBaseFirestore_, crearNotificacion_, whatsappA_, nombreCorto_,
 *      primerNombre_, valorFirestore_ (notificaciones.gs), valorAvisoAlm_ (aviso_almuerzos.gs),
 *      esFeriadoFechaAuto_ (autocompletar_salidas.gs), listarEmpleadosFirestore_.
 *
 * Desde el editor (▶):
 *   revisarEscaladoPermisos()   NO cambia nada: muestra qué solicitudes caducarían o recibirían recordatorio ahora
 *   instalarEscaladoPermisos()  activador cada 15 minutos (los nombres se conservan: el activador ya instalado sirve)
 *
 * Fase 2 (2026-11-11): en la misma ejecución copia a la hoja VACACIONES_HORAS las horas de permiso personal
 * aprobadas que se cargaron a vacaciones (vacaciones_por_dia; una fila por día) y marca la solicitud con
 * vacaciones_hoja = true (si un administrador elimina la solicitud, quita esas filas). La columna I de CALCULAR_vacaciones suma 1 día por cada 8 h (vacaciones_auto.gs).
 */

var PERM_COL = 'solicitudes_permiso';
var PERM_CFG = 'configuracion/permisos';
var PERM_TIPOS = { VACACIONES: 'vacaciones', PERMISO_PERSONAL: 'permiso personal', PERMISO_MEDICO: 'permiso médico', CALAMIDAD: 'calamidad doméstica' };

function escalarPermisosVencidos() { revisarPendientesPermisos_(true); sincronizarCargosVacaciones_(true); quitarCargosEliminados_(true); if (typeof vencerDocumentosPermisos_ === 'function') vencerDocumentosPermisos_(true); }
function revisarEscaladoPermisos() { revisarPendientesPermisos_(false); sincronizarCargosVacaciones_(false); quitarCargosEliminados_(false); if (typeof vencerDocumentosPermisos_ === 'function') vencerDocumentosPermisos_(false); }

var PERM_ZONA = 'America/Guayaquil';
var PERM_JORNADA = { ini: 7 * 60 + 30, fin: 16 * 60 + 15 };
var PERM_RECORDATORIOS_MAX = 3;     // diarios, además del final
var PERM_MIN_FINAL = 4 * 60;        // recordatorio final: quedan 4 horas laborables o menos

function revisarPendientesPermisos_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('Otra ejecución en curso'); return; }
  try {
    var ahora = new Date();
    var pendientes = solicitudesPorEstado_('PENDIENTE_JEFE').concat(solicitudesPorEstado_('PENDIENTE_TTHH'));
    Logger.log(pendientes.length + ' solicitud(es) sin responder');
    pendientes.forEach(function (s) {
      var caduca = caducaPermiso_(s);
      var linea = s.id + ' · ' + s.nombre + ' (' + s.empleadoId + ') · ' + (PERM_TIPOS[s.tipo] || s.tipo) + ' · ' + periodoPermiso_(s) +
        ' · responde ' + (s.estado === 'PENDIENTE_JEFE' ? s.aprobador_nombre : 'TTHH') + ' · plazo ' + textoPlazoPermiso_(caduca);
      if (caduca <= ahora) {
        if (!aplicar) { Logger.log('Caducaría (no válida): ' + linea); return; }
        var iso = ahora.toISOString();
        if (!cambiarSolicitudPermiso_(s, { estado: 'CADUCADA', caduca_en: caduca.toISOString(), caducada_en: iso }, { en: iso, quien: 'Sistema', accion: 'CADUCADA' })) {
          Logger.log('No se cambió (ya la respondieron o cambió): ' + linea); return;
        }
        Logger.log('Caducó (no válida): ' + linea);
        avisarCaducada_(s, caduca);
        return;
      }
      var motivo = recordatorioPermiso_(s, caduca, ahora);
      if (!motivo) return;
      if (!aplicar) { Logger.log('Recordatorio ' + motivo + ': ' + linea); return; }
      var campos = { recordado_en: ahora.toISOString(), recordatorios: Number(s.recordatorios || 0) + 1 };
      if (motivo === 'final') campos.recordado_final = true;
      if (!cambiarSolicitudPermiso_(s, campos, null)) { Logger.log('Recordatorio omitido (la solicitud cambió): ' + linea); return; }
      Logger.log('Recordatorio ' + motivo + ': ' + linea);
      recordarPermiso_(s, caduca, campos.recordatorios);
    });
  } finally {
    lock.releaseLock();
  }
}

// Igual que caducaEn() de JS/permisos.js: las pedidas antes del 2026-11-25 no traen caduca_en
function caducaPermiso_(s) {
  if (s.caduca_en) return new Date(s.caduca_en);
  var ini = s.modalidad === 'HORAS' && s.hora_desde
    ? new Date(s.desde + 'T' + String(s.hora_desde).slice(0, 5) + ':00-05:00')
    : new Date(((s.fechas || [])[0] || s.desde) + 'T07:30:00-05:00');
  var jefe = new Date(s.vence_jefe || s.creada_en || 0);
  return jefe > ini ? jefe : ini;
}

function textoPlazoPermiso_(d) { return Utilities.formatDate(d, PERM_ZONA, 'dd/MM/yyyy HH:mm'); }

function diaLaborablePermiso_(fechaIso) {
  var dia = new Date(fechaIso + 'T12:00:00-05:00').getUTCDay();
  return dia !== 0 && dia !== 6 && !esFeriadoFechaAuto_(fechaIso);
}

// Minutos de jornada (L–V 07:30–16:15, sin feriados) entre dos momentos; se corta al pasar el tope
function minutosLaborablesPermiso_(desde, hasta, tope) {
  var total = 0, t = desde.getTime();
  for (var i = 0; i < 60 && total <= tope; i++) {
    var f = Utilities.formatDate(new Date(t), PERM_ZONA, 'yyyy-MM-dd');
    var medianoche = new Date(f + 'T00:00:00-05:00').getTime();
    if (medianoche > hasta.getTime()) break;
    if (diaLaborablePermiso_(f)) {
      var a = Math.max(desde.getTime(), medianoche + PERM_JORNADA.ini * 60000);
      var b = Math.min(hasta.getTime(), medianoche + PERM_JORNADA.fin * 60000);
      if (b > a) total += (b - a) / 60000;
    }
    t = medianoche + 36 * 3600000;   // mediodía del día siguiente
  }
  return total;
}

// 'diario', 'final' o '' (no toca). Solo dentro de la jornada y nunca en la primera hora después de pedirla.
function recordatorioPermiso_(s, caduca, ahora) {
  var hoy = Utilities.formatDate(ahora, PERM_ZONA, 'yyyy-MM-dd');
  var hm = Utilities.formatDate(ahora, PERM_ZONA, 'HH:mm');
  if (!diaLaborablePermiso_(hoy) || hm < '08:00' || hm > '16:15') return '';
  var creada = new Date(s.creada_en || 0);
  if (ahora - creada < 3600000) return '';
  var ultimo = s.recordado_en ? new Date(s.recordado_en) : creada;
  if (!s.recordado_final && ahora - ultimo >= 3600000 && minutosLaborablesPermiso_(ahora, caduca, PERM_MIN_FINAL) <= PERM_MIN_FINAL) return 'final';
  if (s.recordado_final || Number(s.recordatorios || 0) >= PERM_RECORDATORIOS_MAX) return '';
  return Utilities.formatDate(ultimo, PERM_ZONA, 'yyyy-MM-dd') < hoy ? 'diario' : '';
}

// Quién debe responder: el jefe inmediato o las personas de TTHH (nunca el mismo colaborador)
function respondenPermiso_(s) {
  var l = s.estado === 'PENDIENTE_JEFE' ? [{ id: String(s.aprobador_id), nombre: s.aprobador_nombre || '' }] : destinatariosTthhPermisos_();
  return l.filter(function (d) { return d.id && String(d.id) !== String(s.empleadoId); });
}

function recordarPermiso_(s, caduca, n) {
  var tipo = PERM_TIPOS[s.tipo] || s.tipo;
  var quien = nombreCorto_(s.nombre) + ' (ID ' + s.empleadoId + ')';   // notificaciones.gs
  var enlace = { modulo: 'permisos', id: s.id };
  respondenPermiso_(s).forEach(function (d) {
    crearNotificacion_({ para: d.id, tipo: 'permiso_solicitud', titulo: 'Solicitud de ' + tipo + ' sin responder', texto: quien + ' ' + periodoPermiso_(s) + ' · responde antes del ' + textoPlazoPermiso_(caduca),
      enlace: enlace, clave: 'permiso_' + s.id + '_recordatorio' + n + '_' + d.id });
    var r = whatsappA_(d.id, 'Hola *' + primerNombre_(d.nombre) + '*, te escribimos de TCONTROL.\n\n⏰ Falta tu respuesta a la solicitud de *' + tipo + '* de *' + quien + '* ' + periodoPermiso_(s) +
      '.\n\nSi no la apruebas o rechazas antes del *' + textoPlazoPermiso_(caduca) + '*, no será válida.\n\n👉 Respóndela en la app TCONTROL → *Permisos* → *Por aprobar*.');
    if (!r || r.ok === false) Logger.log('WhatsApp a ' + d.id + ' no enviado: ' + (r && r.error));
  });
}

function avisarCaducada_(s, caduca) {
  var tipo = PERM_TIPOS[s.tipo] || s.tipo;
  var quien = nombreCorto_(s.nombre) + ' (ID ' + s.empleadoId + ')';
  var enlace = { modulo: 'permisos', id: s.id };
  crearNotificacion_({ para: s.empleadoId, tipo: 'permiso_vencido', titulo: 'Tu solicitud de ' + tipo + ' no es válida', texto: periodoPermiso_(s) + ' · no se respondió antes del ' + textoPlazoPermiso_(caduca),
    enlace: enlace, clave: 'permiso_' + s.id + '_caducada_col' });
  var r = whatsappA_(s.empleadoId, 'Hola *' + primerNombre_(s.nombre) + '*, te escribimos de TCONTROL.\n\n⌛ Tu solicitud de *' + tipo + '* ' + periodoPermiso_(s) +
    ' no se respondió a tiempo y *no es válida*: ese tiempo no está justificado.\n\nHabla con tu jefe inmediato y, si todavía lo necesitas, pide un permiso nuevo.');
  if (!r || r.ok === false) Logger.log('WhatsApp a ' + s.empleadoId + ' no enviado: ' + (r && r.error));
  respondenPermiso_(s).forEach(function (d) {
    crearNotificacion_({ para: d.id, tipo: 'permiso_vencido', titulo: 'Solicitud sin responder: no es válida', texto: quien + ' ' + periodoPermiso_(s) + ' · ' + tipo + ' · venció el plazo para responder',
      enlace: enlace, clave: 'permiso_' + s.id + '_caducada_' + d.id });
  });
}

function solicitudesPorEstado_(estado) {
  var res = fetchFirestore_(notifBaseFirestore_() + ':runQuery?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: PERM_COL }],
      where: { fieldFilter: { field: { fieldPath: 'estado' }, op: 'EQUAL', value: { stringValue: estado } } }
    } })
  });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo leer ' + PERM_COL + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText()).filter(function (r) { return r.document; }).map(function (r) {
    var s = valorAvisoAlm_({ mapValue: { fields: r.document.fields || {} } }) || {};
    s.id = r.document.name.split('/').pop();
    s._nombreDoc = r.document.name;
    s._updateTime = r.document.updateTime;
    return s;
  });
}

// Cambia campos de la solicitud solo si nadie la modificó desde que se leyó
function cambiarSolicitudPermiso_(s, campos, historial) {
  var fields = {};
  Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
  var write = {
    update: { name: s._nombreDoc, fields: fields },
    updateMask: { fieldPaths: Object.keys(campos) },
    currentDocument: { updateTime: s._updateTime }
  };
  if (historial) write.updateTransforms = [{ fieldPath: 'historial', appendMissingElements: { values: [valorFirestore_(historial)] } }];
  var res = fetchFirestore_(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ writes: [write] })
  });
  if (res.getResponseCode() !== 200) { Logger.log('Cambio rechazado (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200)); return false; }
  return true;
}

function destinatariosTthhPermisos_() {
  var res = fetchFirestore_(notifBaseFirestore_() + '/' + PERM_CFG + '?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  var cfg = res.getResponseCode() === 200 ? valorAvisoAlm_({ mapValue: { fields: JSON.parse(res.getContentText()).fields || {} } }) : {};
  var lista = (cfg && cfg.tthh || []).filter(function (x) { return x && x.id; }).map(function (x) { return { id: String(x.id), nombre: x.nombre || '' }; });
  if (lista.length) return lista;
  // Sin TTHH configurado: supervisores administradores (igual que la app)
  return listarEmpleadosFirestore_().filter(function (e) {
    var rol = String(e.supervisor || e.rol || '').toUpperCase();
    return String(e.activo || 'SI').toUpperCase() !== 'NO' && (String(e.id) === '1058' || rol.indexOf('ADMIN') !== -1);
  }).map(function (e) { return { id: String(e.id), nombre: e.nombre || '' }; });
}

function periodoPermiso_(s) {
  var f = function (x) { var m = String(x || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  if (s.modalidad === 'HORAS') return 'el ' + f(s.desde) + ' de ' + s.hora_desde + ' a ' + s.hora_hasta;
  return s.desde === s.hasta ? 'el ' + f(s.desde) : 'del ' + f(s.desde) + ' al ' + f(s.hasta) + ' (' + s.dias + ' días laborables)';
}

function instalarEscaladoPermisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'escalarPermisosVencidos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('escalarPermisosVencidos').timeBased().everyMinutes(15).create();
  Logger.log('Activador instalado: escalarPermisosVencidos cada 15 minutos.');
}

// ---------------------------------------------------------------- fase 2: horas cargadas a vacaciones
var PERM_HOJA_HORAS = 'VACACIONES_HORAS';

function sincronizarCargosVacaciones_(aplicar) {
  // Fase 5: un permiso marcado con «Voy a regresar» cambia de duración al volver; se copia cuando regresa
  // o cuando termina el día (si no regresó, queda hasta las 16:15).
  var hoyPerm = Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd');
  var pendientes = solicitudesPorEstado_('APROBADA').filter(function (s) {
    if (s.regreso_pendiente === true && String(s.desde || '') >= hoyPerm) return false;
    return s.tipo === 'PERMISO_PERSONAL' && Number(s.cargo_vacaciones_min || 0) > 0 && s.vacaciones_hoja !== true;
  });
  if (!pendientes.length) { Logger.log('Horas a vacaciones: nada nuevo'); return; }
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(PERM_HOJA_HORAS);
  if (!hoja && aplicar) {
    hoja = ss.insertSheet(PERM_HOJA_HORAS);
    hoja.getRange(1, 1, 1, 6).setValues([['FECHA', 'ID', 'MINUTOS', 'SOLICITUD', 'NOMBRE', 'REGISTRADO']]).setFontWeight('bold');
    hoja.getRange('B:B').setNumberFormat('@');
    hoja.setFrozenRows(1);
  }
  // Solicitudes ya escritas (por si una ejecución anterior escribió la hoja y no alcanzó a marcar Firestore)
  var yaEnHoja = {};
  if (hoja && hoja.getLastRow() > 1) {
    hoja.getRange(2, 4, hoja.getLastRow() - 1, 1).getValues().forEach(function (f) { yaEnHoja[String(f[0])] = true; });
  }
  pendientes.forEach(function (s) {
    var porDia = s.vacaciones_por_dia || {};
    var filas = Object.keys(porDia).sort().filter(function (f) { return Number(porDia[f]) > 0; }).map(function (f) {
      var p = f.split('-');
      return [new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])), String(s.empleadoId), Number(porDia[f]), s.id, s.nombre || '', new Date()];
    });
    var linea = s.id + ' · ' + s.nombre + ' (' + s.empleadoId + ') · ' + s.cargo_vacaciones_min + ' min en ' + filas.length + ' día(s)';
    if (!aplicar) { Logger.log('Se copiaría a ' + PERM_HOJA_HORAS + ': ' + linea); return; }
    if (!yaEnHoja[s.id] && filas.length) {
      hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
      SpreadsheetApp.flush();
    }
    if (marcarCargoEnHoja_(s)) Logger.log('Copiado a ' + PERM_HOJA_HORAS + ': ' + linea);
    else Logger.log('Copiado a la hoja pero no se pudo marcar en Firestore (se reintenta y no se duplica): ' + linea);
  });
}

// Solicitudes eliminadas desde el panel cuyas horas ya se habían copiado: se quitan sus filas (columna SOLICITUD)
function quitarCargosEliminados_(aplicar) {
  var lista = solicitudesPorEstado_('CANCELADA').filter(function (s) { return s.eliminada === true && s.vacaciones_hoja === true; });
  if (!lista.length) return;
  var hoja = SpreadsheetApp.getActive().getSheetByName(PERM_HOJA_HORAS);
  lista.forEach(function (s) {
    var filas = [];
    if (hoja && hoja.getLastRow() > 1) {
      hoja.getRange(2, 4, hoja.getLastRow() - 1, 1).getValues().forEach(function (f, i) { if (String(f[0]) === s.id) filas.push(i + 2); });
    }
    var linea = s.id + ' · ' + s.nombre + ' (' + s.empleadoId + ') · ' + filas.length + ' fila(s)';
    if (!aplicar) { Logger.log('Se quitaría de ' + PERM_HOJA_HORAS + ' (solicitud eliminada): ' + linea); return; }
    filas.reverse().forEach(function (n) { hoja.deleteRow(n); });
    SpreadsheetApp.flush();
    Logger.log((marcarCargoEnHoja_(s, false) ? 'Quitado de ' : 'Quitado (sin marcar, se reintenta) de ') + PERM_HOJA_HORAS + ': ' + linea);
  });
}

function marcarCargoEnHoja_(s, enHoja) {
  var campos = { vacaciones_hoja: enHoja !== false, vacaciones_hoja_en: new Date().toISOString() };
  var fields = {};
  Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
  var mask = Object.keys(campos).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  var res = fetchFirestore_(notifBaseFirestore_() + '/' + PERM_COL + '/' + s.id + '?' + mask + '&key=' + EVAL_API_KEY_FIREBASE, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ fields: fields })
  });
  return res.getResponseCode() === 200;
}
