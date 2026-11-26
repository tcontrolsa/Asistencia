/**
 * TCONTROL · Solicitudes de permisos y vacaciones (fase 1 del flujo de permisos, 2026-11-10)
 * Compartido por index.html (app → Permisos) y supervisor.html (panel → Permisos).
 *
 * Flujo (desde 2026-11-25): toda solicitud (vacaciones, permiso personal, permiso médico y calamidad) espera la
 * aprobación o el rechazo del jefe inmediato (empleados.jefe_inmediato_id). Sin esa respuesta no es válida y no llega
 * a TTHH: no justifica nada, no crea registros y TTHH no la ve ni recibe avisos.
 *   Sin jefe asignado, jefe inactivo o jefe = el mismo colaborador → la aprueba o rechaza TTHH en lugar del jefe.
 *   Un administrador del panel puede responder en lugar del jefe; TTHH no.
 *   Sin respuesta al llegar el inicio del permiso → CADUCADA («No válida»). Plazo en caduca_en (ver caducidad()):
 *     lo aplica la app al leer y lo escribe y avisa Apps Script (permisos_escalado.gs), que también recuerda al jefe.
 *   Vacaciones sin saldo suficiente: se permite si el colaborador acepta el descuento al rol.
 *   Permiso personal: solo por horas.
 *   Eliminar (solo administradores, en el panel): queda como CANCELADA con eliminada = true, deja de verse en la app y
 *     se deshace lo que produjo (registros de asistencia, horas cargadas a vacaciones). El documento se conserva como
 *     constancia en el filtro «Eliminadas».
 *   Permiso médico y calamidad: al aprobarse quedan REGISTRADA, se avisa a TTHH y empiezan las 72 h de documentos.
 *   Al aprobarse una solicitud por días se crean los registros de ausencia en asistencia
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
  const MIN_RESPUESTA = 8 * 60;             // plazo mínimo cuando el permiso ya empezó: 8 horas laborables
  const JORNADA = { ini: 7 * 60 + 30, fin: 16 * 60 + 15 };   // 07:30–16:15 (HORA_ENTRADA_REF / HORA_SALIDA_REF)
  const DIAS_ATRAS_CALAMIDAD = 30;
  const FERIADOS_MD = ['1/1', '2/16', '2/17', '4/3', '4/30', '5/1', '5/25', '8/10', '10/9', '11/2', '11/3', '12/6', '12/25'];
  const FERIADOS_FECHA = ['2026-06-26', '2026-11-20'];

  const TIPOS = {
    VACACIONES: { label: 'Vacaciones', icono: 'fa-umbrella-beach', color: 'pm-c-azul', modalidades: ['DIAS'], registro: 'VACACIONES',
      ayuda: 'Días completos. Los aprueba tu jefe inmediato.' },
    PERMISO_PERSONAL: { label: 'Permiso personal', icono: 'fa-user-clock', color: 'pm-c-violeta', modalidades: ['HORAS'], registro: 'PERMISO_PERSONAL',
      ayuda: 'Solo por horas. Lo aprueba tu jefe inmediato.' },
    PERMISO_MEDICO: { label: 'Permiso médico', icono: 'fa-notes-medical', color: 'pm-c-verde', documentos: true, modalidades: ['HORAS', 'DIAS'], registro: 'PERMISO_MEDICO',
      ayuda: 'Lo aprueba tu jefe inmediato. Después, certificado a TTHH en 72 h.' },
    CALAMIDAD: { label: 'Calamidad doméstica', icono: 'fa-exclamation-circle', color: 'pm-c-rojo', documentos: true, modalidades: ['DIAS'], registro: 'FALTA_JUSTIFICADA',
      ayuda: 'Puede pedirse después. La aprueba tu jefe; luego, documentos a TTHH en 72 h.' }
  };
  const ESTADOS = {
    PENDIENTE_JEFE: { txt: 'Espera a tu jefe', txtAprob: 'Por aprobar', clase: 'pm-e-pend' },
    PENDIENTE_TTHH: { txt: 'Espera a TTHH', txtAprob: 'Por aprobar (TTHH)', clase: 'pm-e-tthh' },
    APROBADA: { txt: 'Aprobada', clase: 'pm-e-ok' },
    RECHAZADA: { txt: 'No aprobada', clase: 'pm-e-no' },
    CANCELADA: { txt: 'Cancelada', clase: 'pm-e-gris' },
    CADUCADA: { txt: 'No válida', clase: 'pm-e-no' },
    REGISTRADA: { txt: 'Registrada', clase: 'pm-e-ok' }
  };
  const PENDIENTES = ['PENDIENTE_JEFE', 'PENDIENTE_TTHH'];
  const SIN_EFECTO = ['RECHAZADA', 'CANCELADA', 'CADUCADA'];
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
  // Horas de la jornada para el formulario, en 24 h y cada 15 min (el selector del teléfono pedía AM/PM)
  const PASO_HORA = 15;
  const hm24 = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  function opcionesHora(desde, hasta, elegida, uso) {
    const out = [];
    for (let m = desde; m <= hasta; m += PASO_HORA) out.push(m);
    if (uso === 'regresa' && out[out.length - 1] !== JORNADA.fin) out.push(JORNADA.fin);
    const sel = out.includes(elegida) ? elegida : out[0];
    return out.map(m => {
      const nota = m === JORNADA.fin ? ' · fin de la jornada' : (m === JORNADA.ini && uso === 'sale' ? ' · inicio de la jornada' : '');
      return `<option value="${hm24(m)}"${m === sel ? ' selected' : ''}>${hm24(m)}${nota}</option>`;
    }).join('');
  }
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

  // ---------------------------------------------------------------- plazo para responder
  const inicioPermiso = s => s.modalidad === 'HORAS' && s.hora_desde
    ? new Date(`${s.desde}T${String(s.hora_desde).slice(0, 5)}:00`)
    : new Date(`${(s.fechas || [])[0] || s.desde}T${hm24(JORNADA.ini)}:00`);
  // Hasta cuándo se puede responder: el inicio del permiso. Si al pedirlo ya empezó («Hoy no vengo», permiso marcado
  // al salir o al entrar, calamidad posterior), y siempre en permiso médico y calamidad (no se planifican), el plazo
  // es de al menos 8 horas laborables.
  function caducidad(s, ahora) {
    const ini = inicioPermiso(s);
    if (!s.origen && !(TIPOS[s.tipo] || {}).documentos && ini > ahora) return ini;
    const minimo = sumarMinutosLaborables(ahora, MIN_RESPUESTA);
    return minimo > ini ? minimo : ini;
  }
  // Las pedidas antes del 2026-11-25 no traen caduca_en: el inicio del permiso o el plazo que tenía el jefe, lo último
  function caducaEn(s) {
    if (s.caduca_en) return new Date(s.caduca_en);
    const ini = inicioPermiso(s), jefe = new Date(s.vence_jefe || s.creada_en || 0);
    return jefe > ini ? jefe : ini;
  }
  // Solicitud tal como vale ahora: una pendiente con el plazo cumplido ya no es válida aunque el servidor aún no la
  // haya marcado
  function vigente(s) {
    if (!PENDIENTES.includes(s.estado)) return s;
    const c = caducaEn(s);
    return c <= new Date() ? Object.assign({}, s, { estado: 'CADUCADA', caduca_en: c.toISOString() }) : s;
  }
  const deDoc = d => vigente(Object.assign({ id: d.id }, d.data()));
  // TTHH solo recibe lo aprobado; lo de quien no tiene jefe lo responde TTHH (escalada)
  const visibleTTHH = s => ['APROBADA', 'REGISTRADA', 'PENDIENTE_TTHH'].includes(s.estado) || !!s.escalada;

  // ---------------------------------------------------------------- configuración (lista TTHH)
  let _cfg = null, _cfgEn = 0;
  async function leerConfig(forzar = false) {
    if (!forzar && _cfg && Date.now() - _cfgEn < 60000) return _cfg;
    try {
      const snap = await db().collection(CFG_DOC[0]).doc(CFG_DOC[1]).get();
      const d = snap.exists ? snap.data() : {};
      _cfg = {
        tthh: Array.isArray(d.tthh) ? d.tthh.filter(x => x && x.id).map(x => ({ id: String(x.id), nombre: x.nombre || '' })) : [],
        // El colaborador ve sus vacaciones solo en días completos (las fracciones, en el panel). Por defecto sí.
        vacacionesSoloDias: d.vacaciones_solo_dias !== false
      };
    } catch (e) {
      console.warn('Permisos: configuración no leída', e);
      _cfg = _cfg || { tthh: [], vacacionesSoloDias: true };
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
    _cfg = Object.assign({ vacacionesSoloDias: true }, _cfg, { tthh });
    _cfgEn = Date.now();
  }
  async function guardarVistaVacaciones(soloDias, quien) {
    await db().collection(CFG_DOC[0]).doc(CFG_DOC[1]).set({ vacaciones_solo_dias: !!soloDias, actualizado_por: quien || '', actualizado_en: ahoraIso() }, { merge: true });
    _cfg = Object.assign({ tthh: [] }, _cfg, { vacacionesSoloDias: !!soloDias });
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
  const MOTIVO_TTHH = { sin_jefe: 'No tienes jefe inmediato asignado', propio: 'Tu ficha te tiene como tu propio jefe', jefe_inactivo: 'Tu jefe inmediato no está activo', sin_respuesta: 'El jefe no respondió a tiempo' };
  // Lo mismo dicho a TTHH o al jefe (tercera persona)
  const MOTIVO_TTHH_3 = { sin_jefe: "No tiene jefe inmediato asignado", propio: "Su ficha lo tiene como su propio jefe", jefe_inactivo: "Su jefe inmediato no está activo", sin_respuesta: "El jefe no respondió a tiempo" };

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
        const s = deDoc(doc);
        if (doc.id === excluirId || !['PENDIENTE_JEFE', 'PENDIENTE_TTHH', 'APROBADA'].includes(s.estado)) return;
        if (s.tipo === 'VACACIONES') comprometidos += (s.fechas || []).filter(f => f > hoy).length;
        // Horas a vacaciones: se acumulan sin cortar por año (lo que al 30/nov no llega a 8 h pasa al año siguiente)
        if (s.tipo !== 'PERMISO_PERSONAL' || s.desde > pv.fin) return;
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
    const solicitudes = otras.docs.map(deDoc);

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
      s -= reservadoBolsa(solicitudes, per, hoy, excluirId);
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

  // ---------------------------------------------------------------- resumen de tiempo (bolsa, vacaciones, rol)
  // Bolsa de 4 h ya reservada por permisos personales de hoy en adelante dentro del período (pedidos, o aprobados
  // por horas: los aprobados por días ya tienen su registro y el cálculo del panel los ve).
  function reservadoBolsa(solicitudes, per, hoy, excluirId = '') {
    let r = 0;
    (solicitudes || []).forEach(o => {
      if (o.id === excluirId || o.tipo !== 'PERMISO_PERSONAL') return;
      const pend = PENDIENTES.includes(o.estado);
      const aprobHoras = o.estado === 'APROBADA' && o.modalidad === 'HORAS';
      if (!pend && !aprobHoras) return;
      const porDia = aprobHoras ? (o.bolsa_por_dia || {}) : ((o.plan_bolsa || {}).bolsa_por_dia || {});
      Object.keys(porDia).forEach(f => { if (f >= hoy && f >= per.inicio && f <= per.fin) r += Number(porDia[f]) || 0; });
    });
    return r;
  }

  /**
   * Cuánto tiempo lleva el colaborador, con el MISMO cálculo del panel (ReglasJornada):
   *   bolsa      bolsa de 4 h del período 26–25: usado (atrasos, faltantes, permisos ya ocurridos) y reservado
   *              por permisos que vienen. No pasa al período siguiente.
   *   vacaciones horas de permiso personal cargadas a vacaciones en el año dic–nov: cada 8 h es 1 día.
   *   rol        descuento al rol del período: lo que ya superó la bolsa y lo programado por permisos.
   */
  async function resumenTiempo(empId) {
    const RJ = window.ReglasJornada;
    if (!RJ) throw new Error('Falta el cálculo de la bolsa (reglas_jornada.js)');
    const emp = (await leerEmpleado(empId)) || { id: String(empId) };
    const hoy = hoyStr();
    const FB = window.FirebaseBackend;
    if (!window._ajustesDescanso && FB && typeof FB.cargarAjustesDescanso === 'function') await FB.cargarAjustesDescanso();
    const [regs, vac, snap] = await Promise.all([
      registrosDe(emp.id),
      saldoVacaciones(emp),
      db().collection(COL).where('empleadoId', '==', String(emp.id)).get()
    ]);
    const sols = snap.docs.map(deDoc);
    const b = RJ.saldoBolsaPeriodo({ empleado: Object.assign({}, emp, { registros: regs }), registros: regs, vacaciones: (vac && vac.vacaciones) || [], hoy, solicitudes: sols });
    const per = b.periodo;
    const total = b.pasante ? 0 : RJ.BOLSA_MIN;
    const reservado = Math.min(Math.max(0, b.saldo), reservadoBolsa(sols, per, hoy));

    // Desde el 26/11/2026 lo que supera la bolsa va primero a vacaciones: el reparto oficial lo deja Apps Script cada
    // noche en la ficha (cargos_jornada); lo de hoy y lo que cambió después se muestra «por calcular».
    let rolOcurrido = 0, aVacJornada = 0, porCalcular = 0;
    const CJ = RJ.cargosJornadaDe ? RJ.cargosJornadaDe(emp) : { por_dia: {}, hasta: '' };
    Object.keys(b.mapa || {}).forEach(f => {
      if (f < per.inicio || f > per.fin) return;
      const n = Number(b.mapa[f].descuentoNeto) || 0;
      if (!RJ.CARGO_VACACIONES_DESDE || f < RJ.CARGO_VACACIONES_DESDE) { rolOcurrido += n; return; }
      const c = CJ.por_dia[f];
      if (c && f <= CJ.hasta) { rolOcurrido += Number(c.rol) || 0; aVacJornada += Number(c.vac) || 0; }
      else porCalcular += n;
    });
    let rolProgramado = 0;
    const pv = periodoVacacionesDe(hoy);
    let vacAprobadasMin = 0, vacAntesMin = 0, vacPorAprobarMin = 0, diasSinSaldo = 0;
    sols.forEach(s => {
      if (!['PENDIENTE_JEFE', 'PENDIENTE_TTHH', 'APROBADA'].includes(s.estado)) return;
      const aprob = s.estado === 'APROBADA';
      if (s.tipo === 'PERMISO_PERSONAL') {
        const rol = aprob ? s.rol_por_dia : (s.plan_bolsa || {}).rol_por_dia;
        Object.keys(rol || {}).forEach(f => { if (f >= hoy && f >= per.inicio && f <= per.fin) rolProgramado += Number(rol[f]) || 0; });
        // Horas a vacaciones acumuladas sin cortar por año (las que no llegan a 8 h pasan al año siguiente)
        if (s.desde <= pv.fin) {
          if (aprob) {
            vacAprobadasMin += Number(s.cargo_vacaciones_min) || 0;
            if (s.desde < pv.inicio) vacAntesMin += Number(s.cargo_vacaciones_min) || 0;
          } else vacPorAprobarMin += Number((s.plan_bolsa || {}).vacaciones_min) || 0;
        }
      }
      if (s.tipo === 'VACACIONES' && s.acepta_descuento && s.desde >= pv.inicio && s.desde <= pv.fin) diasSinSaldo += Number(s.dias_sin_saldo) || 0;
    });
    // Atrasos y faltantes cargados a vacaciones (desde el 26/11/2026): cuentan igual que las horas de permisos
    Object.keys(CJ.por_dia).forEach(f => {
      const v = Number(CJ.por_dia[f].vac) || 0;
      if (!v || f > pv.fin) return;
      vacAprobadasMin += v;
      if (f < pv.inicio) vacAntesMin += v;
    });
    return {
      emp: { id: String(emp.id), nombre: emp.nombre || '' }, hoy, calculado: new Date(),
      bolsa: { periodo: per, total, usado: Math.max(0, total - b.saldo), reservado, libre: Math.max(0, b.saldo - reservado), pasante: !!b.pasante },
      vacaciones: {
        periodo: pv, aprobadasMin: vacAprobadasMin, porAprobarMin: vacPorAprobarMin,
        diasPorHoras: Math.floor(vacAprobadasMin / MIN_DIA) - Math.floor(vacAntesMin / MIN_DIA),
        haciaSiguiente: vacAprobadasMin % MIN_DIA, arrastre: vacAntesMin % MIN_DIA,
        saldoDias: vac ? vac.disponible : null, comprometidos: vac ? vac.comprometidos : 0, diasSinSaldo
      },
      rol: { periodo: per, ocurrido: rolOcurrido, programado: rolProgramado, aVacaciones: aVacJornada, porCalcular }
    };
  }

  const pct = (a, t) => t > 0 ? Math.max(0, Math.min(100, Math.round(a / t * 1000) / 10)) : 0;
  const fechaDM = f => fechaCorta(f).slice(0, 5);
  const diaSiguiente = f => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + 1); return fechaStr(d); };

  // opts.panel: textos en tercera persona (Detalle de Empleado del panel)
  function htmlResumenTiempo(r, opts = {}) {
    const B = r.bolsa, V = r.vacaciones, R = r.rol;
    const panel = !!opts.panel;
    const perTxt = `${fechaDM(B.periodo.inicio)} – ${fechaDM(B.periodo.fin)}`;
    const bolsa = B.pasante
      ? `<div class="pm-tnum">Sin bolsa</div><div class="pm-sub">Los pasantes no tienen bolsa de 4 horas.</div>`
      : `<div class="pm-tnum">${durTxt(B.libre)} <small>libres de ${durTxt(B.total)}</small></div>
        <div class="pm-barra" role="progressbar" aria-label="Bolsa de 4 horas usada" aria-valuemin="0" aria-valuemax="${B.total}" aria-valuenow="${B.usado + B.reservado}">
          <span class="pm-b-usado" style="width:${pct(B.usado, B.total)}%"></span><span class="pm-b-reserva" style="width:${pct(B.reservado, B.total)}%"></span></div>
        <div class="pm-leyenda"><span><i class="pm-p pm-b-usado"></i>Usado ${durTxt(B.usado)}</span>${B.reservado ? `<span><i class="pm-p pm-b-reserva"></i>Reservado ${durTxt(B.reservado)}</span>` : ''}</div>
        <div class="pm-sub">Cubre atrasos, faltantes y permisos personales. Se renueva el ${fechaDM(diaSiguiente(B.periodo.fin))}: lo que no ${panel ? 'use' : 'uses'} no pasa al siguiente período.</div>`;
    const conPend = V.haciaSiguiente + V.porAprobarMin;
    const vacaciones = `<div class="pm-tnum">${durTxt(V.haciaSiguiente)} <small>de 8 h para el próximo día</small></div>
        <div class="pm-barra" role="progressbar" aria-label="Horas acumuladas para el próximo día de vacación" aria-valuemin="0" aria-valuemax="${MIN_DIA}" aria-valuenow="${V.haciaSiguiente}">
          <span class="pm-b-vac" style="width:${pct(V.haciaSiguiente, MIN_DIA)}%"></span><span class="pm-b-reserva" style="width:${pct(Math.min(V.porAprobarMin, Math.max(0, MIN_DIA - V.haciaSiguiente)), MIN_DIA)}%"></span></div>
        <div class="pm-leyenda"><span><i class="pm-p pm-b-vac"></i>Aprobado ${durTxt(V.haciaSiguiente)}</span>${V.porAprobarMin ? `<span><i class="pm-p pm-b-reserva"></i>Por aprobar ${durTxt(V.porAprobarMin)}</span>` : ''}</div>
        <ul class="pm-tlista">
          ${V.arrastre ? `<li><span>Horas que vienen del año anterior</span><strong>${durTxt(V.arrastre)}</strong></li>` : ''}
          <li><span>Días descontados por horas este año (permisos, atrasos y faltantes)</span><strong>${V.diasPorHoras}</strong></li>
          ${conPend >= MIN_DIA ? `<li class="pm-tavisa"><span>Si se aprueba lo pendiente, se descuenta</span><strong>${Math.floor(conPend / MIN_DIA)} día${Math.floor(conPend / MIN_DIA) === 1 ? '' : 's'} más</strong></li>` : ''}
          <li><span>Saldo de vacaciones disponible</span><strong>${V.saldoDias === null ? '—' : `${Math.floor(V.saldoDias)} día${Math.floor(V.saldoDias) === 1 ? '' : 's'}`}</strong></li>
          ${V.diasSinSaldo ? `<li class="pm-tavisa"><span>Vacaciones pedidas sin saldo (van al rol)</span><strong>${V.diasSinSaldo} día${V.diasSinSaldo === 1 ? '' : 's'}</strong></li>` : ''}
        </ul>
        <div class="pm-sub">Año de vacaciones ${fechaCorta(V.periodo.inicio)} – ${fechaCorta(V.periodo.fin)}. Cada 8 h que no cubre la bolsa (permisos y, desde el 26/11/2026, atrasos y faltantes) descuentan 1 día; lo que al 30/11 no llegue a 8 h pasa al año siguiente.</div>`;
    // Vista del colaborador (2026-11-12): solo días completos; las horas acumuladas hacia el próximo día las ve el panel
    const diasPend = Math.floor(conPend / MIN_DIA);
    const saldoEntero = V.saldoDias === null ? null : Math.max(0, Math.floor(V.saldoDias));
    const vacacionesColab = `<div class="pm-tnum">${saldoEntero === null ? '—' : `${saldoEntero} día${saldoEntero === 1 ? '' : 's'}`} <small>disponibles</small></div>
        <ul class="pm-tlista">
          <li><span>Días descontados por permisos, atrasos y faltantes este año</span><strong>${V.diasPorHoras}</strong></li>
          ${diasPend ? `<li class="pm-tavisa"><span>Si se aprueba lo pendiente, se descuenta</span><strong>${diasPend} día${diasPend === 1 ? '' : 's'} más</strong></li>` : ''}
          ${V.diasSinSaldo ? `<li class="pm-tavisa"><span>Vacaciones pedidas sin saldo (van al rol)</span><strong>${V.diasSinSaldo} día${V.diasSinSaldo === 1 ? '' : 's'}</strong></li>` : ''}
        </ul>
        <div class="pm-sub">Año de vacaciones ${fechaCorta(V.periodo.inicio)} – ${fechaCorta(V.periodo.fin)}. Cada 8 h que no cubre la bolsa (permisos, atrasos y faltantes) descuentan 1 día de vacaciones.</div>`;
    const totalRol = R.ocurrido + R.programado;
    const rol = `<div class="pm-tnum ${totalRol ? 'pm-c-rojo' : 'pm-c-verde'}">${totalRol ? durTxt(totalRol) : 'Sin descuento'}</div>
        <ul class="pm-tlista">
          <li><span>Atrasos, faltantes y permisos que ya superaron la bolsa y las vacaciones</span><strong>${R.ocurrido ? durTxt(R.ocurrido) : '0'}</strong></li>
          <li><span>Permisos que vienen y no tienen saldo</span><strong>${R.programado ? durTxt(R.programado) : '0'}</strong></li>
          ${R.aVacaciones ? `<li><span>Atrasos y faltantes cargados a vacaciones</span><strong>${durTxt(R.aVacaciones)}</strong></li>` : ''}
          ${R.porCalcular ? `<li class="pm-tavisa"><span>Por calcular esta noche (va a vacaciones si hay saldo; si no, al rol)</span><strong>${durTxt(R.porCalcular)}</strong></li>` : ''}
        </ul>
        <div class="pm-sub">Período de nómina ${perTxt}. Desde el 26/11/2026 lo que no cubre la bolsa se descuenta de las vacaciones (8 h = 1 día); solo sin saldo de vacaciones va al rol.</div>`;
    const tarjeta = (icono, color, titulo, sub, cuerpo) => `<article class="pm-tcard"><div class="pm-tcard-cab"><i class="fas ${icono} ${color}" aria-hidden="true"></i><div><h4>${titulo}</h4><div class="pm-sub">${sub}</div></div></div>${cuerpo}</article>`;
    return `<div class="pm-tcab"><h3>${panel ? 'Tiempo de permisos · período actual' : 'Mi tiempo de permisos'}</h3>
        <button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-pm="tiempo" title="Volver a calcular"><i class="fas fa-rotate"></i> ${r.calculado.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</button></div>
      <div class="pm-tgrid">
        ${tarjeta('fa-piggy-bank', 'pm-c-violeta', 'Bolsa de 4 horas', `Período ${perTxt}`, bolsa)}
        ${panel ? tarjeta('fa-umbrella-beach', 'pm-c-azul', 'Horas a vacaciones', 'Permisos, atrasos y faltantes cargados a sus vacaciones', vacaciones)
                : opts.soloDias === false ? tarjeta('fa-umbrella-beach', 'pm-c-azul', 'Horas a vacaciones', 'Permisos, atrasos y faltantes cargados a tus vacaciones', vacaciones)
                : tarjeta('fa-umbrella-beach', 'pm-c-azul', 'Vacaciones', 'Saldo en días completos', vacacionesColab)}
        ${tarjeta('fa-file-invoice-dollar', totalRol ? 'pm-c-rojo' : 'pm-c-verde', 'Descuento al rol', `Período ${perTxt}`, rol)}
      </div>`;
  }

  // Pinta el resumen en un contenedor; se puede volver a llamar para recalcular.
  // opts: { panel (tercera persona), cacheMs (reusar el último cálculo de ese colaborador), forzar }
  const _cacheResumen = {};
  async function montarResumenTiempo(cont, empId, opts = {}) {
    if (!cont || !empId) return;
    const panel = !!opts.panel;
    if (!cont._pmClick) {   // botón de recalcular / reintentar del propio resumen (la app también lo maneja: se ignora el doble)
      cont._pmClick = true;
      cont.addEventListener('click', ev => {
        if (!ev.target.closest('[data-pm="tiempo"]') || cont.closest('.pm-app')) return;
        montarResumenTiempo(cont, cont._pmEmp, Object.assign({}, cont._pmOpts, { forzar: true }));
      });
    }
    if (!panel) { try { opts = Object.assign({}, opts, { soloDias: (await leerConfig()).vacacionesSoloDias }); } catch (e) { } }
    cont._pmEmp = String(empId); cont._pmOpts = opts;
    const c = _cacheResumen[String(empId)];
    if (!opts.forzar && opts.cacheMs && c && Date.now() - c.en < opts.cacheMs) { cont.innerHTML = htmlResumenTiempo(c.r, opts); return; }
    const seq = (cont._pmSeq = (cont._pmSeq || 0) + 1);
    if (!cont.innerHTML.trim()) cont.innerHTML = `<div class="pm-tcarga"><i class="fas fa-spinner fa-spin"></i> Calculando ${panel ? 'la' : 'tu'} bolsa, vacaciones y descuentos…</div>`;
    else cont.classList.add('pm-tactualiza');
    try {
      const r = await resumenTiempo(empId);
      _cacheResumen[String(empId)] = { r, en: Date.now() };
      if (seq !== cont._pmSeq) return;
      cont.innerHTML = htmlResumenTiempo(r, opts);
    } catch (e) {
      if (seq !== cont._pmSeq) return;
      cont.innerHTML = `<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No se pudo calcular ${panel ? 'el' : 'tu'} tiempo de permisos: ${esc(e.message || e)}. <button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-pm="tiempo">Reintentar</button></div>`;
    } finally { cont.classList.remove('pm-tactualiza'); }
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
    if (p.tipo === 'PERMISO_PERSONAL' && p.modalidad === 'DIAS') return { error: 'El permiso personal se pide solo por horas' };
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
      // Solo tiempo de jornada (07:30–16:15), sin el receso ni el almuerzo que caen dentro: es el faltante
      // que ve el cálculo de la bolsa del panel (2026-11-12; antes se contaba regreso − salida)
      minutos = minutosJornada(a, b);
      if (!minutos) return { error: 'El permiso debe estar dentro de la jornada (07:30 a 16:15)' };
      // Se pide antes de la hora para que alcance a aprobarse (el que nace al marcar ya empezó)
      if (p.tipo === 'PERMISO_PERSONAL' && !p.origen && new Date(`${desde}T${horaDesde}:00`) <= new Date()) return { error: 'Esa hora ya pasó: pide el permiso antes de la hora de salida' };
    }
    if (!motivo && p.tipo !== 'VACACIONES') return { error: 'Escribe el motivo' };

    // No se puede pedir dos veces el mismo día (salvo permisos por horas en horas distintas)
    const previas = await db().collection(COL).where('empleadoId', '==', String(emp.id)).get();
    let choque = null;
    previas.forEach(doc => {
      const s = deDoc(doc);
      if (choque || SIN_EFECTO.includes(s.estado)) return;
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
    // Fase 5: creada al marcar salida o entrada tardía en la app
    if (p.origen) {
      sol.origen = p.origen;
      sol.regreso_pendiente = !!p.regresoPendiente;
      sol.marcaciones = [{ origen: p.origen, registro: String(p.registroId || ''), hora: horaDesde, en: ahora.toISOString() }];
    }

    // Permiso personal: reparto bolsa / vacaciones / rol (fase 2). Si algo no cabe en la bolsa, el colaborador
    // debe haber aceptado el aviso; se recalcula al aprobar con los datos de ese momento.
    if (p.tipo === 'PERMISO_PERSONAL') {
      let plan = p.planBolsa;
      if (!plan) {
        try { plan = await planBolsa(emp, { modalidad, fechas, desde, minutos }); }
        catch (e) { return { error: 'No se pudo calcular tu bolsa de 4 horas: ' + (e.message || e) }; }
      }
      // Desde la marcación ya salió: se crea igual; si no aceptó el cargo, lo que iba a vacaciones va al rol
      if ((plan.vacaciones_min || plan.rol_min) && !p.aceptaCargo && !p.origen) return { error: 'Acepta el aviso: parte del permiso no cabe en tu bolsa de 4 horas' };
      sol.plan_bolsa = plan;
      sol.acepta_cargo = !!p.aceptaCargo;
    }

    // Siempre espera respuesta: del jefe inmediato o, si no hay jefe que pueda responder, de TTHH
    const ap = await aprobadorDe(emp);
    if (ap.jefe) {
      sol.estado = 'PENDIENTE_JEFE';
      sol.aprobador_id = String(ap.jefe.id);
      sol.aprobador_nombre = ap.jefe.nombre || '';
    } else {
      sol.estado = 'PENDIENTE_TTHH';
      sol.escalada = true;
      sol.escalada_en = ahora.toISOString();
      sol.motivo_tthh = ap.motivo;
    }
    sol.caduca_en = caducidad(sol, ahora).toISOString();

    const ref = await db().collection(COL).add(sol);
    sol.id = ref.id;
    avisar('creada', sol).catch(e => console.warn('Permisos: avisos no enviados', e));
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

  // Reparto que queda fijo al aprobar. Si se creó al marcar y el colaborador no aceptó el cargo a vacaciones,
  // esa parte se descuenta del rol.
  function repartoFinal(plan, s) {
    let vac = Object.assign({}, plan.vacaciones_por_dia), rol = Object.assign({}, plan.rol_por_dia);
    let vacMin = plan.vacaciones_min, rolMin = plan.rol_min;
    if (s && s.origen && !s.acepta_cargo && vacMin) {
      Object.keys(vac).forEach(f => { rol[f] = (Number(rol[f]) || 0) + (Number(vac[f]) || 0); });
      rolMin += vacMin; vac = {}; vacMin = 0;
    }
    return {
      bolsa_por_dia: plan.bolsa_por_dia, vacaciones_por_dia: vac, rol_por_dia: rol,
      minutos_bolsa: plan.bolsa_min, cargo_vacaciones_min: vacMin, descuento_rol_min: rolMin,
      plan_aprobacion: plan, vacaciones_hoja: false
    };
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
          final = repartoFinal(plan, previa);
        }
      } catch (e) { return { error: "No se pudo calcular la bolsa de 4 horas: " + (e.message || e) }; }
    }
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = deDoc(snap);
        if (s.estado === 'CADUCADA') throw new Error('La solicitud ya no es válida: venció el plazo para responderla');
        if (!PENDIENTES.includes(s.estado)) throw new Error(`La solicitud ya está resuelta (${((ESTADOS[s.estado] || {}).txt || s.estado).toLowerCase()})`);
        const esJefe = String(s.aprobador_id) === String(quien.id) && s.estado === 'PENDIENTE_JEFE';
        const comoTTHH = tthh && s.estado === 'PENDIENTE_TTHH';
        if (!esJefe && !comoTTHH && !esAdmin) throw new Error(tthh ? 'Primero debe responder el jefe inmediato' : 'No puedes resolver esta solicitud');
        if (String(s.empleadoId) === String(quien.id)) throw new Error('No puedes aprobar tu propia solicitud');
        const ahora = ahoraIso();
        const docs = accion === 'APROBAR' && !!(TIPOS[s.tipo] || {}).documentos;
        const upd = {
          estado: accion === 'APROBAR' ? (docs ? 'REGISTRADA' : 'APROBADA') : 'RECHAZADA',
          resuelta_por: quien.nombre || String(quien.id), resuelta_por_id: String(quien.id),
          resuelta_como: esJefe ? 'JEFE' : (comoTTHH ? 'TTHH' : 'ADMIN'), resuelta_en: ahora,
          comentario: String(comentario || '').trim().slice(0, 400),
          historial: firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: quien.nombre || String(quien.id), accion: accion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA' })
        };
        if (final) Object.assign(upd, final);
        if (docs) Object.assign(upd, { docs_estado: 'PENDIENTE', docs_vence: new Date(Date.now() + 72 * 3600000).toISOString() });
        tx.update(ref, upd);
        sol = Object.assign({ id }, s, upd);
      });
    } catch (e) {
      return { error: e.message || String(e) };
    }
    const aprobada = sol.estado !== 'RECHAZADA';
    if (aprobada) await crearRegistros(sol, `${sol.resuelta_por} (${{ JEFE: 'jefe inmediato', TTHH: 'TTHH', ADMIN: 'administrador' }[sol.resuelta_como]})`);
    avisar(aprobada ? 'aprobada' : 'rechazada', sol).catch(e => console.warn('Permisos: avisos no enviados', e));
    return { ok: true, solicitud: sol };
  }

  async function cancelar(id, quien) {
    const ref = db().collection(COL).doc(id);
    let sol = null;
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = deDoc(snap);
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

  // ---------------------------------------------------------------- eliminar (administradores del panel)
  // Borra los registros de asistencia que creó la solicitud: solo los que llevan su código en la razón.
  async function borrarRegistros(s) {
    const FB = window.FirebaseBackend;
    const errores = [];
    let borrados = 0;
    const fechas = s.modalidad === 'DIAS' ? (s.fechas || []) : [];
    if (!fechas.length || !FB) return { borrados, errores };
    const suya = x => JSON.stringify(x).includes(`Solicitud ${s.id}`);
    try {
      const snap = await db().collection('registros').where('empleadoId', '==', String(s.empleadoId)).get();
      for (const d of snap.docs.filter(d => suya(d.data()))) {
        try { await db().collection('registros').doc(d.id).delete(); borrados++; }
        catch (e) { errores.push(`registro ${d.id}: ${e.message || e}`); }
      }
    } catch (e) { errores.push('asistencia no leída: ' + (e.message || e)); }
    // Días ya archivados (Google Sheets / base histórica)
    try {
      const res = await FB._obtenerRegistrosArchivados({ empleadoId: String(s.empleadoId) }, 1, 20000);
      if (!res || !res.ok || !Array.isArray(res.registros)) throw new Error((res && res.error) || 'sin respuesta');
      const tipo = TIPOS[s.tipo].registro;
      for (const f of fechas) {
        const dia = res.registros.filter(x => String(x.empleadoId || '').trim() === String(s.empleadoId) && FB._normFecha(x.fecha) === f);
        const mio = dia.find(suya);
        if (mio) {
          const x = await FB._enviarCambioArchivado({ accion: 'eliminarRegistroArchivado', empleadoId: String(s.empleadoId), fecha: f, tipo: String(mio.tipo || tipo).toUpperCase() });
          if (x && x.ok !== false && !x.error) borrados++; else errores.push(`${fechaCorta(f)}: ${(x && x.error) || 'no se borró del histórico'}`);
        } else if (dia.some(x => String(x.tipo || '').toUpperCase() === tipo)) {
          errores.push(`${fechaCorta(f)}: hay un registro archivado del mismo tipo sin el código de la solicitud; revísalo en Detalle de Empleado`);
        }
      }
    } catch (e) { errores.push('histórico no revisado: ' + (e.message || e)); }
    return { borrados, errores };
  }

  async function deshacerEliminada(s) {
    const r = await borrarRegistros(s);
    const upd = { eliminada_registros: r.borrados, eliminada_error: r.errores.join(' | ').slice(0, 900) };
    await db().collection(COL).doc(s.id).set(upd, { merge: true }).catch(() => { });
    return r;
  }

  async function eliminar(id, quien, motivo, esAdmin) {
    motivo = String(motivo || '').trim().slice(0, 400);
    if (!esAdmin) return { error: 'Solo un administrador puede eliminar solicitudes' };
    if (!motivo) return { error: 'Escribe el motivo' };
    const ref = db().collection(COL).doc(id);
    let sol = null, antes = '';
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = deDoc(snap);
        if (s.eliminada) throw new Error('La solicitud ya fue eliminada');
        antes = s.estado;
        const ahora = ahoraIso();
        const upd = {
          estado: 'CANCELADA', eliminada: true, estado_anterior: s.estado, eliminada_en: ahora, eliminada_motivo: motivo,
          eliminada_por: quien.nombre || String(quien.id), eliminada_por_id: String(quien.id),
          historial: firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: quien.nombre || String(quien.id), accion: 'ELIMINADA' })
        };
        tx.update(ref, upd);
        sol = Object.assign({}, s, upd);
      });
    } catch (e) { return { error: e.message || String(e) }; }
    const conRegistros = ['APROBADA', 'REGISTRADA'].includes(antes);
    const hecho = conRegistros ? await deshacerEliminada(sol) : { borrados: 0, errores: [] };
    if (conRegistros || PENDIENTES.includes(antes)) avisarEliminada(sol, conRegistros).catch(e => console.warn('Permisos: aviso de eliminación no enviado', e));
    return { ok: true, solicitud: sol, borrados: hecho.borrados, errores: hecho.errores };
  }

  // Avisos con datos mínimos: el motivo no viaja por WhatsApp
  async function avisarEliminada(s, estabaAprobada) {
    const T = TIPOS[s.tipo] || { label: s.tipo };
    const per = periodoTxt(s);
    const quien = `${nombreCorto(s.nombre)} (${s.empleadoId})`;
    await campana(s.empleadoId, 'permiso_cancelado', `Solicitud de ${T.label.toLowerCase()} eliminada`, `${per} · ${nombreCorto(s.eliminada_por)} · ${s.eliminada_motivo}`, s, 'eliminada');
    const otros = new Set(s.aprobador_id ? [String(s.aprobador_id)] : []);
    if (estabaAprobada) (await destinatariosTTHH()).forEach(d => otros.add(String(d.id)));
    [s.empleadoId, s.eliminada_por_id].forEach(x => otros.delete(String(x)));
    await Promise.allSettled([...otros].map(x => campana(x, 'permiso_cancelado', 'Solicitud eliminada', `${quien} · ${T.label.toLowerCase()} ${per} · por ${nombreCorto(s.eliminada_por)}`, s, 'eliminada')));
    const colab = await leerEmpleado(s.empleadoId);
    const r = await whatsapp(colab, saludoWa(colab && colab.nombre) + `🗑️ Un administrador eliminó tu solicitud de *${T.label.toLowerCase()}* ${per}. Ya no es válida` +
      (estabaAprobada ? ' y ese tiempo deja de estar justificado' : '') + '.\n\nEl motivo está en la campana de la app. Si necesitas aclararlo, habla con tu jefe inmediato.');
    await db().collection(COL).doc(s.id).set({ avisos: { aviso_eliminada: r && r.ok ? 'WhatsApp enviado' : `WhatsApp no enviado: ${(r && r.error) || 'sin respuesta'}` } }, { merge: true }).catch(() => { });
  }

  // ---------------------------------------------------------------- fase 5: permisos al marcar en la app
  const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const MOTIVO_MARCACION = { SALIDA: 'Salida con permiso registrada al marcar en la app', ENTRADA_TARDIA: 'Entrada tardía con permiso registrada al marcar en la app' };

  // Minutos de jornada (07:30–16:15) entre dos horas, sin los descansos que caen dentro (receso, almuerzo):
  // es el mismo faltante que ve el cálculo de la bolsa del panel.
  function minutosJornada(a, b) {
    const ini = Math.max(a, JORNADA.ini), fin = Math.min(b, JORNADA.fin);
    if (isNaN(ini) || isNaN(fin) || fin <= ini) return 0;
    const desc = (window.ReglasJornada && window.ReglasJornada.DESCANSOS_LV) || [];
    return Math.max(0, fin - ini - desc.reduce((t, d) => (ini <= d.inicio && d.inicio < fin ? t + d.min : t), 0));
  }

  // Solicitud vigente de hoy que ya cubre el tramo (pedida antes de marcar)
  async function solicitudQueCubre(empId, hoy, a, b) {
    const snap = await db().collection(COL).where('empleadoId', '==', String(empId)).get();
    let hallada = null;
    snap.forEach(doc => {
      const s = deDoc(doc);
      if (hallada || SIN_EFECTO.includes(s.estado) || !(s.fechas || []).includes(hoy)) return;
      if (s.modalidad !== 'HORAS') { hallada = s; return; }
      const a2 = minutosDe(s.hora_desde), b2 = minutosDe(s.hora_hasta);
      if (a < b2 && a2 < b) hallada = s;
    });
    return hallada;
  }

  /**
   * Reparto de la bolsa de un permiso personal que se va a marcar ahora (la app pide aceptar el cargo antes de
   * guardar la salida). Devuelve { minutos, plan } o { minutos: 0 } si el tramo no tiene tiempo de jornada,
   * o { existente } si ya hay una solicitud que lo cubre.
   */
  async function planMarcacion(emp, horaDesde, horaHasta) {
    const hoy = hoyStr();
    const a = minutosDe(horaDesde), b = minutosDe(horaHasta);
    const minutos = esLaborable(hoy) ? minutosJornada(a, b) : 0;
    if (!minutos) return { minutos: 0 };
    emp = (await leerEmpleado(emp.id)) || emp;
    const existente = await solicitudQueCubre(emp.id, hoy, a, b);
    if (existente) return { minutos, existente };
    return { minutos, plan: await planBolsa(emp, { modalidad: 'HORAS', fechas: [hoy], desde: hoy, minutos }) };
  }

  /**
   * El colaborador marcó salida (o entrada tardía) por permiso personal o médico en la app: se crea la solicitud
   * por horas de hoy, que espera la respuesta del jefe inmediato.
   * Si ya tenía una solicitud que cubre ese tramo, solo se le anota la marcación.
   * p: { emp, tipo, origen 'SALIDA'|'ENTRADA_TARDIA', horaDesde, horaHasta, regresa, motivo, registroId, aceptaCargo, planBolsa }
   */
  async function registrarDesdeMarcacion(p) {
    if (!TIPOS[p.tipo] || !p.emp || !p.emp.id || !MOTIVO_MARCACION[p.origen]) return { error: 'Datos incompletos' };
    const hoy = hoyStr();
    const a = minutosDe(p.horaDesde), b = minutosDe(p.horaHasta);
    const minutos = esLaborable(hoy) ? minutosJornada(a, b) : 0;
    if (!minutos) return { ok: true, omitida: true };
    const existente = await solicitudQueCubre(p.emp.id, hoy, a, b);
    if (existente) {
      await db().collection(COL).doc(existente.id).set({
        marcaciones: firebase.firestore.FieldValue.arrayUnion({ origen: p.origen, registro: String(p.registroId || ''), hora: p.horaDesde, en: ahoraIso() })
      }, { merge: true }).catch(() => { });
      return { ok: true, existente };
    }
    const emp = (await leerEmpleado(p.emp.id)) || p.emp;
    return crearSolicitud({
      emp, tipo: p.tipo, modalidad: 'HORAS', desde: hoy, horaDesde: p.horaDesde, horaHasta: p.horaHasta, minutos,
      motivo: String(p.motivo || '').trim() || MOTIVO_MARCACION[p.origen],
      origen: p.origen, regresoPendiente: !!p.regresa, registroId: p.registroId,
      aceptaCargo: !!p.aceptaCargo, planBolsa: p.planBolsa || null,
      creadoPor: { id: String(emp.id), nombre: emp.nombre || '', rol: 'COLABORADOR' }
    });
  }

  // Al volver de un permiso marcado con «Voy a regresar»: la solicitud de hoy se cierra a la hora real de regreso
  // y, si es permiso personal aún no copiado a la hoja de vacaciones, se recalcula el reparto de la bolsa.
  async function ajustarRegreso(empId, horaRegreso) {
    const hoy = hoyStr();
    const r = minutosDe(horaRegreso);
    const snap = await db().collection(COL).where('empleadoId', '==', String(empId)).get();
    const abiertas = snap.docs.map(deDoc)
      .filter(s => s.regreso_pendiente === true && s.desde === hoy && !SIN_EFECTO.includes(s.estado));
    const hechas = [];
    for (const s of abiertas) {
      const a = minutosDe(s.hora_desde), b = minutosDe(s.hora_hasta);
      const ahora = ahoraIso();
      const upd = { regreso_pendiente: false, regreso_en: ahora };
      if (!isNaN(r) && r > a && r < b) {
        upd.hora_hasta = hhmm(r);
        upd.minutos = minutosJornada(a, r);
        upd.historial = firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: s.nombre || String(s.empleadoId), accion: `REGRESÓ ${upd.hora_hasta}` });
        const recalcular = s.tipo === 'PERMISO_PERSONAL' && (PENDIENTES.includes(s.estado) || (s.estado === 'APROBADA' && s.vacaciones_hoja !== true));
        if (recalcular) {
          try {
            const emp = await leerEmpleado(s.empleadoId);
            const plan = await planBolsa(emp, { modalidad: 'HORAS', fechas: [hoy], desde: hoy, minutos: upd.minutos }, s.id);
            if (PENDIENTES.includes(s.estado)) upd.plan_bolsa = plan;
            else Object.assign(upd, repartoFinal(plan, s));
          } catch (e) { console.warn('Permisos: reparto no recalculado al regresar', e); }
        }
      }
      await db().collection(COL).doc(s.id).set(upd, { merge: true });
      hechas.push(s.id);
    }
    return { ok: true, ajustadas: hechas };
  }

  // ---------------------------------------------------------------- avisos (campana + WhatsApp)
  function periodoTxt(s) {
    if (s.modalidad === 'HORAS' && s.regreso_pendiente) return `el ${fechaCorta(s.desde)} desde las ${s.hora_desde} (regreso por confirmar)`;
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
      const plazo = `antes del ${horaIso(caducaEn(s).toISOString())}`;
      const porOtro = s.creada_por && String(s.creada_por.id) !== String(s.empleadoId);
      const verbo = { SALIDA: 'marcó salida con', ENTRADA_TARDIA: 'marcó entrada tardía con' }[s.origen] || 'solicita';
      const lineas = (porOtro ? `*${nombreCorto(s.creada_por.nombre)}* solicita a nombre de *${quien}* ` : `*${quien}* ${verbo} `) + `*${T.label.toLowerCase()}* ${per}.` + (s.motivo ? '\nEl motivo está en la solicitud.' : '') +
        (s.acepta_descuento ? `\n⚠️ Sin saldo suficiente: aceptó el descuento al rol de ${s.dias_sin_saldo} día(s).` : '') +
        (s.plan_bolsa && (s.plan_bolsa.vacaciones_min || s.plan_bolsa.rol_min)
          ? `\n⚠️ Supera su bolsa de 4 h: ${s.plan_bolsa.vacaciones_min ? durTxt(s.plan_bolsa.vacaciones_min) + ' a vacaciones' : ''}${s.plan_bolsa.vacaciones_min && s.plan_bolsa.rol_min ? ' y ' : ''}${s.plan_bolsa.rol_min ? durTxt(s.plan_bolsa.rol_min) + ' al rol' : ''} (${s.acepta_cargo ? 'lo aceptó' : 'no aceptó el cargo a vacaciones: se descuenta del rol'}).` : '');
      if (s.estado === 'PENDIENTE_JEFE') {
        const jefe = await leerEmpleado(s.aprobador_id);
        await campana(s.aprobador_id, 'permiso_solicitud', `Solicitud de ${T.label.toLowerCase()}`, `${quien} ${per} · responde ${plazo}`, s, 'jefe');
        resultado('aviso_jefe', await whatsapp(jefe, saludoWa(jefe && jefe.nombre) + '📝 ' + lineas + `\n\nNecesita tu respuesta *${plazo}*: sin aprobación no es válida ni llega a TTHH.` + pieWa));
      } else {
        const lista = await destinatariosTTHH();
        await Promise.allSettled(lista.map(d => campana(d.id, 'permiso_solicitud', `Solicitud de ${T.label.toLowerCase()} para TTHH`, `${quien} ${per} · ${MOTIVO_TTHH_3[s.motivo_tthh] || ''}`, s, 'tthh')));
        const rs = await Promise.all(lista.map(d => whatsapp(d, saludoWa(d.nombre) + '📝 ' + lineas + `\n\nLlega a TTHH porque: ${(MOTIVO_TTHH_3[s.motivo_tthh] || '').toLowerCase()}. Necesita tu respuesta *${plazo}*; sin respuesta no es válida.` + pieWa)));
        avisos.aviso_tthh = `WhatsApp ${rs.filter(r => r.ok).length}/${lista.length}`;
      }
      if (porOtro) await campana(s.empleadoId, 'permiso_solicitud', `${T.label} ${part(T, 'pedid')} a tu nombre`, `${per} · por ${nombreCorto(s.creada_por.nombre)} · espera la aprobación`, s, 'col');
    } else if (evento === 'aprobada' || evento === 'rechazada') {
      const ok = evento === 'aprobada';
      await campana(s.empleadoId, ok ? 'permiso_aprobado' : 'permiso_rechazado', ok ? `${T.label} ${part(T, "aprobad")}` : `${T.label} no ${part(T, "aprobad")}`,
        `${per} · ${nombreCorto(s.resuelta_por)}` + (s.comentario ? ` · ${s.comentario}` : ''), s, 'col');
      resultado('aviso_colaborador', await whatsapp(colab, saludoWa(colab && colab.nombre) + (ok
        ? `✅ Tu solicitud de *${T.label.toLowerCase()}* ${per} fue *aprobada* por ${nombreCorto(s.resuelta_por)}.` + (T.documentos ? `\n\nEntrega los documentos a TTHH antes del ${horaIso(s.docs_vence)} (app → *Permisos*); sin ellos se descuenta del rol.` : '')
        : `❌ Tu solicitud de *${T.label.toLowerCase()}* ${per} *no fue aprobada*.` + (s.comentario ? `\nMotivo: ${s.comentario}` : '') + '\n\nSi necesitas aclararlo, habla con tu jefe inmediato.')));
      if (ok) {
        const lista = await destinatariosTTHH();
        await Promise.allSettled(lista.filter(d => String(d.id) !== String(s.resuelta_por_id))
          .map(d => campana(d.id, 'permiso_aprobado', `${T.label} ${part(T, "aprobad")}`, `${quien} ${per} · aprobó ${nombreCorto(s.resuelta_por)}`, s, 'tthh')));
        // Médico y calamidad: TTHH recibe también WhatsApp porque debe revisar los documentos
        if (T.documentos) {
          const otros = lista.filter(d => String(d.id) !== String(s.resuelta_por_id));
          const rs = await Promise.all(otros.map(d => whatsapp(d, saludoWa(d.nombre) +
            `📋 *${nombreCorto(s.resuelta_por)}* aprobó *${T.label.toLowerCase()}* de *${quien}* ${per}.\n\nLos documentos deben llegar a TTHH en 72 horas.`)));
          avisos.aviso_tthh_aprobada = `WhatsApp ${rs.filter(r => r.ok).length}/${otros.length}`;
        }
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
    return consulta.onSnapshot(snap => cb(snap.docs.map(deDoc).sort((a, b) => tsMs(b.creada) - tsMs(a.creada))),
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
      snap.forEach(doc => { const s = deDoc(doc); if ((tthh && s.estado === 'PENDIENTE_TTHH') || (s.estado === 'PENDIENTE_JEFE' && String(s.aprobador_id) === yo)) n++; });
      return n;
    } catch (e) { return 0; }
  }

  // ---------------------------------------------------------------- interfaz común
  function chipEstado(s, comoAprobador) {
    const e = ESTADOS[s.estado] || { txt: s.estado, clase: 'pm-e-gris' };
    let txt = comoAprobador && e.txtAprob ? e.txtAprob : e.txt;
    let clase = e.clase;
    if (s.estado === 'REGISTRADA') {
      const d = {
        PENDIENTE: ['Faltan documentos', 'pm-e-pend'], ENTREGADO: ['Documento por validar', 'pm-e-tthh'], VALIDADO: ['Documentos validados', 'pm-e-ok'],
        RECHAZADO: ['Documento rechazado', 'pm-e-no'], VENCIDO: ['Plazo vencido', 'pm-e-no'], DESCONTADO: ['Descontado del rol', 'pm-e-gris']
      }[s.docs_estado || 'PENDIENTE'];
      if (d) { txt = d[0]; clase = d[1]; }
    }
    if (s.eliminada) { txt = 'Eliminada'; clase = 'pm-e-gris'; }
    return `<span class="pm-estado ${clase}">${esc(txt)}</span>`;
  }
  function periodoHtml(s) {
    if (s.modalidad === 'HORAS' && s.regreso_pendiente) return `<strong>${esc(fechaLarga(s.desde))}</strong> · desde las ${esc(s.hora_desde)} <span class="pm-sub">(regreso por confirmar)</span>`;
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
    if (s.origen) lineas.push(`<div class="pm-sub"><i class="fas fa-fingerprint"></i> ${s.origen === 'SALIDA' ? 'Registrado al marcar la salida' : 'Registrado al marcar la entrada'} en la app</div>`);
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
      lineas.push(`<div class="pm-sub"><i class="fas fa-user-tie"></i> ${opts.yoId && String(s.aprobador_id) === String(opts.yoId) ? "Te toca aprobarla" : 'La aprueba ' + esc(nombreCorto(s.aprobador_nombre))}</div>`);
    } else if (s.estado === 'PENDIENTE_TTHH') {
      lineas.push(`<div class="pm-sub"><i class="fas fa-users"></i> La revisa TTHH · ${esc((opts.comoAprobador || opts.conNombre ? MOTIVO_TTHH_3 : MOTIVO_TTHH)[s.motivo_tthh] || '')}</div>`);
    } else if (s.estado === 'CADUCADA') {
      lineas.push(`<div class="pm-alerta"><i class="fas fa-hourglass-end"></i> No se respondió antes del ${esc(horaIso(caducaEn(s).toISOString()))}: la solicitud no es válida${s.escalada ? '' : ' y no llegó a TTHH'}.</div>`);
    } else if (s.estado === 'APROBADA' || s.estado === 'RECHAZADA' || (s.estado === 'REGISTRADA' && s.resuelta_por)) {
      lineas.push(`<div class="pm-sub"><i class="fas ${s.estado === 'RECHAZADA' ? 'fa-times' : 'fa-check'}"></i> ${s.estado === 'RECHAZADA' ? 'Rechazó' : 'Aprobó'} ${esc(nombreCorto(s.resuelta_por))}${s.resuelta_como === 'TTHH' ? ' (TTHH)' : s.resuelta_como === 'ADMIN' ? ' (administrador)' : ''} · ${esc(horaIso(s.resuelta_en))}${s.comentario ? `<br>«${esc(s.comentario)}»` : ''}</div>`);
    }
    if (PENDIENTES.includes(s.estado)) {
      lineas.push(`<div class="pm-alerta"><i class="fas fa-hourglass-half"></i> Aún no es válida. Sin respuesta antes del ${esc(horaIso(caducaEn(s).toISOString()))}, no será válida.</div>`);
    }
    if (s.estado === 'REGISTRADA') {
      // Fase 3: estado de los documentos (la subida y la revisión de TTHH se conectan en el siguiente paso)
      const de = s.docs_estado || 'PENDIENTE';
      const txtDocs = {
        PENDIENTE: `Entrega los documentos antes del ${esc(horaIso(s.docs_vence))}. Sin ellos TTHH puede descontarlo del rol.`,
        ENTREGADO: 'Documento entregado · TTHH lo está revisando.',
        VALIDADO: 'Documentos validados por TTHH.',
        RECHAZADO: `Documento rechazado${s.docs_motivo_rechazo ? ': «' + esc(s.docs_motivo_rechazo) + '»' : ''}. Sube otro antes del ${esc(horaIso(s.docs_vence))}.`,
        VENCIDO: 'Venció el plazo de 72 horas · TTHH decidirá si se descuenta del rol.',
        DESCONTADO: 'Sin documentos: se descontó del rol.'
      }[de] || '';
      lineas.push(`<div class="${['VENCIDO', 'DESCONTADO', 'RECHAZADO'].includes(de) ? 'pm-alerta' : 'pm-sub'}"><i class="fas fa-file-medical"></i> ${txtDocs}</div>`);
    }
    if (s.modalidad === 'DIAS' && ['APROBADA', 'REGISTRADA'].includes(s.estado)) {
      if (s.registros_error) lineas.push(`<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No se registraron todos los días en asistencia. Avisa a TTHH.</div>`);
      else if ((s.registros || []).length) lineas.push(`<div class="pm-sub"><i class="fas fa-calendar-check"></i> Registrado en asistencia</div>`);
    }
    if (s.eliminada) {
      lineas.push(`<div class="pm-sub"><i class="fas fa-trash"></i> Eliminó ${esc(nombreCorto(s.eliminada_por))} · ${esc(horaIso(s.eliminada_en))} · estaba «${esc((ESTADOS[s.estado_anterior] || {}).txt || s.estado_anterior)}»${s.eliminada_registros ? ` · ${s.eliminada_registros} registro(s) de asistencia borrado(s)` : ''}<br>«${esc(s.eliminada_motivo)}»</div>`);
      if (s.eliminada_error) lineas.push(`<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> Falta deshacer: ${esc(s.eliminada_error)}</div>`);
    }
    const acciones = opts.acciones ? opts.acciones(s) : '';
    return `<article class="pm-tarjeta" data-id="${esc(s.id)}">
      <div class="pm-cab"><span class="pm-tipo ${T.color}"><i class="fas ${T.icono}"></i> ${esc(T.label)}</span>${chipEstado(s, opts.comoAprobador)}</div>
      ${lineas.join('')}
      ${bloqueDocs(s, opts.docs)}
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
          <div><h3 id="pmTitulo">${esc(opts.titulo || (opts.elegirEmpleado ? 'Pedir a nombre de un colaborador' : 'Nueva solicitud'))}</h3><div class="pm-sub">${esc(opts.subtitulo || 'Permisos y vacaciones')}</div></div>
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
              <div><label class="pm-etq" for="pmHoraDesde">Sale a las</label><select id="pmHoraDesde" class="pm-campo">${opcionesHora(JORNADA.ini, JORNADA.fin - PASO_HORA, minutosDe('08:00'), 'sale')}</select></div>
              <div><label class="pm-etq" for="pmHoraHasta">Regresa a las</label><select id="pmHoraHasta" class="pm-campo">${opcionesHora(minutosDe('08:00') + PASO_HORA, JORNADA.fin, minutosDe('10:00'), 'regresa')}</select></div>
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
    if (!st.emp && opts.empId) cargarEmpleado(String(opts.empId));   // la app pasa solo el ID: se lee la ficha completa (jefe)

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
    // «Regresa a las» empieza después de la hora de salida (conserva la elegida si sigue siendo válida)
    $('pmHoraDesde').addEventListener('change', () => {
      const a = minutosDe($('pmHoraDesde').value), b = minutosDe($('pmHoraHasta').value);
      $('pmHoraHasta').innerHTML = opcionesHora(a + PASO_HORA, JORNADA.fin, b > a ? b : Math.min(a + 2 * 60, JORNADA.fin), 'regresa');
      recalcular();
    });
    $('pmAcepta').addEventListener('change', recalcular);
    $("pmAceptaCargo").addEventListener("change", recalcular);

    const horaPasada = () => st.tipo === 'PERMISO_PERSONAL' && $('pmDesde').value && new Date(`${$('pmDesde').value}T${$('pmHoraDesde').value}:00`) <= new Date();
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
        const mj = !isNaN(a) && !isNaN(b) && b > a ? minutosJornada(a, b) : 0;
        partes.push(mj ? `<div><i class="fas fa-clock"></i> ${durTxt(mj)} de permiso${mj < b - a ? ' <span class="pm-sub">(sin receso ni almuerzo)</span>' : ''}</div>` : '<div class="pm-sub">Indica la hora de salida y de regreso.</div>');
        if (desde && !esLaborable(desde)) partes.push('<div class="pm-sub">Esa fecha no es laborable.</div>');
        if (horaPasada()) partes.push('<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> Esa hora ya pasó: pide el permiso antes de la hora de salida.</div>');
      } else {
        partes.push(fechas.length ? `<div><i class="fas fa-calendar-day"></i> ${fechas.length} día${fechas.length === 1 ? '' : 's'} laborable${fechas.length === 1 ? '' : 's'} <span class="pm-sub">(sin fines de semana ni feriados)</span></div>` : '<div class="pm-sub">El rango no tiene días laborables.</div>');
      }
      // Quién la aprueba
      {
        if (st.aprob === undefined) { st.aprob = null; const empId = st.emp.id; aprobadorDe(st.emp).then(r => { if (st.emp && st.emp.id === empId) { st.aprob = r; recalcular(); } }); }
        if (st.aprob === null) partes.push('<div class="pm-sub"><i class="fas fa-spinner fa-spin"></i> Buscando a tu jefe inmediato…</div>');
        else if (st.aprob) partes.push(st.aprob.jefe ? `<div><i class="fas fa-user-tie"></i> La aprueba <strong>${esc(nombreCorto(st.aprob.jefe.nombre))}</strong> (jefe inmediato). Hasta que la apruebe no es válida.</div>`
          : `<div><i class="fas fa-users"></i> La aprueba <strong>TTHH</strong>: ${esc((MOTIVO_TTHH[st.aprob.motivo] || '').toLowerCase())}. Hasta que la apruebe no es válida.</div>`);
        if (fechas.length && !horaPasada()) {
          const cad = caducidad({ tipo: st.tipo, modalidad: st.modalidad, desde, fechas, hora_desde: $('pmHoraDesde').value }, new Date());
          partes.push(`<div><i class="fas fa-hourglass-half"></i> Plazo para responder: <strong>${esc(horaIso(cad.toISOString()))}</strong> · sin respuesta, la solicitud no es válida.</div>`);
        }
        if (T.documentos) partes.push('<div><i class="fas fa-file-medical"></i> Al aprobarse hay 72 horas para entregar los documentos a TTHH; sin ellos se descuenta del rol.</div>');
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
          planBolsa(st.emp, { modalidad: st.modalidad, fechas, desde, minutos: st.modalidad === 'HORAS' ? minutosJornada(a, b) : 0 })
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
      btn.disabled = st.enviando || !motivoOk || horaPasada() || (st.modalidad === "DIAS" && !fechas.length) || (sinSaldo > 0 && !$("pmAcepta").checked) || st.saldo === "cargando" || planCargando || (necesitaCargo && !$("pmAceptaCargo").checked);
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar solicitud';
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
        toast(`Solicitud enviada a ${s.estado === 'PENDIENTE_JEFE' ? nombreCorto(s.aprobador_nombre) : 'TTHH'}. No es válida hasta que se apruebe.`, 'success');
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

  // Rechazo con motivo (ventana propia: el panel y la app no deben depender de prompt()).
  // cfg opcional: { titulo, etiqueta, ejemplo, boton } (se reutiliza para rechazar documentos)
  function pedirMotivoRechazo(s, cfg = {}) {
    return new Promise(resolve => {
      document.getElementById('pmModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pmModal';
      modal.className = 'pm-modal';
      modal.innerHTML = `<div class="pm-dialogo pm-dialogo-chico" role="dialog" aria-modal="true" aria-labelledby="pmTitRech">
        <div class="pm-dcab"><div><h3 id="pmTitRech">${esc(cfg.titulo || 'No aprobar')}</h3><div class="pm-sub">${esc(nombreCorto(s.nombre))} · ${esc((TIPOS[s.tipo] || {}).label || s.tipo)}</div></div>
          <button type="button" class="pm-cerrar" data-pm="no" aria-label="Cerrar">&times;</button></div>
        <div class="pm-dcuerpo">${cfg.aviso ? `<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> ${esc(cfg.aviso)}</div>` : ''}<label class="pm-etq" for="pmRechMotivo">${esc(cfg.etiqueta || 'Motivo (lo verá el colaborador)')}</label>
          <textarea id="pmRechMotivo" class="pm-campo" rows="3" maxlength="400" placeholder="${esc(cfg.ejemplo || 'Ej: esa semana hay entrega de proyecto')}"></textarea></div>
        <div class="pm-dpie"><button type="button" class="pm-btn pm-btn-sec" data-pm="no">Volver</button>
          <button type="button" class="pm-btn pm-btn-rojo" data-pm="si" disabled><i class="fas ${cfg.boton === 'Eliminar' ? 'fa-trash' : 'fa-times'}"></i> ${esc(cfg.boton || 'No aprobar')}</button></div></div>`;
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

  // ---------------------------------------------------------------- fase 3: documentos (médico y calamidad)
  // Los archivos viven en una carpeta privada de Drive (permisos_documentos.gs). Apps Script identifica a quien llama
  // con el token de su sesión de Firebase; sin sesión se pide confirmar la contraseña (SesionFirebase).
  const DOCS_SUBIR = ['PENDIENTE', 'RECHAZADO'];
  const DOCS_MAX_BYTES = 6 * 1024 * 1024;

  async function tokenSesion(empleadoId) {
    const a = window.firebase && firebase.auth ? firebase.auth() : null;
    if (a) {
      const u = a.currentUser || await new Promise(r => { const off = a.onAuthStateChanged(x => { off(); r(x); }); setTimeout(() => r(null), 4000); });
      if (u) return u.getIdToken();
    }
    if (window.SesionFirebase && empleadoId) {
      try { localStorage.removeItem('tcontrol_sesion_fb_omitida'); } catch (e) { }
      window.SesionFirebase.asegurar(String(empleadoId));
    }
    throw new Error('Para los documentos necesitas confirmar tu contraseña. Hazlo y vuelve a intentarlo.');
  }

  // Foto → JPEG de hasta 1600 px (los certificados fotografiados con el celular pesan varios MB).
  // Usa createImageBitmap + toBlob (más rápido y con la orientación correcta); no pasa por data URL gigantes.
  function blobABase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(new Error('No se pudo leer el archivo'));
      fr.readAsDataURL(blob);
    });
  }
  async function abrirImagen(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* se usa el método clásico */ }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo abrir la foto')); i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
  // Devuelve { blob, mime, nombre, tamano }; el base64 se arma recién al enviar
  async function prepararArchivo(file) {
    const tipo = String(file.type || '').toLowerCase();
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(tipo)) throw new Error('Sube un PDF o una foto (JPG o PNG)');
    let blob = file, mime = tipo;
    if (tipo.startsWith('image/')) {
      const img = await abrirImagen(file);
      const mayor = Math.max(img.width, img.height);
      // Una foto ya liviana y de buen tamaño se envía tal cual (evita recomprimir y perder calidad)
      if (tipo === 'image/jpeg' && file.size <= 900 * 1024 && mayor <= 1600) {
        if (img.close) img.close();
      } else {
        const escala = Math.min(1, 1600 / mayor);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        if (img.close) img.close();
        blob = await new Promise((ok, mal) => c.toBlob(x => x ? ok(x) : mal(new Error('No se pudo reducir la foto')), 'image/jpeg', 0.82));
      }
      mime = 'image/jpeg';
    }
    if (blob.size > DOCS_MAX_BYTES) throw new Error('El archivo supera 6 MB' + (mime === 'application/pdf' ? '. Reduce el PDF o súbelo como foto.' : ''));
    const nombre = String(file.name || 'documento').replace(/\.[^.]+$/, '') + (mime === 'application/pdf' ? '.pdf' : '.jpg');
    return { blob, mime, nombre, tamano: blob.size };
  }

  function pesoTxt(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  // alEtapa(texto) informa el avance; el token se pide mientras se lee el archivo (en paralelo)
  async function subirDocumento(s, fileOArch, yo, alEtapa) {
    const etapa = alEtapa || (() => { });
    const tokenP = tokenSesion(yo.id);
    tokenP.catch(() => { });
    etapa('Preparando el archivo…');
    const arch = fileOArch && fileOArch.blob ? fileOArch : await prepararArchivo(fileOArch);
    const base64 = await blobABase64(arch.blob);
    const idToken = await tokenP;
    etapa('Enviando a TTHH…');
    const r = await window.FirebaseBackend._post({ accion: 'subirDocumentoPermiso', idToken, solicitudId: s.id, nombre: arch.nombre, mime: arch.mime, base64 });
    if (!r || r.error) throw new Error((r && r.error) || 'No se pudo subir el documento');
    return r;
  }

  // Visor dentro de la app: el documento se descarga una vez y se guarda en memoria (reabrirlo es instantáneo)
  const cacheDocs = new Map();
  async function obtenerDocumento(s, docId, yo) {
    const clave = s.id + '|' + docId;
    if (cacheDocs.has(clave)) return cacheDocs.get(clave);
    const idToken = await tokenSesion(yo.id);
    const r = await window.FirebaseBackend._post({ accion: 'verDocumentoPermiso', idToken, solicitudId: s.id, docId });
    if (!r || r.error) throw new Error((r && r.error) || 'No se pudo abrir el documento');
    const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
    const doc = { url: URL.createObjectURL(new Blob([bytes], { type: r.mime })), mime: r.mime, nombre: r.nombre || 'documento' };
    cacheDocs.set(clave, doc);
    return doc;
  }

  async function verDocumento(s, docId, yo) {
    document.getElementById('pmVisor')?.remove();
    const modal = document.createElement('div');
    modal.id = 'pmVisor';
    modal.className = 'pm-modal';
    modal.innerHTML = `<div class="pm-dialogo pm-visor" role="dialog" aria-modal="true" aria-label="Documento">
      <div class="pm-dcab"><div><h3>Documento</h3><div class="pm-sub" data-v="nombre"></div></div>
        <button type="button" class="pm-cerrar" data-v="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="pm-visor-cuerpo" data-v="cuerpo"><div class="pm-cargando pm-cargando-grande"><span class="pm-doc-anim"><i class="fas fa-file-lines"></i></span>
        <strong data-v="msg">Abriendo el documento…</strong><span data-v="sub">Lo traemos de la carpeta privada.</span><div class="pm-barra pm-barra-ind"><span></span></div></div></div>
      <div class="pm-dpie" data-v="pie" hidden></div></div>`;
    document.body.appendChild(modal);
    const cerrar = () => { modal.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = ev => { if (ev.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    modal.addEventListener('click', ev => { if (ev.target === modal || ev.target.closest('[data-v="cerrar"]')) cerrar(); });
    const t1 = setTimeout(() => { const m = modal.querySelector('[data-v="sub"]'); if (m) m.textContent = 'Los documentos se verifican antes de mostrarse; puede tardar unos segundos.'; }, 3000);
    const t2 = setTimeout(() => { const m = modal.querySelector('[data-v="msg"]'); if (m) m.textContent = 'Sigue abriéndose…'; }, 9000);
    try {
      const d = await obtenerDocumento(s, docId, yo).finally(() => { clearTimeout(t1); clearTimeout(t2); });
      if (!modal.isConnected) return;
      modal.querySelector('[data-v="nombre"]').textContent = d.nombre;
      const cuerpo = modal.querySelector('[data-v="cuerpo"]');
      cuerpo.innerHTML = d.mime === 'application/pdf'
        ? `<iframe class="pm-visor-pdf" src="${d.url}" title="${esc(d.nombre)}"></iframe>`
        : `<img class="pm-visor-img" src="${d.url}" alt="${esc(d.nombre)}">`;
      const pie = modal.querySelector('[data-v="pie"]');
      pie.hidden = false;
      pie.innerHTML = `<a class="pm-btn pm-btn-sec" href="${d.url}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Abrir aparte</a>
        <a class="pm-btn pm-btn-pri" href="${d.url}" download="${esc(d.nombre)}"><i class="fas fa-download"></i> Descargar</a>`;
    } catch (e) {
      cerrar();
      throw e;
    }
  }

  // Ventana de subida: elegir o fotografiar, ver cómo quedó, y recién entonces enviar
  function dialogoSubir(s, yo) {
    return new Promise(resolve => {
      document.getElementById('pmSubir')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pmSubir';
      modal.className = 'pm-modal';
      modal.innerHTML = `<div class="pm-dialogo" role="dialog" aria-modal="true" aria-labelledby="pmTitSub">
        <div class="pm-dcab"><div><h3 id="pmTitSub">Subir documento</h3><div class="pm-sub">${esc((TIPOS[s.tipo] || {}).label || s.tipo)} · PDF o foto de hasta 6 MB</div></div>
          <button type="button" class="pm-cerrar" data-u="cerrar" aria-label="Cerrar">&times;</button></div>
        <div class="pm-dcuerpo">
          <div class="pm-zona" data-u="zona" tabindex="0">
            <i class="fas fa-cloud-arrow-up"></i>
            <strong>Arrastra el archivo aquí</strong>
            <span>o elige cómo subirlo</span>
            <div class="pm-zona-btns">
              <button type="button" class="pm-btn pm-btn-pri pm-btn-chico" data-u="foto"><i class="fas fa-camera"></i> Tomar foto</button>
              <button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-u="elegir"><i class="fas fa-folder-open"></i> Elegir archivo</button>
            </div>
          </div>
          <div class="pm-previa" data-u="previa" hidden></div>
          <div class="pm-progreso" data-u="progreso" aria-live="polite" hidden></div>
          <div class="pm-msg-error" data-u="error" role="alert" hidden></div>
          <div class="pm-aviso-docs"><i class="fas fa-lock"></i> Solo lo verás tú y TTHH. Las fotos se reducen solas para que suban rápido.</div>
        </div>
        <div class="pm-dpie"><button type="button" class="pm-btn pm-btn-sec" data-u="cerrar">Cancelar</button>
          <button type="button" class="pm-btn pm-btn-pri" data-u="enviar" disabled><i class="fas fa-paper-plane"></i> Enviar a TTHH</button></div></div>`;
      document.body.appendChild(modal);
      const q = k => modal.querySelector(`[data-u="${k}"]`);
      let arch = null, miniUrl = '', ocupado = false;
      tokenSesion(yo.id).catch(() => { }); // calienta la sesión mientras eligen el archivo
      const cerrar = r => { if (miniUrl) URL.revokeObjectURL(miniUrl); modal.remove(); document.removeEventListener('keydown', tecla); resolve(r); };
      const tecla = ev => { if (ev.key === 'Escape' && !ocupado) cerrar(false); };
      document.addEventListener('keydown', tecla);
      const error = txt => { const e = q('error'); e.textContent = txt || ''; e.hidden = !txt; };

      async function elegido(file) {
        if (!file || ocupado) return;
        error('');
        arch = null; q('enviar').disabled = true;
        const previa = q('previa');
        previa.hidden = false;
        previa.innerHTML = '<div class="pm-cargando"><i class="fas fa-spinner fa-spin"></i> Revisando y reduciendo el archivo…</div>';
        try {
          arch = await prepararArchivo(file);
          if (miniUrl) URL.revokeObjectURL(miniUrl);
          miniUrl = URL.createObjectURL(arch.blob);
          const miniatura = arch.mime === 'application/pdf'
            ? '<div class="pm-previa-pdf"><i class="fas fa-file-pdf"></i></div>'
            : `<img src="${miniUrl}" alt="Vista previa">`;
          previa.innerHTML = `${miniatura}<div class="pm-previa-datos"><strong>${esc(arch.nombre)}</strong><span>${pesoTxt(arch.tamano)}${file.size > arch.tamano + 51200 ? ` · reducida de ${pesoTxt(file.size)}` : ''}</span>
            <button type="button" class="pm-link" data-u="cambiar">Cambiar</button></div>`;
          q('zona').hidden = true;
          q('enviar').disabled = false;
        } catch (e) {
          previa.hidden = true; previa.innerHTML = '';
          error(e.message || String(e));
        }
      }

      function elegirArchivo(camara) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = camara ? 'image/*' : 'application/pdf,image/jpeg,image/png,image/webp';
        if (camara) input.setAttribute('capture', 'environment');
        input.addEventListener('change', () => elegido(input.files && input.files[0]));
        input.click();
      }

      async function enviar() {
        if (!arch || ocupado) return;
        ocupado = true; error('');
        const btn = q('enviar');
        btn.disabled = true;
        q('previa').classList.add('pm-previa-ocupada');
        modal.querySelectorAll('[data-u="cerrar"],[data-u="cambiar"]').forEach(x => { x.disabled = true; });
        const prog = q('progreso');
        const pasos = ['Preparando el archivo', 'Enviando a TTHH', 'Guardando en la carpeta privada'];
        let paso = 0, esperas = [];
        const pintar = (msg, sub) => {
          prog.hidden = false;
          prog.innerHTML = `<div class="pm-barra"><span style="width:${Math.round(((paso + 0.5) / pasos.length) * 100)}%"></span></div>
            <ol class="pm-pasos">${pasos.map((p, i) => `<li class="${i < paso ? 'pm-paso-ok' : i === paso ? 'pm-paso-act' : ''}"><i class="fas ${i < paso ? 'fa-check' : i === paso ? 'fa-spinner fa-spin' : 'fa-circle'}"></i> ${p}</li>`).join('')}</ol>
            <div class="pm-prog-msg"><strong>${esc(msg)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
        };
        pintar('Preparando tu documento…', 'No cierres esta ventana hasta que termine.');
        try {
          await subirDocumento(s, arch, yo, txt => {
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${esc(txt)}`;
            if (/Enviando/.test(txt)) {
              paso = 1; pintar('Enviando el documento…', 'Depende de tu conexión; las fotos ya van reducidas.');
              esperas.push(setTimeout(() => { paso = 2; pintar('Guardando de forma segura…', 'El archivo queda en una carpeta privada; solo TTHH y tú pueden verlo.'); }, 3500));
              esperas.push(setTimeout(() => pintar('Esto está tardando más de lo normal…', 'Sigue en proceso. Espera unos segundos más, no vuelvas a enviarlo.'), 14000));
            }
          });
          esperas.forEach(clearTimeout);
          paso = pasos.length;
          prog.hidden = false;
          prog.innerHTML = `<div class="pm-exito"><span class="pm-exito-ico"><i class="fas fa-check"></i></span><strong>¡Documento enviado!</strong>
            <span>TTHH recibió un aviso para validarlo. Te avisaremos si necesitan algo más.</span></div>`;
          q('previa').hidden = true; btn.hidden = true;
          await new Promise(r => setTimeout(r, 1800));
          cerrar(true);
        } catch (e) {
          esperas.forEach(clearTimeout);
          prog.hidden = true; prog.innerHTML = '';
          ocupado = false;
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane"></i> Reintentar envío';
          q('previa').classList.remove('pm-previa-ocupada');
          modal.querySelectorAll('[data-u="cerrar"],[data-u="cambiar"]').forEach(x => { x.disabled = false; });
          error(e.message || String(e));
        }
      }

      modal.addEventListener('click', ev => {
        const t = ev.target;
        if (t === modal) { if (!ocupado) cerrar(false); return; }
        const el = t.closest('[data-u]');
        const k = el && el.dataset.u;
        if (k === 'cerrar') cerrar(false);
        else if (k === 'foto') elegirArchivo(true);
        else if (k === 'elegir') elegirArchivo(false);
        else if (k === 'cambiar') { arch = null; q('previa').hidden = true; q('zona').hidden = false; q('enviar').disabled = true; error(''); }
        else if (k === 'enviar') enviar();
      });
      const zona = q('zona');
      ['dragenter', 'dragover'].forEach(n => zona.addEventListener(n, ev => { ev.preventDefault(); zona.classList.add('pm-zona-sobre'); }));
      ['dragleave', 'drop'].forEach(n => zona.addEventListener(n, ev => { ev.preventDefault(); zona.classList.remove('pm-zona-sobre'); }));
      zona.addEventListener('drop', ev => elegido(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]));
    });
  }

  // TTHH: VALIDAR / RECHAZAR (documento entregado), DESCONTAR / PRORROGA (plazo vencido)
  async function revisarDocumentos(id, accion, quien, extra = {}) {
    const permitido = { VALIDAR: ['ENTREGADO'], RECHAZAR: ['ENTREGADO'], DESCONTAR: ['VENCIDO'], PRORROGA: ['VENCIDO'] }[accion];
    if (!permitido) return { error: 'Acción no válida' };
    if (!(await esTTHH(quien.id)) && !extra.admin) return { error: 'Solo TTHH revisa documentos' };
    const ref = db().collection(COL).doc(id);
    let sol = null;
    try {
      await db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La solicitud ya no existe');
        const s = snap.data();
        const est = s.docs_estado || 'PENDIENTE';
        if (s.estado !== 'REGISTRADA' || !permitido.includes(est)) throw new Error('El estado de los documentos cambió; recarga la lista');
        const ahora = ahoraIso();
        const upd = { docs_revisado_por: quien.nombre || String(quien.id), docs_revisado_por_id: String(quien.id), docs_revisado_en: ahora };
        if (accion === 'VALIDAR') upd.docs_estado = 'VALIDADO';
        if (accion === 'RECHAZAR') { upd.docs_estado = 'RECHAZADO'; upd.docs_motivo_rechazo = String(extra.motivo || '').trim().slice(0, 300); }
        if (accion === 'DESCONTAR') upd.docs_estado = 'DESCONTADO';
        if (accion === 'PRORROGA') {
          const horas = [24, 48, 72].includes(Number(extra.horas)) ? Number(extra.horas) : 24;
          upd.docs_estado = 'PENDIENTE';
          upd.docs_vence = new Date(Date.now() + horas * 3600000).toISOString();
          upd.docs_prorroga_horas = horas;
        }
        upd.historial = firebase.firestore.FieldValue.arrayUnion({ en: ahora, quien: quien.nombre || String(quien.id), accion: 'DOCUMENTOS_' + accion });
        tx.update(ref, upd);
        sol = Object.assign({ id }, s, upd);
      });
    } catch (e) { return { error: e.message || String(e) }; }
    avisarRevisionDocs(sol, accion).catch(e => console.warn('Permisos: aviso de documentos no enviado', e));
    return { ok: true, solicitud: sol };
  }

  // Aviso al colaborador (datos mínimos: sin nombres de archivo ni contenido)
  async function avisarRevisionDocs(s, accion) {
    const T = TIPOS[s.tipo] || { label: s.tipo };
    const per = periodoTxt(s);
    const textos = {
      VALIDAR: ['permiso_aprobado', 'Documentos validados', `${T.label} ${per} · TTHH validó tus documentos.`, `✅ TTHH validó los documentos de tu *${T.label.toLowerCase()}* ${per}. No necesitas hacer nada más.`],
      RECHAZAR: ['permiso_rechazado', 'Documento rechazado', `${T.label} ${per} · revisa el motivo y sube otro antes del ${horaIso(s.docs_vence)}.`, `❌ TTHH no aceptó el documento de tu *${T.label.toLowerCase()}* ${per}.\n\nRevisa el motivo en la app (Permisos) y sube otro antes del ${horaIso(s.docs_vence)}.`],
      DESCONTAR: ['permiso_rechazado', 'Descuento al rol', `${T.label} ${per} · sin documentos, se descuenta del rol.`, `ℹ️ Como no se entregaron los documentos de tu *${T.label.toLowerCase()}* ${per}, TTHH confirmó que se descontará del rol.`],
      PRORROGA: ['permiso_solicitud', 'Nuevo plazo para tus documentos', `${T.label} ${per} · entrégalos antes del ${horaIso(s.docs_vence)}.`, `⏰ TTHH te dio un nuevo plazo para entregar los documentos de tu *${T.label.toLowerCase()}* ${per}: hasta el ${horaIso(s.docs_vence)}.\n\nSúbelos en la app TCONTROL → *Permisos*.`]
    }[accion];
    if (!textos) return;
    await campana(s.empleadoId, textos[0], textos[1], textos[2], s, 'docs_' + accion.toLowerCase());
    const colab = await leerEmpleado(s.empleadoId);
    const r = await whatsapp(colab, saludoWa(colab && colab.nombre) + textos[3]);
    await db().collection(COL).doc(s.id).set({ avisos: { ['docs_' + accion.toLowerCase()]: r && r.ok ? 'WhatsApp enviado' : `WhatsApp no enviado: ${(r && r.error) || 'sin respuesta'}` } }, { merge: true }).catch(() => { });
  }

  // Bloque de documentos de una tarjeta. op: { yoId, revisar }
  function bloqueDocs(s, op) {
    if (s.estado !== 'REGISTRADA' || !op) return '';
    const est = s.docs_estado || 'PENDIENTE';
    const esDueno = String(s.empleadoId) === String(op.yoId);
    const docs = (s.docs || []).filter(d => d && d.id);
    const lista = docs.length ? `<div class="pm-docs">${docs.map(d => `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-doc-ver="${esc(s.id)}" data-doc="${esc(d.id)}" title="Abrir">
      <i class="fas ${d.mime === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image'}"></i> ${esc(String(d.nombre || 'documento').slice(0, 28))}</button>`).join('')}</div>` : '';
    const b = [];
    if ((esDueno && DOCS_SUBIR.includes(est)) || (op.revisar && (DOCS_SUBIR.includes(est) || est === 'VENCIDO'))) {
      b.push(`<button type="button" class="pm-btn pm-btn-pri pm-btn-chico" data-doc-subir="${esc(s.id)}"><i class="fas fa-upload"></i> ${docs.length ? 'Subir otro documento' : 'Subir documento'}</button>`);
    }
    if (op.revisar && !esDueno) {
      if (est === 'ENTREGADO') {
        b.push(`<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-doc-accion="RECHAZAR" data-id="${esc(s.id)}"><i class="fas fa-times"></i> Rechazar documento</button>`);
        b.push(`<button type="button" class="pm-btn pm-btn-verde pm-btn-chico" data-doc-accion="VALIDAR" data-id="${esc(s.id)}"><i class="fas fa-check"></i> Validar</button>`);
      } else if (est === 'VENCIDO') {
        b.push(`<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-doc-accion="PRORROGA" data-id="${esc(s.id)}"><i class="fas fa-clock"></i> Dar prórroga</button>`);
        b.push(`<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-doc-accion="DESCONTAR" data-id="${esc(s.id)}"><i class="fas fa-file-invoice-dollar"></i> Confirmar descuento</button>`);
      }
    }
    return lista + (b.length ? `<div class="pm-acciones">${b.join('')}</div>` : '');
  }

  // Prórroga: 24, 48 o 72 h desde ahora
  function pedirProrroga(s) {
    return new Promise(resolve => {
      document.getElementById('pmModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pmModal';
      modal.className = 'pm-modal';
      modal.innerHTML = `<div class="pm-dialogo pm-dialogo-chico" role="dialog" aria-modal="true" aria-labelledby="pmTitPro">
        <div class="pm-dcab"><div><h3 id="pmTitPro">Dar prórroga</h3><div class="pm-sub">${esc(nombreCorto(s.nombre))} · ${esc((TIPOS[s.tipo] || {}).label || s.tipo)}</div></div>
          <button type="button" class="pm-cerrar" data-pm="no" aria-label="Cerrar">&times;</button></div>
        <div class="pm-dcuerpo"><div class="pm-etq">Nuevo plazo desde ahora</div>
          <div class="pm-seg" role="group" aria-label="Horas">${[24, 48, 72].map(h => `<button type="button" data-horas="${h}" aria-pressed="${h === 24}">${h} h</button>`).join('')}</div></div>
        <div class="pm-dpie"><button type="button" class="pm-btn pm-btn-sec" data-pm="no">Volver</button>
          <button type="button" class="pm-btn pm-btn-pri" data-pm="si"><i class="fas fa-clock"></i> Dar prórroga</button></div></div>`;
      document.body.appendChild(modal);
      let horas = 24;
      modal.addEventListener('click', ev => {
        const h = ev.target.closest('[data-horas]');
        if (h) { horas = Number(h.dataset.horas); modal.querySelectorAll('[data-horas]').forEach(x => x.setAttribute('aria-pressed', x === h ? 'true' : 'false')); return; }
        if (ev.target === modal || ev.target.closest('[data-pm="no"]')) { modal.remove(); resolve(null); }
        else if (ev.target.closest('[data-pm="si"]')) { modal.remove(); resolve(horas); }
      });
    });
  }

  // Clics de documentos (app y panel). Devuelve true si el clic era de documentos.
  async function manejarClicDocs(t, solicitudes, yo, admin) {
    const ver = t.closest('[data-doc-ver]');
    const subir = t.closest('[data-doc-subir]');
    const acc = t.closest('[data-doc-accion]');
    if (!ver && !subir && !acc) return false;
    const id = (ver && ver.dataset.docVer) || (subir && subir.dataset.docSubir) || (acc && acc.dataset.id);
    const s = (solicitudes || []).find(x => x.id === id);
    if (!s) return true;
    if (ver) {
      try { await verDocumento(s, ver.dataset.doc, yo); } catch (e) { toast(e.message || String(e), 'error'); }
      return true;
    }
    if (subir) {
      if (await dialogoSubir(s, yo)) toast('Documento enviado a TTHH', 'success');
      return true;
    }
    const accion = acc.dataset.docAccion;
    const extra = { admin };
    if (accion === 'RECHAZAR') {
      extra.motivo = await pedirMotivoRechazo(s, { titulo: 'Rechazar documento', etiqueta: 'Motivo (lo verá el colaborador)', ejemplo: 'Ej: la foto no se lee; falta la firma del médico', boton: 'Rechazar documento' });
      if (!extra.motivo) return true;
    } else if (accion === 'PRORROGA') {
      extra.horas = await pedirProrroga(s);
      if (!extra.horas) return true;
    } else if (accion === 'DESCONTAR' && !window.confirm('¿Confirmar el descuento al rol? Esos días dejarán de estar justificados.')) {
      return true;
    }
    acc.disabled = true;
    const r = await revisarDocumentos(s.id, accion, yo, extra);
    if (r.error) { toast(r.error, 'error'); acc.disabled = false; return true; }
    toast({ VALIDAR: 'Documentos validados', RECHAZAR: 'Documento rechazado; se avisó al colaborador', DESCONTAR: 'Descuento confirmado; se avisó al colaborador', PRORROGA: 'Prórroga dada; se avisó al colaborador' }[accion], 'success');
    return true;
  }

  // ---------------------------------------------------------------- app del colaborador
  function montarApp(cont, opts) {
    if (!cont || !opts || !opts.empleado || !opts.empleado.id) return;
    if (cont._pm) cont._pm.destruir();
    const yo = { id: String(opts.empleado.id), nombre: opts.empleado.nombre || '' };
    const st = { tab: 'mias', mias: null, aprobar: null, tthh: false, esJefe: false, errMias: '', errAprobar: '', subs: [], enlace: opts.enlace || null };
    cont.innerHTML = `<div class="pm-app">
      <header class="pm-hero"><div><h2>Permisos y vacaciones</h2><p>Pide vacaciones o permisos y sigue su estado.</p></div>
        <button type="button" class="pm-btn pm-btn-pri" data-pm="nueva"><i class="fas fa-plus"></i> Nueva solicitud</button>
        <a class="pm-guia" href="./guias/permisos/guia-permisos.html" target="_blank" rel="noopener">
          <span class="pm-guia-ico"><i class="fas fa-book-open"></i></span>
          <span class="pm-guia-txt"><strong>¿Cómo funciona? Mira la guía paso a paso</strong><small>Tipos de permiso, bolsa de 4 horas, vacaciones y aprobaciones, con capturas</small></span>
          <i class="fas fa-chevron-right pm-guia-flecha"></i></a></header>
      <section class="pm-tiempo" aria-live="polite"></section>
      <nav class="pm-tabs" role="tablist" hidden>
        <button type="button" role="tab" data-tab="mias" aria-selected="true">Mis solicitudes</button>
        <button type="button" role="tab" data-tab="aprobar" aria-selected="false">Por aprobar <span class="pm-num" hidden></span></button>
      </nav>
      <div class="pm-lista"></div></div>`;
    const lista = cont.querySelector('.pm-lista'), tabs = cont.querySelector('.pm-tabs'), num = cont.querySelector('.pm-num');
    // Resumen de tiempo: al abrir y cuando cambia alguna de mis solicitudes (aprobada, regreso, cargo…)
    const boxTiempo = cont.querySelector('.pm-tiempo');
    let firmaMias = null, tTiempo = null;
    const recalcularTiempo = () => montarResumenTiempo(boxTiempo, yo.id);

    function pendientesParaMi() {
      return (st.aprobar || []).filter(s => (s.estado === 'PENDIENTE_JEFE' && String(s.aprobador_id) === yo.id) || (st.tthh && s.estado === 'PENDIENTE_TTHH'));
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
          docs: { yoId: yo.id, revisar: st.tthh },
          acciones: x => PENDIENTES.includes(x.estado) ? `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-cancelar="${esc(x.id)}">Cancelar solicitud</button>` : ''
        })).join('');
      } else {
        if (st.errAprobar) { lista.innerHTML = `<div class="pm-vacio">${esc(st.errAprobar)}</div>`; return; }
        if (!st.aprobar) { lista.innerHTML = '<div class="pm-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>'; return; }
        const otras = st.aprobar.filter(s => !pend.includes(s)).slice(0, 30);
        lista.innerHTML = (pend.length ? `<h3 class="pm-h3">Pendientes (${pend.length})</h3>` + pend.map(s => tarjeta(s, {
          conNombre: true, comoAprobador: true, yoId: yo.id, docs: { yoId: yo.id, revisar: st.tthh },
          acciones: () => `<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-resolver="RECHAZAR" data-id="${esc(s.id)}"><i class="fas fa-times"></i> No aprobar</button>
            <button type="button" class="pm-btn pm-btn-verde pm-btn-chico" data-resolver="APROBAR" data-id="${esc(s.id)}"><i class="fas fa-check"></i> Aprobar</button>`
        })).join('') : '<div class="pm-vacio"><i class="fas fa-check-circle"></i><strong>No tienes solicitudes por aprobar</strong></div>') +
          (otras.length ? `<h3 class="pm-h3">Recientes de tu equipo${st.tthh ? ' y de TTHH' : ''}</h3>` + otras.map(s => tarjeta(s, { conNombre: true, docs: { yoId: yo.id, revisar: st.tthh } })).join('') : '');
      }
      if (st.enlace && st.enlace.id) {
        const el = lista.querySelector(`[data-id="${CSS.escape(st.enlace.id)}"]`);
        if (el) { el.classList.add('pm-destacada'); el.scrollIntoView({ block: 'center' }); st.enlace = null; }
      }
    }

    cont.addEventListener('click', async ev => {
      const t = ev.target;
      if (await manejarClicDocs(t, (st.mias || []).concat(st.aprobar || []), yo, false)) return;
      if (t.closest('[data-pm="tiempo"]')) { recalcularTiempo(); return; }
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
      if (err) st.errMias = 'No se pudieron cargar tus solicitudes.'; else { st.errMias = ''; l = l.filter(s => !s.eliminada); st.mias = l; }
      pintar();
      if (!err) {
        const firma = JSON.stringify(l.map(s => [s.id, s.estado, s.minutos, s.cargo_vacaciones_min, s.docs_estado]).sort());
        if (firma !== firmaMias) { const primera = firmaMias === null; firmaMias = firma; clearTimeout(tTiempo); tTiempo = setTimeout(recalcularTiempo, primera ? 0 : 1500); }
      }
    }));
    (async () => {
      st.tthh = await esTTHH(yo.id);
      try { st.esJefe = !(await db().collection('empleados').where('jefe_inmediato_id', '==', yo.id).limit(1).get()).empty; } catch (e) { }
      const q = st.tthh ? db().collection(COL) : db().collection(COL).where('aprobador_id', '==', yo.id);
      st.subs.push(escuchar(q, (l, err) => {
        if (err) st.errAprobar = 'No se pudieron cargar las solicitudes por aprobar.';
        else { st.errAprobar = ''; st.aprobar = l.filter(s => !s.eliminada && String(s.empleadoId) !== yo.id && (!st.tthh || visibleTTHH(s) || String(s.aprobador_id) === yo.id)); }
        if (st.enlace && st.enlace.id && st.aprobar && st.aprobar.some(s => s.id === st.enlace.id)) st.tab = 'aprobar';
        pintar();
      }));
    })();
    pintar();
    cont._pm = { destruir() { clearTimeout(tTiempo); st.subs.forEach(u => { try { u(); } catch (e) { } }); cont._pm = null; } };
  }

  // ---------------------------------------------------------------- panel de supervisor
  function montarPanel(cont, opts) {
    if (!cont || !opts || !opts.usuario) return;
    if (cont._pm) { if (opts.enlace) cont._pm.enlace(opts.enlace); return; }
    const yo = { id: String(opts.usuario.id || ''), nombre: opts.usuario.nombre || '' };
    const st = { tab: 'bandeja', filtro: 'PEND', busca: '', lista: null, err: '', tthh: false, cfg: { tthh: [], vacacionesSoloDias: true }, enlace: opts.enlace || null, subs: [] };
    const empleados = () => (typeof window.todoElPersonal === 'function' ? window.todoElPersonal() : (window.empCache || [])).filter(activo);
    cont.innerHTML = `<div class="pm-panel">
      <div class="pm-pcab">
        <nav class="pm-tabs" role="tablist">
          <button type="button" role="tab" data-tab="bandeja" aria-selected="true">Solicitudes</button>
          <button type="button" role="tab" data-tab="tthh" aria-selected="false">Configuración</button>
        </nav>
        <div class="pm-pacc">
          <a class="pm-btn pm-btn-guia" href="./guias/permisos/guia-permisos.html#panel" target="_blank" rel="noopener" title="Abre la guía en otra pestaña"><i class="fas fa-book-open"></i> Guía paso a paso</a>
          <button type="button" class="pm-btn pm-btn-sec" data-pm="a-nombre"><i class="fas fa-user-plus"></i> Pedir médico o calamidad</button>
        </div>
      </div>
      <div class="pm-cuerpo"></div></div>`;
    const cuerpo = cont.querySelector('.pm-cuerpo');
    const puedeResolver = () => st.tthh || opts.admin;
    // En lugar del jefe solo responde un administrador; TTHH no las ve hasta que el jefe las apruebe
    const puedeResponder = s => PENDIENTES.includes(s.estado) && String(s.empleadoId) !== yo.id &&
      (opts.admin || (st.tthh && s.estado === 'PENDIENTE_TTHH') || (s.estado === 'PENDIENTE_JEFE' && String(s.aprobador_id) === yo.id));
    const visibles = () => (st.lista || []).filter(s => !s.eliminada).filter(s => opts.admin || !st.tthh || visibleTTHH(s) || String(s.aprobador_id) === yo.id);

    const eliminadas = () => opts.admin ? (st.lista || []).filter(s => s.eliminada) : [];
    function filtrar() {
      const q = st.busca.trim().toLowerCase();
      return (st.filtro === 'ELIM' ? eliminadas() : visibles()).filter(s => {
        if (st.filtro === 'PEND' && !PENDIENTES.includes(s.estado)) return false;
        const de = s.estado === 'REGISTRADA' ? (s.docs_estado || 'PENDIENTE') : '';
        if (st.filtro === 'DOCS' && !['PENDIENTE', 'RECHAZADO'].includes(de)) return false;
        if (st.filtro === 'VALIDAR' && de !== 'ENTREGADO') return false;
        if (st.filtro === 'VENCIDOS' && de !== 'VENCIDO') return false;
        if (!q) return true;
        return [s.nombre, s.empleadoId, s.area, s.motivo, s.aprobador_nombre, (TIPOS[s.tipo] || {}).label].some(v => String(v || '').toLowerCase().includes(q));
      });
    }
    function pintar() {
      cont.querySelectorAll('.pm-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === st.tab ? 'true' : 'false'));
      cont.querySelector('[data-pm="a-nombre"]').hidden = !puedeResolver();
      if (st.tab === 'tthh') { pintarTTHH(); return; }
      const pendientes = visibles().filter(s => PENDIENTES.includes(s.estado)).length;
      const deDe = s => s.estado === 'REGISTRADA' ? (s.docs_estado || 'PENDIENTE') : '';
      const docs = visibles().filter(s => ['PENDIENTE', 'RECHAZADO'].includes(deDe(s))).length;
      const porValidar = visibles().filter(s => deDe(s) === 'ENTREGADO').length;
      const vencidos = visibles().filter(s => deDe(s) === 'VENCIDO').length;
      const avisoTthh = !st.cfg.tthh.length ? '<div class="pm-alerta"><i class="fas fa-exclamation-triangle"></i> No hay personas de TTHH configuradas: las solicitudes sin jefe y las aprobadas llegan a los supervisores administradores. Configúralas en «Personas de TTHH».</div>' : '';
      const filtros = `<div class="pm-filtros">
        <div class="pm-seg" role="group" aria-label="Filtro">
          <button type="button" data-filtro="PEND" aria-pressed="${st.filtro === 'PEND'}">Pendientes (${pendientes})</button>
          <button type="button" data-filtro="VALIDAR" aria-pressed="${st.filtro === 'VALIDAR'}">Documentos por validar (${porValidar})</button>
          <button type="button" data-filtro="VENCIDOS" aria-pressed="${st.filtro === 'VENCIDOS'}">Vencidos (${vencidos})</button>
          <button type="button" data-filtro="DOCS" aria-pressed="${st.filtro === 'DOCS'}">Faltan documentos (${docs})</button>
          <button type="button" data-filtro="TODAS" aria-pressed="${st.filtro === 'TODAS'}">Todas</button>
          ${opts.admin ? `<button type="button" data-filtro="ELIM" aria-pressed="${st.filtro === 'ELIM'}">Eliminadas (${eliminadas().length})</button>` : ''}
        </div>
        <input type="search" class="pm-campo pm-buscar" id="pmBuscar" placeholder="Buscar por nombre, ID, área o motivo" value="${esc(st.busca)}" aria-label="Buscar">
      </div>`;
      let html;
      if (st.err) html = `<div class="pm-vacio">${esc(st.err)}</div>`;
      else if (!st.lista) html = '<div class="pm-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
      else {
        const l = filtrar();
        html = l.length ? `<div class="pm-grid">${l.slice(0, 200).map(s => tarjeta(s, {
          conNombre: true, comoAprobador: true, yoId: yo.id, docs: { yoId: yo.id, revisar: puedeResolver() },
          acciones: x => (opts.admin && !x.eliminada ? `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico pm-btn-eliminar" data-eliminar="${esc(x.id)}"><i class="fas fa-trash"></i> Eliminar</button>` : '') +
            (opts.admin && x.eliminada && x.eliminada_error ? `<button type="button" class="pm-btn pm-btn-pri pm-btn-chico" data-reintentar="${esc(x.id)}"><i class="fas fa-redo"></i> Reintentar</button>` : '') +
            (puedeResponder(x) ? `<button type="button" class="pm-btn pm-btn-rojo pm-btn-chico" data-resolver="RECHAZAR" data-id="${esc(x.id)}"><i class="fas fa-times"></i> No aprobar</button>
               <button type="button" class="pm-btn pm-btn-verde pm-btn-chico" data-resolver="APROBAR" data-id="${esc(x.id)}"><i class="fas fa-check"></i> Aprobar${x.estado === 'PENDIENTE_JEFE' && String(x.aprobador_id) !== yo.id ? ' (en lugar del jefe)' : ''}</button>` : '')
        })).join('')}</div>` : `<div class="pm-vacio"><i class="fas fa-inbox"></i><strong>${st.filtro === 'PEND' ? 'No hay solicitudes pendientes' : 'Sin resultados'}</strong></div>`;
      }
      cuerpo.innerHTML = avisoTthh + (puedeResolver() ? '' : '<div class="pm-sub pm-nota">Los jefes aprueban desde la app. En lugar del jefe solo puede responder un administrador.</div>') + filtros + html;
      const b = cuerpo.querySelector('#pmBuscar');
      if (b) b.addEventListener('input', () => { st.busca = b.value; const pos = b.selectionStart; pintar(); const nb = cuerpo.querySelector('#pmBuscar'); nb.focus(); nb.setSelectionRange(pos, pos); });
      if (st.enlace && st.enlace.id) {
        const el = cuerpo.querySelector(`[data-id="${CSS.escape(st.enlace.id)}"]`);
        if (el) { el.classList.add('pm-destacada'); el.scrollIntoView({ block: 'center' }); st.enlace = null; }
        else if (st.lista && st.filtro !== 'TODAS') { st.filtro = 'TODAS'; pintar(); }
        else if (st.lista) st.enlace = null;   // eliminada o no visible
      }
    }
    function pintarTTHH() {
      const ids = st.cfg.tthh.map(x => x.id);
      const opciones = empleados().filter(e => !ids.includes(String(e.id))).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      cuerpo.innerHTML = `<section class="pm-config">
        <h3 class="pm-h3">Personas de TTHH</h3>
        <p class="pm-sub">Reciben las solicitudes solo después de que el jefe las aprueba y revisan los documentos de permisos médicos y calamidades. Aprueban o rechazan únicamente las de quien no tiene un jefe que pueda responder.</p>
        <ul class="pm-personas">${st.cfg.tthh.length ? st.cfg.tthh.map(x => `<li><span><i class="fas fa-user"></i> ${esc(nombreCorto(x.nombre))} <span class="pm-sub">· ${esc(x.id)}</span></span>
          ${opts.admin ? `<button type="button" class="pm-btn pm-btn-sec pm-btn-chico" data-quitar="${esc(x.id)}">Quitar</button>` : ''}</li>`).join('') : '<li class="pm-sub">Nadie configurado todavía.</li>'}</ul>
        ${opts.admin ? `<div class="pm-fila pm-fila-agregar"><select id="pmNuevoTthh" class="pm-campo" aria-label="Persona a agregar"><option value="">Agregar persona…</option>${opciones.map(e => `<option value="${esc(e.id)}">${esc(nombreCorto(e.nombre))} · ${esc(e.id)}${e.area ? ' · ' + esc(e.area) : ''}</option>`).join('')}</select>
          <button type="button" class="pm-btn pm-btn-pri" data-pm="agregar-tthh"><i class="fas fa-plus"></i> Agregar</button></div>` : '<p class="pm-sub">Solo los administradores pueden cambiar esta lista.</p>'}
      </section>
      <section class="pm-config">
        <h3 class="pm-h3">Vista del colaborador</h3>
        <label class="pm-acepta pm-interruptor"><input type="checkbox" id="pmSoloDias" ${st.cfg.vacacionesSoloDias !== false ? 'checked' : ''} ${opts.admin ? '' : 'disabled'}>
          <span><strong>Vacaciones solo en días completos</strong><br><span class="pm-sub">El colaborador ve su saldo y sus días tomados sin fracciones, y no ve las horas acumuladas hacia el próximo día. El panel siempre muestra el detalle.</span></span></label>
        ${opts.admin ? '' : '<p class="pm-sub">Solo los administradores pueden cambiar esta opción.</p>'}
      </section>`;
    }
    async function guardarLista(nueva) {
      try { await guardarTTHH(nueva, yo.nombre || yo.id); st.cfg = Object.assign({}, st.cfg, { tthh: nueva }); st.tthh = nueva.some(x => x.id === yo.id); toast('Lista de TTHH guardada', 'success'); }
      catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'error'); }
      pintar();
    }

    cont.addEventListener('click', async ev => {
      const t = ev.target;
      if (await manejarClicDocs(t, st.lista || [], yo, !!opts.admin)) return;
      const tab = t.closest('.pm-tabs [data-tab]');
      if (tab) { st.tab = tab.dataset.tab; pintar(); return; }
      const f = t.closest('[data-filtro]');
      if (f) { st.filtro = f.dataset.filtro; pintar(); return; }
      const res = t.closest('[data-resolver]');
      if (res) { const s = (st.lista || []).find(x => x.id === res.dataset.id); if (s) accionResolver(res, s, res.dataset.resolver, yo, !!opts.admin); return; }
      const del = t.closest('[data-eliminar]');
      if (del && opts.admin) {
        const s = (st.lista || []).find(x => x.id === del.dataset.eliminar);
        if (!s) return;
        const motivo = await pedirMotivoRechazo(s, {
          titulo: 'Eliminar solicitud', etiqueta: 'Motivo (lo verá el colaborador)', ejemplo: 'Ej: solicitud duplicada; se pidió por error', boton: 'Eliminar',
          aviso: ['APROBADA', 'REGISTRADA'].includes(s.estado) ? 'Ya está aprobada: se borrarán sus registros de asistencia y las horas cargadas a vacaciones, y ese tiempo dejará de estar justificado. No se puede deshacer.'
            : 'Dejará de verse en la app y no se puede deshacer. Queda constancia en «Eliminadas».'
        });
        if (!motivo) return;
        del.disabled = true;
        const r = await eliminar(s.id, yo, motivo, !!opts.admin);
        if (r.error) { toast(r.error, 'error'); del.disabled = false; return; }
        toast(r.errores.length ? 'Solicitud eliminada, pero falta deshacer algo: revisa «Eliminadas».' : 'Solicitud eliminada', r.errores.length ? 'error' : 'success');
        if (r.borrados && typeof window.cargarDatosCompletos === 'function') window.cargarDatosCompletos(true, true);
        return;
      }
      const rein = t.closest('[data-reintentar]');
      if (rein && opts.admin) {
        const s = (st.lista || []).find(x => x.id === rein.dataset.reintentar);
        if (!s) return;
        rein.disabled = true;
        const r = await deshacerEliminada(s);
        toast(r.errores.length ? 'Todavía falta: ' + r.errores[0] : 'Listo: ya no queda nada por deshacer', r.errores.length ? 'error' : 'success');
        return;
      }
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

    cont.addEventListener('change', async ev => {
      if (ev.target.id !== 'pmSoloDias' || !opts.admin) return;
      const v = ev.target.checked;
      ev.target.disabled = true;
      try {
        await guardarVistaVacaciones(v, yo.nombre || yo.id);
        st.cfg = Object.assign({}, st.cfg, { vacacionesSoloDias: v });
        toast(v ? 'El colaborador verá solo días completos' : 'El colaborador verá también las fracciones', 'success');
      } catch (e) { ev.target.checked = !v; toast('No se pudo guardar: ' + (e.message || e), 'error'); }
      ev.target.disabled = false;
    });

    (async () => {
      st.cfg = await leerConfig(true);
      st.tthh = st.cfg.tthh.some(x => x.id === yo.id);
      pintar();
    })();
    st.subs.push(escuchar(db().collection(COL), (l, err) => {
      if (err) st.err = 'No se pudieron cargar las solicitudes.'; else { st.err = ''; st.lista = l; }
      if (typeof opts.onPendientes === 'function' && st.lista) opts.onPendientes(visibles().filter(s => PENDIENTES.includes(s.estado)).length);
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
    crearSolicitud, resolver, cancelar, eliminar, leerConfig, esTTHH, resumenTiempo, montarResumenTiempo, planMarcacion, registrarDesdeMarcacion, ajustarRegreso,
    _internos: { minutosJornada, solicitudQueCubre, repartoFinal, fechasLaborables, sumarMinutosLaborables, esLaborable, caducidad, caducaEn, vigente, visibleTTHH, planBolsa, saldoVacaciones, prepararArchivo, subirDocumento, dialogoSubir, verDocumento, revisarDocumentos }
  };
})();
