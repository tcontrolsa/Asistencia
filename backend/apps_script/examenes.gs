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

/**
 * Respaldo de la página del examen (examen.html) para redes que bloquean *.trycloudflare.com.
 * Solo reenvía a api.examen_publico, que se identifica por el token del enlace (sin sesión).
 * Las capturas de pantalla son JPEG en base64, por eso el tope es mayor que en otras funciones.
 */
function proxyExamenPublico(d) {
  var cuerpo = typeof d.p === 'string' ? d.p : JSON.stringify(d.p || {});
  if (cuerpo.length > 450000) return { status: 413, body: { ok: false, error: 'Solicitud demasiado grande' } };
  return rpcTunel_('examen_publico', cuerpo, '');
}

/**
 * Fase 4 · Resultados por correo
 *
 * El Excel (Resumen, Respuestas, Incidencias e Instrucciones para IA) se arma con las hojas que entrega la base
 * (historico.exam_resultados) y se manda como adjunto al evaluador:
 *   - examenResultados (POST, doPost): lo pide el evaluador desde la página («Enviar Excel a mi correo»).
 *   - enviarResultadosPendientes (activador cada 10 min): cuando un examen termina (todos entregaron o se les
 *     acabó el tiempo y ya venció el plazo de los enlaces) lo envía solo al dueño del examen. Instalar una vez
 *     ejecutando instalarActivadorExamenes() desde el editor.
 * El token del activador va firmado con PGRST_JWT_SECRET y el claim servicio='examenes'; solo sirve para
 * api.examenes_servicio. Si el evaluador no tiene correo (ni en Personas ni en la nómina) el examen queda
 * marcado con ese error y se ve en la página.
 */
function tokenServicioExamenes_() {
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  if (!secreto) throw new Error('PGRST_JWT_SECRET no configurado en Propiedades del script');
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({ role: 'tcontrol_lector', servicio: 'examenes', exp: Math.floor(Date.now() / 1000) + 600 })).getBytes());
  return header + '.' + payload + '.' + b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
}

// Hojas (arreglos de filas) -> archivo .xlsx, usando un libro temporal que se manda a la papelera
function excelDeHojas_(nombreArchivo, hojas) {
  var libro = SpreadsheetApp.create('tmp_examen_' + new Date().getTime());
  try {
    hojas.forEach(function (h, i) {
      var sh = i === 0 ? libro.getSheets()[0] : libro.insertSheet();
      sh.setName(h.nombre);
      var ancho = 1;
      h.filas.forEach(function (f) { if (f.length > ancho) ancho = f.length; });
      var filas = h.filas.map(function (f) {
        var r = f.map(function (v) {
          if (v === null || v === undefined) return '';
          // Un texto que empieza con = + - @ sería una fórmula: se deja como texto
          return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
        });
        while (r.length < ancho) r.push('');
        return r;
      });
      if (h.nombre === 'Respuestas') sh.getRange(1, 1, filas.length, 1).setNumberFormat('@');   // ID_RESPUESTA («12-34» no es una fecha)
      sh.getRange(1, 1, filas.length, ancho).setValues(filas);
      sh.getRange(1, 1, 1, ancho).setFontWeight('bold').setBackground('#e2e8f0');
      sh.setFrozenRows(h.nombre === 'Instrucciones para IA' ? 0 : 1);
      if (h.nombre === 'Respuestas') {
        sh.setColumnWidths(7, 3, 340);               // pregunta, respuesta modelo, respuesta del evaluado
        sh.getRange(2, 7, Math.max(filas.length - 1, 1), 3).setWrap(true).setVerticalAlignment('top');
        sh.getRange(2, 13, Math.max(filas.length - 1, 1), 1).setWrap(true);
      }
      if (h.nombre === 'Instrucciones para IA') { sh.setColumnWidth(1, 900); sh.getRange(1, 1, filas.length, 1).setWrap(true); sh.getRange(1, 1).setFontSize(12); }
    });
    SpreadsheetApp.flush();
    var res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + libro.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
    return res.getBlob().setName(nombreArchivo + '.xlsx');
  } finally {
    DriveApp.getFileById(libro.getId()).setTrashed(true);
  }
}

function enviarCorreoResultados_(destinatario, resultados) {
  var ex = resultados.examen, resumen = resultados.hojas[0].filas.slice(1);
  var nombreArchivo = ('Resultados ' + ex.nombre).replace(/[\\\/:*?"<>|]/g, '-').slice(0, 80);
  var blob = excelDeHojas_(nombreArchivo, resultados.hojas);
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var lineas = resumen.map(function (f) {
    return f[0] + ' · ' + f[3] + ' · ' + f[8] + '/' + f[7] + ' respondidas' + (f[9] ? ' · ' + f[9] + ' incidencia(s)' : '') + (f[11] != null && f[11] !== '' ? ' · ' + f[11] + '/' + f[12] + ' pts' : '');
  });
  MailApp.sendEmail({
    to: destinatario,
    subject: 'Resultados de la evaluación: ' + ex.nombre,
    name: 'TCONTROL · Evaluaciones',
    body: 'Terminó la evaluación «' + ex.nombre + '». Adjuntamos el Excel con las respuestas.\n\n' + lineas.join('\n') +
      '\n\nPara calificarlo con una IA sigue la hoja «Instrucciones para IA» y luego carga el archivo en la plataforma con «Cargar calificaciones».',
    htmlBody: '<div style="font-family:Arial,sans-serif;max-width:620px;color:#0f172a"><h2 style="margin:0 0 8px">Resultados de la evaluación</h2>' +
      '<p>Terminó <b>' + esc(ex.nombre) + '</b>. Adjuntamos el Excel con las respuestas.</p><ul>' + lineas.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<p style="font-size:13px;color:#475569">Para calificarlo con una IA sigue la hoja «Instrucciones para IA» y luego carga el archivo en la plataforma con «Cargar calificaciones».</p></div>',
    attachments: [blob]
  });
}

// Desde la página: el evaluador pide el Excel de un examen en su correo
function enviarResultadosExamen(d) {
  var token = String(d.token || ''), examenId = Number(d.examenId);
  if (!token || !examenId) return { ok: false, error: 'Faltan datos del examen.' };
  var r = rpcTunel_('examenes_resultados', JSON.stringify({ accion: 'resultados', examenId: examenId }), token);
  if (r.status === 401) return { ok: false, error: 'Tu sesión venció. Ingresa tu contraseña de nuevo.', sesion: true };
  if (!r.body || r.body.ok === false) return { ok: false, error: (r.body && r.body.error) || 'No se pudieron preparar los resultados.' };
  if (!r.body.destinatario) return { ok: false, error: 'No tienes un correo registrado. Márcate como evaluador en Personas y escribe tu correo; mientras tanto puedes descargar el Excel.' };
  try {
    enviarCorreoResultados_(r.body.destinatario, r.body.resultados);
  } catch (e) {
    return { ok: false, error: 'No se pudo enviar el correo: ' + String(e && e.message || e).slice(0, 150) };
  }
  rpcTunel_('examenes_resultados', JSON.stringify({ accion: 'resultados_marcar', examenId: examenId }), token);
  return { ok: true, destinatario: r.body.destinatario };
}

// Activador: envía solo los exámenes que ya terminaron
function enviarResultadosPendientes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var tok = tokenServicioExamenes_();
    var p = rpcTunel_('examenes_servicio', JSON.stringify({ accion: 'pendientes' }), tok);
    if (!p.body || p.body.ok !== true) { Logger.log('Pendientes: ' + JSON.stringify(p.body)); return; }
    p.body.examenes.forEach(function (x) {
      var error = '';
      try {
        if (!x.destinatario) throw new Error('El evaluador no tiene correo (ni en Personas ni en la nómina)');
        var r = rpcTunel_('examenes_servicio', JSON.stringify({ accion: 'resultados', examenId: x.examenId }), tok);
        if (!r.body || r.body.ok !== true) throw new Error((r.body && r.body.error) || 'No se pudieron leer los resultados');
        enviarCorreoResultados_(x.destinatario, r.body.resultados);
      } catch (e) { error = String(e && e.message || e).slice(0, 180); }
      rpcTunel_('examenes_servicio', JSON.stringify({ accion: 'marcar', examenId: x.examenId, error: error }), tok);
    });
  } finally {
    lock.releaseLock();
  }
}

/** Ejecutar una vez desde el editor (▶): crea el activador que revisa cada 10 minutos. */
function instalarActivadorExamenes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'enviarResultadosPendientes') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarResultadosPendientes').timeBased().everyMinutes(10).create();
  Logger.log('Activador instalado: enviarResultadosPendientes cada 10 minutos');
}
