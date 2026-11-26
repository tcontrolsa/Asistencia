/**
 * TCONTROL · Horas extra por confirmar (panel) · 2026-11-25
 *
 * Cuando el colaborador no registró su salida y la completó el sistema (AUTO_COMPLETAR), las horas extra de
 * ese día quedan POR CONFIRMAR: no cuentan hasta que un supervisor las acepta. Aquí se confirman:
 *   - un día, con el botón «Confirmar» del historial de la persona;
 *   - varias a la vez, con la ventana «Horas extra por confirmar» (Reportes o la ficha de la persona).
 * Confirmar escribe en la SALIDA del día autoriza = "SUPERVISOR: nombre" y horasExtra = SI. No cambia la hora:
 * si no es correcta, se corrige antes en Gestionar jornada. Solo Administrador y Supervisor Administrador.
 */
(function () {
  'use strict';

  const st = { periodo: 0, soloId: '', filas: [], marcadas: new Set(), guardando: false, buscar: '' };
  const esc = v => escapeHtml(String(v === null || v === undefined ? '' : v));
  const hm = m => formatearHorasHM(m || 0);
  const clave = f => `${f.id}|${f.fecha}`;

  function nombreSupervisor() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
    return 'SUPERVISOR: ' + (s.nombre || 'Panel');
  }

  function fichas() {
    const vistos = new Set();
    return [...empCache, ...(window._cacheDesvinculados || []), ...(window.empEliminadosCache || [])].filter(e => {
      const id = String((e && e.id) || '').trim();
      if (!id || vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
  }
  const fichaDe = id => fichas().find(e => String(e.id).trim() === String(id).trim());

  // Días por confirmar de una persona en el rango, con lo que sumaría confirmarlos
  function pendientesDe(e, ini, fin) {
    const porFecha = {};
    (e.registros || []).forEach(r => {
      if (r.fecha >= ini && r.fecha <= fin) (porFecha[r.fecha] = porFecha[r.fecha] || []).push(r);
    });
    const out = [];
    Object.keys(porFecha).sort().forEach(fecha => {
      const { regs, periodos } = periodosDeRegistros(porFecha[fecha]);
      const salidas = salidasPorConfirmarDia(e, periodos, regs, esFinDeSemanaOFeriado(fecha));
      if (!salidas.length) return;
      const salida = salidas[salidas.length - 1];
      const antes = calcularExtrasDia(e, fecha, regs);
      const despues = calcularExtrasDia(e, fecha, regs.map(r => r === salida ? { ...r, horasExtra: 'SI', autoriza: 'SUPERVISOR: X' } : r));
      const entrada = (periodos.find(p => p.salida === salida) || {}).entrada || {};
      const horaS = formatearHora24(salida.hora || salida.timestamp);
      out.push({
        id: String(e.id).trim(), nombre: e.nombre || '', area: e.area || '', fecha, salida,
        horaE: formatearHora24(entrada.hora || entrada.timestamp), horaS,
        campo: entrada.modo === 'CAMPO' || salida.modo === 'CAMPO',
        // 15:15 y 16:15 son las horas que pone el sistema solo; otra hora la puso un supervisor o la regularización
        deSistema: horaS === '15:15' || horaS === '16:15',
        m50: despues.h50 + despues.hC50 - antes.h50 - antes.hC50,
        m100: despues.h100 + despues.hC100 - antes.h100 - antes.hC100
      });
    });
    return out;
  }

  function rango(n) {
    let p = ReglasJornada.periodoDe();
    for (let i = 0; i < n; i++) {
      const d = new Date(p.inicio + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      p = ReglasJornada.periodoDe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return p;
  }
  const dmy = f => f.split('-').reverse().join('/');

  function calcular() {
    const p = rango(st.periodo);
    const lista = st.soloId ? [fichaDe(st.soloId)].filter(Boolean) : fichas();
    st.filas = lista.flatMap(e => pendientesDe(e, p.inicio, p.fin))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
  }

  // ---------------------------------------------------------------- guardado
  // datos: { horasExtra, autoriza } que se escriben en la SALIDA del día
  async function guardarFila(f, autoriza, horasExtra) {
    const res = await window.FirebaseBackend.actualizarRegistroGeneral({
      docId: f.salida.id || '', empleadoId: f.id, tipo: f.salida.tipo, fecha: f.fecha,
      campo: 'autoriza', valor: autoriza, horasExtra
    });
    if (!res || res.error || res.ok === false) throw new Error((res && (res.error || res.mensaje)) || 'el servidor no respondió');
    f.salida.autoriza = autoriza;
    f.salida.horasExtra = horasExtra;
  }

  function refrescar() {
    if (typeof limpiarCachesLocales === 'function') limpiarCachesLocales();
    if (panelActual === 'detalle' && window.idDetalleActual) {
      mostrarDetalle(window.idDetalleActual, window.indexPeriodoDetalleActual || 0, window.customInicioDetalleActual, window.customFinDetalleActual);
    }
    cargarDatosCompletos(true, true);
  }

  async function guardarVarias(filas, alAvanzar) {
    const autoriza = nombreSupervisor();
    const fallidas = [];
    const cola = [...filas];
    let hechas = 0, seguidas = 0;
    const obrero = async () => {
      while (cola.length) {
        const f = cola.shift();
        if (seguidas >= 4) { fallidas.push([f, 'no se intentó: el servidor no responde']); continue; }
        try {
          await guardarFila(f, autoriza, 'SI');
          seguidas = 0;
          hechas++;
        } catch (err) {
          seguidas++;
          fallidas.push([f, (err && err.message) || String(err)]);
        }
        if (alAvanzar) alAvanzar(hechas, fallidas.length);
      }
    };
    await seguirGuardado(Promise.all([obrero(), obrero(), obrero()]));
    return { hechas, fallidas };
  }

  async function confirmarFilas(filas) {
    if (st.guardando || !filas.length) return;
    st.guardando = true;
    pintar();
    const { hechas, fallidas } = await guardarVarias(filas, (h, x) => {
      const b = document.getElementById('exConfirmar');
      if (b) b.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Guardando ${h + x} de ${filas.length}…`;
    });
    st.guardando = false;
    st.marcadas.clear();
    if (fallidas.length) {
      avisoGuardadoFallido(`Horas extra: ${fallidas.length} sin confirmar`,
        fallidas.slice(0, 6).map(([f, m]) => `${f.nombre} ${dmy(f.fecha)}: ${m}`).join(' · '),
        () => confirmarFilas(fallidas.map(x => x[0])));
    }
    if (hechas) mostrarToast(`✅ ${hechas} ${hechas === 1 ? 'día confirmado' : 'días confirmados'}: sus horas extra ya cuentan`, 'success');
    refrescar();
    if (document.getElementById('exModal')) { calcular(); pintar(); }
  }

  function permitido() {
    if (tienePermisoAdmin()) return true;
    mostrarToast('Solo Administradores y Supervisores Admin pueden confirmar horas extra.', 'error');
    return false;
  }

  window.confirmarExtrasDia = async function (id, fecha) {
    if (!permitido() || st.guardando) return;
    const e = fichaDe(id);
    const f = e && pendientesDe(e, fecha, fecha)[0];
    if (!f) { mostrarToast('Ese día ya no tiene horas extra por confirmar.', 'info'); return; }
    const suma = [f.m50 ? `${hm(f.m50)} h al 50 %` : '', f.m100 ? `${hm(f.m100)} h al 100 %` : ''].filter(Boolean).join(' y ') || 'sin horas que sumar';
    if (!confirm(`¿Confirmar las horas extra de ${f.nombre} del ${dmy(fecha)}?\n\nEntrada ${f.horaE} · Salida ${f.horaS}${f.deSistema ? ' (la puso el sistema)' : ''}\nSe cuentan: ${suma}.`)) return;
    await confirmarFilas([f]);
  };

  window.quitarConfirmacionExtras = async function (id, fecha) {
    if (!permitido() || st.guardando) return;
    const e = fichaDe(id);
    // Solo la confirmación de salidas que completó el sistema; una autorización de extras hecha aparte se mantiene
    const regs = ((e && e.registros) || []).filter(r => r.fecha === fecha && esSalidaSinRegistrar(r)
      && String(r.autoriza || '').toUpperCase().startsWith('SUPERVISOR:'));
    if (!regs.length) return;
    if (!confirm(`¿Quitar la confirmación de horas extra de ${e.nombre} del ${dmy(fecha)}?\n\nVolverán a quedar POR CONFIRMAR y no contarán.`)) return;
    const tareas = regs.map(r => [`${e.nombre} ${dmy(fecha)}`, () => guardarFila({ id: String(e.id).trim(), fecha, salida: r }, 'SISTEMA (>45 MIN)', 'NO')]);
    const ok = await ejecutarGuardado('Quitar confirmación', tareas, () => cargarDatosCompletos(true, true));
    if (ok) refrescar();
  };

  // Botón de la ficha: solo si la persona tiene días por confirmar en el rango que se está viendo
  window.botonExtrasPorConfirmarHtml = function (e, ini, fin) {
    if (!tienePermisoAdmin()) return '';
    const n = pendientesDe(e, ini, fin).length;
    if (!n) return '';
    return `<button type="button" class="btn btn-extras-pend" onclick="abrirExtrasPorConfirmar('${esc(e.id)}', '${ini}')"><i class="fas fa-hourglass-half"></i> Extras por confirmar (${n})</button>`;
  };

  // ---------------------------------------------------------------- ventana
  window.abrirExtrasPorConfirmar = function (id, ini) {
    if (!permitido()) return;
    st.soloId = id ? String(id).trim() : '';
    st.periodo = 0;
    if (ini) { for (let i = 0; i < 12; i++) if (rango(i).inicio <= ini) { st.periodo = i; break; } }
    st.buscar = '';
    st.marcadas.clear();
    calcular();
    st.filas.forEach(f => st.marcadas.add(clave(f)));
    let m = document.getElementById('exModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'exModal';
      m.className = 'ex-fondo';
      document.body.appendChild(m);
    }
    pintar();
  };
  function cerrar() {
    if (st.guardando) { mostrarToast('Espera a que termine de guardar.', 'info'); return; }
    const m = document.getElementById('exModal');
    if (m) m.remove();
  }

  const visibles = () => {
    const q = st.buscar.trim().toLowerCase();
    return q ? st.filas.filter(f => `${f.nombre} ${f.id} ${f.area}`.toLowerCase().includes(q)) : st.filas;
  };
  const elegidas = () => st.filas.filter(f => st.marcadas.has(clave(f)));

  function pintarPie() {
    const sel = elegidas();
    const t50 = sel.reduce((t, f) => t + f.m50, 0), t100 = sel.reduce((t, f) => t + f.m100, 0);
    const pie = document.getElementById('exPie');
    if (!pie) return;
    pie.innerHTML = `
      <div class="ex-resumen">${sel.length} de ${st.filas.length} · 50 %: <b>${hm(t50)}</b> · 100 %: <b>${hm(t100)}</b></div>
      <button type="button" class="ex-btn" data-ex="cerrar" ${st.guardando ? 'disabled' : ''}>Cerrar</button>
      <button type="button" class="ex-btn ex-btn-ok" id="exConfirmar" data-ex="confirmar" ${!sel.length || st.guardando ? 'disabled' : ''}>
        ${st.guardando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : `<i class="fas fa-check-double"></i> Confirmar ${sel.length === st.filas.length ? 'todas' : 'seleccionadas'} (${sel.length})`}</button>`;
  }

  function pintarTabla() {
    const cont = document.getElementById('exTabla');
    if (!cont) return;
    const vis = visibles();
    if (!vis.length) {
      cont.innerHTML = `<div class="ex-vacio"><i class="fas fa-check-circle"></i> ${st.filas.length ? 'Nadie coincide con la búsqueda.' : 'No hay horas extra por confirmar en este período.'}</div>`;
      return;
    }
    const todas = vis.every(f => st.marcadas.has(clave(f)));
    cont.innerHTML = `<table class="ex-tabla">
      <thead><tr><th><input type="checkbox" data-ex-todas ${todas ? 'checked' : ''} aria-label="Seleccionar todas"></th>
        <th>Colaborador</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>50 %</th><th>100 %</th></tr></thead>
      <tbody>${vis.map(f => `<tr>
        <td><input type="checkbox" data-ex-fila="${esc(clave(f))}" ${st.marcadas.has(clave(f)) ? 'checked' : ''} aria-label="Seleccionar"></td>
        <td><b>${esc(f.nombre)}</b><span>${esc(f.id)}${f.area ? ' · ' + esc(f.area) : ''}</span></td>
        <td>${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][new Date(f.fecha + 'T12:00:00').getDay()]} ${dmy(f.fecha).slice(0, 5)}</td>
        <td>${esc(f.horaE)}${f.campo ? '<span>Campo</span>' : ''}</td>
        <td><b>${esc(f.horaS)}</b><span class="${f.deSistema ? 'ex-sis' : 'ex-corr'}">${f.deSistema ? 'hora del sistema' : 'hora corregida'}</span></td>
        <td>${f.m50 ? hm(f.m50) : '—'}</td><td>${f.m100 ? hm(f.m100) : '—'}</td></tr>`).join('')}</tbody></table>`;
  }

  function pintar() {
    const m = document.getElementById('exModal');
    if (!m) return;
    const e = st.soloId ? fichaDe(st.soloId) : null;
    m.innerHTML = `<div class="ex-caja" role="dialog" aria-modal="true" aria-label="Horas extra por confirmar">
      <div class="ex-cab"><div><h3><i class="fas fa-hourglass-half"></i> Horas extra por confirmar</h3>
        <p>${e ? `<b>${esc(e.nombre)}</b> · ` : ''}No registraron la salida y la completó el sistema: no cuentan hasta que las confirmes. Si la hora no es correcta, corrígela antes en Gestionar jornada.</p></div>
        <button type="button" class="ex-x" data-ex="cerrar" aria-label="Cerrar"><i class="fas fa-times"></i></button></div>
      <div class="ex-filtros">
        <select data-ex-periodo ${st.guardando ? 'disabled' : ''}>${Array.from({ length: Math.max(2, st.periodo + 1) }, (_, i) => i).map(i => { const p = rango(i); return `<option value="${i}" ${i === st.periodo ? 'selected' : ''}>${dmy(p.inicio)} – ${dmy(p.fin)}</option>`; }).join('')}</select>
        ${e ? '' : `<input type="text" data-ex-buscar placeholder="Buscar por nombre, ID o área" value="${esc(st.buscar)}">`}
      </div>
      <div class="ex-cuerpo" id="exTabla"></div>
      <div class="ex-pie" id="exPie"></div></div>`;
    pintarTabla();
    pintarPie();
  }

  document.addEventListener('click', ev => {
    if (ev.target.id === 'exModal') { cerrar(); return; }
    const b = ev.target.closest && ev.target.closest('#exModal [data-ex]');
    if (!b) return;
    if (b.dataset.ex === 'cerrar') { cerrar(); return; }
    const sel = elegidas();
    const t50 = sel.reduce((t, f) => t + f.m50, 0), t100 = sel.reduce((t, f) => t + f.m100, 0);
    if (sel.length && confirm(`¿Confirmar ${sel.length} ${sel.length === 1 ? 'día' : 'días'} de horas extra?\n\n50 %: ${hm(t50)} h · 100 %: ${hm(t100)} h\n\nEmpezarán a contar en los reportes y en la app de cada colaborador.`)) confirmarFilas(sel);
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (!t.closest || !t.closest('#exModal')) return;
    if (st.guardando) { pintarTabla(); return; }
    if (t.hasAttribute('data-ex-periodo')) {
      st.periodo = Number(t.value);
      st.marcadas.clear();
      calcular();
      st.filas.forEach(f => st.marcadas.add(clave(f)));
      pintar();
    } else if (t.hasAttribute('data-ex-todas')) {
      visibles().forEach(f => t.checked ? st.marcadas.add(clave(f)) : st.marcadas.delete(clave(f)));
      pintarTabla();
      pintarPie();
    } else if (t.dataset.exFila) {
      if (t.checked) st.marcadas.add(t.dataset.exFila); else st.marcadas.delete(t.dataset.exFila);
      const cab = document.querySelector('#exModal [data-ex-todas]');
      if (cab) cab.checked = visibles().every(f => st.marcadas.has(clave(f)));
      pintarPie();
    }
  });
  document.addEventListener('input', ev => {
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-ex-buscar')) { st.buscar = ev.target.value; pintarTabla(); }
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.getElementById('exModal')) cerrar(); });

  // Botón en Reportes (junto a Exportar): visible solo para quienes pueden confirmar
  function montarBoton() {
    const exp = document.getElementById('rep2Export');
    if (!exp || document.getElementById('btnExtrasPorConfirmar')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnExtrasPorConfirmar';
    b.className = 'rep2-btn btn-extras-pend';
    b.title = 'Horas extra de días en que el sistema completó la salida';
    b.innerHTML = '<i class="fas fa-hourglass-half"></i> Extras por confirmar';
    b.addEventListener('click', () => window.abrirExtrasPorConfirmar());
    exp.parentNode.insertBefore(b, exp);
  }

  const css = document.createElement('style');
  css.textContent = `
    .btn-confirmar-extras { margin-top:3px; border:1px solid #f59e0b; background:#fff; color:#92400e; font:700 10px/1 inherit; font-family:inherit; padding:4px 8px; border-radius:999px; cursor:pointer; white-space:nowrap; }
    .btn-confirmar-extras:hover { background:#fef3c7; }
    .btn-extras-pend { font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px; cursor:pointer; background:#fffbeb; border:1.5px solid #f59e0b; color:#92400e; }
    .rep2-btn.btn-extras-pend { font-size:inherit; padding:8px 12px; margin-left:auto; }
    .rep2-btn.btn-extras-pend + .rep2-export { margin-left:0; }
    .ex-fondo { position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:100000; display:flex; align-items:center; justify-content:center; padding:16px; }
    .ex-caja { background:#fff; border-radius:16px; width:min(860px,100%); max-height:92vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,.25); color:#0f172a; }
    .ex-cab { display:flex; gap:12px; justify-content:space-between; padding:18px 20px 10px; }
    .ex-cab h3 { margin:0; font-size:17px; } .ex-cab h3 i { color:#d97706; }
    .ex-cab p { margin:4px 0 0; font-size:12.5px; color:#475569; line-height:1.45; }
    .ex-x { border:0; background:#f1f5f9; width:34px; height:34px; border-radius:10px; cursor:pointer; color:#475569; flex:none; }
    .ex-filtros { display:flex; gap:8px; padding:0 20px 10px; flex-wrap:wrap; }
    .ex-filtros select, .ex-filtros input { border:1px solid #cbd5e1; border-radius:10px; padding:8px 10px; font-size:13px; background:#fff; color:#0f172a; }
    .ex-filtros input { flex:1; min-width:180px; }
    .ex-cuerpo { overflow:auto; padding:0 20px; flex:1; min-height:120px; }
    .ex-tabla { width:100%; border-collapse:collapse; font-size:12.5px; }
    .ex-tabla th { position:sticky; top:0; background:#f8fafc; text-align:left; padding:8px; font-size:11px; color:#475569; }
    .ex-tabla td { padding:7px 8px; border-top:1px solid #e2e8f0; vertical-align:top; font-variant-numeric:tabular-nums; }
    .ex-tabla td span { display:block; font-size:10.5px; color:#64748b; }
    .ex-tabla td span.ex-sis { color:#b45309; } .ex-tabla td span.ex-corr { color:#15803d; }
    .ex-tabla input { width:16px; height:16px; cursor:pointer; }
    .ex-vacio { text-align:center; padding:36px 12px; color:#475569; } .ex-vacio i { color:#16a34a; }
    .ex-pie { display:flex; gap:8px; align-items:center; padding:12px 20px 16px; border-top:1px solid #e2e8f0; flex-wrap:wrap; }
    .ex-resumen { flex:1; min-width:180px; font-size:13px; color:#334155; }
    .ex-btn { border:1px solid #cbd5e1; background:#fff; color:#334155; border-radius:10px; padding:9px 14px; font-weight:700; font-size:13px; cursor:pointer; }
    .ex-btn-ok { background:#16a34a; border-color:#16a34a; color:#fff; } .ex-btn:disabled { opacity:.5; cursor:not-allowed; }
    @media (max-width:640px) { .ex-fondo { padding:0; align-items:flex-end; } .ex-caja { border-radius:16px 16px 0 0; } .ex-cab, .ex-filtros, .ex-cuerpo, .ex-pie { padding-left:14px; padding-right:14px; } }`;
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarBoton); else montarBoton();
  window.ExtrasPorConfirmar = { pendientesDe, rango };
})();
