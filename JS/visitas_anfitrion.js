/**
 * TCONTROL · Registro de visitas · anfitrión (app → Visitas) y administración (panel → Visitas)
 *
 * El colaborador ve solo sus visitas: aprueba o rechaza las solicitudes, invita (crea la visita y
 * comparte el enlace privado con el visitante), pide almuerzo (flujo de catering existente,
 * crearSolicitudInvitado) y ve la calificación que dejó su visitante. Supervisores admin (rrhh) ven
 * todas, con el resumen de calificaciones.
 * Sesión: el mismo token de PIN que Desempeño (sessionStorage tcontrol_sesion_eval).
 * Datos: PostgREST api.visita_anfitrion (respaldo: Apps Script evalRpc).
 *
 * Quienes reciben copia según el tipo de visita (configuración) la ven en la pestaña "Avisos", sin
 * acciones. En el panel de supervisor, el admin master tiene además la pestaña "Configuración".
 *
 * Las pestañas de lista (Por aprobar, Hoy, Próximas, Historial, Avisos) tienen buscador por visitante, empresa,
 * anfitrión, motivo, tipo o código; en Historial las visitas bien cerradas llevan «Registro completo».
 * La lista muestra los estados con indicadores animados y se actualiza cada minuto; invitar,
 * compartir el enlace y rechazar/cancelar se hacen en una ventana guiada (estilos gv-m-* y va-*).
 *
 * Uso: VisitasAnfitrion.montar(contenedor, { empleado: {id, nombre, area}, admin: bool, config: bool, enlace })
 */
(function () {
  'use strict';
  const KEY_SESION = 'tcontrol_sesion_eval';
  const URL_PUBLICA = (location.origin.includes('localhost') ? location.origin : 'https://asistencia.tcontrolsa.com') + '/visitas.html';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const fechaLarga = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };
  const horaDe = ts => ts ? new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
  // Llamada del guardia al anfitrión (visitante sin cita): resultado, intentos y aviso por el bot
  const TXT_LLAMADA = { viene: 'contestó: venía a recibirlo', espera: 'contestó: pidió que espere', no_contesto: 'no contestó',
    equivocado: 'número equivocado', sin_telefono: 'sin celular registrado' };
  const llamadaTexto = l => `El guardia llamó${l.en ? ' a las ' + horaDe(l.en) : ''}: <b>${esc(TXT_LLAMADA[l.resultado] || l.resultado || 'sin resultado')}</b>` +
    ` · ${l.intentos || 1} intento${(l.intentos || 1) === 1 ? '' : 's'}${l.bot ? ' · aviso por bot ' + horaDe(l.bot) : ''}`;
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');
  const estrellas = n => `<span class="vs-estrellas-mini" aria-label="${n} de 5">${'★'.repeat(Math.round(n || 0))}${'☆'.repeat(5 - Math.round(n || 0))}</span>`;
  const ESTADO_TXT = { invitada: 'Invitación enviada', pendiente: 'Por aprobar', aprobada: 'Aprobada', en_curso: 'En las instalaciones', concluida: 'Concluida', rechazada: 'Rechazada', cancelada: 'Cancelada', no_asistio: 'No asistió' };
  const chip = e => `<span class="vs-estado vs-e-${esc(e)}">${esc(ESTADO_TXT[e] || e)}</span>`;

  function toast(msg, tipo = 'info') {
    if (typeof window.mostrarToast === 'function') return window.mostrarToast(msg, tipo);
    if (typeof window.showToast === 'function') return window.showToast(msg, tipo);
    alert(msg);
  }
  function sesionGuardada(id) {
    try { const s = JSON.parse(sessionStorage.getItem(KEY_SESION) || 'null'); if (s && s.token && String(s.empleadoId) === String(id) && s.exp * 1000 - Date.now() > 5 * 60000) return s; } catch (e) { }
    return null;
  }
  async function iniciarSesion(id, pin) {
    const r = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: String(id), pin: String(pin) });
    if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu PIN.');
    const s = { token: r.token, exp: r.exp, empleadoId: String(id), equipo: r.equipo || [], rrhh: !!r.rrhh, master: !!r.master };
    try { sessionStorage.setItem(KEY_SESION, JSON.stringify(s)); } catch (e) { }
    return s;
  }
  async function rpc(st, p) {
    const fb = window.FirebaseBackend;
    let causa = '';
    for (let i = 0; i < 2; i++) {
      const b = fb && fb._urlHistorico ? await fb._urlHistorico(i > 0) : '';
      if (!b) { causa = 'sin dirección'; continue; }
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const r = await fetch(`${b}/rpc/visita_anfitrion`, { method: 'POST', headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
        if (r.status === 401) { cerrarSesion(st); throw Object.assign(new Error('Tu sesión venció. Ingresa tu PIN de nuevo.'), { sesion: true }); }
        if (r.ok) return await r.json();
        causa = 'HTTP ' + r.status;
      } catch (e) { if (e.sesion) throw e; causa = e.message; } finally { clearTimeout(t); }
    }
    const r = await fb._post({ accion: 'evalRpc', token: st.ses.token, fn: 'visita_anfitrion', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con la base de visitas (' + causa + ')');
    if (r.status === 401) { cerrarSesion(st); throw Object.assign(new Error('Tu sesión venció. Ingresa tu PIN de nuevo.'), { sesion: true }); }
    return r.body;
  }
  function cerrarSesion(st) { try { sessionStorage.removeItem(KEY_SESION); } catch (e) { } st.ses = null; }

  // ---------------------------------------------------------------- vistas
  // Estado de cada visita con indicador animado (mismo lenguaje visual que la portería)
  function estadoHtml(v, hoy) {
    const e = v.estado;
    if (e === 'en_curso') return `<span class="va-est va-est-dentro"><i class="gv-pulso"></i>En las instalaciones${v.entradaEn ? `<small>desde ${horaDe(v.entradaEn)}</small>` : ''}</span>`;
    if (e === 'pendiente') return `<span class="va-est va-est-pendiente"><i class="gv-parpadeo"></i>Por aprobar</span>`;
    if (e === 'invitada') return `<span class="va-est va-est-invitada"><i class="fas fa-hourglass-half va-gira"></i> Esperando sus datos</span>`;
    if (e === 'aprobada' && v.fecha === hoy) return `<span class="va-est va-est-llegar"><i class="fas fa-clock gv-tic"></i> Por llegar</span>`;
    if (e === 'aprobada') return `<span class="va-est va-est-ok"><i class="fas fa-calendar-check"></i> Confirmada</span>`;
    if (e === 'concluida') return `<span class="va-est va-est-fin"><i class="fas fa-check"></i> Concluida${v.salidaEn ? `<small>salió ${horaDe(v.salidaEn)}</small>` : ''}</span>`;
    return `<span class="va-est va-est-no"><i class="fas fa-ban"></i> ${esc(ESTADO_TXT[e] || e)}</span>`;
  }
  function cuando(v, hoy) {
    const m = String(v.fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    let dia = fechaLarga(v.fecha);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]), h = new Date(); h.setHours(0, 0, 0, 0);
      const dif = Math.round((d - h) / 86400000);
      if (v.fecha === hoy) dia = 'Hoy'; else if (dif === 1) dia = 'Mañana'; else if (dif === -1) dia = 'Ayer';
    }
    return dia + (v.hora ? ' · ' + esc(v.hora) : '');
  }
  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
  // Buscador: sin tildes ni mayúsculas
  const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const coincide = (v, q) => !q || normal([v.nombre, v.empresa, v.anfitrion, v.anfitrionNombre, v.motivo, v.tipoNombre, v.codigo, codigoBonito(v.codigo), fechaCorta(v.fecha)].join(' ')).includes(normal(q).trim());

  function pintar(st) {
    const c = st.cont;
    if (!st.ses) {
      c.innerHTML = `<div class="vs-root"><div class="vs-card va-pin">
        <div class="va-pin-icono"><i class="fas fa-lock"></i></div><h3>Confirma tu PIN</h3>
        <p class="vs-muted">Las visitas incluyen datos de personas externas. Ingresa el PIN con el que entras a la app.</p>
        ${st.error ? `<div class="vs-error">${esc(st.error)}</div>` : ''}
        <form data-vs="pin" class="va-pin-form"><input class="vs-input" type="password" inputmode="numeric" maxlength="12" placeholder="PIN" required autocomplete="off">
        <button class="vs-btn vs-btn-prim" type="submit">Continuar</button></form></div></div>`;
      return;
    }
    if (st.cargando && !st.listaTs) {
      c.innerHTML = `<div class="vs-root"><div class="vs-card va-cargando"><div class="sk sk-linea" style="width:40%;height:20px"></div><div class="sk sk-linea" style="width:70%;margin-top:10px"></div></div>
        ${'<div class="va-item va-sk"><span class="sk" style="width:42px;height:42px;border-radius:50%"></span><span style="flex:1"><span class="sk sk-linea" style="width:55%;display:block"></span><span class="sk sk-linea" style="width:35%;display:block;margin-top:8px"></span></span></div>'.repeat(3)}
        <p class="vs-muted" style="text-align:center"><i class="fas fa-spinner fa-spin"></i> Cargando visitas…</p></div>`;
      return;
    }
    const hoy = hoyLocal();
    const yo = String(st.ses.empleadoId);
    // Al redibujar (p. ej. la actualización de cada minuto) el buscador conserva el foco y el cursor
    const enBuscador = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-vs-busca') && c.contains(document.activeElement)
      ? document.activeElement.selectionStart : null;
    // Las copias informativas (otro anfitrión) van solo a "Avisos"; el admin ve todo en las pestañas normales
    const L = st.admin ? st.visitas : st.visitas.filter(v => String(v.anfitrionId) === yo);
    const copias = st.admin ? [] : st.visitas.filter(v => String(v.anfitrionId) !== yo);
    const porFecha = (a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora || '').localeCompare(String(b.hora || ''));
    const grupos = {
      pendientes: L.filter(v => v.estado === 'pendiente').sort(porFecha),
      hoy: L.filter(v => v.fecha === hoy && ['aprobada', 'en_curso', 'invitada'].includes(v.estado) || v.estado === 'en_curso')
        .sort((a, b) => (a.estado === 'en_curso' ? 0 : 1) - (b.estado === 'en_curso' ? 0 : 1) || porFecha(a, b)),
      proximas: L.filter(v => v.fecha > hoy && ['aprobada', 'invitada'].includes(v.estado)).sort(porFecha),
      historial: L.filter(v => ['concluida', 'rechazada', 'cancelada', 'no_asistio'].includes(v.estado)).sort((a, b) => porFecha(b, a)),
      avisos: copias.slice().sort((a, b) => porFecha(b, a))
    };
    const puedeConfig = !!(st.config && st.ses.master);
    if (!grupos[st.tab] && st.tab !== 'resumen' && !(st.tab === 'config' && puedeConfig)) st.tab = grupos.pendientes.length ? 'pendientes' : 'hoy';
    const tabs = [['pendientes', 'Por aprobar'], ['hoy', 'Hoy'], ['proximas', 'Próximas'], ['historial', 'Historial']]
      .concat(copias.length ? [['avisos', 'Avisos']] : [])
      .concat(st.admin ? [['resumen', 'Calificaciones']] : [])
      .concat(puedeConfig ? [['config', '<i class="fas fa-sliders-h"></i> Configuración']] : []);
    const vacio = {
      pendientes: ['fa-check-double', 'Todo al día', 'No tienes solicitudes por aprobar.'],
      hoy: ['fa-calendar-day', 'Sin visitas hoy', 'Cuando invites a alguien para hoy, aparecerá aquí.'],
      proximas: ['fa-calendar-alt', 'Nada programado', 'Toca «Invitar» para agendar una visita.'],
      historial: ['fa-history', 'Sin historial', 'Aún no hay visitas concluidas.'],
      avisos: ['fa-bell-slash', 'Sin avisos', '']
    };
    // Destaca las visitas nuevas o que cambiaron de estado desde la última carga
    const previos = st.estadosPrevios;
    const marca = v => !previos ? '' : !(v.id in previos) ? 'va-nueva' : previos[v.id] !== v.estado ? 'va-cambio' : '';
    let lista;
    if (st.tab === 'resumen') lista = resumenHtml(st);
    else if (st.tab === 'config') lista = configHtml(st);
    else {
      const encontradas = grupos[st.tab].filter(v => coincide(v, st.busca));
      const items = encontradas.map((v, i) => itemHtml(st, v, hoy, marca(v), i)).join('');
      const [ic, t1, t2] = vacio[st.tab];
      const buscador = grupos[st.tab].length ? `<div class="gv-buscar va-buscar"><i class="fas fa-search"></i><input type="search" data-vs-busca value="${esc(st.busca)}"
          placeholder="Buscar visitante, empresa, anfitrión, motivo o código" autocomplete="off" aria-label="Buscar visitas">
          ${st.busca ? `<span class="va-buscar-n">${encontradas.length} de ${grupos[st.tab].length}</span>` : ''}</div>` : '';
      lista = (st.tab === 'avisos' ? '<p class="vs-muted vs-small" style="margin:0 0 10px"><i class="fas fa-info-circle"></i> Visitas de otros anfitriones que te llegan como copia según su tipo (por ejemplo, planta o clientes). Son solo informativas.</p>' : '') + buscador +
        (items || (st.busca && grupos[st.tab].length
          ? `<div class="va-vacio"><i class="fas fa-search"></i><strong>Sin resultados</strong><span>Ninguna visita de esta pestaña coincide con «${esc(st.busca)}».</span></div>`
          : `<div class="va-vacio"><i class="fas ${ic}"></i><strong>${t1}</strong>${t2 ? `<span>${t2}</span>` : ''}</div>`));
    }
    if (st.listaTs) st.estadosPrevios = Object.fromEntries(st.visitas.map(v => [v.id, v.estado]));
    const dentro = L.filter(v => v.estado === 'en_curso').length;
    const kpi = (k, icono, n, txt, cls) => `<button type="button" class="va-kpi ${cls} ${n ? '' : 'va-kpi-cero'} ${st.tab === k && cls !== 'va-kpi-dentro' ? 'on' : ''}" data-tab="${k}"><i class="fas ${icono}"></i><b>${n}</b><span>${txt}</span></button>`;
    c.innerHTML = `<div class="vs-root va-root">
      <div class="vs-card va-hero">
        <div class="va-hero-txt"><h2><i class="fas fa-id-card-alt"></i> ${st.admin ? 'Visitas · todas' : 'Mis visitas'}</h2>
          <p>${st.admin ? 'Visitantes de la empresa y su calificación.' : 'Aprueba solicitudes, invita y sigue a tus visitantes.'}</p></div>
        <button class="vs-btn vs-btn-prim va-invitar" data-vs="invitar"><i class="fas fa-user-plus"></i> Invitar</button>
        <div class="va-kpis">
          ${kpi('pendientes', 'fa-inbox', grupos.pendientes.length, 'por aprobar', 'va-kpi-pend')}
          ${kpi('hoy', 'fa-calendar-day', grupos.hoy.length, 'hoy', 'va-kpi-hoy')}
          ${kpi('hoy', 'fa-door-open', dentro, 'dentro ahora', 'va-kpi-dentro')}
        </div>
        <p class="va-act">${st.cargando ? '<i class="fas fa-spinner fa-spin"></i> Actualizando…' : `<i class="fas fa-circle gv-vivo"></i> Se actualiza sola · ${horaDe(st.listaTs)}`}
          <button class="vs-link" data-vs="recargar" ${st.cargando ? 'disabled' : ''}>Actualizar</button></p>
      </div>
      ${st.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
      <div class="vs-tabs" role="tablist">${tabs.map(([k, t]) => `<button class="vs-tab ${st.tab === k ? 'vs-tab-on' : ''}" data-tab="${k}" role="tab">${t}${grupos[k] && grupos[k].length && !['historial', 'avisos'].includes(k) ? ` <b class="${k === 'pendientes' ? 'va-b-pend' : ''}">${grupos[k].length}</b>` : ''}</button>`).join('')}</div>
      <div class="va-lista">${lista}</div>
      <p class="vs-muted vs-small" style="margin-top:12px"><i class="fas fa-shield-alt"></i> Los datos de los visitantes son confidenciales (LOPDP): úsalos solo para gestionar la visita. Se anonimizan 180 días después de concluida.
      Página para visitantes: <a href="${URL_PUBLICA}" target="_blank" rel="noopener">${URL_PUBLICA.replace(/^https?:\/\//, '')}</a></p></div>`;
    if (enBuscador !== null) {
      const i = c.querySelector('[data-vs-busca]');
      if (i) { i.focus(); try { i.setSelectionRange(enBuscador, enBuscador); } catch (x) { } }
    }
  }

  function itemHtml(st, v, hoy, marca, i) {
    const acciones = [];
    const esCopia = !st.admin && String(v.anfitrionId) !== String(st.ses.empleadoId);
    if (!esCopia && v.estado === 'pendiente') {
      acciones.push(`<button class="vs-btn vs-btn-ok vs-btn-sm" data-vs="aprobar" data-id="${v.id}"><i class="fas fa-check"></i> Aprobar</button>`);
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="rechazar" data-id="${v.id}"><i class="fas fa-times"></i> Rechazar</button>`);
    }
    if (!esCopia && ['aprobada', 'en_curso'].includes(v.estado) && v.fecha >= hoy && !v.almuerzo && (!st.admin || v.anfitrionId === st.ses.empleadoId)) {
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="almuerzo" data-id="${v.id}"><i class="fas fa-utensils"></i> Pedir almuerzo</button>`);
    }
    if (!esCopia && ['invitada', 'pendiente', 'aprobada'].includes(v.estado)) {
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="enlace" data-id="${v.id}" title="Genera un enlace nuevo; el anterior deja de funcionar"><i class="fas fa-share-alt"></i> Enviar enlace</button>`);
      acciones.push(`<button class="vs-btn vs-btn-sm va-btn-suave" data-vs="cancelar" data-id="${v.id}"><i class="fas fa-ban"></i> Cancelar</button>`);
    }
    const contacto = [v.whatsapp ? `<a href="https://wa.me/${esc(String(v.whatsapp).replace(/^0/, '593').replace(/\D/g, ''))}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> ${esc(v.whatsapp)}</a>` : '',
      v.email ? `<a href="mailto:${esc(v.email)}"><i class="far fa-envelope"></i> ${esc(v.email)}</a>` : ''].filter(Boolean).join(' · ');
    const cal = v.calificacion;
    const abierto = st.abiertos.has(v.id);
    const nombre = v.nombre || (v.estado === 'invitada' ? 'Invitado (aún no llena sus datos)' : '—');
    const completo = v.estado === 'concluida' && v.entradaEn && !v.salidaAutomatica;
    return `<div class="va-item va-e-${esc(v.estado)} ${v.estado === 'aprobada' && v.fecha === hoy ? 'va-e-llega' : ''} ${marca}" style="--i:${Math.min(i, 10)}">
      <div class="va-item-cab" data-vs="detalle" data-id="${v.id}" role="button" tabindex="0" aria-expanded="${abierto}">
        <span class="gv-avatar va-avatar">${v.nombre ? esc(iniciales(v.nombre)) : '<i class="fas fa-user-clock"></i>'}</span>
        <span class="va-item-info">
          <strong>${esc(nombre)}</strong>
          <small>${esc(v.empresa || (v.nombre ? 'Particular' : ''))}${st.admin || esCopia ? ` · visita a ${esc(v.anfitrion || v.anfitrionNombre)}` : ''}</small>
          <span class="va-cuando"><i class="far fa-calendar"></i> ${cuando(v, hoy)}${v.motivo ? ` · ${esc(v.motivo)}` : ''}</span>
          <span class="vs-chips">${completo ? '<span class="vs-chip vs-chip-ok"><i class="fas fa-check-circle"></i> Registro completo</span>' : ''}${v.salidaAutomatica ? '<span class="vs-chip vs-chip-alerta"><i class="fas fa-robot"></i> Salida no registrada</span>' : ''}${v.tipoNombre ? `<span class="vs-chip">${esc(v.tipoNombre)}</span>` : ''}${v.epp ? '<span class="vs-chip vs-chip-epp"><i class="fas fa-hard-hat"></i> EPP</span>' : ''}${v.origen === 'porteria' ? '<span class="vs-chip vs-chip-sc">Sin cita</span>' : ''}${v.sinContacto ? '<span class="vs-chip vs-chip-alerta"><i class="fas fa-phone-slash"></i> Ingresó sin contacto</span>' : ''}${v.almuerzo ? '<span class="vs-chip"><i class="fas fa-utensils"></i> Almuerzo</span>' : ''}${esCopia ? '<span class="vs-chip vs-chip-copia"><i class="fas fa-bell"></i> Copia</span>' : ''}</span>
        </span>
        <span class="va-item-der">${estadoHtml(v, hoy)}<i class="fas fa-chevron-down va-flecha"></i></span>
      </div>
      ${abierto ? `<dl class="vs-datos va-detalle">
        <dt>Fecha</dt><dd>${esc(fechaLarga(v.fecha))}${v.hora ? ' · ' + esc(v.hora) : ''}</dd>
        ${v.motivo ? `<dt>Motivo</dt><dd>${esc(v.motivo)}</dd>` : ''}
        ${contacto ? `<dt>Contacto</dt><dd>${contacto}</dd>` : ''}
        <dt>Código</dt><dd><code>${esc(codigoBonito(v.codigo))}</code>${v.origen === 'preregistro' ? ' · <span class="vs-muted">se registró solo</span>' : v.origen === 'porteria' ? ' · <span class="vs-muted">registrado en portería</span>' : ''}</dd>
        ${v.almuerzo ? `<dt>Almuerzo</dt><dd><i class="fas fa-utensils"></i> Solicitado</dd>` : ''}
        ${v.llamada ? `<dt>Portería</dt><dd>${llamadaTexto(v.llamada)}</dd>` : ''}
        ${v.entradaEn ? `<dt>Ingreso</dt><dd>${horaDe(v.entradaEn)}${v.salidaEn ? ' · salida ' + horaDe(v.salidaEn) + (v.salidaAutomatica ? ' <b style="color:#b91c1c">(automática: portería no registró la salida)</b>' : '') : ''}${v.sinContacto ? ' · <b style="color:#b91c1c">sin contacto con el anfitrión</b>' : ''}</dd>` : ''}
        ${completo ? '<dt>Registro</dt><dd><span class="va-ok"><i class="fas fa-check-circle"></i> Entrada y salida registradas correctamente en portería</span></dd>' : v.estado === 'en_curso' ? '<dt>Registro</dt><dd><span class="va-ok"><i class="fas fa-check-circle"></i> Entrada registrada correctamente en portería</span></dd>' : ''}
        ${v.motivoRechazo ? `<dt>Nota</dt><dd>${esc(v.motivoRechazo)}</dd>` : ''}
        ${cal ? `<dt>Calificación</dt><dd>Atención ${estrellas(cal.atencion)} · Puntualidad ${estrellas(cal.puntualidad)} · Instalaciones ${estrellas(cal.instalaciones)}${cal.comentario ? `<div class="vs-muted">"${esc(cal.comentario)}"</div>` : ''}</dd>` : ''}
      </dl>` : ''}
      ${v.estado === 'pendiente' && !esCopia ? '<p class="va-espera"><i class="fas fa-info-circle"></i> Esta persona pidió visitarte. Si apruebas, recibe su código QR para entrar.</p>' : ''}
      ${v.estado === 'invitada' && !esCopia ? '<p class="va-espera va-espera-inv"><i class="fas fa-info-circle"></i> Aún no abre tu enlace o no completa sus datos. Si no le llegó, toca «Enviar enlace».</p>' : ''}
      ${acciones.length ? `<div class="vs-acciones va-acciones">${acciones.join('')}</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- ventana: invitar, compartir enlace y motivo
  const ICONOS_TIPO = { oficina: 'fa-building', planta: 'fa-industry', cliente: 'fa-box-open', proveedor: 'fa-truck' };
  const MOTIVOS = ['Reunión', 'Entrega', 'Retiro de producto', 'Mantenimiento', 'Entrevista', 'Auditoría'];
  const HORAS = ['08:30', '10:00', '11:30', '14:00', '15:30'];
  const PASOS_INV = [['¿Para qué viene?', 'Así avisamos a las áreas que corresponde.'], ['¿Cuándo viene?', 'Elige el día y, si la sabes, la hora.'],
    ['¿A qué viene?', 'El motivo lo verá el guardia. Nombre y empresa son opcionales: los completa el visitante.'], ['Revisa y crea la invitación', 'Toca un dato para corregirlo.']];
  const masDias = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let actual = null;   // el módulo montado más reciente (la ventana y el refresco trabajan con él)
  function modalRaiz() {
    let m = document.getElementById('vaModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'vaModal';
      m.className = 'gv-modal va-modal';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.addEventListener('click', e => { if (!actual) return; if (e.target === m) cerrarModal(actual); else alClicModal(actual, e); });
      m.addEventListener('submit', e => { e.preventDefault(); if (actual) alEnviarModal(actual, e.target); });
      m.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.inv; if (k && actual && actual.m && actual.m.f) actual.m.f[k] = e.target.value; });
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrarModal(st, forzar) {
    const m = st.m;
    if (!forzar && m && m.modo === 'invitar' && m.paso > 1 && !m.enviando && !confirm('¿Descartar la invitación? Se perderán los datos ingresados.')) return;
    if (m && m.enviando) return;
    st.m = null;
    pintarModal(st);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && actual && actual.m) cerrarModal(actual); });

  function compartirHtml(e) {
    const url = `${URL_PUBLICA}#t=${e.token}`;
    const msg = encodeURIComponent(`Hola, te espero en TCONTROL el ${fechaLarga(e.fecha)}${e.hora ? ' a las ' + e.hora : ''}. Completa tu registro y obtén tu código de ingreso aquí (es personal): ${url}`);
    return `<div class="va-compartir">
      <a class="va-comp va-comp-wa" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i><span><strong>Enviar por WhatsApp</strong><small>Elige el chat del visitante</small></span></a>
      <button type="button" class="va-comp" data-vs="copiar" data-url="${esc(url)}"><i class="fas fa-copy"></i><span><strong>Copiar enlace</strong><small>Para pegarlo donde quieras</small></span></button>
      <a class="va-comp" href="mailto:?subject=${encodeURIComponent('Tu visita a TCONTROL')}&body=${msg}"><i class="far fa-envelope"></i><span><strong>Enviar por correo</strong><small>Abre tu aplicación de correo</small></span></a>
    </div>
    <p class="va-nota"><i class="fas fa-lock"></i> El enlace es personal y no se vuelve a mostrar. Si lo pierdes, genera uno nuevo con «Enviar enlace».</p>`;
  }

  function pintarModal(st) {
    const m = st.m;
    const raiz = document.getElementById('vaModal');
    if (!m) { if (raiz) raiz.remove(); document.body.classList.remove('gv-modal-abierto'); return; }
    const el = modalRaiz();
    document.body.classList.add('gv-modal-abierto');
    const x = `<button type="button" class="gv-m-x" data-vs="m-cerrar" aria-label="Cerrar" ${m.enviando ? 'disabled' : ''}>&times;</button>`;
    let cab = '', cuerpo = '', pie = '', esForm = false;
    if (m.modo === 'listo') {
      cab = `<h2>${m.nuevo ? 'Invitación creada' : 'Enlace nuevo'}</h2>`;
      cuerpo = `<div class="gv-m-listo"><div class="gv-m-exito"><i class="fas fa-${m.nuevo ? 'check' : 'link'}"></i></div>
        <p class="gv-m-pregunta">Ahora envíale el enlace</p>
        <p class="vs-muted" style="margin:0 0 16px">Al abrirlo completará sus datos y recibirá su código QR para entrar.</p></div>
        ${compartirHtml(m.enlace)}`;
      pie = `<button type="button" class="vs-btn vs-btn-prim gv-m-prim" data-vs="m-cerrar-ya"><i class="fas fa-check"></i> Listo</button>`;
    } else if (m.modo === 'motivo') {
      const rech = m.accion === 'rechazar';
      esForm = true;
      cab = `<h2>${rech ? 'Rechazar solicitud' : 'Cancelar visita'}</h2>`;
      cuerpo = `<p class="gv-m-pregunta">${rech ? '¿Rechazar' : '¿Cancelar'} la visita de ${esc(m.nombre || 'tu visitante')}?</p>
        <p class="gv-m-ayuda">Puedes dejarle un mensaje (opcional). Le llegará junto con el aviso.</p>
        ${m.error ? `<div class="vs-error">${esc(m.error)}</div>` : ''}
        <div class="gv-m-chips" style="margin-bottom:10px">${(rech ? ['No estaré disponible ese día', 'Por favor, reprograma la visita', 'No corresponde a mi área'] : ['Se reprogramará', 'Ya no es necesaria'])
          .map(t => `<button type="button" class="gv-m-chip" data-vs="m-motivo" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label class="gv-m-campo"><span>Mensaje</span><input data-inv="motivo" maxlength="200" value="${esc(m.f.motivo || '')}" placeholder="Escribe o toca una opción"></label>`;
      pie = `<button type="button" class="vs-btn" data-vs="m-cerrar">Volver</button>
        <button type="submit" class="vs-btn vs-btn-prim gv-m-prim" ${m.enviando ? 'disabled' : ''}>${m.enviando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : `<i class="fas fa-${rech ? 'times' : 'ban'}"></i> ${rech ? 'Rechazar' : 'Cancelar visita'}`}</button>`;
    } else {
      esForm = true;
      const f = m.f, paso = m.paso, t = (st.tipos || []).find(x => x.id === f.tipo);
      const [preg, ayuda] = PASOS_INV[paso - 1];
      cab = `<button type="button" class="gv-m-volver" data-vs="${paso > 1 ? 'm-atras' : 'm-cerrar'}" ${m.enviando ? 'disabled' : ''} aria-label="Atrás"><i class="fas fa-arrow-left"></i></button><h2>Invitar · paso ${paso} de 4</h2>`;
      let campos = '';
      if (paso === 1) {
        campos = st.tipos ? `<div class="gv-m-tipos">${st.tipos.map(x => `<button type="button" class="gv-m-tipo ${f.tipo === x.id ? 'on' : ''}" data-vs="m-tipo" data-id="${esc(x.id)}">
            <i class="fas ${ICONOS_TIPO[x.id] || 'fa-door-open'}"></i><span><strong>${esc(x.nombre)}</strong><small>${esc(x.descripcion || '')}</small></span>${x.epp ? '<em><i class="fas fa-hard-hat"></i> EPP</em>' : ''}</button>`).join('')}</div>`
          : `<div class="gv-m-tipos">${'<div class="sk sk-bloque" style="height:76px;border-radius:16px"></div>'.repeat(4)}</div>`;
      } else if (paso === 2) {
        const dias = [['Hoy', hoyLocal()], ['Mañana', masDias(1)], ['Pasado mañana', masDias(2)]];
        const otro = f.fecha && !dias.some(d => d[1] === f.fecha);
        campos = `<div class="va-dias">${dias.map(([n, d]) => `<button type="button" class="va-dia ${f.fecha === d ? 'on' : ''}" data-vs="m-fecha" data-v="${d}"><strong>${n}</strong><small>${esc(fechaLarga(d))}</small></button>`).join('')}</div>
          <label class="gv-m-campo"><span>Otro día</span><input type="date" data-inv="fecha" min="${hoyLocal()}" value="${otro ? esc(f.fecha) : ''}" class="${otro ? 'va-on' : ''}"></label>
          <label class="gv-m-campo"><span>Hora <small class="vs-muted">(opcional)</small></span><input type="time" data-inv="hora" value="${esc(f.hora || '')}">
            <div class="gv-m-chips">${HORAS.map(h => `<button type="button" class="gv-m-chip ${f.hora === h ? 'on' : ''}" data-vs="m-hora" data-v="${h}">${h}</button>`).join('')}<button type="button" class="gv-m-chip ${f.hora === '' ? 'on' : ''}" data-vs="m-hora" data-v="">Sin hora</button></div></label>`;
        pie = `<button type="submit" class="vs-btn vs-btn-prim gv-m-prim">Siguiente <i class="fas fa-arrow-right"></i></button>`;
      } else if (paso === 3) {
        campos = `<label class="gv-m-campo"><span>Motivo de la visita</span><input data-inv="motivo" maxlength="200" value="${esc(f.motivo || '')}" placeholder="Escribe o toca una opción">
            <div class="gv-m-chips">${MOTIVOS.map(x => `<button type="button" class="gv-m-chip ${f.motivo === x ? 'on' : ''}" data-vs="m-motivo" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div></label>
          <label class="gv-m-campo"><span>Nombre del visitante <small class="vs-muted">(opcional)</small></span><input data-inv="nombre" maxlength="80" value="${esc(f.nombre || '')}" placeholder="Ej.: Juan Pérez"></label>
          <label class="gv-m-campo"><span>Empresa <small class="vs-muted">(opcional)</small></span><input data-inv="empresa" maxlength="80" value="${esc(f.empresa || '')}" placeholder="Nombre de la empresa"></label>`;
        pie = `<button type="submit" class="vs-btn vs-btn-prim gv-m-prim">Siguiente <i class="fas fa-arrow-right"></i></button>`;
      } else {
        const fila = (etq, val, ir) => `<button type="button" class="gv-m-res" data-vs="m-ir" data-paso="${ir}"><span>${etq}</span><strong>${val}</strong><i class="fas fa-pen"></i></button>`;
        campos = `<div class="gv-m-resumen">
            ${fila('Tipo', esc(t ? t.nombre : ''), 1)}${fila('Cuándo', esc(fechaLarga(f.fecha)) + (f.hora ? ' · ' + esc(f.hora) : ''), 2)}
            ${fila('Motivo', esc(f.motivo || ''), 3)}${fila('Visitante', f.nombre ? esc(f.nombre) : '<span class="vs-muted">Lo completa él</span>', 3)}
            ${fila('Empresa', f.empresa ? esc(f.empresa) : '<span class="vs-muted">Lo completa él</span>', 3)}</div>
          ${t && t.epp ? `<div class="vs-epp"><i class="fas fa-hard-hat"></i><span><strong>Visita a planta:</strong> el visitante deberá traer su EPP. Se lo indicamos en su registro.</span></div>` : ''}
          <p class="va-nota"><i class="fas fa-paper-plane"></i> Al crearla te damos un enlace para enviárselo por WhatsApp o correo.</p>`;
        pie = `<button type="submit" class="vs-btn vs-btn-prim gv-m-prim" ${m.enviando ? 'disabled' : ''}>${m.enviando ? '<i class="fas fa-spinner fa-spin"></i> Creando…' : '<i class="fas fa-paper-plane"></i> Crear invitación'}</button>`;
      }
      cuerpo = `<div class="gv-m-progreso">${[1, 2, 3, 4].map(n => `<span class="${n < paso ? 'hecho' : n === paso ? 'actual' : ''}"></span>`).join('')}</div>
        <p class="gv-m-pregunta">${preg}</p><p class="gv-m-ayuda">${ayuda}</p>
        ${m.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(m.error)}</div>` : ''}${campos}`;
    }
    el.innerHTML = `<${esForm ? 'form novalidate autocomplete="off"' : 'div'} class="gv-m-caja va-m-${m.modo}">
      <div class="gv-m-cab">${cab}${x}</div><div class="gv-m-cuerpo">${cuerpo}</div>${pie ? `<div class="gv-m-pie">${pie}</div>` : ''}</${esForm ? 'form' : 'div'}>`;
  }

  function errorPasoInv(st, paso) {
    const f = st.m.f;
    if (paso >= 1 && !f.tipo) return 'Elige para qué viene el visitante.';
    if (paso >= 2 && (!f.fecha || f.fecha < hoyLocal())) return 'Elige el día de la visita.';
    if (paso >= 3 && String(f.motivo || '').trim().length < 3) return 'Escribe el motivo o toca una de las opciones.';
    return '';
  }
  function irPasoInv(st, paso) {
    const m = st.m;
    const err = paso > m.paso ? errorPasoInv(st, paso - 1) : '';
    if (err) { m.error = err; return pintarModal(st); }
    m.paso = paso; m.error = '';
    pintarModal(st);
    const raiz = document.getElementById('vaModal');
    const foco = paso === 3 && raiz && raiz.querySelector('[data-inv="motivo"]');
    if (foco && !m.f.motivo) foco.focus();
  }
  async function alEnviarModal(st, form) {
    const m = st.m;
    if (!m || m.enviando) return;
    if (m.modo === 'motivo') {
      m.enviando = true; pintarModal(st);
      const r = await accion(st, m.accion, m.id, { motivo: m.f.motivo || '' });
      m.enviando = false;
      if (r) { toast(m.accion === 'rechazar' ? 'Visita rechazada' : 'Visita cancelada', 'success'); st.m = null; pintarModal(st); pintar(st); }
      else pintarModal(st);
      return;
    }
    if (m.modo !== 'invitar') return;
    if (m.paso < 4) return irPasoInv(st, m.paso + 1);
    const err = errorPasoInv(st, 3);
    if (err) { m.error = err; return pintarModal(st); }
    m.enviando = true; m.error = ''; pintarModal(st);
    try {
      const f = m.f;
      const r = await rpc(st, { accion: 'invitar', anfitrionNombre: st.emp.nombre, tipo: f.tipo, fecha: f.fecha, hora: f.hora || '', motivo: f.motivo.trim(), nombre: (f.nombre || '').trim(), empresa: (f.empresa || '').trim() });
      if (!r.ok) throw new Error(r.error);
      st.visitas.unshift(r.visita);
      st.tab = r.visita.fecha === hoyLocal() ? 'hoy' : 'proximas';
      st.m = { modo: 'listo', nuevo: true, enlace: { id: r.visita.id, token: r.token, fecha: r.visita.fecha, hora: r.visita.hora } };
      pintar(st);
    } catch (x) { m.enviando = false; m.error = x.message; }
    pintarModal(st);
  }
  async function alClicModal(st, e) {
    const b = e.target.closest('[data-vs]');
    if (!b || !st.m) return;
    const a = b.dataset.vs, m = st.m;
    const raiz = document.getElementById('vaModal');
    if (a === 'm-cerrar') return cerrarModal(st);
    if (a === 'm-cerrar-ya') return cerrarModal(st, true);
    if (a === 'copiar') { try { await navigator.clipboard.writeText(b.dataset.url); toast('Enlace copiado', 'success'); } catch (x) { prompt('Copia el enlace:', b.dataset.url); } return; }
    if (a === 'm-atras') { m.paso = Math.max(1, m.paso - 1); m.error = ''; return pintarModal(st); }
    if (a === 'm-ir') { m.paso = Number(b.dataset.paso); m.error = ''; return pintarModal(st); }
    if (a === 'm-tipo') { m.f.tipo = b.dataset.id; return irPasoInv(st, 2); }
    if (a === 'm-fecha') { m.f.fecha = b.dataset.v; m.error = ''; return pintarModal(st); }
    if (a === 'm-hora' || a === 'm-motivo') {
      const k = a === 'm-hora' ? 'hora' : 'motivo';
      m.f[k] = b.dataset.v;
      const i = raiz && raiz.querySelector(`[data-inv="${k}"]`); if (i) i.value = b.dataset.v;
      b.parentNode.querySelectorAll('.gv-m-chip').forEach(c => c.classList.toggle('on', c === b));
    }
  }

  function resumenHtml(st) {
    const conCal = st.visitas.filter(v => v.calificacion);
    const prom = k => conCal.length ? conCal.reduce((s, v) => s + Number(v.calificacion[k] || 0), 0) / conCal.length : 0;
    const mes = hoyLocal().slice(0, 7);
    const delMes = st.visitas.filter(v => String(v.fecha).slice(0, 7) === mes);
    const porAnf = {};
    conCal.forEach(v => { const k = v.anfitrionNombre || v.anfitrionId; (porAnf[k] = porAnf[k] || []).push(v); });
    return `<div class="vs-kpis">
        <div class="vs-kpi"><span>Visitas del mes</span><strong>${delMes.length}</strong></div>
        <div class="vs-kpi"><span>En las instalaciones</span><strong>${st.visitas.filter(v => v.estado === 'en_curso').length}</strong></div>
        <div class="vs-kpi"><span>Atención</span><strong>${prom('atencion').toFixed(1)}</strong> ${estrellas(prom('atencion'))}</div>
        <div class="vs-kpi"><span>Puntualidad</span><strong>${prom('puntualidad').toFixed(1)}</strong> ${estrellas(prom('puntualidad'))}</div>
        <div class="vs-kpi"><span>Instalaciones</span><strong>${prom('instalaciones').toFixed(1)}</strong> ${estrellas(prom('instalaciones'))}</div>
        <div class="vs-kpi"><span>Calificadas</span><strong>${conCal.length}</strong><span>de ${st.visitas.filter(v => v.estado === 'concluida').length} concluidas</span></div></div>
      <div class="vs-card"><h3 class="vs-h2"><i class="fas fa-comments"></i> Calificaciones recientes</h3>
        <div class="vs-tabla-wrap"><table class="vs-tabla"><thead><tr><th>Fecha</th><th>Visitante</th><th>Anfitrión</th><th>Atención</th><th>Puntualidad</th><th>Instalaciones</th><th>Comentario</th></tr></thead>
        <tbody>${conCal.slice(0, 50).map(v => `<tr><td>${fechaCorta(v.fecha)}</td><td>${esc(v.nombre)}<div class="vs-muted vs-small">${esc(v.empresa || '')}</div></td><td>${esc(v.anfitrionNombre || '')}</td>
          <td>${estrellas(v.calificacion.atencion)}</td><td>${estrellas(v.calificacion.puntualidad)}</td><td>${estrellas(v.calificacion.instalaciones)}</td><td>${esc(v.calificacion.comentario || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vs-muted">Sin calificaciones todavía.</td></tr>'}</tbody></table></div></div>`;
  }

  // ---------------------------------------------------------------- configuración (admin master)
  const CAMPOS_NUM = [
    ['porteriaMinutos', 'Duración del QR de portería', 'minutos', 'Tiempo que sirve el QR que muestra el guardia a los visitantes sin cita.'],
    ['porteriaUsos', 'Registros por QR de portería', 'registros', 'Máximo de visitantes que pueden registrarse con un mismo QR.'],
    ['diasPreregistro', 'Anticipación del pre-registro', 'días', 'Hasta cuántos días adelante puede registrarse un visitante por su cuenta.'],
    ['diasInvitacion', 'Anticipación de invitaciones', 'días', 'Hasta cuántos días adelante puede invitar un anfitrión.'],
    ['pendientesMax', 'Solicitudes pendientes por anfitrión', 'solicitudes', 'Si un anfitrión acumula más, la página pide contactarlo directamente.'],
    ['diasAnonimizar', 'Anonimizar visitas concluidas a los', 'días', 'Plazo de conservación (LOPDP). Después se borran nombre, empresa, motivo, contacto y comentario.']
  ];
  function configHtml(st) {
    const c = st.cfg;
    if (st.cfgError && !c) return `<div class="vs-error">${esc(st.cfgError)}</div>`;
    if (!c) return '<div class="vs-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando configuración…</div>';
    const nombre = id => st.cfgEmpleados[id] ? esc(st.cfgEmpleados[id]) : '<span style="color:#b91c1c">no encontrado</span>';
    return `<form class="vs-card vs-config" data-vs="form-config" autocomplete="off">
      <h3 class="vs-h2"><i class="fas fa-sliders-h"></i> Configuración de visitas</h3>
      <p class="vs-muted" style="margin-top:-6px">Solo el administrador principal ve esta sección. Los cambios aplican a las visitas nuevas.${st.cfgActualizado ? ` Última modificación: ${new Date(st.cfgActualizado.en).toLocaleString('es-EC')} por ${esc(st.cfgActualizado.por)}.` : ''}</p>
      ${st.cfgError ? `<div class="vs-error">${esc(st.cfgError)}</div>` : ''}
      <h4 class="vs-config-h"><i class="fas fa-tags"></i> Tipos de visita y a quién se avisa</h4>
      <p class="vs-muted vs-small">El anfitrión siempre recibe los avisos. Aquí defines quién más recibe una copia (IDs de colaborador separados por coma).
        Si el anfitrión es opcional, el primero de la lista atiende la visita cuando el visitante no elige a nadie.</p>
      ${c.tipos.map((t, i) => `<div class="vs-config-tipo" data-i="${i}">
        <div class="vs-fila"><label class="vs-campo"><span>Nombre</span><input data-cfg="nombre" maxlength="40" value="${esc(t.nombre)}"></label>
          <label class="vs-campo"><span>Identificador</span><input data-cfg="id" maxlength="20" value="${esc(t.id)}" ${t._nuevo ? '' : 'readonly title="No se cambia para no perder las visitas anteriores"'}></label></div>
        <label class="vs-campo"><span>Descripción para el visitante</span><input data-cfg="descripcion" maxlength="120" value="${esc(t.descripcion || '')}"></label>
        <label class="vs-campo"><span>Avisar también a (IDs)</span><input data-cfg="notificar" value="${esc((t.notificar || []).join(', '))}" placeholder="Ej.: 1000, 29">
          <small class="vs-muted">${(t.notificar || []).map(id => `${esc(id)} · ${nombre(id)}`).join(' — ') || 'Sin copias'}</small></label>
        <div class="vs-config-checks">
          <label class="vs-check"><input type="checkbox" data-cfg="epp" ${t.epp ? 'checked' : ''}><span>EPP obligatorio</span></label>
          <label class="vs-check"><input type="checkbox" data-cfg="anfitrionOpcional" ${t.anfitrionOpcional ? 'checked' : ''}><span>Anfitrión opcional</span></label>
          <label class="vs-check"><input type="checkbox" data-cfg="activo" ${t.activo !== false ? 'checked' : ''}><span>Activo</span></label>
          ${t._nuevo ? `<button type="button" class="vs-link" data-vs="cfg-quitar" data-i="${i}">Quitar</button>` : ''}
        </div></div>`).join('')}
      <button type="button" class="vs-btn vs-btn-sm" data-vs="cfg-agregar"><i class="fas fa-plus"></i> Agregar tipo</button>
      <h4 class="vs-config-h"><i class="fas fa-hard-hat"></i> Equipo de protección (EPP)</h4>
      <label class="vs-campo"><span>Texto que ven el visitante y el guardia</span><textarea data-cfg-g="eppTexto" rows="2" maxlength="300">${esc(c.eppTexto)}</textarea></label>
      <h4 class="vs-config-h"><i class="fas fa-stopwatch"></i> Plazos y límites</h4>
      <div class="vs-config-nums">${CAMPOS_NUM.map(([k, t, u, ayuda]) => `<label class="vs-campo"><span>${t}</span>
        <div class="vs-config-num"><input type="number" data-cfg-g="${k}" value="${esc(c[k])}" min="1"><em>${u}</em></div><small class="vs-muted">${ayuda}</small></label>`).join('')}</div>
      <h4 class="vs-config-h"><i class="fas fa-bell"></i> Avisos y privacidad</h4>
      <label class="vs-check"><input type="checkbox" data-cfg-g="whatsappCopias" ${c.whatsappCopias !== false ? 'checked' : ''}><span>Enviar también por WhatsApp las copias (si no, solo llegan a la campana de la app)</span></label>
      <label class="vs-campo"><span>Correo para derechos de protección de datos</span><input type="email" data-cfg-g="contactoDatos" maxlength="120" value="${esc(c.contactoDatos)}"></label>
      <div class="vs-acciones" style="margin-top:6px">
        <button type="button" class="vs-btn" data-vs="cfg-recargar"><i class="fas fa-undo"></i> Descartar cambios</button>
        <button type="submit" class="vs-btn vs-btn-prim" ${st.cfgGuardando ? 'disabled' : ''}>${st.cfgGuardando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : '<i class="fas fa-save"></i> Guardar configuración'}</button></div>
    </form>`;
  }
  async function cargarConfig(st) {
    st.cfg = null; st.cfgError = ''; pintar(st);
    try {
      const r = await rpc(st, { accion: 'config' });
      if (!r.ok) throw new Error(r.error);
      st.cfg = r.cfg; st.cfgEmpleados = r.empleados || {}; st.cfgActualizado = r.actualizado || null;
    } catch (e) { st.cfgError = e.message; }
    pintar(st);
  }
  // Lee el formulario a st.cfg (para no perder lo escrito al redibujar)
  function leerConfig(st, form) {
    form.querySelectorAll('.vs-config-tipo').forEach(div => {
      const t = st.cfg.tipos[Number(div.dataset.i)];
      div.querySelectorAll('[data-cfg]').forEach(el => {
        const k = el.dataset.cfg;
        if (el.type === 'checkbox') t[k] = el.checked;
        else if (k === 'notificar') t.notificar = el.value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
        else if (k === 'id') t.id = el.value.trim().toLowerCase();
        else t[k] = el.value;
      });
    });
    form.querySelectorAll('[data-cfg-g]').forEach(el => {
      const k = el.dataset.cfgG;
      st.cfg[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    });
  }
  async function guardarConfig(st, form) {
    leerConfig(st, form);
    st.cfgGuardando = true; st.cfgError = ''; pintar(st);
    try {
      const cfg = JSON.parse(JSON.stringify(st.cfg));
      cfg.tipos.forEach(t => delete t._nuevo);
      const r = await rpc(st, { accion: 'config_guardar', cfg });
      if (!r.ok) throw new Error(r.error);
      toast('Configuración de visitas guardada', 'success');
      st.cfgGuardando = false;
      st.tipos = null;
      return cargarConfig(st);
    } catch (e) { st.cfgError = e.message; }
    st.cfgGuardando = false; pintar(st);
    const err = st.cont.querySelector('.vs-config .vs-error'); if (err) err.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function cargarTipos(st) {
    if (st.tipos) return;
    try { const r = await rpc(st, { accion: 'tipos' }); if (r.ok) st.tipos = r.tipos; } catch (e) { }
    // (la ventana de invitar se redibuja al terminar)
  }

  // ---------------------------------------------------------------- acciones
  async function cargar(st, silencioso) {
    if (st.cargandoP) return st.cargandoP;
    st.cargando = true; if (!silencioso || !st.listaTs) pintar(st); else pintarEstadoAct(st);
    st.cargandoP = (async () => {
      try {
        const r = await rpc(st, { accion: 'listar', modo: st.admin ? 'todas' : 'mias' });
        if (!r.ok) throw new Error(r.error);
        st.visitas = r.visitas || []; st.error = ''; st.listaTs = Date.now();
      } catch (e) { st.error = e.message; }
      st.cargando = false; st.cargandoP = null;
      // No redibuja la lista si el usuario está escribiendo en la configuración
      if (!(silencioso && st.tab === 'config')) pintar(st); else pintarEstadoAct(st);
      if (st.enlaceAbrir) { const v = st.visitas.find(x => String(x.id) === String(st.enlaceAbrir.id)); st.enlaceAbrir = null; if (v) { st.tab = v.estado === 'pendiente' ? 'pendientes' : st.tab; st.abiertos.add(v.id); pintar(st); } }
    })();
    return st.cargandoP;
  }
  function pintarEstadoAct(st) {
    const p = st.cont.querySelector('.va-act');
    if (p) p.innerHTML = `${st.cargando ? '<i class="fas fa-spinner fa-spin"></i> Actualizando…' : `<i class="fas fa-circle gv-vivo"></i> Se actualiza sola · ${horaDe(st.listaTs)}`} <button class="vs-link" data-vs="recargar" ${st.cargando ? 'disabled' : ''}>Actualizar</button>`;
  }
  async function accion(st, a, id, extra) {
    try {
      const r = await rpc(st, Object.assign({ accion: a, id }, extra || {}));
      if (!r.ok) throw new Error(r.error);
      st.visitas = st.visitas.map(v => v.id === r.visita.id ? r.visita : v);
      return r;
    } catch (e) { toast(e.message, 'error'); return null; }
  }
  async function pedirAlmuerzo(st, v) {
    if (!confirm(`¿Pedir almuerzo para ${v.nombre || 'tu visitante'} el ${fechaLarga(v.fecha)}? Se registra en Catering.`)) return;
    // Flujo de catering existente (Apps Script crearSolicitudInvitado), con datos mínimos
    if (typeof window.jsonpRequest === 'function') {
      try {
        const res = await window.jsonpRequest({ accion: 'crearSolicitudInvitado', empleadoId: st.emp.id, empleadoNombre: st.emp.nombre, empleadoArea: st.emp.area || '',
          fecha: v.fecha, tipoSolicitud: 'ALMUERZO_EXTRA', subtipo: 'ALMUERZO_EXTRA', cantidad: 1, invitado: v.nombre || 'Visitante', empresa: v.empresa || 'Visita',
          horaServicio: '', observaciones: `Visita ${codigoBonito(v.codigo)}` });
        if (res && res.ok === false) throw new Error(res.error || 'Catering no registró la solicitud');
      } catch (e) { return toast('No se pudo registrar en Catering: ' + (e.message || e), 'error'); }
    }
    const r = await accion(st, 'almuerzo', v.id);
    if (r) { toast('Almuerzo solicitado', 'success'); pintar(st); }
  }

  // La lista se mantiene al día mientras está a la vista (cada minuto)
  setInterval(() => {
    const st = actual;
    if (!st || !st.ses || st.m || st.cargando || !st.cont.isConnected || !st.cont.offsetParent || document.visibilityState !== 'visible') return;
    if (st.tab === 'config' || st.tab === 'resumen') return;
    cargar(st, true);
  }, 60 * 1000);

  function montar(cont, opts) {
    const emp = opts.empleado || {};
    const st = { cont, emp, admin: !!opts.admin, config: !!opts.config, ses: sesionGuardada(emp.id), visitas: [], tab: '', busca: '', error: '', cargando: false, listaTs: 0, enlaceAbrir: opts.enlace || null,
      abiertos: new Set(), estadosPrevios: null, m: null, tipos: null, cfg: null, cfgEmpleados: {}, cfgError: '', cfgGuardando: false };
    if (st.admin && st.ses && !st.ses.rrhh) st.admin = false;
    if (actual && actual.m) { actual.m = null; pintarModal(actual); }
    actual = st;
    cont.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.dataset.vs === 'pin') {
        const b = f.querySelector('button'); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try { st.ses = await iniciarSesion(emp.id, f.querySelector('input').value.trim()); st.error = ''; if (st.admin && !st.ses.rrhh) st.admin = false; await cargar(st); }
        catch (x) { st.error = x.message; pintar(st); }
      }
      if (f.dataset.vs === 'form-config') return guardarConfig(st, f);
    });
    const alClic = async e => {
      const b = e.target.closest('[data-vs],[data-tab]');
      if (!b || !cont.contains(b)) return;
      actual = st;
      if (b.dataset.tab) { st.tab = b.dataset.tab; if (st.tab === 'config' && !st.cfg) return cargarConfig(st); return pintar(st); }
      const a = b.dataset.vs, id = Number(b.dataset.id);
      const v = st.visitas.find(x => x.id === id);
      if (a === 'invitar') { st.m = { modo: 'invitar', paso: 1, f: { fecha: hoyLocal(), hora: '' } }; pintarModal(st); if (!st.tipos) { await cargarTipos(st); if (st.m && st.m.modo === 'invitar') pintarModal(st); } return; }
      if (a === 'cfg-agregar' || a === 'cfg-quitar') {
        const form = cont.querySelector('[data-vs="form-config"]'); if (form) leerConfig(st, form);
        if (a === 'cfg-agregar') st.cfg.tipos.push({ id: '', nombre: '', descripcion: '', epp: false, anfitrionOpcional: false, activo: true, notificar: [], _nuevo: true });
        else st.cfg.tipos.splice(Number(b.dataset.i), 1);
        return pintar(st);
      }
      if (a === 'cfg-recargar') return cargarConfig(st);
      if (a === 'recargar') return cargar(st, true);
      if (!v) return;
      if (a === 'detalle') {
        if (e.target.closest('a')) return;
        if (st.abiertos.has(id)) st.abiertos.delete(id); else st.abiertos.add(id);
        return pintar(st);
      }
      if (a === 'aprobar') {
        b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aprobando…';
        if (await accion(st, 'aprobar', id)) toast('Visita aprobada. El visitante ya tiene su código QR.', 'success');
        return pintar(st);
      }
      if (a === 'rechazar' || a === 'cancelar') { st.m = { modo: 'motivo', accion: a, id, nombre: v.nombre, f: {} }; return pintarModal(st); }
      if (a === 'almuerzo') return pedirAlmuerzo(st, v);
      if (a === 'enlace') {
        if (!confirm('Se generará un enlace nuevo para el visitante y el anterior dejará de funcionar. ¿Continuar?')) return;
        b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…';
        const r = await accion(st, 'enlace', id);
        if (r) { st.m = { modo: 'listo', nuevo: false, enlace: { id, token: r.token, fecha: v.fecha, hora: v.hora } }; pintarModal(st); }
        return pintar(st);
      }
    };
    cont.addEventListener('click', alClic);
    cont.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.va-item-cab')) { e.preventDefault(); alClic(e); } });
    // Buscador: filtra al escribir (pintar devuelve el foco y el cursor al campo)
    cont.addEventListener('input', e => {
      if (!e.target.hasAttribute('data-vs-busca')) return;
      st.busca = e.target.value;
      pintar(st);
    });
    if (st.ses) cargar(st); else pintar(st);
    cont._vs = st;
    return st;
  }

  window.VisitasAnfitrion = { montar };
})();
