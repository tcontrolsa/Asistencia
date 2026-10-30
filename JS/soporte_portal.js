/**
 * TCONTROL · Portal de soporte (soporte.html, solo Admin Master)
 *
 * Procesa lo que entra por la app en «Soporte Técnico · Reporte de Incidente / Ayuda»: cada mensaje
 * «⚠️REPORTE DE INCIDENCIA ⚠️» que llega al WhatsApp del bot es un requerimiento (Pendiente / Resuelto),
 * ligado al colaborador por el «ID Empleado» que trae. Solo se listan colaboradores registrados.
 * - En el chat, los avisos que envía el bot (asistencia, visitas, campo, catering…) se muestran clasificados
 *   y plegados; las respuestas escritas a mano y lo que escribe el colaborador se ven como chat normal.
 * - «Otros mensajes»: lo que escriben colaboradores fuera del formulario (p. ej. respuestas a un aviso).
 * - Datos compartidos entre equipos en Firestore: configuracion/soporte_vinculos (chat ↔ colaborador)
 *   y configuracion/soporte_tickets (estado de cada requerimiento). Los mensajes no se copian a Firestore.
 * - Lee por el puente del túnel de WhatsApp con el token de Admin Master (tokenEvaluacion verifica el PIN).
 *   OpenWA limita las consultas (100/min, compartidas con los envíos del bot): se espacian y se respeta 429.
 * - Avisos: tono + voz («Tienes 3 soportes pendientes») al llegar un reporte nuevo y como recordatorio cada
 *   N minutos mientras haya pendientes; aviso del escritorio si la pestaña está en segundo plano. El navegador
 *   exige un clic para permitir sonido: si está bloqueado se muestra «Activar sonido».
 */
(function () {
  const KEY_SES = 'tcontrol_soporte_sesion';
  const KEY_CACHE = 'tcontrol_soporte_cache_v2';      // { chatId: { ts, tickets:[…], otros, espera, ultimoEntrante } }
  const KEY_PREF = 'tcontrol_soporte_avisos';          // { sonido, voz, cadaMin }
  const SESION_POR_DEFECTO = '5a509468-647a-4973-b10c-bf87d04666ea';
  const PAUSA_REVISION_MS = 2000;                      // ≤ 30 consultas/min al revisar chats
  const RESPUESTAS = ['Hola, recibimos tu reporte. Ya lo estamos revisando.', 'Listo, ya quedó corregido. Por favor revisa en la app.',
    '¿Nos envías una captura de pantalla del problema?', 'Por favor cierra la app, vuelve a abrirla y nos cuentas si sigue pasando.'];

  // Avisos que envía el bot (clasificación por el inicio del mensaje)
  const CATEGORIAS = [
    { k: 'asistencia', t: 'Notificación de asistencia', i: 'fa-user-clock', re: /NOTIFICACI.{1,2}N DE ASISTENCIA|Novedad de Asistencia|no (has )?registrad|marcaci/i },
    { k: 'visitas', t: 'Aviso de visitas', i: 'fa-id-card-alt', re: /visita|lleg.{1,2} sin cita|pase de/i },
    { k: 'campo', t: 'Registro en campo', i: 'fa-car', re: /registro en campo|en campo/i },
    { k: 'catering', t: 'Catering / invitados', i: 'fa-concierge-bell', re: /catering|invitad/i },
    { k: 'colaborador', t: 'Nuevo colaborador', i: 'fa-user-plus', re: /Nuevo Colaborador/i },
    { k: 'evaluacion', t: 'Evaluación de desempeño', i: 'fa-seedling', re: /evaluaci.{1,2}n/i },
    { k: 'emergencia', t: 'Emergencia / simulacro', i: 'fa-exclamation-triangle', re: /emergencia|simulacro/i },
    { k: 'prueba', t: 'Prueba de conexión', i: 'fa-plug', re: /TEST DE CONEXI|prueba del/i },
    { k: 'recordatorio', t: 'Recordatorio', i: 'fa-bell', re: /te escribimos de TCONTROL|recordatorio/i }
  ];
  const RE_REPORTE = /REPORTE DE INCIDENCIA/i;

  const SP = {
    ses: null, base: '', sid: '', emps: new Map(), vinc: {}, tick: {}, chats: [], cache: {}, sel: '', ticketSel: '', msgs: {}, hoy: {},
    filtro: 'pendientes', busca: '', verAvisos: true, fichaAbierta: false, error: '', tsChats: 0, tsMsgs: 0,
    cargando: false, revisando: false, porRevisar: 0, enviando: false, timer: null, pausaHasta: 0, ultimaConsulta: 0,
    avisados: null, ultimoRecordatorio: 0, audio: null, prefsAbiertas: false
  };
  const PREF = Object.assign({ sonido: true, voz: true, cadaMin: 10 }, (() => { try { return JSON.parse(localStorage.getItem(KEY_PREF) || '{}'); } catch (e) { return {}; } })());
  const db = () => window.firebase.firestore();
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tsMs = t => !t ? 0 : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : (Date.parse(t) || 0);
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const hoyStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const telNorm = t => { const d = String(t || '').replace(/\D/g, ''); return d.startsWith('593') ? d : d.startsWith('0') && d.length === 10 ? '593' + d.slice(1) : d.length === 9 ? '593' + d : d; };
  const horaCorta = ms => ms ? new Date(ms).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
  const cuando = ms => {
    if (!ms) return '';
    const d = new Date(ms), hoy = new Date(), ayer = new Date(Date.now() - 864e5);
    if (d.toDateString() === hoy.toDateString()) return horaCorta(ms);
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' });
  };

  // «hace 5 min», «hace 3 h», «hace 2 días»
  const hace = ms => {
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    const d = Math.round(m / 1440);
    return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${d} día${d === 1 ? '' : 's'}`;
  };
  function foto(url, size) {
    if (!url) return '';
    url = String(url).trim();
    if (url.includes('googleusercontent.com/d/')) return url.includes('=') ? url : `${url}=w${size}`;
    const m = url.match(/\/file\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/) || (url.includes('drive.google.com') ? url.match(/\/d\/([\w-]+)/) : null);
    return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w${size}` : url;
  }
  function avatar(e, clase) {
    const nombre = (e && e.nombre) || '?';
    const ini = nombre.trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
    const src = e && e.foto_url ? foto(e.foto_url, clase === 'grande' ? 300 : 120) : '';
    return `<div class="sp-av ${clase || ''}"><span>${esc(ini)}</span>${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
  }
  const tipoTexto = t => ({ image: 'Imagen', video: 'Video', audio: 'Audio', ptt: 'Nota de voz', document: 'Documento', sticker: 'Sticker',
    location: 'Ubicación', vcard: 'Contacto', revoked: 'Mensaje eliminado', unknown: 'Archivo que el bot no puede mostrar' })[t] || 'Archivo';

  // ------------------------------------------------------------------ mensajes
  function normMsg(m) {
    return { id: String((m.id && m.id._serialized) || m.id || ''), cuerpo: m.body || m.caption || '',
      mio: m.direction ? m.direction === 'outgoing' : !!m.fromMe, ts: tsMs(m.timestamp || m.createdAt), tipo: m.type || 'text' };
  }
  const esImagenB64 = s => /^\/9j\/[A-Za-z0-9+/=\s]{80,}$/.test(String(s || '').trim());
  function clasificar(m) {
    if (!m.mio) return RE_REPORTE.test(m.cuerpo) ? 'reporte' : 'mensaje';
    const primera = String(m.cuerpo || '').split('\n').slice(0, 2).join(' ');
    const c = CATEGORIAS.find(x => x.re.test(primera));
    return c ? c.k : (m.tipo === 'image' && !m.cuerpo ? 'aviso' : 'respuesta');
  }
  // «⚠️REPORTE DE INCIDENCIA ⚠️ … • ID Empleado: 1012 … • Fecha: 29/10/2026 • Descripción: …»
  function leerReporte(texto) {
    const t = String(texto || '');
    const campo = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
    return { id: campo(/ID\s*Empleado\s*:\s*(\d{1,6})/i), nombre: campo(/Nombre\s*:\s*([^\n]+)/i), area: campo(/.rea\s*:\s*([^\n]+)/i),
      fecha: campo(/Fecha\s*:\s*([^\n]+)/i), descripcion: campo(/Descripci.{1,2}n\s*:\s*([\s\S]+)$/i) };
  }

  // ------------------------------------------------------------------ sesión
  function sesionGuardada() {
    try { const s = JSON.parse(sessionStorage.getItem(KEY_SES) || 'null'); if (s && s.token && s.exp * 1000 > Date.now() + 60000) return s; } catch (e) { }
    return null;
  }
  async function ingresar() {
    const id = ($('spId').value || '').trim(), pin = ($('spPin').value || '').trim();
    const msg = $('spLoginMsg');
    if (!id || !pin) { msg.textContent = 'Ingresa tu ID y tu PIN.'; return; }
    msg.textContent = 'Verificando…';
    try {
      const r = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: id, pin });
      if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu PIN');
      if (!r.master) { msg.textContent = 'El portal de soporte es solo para el Admin Master.'; return; }
      SP.ses = { token: r.token, exp: r.exp, empleadoId: id };
      try { sessionStorage.setItem(KEY_SES, JSON.stringify(SP.ses)); } catch (e) { }
      iniciar();
    } catch (e) { msg.textContent = e.message; }
  }
  function salir() { try { sessionStorage.removeItem(KEY_SES); } catch (e) { } location.reload(); }

  // ------------------------------------------------------------------ servidor (con límite de OpenWA)
  async function api(metodo, ruta, cuerpo) {
    if (!SP.ses || SP.ses.exp * 1000 < Date.now()) { pantallaLogin('Tu sesión venció. Ingresa de nuevo.'); throw new Error('Sesión vencida'); }
    if (!SP.base) throw new Error('No hay dirección del servidor de WhatsApp');
    if (Date.now() < SP.pausaHasta) throw new Error('El servidor pidió esperar unos segundos');
    const hueco = SP.ultimaConsulta + 250 - Date.now();
    if (hueco > 0) await espera(hueco);
    SP.ultimaConsulta = Date.now();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(`${SP.base}/api/sessions/${encodeURIComponent(SP.sid || SESION_POR_DEFECTO)}${ruta}`, {
        method: metodo, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Tcontrol-Soporte': SP.ses.token },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
      if (r.status === 429) {
        SP.pausaHasta = Date.now() + (parseInt(r.headers.get('Retry-After') || '30', 10) * 1000);
        throw new Error('El servidor pidió esperar unos segundos');
      }
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { pantallaLogin('Tu sesión venció. Ingresa de nuevo.'); throw new Error('Sesión vencida'); }
      if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('El servidor de WhatsApp no respondió');
      if (/Failed to fetch|NetworkError/i.test(e.message)) throw new Error('Sin conexión con el servidor de WhatsApp');
      throw e;
    } finally { clearTimeout(t); }
  }
  const lista = j => Array.isArray(j) ? j : (j.data || j.chats || j.messages || []);

  async function resolverSesionOpenWA() {
    try {
      const j = await (await fetch(`${SP.base}/api/sessions`)).json();
      const s = lista(j).find(x => /ready|connected|working/i.test(x.status || '')) || lista(j)[0];
      SP.sid = (s && (s.id || s.name)) || SESION_POR_DEFECTO;
    } catch (e) { SP.sid = SESION_POR_DEFECTO; }
  }

  // ------------------------------------------------------------------ vínculos y estados
  function numeroDe(c) {
    const m = String(c.id).match(/^(\d{8,15})@c\.us$/);
    if (m) return m[1];
    const d = /^[+\d\s()-]+$/.test(c.nombre || '') ? telNorm(c.nombre) : '';
    return d.length >= 11 ? d : '';
  }
  const empleadoDe = chatId => { const v = SP.vinc[chatId]; return v && v.empleadoId ? SP.emps.get(String(v.empleadoId)) || null : null; };

  function vincular(chatId, empleadoId, origen) {
    if (!chatId || !empleadoId || !SP.emps.has(String(empleadoId))) return;
    const actual = SP.vinc[chatId];
    if (actual && actual.empleadoId === String(empleadoId)) return;
    if (actual && actual.origen === 'manual' && origen !== 'manual') return;   // lo manual manda
    const v = { empleadoId: String(empleadoId), origen, por: SP.ses.empleadoId, ts: new Date().toISOString() };
    SP.vinc[chatId] = v;
    db().collection('configuracion').doc('soporte_vinculos').set({ vinculos: { [chatId]: v } }, { merge: true })
      .catch(e => console.warn('Soporte: no se guardó el vínculo', e));
  }
  function desvincular(chatId) {
    delete SP.vinc[chatId];
    db().collection('configuracion').doc('soporte_vinculos')
      .update(new firebase.firestore.FieldPath('vinculos', chatId), firebase.firestore.FieldValue.delete())
      .catch(e => console.warn('Soporte: no se quitó el vínculo', e));
  }
  function marcarTicket(ticketId, estado) {
    const v = { estado, por: SP.ses.empleadoId, ts: new Date().toISOString() };
    SP.tick[ticketId] = v;
    db().collection('configuracion').doc('soporte_tickets').set({ tickets: { [ticketId]: v } }, { merge: true })
      .catch(e => { console.warn('Soporte: estado del requerimiento', e); aviso('No se guardó el estado. Revisa la conexión.'); });
  }
  const estadoTicket = id => (SP.tick[id] && SP.tick[id].estado) || 'pendiente';

  // ------------------------------------------------------------------ carga y revisión
  function guardarCache() {
    const vivos = new Set(SP.chats.map(c => c.id));
    Object.keys(SP.cache).forEach(k => { if (!vivos.has(k)) delete SP.cache[k]; });
    try { localStorage.setItem(KEY_CACHE, JSON.stringify(SP.cache)); } catch (e) { }
  }
  function analizar(chatId, ms, ts) {
    const tickets = [];
    let otros = 0, ultEnt = 0;
    ms.forEach(m => {
      const cat = clasificar(m);
      if (cat === 'reporte') {
        const r = leerReporte(m.cuerpo);
        tickets.push({ id: m.id, ts: m.ts, fecha: r.fecha, descripcion: r.descripcion.slice(0, 600), empleadoId: r.id });
        if (r.id) vincular(chatId, r.id, 'mensaje');
      } else if (cat === 'mensaje') otros++;
      if (!m.mio) ultEnt = m.ts;
    });
    const ult = ms[ms.length - 1];
    SP.cache[chatId] = { ts, tickets, otros, ultimoEntrante: ultEnt, espera: !!ult && !ult.mio };
  }
  async function cargarChats() {
    if (SP.cargando) return;
    SP.cargando = true;
    try {
      const j = await api('GET', '/chats?limit=150');
      SP.chats = lista(j).map(c => {
        const id = String((c.id && c.id._serialized) || c.chatId || c.id || '');
        return { id, nombre: c.name || '', noLeidos: Number(c.unreadCount || 0), ts: tsMs(c.timestamp),
          grupo: !!c.isGroup || /@g\.us$|@broadcast$|@newsletter$/.test(id) };
      }).filter(c => c.id && !c.grupo).sort((a, b) => b.ts - a.ts);
      SP.chats.forEach(c => {
        if (SP.vinc[c.id]) return;
        const n = numeroDe(c);
        const e = n && [...SP.emps.values()].find(x => x.telefono && telNorm(x.telefono) === n);
        if (e) vincular(c.id, e.id, 'telefono');
      });
      SP.error = ''; SP.tsChats = Date.now();
      revisar();
    } catch (e) {
      if (e.message !== 'Sesión vencida') SP.error = e.message;
    } finally { SP.cargando = false; pintar(); }
  }
  // Revisa, de a uno y espaciado, los chats que cambiaron desde la última vez
  async function revisar() {
    if (SP.revisando) return;
    SP.revisando = true;
    try {
      let pend;
      while ((pend = SP.chats.filter(c => !SP.cache[c.id] || SP.cache[c.id].ts !== c.ts)).length && SP.ses) {
        SP.porRevisar = pend.length;
        const c = pend[0];
        try {
          const ms = lista(await api('GET', `/messages?chatId=${encodeURIComponent(c.id)}&limit=100`)).map(normMsg).sort((a, b) => a.ts - b.ts);
          analizar(c.id, ms, c.ts);
          if (c.id === SP.sel) SP.msgs[c.id] = ms;
        } catch (e) {
          if (/esperar|conexi|respondi/i.test(e.message)) { await espera(Math.max(5000, SP.pausaHasta - Date.now())); continue; }
          SP.cache[c.id] = { ts: c.ts, tickets: [], otros: 0, espera: false, error: true };
        }
        if (pend.length % 5 === 1) { guardarCache(); pintar(); }
        await espera(PAUSA_REVISION_MS);
      }
      SP.porRevisar = 0;
      guardarCache();
      pintar();
    } finally { SP.revisando = false; }
  }
  async function cargarMensajes(chatId, marcar) {
    try {
      const ms = lista(await api('GET', `/messages?chatId=${encodeURIComponent(chatId)}&limit=100`)).map(normMsg).sort((a, b) => a.ts - b.ts);
      SP.msgs[chatId] = ms; SP.tsMsgs = Date.now();
      const c = SP.chats.find(x => x.id === chatId);
      analizar(chatId, ms, c ? c.ts : 0);
      guardarCache();
      if (marcar && c && c.noLeidos) { c.noLeidos = 0; api('POST', '/chats/read', { chatId }).catch(() => { }); }
    } catch (e) { if (e.message !== 'Sesión vencida') SP.error = e.message; }
    pintar();
  }
  async function cargarHoy(empId) {
    try {
      const snap = await db().collection('registros').where('empleadoId', '==', String(empId)).where('fecha', '==', hoyStr()).get();
      SP.hoy[empId] = snap.docs.map(d => d.data()).sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || '')));
    } catch (e) { SP.hoy[empId] = null; }
    pintar();
  }

  // ------------------------------------------------------------------ elementos de la lista
  // Requerimientos (un reporte = uno) y «otros mensajes» (colaboradores que escribieron fuera del formulario)
  function elementos() {
    const out = [];
    SP.chats.forEach(c => {
      const inf = SP.cache[c.id]; if (!inf) return;
      const e = empleadoDe(c.id);
      (inf.tickets || []).forEach(t => {
        const emp = (t.empleadoId && SP.emps.get(t.empleadoId)) || e;
        if (!emp) return;
        const estado = estadoTicket(t.id);
        // Resuelto pero el colaborador volvió a escribir después: vuelve a pendientes
        const reabierto = estado === 'resuelto' && inf.ultimoEntrante > tsMs((SP.tick[t.id] || {}).ts);
        out.push({ tipo: 'ticket', key: t.id, chat: c, emp, t, estado: reabierto ? 'pendiente' : estado, reabierto, ts: t.ts,
          espera: inf.espera, noLeidos: c.noLeidos });
      });
      if (!(inf.tickets || []).length && (inf.otros || c.noLeidos)) {
        out.push({ tipo: 'otro', key: c.id, chat: c, emp: e, ts: inf.ultimoEntrante || c.ts, espera: inf.espera, noLeidos: c.noLeidos });
      }
    });
    return out.sort((a, b) => b.ts - a.ts);
  }
  function conteos(els) {
    return {
      pend: els.filter(x => x.tipo === 'ticket' && x.estado !== 'resuelto').length,
      res: els.filter(x => x.tipo === 'ticket' && x.estado === 'resuelto').length,
      otros: els.filter(x => x.tipo === 'otro' && x.emp).length,
      otrosEsperan: els.filter(x => x.tipo === 'otro' && x.emp && (x.espera || x.noLeidos)).length,
      sinid: els.filter(x => x.tipo === 'otro' && !x.emp).length
    };
  }

  // ------------------------------------------------------------------ acciones
  window.spAbrir = function (key) {
    const el = elementos().find(x => x.key === key);
    if (!el) return;
    SP.sel = el.chat.id; SP.ticketSel = el.tipo === 'ticket' ? el.key : ''; SP.fichaAbierta = false; SP.fijado = '';
    if (el.emp && !(el.emp.id in SP.hoy)) cargarHoy(el.emp.id);
    pintar();
    cargarMensajes(el.chat.id, true);
  };
  window.spVolver = () => { SP.sel = ''; SP.ticketSel = ''; pintar(); };
  window.spAbrirPrimero = () => {
    const pend = elementos().filter(x => x.tipo === 'ticket' && x.estado !== 'resuelto').sort((a, b) => a.ts - b.ts);
    if (pend.length) window.spAbrir(pend[0].key);
  };
  window.spFiltro = f => { SP.filtro = f; pintar(); };
  window.spBuscar = v => { SP.busca = v; pintar(); };
  window.spFicha = () => { SP.fichaAbierta = !SP.fichaAbierta; pintar(); };
  window.spAvisos = () => { SP.verAvisos = !SP.verAvisos; pintar(); };
  window.spRespuesta = i => { const t = $('spTexto'); if (t) { t.value = RESPUESTAS[i]; t.focus(); } };
  window.spTecla = ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); window.spEnviar(); } };
  window.spEstado = function (ticketId, estado) {
    marcarTicket(ticketId, estado);
    aviso(estado === 'resuelto' ? 'Requerimiento marcado como resuelto' : 'Requerimiento reabierto');
    pintar();
  };
  window.spEnviar = async function () {
    const ta = $('spTexto');
    const texto = (ta && ta.value || '').trim();
    if (!texto || !SP.sel || SP.enviando) return;
    SP.enviando = true;
    const chatId = SP.sel;
    const temp = { id: 'tmp' + Date.now(), cuerpo: texto, mio: true, ts: Date.now(), tipo: 'text', pendiente: true };
    (SP.msgs[chatId] = SP.msgs[chatId] || []).push(temp);
    ta.value = '';
    pintar();
    try {
      await api('POST', '/messages/send-text', { chatId, text: texto });
      temp.pendiente = false;
      if (SP.cache[chatId]) SP.cache[chatId].espera = false;
    } catch (e) {
      temp.error = e.message;
      const t2 = $('spTexto'); if (t2 && !t2.value) t2.value = texto;
      aviso('No se pudo enviar: ' + e.message);
    } finally {
      SP.enviando = false;
      pintar();
      setTimeout(() => { if (SP.sel === chatId) cargarMensajes(chatId, false); }, 3000);
    }
  };
  window.spVincular = function (chatId) {
    const sel = $('spElegirEmp');
    if (!sel || !sel.value) return;
    vincular(chatId, sel.value, 'manual');
    const e = SP.emps.get(sel.value);
    if (e && !(e.id in SP.hoy)) cargarHoy(e.id);
    aviso('Chat ligado a ' + (e ? e.nombre : sel.value));
    SP.filtro = 'otros';
    document.activeElement && document.activeElement.blur();
    pintar();
  };
  window.spDesvincular = function (chatId) {
    if (!confirm('¿Quitar el vínculo de este chat con el colaborador?')) return;
    desvincular(chatId); SP.sel = ''; SP.ticketSel = ''; pintar();
  };
  window.spFiltrarEmp = function (v) {
    const sel = $('spElegirEmp');
    if (!sel) return;
    const q = v.trim().toLowerCase();
    sel.innerHTML = [...SP.emps.values()].filter(e => !q || `${e.nombre} ${e.id}`.toLowerCase().includes(q)).slice(0, 60)
      .map(e => `<option value="${esc(e.id)}">${esc(e.nombre)} · ${esc(e.id)}</option>`).join('');
  };
  window.spIngresar = ingresar;
  window.spSalir = salir;

  function aviso(texto) {
    let t = $('spToast');
    if (!t) { t = document.createElement('div'); t.id = 'spToast'; t.className = 'sp-toast'; document.body.appendChild(t); }
    t.textContent = texto; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3500);
  }
  // ---------------------------------------------------------------- avisos (tono, voz y escritorio)
  function contextoAudio() {
    try { SP.audio = SP.audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { SP.audio = null; }
    return SP.audio;
  }
  const sonidoBloqueado = () => PREF.sonido && (!SP.audio || SP.audio.state !== 'running');
  // Tono de tres notas ascendentes (campanita suave)
  function tono() {
    const ctx = contextoAudio();
    if (!ctx || ctx.state !== 'running') return false;
    [[659, 0], [784, 0.16], [988, 0.32]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.45);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.5);
    });
    return true;
  }
  function vozEs() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return vs.find(v => /es[-_](EC|419|MX|US|CO)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  }
  function decir(texto) {
    if (!PREF.voz || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      const v = vozEs(); if (v) u.voice = v;
      u.lang = (v && v.lang) || 'es-ES'; u.rate = 1; u.pitch = 1;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  const frasePendientes = n => n === 1 ? 'Tienes un soporte pendiente.' : `Tienes ${n} soportes pendientes.`;
  function anunciar(texto, titulo) {
    if (PREF.sonido && tono()) setTimeout(() => decir(texto), 750);
    else decir(texto);
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(titulo || 'Soporte TCONTROL', { body: texto, icon: './assets/icons/icon-192.png', tag: 'tcontrol-soporte', renotify: true }); } catch (e) { }
    }
  }
  // Se llama en cada repintado: avisa de reportes nuevos y recuerda los pendientes cada N minutos
  function revisarAvisos(els, k) {
    const pend = els.filter(x => x.tipo === 'ticket' && x.estado !== 'resuelto');
    const ids = pend.map(x => x.key);
    if (!SP.avisados) {
      if (SP.porRevisar || !SP.tsChats) return;             // se espera la primera revisión completa
      SP.avisados = new Set(ids);
      if (k.pend) { anunciar(frasePendientes(k.pend)); SP.ultimoRecordatorio = Date.now(); }
      return;
    }
    const nuevos = pend.filter(x => !SP.avisados.has(x.key));
    ids.forEach(id => SP.avisados.add(id));
    if (nuevos.length) {
      const quien = nuevos.length === 1 ? String(nuevos[0].emp.nombre || '').split(/\s+/).slice(2, 3).join(' ') || 'un colaborador' : '';
      anunciar((nuevos.length === 1 ? `Nuevo reporte de soporte de ${quien.charAt(0) + quien.slice(1).toLowerCase()}. ` : `${nuevos.length} reportes de soporte nuevos. `) + frasePendientes(k.pend),
        'Nuevo reporte de soporte');
      SP.ultimoRecordatorio = Date.now();
    } else if (k.pend && PREF.cadaMin && Date.now() - SP.ultimoRecordatorio > PREF.cadaMin * 60000) {
      anunciar('Recordatorio. ' + frasePendientes(k.pend));
      SP.ultimoRecordatorio = Date.now();
    }
  }
  function guardarPref() { try { localStorage.setItem(KEY_PREF, JSON.stringify(PREF)); } catch (e) { } }
  window.spActivarSonido = async function () {
    const ctx = contextoAudio();
    try { if (ctx && ctx.state !== 'running') await ctx.resume(); } catch (e) { }
    PREF.sonido = true; guardarPref();
    if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { } }
    const k = conteos(elementos());
    anunciar(k.pend ? frasePendientes(k.pend) : 'Avisos de soporte activados.');
    SP.ultimoRecordatorio = Date.now();
    pintar();
  };
  window.spPrefs = () => { SP.prefsAbiertas = !SP.prefsAbiertas; pintar(); };
  window.spPref = function (campo, valor) {
    PREF[campo] = valor; guardarPref();
    if ((campo === 'sonido' || campo === 'voz') && valor) window.spActivarSonido(); else pintar();
  };
  window.spProbarAviso = () => { const k = conteos(elementos()); anunciar(k.pend ? frasePendientes(k.pend) : 'No tienes soportes pendientes.'); };
  // Cualquier clic en la página habilita el sonido (exigencia del navegador)
  document.addEventListener('pointerdown', () => { const c = contextoAudio(); if (c && c.state !== 'running') c.resume().then(() => pintar()).catch(() => { }); }, { passive: true });
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { };

  // ------------------------------------------------------------------ vista
  function pantallaLogin(msg) {
    SP.ses = null;
    try { sessionStorage.removeItem(KEY_SES); } catch (e) { }
    clearInterval(SP.timer); SP.timer = null;
    $('spApp').innerHTML = `<div class="sp-login"><div class="sp-login-card">
      <div class="sp-logo"><i class="fas fa-headset"></i></div>
      <h1>Soporte TCONTROL</h1><p>Reportes de incidente y pedidos de ayuda que los colaboradores envían desde la app.</p>
      <label for="spId">ID</label><input id="spId" inputmode="numeric" autocomplete="username" placeholder="Tu ID">
      <label for="spPin">PIN</label><input id="spPin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" onkeydown="if(event.key==='Enter') spIngresar()">
      <button type="button" onclick="spIngresar()"><i class="fas fa-unlock"></i> Ingresar</button>
      <div id="spLoginMsg" class="sp-login-msg">${esc(msg || '')}</div>
      <small><i class="fas fa-lock"></i> Solo Admin Master · la sesión dura 8 horas.</small></div></div>`;
    setTimeout(() => { const i = $('spId'); if (i) i.focus(); }, 50);
  }

  function filaHtml(x) {
    const nombre = x.emp ? x.emp.nombre : (x.chat.nombre || 'Contacto');
    const on = x.chat.id === SP.sel && (x.tipo === 'otro' || x.key === SP.ticketSel);
    const sub = x.tipo === 'ticket' ? (x.t.descripcion || 'Sin descripción') : 'Escribió fuera del formulario de soporte';
    const horas = (Date.now() - x.ts) / 3600000;
    const urg = x.estado !== 'resuelto' && x.tipo === 'ticket' ? (horas >= 24 ? 'urg' : horas >= 4 ? 'med' : '') : '';
    const chip = x.tipo === 'ticket'
      ? (x.estado === 'resuelto' ? '<span class="sp-est ok">Resuelto</span>' : x.reabierto ? '<span class="sp-est re">Volvió a escribir</span>'
        : `<span class="sp-est pend ${urg}"><i class="far fa-clock"></i> ${Date.now() - x.ts < 60000 ? 'Recién llegado' : 'Espera ' + hace(x.ts).replace('hace ', '')}</span>`)
      : '';
    return `<button type="button" class="sp-fila ${on ? 'on' : ''} ${x.tipo === 'ticket' && x.estado !== 'resuelto' ? 'pend' : ''} ${urg}" onclick="spAbrir('${esc(x.key)}')">
      ${avatar(x.emp || { nombre })}
      <div class="sp-fila-txt"><div class="sp-l1"><strong>${esc(nombre)}</strong><small>${cuando(x.ts)}</small></div>
      <div class="sp-l2"><span>${x.emp ? `<em>${esc(x.emp.area_nomina || x.emp.area || '')}</em> · ` : ''}${esc(sub)}</span>${x.noLeidos ? `<b>${x.noLeidos}</b>` : ''}</div>
      ${chip || (x.tipo === 'ticket' && x.t.fecha) ? `<div class="sp-l3">${chip}${x.tipo === 'ticket' && x.t.fecha ? `<span><i class="far fa-calendar"></i> Incidente del ${esc(x.t.fecha)}</span>` : ''}</div>` : ''}</div></button>`;
  }

  function burbujasHtml(ms) {
    let dia = '';
    const cat = k => CATEGORIAS.find(c => c.k === k) || { t: 'Aviso automático', i: 'fa-robot' };
    const resumen = {};
    const html = ms.map(m => {
      const d = m.ts ? new Date(m.ts).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      const sep = d && d !== dia ? `<div class="sp-dia">${esc(d)}</div>` : '';
      dia = d || dia;
      const k = clasificar(m);
      if (m.mio && k !== 'respuesta') {
        const c = cat(k); resumen[c.t] = (resumen[c.t] || 0) + 1;
        if (!SP.verAvisos) return sep;
        return `${sep}<details class="sp-noti sp-noti-${esc(k)}"><summary><i class="fas ${c.i}"></i> ${esc(c.t)}<small>${horaCorta(m.ts)}</small></summary>
          <div>${m.cuerpo && !esImagenB64(m.cuerpo) ? esc(m.cuerpo).replace(/\n/g, '<br>') : '<i>(imagen)</i>'}</div></details>`;
      }
      if (k === 'reporte') {
        const r = leerReporte(m.cuerpo);
        const est = estadoTicket(m.id);
        return `${sep}<div class="sp-ticket ${m.id === SP.ticketSel ? 'sel' : ''}" id="t_${esc(m.id)}">
          <div class="sp-ticket-cab"><i class="fas fa-exclamation-triangle"></i> Reporte de incidente <span class="sp-est ${est === 'resuelto' ? 'ok' : 'pend'}">${est === 'resuelto' ? 'Resuelto' : 'Pendiente'}</span></div>
          <div class="sp-ticket-datos"><span><small>Fecha del incidente</small>${esc(r.fecha || '—')}</span><span><small>Área</small>${esc(r.area || '—')}</span><span><small>ID</small>${esc(r.id || '—')}</span></div>
          <p>${esc(r.descripcion || m.cuerpo).replace(/\n/g, '<br>')}</p>
          <div class="sp-ticket-pie"><small>Recibido ${new Date(m.ts).toDateString() === new Date().toDateString() ? 'hoy' : new Date(m.ts).toLocaleDateString('es-EC')} a las ${horaCorta(m.ts)}</small>
            ${est === 'resuelto' ? `<button type="button" onclick="spEstado('${esc(m.id)}','pendiente')"><i class="fas fa-undo"></i> Reabrir</button>`
            : `<button type="button" class="ok" onclick="spEstado('${esc(m.id)}','resuelto')"><i class="fas fa-check"></i> Marcar resuelto</button>`}</div></div>`;
      }
      const img = esImagenB64(m.cuerpo) ? `<img class="sp-img" src="data:image/jpeg;base64,${m.cuerpo.replace(/\s/g, '')}" alt="Imagen enviada" onclick="window.open(this.src)">` : '';
      const media = !img && !['text', 'chat'].includes(m.tipo) ? `<div class="sp-media"><i class="fas fa-paperclip"></i> ${tipoTexto(m.tipo)}</div>` : '';
      const texto = !img && m.cuerpo ? esc(m.cuerpo).replace(/\n/g, '<br>') : '';
      const est = m.mio ? (m.error ? '<i class="fas fa-exclamation-circle"></i>' : m.pendiente ? '<i class="far fa-clock"></i>' : '<i class="fas fa-check"></i>') : '';
      return `${sep}<div class="sp-msg ${m.mio ? 'mio' : ''} ${m.error ? 'error' : ''}">${img}${media}${texto}<small>${horaCorta(m.ts)} ${est}</small></div>`;
    }).join('');
    return { html, resumen };
  }

  function fichaHtml(c, e) {
    if (!e) {
      return `<div class="sp-ficha-vacia"><i class="fas fa-user-question"></i><h3>Sin identificar</h3>
        <p>${esc(c.nombre || 'Contacto')} escribió sin usar el formulario de soporte y su número no está en ninguna ficha. Elige a quién corresponde:</p>
        <input type="search" class="sp-input" placeholder="Buscar por nombre o ID" oninput="spFiltrarEmp(this.value)">
        <select id="spElegirEmp" class="sp-input" size="7"></select>
        <button type="button" class="sp-btn" onclick="spVincular('${esc(c.id)}')"><i class="fas fa-link"></i> Ligar al colaborador</button></div>`;
    }
    const v = SP.vinc[c.id] || {};
    const regs = SP.hoy[e.id];
    const hoyHtml = regs === undefined ? '<span class="sp-tenue"><i class="fas fa-spinner fa-spin"></i></span>'
      : regs === null ? '<span class="sp-tenue">No disponible</span>' : !regs.length ? '<span class="sp-tenue">Sin marcaciones hoy</span>'
      : regs.map(r => `<span class="sp-marca ${/SALIDA/i.test(r.tipo) ? 'sal' : ''}">${esc(String(r.tipo || '').replace(/_/g, ' ').toLowerCase())} ${esc(String(r.hora || '').slice(0, 5))}</span>`).join('');
    const tel = e.telefono ? telNorm(e.telefono) : '';
    const fila = (ico, et, val) => val ? `<div class="sp-dato"><i class="fas ${ico}"></i><div><small>${et}</small><span>${esc(val)}</span></div></div>` : '';
    const inf = SP.cache[c.id] || {};
    const tks = (inf.tickets || []);
    const origen = { mensaje: 'por el ID de su reporte', telefono: 'por su teléfono', manual: 'a mano' }[v.origen] || '';
    return `<div class="sp-ficha-cab">${avatar(e, 'grande')}<h3>${esc(e.nombre)}</h3><p>${esc(e.cargo_nomina || e.cargo || '')}</p>
        <div class="sp-chips"><span class="sp-chip">ID ${esc(e.id)}</span>${String(e.activo || 'SI').toUpperCase() === 'NO' ? '<span class="sp-chip rojo">Inactivo</span>' : ''}</div></div>
      <div class="sp-datos">
        ${fila('fa-building', 'Unidad', e.unidad)}${fila('fa-layer-group', 'Área', e.area_nomina || e.area)}
        ${fila('fa-user-tie', 'Jefe inmediato', e.jefe_inmediato)}${fila('fa-phone', 'Teléfono', e.telefono)}
        <div class="sp-dato"><i class="fas fa-fingerprint"></i><div><small>Marcaciones de hoy</small><div class="sp-marcas">${hoyHtml}</div></div></div>
        <div class="sp-dato"><i class="fas fa-clipboard-list"></i><div><small>Requerimientos</small><span>${tks.length} en total · ${tks.filter(t => estadoTicket(t.id) !== 'resuelto').length} pendientes</span></div></div>
      </div>
      ${tel ? `<a class="sp-btn sec" href="tel:+${tel}"><i class="fas fa-phone"></i> Llamar</a>` : ''}
      ${origen ? `<p class="sp-origen"><i class="fas fa-link"></i> Chat ligado ${origen}.${v.origen === 'manual' || v.origen === 'telefono' ? ` <button type="button" onclick="spDesvincular('${esc(c.id)}')">Quitar</button>` : ''}</p>` : ''}`;
  }

  function pintar() {
    if (!SP.ses) return;
    const app = $('spApp');
    if (!app.querySelector('.sp-shell')) {
      app.innerHTML = `<div class="sp-shell">
        <header class="sp-top"><div class="sp-marca"><span class="sp-marca-ico"><i class="fas fa-headset"></i></span><div><b>Soporte</b><small>TCONTROL</small></div></div>
          <div id="spKpis" class="sp-kpis"></div>
          <div class="sp-top-der"><span id="spEstado" class="sp-estado"></span>
          <button type="button" id="spBtnSonido" class="sp-icono" onclick="spPrefs()" title="Avisos de sonido y voz"></button>
          <button type="button" class="sp-icono" onclick="spSalir()" title="Salir"><i class="fas fa-sign-out-alt"></i></button></div></header>
        <div id="spBandaSonido"></div><div id="spPrefsCaja"></div>
        <div id="spCuerpo" class="sp-cuerpo"></div></div>`;
    }
    // Eligiendo colaborador para ligar: no se redibuja hasta terminar
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.sp-ficha-vacia')) return;
    const ta = $('spTexto'); const borr = ta ? { v: ta.value, foco: document.activeElement === ta } : null;
    const bus = $('spBusca'); const focoBus = bus && document.activeElement === bus ? bus.selectionStart : null;
    const msjs = $('spMensajes');
    const alFondo = !msjs || msjs.dataset.chat !== SP.sel || msjs.scrollHeight - msjs.scrollTop - msjs.clientHeight < 80;

    const els = elementos();
    const k = conteos(els);
    revisarAvisos(els, k);
    document.title = (k.pend ? `(${k.pend}) ` : '') + 'Soporte · TCONTROL';
    const hoyTxt = new Date().toDateString();
    const resHoy = Object.values(SP.tick).filter(t => t.estado === 'resuelto' && new Date(t.ts).toDateString() === hoyTxt).length;
    const masViejo = els.filter(x => x.tipo === 'ticket' && x.estado !== 'resuelto').reduce((m, x) => Math.min(m, x.ts), Infinity);
    $('spKpis').innerHTML = `
      <button type="button" class="sp-kpi ${k.pend ? 'alerta' : 'ok'}" onclick="spFiltro('pendientes')"><b>${k.pend}</b><span>${k.pend === 1 ? 'pendiente' : 'pendientes'}</span></button>
      <div class="sp-kpi"><b>${resHoy}</b><span>resueltos hoy</span></div>
      ${isFinite(masViejo) ? `<div class="sp-kpi ${Date.now() - masViejo > 864e5 ? 'urg' : ''}"><b>${hace(masViejo).replace('hace ', '')}</b><span>el más antiguo</span></div>` : ''}`;
    const bloq = sonidoBloqueado();
    $('spBtnSonido').innerHTML = `<i class="fas ${!PREF.sonido && !PREF.voz ? 'fa-volume-mute' : bloq ? 'fa-volume-off' : 'fa-volume-up'}"></i>`;
    $('spBtnSonido').className = 'sp-icono' + (bloq ? ' aviso' : '');
    $('spBandaSonido').innerHTML = bloq ? `<button type="button" class="sp-banda" onclick="spActivarSonido()"><i class="fas fa-volume-up"></i>
      <span><b>Activa el sonido</b> para escuchar cuando llegue un soporte (el navegador pide un clic).</span><em>Activar</em></button>` : '';
    $('spPrefsCaja').innerHTML = SP.prefsAbiertas ? `<div class="sp-prefs" role="dialog" aria-label="Avisos">
      <h4><i class="fas fa-bell"></i> Avisos de soporte</h4>
      <label><input type="checkbox" ${PREF.sonido ? 'checked' : ''} onchange="spPref('sonido', this.checked)"> Tono al llegar un reporte</label>
      <label><input type="checkbox" ${PREF.voz ? 'checked' : ''} onchange="spPref('voz', this.checked)"> Anunciar con voz («Tienes 3 soportes pendientes»)</label>
      <label>Recordar los pendientes cada
        <select onchange="spPref('cadaMin', Number(this.value))">${[[0, 'nunca'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hora']]
          .map(([v, t]) => `<option value="${v}" ${PREF.cadaMin === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="sp-prefs-pie"><button type="button" onclick="spProbarAviso()"><i class="fas fa-play"></i> Probar</button>
        <button type="button" class="sec" onclick="spPrefs()">Cerrar</button></div>
      ${'Notification' in window && Notification.permission !== 'granted' ? `<small>${Notification.permission === 'denied' ? 'Los avisos del escritorio están bloqueados en este navegador.' : 'Al activar el sonido también se piden los avisos del escritorio (para cuando la pestaña está atrás).'}</small>` : ''}
    </div>` : '';
    $('spEstado').innerHTML = SP.error ? `<i class="fas fa-exclamation-triangle"></i> ${esc(SP.error)}`
      : SP.tsChats ? `<i class="fas fa-circle"></i> En línea · ${horaCorta(SP.tsChats)}` : 'Conectando…';
    $('spEstado').className = 'sp-estado' + (SP.error ? ' error' : '');

    const q = SP.busca.trim().toLowerCase();
    const visibles = els.filter(x => {
      if (SP.filtro === 'pendientes' && !(x.tipo === 'ticket' && x.estado !== 'resuelto')) return false;
      if (SP.filtro === 'resueltos' && !(x.tipo === 'ticket' && x.estado === 'resuelto')) return false;
      if (SP.filtro === 'otros' && !(x.tipo === 'otro' && x.emp)) return false;
      if (SP.filtro === 'sinid' && !(x.tipo === 'otro' && !x.emp)) return false;
      return !q || `${x.emp ? x.emp.nombre + ' ' + x.emp.id + ' ' + (x.emp.area || '') : x.chat.nombre} ${x.t ? x.t.descripcion : ''}`.toLowerCase().includes(q);
    });
    const vacio = !SP.tsChats ? '<i class="fas fa-spinner fa-spin"></i> Cargando…'
      : SP.porRevisar && !visibles.length ? '<i class="fas fa-spinner fa-spin"></i> Revisando conversaciones…'
      : SP.filtro === 'pendientes' ? '<i class="fas fa-check-circle sp-ok"></i><br>No hay requerimientos pendientes.' : 'No hay elementos.';

    const c = SP.chats.find(x => x.id === SP.sel);
    const e = c ? empleadoDe(c.id) : null;
    let chatHtml;
    if (!c) {
      chatHtml = k.pend ? `<div class="sp-sin-chat"><div class="sp-sin-ico pend"><i class="fas fa-inbox"></i></div><h3>${frasePendientes(k.pend)}</h3>
          <p>Elige uno en la lista para leerlo, responder al colaborador y marcarlo como resuelto.</p>
          <button type="button" class="sp-btn" onclick="spAbrirPrimero()"><i class="fas fa-arrow-right"></i> Atender el más antiguo</button></div>`
        : `<div class="sp-sin-chat"><div class="sp-sin-ico ok"><i class="fas fa-check"></i></div><h3>Todo al día</h3><p>No hay soportes pendientes. Te avisaremos con sonido cuando llegue uno.</p></div>`;
    } else {
      const ms = SP.msgs[c.id];
      const b = ms ? burbujasHtml(ms) : null;
      const resumen = b ? Object.entries(b.resumen).map(([t, n]) => `${n} ${t.toLowerCase()}`).join(' · ') : '';
      chatHtml = `<div class="sp-chat-cab"><button type="button" class="sp-volver" onclick="spVolver()" aria-label="Volver"><i class="fas fa-arrow-left"></i></button>
          <button type="button" class="sp-chat-quien" onclick="spFicha()">${avatar(e || { nombre: c.nombre })}<div><strong>${esc(e ? e.nombre : c.nombre || 'Contacto')}</strong>
          <small>${e ? esc([...new Set([e.cargo_nomina || e.cargo, e.area_nomina || e.area].filter(Boolean))].join(' · ')) : 'Sin identificar'}</small></div></button>
          <button type="button" class="sp-btn-ficha" onclick="spFicha()"><i class="fas fa-id-card"></i> Ficha</button></div>
        ${resumen ? `<div class="sp-avisos-barra"><span><i class="fas fa-robot"></i> Avisos del bot en este chat: ${esc(resumen)}</span>
          <button type="button" onclick="spAvisos()">${SP.verAvisos ? 'Ocultar' : 'Mostrar'}</button></div>` : ''}
        <div class="sp-mensajes" id="spMensajes">${!ms ? '<div class="sp-vacio"><i class="fas fa-spinner fa-spin"></i></div>' : !ms.length ? '<div class="sp-vacio">Sin mensajes guardados.</div>' : b.html}</div>
        <div class="sp-rapidas">${RESPUESTAS.map((r, i) => `<button type="button" onclick="spRespuesta(${i})">${esc(r.length > 38 ? r.slice(0, 36) + '…' : r)}</button>`).join('')}</div>
        <div class="sp-escribir"><textarea id="spTexto" rows="1" maxlength="2000" placeholder="Escribe una respuesta… (Enter envía)" onkeydown="spTecla(event)"></textarea>
          <button type="button" onclick="spEnviar()" ${SP.enviando ? 'disabled' : ''} aria-label="Enviar"><i class="fas ${SP.enviando ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i></button></div>`;
    }
    const tab = (f, t, n, cls) => `<button type="button" class="${cls || ''} ${SP.filtro === f ? 'on' : ''}" onclick="spFiltro('${f}')">${t}${n ? ` <span>${n}</span>` : ''}</button>`;
    $('spCuerpo').innerHTML = `
      <aside class="sp-lista">
        <div class="sp-lista-cab">
          <div class="sp-buscar"><i class="fas fa-search"></i><input type="search" id="spBusca" value="${esc(SP.busca)}" placeholder="Buscar colaborador o descripción" oninput="spBuscar(this.value)"></div>
          <div class="sp-tabs">${tab('pendientes', 'Pendientes', k.pend, 'pend')}${tab('resueltos', 'Resueltos', k.res)}${tab('otros', 'Otros mensajes', k.otros)}${k.sinid ? tab('sinid', 'Sin identificar', k.sinid, 'sinid') : ''}</div>
        </div>
        <div class="sp-filas">${visibles.length ? visibles.map(filaHtml).join('') : `<div class="sp-vacio">${vacio}</div>`}
          ${SP.porRevisar ? `<div class="sp-revisando"><i class="fas fa-spinner fa-spin"></i> Revisando ${SP.porRevisar} conversaciones…</div>` : ''}</div>
      </aside>
      <section class="sp-chat">${chatHtml}</section>
      <aside class="sp-ficha ${c ? '' : 'oculta'} ${SP.fichaAbierta ? 'abierta' : ''}">${c ? `<button type="button" class="sp-ficha-cerrar" onclick="spFicha()" aria-label="Cerrar ficha"><i class="fas fa-times"></i></button>${fichaHtml(c, e)}` : ''}</aside>`;
    $('spCuerpo').className = 'sp-cuerpo' + (c ? ' con-chat' : '');

    if (c && !e) window.spFiltrarEmp('');
    const nuevo = $('spMensajes');
    if (nuevo) {
      nuevo.dataset.chat = SP.sel;
      // Al abrir un requerimiento se centra su reporte (una vez); después se sigue el final del chat
      const t = SP.ticketSel && SP.fijado !== SP.ticketSel && $('t_' + SP.ticketSel);
      if (t) { t.scrollIntoView({ block: 'center' }); SP.fijado = SP.ticketSel; }
      else nuevo.scrollTop = alFondo ? nuevo.scrollHeight : msjs.scrollTop;
    }
    if (borr && SP.sel) { const t = $('spTexto'); if (t) { t.value = borr.v; if (borr.foco) t.focus(); } }
    if (focoBus !== null) { const b2 = $('spBusca'); if (b2) { b2.focus(); try { b2.setSelectionRange(focoBus, focoBus); } catch (e2) { } } }
  }

  // ------------------------------------------------------------------ arranque
  // Con la pestaña atrás se sigue consultando (más espaciado) para poder avisar con sonido y voz
  function tic() {
    if (!SP.ses || Date.now() < SP.pausaHasta) return;
    const visible = document.visibilityState === 'visible';
    if (Date.now() - SP.tsChats > (visible ? 20000 : 30000)) cargarChats();
    else if (visible && SP.sel && Date.now() - SP.tsMsgs > 8000) { SP.tsMsgs = Date.now(); cargarMensajes(SP.sel, true); }
    else if (!SP.revisando && !SP.cargando && SP.avisados) revisarAvisos(elementos(), conteos(elementos()));
  }
  async function iniciar() {
    try { SP.cache = JSON.parse(localStorage.getItem(KEY_CACHE) || '{}'); } catch (e) { SP.cache = {}; }
    pintar();
    const snap = await db().collection('empleados').get();
    snap.forEach(d => {
      const x = d.data() || {};
      if (x.esEliminado) return;
      SP.emps.set(d.id, { id: d.id, nombre: x.nombre || d.id, area: x.area || '', area_nomina: x.area_nomina || '', unidad: x.unidad || '', cargo: x.cargo || '',
        cargo_nomina: x.cargo_nomina || '', jefe_inmediato: x.jefe_inmediato || '', telefono: x.telefono || x.celular || '', foto_url: x.foto_url || x.fotoUrl || x.foto || '', activo: x.activo });
    });
    db().collection('configuracion').doc('soporte_vinculos').onSnapshot(d => { SP.vinc = Object.assign({}, (d.exists && d.data().vinculos) || {}); pintar(); },
      e => console.warn('Soporte: vínculos', e));
    db().collection('configuracion').doc('soporte_tickets').onSnapshot(d => { SP.tick = Object.assign({}, (d.exists && d.data().tickets) || {}); pintar(); },
      e => console.warn('Soporte: estados', e));
    db().collection('configuracion').doc('whatsapp').onSnapshot(async d => {
      const url = d.exists ? String(d.data().servidorUrl || '').replace(/\/+$/, '') : '';
      if (url && url !== SP.base) { SP.base = url; await resolverSesionOpenWA(); cargarChats(); }
    }, () => { SP.error = 'No se pudo leer la configuración de WhatsApp'; pintar(); });
    if (!SP.timer) SP.timer = setInterval(tic, 2000);
  }

  SP.ses = sesionGuardada();
  if (SP.ses) iniciar(); else pantallaLogin();
})();
