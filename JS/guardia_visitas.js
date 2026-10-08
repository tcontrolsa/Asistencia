/**
 * TCONTROL · Registro de visitas · portería (pestaña "Visitas" de guardia.html)
 *
 * El guardia activa la portería de visitas con su clave (Apps Script tokenGuardia → JWT de 12 h,
 * claim guardia; la clave vive en Propiedades del script, no en este código). Luego:
 *   - Lee el QR del visitante con la cámara (BarcodeDetector o jsQR) o escribe el código de 8 caracteres.
 *   - Ve la ficha: nombre, empresa, motivo, anfitrión, almuerzo (sin datos de contacto).
 *   - Verifica el documento a la vista (no se guarda) y registra la entrada; a la salida, la salida.
 * Datos: PostgREST api.visita_guardia (respaldo: Apps Script evalRpc).
 */
(function () {
  'use strict';
  const KEY = 'tcontrol_sesion_porteria';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');
  const horaDe = ts => ts ? new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
  const st = { ses: null, lista: [], ficha: null, error: '', escaneando: false, stream: null, cargando: false,
    cargandoLista: false, listaTs: 0, buscando: '', registrando: '', abriendoCamara: false,
    // Visitante sin cita: modo 'qr' (se registra desde su celular) o 'form' (lo registra el guardia)
    sc: null, tipos: [], eppTexto: '' };
  const tipoDe = id => st.tipos.find(t => t.id === id) || null;
  const SPIN = '<span class="spin-sm" aria-hidden="true"></span>';
  const LENTO = '<p class="cargando-nota lento-6s" style="margin-top:10px">La conexión con la base está lenta, sigue trabajando…</p>';
  let cont = null;

  function sesion() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.exp * 1000 - Date.now() > 60000) return s; } catch (e) { }
    return null;
  }
  async function base(refrescar) {
    if (window.FirebaseBackend && typeof window.FirebaseBackend._urlHistorico === 'function') return window.FirebaseBackend._urlHistorico(refrescar);
    return '';
  }
  async function post(datos) {
    if (window.FirebaseBackend && typeof window.FirebaseBackend._post === 'function') return window.FirebaseBackend._post(datos);
    throw new Error('Servicio no disponible');
  }
  async function rpc(p) {
    let causa = '';
    for (let i = 0; i < 2; i++) {
      const b = await base(i > 0);
      if (!b) { causa = 'sin dirección'; continue; }
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
      try {
        const r = await fetch(`${b}/rpc/visita_guardia`, { method: 'POST', headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p }), signal: ctrl.signal });
        if (r.status === 401) { salir(); throw Object.assign(new Error('La sesión de portería venció. Ingresa la clave de nuevo.'), { sesion: true }); }
        if (r.ok) return await r.json();
        causa = 'HTTP ' + r.status;
      } catch (e) { if (e.sesion) throw e; causa = e.message; } finally { clearTimeout(t); }
    }
    const r = await post({ accion: 'evalRpc', token: st.ses.token, fn: 'visita_guardia', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con la base de visitas (' + causa + ')');
    if (r.status === 401) { salir(); throw new Error('La sesión de portería venció. Ingresa la clave de nuevo.'); }
    return r.body;
  }
  function salir() { try { localStorage.removeItem(KEY); } catch (e) { } st.ses = null; detenerCamara(); }

  // ---------------------------------------------------------------- vistas
  function pintar() {
    if (!cont) return;
    if (!st.ses) {
      cont.innerHTML = `<div class="card vs-root">
        <div class="mb-3 text-center"><i class="fas fa-id-card-alt fa-2x" style="color:#dc2626"></i><h2 class="h5 mt-2 mb-1">Portería de visitas</h2>
        <p class="text-muted small">Ingresa la clave de portería de visitas (es distinta de la clave de la terminal).</p></div>
        ${st.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
        <form id="gvLogin"><input type="password" class="form-control vs-input" id="gvClave" placeholder="Clave de portería" autocomplete="off" style="text-align:center;font-size:20px;letter-spacing:3px">
        <button class="btn-large btn-primary" type="submit" style="margin-top:14px" ${st.cargando ? 'disabled' : ''}>${st.cargando ? SPIN + ' Verificando clave…' : '<i class="fas fa-unlock-alt"></i> Activar portería de visitas'}</button>
        ${st.cargando ? LENTO : ''}</form></div>`;
      return;
    }
    const esperadas = st.lista.filter(v => v.estado === 'aprobada');
    const dentro = st.lista.filter(v => v.estado === 'en_curso');
    const otras = st.lista.filter(v => !['aprobada', 'en_curso'].includes(v.estado));
    const fila = v => `<button type="button" class="vs-item" data-ver="${esc(v.codigo)}" style="width:100%;text-align:left;cursor:pointer">
        <div class="vs-item-cab"><div><strong>${esc(v.nombre || '(sin nombre)')}</strong>${v.origen === 'porteria' ? ' <span class="gv-sincita">Sin cita</span>' : ''}<div class="vs-muted vs-small">${esc(v.empresa || '')} · visita a ${esc(v.anfitrion)}${v.tipoNombre ? ' · ' + esc(v.tipoNombre) : ''}${v.epp ? ' · <span class="gv-epp-mini"><i class="fas fa-hard-hat"></i> EPP</span>' : ''}</div></div>
        <span class="vs-estado vs-e-${esc(v.estado)}">${v.estado === 'en_curso' ? 'Dentro · ' + horaDe(v.entradaEn) : v.estado === 'aprobada' ? (v.hora || 'Hoy') : esc(v.estado)}</span></div></button>`;
    // Si la cámara está activa, se conserva el mismo video al redibujar (no se corta el escaneo)
    const scanVivo = st.escaneando && (st.stream || st.abriendoCamara === 'pidiendo') ? cont.querySelector('.gv-scan') : null;
    cont.innerHTML = `<div class="vs-root">
      <div class="card">
        ${st.escaneando
          ? `<div class="gv-scan"><video id="gvVideo" playsinline muted></video><div class="gv-marco"></div>
               ${st.abriendoCamara ? `<div class="gv-scan-cargando">${SPIN} Abriendo cámara…</div>` : ''}</div>
             <button class="btn-large btn-secondary" data-gv="detener"><i class="fas fa-stop"></i> Detener cámara</button>`
          : `<button class="btn-large btn-primary" data-gv="escanear"><i class="fas fa-qrcode"></i> Escanear QR del visitante</button>
             <p class="ayuda-campo" style="margin-top:10px"><i class="fas fa-info-circle"></i> Pida al visitante su QR (en el celular o impreso). Si no lo tiene, escriba su código de 8 caracteres.</p>`}
        <form id="gvCodigoForm" class="gv-codigo" style="margin-top:12px">
          <input class="vs-input" id="gvCodigo" maxlength="9" placeholder="Código: ABCD-EFGH" autocomplete="off" autocapitalize="characters" ${st.buscando ? 'disabled' : ''}>
          <button class="vs-btn vs-btn-prim" type="submit" ${st.buscando ? 'disabled' : ''} aria-label="Buscar">${st.buscando ? SPIN : '<i class="fas fa-search"></i>'}</button></form>
        ${st.error ? `<div class="vs-error" style="margin-top:12px"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
      </div>
      ${st.buscando ? `<div class="card gv-ficha"><p class="cargando-nota" style="margin:0 0 12px">${SPIN} Buscando la visita ${esc(codigoBonito(st.buscando))}…</p>
          <div class="sk sk-linea" style="width:45%;height:18px"></div><div class="sk sk-linea" style="width:70%;margin-top:12px"></div>
          <div class="sk sk-linea" style="width:55%;margin-top:8px"></div><div class="sk sk-bloque" style="margin-top:14px"></div>${LENTO}</div>`
        : st.ficha ? fichaHtml(st.ficha) : ''}
      ${sinCitaHtml()}
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 class="h6 m-0"><i class="fas fa-calendar-day"></i> Visitas de hoy</h3>
          <button class="vs-btn vs-btn-sm" data-gv="recargar" ${st.cargandoLista ? 'disabled' : ''} aria-label="Actualizar"><i class="fas fa-sync-alt ${st.cargandoLista ? 'fa-spin' : ''}"></i></button></div>
        <p class="vs-muted vs-small" style="margin:6px 0 10px">${st.cargandoLista
          ? `${SPIN} ${st.listaTs ? 'Actualizando…' : 'Cargando visitas de hoy…'}`
          : st.listaTs ? `${dentro.length} dentro · ${esperadas.length} por llegar · actualizado ${horaDe(st.listaTs)}` : ''}</p>
        ${!st.listaTs && st.cargandoLista
          ? '<div class="sk sk-bloque"></div><div class="sk sk-bloque"></div><div class="sk sk-bloque"></div>' + LENTO
          : dentro.map(fila).join('') + esperadas.map(fila).join('') + otras.map(fila).join('')}
        ${st.listaTs && !st.lista.length ? '<p class="vs-muted">No hay visitas programadas para hoy.</p>' : ''}
        <button class="btn-large btn-secondary" data-gv="salir" style="margin-top:8px"><i class="fas fa-sign-out-alt"></i> Cerrar portería de visitas</button>
      </div></div>`;
    if (scanVivo) { const nuevo = cont.querySelector('.gv-scan'); if (nuevo) nuevo.replaceWith(scanVivo); }
    if (st.escaneando) iniciarCamara();
    if (st.sc && st.sc.modo === 'qr') relojQr();
  }

  // ---------------------------------------------------------------- visitante sin cita
  const urlRegistroPorteria = token => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}visitas.html?porteria=${token}`;
  function qrGrande(texto) {
    if (typeof window.qrcode !== 'function') return `<div class="vs-muted">No se pudo generar el QR. Abra en el celular del visitante: ${esc(texto)}</div>`;
    const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  function sinCitaHtml() {
    const sc = st.sc;
    if (!sc) {
      return `<div class="card gv-sincita-card">
        <h3 class="h6 m-0"><i class="fas fa-user-plus"></i> ¿Llegó alguien sin cita?</h3>
        <p class="ayuda-campo" style="margin:6px 0 12px"><i class="fas fa-info-circle"></i> Regístrelo antes de dejarlo pasar. El anfitrión recibirá el aviso.</p>
        <div class="gv-sincita-opciones">
          <button type="button" class="vs-btn" data-gv="sc-qr"><i class="fas fa-qrcode"></i><span><strong>Mostrar QR</strong><small>Se registra en su celular</small></span></button>
          <button type="button" class="vs-btn" data-gv="sc-form"><i class="fas fa-keyboard"></i><span><strong>Registrarlo yo</strong><small>No tiene celular</small></span></button>
        </div></div>`;
    }
    if (sc.modo === 'qr') {
      const vencido = sc.expira && Date.now() > sc.expira;
      return `<div class="card gv-sincita-card" style="text-align:center">
        <h3 class="h6 m-0"><i class="fas fa-qrcode"></i> QR de registro para visitantes sin cita</h3>
        ${sc.cargando ? `<div class="gv-qr-grande"><div class="sk" style="width:100%;height:100%"></div></div><p class="cargando-nota">${SPIN} Generando QR…</p>${LENTO}`
          : sc.error ? `<div class="vs-error" style="margin-top:12px"><i class="fas fa-exclamation-circle"></i> ${esc(sc.error)}</div>`
          : `<div class="gv-qr-grande ${vencido ? 'gv-qr-vencido' : ''}">${qrGrande(urlRegistroPorteria(sc.token))}</div>
             <p class="gv-reloj" id="gvReloj">${vencido ? 'Vencido' : ''}</p>
             <ol class="gv-pasos-sc"><li>Pida al visitante que lo escanee con la cámara de su celular.</li>
               <li>Él completa sus datos y acepta los términos en su teléfono.</li>
               <li>Le aparecerá su propio QR: escanéelo aquí, verifique su cédula y registre la entrada.</li></ol>`}
        <div class="vs-acciones" style="margin-top:10px">
          <button type="button" class="vs-btn" data-gv="sc-nuevo"><i class="fas fa-sync-alt"></i> Nuevo QR</button>
          <button type="button" class="vs-btn vs-btn-prim" data-gv="sc-escanear"><i class="fas fa-camera"></i> Ya se registró: escanear</button>
        </div>
        <button type="button" class="btn-large btn-secondary" data-gv="sc-cerrar" style="margin-top:10px"><i class="fas fa-times"></i> Cerrar</button></div>`;
    }
    const f = sc.f;
    return `<form class="card gv-sincita-card" id="gvSinCitaForm" autocomplete="off" novalidate>
      <h3 class="h6 m-0"><i class="fas fa-keyboard"></i> Registrar visitante sin cita</h3>
      <p class="ayuda-campo" style="margin:6px 0 12px"><i class="fas fa-info-circle"></i> Para quien no tiene celular. Al guardar, queda registrada su entrada.</p>
      ${sc.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(sc.error)}</div>` : ''}
      <div class="vs-campo"><span>La visita es para</span>
        <div class="gv-tipos">${st.tipos.map(t => `<button type="button" class="gv-tipo ${f.tipo === t.id ? 'gv-tipo-on' : ''}" data-gv="sc-tipo" data-id="${esc(t.id)}">${esc(t.nombre)}${t.epp ? ' <i class="fas fa-hard-hat"></i>' : ''}</button>`).join('')
          || '<span class="vs-muted vs-small">Actualice la lista de visitas para cargar los tipos.</span>'}</div></div>
      ${tipoDe(f.tipo) && tipoDe(f.tipo).epp ? `<div class="vs-epp"><i class="fas fa-hard-hat"></i><span><strong>EPP obligatorio.</strong> ${esc(st.eppTexto)}</span></div>` : ''}
      <label class="vs-campo"><span>¿A quién visita?${tipoDe(f.tipo) && tipoDe(f.tipo).anfitrionOpcional ? ' <small>(opcional: lo atiende el área encargada)</small>' : ''}</span>
        ${f.anfitrion ? `<div class="vs-elegido"><i class="fas fa-user-check"></i><strong>${esc(f.anfitrion.nombre)}</strong><span class="vs-small">${esc(f.anfitrion.area)}</span><button type="button" class="vs-link" data-gv="sc-cambiar">Cambiar</button></div>`
          : `<input id="gvScBuscar" data-sc="buscar" placeholder="Escriba al menos 3 letras" value="${esc(f.buscar || '')}">`}</label>
      ${f.anfitrion ? '' : '<div id="gvScSug"></div>'}
      <label class="vs-campo"><span>Nombre y apellido</span><input data-sc="nombre" maxlength="80" value="${esc(f.nombre || '')}"></label>
      <label class="vs-campo"><span>Empresa o institución</span><input data-sc="empresa" maxlength="80" placeholder='O "Particular"' value="${esc(f.empresa || '')}"></label>
      <label class="vs-campo"><span>Motivo</span><input data-sc="motivo" maxlength="200" placeholder="Ej.: entrega, consulta, reunión" value="${esc(f.motivo || '')}"></label>
      <label class="vs-check"><input type="checkbox" data-sc="doc" ${f.doc ? 'checked' : ''}><span><strong>Verifiqué su documento de identidad</strong> (no se registra el número).</span></label>
      ${tipoDe(f.tipo) && tipoDe(f.tipo).epp ? `<label class="vs-check"><input type="checkbox" data-sc="epp" ${f.epp ? 'checked' : ''}><span><strong>Lleva el EPP obligatorio</strong> para planta.</span></label>` : ''}
      <label class="vs-check"><input type="checkbox" data-sc="acepta" ${f.acepta ? 'checked' : ''}><span><strong>Le informé y aceptó:</strong> sus datos (nombre, empresa y motivo) se usan solo para gestionar esta visita y la seguridad, los ve su anfitrión y la administración, y se anonimizan a los 6 meses. Puede ejercer sus derechos en informacion@tcontrolsa.com.</span></label>
      <button type="submit" class="btn-large btn-success" ${sc.enviando ? 'disabled' : ''}>${sc.enviando ? SPIN + ' Registrando…' : '<i class="fas fa-sign-in-alt"></i> Registrar e ingresar'}</button>
      ${sc.enviando ? LENTO : ''}
      <button type="button" class="btn-large btn-secondary" data-gv="sc-cerrar" ${sc.enviando ? 'disabled' : ''}><i class="fas fa-times"></i> Cancelar</button></form>`;
  }

  let tReloj = null;
  function relojQr() {
    clearInterval(tReloj);
    const tic = () => {
      const el = document.getElementById('gvReloj');
      if (!el || !st.sc || st.sc.modo !== 'qr' || !st.sc.expira) { clearInterval(tReloj); return; }
      const ms = st.sc.expira - Date.now();
      if (ms <= 0) { clearInterval(tReloj); pintar(); return; }
      el.textContent = `Vence en ${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    };
    tic(); tReloj = setInterval(tic, 1000);
  }
  const verTarjetaSinCita = () => { const c = cont && cont.querySelector('.gv-sincita-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  async function nuevoQrPorteria() {
    st.sc = { modo: 'qr', cargando: true }; pintar(); verTarjetaSinCita();
    try {
      const r = await rpc({ accion: 'pase_porteria' });
      if (!r.ok) throw new Error(r.error);
      st.sc = { modo: 'qr', token: r.token, expira: new Date(r.expira).getTime() };
    } catch (e) { st.sc = { modo: 'qr', error: e.message }; }
    pintar(); verTarjetaSinCita();
  }

  let tScBuscar = null, nScBuscar = 0;
  function buscarAnfitrionGuardia(q) {
    clearTimeout(tScBuscar);
    const caja = document.getElementById('gvScSug');
    if (!caja) return;
    if (q.trim().length < 3) { caja.innerHTML = ''; return; }
    const id = ++nScBuscar;
    caja.innerHTML = `<p class="cargando-nota" style="margin:-6px 0 12px">${SPIN} Buscando…</p>`;
    tScBuscar = setTimeout(async () => {
      try {
        const r = await rpc({ accion: 'anfitriones', q: q.trim() });
        if (id !== nScBuscar || !document.getElementById('gvScSug')) return;
        const lista = (r.ok && r.anfitriones) || [];
        document.getElementById('gvScSug').innerHTML = lista.length
          ? `<div class="vs-sug">${lista.map(a => `<button type="button" data-gv="sc-anf" data-id="${esc(a.id)}" data-nom="${esc(a.nombre)}" data-area="${esc(a.area)}"><strong>${esc(a.nombre)}</strong><span>${esc(a.area)}</span></button>`).join('')}</div>`
          : '<p class="vs-muted vs-small" style="margin:-6px 0 12px">Sin resultados. Revise el nombre.</p>';
      } catch (e) {
        if (id === nScBuscar && document.getElementById('gvScSug')) document.getElementById('gvScSug').innerHTML = `<p class="vs-error">${esc(e.message)}</p>`;
      }
    }, 350);
  }
  async function registrarSinCita() {
    const sc = st.sc, f = sc.f, t = tipoDe(f.tipo);
    if (!t) { sc.error = 'Elija para qué es la visita.'; return pintar(); }
    if (!f.anfitrion && !t.anfitrionOpcional) { sc.error = 'Elija de la lista a la persona que visita.'; return pintar(); }
    if (!f.doc) { sc.error = 'Confirme que verificó el documento de identidad.'; return pintar(); }
    if (t.epp && !f.epp) { sc.error = 'Esta visita es a planta: confirme que lleva el EPP.'; return pintar(); }
    if (!f.acepta) { sc.error = 'Informe al visitante sobre el uso de sus datos y confirme que aceptó.'; return pintar(); }
    sc.enviando = true; sc.error = ''; pintar();
    try {
      const r = await rpc({ accion: 'registrar', tipo: t.id, anfitrionId: f.anfitrion ? f.anfitrion.id : '', nombre: f.nombre, empresa: f.empresa, motivo: f.motivo,
        documentoVerificado: true, aceptaVerbal: true, eppVerificado: !!f.epp });
      if (!r.ok) throw new Error(r.error);
      st.sc = null;
      if (typeof window.mostrarToast === 'function') window.mostrarToast(`Entrada registrada: ${r.visita.nombre}`, 'success');
      cargar();
    } catch (e) { sc.enviando = false; sc.error = e.message; pintar(); }
  }

  function fichaHtml(f) {
    const v = f.visita;
    const hoy = f.hoy;
    let aviso = '', accion = '';
    if (v.estado === 'aprobada' && v.fecha === hoy) {
      accion = `<label class="vs-check" style="margin-top:12px"><input type="checkbox" id="gvDoc"><span><strong>Verifiqué su documento de identidad</strong> y coincide con el nombre (no se registra el número).</span></label>
        ${v.epp ? `<label class="vs-check"><input type="checkbox" id="gvEpp"><span><strong>Lleva el EPP obligatorio</strong> para planta.</span></label>` : ''}
        <button class="btn-large btn-success" data-gv="entrada" data-cod="${esc(v.codigo)}" ${st.registrando ? 'disabled' : ''}>${st.registrando === 'entrada' ? SPIN + ' Registrando entrada…' : '<i class="fas fa-sign-in-alt"></i> Registrar entrada'}</button>`;
    } else if (v.estado === 'en_curso') {
      accion = `<button class="btn-large btn-primary" data-gv="salida" data-cod="${esc(v.codigo)}" ${st.registrando ? 'disabled' : ''}>${st.registrando === 'salida' ? SPIN + ' Registrando salida…' : '<i class="fas fa-sign-out-alt"></i> Registrar salida'}</button>`;
    } else if (v.estado === 'aprobada') {
      aviso = `La visita está programada para el ${esc(v.fecha.split('-').reverse().join('/'))}. No puede ingresar hoy.`;
    } else if (v.estado === 'pendiente') {
      aviso = 'El anfitrión aún no aprueba esta visita. Comunícate con él antes de permitir el ingreso.';
    } else if (v.estado === 'invitada') {
      aviso = 'El visitante no completó su registro ni aceptó los términos. Pídele que lo haga desde su enlace.';
    } else {
      aviso = `Visita ${esc(v.estado.replace('_', ' '))}: no está habilitada para ingresar.`;
    }
    return `<div class="card gv-ficha ${accion ? 'gv-ficha-ok' : 'gv-ficha-alerta'}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="vs-codigo" style="font-size:18px">${esc(codigoBonito(v.codigo))}</span>
        <span class="vs-estado vs-e-${esc(v.estado)}">${esc(v.estado.replace('_', ' '))}</span></div>
      <div class="gv-nombre">${esc(v.nombre || '(sin nombre)')}${v.origen === 'porteria' ? ' <span class="gv-sincita">Sin cita</span>' : ''}</div>
      <div class="vs-muted">${esc(v.empresa || '')}</div>
      <dl class="vs-datos">
        <dt>Visita a</dt><dd>${esc(v.anfitrion)}</dd>
        ${v.tipoNombre ? `<dt>Tipo</dt><dd>${esc(v.tipoNombre)}</dd>` : ''}
        <dt>Motivo</dt><dd>${esc(v.motivo || '—')}</dd>
        <dt>Fecha</dt><dd>${esc(v.fecha.split('-').reverse().join('/'))}${v.hora ? ' · ' + esc(v.hora) : ''}</dd>
        ${v.almuerzo ? '<dt>Almuerzo</dt><dd><i class="fas fa-utensils"></i> Incluido</dd>' : ''}
        ${v.entradaEn ? `<dt>Entrada</dt><dd>${horaDe(v.entradaEn)}</dd>` : ''}${v.salidaEn ? `<dt>Salida</dt><dd>${horaDe(v.salidaEn)}</dd>` : ''}
      </dl>
      ${v.epp && ['aprobada', 'en_curso'].includes(v.estado) ? `<div class="vs-epp" style="margin:12px 0 0"><i class="fas fa-hard-hat"></i><span><strong>Visita a planta: EPP obligatorio.</strong> ${esc(st.eppTexto)}</span></div>` : ''}
      ${aviso ? `<div class="vs-error" style="margin-top:12px"><i class="fas fa-exclamation-triangle"></i> ${aviso}</div>` : ''}
      ${accion}${st.registrando ? LENTO : ''}
      <button class="btn-large btn-secondary" data-gv="cerrar-ficha" ${st.registrando ? 'disabled' : ''}><i class="fas fa-times"></i> Cerrar</button></div>`;
  }

  // ---------------------------------------------------------------- cámara y QR
  let detector = null, bucle = null;
  async function iniciarCamara() {
    const video = document.getElementById('gvVideo');
    if (!video || st.stream || st.abriendoCamara === 'pidiendo') return;
    st.abriendoCamara = 'pidiendo';
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = st.stream;
      await video.play();
      st.abriendoCamara = false;
      const aviso = video.parentNode && video.parentNode.querySelector('.gv-scan-cargando'); if (aviso) aviso.remove();
      if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
      const lienzo = document.createElement('canvas');
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      const leer = async () => {
        if (!st.escaneando || !video.videoWidth) { bucle = requestAnimationFrame(leer); return; }
        let texto = '';
        try {
          if (detector) {
            const r = await detector.detect(video);
            if (r && r[0]) texto = r[0].rawValue;
          } else if (typeof window.jsQR === 'function') {
            lienzo.width = video.videoWidth; lienzo.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r) texto = r.data;
          }
        } catch (e) { }
        if (texto && /^TCV1:[A-Z0-9]{8}$/i.test(texto.trim())) {
          if (navigator.vibrate) navigator.vibrate(120);
          detenerCamara();
          buscar(texto.trim());
          return;
        }
        bucle = setTimeout(() => requestAnimationFrame(leer), 180);
      };
      leer();
    } catch (e) {
      st.escaneando = false; st.abriendoCamara = false;
      st.error = 'No se pudo usar la cámara (' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message) + '). Escribe el código del visitante.';
      detenerCamara(); pintar();
    }
  }
  function detenerCamara() {
    st.escaneando = false; st.abriendoCamara = false;
    clearTimeout(bucle);
    if (st.stream) { st.stream.getTracks().forEach(t => t.stop()); st.stream = null; }
  }

  // ---------------------------------------------------------------- acciones
  let cargaLista = null;
  function cargar() {
    if (cargaLista) return cargaLista;            // ya hay una carga en curso
    st.cargandoLista = true; pintar();
    cargaLista = (async () => {
      try {
        const r = await rpc({ accion: 'hoy' });
        if (!r.ok) throw new Error(r.error);
        st.lista = r.visitas || []; st.listaTs = Date.now(); st.error = '';
        if (Array.isArray(r.tipos)) st.tipos = r.tipos;
        if (r.eppTexto) st.eppTexto = r.eppTexto;
      } catch (e) { st.error = e.message; }
      st.cargandoLista = false; cargaLista = null;
      pintar();
    })();
    return cargaLista;
  }
  async function buscar(codigo) {
    if (st.buscando) return;
    st.error = ''; st.ficha = null; st.buscando = codigo.replace(/^TCV1:/i, ''); pintar();
    const f0 = cont.querySelector('.gv-ficha'); if (f0) f0.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const r = await rpc({ accion: 'buscar', codigo });
      if (!r.ok) throw new Error(r.error);
      st.ficha = { visita: r.visita, hoy: r.hoy };
    } catch (e) { st.error = e.message; }
    st.buscando = '';
    pintar();
    const f = cont.querySelector('.gv-ficha'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function registrar(accion, codigo, boton) {
    const p = { accion, codigo };
    if (accion === 'entrada') {
      const doc = document.getElementById('gvDoc');
      if (!doc || !doc.checked) { st.error = 'Confirma que verificaste el documento de identidad.'; return pintar(); }
      p.documentoVerificado = true;
      const epp = document.getElementById('gvEpp');
      if (epp && !epp.checked) { st.error = 'Esta visita es a planta: confirma que el visitante lleva el EPP.'; return pintar(); }
      if (epp) p.eppVerificado = true;
    }
    if (st.registrando) return;
    st.registrando = accion; pintar();
    try {
      const r = await rpc(p);
      if (!r.ok) throw new Error(r.error);
      st.ficha = null; st.error = ''; st.registrando = '';
      if (typeof window.mostrarToast === 'function') window.mostrarToast(accion === 'entrada' ? `Entrada registrada: ${r.visita.nombre}` : `Salida registrada: ${r.visita.nombre}`, 'success');
      cargar();
    } catch (e) { st.error = e.message; st.registrando = ''; pintar(); }
  }

  function montar(el) {
    cont = el;
    st.ses = sesion();
    if (!cont._gv) {
      cont._gv = true;
      cont.addEventListener('submit', async e => {
        e.preventDefault();
        if (e.target.id === 'gvLogin') {
          const clave = document.getElementById('gvClave').value.trim();
          if (!clave) return;
          st.cargando = true; st.error = ''; pintar();
          try {
            const r = await post({ accion: 'tokenGuardia', clave, puesto: 'PORTERIA' });
            if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo activar la portería.');
            st.ses = { token: r.token, exp: r.exp, puesto: r.puesto };
            try { localStorage.setItem(KEY, JSON.stringify(st.ses)); } catch (x) { }
            st.cargando = false; await cargar();
          } catch (x) { st.cargando = false; st.error = x.message; pintar(); }
        }
        if (e.target.id === 'gvSinCitaForm') return registrarSinCita();
        if (e.target.id === 'gvCodigoForm') {
          const c = document.getElementById('gvCodigo').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (c.length !== 8) { st.error = 'El código tiene 8 caracteres.'; return pintar(); }
          buscar(c);
        }
      });
      cont.addEventListener('click', e => {
        const b = e.target.closest('[data-gv],[data-ver]');
        if (!b) return;
        if (b.dataset.ver) return buscar(b.dataset.ver);
        const a = b.dataset.gv;
        if (a === 'sc-qr' || a === 'sc-nuevo') return nuevoQrPorteria();
        if (a === 'sc-form') { st.sc = { modo: 'form', f: {} }; pintar(); verTarjetaSinCita(); const i = document.getElementById('gvScBuscar'); if (i) i.focus({ preventScroll: true }); return; }
        if (a === 'sc-cerrar') { clearInterval(tReloj); st.sc = null; return pintar(); }
        if (a === 'sc-escanear') { clearInterval(tReloj); st.sc = null; st.escaneando = true; st.abriendoCamara = true; st.error = ''; pintar(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        if (a === 'sc-anf') { st.sc.f.anfitrion = { id: b.dataset.id, nombre: b.dataset.nom, area: b.dataset.area }; st.sc.error = ''; return pintar(); }
        if (a === 'sc-cambiar') { st.sc.f.anfitrion = null; st.sc.f.buscar = ''; return pintar(); }
        if (a === 'sc-tipo') { st.sc.f.tipo = b.dataset.id; st.sc.error = ''; return pintar(); }
        if (a === 'escanear') { st.escaneando = true; st.abriendoCamara = true; st.error = ''; pintar(); }
        else if (a === 'detener') { detenerCamara(); pintar(); }
        else if (a === 'recargar') cargar();
        else if (a === 'cerrar-ficha') { st.ficha = null; pintar(); }
        else if (a === 'entrada' || a === 'salida') registrar(a, b.dataset.cod, b);
        else if (a === 'salir') { salir(); st.lista = []; st.listaTs = 0; st.ficha = null; st.sc = null; pintar(); }
      });
      // Los campos del formulario sin cita se guardan al escribir (un redibujo no los borra)
      cont.addEventListener('input', e => {
        const k = e.target.dataset && e.target.dataset.sc;
        if (!k || !st.sc || !st.sc.f) return;
        st.sc.f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (k === 'buscar') buscarAnfitrionGuardia(e.target.value);
      });
    }
    if (st.ses) cargar(); else pintar();
  }

  window.GuardiaVisitas = { montar, detenerCamara };
})();
