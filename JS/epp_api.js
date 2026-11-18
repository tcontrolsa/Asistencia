// Módulo EPP: conexión real (PostgREST api.epp; respaldo de red: Apps Script evalRpc).
// Sesión: el token de contraseña de Desempeño y Visitas. Reemplaza a EppDatos con la misma interfaz que usan las pantallas.
// En localhost con ?demo sigue la demostración de epp_datos.js.
(() => {
  const base = window.EppDatos;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('demo')) {
    base.demo = true;
    base.iniciar = async () => null;
    return;
  }

  const KEY_SESION = 'tcontrol_sesion_eval';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, modo: 'colaborador', yo: null, bodega: false, mi: [], catalogo: [], solicitudes: [], stock: {} };

  function sesionGuardada() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY_SESION) || 'null');
      if (s && s.token && s.exp * 1000 - Date.now() > 5 * 60000) return s;
    } catch (e) { }
    return null;
  }
  function cerrarSesion() {
    try { sessionStorage.removeItem(KEY_SESION); } catch (e) { }
    st.ses = null;
  }
  const vencida = () => Object.assign(new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'), { sesion: true });

  async function pedir(p) {
    const fb = window.FirebaseBackend;
    let causa = '';
    for (let i = 0; i < 2; i++) {
      const url = fb && fb._urlHistorico ? await fb._urlHistorico(i > 0) : '';
      if (!url) { causa = 'sin dirección'; continue; }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(`${url}/rpc/epp`, {
          method: 'POST', signal: ctrl.signal,
          headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p })
        });
        if (r.status === 401) throw vencida();
        if (r.ok) return await r.json();
        causa = 'HTTP ' + r.status;
      } catch (e) {
        if (e.sesion) throw e;
        causa = e.message;
      } finally { clearTimeout(t); }
    }
    const r = await fb._post({ accion: 'evalRpc', token: st.ses.token, fn: 'epp', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error(`Sin conexión con la base de EPP (${causa})`);
    if (r.status === 401) throw vencida();
    return r.body;
  }

  async function rpc(p) {
    let r;
    try { r = await pedir(p); } catch (e) {
      if (e.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1500); }
      throw e;
    }
    if (!r || r.ok === false) throw new Error((r && r.error) || 'No se pudo completar');
    return r;
  }

  async function recargar() {
    const i = await rpc({ accion: 'inicio' });
    Object.assign(st, { yo: i.yo, bodega: i.bodega, mi: i.mi || [], catalogo: i.catalogo, solicitudes: i.solicitudes });
    if (st.modo === 'despacho' && st.bodega) {
      const d = await rpc({ accion: 'despacho' });
      st.solicitudes = d.solicitudes;
      st.stock = Object.fromEntries(d.stock.map(k => [`${k.eppId}|${k.talla}`, { cant: k.cant, min: k.min }]));
    }
  }
  const accion = async p => { const r = await rpc(p); await recargar(); return r; };

  function pedirPin(app) {
    let id = '';
    try { const d = JSON.parse(localStorage.getItem('SESSION_DATA') || '{}'); id = d.id || d.empleadoId || ''; } catch (e) { }
    return new Promise(resolve => {
      app.innerHTML = `<div class="epp-login"><form class="epp-login-card">
        <span class="epp-ico"><i class="fas fa-hard-hat"></i></span>
        <h1>${st.modo === 'despacho' ? 'Despacho de EPP' : 'Mis EPP'}</h1>
        <p>Ingresa con el ID y la contraseña de la app.</p>
        <label>ID<input name="id" inputmode="numeric" autocomplete="off" required value="${esc(id)}"></label>
        <label>Contraseña<input name="pin" type="password" autocomplete="off" required></label>
        <p class="epp-error" hidden></p>
        <button class="epp-btn primario ancho">Entrar</button>
      </form></div>`;
      const f = app.querySelector('form'), msg = app.querySelector('.epp-error'), b = app.querySelector('button');
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        b.disabled = true;
        msg.hidden = true;
        try {
          const r = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: f.id.value.trim(), pin: f.pin.value });
          if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu contraseña.');
          const s = { token: r.token, exp: r.exp, empleadoId: f.id.value.trim(), equipo: r.equipo || [], rrhh: !!r.rrhh, master: !!r.master };
          try { sessionStorage.setItem(KEY_SESION, JSON.stringify(s)); } catch (e) { }
          resolve(s);
        } catch (e) {
          msg.textContent = e.message;
          msg.hidden = false;
          b.disabled = false;
        }
      });
    });
  }

  window.EppDatos = {
    demo: false,
    MOTIVOS: base.MOTIVOS,
    DIAS_LIMITE_FIRMA: base.DIAS_LIMITE_FIRMA,
    COLABORADORES: [],
    vigencia: base.vigencia,
    firmaPendiente: base.firmaPendiente,
    get CATALOGO() { return st.catalogo; },
    eppDe: id => st.catalogo.find(e => e.id === id) || { nombre: id, icono: 'fa-box', tallas: [], maxCant: 5 },
    esBodega: () => st.bodega,
    cadencia: base.cadencia,
    puestosDe: () => st.mi,
    colaborador(id) {
      if (st.yo && st.yo.id === id) return st.yo;
      const s = st.solicitudes.find(x => x.empleadoId === id);
      return s ? { id, nombre: s.nombre, area: s.area || '', cargo: s.cargo || '' } : { id, nombre: id, area: '', cargo: '' };
    },

    // Muestra el acceso si hace falta y carga los datos. Devuelve el colaborador
    async iniciar(app, modo) {
      st.modo = modo;
      st.ses = sesionGuardada();
      for (;;) {
        if (!st.ses) st.ses = await pedirPin(app);
        try { await recargar(); return st.yo; } catch (e) {
          if (e.sesion) { st.ses = null; continue; }
          app.innerHTML = `<div class="epp-vacio"><i class="fas fa-plug-circle-xmark"></i><b>No pudimos cargar tus EPP</b><span>${esc(e.message)}</span><button class="epp-btn primario" onclick="location.reload()">Reintentar</button></div>`;
          throw e;
        }
      }
    },
    salir() { cerrarSesion(); location.reload(); },

    async datos() { return { solicitudes: st.solicitudes, stock: st.stock }; },
    async misEpp(id) { return base.calcularMisEpp(st.solicitudes, id, st.mi); },
    async verFirma(id) { return (await rpc({ accion: 'ver_firma', id })).firma; },

    crearSolicitud: (_, items, comentario) => accion({ accion: 'solicitar', items, comentario }),
    cancelar: id => accion({ accion: 'cancelar', id }),
    confirmar: (id, _, firma) => accion({ accion: 'firmar', id, firma }),
    preparar: id => accion({ accion: 'preparar', id }),
    rechazar: (id, _, motivo) => accion({ accion: 'rechazar', id, motivo }),
    entregar: (id, _, firma, pendientes = []) => accion({ accion: 'entregar', id, firma, pendientes }),
    firmarEnBodega: (ids, firma) => accion({ accion: 'firmar_bodega', ids, firma }),
    recordar: id => accion({ accion: 'recordar', id }),
    ingresarStock(clave, cant) {
      const [eppId, talla] = clave.split('|');
      return accion({ accion: 'ingreso', eppId, talla, cant: String(cant) });
    },
    reiniciar() { },

    // Actualiza cada minuto con la pantalla visible y sin una ventana abierta
    alCambiar(fn) {
      setInterval(async () => {
        if (document.hidden || document.getElementById('eppDlg')) return;
        try { await recargar(); fn(); } catch (e) { console.warn('EPP: sin actualizar', e); }
      }, 60000);
    }
  };
})();
