// =====================================================================
// Acceso a pestañas por tipo de usuario (Opciones adicionales → 5. Acceso a pestañas)
// El Admin Master define qué secciones y subpestañas del panel ve cada rol (Supervisor Admin y Supervisor).
// El Admin Master siempre ve todo (así nunca se queda nadie sin poder corregirlo).
// Se guarda en Firestore configuracion/acceso_pestanas: { SUPERVISOR_ADMIN: {clave: bool}, SUPERVISOR: {...} }.
// Sin configuración guardada rige lo de siempre (PREDETERMINADO). Es una restricción de la interfaz: oculta y
// bloquea la navegación; no reemplaza los permisos de cada acción.
// =====================================================================
(function () {
  const CATALOGO = [
    { clave: 'asistencia', nombre: 'Asistencia', icono: 'fa-calendar-day', nav: '[data-panel="asistencia"]', subs: [
      { clave: 'asistencia.control', nombre: 'Control Diario', boton: 'subtab-btn-asis-control', sub: 'control' },
      { clave: 'asistencia.directorio', nombre: 'Directorio', boton: 'subtab-btn-asis-directorio', sub: 'directorio' },
      { clave: 'asistencia.mapa', nombre: 'Mapa', boton: 'subtab-btn-asis-mapa', sub: 'mapa' }] },
    { clave: 'dashboard', nombre: 'Dashboard', icono: 'fa-chart-pie', nav: '[data-panel="dashboard"]' },
    { clave: 'reportes', nombre: 'Reportes', icono: 'fa-file-invoice', nav: '[data-panel="reportes"]' },
    { clave: 'servicios', nombre: 'Gestión & Servicios', icono: 'fa-layer-group', nav: '[data-panel="servicios"]', subs: [
      { clave: 'servicios.emergencias', nombre: 'Emergencias', boton: 'subtab-btn-serv-emergencias', sub: 'emergencias' },
      { clave: 'servicios.menu', nombre: 'Menú semanal', boton: 'subtab-btn-serv-menu', sub: 'menu' },
      { clave: 'servicios.cultura', nombre: 'Cultura', boton: 'subtab-btn-serv-cultura', sub: 'cultura' },
      { clave: 'servicios.invitados', nombre: 'Invitados y almuerzos extra', boton: 'subtab-btn-serv-invitados', sub: 'invitados' }] },
    { clave: 'desempeno', nombre: 'Desempeño', icono: 'fa-seedling', nav: '[data-panel="desempeno"]' },
    { clave: 'visitas', nombre: 'Visitas', icono: 'fa-id-card-alt', nav: '[data-panel="visitas"]' },
    { clave: 'whatsapp', nombre: 'Notificaciones WhatsApp', icono: 'fa-whatsapp fab', nav: '[data-panel="whatsapp"]' },
    { clave: 'soporte', nombre: 'Portal de soporte', icono: 'fa-headset', nav: '#navItemSoporte' },
    { clave: 'opciones', nombre: 'Opciones adicionales', icono: 'fa-sliders-h', nav: '[data-panel="opciones"]', soloMaster: true },
    { clave: 'simulador', nombre: 'Simulador de Vista', icono: 'fa-mobile-alt', nav: '#navItemSimulador' }
  ];
  const ROLES = [
    { clave: 'SUPERVISOR_ADMIN', nombre: 'Supervisor Admin' },
    { clave: 'SUPERVISOR', nombre: 'Supervisor' }
  ];
  // Lo que cada rol ve hoy (antes de esta configuración)
  const PREDETERMINADO = {
    SUPERVISOR_ADMIN: { soporte: false, opciones: false, simulador: false },
    SUPERVISOR: { whatsapp: false, soporte: false, opciones: false, simulador: false }
  };
  const PANELES = CATALOGO.filter(s => !['soporte', 'simulador'].includes(s.clave)).map(s => s.clave);

  const st = { cfg: null, borrador: null, escucha: null, rol: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ref = () => window.firebase.firestore().collection('configuracion').doc('acceso_pestanas');

  function rolActual() {
    if (st.rol) return st.rol;
    try { return getSupervisorRole(JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}')); } catch (e) { return 'EMPLEADO'; }
  }

  // ¿El rol puede ver esta clave? (sección o 'seccion.subpestaña')
  function permitido(rol, clave) {
    if (rol === 'ADMIN_MASTER') return true;
    const sec = CATALOGO.find(s => s.clave === clave.split('.')[0]);
    if (sec && sec.soloMaster) return false;
    const mapa = (st.cfg && st.cfg[rol]) || PREDETERMINADO[rol] || {};
    if (clave.includes('.') && !permitido(rol, clave.split('.')[0])) return false;
    return mapa[clave] !== false;
  }
  window.puedeVerPestana = clave => permitido(rolActual(), clave);

  function primeraSubPermitida(rol, sec) {
    const s = (sec.subs || []).find(x => permitido(rol, x.clave));
    return s ? s.sub : null;
  }

  function primerPanelPermitido(rol) {
    return PANELES.find(p => permitido(rol, p) && (!(CATALOGO.find(s => s.clave === p).subs) || primeraSubPermitida(rol, CATALOGO.find(s => s.clave === p))));
  }

  // Muestra / oculta el menú y las subpestañas según el rol
  function aplicar(rol) {
    if (rol) st.rol = rol;
    rol = rolActual();
    if (!rol || rol === 'EMPLEADO') return;
    CATALOGO.forEach(sec => {
      const ver = permitido(rol, sec.clave) && (!sec.subs || !!primeraSubPermitida(rol, sec));
      // La clase gana al '.nav-item { display:flex !important }' del menú en celular
      document.querySelectorAll('.sidebar-nav ' + sec.nav).forEach(el => { el.style.display = ver ? 'flex' : 'none'; el.classList.toggle('acceso-oculto', !ver); });
      (sec.subs || []).forEach(sub => {
        const b = document.getElementById(sub.boton);
        if (b) { b.style.display = permitido(rol, sub.clave) ? '' : 'none'; b.classList.toggle('acceso-oculto', !permitido(rol, sub.clave)); }
      });
    });
    // Si está parado en algo que ya no puede ver, se le lleva a lo primero permitido
    const actual = typeof panelActual !== 'undefined' ? panelActual : null;
    if (actual && PANELES.includes(actual) && !permitido(rol, actual)) {
      const p = primerPanelPermitido(rol);
      if (p) setTimeout(() => window.cambiarPanel(p), 0);
    }
  }
  window.aplicarAccesosPestanas = aplicar;

  // Bloqueo de la navegación (también de accesos directos y alias como cambiarPanel('mapa'))
  function envolver() {
    const cp = window.cambiarPanel, sa = window.cambiarSubtabAsistencia, ss = window.cambiarSubtabServicios;
    if (!cp || cp._conAccesos) return !!cp;
    const nuevoCP = function (panel) {
      const rol = rolActual();
      const alias = { directorio: 'asistencia.directorio', mapa: 'asistencia.mapa', emergencias: 'servicios.emergencias', menu: 'servicios.menu', cultura: 'servicios.cultura', invitados: 'servicios.invitados' };
      const clave = alias[panel] || panel;
      if (PANELES.includes(clave.split('.')[0]) && !permitido(rol, clave)) {
        const p = primerPanelPermitido(rol);
        if (typeof mostrarToast === 'function') mostrarToast('No tienes acceso a esa sección', 'warning');
        if (p && p !== panel) return cp(p);
        return;
      }
      return cp.apply(this, arguments);
    };
    nuevoCP._conAccesos = true;
    window.cambiarPanel = nuevoCP;
    try { cambiarPanel = nuevoCP; } catch (e) { }
    const envolverSub = (fn, secClave) => function (sub) {
      const rol = rolActual();
      const sec = CATALOGO.find(s => s.clave === secClave);
      const pedida = sub || sec.subs[0].sub;
      if (!permitido(rol, secClave + '.' + pedida)) {
        const otra = primeraSubPermitida(rol, sec);
        if (!otra) return;
        return fn.call(this, otra);
      }
      return fn.apply(this, arguments);
    };
    if (sa) window.cambiarSubtabAsistencia = envolverSub(sa, 'asistencia');
    if (ss) window.cambiarSubtabServicios = envolverSub(ss, 'servicios');
    return true;
  }

  function escuchar() {
    if (st.escucha || !window.firebase || !window.firebase.firestore) return;
    try {
      st.escucha = ref().onSnapshot(snap => {
        st.cfg = snap.exists ? (snap.data() || {}) : null;
        aplicar();
        if (document.getElementById('accesosPestanasCont') && !st.borrador) pintar();
      }, e => console.warn('Acceso a pestañas:', e));
    } catch (e) { console.warn('Acceso a pestañas:', e); }
  }

  // ---------------------------------------------------------------- configuración (solo Admin Master)
  function valorBorrador(rol, clave) {
    const m = st.borrador[rol] || {};
    return clave in m ? m[clave] !== false : ((PREDETERMINADO[rol] || {})[clave] !== false);
  }

  function pintar() {
    const cont = document.getElementById('accesosPestanasCont');
    if (!cont) return;
    if (rolActual() !== 'ADMIN_MASTER') {
      cont.innerHTML = '<p style="color:#64748b; font-size:13px; padding:16px;">Solo el Administrador Master puede configurar los accesos.</p>';
      return;
    }
    if (!st.borrador) {
      st.borrador = {};
      ROLES.forEach(r => { st.borrador[r.clave] = { ...(PREDETERMINADO[r.clave] || {}), ...((st.cfg && st.cfg[r.clave]) || {}) }; });
    }
    const celda = (rol, clave, deshab) => `<td style="text-align:center; padding:8px 6px;">
        <input type="checkbox" data-acc-rol="${rol}" data-acc-clave="${clave}" ${valorBorrador(rol, clave) ? 'checked' : ''} ${deshab ? 'disabled' : ''} aria-label="${esc(rol)} ${esc(clave)}" style="width:17px; height:17px; cursor:pointer;">
      </td>`;
    const filas = CATALOGO.map(sec => {
      const fija = sec.soloMaster;
      const principal = `<tr style="border-top:1px solid #e2e8f0; background:#fff;">
          <td style="padding:8px 10px; font-weight:700; color:#1e293b; font-size:13px;"><i class="fas ${esc(sec.icono)}" style="width:18px; color:#64748b;"></i> ${esc(sec.nombre)}${fija ? ' <span style="font-size:11px; color:#94a3b8; font-weight:500;">(solo Admin Master)</span>' : ''}</td>
          <td style="text-align:center;"><i class="fas fa-check" style="color:#16a34a;"></i></td>
          ${ROLES.map(r => fija ? '<td style="text-align:center; color:#cbd5e1;">—</td>' : celda(r.clave, sec.clave)).join('')}
        </tr>`;
      const subs = (sec.subs || []).map(sub => `<tr style="background:#f8fafc;">
          <td style="padding:6px 10px 6px 36px; color:#475569; font-size:12.5px;">↳ ${esc(sub.nombre)}</td>
          <td style="text-align:center;"><i class="fas fa-check" style="color:#16a34a; opacity:.6;"></i></td>
          ${ROLES.map(r => celda(r.clave, sub.clave, !valorBorrador(r.clave, sec.clave))).join('')}
        </tr>`).join('');
      return principal + subs;
    }).join('');
    const info = st.cfg && st.cfg.actualizado_en
      ? `Última modificación: ${esc(new Date(st.cfg.actualizado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }))} por ${esc(st.cfg.actualizado_por || '—')}`
      : 'Sin cambios guardados: rige la configuración de siempre.';
    cont.innerHTML = `
      <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:12px;">
        <table style="width:100%; border-collapse:collapse; min-width:520px;">
          <thead><tr style="background:#f1f5f9; font-size:11.5px; color:#475569; text-transform:uppercase; letter-spacing:.3px;">
            <th style="text-align:left; padding:10px;">Pestaña</th>
            <th style="padding:10px;">Admin Master</th>
            ${ROLES.map(r => `<th style="padding:10px;">${esc(r.nombre)}</th>`).join('')}
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-top:14px;">
        <span style="font-size:11.5px; color:#64748b;">${info}</span>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn" data-acc-restablecer style="padding:8px 14px; border-radius:8px; font-size:12.5px; background:#f8fafc; border:1px solid #cbd5e1;"><i class="fas fa-undo"></i> Valores de siempre</button>
          <button type="button" class="btn btn-success" data-acc-guardar style="padding:8px 18px; border-radius:8px; font-size:12.5px; font-weight:700;"><i class="fas fa-save"></i> Guardar accesos</button>
        </div>
      </div>
      <p id="accesosMsg" role="status" style="font-size:12px; margin:10px 0 0; min-height:16px;"></p>`;
  }

  async function guardar() {
    const msg = document.getElementById('accesosMsg');
    const decir = (t, ok) => { if (msg) { msg.textContent = t; msg.style.color = ok ? '#15803d' : '#b91c1c'; } };
    // Cada rol debe poder entrar a algo
    for (const r of ROLES) {
      const tmp = st.cfg; st.cfg = { ...(st.cfg || {}), [r.clave]: st.borrador[r.clave] };
      const alguno = primerPanelPermitido(r.clave);
      st.cfg = tmp;
      if (!alguno) { decir(`${r.nombre} no tendría ninguna pestaña: deja al menos una marcada.`); return; }
    }
    let sesion = {};
    try { sesion = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
    const datos = { actualizado_por: sesion.nombre || sesion.id || 'Admin Master', actualizado_en: new Date().toISOString() };
    ROLES.forEach(r => { datos[r.clave] = { ...st.borrador[r.clave] }; });
    const btn = document.querySelector('[data-acc-guardar]');
    if (btn) btn.disabled = true;
    try {
      await ref().set(datos);   // documento completo: lo que no está marcado como false se ve
      st.cfg = datos;
      st.borrador = null;
      pintar();
      const m2 = document.getElementById('accesosMsg');
      if (m2) { m2.textContent = 'Accesos guardados. Los paneles abiertos se actualizan solos.'; m2.style.color = '#15803d'; }
    } catch (e) {
      decir('No se pudo guardar: ' + (e.message || e));
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('change', ev => {
    const c = ev.target.closest('[data-acc-rol]');
    if (!c || !st.borrador) return;
    st.borrador[c.dataset.accRol][c.dataset.accClave] = c.checked;
    if (!c.dataset.accClave.includes('.')) pintar();   // habilita / deshabilita sus subpestañas
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-acc-guardar]')) guardar();
    if (ev.target.closest('[data-acc-restablecer]')) {
      st.borrador = {};
      ROLES.forEach(r => { st.borrador[r.clave] = { ...(PREDETERMINADO[r.clave] || {}) }; });
      pintar();
      const m = document.getElementById('accesosMsg');
      if (m) { m.textContent = 'Valores de siempre cargados. Pulsa Guardar para aplicarlos.'; m.style.color = '#475569'; }
    }
  });

  window.cargarAccesosPestanas = function () { st.borrador = null; escuchar(); pintar(); };

  // Arranque: envolver la navegación y escuchar la configuración
  const iniciar = () => { if (!envolver()) return setTimeout(iniciar, 300); escuchar(); aplicar(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
