/**
 * TCONTROL · Notificaciones (campana de la app y del panel + WhatsApp)
 *
 * Los avisos viven en Firestore, colección `notificaciones`, con texto mínimo (sin notas ni
 * comentarios). Campos: para (ID del empleado o 'rol:rrhh'), tipo, titulo, texto,
 * enlace {modulo, vista, id, periodo}, creada, leidaPor [], clave (evita duplicados).
 *
 * Origen de los avisos de desempeño:
 *   - Eventos (guardarEvaluacionEnHoja → notificarEvaluacion_): evaluación enviada, corregida,
 *     confirmada, alerta para RR.HH. (bajo la meta o caída de 10 pts), reunión solicitada o
 *     agendada y plazo reabierto. Vienen de la cola de Postgres con params.evento.
 *   - Recordatorios diarios (recordatoriosDiarios, activador de las 08:30), con la frecuencia y los
 *     plazos del cuestionario (api.eval_config): evaluaciones del período (mes o trimestre calendario)
 *     por registrar (desde el día 25 de su último mes hasta el día límite del mes siguiente), evaluaciones por confirmar que están por vencer, las que
 *     vencieron sin confirmar (aviso a RR.HH.), resultados que pierden vigencia y Día 75 de nuevos
 *     ingresos (desde el día 60). También borra avisos de más de 60 días.
 *
 * Los recordatorios que se repiten (pendientes, por confirmar) usan la misma clave y se reemplazan:
 * hay un solo aviso por tema, que vuelve a aparecer como no leído. Al confirmar una evaluación se
 * borran sus avisos de "por confirmar".
 *
 * Fines de semana: no hay recordatorios ni WhatsApp (los avisos de eventos quedan solo en la
 * campana).
 *
 * WhatsApp: usa enviarWhatsAppAcceso_ (acceso_seguro.gs) por el túnel del servidor. Solo de lunes a
 * viernes, de 07:00 a 20:00 y como máximo NOTIF_MAX_WHATSAPP por ejecución. Se apaga con la propiedad del script
 * NOTIF_WHATSAPP = NO.
 *
 * Ejecutar una vez desde el editor (▶): instalarRecordatorios()
 */

var NOTIF_COLECCION = 'notificaciones';
var NOTIF_URL_APP = 'https://asistencia.tcontrolsa.com';
var NOTIF_MAX_WHATSAPP = 40;
var NOTIF_DIAS_RETENCION = 60;
var NOTIF_TZ = 'America/Guayaquil';
var NOTIF_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var _notifWhatsAppEnviados = 0;

// ---------------------------------------------------------------- base
function notifBaseFirestore_() {
  return 'https://firestore.googleapis.com/v1/projects/' + EVAL_PROYECTO_FIRESTORE + '/databases/(default)/documents';
}

function valorFirestore_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valorFirestore_) } };
  if (typeof v === 'object') {
    var campos = {};
    Object.keys(v).forEach(function (k) { campos[k] = valorFirestore_(v[k]); });
    return { mapValue: { fields: campos } };
  }
  return { stringValue: String(v) };
}

function idNotificacion_(clave) {
  return String(clave).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
}

/**
 * Crea un aviso en la campana. Con `clave`, el documento usa esa clave como ID y no se repite.
 * Con `reemplazar` (y clave), si ya existía se sobrescribe y vuelve a quedar como no leído:
 * así los recordatorios diarios no se acumulan.
 * Devuelve true si se creó o reemplazó (false si ya existía o falló).
 */
function crearNotificacion_(n) {
  var campos = {};
  var datos = {
    para: String(n.para), tipo: n.tipo || 'general', titulo: n.titulo || '', texto: n.texto || '',
    enlace: n.enlace || {}, creada: new Date(), leidaPor: [], clave: n.clave || ''
  };
  Object.keys(datos).forEach(function (k) { campos[k] = valorFirestore_(datos[k]); });
  var url = notifBaseFirestore_() + '/' + NOTIF_COLECCION + '?key=' + EVAL_API_KEY_FIREBASE;
  var metodo = 'post';
  if (n.clave && n.reemplazar) {
    url = notifBaseFirestore_() + '/' + NOTIF_COLECCION + '/' + idNotificacion_(n.clave) + '?key=' + EVAL_API_KEY_FIREBASE;
    metodo = 'patch';
  } else if (n.clave) {
    url += '&documentId=' + encodeURIComponent(idNotificacion_(n.clave));
  }
  var res = UrlFetchApp.fetch(url, {
    method: metodo, contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ fields: campos })
  });
  var codigo = res.getResponseCode();
  if (codigo === 409) return false; // ya existía (misma clave)
  if (codigo !== 200) { Logger.log('Notificación no creada (' + codigo + '): ' + res.getContentText().slice(0, 200)); return false; }
  return true;
}

// Borra avisos por su clave (los que ya no aplican: p. ej. "por confirmar" de una evaluación confirmada)
function borrarNotificaciones_(claves) {
  if (!claves || !claves.length) return;
  var nombreBase = 'projects/' + EVAL_PROYECTO_FIRESTORE + '/databases/(default)/documents/' + NOTIF_COLECCION + '/';
  UrlFetchApp.fetch(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ writes: claves.map(function (c) { return { delete: nombreBase + idNotificacion_(c) }; }) })
  });
}

// 6 = sábado, 7 = domingo (zona horaria de Ecuador)
function esFinDeSemana_(fecha) {
  return Number(Utilities.formatDate(fecha || new Date(), NOTIF_TZ, 'u')) >= 6;
}

function whatsappActivo_() {
  return String(PropertiesService.getScriptProperties().getProperty('NOTIF_WHATSAPP') || 'SI').toUpperCase() !== 'NO';
}

// WhatsApp a un colaborador (por su teléfono en Firestore), con horario y tope por ejecución
function whatsappA_(empleadoId, texto) {
  if (!whatsappActivo_() || typeof enviarWhatsAppAcceso_ !== 'function') return { ok: false, error: 'WhatsApp desactivado' };
  if (esFinDeSemana_()) return { ok: false, error: 'Fin de semana' };
  var hora = Number(Utilities.formatDate(new Date(), NOTIF_TZ, 'H'));
  if (hora < 7 || hora >= 20) return { ok: false, error: 'Fuera de horario' };
  if (_notifWhatsAppEnviados >= NOTIF_MAX_WHATSAPP) return { ok: false, error: 'Tope de envíos alcanzado' };
  var emp = leerEmpleadoFirestore_(empleadoId);
  var numero = emp && typeof normalizarTelefonoEc_ === 'function' ? normalizarTelefonoEc_(emp.telefono || emp.celular || '') : null;
  if (!numero) return { ok: false, error: 'Sin teléfono válido' };
  _notifWhatsAppEnviados++;
  return enviarWhatsAppAcceso_(numero, texto);
}

function mesTexto_(periodo) {
  if (periodo === 'DIA75') return 'seguimiento Día 75';
  var t = String(periodo || '').match(/^(\d{4})-T([1-4])$/);
  if (t) return ['primer', 'segundo', 'tercer', 'cuarto'][Number(t[2]) - 1] + ' trimestre ' + t[1];
  var m = String(periodo || '').match(/^(\d{4})-(\d{2})$/);
  return m ? NOTIF_MESES[Number(m[2]) - 1] + ' ' + m[1] : String(periodo || '');
}
function primerNombre_(nombre) {
  var p = String(nombre || '').trim().split(/\s+/);
  // Los nombres vienen como APELLIDOS NOMBRES: se usa el tercer término si existe
  var n = p.length >= 3 ? p[2] : (p[1] || p[0] || '');
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

// ---------------------------------------------------------------- eventos de desempeño
function notificarEvaluacion_(p) {
  var id = String(p.evaluacionId || '');
  var mes = mesTexto_(p.periodo);
  var enlace = { modulo: 'desempeno', vista: 'detalle', id: id, periodo: p.periodo || '' };
  if (p.evento === 'enviada') {
    var nueva = crearNotificacion_({
      para: p.empleadoId, tipo: 'evaluacion_recibida', clave: 'env_' + id, enlace: enlace,
      titulo: 'Nueva evaluación de desempeño',
      texto: (p.evaluadorNombre || 'Tu jefe inmediato') + ' registró tu evaluación de ' + mes + '. Revísala y confírmala.'
    });
    if (nueva) {
      whatsappA_(p.empleadoId, 'Hola ' + primerNombre_(p.empleadoNombre) + ', ' + (p.evaluadorNombre || 'tu jefe inmediato') +
        ' registró tu evaluación de desempeño de ' + mes + '. Revísala y confírmala en la app TCONTROL → Desarrollo: ' + NOTIF_URL_APP);
    }
  } else if (p.evento === 'corregida') {
    crearNotificacion_({
      para: p.empleadoId, tipo: 'evaluacion_corregida', enlace: enlace,
      titulo: 'Evaluación actualizada', texto: 'Tu evaluación de ' + mes + ' fue corregida por tu jefe inmediato.'
    });
  } else if (p.evento === 'confirmada') {
    crearNotificacion_({
      para: p.evaluadorId, tipo: 'evaluacion_confirmada', clave: 'conf_ok_' + id, enlace: enlace,
      titulo: 'Evaluación confirmada', texto: (p.empleadoNombre || p.empleadoId) + ' confirmó su evaluación de ' + mes + '.'
    });
    // Ya no aplican: el aviso de evaluación recibida y los de "por confirmar"
    borrarNotificaciones_(['env_' + id, 'porconf_' + id, 'porconf_' + id + '_1', 'porconf_' + id + '_2']);
  } else if (p.evento === 'reunion_solicitada') {
    var sol = crearNotificacion_({
      para: p.evaluadorId, tipo: 'reunion_solicitada', clave: 'reu_sol_' + id, reemplazar: true, enlace: enlace,
      titulo: 'Piden una reunión', texto: (p.empleadoNombre || p.empleadoId) + ' quiere conversar su evaluación de ' + mes +
        (p.reunionMotivo ? ': ' + p.reunionMotivo : '.') + ' Agéndala desde la evaluación.'
    });
    if (sol) {
      whatsappA_(p.evaluadorId, 'Hola, ' + (p.empleadoNombre || p.empleadoId) + ' pidió una reunión para conversar su evaluación de desempeño de ' +
        mes + '. Agéndala en la app TCONTROL → Desarrollo: ' + NOTIF_URL_APP);
    }
  } else if (p.evento === 'reunion_agendada') {
    borrarNotificaciones_(['reu_sol_' + id]);
    var cuando = fechaTexto_(p.reunionFecha) + (p.reunionHora ? ' a las ' + p.reunionHora : '');
    var ag = crearNotificacion_({
      para: p.empleadoId, tipo: 'reunion_agendada', clave: 'reu_ag_' + id, reemplazar: true, enlace: enlace,
      titulo: 'Reunión agendada', texto: 'Conversarán tu evaluación de ' + mes + ' el ' + cuando + (p.reunionLugar ? ' · ' + p.reunionLugar : '') + '.'
    });
    if (ag) {
      whatsappA_(p.empleadoId, 'Hola ' + primerNombre_(p.empleadoNombre) + ', ' + (p.evaluadorNombre || 'tu jefe inmediato') +
        ' agendó la reunión para conversar tu evaluación de desempeño de ' + mes + ': ' + cuando + (p.reunionLugar ? ', ' + p.reunionLugar : '') + '.');
    }
  } else if (p.evento === 'plazo_reabierto') {
    crearNotificacion_({
      para: p.empleadoId, tipo: 'evaluacion_por_confirmar', clave: 'porconf_' + id, reemplazar: true, enlace: enlace,
      titulo: 'Plazo para confirmar reabierto', texto: 'Puedes confirmar tu evaluación de ' + mes + ' hasta el ' + fechaTexto_(p.venceConfirmar) + '.'
    });
  }
  if (String(p.alerta).toLowerCase() === 'true' && (p.evento === 'enviada' || p.evento === 'corregida')) {
    crearNotificacion_({
      para: 'rol:rrhh', tipo: 'alerta_desempeno', clave: 'alerta_' + id,
      enlace: { modulo: 'desempeno', vista: 'resultados', periodo: p.periodo || '' },
      titulo: 'Alerta de desempeño', texto: 'Una evaluación de ' + mes + ' quedó bajo la meta de ' + (p.meta || 80) + ' % o bajó 10 puntos. Revisa las alertas en Resultados.'
    });
  }
}

function fechaTexto_(f) {
  var m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[3]) + ' de ' + NOTIF_MESES[Number(m[2]) - 1] : String(f || '');
}

// ---------------------------------------------------------------- recordatorios diarios
function recordatoriosDiarios() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    _notifWhatsAppEnviados = 0;
    var resumen = { pendientes: 0, porConfirmar: 0, dia75: 0, borradas: 0 };
    // Fines de semana: solo la limpieza de avisos viejos
    if (esFinDeSemana_()) {
      resumen.borradas = borrarNotificacionesViejas_();
      Logger.log('Fin de semana: sin recordatorios · ' + JSON.stringify(resumen));
      return resumen;
    }
    var hoy = Utilities.formatDate(new Date(), NOTIF_TZ, 'yyyy-MM-dd');
    var partes = hoy.split('-').map(Number);
    var empleados = listarEmpleadosFirestore_();
    var activos = empleados.filter(function (e) { return String(e.activo || 'SI').toUpperCase() !== 'NO' && e.activo !== false; });
    var porId = {};
    activos.forEach(function (e) { porId[e.id] = e; });

    // Evaluaciones de los últimos meses y cuestionario vigente (PostgREST, token de sistema)
    var desde = mesDesplazado_(partes[0], partes[1], -3);
    var evals = listarEvaluacionesSistema_(desde);
    if (evals === null) { Logger.log('Sin acceso a la base de evaluaciones: se omiten los recordatorios'); return resumen; }
    var cfg = configEvaluacionSistema_() || {};
    var plazos = cfg.plazos || {};
    var diaLimite = Number(plazos.evaluarDia) || 10;
    var aviso = plazos.avisoDias === undefined ? 3 : Number(plazos.avisoDias);
    var tipoPeriodo = cfg.frecuencia === 'TRIMESTRAL' ? 'TRIMESTRAL' : 'MENSUAL';
    // Períodos a revisar: el actual y el anterior (mes o trimestre calendario), con su último mes
    var periodos = [];
    if (tipoPeriodo === 'TRIMESTRAL') {
      var q = Math.ceil(partes[1] / 3);
      [[partes[0], q], q === 1 ? [partes[0] - 1, 4] : [partes[0], q - 1]].forEach(function (x) {
        periodos.push({ id: x[0] + '-T' + x[1], ultimoMes: mesDesplazado_(x[0], x[1] * 3, 0) });
      });
    } else {
      [0, -1].forEach(function (d) { var m = mesDesplazado_(partes[0], partes[1], d); periodos.push({ id: m, ultimoMes: m }); });
    }

    // 1. Jefes con evaluaciones del período pendientes: desde el día 25 de su último mes hasta el día
    //    límite (diaLimite del mes siguiente). Un solo aviso por jefe y período, que se renueva cada día.
    periodos.forEach(function (per) {
      var mesObjetivo = per.id;
      var pm = per.ultimoMes.split('-').map(Number);
      var limite = mesDesplazado_(pm[0], pm[1], 1) + '-' + ('0' + diaLimite).slice(-2);
      var faltan = diasEntre_(hoy, limite);
      var desdeAviso = per.ultimoMes + '-25';
      var evaluadores = {};
      activos.forEach(function (e) { if (e.evaluador_id) evaluadores[e.evaluador_id] = true; });
      // Al día siguiente del vencimiento se retiran los avisos de pendientes de ese mes
      if (faltan === -1) borrarNotificaciones_(Object.keys(evaluadores).map(function (j) { return 'pend_' + j + '_' + mesObjetivo; }));
      if (faltan === null || faltan < 0 || hoy < desdeAviso) return;
      var hechas = {};
      evals.forEach(function (e) { if (e.tipo === tipoPeriodo && e.periodo === mesObjetivo) hechas[e.empleadoId] = true; });
      var pendientesPorJefe = {};
      activos.forEach(function (e) {
        var rol = String(e.evaluacion_rol || 'EVALUADO').toUpperCase();
        if (rol.indexOf('EVALUADO') === -1 || !e.evaluador_id || hechas[e.id]) return;
        var dias = diasDesdeIngreso_(e.fecha_ingreso || e.fechaIngreso, hoy);
        if (dias !== null && dias < 90) return; // en período de prueba: le toca Día 75
        (pendientesPorJefe[e.evaluador_id] = pendientesPorJefe[e.evaluador_id] || []).push(e.nombre || e.id);
      });
      Object.keys(pendientesPorJefe).forEach(function (jefe) {
        if (!porId[jefe]) return;
        var lista = pendientesPorJefe[jefe];
        var mes = mesTexto_(mesObjetivo);
        var creada = crearNotificacion_({
          para: jefe, tipo: faltan <= aviso ? 'plazo_por_vencer' : 'evaluaciones_pendientes',
          clave: 'pend_' + jefe + '_' + mesObjetivo, reemplazar: true,
          enlace: { modulo: 'desempeno', vista: 'equipo', periodo: mesObjetivo },
          titulo: faltan <= aviso ? 'Evaluaciones por vencer' : 'Evaluaciones pendientes',
          texto: 'Tienes ' + lista.length + ' evaluación(es) de ' + mes + ' por registrar. ' +
            (faltan === 0 ? 'El plazo vence hoy.' : 'El plazo vence el ' + fechaTexto_(limite) + ' (' + faltan + ' día' + (faltan === 1 ? '' : 's') + ').')
        });
        if (creada) {
          resumen.pendientes++;
          // WhatsApp solo al empezar, al entrar en los días de aviso y el último día
          if (hoy === desdeAviso || faltan === aviso || faltan === 0) {
            whatsappA_(jefe, 'Hola ' + primerNombre_(porId[jefe].nombre) + ', tienes ' + lista.length +
              ' evaluación(es) de desempeño de ' + mes + ' por registrar. El plazo vence el ' + fechaTexto_(limite) +
              '. App TCONTROL → Desarrollo: ' + NOTIF_URL_APP);
          }
        }
      });
      // Jefes que ya completaron el mes: se retira su aviso de pendientes
      var completos = Object.keys(evaluadores).filter(function (j) { return !pendientesPorJefe[j]; });
      if (completos.length) borrarNotificaciones_(completos.map(function (j) { return 'pend_' + j + '_' + mesObjetivo; }));
    });

    // 2. Evaluaciones enviadas sin confirmar: avisos desde que faltan `aviso` días; al vencer, a RR.HH.
    evals.forEach(function (e) {
      if (e.estado !== 'enviada' || !porId[e.empleadoId] || !e.venceConfirmar) return;
      var faltan = diasEntre_(hoy, e.venceConfirmar);
      if (faltan === null) return;
      if (faltan < 0) {
        if (crearNotificacion_({
          para: 'rol:rrhh', tipo: 'alerta_desempeno', clave: 'noconf_' + e.id,
          enlace: { modulo: 'desempeno', vista: 'resultados', periodo: e.periodo },
          titulo: 'Evaluación no confirmada', texto: (e.empleadoNombre || e.empleadoId) + ' no confirmó su evaluación de ' +
            mesTexto_(e.periodo) + ' (venció el ' + fechaTexto_(e.venceConfirmar) + ').'
        })) resumen.noConfirmadas = (resumen.noConfirmadas || 0) + 1;
        return;
      }
      if (faltan > aviso) return;
      var creada = crearNotificacion_({
        para: e.empleadoId, tipo: 'evaluacion_por_confirmar', clave: 'porconf_' + e.id, reemplazar: true,
        enlace: { modulo: 'desempeno', vista: 'detalle', id: String(e.id), periodo: e.periodo },
        titulo: 'Evaluación por confirmar',
        texto: 'Confirma tu evaluación de ' + mesTexto_(e.periodo) + (faltan === 0 ? ': el plazo vence hoy.' : ' antes del ' + fechaTexto_(e.venceConfirmar) + '.')
      });
      if (creada) {
        resumen.porConfirmar++;
        if (faltan === aviso || faltan === 0) {
          whatsappA_(e.empleadoId, 'Hola ' + primerNombre_(porId[e.empleadoId].nombre) + ', tu evaluación de desempeño de ' +
            mesTexto_(e.periodo) + ' está pendiente de confirmación; el plazo vence el ' + fechaTexto_(e.venceConfirmar) +
            '. Revísala en la app TCONTROL → Desarrollo: ' + NOTIF_URL_APP);
        }
      }
    });

    // 2b. Resultados que pierden vigencia: aviso único al evaluador
    evals.forEach(function (e) {
      if (!e.vigenteHasta || !porId[e.evaluadorId]) return;
      var faltan = diasEntre_(hoy, e.vigenteHasta);
      if (faltan === null || faltan < 0 || faltan > aviso) return;
      if (crearNotificacion_({
        para: e.evaluadorId, tipo: 'vigencia_por_vencer', clave: 'vig_' + e.id,
        enlace: { modulo: 'desempeno', vista: 'equipo' },
        titulo: 'Evaluación por vencer', texto: 'El resultado de ' + (e.empleadoNombre || e.empleadoId) + ' (' + mesTexto_(e.periodo) +
          ') deja de estar vigente el ' + fechaTexto_(e.vigenteHasta) + '.'
      })) resumen.vigencia = (resumen.vigencia || 0) + 1;
    });

    // 3. Día 75: nuevos ingresos entre los días 60 y 75 sin seguimiento
    var conDia75 = {};
    evals.forEach(function (e) { if (e.tipo === 'DIA75') conDia75[e.empleadoId] = true; });
    activos.forEach(function (e) {
      if (!e.evaluador_id || conDia75[e.id] || !porId[e.evaluador_id]) return;
      var dias = diasDesdeIngreso_(e.fecha_ingreso || e.fechaIngreso, hoy);
      if (dias === null || dias < 60 || dias > 75) return;
      var creada = crearNotificacion_({
        para: e.evaluador_id, tipo: 'dia75', clave: 'd75_' + e.id,
        enlace: { modulo: 'desempeno', vista: 'equipo', periodo: 'DIA75' },
        titulo: 'Seguimiento Día 75', texto: (e.nombre || e.id) + ' cumple ' + dias + ' días desde su ingreso: corresponde su seguimiento Día 75.'
      });
      if (creada) {
        resumen.dia75++;
        whatsappA_(e.evaluador_id, 'Hola ' + primerNombre_(porId[e.evaluador_id].nombre) + ', ' + (e.nombre || e.id) +
          ' cumple ' + dias + ' días desde su ingreso: corresponde su seguimiento Día 75 en la app TCONTROL → Desarrollo: ' + NOTIF_URL_APP);
      }
    });

    // 4. Limpieza de avisos viejos
    resumen.borradas = borrarNotificacionesViejas_();
    Logger.log('Recordatorios: ' + JSON.stringify(resumen) + ' · WhatsApp enviados: ' + _notifWhatsAppEnviados);
    return resumen;
  } finally {
    lock.releaseLock();
  }
}

// Fechas que "atiende" la ejecución de hoy: hoy y, si es lunes, también el sábado y el domingo
function diasCubiertosHoy_() {
  var dias = [];
  var atras = Number(Utilities.formatDate(new Date(), NOTIF_TZ, 'u')) === 1 ? 2 : 0;
  for (var i = 0; i <= atras; i++) {
    var p = Utilities.formatDate(new Date(Date.now() - i * 86400000), NOTIF_TZ, 'yyyy-MM-dd').split('-').map(Number);
    dias.push({ anio: p[0], mes: p[1], dia: p[2] });
  }
  return dias;
}

function mesDesplazado_(anio, mes, delta) {
  var d = new Date(anio, mes - 1 + delta, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function normFechaNotif_(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}
function diasEntre_(desde, hasta) {
  var a = normFechaNotif_(desde), b = normFechaNotif_(hasta);
  if (!a || !b) return null;
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
function diasDesdeIngreso_(fecha, hoy) { return diasEntre_(fecha, hoy); }

function listarEmpleadosFirestore_() {
  var lista = [], token = '';
  do {
    var url = notifBaseFirestore_() + '/empleados?pageSize=300&key=' + EVAL_API_KEY_FIREBASE + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('No se pudo leer empleados: ' + res.getContentText().slice(0, 200));
    var d = JSON.parse(res.getContentText());
    (d.documents || []).forEach(function (doc) {
      var e = camposFirestore_(doc.fields || {});
      e.id = String(doc.name.split('/').pop());
      lista.push(e);
    });
    token = d.nextPageToken || '';
  } while (token);
  return lista;
}

// Lectura de evaluaciones con un token de sistema (5 min) firmado con PGRST_JWT_SECRET
function listarEvaluacionesSistema_(desde) {
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  var base = urlHistorico_();
  if (!secreto || !base) return null;
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({
    role: 'tcontrol_lector', eval: true, empleado_id: 'SISTEMA', equipo: [], rrhh: true,
    exp: Math.floor(Date.now() / 1000) + 300
  })).getBytes());
  var token = header + '.' + payload + '.' + b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
  var res = UrlFetchApp.fetch(base + '/rpc/eval_listar', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ p: { modo: 'todas', desde: desde } })
  });
  if (res.getResponseCode() !== 200) return null;
  var r = JSON.parse(res.getContentText());
  return r.ok ? (r.evaluaciones || []) : null;
}

// Cuestionario vigente (plazos, meta) con el mismo token de sistema; null si no está disponible
function configEvaluacionSistema_() {
  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  var base = urlHistorico_();
  if (!secreto || !base) return null;
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({
    role: 'tcontrol_lector', eval: true, empleado_id: 'SISTEMA', equipo: [], rrhh: true,
    exp: Math.floor(Date.now() / 1000) + 300
  })).getBytes());
  var token = header + '.' + payload + '.' + b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
  var res = UrlFetchApp.fetch(base + '/rpc/eval_config', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ p: { modo: 'obtener' } })
  });
  if (res.getResponseCode() !== 200) return null;
  var r = JSON.parse(res.getContentText());
  return r.ok ? r.config : null;
}

function borrarNotificacionesViejas_() {
  var limite = new Date(Date.now() - NOTIF_DIAS_RETENCION * 86400000).toISOString();
  var res = UrlFetchApp.fetch(notifBaseFirestore_() + ':runQuery?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: NOTIF_COLECCION }],
      where: { fieldFilter: { field: { fieldPath: 'creada' }, op: 'LESS_THAN', value: { timestampValue: limite } } },
      limit: 400
    } })
  });
  if (res.getResponseCode() !== 200) return 0;
  var nombres = JSON.parse(res.getContentText()).filter(function (r) { return r.document; }).map(function (r) { return r.document.name; });
  if (!nombres.length) return 0;
  UrlFetchApp.fetch(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ writes: nombres.map(function (n) { return { delete: n }; }) })
  });
  return nombres.length;
}

// ---------------------------------------------------------------- instalación y pruebas
/** Ejecutar una vez desde el editor (▶): activador diario de los recordatorios a las 08:30. */
function instalarRecordatorios() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recordatoriosDiarios') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordatoriosDiarios').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(NOTIF_TZ).create();
  Logger.log('Activador instalado: recordatoriosDiarios todos los días 08:30 (' + NOTIF_TZ + ')');
}

/** Prueba desde el editor: crea un aviso en tu campana y, si pones tu ID, te envía un WhatsApp. */
function probarNotificacion() {
  var miId = '1058'; // ← cambia por tu ID
  var ok = crearNotificacion_({ para: miId, tipo: 'prueba', titulo: 'Notificación de prueba', texto: 'Si ves esto, la campana funciona.', enlace: {} });
  Logger.log('Campana: ' + (ok ? 'aviso creado' : 'no se pudo crear'));
  Logger.log('WhatsApp: ' + JSON.stringify(whatsappA_(miId, 'Prueba de notificaciones de TCONTROL: si te llega este mensaje, el WhatsApp automático funciona.')));
}
