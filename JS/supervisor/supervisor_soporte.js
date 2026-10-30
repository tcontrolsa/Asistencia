/**
 * TCONTROL · Soporte WhatsApp (panel → Soporte WhatsApp, solo Admin Master)
 *
 * Bandeja para leer y responder lo que la gente escribe al número del bot (OpenWA).
 * - Lee los chats y mensajes por el puente del túnel (tunel_cloudflare.py), que solo los entrega con
 *   el token de Admin Master (el mismo de Desempeño: tokenEvaluacion verifica el PIN y pone master).
 * - Responde con send-text (sale desde el número del bot, sin firma).
 * - Por defecto muestra solo los chats donde la persona escribió (el bot también envía avisos).
 * - Consulta cada 15 s con la sección abierta (cada 5 s el chat abierto) y cada 60 s en segundo plano
 *   para el contador del menú.
 */
(function () {
  const SO = {
    chats: [], sel: '', msgs: {}, filtro: 'escribieron', busca: '', error: '', cargando: false,
    tsChats: 0, tsMsgs: 0, enviando: false, timer: null, montado: false
  };
  const KEY_CONOCIDOS = 'tcontrol_soporte_escribieron';
  const RESPUESTAS = ['Hola, recibimos tu mensaje. Ya lo revisamos.', 'Listo, ya quedó corregido. Por favor revisa en la app.',
    '¿Nos envías una captura de pantalla del problema?', 'Por favor cierra la app y vuelve a abrirla, y nos cuentas si sigue pasando.'];

  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const yoId = () => { try { return String(JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').id || ''); } catch (e) { return ''; } };
  const sesion = () => window.EvaluacionDesempeno && window.EvaluacionDesempeno.sesion ? window.EvaluacionDesempeno.sesion(yoId()) : null;
  const tsMs = t => !t ? 0 : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : (Date.parse(t) || 0);

  // Chats donde la persona escribió alguna vez (se recuerdan aunque el último mensaje sea nuestra respuesta)
  const conocidos = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY_CONOCIDOS) || '[]')); } catch (e) { return new Set(); } };
  function recordar(ids) {
    const s = conocidos(); let cambio = false;
    ids.forEach(id => { if (!s.has(id)) { s.add(id); cambio = true; } });
    if (cambio) try { localStorage.setItem(KEY_CONOCIDOS, JSON.stringify([...s].slice(-500))); } catch (e) { }
  }

  async function api(metodo, ruta, cuerpo) {
    const ses = sesion();
    if (!ses || !ses.master) { const e = new Error('Sesión de soporte vencida'); e.sinSesion = true; throw e; }
    const svc = window.OpenWAService;
    if (!svc) throw new Error('Servicio de WhatsApp no disponible');
    if (svc.refrescarUrlDesdeFirestore && Date.now() - (SO.tsUrl || 0) > 5 * 60 * 1000) { SO.tsUrl = Date.now(); await svc.refrescarUrlDesdeFirestore(); }
    const base = svc._obtenerUrlBase();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(`${base}/api/sessions/${encodeURIComponent(svc._sessionId)}${ruta}`, {
        method: metodo, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Tcontrol-Soporte': ses.token },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { const e = new Error(j.error || 'Sesión de soporte vencida'); e.sinSesion = true; throw e; }
      if (r.status === 403) throw new Error('El puente del servidor aún no tiene habilitada la bandeja de soporte');
      if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('El servidor de WhatsApp no respondió');
      throw e;
    } finally { clearTimeout(t); }
  }
  const lista = j => Array.isArray(j) ? j : (j.data || j.chats || j.messages || j.items || []);

  // --------------------------------------------------------------- datos
  function numeroDe(chatId) {
    const m = String(chatId).match(/^(\d{8,15})@c\.us$/);
    return m ? m[1] : '';
  }
  function empleadoDe(chatId) {
    const num = numeroDe(chatId);
    if (!num) return null;
    const norm = t => { const d = String(t || '').replace(/\D/g, ''); return d.startsWith('593') ? d : d.startsWith('0') ? '593' + d.slice(1) : d.length === 9 ? '593' + d : d; };
    return (typeof empCache !== 'undefined' && Array.isArray(empCache) ? empCache : []).find(e => e.telefono && norm(e.telefono) === num) || null;
  }
  function normChat(c) {
    const id = String((c.id && c.id._serialized) || c.chatId || c.id || '');
    const u = c.lastMessage || c.last_message || {};
    return {
      id, nombre: c.name || c.formattedTitle || (c.contact && (c.contact.name || c.contact.pushname)) || '',
      noLeidos: Number(c.unreadCount || c.unread || 0), ts: tsMs(c.timestamp || c.lastMessageAt || u.timestamp),
      ultimo: u.body || u.caption || (u.type && u.type !== 'chat' && u.type !== 'text' ? '[' + tipoTexto(u.type) + ']' : ''),
      ultimoMio: !!u.fromMe, grupo: !!c.isGroup || /@g\.us$|@broadcast$|@newsletter$/.test(id)
    };
  }
  function normMsg(m) {
    return {
      id: String((m.id && m.id._serialized) || m.id || m.messageId || ''), cuerpo: m.body || m.caption || m.text || '',
      mio: !!m.fromMe, ts: tsMs(m.timestamp || m.createdAt), tipo: m.type || 'chat', ack: m.ack
    };
  }
  function tipoTexto(t) {
    return ({ image: 'Imagen', video: 'Video', audio: 'Audio', ptt: 'Nota de voz', document: 'Documento', sticker: 'Sticker', location: 'Ubicación', vcard: 'Contacto' })[t] || 'Archivo';
  }
  const visible = c => !c.grupo && (SO.filtro === 'todos' || c.noLeidos > 0 || !c.ultimoMio || conocidos().has(c.id));

  async function cargarChats() {
    if (SO.cargando) return;
    SO.cargando = true;
    try {
      const j = await api('GET', '/chats?limit=100');
      SO.chats = lista(j).map(normChat).filter(c => c.id).sort((a, b) => b.ts - a.ts);
      recordar(SO.chats.filter(c => !c.grupo && (!c.ultimoMio || c.noLeidos > 0)).map(c => c.id));
      SO.error = ''; SO.tsChats = Date.now();
    } catch (e) {
      SO.error = e.message; if (e.sinSesion) SO.sinSesion = true;
    } finally {
      SO.cargando = false;
      pintarContador();
      pintar();
    }
  }

  async function cargarMensajes(chatId, marcar) {
    try {
      const j = await api('GET', `/messages?chatId=${encodeURIComponent(chatId)}&limit=100`);
      const msgs = lista(j).map(normMsg).sort((a, b) => a.ts - b.ts);
      SO.msgs[chatId] = msgs; SO.tsMsgs = Date.now();
      if (msgs.some(m => !m.mio)) recordar([chatId]);
      const c = SO.chats.find(x => x.id === chatId);
      if (marcar && c && c.noLeidos) {
        c.noLeidos = 0; pintarContador();
        api('POST', '/chats/read', { chatId }).catch(e => console.warn('Soporte: marcar leído', e));
      }
    } catch (e) {
      SO.error = e.message; if (e.sinSesion) SO.sinSesion = true;
    }
    pintar();
  }

  // --------------------------------------------------------------- acciones
  window.soAbrirChat = function (id) {
    SO.sel = id;
    pintar();
    cargarMensajes(id, true);
  };
  window.soVolver = function () { SO.sel = ''; pintar(); };
  window.soFiltro = function (f) { SO.filtro = f; pintar(); };
  window.soBuscar = function (v) { SO.busca = v; pintar(); };
  window.soRespuesta = function (i) {
    const ta = document.getElementById('soTexto');
    if (!ta) return;
    ta.value = RESPUESTAS[i]; ta.focus();
  };
  window.soTecla = function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); window.soEnviar(); }
  };
  window.soEnviar = async function () {
    const ta = document.getElementById('soTexto');
    const texto = (ta && ta.value || '').trim();
    if (!texto || !SO.sel || SO.enviando) return;
    SO.enviando = true;
    const chatId = SO.sel;
    const temp = { id: 'tmp' + Date.now(), cuerpo: texto, mio: true, ts: Date.now(), tipo: 'chat', pendiente: true };
    (SO.msgs[chatId] = SO.msgs[chatId] || []).push(temp);
    ta.value = '';
    pintar();
    try {
      await api('POST', '/messages/send-text', { chatId, text: texto });
      temp.pendiente = false;
    } catch (e) {
      temp.error = e.message;
      if (ta && !ta.value) ta.value = texto;
      if (typeof mostrarToast === 'function') mostrarToast('No se pudo enviar: ' + e.message, 'error');
    } finally {
      SO.enviando = false;
      pintar();
      setTimeout(() => { if (SO.sel === chatId) cargarMensajes(chatId, false); }, 2500);
    }
  };
  window.soIngresar = async function () {
    const pin = (document.getElementById('soPin') || {}).value || '';
    const msg = document.getElementById('soPinMsg');
    if (!pin.trim()) { if (msg) msg.textContent = 'Ingresa tu PIN.'; return; }
    if (msg) msg.textContent = 'Verificando…';
    try {
      const s = await window.EvaluacionDesempeno.iniciarSesion(yoId(), pin.trim());
      if (!s.master) { if (msg) msg.textContent = 'La bandeja de soporte es solo para el Admin Master.'; return; }
      SO.sinSesion = false; SO.error = '';
      pintar();
      cargarChats();
    } catch (e) { if (msg) msg.textContent = e.message; }
  };

  // --------------------------------------------------------------- vista
  const hora = ms => {
    if (!ms) return '';
    const d = new Date(ms), hoy = new Date();
    return d.toDateString() === hoy.toDateString() ? d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' });
  };
  function avatar(chat) {
    const e = empleadoDe(chat.id);
    const nombre = (e && e.nombre) || chat.nombre || numeroDe(chat.id) || '?';
    const ini = String(nombre).trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
    const fx = window.fixFotoUrl || window.formatearUrlFoto;
    const src = e && e.foto_url ? (fx ? fx(e.foto_url, 120) : e.foto_url) : '';
    return `<div class="so-avatar"><span>${esc(ini)}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
  }
  function titulo(chat) {
    const e = empleadoDe(chat.id);
    const num = numeroDe(chat.id);
    return { nombre: (e && e.nombre) || chat.nombre || (num ? '+' + num : 'Contacto'), sub: e ? `${e.area || ''} · ${e.id}` : (num ? '+' + num : 'Sin número visible') };
  }

  function pintar() {
    const cont = document.getElementById('soPanel');
    if (!cont) return;
    if (!sesion() || SO.sinSesion) {
      cont.innerHTML = `<div class="so-login"><i class="fab fa-whatsapp"></i><h3>Soporte WhatsApp</h3>
        <p>Las conversaciones pueden tener datos personales: confirma tu PIN para abrir la bandeja (vale 8 horas).</p>
        <input type="password" id="soPin" inputmode="numeric" autocomplete="current-password" placeholder="PIN" onkeydown="if(event.key==='Enter') soIngresar()">
        <button type="button" onclick="soIngresar()"><i class="fas fa-unlock"></i> Abrir bandeja</button>
        <div id="soPinMsg" class="so-pin-msg">${SO.sinSesion && sesion() ? 'Tu sesión venció. Ingresa tu PIN de nuevo.' : ''}</div></div>`;
      return;
    }
    // Conserva lo escrito y el foco al redibujar
    const ta = document.getElementById('soTexto');
    const borrador = ta ? { v: ta.value, foco: document.activeElement === ta } : null;
    const bus = document.getElementById('soBusca');
    const focoBusca = bus && document.activeElement === bus ? bus.selectionStart : null;

    const q = SO.busca.trim().toLowerCase();
    const chats = SO.chats.filter(visible).filter(c => !q || `${titulo(c).nombre} ${titulo(c).sub} ${c.ultimo}`.toLowerCase().includes(q));
    const noLeidos = SO.chats.filter(visible).reduce((n, c) => n + (c.noLeidos ? 1 : 0), 0);
    const chatSel = SO.chats.find(c => c.id === SO.sel);

    const listaHtml = chats.length ? chats.map(c => {
      const t = titulo(c);
      return `<button type="button" class="so-chat ${c.id === SO.sel ? 'on' : ''} ${c.noLeidos ? 'nuevo' : ''}" onclick="soAbrirChat('${esc(c.id)}')">
        ${avatar(c)}<div class="so-chat-txt"><div class="so-chat-l1"><strong>${esc(t.nombre)}</strong><small>${hora(c.ts)}</small></div>
        <div class="so-chat-l2"><span>${c.ultimoMio ? '<i class="fas fa-reply"></i> ' : ''}${esc(c.ultimo || ' ')}</span>${c.noLeidos ? `<b>${c.noLeidos}</b>` : ''}</div></div></button>`;
    }).join('') : `<div class="so-vacio">${SO.tsChats ? (q ? 'Sin resultados.' : 'No hay conversaciones de soporte.') : '<i class="fas fa-spinner fa-spin"></i> Cargando conversaciones…'}</div>`;

    let chatHtml;
    if (!chatSel) {
      chatHtml = `<div class="so-sin-chat"><i class="far fa-comments"></i><p>Elige una conversación para leerla y responder.</p></div>`;
    } else {
      const t = titulo(chatSel);
      const msgs = SO.msgs[chatSel.id];
      let dia = '';
      const burbujas = !msgs ? '<div class="so-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando mensajes…</div>'
        : !msgs.length ? '<div class="so-vacio">No hay mensajes guardados en este chat.</div>'
        : msgs.map(m => {
          const d = m.ts ? new Date(m.ts).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
          const sep = d && d !== dia ? `<div class="so-dia">${esc(d)}</div>` : '';
          dia = d || dia;
          const cuerpo = m.cuerpo ? esc(m.cuerpo).replace(/\n/g, '<br>') : '';
          const media = m.tipo && !['chat', 'text'].includes(m.tipo) ? `<div class="so-media"><i class="fas fa-paperclip"></i> ${tipoTexto(m.tipo)} (ábrelo en el teléfono del bot)</div>` : '';
          const estado = m.mio ? (m.error ? '<i class="fas fa-exclamation-circle" title="No se envió"></i>' : m.pendiente ? '<i class="far fa-clock"></i>' : '<i class="fas fa-check"></i>') : '';
          return `${sep}<div class="so-msg ${m.mio ? 'mio' : ''} ${m.error ? 'error' : ''}">${media}${cuerpo}<small>${hora(m.ts)} ${estado}</small></div>`;
        }).join('');
      const tel = numeroDe(chatSel.id);
      chatHtml = `<div class="so-chat-cab"><button type="button" class="so-volver" onclick="soVolver()" aria-label="Volver"><i class="fas fa-arrow-left"></i></button>
          ${avatar(chatSel)}<div><strong>${esc(t.nombre)}</strong><small>${esc(t.sub)}</small></div>
          ${tel ? `<a class="so-llamar" href="tel:+${tel}" title="Llamar"><i class="fas fa-phone"></i></a>` : ''}</div>
        <div class="so-mensajes" id="soMensajes">${burbujas}</div>
        <div class="so-rapidas">${RESPUESTAS.map((r, i) => `<button type="button" onclick="soRespuesta(${i})">${esc(r.length > 34 ? r.slice(0, 32) + '…' : r)}</button>`).join('')}</div>
        <div class="so-escribir"><textarea id="soTexto" rows="1" maxlength="2000" placeholder="Escribe una respuesta (Enter envía, Mayús+Enter salto de línea)" onkeydown="soTecla(event)"></textarea>
          <button type="button" onclick="soEnviar()" ${SO.enviando ? 'disabled' : ''} aria-label="Enviar"><i class="fas ${SO.enviando ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i></button></div>`;
    }

    const msjs = document.getElementById('soMensajes');
    const alFondo = !msjs || msjs.scrollHeight - msjs.scrollTop - msjs.clientHeight < 80 || msjs.dataset.chat !== SO.sel;
    cont.innerHTML = `
      ${SO.error ? `<div class="so-error"><i class="fas fa-exclamation-triangle"></i> ${esc(SO.error)}. Se reintenta solo.</div>` : ''}
      <div class="so-bandeja ${chatSel ? 'con-chat' : ''}">
        <aside class="so-lista">
          <div class="so-lista-cab">
            <div class="so-buscar"><i class="fas fa-search"></i><input type="search" id="soBusca" value="${esc(SO.busca)}" placeholder="Buscar nombre, número o mensaje" oninput="soBuscar(this.value)"></div>
            <div class="so-filtros">
              <button type="button" class="${SO.filtro === 'escribieron' ? 'on' : ''}" onclick="soFiltro('escribieron')">Escribieron${noLeidos ? ` <b>${noLeidos}</b>` : ''}</button>
              <button type="button" class="${SO.filtro === 'todos' ? 'on' : ''}" onclick="soFiltro('todos')">Todos</button>
            </div>
          </div>
          <div class="so-chats">${listaHtml}</div>
        </aside>
        <section class="so-chat-vista">${chatHtml}</section>
      </div>`;
    const nuevo = document.getElementById('soMensajes');
    if (nuevo) { nuevo.dataset.chat = SO.sel; if (alFondo) nuevo.scrollTop = nuevo.scrollHeight; else if (msjs) nuevo.scrollTop = msjs.scrollTop; }
    if (borrador && SO.sel) { const t2 = document.getElementById('soTexto'); if (t2) { t2.value = borrador.v; if (borrador.foco) t2.focus(); } }
    if (focoBusca !== null) { const b = document.getElementById('soBusca'); if (b) { b.focus(); try { b.setSelectionRange(focoBusca, focoBusca); } catch (e) { } } }
  }

  function pintarContador() {
    const b = document.getElementById('badgeSoporte');
    if (!b) return;
    const n = SO.chats.filter(c => !c.grupo && c.noLeidos > 0).length;
    b.textContent = n; b.style.display = n ? 'inline-block' : 'none';
  }

  // --------------------------------------------------------------- ciclo
  function tic() {
    if (!sesion() || SO.sinSesion) return;
    const panel = document.getElementById('soPanel');
    const aLaVista = panel && panel.offsetParent && document.visibilityState === 'visible';
    const ahora = Date.now();
    if (ahora - SO.tsChats > (aLaVista ? 15000 : 60000)) cargarChats();
    if (aLaVista && SO.sel && ahora - SO.tsMsgs > 5000) { SO.tsMsgs = ahora; cargarMensajes(SO.sel, true); }
  }

  window.cargarPanelSoporte = function () {
    SO.sinSesion = false;
    pintar();
    if (sesion()) cargarChats();
    if (!SO.timer) SO.timer = setInterval(tic, 2500);
  };
  // Contador del menú en segundo plano (solo si ya hay sesión de Admin Master en esta pestaña)
  window.iniciarContadorSoporte = function () {
    if (!SO.timer) SO.timer = setInterval(tic, 2500);
  };
})();
