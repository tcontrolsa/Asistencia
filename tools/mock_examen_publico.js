// Datos de ejemplo para revisar examen.html en local SIN tocar la base real (solo desarrollo).
// Uso (consola del navegador, con examen.html abierto): primero  sessionStorage.clear(); location.reload();  y luego
//   await (await fetch('/tools/mock_examen_publico.js')).text().then(t => new Function(t)());
// Simula el servidor del examen, la pantalla compartida y un PNG de ejemplo para el material de la pregunta 1.
(async () => {
  const real = window.fetch.bind(window);
  const cv0 = document.createElement('canvas'); cv0.width = 320; cv0.height = 160;
  const g0 = cv0.getContext('2d'); g0.fillStyle = '#0a7'; g0.fillRect(0, 0, 320, 160); g0.fillStyle = '#fff'; g0.font = '26px sans-serif'; g0.fillText('DIAGRAMA UNIFILAR', 24, 90);
  const png = cv0.toDataURL('image/png').split(',')[1];
  const S = { estado: 'ENVIADO', resp: {}, eventos: [], t0: 0, entregado: false };
  const PREG = [
    { n: 1, tipo: 'Técnica', texto: '¿Cuál es la diferencia entre un seccionador y un disyuntor? Explica en qué situaciones usarías cada uno y qué riesgos tiene operar un seccionador con carga.', adjuntos: [{ tipo: 'archivo', id: 101, nombre: 'diagrama_unifilar.png', mime: 'image/png', tamano: 4200 }, { tipo: 'enlace', url: 'https://example.com/video', titulo: 'Video de apoyo' }], archivos: [] },
    { n: 2, tipo: 'Proceso', texto: '¿Qué verificaciones haces antes de energizar un tablero nuevo?', adjuntos: [], archivos: [] },
    { n: 3, tipo: 'Técnica', texto: 'Describe el procedimiento de bloqueo y etiquetado (LOTO) para el mantenimiento de un motor.', adjuntos: [], archivos: [] }];
  const rest = () => S.t0 ? Math.max(0, 2700 - Math.round((Date.now() - S.t0) / 1000)) : 2700;
  window.fetch = async (url, opts) => {
    url = String(url);
    if (url.includes('firestore.googleapis.com')) return new Response(JSON.stringify({ fields: { url: { stringValue: 'http://mock' } } }));
    if (url.startsWith('http://mock/rpc/examen_publico')) {
      const p = JSON.parse(opts.body).p; let b = { ok: true, restante: rest() };
      if (p.accion === 'abrir') b = { ok: true, estado: S.estado, nombre: 'Ana', examen: 'Evaluación de ingreso Q4', minutos: 45, preguntas: 3, exigirPantalla: true, permitirAdjuntos: true, iaPermitida: true, restante: rest() };
      if (p.accion === 'iniciar') { S.estado = 'INICIADO'; S.t0 = S.t0 || Date.now(); b = { ok: true, estado: 'INICIADO', nombre: 'Ana', examen: 'Evaluación de ingreso Q4', minutos: 45, restante: rest(), permitirAdjuntos: true, preguntas: PREG.map(q => ({ ...q, respuesta: S.resp[q.n] || '' })) }; }
      if (p.accion === 'guardar') p.respuestas.forEach(r => { S.resp[r.n] = r.texto; });
      if (p.accion === 'evento') S.eventos.push(...p.eventos);
      if (p.accion === 'archivo_parte') b = { ok: true, nombre: 'diagrama_unifilar.png', mime: 'image/png', partes: 1, datos: png, restante: rest() };
      if (p.accion === 'entregar') { S.entregado = true; b = { ok: true, estado: 'ENTREGADO' }; }
      return new Response(JSON.stringify(b));
    }
    return real(url, opts);
  };
  window.__mockExamen = S;
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d');
  setInterval(() => { g.fillStyle = '#246'; g.fillRect(0, 0, 640, 360); }, 300);
  navigator.mediaDevices.getDisplayMedia = async () => { const s = cv.captureStream(3); s.getVideoTracks()[0].getSettings = () => ({ displaySurface: 'monitor' }); return s; };
  Element.prototype.requestFullscreen = function () { return Promise.resolve(); };
  sessionStorage.setItem('exm_t', 'e'.repeat(64));
  const src = await (await real('/JS/examen_publico.js?x=' + Date.now())).text(); new Function(src)();
})();
