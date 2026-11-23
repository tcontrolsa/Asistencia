// Página del examen (examen.html). La persona entra con el enlace que le llegó por correo (#t=…); no hay contraseña.
// El reloj, las respuestas y los registros viven en el servidor (api.examen_publico); aquí solo se muestran.
// Anti-copia: se registra cada salida de la ventana, pegado, copia, salida de pantalla completa y, si el examen lo
// exige, se comparte la pantalla y se envían capturas periódicas. Todo se avisa y se acepta antes de empezar.
(() => {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
  const APPS_SCRIPT_KEY = 'TCONTROL_SECURE_2026_XYZ';   // la misma de la app (no es secreta)
  const CONFIG = 'https://firestore.googleapis.com/v1/projects/tcontrol-asistencia/databases/(default)/documents/configuracion/historico?key=AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4';
  const CONTACTO = 'informacion@tcontrolsa.com';
  const CAPTURA_CADA_MS = 60000;
  const app = document.getElementById('exm');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // El enlace se toma de la dirección y se borra de ella; para recargar la página se guarda solo en esta pestaña
  let token = (location.hash.match(/^#t=([0-9a-f]{64})$/) || [])[1] || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  try { if (token) sessionStorage.setItem('exm_t', token); else token = sessionStorage.getItem('exm_t') || ''; } catch (e) { }

  // ---------------------------------------------------------------- servidor
  let baseCache = '', modo = 'directo';
  async function base(refrescar) {
    if (baseCache && !refrescar) return baseCache;
    try {
      const d = await (await fetch(CONFIG, { cache: 'no-store' })).json();
      baseCache = String((d.fields && d.fields.url && d.fields.url.stringValue) || '').replace(/\/+$/, '');
    } catch (e) { baseCache = ''; }
    return baseCache;
  }
  async function rpc(p) {
    p = Object.assign({ token }, p);
    if (modo === 'directo') {
      for (let i = 0; i < 2; i++) {
        const b = await base(i > 0);
        if (!b) break;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        try {
          const r = await fetch(`${b}/rpc/examen_publico`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
          if (r.ok) return await r.json();
        } catch (e) { /* se reintenta y luego se usa el respaldo */ } finally { clearTimeout(t); }
      }
      modo = 'respaldo';   // esta red bloquea el servicio directo: el resto de la sesión va por Apps Script
    }
    const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion: 'examenRpc', apiKey: APPS_SCRIPT_KEY, p: JSON.stringify(p) }) });
    const d = await r.json();
    if (!d || typeof d.status !== 'number' || !d.body) throw new Error('El servicio no está disponible. Intenta en unos minutos.');
    return d.body;
  }

  // ---------------------------------------------------------------- estado
  const S = { info: null, preguntas: [], idx: 0, sucias: new Set(), restante: 0, t0: 0, stream: null, video: null, eventos: [], ultCaptura: 0,
    enExamen: false, entregando: false, guardando: false, sinConexion: false, tTimer: 0, tCap: 0, hiddenDesde: 0, blurDesde: 0, bloqueo: '' };
  const segundos = () => Math.max(0, Math.round(S.restante - (performance.now() - S.t0) / 1000));
  const sincroniza = r => { if (r && typeof r.restante === 'number') { S.restante = r.restante; S.t0 = performance.now(); } };
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ---------------------------------------------------------------- pantallas simples
  const tarjeta = (ico, titulo, html, tipo = '') => { app.innerHTML = `<div class="caja"><div class="tarjeta"><span class="ico"><i class="fas ${ico}"></i></span><h1>${titulo}</h1>${html}</div></div>`; };
  const pantallaError = msg => tarjeta('fa-link-slash', 'No se puede abrir el examen', `<p>${esc(msg)}</p><p class="sub">Si crees que es un error, escribe a ${CONTACTO}.</p>`);
  function pantallaEntregado(info) {
    detener();
    try { sessionStorage.removeItem('exm_t'); } catch (e) { }
    tarjeta('fa-circle-check', 'Examen entregado', `<p>Gracias${info && info.nombre ? ', ' + esc(info.nombre) : ''}. Tus respuestas quedaron registradas${info && info.motivoCierre === 'tiempo' ? ' (se cerró porque se acabó el tiempo)' : ''}.</p>
      <p class="sub">Ya puedes cerrar esta ventana. El equipo evaluador revisará tus respuestas.</p>`);
  }

  // ---------------------------------------------------------------- introducción
  function pantallaIntro() {
    const i = S.info, continuar = i.estado === 'INICIADO';
    const compartir = i.exigirPantalla;
    app.innerHTML = `<div class="caja"><div class="tarjeta"><span class="ico"><i class="fas fa-clipboard-question"></i></span>
      <h1>Hola${i.nombre ? ', ' + esc(i.nombre) : ''}</h1><p class="sub">${esc(i.examen)}</p>
      <div class="dato"><div><b>${i.preguntas}</b><span class="sub">preguntas</span></div><div><b>${continuar ? fmt(i.restante) : i.minutos + ' min'}</b><span class="sub">${continuar ? 'tiempo restante' : 'de tiempo'}</span></div></div>
      ${continuar ? '<p class="msg aviso">Ya habías empezado este examen. El tiempo siguió corriendo mientras estuviste fuera.</p>' : ''}
      <h2>Antes de empezar</h2>
      <ul class="reglas"><li>El tiempo empieza cuando presiones «${continuar ? 'Continuar' : 'Iniciar'}» y <b>no se puede pausar</b>.</li>
        <li>Responde con tus propias palabras. Las respuestas se guardan solas.</li>
        <li>Se <b>registra</b> si sales de esta ventana o cambias de pestaña, y los intentos de copiar o pegar. Pegar está bloqueado.</li>
        ${compartir ? '<li>Debes <b>compartir toda tu pantalla</b> (no una pestaña) durante el examen. Se tomarán capturas periódicas. Necesitas un computador con Chrome, Edge o Firefox.</li>' : ''}
        <li>Busca un lugar tranquilo y con buena conexión. Usa pantalla completa.</li></ul>
      <label class="chk"><input type="checkbox" id="acepto"><span>Entiendo y acepto que durante la evaluación se registren estos datos${compartir ? ' y capturas de mi pantalla' : ''}. Se usarán solo para evaluar la prueba y los verá únicamente el equipo evaluador, según la política de datos personales de TCONTROL.</span></label>
      <p class="msg mal" id="err" hidden></p>
      <button class="btn" id="ini" disabled>${continuar ? 'Continuar' : 'Iniciar'} examen</button></div></div>`;
    const chk = document.getElementById('acepto'), btn = document.getElementById('ini'), err = document.getElementById('err');
    chk.onchange = () => { btn.disabled = !chk.checked; };
    btn.onclick = async () => {
      btn.disabled = true; err.hidden = true;
      try { await comenzar(); } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = !chk.checked; }
    };
  }

  // ---------------------------------------------------------------- pantalla compartida
  async function compartirPantalla() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('Tu dispositivo no permite compartir pantalla. Usa un computador con Chrome, Edge o Firefox.');
    let st;
    try { st = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: 1 }, audio: false }); } catch (e) {
      throw new Error('Para empezar debes compartir tu pantalla. Presiona de nuevo el botón y elige «Pantalla completa».');
    }
    const track = st.getVideoTracks()[0];
    const tipo = track && track.getSettings ? track.getSettings().displaySurface : 'monitor';
    if (tipo && tipo !== 'monitor') {
      st.getTracks().forEach(t => t.stop());
      throw new Error('Elegiste una ventana o pestaña. Debes compartir toda la pantalla: vuelve a intentarlo y elige «Pantalla completa».');
    }
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = st;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
    document.body.appendChild(v);   // en la página (casi invisible) para que el navegador siga decodificando la pantalla
    v.play().catch(() => { });   // no se espera: las capturas empiezan cuando el video tenga imagen
    S.stream = st; S.video = v;
    track.addEventListener('ended', () => { if (S.enExamen && !S.entregando) { evento('compartir_detenido', 'Dejó de compartir la pantalla'); bloquear('compartir'); } });
    return true;
  }
  function capturar(motivo) {
    if (!S.video || !S.stream || !S.enExamen) return;
    const ahora = Date.now();
    if (ahora - S.ultCaptura < 8000) return;       // no más de una cada 8 s
    const v = S.video;
    if (!v.videoWidth) return;
    S.ultCaptura = ahora;
    const w = Math.min(960, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    let q = 0.5, img = c.toDataURL('image/jpeg', q);
    while (img.length > 300000 && q > 0.2) { q -= 0.1; img = c.toDataURL('image/jpeg', q); }
    rpc({ accion: 'captura', motivo, imagen: img }).then(sincroniza).catch(() => { });
  }

  // ---------------------------------------------------------------- inicio y reloj
  async function comenzar() {
    if (S.info.exigirPantalla && !S.stream) await compartirPantalla();
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { /* si no deja, se sigue y se avisa */ }
    const r = await rpc({ accion: 'iniciar', acepto: true, pantalla: !!S.stream });
    if (!r.ok) { detener(); throw new Error(r.error || 'No se pudo iniciar'); }
    if (r.estado === 'ENTREGADO') return pantallaEntregado(r);
    S.preguntas = r.preguntas; S.idx = 0; S.sucias.clear(); sincroniza(r);
    S.enExamen = true;
    if (S.stream) evento('compartir_iniciado', 'Pantalla compartida');
    pintarExamen();
    clearInterval(S.tTimer); S.tTimer = setInterval(tick, 500);
    clearInterval(S.tCap); if (S.stream) { setTimeout(() => capturar('inicio'), 4000); S.tCap = setInterval(() => capturar('periodica'), CAPTURA_CADA_MS); }
    clearInterval(S.tGuardar); S.tGuardar = setInterval(guardar, 15000);
    clearInterval(S.tEventos); S.tEventos = setInterval(vaciarEventos, 6000);
  }
  function tick() {
    const el = document.getElementById('reloj');
    const s = segundos();
    if (el) { el.textContent = fmt(s); el.classList.toggle('poco', s <= 300); }
    if (s <= 0 && S.enExamen && !S.entregando) entregar('tiempo');
  }
  function detener() {
    S.enExamen = false;
    clearInterval(S.tTimer); clearInterval(S.tCap); clearInterval(S.tGuardar); clearInterval(S.tEventos);
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
    if (S.video) { S.video.remove(); S.video = null; }
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { }
  }

  // ---------------------------------------------------------------- examen
  function pintarExamen() {
    const p = S.preguntas[S.idx], total = S.preguntas.length;
    const hechas = S.preguntas.filter(q => q.respuesta.trim()).length;
    app.innerHTML = `<div class="barra"><div><b>${esc(S.info.examen)}</b><div class="sub">Respondidas ${hechas} de ${total}</div></div><div class="t" id="reloj">${fmt(segundos())}</div></div>
      <div class="cuerpo"><div class="mapa">${S.preguntas.map((q, i) => `<button data-i="${i}" class="${q.respuesta.trim() ? 'hecha' : ''} ${i === S.idx ? 'actual' : ''}">${i + 1}</button>`).join('')}</div>
      <div class="tarjeta"><span class="etiqueta">Pregunta ${S.idx + 1} de ${total}${p.tipo ? ' · ' + esc(p.tipo) : ''}</span>
        <div class="pregunta">${esc(p.texto)}</div>
        <textarea id="resp" placeholder="Escribe tu respuesta aquí…" spellcheck="true">${esc(p.respuesta)}</textarea>
        <div class="estado" id="estado"></div>
        <div class="nav"><button class="btn sec" id="ant" ${S.idx === 0 ? 'disabled' : ''}>Anterior</button>
          ${S.idx < total - 1 ? '<button class="btn" id="sig">Siguiente</button>' : '<button class="btn mal" id="fin">Entregar examen</button>'}</div></div></div>
      ${S.bloqueo ? velo() : ''}`;
    const ta = document.getElementById('resp');
    ta.oninput = () => { p.respuesta = ta.value; S.sucias.add(S.idx); clearTimeout(S.tDeb); S.tDeb = setTimeout(guardar, 1500); estado('Escribiendo…'); };
    ta.addEventListener('paste', e => { e.preventDefault(); evento('pegar', `Intento de pegar (${(e.clipboardData && e.clipboardData.getData('text') || '').length} caracteres)`); aviso('Pegar está bloqueado durante el examen.'); });
    ta.addEventListener('drop', e => e.preventDefault());
    app.querySelectorAll('.mapa button').forEach(b => b.onclick = () => ir(Number(b.dataset.i)));
    const a = document.getElementById('ant'), s = document.getElementById('sig'), f = document.getElementById('fin');
    if (a) a.onclick = () => ir(S.idx - 1);
    if (s) s.onclick = () => ir(S.idx + 1);
    if (f) f.onclick = () => { const vacias = S.preguntas.filter(q => !q.respuesta.trim()).length; if (confirm(vacias ? `Tienes ${vacias} pregunta(s) sin responder. ¿Entregar de todos modos?` : '¿Entregar el examen? No podrás cambiar tus respuestas.')) entregar('manual'); };
    if (!S.bloqueo) ta.focus();
  }
  const estado = (t, mal) => { const e = document.getElementById('estado'); if (e) { e.textContent = t; e.className = 'estado' + (mal ? ' mal' : ''); } };
  const aviso = t => estado(t, true);
  function ir(i) { if (i < 0 || i >= S.preguntas.length) return; guardar(); S.idx = i; pintarExamen(); }

  async function guardar() {
    if (!S.enExamen || S.guardando || !S.sucias.size) return;
    S.guardando = true;
    const lote = [...S.sucias];
    try {
      const r = await rpc({ accion: 'guardar', respuestas: lote.map(i => ({ n: i + 1, texto: S.preguntas[i].respuesta })) });
      if (r.estado === 'ENTREGADO') { pantallaEntregado(r); return; }
      if (!r.ok) throw new Error(r.error || 'No se guardó');
      lote.forEach(i => S.sucias.delete(i)); sincroniza(r); S.sinConexion = false;
      estado('Guardado ✓');
    } catch (e) { S.sinConexion = true; estado('Sin conexión: tus respuestas se guardarán en cuanto vuelva.', true); }
    finally { S.guardando = false; }
  }

  async function entregar(motivo) {
    if (S.entregando) return;
    S.entregando = true;
    clearTimeout(S.tDeb);
    S.guardando = false;
    try {
      await guardar();
      await vaciarEventos();
      const r = await rpc({ accion: 'entregar', motivo });
      if (!r.ok && r.estado !== 'ENTREGADO') throw new Error(r.error || 'No se pudo entregar');
      pantallaEntregado({ nombre: S.info.nombre, motivoCierre: motivo });
    } catch (e) {
      S.entregando = false;
      alert('No se pudo entregar por un problema de conexión. Revisa tu internet e inténtalo de nuevo; tus respuestas están guardadas.');
    }
  }

  // ---------------------------------------------------------------- anti-copia
  function evento(tipo, detalle, seg) {
    if (!S.enExamen) return;
    S.eventos.push({ tipo, detalle: detalle || '', segundos: seg == null ? undefined : seg });
    if (S.eventos.length >= 10) vaciarEventos();
  }
  async function vaciarEventos() {
    if (!S.eventos.length) return;
    const lote = S.eventos.splice(0, 30);
    try { sincroniza(await rpc({ accion: 'evento', eventos: lote })); } catch (e) { S.eventos.unshift(...lote); }
  }
  function velo() {
    if (S.bloqueo === 'compartir') return `<div class="velo"><div class="tarjeta"><h1>Dejaste de compartir la pantalla</h1><p>Este examen exige pantalla compartida. El tiempo sigue corriendo.</p><p class="msg mal" id="velerr" hidden></p><button class="btn" id="recomp">Volver a compartir pantalla</button></div></div>`;
    return `<div class="velo"><div class="tarjeta"><h1>Vuelve a pantalla completa</h1><p>Saliste de la pantalla completa y quedó registrado. El tiempo sigue corriendo.</p><button class="btn" id="recfull">Volver a pantalla completa</button></div></div>`;
  }
  function bloquear(tipo) {
    S.bloqueo = tipo; pintarExamen();
    const b1 = document.getElementById('recomp'), b2 = document.getElementById('recfull');
    if (b1) b1.onclick = async () => {
      try { S.stream = null; await compartirPantalla(); evento('compartir_iniciado', 'Volvió a compartir'); S.bloqueo = ''; pintarExamen(); } catch (e) { const m = document.getElementById('velerr'); m.textContent = e.message; m.hidden = false; }
    };
    if (b2) b2.onclick = async () => { try { await document.documentElement.requestFullscreen(); } catch (e) { } S.bloqueo = ''; pintarExamen(); };
  }

  document.addEventListener('visibilitychange', () => {
    if (!S.enExamen) return;
    if (document.hidden) { S.hiddenDesde = Date.now(); capturar('sale_ventana'); }
    else if (S.hiddenDesde) { const s = Math.round((Date.now() - S.hiddenDesde) / 1000); S.hiddenDesde = 0; evento('oculta', 'Cambió de pestaña o minimizó', s); capturar('regresa'); vaciarEventos(); }
  });
  window.addEventListener('blur', () => { if (S.enExamen && !S.blurDesde) { S.blurDesde = Date.now(); capturar('pierde_foco'); } });
  window.addEventListener('focus', () => {
    if (!S.enExamen || !S.blurDesde) return;
    const s = Math.round((Date.now() - S.blurDesde) / 1000); S.blurDesde = 0;
    if (s >= 2 && !S.hiddenDesde) evento('blur', 'La ventana perdió el foco (otra ventana o aplicación)', s);
  });
  document.addEventListener('fullscreenchange', () => {
    if (S.enExamen && !S.entregando && !document.fullscreenElement) { evento('sale_pantalla_completa', 'Salió de la pantalla completa'); bloquear('pantalla'); }
  });
  for (const t of ['copy', 'cut']) document.addEventListener(t, e => { if (S.enExamen) { e.preventDefault(); evento(t === 'copy' ? 'copiar' : 'cortar', 'Intento de ' + (t === 'copy' ? 'copiar' : 'cortar')); aviso('Copiar está bloqueado durante el examen.'); } });
  document.addEventListener('contextmenu', e => { if (S.enExamen) { e.preventDefault(); evento('menu_contextual', 'Clic derecho'); } });
  document.addEventListener('keydown', e => {
    if (!S.enExamen) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    const raro = k === 'PrintScreen' || k === 'F12' || (ctrl && e.shiftKey && /^[ijc]$/i.test(k)) || (ctrl && /^[ups]$/i.test(k));
    if (raro) { e.preventDefault(); evento('tecla', `${ctrl ? 'Ctrl+' : ''}${e.shiftKey ? 'Mayús+' : ''}${k}`); }
  });
  window.addEventListener('beforeunload', e => {
    if (!S.enExamen || S.entregando) return;
    evento('cierre_pagina', 'Intentó cerrar o recargar la página'); vaciarEventos();
    e.preventDefault(); e.returnValue = '';
  });

  // ---------------------------------------------------------------- arranque
  (async () => {
    if (!token) return pantallaError('Abre el enlace que te llegó por correo, completo.');
    tarjeta('fa-spinner fa-spin', 'Cargando…', '');
    try {
      const r = await rpc({ accion: 'abrir' });
      if (!r.ok) return pantallaError(r.error || 'El enlace no es válido.');
      if (r.estado === 'ENTREGADO') return pantallaEntregado(r);
      S.info = r; sincroniza(r);
      pantallaIntro();
    } catch (e) { pantallaError(e.message); }
  })();
})();
