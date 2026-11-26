// Datos de ejemplo para revisar examenes.html en local SIN tocar la base real (solo desarrollo).
// Uso (consola del navegador, con examenes.html abierto y sin sesión):
//   sessionStorage.clear(); location.href = '/examenes.html';   // espera 1,5 s, luego:
//   await (await fetch('/tools/mock_examenes.js')).text().then(t => new Function(t)());
// Reemplaza FirebaseBackend._post y Firestore por versiones en memoria y vuelve a ejecutar el panel.
(async () => {
  sessionStorage.setItem('tcontrol_sesion_eval', JSON.stringify({ token: 'x', exp: Math.floor(Date.now() / 1000) + 36000, empleadoId: '1058', master: true }));
  const cat = { LINEA: ['Baja Tensión', 'Media Tensión', 'Electromecánica', 'Motion y Automation'], PERFIL: ['Pasante', 'Ingeniero', 'Especialista de ingeniería', 'Líder'], TIPO: ['Técnica', 'Proceso', 'Ejercicio', 'Capacitación'], DIFICULTAD: ['Bajo', 'Medio', 'Alto'] };
  const ahora = new Date(), iso = m => new Date(ahora.getTime() - m * 60000).toISOString();
  const S = { calif: { 11: {}, 12: {} }, pendientesIA: 6, iaLlamadas: 0, enviados: false, exElim: new Set(), intElim: new Set() };
  const PREG = [
    { n: 1, codigo: 'P001', tipo: 'Técnica', pregunta: '¿Cuál es la diferencia entre un seccionador y un disyuntor?', respuestaModelo: 'El seccionador solo aísla un circuito sin carga y no interrumpe corriente de falla; el disyuntor sí interrumpe corrientes de carga y de falla.', respuesta: 'El seccionador abre el circuito sin carga para mantenimiento. El disyuntor protege y corta cuando hay sobrecorriente o cortocircuito.', puntosMax: 10, archivos: [] },
    { n: 2, codigo: 'P016', tipo: 'Técnica', pregunta: '¿Qué es la coordinación de protecciones?', respuestaModelo: '', respuesta: 'Que las protecciones se ajusten para que dispare primero la más cercana a la falla.', puntosMax: 5, archivos: [{ id: 5, nombre: 'esquema_unifilar.png', mime: 'image/png', tamano: 184000 }] },
    { n: 3, codigo: 'P069', tipo: 'Proceso', pregunta: '¿Qué debe revisar un pasante al recibir un tablero con PLC antes de las pruebas funcionales?', respuestaModelo: 'Que las direcciones de I/O coincidan con el plano, que los borneros estén marquillados y la fuente del PLC sea la correcta.', respuesta: '', puntosMax: 10, archivos: [] }];
  const intento = (id, nombre, correo, estado, extra) => Object.assign({ id, perfilId: id, nombre, correo, estado, preguntas: 3, respondidas: 0, incidencias: 0, capturas: 0, expiraEn: iso(-10000) }, extra);
  const examenesBase = () => [
    { id: 1, nombre: 'Evaluación de ingreso Q4', cantidad: 3, minutos: 45, exigirPantalla: true, permitirAdjuntos: true, iaPermitida: true, creadoEn: iso(300), filtros: {}, resultadosEnviadoEn: S.enviados ? iso(1) : null, resultadosError: null, intentos: [
      intento(11, 'Ana Prueba', 'ana@tcontrol.com', 'ENTREGADO', { iniciadoEn: iso(200), entregadoEn: iso(160), respondidas: 2, incidencias: 3, capturas: 12, puntos: Object.keys(S.calif[11]).length ? Object.values(S.calif[11]).reduce((a, x) => a + Number(x.puntos), 0) : null, calificadas: Object.keys(S.calif[11]).length, maximo: 25 }),
      intento(12, 'Beto Torres', 'beto@tcontrol.com', 'ENTREGADO', { iniciadoEn: iso(190), entregadoEn: iso(150), respondidas: 3, incidencias: 0, capturas: 9, puntos: null, calificadas: 0, maximo: 25 }),
      intento(13, 'Carla Mena', 'carla@tcontrol.com', 'INICIADO', { iniciadoEn: iso(10), respondidas: 1, incidencias: 1, capturas: 2, maximo: 25 }),
      intento(14, 'Diego Ruiz', 'diego@tcontrol.com', 'ENVIADO', { enviadoEn: iso(250) })] },
    { id: 2, nombre: 'Repaso de protecciones', cantidad: 5, minutos: 30, exigirPantalla: false, permitirAdjuntos: false, iaPermitida: false, creadoEn: iso(2000), filtros: {}, intentos: [
      intento(21, 'Elena Paz', 'elena@tcontrol.com', 'GENERADO', {}), intento(22, 'Felipe Sosa', 'felipe@tcontrol.com', 'GENERADO', {})] }];
  // Exámenes y preguntas extra para probar clasificar, buscar y ordenar con volumen
  const NOMB = ['Examen de media tensión', 'Evaluación de pasantes 2026', 'Automatización básica', 'Protecciones eléctricas', 'Seguridad en tableros', 'Electromecánica avanzada', 'Prueba de ingreso Q3'];
  const GENTE = ['Gabriela Lara', 'Hugo Pérez', 'Irene Castro', 'Javier Mora', 'Karla Núñez', 'Luis Ortiz', 'María Vega', 'Nelson Rojas'];
  const PLAN = [['GENERADO', 'GENERADO', 'GENERADO'], ['ENVIADO', 'ENVIADO', 'INICIADO', 'ENTREGADO'], ['ENTREGADO', 'ENTREGADO', 'ENTREGADO'], ['ENTREGADO', 'ENTREGADO'], ['ENVIADO', 'ENVIADO'], ['ENTREGADO', 'ENTREGADO', 'ENTREGADO', 'ENTREGADO', 'ENTREGADO'], ['ENTREGADO', 'ANULADO']];
  const EXTRA = NOMB.map((nombre, k) => ({ id: 3 + k, nombre, cantidad: 6 + k, minutos: 30 + 5 * k, exigirPantalla: k % 2 === 0, permitirAdjuntos: k % 3 === 0, iaPermitida: k % 2 === 1, creadoEn: iso(3000 + k * 2500), filtros: {}, resultadosEnviadoEn: k === 6 ? iso(9000) : null, resultadosError: null,
    intentos: PLAN[k].map((estado, j) => {
      const base = { id: 100 + k * 10 + j, perfilId: 100 + k * 10 + j, nombre: GENTE[(k + j) % GENTE.length], correo: GENTE[(k + j) % GENTE.length].split(' ')[0].toLowerCase() + '@tcontrol.com', estado, preguntas: 6 + k, respondidas: 0, incidencias: 0, capturas: 0, expiraEn: iso(-10000) };
      if (estado === 'ENTREGADO') { const calif = (k === 2 || k === 5 || k === 6) ? 6 + k : (j % 2 ? 2 : 0); return Object.assign(base, { iniciadoEn: iso(4000), entregadoEn: iso(3950), respondidas: 5 + k, incidencias: j % 3 === 0 ? 2 : 0, capturas: 8, calificadas: calif, puntos: calif ? (6 + k) * 7 - j * 3 : null, maximo: (6 + k) * 10 }); }
      if (estado === 'INICIADO') return Object.assign(base, { iniciadoEn: iso(15), respondidas: 2 });
      return base; }) }));
  const BANCO_EXTRA = Array.from({ length: 26 }, (_, i) => ({ id: 10 + i, codigo: 'P' + String(100 + i * 7).padStart(3, '0'), perfiles: i % 3 === 0 ? ['Pasante'] : i % 3 === 1 ? ['Ingeniero', 'Especialista de ingeniería'] : [], lineas: i % 4 === 0 ? ['Baja Tensión'] : i % 4 === 1 ? ['Media Tensión', 'Baja Tensión'] : i % 4 === 2 ? ['Motion y Automation'] : [],
    tipo: ['Técnica', 'Proceso', 'Ejercicio', 'Capacitación'][i % 4], dificultad: ['Bajo', 'Medio', 'Alto', ''][i % 4], pregunta: ['Explica cómo se dimensiona un conductor para una carga trifásica.', '¿Qué verificaciones haces antes de energizar un tablero nuevo?', 'Describe el procedimiento de bloqueo y etiquetado (LOTO).', '¿Cómo se coordina un disyuntor con un fusible aguas arriba?', 'Diferencia entre un variador de frecuencia y un arrancador suave.'][i % 5] + ' (' + (i + 1) + ')', respuestaModelo: i % 2 ? 'Respuesta modelo de referencia.' : '', adjuntos: i % 5 === 0 ? [{ tipo: 'enlace', url: 'https://example.com', titulo: 'x' }] : [], activa: true, puntos: i % 3 === 0 ? 5 : 10 }));
  const examenes = () => examenesBase().concat(EXTRA).filter(e => !S.exElim.has(e.id)).map(e => ({ ...e, intentos: e.intentos.filter(i => !S.intElim.has(i.id)) }));
  const detalle = id => ({ ok: true, nombre: id === 11 ? 'Ana Prueba' : 'Beto Torres', estado: 'ENTREGADO', iniciadoEn: iso(200), entregadoEn: iso(160), pantallaOk: true,
    puntos: Object.keys(S.calif[id] || {}).length ? Object.values(S.calif[id]).reduce((a, x) => a + Number(x.puntos), 0) : null, maximo: 25,
    eventos: id === 11 ? [{ tipo: 'oculta', detalle: 'Cambió de pestaña o minimizó', segundos: 14, en: iso(190) }, { tipo: 'pegar', detalle: 'Intento de pegar (230 caracteres)', en: iso(185) }, { tipo: 'sale_pantalla_completa', detalle: 'Salió de la pantalla completa', en: iso(180) }] : [],
    capturas: id === 11 ? [{ id: 7, motivo: 'inicio', en: iso(199) }, { id: 8, motivo: 'periodica', en: iso(190) }, { id: 9, motivo: 'regresa', en: iso(175) }] : [],
    preguntas: PREG.map(q => ({ ...q, respuesta: id === 12 ? q.respuesta || 'Revisar el plano y la fuente.' : q.respuesta, calificacion: (S.calif[id] || {})[q.n] ? (S.calif[id] || {})[q.n].puntos : null,
      comentario: (S.calif[id] || {})[q.n] ? (S.calif[id] || {})[q.n].comentario : null, origenCalif: (S.calif[id] || {})[q.n] ? (S.calif[id] || {})[q.n].origen : null })) });

  window.__mock = S;
  window.FirebaseBackend._urlHistorico = undefined;
  window.FirebaseBackend._post = async d => {
    if (d.accion === 'examenCalificarIA') {
      await new Promise(r => setTimeout(r, 900)); S.iaLlamadas++;
      const lote = Math.min(6, S.pendientesIA); S.pendientesIA -= lote;
      [11, 12].forEach(id => PREG.forEach(q => { if (!S.calif[id][q.n] && lote > 0 && q.respuesta !== '') S.calif[id][q.n] = { puntos: Math.round(q.puntosMax * 0.7 * 2) / 2, comentario: 'Cubre lo principal pero falta mencionar la corriente de falla.', origen: 'IA' }; }));
      return { ok: true, guardadas: lote, restantes: S.pendientesIA, errores: [], tokens: lote * 420, modelo: 'claude-haiku-5-5' };
    }
    if (d.accion === 'examenResultados') { await new Promise(r => setTimeout(r, 600)); S.enviados = true; return { ok: true, destinatario: 'sistemas@tcontrolsa.com' }; }
    if (d.accion === 'examenEnviar') return { ok: true, enviados: 2, fallos: 0 };
    const p = JSON.parse(d.p); let body = { ok: true };
    if (d.fn === 'examenes') {
      if (p.accion === 'inicio') body = { ok: true, yo: '1058', master: true, catalogo: cat, perfiles: [{ id: 11, nombre: 'Ana Prueba', correo: 'ana@tcontrol.com', rol: 'EVALUADO', perfil: 'Ingeniero', lineas: ['Baja Tensión'], empleadoId: '2001' }, { id: 12, nombre: 'Beto Torres', correo: 'beto@tcontrol.com', rol: 'EVALUADO', perfil: 'Pasante', lineas: [], empleadoId: '2002' }, { id: 13, nombre: 'Carla Mena', correo: 'carla@tcontrol.com', rol: 'EVALUADO', perfil: 'Ingeniero', lineas: [], empleadoId: null }], preguntas: 3, examenes: examenes() };
      if (p.accion === 'directorio_correos') body = { ok: true, correos: {} };
      if (p.accion === 'banco_listar') body = { ok: true, preguntas: BANCO_EXTRA.concat(PREG.map((q, i) => ({ id: i + 1, codigo: q.codigo, perfiles: [], lineas: [], tipo: q.tipo, dificultad: '', pregunta: q.pregunta, respuestaModelo: q.respuestaModelo, adjuntos: [], activa: true, puntos: q.puntosMax }))) };
      if (p.accion === 'intento_detalle') body = detalle(p.intentoId);
      if (p.accion === 'examen_generar') body = { ok: true, examenId: 3, detalle: [] };
      if (p.accion === 'examen_eliminar') { S.exElim.add(p.examenId); S.eliminado = { examenId: p.examenId }; }
      if (p.accion === 'intento_eliminar') { S.intElim.add(p.intentoId); S.eliminado = { intentoId: p.intentoId }; }
      if (p.accion === 'pregunta_baja' || p.accion === 'perfil_baja') S.eliminado = { [p.accion]: p.id };
    } else if (d.fn === 'examenes_resultados') {
      if (p.accion === 'ia_pendientes') body = { ok: true, items: [], restantes: S.pendientesIA };
      if (p.accion === 'calificar') { p.items.forEach(i => { if (i.puntos === '') delete S.calif[p.intentoId][i.n]; else S.calif[p.intentoId][i.n] = { puntos: i.puntos, comentario: i.comentario, origen: 'MANUAL' }; }); body = { ok: true, guardadas: p.items.length, puntos: Object.values(S.calif[p.intentoId]).reduce((a, x) => a + Number(x.puntos), 0), maximo: 25 }; }
      if (p.accion === 'resultados') body = { ok: true, destinatario: 'sistemas@tcontrolsa.com', resultados: { examen: { id: 1, nombre: 'Evaluación de ingreso Q4' }, hojas: [{ nombre: 'Resumen', filas: [['Evaluado'], ['Ana']] }] } };
    }
    return { status: 200, body };
  };
  Object.defineProperty(firebase, 'firestore', { value: () => ({ collection: () => ({ get: async () => ({ docs: [{ id: '2001', nombre: 'Ana Prueba', cargo: 'Ingeniera de diseño', unidad: 'DISEÑO Y DESARROLLO', area: 'Baja Tensión', foto_url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7c3aed"/><circle cx="5" cy="4" r="2" fill="#ddd6fe"/><rect x="2" y="7" width="6" height="4" rx="3" fill="#ddd6fe"/></svg>') }, { id: '2002', nombre: 'Beto Torres', cargo: 'Pasante', unidad: 'DISEÑO Y DESARROLLO', area: 'Motion' }].map(d => ({ data: () => Object.assign({ id: d.id, activo: 'SI' }, d) })) }) }) }), configurable: true });
  window.confirm = window.__confirmOriginal || window.confirm;
  const src = await (await fetch('/JS/examenes_admin.js?x=' + Date.now())).text(); new Function(src)();
})();
