/**
 * TCONTROL · Credencial de visitante frecuente · página privada (credencial.html#f=TOKEN)
 *
 * El visitante llega con el enlace que le envió TCONTROL por WhatsApp o correo. Aquí ve su credencial
 * (QR, vigencia) y DECIDE si agrega su foto para que la portería confirme su identidad:
 *   * Aviso completo antes de pedir nada (LOPDP): responsable, finalidad, quién la ve, cuánto dura,
 *     encargados, derechos y cómo retirarla. La foto es voluntaria: la credencial vale igual sin ella.
 *   * Consentimiento expreso (casilla sin marcar) y versión del aviso guardada con la fecha.
 *   * Puede retirar su foto cuando quiera desde este mismo enlace.
 * La foto se recorta y reduce en el teléfono (480×480 JPEG) antes de enviarla.
 * Datos: PostgREST (api.frecuente_publica, rol anónimo); respaldo por Apps Script (visitaRpc).
 */
(function () {
  'use strict';

  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
  const APPS_SCRIPT_KEY = 'TCONTROL_SECURE_2026_XYZ';   // la misma de la app (no es secreta)
  const FIRESTORE_CONFIG = 'https://firestore.googleapis.com/v1/projects/tcontrol-asistencia/databases/(default)/documents/configuracion/historico?key=AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4';
  const RESPONSABLE = 'TCONTROL S.A.';

  const $app = document.getElementById('crApp');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { token: '', datos: null, error: '', enviando: false, foto: '', acepto: false, verAviso: false, invalido: false };
  const fecha = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');

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
  async function rpc(p) {
    for (let intento = 0; intento < 2; intento++) {
      const b = await base(intento > 0);
      if (!b) break;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(`${b}/rpc/frecuente_publica`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
        if (r.ok) return await r.json();
      } catch (e) { /* se reintenta y luego se usa el respaldo */ } finally { clearTimeout(t); }
    }
    const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ accion: 'visitaRpc', apiKey: APPS_SCRIPT_KEY, fn: 'frecuente_publica', p: JSON.stringify(p) }) });
    const d = await r.json();
    if (!d || typeof d.status !== 'number') throw new Error('Servicio no disponible. Inténtalo más tarde.');
    return d.body;
  }
  async function llamar(p) {
    const r = await rpc(Object.assign({ token: st.token }, p));
    if (r && r.invalido) { st.invalido = true; throw new Error(r.error); }
    if (!r || r.ok === false) throw new Error((r && r.error) || 'No se pudo completar. Inténtalo de nuevo.');
    st.datos = r;
    return r;
  }

  function qrSvg(codigo) {
    if (typeof window.qrcode !== 'function') return `<div class="vs-codigo">${esc(codigoBonito(codigo))}</div>`;
    const q = window.qrcode(0, 'M'); q.addData('TCV1:' + codigo); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  // ---------------------------------------------------------------- foto: recorte cuadrado 480×480 en el teléfono
  function prepararFoto(archivo) {
    return new Promise((ok, mal) => {
      if (!archivo || !/^image\//.test(archivo.type)) return mal(new Error('Elige una foto.'));
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas'); c.width = c.height = 480;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 480);
        g.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, 480, 480);
        URL.revokeObjectURL(url);
        let calidad = 0.85, dato = c.toDataURL('image/jpeg', calidad);
        while (dato.length > 400000 && calidad > 0.4) { calidad -= 0.1; dato = c.toDataURL('image/jpeg', calidad); }
        ok(dato);
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto. Toma otra.')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- vistas
  function aviso(d) {
    const contacto = esc(d.contactoDatos || 'informacion@tcontrolsa.com');
    return `<div class="vs-card" id="crAviso" style="font-size:13.5px; line-height:1.55;">
      <h2 class="vs-h2"><i class="fas fa-user-shield"></i> Aviso sobre tu foto</h2>
      <p><strong>Responsable:</strong> ${RESPONSABLE} · Contacto para tus datos: <a href="mailto:${contacto}">${contacto}</a>.</p>
      <p><strong>Qué dato:</strong> una fotografía de tu rostro.</p>
      <p><strong>Para qué:</strong> solo para que el guardia de portería confirme que eres tú cuando ingresas con tu credencial de visitante frecuente.
        No se usa para reconocimiento facial automático, ni para publicidad, ni con otro fin.</p>
      <p><strong>Es voluntaria:</strong> la base para tratarla es tu consentimiento. Si no la das, tu credencial funciona igual presentando tu documento de identidad.</p>
      <p><strong>Quién la ve:</strong> los guardias de portería al escanear tu credencial y la persona de TCONTROL que administra tu credencial.
        También va en la imagen de tu credencial que te enviamos por WhatsApp o correo. No la compartimos con terceros.</p>
      <p><strong>Encargados:</strong> para dibujar la imagen de tu credencial usamos por unos segundos un servicio de Google (el archivo temporal se borra enseguida) y el envío se hace por WhatsApp o correo.</p>
      <p><strong>Cuánto tiempo:</strong> mientras tu credencial esté vigente. Se borra automáticamente cuando vence o es anulada, o antes si la retiras.</p>
      <p><strong>Tus derechos:</strong> puedes pedir acceso, rectificación, eliminación, oposición y portabilidad, y retirar tu consentimiento en cualquier momento
        con el botón «Retirar mi foto» de esta página o escribiendo a ${contacto}. Retirarlo no afecta lo hecho antes.
        También puedes presentar un reclamo ante la Superintendencia de Protección de Datos Personales.</p>
      <p class="vs-muted vs-small" style="margin:0">Versión del aviso: ${esc(d.version)}</p></div>`;
  }

  function vistaCredencial() {
    const d = st.datos, c = d.credencial;
    const vigente = c.vigente, conFoto = !!c.foto;
    const estado = c.estado === 'REVOCADA' ? '<div class="vs-error"><i class="fas fa-ban"></i> Esta credencial fue anulada. Si necesitas visitarnos, comunícate con la persona que visitas.</div>'
      : c.vencida ? '<div class="vs-error"><i class="fas fa-calendar-xmark"></i> Esta credencial venció. Pide a la persona que visitas que la renueve.</div>' : '';

    let fotoHtml;
    if (conFoto) {
      fotoHtml = `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-id-badge"></i> Tu foto</h2>
        <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
          <img src="${c.foto}" alt="Tu foto" width="110" height="110" style="border-radius:12px; object-fit:cover; border:1px solid #e2e8f0;">
          <p class="vs-small" style="flex:1; min-width:180px; margin:0;">La portería la verá al escanear tu credencial. Aceptaste el aviso el ${fecha(c.consentimientoFotoEn)}.
            Se borra sola cuando tu credencial termine.</p></div>
        <div class="vs-acciones" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="vs-btn vs-btn-sm" data-a="cambiar"><i class="fas fa-camera-rotate"></i> Cambiar foto</button>
          <button type="button" class="vs-btn vs-btn-sm" data-a="retirar" style="color:#b91c1c;"><i class="fas fa-trash"></i> Retirar mi foto</button>
          <button type="button" class="vs-btn vs-btn-sm" data-a="aviso"><i class="fas fa-file-shield"></i> Ver aviso</button></div>
        ${st.verAviso ? aviso(d) : ''}</section>`;
    } else if (vigente || (!c.vencida && c.estado === 'ACTIVA')) {
      fotoHtml = `<section class="vs-card"><h2 class="vs-h2"><i class="fas fa-camera"></i> ¿Quieres agregar tu foto? <small class="vs-muted">(opcional)</small></h2>
        <p class="vs-small">Con tu foto, el guardia te reconoce más rápido al ingresar. Antes de decidir, lee el aviso:</p>
        ${aviso(d)}
        ${st.foto ? `<div style="text-align:center; margin:6px 0 12px;"><img src="${st.foto}" alt="Vista previa" width="180" height="180" style="border-radius:14px; object-fit:cover; border:1px solid #e2e8f0;"></div>` : ''}
        <label class="vs-check"><input type="checkbox" id="crAcepto" ${st.acepto ? 'checked' : ''}>
          <span>Leí el aviso y <strong>acepto</strong> que TCONTROL S.A. use mi foto solo para verificar mi identidad en portería mientras mi credencial esté vigente.</span></label>
        ${st.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
        <input type="file" id="crArchivo" accept="image/*" capture="user" hidden>
        <div style="display:grid; gap:8px;">
          ${st.foto
            ? `<button type="button" class="vs-btn vs-btn-ok vs-btn-bloque" data-a="subir" ${st.enviando ? 'disabled' : ''}>${st.enviando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : '<i class="fas fa-check"></i> Usar esta foto'}</button>
               <button type="button" class="vs-btn vs-btn-bloque" data-a="tomar" ${st.enviando ? 'disabled' : ''}><i class="fas fa-camera-rotate"></i> Tomar otra</button>`
            : `<button type="button" class="vs-btn vs-btn-prim vs-btn-bloque" data-a="tomar"><i class="fas fa-camera"></i> Tomar o elegir mi foto</button>`}
          ${c.fotoEstado === 'rechazada' ? '<p class="vs-small vs-muted" style="text-align:center; margin:0;">Indicaste que prefieres no dar tu foto. Puedes cambiar de opinión cuando quieras.</p>'
            : `<button type="button" class="vs-btn vs-btn-bloque" data-a="rechazar" ${st.enviando ? 'disabled' : ''}>Prefiero no dar mi foto</button>`}
        </div>
        <p class="vs-small vs-muted" style="margin:10px 0 0;"><i class="fas fa-lightbulb"></i> De frente, con buena luz, sin gafas oscuras ni gorra.</p></section>`;
    } else fotoHtml = '';

    return `${estado}
      <section class="vs-card" style="text-align:center;">
        <div class="vs-codigo-lbl">Credencial de visitante frecuente</div>
        <div style="display:flex; justify-content:center; gap:12px; align-items:center; margin-top:8px;">
          ${conFoto ? `<img src="${c.foto}" alt="" width="64" height="64" style="border-radius:10px; object-fit:cover;">` : ''}
          <div style="text-align:${conFoto ? 'left' : 'center'};"><strong style="font-size:17px;">${esc(c.nombre)}</strong><br><span class="vs-muted">${esc(c.empresa || '')}</span></div></div>
        ${vigente || (!c.vencida && c.estado === 'ACTIVA') ? `<div class="vs-qr" aria-label="Código QR de ingreso">${qrSvg(c.codigo)}</div>
          <div class="vs-codigo">${esc(codigoBonito(c.codigo))}</div>` : ''}
        <p class="vs-small" style="margin:10px 0 0;">Visita a <strong>${esc(c.anfitrion)}</strong><br>Vale del ${fecha(c.desde)} al ${fecha(c.hasta)} · ${esc(c.diasTexto)}</p>
        <p class="vs-small vs-muted" style="margin:6px 0 0;">Muéstrala en portería con tu documento de identidad${c.epp ? '. Para planta trae tu EPP: ' + esc(String(c.eppTexto || '').replace(/\.\s*$/, '')) : ''}.</p>
      </section>
      ${fotoHtml}`;
  }

  function pintar() {
    if (!st.token || st.invalido) {
      $app.innerHTML = `<section class="vs-card" style="text-align:center;"><i class="fas fa-link-slash" style="font-size:32px; color:#94a3b8;"></i>
        <h1 class="vs-h2" style="justify-content:center; margin-top:10px;">Enlace no válido</h1>
        <p class="vs-small">${esc(st.error || 'Abre el enlace completo que te llegó por WhatsApp o correo.')}</p></section>`;
      return;
    }
    if (!st.datos) {
      $app.innerHTML = st.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>
        <button type="button" class="vs-btn vs-btn-bloque" data-a="recargar">Reintentar</button>` : '<div class="vs-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
      return;
    }
    $app.innerHTML = vistaCredencial();
  }

  async function accion(a) {
    st.error = '';
    try {
      if (a === 'recargar') { pintar(); await llamar({ accion: 'ver' }); }
      if (a === 'aviso') { st.verAviso = !st.verAviso; }
      if (a === 'tomar') { const inp = document.getElementById('crArchivo'); if (inp) inp.click(); return; }
      if (a === 'cambiar') { st.datos.credencial.foto = ''; st.foto = ''; st.acepto = false; }
      if (a === 'subir') {
        st.acepto = !!document.getElementById('crAcepto')?.checked;
        if (!st.acepto) { st.error = 'Para guardar tu foto marca que leíste y aceptas el aviso.'; return pintar(); }
        st.enviando = true; pintar();
        await llamar({ accion: 'foto', imagen: st.foto, acepto: 'true', version: st.datos.version });
        st.foto = ''; st.acepto = false;
        mensaje('¡Listo! Guardamos tu foto. En unos minutos te llega tu credencial actualizada.');
      }
      if (a === 'rechazar') { st.enviando = true; pintar(); await llamar({ accion: 'rechazar' }); st.foto = ''; mensaje('Entendido: tu credencial funciona sin foto.'); }
      if (a === 'retirar') {
        if (!confirm('¿Retirar tu foto? Se borra ahora mismo y la portería ya no la verá. Tu credencial sigue vigente.')) return;
        st.enviando = true; pintar();
        await llamar({ accion: 'retirar' });
        mensaje('Tu foto fue borrada y retiraste tu consentimiento.');
      }
    } catch (e) { st.error = e.message; }
    st.enviando = false;
    pintar();
  }
  function mensaje(t) {
    let x = document.getElementById('vsToast');
    if (!x) { x = document.createElement('div'); x.id = 'vsToast'; x.className = 'vs-toast'; x.setAttribute('role', 'status'); document.body.appendChild(x); }
    x.textContent = t; x.classList.add('vs-toast-on');
    clearTimeout(x._h); x._h = setTimeout(() => x.classList.remove('vs-toast-on'), 4000);
  }

  $app.addEventListener('click', ev => {
    const b = ev.target.closest('[data-a]');
    if (b && !b.disabled) accion(b.dataset.a);
  });
  $app.addEventListener('change', async ev => {
    if (ev.target.id === 'crAcepto') { st.acepto = ev.target.checked; return; }
    if (ev.target.id !== 'crArchivo') return;
    st.acepto = !!document.getElementById('crAcepto')?.checked;
    try { st.foto = await prepararFoto(ev.target.files && ev.target.files[0]); st.error = ''; } catch (e) { st.error = e.message; }
    pintar();
  });

  // El token viaja en el fragmento (#f=), que el navegador no envía a ningún servidor
  st.token = (location.hash.match(/f=([0-9a-f]{64})/) || [])[1] || '';
  pintar();
  if (st.token) llamar({ accion: 'ver' }).then(pintar).catch(e => { st.error = e.message; pintar(); });
})();
