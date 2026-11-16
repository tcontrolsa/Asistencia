// Módulo EPP: página del despachador (epp_despacho.html)
(() => {
  const D = window.EppDatos;
  const app = document.getElementById('eppApp');
  const KEY_ID = 'EPP_DEMO_DESPACHO';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = iso => new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });

  const ESTADOS = {
    PENDIENTE: ['Pendiente', 'info'], PREPARADA: ['Por retirar', 'ok'], ENTREGADA: ['Sin firma', 'alerta'],
    CONFIRMADA: ['Firmada', 'ok'], RECHAZADA: ['Rechazada', 'error'], CANCELADA: ['Cancelada', 'neutro']
  };
  const FILTROS = { PENDIENTE: 'Pendientes', PREPARADA: 'Por retirar', ENTREGADA: 'Sin firma' };
  const st = {
    vista: 'solicitudes', filtro: 'PENDIENTE', busca: '', soloBajo: false, soloSinFirma: false,
    usuario: (() => { try { return localStorage.getItem(KEY_ID) || 'D02'; } catch (e) { return 'D02'; } })()
  };
  const quien = () => D.colaborador(st.usuario).nombre;

  function aviso(texto, tipo = 'ok') {
    document.querySelectorAll('.epp-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = `epp-toast ${tipo}`;
    t.setAttribute('role', 'status');
    t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }
  async function intentar(fn, exito) {
    try { await fn(); if (exito) aviso(exito); } catch (e) { aviso(e.message || 'No se pudo completar', 'error'); }
    pintar();
  }
  const stockDe = (db, i) => (db.stock[`${i.eppId}|${i.talla}`] || {}).cant || 0;
  const pendientesDe = (db, empleadoId) => db.solicitudes.filter(x => x.empleadoId === empleadoId && x.estado === 'ENTREGADA');

  function tarjeta(db, s) {
    const c = D.colaborador(s.empleadoId), e = ESTADOS[s.estado];
    const sinStock = s.items.some(i => stockDe(db, i) < i.cant);
    const pend = s.estado === 'ENTREGADA' ? D.firmaPendiente(s) : null;
    const otras = s.estado === 'PREPARADA' ? pendientesDe(db, s.empleadoId).length : 0;
    const veces = (s.recordatorios || []).length;
    return `<article class="epp-sol">
      <header><div><b>${esc(c.nombre)}</b><small>${esc(c.area)} · ${esc(c.cargo)}</small></div>
        <span class="epp-chip ${pend && pend.vencida ? 'error' : e[1]}">${e[0]}${pend ? ` · ${pend.dias} d` : ''}</span></header>
      <ul>${s.items.map(i => {
        const hay = stockDe(db, i), ok = hay >= i.cant;
        return `<li class="epp-linea"><span>${i.cant} × ${esc(D.eppDe(i.eppId).nombre)}<small>Talla ${esc(i.talla)} · ${esc(i.motivo)}</small></span>
          ${['PENDIENTE', 'PREPARADA'].includes(s.estado) ? `<span class="epp-chip ${ok ? 'neutro' : 'error'}">${ok ? `Stock ${hay}` : `Falta · hay ${hay}`}</span>` : ''}</li>`;
      }).join('')}</ul>
      ${s.comentario ? `<p class="epp-nota">“${esc(s.comentario)}”</p>` : ''}
      ${s.motivoRechazo ? `<p class="epp-nota error">Motivo: ${esc(s.motivoRechazo)}</p>` : ''}
      ${otras ? `<p class="epp-nota alerta"><i class="fas fa-signature"></i> Tiene ${otras === 1 ? '1 entrega' : `${otras} entregas`} sin firma: se firma${otras === 1 ? '' : 'n'} junto con esta.</p>` : ''}
      ${pend ? `<p class="epp-nota${pend.vencida ? ' error' : ''}">${pend.vencida ? `Pasó el plazo de ${D.DIAS_LIMITE_FIRMA} días: la entrega sigue válida, pide la firma cuando vuelva a bodega.` : 'Puede firmar en su app o aquí.'}${veces ? ` Recordatorios: ${veces}.` : ''}</p>` : ''}
      ${s.tieneFirma ? `<div class="epp-firma-ver"><small>Firmó ${s.firmaOrigen === 'BODEGA' ? 'en bodega' : 'en su app'} · ${fecha(s.confirmadaEn)}</small><button class="epp-btn mini" data-a="verFirma" data-id="${esc(s.id)}">Ver firma</button></div>` : ''}
      <footer>
        <small>${esc(s.id)} · ${fecha(s.creada)}${s.entregadaEn ? ` · Entregada ${fecha(s.entregadaEn)}` : ''}</small>
        <div class="epp-acciones">
          ${['PENDIENTE', 'PREPARADA'].includes(s.estado) ? `<button class="epp-btn" data-a="rechazar" data-id="${esc(s.id)}">Rechazar</button>` : ''}
          ${s.estado === 'PENDIENTE' ? `<button class="epp-btn primario" data-a="preparar" data-id="${esc(s.id)}"><i class="fas fa-box-open"></i> Preparar</button>` : ''}
          ${s.estado === 'PREPARADA' ? `<button class="epp-btn primario" data-a="entregar" data-id="${esc(s.id)}" ${sinStock ? 'disabled title="Falta stock para entregar"' : ''}><i class="fas fa-hand-holding"></i> Entregar</button>` : ''}
          ${s.estado === 'ENTREGADA' ? `<button class="epp-btn" data-a="recordar" data-id="${esc(s.id)}"><i class="fas fa-bell"></i> Recordar</button><button class="epp-btn primario" data-a="firmarAqui" data-id="${esc(s.id)}"><i class="fas fa-signature"></i> Firmar aquí</button>` : ''}
        </div>
      </footer>
    </article>`;
  }

  function vistaSolicitudes(db, cuenta) {
    const lista = db.solicitudes.filter(s => s.estado === st.filtro).sort((a, b) => a.creada.localeCompare(b.creada));
    return `<div class="epp-filtros" role="group" aria-label="Filtrar solicitudes">${Object.entries(FILTROS).map(([k, t]) =>
      `<button class="${st.filtro === k ? 'activo' : ''}" data-a="filtro" data-f="${k}" aria-pressed="${st.filtro === k}">${t} <em>${cuenta[k] || 0}</em></button>`).join('')}</div>
      ${lista.length ? `<div class="epp-rejilla">${lista.map(s => tarjeta(db, s)).join('')}</div>`
        : `<div class="epp-vacio"><i class="fas fa-circle-check"></i><b>Nada en ${esc(FILTROS[st.filtro].toLowerCase())}</b></div>`}`;
  }

  function vistaInventario(db) {
    const q = st.busca.trim().toLowerCase();
    const filas = [];
    D.CATALOGO.forEach(e => e.tallas.forEach(t => {
      const clave = `${e.id}|${t}`, s = db.stock[clave] || { cant: 0, min: 0 };
      const bajo = s.cant <= s.min;
      if (st.soloBajo && !bajo) return;
      if (q && !`${e.nombre} ${e.categoria} ${t}`.toLowerCase().includes(q)) return;
      filas.push(`<tr>
        <td data-l="Artículo"><span class="epp-ico mini"><i class="fas ${e.icono}"></i></span><span><b>${esc(e.nombre)}</b><small>${esc(e.categoria)}</small></span></td>
        <td data-l="Talla">${esc(t)}</td>
        <td data-l="Stock" class="num">${s.cant}</td>
        <td data-l="Mínimo" class="num">${s.min}</td>
        <td data-l="Estado"><span class="epp-chip ${s.cant === 0 ? 'error' : bajo ? 'alerta' : 'ok'}">${s.cant === 0 ? 'Agotado' : bajo ? 'Stock bajo' : 'Disponible'}</span></td>
        <td class="fin"><button class="epp-btn mini" data-a="ingreso" data-c="${esc(clave)}"><i class="fas fa-plus"></i> Ingreso</button></td>
      </tr>`);
    }));
    return `<div class="epp-herr">
        <label class="epp-busca"><i class="fas fa-search"></i><input id="eppBusca" type="search" placeholder="Buscar artículo o talla" aria-label="Buscar en inventario" value="${esc(st.busca)}"></label>
        <label class="epp-check"><input id="eppBajo" type="checkbox" ${st.soloBajo ? 'checked' : ''}> Solo stock bajo</label>
      </div>
      ${filas.length ? `<div class="epp-tabla-caja"><table class="epp-tabla"><thead><tr><th>Artículo</th><th>Talla</th><th class="num">Stock</th><th class="num">Mínimo</th><th>Estado</th><th></th></tr></thead><tbody>${filas.join('')}</tbody></table></div>`
        : '<div class="epp-vacio"><i class="fas fa-box"></i><b>Sin resultados</b></div>'}`;
  }

  function vistaEntregas(db) {
    const q = st.busca.trim().toLowerCase();
    const lista = db.solicitudes.filter(s => (st.soloSinFirma ? ['ENTREGADA'] : ['ENTREGADA', 'CONFIRMADA']).includes(s.estado))
      .filter(s => !q || `${D.colaborador(s.empleadoId).nombre} ${s.id} ${s.items.map(i => D.eppDe(i.eppId).nombre).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.entregadaEn.localeCompare(a.entregadaEn));
    return `<div class="epp-herr"><label class="epp-busca"><i class="fas fa-search"></i><input id="eppBusca" type="search" placeholder="Buscar colaborador, EPP o número" aria-label="Buscar entregas" value="${esc(st.busca)}"></label>
        <label class="epp-check"><input id="eppSinFirma" type="checkbox" ${st.soloSinFirma ? 'checked' : ''}> Solo sin firma</label></div>
      ${lista.length ? `<div class="epp-rejilla">${lista.map(s => tarjeta(db, s)).join('')}</div>` : '<div class="epp-vacio"><i class="fas fa-clipboard-check"></i><b>Sin entregas</b></div>'}`;
  }

  const barraDemo = () => !D.demo ? '' : `<div class="epp-demo"><i class="fas fa-flask"></i> Demostración
      <select id="eppQuien" aria-label="Entrar como">${D.COLABORADORES.map(c => `<option value="${c.id}" ${c.id === st.usuario ? 'selected' : ''}>${esc(c.nombre)} · ${esc(c.cargo)}</option>`).join('')}</select>
      <button data-a="reiniciar">Reiniciar datos</button>
    </div>`;

  async function pintar() {
    if (!D.esBodega(D.colaborador(st.usuario))) {
      app.innerHTML = `${barraDemo()}<div class="epp-vacio"><i class="fas fa-lock"></i><b>Solo para el personal de bodega</b><span>Tu puesto no tiene acceso al despacho de EPP.</span>${D.demo ? '' : '<button class="epp-btn" data-a="salir">Salir</button>'}</div>`;
      return;
    }
    const activo = document.activeElement?.id;
    const pos = document.activeElement?.selectionStart;
    const db = await D.datos();
    const cuenta = {};
    db.solicitudes.forEach(s => { cuenta[s.estado] = (cuenta[s.estado] || 0) + 1; });
    const bajos = Object.values(db.stock).filter(s => s.cant <= s.min).length;
    const vencidas = db.solicitudes.filter(s => s.estado === 'ENTREGADA' && D.firmaPendiente(s).vencida).length;
    const kpi = (n, t, v, f, alerta) => `<button class="epp-kpi${alerta && n ? ' alerta' : ''}" data-a="vista" data-v="${v}" ${f ? `data-f="${f}"` : ''}><b>${n}</b><span>${t}</span></button>`;
    const tab = (v, ico, t) => `<button class="${st.vista === v ? 'activo' : ''}" data-a="vista" data-v="${v}" ${st.vista === v ? 'aria-current="page"' : ''}><i class="fas ${ico}"></i><span>${t}</span></button>`;
    const cuerpo = st.vista === 'solicitudes' ? vistaSolicitudes(db, cuenta) : st.vista === 'inventario' ? vistaInventario(db) : vistaEntregas(db);
    app.innerHTML = `
      ${barraDemo()}
      <header class="epp-top">
        <div class="epp-marca"><span class="epp-ico"><i class="fas fa-hard-hat"></i></span><div><b>Despacho de EPP</b><small>${esc(quien())}</small></div>${D.demo ? '' : '<button class="epp-salir" data-a="salir" aria-label="Salir"><i class="fas fa-right-from-bracket"></i></button>'}</div>
        <div class="epp-kpis">
          ${kpi(cuenta.PENDIENTE || 0, 'Pendientes', 'solicitudes', 'PENDIENTE', true)}
          ${kpi(cuenta.PREPARADA || 0, 'Por retirar', 'solicitudes', 'PREPARADA')}
          ${kpi(cuenta.ENTREGADA || 0, vencidas ? `Sin firma (${vencidas} fuera de plazo)` : 'Sin firma', 'solicitudes', 'ENTREGADA', vencidas > 0)}
          ${kpi(bajos, 'Stock bajo', 'inventario', '', true)}
        </div>
      </header>
      <nav class="epp-tabs" aria-label="Secciones">${tab('solicitudes', 'fa-clipboard-list', 'Solicitudes')}${tab('inventario', 'fa-boxes-stacked', 'Inventario')}${tab('entregas', 'fa-clipboard-check', 'Entregas')}</nav>
      <main class="epp-main ancho">${cuerpo}</main>`;
    if (activo === 'eppBusca') {
      const b = document.getElementById('eppBusca');
      if (b) { b.focus(); b.setSelectionRange(pos, pos); }
    }
  }

  // alEnviar(form, valor) corre al pulsar un botón del formulario, sin depender del evento close
  function dialogo(html, alEnviar, validar) {
    document.getElementById('eppDlg')?.remove();
    const d = document.createElement('dialog');
    d.id = 'eppDlg';
    d.className = 'epp-dlg';
    d.innerHTML = html;
    document.body.appendChild(d);
    const f = d.querySelector('form');
    f.addEventListener('submit', ev => {
      ev.preventDefault();
      const valor = ev.submitter ? ev.submitter.value : '';
      if (validar && !validar(f, valor)) return;
      d.close();
      d.remove();
      alEnviar(f, valor);
    });
    d.addEventListener('close', () => d.remove());
    d.showModal();
    return d;
  }

  // Firma en la pantalla del despachador: al retirar, o de entregas que quedaron pendientes.
  // conSinFirma deja entregar igual si la persona no puede firmar en ese momento.
  function ventanaFirma({ titulo, c, lineas, conSinFirma, alFirmar, alSinFirma }) {
    let firma;
    const d = dialogo(`<form method="dialog">
      <h2>${esc(titulo)}</h2>
      <p>${esc(c.nombre)}</p>
      <ul class="epp-resumen">${lineas.map(l => `<li><span>${l}</span></li>`).join('')}</ul>
      <p class="epp-legal">Recibí estos EPP en buen estado.</p>
      <div class="epp-firma"><canvas aria-label="Recuadro de firma del colaborador"></canvas><button type="button" class="epp-btn mini" data-limpiar>Borrar</button></div>
      <p class="epp-error" hidden>Pide al colaborador firmar en el recuadro.</p>
      <div class="epp-acciones">
        <button class="epp-btn" value="no" formnovalidate>Volver</button>
        ${conSinFirma ? '<button class="epp-btn" value="sinfirma" formnovalidate>Entregar sin firma</button>' : ''}
        <button class="epp-btn primario" value="si">${conSinFirma ? 'Entregar con firma' : 'Guardar firma'}</button>
      </div></form>`, (f, valor) => {
      if (valor === 'si') alFirmar(firma.imagen());
      if (valor === 'sinfirma') alSinFirma();
    }, (f, valor) => {
      if (valor !== 'si' || !firma.vacia()) return true;
      f.querySelector('.epp-error').hidden = false;
      return false;
    });
    firma = window.EppFirma.montar(d.querySelector('canvas'));
    d.querySelector('[data-limpiar]').addEventListener('click', () => firma.limpiar());
  }

  const lineasDe = (s, extra = '') => s.items.map(i => `${i.cant} × ${esc(D.eppDe(i.eppId).nombre)}<small>Talla ${esc(i.talla)}${extra}</small>`);

  async function entregar(id) {
    const db = await D.datos(), s = db.solicitudes.find(x => x.id === id);
    if (!s) return;
    const previas = pendientesDe(db, s.empleadoId);
    ventanaFirma({
      titulo: `Entregar ${id}`, c: D.colaborador(s.empleadoId), conSinFirma: true,
      lineas: [...lineasDe(s), ...previas.flatMap(p => lineasDe(p, ` · Pendiente del ${fecha(p.entregadaEn)}`))],
      alFirmar: firma => intentar(() => D.entregar(id, quien(), firma, previas.map(p => p.id)), 'Entrega firmada'),
      alSinFirma: () => intentar(() => D.entregar(id, quien()), 'Entregada sin firma: queda en seguimiento')
    });
  }

  async function firmarAqui(id) {
    const db = await D.datos(), s = db.solicitudes.find(x => x.id === id);
    if (!s) return;
    const todas = pendientesDe(db, s.empleadoId);
    ventanaFirma({
      titulo: todas.length > 1 ? 'Firmar entregas pendientes' : `Firmar ${id}`, c: D.colaborador(s.empleadoId),
      lineas: todas.flatMap(p => lineasDe(p, ` · Entregado ${fecha(p.entregadaEn)}`)),
      alFirmar: firma => intentar(() => D.firmarEnBodega(todas.map(p => p.id), firma), 'Firma guardada')
    });
  }

  async function verFirma(id) {
    try {
      const firma = await D.verFirma(id);
      if (!String(firma || '').startsWith('data:image/png')) throw new Error('No se encontró la firma');
      dialogo(`<form method="dialog"><h2>Firma de ${esc(id)}</h2><img class="epp-firma-img" src="${firma}" alt="Firma">
        <div class="epp-acciones"><button class="epp-btn" value="no">Cerrar</button></div></form>`, () => { });
    } catch (e) { aviso(e.message, 'error'); }
  }

  function rechazar(id) {
    dialogo(`<form method="dialog"><h2>Rechazar ${esc(id)}</h2>
      <label>Motivo (lo verá el colaborador)<textarea name="motivo" maxlength="300" rows="3" required></textarea></label>
      <div class="epp-acciones"><button class="epp-btn" value="no" formnovalidate>Volver</button><button class="epp-btn peligro" value="si">Rechazar</button></div></form>`, (f, valor) => {
      if (valor === 'si') intentar(() => D.rechazar(id, quien(), f.motivo.value), 'Solicitud rechazada');
    });
  }

  function ingreso(clave) {
    const [id, talla] = clave.split('|');
    dialogo(`<form method="dialog"><h2>Ingreso de stock</h2><p>${esc(D.eppDe(id).nombre)} · Talla ${esc(talla)}</p>
      <label>Cantidad recibida<input name="cant" type="number" min="1" max="9999" inputmode="numeric" required></label>
      <div class="epp-acciones"><button class="epp-btn" value="no" formnovalidate>Volver</button><button class="epp-btn primario" value="si">Registrar</button></div></form>`, (f, valor) => {
      if (valor === 'si') intentar(() => D.ingresarStock(clave, f.cant.value, quien()), 'Ingreso registrado');
    });
  }

  app.addEventListener('click', ev => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, v, f, id, c } = b.dataset;
    if (a === 'vista') { if (v !== st.vista) st.busca = ''; st.vista = v; if (f) st.filtro = f; pintar(); }
    if (a === 'filtro') { st.filtro = f; pintar(); }
    if (a === 'preparar') intentar(() => D.preparar(id, quien()), 'Lista para retirar');
    if (a === 'entregar') entregar(id);
    if (a === 'firmarAqui') firmarAqui(id);
    if (a === 'verFirma') verFirma(id);
    if (a === 'salir') D.salir();
    if (a === 'recordar') intentar(() => D.recordar(id), 'Recordatorio anotado');
    if (a === 'rechazar') rechazar(id);
    if (a === 'ingreso') ingreso(c);
    if (a === 'reiniciar' && confirm('¿Volver a los datos iniciales de la demostración?')) { D.reiniciar(); pintar(); }
  });
  app.addEventListener('input', ev => { if (ev.target.id === 'eppBusca') { st.busca = ev.target.value; pintar(); } });
  app.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'eppBajo') st.soloBajo = t.checked;
    if (t.id === 'eppSinFirma') st.soloSinFirma = t.checked;
    if (t.id === 'eppQuien') { st.usuario = t.value; try { localStorage.setItem(KEY_ID, t.value); } catch (e) { } }
    if (['eppBajo', 'eppSinFirma', 'eppQuien'].includes(t.id)) pintar();
  });
  D.iniciar(app, 'despacho').then(yo => {
    if (yo) st.usuario = yo.id;
    D.alCambiar(pintar);
    pintar();
  }).catch(e => console.warn('EPP:', e));
})();
