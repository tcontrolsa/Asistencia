/**
 * TCONTROL · Credencial de campo (carné verificable con QR)
 *
 * El colaborador muestra en la app (pestaña Carné) un QR que cambia cada 30 s. El guardia del
 * cliente lo escanea con la cámara y abre verificar.html, que pregunta aquí si es válido.
 * La credencial no se valida a sí misma: lo que cuenta es esta respuesta y la foto que devuelve.
 *
 * Código de 30 s: HMAC-SHA256(SECRETO, 'TC|' + CID + '|' + paso) → 8 dígitos. La app lo calcula
 * sin internet (Web Crypto) con el SECRETO que recibe al activar la credencial con su PIN.
 * El SECRETO vive solo en la pestaña privada CREDENCIAL_CAMPO, nunca en Firestore (lectura pública).
 *
 * Vigencia: atada al estado laboral. Si el colaborador queda inactivo en Firestore (activo = NO),
 * se elimina de empleados o RR.HH. llena REVOCADA_EN, la verificación responde INACTIVO.
 *
 * Credencial física: CID_FISICA es otro identificador, con QR fijo (sin código). La página indica
 * que es una credencial impresa, así un QR fijo mostrado en un teléfono resulta sospechoso.
 *
 * Tipo de sangre: opcional, solo con consentimiento del colaborador (dato de salud, LOPDP).
 * Se muestra únicamente en su propia app, nunca en la página de verificación.
 *
 * Acciones (solo POST, desde doPost de api_completa.gs):
 *   credencialCampoEmitir      { empleadoId, pin }               → cid, secreto, emitida, sangre
 *   credencialCampoSync        { cid, t }                        → estado y sangre (sin registro)
 *   credencialCampoSangre      { cid, t, tipo, consentimiento }  → guarda o borra el tipo de sangre
 *   credencialCampoVerificar   { c, t? }                         → veredicto para verificar.html
 *
 * Funciones para ejecutar desde el editor (▶):
 *   prepararCredencialCampo()       crea las pestañas CREDENCIAL_CAMPO y VERIFICACIONES_CREDENCIAL (ocultas)
 *   generarCredencialFisica()       URL del QR fijo para imprimir (editar el ID)
 *   revocarCredencialCampo()        invalida el QR de un colaborador (teléfono perdido); editar el ID
 *   depurarVerificacionesCredencial()  borra consultas de más de 12 meses (programar mensual)
 *
 * Pendiente fase 1 de seguridad: verificar el PIN contra CREDENCIALES (acceso_seguro.gs),
 * igual que evaluacion_desempeno.gs.
 */

var HOJA_CRED_CAMPO = 'CREDENCIAL_CAMPO';
var HOJA_VERIF_CRED = 'VERIFICACIONES_CREDENCIAL';
var COLS_CRED_CAMPO = ['ID', 'CID_APP', 'SECRETO', 'CID_FISICA', 'EMITIDA_EN', 'REVOCADA_EN',
                       'TIPO_SANGRE', 'CONSENT_SANGRE_EN', 'ACTUALIZADO_EN'];
var COLS_VERIF_CRED = ['FECHA', 'ID', 'TIPO', 'RESULTADO'];
var CRED_PERIODO_SEG = 30;
var CRED_TOLERANCIA_PASOS = 1;          // acepta el código anterior y el siguiente (reloj desfasado)
var CRED_MAX_INTENTOS_PIN = 5;
var CRED_BLOQUEO_SEG = 15 * 60;
var CRED_MAX_CONSULTAS_MIN = 30;         // por credencial
var CRED_RETENCION_DIAS = 365;
var CRED_URL_VERIFICAR = 'https://asistencia.tcontrolsa.com/verificar.html';
var CRED_TIPOS_SANGRE = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
var CRED_EMPRESA = 'TCONTROL S.A.';

var ACCIONES_CREDENCIAL_CAMPO = ['credencialCampoEmitir', 'credencialCampoSync', 'credencialCampoSangre', 'credencialCampoVerificar'];

function procesarCredencialCampo(p) {
  try {
    switch (p.accion) {
      case 'credencialCampoEmitir': return emitirCredencialCampo_(p);
      case 'credencialCampoSync': return syncCredencialCampo_(p);
      case 'credencialCampoSangre': return guardarSangreCredencial_(p);
      case 'credencialCampoVerificar': return verificarCredencialCampo_(p);
    }
    return { ok: false, error: 'Acción no reconocida' };
  } catch (e) {
    console.error('Credencial campo:', e);
    return { ok: false, error: 'Error del servidor: ' + (e.message || e) };
  }
}

// ---------------------------------------------------------------- acciones

function emitirCredencialCampo_(p) {
  var id = String(p.empleadoId || '').trim();
  var pin = String(p.pin || '').trim();
  if (!id || !pin) return { ok: false, error: 'Ingresa tu PIN.' };

  var cache = CacheService.getScriptCache();
  var claveIntentos = 'cred_intentos_' + id;
  var intentos = parseInt(cache.get(claveIntentos) || '0', 10);
  if (intentos >= CRED_MAX_INTENTOS_PIN) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };

  var emp = leerEmpleadoFirestore_(id);
  if (!emp) return { ok: false, error: 'Colaborador no encontrado.' };
  if (!empleadoActivo_(emp)) return { ok: false, error: 'Colaborador inactivo.' };
  var guardado = String(emp.pin || '').trim();
  if (!guardado || (guardado !== sha256Hex_(pin) && guardado !== pin)) {
    cache.put(claveIntentos, String(intentos + 1), CRED_BLOQUEO_SEG);
    return { ok: false, error: 'PIN incorrecto.' };
  }
  cache.remove(claveIntentos);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var hoja = hojaCredCampo_();
    var fila = buscarFilaCred_(hoja, 'ID', id);
    var ahora = new Date().toISOString();
    var reg;
    if (fila && !fila.datos.REVOCADA_EN && fila.datos.CID_APP && fila.datos.SECRETO) {
      reg = fila.datos; // ya activa: la misma credencial sirve en otro teléfono del colaborador
    } else {
      reg = {
        ID: id, CID_APP: aleatorioHex_(20), SECRETO: aleatorioHex_(64),
        CID_FISICA: fila ? fila.datos.CID_FISICA : '', EMITIDA_EN: ahora, REVOCADA_EN: '',
        TIPO_SANGRE: fila ? fila.datos.TIPO_SANGRE : '', CONSENT_SANGRE_EN: fila ? fila.datos.CONSENT_SANGRE_EN : '',
        ACTUALIZADO_EN: ahora
      };
      escribirFilaCred_(hoja, fila ? fila.n : null, reg);
    }
    return {
      ok: true, cid: reg.CID_APP, secreto: reg.SECRETO, periodo: CRED_PERIODO_SEG,
      emitida: String(reg.EMITIDA_EN || ''), sangre: String(reg.TIPO_SANGRE || ''), urlVerificar: CRED_URL_VERIFICAR
    };
  } finally {
    lock.releaseLock();
  }
}

// La app la llama al abrir la pestaña con internet: detecta revocación y trae el tipo de sangre.
function syncCredencialCampo_(p) {
  var r = resolverCredencial_(String(p.cid || ''), String(p.t || ''));
  if (r.estado !== 'VALIDA' || r.tipo !== 'app') return { ok: true, estado: r.estado };
  return { ok: true, estado: 'VALIDA', sangre: String(r.fila.datos.TIPO_SANGRE || ''), emitida: String(r.fila.datos.EMITIDA_EN || '') };
}

function guardarSangreCredencial_(p) {
  var r = resolverCredencial_(String(p.cid || ''), String(p.t || ''));
  if (r.estado !== 'VALIDA' || r.tipo !== 'app') return { ok: false, error: 'La credencial no está vigente en este teléfono. Vuelve a activarla.' };
  var consiente = p.consentimiento === true || p.consentimiento === 'true';
  var tipo = String(p.tipo || '').trim().toUpperCase();
  if (consiente && CRED_TIPOS_SANGRE.indexOf(tipo) === -1) return { ok: false, error: 'Tipo de sangre no válido.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var hoja = hojaCredCampo_();
    var fila = buscarFilaCred_(hoja, 'CID_APP', r.fila.datos.CID_APP);
    var ahora = new Date().toISOString();
    fila.datos.TIPO_SANGRE = consiente ? tipo : '';
    fila.datos.CONSENT_SANGRE_EN = consiente ? ahora : '';
    fila.datos.ACTUALIZADO_EN = ahora;
    escribirFilaCred_(hoja, fila.n, fila.datos);
    return { ok: true, sangre: fila.datos.TIPO_SANGRE };
  } finally {
    lock.releaseLock();
  }
}

function verificarCredencialCampo_(p) {
  var cid = String(p.c || '').trim();
  var cache = CacheService.getScriptCache();
  var claveCons = 'cred_cons_' + cid;
  var n = parseInt(cache.get(claveCons) || '0', 10);
  if (n >= CRED_MAX_CONSULTAS_MIN) return { ok: false, error: 'Demasiadas consultas. Espera un minuto.' };
  cache.put(claveCons, String(n + 1), 60);

  var r = resolverCredencial_(cid, String(p.t || ''));
  var ahora = new Date();
  registrarVerificacion_(ahora, r.fila ? r.fila.datos.ID : '', r.tipo || '', r.estado);

  var res = { ok: true, estado: r.estado, consulta: ahora.toISOString() };
  if (r.estado !== 'VALIDA') return res; // sin datos personales si no es válida
  var e = r.emp;
  res.tipo = r.tipo;
  res.persona = {
    nombre: String(e.nombre || '').toUpperCase(),
    cargo: String(e.cargo || ''),
    area: String(e.area || ''),
    empresa: CRED_EMPRESA,
    cedula: enmascararCedula_(e.cedula),
    codigo: String(r.fila.datos.ID),
    foto_url: String(e.foto_url || '')
  };
  return res;
}

// ---------------------------------------------------------------- núcleo

// → { estado: VALIDA | QR_VENCIDO | NO_VALIDA | INACTIVO, tipo: app | fisica, fila, emp }
function resolverCredencial_(cid, t) {
  if (!/^[0-9a-f]{20}$/.test(cid)) return { estado: 'NO_VALIDA' };
  var hoja = hojaCredCampo_();
  var tipo = 'app';
  var fila = buscarFilaCred_(hoja, 'CID_APP', cid);
  if (!fila) { fila = buscarFilaCred_(hoja, 'CID_FISICA', cid); tipo = 'fisica'; }
  if (!fila) return { estado: 'NO_VALIDA' };
  if (fila.datos.REVOCADA_EN) return { estado: 'INACTIVO', tipo: tipo, fila: fila };

  var emp = leerEmpleadoFirestore_(String(fila.datos.ID));
  if (!emp || !empleadoActivo_(emp)) return { estado: 'INACTIVO', tipo: tipo, fila: fila };

  if (tipo === 'app' && !codigoCredValido_(String(fila.datos.SECRETO), cid, t)) {
    return { estado: 'QR_VENCIDO', tipo: tipo, fila: fila };
  }
  return { estado: 'VALIDA', tipo: tipo, fila: fila, emp: emp };
}

function codigoCredValido_(secreto, cid, t) {
  if (!/^\d{8}$/.test(t)) return false;
  var paso = Math.floor(Date.now() / 1000 / CRED_PERIODO_SEG);
  for (var d = -CRED_TOLERANCIA_PASOS; d <= CRED_TOLERANCIA_PASOS; d++) {
    if (codigoCred_(secreto, cid, paso + d) === t) return true;
  }
  return false;
}

// Debe coincidir con codigo() de JS/credencial_campo.js
function codigoCred_(secreto, cid, paso) {
  var b = Utilities.computeHmacSha256Signature('TC|' + cid + '|' + paso, secreto);
  var num = (((b[0] & 0x7f) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff)) % 100000000;
  return ('0000000' + num).slice(-8);
}

function empleadoActivo_(emp) {
  return !(String(emp.activo || 'SI').toUpperCase() === 'NO' || emp.activo === false);
}

function enmascararCedula_(c) {
  var s = String(c || '').replace(/\D/g, '');
  if (s.length < 6) return '';
  return s.slice(0, 2) + new Array(s.length - 4).join('•') + s.slice(-3, -1) + '-' + s.slice(-1);
}

function aleatorioHex_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}

// ---------------------------------------------------------------- hojas

function hojaCredCampo_() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_CRED_CAMPO);
  if (!hoja) throw new Error('Falta la pestaña ' + HOJA_CRED_CAMPO + ': ejecuta prepararCredencialCampo()');
  return hoja;
}

function buscarFilaCred_(hoja, col, valor) {
  var datos = hoja.getDataRange().getValues();
  var idx = COLS_CRED_CAMPO.indexOf(col);
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idx]).trim() === String(valor)) {
      var o = {};
      COLS_CRED_CAMPO.forEach(function (c, j) { o[c] = datos[i][j] instanceof Date ? datos[i][j].toISOString() : String(datos[i][j] || ''); });
      return { n: i + 1, datos: o };
    }
  }
  return null;
}

function escribirFilaCred_(hoja, n, o) {
  var fila = COLS_CRED_CAMPO.map(function (c) { return o[c] || ''; });
  if (n) hoja.getRange(n, 1, 1, fila.length).setValues([fila]);
  else hoja.appendRow(fila);
}

function registrarVerificacion_(fecha, id, tipo, resultado) {
  try {
    var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_VERIF_CRED);
    if (hoja) hoja.appendRow([fecha.toISOString(), id, tipo, resultado]);
  } catch (e) { console.warn('No se registró la verificación:', e); }
}

// ---------------------------------------------------------------- editor (▶)

function prepararCredencialCampo() {
  var ss = SpreadsheetApp.getActive();
  [[HOJA_CRED_CAMPO, COLS_CRED_CAMPO], [HOJA_VERIF_CRED, COLS_VERIF_CRED]].forEach(function (h) {
    var hoja = ss.getSheetByName(h[0]);
    if (!hoja) {
      hoja = ss.insertSheet(h[0]);
      hoja.appendRow(h[1]);
      hoja.getRange(1, 1, 1, h[1].length).setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
      hoja.setFrozenRows(1);
    }
    hoja.getRange('A:Z').setNumberFormat('@'); // IDs y fechas como texto
    hoja.hideSheet();
  });
  Logger.log('Listo: ' + HOJA_CRED_CAMPO + ' y ' + HOJA_VERIF_CRED + ' creadas y ocultas.');
}

// Editar el ID y ejecutar. Devuelve la URL que va en el QR fijo de la credencial impresa.
function generarCredencialFisica() {
  var id = 'EDITAR_ID';
  var emp = leerEmpleadoFirestore_(id);
  if (!emp) throw new Error('Colaborador ' + id + ' no encontrado en Firestore');
  var hoja = hojaCredCampo_();
  var fila = buscarFilaCred_(hoja, 'ID', id);
  var ahora = new Date().toISOString();
  var reg = fila ? fila.datos : { ID: id, EMITIDA_EN: ahora };
  if (!reg.CID_FISICA) reg.CID_FISICA = aleatorioHex_(20);
  reg.ACTUALIZADO_EN = ahora;
  escribirFilaCred_(hoja, fila ? fila.n : null, reg);
  var url = CRED_URL_VERIFICAR + '?c=' + reg.CID_FISICA;
  Logger.log(emp.nombre + ' → ' + url);
  return url;
}

// Teléfono perdido o credencial comprometida. El colaborador la reactiva con su PIN (nuevo QR).
function revocarCredencialCampo() {
  var id = 'EDITAR_ID';
  var hoja = hojaCredCampo_();
  var fila = buscarFilaCred_(hoja, 'ID', id);
  if (!fila) throw new Error('Sin credencial para ' + id);
  fila.datos.REVOCADA_EN = new Date().toISOString();
  fila.datos.ACTUALIZADO_EN = fila.datos.REVOCADA_EN;
  escribirFilaCred_(hoja, fila.n, fila.datos);
  Logger.log('Revocada la credencial de ' + id + '. La credencial física (CID_FISICA) también queda inválida.');
}

function depurarVerificacionesCredencial() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_VERIF_CRED);
  if (!hoja) return;
  var limite = Date.now() - CRED_RETENCION_DIAS * 86400000;
  var datos = hoja.getDataRange().getValues();
  var conservar = [datos[0]];
  for (var i = 1; i < datos.length; i++) {
    var f = datos[i][0] instanceof Date ? datos[i][0].getTime() : Date.parse(datos[i][0]);
    if (!(f < limite)) conservar.push(datos[i]);
  }
  if (conservar.length === datos.length) return;
  hoja.clearContents();
  hoja.getRange(1, 1, conservar.length, conservar[0].length).setValues(conservar);
  Logger.log('Borradas ' + (datos.length - conservar.length) + ' consultas de más de ' + CRED_RETENCION_DIAS + ' días.');
}
