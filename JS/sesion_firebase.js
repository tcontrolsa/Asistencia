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

  window.SesionFirebase = { abrir, cerrar, estado };
})();
