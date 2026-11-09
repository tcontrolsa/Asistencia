/**
 * TCONTROL · Registro propio de colaboradores nuevos (db/postgres/017_registro.sql)
 *
 * 1. enviarRegistro (desde la cola de Postgres, la reenvía sync-historico): WhatsApp a la persona.
 *      tipo enlace      → enlace privado de registro (un solo uso, 24 horas)
 *      tipo registrado  → ese número ya es de un colaborador: que entre a la app
 *      tipo pendiente   → ya tiene una solicitud en revisión
 *      tipo rechazada   → su solicitud no fue aprobada
 *    Postgres borra el enlace de la cola en cuanto este archivo responde; aquí no se guarda.
 * 2. avisoRegistro (desde la cola): aviso en la campana de los supervisores admin, sin datos personales.
 * 3. registroRpc (solo POST): respaldo de la página pública para redes que bloquean *.trycloudflare.com.
 *
 * Requiere: acceso_seguro.gs (enviarWhatsAppAcceso_), notificaciones.gs (crearNotificacion_,
 * listarEmpleadosFirestore_), evaluacion_desempeno.gs (rpcTunel_).
 */

var REGISTRO_URL_PAGINA = 'https://asistencia.tcontrolsa.com/registro.html';
var REGISTRO_URL_APP = 'https://asistencia.tcontrolsa.com/index.html';

function enviarRegistro(p) {
  var tel = String(p.telefono || '').replace(/\D/g, '');
  if (!/^[1-9]\d{10,14}$/.test(tel)) return { ok: false, error: 'Teléfono no válido' };
  var saludo = 'Hola, te escribimos de *TCONTROL*.\n\n';
  var texto;
  if (p.tipo === 'enlace') {
    if (!/^[0-9a-f]{64}$/.test(String(p.token || ''))) return { ok: false, error: 'Enlace no válido' };
    texto = saludo + 'Para registrarte en la app de asistencia abre este enlace y completa tus datos:\n' +
      REGISTRO_URL_PAGINA + '#t=' + p.token + '\n\n' +
      'El enlace sirve *una sola vez* y vence en *24 horas*. No lo compartas.\n' +
      'Si no pediste registrarte, ignora este mensaje.';
  } else if (p.tipo === 'registrado') {
    texto = saludo + 'Este número ya está registrado en la app de asistencia. Ingresa aquí con tu ID:\n' + REGISTRO_URL_APP + '\n\n' +
      'Si olvidaste tu ID o tu PIN, consulta con tu supervisor.';
  } else if (p.tipo === 'pendiente') {
    texto = saludo + 'Tu solicitud de registro ya está en revisión. Te avisaremos por aquí cuando tu cuenta esté activa.';
  } else if (p.tipo === 'rechazada') {
    texto = saludo + 'Tu solicitud de registro en la app de asistencia no fue aprobada.' +
      (p.motivo ? '\nMotivo: ' + String(p.motivo).slice(0, 300) : '') + '\n\nSi crees que es un error, consulta con Talento Humano.';
  } else {
    return { ok: false, error: 'Tipo de aviso desconocido' };
  }
  var r = enviarWhatsAppAcceso_(tel, texto);
  return r.ok ? { ok: true, tipo: p.tipo } : { ok: false, error: r.error || 'No se pudo enviar' };
}

function avisoRegistro(p) {
  var codigo = String(p.codigo || '').slice(0, 20);
  var admins = listarEmpleadosFirestore_().filter(function (e) {
    var activo = String(e.activo || 'SI').toUpperCase() !== 'NO' && e.activo !== false;
    var rol = String(e.supervisor || e.rol || '').toUpperCase();
    return activo && (String(e.id) === EVAL_ADMIN_MASTER || rol.indexOf('ADMIN') !== -1);
  });
  admins.forEach(function (a) {
    crearNotificacion_({
      para: a.id, tipo: 'registro', clave: 'registro_' + codigo + '_' + a.id,
      titulo: 'Nueva solicitud de registro',
      texto: 'Una persona pidió registrarse en la app (' + codigo + '). Revísala en el panel: Directorio → Solicitudes de registro.',
      enlace: { modulo: 'registro' }
    });
  });
  return { ok: true, avisados: admins.length };
}

function proxyRegistroPublico(d) {
  var cuerpo = typeof d.p === 'string' ? d.p : JSON.stringify(d.p || {});
  if (cuerpo.length > 4000) return { status: 413, body: { ok: false, error: 'Solicitud demasiado grande' } };
  return rpcTunel_('registro_publico', cuerpo, '');
}
