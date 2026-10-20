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
    const st = { emp, cont, cred: leer(emp.id), verCedula: false, timer: null, wake: null, aviso: '', editandoSangre: false };
    if (!emp.id) { cont.innerHTML = '<div class="cc-panel">No se pudo cargar tu información. Recarga la app.</div>'; return; }
    if (!window.crypto || !crypto.subtle) { cont.innerHTML = '<div class="cc-panel">Este navegador no permite generar el código de verificación. Actualiza el navegador o abre la app desde Chrome o Safari.</div>'; return; }
    render(st);
    if (st.cred && navigator.onLine) sincronizar(st);
  }

  function render(st) {
    detener(st);
    if (!st.cred) return renderActivar(st);
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
    st.cont.innerHTML = `
      ${st.aviso ? `<div class="cc-aviso" role="alert"><i class="fas fa-triangle-exclamation"></i> ${esc(st.aviso)}</div>` : ''}
      ${!(e.foto_url && String(e.foto_url).trim()) ? '<div class="cc-aviso"><i class="fas fa-camera"></i> Tu credencial no tiene foto. Súbela desde la pestaña Credencial; sin foto el cliente no puede identificarte.</div>' : ''}
      <article class="cc-carne" aria-label="Credencial de campo">
        <div class="cc-brillo" aria-hidden="true"></div>
        <header class="cc-logo"><img src="./assets/images/Logotipo T Control.png" alt="TCONTROL · Tecnología en control industrial"></header>
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
            <div><dt>Código</dt><dd>${esc(e.id)}</dd></div>
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
              <span class="cc-dominio">Verifique solo en<br><b>asistencia.tcontrolsa.com</b></span>
            </div>
          </div>
          <div class="cc-vigencia">Válida mientras sea colaborador activo de ${esc(EMPRESA.nombre)}</div>
        </div>
        <footer class="cc-pie">${esc(EMPRESA.nombre)}<br>${esc(EMPRESA.direccion)}<br>Verificación telefónica: ${esc(EMPRESA.telefono)}</footer>
      </article>

      <section class="cc-panel cc-sangre-panel" id="ccSangrePanel">${sangreHtml(st)}</section>

      <section class="cc-panel cc-ayuda">
        <h4>Cómo presentarla</h4>
        <ol>
          <li>Abre esta pestaña y entrega el teléfono o muéstralo al guardia.</li>
          <li>El guardia escanea el QR con la cámara de su teléfono y ve tu foto y tu estado en la página de Tcontrol.</li>
          <li>Si no puede escanear, puede llamar al ${esc(EMPRESA.telefono)} y dar tu código ${esc(e.id)}.</li>
        </ol>
        <p class="cc-muted">Una captura de pantalla no sirve: el código vence a los 30 segundos.</p>
        <button type="button" class="cc-link" id="ccDesactivar">Quitar la credencial de este teléfono</button>
      </section>`;

    st.cont.querySelector('#ccCedula').addEventListener('click', () => { st.verCedula = !st.verCedula; render(st); });
    st.cont.querySelector('#ccDesactivar').addEventListener('click', () => {
      const b = st.cont.querySelector('#ccDesactivar');
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Toca otra vez para confirmar. Tendrás que activarla con tu contraseña.'; return; }
      borrar(st.emp.id); st.cred = null; render(st);
    });
    enlazarSangre(st);
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
    const panel = st.cont.querySelector('#ccSangrePanel');
    if (!panel) return;
    const repintar = () => { panel.innerHTML = sangreHtml(st); enlazarSangre(st); };
    const editar = panel.querySelector('#ccSangreEditar');
    if (editar) editar.addEventListener('click', () => { st.editandoSangre = true; repintar(); });
    const cancelar = panel.querySelector('#ccSangreCancelar');
    if (cancelar) cancelar.addEventListener('click', () => { st.editandoSangre = false; repintar(); });
    const quitar = panel.querySelector('#ccSangreQuitar');
    if (quitar) quitar.addEventListener('click', () => enviarSangre(st, '', false));
    const f = panel.querySelector('#ccFormSangre');
    if (f) f.addEventListener('submit', ev => {
      ev.preventDefault();
      enviarSangre(st, f.querySelector('#ccSangreTipo').value, f.querySelector('#ccSangreConsent').checked);
    });
  }

  async function enviarSangre(st, tipo, consentimiento) {
    if (!navigator.onLine) return toast('Necesitas internet para guardar este dato.', 'warning');
    const t = await codigo(st.cred.secreto, st.cred.cid, pasoActual(st));
    const r = await post({ accion: 'credencialCampoSangre', cid: st.cred.cid, t, tipo, consentimiento });
    if (!r || !r.ok) return toast((r && r.error) || 'No se pudo guardar.', 'error');
    st.cred.sangre = r.sangre || '';
    st.editandoSangre = false;
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
      const raiz = st.cont.querySelector('.cc-carne');
      if (!raiz || !raiz.isConnected) return detener(st); // el usuario cambió de pestaña
      const ahora = new Date();
      const s = Math.floor(ahora.getTime() / 1000);
      const resta = periodo - (s % periodo);
      st.cont.querySelector('#ccReloj').textContent = ahora.toLocaleTimeString('es-EC', { hour12: false });
      st.cont.querySelector('#ccSeg').textContent = resta;
      st.cont.querySelector('#ccBarra').style.transform = `scaleX(${resta / periodo})`;
      const paso = Math.floor(s / periodo);
      if (paso !== ultimoPaso) {
        ultimoPaso = paso;
        const t = await codigo(st.cred.secreto, st.cred.cid, paso);
        const qr = st.cont.querySelector('#ccQr');
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
      if (st.cont.querySelector('.cc-carne') && !st.editandoSangre) render(st);
    } catch (e) { /* sin red: se queda con lo guardado */ }
  }

  window.CredencialCampo = { montar, _codigo: codigo, _enmascarar: enmascarar };
})();
