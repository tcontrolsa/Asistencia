/**
 * Asistencia Tcontrol - Modulo Control de Emergencias y Simulacros
 * Extraido en Fase 5 de Modularizacion
 * Fecha: 2026-09-23
 */

// ============================================================
// CONTROL DE EMERGENCIAS Y SIMULACROS (panel en vivo)
// ============================================================
// Todo llega por listeners de Firestore (sin recargar el panel completo):
//   configuracion/emergencia  → evento vigente (eventoId, nombre, inicio)
//   logs (tipo_log 'emergencia', eventoId) → reportes de estado, inmutables; el último de cada persona manda
//   registros de hoy          → quién está en planta (ENTRADA hoy y no salió antes del evento)
// Compatibilidad: un estado escrito en la ENTRADA de hoy después del inicio (apps sin actualizar) también cuenta.
// Visitantes: los que están dentro (o salieron después del inicio) vienen de Postgres (api.visitas_emergencia, cada
// 30 s); no tienen app: los marca a salvo quien toma la lista (id 'V-<código>') o cuenta su salida en portería.
const EM = { config: null, reportes: {}, legacy: {}, hoy: {}, filtro: 'todos', busca: '', subs: {}, eventoSub: '',
  ultimaAct: 0, avisados: {}, reloj: null, primeraCarga: true, visitas: [], visitasTs: 0, visitasError: '', cargandoVisitas: false };

async function emCargarVisitas() {
  const FB = window.FirebaseBackend;
  if (EM.cargandoVisitas || !FB || !FB._urlHistorico || !FB._tokenHistorico) return;
  EM.cargandoVisitas = true;
  try {
    const [base, token] = await Promise.all([FB._urlHistorico(), FB._tokenHistorico()]);
    if (!base) throw new Error('sin dirección del servidor');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const desde = EM.config && EM.config.inicio ? EM.config.inicio : '';
    const r = await fetch(`${base}/rpc/visitas_emergencia`, { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ p: { desde } }) });
    clearTimeout(t);
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
    EM.visitas = j.visitas || []; EM.visitasTs = Date.now(); EM.visitasError = '';
  } catch (e) {
    console.warn('Emergencias: visitantes', e);
    EM.visitasError = 'No se pudo leer la lista de visitantes';
  } finally {
    EM.cargandoVisitas = false;
    emPintar();
  }
}

function emEventoId(em) {
  return window.FirebaseBackend && window.FirebaseBackend._eventoEmergenciaId ? window.FirebaseBackend._eventoEmergenciaId(em) : '';
}
function emInicioMs() {
  const c = EM.config || {};
  const t = c.inicio ? Date.parse(c.inicio) : NaN;
  if (!isNaN(t)) return t;
  const d = new Date(); d.setHours(0, 0, 0, 0);       // activaciones antiguas sin hora de inicio
  return d.getTime();
}
const emHora = ms => ms ? new Date(ms).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const emTsMs = v => !v ? 0 : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 : Date.parse(v) || 0;
const emMinutos = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function emSuscribir() {
  const firestore = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
  if (!firestore) return false;
  if (!EM.subs.config) {
    EM.subs.config = firestore.collection('configuracion').doc('emergencia').onSnapshot(doc => {
      EM.config = doc.exists ? doc.data() : { activa: false };
      window.emergencia = EM.config;
      emSuscribirReportes(firestore);
      emPintar();
    }, err => console.warn('Emergencia (config):', err));
  }
  if (!EM.subs.hoy) {
    const hoy = getLocalHoyStr(new Date());
    EM.subs.hoy = firestore.collection('registros').where('fecha', '==', hoy).onSnapshot(snap => {
      const porEmp = {};
      snap.forEach(doc => {
        const r = doc.data() || {};
        const id = String(r.empleadoId || '').trim();
        if (!id) return;
        (porEmp[id] = porEmp[id] || []).push(r);
      });
      EM.hoy = porEmp;
      EM.ultimaAct = Date.now();
      emPintar();
    }, err => console.warn('Emergencia (registros de hoy):', err));
  }
  return true;
}

function emSuscribirReportes(firestore) {
  const id = EM.config && (EM.config.activa || EM.config.eventoId) ? emEventoId(EM.config) : '';
  if (id === EM.eventoSub) return;
  if (EM.subs.reportes) { EM.subs.reportes(); EM.subs.reportes = null; }
  EM.eventoSub = id; EM.reportes = {}; EM.avisados = {}; EM.primeraCarga = true;
  if (!id) return;
  EM.subs.reportes = firestore.collection('logs').where('eventoId', '==', id).onSnapshot(snap => {
    const ult = {};
    snap.forEach(doc => {
      const r = doc.data() || {};
      if (r.tipo_log !== 'emergencia') return;
      const prev = ult[r.empleadoId];
      if (!prev || String(r.dispositivo_ts || '') > String(prev.dispositivo_ts || '')) ult[r.empleadoId] = r;
    });
    // Aviso visible y sonoro cuando alguien pide ayuda (no en la primera carga)
    Object.values(ult).forEach(r => {
      if (r.estado === 'Requiere ayuda' && !EM.avisados[r.empleadoId]) {
        EM.avisados[r.empleadoId] = true;
        if (!EM.primeraCarga) emAlertaAyuda(r);
      }
    });
    EM.primeraCarga = false;
    EM.reportes = ult;
    EM.ultimaAct = Date.now();
    emPintar();
  }, err => console.warn('Emergencia (reportes):', err));
}

function emAlertaAyuda(r) {
  mostrarToast(`🔴 ${r.nombre || r.empleadoId} REQUIERE AYUDA${r.comentario ? ': ' + r.comentario : ''}`, 'error');
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
    });
  } catch (e) { }
}

// Personas del evento: en planta (entrada hoy sin salida antes del inicio) + quien reportó aunque no marcó
function emPersonas() {
  const inicio = emInicioMs();
  const porId = {};
  const emps = (typeof empCache !== 'undefined' && Array.isArray(empCache)) ? empCache : [];
  const datosEmp = id => emps.find(e => String(e.id) === String(id)) || {};
  Object.entries(EM.hoy).forEach(([id, regs]) => {
    const tipos = regs.map(r => ({ t: String(r.tipo || '').toUpperCase(), ms: emTsMs(r.timestamp) || 0, r }));
    const entradas = tipos.filter(x => x.t === 'ENTRADA' || x.t === 'RETORNO_CAMPO' || x.t.includes('ENTRADA_CAMPO'));
    if (!entradas.length) return;
    const ultEntrada = Math.max(...entradas.map(x => x.ms));
    const salioAntes = tipos.some(x => x.t.startsWith('SALIDA') && x.ms > ultEntrada && x.ms < inicio);
    const ent = entradas[0].r;
    // Estado escrito en la ENTRADA por apps sin actualizar (solo si es posterior al inicio del evento)
    const legacyMs = emTsMs(ent.estado_timestamp);
    const legacy = ent.estado && legacyMs >= inicio ? {
      estado: String(ent.estado).startsWith('Requiere') ? 'Requiere ayuda' : 'A salvo',
      comentario: String(ent.estado).includes(' - ') ? String(ent.estado).split(' - ').slice(1).join(' - ') : '',
      ms: legacyMs, origen: 'APP (versión anterior)'
    } : null;
    const e = datosEmp(id);
    porId[id] = { id, nombre: e.nombre || ent.nombre || id, area: e.area || e.departamento || '', telefono: e.telefono || '', foto: e.foto_url || '',
      enPlanta: !salioAntes, salioAntes, modo: String(ent.modo || ''), legacy };
  });
  Object.values(EM.reportes).forEach(r => {
    const id = String(r.empleadoId);
    if (!porId[id]) {
      const e = datosEmp(id);
      porId[id] = { id, nombre: e.nombre || r.nombre || id, area: e.area || '', telefono: e.telefono || '', foto: e.foto_url || '', enPlanta: false, sinMarcacion: true };
    }
  });
  const inicioMs = emInicioMs();
  (EM.visitas || []).forEach(v => {
    const id = 'V-' + v.codigo;
    const salidaMs = v.salidaEn ? Date.parse(v.salidaEn) : 0;
    porId[id] = { id, nombre: v.nombre || 'Visitante', area: `Visitante · ${v.empresa || 'Particular'}`, esVisita: true,
      visitaA: v.anfitrion || '', tipoVisita: v.tipo || '', epp: !!v.epp, enPlanta: true,
      // Salida registrada en portería después del inicio: ya salió de las instalaciones
      legacy: salidaMs && salidaMs >= inicioMs ? { estado: 'A salvo', comentario: 'Salida registrada en portería', ms: salidaMs, origen: 'Portería' } : null };
  });
  return Object.values(porId).map(p => {
    const r = EM.reportes[p.id];
    const rep = r ? { estado: r.estado, comentario: r.comentario || '', ms: Date.parse(r.dispositivo_ts) || 0,
      origen: r.origen === 'PANEL' ? `Supervisor${r.registradoPor ? ' (' + r.registradoPor + ')' : ''}` : 'APP' } : p.legacy;
    return Object.assign(p, { rep });
  }).filter(p => p.enPlanta || p.rep);
}

// 0984660105 / 984660105 / +593 98 466 0105 → 593984660105
function emNumeroWa(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('593') && d.length >= 11) return d;
  if (d.startsWith('0') && d.length === 10) return '593' + d.slice(1);
  if (d.startsWith('9') && d.length === 9) return '593' + d;
  return '';
}

// Foto del colaborador; si no hay o no carga, sus iniciales. Visitantes: ícono de credencial.
function emAvatar(p) {
  if (p.esVisita) return '<div class="em-avatar em-avatar-visita"><i class="fas fa-id-card-alt"></i></div>';
  const ini = String(p.nombre || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const fx = window.fixFotoUrl || window.formatearUrlFoto;
  const src = p.foto ? (fx ? fx(p.foto, 120) : p.foto) : '';
  return `<div class="em-avatar"><span>${escapeHtml(ini)}</span>${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
}

window.cargarEmergenciasSupervisor = async function () {
  if (!emSuscribir()) { mostrarToast('Firestore no está disponible. Recarga la página.', 'error'); return; }
  if (!EM.reloj) EM.reloj = setInterval(() => {
    const panel = document.getElementById('emPanelEnVivo');   // panel del supervisor o toma de lista de la app
    if (!panel || !panel.offsetParent) return;
    if (EM.config && EM.config.activa) emPintarReloj();
    if (Date.now() - EM.visitasTs > 30000 && document.visibilityState === 'visible') emCargarVisitas();
  }, 1000);
  emPintar();
  emCargarVisitas();
};

function emPintarReloj() {
  const el = document.getElementById('emReloj');
  if (el && EM.config && EM.config.inicio) el.textContent = emMinutos(Date.now() - emInicioMs());
  const act = document.getElementById('emUltimaAct');
  if (act && EM.ultimaAct) act.textContent = emHora(EM.ultimaAct);
}

function emPintar() {
  const cont = document.getElementById('emPanelEnVivo');
  if (!cont) return;
  // Si se está escribiendo en un campo del panel, se conserva el foco y el cursor al redibujar
  const act = document.activeElement && cont.contains(document.activeElement) && document.activeElement.id ? document.activeElement : null;
  const foco = act ? { id: act.id, pos: act.selectionStart } : null;
  const em = EM.config;
  if (!em) { cont.innerHTML = '<div class="em-cargando"><i class="fas fa-spinner fa-spin"></i> Conectando en tiempo real…</div>'; return; }
  const personas = emPersonas();
  const ayuda = personas.filter(p => p.rep && p.rep.estado === 'Requiere ayuda');
  const salvo = personas.filter(p => p.rep && p.rep.estado !== 'Requiere ayuda');
  const pendientes = personas.filter(p => !p.rep && p.enPlanta);
  const totalPlanta = personas.filter(p => p.enPlanta).length;
  const visitantes = personas.filter(p => p.esVisita);
  const reportaronPlanta = personas.filter(p => p.enPlanta && p.rep).length;
  const pct = totalPlanta ? Math.round(reportaronPlanta * 100 / totalPlanta) : 0;
  const activa = !!em.activa;
  const huboEvento = activa || em.eventoId;

  const q = (EM.busca || '').trim().toLowerCase();
  const enFiltro = p => EM.filtro === 'todos' ? true : EM.filtro === 'ayuda' ? p.rep && p.rep.estado === 'Requiere ayuda'
    : EM.filtro === 'pendientes' ? !p.rep : EM.filtro === 'salvo' ? p.rep && p.rep.estado !== 'Requiere ayuda'
    : EM.filtro === 'visitantes' ? p.esVisita : true;
  const orden = p => p.rep && p.rep.estado === 'Requiere ayuda' ? 0 : !p.rep ? 1 : 2;
  const lista = personas.filter(p => enFiltro(p) && (!q || `${p.nombre} ${p.area} ${p.id}`.toLowerCase().includes(q)))
    .sort((a, b) => orden(a) - orden(b) || (b.rep ? b.rep.ms : 0) - (a.rep ? a.rep.ms : 0) || a.nombre.localeCompare(b.nombre));

  const tel = p => p.telefono ? `<a class="em-btn em-btn-llamar" href="tel:${escapeHtml(String(p.telefono).replace(/\s+/g, ''))}" onclick="event.stopPropagation()" title="Llamar"><i class="fas fa-phone"></i> Llamar</a>` : '';
  // WhatsApp con un mensaje listo (lo envía quien toma la lista desde su teléfono)
  const wa = p => {
    const num = emNumeroWa(p.telefono);
    if (!num) return '';
    // Nombres en formato APELLIDOS NOMBRES: se saluda por el primer nombre
    const partes = String(p.nombre || '').trim().split(/\s+/);
    const nom = (partes.length >= 3 ? partes[2] : partes[0] || '').toLowerCase().replace(/^./, c => c.toUpperCase());
    const ev = em.nombre || 'la emergencia';
    const msg = p.rep && p.rep.estado === 'Requiere ayuda'
      ? `Hola ${nom}, vimos tu pedido de ayuda en «${ev}». ¿Dónde estás exactamente? Vamos a ayudarte.`
      : `Hola ${nom}, estamos en «${ev}». Por favor reporta tu estado en la app TCONTROL o respóndenos dónde estás.`;
    return `<a class="em-btn em-btn-wa" href="https://wa.me/${num}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Escribir por WhatsApp"><i class="fab fa-whatsapp"></i> WhatsApp</a>`;
  };
  const fila = p => {
    const r = p.rep;
    const ayudaP = r && r.estado === 'Requiere ayuda';
    const badge = !r ? '<span class="em-badge em-badge-pend"><i class="fas fa-hourglass-half"></i> Pendiente</span>'
      : ayudaP ? '<span class="em-badge em-badge-ayuda"><i class="fas fa-exclamation-triangle"></i> Requiere ayuda</span>'
      : '<span class="em-badge em-badge-ok"><i class="fas fa-check"></i> A salvo</span>';
    const extra = [p.esVisita ? `<span class="em-chip em-chip-visita"><i class="fas fa-id-card-alt"></i> Visitante${p.visitaA ? ' · visita a ' + escapeHtml(p.visitaA) : ''}</span>` : '',
      p.esVisita && p.epp ? '<span class="em-chip">Planta (EPP)</span>' : '',
      p.sinMarcacion ? '<span class="em-chip">Sin marcación hoy</span>' : '', p.modo && p.modo !== 'OFICINA' && p.modo !== 'EMPRESA' ? `<span class="em-chip">${escapeHtml(p.modo)}</span>` : ''].join('');
    return `<div class="em-fila ${ayudaP ? 'em-fila-ayuda' : !r ? 'em-fila-pend' : 'em-fila-ok'}">
      ${emAvatar(p)}
      <div class="em-persona"><strong>${escapeHtml(p.nombre)}</strong><small>${escapeHtml(p.area || '—')}${p.esVisita ? '' : ' · ' + escapeHtml(p.id)}</small>${extra ? `<div>${extra}</div>` : ''}</div>
      <div class="em-estado">${badge}${r && r.comentario ? `<div class="em-coment">“${escapeHtml(r.comentario)}”</div>` : ''}</div>
      <div class="em-hora">${r ? `${emHora(r.ms)}<small>${escapeHtml(r.origen)}</small>` : '<small>Sin reporte</small>'}</div>
      <div class="em-acciones">${ayudaP ? tel(p) + wa(p) : ''}${!r && activa ? `<button class="em-btn em-btn-ok" onclick="emMarcarASalvo('${escapeHtml(p.id)}')"><i class="fas fa-check"></i> Marcar a salvo</button>${tel(p)}${wa(p)}` : ''}</div>
    </div>`;
  };
  const chip = (k, t, n) => `<button class="em-filtro ${EM.filtro === k ? 'on' : ''}" onclick="emFiltrar('${k}')">${t} <b>${n}</b></button>`;

  cont.innerHTML = `
    ${activa ? `<div class="em-banner em-banner-activo">
        <div class="em-banner-txt"><span class="em-pulso"></span><div><strong>${escapeHtml(em.nombre || 'Evento en curso')}</strong>
          <small>${em.inicio ? `Iniciado a las ${emHora(emInicioMs())} · en curso <b id="emReloj">${emMinutos(Date.now() - emInicioMs())}</b>` : 'Iniciado hoy (hora de inicio no registrada)'}</small></div></div>
        <button class="em-btn em-btn-fin" onclick="toggleEmergenciaSupervisor(false)"><i class="fas fa-flag-checkered"></i> Finalizar alerta</button>
      </div>`
    : `<div class="em-banner">
        <div class="em-inicio">
          <label for="supEmEventName">Nombre del evento</label>
          <input type="text" id="supEmEventName" value="${escapeHtml(EM.nombreBorrador || ('Simulacro ' + new Date().toLocaleDateString('es-EC')))}" oninput="EM.nombreBorrador=this.value" maxlength="80">
        </div>
        <button class="em-btn em-btn-iniciar" onclick="toggleEmergenciaSupervisor(true)"><i class="fas fa-bullhorn"></i> Iniciar alerta</button>
      </div>
      ${huboEvento ? `<p class="em-nota"><i class="fas fa-history"></i> Último evento: <b>${escapeHtml(em.nombre || '')}</b>${em.inicio ? ` · ${new Date(em.inicio).toLocaleString('es-EC')}` : ''}${em.fin ? ` → ${emHora(Date.parse(em.fin))}` : ''}. Abajo queda su resultado.</p>` : ''}`}
    ${huboEvento ? `
    <div class="em-kpis">
      <button class="em-kpi em-kpi-ayuda ${ayuda.length ? 'alerta' : ''}" onclick="emFiltrar('ayuda')"><span>Requieren ayuda</span><b>${ayuda.length}</b></button>
      <button class="em-kpi em-kpi-pend" onclick="emFiltrar('pendientes')"><span>Pendientes</span><b>${pendientes.length}</b></button>
      <button class="em-kpi em-kpi-ok" onclick="emFiltrar('salvo')"><span>A salvo</span><b>${salvo.length}</b></button>
    </div>
    <div class="em-progreso"><div class="em-progreso-txt"><span><b>${reportaronPlanta} de ${totalPlanta}</b> personas en planta reportaron (${pct}%)${visitantes.length ? ` · incluye <b>${visitantes.length}</b> visitante${visitantes.length === 1 ? '' : 's'}` : ''}</span>
        <span class="em-vivo"><i class="fas fa-circle"></i> En vivo · <span id="emUltimaAct">${emHora(EM.ultimaAct)}</span></span></div>
      <div class="em-barra"><div style="width:${pct}%"></div></div></div>
    <div class="em-herramientas">
      <div class="em-filtros">${chip('todos', 'Todos', personas.length)}${chip('ayuda', 'Ayuda', ayuda.length)}${chip('pendientes', 'Pendientes', pendientes.length)}${chip('salvo', 'A salvo', salvo.length)}${chip('visitantes', 'Visitantes', visitantes.length)}</div>
      <div class="em-buscar"><i class="fas fa-search"></i><input type="search" id="emBuscar" value="${escapeHtml(EM.busca)}" placeholder="Buscar nombre, área o ID" oninput="emBuscar(this.value)"></div>
      <button class="em-btn em-btn-sec" onclick="emExportar()"><i class="fas fa-file-download"></i> Exportar</button>
    </div>
    ${EM.visitasError ? `<p class="em-nota" style="color:#b45309;"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(EM.visitasError)}. Se reintenta solo; si persiste, pide la lista a portería.</p>` : ''}
    <div class="em-lista">${lista.length ? lista.map(fila).join('') : `<div class="em-vacio">${personas.length ? 'Nadie en este filtro.' : 'Aún no hay personas con entrada registrada hoy.'}</div>`}</div>
    <p class="em-nota"><i class="fas fa-info-circle"></i> Pendientes = personas con entrada registrada hoy que aún no reportan. Quien salió antes del inicio no se cuenta.
      Los visitantes dentro de las instalaciones aparecen con la etiqueta «Visitante»: no tienen la app, así que se marcan a salvo en el punto de encuentro (o cuentan como a salvo si portería registra su salida).
      «Marcar a salvo» sirve para el conteo en el punto de encuentro (queda registrado con tu nombre).</p>` : ''}`;
  if (foco) { const i = document.getElementById(foco.id); if (i) { i.focus(); try { i.setSelectionRange(foco.pos, foco.pos); } catch (e) { } } }
}

window.emFiltrar = function (f) { EM.filtro = EM.filtro === f ? 'todos' : f; emPintar(); };
window.emBuscar = function (v) { EM.busca = v; emPintar(); };

window.emMarcarASalvo = async function (empId) {
  const p = emPersonas().find(x => x.id === String(empId));
  if (!p || !confirm(`¿Confirmas que ${p.nombre} está A SALVO (verificado en el punto de encuentro)?`)) return;
  let quien = 'Supervisor';
  try { quien = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').nombre || quien; } catch (e) { }
  if (window.EM_QUIEN) quien = window.EM_QUIEN;   // app: quien toma la lista desde su celular
  try {
    const r = await window.FirebaseBackend.reportarEmergencia({ empleadoId: empId, nombre: p.nombre, estado: 'A salvo',
      comentario: 'Verificado en el punto de encuentro', origen: 'PANEL', registradoPor: quien });
    if (!r || r.error) throw new Error((r && r.error) || 'No se guardó');
    mostrarToast(`${p.nombre}: marcado a salvo`, 'success');
  } catch (e) { mostrarToast('No se pudo registrar: ' + e.message, 'error'); }
};

window.emExportar = function () {
  const em = EM.config || {};
  const filas = [['ID', 'Nombre', 'Tipo', 'Área / empresa', 'Visita a', 'Estado', 'Comentario', 'Hora de reporte', 'Origen', 'En planta']];
  emPersonas().forEach(p => filas.push([p.id, p.nombre, p.esVisita ? 'Visitante' : 'Colaborador', p.area, p.visitaA || '', p.rep ? p.rep.estado : 'Pendiente',
    p.rep ? p.rep.comentario : '', p.rep ? emHora(p.rep.ms) : '', p.rep ? p.rep.origen : '', p.enPlanta ? 'SI' : 'NO']));
  const csv = '﻿' + filas.map(f => f.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${(em.nombre || 'emergencia').replace(/[^\w-]+/g, '_')}_${getLocalHoyStr(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

window.toggleEmergenciaSupervisor = async function (activa) {
  const nombre = (document.getElementById('supEmEventName')?.value || EM.nombreBorrador || '').trim();
  if (activa && !nombre) { mostrarToast('Escribe el nombre del evento o simulacro.', 'warning'); return; }
  if (!window.FirebaseBackend) { mostrarToast('El motor Firebase no está cargado. Recarga la página.', 'error'); return; }
  if (activa && !confirm(`¿Iniciar la alerta «${nombre}»?\n\nTodos los colaboradores verán en la app el aviso para reportar su estado.`)) return;
  if (!activa) {
    const pend = emPersonas().filter(p => !p.rep && p.enPlanta).length;
    if (!confirm(`¿Finalizar la alerta?${pend ? `\n\nAún hay ${pend} persona(s) en planta sin reportar.` : ''}`)) return;
  }
  const btns = document.querySelectorAll('.em-btn-iniciar, .em-btn-fin');
  btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (activa ? 'Iniciando…' : 'Finalizando…'); });
  try {
    let quien = window.EM_QUIEN_ID || '';
    if (!quien) { try { quien = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').id || ''; } catch (e) { } }
    const res = await window.FirebaseBackend.toggleEmergencia({ activa, nombre, empleadoId: quien });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No se guardó');
    mostrarToast(activa ? '🚨 Alerta iniciada: la app ya la muestra a los colaboradores' : '🟢 Alerta finalizada', 'success');
    if (!activa) EM.nombreBorrador = '';
    // El listener de configuracion/emergencia redibuja; por si tarda, se fuerza la lectura
    emSuscribir();
  } catch (e) {
    mostrarToast('No se pudo ' + (activa ? 'iniciar' : 'finalizar') + ' la alerta: ' + e.message, 'error');
    emPintar();
  }
};

// ponytail: Supervisor Multi-date Trabajo en Campo modal, auto-load & overwrite confirmation
let _supDiasCampoState = [];

window.mostrarModalCampoSupervisor = async function (empId = null) {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (!modal) return;

  const selEmp = document.getElementById('supCampoEmpSelect');
  if (selEmp && empCache.length > 0) {
    selEmp.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${e.id})</option>`).join('');
  }

  let targetId = empId;
  if (!targetId && empCache.length > 0) {
    targetId = empCache[0].id;
  }
  if (selEmp && targetId) {
    selEmp.value = targetId;
  }

  const emp = empCache.find(e => e.id === targetId);
  const empNombre = emp ? emp.nombre : (targetId || '');

  document.getElementById('supCampoEmpId').value = targetId || '';
  document.getElementById('supCampoEmpNombreDisplay').value = `${targetId || ''} - ${empNombre}`;
  document.getElementById('supCampoProyectoInput').value = '';

  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  document.getElementById('supCampoFechaInicioInput').value = hoyStr;
  document.getElementById('supCampoFechaFinInput').value = hoyStr;
  document.getElementById('supCampoObservacionesInput').value = '';

  await cargarIngenierosAutorizadoresSupervisor();
  await generarListaDiasCampoSupervisor();
  modal.classList.remove('hidden');
};

window.alCambiarEmpCampoModal = function (newEmpId) {
  const emp = empCache.find(e => e.id === newEmpId);
  document.getElementById('supCampoEmpId').value = newEmpId;
  document.getElementById('supCampoEmpNombreDisplay').value = `${newEmpId} - ${emp ? emp.nombre : newEmpId}`;
  generarListaDiasCampoSupervisor();
};

window.abrirModalCampoSupervisor = function (empId) {
  window.mostrarModalCampoSupervisor(empId);
};

window.cerrarModalCampoSupervisor = function () {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (modal) modal.classList.add('hidden');
};

window.generarListaDiasCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const fIniStr = document.getElementById('supCampoFechaInicioInput')?.value;
  const fFinStr = document.getElementById('supCampoFechaFinInput')?.value;
  const container = document.getElementById('supListaDiasCampoContainer');
  const cntSpan = document.getElementById('supCntDiasCampo');

  if (!container || !fIniStr || !fFinStr) return;

  function parseFechaLocalStr(fStr) {
    if (!fStr) return null;
    const parts = fStr.split('-');
    if (parts.length < 3) return null;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const dIni = parseFechaLocalStr(fIniStr);
  const dFin = parseFechaLocalStr(fFinStr);

  if (!dIni || !dFin || dFin < dIni) {
    container.innerHTML = `<div style="background:#fef3c7; border:1px solid #fde68a; padding:8px 12px; border-radius:6px; font-size:12px; color:#b45309;">Selecciona un rango de fechas válido.</div>`;
    return;
  }

  // Buscar únicamente registros existentes de TRABAJO EN CAMPO (por modo, tipo o razón)
  function esRegistroCampoSup(r) {
    if (!r) return false;
    const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
    const m = String(r.modo || '').toUpperCase();
    const raz = String(r.razon_ausencia || r.razon || r.observaciones || '').toUpperCase();
    return (
      m === 'CAMPO' ||
      t.includes('CAMPO') ||
      t === 'TRABAJO_DE_CAMPO' ||
      t === 'SALIDA_A_CAMPO' ||
      raz.includes('CAMPO') ||
      raz.includes('TRABAJO_DE_CAMPO') ||
      raz.includes('TRABAJO EN CAMPO')
    );
  }

  let regsExistentes = [];
  const empObj = (empCache || []).find(e => e.id === empId);
  if (empObj && Array.isArray(empObj.registros)) {
    empObj.registros.forEach(r => {
      if (esRegistroCampoSup(r)) regsExistentes.push(r);
    });
  }

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (empId && firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('registros').where('empleadoId', '==', empId).get();
      snap.forEach(doc => {
        const d = doc.data();
        if (esRegistroCampoSup(d)) {
          if (!regsExistentes.some(x => x.id === doc.id || (x.fecha === d.fecha && x.tipo === d.tipo))) {
            regsExistentes.push({ id: doc.id, ...d });
          }
        }
      });
    } catch (e) { }
  }

  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const fechas = [];
  let curr = new Date(dIni);

  while (curr <= dFin) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const fStr = `${y}-${m}-${d}`;
    const diaNombre = diasSemana[curr.getDay()];

    const regsFecha = regsExistentes.filter(r => r.fecha === fStr && esRegistroCampoSup(r));
    const regEntrada = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'ENTRADA_CAMPO' || t === 'RETORNO_CAMPO' || (t.includes('ENTRADA') && t.includes('CAMPO')) || t === 'ENTRADA';
    });
    const regSalida = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'SALIDA_CAMPO' || (t.includes('SALIDA') && t.includes('CAMPO')) || t === 'SALIDA';
    });

    const hoyObj = new Date();
    const hoyStr = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;

    const yaExiste = regsFecha.length > 0;
    const hEntrada = regEntrada && regEntrada.hora ? regEntrada.hora.substring(0, 5) : '';
    const hSalida = regSalida && regSalida.hora ? regSalida.hora.substring(0, 5) : '';

    fechas.push({
      fecha: fStr,
      diaNombre: diaNombre,
      isFestivo: (typeof esFeriado === 'function' && esFeriado(fStr)) || curr.getDay() === 0 || curr.getDay() === 6,
      hE: hEntrada,
      hS: hSalida,
      yaExiste: yaExiste,
      docEntradaId: regEntrada ? regEntrada.id : null,
      docSalidaId: regSalida ? regSalida.id : null
    });

    curr.setDate(curr.getDate() + 1);
  }

  // Auto-cargar Proyecto, Observaciones y Autorizado Por si existe algún registro de CAMPO previo en el rango
  const regConInfo = regsExistentes.find(r => {
    if (!r.fecha) return false;
    return r.fecha >= fIniStr && r.fecha <= fFinStr && (r.observaciones || r.razon_ausencia || r.autoriza);
  });

  if (regConInfo) {
    const proyInput = document.getElementById('supCampoProyectoInput');
    const obsInput = document.getElementById('supCampoObservacionesInput');
    const autSelect = document.getElementById('supCampoAutorizadoPorSelect');

    const rawObs = String(regConInfo.observaciones || regConInfo.razon_ausencia || '').trim();
    let projFound = '';
    let obsFound = '';

    const match = rawObs.match(/\[Proyecto:\s*([^\]]+)\]/i);
    if (match) {
      projFound = match[1].trim();
      obsFound = rawObs.replace(match[0], '').trim();
    } else {
      obsFound = rawObs;
    }

    if (proyInput && projFound) proyInput.value = projFound;
    if (obsInput && obsFound && obsFound.toUpperCase() !== 'TRABAJO EN CAMPO') obsInput.value = obsFound;
    if (autSelect && regConInfo.autoriza) {
      autSelect.value = regConInfo.autoriza;
    }
  }

  _supDiasCampoState = fechas;
  if (cntSpan) cntSpan.textContent = `${fechas.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

function calcularTotalesDiaCampo(fechaVal, hEStr, hSStr) {
  if (!hEStr || !hSStr) return { t50: '0h 0m', t100: '0h 0m' };
  function toMins(hStr) {
    const parts = hStr.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  const mE = toMins(hEStr);
  let mS = toMins(hSStr);
  if (mE === null || mS === null) return { t50: '0h 0m', t100: '0h 0m' };
  if (mS < mE) {
    mS += 24 * 60;
  }
  if (mS <= mE) return { t50: '0h 0m', t100: '0h 0m' };

  const minutosBrutos = mS - mE;
  const minutosNetos = Math.max(0, minutosBrutos - 30);

  const parts = fechaVal.split('-');
  const dObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
  const esFestivo = (typeof esFeriado === 'function' && esFeriado(fechaVal)) || dObj.getDay() === 0 || dObj.getDay() === 6;

  let t50 = 0, t100 = 0;
  if (esFestivo) {
    t100 = minutosNetos;
  } else {
    const antes = Math.max(0, 450 - mE);
    const despues = Math.max(0, mS - 975);
    t50 = antes + despues;
  }

  function fmt(m) {
    return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  }
  return { t50: fmt(t50), t100: fmt(t100) };
}
window.calcularTotalesDiaCampo = calcularTotalesDiaCampo;

window.renderListaDiasCampoSupervisorHTML = function () {
  const container = document.getElementById('supListaDiasCampoContainer');
  if (!container) return;

  if (_supDiasCampoState.length === 0) {
    container.innerHTML = `<div style="background:#f1f5f9; padding:8px; border-radius:6px; font-size:12px; text-align:center; color:#64748b;">No hay fechas seleccionadas en el rango.</div>`;
    return;
  }

  container.innerHTML = _supDiasCampoState.map((item, idx) => {
    const totales = calcularTotalesDiaCampo(item.fecha, item.hE, item.hS);
    const bgStyle = item.yaExiste ? '#fff7ed' : '#ffffff';
    const borderStyle = item.yaExiste ? '#fdba74' : '#e2e8f0';

    return `
        <div style="background: ${bgStyle}; border: 1px solid ${borderStyle}; padding: 10px; border-radius: 8px; margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <span style="font-weight:700; font-size:12.5px; color:#1e293b;">${item.fecha} (${item.diaNombre})</span>
              ${item.isFestivo ? '<span style="background:#fef3c7; color:#b45309; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">Festivo / Finde</span>' : ''}
              ${item.yaExiste ? '<span style="background:#ffedd5; color:#c2410c; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">⚠️ Registro existente (Se actualizará)</span>' : ''}
            </div>
            ${_supDiasCampoState.length > 1 ? `<button type="button" onclick="eliminarDiaCampoSupervisor(${idx})" style="background:none; border:none; color:#ef4444; font-weight:700; cursor:pointer; font-size:16px; padding:0 4px;" title="Quitar fecha">&times;</button>` : ''}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">ENTRADA</label>
              <input type="time" class="form-input" value="${item.hE}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">SALIDA</label>
              <input type="time" class="form-input" value="${item.hS}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b45309; display:block;">50%</small>
              <span style="font-weight:800; font-size:12px; color:#d97706;">${totales.t50}</span>
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b91c1c; display:block;">100%</small>
              <span style="font-weight:800; font-size:12px; color:#dc2626;">${totales.t100}</span>
            </div>
          </div>
        </div>
        `;
  }).join('');
};

window.actualizarHorarioDiaCampoSupervisor = function (idx, prop, val) {
  if (_supDiasCampoState[idx]) {
    _supDiasCampoState[idx][prop] = val;
    renderListaDiasCampoSupervisorHTML();
  }
};

window.eliminarDiaCampoSupervisor = function (idx) {
  _supDiasCampoState.splice(idx, 1);
  const cntSpan = document.getElementById('supCntDiasCampo');
  if (cntSpan) cntSpan.textContent = `${_supDiasCampoState.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

window.cargarIngenierosAutorizadoresSupervisor = async function () {
  const select = document.getElementById('supCampoAutorizadoPorSelect');
  if (!select) return;

  select.innerHTML = '<option value="">-- Cargando Autorizadores (Ingeniería)... --</option>';
  let ingenieros = [];

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('empleados').get();
      snap.forEach(doc => {
        const d = doc.data();
        const areaStr = String(d.area || d.cargo || '').toUpperCase().trim();
        const normStr = areaStr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const esActivo = d.activo === 'SI' || d.activo === true || d.activo !== 'NO';
        const esIngenieria = normStr.includes('INGENIERIA') || normStr.includes('INGENIERO') || normStr.includes('ING');

        if (esActivo && esIngenieria) {
          ingenieros.push({ id: doc.id, nombre: d.nombre, area: d.area || d.cargo || 'INGENIERIA' });
        }
      });
    } catch (e) { }
  }

  const unicosMap = new Map();
  ingenieros.forEach(item => {
    if (item.nombre && !unicosMap.has(item.nombre)) {
      unicosMap.set(item.nombre, item);
    }
  });
  const listaFinal = Array.from(unicosMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (listaFinal.length > 0) {
    select.innerHTML = '<option value="">-- Seleccionar Autorizador (Ingeniería) [Opcional] --</option>' +
      listaFinal.map(i => `<option value="${i.nombre}">${i.nombre} (${i.area || 'INGENIERIA'})</option>`).join('');
  } else {
    select.innerHTML = '<option value="">-- Sin personal del área de Ingeniería encontrado --</option>';
  }
};

window.guardarTrabajoEnCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const proyecto = document.getElementById('supCampoProyectoInput')?.value.trim();
  const obs = document.getElementById('supCampoObservacionesInput')?.value.trim();
  const autoriza = document.getElementById('supCampoAutorizadoPorSelect')?.value || '';

  if (!empId) { mostrarToast('ID de empleado no especificado', 'error'); return; }
  if (!_supDiasCampoState || _supDiasCampoState.length === 0) { mostrarToast('No hay fechas seleccionadas en el rango.', 'error'); return; }

  const diasExistentes = _supDiasCampoState.filter(d => d.yaExiste);
  if (diasExistentes.length > 0) {
    const listaFechas = diasExistentes.map(d => `${d.fecha} (${d.diaNombre})`).join('\n• ');
    const confirmar = confirm(`⚠️ ATENCIÓN:\nYa existe(n) registro(s) previo(s) para la(s) fecha(s):\n• ${listaFechas}\n\n¿Deseas SOBREESCRIBIR / ACTUALIZAR estos registros?`);
    if (!confirmar) return;
  }

  const emp = empCache.find(e => e.id === empId);
  const empNombre = emp ? emp.nombre : empId;

  let obsFinal = 'Trabajo en Campo';
  if (proyecto && obs) {
    obsFinal = `[Proyecto: ${proyecto}] ${obs}`;
  } else if (proyecto) {
    obsFinal = `[Proyecto: ${proyecto}] Trabajo en Campo`;
  } else if (obs) {
    obsFinal = obs;
  }

  const btn = document.getElementById('btnGuardarCampoSup');
  if (btn) btn.disabled = true;

  try {
    const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
    if (!firestoreDb || typeof firestoreDb.collection !== 'function') {
      mostrarToast('Base de datos Firebase no disponible', 'error');
      if (btn) btn.disabled = false;
      return;
    }

    let guardadosCount = 0;
    for (const item of _supDiasCampoState) {
      const hE = item.hE ? (item.hE.length === 5 ? item.hE + ':00' : item.hE) : '';
      const hS = item.hS ? (item.hS.length === 5 ? item.hS + ':00' : item.hS) : '';

      if (hE) {
        const hEClean = hE.replace(/:/g, '');
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_${hEClean}`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hE}`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hE,
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      if (hS) {
        const hSClean = hS.replace(/:/g, '');
        const targetSalidaId = item.docSalidaId || `${empId}_SALIDA_CAMPO_${item.fecha}_${hSClean}`;
        const tsSalida = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hS}`));

        const dataSalida = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hS,
          tipo: 'SALIDA_CAMPO',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsSalida,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetSalidaId).set(dataSalida, { merge: true });
      }

      if (!hE && !hS) {
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_080000`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T08:00:00`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: '',
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      guardadosCount++;
    }

    mostrarToast(`✅ Trabajo en Campo guardado/actualizado para ${guardadosCount} día(s)`, 'success');
    cerrarModalCampoSupervisor();

    if (typeof window.cargarResumenGeneral === 'function') {
      window.cargarResumenGeneral();
    }
  } catch (e) {
    mostrarToast('Error al guardar Trabajo en Campo: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};
