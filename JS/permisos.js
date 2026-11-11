/**
 * TCONTROL · Solicitudes de permisos y vacaciones (fase 1 del flujo de permisos, 2026-11-10)
 * Compartido por index.html (app → Permisos) y supervisor.html (panel → Permisos).
 *
 * Flujo (docs/Flujo permisos.pdf, versión corregida):
 *   Vacaciones y permiso personal → solicitud digital → aprueba el jefe inmediato (empleados.jefe_inmediato_id).
 *     Sin jefe asignado, jefe inactivo o jefe = el mismo colaborador → pasa directo a TTHH.
 *     Sin respuesta del jefe en 8 horas laborables → pasa a TTHH (lo hace Apps Script: permisos_escalado.gs).
 *     Vacaciones sin saldo suficiente: se permite si el colaborador acepta el descuento al rol.
 *   Permiso médico y calamidad → no se aprueban: se registran al instante y se avisa al jefe y a TTHH.
 *     Los documentos (72 h) y el descuento al rol llegan en la fase 3.
 *   Al aprobarse (o registrarse) una solicitud por días se crean los registros de ausencia en asistencia
 *   (FirebaseBackend.guardarRegistro, igual que el registro de ausencias del supervisor). Calamidad se
 *   registra como FALTA_JUSTIFICADA con la razón «CALAMIDAD DOMÉSTICA». Los permisos por horas no crean
 *   registro: el colaborador marca su salida y su regreso como siempre.
 *
 * Datos (Firestore):
 *   solicitudes_permiso/{auto}  ver crearSolicitud()
 *   configuracion/permisos      { tthh: [{id, nombre}], actualizado_por, actualizado_en }
 * Avisos: campana (colección notificaciones, enlace {modulo:'permisos', id}) y WhatsApp (OpenWAService).
 *
 * Uso: Permisos.montarApp(contenedor, { empleado, enlace })
 *      Permisos.montarPanel(contenedor, { usuario: {id, nombre}, admin: bool, enlace })
 *      Permisos.contarPorAprobar(id) → número para la insignia del menú
 */
(function () {
  'use strict';

  const COL = 'solicitudes_permiso';
  const CFG_DOC = ['configuracion', 'permisos'];
  const MIN_ESCALADO = 8 * 60;              // 8 horas laborables
  const JORNADA = { ini: 7 * 60 + 30, fin: 16 * 60 + 15 };   // 07:30–16:15 (HORA_ENTRADA_REF / HORA_SALIDA_REF)
  const DIAS_ATRAS_CALAMIDAD = 30;
  const FERIADOS_MD = ['1/1', '2/16', '2/17', '4/3', '4/30', '5/1', '5/25', '8/10', '10/9', '11/2', '11/3', '12/6', '12/25'];
  const FERIADOS_FECHA = ['2026-06-26'];

  const TIPOS = {
    VACACIONES: { label: 'Vacaciones', icono: 'fa-umbrella-beach', color: 'pm-c-azul', aprobacion: true, modalidades: ['DIAS'], registro: 'VACACIONES',
      ayuda: 'Días completos. Los aprueba tu jefe inmediato.' },
    PERMISO_PERSONAL: { label: 'Permiso personal', icono: 'fa-user-clock', color: 'pm-c-violeta', aprobacion: true, modalidades: ['HORAS', 'DIAS'], registro: 'PERMISO_PERSONAL',
      ayuda: 'Por horas o días. Lo aprueba tu jefe inmediato.' },
    PERMISO_MEDICO: { label: 'Permiso médico', icono: 'fa-notes-medical', color: 'pm-c-verde', aprobacion: false, modalidades: ['HORAS', 'DIAS'], registro: 'PERMISO_MEDICO',
      ayuda: 'Se registra al instante. Entrega el certificado a TTHH en 72 h.' },
    CALAMIDAD: { label: 'Calamidad doméstica', icono: 'fa-exclamation-circle', color: 'pm-c-rojo', aprobacion: false, modalidades: ['DIAS'], registro: 'FALTA_JUSTIFICADA',
      ayuda: 'Puede registrarse después. Entrega los documentos a TTHH en 72 h.' }
  };
  const ESTADOS = {
    PENDIENTE_JEFE: { txt: 'Espera a tu jefe', txtAprob: 'Por aprobar', clase: 'pm-e-pend' },
    PENDIENTE_TTHH: { txt: 'Espera a TTHH', txtAprob: 'Por aprobar (TTHH)', clase: 'pm-e-tthh' },
    APROBADA: { txt: 'Aprobada', clase: 'pm-e-ok' },
    RECHAZADA: { txt: 'No aprobada', clase: 'pm-e-no' },
    CANCELADA: { txt: 'Cancelada', clase: 'pm-e-gris' },
    REGISTRADA: { txt: 'Registrada', clase: 'pm-e-ok' }
  };
  const PENDIENTES = ['PENDIENTE_JEFE', 'PENDIENTE_TTHH'];
  const MIN_DIA = 480;   // 8 h = 1 día de vacaciones
  // Concordancia: «Vacaciones aprobadas», «Permiso médico aprobado», «Calamidad doméstica registrada»
  const part = (T, raiz) => raiz + ({ VACACIONES: "as", CALAMIDAD: "a" }[Object.keys(TIPOS).find(k => TIPOS[k] === T)] || "o");

  // ---------------------------------------------------------------- utilidades
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const db = () => window.firebase.firestore();
  const pad = n => String(n).padStart(2, '0');
  const fechaStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoyStr = () => fechaStr(new Date());
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const fechaLarga = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };
  const minutosDe = h => { const m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : NaN; };
  const durTxt = min => { const h = Math.floor(min / 60), m = min % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; };
  const nombreCorto = n => String(n || '').split(/\s+/).slice(0, 3).join(' ');
  const ahoraIso = () => new Date().toISOString();
  const tsMs = t => t && t.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0);
  const horaIso = iso => iso ? new Date(iso).toLocaleString('es-EC', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  function toast(msg, tipo = 'info') {
    if (typeof window.mostrarToast === 'function') return window.mostrarToast(msg, tipo);
    if (typeof window.showToast === 'function') return window.showToast(msg, tipo);
  }

  function esLaborable(f) {
    const d = new Date(f + 'T12:00:00');
    const dia = d.getDay();
    if (dia === 0 || dia === 6) return false;
    if (FERIADOS_FECHA.includes(f)) return false;
    return !FERIADOS_MD.includes(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  function fechasLaborables(desde, hasta) {
    const out = [];
    const d = new Date(desde + 'T12:00:00'), fin = new Date(hasta + 'T12:00:00');
    for (let i = 0; d <= fin && i < 400; i++) {
      const f = fechaStr(d);
      if (esLaborable(f)) out.push(f);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // Momento en que vence el plazo del jefe: 8 horas dentro de la jornada (L–V 07:30–16:15, sin feriados)
  function sumarMinutosLaborables(inicio, minutos) {
    let t = new Date(inicio.getTime());
    let resto = minutos;
    const aMin = (d, m) => { const x = new Date(d.getTime()); x.setHours(Math.floor(m / 60), m % 60, 0, 0); return x; };
    const diaSiguiente = d => { const x = new Date(d.getTime()); x.setDate(x.getDate() + 1); return aMin(x, JORNADA.ini); };
    for (let i = 0; i < 90 && resto > 0; i++) {
      if (!esLaborable(fechaStr(t))) { t = diaSiguiente(t); continue; }
      const ini = aMin(t, JORNADA.ini), fin = aMin(t, JORNADA.fin);
      if (t < ini) t = ini;
      if (t >= fin) { t = diaSiguiente(t); continue; }
      const disp = (fin - t) / 60000;
      if (disp >= resto) return new Date(t.getTime() + resto * 60000);
      resto -= disp;
      t = diaSiguiente(t);
    }
    return t;
  }

  // ---------------------------------------------------------------- configuración (lista TTHH)
  let _cfg = null, _cfgEn = 0;
  async function leerConfig(forzar = false) {
    if (!forzar && _cfg && Date.now() - _cfgEn < 60000) return _cfg;
    try {
      const snap = await db().collection(CFG_DOC[0]).doc(CFG_DOC[1]).get();
      const d = snap.exists ? snap.data() : {};
      _cfg = { tthh: Array.isArray(d.tthh) ? d.tthh.filter(x => x && x.id).map(x => ({ id: String(x.id), nombre: x.nombre || '' })) : [] };
    } catch (e) {
      console.warn('Permisos: configuración no leída', e);
      _cfg = _cfg || { tthh: [] };
    }
    _cfgEn = Date.now();
    return _cfg;
  }
  async function esTTHH(id) {
    const c = await leerConfig();
    return c.tthh.some(x => x.id === String(id));
  }
  async function guardarTTHH(lista, quien) {
    const tthh = lista.map(x => ({ id: String(x.id), nombre: x.nombre || '' }));
    await db().collection(CFG_DOC[0]).doc(CFG_DOC[1]).set({ tthh, actualizado_por: quien || '', actualizado_en: ahoraIso() }, { merge: true });
    _cfg = { tthh };
    _cfgEn = Date.now();
  }

  // ---------------------------------------------------------------- empleados
  async function leerEmpleado(id) {
    if (!id) return null;
    try {
      const snap = await db().collection('empleados').doc(String(id)).get();
      return snap.exists ? Object.assign({ id: String(id) }, snap.data()) : null;
    } catch (e) { return null; }
  }
  const activo = e => e && String(e.activo == null ? 'SI' : e.activo).toUpperCase() !== 'NO' && e.activo !== false && String(e.estado || '').toUpperCase() !== 'INACTIVO';

  // Jefe que aprueba: el jefe inmediato de la ficha; si no aplica, null (la solicitud va a TTHH) con el motivo
  async function aprobadorDe(emp) {
    const jefeId = String((emp && emp.jefe_inmediato_id) || '').trim();
    if (!jefeId) return { jefe: null, motivo: 'sin_jefe' };
    if (jefeId === String(emp.id)) return { jefe: null, motivo: 'propio' };
    const jefe = await leerEmpleado(jefeId);
    if (!jefe || !activo(jefe)) return { jefe: null, motivo: 'jefe_inactivo' };
    return { jefe, motivo: '' };
  }
  const MOTIVO_TTHH = { sin_jefe: 'No tienes jefe inmediato asignado', propio: 'Tu ficha te tiene como tu propio jefe', jefe_inactivo: 'Tu jefe inmediato no está activo', sin_respuesta: 'El jefe no respondió en 8 horas laborables' };
  // Lo mismo dicho a TTHH o al jefe (tercera persona)
  const MOTIVO_TTHH_3 = { sin_jefe: "No tiene jefe inmediato asignado", propio: "Su ficha lo tiene como su propio jefe", jefe_inactivo: "Su jefe inmediato no está activo", sin_respuesta: "El jefe no respondió en 8 horas laborables" };

  // Saldo de vacaciones (hoja CALCULAR_vacaciones, columna J) menos los días de vacaciones futuros ya pedidos o aprobados.
  // También devuelve la lista de días de vacaciones (la usa el cálculo de la bolsa) y la capacidad en minutos para
  // cargar horas de permiso personal (fase 2): J × 480 − la fracción de horas ya sincronizadas que aún no completa
  // un día − las horas cargadas que todavía no llegan a la hoja (o están pedidas) − los días futuros comprometidos.
  async function saldoVacaciones(emp, excluirId = '') {
    let restantes = null, vacaciones = [];
    try {
      const pedir = typeof window.jsonpRequest === 'function' ? window.jsonpRequest
        : (window.FirebaseBackend && window.FirebaseBackend.procesarAccion ? p => window.FirebaseBackend.procesarAccion(p) : null);
      if (pedir) {
        const r = await pedir({ accion: 'obtenerVacacionesEmpleado', empleadoId: emp.id, force: true });
        if (r && !r.error) {
          vacaciones = (r.vacaciones || []).filter(v => String(v.empleadoId || v.id || '').trim() === String(emp.id));
          if (r.vacacionesRestantesHoy !== null && r.vacacionesRestantesHoy !== undefined && r.vacacionesRestantesHoy !== '' && r.vacacionesRestantesHoy !== '--') restantes = Number(r.vacacionesRestantesHoy);
          else {
            const kpi = r.kpiVacacionesIndividual || window.kpiVacacionesIndividual || {};
            const info = typeof window.buscarVacacionesEnKpiIndiv === 'function' ? window.buscarVacacionesEnKpiIndiv(emp, kpi) : kpi[emp.id];
            if (info && info.restantes !== undefined && info.restantes !== null && info.restantes !== '') restantes = Number(info.restantes);
          }
        }
      }
    } catch (e) { console.warn('Permisos: saldo de vacaciones no leído', e); }
    if (restantes === null || isNaN(restantes)) return null;
    const hoy = hoyStr();
    const pv = periodoVacacionesDe(hoy);
    let comprometidos = 0, sincronizadas = 0, pendientesHoja = 0;
    try {
      const snap = await db().collection(COL).where('empleadoId', '==', String(emp.id)).get();
      snap.forEach(doc => {
        const s = doc.data();
        if (doc.id === excluirId || !['PENDIENTE_JEFE', 'PENDIENTE_TTHH', 'APROBADA'].includes(s.estado)) return;
        if (s.tipo === 'VACACIONES') comprometidos += (s.fechas || []).filter(f => f > hoy).length;
        if (s.tipo !== 'PERMISO_PERSONAL' || s.desde < pv.inicio || s.desde > pv.fin) return;
        // Horas cargadas a vacaciones: aprobadas (ya en la hoja o por llegar) y las pedidas que aún esperan
        const min = s.estado === 'APROBADA' ? Number(s.cargo_vacaciones_min || 0) : Number((s.plan_bolsa || {}).vacaciones_min || 0);
        if (s.estado === 'APROBADA' && s.vacaciones_hoja) sincronizadas += min; else pendientesHoja += min;
      });
    } catch (e) { }
    const disponible = restantes - comprometidos;
    const capacidadMin = Math.max(0, disponible * MIN_DIA - (sincronizadas % MIN_DIA) - pendientesHoja);
    return { restantes, comprometidos, disponible, vacaciones, capacidadMin, horasAcumuladasMin: sincronizadas + pendientesHoja };
  }

  // ---------------------------------------------------------------- fase 2: bolsa de 4 h y cargo a vacaciones
  // Año de vacaciones: 1/dic del año anterior → 30/nov (vacaciones_auto.gs)
  function periodoVacacionesDe(f) {
    const d = new Date(f + 'T12:00:00');
    const anio = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    return { inicio: `${anio - 1}-12-01`, fin: `${anio}-11-30` };
  }

  // Registros del colaborador con el historial archivado (mismos datos que el detalle del panel)
  async function registrosDe(empId) {
    const FB = window.FirebaseBackend;
    if (!FB || typeof FB.obtenerRegistros !== 'function') throw new Error('No se pudieron leer tus marcaciones');
    const regs = await FB.obtenerRegistros({ empleadoId: String(empId), incluirArchivados: true });
    return Array.isArray(regs) ? regs : [];
  }

  /**
   * Reparte un permiso personal entre la bolsa de 4 h del período, las vacaciones y el rol (fase 2).
   * Bolsa: saldo real del período en curso (ReglasJornada, mismo cálculo del panel) menos lo que ya tienen
   * reservado otros permisos personales futuros (pedidos, o aprobados por horas: los aprobados por días ya
   * tienen su registro). Períodos futuros empiezan con 4 h. Lo que no cabe va a vacaciones hasta la
   * capacidad en minutos; el resto se descuenta del rol.
   * Devuelve { bolsa_min, vacaciones_min, rol_min, bolsa_por_dia, vacaciones_por_dia, rol_por_dia, saldos, capacidad_vac_min }
   */
  async function planBolsa(emp, { modalidad, fechas, desde, minutos }, excluirId = '') {
    if (!window.ReglasJornada) throw new Error('Falta el cálculo de la bolsa (reglas_jornada.js)');
    const RJ = window.ReglasJornada;
    const hoy = hoyStr();
    const necesidad = {};
    if (modalidad === 'HORAS') necesidad[desde] = minutos; else fechas.forEach(f => { necesidad[f] = MIN_DIA; });

    const FB = window.FirebaseBackend;
    if (!window._ajustesDescanso && FB && typeof FB.cargarAjustesDescanso === 'function') await FB.cargarAjustesDescanso();
    const [regs, vac, otras] = await Promise.all([
      registrosDe(emp.id),
      saldoVacaciones(emp, excluirId),
      db().collection(COL).where('empleadoId', '==', String(emp.id)).get()
    ]);
    const solicitudes = otras.docs.map(d => Object.assign({ id: d.id }, d.data()));

    // Saldo de la bolsa por período (26–25)
    const saldos = {}, iniciales = {};
    const perHoy = RJ.periodoDe(hoy);
    const saldoPeriodo = per => {
      if (saldos[per.inicio] !== undefined) return saldos[per.inicio];
      let s;
      if (per.inicio === perHoy.inicio) {
        s = RJ.saldoBolsaPeriodo({ empleado: Object.assign({}, emp, { registros: regs }), registros: regs, vacaciones: (vac && vac.vacaciones) || [], hoy, solicitudes }).saldo;
      } else {
        s = per.inicio > perHoy.inicio && !RJ.esEmpleadoPasante(emp) ? RJ.BOLSA_MIN : 0;
      }
      // Reservado por otros permisos personales de hoy en adelante
      solicitudes.forEach(o => {
        if (o.id === excluirId || o.tipo !== 'PERMISO_PERSONAL') return;
        const pend = PENDIENTES.includes(o.estado);
        const aprobHoras = o.estado === 'APROBADA' && o.modalidad === 'HORAS';
        if (!pend && !aprobHoras) return;
        const porDia = aprobHoras ? (o.bolsa_por_dia || {}) : ((o.plan_bolsa || {}).bolsa_por_dia || {});
        Object.keys(porDia).forEach(f => { if (f >= hoy && f >= per.inicio && f <= per.fin) s -= Number(porDia[f]) || 0; });
      });
      saldos[per.inicio] = Math.max(0, s);
      iniciales[per.inicio] = saldos[per.inicio];
      return saldos[per.inicio];
    };

    let capacidad = vac ? vac.capacidadMin : 0;
    const plan = { bolsa_por_dia: {}, vacaciones_por_dia: {}, rol_por_dia: {}, bolsa_min: 0, vacaciones_min: 0, rol_min: 0 };
    Object.keys(necesidad).sort().forEach(f => {
      const per = RJ.periodoDe(f);
      saldoPeriodo(per);
      let falta = necesidad[f];
      const deBolsa = Math.min(saldos[per.inicio], falta);
      saldos[per.inicio] -= deBolsa; falta -= deBolsa;
      const deVac = Math.min(capacidad, falta);
      capacidad -= deVac; falta -= deVac;
      if (deBolsa) plan.bolsa_por_dia[f] = deBolsa;
      if (deVac) plan.vacaciones_por_dia[f] = deVac;
      if (falta) plan.rol_por_dia[f] = falta;
      plan.bolsa_min += deBolsa; plan.vacaciones_min += deVac; plan.rol_min += falta;
    });
    plan.periodo = RJ.periodoDe(desde);
    plan.saldo_bolsa_inicial = iniciales[plan.periodo.inicio] || 0;
    plan.saldo_vacaciones_dias = vac ? vac.disponible : null;
    plan.capacidad_vac_min = vac ? vac.capacidadMin : 0;
    plan.calculado_en = ahoraIso();
    return plan;
  }

  // ---------------------------------------------------------------- solicitudes
  /**
   * p: { emp (ficha), tipo, modalidad 'DIAS'|'HORAS', desde, hasta, horaDesde, horaHasta, motivo,
   *      aceptaDescuento, diasSinSaldo, creadoPor: {id, nombre, rol 'COLABORADOR'|'JEFE'|'TTHH'} }
   */
  async function crearSolicitud(p) {
    const T = TIPOS[p.tipo];
    if (!T) return { error: 'Elige el tipo de solicitud' };
    const emp = p.emp;
    if (!emp || !emp.id) return { error: 'Colaborador no identificado' };
    const modalidad = T.modalidades.includes(p.modalidad) ? p.modalidad : T.modalidades[0];
    const motivo = String(p.motivo || '').trim().slice(0, 400);
    const hoy = hoyStr();
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const desde = String(p.desde || ''), hasta = modalidad === 'HORAS' ? desde : String(p.hasta || '');
    if (!re.test(desde) || !re.test(hasta)) return { error: 'Selecciona las fechas' };
    if (hasta < desde) return { error: 'La fecha final no puede ser anterior a la inicial' };
    if (p.tipo === 'CALAMIDAD') {
      const limite = new Date(); limite.setDate(limite.getDate() - DIAS_ATRAS_CALAMIDAD);
      if (desde < fechaStr(limite)) return { error: `La calamidad se puede registrar hasta ${DIAS_ATRAS_CALAMIDAD} días después` };
    } else if (p.tipo === 'PERMISO_MEDICO') {
      const limite = new Date(); limite.setDate(limite.getDate() - 3);
      if (desde < fechaStr(limite)) return { error: 'El permiso médico se registra hasta 3 días después' };
    } else if (desde < hoy) {
      return { error: 'La fecha no puede ser anterior a hoy' };
    }
    const fechas = fechasLaborables(desde, hasta);
    if (!fechas.length) return { error: 'El rango elegido no tiene días laborables' };
    if (fechas.length > 60) return { error: 'La solicitud no puede superar 60 días laborables' };
    let minutos = 0, horaDesde = '', horaHasta = '';
    if (modalidad === 'HORAS') {
      horaDesde = String(p.horaDesde || ''); horaHasta = String(p.horaHasta || '');
      const a = minutosDe(horaDesde), b = minutosDe(horaHasta);
      if (isNaN(a) || isNaN(b)) return { error: 'Indica la hora de salida y de regreso' };
      if (b <= a) return { error: 'La hora de regreso debe ser posterior a la de salida' };
      minutos = b - a;
    }
    if (!motivo && p.tipo !== 'VACACIONES') return { error: 'Escribe el motivo' };

    // No se puede pedir dos veces el mismo día (salvo permisos por horas en horas distintas)
    const previas = await db().collection(COL).where('empleadoId', '==', String(emp.id)).get();
    let choque = null;
    previas.forEach(doc => {
      const s = doc.data();
      if (choque || ['RECHAZADA', 'CANCELADA'].includes(s.estado)) return;
      const comunes = (s.fechas || []).filter(f => fechas.includes(f));
      if (!comunes.length) return;
      if (modalidad === 'HORAS' && s.modalidad === 'HORAS') {
        const a1 = minutosDe(horaDesde), b1 = minutosDe(horaHasta), a2 = minutosDe(s.hora_desde), b2 = minutosDe(s.hora_hasta);
        if (b1 <= a2 || b2 <= a1) return;
      }
      choque = { s, f: comunes[0] };
    });
    if (choque) return { error: `Ya tienes ${TIPOS[choque.s.tipo] ? TIPOS[choque.s.tipo].label.toLowerCase() : 'una solicitud'} el ${fechaCorta(choque.f)} (${(ESTADOS[choque.s.estado] || {}).txt || choque.s.estado})` };

    const ahora = new Date();
    const quien = p.creadoPor || { id: String(emp.id), nombre: emp.nombre || '', rol: 'COLABORADOR' };
    const sol = {
      empleadoId: String(emp.id), nombre: emp.nombre || '', area: emp.area || '', cargo: emp.cargo || '',
      tipo: p.tipo, modalidad, desde, hasta, fechas, dias: modalidad === 'DIAS' ? fechas.length : 0,
      hora_desde: horaDesde, hora_hasta: horaHasta, minutos,
      motivo,
      creada: firebase.firestore.Timestamp.fromDate(ahora), creada_en: ahora.toISOString(),
      creada_por: { id: String(quien.id), nombre: quien.nombre || '', rol: quien.rol || 'COLABORADOR' },
      historial: [{ en: ahora.toISOString(), quien: quien.nombre || String(quien.id), accion: 'CREADA' }],
      aprobador_id: '', aprobador_nombre: '', escalada: false, motivo_tthh: '',
      acepta_descuento: !!p.aceptaDescuento, dias_sin_saldo: Number(p.diasSinSaldo) || 0,
      registros: [], avisos: {}
    };
    if (p.saldo) sol.saldo_al_solicitar = p.saldo;

    // Permiso personal: reparto bolsa / vacaciones / rol (fase 2). Si algo no cabe en la bolsa, el colaborador
    // debe haber aceptado el aviso; se recalcula al aprobar con los datos de ese momento.
    if (p.tipo === 'PERMISO_PERSONAL') {
      let plan = p.planBolsa;
      if (!plan) {
        try { plan = await planBolsa(emp, { modalidad, fechas, desde, minutos }); }
        catch (e) { return { error: 'No se pudo calcular tu bolsa de 4 horas: ' + (e.message || e) }; }
      }
      if ((plan.vacaciones_min || plan.rol_min) && !p.aceptaCargo) return { error: 'Acepta el aviso: parte del permiso no cabe en tu bolsa de 4 horas' };
      sol.plan_bolsa = plan;
      sol.acepta_cargo = !!p.aceptaCargo;
    }

    if (T.aprobacion) {
      const ap = await aprobadorDe(emp);
      if (ap.jefe) {
        sol.estado = 'PENDIENTE_JEFE';
        sol.aprobador_id = String(ap.jefe.id);
        sol.aprobador_nombre = ap.jefe.nombre || '';
        sol.vence_jefe = sumarMinutosLaborables(ahora, MIN_ESCALADO).toISOString();
      } else {
        sol.estado = 'PENDIENTE_TTHH';
        sol.escalada = true;
        sol.escalada_en = ahora.toISOString();
        sol.motivo_tthh = ap.motivo;
      }
    } else {
      sol.estado = 'REGISTRADA';
      const jefe = (await aprobadorDe(emp)).jefe;
      if (jefe) { sol.aprobador_id = String(jefe.id); sol.aprobador_nombre = jefe.nombre || ''; }
      sol.docs_estado = 'PENDIENTE';
      sol.docs_vence = new Date(ahora.getTime() + 72 * 3600000).toISOString();
    }

    const ref = await db().collection(COL).add(sol);
    sol.id = ref.id;
    if (sol.estado === 'REGISTRADA') await crearRegistros(sol, `${quien.nombre || quien.id} (${T.label})`);
    avisar(sol.estado === 'REGISTRADA' ? 'registrada' : 'creada', sol).catch(e => console.warn('Permisos: avisos no enviados', e));
    return { ok: true, solicitud: sol };
  }

  // Registros de ausencia en asistencia (solo solicitudes por días)
  async function crearRegistros(sol, quienJustifica) {
    if (sol.modalidad !== 'DIAS' || !window.FirebaseBackend || typeof window.FirebaseBackend.guardarRegistro !== 'function') return;
    const T = TIPOS[sol.tipo];
    const razon = (sol.tipo === 'CALAMIDAD' ? 'CALAMIDAD DOMÉSTICA' : T.label.toUpperCase()) + (sol.motivo ? ': ' + sol.motivo : '') + ` · Solicitud ${sol.id}`;
    const hechos = [], errores = [];
    for (const f of sol.fechas || []) {
      try {
        const r = await window.FirebaseBackend.guardarRegistro({
          id: sol.empleadoId, empleadoId: sol.empleadoId, tipo: T.registro, fecha: f, fecha_falta: f, hora: '00:00:00',
          modo: 'EMPRESA', almuerzo: '', horasExtra: 'NO', justificado: 'SI',
          razon_ausencia: razon, razon_justificac: razon, observacion: razon, quien_justifica: quienJustifica,
          dispositivo: 'SOLICITUD_PERMISO'
        });
        if (r && r.error) { errores.push(`${f}: ${r.error}`); continue; }
        hechos.push(f);
        // Permiso personal por días (fase 2): lo que cubre la bolsa y lo que va al rol se marca como permiso
        // personal del día (el panel lo descuenta de la bolsa y luego del rol); lo cargado a vacaciones no.
        if (sol.tipo === 'PERMISO_PERSONAL' && r && r.id) {
          const mins = (Number((sol.bolsa_por_dia || {})[f]) || 0) + (Number((sol.rol_por_dia || {})[f]) || 0);
          await db().collection('registros').doc(r.id).set({ permiso_personal_mins: mins }, { merge: true });
        }
      } catch (e) { errores.push(`${f}: ${e.message || e}`); }
    }
    const upd = { registros: hechos, registros_en: ahoraIso() };
    if (errores.length) upd.registros_error = errores.join(' | ').slice(0, 900);
    await db().collection(COL).doc(sol.id).set(upd, { merge: true }).catch(() => { });
    Object.assign(sol, upd);
    if (errores.length) toast(`Algunos días no se registraron en asistencia (${errores.length}). Avisa a TTHH.`, 'error');
  }

  // Aprobar o rechazar. quien: {id, nombre}; puede el jefe asignado, alguien de TTHH o un administrador del panel
  async function resolver(id, accion, quien, comentario = '', esAdmin = false) {
    accion = String(accion || '').toUpperCase();
    if (!['APROBAR', 'RECHAZAR'].includes(accion)) return { error: 'Acción no válida' };
    if (accion === 'RECHAZAR' && !String(comentario || '').trim()) return { error: 'Escribe el motivo del rechazo' };
    const ref = db().collection(COL).doc(id);
    const tthh = await esTTHH(quien.id);
    let sol = null;
    // Permiso personal (fase 2): al aprobar se fija el reparto bolsa / vacaciones / rol con los datos de este momento
    let final = null;
    if (accion === "APROBAR") {
      try {
        const previa = (await ref.get()).data() || {};
        if (previa.tipo === "PERMISO_PERSONAL") {
          const emp = await leerEmpleado(previa.empleadoId);
          if (!emp) throw new Error("No se encontró la ficha del colaborador");
          const plan = await planBolsa(emp, { modalidad: previa.modalidad, fechas: previa.fechas || [], desde: previa.desde, minutos: previa.minutos }, id);
          final = {
            bolsa_por_dia: plan.bolsa_por_dia, vacaciones_por_dia: plan.vacaciones_por_dia, rol_por_dia: plan.rol_por_dia,
            minutos_bolsa: plan.bolsa_min, cargo_vacaciones_min: plan.vacaciones_min, descuento_rol_min: plan.rol_min,
            plan_aprobacion: plan, vacaciones_hoja: false
          };
        }
      } catch (e) { return { error: "No se pudo calcular la bolsa de 4 horas: " + (e.message || e) }; }
    }
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = snap.data();
        if (!PENDIENTES.includes(s.estado)) throw new Error(`La solicitud ya fue ${(ESTADOS[s.estado] || {}).txt || s.estado}`.toLowerCase());
        const esJefe = String(s.aprobador_id) === String(quien.id) && s.estado === 'PENDIENTE_JEFE';
        if (!esJefe && !tthh && !esAdmin) throw new Error('No puedes resolver esta solicitud');
        if (String(s.empleadoId) === String(quien.id)) throw new Error('No puedes aprobar tu propia solicitud');
        const ahora = ahoraIso();
        const upd = {
          estado: accion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA',
          resuelta_por: quien.nombre || String(quien.id), resuelta_por_id: String(quien.id),
          resuelta_como: esJefe ? 'JEFE' : (tthh ? 'TTHH' : 'ADMIN'), resuelta_en: ahora,
          comentario: String(comentario || '').trim().slice(0, 400),
          historial: firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: quien.nombre || String(quien.id), accion: accion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA' })
        };
        if (final) Object.assign(upd, final);
        tx.update(ref, upd);
        sol = Object.assign({ id }, s, upd);
      });
    } catch (e) {
      return { error: e.message || String(e) };
    }
    if (sol.estado === 'APROBADA') await crearRegistros(sol, `${sol.resuelta_por} (${sol.resuelta_como === 'JEFE' ? 'jefe inmediato' : 'TTHH'})`);
    avisar(sol.estado === 'APROBADA' ? 'aprobada' : 'rechazada', sol).catch(e => console.warn('Permisos: avisos no enviados', e));
    return { ok: true, solicitud: sol };
  }

  async function cancelar(id, quien) {
    const ref = db().collection(COL).doc(id);
    let sol = null;
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = snap.data();
        if (String(s.empleadoId) !== String(quien.id)) throw new Error('Solo quien la pidió puede cancelarla');
        if (!PENDIENTES.includes(s.estado)) throw new Error('Solo se cancelan solicitudes que aún no se resuelven');
        const ahora = ahoraIso();
        const upd = { estado: 'CANCELADA', cancelada_en: ahora, historial: firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: quien.nombre || String(quien.id), accion: 'CANCELADA' }) };
        tx.update(ref, upd);
        sol = Object.assign({ id }, s, upd);
      });
    } catch (e) { return { error: e.message || String(e) }; }
    avisar('cancelada', sol).catch(() => { });
    return { ok: true };
  }

  // ---------------------------------------------------------------- avisos (campana + WhatsApp)
  function periodoTxt(s) {
    if (s.modalidad === 'HORAS') return `el ${fechaCorta(s.desde)} de ${s.hora_desde} a ${s.hora_hasta}`;
    return s.desde === s.hasta ? `el ${fechaCorta(s.desde)}` : `del ${fechaCorta(s.desde)} al ${fechaCorta(s.hasta)} (${s.dias} día${s.dias === 1 ? '' : 's'} laborable${s.dias === 1 ? '' : 's'})`;
  }
  function saludoWa(nombre) {
    const p = String(nombre || '').trim().split(/\s+/);
    const n = p.length >= 3 ? p[2] : (p[1] || p[0] || '');
    return `Hola *${n.charAt(0) + n.slice(1).toLowerCase()}*, te escribimos de TCONTROL.\n\n`;
  }
  async function campana(para, tipo, titulo, texto, sol, sufijo) {
    if (!para || !window.FirebaseBackend || !window.FirebaseBackend.crearAvisoCampana) return;
    return window.FirebaseBackend.crearAvisoCampana({ para: String(para), tipo, titulo, texto, enlace: { modulo: 'permisos', id: sol.id }, clave: `permiso_${sol.id}_${sufijo}_${para}` });
  }
  async function whatsapp(emp, texto) {
    const WA = window.OpenWAService;
    if (!WA || !emp || !emp.telefono) return { ok: false, error: !emp || !emp.telefono ? 'sin teléfono' : 'WhatsApp no disponible' };
    try { const r = await WA.enviarMensajeTexto(emp.telefono, texto); return r && r.ok !== false ? { ok: true } : { ok: false, error: (r && r.error) || 'sin respuesta' }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  }
  // Destinatarios de TTHH; si la lista está vacía, los supervisores administradores (para que nada quede sin dueño)
  async function destinatariosTTHH() {
    const c = await leerConfig(true);
    if (c.tthh.length) return Promise.all(c.tthh.map(async x => (await leerEmpleado(x.id)) || { id: x.id, nombre: x.nombre }));
    try { return await window.FirebaseBackend.supAdminsCampo(); } catch (e) { return []; }
  }

  async function avisar(evento, s) {
    const T = TIPOS[s.tipo] || { label: s.tipo };
    const quien = `${nombreCorto(s.nombre)} (${s.empleadoId})`;
    const per = periodoTxt(s);
    const avisos = {};
    const resultado = (clave, r) => { avisos[clave] = r && r.ok ? 'WhatsApp enviado' : `WhatsApp no enviado: ${(r && r.error) || 'sin respuesta'}`; };
    const pieWa = '\n\n👉 Revísala en la app TCONTROL → *Permisos* → *Por aprobar*.';
    const colab = await leerEmpleado(s.empleadoId);

    if (evento === 'creada') {
      // El motivo puede tener datos de salud: no viaja por WhatsApp, se lee en la app (requiere sesión)
      const lineas = `*${quien}* solicita *${T.label.toLowerCase()}* ${per}.` + (s.motivo ? '\nEl motivo está en la solicitud.' : '') +
        (s.acepta_descuento ? `\n⚠️ Sin saldo suficiente: aceptó el descuento al rol de ${s.dias_sin_saldo} día(s).` : '') +
        (s.plan_bolsa && (s.plan_bolsa.vacaciones_min || s.plan_bolsa.rol_min)
          ? `\n⚠️ Supera su bolsa de 4 h: ${s.plan_bolsa.vacaciones_min ? durTxt(s.plan_bolsa.vacaciones_min) + ' a vacaciones' : ''}${s.plan_bolsa.vacaciones_min && s.plan_bolsa.rol_min ? ' y ' : ''}${s.plan_bolsa.rol_min ? durTxt(s.plan_bolsa.rol_min) + ' al rol' : ''} (lo aceptó).` : '');
      if (s.estado === 'PENDIENTE_JEFE') {
        const jefe = await leerEmpleado(s.aprobador_id);
        await campana(s.aprobador_id, 'permiso_solicitud', `Solicitud de ${T.label.toLowerCase()}`, `${quien} ${per}`, s, 'jefe');
        resultado('aviso_jefe', await whatsapp(jefe, saludoWa(jefe && jefe.nombre) + '📝 ' + lineas + `\n\nSi no respondes en 8 horas laborables, pasará a TTHH.` + pieWa));
      } else {
        const lista = await destinatariosTTHH();
        await Promise.allSettled(lista.map(d => campana(d.id, 'permiso_solicitud', `Solicitud de ${T.label.toLowerCase()} para TTHH`, `${quien} ${per} · ${MOTIVO_TTHH_3[s.motivo_tthh] || ''}`, s, 'tthh')));
        const rs = await Promise.all(lista.map(d => whatsapp(d, saludoWa(d.nombre) + '📝 ' + lineas + `\n\nLlega a TTHH porque: ${(MOTIVO_TTHH_3[s.motivo_tthh] || '').toLowerCase()}.` + pieWa)));
        avisos.aviso_tthh = `WhatsApp ${rs.filter(r => r.ok).length}/${lista.length}`;
      }
    } else if (evento === 'registrada') {
      const porOtro = s.creada_por && String(s.creada_por.id) !== String(s.empleadoId);
      const autor = porOtro ? `${nombreCorto(s.creada_por.nombre)} registró a nombre de ${quien}` : `${quien} registró`;
      const txt = `${autor} ${T.label.toLowerCase()} ${per}` + (s.motivo ? ` · ${s.motivo}` : '');
      const lista = await destinatariosTTHH();
      // A quien la registró no se le avisa de su propia acción
      const destinos = lista.filter(d => !s.creada_por || String(d.id) !== String(s.creada_por.id));
      if (s.aprobador_id && String(s.aprobador_id) !== String(s.creada_por && s.creada_por.id) && !destinos.some(d => String(d.id) === String(s.aprobador_id))) destinos.push(await leerEmpleado(s.aprobador_id) || { id: s.aprobador_id });
      await Promise.allSettled(destinos.map(d => campana(d.id, 'permiso_registrado', `${T.label} ${part(T, "registrad")}`, txt, s, 'info')));
      const wa = (porOtro ? `📋 *${nombreCorto(s.creada_por.nombre)}* registró a nombre de *${quien}* *` : `📋 *${quien}* registró *`) + `${T.label.toLowerCase()}* ${per}.` +
        '\n\nEs informativo: no requiere aprobación. Los documentos deben llegar a TTHH en 72 horas.';
      const rs = await Promise.all(destinos.map(d => whatsapp(d, saludoWa(d.nombre) + wa)));
      avisos.aviso_jefe_tthh = `WhatsApp ${rs.filter(r => r.ok).length}/${destinos.length}`;
      if (String(s.creada_por && s.creada_por.id) !== String(s.empleadoId)) {
        await campana(s.empleadoId, 'permiso_registrado', `${T.label} ${part(T, "registrad")} a tu nombre`, `${per} · por ${nombreCorto(s.creada_por.nombre)}`, s, 'col');
      }
    } else if (evento === 'aprobada' || evento === 'rechazada') {
      const ok = evento === 'aprobada';
      await campana(s.empleadoId, ok ? 'permiso_aprobado' : 'permiso_rechazado', ok ? `${T.label} ${part(T, "aprobad")}` : `${T.label} no ${part(T, "aprobad")}`,
        `${per} · ${nombreCorto(s.resuelta_por)}` + (s.comentario ? ` · ${s.comentario}` : ''), s, 'col');
      resultado('aviso_colaborador', await whatsapp(colab, saludoWa(colab && colab.nombre) + (ok
        ? `✅ Tu solicitud de *${T.label.toLowerCase()}* ${per} fue *aprobada* por ${nombreCorto(s.resuelta_por)}.` + (s.modalidad === 'HORAS' ? '\n\nRecuerda registrar tu salida y tu regreso en la app.' : '')
        : `❌ Tu solicitud de *${T.label.toLowerCase()}* ${per} *no fue aprobada*.` + (s.comentario ? `\nMotivo: ${s.comentario}` : '') + '\n\nSi necesitas aclararlo, habla con tu jefe inmediato.')));
      if (ok) {
        const lista = await destinatariosTTHH();
        await Promise.allSettled(lista.filter(d => String(d.id) !== String(s.resuelta_por_id))
          .map(d => campana(d.id, 'permiso_aprobado', `${T.label} ${part(T, "aprobad")}`, `${quien} ${per} · aprobó ${nombreCorto(s.resuelta_por)}`, s, 'tthh')));
      }
    } else if (evento === 'cancelada') {
      if (s.estado === 'CANCELADA' && s.aprobador_id) await campana(s.aprobador_id, 'permiso_cancelado', 'Solicitud cancelada', `${quien} canceló ${T.label.toLowerCase()} ${per}`, s, 'cancel');
    }
    if (Object.keys(avisos).length) {
      avisos[`${evento}_en`] = ahoraIso();
      await db().collection(COL).doc(s.id).set({ avisos }, { merge: true }).catch(() => { });
    }
  }

  // ---------------------------------------------------------------- lecturas
  function escuchar(consulta, cb) {
    return consulta.onSnapshot(snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => tsMs(b.creada) - tsMs(a.creada))),
      err => { console.warn('Permisos: lectura en vivo falló', err); cb(null, err); });
  }
  async function contarPorAprobar(id) {
    if (!id) return 0;
    try {
      const yo = String(id);
      const tthh = await esTTHH(yo);
      const snap = tthh
        ? await db().collection(COL).where('estado', 'in', PENDIENTES).get()
        : await db().collection(COL).where('aprobador_id', '==', yo).get();
      let n = 0;
      snap.forEach(doc => { const s = doc.data(); if ((tthh && PENDIENTES.includes(s.estado)) || (s.estado === 'PENDIENTE_JEFE' && String(s.aprobador_id) === yo)) n++; });
      return n;
    } catch (e) { return 0; }
  }

  // ---------------------------------------------------------------- interfaz común
  function chipEstado(s, comoAprobador) {
    const e = ESTADOS[s.estado] || { txt: s.estado, clase: 'pm-e-gris' };
    let txt = comoAprobador && e.txtAprob ? e.txtAprob : e.txt;
    if (s.estado === 'REGISTRADA' && s.docs_estado === 'PENDIENTE') txt = 'Registrada · faltan documentos';
    return `<span class="pm-estado ${e.clase}">${esc(txt)}</span>`;
  }
  function periodoHtml(s) {
    if (s.modalidad === 'HORAS') return `<strong>${esc(fechaLarga(s.desde))}</strong> · ${esc(s.hora_desde)}–${esc(s.hora_hasta)} <span class="pm-sub">(${durTxt(s.minutos || 0)})</span>`;
    const dias = `<span class="pm-sub">(${s.dias} día${s.dias === 1 ? '' : 's'} laborable${s.dias === 1 ? '' : 's'})</span>`;
    return s.desde === s.hasta ? `<strong>${esc(fechaLarga(s.desde))}</strong> ${dias}` : `<strong>${esc(fechaLarga(s.desde))}</strong> → <strong>${esc(fechaLarga(s.hasta))}</strong> ${dias}`;
  }
  function tarjeta(s, opts = {}) {
    const T = TIPOS[s.tipo] || { label: s.tipo, icono: 'fa-file', color: 'pm-c-gris' };
    const lineas = [];
    if (opts.conNombre) lineas.push(`<div class="pm-quien"><i class="fas fa-user"></i> ${esc(nombreCorto(s.nombre))} <span class="pm-sub">· ${esc(s.empleadoId)}${s.area ? ' · ' + esc(s.area) : ''}</span></div>`);
    lineas.push(`<div class="pm-periodo">${periodoHtml(s)}</div>`);
    if (s.motivo) lineas.push(`<div class="pm-motivo">${esc(s.motivo)}</div>`);
    if (s.tipo === 'PERMISO_PERSONAL' && (s.plan_bolsa || s.estado === 'APROBADA')) {
      const fin = s.estado === 'APROBADA' && s.minutos_bolsa !== undefined;
      const b = fin ? s.minutos_bolsa : (s.plan_bolsa || {}).bolsa_min || 0;
      const v = fin ? s.cargo_vacaciones_min : (s.plan_bolsa || {}).vacaciones_min || 0;
      const r = fin ? s.descuento_rol_min : (s.plan_bolsa || {}).rol_min || 0;
      const t = [];
      if (b) t.push(`bolsa de 4 h ${durTxt(b)}`);
      if (v) t.push(`vacaciones ${durTxt(v)}`);
      if (r) t.push(`rol ${durTxt(r)}`);
      if (t.length) lineas.push(`<div class="${v || r ? 'pm-alerta' : 'pm-sub'}"><i class="fas fa-piggy-bank"></i> ${fin ? 'Se cargó a' : 'Se cargaría a'}: ${t.join(' · ')}${v || r ? (s.acepta_cargo ? ' · el colaborador aceptó el cargo' : '') : ''}</div>`);
    }
    if (s.acepta_descuento) lineas.push(`<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> Sin saldo suficiente: aceptó el descuento al rol de ${s.dias_sin_saldo} día(s).</div>`);
    if (s.estado === 'PENDIENTE_JEFE') {
      lineas.push(`<div class="pm-sub"><i class="fas fa-user-tie"></i> ${opts.yoId && String(s.aprobador_id) === String(opts.yoId) ? "Te toca aprobarla" : 'La aprueba ' + esc(nombreCorto(s.aprobador_nombre))}${s.vence_jefe ? ` · pasa a TTHH el ${esc(horaIso(s.vence_jefe))} si no hay respuesta` : ''}</div>`);
    } else if (s.estado === 'PENDIENTE_TTHH') {
      lineas.push(`<div class="pm-sub"><i class="fas fa-users"></i> La revisa TTHH · ${esc((opts.comoAprobador || opts.conNombre ? MOTIVO_TTHH_3 : MOTIVO_TTHH)[s.motivo_tthh] || '')}</div>`);
    } else if (s.estado === 'APROBADA' || s.estado === 'RECHAZADA') {
      lineas.push(`<div class="pm-sub"><i class="fas ${s.estado === 'APROBADA' ? 'fa-check' : 'fa-times'}"></i> ${s.estado === 'APROBADA' ? 'Aprobó' : 'Rechazó'} ${esc(nombreCorto(s.resuelta_por))}${s.resuelta_como === 'TTHH' ? ' (TTHH)' : ''} · ${esc(horaIso(s.resuelta_en))}${s.comentario ? `<br>«${esc(s.comentario)}»` : ''}</div>`);
    } else if (s.estado === 'REGISTRADA') {
      lineas.push(`<div class="pm-sub"><i class="fas fa-file-medical"></i> Entrega los documentos a TTHH antes del ${esc(horaIso(s.docs_vence))}. Sin ellos se descuenta del rol.</div>`);
    }
    if (s.modalidad === 'DIAS' && ['APROBADA', 'REGISTRADA'].includes(s.estado)) {
      if (s.registros_error) lineas.push(`<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No se registraron todos los días en asistencia. Avisa a TTHH.</div>`);
      else if ((s.registros || []).length) lineas.push(`<div class="pm-sub"><i class="fas fa-calendar-check"></i> Registrado en asistencia</div>`);
    }
    const acciones = opts.acciones ? opts.acciones(s) : '';
    return `<article class="pm-tarjeta" data-id="${esc(s.id)}">
      <div class="pm-cab"><span class="pm-tipo ${T.color}"><i class="fas ${T.icono}"></i> ${esc(T.label)}</span>${chipEstado(s, opts.comoAprobador)}</div>
      ${lineas.join('')}
      ${acciones ? `<div class="pm-acciones">${acciones}</div>` : ''}
    </article>`;
  }

  // ---------------------------------------------------------------- formulario de solicitud
  /**
   * opts: { emp (ficha del colaborador), creadoPor, elegirEmpleado: [lista] (panel: registrar a nombre de),
   *         tiposPermitidos, onCreada(sol) }
   */
  function abrirFormulario(opts) {
    document.getElementById('pmModal')?.remove();
    const hoy = hoyStr();
    const tipos = opts.tiposPermitidos || Object.keys(TIPOS);
    const st = { tipo: '', modalidad: 'DIAS', emp: opts.emp || null, saldo: undefined, aprob: undefined, enviando: false };
    const modal = document.createElement('div');
    modal.id = 'pmModal';
    modal.className = 'pm-modal';
    modal.innerHTML = `
      <div class="pm-dialogo" role="dialog" aria-modal="true" aria-labelledby="pmTitulo">
        <div class="pm-dcab">
          <div><h3 id="pmTitulo">${opts.elegirEmpleado ? 'Registrar a nombre de un colaborador' : 'Nueva solicitud'}</h3><div class="pm-sub">Permisos y vacaciones</div></div>
          <button type="button" class="pm-cerrar" data-pm="cerrar" aria-label="Cerrar">&times;</button>
        </div>
        <div class="pm-dcuerpo">
          ${opts.elegirEmpleado ? `<label class="pm-etq" for="pmEmp">Colaborador</label>
            <select id="pmEmp" class="pm-campo"><option value="">Selecciona…</option>${opts.elegirEmpleado.map(e => `<option value="${esc(e.id)}">${esc(nombreCorto(e.nombre))} · ${esc(e.id)}</option>`).join('')}</select>` : ''}
          <div class="pm-etq">Tipo</div>
          <div class="pm-tipos">${tipos.map(k => `<button type="button" class="pm-tipo-op ${TIPOS[k].color}" data-tipo="${k}" aria-pressed="false">
              <i class="fas ${TIPOS[k].icono}"></i><strong>${esc(TIPOS[k].label)}</strong><span>${esc(TIPOS[k].ayuda)}</span></button>`).join('')}</div>
          <div id="pmDetalle" hidden>
            <div id="pmModalidad" class="pm-seg" role="group" aria-label="Duración"></div>
            <div class="pm-fila">
              <div><label class="pm-etq" for="pmDesde" id="pmLblDesde">Desde</label><input type="date" id="pmDesde" class="pm-campo"></div>
              <div id="pmBoxHasta"><label class="pm-etq" for="pmHasta">Hasta</label><input type="date" id="pmHasta" class="pm-campo"></div>
            </div>
            <div class="pm-fila" id="pmBoxHoras" hidden>
              <div><label class="pm-etq" for="pmHoraDesde">Sale a las</label><input type="time" id="pmHoraDesde" class="pm-campo" value="08:00"></div>
              <div><label class="pm-etq" for="pmHoraHasta">Regresa a las</label><input type="time" id="pmHoraHasta" class="pm-campo" value="10:00"></div>
            </div>
            <label class="pm-etq" for="pmMotivo" id="pmLblMotivo">Motivo</label>
            <textarea id="pmMotivo" class="pm-campo" rows="2" maxlength="400"></textarea>
            <div id="pmResumen" class="pm-resumen"></div>
            <label id="pmBoxDescuento" class="pm-acepta" hidden><input type="checkbox" id="pmAcepta"> <span id="pmTxtDescuento"></span></label>
            <label id="pmBoxCargo" class="pm-acepta" hidden><input type="checkbox" id="pmAceptaCargo"> <span id="pmTxtCargo"></span></label>
          </div>
          <div id="pmMensaje" class="pm-error" role="alert" hidden></div>
        </div>
        <div class="pm-dpie">
          <button type="button" class="pm-btn pm-btn-sec" data-pm="cerrar">Cancelar</button>
          <button type="button" class="pm-btn pm-btn-pri" id="pmEnviar" disabled><i class="fas fa-paper-plane"></i> Enviar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const $ = id => modal.querySelector('#' + id);
    const cerrar = () => modal.remove();
    const mensaje = t => { const b = $('pmMensaje'); b.hidden = !t; b.textContent = t || ''; };
    modal.addEventListener('click', ev => {
      if (ev.target === modal || ev.target.closest('[data-pm="cerrar"]')) { cerrar(); return; }
      const op = ev.target.closest('.pm-tipo-op');
      if (op) elegirTipo(op.dataset.tipo);
      const md = ev.target.closest('[data-modalidad]');
      if (md) { st.modalidad = md.dataset.modalidad; pintarModalidad(); recalcular(); }
    });

    async function cargarEmpleado(id) {
      st.emp = id ? await leerEmpleado(id) : null;
      st.saldo = undefined; st.aprob = undefined;
      recalcular();
    }
    if (opts.elegirEmpleado) $('pmEmp').addEventListener('change', e => cargarEmpleado(e.target.value));

    function elegirTipo(k) {
      st.tipo = k;
      modal.querySelectorAll('.pm-tipo-op').forEach(b => b.setAttribute('aria-pressed', b.dataset.tipo === k ? 'true' : 'false'));
      const T = TIPOS[k];
      if (!T.modalidades.includes(st.modalidad)) st.modalidad = T.modalidades[0];
      $('pmDetalle').hidden = false;
      const min = k === 'CALAMIDAD' ? (() => { const d = new Date(); d.setDate(d.getDate() - DIAS_ATRAS_CALAMIDAD); return fechaStr(d); })()
        : k === 'PERMISO_MEDICO' ? (() => { const d = new Date(); d.setDate(d.getDate() - 3); return fechaStr(d); })() : hoy;
      ['pmDesde', 'pmHasta'].forEach(i => { $(i).min = min; if (!$(i).value || $(i).value < min) $(i).value = hoy; });
      $('pmLblMotivo').textContent = k === 'VACACIONES' ? 'Comentario (opcional)' : 'Motivo';
      $('pmMotivo').placeholder = { VACACIONES: 'Ej: viaje familiar', PERMISO_PERSONAL: 'Ej: trámite en el banco', PERMISO_MEDICO: 'Ej: cita en el IESS', CALAMIDAD: 'Ej: fallecimiento de un familiar' }[k];
      pintarModalidad();
      recalcular();
    }
    function pintarModalidad() {
      const T = TIPOS[st.tipo];
      const box = $('pmModalidad');
      box.hidden = T.modalidades.length < 2;
      box.innerHTML = T.modalidades.map(m => `<button type="button" data-modalidad="${m}" aria-pressed="${st.modalidad === m}">${m === 'HORAS' ? 'Por horas' : 'Por días'}</button>`).join('');
      const horas = st.modalidad === 'HORAS';
      $('pmBoxHoras').hidden = !horas;
      $('pmBoxHasta').hidden = horas;
      $('pmLblDesde').textContent = horas ? 'Fecha' : 'Desde';
    }
    ['pmDesde', 'pmHasta', 'pmHoraDesde', 'pmHoraHasta', 'pmMotivo'].forEach(i => $(i).addEventListener('input', recalcular));
    $('pmAcepta').addEventListener('change', recalcular);
    $("pmAceptaCargo").addEventListener("change", recalcular);

    async function recalcular() {
      mensaje('');
      const T = TIPOS[st.tipo];
      const btn = $('pmEnviar');
      if (!T || !st.emp) { btn.disabled = true; $('pmResumen').innerHTML = opts.elegirEmpleado && !st.emp && T ? '<span class="pm-sub">Selecciona el colaborador.</span>' : ''; return; }
      if (st.modalidad === 'DIAS' && $('pmHasta').value < $('pmDesde').value) $('pmHasta').value = $('pmDesde').value;
      $('pmHasta').min = $('pmDesde').value || hoy;
      const desde = $('pmDesde').value, hasta = st.modalidad === 'HORAS' ? desde : $('pmHasta').value;
      const fechas = desde && hasta ? fechasLaborables(desde, hasta) : [];
      const partes = [];
      if (st.modalidad === 'HORAS') {
        const a = minutosDe($('pmHoraDesde').value), b = minutosDe($('pmHoraHasta').value);
        partes.push(!isNaN(a) && !isNaN(b) && b > a ? `<div><i class="fas fa-clock"></i> ${durTxt(b - a)} de permiso</div>` : '<div class="pm-sub">Indica la hora de salida y de regreso.</div>');
        if (desde && !esLaborable(desde)) partes.push('<div class="pm-sub">Esa fecha no es laborable.</div>');
      } else {
        partes.push(fechas.length ? `<div><i class="fas fa-calendar-day"></i> ${fechas.length} día${fechas.length === 1 ? '' : 's'} laborable${fechas.length === 1 ? '' : 's'} <span class="pm-sub">(sin fines de semana ni feriados)</span></div>` : '<div class="pm-sub">El rango no tiene días laborables.</div>');
      }
      // Quién la aprueba
      if (T.aprobacion) {
        if (st.aprob === undefined) { st.aprob = null; const empId = st.emp.id; aprobadorDe(st.emp).then(r => { if (st.emp && st.emp.id === empId) { st.aprob = r; recalcular(); } }); }
        if (st.aprob === null) partes.push('<div class="pm-sub"><i class="fas fa-spinner fa-spin"></i> Buscando a tu jefe inmediato…</div>');
        else if (st.aprob) partes.push(st.aprob.jefe ? `<div><i class="fas fa-user-tie"></i> La aprueba <strong>${esc(nombreCorto(st.aprob.jefe.nombre))}</strong> (jefe inmediato). Si no responde en 8 horas laborables, pasa a TTHH.</div>`
          : `<div><i class="fas fa-users"></i> La revisa <strong>TTHH</strong>: ${esc((MOTIVO_TTHH[st.aprob.motivo] || '').toLowerCase())}.</div>`);
      } else {
        partes.push('<div><i class="fas fa-info-circle"></i> No necesita aprobación: se registra al enviar y se avisa a tu jefe inmediato y a TTHH. Entrega los documentos a TTHH en 72 horas; sin ellos se descuenta del rol.</div>');
      }
      // Saldo de vacaciones
      let sinSaldo = 0;
      if (st.tipo === 'VACACIONES') {
        if (st.saldo === undefined) { st.saldo = "cargando"; const empId = st.emp.id; saldoVacaciones(st.emp).then(r => { if (st.emp && st.emp.id === empId) { st.saldo = r; recalcular(); } }); }
        if (st.saldo === 'cargando') partes.push('<div class="pm-sub"><i class="fas fa-spinner fa-spin"></i> Consultando saldo de vacaciones…</div>');
        else if (st.saldo === null) partes.push('<div class="pm-sub">No se pudo consultar el saldo de vacaciones; TTHH lo revisará.</div>');
        else {
          const disp = Math.max(0, Math.floor(st.saldo.disponible));
          sinSaldo = Math.max(0, fechas.length - disp);
          partes.push(`<div><i class="fas fa-wallet"></i> Saldo disponible: <strong>${disp} día${disp === 1 ? '' : 's'}</strong>${st.saldo.comprometidos ? ` <span class="pm-sub">(${st.saldo.comprometidos} ya pedidos para fechas futuras)</span>` : ''}</div>`);
        }
      }
      // Permiso personal (fase 2): bolsa de 4 h del período; lo que no cabe va a vacaciones y, sin vacaciones, al rol
      let necesitaCargo = false, planCargando = false;
      if (st.tipo === 'PERMISO_PERSONAL') {
        const a = minutosDe($('pmHoraDesde').value), b = minutosDe($('pmHoraHasta').value);
        const datosOk = st.modalidad === 'HORAS' ? (desde && !isNaN(a) && !isNaN(b) && b > a && esLaborable(desde)) : fechas.length > 0;
        const clave = [st.emp.id, st.modalidad, desde, hasta, a, b].join('|');
        if (datosOk && (!st.plan || st.plan.clave !== clave)) {
          st.plan = { clave, estado: 'cargando' };
          planBolsa(st.emp, { modalidad: st.modalidad, fechas, desde, minutos: b - a })
            .then(p => { if (st.plan && st.plan.clave === clave) { st.plan = { clave, estado: 'ok', plan: p }; recalcular(); } })
            .catch(e => { if (st.plan && st.plan.clave === clave) { st.plan = { clave, estado: 'error', error: e.message || String(e) }; recalcular(); } });
        }
        const P = st.plan && st.plan.clave === clave ? st.plan : null;
        if (!datosOk) { /* sin datos completos todavía */ }
        else if (!P || P.estado === 'cargando') { planCargando = true; partes.push('<div class="pm-sub"><i class="fas fa-spinner fa-spin"></i> Calculando tu bolsa de 4 horas…</div>'); }
        else if (P.estado === 'error') { planCargando = true; partes.push(`<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No se pudo calcular tu bolsa de 4 horas: ${esc(P.error)}. Intenta de nuevo en un momento.</div>`); }
        else {
          const p = P.plan;
          partes.push(`<div><i class="fas fa-piggy-bank"></i> Bolsa de 4 h disponible en el período ${fechaCorta(p.periodo.inicio).slice(0, 5)}–${fechaCorta(p.periodo.fin).slice(0, 5)}: <strong>${durTxt(p.saldo_bolsa_inicial)}</strong></div>`);
          if (p.vacaciones_min || p.rol_min) {
            necesitaCargo = true;
            const trozos = [];
            if (p.vacaciones_min) trozos.push(`<strong>${durTxt(p.vacaciones_min)} se cargarán a tus vacaciones</strong> (cada 8 h acumuladas descuentan 1 día)`);
            if (p.rol_min) trozos.push(`<strong>${durTxt(p.rol_min)} se descontarán del rol</strong> porque no te alcanzan las vacaciones`);
            $('pmTxtCargo').innerHTML = `Este permiso supera tu bolsa de 4 horas: ${trozos.join(' y ')}. Acepto este cargo.`;
          } else {
            partes.push(`<div class="pm-sub"><i class="fas fa-check"></i> Cabe en tu bolsa: no se carga a vacaciones.</div>`);
          }
        }
      }
      $('pmBoxCargo').hidden = !necesitaCargo;
      st.necesitaCargo = necesitaCargo;

      $('pmResumen').innerHTML = partes.join('');
      $('pmBoxDescuento').hidden = !sinSaldo;
      if (sinSaldo) $('pmTxtDescuento').innerHTML = `No tienes saldo para ${sinSaldo} día${sinSaldo === 1 ? '' : 's'}. <strong>Acepto que ${sinSaldo === 1 ? 'ese día se descuente' : 'esos días se descuenten'} del rol.</strong>`;
      st.sinSaldo = sinSaldo;
      const motivoOk = st.tipo === 'VACACIONES' || $('pmMotivo').value.trim();
      btn.disabled = st.enviando || !motivoOk || (st.modalidad === "DIAS" && !fechas.length) || (sinSaldo > 0 && !$("pmAcepta").checked) || st.saldo === "cargando" || planCargando || (necesitaCargo && !$("pmAceptaCargo").checked);
      btn.innerHTML = T.aprobacion ? '<i class="fas fa-paper-plane"></i> Enviar solicitud' : '<i class="fas fa-check"></i> Registrar';
    }

    $('pmEnviar').addEventListener('click', async () => {
      if (st.enviando) return;
      st.enviando = true;
      const btn = $('pmEnviar');
      const txt = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
      try {
        const res = await crearSolicitud({
          emp: st.emp, tipo: st.tipo, modalidad: st.modalidad, desde: $('pmDesde').value, hasta: $('pmHasta').value,
          horaDesde: $('pmHoraDesde').value, horaHasta: $('pmHoraHasta').value, motivo: $('pmMotivo').value,
          aceptaDescuento: st.sinSaldo > 0 && $('pmAcepta').checked, diasSinSaldo: st.sinSaldo,
          saldo: st.saldo && typeof st.saldo === 'object' ? st.saldo : null,
          planBolsa: st.tipo === "PERMISO_PERSONAL" && st.plan && st.plan.estado === "ok" ? st.plan.plan : null,
          aceptaCargo: !!st.necesitaCargo && $("pmAceptaCargo").checked,
          creadoPor: opts.creadoPor
        });
        if (!res || res.error) throw new Error((res && res.error) || 'No se pudo enviar');
        cerrar();
        const s = res.solicitud;
        toast(s.estado === 'REGISTRADA' ? `${TIPOS[s.tipo].label} ${part(TIPOS[s.tipo], "registrad")}. Se avisó a tu jefe y a TTHH.`
          : s.estado === 'PENDIENTE_JEFE' ? `Solicitud enviada a ${nombreCorto(s.aprobador_nombre)}` : 'Solicitud enviada a TTHH', 'success');
        if (typeof opts.onCreada === 'function') opts.onCreada(s);
      } catch (e) {
        mensaje(e.message || String(e));
        btn.innerHTML = txt;
        st.enviando = false;
        recalcular();
      }
    });
    if (tipos.length === 1) elegirTipo(tipos[0]);
  }

  // Rechazo con motivo (ventana propia: el panel y la app no deben depender de prompt())
  function pedirMotivoRechazo(s) {
    return new Promise(resolve => {
      document.getElementById('pmModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pmModal';
      modal.className = 'pm-modal';
      modal.innerHTML = `<div class="pm-dialogo pm-dialogo-chico" role="dialog" aria-modal="true" aria-labelledby="pmTitRech">
        <div class="pm-dcab"><div><h3 id="pmTitRech">No aprobar</h3><div class="pm-sub">${esc(nombreCorto(s.nombre))} · ${esc((TIPOS[s.tipo] || {}).label || s.tipo)}</div></div>
          <button type="button" class="pm-cerrar" data-pm="no" aria-label="Cerrar">&times;</button></div>
        <div class="pm-dcuerpo"><label class="pm-etq" for="pmRechMotivo">Motivo (lo verá el colaborador)</label>
          <textarea id="pmRechMotivo" class="pm-campo" rows="3" maxlength="400" placeholder="Ej: esa semana hay entrega de proyecto"></textarea></div>
        <div class="pm-dpie"><button type="button" class="pm-btn pm-btn-sec" data-pm="no">Volver</button>
          <button type="button" class="pm-btn pm-btn-rojo" data-pm="si" disabled><i class="fas fa-times"></i> No aprobar</button></div></div>`;
      document.body.appendChild(modal);
      const ta = modal.querySelector('#pmRechMotivo'), si = modal.querySelector('[data-pm="si"]');
      ta.addEventListener('input', () => { si.disabled = !ta.value.trim(); });
      modal.addEventListener('click', ev => {
        if (ev.target === modal || ev.target.closest('[data-pm="no"]')) { modal.remove(); resolve(null); }
        else if (ev.target.closest('[data-pm="si"]') && ta.value.trim()) { const v = ta.value.trim(); modal.remove(); resolve(v); }
      });
      ta.focus();
    });
  }

  async function accionResolver(btn, s, accion, quien, esAdmin, alTerminar) {
    let comentario = '';
    if (accion === 'RECHAZAR') {
      comentario = await pedirMotivoRechazo(s);
      if (!comentario) return;
    }
    const txt = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    const r = await resolver(s.id, accion, quien, comentario, esAdmin);
    if (r.error) { toast(r.error, 'error'); btn.disabled = false; btn.innerHTML = txt; return; }
    toast(accion === 'APROBAR' ? 'Solicitud aprobada. Se avisó al colaborador.' : 'Solicitud rechazada. Se avisó al colaborador.', 'success');
    if (alTerminar) alTerminar();
  }

  // ---------------------------------------------------------------- app del colaborador
  function montarApp(cont, opts) {
    if (!cont || !opts || !opts.empleado || !opts.empleado.id) return;
    if (cont._pm) cont._pm.destruir();
    const yo = { id: String(opts.empleado.id), nombre: opts.empleado.nombre || '' };
    const st = { tab: 'mias', mias: null, aprobar: null, tthh: false, esJefe: false, errMias: '', errAprobar: '', subs: [], enlace: opts.enlace || null };
    cont.innerHTML = `<div class="pm-app">
      <header class="pm-hero"><div><h2>Permisos y vacaciones</h2><p>Pide vacaciones o permisos y sigue su estado.</p></div>
        <button type="button" class="pm-btn pm-btn-pri" data-pm="nueva"><i class="fas fa-plus"></i> Nueva solicitud</button></header>
      <nav class="pm-tabs" role="tablist" hidden>
        <button type="button" role="tab" data-tab="mias" aria-selected="true">Mis solicitudes</button>
        <button type="button" role="tab" data-tab="aprobar" aria-selected="false">Por aprobar <span class="pm-num" hidden></span></button>
      </nav>
      <div class="pm-lista"></div></div>`;
    const lista = cont.querySelector('.pm-lista'), tabs = cont.querySelector('.pm-tabs'), num = cont.querySelector('.pm-num');

    function pendientesParaMi() {
      return (st.aprobar || []).filter(s => (s.estado === 'PENDIENTE_JEFE' && String(s.aprobador_id) === yo.id) || (st.tthh && PENDIENTES.includes(s.estado)));
    }
    function pintar() {
      tabs.hidden = !(st.tthh || st.esJefe || (st.aprobar && st.aprobar.length));
      tabs.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === st.tab ? 'true' : 'false'));
      const pend = pendientesParaMi();
      num.hidden = !pend.length;
      num.textContent = pend.length;
      if (typeof opts.onPendientes === 'function') opts.onPendientes(pend.length);
      if (st.tab === 'mias') {
        if (st.errMias) { lista.innerHTML = `<div class="pm-vacio">${esc(st.errMias)}</div>`; return; }
        if (!st.mias) { lista.innerHTML = '<div class="pm-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>'; return; }
        if (!st.mias.length) { lista.innerHTML = '<div class="pm-vacio"><i class="far fa-calendar"></i><strong>Aún no tienes solicitudes</strong>Usa «Nueva solicitud» para pedir vacaciones o un permiso.</div>'; return; }
        lista.innerHTML = st.mias.map(s => tarjeta(s, {
          acciones: x => PENDIENTES.includes(x.estado) ? `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-cancelar="${esc(x.id)}">Cancelar solicitud</button>` : ''
        })).join('');
      } else {
        if (st.errAprobar) { lista.innerHTML = `<div class="pm-vacio">${esc(st.errAprobar)}</div>`; return; }
        if (!st.aprobar) { lista.innerHTML = '<div class="pm-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>'; return; }
        const otras = st.aprobar.filter(s => !pend.includes(s)).slice(0, 30);
        lista.innerHTML = (pend.length ? `<h3 class="pm-h3">Pendientes (${pend.length})</h3>` + pend.map(s => tarjeta(s, {
          conNombre: true, comoAprobador: true, yoId: yo.id,
          acciones: () => `<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-resolver="RECHAZAR" data-id="${esc(s.id)}"><i class="fas fa-times"></i> No aprobar</button>
            <button type="button" class="pm-btn pm-btn-verde pm-btn-chico" data-resolver="APROBAR" data-id="${esc(s.id)}"><i class="fas fa-check"></i> Aprobar</button>`
        })).join('') : '<div class="pm-vacio"><i class="fas fa-check-circle"></i><strong>No tienes solicitudes por aprobar</strong></div>') +
          (otras.length ? `<h3 class="pm-h3">Recientes de tu equipo${st.tthh ? ' y de TTHH' : ''}</h3>` + otras.map(s => tarjeta(s, { conNombre: true })).join('') : '');
      }
      if (st.enlace && st.enlace.id) {
        const el = lista.querySelector(`[data-id="${CSS.escape(st.enlace.id)}"]`);
        if (el) { el.classList.add('pm-destacada'); el.scrollIntoView({ block: 'center' }); st.enlace = null; }
      }
    }

    cont.addEventListener('click', async ev => {
      const t = ev.target;
      if (t.closest('[data-pm="nueva"]')) {
        const emp = await leerEmpleado(yo.id) || Object.assign({}, opts.empleado);
        abrirFormulario({ emp, creadoPor: { id: yo.id, nombre: yo.nombre, rol: 'COLABORADOR' }, onCreada: () => { st.tab = 'mias'; pintar(); } });
        return;
      }
      const tab = t.closest('[data-tab]');
      if (tab) { st.tab = tab.dataset.tab; pintar(); return; }
      const can = t.closest('[data-cancelar]');
      if (can) {
        if (!window.confirm('¿Cancelar esta solicitud?')) return;
        can.disabled = true;
        const r = await cancelar(can.dataset.cancelar, yo);
        if (r.error) { toast(r.error, 'error'); can.disabled = false; } else toast('Solicitud cancelada', 'success');
        return;
      }
      const res = t.closest('[data-resolver]');
      if (res) {
        const s = (st.aprobar || []).find(x => x.id === res.dataset.id);
        if (s) accionResolver(res, s, res.dataset.resolver, yo, false);
      }
    });

    st.subs.push(escuchar(db().collection(COL).where('empleadoId', '==', yo.id), (l, err) => {
      if (err) st.errMias = 'No se pudieron cargar tus solicitudes.'; else { st.errMias = ''; st.mias = l; }
      pintar();
    }));
    (async () => {
      st.tthh = await esTTHH(yo.id);
      try { st.esJefe = !(await db().collection('empleados').where('jefe_inmediato_id', '==', yo.id).limit(1).get()).empty; } catch (e) { }
      const q = st.tthh ? db().collection(COL) : db().collection(COL).where('aprobador_id', '==', yo.id);
      st.subs.push(escuchar(q, (l, err) => {
        if (err) st.errAprobar = 'No se pudieron cargar las solicitudes por aprobar.';
        else { st.errAprobar = ''; st.aprobar = l.filter(s => String(s.empleadoId) !== yo.id); }
        if (st.enlace && st.enlace.id && st.aprobar && st.aprobar.some(s => s.id === st.enlace.id)) st.tab = 'aprobar';
        pintar();
      }));
    })();
    pintar();
    cont._pm = { destruir() { st.subs.forEach(u => { try { u(); } catch (e) { } }); cont._pm = null; } };
  }

  // ---------------------------------------------------------------- panel de supervisor
  function montarPanel(cont, opts) {
    if (!cont || !opts || !opts.usuario) return;
    if (cont._pm) { if (opts.enlace) cont._pm.enlace(opts.enlace); return; }
    const yo = { id: String(opts.usuario.id || ''), nombre: opts.usuario.nombre || '' };
    const st = { tab: 'bandeja', filtro: 'PEND', busca: '', lista: null, err: '', tthh: false, cfg: { tthh: [] }, enlace: opts.enlace || null, subs: [] };
    const empleados = () => (typeof window.todoElPersonal === 'function' ? window.todoElPersonal() : (window.empCache || [])).filter(activo);
    cont.innerHTML = `<div class="pm-panel">
      <div class="pm-pcab">
        <nav class="pm-tabs" role="tablist">
          <button type="button" role="tab" data-tab="bandeja" aria-selected="true">Solicitudes</button>
          <button type="button" role="tab" data-tab="tthh" aria-selected="false">Personas de TTHH</button>
        </nav>
        <button type="button" class="pm-btn pm-btn-sec" data-pm="a-nombre"><i class="fas fa-user-plus"></i> Registrar médico o calamidad</button>
      </div>
      <div class="pm-cuerpo"></div></div>`;
    const cuerpo = cont.querySelector('.pm-cuerpo');
    const puedeResolver = () => st.tthh || opts.admin;

    function filtrar() {
      const q = st.busca.trim().toLowerCase();
      return (st.lista || []).filter(s => {
        if (st.filtro === 'PEND' && !PENDIENTES.includes(s.estado)) return false;
        if (st.filtro === 'DOCS' && !(s.estado === 'REGISTRADA' && s.docs_estado === 'PENDIENTE')) return false;
        if (!q) return true;
        return [s.nombre, s.empleadoId, s.area, s.motivo, s.aprobador_nombre, (TIPOS[s.tipo] || {}).label].some(v => String(v || '').toLowerCase().includes(q));
      });
    }
    function pintar() {
      cont.querySelectorAll('.pm-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === st.tab ? 'true' : 'false'));
      cont.querySelector('[data-pm="a-nombre"]').hidden = !puedeResolver();
      if (st.tab === 'tthh') { pintarTTHH(); return; }
      const pendientes = (st.lista || []).filter(s => PENDIENTES.includes(s.estado)).length;
      const docs = (st.lista || []).filter(s => s.estado === 'REGISTRADA' && s.docs_estado === 'PENDIENTE').length;
      const avisoTthh = !st.cfg.tthh.length ? '<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No hay personas de TTHH configuradas: las solicitudes sin jefe y las que pasan a TTHH llegan a los supervisores administradores. Configúralas en «Personas de TTHH».</div>' : '';
      const filtros = `<div class="pm-filtros">
        <div class="pm-seg" role="group" aria-label="Filtro">
          <button type="button" data-filtro="PEND" aria-pressed="${st.filtro === 'PEND'}">Pendientes (${pendientes})</button>
          <button type="button" data-filtro="DOCS" aria-pressed="${st.filtro === 'DOCS'}">Faltan documentos (${docs})</button>
          <button type="button" data-filtro="TODAS" aria-pressed="${st.filtro === 'TODAS'}">Todas</button>
        </div>
        <input type="search" class="pm-campo pm-buscar" id="pmBuscar" placeholder="Buscar por nombre, ID, área o motivo" value="${esc(st.busca)}" aria-label="Buscar">
      </div>`;
      let html;
      if (st.err) html = `<div class="pm-vacio">${esc(st.err)}</div>`;
      else if (!st.lista) html = '<div class="pm-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
      else {
        const l = filtrar();
        html = l.length ? `<div class="pm-grid">${l.slice(0, 200).map(s => tarjeta(s, {
          conNombre: true, comoAprobador: true, yoId: yo.id,
          acciones: x => PENDIENTES.includes(x.estado) && puedeResolver() && String(x.empleadoId) !== yo.id
            ? `<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-resolver="RECHAZAR" data-id="${esc(x.id)}"><i class="fas fa-times"></i> No aprobar</button>
               <button type="button" class="pm-btn pm-btn-verde pm-btn-chico" data-resolver="APROBAR" data-id="${esc(x.id)}"><i class="fas fa-check"></i> Aprobar${x.estado === 'PENDIENTE_JEFE' ? ' (en lugar del jefe)' : ''}</button>` : ''
        })).join('')}</div>` : `<div class="pm-vacio"><i class="fas fa-inbox"></i><strong>${st.filtro === 'PEND' ? 'No hay solicitudes pendientes' : 'Sin resultados'}</strong></div>`;
      }
      cuerpo.innerHTML = avisoTthh + (puedeResolver() ? '' : '<div class="pm-sub pm-nota">Solo las personas de TTHH y los administradores pueden aprobar desde aquí. Los jefes aprueban desde la app.</div>') + filtros + html;
      const b = cuerpo.querySelector('#pmBuscar');
      if (b) b.addEventListener('input', () => { st.busca = b.value; const pos = b.selectionStart; pintar(); const nb = cuerpo.querySelector('#pmBuscar'); nb.focus(); nb.setSelectionRange(pos, pos); });
      if (st.enlace && st.enlace.id) {
        const el = cuerpo.querySelector(`[data-id="${CSS.escape(st.enlace.id)}"]`);
        if (el) { el.classList.add('pm-destacada'); el.scrollIntoView({ block: 'center' }); st.enlace = null; }
        else if (st.lista && st.filtro !== 'TODAS') { st.filtro = 'TODAS'; pintar(); }
      }
    }
    function pintarTTHH() {
      const ids = st.cfg.tthh.map(x => x.id);
      const opciones = empleados().filter(e => !ids.includes(String(e.id))).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      cuerpo.innerHTML = `<section class="pm-config">
        <h3 class="pm-h3">Personas de TTHH</h3>
        <p class="pm-sub">Reciben las solicitudes sin jefe asignado y las que el jefe no responde en 8 horas laborables, los avisos de permisos médicos y calamidades, y pueden aprobar o rechazar cualquier solicitud pendiente desde la app o este panel.</p>
        <ul class="pm-personas">${st.cfg.tthh.length ? st.cfg.tthh.map(x => `<li><span><i class="fas fa-user"></i> ${esc(nombreCorto(x.nombre))} <span class="pm-sub">· ${esc(x.id)}</span></span>
          ${opts.admin ? `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-quitar="${esc(x.id)}">Quitar</button>` : ''}</li>`).join('') : '<li class="pm-sub">Nadie configurado todavía.</li>'}</ul>
        ${opts.admin ? `<div class="pm-fila pm-fila-agregar"><select id="pmNuevoTthh" class="pm-campo" aria-label="Persona a agregar"><option value="">Agregar persona…</option>${opciones.map(e => `<option value="${esc(e.id)}">${esc(nombreCorto(e.nombre))} · ${esc(e.id)}${e.area ? ' · ' + esc(e.area) : ''}</option>`).join('')}</select>
          <button type="button" class="pm-btn pm-btn-pri" data-pm="agregar-tthh"><i class="fas fa-plus"></i> Agregar</button></div>` : '<p class="pm-sub">Solo los administradores pueden cambiar esta lista.</p>'}
      </section>`;
    }
    async function guardarLista(nueva) {
      try { await guardarTTHH(nueva, yo.nombre || yo.id); st.cfg = { tthh: nueva }; st.tthh = nueva.some(x => x.id === yo.id); toast('Lista de TTHH guardada', 'success'); }
      catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'error'); }
      pintar();
    }

    cont.addEventListener('click', async ev => {
      const t = ev.target;
      const tab = t.closest('.pm-tabs [data-tab]');
      if (tab) { st.tab = tab.dataset.tab; pintar(); return; }
      const f = t.closest('[data-filtro]');
      if (f) { st.filtro = f.dataset.filtro; pintar(); return; }
      const res = t.closest('[data-resolver]');
      if (res) { const s = (st.lista || []).find(x => x.id === res.dataset.id); if (s) accionResolver(res, s, res.dataset.resolver, yo, !!opts.admin); return; }
      const q = t.closest('[data-quitar]');
      if (q) { await guardarLista(st.cfg.tthh.filter(x => x.id !== q.dataset.quitar)); return; }
      if (t.closest('[data-pm="agregar-tthh"]')) {
        const id = cuerpo.querySelector('#pmNuevoTthh').value;
        const e = empleados().find(x => String(x.id) === id);
        if (!e) { toast('Elige una persona', 'error'); return; }
        await guardarLista(st.cfg.tthh.concat([{ id: String(e.id), nombre: e.nombre || '' }]));
        return;
      }
      if (t.closest('[data-pm="a-nombre"]')) {
        abrirFormulario({
          elegirEmpleado: empleados().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
          tiposPermitidos: ['PERMISO_MEDICO', 'CALAMIDAD'],
          creadoPor: { id: yo.id, nombre: yo.nombre, rol: st.tthh ? 'TTHH' : 'ADMIN' },
          onCreada: () => { st.filtro = 'TODAS'; st.tab = 'bandeja'; pintar(); }
        });
      }
    });

    (async () => {
      st.cfg = await leerConfig(true);
      st.tthh = st.cfg.tthh.some(x => x.id === yo.id);
      pintar();
    })();
    st.subs.push(escuchar(db().collection(COL), (l, err) => {
      if (err) st.err = 'No se pudieron cargar las solicitudes.'; else { st.err = ''; st.lista = l; }
      if (typeof opts.onPendientes === 'function' && st.lista) opts.onPendientes(st.lista.filter(s => PENDIENTES.includes(s.estado)).length);
      if (st.tab === 'bandeja') pintar();
    }));
    pintar();
    cont._pm = {
      enlace(e) { st.enlace = e; st.tab = 'bandeja'; pintar(); },
      destruir() { st.subs.forEach(u => { try { u(); } catch (e) { } }); cont._pm = null; }
    };
  }

  window.Permisos = {
    montarApp, montarPanel, abrirFormulario, contarPorAprobar,
    crearSolicitud, resolver, cancelar, leerConfig, esTTHH,
    _internos: { fechasLaborables, sumarMinutosLaborables, esLaborable, planBolsa, saldoVacaciones }
  };
})();
