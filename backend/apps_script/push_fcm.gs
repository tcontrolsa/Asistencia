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

// Tipos de aviso apagados por un administrador (Firestore configuracion/push {tipos_apagados: [...]}), caché 60 s
function pushTiposApagados_() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('push_tipos_apagados');
  if (guardado !== null) return JSON.parse(guardado);
  var lista = [];
  try {
    var res = pushFetch_(pushBase_() + '/configuracion/push?key=' + pushLlave_(), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var f = (JSON.parse(res.getContentText()).fields || {}).tipos_apagados;
      lista = ((f && f.arrayValue && f.arrayValue.values) || []).map(function (v) { return v.stringValue; }).filter(String);
    }
  } catch (e) { Logger.log('Push: no se pudo leer configuracion/push: ' + e); }
  cache.put('push_tipos_apagados', JSON.stringify(lista), 60);
  return lista;
}

// Convierte un valor de la API REST de Firestore a un valor simple
function pushDecodificar_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue.values) || []).map(pushDecodificar_);
  if ('mapValue' in v) {
    var o = {}, c = v.mapValue.fields || {};
    Object.keys(c).forEach(function (k) { o[k] = pushDecodificar_(c[k]); });
    return o;
  }
  return null;
}

/**
 * Revisa los avisos de la campana creados en los últimos 15 minutos y envía el push de los que aún no salieron.
 * Cubre TODOS los orígenes (Apps Script y la app: permisos, campo...). Se omiten los avisos marcados `sinPush`
 * (recordatorios diarios), los ya leídos y los de tipos apagados. Marca `pushEnviado` en cada aviso enviado.
 * Instalar con instalarPushPendientes() (se ejecuta cada minuto).
 */
function enviarPushPendientes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0; // espera un poco: si otra llamada está enviando, ya procesará este aviso
  try {
    if (!pushActivo_()) return 0;
    var desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    var res = pushFetch_(pushBase_() + ':runQuery?key=' + pushLlave_(), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'notificaciones' }],
        where: { fieldFilter: { field: { fieldPath: 'creada' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: desde } } },
        orderBy: [{ field: { fieldPath: 'creada' }, direction: 'ASCENDING' }],
        limit: 200
      } })
    });
    if (res.getResponseCode() !== 200) { Logger.log('Push pendientes (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200)); return 0; }
    var apagados = pushTiposApagados_();
    var enviados = 0;
    JSON.parse(res.getContentText()).forEach(function (fila) {
      if (!fila.document) return;
      var d = pushDecodificar_({ mapValue: { fields: fila.document.fields || {} } });
      if (d.pushEnviado || d.sinPush) return;
      if ((d.leidaPor || []).indexOf(String(d.para)) >= 0) return;
      var url = pushBase_().replace(/\/documents$/, '') + '/' + fila.document.name.replace(/^.*\/databases\/\(default\)\//, '') +
        '?updateMask.fieldPaths=pushEnviado&key=' + pushLlave_();
      if (apagados.indexOf(String(d.tipo)) < 0) enviados += enviarPush_({ para: d.para, tipo: d.tipo, titulo: d.titulo, texto: d.texto, enlace: d.enlace, clave: d.clave });
      pushFetch_(url, { method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ fields: { pushEnviado: { booleanValue: true } } }) });
    });
    return enviados;
  } catch (e) {
    Logger.log('Push pendientes: ' + e);
    return 0;
  } finally {
    lock.releaseLock();
  }
}

// Acción 'empujarPush' (api_completa.gs): la app avisa que acaba de crear un aviso y se envía al instante.
// Es inofensiva e idempotente: solo procesa avisos pendientes de los últimos 15 minutos.
function empujarPush() {
  return { ok: true, enviados: enviarPushPendientes() };
}

// Ejecutar UNA vez desde el editor: crea el disparador que envía los push cada minuto
function instalarPushPendientes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'enviarPushPendientes') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarPushPendientes').timeBased().everyMinutes(1).create();
  Logger.log('Disparador de push instalado (cada minuto).');
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
