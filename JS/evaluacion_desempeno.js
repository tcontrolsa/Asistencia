/**
 * Asistencia Tcontrol - Evaluación de desempeño (mensual y seguimiento Día 75)
 * Formato de Psicología Organizacional: nuevo/EVALUACION DE DESEMPEÑO.xlsx
 *
 * Datos: PostgreSQL (api.eval_guardar / eval_confirmar / eval_listar) vía PostgREST, con un
 * token que Apps Script emite tras verificar el PIN (acción tokenEvaluacion). La réplica a la
 * hoja EVALUACIONES la hace sync-historico. El status (evaluacion_rol) y el jefe inmediato
 * (evaluador_id) viven en Firestore, en el documento del empleado.
 *
 * Uso:
 *   EvaluacionDesempeno.montar(contenedor, { empleado })            app del colaborador / "Mi equipo"
 *   EvaluacionDesempeno.montarPanel(contenedor, { empleado, ... })   panel del supervisor (RR.HH.)
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- catálogo
  const DIMENSIONES = [
    { k: 'tecnico', t: 'Dominio técnico y funcional del cargo', corto: 'Técnico' },
    { k: 'gestion', t: 'Gestión del trabajo', corto: 'Gestión' },
    { k: 'aprendizaje', t: 'Aprendizaje y desarrollo', corto: 'Aprendizaje' },
    { k: 'relacional', t: 'Integración relacional y cultural', corto: 'Integración' }
  ];
  const ITEMS = [
    { dim: 'tecnico', peso: 10, c: 'Conocimiento técnico del puesto', m: 'Domina su profesiograma y funciones, aplicándolos con criterio propio en el desarrollo del cargo.' },
    { dim: 'tecnico', peso: 10, c: 'Aplicación de procedimientos', m: 'Ejecuta sus actividades conforme a los procedimientos y lineamientos establecidos del SGC, con autonomía.',
      d75: 'Ejecuta sus actividades conforme a los procedimientos, normas técnicas y lineamientos establecidos, con autonomía.' },
    { dim: 'tecnico', peso: 8, c: 'Manejo de herramientas y sistemas', m: 'Utiliza con dominio las herramientas, equipos y sistemas requeridos, optimizando su uso.' },
    { dim: 'tecnico', peso: 8, c: 'Calidad técnica del trabajo', m: 'Ejecuta sus actividades con precisión, minimizando errores y desviaciones respecto a los criterios de calidad definidos para el cargo.' },
    { dim: 'tecnico', peso: 7, c: 'Resolución de problemas técnicos', m: 'Identifica oportunamente situaciones críticas y aplica soluciones acordes con el nivel de autonomía esperado para su cargo.' },
    { dim: 'tecnico', peso: 7, c: 'Autonomía funcional', m: 'Ejecuta las funciones de su cargo con autonomía, seguridad y criterio propio en la toma de decisiones.' },
    { dim: 'gestion', peso: 11, c: 'Cumplimiento de resultados y plazos', m: 'Enfoca sus actividades al logro de los objetivos del cargo y responde consistentemente por los resultados obtenidos.' },
    { dim: 'gestion', peso: 10, c: 'Organización y priorización', m: 'Organiza y prioriza eficientemente sus actividades sin requerir supervisión constante.' },
    { dim: 'gestion', peso: 4, c: 'Cumplimiento normativo', m: 'Cumple de manera consolidada las políticas internas, normas de seguridad y disposiciones legales aplicables a su cargo.' },
    { dim: 'aprendizaje', peso: 5, c: 'Aprendizaje continuo', m: 'Adquiere y aplica de forma autónoma nuevos conocimientos relevantes para su cargo.' },
    { dim: 'aprendizaje', peso: 4, c: 'Apertura y aplicación de retroalimentación', m: 'Incorpora de manera consistente la retroalimentación recibida como parte de su desarrollo profesional.' },
    { dim: 'relacional', peso: 4, c: 'Comunicación efectiva', m: 'Favorece la coordinación y el cumplimiento de las actividades del área mediante una comunicación clara y oportuna.' },
    { dim: 'relacional', peso: 4, c: 'Trabajo colaborativo', m: 'Contribuye de manera sostenida al logro de los objetivos comunes del equipo.' },
    { dim: 'relacional', peso: 8, c: 'Adaptabilidad e integración organizacional', m: 'Demuestra alineación consolidada con los valores, normas, cultura y comportamientos esperados por la organización.' }
  ];
  const ESCALA = [
    { v: 1, t: 'Deficiente', d: 'No cumple lo esperado para su cargo; requiere intervención y plan de acción inmediato.' },
    { v: 2, t: 'Regular', d: 'Cumple de forma parcial; requiere supervisión frecuente y acciones de mejora.' },
    { v: 3, t: 'Bueno', d: 'Cumple lo esperado en términos generales; requiere apoyo o supervisión ocasional.' },
    { v: 4, t: 'Muy bueno', d: 'Cumple plenamente lo esperado para su cargo, con apoyo mínimo o esporádico.' },
    { v: 5, t: 'Excelente', d: 'Supera lo esperado para su cargo. Lo hace de forma autónoma y consistente; puede servir de referente para otros.' }
  ];
  const RECOMENDACION = {
    'Excelente': 'Reconocer el logro, mantener el rumbo y, si aplica, ampliar responsabilidades o retos de desarrollo.',
    'Muy bueno': 'Reconocer el logro, mantener el rumbo y, si aplica, ampliar responsabilidades o retos de desarrollo.',
    'Bueno': 'Reforzar fortalezas y acordar 1 o 2 acciones de mejora para el próximo mes.',
    'Aceptable': 'Plan de mejora con compromisos concretos y seguimiento en la siguiente evaluación.',
    'Requiere mejora': 'Reunión con Psicología Organizacional, plan de acción formal con apoyo o capacitación, y revisión en el mes siguiente.'
  };
  const ROLES = ['EVALUADO', 'EVALUADOR', 'EVALUADOR Y EVALUADO', 'NO APLICA'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MAX_OBS = 200, MAX_TXT = 500;

  // ---------------------------------------------------------------- utilidades
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => `${Math.round((Number(x) || 0) * 1000) / 10}%`;
  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  function nivelDe(p) {
    if (p >= 0.95) return 'Excelente';
    if (p >= 0.85) return 'Muy bueno';
    if (p >= 0.75) return 'Bueno';
    if (p >= 0.65) return 'Aceptable';
    return 'Requiere mejora';
  }
  const claseNivel = n => ({ 'Excelente': 'ev-n5', 'Muy bueno': 'ev-n4', 'Bueno': 'ev-n3', 'Aceptable': 'ev-n2', 'Requiere mejora': 'ev-n1' }[n] || '');

  // Igual que el Excel: puntaje = peso × calificación; máximo 500
  function calcular(cal) {
    let puntaje = 0, respondidos = 0;
    const dims = {};
    DIMENSIONES.forEach(d => { dims[d.k] = { puntaje: 0, maximo: 0, completos: true }; });
    ITEMS.forEach((it, i) => {
      const v = Number(cal[i]) || 0;
      dims[it.dim].maximo += it.peso * 5;
      if (v) { respondidos++; puntaje += it.peso * v; dims[it.dim].puntaje += it.peso * v; } else dims[it.dim].completos = false;
    });
    Object.values(dims).forEach(d => { d.porcentaje = d.puntaje / d.maximo; d.nivel = d.completos ? nivelDe(d.porcentaje) : 'Incompleto'; });
    const porcentaje = puntaje / 500;
    return { puntaje, porcentaje, respondidos, completa: respondidos === 14, nivel: respondidos === 14 ? nivelDe(porcentaje) : 'Evaluación incompleta', dimensiones: dims };
  }

  function rolDe(emp) {
    const r = String((emp && emp.evaluacion_rol) || '').toUpperCase().trim();
    if (ROLES.includes(r)) return r;
    const sup = String((emp && (emp.supervisor || emp.rol)) || '').toUpperCase();
    return (sup === 'SI' || sup.includes('SUPERVISOR') || sup.includes('ADMIN')) ? 'EVALUADOR Y EVALUADO' : 'EVALUADO';
  }
  const esEvaluador = emp => rolDe(emp).includes('EVALUADOR');
  const esEvaluado = emp => rolDe(emp).includes('EVALUADO');

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
  const etiquetaPeriodo = per => {
    if (per === 'DIA75') return 'Seguimiento Día 75';
    const m = String(per || '').match(/^(\d{4})-(\d{2})$/);
    return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : per;
  };
  // Mes a evaluar por defecto: desde el día 20 se califica el mes en curso; antes, el anterior
  function mesPorDefecto() {
    const d = new Date();
    if (d.getDate() < 20) d.setMonth(d.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  function finDeMesSiguiente() {
    const d = new Date();
    const f = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  }
  // Período de prueba de 90 días: Día 75 entre los días 60 y 120; mensual desde el día 90
  function etapa(emp) {
    const dias = diasDesde(emp && (emp.fecha_ingreso || emp.fechaIngreso));
    return { dias, dia75: dias !== null && dias >= 60 && dias <= 120, mensual: dias === null || dias >= 90 };
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
      throw new Error(err || 'No se pudo verificar tu PIN.');
    }
    const s = { token: res.token, exp: res.exp, empleadoId: String(empleadoId), equipo: res.equipo || [], rrhh: !!res.rrhh };
    try { sessionStorage.setItem(KEY_SESION, JSON.stringify(s)); } catch (e) { }
    return s;
  }

  // Respuesta de PostgREST (directa o reenviada por Apps Script) → resultado o error claro
  function interpretar(status, r) {
    if (status === 401) { cerrarSesion(); throw Object.assign(new Error('Tu sesión venció. Vuelve a ingresar tu PIN.'), { sesion: true }); }
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

  // Respaldo para redes o equipos que bloquean *.trycloudflare.com: Apps Script reenvía la llamada
  const KEY_PROXY = 'tcontrol_eval_via_apps_script';
  async function rpcPorAppsScript(ses, fn, p) {
    const res = await window.FirebaseBackend._post({ accion: 'evalRpc', token: ses.token, fn, p: JSON.stringify(p) });
    if (!res || typeof res.status !== 'number') {
      throw new Error((res && res.error) || 'sin respuesta de Apps Script');
    }
    return interpretar(res.status, res.body);
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
      const t = setTimeout(() => ctrl.abort(), 20000);
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
    let viaProxy = false;
    try { viaProxy = sessionStorage.getItem(KEY_PROXY) === '1'; } catch (e) { }
    if (!viaProxy) {
      try {
        return await rpcDirecto(ses, fn, p);
      } catch (e) {
        if (!e.red) throw e;
        console.warn('Evaluaciones: se usa Apps Script como respaldo');
        try { sessionStorage.setItem(KEY_PROXY, '1'); } catch (x) { }
        try {
          return await rpcPorAppsScript(ses, fn, p);
        } catch (e2) {
          if (e2.sesion || e2.servidor) throw e2;
          throw new Error(`La base de evaluaciones no está disponible en este momento (${e.message}; respaldo: ${e2.message}). Intenta en unos minutos.`);
        }
      }
    }
    try {
      return await rpcPorAppsScript(ses, fn, p);
    } catch (e) {
      if (e.sesion || e.servidor) throw e;
      // El respaldo falló: probar de nuevo la conexión directa
      try { sessionStorage.removeItem(KEY_PROXY); } catch (x) { }
      try {
        return await rpcDirecto(ses, fn, p);
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
      <h3>Confirma tu PIN</h3>
      <p class="ev-muted">Las evaluaciones son información personal. Ingresa el PIN con el que entras a la app.</p>
      <form class="ev-pin-form" data-ev="pin">
        <input type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" placeholder="PIN" required>
        <button type="submit" class="ev-btn ev-btn-primary">Continuar</button>
      </form>
      <div class="ev-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
    </div>`;

  const chipEstado = e => {
    if (!e) return '<span class="ev-chip ev-chip-pend">Pendiente</span>';
    return e.estado === 'confirmada'
      ? '<span class="ev-chip ev-chip-ok"><i class="fas fa-check"></i> Confirmada</span>'
      : '<span class="ev-chip ev-chip-env">Enviada</span>';
  };
  const chipNivel = e => e ? `<span class="ev-nivel ${claseNivel(e.nivel)}">${pct(e.porcentaje)} · ${esc(e.nivel)}</span>` : '';

  function barrasDimensiones(dims) {
    return `<div class="ev-dims">${DIMENSIONES.map(d => {
      const x = (dims && dims[d.k]) || { porcentaje: 0, nivel: '' };
      const p = Math.max(0, Math.min(1, Number(x.porcentaje) || 0));
      return `<div class="ev-dim">
        <div class="ev-dim-top"><span>${esc(d.t)}</span><strong>${pct(p)}</strong></div>
        <div class="ev-bar"><div class="ev-bar-fill ${claseNivel(x.nivel)}" style="width:${Math.round(p * 100)}%"></div></div>
        <div class="ev-dim-nivel">${esc(x.nivel || '')}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function resumenHtml(r, compacto = false) {
    return `<div class="ev-resumen ${compacto ? 'ev-resumen-compacto' : ''}">
      <div class="ev-resumen-total ${claseNivel(r.nivel)}">
        <div class="ev-resumen-pct">${pct(r.porcentaje)}</div>
        <div class="ev-resumen-nivel">${esc(r.nivel)}</div>
        <div class="ev-muted">${r.puntaje} de 500 puntos</div>
      </div>
      ${barrasDimensiones(r.dimensiones)}
    </div>
    ${RECOMENDACION[r.nivel] ? `<div class="ev-reco"><i class="fas fa-lightbulb"></i> <span><strong>Qué hacer:</strong> ${esc(RECOMENDACION[r.nivel])}</span></div>` : ''}`;
  }

  function detalleHtml(e, opciones = {}) {
    const items = ITEMS.map((it, i) => {
      const v = Number(e.calificaciones && e.calificaciones[i]) || 0;
      const o = (e.observaciones && e.observaciones[i]) || '';
      const esc5 = ESCALA[v - 1];
      return `<div class="ev-det-item">
        <div class="ev-det-num">${i + 1}</div>
        <div class="ev-det-body">
          <div class="ev-det-c">${esc(it.c)} <span class="ev-peso">${it.peso}%</span></div>
          ${o ? `<div class="ev-det-obs">${esc(o)}</div>` : ''}
        </div>
        <div class="ev-det-cal ev-c${v}">${v || '–'}<small>${esc5 ? esc(esc5.t) : ''}</small></div>
      </div>`;
    }).join('');
    const bloque = (t, x) => x ? `<div class="ev-texto"><h4>${t}</h4><p>${esc(x)}</p></div>` : '';
    return `
      <div class="ev-card">
        <div class="ev-det-head">
          <div>
            <div class="ev-eyebrow">${esc(e.tipo === 'DIA75' ? 'Seguimiento nuevo ingreso' : 'Evaluación mensual')}</div>
            <h3>${esc(etiquetaPeriodo(e.periodo))}</h3>
            <div class="ev-muted">${esc(e.empleadoNombre || e.empleadoId)} · Evaluó ${esc(e.evaluadorNombre || e.evaluadorId)} · ${fechaCorta(e.fechaAplicacion)}</div>
          </div>
          ${chipEstado(e)}
        </div>
        ${resumenHtml({ puntaje: e.puntaje, porcentaje: Number(e.porcentaje), nivel: e.nivel, dimensiones: e.dimensiones })}
      </div>
      <div class="ev-card"><h4 class="ev-h4">Calificación por comportamiento</h4>${items}</div>
      ${(e.fortalezas || e.mejoras || e.compromisos || e.proximaEvaluacion || e.comentarioColaborador) ? `<div class="ev-card">
        ${bloque('Fortalezas observadas', e.fortalezas)}
        ${bloque('Oportunidades de mejora', e.mejoras)}
        ${bloque('Compromisos para el próximo mes', e.compromisos)}
        ${e.proximaEvaluacion ? `<div class="ev-texto"><h4>Próxima evaluación</h4><p>${fechaCorta(e.proximaEvaluacion)}</p></div>` : ''}
        ${bloque('Comentario del colaborador', e.comentarioColaborador)}
      </div>` : ''}
      ${opciones.historial || ''}
      ${opciones.acciones || ''}`;
  }

  // ---------------------------------------------------------------- vista del colaborador / evaluador
  function montar(cont, opts) {
    const st = {
      cont, emp: opts.empleado || {}, ses: sesionGuardada((opts.empleado || {}).id), mias: [], hechas: [],
      mes: mesPorDefecto(), vista: 'inicio', cargando: false, error: '', form: null, sel: null, embebido: !!opts.embebido
    };
    cont._ev = st;
    cont.addEventListener('click', ev => manejarClick(st, ev));
    cont.addEventListener('submit', ev => manejarSubmit(st, ev));
    cont.addEventListener('change', ev => manejarCambio(st, ev));
    cont.addEventListener('input', ev => manejarInput(st, ev));
    if (!opts.diferido) { if (st.ses) cargar(st); else pintar(st); }
    return st;
  }

  async function cargar(st) {
    st.cargando = true; st.error = '';
    pintar(st);
    try {
      const desde = mesAnterior(mesPorDefecto(), 12);
      const [mias, equipo] = await Promise.all([
        rpc(st.ses, 'eval_listar', { modo: 'mias' }),
        st.ses.equipo.length ? rpc(st.ses, 'eval_listar', { modo: 'equipo', desde }) : Promise.resolve({ ok: true, evaluaciones: [] })
      ]);
      if (!mias.ok) throw new Error(mias.error);
      if (!equipo.ok) throw new Error(equipo.error);
      st.mias = mias.evaluaciones || [];
      st.hechas = equipo.evaluaciones || [];
    } catch (e) {
      if (e.sesion) st.ses = null;
      st.error = e.message || String(e);
    }
    st.cargando = false;
    pintar(st);
  }

  function pintar(st) {
    const c = st.cont;
    if (!st.ses) { c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}${pinHtml(st.error)}</div>`; return; }
    if (st.cargando) { c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}<div class="ev-card ev-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando evaluaciones…</div></div>`; return; }
    if (st.vista === 'form') { c.innerHTML = `<div class="ev-root">${formHtml(st)}</div>`; return; }
    if (st.vista === 'detalle') { c.innerHTML = `<div class="ev-root">${vistaDetalle(st)}</div>`; arriba(st); return; }
    c.innerHTML = `<div class="ev-root">${st.embebido ? '' : heroHtml()}${st.error ? `<div class="ev-card ev-error-card"><i class="fas fa-exclamation-triangle"></i> ${esc(st.error)} <button class="ev-link" data-ev="recargar">Reintentar</button></div>` : ''}${equipoHtml(st)}${miasHtml(st)}</div>`;
  }

  function equipoHtml(st) {
    if (!st.ses.equipo.length) {
      return esEvaluador(st.emp) ? `<div class="ev-card"><h3 class="ev-h3"><i class="fas fa-users"></i> Mi equipo</h3>
        <p class="ev-muted">Aún no tienes colaboradores asignados para evaluar. Psicología Organizacional los asigna desde el panel. <button class="ev-link" data-ev="salir">Actualizar</button></p></div>` : '';
    }
    const filas = st.ses.equipo.map(m => {
      const et = etapa(m);
      const men = st.hechas.find(e => e.empleadoId === m.id && e.tipo === 'MENSUAL' && e.periodo === st.mes);
      const d75 = st.hechas.find(e => e.empleadoId === m.id && e.tipo === 'DIA75');
      let acciones = '';
      if (et.dia75 || d75) {
        acciones += `<div class="ev-eq-tipo"><span class="ev-eq-lbl">Día 75${et.dias !== null ? ` · día ${et.dias}` : ''}</span>${chipEstado(d75)}${chipNivel(d75)}
          ${d75 ? `<button class="ev-btn ev-btn-sm" data-ev="ver" data-id="${d75.id}">Ver</button>` : ''}
          ${!d75 || d75.estado !== 'confirmada' ? `<button class="ev-btn ev-btn-sm ${d75 ? '' : 'ev-btn-primary'}" data-ev="evaluar" data-tipo="DIA75" data-emp="${esc(m.id)}">${d75 ? 'Corregir' : 'Evaluar'}</button>` : ''}</div>`;
      }
      if (et.mensual) {
        acciones += `<div class="ev-eq-tipo"><span class="ev-eq-lbl">Mensual</span>${chipEstado(men)}${chipNivel(men)}
          ${men ? `<button class="ev-btn ev-btn-sm" data-ev="ver" data-id="${men.id}">Ver</button>` : ''}
          ${!men || men.estado !== 'confirmada' ? `<button class="ev-btn ev-btn-sm ${men ? '' : 'ev-btn-primary'}" data-ev="evaluar" data-tipo="MENSUAL" data-emp="${esc(m.id)}">${men ? 'Corregir' : 'Evaluar'}</button>` : ''}</div>`;
      } else if (!et.dia75 && !d75) {
        acciones += `<div class="ev-eq-tipo"><span class="ev-muted">En período de prueba (día ${et.dias}). El seguimiento Día 75 se habilita desde el día 60.</span></div>`;
      }
      return `<div class="ev-eq">
        <div class="ev-avatar">${m.foto_url ? `<img src="${esc(m.foto_url)}" alt="" onerror="this.remove()">` : ''}<span>${esc(iniciales(m.nombre))}</span></div>
        <div class="ev-eq-info"><strong>${esc(m.nombre || m.id)}</strong><span class="ev-muted">${esc(m.cargo || '')}${m.area ? ' · ' + esc(m.area) : ''}</span>${acciones}</div>
      </div>`;
    }).join('');
    const pendientes = st.ses.equipo.filter(m => etapa(m).mensual && !st.hechas.some(e => e.empleadoId === m.id && e.tipo === 'MENSUAL' && e.periodo === st.mes)).length;
    return `<div class="ev-card">
      <div class="ev-card-head">
        <h3 class="ev-h3"><i class="fas fa-users"></i> Mi equipo</h3>
        <select data-ev="mes" class="ev-select">${mesesDisponibles().map(m => `<option value="${m}" ${m === st.mes ? 'selected' : ''}>${etiquetaPeriodo(m)}</option>`).join('')}</select>
      </div>
      <p class="ev-muted ev-mb">${pendientes ? `${pendientes} evaluación(es) mensual(es) pendiente(s) para ${etiquetaPeriodo(st.mes)}.` : `Equipo al día para ${etiquetaPeriodo(st.mes)}.`} Califica en los últimos días del mes y conversa el resultado la semana siguiente.</p>
      ${filas}
      <p class="ev-muted ev-small">¿Falta alguien? Pide a Psicología Organizacional que lo asigne y <button class="ev-link" data-ev="salir">vuelve a ingresar tu PIN</button>.</p>
    </div>`;
  }

  function miasHtml(st) {
    const lista = st.mias.map(e => `
      <button class="ev-mia ${e.estado === 'enviada' ? 'ev-mia-nueva' : ''}" data-ev="ver" data-id="${e.id}">
        <div><strong>${esc(etiquetaPeriodo(e.periodo))}</strong><span class="ev-muted">Evaluó ${esc(e.evaluadorNombre || e.evaluadorId)}</span></div>
        <div class="ev-mia-der">${chipNivel(e)}${e.estado === 'enviada' ? '<span class="ev-chip ev-chip-env">Por confirmar</span>' : ''}<i class="fas fa-chevron-right"></i></div>
      </button>`).join('');
    if (!esEvaluado(st.emp) && !st.mias.length) return '';
    return `<div class="ev-card">
      <h3 class="ev-h3"><i class="fas fa-chart-line"></i> Mis evaluaciones</h3>
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
    let acciones = '';
    if (soyEvaluado && e.estado === 'enviada') {
      acciones = `<div class="ev-card ev-confirmar">
        <h4 class="ev-h4">Confirma la conversación de retroalimentación</h4>
        <p class="ev-muted">Al confirmar indicas que conversaste el resultado con tu jefe inmediato y asumes los compromisos acordados. Reemplaza la firma del formato.</p>
        <textarea data-ev="comentario" maxlength="${MAX_TXT}" rows="3" placeholder="Comentario opcional"></textarea>
        <button class="ev-btn ev-btn-primary ev-btn-block" data-ev="confirmar" data-id="${e.id}"><i class="fas fa-check"></i> Confirmo que recibí la retroalimentación</button>
      </div>`;
    } else if (soyEvaluador && e.estado === 'enviada') {
      acciones = `<div class="ev-actions"><button class="ev-btn" data-ev="evaluar" data-tipo="${e.tipo}" data-emp="${esc(e.empleadoId)}" data-periodo="${esc(e.periodo)}"><i class="fas fa-pen"></i> Corregir evaluación</button></div>`;
    }
    const historial = (st.historialDe ? st.historialDe(e) : '');
    return `<div class="ev-topbar"><button class="ev-back" data-ev="volver"><i class="fas fa-arrow-left"></i> Volver</button></div>
      ${detalleHtml(e, { acciones, historial })}`;
  }

  // ---------------------------------------------------------------- formulario (3 pasos)
  function abrirForm(st, empId, tipo, periodo) {
    const m = st.ses.equipo.find(x => x.id === empId) || { id: empId };
    const per = tipo === 'DIA75' ? 'DIA75' : (periodo || st.mes);
    const previa = st.hechas.find(e => e.empleadoId === empId && e.tipo === tipo && (tipo === 'DIA75' || e.periodo === per));
    st.form = {
      emp: m, tipo, periodo: per, paso: 1,
      cal: previa ? previa.calificaciones.map(Number) : Array(14).fill(0),
      obs: previa ? previa.observaciones.slice() : Array(14).fill(''),
      abiertas: new Set(),
      fortalezas: previa ? previa.fortalezas || '' : '',
      mejoras: previa ? previa.mejoras || '' : '',
      compromisos: previa ? previa.compromisos || '' : '',
      proxima: previa ? normFecha(previa.proximaEvaluacion) : (tipo === 'MENSUAL' ? finDeMesSiguiente() : ''),
      error: '', enviando: false
    };
    st.vista = 'form';
    pintar(st);
    arriba(st);
  }

  function faltantesObs(f) {
    const out = [];
    f.cal.forEach((v, i) => { if ([1, 2, 5].includes(v) && !String(f.obs[i] || '').trim()) out.push(i + 1); });
    return out;
  }

  function formHtml(st) {
    const f = st.form, m = f.emp, r = calcular(f.cal);
    const pasos = ['Evaluación', 'Comentarios', 'Revisión'].map((t, i) =>
      `<div class="ev-paso ${f.paso === i + 1 ? 'ev-paso-on' : ''} ${f.paso > i + 1 ? 'ev-paso-ok' : ''}"><span>${f.paso > i + 1 ? '<i class="fas fa-check"></i>' : i + 1}</span>${t}</div>`).join('<div class="ev-paso-linea"></div>');
    const periodoCtl = f.tipo === 'DIA75'
      ? `<strong>Día 75 desde el ingreso</strong>`
      : `<select data-ev="form-mes" class="ev-select ev-select-sm">${mesesDisponibles().map(x => `<option value="${x}" ${x === f.periodo ? 'selected' : ''}>${etiquetaPeriodo(x)}</option>`).join('')}</select>`;
    let cuerpo = '';
    if (f.paso === 1) {
      let dimActual = '';
      cuerpo = `<div class="ev-card ev-escala"><h4 class="ev-h4">Escala de valoración</h4>${ESCALA.slice().reverse().map(e => `<div class="ev-escala-fila"><span class="ev-c${e.v}">${e.v}</span><div><strong>${e.t}</strong> <span class="ev-muted">${e.d}</span></div></div>`).join('')}
        <p class="ev-muted ev-small">Evalúa solo lo observado durante el período y frente a lo esperado para el cargo; no compares con otras personas. Las calificaciones 1, 2 y 5 requieren una observación con un hecho concreto.</p></div>`;
      cuerpo += ITEMS.map((it, i) => {
        let cab = '';
        if (it.dim !== dimActual) {
          dimActual = it.dim;
          const d = DIMENSIONES.find(x => x.k === it.dim);
          const peso = ITEMS.filter(x => x.dim === it.dim).reduce((s, x) => s + x.peso, 0);
          cab = `<div class="ev-dim-cab">${esc(d.t)} <span>${peso}%</span></div>`;
        }
        const v = f.cal[i];
        const requiere = [1, 2, 5].includes(v);
        const abierta = requiere || f.abiertas.has(i) || String(f.obs[i] || '').trim();
        const falta = requiere && !String(f.obs[i] || '').trim() && f.error;
        return `${cab}<div class="ev-item ${v ? 'ev-item-ok' : ''}" id="ev-item-${i}">
          <div class="ev-item-head"><span class="ev-item-n">${i + 1}</span><div><strong>${esc(it.c)}</strong><p>${esc(f.tipo === 'DIA75' && it.d75 ? it.d75 : it.m)}</p></div><span class="ev-peso">${it.peso}%</span></div>
          <div class="ev-opciones" role="radiogroup" aria-label="${esc(it.c)}">${ESCALA.map(e => `
            <button type="button" role="radio" aria-checked="${v === e.v}" class="ev-op ev-c${e.v} ${v === e.v ? 'ev-op-on' : ''}" data-ev="cal" data-i="${i}" data-v="${e.v}" title="${esc(e.d)}"><b>${e.v}</b><small>${e.t}</small></button>`).join('')}
          </div>
          ${abierta
            ? `<textarea class="ev-obs ${falta ? 'ev-obs-falta' : ''}" data-ev="obs" data-i="${i}" maxlength="${MAX_OBS}" rows="2" placeholder="${requiere ? 'Obligatorio: ¿qué pasó y cuándo?' : 'Observación (opcional)'}">${esc(f.obs[i] || '')}</textarea>`
            : `<button type="button" class="ev-link ev-small" data-ev="abrir-obs" data-i="${i}"><i class="fas fa-plus"></i> Agregar observación</button>`}
        </div>`;
      }).join('');
    } else if (f.paso === 2) {
      const campo = (k, t, ph) => `<label class="ev-campo"><span>${t}</span><textarea data-ev="txt" data-k="${k}" maxlength="${MAX_TXT}" rows="3" placeholder="${ph}">${esc(f[k])}</textarea></label>`;
      cuerpo = `<div class="ev-card">
        <h4 class="ev-h4">Retroalimentación y compromisos</h4>
        ${campo('fortalezas', 'Fortalezas observadas', 'Lo que hizo especialmente bien en el período')}
        ${campo('mejoras', 'Oportunidades de mejora', 'Comportamientos a reforzar')}
        ${campo('compromisos', 'Compromisos acordados para el próximo mes', 'Acciones concretas, vinculadas a sus KPIs cuando aplique')}
        <label class="ev-campo"><span>Fecha de la próxima evaluación</span><input type="date" data-ev="proxima" value="${esc(f.proxima)}" min="${hoyLocal()}"></label>
      </div>`;
    } else {
      cuerpo = `<div class="ev-card"><h4 class="ev-h4">Resultado</h4>${resumenHtml(r)}</div>
        <div class="ev-card ev-muted ev-small">Al enviar, ${esc(m.nombre || 'el colaborador')} verá el resultado en su app y deberá confirmarlo después de la conversación de retroalimentación (15–20 minutos). Puedes corregirla mientras no la confirme.</div>`;
    }
    const pie = f.paso === 1
      ? `<span class="ev-progreso"><b>${r.respondidos}</b> de 14</span><button class="ev-btn ev-btn-primary" data-ev="paso" data-p="2">Siguiente <i class="fas fa-chevron-right"></i></button>`
      : f.paso === 2
        ? `<button class="ev-btn" data-ev="paso" data-p="1"><i class="fas fa-chevron-left"></i> Anterior</button><button class="ev-btn ev-btn-primary" data-ev="paso" data-p="3">Siguiente <i class="fas fa-chevron-right"></i></button>`
        : `<button class="ev-btn" data-ev="paso" data-p="2"><i class="fas fa-chevron-left"></i> Anterior</button><button class="ev-btn ev-btn-primary" data-ev="enviar" ${f.enviando ? 'disabled' : ''}>${f.enviando ? '<i class="fas fa-spinner fa-spin"></i> Enviando…' : '<i class="fas fa-paper-plane"></i> Enviar evaluación'}</button>`;
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
        fortalezas: f.fortalezas, mejoras: f.mejoras, compromisos: f.compromisos, proximaEvaluacion: f.proxima
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo guardar');
      st.hechas = st.hechas.filter(e => e.id !== res.evaluacion.id).concat([res.evaluacion]);
      st.form = null; st.vista = 'inicio';
      toast(`Evaluación de ${m.nombre || m.id} enviada`, 'success');
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
      if (ta && [1, 2, 5].includes(f.cal[i]) && !ta.value) ta.focus({ preventScroll: true });
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
      st.sel = buscarEval(st, b.dataset.id);
      if (st.sel) { st.vista = 'detalle'; pintar(st); }
    } else if (a === 'volver') {
      st.vista = st.volverA || 'inicio'; st.sel = null; pintar(st);
    } else if (a === 'confirmar') {
      confirmar(st, Number(b.dataset.id), b);
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

  async function confirmar(st, id, boton) {
    const ta = st.cont.querySelector('textarea[data-ev="comentario"]');
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirmando…';
    try {
      const res = await rpc(st.ses, 'eval_confirmar', { id, comentario: ta ? ta.value : '' });
      if (!res.ok) throw new Error(res.error);
      st.mias = st.mias.map(e => e.id === id ? res.evaluacion : e);
      st.sel = res.evaluacion;
      toast('Evaluación confirmada. ¡Gracias!', 'success');
      pintar(st);
    } catch (e) {
      toast(e.message || String(e), 'error');
      boton.disabled = false;
      boton.innerHTML = '<i class="fas fa-check"></i> Confirmo que recibí la retroalimentación';
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
      const previa = st.hechas.find(e => e.empleadoId === f.emp.id && e.tipo === 'MENSUAL' && e.periodo === f.periodo);
      if (previa) toast(`${etiquetaPeriodo(f.periodo)} ya tiene una evaluación; al enviar la reemplazarás.`, 'warning');
    } else if (a === 'proxima') st.form.proxima = el.value;
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
      <div class="ev-subtabs" role="tablist">
        <button class="ev-subtab ev-subtab-on" data-sub="resultados"><i class="fas fa-chart-bar"></i> Resultados</button>
        <button class="ev-subtab" data-sub="equipo"><i class="fas fa-users"></i> Mi equipo</button>
        ${opts.puedeAsignar ? '<button class="ev-subtab" data-sub="asignaciones"><i class="fas fa-user-tag"></i> Evaluadores y evaluados</button>' : ''}
      </div>
      <div data-subpanel="resultados"></div>
      <div data-subpanel="equipo" hidden></div>
      <div data-subpanel="asignaciones" hidden></div>
    </div>`;
    const sub = k => cont.querySelector(`[data-subpanel="${k}"]`);
    const montados = {};
    const abrir = k => {
      cont.querySelectorAll('.ev-subtab').forEach(b => b.classList.toggle('ev-subtab-on', b.dataset.sub === k));
      cont.querySelectorAll('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== k; });
      if (montados[k]) { refrescarSub(k); return; }
      if (k === 'resultados') montados[k] = montarResultados(sub(k), opts);
      if (k === 'equipo') montados[k] = montar(sub(k), { empleado: opts.empleado, embebido: true });
      if (k === 'asignaciones') montados[k] = montarAsignaciones(sub(k), opts);
    };
    // Al volver a una pestaña (o al panel) se recargan los datos: las evaluaciones cambian mientras está abierto
    const refrescarSub = k => {
      const m = montados[k];
      if (k === 'asignaciones') return m.refrescar();
      if (!m.ses) m.ses = sesionGuardada(opts.empleado.id);   // PIN ingresado en la otra pestaña
      if (!m.ses) return pintar(m);
      if (m.vista === 'form') return;                          // no perder una evaluación a medio llenar
      m.vista = k === 'resultados' ? 'resultados' : 'inicio';
      if (k === 'resultados') m.alIniciar(); else cargar(m);
    };
    let actual = 'resultados';
    cont.querySelectorAll('.ev-subtab').forEach(b => b.addEventListener('click', () => { actual = b.dataset.sub; abrir(actual); }));
    abrir('resultados');
    cont._evPanel = { refrescar: () => abrir(actual) };
  }

  function montarResultados(cont, opts) {
    const st = montar(cont, { empleado: opts.empleado, embebido: true, diferido: true });
    st.todas = [];
    st.filtro = { periodo: mesPorDefecto(), q: '', area: '', estado: '' };
    st.alIniciar = async () => {
      if (!st.ses.rrhh) { st.vista = 'sin-permiso'; return pintarResultados(st, opts); }
      await cargarTodas(st, opts);
    };
    // Reemplaza la vista de inicio por el consolidado
    st.pintarInicio = () => pintarResultados(st, opts);
    st.historialDe = e => historialHtml(st, e);
    st.volverA = 'resultados';
    st.onClick = (a, b) => {
      if (a === 'exportar') exportarExcel(st, opts);
      if (a === 'r-actualizar') cargarTodas(st, opts);
    };
    st.onChange = (a, el) => {
      if (a === 'r-periodo') { st.filtro.periodo = el.value; pintarResultados(st, opts); }
      if (a === 'r-area') { st.filtro.area = el.value; pintarResultados(st, opts); }
      if (a === 'r-estado') { st.filtro.estado = el.value; pintarResultados(st, opts); }
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
      const r = await rpc(st.ses, 'eval_listar', { modo: 'todas', desde: mesAnterior(mesPorDefecto(), 12) });
      if (!r.ok) throw new Error(r.error);
      st.todas = r.evaluaciones || [];
      st.error = '';
    } catch (e) {
      if (e.sesion) st.ses = null;
      st.error = e.message || String(e);
    }
    st.cargando = false;
    st.vista = 'resultados';
    pintarResultados(st, opts);
  }

  function filasResultados(st, opts) {
    const per = st.filtro.periodo;
    const emps = (opts.empleados() || []).filter(e => String(e.activo || 'SI').toUpperCase() !== 'NO' && !e.esEliminado);
    const porId = new Map(emps.map(e => [String(e.id), e]));
    const evals = st.todas.filter(e => per === 'DIA75' ? e.tipo === 'DIA75' : (e.tipo === 'MENSUAL' && e.periodo === per));
    const filas = new Map();
    // Esperados: EVALUADO activos (mensual si pasó prueba; Día 75 si está entre los días 60 y 120)
    emps.forEach(emp => {
      if (!esEvaluado(emp)) return;
      const et = etapa(emp);
      if (per === 'DIA75' ? !et.dia75 : !et.mensual) return;
      filas.set(String(emp.id), { emp, ev: null });
    });
    evals.forEach(ev => {
      const id = String(ev.empleadoId);
      filas.set(id, { emp: porId.get(id) || { id, nombre: ev.empleadoNombre, area: ev.area, cargo: ev.cargo }, ev });
    });
    const evaluadorNombre = id => { const x = porId.get(String(id || '')); return x ? x.nombre : ''; };
    return Array.from(filas.values()).map(f => ({
      ...f,
      evaluador: f.ev ? (f.ev.evaluadorNombre || evaluadorNombre(f.ev.evaluadorId)) : evaluadorNombre(f.emp.evaluador_id),
      sinEvaluador: !f.ev && !f.emp.evaluador_id,
      estado: f.ev ? f.ev.estado : (f.emp.evaluador_id ? 'pendiente' : 'sin-evaluador')
    })).sort((a, b) => String(a.emp.nombre || '').localeCompare(String(b.emp.nombre || ''), 'es'));
  }

  function pintarResultados(st, opts) {
    const c = st.cont;
    if (!st.ses) return pintar(st);
    if (st.cargando) return pintar(st);
    if (st.vista === 'detalle') return pintar(st);
    if (!st.ses.rrhh) {
      c.innerHTML = `<div class="ev-root"><div class="ev-card"><h3 class="ev-h3"><i class="fas fa-lock"></i> Resultados consolidados</h3>
        <p class="ev-muted">Solo Psicología Organizacional y los supervisores administradores ven los resultados de toda la empresa. Tus evaluaciones como jefe inmediato están en <strong>Mi equipo</strong>.</p></div></div>`;
      return;
    }
    const todas = filasResultados(st, opts);
    const f = st.filtro;
    const q = f.q.trim().toLowerCase();
    const filas = todas.filter(x =>
      (!f.area || String(x.emp.area || '') === f.area) &&
      (!f.estado || x.estado === f.estado) &&
      (!q || `${x.emp.nombre} ${x.emp.id} ${x.emp.area} ${x.evaluador}`.toLowerCase().includes(q)));
    const conEval = todas.filter(x => x.ev);
    const prom = conEval.length ? conEval.reduce((s, x) => s + Number(x.ev.porcentaje), 0) / conEval.length : null;
    const cuenta = k => todas.filter(x => x.estado === k).length;
    const areas = [...new Set(todas.map(x => String(x.emp.area || '')).filter(Boolean))].sort();
    const promDim = k => conEval.length ? conEval.reduce((s, x) => s + Number((x.ev.dimensiones[k] || {}).porcentaje || 0), 0) / conEval.length : 0;
    const opcionesPer = mesesDisponibles(12).map(m => `<option value="${m}" ${m === f.periodo ? 'selected' : ''}>${etiquetaPeriodo(m)}</option>`).join('')
      + `<option value="DIA75" ${f.periodo === 'DIA75' ? 'selected' : ''}>Seguimiento Día 75 (nuevos ingresos)</option>`;
    const etiquetaEstado = { 'pendiente': '<span class="ev-chip ev-chip-pend">Pendiente</span>', 'sin-evaluador': '<span class="ev-chip ev-chip-warn">Sin evaluador</span>' };
    c.innerHTML = `<div class="ev-root">
      ${st.error ? `<div class="ev-card ev-error-card"><i class="fas fa-exclamation-triangle"></i> ${esc(st.error)}</div>` : ''}
      <div class="ev-card">
        <div class="ev-card-head ev-wrap">
          <select class="ev-select" data-ev="r-periodo">${opcionesPer}</select>
          <div class="ev-acciones-der">
            <button class="ev-btn ev-btn-sm" data-ev="r-actualizar" title="Volver a cargar desde la base"><i class="fas fa-sync-alt"></i> Actualizar</button>
            <button class="ev-btn ev-btn-sm" data-ev="exportar"><i class="fas fa-file-excel"></i> Exportar Excel</button>
          </div>
        </div>
        <div class="ev-kpis">
          <div class="ev-kpi"><span>A evaluar</span><strong>${todas.length}</strong></div>
          <div class="ev-kpi"><span>Enviadas</span><strong>${cuenta('enviada')}</strong></div>
          <div class="ev-kpi"><span>Confirmadas</span><strong class="ev-ok">${cuenta('confirmada')}</strong></div>
          <div class="ev-kpi"><span>Pendientes</span><strong class="ev-warn">${cuenta('pendiente')}</strong></div>
          <div class="ev-kpi"><span>Sin evaluador</span><strong class="ev-danger">${cuenta('sin-evaluador')}</strong></div>
          <div class="ev-kpi"><span>Promedio</span><strong>${prom === null ? '—' : pct(prom)}</strong></div>
        </div>
        ${conEval.length ? `<div class="ev-dims ev-dims-inline">${DIMENSIONES.map(d => `<div class="ev-dim"><div class="ev-dim-top"><span>${d.t}</span><strong>${pct(promDim(d.k))}</strong></div><div class="ev-bar"><div class="ev-bar-fill ${claseNivel(nivelDe(promDim(d.k)))}" style="width:${Math.round(promDim(d.k) * 100)}%"></div></div></div>`).join('')}</div>
        <p class="ev-muted ev-small">Promedio por dimensión del período: indica dónde reforzar la capacitación.</p>` : ''}
      </div>
      <div class="ev-card">
        <div class="ev-filtros">
          <input type="search" data-ev="r-q" placeholder="Buscar colaborador o evaluador" value="${esc(f.q)}">
          <select class="ev-select" data-ev="r-area"><option value="">Todas las áreas</option>${areas.map(a => `<option ${a === f.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
          <select class="ev-select" data-ev="r-estado">
            <option value="">Todos los estados</option>
            ${[['pendiente', 'Pendientes'], ['enviada', 'Enviadas'], ['confirmada', 'Confirmadas'], ['sin-evaluador', 'Sin evaluador']].map(([v, t]) => `<option value="${v}" ${v === f.estado ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="ev-tabla-wrap"><table class="ev-tabla">
          <thead><tr><th>Colaborador</th><th>Evaluador</th><th>Estado</th><th>Resultado</th>${DIMENSIONES.map(d => `<th class="ev-num">${d.corto}</th>`).join('')}</tr></thead>
          <tbody>${filas.map(x => `<tr ${x.ev ? `data-ev="ver" data-id="${x.ev.id}" class="ev-fila-click"` : ''}>
            <td><strong>${esc(x.emp.nombre || x.emp.id)}</strong><div class="ev-muted ev-small">${esc(x.emp.area || '')}${x.emp.cargo ? ' · ' + esc(x.emp.cargo) : ''}</div></td>
            <td>${esc(x.evaluador || '—')}</td>
            <td>${x.ev ? chipEstado(x.ev) : etiquetaEstado[x.estado]}</td>
            <td>${x.ev ? chipNivel(x.ev) : '<span class="ev-muted">—</span>'}</td>
            ${DIMENSIONES.map(d => `<td class="ev-num">${x.ev ? pct((x.ev.dimensiones[d.k] || {}).porcentaje) : '—'}</td>`).join('')}
          </tr>`).join('') || `<tr><td colspan="8" class="ev-vacio">Sin colaboradores para este filtro.</td></tr>`}</tbody>
        </table></div>
        <p class="ev-muted ev-small">${filas.length} de ${todas.length}. "A evaluar" incluye a quienes tienen status EVALUADO y ${f.periodo === 'DIA75' ? 'están entre los días 60 y 120 desde su ingreso' : 'superaron los 90 días de prueba (o no tienen fecha de ingreso)'}.</p>
      </div>
    </div>`;
  }

  function historialHtml(st, e) {
    const lista = (st.todas || []).filter(x => x.empleadoId === e.empleadoId).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
    if (lista.length < 2) return '';
    return `<div class="ev-card"><h4 class="ev-h4">Tendencia del colaborador</h4>
      <p class="ev-muted ev-small">No decidas por un solo mes: revisa la evolución de los últimos meses.</p>
      <div class="ev-tendencia">${lista.map(x => `<div class="ev-tend ${x.id === e.id ? 'ev-tend-on' : ''}">
        <div class="ev-tend-bar"><div class="${claseNivel(x.nivel)}" style="height:${Math.round(Number(x.porcentaje) * 100)}%"></div></div>
        <strong>${pct(x.porcentaje)}</strong><span>${esc(x.periodo === 'DIA75' ? 'Día 75' : etiquetaPeriodo(x.periodo).slice(0, 3) + ' ' + x.periodo.slice(2, 4))}</span>
      </div>`).join('')}</div></div>`;
  }

  function exportarExcel(st, opts) {
    const filas = filasResultados(st, opts);
    const cols = ['ID', 'Colaborador', 'Área', 'Cargo', 'Evaluador', 'Período', 'Estado', 'Puntaje', '% Total', 'Nivel',
      ...DIMENSIONES.map(d => d.t + ' %'), ...ITEMS.map((it, i) => `${i + 1}. ${it.c}`), 'Fortalezas', 'Oportunidades de mejora', 'Compromisos', 'Confirmada'];
    const celda = v => `<td>${esc(v == null ? '' : v)}</td>`;
    const cuerpo = filas.map(x => {
      const e = x.ev;
      return '<tr>' + [x.emp.id, x.emp.nombre, x.emp.area, x.emp.cargo, x.evaluador, etiquetaPeriodo(st.filtro.periodo),
        e ? (e.estado === 'confirmada' ? 'Confirmada' : 'Enviada') : (x.estado === 'pendiente' ? 'Pendiente' : 'Sin evaluador'),
        e ? e.puntaje : '', e ? Math.round(Number(e.porcentaje) * 1000) / 10 : '', e ? e.nivel : '',
        ...DIMENSIONES.map(d => e ? Math.round(Number((e.dimensiones[d.k] || {}).porcentaje || 0) * 1000) / 10 : ''),
        ...ITEMS.map((_, i) => e ? e.calificaciones[i] : ''),
        e ? e.fortalezas : '', e ? e.mejoras : '', e ? e.compromisos : '', e && e.confirmadaEn ? String(e.confirmadaEn).slice(0, 10) : ''
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
    const st = { cambios: new Map(), q: '', area: '', soloSin: false, guardando: false };
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
      const evaluadores = emps.filter(e => valor(e, 'evaluacion_rol').includes('EVALUADOR'));
      const q = st.q.trim().toLowerCase();
      const areas = [...new Set(emps.map(e => String(e.area || '')).filter(Boolean))].sort();
      const sinStatus = emps.filter(e => !e.evaluacion_rol && !(st.cambios.get(String(e.id)) || {}).evaluacion_rol).length;
      const visibles = emps.filter(e => (!st.area || e.area === st.area)
        && (!q || `${e.nombre} ${e.id} ${e.cargo}`.toLowerCase().includes(q))
        && (!st.soloSin || (valor(e, 'evaluacion_rol').includes('EVALUADO') && !valor(e, 'evaluador_id'))));
      const nCambios = st.cambios.size;
      const sinEval = emps.filter(e => valor(e, 'evaluacion_rol').includes('EVALUADO') && !valor(e, 'evaluador_id')).length;
      cont.innerHTML = `<div class="ev-root"><div class="ev-card">
        <p class="ev-muted">Define el status de cada colaborador y su jefe inmediato (evaluador). <strong>EVALUADOR</strong> califica a su equipo; <strong>EVALUADO</strong> recibe evaluaciones; un jefe puede ser ambas. La fecha de ingreso decide si corresponde el seguimiento Día 75 o la evaluación mensual.</p>
        ${sinStatus ? `<div class="ev-aviso"><i class="fas fa-info-circle"></i> ${sinStatus} colaborador(es) aún no tienen status guardado; se muestra el sugerido (supervisores: EVALUADOR Y EVALUADO, resto: EVALUADO). <button class="ev-btn ev-btn-sm" data-a="defaults">Aplicar a todos</button></div>` : ''}
        <div class="ev-filtros">
          <input type="search" data-a="q" placeholder="Buscar colaborador" value="${esc(st.q)}">
          <select class="ev-select" data-a="area"><option value="">Todas las áreas</option>${areas.map(a => `<option ${a === st.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
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
              <td><strong>${esc(e.nombre || id)}</strong><div class="ev-muted ev-small">${esc(id)} · ${esc(e.area || '')}${e.cargo ? ' · ' + esc(e.cargo) : ''}</div></td>
              <td><select class="ev-select ev-select-sm ${'evaluacion_rol' in ch || !e.evaluacion_rol ? 'ev-sel-cambio' : ''}" data-a="rol" data-id="${esc(id)}">${ROLES.map(r => `<option ${r === rol ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
              <td>${rol.includes('EVALUADO')
                ? `<select class="ev-select ev-select-sm ${'evaluador_id' in ch ? 'ev-sel-cambio' : ''} ${!evid ? 'ev-sel-falta' : ''}" data-a="evaluador" data-id="${esc(id)}"><option value="">— Sin asignar —</option>${evInvalido ? `<option value="${esc(evid)}" selected>(${esc(evid)}: ya no es evaluador)</option>` : ''}${opcionesEv}</select>`
                : '<span class="ev-muted">No aplica</span>'}</td>
              <td><input type="date" class="ev-select-sm ${'fecha_ingreso' in ch ? 'ev-sel-cambio' : ''}" data-a="ingreso" data-id="${esc(id)}" value="${esc(fi)}" max="${hoyLocal()}">
                ${et.dias !== null && et.dias < 90 ? `<div class="ev-small ev-warn">Período de prueba · día ${et.dias}</div>` : ''}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="4" class="ev-vacio">Sin colaboradores para este filtro.</td></tr>'}</tbody>
        </table></div>
        <p class="ev-muted ev-small">El evaluador verá los cambios la próxima vez que ingrese su PIN en Desarrollo.</p>
      </div></div>`;
    };
    cont.addEventListener('change', ev => {
      const el = ev.target, a = el.dataset.a;
      if (a === 'rol') {
        cambiar(el.dataset.id, 'evaluacion_rol', el.value);
        if (!el.value.includes('EVALUADO')) cambiar(el.dataset.id, 'evaluador_id', '');
      } else if (a === 'evaluador') cambiar(el.dataset.id, 'evaluador_id', el.value);
      else if (a === 'ingreso') cambiar(el.dataset.id, 'fecha_ingreso', el.value);
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

  // Inicio del consolidado: el pintar genérico delega en pintarResultados cuando corresponde
  const pintarGenerico = pintar;
  pintar = function (st) {
    if (st.pintarInicio && st.ses && !st.cargando && st.vista !== 'form' && st.vista !== 'detalle') return st.pintarInicio();
    return pintarGenerico(st);
  };

  window.EvaluacionDesempeno = {
    ITEMS, DIMENSIONES, ESCALA, ROLES, calcular, nivelDe, rolDe, esEvaluador, esEvaluado, etapa,
    montar, montarPanel, cerrarSesion
  };
})();
