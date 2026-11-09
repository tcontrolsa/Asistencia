// Registro propio de colaboradores nuevos (registro.html).
// Sin enlace: pide el celular y la base envía por WhatsApp un enlace privado.
// Con enlace (#t=…): formulario de nombre, fecha de nacimiento y correo; el enlace sirve una vez.
// Datos: PostgREST api.registro_publico (sin sesión); respaldo de red: Apps Script registroRpc.
(() => {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
  const APPS_SCRIPT_KEY = 'TCONTROL_SECURE_2026_XYZ';   // la misma de la app (no es secreta)
  const CONFIG = 'https://firestore.googleapis.com/v1/projects/tcontrol-asistencia/databases/(default)/documents/configuracion/historico?key=AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4';
  const CONTACTO = 'informacion@tcontrolsa.com';
  const app = document.getElementById('rgApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // El enlace se toma de la dirección y se borra de ella: no queda en el historial ni en capturas de pantalla
  const token = (location.hash.match(/^#t=([0-9a-f]{64})$/) || [])[1] || '';
  if (location.hash) history.replaceState(null, '', location.pathname);

  let baseCache = '';
  async function base(refrescar) {
    if (baseCache && !refrescar) return baseCache;
    try {
      const d = await (await fetch(CONFIG, { cache: 'no-store' })).json();
      baseCache = String((d.fields && d.fields.url && d.fields.url.stringValue) || '').replace(/\/+$/, '');
    } catch (e) { baseCache = ''; }
    return baseCache;
  }
  async function rpc(p) {
    for (let i = 0; i < 2; i++) {
      const b = await base(i > 0);
      if (!b) break;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch(`${b}/rpc/registro_publico`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
        if (r.ok) return await r.json();
      } catch (e) { /* se reintenta y luego se usa el respaldo */ } finally { clearTimeout(t); }
    }
    const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion: 'registroRpc', apiKey: APPS_SCRIPT_KEY, p: JSON.stringify(p) }) });
    const d = await r.json();
    if (!d || typeof d.status !== 'number' || !d.body) throw new Error('El servicio no está disponible. Intenta en unos minutos.');
    return d.body;
  }

  const cabecera = (ico, titulo, texto) => `<span class="rg-ico"><i class="fas ${ico}"></i></span><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}`;
  function enviando(form, si) {
    form.querySelectorAll('button, input').forEach(x => { x.disabled = si; });
    const b = form.querySelector('button[type=submit]');
    if (b) b.dataset.txt = b.dataset.txt || b.innerHTML, b.innerHTML = si ? '<i class="fas fa-spinner fa-spin"></i> Enviando…' : b.dataset.txt;
  }
  function error(form, msg) {
    const e = form.querySelector('.rg-error');
    e.textContent = msg;
    e.hidden = !msg;
  }

  // ---------------------------------------------------------------- 1. pedir el enlace
  function pantallaTelefono(aviso = '') {
    app.innerHTML = `${cabecera('fa-user-plus', 'Regístrate como colaborador', 'Escribe tu número de celular. Te enviaremos por WhatsApp un enlace para completar tu registro.')}
      ${aviso ? `<p class="rg-aviso">${esc(aviso)}</p>` : ''}
      <form novalidate>
        <label>Celular con WhatsApp<input name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="0991234567" maxlength="20" required></label>
        <p class="rg-error" role="alert" hidden></p>
        <button type="submit" class="rg-btn"><i class="fab fa-whatsapp"></i> Enviarme el enlace</button>
      </form>
      <p class="rg-pie">¿Ya tienes cuenta? <a href="./index.html">Ingresa a la app</a></p>`;
    const f = app.querySelector('form');
    f.tel.focus();
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const tel = f.tel.value.trim();
      if (tel.replace(/\D/g, '').length < 9) return error(f, 'Escribe tu celular de 10 dígitos, por ejemplo 0991234567.');
      error(f, '');
      enviando(f, true);
      try {
        const r = await rpc({ accion: 'pedir', telefono: tel });
        if (!r.ok) throw new Error(r.error);
        pantallaEnviado(r.mensaje);
      } catch (e) {
        enviando(f, false);
        error(f, e.message || 'No se pudo enviar. Intenta de nuevo.');
      }
    });
  }

  function pantallaEnviado(mensaje) {
    app.innerHTML = `${cabecera('fa-paper-plane', 'Revisa tu WhatsApp', esc(mensaje))}
      <ul class="rg-pasos"><li>Abre el enlace desde tu celular.</li><li>Sirve <b>una sola vez</b> y vence en <b>24 horas</b>.</li><li>No lo compartas con nadie.</li></ul>
      <button type="button" class="rg-btn sec" disabled data-otra>Pedir otro enlace (60)</button>`;
    const b = app.querySelector('[data-otra]');
    let s = 60;
    const t = setInterval(() => {
      s -= 1;
      b.textContent = s > 0 ? `Pedir otro enlace (${s})` : 'Pedir otro enlace';
      if (s <= 0) { clearInterval(t); b.disabled = false; }
    }, 1000);
    b.addEventListener('click', () => pantallaTelefono());
  }

  // ---------------------------------------------------------------- 2. completar el registro
  function hace(anios) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - anios);
    return d.toISOString().slice(0, 10);
  }

  function pantallaFormulario(telefono) {
    app.innerHTML = `${cabecera('fa-id-card', 'Completa tu registro', `Celular verificado: <b>${esc(telefono)}</b>`)}
      <form novalidate>
        <label>Nombre completo<input name="nombre" autocomplete="name" maxlength="120" placeholder="Apellidos y nombres" required></label>
        <label>Fecha de nacimiento<input name="fecha" type="date" min="${hace(90)}" max="${hace(15)}" required></label>
        <label>Correo electrónico<input name="correo" type="email" inputmode="email" autocomplete="email" maxlength="120" required></label>
        <label class="rg-check"><input name="acepto" type="checkbox" required>
          <span>Acepto que TCONTROL S.A. use estos datos y mi celular para crear mi ficha de colaborador y controlar mi asistencia.
          <button type="button" class="rg-link" data-aviso>Ver aviso de privacidad</button></span></label>
        <div class="rg-aviso-datos" hidden>
          <p><b>Responsable:</b> TCONTROL S.A.</p>
          <p><b>Para qué:</b> revisar tu solicitud y, si se aprueba, crear tu ficha de colaborador para el control de asistencia.</p>
          <p><b>Datos:</b> celular, nombre, fecha de nacimiento y correo. Solo los ve el personal autorizado.</p>
          <p><b>Conservación:</b> si la solicitud no se aprueba, tus datos se anonimizan a los 180 días.</p>
          <p><b>Tus derechos:</b> acceso, rectificación, eliminación y oposición escribiendo a ${CONTACTO}.</p>
        </div>
        <p class="rg-error" role="alert" hidden></p>
        <button type="submit" class="rg-btn"><i class="fas fa-check"></i> Enviar mi registro</button>
      </form>`;
    const f = app.querySelector('form');
    app.querySelector('[data-aviso]').addEventListener('click', () => { const a = app.querySelector('.rg-aviso-datos'); a.hidden = !a.hidden; });
    f.nombre.focus();
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const nombre = f.nombre.value.trim().replace(/\s+/g, ' ');
      if (nombre.split(' ').length < 2) return error(f, 'Escribe tu nombre completo: nombres y apellidos.');
      if (!f.fecha.value) return error(f, 'Indica tu fecha de nacimiento.');
      if (!f.correo.checkValidity() || !f.correo.value) return error(f, 'Revisa tu correo electrónico.');
      if (!f.acepto.checked) return error(f, 'Para continuar debes aceptar el aviso de protección de datos.');
      error(f, '');
      enviando(f, true);
      try {
        const r = await rpc({ accion: 'registrar', token, nombre, fechaNacimiento: f.fecha.value, correo: f.correo.value.trim(), acepto: true });
        if (r.invalido) return pantallaInvalido(r.error);
        if (!r.ok) throw new Error(r.error);
        app.innerHTML = `${cabecera('fa-circle-check', 'Recibimos tu registro', `Tu número de solicitud es <b>${esc(r.codigo)}</b>.`)}
          <ul class="rg-pasos"><li>Un supervisor revisará tus datos.</li><li>Cuando se apruebe te llegará un WhatsApp con tu ID para ingresar a la app.</li><li>Ese día crearás tu PIN de acceso.</li></ul>`;
      } catch (e) {
        enviando(f, false);
        error(f, e.message || 'No se pudo enviar. Intenta de nuevo.');
      }
    });
  }

  function pantallaInvalido(msg) {
    app.innerHTML = `${cabecera('fa-link-slash', 'Enlace no válido', esc(msg || 'Este enlace ya no es válido.'))}
      <button type="button" class="rg-btn" data-nuevo>Pedir un enlace nuevo</button>`;
    app.querySelector('[data-nuevo]').addEventListener('click', () => pantallaTelefono());
  }

  async function iniciar() {
    if (!token) return pantallaTelefono();
    try {
      const r = await rpc({ accion: 'ver', token });
      if (!r.ok) return r.invalido ? pantallaInvalido(r.error) : pantallaTelefono(r.error);
      pantallaFormulario(r.telefono);
    } catch (e) {
      app.innerHTML = `${cabecera('fa-plug-circle-xmark', 'Sin conexión', esc(e.message))}<button type="button" class="rg-btn" onclick="location.reload()">Reintentar</button>`;
    }
  }
  iniciar();
})();
