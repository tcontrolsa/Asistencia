/**
 * TCONTROL · Evaluación de desempeño (mensual y seguimiento Día 75)
 *
 * Las evaluaciones se guardan en PostgreSQL (tcontrol_historico, funciones api.eval_*).
 * Este archivo:
 *   1. tokenEvaluacion (solo POST): verifica el PIN del colaborador contra Firestore y emite un
 *      JWT para PostgREST con quién es (empleado_id), a quién evalúa (equipo = colaboradores
 *      cuyo evaluador_id es él), si ve todas (rrhh = supervisor admin) y si es el admin master
 *      (master = 1058: edita el cuestionario, reabre plazos y elimina evaluaciones). Vigencia: 8 horas.
 *   2. guardarEvaluacion (lo llama sync-historico al replicar la cola): escribe o actualiza la
 *      fila de la evaluación en la hoja EVALUACIONES.
 *   3. evalRpc (solo POST): respaldo para equipos o redes que bloquean *.trycloudflare.com.
 *      Reenvía la llamada api.eval_* al PostgREST con el mismo token del colaborador;
 *      PostgREST sigue decidiendo los permisos.
 *
 * Usa el mismo secreto PGRST_JWT_SECRET de Propiedades del script que tokenHistorico.
 * Pendiente fase 1 de seguridad: verificar contra CREDENCIALES (acceso_seguro.gs) en lugar
 * del PIN de Firestore.
 */

var HOJA_EVALUACIONES = 'EVALUACIONES';
var EVAL_PROYECTO_FIRESTORE = 'tcontrol-asistencia';
var EVAL_API_KEY_FIREBASE = 'AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4'; // pública (la usa la PWA)
var EVAL_MAX_INTENTOS = 5;
var EVAL_BLOQUEO_SEG = 15 * 60;
var COLS_EVALUACIONES = [
  'EVALUACION_ID', 'TIPO', 'MES_EVALUADO', 'FECHA_APLICACION', 'ID', 'COLABORADOR', 'AREA', 'CARGO',
  'EVALUADOR_ID', 'EVALUADOR',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14',
  'PUNTAJE', 'PORCENTAJE', 'NIVEL',
  'DOMINIO_TECNICO_%', 'GESTION_TRABAJO_%', 'APRENDIZAJE_%', 'INTEGRACION_%',
  'OBSERVACIONES', 'FORTALEZAS', 'OPORTUNIDADES_MEJORA', 'COMPROMISOS', 'PROXIMA_EVALUACION',
  'ESTADO', 'CONFIRMADA_EN', 'COMENTARIO_COLABORADOR', 'ACTUALIZADO_EN',
  // Desde el cuestionario editable (006_evaluacion_config.sql)
  'CUESTIONARIO_VERSION', 'META_%', 'CUMPLE_META', 'VENCE_CONFIRMAR', 'VIGENTE_HASTA', 'REUNION', 'CALIFICACIONES', 'DIMENSIONES'
];
var EVAL_ADMIN_MASTER = '1058';

// ---------------------------------------------------------------------
// 1. Token de evaluaciones
// ---------------------------------------------------------------------
function emitirTokenEvaluacion(p) {
  var id = String(p.empleadoId || '').trim();
  var pin = String(p.pin || '').trim();
  if (!id || !pin) return { ok: false, error: 'Ingresa tu PIN.' };

  var cache = CacheService.getScriptCache();
  var claveIntentos = 'eval_intentos_' + id;
  var intentos = parseInt(cache.get(claveIntentos) || '0', 10);
  if (intentos >= EVAL_MAX_INTENTOS) {
    return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };
  }

  var emp = leerEmpleadoFirestore_(id);
  if (!emp) return { ok: false, error: 'Colaborador no encontrado.' };
  if (String(emp.activo || 'SI').toUpperCase() === 'NO' || emp.activo === false) {
    return { ok: false, error: 'Colaborador inactivo.' };
  }
  var guardado = String(emp.pin || '').trim();
  var hash = sha256Hex_(pin);
  if (!guardado || (guardado !== hash && guardado !== pin)) {
    cache.put(claveIntentos, String(intentos + 1), EVAL_BLOQUEO_SEG);
    return { ok: false, error: 'PIN incorrecto.' };
  }
  cache.remove(claveIntentos);

  var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
  if (!secreto) return { ok: false, error: 'PGRST_JWT_SECRET no configurado en Propiedades del script' };

  var equipo = equipoDeEvaluador_(id);
  var sup = String(emp.supervisor || emp.rol || '').toUpperCase();
  var master = id === EVAL_ADMIN_MASTER;
  var rrhh = master || sup.indexOf('ADMIN') !== -1;
  var exp = Math.floor(Date.now() / 1000) + 8 * 3600;
  var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(Utilities.newBlob(JSON.stringify({
    role: 'tcontrol_lector', eval: true, empleado_id: id,
    equipo: equipo.map(function (e) { return e.id; }), rrhh: rrhh, master: master, exp: exp
  })).getBytes());
  var firma = b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
  return { ok: true, token: header + '.' + payload + '.' + firma, exp: exp, rrhh: rrhh, master: master, equipo: equipo };
}

function leerEmpleadoFirestore_(id) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + EVAL_PROYECTO_FIRESTORE +
    '/databases/(default)/documents/empleados/' + encodeURIComponent(id) + '?key=' + EVAL_API_KEY_FIREBASE;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  return camposFirestore_(JSON.parse(res.getContentText()).fields || {});
}

// Colaboradores activos cuyo evaluador_id es este evaluador
function equipoDeEvaluador_(id) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + EVAL_PROYECTO_FIRESTORE +
    '/databases/(default)/documents:runQuery?key=' + EVAL_API_KEY_FIREBASE;
  var consulta = {
    structuredQuery: {
      from: [{ collectionId: 'empleados' }],
      where: { fieldFilter: { field: { fieldPath: 'evaluador_id' }, op: 'EQUAL', value: { stringValue: id } } }
    }
  };
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(consulta), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo leer el equipo: ' + res.getContentText().slice(0, 200));
  var equipo = [];
  JSON.parse(res.getContentText()).forEach(function (r) {
    if (!r.document) return;
    var e = camposFirestore_(r.document.fields || {});
    var eid = String(e.id || r.document.name.split('/').pop()).trim();
    if (!eid || eid === id) return;
    if (String(e.activo || 'SI').toUpperCase() === 'NO' || e.activo === false) return;
    var rol = String(e.evaluacion_rol || 'EVALUADO').toUpperCase();
    if (rol.indexOf('EVALUADO') === -1) return;
    equipo.push({ id: eid, nombre: e.nombre || '', area: e.area || '', cargo: e.cargo || '',
                  fecha_ingreso: e.fecha_ingreso || e.fechaIngreso || '', foto_url: e.foto_url || '' });
  });
  return equipo;
}

function camposFirestore_(fields) {
  var o = {};
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = String(v.integerValue);
    else if ('doubleValue' in v) o[k] = String(v.doubleValue);
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
  });
  return o;
}

function sha256Hex_(texto) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ---------------------------------------------------------------------
// 3. Respaldo: la PWA llama a Apps Script y este reenvía a PostgREST
// ---------------------------------------------------------------------
var EVAL_FUNCIONES_PROXY = ['eval_listar', 'eval_guardar', 'eval_confirmar', 'eval_eliminar',
  'eval_config', 'eval_reabrir', 'eval_reunion'];

function proxyEvaluacion(d) {
  var fn = String(d.fn || '');
  if (EVAL_FUNCIONES_PROXY.indexOf(fn) === -1) return { status: 400, body: { ok: false, error: 'Función no permitida' } };
  var token = String(d.token || '');
  if (!token) return { status: 401, body: { ok: false, error: 'Sin token' } };
  var cuerpo = typeof d.p === 'string' ? d.p : JSON.stringify(d.p || {});
  if (cuerpo.length > 20000) return { status: 413, body: { ok: false, error: 'Solicitud demasiado grande' } };

  var base = urlHistorico_();
  if (!base) return { status: 503, body: { ok: false, error: 'Servidor de evaluaciones sin dirección publicada' } };
  var res = UrlFetchApp.fetch(base + '/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: '{"p":' + cuerpo + '}'
  });
  var texto = res.getContentText();
  var body;
  try { body = JSON.parse(texto); } catch (e) { body = { ok: false, error: texto.slice(0, 200) }; }
  return { status: res.getResponseCode(), body: body };
}

// URL del túnel publicada por el contenedor tunel-historico (caché 5 min)
function urlHistorico_() {
  var cache = CacheService.getScriptCache();
  var url = cache.get('eval_url_historico');
  if (url) return url;
  var res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + EVAL_PROYECTO_FIRESTORE +
    '/databases/(default)/documents/configuracion/historico?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  var campos = JSON.parse(res.getContentText()).fields || {};
  url = String((campos.url && campos.url.stringValue) || '').replace(/\/+$/, '');
  if (url) cache.put('eval_url_historico', url, 300);
  return url;
}

// ---------------------------------------------------------------------
// 2. Réplica a la hoja EVALUACIONES (desde la cola de Postgres)
// ---------------------------------------------------------------------
function guardarEvaluacionEnHoja(p) {
  var id = String(p.evaluacionId || '').trim();
  if (!id) return { ok: false, error: 'Falta evaluacionId' };
  var resultado;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var hoja = hojaEvaluaciones_();
    var cal = String(p.calificaciones || '').split(',');
    var obs = [];
    try { obs = JSON.parse(p.observaciones || '[]'); } catch (e) { }
    var dims = {};
    try { dims = JSON.parse(p.dimensiones || '{}'); } catch (e) { }
    var pctDim = function (k) { return dims[k] ? Math.round(dims[k].porcentaje * 1000) / 10 : ''; };
    var notas = [];
    obs.forEach(function (o, i) { if (o) notas.push((i + 1) + ': ' + o); });

    var fila = [
      id, ({ DIA75: 'Día 75', TRIMESTRAL: 'Trimestral' })[p.tipo] || 'Mensual', p.periodo === 'DIA75' ? '' : p.periodo, p.fechaAplicacion,
      p.empleadoId, p.empleadoNombre || '', p.area || '', p.cargo || '', p.evaluadorId, p.evaluadorNombre || ''
    ];
    for (var i = 0; i < 14; i++) fila.push(cal[i] ? Number(cal[i]) : '');
    fila.push(Number(p.puntaje) || 0, Number(p.porcentaje) || 0, p.nivel || '',
      pctDim('tecnico'), pctDim('gestion'), pctDim('aprendizaje'), pctDim('relacional'),
      notas.join('\n'), p.fortalezas || '', p.mejoras || '', p.compromisos || '', p.proximaEvaluacion || '',
      p.estado === 'confirmada' ? 'Confirmada' : 'Enviada', p.confirmadaEn || '', p.comentarioColaborador || '',
      p.actualizadoEn || '',
      p.configVersion || '', p.meta === undefined || p.meta === '' ? '' : Number(p.meta), p.cumpleMeta || '',
      p.venceConfirmar || '', p.vigenteHasta || '', p.reunion || '', String(p.calificaciones || ''),
      typeof p.dimensiones === 'string' ? p.dimensiones : JSON.stringify(p.dimensiones || {}));

    var n = hoja.getLastRow();
    var filaDestino = 0;
    if (n > 1) {
      var ids = hoja.getRange(2, 1, n - 1, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]).trim() === id) { filaDestino = r + 2; break; }
      }
    }
    if (!filaDestino) filaDestino = n + 1;
    // IDs, mes y fechas como texto plano (evita que Sheets convierta "2026-09" en fecha);
    // calificaciones, puntajes y porcentajes quedan numéricos
    hoja.getRange(filaDestino, 1, 1, 10).setNumberFormat('@');
    hoja.getRange(filaDestino, 32, 1, 10).setNumberFormat('@');
    hoja.getRange(filaDestino, 41, 1, 1).setNumberFormat('@');                 // versión del cuestionario
    hoja.getRange(filaDestino, 43, 1, fila.length - 42).setNumberFormat('@');  // textos y fechas
    hoja.getRange(filaDestino, 1, 1, fila.length).setValues([fila.map(function (v) { return v === null || v === undefined ? '' : v; })]);
    resultado = { ok: true, fila: filaDestino };
  } finally {
    lock.releaseLock();
  }
  // Avisos (campana y WhatsApp, notificaciones.gs) fuera del candado; nunca hacen fallar la réplica
  if (p.evento && typeof notificarEvaluacion_ === 'function') {
    try { notificarEvaluacion_(p); } catch (e) { Logger.log('Notificación no enviada: ' + e); }
  }
  return resultado;
}

// Evaluación eliminada en Postgres (desde la cola): se quita su fila de la hoja
function eliminarEvaluacionEnHoja(p) {
  var id = String(p.evaluacionId || '').trim();
  if (!id) return { ok: false, error: 'Falta evaluacionId' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var hoja = hojaEvaluaciones_();
    var n = hoja.getLastRow();
    if (n < 2) return { ok: true, eliminadas: 0 };
    var ids = hoja.getRange(2, 1, n - 1, 1).getValues();
    var eliminadas = 0;
    for (var r = ids.length - 1; r >= 0; r--) {
      if (String(ids[r][0]).trim() === id) { hoja.deleteRow(r + 2); eliminadas++; }
    }
    return { ok: true, eliminadas: eliminadas };
  } finally {
    lock.releaseLock();
  }
}

function hojaEvaluaciones_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(HOJA_EVALUACIONES);
  if (!hoja) {
    hoja = libro.insertSheet(HOJA_EVALUACIONES);
    hoja.setFrozenRows(1);
  }
  // Encabezado (también agrega las columnas nuevas a una hoja creada antes)
  if (hoja.getMaxColumns() < COLS_EVALUACIONES.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), COLS_EVALUACIONES.length - hoja.getMaxColumns());
  var actual = hoja.getRange(1, 1, 1, COLS_EVALUACIONES.length).getValues()[0];
  if (actual.join('|') !== COLS_EVALUACIONES.join('|')) {
    hoja.getRange(1, 1, 1, COLS_EVALUACIONES.length).setValues([COLS_EVALUACIONES]).setFontWeight('bold');
  }
  return hoja;
}

/** Ejecutar desde el editor (▶) para crear la hoja y comprobar el secreto antes de publicar. */
function prepararEvaluaciones() {
  hojaEvaluaciones_();
  if (!PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET')) {
    throw new Error('Falta PGRST_JWT_SECRET en Propiedades del script');
  }
  Logger.log('Hoja ' + HOJA_EVALUACIONES + ' lista y secreto configurado');
}
