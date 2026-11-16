// Módulo EPP: recuadro de firma en pantalla (dedo, lápiz o mouse)
window.EppFirma = {
  montar(canvas) {
    const ctx = canvas.getContext('2d');
    let dibujando = false, ultimo = null, tinta = 0;

    function ajustar() {
      const r = canvas.getBoundingClientRect(), k = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * k);
      canvas.height = Math.round(r.height * k);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      tinta = 0;
    }
    const punto = ev => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { }
      dibujando = true;
      ultimo = punto(ev);
    });
    canvas.addEventListener('pointermove', ev => {
      if (!dibujando) return;
      const p = punto(ev);
      ctx.beginPath();
      ctx.moveTo(ultimo.x, ultimo.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      tinta += Math.hypot(p.x - ultimo.x, p.y - ultimo.y);
      ultimo = p;
    });
    ['pointerup', 'pointercancel'].forEach(t => canvas.addEventListener(t, () => { dibujando = false; }));
    ajustar();

    return {
      // Un toque o un punto no cuentan como firma
      vacia: () => tinta < 40,
      limpiar: ajustar,
      // Copia reducida: la firma viaja a la base y el respaldo de red limita el tamaño
      imagen() {
        const ancho = Math.min(360, canvas.width);
        const copia = document.createElement('canvas');
        copia.width = ancho;
        copia.height = Math.round(canvas.height * ancho / canvas.width);
        copia.getContext('2d').drawImage(canvas, 0, 0, copia.width, copia.height);
        return copia.toDataURL('image/png');
      }
    };
  }
};
