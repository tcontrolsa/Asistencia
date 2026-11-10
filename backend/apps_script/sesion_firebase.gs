/**
 * TCONTROL · Seguridad, etapa 1: sesión de Firebase emitida por el servidor
 *
 * La app y el panel siguen entrando como siempre (ID + contraseña). Además, con la misma contraseña ya
 * cifrada (SHA-256 del teléfono), piden aquí un permiso de Firebase (custom token) con el ID y el rol de la
 * persona y abren sesión en Firebase Auth. En esta etapa las reglas de Firestore NO cambian: si este paso
 * falla, la app funciona igual. Sirve para que, cuando todos tengan sesión, se puedan cerrar las reglas.
 *
 * Acción (solo POST, por doPost en api_completa.gs): sesionFirebase { empleadoId, pin }
 *   pin = SHA-256 de la contraseña (lo que la app ya calcula) o la contraseña en claro (respaldo).
 *   → { ok, customToken, rol } o { ok:false, error }
 * Intentos fallidos: 5 por ID y luego 15 min de espera. Cada emisión queda en la hoja ACCESOS.
 *
 * Usa: leerEmpleadoFirestore_ y sha256Hex_ (evaluacion_desempeno.gs), firmarTokenFirebase_ y
 * registrarAcceso_ (acceso_seguro.gs). Requiere en Propiedades del script FIREBASE_SA_EMAIL y FIREBASE_SA_KEY.
 *
 * Prueba desde el editor (▶): probarSesionFirebase()  (firma un permiso de prueba y lo canjea; no toca datos)
 * Avance (▶): resumenSesionesFirebase()  (cuántas personas ya abrieron sesión, según ACCESOS)
 */

var SESION_FB_MAX_INTENTOS = 5;
var SESION_FB_BLOQUEO_SEG = 15 * 60;
var SESION_FB_MASTER = '1058';

function emitirSesionFirebase(p) {
  var id = String(p.empleadoId || '').trim();
  var clave = String(p.pin || '').trim();
  if (!id || !clave) return { ok: false, error: 'Ingresa tu ID y tu contraseña.' };

  var cache = CacheService.getScriptCache();
  var claveIntentos = 'sfb_int_' + id;
  var intentos = parseInt(cache.get(claveIntentos) || '0', 10);
  if (intentos >= SESION_FB_MAX_INTENTOS) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };

  var emp = leerEmpleadoFirestore_(id);
  if (!emp) return { ok: false, error: 'Colaborador no encontrado.' };
  if (String(emp.activo || 'SI').toUpperCase() === 'NO' || emp.activo === false) return { ok: false, error: 'Colaborador inactivo.' };
  var guardado = String(emp.pin || '').trim();
  if (!guardado || (guardado !== clave && guardado !== sha256Hex_(clave))) {
    cache.put(claveIntentos, String(intentos + 1), SESION_FB_BLOQUEO_SEG);
    if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'sesionFirebase', 'rechazado', 'contraseña incorrecta (' + (intentos + 1) + ')');
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  cache.remove(claveIntentos);

  var rol = rolSesionFirebase_(id, emp);
  var claims = { empleadoId: id, rol: rol, externo: String(emp.tipo_personal || '').toUpperCase() === 'EXTERNO' };
  var token = firmarTokenFirebase_(id, claims);
  if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'sesionFirebase', 'ok', rol);
  return { ok: true, customToken: token, rol: rol };
}

// master (1058) · admin (Supervisor Admin) · supervisor · colaborador
function rolSesionFirebase_(id, emp) {
  if (id === SESION_FB_MASTER) return 'master';
  var sup = String(emp.supervisor || emp.rol || '').trim().toUpperCase();
  if (sup.indexOf('ADMIN') !== -1) return 'admin';
  if (sup === 'SI' || sup === 'SUPERVISOR') return 'supervisor';
  return 'colaborador';
}

// ---------------------------------------------------------------- editor (▶)
function probarSesionFirebase() {
  var token = firmarTokenFirebase_('prueba_sesion', { empleadoId: 'prueba_sesion', rol: 'colaborador', externo: false });
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + FIREBASE_WEB_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ token: token, returnSecureToken: true })
  });
  Logger.log('Firebase acepta el permiso firmado: ' + (res.getResponseCode() === 200 ? 'SÍ' : 'NO → ' + res.getContentText().slice(0, 300)));
}

function resumenSesionesFirebase() {
  var hoja = SpreadsheetApp.getActive().getSheetByName('ACCESOS');
  if (!hoja || hoja.getLastRow() < 2) { Logger.log('Todavía no hay sesiones registradas.'); return; }
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues();
  var personas = {}, rechazos = 0;
  filas.forEach(function (f) {
    if (f[2] !== 'sesionFirebase') return;
    if (f[3] === 'ok') personas[String(f[1])] = f[4]; else rechazos++;
  });
  var porRol = {};
  Object.keys(personas).forEach(function (id) { porRol[personas[id]] = (porRol[personas[id]] || 0) + 1; });
  Logger.log(Object.keys(personas).length + ' personas con sesión de Firebase · por rol: ' + JSON.stringify(porRol) + ' · rechazos: ' + rechazos);
}
