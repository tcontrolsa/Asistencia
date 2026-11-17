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

  // Invitación: pregunta una vez si quiere recibir avisos emergentes (el permiso del navegador solo se puede
  // pedir con un toque de la persona). "Ahora no" la oculta 7 días; si ya los activó o están bloqueados, no aparece.
  const LS_INVITACION = 'tcontrol_push_invitacion';
  function invitar(empleadoId) {
    const e = estado();
    if (e !== 'inactivo' && e !== 'instalar_ios') return;
    if (Date.now() - Number(leerLS(LS_INVITACION) || 0) < 7 * 24 * 3600 * 1000) return;
    if (document.getElementById('pushInvitacion') || !empleadoId) return;
    const ios = e === 'instalar_ios';
    const caja = document.createElement('div');
    caja.id = 'pushInvitacion';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-label', 'Notificaciones');
    caja.style.cssText = 'position:fixed; left:12px; right:12px; bottom:84px; max-width:420px; margin:0 auto; z-index:2500; background:#fff; border:1px solid #e2e8f0; border-radius:14px; box-shadow:0 10px 30px rgba(15,23,42,.22); padding:14px 16px; font-family:inherit;';
    caja.innerHTML = ios
      ? `<div style="font-weight:800; color:#1e293b; font-size:14px; margin-bottom:4px;">🔔 ¿Quieres recibir notificaciones?</div>
         <div style="font-size:12.5px; color:#475569; line-height:1.45;">En iPhone primero instala la app: abre esta página en <strong>Safari</strong>, toca <strong>Compartir</strong>, elige <strong>Añadir a pantalla de inicio</strong> y ábrela desde el icono nuevo. Luego activa los avisos desde la campana. (Requiere iOS 16.4 o superior.)</div>
         <div style="display:flex; justify-content:flex-end; margin-top:10px;"><button type="button" data-pi="no" style="border:0; background:#6366f1; color:#fff; font-weight:700; border-radius:8px; padding:8px 16px; font-size:13px;">Entendido</button></div>`
      : `<div style="font-weight:800; color:#1e293b; font-size:14px; margin-bottom:4px;">🔔 ¿Quieres recibir notificaciones?</div>
         <div style="font-size:12.5px; color:#475569; line-height:1.45;">Te avisaremos de permisos, visitas y evaluaciones aunque la app esté cerrada. Puedes desactivarlas cuando quieras desde la campana.</div>
         <div data-pi="msg" role="status" style="font-size:12px; color:#b91c1c; margin-top:6px; min-height:0;"></div>
         <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
           <button type="button" data-pi="no" style="border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; border-radius:8px; padding:8px 14px; font-size:13px;">Ahora no</button>
           <button type="button" data-pi="si" style="border:0; background:#6366f1; color:#fff; font-weight:700; border-radius:8px; padding:8px 16px; font-size:13px;">Activar</button>
         </div>`;
    const cerrar = () => { guardarLS(LS_INVITACION, String(Date.now())); caja.remove(); };
    caja.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pi]');
      if (!b) return;
      if (b.dataset.pi === 'no') { cerrar(); return; }
      if (b.dataset.pi === 'si') {
        b.disabled = true;
        activar(empleadoId).then(() => { caja.remove(); window.dispatchEvent(new CustomEvent('push-estado')); })
          .catch(err => {
            const m = caja.querySelector('[data-pi="msg"]');
            if (m) m.textContent = (err && err.message) || 'No se pudo activar.';
            b.disabled = false;
            const no = caja.querySelector('[data-pi="no"]'); if (no) no.textContent = 'Cerrar';
            guardarLS(LS_INVITACION, String(Date.now()));
          });
      }
    });
    document.body.appendChild(caja);
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

  window.PushAvisos = { soportado, esIOS, instalada, estado, activar, desactivar, refrescar, invitar };
})();
