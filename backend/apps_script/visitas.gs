/**
 * TCONTROL · Registro de visitas (visitantes externos)
 *
 * Los datos viven en PostgreSQL (db/postgres/008_visitas.sql). Este archivo:
 *   1. tokenGuardia (solo POST): verifica la clave de portería y emite un JWT de 12 horas con el
 *      claim guardia = true para api.visita_guardia. La clave NO es la de guardia_core.js (esa es
 *      pública): se guarda en Propiedades del script como CLAVE_GUARDIA_VISITAS.
 *   2. notificarVisita (lo llama sync-historico al procesar la cola): avisos de la visita.
 *      - Campana del anfitrión (Firestore, colección notificaciones): texto SIN datos del visitante
 *        (Firestore no es privado); el detalle se ve en la app con el PIN.
 *      - WhatsApp al anfitrión (a su teléfono) con nombre y empresa del visitante.
 *      - WhatsApp y/o correo al visitante solo si los dejó; el enlace privado viaja solo en los
 *        eventos en que se generó (solicitada, confirmada). Cuando la visita queda aprobada
 *        (aprobada, confirmada) se envía además la imagen del QR, generada aquí (qrcode_lib.gs).
 *   3. visitaRpc (solo POST): respaldo para redes que bloquean *.trycloudflare.com. Reenvía la
 *      llamada pública (api.visita_publica, sin token) a PostgREST.
 *
 * Requiere: evaluacion_desempeno.gs (urlHistorico_, leerEmpleadoFirestore_), notificaciones.gs
 * (crearNotificacion_, whatsappA_, fechaTexto_), acceso_seguro.gs (enviarWhatsAppAcceso_,
 * normalizarTelefonoEc_) y qrcode_lib.gs (qrcode).
 */

var VISITAS_URL_PAGINA = 'https://asistencia.tcontrolsa.com/visitas.html';
var VISITAS_MAX_INTENTOS = 5;

// ---------------------------------------------------------------------
// 1. Token de portería
// ---------------------------------------------------------------------
function emitirTokenGuardia(p) {
  var props = PropertiesService.getScriptProperties();
  var clave = String(props.getProperty('CLAVE_GUARDIA_VISITAS') || '');
  var secreto = props.getProperty('PGRST_JWT_SECRET');
  if (!clave || !secreto) return { ok: false, error: 'Portería de visitas no configurada (CLAVE_GUARDIA_VISITAS).' };
  var cache = CacheService.getScriptCache();
  var intentos = parseInt(cache.get('visitas_guardia_intentos') || '0', 10);
  if (intentos >= VISITAS_MAX_INTENTOS * 4) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };
  if (String(p.clave || '').trim() !== clave) {
    cache.put('visitas_guardia_intentos', String(intentos + 1), 15 * 60);
    return { ok: false, error: 'Clave incorrecta.' };
  }
  var puesto = String(p.puesto || 'PORTERIA').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 30) || 'PORTERIA';
  var exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({ role: 'tcontrol_lector', guardia: true, puesto: puesto, exp: exp })).getBytes());
  var firma = b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
  return { ok: true, token: header + '.' + payload + '.' + firma, exp: exp, puesto: puesto };
}

// ---------------------------------------------------------------------
// 2. Avisos (desde la cola de Postgres)
// ---------------------------------------------------------------------
function notificarVisita(p) {
  var evento = String(p.evento || '');
  var id = String(p.visitaId || '');
  var fecha = fechaTexto_(p.fecha) + (p.hora ? ' a las ' + p.hora : '');
  var quien = (p.visitanteNombre || 'Tu visitante') + (p.visitanteEmpresa ? ' (' + p.visitanteEmpresa + ')' : '');
  var visitante = (p.visitanteNombre || 'Un visitante') + (p.visitanteEmpresa ? ' (' + p.visitanteEmpresa + ')' : '');
  var tipo = p.tipoNombre ? ' · ' + p.tipoNombre : '';
  var anfitrion = nombreCortoVisita_(p.anfitrionNombre) || 'su anfitrión';
  var enlaceCampana = { modulo: 'visitas', id: id };
  var enlaceVisitante = p.token ? VISITAS_URL_PAGINA + '#t=' + p.token : '';
  var conEpp = esVerdadVisita_(p.epp);
  var epp = conEpp ? ' Importante: para ingresar a planta debes traer tu equipo de protección (EPP): ' + (p.eppTexto || '') : '';
  // Copias informativas según el tipo de visita (configuración del módulo)
  var copias = listaVisita_(p.copias).filter(function (c) { return c && c !== String(p.anfitrionId); });
  var whatsappCopias = p.whatsappCopias === undefined || esVerdadVisita_(p.whatsappCopias);
  var r = { ok: true, evento: evento, copias: copias.length };

  // Campana al anfitrión y, con texto en tercera persona, a quienes reciben copia
  var campana = function (tipoNotif, titulo, texto, textoCopia, clave) {
    var base = clave || ('vis_' + evento + '_' + id);
    crearNotificacion_({ para: p.anfitrionId, tipo: tipoNotif, clave: base, reemplazar: true, enlace: enlaceCampana, titulo: titulo + tipo, texto: texto });
    copias.forEach(function (c) {
      crearNotificacion_({ para: c, tipo: tipoNotif, clave: base + '_c' + c, reemplazar: true, enlace: enlaceCampana,
        titulo: titulo + tipo + ' (copia)', texto: textoCopia });
    });
  };
  var whatsapp = function (texto, textoCopia) {
    if (texto) whatsappA_(p.anfitrionId, texto);
    if (whatsappCopias && textoCopia) copias.forEach(function (c) { whatsappA_(c, textoCopia); });
  };

  if (evento === 'solicitada') {
    campana('visita_solicitada', 'Solicitud de visita', 'Tienes una solicitud de visita para el ' + fecha + '. Revísala y apruébala en Visitas.',
      visitante + ' solicitó visitar a ' + anfitrion + ' el ' + fecha + '.');
    whatsapp('Hola, ' + quien + ' solicitó visitarte el ' + fecha + tipo + '. Apruébala o recházala en la app TCONTROL → Visitas: ' + NOTIF_URL_APP,
      'Aviso de visitas TCONTROL' + tipo + ': ' + visitante + ' solicitó visitar a ' + anfitrion + ' el ' + fecha + '.');
    r.visitante = avisarVisitante_(p, 'Recibimos tu solicitud de visita',
      'Hola ' + (p.visitanteNombre || '') + ', recibimos tu solicitud de visita a TCONTROL para el ' + fecha +
      '. Te avisaremos cuando sea aprobada. Con este enlace privado puedes ver su estado y tu código de ingreso: ' + enlaceVisitante + epp);
  } else if (evento === 'en_porteria') {
    // Visitante sin cita que se registró con el QR de portería: el guardia decide el ingreso
    campana('visita_llego', 'Visita sin cita en portería', quien + ' está en portería y dice que viene a visitarte. El guardia verificará su identidad.',
      visitante + ' está en portería sin cita para visitar a ' + anfitrion + '.', 'vis_llego_' + id);
    whatsapp('Hola, ' + quien + ' llegó a portería sin cita y dice que viene a visitarte' + tipo + '. El guardia verificará su identidad y registrará su ingreso.',
      'Aviso de visitas TCONTROL' + tipo + ': ' + visitante + ' llegó a portería sin cita para visitar a ' + anfitrion + '.');
    r.visitante = avisarVisitante_(p, 'Tu registro en portería',
      'Hola ' + (p.visitanteNombre || '') + ', registraste tu visita a TCONTROL. Muestra este código QR (o el código ' + codigoVisita_(p.codigo) +
      ') y tu documento de identidad al guardia. Tu enlace privado: ' + enlaceVisitante + epp, true);
  } else if (evento === 'confirmada') {
    campana('visita_confirmada', 'Invitado registrado', 'Tu invitado completó su registro para el ' + fecha + '.',
      visitante + ', invitado de ' + anfitrion + ', confirmó su visita del ' + fecha + '.');
    if (copias.length) whatsapp('', 'Aviso de visitas TCONTROL' + tipo + ': ' + visitante + ', invitado de ' + anfitrion + ', visitará la empresa el ' + fecha + '.');
    r.visitante = avisarVisitante_(p, 'Tu visita a TCONTROL está confirmada',
      'Hola ' + (p.visitanteNombre || '') + ', tu visita a TCONTROL del ' + fecha + ' está confirmada. Al llegar, muestra en portería este código QR (o el código ' +
      codigoVisita_(p.codigo) + ') y tu documento de identidad. Tu enlace privado para ver o cancelar la visita: ' + enlaceVisitante + epp, true);
  } else if (evento === 'aprobada') {
    r.visitante = avisarVisitante_(p, 'Tu visita fue aprobada',
      'Hola ' + (p.visitanteNombre || '') + ', tu visita a TCONTROL del ' + fecha + ' fue aprobada. Al llegar, muestra en portería este código QR (o el código ' +
      codigoVisita_(p.codigo) + ') y tu documento de identidad.' + epp, true);
  } else if (evento === 'rechazada' || evento === 'cancelada_anfitrion') {
    avisarVisitante_(p, 'Tu visita no podrá realizarse',
      'Hola ' + (p.visitanteNombre || '') + ', tu visita a TCONTROL del ' + fecha + ' no podrá realizarse' +
      (p.motivoRechazo ? ': ' + p.motivoRechazo : '.') + ' Si necesitas más información, comunícate con la persona que ibas a visitar.');
  } else if (evento === 'cancelada_visitante') {
    campana('visita_cancelada', 'Visita cancelada', 'El visitante canceló la visita del ' + fecha + '.',
      visitante + ' canceló su visita a ' + anfitrion + ' del ' + fecha + '.');
  } else if (evento === 'llego') {
    var sinCita = p.origen === 'porteria';
    campana('visita_llego', sinCita ? 'Visita sin cita ingresó' : 'Tu visita llegó',
      sinCita ? quien + ' llegó sin cita y ya ingresó por portería para visitarte.' : 'Tu visita del ' + fecha + ' ya está en portería.',
      visitante + (sinCita ? ' llegó sin cita e' : '') + ' ingresó por portería para visitar a ' + anfitrion + '.', 'vis_llego_' + id);
    whatsapp(sinCita ? quien + ' llegó sin cita y ya ingresó por portería para visitarte.' : quien + ' acaba de ingresar por portería para su visita contigo.',
      'Aviso de visitas TCONTROL' + tipo + ': ' + visitante + (sinCita ? ' llegó sin cita e' : '') + ' ingresó por portería para visitar a ' + anfitrion + '.' +
      (conEpp ? ' Visita a planta: el guardia verificó su EPP.' : ''));
  } else if (evento === 'concluida') {
    avisarVisitante_(p, 'Gracias por tu visita',
      'Gracias por visitar TCONTROL, ' + (p.visitanteNombre || '') + '. Si tienes un minuto, califica tu visita desde tu enlace privado; nos ayuda a mejorar.');
  } else if (evento === 'calificada') {
    campana('visita_calificada', 'Visita calificada', 'Tu visitante calificó la visita del ' + fecha + '.',
      'El visitante de ' + anfitrion + ' calificó la visita del ' + fecha + '.');
  } else {
    r = { ok: false, error: 'Evento de visita no reconocido: ' + evento };
  }
  return r;
}

// La cola llega por GET: las listas y los true/false vienen como texto ('["1000"]', '1000,29', 'true')
function listaVisita_(v) {
  if (Array.isArray(v)) return v.map(String);
  var t = String(v == null ? '' : v).trim();
  if (!t) return [];
  if (t.charAt(0) === '[') { try { var a = JSON.parse(t); if (Array.isArray(a)) return a.map(String); } catch (e) { } }
  return t.replace(/[\[\]"']/g, '').split(/[\s,;]+/).filter(String);
}
function esVerdadVisita_(v) { return v === true || String(v).toLowerCase() === 'true'; }

// "APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2" → "Nombre1 Apellido1" (igual que la base)
function nombreCortoVisita_(n) {
  var p = String(n || '').trim().toLowerCase().split(/\s+/).filter(String);
  var t = p.length >= 3 ? [p[2], p[0]] : p.length === 2 ? [p[1], p[0]] : p;
  return t.map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ');
}

function codigoVisita_(c) { return String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2'); }

// Imagen PNG del QR de ingreso ("TCV1:CODIGO", lo mismo que muestra la página) en base64.
// La librería genera GIF; WhatsApp (OpenWA) responde 500 con GIF, así que se convierte a PNG.
function qrVisitaBase64_(codigo) {
  if (typeof qrcode !== 'function' || !codigo) return '';
  var q = qrcode(0, 'M');
  q.addData('TCV1:' + codigo);
  q.make();
  var gif = String(q.createDataURL(10, 24)).split('base64,')[1] || '';
  if (!gif) return '';
  try {
    var png = Utilities.newBlob(Utilities.base64Decode(gif), 'image/gif', 'qr.gif').getAs('image/png');
    return Utilities.base64Encode(png.getBytes());
  } catch (e) {
    Logger.log('QR a PNG no convertido: ' + e);
    return '';
  }
}

// WhatsApp con imagen (OpenWA send-image); si falla, el texto solo
function enviarWhatsAppImagenVisita_(numero, base64, caption) {
  var base = PropertiesService.getScriptProperties().getProperty('TUNEL_URL_WHATSAPP');
  if (!base) return { ok: false, error: 'Sin URL del túnel de WhatsApp' };
  try {
    var ses = JSON.parse(UrlFetchApp.fetch(base + '/api/sessions', { muteHttpExceptions: true }).getContentText());
    var lista = Array.isArray(ses) ? ses : (ses.data || []);
    var sesion = lista.filter(function (s) { return ['ready', 'WORKING', 'RUNNING', 'PAIRED'].indexOf(s.status) !== -1; })[0] || lista[0];
    if (!sesion) return { ok: false, error: 'Sin sesión de WhatsApp activa' };
    var chatId = numero + '@c.us';
    var chk = UrlFetchApp.fetch(base + '/api/sessions/' + sesion.id + '/contacts/check/' + numero, { muteHttpExceptions: true });
    if (chk.getResponseCode() === 200) {
      var c = JSON.parse(chk.getContentText()); c = c.data || c;
      if (c.exists === false) return { ok: false, error: 'El número no tiene WhatsApp' };
      if (c.whatsappId) chatId = c.whatsappId;
    }
    // Dos formas de payload (las mismas que prueba el panel en openwa_service.js)
    var url = base + '/api/sessions/' + sesion.id + '/messages/send-image';
    var payloads = [
      { chatId: chatId, base64: base64, mimetype: 'image/png', caption: caption },
      { chatId: chatId, file: { mimetype: 'image/png', filename: 'pase-visita.png', data: base64 }, caption: caption }
    ];
    var errores = [];
    for (var i = 0; i < payloads.length; i++) {
      var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payloads[i]) });
      var cod = res.getResponseCode();
      if (cod >= 200 && cod < 300) return { ok: true, imagen: true, forma: i + 1 };
      errores.push('forma ' + (i + 1) + ': ' + cod + ' ' + res.getContentText().slice(0, 100));
    }
    return { ok: false, error: 'send-image falló (' + errores.join(' | ') + ')' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// WhatsApp y/o correo al visitante (solo si dejó su contacto). Con conQr, adjunta la imagen del QR.
// Devuelve qué se envió (queda en la respuesta de la cola para revisar). Nunca hace fallar la cola.
function avisarVisitante_(p, asunto, texto, conQr) {
  var out = {};
  var qr = conQr ? qrVisitaBase64_(p.codigo) : '';
  try {
    if (p.whatsapp && typeof normalizarTelefonoEc_ === 'function' && whatsappActivo_()) {
      var numero = normalizarTelefonoEc_(p.whatsapp);
      if (!numero) out.whatsapp = { ok: false, error: 'Número no válido' };
      else if (qr) {
        out.whatsapp = enviarWhatsAppImagenVisita_(numero, qr, texto);
        if (!out.whatsapp.ok && typeof enviarWhatsAppAcceso_ === 'function') {
          var soloTexto = enviarWhatsAppAcceso_(numero, texto);
          out.whatsapp = { ok: soloTexto.ok, imagen: false, error: out.whatsapp.error, texto: soloTexto.ok ? 'enviado' : soloTexto.error };
        }
      } else if (typeof enviarWhatsAppAcceso_ === 'function') {
        out.whatsapp = enviarWhatsAppAcceso_(numero, texto);
      }
    }
  } catch (e) { out.whatsapp = { ok: false, error: String(e) }; }
  try {
    if (p.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email))) {
      var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">' +
        texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>') +
        (qr ? '<p style="text-align:center;margin:18px 0"><img src="cid:qrvisita" alt="Código QR de ingreso" width="220" height="220"><br>' +
          '<strong style="font-family:monospace;font-size:20px;letter-spacing:3px">' + codigoVisita_(p.codigo) + '</strong></p>' : '') +
        '<p style="color:#64748b;font-size:12px;margin-top:18px">Recibes este mensaje porque registraste una visita a TCONTROL S.A. ' +
        'y dejaste este correo para recibir tu enlace. Tus datos se tratan conforme a la Ley Orgánica de Protección de Datos Personales.</p></div>';
      var opciones = { to: String(p.email), subject: 'TCONTROL · ' + asunto, name: 'TCONTROL S.A.', htmlBody: html };
      if (qr) opciones.inlineImages = { qrvisita: Utilities.newBlob(Utilities.base64Decode(qr), 'image/png', 'pase-visita.png') };
      MailApp.sendEmail(opciones);
      out.email = { ok: true, imagen: !!qr };
    }
  } catch (e) { out.email = { ok: false, error: String(e) }; }
  return out;
}

/** Prueba desde el editor (▶): envía a tu WhatsApp la imagen de un QR de ejemplo. Cambia el número. */
function probarQrVisitaWhatsApp() {
  var numero = normalizarTelefonoEc_('0999999999'); // ← tu número
  var qr = qrVisitaBase64_('PRUEBA23');
  Logger.log('PNG del QR: ' + (qr ? qr.length + ' caracteres base64' : 'NO se generó'));
  if (qr) Logger.log(JSON.stringify(enviarWhatsAppImagenVisita_(numero, qr, 'Prueba del pase de visita TCONTROL (código PRUE-BA23).')));
}

// ---------------------------------------------------------------------
// 3. Respaldo de la página pública
// ---------------------------------------------------------------------
function proxyVisitaPublica(d) {
  var cuerpo = typeof d.p === 'string' ? d.p : JSON.stringify(d.p || {});
  if (cuerpo.length > 6000) return { status: 413, body: { ok: false, error: 'Solicitud demasiado grande' } };
  var base = urlHistorico_();
  if (!base) return { status: 503, body: { ok: false, error: 'Servicio no disponible' } };
  var res = UrlFetchApp.fetch(base + '/rpc/visita_publica', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: '{"p":' + cuerpo + '}'
  });
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { ok: false, error: 'Respuesta no válida' }; }
  return { status: res.getResponseCode(), body: body };
}

/** Ejecutar una vez desde el editor (▶): define la clave de portería de visitas. Cámbiala aquí antes de ejecutar. */
function configurarClaveGuardiaVisitas() {
  var nueva = ''; // ← escribe aquí la clave (mínimo 6 caracteres) y ejecuta; luego bórrala de este archivo
  if (String(nueva).length < 6) throw new Error('Escribe una clave de al menos 6 caracteres en la variable "nueva".');
  PropertiesService.getScriptProperties().setProperty('CLAVE_GUARDIA_VISITAS', nueva);
  Logger.log('Clave de portería de visitas guardada en Propiedades del script.');
}
