// Panel → Directorio → «Horarios especiales»: excepciones al horario general (L–V 07:30–16:15) por persona.
// Solo supervisores admin y admin master. Cada excepción se guarda en la ficha (empleados/{id}.horario_especial, texto JSON):
//   [{ dias:[1..5], entrada:'07:45', salida:'16:30', desde:'2026-11-26', hasta:'', nota:'', por:'', en:'' }]
// Las reglas que la leen están en JS/reglas_jornada.js (ReglasJornada.horarioDe): atraso, salida temprana, extras,
// permisos, salida automática y el cargo a vacaciones usan el horario propio de la persona.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => (typeof mostrarToast === 'function' ? mostrarToast(m, t) : alert(m));
  const RJ = () => window.ReglasJornada;
  const cache = () => (typeof empCache !== 'undefined' && Array.isArray(empCache) ? empCache : []);
  const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie']];
  const hoy = () => (typeof getLocalHoyStr === 'function' ? getLocalHoyStr() : new Date().toISOString().slice(0, 10));
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const quien = () => { try { return JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').nombre || ''; } catch (e) { return ''; } };
  const st = { editando: null, error: '', guardando: false };   // editando: { id, indice } (indice -1 = nueva)

  // Lista cruda de la ficha (conserva por/en/nota); las entradas inválidas se descartan
  function listaDe(e) {
    let l = e && e.horario_especial;
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (x) { l = []; } }
    if (l && !Array.isArray(l) && typeof l === 'object') l = [l];
    return Array.isArray(l) ? l.filter(h => h && typeof h === 'object') : [];
  }
  const resumenDias = d => {
    const ds = (Array.isArray(d) && d.length ? d : [1, 2, 3, 4, 5]).map(Number).sort();
    if (ds.join() === '1,2,3,4,5') return 'Lunes a viernes';
    return ds.map(n => (DIAS.find(x => x[0] === n) || [0, n])[1]).join(', ');
  };
  const horaTxt = t => { const m = RJ().hmAMin(t); return m === null ? '—' : RJ().minAHM(m); };

  function caja() {
    let m = document.getElementById('modalHorarios');
    if (!m) {
      m = document.createElement('div');
      m.id = 'modalHorarios';
      m.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(15,23,42,.6); display:flex; align-items:flex-start; justify-content:center; padding:16px; overflow-y:auto;';
      m.addEventListener('click', ev => { if (ev.target === m) cerrar(); });
      m.addEventListener('click', alClic);
      m.addEventListener('submit', alEnviar);
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrar() { document.getElementById('modalHorarios')?.remove(); st.editando = null; st.error = ''; }

  const estiloInput = 'width:100%; padding:8px 10px; border-radius:8px; border:1.5px solid #cbd5e1; font-size:13px; box-sizing:border-box;';
  const etiqueta = 'display:block; font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; text-transform:uppercase;';
  const boton = (fondo, color, borde = fondo) => `padding:8px 14px; border-radius:8px; border:1.5px solid ${borde}; background:${fondo}; color:${color}; font-weight:800; font-size:12px; cursor:pointer;`;

  function formulario() {
    const ed = st.editando;
    const e = cache().find(x => String(x.id) === String(ed.id));
    const h = ed.indice >= 0 ? listaDe(e)[ed.indice] || {} : {};
    const dias = Array.isArray(h.dias) && h.dias.length ? h.dias.map(Number) : [1, 2, 3, 4, 5];
    const activos = cache().filter(x => String(x.activo || 'SI').toUpperCase() !== 'NO').sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    return `<form data-guardar style="border:1px solid #bfdbfe; background:#eff6ff; border-radius:12px; padding:12px 14px; margin-bottom:14px;">
      <div style="font-weight:800; font-size:13.5px; color:#1e3a8a; margin-bottom:8px;"><i class="fas fa-clock"></i> ${ed.indice >= 0 ? 'Editar horario especial' : 'Nuevo horario especial'}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        <div style="grid-column:1/-1;"><label style="${etiqueta}">Colaborador</label>
          ${ed.id ? `<input name="persona" value="${esc(e ? e.id + ' · ' + (e.nombre || '') : ed.id)}" readonly style="${estiloInput} background:#f1f5f9;">`
            : `<input name="persona" list="horariosPersonas" placeholder="Escribe el ID o el nombre" required autocomplete="off" style="${estiloInput}">
               <datalist id="horariosPersonas">${activos.map(x => `<option value="${esc(x.id)} · ${esc(x.nombre || '')}">`).join('')}</datalist>`}</div>
        <div><label style="${etiqueta}">Entrada</label><input name="entrada" type="time" required value="${esc(h.entrada ? horaTxt(h.entrada) : '07:30')}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Salida</label><input name="salida" type="time" required value="${esc(h.salida ? horaTxt(h.salida) : '16:15')}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Rige desde</label><input name="desde" type="date" required value="${esc(h.desde || hoy())}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Hasta (opcional)</label><input name="hasta" type="date" value="${esc(h.hasta || '')}" style="${estiloInput}"></div>
      </div>
      <div style="margin-top:10px;"><label style="${etiqueta}">Días</label>
        <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:13px;">${DIAS.map(([n, t]) => `<label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" name="dia" value="${n}" ${dias.includes(n) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div style="margin-top:10px;"><label style="${etiqueta}">Motivo / nota (opcional)</label><input name="nota" maxlength="120" value="${esc(h.nota || '')}" placeholder="Ej.: acuerdo con Talento Humano" style="${estiloInput}"></div>
      <p style="font-size:11.5px; color:#64748b; margin:8px 0 10px;">Desde esa fecha el atraso, la salida temprana, las horas extra, los permisos y la salida automática se miden con este horario. Los días anteriores a «Rige desde» no cambian. Sábado, domingo y feriados siguen con sus reglas.</p>
      ${st.error ? `<p style="color:#b91c1c; font-size:12.5px; font-weight:700; margin:0 0 8px;">${esc(st.error)}</p>` : ''}
      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button type="button" data-a="cancelar" style="${boton('#fff', '#334155', '#cbd5e1')}">Cancelar</button>
        <button type="submit" ${st.guardando ? 'disabled' : ''} style="${boton('#059669', '#fff')}">${st.guardando ? '<i class="fas fa-spinner fa-spin"></i> Guardando…' : '<i class="fas fa-check"></i> Guardar'}</button>
      </div></form>`;
  }

  function tabla() {
    const filas = [];
    cache().forEach(e => listaDe(e).forEach((h, i) => filas.push({ e, h, i })));
    filas.sort((a, b) => String(a.e.nombre || '').localeCompare(String(b.e.nombre || ''), 'es'));
    if (!filas.length) return '<p style="text-align:center; color:#64748b; padding:18px 0;">Nadie tiene un horario especial. Usa «Nuevo horario especial» para configurar uno.</p>';
    return filas.map(({ e, h, i }) => {
      const vigente = (!h.desde || h.desde <= hoy()) && (!h.hasta || h.hasta >= hoy());
      return `<article style="border:1px solid #e2e8f0; border-radius:12px; padding:11px 14px; margin-bottom:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap;">
          <div style="min-width:0;"><div style="font-weight:800; font-size:14px; color:#0f172a;">${esc(e.nombre || '')} <span style="color:#64748b; font-weight:600;">· ${esc(e.id)}</span></div>
            <div style="font-size:12px; color:#64748b; margin-top:2px;">${esc(e.area || '')}${e.cargo ? ' · ' + esc(e.cargo) : ''}</div></div>
          <span style="flex:none; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px; ${vigente ? 'background:#dcfce7; color:#166534;' : 'background:#f1f5f9; color:#475569;'}">${vigente ? 'Vigente' : (h.desde && h.desde > hoy() ? 'Empieza ' + fechaCorta(h.desde) : 'Vencido')}</span>
        </div>
        <div style="margin-top:8px; font-size:13px; color:#334155;"><b>${resumenDias(h.dias)}</b>: ${horaTxt(h.entrada)} a ${horaTxt(h.salida)}
          <span style="color:#64748b;"> · desde ${fechaCorta(h.desde) || 'siempre'}${h.hasta ? ' hasta ' + fechaCorta(h.hasta) : ''}</span></div>
        ${h.nota ? `<div style="font-size:12px; color:#475569; margin-top:3px;">${esc(h.nota)}</div>` : ''}
        ${h.por ? `<div style="font-size:11px; color:#94a3b8; margin-top:3px;">Configurado por ${esc(h.por)}${h.en ? ' el ' + fechaCorta(h.en) : ''}</div>` : ''}
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
          <button type="button" data-a="quitar" data-id="${esc(e.id)}" data-i="${i}" style="${boton('#fef2f2', '#b91c1c', '#fecaca')}">Quitar</button>
          <button type="button" data-a="editar" data-id="${esc(e.id)}" data-i="${i}" style="${boton('#fff', '#1d4ed8', '#bfdbfe')}">Editar</button></div>
      </article>`;
    }).join('');
  }

  function pintar() {
    caja().innerHTML = `<div style="background:#f8fafc; border-radius:14px; width:100%; max-width:640px; overflow:hidden; box-shadow:0 20px 25px -5px rgba(0,0,0,.3);">
      <div style="background:linear-gradient(135deg,#0f766e,#0d9488); color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center;">
        <div><div style="font-weight:800; font-size:15px;"><i class="fas fa-user-clock"></i> Horarios especiales</div>
          <div style="font-size:11.5px; opacity:.9;">Excepciones al horario general (L–V 07:30 a 16:15)</div></div>
        <div style="display:flex; gap:8px; align-items:center;">
          ${st.editando ? '' : `<button type="button" data-a="nuevo" style="${boton('#fff', '#0f766e')}"><i class="fas fa-plus"></i> Nuevo</button>`}
          <button type="button" data-a="cerrar" aria-label="Cerrar" style="background:none; border:none; color:#fff; font-size:22px; cursor:pointer;">&times;</button></div>
      </div>
      <div style="padding:14px 16px;">${st.editando ? formulario() : ''}${tabla()}</div></div>`;
  }

  // Guarda la lista de una ficha (vacía = sin excepción) y refresca lo que el panel ya tiene cargado
  async function guardarLista(id, lista) {
    const valor = lista.length ? JSON.stringify(lista) : '';
    const r = await window.FirebaseBackend.actualizarMasivoEmpleados({ empleados: [{ id: String(id), horario_especial: valor }] });
    if (!r || r.error) throw new Error('No se pudo guardar: ' + ((r && r.error) || 'sin respuesta'));
    const e = cache().find(x => String(x.id) === String(id));
    if (e) { e.horario_especial = valor; RJ().registrarHorarios([e]); }
  }

  async function alEnviar(ev) {
    ev.preventDefault();
    const f = ev.target;
    if (!f.matches('[data-guardar]') || st.guardando) return;
    const ed = st.editando;
    const id = ed.id || (String(f.persona.value).split('·')[0] || '').trim();
    const e = cache().find(x => String(x.id) === id);
    st.error = '';
    const ent = RJ().hmAMin(f.entrada.value), sal = RJ().hmAMin(f.salida.value);
    const dias = [...f.querySelectorAll('[name=dia]:checked')].map(x => Number(x.value));
    if (!e) st.error = 'Elige un colaborador de la lista.';
    else if (ent === null || sal === null) st.error = 'Escribe la hora de entrada y de salida.';
    else if (sal < ent + 300) st.error = 'La jornada debe durar al menos 5 horas.';
    else if (!dias.length) st.error = 'Elige al menos un día.';
    else if (f.hasta.value && f.hasta.value < f.desde.value) st.error = '«Hasta» no puede ser antes de «Rige desde».';
    else if (ent === 450 && sal === 975 && dias.length === 5) st.error = 'Ese es el horario general: no hace falta una excepción.';
    if (st.error) return pintar();
    const lista = listaDe(e).slice();
    // Misma persona, mismos días y fechas que otro horario vigente → se avisa antes de solaparlos
    const nuevo = { dias, entrada: RJ().minAHM(ent), salida: RJ().minAHM(sal), desde: f.desde.value, hasta: f.hasta.value || '', nota: f.nota.value.trim(), por: quien(), en: hoy() };
    const solapa = lista.some((h, i) => i !== ed.indice && (h.dias || [1, 2, 3, 4, 5]).some(d => dias.includes(Number(d))) &&
      (!h.hasta || h.hasta >= nuevo.desde) && (!nuevo.hasta || !h.desde || h.desde <= nuevo.hasta));
    if (solapa) { st.error = 'Esta persona ya tiene otro horario especial que coincide en esos días y fechas. Edítalo o ponle fecha «Hasta».'; return pintar(); }
    if (ed.indice >= 0) lista[ed.indice] = nuevo; else lista.push(nuevo);
    st.guardando = true; pintar();
    try {
      await guardarLista(e.id, lista);
      toast(`Horario especial guardado para ${e.nombre || e.id}: ${nuevo.entrada} a ${nuevo.salida}`, 'success');
      st.editando = null;
    } catch (x) { st.error = x.message; }
    st.guardando = false; pintar();
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, id, i } = b.dataset;
    if (a === 'cerrar') cerrar();
    if (a === 'nuevo') { st.editando = { id: '', indice: -1 }; st.error = ''; pintar(); }
    if (a === 'cancelar') { st.editando = null; st.error = ''; pintar(); }
    if (a === 'editar') { st.editando = { id, indice: Number(i) }; st.error = ''; pintar(); }
    if (a === 'quitar') {
      const e = cache().find(x => String(x.id) === String(id));
      if (!e || !confirm(`¿Quitar este horario especial de ${e.nombre || id}? Volverá al horario general.`)) return;
      const lista = listaDe(e).slice(); lista.splice(Number(i), 1);
      try { await guardarLista(id, lista); toast('Horario especial quitado', 'success'); }
      catch (x) { toast(x.message, 'error'); }
      pintar();
    }
  }

  window.abrirHorariosEspeciales = function () {
    if (!(typeof tienePermisoAdmin === 'function' && tienePermisoAdmin())) return toast('Solo los supervisores administradores configuran horarios especiales', 'warning');
    if (!RJ() || !RJ().parsearHorarios) return toast('Falta cargar las reglas de jornada. Recarga la página.', 'error');
    st.editando = null; st.error = ''; st.guardando = false;
    pintar();
  };

  // El botón del Directorio solo se ve para administradores
  let intentos = 0;
  const mostrar = setInterval(() => {
    const b = document.getElementById('btnHorariosEspeciales');
    if (b && typeof tienePermisoAdmin === 'function' && tienePermisoAdmin()) { b.style.display = 'inline-flex'; clearInterval(mostrar); }
    if (++intentos > 60) clearInterval(mostrar);
  }, 1000);
})();
