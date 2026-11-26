/**
 * TCONTROL · Excedente de la bolsa de 4 horas → vacaciones (regla desde el 2026-11-26)
 *
 * Desde el 26/11/2026 lo que no cubre la bolsa de 4 h del período (atrasos, faltantes, faltas sin justificar,
 * permisos no aprobados: el «T. Descontar» del panel) se acumula contra las vacaciones del colaborador: cada 8 h
 * descuentan 1 día. Cuando ya no tiene saldo de vacaciones, el resto va al rol.
 *
 * Cada noche (05:15) este activador recalcula el período de nómina abierto (26–25) de cada colaborador con el MISMO
 * cálculo del panel (reglas_jornada.gs = copia de JS/reglas_jornada.js) y:
 *   · deja en la hoja VACACIONES_HORAS una fila por día con los minutos cargados a vacaciones (SOLICITUD = JORNADA);
 *     la columna I de CALCULAR_vacaciones ya suma esa hoja (vacaciones_auto.gs), así baja el saldo;
 *   · guarda el reparto en empleados/{id}.cargos_jornada.p<AAAAMMDD> { por_dia: {fecha: {vac, rol}}, … } para que
 *     la app y el panel muestren qué fue a vacaciones y qué al rol.
 * Si un supervisor justifica un día después, la noche siguiente se devuelve ese tiempo. El período queda fijo al
 * cerrarse: desde el día 27 solo se recalcula el período nuevo.
 *
 * Saldo usado (minutos): saldo de CALCULAR_vacaciones (J) sin contar lo cargado por este mismo período, menos las
 * horas que aún no completan un día, menos lo que espera llegar a la hoja (permisos aprobados sin copiar, pedidos
 * con cargo a vacaciones) y menos los días de vacaciones futuros pedidos o aprobados (como JS/permisos.js).
 *
 * Usa: fetchFirestore_ (firestore_servidor.gs), notifBaseFirestore_, valorFirestore_, listarEmpleadosFirestore_
 *      (notificaciones.gs), valorAvisoAlm_ (aviso_almuerzos.gs), procesarAccion (api_completa.gs: registros
 *      archivados y vacaciones), solicitudesPorEstado_ (permisos_escalado.gs), VAC_* (vacaciones_auto.gs).
 *
 * Desde el editor (▶):
 *   revisarCargosJornada()     NO cambia nada: muestra por persona el reparto que se guardaría
 *   calcularCargosJornada()    lo aplica (lo mismo que hace el activador)
 *   instalarCargosJornada()    activador diario 05:15
 */

var CJ_DESDE = '2026-11-26';
var CJ_TZ = 'America/Guayaquil';
var CJ_CLAVE = 'JORNADA';      // columna SOLICITUD de VACACIONES_HORAS
var CJ_SOLO = [];              // para probar: IDs a calcular (vacío = todos)

function calcularCargosJornada() { cargosJornada_(true); }
function revisarCargosJornada() { cargosJornada_(false); }

function instalarCargosJornada() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'calcularCargosJornada') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('calcularCargosJornada').timeBased().everyDays(1).atHour(5).nearMinute(15).inTimezone(CJ_TZ).create();
  Logger.log('Activador instalado: calcularCargosJornada cada día a las 05:15.');
}

function cjFecha_(d) { return Utilities.formatDate(d, CJ_TZ, 'yyyy-MM-dd'); }
function cjDias_(f, n) { var d = new Date(f + 'T12:00:00-05:00'); d.setUTCDate(d.getUTCDate() + n); return cjFecha_(d); }

function cargosJornada_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) { Logger.log('Otra ejecución en curso'); return; }
  try {
    var RJ = window.ReglasJornada;
    cjFuncionesPanel_();
    var hoy = cjFecha_(new Date()), ayer = cjDias_(hoy, -1);
    var per = RJ.periodoDe(ayer);
    var desde = per.inicio > CJ_DESDE ? per.inicio : CJ_DESDE;
    if (ayer < desde) { Logger.log('Aún no hay días desde el ' + CJ_DESDE + ' (ayer: ' + ayer + ')'); return; }
    var clavePer = 'p' + per.inicio.replace(/-/g, '');
    Logger.log('Período ' + per.inicio + ' → ' + per.fin + ' · se cargan los días ' + desde + ' → ' + ayer);

    // ---------- datos (una sola lectura para todos)
    var t0 = Date.now();
    var empleados = listarEmpleadosFirestore_().filter(function (e) {
      var act = String(e.activo == null ? 'SI' : e.activo).toUpperCase() !== 'NO' && e.activo !== false && String(e.estado || '').toUpperCase() !== 'INACTIVO';
      return act && String(e.tipo_personal || '').toUpperCase() !== 'EXTERNO' && String(e.cargo || '').trim().toUpperCase() !== 'SIN ASISTENCIA' &&
        (!CJ_SOLO.length || CJ_SOLO.indexOf(String(e.id)) !== -1);
    });
    var regsPorEmp = cjRegistros_(per.inicio, per.fin);
    var vac = procesarAccion({ accion: 'obtenerVacacionesEmpleado' }) || {};
    var vacsPorEmp = {};
    (vac.vacaciones || []).forEach(function (v) { var id = String(v.empleadoId || '').trim(); (vacsPorEmp[id] = vacsPorEmp[id] || []).push(v); });
    var saldos = vac.kpiVacacionesIndividual || {};
    var sols = cjSolicitudes_();
    window._ajustesDescanso = cjAjustesDescanso_();
    var hojaHoras = vacAsegurarHojaHoras_();
    var filasHoras = hojaHoras.getLastRow() > 1 ? hojaHoras.getRange(2, 1, hojaHoras.getLastRow() - 1, 6).getValues() : [];
    var anioVac = vacAnioActual_();
    Logger.log('Datos leídos en ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + empleados.length + ' colaboradores');

    // ---------- cálculo por persona
    var resultados = [];
    empleados.forEach(function (e) {
      var id = String(e.id);
      var regs = regsPorEmp[id] || [];
      var solsEmp = (sols[id] || []).filter(function (s) {
        return (s.estado === 'APROBADA' && s.tipo === 'PERMISO_PERSONAL') || (s.estado === 'REGISTRADA' && (s.tipo === 'PERMISO_MEDICO' || s.tipo === 'CALAMIDAD')) ||
          (s.estado === 'RECHAZADA' && s.origen) || (s.modalidad === 'HORAS' && (s.estado !== 'CANCELADA' || s.origen));
      });
      var emp = {}; Object.keys(e).forEach(function (k) { emp[k] = e[k]; }); emp.registros = regs;
      var porDia = RJ.armarPorDia({ regs: regs, vacaciones: vacsPorEmp[id] || [], R_INI: per.inicio, R_FIN: per.fin, empleado: emp, verificandoHistorial: false, hoy: hoy });
      var mapa = RJ.calcularBolsa({ empleado: emp, porDia: porDia, hoy: hoy, solicitudes: solsEmp }).porDia;
      var cap = cjCapacidad_(id, saldos[id], filasHoras, per, anioVac, sols[id] || [], hoy);
      var rep = RJ.repartirExcedente(mapa, cap.min, { desde: desde, hasta: ayer });
      resultados.push({ id: id, nombre: e.nombre || '', rep: rep, cap: cap });
    });

    resultados.forEach(function (r) {
      if (r.rep.vac_min || r.rep.rol_min) Logger.log(r.id + ' ' + r.nombre + ': vacaciones ' + r.rep.vac_min + ' min · rol ' + r.rep.rol_min +
        ' min · saldo usado ' + r.cap.min + ' min (' + r.cap.detalle + ')');
    });
    var totV = resultados.reduce(function (s, r) { return s + r.rep.vac_min; }, 0), totR = resultados.reduce(function (s, r) { return s + r.rep.rol_min; }, 0);
    Logger.log('Total: ' + totV + ' min a vacaciones, ' + totR + ' min al rol (' + resultados.filter(function (r) { return r.rep.vac_min || r.rep.rol_min; }).length + ' personas)');
    if (!aplicar) return;

    // ---------- hoja VACACIONES_HORAS: se reemplazan las filas JORNADA de este período de las personas calculadas
    var calculados = {}; resultados.forEach(function (r) { calculados[r.id] = true; });
    var dentro = function (f) { var s = f instanceof Date ? cjFecha_(f) : String(f || ''); return s >= per.inicio && s <= per.fin; };
    var quedan = filasHoras.filter(function (f) { return !(String(f[3]) === CJ_CLAVE && calculados[String(f[1]).trim()] && dentro(f[0])); });
    var ahora = new Date();
    resultados.forEach(function (r) {
      Object.keys(r.rep.por_dia).sort().forEach(function (f) {
        var v = r.rep.por_dia[f].vac;
        if (!v) return;
        var p = f.split('-');
        quedan.push([new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])), r.id, v, CJ_CLAVE, r.nombre, ahora]);
      });
    });
    var antes = filasHoras.length;
    if (antes) hojaHoras.getRange(2, 1, antes, 6).clearContent();
    if (quedan.length) hojaHoras.getRange(2, 1, quedan.length, 6).setValues(quedan);
    SpreadsheetApp.flush();
    Logger.log('VACACIONES_HORAS: ' + antes + ' → ' + quedan.length + ' filas');

    // ---------- ficha: reparto para la app y el panel
    var errores = 0;
    resultados.forEach(function (r) {
      var dato = { inicio: per.inicio, fin: per.fin, desde: desde, hasta: ayer, por_dia: r.rep.por_dia, vac_min: r.rep.vac_min, rol_min: r.rep.rol_min,
        capacidad_min: r.cap.min, calculado_en: ahora.toISOString() };
      if (!cjGuardarEnFicha_(r.id, clavePer, dato)) errores++;
    });
    Logger.log('Fichas actualizadas: ' + (resultados.length - errores) + (errores ? ' · con error: ' + errores : ''));
  } finally {
    lock.releaseLock();
  }
}

// Minutos de vacaciones disponibles para el excedente del período (ver cabecera)
function cjCapacidad_(id, saldo, filasHoras, per, anioVac, solsEmp, hoy) {
  if (!saldo || saldo.restantes === undefined || saldo.restantes === null || isNaN(Number(saldo.restantes))) return { min: 0, detalle: 'sin fila en CALCULAR_vacaciones' };
  var fin = new Date(anioVac, 10, 30, 23, 59, 59), finAnt = new Date(anioVac - 1, 10, 30, 23, 59, 59);
  var propias = filasHoras.filter(function (f) { return String(f[1]).trim() === id && f[0] instanceof Date; });
  var dePeriodo = function (f) { var s = cjFecha_(f[0]); return String(f[3]) === CJ_CLAVE && s >= per.inicio && s <= per.fin; };
  var diasI = function (filas) {
    var hasta = 0, hastaAnt = 0;
    filas.forEach(function (f) { var m = Number(f[2]) || 0; if (f[0] <= fin) hasta += m; if (f[0] <= finAnt) hastaAnt += m; });
    return Math.floor(hasta / VAC_MIN_DIA) - Math.floor(hastaAnt / VAC_MIN_DIA);
  };
  var otras = propias.filter(function (f) { return !dePeriodo(f); });
  var J = Number(saldo.restantes) + diasI(propias) - diasI(otras);        // saldo sin lo cargado por este período
  var enAnio = 0, despues = 0;
  otras.forEach(function (f) { var m = Number(f[2]) || 0; if (f[0] <= fin) enAnio += m; else despues += m; });
  var fraccion = enAnio % VAC_MIN_DIA;                                     // horas que aún no completan un día
  var porLlegar = 0, futuros = 0;
  solsEmp.forEach(function (s) {
    if (['PENDIENTE_JEFE', 'PENDIENTE_TTHH', 'APROBADA'].indexOf(s.estado) === -1) return;
    if (s.tipo === 'VACACIONES') futuros += (s.fechas || []).filter(function (f) { return f > hoy; }).length;
    if (s.tipo === 'PERMISO_PERSONAL') {
      if (s.estado === 'APROBADA') { if (s.vacaciones_hoja !== true) porLlegar += Number(s.cargo_vacaciones_min) || 0; }
      else porLlegar += Number((s.plan_bolsa || {}).vacaciones_min) || 0;
    }
  });
  var min = Math.max(0, J * VAC_MIN_DIA - fraccion - despues - porLlegar - futuros * VAC_MIN_DIA);
  return { min: min, detalle: 'saldo ' + J + ' d − fracción ' + fraccion + ' − diciembre ' + despues + ' − por llegar ' + porLlegar + ' − vacaciones futuras ' + futuros + ' d' };
}

function cjGuardarEnFicha_(id, clavePer, dato) {
  var campo = 'cargos_jornada.' + clavePer;
  var fields = { cargos_jornada: { mapValue: { fields: {} } } };
  fields.cargos_jornada.mapValue.fields[clavePer] = valorFirestore_(dato);
  var res = fetchFirestore_(notifBaseFirestore_() + '/empleados/' + encodeURIComponent(id) + '?updateMask.fieldPaths=' + encodeURIComponent(campo) +
    '&currentDocument.exists=true&key=' + EVAL_API_KEY_FIREBASE, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ fields: fields })
  });
  if (res.getResponseCode() !== 200) { Logger.log('Ficha ' + id + ' no actualizada (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 150)); return false; }
  return true;
}

// ---------------------------------------------------------------- lectura de datos (igual que el panel)
function cjSolicitudes_() {
  var out = {}, token = '';
  do {
    var res = fetchFirestore_(notifBaseFirestore_() + '/solicitudes_permiso?pageSize=300&key=' + EVAL_API_KEY_FIREBASE + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('No se pudieron leer las solicitudes: ' + res.getContentText().slice(0, 200));
    var d = JSON.parse(res.getContentText());
    (d.documents || []).forEach(function (doc) {
      var s = valorAvisoAlm_({ mapValue: { fields: doc.fields || {} } }) || {};
      s.id = doc.name.split('/').pop();
      var id = String(s.empleadoId || '');
      (out[id] = out[id] || []).push(s);
    });
    token = d.nextPageToken || '';
  } while (token);
  return out;
}

function cjAjustesDescanso_() {
  var res = fetchFirestore_(notifBaseFirestore_() + '/configuracion/ajustes_descanso?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return {};
  var d = valorAvisoAlm_({ mapValue: { fields: JSON.parse(res.getContentText()).fields || {} } }) || {};
  return d.dias || {};
}

// Registros del período por colaborador: Firestore + histórico archivado (hoja REGISTROS), con la misma unión del
// panel (FirebaseBackend: archivadosNorm / registrosFirebase): de un día que está en Firestore manda Firestore.
function cjRegistros_(ini, fin) {
  var CAMPOS = ['empleadoId', 'id_empleado', 'fecha', 'tipo', 'hora', 'timestamp', 'almuerzo', 'modo', 'modo_trabajo', 'dispositivo', 'estado',
    'razon_ausencia', 'razon_justificac', 'razon_permiso', 'razon_salida', 'razon_salida_temprana', 'razon_entrada_tardia', 'quien_justifica',
    'quien_justifica_entrada', 'tipo_salida', 'justificado', 'justificada', 'observacion', 'horasExtra', 'autoriza',
    'permiso_personal_mins', 'permiso_medico_mins', 'tiempo_justificado_mins'];
  var mask = CAMPOS.map(function (c) { return 'mask.fieldPaths=' + c; }).join('&');
  var fs = [], token = '';
  do {
    var res = fetchFirestore_(notifBaseFirestore_() + '/registros?pageSize=1000&' + mask + '&key=' + EVAL_API_KEY_FIREBASE + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('No se pudieron leer los registros: ' + res.getContentText().slice(0, 200));
    var d = JSON.parse(res.getContentText());
    (d.documents || []).forEach(function (doc) {
      var r = valorAvisoAlm_({ mapValue: { fields: doc.fields || {} } }) || {};
      r.id = doc.name.split('/').pop();
      r = cjProcesarDoc_(r);
      r.empleadoId = String(r.empleadoId || r.id_empleado || '').trim();
      r.fecha = cjNormFecha_(r.fecha);
      r.hora = cjLimpiarHora_(r.hora);
      r.tiempo_justificado_mins = Number(r.tiempo_justificado_mins || 0);
      r.permiso_personal_mins = Number(r.permiso_personal_mins || 0);
      r.permiso_medico_mins = Number(r.permiso_medico_mins || 0);
      if (r.timestamp) cjFechaHoraDeTimestamp_(r);
      if (r.empleadoId && r.fecha >= ini && r.fecha <= fin) fs.push(r);
    });
    token = d.nextPageToken || '';
  } while (token);

  var arch = (procesarAccion({ accion: 'obtenerRegistrosArchivados' }) || {}).registros || [];
  var archNorm = [];
  arch.forEach(function (reg) {
    var n = {
      id: 'arch_' + reg.empleadoId + '_' + reg.fecha + '_' + reg.tipo,
      empleadoId: String(reg.empleadoId || '').trim(), fecha: cjNormFecha_(reg.fecha), tipo: String(reg.tipo || '').toUpperCase(),
      hora: cjLimpiarHora_(reg.hora), almuerzo: reg.almuerzo || '', modo: reg.modo || 'OFICINA', dispositivo: reg.dispositivo || '',
      timestamp: reg.timestamp || '', razon_salida: reg.razon_salida || reg.razonSalidaTemprana || '',
      quien_justifica: reg.quien_justifica || reg.quienJustifica || '', razon_entrada_tardia: reg.razon_entrada_tardia || reg.razonEntradaTardia || '',
      quien_justifica_entrada: reg.quien_justifica_entrada || reg.quienJustificaEntrada || '', tipo_salida: reg.tipo_salida || reg.tipoSalida || '',
      razon_permiso: reg.razon_permiso || reg.razonPermiso || '', horasExtra: reg.horasExtra || '', autoriza: reg.autoriza || '',
      justificado: reg.justificado || '', razon_justificac: reg.razon_justificac || '',
      permiso_personal_mins: Number(reg.permiso_personal_mins || 0), permiso_medico_mins: Number(reg.permiso_medico_mins || 0),
      tiempo_justificado_mins: Number(reg.tiempo_justificado_mins || 0)
    };
    if (n.timestamp) cjFechaHoraDeTimestamp_(n);
    if (n.fecha && n.empleadoId && n.fecha >= ini && n.fecha <= fin) archNorm.push(n);
  });

  // Enriquecer Firestore con datos del histórico y sumar los días que solo están archivados
  var porTipo = {}, porFecha = {};
  archNorm.forEach(function (a) {
    var kt = a.empleadoId + '|' + a.fecha + '|' + a.tipo, kf = a.empleadoId + '|' + a.fecha;
    if (!porTipo[kt]) porTipo[kt] = a;
    if (!porFecha[kf]) porFecha[kf] = a;
  });
  fs.forEach(function (rf) {
    var a = porTipo[rf.empleadoId + '|' + rf.fecha + '|' + String(rf.tipo || '').toUpperCase()] || (rf.tipo === 'ENTRADA' ? porFecha[rf.empleadoId + '|' + rf.fecha] : null);
    if (!a) return;
    if (a.tiempo_justificado_mins) rf.tiempo_justificado_mins = a.tiempo_justificado_mins;
    if (a.permiso_personal_mins) rf.permiso_personal_mins = a.permiso_personal_mins;
    if (a.permiso_medico_mins) rf.permiso_medico_mins = a.permiso_medico_mins;
    if (a.razon_permiso && !rf.razon_permiso) rf.razon_permiso = a.razon_permiso;
    if (a.razon_salida && !rf.razon_salida) rf.razon_salida = a.razon_salida;
    if (a.razon_entrada_tardia && !rf.razon_entrada_tardia) rf.razon_entrada_tardia = a.razon_entrada_tardia;
    if (a.justificado && !rf.justificado) rf.justificado = a.justificado;
    if (a.razon_justificac && !rf.razon_justificac) rf.razon_justificac = a.razon_justificac;
  });
  var enFirestore = {};
  fs.forEach(function (r) { enFirestore[r.empleadoId + '|' + r.fecha] = true; });
  var todos = fs.concat(archNorm.filter(function (r) { return !enFirestore[r.empleadoId + '|' + r.fecha]; }));
  var out = {};
  todos.forEach(function (r) {
    var v = String(r.almuerzo || '').trim().toUpperCase();
    r.almuerzo = (v === 'SI' || v === 'SÍ' || v === 'PLANTA') ? 'SI' : ((v === 'NO' || v === 'FUERA') ? 'NO' : '');
    (out[r.empleadoId] = out[r.empleadoId] || []).push(r);
  });
  return out;
}

// ---------------------------------------------------------------- copias de FirebaseBackend (JS/firebase_backend.js)
function cjProcesarDoc_(res) {
  if (res.timestamp) cjFechaHoraDeTimestamp_(res);
  var t = String(res.tipo || '').toUpperCase().trim();
  var ordinaria = t !== 'TRABAJO_DE_CAMPO' && t !== 'SALIDA_A_CAMPO' &&
    ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'ENTRADA_CAMPO', 'SALIDA_CAMPO', 'RETORNO_CAMPO'].indexOf(t) !== -1;
  if (!ordinaria) {
    if (!res.hora) res.hora = '00:00:00';
    if (!res.razon_ausencia) {
      res.razon_ausencia = { VACACIONES: 'Vacación', VACACION: 'Vacación', PERMISO_MEDICO: 'Permiso Médico', PERMISO_PERSONAL: 'Permiso Personal',
        CALAMIDAD_DOMESTICA: 'Calamidad Doméstica', TRABAJO_DE_CAMPO: 'Salida a Campo', SALIDA_A_CAMPO: 'Salida a Campo',
        FALTA_JUSTIFICADA: 'Falta Justificada', SALIDA_JUSTIFICADA: 'Salida Justificada' }[t] || res.tipo;
    }
    if (!res.justificado) res.justificado = 'SI';
  }
  return res;
}

function cjNormFecha_(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) return cjFecha_(val);
  var s = String(val).trim(), m;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);
}

function cjLimpiarHora_(hora) {
  if (!hora) return '';
  if (hora instanceof Date && !isNaN(hora.getTime())) return Utilities.formatDate(hora, CJ_TZ, 'HH:mm:ss');
  var h = String(hora).trim(), m;
  if (/^\d{4}-\d{2}-\d{2}T/.test(h) || h.indexOf('Z') !== -1) {
    var d = new Date(h);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, CJ_TZ, 'HH:mm:ss');
  }
  if ((m = h.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/))) {
    var p = m[1].split(':');
    return ('0' + p[0]).slice(-2) + ':' + ('0' + p[1]).slice(-2) + ':' + ('0' + (p[2] || '00')).slice(-2);
  }
  return h;
}

// Fecha y hora locales desde el timestamp (manda sobre los campos fecha/hora, como en el panel)
function cjFechaHoraDeTimestamp_(item) {
  var ts = item.timestamp, d = null, m;
  if (ts instanceof Date) d = ts;
  else if (typeof ts === 'string') {
    var s = ts.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s) || s.indexOf('Z') !== -1 || s.indexOf('GMT') !== -1) {
      var p = new Date(s);
      if (!isNaN(p.getTime())) d = p;
    } else if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[,\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/))) {
      item.fecha = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
      item.hora = ('0' + m[4]).slice(-2) + ':' + ('0' + m[5]).slice(-2) + ':' + ('0' + (m[6] || '0')).slice(-2);
      return item;
    } else if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[,\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/))) {
      item.fecha = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
      item.hora = ('0' + m[4]).slice(-2) + ':' + ('0' + m[5]).slice(-2) + ':' + ('0' + (m[6] || '0')).slice(-2);
      return item;
    }
  }
  if (d) {
    item.fecha = cjFecha_(d);
    item.hora = Utilities.formatDate(d, CJ_TZ, 'HH:mm:ss');
  }
  return item;
}

// Funciones del panel que usa reglas_jornada (cumpleaños): copias de JS/supervisor/supervisor_directorio.js
function cjFuncionesPanel_() {
  window.obtenerFechaNacimientoEmpleado = function (emp) {
    if (!emp) return '';
    var v = emp.fechaNacimiento || emp.fecha_nacimiento || emp.fNacimiento || emp.fechanacimiento || '';
    if (v instanceof Date && !isNaN(v)) return cjFecha_(v);
    return String(v || '').trim();
  };
  window.normalizarFechaParaInput = function (val) {
    if (!val) return '';
    var s = String(val).trim().split('T')[0], p;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.indexOf('/') !== -1) {
      p = s.split('/');
      if (p.length === 3 && p[2].length === 4) return p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2);
      if (p.length === 3 && p[0].length === 4) return p[0] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[2]).slice(-2);
    }
    if (s.indexOf('-') !== -1) {
      p = s.split('-');
      if (p.length === 3 && p[2].length === 4) return p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2);
    }
    return s;
  };
  window.getLocalHoyStr = function () { return cjFecha_(new Date()); };
}
