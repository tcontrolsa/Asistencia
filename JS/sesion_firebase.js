// =====================================================================
// Seguridad, etapa 1 — sesión de Firebase Auth (backend/apps_script/sesion_firebase.gs)
// Tras el inicio de sesión de siempre, con la contraseña ya cifrada se pide al servidor un permiso de Firebase
// (ID + rol) y se abre sesión en Firebase Auth. En esta etapa las reglas de Firestore no cambian: si algo
// falla, la app sigue igual (solo queda el aviso en la consola). Firebase mantiene la sesión en el teléfono.
// =====================================================================
(function () {
  const auth = () => (window.firebase && typeof window.firebase.auth === 'function') ? window.firebase.auth() : null;

  // Abre la sesión de Firebase para ese ID. No lanza errores: devuelve { ok, motivo }.
  async function abrir(empleadoId, claveCifrada) {
    const a = auth();
    const id = String(empleadoId || '').trim();
    if (!a || !id || !claveCifrada) return { ok: false, motivo: 'sin datos o sin Firebase Auth' };
    try {
      if (a.currentUser && a.currentUser.uid === id) return { ok: true, motivo: 'ya tenía sesión' };
      const fb = window.FirebaseBackend;
      if (!fb || typeof fb._post !== 'function') return { ok: false, motivo: 'servicio no disponible' };
      const r = await fb._post({ accion: 'sesionFirebase', empleadoId: id, pin: String(claveCifrada) });
      if (!r || !r.ok || !r.customToken) {
        console.warn('[Sesión Firebase] No se emitió el permiso:', (r && r.error) || 'sin respuesta');
        return { ok: false, motivo: (r && r.error) || 'sin respuesta' };
      }
      await a.signInWithCustomToken(r.customToken);
      console.log('[Sesión Firebase] Sesión abierta:', id, r.rol);
      return { ok: true, rol: r.rol };
    } catch (e) {
      console.warn('[Sesión Firebase] No se pudo abrir la sesión:', e && (e.code || e.message) || e);
      return { ok: false, motivo: String(e && (e.code || e.message) || e) };
    }
  }

  // Terminal del guardia: sesión con la clave del terminal (rol 'guardia', uid 'terminal_guardia')
  const UID_TERMINAL = 'terminal_guardia';
  async function abrirTerminal(clave) {
    const a = auth();
    if (!a || !clave) return { ok: false, motivo: 'sin datos o sin Firebase Auth' };
    try {
      if (a.currentUser && a.currentUser.uid === UID_TERMINAL) return { ok: true, motivo: 'ya tenía sesión' };
      const fb = window.FirebaseBackend;
      if (!fb || typeof fb._post !== 'function') return { ok: false, motivo: 'servicio no disponible' };
      const r = await fb._post({ accion: 'sesionFirebaseGuardia', clave: String(clave) });
      if (!r || !r.ok || !r.customToken) return { ok: false, motivo: (r && r.error) || 'sin respuesta' };
      await a.signInWithCustomToken(r.customToken);
      console.log('[Sesión Firebase] Terminal del guardia con sesión');
      return { ok: true, rol: 'guardia' };
    } catch (e) {
      console.warn('[Sesión Firebase] Terminal sin sesión:', e && (e.code || e.message) || e);
      return { ok: false, motivo: String(e && (e.code || e.message) || e) };
    }
  }

  // Abre la sesión con un permiso ya emitido por el servidor (ingreso o creación de contraseña)
  async function usarPermiso(customToken, uidEsperado) {
    const a = auth();
    if (!a || !customToken) return false;
    try {
      if (a.currentUser && a.currentUser.uid === String(uidEsperado || '')) return true;
      await a.signInWithCustomToken(customToken);
      return true;
    } catch (e) { console.warn('[Sesión Firebase] Permiso no usado:', e && (e.code || e.message) || e); return false; }
  }

  async function cerrar() {
    try { const a = auth(); if (a && a.currentUser) await a.signOut(); } catch (e) { console.warn('[Sesión Firebase] Al cerrar:', e); }
  }

  // ID y rol de la sesión abierta (o null). El rol viene firmado por el servidor.
  async function estado() {
    const a = auth();
    if (!a || !a.currentUser) return null;
    try {
      const t = await a.currentUser.getIdTokenResult();
      return { uid: a.currentUser.uid, rol: t.claims.rol || '', externo: !!t.claims.externo };
    } catch (e) { return { uid: a.currentUser.uid, rol: '' }; }
  }

  // Espera a que Firebase diga si hay sesión guardada en el teléfono (la primera respuesta de onAuthStateChanged)
  function usuarioGuardado() {
    const a = auth();
    if (!a) return Promise.resolve(null);
    return new Promise(res => { const fin = a.onAuthStateChanged(u => { fin(); res(u); }); });
  }

  async function sha256(texto) {
    const datos = new TextEncoder().encode(String(texto).trim());
    const h = await crypto.subtle.digest('SHA-256', datos);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Quien entra con la sesión guardada (sin escribir la contraseña) y aún no tiene sesión de Firebase: se le pide
  // la contraseña UNA vez. "Ahora no" la vuelve a pedir al día siguiente. No bloquea el uso de la app.
  const KEY_OMITIDA = 'tcontrol_sesion_fb_omitida';
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let pidiendo = false;

  // opts.terminal: terminal del guardia (pide la clave del terminal en vez de la contraseña personal)
  async function asegurar(empleadoId, opts) {
    const terminal = !!(opts && opts.terminal);
    const id = terminal ? UID_TERMINAL : String(empleadoId || '').trim();
    if (!id || pidiendo || !auth()) return;
    const u = await usuarioGuardado();
    if (u && u.uid === id) return;                    // ya tiene sesión
    if (u && u.uid !== id) await cerrar();            // sesión de otra persona en este equipo
    try { if (localStorage.getItem(KEY_OMITIDA) === id + '|' + hoy()) return; } catch (e) { }
    pidiendo = true;
    mostrarModal(id, terminal);
  }

  function mostrarModal(id, terminal) {
    const fondo = document.createElement('div');
    fondo.id = 'modalSesionFirebase';
    fondo.setAttribute('role', 'dialog');
    fondo.setAttribute('aria-modal', 'true');
    fondo.setAttribute('aria-labelledby', 'sfbTitulo');
    fondo.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; padding:16px; font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';
    fondo.innerHTML = `
      <form style="background:#fff; border-radius:16px; padding:22px; width:100%; max-width:360px; box-shadow:0 20px 40px rgba(0,0,0,.25);">
        <div style="width:44px; height:44px; border-radius:12px; background:#eff6ff; color:#2563eb; display:flex; align-items:center; justify-content:center; font-size:20px; margin-bottom:10px;"><i class="fas fa-shield-alt"></i></div>
        <h3 id="sfbTitulo" style="margin:0 0 6px; font-size:17px; color:#0f172a;">${terminal ? 'Confirma la clave del terminal' : 'Confirma tu contraseña'}</h3>
        <p style="margin:0 0 14px; font-size:13px; color:#475569; line-height:1.45;">Estamos reforzando la seguridad del sistema. Escribe ${terminal ? 'la clave del terminal' : 'tu contraseña'} <strong>una sola vez</strong>; después no te la volveremos a pedir en este ${terminal ? 'equipo' : 'teléfono'}.</p>
        <label for="sfbClave" style="font-size:12px; font-weight:700; color:#334155;">${terminal ? 'Clave del terminal' : 'Contraseña'}</label>
        <input id="sfbClave" type="password" autocomplete="current-password" required maxlength="40" style="width:100%; box-sizing:border-box; margin:4px 0 6px; padding:11px 12px; font-size:16px; border:1px solid #cbd5e1; border-radius:10px;">
        <p id="sfbMsg" role="status" style="min-height:18px; margin:0 0 10px; font-size:12.5px; color:#b91c1c;"></p>
        <button type="submit" style="width:100%; padding:12px; border:0; border-radius:10px; background:#2563eb; color:#fff; font-size:15px; font-weight:700; cursor:pointer;">Confirmar</button>
        <button type="button" data-sfb-omitir style="width:100%; margin-top:8px; padding:10px; border:0; background:transparent; color:#64748b; font-size:13px; cursor:pointer;">Ahora no</button>
        <p style="margin:8px 0 0; font-size:11.5px; color:#94a3b8; text-align:center;">${terminal ? '¿No la tienes? Pídela a tu supervisor.' : '¿No la recuerdas? Cierra sesión y usa “¿Olvidaste tu contraseña?”.'}</p>
      </form>`;
    document.body.appendChild(fondo);
    const form = fondo.querySelector('form');
    const input = fondo.querySelector('#sfbClave');
    const msg = fondo.querySelector('#sfbMsg');
    const btn = form.querySelector('button[type="submit"]');
    const cerrarModal = () => { fondo.remove(); pidiendo = false; };
    setTimeout(() => input.focus(), 50);

    fondo.querySelector('[data-sfb-omitir]').addEventListener('click', () => {
      try { localStorage.setItem(KEY_OMITIDA, id + '|' + hoy()); } catch (e) { }
      cerrarModal();
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const clave = input.value.trim();
      if (!clave) { msg.textContent = 'Escribe tu contraseña.'; return; }
      btn.disabled = true; btn.textContent = 'Verificando…'; msg.textContent = '';
      const r = terminal ? await abrirTerminal(clave) : await abrir(id, await sha256(clave));
      if (r.ok) {
        cerrarModal();
        if (typeof window.mostrarToast === 'function') window.mostrarToast('Listo, gracias. Tu acceso quedó protegido.', 'success');
        return;
      }
      btn.disabled = false; btn.textContent = 'Confirmar';
      msg.textContent = /incorrecta/i.test(r.motivo || '') ? (terminal ? 'Clave incorrecta. Revísala e inténtalo de nuevo.' : 'Contraseña incorrecta. Revísala e inténtalo de nuevo.')
        : /intentos/i.test(r.motivo || '') ? r.motivo
        : 'No se pudo verificar en este momento. Puedes intentarlo más tarde con “Ahora no”.';
      input.select();
    });
  }

  // Páginas que usan la sesión del panel (ubicación, visor, admin, catering…): si hay sesión de supervisor
  // guardada y no hay sesión de Firebase, se pide la contraseña una vez.
  function asegurarDesdeSesionGuardada(...claves) {
    for (const k of claves.length ? claves : ['SUPERVISOR_SESSION']) {
      try {
        const s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s && s.id) { setTimeout(() => asegurar(s.id), 2500); return; }
      } catch (e) { }
    }
  }

  window.SesionFirebase = { abrir, abrirTerminal, usarPermiso, cerrar, estado, asegurar, asegurarDesdeSesionGuardada };
})();
