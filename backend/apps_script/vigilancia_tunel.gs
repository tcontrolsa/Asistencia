/**
 * TCONTROL · Vigilancia del túnel del servidor histórico (contenedor tunel-historico)
 *
 * El túnel de Cloudflare que publica PostgREST puede quedar caído o con una URL que ya no existe; entonces
 * fallan evaluaciones, el histórico del panel, las correcciones de días archivados y la portería pasa a
 * contingencia. Cada 10 minutos se revisa que la URL publicada en configuracion/historico responda.
 * Si falla 2 revisiones seguidas (~20 min) se avisa a TI por campana, WhatsApp (bot) y correo al dueño del
 * script —el correo llega aunque el servidor entero esté apagado, porque el bot de WhatsApp vive en el mismo
 * servidor—. Al volver a responder se avisa que se restableció.
 *
 * Funciones para ejecutar desde el editor (▶):
 *   instalarVigilanciaTunel()   crea el activador cada 10 minutos y hace una revisión
 *   probarAvisoTunel()          envía un aviso de prueba por los tres medios
 *
 * Usa urlHistorico_ (evaluacion_desempeno.gs), crearNotificacion_ y whatsappA_ (notificaciones.gs).
 */

var VIGILANCIA_AVISAR_A = ['1058'];          // IDs de TI que reciben el aviso (campana y WhatsApp)
var VIGILANCIA_FALLOS_PARA_AVISAR = 2;       // revisiones seguidas con fallo antes de avisar

function vigilarTunel() {
  var props = PropertiesService.getScriptProperties();
  var fallos = Number(props.getProperty('TUNEL_FALLOS') || 0);
  var avisado = props.getProperty('TUNEL_AVISADO') === '1';
  var r = probarTunel_();
  if (r.ok) {
    if (avisado) {
      avisarTi_('Túnel restablecido', '✅ El servidor del histórico volvió a responder. Evaluaciones, histórico y visitas funcionan con normalidad.');
    }
    props.setProperties({ TUNEL_FALLOS: '0', TUNEL_AVISADO: '0' });
    return r;
  }
  fallos++;
  props.setProperty('TUNEL_FALLOS', String(fallos));
  if (fallos >= VIGILANCIA_FALLOS_PARA_AVISAR && !avisado) {
    avisarTi_('Servidor del histórico sin respuesta',
      '⚠️ El servidor del histórico no responde desde hace unos ' + (fallos * 10) + ' minutos (' + r.error + '). ' +
      'Afecta evaluaciones, el histórico del panel y la portería de visitas (queda en contingencia). ' +
      'Solución habitual: en el servidor 192.168.10.129 (AnyDesk) ejecutar «docker restart tunel-historico».');
    props.setProperty('TUNEL_AVISADO', '1');
  }
  return r;
}

// La URL se lee de nuevo cada vez (sin caché) y debe responder 200 en la raíz de PostgREST
function probarTunel_() {
  CacheService.getScriptCache().remove('eval_url_historico');   // sin caché: la URL vigente de Firestore
  var url = urlHistorico_();
  if (!url) return { ok: false, error: 'no hay URL publicada' };
  try {
    var res = UrlFetchApp.fetch(url + '/', { muteHttpExceptions: true, followRedirects: false });
    var code = res.getResponseCode();
    return code === 200 ? { ok: true, url: url } : { ok: false, url: url, error: 'responde HTTP ' + code };
  } catch (e) {
    return { ok: false, url: url, error: String((e && e.message) || e).slice(0, 80) };
  }
}

function avisarTi_(titulo, texto) {
  var resultado = {};
  VIGILANCIA_AVISAR_A.forEach(function (id) {
    try { crearNotificacion_({ para: id, tipo: 'general', clave: 'tunel_historico_' + id, reemplazar: true, titulo: titulo, texto: texto }); resultado['campana_' + id] = 'ok'; }
    catch (e) { resultado['campana_' + id] = String(e.message || e); }
    try { resultado['whatsapp_' + id] = whatsappA_(id, texto); } catch (e) { resultado['whatsapp_' + id] = String(e.message || e); }
  });
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'TCONTROL · ' + titulo, texto); resultado.correo = 'ok'; }
  catch (e) { resultado.correo = String(e.message || e); }
  Logger.log('Aviso de túnel: ' + JSON.stringify(resultado));
  return resultado;
}

function instalarVigilanciaTunel() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'vigilarTunel') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('vigilarTunel').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().setProperties({ TUNEL_FALLOS: '0', TUNEL_AVISADO: '0' });
  Logger.log('Vigilancia del túnel instalada (cada 10 minutos). Revisión ahora: ' + JSON.stringify(vigilarTunel()));
}

function probarAvisoTunel() {
  return avisarTi_('Prueba de aviso del túnel', '🔔 Prueba: así llegará el aviso si el servidor del histórico deja de responder. No hay que hacer nada.');
}
