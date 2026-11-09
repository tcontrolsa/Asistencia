// Panel → Directorio → «Solicitudes de registro»: revisión del registro propio (db/postgres/017_registro.sql).
// Solo supervisores admin y admin master (lo decide la base con el token de PIN, igual que Desempeño y Visitas).
// Aprobar: el sistema propone el siguiente ID libre; el admin define área y cargo. Se crea la ficha en Firestore
// (mismo camino que «Nuevo Usuario»), se marca la solicitud y se envía la bienvenida por WhatsApp de siempre.
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, lista: [], siguiente: '', error: '', cargando: false, abierta: '' };
  const toast = (m, t) => (typeof mostrarToast === 'function' ? mostrarToast(m, t) : alert(m));
  const supervisorId = () => { try { return String(JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').id || ''); } catch (e) { return ''; } };
  const esAdmin = () => !!(window.isMaster || window.isSupervisorAdmin);
  const telLocal = t => /^5939\d{8}$/.test(t) ? '0' + t.slice(3) : '+' + t;
  const numeros = t => String(t || '').replace(/\D/g, '').replace(/^0(9\d{8})$/, '593$1');
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const edad = f => { const d = new Date(f + 'T12:00:00'); const h = new Date(); let a = h.getFullYear() - d.getFullYear(); if (h < new Date(h.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
  const cache = () => (typeof empCache !== 'undefined' && Array.isArray(empCache) ? empCache : []);

  function sesion() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY_SESION) || 'null');
      if (s && s.token && String(s.empleadoId) === supervisorId() && s.exp * 1000 - Date.now() > 5 * 60000) return s;
    } catch (e) { }
    return null;
  }

  async function rpc(p) {
    const fb = window.FirebaseBackend;
    let causa = '';
    for (let i = 0; i < 2; i++) {
      const b = fb && fb._urlHistorico ? await fb._urlHistorico(i > 0) : '';
      if (!b) { causa = 'sin dirección'; continue; }
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(`${b}/rpc/registro_admin`, { method: 'POST', signal: ctrl.signal,
          headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p }) });
        if (r.status === 401) { salir(); throw new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'); }
        if (r.ok) return await r.json();
        causa = 'HTTP ' + r.status;
      } catch (e) { if (/sesión/.test(e.message)) throw e; causa = e.message; } finally { clearTimeout(t); }
    }
    const r = await fb._post({ accion: 'evalRpc', token: st.ses.token, fn: 'registro_admin', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con la base de registros (' + causa + ')');
    if (r.status === 401) { salir(); throw new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'); }
    return r.body;
  }
  async function llamar(p) {
    const r = await rpc(p);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'No se pudo completar');
    return r;
  }
  function salir() { try { sessionStorage.removeItem(KEY_SESION); } catch (e) { } st.ses = null; }

  // El siguiente ID: el mayor entre lo que propone la base (incluye el histórico) y las fichas actuales de la serie 2000
  function siguienteId() {
    const fichas = cache().map(e => parseInt(e.id, 10)).filter(n => n >= 2000 && n <= 2999);
    let n = Math.max(parseInt(st.siguiente, 10) || 2000, fichas.length ? Math.max(...fichas) + 1 : 2000);
    while (cache().some(e => String(e.id) === String(n))) n++;
    return String(n);
  }
  function duplicados(s) {
    const tel = numeros(s.telefono), nom = String(s.nombre || '').trim().toUpperCase();
    return cache().filter(e => (tel && numeros(e.telefono) === tel) || (nom && String(e.nombre || '').trim().toUpperCase() === nom));
  }

  async function cargar() {
    st.cargando = true; st.error = ''; pintar();
    try {
      const r = await llamar({ accion: 'listar' });
      st.lista = r.solicitudes; st.siguiente = r.siguienteId;
      actualizarInsignia();
    } catch (e) { st.error = e.message; }
    st.cargando = false; pintar();
  }

  function actualizarInsignia() {
    const b = document.getElementById('badgeRegistros');
    if (!b) return;
    const n = st.lista.filter(s => s.estado === 'PENDIENTE').length;
    b.textContent = n; b.hidden = !n;
  }

  // ---------------------------------------------------------------- ventana
  function caja() {
    let m = document.getElementById('modalRegistros');
    if (!m) {
      m = document.createElement('div');
      m.id = 'modalRegistros';
      m.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(15,23,42,.6); display:flex; align-items:flex-start; justify-content:center; padding:16px; overflow-y:auto;';
      m.addEventListener('click', ev => { if (ev.target === m) cerrar(); });
      m.addEventListener('click', alClic);
      m.addEventListener('submit', alEnviar);
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrar() { document.getElementById('modalRegistros')?.remove(); }

  const estiloInput = 'width:100%; padding:8px 10px; border-radius:8px; border:1.5px solid #cbd5e1; font-size:13px; box-sizing:border-box;';
  const etiqueta = 'display:block; font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; text-transform:uppercase;';
  const boton = (fondo, color, borde = fondo) => `padding:8px 14px; border-radius:8px; border:1.5px solid ${borde}; background:${fondo}; color:${color}; font-weight:800; font-size:12px; cursor:pointer;`;

  function tarjeta(s) {
    const dup = duplicados(s);
    const abierta = st.abierta === s.id;
    const areas = [...new Set(cache().map(e => String(e.area || '').trim().toUpperCase()).filter(Boolean))].sort();
    const cargos = [...new Set(cache().map(e => String(e.cargo || '').trim()).filter(Boolean))].sort();
    return `<article style="border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin-bottom:10px; background:#fff;">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="min-width:0;"><div style="font-weight:800; font-size:14px; color:#0f172a;">${esc(s.nombre)}</div>
          <div style="font-size:12px; color:#64748b; margin-top:2px;">${esc(s.id)} · ${fechaCorta(s.creada)}</div></div>
        <span style="flex:none; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px; background:#dbeafe; color:#1d4ed8;">Por revisar</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:6px 14px; margin-top:10px; font-size:12.5px; color:#334155;">
        <span><i class="fab fa-whatsapp" style="color:#16a34a;"></i> ${esc(telLocal(s.telefono))}</span>
        <span><i class="fas fa-cake-candles" style="color:#d97706;"></i> ${fechaCorta(s.fechaNacimiento)} (${edad(s.fechaNacimiento)} años)</span>
        <span style="overflow-wrap:anywhere;"><i class="fas fa-envelope" style="color:#64748b;"></i> ${esc(s.correo)}</span>
      </div>
      ${dup.length ? `<div style="margin-top:10px; padding:8px 10px; border-radius:8px; background:#fef3c7; color:#78350f; font-size:12px; font-weight:600;"><i class="fas fa-triangle-exclamation"></i> Posible duplicado: ${dup.map(e => `${esc(e.id)} · ${esc(e.nombre)}`).join('; ')}</div>` : ''}
      ${abierta ? `<form data-aprobar="${esc(s.id)}" style="margin-top:12px; padding-top:12px; border-top:1px solid #e2e8f0;">
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px;">
          <div><label style="${etiqueta}">ID</label><input name="id" value="${esc(siguienteId())}" inputmode="numeric" pattern="[0-9]{1,6}" required style="${estiloInput}"></div>
          <div><label style="${etiqueta}">Área</label><select name="area" required style="${estiloInput}"><option value="">Elige…</option>${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></div>
          <div><label style="${etiqueta}">Cargo</label><input name="cargo" list="registroCargos" maxlength="80" required style="${estiloInput}"><datalist id="registroCargos">${cargos.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        </div>
        <p style="font-size:11.5px; color:#64748b; margin:8px 0 10px;">Se crea la ficha, se le envía la bienvenida por WhatsApp con su ID y crea su contraseña al primer ingreso.</p>
        <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
          <button type="button" data-a="cerrarForm" style="${boton('#fff', '#334155', '#cbd5e1')}">Cancelar</button>
          <button type="submit" style="${boton('#059669', '#fff')}"><i class="fas fa-check"></i> Aprobar y crear ficha</button>
        </div></form>`
      : `<div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:12px;">
          <button type="button" data-a="rechazar" data-id="${esc(s.id)}" style="${boton('#fef2f2', '#b91c1c', '#fecaca')}">Rechazar</button>
          <button type="button" data-a="abrir" data-id="${esc(s.id)}" style="${boton('#059669', '#fff')}">Aprobar…</button></div>`}
    </article>`;
  }

  function pintar() {
    const m = caja();
    let cuerpo;
    if (!st.ses) {
      cuerpo = `<form data-pin style="max-width:320px; margin:8px auto; text-align:center;">
        <p style="font-size:13px; color:#475569;">Las solicitudes tienen datos personales. Confirma tu contraseña.</p>
        <input name="pin" type="password" maxlength="40" required autocomplete="off" style="${estiloInput} text-align:center; font-size:16px;">
        ${st.error ? `<p style="color:#b91c1c; font-size:12.5px; font-weight:600;">${esc(st.error)}</p>` : ''}
        <button type="submit" style="${boton('#0f172a', '#fff')} margin-top:10px; width:100%;">Continuar</button></form>`;
    } else if (st.cargando && !st.lista.length) {
      cuerpo = '<p style="text-align:center; color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Cargando…</p>';
    } else {
      const pend = st.lista.filter(s => s.estado === 'PENDIENTE');
      const hechas = st.lista.filter(s => s.estado !== 'PENDIENTE');
      cuerpo = `${st.error ? `<p style="color:#b91c1c; font-size:13px; font-weight:600;">${esc(st.error)}</p>` : ''}
        ${pend.length ? pend.map(tarjeta).join('') : '<p style="text-align:center; color:#64748b; padding:20px 0;"><i class="fas fa-circle-check" style="color:#16a34a;"></i> No hay solicitudes por revisar.</p>'}
        ${hechas.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:12.5px; font-weight:700; color:#475569;">Resueltas en los últimos 60 días (${hechas.length})</summary>
          <ul style="list-style:none; padding:0; margin:8px 0 0; font-size:12.5px;">${hechas.map(s => `<li style="padding:6px 0; border-top:1px solid #f1f5f9;">
            <b>${esc(s.nombre)}</b> · ${s.estado === 'APROBADA' ? `<span style="color:#059669;">Aprobada · ID ${esc(s.empleadoId)} · ${esc(s.area)} · ${esc(s.cargo)}</span>` : `<span style="color:#b91c1c;">Rechazada${s.motivoRechazo ? ': ' + esc(s.motivoRechazo) : ''}</span>`}
            <span style="color:#94a3b8;"> · ${esc(s.resueltaPor || '')} ${fechaCorta(s.resueltaEn)}</span></li>`).join('')}</ul></details>` : ''}`;
    }
    m.innerHTML = `<div style="background:#f8fafc; border-radius:14px; width:100%; max-width:640px; overflow:hidden; box-shadow:0 20px 25px -5px rgba(0,0,0,.3);">
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb); color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center;">
        <div><div style="font-weight:800; font-size:15px;"><i class="fas fa-user-clock"></i> Solicitudes de registro</div>
          <div style="font-size:11.5px; opacity:.9;">Personas que pidieron registrarse con su celular</div></div>
        <div style="display:flex; gap:6px;">${st.ses ? `<button type="button" data-a="recargar" title="Actualizar" style="background:rgba(255,255,255,.15); border:0; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer;"><i class="fas fa-rotate"></i></button>` : ''}
          <button type="button" data-a="cerrar" aria-label="Cerrar" style="background:none; border:none; color:#fff; font-size:22px; cursor:pointer;">&times;</button></div>
      </div>
      <div style="padding:14px 16px;">${cuerpo}</div></div>`;
    m.querySelector('[data-pin] input')?.focus();
  }

  async function aprobar(form) {
    const s = st.lista.find(x => x.id === form.dataset.aprobar);
    const id = form.id.value.trim(), area = form.area.value.trim().toUpperCase(), cargo = form.cargo.value.trim();
    if (!/^\d{1,6}$/.test(id) || !area || !cargo) return toast('Completa ID, área y cargo', 'warning');
    if (cache().some(e => String(e.id) === id)) return toast(`Ya existe un colaborador con el ID ${id}`, 'error');
    const botonEnviar = form.querySelector('[type=submit]');
    botonEnviar.disabled = true;
    try {
      await llamar({ accion: 'validar_id', empleadoId: id });
      const emp = {
        id, nombre: s.nombre, area, cargo, pin: '', telefono: telLocal(s.telefono), correo: s.correo,
        supervisor: 'NO', activo: 'SI', cultura_habilitada: true, cultura_activa: true, fechaNacimiento: s.fechaNacimiento,
        fecha_ingreso: (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().slice(0, 10),
        creado: new Date().toISOString(), registro_propio: s.id
      };
      const r = await window.FirebaseBackend.actualizarMasivoEmpleados({ empleados: [emp] });
      if (!r || r.error) throw new Error('No se pudo crear la ficha: ' + ((r && r.error) || 'sin respuesta'));
      if (typeof empCache !== 'undefined' && Array.isArray(empCache)) empCache.push(emp);
      try {
        await llamar({ accion: 'aprobar', id: s.id, empleadoId: id, area, cargo });
      } catch (e) {
        st.error = `La ficha ${id} se creó, pero la solicitud no quedó marcada (${e.message}). Pulsa «Aprobar» otra vez con el mismo ID.`;
        throw e;
      }
      let quien = 'Supervisor';
      try { quien = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').nombre || quien; } catch (e) { }
      const wa = window.OpenWAService && window.OpenWAService.notificarNuevoEmpleadoRegistrado
        ? await window.OpenWAService.notificarNuevoEmpleadoRegistrado(emp, quien).catch(() => null) : null;
      toast(wa && wa.enviadoColaborador ? `${s.nombre} aprobado con ID ${id}; se le envió la bienvenida por WhatsApp`
        : `${s.nombre} aprobado con ID ${id}. La bienvenida por WhatsApp no salió: avísale su ID.`, wa && wa.enviadoColaborador ? 'success' : 'warning');
      st.abierta = '';
      if (typeof window.cargarDirectorio === 'function') window.cargarDirectorio();
      await cargar();
    } catch (e) {
      if (!st.error) st.error = e.message;
      botonEnviar.disabled = false;
      pintar();
    }
  }

  async function alEnviar(ev) {
    ev.preventDefault();
    const f = ev.target;
    if (f.matches('[data-pin]')) {
      st.error = '';
      try {
        const r = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: supervisorId(), pin: f.pin.value });
        if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu contraseña.');
        st.ses = { token: r.token, exp: r.exp, empleadoId: supervisorId(), equipo: r.equipo || [], rrhh: !!r.rrhh, master: !!r.master };
        try { sessionStorage.setItem(KEY_SESION, JSON.stringify(st.ses)); } catch (e) { }
        await cargar();
      } catch (e) { st.error = e.message; pintar(); }
    }
    if (f.matches('[data-aprobar]')) { st.error = ''; aprobar(f); }
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, id } = b.dataset;
    if (a === 'cerrar') cerrar();
    if (a === 'recargar') cargar();
    if (a === 'abrir') { st.abierta = id; st.error = ''; pintar(); }
    if (a === 'cerrarForm') { st.abierta = ''; pintar(); }
    if (a === 'rechazar') {
      const s = st.lista.find(x => x.id === id);
      const motivo = prompt(`¿Rechazar la solicitud de ${s ? s.nombre : id}? Se le avisará por WhatsApp.\nMotivo (opcional):`, '');
      if (motivo === null) return;
      try { await llamar({ accion: 'rechazar', id, motivo }); toast('Solicitud rechazada', 'success'); await cargar(); }
      catch (e) { st.error = e.message; pintar(); }
    }
  }

  window.abrirRegistrosPendientes = function () {
    if (!esAdmin()) return toast('Solo los supervisores administradores revisan los registros', 'warning');
    st.ses = sesion(); st.error = ''; st.abierta = '';
    pintar();
    if (st.ses) cargar();
  };

  // El botón solo se ve para supervisores admin; con sesión de PIN vigente muestra cuántas hay por revisar
  let intentos = 0;
  const mostrarBoton = setInterval(() => {
    const b = document.getElementById('btnRegistrosPendientes');
    if (b && (window.isMaster || window.isSupervisorAdmin)) {
      b.style.display = 'inline-flex';
      clearInterval(mostrarBoton);
      st.ses = sesion();
      if (st.ses) llamar({ accion: 'listar' }).then(r => { st.lista = r.solicitudes; st.siguiente = r.siguienteId; actualizarInsignia(); }).catch(() => { });
    }
    if (++intentos > 60) clearInterval(mostrarBoton);
  }, 1000);
})();
