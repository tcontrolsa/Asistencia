/**
 * Asistencia Tcontrol - Centro de notificaciones (campana)
 * Compartido por index.html (app) y supervisor.html (panel).
 *
 * Avisos: Firestore `notificaciones` {para, tipo, titulo, texto, enlace, creada, leidaPor[], clave}.
 * Los crea Apps Script (notificaciones.gs) a partir de eventos y recordatorios; aquí solo se leen
 * en vivo y se marcan como leídos. `para` es el ID del colaborador o 'rol:rrhh'.
 * Al leerse, un aviso sale de la lista (queda en "Ver leídas" hasta que se borra a los 60 días).
 *
 * Uso: Notificaciones.montar(contenedor, { empleadoId, rrhh, onAbrir(enlace, aviso) })
 */
(function () {
  'use strict';

  const ICONOS = {
    evaluacion_recibida: ['fa-clipboard-check', 'nt-azul'],
    evaluacion_corregida: ['fa-pen', 'nt-azul'],
    evaluacion_confirmada: ['fa-check-circle', 'nt-verde'],
    evaluaciones_pendientes: ['fa-hourglass-half', 'nt-ambar'],
    evaluacion_por_confirmar: ['fa-bell', 'nt-ambar'],
    dia75: ['fa-seedling', 'nt-verde'],
    alerta_desempeno: ['fa-exclamation-triangle', 'nt-rojo'],
    plazo_por_vencer: ['fa-hourglass-end', 'nt-rojo'],
    vigencia_por_vencer: ['fa-calendar-times', 'nt-ambar'],
    reunion_solicitada: ['fa-comments', 'nt-azul'],
    reunion_agendada: ['fa-calendar-check', 'nt-verde'],
    visita_solicitada: ['fa-id-card-alt', 'nt-ambar'],
    visita_confirmada: ['fa-user-check', 'nt-verde'],
    visita_llego: ['fa-door-open', 'nt-azul'],
    visita_cancelada: ['fa-ban', 'nt-gris'],
    visita_calificada: ['fa-star', 'nt-verde'],
    general: ['fa-info-circle', 'nt-gris']
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hace(fecha) {
    if (!fecha) return '';
    const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const dias = Math.round(h / 24);
    if (dias < 7) return `hace ${dias} día${dias === 1 ? '' : 's'}`;
    return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' });
  }

  function montar(host, opts) {
    if (!host || !opts || !opts.empleadoId) return null;
    if (host._notif) {
      if (host._notif.clave === `${opts.empleadoId}|${!!opts.rrhh}`) return host._notif;
      host._notif.destruir();
    }
    const yo = String(opts.empleadoId);
    const destinos = [yo].concat(opts.rrhh ? ['rol:rrhh'] : []);
    const st = { lista: [], abierto: false, error: '', verLeidas: false };

    host.classList.add('nt-host');
    host.innerHTML = `
      <button type="button" class="nt-btn" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">
        <i class="fas fa-bell"></i><span class="nt-badge" hidden>0</span>
      </button>
      <div class="nt-panel" hidden role="dialog" aria-label="Notificaciones">
        <div class="nt-cab"><strong>Notificaciones</strong><button type="button" class="nt-link" data-nt="todas">Marcar todo como leído</button></div>
        <div class="nt-lista"></div>
        <div class="nt-pie"><button type="button" class="nt-link nt-link-gris" data-nt="leidas" hidden></button></div>
      </div>`;
    const btn = host.querySelector('.nt-btn');
    const panel = host.querySelector('.nt-panel');
    const badge = host.querySelector('.nt-badge');
    const listaEl = host.querySelector('.nt-lista');
    const btnLeidas = host.querySelector('[data-nt="leidas"]');

    const leida = n => (n.leidaPor || []).includes(yo);

    function pintar() {
      const sinLeer = st.lista.filter(n => !leida(n)).length;
      badge.hidden = !sinLeer;
      badge.textContent = sinLeer > 9 ? '9+' : String(sinLeer);
      btn.classList.toggle('nt-btn-activo', sinLeer > 0);
      const nLeidas = st.lista.length - sinLeer;
      // Las leídas salen de la lista; se pueden consultar con "Ver leídas"
      btnLeidas.hidden = !nLeidas;
      btnLeidas.textContent = st.verLeidas ? 'Ocultar leídas' : `Ver leídas (${nLeidas})`;
      const visibles = st.verLeidas ? st.lista : st.lista.filter(n => !leida(n));
      if (st.error) { listaEl.innerHTML = `<div class="nt-vacio">${esc(st.error)}</div>`; return; }
      if (!visibles.length) { listaEl.innerHTML = '<div class="nt-vacio"><i class="far fa-bell"></i>No tienes notificaciones nuevas.</div>'; return; }
      listaEl.innerHTML = visibles.map(n => {
        const [ico, color] = ICONOS[n.tipo] || ICONOS.general;
        return `<button type="button" class="nt-item ${leida(n) ? '' : 'nt-nueva'}" data-id="${esc(n.id)}">
          <span class="nt-ico ${color}"><i class="fas ${ico}"></i></span>
          <span class="nt-txt"><strong>${esc(n.titulo)}</strong><span>${esc(n.texto)}</span><small>${esc(hace(n.creada))}${n.para === 'rol:rrhh' ? ' · RR.HH.' : ''}</small></span>
          ${leida(n) ? '' : '<span class="nt-punto" aria-label="Sin leer"></span>'}
        </button>`;
      }).join('');
    }

    function abrir(si) {
      st.abierto = si;
      panel.hidden = !si;
      btn.setAttribute('aria-expanded', si ? 'true' : 'false');
    }

    async function marcar(ids) {
      const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
      if (!db || !ids.length) return;
      const batch = db.batch();
      ids.forEach(id => batch.update(db.collection('notificaciones').doc(id), { leidaPor: window.firebase.firestore.FieldValue.arrayUnion(yo) }));
      try { await batch.commit(); } catch (e) { console.warn('No se pudieron marcar las notificaciones:', e); }
    }

    btn.addEventListener('click', ev => { ev.stopPropagation(); abrir(!st.abierto); });
    panel.addEventListener('click', ev => {
      ev.stopPropagation();
      if (ev.target.closest('[data-nt="todas"]')) {
        marcar(st.lista.filter(n => !leida(n)).map(n => n.id));
        return;
      }
      if (ev.target.closest('[data-nt="leidas"]')) {
        st.verLeidas = !st.verLeidas;
        pintar();
        return;
      }
      const item = ev.target.closest('.nt-item');
      if (!item) return;
      const n = st.lista.find(x => x.id === item.dataset.id);
      if (!n) return;
      if (!leida(n)) marcar([n.id]);
      abrir(false);
      if (typeof opts.onAbrir === 'function' && n.enlace && n.enlace.modulo) opts.onAbrir(n.enlace, n);
    });
    const fuera = () => { if (st.abierto) abrir(false); };
    const tecla = ev => { if (ev.key === 'Escape') fuera(); };
    document.addEventListener('click', fuera);
    document.addEventListener('keydown', tecla);

    let cancelar = null;
    try {
      const db = window.firebase.firestore();
      cancelar = db.collection('notificaciones').where('para', 'in', destinos).onSnapshot(snap => {
        st.error = '';
        st.lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.creada && a.creada.toMillis ? a.creada.toMillis() : 0;
            const tb = b.creada && b.creada.toMillis ? b.creada.toMillis() : 0;
            return tb - ta;
          }).slice(0, 40);
        pintar();
      }, err => {
        console.warn('Notificaciones no disponibles:', err);
        st.error = 'No se pudieron cargar las notificaciones.';
        pintar();
      });
    } catch (e) {
      st.error = 'No se pudieron cargar las notificaciones.';
    }
    pintar();

    host._notif = {
      clave: `${yo}|${!!opts.rrhh}`,
      destruir() {
        if (cancelar) cancelar();
        document.removeEventListener('click', fuera);
        document.removeEventListener('keydown', tecla);
        host.innerHTML = '';
        host._notif = null;
      }
    };
    return host._notif;
  }

  window.Notificaciones = { montar };
})();
