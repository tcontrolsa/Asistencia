/**
 * Avisos emergentes (Web Push) con Firebase Cloud Messaging - API HTTP v1.
 *
 * Los tokens de cada dispositivo los guarda la PWA en Firestore: push_tokens/{empleadoId} {tokens: [..]}.
 * crearNotificacion_ (notificaciones.gs) llama a enviarPush_ después de crear cada aviso de la campana,
 * así que todos los avisos existentes salen también como notificación emergente.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   FCM_SERVICE_ACCOUNT  JSON completo de la cuenta de servicio de Firebase (NUNCA en el repositorio).
 *   PUSH_ACTIVO          'NO' apaga los envíos (por defecto activo si existe FCM_SERVICE_ACCOUNT).
 *   PUSH_RRHH_IDS        IDs de empleado (separados por coma) que reciben los avisos 'rol:rrhh'.
 *
 * El envío nunca debe romper la creación del aviso: todo va dentro de try/catch.
 * Se envían solo datos mínimos (título y texto del aviso, que ya llevan nombre corto + ID).
 */

var PUSH_COLECCION = 'push_tokens';
var PUSH_CACHE_TOKEN = 'push_fcm_access_token';

function pushActivo_() {
  var p = PropertiesService.getScriptProperties();
  return !!p.getProperty('FCM_SERVICE_ACCOUNT') && String(p.getProperty('PUSH_ACTIVO') || 'SI').toUpperCase() !== 'NO';
}

function pushCuenta_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT'));
}

function base64url_(bytesOTexto) {
  var s = typeof bytesOTexto === 'string' ? Utilities.base64EncodeWebSafe(bytesOTexto, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(bytesOTexto);
  return s.replace(/=+$/, '');
}

// Token OAuth2 (1 h) de la cuenta de servicio, guardado en caché 50 min
function pushAccessToken_() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get(PUSH_CACHE_TOKEN);
  if (guardado) return guardado;
  var c = pushCuenta_();
  var ahora = Math.floor(Date.now() / 1000);
  var cabecera = base64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var carga = base64url_(JSON.stringify({
    iss: c.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600
  }));
  var firma = base64url_(Utilities.computeRsaSha256Signature(cabecera + '.' + carga, c.private_key));
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cabecera + '.' + carga + '.' + firma }
  });
  if (res.getResponseCode() !== 200) throw new Error('OAuth FCM ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  var token = JSON.parse(res.getContentText()).access_token;
  cache.put(PUSH_CACHE_TOKEN, token, 3000);
  return token;
}

// Ayudantes propios (no dependen de notificaciones.gs): usan fetchFirestore_ si existe (cuenta de servicio)
function pushBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + pushCuenta_().project_id + '/databases/(default)/documents';
}
function pushLlave_() {
  return typeof EVAL_API_KEY_FIREBASE !== 'undefined' ? EVAL_API_KEY_FIREBASE : '';
}
function pushFetch_(url, opciones) {
  return typeof fetchFirestore_ === 'function' ? fetchFirestore_(url, opciones) : UrlFetchApp.fetch(url, opciones);
}

function pushLeerTokens_(empleadoId) {
  var url = pushBase_() + '/' + PUSH_COLECCION + '/' + encodeURIComponent(String(empleadoId)) + '?key=' + pushLlave_();
  var res = pushFetch_(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  var campos = JSON.parse(res.getContentText()).fields || {};
  if (campos.apagado && campos.apagado.booleanValue) return []; // apagado por un administrador
  var f = campos.tokens;
  return ((f && f.arrayValue && f.arrayValue.values) || []).map(function (v) { return v.stringValue; }).filter(String);
}

function pushQuitarToken_(empleadoId, token) {
  var restantes = pushLeerTokens_(empleadoId).filter(function (t) { return t !== token; });
  var url = pushBase_() + '/' + PUSH_COLECCION + '/' + encodeURIComponent(String(empleadoId)) +
    '?updateMask.fieldPaths=tokens&key=' + pushLlave_();
  pushFetch_(url, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ fields: { tokens: { arrayValue: { values: restantes.map(function (s) { return { stringValue: s }; }) } } } })
  });
}

function pushDestinatarios_(para) {
  if (para === 'rol:rrhh') {
    var ids = String(PropertiesService.getScriptProperties().getProperty('PUSH_RRHH_IDS') || '');
    return ids.split(',').map(function (s) { return s.trim(); }).filter(String);
  }
  return [String(para)];
}

/**
 * Envía el aviso como notificación emergente a todos los dispositivos registrados del destinatario.
 * n = { para, tipo, titulo, texto, enlace, clave }. Devuelve cuántos envíos fueron aceptados por FCM.
 */
function enviarPush_(n) {
  try {
    if (!pushActivo_()) return 0;
    var proyecto = pushCuenta_().project_id;
    var acceso = pushAccessToken_();
    var enviados = 0;
    pushDestinatarios_(n.para).forEach(function (id) {
      pushLeerTokens_(id).forEach(function (token) {
        var res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + proyecto + '/messages:send', {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + acceso },
          payload: JSON.stringify({ message: {
            token: token,
            data: {
              titulo: String(n.titulo || 'TCONTROL'), texto: String(n.texto || ''),
              enlace: JSON.stringify(n.enlace || {}), tag: String(n.tipo || 'aviso')
            },
            webpush: { headers: { Urgency: 'high', TTL: '86400' } }
          } })
        });
        var codigo = res.getResponseCode();
        if (codigo === 200) enviados++;
        else if (codigo === 404 || codigo === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText())) pushQuitarToken_(id, token);
        else Logger.log('Push no enviado (' + codigo + '): ' + res.getContentText().slice(0, 200));
      });
    });
    return enviados;
  } catch (e) {
    Logger.log('Push: ' + e);
    return 0;
  }
}

// Prueba manual desde el editor: pon un ID de empleado con avisos activados.
function probarPush() {
  var id = PropertiesService.getScriptProperties().getProperty('PUSH_PRUEBA_ID') || '';
  if (!id) { Logger.log('Define la propiedad PUSH_PRUEBA_ID con un ID de empleado.'); return; }
  Logger.log('Envíos aceptados: ' + enviarPush_({ para: id, tipo: 'general', titulo: 'Prueba de avisos', texto: 'Si ves esto, los avisos emergentes funcionan.', enlace: {} }));
}
