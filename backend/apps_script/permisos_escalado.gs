/**
 * TCONTROL · Permisos: paso automático a TTHH (fase 1 del flujo de permisos, 2026-11-10)
 *
 * Las solicitudes de vacaciones y permiso personal (colección solicitudes_permiso, JS/permisos.js) esperan al
 * jefe inmediato hasta `vence_jefe` (8 horas laborables, L–V 07:30–16:15 sin feriados, calculado al crearla).
 * Cada 15 minutos este activador busca las que siguen en PENDIENTE_JEFE con el plazo vencido y las pasa a
 * PENDIENTE_TTHH: aviso en la campana y WhatsApp a las personas de TTHH (configuracion/permisos.tthh; si la
 * lista está vacía, a los supervisores administradores) y aviso en la campana al jefe.
 * La escritura exige que el documento no haya cambiado desde la lectura: si el jefe aprueba en ese instante,
 * no se pisa su respuesta.
 *
 * Usa: fetchFirestore_ (firestore_servidor.gs), notifBaseFirestore_, crearNotificacion_, whatsappA_,
 *      valorFirestore_ (notificaciones.gs), valorAvisoAlm_ (aviso_almuerzos.gs), listarEmpleadosFirestore_.
 *
 * Desde el editor (▶):
 *   revisarEscaladoPermisos()   NO cambia nada: muestra qué solicitudes pasarían a TTHH ahora
 *   instalarEscaladoPermisos()  activador cada 15 minutos
 */

var PERM_COL = 'solicitudes_permiso';
var PERM_CFG = 'configuracion/permisos';
var PERM_TIPOS = { VACACIONES: 'vacaciones', PERMISO_PERSONAL: 'permiso personal', PERMISO_MEDICO: 'permiso médico', CALAMIDAD: 'calamidad doméstica' };

function escalarPermisosVencidos() { return escalarPermisos_(true); }
function revisarEscaladoPermisos() { return escalarPermisos_(false); }

function escalarPermisos_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('Otra ejecución en curso'); return; }
  try {
    var ahora = new Date();
    var vencidas = pendientesJefePermisos_().filter(function (s) { return s.vence_jefe && new Date(s.vence_jefe) <= ahora; });
    Logger.log(vencidas.length + ' solicitud(es) vencida(s) para el jefe');
    if (!vencidas.length) return;
    var destinos = aplicar ? destinatariosTthhPermisos_() : [];
    vencidas.forEach(function (s) {
      var linea = s.id + ' · ' + s.nombre + ' (' + s.empleadoId + ') · ' + (PERM_TIPOS[s.tipo] || s.tipo) + ' · ' + periodoPermiso_(s) + ' · jefe ' + s.aprobador_nombre + ' · vencía ' + s.vence_jefe;
      if (!aplicar) { Logger.log('Pasaría a TTHH: ' + linea); return; }
      if (!pasarATthh_(s, ahora)) { Logger.log('No se cambió (ya la resolvieron o cambió): ' + linea); return; }
      Logger.log('Pasó a TTHH: ' + linea);
      avisarEscalado_(s, destinos);
    });
  } finally {
    lock.releaseLock();
  }
}

// Solicitudes en PENDIENTE_JEFE con su nombre de documento y la hora de su última modificación
function pendientesJefePermisos_() {
  var res = fetchFirestore_(notifBaseFirestore_() + ':runQuery?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: PERM_COL }],
      where: { fieldFilter: { field: { fieldPath: 'estado' }, op: 'EQUAL', value: { stringValue: 'PENDIENTE_JEFE' } } }
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

function pasarATthh_(s, ahora) {
  var iso = ahora.toISOString();
  var campos = { estado: 'PENDIENTE_TTHH', escalada: true, escalada_en: iso, motivo_tthh: 'sin_respuesta' };
  var fields = {};
  Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
  var res = fetchFirestore_(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ writes: [{
      update: { name: s._nombreDoc, fields: fields },
      updateMask: { fieldPaths: Object.keys(campos) },
      updateTransforms: [{ fieldPath: 'historial', appendMissingElements: { values: [valorFirestore_({ en: iso, quien: 'Sistema', accion: 'PASO_A_TTHH' })] } }],
      currentDocument: { updateTime: s._updateTime }
    }] })
  });
  if (res.getResponseCode() !== 200) { Logger.log('Escalado rechazado (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200)); return false; }
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

function avisarEscalado_(s, destinos) {
  var tipo = PERM_TIPOS[s.tipo] || s.tipo;
  var quien = String(s.nombre || '').split(/\s+/).slice(0, 3).join(' ') + ' (' + s.empleadoId + ')';
  var texto = quien + ' ' + periodoPermiso_(s) + ' · el jefe ' + String(s.aprobador_nombre || '').split(/\s+/).slice(0, 3).join(' ') + ' no respondió en 8 horas laborables';
  var enlace = { modulo: 'permisos', id: s.id };
  destinos.forEach(function (d) {
    if (String(d.id) === String(s.empleadoId)) return;
    crearNotificacion_({ para: d.id, tipo: 'permiso_escalado', titulo: 'Solicitud de ' + tipo + ' para TTHH', texto: texto, enlace: enlace, clave: 'permiso_' + s.id + '_escalado_' + d.id });
    var r = whatsappA_(d.id, 'Hola *' + primerNombre_(d.nombre) + '*, te escribimos de TCONTROL.\n\n📝 La solicitud de *' + tipo + '* de *' + quien + '* ' + periodoPermiso_(s) +
      ' pasó a TTHH porque su jefe inmediato no respondió en 8 horas laborables.' + (s.motivo ? '\nMotivo: ' + s.motivo : '') +
      '\n\n👉 Revísala en la app TCONTROL → *Permisos* → *Por aprobar*.');
    if (!r || r.ok === false) Logger.log('WhatsApp a ' + d.id + ' no enviado: ' + (r && r.error));
  });
  if (s.aprobador_id) {
    crearNotificacion_({ para: s.aprobador_id, tipo: 'permiso_escalado', titulo: 'La solicitud pasó a TTHH', texto: quien + ' ' + periodoPermiso_(s) + ' · no se respondió en 8 horas laborables', enlace: enlace, clave: 'permiso_' + s.id + '_escalado_jefe' });
  }
}

function instalarEscaladoPermisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'escalarPermisosVencidos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('escalarPermisosVencidos').timeBased().everyMinutes(15).create();
  Logger.log('Activador instalado: escalarPermisosVencidos cada 15 minutos.');
}
