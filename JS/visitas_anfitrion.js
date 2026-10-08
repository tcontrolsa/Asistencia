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
  function pintar(st) {
    const c = st.cont;
    if (!st.ses) {
      c.innerHTML = `<div class="vs-root"><div class="vs-card" style="text-align:center">
        <i class="fas fa-lock fa-2x" style="color:#dc2626"></i><h3 style="margin:10px 0 4px">Confirma tu PIN</h3>
        <p class="vs-muted">Las visitas incluyen datos de personas externas. Ingresa el PIN con el que entras a la app.</p>
        ${st.error ? `<div class="vs-error">${esc(st.error)}</div>` : ''}
        <form data-vs="pin" style="display:flex;gap:8px;max-width:320px;margin:10px auto 0"><input class="vs-input" type="password" inputmode="numeric" maxlength="12" placeholder="PIN" required>
        <button class="vs-btn vs-btn-prim" type="submit">Continuar</button></form></div></div>`;
      return;
    }
    if (st.cargando) { c.innerHTML = '<div class="vs-root"><div class="vs-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando visitas…</div></div>'; return; }
    if (st.invitando) { c.innerHTML = `<div class="vs-root">${invitarHtml(st)}</div>`; return; }
    const hoy = hoyLocal();
    const yo = String(st.ses.empleadoId);
    // Las copias informativas (otro anfitrión) van solo a "Avisos"; el admin ve todo en las pestañas normales
    const L = st.admin ? st.visitas : st.visitas.filter(v => String(v.anfitrionId) === yo);
    const copias = st.admin ? [] : st.visitas.filter(v => String(v.anfitrionId) !== yo);
    const grupos = {
      pendientes: L.filter(v => v.estado === 'pendiente'),
      hoy: L.filter(v => v.fecha === hoy && ['aprobada', 'en_curso', 'invitada'].includes(v.estado) || v.estado === 'en_curso'),
      proximas: L.filter(v => v.fecha > hoy && ['aprobada', 'invitada'].includes(v.estado)),
      historial: L.filter(v => ['concluida', 'rechazada', 'cancelada', 'no_asistio'].includes(v.estado)),
      avisos: copias.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    };
    const puedeConfig = !!(st.config && st.ses.master);
    if (!grupos[st.tab] && st.tab !== 'resumen' && !(st.tab === 'config' && puedeConfig)) st.tab = grupos.pendientes.length ? 'pendientes' : 'hoy';
    const tabs = [['pendientes', 'Por aprobar'], ['hoy', 'Hoy'], ['proximas', 'Próximas'], ['historial', 'Historial']]
      .concat(copias.length ? [['avisos', 'Avisos']] : [])
      .concat(st.admin ? [['resumen', 'Calificaciones']] : [])
      .concat(puedeConfig ? [['config', '<i class="fas fa-sliders-h"></i> Configuración']] : []);
    const vacio = { pendientes: 'No tienes solicitudes por aprobar.', hoy: 'No hay visitas para hoy.', proximas: 'No hay visitas programadas.', historial: 'Aún no hay visitas concluidas.', avisos: 'Sin avisos.' };
    const lista = st.tab === 'resumen' ? resumenHtml(st) : st.tab === 'config' ? configHtml(st)
      : (st.tab === 'avisos' ? '<p class="vs-muted vs-small" style="margin:0 0 10px"><i class="fas fa-info-circle"></i> Visitas de otros anfitriones que te llegan como copia según su tipo (por ejemplo, planta o clientes). Son solo informativas.</p>' : '') +
        (grupos[st.tab].map(v => itemHtml(st, v)).join('') || `<p class="vs-muted" style="text-align:center;padding:18px">${vacio[st.tab]}</p>`);
    c.innerHTML = `<div class="vs-root">
      <div class="vs-card vs-hero" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 class="vs-h2" style="margin:0 0 4px"><i class="fas fa-id-card-alt"></i> ${st.admin ? 'Visitas · todas' : 'Mis visitas'}</h2>
        <p class="vs-muted" style="margin:0">${st.admin ? 'Visitantes de la empresa y su calificación.' : 'Aprueba solicitudes, invita y coordina a tus visitantes.'}</p></div>
        <div class="vs-acciones" style="flex:0 0 auto"><button class="vs-btn vs-btn-prim" data-vs="invitar"><i class="fas fa-user-plus"></i> Invitar</button>
        <button class="vs-btn" data-vs="recargar" title="Actualizar"><i class="fas fa-sync-alt"></i></button></div></div>
      ${st.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
      <div class="vs-tabs" role="tablist">${tabs.map(([k, t]) => `<button class="vs-tab ${st.tab === k ? 'vs-tab-on' : ''}" data-tab="${k}" role="tab">${t}${grupos[k] && grupos[k].length && !['historial', 'avisos'].includes(k) ? ` <b>${grupos[k].length}</b>` : ''}</button>`).join('')}</div>
      ${lista}
      <p class="vs-muted vs-small" style="margin-top:12px"><i class="fas fa-shield-alt"></i> Los datos de los visitantes son confidenciales (LOPDP): úsalos solo para gestionar la visita. Se anonimizan 180 días después de concluida.
      Página para visitantes: <a href="${URL_PUBLICA}" target="_blank" rel="noopener">${URL_PUBLICA.replace(/^https?:\/\//, '')}</a></p></div>`;
  }

  function itemHtml(st, v) {
    const hoy = hoyLocal();
    const acciones = [];
    const esCopia = !st.admin && String(v.anfitrionId) !== String(st.ses.empleadoId);
    if (esCopia) {
      // Copia informativa: sin acciones (las hace el anfitrión)
    } else if (v.estado === 'pendiente') {
      acciones.push(`<button class="vs-btn vs-btn-ok vs-btn-sm" data-vs="aprobar" data-id="${v.id}"><i class="fas fa-check"></i> Aprobar</button>`);
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="rechazar" data-id="${v.id}"><i class="fas fa-times"></i> Rechazar</button>`);
    }
    if (!esCopia && ['aprobada', 'en_curso'].includes(v.estado) && v.fecha >= hoy && !v.almuerzo && (!st.admin || v.anfitrionId === st.ses.empleadoId)) {
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="almuerzo" data-id="${v.id}"><i class="fas fa-utensils"></i> Pedir almuerzo</button>`);
    }
    if (!esCopia && ['invitada', 'pendiente', 'aprobada'].includes(v.estado)) {
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="enlace" data-id="${v.id}" title="Genera un enlace nuevo; el anterior deja de funcionar"><i class="fas fa-link"></i> Enviar enlace</button>`);
      acciones.push(`<button class="vs-btn vs-btn-sm" data-vs="cancelar" data-id="${v.id}"><i class="fas fa-ban"></i> Cancelar</button>`);
    }
    const contacto = [v.whatsapp ? `<a href="https://wa.me/${esc(String(v.whatsapp).replace(/^0/, '593').replace(/\D/g, ''))}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> ${esc(v.whatsapp)}</a>` : '',
      v.email ? `<a href="mailto:${esc(v.email)}"><i class="far fa-envelope"></i> ${esc(v.email)}</a>` : ''].filter(Boolean).join(' · ');
    const cal = v.calificacion;
    return `<div class="vs-item">
      <div class="vs-item-cab"><div><strong>${esc(v.nombre || (v.estado === 'invitada' ? 'Invitado (sin completar)' : '—'))}</strong>
        <div class="vs-muted vs-small">${esc(v.empresa || '')}${st.admin || esCopia ? ` · visita a ${esc(v.anfitrion || v.anfitrionNombre)}` : ''}</div>
        ${v.tipoNombre || v.epp || esCopia ? `<div class="vs-chips">${v.tipoNombre ? `<span class="vs-chip">${esc(v.tipoNombre)}</span>` : ''}${v.epp ? '<span class="vs-chip vs-chip-epp"><i class="fas fa-hard-hat"></i> EPP</span>' : ''}${v.origen === 'porteria' ? '<span class="vs-chip vs-chip-sc">Sin cita</span>' : ''}${esCopia ? '<span class="vs-chip vs-chip-copia"><i class="fas fa-bell"></i> Copia</span>' : ''}</div>` : ''}</div>${chip(v.estado)}</div>
      <dl class="vs-datos" style="margin-top:8px">
        <dt>Fecha</dt><dd>${esc(fechaLarga(v.fecha))}${v.hora ? ' · ' + esc(v.hora) : ''}</dd>
        ${v.motivo ? `<dt>Motivo</dt><dd>${esc(v.motivo)}</dd>` : ''}
        ${contacto ? `<dt>Contacto</dt><dd>${contacto}</dd>` : ''}
        <dt>Código</dt><dd><code>${esc(codigoBonito(v.codigo))}</code>${v.origen === 'preregistro' ? ' · <span class="vs-muted">se registró solo</span>' : v.origen === 'porteria' ? ' · <span class="vs-muted">registrado en portería</span>' : ''}</dd>
        ${v.almuerzo ? `<dt>Almuerzo</dt><dd><i class="fas fa-utensils"></i> Solicitado</dd>` : ''}
        ${v.entradaEn ? `<dt>Ingreso</dt><dd>${horaDe(v.entradaEn)}${v.salidaEn ? ' · salida ' + horaDe(v.salidaEn) : ''}</dd>` : ''}
        ${v.motivoRechazo ? `<dt>Nota</dt><dd>${esc(v.motivoRechazo)}</dd>` : ''}
        ${cal ? `<dt>Calificación</dt><dd>Atención ${estrellas(cal.atencion)} · Puntualidad ${estrellas(cal.puntualidad)} · Instalaciones ${estrellas(cal.instalaciones)}${cal.comentario ? `<div class="vs-muted">"${esc(cal.comentario)}"</div>` : ''}</dd>` : ''}
      </dl>
      ${st.enlace && st.enlace.id === v.id ? enlaceHtml(st.enlace) : ''}
      ${acciones.length ? `<div class="vs-acciones">${acciones.join('')}</div>` : ''}</div>`;
  }

  function enlaceHtml(e) {
    const url = `${URL_PUBLICA}#t=${e.token}`;
    const msg = encodeURIComponent(`Hola, te espero en TCONTROL el ${fechaLarga(e.fecha)}${e.hora ? ' a las ' + e.hora : ''}. Completa tu registro y obtén tu código de ingreso aquí (es personal): ${url}`);
    return `<div class="vs-aviso" style="flex-direction:column"><strong><i class="fas fa-link"></i> Enlace privado del visitante</strong>
      <div class="vs-enlace"><span style="flex:1">${esc(url)}</span></div>
      <div class="vs-acciones"><button class="vs-btn vs-btn-sm" data-vs="copiar" data-url="${esc(url)}"><i class="fas fa-copy"></i> Copiar</button>
      <a class="vs-btn vs-btn-sm" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
      <a class="vs-btn vs-btn-sm" href="mailto:?subject=${encodeURIComponent('Tu visita a TCONTROL')}&body=${msg}"><i class="far fa-envelope"></i> Correo</a></div>
      <span class="vs-small">Compártelo solo con tu visitante. Por seguridad no se vuelve a mostrar: si lo pierdes, genera uno nuevo.</span></div>`;
  }

  function invitarHtml(st) {
    const f = st.formInv || {};
    if (st.enlace && st.enlace.nuevo) {
      return `<div class="vs-card"><h2 class="vs-h2"><i class="fas fa-check-circle" style="color:#047857"></i> Invitación creada</h2>
        <p class="vs-muted">Envía este enlace a tu visitante. Al abrirlo completará sus datos, aceptará los términos y obtendrá su código QR.</p>
        ${enlaceHtml(st.enlace)}<button class="vs-btn vs-btn-bloque" data-vs="cerrar-inv" style="margin-top:8px">Listo</button></div>`;
    }
    return `<form class="vs-card" data-vs="form-invitar"><h2 class="vs-h2"><i class="fas fa-user-plus"></i> Invitar a una visita</h2>
      ${st.error ? `<div class="vs-error">${esc(st.error)}</div>` : ''}
      <label class="vs-campo"><span>La visita es para</span><select name="tipo" required>
        <option value="">${st.tipos ? 'Elige…' : 'Cargando tipos…'}</option>
        ${(st.tipos || []).map(t => `<option value="${esc(t.id)}" ${f.tipo === t.id ? 'selected' : ''}>${esc(t.nombre)}${t.epp ? ' (EPP obligatorio)' : ''}</option>`).join('')}</select></label>
      <div class="vs-fila"><label class="vs-campo"><span>Fecha</span><input name="fecha" type="date" required min="${hoyLocal()}" value="${esc(f.fecha || hoyLocal())}"></label>
      <label class="vs-campo"><span>Hora</span><input name="hora" type="time" value="${esc(f.hora || '')}"></label></div>
      <label class="vs-campo"><span>Motivo</span><input name="motivo" maxlength="200" required value="${esc(f.motivo || '')}" placeholder="Reunión, entrega, mantenimiento…"></label>
      <label class="vs-campo"><span>Nombre del visitante <small>(opcional: lo completa él)</small></span><input name="nombre" maxlength="80" value="${esc(f.nombre || '')}"></label>
      <label class="vs-campo"><span>Empresa <small>(opcional)</small></span><input name="empresa" maxlength="80" value="${esc(f.empresa || '')}"></label>
      <div class="vs-acciones"><button type="button" class="vs-btn" data-vs="cerrar-inv">Cancelar</button>
      <button type="submit" class="vs-btn vs-btn-prim" ${st.enviando ? 'disabled' : ''}><i class="fas fa-paper-plane"></i> Crear invitación</button></div></form>`;
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
    if (st.invitando) pintar(st);
  }

  // ---------------------------------------------------------------- acciones
  async function cargar(st) {
    st.cargando = true; pintar(st);
    try {
      const r = await rpc(st, { accion: 'listar', modo: st.admin ? 'todas' : 'mias' });
      if (!r.ok) throw new Error(r.error);
      st.visitas = r.visitas || []; st.error = '';
    } catch (e) { st.error = e.message; }
    st.cargando = false; pintar(st);
    if (st.enlaceAbrir) { const v = st.visitas.find(x => String(x.id) === String(st.enlaceAbrir.id)); st.enlaceAbrir = null; if (v) { st.tab = v.estado === 'pendiente' ? 'pendientes' : st.tab; pintar(st); } }
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

  function montar(cont, opts) {
    const emp = opts.empleado || {};
    const st = { cont, emp, admin: !!opts.admin, config: !!opts.config, ses: sesionGuardada(emp.id), visitas: [], tab: '', error: '', cargando: false, invitando: false, enlace: null, enlaceAbrir: opts.enlace || null,
      tipos: null, cfg: null, cfgEmpleados: {}, cfgError: '', cfgGuardando: false };
    if (st.admin && st.ses && !st.ses.rrhh) st.admin = false;
    cont.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.dataset.vs === 'pin') {
        const b = f.querySelector('button'); b.disabled = true;
        try { st.ses = await iniciarSesion(emp.id, f.querySelector('input').value.trim()); st.error = ''; if (st.admin && !st.ses.rrhh) st.admin = false; await cargar(st); }
        catch (x) { st.error = x.message; pintar(st); }
      }
      if (f.dataset.vs === 'form-config') return guardarConfig(st, f);
      if (f.dataset.vs === 'form-invitar') {
        const d = Object.fromEntries(new FormData(f).entries());
        st.formInv = d; st.enviando = true; st.error = ''; pintar(st);
        try {
          const r = await rpc(st, Object.assign({ accion: 'invitar', anfitrionNombre: emp.nombre }, d));
          if (!r.ok) throw new Error(r.error);
          st.visitas.unshift(r.visita);
          st.enlace = { id: r.visita.id, token: r.token, fecha: r.visita.fecha, hora: r.visita.hora, nuevo: true };
          st.formInv = null;
        } catch (x) { st.error = x.message; }
        st.enviando = false; pintar(st);
      }
    });
    cont.addEventListener('click', async e => {
      const b = e.target.closest('[data-vs],[data-tab]');
      if (!b || !cont.contains(b)) return;
      if (b.dataset.tab) { st.tab = b.dataset.tab; st.enlace = null; if (st.tab === 'config' && !st.cfg) return cargarConfig(st); return pintar(st); }
      const a = b.dataset.vs, id = Number(b.dataset.id);
      const v = st.visitas.find(x => x.id === id);
      if (a === 'invitar') { st.invitando = true; st.enlace = null; st.error = ''; pintar(st); return cargarTipos(st); }
      if (a === 'cfg-agregar' || a === 'cfg-quitar') {
        const form = cont.querySelector('[data-vs="form-config"]'); if (form) leerConfig(st, form);
        if (a === 'cfg-agregar') st.cfg.tipos.push({ id: '', nombre: '', descripcion: '', epp: false, anfitrionOpcional: false, activo: true, notificar: [], _nuevo: true });
        else st.cfg.tipos.splice(Number(b.dataset.i), 1);
        return pintar(st);
      }
      if (a === 'cfg-recargar') return cargarConfig(st);
      if (a === 'cerrar-inv') { st.invitando = false; st.enlace = null; st.tab = 'proximas'; return pintar(st); }
      if (a === 'recargar') return cargar(st);
      if (a === 'copiar') { try { await navigator.clipboard.writeText(b.dataset.url); toast('Enlace copiado', 'success'); } catch (x) { prompt('Copia el enlace:', b.dataset.url); } return; }
      if (!v) return;
      if (a === 'aprobar') { if (await accion(st, 'aprobar', id)) { toast('Visita aprobada. El visitante ya tiene su código QR.', 'success'); pintar(st); } }
      if (a === 'rechazar') { const m = prompt('Motivo para el visitante (opcional):', ''); if (m === null) return; if (await accion(st, 'rechazar', id, { motivo: m })) { toast('Visita rechazada', 'success'); pintar(st); } }
      if (a === 'cancelar') { const m = prompt('¿Cancelar la visita? Motivo para el visitante (opcional):', ''); if (m === null) return; if (await accion(st, 'cancelar', id, { motivo: m })) { toast('Visita cancelada', 'success'); pintar(st); } }
      if (a === 'almuerzo') pedirAlmuerzo(st, v);
      if (a === 'enlace') {
        if (!confirm('Se generará un enlace nuevo para el visitante y el anterior dejará de funcionar. ¿Continuar?')) return;
        const r = await accion(st, 'enlace', id);
        if (r) { st.enlace = { id, token: r.token, fecha: v.fecha, hora: v.hora }; pintar(st); }
      }
    });
    if (st.ses) cargar(st); else pintar(st);
    cont._vs = st;
    return st;
  }

  window.VisitasAnfitrion = { montar };
})();
