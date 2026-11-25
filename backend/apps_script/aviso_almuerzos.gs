/**
 * TCONTROL · Aviso diario de almuerzos por WhatsApp
 *
 * Todos los días, a la hora configurada (09:30 por defecto), envía el número de almuerzos del día a los
 * Supervisores Administradores (1058 y supervisor/rol con ADMIN, activos y con teléfono) y a los contactos
 * extra (p. ej. encargados del catering) que se agregan en el panel: WhatsApp → 2. Automatizaciones (Aviso diario de almuerzos).
 *
 * Configuración en Firestore `configuracion/aviso_almuerzos`:
 *   activo (bool), hora ('HH:mm'), incluir_admins (bool), contactos [{nombre, telefono}],
 *   colaboradores [{id, nombre}] (fichas elegidas en el panel, p. ej. un usuario de producción: el teléfono sale de la ficha)
 *   y lo escribe este script: ultimo_envio ('YYYY-MM-DD'), ultimo_resultado (texto), ultimo_total.
 *
 * Cuenta igual que el panel y la página de Catering, con UN SOLO pedido para Empresa y Servicios externos:
 *   - colaboradores con ENTRADA o SOLO_ALMUERZO de hoy con almuerzo SI (no se cuenta quien ya marcó salida
 *     antes de las 09:30, igual que el panel);
 *   - almuerzos extra / invitados de hoy (solicitudes_invitados), sin cancelados ni refrigerios.
 * Un día sin ningún almuerzo no se envía mensaje.
 *
 * Usa enviarWhatsAppAcceso_ y normalizarTelefonoEc_ (acceso_seguro.gs) y notifBaseFirestore_,
 * listarEmpleadosFirestore_ y camposFirestore_ (notificaciones.gs / evaluacion_desempeno.gs).
 *
 * Ejecutar una vez desde el editor (▶): instalarAvisoAlmuerzos()
 * Prueba sin enviar (▶): simularAvisoAlmuerzos()
 */

var AVISO_ALM_DOC = 'configuracion/aviso_almuerzos';
var AVISO_ALM_TZ = 'America/Guayaquil';
var AVISO_ALM_HORA_DEFECTO = '09:30';

// ---------------------------------------------------------------- activador (cada 5 min)
function avisoAlmuerzosDiario() {
  var cfg = leerConfigAvisoAlm_();
  if (!cfg.activo) return;
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, AVISO_ALM_TZ, 'yyyy-MM-dd');
  var hm = Utilities.formatDate(ahora, AVISO_ALM_TZ, 'HH:mm');
  var hora = /^\d{2}:\d{2}$/.test(String(cfg.hora || '')) ? cfg.hora : AVISO_ALM_HORA_DEFECTO;
  if (hm < hora || cfg.ultimo_envio === hoy) return;
  var previo = reintentoAvisoAlm_(cfg, hoy);   // destinatarios que fallaron en un intento anterior de hoy
  // Pasadas 3 horas de la hora fijada ya no se envía (el pedido ya se hizo)
  if (minutosAvisoAlm_(hm) - minutosAvisoAlm_(hora) > 180) {
    // Si quedaban destinatarios sin recibirlo, se cierra el día dejando constancia de quiénes fueron
    if (previo) guardarEstadoAvisoAlm_({ ultimo_envio: hoy, ultimo_resultado: resumenAvisoAlm_(previo, previo.pendientes) + ' · se dejó de reintentar', reintento_fecha: '' });
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    cfg = leerConfigAvisoAlm_();   // releer dentro del candado: otra ejecución pudo enviarlo
    if (cfg.ultimo_envio === hoy) return;
    previo = reintentoAvisoAlm_(cfg, hoy);
    var r = enviarAvisoAlmuerzos_(cfg, hoy, false, previo);
    var pend = r.pendientes || [];
    var ahoraIso = new Date().toISOString();
    if (r.destinos > 0 && pend.length) {
      // Falló a alguien (túnel de WhatsApp caído, número sin WhatsApp…): NO se da por enviado y se reintenta en 5 min,
      // pero solo a quienes faltan (los que ya lo recibieron no vuelven a recibirlo). Máximo 6 reintentos.
      var intentos = (previo ? previo.intentos : 0) + 1;
      if (intentos >= 6) {
        guardarEstadoAvisoAlm_({ ultimo_envio: hoy, ultimo_resultado: r.resumen + ' · se dejó de reintentar', ultimo_total: r.total, ultimo_en: ahoraIso, reintento_fecha: '' });
      } else {
        guardarEstadoAvisoAlm_({
          ultimo_resultado: 'REINTENTANDO · ' + r.resumen, ultimo_total: r.total, ultimo_en: ahoraIso,
          reintento_fecha: hoy, reintento_pendientes: JSON.stringify(pend), reintento_texto: r.texto,
          reintento_destinos: r.destinos, reintento_intentos: intentos
        });
      }
    } else {
      guardarEstadoAvisoAlm_({ ultimo_envio: hoy, ultimo_resultado: r.resumen, ultimo_total: r.total, ultimo_en: ahoraIso, reintento_fecha: '' });
    }
    Logger.log(r.resumen);
  } finally {
    lock.releaseLock();
  }
}

/** Estado de un envío parcial de HOY ({pendientes, texto, total, destinos, intentos}) o null si no hay. */
function reintentoAvisoAlm_(cfg, hoy) {
  if (!cfg || cfg.reintento_fecha !== hoy) return null;
  var pend;
  try { pend = JSON.parse(cfg.reintento_pendientes || '[]'); } catch (e) { return null; }
  if (!pend.length || !cfg.reintento_texto) return null;
  return { pendientes: pend, texto: cfg.reintento_texto, total: Number(cfg.ultimo_total) || 0,
           destinos: Number(cfg.reintento_destinos) || pend.length, intentos: Number(cfg.reintento_intentos) || 0 };
}

function resumenAvisoAlm_(base, pendientes) {
  var ok = base.destinos - pendientes.length;
  return base.total + ' almuerzos · WhatsApp a ' + ok + ' de ' + base.destinos +
    (pendientes.length ? ' · no llegó a: ' + pendientes.map(function (d) { return d.nombre; }).join(', ') : '');
}

// ---------------------------------------------------------------- conteo y envío
/**
 * `previo` (opcional) = envío parcial anterior de hoy: se manda el MISMO texto solo a quienes faltaban.
 * Devuelve {total, enviados, destinos, pendientes:[{nombre, numero}], texto, resumen}.
 */
function enviarAvisoAlmuerzos_(cfg, hoy, simular, previo) {
  var c = previo ? { total: previo.total } : contarAlmuerzosHoy_(hoy);
  if (!c.total) return { total: 0, resumen: 'Sin almuerzos registrados hoy: no se envió mensaje.' };

  var texto = previo ? previo.texto : textoAvisoAlm_(c, hoy);
  var destinos = previo ? previo.pendientes : destinatariosAvisoAlm_(cfg);
  if (!destinos.length) return { total: c.total, resumen: c.total + ' almuerzos; sin destinatarios con teléfono válido.' };
  if (simular) return { total: c.total, resumen: 'SIMULACIÓN · ' + destinos.length + ' destinatarios: ' + destinos.map(function (d) { return d.nombre; }).join(', ') + '\n\n' + texto };

  var pendientes = [], errores = [];
  destinos.forEach(function (d) {
    var res = typeof enviarWhatsAppAcceso_ === 'function' ? enviarWhatsAppAcceso_(d.numero, texto) : { ok: false, error: 'Falta enviarWhatsAppAcceso_' };
    if (!(res && res.ok)) { pendientes.push({ nombre: d.nombre, numero: d.numero }); errores.push(d.nombre + ' (' + ((res && res.error) || 'sin respuesta') + ')'); }
    Utilities.sleep(700);   // OpenWA: tope de 10 por segundo, compartido con el bot
  });
  var total = previo ? previo.destinos : destinos.length;
  var enviados = total - pendientes.length;
  return {
    total: c.total, enviados: enviados, destinos: total, pendientes: pendientes, texto: texto,
    resumen: c.total + ' almuerzos · WhatsApp a ' + enviados + ' de ' + total + (errores.length ? ' · fallaron: ' + errores.join(', ') : '')
  };
}

function contarAlmuerzosHoy_(hoy) {
  var emps = {};
  listarEmpleadosFirestore_().forEach(function (e) { emps[e.id] = e; });

  var regs = consultaAvisoAlm_('registros', 'fecha', hoy);
  var porEmp = {};
  regs.forEach(function (r) {
    var id = String(r.empleadoId || '').trim();
    if (!id) return;
    var p = porEmp[id] || (porEmp[id] = { almuerzo: '', salidaTemprana: false });
    var tipo = String(r.tipo || '').toUpperCase();
    if ((tipo === 'ENTRADA' || tipo === 'SOLO_ALMUERZO') && !p.almuerzo) {
      var a = String(r.almuerzo || '').trim().toUpperCase();
      p.almuerzo = (a === 'SI' || a === 'SÍ' || a === 'PLANTA') ? 'SI' : (a ? 'NO' : '');
    }
    if (tipo === 'SALIDA' && minutosAvisoAlm_(String(r.hora || '')) < 570) p.salidaTemprana = true;
  });

  var empresa = 0, externos = 0;
  Object.keys(porEmp).forEach(function (id) {
    var p = porEmp[id];
    if (p.almuerzo !== 'SI' || p.salidaTemprana) return;
    var e = emps[id] || {};
    if (String(e.area || '').trim().toUpperCase() === 'PRUEBAS') return;   // fichas de prueba no cuentan
    if (String(e.tipo_personal || '').toUpperCase() === 'EXTERNO') externos++; else empresa++;
  });

  var extras = 0;
  consultaAvisoAlm_('solicitudes_invitados', 'fecha', hoy).forEach(function (s) {
    if (String(s.estado || '').toUpperCase() === 'CANCELADO') return;
    var t = String(s.subtipo || s.tipoSolicitud || s.tipo || '').toUpperCase();
    if (t.indexOf('REFRIGERIO') !== -1 || t.indexOf('SANDUCHE') !== -1 || t.indexOf('GALLETA') !== -1) return;
    extras += parseInt(s.cantidad, 10) || 1;
  });

  return { empresa: empresa, externos: externos, extras: extras, total: empresa + externos + extras };
}

function textoAvisoAlm_(c, hoy) {
  var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var d = new Date(hoy + 'T12:00:00');
  var p = hoy.split('-');
  var lineas = ['🍽️ *TCONTROL · Almuerzos de hoy*', dias[d.getDay()].charAt(0).toUpperCase() + dias[d.getDay()].slice(1) + ' ' + p[2] + '/' + p[1] + '/' + p[0], ''];
  lineas.push('*Total: ' + c.total + ' almuerzo' + (c.total === 1 ? '' : 's') + '*');
  lineas.push('• Personal: ' + (c.empresa + c.externos) + (c.externos ? ' (empresa ' + c.empresa + ', servicios externos ' + c.externos + ')' : ''));
  if (c.extras) lineas.push('• Extras e invitados: ' + c.extras);
  lineas.push('');
  lineas.push('Corte a las ' + Utilities.formatDate(new Date(), AVISO_ALM_TZ, 'HH:mm') + '. Los cambios posteriores se ven en el panel y en Catering.');
  return lineas.join('\n');
}

function destinatariosAvisoAlm_(cfg) {
  var vistos = {}, lista = [];
  var agregar = function (nombre, tel) {
    var numero = typeof normalizarTelefonoEc_ === 'function' ? normalizarTelefonoEc_(tel) : normalizarTelAvisoAlm_(tel);
    if (!numero || vistos[numero]) return;
    vistos[numero] = true;
    lista.push({ nombre: nombre || numero, numero: numero });
  };
  var empleados = null;
  var fichas = function () { return empleados || (empleados = listarEmpleadosFirestore_()); };
  if (cfg.incluir_admins !== false) {
    fichas().forEach(function (e) {
      if (String(e.activo || 'SI').toUpperCase() === 'NO') return;
      var rol = String(e.supervisor || e.rol || '').toUpperCase();
      if (e.id === '1058' || rol.indexOf('ADMIN') !== -1) agregar(e.nombre, e.telefono || e.celular);
    });
  }
  var ids = (cfg.colaboradores || []).map(function (k) { return k && String(k.id || '').trim(); }).filter(Boolean);
  if (ids.length) {
    fichas().forEach(function (e) {
      if (ids.indexOf(String(e.id)) === -1 || String(e.activo || 'SI').toUpperCase() === 'NO') return;
      agregar(e.nombre, e.telefono || e.celular);
    });
  }
  (cfg.contactos || []).forEach(function (k) { if (k && k.activo !== false) agregar(k.nombre, k.telefono); });
  return lista;
}

// Respaldo si no está acceso_seguro.gs: 09XXXXXXXX → 5939XXXXXXXX
function normalizarTelAvisoAlm_(t) {
  var d = String(t || '').replace(/\D/g, '');
  if (/^09\d{8}$/.test(d)) return '593' + d.slice(1);
  if (/^5939\d{8}$/.test(d)) return d;
  if (/^9\d{8}$/.test(d)) return '593' + d;
  return null;
}

function minutosAvisoAlm_(hm) {
  var m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9999;
}

// ---------------------------------------------------------------- Firestore
function consultaAvisoAlm_(coleccion, campo, valor) {
  var res = fetchFirestore_(notifBaseFirestore_() + ':runQuery?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: coleccion }],
      where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } } }
    } })
  });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo leer ' + coleccion + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText()).filter(function (r) { return r.document; })
    .map(function (r) { return camposFirestore_(r.document.fields || {}); });
}

function leerConfigAvisoAlm_() {
  var res = fetchFirestore_(notifBaseFirestore_() + '/' + AVISO_ALM_DOC + '?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { activo: false };
  return valorAvisoAlm_({ mapValue: { fields: JSON.parse(res.getContentText()).fields || {} } });
}

// camposFirestore_ no lee listas ni mapas: la lista de contactos necesita este decodificador
function valorAvisoAlm_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorAvisoAlm_);
  if ('mapValue' in v) {
    var o = {}, f = v.mapValue.fields || {};
    Object.keys(f).forEach(function (k) { o[k] = valorAvisoAlm_(f[k]); });
    return o;
  }
  return null;
}

function guardarEstadoAvisoAlm_(campos) {
  var mask = Object.keys(campos).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  var fields = {};
  Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
  fetchFirestore_(notifBaseFirestore_() + '/' + AVISO_ALM_DOC + '?' + mask + '&key=' + EVAL_API_KEY_FIREBASE, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ fields: fields })
  });
}

// ---------------------------------------------------------------- editor (▶)
/** Vuelve a enviar el aviso de HOY (después de arreglar el túnel de WhatsApp). Solo dentro de la ventana de 3 horas. */
function reenviarAvisoAlmuerzosHoy() {
  guardarEstadoAvisoAlm_({ ultimo_envio: '', reintento_fecha: '' });   // reenvía a TODOS (descarta el reintento parcial)
  avisoAlmuerzosDiario();
  Logger.log('Resultado: ' + (leerConfigAvisoAlm_().ultimo_resultado || '(sin resultado)'));
}

/** Ejecutar una vez: revisa cada 5 minutos y envía una sola vez al día, a la hora del panel. */
function instalarAvisoAlmuerzos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'avisoAlmuerzosDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('avisoAlmuerzosDiario').timeBased().everyMinutes(5).create();
  Logger.log('Activador instalado: avisoAlmuerzosDiario cada 5 minutos (envía una vez al día a la hora configurada).');
}

/** Muestra el conteo de hoy, el mensaje y a quién iría, sin enviar nada. */
function simularAvisoAlmuerzos() {
  var hoy = Utilities.formatDate(new Date(), AVISO_ALM_TZ, 'yyyy-MM-dd');
  Logger.log(JSON.stringify(contarAlmuerzosHoy_(hoy)));
  Logger.log(enviarAvisoAlmuerzos_(leerConfigAvisoAlm_(), hoy, true).resumen);
}
