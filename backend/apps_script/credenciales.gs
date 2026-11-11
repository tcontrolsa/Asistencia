/**
 * TCONTROL · Seguridad etapa 1: contraseñas en la hoja privada CREDENCIALES
 *
 * La app cifra la contraseña en el teléfono (SHA-256) y hoy guarda ese valor en Firestore (empleados.pin), que
 * cualquiera puede leer: con él se puede entrar. Aquí ese valor se guarda en la hoja privada CREDENCIALES
 * (oculta), recifrado con PBKDF2 y sal propia de cada persona (leerCredencial_/escribirCredencial_/pbkdf2Base64_
 * de acceso_seguro.gs).
 *
 * FASE A (CRED_FUENTE = 'FIRESTORE'): Firestore sigue siendo la referencia y CREDENCIALES es su copia, que se
 *   llena con credMigrarTodo() y se refresca en cada ingreso correcto. Las acciones de abajo escriben en las dos.
 * FASE B (CRED_FUENTE = 'CREDENCIALES'): solo cuenta la hoja; Firestore deja de tener contraseñas
 *   (credBorrarPinesFirestore()). Antes: credMigrarTodo() otra vez y comprobar con credResumen().
 *
 * Acciones (POST por doPost):
 *   credEstado  { empleadoId }                         → { ok, tienePin }
 *   credCrear   { empleadoId, pin }                    → primera contraseña (solo si no tiene) + permiso de Firebase
 *   credCambiar { empleadoId, pinActual, pinNuevo }    → cambio desde el perfil
 *   credAdmin   { idToken, empleadoId, pinNuevo|'' }   → restablecer ('') o asignar; lo hace un supervisor con sesión
 *   (el ingreso es sesionFirebase en sesion_firebase.gs, que usa credComprobar_)
 * "pin" es siempre el SHA-256 en hexadecimal que calcula la app (o la contraseña en claro, que se cifra aquí).
 */

var CRED_FUENTE = 'FIRESTORE';
var CRED_ITER = 2000;
var CRED_ROLES_ADMIN = ['master', 'admin', 'supervisor'];

// Valor canónico: SHA-256 hex (si llega la contraseña en claro, se cifra igual que en la app)
function credCanonico_(clave) {
  var c = String(clave || '').trim();
  return /^[a-f0-9]{64}$/.test(c) ? c : sha256Hex_(c);
}

function credCalcular_(canonico, salB64, iter) {
  return pbkdf2Base64_(canonico, Utilities.base64Decode(salB64), iter || CRED_ITER);
}

// El cifrado PBKDF2 tarda ~1,7 s en Apps Script: tras un ingreso correcto se recuerda 6 h (caché privada del
// servidor, solo un resumen) para no repetirlo. Se borra al cambiar o restablecer la contraseña (credGuardar_).
function credMarca_(id, canonico) { return sha256Hex_('cred|' + id + '|' + canonico).slice(0, 32); }
function credRecordar_(id, canonico) { CacheService.getScriptCache().put('cred_ok_' + id, credMarca_(id, canonico), 21600); }
function credRecordado_(id, canonico) { return CacheService.getScriptCache().get('cred_ok_' + id) === credMarca_(id, canonico); }
function credOlvidar_(id) { CacheService.getScriptCache().remove('cred_ok_' + id); }

// ¿La clave enviada es la de esa persona? → { estado: 'ok'|'mal'|'sin', emp }
function credComprobar_(id, clave) {
  var emp = leerEmpleadoFirestore_(id);
  if (!emp) return { estado: 'noexiste' };
  var canonico = credCanonico_(clave);
  if (CRED_FUENTE === 'CREDENCIALES') {
    var c = leerCredencial_(id);
    if (!c || !c.hash) return { estado: 'sin', emp: emp };
    if (credRecordado_(id, canonico)) return { estado: 'ok', emp: emp };
    var bien = credCalcular_(canonico, c.sal, c.iter) === c.hash;
    if (bien) credRecordar_(id, canonico);
    return { estado: bien ? 'ok' : 'mal', emp: emp };
  }
  // FASE A: manda Firestore; si coincide, se deja al día la copia privada
  var guardado = String(emp.pin || '').trim();
  if (!guardado) return { estado: 'sin', emp: emp };
  if (guardado !== clave && guardado !== canonico && sha256Hex_(guardado) !== canonico) return { estado: 'mal', emp: emp };
  if (credRecordado_(id, canonico)) return { estado: 'ok', emp: emp };   // copia ya verificada en las últimas 6 h
  try {
    var cred = leerCredencial_(id);
    if (!cred || !cred.hash || credCalcular_(canonico, cred.sal, cred.iter) !== cred.hash) credEscribirHoja_(id, canonico);
    credRecordar_(id, canonico);
  } catch (e) { console.warn('CREDENCIALES no actualizada para ' + id + ': ' + e); }
  return { estado: 'ok', emp: emp };
}

function credEscribirHoja_(id, canonico) {
  var sal = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var salB64 = Utilities.base64Encode(sal);
  var previa = leerCredencial_(id);
  var ahora = new Date();
  escribirCredencial_(id, {
    HASH: canonico ? credCalcular_(canonico, salB64, CRED_ITER) : '', SAL: canonico ? salB64 : '', ITER: CRED_ITER,
    INTENTOS: 0, BLOQUEADO_HASTA: '', ACTIVADO_EN: (previa && previa.activadoEn) || ahora, ACTUALIZADO_EN: ahora
  });
}

// Guarda (o borra, con '') la contraseña: hoja privada y, en la FASE A, también Firestore
function credGuardar_(id, canonico) {
  credOlvidar_(id);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { credEscribirHoja_(id, canonico); } finally { lock.releaseLock(); }
  if (CRED_FUENTE === 'FIRESTORE') {
    var r = fetchFirestore_(notifBaseFirestore_() + '/empleados/' + encodeURIComponent(id) + '?updateMask.fieldPaths=pin&currentDocument.exists=true', {
      method: 'patch', contentType: 'application/json', payload: JSON.stringify({ fields: { pin: { stringValue: canonico || '' } } })
    });
    if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode());
  }
}

function credActivo_(emp) {
  return emp && !(String(emp.activo || 'SI').toUpperCase() === 'NO' || emp.activo === false);
}

// ---------------------------------------------------------------- acciones
function credEstado(p) {
  var id = String(p.empleadoId || '').trim();
  if (!id) return { ok: false, error: 'Falta el ID.' };
  var emp = leerEmpleadoFirestore_(id);
  if (!emp) return { ok: false, error: 'Colaborador no encontrado.' };
  if (!credActivo_(emp)) return { ok: false, error: 'Colaborador inactivo.' };
  if (CRED_FUENTE === 'CREDENCIALES') { var c = leerCredencial_(id); return { ok: true, tienePin: !!(c && c.hash) }; }
  return { ok: true, tienePin: !!String(emp.pin || '').trim() };
}

function credCrear(p) {
  var id = String(p.empleadoId || '').trim();
  var clave = String(p.pin || '').trim();
  if (!id || !clave) return { ok: false, error: 'Falta el ID o la contraseña.' };
  var r = credComprobar_(id, clave);
  if (r.estado === 'noexiste') return { ok: false, error: 'Colaborador no encontrado.' };
  if (!credActivo_(r.emp)) return { ok: false, error: 'Colaborador inactivo.' };
  if (r.estado !== 'sin') return { ok: false, yaTiene: true, error: 'Tu cuenta ya tiene contraseña. Ingresa con ella o usa "¿Olvidaste tu contraseña?".' };
  credGuardar_(id, credCanonico_(clave));
  if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'credCrear', 'ok', '');
  var rol = rolSesionFirebase_(id, r.emp);
  return { ok: true, customToken: firmarTokenFirebase_(id, { empleadoId: id, rol: rol, externo: String(r.emp.tipo_personal || '').toUpperCase() === 'EXTERNO' }), rol: rol };
}

function credCambiar(p) {
  var id = String(p.empleadoId || '').trim();
  var actual = String(p.pinActual || '').trim();
  var nuevo = String(p.pinNuevo || '').trim();
  if (!id || !actual || !nuevo) return { ok: false, error: 'Faltan datos.' };
  var cache = CacheService.getScriptCache();
  var k = 'cred_cambio_int_' + id;
  var intentos = parseInt(cache.get(k) || '0', 10);
  if (intentos >= 5) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };
  var r = credComprobar_(id, actual);
  if (r.estado !== 'ok') {
    cache.put(k, String(intentos + 1), 900);
    if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'credCambiar', 'rechazado', 'contraseña actual incorrecta');
    return { ok: false, error: 'La contraseña actual es incorrecta.' };
  }
  cache.remove(k);
  credGuardar_(id, credCanonico_(nuevo));
  if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'credCambiar', 'ok', '');
  return { ok: true };
}

// Restablecer o asignar desde el panel: el que lo pide debe tener sesión de Firebase y rol de supervisor o superior
function credAdmin(p) {
  var quien = credQuienLlama_(p.idToken);
  if (!quien) return { ok: false, error: 'Tu sesión de seguridad no está activa. Confirma tu contraseña en el panel y vuelve a intentarlo.' };
  if (CRED_ROLES_ADMIN.indexOf(quien.rol) === -1) return { ok: false, error: 'No tienes permiso para cambiar contraseñas.' };
  var id = String(p.empleadoId || '').trim();
  var emp = id ? leerEmpleadoFirestore_(id) : null;
  if (!emp) return { ok: false, error: 'Colaborador no encontrado.' };
  if (id === SESION_FB_MASTER && quien.uid !== SESION_FB_MASTER) return { ok: false, error: 'Solo el Admin Master puede cambiar su propia contraseña.' };
  var nuevo = String(p.pinNuevo || '').trim();
  credGuardar_(id, nuevo ? credCanonico_(nuevo) : '');
  if (typeof registrarAcceso_ === 'function') registrarAcceso_(id, 'credAdmin', 'ok', (nuevo ? 'asignada' : 'restablecida') + ' por ' + quien.uid);
  return { ok: true };
}

// uid y rol de quien llama, a partir de su sesión de Firebase (idToken verificado por Google)
function credQuienLlama_(idToken) {
  if (!idToken) return null;
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: String(idToken) })
  });
  if (res.getResponseCode() !== 200) return null;
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || !u.localId) return null;
  var emp = leerEmpleadoFirestore_(u.localId);
  if (!credActivo_(emp)) return null;
  return { uid: u.localId, rol: rolSesionFirebase_(u.localId, emp) };
}

// ---------------------------------------------------------------- editor (▶)
/** Copia a CREDENCIALES todas las contraseñas que hoy están en Firestore y vacía las que ya no existen allí
 *  (p. ej. restablecidas por el camino antiguo). Se puede repetir: deja la hoja igual a Firestore. */
function credMigrarTodo() {
  var t0 = Date.now(), n = 0, sin = 0, vaciadas = [];
  var hoja = hojaCredenciales_();
  var datos = hoja.getDataRange().getValues();
  var filaDe = {};
  for (var i = 1; i < datos.length; i++) filaDe[String(datos[i][0]).trim()] = i + 1;
  var nuevas = [];
  listarEmpleadosFirestore_().forEach(function (e) {
    var pin = String(e.pin || '').trim();
    if (!pin) {
      sin++;
      var f = filaDe[e.id];
      if (f && String(hoja.getRange(f, 2).getValue() || '')) { hoja.getRange(f, 2, 1, 2).setValues([['', '']]); vaciadas.push(e.id); credOlvidar_(e.id); }
      return;
    }
    var canonico = credCanonico_(pin);
    var sal = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + e.id + Date.now()));
    var fila = [e.id, credCalcular_(canonico, sal, CRED_ITER), sal, CRED_ITER, 0, '', new Date(), new Date()];
    if (filaDe[e.id]) hoja.getRange(filaDe[e.id], 1, 1, fila.length).setValues([fila]);
    else nuevas.push(fila);
    n++;
  });
  if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, nuevas[0].length).setValues(nuevas);
  Logger.log(n + ' contraseñas copiadas a CREDENCIALES · ' + sin + ' fichas sin contraseña' +
    (vaciadas.length ? ' · vaciadas en la hoja: ' + vaciadas.join(', ') : '') + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s');
}

/** Compara Firestore con CREDENCIALES: cuántas coinciden (antes de pasar a la FASE B debe dar 0 diferencias). */
function credResumen() {
  var dif = [], ok = 0, sinAmbos = 0;
  listarEmpleadosFirestore_().forEach(function (e) {
    var pin = String(e.pin || '').trim();
    var c = leerCredencial_(e.id);
    var tieneHoja = !!(c && c.hash);
    if (!pin && !tieneHoja) { sinAmbos++; return; }
    if (!pin || !tieneHoja || credCalcular_(credCanonico_(pin), c.sal, c.iter) !== c.hash) { dif.push(e.id); return; }
    ok++;
  });
  Logger.log('Coinciden: ' + ok + ' · sin contraseña en ninguna: ' + sinAmbos + ' · diferencias: ' + dif.length + (dif.length ? ' (' + dif.join(', ') + ')' : ''));
}

/** Mide cuánto tarda el cifrado (ideal: menos de 1 s por ingreso). */
function credMedir() {
  var t0 = Date.now();
  credCalcular_(sha256Hex_('prueba'), Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sal')), CRED_ITER);
  Logger.log('PBKDF2 con ' + CRED_ITER + ' iteraciones: ' + (Date.now() - t0) + ' ms');
}
