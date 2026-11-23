// Plataforma de evaluación técnica · panel del evaluador (fase 1).
// Personas, banco de preguntas (carga desde Excel), generación de exámenes y envío de enlaces por correo.
// Datos: PostgREST api.examenes (db/postgres/019_examenes.sql) por Apps Script (evalRpc) con el token de contraseña
// de Desempeño; el envío de correos lo hace Apps Script (examenes.gs, acción examenEnviar).
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const app = document.getElementById('exApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, d: null, tab: 'examenes', sel: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, evaluados: new Set(), msg: null, banco: null, emps: [], correos: {}, detalle: null, adj: null, mv: { items: [], subiendo: false, resumen: '' }, pq: null, pers: { q: '', unidad: null, area: '', soloPart: false, edits: new Map(), guardando: false } };
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

  function aviso(texto, tipo) { st.msg = texto ? { texto, tipo: tipo || 'ok' } : null; }

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

  const hora = t => t ? new Date(t).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const NOMBRE_EVENTO = { oculta: 'Cambió de pestaña / minimizó', blur: 'Ventana sin foco', sale_pantalla_completa: 'Salió de pantalla completa', copiar: 'Intentó copiar', cortar: 'Intentó cortar',
    pegar: 'Intentó pegar', menu_contextual: 'Clic derecho', tecla: 'Tecla de riesgo', cierre_pagina: 'Intentó cerrar/recargar', reanudo: 'Volvió a abrir el examen',
    compartir_iniciado: 'Compartió pantalla', compartir_detenido: 'Dejó de compartir pantalla' };
  function vistaDetalle() {
    const x = st.detalle;
    if (!x) return '';
    const ev = x.eventos.map(e => `<tr><td>${hora(e.en)}</td><td>${esc(NOMBRE_EVENTO[e.tipo] || e.tipo)}</td><td class="sub">${esc(e.detalle || '')}${e.segundos ? ` · ${e.segundos} s fuera` : ''}</td></tr>`).join('');
    const preg = x.preguntas.map(q => `<div style="margin:10px 0;padding-top:10px;border-top:1px solid var(--linea)"><div class="sub">${q.n}. ${esc(q.codigo)} · ${esc(q.tipo)}</div>
      <div style="white-space:pre-wrap"><b>${esc(q.pregunta)}</b></div>
      <div style="white-space:pre-wrap;margin-top:6px">${q.respuesta ? esc(q.respuesta) : '<span class="sub">(sin respuesta)</span>'}</div>
      ${(q.archivos || []).length ? `<div style="margin-top:6px">${q.archivos.map(a => `<button class="btn chico" data-ver="${a.id}" data-nombre="${esc(a.nombre)}" data-mime="${esc(a.mime)}" style="margin:0 6px 6px 0"><i class="fas ${icoMime(a.mime)}"></i> ${esc(a.nombre)} · ${tam(a.tamano)}</button>`).join('')}</div>` : ''}
      ${q.respuestaModelo ? `<details><summary class="sub">Respuesta modelo</summary><div style="white-space:pre-wrap" class="sub">${esc(q.respuestaModelo)}</div></details>` : ''}
      <div class="calif"><label>Puntos <span class="sub">(máx. ${Number(q.puntosMax)})</span><input type="number" min="0" max="${Number(q.puntosMax)}" step="0.5" data-cn="${q.n}" value="${q.calificacion == null ? '' : Number(q.calificacion)}"></label>
        <label class="grow">Comentario<input data-cc="${q.n}" value="${esc(q.comentario || '')}" placeholder="Opcional"></label>${q.origenCalif === 'EXCEL' ? '<span class="etq ENVIADO" title="Cargada desde el Excel">Excel</span>' : ''}</div></div>`).join('');
    return `<div class="ex-card"><div class="ex-top"><div><h2 style="margin:0">${esc(x.nombre)}</h2><small>${x.estado}${x.iniciadoEn ? ' · inició ' + hora(x.iniciadoEn) : ''}${x.entregadoEn ? ' · entregó ' + hora(x.entregadoEn) : ''}${x.motivoCierre === 'tiempo' ? ' (por tiempo)' : ''}${x.pantallaOk ? ' · compartió pantalla' : ''}</small></div>
      <div><button class="btn chico" data-revisar="${x.id}">Actualizar</button> <button class="btn chico" id="exCerrarDet">Cerrar</button></div></div>
      <h3>Incidencias (${x.eventos.length})</h3>${ev ? `<div class="scroll"><table class="tabla"><tr><th>Hora</th><th>Qué pasó</th><th>Detalle</th></tr>${ev}</table></div>` : '<p class="sub">Sin incidencias registradas.</p>'}
      <h3>Capturas de pantalla (${x.capturas.length})</h3>
      <div>${x.capturas.map(c => `<button class="btn chico" data-captura="${c.id}" style="margin:0 6px 6px 0">${hora(c.en)} · ${esc(c.motivo || '')}</button>`).join('') || '<p class="sub">Sin capturas.</p>'}</div>
      <div id="exCaptura"></div>
      <div class="ex-top"><h3>Respuestas y calificación</h3><div><b>${x.puntos == null ? '—' : Number(x.puntos)} / ${Number(x.maximo)} pts</b>${x.puntos != null && Number(x.maximo) ? ` (${(100 * Number(x.puntos) / Number(x.maximo)).toFixed(1)} %)` : ''} <button class="btn chico primario" data-calif="${x.id}"><i class="fas fa-check"></i> Guardar calificación</button></div></div>${preg}
      <button class="btn primario" data-calif="${x.id}"><i class="fas fa-check"></i> Guardar calificación</button></div>`;
  }

  function vistaExamenes() {
    const d = st.d, cat = d.catalogo;
    const evaluados = d.perfiles.filter(f => f.rol === 'EVALUADO');
    const filas = d.examenes.map(e => {
      const pend = e.intentos.filter(i => i.estado === 'GENERADO').length;
      return `<div class="ex-card"><div class="ex-top"><div><b>${esc(e.nombre)}</b><br><small>${e.cantidad} preguntas · ${e.minutos} min${e.exigirPantalla ? ' · con pantalla compartida' : ''}${e.permitirAdjuntos ? ' · con archivos adjuntos' : ''} · ${new Date(e.creadoEn).toLocaleString('es-EC')}</small></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${e.intentos.some(i => i.iniciadoEn) ? `<button class="btn chico" data-xl="${e.id}"><i class="fas fa-file-excel"></i> Descargar Excel</button>
          <button class="btn chico" data-xmail="${e.id}"><i class="fas fa-envelope"></i> Enviar Excel a mi correo</button>
          <label class="btn chico" style="margin:0;cursor:pointer"><i class="fas fa-upload"></i> Cargar calificaciones<input type="file" accept=".xlsx,.xls" hidden data-xcarga="${e.id}"></label>` : ''}<button class="btn chico primario" data-enviar="${e.id}" ${e.intentos.some(i => i.estado === 'GENERADO' || i.estado === 'ENVIADO') ? '' : 'disabled'}><i class="fas fa-paper-plane"></i> ${pend ? `Enviar pendientes (${pend})` : 'Reenviar a todos'}</button></div></div>
        ${e.resultadosEnviadoEn ? `<p class="sub" style="margin:4px 0"><i class="fas fa-circle-check" style="color:var(--ok)"></i> Resultados enviados por correo el ${new Date(e.resultadosEnviadoEn).toLocaleString('es-EC')}</p>` : e.resultadosError ? `<p class="msg aviso">No se pudieron enviar los resultados solos: ${esc(e.resultadosError)}. Usa «Enviar Excel a mi correo» o «Descargar Excel».</p>` : ''}
        <div class="scroll"><table class="tabla"><tr><th>Evaluado</th><th>Correo</th><th>Preguntas</th><th>Estado</th><th>Avance</th><th></th></tr>
        ${e.intentos.map(i => `<tr><td>${esc(i.nombre)}</td><td>${esc(i.correo)}</td><td>${i.preguntas}</td>
          <td><span class="etq ${i.estado}">${i.estado}</span>${i.motivoCierre === 'tiempo' ? '<br><small class="sub">por tiempo</small>' : ''}${i.errorEnvio ? `<br><small style="color:#fca5a5">${esc(i.errorEnvio)}</small>` : ''}</td>
          <td>${i.iniciadoEn ? `<small>${i.respondidas}/${i.preguntas} respondidas<br>${i.incidencias ? `<span style="color:#fcd34d">${i.incidencias} incidencia(s)</span>` : 'sin incidencias'} · ${i.capturas} captura(s)</small>${i.calificadas ? `<br><b>${Number(i.puntos)} / ${Number(i.maximo)} pts</b>` : ''}` : '<small class="sub">—</small>'}</td>
          <td style="white-space:nowrap">${i.iniciadoEn ? `<button class="btn chico primario" data-revisar="${i.id}">Revisar</button> ` : ''}${i.estado === 'GENERADO' || i.estado === 'ENVIADO' ? `<button class="btn chico" data-enviar="${e.id}" data-intento="${i.id}">${i.estado === 'ENVIADO' ? 'Reenviar' : 'Enviar'}</button> <button class="btn chico peligro" data-anular="${i.id}">Anular</button>` : ''}</td></tr>`).join('')}
        </table></div></div>`;
    }).join('');
    return `${vistaDetalle()}<div class="ex-card"><h2>Nuevo examen</h2>
      ${d.preguntas === 0 ? '<p class="msg aviso">Primero carga preguntas en la pestaña «Banco de preguntas».</p>' : ''}
      ${evaluados.length === 0 ? '<p class="msg aviso">Primero agrega evaluados en la pestaña «Personas».</p>' : ''}
      <div class="fila"><label>Nombre del examen<input id="exNombre" placeholder="Ej. Evaluación de ingreso Q4"></label>
        <label>Cantidad de preguntas<input id="exCant" type="number" min="1" max="100" value="10"></label>
        <label>Tiempo (minutos)<input id="exMin" type="number" min="1" max="600" value="45"></label>
        <label>Vigencia del enlace (días)<input id="exVig" type="number" min="1" max="60" value="7"></label></div>
      <label class="chk-inline" style="margin:4px 0 8px"><input type="checkbox" id="exPant" ${st.exigirPantalla === false ? '' : 'checked'}> Exigir que el evaluado comparta toda su pantalla (se toman capturas periódicas)</label>
      <label class="chk-inline" style="margin:0 0 8px"><input type="checkbox" id="exPerm"> Permitir que el evaluado adjunte archivos a sus respuestas (hasta 3 por pregunta, 10 MB cada uno)</label>
      <h3>¿A quién evalúas?</h3>
      <div class="lista-eval">${evaluados.length ? evaluados.map(f => `<label><input type="checkbox" data-eval="${f.id}" ${st.evaluados.has(f.id) ? 'checked' : ''}> <b>${esc(f.nombre)}</b> <span class="sub">· ${esc(f.perfil)}${f.lineas.length ? ' · ' + esc(f.lineas.join(', ')) : ' · todas las líneas'}</span></label>`).join('') : '<p class="vacio">Sin evaluados.</p>'}</div>
      <button class="btn chico" data-todos="1">Marcar / desmarcar todos</button>
      <h3>Qué preguntas entran <span class="sub">(sin marcar = según el perfil y las líneas de cada evaluado)</span></h3>
      <div class="sub">Perfil</div>${chips('perfiles', cat.PERFIL || [])}
      <div class="sub">Línea de negocio (se pueden marcar varias)</div>${chips('lineas', cat.LINEA || [])}
      <div class="sub">Tipo de pregunta</div>${chips('tipos', cat.TIPO || [])}
      <div class="sub">Dificultad</div>${chips('dificultades', cat.DIFICULTAD || [])}
      <button class="btn primario" id="exGenerar"><i class="fas fa-wand-magic-sparkles"></i> Generar examen</button>
      <span class="sub"> Se sortean preguntas distintas para cada persona. Después podrás enviarles el correo.</span></div>
      <div class="ex-top"><h2 style="margin:0">Exámenes generados</h2><button class="btn chico" id="exActualizar"><i class="fas fa-rotate"></i> Actualizar</button></div>${filas || '<p class="vacio">Aún no generas ningún examen.</p>'}`;
  }

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
        <td style="white-space:nowrap"><button class="btn chico" data-editar="${q.id}">Editar</button> <button class="btn chico peligro" data-borrar="${q.id}">Quitar</button></td></tr>`).join('')}</table></div>` : '<p class="vacio">Cargando…</p>';
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
      ${ext.length ? `<div class="scroll"><table class="tabla"><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th></th></tr>${ext.map(f => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.correo)}</td><td>${esc(f.perfil + (f.lineas.length ? ' · ' + f.lineas.join(', ') : ' · todas'))}</td><td><button class="btn chico peligro" data-baja="${f.id}">Quitar</button></td></tr>`).join('')}</table></div>` : ''}</div>
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
      ${st.msg ? `<div class="msg ${st.msg.tipo}">${st.msg.texto}</div>` : ''}
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

    q('[data-revisar]', b => b.onclick = () => ejecutar(async () => {
      const id = Number(b.dataset.revisar);
      st.detalle = Object.assign((await rpc({ accion: 'intento_detalle', intentoId: id })), { id });
      await recargar();
    }, b));
    const cd = document.getElementById('exCerrarDet'); if (cd) cd.onclick = () => { st.detalle = null; pintar(); };
    q('[data-captura]', b => b.onclick = async () => {
      const box = document.getElementById('exCaptura');
      box.innerHTML = '<p class="sub">Cargando captura…</p>';
      try {
        const r = await rpc({ accion: 'captura_ver', capturaId: Number(b.dataset.captura) });
        box.innerHTML = `<img src="${r.imagen}" alt="Captura" style="max-width:100%;border:1px solid var(--linea);border-radius:10px;margin-top:6px">`;
      } catch (e) { box.innerHTML = `<p class="msg mal">${esc(e.message)}</p>`; }
    });
    const act = document.getElementById('exActualizar'); if (act) act.onclick = () => ejecutar(async () => { await recargar(); aviso('Actualizado.'); }, act);
    const gen = document.getElementById('exGenerar');
    if (gen) gen.onclick = () => ejecutar(async () => {
      const r = await rpc({ accion: 'examen_generar', nombre: val('exNombre'), cantidad: Number(val('exCant')), minutos: Number(val('exMin')),
        vigenciaDias: Number(val('exVig')), exigirPantalla: document.getElementById('exPant').checked, permitirAdjuntos: document.getElementById('exPerm').checked, perfilIds: [...st.evaluados], filtros: { perfiles: st.sel.perfiles, lineas: st.sel.lineas, tipos: st.sel.tipos, dificultades: st.sel.dificultades } });
      const notas = r.detalle.filter(x => !x.ok || x.faltan).map(x => x.ok ? `${esc(x.nombre)}: solo ${x.preguntas} preguntas disponibles (faltan ${x.faltan})` : `${esc(x.nombre)}: ${esc(x.error)}`);
      aviso('Examen generado. ' + (notas.length ? 'Ojo: <br>' + notas.join('<br>') : 'Ya puedes enviar los correos.'), notas.length ? 'aviso' : 'ok');
      st.evaluados.clear(); await recargar();
    }, gen);

    q('[data-enviar]', b => b.onclick = () => ejecutar(async () => {
      aviso('Enviando correos…', 'aviso'); pintar();
      const r = await fb()._post({ accion: 'examenEnviar', token: st.ses.token, examenId: Number(b.dataset.enviar), intentoIds: b.dataset.intento ? [Number(b.dataset.intento)] : undefined });
      if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } throw new Error((r && r.error) || 'No se pudo enviar'); }
      aviso(`Correos enviados: ${r.enviados}${r.fallos ? `. Con error: ${r.fallos} (míralos en la tabla)` : ''}.`, r.fallos ? 'aviso' : 'ok');
      await recargar();
    }, b));
    q('[data-anular]', b => b.onclick = () => { if (confirm('¿Anular este examen? El enlace dejará de funcionar.')) ejecutar(async () => { await rpc({ accion: 'examen_anular', intentoId: Number(b.dataset.anular) }); await recargar(); }, b); });

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
    q('[data-xl]', b => b.onclick = () => ejecutar(async () => { descargarResultados((await rpcRes({ accion: 'resultados', examenId: Number(b.dataset.xl) })).resultados); }, b));
    q('[data-xmail]', b => b.onclick = () => ejecutar(async () => {
      aviso('Preparando el Excel y enviándolo a tu correo…', 'aviso'); pintar();
      const r = await fb()._post({ accion: 'examenResultados', token: st.ses.token, examenId: Number(b.dataset.xmail) });
      if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } throw new Error((r && r.error) || 'No se pudo enviar'); }
      aviso(`Listo: enviamos el Excel a ${esc(r.destinatario)}.`); await recargar();
    }, b));
    q('[data-xcarga]', inp => inp.onchange = () => ejecutar(async () => {
      const f = inp.files[0]; if (!f) return;
      aviso('Cargando calificaciones…', 'aviso'); pintar();
      const r = await cargarCalificaciones(f, Number(inp.dataset.xcarga));
      aviso(`<b>${r.guardadas}</b> calificación(es) cargadas de ${r.total} fila(s).` + (r.errores.length ? `<br>Con error (${r.errores.length}):<br>` + r.errores.slice(0, 10).map(e => `${esc(e.id)}: ${esc(e.error)}`).join('<br>') : ''), r.errores.length ? 'aviso' : 'ok');
      if (st.detalle) st.detalle = Object.assign(await rpc({ accion: 'intento_detalle', intentoId: st.detalle.id }), { id: st.detalle.id });
      await recargar();
    }, null));
    q('[data-calif]', b => b.onclick = () => ejecutar(async () => {
      const items = [...document.querySelectorAll('[data-cn]')].map(i => ({ n: Number(i.dataset.cn), puntos: i.value, comentario: (document.querySelector(`[data-cc="${i.dataset.cn}"]`) || {}).value || '' }));
      const r = await rpcRes({ accion: 'calificar', intentoId: Number(b.dataset.calif), items });
      st.detalle = Object.assign(await rpc({ accion: 'intento_detalle', intentoId: Number(b.dataset.calif) }), { id: Number(b.dataset.calif) });
      aviso(`Calificación guardada: ${Number(r.puntos || 0)} de ${Number(r.maximo)} puntos.`); await recargar();
    }, b));
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
    q('[data-borrar]', b => b.onclick = () => ejecutar(async () => {
      await rpc({ accion: 'pregunta_baja', id: Number(b.dataset.borrar) });
      st.banco.lista = (await rpc({ accion: 'banco_listar' })).preguntas; await recargar();
    }, b));

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
    q('[data-baja]', b => b.onclick = () => { if (confirm('¿Quitar a esta persona?')) ejecutar(async () => { await rpc({ accion: 'perfil_baja', id: Number(b.dataset.baja) }); await recargar(); }, b); });
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
