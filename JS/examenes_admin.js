// Plataforma de evaluación técnica · panel del evaluador (fase 1).
// Personas, banco de preguntas (carga desde Excel), generación de exámenes y envío de enlaces por correo.
// Datos: PostgREST api.examenes (db/postgres/019_examenes.sql) por Apps Script (evalRpc) con el token de contraseña
// de Desempeño; el envío de correos lo hace Apps Script (examenes.gs, acción examenEnviar).
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const app = document.getElementById('exApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, d: null, tab: 'examenes', sel: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, evaluados: new Set(), msg: null, banco: null, emps: [], correos: {}, detalle: null, adj: null, nx: null, rev: null, revModal: null, mv: { items: [], subiendo: false, resumen: '' }, pq: null, pers: { q: '', unidad: null, area: '', soloPart: false, edits: new Map(), guardando: false } };
  const fb = () => window.FirebaseBackend;
  const quitarTildes = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  // ---------- sesión ----------
  function sesionGuardada() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY_SESION) || 'null');
      if (s && s.token && s.exp * 1000 - Date.now() > 5 * 60000) return s;
    } catch (e) { }
    return null;
  }
  function cerrarSesion() { try { sessionStorage.removeItem(KEY_SESION); } catch (e) { } st.ses = null; }
  const vencida = () => Object.assign(new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'), { sesion: true });

  function pedirPin() {
    let id = '';
    try { const d = JSON.parse(localStorage.getItem('SESSION_DATA') || '{}'); id = d.id || d.empleadoId || ''; } catch (e) { }
    return new Promise(resolve => {
      app.innerHTML = `<form class="ex-card login"><h1><i class="fas fa-clipboard-question"></i> Evaluaciones técnicas</h1>
        <p class="sub">Ingresa con el ID y la contraseña de la app.</p>
        <label>ID<input name="id" inputmode="numeric" autocomplete="off" required value="${esc(id)}"></label>
        <label>Contraseña<input name="pin" type="password" autocomplete="off" required></label>
        <p class="msg mal" hidden></p><button class="btn primario" style="width:100%">Entrar</button></form>`;
      const f = app.querySelector('form'), msg = f.querySelector('.msg'), b = f.querySelector('button');
      f.addEventListener('submit', async ev => {
        ev.preventDefault(); b.disabled = true; msg.hidden = true;
        try {
          const r = await fb()._post({ accion: 'tokenEvaluacion', empleadoId: f.id.value.trim(), pin: f.pin.value });
          if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu contraseña.');
          const s = { token: r.token, exp: r.exp, empleadoId: f.id.value.trim(), equipo: r.equipo || [], rrhh: !!r.rrhh, master: !!r.master };
          try { sessionStorage.setItem(KEY_SESION, JSON.stringify(s)); } catch (e) { }
          resolve(s);
        } catch (e) { msg.textContent = e.message; msg.hidden = false; b.disabled = false; }
      });
    });
  }

  // ---------- llamadas ----------
  // Directo al servidor por el túnel (rápido: hace falta para subir archivos) y, si la red lo bloquea, por Apps Script
  async function llamar(fn, p) {
    const f = fb();
    for (let i = 0; i < 2 && f._urlHistorico; i++) {
      let url = '';
      try { url = await f._urlHistorico(i > 0); } catch (e) { url = ''; }
      if (!url) break;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      try {
        const r = await fetch(`${url}/rpc/${fn}`, { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p }) });
        if (r.status === 401) { cerrarSesion(); throw vencida(); }
        if (r.ok) return await r.json();
      } catch (e) { if (e.sesion) throw e; } finally { clearTimeout(t); }
    }
    const r = await f._post({ accion: 'evalRpc', token: st.ses.token, fn, p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con el servidor de evaluaciones.');
    if (r.status === 401) { cerrarSesion(); throw vencida(); }
    return r.body;
  }
  async function rpcFn(fn, p) {
    const b = await llamar(fn, p);
    if (!b || b.ok !== true) throw new Error((b && (b.error || b.message)) || 'No se pudo completar');
    return b;
  }
  const rpc = p => rpcFn('examenes', p);
  const rpcArch = p => rpcFn('examenes_archivos', p);
  const rpcRes = p => rpcFn('examenes_resultados', p);
  async function recargar() { st.d = await rpc({ accion: 'inicio' }); }

  // Directorio de empleados (Firestore: unidad, cargo, status y evaluador que ya maneja Desempeño).
  // El correo no está en la ficha: se pide a la copia de la nómina en Postgres (acción directorio_correos).
  async function cargarEmpleados() {
    try {
      const snap = await firebase.firestore().collection('empleados').get();
      st.emps = snap.docs.map(d => d.data()).filter(e => e && e.id && String(e.activo ?? 'SI').toUpperCase() !== 'NO')
        .map(e => ({ id: String(e.id).trim(), nombre: String(e.nombre || '').trim(), unidad: String(e.unidad || '').trim(), area: String(e.area_nomina || e.area || '').trim(),
          cargo: String(e.cargo || '').trim(), cargoNomina: String(e.cargo_nomina || '').trim(), rolEval: String(e.evaluacion_rol || '').toUpperCase(),
          evaluadorId: String(e.evaluador_id || '').trim() }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    } catch (e) { st.emps = []; }
    if (st.pers.unidad === null) {
      const u = [...new Set(st.emps.map(e => e.unidad))].find(x => quitarTildes(x).startsWith('diseno'));
      st.pers.unidad = u || '';
    }
    try { st.correos = (await rpc({ accion: 'directorio_correos', ids: st.emps.map(e => e.id) })).correos || {}; } catch (e) { st.correos = {}; }
  }
  const empPorId = id => st.emps.find(e => e.id === String(id).trim());

  // ---- Personas: lo que sugiere Desempeño para cada empleado y lo ya guardado en exámenes
  const LINEAS_CARGO = [['baja', 'Baja Tensión'], ['media', 'Media Tensión'], ['electromec', 'Electromecánica'], ['automat', 'Motion y Automation'], ['motion', 'Motion y Automation']];
  function sugerido(e) {
    const cn = quitarTildes(e.cargoNomina), cg = quitarTildes(e.cargo);
    const coord = cn.includes('coordinador');
    const perfil = cg.includes('pasante') || cn.includes('pasante') ? 'Pasante' : cn.includes('especialista') ? 'Especialista de ingeniería' : (cn.includes('lider') || coord) ? 'Líder' : '';
    const lineas = coord ? [] : [...new Set(LINEAS_CARGO.filter(([k]) => cg.includes(k)).map(x => x[1]))];
    return { evaluado: !coord && !!perfil && (!e.rolEval || e.rolEval.includes('EVALUADO')), evaluador: e.rolEval.includes('EVALUADOR'), perfil, lineas, correo: st.correos[e.id] || '' };
  }
  const guardadoDe = id => {
    const f = (st.d.perfiles || []).filter(x => x.empleadoId === id);
    return { ado: f.find(x => x.rol === 'EVALUADO') || null, ador: f.find(x => x.rol === 'EVALUADOR') || null };
  };
  const mismoSet = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');
  function estadoDe(e) {            // lo que hay guardado (sin nada guardado = no participa)
    const g = guardadoDe(e.id);
    return { evaluado: !!g.ado, evaluador: !!g.ador, perfil: g.ado ? g.ado.perfil || '' : '', lineas: g.ado ? g.ado.lineas : [], correo: g.ado ? g.ado.correo : ((g.ador && g.ador.correo) || '') };
  }
  function valorDe(e) {             // guardado o, si no hay nada, lo sugerido; encima, lo que el usuario ya cambió
    const g = guardadoDe(e.id);
    const base = (g.ado || g.ador) ? estadoDe(e) : sugerido(e);
    if (!base.correo) base.correo = st.correos[e.id] || '';
    return Object.assign({}, base, st.pers.edits.get(e.id) || {});
  }
  const hayCambio = e => {
    const v = valorDe(e), g = estadoDe(e);
    if (!v.evaluado && !v.evaluador && !g.evaluado && !g.evaluador) return false;
    return v.evaluado !== g.evaluado || v.evaluador !== g.evaluador
      || (v.evaluado && (v.perfil !== g.perfil || !mismoSet(v.lineas, g.lineas) || v.correo !== g.correo))
      || (!v.evaluado && v.evaluador && v.correo !== g.correo);
  };
  const visiblesDe = () => {
    const P = st.pers, q = quitarTildes(P.q);
    return st.emps.filter(e => (!P.unidad || e.unidad === P.unidad) && (!P.area || e.area === P.area)
      && (!q || quitarTildes(`${e.nombre} ${e.id} ${e.cargo} ${e.unidad} ${e.area}`).includes(q))
      && (!P.soloPart || valorDe(e).evaluado || valorDe(e).evaluador));
  };
  const editar = (id, k, v) => {
    const c = Object.assign({}, st.pers.edits.get(id)); c[k] = v;
    st.pers.edits.set(id, c);
  };


  async function ejecutar(fn, btn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) {
      if (e.sesion) { setTimeout(() => location.reload(), 1200); }
      aviso(e.message, 'mal');
    }
    pintar();
  }

  // ---------- archivos (se suben y bajan en partes de 300 KB) ----------
  const PARTE = 300000;
  const MIME_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', txt: 'text/plain',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const mimeDe = f => (f.type && f.type !== 'application/octet-stream') ? f.type : (MIME_EXT[(f.name.split('.').pop() || '').toLowerCase()] || '');
  function aB64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const tam = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const icoMime = m => /^image/.test(m) ? 'fa-image' : /^audio/.test(m) ? 'fa-headphones' : /^video/.test(m) ? 'fa-film' : /pdf/.test(m) ? 'fa-file-pdf' : 'fa-file-lines';

  async function subirMaterial(file, preguntaId, progreso) {
    const mime = mimeDe(file);
    if (!mime) throw new Error(`«${file.name}»: tipo de archivo no reconocido.`);
    const ini = await rpcArch({ accion: 'subir_inicio', preguntaId, nombre: file.name, mime, tamano: file.size });
    for (let n = 1; n <= ini.partes; n++) {
      await rpcArch({ accion: 'subir_parte', archivoId: ini.archivoId, n, datos: aB64(await file.slice((n - 1) * PARTE, n * PARTE).arrayBuffer()) });
      progreso(n / ini.partes);
    }
    await rpcArch({ accion: 'subir_fin', archivoId: ini.archivoId });
  }

  // Baja un archivo completo (todas las partes) y lo muestra en un visor dentro de la página
  async function verArchivo(id, nombre, mime) {
    const v = document.createElement('div');
    v.className = 'visor';
    v.innerHTML = `<div class="visor-in"><div class="ex-top"><b>${esc(nombre)}</b><button class="btn chico" data-x>Cerrar</button></div><div class="visor-c"><p class="sub" id="visorMsg">Descargando…</p></div></div>`;
    document.body.appendChild(v);
    let url = '';
    v.querySelector('[data-x]').onclick = () => { v.remove(); if (url) URL.revokeObjectURL(url); };
    try {
      const partes = []; let total = 1;
      for (let n = 1; n <= total; n++) {
        const r = await rpcArch({ accion: 'archivo_parte', archivoId: id, n });
        total = r.partes; partes.push(Uint8Array.from(atob(r.datos), c => c.charCodeAt(0)));
        const m = v.querySelector('#visorMsg'); if (m) m.textContent = `Descargando… ${Math.round(n / total * 100)} %`;
      }
      url = URL.createObjectURL(new Blob(partes, { type: mime }));
      const c = v.querySelector('.visor-c');
      c.innerHTML = /^image/.test(mime) ? `<img src="${url}" alt="">` : /^audio/.test(mime) ? `<audio src="${url}" controls autoplay></audio>`
        : /^video/.test(mime) ? `<video src="${url}" controls autoplay></video>` : mime === 'application/pdf' ? `<iframe src="${url}"></iframe>`
        : `<p><a class="btn primario" href="${url}" download="${esc(nombre)}"><i class="fas fa-download"></i> Descargar ${esc(nombre)}</a></p>`;
    } catch (e) { v.querySelector('.visor-c').innerHTML = `<p class="msg mal">${esc(e.message)}</p>`; }
  }

  // ---------- carga masiva de material: carpeta, varios archivos o ZIP; se asignan por el código de la pregunta ----------
  const MAX_MATERIAL = 26214400;
  const limpiarNombre = n => String(n || '').replace(/^.*[\\/]/, '').replace(/[^\p{L}\p{N} ._()\-]/gu, '_').slice(0, 120).toLowerCase();
  const sinExt = n => n.replace(/\.[^.]+$/, '');

  async function aArchivos(lista) {   // expande ZIP y descarta basura de sistema
    const out = [];
    for (const f of lista) {
      const ruta = f.webkitRelativePath || f.name;
      if (/\.zip$/i.test(f.name)) {
        if (!window.JSZip) throw new Error('No se pudo cargar el lector de ZIP. Revisa tu conexión y recarga la página.');
        const z = await JSZip.loadAsync(f);
        for (const [nombre, ent] of Object.entries(z.files)) {
          if (ent.dir || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(nombre) || /(^|\/)\./.test(nombre)) continue;
          const base = nombre.split('/').pop();
          out.push({ file: new File([await ent.async('blob')], base, { type: MIME_EXT[(base.split('.').pop() || '').toLowerCase()] || '' }), ruta: nombre });
        }
      } else if (!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(ruta)) out.push({ file: f, ruta });
    }
    return out;
  }

  // Código de pregunta que le corresponde a un archivo: «P001.png», «P001_diagrama.png», «P001 - foto.jpg» o dentro de una carpeta «P001/»
  function preguntaDe(ruta, lista) {
    const segs = ruta.split('/').map(x => quitarTildes(x));
    const base = sinExt(segs[segs.length - 1]);
    const codigos = [...lista].sort((a, b) => b.codigo.length - a.codigo.length);
    for (const q of codigos) {
      const c = quitarTildes(q.codigo);
      if (base === c || (base.startsWith(c) && /^[\s_\-.()]/.test(base.slice(c.length)))) return q.id;
    }
    for (const q of codigos) if (segs.slice(0, -1).includes(quitarTildes(q.codigo))) return q.id;
    return null;
  }

  function evaluarMasivo() {
    const lista = (st.banco && st.banco.lista) || [], usados = new Map();
    st.mv.items.forEach(it => {
      if (it.estado === 'subido' || it.estado === 'error') return;
      const q = lista.find(x => x.id === it.preguntaId);
      it.estado = 'listo'; it.motivo = '';
      if (!mimeDe(it.file)) { it.estado = 'no'; it.motivo = 'Tipo de archivo no permitido'; }
      else if (it.file.size > MAX_MATERIAL) { it.estado = 'no'; it.motivo = 'Supera 25 MB'; }
      else if (!q) { it.estado = 'no'; it.motivo = 'Sin pregunta: elige una o se omite'; }
      else if ((q.adjuntos || []).some(a => a.tipo === 'archivo' && String(a.nombre).toLowerCase() === limpiarNombre(it.file.name))) { it.estado = 'no'; it.motivo = 'Ya está adjunto'; }
      else {
        const n = (q.adjuntos || []).length + (usados.get(q.id) || 0);
        if (n >= 5) { it.estado = 'no'; it.motivo = 'La pregunta ya tiene 5 adjuntos'; } else usados.set(q.id, (usados.get(q.id) || 0) + 1);
      }
    });
  }

  async function agregarMasivo(lista) {
    const arch = await aArchivos(lista);
    const preguntas = (st.banco && st.banco.lista) || [];
    arch.forEach(a => st.mv.items.push({ file: a.file, ruta: a.ruta, preguntaId: preguntaDe(a.ruta, preguntas), estado: 'listo', motivo: '' }));
    st.mv.resumen = '';
    evaluarMasivo();
  }

  async function subirMasivo() {
    const m = st.mv;
    const todo = m.items.filter(it => it.estado === 'listo');
    m.subiendo = true; pintar();
    let ok = 0;
    for (const [k, it] of todo.entries()) {
      try {
        await subirMaterial(it.file, it.preguntaId, x => { const e = document.getElementById('mvProg'); if (e) e.textContent = `Subiendo ${k + 1} de ${todo.length}: ${it.file.name} ${Math.round(x * 100)} %`; });
        it.estado = 'subido'; ok++;
      } catch (e) { it.estado = 'error'; it.motivo = e.message; }
    }
    m.subiendo = false;
    const fallos = m.items.filter(it => it.estado === 'error').length;
    m.resumen = `${ok} archivo(s) subido(s)${fallos ? `; ${fallos} con error (reintenta con «Subir pendientes»)` : ''}.`;
    m.items = m.items.filter(it => it.estado !== 'subido');
    st.banco.lista = (await rpc({ accion: 'banco_listar' })).preguntas;
    evaluarMasivo();
  }

  // ---------- resultados: descargar Excel, enviarlo por correo y cargar calificaciones ----------
  function descargarResultados(res) {
    const wb = XLSX.utils.book_new();
    res.hojas.forEach(h => {
      const filas = h.filas.map(f => f.map(v => v === null || v === undefined ? '' : v));
      const ws = XLSX.utils.aoa_to_sheet(filas);
      if (h.nombre === 'Respuestas') ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 4 }, { wch: 8 }, { wch: 11 }, { wch: 9 }, { wch: 45 }, { wch: 45 }, { wch: 55 }, { wch: 20 }, { wch: 9 }, { wch: 9 }, { wch: 35 }];
      if (h.nombre === 'Instrucciones para IA') ws['!cols'] = [{ wch: 140 }];
      XLSX.utils.book_append_sheet(wb, ws, h.nombre);
    });
    XLSX.writeFile(wb, ('Resultados ' + res.examen.nombre).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + '.xlsx');
  }

  async function cargarCalificaciones(file, examenId) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const hoja = wb.Sheets['Respuestas'] || wb.Sheets[wb.SheetNames.find(n => quitarTildes(n).includes('respuestas'))];
    if (!hoja) throw new Error('No encontré la hoja «Respuestas». Usa el Excel que descargaste o recibiste por correo.');
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', blankrows: false });
    const cab = (filas[0] || []).map(quitarTildes);
    const cId = cab.indexOf('id_respuesta'), cPts = cab.findIndex(c => c.startsWith('puntos obtenidos')), cCom = cab.indexOf('comentario');
    if (cId < 0 || cPts < 0) throw new Error('Faltan las columnas «ID_RESPUESTA» y «Puntos obtenidos».');
    const items = filas.slice(1).filter(f => String(f[cId]).trim()).map(f => ({ id: String(f[cId]).trim(), puntos: String(f[cPts] ?? '').trim(), comentario: cCom >= 0 ? String(f[cCom] ?? '').trim() : '' }));
    let guardadas = 0; const errores = [];
    for (let i = 0; i < items.length; i += 100) {
      const r = await rpcRes({ accion: 'calificar_lote', examenId, items: items.slice(i, i + 100) });
      guardadas += r.guardadas; errores.push(...r.errores);
    }
    return { guardadas, errores, total: items.length };
  }

  // ---------- Excel ----------
  const COLS = { id: 'codigo', usuario: 'perfiles', 'linea de negocio': 'lineas', lineas: 'lineas', 'tipo de pregunta': 'tipo', tipo: 'tipo',
    dificultad: 'dificultad', pregunta: 'pregunta', 'respuesta modelo': 'respuestaModelo', respuesta: 'respuestaModelo', enlaces: 'enlaces', enlace: 'enlaces', adjuntos: 'enlaces', puntos: 'puntos', valor: 'puntos' };
  const ALIAS = { procesos: 'Proceso', procesos_: 'Proceso', tecnica: 'Técnica', capacitacion: 'Capacitación', 'especialista de ingenieria': 'Especialista de ingeniería', lider: 'Líder' };

  function normalizar(tipo, valor) {
    const k = quitarTildes(valor);
    const lista = (st.d.catalogo[tipo] || []);
    const hit = lista.find(v => quitarTildes(v) === k) || (ALIAS[k] && lista.find(v => v === ALIAS[k]));
    return hit || String(valor).trim();
  }
  const partir = (tipo, v) => String(v ?? '').split(/[;\n]/).map(x => x.trim()).filter(Boolean).map(x => normalizar(tipo, x));

  function leerExcel(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    let hoja = wb.Sheets[wb.SheetNames.find(n => quitarTildes(n).includes('banco'))] || null;
    const filasDe = h => XLSX.utils.sheet_to_json(h, { header: 1, defval: '', blankrows: false });
    let filas = hoja ? filasDe(hoja) : [];
    let cab = filas.findIndex(r => r.map(quitarTildes).includes('pregunta') && r.map(quitarTildes).includes('id'));
    if (cab < 0) {
      for (const n of wb.SheetNames) {
        const f = filasDe(wb.Sheets[n]);
        const i = f.findIndex(r => r.map(quitarTildes).includes('pregunta') && r.map(quitarTildes).includes('id'));
        if (i >= 0) { filas = f; cab = i; break; }
      }
    }
    if (cab < 0) throw new Error('No encontré las columnas «ID» y «Pregunta». Usa la plantilla.');
    const mapa = filas[cab].map(h => COLS[quitarTildes(h)] || null);
    const preguntas = [], descartadas = [];
    filas.slice(cab + 1).forEach((r, i) => {
      const o = {};
      mapa.forEach((k, c) => { if (k && o[k] === undefined) o[k] = r[c]; });
      const fila = cab + 2 + i;
      if (!String(o.codigo ?? '').trim() && !String(o.pregunta ?? '').trim()) { descartadas.push(fila); return; } // notas o filas vacías
      preguntas.push({
        fila, codigo: String(o.codigo ?? '').trim(), pregunta: String(o.pregunta ?? '').trim(),
        perfiles: partir('PERFIL', o.perfiles), lineas: partir('LINEA', o.lineas),
        tipo: o.tipo ? normalizar('TIPO', String(o.tipo).split(';')[0]) : '', dificultad: o.dificultad ? normalizar('DIFICULTAD', String(o.dificultad).split(';')[0]) : '',
        respuestaModelo: String(o.respuestaModelo ?? '').trim(),
        enlaces: String(o.enlaces ?? '').split(/[;\n ]+/).map(x => x.trim()).filter(Boolean),
        puntos: String(o.puntos ?? '').trim()
      });
    });
    return { preguntas, descartadas };
  }

  async function importar(preguntas) {
    // Lotes por tamaño: el respaldo de Apps Script limita cada llamada a ~20 KB
    const lotes = []; let actual = [], tam = 0;
    preguntas.forEach(q => {
      const t = JSON.stringify(q).length;
      if (actual.length && (tam + t > 14000 || actual.length >= 50)) { lotes.push(actual); actual = []; tam = 0; }
      actual.push(q); tam += t;
    });
    if (actual.length) lotes.push(actual);
    let guardadas = 0; const errores = [];
    for (const l of lotes) {
      const r = await rpc({ accion: 'banco_importar', preguntas: l });
      guardadas += r.guardadas; errores.push(...r.errores);
    }
    return { guardadas, errores };
  }

  function descargarPlantilla() {
    const c = st.d.catalogo;
    const wb = XLSX.utils.book_new();
    const filas = [['ID', 'Usuario', 'Linea de negocio', 'Dificultad', 'Tipo de pregunta', 'Pregunta', 'Respuesta modelo', 'Enlaces', 'Puntos'],
      ['P001', 'Pasante;Ingeniero', 'Baja Tensión', 'Medio', 'Técnica', '¿Cuál es la diferencia entre un seccionador y un disyuntor?', 'El seccionador aísla sin carga; el disyuntor interrumpe bajo carga.', 'https://www.youtube.com/watch?v=ejemplo', 10],
      ['P002', '', '', 'Bajo', 'Proceso', 'Pregunta que aplica a todos los perfiles y líneas (déjalos vacíos).', '', '', 5]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Banco de preguntas');
    const max = Math.max(...['PERFIL', 'LINEA', 'DIFICULTAD', 'TIPO'].map(k => (c[k] || []).length));
    const op = [['Usuario', 'Linea de negocio', 'Dificultad', 'Tipo de pregunta']];
    for (let i = 0; i < max; i++) op.push([c.PERFIL?.[i] || '', c.LINEA?.[i] || '', c.DIFICULTAD?.[i] || '', c.TIPO?.[i] || '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(op), 'Opciones');
    XLSX.writeFile(wb, 'plantilla_banco_preguntas.xlsx');
  }

  // ---------- pantallas ----------
  const chips = (clave, valores) => `<div class="chips">${valores.map(v =>
    `<span class="chip ${st.sel[clave].includes(v) ? 'on' : ''}" data-chip="${clave}" data-v="${esc(v)}">${esc(v)}</span>`).join('')}</div>`;

  // ---------- avisos flotantes y ventanas ----------
  // Un solo aviso a la vez, junto a donde actúa la persona (no en una franja arriba de la página)
  function aviso(texto, tipo) {
    let host = document.getElementById('exToasts');
    if (!host) { host = document.createElement('div'); host.id = 'exToasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    clearTimeout(aviso._t); host.innerHTML = '';
    if (!texto) return;
    tipo = tipo || 'ok';
    const t = document.createElement('div');
    t.className = 'toast ' + tipo;
    t.innerHTML = `<i class="fas ${tipo === 'ok' ? 'fa-circle-check' : tipo === 'mal' ? 'fa-circle-exclamation' : 'fa-circle-info'}"></i><div>${texto}</div><button aria-label="Cerrar">×</button>`;
    t.querySelector('button').onclick = () => t.remove();
    host.appendChild(t);
    if (tipo !== 'mal') aviso._t = setTimeout(() => t.remove(), tipo === 'aviso' ? 12000 : 7000);
  }

  const modales = [];
  function modal(html, o = {}) {
    const ov = document.createElement('div');
    ov.className = 'mdl';
    ov.innerHTML = `<div class="mdl-box" style="max-width:${o.ancho || 560}px" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(ov);
    document.body.classList.add('mdl-abierto');
    const m = {
      el: ov, box: ov.firstElementChild, cerrable: o.cerrable !== false,
      set(h) { m.box.innerHTML = h; },
      cerrar() {
        if (!ov.isConnected) return;
        if (o.antesCerrar) o.antesCerrar();
        ov.remove(); modales.splice(modales.indexOf(m), 1);
        if (!modales.length) document.body.classList.remove('mdl-abierto');
        if (o.alCerrar) o.alCerrar();
      },
      intentarCerrar() { if (o.puedeCerrar && !o.puedeCerrar()) return; m.cerrar(); }
    };
    ov.addEventListener('mousedown', e => { if (e.target === ov && m.cerrable) m.intentarCerrar(); });
    modales.push(m);
    return m;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modales.length) { const m = modales[modales.length - 1]; if (m.cerrable) m.intentarCerrar(); } });

  // Confirmación con texto claro (reemplaza al cuadro gris del navegador)
  function preguntar({ titulo, texto, si, no, peligro, icono, escribir, alAbrir }) {
    return new Promise(resolve => {
      const m = modal(`<div class="mdl-body centro"><div class="gran-ico ${peligro ? 'rojo' : ''}"><i class="fas ${icono || (peligro ? 'fa-triangle-exclamation' : 'fa-circle-question')}"></i></div>
        <h2>${esc(titulo)}</h2><div class="txt-ayuda">${texto}</div>
        ${escribir ? `<label class="confirma-txt">Para confirmar, escribe <b>${esc(escribir)}</b><input id="pgEscribir" autocomplete="off" placeholder="${esc(escribir)}"></label>` : ''}</div>
        <div class="mdl-pie"><button class="btn" data-no>${esc(no || 'Cancelar')}</button><button class="btn ${peligro ? 'peligro-lleno' : 'primario'}" data-si ${escribir ? 'disabled' : ''}>${esc(si || 'Aceptar')}</button></div>`, { ancho: 500, alCerrar: () => resolve(false) });
      const bsi = m.box.querySelector('[data-si]');
      m.box.querySelector('[data-no]').onclick = () => m.cerrar();
      bsi.onclick = () => { m.cerrable = false; resolve(true); m.el.remove(); modales.splice(modales.indexOf(m), 1); if (!modales.length) document.body.classList.remove('mdl-abierto'); };
      if (escribir) { const inp = m.box.querySelector('#pgEscribir'); inp.oninput = () => { bsi.disabled = inp.value.trim().toLowerCase() !== String(escribir).trim().toLowerCase(); }; inp.focus(); }
      if (alAbrir) alAbrir(m);
    });
  }
  function elegirArchivo(accept, cb) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.style.display = 'none';
    i.onchange = () => { const f = i.files[0]; i.remove(); if (f) cb(f); };
    document.body.appendChild(i); i.click();
  }

  // ---------- ayudas de presentación ----------
  const hora = t => t ? new Date(t).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const fechaCorta = t => t ? new Date(t).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtPts = n => { const x = Number(n); return Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ','); };
  const pct = (a, b) => (b ? Math.round(100 * Number(a) / Number(b)) : 0);
  const barra = (a, b) => { const p = Math.min(100, pct(a, b)); return `<div class="barra-nota" title="${p} %"><i class="${p >= 80 ? 'alta' : p >= 60 ? 'media' : 'baja'}" style="width:${p}%"></i></div>`; };
  const ESTADO_TXT = { GENERADO: ['Sin enviar', 'gris'], ENVIADO: ['Invitado', 'azul'], INICIADO: ['Rindiendo', 'ambar'], ENTREGADO: ['Entregó', 'verde'], ANULADO: ['Anulado', 'rojo'] };
  const insignia = est => { const [t, c] = ESTADO_TXT[est] || [est, 'gris']; return `<span class="ins ${c}">${esc(t)}</span>`; };
  const NOMBRE_EVENTO = { oculta: 'Cambió de pestaña o minimizó', blur: 'Pasó a otra ventana', sale_pantalla_completa: 'Salió de la pantalla completa', copiar: 'Intentó copiar', cortar: 'Intentó cortar',
    pegar: 'Intentó pegar texto', menu_contextual: 'Clic derecho', tecla: 'Usó una tecla de riesgo', cierre_pagina: 'Intentó cerrar o recargar', reanudo: 'Volvió a abrir el examen',
    compartir_iniciado: 'Compartió la pantalla', compartir_detenido: 'Dejó de compartir la pantalla' };
  const GRAVES = ['oculta', 'blur', 'sale_pantalla_completa', 'pegar', 'copiar', 'cortar', 'compartir_detenido'];

  function resumenExamen(e) {
    const vivos = e.intentos.filter(i => i.estado !== 'ANULADO');
    const entregaron = vivos.filter(i => i.estado === 'ENTREGADO');
    return { vivos, entregaron,
      sinEnviar: vivos.filter(i => i.estado === 'GENERADO'),
      enviadas: vivos.filter(i => i.estado !== 'GENERADO'),
      rindiendo: vivos.filter(i => i.estado === 'INICIADO'),
      calificadas: entregaron.filter(i => (i.calificadas || 0) >= i.preguntas),
      porCalificar: entregaron.filter(i => (i.calificadas || 0) < i.preguntas) };
  }

  // ---------- pestaña Exámenes ----------
  function tarjetaExamen(e) {
    const r = resumenExamen(e);
    const meta = [`${e.minutos} min`, `${e.cantidad} preguntas`, e.exigirPantalla && 'Pantalla compartida', e.permitirAdjuntos && 'Admite archivos', e.iaPermitida && 'Con IA']
      .filter(Boolean).map(t => `<span class="meta">${esc(t)}</span>`).join('');
    // El siguiente paso lógico es el único botón destacado
    let paso = null;
    if (r.sinEnviar.length) paso = { txt: `Enviar invitaciones (${r.sinEnviar.length})`, ico: 'fa-paper-plane', attr: `data-enviar="${e.id}"` };
    else if (e.iaPermitida && r.porCalificar.length) paso = { txt: 'Calificar con IA', ico: 'fa-wand-magic-sparkles', attr: `data-ia="${e.id}"` };
    else if (r.entregaron.length && !e.resultadosEnviadoEn) paso = { txt: 'Enviar resultados a mi correo', ico: 'fa-envelope', attr: `data-xmail="${e.id}"` };
    const hayInicio = e.intentos.some(i => i.iniciadoEn);
    const items = [
      hayInicio && `<button data-xl="${e.id}"><i class="fas fa-file-excel"></i> Descargar Excel de resultados</button>`,
      hayInicio && !(paso && paso.attr.startsWith('data-xmail')) && `<button data-xmail="${e.id}"><i class="fas fa-envelope"></i> Enviar resultados a mi correo</button>`,
      hayInicio && `<button data-xcarga="${e.id}"><i class="fas fa-upload"></i> Cargar calificaciones desde Excel</button>`,
      e.iaPermitida && r.entregaron.length && !(paso && paso.attr.startsWith('data-ia')) && `<button data-ia="${e.id}"><i class="fas fa-wand-magic-sparkles"></i> Calificar con IA</button>`,
      e.iaPermitida && r.entregaron.length && `<button data-ia="${e.id}" data-ia-re="1"><i class="fas fa-rotate"></i> Volver a calificar lo que hizo la IA</button>`,
      e.intentos.some(i => i.estado === 'ENVIADO') && `<button data-enviar="${e.id}"><i class="fas fa-paper-plane"></i> Reenviar invitaciones a quienes no han entregado</button>`,
      `<div class="menu-sep"></div><button class="peligro-item" data-elim-ex="${e.id}"><i class="fas fa-trash"></i> Eliminar este examen…</button>`
    ].filter(Boolean);
    const stat = (n, de, txt) => `<div class="stat"><b>${n}</b><span>${de != null ? ' de ' + de : ''}</span><small>${txt}</small></div>`;
    const estadoRes = e.resultadosEnviadoEn
      ? `<p class="linea-ok"><i class="fas fa-circle-check"></i> Resultados enviados a tu correo el ${esc(fechaCorta(e.resultadosEnviadoEn))}</p>`
      : e.resultadosError ? `<p class="msg aviso">Los resultados no se pudieron enviar solos: ${esc(e.resultadosError)}. Usa «Enviar resultados a mi correo» o «Descargar Excel».</p>` : '';
    const filas = e.intentos.map(i => {
      const nota = i.estado === 'ANULADO' ? '' : (i.calificadas > 0
        ? `<b>${fmtPts(i.puntos)}</b> / ${fmtPts(i.maximo)} <span class="sub">· ${pct(i.puntos, i.maximo)} %</span>${barra(i.puntos, i.maximo)}${i.calificadas < i.preguntas ? `<div class="sub">Parcial: ${i.calificadas} de ${i.preguntas} preguntas</div>` : ''}`
        : (i.estado === 'ENTREGADO' ? '<span class="sub">Sin calificar</span>' : '<span class="sub">—</span>'));
      const acc = [
        i.iniciadoEn ? `<button class="btn chico ${i.estado === 'ENTREGADO' ? 'primario' : ''}" data-revisar="${i.id}">${i.estado === 'ENTREGADO' ? 'Revisar y calificar' : 'Ver avance'}</button>` : '',
        (i.estado === 'GENERADO' || i.estado === 'ENVIADO') ? `<button class="btn chico" data-enviar="${e.id}" data-intento="${i.id}">${i.estado === 'ENVIADO' ? 'Reenviar' : 'Enviar'}</button> <button class="btn chico enlace-mal" data-anular="${i.id}">Anular</button>` : `<button class="btn chico enlace-mal" data-elim-int="${i.id}" title="Borrar el resultado de esta persona">Eliminar</button>`
      ].join(' ');
      return `<tr class="${i.estado === 'ANULADO' ? 'tenue' : ''}"><td><b>${esc(i.nombre)}</b><div class="sub">${esc(i.correo)}</div></td>
        <td>${insignia(i.estado)}${i.motivoCierre === 'tiempo' ? '<div class="sub">se acabó el tiempo</div>' : ''}${i.errorEnvio ? `<div class="sub mal">No se pudo enviar el correo: ${esc(i.errorEnvio)}</div>` : ''}</td>
        <td>${i.iniciadoEn ? `${i.respondidas} de ${i.preguntas} respondidas` : '<span class="sub">—</span>'}</td>
        <td>${nota}</td>
        <td>${i.incidencias ? `<span class="alerta" title="Salidas de la ventana, intentos de pegar, etc."><i class="fas fa-triangle-exclamation"></i> ${i.incidencias}</span>` : (i.iniciadoEn ? '<span class="sub">Ninguna</span>' : '')}</td>
        <td class="acc">${acc}</td></tr>`;
    }).join('');
    return `<div class="ex-card examen"><div class="ex-top"><div><h3 class="titulo">${esc(e.nombre)}</h3><div class="metas">${meta}<span class="meta tenue">${esc(fechaCorta(e.creadoEn))}</span></div></div>
        <div class="acciones">${paso ? `<button class="btn primario" ${paso.attr}><i class="fas ${paso.ico}"></i> ${paso.txt}</button>` : ''}
          ${items.length ? `<details class="menu"><summary class="btn">Más <i class="fas fa-chevron-down"></i></summary><div class="menu-lista">${items.join('')}</div></details>` : ''}</div></div>
      <div class="stats">${stat(r.enviadas.length, r.vivos.length, 'invitadas')}${stat(r.entregaron.length, r.vivos.length, 'entregaron')}${stat(r.calificadas.length, r.entregaron.length, 'calificadas')}</div>
      ${estadoRes}
      <div class="scroll"><table class="tabla gente"><tr><th>Evaluado</th><th>Estado</th><th>Avance</th><th>Nota</th><th>Incidencias</th><th></th></tr>${filas}</table></div></div>`;
  }

  function vistaExamenes() {
    const d = st.d;
    return `<div class="ex-top"><div><h2 style="margin:0">Mis exámenes</h2><small class="sub">Crea un examen, envía las invitaciones y califica lo que te entreguen.</small></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn" id="exActualizar" title="Actualizar"><i class="fas fa-rotate"></i></button><button class="btn primario" data-nuevo><i class="fas fa-plus"></i> Nuevo examen</button></div></div>
      ${d.examenes.length ? d.examenes.map(tarjetaExamen).join('')
        : `<div class="ex-card vacio-grande"><i class="fas fa-clipboard-list"></i><h3>Aún no has creado ningún examen</h3><p class="sub">Elige a quién evaluar, cuántas preguntas y cuánto tiempo. Les llegará un enlace por correo.</p><button class="btn primario" data-nuevo><i class="fas fa-plus"></i> Crear mi primer examen</button></div>`}`;
  }

  // ---------- ventana «Nuevo examen» ----------
  const FILTROS = [['perfiles', 'Perfil', 'PERFIL'], ['lineas', 'Línea de negocio', 'LINEA'], ['tipos', 'Tipo de pregunta', 'TIPO'], ['dificultades', 'Dificultad', 'DIFICULTAD']];
  function nxNuevo() { return { nombre: '', cant: 10, min: 45, vig: 7, pant: true, ia: false, adj: false, ev: new Set(), q: '', f: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, error: '' }; }

  function nxListaPersonas() {
    const n = st.nx, q = quitarTildes(n.q);
    const todos = st.d.perfiles.filter(f => f.rol === 'EVALUADO');
    const vis = todos.filter(f => !q || quitarTildes(`${f.nombre} ${f.perfil} ${f.correo}`).includes(q));
    return `<div class="lista-eval">${vis.length ? vis.map(f => `<label class="fila-chk"><input type="checkbox" data-nxev="${f.id}" ${n.ev.has(f.id) ? 'checked' : ''}><span><b>${esc(f.nombre)}</b> <span class="sub">· ${esc(f.perfil)}${f.lineas.length ? ' · ' + esc(f.lineas.join(', ')) : ' · todas las líneas'}</span></span></label>`).join('')
      : `<p class="vacio">${todos.length ? 'Nadie coincide con la búsqueda.' : 'Aún no hay personas para evaluar.'}</p>`}</div>`;
  }

  function nxHtml() {
    const d = st.d, n = st.nx;
    const avisos = [d.preguntas === 0 ? 'Todavía no tienes preguntas. <a href="#" data-ir="banco">Carga o escribe algunas en «Banco de preguntas»</a>.' : '',
      !d.perfiles.some(f => f.rol === 'EVALUADO') ? 'Todavía no hay personas para evaluar. <a href="#" data-ir="personas">Agrégalas en «Personas»</a>.' : ''].filter(Boolean);
    const sw = (id, on, titulo, ayuda) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="knob"></span><span class="sw-txt"><b>${titulo}</b><small>${ayuda}</small></span></label>`;
    const nFiltros = FILTROS.reduce((a, [k]) => a + n.f[k].length, 0);
    return `<div class="mdl-head"><h2>Nuevo examen</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
      <div class="mdl-body">
        ${avisos.map(a => `<p class="msg aviso">${a}</p>`).join('')}
        <section><h3><span class="paso">1</span> Datos del examen</h3>
          <div class="fila"><label>Nombre<input id="nxNombre" value="${esc(n.nombre)}" placeholder="Ej. Evaluación de ingreso Q4" maxlength="80"></label>
            <label>Preguntas por persona<input id="nxCant" type="number" min="1" max="100" value="${n.cant}"></label>
            <label>Tiempo (minutos)<input id="nxMin" type="number" min="1" max="600" value="${n.min}"></label>
            <label>El enlace vale (días)<input id="nxVig" type="number" min="1" max="60" value="${n.vig}"></label></div></section>
        <section><h3><span class="paso">2</span> ¿A quién evalúas? <span class="sub" id="nxCuenta">${n.ev.size ? n.ev.size + ' elegido(s)' : ''}</span></h3>
          <div class="barra-lista"><input type="search" id="nxBuscar" placeholder="Buscar persona" value="${esc(n.q)}"><button class="btn chico" data-nxtodos>Marcar / desmarcar todos</button></div>
          <div id="nxPersonas">${nxListaPersonas()}</div></section>
        <section><h3><span class="paso">3</span> Opciones</h3>
          ${sw('nxPant', n.pant, 'Exigir compartir toda la pantalla', 'Se toman capturas durante el examen para detectar si buscan respuestas en otro lugar.')}
          ${sw('nxAdj', n.adj, 'Permitir adjuntar archivos', 'Cada persona puede subir hasta 3 archivos por pregunta (10 MB cada uno).')}
          ${sw('nxIA', n.ia, 'Permitir calificar con IA', 'Les avisamos antes de empezar. La IA solo ve la pregunta y la respuesta, nunca nombres ni correos. Tú decides cuándo usarla.')}</section>
        <details class="avanzado" ${nFiltros ? 'open' : ''}><summary>Elegir qué preguntas entran <span class="sub">(opcional${nFiltros ? ' · ' + nFiltros + ' filtro(s)' : ': por defecto, según el perfil y las líneas de cada persona'})</span></summary>
          ${FILTROS.map(([k, tit, cat]) => `<div class="sub" style="margin-top:8px">${tit}</div><div class="chips">${(d.catalogo[cat] || []).map(v => `<span class="chip ${n.f[k].includes(v) ? 'on' : ''}" data-nxchip="${k}" data-v="${esc(v)}">${esc(v)}</span>`).join('')}</div>`).join('')}</details>
        <p class="msg mal" id="nxError" ${n.error ? '' : 'hidden'}>${esc(n.error)}</p>
      </div>
      <div class="mdl-pie"><span class="sub">Cada persona recibe preguntas distintas, sorteadas al azar.</span><button class="btn" data-cerrar>Cancelar</button><button class="btn primario" id="nxCrear"><i class="fas fa-check"></i> Crear examen</button></div>`;
  }

  function nxLeer() {
    const n = st.nx, g = id => document.getElementById(id);
    if (!n || !g('nxNombre')) return;
    Object.assign(n, { nombre: g('nxNombre').value, cant: Number(g('nxCant').value), min: Number(g('nxMin').value), vig: Number(g('nxVig').value), pant: g('nxPant').checked, adj: g('nxAdj').checked, ia: g('nxIA').checked });
  }

  function abrirNuevoExamen() {
    if (!st.nx) st.nx = nxNuevo();
    const m = modal(nxHtml(), { ancho: 760, antesCerrar: nxLeer });
    const rear = () => { nxLeer(); m.set(nxHtml()); enlazar2(); };
    const enlazar2 = () => {
      const b = m.box, n = st.nx;
      b.querySelectorAll('[data-cerrar]').forEach(x => x.onclick = () => m.cerrar());
      b.querySelectorAll('[data-ir]').forEach(a => a.onclick = ev => { ev.preventDefault(); m.cerrar(); st.tab = a.dataset.ir; pintar(); if (st.tab === 'banco') ejecutar(async () => { st.banco = Object.assign(st.banco || {}, { lista: (await rpc({ accion: 'banco_listar' })).preguntas }); }); });
      const lista = () => { const w = b.querySelector('#nxPersonas'); w.innerHTML = nxListaPersonas(); ligarPersonas(); b.querySelector('#nxCuenta').textContent = n.ev.size ? n.ev.size + ' elegido(s)' : ''; };
      const ligarPersonas = () => b.querySelectorAll('[data-nxev]').forEach(c => c.onchange = () => { const id = Number(c.dataset.nxev); c.checked ? n.ev.add(id) : n.ev.delete(id); b.querySelector('#nxCuenta').textContent = n.ev.size ? n.ev.size + ' elegido(s)' : ''; });
      ligarPersonas();
      b.querySelector('#nxBuscar').oninput = ev => { n.q = ev.target.value; lista(); const i = b.querySelector('#nxBuscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
      b.querySelector('[data-nxtodos]').onclick = () => {
        const q = quitarTildes(n.q), ids = st.d.perfiles.filter(f => f.rol === 'EVALUADO' && (!q || quitarTildes(`${f.nombre} ${f.perfil} ${f.correo}`).includes(q))).map(f => f.id);
        if (ids.every(i => n.ev.has(i))) ids.forEach(i => n.ev.delete(i)); else ids.forEach(i => n.ev.add(i));
        lista();
      };
      b.querySelectorAll('[data-nxchip]').forEach(c => c.onclick = () => { const a = n.f[c.dataset.nxchip], v = c.dataset.v, i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); rear(); });
      b.querySelector('#nxCrear').onclick = async ev => {
        nxLeer();
        const falla = !n.nombre.trim() ? 'Ponle un nombre al examen.' : !n.ev.size ? 'Elige al menos una persona para evaluar.'
          : !(n.cant >= 1 && n.cant <= 100) ? 'Las preguntas por persona deben ser entre 1 y 100.' : !(n.min >= 1 && n.min <= 600) ? 'El tiempo debe estar entre 1 y 600 minutos.' : !(n.vig >= 1 && n.vig <= 60) ? 'El enlace puede valer entre 1 y 60 días.' : '';
        const err = b.querySelector('#nxError');
        if (falla) { n.error = falla; err.textContent = falla; err.hidden = false; return; }
        n.error = ''; err.hidden = true;
        const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando…';
        try {
          const r = await rpc({ accion: 'examen_generar', nombre: n.nombre.trim(), cantidad: n.cant, minutos: n.min, vigenciaDias: n.vig, exigirPantalla: n.pant, permitirAdjuntos: n.adj, iaPermitida: n.ia, perfilIds: [...n.ev], filtros: n.f });
          const notas = r.detalle.filter(x => !x.ok || x.faltan).map(x => x.ok ? `${esc(x.nombre)}: solo hay ${x.preguntas} preguntas disponibles (faltan ${x.faltan})` : `${esc(x.nombre)}: ${esc(x.error)}`);
          st.nx = null; m.cerrar(); await recargar(); pintar();
          aviso('<b>Examen creado.</b> ' + (notas.length ? 'Ojo:<br>' + notas.join('<br>') : 'Ahora envía las invitaciones desde su tarjeta.'), notas.length ? 'aviso' : 'ok');
        } catch (e) {
          if (e.sesion) { setTimeout(() => location.reload(), 1200); }
          n.error = e.message; err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Crear examen';
        }
      };
    };
    enlazar2();
  }

  // ---------- ventana «Revisar» ----------
  async function abrirRevision(intentoId, tab) {
    const d = await rpc({ accion: 'intento_detalle', intentoId });
    const previo = st.rev && st.rev.id === intentoId ? st.rev : null;
    st.rev = Object.assign(d, { id: intentoId, tab: tab || (previo && previo.tab) || 'resp', edit: previo ? previo.edit : {}, sucio: previo ? previo.sucio : false });
    if (!st.revModal || !st.revModal.el.isConnected) {
      st.revModal = modal('', { ancho: 1000, alCerrar: () => { st.rev = null; st.revModal = null; }, puedeCerrar: () => !st.rev || !st.rev.sucio || window.confirm('Tienes notas sin guardar. ¿Cerrar sin guardarlas?') });
    }
    pintarRevision();
  }

  const valorCalif = (x, q) => { const e = x.edit[q.n]; return e ? e : { puntos: q.calificacion == null ? '' : String(Number(q.calificacion)), comentario: q.comentario || '' }; };
  function totalesRevision() {
    const x = st.rev; let suma = 0, n = 0;
    x.preguntas.forEach(q => { const v = valorCalif(x, q); if (v.puntos !== '' && !isNaN(Number(v.puntos))) { suma += Number(v.puntos); n++; } });
    return { suma, n, total: x.preguntas.length, maximo: Number(x.maximo) };
  }
  function leerCalif() {
    const x = st.rev, m = st.revModal; if (!x || !m) return;
    m.box.querySelectorAll('[data-cn]').forEach(i => { const n = Number(i.dataset.cn), c = m.box.querySelector(`[data-cc="${n}"]`); x.edit[n] = { puntos: i.value, comentario: c ? c.value : '' }; });
  }
  function refrescarTotales() {
    const x = st.rev, m = st.revModal; if (!x || !m) return;
    const t = totalesRevision(), g = id => m.box.querySelector(id);
    if (g('#revNota')) { g('#revNota').textContent = t.n ? fmtPts(t.suma) : '—'; g('#revPct').textContent = t.n ? `${pct(t.suma, t.maximo)} %` : ''; g('#revBarra').innerHTML = barra(t.suma, t.maximo); g('#revCont').textContent = `${t.n} de ${t.total} preguntas calificadas`; }
    const gu = g('#revGuardar'); if (gu) gu.disabled = !x.sucio;
    const av = g('#revSucio'); if (av) av.hidden = !x.sucio;
  }

  function pintarRevision() {
    const x = st.rev, m = st.revModal; if (!x || !m) return;
    const ex = st.d.examenes.find(e => e.intentos.some(i => i.id === x.id));
    const t = totalesRevision();
    const hayIA = x.preguntas.some(q => q.origenCalif === 'IA' && !x.edit[q.n]);
    const graves = x.eventos.filter(e => GRAVES.includes(e.tipo));
    const tabs = [['resp', 'Respuestas', x.preguntas.length, ''], ['inc', 'Incidencias', graves.length, graves.length ? 'alerta' : ''], ['cap', 'Capturas', x.capturas.length, '']];
    const resumenTxt = ESTADO_TXT[x.estado] ? ESTADO_TXT[x.estado][0] : x.estado;
    let cuerpo = '';
    if (x.tab === 'resp') {
      cuerpo = x.preguntas.map(q => {
        const v = valorCalif(x, q), max = Number(q.puntosMax);
        const origen = x.edit[q.n] ? '<span class="ins azul">Editada</span>' : q.origenCalif === 'IA' ? '<span class="ins morado" title="La calificó la IA: revísala y cámbiala si no estás de acuerdo">Sugerida por la IA</span>' : q.origenCalif === 'EXCEL' ? '<span class="ins gris">Cargada de Excel</span>' : q.origenCalif === 'MANUAL' ? '<span class="ins gris">Manual</span>' : '';
        return `<article class="preg"><header><span class="num">${q.n}</span><span class="enc">${esc(q.tipo)} · ${esc(q.codigo)}</span><span class="vale">Vale ${fmtPts(max)} pts</span></header>
          <p class="enunciado">${esc(q.pregunta)}</p>
          <div class="resp-caja"><div class="et">Respuesta del evaluado</div>${q.respuesta ? `<div class="txt">${esc(q.respuesta)}</div>` : '<div class="sub">No respondió.</div>'}
            ${(q.archivos || []).length ? `<div class="adjs">${q.archivos.map(a => `<button class="btn chico" data-ver="${a.id}" data-nombre="${esc(a.nombre)}" data-mime="${esc(a.mime)}"><i class="fas ${icoMime(a.mime)}"></i> ${esc(a.nombre)} · ${tam(a.tamano)}</button>`).join('')}</div>` : ''}</div>
          ${q.respuestaModelo ? `<details class="modelo"><summary>Ver la respuesta modelo</summary><div class="txt">${esc(q.respuestaModelo)}</div></details>` : '<p class="sub" style="margin:6px 0">Esta pregunta no tiene respuesta modelo.</p>'}
          <div class="calif2"><div class="pts"><label>Nota</label><div class="entrada-pts"><input type="number" min="0" max="${max}" step="0.5" data-cn="${q.n}" value="${esc(v.puntos)}" placeholder="—"><span>/ ${fmtPts(max)}</span></div>
              <div class="rapidos"><button data-rap="0" data-n="${q.n}" data-max="${max}">0</button><button data-rap="mitad" data-n="${q.n}" data-max="${max}">Mitad</button><button data-rap="max" data-n="${q.n}" data-max="${max}">Completa</button></div></div>
            <div class="com"><label>Comentario <span class="sub">(opcional)</span></label><textarea rows="2" data-cc="${q.n}" placeholder="Qué estuvo bien o qué faltó">${esc(v.comentario)}</textarea></div><div class="orig">${origen}</div></div></article>`;
      }).join('');
    } else if (x.tab === 'inc') {
      const cuenta = {}; x.eventos.forEach(e => { cuenta[e.tipo] = (cuenta[e.tipo] || 0) + 1; });
      const fuera = x.eventos.reduce((a, e) => a + (Number(e.segundos) || 0), 0);
      cuerpo = !x.eventos.length ? '<div class="vacio-grande chico"><i class="fas fa-shield-check"></i><h3>Sin incidencias</h3><p class="sub">No salió de la ventana ni intentó copiar o pegar.</p></div>'
        : `<div class="resumen-inc">${graves.length ? `<b>${graves.length} cosa(s) para revisar</b>` : '<b>Nada grave</b>'}${fuera ? ` · estuvo fuera de la ventana ${fuera} s en total` : ''}<div class="sub">${Object.entries(cuenta).map(([k, n]) => `${esc(NOMBRE_EVENTO[k] || k)}: ${n}`).join(' · ')}</div></div>
          <div class="scroll"><table class="tabla"><tr><th>Hora</th><th>Qué pasó</th><th>Detalle</th></tr>${x.eventos.map(e => `<tr class="${GRAVES.includes(e.tipo) ? 'fila-alerta' : ''}"><td>${hora(e.en)}</td><td>${esc(NOMBRE_EVENTO[e.tipo] || e.tipo)}</td><td class="sub">${esc(e.detalle || '')}${e.segundos ? ` · ${e.segundos} s fuera` : ''}</td></tr>`).join('')}</table></div>`;
    } else {
      cuerpo = !x.capturas.length ? `<div class="vacio-grande chico"><i class="fas fa-camera"></i><h3>Sin capturas</h3><p class="sub">${x.pantallaOk ? 'No se guardó ninguna.' : 'Esta persona no compartió su pantalla.'}</p></div>`
        : `<p class="sub">Toca una hora para ver lo que había en su pantalla en ese momento.</p><div class="caps">${x.capturas.map(c => `<button class="btn chico" data-captura="${c.id}"><i class="fas fa-camera"></i> ${hora(c.en)} <span class="sub">${esc(c.motivo || '')}</span></button>`).join('')}</div><div id="revCap"></div>`;
    }
    m.set(`<div class="mdl-head sticky"><div><h2>${esc(x.nombre)}</h2><div class="sub">${esc(resumenTxt)}${x.iniciadoEn ? ' · empezó ' + esc(fechaCorta(x.iniciadoEn)) : ''}${x.entregadoEn ? ' · entregó ' + esc(fechaCorta(x.entregadoEn)) : ''}${x.motivoCierre === 'tiempo' ? ' (se acabó el tiempo)' : ''}</div></div><button class="x" data-rcerrar aria-label="Cerrar">×</button></div>
      <div class="rev-resumen"><div class="nota-bloque"><div class="nota-grande"><b id="revNota">${t.n ? fmtPts(t.suma) : '—'}</b><span> / ${fmtPts(t.maximo)} puntos</span> <em id="revPct">${t.n ? pct(t.suma, t.maximo) + ' %' : ''}</em></div><div id="revBarra">${barra(t.suma, t.maximo)}</div><div class="sub" id="revCont">${t.n} de ${t.total} preguntas calificadas</div></div>
        <div class="rev-acciones">${ex && ex.iaPermitida ? `<button class="btn ${t.n < t.total ? 'primario' : ''}" id="revIA"><i class="fas fa-wand-magic-sparkles"></i> Calificar con IA</button>` : ''}
          <button class="btn primario" id="revGuardar" ${x.sucio ? '' : 'disabled'}><i class="fas fa-floppy-disk"></i> Guardar notas</button></div></div>
      <div class="sub aviso-sucio" id="revSucio" ${x.sucio ? '' : 'hidden'}>Tienes cambios sin guardar.</div>
      ${hayIA ? '<p class="aviso-ia"><i class="fas fa-wand-magic-sparkles"></i> Hay notas sugeridas por la IA. Revísalas: puedes cambiar cualquiera y luego pulsar «Guardar notas».</p>' : ''}
      <div class="tabs-mini">${tabs.map(([k, n, c, cl]) => `<button data-rtab="${k}" class="${x.tab === k ? 'on' : ''}">${n} <span class="cnt ${cl}">${c}</span></button>`).join('')}</div>
      <div class="mdl-body">${cuerpo}</div>`);
    enlazarRevision();
  }

  function enlazarRevision() {
    const x = st.rev, m = st.revModal, b = m.box;
    b.querySelector('[data-rcerrar]').onclick = () => m.intentarCerrar();
    b.querySelectorAll('[data-rtab]').forEach(t => t.onclick = () => { leerCalif(); x.tab = t.dataset.rtab; pintarRevision(); });
    b.querySelectorAll('[data-ver]').forEach(v => v.onclick = () => verArchivo(Number(v.dataset.ver), v.dataset.nombre, v.dataset.mime));
    b.querySelectorAll('[data-captura]').forEach(c => c.onclick = async () => {
      const box = b.querySelector('#revCap'); box.innerHTML = '<p class="sub">Cargando captura…</p>';
      try { const r = await rpc({ accion: 'captura_ver', capturaId: Number(c.dataset.captura) }); box.innerHTML = `<img class="cap-img" src="${r.imagen}" alt="Captura de pantalla">`; }
      catch (e) { box.innerHTML = `<p class="msg mal">${esc(e.message)}</p>`; }
    });
    const marcar = () => { x.sucio = true; leerCalif(); refrescarTotales(); };
    b.querySelectorAll('[data-cn],[data-cc]').forEach(i => i.oninput = marcar);
    b.querySelectorAll('[data-rap]').forEach(r => r.onclick = () => {
      const inp = b.querySelector(`[data-cn="${r.dataset.n}"]`), max = Number(r.dataset.max);
      inp.value = r.dataset.rap === '0' ? '0' : r.dataset.rap === 'max' ? String(max) : String(Math.round(max / 2 * 2) / 2);
      marcar();
    });
    const ia = b.querySelector('#revIA');
    if (ia) ia.onclick = () => { const ex = st.d.examenes.find(e => e.intentos.some(i => i.id === x.id)); calificarIA(ex.id, x.id, false).catch(e => aviso(esc(e.message), 'mal')); };
    const gu = b.querySelector('#revGuardar');
    if (gu) gu.onclick = () => ejecutar(async () => {
      leerCalif();
      const items = x.preguntas.map(q => ({ n: q.n, puntos: x.edit[q.n] ? x.edit[q.n].puntos : (q.calificacion == null ? '' : String(q.calificacion)), comentario: x.edit[q.n] ? x.edit[q.n].comentario : (q.comentario || '') }));
      const r = await rpcRes({ accion: 'calificar', intentoId: x.id, items });
      x.edit = {}; x.sucio = false;
      await recargar(); await abrirRevision(x.id);
      aviso(`<b>Notas guardadas.</b> ${fmtPts(r.puntos || 0)} de ${fmtPts(r.maximo)} puntos.`);
    }, gu);
  }

  // ---------- calificar con IA: explicación, avance y resumen ----------
  async function calificarIA(examenId, intentoId, recalificar) {
    const pre = await rpcRes({ accion: 'ia_pendientes', examenId, intentoId, recalificar, limite: 1 });
    if (!pre.restantes) { aviso(recalificar ? 'La IA todavía no ha calificado nada que se pueda volver a calificar.' : 'No hay nada pendiente: todas las respuestas ya tienen nota.', 'aviso'); return; }
    const total = pre.restantes;
    const m = modal(`<div class="mdl-body centro"><div class="gran-ico morado"><i class="fas fa-wand-magic-sparkles"></i></div>
        <h2>Calificar ${total} respuesta${total === 1 ? '' : 's'} con IA</h2>
        <ul class="lista-ayuda"><li><i class="fas fa-check"></i><span>La IA <b>sugiere</b> una nota y un comentario para cada respuesta. Tú decides: puedes cambiar cualquiera.</span></li>
          <li><i class="fas fa-user-shield"></i><span>No ve nombres ni correos: solo la pregunta, la respuesta modelo y lo que escribió la persona.</span></li>
          <li><i class="fas fa-hand"></i><span>Las notas que ya pusiste a mano <b>no se tocan</b>.</span></li></ul></div>
        <div class="mdl-pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si><i class="fas fa-wand-magic-sparkles"></i> Calificar ${total}</button></div>`, { ancho: 500 });
    m.box.querySelector('[data-no]').onclick = () => m.cerrar();
    m.box.querySelector('[data-si]').onclick = () => correrIA(m, { examenId, intentoId, recalificar, total });
  }

  async function correrIA(m, { examenId, intentoId, recalificar, total }) {
    m.cerrable = false;
    let parar = false;
    m.set(`<div class="mdl-body centro"><div class="gran-ico morado"><i class="fas fa-wand-magic-sparkles fa-beat-fade"></i></div><h2>La IA está calificando…</h2>
      <p id="iaTxt" class="txt-ayuda">Preparando…</p><div class="barra-prog"><i id="iaBar" style="width:0%"></i></div>
      <p class="sub">Tarda unos segundos por cada 6 respuestas. Puedes esperar aquí.</p></div>
      <div class="mdl-pie"><button class="btn" id="iaStop">Detener</button></div>`);
    m.box.querySelector('#iaStop').onclick = e => { parar = true; e.currentTarget.disabled = true; e.currentTarget.textContent = 'Deteniendo…'; };
    const tot = { guardadas: 0, tokens: 0, errores: [] };
    let restantes = total, sinAvance = 0, fallo = '';
    for (let vuelta = 0; vuelta < 400 && restantes > 0 && !parar; vuelta++) {
      const hechas = total - restantes;
      const t = m.box.querySelector('#iaTxt'), bar = m.box.querySelector('#iaBar');
      if (t) t.textContent = `${hechas} de ${total} respuestas`; if (bar) bar.style.width = `${Math.round(100 * hechas / total)}%`;
      let r;
      try { r = await fb()._post({ accion: 'examenCalificarIA', token: st.ses.token, examenId, intentoId, recalificar }); }
      catch (e) { fallo = 'Se perdió la conexión.'; break; }
      if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } fallo = (r && r.error) || 'No se pudo calificar con IA.'; break; }
      tot.guardadas += r.guardadas; tot.tokens += r.tokens || 0; tot.errores.push(...(r.errores || []));
      restantes = r.restantes;
      if (!r.guardadas) { if (++sinAvance >= 2) break; } else sinAvance = 0;
    }
    m.cerrable = true;
    try { await recargar(); if (st.rev) { st.rev = Object.assign(await rpc({ accion: 'intento_detalle', intentoId: st.rev.id }), { id: st.rev.id, tab: st.rev.tab, edit: st.rev.edit, sucio: st.rev.sucio }); pintarRevision(); } pintar(); } catch (e) { /* se vuelve a cargar al actualizar */ }
    const ok = !fallo && !restantes && !tot.errores.length, parcial = tot.guardadas > 0;
    const lleno = restantes === 0 && !fallo;
    const primero = st.d.examenes.flatMap(e => e.intentos).filter(i => i.estado === 'ENTREGADO' && i.calificadas > 0).find(i => !intentoId || i.id === intentoId);
    m.set(`<div class="mdl-body centro"><div class="gran-ico ${ok ? 'verde' : parcial ? 'ambar' : 'rojo'}"><i class="fas ${ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i></div>
        <h2>${ok ? 'Listo: la IA calificó ' + tot.guardadas + ' respuesta' + (tot.guardadas === 1 ? '' : 's') : parcial ? `Se calificaron ${tot.guardadas} de ${total}` : 'No se pudo calificar'}</h2>
        ${fallo ? `<p class="msg mal" style="text-align:left">${esc(fallo)}</p>` : ''}
        ${tot.errores.length ? `<p class="msg aviso" style="text-align:left">${tot.errores.length} respuesta(s) con problema: ${tot.errores.slice(0, 3).map(e => esc(e.error)).join(' · ')}</p>` : ''}
        ${lleno || parcial ? '<p class="txt-ayuda">Las notas quedaron marcadas como <span class="ins morado">Sugerida por la IA</span>. <b>Revísalas</b> y cambia las que no te convenzan.</p>' : ''}
        ${!lleno && (fallo || restantes) ? '<p class="sub">Puedes volver a pulsar «Calificar con IA» para continuar con lo que falta.</p>' : ''}
        ${tot.tokens ? `<p class="sub">Uso de IA: ≈ ${tot.tokens.toLocaleString('es-EC')} tokens</p>` : ''}</div>
      <div class="mdl-pie"><button class="btn ${primero && !st.rev ? '' : 'primario'}" data-cerrar>Entendido</button>${primero && !st.rev && parcial ? '<button class="btn primario" data-ver-notas>Revisar las notas</button>' : ''}</div>`);
    m.box.querySelector('[data-cerrar]').onclick = () => m.cerrar();
    const vn = m.box.querySelector('[data-ver-notas]');
    if (vn) vn.onclick = () => { m.cerrar(); ejecutar(() => abrirRevision(primero.id), null); };
  }

  // ---------- acciones de las tarjetas ----------
  function enlazarExamenes(q) {
    q('[data-nuevo]', b => b.onclick = () => abrirNuevoExamen());
    const act = document.getElementById('exActualizar'); if (act) act.onclick = () => ejecutar(async () => { await recargar(); aviso('Lista actualizada.'); }, act);
    q('[data-revisar]', b => b.onclick = () => ejecutar(() => abrirRevision(Number(b.dataset.revisar)), b));
    q('[data-ia]', b => b.onclick = () => ejecutar(() => calificarIA(Number(b.dataset.ia), undefined, !!b.dataset.iaRe), b));
    q('[data-enviar]', b => b.onclick = () => ejecutar(async () => {
      aviso('Enviando invitaciones…', 'aviso');
      const r = await fb()._post({ accion: 'examenEnviar', token: st.ses.token, examenId: Number(b.dataset.enviar), intentoIds: b.dataset.intento ? [Number(b.dataset.intento)] : undefined });
      if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } throw new Error((r && r.error) || 'No se pudieron enviar las invitaciones'); }
      await recargar();
      aviso(`<b>${r.enviados} invitación(es) enviada(s).</b>${r.fallos ? ` ${r.fallos} no se pudieron enviar: míralas en la tabla.` : ' Cada persona recibirá un enlace por correo.'}`, r.fallos ? 'aviso' : 'ok');
    }, b));
    q('[data-anular]', b => b.onclick = async () => {
      if (await preguntar({ titulo: 'Anular esta invitación', texto: 'El enlace dejará de funcionar y la persona ya no podrá rendir este examen.', si: 'Sí, anular', no: 'No', peligro: true })) {
        ejecutar(async () => { await rpc({ accion: 'examen_anular', intentoId: Number(b.dataset.anular) }); await recargar(); aviso('Invitación anulada.'); }, b);
      }
    });
    q('[data-elim-ex]', b => b.onclick = async () => {
      const e = st.d.examenes.find(x => x.id === Number(b.dataset.elimEx)); if (!e) return;
      const r = resumenExamen(e), n = a => a.length;
      const resp = e.intentos.reduce((a, i) => a + (i.respondidas || 0), 0), caps = e.intentos.reduce((a, i) => a + (i.capturas || 0), 0);
      const conDatos = n(r.entregaron) || n(r.rindiendo) || resp || caps;
      const ok = await preguntar({
        titulo: `Eliminar «${e.nombre}»`, peligro: true, si: 'Eliminar para siempre', no: 'Cancelar', escribir: conDatos ? e.nombre : null,
        texto: `<p>Se borrará <b>todo</b> lo de este examen y <b>no se puede deshacer</b>:</p>
          <ul class="lista-ayuda"><li><i class="fas fa-users"></i><span>${n(e.intentos)} persona(s) con sus invitaciones y enlaces</span></li>
            ${conDatos ? `<li><i class="fas fa-file-lines"></i><span>${resp} respuesta(s), ${caps} captura(s) de pantalla, incidencias y notas</span></li>` : ''}
            <li><i class="fas fa-shield-halved"></i><span>Tu banco de preguntas y las personas <b>no</b> se borran</span></li></ul>
          ${n(r.entregaron) ? '<p><button class="btn chico" data-dlxl><i class="fas fa-file-excel"></i> Descargar el Excel de resultados antes</button></p>' : ''}`,
        alAbrir: m => { const d = m.box.querySelector('[data-dlxl]'); if (d) d.onclick = () => ejecutar(async () => { descargarResultados((await rpcRes({ accion: 'resultados', examenId: e.id })).resultados); aviso('Excel descargado. Ya puedes eliminar el examen.'); }, d); }
      });
      if (ok) ejecutar(async () => { await rpc({ accion: 'examen_eliminar', examenId: e.id }); if (st.rev) st.revModal && st.revModal.cerrar(); await recargar(); aviso(`Examen «${esc(e.nombre)}» eliminado.`); }, b);
    });
    q('[data-elim-int]', b => b.onclick = async () => {
      const id = Number(b.dataset.elimInt), e = st.d.examenes.find(x => x.intentos.some(i => i.id === id)), i = e && e.intentos.find(x => x.id === id); if (!i) return;
      const ok = await preguntar({ titulo: `Eliminar el resultado de ${i.nombre}`, peligro: true, si: 'Eliminar resultado', no: 'Cancelar',
        texto: `<p>Se borrarán para siempre sus respuestas, incidencias, capturas y notas <b>de este examen</b>.</p><p class="sub">${i.estado === 'ANULADO' ? 'Su invitación ya estaba anulada.' : 'Su enlace dejará de funcionar.'} El examen y las demás personas no cambian.</p>` });
      if (ok) ejecutar(async () => { await rpc({ accion: 'intento_eliminar', intentoId: id }); if (st.rev && st.rev.id === id && st.revModal) st.revModal.cerrar(); await recargar(); aviso(`Se eliminó el resultado de ${esc(i.nombre)}.`); }, b);
    });
    q('[data-xl]', b => b.onclick = () => ejecutar(async () => { descargarResultados((await rpcRes({ accion: 'resultados', examenId: Number(b.dataset.xl) })).resultados); aviso('Se descargó el Excel de resultados.'); }, b));
    q('[data-xmail]', b => b.onclick = () => ejecutar(async () => {
      aviso('Preparando el Excel y enviándolo a tu correo…', 'aviso');
      const r = await fb()._post({ accion: 'examenResultados', token: st.ses.token, examenId: Number(b.dataset.xmail) });
      if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } throw new Error((r && r.error) || 'No se pudo enviar'); }
      await recargar(); aviso(`<b>Listo.</b> Te enviamos el Excel a ${esc(r.destinatario)}.`);
    }, b));
    q('[data-xcarga]', b => b.onclick = () => elegirArchivo('.xlsx,.xls', f => ejecutar(async () => {
      aviso('Cargando calificaciones…', 'aviso');
      const r = await cargarCalificaciones(f, Number(b.dataset.xcarga));
      if (st.rev) st.rev = Object.assign(await rpc({ accion: 'intento_detalle', intentoId: st.rev.id }), { id: st.rev.id, tab: st.rev.tab, edit: {}, sucio: false });
      await recargar(); if (st.rev) pintarRevision();
      aviso(`<b>${r.guardadas}</b> calificación(es) cargadas de ${r.total} fila(s).` + (r.errores.length ? `<br>Con error (${r.errores.length}): ` + r.errores.slice(0, 5).map(e => `${esc(e.id)}: ${esc(e.error)}`).join(' · ') : ''), r.errores.length ? 'aviso' : 'ok');
    }, null)));
    q('.menu', d => d.addEventListener('click', ev => { if (ev.target.closest('button')) d.open = false; }));
  }

  // Los menús «Más» se cierran al tocar fuera
  document.addEventListener('click', ev => document.querySelectorAll('details.menu[open]').forEach(m => { if (!m.contains(ev.target)) m.open = false; }));

  // ---------- formulario de una pregunta ----------
  function nuevaPregunta(q) {
    st.sel.pq_perfiles = q ? [...q.perfiles] : []; st.sel.pq_lineas = q ? [...q.lineas] : [];
    st.pq = q ? { id: q.id, codigo: q.codigo, tipo: q.tipo, dificultad: q.dificultad || '', puntos: String(q.puntos ?? 10), pregunta: q.pregunta, modelo: q.respuestaModelo || '' }
      : { id: null, codigo: '', tipo: '', dificultad: '', puntos: '10', pregunta: '', modelo: '' };
  }
  function leerFormPregunta() {
    if (!st.pq || !document.getElementById('pqTexto')) return;
    Object.assign(st.pq, { codigo: val('pqCod').trim(), tipo: val('pqTipo'), dificultad: val('pqDif'), puntos: val('pqPts'), pregunta: val('pqTexto'), modelo: val('pqModelo') });
  }
  async function guardarPregunta(adjuntar) {
    leerFormPregunta();
    const f = st.pq;
    const r = await rpc({ accion: 'pregunta_guardar', id: f.id || undefined, codigo: f.codigo, tipo: f.tipo, dificultad: f.dificultad, puntos: f.puntos, pregunta: f.pregunta,
      respuestaModelo: f.modelo, perfiles: st.sel.pq_perfiles, lineas: st.sel.pq_lineas });
    st.banco = Object.assign(st.banco || {}, { lista: (await rpc({ accion: 'banco_listar' })).preguntas });
    st.pq = null; st.adj = adjuntar ? r.id : st.adj;
    aviso(`Pregunta ${esc(r.codigo)} guardada.${adjuntar ? ' Ahora puedes adjuntarle archivos.' : ''}`);
    await recargar();
  }

  function vistaBanco() {
    const b = st.banco;
    const rep = b && b.reporte ? `<div class="msg ${b.reporte.errores.length ? 'aviso' : 'ok'}"><b>${b.reporte.guardadas}</b> preguntas guardadas${b.reporte.errores.length ? `, <b>${b.reporte.errores.length}</b> con error:` : '.'}
      ${b.reporte.errores.length ? `<ul>${b.reporte.errores.slice(0, 40).map(e => `<li>Fila ${e.fila}${e.codigo ? ' (' + esc(e.codigo) + ')' : ''}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}</div>` : '';
    const lista = b && b.lista ? `<div class="scroll"><table class="tabla"><tr><th>ID</th><th>Usuario</th><th>Línea</th><th>Tipo</th><th>Dif.</th><th>Pts</th><th>Pregunta</th><th>Adjuntos</th><th></th></tr>
      ${b.lista.map(q => `<tr><td>${esc(q.codigo)}</td><td>${esc(q.perfiles.join(', ') || 'Todos')}</td><td>${esc(q.lineas.join(', ') || 'Todas')}</td><td>${esc(q.tipo)}</td><td>${esc(q.dificultad || '')}</td><td>${Number(q.puntos)}</td>
        <td>${esc(q.pregunta)}${q.respuestaModelo ? `<br><small class="sub">Modelo: ${esc(q.respuestaModelo.slice(0, 160))}${q.respuestaModelo.length > 160 ? '…' : ''}</small>` : ''}</td>
        <td><button class="btn chico" data-adj="${q.id}"><i class="fas fa-paperclip"></i> ${(q.adjuntos || []).length}</button></td>
        <td style="white-space:nowrap"><button class="btn chico" data-editar="${q.id}">Editar</button> <button class="btn chico peligro" data-borrar="${q.id}">Eliminar</button></td></tr>`).join('')}</table></div>` : '<p class="vacio">Cargando…</p>';
    const qa = st.adj && b && b.lista ? b.lista.find(x => x.id === st.adj) : null;
    const panel = qa ? `<div class="ex-card"><div class="ex-top"><div><h2 style="margin:0">Adjuntos de ${esc(qa.codigo)}</h2><small class="sub">${esc(qa.pregunta.slice(0, 140))}</small></div><button class="btn chico" id="adjCerrar">Cerrar</button></div>
      <p class="sub">Material que verá el evaluado dentro de la pregunta: imágenes, audio, video, PDF o documentos (hasta 25 MB cada uno), o enlaces https (YouTube, Drive, SharePoint…). Máximo 5 por pregunta.</p>
      ${(qa.adjuntos || []).map((a, i) => `<div class="adj-fila"><i class="fas ${a.tipo === 'enlace' ? 'fa-link' : icoMime(a.mime)}"></i>
        <span>${a.tipo === 'enlace' ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.titulo || a.url)}</a>` : `${esc(a.nombre)} <span class="sub">· ${tam(a.tamano)}</span>`}</span>
        ${a.tipo === 'archivo' ? `<button class="btn chico" data-ver="${a.id}" data-nombre="${esc(a.nombre)}" data-mime="${esc(a.mime)}">Ver</button>` : ''}
        <button class="btn chico peligro" data-adjq="${i}">Quitar</button></div>`).join('') || '<p class="sub">Sin adjuntos.</p>'}
      <div class="fila" style="margin-top:12px"><label>Subir archivos<input type="file" id="adjFile" multiple></label>
        <label>Agregar enlace<input id="adjUrl" placeholder="https://…"></label><label>Título del enlace (opcional)<input id="adjTit"></label></div>
      <button class="btn" id="adjEnlace">Agregar enlace</button> <span class="sub" id="adjProg"></span></div>` : '';
    const mv = st.mv, listaQ = (b && b.lista) || [];
    const optsQ = sel => `<option value="">— Omitir —</option>${listaQ.map(q => `<option value="${q.id}" ${q.id === sel ? 'selected' : ''}>${esc(q.codigo)} · ${esc(q.pregunta.slice(0, 50))}</option>`).join('')}`;
    const nListos = mv.items.filter(it => it.estado === 'listo').length;
    const masivo = `<div class="ex-card"><h2>Cargar material en bloque</h2>
      <p class="sub">Elige una <b>carpeta</b>, varios archivos o un <b>ZIP</b>. Cada archivo se asigna solo a la pregunta cuyo código aparezca al inicio de su nombre (<code>P001.png</code>, <code>P001_diagrama.png</code>, <code>P001 - audio.mp3</code>) o en el nombre de su carpeta (<code>P001/esquema.pdf</code>). Antes de subir puedes revisar y corregir cada asignación.</p>
      <label class="btn chico" style="display:inline-block"><i class="fas fa-folder-open"></i> Elegir carpeta<input type="file" id="mvCarpeta" webkitdirectory multiple hidden></label>
      <label class="btn chico" style="display:inline-block"><i class="fas fa-file-zipper"></i> Elegir archivos o ZIP<input type="file" id="mvArchivos" multiple hidden></label>
      ${mv.items.length ? `<button class="btn chico" id="mvLimpiar">Vaciar lista</button>` : ''}
      ${mv.resumen ? `<p class="msg ok">${esc(mv.resumen)}</p>` : ''}
      ${mv.items.length ? `<div class="scroll"><table class="tabla"><tr><th>Archivo</th><th>Tamaño</th><th>Pregunta</th><th>Estado</th></tr>
        ${mv.items.map((it, i) => `<tr><td>${esc(it.ruta)}</td><td>${tam(it.file.size)}</td>
          <td>${it.estado === 'subido' ? '' : `<select class="sel-chico" data-mvsel="${i}" style="max-width:260px">${optsQ(it.preguntaId)}</select>`}</td>
          <td>${it.estado === 'listo' ? '<span class="etq ENVIADO">LISTO</span>' : `<span class="etq ${it.estado === 'error' ? 'ANULADO' : 'GENERADO'}">${it.estado === 'error' ? 'ERROR' : 'OMITIDO'}</span> <small class="sub">${esc(it.motivo)}</small>`}</td></tr>`).join('')}</table></div>
        <button class="btn primario" id="mvSubir" ${nListos && !mv.subiendo ? '' : 'disabled'}><i class="fas fa-cloud-arrow-up"></i> ${mv.subiendo ? 'Subiendo…' : `Subir ${nListos} archivo(s)`}</button> <span class="sub" id="mvProg"></span>` : ''}</div>`;
    const f = st.pq, cat = st.d.catalogo;
    const formulario = !f ? `<div class="ex-card ex-top"><div><h2 style="margin:0">Agregar una pregunta</h2><small class="sub">Escríbela aquí, sin Excel. Después puedes adjuntarle archivos.</small></div><button class="btn primario" id="pqAbrir"><i class="fas fa-plus"></i> Nueva pregunta</button></div>`
      : `<div class="ex-card"><div class="ex-top"><h2 style="margin:0">${f.id ? 'Editar pregunta ' + esc(f.codigo) : 'Nueva pregunta'}</h2><button class="btn chico" id="pqCerrar">Cancelar</button></div>
      <div class="fila"><label>ID <span class="sub">(opcional: si lo dejas vacío se asigna solo)</span><input id="pqCod" value="${esc(f.codigo)}" placeholder="Ej. P101"></label>
        <label>Tipo de pregunta<select id="pqTipo">${(cat.TIPO || []).map(v => `<option ${v === (f.tipo || cat.TIPO[0]) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Dificultad<select id="pqDif"><option value="">—</option>${(cat.DIFICULTAD || []).map(v => `<option ${v === f.dificultad ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Puntos que vale<input id="pqPts" type="number" min="0.5" max="1000" step="0.5" value="${esc(f.puntos)}"></label></div>
      <div class="sub">¿A quién aplica? Perfil (sin marcar = todos)</div>${chips('pq_perfiles', cat.PERFIL || [])}
      <div class="sub">Líneas de negocio (sin marcar = todas)</div>${chips('pq_lineas', cat.LINEA || [])}
      <label>Pregunta<textarea id="pqTexto" rows="4" placeholder="Escribe la pregunta tal como la verá el evaluado">${esc(f.pregunta)}</textarea></label>
      <label>Respuesta modelo <span class="sub">(opcional; la verá solo el evaluador, para calificar después)</span><textarea id="pqModelo" rows="4">${esc(f.modelo)}</textarea></label>
      <button class="btn primario" id="pqGuardar"><i class="fas fa-floppy-disk"></i> Guardar pregunta</button>
      <button class="btn" id="pqGuardarAdj"><i class="fas fa-paperclip"></i> Guardar y adjuntar archivos</button></div>`;
    return `${panel}${formulario}${masivo}<div class="ex-card"><h2>Cargar preguntas desde Excel</h2>
      <p class="sub">Columnas: ID, Usuario, Línea de negocio, Dificultad (opcional), Tipo de pregunta, Pregunta y Respuesta modelo. Para varias opciones sepáralas con «;» (Pasante;Ingeniero). Vacío = aplica a todos. Si el ID ya existe se actualiza. Opcional: «Puntos» (lo que vale la pregunta; si falta, 10) y «Enlaces» con enlaces https (separados por «;»); los archivos se adjuntan después, pregunta por pregunta, con el clip.</p>
      <input type="file" id="exArchivo" accept=".xlsx,.xls" style="max-width:360px"> <button class="btn chico" id="exPlantilla"><i class="fas fa-download"></i> Descargar plantilla</button>
      ${rep}</div>
      <div class="ex-card"><h2>Banco de preguntas (${b && b.lista ? b.lista.length : '…'})</h2>${lista}</div>`;
  }

  function vistaPersonas() {
    const d = st.d, cat = d.catalogo, P = st.pers;
    const unidades = [...new Set(st.emps.map(e => e.unidad).filter(Boolean))].sort();
    const areas = [...new Set(st.emps.filter(e => !P.unidad || e.unidad === P.unidad).map(e => e.area).filter(Boolean))].sort();
    const nombreDe = id => (empPorId(id) || {}).nombre || id;
    const visibles = visiblesDe();
    const nCambios = visibles.filter(hayCambio).length;
    const filas = visibles.map(e => {
      const v = valorDe(e), cambio = hayCambio(e);
      const sinCorreo = v.evaluado && !v.correo;
      return `<tr class="${cambio ? 'fila-cambio' : ''}"><td><b>${esc(e.nombre)}</b><div class="sub">${esc(e.id)} · ${esc(e.cargo || e.cargoNomina || '')}</div></td>
        <td class="sub">${esc(e.evaluadorId ? nombreDe(e.evaluadorId) : '—')}</td>
        <td style="text-align:center"><input type="checkbox" class="chk" data-p="evaluado" data-id="${esc(e.id)}" ${v.evaluado ? 'checked' : ''}></td>
        <td style="text-align:center"><input type="checkbox" class="chk" data-p="evaluador" data-id="${esc(e.id)}" ${v.evaluador ? 'checked' : ''} ${d.master ? '' : 'disabled title="Solo el administrador master asigna evaluadores"'}></td>
        <td>${v.evaluado ? `<select class="sel-chico ${v.perfil ? '' : 'falta'}" data-p="perfil" data-id="${esc(e.id)}"><option value="">— Perfil —</option>${(cat.PERFIL || []).map(o => `<option ${o === v.perfil ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : '<span class="sub">—</span>'}</td>
        <td>${v.evaluado ? `<div class="chips mini">${(cat.LINEA || []).map(o => `<span class="chip ${v.lineas.includes(o) ? 'on' : ''}" data-lin="${esc(o)}" data-id="${esc(e.id)}">${esc(o)}</span>`).join('')}</div>${v.lineas.length ? '' : '<div class="sub">Todas las líneas</div>'}` : '<span class="sub">—</span>'}</td>
        <td>${v.evaluado || v.evaluador ? `<input class="sel-chico ${sinCorreo ? 'falta' : ''}" type="email" data-p="correo" data-id="${esc(e.id)}" value="${esc(v.correo)}" placeholder="${v.evaluado ? 'correo para el examen' : 'correo para recibir resultados'}">` : `<span class="sub">${esc(v.correo)}</span>`}</td></tr>`;
    }).join('');
    const ext = d.perfiles.filter(f => !f.empleadoId);
    return `<div class="ex-card"><h2>Equipo por unidad</h2>
      <p class="sub">Parte de los datos de Desempeño (unidad, cargo y jefe inmediato). Marca quién es <b>Evaluado</b> y quién <b>Evaluador</b> de exámenes; el perfil y las líneas de negocio se sugieren desde su cargo y puedes corregirlos. El correo sale de la nómina.</p>
      <div class="filtros"><input type="search" id="pQ" placeholder="Buscar colaborador" value="${esc(P.q)}">
        <select id="pUnidad"><option value="">Todas las unidades</option>${unidades.map(u => `<option ${u === P.unidad ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <select id="pArea"><option value="">Todas las áreas</option>${areas.map(a => `<option ${a === P.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <label class="chk-inline"><input type="checkbox" id="pSolo" ${P.soloPart ? 'checked' : ''}> Solo participantes</label>
        <button class="btn primario" id="pGuardarTodo" style="margin-left:auto" ${nCambios && !P.guardando ? '' : 'disabled'}>${P.guardando ? 'Guardando…' : `Guardar cambios${nCambios ? ' (' + nCambios + ')' : ''}`}</button></div>
      ${st.emps.length ? '' : '<p class="msg aviso">No se pudo leer el directorio de empleados. Recarga la página.</p>'}
      <div class="scroll"><table class="tabla"><tr><th>Colaborador</th><th>Jefe inmediato</th><th>Evaluado</th><th>Evaluador</th><th>Perfil</th><th>Líneas de negocio</th><th>Correo</th></tr>
      ${filas || '<tr><td colspan="7" class="vacio">Sin colaboradores para este filtro.</td></tr>'}</table></div>
      <p class="sub">Las filas resaltadas tienen cambios sin guardar (también las sugeridas que aún no se han guardado). «Guardar cambios» solo guarda lo que ves con el filtro actual.</p></div>
      <div class="ex-card"><h2>Candidatos externos</h2><p class="sub">Personas que no están en la nómina; solo se identifican por correo.</p>
      <div class="fila"><label>Nombre<input id="xNombre"></label><label>Correo electrónico<input id="xCorreo" type="email"></label>
        <label>Perfil<select id="xPerfil">${(cat.PERFIL || []).map(v => `<option>${esc(v)}</option>`).join('')}</select></label></div>
      <div class="sub">Líneas de negocio (varias; sin marcar = todas)</div>${chips('lineas_ext', cat.LINEA || [])}
      <button class="btn primario" id="xGuardar">Agregar candidato</button>
      ${ext.length ? `<div class="scroll"><table class="tabla"><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th></th></tr>${ext.map(f => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.correo)}</td><td>${esc(f.perfil + (f.lineas.length ? ' · ' + f.lineas.join(', ') : ' · todas'))}</td><td><button class="btn chico peligro" data-baja="${f.id}">Eliminar</button></td></tr>`).join('')}</table></div>` : ''}</div>
      <div class="ex-card"><h2>Catálogos</h2><p class="sub">Agrega opciones nuevas que luego podrás usar en perfiles, en el Excel y en los filtros.</p>
      <div class="fila"><label>Catálogo<select id="cTipo"><option value="PERFIL">Perfil</option><option value="LINEA">Línea de negocio</option><option value="TIPO">Tipo de pregunta</option><option value="DIFICULTAD">Dificultad</option></select></label>
      <label>Nuevo valor<input id="cValor"></label></div><button class="btn" id="cAgregar">Agregar</button></div>`;
  }

  function pintar() {
    if (!st.d) return;
    st.sel.lineas_ext = st.sel.lineas_ext || [];
    const tabs = [['examenes', 'Exámenes', 'fa-clipboard-list'], ['banco', 'Banco de preguntas', 'fa-database'], ['personas', 'Personas', 'fa-users']];
    app.innerHTML = `<div class="ex-top"><div><h1><i class="fas fa-clipboard-question"></i> Evaluaciones técnicas</h1><small>Evaluador ${esc(st.d.yo)}${st.d.master ? ' · master' : ''}</small></div>
      <button class="btn chico" id="exSalir">Salir</button></div>
      <div class="ex-tabs">${tabs.map(t => `<button data-tab="${t[0]}" class="${st.tab === t[0] ? 'on' : ''}"><i class="fas ${t[2]}"></i> ${t[1]}</button>`).join('')}</div>
      ${st.tab === 'examenes' ? vistaExamenes() : st.tab === 'banco' ? vistaBanco() : vistaPersonas()}`;
    enlazar();
  }

  // ---------- eventos ----------
  const val = id => (document.getElementById(id) || {}).value || '';
  function enlazar() {
    const q = (s, f) => app.querySelectorAll(s).forEach(f);
    q('[data-tab]', b => b.onclick = async () => {
      st.tab = b.dataset.tab; aviso(null); pintar();
      if (st.tab === 'banco') ejecutar(async () => { st.banco = Object.assign(st.banco || {}, { lista: (await rpc({ accion: 'banco_listar' })).preguntas }); });
    });
    q('[data-chip]', c => c.onclick = () => {
      const a = st.sel[c.dataset.chip], v = c.dataset.v, i = a.indexOf(v);
      if (i >= 0) a.splice(i, 1); else a.push(v);
      guardarCampos(); leerFormPregunta(); pintar();
    });
    q('[data-eval]', c => c.onchange = () => { const id = Number(c.dataset.eval); c.checked ? st.evaluados.add(id) : st.evaluados.delete(id); });
    q('[data-todos]', b => b.onclick = () => {
      const ids = st.d.perfiles.filter(f => f.rol === 'EVALUADO').map(f => f.id);
      if (ids.every(i => st.evaluados.has(i))) st.evaluados.clear(); else ids.forEach(i => st.evaluados.add(i));
      guardarCampos(); pintar();
    });
    const salir = document.getElementById('exSalir'); if (salir) salir.onclick = () => { cerrarSesion(); location.reload(); };

    enlazarExamenes(q);

    const arch = document.getElementById('exArchivo');
    if (arch) arch.onchange = () => ejecutar(async () => {
      const f = arch.files[0]; if (!f) return;
      aviso('Leyendo el Excel…', 'aviso'); pintar();
      const { preguntas, descartadas } = leerExcel(await f.arrayBuffer());
      if (!preguntas.length) throw new Error('El archivo no tiene preguntas.');
      const reporte = await importar(preguntas);
      st.banco = { reporte, lista: (await rpc({ accion: 'banco_listar' })).preguntas };
      aviso(descartadas.length ? `Se ignoraron ${descartadas.length} fila(s) sin ID ni pregunta (notas o vacías).` : null, 'aviso');
      await recargar();
    });
    const pl = document.getElementById('exPlantilla'); if (pl) pl.onclick = descargarPlantilla;
    for (const id of ['mvCarpeta', 'mvArchivos']) {
      const el = document.getElementById(id);
      if (el) el.onchange = () => ejecutar(async () => { await agregarMasivo([...el.files]); }, null);
    }
    q('[data-mvsel]', el => el.onchange = () => { st.mv.items[Number(el.dataset.mvsel)].preguntaId = el.value ? Number(el.value) : null; evaluarMasivo(); pintar(); });
    const ml = document.getElementById('mvLimpiar'); if (ml) ml.onclick = () => { st.mv.items = []; st.mv.resumen = ''; pintar(); };
    const ms = document.getElementById('mvSubir'); if (ms) ms.onclick = () => ejecutar(subirMasivo, ms);
    const pa2 = document.getElementById('pqAbrir'); if (pa2) pa2.onclick = () => { nuevaPregunta(null); pintar(); document.getElementById('pqTexto')?.focus(); };
    const pc2 = document.getElementById('pqCerrar'); if (pc2) pc2.onclick = () => { st.pq = null; pintar(); };
    q('[data-editar]', b => b.onclick = () => {
      const x = st.banco.lista.find(y => y.id === Number(b.dataset.editar)); if (!x) return;
      nuevaPregunta(x); pintar(); document.getElementById('pqTexto')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const pg1 = document.getElementById('pqGuardar'); if (pg1) pg1.onclick = () => ejecutar(() => guardarPregunta(false), pg1);
    const pg2 = document.getElementById('pqGuardarAdj'); if (pg2) pg2.onclick = () => ejecutar(() => guardarPregunta(true), pg2);
    q('[data-ver]', b => b.onclick = () => verArchivo(Number(b.dataset.ver), b.dataset.nombre, b.dataset.mime));
    q('[data-adj]', b => b.onclick = () => { st.adj = Number(b.dataset.adj); pintar(); document.getElementById('adjCerrar')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    const ac = document.getElementById('adjCerrar'); if (ac) ac.onclick = () => { st.adj = null; pintar(); };
    const refrescarBanco = async () => { st.banco.lista = (await rpc({ accion: 'banco_listar' })).preguntas; };
    q('[data-adjq]', b => b.onclick = () => ejecutar(async () => {
      await rpcArch({ accion: 'adjunto_quitar', preguntaId: st.adj, indice: Number(b.dataset.adjq) }); await refrescarBanco();
    }, b));
    const af = document.getElementById('adjFile');
    if (af) af.onchange = () => ejecutar(async () => {
      const prog = document.getElementById('adjProg'), errores = [];
      let k = 0;
      for (const f of [...af.files]) {
        k++;
        try { await subirMaterial(f, st.adj, x => { prog.textContent = `Subiendo ${k}/${af.files.length}: ${f.name} ${Math.round(x * 100)} %`; }); }
        catch (e) { errores.push(`${f.name}: ${e.message}`); }
      }
      await refrescarBanco();
      if (errores.length) aviso(errores.map(esc).join('<br>'), 'mal');
    });
    const ae = document.getElementById('adjEnlace');
    if (ae) ae.onclick = () => ejecutar(async () => {
      await rpcArch({ accion: 'enlace_agregar', preguntaId: st.adj, url: val('adjUrl'), titulo: val('adjTit') }); await refrescarBanco();
    }, ae);
    q('[data-borrar]', b => b.onclick = async () => {
      const x = (st.banco.lista || []).find(y => y.id === Number(b.dataset.borrar));
      const ok = await preguntar({ titulo: `Eliminar la pregunta ${x ? x.codigo : ''}`, peligro: true, si: 'Eliminar pregunta', no: 'Cancelar',
        texto: `<p>${x ? '«' + esc(x.pregunta.slice(0, 140)) + (x.pregunta.length > 140 ? '…' : '') + '»' : ''}</p><p class="sub">Sale del banco y no se sortea en exámenes nuevos. Los exámenes que ya se hicieron conservan su texto.</p>` });
      if (ok) ejecutar(async () => { await rpc({ accion: 'pregunta_baja', id: Number(b.dataset.borrar) }); st.banco.lista = (await rpc({ accion: 'banco_listar' })).preguntas; await recargar(); aviso('Pregunta eliminada.'); }, b);
    });

    // Personas
    const P = st.pers;
    q('[data-p]', el => el.onchange = () => {
      const id = el.dataset.id, k = el.dataset.p;
      if (k === 'evaluado' || k === 'evaluador') editar(id, k, el.checked);
      else if (k === 'perfil') editar(id, 'perfil', el.value);
      else if (k === 'correo') editar(id, 'correo', el.value.trim().toLowerCase());
      if (k === 'evaluado' && el.checked) {   // al marcar, trae lo sugerido que falte
        const sg = sugerido(empPorId(id)), v = valorDe(empPorId(id));
        if (!v.perfil) editar(id, 'perfil', sg.perfil);
        if (!v.lineas.length && !(P.edits.get(id) || {}).lineas) editar(id, 'lineas', sg.lineas);
      }
      pintar();
    });
    q('[data-lin]', c => c.onclick = () => {
      const id = c.dataset.id, a = [...valorDe(empPorId(id)).lineas], v = c.dataset.lin, i = a.indexOf(v);
      if (i >= 0) a.splice(i, 1); else a.push(v);
      editar(id, 'lineas', a); pintar();
    });
    const pq = document.getElementById('pQ');
    if (pq) pq.oninput = () => {
      P.q = pq.value; clearTimeout(P._t);
      P._t = setTimeout(() => { pintar(); const i = document.getElementById('pQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    };
    const pu = document.getElementById('pUnidad'); if (pu) pu.onchange = () => { P.unidad = pu.value; P.area = ''; pintar(); };
    const pa = document.getElementById('pArea'); if (pa) pa.onchange = () => { P.area = pa.value; pintar(); };
    const ps = document.getElementById('pSolo'); if (ps) ps.onchange = () => { P.soloPart = ps.checked; pintar(); };
    const pgt = document.getElementById('pGuardarTodo');
    if (pgt) pgt.onclick = async () => {
      P.guardando = true; pintar();
      const errores = []; let ok = 0;
      for (const e of visiblesDe().filter(hayCambio)) {
        const v = valorDe(e), g = guardadoDe(e.id);
        try {
          if (v.evaluado) {
            if (!v.perfil) throw new Error('elige su perfil');
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo)) throw new Error('falta un correo válido');
            await rpc({ accion: 'perfil_guardar', id: g.ado ? g.ado.id : undefined, rol: 'EVALUADO', empleadoId: e.id, nombre: e.nombre, correo: v.correo, perfil: v.perfil, lineas: v.lineas });
          } else if (g.ado) await rpc({ accion: 'perfil_baja', id: g.ado.id });
          if (v.evaluador && v.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo)) throw new Error('el correo no es válido');
          if (v.evaluador && (!g.ador || (g.ador.correo || '') !== v.correo)) await rpc({ accion: 'perfil_guardar', id: g.ador ? g.ador.id : undefined, rol: 'EVALUADOR', empleadoId: e.id, nombre: e.nombre, correo: v.correo });
          else if (!v.evaluador && g.ador) await rpc({ accion: 'perfil_baja', id: g.ador.id });
          P.edits.delete(e.id); ok++;
        } catch (err) { errores.push(`${e.nombre}: ${err.message}`); }
      }
      try { await recargar(); } catch (err) { errores.push(err.message); }
      P.guardando = false;
      aviso(`${ok} colaborador(es) guardados.` + (errores.length ? '<br>Pendientes:<br>' + errores.map(esc).join('<br>') : ''), errores.length ? 'aviso' : 'ok');
      pintar();
    };
    const xg = document.getElementById('xGuardar');
    if (xg) xg.onclick = () => ejecutar(async () => {
      await rpc({ accion: 'perfil_guardar', rol: 'EVALUADO', nombre: val('xNombre'), correo: val('xCorreo'), perfil: val('xPerfil'), lineas: st.sel.lineas_ext });
      st.sel.lineas_ext = []; aviso('Candidato agregado.'); await recargar();
    }, xg);
    q('[data-baja]', b => b.onclick = async () => {
      const f = st.d.perfiles.find(y => y.id === Number(b.dataset.baja));
      const ok = await preguntar({ titulo: `Eliminar a ${f ? f.nombre : 'esta persona'}`, peligro: true, si: 'Eliminar', no: 'Cancelar',
        texto: '<p>Ya no aparecerá para crear exámenes nuevos.</p><p class="sub">Sus exámenes anteriores y resultados se conservan; para borrarlos usa «Eliminar» en la tarjeta del examen.</p>' });
      if (ok) ejecutar(async () => { await rpc({ accion: 'perfil_baja', id: Number(b.dataset.baja) }); await recargar(); aviso('Persona eliminada de la lista.'); }, b);
    });
    const ca = document.getElementById('cAgregar');
    if (ca) ca.onclick = () => ejecutar(async () => { await rpc({ accion: 'catalogo_agregar', tipo: val('cTipo'), valor: val('cValor') }); aviso('Opción agregada.'); await recargar(); }, ca);
  }

  // Conserva lo escrito en el formulario de «Nuevo examen» al repintar por chips
  const campos = { exNombre: '', exCant: '10', exMin: '45', exVig: '7' };
  function guardarCampos() { Object.keys(campos).forEach(k => { const e = document.getElementById(k); if (e) campos[k] = e.value; }); }
  const pintarOriginal = pintar;
  pintar = function () { pintarOriginal(); Object.keys(campos).forEach(k => { const e = document.getElementById(k); if (e && campos[k] !== '') e.value = campos[k]; }); };

  async function iniciar() {
    st.ses = sesionGuardada();
    for (;;) {
      if (!st.ses) st.ses = await pedirPin();
      try { await recargar(); break; } catch (e) {
        if (e.sesion) { st.ses = null; continue; }
        if (/permiso de evaluador/.test(e.message)) {
          cerrarSesion();
          app.innerHTML = `<div class="ex-card login"><h2>Sin acceso</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Volver</button></div>`;
          return;
        }
        app.innerHTML = `<div class="ex-card login"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><button class="btn primario" onclick="location.reload()">Reintentar</button></div>`;
        return;
      }
    }
    await cargarEmpleados();
    pintar();
  }
  iniciar();
})();
