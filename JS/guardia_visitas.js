/**
 * TCONTROL · Registro de visitas · portería (pestaña "Visitas" de guardia.html)
 *
 * El guardia activa la portería de visitas con su clave (Apps Script tokenGuardia → JWT de 12 h,
 * claim guardia; la clave vive en Propiedades del script, no en este código). Luego:
 *   - Lee el QR del visitante con la cámara (BarcodeDetector o jsQR) o escribe el código de 8 caracteres.
 *   - Ve la ficha: nombre, empresa, motivo, anfitrión, almuerzo (sin datos de contacto).
 *   - Verifica el documento a la vista (no se guarda) y registra la entrada; a la salida, la salida.
 *   - Registra visitantes sin cita en una ventana guiada: con celular (QR de portería) o sin él (4 pasos).
 * La lista "Visitas de hoy" va en #panelVisitasLista (columna derecha en escritorio, debajo en celular),
 * se actualiza sola cada minuto y anima los estados (dentro, por llegar, sin aprobar, salió).
 * Datos: PostgREST api.visita_guardia (respaldo: Apps Script evalRpc).
 */
(function () {
  'use strict';
  const KEY = 'tcontrol_sesion_porteria';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');
  const horaDe = ts => ts ? new Date(ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
  const st = { ses: null, lista: [], ficha: null, error: '', escaneando: false, stream: null, cargando: false,
    cargandoLista: false, listaTs: 0, buscando: '', registrando: '', abriendoCamara: false, filtro: 'todas',
    // Visitante sin cita (ventana): modo 'elegir' | 'qr' | 'form' (paso 1-4) | 'listo'
    sc: null, tipos: [], eppTexto: '' };
  const tipoDe = id => st.tipos.find(t => t.id === id) || null;
  const SPIN = '<span class="spin-sm" aria-hidden="true"></span>';
  const LENTO = '<p class="cargando-nota lento-6s" style="margin-top:10px">La conexión con la base está lenta, sigue trabajando…</p>';
  let cont = null;
  const listaCont = () => document.getElementById('panelVisitasLista');

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
    pintarPrincipal();
    pintarLista();
    pintarModal();
  }

  function pintarPrincipal() {
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
    // Si la cámara está activa, se conserva el mismo video al redibujar (no se corta el escaneo)
    const scanVivo = st.escaneando && (st.stream || st.abriendoCamara === 'pidiendo') ? cont.querySelector('.gv-scan') : null;
    cont.innerHTML = `<div class="vs-root">
      <div class="card gv-card-ingreso">
        <h3 class="gv-titulo"><i class="fas fa-qrcode"></i> Visitante con cita</h3>
        ${st.escaneando
          ? `<div class="gv-scan"><video id="gvVideo" playsinline muted></video><div class="gv-marco"></div>
               ${st.abriendoCamara ? `<div class="gv-scan-cargando">${SPIN} Abriendo cámara…</div>` : ''}</div>
             <button class="btn-large btn-secondary" data-gv="detener"><i class="fas fa-stop"></i> Detener cámara</button>`
          : `<button class="btn-large btn-primary" data-gv="escanear"><i class="fas fa-camera"></i> Escanear su código QR</button>`}
        <form id="gvCodigoForm" class="gv-codigo" style="margin-top:12px">
          <input class="vs-input" id="gvCodigo" maxlength="9" placeholder="Código: ABCD-EFGH" autocomplete="off" autocapitalize="characters" ${st.buscando ? 'disabled' : ''}>
          <button class="vs-btn vs-btn-prim" type="submit" ${st.buscando ? 'disabled' : ''} aria-label="Buscar">${st.buscando ? SPIN : '<i class="fas fa-search"></i>'}</button></form>
        ${st.error ? `<div class="vs-error" style="margin-top:12px"><i class="fas fa-exclamation-circle"></i> ${esc(st.error)}</div>` : ''}
      </div>
      ${st.buscando ? `<div class="card gv-ficha"><p class="cargando-nota" style="margin:0 0 12px">${SPIN} Buscando la visita ${esc(codigoBonito(st.buscando))}…</p>
          <div class="sk sk-linea" style="width:45%;height:18px"></div><div class="sk sk-linea" style="width:70%;margin-top:12px"></div>
          <div class="sk sk-linea" style="width:55%;margin-top:8px"></div><div class="sk sk-bloque" style="margin-top:14px"></div>${LENTO}</div>`
        : st.ficha ? fichaHtml(st.ficha) : ''}
      <button type="button" class="gv-boton-sincita" data-gv="sc-abrir">
        <i class="fas fa-user-plus"></i>
        <span><strong>Registrar visitante sin cita</strong><small>Llegó sin registro previo: regístrelo antes de dejarlo pasar</small></span>
        <i class="fas fa-chevron-right"></i>
      </button>
      <p class="gv-cerrar-porteria"><button type="button" class="vs-link" data-gv="salir"><i class="fas fa-lock"></i> Cerrar portería de visitas</button></p>
    </div>`;
    if (scanVivo) { const nuevo = cont.querySelector('.gv-scan'); if (nuevo) nuevo.replaceWith(scanVivo); }
    if (st.escaneando) iniciarCamara();
  }

  // ---------------------------------------------------------------- lista de visitas de hoy (estados animados)
  const GRUPOS = [
    ['dentro', 'Dentro', v => v.estado === 'en_curso'],
    ['llegar', 'Por llegar', v => v.estado === 'aprobada'],
    ['pendientes', 'Sin aprobar', v => v.estado === 'pendiente'],
    ['salieron', 'Salieron', v => v.estado === 'concluida']
  ];
  let estadosPrevios = null;   // codigo → estado de la pintada anterior (para destacar cambios)
  const minutosDesde = ts => ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)) : 0;
  const duracion = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

  function estadoHtml(v) {
    if (v.estado === 'en_curso') return `<span class="gv-est gv-est-dentro"><b><i class="gv-pulso"></i>Dentro</b><small>desde ${horaDe(v.entradaEn)} · ${duracion(minutosDesde(v.entradaEn))}</small></span>`;
    if (v.estado === 'aprobada') return `<span class="gv-est gv-est-llegar"><b><i class="fas fa-clock gv-tic"></i> Por llegar</b><small>${v.hora ? 'a las ' + esc(v.hora) : 'hoy'}</small></span>`;
    if (v.estado === 'pendiente') return `<span class="gv-est gv-est-pendiente"><b><i class="gv-parpadeo"></i>Sin aprobar</b><small>el anfitrión no responde</small></span>`;
    if (v.estado === 'concluida') return `<span class="gv-est gv-est-salio"><b><i class="fas fa-check"></i> Salió</b><small>${horaDe(v.salidaEn)}</small></span>`;
    return `<span class="gv-est gv-est-otro"><i class="fas fa-ban"></i> ${esc(String(v.estado).replace('_', ' '))}</span>`;
  }

  function filaHtml(v, i, cambio) {
    const ini = String(v.nombre || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
    return `<button type="button" class="gv-fila gv-fila-${esc(v.estado)} ${cambio}" data-ver="${esc(v.codigo)}" style="--i:${Math.min(i, 12)}">
      <span class="gv-avatar">${esc(ini)}</span>
      <span class="gv-fila-info">
        <strong>${esc(v.nombre || '(sin nombre)')}</strong>
        <small>${esc(v.empresa || 'Particular')} · visita a ${esc(v.anfitrion || 'área encargada')}</small>
        <span class="gv-fila-chips">${v.origen === 'porteria' ? '<em class="gv-chip gv-chip-sc">Sin cita</em>' : ''}${v.tipoNombre ? `<em class="gv-chip">${esc(v.tipoNombre)}</em>` : ''}${v.epp ? '<em class="gv-chip gv-chip-epp"><i class="fas fa-hard-hat"></i> EPP</em>' : ''}</span>
      </span>
      ${estadoHtml(v)}
    </button>`;
  }

  function pintarLista() {
    const el = listaCont();
    if (!el) return;
    if (!st.ses) { el.innerHTML = ''; return; }
    const L = st.lista;
    const cuenta = Object.fromEntries(GRUPOS.map(([k, , fn]) => [k, L.filter(fn).length]));
    const orden = { en_curso: 0, aprobada: 1, pendiente: 2, concluida: 3 };
    const filtro = GRUPOS.find(g => g[0] === st.filtro);
    const visibles = L.filter(v => !filtro || filtro[2](v))
      .sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || String(a.hora || '').localeCompare(String(b.hora || '')));
    const previos = estadosPrevios;
    const nuevos = {};
    const filas = visibles.map((v, i) => {
      nuevos[v.codigo] = v.estado;
      const cambio = !previos ? 'gv-fila-entra' : !(v.codigo in previos) ? 'gv-fila-nueva' : previos[v.codigo] !== v.estado ? 'gv-fila-cambio' : '';
      return filaHtml(v, i, cambio);
    }).join('');
    if (st.listaTs) estadosPrevios = Object.assign({}, estadosPrevios || {}, nuevos, Object.fromEntries(L.map(v => [v.codigo, v.estado])));
    const chip = (k, t, n) => `<button type="button" class="gv-filtro ${st.filtro === k ? 'gv-filtro-on' : ''} gv-filtro-${k}" data-gv="filtro" data-f="${k}">${t}${n !== undefined ? ` <b>${n}</b>` : ''}</button>`;
    el.innerHTML = `<div class="card gv-lista">
      <div class="gv-lista-cab"><h3 class="gv-titulo m-0"><i class="fas fa-calendar-day"></i> Visitas de hoy</h3>
        <button class="vs-btn vs-btn-sm" data-gv="recargar" ${st.cargandoLista ? 'disabled' : ''} aria-label="Actualizar" title="Actualizar"><i class="fas fa-sync-alt ${st.cargandoLista ? 'fa-spin' : ''}"></i></button></div>
      <p class="gv-lista-estado">${st.cargandoLista ? `${SPIN} ${st.listaTs ? 'Actualizando…' : 'Cargando visitas de hoy…'}` : st.listaTs ? `<i class="fas fa-circle gv-vivo"></i> Se actualiza sola · ${horaDe(st.listaTs)}` : ''}</p>
      <div class="gv-filtros">${chip('todas', 'Todas', L.length)}${GRUPOS.map(([k, t]) => chip(k, t, cuenta[k])).join('')}</div>
      <div class="gv-lista-filas">
        ${!st.listaTs && st.cargandoLista
          ? '<div class="sk sk-bloque"></div><div class="sk sk-bloque"></div><div class="sk sk-bloque"></div>' + LENTO
          : filas || `<div class="gv-vacio"><i class="fas fa-calendar-check"></i><p>${st.listaTs ? (L.length ? 'No hay visitas en este filtro.' : 'No hay visitas para hoy.') : ''}</p></div>`}
      </div></div>`;
  }

  // ---------------------------------------------------------------- visitante sin cita: ventana guiada
  const urlRegistroPorteria = token => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}visitas.html?porteria=${token}`;
  function qrGrande(texto) {
    if (typeof window.qrcode !== 'function') return `<div class="vs-muted">No se pudo generar el QR. Abra en el celular del visitante: ${esc(texto)}</div>`;
    const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  const PASOS_SC = [
    ['¿Para qué es la visita?', 'Elija la opción que mejor describe a qué viene.'],
    ['¿A quién visita?', 'Pregúntele el nombre de la persona y búsquela.'],
    ['Datos del visitante', 'Tal como aparecen en su documento de identidad.'],
    ['Revise y confirme', 'Verifique la cédula y léale el aviso de datos.']
  ];
  const ICONOS_TIPO = { oficina: 'fa-building', planta: 'fa-industry', cliente: 'fa-box-open', proveedor: 'fa-truck' };
  const MOTIVOS_RAPIDOS = ['Entrega', 'Retiro de producto', 'Reunión', 'Mantenimiento', 'Consulta'];

  function modalRaiz() {
    let m = document.getElementById('gvModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'gvModal';
      m.className = 'gv-modal';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.addEventListener('click', e => { if (e.target === m) cerrarModal(); else alClic(e); });
      m.addEventListener('submit', alEnviar);
      m.addEventListener('input', alEscribir);
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrarModal(forzar) {
    const sc = st.sc;
    if (!forzar && sc && sc.modo === 'form' && sc.paso > 1 && !sc.enviando &&
      !confirm('¿Cancelar el registro? Se perderán los datos ingresados.')) return;
    clearInterval(tReloj);
    st.sc = null;
    pintarModal();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.sc && !(st.sc.enviando)) cerrarModal(); });

  function pintarModal() {
    const sc = st.sc;
    const m = document.getElementById('gvModal');
    if (!sc) { if (m) m.remove(); document.body.classList.remove('gv-modal-abierto'); return; }
    const raiz = modalRaiz();
    document.body.classList.add('gv-modal-abierto');
    let cab = '', cuerpo = '', pie = '';
    const cerrar = `<button type="button" class="gv-m-x" data-gv="sc-cerrar" aria-label="Cerrar" ${sc.enviando ? 'disabled' : ''}>&times;</button>`;

    if (sc.modo === 'elegir') {
      cab = `<h2>Registrar visitante sin cita</h2>`;
      cuerpo = `<p class="gv-m-pregunta">¿El visitante tiene celular con internet?</p>
        <div class="gv-m-opciones">
          <button type="button" class="gv-m-opcion" data-gv="sc-qr"><i class="fas fa-mobile-alt"></i>
            <span><strong>Sí, tiene celular</strong><small>Se registra él mismo escaneando un QR. Usted solo verifica su cédula.</small></span><i class="fas fa-chevron-right"></i></button>
          <button type="button" class="gv-m-opcion" data-gv="sc-form"><i class="fas fa-keyboard"></i>
            <span><strong>No tiene celular</strong><small>Usted lo registra en 4 pasos cortos.</small></span><i class="fas fa-chevron-right"></i></button>
        </div>`;
    } else if (sc.modo === 'qr') {
      const vencido = sc.expira && Date.now() > sc.expira;
      cab = `<button type="button" class="gv-m-volver" data-gv="sc-elegir"><i class="fas fa-arrow-left"></i></button><h2>Que se registre en su celular</h2>`;
      cuerpo = sc.cargando ? `<div class="gv-qr-grande"><div class="sk" style="width:100%;height:100%"></div></div><p class="cargando-nota">${SPIN} Generando QR…</p>${LENTO}`
        : sc.error ? `<div class="vs-error"><i class="fas fa-exclamation-circle"></i> ${esc(sc.error)}</div>`
        : `<div class="gv-m-qr">
            <div class="gv-qr-grande ${vencido ? 'gv-qr-vencido' : ''}">${qrGrande(urlRegistroPorteria(sc.token))}</div>
            <p class="gv-reloj" id="gvReloj">${vencido ? 'Vencido: genere otro' : ''}</p>
            <ol class="gv-m-pasos"><li><b>1</b><span>Muéstrele esta pantalla y pídale que <strong>escanee el QR</strong> con la cámara de su celular.</span></li>
              <li><b>2</b><span>Él llena sus datos en su teléfono. Al terminar le aparece <strong>su propio QR</strong>.</span></li>
              <li><b>3</b><span>Toque <strong>«Ya se registró»</strong>, escanee su QR, verifique la cédula y registre la entrada.</span></li></ol>
          </div>`;
      pie = `<button type="button" class="vs-btn" data-gv="sc-nuevo"><i class="fas fa-sync-alt"></i> Otro QR</button>
        <button type="button" class="btn-large btn-primary gv-m-prim" data-gv="sc-escanear"><i class="fas fa-camera"></i> Ya se registró: escanear su QR</button>`;
    } else if (sc.modo === 'listo') {
      const v = sc.visita || {};
      cab = `<h2>Visitante registrado</h2>`;
      cuerpo = `<div class="gv-m-listo"><div class="gv-m-exito"><i class="fas fa-check"></i></div>
          <p class="gv-m-pregunta">¡Listo! Entrada registrada</p>
          <p class="gv-m-listo-nombre">${esc(v.nombre || '')}</p>
          <p class="vs-muted">${esc(v.empresa || '')} · visita a ${esc(v.anfitrion || 'área encargada')} · ${horaDe(v.entradaEn || Date.now())}</p>
          <p class="gv-m-aviso"><i class="fas fa-bell"></i> Ya se avisó a la persona que visita. Cuando se vaya, busque su nombre en «Visitas de hoy» y registre la salida.</p></div>`;
      pie = `<button type="button" class="vs-btn" data-gv="sc-otro"><i class="fas fa-user-plus"></i> Registrar otro</button>
        <button type="button" class="btn-large btn-success gv-m-prim" data-gv="sc-terminar"><i class="fas fa-check"></i> Terminar</button>`;
    } else {
      const f = sc.f, paso = sc.paso, t = tipoDe(f.tipo);
      const [pregunta, ayuda] = PASOS_SC[paso - 1];
      cab = `<button type="button" class="gv-m-volver" data-gv="${paso > 1 ? 'sc-atras' : 'sc-elegir'}" ${sc.enviando ? 'disabled' : ''}><i class="fas fa-arrow-left"></i></button>
        <h2>Paso ${paso} de 4</h2>`;
      const progreso = `<div class="gv-m-progreso">${[1, 2, 3, 4].map(n => `<span class="${n < paso ? 'hecho' : n === paso ? 'actual' : ''}"></span>`).join('')}</div>`;
      let campos = '';
      if (paso === 1) {
        campos = `<div class="gv-m-tipos">${st.tipos.map(x => `<button type="button" class="gv-m-tipo ${f.tipo === x.id ? 'on' : ''}" data-gv="sc-tipo" data-id="${esc(x.id)}">
            <i class="fas ${ICONOS_TIPO[x.id] || 'fa-door-open'}"></i><span><strong>${esc(x.nombre)}</strong><small>${esc(x.descripcion || '')}</small></span>
            ${x.epp ? '<em><i class="fas fa-hard-hat"></i> EPP</em>' : ''}</button>`).join('')
          || '<p class="vs-muted">No se cargaron los tipos de visita. Cierre esta ventana, toque <i class="fas fa-sync-alt"></i> en «Visitas de hoy» y vuelva a intentar.</p>'}</div>`;
      } else if (paso === 2) {
        campos = f.anfitrion
          ? `<div class="gv-m-elegido"><i class="fas fa-user-check"></i><span><strong>${esc(f.anfitrion.nombre)}</strong><small>${esc(f.anfitrion.area)}</small></span><button type="button" class="vs-link" data-gv="sc-cambiar">Cambiar</button></div>`
          : `<div class="gv-m-buscar"><i class="fas fa-search"></i><input id="gvScBuscar" data-sc="buscar" placeholder="Nombre o apellido (mínimo 3 letras)" value="${esc(f.buscar || '')}" autocomplete="off"></div>
             <div id="gvScSug" class="gv-m-sug"></div>
             ${t && t.anfitrionOpcional ? `<button type="button" class="gv-m-sinanf" data-gv="sc-sin-anf"><i class="fas fa-users"></i><span><strong>No sabe a quién</strong><small>Lo atiende el área encargada de ${esc(t.nombre.toLowerCase())}</small></span></button>` : ''}`;
        if (f.anfitrion) pie = `<button type="button" class="btn-large btn-primary gv-m-prim" data-gv="sc-sig">Siguiente <i class="fas fa-arrow-right"></i></button>`;
      } else if (paso === 3) {
        campos = `<label class="gv-m-campo"><span>Nombre y apellido</span><input data-sc="nombre" maxlength="80" value="${esc(f.nombre || '')}" placeholder="Ej.: Juan Pérez"></label>
          <label class="gv-m-campo"><span>Empresa o institución</span>
            <div class="gv-m-fila"><input data-sc="empresa" maxlength="80" value="${esc(f.empresa || '')}" placeholder="Nombre de la empresa">
            <button type="button" class="gv-m-chip ${f.empresa === 'Particular' ? 'on' : ''}" data-gv="sc-particular">Particular</button></div></label>
          <label class="gv-m-campo"><span>Motivo de la visita</span><input data-sc="motivo" maxlength="200" value="${esc(f.motivo || '')}" placeholder="Escriba o toque una opción">
            <div class="gv-m-chips">${MOTIVOS_RAPIDOS.map(x => `<button type="button" class="gv-m-chip ${f.motivo === x ? 'on' : ''}" data-gv="sc-motivo" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div></label>`;
        pie = `<button type="submit" class="btn-large btn-primary gv-m-prim">Siguiente <i class="fas fa-arrow-right"></i></button>`;
      } else {
        const fila = (etq, val, ir) => `<button type="button" class="gv-m-res" data-gv="sc-ir" data-paso="${ir}"><span>${etq}</span><strong>${val}</strong><i class="fas fa-pen"></i></button>`;
        const check = (k, texto) => `<label class="gv-m-check ${f[k] ? 'on' : ''}"><input type="checkbox" data-sc="${k}" ${f[k] ? 'checked' : ''}><i class="fas fa-check"></i><span>${texto}</span></label>`;
        campos = `<div class="gv-m-resumen">
            ${fila('Tipo', esc(t ? t.nombre : ''), 1)}${fila('Visita a', f.anfitrion ? esc(f.anfitrion.nombre) : 'Área encargada', 2)}
            ${fila('Visitante', esc(f.nombre || ''), 3)}${fila('Empresa', esc(f.empresa || ''), 3)}${fila('Motivo', esc(f.motivo || ''), 3)}</div>
          ${t && t.epp ? `<div class="vs-epp"><i class="fas fa-hard-hat"></i><span><strong>Visita a planta: EPP obligatorio.</strong> ${esc(st.eppTexto)}</span></div>` : ''}
          ${check('doc', '<strong>Revisé su cédula</strong> y el nombre coincide')}
          ${t && t.epp ? check('epp', '<strong>Lleva el EPP</strong> obligatorio para planta') : ''}
          <div class="gv-m-leer"><span class="gv-m-leer-etq"><i class="fas fa-comment-dots"></i> Léale en voz alta</span>
            «Sus datos (nombre, empresa y motivo) se usan solo para gestionar esta visita y la seguridad. Los ven la persona que visita y la administración, y se borran a los 6 meses. Puede ejercer sus derechos escribiendo a informacion@tcontrolsa.com.»</div>
          ${check('acepta', '<strong>Se lo leí y estuvo de acuerdo</strong>')}`;
        pie = `<button type="submit" class="btn-large btn-success gv-m-prim" ${sc.enviando ? 'disabled' : ''}>${sc.enviando ? SPIN + ' Registrando…' : '<i class="fas fa-sign-in-alt"></i> Registrar e ingresar'}</button>`;
      }
      cuerpo = `${progreso}<p class="gv-m-pregunta">${pregunta}</p><p class="gv-m-ayuda">${ayuda}</p>
        ${sc.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(sc.error)}</div>` : ''}
        ${campos}${sc.enviando ? LENTO : ''}`;
    }
    const conForm = sc.modo === 'form';
    raiz.innerHTML = `<${conForm ? 'form id="gvSinCitaForm" novalidate autocomplete="off"' : 'div'} class="gv-m-caja gv-m-${sc.modo}">
        <div class="gv-m-cab">${cab}${cerrar}</div>
        <div class="gv-m-cuerpo">${cuerpo}</div>
        ${pie ? `<div class="gv-m-pie">${pie}</div>` : ''}
      </${conForm ? 'form' : 'div'}>`;
    if (sc.modo === 'qr' && sc.token) relojQr();
  }

  // Valida los pasos hasta "paso"; devuelve el mensaje de error o '' si se puede avanzar
  function errorPasoSc(paso) {
    const f = st.sc.f, t = tipoDe(f.tipo);
    if (paso >= 1 && !t) return 'Elija para qué es la visita.';
    if (paso >= 2 && !f.anfitrion && !(t.anfitrionOpcional && f.sinAnfitrion)) return 'Busque y elija a la persona que visita.';
    if (paso >= 3) {
      if (String(f.nombre || '').trim().length < 3) return 'Escriba el nombre y apellido del visitante.';
      if (String(f.empresa || '').trim().length < 2) return 'Escriba la empresa o toque «Particular».';
      if (String(f.motivo || '').trim().length < 3) return 'Escriba el motivo o toque una de las opciones.';
    }
    return '';
  }
  function irPasoSc(paso) {
    const sc = st.sc;
    const err = paso > sc.paso ? errorPasoSc(paso - 1) : '';
    if (err) { sc.error = err; return pintarModal(); }
    sc.paso = paso; sc.error = '';
    pintarModal();
    const m = document.getElementById('gvModal');
    const foco = paso === 2 ? document.getElementById('gvScBuscar') : paso === 3 ? m && m.querySelector('[data-sc="nombre"]') : null;
    if (foco) foco.focus();
  }

  let tReloj = null;
  function relojQr() {
    clearInterval(tReloj);
    const tic = () => {
      const el = document.getElementById('gvReloj');
      if (!el || !st.sc || st.sc.modo !== 'qr' || !st.sc.expira) { clearInterval(tReloj); return; }
      const ms = st.sc.expira - Date.now();
      if (ms <= 0) { clearInterval(tReloj); pintarModal(); return; }
      el.textContent = `Este QR vence en ${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    };
    tic(); tReloj = setInterval(tic, 1000);
  }
  async function nuevoQrPorteria() {
    st.sc = { modo: 'qr', cargando: true }; pintarModal();
    try {
      const r = await rpc({ accion: 'pase_porteria' });
      if (!r.ok) throw new Error(r.error);
      if (!st.sc || st.sc.modo !== 'qr') return;     // se cerró mientras tanto
      st.sc = { modo: 'qr', token: r.token, expira: new Date(r.expira).getTime() };
    } catch (e) { if (st.sc) st.sc = { modo: 'qr', error: e.message }; }
    pintarModal();
  }

  let tScBuscar = null, nScBuscar = 0;
  function buscarAnfitrionGuardia(q) {
    clearTimeout(tScBuscar);
    const caja = document.getElementById('gvScSug');
    if (!caja) return;
    if (q.trim().length < 3) { caja.innerHTML = ''; return; }
    const id = ++nScBuscar;
    caja.innerHTML = `<p class="cargando-nota">${SPIN} Buscando…</p>`;
    tScBuscar = setTimeout(async () => {
      try {
        const r = await rpc({ accion: 'anfitriones', q: q.trim() });
        if (id !== nScBuscar || !document.getElementById('gvScSug')) return;
        const lista = (r.ok && r.anfitriones) || [];
        document.getElementById('gvScSug').innerHTML = lista.length
          ? lista.map(a => `<button type="button" class="gv-m-persona" data-gv="sc-anf" data-id="${esc(a.id)}" data-nom="${esc(a.nombre)}" data-area="${esc(a.area)}">
              <span class="gv-avatar">${esc(String(a.nombre || '?').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase())}</span>
              <span><strong>${esc(a.nombre)}</strong><small>${esc(a.area)}</small></span><i class="fas fa-chevron-right"></i></button>`).join('')
          : '<p class="gv-m-sinres"><i class="fas fa-user-slash"></i> No encontramos a nadie con ese nombre. Revise cómo se escribe o pruebe solo el apellido.</p>';
      } catch (e) {
        if (id === nScBuscar && document.getElementById('gvScSug')) document.getElementById('gvScSug').innerHTML = `<p class="vs-error">${esc(e.message)}</p>`;
      }
    }, 350);
  }
  async function registrarSinCita() {
    const sc = st.sc, f = sc.f, t = tipoDe(f.tipo);
    const errPrevio = errorPasoSc(3);
    if (errPrevio) { sc.error = errPrevio; return pintarModal(); }
    if (!f.doc) { sc.error = 'Marque que revisó su cédula.'; return pintarModal(); }
    if (t.epp && !f.epp) { sc.error = 'Visita a planta: marque que lleva el EPP.'; return pintarModal(); }
    if (!f.acepta) { sc.error = 'Léale el aviso de datos y marque que estuvo de acuerdo.'; return pintarModal(); }
    sc.enviando = true; sc.error = ''; pintarModal();
    try {
      const r = await rpc({ accion: 'registrar', tipo: t.id, anfitrionId: f.anfitrion ? f.anfitrion.id : '', nombre: f.nombre, empresa: f.empresa, motivo: f.motivo,
        documentoVerificado: true, aceptaVerbal: true, eppVerificado: !!f.epp });
      if (!r.ok) throw new Error(r.error);
      st.sc = { modo: 'listo', visita: r.visita };
      pintarModal();
      cargar();
    } catch (e) { sc.enviando = false; sc.error = e.message; pintarModal(); }
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
        ${estadoHtml(v)}</div>
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
    st.cargandoLista = true; pintarLista();
    cargaLista = (async () => {
      try {
        const r = await rpc({ accion: 'hoy' });
        if (!r.ok) throw new Error(r.error);
        st.lista = r.visitas || []; st.listaTs = Date.now(); st.error = '';
        if (Array.isArray(r.tipos)) st.tipos = r.tipos;
        if (r.eppTexto) st.eppTexto = r.eppTexto;
      } catch (e) { st.error = e.message; }
      st.cargandoLista = false; cargaLista = null;
      pintarPrincipal(); pintarLista();
    })();
    return cargaLista;
  }
  async function buscar(codigo) {
    if (st.buscando) return;
    st.error = ''; st.ficha = null; st.buscando = codigo.replace(/^TCV1:/i, ''); pintarPrincipal();
    const f0 = cont.querySelector('.gv-ficha'); if (f0) f0.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const r = await rpc({ accion: 'buscar', codigo });
      if (!r.ok) throw new Error(r.error);
      st.ficha = { visita: r.visita, hoy: r.hoy };
    } catch (e) { st.error = e.message; }
    st.buscando = '';
    pintarPrincipal();
    const f = cont.querySelector('.gv-ficha'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function registrar(accion, codigo) {
    const p = { accion, codigo };
    if (accion === 'entrada') {
      const doc = document.getElementById('gvDoc');
      if (!doc || !doc.checked) { st.error = 'Confirma que verificaste el documento de identidad.'; return pintarPrincipal(); }
      p.documentoVerificado = true;
      const epp = document.getElementById('gvEpp');
      if (epp && !epp.checked) { st.error = 'Esta visita es a planta: confirma que el visitante lleva el EPP.'; return pintarPrincipal(); }
      if (epp) p.eppVerificado = true;
    }
    if (st.registrando) return;
    st.registrando = accion; pintarPrincipal();
    try {
      const r = await rpc(p);
      if (!r.ok) throw new Error(r.error);
      st.ficha = null; st.error = ''; st.registrando = '';
      if (typeof window.mostrarToast === 'function') window.mostrarToast(accion === 'entrada' ? `Entrada registrada: ${r.visita.nombre}` : `Salida registrada: ${r.visita.nombre}`, 'success');
      cargar();
    } catch (e) { st.error = e.message; st.registrando = ''; pintarPrincipal(); }
  }

  // ---------------------------------------------------------------- eventos (panel, lista y ventana)
  async function alEnviar(e) {
    e.preventDefault();
    if (e.target.id === 'gvLogin') {
      const clave = document.getElementById('gvClave').value.trim();
      if (!clave) return;
      st.cargando = true; st.error = ''; pintarPrincipal();
      try {
        const r = await post({ accion: 'tokenGuardia', clave, puesto: 'PORTERIA' });
        if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo activar la portería.');
        st.ses = { token: r.token, exp: r.exp, puesto: r.puesto };
        try { localStorage.setItem(KEY, JSON.stringify(st.ses)); } catch (x) { }
        st.cargando = false; pintar(); await cargar();
      } catch (x) { st.cargando = false; st.error = x.message; pintarPrincipal(); }
    }
    if (e.target.id === 'gvSinCitaForm') return st.sc && st.sc.paso < 4 ? irPasoSc(st.sc.paso + 1) : registrarSinCita();
    if (e.target.id === 'gvCodigoForm') {
      const c = document.getElementById('gvCodigo').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (c.length !== 8) { st.error = 'El código tiene 8 caracteres.'; return pintarPrincipal(); }
      buscar(c);
    }
  }
  function alEscribir(e) {
    const k = e.target.dataset && e.target.dataset.sc;
    if (!k || !st.sc || !st.sc.f) return;
    st.sc.f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'checkbox') { const l = e.target.closest('.gv-m-check'); if (l) l.classList.toggle('on', e.target.checked); }
    if (k === 'buscar') buscarAnfitrionGuardia(e.target.value);
  }
  function alClic(e) {
    const b = e.target.closest('[data-gv],[data-ver]');
    if (!b) return;
    if (b.dataset.ver) return buscar(b.dataset.ver);
    const a = b.dataset.gv;
    const m = document.getElementById('gvModal');
    // Ventana de visitante sin cita
    if (a === 'sc-abrir' || a === 'sc-elegir' || a === 'sc-otro') { clearInterval(tReloj); st.sc = { modo: 'elegir' }; return pintarModal(); }
    if (a === 'sc-qr' || a === 'sc-nuevo') return nuevoQrPorteria();
    if (a === 'sc-form') { st.sc = { modo: 'form', paso: 1, f: {} }; return pintarModal(); }
    if (a === 'sc-cerrar') return cerrarModal();
    if (a === 'sc-terminar') return cerrarModal(true);
    if (a === 'sc-escanear') {
      cerrarModal(true);
      st.escaneando = true; st.abriendoCamara = true; st.error = ''; pintarPrincipal();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (a === 'sc-anf') { st.sc.f.anfitrion = { id: b.dataset.id, nombre: b.dataset.nom, area: b.dataset.area }; st.sc.f.sinAnfitrion = false; return irPasoSc(3); }
    if (a === 'sc-sin-anf') { st.sc.f.anfitrion = null; st.sc.f.sinAnfitrion = true; return irPasoSc(3); }
    if (a === 'sc-cambiar') { st.sc.f.anfitrion = null; st.sc.f.sinAnfitrion = false; st.sc.f.buscar = ''; pintarModal(); const i = document.getElementById('gvScBuscar'); if (i) i.focus(); return; }
    if (a === 'sc-tipo') {
      const f = st.sc.f;
      if (f.tipo !== b.dataset.id) { f.epp = false; if (f.sinAnfitrion && !(tipoDe(b.dataset.id) || {}).anfitrionOpcional) f.sinAnfitrion = false; }
      f.tipo = b.dataset.id;
      return irPasoSc(2);
    }
    if (a === 'sc-sig') return irPasoSc(st.sc.paso + 1);
    if (a === 'sc-atras') { st.sc.paso = Math.max(1, st.sc.paso - 1); st.sc.error = ''; return pintarModal(); }
    if (a === 'sc-ir') { st.sc.paso = Number(b.dataset.paso); st.sc.error = ''; return pintarModal(); }
    if (a === 'sc-particular' || a === 'sc-motivo') {
      const k = a === 'sc-particular' ? 'empresa' : 'motivo', v = a === 'sc-particular' ? 'Particular' : b.dataset.v;
      st.sc.f[k] = v;
      const i = m && m.querySelector(`[data-sc="${k}"]`); if (i) i.value = v;
      b.parentNode.querySelectorAll('.gv-m-chip').forEach(c => c.classList.toggle('on', c === b));
      return;
    }
    // Panel y lista
    if (a === 'filtro') { st.filtro = b.dataset.f; return pintarLista(); }
    if (a === 'escanear') { st.escaneando = true; st.abriendoCamara = true; st.error = ''; pintarPrincipal(); }
    else if (a === 'detener') { detenerCamara(); pintarPrincipal(); }
    else if (a === 'recargar') cargar();
    else if (a === 'cerrar-ficha') { st.ficha = null; pintarPrincipal(); }
    else if (a === 'entrada' || a === 'salida') registrar(a, b.dataset.cod);
    else if (a === 'salir') { salir(); st.lista = []; st.listaTs = 0; st.ficha = null; st.sc = null; estadosPrevios = null; pintar(); }
  }

  // La lista se mantiene al día mientras la pestaña Visitas está a la vista
  setInterval(() => {
    const panel = document.getElementById('panelVisitas');
    if (st.ses && panel && !panel.classList.contains('hidden') && document.visibilityState === 'visible' && !st.sc) cargar();
  }, 60 * 1000);

  function montar(el) {
    cont = el;
    st.ses = sesion();
    if (!cont._gv) {
      cont._gv = true;
      cont.addEventListener('submit', alEnviar);
      cont.addEventListener('click', alClic);
      const lc = listaCont();
      if (lc && !lc._gv) { lc._gv = true; lc.addEventListener('click', alClic); }
    }
    if (st.ses) { pintar(); cargar(); } else pintar();
  }

  window.GuardiaVisitas = { montar, detenerCamara };
})();
