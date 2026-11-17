// =====================================================================
// WhatsApp → 2. Automatizaciones (Avisos emergentes / push)
// Lista quién activó los avisos emergentes en algún dispositivo (Firestore push_tokens/{empleadoId}).
// Gestores ven la lista; Admin Master y Supervisores Admin pueden apagar o permitir los avisos de una persona
// (campo `apagado`: la app ya no deja registrar el dispositivo y push_fcm.gs no le envía).
// =====================================================================
(function () {
  const st = { docs: {}, cargando: false, error: '', filtro: 'todos', texto: '' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const col = () => window.firebase.firestore().collection('push_tokens');
  const personal = () => (window.todoElPersonal ? window.todoElPersonal() : (window.empCache || []))
    .filter(e => String(e.activo ?? 'SI').toUpperCase() !== 'NO' && e.activo !== false);
  const puedeApagar = () => typeof tienePermisoAdmin === 'function' && tienePermisoAdmin();

  function filaEstado(d) {
    if (d && d.apagado) return { t: 'Apagado por admin', c: '#b91c1c', f: '#fee2e2' };
    if (d && d.tokens && d.tokens.length) return { t: 'Activo', c: '#15803d', f: '#dcfce7' };
    return { t: 'Sin avisos', c: '#64748b', f: '#f1f5f9' };
  }

  function pintar() {
    const cont = document.getElementById('waPushCont');
    if (!cont) return;
    if (st.error) { cont.innerHTML = `<p style="color:#b91c1c; font-size:13px; text-align:center; padding:16px;">${esc(st.error)}</p>`; return; }
    if (st.cargando && !Object.keys(st.docs).length) { cont.innerHTML = '<p style="color:#64748b; font-size:13px; text-align:center; padding:16px;"><i class="fas fa-spinner fa-spin"></i> Cargando…</p>'; return; }
    const lista = personal();
    const activos = lista.filter(e => filaEstado(st.docs[String(e.id)]).t === 'Activo').length;
    const q = st.texto.trim().toLowerCase();
    const filas = lista.filter(e => {
      const est = filaEstado(st.docs[String(e.id)]).t;
      if (st.filtro === 'activos' && est !== 'Activo') return false;
      if (st.filtro === 'sin' && est !== 'Sin avisos') return false;
      if (st.filtro === 'apagados' && est !== 'Apagado por admin') return false;
      return !q || String(e.id).includes(q) || String(e.nombre || '').toLowerCase().includes(q);
    }).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')).map(e => {
      const d = st.docs[String(e.id)];
      const s = filaEstado(d);
      const n = d && d.tokens ? d.tokens.length : 0;
      const act = d && d.actualizado && d.actualizado.toDate ? d.actualizado.toDate().toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) : '—';
      const boton = !puedeApagar() ? '' : (d && d.apagado
        ? `<button type="button" class="btn" data-pa-permitir="${esc(e.id)}" style="padding:4px 10px; font-size:11.5px; border:1px solid #bbf7d0; background:#f0fdf4; color:#15803d; border-radius:6px;">Permitir</button>`
        : (n ? `<button type="button" class="btn" data-pa-apagar="${esc(e.id)}" style="padding:4px 10px; font-size:11.5px; border:1px solid #fecaca; background:#fef2f2; color:#b91c1c; border-radius:6px;">Apagar</button>` : ''));
      return `<tr style="border-top:1px solid #e2e8f0;"><td style="padding:7px 8px;">${esc(e.nombre || '')}<br><small style="color:#94a3b8;">ID ${esc(e.id)}</small></td>
        <td style="padding:7px 8px; text-align:center;">${n}</td><td style="padding:7px 8px; text-align:center;">${esc(act)}</td>
        <td style="padding:7px 8px;"><span style="background:${s.f}; color:${s.c}; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:700;">${s.t}</span></td>
        <td style="padding:7px 8px; text-align:right;">${boton}</td></tr>`;
    }).join('');
    const btnF = (v, t) => `<button type="button" class="btn" data-pa-filtro="${v}" style="padding:5px 12px; font-size:12px; border-radius:999px; border:1px solid ${st.filtro === v ? '#6366f1' : '#cbd5e1'}; background:${st.filtro === v ? '#eef2ff' : '#fff'}; color:${st.filtro === v ? '#4338ca' : '#475569'};">${t}</button>`;
    cont.innerHTML = `
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
        <strong style="font-size:13px; color:#1e293b;">${activos} de ${lista.length} personas con avisos activos</strong>
        <span style="flex:1"></span>${btnF('todos', 'Todos')}${btnF('activos', 'Con avisos')}${btnF('sin', 'Sin avisos')}${btnF('apagados', 'Apagados')}
        <input type="search" id="paBuscar" value="${esc(st.texto)}" placeholder="Buscar nombre o ID" style="padding:5px 10px; font-size:12px; border:1px solid #cbd5e1; border-radius:8px;">
      </div>
      <div style="max-height:340px; overflow:auto; background:#fff; border:1px solid #e2e8f0; border-radius:10px;">
        <table style="width:100%; border-collapse:collapse; font-size:12.5px; text-align:left;">
          <thead><tr style="color:#64748b; font-size:11.5px;"><th style="padding:7px 8px;">Persona</th><th style="padding:7px 8px; text-align:center;">Dispositivos</th><th style="padding:7px 8px; text-align:center;">Registrado</th><th style="padding:7px 8px;">Estado</th><th></th></tr></thead>
          <tbody>${filas || '<tr><td colspan="5" style="padding:16px; text-align:center; color:#94a3b8;">Sin resultados.</td></tr>'}</tbody>
        </table>
      </div>
      <p id="paMsg" role="status" style="font-size:12px; margin:8px 0 0; min-height:16px;"></p>`;
  }

  async function cargar() {
    if (!window.firebase || !window.firebase.firestore) return;
    st.cargando = true; st.error = ''; pintar();
    try {
      const snap = await col().get();
      st.docs = {};
      snap.forEach(d => { st.docs[d.id] = d.data(); });
    } catch (e) {
      st.error = /permission/i.test(String(e && e.message)) ? 'Tu sesión no tiene permiso para ver los avisos. Cierra sesión y vuelve a entrar.' : 'No se pudo leer la lista de avisos.';
    }
    st.cargando = false; pintar();
  }

  async function cambiar(id, apagar) {
    if (apagar && !confirm('¿Apagar los avisos emergentes de esta persona? Se quitarán sus dispositivos y no podrá volver a activarlos hasta que lo permitas.')) return;
    let error = false;
    try {
      const F = window.firebase.firestore.FieldValue;
      await col().doc(String(id)).set(apagar
        ? { tokens: [], apagado: true, actualizado: F.serverTimestamp() }
        : { apagado: false, actualizado: F.serverTimestamp() }, { merge: true });
      await cargar();
    } catch (e) { error = true; }
    const m = document.getElementById('paMsg');
    if (m) {
      m.style.color = error ? '#b91c1c' : '#15803d';
      m.textContent = error ? 'No se pudo guardar el cambio.' : (apagar ? 'Avisos apagados. La persona aparece ahora en el filtro "Apagados".' : 'Avisos permitidos: la persona puede activarlos de nuevo.');
    }
  }

  document.addEventListener('click', ev => {
    const cont = document.getElementById('waPushCont');
    if (!cont || !cont.contains(ev.target)) return;
    const f = ev.target.closest('[data-pa-filtro]');
    if (f) { st.filtro = f.dataset.paFiltro; pintar(); return; }
    const a = ev.target.closest('[data-pa-apagar]');
    if (a) { cambiar(a.dataset.paApagar, true); return; }
    const p = ev.target.closest('[data-pa-permitir]');
    if (p) cambiar(p.dataset.paPermitir, false);
  });
  document.addEventListener('input', ev => {
    if (ev.target && ev.target.id === 'paBuscar') {
      st.texto = ev.target.value;
      const pos = ev.target.selectionStart;
      pintar();
      const n = document.getElementById('paBuscar');
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    }
  });

  window.cargarPushAvisos = cargar;
})();
