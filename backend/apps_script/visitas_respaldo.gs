/**
 * TCONTROL · Visitas: respaldo de portería para cuando el servidor de PostgREST no responde
 *
 * Mientras el servidor funciona, la tarea programada (tareaRespaldoVisitas, cada 10 minutos) copia a
 * la hoja VISITAS_RESPALDO lo que la portería necesita: visitas de hoy y de los próximos 2 días,
 * tipos de visita con a quién se avisa y los anfitriones activos (api.visita_guardia_respaldo).
 *
 * Si el servidor cae, la terminal del guardia (JS/guardia_visitas.js) entra en modo contingencia y
 * llama aquí (POST accion visitasRespaldo, con su mismo JWT de portería):
 *   estado      lista de hoy = copia + lo registrado en contingencia después de la copia
 *   entrada     entrada de una visita aprobada (verifica documento y EPP) → avisa al anfitrión
 *   salida      salida de una visita en curso
 *   registrar   visitante sin cita (lo registra el guardia) → avisa al anfitrión
 *   anfitriones buscar a quién visita (desde la copia)
 *   sincronizar enviar ya los pendientes a Postgres (el guardia lo pide al volver el servidor)
 * Cada registro queda en la hoja VISITAS_CONTINGENCIA (PENDIENTE). Cuando el servidor vuelve, se
 * envían a api.visita_guardia_sync, que los aplica con su hora real y sin repetir el aviso de llegada.
 *
 * LOPDP: las hojas están ocultas; solo este script las usa. La copia se reemplaza en cada pasada y
 * los registros ya sincronizados se borran a los 30 días.
 *
 * Requiere: visitas.gs (notificarVisita, nombreCortoVisita_), evaluacion_desempeno.gs (urlHistorico_),
 * notificaciones.gs (crearNotificacion_, whatsappA_). Propiedad PGRST_JWT_SECRET.
 * Instalar una vez desde el editor: instalarRespaldoVisitas().
 */

var RESPALDO_HOJA_COPIA = 'VISITAS_RESPALDO';
var RESPALDO_HOJA_EVENTOS = 'VISITAS_CONTINGENCIA';
var RESPALDO_TROZO = 40000;             // caracteres por celda (límite de Sheets: 50 000)
var RESPALDO_DIAS_CONSERVAR = 30;
var RESPALDO_COLUMNAS = ['id', 'creado', 'en', 'accion', 'codigo', 'ref', 'datos', 'puesto', 'estado', 'resultado', 'sincronizado'];

// ---------------------------------------------------------------------
// Entrada (POST desde la terminal del guardia)
// ---------------------------------------------------------------------
function procesarRespaldoVisitas(d) {
  var claims = verificarTokenGuardia_(d.token);
  if (!claims) return { ok: false, sesion: true, error: 'La sesión de portería venció. Ingresa la clave de nuevo.' };
  var op = String(d.op || 'estado');
  var puesto = String(claims.puesto || 'PORTERIA');
  try {
    if (op === 'estado') return estadoRespaldoVisitas_();
    if (op === 'anfitriones') return buscarAnfitrionRespaldo_(d.q);
    if (op === 'sincronizar') {
      var s = sincronizarRespaldoVisitas_();
      var est = estadoRespaldoVisitas_();
      est.sincronizacion = s;
      return est;
    }
    if (op === 'entrada' || op === 'salida' || op === 'registrar') {
      var lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try { return registrarEventoRespaldo_(op, d, puesto); } finally { lock.releaseLock(); }
    }
    return { ok: false, error: 'Operación no válida.' };
  } catch (e) {
    return { ok: false, error: 'Respaldo de visitas: ' + e.message };
  }
}

// JWT HS256 firmado con PGRST_JWT_SECRET (el mismo que emite tokenGuardia)
function verificarTokenGuardia_(token) {
  var partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  if (!secreto) return null;
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  if (b64url(Utilities.computeHmacSha256Signature(partes[0] + '.' + partes[1], secreto)) !== partes[2]) return null;
  try {
    var relleno = partes[1] + '==='.slice((partes[1].length + 3) % 4);
    var claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(relleno)).getDataAsString());
    if (claims.guardia !== true || !(Number(claims.exp) * 1000 > Date.now())) return null;
    return claims;
  } catch (e) { return null; }
}

function firmarTokenRespaldo_() {
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  if (!secreto) throw new Error('PGRST_JWT_SECRET no configurado');
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({ role: 'tcontrol_lector', guardia: true, puesto: 'RESPALDO', exp: Math.floor(Date.now() / 1000) + 600 })).getBytes());
  return header + '.' + payload + '.' + b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
}

// ---------------------------------------------------------------------
// Tarea programada: sincronizar pendientes y renovar la copia
// ---------------------------------------------------------------------
function tareaRespaldoVisitas() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var s = sincronizarRespaldoVisitas_();
    var c = copiarRespaldoVisitas_();
    purgarRespaldoVisitas_();
    Logger.log('Respaldo de visitas: sincronización ' + JSON.stringify(s) + ' · copia ' + JSON.stringify(c));
  } finally { lock.releaseLock(); }
}

function instalarRespaldoVisitas() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tareaRespaldoVisitas') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tareaRespaldoVisitas').timeBased().everyMinutes(10).create();
  hojaRespaldo_(RESPALDO_HOJA_COPIA);
  hojaRespaldo_(RESPALDO_HOJA_EVENTOS);
  tareaRespaldoVisitas();
  Logger.log('Respaldo de visitas instalado: corre cada 10 minutos. Copia: ' + JSON.stringify(leerCopiaRespaldo_() ? { generado: leerCopiaRespaldo_().generado } : null));
}

function rpcHistorico_(fn, p) {
  var base = urlHistorico_();
  if (!base) return { status: 0, body: null, error: 'Sin dirección del servidor' };
  try {
    var res = UrlFetchApp.fetch(base + '/rpc/' + fn, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + firmarTokenRespaldo_() }, payload: JSON.stringify({ p: p || {} })
    });
    var body = null;
    try { body = JSON.parse(res.getContentText()); } catch (e) { }
    if (res.getResponseCode() >= 500 || res.getResponseCode() === 404) CacheService.getScriptCache().remove('eval_url_historico');
    return { status: res.getResponseCode(), body: body };
  } catch (e) {
    CacheService.getScriptCache().remove('eval_url_historico');   // URL vieja del túnel o servidor apagado
    return { status: 0, body: null, error: e.message };
  }
}

function copiarRespaldoVisitas_() {
  var r = rpcHistorico_('visita_guardia_respaldo', {});
  if (r.status !== 200 || !r.body || !r.body.ok) return { ok: false, error: r.error || ('HTTP ' + r.status) };
  var texto = JSON.stringify(r.body);
  var trozos = [];
  for (var i = 0; i < texto.length; i += RESPALDO_TROZO) trozos.push([texto.slice(i, i + RESPALDO_TROZO)]);
  var hoja = hojaRespaldo_(RESPALDO_HOJA_COPIA);
  hoja.clearContents();
  hoja.getRange(1, 1, trozos.length, 1).setValues(trozos);
  return { ok: true, visitas: r.body.visitas.length, caracteres: texto.length };
}

function leerCopiaRespaldo_() {
  var hoja = hojaRespaldo_(RESPALDO_HOJA_COPIA);
  var n = hoja.getLastRow();
  if (!n) return null;
  try { return JSON.parse(hoja.getRange(1, 1, n, 1).getValues().map(function (f) { return f[0]; }).join('')); } catch (e) { return null; }
}

function sincronizarRespaldoVisitas_() {
  var hoja = hojaRespaldo_(RESPALDO_HOJA_EVENTOS);
  var filas = leerEventosRespaldo_(hoja).filter(function (e) { return e.estado === 'PENDIENTE'; });
  var r = { pendientes: filas.length, enviados: 0, errores: 0, detenido: '' };
  for (var i = 0; i < filas.length; i++) {
    var e = filas[i];
    var evento = { id: e.id, accion: e.accion, en: e.en, codigo: e.codigo, ref: e.ref, puesto: e.puesto };
    var datos = {};
    try { datos = JSON.parse(e.datos || '{}'); } catch (x) { }
    Object.keys(datos).forEach(function (k) { if (evento[k] === undefined || evento[k] === '') evento[k] = datos[k]; });
    var res = rpcHistorico_('visita_guardia_sync', { evento: evento });
    if (res.status !== 200 || !res.body) { r.detenido = res.error || ('HTTP ' + res.status); break; }   // servidor aún caído: se reintenta luego
    var ok = res.body.ok === true;
    if (!ok && !res.body.definitivo) { r.detenido = res.body.error || 'error'; break; }
    hoja.getRange(e.fila, 9, 1, 3).setValues([[ok ? 'SINCRONIZADO' : 'ERROR', JSON.stringify(res.body).slice(0, 2000), new Date().toISOString()]]);
    if (ok) r.enviados++; else r.errores++;
  }
  return r;
}

function purgarRespaldoVisitas_() {
  var hoja = hojaRespaldo_(RESPALDO_HOJA_EVENTOS);
  var limite = new Date(Date.now() - RESPALDO_DIAS_CONSERVAR * 86400000).toISOString();
  var filas = leerEventosRespaldo_(hoja);
  for (var i = filas.length - 1; i >= 0; i--) {
    if (filas[i].estado !== 'PENDIENTE' && filas[i].creado < limite) hoja.deleteRow(filas[i].fila);
  }
}

// ---------------------------------------------------------------------
// Estado de la portería en contingencia
// ---------------------------------------------------------------------
function hoyEcuador_() { return Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd'); }
// Resultado del contacto con el anfitrión hecho por el guardia (visitantes sin cita): { resultado, intentos } o null
function contactoRespaldo_(c) {
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || ['viene', 'espera', 'no_contesto', 'equivocado', 'sin_telefono'].indexOf(String(c.resultado)) === -1) return null;
  return { resultado: String(c.resultado), intentos: Math.max(1, Number(c.intentos) || 1) };
}

function normalizarCodigoRespaldo_(c) {
  var t = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.indexOf('TCV1') === 0 ? t.slice(4) : t;
}

// Copia + registros posteriores a ella. Devuelve también los tipos y la copia completa (uso interno).
function vistaRespaldo_() {
  var copia = leerCopiaRespaldo_();
  if (!copia) return null;
  var hoy = hoyEcuador_();
  var generado = String(copia.generado || '');
  var porCodigo = {};
  var visitas = (copia.visitas || []).map(function (v) { var x = JSON.parse(JSON.stringify(v)); porCodigo[x.codigo] = x; return x; });
  var eventos = leerEventosRespaldo_(hojaRespaldo_(RESPALDO_HOJA_EVENTOS)).filter(function (e) { return e.creado >= generado || e.estado === 'PENDIENTE'; });
  eventos.forEach(function (e) {
    var datos = {};
    try { datos = JSON.parse(e.datos || '{}'); } catch (x) { }
    if (e.accion === 'registrar') {
      var v = datos.visita;
      if (v && !porCodigo[v.codigo]) { porCodigo[v.codigo] = v; visitas.push(v); }
    } else {
      var cod = e.codigo || (datos.codigoLocal || '');
      var w = porCodigo[cod];
      if (!w) return;
      if (e.accion === 'entrada' && w.estado === 'aprobada') { w.estado = 'en_curso'; w.entradaEn = e.en; }
      if (e.accion === 'salida' && w.estado === 'en_curso') { w.estado = 'concluida'; w.salidaEn = e.en; }
    }
  });
  return { copia: copia, hoy: hoy, visitas: visitas, porCodigo: porCodigo, pendientes: eventos.filter(function (e) { return e.estado === 'PENDIENTE'; }).length };
}

function visitaPublicaRespaldo_(v) {
  var x = {};
  Object.keys(v).forEach(function (k) { if (k !== 'copias' && k !== 'anfitrionNombre') x[k] = v[k]; });
  return x;
}

function estadoRespaldoVisitas_() {
  var vista = vistaRespaldo_();
  if (!vista) return { ok: false, error: 'No hay copia de respaldo de visitas. Instala el respaldo (instalarRespaldoVisitas) mientras el servidor funcione.' };
  var hoy = vista.hoy;
  var lista = vista.visitas.filter(function (v) {
    return (v.fecha === hoy && ['aprobada', 'en_curso', 'concluida', 'pendiente'].indexOf(v.estado) !== -1) || v.estado === 'en_curso';
  }).map(visitaPublicaRespaldo_);
  return {
    ok: true, contingencia: true, generado: vista.copia.generado, hoy: hoy, pendientes: vista.pendientes,
    eppTexto: vista.copia.eppTexto || '', visitas: lista,
    tipos: (vista.copia.tipos || []).map(function (t) { var x = {}; Object.keys(t).forEach(function (k) { if (k !== 'notificar') x[k] = t[k]; }); return x; })
  };
}

function buscarAnfitrionRespaldo_(q) {
  var copia = leerCopiaRespaldo_();
  var sin = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  var t = sin(String(q || '').trim());
  if (!copia || t.length < 3) return { ok: true, anfitriones: [] };
  return { ok: true, anfitriones: (copia.anfitriones || []).filter(function (a) { return sin(a.nombreCompleto || a.nombre).indexOf(t) !== -1; })
    .slice(0, 25).map(function (a) { return { id: a.id, nombre: a.nombre, area: a.area }; }) };
}

// ---------------------------------------------------------------------
// Registros en contingencia
// ---------------------------------------------------------------------
function registrarEventoRespaldo_(op, d, puesto) {
  var hoja = hojaRespaldo_(RESPALDO_HOJA_EVENTOS);
  var id = String(d.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || Utilities.getUuid();
  var previo = leerEventosRespaldo_(hoja).filter(function (e) { return e.id === id; })[0];
  if (previo) return { ok: true, repetido: true, visita: (function () { try { return JSON.parse(previo.datos).visita || null; } catch (e) { return null; } })() };

  // Hora real del registro (la terminal la envía si lo guardó sin conexión y lo reintenta)
  var en = new Date();
  var enCliente = d.en ? new Date(d.en) : null;
  if (enCliente && !isNaN(enCliente) && enCliente.getTime() <= Date.now() + 5 * 60000 && enCliente.getTime() >= Date.now() - 2 * 86400000) en = enCliente;
  var vista = vistaRespaldo_();
  if (!vista) return { ok: false, error: 'No hay copia de respaldo de visitas.' };
  var copia = vista.copia;
  var tipoDe = function (tid) { return (copia.tipos || []).filter(function (t) { return t.id === tid; })[0] || null; };
  var visita, codigo = '', ref = '', datos = {};

  // Horario de visitas (07:30-18:30, o el de la configuración copiada): fuera de él no se registran ingresos
  if (op === 'registrar' || op === 'entrada') {
    var hc = (copia.horario || {}), hEn = Utilities.formatDate(en, 'America/Guayaquil', 'HH:mm');
    var ap = hc.apertura || '07:30', ci = hc.cierre || '18:30';
    if (hEn < ap || hEn > ci) return { ok: false, error: 'La empresa recibe visitas de ' + ap + ' a ' + ci + '. No se puede registrar el ingreso a esta hora.' };
  }
  if (op === 'registrar') {
    var nombre = String(d.nombre || '').trim().slice(0, 80), empresa = String(d.empresa || '').trim().slice(0, 80), motivo = String(d.motivo || '').trim().slice(0, 200);
    if (nombre.length < 3) return { ok: false, error: 'Escribe el nombre y apellido del visitante.' };
    if (empresa.length < 2) return { ok: false, error: 'Escribe la empresa o "Particular".' };
    if (motivo.length < 3) return { ok: false, error: 'Escribe el motivo de la visita.' };
    if (String(d.documentoVerificado) !== 'true') return { ok: false, error: 'Confirma que verificaste el documento de identidad.' };
    if (String(d.aceptaVerbal) !== 'true') return { ok: false, error: 'Lee al visitante el aviso de privacidad y confirma que lo aceptó.' };
    var tipo = tipoDe(String(d.tipo || ''));
    if (!tipo) return { ok: false, error: 'Elige para qué es la visita.' };
    if (tipo.epp && String(d.eppVerificado) !== 'true') return { ok: false, error: 'Esta visita exige EPP: confirma que el visitante lo lleva.' };
    var notificar = (tipo.notificar || []).map(String);
    var anfId = String(d.anfitrionId || '');
    if (!anfId && tipo.anfitrionOpcional) anfId = notificar[0] || '';
    var anf = (copia.anfitriones || []).filter(function (a) { return String(a.id) === anfId; })[0];
    if (!anf) return { ok: false, error: 'Busca y elige a la persona que visita.' };
    var contactoReg = contactoRespaldo_(d.contacto);
    if (!contactoReg) return { ok: false, error: 'Llama al anfitrión y registra el resultado de la llamada.' };
    codigo = 'R' + id.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-7);
    visita = { id: null, codigo: codigo, estado: 'en_curso', origen: 'porteria', contingencia: true, nombre: nombre, empresa: empresa, motivo: motivo,
      anfitrion: anf.nombre, anfitrionId: anf.id, anfitrionNombre: anf.nombreCompleto || anf.nombre, fecha: vista.hoy,
      hora: Utilities.formatDate(en, 'America/Guayaquil', 'HH:mm'), tipo: tipo.id, tipoNombre: tipo.nombre, epp: !!tipo.epp,
      entradaEn: en.toISOString(), salidaEn: null, copias: notificar.filter(function (c) { return c !== String(anf.id); }) };
    datos = { visita: visitaPublicaRespaldo_(visita), codigoLocal: codigo, tipo: tipo.id, anfitrionId: String(anf.id), nombre: nombre, empresa: empresa, motivo: motivo,
      documentoVerificado: true, aceptaVerbal: true, eppVerificado: String(d.eppVerificado) === 'true', contacto: contactoReg };
    codigo = '';   // el código real lo asigna Postgres al sincronizar
  } else {
    var cod = normalizarCodigoRespaldo_(d.codigo);
    var v = vista.porCodigo[cod];
    if (!v) return { ok: false, error: 'No hay ninguna visita con ese código en la copia de respaldo.' };
    if (op === 'entrada') {
      if (v.estado === 'pendiente') return { ok: false, error: 'La visita aún no fue aprobada por el anfitrión.' };
      if (v.estado !== 'aprobada') return { ok: false, error: 'La visita no está habilitada para ingresar (' + v.estado + ').' };
      if (v.fecha !== vista.hoy) return { ok: false, error: 'La visita está programada para el ' + String(v.fecha).split('-').reverse().join('/') + '.' };
      if (String(d.documentoVerificado) !== 'true') return { ok: false, error: 'Confirma que verificaste el documento de identidad.' };
      if (v.epp && String(d.eppVerificado) !== 'true') return { ok: false, error: 'Esta visita exige EPP: confirma que el visitante lo lleva.' };
      var contactoEnt = contactoRespaldo_(d.contacto);
      if (v.origen === 'porteria' && !contactoEnt) return { ok: false, error: 'Primero contacta al anfitrión y registra el resultado de la llamada.' };
      v.estado = 'en_curso'; v.entradaEn = en.toISOString();
    } else {
      if (v.estado !== 'en_curso') return { ok: false, error: 'La visita no tiene una entrada registrada.' };
      v.estado = 'concluida'; v.salidaEn = en.toISOString();
    }
    visita = v;
    if (v.contingencia) {   // sin cita registrado en contingencia: aún no tiene código real
      var reg = leerEventosRespaldo_(hoja).filter(function (e) { return e.accion === 'registrar' && e.datos.indexOf('"codigoLocal":"' + cod + '"') !== -1; })[0];
      ref = reg ? reg.id : '';
      datos = { codigoLocal: cod };
    } else {
      codigo = cod;
    }
    if (op === 'entrada' && contactoEnt) datos.contacto = contactoEnt;
  }

  var fila = hoja.getLastRow() + 1;
  if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 50);
  var rango = hoja.getRange(fila, 1, 1, RESPALDO_COLUMNAS.length);
  rango.setNumberFormat('@');   // texto: que Sheets no convierta fechas ni códigos
  rango.setValues([[id, new Date().toISOString(), en.toISOString(), op, codigo, ref, JSON.stringify(datos), puesto, 'PENDIENTE', '', '']]);

  // Aviso de llegada al anfitrión (campana y WhatsApp), como hace la cola de Postgres
  var aviso = null;
  if (op === 'entrada' || op === 'registrar') {
    try {
      aviso = notificarVisita({ evento: 'llego', visitaId: visita.id || ('R' + id), codigo: visita.codigo, origen: visita.origen,
        anfitrionId: visita.anfitrionId, anfitrionNombre: visita.anfitrionNombre || visita.anfitrion,
        visitanteNombre: visita.nombre, visitanteEmpresa: visita.empresa, tipoNombre: visita.tipoNombre,
        copias: visita.copias || [], epp: visita.epp });
    } catch (e) { aviso = { ok: false, error: e.message }; }
  }
  return { ok: true, contingencia: true, visita: visitaPublicaRespaldo_(visita), aviso: aviso };
}

// ---------------------------------------------------------------------
// Hojas
// ---------------------------------------------------------------------
function hojaRespaldo_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.getRange(1, 1, h.getMaxRows(), h.getMaxColumns()).setNumberFormat('@');   // texto: que Sheets no convierta fechas ni códigos
    if (nombre === RESPALDO_HOJA_EVENTOS) h.getRange(1, 1, 1, RESPALDO_COLUMNAS.length).setValues([RESPALDO_COLUMNAS]);
    h.hideSheet();
  }
  return h;
}

function leerEventosRespaldo_(hoja) {
  var n = hoja.getLastRow();
  if (n < 2) return [];
  return hoja.getRange(2, 1, n - 1, RESPALDO_COLUMNAS.length).getValues().map(function (f, i) {
    var o = { fila: i + 2 };
    RESPALDO_COLUMNAS.forEach(function (c, j) { o[c] = String(f[j] == null ? '' : f[j]); });
    return o;
  }).filter(function (e) { return e.id; }).sort(function (a, b) { return a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0; });
}
