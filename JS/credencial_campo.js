/**
 * TCONTROL · Credencial de campo (pestaña Carné)
 *
 * Muestra el carné para presentarlo ante clientes y un QR que cambia cada 30 s. El guardia lo
 * escanea y abre verificar.html, que consulta credencial_campo.gs. El código se calcula aquí sin
 * internet (Web Crypto), así funciona en sitios sin señal; solo el guardia necesita datos.
 *
 * El secreto llega una vez, al activar con la contraseña de la app, y se guarda en este teléfono (localStorage).
 * Con internet, cada apertura confirma con el servidor que la credencial siga vigente.
 *
 * Uso: window.CredencialCampo.montar(contenedor, { empleado: { id, nombre, cargo, area, foto_url, cedula } })
 */
(function () {
  'use strict';

  const URL_VERIFICAR = 'https://asistencia.tcontrolsa.com/verificar.html';
  const EMPRESA = {
    nombre: 'TCONTROL S.A.',
    direccion: 'Manuel Zambrano E1-270 y Av. Seis de Diciembre, Quito',
    telefono: '(593-2) 280 4107'
  };
  const TIPOS_SANGRE = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
  const clave = id => 'tcontrol_carne_' + id;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(msg, tipo = 'info') {
    if (typeof window.mostrarToast === 'function') return window.mostrarToast(msg, tipo);
    if (typeof window.showToast === 'function') return window.showToast(msg, tipo);
  }
  function leer(id) { try { return JSON.parse(localStorage.getItem(clave(id)) || 'null'); } catch (e) { return null; } }
  function guardar(id, d) { try { localStorage.setItem(clave(id), JSON.stringify(d)); } catch (e) { } }
  function borrar(id) { try { localStorage.removeItem(clave(id)); } catch (e) { } }
  function post(p) {
    if (!window.FirebaseBackend || typeof window.FirebaseBackend._post !== 'function') return Promise.resolve({ ok: false, error: 'Sin conexión con el servidor.' });
    return window.FirebaseBackend._post(p);
  }

  // Debe coincidir con codigoCred_() de backend/apps_script/credencial_campo.gs
  const enc = new TextEncoder();
  const llaves = {};
  async function codigo(secreto, cid, paso) {
    if (!llaves[secreto]) llaves[secreto] = await crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const b = new Uint8Array(await crypto.subtle.sign('HMAC', llaves[secreto], enc.encode('TC|' + cid + '|' + paso)));
    const num = (((b[0] & 0x7f) << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) % 100000000;
    return String(num).padStart(8, '0');
  }

  function enmascarar(c) {
    const s = String(c || '').replace(/\D/g, '');
    if (s.length < 6) return s;
    return s.slice(0, 2) + '•'.repeat(s.length - 5) + s.slice(-3, -1) + '-' + s.slice(-1);
  }
  function fechaCorta(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function qrSvg(texto) {
    if (typeof window.qrcode !== 'function') return '<span class="cc-qr-falta">QR no disponible. Abra la app con internet una vez.</span>';
    const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  // ---------------------------------------------------------------- montaje
  function montar(cont, opts) {
    const emp = (opts && opts.empleado) || {};
    const st = { emp, cont, cred: leer(emp.id), verCedula: false, timer: null, wake: null, aviso: '', editandoSangre: false, errorSangre: '', hoja: false };
    if (!emp.id) { cont.innerHTML = '<div class="cc-panel">No se pudo cargar tu información. Recarga la app.</div>'; return; }
    if (!window.crypto || !crypto.subtle) { cont.innerHTML = '<div class="cc-panel">Este navegador no permite generar el código de verificación. Actualiza el navegador o abre la app desde Chrome o Safari.</div>'; return; }
    render(st);
    if (st.cred && enTelefono()) pedirPantallaCompleta();
    if (st.cred && navigator.onLine) sincronizar(st);
  }

  const enTelefono = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function render(st) {
    detener(st);
    if (!st.cred) { salirPresentacion(st); return renderActivar(st); }
    // La capa va directo en <body>: dentro de .page (will-change: transform) un position:fixed
    // queda atrapado en la página y no cubre la barra inferior.
    if (!st.root || !st.root.isConnected) {
      document.querySelectorAll('.cc-presentacion').forEach(el => el.remove());
      st.root = document.createElement('div');
      st.root.className = 'cc-presentacion';
      document.body.appendChild(st.root);
    }
    document.body.classList.add('cc-presentando');
    st.cont.innerHTML = '';
    renderCarne(st);
    iniciar(st);
  }

  // ---------------------------------------------------------------- activación
  function renderActivar(st, error) {
    st.cont.innerHTML = `
      <div class="cc-panel cc-activar">
        <div class="cc-activar-ico"><i class="fas fa-id-badge"></i></div>
        <h3>Activa tu credencial de campo</h3>
        <p>Es el carné que presentas en garita o ante el supervisor del cliente. Tiene un QR que cambia cada 30 segundos; al escanearlo, el cliente confirma con Tcontrol que trabajas con nosotros y ve tu foto registrada.</p>
        <p class="cc-muted">Se activa una sola vez por teléfono. Después funciona sin internet.</p>
        <form class="cc-form" id="ccFormActivar" autocomplete="off">
          <label for="ccPin">Tu contraseña de la app</label>
          <input id="ccPin" type="password" autocomplete="current-password" required>
          ${error ? `<div class="cc-error" role="alert">${esc(error)}</div>` : ''}
          <button type="submit" class="cc-btn" id="ccBtnActivar"><i class="fas fa-unlock"></i> Activar credencial</button>
        </form>
      </div>`;
    const f = st.cont.querySelector('#ccFormActivar');
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const pin = f.querySelector('#ccPin').value.trim();
      const btn = f.querySelector('#ccBtnActivar');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando…';
      const r = await post({ accion: 'credencialCampoEmitir', empleadoId: String(st.emp.id), pin });
      if (!r || !r.ok) return renderActivar(st, (r && r.error) || 'No se pudo activar. Revisa tu conexión.');
      st.cred = { cid: r.cid, secreto: r.secreto, periodo: r.periodo || 30, emitida: r.emitida, sangre: r.sangre || '', url: r.urlVerificar || URL_VERIFICAR };
      guardar(st.emp.id, st.cred);
      toast('Credencial activada', 'success');
      if (enTelefono()) pedirPantallaCompleta();
      render(st);
    });
  }

  // ---------------------------------------------------------------- carné
  function renderCarne(st) {
    const e = st.emp, c = st.cred;
    const foto = e.foto_url && String(e.foto_url).trim()
      ? `<img class="cc-foto" src="${esc(e.foto_url)}" alt="Foto de ${esc(e.nombre)}">`
      : '<div class="cc-foto cc-foto-vacia"><i class="fas fa-user"></i></div>';
    const cedula = st.verCedula ? String(e.cedula || '') : enmascarar(e.cedula);
    const avisos = [
      st.aviso ? `<div class="cc-aviso" role="alert"><i class="fas fa-triangle-exclamation"></i> ${esc(st.aviso)}</div>` : '',
      !(e.foto_url && String(e.foto_url).trim()) ? '<div class="cc-aviso"><i class="fas fa-camera"></i> Tu credencial no tiene foto. Súbela desde la pestaña Credencial; sin foto el cliente no puede identificarte.</div>' : ''
    ].join('');
    const puedePantallaCompleta = document.fullscreenEnabled && !document.fullscreenElement;
    // Pantalla de presentación: la credencial cubre la app (barra inferior, campana) y lo demás va en la hoja "Más"
    st.root.innerHTML = `
      <div class="cc-pantalla">
      <div class="cc-acciones">
        <button type="button" class="cc-accion" id="ccSalir" aria-label="Salir de la credencial"><i class="fas fa-arrow-left"></i></button>
        <span class="cc-acciones-der">
          ${puedePantallaCompleta ? '<button type="button" class="cc-accion" id="ccCompleta" aria-label="Pantalla completa"><i class="fas fa-expand"></i></button>' : ''}
          <button type="button" class="cc-accion${avisos ? ' cc-accion-alerta' : ''}" id="ccMas" aria-label="Más opciones" aria-haspopup="dialog"><i class="fas fa-ellipsis"></i></button>
        </span>
      </div>
      <article class="cc-carne" aria-label="Credencial de campo">
        <div class="cc-brillo" aria-hidden="true"></div>
        <header class="cc-logo"><img src="./assets/images/Logotipo T Control.png" alt="TCONTROL · Tecnología en control industrial"></header>
        ${st.aviso ? `<div class="cc-aviso cc-aviso-sup" role="alert"><i class="fas fa-triangle-exclamation"></i> ${esc(st.aviso)}</div>` : ''}
        <div class="cc-cuerpo">
          <div class="cc-cargo">${esc(e.cargo || 'COLABORADOR')}</div>
          <div class="cc-id">
            ${foto}
            <div class="cc-quien">
              <div class="cc-nombre">${esc(String(e.nombre || '').toUpperCase())}</div>
              <div class="cc-area">${esc(e.area || '')}</div>
              <div class="cc-chips">
                <span class="cc-activo">ACTIVO</span>
                ${c.sangre ? `<span class="cc-sangre"><i class="fas fa-droplet"></i> ${esc(c.sangre)}</span>` : ''}
              </div>
            </div>
          </div>
          <dl class="cc-datos">
            <div><dt>Cédula</dt><dd><button type="button" class="cc-ced" id="ccCedula" aria-label="${st.verCedula ? 'Ocultar' : 'Mostrar'} cédula completa">${esc(cedula || '—')} <i class="fas fa-${st.verCedula ? 'eye-slash' : 'eye'}"></i></button></dd></div>
            <div><dt>ID de empleado</dt><dd>${esc(e.id)}</dd></div>
            <div><dt>Empresa</dt><dd>${esc(EMPRESA.nombre)}</dd></div>
            <div><dt>Emitida</dt><dd>${esc(fechaCorta(c.emitida))}</dd></div>
          </dl>
          <div class="cc-qrbox">
            <div class="cc-qr" id="ccQr" aria-label="Código QR de verificación"></div>
            <div class="cc-qrmeta">
              <span>Hora actual</span>
              <span class="cc-reloj" id="ccReloj">--:--:--</span>
              <span>Nuevo código en <b id="ccSeg">--</b> s</span>
              <div class="cc-barra"><i id="ccBarra"></i></div>
                          </div>
          </div>
          <div class="cc-vigencia">Válida mientras sea colaborador activo de ${esc(EMPRESA.nombre)}</div>
        </div>
        <footer class="cc-pie">${esc(EMPRESA.nombre)}<br>${esc(EMPRESA.direccion)}<br>Verificación telefónica: ${esc(EMPRESA.telefono)}</footer>
      </article>
      </div>

      <div class="cc-hoja-fondo" id="ccHojaFondo" ${st.hoja ? '' : 'hidden'}>
        <section class="cc-hoja" role="dialog" aria-modal="true" aria-labelledby="ccHojaTitulo">
          <div class="cc-hoja-cab">
            <h3 id="ccHojaTitulo">Más opciones</h3>
            <button type="button" class="cc-hoja-cerrar" id="ccHojaCerrar" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
          </div>
          ${avisos}
          <section class="cc-panel cc-sangre-panel" id="ccSangrePanel">${sangreHtml(st)}</section>
          <section class="cc-panel cc-ayuda">
            <h4>Cómo presentarla</h4>
            <ol>
              <li>Abre la pestaña Carné y muestra o entrega el teléfono al guardia.</li>
              <li>El guardia escanea el QR con la cámara de su teléfono y ve tu foto y tu estado en la página de Tcontrol.</li>
              <li>Si no puede escanear, puede llamar al ${esc(EMPRESA.telefono)} y dar tu ID de empleado ${esc(e.id)}.</li>
            </ol>
            <p class="cc-muted">Una captura de pantalla no sirve: el código vence a los 30 segundos.</p>
            <button type="button" class="cc-link" id="ccDesactivar">Quitar la credencial de este teléfono</button>
          </section>
        </section>
      </div>`;

    const $ = sel => st.root.querySelector(sel);
    $('#ccCedula').addEventListener('click', () => { st.verCedula = !st.verCedula; render(st); });
    $('#ccSalir').addEventListener('click', () => {
      salirPresentacion(st);
      if (typeof window.navigateTo === 'function') window.navigateTo('home');
    });
    const completa = $('#ccCompleta');
    if (completa) completa.addEventListener('click', () => pedirPantallaCompleta().then(() => render(st)));
    const abrirHoja = abierta => {
      st.hoja = abierta;
      $('#ccHojaFondo').hidden = !abierta;
      if (abierta) $('#ccHojaCerrar').focus(); else $('#ccMas').focus();
    };
    $('#ccMas').addEventListener('click', () => abrirHoja(true));
    $('#ccHojaCerrar').addEventListener('click', () => abrirHoja(false));
    $('#ccHojaFondo').addEventListener('click', ev => { if (ev.target.id === 'ccHojaFondo') abrirHoja(false); });
    $('#ccHojaFondo').addEventListener('keydown', ev => { if (ev.key === 'Escape') abrirHoja(false); });
    $('#ccDesactivar').addEventListener('click', () => {
      const b = $('#ccDesactivar');
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Toca otra vez para confirmar. Tendrás que activarla con tu contraseña.'; return; }
      borrar(st.emp.id); st.cred = null; st.hoja = false; render(st);
    });
    enlazarSangre(st);
  }

  // ---------------------------------------------------------------- modo presentación
  // La capa .cc-pantalla tapa la app; además se pide pantalla completa al teléfono para ocultar
  // la barra del navegador (cuando la app se abre desde un enlace y no instalada).
  function pedirPantallaCompleta() {
    const el = document.documentElement;
    if (!document.fullscreenEnabled || document.fullscreenElement || !el.requestFullscreen) return Promise.resolve();
    return el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { });
  }

  function salirPresentacion(st) {
    document.body.classList.remove('cc-presentando');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
    if (st) {
      detener(st);
      if (st.root) { st.root.remove(); st.root = null; }
    }
  }

  // ---------------------------------------------------------------- tipo de sangre (opcional)
  function sangreHtml(st) {
    const c = st.cred;
    if (!st.editandoSangre) {
      return `
        <h4>Tipo de sangre <span class="cc-opcional">opcional</span></h4>
        ${c.sangre
          ? `<p>Se muestra en tu carné como <b>${esc(c.sangre)}</b> para emergencias. No aparece en la página que ve el cliente.</p>
             <div class="cc-fila"><button type="button" class="cc-btn cc-btn-sec" id="ccSangreEditar">Cambiar</button>
             <button type="button" class="cc-btn cc-btn-sec" id="ccSangreQuitar">Quitar y retirar consentimiento</button></div>`
          : `<p>Puedes agregarlo para que se vea en tu carné en caso de emergencia. Es un dato de salud y solo se guarda si lo autorizas.</p>
             <button type="button" class="cc-btn cc-btn-sec" id="ccSangreEditar">Agregar tipo de sangre</button>`}`;
    }
    return `
      <h4>Tipo de sangre <span class="cc-opcional">opcional</span></h4>
      <form class="cc-form" id="ccFormSangre">
        ${st.errorSangre ? `<div class="cc-error" role="alert">${esc(st.errorSangre)}</div>` : ''}
        <label for="ccSangreTipo">Tipo</label>
        <select id="ccSangreTipo" required>
          <option value="">Selecciona…</option>
          ${TIPOS_SANGRE.map(t => `<option ${t === c.sangre ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label class="cc-check"><input type="checkbox" id="ccSangreConsent" required>
          <span>Autorizo a TCONTROL S.A. a guardar mi tipo de sangre y mostrarlo en mi credencial de campo para atención en emergencias. Puedo retirar esta autorización cuando quiera desde esta pantalla.</span></label>
        <div class="cc-fila">
          <button type="submit" class="cc-btn" id="ccSangreGuardar">Guardar</button>
          <button type="button" class="cc-btn cc-btn-sec" id="ccSangreCancelar">Cancelar</button>
        </div>
      </form>`;
  }

  function enlazarSangre(st) {
    const panel = st.root && st.root.querySelector('#ccSangrePanel');
    if (!panel) return;
    const repintar = () => { panel.innerHTML = sangreHtml(st); enlazarSangre(st); };
    const editar = panel.querySelector('#ccSangreEditar');
    if (editar) editar.addEventListener('click', () => { st.editandoSangre = true; repintar(); });
    const cancelar = panel.querySelector('#ccSangreCancelar');
    if (cancelar) cancelar.addEventListener('click', () => { st.editandoSangre = false; st.errorSangre = ''; repintar(); });
    const quitar = panel.querySelector('#ccSangreQuitar');
    if (quitar) quitar.addEventListener('click', () => enviarSangre(st, '', false));
    const f = panel.querySelector('#ccFormSangre');
    if (f) f.addEventListener('submit', ev => {
      ev.preventDefault();
      enviarSangre(st, f.querySelector('#ccSangreTipo').value, f.querySelector('#ccSangreConsent').checked);
    });
  }

  async function enviarSangre(st, tipo, consentimiento) {
    const fallar = msg => { st.errorSangre = msg; st.editandoSangre = true; render(st); };
    if (!navigator.onLine) return fallar('Necesitas internet para guardar este dato.');
    const t = await codigo(st.cred.secreto, st.cred.cid, pasoActual(st));
    const r = await post({ accion: 'credencialCampoSangre', cid: st.cred.cid, t, tipo, consentimiento });
    if (!r || !r.ok) return fallar((r && r.error) || 'No se pudo guardar. Revisa tu conexión.');
    st.cred.sangre = r.sangre || '';
    st.editandoSangre = false;
    st.errorSangre = '';
    guardar(st.emp.id, st.cred);
    toast(consentimiento ? 'Tipo de sangre guardado' : 'Tipo de sangre eliminado', 'success');
    render(st);
  }

  // ---------------------------------------------------------------- QR que cambia cada 30 s
  const pasoActual = st => Math.floor(Date.now() / 1000 / (st.cred.periodo || 30));

  function iniciar(st) {
    let ultimoPaso = -1;
    const periodo = st.cred.periodo || 30;
    const tick = async () => {
      // La pestaña se reemplazó (otra página de la app): quitar la capa
      if (!st.cont.isConnected || !st.root || !st.root.isConnected) return salirPresentacion(st);
      const ahora = new Date();
      const s = Math.floor(ahora.getTime() / 1000);
      const resta = periodo - (s % periodo);
      st.root.querySelector('#ccReloj').textContent = ahora.toLocaleTimeString('es-EC', { hour12: false });
      st.root.querySelector('#ccSeg').textContent = resta;
      st.root.querySelector('#ccBarra').style.transform = `scaleX(${resta / periodo})`;
      const paso = Math.floor(s / periodo);
      if (paso !== ultimoPaso) {
        ultimoPaso = paso;
        const t = await codigo(st.cred.secreto, st.cred.cid, paso);
        const qr = st.root && st.root.querySelector('#ccQr');
        if (qr) qr.innerHTML = qrSvg(`${st.cred.url || URL_VERIFICAR}?c=${st.cred.cid}&t=${t}`);
      }
    };
    tick();
    st.timer = setInterval(tick, 1000);
    pedirPantallaEncendida(st);
  }

  function detener(st) {
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (st.wake) { st.wake.release().catch(() => { }); st.wake = null; }
  }

  async function pedirPantallaEncendida(st) {
    try { if ('wakeLock' in navigator) st.wake = await navigator.wakeLock.request('screen'); } catch (e) { }
  }

  // ---------------------------------------------------------------- vigencia
  async function sincronizar(st) {
    try {
      const t = await codigo(st.cred.secreto, st.cred.cid, pasoActual(st));
      const r = await post({ accion: 'credencialCampoSync', cid: st.cred.cid, t });
      if (!r || !r.ok) return;
      if (r.estado === 'INACTIVO' || r.estado === 'NO_VALIDA') {
        borrar(st.emp.id); st.cred = null;
        salirPresentacion(st);
        return renderActivar(st, 'Tu credencial fue desactivada por RR. HH. Si es un error, vuelve a activarla con tu contraseña.');
      }
      if (r.estado === 'QR_VENCIDO') {
        st.aviso = 'La hora de tu teléfono no coincide con la del servidor y el QR no será aceptado. Activa "Fecha y hora automáticas" en los ajustes del teléfono.';
      } else {
        st.aviso = '';
        st.cred.sangre = r.sangre || '';
        if (r.emitida) st.cred.emitida = r.emitida;
        guardar(st.emp.id, st.cred);
      }
      if (st.root && st.root.isConnected && st.cont.isConnected && !st.editandoSangre) render(st);
    } catch (e) { /* sin red: se queda con lo guardado */ }
  }

  window.CredencialCampo = { montar, _codigo: codigo, _enmascarar: enmascarar };
})();
