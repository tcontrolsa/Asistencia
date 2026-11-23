/**
 * TCONTROL · Plataforma de evaluación técnica (exámenes)
 *
 * Los datos viven en PostgreSQL (db/postgres/019_examenes.sql, función api.examenes). Este archivo solo
 * envía los correos con el enlace de cada examen:
 *   - examenEnviar (POST, doPost de api_completa.gs): recibe el token del evaluador (el de tokenEvaluacion)
 *     y el examen. Pide a PostgREST (con ese mismo token, que decide los permisos) los envíos pendientes
 *     —la base rota el token de cada enlace y lo devuelve en claro solo aquí—, manda un correo por
 *     evaluado y devuelve a la base cuáles salieron y cuáles no.
 *   - El token del enlace nunca pasa por el navegador del evaluador.
 *
 * El enlace usa el fragmento (#t=), que el navegador no envía a ningún servidor.
 * Requiere 'examenes' en EVAL_FUNCIONES_PROXY (evaluacion_desempeno.gs). Los correos salen de la
 * cuenta dueña del script (cuota diaria de MailApp: 100 en cuentas gratuitas, 1500 en Workspace).
 */

var EXAMEN_URL_BASE = 'https://asistencia.tcontrolsa.com/examen.html';

function enviarCorreosExamen(d) {
  var token = String(d.token || '');
  var examenId = Number(d.examenId);
  if (!token || !examenId) return { ok: false, error: 'Faltan datos del examen.' };
  var cuerpo = { accion: 'envio_preparar', examenId: examenId };
  if (d.intentoIds && d.intentoIds.length) cuerpo.intentoIds = d.intentoIds.map(Number);

  var prep = rpcTunel_('examenes', JSON.stringify(cuerpo), token);
  if (prep.status === 401) return { ok: false, error: 'Tu sesión venció. Ingresa tu contraseña de nuevo.', sesion: true };
  if (!prep.body || prep.body.ok === false) return { ok: false, error: (prep.body && prep.body.error) || 'No se pudo preparar el envío.' };

  var envios = prep.body.envios || [];
  var examen = prep.body.examen || {};
  var enviados = [], fallos = [];
  var cuota = MailApp.getRemainingDailyQuota();

  envios.forEach(function (e, i) {
    if (i >= cuota) { fallos.push({ id: e.intentoId, error: 'Se agotó la cuota diaria de correos.' }); return; }
    try {
      var enlace = EXAMEN_URL_BASE + '#t=' + e.token;
      var vence = e.expiraEn ? Utilities.formatDate(new Date(e.expiraEn), 'America/Guayaquil', 'dd/MM/yyyy HH:mm') : '';
      var nombre = String(e.nombre || '').replace(/[<>&"]/g, '');
      MailApp.sendEmail({
        to: e.correo,
        subject: 'Evaluación técnica: ' + examen.nombre,
        name: 'TCONTROL · Evaluaciones',
        body: 'Hola ' + nombre + ',\n\nTienes una evaluación técnica pendiente: ' + examen.nombre + '.\n' +
          'Preguntas: ' + e.preguntas + '. Tiempo: ' + examen.minutos + ' minutos desde que presiones «Iniciar».\n\n' +
          'Ábrela aquí (enlace personal, no lo compartas):\n' + enlace + '\n\n' +
          (vence ? 'Disponible hasta el ' + vence + '.\n\n' : '') +
          'Antes de empezar busca un lugar tranquilo y con buena conexión. Durante la evaluación se registra si sales de la ventana.',
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:520px;color:#0f172a">' +
          '<h2 style="margin:0 0 8px">Evaluación técnica</h2>' +
          '<p>Hola <b>' + nombre + '</b>,</p>' +
          '<p>Tienes pendiente: <b>' + examen.nombre + '</b>.<br>' + e.preguntas + ' preguntas · ' + examen.minutos + ' minutos desde que presiones «Iniciar».</p>' +
          '<p><a href="' + enlace + '" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Abrir evaluación</a></p>' +
          '<p style="font-size:13px;color:#475569">Es un enlace personal: no lo compartas.' + (vence ? ' Disponible hasta el ' + vence + '.' : '') + '<br>' +
          'Busca un lugar tranquilo y con buena conexión. Durante la evaluación se registra si sales de la ventana.</p></div>'
      });
      enviados.push(e.intentoId);
    } catch (err) {
      fallos.push({ id: e.intentoId, error: String(err && err.message || err).slice(0, 150) });
    }
  });

  rpcTunel_('examenes', JSON.stringify({ accion: 'envio_marcar', ok: enviados, fallos: fallos }), token);
  return { ok: true, enviados: enviados.length, fallos: fallos.length, detalle: fallos };
}
