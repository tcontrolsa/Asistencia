// Plataforma de evaluación técnica · panel del evaluador (fase 1).
// Personas, banco de preguntas (carga desde Excel), generación de exámenes y envío de enlaces por correo.
// Datos: PostgREST api.examenes (db/postgres/019_examenes.sql) por Apps Script (evalRpc) con el token de contraseña
// de Desempeño; el envío de correos lo hace Apps Script (examenes.gs, acción examenEnviar).
(() => {
  const KEY_SESION = 'tcontrol_sesion_eval';
  const app = document.getElementById('exApp');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, d: null, tab: 'examenes', sel: { perfiles: [], lineas: [], tipos: [], dificultades: [] }, evaluados: new Set(), msg: null, banco: null, emps: [] };
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

  // Directorio de empleados (Firestore, solo datos no sensibles) para ligar a cada persona con su ID
  async function cargarEmpleados() {
    try {
      const snap = await firebase.firestore().collection('empleados').get();
      st.emps = snap.docs.map(d => d.data()).filter(e => e && e.id && String(e.activo ?? 'SI').toUpperCase() !== 'NO')
        .map(e => ({ id: String(e.id).trim(), nombre: String(e.nombre || '').trim(), correo: String(e.correo || '').trim().toLowerCase(), area: e.area || '', cargo: e.cargo || '' }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    } catch (e) { st.emps = []; }
  }
  const empPorId = id => st.emps.find(e => e.id === String(id).trim());
  const etiquetaEmp = e => `${e.id} · ${e.nombre}${e.cargo ? ' · ' + e.cargo : ''}`;
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
    const d = st.d, cat = d.catalogo;
    const fila = f => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.correo)}</td><td>${f.empleadoId ? esc(f.empleadoId) : '<span class="sub">Externo</span>'}</td><td>${esc(f.rol === 'EVALUADO' ? f.perfil + (f.lineas.length ? ' · ' + f.lineas.join(', ') : ' · todas') : 'Evaluador')}</td>
      <td>${f.rol === 'EVALUADOR' && !d.master ? '' : `<button class="btn chico peligro" data-baja="${f.id}">Quitar</button>`}</td></tr>`;
    return `<div class="ex-card"><h2>Agregar persona</h2>
      <div class="fila"><label>Rol<select id="pRol"><option value="EVALUADO">Evaluado</option>${d.master ? '<option value="EVALUADOR">Evaluador</option>' : ''}</select></label>
        <label>Nombre<input id="pNombre"></label><label>Correo electrónico<input id="pCorreo" type="email"></label>
        <label>Buscar empleado <span class="sub">(ID o nombre; vacío = candidato externo)</span><input id="pBuscar" list="pEmps" autocomplete="off" placeholder="Ej. 1036 o Hernandez"><datalist id="pEmps">${st.emps.map(e => `<option value="${esc(etiquetaEmp(e))}">`).join('')}</datalist></label>
        <label>ID de empleado<input id="pEmp" inputmode="numeric" readonly placeholder="Se llena al elegir un empleado"></label>
        <label>Perfil<select id="pPerfil">${(cat.PERFIL || []).map(v => `<option>${esc(v)}</option>`).join('')}</select></label></div>
      <div class="sub">Líneas de negocio del evaluado (varias; sin marcar = todas)</div>${chips('lineas_persona', cat.LINEA || [])}
      <button class="btn primario" id="pGuardar">Guardar</button></div>
      <div class="ex-card"><h2>Personas</h2><div class="scroll"><table class="tabla"><tr><th>Nombre</th><th>Correo</th><th>ID</th><th>Perfil</th><th></th></tr>${d.perfiles.map(fila).join('') || ''}</table></div>
      ${d.perfiles.length ? '' : '<p class="vacio">Sin personas todavía.</p>'}</div>
      <div class="ex-card"><h2>Catálogos</h2><p class="sub">Agrega opciones nuevas que luego podrás usar en perfiles, en el Excel y en los filtros.</p>
      <div class="fila"><label>Catálogo<select id="cTipo"><option value="PERFIL">Perfil</option><option value="LINEA">Línea de negocio</option><option value="TIPO">Tipo de pregunta</option><option value="DIFICULTAD">Dificultad</option></select></label>
      <label>Nuevo valor<input id="cValor"></label></div><button class="btn" id="cAgregar">Agregar</button></div>`;
  }

  function pintar() {
    if (!st.d) return;
    st.sel.lineas_persona = st.sel.lineas_persona || [];
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

    const pb = document.getElementById('pBuscar');
    if (pb) pb.oninput = () => {
      const v = pb.value.trim();
      const e = st.emps.find(x => etiquetaEmp(x) === v) || (/^\d+$/.test(v) ? empPorId(v) : null);
      document.getElementById('pEmp').value = e ? e.id : '';
      if (e) {
        document.getElementById('pNombre').value = e.nombre;
        document.getElementById('pCorreo').value = e.correo;
        document.getElementById('pCorreo').placeholder = e.correo ? '' : 'Sin correo en su ficha: escríbelo';
      }
    };
    const pg = document.getElementById('pGuardar');
    if (pg) pg.onclick = () => ejecutar(async () => {
      await rpc({ accion: 'perfil_guardar', rol: val('pRol'), nombre: val('pNombre'), correo: val('pCorreo'), empleadoId: val('pEmp'), perfil: val('pPerfil'), lineas: st.sel.lineas_persona });
      st.sel.lineas_persona = []; aviso('Persona guardada.'); await recargar();
    }, pg);
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
