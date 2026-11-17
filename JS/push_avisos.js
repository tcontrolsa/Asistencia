/**
 * Asistencia Tcontrol - Avisos emergentes (Web Push con Firebase Cloud Messaging)
 *
 * Cada dispositivo que activa los avisos guarda su token en Firestore:
 *   push_tokens/{empleadoId} -> { tokens: [token, ...], actualizado }
 * El envío lo hace Apps Script (push_fcm.gs) cada vez que se crea un aviso de la campana.
 * El service worker (sw.js) muestra la notificación y abre la app al tocarla.
 *
 * API: PushAvisos.soportado(), PushAvisos.estado() -> 'activo'|'inactivo'|'bloqueado'|'no_soportado'|
 *      'instalar_ios' (iPhone sin instalar la app)|'ios_antiguo' (iOS menor a 16.4),
 *      PushAvisos.activar(empleadoId), PushAvisos.desactivar(empleadoId)
 */
(function () {
  'use strict';

  // Clave pública Web Push (VAPID). Es pública por diseño.
  const VAPID_KEY = 'BK6eXWXFur5LS76-h15iByuu36iwXeL-67oUQLza52-fAVFbxURlj3isVaAS9xuKOpoDYPYOTJZFnmZXo6iobEc';
  const LS_TOKEN = 'tcontrol_push_token';

  const leerLS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const guardarLS = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } };

  function soportado() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window &&
      !!(window.firebase && window.firebase.messaging && window.firebase.messaging.isSupported && window.firebase.messaging.isSupported());
  }

  // iPhone/iPad: Safari solo admite avisos si la app está instalada en la pantalla de inicio (iOS 16.4+)
  function esIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function instalada() {
    return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function estado() {
    if (esIOS() && !instalada()) return 'instalar_ios';
    if (!soportado()) return esIOS() ? 'ios_antiguo' : 'no_soportado';
    if (Notification.permission === 'denied') return 'bloqueado';
    return Notification.permission === 'granted' && leerLS(LS_TOKEN) ? 'activo' : 'inactivo';
  }

  function docTokens(empleadoId) {
    return window.firebase.firestore().collection('push_tokens').doc(String(empleadoId));
  }

  async function activar(empleadoId) {
    if (!soportado()) throw new Error('Este navegador no admite avisos emergentes.');
    // Un administrador puede apagar los avisos de una persona (campo `apagado` en push_tokens)
    try {
      const previo = await docTokens(empleadoId).get();
      if (previo.exists && previo.data().apagado) {
        guardarLS(LS_TOKEN, '');
        try { await window.firebase.messaging().deleteToken(); } catch (e) { }
        throw new Error('Los avisos emergentes fueron desactivados por un administrador. Consulta con RR.HH.');
      }
    } catch (e) {
      if (/administrador/.test(String(e && e.message))) throw e;
      // sin permiso de lectura o sin red: se continúa y las reglas deciden al guardar
    }
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('Los avisos no fueron permitidos en este dispositivo.');
    const reg = await navigator.serviceWorker.ready;
    const token = await window.firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('No se pudo registrar el dispositivo.');
    await docTokens(empleadoId).set({
      tokens: window.firebase.firestore.FieldValue.arrayUnion(token),
      actualizado: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    guardarLS(LS_TOKEN, token);
    return token;
  }

  async function desactivar(empleadoId) {
    const token = leerLS(LS_TOKEN);
    try {
      if (token) {
        await docTokens(empleadoId).set({
          tokens: window.firebase.firestore.FieldValue.arrayRemove(token),
          actualizado: window.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await window.firebase.messaging().deleteToken();
    } finally {
      guardarLS(LS_TOKEN, '');
    }
  }

  // Si el token ya estaba activo, lo renueva en silencio (los tokens pueden cambiar).
  async function refrescar(empleadoId) {
    if (estado() !== 'activo') return;
    try { await activar(empleadoId); } catch (e) { console.warn('Push: no se pudo renovar el token:', e); }
  }

  // Al tocar una notificación con la app abierta, el service worker avisa para abrir el módulo.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'PUSH_ABRIR') {
        window.dispatchEvent(new CustomEvent('push-abrir', { detail: ev.data.enlace || null }));
      }
    });
  }

  window.PushAvisos = { soportado, esIOS, instalada, estado, activar, desactivar, refrescar };
})();
