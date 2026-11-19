/**
 * TCONTROL · Soporte: confirmación automática del reporte (opción B, fase 1)
 *
 * OpenWA avisa (webhook) de cada mensaje que entra al WhatsApp del bot. Cuando el mensaje es un
 * «⚠️REPORTE DE INCIDENCIA» del formulario de soporte de la app, se responde al instante:
 * «Recibimos tu reporte… te avisaremos cuando esté resuelto». Cualquier otro mensaje se ignora aquí
 * (el aviso general lo da el mensaje de ausencia de WhatsApp Business).
 *
 * Seguridad: el webhook llega a la URL de la aplicación web con  ?webhook=soporte&s=<secreto>.
 * El secreto vive en la propiedad del script SOPORTE_WEBHOOK_SECRET (nunca en el repositorio).
 * Responde solo a reportes de chats privados, una vez por mensaje (dedup) y con tope por chat.
 *
 * Propiedades del script:
 *   SOPORTE_WEBHOOK_SECRET   texto largo al azar (lo mismo va en la URL que se registra en OpenWA)
 *   TUNEL_URL_WHATSAPP       ya existe (la registra el contenedor tunel-whatsapp)
 *
 * Desde el editor (▶):
 *   probarWebhookSoporte()   simula un reporte SIN enviar nada y muestra el texto que se respondería
 *
 * Registrar el webhook en OpenWA (en el servidor, no por el túnel público: el puente bloquea webhooks):
 *   1. Abrir el Swagger de OpenWA (http://localhost:3001/api/docs) y buscar el apartado Webhooks.
 *   2. Crear un webhook de la sesión con evento de mensaje recibido (message.received / message) y URL:
 *        https://script.google.com/macros/s/<ID_DE_LA_IMPLEMENTACION>/exec?webhook=soporte&s=<SECRETO>
 *   3. Escribir desde otro teléfono un reporte de prueba y revisar la hoja ACCESOS (acción 'webhookSoporte').
 * Apps Script responde a los POST con una redirección 302; OpenWA puede reintentar: el dedup por id lo cubre.
 */

var SOPORTE_TOPE_RESPUESTAS_HORA = 5;      // por chat
var SOPORTE_TEXTO_CONFIRMACION = '✅ Recibimos tu reporte de soporte{nombre}. Lo estamos revisando y te avisaremos por este chat cuando esté resuelto. Por favor no envíes otro mensaje por el mismo tema.';

// ---------------------------------------------------------------- lectura del evento (tolerante al formato)

function soporteTexto_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String(v._serialized || v.id || v.user || '');
  return String(v);
}

/** Devuelve { ok, motivo, id, chatId, cuerpo } a partir del cuerpo del webhook de OpenWA. */
function soporteLeerEvento_(d) {
  if (!d || typeof d !== 'object') return { ok: false, motivo: 'sin cuerpo' };
  var evento = soporteTexto_(d.event || d.type || d.eventType || '');
  if (evento && !/message|msg/i.test(evento)) return { ok: false, motivo: 'evento ' + evento };
  var m = d.data || d.payload || d.message || d;
  if (m && typeof m.message === 'object' && m.message) m = m.message;
  if (!m || typeof m !== 'object') return { ok: false, motivo: 'sin mensaje' };

  var propio = m.direction ? String(m.direction).toLowerCase() === 'outgoing' : !!(m.fromMe || (m.id && m.id.fromMe));
  if (propio) return { ok: false, motivo: 'mensaje propio' };
  var chatId = soporteTexto_(m.chatId || m.from || m.remoteJid || (m.id && m.id.remote) || '');
  if (!chatId) return { ok: false, motivo: 'sin chat' };
  if (m.isGroup || /@(g\.us|broadcast|newsletter)$/.test(chatId)) return { ok: false, motivo: 'grupo' };
  var tipo = String(m.type || 'text').toLowerCase();
  if (['text', 'chat', 'extendedtextmessage', 'conversation'].indexOf(tipo) === -1) return { ok: false, motivo: 'tipo ' + tipo };
  var cuerpo = String(m.body || m.text || m.caption || m.content || '');
  var id = soporteTexto_(m.id && m.id._serialized ? m.id._serialized : (m.id || m.messageId || ''));
  return { ok: true, id: id, chatId: chatId, cuerpo: cuerpo };
}

/** «ID Empleado: 1012» del texto del formulario (misma lectura que el portal). */
function soporteLeerIdReporte_(texto) {
  var m = String(texto || '').match(/ID\s*Empleado\s*:\s*(\d{1,6})/i);
  return m ? m[1] : '';
}

function soporteNombreCorto_(nombre) {
  var p = String(nombre || '').trim().split(/\s+/);
  var n = p[2] || p[0] || '';        // APELLIDO APELLIDO NOMBRE …
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

// ---------------------------------------------------------------- envío al chat

function soporteEnviarChat_(chatId, texto) {
  var base = PropertiesService.getScriptProperties().getProperty('TUNEL_URL_WHATSAPP');
  if (!base) return { ok: false, error: 'El túnel de WhatsApp no registró su URL (TUNEL_URL_WHATSAPP)' };
  try {
    var ses = JSON.parse(UrlFetchApp.fetch(base + '/api/sessions', { muteHttpExceptions: true }).getContentText());
    var lista = Array.isArray(ses) ? ses : (ses.data || []);
    var sesion = lista.filter(function (s) { return ['ready', 'WORKING', 'RUNNING', 'PAIRED'].indexOf(s.status) !== -1; })[0] || lista[0];
    if (!sesion) return { ok: false, error: 'Sin sesión de WhatsApp activa' };
    var res = UrlFetchApp.fetch(base + '/api/sessions/' + sesion.id + '/messages/send-text', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chatId: chatId, text: texto })
    });
    var codigo = res.getResponseCode();
    return codigo >= 200 && codigo < 300 ? { ok: true } : { ok: false, error: 'OpenWA respondió ' + codigo };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---------------------------------------------------------------- webhook

/** p = parámetros de la URL (webhook, s); d = cuerpo JSON de OpenWA; opciones.simular no envía nada. */
function procesarWebhookSoporte_(p, d, opciones) {
  var simular = !!(opciones && opciones.simular);
  try {
    var secreto = PropertiesService.getScriptProperties().getProperty('SOPORTE_WEBHOOK_SECRET');
    if (!simular && (!secreto || !p || String(p.s || '') !== secreto)) return { ok: false, error: 'No autorizado' };

    var ev = soporteLeerEvento_(d);
    if (!ev.ok) return { ok: true, ignorado: ev.motivo };
    if (!/REPORTE DE INCIDENCIA/i.test(ev.cuerpo)) return { ok: true, ignorado: 'no es un reporte' };

    var cache = CacheService.getScriptCache();
    if (!simular) {
      if (ev.id) {                                                  // un mismo mensaje no se responde dos veces
        var kId = 'sop_msg_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, ev.id));
        if (cache.get(kId)) return { ok: true, ignorado: 'repetido' };
        cache.put(kId, '1', 6 * 3600);
      }
      var kChat = 'sop_chat_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, ev.chatId));
      var n = parseInt(cache.get(kChat) || '0', 10);
      if (n >= SOPORTE_TOPE_RESPUESTAS_HORA) return { ok: true, ignorado: 'tope por chat' };
      cache.put(kChat, String(n + 1), 3600);
    }

    var nombre = '';
    var idEmp = soporteLeerIdReporte_(ev.cuerpo);
    if (idEmp && typeof leerEmpleadoFirestore_ === 'function') {
      try { var emp = leerEmpleadoFirestore_(idEmp); if (emp) nombre = soporteNombreCorto_(emp.nombre); } catch (e1) { }
    }
    var texto = SOPORTE_TEXTO_CONFIRMACION.replace('{nombre}', nombre ? ', ' + nombre : '');
    if (simular) return { ok: true, simulado: true, chatId: ev.chatId, empleadoId: idEmp, texto: texto };

    var r = soporteEnviarChat_(ev.chatId, texto);
    if (typeof registrarAcceso_ === 'function') registrarAcceso_(idEmp || '-', 'webhookSoporte', r.ok ? 'ok' : 'error', r.ok ? 'confirmación enviada' : r.error);
    return r;
  } catch (e) {
    console.error('webhookSoporte:', e);
    return { ok: false, error: String(e.message || e) };
  }
}

// ================================================================ editor (▶)

/** Simula la llegada de un reporte (no envía nada): muestra a qué chat y qué texto se respondería. */
function probarWebhookSoporte() {
  var d = { event: 'message.received', data: { id: 'prueba1', chatId: '1234567890@lid', direction: 'incoming', type: 'text',
    body: '⚠️REPORTE DE INCIDENCIA ⚠️\nDATOS DEL COLABORADOR\n• Nombre: PRUEBA\n• ID Empleado: 1058\n\nDETALLE DEL CASO\n• Fecha: 19/11/2026\n• Descripción: prueba' } };
  Logger.log(JSON.stringify(procesarWebhookSoporte_({}, d, { simular: true })));
  d.data.body = 'hola'; Logger.log('Mensaje normal → ' + JSON.stringify(procesarWebhookSoporte_({}, d, { simular: true })));
  d.data.direction = 'outgoing'; d.data.body = '⚠️REPORTE DE INCIDENCIA ⚠️'; Logger.log('Propio → ' + JSON.stringify(procesarWebhookSoporte_({}, d, { simular: true })));
}
