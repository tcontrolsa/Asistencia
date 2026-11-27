/**
 * Asistencia Tcontrol - Evaluación de desempeño (mensual o trimestral, y seguimiento Día 75)
 * Formato de Psicología Organizacional: nuevo/EVALUACION DE DESEMPEÑO.xlsx y, desde 2026-11-24, nuevo/SISTEMA DE EVALUACION.xlsx
 * (categorías y colores, recibida al abrir, feedback obligatorio, intervención inmediata y revisión por sesgo)
 *
 * Datos: PostgreSQL (api.eval_guardar / eval_confirmar / eval_listar / eval_config / eval_reunion /
 * eval_reabrir) vía PostgREST, con un token que Apps Script emite tras verificar el PIN (acción
 * tokenEvaluacion). La réplica a la hoja EVALUACIONES la hace sync-historico. El status
 * (evaluacion_rol) y el jefe inmediato (evaluador_id) viven en Firestore, en el documento del empleado.
 *
 * El cuestionario (preguntas, pesos, escala, niveles, meta y plazos) lo edita el admin master en la
 * pestaña Configuración del panel; cada evaluación guarda la copia de las preguntas con que se hizo.
 *
 * Uso:
 *   EvaluacionDesempeno.montar(contenedor, { empleado })            app del colaborador / "Mi equipo"
 *   EvaluacionDesempeno.montarPanel(contenedor, { empleado, ... })   panel del supervisor (RR.HH.)
 */
(function () {
  'use strict';

  // Datos de nómina (NOMINA_CARGO_JEFE): unidad y área de nómina; si faltan, el área de asistencia
  const unidadDe = e => String((e && e.unidad) || '').trim();
  // Áreas escritas distinto (ADMINISTRACION / ADMINISTRACIÓN / Administración) se tratan como una sola
  const claveArea = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toUpperCase();
  const AREAS = new Map();
  const registrarAreas = emps => (emps || []).forEach(e => {
    const raw = String((e && (e.area_nomina || e.area)) || '').trim().replace(/\s+/g, ' ');
    if (!raw) return;
    const k = claveArea(raw), v = raw.toUpperCase(), act = AREAS.get(k);
    if (!act || (v !== k && act === k)) AREAS.set(k, v);   // se prefiere la variante con tilde
  });
  const areaDe = e => {
    const raw = String((e && (e.area_nomina || e.area)) || '').trim();
    if (!raw) return '';
    const k = claveArea(raw);
    return AREAS.get(k) || raw.toUpperCase().replace(/\s+/g, ' ');
  };
  const subtituloEmp = e => [unidadDe(e), areaDe(e), String((e && (e.cargo_contrato || e.cargo)) || '').trim()].filter(Boolean).join(' · ');
  const opcionesSelect = (lista, actual, todos) => `<option value="">${todos}</option>` +
    lista.map(a => `<option ${a === actual ? 'selected' : ''}>${String(a).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</option>`).join('');

  // ---------------------------------------------------------------- catálogo
  let DIMENSIONES = [
    { k: 'tecnico', t: 'Dominio técnico y funcional del cargo', corto: 'Técnico' },
    { k: 'gestion', t: 'Gestión del trabajo', corto: 'Gestión' },
    { k: 'aprendizaje', t: 'Aprendizaje y desarrollo', corto: 'Aprendizaje' },
    { k: 'relacional', t: 'Integración relacional y cultural', corto: 'Integración' }
  ];
  let ITEMS = [
    { dim: 'tecnico', peso: 10, c: 'Conocimiento técnico del puesto', m: 'Domina su profesiograma y funciones, aplicándolos con criterio propio en el desarrollo del cargo.' },
    { dim: 'tecnico', peso: 10, c: 'Aplicación de procedimientos', a: 'Métodos, pasos, flujos e instrucciones de trabajo para ejecutar una actividad.', m: 'Ejecuta sus actividades conforme a los procedimientos y lineamientos establecidos del SGC, con autonomía.',
      d75: 'Ejecuta sus actividades conforme a los procedimientos, normas técnicas y lineamientos establecidos, con autonomía.' },
    { dim: 'tecnico', peso: 8, c: 'Manejo de herramientas y sistemas', m: 'Utiliza con dominio las herramientas, equipos y sistemas requeridos, optimizando su uso.' },
    { dim: 'tecnico', peso: 8, c: 'Calidad técnica del trabajo', a: 'Exactitud, integridad y conformidad del entregable frente a requisitos definidos.', m: 'Ejecuta sus actividades con precisión, minimizando errores y desviaciones respecto a los criterios de calidad definidos para el cargo.' },
    { dim: 'tecnico', peso: 7, c: 'Resolución de problemas técnicos', m: 'Identifica oportunamente situaciones críticas y aplica soluciones acordes con el nivel de autonomía esperado para su cargo.' },
    { dim: 'tecnico', peso: 7, c: 'Autonomía funcional', m: 'Ejecuta las funciones de su cargo con autonomía, seguridad y criterio propio en la toma de decisiones.' },
    { dim: 'gestion', peso: 11, c: 'Cumplimiento de resultados y plazos', a: 'Logro de objetivos y entregables comprometidos dentro de fechas y condiciones acordadas.', m: 'Enfoca sus actividades al logro de los objetivos del cargo y responde consistentemente por los resultados obtenidos.' },
    { dim: 'gestion', peso: 10, c: 'Organización y priorización', m: 'Organiza y prioriza eficientemente sus actividades sin requerir supervisión constante.' },
    { dim: 'gestion', peso: 4, c: 'Cumplimiento normativo', a: 'Obligaciones legales, regulatorias, contractuales y políticas internas aplicables.', m: 'Cumple de manera consolidada las políticas internas, normas de seguridad y disposiciones legales aplicables a su cargo.' },
    { dim: 'aprendizaje', peso: 5, c: 'Aprendizaje continuo', m: 'Adquiere y aplica de forma autónoma nuevos conocimientos relevantes para su cargo.' },
    { dim: 'aprendizaje', peso: 4, c: 'Apertura y aplicación de retroalimentación', m: 'Incorpora de manera consistente la retroalimentación recibida como parte de su desarrollo profesional.' },
    { dim: 'relacional', peso: 4, c: 'Comunicación efectiva', m: 'Favorece la coordinación y el cumplimiento de las actividades del área mediante una comunicación clara y oportuna.' },
    { dim: 'relacional', peso: 4, c: 'Trabajo colaborativo', m: 'Contribuye de manera sostenida al logro de los objetivos comunes del equipo.' },
    { dim: 'relacional', peso: 8, c: 'Adaptabilidad e integración organizacional', m: 'Demuestra alineación consolidada con los valores, normas, cultura y comportamientos esperados por la organización.' }
  ];
  // Escala y categorías del documento SISTEMA DE EVALUACION (la nota n toma el color de la categoría n)
  let ESCALA = [
    { v: 1, t: 'Requieren intervención', d: 'Requieren intervención. Evidencia brechas críticas respecto a las expectativas del rol, siendo imprescindible de forma inmediata un plan de acción correctivo con supervisión permanente.' },
    { v: 2, t: 'En desarrollo', d: 'En desarrollo. Presenta oportunidades de mejora sustanciales en el cumplimiento de sus funciones, por lo que requiere la implementación de un plan de mejora estructurado y seguimiento cercano para alcanzar el nivel esperado.' },
    { v: 3, t: 'Cumple lo esperado en términos generales', d: 'Cumple lo esperado en términos generales. Evidencia un desempeño aceptable que demanda seguimiento ocasional, identificándose oportunidades de mejora clave para potenciar su evolución profesional.' },
    { v: 4, t: 'Cumple plenamente lo esperado', d: 'Cumple plenamente lo esperado. Consolida un rendimiento adecuado y requiere acompañamiento enfocado en desarrollar competencias estratégicas, específicamente el liderazgo situacional y la innovación alineada a los objetivos organizacionales.' },
    { v: 5, t: 'Supera las expectativas de desempeño', d: 'Supera las expectativas de desempeño. Evidencia un desempeño excepcional, impulsando la innovación y generando alto valor en sus funciones. Constituye un referente para sus pares y presenta un gran potencial de desarrollo que requiere acompañamiento estratégico.' }
  ];
  // Qué hacer (lo lee el evaluado)
  let RECOMENDACION = {
    'Requieren intervención': 'Solicita a tu evaluador una reunión de feedback para establecer planes de mejora.',
    'En desarrollo': 'Solicita a tu evaluador una reunión de feedback para establecer tus oportunidades y compromisos.',
    'Cumple lo esperado en términos generales': 'Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre tus oportunidades de desarrollo.',
    'Cumple plenamente lo esperado': 'Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre tus oportunidades de desarrollo.',
    'Supera las expectativas de desempeño': 'Si deseas, puedes solicitar una reunión con tu evaluador para conversar sobre los proyectos innovadores que estás llevando a cabo y en los que necesitas apoyo.'
  };
  // Categorías por defecto (editables en Configuración): 'min' es el límite inferior inclusivo; 'i' = requiere intervención inmediata
  const NIVELES_BASE = [
    { min: 0.90, n: 'Supera las expectativas de desempeño', color: 'azul', msg: ESCALA[4].d },
    { min: 0.80, n: 'Cumple plenamente lo esperado', color: 'turquesa', msg: ESCALA[3].d },
    { min: 0.70, n: 'Cumple lo esperado en términos generales', color: 'verde', msg: ESCALA[2].d },
    { min: 0.60, n: 'En desarrollo', color: 'naranja', i: true, msg: ESCALA[1].d },
    { min: 0, n: 'Requieren intervención', color: 'rojo', i: true, msg: ESCALA[0].d }];
  const COLORES = ['rojo', 'naranja', 'ambar', 'verde', 'turquesa', 'azul'];
  const ROLES = ['EVALUADO', 'EVALUADOR', 'EVALUADOR Y EVALUADO', 'NO APLICA'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MAX_OBS = 200, MAX_TXT = 500;

  // ---------------------------------------------------------------- cuestionario editable
  // El admin master edita el cuestionario (api.eval_config). Lo de arriba es la versión 1 y el
  // respaldo si la base no responde. Cada evaluación trae la copia de las preguntas con que se hizo
  // (cuestionario): el historial no cambia cuando se edita.
  const BASE = {
    dimensiones: DIMENSIONES, items: ITEMS, escala: ESCALA, obligatoriaObs: [1, 2, 5],
    niveles: NIVELES_BASE,
    meta: 0.70, plazos: { evaluarDia: 10, confirmarDias: 7, vigenciaDias: 45, avisoDias: 3, feedbackDias: 7 }, recomendaciones: RECOMENDACION
  };
  let CFG = BASE, CFG_VERSION = null, REAPERTURAS = [], NIVELES = BASE.niveles, META = BASE.meta, OBLIG = BASE.obligatoriaObs;
  // Umbral de intervención inmediata: donde empieza la primera categoría que ya no la requiere
  function umbralAlerta(niveles) {
    const sin = niveles.filter(x => !x.i).map(x => Number(x.min));
    return sin.length && sin.length < niveles.length ? Math.min(...sin) : 0.70;
  }
  // Una configuración guardada sin colores es anterior al documento SISTEMA DE EVALUACION: toma categorías, escala y conceptos nuevos
  function actualizarConfig(cfg) {
    const g = Object.assign({}, BASE, cfg || {});
    // Configuración guardada con los textos/colores anteriores (4 colores, «Requiere intervención»): pasa a los de 5 categorías
    const vieja = Array.isArray(g.niveles) && g.niveles.some(n => n.n === 'Requiere intervención');
    if (vieja) { g.escala = BASE.escala; g.recomendaciones = BASE.recomendaciones; g.niveles = NIVELES_BASE; }
    if (!Array.isArray(g.niveles) || !g.niveles.some(n => n.color)) {
      g.niveles = NIVELES_BASE; g.recomendaciones = BASE.recomendaciones; g.escala = BASE.escala;
      g.items = g.items.map(x => { const b = BASE.items.find(y => y.c === x.c); return b && b.a && !x.a ? Object.assign({}, x, { a: b.a }) : x; });
    }
    return g;
  }
  function aplicarConfig(cfg, version, reaperturas) {
    CFG = actualizarConfig(cfg);
    DIMENSIONES = CFG.dimensiones; ITEMS = CFG.items; ESCALA = CFG.escala; RECOMENDACION = CFG.recomendaciones || {};
    NIVELES = CFG.niveles.slice().sort((a, b) => Number(b.min) - Number(a.min));
    META = umbralAlerta(NIVELES);
    OBLIG = (CFG.obligatoriaObs || []).map(Number);
    CFG_VERSION = version || null;
    REAPERTURAS = reaperturas || [];
  }
  const escalaMax = (esc = ESCALA) => Math.max(...esc.map(e => Number(e.v)));
  const sumaPesos = items => items.reduce((s, x) => s + (Number(x.peso) || 0), 0);
  const itemsDe = e => (e && e.cuestionario && Array.isArray(e.cuestionario.items)) ? e.cuestionario.items : BASE.items;
  const dimensionesDe = e => (e && e.cuestionario && Array.isArray(e.cuestionario.dimensiones)) ? e.cuestionario.dimensiones : BASE.dimensiones;
  const escalaDe = e => (e && e.cuestionario && Array.isArray(e.cuestionario.escala)) ? e.cuestionario.escala : BASE.escala;
  // Para comparar competencias entre evaluaciones: mismas preguntas que el cuestionario vigente
  const mismoCuestionario = e => { const it = itemsDe(e); return it.length === ITEMS.length && it.every((x, i) => x.c === ITEMS[i].c); };
  let configCargada = 0;
  async function cargarConfig(ses, forzar) {
    if (!forzar && configCargada && Date.now() - configCargada < 10 * 60 * 1000) return;
    try {
      const r = await rpc(ses, 'eval_config', { modo: 'obtener' });
      if (r && r.ok) { aplicarConfig(r.config, r.version, r.reaperturas); configCargada = Date.now(); }
    } catch (e) {
      if (e.sesion) throw e;
      console.warn('Evaluaciones: cuestionario no disponible, se usa el de base', e.message || e);
    }
  }

  // ---------------------------------------------------------------- utilidades
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => `${Math.round((Number(x) || 0) * 1000) / 10}%`;
  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  // Niveles del cuestionario (de mayor a menor)
  function nivelDe(p) {
    const n = NIVELES.find(x => p >= Number(x.min));
    return n ? n.n : ((NIVELES[NIVELES.length - 1] || {}).n || 'Requiere mejora');
  }
  const datosNivel = n => NIVELES.find(x => x.n === n) || {};
  // Color de una categoría (rojo, ámbar, verde, azul) y de una nota: la nota n toma el de la categoría n (de menor a mayor)
  const colorNivel = (n, lista = NIVELES) => {
    const orden = lista.slice().sort((a, b) => Number(a.min) - Number(b.min));
    const i = orden.findIndex(x => x.n === n);
    if (i < 0) return '';
    return COLORES.includes(orden[i].color) ? orden[i].color : (i === 0 ? 'rojo' : i === orden.length - 1 ? 'azul' : i === 1 ? 'ambar' : 'verde');
  };
  const claseNivel = n => { const c = colorNivel(n); return c ? 'ev-k-' + c : ''; };
  const claseNota = (v, max = escalaMax(), lista = NIVELES) => {
    const x = Math.round(Number(v) || 0);
    if (x < 1) return '';
    const orden = lista.slice().sort((a, b) => Number(a.min) - Number(b.min));
    const i = max > 1 ? Math.round((Math.min(x, max) - 1) * (orden.length - 1) / (max - 1)) : 0;
    const c = orden[i] ? colorNivel(orden[i].n, lista) : '';
    return c ? 'ev-k-' + c : '';
  };
  const clasePct = p => claseNivel(nivelDe(Number(p) || 0));

  // Textos: 3 palabras o más (al menos 2 distintas) y que no sea «no aplica», «ninguno»… (misma regla que historico.eval_texto_ok)
  const RELLENO = new Set(('no aplica aplicable n a na corresponde ninguno ninguna ningun nada sin observacion observaciones comentario comentarios ' +
    'novedad novedades hay tengo existe existen en este esta esto caso por el la los las lo de del al para momento ahora mes periodo trimestre ' +
    'item pregunta punto criterio su cargo se es que y o un una').split(' '));
  function textoValido(s) {
    const w = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(x => /[a-z]/.test(x));
    return w.length >= 3 && new Set(w).size >= 2 && w.some(x => !RELLENO.has(x));
  }
  const AVISO_TEXTO = 'al menos 3 palabras; no se admite «no aplica»';
  // Sesgo: todas las calificaciones en el valor más bajo o todas en el más alto
  const haySesgo = cal => cal.length > 1 && cal.every(Boolean) && (cal.every(v => v === escalaMax()) || cal.every(v => v === Math.min(...ESCALA.map(e => Number(e.v)))));
  const MSG_SESGO = 'Tu evaluación debe ser revisada con TTHH porque se ha detectado sesgo.';
  // Retenida por sesgo (o devuelta): el colaborador no la ve y no cuenta en los resultados
  const retenida = e => !!e && (e.estado === 'revision' || e.estado === 'devuelta');

  // Feedback e intervención inmediata
  const fb = e => (e && e.feedback) || { exigido: false, estado: 'opcional' };
  const requiereIntervencion = e => !!e && Number(e.porcentaje) < META;
  const estadoIntervencion = e => { const s = fb(e).estado; return s === 'realizada' ? 'Atendida' : s === 'agendada' ? 'Agendada' : 'Pendiente'; };
  const esCierreTrimestre = per => /-T[1-4]$/.test(String(per)) || /-(03|06|09|12)$/.test(String(per));
  const chipFeedback = e => {
    const f = fb(e);
    if (f.estado === 'realizada') return '<span class="ev-chip ev-chip-ok"><i class="fas fa-comments"></i> Feedback realizado</span>';
    if (f.vencido) return `<span class="ev-chip ev-chip-warn" title="El plazo venció el ${fechaCorta(f.vence)}"><i class="fas fa-comments"></i> Feedback vencido</span>`;
    if (f.estado === 'agendada') return '<span class="ev-chip ev-chip-env"><i class="fas fa-comments"></i> Feedback agendado</span>';
    if (f.estado === 'pendiente') return `<span class="ev-chip ev-chip-env" title="Obligatorio hasta el ${fechaCorta(f.vence)}"><i class="fas fa-comments"></i> Feedback pendiente</span>`;
    return '';
  };
  const chipIntervencion = e => {
    if (!requiereIntervencion(e)) return '<span class="ev-muted">—</span>';
    const s = estadoIntervencion(e);
    return `<span class="ev-interv"><i class="fas fa-check-square" aria-hidden="true"></i> <span><strong>Sí</strong><small class="${s === 'Atendida' ? 'ev-ok' : s === 'Agendada' ? 'ev-warn' : 'ev-danger'}">${fb(e).vencido ? 'Vencida' : s}</small></span></span>`;
  };

  // Igual que el Excel: puntaje = peso × calificación; máximo = suma de pesos × valor más alto de la escala
  function calcular(cal) {
    let puntaje = 0, respondidos = 0;
    const max = escalaMax();
    const dims = {};
    DIMENSIONES.forEach(d => { dims[d.k] = { puntaje: 0, maximo: 0, completos: true }; });
    ITEMS.forEach((it, i) => {
      const v = Number(cal[i]) || 0;
      if (!dims[it.dim]) dims[it.dim] = { puntaje: 0, maximo: 0, completos: true };
      dims[it.dim].maximo += it.peso * max;
      if (v) { respondidos++; puntaje += it.peso * v; dims[it.dim].puntaje += it.peso * v; } else dims[it.dim].completos = false;
    });
    Object.values(dims).forEach(d => { d.porcentaje = d.maximo ? d.puntaje / d.maximo : 0; d.nivel = d.completos ? nivelDe(d.porcentaje) : 'Incompleto'; });
    const maximo = sumaPesos(ITEMS) * max;
    const porcentaje = maximo ? puntaje / maximo : 0;
    const completa = respondidos === ITEMS.length;
    return { puntaje, maximo, porcentaje, respondidos, completa, nivel: completa ? nivelDe(porcentaje) : 'Evaluación incompleta', dimensiones: dims, meta: META };
  }

  function rolDe(emp) {
    const r = String((emp && emp.evaluacion_rol) || '').toUpperCase().trim();
    if (ROLES.includes(r)) return r;
    const sup = String((emp && (emp.supervisor || emp.rol)) || '').toUpperCase();
    return (sup === 'SI' || sup.includes('SUPERVISOR') || sup.includes('ADMIN')) ? 'EVALUADOR Y EVALUADO' : 'EVALUADO';
  }
  const esEvaluador = emp => rolDe(emp).includes('EVALUADOR');
  const rolEsEvaluado = r => r === 'EVALUADO' || r === 'EVALUADOR Y EVALUADO';
  const esEvaluado = emp => rolEsEvaluado(rolDe(emp));   // un EVALUADOR puro no se evalua

  function hoyLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function normFecha(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }
  function diasDesde(fecha) {
    const f = normFecha(fecha);
    if (!f) return null;
    return Math.floor((new Date(hoyLocal() + 'T00:00:00') - new Date(f + 'T00:00:00')) / 86400000);
  }
  const fechaCorta = f => { const n = normFecha(f); return n ? n.split('-').reverse().join('/') : ''; };
  // Fecha (hora de Ecuador) de una marca de tiempo: de noche, la fecha UTC ya es la del día siguiente
  const fechaDeHora = s => { const d = new Date(s); return s && !isNaN(d) ? d.toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; };
  const fechaLarga = f => {
    const n = normFecha(f);
    if (!n) return '';
    const [y, m, d] = n.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const ORDINAL_T = ['1.er', '2.º', '3.er', '4.º'];
  const etiquetaPeriodo = per => {
    if (per === 'DIA75') return 'Seguimiento Día 75';
    if (per === 'TODAS') return 'Todas las evaluaciones';
    const t = String(per || '').match(/^(\d{4})-T([1-4])$/);
    if (t) return `${ORDINAL_T[Number(t[2]) - 1]} trimestre ${t[1]} (${MESES[(Number(t[2]) - 1) * 3].slice(0, 3).toLowerCase()}–${MESES[Number(t[2]) * 3 - 1].slice(0, 3).toLowerCase()})`;
    const m = String(per || '').match(/^(\d{4})-(\d{2})$/);
    return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : per;
  };
  // Frecuencia del cuestionario: MENSUAL o TRIMESTRAL (trimestres calendario)
  const TIPO_P = () => (CFG.frecuencia === 'TRIMESTRAL' ? 'TRIMESTRAL' : 'MENSUAL');
  const trimestral = () => TIPO_P() === 'TRIMESTRAL';
  const nombreFrecuencia = (tipo = TIPO_P()) => (tipo === 'TRIMESTRAL' ? 'Trimestral' : 'Mensual');
  const textoPeriodo = () => (trimestral() ? 'trimestre' : 'mes');
  const trimestreDe = (y, m) => `${y}-T${Math.ceil(m / 3)}`;
  // ¿El período corresponde a la frecuencia vigente? (si no, se toma el período por defecto)
  const periodoValido = per => (trimestral() ? /^\d{4}-T[1-4]$/ : /^\d{4}-\d{2}$/).test(String(per || ''));
  // Mes base (para filtrar la historia): desde el día 20 se toma el mes en curso; antes, el anterior
  function mesPorDefecto() {
    const d = new Date();
    if (d.getDate() < 20) d.setMonth(d.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // Período a evaluar por defecto: el mes base o, en trimestral, el trimestre cuyo último mes ya llegó
  function periodoPorDefecto() {
    const mes = mesPorDefecto();
    if (!trimestral()) return mes;
    const [y, m] = mes.split('-').map(Number);
    if (m % 3 === 0) return trimestreDe(y, m);
    const q = Math.ceil(m / 3) - 1;
    return q >= 1 ? `${y}-T${q}` : `${y - 1}-T4`;
  }
  function periodoAnterior(per) {
    const t = String(per || '').match(/^(\d{4})-T([1-4])$/);
    if (t) return Number(t[2]) > 1 ? `${t[1]}-T${Number(t[2]) - 1}` : `${Number(t[1]) - 1}-T4`;
    return mesAnterior(per, 1);
  }
  // Períodos para elegir: los últimos n meses o trimestres (desde el actual)
  function periodosDisponibles(n = 4) {
    if (!trimestral()) return mesesDisponibles(n);
    const d = new Date();
    let per = trimestreDe(d.getFullYear(), d.getMonth() + 1);
    const out = [];
    for (let i = 0; i < n; i++) { out.push(per); per = periodoAnterior(per); }
    return out;
  }
  function mesesDisponibles(n = 4) {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 0; i < n; i++) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }
  function mesAnterior(per, n) {
    const [y, m] = per.split('-').map(Number);
    const d = new Date(y, m - 1 - n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // Próxima evaluación por defecto: fin del mes siguiente o, en trimestral, fin del trimestre siguiente
  function finDeMesSiguiente() {
    const d = new Date();
    const f = trimestral()
      ? new Date(d.getFullYear(), (Math.ceil((d.getMonth() + 1) / 3) + 1) * 3, 0)
      : new Date(d.getFullYear(), d.getMonth() + 2, 0);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  }
  // Desde 2026-11-27 todos se evalúan desde el día 0 (mensual siempre disponible). El seguimiento Día 75 sigue
  // ofreciéndose entre los días 60 y 120 como evaluación adicional.
  function etapa(emp) {
    const dias = diasDesde(emp && (emp.fecha_ingreso || emp.fechaIngreso));
    return { dias, dia75: dias !== null && dias >= 60 && dias <= 120, mensual: true };
  }

  // Plazo para evaluar un período (mes o trimestre): el día evaluarDia del mes siguiente a su cierre
  // (el servidor lo vuelve a validar)
  function limiteEvaluar(per) {
    const t = String(per || '').match(/^(\d{4})-T([1-4])$/);
    const m = t ? [null, t[1], String(Number(t[2]) * 3)] : String(per || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]), Number((CFG.plazos || {}).evaluarDia) || 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const reabierta = (empId, per) => REAPERTURAS.some(r => r.tipo === 'evaluar' && String(r.empleadoId) === String(empId) && r.periodo === per && normFecha(r.hasta) >= hoyLocal());
  function plazoEvaluar(ses, empId, per) {
    const lim = limiteEvaluar(per);
    const abierta = reabierta(empId, per);
    const vencido = !!lim && hoyLocal() > lim && !abierta;
    return { lim, vencido, reabierto: abierta, bloqueado: vencido && !(ses && ses.master) };
  }

  function toast(msg, tipo = 'info') {
    if (typeof window.mostrarToast === 'function') return window.mostrarToast(msg, tipo);
    if (typeof window.showToast === 'function') return window.showToast(msg, tipo);
    let t = document.getElementById('evToast');
    if (!t) { t = document.createElement('div'); t.id = 'evToast'; t.className = 'ev-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = `ev-toast ev-toast-${tipo} ev-toast-on`;
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('ev-toast-on'), 3500);
  }

  // ---------------------------------------------------------------- sesión y API
  const KEY_SESION = 'tcontrol_sesion_eval';

  function sesionGuardada(empleadoId) {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY_SESION) || 'null');
      if (s && s.token && String(s.empleadoId) === String(empleadoId) && s.exp * 1000 - Date.now() > 5 * 60 * 1000) return s;
    } catch (e) { }
    return null;
  }
  function cerrarSesion() { try { sessionStorage.removeItem(KEY_SESION); } catch (e) { } }

  async function iniciarSesion(empleadoId, pin) {
    if (!window.FirebaseBackend || typeof window.FirebaseBackend._post !== 'function') throw new Error('Servicio no disponible');
    const res = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: String(empleadoId), pin: String(pin) });
    if (!res || !res.ok || !res.token) {
      const err = (res && res.error) || '';
      if (/API Key|Acción no reconocida|No autorizado/i.test(err)) throw new Error('La evaluación de desempeño aún no está habilitada en el servidor.');
      throw new Error(err || 'No se pudo verificar tu contraseña.');
    }
    const s = { token: res.token, exp: res.exp, empleadoId: String(empleadoId), equipo: res.equipo || [], rrhh: !!res.rrhh, master: !!res.master, revisor: !!res.revisor };
    try { sessionStorage.setItem(KEY_SESION, JSON.stringify(s)); } catch (e) { }
    return s;
  }

  // Respuesta de PostgREST (directa o reenviada por Apps Script) → resultado o error claro
  function interpretar(status, r) {
    if (status === 401) { cerrarSesion(); throw Object.assign(new Error('Tu sesión venció. Vuelve a ingresar tu contraseña.'), { sesion: true }); }
    if (status < 200 || status >= 300) {
      const det = r && (r.message || r.hint || r.error) || '';
      throw Object.assign(new Error(`HTTP ${status}${det ? ': ' + det : ''}`), { servidor: true });
    }
    if (r && r.ok === false && /Sesión de evaluación no válida/.test(r.error || '')) {
      cerrarSesion();
      throw Object.assign(new Error(r.error), { sesion: true });
    }
    return r;
  }

  // Respaldo para redes o equipos que bloquean *.trycloudflare.com: Apps Script reenvía la llamada.
  // Directo ≈ 0,4 s por consulta; por Apps Script ≈ 3 s. Si la conexión directa falla, el respaldo se
  // recuerda 30 min en el navegador (todas las pestañas) y después se vuelve a probar la directa.
  const KEY_PROXY = 'tcontrol_eval_via_apps_script';
  const PROXY_VIGENCIA_MS = 30 * 60 * 1000;
  function usarProxy() {
    try {
      const t = Number(localStorage.getItem(KEY_PROXY) || 0);
      if (t && Date.now() - t < PROXY_VIGENCIA_MS) return true;
      localStorage.removeItem(KEY_PROXY);
    } catch (e) { }
    return false;
  }
  function marcarProxy(si) {
    try { if (si) localStorage.setItem(KEY_PROXY, String(Date.now())); else localStorage.removeItem(KEY_PROXY); } catch (e) { }
  }
  // Ruta y duración de la última carga (se muestran al pie del módulo)
  const medicion = { ruta: '', ms: 0 };
  async function rpcPorAppsScript(ses, fn, p) {
    const res = await window.FirebaseBackend._post({ accion: 'evalRpc', token: ses.token, fn, p: JSON.stringify(p) });
    if (!res || typeof res.status !== 'number') {
      throw new Error((res && res.error) || 'sin respuesta de Apps Script');
    }
    return interpretar(res.status, res.body || res);   // sin body: error de Apps Script con su mensaje
  }

  async function rpcDirecto(ses, fn, p) {
    const fb = window.FirebaseBackend;
    let causa = '';
    for (let intento = 0; intento < 2; intento++) {
      // La URL del túnel se lee de Firestore y se guarda 10 min; si quedó vacía o falló, se vuelve a leer
      let base = await fb._urlHistorico(intento > 0);
      if (!base && intento === 0) base = await fb._urlHistorico(true);
      if (!base) { causa = 'sin dirección del servidor'; continue; }
      const ctrl = new AbortController();
      // Normalmente responde en menos de 1 s: si no, mejor pasar pronto al respaldo
      const t = setTimeout(() => ctrl.abort(), intento === 0 ? 8000 : 12000);
      try {
        const resp = await fetch(`${base}/rpc/${fn}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + ses.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p }),
          signal: ctrl.signal
        });
        let r = null;
        try { r = await resp.json(); } catch (e) { }
        return interpretar(resp.status, r);
      } catch (e) {
        if (e.sesion || e.servidor) throw e;
        causa = e.name === 'AbortError' ? 'el servidor tardó demasiado' : (e.message || String(e));
        console.warn('Evaluaciones: conexión directa falló', causa);
      } finally { clearTimeout(t); }
    }
    throw Object.assign(new Error(causa), { red: true });
  }

  async function rpc(ses, fn, p) {
    const t0 = performance.now();
    const medir = (ruta, r) => { medicion.ruta = ruta; medicion.ms = Math.round(performance.now() - t0); return r; };
    const viaProxy = usarProxy();
    if (!viaProxy) {
      try {
        return medir('directa', await rpcDirecto(ses, fn, p));
      } catch (e) {
        if (!e.red) throw e;
        console.warn('Evaluaciones: se usa Apps Script como respaldo');
        marcarProxy(true);
        try {
          return medir('respaldo', await rpcPorAppsScript(ses, fn, p));
        } catch (e2) {
          if (e2.sesion || e2.servidor) throw e2;
          throw new Error(`La base de evaluaciones no está disponible en este momento (${e.message}; respaldo: ${e2.message}). Intenta en unos minutos.`);
        }
      }
    }
    try {
      return medir('respaldo', await rpcPorAppsScript(ses, fn, p));
    } catch (e) {
      if (e.sesion || e.servidor) throw e;
      // El respaldo falló: probar de nuevo la conexión directa
      marcarProxy(false);
      try {
        return medir('directa', await rpcDirecto(ses, fn, p));
      } catch (e2) {
        if (e2.sesion || e2.servidor) throw e2;
        throw new Error(`La base de evaluaciones no está disponible en este momento (${e2.message}; respaldo: ${e.message}). Intenta en unos minutos.`);
      }
    }
  }

  // ---------------------------------------------------------------- piezas de interfaz
  const heroHtml = () => `
    <div class="ev-hero">
      <div class="ev-hero-txt">
        <h2>Hagamos un alto, <em>para seguir creciendo</em></h2>
        <p>Una herramienta para reconocer avances, conversar con datos y construir juntos el desarrollo profesional de cada persona.</p>
      </div>
      <div class="ev-hero-ico" aria-hidden="true"><i class="fas fa-seedling"></i></div>
    </div>`;

  const pinHtml = (error = '') => `
    <div class="ev-card ev-pin">
      <div class="ev-pin-ico"><i class="fas fa-lock"></i></div>
      <h3>Confirma tu contraseña</h3>
      <p class="ev-muted">Las evaluaciones son información personal. Ingresa la contraseña con la que entras a la app.</p>
      <form class="ev-pin-form" data-ev="pin">
        <input type="password" autocomplete="current-password" maxlength="40" placeholder="Contraseña" required>
        <button type="submit" class="ev-btn ev-btn-primary">Continuar</button>
      </form>
      <div class="ev-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
    </div>`;

  const chipEstado = e => {
    if (!e) return '<span class="ev-chip ev-chip-pend">Pendiente</span>';
    if (e.estado === 'confirmada') return '<span class="ev-chip ev-chip-ok" title="El colaborador la abrió"><i class="fas fa-check"></i> Recibida</span>';
    if (e.estado === 'revision') return '<span class="ev-chip ev-chip-warn"><i class="fas fa-user-shield"></i> En revisión TTHH</span>';
    if (e.estado === 'devuelta') return '<span class="ev-chip ev-chip-warn"><i class="fas fa-undo"></i> Devuelta por TTHH</span>';
    if (e.correccionHasta) return '<span class="ev-chip ev-chip-env"><i class="fas fa-pen"></i> En corrección</span>';
    return '<span class="ev-chip ev-chip-env" title="El colaborador aún no la abre">Enviada</span>';
  };
  // Categoría de desempeño según el porcentaje y las categorías vigentes (también para evaluaciones antiguas)
  const nivelEval = e => nivelDe(Number(e && e.porcentaje) || 0);
  const chipNivel = e => e ? `<span class="ev-nivel ${claseNivel(nivelEval(e))}">${pct(e.porcentaje)} · ${esc(nivelEval(e))}</span>` : '';
  const chipDesempeno = e => e ? `<span class="ev-nivel ${claseNivel(nivelEval(e))}">${esc(nivelEval(e))}</span>` : '<span class="ev-muted">—</span>';

  function barrasDimensiones(dims, lista = DIMENSIONES) {
    return `<div class="ev-dims">${lista.map(d => {
      const x = (dims && dims[d.k]) || { porcentaje: 0, nivel: '' };
      const p = Math.max(0, Math.min(1, Number(x.porcentaje) || 0));
      const nv = x.nivel === 'Incompleto' ? 'Incompleto' : (x.nivel ? nivelDe(p) : '');
      return `<div class="ev-dim">
        <div class="ev-dim-top"><span>${esc(d.t)}</span><strong class="ev-tx-k ${claseNivel(nv)}">${pct(p)}</strong></div>
        <div class="ev-bar"><div class="ev-bar-fill ${claseNivel(nv)}" style="width:${Math.round(p * 100)}%"></div></div>
        <div class="ev-dim-nivel">${esc(nv)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  // vista: 'evaluado' (qué puede hacer la persona) o 'evaluador' (qué debe hacer el jefe)
  function resumenHtml(r, compacto = false, dimsLista, vista = 'evaluador', ev = null) {
    const nivelR = r.completa === false ? r.nivel : nivelDe(Number(r.porcentaje) || 0);
    const d = datosNivel(nivelR);
    let hacer = '', titulo = 'Qué hacer';
    if (vista === 'evaluado') hacer = RECOMENDACION[nivelR] || '';
    else if (r.completa !== false) {
      const f = ev ? fb(ev) : { exigido: !!d.i || esCierreTrimestre(r.periodo), motivo: d.i ? 'intervencion' : 'trimestre' };
      if (d.i) { titulo = 'Intervención inmediata'; hacer = 'El feedback y los compromisos son obligatorios.'; }
      else hacer = f.exigido ? 'Feedback obligatorio por cierre de trimestre.' : 'Feedback opcional este mes (obligatorio en el cierre de cada trimestre).';
    }
    return `<div class="ev-resumen ${compacto ? 'ev-resumen-compacto' : ''}">
      <div class="ev-resumen-total ${claseNivel(nivelR)}">
        <div class="ev-resumen-pct">${pct(r.porcentaje)}</div>
        <div class="ev-resumen-nivel">${esc(nivelR)}</div>
        ${d.msg ? `<div class="ev-resumen-msg">${esc(d.msg)}</div>` : ''}
        <div class="ev-muted">${r.puntaje} de ${r.maximo || 500} puntos</div>
      </div>
      ${barrasDimensiones(r.dimensiones, dimsLista)}
    </div>
    ${hacer ? `<div class="ev-reco ${claseNivel(nivelR)}"><i class="fas ${titulo === 'Qué hacer' ? 'fa-lightbulb' : 'fa-exclamation-triangle'}"></i> <span><strong>${titulo}:</strong> ${esc(hacer)}</span></div>` : ''}`;
  }

  function detalleHtml(e, opciones = {}) {
    const escalaE = escalaDe(e);
    const items = itemsDe(e).map((it, i) => {
      const v = Number(e.calificaciones && e.calificaciones[i]) || 0;
      const o = (e.observaciones && e.observaciones[i]) || '';
      return `<div class="ev-det-item">
        <div class="ev-det-num">${i + 1}</div>
        <div class="ev-det-body">
          <div class="ev-det-c">${esc(it.c)} <span class="ev-peso">${it.peso}%</span></div>
          ${o ? `<div class="ev-det-obs">${esc(o)}</div>` : ''}
        </div>
        <div class="ev-det-cal ${claseNota(v, escalaMax(escalaE))}">${v || '–'}</div>
      </div>`;
    }).join('');
    const bloque = (t, x) => x ? `<div class="ev-texto"><h4>${t}</h4><p>${esc(x)}</p></div>` : '';
    return `
      <div class="ev-card">
        <div class="ev-det-head">
          <div>
            <div class="ev-eyebrow">${esc(e.tipo === 'DIA75' ? 'Seguimiento nuevo ingreso' : `Evaluación ${nombreFrecuencia(e.tipo).toLowerCase()}`)}</div>
            <h3>${esc(etiquetaPeriodo(e.periodo))}</h3>
            <div class="ev-muted">${esc(e.empleadoNombre || e.empleadoId)} · Evaluó ${esc(e.evaluadorNombre || e.evaluadorId)} · ${fechaCorta(e.fechaAplicacion)}</div>
            <div class="ev-small ev-plazos">${fb(e).exigido && fb(e).estado !== 'realizada' && fb(e).vence
              ? `<span class="${fb(e).vencido ? 'ev-danger' : ''}"><i class="far fa-hourglass"></i> ${fb(e).vencido ? 'Feedback vencido el ' : 'Feedback hasta el '}${fechaCorta(fb(e).vence)}</span>` : ''}
              ${e.vigenteHasta ? `<span class="${e.vigente === false ? 'ev-danger' : ''}"><i class="far fa-calendar-check"></i> ${e.vigente === false ? 'Desactualizada desde el ' : 'Vigente hasta el '}${fechaCorta(e.vigenteHasta)}</span>` : ''}</div>
          </div>
          <div class="ev-det-chips">${chipEstado(e)}${chipFeedback(e)}</div>
        </div>
        ${resumenHtml({ puntaje: e.puntaje, maximo: e.puntajeMaximo, porcentaje: Number(e.porcentaje), nivel: e.nivel, dimensiones: e.dimensiones, periodo: e.periodo }, false, dimensionesDe(e), opciones.vista, e)}
      </div>
      ${opciones.aviso || ''}
      <div class="ev-card"><h4 class="ev-h4">Calificación por comportamiento</h4>${items}</div>
      ${(e.fortalezas || e.mejoras || e.compromisos || e.proximaEvaluacion || e.comentarioColaborador) ? `<div class="ev-card">
        ${bloque('Fortalezas observadas', e.fortalezas)}
        ${bloque('Oportunidades de mejora', e.mejoras)}
        ${bloque('Compromisos para el próximo período', e.compromisos)}
        ${e.proximaEvaluacion ? `<div class="ev-texto"><h4>Próxima evaluación</h4><p>${fechaCorta(e.proximaEvaluacion)}</p></div>` : ''}
        ${bloque('Comentario del colaborador', e.comentarioColaborador)}
      </div>` : ''}
      ${opciones.historial || ''}
      ${opciones.acciones || ''}`;
  }

  // ---------------------------------------------------------------- bloqueo del módulo (lo maneja el admin master)
  // Firestore configuracion/bloqueo_desarrollo {activo, mensaje}. Bloquea Desarrollo en la app y «Mi equipo» en el
  // panel; Resultados y Configuración siguen abiertos. Mientras el documento no exista, rige lo de aquí abajo.
  // También pausa los recordatorios diarios (notificaciones.gs).
  const BLOQUEO_BASE = {
    activo: true, mensaje: ['¡Estamos avanzando con nuestro primer mes de Evaluación de Desempeño! 🚀📊',
      '',
      'El día lunes 30 tendremos una reunión para revisar cómo se ha desarrollado este primer mes, compartir novedades y resolver inquietudes sobre el proceso para que puedan completar el nuevo periodo. Les pedimos estar atentos a la convocatoria.',
      '',
      '⚠️ Por el momento, les solicitamos no completar las evaluaciones del nuevo período. Es importante esperar a la reunión, ya que allí se brindarán las indicaciones correspondientes.',
      '',
      '¡Gracias por su compromiso y participación! 🙌'].join('\n')
  };
  let bloqueo = null;              // null = todavía no se sabe
  let bloqueoEscucha = false;
  const bloqueoOyentes = new Set();
  const CLAVE_BLOQUEO = 'tcontrol_eval_bloqueo';
  // Excepción por persona (2026-11-27): configuracion/bloqueo_desarrollo.permitidos = ['2030', …] → esas personas
  // ven Desarrollo abierto aunque el módulo esté bloqueado para los demás.
  const estaBloqueado = st => !!(bloqueo && bloqueo.activo && !((bloqueo.permitidos || []).map(String).includes(String((st && st.emp && st.emp.id) || ''))));
  function bloqueoGuardado() {
    try { return JSON.parse(localStorage.getItem(CLAVE_BLOQUEO) || 'null'); } catch (e) { return null; }
  }
  function aplicarBloqueo(b) {
    bloqueo = b;
    try { localStorage.setItem(CLAVE_BLOQUEO, JSON.stringify({ activo: b.activo, mensaje: b.mensaje, permitidos: b.permitidos || [] })); } catch (e) { }
    bloqueoOyentes.forEach(o => { if (o.cont.isConnected) o.f(); else bloqueoOyentes.delete(o); });
  }
  const refBloqueo = () => firebase.firestore().collection('configuracion').doc('bloqueo_desarrollo');
  // Llama a `f` cuando se conoce el estado y cada vez que cambia
  function alCambiarBloqueo(cont, f) {
    bloqueoOyentes.add({ cont, f });
    if (bloqueo) f();
    if (bloqueoEscucha) return;
    bloqueoEscucha = true;
    // Sin respuesta de Firestore se usa el último estado conocido en este equipo
    const sinRespuesta = () => { if (!bloqueo) aplicarBloqueo(bloqueoGuardado() || { activo: false, mensaje: '' }); };
    try {
      setTimeout(sinRespuesta, 6000);
      refBloqueo().onSnapshot(d => {
        if (!d.exists) { if (!d.metadata.fromCache) aplicarBloqueo(Object.assign({}, BLOQUEO_BASE)); return; }
        const x = d.data() || {};
        aplicarBloqueo({ activo: x.activo === true, mensaje: String(x.mensaje || BLOQUEO_BASE.mensaje), permitidos: Array.isArray(x.permitidos) ? x.permitidos.map(String) : [] });
      }, e => { bloqueoEscucha = false; console.warn('Evaluaciones: no se pudo leer el bloqueo', e); sinRespuesta(); });
    } catch (e) { bloqueoEscucha = false; sinRespuesta(); }
  }
  async function guardarBloqueo(activo, mensaje, por) {
    const tope = new Promise((_, no) => setTimeout(() => no(new Error('No hubo respuesta del servidor. Revisa tu conexión.')), 12000));
    await Promise.race([refBloqueo().set({ activo, mensaje, actualizado_por: String(por || ''), actualizado_en: new Date().toISOString() }), tope]);
  }
  const bloqueoHtml = mensaje => `<div class="ev-card ev-bloqueo"><div class="ev-bloqueo-ico"><i class="fas fa-lock"></i></div>
    <h3>Desarrollo está en pausa</h3><p>${esc(mensaje)}</p></div>`;

  // Barra del panel: el master bloquea, edita el mensaje y desbloquea; los demás solo ven que está bloqueado
  function montarBarraBloqueo(cont, opts) {
    let modo = '', texto = '', ocupado = false;
    const pintarBarra = () => {
      if (!bloqueo || (!bloqueo.activo && !opts.esMaster)) { cont.innerHTML = ''; return; }
      const on = bloqueo.activo;
      const botones = !opts.esMaster || modo === 'editar' ? '' : modo === 'desbloquear'
        ? `<span class="ev-small">¿Abrir Desarrollo para todos?</span>
           <button class="ev-btn ev-btn-sm ev-btn-primary" data-b="si" ${ocupado ? 'disabled' : ''}>Sí, desbloquear</button><button class="ev-btn ev-btn-sm" data-b="no">Cancelar</button>`
        : on ? '<button class="ev-btn ev-btn-sm" data-b="editar"><i class="fas fa-pen"></i> Mensaje</button><button class="ev-btn ev-btn-sm ev-btn-primary" data-b="desbloquear"><i class="fas fa-unlock"></i> Desbloquear</button>'
          : '<button class="ev-btn ev-btn-sm" data-b="editar"><i class="fas fa-lock"></i> Bloquear</button>';
      cont.innerHTML = `<div class="ev-card ev-barra-blq ${on ? 'ev-barra-blq-on' : ''}">
        <div class="ev-barra-blq-fila"><i class="fas fa-${on ? 'lock' : 'lock-open'}"></i>
          <span><strong>${on ? 'Desarrollo está bloqueado' : 'Desarrollo está abierto'}</strong>${on ? '<span class="ev-small ev-muted"> · La app muestra el mensaje y los recordatorios diarios están en pausa. Resultados sigue disponible.</span>' : ''}</span>
          <span class="ev-barra-blq-bot">${botones}</span></div>
        ${modo === 'editar' && opts.esMaster ? `<label class="ev-campo ev-mt"><span>Mensaje que verá el personal</span><textarea data-b="texto" rows="9" maxlength="1500">${esc(texto)}</textarea></label>
          <div class="ev-actions"><button class="ev-btn ev-btn-sm" data-b="no">Cancelar</button><button class="ev-btn ev-btn-sm ev-btn-primary" data-b="guardar" ${ocupado ? 'disabled' : ''}>${on ? 'Guardar mensaje' : 'Bloquear Desarrollo'}</button></div>` : ''}
      </div>`;
    };
    const guardar = async (activo, mensaje, aviso) => {
      ocupado = true; pintarBarra();
      try {
        await guardarBloqueo(activo, mensaje, opts.empleado.id);
        modo = ''; toast(aviso, 'success');
      } catch (e) { toast('No se guardó: ' + (e.message || e), 'error'); }
      ocupado = false; pintarBarra();
    };
    cont.addEventListener('input', ev => { if (ev.target.dataset.b === 'texto') texto = ev.target.value; });
    cont.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-b]');
      if (!b || !opts.esMaster || ocupado) return;
      const a = b.dataset.b;
      if (a === 'no') modo = '';
      else if (a === 'editar') { modo = 'editar'; texto = bloqueo.mensaje || BLOQUEO_BASE.mensaje; }
      else if (a === 'desbloquear') modo = 'desbloquear';
      else if (a === 'si') return guardar(false, bloqueo.mensaje || '', 'Desarrollo quedó abierto');
      else if (a === 'guardar') {
        if (!texto.trim()) return toast('Escribe el mensaje.', 'warning');
        return guardar(true, texto.trim(), bloqueo.activo ? 'Mensaje guardado' : 'Desarrollo quedó bloqueado');
      }
      pintarBarra();
    });
    alCambiarBloqueo(cont, () => { if (modo !== 'editar') pintarBarra(); });
  }

  // ---------------------------------------------------------------- vista del colaborador / evaluador
  function montar(cont, opts) {
    const st = {
      cont, emp: opts.empleado || {}, ses: sesionGuardada((opts.empleado || {}).id), mias: [], hechas: [],
      mes: periodoPorDefecto(), vista: 'inicio', cargando: false, error: '', form: null, sel: null, embebido: !!opts.embebido,
      enlace: opts.enlace || null
    };
    cont._ev = st;
    cont.addEventListener('click', ev => manejarClick(st, ev));
    cont.addEventListener('submit', ev => manejarSubmit(st, ev));
    cont.addEventListener('change', ev => manejarCambio(st, ev));
    cont.addEventListener('input', ev => manejarInput(st, ev));
    if (!opts.diferido) {
      st.bloqueable = true;
      pintar(st);
      alCambiarBloqueo(cont, () => {
        if (estaBloqueado(st) || st.iniciado) return pintar(st);
        st.iniciado = true;
        if (st.ses) cargar(st); else pintar(st);
      });
    }
    return st;
  }

  // El equipo viaja en la sesión (token de 8 h). Si en Firestore alguien cambió de evaluador desde
  // entonces, la sesión se cierra para que el PIN emita un equipo nuevo (y permisos acordes).
  async function equipoVigente(ses) {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) return true;
      const snap = await firebase.firestore().collection('empleados').where('evaluador_id', '==', String(ses.empleadoId)).get();
      const actual = new Set(), puros = new Set();   // puros: EVALUADOR sin evaluarse; el servidor viejo aun los incluia en el equipo
      snap.forEach(d => {
        const e = d.data() || {};
        const id = String(e.id || d.id).trim();
        if (!id || id === String(ses.empleadoId)) return;
        if (String(e.activo || 'SI').toUpperCase() === 'NO' || e.activo === false) return;
        if (!rolEsEvaluado(String(e.evaluacion_rol || 'EVALUADO').toUpperCase().trim())) { puros.add(id); return; }
        actual.add(id);
      });
      const enSesion = new Set((ses.equipo || []).map(m => String(m.id)).filter(id => !puros.has(id)));
      return actual.size === enSesion.size && [...actual].every(id => enSesion.has(id));
    } catch (e) {
      console.warn('Evaluaciones: no se pudo verificar el equipo', e);
      return true; // sin conexión con Firestore no se bloquea al evaluador
    }
  }
  const AVISO_EQUIPO = 'Tu equipo de evaluación cambió. Ingresa tu contraseña de nuevo para actualizarlo.';

  async function cargar(st) {
    if (st.bloqueable && (!bloqueo || estaBloqueado(st))) return pintar(st);
    st.iniciado = true;
    st.cargando = true; st.error = '';
    pintar(st);
    try {
      const desde = mesAnterior(mesPorDefecto(), 12);
      const resultados = await Promise.allSettled([
        equipoVigente(st.ses),
        rpc(st.ses, 'eval_listar', { modo: 'mias' }),
        st.ses.equipo.length ? rpc(st.ses, 'eval_listar', { modo: 'equipo', desde }) : Promise.resolve({ ok: true, evaluaciones: [] }),
        cargarConfig(st.ses)
      ]);
      // El aviso de equipo cambiado tiene prioridad sobre cualquier error de la base
      if (resultados[0].status === 'fulfilled' && resultados[0].value === false) {
        cerrarSesion();
        throw Object.assign(new Error(AVISO_EQUIPO), { sesion: true });
      }
      const fallo = resultados.find(r => r.status === 'rejected');
      if (fallo) throw fallo.reason;
      const mias = resultados[1].value, equipo = resultados[2].value;
      if (!mias.ok) throw new Error(mias.error);
      if (!equipo.ok) throw new Error(equipo.error);
      st.mias = mias.evaluaciones || [];
      st.hechas = equipo.evaluaciones || [];
      if (!periodoValido(st.mes)) st.mes = periodoPorDefecto();   // la frecuencia llega con el cuestionario
    } catch (e) {
      if (e.sesion) st.ses = null;
      st.error = e.message || String(e);
    }
    st.cargando = false;
    pintar(st);
    aplicarEnlace(st);
  }

  // Enlace de una notificación: mes a mostrar y, si trae ID, el detalle de esa evaluación
  function aplicarEnlace(st) {
    const e = st.enlace;
    if (!e || !st.ses || st.cargando) return;
    st.enlace = null;
    if (/^\d{4}-(\d{2}|T[1-4])$/.test(e.periodo || '')) { st.mes = e.periodo; if (st.filtro) st.filtro.periodo = e.periodo; }
    else if (e.periodo === 'DIA75' && st.filtro) st.filtro.periodo = 'DIA75';
    const sel = e.id ? buscarEval(st, e.id) : null;
    if (sel) { st.pila = []; ir(st, 'detalle', { sel }); }
    else if (e.id) { pintar(st); toast('Esa evaluación ya no está disponible.', 'warning'); }
    else pintar(st);
  }

  function pieMedicion() {
    if (!medicion.ruta) return '';
    const s = (medicion.ms / 1000).toFixed(1);
    return `<p class="ev-muted ev-small" style="text-align:right;margin:6px 4px 0;">Cargado en ${s} s · ${medicion.ruta === 'directa'
      ? 'conexión directa' : 'por Apps Script (la red bloquea la conexión directa)'}</p>`;
  }

  function pintar(st) {
    const c = st.cont;
    if (!st.ses) { c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}${pinHtml(st.error)}</div>`; return; }
    if (st.cargando) { c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}<div class="ev-card ev-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando evaluaciones…</div></div>`; return; }
    if (st.vista === 'form') { c.innerHTML = `<div class="ev-root">${formHtml(st)}</div>`; return; }
    if (st.vista === 'detalle') { c.innerHTML = `<div class="ev-root">${vistaDetalle(st)}</div>`; arriba(st); return; }
    if (st.vista === 'persona') { c.innerHTML = `<div class="ev-root">${personaHtml(st)}</div>`; arriba(st); return; }
    c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}${st.error ? `<div class="ev-card ev-error-card"><i class="fas fa-exclamation-triangle"></i> ${esc(st.error)} <button class="ev-link" data-ev="recargar">Reintentar</button></div>` : ''}${equipoHtml(st)}${miasHtml(st)}${pieMedicion()}</div>`;
  }

  function equipoHtml(st) {
    if (!st.ses.equipo.length) {
      return esEvaluador(st.emp) ? `<div class="ev-card"><h3 class="ev-h3"><i class="fas fa-users"></i> Mi equipo</h3>
        <p class="ev-muted">Aún no tienes colaboradores asignados para evaluar. Psicología Organizacional los asigna desde el panel. <button class="ev-link" data-ev="salir">Actualizar</button></p></div>` : '';
    }
    const filas = st.ses.equipo.map(m => {
      const et = etapa(m);
      const men = st.hechas.find(e => e.empleadoId === m.id && e.tipo === TIPO_P() && e.periodo === st.mes);
      const d75 = st.hechas.find(e => e.empleadoId === m.id && e.tipo === 'DIA75');
      let acciones = '';
      if (et.dia75 || d75) {
        acciones += `<div class="ev-eq-tipo"><span class="ev-eq-lbl">Día 75${et.dias !== null ? ` · día ${et.dias}` : ''}</span>${chipEstado(d75)}${chipNivel(d75)}${retenida(d75) ? '' : chipFeedback(d75)}
          ${d75 ? `<button class="ev-btn ev-btn-sm" data-ev="ver" data-id="${d75.id}">Ver</button>` : ''}
          ${!d75 || d75.estado !== 'confirmada' ? `<button class="ev-btn ev-btn-sm ${d75 && d75.estado !== 'devuelta' ? '' : 'ev-btn-primary'}" data-ev="evaluar" data-tipo="DIA75" data-emp="${esc(m.id)}">${d75 ? 'Corregir' : 'Evaluar'}</button>` : ''}</div>`;
      }
      if (et.mensual) {
        const pl = plazoEvaluar(st.ses, m.id, st.mes);
        const abierta = !men || men.estado !== 'confirmada';
        acciones += `<div class="ev-eq-tipo"><span class="ev-eq-lbl">${nombreFrecuencia()}</span>${chipEstado(men)}${chipNivel(men)}${retenida(men) ? '' : chipFeedback(men)}
          ${men ? `<button class="ev-btn ev-btn-sm" data-ev="ver" data-id="${men.id}">Ver</button>` : ''}
          ${abierta && pl.bloqueado ? `<span class="ev-chip ev-chip-warn" title="Solo el administrador puede reabrirlo"><i class="fas fa-lock"></i> Plazo vencido el ${fechaCorta(pl.lim)}</span>` : ''}
          ${abierta && !pl.bloqueado ? `<button class="ev-btn ev-btn-sm ${men && men.estado !== 'devuelta' ? '' : 'ev-btn-primary'}" data-ev="evaluar" data-tipo="${TIPO_P()}" data-emp="${esc(m.id)}">${men ? 'Corregir' : 'Evaluar'}</button>` : ''}
          ${!men && !pl.vencido && pl.lim ? `<span class="ev-muted ev-small">hasta el ${fechaCorta(pl.lim)}</span>` : ''}
          ${pl.reabierto && !men ? '<span class="ev-chip ev-chip-env">Plazo reabierto</span>' : ''}</div>`;
      } else if (!et.dia75 && !d75) {
        acciones += `<div class="ev-eq-tipo"><span class="ev-muted">En período de prueba (día ${et.dias}). El seguimiento Día 75 se habilita desde el día 60.</span></div>`;
      }
      const pideReunion = st.hechas.some(e => e.empleadoId === m.id && e.reunion && e.reunion.estado === 'solicitada');
      const intervencion = men && !retenida(men) && requiereIntervencion(men) && fb(men).estado !== 'realizada';
      return `<div class="ev-eq">
        <div class="ev-avatar">${m.foto_url ? `<img src="${esc(m.foto_url)}" alt="" onerror="this.remove()">` : ''}<span>${esc(iniciales(m.nombre))}</span></div>
        <div class="ev-eq-info"><strong>${esc(m.nombre || m.id)}</strong>${pideReunion ? ' <span class="ev-chip ev-chip-reu"><i class="fas fa-comments"></i> Pidió reunión</span>' : ''}${intervencion ? ' <span class="ev-chip ev-chip-warn"><i class="fas fa-exclamation-triangle"></i> Intervención inmediata</span>' : ''}<span class="ev-muted">${esc(m.cargo || '')}${m.area ? ' · ' + esc(m.area) : ''}${st.hechas.some(e => e.empleadoId === m.id) ? ` · <button class="ev-link" data-ev="persona" data-emp="${esc(m.id)}">Ver evolución</button>` : ''}</span>${acciones}</div>
      </div>`;
    }).join('');
    const pendientes = st.ses.equipo.filter(m => etapa(m).mensual && !st.hechas.some(e => e.empleadoId === m.id && e.tipo === TIPO_P() && e.periodo === st.mes && e.estado !== 'devuelta')).length;
    const fbPend = st.hechas.filter(e => st.ses.equipo.some(m => m.id === e.empleadoId) && !retenida(e) && fb(e).exigido && fb(e).estado !== 'realizada');
    return `<div class="ev-card">
      <div class="ev-card-head">
        <h3 class="ev-h3"><i class="fas fa-users"></i> Mi equipo</h3>
        <select data-ev="mes" class="ev-select">${periodosDisponibles().map(m => `<option value="${m}" ${m === st.mes ? 'selected' : ''}>${etiquetaPeriodo(m)}</option>`).join('')}</select>
      </div>
      <p class="ev-muted ev-mb">${pendientes ? `${pendientes} evaluación(es) ${trimestral() ? 'trimestral(es)' : 'mensual(es)'} pendiente(s) para ${etiquetaPeriodo(st.mes)}.` : `Equipo al día para ${etiquetaPeriodo(st.mes)}.`}
        ${limiteEvaluar(st.mes) ? `<strong>Plazo: ${hoyLocal() > limiteEvaluar(st.mes) ? 'venció el' : 'hasta el'} ${fechaCorta(limiteEvaluar(st.mes))}.</strong>` : ''}
        Califica en los últimos días del ${textoPeriodo()} y conversa el resultado la semana siguiente.</p>
      ${fbPend.length ? `<div class="ev-aviso ev-aviso-fb"><i class="fas fa-comments"></i> <span><strong>${fbPend.length} feedback obligatorio(s) por realizar:</strong> ${fbPend.map(e => `<button class="ev-link" data-ev="ver" data-id="${e.id}">${esc(e.empleadoNombre || e.empleadoId)} (${esc(etiquetaCorta(e.periodo))}, ${fb(e).vencido ? 'vencido el' : 'hasta el'} ${fechaCorta(fb(e).vence)})</button>`).join(' · ')}</span></div>` : ''}
      ${filas}
      <p class="ev-muted ev-small">¿Falta alguien? Pide a Psicología Organizacional que lo asigne y <button class="ev-link" data-ev="salir">vuelve a ingresar tu contraseña</button>.</p>
    </div>`;
  }

  function miasHtml(st) {
    const lista = st.mias.map(e => `
      <button class="ev-mia ${e.estado === 'enviada' ? 'ev-mia-nueva' : ''}" data-ev="ver" data-id="${e.id}">
        <div><strong>${esc(etiquetaPeriodo(e.periodo))}</strong><span class="ev-muted">Evaluó ${esc(e.evaluadorNombre || e.evaluadorId)}</span></div>
        <div class="ev-mia-der">${chipNivel(e)}${e.estado === 'enviada' ? (e.correccionHasta ? chipEstado(e) : '<span class="ev-chip ev-chip-env">Nueva</span>') : ''}${chipFeedback(e)}<i class="fas fa-chevron-right"></i></div>
      </button>`).join('');
    if (!esEvaluado(st.emp) && !st.mias.length) return '';
    // Reuniones agendadas para conversar resultados (próximas)
    const proximas = st.mias.filter(e => e.reunion && e.reunion.estado === 'agendada' && normFecha(e.reunion.fecha) >= hoyLocal())
      .sort((a, b) => `${normFecha(a.reunion.fecha)} ${a.reunion.hora}`.localeCompare(`${normFecha(b.reunion.fecha)} ${b.reunion.hora}`));
    const reuniones = proximas.length ? `<div class="ev-card ev-reu-card"><h3 class="ev-h3"><i class="fas fa-calendar-check"></i> Reuniones agendadas</h3>
      ${proximas.map(e => `<button class="ev-mia" data-ev="ver" data-id="${e.id}">
        <div><strong>${esc(fechaLarga(e.reunion.fecha))} · ${esc(e.reunion.hora || '')}</strong><span class="ev-muted">${esc(e.reunion.lugar || '')} · Evaluación de ${esc(etiquetaPeriodo(e.periodo))} con ${esc(e.evaluadorNombre || e.evaluadorId)}</span></div>
        <div class="ev-mia-der"><i class="fas fa-chevron-right"></i></div></button>`).join('')}</div>` : '';
    return reuniones + `<div class="ev-card">
      <div class="ev-card-head"><h3 class="ev-h3"><i class="fas fa-chart-line"></i> Mis evaluaciones</h3>
        ${st.mias.length ? `<button class="ev-btn ev-btn-sm" data-ev="persona" data-emp="${esc(st.emp.id)}"><i class="fas fa-chart-area"></i> Mi evolución</button>` : ''}</div>
      ${lista || '<p class="ev-muted">Todavía no tienes evaluaciones. Cuando tu jefe inmediato te evalúe, verás aquí tu resultado, sus comentarios y los compromisos acordados.</p>'}
    </div>`;
  }

  function buscarEval(st, id) {
    id = Number(id);
    return st.mias.find(e => e.id === id) || st.hechas.find(e => e.id === id) || (st.todas || []).find(e => e.id === id);
  }

  function vistaDetalle(st) {
    const e = st.sel;
    const soyEvaluado = String(e.empleadoId) === String(st.emp.id);
    const soyEvaluador = st.ses.equipo.some(m => m.id === e.empleadoId);
    let acciones = '', aviso = '';
    // Antes de ver su resultado, el colaborador lee y acepta el mensaje; recién ahí queda recibida
    if (soyEvaluado && e.estado === 'enviada' && !e.correccionHasta && !retenida(e)) {
      return `<div class="ev-topbar"><button class="ev-back" data-ev="volver"><i class="fas fa-arrow-left"></i> Volver</button></div>
        <div class="ev-card ev-acepta">
          <h3 class="ev-h3"><i class="fas fa-clipboard-check"></i> Antes de ver tu evaluación</h3>
          <p>Tu evaluación de desempeño es <strong>confidencial</strong> y su propósito es tu desarrollo profesional. Al continuar:</p>
          <ul>
            <li>Recibes tu resultado, los comentarios de tu evaluador y los compromisos acordados.</li>
            <li>Te comprometes a mantener la confidencialidad de la información que veas.</li>
            <li>Puedes solicitar una reunión de feedback con tu evaluador y dejar tu comentario sobre el resultado.</li>
          </ul>
          <p class="ev-muted ev-small">Tu aceptación queda registrada con fecha y hora. Aceptar no significa estar de acuerdo con el resultado.</p>
          <div class="ev-actions ev-mt"><button class="ev-btn ev-btn-primary" data-ev="aceptar-eval" data-id="${e.id}"><i class="fas fa-check"></i> Acepto y ver mi evaluación</button></div>
        </div>`;
    }
    if (soyEvaluado) {
      aviso = e.estado === 'confirmada'
        ? `<div class="ev-aviso ev-aviso-recibida"><i class="fas fa-check-circle"></i> <span><strong>Evaluación recibida el ${fechaDeHora(e.confirmadaEn)}.</strong> Quedó registrada al aceptarla: no necesitas confirmarla.</span></div>`
        : (e.correccionHasta ? `<div class="ev-aviso"><i class="fas fa-pen"></i> Tu evaluador puede corregir esta evaluación hasta el ${fechaCorta(e.correccionHasta)}.</div>` : '');
      if (!e.comentarioColaborador && e.estado === 'confirmada') {
        acciones = `<div class="ev-card"><h4 class="ev-h4">Tu comentario (opcional)</h4>
        <textarea data-ev="comentario" maxlength="${MAX_TXT}" rows="3" placeholder="Qué opinas de tu resultado"></textarea>
        <div class="ev-actions ev-mt"><button class="ev-btn" data-ev="comentar" data-id="${e.id}"><i class="fas fa-paper-plane"></i> Enviar comentario</button></div></div>`;
      }
    } else if (soyEvaluador && (e.estado === 'enviada' || retenida(e))) {
      const pl = e.tipo !== 'DIA75' ? plazoEvaluar(st.ses, e.empleadoId, e.periodo) : { bloqueado: false };
      acciones = pl.bloqueado
        ? `<p class="ev-muted ev-small"><i class="fas fa-lock"></i> El plazo para corregir esta evaluación venció el ${fechaCorta(pl.lim)}.</p>`
        : `<div class="ev-actions"><button class="ev-btn ${e.estado === 'devuelta' ? 'ev-btn-primary' : ''}" data-ev="evaluar" data-tipo="${e.tipo}" data-emp="${esc(e.empleadoId)}" data-periodo="${esc(e.periodo)}"><i class="fas fa-pen"></i> Corregir evaluación</button></div>`;
    }
    if (!soyEvaluado && retenida(e)) aviso = sesgoHtml(st, e, soyEvaluador);
    if (!retenida(e)) acciones = reunionHtml(st, e, soyEvaluado, soyEvaluador || String(e.evaluadorId) === String(st.ses.empleadoId)) + acciones;
    if (st.ses.master && e.estado === 'confirmada') {
      acciones += `<div class="ev-actions ev-reabrir"><span class="ev-muted ev-small"><i class="fas fa-user-shield"></i> Administrador · permitir que el evaluador la corrija</span>
        <label class="ev-small">por <input type="number" min="1" max="60" value="3" data-ev="reabrir-dias" class="ev-select ev-select-sm ev-num-corto"> días</label>
        <button class="ev-btn ev-btn-sm" data-ev="reabrir-corregir" data-id="${e.id}"><i class="fas fa-unlock"></i> Reabrir</button></div>`;
    }
    acciones += eliminarHtml(st, e);
    const historial = (st.historialDe ? st.historialDe(e) : '');
    return `<div class="ev-topbar"><button class="ev-back" data-ev="volver"><i class="fas fa-arrow-left"></i> Volver</button></div>
      ${detalleHtml(e, { acciones, historial, aviso, vista: soyEvaluado ? 'evaluado' : 'evaluador' })}`;
  }

  // ---------------------------------------------------------------- revisión por sesgo (TTHH / Sup. Admin)
  function sesgoHtml(st, e, soyEvaluador) {
    const s = e.sesgo || {};
    const tipo = s.tipo === 'minimo' ? 'todas en la calificación más baja' : 'todas en la calificación más alta';
    const hecha = soyEvaluador || String(e.evaluadorId) === String(st.ses.empleadoId);
    if (e.estado === 'devuelta') {
      return `<div class="ev-card ev-sesgo"><h4 class="ev-h4"><i class="fas fa-undo"></i> Devuelta por TTHH</h4>
        <p><strong>Qué revisar:</strong> ${esc(s.motivo || '')}</p>
        <p class="ev-muted ev-small">${hecha ? 'Corrígela y vuelve a enviarla.' : 'El evaluador debe corregirla y volver a enviarla.'} El colaborador todavía no la ve.</p></div>`;
    }
    const revisa = st.ses.rrhh && !hecha;
    return `<div class="ev-card ev-sesgo"><h4 class="ev-h4"><i class="fas fa-balance-scale"></i> ${hecha ? MSG_SESGO : 'Posible sesgo: revisión de TTHH'}</h4>
      <p>Las ${(e.calificaciones || []).length} calificaciones están ${tipo}. El colaborador no la verá hasta que TTHH la apruebe.</p>
      ${revisa ? `<textarea data-ev="sesgo-motivo" maxlength="300" rows="2" placeholder="Qué debe revisar el evaluador (obligatorio para devolverla)"></textarea>
        <div class="ev-actions ev-mt"><button class="ev-btn" data-ev="sesgo-devolver" data-id="${e.id}"><i class="fas fa-undo"></i> Devolver al evaluador</button>
        <button class="ev-btn ev-btn-primary" data-ev="sesgo-aprobar" data-id="${e.id}"><i class="fas fa-check"></i> Aprobar y enviar</button></div>` : ''}</div>`;
  }

  async function revisarSesgo(st, id, accion, boton) {
    const ta = st.cont.querySelector('[data-ev="sesgo-motivo"]');
    const motivo = ta ? ta.value.trim() : '';
    if (accion === 'devolver' && !textoValido(motivo)) { toast('Explica al evaluador qué debe revisar (al menos 3 palabras).', 'warning'); if (ta) ta.focus(); return; }
    const txt = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    try {
      const res = await rpc(st.ses, 'eval_sesgo', { id, accion, motivo });
      if (!res.ok) throw new Error(res.error);
      reemplazarEval(st, res.evaluacion);
      toast(accion === 'aprobar' ? 'Evaluación aprobada y enviada al colaborador' : 'Evaluación devuelta al evaluador', 'success');
      pintar(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false; boton.innerHTML = txt;
    }
  }

  // ---------------------------------------------------------------- reunión de feedback
  // El colaborador la pide o el evaluador la agenda; el evaluador la marca realizada con los compromisos
  // (obligatorios si el resultado requiere intervención). Obligatoria con menos de 70 % o en el cierre de trimestre.
  function reunionHtml(st, e, soyEvaluado, soyEvaluador) {
    const r = e.reunion || {}, f = fb(e);
    const agendada = r.estado === 'agendada', realizada = f.estado === 'realizada';
    const datos = agendada ? `<div class="ev-reu-datos">
        <div><i class="far fa-calendar"></i> ${esc(fechaLarga(r.fecha))}</div>
        <div><i class="far fa-clock"></i> ${esc(r.hora || '')}</div>
        <div><i class="fas fa-map-marker-alt"></i> ${esc(r.lugar || '')}</div>
        ${r.nota ? `<div class="ev-muted ev-small ev-reu-nota">${esc(r.nota)}</div>` : ''}</div>` : '';
    const titulo = agendada ? (normFecha(r.fecha) < hoyLocal() && !realizada ? 'Reunión agendada (por registrar)' : 'Reunión agendada') : '';
    const hecha = realizada ? `<div class="ev-aviso ev-aviso-recibida"><i class="fas fa-comments"></i> <span><strong>Feedback realizado${r.realizadaEn ? ' el ' + fechaCorta(r.realizadaEn) : ''}.</strong>${e.compromisos ? ' Los compromisos están arriba.' : ''}</span></div>` : '';
    const obligatorio = f.exigido && !realizada
      ? `<p class="ev-fb-oblig ${f.vencido ? 'ev-danger' : ''}"><i class="fas fa-exclamation-circle"></i> <span><strong>Feedback obligatorio</strong>${f.motivo === 'trimestre' ? ' por cierre de trimestre' : ': el resultado requiere intervención'}${f.vence ? ` · ${f.vencido ? 'venció el' : 'hasta el'} ${fechaCorta(f.vence)}` : ''}</span></p>` : '';
    if (soyEvaluado) {
      if (agendada) return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-calendar-check"></i> ${titulo} con ${esc(e.evaluadorNombre || 'tu jefe inmediato')}</h4>${datos}</div>${hecha}`;
      if (r.estado === 'solicitada') return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-comments"></i> Reunión solicitada</h4>
        <p class="ev-muted">Pediste conversar este resultado el ${fechaCorta(r.solicitadaEn)}. Tu jefe inmediato la agendará y te llegará un aviso.</p></div>${hecha}`;
      if (realizada) return hecha;
      if (st.reuPedir) return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-comments"></i> Pedir una reunión de feedback</h4>
        <p class="ev-muted">Cuéntale a tu jefe inmediato qué te gustaría conversar sobre el resultado.</p>
        <textarea data-ev="reu-motivo" maxlength="300" rows="3" placeholder="Motivo (opcional)"></textarea>
        <div class="ev-actions ev-mt"><button class="ev-btn" data-ev="reu-cerrar">Cancelar</button>
        <button class="ev-btn ev-btn-primary" data-ev="reu-solicitar" data-id="${e.id}"><i class="fas fa-paper-plane"></i> Enviar solicitud</button></div></div>`;
      const boton = `<div class="ev-actions"><button class="ev-btn ${f.exigido ? 'ev-btn-primary' : ''}" data-ev="reu-pedir"><i class="fas fa-comments"></i> ${f.exigido ? 'Pedir la reunión de feedback' : 'Pedir una reunión de feedback (opcional)'}</button></div>`;
      return obligatorio ? `<div class="ev-card ev-reu-card">${obligatorio}${boton}</div>` : boton;
    }
    if (soyEvaluador) {
      const pide = r.estado === 'solicitada' || (agendada && r.motivo)
        ? `<p class="ev-reu-pide"><i class="fas fa-comments"></i> <span><strong>${esc(e.empleadoNombre || e.empleadoId)} pidió una reunión</strong>${r.motivo ? `: ${esc(r.motivo)}` : ''}${r.solicitadaEn ? ` <span class="ev-muted ev-small">(${fechaCorta(r.solicitadaEn)})</span>` : ''}</span></p>` : '';
      if (st.reuAgendar) {
        return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-calendar-plus"></i> ${agendada ? 'Reprogramar reunión' : 'Agendar reunión'}</h4>${pide}
          <div class="ev-reu-form">
            <label class="ev-campo"><span>Fecha</span><input type="date" data-ev="reu-fecha" min="${hoyLocal()}" value="${esc(normFecha(r.fecha))}"></label>
            <label class="ev-campo"><span>Hora</span><input type="time" data-ev="reu-hora" value="${esc(r.hora || '')}"></label>
            <label class="ev-campo ev-campo-ancho"><span>Lugar o enlace</span><input type="text" data-ev="reu-lugar" maxlength="150" value="${esc(r.lugar || '')}" placeholder="Sala de reuniones, oficina o enlace de videollamada"></label>
            <label class="ev-campo ev-campo-ancho"><span>Nota (opcional)</span><textarea data-ev="reu-nota" maxlength="300" rows="2" placeholder="Qué preparar o revisar">${esc(r.nota || '')}</textarea></label>
          </div>
          <div class="ev-actions"><button class="ev-btn" data-ev="reu-cerrar">Cancelar</button>
          <button class="ev-btn ev-btn-primary" data-ev="reu-agendar" data-id="${e.id}"><i class="fas fa-calendar-check"></i> ${agendada ? 'Guardar cambios' : 'Agendar reunión'}</button></div>
          <p class="ev-muted ev-small">El colaborador recibirá un aviso y verá la reunión en su panel.</p></div>`;
      }
      if (st.reuRealizar) {
        const oblig = requiereIntervencion(e);
        const desde = normFecha(e.fechaAplicacion);
        const fecha = agendada && normFecha(r.fecha) <= hoyLocal() && normFecha(r.fecha) >= desde ? normFecha(r.fecha) : hoyLocal();
        return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-clipboard-check"></i> Registrar feedback realizado</h4>${obligatorio}
          <div class="ev-reu-form">
            <label class="ev-campo"><span>Fecha de la reunión</span><input type="date" data-ev="reu-fecha" min="${desde}" max="${hoyLocal()}" value="${fecha}"></label>
            <label class="ev-campo ev-campo-ancho"><span>Compromisos acordados${oblig ? ' (obligatorio)' : ' (opcional)'}</span><textarea data-ev="reu-compromisos" maxlength="${MAX_TXT}" rows="3" placeholder="Acciones concretas, con responsable y fecha">${esc(e.compromisos || '')}</textarea></label>
          </div>
          <div class="ev-actions"><button class="ev-btn" data-ev="reu-cerrar">Cancelar</button>
          <button class="ev-btn ev-btn-primary" data-ev="reu-realizar" data-id="${e.id}"><i class="fas fa-check"></i> Guardar feedback realizado</button></div>
          <p class="ev-muted ev-small">El colaborador recibirá un aviso con los compromisos en su evaluación.</p></div>`;
      }
      const btnRealizar = (prim) => realizada ? '' : `<button class="ev-btn ${prim ? 'ev-btn-primary' : ''} ev-btn-sm" data-ev="reu-hecha"><i class="fas fa-clipboard-check"></i> Marcar como realizada</button>`;
      if (agendada) return `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-calendar-check"></i> ${titulo}</h4>${obligatorio}${pide}${datos}
        <div class="ev-actions ev-mt"><button class="ev-btn ev-btn-sm" data-ev="reu-abrir"><i class="fas fa-pen"></i> Reprogramar</button>${btnRealizar(true)}</div></div>${hecha}`;
      if (r.estado === 'solicitada' || obligatorio) return `<div class="ev-card ev-reu-card ev-reu-alerta">${obligatorio}${pide}
        <div class="ev-actions"><button class="ev-btn ev-btn-sm ev-btn-primary" data-ev="reu-abrir"><i class="fas fa-calendar-plus"></i> Agendar reunión</button>${btnRealizar(false)}</div></div>${hecha}`;
      if (realizada) return hecha;
      return `<div class="ev-actions"><button class="ev-btn ev-btn-sm" data-ev="reu-abrir"><i class="fas fa-calendar-plus"></i> Agendar reunión de feedback (opcional)</button>${btnRealizar(false)}</div>`;
    }
    return (agendada ? `<div class="ev-card ev-reu-card"><h4 class="ev-h4"><i class="fas fa-calendar-check"></i> ${titulo}</h4>${datos}</div>` : '')
      + (obligatorio ? `<div class="ev-card">${obligatorio}</div>` : '') + hecha;
  }

  function reemplazarEval(st, ev) {
    const sust = arr => (arr || []).map(x => x.id === ev.id ? ev : x);
    st.mias = sust(st.mias); st.hechas = sust(st.hechas);
    if (st.todas) st.todas = sust(st.todas);
    if (st.sel && st.sel.id === ev.id) st.sel = ev;
  }

  async function reunion(st, id, accion, boton) {
    const val = k => { const el = st.cont.querySelector(`[data-ev="${k}"]`); return el ? el.value.trim() : ''; };
    const p = accion === 'solicitar'
      ? { id, accion, motivo: val('reu-motivo') }
      : accion === 'realizar'
        ? { id, accion, fecha: val('reu-fecha'), compromisos: val('reu-compromisos') }
        : { id, accion, fecha: val('reu-fecha'), hora: val('reu-hora'), lugar: val('reu-lugar'), nota: val('reu-nota') };
    if (accion === 'agendar' && (!p.fecha || !p.hora || !p.lugar)) { toast('Completa la fecha, la hora y el lugar.', 'warning'); return; }
    if (accion === 'realizar') {
      if (!p.fecha) { toast('Indica la fecha de la reunión.', 'warning'); return; }
      if (!p.compromisos && requiereIntervencion(buscarEval(st, id))) { toast('Registra los compromisos acordados: son obligatorios con este resultado.', 'warning'); return; }
      if (p.compromisos && !textoValido(p.compromisos)) { toast(`En Compromisos escribe ${AVISO_TEXTO}.`, 'warning'); return; }
    }
    const txt = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
    try {
      const res = await rpc(st.ses, 'eval_reunion', p);
      if (!res.ok) throw new Error(res.error);
      reemplazarEval(st, res.evaluacion);
      st.reuPedir = false; st.reuAgendar = false; st.reuRealizar = false;
      toast({ solicitar: 'Solicitud enviada a tu jefe inmediato', realizar: 'Feedback registrado' }[accion] || 'Reunión agendada: el colaborador recibirá un aviso', 'success');
      pintar(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false; boton.innerHTML = txt;
    }
  }

  // Admin master: permite al evaluador corregir una evaluación ya recibida
  async function reabrirCorregir(st, id, boton) {
    const el = st.cont.querySelector('[data-ev="reabrir-dias"]');
    const dias = Number(el ? el.value : 3) || 3;
    boton.disabled = true;
    try {
      const res = await rpc(st.ses, 'eval_reabrir', { tipo: 'corregir', id, dias });
      if (!res.ok) throw new Error(res.error);
      reemplazarEval(st, res.evaluacion);
      configCargada = 0;
      await cargarConfig(st.ses, true);
      toast(`El evaluador puede corregirla hasta el ${fechaCorta(res.evaluacion.correccionHasta)}`, 'success');
      pintar(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false;
    }
  }

  // ---------------------------------------------------------------- formulario (3 pasos)
  function abrirForm(st, empId, tipo, periodo) {
    const m = st.ses.equipo.find(x => x.id === empId) || { id: empId };
    const per = tipo === 'DIA75' ? 'DIA75' : (periodo || st.mes);
    if (tipo !== 'DIA75') {
      const pl = plazoEvaluar(st.ses, empId, per);
      if (pl.bloqueado) { toast(`El plazo para evaluar ${etiquetaPeriodo(per)} venció el ${fechaCorta(pl.lim)}. Pide al administrador que lo reabra.`, 'warning'); return; }
    }
    const previa = st.hechas.find(e => e.empleadoId === empId && e.tipo === tipo && (tipo === 'DIA75' || e.periodo === per));
    // Si el cuestionario cambió desde la evaluación anterior, se califica de nuevo con el vigente
    const usarPrevia = previa && mismoCuestionario(previa);
    if (previa && !usarPrevia) toast('El cuestionario cambió desde esta evaluación: vuelve a calificar con las preguntas vigentes.', 'warning');
    st.form = {
      emp: m, tipo, periodo: per, paso: 1, configVersion: CFG_VERSION,
      cal: usarPrevia ? previa.calificaciones.map(Number) : Array(ITEMS.length).fill(0),
      obs: usarPrevia ? previa.observaciones.slice() : Array(ITEMS.length).fill(''),
      abiertas: new Set(),
      fortalezas: previa ? previa.fortalezas || '' : '',
      mejoras: previa ? previa.mejoras || '' : '',
      compromisos: previa ? previa.compromisos || '' : '',
      proxima: previa ? normFecha(previa.proximaEvaluacion) : (tipo !== 'DIA75' ? finDeMesSiguiente() : ''),
      error: '', enviando: false
    };
    st.vista = 'form';
    pintar(st);
    arriba(st);
  }

  // Observaciones que faltan (notas que la exigen) o que no sirven (menos de 3 palabras, «no aplica»)
  function faltantesObs(f) {
    const out = [];
    f.cal.forEach((v, i) => { if (OBLIG.includes(v) && !String(f.obs[i] || '').trim()) out.push(i + 1); });
    return out;
  }
  const invalidasObs = f => f.obs.map((o, i) => (String(o || '').trim() && !textoValido(o) ? i + 1 : 0)).filter(Boolean);
  const CAMPOS_TXT = { fortalezas: 'Fortalezas observadas', mejoras: 'Oportunidades de mejora', compromisos: 'Compromisos acordados' };

  function formHtml(st) {
    const f = st.form, m = f.emp, r = calcular(f.cal);
    const pasos = ['Evaluación', 'Comentarios', 'Revisión'].map((t, i) =>
      `<div class="ev-paso ${f.paso === i + 1 ? 'ev-paso-on' : ''} ${f.paso > i + 1 ? 'ev-paso-ok' : ''}"><span>${f.paso > i + 1 ? '<i class="fas fa-check"></i>' : i + 1}</span>${t}</div>`).join('<div class="ev-paso-linea"></div>');
    const periodoCtl = f.tipo === 'DIA75'
      ? `<strong>Día 75 desde el ingreso</strong>`
      : `<select data-ev="form-mes" class="ev-select ev-select-sm">${periodosDisponibles().map(x => `<option value="${x}" ${x === f.periodo ? 'selected' : ''}>${etiquetaPeriodo(x)}</option>`).join('')}</select>
         ${limiteEvaluar(f.periodo) ? `<small class="ev-muted">Plazo: hasta el ${fechaCorta(limiteEvaluar(f.periodo))}</small>` : ''}`;
    let cuerpo = '';
    if (f.paso === 1) {
      let dimActual = '';
      cuerpo = `<div class="ev-card ev-escala"><h4 class="ev-h4">Escala de valoración</h4>${ESCALA.slice().reverse().map(e => `<div class="ev-escala-fila"><span class="${claseNota(e.v)}">${e.v}</span><div><strong>${esc(e.t)}.</strong> <span class="ev-muted">${esc(e.d)}</span></div></div>`).join('')}
        <p class="ev-muted ev-small">Evalúa solo lo observado durante el período y frente a lo esperado para el cargo; no compares con otras personas.${OBLIG.length ? ` Las calificaciones ${OBLIG.join(', ').replace(/, (\d+)$/, ' y $1')} requieren una observación con un hecho concreto.` : ''}</p>
        <p class="ev-recuerda"><i class="fas fa-info-circle"></i> Recuerda que la justificación de la calificación no admite «no aplica»: escribe al menos 3 palabras.</p></div>`;
      cuerpo += ITEMS.map((it, i) => {
        let cab = '';
        if (it.dim !== dimActual) {
          dimActual = it.dim;
          const d = DIMENSIONES.find(x => x.k === it.dim);
          const peso = ITEMS.filter(x => x.dim === it.dim).reduce((s, x) => s + x.peso, 0);
          cab = `<div class="ev-dim-cab">${esc(d.t)} <span>${peso}%</span></div>`;
        }
        const v = f.cal[i];
        const requiere = OBLIG.includes(v);
        const abierta = requiere || f.abiertas.has(i) || String(f.obs[i] || '').trim();
        const txtObs = String(f.obs[i] || '').trim();
        const falta = f.error && ((requiere && !txtObs) || (txtObs && !textoValido(txtObs)));
        return `${cab}<div class="ev-item ${v ? 'ev-item-ok' : ''}" id="ev-item-${i}">
          <div class="ev-item-head"><span class="ev-item-n">${i + 1}</span><div><strong>${esc(it.c)}</strong><p>${esc(f.tipo === 'DIA75' && it.d75 ? it.d75 : it.m)}</p>${it.a ? `<p class="ev-alcance"><strong>Qué evaluar:</strong> ${esc(it.a)}</p>` : ''}</div><span class="ev-peso">${it.peso}%</span></div>
          <div class="ev-opciones" role="radiogroup" aria-label="${esc(it.c)}">${ESCALA.map(e => `
            <button type="button" role="radio" aria-checked="${v === e.v}" class="ev-op ${claseNota(e.v)} ${v === e.v ? 'ev-op-on' : ''}" data-ev="cal" data-i="${i}" data-v="${e.v}" aria-label="${e.v}: ${esc(e.t)}" title="${esc(e.t)}. ${esc(e.d)}"><b>${e.v}</b></button>`).join('')}
          </div>
          ${abierta
            ? `<textarea class="ev-obs ${falta ? 'ev-obs-falta' : ''}" data-ev="obs" data-i="${i}" maxlength="${MAX_OBS}" rows="2" placeholder="${requiere ? 'Obligatorio: ¿qué pasó y cuándo? (mínimo 3 palabras)' : 'Observación (opcional, mínimo 3 palabras)'}">${esc(f.obs[i] || '')}</textarea>`
            : `<button type="button" class="ev-link ev-small" data-ev="abrir-obs" data-i="${i}"><i class="fas fa-plus"></i> Agregar observación</button>`}
        </div>`;
      }).join('');
      if (haySesgo(f.cal)) cuerpo += `<div class="ev-card ev-sesgo"><i class="fas fa-balance-scale"></i> <strong>${MSG_SESGO}</strong> Revisa tus calificaciones: si las mantienes, TTHH la revisará antes de que la vea el colaborador.</div>`;
    } else if (f.paso === 2) {
      const campo = (k, t, ph) => `<label class="ev-campo"><span>${t}</span><textarea class="${f.error && String(f[k] || '').trim() && !textoValido(f[k]) ? 'ev-obs-falta' : ''}" data-ev="txt" data-k="${k}" maxlength="${MAX_TXT}" rows="3" placeholder="${ph}">${esc(f[k])}</textarea></label>`;
      cuerpo = `<div class="ev-card">
        <h4 class="ev-h4">Retroalimentación y compromisos</h4>
        <p class="ev-muted ev-small">Lo que escribas necesita al menos 3 palabras y no admite «no aplica».${requiereIntervencion(r) ? ' Con este resultado los compromisos son obligatorios: podrás registrarlos al marcar la reunión de feedback como realizada.' : ''}</p>
        ${campo('fortalezas', 'Fortalezas observadas', 'Lo que hizo especialmente bien en el período')}
        ${campo('mejoras', 'Oportunidades de mejora', 'Comportamientos a reforzar')}
        ${campo('compromisos', `Compromisos acordados para el próximo ${textoPeriodo()}`, 'Acciones concretas, vinculadas a sus KPIs cuando aplique')}
        <label class="ev-campo"><span>Fecha de la próxima evaluación</span><input type="date" data-ev="proxima" value="${esc(f.proxima)}" min="${hoyLocal()}"></label>
      </div>`;
    } else {
      const sesgo = haySesgo(f.cal);
      const exige = requiereIntervencion(r) || (f.tipo !== 'DIA75' && esCierreTrimestre(f.periodo));
      const dias = Number((CFG.plazos || {}).feedbackDias) || 7;
      cuerpo = `<div class="ev-card"><h4 class="ev-h4">Resultado</h4>${resumenHtml(Object.assign({ periodo: f.tipo === 'DIA75' ? '' : f.periodo }, r))}</div>
        ${sesgo ? `<div class="ev-card ev-sesgo"><h4 class="ev-h4"><i class="fas fa-balance-scale"></i> ${MSG_SESGO}</h4><p>Todas las calificaciones están en el mismo extremo. Al enviarla quedará en revisión: ${esc(m.nombre || 'el colaborador')} no la verá hasta que TTHH la apruebe o te la devuelva.</p></div>` : ''}
        <div class="ev-card ev-muted ev-small">${sesgo ? '' : `Al enviar, ${esc(m.nombre || 'el colaborador')} verá el resultado en su app; queda recibida cuando la abra y hasta entonces puedes corregirla. `}${exige ? `<strong>El feedback es obligatorio:</strong> tienes ${dias} días para realizarlo (15–20 minutos) y marcarlo como realizado.` : 'El feedback de este período es opcional.'}</div>`;
    }
    const pie = f.paso === 1
      ? `<span class="ev-progreso"><b>${r.respondidos}</b> de ${ITEMS.length}</span><button class="ev-btn ev-btn-primary" data-ev="paso" data-p="2">Siguiente <i class="fas fa-chevron-right"></i></button>`
      : f.paso === 2
        ? `<button class="ev-btn" data-ev="paso" data-p="1"><i class="fas fa-chevron-left"></i> Anterior</button><button class="ev-btn ev-btn-primary" data-ev="paso" data-p="3">Siguiente <i class="fas fa-chevron-right"></i></button>`
        : `<button class="ev-btn" data-ev="paso" data-p="2"><i class="fas fa-chevron-left"></i> Anterior</button><button class="ev-btn ev-btn-primary" data-ev="enviar" ${f.enviando ? 'disabled' : ''}>${f.enviando ? '<i class="fas fa-spinner fa-spin"></i> Enviando…' : haySesgo(f.cal) ? '<i class="fas fa-user-shield"></i> Enviar a revisión de TTHH' : '<i class="fas fa-paper-plane"></i> Enviar evaluación'}</button>`;
    return `<div class="ev-topbar"><button class="ev-back" data-ev="cancelar"><i class="fas fa-arrow-left"></i> ${f.tipo === 'DIA75' ? 'Seguimiento Día 75' : 'Evaluación de desempeño'}</button></div>
      <div class="ev-info">
        <div><i class="far fa-calendar"></i><span>Período</span>${periodoCtl}</div>
        <div><i class="far fa-user"></i><span>Colaborador/a</span><strong>${esc(m.nombre || m.id)}</strong></div>
        <div><i class="fas fa-briefcase"></i><span>Cargo</span><strong>${esc(m.cargo || '—')}</strong></div>
        <div class="ev-info-obj"><i class="fas fa-bullseye"></i><span>Objetivo</span><strong>Identificar fortalezas y oportunidades para seguir potenciando su desarrollo.</strong></div>
      </div>
      <div class="ev-pasos">${pasos}</div>
      ${f.error ? `<div class="ev-card ev-error-card"><i class="fas fa-exclamation-circle"></i> ${esc(f.error)}</div>` : ''}
      ${cuerpo}
      <div class="ev-pie">${pie}</div>`;
  }

  async function enviarForm(st) {
    const f = st.form;
    f.enviando = true; f.error = '';
    pintar(st);
    try {
      const m = f.emp;
      const res = await rpc(st.ses, 'eval_guardar', {
        empleadoId: m.id, tipo: f.tipo, periodo: f.periodo, empleadoNombre: m.nombre || '', area: m.area || '', cargo: m.cargo || '',
        evaluadorNombre: st.emp.nombre || '', calificaciones: f.cal, observaciones: f.obs.map(o => String(o || '').trim()),
        fortalezas: f.fortalezas, mejoras: f.mejoras, compromisos: f.compromisos, proximaEvaluacion: f.proxima,
        configVersion: f.configVersion || undefined
      });
      if (res && res.configCambio) cargarConfig(st.ses, true);
      if (!res.ok) throw new Error(res.error || 'No se pudo guardar');
      st.hechas = st.hechas.filter(e => e.id !== res.evaluacion.id).concat([res.evaluacion]);
      st.form = null; st.vista = 'inicio';
      toast(res.enRevision ? 'Evaluación enviada a revisión de TTHH' : `Evaluación de ${m.nombre || m.id} enviada`, 'success');
      pintar(st);
    } catch (e) {
      f.enviando = false; f.error = e.message || String(e);
      if (e.sesion) { st.ses = null; st.vista = 'inicio'; st.error = f.error; }
      pintar(st);
    }
  }

  // ---------------------------------------------------------------- eventos
  function manejarClick(st, ev) {
    const b = ev.target.closest('[data-ev]');
    if (!b || !st.cont.contains(b)) return;
    const a = b.dataset.ev;
    const f = st.form;
    if (a === 'cal') {
      const i = Number(b.dataset.i);
      f.cal[i] = Number(b.dataset.v);
      repintarSinSalto(st);
      const ta = st.cont.querySelector(`textarea[data-i="${i}"]`);
      if (ta && OBLIG.includes(f.cal[i]) && !ta.value) ta.focus({ preventScroll: true });
    } else if (a === 'abrir-obs') {
      f.abiertas.add(Number(b.dataset.i));
      repintarSinSalto(st);
      const ta = st.cont.querySelector(`textarea[data-i="${b.dataset.i}"]`); if (ta) ta.focus({ preventScroll: true });
    } else if (a === 'paso') {
      const p = Number(b.dataset.p);
      if (p > f.paso && f.paso === 1) {
        const sin = f.cal.findIndex(v => !v);
        if (sin > -1) { f.error = `Falta calificar el comportamiento ${sin + 1}.`; pintar(st); irA(st, sin); return; }
        const obs = faltantesObs(f);
        if (obs.length) { f.error = `Escribe una observación que sustente la calificación ${obs.length > 1 ? 'de los ítems' : 'del ítem'} ${obs.join(', ')}.`; pintar(st); irA(st, obs[0] - 1); return; }
        const inv = invalidasObs(f);
        if (inv.length) { f.error = `La justificación de${inv.length > 1 ? ' los ítems' : 'l ítem'} ${inv.join(', ')} necesita ${AVISO_TEXTO}.`; pintar(st); irA(st, inv[0] - 1); return; }
      }
      if (p > f.paso && f.paso === 2) {
        const mal = Object.keys(CAMPOS_TXT).find(k => String(f[k] || '').trim() && !textoValido(f[k]));
        if (mal) { f.error = `En «${CAMPOS_TXT[mal]}» escribe ${AVISO_TEXTO}.`; pintar(st); arriba(st); return; }
      }
      f.error = ''; f.paso = p; pintar(st); arriba(st);
    } else if (a === 'enviar') {
      if (!f.enviando) enviarForm(st);
    } else if (a === 'cancelar') {
      if (f && (f.cal.some(Boolean) || f.fortalezas) && !confirm('¿Salir sin enviar? Se perderá lo que calificaste.')) return;
      st.form = null; st.vista = 'inicio'; pintar(st);
    } else if (a === 'evaluar') {
      abrirForm(st, b.dataset.emp, b.dataset.tipo, b.dataset.periodo);
    } else if (a === 'ver') {
      const sel = buscarEval(st, b.dataset.id);
      if (sel) ir(st, 'detalle', { sel });
    } else if (a === 'aceptar-eval') {
      b.disabled = true;
      const sel = buscarEval(st, b.dataset.id);
      marcarRecibida(st, sel).then(() => {
        if (sel && sel.estado === 'enviada' && !sel.correccionHasta) { b.disabled = false; toast('No se pudo registrar tu aceptación. Inténtalo de nuevo.', 'error'); }
      });
    } else if (a === 'persona') {
      ir(st, 'persona', { persona: b.dataset.emp });
    } else if (a === 'volver') {
      volver(st);
    } else if (a === 'eliminar-pedir' || a === 'eliminar-cancelar') {
      st.confirmandoEliminar = a === 'eliminar-pedir';
      repintarSinSalto(st);
      if (st.confirmandoEliminar) { const t = st.cont.querySelector('textarea[data-ev="motivo-eliminar"]'); if (t) t.focus({ preventScroll: true }); }
    } else if (a === 'eliminar-ok') {
      eliminarEval(st, Number(b.dataset.id), b);
    } else if (a === 'comentar') {
      comentar(st, Number(b.dataset.id), b);
    } else if (a === 'reu-pedir' || a === 'reu-abrir' || a === 'reu-hecha' || a === 'reu-cerrar') {
      st.reuPedir = a === 'reu-pedir'; st.reuAgendar = a === 'reu-abrir'; st.reuRealizar = a === 'reu-hecha';
      repintarSinSalto(st);
    } else if (a === 'reu-solicitar' || a === 'reu-agendar' || a === 'reu-realizar') {
      reunion(st, Number(b.dataset.id), a.slice(4), b);
    } else if (a === 'sesgo-aprobar' || a === 'sesgo-devolver') {
      revisarSesgo(st, Number(b.dataset.id), a.slice(6), b);
    } else if (a === 'reabrir-corregir') {
      reabrirCorregir(st, Number(b.dataset.id), b);
    } else if (a === 'recargar') {
      cargar(st);
    } else if (a === 'salir') {
      cerrarSesion(); st.ses = null; st.error = ''; pintar(st);
    } else if (st.onClick) {
      st.onClick(a, b, ev);
    }
  }

  // Contenedor que realmente se desplaza (en la app es .main-content; en el panel, la ventana)
  function scrollPadre(el) {
    for (let p = el && el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  function arriba(st) {
    const sp = scrollPadre(st.cont);
    const top = st.cont.getBoundingClientRect().top - (sp === document.scrollingElement || sp === document.documentElement ? 0 : sp.getBoundingClientRect().top);
    if (top < 0) sp.scrollTop += top - 12;
  }
  function repintarSinSalto(st) {
    const sp = scrollPadre(st.cont);
    const y = sp.scrollTop;
    pintar(st);
    sp.scrollTop = y;
  }

  function irA(st, i) {
    const el = st.cont.querySelector(`#ev-item-${i}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Al abrir su evaluación, el colaborador la deja recibida (sin botón de confirmación)
  async function marcarRecibida(st, e) {
    if (!e || e.estado !== 'enviada' || e.correccionHasta || !st.ses) return;
    if (String(e.empleadoId) !== String(st.ses.empleadoId)) return;
    st.abriendo = st.abriendo || new Set();
    if (st.abriendo.has(e.id)) return;
    st.abriendo.add(e.id);
    try {
      const res = await rpc(st.ses, 'eval_confirmar', { id: e.id });
      if (!res.ok) throw new Error(res.error);
      reemplazarEval(st, res.evaluacion);
      // No repintar si el colaborador ya está escribiendo el motivo de la reunión
      if (st.vista === 'detalle' && st.sel && st.sel.id === e.id && !st.reuPedir) repintarSinSalto(st);
    } catch (err) {
      console.warn('Evaluaciones: no se pudo marcar como recibida', err.message || err);   // se reintenta al volver a abrirla
    } finally { st.abriendo.delete(e.id); }
  }

  async function comentar(st, id, boton) {
    const ta = st.cont.querySelector('textarea[data-ev="comentario"]');
    const comentario = ta ? ta.value.trim() : '';
    if (!textoValido(comentario)) { toast('En tu comentario escribe al menos 3 palabras.', 'warning'); if (ta) ta.focus(); return; }
    const txt = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
    try {
      const res = await rpc(st.ses, 'eval_confirmar', { id, comentario });
      if (!res.ok) throw new Error(res.error);
      reemplazarEval(st, res.evaluacion);
      toast('Comentario enviado', 'success');
      repintarSinSalto(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false; boton.innerHTML = txt;
    }
  }

  async function manejarSubmit(st, ev) {
    const form = ev.target.closest('[data-ev="pin"]');
    if (!form) return;
    ev.preventDefault();
    const inp = form.querySelector('input');
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
      st.ses = await iniciarSesion(st.emp.id, inp.value.trim());
      st.error = '';
      if (st.alIniciar) await st.alIniciar(); else await cargar(st);
    } catch (e) {
      st.error = e.message || String(e);
      pintar(st);
      const nuevo = st.cont.querySelector('[data-ev="pin"] input');
      if (nuevo) nuevo.focus();
    }
  }

  function manejarCambio(st, ev) {
    const el = ev.target;
    const a = el.dataset && el.dataset.ev;
    if (a === 'mes') { st.mes = el.value; pintar(st); }
    else if (a === 'form-mes') {
      const f = st.form;
      f.periodo = el.value;
      const previa = st.hechas.find(e => e.empleadoId === f.emp.id && e.tipo === f.tipo && e.periodo === f.periodo);
      const pl = plazoEvaluar(st.ses, f.emp.id, f.periodo);
      if (pl.bloqueado) toast(`El plazo para evaluar ${etiquetaPeriodo(f.periodo)} venció el ${fechaCorta(pl.lim)}: no se podrá enviar.`, 'warning');
      else if (previa) toast(`${etiquetaPeriodo(f.periodo)} ya tiene una evaluación; al enviar la reemplazarás.`, 'warning');
      repintarSinSalto(st);
    } else if (a === 'proxima') st.form.proxima = el.value;
    else if (/^(reu-|reabrir-)/.test(a || '')) return;
    else if (st.onChange) st.onChange(a, el, ev);
  }

  function manejarInput(st, ev) {
    const el = ev.target;
    const a = el.dataset && el.dataset.ev;
    if (a === 'obs') {
      st.form.obs[Number(el.dataset.i)] = el.value;
      if (el.value.trim()) el.classList.remove('ev-obs-falta');
    } else if (a === 'txt') st.form[el.dataset.k] = el.value;
    else if (st.onInput) st.onInput(a, el, ev);
  }

  // ---------------------------------------------------------------- panel del supervisor
  /**
   * opts: { empleado: {id, nombre}, empleados: () => [...], puedeAsignar: bool,
   *         guardarEmpleado: async (id, datos) => res }
   */
  function montarPanel(cont, opts) {
    cont.innerHTML = `<div class="ev-root ev-panel">
      <div data-ev-bloqueo></div>
      <div class="ev-subtabs" role="tablist">
        <button class="ev-subtab ev-subtab-on" data-sub="resultados"><i class="fas fa-chart-bar"></i> Resultados</button>
        <button class="ev-subtab" data-sub="equipo"><i class="fas fa-users"></i> Mi equipo</button>
        ${opts.puedeAsignar ? '<button class="ev-subtab" data-sub="asignaciones"><i class="fas fa-user-tag"></i> Evaluadores y evaluados</button>' : ''}
        ${opts.esMaster ? '<button class="ev-subtab" data-sub="config"><i class="fas fa-sliders-h"></i> Configuración</button>' : ''}
      </div>
      <div data-subpanel="resultados"></div>
      <div data-subpanel="equipo" hidden></div>
      <div data-subpanel="asignaciones" hidden></div>
      <div data-subpanel="config" hidden></div>
    </div>`;
    montarBarraBloqueo(cont.querySelector('[data-ev-bloqueo]'), opts);
    const sub = k => cont.querySelector(`[data-subpanel="${k}"]`);
    const montados = {};
    const abrir = k => {
      cont.querySelectorAll('.ev-subtab').forEach(b => b.classList.toggle('ev-subtab-on', b.dataset.sub === k));
      cont.querySelectorAll('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== k; });
      if (montados[k]) { refrescarSub(k); return; }
      if (k === 'resultados') montados[k] = montarResultados(sub(k), opts);
      if (k === 'equipo') { montados[k] = montar(sub(k), { empleado: opts.empleado, embebido: true }); montados[k].empleados = opts.empleados; }
      if (k === 'asignaciones') montados[k] = montarAsignaciones(sub(k), opts);
      if (k === 'config') montados[k] = montarConfig(sub(k), opts);
    };
    // Al volver a una pestaña (o al panel) se recargan los datos: las evaluaciones cambian mientras está abierto
    const refrescarSub = k => {
      const m = montados[k];
      if (k === 'asignaciones') return m.refrescar();
      if (k === 'config') {
        if (!m.ses) m.ses = sesionGuardada(opts.empleado.id);
        if (!m.ses) return pintar(m);
        return m.dirty ? pintarConfig(m) : m.alIniciar();   // no perder cambios sin guardar
      }
      if (!m.ses) m.ses = sesionGuardada(opts.empleado.id);   // PIN ingresado en la otra pestaña
      if (!m.ses) return pintar(m);
      if (m.vista === 'form') return;                          // no perder una evaluación a medio llenar
      m.vista = k === 'resultados' ? 'resultados' : 'inicio';
      m.pila = []; m.sel = null; m.persona = null;
      if (k === 'resultados') m.alIniciar(); else cargar(m);
    };
    let actual = 'resultados';
    cont.querySelectorAll('.ev-subtab').forEach(b => b.addEventListener('click', () => { actual = b.dataset.sub; abrir(actual); }));
    abrir('resultados');
    cont._evPanel = {
      refrescar: () => abrir(actual),
      // Desde una notificación: alertas → Resultados (si hay permiso); el resto → Mi equipo
      abrirEnlace: enlace => {
        actual = enlace.vista === 'resultados' ? 'resultados' : 'equipo';
        abrir(actual);
        const m = montados[actual];
        if (!m) return;
        m.enlace = enlace;
        if (m.ses && !m.cargando && actual === 'resultados' && m.vista === 'resultados') aplicarEnlace(m);
      }
    };
  }

  function montarResultados(cont, opts) {
    const st = montar(cont, { empleado: opts.empleado, embebido: true, diferido: true });
    st.todas = [];
    st.empleados = opts.empleados;
    st.rVista = 'dashboard';
    st.filtro = { periodo: periodoPorDefecto(), q: '', unidad: '', area: '', estado: '', nivel: '', interv: '', orden: '' };
    st.alIniciar = async () => {
      if (!st.ses.rrhh && !st.ses.revisor) { st.vista = 'sin-permiso'; return pintarResultados(st, opts); }   // revisor: solo lectura
      await cargarTodas(st, opts);
    };
    // Reemplaza la vista de inicio por el consolidado
    st.pintarInicio = () => pintarResultados(st, opts);
    st.historialDe = e => historialHtml(st, e);
    st.volverA = 'resultados';
    st.onClick = (a, b) => {
      if (a === 'exportar') exportarExcel(st, opts);
      if (a === 'r-actualizar') cargarTodas(st, opts);
      if (a === 'r-vista') { st.rVista = b.dataset.v; pintarResultados(st, opts); }
      // Ordenar por resultado: sin orden → mayor a menor → menor a mayor → sin orden
      if (a === 'r-orden') { st.filtro.orden = { '': 'desc', desc: 'asc', asc: '' }[st.filtro.orden || '']; pintarResultados(st, opts); }
    };
    st.onChange = (a, el) => {
      if (a === 'r-periodo') { st.filtro.periodo = el.value; pintarResultados(st, opts); }
      if (a === 'r-unidad') { st.filtro.unidad = el.value; st.filtro.area = ''; pintarResultados(st, opts); }
      if (a === 'r-area') { st.filtro.area = el.value; pintarResultados(st, opts); }
      if (a === 'r-estado') { st.filtro.estado = el.value; pintarResultados(st, opts); }
      if (a === 'r-interv') { st.filtro.interv = el.value; pintarResultados(st, opts); }
      if (a === 'r-nivel') { st.filtro.nivel = el.value; pintarResultados(st, opts); }
    };
    st.onInput = (a, el) => {
      if (a === 'r-q') {
        st.filtro.q = el.value;
        clearTimeout(st._q);
        st._q = setTimeout(() => { pintarResultados(st, opts); const i = cont.querySelector('[data-ev="r-q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
      }
    };
    if (st.ses) st.alIniciar(); else pintar(st);
    return st;
  }

  async function cargarTodas(st, opts) {
    st.cargando = true; pintar(st);
    try {
      const [r] = await Promise.all([rpc(st.ses, 'eval_listar', { modo: 'todas', desde: mesAnterior(mesPorDefecto(), 12) }), cargarConfig(st.ses)]);
      if (!r.ok) throw new Error(r.error);
      st.todas = r.evaluaciones || [];
      st.error = '';
      if (!['DIA75', 'TODAS'].includes(st.filtro.periodo) && !periodoValido(st.filtro.periodo)) st.filtro.periodo = periodoPorDefecto();
    } catch (e) {
      if (e.sesion) st.ses = null;
      st.error = e.message || String(e);
    }
    st.cargando = false;
    st.vista = 'resultados';
    pintarResultados(st, opts);
    aplicarEnlace(st);
  }

  // Período de la RONDA en que se aplicó una evaluación (pedido 2026-11-10): lo aplicado hasta el día límite
  // (plazos.evaluarDia) del mes siguiente al cierre cuenta para el período anterior, igual que las demás
  // evaluaciones de esa ronda. Ej.: Día 75 del 06/11 → octubre (o el trimestre jul–sep si es trimestral).
  function periodoDeRonda(fecha) {
    const f = normFecha(fecha);
    if (!f) return '';
    const mes = Number(f.slice(5, 7));
    const per = trimestral() ? `${f.slice(0, 4)}-T${Math.ceil(mes / 3)}` : f.slice(0, 7);
    const ant = periodoAnterior(per);
    return ant && f <= limiteEvaluar(ant) ? ant : per;
  }
  const fechaEnPeriodo = (fecha, per) => !!per && periodoDeRonda(fecha) === per;

  // Resultados (pedido 2026-11-10): en cada mes o trimestre aparecen TODOS los EVALUADO activos, una fila por persona,
  // también quienes están en período de prueba (se les marca el día de prueba en que van). Si en ese período tienen
  // su evaluación Día 75, esa es su resultado. 'TODAS' lista cada evaluación existente sin filtrar por período.
  function filasResultados(st, opts, sinArea) {
    const per = st.filtro.periodo;
    registrarAreas(opts.empleados());
    const emps = (opts.empleados() || []).filter(e => String(e.activo || 'SI').toUpperCase() !== 'NO' && !e.esEliminado);
    const porId = new Map(emps.map(e => [String(e.id), e]));
    const evals = per === 'TODAS' ? st.todas.slice()
      : st.todas.filter(e => per === 'DIA75' ? e.tipo === 'DIA75'
        : (e.tipo !== 'DIA75' ? e.periodo === per : fechaEnPeriodo(e.fechaAplicacion || e.creadoEn, per)));
    const filas = new Map();
    // Esperados: todos los EVALUADO activos (en el filtro Día 75, solo quienes están entre los días 60 y 120)
    // Último mes del período ('YYYY-MM'): quien ingresó después no aparece en ese período
    const tri = String(per).match(/^(\d{4})-T([1-4])$/);
    const ultimoMes = tri ? `${tri[1]}-${String(Number(tri[2]) * 3).padStart(2, '0')}` : (/^\d{4}-\d{2}$/.test(per) ? per : null);
    if (per !== 'TODAS') emps.forEach(emp => {
      if (!esEvaluado(emp)) return;
      if (per === 'DIA75' && !etapa(emp).dia75) return;
      const ing = normFecha(emp.fecha_ingreso || emp.fechaIngreso);
      if (ultimoMes && ing && ing.slice(0, 7) > ultimoMes) return;
      filas.set(String(emp.id), { emp, ev: null });
    });
    // Una fila por persona: la Día 75 va primero para que, si hubiera también la del período, gane esta última
    evals.slice().sort((a, b) => (a.tipo === 'DIA75' ? 0 : 1) - (b.tipo === 'DIA75' ? 0 : 1)).forEach(ev => {
      const id = String(ev.empleadoId);
      if (opts.esDeOtroGrupo && !porId.has(id) && opts.esDeOtroGrupo(id)) return;   // evaluaciones del otro grupo (Empresa / Servicios externos)
      const clave = per === 'TODAS' ? 'ev_' + ev.id : id;
      filas.set(clave, { emp: porId.get(id) || { id, nombre: ev.empleadoNombre, area: ev.area, cargo: ev.cargo }, ev });
    });
    const evaluadorNombre = id => { const x = porId.get(String(id || '')); return x ? x.nombre : ''; };
    const unidad = st.filtro && st.filtro.unidad;
    const area = !sinArea && st.filtro && st.filtro.area;
    return Array.from(filas.values()).filter(f => (!unidad || unidadDe(f.emp) === unidad) && (!area || areaDe(f.emp) === area)).map(f => ({
      ...f,
      evaluador: f.ev ? (f.ev.evaluadorNombre || evaluadorNombre(f.ev.evaluadorId)) : evaluadorNombre(f.emp.evaluador_id),
      sinEvaluador: !f.ev && !f.emp.evaluador_id,
      prueba: (() => { const d = etapa(f.emp).dias; return d !== null && d >= 0 && d < 90 ? d : null; })(),
      estado: f.ev ? f.ev.estado
        : (!f.emp.evaluador_id ? 'sin-evaluador'
          : (per !== 'DIA75' && per !== 'TODAS' && !etapa(f.emp).mensual ? 'en-prueba'
            : (per !== 'DIA75' && limiteEvaluar(per) && hoyLocal() > limiteEvaluar(per) && !reabierta(f.emp.id, per) ? 'vencida' : 'pendiente')))
    })).sort((a, b) => String(a.emp.nombre || '').localeCompare(String(b.emp.nombre || ''), 'es'));
  }

  function pintarResultados(st, opts) {
    const c = st.cont;
    if (!st.ses) return pintar(st);
    if (st.cargando) return pintar(st);
    if (st.vista === 'detalle' || st.vista === 'persona') return pintar(st);
    if (!st.ses.rrhh && !st.ses.revisor) {
      c.innerHTML = `<div class="ev-root"><div class="ev-card"><h3 class="ev-h3"><i class="fas fa-lock"></i> Resultados consolidados</h3>
        <p class="ev-muted">Solo Psicología Organizacional y los supervisores administradores ven los resultados de toda la empresa. Tus evaluaciones como jefe inmediato están en <strong>Mi equipo</strong>.</p></div></div>`;
      return;
    }
    const todas = filasResultados(st, opts);
    const f = st.filtro;
    const q = f.q.trim().toLowerCase();
    // Áreas de la unidad elegida (o de toda la empresa), sin importar el área ya seleccionada
    const areas = [...new Set(filasResultados(st, opts, true).map(x => areaDe(x.emp)).filter(Boolean))].sort();
    const filas = todas.filter(x =>
      (!f.estado || x.estado === f.estado) &&
      (!f.nivel || (x.ev && nivelEval(x.ev) === f.nivel)) &&
      (!f.interv || (x.ev && !retenida(x.ev) && requiereIntervencion(x.ev) && (f.interv === 'todas' || (f.interv === 'Vencida' ? fb(x.ev).vencido : estadoIntervencion(x.ev) === f.interv)))) &&
      (!q || `${x.emp.nombre} ${x.emp.id} ${unidadDe(x.emp)} ${areaDe(x.emp)} ${x.evaluador}`.toLowerCase().includes(q)));
    // Ordenar por el resultado general; quien aún no tiene resultado va al final
    if (f.orden) filas.sort((a, b) => {
      const pa = a.ev ? Number(a.ev.porcentaje) : null, pb = b.ev ? Number(b.ev.porcentaje) : null;
      if (pa === null || pb === null) return pa === pb ? 0 : (pa === null ? 1 : -1);
      return f.orden === 'asc' ? pa - pb : pb - pa;
    });
    const conEval = todas.filter(x => x.ev && !retenida(x.ev));   // las que revisa TTHH no cuentan
    const interv = conEval.filter(x => requiereIntervencion(x.ev));
    const prom = conEval.length ? conEval.reduce((s, x) => s + Number(x.ev.porcentaje), 0) / conEval.length : null;
    const cuenta = k => todas.filter(x => x.estado === k).length;
    const unidades = [...new Set((opts.empleados() || []).map(unidadDe).filter(Boolean))].sort();
    const promDim = k => conEval.length ? conEval.reduce((s, x) => s + Number((x.ev.dimensiones[k] || {}).porcentaje || 0), 0) / conEval.length : 0;
    const opcionesPer = periodosDisponibles(trimestral() ? 8 : 12).map(m => `<option value="${m}" ${m === f.periodo ? 'selected' : ''}>${etiquetaPeriodo(m)}</option>`).join('')
      + `<option value="DIA75" ${f.periodo === 'DIA75' ? 'selected' : ''}>Seguimiento Día 75 (nuevos ingresos)</option>`
      + `<option value="TODAS" ${f.periodo === 'TODAS' ? 'selected' : ''}>Todas las evaluaciones</option>`;
    const etiquetaEstado = { 'en-prueba': '<span class="ev-chip ev-chip-pend">En período de prueba</span>', 'pendiente': '<span class="ev-chip ev-chip-pend">Pendiente</span>', 'vencida': '<span class="ev-chip ev-chip-warn"><i class="fas fa-lock"></i> Plazo vencido</span>', 'sin-evaluador': '<span class="ev-chip ev-chip-warn">Sin evaluador</span>' };
    const barra = `<div class="ev-card ev-barra-r">
        <select class="ev-select" data-ev="r-periodo">${opcionesPer}</select>
        ${unidades.length ? `<select class="ev-select" data-ev="r-unidad">${opcionesSelect(unidades, f.unidad, 'Todas las unidades')}</select>` : ''}
        ${areas.length ? `<select class="ev-select" data-ev="r-area">${opcionesSelect(areas, f.area, 'Todas las áreas')}</select>` : ''}
        <div class="ev-seg" role="tablist">
          <button class="${st.rVista === 'dashboard' ? 'ev-seg-on' : ''}" data-ev="r-vista" data-v="dashboard"><i class="fas fa-chart-pie"></i> Dashboard</button>
          <button class="${st.rVista === 'tabla' ? 'ev-seg-on' : ''}" data-ev="r-vista" data-v="tabla"><i class="fas fa-list"></i> Colaboradores</button>
        </div>
        <div class="ev-acciones-der">
          <button class="ev-btn ev-btn-sm" data-ev="r-actualizar" title="Volver a cargar desde la base"><i class="fas fa-sync-alt"></i> Actualizar</button>
          <button class="ev-btn ev-btn-sm" data-ev="exportar"><i class="fas fa-file-excel"></i> Exportar Excel</button>
        </div>
      </div>`;
    const errorHtml = st.error ? `<div class="ev-card ev-error-card"><i class="fas fa-exclamation-triangle"></i> ${esc(st.error)}</div>` : '';
    if (st.rVista === 'dashboard') {
      c.innerHTML = `<div class="ev-root">${errorHtml}${barra}${dashboardHtml(st, opts)}${pieMedicion()}</div>`;
      return;
    }
    c.innerHTML = `<div class="ev-root">
      ${errorHtml}${barra}
      <div class="ev-card">
        <div class="ev-kpis">
          <div class="ev-kpi"><span>A evaluar</span><strong>${todas.length}</strong></div>
          <div class="ev-kpi"><span>Enviadas</span><strong>${cuenta('enviada')}</strong></div>
          <div class="ev-kpi"><span>Recibidas</span><strong class="ev-ok">${cuenta('confirmada')}</strong>${cuenta('revision') + cuenta('devuelta') ? `<small class="ev-danger">${cuenta('revision') + cuenta('devuelta')} en revisión por sesgo</small>` : ''}</div>
          <div class="ev-kpi"><span>Pendientes</span><strong class="ev-warn">${cuenta('pendiente')}</strong>${cuenta('vencida') ? `<small>${cuenta('vencida')} con plazo vencido</small>` : ''}</div>
          <div class="ev-kpi"><span>Sin evaluador</span><strong class="ev-danger">${cuenta('sin-evaluador')}</strong></div>
          <div class="ev-kpi"><span>Intervención inmediata</span><strong class="ev-danger">${interv.length}</strong>${interv.length ? `<small>${interv.filter(x => estadoIntervencion(x.ev) !== 'Atendida').length} sin atender</small>` : ''}</div>
          <div class="ev-kpi"><span>Promedio</span><strong class="${prom === null ? '' : clasePct(prom) + ' ev-kpi-nivel'}">${prom === null ? '—' : pct(prom)}</strong></div>
        </div>
        ${conEval.length ? `<div class="ev-dims ev-dims-inline">${DIMENSIONES.map(d => `<div class="ev-dim"><div class="ev-dim-top"><span>${d.t}</span><strong class="ev-tx-k ${clasePct(promDim(d.k))}">${pct(promDim(d.k))}</strong></div><div class="ev-bar"><div class="ev-bar-fill ${claseNivel(nivelDe(promDim(d.k)))}" style="width:${Math.round(promDim(d.k) * 100)}%"></div></div></div>`).join('')}</div>
        <p class="ev-muted ev-small">Promedio por dimensión del período: indica dónde reforzar la capacitación.</p>` : ''}
      </div>
      <div class="ev-card">
        <div class="ev-filtros">
          <input type="search" data-ev="r-q" placeholder="Buscar colaborador o evaluador" value="${esc(f.q)}">
          <select class="ev-select" data-ev="r-nivel" title="Estado del desempeño">
            <option value="">Todo el desempeño</option>
            ${NIVELES.map(n => `<option value="${esc(n.n)}" ${n.n === f.nivel ? 'selected' : ''}>${esc(n.n)}</option>`).join('')}
          </select>
          <select class="ev-select" data-ev="r-interv" title="Intervención inmediata">
            <option value="">Toda intervención</option>
            ${[['todas', 'Con intervención inmediata'], ['Pendiente', 'Intervención pendiente'], ['Agendada', 'Intervención agendada'], ['Atendida', 'Intervención atendida'], ['Vencida', 'Plazo de feedback vencido']].map(([v, tx]) => `<option value="${v}" ${v === f.interv ? 'selected' : ''}>${tx}</option>`).join('')}
          </select>
          <select class="ev-select" data-ev="r-estado" title="Estado de la evaluación">
            <option value="">Toda evaluación</option>
            ${[['pendiente', 'Pendientes'], ['en-prueba', 'En período de prueba'], ['vencida', 'Plazo vencido'], ['enviada', 'Enviadas'], ['confirmada', 'Recibidas'], ['revision', 'En revisión TTHH'], ['devuelta', 'Devueltas por TTHH'], ['sin-evaluador', 'Sin evaluador']].map(([v, t]) => `<option value="${v}" ${v === f.estado ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="ev-tabla-wrap"><table class="ev-tabla">
          <thead><tr><th>Colaborador</th><th>Evaluador</th><th>Estado</th><th class="ev-th-orden" data-ev="r-orden" title="Ordenar por resultado" style="cursor:pointer;user-select:none">Resultado <i class="fas ${f.orden === 'desc' ? 'fa-sort-amount-down' : f.orden === 'asc' ? 'fa-sort-amount-up' : 'fa-sort'}"></i></th><th>Desempeño</th><th>Intervención<br>inmediata</th>${DIMENSIONES.map(d => `<th class="ev-num">${d.corto}</th>`).join('')}</tr></thead>
          <tbody>${filas.map(x => `<tr ${retenida(x.ev) ? `data-ev="ver" data-id="${x.ev.id}" class="ev-fila-click" title="Ver evaluación"` : evalsDe(st, x.emp.id).length ? `data-ev="persona" data-emp="${esc(x.emp.id)}" class="ev-fila-click" title="Ver dashboard del colaborador"` : ''}>
            <td><strong>${esc(x.emp.nombre || x.emp.id)}</strong>${x.prueba !== null ? ` <span class="ev-chip ev-chip-warn" title="Ingresó el ${esc(fechaCorta(x.emp.fecha_ingreso || x.emp.fechaIngreso))}">Prueba · día ${x.prueba}</span>` : ''}${x.ev && x.ev.tipo === 'DIA75' && f.periodo !== 'DIA75' ? ' <span class="ev-chip ev-chip-pend">Día 75</span>' : ''}${x.ev && f.periodo === 'TODAS' && x.ev.tipo !== 'DIA75' ? ` <span class="ev-chip ev-chip-pend">${esc(etiquetaPeriodo(x.ev.periodo))}</span>` : ''}<div class="ev-muted ev-small">${esc(subtituloEmp(x.emp))}</div></td>
            <td>${esc(x.evaluador || '—')}</td>
            <td>${x.ev ? chipEstado(x.ev) : etiquetaEstado[x.estado]}</td>
            <td><strong class="ev-tx-k ${x.ev ? clasePct(x.ev.porcentaje) : ''}">${x.ev ? pct(x.ev.porcentaje) : '<span class="ev-muted">—</span>'}</strong></td>
            <td>${chipDesempeno(x.ev)}</td>
            <td>${x.ev && !retenida(x.ev) ? chipIntervencion(x.ev) : '<span class="ev-muted">—</span>'}</td>
            ${DIMENSIONES.map(d => { const pd = x.ev ? (x.ev.dimensiones[d.k] || {}).porcentaje : null; return `<td class="ev-num">${x.ev ? `<strong class="ev-tx-k ${clasePct(pd)}">${pct(pd)}</strong>` : '—'}</td>`; }).join('')}
          </tr>`).join('') || `<tr><td colspan="${6 + DIMENSIONES.length}" class="ev-vacio">Sin colaboradores para este filtro.</td></tr>`}</tbody>
        </table></div>
        <p class="ev-muted ev-small">${filas.length} de ${todas.length}. Haz clic en un colaborador para ver su dashboard. "A evaluar" incluye a quienes tienen status EVALUADO y ${f.periodo === 'TODAS' ? 'tienen alguna evaluación registrada (todas, de cualquier período)' : f.periodo === 'DIA75' ? 'están entre los días 60 y 120 desde su ingreso' : 'están activos, incluidos quienes están en período de prueba (se indica el día en que van; su resultado es la evaluación Día 75 si la tienen en este período)'}.</p>
      </div>
      ${pieMedicion()}
    </div>`;
  }

  function historialHtml(st, e) {
    const lista = (st.todas || []).filter(x => x.empleadoId === e.empleadoId && !retenida(x)).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
    if (lista.length < 2) return '';
    return `<div class="ev-card"><h4 class="ev-h4">Tendencia del colaborador</h4>
      <p class="ev-muted ev-small">No decidas por un solo mes: revisa la evolución de los últimos meses.</p>
      <div class="ev-tendencia">${lista.map(x => `<div class="ev-tend ${x.id === e.id ? 'ev-tend-on' : ''}">
        <div class="ev-tend-bar"><div class="${claseNivel(nivelEval(x))}" style="height:${Math.round(Number(x.porcentaje) * 100)}%"></div></div>
        <strong>${pct(x.porcentaje)}</strong><span>${esc(x.periodo === 'DIA75' ? 'Día 75' : etiquetaPeriodo(x.periodo).slice(0, 3) + ' ' + x.periodo.slice(2, 4))}</span>
      </div>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- dashboards
  const ordenEval = (a, b) => String(a.fechaAplicacion || '').localeCompare(String(b.fechaAplicacion || '')) || String(a.periodo).localeCompare(String(b.periodo));
  const etiquetaCorta = per => per === 'DIA75' ? 'Día 75' : (() => {
    const t = String(per).match(/^(\d{4})-T([1-4])$/);
    if (t) return `T${t[2]} ${t[1].slice(2)}`;
    const m = String(per).match(/^(\d{4})-(\d{2})$/);
    return m ? `${MESES[Number(m[2]) - 1].slice(0, 3)} ${m[1].slice(2)}` : per;
  })();
  const promedio = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const puntos = d => `${d > 0 ? '+' : ''}${Math.round(d * 1000) / 10} pts`;

  // Todas las evaluaciones conocidas de un colaborador (consolidado, equipo o propias), sin duplicar
  function evalsDe(st, empId) {
    const vistos = new Map();
    [].concat(st.todas || [], st.hechas || [], st.mias || []).forEach(e => { if (String(e.empleadoId) === String(empId) && !retenida(e)) vistos.set(e.id, e); });
    return Array.from(vistos.values()).sort(ordenEval);
  }

  // Línea de tendencia en SVG (sin librerías): bandas en el inicio de cada categoría
  function lineaSvg(serie, opciones = {}) {
    if (!serie.length) return '<p class="ev-muted">Sin datos todavía.</p>';
    const W = 640, H = opciones.alto || 190, L = 38, R = 14, T = 14, B = 30;
    const vals = serie.map(p => p.v);
    const min = Math.max(0, Math.min(0.5, Math.floor((Math.min(...vals) - 0.05) * 20) / 20));
    const X0 = L + 26, X1 = W - R - 26;   // margen interno: que etiquetas y puntos no choquen con el eje ni con el borde
    const x = i => serie.length === 1 ? (X0 + X1) / 2 : X0 + i * (X1 - X0) / (serie.length - 1);
    const y = v => T + (1 - (v - min) / (1 - min)) * (H - T - B);
    const bandas = NIVELES.map(n => Number(n.min)).filter(v => v > min && v < 1).map(v =>
      `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ev-svg-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ev-svg-eje" text-anchor="end">${Math.round(v * 100)}%</text>`).join('');
    const ruta = serie.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const marcas = serie.map((p, i) => `<g class="${claseNivel(nivelDe(p.v))}"><circle cx="${x(i)}" cy="${y(p.v)}" r="5" class="ev-svg-punto"><title>${esc(p.t)}: ${pct(p.v)}${p.n ? ` (${p.n})` : ''}</title></circle>
      <text x="${x(i)}" y="${y(p.v) - 10}" class="ev-svg-val" text-anchor="middle">${Math.round(p.v * 100)}</text>
      <text x="${x(i)}" y="${H - 8}" class="ev-svg-eje" text-anchor="middle">${esc(p.t)}</text></g>`).join('');
    return `<svg class="ev-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opciones.titulo || 'Tendencia')}">${bandas}<path d="${ruta}" class="ev-svg-linea"/>${marcas}</svg>`;
  }

  function barraH(etiqueta, v, extra = '') {
    const p = Math.max(0, Math.min(1, Number(v) || 0));
    return `<div class="ev-dim"><div class="ev-dim-top"><span>${etiqueta}</span><strong><span class="ev-tx-k ${clasePct(p)}">${pct(p)}</span>${extra}</strong></div>
      <div class="ev-bar"><div class="ev-bar-fill ${claseNivel(nivelDe(p))}" style="width:${Math.round(p * 100)}%"></div></div></div>`;
  }

  // Dashboard individual
  function personaHtml(st) {
    const id = String(st.persona);
    const evals = evalsDe(st, id);
    const emp = (st.ses.equipo || []).find(m => String(m.id) === id)
      || (st.empleados ? st.empleados().find(e => String(e.id) === id) : null)
      || (String(st.emp.id) === id ? st.emp : null) || {};
    const ult = evals[evals.length - 1];
    const nombre = emp.nombre || (ult && ult.empleadoNombre) || id;
    const cab = `<div class="ev-topbar"><button class="ev-back" data-ev="volver"><i class="fas fa-arrow-left"></i> Volver</button></div>
      <div class="ev-card ev-persona-cab">
        <div class="ev-avatar ev-avatar-lg">${emp.foto_url ? `<img src="${esc(emp.foto_url)}" alt="" onerror="this.remove()">` : ''}<span>${esc(iniciales(nombre))}</span></div>
        <div><div class="ev-eyebrow">Dashboard de desempeño</div><h3>${esc(nombre)}</h3>
        <div class="ev-muted">${esc(emp.cargo || (ult && ult.cargo) || '')}${(emp.area || (ult && ult.area)) ? ' · ' + esc(emp.area || ult.area) : ''}${ult ? ` · Evalúa ${esc(ult.evaluadorNombre || ult.evaluadorId)}` : ''}</div></div>
      </div>`;
    if (!evals.length) return cab + '<div class="ev-card ev-muted">Todavía no hay evaluaciones registradas para este colaborador.</div>';

    const ant = evals[evals.length - 2];
    const prom = promedio(evals.map(e => Number(e.porcentaje)));
    const delta = ant ? Number(ult.porcentaje) - Number(ant.porcentaje) : null;
    // Las competencias se comparan solo entre evaluaciones con el cuestionario vigente
    const evC = evals.filter(mismoCuestionario);
    const ultC = evC[evC.length - 1];
    const promItem = i => promedio(evC.map(e => Number(e.calificaciones[i]) || 0).filter(Boolean));
    const items = ultC ? ITEMS.map((it, i) => ({ i, it, ult: Number(ultC.calificaciones[i]) || 0, prom: promItem(i) || 0 })) : [];
    const debiles = items.slice().sort((a, b) => a.prom - b.prom || a.ult - b.ult).slice(0, 3);
    const fuertes = items.slice().sort((a, b) => b.prom - a.prom || b.ult - a.ult).slice(0, 3);
    const lista = l => l.map(x => `<li><span>${esc(x.it.c)}</span><strong class="${claseNota(x.prom)}">${(Math.round(x.prom * 10) / 10).toString()}</strong></li>`).join('');

    return cab + `
      <div class="ev-kpis">
        <div class="ev-kpi"><span>Última evaluación</span><strong class="${claseNivel(nivelEval(ult))} ev-kpi-nivel">${pct(ult.porcentaje)}</strong><small>${esc(nivelEval(ult))} · ${esc(etiquetaPeriodo(ult.periodo))}</small></div>
        <div class="ev-kpi"><span>Promedio</span><strong>${pct(prom)}</strong><small>${evals.length} evaluación(es)</small></div>
        <div class="ev-kpi"><span>Vs. anterior</span><strong class="${delta === null ? '' : delta >= 0 ? 'ev-ok' : 'ev-danger'}">${delta === null ? '—' : puntos(delta)}</strong><small>${ant ? esc(etiquetaPeriodo(ant.periodo)) : 'Sin evaluación previa'}</small></div>
        <div class="ev-kpi"><span>Estado</span><strong class="ev-kpi-txt">${ult.estado === 'confirmada' ? 'Recibida' : 'Sin abrir'}</strong><small>${ult.proximaEvaluacion ? 'Próxima: ' + fechaCorta(ult.proximaEvaluacion) : ''}</small></div>
      </div>
      <div class="ev-card"><h4 class="ev-h4">Evolución del resultado</h4>${lineaSvg(evals.map(e => ({ t: etiquetaCorta(e.periodo), v: Number(e.porcentaje) })), { titulo: 'Evolución de ' + nombre })}
        <p class="ev-muted ev-small">Líneas guía: ${NIVELES.filter(n => Number(n.min) > 0).slice().reverse().map(n => `${Math.round(Number(n.min) * 100)} % ${esc(n.n)}`).join(' · ')}. Mira la tendencia de varios meses, no un mes aislado.</p></div>
      <div class="ev-grid2">
        <div class="ev-card"><h4 class="ev-h4">Dimensiones · ${esc(etiquetaPeriodo(ult.periodo))}</h4>
          <div class="ev-dims">${DIMENSIONES.map(d => {
            const pd = promedio(evals.map(e => Number((e.dimensiones[d.k] || {}).porcentaje || 0)));
            return barraH(d.t, (ult.dimensiones[d.k] || {}).porcentaje, evals.length > 1 ? ` <span class="ev-muted ev-small">prom. ${pct(pd)}</span>` : '');
          }).join('')}</div></div>
        <div class="ev-card"><h4 class="ev-h4">Fortalezas y aspectos a reforzar</h4>
          ${items.length ? `<div class="ev-fyr"><div><h5><i class="fas fa-arrow-up ev-ok"></i> Más altas</h5><ul>${lista(fuertes)}</ul></div>
          <div><h5><i class="fas fa-arrow-down ev-danger"></i> A reforzar</h5><ul>${lista(debiles)}</ul></div></div>` : '<p class="ev-muted ev-small">Sin evaluaciones con el cuestionario vigente.</p>'}
          ${ult.compromisos ? `<div class="ev-texto ev-mt"><h4>Compromisos vigentes</h4><p>${esc(ult.compromisos)}</p></div>` : ''}
        </div>
      </div>
      ${items.length ? `<div class="ev-card"><h4 class="ev-h4">Las ${ITEMS.length} competencias</h4>
        <div class="ev-tabla-wrap ev-tabla-libre"><table class="ev-tabla">
          <thead><tr><th>Competencia</th><th class="ev-num">Peso</th><th class="ev-num">Última</th><th class="ev-num">Promedio</th><th>Histórico</th></tr></thead>
          <tbody>${items.map(x => `<tr><td>${x.i + 1}. ${esc(x.it.c)}</td><td class="ev-num">${x.it.peso}%</td>
            <td class="ev-num"><span class="ev-cal-pill ${claseNota(x.ult)}">${x.ult || '–'}</span></td>
            <td class="ev-num">${(Math.round(x.prom * 10) / 10).toString()}</td>
            <td><div class="ev-mini">${evC.map(e => { const v = Number(e.calificaciones[x.i]) || 0; return `<span class="${claseNota(v)}" style="height:${Math.round(v / escalaMax() * 100)}%" title="${esc(etiquetaPeriodo(e.periodo))}: ${v}"></span>`; }).join('')}</div></td></tr>`).join('')}</tbody>
        </table></div></div>` : ''}
      <div class="ev-card"><h4 class="ev-h4">Historial</h4>${evals.slice().reverse().map(e => `
        <button class="ev-mia" data-ev="ver" data-id="${e.id}">
          <div><strong>${esc(etiquetaPeriodo(e.periodo))}</strong><span class="ev-muted">Evaluó ${esc(e.evaluadorNombre || e.evaluadorId)} · ${fechaCorta(e.fechaAplicacion)}</span></div>
          <div class="ev-mia-der">${chipNivel(e)}${chipEstado(e)}${chipFeedback(e)}<i class="fas fa-chevron-right"></i></div>
        </button>`).join('')}</div>`;
  }

  // Dashboard general (RR.HH.)
  function dashboardHtml(st, opts) {
    const f = st.filtro;
    const filas = filasResultados(st, opts);
    const conEval = filas.filter(x => x.ev && !retenida(x.ev));
    const enRevision = filas.filter(x => x.ev && retenida(x.ev));
    const sinEvaluar = filas.filter(x => !x.ev);
    const prom = promedio(conEval.map(x => Number(x.ev.porcentaje)));
    const cobertura = filas.length ? conEval.length / filas.length : 0;
    const bajoUmbral = requiereIntervencion;
    const enRiesgo = conEval.filter(x => bajoUmbral(x.ev));
    const sinAtender = enRiesgo.filter(x => estadoIntervencion(x.ev) !== 'Atendida');

    // Tendencia por período (últimos 12 meses u 8 trimestres con datos)
    const meses = periodosDisponibles(trimestral() ? 8 : 12).slice().reverse();
    const serie = meses.map(m => {
      const ev = st.todas.filter(e => e.tipo === TIPO_P() && e.periodo === m && !retenida(e));
      return ev.length ? { t: etiquetaCorta(m), v: promedio(ev.map(e => Number(e.porcentaje))), n: `${ev.length} eval.` } : null;
    }).filter(Boolean);
    let deltaMes = null;
    if (f.periodo !== 'DIA75' && f.periodo !== 'TODAS') {
      const prev = st.todas.filter(e => e.tipo !== 'DIA75' && e.periodo === periodoAnterior(f.periodo) && !retenida(e));
      if (prev.length && prom !== null) deltaMes = prom - promedio(prev.map(e => Number(e.porcentaje)));
    }

    // Distribución por nivel
    const niveles = NIVELES.map(n => n.n);
    const dist = niveles.map(n => ({ n, c: conEval.filter(x => nivelEval(x.ev) === n).length }));
    const distHtml = conEval.length
      ? `<div class="ev-stack">${dist.filter(d => d.c).map(d => `<div class="${claseNivel(d.n)}" style="flex:${d.c}" title="${d.n}: ${d.c}"></div>`).join('')}</div>
         <div class="ev-leyenda">${dist.map(d => `<span><i class="${claseNivel(d.n)}"></i>${d.n} <strong>${d.c}</strong></span>`).join('')}</div>`
      : '<p class="ev-muted">Sin evaluaciones en este período.</p>';

    // Por unidad (o por área si ya se filtró una unidad)
    const porArea = {};
    const agrupar = x => (f.unidad ? areaDe(x.emp) : (unidadDe(x.emp) || areaDe(x.emp))) || x.ev.area || 'Sin área';
    conEval.forEach(x => { const a = agrupar(x); (porArea[a] = porArea[a] || []).push(Number(x.ev.porcentaje)); });
    const areas = Object.entries(porArea).map(([a, v]) => ({ a, p: promedio(v), n: v.length })).sort((x, y) => x.p - y.p);

    // Competencias del período (promedio 1–5)
    const conEvalC = conEval.filter(x => mismoCuestionario(x.ev));
    const compet = ITEMS.map((it, i) => ({ it, i, p: promedio(conEvalC.map(x => Number(x.ev.calificaciones[i]) || 0).filter(Boolean)) || 0 }));
    const bajas = compet.slice().sort((a, b) => a.p - b.p).slice(0, 5);

    // Alertas: nivel bajo o caída de 10 pts o más frente a su evaluación anterior
    const alertas = [];
    conEval.forEach(x => {
      const hist = evalsDe(st, x.emp.id);
      const idx = hist.findIndex(e => e.id === x.ev.id);
      const ant = idx > 0 ? hist[idx - 1] : null;
      const caida = ant ? Number(x.ev.porcentaje) - Number(ant.porcentaje) : 0;
      if (bajoUmbral(x.ev) || caida <= -0.10) {
        alertas.push({ x, motivo: (bajoUmbral(x.ev) ? `Intervención ${fb(x.ev).vencido ? 'vencida' : estadoIntervencion(x.ev).toLowerCase()} · ` : '') + (caida <= -0.10 ? `Bajó ${puntos(caida).replace('-', '')} vs. ${etiquetaPeriodo(ant.periodo)}` : nivelEval(x.ev)) });
      }
    });

    return `
      <div class="ev-kpis">
        <div class="ev-kpi"><span>Cobertura</span><strong>${pct(cobertura)}</strong><small>${conEval.length} de ${filas.length} evaluados</small></div>
        <div class="ev-kpi"><span>Recibidas</span><strong class="ev-ok">${conEval.filter(x => x.ev.estado === 'confirmada').length}</strong><small>${conEval.filter(x => x.ev.estado === 'enviada').length} sin abrir</small></div>
        <div class="ev-kpi"><span>Promedio general</span><strong class="${prom === null ? '' : claseNivel(nivelDe(prom)) + ' ev-kpi-nivel'}">${prom === null ? '—' : pct(prom)}</strong><small>${prom === null ? '' : nivelDe(prom)}</small></div>
        <div class="ev-kpi"><span>Vs. ${trimestral() ? 'trimestre' : 'mes'} anterior</span><strong class="${deltaMes === null ? '' : deltaMes >= 0 ? 'ev-ok' : 'ev-danger'}">${deltaMes === null ? '—' : puntos(deltaMes)}</strong><small>promedio general</small></div>
        <div class="ev-kpi"><span>Intervención inmediata</span><strong class="ev-danger">${enRiesgo.length}</strong><small>${conEval.length ? `${sinAtender.length} sin atender · ${pct(enRiesgo.length / conEval.length)}` : 'sin evaluaciones'}</small></div>
        <div class="ev-kpi"><span>Pendientes</span><strong class="ev-warn">${filas.filter(x => x.estado === 'pendiente').length}</strong><small>${filas.filter(x => x.estado === 'sin-evaluador').length} sin evaluador</small></div>
      </div>
      ${sinEvaluar.length ? `<div class="ev-card"><h4 class="ev-h4"><i class="fas fa-user-clock ev-warn"></i> Sin evaluar · ${esc(etiquetaPeriodo(f.periodo))} (${sinEvaluar.length})</h4>
        <div class="ev-tabla-wrap"><table class="ev-tabla"><thead><tr><th>Colaborador</th><th>Unidad / área</th><th>Evaluador</th><th>Estado</th></tr></thead>
        <tbody>${sinEvaluar.map(x => `<tr><td><strong>${esc(x.emp.nombre || x.emp.id)}</strong> <span class="ev-muted ev-small">${esc(x.emp.id)}</span></td>
          <td>${esc([unidadDe(x.emp), areaDe(x.emp)].filter(Boolean).join(' · ') || '—')}</td>
          <td>${esc(x.evaluador || '—')}</td><td>${{ 'en-prueba': '<span class="ev-chip ev-chip-pend">En período de prueba</span>', 'pendiente': '<span class="ev-chip ev-chip-pend">Pendiente</span>', 'vencida': '<span class="ev-chip ev-chip-warn"><i class="fas fa-lock"></i> Plazo vencido</span>', 'sin-evaluador': '<span class="ev-chip ev-chip-warn">Sin evaluador</span>' }[x.estado] || esc(x.estado)}</td></tr>`).join('')}</tbody></table></div>
        <p class="ev-muted ev-small">El detalle completo y los filtros están en la pestaña Resultados.</p></div>` : ''}
      ${enRevision.length ? `<div class="ev-card ev-sesgo"><h4 class="ev-h4"><i class="fas fa-balance-scale"></i> Evaluaciones con posible sesgo</h4>
        ${enRevision.map(x => `<button class="ev-mia" data-ev="ver" data-id="${x.ev.id}">
          <div><strong>${esc(x.emp.nombre || x.emp.id)}</strong><span class="ev-muted">Evaluó ${esc(x.evaluador || '')} · ${esc(etiquetaPeriodo(x.ev.periodo))}</span></div>
          <div class="ev-mia-der">${chipNivel(x.ev)}${chipEstado(x.ev)}<i class="fas fa-chevron-right"></i></div></button>`).join('')}</div>` : ''}
      <div class="ev-card"><h4 class="ev-h4">Tendencia del promedio general (${trimestral() ? 'trimestral' : 'mensual'})</h4>${lineaSvg(serie, { titulo: 'Promedio general por período' })}</div>
      <div class="ev-grid2">
        <div class="ev-card"><h4 class="ev-h4">Distribución por nivel · ${esc(etiquetaPeriodo(f.periodo))}</h4>${distHtml}</div>
        <div class="ev-card"><h4 class="ev-h4">Promedio por dimensión</h4>${conEval.length ? `<div class="ev-dims">${DIMENSIONES.map(d => barraH(d.t, promedio(conEval.map(x => Number((x.ev.dimensiones[d.k] || {}).porcentaje || 0))))).join('')}</div>` : '<p class="ev-muted">Sin datos.</p>'}</div>
        <div class="ev-card"><h4 class="ev-h4">Promedio por ${f.unidad ? 'área' : 'unidad'}</h4>${areas.length ? `<div class="ev-dims">${areas.map(a => barraH(`${esc(a.a)} <span class="ev-muted ev-small">(${a.n})</span>`, a.p)).join('')}</div>` : '<p class="ev-muted">Sin datos.</p>'}</div>
        <div class="ev-card"><h4 class="ev-h4">Competencias más bajas</h4>${conEvalC.length ? `<ol class="ev-ranking">${bajas.map(b => `<li><span>${esc(b.it.c)}</span><strong class="${claseNota(b.p)}">${(Math.round(b.p * 10) / 10).toString()}</strong></li>`).join('')}</ol>
          <p class="ev-muted ev-small">Promedio de 1 a 5 del período: dónde enfocar la capacitación.</p>` : '<p class="ev-muted">Sin datos.</p>'}</div>
      </div>
      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-bell ev-warn"></i> Alertas</h4>
        ${alertas.length ? alertas.map(a => `<button class="ev-mia" data-ev="persona" data-emp="${esc(a.x.emp.id)}">
          <div><strong>${esc(a.x.emp.nombre || a.x.emp.id)}</strong><span class="ev-muted">${esc(a.x.emp.area || '')} · ${esc(a.motivo)}</span></div>
          <div class="ev-mia-der">${chipNivel(a.x.ev)}<i class="fas fa-chevron-right"></i></div></button>`).join('')
          : `<p class="ev-muted">Sin alertas: nadie requiere intervención inmediata ni tiene caídas de 10 puntos o más.</p>`}
      </div>`;
  }

  // ---------------------------------------------------------------- eliminar
  // Solo el admin master elimina evaluaciones (el servidor también lo exige)
  function puedeEliminar(st, e) {
    return !!(st.ses && st.ses.master && e);
  }

  function eliminarHtml(st, e) {
    if (!puedeEliminar(st, e)) return '';
    if (!st.confirmandoEliminar) {
      return `<div class="ev-actions"><button class="ev-btn ev-btn-peligro" data-ev="eliminar-pedir"><i class="fas fa-trash-alt"></i> Eliminar evaluación</button></div>`;
    }
    return `<div class="ev-card ev-eliminar">
      <h4 class="ev-h4"><i class="fas fa-exclamation-triangle"></i> ¿Eliminar esta evaluación?</h4>
      <p class="ev-muted">Se borra la evaluación de ${esc(e.empleadoNombre || e.empleadoId)} (${esc(etiquetaPeriodo(e.periodo))}) y su fila en la hoja EVALUACIONES. Queda una copia de respaldo para auditoría.${e.estado === 'confirmada' ? ' <strong>El colaborador ya la recibió.</strong>' : ''}</p>
      <textarea data-ev="motivo-eliminar" maxlength="300" rows="2" placeholder="Motivo (recomendado)"></textarea>
      <div class="ev-actions ev-mt">
        <button class="ev-btn" data-ev="eliminar-cancelar">Cancelar</button>
        <button class="ev-btn ev-btn-peligro-solido" data-ev="eliminar-ok" data-id="${e.id}"><i class="fas fa-trash-alt"></i> Sí, eliminar</button>
      </div>
    </div>`;
  }

  async function eliminarEval(st, id, boton) {
    const ta = st.cont.querySelector('textarea[data-ev="motivo-eliminar"]');
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando…';
    try {
      const res = await rpc(st.ses, 'eval_eliminar', { id, motivo: ta ? ta.value : '' });
      if (!res.ok) throw new Error(res.error);
      const fuera = arr => (arr || []).filter(e => e.id !== id);
      st.mias = fuera(st.mias); st.hechas = fuera(st.hechas); if (st.todas) st.todas = fuera(st.todas);
      st.confirmandoEliminar = false;
      toast('Evaluación eliminada', 'success');
      volver(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false;
      boton.innerHTML = '<i class="fas fa-trash-alt"></i> Sí, eliminar';
    }
  }

  // ---------------------------------------------------------------- navegación (pila de vistas)
  function ir(st, vista, cambios = {}) {
    st.pila = st.pila || [];
    st.pila.push({ vista: st.vista, sel: st.sel, persona: st.persona });
    Object.assign(st, cambios, { vista, confirmandoEliminar: false, reuPedir: false, reuAgendar: false, reuRealizar: false });
    pintar(st);
  }
  function volver(st) {
    const prev = (st.pila || []).pop();
    st.confirmandoEliminar = false; st.reuPedir = false; st.reuAgendar = false; st.reuRealizar = false;
    if (prev) Object.assign(st, prev);
    else { st.vista = st.volverA || 'inicio'; st.sel = null; }
    // Si la evaluación que se veía ya no existe (eliminada), subir un nivel más
    if (st.vista === 'detalle' && (!st.sel || !buscarEval(st, st.sel.id))) return volver(st);
    pintar(st);
  }

  function exportarExcel(st, opts) {
    const filas = filasResultados(st, opts);
    const cols = ['ID', 'Colaborador', 'Área', 'Cargo', 'Evaluador', 'Período', 'Estado', 'Puntaje', '% Total', 'Estado del desempeño', 'Intervención inmediata', 'Estado de la intervención', 'Feedback', 'Feedback hasta',
      ...DIMENSIONES.map(d => d.t + ' %'), ...ITEMS.map((it, i) => `${i + 1}. ${it.c}`),
      'Fortalezas', 'Oportunidades de mejora', 'Compromisos', 'Recibida', 'Vigente hasta', 'Reunión'];
    const celda = v => `<td>${esc(v == null ? '' : v)}</td>`;
    const cuerpo = filas.map(x => {
      const e = x.ev;
      const r = e && e.reunion;
      return '<tr>' + [x.emp.id, x.emp.nombre, x.emp.area, x.emp.cargo, x.evaluador,
        e ? (e.tipo === 'DIA75' ? 'Día 75' : etiquetaPeriodo(e.periodo)) : etiquetaPeriodo(st.filtro.periodo),
        e ? ({ confirmada: 'Recibida', revision: 'En revisión TTHH', devuelta: 'Devuelta por TTHH' }[e.estado] || 'Enviada')
          : ({ pendiente: 'Pendiente', vencida: 'Plazo vencido', 'en-prueba': `En período de prueba (día ${x.prueba})` }[x.estado] || 'Sin evaluador'),
        e ? e.puntaje : '', e ? Math.round(Number(e.porcentaje) * 1000) / 10 : '', e ? nivelEval(e) : '',
        e ? (requiereIntervencion(e) ? 'SÍ' : 'NO') : '', e && requiereIntervencion(e) && !retenida(e) ? (fb(e).vencido ? 'Vencida' : estadoIntervencion(e)) : '',
        e ? ({ realizada: 'Realizado', agendada: 'Agendado', pendiente: 'Pendiente', opcional: 'Opcional' }[fb(e).estado] || '') : '', e && fb(e).exigido ? fechaCorta(fb(e).vence) : '',
        ...DIMENSIONES.map(d => e && e.dimensiones[d.k] ? Math.round(Number(e.dimensiones[d.k].porcentaje || 0) * 1000) / 10 : ''),
        ...ITEMS.map((_, i) => e && mismoCuestionario(e) ? e.calificaciones[i] : ''),
        e ? e.fortalezas : '', e ? e.mejoras : '', e ? e.compromisos : '', e ? fechaDeHora(e.confirmadaEn) : '',
        e ? fechaCorta(e.vigenteHasta) : '',
        r ? (r.estado === 'realizada' ? `Realizada ${fechaCorta(r.realizadaEn)}` : r.estado === 'agendada' ? `Agendada ${fechaCorta(r.fecha)} ${r.hora || ''}` : 'Solicitada') : ''
      ].map(celda).join('') + '</tr>';
    }).join('');
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cuerpo}</tbody></table></body></html>`;
    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Evaluaciones_${st.filtro.periodo}.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Asignación de status y jefe inmediato (Firestore, documento del empleado)
  function montarAsignaciones(cont, opts) {
    const st = { cambios: new Map(), q: '', unidad: '', area: '', soloSin: false, guardando: false };
    const lista = () => (opts.empleados() || []).filter(e => String(e.activo || 'SI').toUpperCase() !== 'NO' && !e.esEliminado)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    const valor = (emp, k) => {
      const c = st.cambios.get(String(emp.id));
      if (c && k in c) return c[k];
      if (k === 'evaluacion_rol') return rolDe(emp);
      if (k === 'fecha_ingreso') return normFecha(emp.fecha_ingreso || emp.fechaIngreso);
      return emp[k] || '';
    };
    const cambiar = (id, k, v) => {
      const emp = lista().find(e => String(e.id) === String(id));
      const c = Object.assign({}, st.cambios.get(String(id)));
      c[k] = v;
      // Si vuelve al valor guardado, ya no es un cambio
      const original = k === 'evaluacion_rol' ? emp.evaluacion_rol || '' : (k === 'fecha_ingreso' ? normFecha(emp.fecha_ingreso || emp.fechaIngreso) : emp[k] || '');
      if (v === original) delete c[k];
      if (Object.keys(c).length) st.cambios.set(String(id), c); else st.cambios.delete(String(id));
    };
    const pintarA = () => {
      const emps = lista();
      registrarAreas(emps);
      const evaluadores = emps.filter(e => valor(e, 'evaluacion_rol').includes('EVALUADOR'));
      const q = st.q.trim().toLowerCase();
      const unidades = [...new Set(emps.map(unidadDe).filter(Boolean))].sort();
      const areas = [...new Set(emps.filter(e => !st.unidad || unidadDe(e) === st.unidad).map(areaDe).filter(Boolean))].sort();
      const porIdA = new Map(emps.map(e => [String(e.id), e]));
      const sinStatus = emps.filter(e => !e.evaluacion_rol && !(st.cambios.get(String(e.id)) || {}).evaluacion_rol).length;
      const visibles = emps.filter(e => (!st.unidad || unidadDe(e) === st.unidad) && (!st.area || areaDe(e) === st.area)
        && (!q || `${e.nombre} ${e.id} ${e.cargo} ${unidadDe(e)} ${areaDe(e)} ${e.jefe_inmediato || ''}`.toLowerCase().includes(q))
        && (!st.soloSin || (rolEsEvaluado(valor(e, 'evaluacion_rol')) && !valor(e, 'evaluador_id'))));
      const nCambios = st.cambios.size;
      const sinEval = emps.filter(e => rolEsEvaluado(valor(e, 'evaluacion_rol')) && !valor(e, 'evaluador_id')).length;
      cont.innerHTML = `<div class="ev-root"><div class="ev-card">
        <p class="ev-muted">Define el status de cada colaborador y su jefe inmediato (evaluador). <strong>EVALUADOR</strong> califica a su equipo; <strong>EVALUADO</strong> recibe evaluaciones; un jefe puede ser ambas. La fecha de ingreso decide si corresponde el seguimiento Día 75 o la evaluación mensual.</p>
        ${sinStatus ? `<div class="ev-aviso"><i class="fas fa-info-circle"></i> ${sinStatus} colaborador(es) aún no tienen status guardado; se muestra el sugerido (supervisores: EVALUADOR Y EVALUADO, resto: EVALUADO). <button class="ev-btn ev-btn-sm" data-a="defaults">Aplicar a todos</button></div>` : ''}
        <div class="ev-filtros">
          <input type="search" data-a="q" placeholder="Buscar colaborador" value="${esc(st.q)}">
          ${unidades.length ? `<select class="ev-select" data-a="unidad">${opcionesSelect(unidades, st.unidad, 'Todas las unidades')}</select>` : ''}
          <select class="ev-select" data-a="area">${opcionesSelect(areas, st.area, 'Todas las áreas')}</select>
          <label class="ev-check"><input type="checkbox" data-a="solosin" ${st.soloSin ? 'checked' : ''}> Sin evaluador (${sinEval})</label>
          <button class="ev-btn ev-btn-primary ev-ml-auto" data-a="guardar" ${!nCambios || st.guardando ? 'disabled' : ''}>${st.guardando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : `<i class="fas fa-save"></i> Guardar cambios${nCambios ? ` (${nCambios})` : ''}`}</button>
        </div>
        <div class="ev-tabla-wrap"><table class="ev-tabla ev-tabla-asig">
          <thead><tr><th>Colaborador</th><th>Status</th><th>Evaluador (jefe inmediato)</th><th>Fecha de ingreso</th></tr></thead>
          <tbody>${visibles.map(e => {
            const id = String(e.id);
            const ch = st.cambios.get(id) || {};
            const rol = valor(e, 'evaluacion_rol');
            const evid = valor(e, 'evaluador_id');
            const fi = valor(e, 'fecha_ingreso');
            const et = etapa({ fecha_ingreso: fi });
            const opcionesEv = evaluadores.filter(x => String(x.id) !== id)
              .map(x => `<option value="${esc(x.id)}" ${String(x.id) === String(evid) ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
            const evInvalido = evid && !evaluadores.some(x => String(x.id) === String(evid));
            return `<tr class="${Object.keys(ch).length ? 'ev-fila-cambio' : ''}">
              <td><strong>${esc(e.nombre || id)}</strong><div class="ev-muted ev-small">${esc(id)} · ${esc(subtituloEmp(e))}</div></td>
              <td><select class="ev-select ev-select-sm ${'evaluacion_rol' in ch || !e.evaluacion_rol ? 'ev-sel-cambio' : ''}" data-a="rol" data-id="${esc(id)}">${ROLES.map(r => `<option ${r === rol ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
              <td>${rolEsEvaluado(rol)
                ? `<select class="ev-select ev-select-sm ${'evaluador_id' in ch ? 'ev-sel-cambio' : ''} ${!evid ? 'ev-sel-falta' : ''}" data-a="evaluador" data-id="${esc(id)}"><option value="">— Sin asignar —</option>${evInvalido ? `<option value="${esc(evid)}" selected>(${esc(evid)}: ya no es evaluador)</option>` : ''}${opcionesEv}</select>`
                : '<span class="ev-muted">No aplica</span>'}
                ${rolEsEvaluado(rol) && e.jefe_inmediato_id && String(e.jefe_inmediato_id) !== String(evid)
                  ? `<div class="ev-small ev-warn">Jefe en nómina: ${esc((porIdA.get(String(e.jefe_inmediato_id)) || {}).nombre || e.jefe_inmediato || e.jefe_inmediato_id)}</div>` : ''}</td>
              <td><input type="date" class="ev-select-sm ${'fecha_ingreso' in ch ? 'ev-sel-cambio' : ''}" data-a="ingreso" data-id="${esc(id)}" value="${esc(fi)}" max="${hoyLocal()}">
                ${et.dias !== null && et.dias < 90 ? `<div class="ev-small ev-warn">Período de prueba · día ${et.dias}</div>` : ''}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="4" class="ev-vacio">Sin colaboradores para este filtro.</td></tr>'}</tbody>
        </table></div>
        <p class="ev-muted ev-small">El evaluador verá los cambios la próxima vez que ingrese su contraseña en Desarrollo.</p>
      </div></div>`;
    };
    cont.addEventListener('change', ev => {
      const el = ev.target, a = el.dataset.a;
      if (a === 'rol') {
        cambiar(el.dataset.id, 'evaluacion_rol', el.value);
        if (!rolEsEvaluado(el.value)) cambiar(el.dataset.id, 'evaluador_id', '');
      } else if (a === 'evaluador') cambiar(el.dataset.id, 'evaluador_id', el.value);
      else if (a === 'ingreso') cambiar(el.dataset.id, 'fecha_ingreso', el.value);
      else if (a === 'unidad') { st.unidad = el.value; st.area = ''; }
      else if (a === 'area') st.area = el.value;
      else if (a === 'solosin') st.soloSin = el.checked;
      else return;
      pintarA();
    });
    cont.addEventListener('input', ev => {
      if (ev.target.dataset.a !== 'q') return;
      st.q = ev.target.value;
      clearTimeout(st._q);
      st._q = setTimeout(() => { pintarA(); const i = cont.querySelector('[data-a="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    });
    cont.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'defaults') {
        lista().forEach(e => { if (!e.evaluacion_rol) cambiar(e.id, 'evaluacion_rol', rolDe(e)); });
        pintarA();
      } else if (b.dataset.a === 'guardar' && !st.guardando) {
        st.guardando = true; pintarA();
        let ok = 0; const errores = [];
        for (const [id, datos] of Array.from(st.cambios.entries())) {
          try {
            const res = await opts.guardarEmpleado(id, datos);
            if (res && res.error) throw new Error(res.error);
            const emp = (opts.empleados() || []).find(e => String(e.id) === id);
            if (emp) Object.assign(emp, datos);
            st.cambios.delete(id); ok++;
          } catch (e) { errores.push(`${id}: ${e.message || e}`); }
        }
        st.guardando = false; pintarA();
        if (errores.length) toast(`Guardados ${ok}; con error ${errores.length}: ${errores[0]}`, 'error');
        else toast(`${ok} colaborador(es) actualizados`, 'success');
      }
    });
    pintarA();
    return { refrescar: pintarA };
  }

  // ---------------------------------------------------------------- configuración (admin master)
  // Edita el cuestionario completo: meta, plazos, niveles, escala, dimensiones, preguntas, pesos y
  // recomendaciones. Cada guardado crea una versión nueva (las evaluaciones hechas no cambian).
  function montarConfig(cont, opts) {
    const st = montar(cont, { empleado: opts.empleado, embebido: true, diferido: true });
    st.empleados = opts.empleados;
    st.cfg = null; st.versiones = []; st.cfgError = ''; st.dirty = false; st.guardandoCfg = false; st.cfgComentario = '';
    st.alIniciar = async () => {
      st.vista = 'cfg';
      if (!st.ses.master) return pintarConfig(st);
      st.cargando = true; pintar(st);
      try {
        const [o, h] = await Promise.all([rpc(st.ses, 'eval_config', { modo: 'obtener' }), rpc(st.ses, 'eval_config', { modo: 'historial' })]);
        if (!o.ok) throw new Error(o.error);
        aplicarConfig(o.config, o.version, o.reaperturas);
        configCargada = Date.now();
        st.cfgVersion = o.version; st.cfgFecha = o.creadoEn; st.cfgPor = o.creadoPor;
        st.cfg = JSON.parse(JSON.stringify(actualizarConfig(o.config)));
        st.versiones = h && h.ok ? h.versiones : [];
        st.dirty = false; st.cfgError = ''; st.cfgComentario = '';
      } catch (e) {
        if (e.sesion) st.ses = null;
        st.cfgError = e.message || String(e);
      }
      st.cargando = false;
      pintarConfig(st);
    };
    st.pintarInicio = () => pintarConfig(st);
    st.onClick = (a, b) => accionConfig(st, a, b);
    st.onChange = (a, el) => cambioConfig(st, a, el, true);
    st.onInput = (a, el) => cambioConfig(st, a, el, false);
    if (st.ses) st.alIniciar(); else pintar(st);
    return st;
  }

  function rutaSet(obj, ruta, valor) {
    const partes = ruta.split('.');
    let o = obj;
    for (let i = 0; i < partes.length - 1; i++) o = o[partes[i]] = o[partes[i]] || {};
    o[partes[partes.length - 1]] = valor;
  }

  function cambioConfig(st, a, el, final) {
    if (a === 'cfg-interv') { st.cfg.niveles[Number(el.dataset.i)].i = el.checked; st.dirty = true; return repintarSinSalto(st); }
    if (a === 'cfg-comentario') { st.cfgComentario = el.value; return; }
    if (a === 'cfg-oblig') {
      const v = Number(el.dataset.v);
      const set = new Set((st.cfg.obligatoriaObs || []).map(Number));
      if (el.checked) set.add(v); else set.delete(v);
      st.cfg.obligatoriaObs = [...set].sort((x, y) => x - y);
      st.dirty = true;
      return;
    }
    if (a === 'cfg-reabrir-emp' || a === 'cfg-reabrir-mes' || a === 'cfg-reabrir-dias' || a === 'cfg-reabrir-motivo') return;
    if (a !== 'cfg') return;
    const t = el.dataset.t;
    let v = el.value;
    if (t === 'num') v = el.value === '' ? '' : Math.round(Number(el.value));
    if (t === 'pct') v = el.value === '' ? '' : Math.round(Number(el.value) * 10) / 1000;
    const ruta = el.dataset.p;
    // Renombrar un nivel mueve su recomendación
    if (final && /^niveles\.\d+\.n$/.test(ruta) && el.dataset.old && el.dataset.old !== v) {
      const rec = st.cfg.recomendaciones || {};
      if (el.dataset.old in rec) { rec[v] = rec[el.dataset.old]; delete rec[el.dataset.old]; }
    }
    rutaSet(st.cfg, ruta, v);
    st.dirty = true;
    if (final && (t === 'num' || t === 'pct' || el.tagName === 'SELECT' || /^niveles\./.test(ruta))) repintarSinSalto(st);
  }

  function claveDimension(st) {
    let k;
    do { k = 'dim' + Math.random().toString(36).slice(2, 7); } while (st.cfg.dimensiones.some(d => d.k === k));
    return k;
  }

  async function accionConfig(st, a, b) {
    const g = st.cfg;
    const i = Number(b.dataset.i);
    const mover = (arr, j, k) => { if (k < 0 || k >= arr.length) return; const x = arr[j]; arr[j] = arr[k]; arr[k] = x; };
    let cambio = true;
    if (a === 'cfg-recargar') { st.dirty = false; return st.alIniciar(); }
    else if (a === 'cfg-descartar') { if (!st.dirty || confirm('¿Descartar los cambios sin guardar?')) { st.dirty = false; st.alIniciar(); } return; }
    else if (a === 'cfg-add-item') g.items.push({ dim: (g.dimensiones[0] || {}).k, peso: 1, c: 'Nueva competencia', m: '' });
    else if (a === 'cfg-del-item') { if (g.items.length <= 1) return toast('Debe quedar al menos una pregunta.', 'warning'); if (!confirm(`¿Quitar la pregunta "${g.items[i].c}"?`)) return; g.items.splice(i, 1); }
    else if (a === 'cfg-up-item') mover(g.items, i, i - 1);
    else if (a === 'cfg-down-item') mover(g.items, i, i + 1);
    else if (a === 'cfg-add-dim') g.dimensiones.push({ k: claveDimension(st), t: 'Nueva dimensión', corto: 'Nueva' });
    else if (a === 'cfg-del-dim') {
      const d = g.dimensiones[i];
      if (g.items.some(x => x.dim === d.k)) return toast('Esa dimensión tiene preguntas: muévelas a otra antes de quitarla.', 'warning');
      if (g.dimensiones.length <= 1) return toast('Debe quedar al menos una dimensión.', 'warning');
      g.dimensiones.splice(i, 1);
    }
    else if (a === 'cfg-up-dim') mover(g.dimensiones, i, i - 1);
    else if (a === 'cfg-down-dim') mover(g.dimensiones, i, i + 1);
    else if (a === 'cfg-add-nivel') g.niveles.push({ min: 0.5, n: 'Nuevo nivel', color: 'ambar', msg: '' });
    else if (a === 'cfg-del-nivel') { if (g.niveles.length <= 1) return; const n = g.niveles[i].n; g.niveles.splice(i, 1); if (g.recomendaciones) delete g.recomendaciones[n]; }
    else if (a === 'cfg-add-esc') { if (g.escala.length >= 10) return; g.escala.push({ v: g.escala.length + 1, t: 'Nuevo valor', d: '' }); }
    else if (a === 'cfg-del-esc') { if (g.escala.length <= 2) return toast('La escala necesita al menos 2 valores.', 'warning'); const v = g.escala.pop().v; g.obligatoriaObs = (g.obligatoriaObs || []).filter(x => Number(x) !== Number(v)); }
    else if (a === 'cfg-guardar') { cambio = false; await guardarConfig(st, b); return; }
    else if (a === 'cfg-reabrir') { cambio = false; await reabrirEvaluar(st, b); return; }
    else cambio = false;
    if (cambio) { st.dirty = true; repintarSinSalto(st); }
  }

  async function guardarConfig(st, boton) {
    const g = st.cfg;
    g.escala.forEach((x, i) => { x.v = i + 1; });
    const suma = sumaPesos(g.items);
    if (suma !== 100) return toast(`Los pesos deben sumar 100 % (suman ${suma} %).`, 'warning');
    if (!g.niveles.some(n => Number(n.min) === 0)) return toast('Un nivel debe empezar en 0 %.', 'warning');
    g.meta = umbralAlerta(g.niveles);   // umbral de intervención inmediata
    st.guardandoCfg = true; repintarSinSalto(st);
    try {
      const res = await rpc(st.ses, 'eval_config', { modo: 'guardar', config: g, version: st.cfgVersion, comentario: st.cfgComentario });
      if (!res.ok) throw new Error(res.error);
      toast(`Cuestionario guardado (versión ${res.version}). Vale para las evaluaciones nuevas.`, 'success');
      st.dirty = false;
      st.guardandoCfg = false;
      await st.alIniciar();
    } catch (e) {
      st.guardandoCfg = false;
      toast(e.message || String(e), 'error');
      repintarSinSalto(st);
    }
  }

  async function reabrirEvaluar(st, boton) {
    const val = k => { const el = st.cont.querySelector(`[data-ev="${k}"]`); return el ? el.value.trim() : ''; };
    const p = { tipo: 'evaluar', empleadoId: val('cfg-reabrir-emp'), periodo: val('cfg-reabrir-mes'), dias: Number(val('cfg-reabrir-dias')) || 5, motivo: val('cfg-reabrir-motivo') };
    if (!p.empleadoId) return toast('Elige el colaborador.', 'warning');
    boton.disabled = true;
    try {
      const res = await rpc(st.ses, 'eval_reabrir', p);
      if (!res.ok) throw new Error(res.error);
      toast(`Plazo reabierto hasta el ${fechaCorta(res.hasta)}: su evaluador ya puede registrar ${etiquetaPeriodo(p.periodo)}.`, 'success');
      configCargada = 0;
      await cargarConfig(st.ses, true);
      pintarConfig(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false;
    }
  }

  function pintarConfig(st) {
    const c = st.cont;
    if (!st.ses || st.cargando) return pintarGenerico(st);
    if (!st.ses.master) {
      c.innerHTML = `<div class="ev-root"><div class="ev-card"><h3 class="ev-h3"><i class="fas fa-lock"></i> Configuración</h3>
        <p class="ev-muted">Solo el administrador puede editar el cuestionario. Si acabas de recibir el permiso, <button class="ev-link" data-ev="salir">vuelve a ingresar tu contraseña</button>.</p></div></div>`;
      return;
    }
    if (!st.cfg) {
      c.innerHTML = `<div class="ev-root"><div class="ev-card ev-error-card"><i class="fas fa-exclamation-triangle"></i> ${esc(st.cfgError || 'No se pudo cargar la configuración.')}
        <button class="ev-link" data-ev="cfg-recargar">Reintentar</button></div></div>`;
      return;
    }
    const g = st.cfg;
    const suma = sumaPesos(g.items);
    const pesoDim = k => g.items.filter(x => x.dim === k).reduce((s2, x) => s2 + (Number(x.peso) || 0), 0);
    const txt = (ruta, v, extra = '') => `<input type="text" class="ev-cfg-in" data-ev="cfg" data-p="${ruta}" data-t="txt" value="${esc(v)}" ${extra}>`;
    const num = (ruta, v, min, max, extra = '') => `<input type="number" class="ev-cfg-in ev-cfg-num" data-ev="cfg" data-p="${ruta}" data-t="num" value="${esc(v)}" min="${min}" max="${max}" step="1" ${extra}>`;
    const por = (ruta, v) => `<input type="number" class="ev-cfg-in ev-cfg-num" data-ev="cfg" data-p="${ruta}" data-t="pct" value="${Math.round(Number(v) * 1000) / 10}" min="0" max="100" step="0.5">`;
    const area = (ruta, v, filas, ph, max) => `<textarea class="ev-cfg-in" data-ev="cfg" data-p="${ruta}" data-t="txt" rows="${filas}" maxlength="${max}" placeholder="${esc(ph)}">${esc(v || '')}</textarea>`;
    const btnIco = (a, i, ico, titulo, extra = '') => `<button type="button" class="ev-btn ev-btn-sm ev-btn-ico" data-ev="${a}" data-i="${i}" title="${titulo}" ${extra}><i class="fas ${ico}"></i></button>`;
    const pl = g.plazos || {};
    const nivelesOrden = g.niveles.map((n, i) => ({ n, i })).sort((x, y) => Number(y.n.min) - Number(x.n.min));
    const emps = (st.empleados ? st.empleados() : []).filter(e => String(e.activo || 'SI').toUpperCase() !== 'NO' && !e.esEliminado && esEvaluado(e) && e.evaluador_id)
      .sort((a2, b2) => String(a2.nombre || '').localeCompare(String(b2.nombre || ''), 'es'));
    const reabiertasHtml = REAPERTURAS.filter(r => r.tipo === 'evaluar').map(r => {
      const e = emps.find(x => String(x.id) === String(r.empleadoId));
      return `<li>${esc(e ? e.nombre : r.empleadoId)} · ${esc(etiquetaPeriodo(r.periodo))} · hasta el ${fechaCorta(r.hasta)}</li>`;
    }).join('');

    c.innerHTML = `<div class="ev-root ev-cfg">
      <div class="ev-card">
        <div class="ev-card-head"><h3 class="ev-h3"><i class="fas fa-sliders-h"></i> Cuestionario de evaluación</h3>
          <span class="ev-chip ev-chip-env">Versión ${esc(st.cfgVersion)} · ${fechaCorta(st.cfgFecha)}</span></div>
        <p class="ev-muted">Los cambios crean una versión nueva y valen para las evaluaciones que se registren desde ahora; las ya hechas conservan las preguntas y pesos con que se calificaron.</p>
        ${st.dirty ? '<div class="ev-aviso"><i class="fas fa-pen"></i> Tienes cambios sin guardar.</div>' : ''}
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-calendar-alt"></i> Frecuencia y plazos</h4>
        <div class="ev-cfg-grid">
          <label class="ev-campo"><span>Frecuencia de la evaluación</span>
            <select class="ev-select" data-ev="cfg" data-p="frecuencia" data-t="txt">
              <option value="MENSUAL" ${g.frecuencia !== 'TRIMESTRAL' ? 'selected' : ''}>Mensual</option>
              <option value="TRIMESTRAL" ${g.frecuencia === 'TRIMESTRAL' ? 'selected' : ''}>Trimestral (ene–mar, abr–jun, jul–sep, oct–dic)</option>
            </select><small class="ev-muted">El seguimiento Día 75 de nuevos ingresos no cambia.</small></label>
          <label class="ev-campo"><span>Día límite para evaluar (mes siguiente al cierre)</span>${num('plazos.evaluarDia', pl.evaluarDia, 1, 28)}<small class="ev-muted">Ej.: 10 → ${g.frecuencia === 'TRIMESTRAL' ? 'el trimestre jul–sep se evalúa hasta el 10 de octubre' : 'septiembre se evalúa hasta el 10 de octubre'}.</small></label>
          <label class="ev-campo"><span>Días para el feedback obligatorio</span>${num('plazos.feedbackDias', pl.feedbackDias || 7, 1, 60)}<small class="ev-muted">Desde que se envía la evaluación (intervención inmediata o cierre de trimestre).</small></label>
          <label class="ev-campo"><span>Vigencia del resultado (días)</span>${num('plazos.vigenciaDias', pl.vigenciaDias, 7, 400)}<small class="ev-muted">Después se considera desactualizado.</small></label>
          <label class="ev-campo"><span>Avisar con anticipación (días)</span>${num('plazos.avisoDias', pl.avisoDias, 0, 15)}<small class="ev-muted">Notificaciones de plazos por vencer.</small></label>
        </div>
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-layer-group"></i> Categorías de desempeño</h4>
        <p class="ev-muted ev-small">Cada categoría empieza en un porcentaje mínimo (incluido); una debe empezar en 0 %. El color se usa en el resultado, las dimensiones y las notas (la nota 1 toma el color de la categoría más baja y la 5 el de la más alta). Con «Intervención inmediata» el feedback y los compromisos son obligatorios y se avisa a TTHH.</p>
        <div class="ev-cfg-lista">${nivelesOrden.map(({ n, i }) => `<div class="ev-cfg-nivel"><div class="ev-cfg-fila">
          <span class="ev-cal-pill ${claseNivelCfg(g, n.n)}">&nbsp;</span>
          <input type="text" class="ev-cfg-in ev-cfg-grow" data-ev="cfg" data-p="niveles.${i}.n" data-t="txt" data-old="${esc(n.n)}" value="${esc(n.n)}" maxlength="40">
          <label class="ev-small">desde ${por(`niveles.${i}.min`, n.min)} %</label>
          <select class="ev-select ev-select-sm" data-ev="cfg" data-p="niveles.${i}.color" data-t="txt" title="Color">${COLORES.map(k => `<option value="${k}" ${k === colorNivel(n.n, g.niveles) ? 'selected' : ''}>${{ rojo: 'Rojo', naranja: 'Naranja', ambar: 'Ámbar', verde: 'Verde', turquesa: 'Turquesa', azul: 'Azul' }[k]}</option>`).join('')}</select>
          <label class="ev-check ev-small"><input type="checkbox" data-ev="cfg-interv" data-i="${i}" ${n.i ? 'checked' : ''}> Intervención inmediata</label>
          ${btnIco('cfg-del-nivel', i, 'fa-trash-alt', 'Quitar nivel')}
        </div>${area(`niveles.${i}.msg`, n.msg, 1, 'Mensaje que acompaña al resultado', 300)}</div>`).join('')}</div>
        <button type="button" class="ev-btn ev-btn-sm" data-ev="cfg-add-nivel"><i class="fas fa-plus"></i> Agregar nivel</button>
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-star-half-alt"></i> Escala de calificación</h4>
        <p class="ev-muted ev-small">Marca las calificaciones que exigen una observación con un hecho concreto.</p>
        <div class="ev-cfg-lista">${g.escala.map((x, i) => `<div class="ev-cfg-fila ev-cfg-fila-top">
          <span class="ev-cal-pill ${claseNota(i + 1, g.escala.length, g.niveles)}">${i + 1}</span>
          <div class="ev-cfg-grow">${txt(`escala.${i}.t`, x.t, 'maxlength="40" placeholder="Nombre"')}${area(`escala.${i}.d`, x.d, 2, 'Descripción', 300)}</div>
          <label class="ev-check ev-small"><input type="checkbox" data-ev="cfg-oblig" data-v="${i + 1}" ${(g.obligatoriaObs || []).map(Number).includes(i + 1) ? 'checked' : ''}> Exige observación</label>
        </div>`).join('')}</div>
        <div class="ev-actions"><button type="button" class="ev-btn ev-btn-sm" data-ev="cfg-add-esc"><i class="fas fa-plus"></i> Agregar valor</button>
          <button type="button" class="ev-btn ev-btn-sm" data-ev="cfg-del-esc"><i class="fas fa-minus"></i> Quitar el último</button></div>
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-th-large"></i> Dimensiones</h4>
        <div class="ev-cfg-lista">${g.dimensiones.map((d, i) => `<div class="ev-cfg-fila">
          <div class="ev-cfg-grow">${txt(`dimensiones.${i}.t`, d.t, 'maxlength="80" placeholder="Nombre de la dimensión"')}</div>
          <div class="ev-cfg-corto">${txt(`dimensiones.${i}.corto`, d.corto || '', 'maxlength="20" placeholder="Nombre corto"')}</div>
          <span class="ev-chip ev-chip-env" title="Suma de los pesos de sus preguntas">${pesoDim(d.k)} %</span>
          ${btnIco('cfg-up-dim', i, 'fa-arrow-up', 'Subir', i === 0 ? 'disabled' : '')}${btnIco('cfg-down-dim', i, 'fa-arrow-down', 'Bajar', i === g.dimensiones.length - 1 ? 'disabled' : '')}
          ${btnIco('cfg-del-dim', i, 'fa-trash-alt', 'Quitar dimensión')}
        </div>`).join('')}</div>
        <button type="button" class="ev-btn ev-btn-sm" data-ev="cfg-add-dim"><i class="fas fa-plus"></i> Agregar dimensión</button>
      </div>

      <div class="ev-card"><div class="ev-card-head"><h4 class="ev-h4"><i class="fas fa-list-ol"></i> Preguntas y ponderaciones</h4>
        <span class="ev-chip ${suma === 100 ? 'ev-chip-ok' : 'ev-chip-warn'}">Total ${suma} %${suma === 100 ? '' : ' · debe ser 100 %'}</span></div>
        ${g.items.map((it, i) => `<div class="ev-cfg-item">
          <div class="ev-cfg-fila">
            <span class="ev-item-n">${i + 1}</span>
            <select class="ev-select ev-select-sm" data-ev="cfg" data-p="items.${i}.dim" data-t="txt">${g.dimensiones.map(d => `<option value="${esc(d.k)}" ${d.k === it.dim ? 'selected' : ''}>${esc(d.corto || d.t)}</option>`).join('')}</select>
            <div class="ev-cfg-grow">${txt(`items.${i}.c`, it.c, 'maxlength="120" placeholder="Competencia"')}</div>
            <label class="ev-small ev-cfg-peso">${num(`items.${i}.peso`, it.peso, 1, 100)} %</label>
            ${btnIco('cfg-up-item', i, 'fa-arrow-up', 'Subir', i === 0 ? 'disabled' : '')}${btnIco('cfg-down-item', i, 'fa-arrow-down', 'Bajar', i === g.items.length - 1 ? 'disabled' : '')}
            ${btnIco('cfg-del-item', i, 'fa-trash-alt', 'Quitar pregunta')}
          </div>
          ${area(`items.${i}.m`, it.m, 2, 'Comportamiento esperado (lo que verá el evaluador)', 400)}
          ${area(`items.${i}.a`, it.a, 1, 'Qué evaluar: alcance para el evaluador (opcional)', 400)}
          ${area(`items.${i}.d75`, it.d75, 1, 'Texto distinto para el seguimiento Día 75 (opcional)', 400)}
        </div>`).join('')}
        <button type="button" class="ev-btn ev-btn-sm" data-ev="cfg-add-item"><i class="fas fa-plus"></i> Agregar pregunta</button>
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-lightbulb"></i> Qué hacer según la categoría (lo lee el evaluado)</h4>
        ${nivelesOrden.map(({ n }) => `<label class="ev-campo"><span>${esc(n.n)}</span>${area(`recomendaciones.${n.n}`, (g.recomendaciones || {})[n.n], 2, 'Qué puede hacer el evaluado', 400)}</label>`).join('')}
      </div>

      <div class="ev-card ev-cfg-pie">
        <input type="text" class="ev-cfg-in ev-cfg-grow" data-ev="cfg-comentario" maxlength="300" placeholder="¿Qué cambiaste? (queda en el historial de versiones)" value="${esc(st.cfgComentario)}">
        <button type="button" class="ev-btn" data-ev="cfg-descartar" ${st.dirty ? '' : 'disabled'}>Descartar</button>
        <button type="button" class="ev-btn ev-btn-primary" data-ev="cfg-guardar" ${!st.dirty || suma !== 100 || st.guardandoCfg ? 'disabled' : ''}>${st.guardandoCfg ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : '<i class="fas fa-save"></i> Guardar nueva versión'}</button>
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-unlock-alt"></i> Reabrir plazo para evaluar</h4>
        <p class="ev-muted ev-small">Permite al evaluador registrar o corregir un mes cuyo plazo ya venció. Una evaluación ya recibida se reabre desde la propia evaluación.</p>
        <div class="ev-filtros">
          <select class="ev-select" data-ev="cfg-reabrir-emp"><option value="">Colaborador…</option>${emps.map(e => `<option value="${esc(e.id)}">${esc(e.nombre || e.id)}</option>`).join('')}</select>
          <select class="ev-select" data-ev="cfg-reabrir-mes">${periodosDisponibles(6).map(m => `<option value="${m}" ${m === periodoPorDefecto() ? 'selected' : ''}>${etiquetaPeriodo(m)}</option>`).join('')}</select>
          <label class="ev-small">por <input type="number" class="ev-select ev-select-sm ev-num-corto" data-ev="cfg-reabrir-dias" value="5" min="1" max="60"> días</label>
          <input type="text" class="ev-cfg-in" data-ev="cfg-reabrir-motivo" maxlength="300" placeholder="Motivo (opcional)">
          <button type="button" class="ev-btn ev-btn-primary" data-ev="cfg-reabrir"><i class="fas fa-unlock"></i> Reabrir</button>
        </div>
        ${reabiertasHtml ? `<p class="ev-muted ev-small ev-mt">Plazos reabiertos vigentes:</p><ul class="ev-cfg-ul">${reabiertasHtml}</ul>` : ''}
      </div>

      <div class="ev-card"><h4 class="ev-h4"><i class="fas fa-history"></i> Historial de versiones</h4>
        ${st.versiones.length ? `<ul class="ev-cfg-ul">${st.versiones.map(v => `<li><strong>Versión ${v.version}</strong> · ${fechaCorta(v.creadoEn)} · ${esc(v.creadoPor)} · ${v.preguntas} preguntas${v.comentario ? ` — ${esc(v.comentario)}` : ''}</li>`).join('')}</ul>` : '<p class="ev-muted">Sin versiones.</p>'}
      </div>
    </div>`;
  }
  // Color de un nivel en el editor (según los niveles que se están editando)
  function claseNivelCfg(g, nombre) {
    const c = colorNivel(nombre, g.niveles);
    return c ? 'ev-k-' + c : '';
  }

  // Inicio del consolidado: el pintar genérico delega en pintarResultados cuando corresponde
  const pintarGenerico = pintar;
  pintar = function (st) {
    if (st.bloqueable && !bloqueo) { st.cont.innerHTML = '<div class="ev-root"><div class="ev-card ev-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div></div>'; return; }
    if (st.bloqueable && estaBloqueado(st)) { st.cont.innerHTML = `<div class="ev-root">${bloqueoHtml(bloqueo.mensaje)}</div>`; return; }
    if (st.pintarInicio && st.ses && !st.cargando && !['form', 'detalle', 'persona'].includes(st.vista)) return st.pintarInicio();
    return pintarGenerico(st);
  };

  window.EvaluacionDesempeno = {
    get ITEMS() { return ITEMS; }, get DIMENSIONES() { return DIMENSIONES; }, get ESCALA() { return ESCALA; }, get META() { return META; },
    ROLES, calcular, nivelDe, rolDe, esEvaluador, esEvaluado, etapa,
    montar, montarPanel, cerrarSesion, sesion: sesionGuardada, iniciarSesion, abrirEnlace: (cont, enlace) => { if (cont && cont._ev) { cont._ev.enlace = enlace; aplicarEnlace(cont._ev); } }
  };
})();
