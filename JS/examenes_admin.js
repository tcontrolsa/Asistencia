// Plataforma de evaluación técnica · panel del evaluador (fase 1).
// Personas, banco de preguntas (carga desde Excel), generación de exámenes y envío de enlaces por correo.
// Datos: PostgREST api.examenes (db/postgres/019_examenes.sql) por Apps Script (evalRpc) con el token de contraseña
// de Desempeño; el envío de correos lo hace Apps Script (examenes.gs, acción examenEnviar).
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const app = document.getElementById('exApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, d: null, tab: 'examenes', sel: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, evaluados: new Set(), msg: null, banco: null, emps: [], correos: {}, pers: { q: '', unidad: null, area: '', soloPart: false, edits: new Map(), guardando: false } };
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
  async function rpc(p) {
    const r = await fb()._post({ accion: 'evalRpc', token: st.ses.token, fn: 'examenes', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con el servidor de evaluaciones.');
    if (r.status === 401) { cerrarSesion(); throw vencida(); }
    if (!r.body || r.body.ok !== true) throw new Error((r.body && (r.body.error || r.body.message)) || 'No se pudo completar');
    return r.body;
  }
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
      || (v.evaluado && (v.perfil !== g.perfil || !mismoSet(v.lineas, g.lineas) || v.correo !== g.correo));
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

  // ---------- Excel ----------
  const COLS = { id: 'codigo', usuario: 'perfiles', 'linea de negocio': 'lineas', lineas: 'lineas', 'tipo de pregunta': 'tipo', tipo: 'tipo',
    dificultad: 'dificultad', pregunta: 'pregunta', 'respuesta modelo': 'respuestaModelo', respuesta: 'respuestaModelo' };
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
        respuestaModelo: String(o.respuestaModelo ?? '').trim()
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
    const filas = [['ID', 'Usuario', 'Linea de negocio', 'Dificultad', 'Tipo de pregunta', 'Pregunta', 'Respuesta modelo'],
      ['P001', 'Pasante;Ingeniero', 'Baja Tensión', 'Medio', 'Técnica', '¿Cuál es la diferencia entre un seccionador y un disyuntor?', 'El seccionador aísla sin carga; el disyuntor interrumpe bajo carga.'],
      ['P002', '', '', 'Bajo', 'Proceso', 'Pregunta que aplica a todos los perfiles y líneas (déjalos vacíos).', '']];
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

  function vistaExamenes() {
    const d = st.d, cat = d.catalogo;
    const evaluados = d.perfiles.filter(f => f.rol === 'EVALUADO');
    const filas = d.examenes.map(e => {
      const pend = e.intentos.filter(i => i.estado === 'GENERADO').length;
      return `<div class="ex-card"><div class="ex-top"><div><b>${esc(e.nombre)}</b><br><small>${e.cantidad} preguntas · ${e.minutos} min · ${new Date(e.creadoEn).toLocaleString('es-EC')}</small></div>
        <div><button class="btn chico primario" data-enviar="${e.id}" ${e.intentos.some(i => i.estado === 'GENERADO' || i.estado === 'ENVIADO') ? '' : 'disabled'}><i class="fas fa-paper-plane"></i> ${pend ? `Enviar pendientes (${pend})` : 'Reenviar a todos'}</button></div></div>
        <div class="scroll"><table class="tabla"><tr><th>Evaluado</th><th>Correo</th><th>Preguntas</th><th>Estado</th><th></th></tr>
        ${e.intentos.map(i => `<tr><td>${esc(i.nombre)}</td><td>${esc(i.correo)}</td><td>${i.preguntas}</td>
          <td><span class="etq ${i.estado}">${i.estado}</span>${i.errorEnvio ? `<br><small style="color:#fca5a5">${esc(i.errorEnvio)}</small>` : ''}</td>
          <td style="white-space:nowrap">${i.estado === 'GENERADO' || i.estado === 'ENVIADO' ? `<button class="btn chico" data-enviar="${e.id}" data-intento="${i.id}">${i.estado === 'ENVIADO' ? 'Reenviar' : 'Enviar'}</button> <button class="btn chico peligro" data-anular="${i.id}">Anular</button>` : ''}</td></tr>`).join('')}
        </table></div></div>`;
    }).join('');
    return `<div class="ex-card"><h2>Nuevo examen</h2>
      ${d.preguntas === 0 ? '<p class="msg aviso">Primero carga preguntas en la pestaña «Banco de preguntas».</p>' : ''}
      ${evaluados.length === 0 ? '<p class="msg aviso">Primero agrega evaluados en la pestaña «Personas».</p>' : ''}
      <div class="fila"><label>Nombre del examen<input id="exNombre" placeholder="Ej. Evaluación de ingreso Q4"></label>
        <label>Cantidad de preguntas<input id="exCant" type="number" min="1" max="100" value="10"></label>
        <label>Tiempo (minutos)<input id="exMin" type="number" min="1" max="600" value="45"></label>
        <label>Vigencia del enlace (días)<input id="exVig" type="number" min="1" max="60" value="7"></label></div>
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
      <h2>Exámenes generados</h2>${filas || '<p class="vacio">Aún no generas ningún examen.</p>'}`;
  }

  function vistaBanco() {
    const b = st.banco;
    const rep = b && b.reporte ? `<div class="msg ${b.reporte.errores.length ? 'aviso' : 'ok'}"><b>${b.reporte.guardadas}</b> preguntas guardadas${b.reporte.errores.length ? `, <b>${b.reporte.errores.length}</b> con error:` : '.'}
      ${b.reporte.errores.length ? `<ul>${b.reporte.errores.slice(0, 40).map(e => `<li>Fila ${e.fila}${e.codigo ? ' (' + esc(e.codigo) + ')' : ''}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}</div>` : '';
    const lista = b && b.lista ? `<div class="scroll"><table class="tabla"><tr><th>ID</th><th>Usuario</th><th>Línea</th><th>Tipo</th><th>Dif.</th><th>Pregunta</th><th></th></tr>
      ${b.lista.map(q => `<tr><td>${esc(q.codigo)}</td><td>${esc(q.perfiles.join(', ') || 'Todos')}</td><td>${esc(q.lineas.join(', ') || 'Todas')}</td><td>${esc(q.tipo)}</td><td>${esc(q.dificultad || '')}</td>
        <td>${esc(q.pregunta)}${q.respuestaModelo ? `<br><small class="sub">Modelo: ${esc(q.respuestaModelo.slice(0, 160))}${q.respuestaModelo.length > 160 ? '…' : ''}</small>` : ''}</td>
        <td><button class="btn chico peligro" data-borrar="${q.id}">Quitar</button></td></tr>`).join('')}</table></div>` : '<p class="vacio">Cargando…</p>';
    return `<div class="ex-card"><h2>Cargar preguntas desde Excel</h2>
      <p class="sub">Columnas: ID, Usuario, Línea de negocio, Dificultad (opcional), Tipo de pregunta, Pregunta y Respuesta modelo. Para varias opciones sepáralas con «;» (Pasante;Ingeniero). Vacío = aplica a todos. Si el ID ya existe se actualiza.</p>
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
        <td>${v.evaluado ? `<input class="sel-chico ${sinCorreo ? 'falta' : ''}" type="email" data-p="correo" data-id="${esc(e.id)}" value="${esc(v.correo)}" placeholder="correo para el examen">` : `<span class="sub">${esc(v.correo)}</span>`}</td></tr>`;
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
      guardarCampos(); pintar();
    });
    q('[data-eval]', c => c.onchange = () => { const id = Number(c.dataset.eval); c.checked ? st.evaluados.add(id) : st.evaluados.delete(id); });
    q('[data-todos]', b => b.onclick = () => {
      const ids = st.d.perfiles.filter(f => f.rol === 'EVALUADO').map(f => f.id);
      if (ids.every(i => st.evaluados.has(i))) st.evaluados.clear(); else ids.forEach(i => st.evaluados.add(i));
      guardarCampos(); pintar();
    });
    const salir = document.getElementById('exSalir'); if (salir) salir.onclick = () => { cerrarSesion(); location.reload(); };

    const gen = document.getElementById('exGenerar');
    if (gen) gen.onclick = () => ejecutar(async () => {
      const r = await rpc({ accion: 'examen_generar', nombre: val('exNombre'), cantidad: Number(val('exCant')), minutos: Number(val('exMin')),
        vigenciaDias: Number(val('exVig')), perfilIds: [...st.evaluados], filtros: { perfiles: st.sel.perfiles, lineas: st.sel.lineas, tipos: st.sel.tipos, dificultades: st.sel.dificultades } });
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
          if (v.evaluador && !g.ador) await rpc({ accion: 'perfil_guardar', rol: 'EVALUADOR', empleadoId: e.id, nombre: e.nombre, correo: v.correo });
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
