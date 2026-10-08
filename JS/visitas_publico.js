/**
 * TCONTROL · Registro de visitas · página pública (visitas.html)
 *
 * El visitante no tiene cuenta: su acceso es un enlace privado (#t=TOKEN de 64 caracteres) que
 * solo él tiene; la base guarda únicamente su hash. Con ese enlace ve su visita, su código QR,
 * puede cancelarla y, al concluir, calificarla. Este dispositivo recuerda sus enlaces (localStorage)
 * para volver rápido; se pueden olvidar desde la página.
 *
 * Datos: PostgREST (api.visita_publica, rol anónimo). Si la red bloquea la conexión directa, se usa
 * Apps Script (acción visitaRpc) como respaldo.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- configuración
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
  const APPS_SCRIPT_KEY = 'TCONTROL_SECURE_2026_XYZ';   // la misma de la app (no es secreta)
  const FIRESTORE_CONFIG = 'https://firestore.googleapis.com/v1/projects/tcontrol-asistencia/databases/(default)/documents/configuracion/historico?key=AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4';
  // Contacto para ejercer los derechos de protección de datos
  let CONTACTO_DATOS = 'informacion@tcontrolsa.com';
  const RESPONSABLE = 'TCONTROL S.A.';
  const KEY_MIS = 'tcontrol_mis_visitas';
  const PREFIJO_QR = 'TCV1:';

  const $app = document.getElementById('vsApp');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { token: '', visita: null, form: {}, anfitrion: null, sugerencias: [], cal: {}, enviando: false, error: '',
    porteria: '', porteriaAviso: '' };
  // Tipos de visita: los define el admin en el panel (llegan con "terminos"); estos son de respaldo
  const ICONOS_TIPO = { oficina: 'fa-building', planta: 'fa-industry', cliente: 'fa-box-open', proveedor: 'fa-truck' };
  const cfg = {
    tipos: [
      { id: 'oficina', nombre: 'Oficina', descripcion: 'Reuniones, trámites y visitas a oficinas', epp: false, anfitrionOpcional: false },
      { id: 'planta', nombre: 'Planta', descripcion: 'Ingreso a planta o talleres (EPP obligatorio)', epp: true, anfitrionOpcional: false },
      { id: 'cliente', nombre: 'Cliente de producto', descripcion: 'Retirar producto suelto o una compra', epp: false, anfitrionOpcional: true },
      { id: 'proveedor', nombre: 'Proveedor o contratista', descripcion: 'Entregas, servicios, mantenimiento u obras', epp: false, anfitrionOpcional: false }
    ],
    eppTexto: 'Casco, calzado de seguridad y chaleco reflectivo. Sin ellos no se permite el ingreso a planta.',
    diasPreregistro: 60, diasAnonimizar: 180
  };
  const tipoSel = () => cfg.tipos.find(t => t.id === st.form.tipo) || null;

  // ---------------------------------------------------------------- fechas
  const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const sumarDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const fechaLarga = f => {
    const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const horaDe = ts => ts ? new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');

  function toast(msg) {
    let t = document.getElementById('vsToast');
    if (!t) { t = document.createElement('div'); t.id = 'vsToast'; t.className = 'vs-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('vs-toast-on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('vs-toast-on'), 3200);
  }

  // ---------------------------------------------------------------- API
  let baseCache = '';
  async function base(refrescar) {
    if (baseCache && !refrescar) return baseCache;
    try {
      const r = await fetch(FIRESTORE_CONFIG, { cache: 'no-store' });
      const d = await r.json();
      baseCache = String((d.fields && d.fields.url && d.fields.url.stringValue) || '').replace(/\/+$/, '');
    } catch (e) { baseCache = ''; }
    return baseCache;
  }
  async function porAppsScript(p) {
    const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion: 'visitaRpc', apiKey: APPS_SCRIPT_KEY, p: JSON.stringify(p) }) });
    const d = await r.json();
    if (!d || typeof d.status !== 'number') throw new Error('Servicio no disponible');
    return d.body;
  }
  async function rpc(p) {
    for (let intento = 0; intento < 2; intento++) {
      const b = await base(intento > 0);
      if (!b) break;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const r = await fetch(`${b}/rpc/visita_publica`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
        if (r.ok) return await r.json();
      } catch (e) { /* se reintenta y luego se usa el respaldo */ } finally { clearTimeout(t); }
    }
    return porAppsScript(p);
  }

  // ---------------------------------------------------------------- enlaces recordados en este dispositivo
  const misVisitas = () => { try { return JSON.parse(localStorage.getItem(KEY_MIS) || '[]'); } catch (e) { return []; } };
  function recordar(token, v) {
    try {
      const lista = misVisitas().filter(x => x.t !== token);
      lista.unshift({ t: token, codigo: v.codigo, fecha: v.fecha, anfitrion: v.anfitrion });
      localStorage.setItem(KEY_MIS, JSON.stringify(lista.slice(0, 10)));
    } catch (e) { }
  }
  function olvidar(token) {
    try { localStorage.setItem(KEY_MIS, JSON.stringify(token ? misVisitas().filter(x => x.t !== token) : [])); } catch (e) { }
  }
  const enlacePrivado = token => `${location.origin}${location.pathname}#t=${token}`;

  // ---------------------------------------------------------------- textos legales (LOPDP)
  const LEGAL = {
    privacidad: () => `
      <p><strong>${RESPONSABLE}</strong> es responsable del tratamiento de los datos que registras para tu visita, conforme a la
      Ley Orgánica de Protección de Datos Personales (LOPDP) del Ecuador.</p>
      <h4>¿Qué datos tratamos?</h4>
      <ul><li>Tu nombre, la empresa o institución que representas y el motivo de la visita.</li>
      <li>Fecha, hora, persona a la que visitas y las horas de ingreso y salida registradas en portería.</li>
      <li>Solo si los dejas: un número de WhatsApp o un correo, únicamente para enviarte tu enlace y avisos de esta visita.</li>
      <li>Solo si la dejas: tu calificación y comentario sobre la visita.</li></ul>
      <p>No pedimos ni guardamos tu documento de identidad, fotografía ni ubicación. En portería se verifica tu documento a la vista,
      sin copiarlo ni registrarlo.</p>
      <h4>¿Para qué?</h4>
      <ul><li>Gestionar tu acceso y la seguridad de las personas y de las instalaciones.</li>
      <li>Avisar a la persona que visitas y, si lo solicita, coordinar servicios como el almuerzo.</li>
      <li>Mejorar la atención a visitantes con tu calificación (opcional).</li></ul>
      <h4>Base legal</h4>
      <p>Tu consentimiento, que otorgas al aceptar este aviso, y nuestro interés legítimo en la seguridad de las instalaciones.
      Puedes retirar tu consentimiento cancelando la visita desde tu enlace.</p>
      <h4>¿Quién accede?</h4>
      <p>Solo la persona que visitas, el personal de seguridad de portería (sin tus datos de contacto) y la administración.
      No vendemos ni cedemos tus datos a terceros, salvo obligación legal.</p>
      <h4>¿Cuánto tiempo?</h4>
      <p>Mientras dura la visita y luego archivada, visible solo para ti (con tu enlace), la persona que visitaste y la administración.
      A los ${cfg.diasAnonimizar} días de concluida, la visita se anonimiza: se borran tu nombre, empresa, motivo, contacto y comentario, y tu enlace deja de funcionar.</p>
      <h4>Tus derechos</h4>
      <p>Puedes ejercer tus derechos de acceso, rectificación y actualización, eliminación, oposición, portabilidad y suspensión
      del tratamiento escribiendo a <a href="mailto:${esc(CONTACTO_DATOS)}?subject=Protecci%C3%B3n%20de%20datos%20-%20Visitas">${esc(CONTACTO_DATOS)}</a>. También puedes presentar un reclamo ante la Superintendencia de Protección de Datos Personales.</p>
      <h4>Seguridad</h4>
      <p>Tu enlace privado es la única forma de ver tu visita: no lo compartas. Los datos se guardan en servidores con acceso restringido
      y cifrado en tránsito.</p>`,
    terminos: () => `
      <h4>Condiciones de la visita</h4>
      <ul><li>Presenta en portería tu código QR (o tu código de 8 caracteres) y un documento de identidad vigente.</li>
      <li>El ingreso depende de la aprobación de la persona que visitas y puede negarse por razones de seguridad.</li>
      <li>Permanece en las áreas autorizadas, acompañado por tu anfitrión cuando se te indique.</li>
      <li>Cumple las normas de seguridad y salud ocupacional de las instalaciones (equipo de protección, señalización y rutas de evacuación).</li>
      <li>No tomes fotografías ni videos de procesos, equipos o personas sin autorización.</li>
      <li>Registra tu salida en portería al terminar la visita.</li>
      <li>La información a la que accedas durante la visita es confidencial.</li></ul>
      <h4>Tu enlace privado</h4>
      <p>Es personal e intransferible. Quien lo tenga puede ver y cancelar tu visita. Si crees que alguien más lo tiene, pide a la persona que visitas que genere uno nuevo.</p>`,
    ayuda: () => `
      <div class="vs-pasos-ayuda">
        <div><b>1</b><span><strong>Registra tu visita</strong>Elige a la persona que visitas, la fecha y el motivo. Toma un minuto.</span></div>
        <div><b>2</b><span><strong>Espera la aprobación</strong>Esa persona recibe un aviso y aprueba tu visita. Si dejaste WhatsApp o correo, te avisamos.</span></div>
        <div><b>3</b><span><strong>Ingresa con tu QR</strong>En portería muestra tu código QR y tu documento de identidad. Al salir, muéstralo otra vez.</span></div>
      </div>
      <h4>¿No encuentro a la persona que visito?</h4>
      <p>Escribe al menos 3 letras de su nombre o apellido, sin tildes si prefieres. Si aun así no aparece, pídele que te envíe una invitación desde su app: te llegará un enlace para completar tu registro.</p>
      <h4>¿Dónde veo mi código QR?</h4>
      <p>En tu <strong>enlace privado</strong>, que aparece al registrarte (cópialo o guárdalo). Si dejaste WhatsApp o correo, también te lo enviamos al aprobarse la visita. En este dispositivo, tus visitas recientes aparecen al abrir esta página.</p>
      <h4>¿Qué llevo el día de la visita?</h4>
      <ul><li>Tu código QR en el celular (o impreso, o el código de 8 caracteres).</li>
      <li>Un documento de identidad vigente: el guardia solo lo mira, no lo copia ni lo registra.</li>
      <li>El equipo de protección que te indique tu anfitrión, si vas a áreas operativas.</li></ul>
      <h4>¿Puedo cambiar la fecha?</h4>
      <p>Cancela la visita desde tu enlace y registra una nueva, o pide a la persona que visitas que te invite para otra fecha.</p>
      <h4>¿Llegaste y no puedes ingresar?</h4>
      <p>Comunícate con la persona que visitas: el ingreso solo se habilita el día programado y con la visita aprobada.</p>
      <h4>Contacto</h4>
      <p>Para consultas sobre tus datos personales escribe a <a href="mailto:${esc(CONTACTO_DATOS)}">${esc(CONTACTO_DATOS)}</a>.</p>`
  };
  const TITULOS = { terminos: 'Términos de la visita', privacidad: 'Aviso de privacidad', ayuda: 'Ayuda para visitantes' };
  function abrirLegal(tipo) {
    const m = document.createElement('div');
    m.className = 'vs-modal';
    m.innerHTML = `<div class="vs-modal-in" role="dialog" aria-modal="true" aria-labelledby="vsLegalT">
      <div class="vs-modal-cab"><h3 id="vsLegalT">${tipo === 'ayuda' ? '<i class="fas fa-circle-question" style="color:var(--vs-rojo)"></i> ' : ''}${TITULOS[tipo] || ''}</h3><button class="vs-x" aria-label="Cerrar">&times;</button></div>
      <div class="vs-modal-cuerpo">${LEGAL[tipo]()}${tipo === 'ayuda' ? '' : `<p class="vs-small">Versión ${esc(VERSION_TERMINOS)}.</p>`}</div></div>`;
    const cerrar = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('.vs-x')) cerrar(); });
    document.addEventListener('keydown', function f(e) { if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', f); } });
    document.body.appendChild(m);
    m.querySelector('.vs-x').focus();
  }
  let VERSION_TERMINOS = '2026-10-07';

  // ---------------------------------------------------------------- QR
  function qrSvg(codigo) {
    if (typeof qrcode !== 'function') return `<div class="vs-muted">Código: ${esc(codigo)}</div>`;
    const q = qrcode(0, 'M');
    q.addData(PREFIJO_QR + codigo);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  // Imagen descargable: logo + QR + código + datos de la visita
  let logoImg = null;
  function cargarLogo() {
    if (logoImg) return logoImg;
    logoImg = new Promise(res => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = './assets/images/Logotipo T Control.png';
    });
    return logoImg;
  }
  async function descargarPase(v) {
    const logo = await cargarLogo();
    const q = qrcode(0, 'M');
    q.addData(PREFIJO_QR + v.codigo);
    q.make();
    const n = q.getModuleCount(), celda = 10, margen = 40, ancho = Math.max(n * celda + margen * 2, 520);
    const cab = logo ? 120 : 30, x0 = (ancho - n * celda) / 2;
    const c = document.createElement('canvas');
    c.width = ancho; c.height = cab + n * celda + 210;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#dc2626'; x.fillRect(0, 0, c.width, 10);
    if (logo) { const h = 80, w = logo.width * h / logo.height; x.drawImage(logo, (ancho - w) / 2, 24, w, h); }
    x.fillStyle = '#0f172a';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(x0 + k * celda, cab + r * celda, celda, celda);
    const y = cab + n * celda;
    x.textAlign = 'center';
    x.font = 'bold 13px sans-serif'; x.fillStyle = '#94a3b8'; x.fillText('PASE DE VISITA · CÓDIGO', ancho / 2, y + 34);
    x.font = 'bold 36px monospace'; x.fillStyle = '#0f172a'; x.fillText(codigoBonito(v.codigo), ancho / 2, y + 74);
    x.font = '18px sans-serif'; x.fillStyle = '#475569';
    x.fillText(`${fechaLarga(v.fecha)}${v.hora ? ' · ' + v.hora : ''}`, ancho / 2, y + 112);
    x.fillText(`${v.nombre || ''} · visita a ${v.anfitrion || ''}`, ancho / 2, y + 140);
    x.font = '14px sans-serif'; x.fillStyle = '#94a3b8';
    x.fillText('Presenta este código y tu documento de identidad en portería.', ancho / 2, y + 178);
    const a = document.createElement('a');
    a.download = `visita-TCONTROL-${v.codigo}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  // ---------------------------------------------------------------- vistas
  const ESTADOS = {
    invitada: ['fa-envelope-open-text', 'Completa tu registro'],
    pendiente: ['fa-hourglass-half', 'Esperando aprobación'],
    aprobada: ['fa-check-circle', 'Aprobada'],
    en_curso: ['fa-door-open', 'Visita en curso'],
    concluida: ['fa-flag-checkered', 'Concluida'],
    rechazada: ['fa-times-circle', 'No aprobada'],
    cancelada: ['fa-ban', 'Cancelada'],
    no_asistio: ['fa-calendar-times', 'No se registró el ingreso']
  };
  const chipEstado = e => `<span class="vs-estado vs-e-${esc(e)}"><i class="fas ${(ESTADOS[e] || [])[0] || 'fa-circle'}"></i> ${esc((ESTADOS[e] || [])[1] || e)}</span>`;

  function vistaInicio() {
    const mis = st.porteria ? [] : misVisitas();
    const f = st.form;
    const enPorteria = !!st.porteria;
    const sug = st.sugerencias.length && !st.anfitrion
      ? `<div class="vs-sug" role="listbox">${st.sugerencias.map(a => `<button type="button" role="option" data-anf="${esc(a.id)}" data-nom="${esc(a.nombre)}" data-area="${esc(a.area)}"><strong>${esc(a.nombre)}</strong><span>${esc(a.area)}</span></button>`).join('')}</div>` : '';
    $app.innerHTML = `
      ${st.porteriaAviso ? `<div class="vs-error" role="alert"><i class="fas fa-qrcode"></i> ${esc(st.porteriaAviso)}</div>` : ''}
      ${enPorteria ? `<section class="vs-card vs-hero vs-hero-porteria">
        <div class="vs-porteria-tag"><i class="fas fa-door-open"></i> Registro en portería</div>
        <h1>¿Llegaste sin cita?</h1>
        <p>Registra tus datos aquí mismo. Al terminar verás un código QR: muéstraselo al guardia junto con tu documento de identidad.</p>
      </section>` : `<section class="vs-card vs-hero">
        <h1>Bienvenido a <em>TCONTROL</em></h1>
        <p>Registra tu visita en un minuto. Cuando la persona que visitas la apruebe, tendrás un código QR para ingresar rápido por portería.</p>
        <ol class="vs-como">
          <li><i class="fas fa-pen-to-square"></i><span><strong>Regístrate</strong>Datos básicos de tu visita</span></li>
          <li><i class="fas fa-user-check"></i><span><strong>Aprobación</strong>Te avisamos al aprobarse</span></li>
          <li><i class="fas fa-qrcode"></i><span><strong>Ingresa</strong>Con tu QR y tu cédula</span></li>
        </ol>
        <button type="button" class="vs-link vs-hero-ayuda" data-legal="ayuda"><i class="fas fa-circle-question"></i> ¿Cómo funciona? Preguntas frecuentes</button>
      </section>`}
      ${mis.length ? `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-history"></i> Tus visitas en este dispositivo</h2>
        <div class="vs-mis">${mis.map(m => `<button type="button" data-abrir="${esc(m.t)}"><span><strong>${esc(fechaLarga(m.fecha))}</strong><br><span class="vs-muted">Visita a ${esc(m.anfitrion || '')} · ${esc(codigoBonito(m.codigo))}</span></span><i class="fas fa-chevron-right"></i></button>`).join('')}</div>
        <p class="vs-small vs-muted" style="margin:10px 0 0">¿Dispositivo compartido? <button type="button" class="vs-link" data-olvidar="todo">Olvidar estas visitas</button></p></section>` : ''}
      <form class="vs-card" id="vsForm" novalidate>
        <h2 class="vs-h2"><i class="fas fa-id-badge"></i> Registrar mi visita</h2>
        ${st.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
        <fieldset class="vs-tipos"><legend>¿Tu visita es para…?</legend>
          ${cfg.tipos.map(t => `<label class="vs-tipo ${f.tipo === t.id ? 'vs-tipo-on' : ''}"><input type="radio" name="tipo" value="${esc(t.id)}" ${f.tipo === t.id ? 'checked' : ''}>
            <i class="fas ${ICONOS_TIPO[t.id] || 'fa-door-open'}"></i><span><strong>${esc(t.nombre)}</strong><small>${esc(t.descripcion || '')}</small></span>
            ${t.epp ? '<em class="vs-tipo-epp"><i class="fas fa-hard-hat"></i> EPP</em>' : ''}</label>`).join('')}
        </fieldset>
        ${tipoSel() && tipoSel().epp ? `<div class="vs-epp"><i class="fas fa-hard-hat"></i><span><strong>EPP obligatorio para ingresar a planta.</strong> ${esc(cfg.eppTexto)}</span></div>` : ''}
        <label class="vs-campo" for="vsBuscar"><span>¿A quién visitas?${tipoSel() && tipoSel().anfitrionOpcional ? ' <small>(opcional)</small>' : ''}</span>
          ${st.anfitrion ? '' : `<input id="vsBuscar" type="search" autocomplete="off" placeholder="Escribe al menos 3 letras de su nombre" value="${esc(f.buscar || '')}" aria-describedby="vsAyudaAnf">
          <small class="vs-hint" id="vsAyudaAnf"><i class="fas fa-lightbulb"></i> ${tipoSel() && tipoSel().anfitrionOpcional ? 'Si no sabes a quién, déjalo vacío: te atenderá el área encargada.' : 'Busca por nombre o apellido y elígelo de la lista.'}</small>`}</label>
        ${st.anfitrion ? `<div class="vs-elegido"><i class="fas fa-user-check"></i><strong>${esc(st.anfitrion.nombre)}</strong><span class="vs-small">${esc(st.anfitrion.area)}</span><button type="button" class="vs-link" data-cambiar-anf>Cambiar</button></div>` : sug}
        ${enPorteria ? '' : `<div class="vs-fila">
          <label class="vs-campo"><span>Fecha</span><input name="fecha" type="date" required min="${hoyLocal()}" max="${sumarDias(hoyLocal(), cfg.diasPreregistro)}" value="${esc(f.fecha || hoyLocal())}"></label>
          <label class="vs-campo"><span>Hora aproximada <small>(opcional)</small></span><input name="hora" type="time" value="${esc(f.hora || '')}"></label>
        </div>
        <small class="vs-hint vs-hint-bloque"><i class="fas fa-calendar-check"></i> Elige un día entre hoy y los próximos ${cfg.diasPreregistro} días. La hora ayuda a que te esperen.</small>`}
        <label class="vs-campo"><span>Nombre y apellido</span><input name="nombre" autocomplete="name" maxlength="80" required value="${esc(f.nombre || '')}">
          <small class="vs-hint"><i class="fas fa-id-card"></i> Tal como aparece en tu documento: el guardia lo comparará al ingresar.</small></label>
        <label class="vs-campo"><span>Empresa o institución</span><input name="empresa" autocomplete="organization" maxlength="80" required placeholder='O "Particular"' value="${esc(f.empresa || '')}"></label>
        <label class="vs-campo"><span>Motivo de la visita</span><textarea name="motivo" rows="2" maxlength="200" required placeholder="Ej.: reunión comercial, entrega de materiales, mantenimiento">${esc(f.motivo || '')}</textarea></label>
        <div class="vs-opcional">
          <p><i class="fas fa-paper-plane"></i> <strong>Opcional:</strong> déjanos un WhatsApp o un correo solo si quieres recibir tu enlace y los avisos de esta visita.</p>
          <div class="vs-fila">
            <label class="vs-campo"><span>WhatsApp <small>(opcional)</small></span><input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="09XXXXXXXX" value="${esc(f.whatsapp || '')}"></label>
            <label class="vs-campo"><span>Correo <small>(opcional)</small></span><input name="email" type="email" autocomplete="email" maxlength="120" value="${esc(f.email || '')}"></label>
          </div>
        </div>
        <input class="vs-trampa" name="sitio" tabindex="-1" autocomplete="off" aria-hidden="true">
        <label class="vs-check"><input type="checkbox" name="acepta" ${f.acepta ? 'checked' : ''}>
          <span>He leído y acepto el <button type="button" class="vs-link" data-legal="privacidad">aviso de privacidad</button> y los
          <button type="button" class="vs-link" data-legal="terminos">términos de la visita</button>, y consiento el tratamiento de mis datos para gestionar esta visita.</span></label>
        <button type="submit" class="vs-btn vs-btn-prim vs-btn-bloque" ${st.enviando ? 'disabled' : ''}>${st.enviando ? '<i class="fas fa-spinner fa-spin"></i> Registrando…' : enPorteria ? '<i class="fas fa-qrcode"></i> Registrarme y obtener mi código' : '<i class="fas fa-paper-plane"></i> Registrar visita'}</button>
        <p class="vs-small vs-muted" style="margin:10px 0 0;text-align:center"><i class="fas fa-lock"></i> Solo pedimos lo necesario. No guardamos tu documento de identidad.</p>
      </form>`;
  }

  function vistaVisita() {
    const v = st.visita;
    const pase = ['aprobada', 'en_curso'].includes(v.estado);
    const cab = `<section class="vs-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h2 class="vs-h2" style="margin:0"><i class="fas fa-building"></i> Visita a ${esc(v.anfitrion)}</h2>${chipEstado(v.estado)}</div>
        <dl class="vs-datos">
          <dt>Fecha</dt><dd>${esc(fechaLarga(v.fecha))}${v.hora ? ' · ' + esc(v.hora) : ''}</dd>
          ${v.tipoNombre ? `<dt>Tipo</dt><dd>${esc(v.tipoNombre)}</dd>` : ''}
          ${v.nombre ? `<dt>Visitante</dt><dd>${esc(v.nombre)}${v.empresa ? ' · ' + esc(v.empresa) : ''}</dd>` : ''}
          ${v.motivo ? `<dt>Motivo</dt><dd>${esc(v.motivo)}</dd>` : ''}
          ${v.almuerzo ? '<dt>Almuerzo</dt><dd><i class="fas fa-utensils"></i> Incluido</dd>' : ''}
        </dl>
        ${v.epp && !['concluida', 'cancelada', 'rechazada', 'no_asistio'].includes(v.estado) ? `<div class="vs-epp" style="margin:14px 0 0"><i class="fas fa-hard-hat"></i><span><strong>Trae tu EPP:</strong> ${esc(v.eppTexto || cfg.eppTexto)}</span></div>` : ''}</section>`;

    let cuerpo = '';
    if (v.estado === 'invitada') {
      cuerpo = vistaCompletar(v);
    } else if (v.estado === 'pendiente') {
      cuerpo = `<section class="vs-card"><div class="vs-aviso"><i class="fas fa-hourglass-half"></i><span>Tu solicitud fue enviada. Cuando ${esc(v.anfitrion)} la apruebe, en este mismo enlace aparecerá tu código QR${v.whatsapp || v.email ? ' y te avisaremos' : ''}.</span></div>
        ${v.whatsapp || v.email ? '' : '<div class="vs-tip"><i class="fas fa-lightbulb"></i><span>No dejaste WhatsApp ni correo: vuelve a abrir este enlace para ver si ya fue aprobada.</span></div>'}
        ${bloqueEnlace()}</section>`;
    } else if (pase) {
      cuerpo = `<section class="vs-card vs-pase">
        <img class="vs-pase-logo" src="./assets/images/Logotipo T Control.png" alt="TCONTROL" width="120" height="53">
        <div class="vs-codigo-lbl">${v.estado === 'en_curso' ? 'Muéstralo también a la salida' : v.origen === 'porteria' ? 'Muéstraselo al guardia ahora' : 'Tu pase de ingreso'}</div>
        <div class="vs-qr" aria-label="Código QR de ingreso">${qrSvg(v.codigo)}</div>
        <div class="vs-codigo-lbl">Código</div><div class="vs-codigo">${esc(codigoBonito(v.codigo))}</div>
        <p class="vs-muted" style="margin:12px 0 14px">Presenta este código y tu documento de identidad en portería.</p>
        <div class="vs-tip"><i class="fas fa-lightbulb"></i><span>Sube el brillo de la pantalla al mostrar el QR. Si no se lee, el guardia puede escribir el código.</span></div>
        <div class="vs-acciones"><button type="button" class="vs-btn" data-descargar><i class="fas fa-download"></i> Guardar imagen</button>
        <button type="button" class="vs-btn" data-compartir><i class="fas fa-share-alt"></i> Copiar mi enlace</button></div></section>`;
    } else if (v.estado === 'concluida') {
      cuerpo = v.calificacion ? `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-star"></i> Tu calificación</h2>
          ${['atencion', 'puntualidad', 'instalaciones'].map(k => `<div class="vs-aspecto"><span>${{ atencion: 'Atención', puntualidad: 'Puntualidad', instalaciones: 'Instalaciones' }[k]}</span><span class="vs-estrellas-mini">${'★'.repeat(v.calificacion[k] || 0)}${'☆'.repeat(5 - (v.calificacion[k] || 0))}</span></div>`).join('')}
          ${v.calificacion.comentario ? `<p class="vs-muted">"${esc(v.calificacion.comentario)}"</p>` : ''}<p class="vs-small vs-muted">¡Gracias por ayudarnos a mejorar!</p></section>`
        : vistaCalificar();
    } else if (v.estado === 'rechazada') {
      cuerpo = `<section class="vs-card"><div class="vs-error"><i class="fas fa-info-circle"></i><span>La visita no fue aprobada${v.motivoRechazo ? `: ${esc(v.motivoRechazo)}` : '.'} Si necesitas más información, comunícate con la persona que ibas a visitar.</span></div></section>`;
    } else if (v.estado === 'cancelada' || v.estado === 'no_asistio') {
      cuerpo = `<section class="vs-card"><p class="vs-muted">${v.estado === 'cancelada' ? 'Esta visita fue cancelada.' : 'No se registró el ingreso a esta visita.'}${v.motivoRechazo ? ' ' + esc(v.motivoRechazo) : ''}</p></section>`;
    }

    const linea = `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-stream"></i> Seguimiento</h2><ul class="vs-linea">
        <li class="vs-hecho"><i class="fas fa-check-circle"></i>Registro${v.terminosAceptados ? ' y aceptación de términos' : ''}</li>
        <li class="${['aprobada', 'en_curso', 'concluida'].includes(v.estado) ? 'vs-hecho' : ''}"><i class="fas fa-${['aprobada', 'en_curso', 'concluida'].includes(v.estado) ? 'check-circle' : 'circle'}"></i>Aprobación</li>
        <li class="${v.entradaEn ? 'vs-hecho' : ''}"><i class="fas fa-${v.entradaEn ? 'check-circle' : 'circle'}"></i>Ingreso${v.entradaEn ? ' · ' + horaDe(v.entradaEn) : ''}</li>
        <li class="${v.salidaEn ? 'vs-hecho' : ''}"><i class="fas fa-${v.salidaEn ? 'check-circle' : 'circle'}"></i>Salida${v.salidaEn ? ' · ' + horaDe(v.salidaEn) : ''}</li></ul>
        ${v.archivada ? `<p class="vs-small vs-muted" style="margin:8px 0 0"><i class="fas fa-archive"></i> Visita archivada: solo la ves tú, la persona que visitaste y la administración. Se anonimizará el ${esc(fechaLarga(v.anonimizarEl))}.</p>` : ''}</section>`;

    const acciones = ['invitada', 'pendiente', 'aprobada'].includes(v.estado)
      ? `<p style="text-align:center"><button type="button" class="vs-link" data-cancelar><i class="fas fa-ban"></i> Cancelar mi visita</button></p>` : '';
    $app.innerHTML = `${st.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
      ${cab}${cuerpo}${v.estado === 'invitada' ? '' : linea}${acciones}
      <p style="text-align:center" class="vs-small"><button type="button" class="vs-link" data-inicio><i class="fas fa-plus"></i> Registrar otra visita</button></p>`;
  }

  function bloqueEnlace() {
    return `<p class="vs-small vs-muted" style="margin:0 0 6px"><strong>Guarda tu enlace privado:</strong> es la única forma de volver a ver tu visita y tu código.</p>
      <div class="vs-acciones"><button type="button" class="vs-btn vs-btn-sm" data-compartir><i class="fas fa-copy"></i> Copiar enlace</button></div>`;
  }

  function vistaCompletar(v) {
    const f = st.form;
    return `<form class="vs-card" id="vsCompletar" novalidate>
      <h2 class="vs-h2"><i class="fas fa-envelope-open-text"></i> Completa tu registro</h2>
      <p class="vs-muted">${esc(v.anfitrion)} te invitó. Confirma tus datos para obtener tu código de ingreso.</p>
      <label class="vs-campo"><span>Nombre y apellido</span><input name="nombre" autocomplete="name" maxlength="80" required value="${esc(f.nombre != null ? f.nombre : (v.nombre || ''))}"></label>
      <label class="vs-campo"><span>Empresa o institución</span><input name="empresa" autocomplete="organization" maxlength="80" required value="${esc(f.empresa != null ? f.empresa : (v.empresa || ''))}"></label>
      <label class="vs-campo"><span>Motivo</span><textarea name="motivo" rows="2" maxlength="200" required>${esc(f.motivo != null ? f.motivo : (v.motivo || ''))}</textarea></label>
      <div class="vs-opcional"><p><strong>Opcional:</strong> para recibir tu enlace y avisos de esta visita.</p>
        <div class="vs-fila">
          <label class="vs-campo"><span>WhatsApp <small>(opcional)</small></span><input name="whatsapp" type="tel" inputmode="tel" maxlength="16" value="${esc(f.whatsapp || '')}"></label>
          <label class="vs-campo"><span>Correo <small>(opcional)</small></span><input name="email" type="email" maxlength="120" value="${esc(f.email || '')}"></label>
        </div></div>
      <label class="vs-check"><input type="checkbox" name="acepta" ${f.acepta ? 'checked' : ''}>
        <span>He leído y acepto el <button type="button" class="vs-link" data-legal="privacidad">aviso de privacidad</button> y los
        <button type="button" class="vs-link" data-legal="terminos">términos de la visita</button>.</span></label>
      <button type="submit" class="vs-btn vs-btn-prim vs-btn-bloque" ${st.enviando ? 'disabled' : ''}>${st.enviando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : '<i class="fas fa-check"></i> Confirmar y obtener mi código'}</button>
    </form>`;
  }

  function vistaCalificar() {
    const aspectos = [['atencion', 'Atención recibida'], ['puntualidad', 'Puntualidad'], ['instalaciones', 'Instalaciones']];
    return `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-star"></i> ¿Cómo fue tu visita?</h2>
      <p class="vs-muted">Tu opinión es anónima para el resto del equipo: solo la ven la persona que visitaste y la administración.</p>
      ${aspectos.map(([k, t]) => `<div class="vs-aspecto"><span>${t}</span><div class="vs-estrellas" role="radiogroup" aria-label="${t}">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${st.cal[k] === n}" aria-label="${n} de 5" class="${(st.cal[k] || 0) >= n ? 'vs-on' : ''}" data-cal="${k}" data-v="${n}">★</button>`).join('')}</div></div>`).join('')}
      <label class="vs-campo" style="margin-top:12px"><span>Comentario <small>(opcional)</small></span><textarea id="vsComentario" rows="3" maxlength="500">${esc(st.cal.comentario || '')}</textarea></label>
      <button type="button" class="vs-btn vs-btn-prim vs-btn-bloque" data-calificar ${st.enviando ? 'disabled' : ''}><i class="fas fa-paper-plane"></i> Enviar calificación</button></section>`;
  }

  function pintar() { if (st.visita) vistaVisita(); else vistaInicio(); }

  // ---------------------------------------------------------------- acciones
  async function abrir(token) {
    st.token = token; st.visita = null; st.error = ''; st.form = {}; st.cal = {};
    $app.innerHTML = '<div class="vs-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando tu visita…</div>';
    try {
      const r = await rpc({ accion: 'ver', token });
      if (!r.ok) throw new Error(r.error);
      st.visita = r.visita;
      recordar(token, r.visita);
    } catch (e) {
      olvidar(token);
      st.error = e.message || 'No se pudo cargar la visita.';
      history.replaceState(null, '', location.pathname);
    }
    pintar();
  }

  function leerForm(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    d.acepta = !!form.querySelector('[name="acepta"]').checked;
    return d;
  }

  async function registrar(form) {
    const d = leerForm(form);
    st.form = Object.assign(st.form, d);
    if (d.sitio) return;   // trampa para robots
    const t = tipoSel();
    if (!t) { st.error = 'Elige para qué es tu visita.'; return pintar(); }
    if (!st.anfitrion && !t.anfitrionOpcional) { st.error = 'Elige a la persona que visitas.'; return pintar(); }
    if (!d.acepta) { st.error = 'Debes aceptar el aviso de privacidad y los términos para registrar la visita.'; return pintar(); }
    st.enviando = true; st.error = ''; pintar();
    try {
      const r = await rpc({ accion: 'preregistrar', tipo: t.id, anfitrionId: st.anfitrion ? st.anfitrion.id : '', nombre: d.nombre, empresa: d.empresa, motivo: d.motivo,
        fecha: d.fecha, hora: d.hora, whatsapp: d.whatsapp, email: d.email, aceptaTerminos: true, porteria: st.porteria || undefined });
      if (!r.ok) {
        if (r.porteriaVencida) { st.porteria = ''; st.porteriaAviso = ''; }
        throw new Error(r.error);
      }
      st.enviando = false; st.form = {}; st.anfitrion = null; st.porteria = ''; st.porteriaAviso = '';
      history.replaceState(null, '', location.pathname + '#t=' + r.token);
      st.token = r.token; st.visita = r.visita;
      recordar(r.token, r.visita);
      pintar();
      window.scrollTo(0, 0);
      toast(r.visita.origen === 'porteria' ? 'Listo. Muestra tu código al guardia.' : 'Visita registrada. Guarda tu enlace privado.');
    } catch (e) {
      st.enviando = false; st.error = e.message || 'No se pudo registrar la visita.'; pintar();
    }
  }

  async function completar(form) {
    const d = leerForm(form);
    st.form = Object.assign(st.form, d);
    if (!d.acepta) { st.error = 'Debes aceptar el aviso de privacidad y los términos.'; return pintar(); }
    st.enviando = true; st.error = ''; pintar();
    try {
      const r = await rpc({ accion: 'completar', token: st.token, nombre: d.nombre, empresa: d.empresa, motivo: d.motivo, whatsapp: d.whatsapp, email: d.email, aceptaTerminos: true });
      if (!r.ok) throw new Error(r.error);
      st.enviando = false; st.visita = r.visita; st.form = {};
      recordar(st.token, r.visita);
      pintar(); window.scrollTo(0, 0);
      toast('¡Listo! Este es tu código de ingreso.');
    } catch (e) { st.enviando = false; st.error = e.message; pintar(); }
  }

  async function accionSimple(accion, extra, ok) {
    st.enviando = true; pintar();
    try {
      const r = await rpc(Object.assign({ accion, token: st.token }, extra || {}));
      if (!r.ok) throw new Error(r.error);
      st.visita = r.visita; st.error = '';
      toast(ok);
    } catch (e) { st.error = e.message; }
    st.enviando = false; pintar();
  }

  // Búsqueda de anfitrión: el túnel tarda 1–9 s por llamada, así que se consulta una sola vez por
  // las primeras 3 letras (el servidor devuelve hasta 25) y lo demás se filtra en el teléfono.
  const LIM_ANF = 25;
  const cacheAnf = {};                       // 'san' → Promise<{ lista, completa }> (compartida mientras llega)
  const cacheTexto = {};                     // consultas exactas ya hechas al servidor
  let tBuscar = null, nBuscar = 0;
  const normal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  function filtrarLocal(lista, q) { const n = normal(q); return lista.filter(a => normal(a.nombre).includes(n)); }
  async function consultarAnf(q) {
    const r = await rpc({ accion: 'anfitriones', q });
    if (!r.ok) throw new Error(r.error || 'No se pudo buscar');
    return r.anfitriones || [];
  }
  function porPrefijo(pre) {
    if (!cacheAnf[pre]) {
      cacheAnf[pre] = consultarAnf(pre).then(lista => ({ lista, completa: lista.length < LIM_ANF }));
      cacheAnf[pre].catch(() => delete cacheAnf[pre]);
    }
    return cacheAnf[pre];
  }
  function porTexto(q) {
    const k = normal(q);
    if (!cacheTexto[k]) { cacheTexto[k] = consultarAnf(q); cacheTexto[k].catch(() => delete cacheTexto[k]); }
    return cacheTexto[k];
  }
  function buscarAnfitrion(q) {
    st.form.buscar = q;
    clearTimeout(tBuscar);
    const qq = q.trim(), id = ++nBuscar;
    if (qq.length < 3) { st.buscando = false; st.sugerencias = []; return refrescarSugerencias(); }
    const prefijo = porPrefijo(normal(qq).slice(0, 3));   // se lanza de inmediato (o se reutiliza)
    st.buscando = true;
    tBuscar = setTimeout(async () => {
      try {
        const { lista, completa } = await prefijo;
        if (id !== nBuscar) return;          // el usuario siguió escribiendo: esta respuesta ya no sirve
        const exacta = normal(qq).length <= 3;   // la consulta es el propio prefijo
        let sug = exacta ? lista : filtrarLocal(lista, qq);
        // Lista del prefijo recortada, o sin coincidencias por nombre corto: el servidor busca en el
        // nombre completo (segundos apellidos, etc.). Mientras tanto se muestra lo que ya hay.
        if (!exacta && (!completa || !sug.length)) {
          st.sugerencias = sug; refrescarSugerencias();
          sug = await porTexto(qq);
          if (id !== nBuscar) return;
        }
        st.sugerencias = sug;
      } catch (e) { if (id !== nBuscar) return; st.sugerencias = []; st.error = e.message; }
      st.buscando = false; refrescarSugerencias();
    }, 120);
    refrescarSugerencias();
  }
  // Repinta solo la lista de sugerencias (sin perder el foco del buscador)
  function refrescarSugerencias() {
    const input = document.getElementById('vsBuscar');
    if (!input) return pintar();
    let cont = input.closest('label').nextElementSibling;
    if (cont && cont.classList.contains('vs-sug')) cont.remove();
    if (!st.sugerencias.length) {
      if (st.form.buscar && st.form.buscar.trim().length >= 3) {
        const d = document.createElement('div');
        d.className = 'vs-sug';
        d.innerHTML = `<button type="button" disabled><span>${st.buscando ? 'Buscando…' : 'Sin resultados. Revisa el nombre.'}</span></button>`;
        input.closest('label').after(d);
      }
      return;
    }
    const d = document.createElement('div');
    d.className = 'vs-sug'; d.setAttribute('role', 'listbox');
    d.innerHTML = st.sugerencias.map(a => `<button type="button" role="option" data-anf="${esc(a.id)}" data-nom="${esc(a.nombre)}" data-area="${esc(a.area)}"><strong>${esc(a.nombre)}</strong><span>${esc(a.area)}</span></button>`).join('');
    input.closest('label').after(d);
  }

  // ---------------------------------------------------------------- eventos
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.legal) { e.preventDefault(); return abrirLegal(b.dataset.legal); }
    if (b.dataset.anf) {
      const form = document.getElementById('vsForm');
      if (form) st.form = Object.assign(st.form, leerForm(form));
      st.anfitrion = { id: b.dataset.anf, nombre: b.dataset.nom, area: b.dataset.area };
      st.sugerencias = []; st.error = '';
      return pintar();
    }
    if (b.hasAttribute('data-cambiar-anf')) {
      const form = document.getElementById('vsForm');
      if (form) st.form = Object.assign(st.form, leerForm(form));
      st.anfitrion = null; return pintar();
    }
    if (b.dataset.abrir) { history.replaceState(null, '', '#t=' + b.dataset.abrir); return abrir(b.dataset.abrir); }
    if (b.dataset.olvidar) { if (confirm('¿Olvidar las visitas guardadas en este dispositivo? Necesitarás tu enlace para volver a verlas.')) { olvidar(); pintar(); } return; }
    if (b.hasAttribute('data-inicio')) { st.visita = null; st.token = ''; st.error = ''; history.replaceState(null, '', location.pathname); return pintar(); }
    if (b.hasAttribute('data-descargar')) return descargarPase(st.visita);
    if (b.hasAttribute('data-compartir')) {
      const url = enlacePrivado(st.token);
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Enlace copiado. Guárdalo en un lugar seguro.'), () => prompt('Copia tu enlace privado:', url));
      else prompt('Copia tu enlace privado:', url);
      return;
    }
    if (b.hasAttribute('data-cancelar')) {
      if (confirm('¿Cancelar tu visita? Avisaremos a la persona que ibas a visitar.')) accionSimple('cancelar', {}, 'Visita cancelada');
      return;
    }
    if (b.dataset.cal) { st.cal[b.dataset.cal] = Number(b.dataset.v); const c = document.getElementById('vsComentario'); if (c) st.cal.comentario = c.value; return pintar(); }
    if (b.hasAttribute('data-calificar')) {
      const c = document.getElementById('vsComentario');
      st.cal.comentario = c ? c.value : '';
      if (!st.cal.atencion || !st.cal.puntualidad || !st.cal.instalaciones) { st.error = 'Califica los tres aspectos con estrellas.'; return pintar(); }
      return accionSimple('calificar', { atencion: st.cal.atencion, puntualidad: st.cal.puntualidad, instalaciones: st.cal.instalaciones, comentario: st.cal.comentario }, '¡Gracias por tu calificación!');
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'vsBuscar') buscarAnfitrion(e.target.value); });
  document.addEventListener('change', e => {
    if (e.target.name === 'tipo' && e.target.closest('#vsForm')) {
      st.form = Object.assign(st.form, leerForm(e.target.form)); st.error = ''; pintar();
    }
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'vsForm') registrar(e.target);
    if (e.target.id === 'vsCompletar') completar(e.target);
  });
  window.addEventListener('hashchange', () => { const t = (location.hash.match(/t=([0-9a-f]{64})/) || [])[1]; if (t && t !== st.token) abrir(t); });

  // ---------------------------------------------------------------- inicio
  rpc({ accion: 'terminos' }).then(r => {
    if (!r || !r.ok) return;
    if (r.version) VERSION_TERMINOS = r.version;
    if (Array.isArray(r.tipos) && r.tipos.length) cfg.tipos = r.tipos;
    if (r.eppTexto) cfg.eppTexto = r.eppTexto;
    if (r.diasPreregistro) cfg.diasPreregistro = r.diasPreregistro;
    if (r.diasAnonimizar) cfg.diasAnonimizar = r.diasAnonimizar;
    if (r.contacto) CONTACTO_DATOS = r.contacto;
    if (!st.visita && document.getElementById('vsForm') && !document.activeElement?.closest?.('#vsForm')) pintar();
  }).catch(() => { });
  const tokenInicial = (location.hash.match(/t=([0-9a-f]{64})/) || [])[1];
  const porteriaInicial = (new URLSearchParams(location.search).get('porteria') || '').toLowerCase();
  if (tokenInicial) abrir(tokenInicial);
  else if (/^[0-9a-f]{32}$/.test(porteriaInicial)) {
    // Llegó escaneando el QR de portería: registro para hoy, sin cita
    st.porteria = porteriaInicial; pintar();
    rpc({ accion: 'porteria', porteria: porteriaInicial }).then(r => {
      if (r && r.ok && !r.vigente && st.porteria) {
        st.porteria = '';
        st.porteriaAviso = 'El código QR de portería ya venció. Pide al guardia que muestre uno nuevo, o registra tu visita con cita abajo.';
        history.replaceState(null, '', location.pathname);
        if (!st.visita) pintar();
      }
    }).catch(() => { });
  } else pintar();
})();
