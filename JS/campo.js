/**
 * Trabajo en campo por proyectos (JS/campo.js)
 *
 * - TTHH (o un supervisor admin) crea el proyecto, arma la cuadrilla y designa al ENCARGADO.
 * - La marcación de asistencia de cada colaborador NO cambia (modo CAMPO de la app). Aquí solo se agrupa
 *   por proyecto: la pestaña «Campo» del Supervisor cruza la cuadrilla con los registros del día.
 * - El encargado confirma el día con fotografías tomadas con la cámara de la app (sin galería): cada foto guarda
 *   la hora del servidor, la hora del teléfono y el GPS con su precisión, y se estampan sobre la imagen.
 *
 * Datos (Firestore):
 *   campo_proyectos/{auto}     { nombre, lugar, desde, hasta, estado ACTIVO|CERRADO, encargado_id, encargado_nombre,
 *                                cuadrilla:[{id,nombre}], cuadrilla_ids:[id], creado_por, creado_en }
 *   campo_fotos/{idLocal}      { proyectoId, fecha, encargadoId, foto (JPEG base64 limpio, hasta 1600 px, reutilizable),
 *                                lat, lng, precision, descripcion, ts_servidor, ts_cliente, diferida }
 *                              diferida = se tomó sin señal y se envió después; ts_cliente = hora de captura (teléfono)
 *   Sin señal: todo se guarda en IndexedDB del teléfono y se envía solo (sincronizarPendientes) al abrir la app,
 *   al volver la conexión, al volver a la pestaña y cada minuto; los proyectos del encargado quedan en localStorage.
 *   campo_dias/{proyectoId_fecha} { proyectoId, fecha, encargadoId, fotos, confirmado_en }  (confirma el lugar de trabajo del día)
 * Avisos: campana (colección notificaciones, enlace {modulo:'campo'}) y WhatsApp con datos mínimos (OpenWAService).
 *
 * Uso: Campo.montarPanel(contenedor, { usuario:{id,nombre}, admin })   Campo.montarApp(contenedor, { empleado })
 *      Campo.puedeGestionar(id, esAdmin) → Promise<bool>   Campo.esEncargado(id) → Promise<bool>
 */
(function () {
  'use strict';

  const COL_P = 'campo_proyectos', COL_F = 'campo_fotos', COL_D = 'campo_dias';
  const MAX_FOTO_ANCHO = 1600;      // fotos reutilizables en presentaciones (la regla de Firestore admite < 800 000 caracteres)
  const FOTO_MAX_CHARS = 700000;
  const DIF_RELOJ_MIN = 5;   // diferencia máxima aceptable entre la hora del teléfono y la del servidor

  // ---------------------------------------------------------------- utilidades
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const db = () => window.firebase.firestore();
  const pad = n => String(n).padStart(2, '0');
  const fechaStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoyStr = () => fechaStr(new Date());
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const nombreCorto = n => String(n || '').split(/\s+/).slice(0, 3).join(' ');
  const msDe = t => t && t.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0);
  const horaDe = ms => ms ? new Date(ms).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const toast = (m, t = 'info') => { const f = window.mostrarToast || window.showToast; if (typeof f === 'function') f(m, t); };
  const activo = e => e && String(e.activo == null ? 'SI' : e.activo).toUpperCase() !== 'NO' && e.activo !== false && String(e.estado || '').toUpperCase() !== 'INACTIVO';

  // ---------------------------------------------------------------- empleados y configuración
  let _emps = null, _empsEn = 0;
  async function empleados() {
    if (_emps && Date.now() - _empsEn < 120000) return _emps;
    const snap = await db().collection('empleados').get();
    _emps = [];
    snap.forEach(d => { const x = d.data() || {}; _emps.push({ id: String(x.id || d.id).trim(), nombre: x.nombre || '', area: x.area || '', cargo: x.cargo || '', telefono: x.telefono || '', activo: activo(x) }); });
    _emps.sort((a, b) => a.nombre.localeCompare(b.nombre));
    _empsEn = Date.now();
    return _emps;
  }
  async function leerEmpleado(id) {
    try { const s = await db().collection('empleados').doc(String(id)).get(); return s.exists ? Object.assign({ id: String(id) }, s.data()) : null; } catch (e) { return null; }
  }
  async function esTTHH(id) {
    try {
      const s = await db().collection('configuracion').doc('permisos').get();
      const l = s.exists && Array.isArray(s.data().tthh) ? s.data().tthh : [];
      return l.some(x => x && String(x.id) === String(id));
    } catch (e) { return false; }
  }
  async function puedeGestionar(id, esAdmin) {
    if (esAdmin || String(id) === '1058') return true;
    return esTTHH(id);
  }
  async function proyectosDeEncargado(id) {
    const snap = await db().collection(COL_P).where('encargado_id', '==', String(id)).get();
    const ps = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(p => p.estado !== 'CERRADO');
    guardarCache(id, ps);
    return ps;
  }
  async function esEncargado(id) {
    try { return (await proyectosDeEncargado(id)).length > 0; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- avisos (mínimos: nombre corto + ID, sin teléfonos)
  async function campana(para, titulo, texto, proyectoId, sufijo) {
    const FB = window.FirebaseBackend;
    if (!para || !FB || !FB.crearAvisoCampana) return;
    return FB.crearAvisoCampana({ para: String(para), tipo: 'campo_encargado', titulo, texto, enlace: { modulo: 'campo', id: proyectoId }, clave: `campo_${proyectoId}_${sufijo}_${para}` });
  }
  async function whatsapp(emp, texto) {
    const WA = window.OpenWAService;
    if (!WA || !emp || !emp.telefono) return { ok: false, error: 'sin teléfono' };
    try { const r = await WA.enviarMensajeTexto(emp.telefono, texto); return { ok: !(r && r.ok === false) }; } catch (e) { return { ok: false }; }
  }
  async function avisarEncargado(p, quien) {
    const t = `Eres el encargado del proyecto de campo «${p.nombre}» (${p.cuadrilla.length} personas, ${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}).`;
    await campana(p.encargado_id, 'Proyecto de campo asignado', `${p.nombre} · ${p.cuadrilla.length} personas · designó ${nombreCorto(quien)}`, p.id, 'asigna').catch(() => { });
    const e = await leerEmpleado(p.encargado_id);
    await whatsapp(e, `📍 ${t}\n\nConfirma cada día con fotografías en la app TCONTROL → *Más* → *Campo*.`);
  }

  // ---------------------------------------------------------------- lectura de proyectos, fotos y marcaciones
  async function listarProyectos() {
    const snap = await db().collection(COL_P).get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => String(b.desde).localeCompare(String(a.desde)));
  }
  async function fotosDia(pid, fecha) {
    const snap = await db().collection(COL_F).where('proyectoId', '==', pid).where('fecha', '==', fecha).get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => msDe(a.ts_servidor) - msDe(b.ts_servidor));
  }
  async function diaDoc(pid, fecha) {
    const s = await db().collection(COL_D).doc(`${pid}_${fecha}`).get();
    return s.exists ? s.data() : null;
  }
  // Marcaciones del día de la cuadrilla (la dinámica de marcación no cambia: solo se leen)
  async function marcacionesDia(p, fecha) {
    const snap = await db().collection('registros').where('fecha', '==', fecha).get();
    const ids = new Set(p.cuadrilla_ids || []);
    const por = {};
    snap.forEach(d => {
      const r = d.data() || {};
      const id = String(r.empleadoId || '');
      if (!ids.has(id)) return;
      (por[id] = por[id] || []).push(r);
    });
    return por;
  }
  const entradaDe = regs => (regs || []).filter(r => /ENTRADA/i.test(r.tipo || '')).sort((a, b) => String(a.hora).localeCompare(String(b.hora)))[0] || null;

  // ---------------------------------------------------------------- estilos de la fila de foto
  // Una foto guardada sin señal y enviada después (diferida) no se compara con el reloj del servidor: se marca aparte
  function relojOk(f) {
    if (f.diferida) return true;
    const s = msDe(f.ts_servidor), c = msDe(f.ts_cliente);
    return !s || !c || Math.abs(s - c) <= DIF_RELOJ_MIN * 60000;
  }
  function nombreArchivo(f, proyecto) {
    const d = new Date(msDe(f.ts_cliente) || msDe(f.ts_servidor) || Date.now());
    return `${proyecto || 'campo'}_${f.fecha || fechaStr(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`.replace(/[^A-Za-z0-9_-]+/g, '_') + '.jpg';
  }
  function fotoHtml(f, proyecto) {
    const mapa = f.lat != null && f.lng != null ? `https://www.google.com/maps?q=${f.lat},${f.lng}` : '';
    return `<figure class="cp-foto">
      <img src="${esc(f.foto)}" alt="Foto de campo" data-cp-ampliar>
      <figcaption>
        <b>${esc(horaDe(msDe(f.ts_cliente)) || horaDe(msDe(f.ts_servidor)))}</b>
        ${f.diferida ? `<span class="cp-chip" title="Se tomó sin internet y se envió cuando hubo señal">Sin internet al capturar · enviada ${esc(horaDe(msDe(f.ts_servidor)))}</span>` : ''}
        ${f.descripcion ? `<span class="cp-desc-txt">${esc(f.descripcion)}</span>` : ''}
        <a class="cp-desc" href="${esc(f.foto)}" download="${esc(nombreArchivo(f, proyecto))}" title="Descargar la foto original"><i class="fas fa-download"></i> Descargar</a>
        ${mapa ? `<a href="${mapa}" target="_blank" rel="noopener"><i class="fas fa-location-dot"></i> ${(+f.lat).toFixed(5)}, ${(+f.lng).toFixed(5)}</a>` : '<span class="cp-mal">Sin ubicación</span>'}
        ${f.precision != null ? `<span class="cp-peq">±${Math.round(f.precision)} m</span>` : ''}
        ${relojOk(f) ? '' : '<span class="cp-mal" title="La hora del teléfono no coincide con la del servidor">⚠ reloj distinto</span>'}
      </figcaption></figure>`;
  }
  function ampliar(src) {
    const o = document.createElement('div');
    o.className = 'cp-lightbox';
    o.innerHTML = `<img src="${esc(src)}" alt="">`;
    o.addEventListener('click', () => o.remove());
    document.body.appendChild(o);
  }
  function delegarAmpliar(cont) {
    cont.addEventListener('click', e => { const i = e.target.closest('[data-cp-ampliar]'); if (i) ampliar(i.src); });
  }

  // ================================================================ PANEL DEL SUPERVISOR
  function montarPanel(cont, opts) {
    const usuario = opts.usuario || {};
    // Borrar proyectos (con sus fotos) es solo del Admin Master y los supervisores admin; TTHH puede cerrarlos
    const st = { proyectos: [], puede: false, abierto: null, fecha: hoyStr(), admin: !!opts.admin || String(usuario.id) === '1058' };
    cont.classList.add('cp-raiz');
    if (!cont._cpDelegado) { delegarAmpliar(cont); cont._cpDelegado = true; }

    async function cargar() {
      cont.innerHTML = '<div class="cp-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando proyectos de campo…</div>';
      try {
        st.puede = await puedeGestionar(usuario.id, opts.admin);
        st.proyectos = await listarProyectos();
      } catch (e) { cont.innerHTML = `<div class="cp-vacio cp-mal">No se pudieron cargar los proyectos: ${esc(e.message || e)}</div>`; return; }
      if (st.abierto) { const p = st.proyectos.find(x => x.id === st.abierto); if (p) return detalle(p); st.abierto = null; }
      lista();
    }

    function lista() {
      const act = st.proyectos.filter(p => p.estado !== 'CERRADO'), cer = st.proyectos.filter(p => p.estado === 'CERRADO');
      const tarjeta = p => `<button type="button" class="cp-tarjeta${p.estado === 'CERRADO' ? ' cp-cerrado' : ''}" data-abrir="${esc(p.id)}">
        <div class="cp-tit"><i class="fas fa-helmet-safety"></i> ${esc(p.nombre)} ${p.estado === 'CERRADO' ? '<span class="cp-chip">Cerrado</span>' : ''}</div>
        <div class="cp-sub">${esc(p.lugar || 'Sin lugar indicado')}</div>
        <div class="cp-meta"><span><i class="fas fa-calendar"></i> ${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}</span>
          <span><i class="fas fa-user-tie"></i> ${esc(nombreCorto(p.encargado_nombre))} (${esc(p.encargado_id)})</span>
          <span><i class="fas fa-users"></i> ${(p.cuadrilla || []).length}</span></div></button>`;
      cont.innerHTML = `<div class="cp-cab"><div><h3><i class="fas fa-helmet-safety"></i> Trabajo en campo por proyectos</h3>
          <p>Cada proyecto tiene un encargado designado por TTHH que confirma a la cuadrilla con fotografías (hora, fecha y ubicación automáticas).</p></div>
          ${st.puede ? '<button type="button" class="cp-btn cp-btn-pri" data-nuevo><i class="fas fa-plus"></i> Nuevo proyecto</button>' : ''}</div>
        ${act.length ? `<div class="cp-grid">${act.map(tarjeta).join('')}</div>` : '<div class="cp-vacio">No hay proyectos de campo activos.</div>'}
        ${cer.length ? `<details class="cp-cerrados"><summary>Proyectos cerrados (${cer.length})</summary><div class="cp-grid">${cer.map(tarjeta).join('')}</div></details>` : ''}`;
      cont.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { st.abierto = b.dataset.abrir; st.fecha = hoyStr(); detalle(st.proyectos.find(p => p.id === st.abierto)); });
      const n = cont.querySelector('[data-nuevo]'); if (n) n.onclick = () => editor(null);
    }

    async function detalle(p) {
      cont.innerHTML = '<div class="cp-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando el día…</div>';
      let fotos = [], marcas = {}, dia = null;
      try { [fotos, marcas, dia] = await Promise.all([fotosDia(p.id, st.fecha), marcacionesDia(p, st.fecha), diaDoc(p.id, st.fecha)]); }
      catch (e) { toast('No se pudo leer el día: ' + (e.message || e), 'error'); }
      const filas = (p.cuadrilla || []).map(c => {
        const regs = marcas[c.id] || [], ent = entradaDe(regs);
        const campo = regs.some(r => String(r.modo || '').toUpperCase() === 'CAMPO');
        return `<tr><td><b>${esc(nombreCorto(c.nombre))}</b> <span class="cp-peq">${esc(c.id)}</span></td>
          <td>${ent ? `<span class="cp-ok">${esc(String(ent.hora).slice(0, 5))}</span>${campo ? ' <span class="cp-chip">CAMPO</span>' : ''}` : '<span class="cp-mal">Sin marcar</span>'}</td></tr>`;
      }).join('');
      const marcaron = (p.cuadrilla || []).filter(c => entradaDe(marcas[c.id])).length;
      cont.innerHTML = `<div class="cp-cab"><div><button type="button" class="cp-btn" data-volver><i class="fas fa-arrow-left"></i> Proyectos</button>
          <h3><i class="fas fa-helmet-safety"></i> ${esc(p.nombre)} ${p.estado === 'CERRADO' ? '<span class="cp-chip">Cerrado</span>' : ''}</h3>
          <p>${esc(p.lugar || '')} · Encargado: <b>${esc(nombreCorto(p.encargado_nombre))}</b> (${esc(p.encargado_id)}) · ${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}</p></div>
          <div class="cp-acc"><input type="date" class="cp-input" value="${esc(st.fecha)}" data-fecha>
            ${st.puede ? '<button type="button" class="cp-btn" data-editar><i class="fas fa-pen"></i> Editar</button>' : ''}
            ${st.admin ? '<button type="button" class="cp-btn cp-btn-peligro-suave" data-eliminar><i class="fas fa-trash"></i> Eliminar</button>' : ''}</div></div>
        <div class="cp-resumen"><div><b>${marcaron}/${(p.cuadrilla || []).length}</b><span>marcaron</span></div>
          <div><b>${fotos.length}</b><span>fotos</span></div>
          <div><b class="${dia ? 'cp-ok' : 'cp-mal'}">${dia ? 'Sí' : 'No'}</b><span>lugar confirmado por el encargado${dia ? ' · ' + esc(horaDe(msDe(dia.confirmado_en))) : ''}</span></div></div>
        <div class="cp-tabla-wrap"><table class="cp-tabla"><thead><tr><th>Colaborador</th><th>Marcación del día</th></tr></thead><tbody>${filas || '<tr><td colspan="2">Sin cuadrilla</td></tr>'}</tbody></table></div>
        <h4 class="cp-h4">Fotografías del ${fechaCorta(st.fecha)}</h4>
        ${fotos.length ? `<div class="cp-fotos">${fotos.map(f => fotoHtml(f, p.nombre)).join('')}</div>` : '<div class="cp-vacio">Sin fotografías ese día.</div>'}`;
      cont.querySelector('[data-volver]').onclick = () => { st.abierto = null; lista(); };
      cont.querySelector('[data-fecha]').onchange = e => { if (e.target.value) { st.fecha = e.target.value; detalle(p); } };
      const ed = cont.querySelector('[data-editar]'); if (ed) ed.onclick = () => editor(p);
      const el = cont.querySelector('[data-eliminar]'); if (el) el.onclick = () => eliminar(p);
    }

    // ---- eliminar proyecto (solo admin). Validaciones: se revisa qué se perdería, si hay fotos o días confirmados se exige
    // escribir el nombre del proyecto, se borra por lotes (fotos → días → proyecto, para poder reintentar si se corta) y
    // queda un registro en «logs». Las reglas de Firestore repiten la restricción: solo master y admin borran campo_*.
    async function eliminar(p) {
      if (!st.admin) return toast('Solo el Admin Master o un supervisor admin puede eliminar proyectos', 'warning');
      let nDias = 0, hayFotos = false, fotosDias = 0;
      try {
        const [dsnap, fsnap] = await Promise.all([
          db().collection(COL_D).where('proyectoId', '==', p.id).get(),
          db().collection(COL_F).where('proyectoId', '==', p.id).limit(1).get()]);
        nDias = dsnap.size; dsnap.forEach(d => { fotosDias += Number(d.data().fotos) || 0; }); hayFotos = !fsnap.empty;
      } catch (e) { return toast('No se pudo revisar el proyecto antes de eliminarlo: ' + (e.message || e), 'error'); }
      const hayDatos = hayFotos || nDias > 0;
      const ov = document.createElement('div');
      ov.className = 'cp-modal';
      ov.innerHTML = `<div class="cp-modal-caja" role="dialog" aria-modal="true">
        <h3><i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Eliminar proyecto</h3>
        <p style="margin:0;font-size:13px">Vas a eliminar <b>${esc(p.nombre)}</b> (encargado: ${esc(nombreCorto(p.encargado_nombre))}, ${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}).</p>
        <ul class="cp-lista-elim">
          <li>${hayFotos ? `<b>Tiene fotografías${fotosDias ? ` (unas ${fotosDias} según las confirmaciones)` : ''}</b>: se borrarán todas.` : 'No tiene fotografías.'}</li>
          <li>${nDias ? `<b>${nDias} día(s) confirmado(s)</b> por el encargado se borrarán.` : 'No tiene días confirmados.'}</li>
          <li>Las marcaciones de asistencia del personal <b>no se tocan</b>.</li></ul>
        <div class="cp-aviso">No se puede deshacer. Si el proyecto ya terminó, mejor ciérralo (Editar → «Proyecto cerrado») y conserva las fotos.${hayFotos ? ' Si vas a usar alguna foto, descárgala antes.' : ''}</div>
        ${hayDatos ? `<label>Para confirmar, escribe el nombre del proyecto: <b>${esc(p.nombre)}</b><input class="cp-input" id="cpConfirmaNombre" autocomplete="off" placeholder="Nombre del proyecto"></label>` : ''}
        <div class="cp-modal-pie"><button type="button" class="cp-btn" data-x>Cancelar</button><button type="button" class="cp-btn cp-btn-peligro" data-ok${hayDatos ? ' disabled' : ''}><i class="fas fa-trash"></i> Eliminar definitivamente</button></div></div>`;
      document.body.appendChild(ov);
      const ok = ov.querySelector('[data-ok]'), caja = ov.querySelector('#cpConfirmaNombre');
      const igual = () => !caja || norm(caja.value).trim() === norm(p.nombre).trim();
      if (caja) { caja.oninput = () => { ok.disabled = !igual(); }; caja.focus(); }
      ov.querySelector('[data-x]').onclick = () => ov.remove();
      ok.onclick = async () => {
        if (!igual()) return;
        ok.disabled = true; ov.querySelector('[data-x]').disabled = true; ok.textContent = 'Eliminando…';
        const borraLote = async (col) => {
          let n = 0;
          for (let i = 0; i < 500; i++) {   // tope de seguridad
            const s = await db().collection(col).where('proyectoId', '==', p.id).limit(20).get();
            if (s.empty) break;
            const b = db().batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit(); n += s.size;
          }
          return n;
        };
        try {
          const fotos = await borraLote(COL_F);
          const dias = await borraLote(COL_D);
          await db().collection(COL_P).doc(p.id).delete();
          db().collection('logs').add({ tipo: 'CAMPO_PROYECTO_ELIMINADO', proyectoId: p.id, nombre: p.nombre, encargado_id: p.encargado_id, fotos, dias,
            por: usuario.id, fecha: new Date().toISOString(), timestamp: window.firebase.firestore.FieldValue.serverTimestamp() }).catch(() => { });
          ov.remove(); toast(`Proyecto eliminado (${fotos} foto(s), ${dias} día(s))`, 'success');
          st.abierto = null; cargar();
        } catch (e) {
          ok.disabled = !igual(); ov.querySelector('[data-x]').disabled = false; ok.innerHTML = '<i class="fas fa-trash"></i> Eliminar definitivamente';
          const permiso = e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
          toast(permiso ? 'Firestore no permite borrar: faltan publicar las reglas nuevas de Campo (borrado solo para admin).' : 'No se pudo eliminar: ' + (e.message || e), 'error');
        }
      };
    }

    // ---- editor de proyecto (TTHH / supervisor admin)
    async function editor(p) {
      const emps = (await empleados()).filter(e => e.activo);
      const nuevo = !p;
      const d = p ? JSON.parse(JSON.stringify(p)) : { nombre: '', lugar: '', desde: hoyStr(), hasta: hoyStr(), estado: 'ACTIVO', encargado_id: '', encargado_nombre: '', cuadrilla: [] };
      const sel = new Map((d.cuadrilla || []).map(c => [c.id, c.nombre]));
      const ov = document.createElement('div');
      ov.className = 'cp-modal';
      ov.innerHTML = `<div class="cp-modal-caja" role="dialog" aria-modal="true">
        <h3>${nuevo ? 'Nuevo proyecto de campo' : 'Editar proyecto'}</h3>
        <label>Nombre del proyecto<input class="cp-input" id="cpNombre" maxlength="80" value="${esc(d.nombre)}"></label>
        <label>Lugar / referencia<input class="cp-input" id="cpLugar" maxlength="120" value="${esc(d.lugar)}"></label>
        <div class="cp-fila2"><label>Desde<input type="date" class="cp-input" id="cpDesde" value="${esc(d.desde)}"></label>
          <label>Hasta<input type="date" class="cp-input" id="cpHasta" value="${esc(d.hasta)}"></label></div>
        <label>Encargado de confirmar (con fotografías)<select class="cp-input" id="cpEnc"><option value="">— elegir —</option>
          ${emps.map(e => `<option value="${esc(e.id)}"${e.id === d.encargado_id ? ' selected' : ''}>${esc(e.nombre)} (${esc(e.id)})</option>`).join('')}</select></label>
        <label>Cuadrilla <span class="cp-peq" id="cpCuenta"></span><input class="cp-input" id="cpBuscar" placeholder="Buscar por nombre, ID o área…"></label>
        <div class="cp-lista" id="cpLista"></div>
        ${nuevo ? '' : `<label class="cp-check"><input type="checkbox" id="cpCerrar"${d.estado === 'CERRADO' ? ' checked' : ''}> Proyecto cerrado</label>`}
        <div class="cp-modal-pie"><button type="button" class="cp-btn" data-x>Cancelar</button><button type="button" class="cp-btn cp-btn-pri" data-ok>Guardar</button></div></div>`;
      document.body.appendChild(ov);
      const $ = s => ov.querySelector(s);
      const pintar = () => {
        const q = norm($('#cpBuscar').value);
        const vis = emps.filter(e => sel.has(e.id) || !q || norm(`${e.nombre} ${e.id} ${e.area}`).includes(q)).slice(0, 80);
        $('#cpLista').innerHTML = vis.map(e => `<label class="cp-item"><input type="checkbox" data-id="${esc(e.id)}"${sel.has(e.id) ? ' checked' : ''}> ${esc(e.nombre)} <span class="cp-peq">${esc(e.id)} · ${esc(e.area)}</span></label>`).join('') || '<div class="cp-vacio">Sin coincidencias</div>';
        $('#cpCuenta').textContent = `(${sel.size} elegidas)`;
      };
      $('#cpBuscar').oninput = pintar;
      $('#cpLista').onchange = e => { const c = e.target.closest('[data-id]'); if (!c) return; const emp = emps.find(x => x.id === c.dataset.id); c.checked ? sel.set(emp.id, emp.nombre) : sel.delete(emp.id); $('#cpCuenta').textContent = `(${sel.size} elegidas)`; };
      pintar();
      $('[data-x]').onclick = () => ov.remove();
      $('[data-ok]').onclick = async () => {
        const nombre = $('#cpNombre').value.trim(), desde = $('#cpDesde').value, hasta = $('#cpHasta').value, encId = $('#cpEnc').value;
        if (!nombre) return toast('Escribe el nombre del proyecto', 'warning');
        if (!desde || !hasta || hasta < desde) return toast('Revisa las fechas: «Hasta» no puede ser anterior a «Desde»', 'warning');
        if (!encId) return toast('Elige al encargado del proyecto', 'warning');
        if (!sel.size) return toast('Elige al menos una persona de la cuadrilla', 'warning');
        const enc = emps.find(e => e.id === encId);
        const reg = {
          nombre, lugar: $('#cpLugar').value.trim(), desde, hasta,
          estado: ov.querySelector('#cpCerrar') && ov.querySelector('#cpCerrar').checked ? 'CERRADO' : 'ACTIVO',
          encargado_id: encId, encargado_nombre: enc ? enc.nombre : '',
          cuadrilla: [...sel].map(([id, n]) => ({ id, nombre: n })), cuadrilla_ids: [...sel.keys()],
          actualizado_por: usuario.id, actualizado_en: new Date().toISOString()
        };
        const btn = $('[data-ok]'); btn.disabled = true;
        try {
          let ref;
          if (nuevo) { reg.creado_por = usuario.id; reg.creado_en = new Date().toISOString(); ref = db().collection(COL_P).doc(); await ref.set(reg); }
          else { ref = db().collection(COL_P).doc(p.id); await ref.set(reg, { merge: true }); }
          const fin = Object.assign({ id: ref.id }, reg);
          if (reg.estado === 'ACTIVO' && (nuevo || encId !== p.encargado_id)) avisarEncargado(fin, usuario.nombre).catch(() => { });
          ov.remove(); toast('Proyecto guardado', 'success'); st.abierto = ref.id; cargar();
        } catch (e) { btn.disabled = false; toast('No se pudo guardar: ' + (e.message || e), 'error'); }
      };
    }

    cargar();
  }

  // ================================================================ COLA SIN CONEXIÓN
  // Fotos y confirmaciones se guardan primero en el teléfono (IndexedDB) y se envían SOLAS cuando hay señal:
  // al abrir la app, al volver la conexión, al volver a la pestaña y cada minuto. El usuario no interviene.
  const IDB_NOMBRE = 'tcontrol_campo', IDB_STORE = 'pendientes';
  function idb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('Este navegador no puede guardar fotos sin conexión'));
      const r = indexedDB.open(IDB_NOMBRE, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE, { keyPath: 'idLocal' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function colaOp(modo, fn) {
    const d = await idb();
    return new Promise((res, rej) => {
      const tx = d.transaction(IDB_STORE, modo);
      const q = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => res(q && q.result);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  }
  const colaTodos = () => colaOp('readonly', s => s.getAll()).then(x => x || []).catch(() => []);
  const colaPoner = it => colaOp('readwrite', s => s.put(it));
  const colaQuitar = id => colaOp('readwrite', s => s.delete(id));

  // Proyectos del encargado guardados en el teléfono: permiten abrir «Campo» y el botón sin señal
  const cacheKey = id => `campo_enc_${id}`;
  function cacheEncargado(id) {
    try { const x = JSON.parse(localStorage.getItem(cacheKey(id)) || 'null'); return Array.isArray(x) ? x : null; } catch (e) { return null; }
  }
  function guardarCache(id, ps) { try { localStorage.setItem(cacheKey(id), JSON.stringify(ps)); } catch (e) { } }

  let _sync = false, _refrescar = null;
  async function sincronizarPendientes() {
    if (_sync || !navigator.onLine || !window.firebase || !window.firebase.auth) return { n: 0 };
    const u = window.firebase.auth().currentUser;
    if (!u) return { n: 0, sinSesion: true };
    _sync = true;
    let n = 0;
    try {
      const todos = (await colaTodos()).filter(i => String(i.empId) === String(u.uid) && !i.fallida);
      // primero las fotos y luego la confirmación del día, que cuenta las fotos
      todos.sort((a, b) => (a.tipo === 'foto' ? 0 : 1) - (b.tipo === 'foto' ? 0 : 1) || a.creado - b.creado);
      const ts = window.firebase.firestore.FieldValue.serverTimestamp;
      for (const it of todos) {
        const diferida = !!it.sinRed || Date.now() - it.creado > 90000;   // se guardó sin señal y se envió después
        try {
          if (it.tipo === 'foto') {
            await db().collection(COL_F).doc(it.idLocal).set({ proyectoId: it.proyectoId, fecha: it.fecha, encargadoId: it.empId, foto: it.foto, lat: it.lat, lng: it.lng,
              precision: it.precision, descripcion: it.descripcion || '', ts_servidor: ts(), ts_cliente: it.ts_cliente, diferida });
          } else {
            // las fotos ya están subidas (van antes): se cuenta lo que hay en el servidor para ese día
            let nFotos = it.fotos || 0;
            try { nFotos = Math.max(nFotos, (await fotosDia(it.proyectoId, it.fecha)).length); } catch (e) { }
            await db().collection(COL_D).doc(`${it.proyectoId}_${it.fecha}`).set({ proyectoId: it.proyectoId, fecha: it.fecha, encargadoId: it.empId, fotos: nFotos, confirmado_en: ts(), diferida });
          }
          await colaQuitar(it.idLocal);
          n++;
        } catch (e) {
          const perm = e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''));
          it.intentos = (it.intentos || 0) + 1;
          it.error = String((e && e.message) || e).slice(0, 160);
          if (perm && it.intentos >= 3) it.fallida = true;
          await colaPoner(it).catch(() => { });
          if (!perm) break;   // sin red o servidor caído: se reintenta más tarde
        }
      }
    } finally { _sync = false; }
    if (n) {
      toast(`Se enviaron ${n} elemento(s) de campo que estaban guardados en el teléfono`, 'success');
      if (_refrescar) { try { _refrescar(); } catch (e) { } }
    }
    return { n };
  }
  function arrancarSync() {
    const intento = () => { sincronizarPendientes().catch(() => { }); };
    [4000, 12000, 30000, 90000].forEach(t => setTimeout(intento, t));
    setInterval(intento, 60000);
    window.addEventListener('online', () => setTimeout(intento, 1500));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') intento(); });
  }

  function fotoPendienteHtml(it) {
    return `<figure class="cp-foto cp-foto-pend">
      <img src="${esc(it.foto)}" alt="Foto pendiente de envío" data-cp-ampliar>
      <figcaption><b>${esc(horaDe(msDe(it.ts_cliente)))}</b>
        ${it.fallida ? '<span class="cp-mal">No se pudo enviar: avisa a Sistemas</span>' : '<span class="cp-chip"><i class="fas fa-cloud-arrow-up"></i> Pendiente de envío</span>'}
        ${it.descripcion ? `<span class="cp-desc-txt">${esc(it.descripcion)}</span>` : ''}</figcaption></figure>`;
  }

  // ================================================================ APP DEL ENCARGADO
  function montarApp(cont, opts) {
    const emp = opts.empleado || {};
    const cargando = '<div class="cp-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
    cont.classList.add('cp-raiz', 'cp-app');
    if (!cont._cpDelegado) { delegarAmpliar(cont); cont._cpDelegado = true; }
    let vista = () => lista();
    _refrescar = () => { if (cont.isConnected && !document.querySelector('.cp-camara')) vista(); };

    async function lista() {
      vista = lista;
      cont.innerHTML = cargando;
      let ps = null;
      if (navigator.onLine) { try { ps = await proyectosDeEncargado(emp.id); } catch (e) { ps = null; } }
      if (!ps) ps = cacheEncargado(emp.id);   // sin señal: los últimos proyectos guardados en el teléfono
      if (!ps) { cont.innerHTML = '<div class="cp-vacio cp-mal">Sin conexión y todavía no hay datos guardados de tus proyectos. Abre esta sección una vez con señal.</div>'; return; }
      if (!ps.length) { cont.innerHTML = '<div class="cp-vacio">No tienes proyectos de campo asignados. Los asigna TTHH.</div>'; return; }
      if (ps.length === 1) return proyecto(ps[0], false);
      cont.innerHTML = `<div class="cp-cab"><h3><i class="fas fa-helmet-safety"></i> Mis proyectos de campo</h3></div><div class="cp-grid">${ps.map(p => `
        <button type="button" class="cp-tarjeta" data-abrir="${esc(p.id)}"><div class="cp-tit">${esc(p.nombre)}</div><div class="cp-sub">${esc(p.lugar || '')}</div>
        <div class="cp-meta"><span><i class="fas fa-calendar"></i> ${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}</span><span><i class="fas fa-users"></i> ${(p.cuadrilla || []).length}</span></div></button>`).join('')}</div>`;
      cont.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => proyecto(ps.find(p => p.id === b.dataset.abrir), true));
    }

    async function proyecto(p, conVolver) {
      vista = () => proyecto(p, conVolver);
      const fecha = hoyStr();
      cont.innerHTML = cargando;
      let fotos = [], dia = null;
      if (navigator.onLine) { try { [fotos, dia] = await Promise.all([fotosDia(p.id, fecha), diaDoc(p.id, fecha)]); } catch (e) { /* se muestra lo guardado en el teléfono */ } }
      const pend = (await colaTodos()).filter(i => i.proyectoId === p.id && i.fecha === fecha && String(i.empId) === String(emp.id));
      const pFotos = pend.filter(i => i.tipo === 'foto'), pDia = pend.find(i => i.tipo === 'dia');
      const total = fotos.length + pFotos.length;
      const fuera = fecha < p.desde || fecha > p.hasta;
      cont.innerHTML = `<div class="cp-cab"><div>${conVolver ? '<button type="button" class="cp-btn" data-volver><i class="fas fa-arrow-left"></i></button>' : ''}
          <h3><i class="fas fa-helmet-safety"></i> ${esc(p.nombre)}</h3><p>${esc(p.lugar || '')} · ${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}</p></div></div>
        ${navigator.onLine ? '' : '<div class="cp-aviso"><i class="fas fa-wifi"></i> Sin conexión: puedes tomar fotos y confirmar igual. Se enviarán solas cuando haya señal.</div>'}
        ${pend.length ? `<div class="cp-aviso"><i class="fas fa-cloud-arrow-up"></i> ${pend.length} pendiente(s) de envío. Se subirán solas al abrir la app con señal.</div>` : ''}
        ${fuera ? `<div class="cp-aviso">Hoy está fuera de las fechas del proyecto (${fechaCorta(p.desde)} – ${fechaCorta(p.hasta)}): no se pueden tomar fotografías ni confirmar el día. Si las fechas están mal, pide a TTHH que las corrija.</div>` : ''}
        <h4 class="cp-h4">1. Fotografías del proyecto y del personal trabajando <span class="cp-peq">(${total} hoy)</span></h4>
        <button type="button" class="cp-btn cp-btn-pri cp-btn-grande" data-foto><i class="fas fa-camera"></i> Tomar fotografía</button>
        <p class="cp-peq">Fotos claras y en horizontal: la empresa podrá usarlas en presentaciones y comunicación. La cámara guarda sola la fecha, la hora y tu ubicación, que confirman dónde se trabaja. No se pueden subir fotos de la galería.</p>
        ${(fotos.length || pFotos.length) ? `<div class="cp-fotos">${pFotos.map(fotoPendienteHtml).join('')}${fotos.map(f => fotoHtml(f, p.nombre)).join('')}</div>` : ''}
        <h4 class="cp-h4">2. Confirmar el lugar de trabajo de hoy</h4>
        <button type="button" class="cp-btn cp-btn-ok cp-btn-grande" data-confirmar><i class="fas fa-check-circle"></i> ${(dia || pDia) ? 'Actualizar confirmación' : 'Confirmar el día'}</button>
        ${pDia ? '<p class="cp-peq"><i class="fas fa-cloud-arrow-up"></i> Confirmación guardada en el teléfono: se enviará sola al tener señal.</p>'
          : dia ? `<p class="cp-ok">Confirmado a las ${esc(horaDe(msDe(dia.confirmado_en)))} con ${dia.fotos || fotos.length} foto(s).</p>` : ''}
        <p class="cp-peq">Avisa al personal que sale en las fotos: es su imagen (LOPDP).</p>`;
      const v = cont.querySelector('[data-volver]'); if (v) v.onclick = lista;
      const bFoto = cont.querySelector('[data-foto]'), bConf = cont.querySelector('[data-confirmar]');
      if (fuera) { bFoto.disabled = true; bConf.disabled = true; }
      bFoto.onclick = () => { if (!fuera) camara(p, fecha, () => proyecto(p, conVolver)); };
      bConf.onclick = async function () {
        if (fuera) return toast('Hoy está fuera de las fechas del proyecto', 'warning');
        if (!total) return toast('Toma al menos una fotografía del lugar antes de confirmar', 'warning');
        this.disabled = true;
        const idLocal = `d_${p.id}_${fecha}`;
        try { await colaPoner({ idLocal, tipo: 'dia', empId: String(emp.id), proyectoId: p.id, fecha, fotos: total, creado: Date.now(), sinRed: !navigator.onLine }); }
        catch (e) { this.disabled = false; return toast('No se pudo guardar la confirmación: ' + (e.message || e), 'error'); }
        await sincronizarPendientes().catch(() => { });
        const sigue = (await colaTodos()).some(i => i.idLocal === idLocal);
        toast(sigue ? 'Confirmación guardada: se enviará sola cuando haya señal' : 'Día confirmado', sigue ? 'info' : 'success');
        proyecto(p, conVolver);
      };
    }

    // ---- cámara propia (sin galería): foto limpia en buena calidad + hora y GPS como datos
    function camara(p, fecha, alTerminar) {
      const ov = document.createElement('div');
      ov.className = 'cp-camara';
      ov.innerHTML = `<video playsinline autoplay muted></video><canvas hidden></canvas>
        <div class="cp-cam-info" id="cpGps">Buscando ubicación…</div>
        <input class="cp-input cp-cam-desc" id="cpDesc" maxlength="140" placeholder="Descripción de la foto (opcional)" hidden>
        <div class="cp-cam-bar"><button type="button" class="cp-btn" data-cerrar>Cancelar</button>
          <button type="button" class="cp-disparo" data-disparar aria-label="Capturar" disabled></button>
          <button type="button" class="cp-btn cp-btn-pri" data-usar hidden>Guardar</button><button type="button" class="cp-btn" data-repetir hidden>Repetir</button></div>`;
      document.body.appendChild(ov);
      const v = ov.querySelector('video'), cv = ov.querySelector('canvas'), info = ov.querySelector('#cpGps'), desc = ov.querySelector('#cpDesc');
      let stream = null, gps = null, watch = null, jpeg = null;
      const cerrar = () => { try { if (watch != null) navigator.geolocation.clearWatch(watch); } catch (e) { } if (stream) stream.getTracks().forEach(t => t.stop()); ov.remove(); };
      ov.querySelector('[data-cerrar]').onclick = cerrar;
      const listo = () => { ov.querySelector('[data-disparar]').disabled = !(stream && gps); };

      if (!navigator.geolocation) { info.textContent = 'Este teléfono no permite ubicación.'; }
      else watch = navigator.geolocation.watchPosition(pos => {
        gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
        info.textContent = `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} · ±${Math.round(gps.precision)} m`; listo();
      }, err => { info.textContent = 'Activa la ubicación para tomar la foto (' + (err.message || 'sin permiso') + ')'; }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Este navegador no permite usar la cámara aquí', 'error'); return cerrar(); }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
        .then(s => { stream = s; v.srcObject = s; listo(); })
        .catch(e => { toast('No se pudo abrir la cámara: ' + (e.message || e), 'error'); cerrar(); });

      ov.querySelector('[data-disparar]').onclick = () => {
        if (!gps) return;
        const ahora = new Date();
        const w = v.videoWidth || 1280, h = v.videoHeight || 960;
        // Calidad alta para poder reutilizar la foto: primero baja un poco la compresión y solo después el tamaño
        let k = Math.min(1, MAX_FOTO_ANCHO / w), q = 0.88;
        for (let i = 0; i < 8; i++) {
          cv.width = Math.round(w * k); cv.height = Math.round(h * k);
          cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
          jpeg = cv.toDataURL('image/jpeg', q);
          if (jpeg.length <= FOTO_MAX_CHARS) break;
          if (q > 0.6) q -= 0.08; else k *= 0.85;
        }
        ov._cap = { gps: Object.assign({}, gps), ts_cliente: ahora.toISOString() };
        v.hidden = true; cv.hidden = false; desc.hidden = false;
        ov.querySelector('[data-disparar]').hidden = true; ov.querySelector('[data-cerrar]').hidden = true;
        ov.querySelector('[data-usar]').hidden = false; ov.querySelector('[data-repetir]').hidden = false;
      };
      ov.querySelector('[data-repetir]').onclick = () => {
        jpeg = null; cv.hidden = true; v.hidden = false; desc.hidden = true; desc.value = '';
        ov.querySelector('[data-disparar]').hidden = false; ov.querySelector('[data-cerrar]').hidden = false;
        ov.querySelector('[data-usar]').hidden = true; ov.querySelector('[data-repetir]').hidden = true;
      };
      ov.querySelector('[data-usar]').onclick = async function () {
        if (!jpeg || !ov._cap) return;
        this.disabled = true; this.textContent = 'Guardando…';
        const c = ov._cap;
        const idLocal = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
          // Primero en el teléfono (a prueba de falta de señal); luego se intenta enviar de inmediato
          await colaPoner({ idLocal, tipo: 'foto', empId: String(emp.id), proyectoId: p.id, fecha, foto: jpeg, lat: c.gps.lat, lng: c.gps.lng,
            precision: Math.round(c.gps.precision), descripcion: desc.value.trim(), ts_cliente: c.ts_cliente, creado: Date.now(), sinRed: !navigator.onLine });
        } catch (e) { this.disabled = false; this.textContent = 'Guardar'; return toast('No se pudo guardar la foto en el teléfono: ' + (e.message || e), 'error'); }
        cerrar();
        await sincronizarPendientes().catch(() => { });
        const sigue = (await colaTodos()).some(i => i.idLocal === idLocal);
        toast(sigue ? 'Fotografía guardada: se enviará sola cuando haya señal' : 'Fotografía enviada', sigue ? 'info' : 'success');
        alTerminar();
      };
    }

    lista();
  }

  arrancarSync();
  window.Campo = { montarPanel, montarApp, puedeGestionar, esEncargado, proyectosDeEncargado, cacheEncargado, sincronizarPendientes };
})();
