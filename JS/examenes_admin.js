// Plataforma de evaluación técnica · panel del evaluador (fase 1).
// Personas, banco de preguntas (carga desde Excel), generación de exámenes y envío de enlaces por correo.
// Datos: PostgREST api.examenes (db/postgres/019_examenes.sql) por Apps Script (evalRpc) con el token de contraseña
// de Desempeño; el envío de correos lo hace Apps Script (examenes.gs, acción examenEnviar).
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const app = document.getElementById('exApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, d: null, tab: 'examenes', sel: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, evaluados: new Set(), msg: null, banco: null, emps: [], correos: {}, detalle: null, adj: null, nx: null, rev: null, revModal: null, ex: null, res: { q: '', orden: 'prom' }, bq: null, mv: { items: [], subiendo: false, resumen: '' }, pq: null, pers: { q: '', unidad: null, area: '', soloPart: false, edits: new Map(), guardando: false } };
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
          evaluadorId: String(e.evaluador_id || '').trim(), foto: String(e.foto_url || '').trim() }))
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

  // ---------- clasificar, buscar y ordenar exámenes ----------
  const CLASES = { enviar: ['Por enviar', 'gris', 'fa-paper-plane'], calificar: ['Por calificar', 'morado', 'fa-pen-to-square'], curso: ['En curso', 'azul', 'fa-hourglass-half'], terminado: ['Terminado', 'verde', 'fa-circle-check'] };
  const PRIO = { enviar: 0, calificar: 1, curso: 2, terminado: 3 };
  const FILTROS_EX = [['todos', 'Todos'], ['enviar', 'Por enviar'], ['calificar', 'Por calificar'], ['curso', 'En curso'], ['terminado', 'Terminados']];
  const ORDENES_EX = [['accion', 'Requieren acción primero'], ['recientes', 'Más recientes'], ['antiguos', 'Más antiguos'], ['nombre', 'Nombre (A–Z)'], ['nota', 'Mejor nota promedio']];

  function claseExamen(e) {
    const r = resumenExamen(e);
    if (r.sinEnviar.length) return 'enviar';
    if (r.porCalificar.length) return 'calificar';
    if (r.rindiendo.length || r.enviadas.length > r.entregaron.length) return 'curso';
    return 'terminado';
  }
  function notaProm(e) {
    const v = e.intentos.filter(i => i.estado === 'ENTREGADO' && i.calificadas > 0 && Number(i.maximo) > 0).map(i => Number(i.puntos) / Number(i.maximo));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1;
  }
  function examenesVisibles() {
    const x = st.ex, q = quitarTildes(x.q);
    const todos = st.d.examenes.map(e => ({ e, c: claseExamen(e) }));
    const conteo = { todos: todos.length, enviar: 0, calificar: 0, curso: 0, terminado: 0 };
    todos.forEach(o => { conteo[o.c]++; });
    const reciente = (a, b) => new Date(b.e.creadoEn) - new Date(a.e.creadoEn);
    const orden = { accion: (a, b) => PRIO[a.c] - PRIO[b.c] || reciente(a, b), recientes: reciente, antiguos: (a, b) => -reciente(a, b),
      nombre: (a, b) => a.e.nombre.localeCompare(b.e.nombre, 'es', { numeric: true }), nota: (a, b) => notaProm(b.e) - notaProm(a.e) || reciente(a, b) }[x.orden] || reciente;
    const lista = todos.filter(o => (x.filtro === 'todos' || o.c === x.filtro)
      && (!q || quitarTildes(o.e.nombre + ' ' + o.e.intentos.map(i => i.nombre + ' ' + i.correo).join(' ')).includes(q))).sort(orden);
    return { lista, conteo, total: todos.length };
  }
  const PRIO_PERSONA = { ENTREGADO: 1, INICIADO: 2, ENVIADO: 3, GENERADO: 4, ANULADO: 5 };
  const ordenGente = (a, b) => ((a.estado === 'ENTREGADO' && a.calificadas >= a.preguntas) ? 1.5 : PRIO_PERSONA[a.estado] || 9) - ((b.estado === 'ENTREGADO' && b.calificadas >= b.preguntas) ? 1.5 : PRIO_PERSONA[b.estado] || 9) || a.nombre.localeCompare(b.nombre, 'es');
  const guardarPrefsEx = () => { try { localStorage.setItem('exm_prefs_ex', JSON.stringify({ filtro: st.ex.filtro, orden: st.ex.orden })); } catch (e) { } };
  const cargarPrefsEx = () => { let p = {}; try { p = JSON.parse(localStorage.getItem('exm_prefs_ex') || '{}'); } catch (e) { } return { q: '', filtro: FILTROS_EX.some(f => f[0] === p.filtro) ? p.filtro : 'todos', orden: ORDENES_EX.some(o => o[0] === p.orden) ? p.orden : 'accion', vista: new Map() }; };

  // ---------- pestaña Exámenes ----------
  function tarjetaExamen(e, clase) {
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
    const progreso = (n, de, txt, cl) => `<div class="prog"><div class="prog-cab"><b>${n}</b><span>de ${de}</span><small>${txt}</small></div><div class="prog-barra"><i class="${cl}" style="width:${de ? Math.round(100 * n / de) : 0}%"></i></div></div>`;
    const estadoRes = e.resultadosEnviadoEn
      ? `<p class="linea-ok"><i class="fas fa-circle-check"></i> Resultados enviados a tu correo el ${esc(fechaCorta(e.resultadosEnviadoEn))}</p>`
      : e.resultadosError ? `<p class="msg aviso">Los resultados no se pudieron enviar solos: ${esc(e.resultadosError)}. Usa «Enviar resultados a mi correo» o «Descargar Excel».</p>` : '';
    const gente = [...e.intentos].sort(ordenGente);
    const filas = gente.map(i => {
      const nota = i.estado === 'ANULADO' ? '' : (i.calificadas > 0
        ? `<b>${fmtPts(i.puntos)}</b> / ${fmtPts(i.maximo)} <span class="sub">· ${pct(i.puntos, i.maximo)} %</span>${barra(i.puntos, i.maximo)}${i.calificadas < i.preguntas ? `<div class="sub">Parcial: ${i.calificadas} de ${i.preguntas} preguntas</div>` : ''}`
        : (i.estado === 'ENTREGADO' ? '<span class="sub">Sin calificar</span>' : '<span class="sub">—</span>'));
      const acc = [
        i.iniciadoEn ? `<button class="btn chico ${i.estado === 'ENTREGADO' ? 'primario' : ''}" data-revisar="${i.id}">${i.estado === 'ENTREGADO' ? 'Revisar y calificar' : 'Ver avance'}</button>` : '',
        (i.estado === 'GENERADO' || i.estado === 'ENVIADO') ? `<button class="btn chico" data-enviar="${e.id}" data-intento="${i.id}">${i.estado === 'ENVIADO' ? 'Reenviar' : 'Enviar'}</button> <button class="btn chico enlace-mal" data-anular="${i.id}">Anular</button>` : `<button class="btn chico enlace-mal" data-elim-int="${i.id}" title="Borrar el resultado de esta persona">Eliminar</button>`
      ].join(' ');
      return `<tr class="${i.estado === 'ANULADO' ? 'tenue' : ''}"><td><div class="pers">${avatar(i.nombre, fotoDePerfil(i.perfilId))}<div><button class="enlace-nombre" data-ficha="${i.perfilId}" title="Ver el detalle y las gráficas de esta persona">${esc(i.nombre)}</button><div class="sub">${esc(i.correo)}</div></div></div></td>
        <td>${insignia(i.estado)}${i.motivoCierre === 'tiempo' ? '<div class="sub">se acabó el tiempo</div>' : ''}${i.errorEnvio ? `<div class="sub mal">No se pudo enviar el correo: ${esc(i.errorEnvio)}</div>` : ''}</td>
        <td>${i.iniciadoEn ? `${i.respondidas} de ${i.preguntas} respondidas` : '<span class="sub">—</span>'}${i.entregadoEn ? `<div class="sub">Entregó ${esc(fechaCorta(i.entregadoEn))}</div>` : ''}</td>
        <td>${nota}</td>
        <td>${i.incidencias ? `<span class="alerta" title="Salidas de la ventana, intentos de pegar, etc."><i class="fas fa-triangle-exclamation"></i> ${i.incidencias}</span>` : (i.iniciadoEn ? '<span class="sub">Ninguna</span>' : '')}</td>
        <td class="acc">${acc}</td></tr>`;
    }).join('');
    const abierta = st.ex.vista.has(e.id) ? st.ex.vista.get(e.id) : clase !== 'terminado';
    const [claseTxt, claseCol, claseIco] = CLASES[clase];
    const cuenta = e.intentos.filter(i => i.estado !== 'ANULADO').length;
    return `<div class="ex-card examen clase-${clase}"><div class="cab-examen">
        <div class="cab-titulo"><div class="linea-titulo"><span class="ins ${claseCol}"><i class="fas ${claseIco}"></i> ${claseTxt}</span><h3 class="titulo">${esc(e.nombre)}</h3></div><div class="metas">${meta}<span class="meta tenue">Creado ${esc(fechaCorta(e.creadoEn))}</span></div></div>
        <div class="cab-prog">${progreso(r.enviadas.length, r.vivos.length, 'invitadas', 'azul')}${progreso(r.entregaron.length, r.vivos.length, 'entregaron', 'verde')}${progreso(r.calificadas.length, r.entregaron.length, 'calificadas', 'morado')}</div>
        <div class="acciones">${paso ? `<button class="btn primario" ${paso.attr}><i class="fas ${paso.ico}"></i> ${paso.txt}</button>` : ''}
          ${items.length ? `<details class="menu"><summary class="btn">Más <i class="fas fa-chevron-down"></i></summary><div class="menu-lista">${items.join('')}</div></details>` : ''}</div></div>
      ${estadoRes}
      <button class="plegar-gente" data-togg="${e.id}" aria-expanded="${abierta}"><i class="fas fa-chevron-${abierta ? 'down' : 'right'}"></i> Personas <span class="cnt">${cuenta}</span>${r.porCalificar.length ? `<span class="cnt morado">${r.porCalificar.length} por calificar</span>` : ''}</button>
      ${abierta ? `<div class="scroll"><table class="tabla gente"><tr><th>Evaluado</th><th>Estado</th><th>Avance</th><th>Nota</th><th>Incidencias</th><th></th></tr>${filas}</table></div>` : ''}</div>`;
  }

  // Guía de «qué sigue»: Personas → Preguntas → Crear → Enviar → Calificar (resalta el paso que toca)
  function guiaPasos() {
    const d = st.d, ex = d.examenes.map(e => resumenExamen(e));
    const nPers = d.perfiles.filter(f => f.rol === 'EVALUADO').length;
    const porEnviar = ex.reduce((a, r) => a + r.sinEnviar.length, 0), porCalificar = ex.reduce((a, r) => a + r.porCalificar.length, 0);
    const pasos = [
      { t: 'Personas', ok: nPers > 0, ico: 'fa-users', sub: nPers ? `${nPers} para evaluar` : 'Marca a quién evaluar', ir: 'personas', cta: 'Elegir personas' },
      { t: 'Preguntas', ok: d.preguntas > 0, ico: 'fa-database', sub: d.preguntas ? `${d.preguntas} en tu banco` : 'Carga tu banco', ir: 'banco', cta: 'Cargar preguntas' },
      { t: 'Crear examen', ok: d.examenes.length > 0, ico: 'fa-clipboard-list', sub: d.examenes.length ? `${d.examenes.length} creado(s)` : 'Armar el examen', ir: 'nuevo', cta: 'Crear examen' },
      { t: 'Enviar', ok: d.examenes.length > 0 && !porEnviar, ico: 'fa-paper-plane', sub: porEnviar ? `${porEnviar} sin enviar` : 'Invitaciones al día', ir: 'enviar', cta: 'Ver lo que falta enviar' },
      { t: 'Calificar', ok: d.examenes.length > 0 && !porEnviar && !porCalificar && ex.some(r => r.entregaron.length), ico: 'fa-pen-to-square', sub: porCalificar ? `${porCalificar} por calificar` : 'Al día', ir: 'calificar', cta: 'Ver lo que falta calificar' }
    ];
    const actual = pasos.findIndex(p => !p.ok);
    if (actual < 0 || (actual >= 3 && !porEnviar && !porCalificar)) return '';
    const p = pasos[actual];
    return `<div class="guia"><div class="guia-pasos">${pasos.map((q, i) => `<div class="guia-p ${q.ok ? 'hecho' : i === actual ? 'actual' : ''}"><span class="guia-n">${q.ok ? '<i class="fas fa-check"></i>' : i + 1}</span><span class="guia-t"><b>${q.t}</b><small>${esc(q.sub)}</small></span></div>`).join('')}</div>
      <div class="guia-cta"><span><b>Siguiente paso:</b> ${esc(p.cta)}</span><button class="btn primario" data-gir="${p.ir}"><i class="fas ${p.ico}"></i> ${esc(p.cta)}</button></div></div>`;
  }

  function vistaExamenes() {
    const d = st.d, x = st.ex, v = examenesVisibles();
    const vivos = d.examenes.flatMap(e => e.intentos.filter(i => i.estado !== 'ANULADO'));
    const kpis = [
      ['fa-clipboard-list', d.examenes.length, 'exámenes', 'todos', 'azul'],
      ['fa-users', vivos.length, `personas invitadas · ${vivos.filter(i => i.estado === 'ENTREGADO').length} entregaron`, null, 'azul'],
      ['fa-pen-to-square', vivos.filter(i => i.estado === 'ENTREGADO' && (i.calificadas || 0) < i.preguntas).length, 'por calificar', 'calificar', 'morado'],
      ['fa-triangle-exclamation', vivos.filter(i => i.estado === 'ENTREGADO' && i.incidencias > 0).length, 'con incidencias para revisar', null, 'ambar']
    ].map(([ic, n, t, f, c]) => `<${f ? 'button' : 'div'} class="kpi ${c}" ${f ? `data-exf="${f}"` : ''}><i class="fas ${ic}"></i><b>${n}</b><span>${t}</span></${f ? 'button' : 'div'}>`).join('');
    const filtros = FILTROS_EX.map(([k, t]) => `<button class="fch ${x.filtro === k ? 'on' : ''}" data-exf="${k}">${t} <span>${v.conteo[k]}</span></button>`).join('');
    const hayFiltro = x.filtro !== 'todos' || x.q;
    return `${guiaPasos()}<div class="kpis">${kpis}</div>
      <div class="toolbar"><div class="buscar"><i class="fas fa-search"></i><input id="exBuscar" type="search" placeholder="Buscar examen o persona" value="${esc(x.q)}"></div>
        <div class="chips-filtro">${filtros}</div>
        <label class="orden">Ordenar<select id="exOrden">${ORDENES_EX.map(([k, t]) => `<option value="${k}" ${x.orden === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="plegar-todo"><button class="btn chico" data-explegar="1" title="Mostrar la lista de personas de todos los exámenes">Abrir todo</button><button class="btn chico" data-explegar="0">Cerrar todo</button></div>
        <button class="btn" id="exActualizar" title="Actualizar la lista"><i class="fas fa-rotate"></i></button></div>
      ${v.lista.length ? `<div class="sub resultados-n">${v.lista.length} de ${v.total} examen(es)${hayFiltro ? ' · <a href="#" data-exf="todos" data-limpiar="1">Quitar filtros</a>' : ''}</div><div class="rejilla-ex">${v.lista.map(o => tarjetaExamen(o.e, o.c)).join('')}</div>`
        : d.examenes.length ? `<div class="ex-card vacio-grande"><i class="fas fa-filter-circle-xmark"></i><h3>Ningún examen coincide</h3><p class="sub">Prueba con otra búsqueda o quita los filtros.</p><a class="btn" href="#" data-exf="todos" data-limpiar="1">Quitar filtros</a></div>`
        : `<div class="ex-card vacio-grande"><i class="fas fa-clipboard-list"></i><h3>Aún no has creado ningún examen</h3><p class="sub">Elige a quién evaluar, cuántas preguntas y cuánto tiempo. Les llegará un enlace por correo.</p><button class="btn primario" data-nuevo><i class="fas fa-plus"></i> Crear mi primer examen</button></div>`}`;
  }

  // ---------- «Nuevo examen» por pasos (una pregunta a la vez, como en Visitas) ----------
  const FILTROS = [['perfiles', 'Perfil', 'PERFIL'], ['lineas', 'Línea de negocio', 'LINEA'], ['tipos', 'Tipo de pregunta', 'TIPO'], ['dificultades', 'Dificultad', 'DIFICULTAD']];
  const NX_PASOS = [
    ['¿A quién vas a evaluar?', 'Marca a las personas que recibirán el examen. Cada una recibe preguntas distintas, sorteadas al azar.'],
    ['¿Cómo se llama y cuánto dura?', 'Ponle un nombre que reconozcas y elige cuántas preguntas y cuánto tiempo tendrán.'],
    ['¿Qué reglas tiene?', 'Activa solo lo que necesites. Si dudas, déjalo como está.'],
    ['Revisa y crea', 'Si algo no está bien, toca la fila para cambiarlo.']
  ];
  function nxNuevo() { return { paso: 1, nombre: '', cant: 10, min: 45, vig: 7, pant: true, ia: false, adj: false, ev: new Set(), q: '', f: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, error: '', creando: false, listo: null }; }

  const nxFiltra = () => { const q = quitarTildes(st.nx.q); return st.d.perfiles.filter(f => f.rol === 'EVALUADO' && (!q || quitarTildes(`${f.nombre} ${f.perfil} ${f.correo}`).includes(q))); };
  function nxListaPersonas() {
    const n = st.nx, vis = nxFiltra(), total = st.d.perfiles.filter(f => f.rol === 'EVALUADO').length;
    return vis.length ? vis.map(f => `<label class="nx-persona ${n.ev.has(f.id) ? 'on' : ''}"><input type="checkbox" data-nxev="${f.id}" ${n.ev.has(f.id) ? 'checked' : ''}><span class="nx-check"><i class="fas fa-check"></i></span>${avatar(f.nombre, fotoDePerfil(f.id))}
        <span class="nx-pt"><b>${esc(f.nombre)}</b><small>${esc(f.perfil)}${f.lineas.length ? ' · ' + esc(f.lineas.join(', ')) : ' · todas las líneas'}</small></span></label>`).join('')
      : `<p class="vacio">${total ? 'Nadie coincide con la búsqueda.' : 'Aún no hay personas para evaluar.'}</p>`;
  }
  const nxCuenta = () => st.nx.ev.size ? `${st.nx.ev.size} elegida${st.nx.ev.size === 1 ? '' : 's'}` : 'Ninguna elegida todavía';

  // Opciones rápidas (toca una) más un campo para otro valor
  function nxOpc(k, valores, sufijo, min, max) {
    const n = st.nx;
    return `<div class="gv-chips">${valores.map(v => `<button type="button" class="gv-chip ${n[k] === v ? 'on' : ''}" data-nx="set" data-k="${k}" data-v="${v}">${v}${sufijo ? ' ' + sufijo : ''}</button>`).join('')}</div>
      <input class="nx-otro" type="number" inputmode="numeric" min="${min}" max="${max}" data-nxin="${k}" value="${esc(n[k])}" aria-label="Otro valor">`;
  }

  function nxErrorPaso(paso) {
    const n = st.nx;
    if (paso >= 1 && !n.ev.size) return 'Elige al menos una persona para evaluar.';
    if (paso >= 2) {
      if (!n.nombre.trim()) return 'Ponle un nombre al examen.';
      if (!(n.cant >= 1 && n.cant <= 100)) return 'Las preguntas por persona deben ser entre 1 y 100.';
      if (!(n.min >= 1 && n.min <= 600)) return 'El tiempo debe estar entre 1 y 600 minutos.';
      if (!(n.vig >= 1 && n.vig <= 60)) return 'El enlace puede valer entre 1 y 60 días.';
    }
    return '';
  }

  function nxHtml() {
    const d = st.d, n = st.nx, paso = n.paso;
    const sw = (k, titulo, ayuda) => `<label class="sw"><input type="checkbox" data-nxsw="${k}" ${n[k] ? 'checked' : ''}><span class="knob"></span><span class="sw-txt"><b>${titulo}</b><small>${ayuda}</small></span></label>`;
    const x = `<button type="button" class="x" data-nx="cerrar" aria-label="Cerrar">×</button>`;
    if (n.listo) {
      const l = n.listo;
      return `<div class="mdl-head"><h2>Examen creado</h2>${x}</div>
        <div class="mdl-body centro"><div class="gran-ico verde"><i class="fas fa-check"></i></div>
          <p class="gv-pregunta">«${esc(l.nombre)}» está listo</p>
          <p class="txt-ayuda">${l.ok} persona${l.ok === 1 ? '' : 's'} con su examen armado. Falta enviarles el enlace por correo para que puedan rendirlo.</p>
          ${l.notas.length ? `<p class="msg aviso" style="text-align:left"><b>Ojo:</b><br>${l.notas.join('<br>')}</p>` : ''}
          ${n.error ? `<p class="msg mal" style="text-align:left">${esc(n.error)}</p>` : ''}</div>
        <div class="mdl-pie"><button class="btn" data-nx="despues" ${n.creando ? 'disabled' : ''}>Enviar más tarde</button>
          <button class="btn primario grande" data-nx="enviar" ${n.creando ? 'disabled' : ''}>${n.creando ? '<i class="fas fa-spinner fa-spin"></i> Enviando…' : '<i class="fas fa-paper-plane"></i> Enviar invitaciones ahora'}</button></div>`;
    }
    const avisos = [d.preguntas === 0 ? 'Todavía no tienes preguntas. <a href="#" data-nx="ir-banco">Cárgalas en «Banco de preguntas»</a>.' : '',
      !d.perfiles.some(f => f.rol === 'EVALUADO') ? 'Todavía no hay personas para evaluar. <a href="#" data-nx="ir-personas">Agrégalas en «Personas»</a>.' : ''].filter(Boolean);
    const [preg, ayuda] = NX_PASOS[paso - 1];
    let campos = '', pie = '';
    if (paso === 1) {
      campos = `${avisos.map(a => `<p class="msg aviso">${a}</p>`).join('')}
        <div class="barra-lista"><input type="search" data-nxq placeholder="Buscar persona" value="${esc(n.q)}"><button type="button" class="btn chico" data-nx="todos">Marcar todos</button></div>
        <div class="nx-cuenta" id="nxCuenta">${nxCuenta()}</div><div class="nx-personas" id="nxPersonas">${nxListaPersonas()}</div>`;
    } else if (paso === 2) {
      campos = `<label class="gv-campo"><span>Nombre del examen</span><input data-nxin="nombre" maxlength="80" value="${esc(n.nombre)}" placeholder="Ej. Evaluación de ingreso Q4" autocomplete="off"></label>
        <div class="gv-campo"><span>Preguntas por persona</span>${nxOpc('cant', [5, 10, 15, 20], '', 1, 100)}</div>
        <div class="gv-campo"><span>Tiempo para rendirlo (minutos)</span>${nxOpc('min', [30, 45, 60, 90], 'min', 1, 600)}</div>
        <div class="gv-campo"><span>El enlace vale (días)</span>${nxOpc('vig', [3, 7, 14, 30], 'días', 1, 60)}</div>`;
    } else if (paso === 3) {
      const nF = FILTROS.reduce((a, [k]) => a + n.f[k].length, 0);
      campos = `${sw('pant', 'Exigir compartir toda la pantalla', 'Se toman capturas durante el examen para detectar si buscan respuestas en otro lugar.')}
        ${sw('adj', 'Permitir adjuntar archivos', 'Cada persona puede subir hasta 3 archivos por pregunta (10 MB cada uno).')}
        ${sw('ia', 'Permitir calificar con IA', 'Les avisamos antes de empezar. La IA solo ve la pregunta y la respuesta, nunca nombres ni correos. Tú decides cuándo usarla.')}
        <details class="avanzado" ${nF ? 'open' : ''}><summary>Elegir qué preguntas entran <span class="sub">(opcional${nF ? ' · ' + nF + ' filtro(s)' : ': por defecto, según el perfil y las líneas de cada persona'})</span></summary>
          ${FILTROS.map(([k, tit, cat]) => `<div class="sub" style="margin-top:8px">${tit}</div><div class="chips">${(d.catalogo[cat] || []).map(v => `<span class="chip ${n.f[k].includes(v) ? 'on' : ''}" data-nx="chip" data-k="${k}" data-v="${esc(v)}">${esc(v)}</span>`).join('')}</div>`).join('')}</details>`;
    } else {
      const fila = (etq, val, ir) => `<button type="button" class="nx-res" data-nx="ir" data-paso="${ir}"><span>${etq}</span><strong>${val}</strong><i class="fas fa-pen"></i></button>`;
      const nom = [...n.ev].map(id => (d.perfiles.find(f => f.id === id) || {}).nombre).filter(Boolean);
      const reglas = [n.pant && 'Pantalla compartida', n.adj && 'Admite archivos', n.ia && 'Con IA'].filter(Boolean).join(' · ') || 'Sin reglas extra';
      const nF = FILTROS.reduce((a, [k]) => a + n.f[k].length, 0);
      campos = `<div class="nx-resumen">${fila('Personas', `${n.ev.size} · <span class="sub">${esc(nom.slice(0, 3).join(', '))}${nom.length > 3 ? ' y ' + (nom.length - 3) + ' más' : ''}</span>`, 1)}
          ${fila('Nombre', esc(n.nombre), 2)}${fila('Preguntas y tiempo', `${n.cant} preguntas · ${n.min} min`, 2)}${fila('El enlace vale', `${n.vig} días`, 2)}
          ${fila('Reglas', esc(reglas), 3)}${fila('Preguntas que entran', nF ? `${nF} filtro(s)` : 'Según perfil y líneas', 3)}</div>
        <p class="nx-nota"><i class="fas fa-paper-plane"></i> Al crearlo te preguntamos si quieres enviar las invitaciones por correo en ese momento.</p>`;
    }
    pie = paso < 4 ? `<button type="submit" class="btn primario grande">Siguiente <i class="fas fa-arrow-right"></i></button>`
      : `<button type="submit" class="btn primario grande" ${n.creando ? 'disabled' : ''}>${n.creando ? '<i class="fas fa-spinner fa-spin"></i> Creando…' : '<i class="fas fa-check"></i> Crear examen'}</button>`;
    return `<form novalidate autocomplete="off" class="nx-form"><div class="mdl-head"><button type="button" class="volver" data-nx="${paso > 1 ? 'atras' : 'cerrar'}" aria-label="Atrás"><i class="fas fa-arrow-left"></i></button><h2>Nuevo examen · paso ${paso} de 4</h2>${x}</div>
      <div class="mdl-body"><div class="gv-progreso">${[1, 2, 3, 4].map(i => `<span class="${i < paso ? 'hecho' : i === paso ? 'actual' : ''}"></span>`).join('')}</div>
        <p class="gv-pregunta">${preg}</p><p class="gv-ayuda">${ayuda}</p>
        ${n.error ? `<div class="msg mal" role="alert"><i class="fas fa-circle-exclamation"></i> ${esc(n.error)}</div>` : ''}${campos}</div>
      <div class="mdl-pie">${pie}</div></form>`;
  }

  function abrirNuevoExamen() {
    if (!st.nx) st.nx = nxNuevo();
    const m = modal(nxHtml(), { ancho: 620 });
    const redib = foco => { m.set(nxHtml()); if (foco) { const i = m.box.querySelector(foco); if (i) { i.focus(); if (i.select) i.select(); } } };
    const ir = (paso, foco) => {
      const n = st.nx, err = paso > n.paso ? nxErrorPaso(paso - 1) : '';
      if (err) { n.error = err; return redib(); }
      n.paso = paso; n.error = ''; redib(foco);
      m.box.querySelector('.mdl-body') && (m.box.querySelector('.mdl-body').scrollTop = 0);
    };
    const b = m.box;
    b.addEventListener('submit', async ev => {
      ev.preventDefault();
      const n = st.nx; if (!n || n.creando) return;
      if (n.paso < 4) return ir(n.paso + 1, n.paso === 1 ? '[data-nxin="nombre"]' : '');
      const falla = nxErrorPaso(3);
      if (falla) { n.error = falla; return redib(); }
      n.creando = true; n.error = ''; redib();
      try {
        const r = await rpc({ accion: 'examen_generar', nombre: n.nombre.trim(), cantidad: n.cant, minutos: n.min, vigenciaDias: n.vig, exigirPantalla: n.pant, permitirAdjuntos: n.adj, iaPermitida: n.ia, perfilIds: [...n.ev], filtros: n.f });
        const notas = r.detalle.filter(x => !x.ok || x.faltan).map(x => x.ok ? `${esc(x.nombre)}: solo hay ${x.preguntas} preguntas disponibles (faltan ${x.faltan})` : `${esc(x.nombre)}: ${esc(x.error)}`);
        n.listo = { id: r.examenId, nombre: n.nombre.trim(), ok: r.detalle.length ? r.detalle.filter(x => x.ok).length : n.ev.size, notas }; n.creando = false;
        await recargar(); pintar(); redib();
      } catch (e) {
        if (e.sesion) setTimeout(() => location.reload(), 1200);
        n.creando = false; n.error = e.message; redib();
      }
    });
    b.addEventListener('click', async ev => {
      const el = ev.target.closest('[data-nx]'); if (!el) return;
      const n = st.nx, a = el.dataset.nx;
      if (a === 'cerrar') { if (n && n.listo) st.nx = null; return m.cerrar(); }   // el borrador se conserva hasta crearlo
      if (a === 'despues') { st.nx = null; return m.cerrar(); }
      if (a === 'atras') { n.paso = Math.max(1, n.paso - 1); n.error = ''; return redib(); }
      if (a === 'ir') { n.paso = Number(el.dataset.paso); n.error = ''; return redib(); }
      if (a === 'set') { n[el.dataset.k] = Number(el.dataset.v); n.error = ''; return redib(); }
      if (a === 'chip') { const arr = n.f[el.dataset.k], v = el.dataset.v, i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); return redib(); }
      if (a === 'todos') {
        const ids = nxFiltra().map(f => f.id);
        if (ids.every(i => n.ev.has(i))) ids.forEach(i => n.ev.delete(i)); else ids.forEach(i => n.ev.add(i));
        n.error = ''; b.querySelector('#nxPersonas').innerHTML = nxListaPersonas(); b.querySelector('#nxCuenta').textContent = nxCuenta();
        el.textContent = ids.every(i => n.ev.has(i)) ? 'Desmarcar todos' : 'Marcar todos'; return;
      }
      if (a === 'ir-banco' || a === 'ir-personas') {
        ev.preventDefault(); m.cerrar(); st.tab = a === 'ir-banco' ? 'banco' : 'personas'; pintar();
        if (st.tab === 'banco') ejecutar(async () => { st.banco = Object.assign(st.banco || {}, { lista: (await rpc({ accion: 'banco_listar' })).preguntas }); });
        return;
      }
      if (a === 'enviar') {
        n.creando = true; n.error = ''; redib();
        try {
          const r = await fb()._post({ accion: 'examenEnviar', token: st.ses.token, examenId: n.listo.id });
          if (!r || r.ok === false) { if (r && r.sesion) { cerrarSesion(); setTimeout(() => location.reload(), 1200); } throw new Error((r && r.error) || 'No se pudieron enviar las invitaciones'); }
          st.nx = null; m.cerrar(); await recargar(); pintar();
          aviso(`<b>${r.enviados} invitación(es) enviada(s).</b>${r.fallos ? ` ${r.fallos} no se pudieron enviar: míralas en la tabla.` : ' Cada persona recibirá un enlace por correo.'}`, r.fallos ? 'aviso' : 'ok');
        } catch (e) { n.creando = false; n.error = e.message; redib(); }
      }
    });
    b.addEventListener('input', ev => {
      const n = st.nx, t = ev.target;
      if (t.dataset.nxin) {
        const k = t.dataset.nxin; n[k] = k === 'nombre' ? t.value : Number(t.value);
        if (k !== 'nombre') b.querySelectorAll(`[data-k="${k}"]`).forEach(c => c.classList.toggle('on', Number(c.dataset.v) === n[k]));
        if (n.error) { n.error = ''; const e = b.querySelector('.msg.mal'); if (e) e.remove(); }
      } else if ('nxq' in t.dataset) { n.q = t.value; b.querySelector('#nxPersonas').innerHTML = nxListaPersonas(); }
    });
    b.addEventListener('change', ev => {
      const n = st.nx, t = ev.target;
      if (t.dataset.nxev) {
        const id = Number(t.dataset.nxev); t.checked ? n.ev.add(id) : n.ev.delete(id);
        t.closest('.nx-persona').classList.toggle('on', t.checked); b.querySelector('#nxCuenta').textContent = nxCuenta(); n.error = '';
        const e = b.querySelector('.msg.mal'); if (e) e.remove();
      } else if (t.dataset.nxsw) n[t.dataset.nxsw] = t.checked;
    });
  }

  // ---------- ventana «Revisar» ----------
  async function abrirRevision(intentoId, tab) {
    const d = await rpc({ accion: 'intento_detalle', intentoId });
    const previo = st.rev && st.rev.id === intentoId ? st.rev : null;
    const sinNota = d.preguntas.findIndex(q => q.calificacion == null);
    st.rev = Object.assign(d, { id: intentoId, tab: tab || (previo && previo.tab) || 'resp', edit: previo ? previo.edit : {}, sucio: previo ? previo.sucio : false,
      vista: previo ? previo.vista : 'paso', i: previo ? Math.min(previo.i, d.preguntas.length - 1) : Math.max(0, sinNota) });
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
    m.box.querySelectorAll('[data-cn]').forEach(i => {
      const n = Number(i.dataset.cn), c = m.box.querySelector(`[data-cc="${n}"]`), q = x.preguntas.find(y => y.n === n);
      const v = { puntos: i.value, comentario: c ? c.value : '' };
      const orig = q ? { puntos: q.calificacion == null ? '' : String(Number(q.calificacion)), comentario: q.comentario || '' } : null;
      if (x.edit[n] || !orig || v.puntos !== orig.puntos || v.comentario !== orig.comentario) x.edit[n] = v;   // lo que no se tocó conserva su origen (p. ej. «Sugerida por la IA»)
    });
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
    const tabs = [['resp', 'Respuestas', x.preguntas.length, ''], ['graf', 'Gráficas', '', ''], ['inc', 'Incidencias', graves.length, graves.length ? 'alerta' : ''], ['cap', 'Capturas', x.capturas.length, '']];
    const it = ex && ex.intentos.find(i => i.id === x.id);
    const resumenTxt = ESTADO_TXT[x.estado] ? ESTADO_TXT[x.estado][0] : x.estado;
    let cuerpo = '';
    if (x.tab === 'resp') {
      const unaPorUna = x.vista !== 'todas' && x.preguntas.length > 1;
      const idx = Math.min(Math.max(0, x.i || 0), x.preguntas.length - 1);
      const hecha = q => { const v = valorCalif(x, q); return v.puntos !== '' && !isNaN(Number(v.puntos)); };
      const barraPasos = unaPorUna ? `<div class="rv-pasos"><div class="rv-pts" role="tablist">${x.preguntas.map((q, k) => `<button type="button" class="rv-pt ${hecha(q) ? 'hecho' : ''} ${k === idx ? 'actual' : ''}" data-rir="${k}" title="Pregunta ${q.n}${hecha(q) ? ' (calificada)' : ''}">${q.n}</button>`).join('')}</div>
          <button type="button" class="btn chico" data-rvista="todas">Ver todas juntas</button></div>`
        : x.preguntas.length > 1 ? `<div class="rv-pasos"><span class="sub">Estás viendo todas las preguntas.</span><button type="button" class="btn chico" data-rvista="paso">Ver una por una</button></div>` : '';
      const navAbajo = unaPorUna ? `<div class="rv-nav"><button type="button" class="btn" data-rnav="-1" ${idx === 0 ? 'disabled' : ''}><i class="fas fa-arrow-left"></i> Anterior</button>
          <span class="sub">Pregunta ${idx + 1} de ${x.preguntas.length}</span>
          <button type="button" class="btn primario" data-rnav="1">${idx === x.preguntas.length - 1 ? (x.sucio ? '<i class="fas fa-floppy-disk"></i> Guardar notas' : 'Terminar') : 'Siguiente <i class="fas fa-arrow-right"></i>'}</button></div>` : '';
      cuerpo = barraPasos + (unaPorUna ? [x.preguntas[idx]] : x.preguntas).map(q => {
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
      }).join('') + navAbajo;
    } else if (x.tab === 'graf') {
      const its = x.preguntas.map(q => { const v = valorCalif(x, q); return { q, v: v.puntos === '' || isNaN(Number(v.puntos)) ? null : Number(v.puntos), mx: Number(q.puntosMax) }; });
      const cal = its.filter(o => o.v != null && o.mx > 0), por = {};
      cal.forEach(o => { const t = o.q.tipo || 'Sin tipo'; (por[t] = por[t] || { s: 0, mx: 0 }); por[t].s += o.v; por[t].mx += o.mx; });
      const resp = x.preguntas.filter(q => q.respuesta).length;
      cuerpo = !cal.length ? '<div class="vacio-grande chico"><i class="fas fa-chart-simple"></i><h3>Aún no hay notas para graficar</h3><p class="sub">Califica las respuestas y aquí verás cómo le fue en cada pregunta.</p></div>'
        : `<div class="kpis kpis-chicos"><div class="kpi azul"><i class="fas fa-list-check"></i><b>${resp}</b><span>de ${x.preguntas.length} respondidas</span></div><div class="kpi morado"><i class="fas fa-pen-to-square"></i><b>${cal.length}</b><span>calificadas</span></div>
            <div class="kpi"><i class="fas fa-circle-check"></i><b>${cal.filter(o => o.v / o.mx >= 0.8).length}</b><span>con 80 % o más</span></div><div class="kpi ambar"><i class="fas fa-circle-exclamation"></i><b>${cal.filter(o => o.v / o.mx < 0.6).length}</b><span>por debajo del 60 %</span></div></div>
          <div class="rejilla-2"><section class="ex-card"><h2>Por pregunta</h2>${barrasH(cal.map(o => ({ t: `P${o.q.n} · ${o.q.codigo}`, p: 100 * o.v / o.mx, det: `${fmtPts(o.v)} de ${fmtPts(o.mx)}` })))}</section>
            <section class="ex-card"><h2>Por tipo de pregunta</h2>${barrasH(Object.entries(por).map(([t, v]) => ({ t, p: 100 * v.s / v.mx, det: `${fmtPts(v.s)} de ${fmtPts(v.mx)}` })).sort((a, b) => b.p - a.p))}</section></div>`;
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
    m.set(`<div class="mdl-head sticky"><div class="ficha-cab">${avatar(x.nombre, it ? fotoDePerfil(it.perfilId) : '', 'grande')}<div><h2>${it ? `<button class="enlace-nombre grande-n" data-fp="${it.perfilId}" title="Ver el detalle de esta persona">${esc(x.nombre)}</button>` : esc(x.nombre)}</h2><div class="sub">${esc(resumenTxt)}${x.iniciadoEn ? ' · empezó ' + esc(fechaCorta(x.iniciadoEn)) : ''}${x.entregadoEn ? ' · entregó ' + esc(fechaCorta(x.entregadoEn)) : ''}${x.motivoCierre === 'tiempo' ? ' (se acabó el tiempo)' : ''}</div></div></div><button class="x" data-rcerrar aria-label="Cerrar">×</button></div>
      <div class="rev-resumen"><div class="nota-bloque"><div class="nota-grande"><b id="revNota">${t.n ? fmtPts(t.suma) : '—'}</b><span> / ${fmtPts(t.maximo)} puntos</span> <em id="revPct">${t.n ? pct(t.suma, t.maximo) + ' %' : ''}</em></div><div id="revBarra">${barra(t.suma, t.maximo)}</div><div class="sub" id="revCont">${t.n} de ${t.total} preguntas calificadas</div></div>
        <div class="rev-acciones">${ex && ex.iaPermitida ? `<button class="btn ${t.n < t.total ? 'primario' : ''}" id="revIA"><i class="fas fa-wand-magic-sparkles"></i> Calificar con IA</button>` : ''}
          <button class="btn primario" id="revGuardar" ${x.sucio ? '' : 'disabled'}><i class="fas fa-floppy-disk"></i> Guardar notas</button></div></div>
      <div class="sub aviso-sucio" id="revSucio" ${x.sucio ? '' : 'hidden'}>Tienes cambios sin guardar.</div>
      ${hayIA ? '<p class="aviso-ia"><i class="fas fa-wand-magic-sparkles"></i> Hay notas sugeridas por la IA. Revísalas: puedes cambiar cualquiera y luego pulsar «Guardar notas».</p>' : ''}
      <div class="tabs-mini">${tabs.map(([k, n, c, cl]) => `<button data-rtab="${k}" class="${x.tab === k ? 'on' : ''}">${n}${c !== '' ? ` <span class="cnt ${cl}">${c}</span>` : ''}</button>`).join('')}</div>
      <div class="mdl-body">${cuerpo}</div>`);
    enlazarRevision();
  }

  function enlazarRevision() {
    const x = st.rev, m = st.revModal, b = m.box;
    b.querySelector('[data-rcerrar]').onclick = () => m.intentarCerrar();
    b.querySelectorAll('[data-fp]').forEach(a => a.onclick = () => abrirFicha(Number(a.dataset.fp)));
    b.querySelectorAll('[data-rtab]').forEach(t => t.onclick = () => { leerCalif(); x.tab = t.dataset.rtab; pintarRevision(); });
    b.querySelectorAll('[data-ver]').forEach(v => v.onclick = () => verArchivo(Number(v.dataset.ver), v.dataset.nombre, v.dataset.mime));
    b.querySelectorAll('[data-captura]').forEach(c => c.onclick = async () => {
      const box = b.querySelector('#revCap'); box.innerHTML = '<p class="sub">Cargando captura…</p>';
      try { const r = await rpc({ accion: 'captura_ver', capturaId: Number(c.dataset.captura) }); box.innerHTML = `<img class="cap-img" src="${r.imagen}" alt="Captura de pantalla">`; }
      catch (e) { box.innerHTML = `<p class="msg mal">${esc(e.message)}</p>`; }
    });
    const irA = k => { leerCalif(); x.i = k; pintarRevision(); const c = m.box.querySelector('.mdl-body'); if (c) c.scrollTop = 0; };
    b.querySelectorAll('[data-rir]').forEach(t => t.onclick = () => irA(Number(t.dataset.rir)));
    b.querySelectorAll('[data-rvista]').forEach(t => t.onclick = () => { leerCalif(); x.vista = t.dataset.rvista; pintarRevision(); });
    b.querySelectorAll('[data-rnav]').forEach(t => t.onclick = () => {
      const d = Number(t.dataset.rnav), k = x.i + d;
      if (k >= x.preguntas.length) { leerCalif(); const g = b.querySelector('#revGuardar'); if (x.sucio && g) g.click(); else m.intentarCerrar(); return; }
      irA(Math.max(0, k));
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
    const eb = document.getElementById('exBuscar');
    if (eb) eb.oninput = () => {
      st.ex.q = eb.value; clearTimeout(st.ex._t);
      st.ex._t = setTimeout(() => { pintar(); const i = document.getElementById('exBuscar'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    };
    q('[data-exf]', b => b.onclick = ev => { ev.preventDefault(); st.ex.filtro = b.dataset.exf; if (b.dataset.limpiar) st.ex.q = ''; guardarPrefsEx(); pintar(); });
    const eo = document.getElementById('exOrden'); if (eo) eo.onchange = () => { st.ex.orden = eo.value; guardarPrefsEx(); pintar(); };
    q('[data-togg]', b => b.onclick = () => { st.ex.vista.set(Number(b.dataset.togg), b.getAttribute('aria-expanded') !== 'true'); pintar(); });
    q('[data-explegar]', b => b.onclick = () => { const abrir = b.dataset.explegar === '1'; examenesVisibles().lista.forEach(o => st.ex.vista.set(o.e.id, abrir)); pintar(); });
    q('[data-nuevo]', b => b.onclick = () => abrirNuevoExamen());
    q('[data-gir]', b => b.onclick = () => {
      const k = b.dataset.gir;
      if (k === 'nuevo') return abrirNuevoExamen();
      if (k === 'personas' || k === 'banco') return app.querySelector(`[data-tab="${k}"]`).click();
      st.ex.filtro = k; st.ex.q = ''; guardarPrefsEx(); pintar();
    });
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

  // ---------- Banco: filtrar, ordenar y paginar ----------
  const nuevoBq = () => ({ q: '', tipo: '', perfil: '', linea: '', dif: '', adj: '', orden: 'codigo', dir: 1, mostrar: 40, herram: false });
  const BQ_COLS = [['codigo', 'ID'], ['tipo', 'Tipo'], ['aplica', 'Aplica a'], ['dificultad', 'Dificultad'], ['puntos', 'Pts'], ['pregunta', 'Pregunta'], ['adj', 'Adjuntos']];
  const RANGO_DIF = ['Bajo', 'Medio', 'Alto'];

  function bancoFiltrado() {
    const b = st.bq, lista = (st.banco && st.banco.lista) || [], q = quitarTildes(b.q);
    const l = lista.filter(p => (!q || quitarTildes(`${p.codigo} ${p.pregunta} ${p.respuestaModelo || ''}`).includes(q))
      && (!b.tipo || p.tipo === b.tipo) && (!b.dif || p.dificultad === b.dif)
      && (!b.perfil || !p.perfiles.length || p.perfiles.includes(b.perfil)) && (!b.linea || !p.lineas.length || p.lineas.includes(b.linea))
      && (!b.adj || (b.adj === 'con' ? (p.adjuntos || []).length > 0 : !(p.adjuntos || []).length)));
    const clave = { codigo: p => p.codigo, tipo: p => p.tipo, aplica: p => `${p.perfiles.join(',')}|${p.lineas.join(',')}`, dificultad: p => RANGO_DIF.indexOf(p.dificultad),
      puntos: p => Number(p.puntos), pregunta: p => p.pregunta, adj: p => (p.adjuntos || []).length }[b.orden] || (p => p.codigo);
    l.sort((a, c) => {
      const x = clave(a), y = clave(c);
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
      return (r || String(a.codigo).localeCompare(String(c.codigo), 'es', { numeric: true })) * b.dir;
    });
    return { lista, filtrado: l };
  }

  function toolbarBanco() {
    const b = st.bq, lista = (st.banco && st.banco.lista) || [], cat = st.d.catalogo;
    const sel = (id, tit, valor, ops) => `<label class="filtro"><span>${tit}</span><select id="${id}"><option value="">Todos</option>${ops.map(o => `<option ${o === valor ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    const porTipo = (cat.TIPO || []).map(t => [t, lista.filter(p => p.tipo === t).length]);
    const activos = ['tipo', 'perfil', 'linea', 'dif', 'adj', 'q'].filter(k => b[k]).length;
    return `<div class="kpis kpis-chicos"><div class="kpi azul"><i class="fas fa-database"></i><b>${lista.length}</b><span>preguntas en tu banco</span></div>
        ${porTipo.map(([t, n]) => `<button class="kpi ${b.tipo === t ? 'activo' : ''}" data-bqtipo="${esc(t)}" title="Filtrar por ${esc(t)}"><b>${n}</b><span>${esc(t)}</span></button>`).join('')}
        <div class="kpi"><i class="fas fa-paperclip"></i><b>${lista.filter(p => (p.adjuntos || []).length).length}</b><span>con adjuntos</span></div></div>
      <div class="toolbar"><div class="buscar"><i class="fas fa-search"></i><input id="bqBuscar" type="search" placeholder="Buscar por texto o ID" value="${esc(b.q)}"></div>
        ${sel('bqPerfil', 'Aplica al perfil', b.perfil, cat.PERFIL || [])}${sel('bqLinea', 'Línea de negocio', b.linea, cat.LINEA || [])}${sel('bqDif', 'Dificultad', b.dif, cat.DIFICULTAD || [])}
        <label class="filtro"><span>Adjuntos</span><select id="bqAdj"><option value="">Todas</option><option value="con" ${b.adj === 'con' ? 'selected' : ''}>Con adjuntos</option><option value="sin" ${b.adj === 'sin' ? 'selected' : ''}>Sin adjuntos</option></select></label>
        ${activos ? '<a href="#" class="btn chico" data-bqlimpiar>Quitar filtros</a>' : ''}
        <span class="espacio"></span><button class="btn ${b.herram ? 'activo' : ''}" id="bqHerr"><i class="fas fa-file-import"></i> Cargar desde Excel o material</button>
        <button class="btn primario" id="pqAbrir"><i class="fas fa-plus"></i> Nueva pregunta</button></div>`;
  }

  function tablaBanco() {
    const b = st.bq, B = st.banco;
    if (!B || !B.lista) return '<p class="vacio">Cargando…</p>';
    if (!B.lista.length) return '<div class="vacio-grande"><i class="fas fa-database"></i><h3>Tu banco está vacío</h3><p class="sub">Escribe tu primera pregunta o cárgalas desde un Excel con «Cargar desde Excel o material».</p></div>';
    const { filtrado } = bancoFiltrado();
    if (!filtrado.length) return '<div class="vacio-grande chico"><i class="fas fa-filter-circle-xmark"></i><h3>Ninguna pregunta coincide</h3><a class="btn" href="#" data-bqlimpiar>Quitar filtros</a></div>';
    const vis = filtrado.slice(0, b.mostrar);
    const flecha = k => b.orden === k ? `<i class="fas fa-arrow-${b.dir > 0 ? 'up' : 'down'}"></i>` : '<i class="fas fa-sort sutil"></i>';
    const difIns = d => !d ? '<span class="sub">—</span>' : `<span class="ins ${d === 'Alto' ? 'rojo' : d === 'Medio' ? 'ambar' : 'verde'}">${esc(d)}</span>`;
    return `<div class="scroll"><table class="tabla tabla-banco"><tr>${BQ_COLS.map(([k, t]) => `<th class="ordenable ${b.orden === k ? 'on' : ''}" data-bqs="${k}">${t} ${flecha(k)}</th>`).join('')}<th></th></tr>
      ${vis.map(q => `<tr><td class="cod">${esc(q.codigo)}</td><td><span class="ins gris">${esc(q.tipo)}</span></td>
        <td><div class="aplica"><span class="meta">${esc(q.perfiles.join(', ') || 'Todos los perfiles')}</span><span class="meta">${esc(q.lineas.join(', ') || 'Todas las líneas')}</span></div></td>
        <td>${difIns(q.dificultad)}</td><td>${fmtPts(q.puntos)}</td>
        <td class="col-preg"><div class="clamp2">${esc(q.pregunta)}</div>${q.respuestaModelo ? `<div class="sub clamp1">Modelo: ${esc(q.respuestaModelo)}</div>` : '<div class="sub">Sin respuesta modelo</div>'}</td>
        <td><button class="btn chico" data-adj="${q.id}" title="Ver o agregar adjuntos"><i class="fas fa-paperclip"></i> ${(q.adjuntos || []).length}</button></td>
        <td class="acc"><button class="btn chico" data-editar="${q.id}">Editar</button> <button class="btn chico enlace-mal" data-borrar="${q.id}">Eliminar</button></td></tr>`).join('')}</table></div>
      <div class="pie-tabla"><span class="sub">Mostrando ${vis.length} de ${filtrado.length}${filtrado.length !== B.lista.length ? ` (filtradas de ${B.lista.length})` : ''}</span>
        ${filtrado.length > vis.length ? `<button class="btn" id="bqMas">Mostrar ${Math.min(40, filtrado.length - vis.length)} más</button>` : ''}</div>`;
  }

  function enlazarBanco(q) {
    const b = st.bq;
    const bb = document.getElementById('bqBuscar');
    if (bb) bb.oninput = () => {
      b.q = bb.value; b.mostrar = 40; clearTimeout(b._t);
      b._t = setTimeout(() => { pintar(); const i = document.getElementById('bqBuscar'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    };
    for (const [id, k] of [['bqPerfil', 'perfil'], ['bqLinea', 'linea'], ['bqDif', 'dif'], ['bqAdj', 'adj']]) { const el = document.getElementById(id); if (el) el.onchange = () => { b[k] = el.value; b.mostrar = 40; pintar(); }; }
    q('[data-bqtipo]', x => x.onclick = () => { b.tipo = b.tipo === x.dataset.bqtipo ? '' : x.dataset.bqtipo; b.mostrar = 40; pintar(); });
    q('[data-bqs]', th => th.onclick = () => { if (b.orden === th.dataset.bqs) b.dir *= -1; else { b.orden = th.dataset.bqs; b.dir = 1; } pintar(); });
    q('[data-bqlimpiar]', a => a.onclick = ev => { ev.preventDefault(); Object.assign(b, { q: '', tipo: '', perfil: '', linea: '', dif: '', adj: '', mostrar: 40 }); pintar(); });
    const mas = document.getElementById('bqMas'); if (mas) mas.onclick = () => { b.mostrar += 40; pintar(); };
    const hb = document.getElementById('bqHerr'); if (hb) hb.onclick = () => { b.herram = !b.herram; pintar(); };
    const hc = document.getElementById('bqHerrCerrar'); if (hc) hc.onclick = () => { b.herram = false; pintar(); };
  }

  function vistaBanco() {
    const b = st.banco;
    const rep = b && b.reporte ? `<div class="msg ${b.reporte.errores.length ? 'aviso' : 'ok'}"><b>${b.reporte.guardadas}</b> preguntas guardadas${b.reporte.errores.length ? `, <b>${b.reporte.errores.length}</b> con error:` : '.'}
      ${b.reporte.errores.length ? `<ul>${b.reporte.errores.slice(0, 40).map(e => `<li>Fila ${e.fila}${e.codigo ? ' (' + esc(e.codigo) + ')' : ''}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}</div>` : '';
    const lista = tablaBanco();
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
    const formulario = !f ? ''
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
    const excelCard = `<div class="ex-card"><h2>Cargar preguntas desde Excel</h2>
      <p class="sub">Columnas: ID, Usuario, Línea de negocio, Dificultad (opcional), Tipo de pregunta, Pregunta y Respuesta modelo. Para varias opciones sepáralas con «;» (Pasante;Ingeniero). Vacío = aplica a todos. Si el ID ya existe se actualiza. Opcional: «Puntos» (lo que vale la pregunta; si falta, 10) y «Enlaces» con enlaces https (separados por «;»); los archivos se adjuntan después, pregunta por pregunta, con el clip.</p>
      <input type="file" id="exArchivo" accept=".xlsx,.xls" style="max-width:360px"> <button class="btn chico" id="exPlantilla"><i class="fas fa-download"></i> Descargar plantilla</button>
      ${rep}</div>`;
    const herram = st.bq.herram || mv.items.length || mv.resumen || (b && b.reporte);
    return `${toolbarBanco()}${panel}${formulario}
      ${herram ? `<div class="herram"><div class="herram-cab"><h3><i class="fas fa-file-import"></i> Cargar preguntas y material</h3><button class="btn chico" id="bqHerrCerrar">Cerrar</button></div><div class="herram-grid">${excelCard}${masivo}</div></div>` : ''}
      <div class="ex-card tabla-banco-card">${lista}</div>`;
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
      return `<tr class="${cambio ? 'fila-cambio' : ''}"><td><div class="pers">${avatar(e.nombre, fotoSrc(e.foto))}<div><b>${esc(e.nombre)}</b><div class="sub">${esc(e.id)} · ${esc(e.cargo || e.cargoNomina || '')}</div></div></div></td>
        <td class="sub">${e.evaluadorId ? `<div class="pers">${avatar(nombreDe(e.evaluadorId), fotoDeEmp(e.evaluadorId), 'chico')}<span>${esc(nombreDe(e.evaluadorId))}</span></div>` : '—'}</td>
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
      <div class="rejilla-2"><details class="ex-card plegable" open><summary><h2>Candidatos externos</h2></summary><p class="sub">Personas que no están en la nómina; solo se identifican por correo.</p>
      <div class="fila"><label>Nombre<input id="xNombre"></label><label>Correo electrónico<input id="xCorreo" type="email"></label>
        <label>Perfil<select id="xPerfil">${(cat.PERFIL || []).map(v => `<option>${esc(v)}</option>`).join('')}</select></label></div>
      <div class="sub">Líneas de negocio (varias; sin marcar = todas)</div>${chips('lineas_ext', cat.LINEA || [])}
      <button class="btn primario" id="xGuardar">Agregar candidato</button>
      ${ext.length ? `<div class="scroll"><table class="tabla"><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th></th></tr>${ext.map(f => `<tr><td><div class="pers">${avatar(f.nombre, '', 'chico')}<span>${esc(f.nombre)}</span></div></td><td>${esc(f.correo)}</td><td>${esc(f.perfil + (f.lineas.length ? ' · ' + f.lineas.join(', ') : ' · todas'))}</td><td><button class="btn chico peligro" data-baja="${f.id}">Eliminar</button></td></tr>`).join('')}</table></div>` : ''}</details>
      <details class="ex-card plegable"><summary><h2>Catálogos</h2></summary><p class="sub">Agrega opciones nuevas que luego podrás usar en perfiles, en el Excel y en los filtros.</p>
      <div class="fila"><label>Catálogo<select id="cTipo"><option value="PERFIL">Perfil</option><option value="LINEA">Línea de negocio</option><option value="TIPO">Tipo de pregunta</option><option value="DIFICULTAD">Dificultad</option></select></label>
      <label>Nuevo valor<input id="cValor"></label></div><button class="btn" id="cAgregar">Agregar</button></details></div>`;
  }

  // ---------- fotos y avatares ----------
  function fotoSrc(url, size = 120) {   // misma lógica que el panel: enlaces de Drive → miniatura del CDN de Google
    url = String(url || '').trim();
    if (!url) return '';
    if (/^(data:image|blob:)/.test(url)) return url;
    if (url.includes('googleusercontent.com/d/')) return url.includes('=') ? url : `${url}=w${size}`;
    const m = url.match(/\/file\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/) || url.match(/\/d\/([\w-]+)/);
    return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w${size}` : url;
  }
  const iniciales = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const avatar = (nombre, foto, cl) => `<span class="av ${cl || ''}">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc(iniciales(nombre))}</span></span>`;
  const perfilDe = perfilId => (st.d.perfiles || []).find(f => f.id === perfilId) || null;
  const fotoDePerfil = perfilId => { const f = perfilDe(perfilId), e = f && f.empleadoId ? empPorId(f.empleadoId) : null; return e ? fotoSrc(e.foto) : ''; };
  const fotoDeEmp = id => { const e = empPorId(id); return e ? fotoSrc(e.foto) : ''; };

  // ---------- gráficas (SVG y barras, sin librerías) ----------
  const colNota = p => p >= 80 ? 'var(--ok)' : p >= 60 ? 'var(--aviso)' : 'var(--mal)';
  const diaCorto = t => t ? new Date(t).toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) : '';
  function graficaLinea(pts) {          // pts: [{ p, etq, tip }]
    const W = 560, H = 230, L = 38, R = 16, T = 14, B = 34, n = pts.length;
    const x = i => n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1), y = v => T + (H - T - B) * (1 - v / 100);
    const grid = [0, 20, 40, 60, 80, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gr-grid ${v === 60 || v === 80 ? 'meta' : ''}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="gr-t">${v}</text>`).join('');
    const ruta = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
    const paso = Math.ceil(n / 8);
    return `<svg viewBox="0 0 ${W} ${H}" class="gr" role="img" aria-label="Evolución de las notas por examen">${grid}
      ${n > 1 ? `<path d="${ruta}" class="gr-linea"/>` : ''}
      ${pts.map((q, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(q.p).toFixed(1)}" r="6" fill="${colNota(q.p)}" class="gr-punto"><title>${esc(q.tip)}</title></circle>
        <text x="${x(i).toFixed(1)}" y="${(y(q.p) - 11).toFixed(1)}" text-anchor="middle" class="gr-v">${Math.round(q.p)}%</text>
        ${i % paso === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="gr-t">${esc(q.etq)}</text>` : ''}`).join('')}</svg>`;
  }
  function barrasH(items) {             // items: [{ t, p, det }]
    return `<div class="gb">${items.map(it => `<div class="gb-f"><span class="gb-t" title="${esc(it.t)}">${esc(it.t)}</span><div class="gb-b"><i style="width:${Math.max(2, Math.min(100, it.p))}%;background:${colNota(it.p)}"></i></div><b>${Math.round(it.p)}%</b>${it.det ? `<small>${esc(it.det)}</small>` : ''}</div>`).join('')}</div>`;
  }
  function histograma(vals) {
    const rangos = [['Menos de 40', 0, 40, 'var(--mal)'], ['40 a 59', 40, 60, '#f97316'], ['60 a 79', 60, 80, 'var(--aviso)'], ['80 o más', 80, 101, 'var(--ok)']];
    const cuentas = rangos.map(([, a, b]) => vals.filter(v => v >= a && v < b).length), mx = Math.max(1, ...cuentas);
    return `<div class="hist">${rangos.map(([t, , , c], i) => `<div class="hist-c"><b>${cuentas[i]}</b><div class="hist-b"><i style="height:${Math.round(100 * cuentas[i] / mx)}%;background:${c}"></i></div><span>${t}</span></div>`).join('')}</div>`;
  }
  function spark(vals) {
    if (vals.length < 2) return `<span class="sub">—</span>`;
    const W = 84, H = 26, x = i => 3 + i * (W - 6) / (vals.length - 1), y = v => 3 + (H - 6) * (1 - v / 100);
    return `<svg viewBox="0 0 ${W} ${H}" class="spark"><path d="${vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/><circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="2.6" fill="${colNota(vals[vals.length - 1])}"/></svg>`;
  }

  // ---------- resultados por persona ----------
  const completa = i => i.estado === 'ENTREGADO' && Number(i.maximo) > 0 && (i.calificadas || 0) >= i.preguntas && i.calificadas > 0;
  const pctDe = i => 100 * Number(i.puntos) / Number(i.maximo);
  function resultadosPersonas() {
    const m = new Map();
    st.d.examenes.forEach(e => e.intentos.forEach(i => {
      if (i.estado === 'ANULADO') return;
      let p = m.get(i.perfilId); if (!p) { p = { perfilId: i.perfilId, nombre: i.nombre, correo: i.correo, intentos: [] }; m.set(i.perfilId, p); }
      p.intentos.push(Object.assign({}, i, { examenNombre: e.nombre, examenId: e.id }));
    }));
    return [...m.values()].map(p => {
      p.cal = p.intentos.filter(completa).sort((a, b) => new Date(a.entregadoEn) - new Date(b.entregadoEn));
      const v = p.cal.map(pctDe);
      p.pcts = v; p.prom = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      p.mejor = v.length ? Math.max(...v) : null; p.ultimo = v.length ? v[v.length - 1] : null;
      p.tend = v.length > 1 ? v[v.length - 1] - v[v.length - 2] : null;
      p.entregados = p.intentos.filter(i => i.estado === 'ENTREGADO').length;
      p.incid = p.intentos.reduce((a, i) => a + (i.incidencias || 0), 0);
      p.porCalificar = p.intentos.filter(i => i.estado === 'ENTREGADO' && !completa(i)).length;
      return p;
    });
  }
  const ORDENES_RES = [['prom', 'Mejor promedio'], ['nombre', 'Nombre (A–Z)'], ['recientes', 'Entrega más reciente'], ['alertas', 'Con más incidencias']];
  const flechaTend = t => t == null ? '' : Math.abs(t) < 1 ? '<span class="tend igual" title="Igual que el examen anterior">= igual</span>'
    : t > 0 ? `<span class="tend sube" title="Frente al examen anterior"><i class="fas fa-arrow-trend-up"></i> +${Math.round(t)} pts</span>` : `<span class="tend baja" title="Frente al examen anterior"><i class="fas fa-arrow-trend-down"></i> ${Math.round(t)} pts</span>`;

  function vistaResultados() {
    const R = st.res, q = quitarTildes(R.q);
    const todos = resultadosPersonas();
    const conNota = todos.filter(p => p.prom != null);
    const ultimaEntrega = p => Math.max(0, ...p.intentos.map(i => i.entregadoEn ? new Date(i.entregadoEn).getTime() : 0));
    const orden = { prom: (a, b) => (b.prom ?? -1) - (a.prom ?? -1) || a.nombre.localeCompare(b.nombre, 'es'), nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      recientes: (a, b) => ultimaEntrega(b) - ultimaEntrega(a), alertas: (a, b) => b.incid - a.incid || a.nombre.localeCompare(b.nombre, 'es') }[R.orden];
    const lista = todos.filter(p => !q || quitarTildes(p.nombre + ' ' + p.correo).includes(q)).sort(orden);
    const prom = conNota.length ? conNota.reduce((a, p) => a + p.prom, 0) / conNota.length : null;
    const top = [...conNota].sort((a, b) => b.prom - a.prom)[0];
    if (!todos.length) return `<div class="ex-card vacio-grande"><i class="fas fa-chart-line"></i><h3>Aún no hay resultados</h3><p class="sub">Cuando las personas entreguen sus exámenes y los califiques, aquí verás sus notas, su evolución y sus gráficas.</p></div>`;
    const kpis = [['fa-users', todos.length, 'personas con exámenes', 'azul'], ['fa-percent', prom == null ? '—' : Math.round(prom) + ' %', 'promedio general', 'morado'],
      ['fa-trophy', top ? Math.round(top.prom) + ' %' : '—', top ? 'mejor promedio · ' + top.nombre.split(' ')[0] : 'mejor promedio', 'azul'], ['fa-triangle-exclamation', todos.filter(p => p.incid > 0).length, 'con incidencias para revisar', 'ambar']]
      .map(([ic, n, t, c]) => `<div class="kpi ${c}"><i class="fas ${ic}"></i><b>${n}</b><span>${esc(t)}</span></div>`).join('');
    const tarjetas = lista.map(p => {
      const pe = perfilDe(p.perfilId);
      return `<button class="pcard" data-ficha="${p.perfilId}">
        <div class="pcard-top">${avatar(p.nombre, fotoDePerfil(p.perfilId), 'grande')}<div class="pcard-n"><b>${esc(p.nombre)}</b><small>${esc(pe ? pe.perfil : '')}${pe && pe.lineas && pe.lineas.length ? ' · ' + esc(pe.lineas.join(', ')) : ''}</small></div>
          ${p.incid ? `<span class="alerta" title="Incidencias en sus exámenes"><i class="fas fa-triangle-exclamation"></i> ${p.incid}</span>` : ''}</div>
        <div class="pcard-nota">${p.prom == null ? '<span class="sub">Sin calificar todavía</span>' : `<b style="color:${colNota(p.prom)}">${Math.round(p.prom)} %</b><span class="sub">promedio</span>${flechaTend(p.tend)}`}<span class="espacio"></span>${spark(p.pcts)}</div>
        <div class="pcard-pie"><span>${p.intentos.length} examen${p.intentos.length === 1 ? '' : 'es'}</span><span>${p.entregados} entregado${p.entregados === 1 ? '' : 's'}</span>${p.porCalificar ? `<span class="ins morado">${p.porCalificar} por calificar</span>` : ''}</div></button>`;
    }).join('');
    return `<div class="kpis">${kpis}</div>
      <div class="rejilla-2"><div class="ex-card"><h2>Cómo se reparten las notas</h2><p class="sub">Un examen calificado por persona: se cuenta el promedio de cada una.</p>${conNota.length ? histograma(conNota.map(p => p.prom)) : '<p class="vacio">Todavía no hay notas.</p>'}</div>
        <div class="ex-card"><h2>Ranking de promedios</h2>${conNota.length ? barrasH([...conNota].sort((a, b) => b.prom - a.prom).slice(0, 8).map(p => ({ t: p.nombre, p: p.prom, det: `${p.cal.length} examen${p.cal.length === 1 ? '' : 'es'}` }))) : '<p class="vacio">Todavía no hay notas.</p>'}</div></div>
      <div class="toolbar"><div class="buscar"><i class="fas fa-search"></i><input id="rsBuscar" type="search" placeholder="Buscar persona" value="${esc(R.q)}"></div>
        <label class="orden">Ordenar<select id="rsOrden">${ORDENES_RES.map(([k, t]) => `<option value="${k}" ${R.orden === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      ${lista.length ? `<div class="sub resultados-n">${lista.length} de ${todos.length} persona(s) · toca una para ver su detalle</div><div class="rejilla-personas">${tarjetas}</div>` : '<div class="ex-card vacio-grande chico"><h3>Nadie coincide</h3></div>'}`;
  }

  // ---------- ficha de una persona: datos, evolución y rendimiento por tipo de pregunta ----------
  async function abrirFicha(perfilId) {
    const p = resultadosPersonas().find(x => x.perfilId === perfilId); if (!p) return;
    const pe = perfilDe(perfilId), emp = pe && pe.empleadoId ? empPorId(pe.empleadoId) : null;
    const datos = [emp && emp.cargo, emp && emp.unidad, emp && emp.area, pe && pe.perfil, pe && (pe.lineas && pe.lineas.length ? pe.lineas.join(', ') : 'Todas las líneas')].filter(Boolean);
    const filas = [...p.intentos].sort((a, b) => new Date(b.entregadoEn || b.iniciadoEn || 0) - new Date(a.entregadoEn || a.iniciadoEn || 0)).map(i => {
      const parcial = i.calificadas > 0 && !completa(i);
      return `<tr><td><b>${esc(i.examenNombre)}</b></td><td>${insignia(i.estado)}</td><td class="sub">${esc(i.entregadoEn ? fechaCorta(i.entregadoEn) : i.iniciadoEn ? 'Empezó ' + fechaCorta(i.iniciadoEn) : '—')}</td>
        <td>${i.calificadas > 0 ? `<b>${fmtPts(i.puntos)}</b> / ${fmtPts(i.maximo)} <span class="sub">· ${pct(i.puntos, i.maximo)} %${parcial ? ' (parcial)' : ''}</span>${barra(i.puntos, i.maximo)}` : i.estado === 'ENTREGADO' ? '<span class="sub">Sin calificar</span>' : '<span class="sub">—</span>'}</td>
        <td>${i.incidencias ? `<span class="alerta"><i class="fas fa-triangle-exclamation"></i> ${i.incidencias}</span>` : '<span class="sub">0</span>'}</td>
        <td class="acc">${i.iniciadoEn ? `<button class="btn chico" data-fr="${i.id}">${i.estado === 'ENTREGADO' ? 'Revisar' : 'Ver avance'}</button>` : ''}</td></tr>`;
    }).join('');
    const m = modal(`<div class="mdl-head sticky"><div class="ficha-cab">${avatar(p.nombre, fotoDePerfil(perfilId), 'xl')}<div><h2>${esc(p.nombre)}</h2><div class="sub">${esc(p.correo || '')}</div>
        <div class="metas" style="margin-top:6px">${datos.map(d => `<span class="meta">${esc(d)}</span>`).join('')}</div></div></div><button class="x" data-fx aria-label="Cerrar">×</button></div>
      <div class="mdl-body">
        <div class="kpis kpis-chicos"><div class="kpi azul"><i class="fas fa-clipboard-list"></i><b>${p.intentos.length}</b><span>examen${p.intentos.length === 1 ? '' : 'es'} · ${p.entregados} entregado${p.entregados === 1 ? '' : 's'}</span></div>
          <div class="kpi morado"><i class="fas fa-percent"></i><b>${p.prom == null ? '—' : Math.round(p.prom) + ' %'}</b><span>promedio${p.tend != null ? ' · ' + (p.tend > 0 ? 'subiendo' : p.tend < 0 ? 'bajando' : 'estable') : ''}</span></div>
          <div class="kpi"><i class="fas fa-trophy"></i><b>${p.mejor == null ? '—' : Math.round(p.mejor) + ' %'}</b><span>mejor nota</span></div>
          <div class="kpi ambar"><i class="fas fa-triangle-exclamation"></i><b>${p.incid}</b><span>incidencias en total</span></div></div>
        <div class="rejilla-2">
          <section class="ex-card"><h2>Evolución de sus notas</h2>${p.cal.length ? graficaLinea(p.cal.map(i => ({ p: pctDe(i), etq: diaCorto(i.entregadoEn), tip: `${i.examenNombre}: ${fmtPts(i.puntos)} de ${fmtPts(i.maximo)} (${Math.round(pctDe(i))} %)` }))) + '<p class="sub">Las líneas punteadas marcan el 60 % y el 80 %.</p>' : '<p class="vacio">Aún no tiene exámenes calificados por completo.</p>'}</section>
          <section class="ex-card"><h2>Rendimiento por tipo de pregunta</h2><div id="fichaTipos"><p class="sub">${p.cal.length ? 'Calculando…' : 'Se mostrará cuando tenga exámenes calificados.'}</p></div></section></div>
        <section class="ex-card"><h2>Sus exámenes</h2><div class="scroll"><table class="tabla gente"><tr><th>Examen</th><th>Estado</th><th>Fecha</th><th>Nota</th><th>Incidencias</th><th></th></tr>${filas}</table></div></section>
      </div>`, { ancho: 1000 });
    m.box.querySelector('[data-fx]').onclick = () => m.cerrar();
    m.box.querySelectorAll('[data-fr]').forEach(b => b.onclick = () => ejecutar(() => abrirRevision(Number(b.dataset.fr)), b));
    if (!p.cal.length) return;
    try {   // el detalle por pregunta se pide aparte (solo exámenes ya calificados)
      const dets = await Promise.all(p.cal.map(i => rpc({ accion: 'intento_detalle', intentoId: i.id })));
      const por = {};
      dets.forEach(d => d.preguntas.forEach(q => { if (q.calificacion == null) return; const t = q.tipo || 'Sin tipo'; (por[t] = por[t] || { s: 0, mx: 0, n: 0 }); por[t].s += Number(q.calificacion); por[t].mx += Number(q.puntosMax); por[t].n++; }));
      const items = Object.entries(por).filter(([, v]) => v.mx > 0).map(([t, v]) => ({ t, p: 100 * v.s / v.mx, det: `${v.n} preg.` })).sort((a, b) => b.p - a.p);
      const box = m.box.querySelector('#fichaTipos');
      if (box) box.innerHTML = items.length ? barrasH(items) + (items.length > 1 ? `<p class="sub">Su punto fuerte: <b>${esc(items[0].t)}</b>. A reforzar: <b>${esc(items[items.length - 1].t)}</b>.</p>` : '') : '<p class="sub">Sin preguntas calificadas.</p>';
    } catch (e) { const box = m.box.querySelector('#fichaTipos'); if (box) box.innerHTML = `<p class="msg mal">${esc(e.message)}</p>`; }
  }

  function enlazarResultados(q) {
    q('[data-ficha]', b => b.onclick = () => abrirFicha(Number(b.dataset.ficha)));
    const rb = document.getElementById('rsBuscar');
    if (rb) rb.oninput = () => { st.res.q = rb.value; clearTimeout(st.res._t); st.res._t = setTimeout(() => { pintar(); const i = document.getElementById('rsBuscar'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
    const ro = document.getElementById('rsOrden'); if (ro) ro.onchange = () => { st.res.orden = ro.value; pintar(); };
  }

  function pintar() {
    if (!st.d) return;
    st.sel.lineas_ext = st.sel.lineas_ext || [];
    const tabs = [['examenes', 'Exámenes', 'fa-clipboard-list'], ['banco', 'Banco de preguntas', 'fa-database'], ['resultados', 'Resultados', 'fa-chart-line'], ['personas', 'Personas', 'fa-users']];
    app.innerHTML = `<div class="ex-top"><div><h1><i class="fas fa-clipboard-question"></i> Evaluaciones técnicas</h1><small>Evaluador ${esc(st.d.yo)}${st.d.master ? ' · master' : ''}</small></div>
      <div class="ex-top-acc">${st.tab === 'examenes' ? '<button class="btn primario" data-nuevo><i class="fas fa-plus"></i> Nuevo examen</button>' : ''}<button class="btn chico" id="exSalir">Salir</button></div></div>
      <div class="ex-tabs">${tabs.map(t => `<button data-tab="${t[0]}" class="${st.tab === t[0] ? 'on' : ''}"><i class="fas ${t[2]}"></i> ${t[1]}</button>`).join('')}</div>
      ${st.tab === 'examenes' ? vistaExamenes() : st.tab === 'banco' ? vistaBanco() : st.tab === 'resultados' ? vistaResultados() : vistaPersonas()}`;
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
    enlazarBanco(q);
    enlazarResultados(q);

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
    st.ex = cargarPrefsEx(); st.bq = nuevoBq();
    pintar();
  }
  iniciar();
})();
