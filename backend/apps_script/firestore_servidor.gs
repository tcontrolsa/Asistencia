/**
 * TCONTROL · Seguridad etapa 1: Firestore desde el servidor con la CUENTA DE SERVICIO
 *
 * Hasta ahora los scripts leían y escribían Firestore con la llave pública (?key=…), que solo funciona porque las
 * reglas están abiertas. fetchFirestore_(url, opciones) hace la misma llamada con un token OAuth de la cuenta de
 * servicio (FIREBASE_SA_EMAIL / FIREBASE_SA_KEY): ese acceso no depende de las reglas, así que seguirá
 * funcionando cuando se cierren. Mientras tanto, si el token fallara, se reintenta con la llave pública para no
 * cortar nada (queda el aviso en el registro de ejecución).
 *
 * Acción para el servidor de la oficina (doPost): leerColeccionServidor { secreto: TUNEL_SECRET, coleccion }
 * — solo 'empleados', para la sincronización con Postgres (migrar_sheets_a_postgres.py).
 *
 * Prueba desde el editor (▶): probarFirestoreServidor()
 */

var FS_SCOPE = 'https://www.googleapis.com/auth/datastore';
var FS_COLECCIONES_SERVIDOR = ['empleados'];

// Token OAuth de la cuenta de servicio (JWT → oauth2), guardado 50 min
function tokenFirestoreServidor_() {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('fs_oauth_sa');
  if (guardado) return guardado;
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FIREBASE_SA_EMAIL');
  var clave = String(props.getProperty('FIREBASE_SA_KEY') || '').replace(/\\n/g, '\n');
  if (!email || !clave) throw new Error('Falta FIREBASE_SA_EMAIL / FIREBASE_SA_KEY');
  var ahora = Math.floor(Date.now() / 1000);
  var b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = b64(JSON.stringify({ iss: email, scope: FS_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  var jwt = header + '.' + payload + '.' + b64(Utilities.computeRsaSha256Signature(header + '.' + payload, clave));
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  if (res.getResponseCode() !== 200) throw new Error('OAuth de la cuenta de servicio: ' + res.getContentText().slice(0, 200));
  var token = JSON.parse(res.getContentText()).access_token;
  cache.put('fs_oauth_sa', token, 50 * 60);
  return token;
}

// Igual que UrlFetchApp.fetch para URLs de Firestore, pero con la cuenta de servicio (quita ?key=…)
function fetchFirestore_(url, opciones) {
  var op = {};
  Object.keys(opciones || {}).forEach(function (k) { op[k] = opciones[k]; });
  if (op.muteHttpExceptions === undefined) op.muteHttpExceptions = true;
  var limpia = String(url).replace(/([?&])key=[^&]*(&|$)/, function (m, a, b) { return b ? a : ''; });
  try {
    var conToken = {};
    Object.keys(op).forEach(function (k) { conToken[k] = op[k]; });
    var h = {};
    Object.keys(op.headers || {}).forEach(function (k) { h[k] = op.headers[k]; });
    h.Authorization = 'Bearer ' + tokenFirestoreServidor_();
    conToken.headers = h;
    var res = UrlFetchApp.fetch(limpia, conToken);
    if (res.getResponseCode() !== 401 && res.getResponseCode() !== 403) return res;
    console.warn('Firestore con cuenta de servicio respondió ' + res.getResponseCode() + ': se reintenta con la llave pública');
    CacheService.getScriptCache().remove('fs_oauth_sa');
  } catch (e) {
    console.warn('Firestore con cuenta de servicio falló (' + (e.message || e) + '): se reintenta con la llave pública');
  }
  return UrlFetchApp.fetch(url, op);   // respaldo mientras las reglas sigan abiertas (etapa 1)
}

// Para el servidor de la oficina: lee una colección permitida con la cuenta de servicio
function leerColeccionServidor(p) {
  var secreto = PropertiesService.getScriptProperties().getProperty('TUNEL_SECRET');
  if (!secreto || String(p.secreto || '') !== secreto) return { ok: false, error: 'No autorizado' };
  var col = String(p.coleccion || '');
  if (FS_COLECCIONES_SERVIDOR.indexOf(col) === -1) return { ok: false, error: 'Colección no permitida' };
  var docs = [], token = '';
  do {
    var res = fetchFirestore_(notifBaseFirestore_() + '/' + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (res.getResponseCode() !== 200) return { ok: false, error: 'Firestore ' + res.getResponseCode() };
    var d = JSON.parse(res.getContentText());
    (d.documents || []).forEach(function (x) { docs.push({ name: x.name, fields: x.fields || {} }); });
    token = d.nextPageToken || '';
  } while (token);
  return { ok: true, documents: docs };
}

// ---------------------------------------------------------------- editor (▶)
function probarFirestoreServidor() {
  try {
    tokenFirestoreServidor_();
    var res = UrlFetchApp.fetch(notifBaseFirestore_() + '/configuracion/historico', {
      muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tokenFirestoreServidor_() }
    });
    Logger.log('Lectura con la cuenta de servicio (sin llave pública): ' + (res.getResponseCode() === 200 ? 'SÍ' : 'NO → ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200)));
  } catch (e) {
    Logger.log('No se pudo obtener el token de la cuenta de servicio: ' + (e.message || e));
  }
}
