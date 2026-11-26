/**
 * TCONTROL · Seguridad fase 2: quién puede usar cada acción de Apps Script
 *
 * La API Key es pública (está en el JavaScript de la página): no autoriza nada por sí sola.
 *   - sesion : cualquier persona activa con sesión de Firebase (idToken por POST; nunca en la URL).
 *   - gestor : master, administrador o supervisor.
 *   - admin  : master o administrador.
 *   - cola   : cambios que reenvía sync-historico desde Postgres, firmados por la base (025_sesion_ediciones.sql).
 *              Los de marcaciones también los acepta de un gestor con sesión (cuando la base no está disponible).
 * Las que no están aquí siguen como antes (lecturas de la sincronización, avisos públicos, etc.).
 */
var NIVEL_ACCION = {
  tokenHistorico: 'sesion',
  registrarAlmuerzoExtra: 'sesion',
  eliminarAlmuerzoExtra: 'sesion',
  registrarLogWhatsApp: 'sesion',

  archivarRegistros: 'gestor',
  escribirHojaActualizar: 'gestor',
  leerHojaActualizar: 'gestor',
  crearReporteGoogleSheets: 'gestor',
  exportarCalcularVacaciones: 'gestor',
  actualizarAlmuerzoSupervisor: 'gestor',
  guardarPreguntasCultura: 'gestor',
  archivarMenuConsumido: 'gestor',
  obtenerHistorialMenuSugerencias: 'gestor',
  obtenerLogsWhatsApp: 'gestor',
  desvincularColaborador: 'gestor',
  listarDesvinculados: 'gestor',

  guardarConfiguracionWhatsApp: 'gestor',
  eliminarEmpleadoDefinitivo: 'admin',
  resetearPinesEmpleados: 'admin',

  actualizarRegistroArchivado: 'cola',
  actualizarRegistroGeneral: 'cola',
  justificarDia: 'cola',
  eliminarRegistroArchivado: 'cola',
  eliminarRegistro: 'cola',
  guardarPermisoSupervisor: 'cola',
  guardarEvaluacion: 'cola',
  eliminarEvaluacion: 'cola',
  notificarVisita: 'cola',
  enviarRegistro: 'cola',
  avisoRegistro: 'cola'
};
var COLA_CON_SESION = ['actualizarRegistroArchivado', 'actualizarRegistroGeneral', 'justificarDia', 'eliminarRegistroArchivado',
  'eliminarRegistro', 'guardarPermisoSupervisor'];
var ROLES_GESTOR = ['master', 'admin', 'supervisor'];
var MSG_SIN_SESION = 'Tu sesión de seguridad no está activa. Recarga la página y confirma tu contraseña.';

/**
 * null si la acción puede continuar; si no, la respuesta de rechazo.
 * porPost: el idToken solo se acepta en el cuerpo de un POST JSON. Deja en p._quien a la persona verificada.
 */
function rechazoSeguridad_(p, porPost) {
  var accion = String((p && p.accion) || '');
  delete p._quien;
  var nivel = Object.prototype.hasOwnProperty.call(NIVEL_ACCION, accion) ? NIVEL_ACCION[accion] : '';
  if (!nivel) return null;
  if (nivel === 'cola' && firmaColaValida_(p)) return null;
  var quien = porPost && p.idToken ? quienLlama_(p.idToken) : null;
  if (!quien) {
    return nivel === 'cola' && COLA_CON_SESION.indexOf(accion) === -1
      ? { ok: false, error: 'Cambio sin firma válida' }
      : { ok: false, sinSesion: true, error: MSG_SIN_SESION };
  }
  var gestor = ROLES_GESTOR.indexOf(quien.rol) !== -1;
  var puede = nivel === 'sesion' ||
    (nivel === 'gestor' && gestor) ||
    (nivel === 'admin' && (quien.rol === 'master' || quien.rol === 'admin')) ||
    (nivel === 'cola' && gestor && COLA_CON_SESION.indexOf(accion) !== -1);
  if (!puede) {
    if (typeof registrarAcceso_ === 'function') registrarAcceso_(quien.uid, accion, 'rechazado', 'rol ' + quien.rol);
    return { ok: false, error: 'No tienes permiso para esta acción.' };
  }
  p._quien = quien;
  return null;
}

// Persona de la sesión de Firebase: { uid, rol }. Se recuerda 5 min por token para no consultar a Google en cada llamada.
function quienLlama_(idToken) {
  if (!idToken) return null;
  var cache = CacheService.getScriptCache();
  var clave = 'quien_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken))).slice(0, 43);
  var enCache = cache.get(clave);
  if (enCache) return JSON.parse(enCache);
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: String(idToken) })
  });
  if (res.getResponseCode() !== 200) return null;
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || !u.localId) return null;
  var quien = null;
  if (u.localId === 'terminal_guardia') quien = { uid: u.localId, rol: 'guardia' };
  else {
    var emp = leerEmpleadoFirestore_(u.localId);
    if (emp && credActivo_(emp)) quien = { uid: u.localId, rol: rolSesionFirebase_(u.localId, emp) };
  }
  if (quien) cache.put(clave, JSON.stringify(quien), 300);
  return quien;
}

// ---------------------------------------------------------------- cola de Postgres
function hexBytes_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Misma clave que historico.secretos('cola'): se deriva del secreto que ya comparten Apps Script y PostgREST
function claveCola_() {
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  return secreto ? hexBytes_(Utilities.computeHmacSha256Signature('cola-apps-script', secreto)) : '';
}

function firmaColaValida_(p) {
  if (!p.firma || !/^\d+$/.test(String(p.colaId || ''))) return false;
  var k = claveCola_();
  if (!k) return false;
  var v = function (x) { return x === undefined || x === null ? '' : String(x); };
  var texto = k + '|' + p.colaId + '|' + p.accion + '|' + v(p.empleadoId) + '|' + v(p.fecha) + '|' + k;
  return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)) === String(p.firma);
}

// ---------------------------------------------------------------- token de la base histórica
// ¿Es de TTHH? (lista de configuracion/permisos)
function esTthhSeguridad_(uid) {
  try {
    var res = fetchFirestore_(notifBaseFirestore_() + '/configuracion/permisos?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return false;
    var f = (JSON.parse(res.getContentText()).fields || {}).tthh;   // [{ id, nombre }]
    var lista = (f && f.arrayValue && f.arrayValue.values) || [];
    return lista.some(function (x) {
      var id = x.mapValue && x.mapValue.fields && x.mapValue.fields.id;
      return !!id && String(id.stringValue !== undefined ? id.stringValue : id.integerValue) === String(uid);
    });
  } catch (e) { console.error('esTthhSeguridad_:', e); return false; }
}

/** Editor (▶): comprueba que la firma se puede calcular (no muestra la clave). */
function probarSeguridadAcciones() {
  Logger.log('Clave de la cola: ' + (claveCola_() ? 'SÍ' : 'NO (falta PGRST_JWT_SECRET)'));
}
