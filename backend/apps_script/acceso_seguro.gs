/**
 * TCONTROL · Acceso seguro (seguridad fase 1, etapa 1)
 *
 * Inicio de sesión verificado en el servidor:
 *   - Los PIN viven en la pestaña privada CREDENCIALES (PBKDF2-HMAC-SHA256 con sal), no en Firestore.
 *   - Activación / cambio de PIN con un código de 6 dígitos enviado por WhatsApp al teléfono
 *     de la hoja EMPLEADOS (privada), o con un código manual que genera RR.HH. desde el editor.
 *   - Si el PIN es correcto, se firma una credencial de Firebase (custom token) con el ID y el rol;
 *     la PWA inicia sesión en Firebase con ella y las reglas de Firestore deciden por rol.
 *
 * Las acciones llegan SOLO por POST (doPost → procesarAccesoSeguro): el PIN nunca viaja en la URL.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   FIREBASE_SA_EMAIL   client_email de la cuenta de servicio de Firebase
 *   FIREBASE_SA_KEY     private_key de esa cuenta (el texto completo, con BEGIN/END PRIVATE KEY)
 *   TUNEL_SECRET        secreto compartido con el contenedor tunel-whatsapp
 *   TUNEL_URL_WHATSAPP  (la escribe el contenedor tunel-whatsapp con registrarUrlTunel)
 *
 * Funciones para ejecutar desde el editor (▶):
 *   prepararAccesoSeguro()     crea las pestañas CREDENCIALES y ACCESOS (ocultas)
 *   probarAccesoSeguro()       revisa la configuración y mide el costo del PBKDF2
 *   generarCodigoManual()      código de activación para alguien sin WhatsApp (editar el ID)
 */

var HOJA_CREDENCIALES = 'CREDENCIALES';
var HOJA_ACCESOS = 'ACCESOS';
var PBKDF2_ITER = 4000;
var MAX_INTENTOS_PIN = 5;
var BLOQUEO_MINUTOS = 15;
var CODIGO_VALIDEZ_SEG = 10 * 60;        // código por WhatsApp
var CODIGO_MANUAL_VALIDEZ_SEG = 6 * 3600; // código manual de RR.HH. (máximo de CacheService)
var MAX_CODIGOS_POR_HORA = 3;
var MAX_INTENTOS_CODIGO = 5;
var FIREBASE_WEB_API_KEY = 'AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4'; // pública (la usa la PWA)
var COLS_CRED = ['ID', 'HASH', 'SAL', 'ITER', 'INTENTOS', 'BLOQUEADO_HASTA', 'ACTIVADO_EN', 'ACTUALIZADO_EN'];

// iniciarSesion, solicitarCodigo y crearPin (borrador del ingreso con PIN) quedan fuera: ninguna pantalla los usa y daban
// sesión con el rol de la hoja EMPLEADOS. El ingreso real es sesion_firebase.gs.
var ACCIONES_ACCESO = ['registrarUrlTunel', 'recuperarCodigo', 'recuperarPassword'];

function procesarAccesoSeguro(p) {
  try {
    switch (p.accion) {
      case 'registrarUrlTunel': return registrarUrlTunel_(p);
      case 'recuperarCodigo': return recuperarCodigo_(p);
      case 'recuperarPassword': return recuperarPassword_(p);
    }
    return { ok: false, error: 'Acción no reconocida' };
  } catch (e) {
    console.error('Acceso seguro:', e);
    return { ok: false, error: 'Error del servidor: ' + (e.message || e) };
  }
}

// ---------------------------------------------------------------- acciones

function iniciarSesionSeguro_(p) {
  var id = String(p.empleadoId || '').trim();
  var pin = String(p.pin || '').trim();
  var GENERICO = { ok: false, error: 'ID o PIN incorrecto' };
  if (!id || !pin) return GENERICO;

  var emp = buscarEmpleadoAcceso_(id);
  if (!emp || !emp.activo) { registrarAcceso_(id, 'iniciarSesion', 'rechazado', 'ID inexistente o inactivo'); return GENERICO; }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cred = leerCredencial_(id);
    if (!cred || !cred.hash) {
      return { ok: false, requiereActivacion: true, error: 'Tu cuenta necesita activarse: te enviaremos un código por WhatsApp.' };
    }
    var ahora = Date.now();
    if (cred.bloqueadoHasta && cred.bloqueadoHasta > ahora) {
      var min = Math.ceil((cred.bloqueadoHasta - ahora) / 60000);
      registrarAcceso_(id, 'iniciarSesion', 'bloqueado', min + ' min');
      return { ok: false, bloqueado: true, error: 'Demasiados intentos. Intenta de nuevo en ' + min + ' min o pide un código para cambiar el PIN.' };
    }
    if (pbkdf2Base64_(pin, Utilities.base64Decode(cred.sal), cred.iter) !== cred.hash) {
      var intentos = (cred.intentos || 0) + 1;
      var bloqueo = intentos >= MAX_INTENTOS_PIN ? ahora + BLOQUEO_MINUTOS * 60000 : null;
      escribirCredencial_(id, { INTENTOS: bloqueo ? 0 : intentos, BLOQUEADO_HASTA: bloqueo ? new Date(bloqueo) : '' });
      registrarAcceso_(id, 'iniciarSesion', 'rechazado', 'PIN incorrecto (' + intentos + ')');
      return bloqueo
        ? { ok: false, bloqueado: true, error: 'Demasiados intentos. Intenta de nuevo en ' + BLOQUEO_MINUTOS + ' min.' }
        : GENERICO;
    }
    if (cred.intentos || cred.bloqueadoHasta) escribirCredencial_(id, { INTENTOS: 0, BLOQUEADO_HASTA: '' });
  } finally {
    lock.releaseLock();
  }
  registrarAcceso_(id, 'iniciarSesion', 'ok', emp.rol);
  return respuestaSesion_(emp);
}

function solicitarCodigoActivacion_(p) {
  var id = String(p.empleadoId || '').trim();
  var emp = id ? buscarEmpleadoAcceso_(id) : null;
  if (!emp || !emp.activo) return { ok: false, error: 'No encontramos un colaborador activo con ese ID.' };
  var telefono = normalizarTelefonoEc_(emp.telefono);
  if (!telefono) {
    registrarAcceso_(id, 'solicitarCodigo', 'rechazado', 'sin teléfono');
    return { ok: false, error: 'No hay un teléfono registrado para tu ID. Pide a RR.HH. un código de activación.' };
  }

  var cache = CacheService.getScriptCache();
  var claveConteo = 'otp_n_' + id;
  var enviados = Number(cache.get(claveConteo) || 0);
  if (enviados >= MAX_CODIGOS_POR_HORA) {
    return { ok: false, error: 'Ya se enviaron ' + MAX_CODIGOS_POR_HORA + ' códigos en la última hora. Espera o pide uno a RR.HH.' };
  }

  var codigo = generarCodigo6_();
  var mensaje = '🔐 *TCONTROL Asistencia*\n\nTu código para activar o cambiar tu PIN es: *' + codigo + '*\n\n' +
    'Vence en 10 minutos. No lo compartas con nadie: TCONTROL nunca te lo pedirá por teléfono ni por mensaje.';
  var envio = enviarWhatsAppAcceso_(telefono, mensaje);
  if (!envio.ok) {
    registrarAcceso_(id, 'solicitarCodigo', 'error', envio.error);
    return { ok: false, error: 'No se pudo enviar el código por WhatsApp. Pide a RR.HH. un código de activación.' };
  }
  guardarCodigo_(id, codigo, CODIGO_VALIDEZ_SEG);
  cache.put(claveConteo, String(enviados + 1), 3600);
  registrarAcceso_(id, 'solicitarCodigo', 'ok', 'WhatsApp ' + mascaraTelefono_(telefono));
  return { ok: true, telefono: mascaraTelefono_(telefono), vence_min: CODIGO_VALIDEZ_SEG / 60 };
}

function crearPinSeguro_(p) {
  var id = String(p.empleadoId || '').trim();
  var codigo = String(p.codigo || '').trim();
  var pinNuevo = String(p.pinNuevo || '').trim();
  var emp = id ? buscarEmpleadoAcceso_(id) : null;
  if (!emp || !emp.activo) return { ok: false, error: 'No encontramos un colaborador activo con ese ID.' };

  var problema = validarPin_(pinNuevo, emp.rol);
  if (problema) return { ok: false, error: problema };

  var verificacion = verificarCodigo_(id, codigo);
  if (!verificacion.ok) {
    registrarAcceso_(id, 'crearPin', 'rechazado', verificacion.error);
    return verificacion;
  }

  var sal = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var previa = leerCredencial_(id);
    var ahora = new Date();
    escribirCredencial_(id, {
      HASH: pbkdf2Base64_(pinNuevo, sal, PBKDF2_ITER),
      SAL: Utilities.base64Encode(sal),
      ITER: PBKDF2_ITER,
      INTENTOS: 0,
      BLOQUEADO_HASTA: '',
      ACTIVADO_EN: (previa && previa.activadoEn) || ahora,
      ACTUALIZADO_EN: ahora
    });
  } finally {
    lock.releaseLock();
  }
  registrarAcceso_(id, 'crearPin', 'ok', verificacion.manual ? 'código manual' : 'código WhatsApp');
  return respuestaSesion_(emp);
}

// ---------------------------------------------------------------- recuperar contraseña (app actual)
// La contraseña de la app vive hoy en Firestore (empleados.pin, SHA-256 calculado en el teléfono).
// Para recuperarla: código de 6 dígitos por WhatsApp al teléfono de la hoja EMPLEADOS (privada, no
// el de Firestore, que cualquiera podría cambiar). El código se guarda solo como hash, vence en 10 min,
// admite 5 intentos y 3 envíos por hora. Con el código válido se guarda el hash de la nueva
// contraseña (la contraseña en claro nunca llega al servidor) y se avisa del cambio por WhatsApp.
var REC_PREFIJO = 'rec_';

function recuperarCodigo_(p) {
  var id = String(p.empleadoId || '').trim();
  var emp = id ? buscarEmpleadoAcceso_(id) : null;
  if (!emp || !emp.activo) return { ok: false, error: 'No encontramos un colaborador activo con ese ID.' };
  var telefono = normalizarTelefonoEc_(emp.telefono);
  if (!telefono) {
    registrarAcceso_(id, 'recuperarCodigo', 'rechazado', 'sin teléfono en EMPLEADOS');
    return { ok: false, sinTelefono: true, error: 'No tenemos un WhatsApp registrado para tu ID. Pide a RR.HH. o a tu supervisor que te asigne una clave temporal.' };
  }
  var cache = CacheService.getScriptCache();
  var claveConteo = REC_PREFIJO + 'n_' + id;
  var enviados = Number(cache.get(claveConteo) || 0);
  if (enviados >= MAX_CODIGOS_POR_HORA) {
    registrarAcceso_(id, 'recuperarCodigo', 'rechazado', 'límite por hora');
    return { ok: false, error: 'Ya pediste ' + MAX_CODIGOS_POR_HORA + ' códigos en la última hora. Espera un momento o pide ayuda a RR.HH.' };
  }
  var codigo = generarCodigo6_();
  var mensaje = '🔐 *TCONTROL Asistencia*\n\nTu código para recuperar tu contraseña es: *' + codigo + '*\n\n' +
    'Vence en 10 minutos. No lo compartas con nadie: TCONTROL nunca te lo pedirá.\n' +
    'Si no lo pediste tú, ignora este mensaje y avisa a RR.HH.';
  var envio = enviarWhatsAppAcceso_(telefono, mensaje);
  if (!envio.ok) {
    registrarAcceso_(id, 'recuperarCodigo', 'error', envio.error);
    return { ok: false, error: 'No se pudo enviar el código por WhatsApp en este momento. Intenta más tarde o pide ayuda a RR.HH.' };
  }
  guardarCodigo_(REC_PREFIJO + id, codigo, CODIGO_VALIDEZ_SEG);
  cache.put(claveConteo, String(enviados + 1), 3600);
  registrarAcceso_(id, 'recuperarCodigo', 'ok', 'WhatsApp ' + mascaraTelefono_(telefono));
  return { ok: true, telefono: mascaraTelefono_(telefono), vence_min: CODIGO_VALIDEZ_SEG / 60 };
}

function recuperarPassword_(p) {
  var id = String(p.empleadoId || '').trim();
  var codigo = String(p.codigo || '').trim();
  var hashNuevo = String(p.hashNuevo || '').trim().toLowerCase();
  var emp = id ? buscarEmpleadoAcceso_(id) : null;
  if (!emp || !emp.activo) return { ok: false, error: 'No encontramos un colaborador activo con ese ID.' };
  if (!/^[a-f0-9]{64}$/.test(hashNuevo)) return { ok: false, error: 'Contraseña nueva no válida.' };

  var verificacion = verificarCodigo_(REC_PREFIJO + id, codigo);
  if (!verificacion.ok) {
    registrarAcceso_(id, 'recuperarPassword', 'rechazado', verificacion.error);
    return verificacion;
  }
  // Hoja privada CREDENCIALES y (en la fase A) Firestore: credGuardar_ de credenciales.gs
  try {
    credGuardar_(id, hashNuevo);
  } catch (eGuardar) {
    registrarAcceso_(id, 'recuperarPassword', 'error', String(eGuardar.message || eGuardar));
    return { ok: false, error: 'No se pudo guardar la nueva contraseña. Intenta de nuevo.' };
  }
  registrarAcceso_(id, 'recuperarPassword', 'ok', 'contraseña restablecida');
  var telefono = normalizarTelefonoEc_(emp.telefono);
  if (telefono) {
    var cuando = Utilities.formatDate(new Date(), 'America/Guayaquil', "dd/MM/yyyy 'a las' HH:mm");
    enviarWhatsAppAcceso_(telefono, '🔐 *TCONTROL Asistencia*\n\nTu contraseña se cambió el ' + cuando + '.\n' +
      'Si no fuiste tú, comunícate de inmediato con RR.HH.');
  }
  return { ok: true };
}

// El contenedor tunel-whatsapp informa su URL; Apps Script la guarda en sus propiedades privadas
// (no se toma de Firestore, que hoy cualquiera puede modificar).
function registrarUrlTunel_(p) {
  var props = PropertiesService.getScriptProperties();
  var secreto = props.getProperty('TUNEL_SECRET');
  if (!secreto || String(p.secreto || '') !== secreto) return { ok: false, error: 'No autorizado' };
  var nombre = String(p.nombre || '').toUpperCase();
  var url = String(p.url || '').trim();
  if (['WHATSAPP', 'HISTORICO'].indexOf(nombre) === -1) return { ok: false, error: 'Nombre de túnel no válido' };
  if (url && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return { ok: false, error: 'URL no válida' };
  props.setProperty('TUNEL_URL_' + nombre, url);
  // Seguridad etapa 1: la URL que lee la app (Firestore) la escribe Apps Script con la cuenta de servicio, para que
  // los túneles no necesiten la llave pública cuando se cierren las reglas de 'configuracion'
  var destino = { WHATSAPP: ['configuracion/whatsapp', 'servidorUrl', 'tunel_actualizado'],
                  HISTORICO: ['configuracion/historico', 'url', 'actualizado'] }[nombre];
  var firestore = 'sin cambios';
  if (destino && typeof fetchFirestore_ === 'function') {
    var campos = {};
    campos[destino[1]] = { stringValue: url };
    campos[destino[2]] = { timestampValue: new Date().toISOString() };
    var r = fetchFirestore_(notifBaseFirestore_() + '/' + destino[0] + '?updateMask.fieldPaths=' + destino[1] +
      '&updateMask.fieldPaths=' + destino[2], { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ fields: campos }) });
    firestore = r.getResponseCode() === 200 ? 'ok' : 'error ' + r.getResponseCode();
  }
  return { ok: true, firestore: firestore };
}

// ---------------------------------------------------------------- sesión

function respuestaSesion_(emp) {
  var claims = { rol: emp.rol, empleadoId: emp.id };
  return {
    ok: true,
    customToken: firmarTokenFirebase_(emp.id, claims),
    rol: emp.rol,
    empleado: { id: emp.id, nombre: emp.nombre, area: emp.area, cargo: emp.cargo }
  };
}

// Custom token de Firebase (JWT RS256 firmado con la cuenta de servicio). Vigencia 1 h:
// solo sirve para iniciar sesión; después Firebase mantiene la sesión abierta.
function firmarTokenFirebase_(uid, claims) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FIREBASE_SA_EMAIL');
  var clave = props.getProperty('FIREBASE_SA_KEY');
  if (!email || !clave) throw new Error('Falta configurar FIREBASE_SA_EMAIL / FIREBASE_SA_KEY');
  clave = clave.replace(/\\n/g, '\n');
  var ahora = Math.floor(Date.now() / 1000);
  var header = b64urlAcceso_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = b64urlAcceso_(JSON.stringify({
    iss: email, sub: email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: ahora, exp: ahora + 3600,
    uid: String(uid), claims: claims
  }));
  var firma = b64urlAcceso_(Utilities.computeRsaSha256Signature(header + '.' + payload, clave));
  return header + '.' + payload + '.' + firma;
}

// Valida el token de sesión de Firebase que enviará la PWA (etapas 2 y 5).
// Devuelve { uid, rol, empleado } o null. Cachea 10 min para no consultar a Google en cada llamada.
function usuarioDesdeIdToken(idToken) {
  if (!idToken) return null;
  var cache = CacheService.getScriptCache();
  var clave = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(idToken))).slice(0, 40);
  var enCache = cache.get(clave);
  if (enCache) return JSON.parse(enCache);
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: idToken })
  });
  if (res.getResponseCode() !== 200) return null;
  var usuarios = (JSON.parse(res.getContentText()).users) || [];
  if (!usuarios.length) return null;
  var emp = buscarEmpleadoAcceso_(usuarios[0].localId);
  if (!emp || !emp.activo) return null;
  var usuario = { uid: emp.id, rol: emp.rol, empleado: { id: emp.id, nombre: emp.nombre } };
  cache.put(clave, JSON.stringify(usuario), 600);
  return usuario;
}

// ---------------------------------------------------------------- PIN y códigos

function pbkdf2Base64_(pin, salBytes, iteraciones) {
  var clave = Utilities.newBlob(String(pin)).getBytes();
  var u = Utilities.computeHmacSha256Signature(salBytes.concat([0, 0, 0, 1]), clave);
  var t = u.slice();
  for (var i = 1; i < iteraciones; i++) {
    u = Utilities.computeHmacSha256Signature(u, clave);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return Utilities.base64Encode(t);
}

function validarPin_(pin, rol) {
  var minimo = (rol === 'supervisor' || rol === 'admin') ? 8 : 6;
  if (!/^\d+$/.test(pin)) return 'El PIN debe tener solo números.';
  if (pin.length < minimo) return 'El PIN debe tener al menos ' + minimo + ' dígitos.';
  if (/^(\d)\1+$/.test(pin)) return 'El PIN no puede repetir el mismo número.';
  if ('01234567890'.indexOf(pin) !== -1 || '09876543210'.indexOf(pin) !== -1) return 'El PIN no puede ser una secuencia (123456…).';
  return null;
}

function generarCodigo6_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var n = 0;
  for (var i = 0; i < 4; i++) n = (n * 256 + (bytes[i] & 255)) % 1000000;
  return ('000000' + n).slice(-6);
}

function hashCodigo_(id, codigo) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + '|' + codigo));
}

function guardarCodigo_(id, codigo, segundos, manual) {
  CacheService.getScriptCache().put('otp_' + id,
    JSON.stringify({ h: hashCodigo_(id, codigo), intentos: 0, manual: !!manual }), segundos);
}

function verificarCodigo_(id, codigo) {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('otp_' + id);
  if (!guardado) return { ok: false, error: 'El código venció o no existe. Pide uno nuevo.' };
  var dato = JSON.parse(guardado);
  if (!/^\d{6}$/.test(codigo) || hashCodigo_(id, codigo) !== dato.h) {
    dato.intentos++;
    if (dato.intentos >= MAX_INTENTOS_CODIGO) {
      cache.remove('otp_' + id);
      return { ok: false, error: 'Código incorrecto demasiadas veces. Pide uno nuevo.' };
    }
    cache.put('otp_' + id, JSON.stringify(dato), dato.manual ? CODIGO_MANUAL_VALIDEZ_SEG : CODIGO_VALIDEZ_SEG);
    return { ok: false, error: 'Código incorrecto.' };
  }
  cache.remove('otp_' + id);
  return { ok: true, manual: dato.manual };
}

// ---------------------------------------------------------------- datos

// Datos del colaborador desde la hoja EMPLEADOS (privada): el rol y el teléfono no se toman de Firestore.
function buscarEmpleadoAcceso_(id) {
  id = String(id || '').trim();
  if (!id) return null;
  var cache = CacheService.getScriptCache();
  var enCache = cache.get('emp_acc_' + id);
  if (enCache) return JSON.parse(enCache);
  var datos = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS).getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    if (String(fila[COLUMNAS_EMPLEADOS.ID]).trim() !== id) continue;
    var sup = String(fila[COLUMNAS_EMPLEADOS.SUPERVISOR] || '').trim().toUpperCase();
    var rol = sup.indexOf('ADMIN') !== -1 ? 'admin'
      : (sup === 'SI' || sup.indexOf('SUPERVISOR') !== -1 ? 'supervisor' : 'colaborador');
    var emp = {
      id: id,
      nombre: String(fila[COLUMNAS_EMPLEADOS.NOMBRE] || ''),
      area: String(fila[COLUMNAS_EMPLEADOS.AREA] || ''),
      cargo: String(fila[COLUMNAS_EMPLEADOS.CARGO] || ''),
      activo: String(fila[COLUMNAS_EMPLEADOS.ACTIVO] || '').trim().toUpperCase() === 'SI',
      telefono: String(fila[COLUMNAS_EMPLEADOS.TELEFONO] || ''),
      rol: rol
    };
    cache.put('emp_acc_' + id, JSON.stringify(emp), 300);
    return emp;
  }
  return null;
}

function hojaCredenciales_() {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(HOJA_CREDENCIALES);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_CREDENCIALES);
    hoja.appendRow(COLS_CRED);
    hoja.setFrozenRows(1);
    hoja.hideSheet();
  }
  return hoja;
}

function leerCredencial_(id) {
  var datos = hojaCredenciales_().getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === id) {
      var f = datos[i];
      return {
        fila: i + 1, hash: String(f[1] || ''), sal: String(f[2] || ''), iter: Number(f[3]) || PBKDF2_ITER,
        intentos: Number(f[4]) || 0, bloqueadoHasta: f[5] ? new Date(f[5]).getTime() : null, activadoEn: f[6] || null
      };
    }
  }
  return null;
}

function escribirCredencial_(id, cambios) {
  var hoja = hojaCredenciales_();
  var cred = leerCredencial_(id);
  var fila = cred ? cred.fila : hoja.getLastRow() + 1;
  if (!cred) hoja.getRange(fila, 1).setValue(id);
  Object.keys(cambios).forEach(function (col) {
    var idx = COLS_CRED.indexOf(col);
    if (idx > 0) hoja.getRange(fila, idx + 1).setValue(cambios[col]);
  });
}

function registrarAcceso_(id, accion, resultado, detalle) {
  try {
    var ss = SpreadsheetApp.getActive();
    var hoja = ss.getSheetByName(HOJA_ACCESOS);
    if (!hoja) {
      hoja = ss.insertSheet(HOJA_ACCESOS);
      hoja.appendRow(['FECHA', 'ID', 'ACCION', 'RESULTADO', 'DETALLE']);
      hoja.setFrozenRows(1);
      hoja.hideSheet();
    }
    hoja.appendRow([new Date(), id, accion, resultado, detalle || '']);
  } catch (e) { console.warn('No se pudo registrar el acceso:', e); }
}

// ---------------------------------------------------------------- WhatsApp

function normalizarTelefonoEc_(raw) {
  var num = String(raw || '').replace(/\D/g, '');
  if (num.indexOf('09') === 0 && num.length === 10) num = '593' + num.slice(1);
  else if (num.indexOf('9') === 0 && num.length === 9) num = '593' + num;
  return /^593\d{9}$/.test(num) ? num : null;
}

function mascaraTelefono_(num) {
  return '0' + num.slice(3, 5) + '*****' + num.slice(-3);
}

// Envía por el contenedor tunel-whatsapp (pone la clave de OpenWA y filtra rutas).
// La URL sale de las propiedades del script, nunca de Firestore.
function enviarWhatsAppAcceso_(numero, texto) {
  var base = PropertiesService.getScriptProperties().getProperty('TUNEL_URL_WHATSAPP');
  if (!base) return { ok: false, error: 'El túnel de WhatsApp no registró su URL (TUNEL_URL_WHATSAPP)' };
  try {
    var ses = JSON.parse(UrlFetchApp.fetch(base + '/api/sessions', { muteHttpExceptions: true }).getContentText());
    var lista = Array.isArray(ses) ? ses : (ses.data || []);
    var sesion = lista.filter(function (s) { return ['ready', 'WORKING', 'RUNNING', 'PAIRED'].indexOf(s.status) !== -1; })[0] || lista[0];
    if (!sesion) return { ok: false, error: 'Sin sesión de WhatsApp activa' };

    var chatId = numero + '@c.us';
    var chk = UrlFetchApp.fetch(base + '/api/sessions/' + sesion.id + '/contacts/check/' + numero, { muteHttpExceptions: true });
    if (chk.getResponseCode() === 200) {
      var c = JSON.parse(chk.getContentText());
      c = c.data || c;
      if (c.exists === false) return { ok: false, error: 'El número no tiene WhatsApp' };
      if (c.whatsappId) chatId = c.whatsappId;
    }
    var res = UrlFetchApp.fetch(base + '/api/sessions/' + sesion.id + '/messages/send-text', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chatId: chatId, text: texto })
    });
    var codigo = res.getResponseCode();
    return codigo >= 200 && codigo < 300 ? { ok: true } : { ok: false, error: 'OpenWA respondió ' + codigo };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------- utilidades

function b64urlAcceso_(datos) {
  return Utilities.base64EncodeWebSafe(datos).replace(/=+$/, '');
}

// ================================================================ editor (▶)

/** Crea las pestañas privadas CREDENCIALES y ACCESOS (ocultas). */
function prepararAccesoSeguro() {
  hojaCredenciales_();
  registrarAcceso_('-', 'prepararAccesoSeguro', 'ok', 'pestañas listas');
  Logger.log('Pestañas CREDENCIALES y ACCESOS listas (ocultas).');
}

/** Revisa la configuración sin tocar datos de nadie. */
function probarAccesoSeguro() {
  var props = PropertiesService.getScriptProperties();
  ['FIREBASE_SA_EMAIL', 'FIREBASE_SA_KEY', 'TUNEL_SECRET', 'TUNEL_URL_WHATSAPP'].forEach(function (k) {
    Logger.log(k + ': ' + (props.getProperty(k) ? 'configurada' : 'FALTA'));
  });
  var t0 = Date.now();
  pbkdf2Base64_('12345678', Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sal'), PBKDF2_ITER);
  Logger.log('PBKDF2 con ' + PBKDF2_ITER + ' iteraciones: ' + (Date.now() - t0) + ' ms (ideal: 300–1500 ms)');
  try {
    var token = firmarTokenFirebase_('prueba', { rol: 'colaborador', empleadoId: 'prueba' });
    var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + FIREBASE_WEB_API_KEY, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ token: token, returnSecureToken: true })
    });
    Logger.log('Firebase acepta la credencial firmada: ' + (res.getResponseCode() === 200 ? 'SÍ' : 'NO → ' + res.getContentText().slice(0, 300)));
  } catch (e) {
    Logger.log('No se pudo firmar la credencial: ' + e.message);
  }
}

/** Código de activación manual (6 h) para quien no recibe WhatsApp. Cambia el ID y ejecuta. */
function generarCodigoManual() {
  var id = 'ESCRIBE_AQUI_EL_ID';
  var emp = buscarEmpleadoAcceso_(id);
  if (!emp || !emp.activo) throw new Error('No hay un colaborador activo con ID ' + id);
  var codigo = generarCodigo6_();
  guardarCodigo_(id, codigo, CODIGO_MANUAL_VALIDEZ_SEG, true);
  registrarAcceso_(id, 'generarCodigoManual', 'ok', Session.getActiveUser().getEmail());
  Logger.log('Código para ' + emp.nombre + ' (' + id + '): ' + codigo + ' — vence en 6 horas.');
}
