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
 * Datos: PostgREST api.visita_guardia (respaldo de red: Apps Script evalRpc).
 * Si el servidor no responde, la portería pasa sola a MODO CONTINGENCIA: trabaja con la copia que
 * Apps Script guarda cada 10 min (visitas_respaldo.gs, hoja privada), registra entradas, salidas y
 * sin cita allí (con aviso al anfitrión) y, cuando el servidor vuelve, se envían a Postgres.
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
    sc: null, tipos: [], eppTexto: '', cto: {}, horario: { apertura: '07:30', cierre: '18:30' } };
  // Horario de visitas (Ecuador): fuera de él no se registran ingresos; a la hora de cierre el servidor cierra
  // solas las visitas que siguen dentro (salida no registrada por portería)
  const horaEc = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false });
  const fueraHorario = () => { const h = horaEc(); return h < st.horario.apertura || h > st.horario.cierre; };
  const msgHorario = () => `La empresa recibe visitas de ${st.horario.apertura} a ${st.horario.cierre}. No se puede registrar el ingreso a esta hora.`;
  const restaParaCierre = () => { const [h, m] = horaEc().split(':').map(Number), [ch, cm] = st.horario.cierre.split(':').map(Number); return ch * 60 + cm - (h * 60 + m); };
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
  // Servidor de visitas (PostgREST y, si falla la red, Apps Script evalRpc). Un error con "caida"
  // indica que el servidor no responde: se usa el respaldo.
  async function rpcServidor(p) {
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
    let r = null;
    try { r = await post({ accion: 'evalRpc', token: st.ses.token, fn: 'visita_guardia', p: JSON.stringify(p) }); } catch (e) { causa = e.message; }
    if (r && r.status === 401) { salir(); throw Object.assign(new Error('La sesión de portería venció. Ingresa la clave de nuevo.'), { sesion: true }); }
    if (!r || typeof r.status !== 'number' || r.status === 0 || r.status === 404 || r.status >= 500 || !r.body) {
      throw Object.assign(new Error('Sin conexión con la base de visitas (' + causa + ')'), { caida: true });
    }
    return r.body;
  }

  // ---------------------------------------------------------------- modo contingencia (respaldo)
  const nuevoId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  const OPS_RESPALDO = { hoy: 'estado', entrada: 'entrada', salida: 'salida', registrar: 'registrar', anfitriones: 'anfitriones' };

  async function respaldo(p) {
    if (p.accion === 'pase_porteria') {
      return { ok: false, error: 'Sin servidor de visitas no se puede generar el QR. Toque «Volver» y elija «No tiene celular» para registrarlo usted.' };
    }
    if (p.accion === 'buscar') {
      const r = await respaldo({ accion: 'hoy' });
      if (!r.ok) return r;
      const cod = String(p.codigo || '').toUpperCase().replace(/^TCV1:?/, '').replace(/[^A-Z0-9]/g, '');
      const v = (r.visitas || []).find(x => x.codigo === cod);
      return v ? { ok: true, visita: v, hoy: r.hoy } : { ok: false, error: 'Ese código no está entre las visitas de hoy de la copia de respaldo.' };
    }
    const op = OPS_RESPALDO[p.accion];
    if (!op) return { ok: false, error: 'No disponible en modo contingencia.' };
    let r;
    try {
      r = await post(Object.assign({}, p, { accion: 'visitasRespaldo', op, token: st.ses.token, id: p.id || nuevoId(), en: new Date().toISOString() }));
    } catch (e) { throw new Error('Sin conexión con el servidor ni con el respaldo de visitas. Revise el internet de la terminal.'); }
    if (!r) throw new Error('El respaldo de visitas no respondió.');
    if (r.sesion) { salir(); throw Object.assign(new Error(r.error), { sesion: true }); }
    if (p.accion === 'hoy' && r.ok) st.respaldo = { generado: r.generado, pendientes: r.pendientes || 0 };
    if (op !== 'estado' && op !== 'anfitriones' && r.ok && st.respaldo) st.respaldo.pendientes = (st.respaldo.pendientes || 0) + 1;
    return r;
  }

  async function volverDeContingencia() {
    let s = null;
    try { const r = await post({ accion: 'visitasRespaldo', op: 'sincronizar', token: st.ses.token }); s = r && r.sincronizacion; } catch (e) { }
    st.contingencia = false; st.respaldo = null;
    if (typeof window.mostrarToast === 'function') {
      window.mostrarToast(`Servidor de visitas restablecido${s && s.enviados ? ` · ${s.enviados} registro(s) del respaldo enviados` : ''}.`, 'success');
    }
  }

  // Todas las acciones pasan por aquí: servidor; si no responde, respaldo; en contingencia se
  // vuelve a probar el servidor cada vez que se actualiza la lista (como máximo cada 45 s).
  async function rpc(p) {
    if (st.contingencia) {
      if (p.accion === 'hoy' && Date.now() - (st.sondeo || 0) > 45000) {
        st.sondeo = Date.now();
        try { await rpcServidor({ accion: 'hoy' }); await volverDeContingencia(); return await rpcServidor(p); }
        catch (e) { if (e.sesion) throw e; }
      }
      return respaldo(p);
    }
    try { return await rpcServidor(p); }
    catch (e) {
      if (!e.caida) throw e;
      st.contingencia = true; st.sondeo = Date.now();
      if (typeof window.mostrarToast === 'function') window.mostrarToast('El servidor de visitas no responde: la portería sigue en modo contingencia.', 'warning');
      return respaldo(p);
    }
  }

  function bannerContingencia() {
    const r = st.respaldo || {};
    const copia = r.generado ? horaDe(r.generado) : '';
    return `<div class="card gv-contingencia" role="status">
      <div class="gv-cont-cab"><i class="fas fa-life-ring"></i><strong>Modo contingencia</strong><span class="gv-cont-punto"></span></div>
      <p>El servidor de visitas no responde. Puede seguir registrando entradas, salidas y visitantes sin cita: se guardan en el respaldo y se envían solos cuando vuelva.</p>
      <p class="gv-cont-meta">${copia ? `Lista de visitas copiada a las ${copia}` : 'Usando la copia de respaldo'}${r.pendientes ? ` · <b>${r.pendientes}</b> registro(s) por enviar` : ''} · Reintentando cada minuto</p>
    </div>`;
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
      ${st.contingencia ? bannerContingencia() : ''}
      ${fueraHorario() ? `<div class="card gv-horario" role="status"><i class="fas fa-clock"></i><span><strong>Fuera del horario de visitas</strong>La empresa recibe visitas de ${st.horario.apertura} a ${st.horario.cierre}: no se registran ingresos. Las salidas sí.</span></div>`
        : restaParaCierre() <= 30 && st.lista.some(v => v.estado === 'en_curso') ? `<div class="card gv-horario gv-horario-cierre" role="status"><i class="fas fa-door-closed"></i><span><strong>Cierre a las ${st.horario.cierre}</strong>Registre la salida de quienes siguen dentro. A las ${st.horario.cierre} se cierran solas como «salida no registrada».</span></div>` : ''}
      <div class="card gv-card-ingreso">
        <h3 class="gv-titulo"><i class="fas fa-qrcode"></i> Visitante con cita</h3>
        ${st.escaneando
          ? `<div class="gv-scan"><video id="gvVideo" playsinline muted></video><div class="gv-marco"></div>
               ${st.abriendoCamara ? `<div class="gv-scan-cargando">${SPIN} Abriendo cámara…</div>` : ''}
               <div class="gv-scan-ayuda" hidden><i class="fas fa-lightbulb"></i> ¿No lee? Pida al visitante subir el brillo y acercar el celular al recuadro, o escriba abajo el código de 8 caracteres.</div></div>
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
    if (v.estado === 'aprobada' && v.origen === 'porteria') return `<span class="gv-est gv-est-porteria"><b><i class="fas fa-door-open gv-tic"></i> En portería</b><small>${v.llamada && v.llamada.resultado ? esc(TXT_CONTACTO[v.llamada.resultado] || '') : 'llame al anfitrión'}</small></span>`;
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
        <span class="gv-fila-chips">${v.origen === 'porteria' ? '<em class="gv-chip gv-chip-sc">Sin cita</em>' : ''}${v.sinContacto ? '<em class="gv-chip gv-chip-alerta"><i class="fas fa-phone-slash"></i> Sin contacto</em>' : ''}${v.estado === 'en_curso' && restaParaCierre() <= 30 ? '<em class="gv-chip gv-chip-alerta"><i class="fas fa-door-closed"></i> Registre su salida</em>' : ''}${v.salidaAutomatica ? '<em class="gv-chip gv-chip-alerta"><i class="fas fa-robot"></i> Salida no registrada</em>' : ''}${v.tipoNombre ? `<em class="gv-chip">${esc(v.tipoNombre)}</em>` : ''}${v.epp ? '<em class="gv-chip gv-chip-epp"><i class="fas fa-hard-hat"></i> EPP</em>' : ''}</span>
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
  // ---------------------------------------------------------------- contacto con el anfitrión (sin cita)
  // El guardia llama (o escribe por WhatsApp) al anfitrión con un botón —el número no se muestra— y registra
  // el resultado; sin resultado no se habilita la entrada. Si no contesta, puede avisarle por el bot.
  const RES_CONTACTO = [
    ['viene', 'Contestó: viene a recibirlo', 'fa-person-walking'],
    ['espera', 'Contestó: que espere', 'fa-hourglass-half'],
    ['no_contesto', 'No contestó', 'fa-phone-slash'],
    ['equivocado', 'Número equivocado', 'fa-circle-xmark']
  ];
  const TXT_CONTACTO = { viene: 'Viene a recibirlo', espera: 'Pidió que espere', no_contesto: 'No contestó', equivocado: 'Número equivocado', sin_telefono: 'Sin celular registrado' };
  const contactoLogrado = r => r === 'viene' || r === 'espera';
  const ctoLocal = k => (st.cto[k] = st.cto[k] || { medio: '', intentos: 0, resultado: '', enviando: '' });
  // Resultado vigente: el del servidor o, en contingencia, el que se anotó en esta terminal
  function resultadoContacto(k, llamada) { return (llamada && llamada.resultado) || ctoLocal(k).resultado || ''; }

  function contactoHtml(k, o) {
    const l = ctoLocal(k), llamada = o.llamada || null;
    const res = resultadoContacto(k, llamada);
    const intentos = Math.max((llamada && llamada.intentos) || 0, l.intentos);
    const tel = String(o.tel || '').replace(/\D/g, '');
    const msg = encodeURIComponent(`Hola, le saluda portería de TCONTROL. ${o.visitante || 'Su visitante'}${o.empresa ? ` (${o.empresa})` : ''} está en portería y viene a visitarle. ¿Puede acercarse a recibirlo?`);
    const ocupado = !!l.enviando;
    const botones = tel
      ? `<div class="gv-cto-botones">
          <a class="gv-cto-btn gv-cto-llamar ${l.medio === 'llamada' ? 'on' : ''}" href="tel:+${tel}" data-gv="cto-medio" data-k="${esc(k)}" data-medio="llamada"><i class="fas fa-phone"></i> Llamar</a>
          <a class="gv-cto-btn gv-cto-wa ${l.medio === 'whatsapp' ? 'on' : ''}" href="https://wa.me/${tel}?text=${msg}" target="_blank" rel="noopener" data-gv="cto-medio" data-k="${esc(k)}" data-medio="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</a></div>`
      : `<p class="gv-cto-sin"><i class="fas fa-phone-slash"></i> ${esc(o.anfitrion || 'El anfitrión')} no tiene celular registrado (tampoco le llegan avisos por WhatsApp). Búsquelo por la extensión o pida a alguien de su área que le avise.</p>`;
    const opciones = tel ? RES_CONTACTO : [['sin_telefono', 'Sin celular: no pude llamarlo', 'fa-phone-slash']];
    const habilitadas = !tel || !!l.medio;
    const resultados = `<p class="gv-cto-preg">${habilitadas ? '¿Qué pasó?' : 'Primero toque <b>Llamar</b> o <b>WhatsApp</b>; después elija qué pasó.'}</p>
      <div class="gv-cto-res">${opciones.map(([id, txt, ico]) => `<button type="button" class="gv-cto-op ${res === id && !l.medio ? 'on' : ''}" data-gv="cto-res" data-k="${esc(k)}" data-res="${id}" ${habilitadas && !ocupado ? '' : 'disabled'}>
        ${l.enviando === id ? SPIN : `<i class="fas ${ico}"></i>`}<span>${txt}</span></button>`).join('')}</div>`;
    const hecho = res ? `<div class="gv-cto-hecho ${contactoLogrado(res) ? 'ok' : 'alerta'}"><i class="fas ${contactoLogrado(res) ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
        <span><strong>${esc(TXT_CONTACTO[res] || res)}</strong><small>${intentos} intento${intentos === 1 ? '' : 's'}${llamada && llamada.en ? ' · ' + horaDe(llamada.en) : ''}${llamada && llamada.bot ? ' · aviso por bot ' + horaDe(llamada.bot) : ''}</small></span></div>` : '';
    // El bot escribe al mismo celular: sin número no sirve
    const bot = res && !contactoLogrado(res) && o.puedeBot && tel
      ? `<button type="button" class="vs-btn gv-cto-bot" data-gv="cto-bot" data-k="${esc(k)}" ${ocupado ? 'disabled' : ''}>${l.enviando === 'bot' ? SPIN : '<i class="fas fa-robot"></i>'} Avisar por el bot de WhatsApp</button>
         <p class="gv-cto-nota">Le enviamos un WhatsApp urgente desde el número de TCONTROL. Puede volver a llamar cuando quiera.</p>` : '';
    const sinContacto = res && !contactoLogrado(res)
      ? '<p class="gv-cto-nota"><i class="fas fa-info-circle"></i> Si decide dejarlo pasar sin hablar con el anfitrión, quedará registrado como <b>«Ingresó sin contacto»</b>.</p>' : '';
    return `<div class="gv-contacto ${res ? (contactoLogrado(res) ? 'gv-cto-listo' : 'gv-cto-fallo') : ''}">
      <div class="gv-cto-cab"><i class="fas fa-phone-volume"></i><span><strong>Avise a ${esc(o.anfitrion || 'la persona que visita')}</strong><small>Llámelo para que se acerque a recibir a ${esc(o.visitante || 'su visitante')}.</small></span></div>
      ${hecho}${botones}${resultados}${bot}${sinContacto}</div>`;
  }

  async function registrarContacto(k, codigo, medio, resultado) {
    const l = ctoLocal(k);
    if (l.enviando) return;
    // Contingencia o formulario (sin código del servidor): se anota en esta terminal y viaja con el registro
    if (!codigo || st.contingencia) {
      l.intentos++; l.resultado = resultado; l.medio = '';
      return repintarContacto();
    }
    l.enviando = medio === 'bot' ? 'bot' : resultado; repintarContacto();
    try {
      const r = await rpc({ accion: 'contacto', codigo, medio: medio === 'bot' ? 'bot' : (l.medio || 'llamada'), resultado });
      if (!r.ok) throw new Error(r.error);
      l.medio = '';
      if (st.ficha && st.ficha.visita.codigo === codigo) st.ficha.visita = r.visita;
      if (st.sc && st.sc.visita && st.sc.visita.codigo === codigo) st.sc.visita = r.visita;
      if (medio === 'bot' && typeof window.mostrarToast === 'function') window.mostrarToast('Aviso enviado al anfitrión por el bot de WhatsApp.', 'success');
    } catch (e) {
      if (typeof window.mostrarToast === 'function') window.mostrarToast(e.message, 'error');
    }
    l.enviando = '';
    repintarContacto();
  }
  function repintarContacto() { if (st.sc) pintarModal(); else pintarPrincipal(); }

  const PASOS_SC = [
    ['¿Para qué es la visita?', 'Elija la opción que mejor describe a qué viene.'],
    ['¿A quién visita?', 'Pregúntele el nombre de la persona y búsquela.'],
    ['Datos del visitante', 'Tal como aparecen en su documento de identidad.'],
    ['Revise y confirme', 'Verifique la cédula y léale el aviso de datos. Luego llamará al anfitrión.']
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
    } else if (sc.modo === 'calificar') {
      // Al registrar la salida: QR con el enlace privado de la visita para que el visitante la califique
      cab = `<h2>¡Gracias por su visita!</h2>`;
      cuerpo = `<div class="gv-m-qr">
          <p class="gv-m-pregunta" style="text-align:center">${esc(sc.nombre || 'Visitante')}, ¿nos califica?</p>
          <p class="gv-m-ayuda" style="text-align:center">Pídale que escanee este código con la cámara de su celular. Toma un minuto.</p>
          <div class="gv-qr-grande">${qrGrande(sc.url)}</div>
          <p class="gv-reloj"><i class="fas fa-star" style="color:#f59e0b"></i> Atención · Puntualidad · Instalaciones</p>
        </div>`;
      pie = `<button type="button" class="btn-large btn-success gv-m-prim" data-gv="sc-terminar"><i class="fas fa-check"></i> Listo</button>`;
    } else if (sc.modo === 'contacto') {
      // Sin cita registrado: ya se avisó al anfitrión; el guardia lo llama y luego registra la entrada
      const v = sc.visita || {}, res = resultadoContacto(v.codigo, v.llamada);
      cab = `<h2>Avise al anfitrión</h2>`;
      cuerpo = `<p class="gv-m-aviso" style="margin-top:0"><i class="fas fa-bell"></i> <b>${esc(v.nombre || '')}</b> quedó registrado en portería y ya se avisó a ${esc(v.anfitrion || 'la persona que visita')} por la app y WhatsApp.</p>
        ${contactoHtml(v.codigo, { tel: v.anfitrionTel, visitante: v.nombre, empresa: v.empresa, anfitrion: v.anfitrion, llamada: v.llamada, puedeBot: !st.contingencia })}
        ${sc.error ? `<div class="vs-error" role="alert"><i class="fas fa-exclamation-circle"></i> ${esc(sc.error)}</div>` : ''}${sc.enviando ? LENTO : ''}`;
      pie = `<button type="button" class="vs-btn" data-gv="sc-terminar" ${sc.enviando ? 'disabled' : ''}>Después</button>
        <button type="button" class="btn-large btn-success gv-m-prim ${res ? '' : 'gv-btn-bloq'}" data-gv="sc-entrada" ${res && !sc.enviando ? '' : 'disabled'}>${sc.enviando ? SPIN + ' Registrando entrada…' : `<i class="fas fa-sign-in-alt"></i> ${res && !contactoLogrado(res) ? 'Dejar pasar sin contacto' : 'Registrar entrada'}`}</button>`;
    } else if (sc.modo === 'listo') {
      const v = sc.visita || {};
      cab = `<h2>Visitante registrado</h2>`;
      cuerpo = `<div class="gv-m-listo"><div class="gv-m-exito"><i class="fas fa-check"></i></div>
          <p class="gv-m-pregunta">¡Listo! Entrada registrada</p>
          <p class="gv-m-listo-nombre">${esc(v.nombre || '')}</p>
          <p class="vs-muted">${esc(v.empresa || '')} · visita a ${esc(v.anfitrion || 'área encargada')} · ${horaDe(v.entradaEn || Date.now())}</p>
          ${v.sinContacto ? '<p class="gv-m-aviso gv-m-aviso-alerta"><i class="fas fa-phone-slash"></i> Quedó registrado como «Ingresó sin contacto con el anfitrión».</p>' : ''}
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
          ${check('acepta', '<strong>Se lo leí y estuvo de acuerdo</strong>')}
          ${st.contingencia ? contactoHtml('form', { tel: f.anfitrion && f.anfitrion.tel, visitante: f.nombre, empresa: f.empresa, anfitrion: f.anfitrion ? f.anfitrion.nombre : 'el área encargada', puedeBot: false }) : ''}`;
        pie = `<button type="submit" class="btn-large btn-success gv-m-prim" ${sc.enviando ? 'disabled' : ''}>${sc.enviando ? SPIN + ' Registrando…' : st.contingencia ? '<i class="fas fa-sign-in-alt"></i> Registrar e ingresar' : '<i class="fas fa-bell"></i> Registrar y avisar al anfitrión'}</button>`;
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
    if (fueraHorario()) { sc.error = msgHorario(); return pintarModal(); }
    const cto = ctoLocal('form');
    if (st.contingencia && !cto.resultado) { sc.error = 'Llame al anfitrión y elija qué pasó antes de registrar.'; return pintarModal(); }
    sc.enviando = true; sc.error = ''; pintarModal();
    try {
      sc.idRespaldo = sc.idRespaldo || nuevoId();   // mismo id si se reintenta: el respaldo no lo duplica
      const r = await rpc({ accion: 'registrar', id: sc.idRespaldo, tipo: t.id, anfitrionId: f.anfitrion ? f.anfitrion.id : '', nombre: f.nombre, empresa: f.empresa, motivo: f.motivo,
        documentoVerificado: true, aceptaVerbal: true, eppVerificado: !!f.epp,
        contacto: cto.resultado ? { resultado: cto.resultado, intentos: cto.intentos } : undefined });
      if (!r.ok) throw new Error(r.error);
      delete st.cto.form;
      // En línea queda en portería: paso de contacto y después la entrada. En contingencia ya ingresó.
      st.sc = r.visita.estado === 'aprobada' ? { modo: 'contacto', visita: r.visita, f } : { modo: 'listo', visita: r.visita };
      pintarModal();
      cargar();
    } catch (e) { sc.enviando = false; sc.error = e.message; pintarModal(); }
  }

  async function entradaTrasContacto() {
    const sc = st.sc, v = sc.visita, f = sc.f || {};
    if (sc.enviando) return;
    if (fueraHorario()) { sc.error = msgHorario(); return pintarModal(); }
    sc.enviando = true; sc.error = ''; pintarModal();
    try {
      const l = st.cto[v.codigo];
      const r = await rpc({ accion: 'entrada', codigo: v.codigo, documentoVerificado: true, eppVerificado: !!f.epp,
        contacto: l && l.resultado ? { resultado: l.resultado, intentos: l.intentos } : undefined });
      if (!r.ok) throw new Error(r.error);
      st.sc = { modo: 'listo', visita: r.visita };
      pintarModal(); cargar();
    } catch (e) { sc.enviando = false; sc.error = e.message; pintarModal(); }
  }

  function fichaHtml(f) {
    const v = f.visita;
    const hoy = f.hoy;
    let aviso = '', accion = '';
    if (v.estado === 'aprobada' && v.fecha === hoy && fueraHorario()) {
      aviso = esc(msgHorario());
    } else if (v.estado === 'aprobada' && v.fecha === hoy) {
      const sinCita = v.origen === 'porteria', res = sinCita ? resultadoContacto(v.codigo, v.llamada) : 'ok';
      accion = `${sinCita ? contactoHtml(v.codigo, { tel: v.anfitrionTel, visitante: v.nombre, empresa: v.empresa, anfitrion: v.anfitrion, llamada: v.llamada, puedeBot: !st.contingencia }) : ''}
        <label class="vs-check" style="margin-top:12px"><input type="checkbox" id="gvDoc"><span><strong>Verifiqué su documento de identidad</strong> y coincide con el nombre (no se registra el número).</span></label>
        ${v.epp ? `<label class="vs-check"><input type="checkbox" id="gvEpp"><span><strong>Lleva el EPP obligatorio</strong> para planta.</span></label>` : ''}
        <button class="btn-large btn-success ${!res ? 'gv-btn-bloq' : ''}" data-gv="entrada" data-cod="${esc(v.codigo)}" ${st.registrando || !res ? 'disabled' : ''}>${st.registrando === 'entrada' ? SPIN + ' Registrando entrada…' : !res ? '<i class="fas fa-lock"></i> Primero avise al anfitrión' : `<i class="fas fa-sign-in-alt"></i> ${sinCita && !contactoLogrado(res) ? 'Dejar pasar sin contacto' : 'Registrar entrada'}`}</button>`;
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
  // Lector: BarcodeDetector nativo si existe y funciona; si falla (en varios equipos existe pero no lee
  // y el error se perdía), jsQR. jsQR viene del propio sitio (JS/vendor); si no llegó, se pide a un CDN. Los cuadros se
  // reducen (más rápido) y se alterna con un recorte central a más resolución (QR pequeño en la pantalla
  // de un celular); se prueba también el QR invertido (celulares con modo oscuro forzado).
  let detector = null, bucle = null, fallosDetector = 0, cargaJsQR = null;
  const CDN_JSQR = ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js', 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'];
  function asegurarJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve(true);
    if (cargaJsQR) return cargaJsQR;
    cargaJsQR = (async () => {
      // El <script async> del HTML puede seguir llegando: se espera un poco antes de pedirlo a otro CDN
      for (let i = 0; i < 20 && typeof window.jsQR !== 'function'; i++) await new Promise(r => setTimeout(r, 150));
      for (const src of CDN_JSQR) {
        if (typeof window.jsQR === 'function') break;
        await new Promise(res => {
          const s = document.createElement('script');
          s.src = src; s.async = true; s.onload = res; s.onerror = res;
          setTimeout(res, 8000);
          document.head.appendChild(s);
        });
      }
      return typeof window.jsQR === 'function';
    })();
    return cargaJsQR;
  }
  async function crearDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      if (Array.isArray(formatos) && !formatos.includes('qr_code')) return null;
      return new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { return null; }
  }
  async function iniciarCamara() {
    const video = document.getElementById('gvVideo');
    if (!video || st.stream || st.abriendoCamara === 'pidiendo') return;
    st.abriendoCamara = 'pidiendo';
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
      });
      // Enfoque continuo donde la cámara lo permite (de cerca, la pantalla de un celular se ve borrosa)
      try {
        const pista = st.stream.getVideoTracks()[0];
        const cap = pista.getCapabilities ? pista.getCapabilities() : {};
        if (cap.focusMode && cap.focusMode.includes('continuous')) await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (e) { }
      video.srcObject = st.stream;
      await video.play();
      st.abriendoCamara = false;
      const aviso = video.parentNode && video.parentNode.querySelector('.gv-scan-cargando'); if (aviso) aviso.remove();
      detector = await crearDetector();
      fallosDetector = 0;
      if (!detector) asegurarJsQR();
      const lienzo = document.createElement('canvas');
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      const inicio = Date.now();
      let cuadro = 0;
      const leerJsQR = () => {
        if (typeof window.jsQR !== 'function') return '';
        const vw = video.videoWidth, vh = video.videoHeight;
        // Cuadros pares: imagen completa reducida a 640 px; impares: recorte central sin reducir
        let sx = 0, sy = 0, sw = vw, sh = vh;
        if (cuadro % 2) { sw = Math.round(vw * 0.6); sh = Math.round(vh * 0.6); sx = Math.round((vw - sw) / 2); sy = Math.round((vh - sh) / 2); }
        const escala = Math.min(1, 640 / Math.max(sw, sh));
        lienzo.width = Math.round(sw * escala); lienzo.height = Math.round(sh * escala);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
        const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        return r ? r.data : '';
      };
      const leer = async () => {
        if (!st.escaneando) return;
        if (!video.videoWidth) { bucle = setTimeout(leer, 150); return; }
        cuadro++;
        let texto = '';
        if (detector) {
          try {
            const r = await detector.detect(video);
            if (r && r[0]) texto = r[0].rawValue;
            fallosDetector = 0;
          } catch (e) {
            // Existe pero no funciona en este equipo: se pasa a jsQR
            if (++fallosDetector >= 3) { console.warn('BarcodeDetector falla, se usa jsQR:', e && e.message); detector = null; asegurarJsQR(); }
          }
        } else {
          try { texto = leerJsQR(); } catch (e) { }
        }
        if (!st.escaneando) return;
        if (Date.now() - inicio > 8000) {
          const ayuda = video.parentNode && video.parentNode.querySelector('.gv-scan-ayuda');
          if (ayuda) ayuda.hidden = false;
        }
        if (!detector && typeof window.jsQR !== 'function' && cargaJsQR && Date.now() - inicio > 12000) {
          const ok = await cargaJsQR;
          if (!ok) {
            detenerCamara();
            st.error = 'No se pudo cargar el lector de QR en este equipo (revise la conexión). Escriba el código de 8 caracteres del visitante.';
            pintar();
            return;
          }
        }
        if (texto && /^TCV1:[A-Z0-9]{8}$/i.test(texto.trim())) {
          if (navigator.vibrate) navigator.vibrate(120);
          detenerCamara();
          buscar(texto.trim());
          return;
        }
        bucle = setTimeout(leer, detector ? 150 : 90);
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
        if (r.horario && r.horario.apertura && r.horario.cierre) st.horario = r.horario;
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
      const l = st.cto[codigo];
      if (l && l.resultado) p.contacto = { resultado: l.resultado, intentos: l.intentos };
    }
    if (st.registrando) return;
    st.registrando = accion; pintarPrincipal();
    try {
      const r = await rpc(p);
      if (!r.ok) throw new Error(r.error);
      st.ficha = null; st.error = ''; st.registrando = '';
      if (typeof window.mostrarToast === 'function') window.mostrarToast(accion === 'entrada' ? `Entrada registrada: ${r.visita.nombre}` : `Salida registrada: ${r.visita.nombre}`, 'success');
      // Salida: QR para que el visitante califique la visita (enlace nuevo que genera el servidor)
      if (accion === 'salida' && r.calificar) {
        st.sc = { modo: 'calificar', nombre: r.visita.nombre, url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}visitas.html#t=${r.calificar}` };
        pintarModal();
        const abierto = st.sc;
        setTimeout(() => { if (st.sc === abierto) cerrarModal(true); }, 3 * 60 * 1000);
      }
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
    if (a === 'sc-abrir' && fueraHorario()) { if (typeof window.mostrarToast === 'function') window.mostrarToast(msgHorario(), 'warning'); return; }
    if (a === 'sc-abrir' || a === 'sc-elegir' || a === 'sc-otro') {
      clearInterval(tReloj);
      // En contingencia no hay QR de portería (lo genera el servidor): el guardia lo registra
      st.sc = st.contingencia ? { modo: 'form', paso: 1, f: {} } : { modo: 'elegir' };
      return pintarModal();
    }
    if (a === 'cto-medio') { ctoLocal(b.dataset.k).medio = b.dataset.medio; setTimeout(repintarContacto, 300); return; }
    if (a === 'cto-res' || a === 'cto-bot') {
      const k = b.dataset.k, cod = k === 'form' ? '' : k;
      return registrarContacto(k, cod, a === 'cto-bot' ? 'bot' : ctoLocal(k).medio, b.dataset.res || '');
    }
    if (a === 'sc-entrada') return entradaTrasContacto();
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
