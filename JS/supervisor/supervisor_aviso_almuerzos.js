// =====================================================================
// WhatsApp → 2. Automatizaciones (Aviso diario de almuerzos)
// Configura el mensaje diario con el número de almuerzos (lo envía Apps Script, aviso_almuerzos.gs, a la
// hora fijada): activar, hora, incluir a los Sup. Admin, colaboradores elegidos por ficha (p. ej. un usuario de
// producción; el teléfono sale de su ficha) y contactos extra (p. ej. encargados del catering).
// Se guarda en Firestore configuracion/aviso_almuerzos. Solo Admin Master y Supervisores Admin.
// =====================================================================
(function () {
  const DOC = ['configuracion', 'aviso_almuerzos'];
  const st = { cfg: null, contactos: [], colaboradores: [], busqueda: '', cargando: false };

  const ref = () => window.firebase.firestore().collection(DOC[0]).doc(DOC[1]);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const telValido = t => {
    const d = String(t || '').replace(/\D/g, '');
    return /^09\d{8}$/.test(d) || /^5939\d{8}$/.test(d);
  };
  const telLocal = t => {
    const d = String(t || '').replace(/\D/g, '');
    return /^5939\d{8}$/.test(d) ? '0' + d.slice(3) : d;
  };

  function adminsConTelefono() {
    const lista = (window.todoElPersonal ? window.todoElPersonal() : (window.empCache || []));
    return lista.filter(e => {
      if (String(e.activo ?? 'SI').toUpperCase() === 'NO' || e.activo === false) return false;
      const rol = String(e.supervisor || e.rol || '').toUpperCase();
      return String(e.id) === '1058' || rol.includes('ADMIN');
    });
  }

  function personalActivo() {
    const lista = (window.todoElPersonal ? window.todoElPersonal() : (window.empCache || []));
    return lista.filter(e => !(String(e.activo ?? 'SI').toUpperCase() === 'NO' || e.activo === false) && String(e.area || '').trim().toUpperCase() !== 'PRUEBAS');
  }
  const fichaDe = id => personalActivo().find(e => String(e.id) === String(id));
  const sinTildes = t => String(t || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Resultados del buscador: nombre, ID, área o cargo (todas las palabras), sin los ya elegidos
  function pintarResultados() {
    const cont = document.getElementById('avisoAlmResultados');
    if (!cont) return;
    const palabras = sinTildes(st.busqueda).split(/\s+/).filter(Boolean);
    if (!palabras.length) { cont.innerHTML = ''; return; }
    const elegidos = new Set(st.colaboradores.map(x => String(x.id)));
    const res = personalActivo()
      .filter(e => !elegidos.has(String(e.id)))
      .filter(e => { const t = sinTildes(`${e.nombre} ${e.id} ${e.area || ''} ${e.cargo || ''}`); return palabras.every(p => t.includes(p)); })
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      .slice(0, 8);
    cont.innerHTML = res.length ? res.map(e => {
      const tel = e.telefono || e.celular || '';
      return `<button type="button" data-aa-agregar-colab="${esc(e.id)}" style="display:flex; width:100%; align-items:center; gap:10px; text-align:left; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:7px 10px; margin-top:6px; cursor:pointer;">
        <i class="fas fa-user-plus" style="color:#4338ca;"></i>
        <span style="flex:1; min-width:0; font-size:12.5px;"><strong>${esc(e.nombre)}</strong> <span style="color:#64748b;">· ID ${esc(e.id)}${e.area ? ' · ' + esc(e.area) : ''}${e.cargo ? ' · ' + esc(e.cargo) : ''}</span></span>
        <span style="font-size:11px; color:${telValido(tel) ? '#15803d' : '#b91c1c'};">${telValido(tel) ? 'Con WhatsApp' : 'Sin celular'}</span>
      </button>`;
    }).join('') : '<div style="font-size:12px; color:#94a3b8; margin-top:6px;">Sin coincidencias.</div>';
  }

  // Mismo conteo que Control Diario (todo el personal + extras de hoy): referencia de lo que saldría ahora
  function conteoActual() {
    const hoy = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().slice(0, 10);
    const todos = window.todoElPersonal ? window.todoElPersonal() : [];
    const pres = e => e.entradaHoy || (typeof esEmpleadoSoloAlmuerzo === 'function' && esEmpleadoSoloAlmuerzo(e)) || String(e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    const conAlm = todos.filter(e => pres(e) && (e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA'));
    const externos = conAlm.filter(e => window.esPersonalExterno && window.esPersonalExterno(e)).length;
    const extras = (window.obtenerAlmuerzosExtraConsolidados ? window.obtenerAlmuerzosExtraConsolidados(hoy, hoy) : [])
      .reduce((a, x) => a + (parseInt(x.cantidad, 10) || 1), 0);
    return { empresa: conAlm.length - externos, externos, extras, total: conAlm.length + extras };
  }

  function pintar() {
    const cont = document.getElementById('waAvisoAlmuerzosCont');
    if (!cont) return;
    if (typeof tienePermisoAdmin === 'function' && !tienePermisoAdmin()) {
      cont.innerHTML = '<p style="color:#64748b; font-size:13px; text-align:center; padding:20px;">Solo los administradores pueden configurar este aviso.</p>';
      return;
    }
    if (!st.cfg) {
      cont.innerHTML = `<p style="color:#64748b; font-size:13px; text-align:center; padding:20px;">${st.cargando ? '<i class="fas fa-spinner fa-spin"></i> Cargando…' : 'No se pudo leer la configuración.'}</p>`;
      return;
    }
    const c = st.cfg;
    const admins = adminsConTelefono();
    const k = conteoActual();
    const ult = c.ultimo_envio
      ? `<div style="font-size:12px; color:#334155;"><strong>Último envío:</strong> ${esc(c.ultimo_envio.split('-').reverse().join('/'))}${c.ultimo_en ? ' · ' + esc(new Date(c.ultimo_en).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })) : ''}<br><span style="color:#64748b;">${esc(c.ultimo_resultado || '')}</span></div>`
      : '<div style="font-size:12px; color:#64748b;">Todavía no se ha enviado ningún aviso.</div>';
    const filasColab = st.colaboradores.map((x, i) => {
      const f = fichaDe(x.id);
      const tel = f ? (f.telefono || f.celular || '') : '';
      return `
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:7px 10px;">
        <i class="fas fa-id-badge" style="color:#4338ca;"></i>
        <div style="flex:1; min-width:0; font-size:12.5px;"><strong>${esc(f ? f.nombre : x.nombre)}</strong> <span style="color:#64748b;">· ID ${esc(x.id)}${f && f.area ? ' · ' + esc(f.area) : ''}</span>
          <div style="font-size:11px; color:${!f ? '#b91c1c' : (telValido(tel) ? '#15803d' : '#b91c1c')};">${!f ? 'Ficha inactiva o no encontrada' : (telValido(tel) ? 'WhatsApp ' + esc(telLocal(tel)) : 'Sin celular válido en su ficha')}</div></div>
        <button type="button" class="btn" data-aa-quitar-colab="${i}" title="Quitar" style="padding:7px 10px; border-radius:8px; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca;"><i class="fas fa-trash"></i></button>
      </div>`;
    }).join('');
    const filas = st.contactos.map((x, i) => `
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
        <input type="text" class="form-input" data-aa-nombre="${i}" value="${esc(x.nombre)}" placeholder="Nombre (p. ej. Catering - Juan)" style="flex:1 1 180px; font-size:13px;">
        <input type="tel" class="form-input" data-aa-tel="${i}" value="${esc(telLocal(x.telefono))}" placeholder="09XXXXXXXX" inputmode="tel" style="flex:0 1 140px; font-size:13px; ${x.telefono && !telValido(x.telefono) ? 'border-color:#ef4444;' : ''}">
        <button type="button" class="btn" data-aa-quitar="${i}" title="Quitar" style="padding:8px 11px; border-radius:8px; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca;"><i class="fas fa-trash"></i></button>
      </div>`).join('');

    cont.innerHTML = `
      <label for="chkAvisoAlmActivo" style="display:flex; align-items:center; justify-content:space-between; background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:12px 14px; margin-bottom:14px; cursor:pointer;">
        <div>
          <strong style="font-size:13px; color:#1e293b; display:block;">Enviar el número de almuerzos cada día</strong>
          <span style="font-size:11.5px; color:#64748b;">Un mensaje diario a la hora indicada. Los días sin almuerzos no se envía.</span>
        </div>
        <div class="switch"><input type="checkbox" id="chkAvisoAlmActivo" ${c.activo ? 'checked' : ''}><span class="slider-round"></span></div>
      </label>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:14px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label" for="txtAvisoAlmHora" style="font-size:11.5px; font-weight:700;">Hora de envío</label>
          <input type="time" id="txtAvisoAlmHora" class="form-input" value="${esc(c.hora || '09:30')}" style="font-size:13px; font-weight:700; text-align:center;">
          <small style="color:#64748b; font-size:11px; display:block; margin-top:3px;">Los almuerzos extra de hoy se piden hasta las 09:30 (Sup. Admin hasta las 11:00).</small>
        </div>
        <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11px; font-weight:700; color:#4338ca; text-transform:uppercase; letter-spacing:.3px;">Si se enviara ahora</div>
          <div style="font-size:22px; font-weight:800; color:#1e1b4b;">${k.total} almuerzo${k.total === 1 ? '' : 's'}</div>
          <div style="font-size:11.5px; color:#475569;">Empresa ${k.empresa}${k.externos ? ` · Servicios externos ${k.externos}` : ''}${k.extras ? ` · Extras ${k.extras}` : ''}</div>
        </div>
      </div>

      <label style="display:flex; gap:10px; align-items:flex-start; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:14px; cursor:pointer;">
        <input type="checkbox" id="chkAvisoAlmAdmins" ${c.incluir_admins !== false ? 'checked' : ''} style="margin-top:3px;">
        <div>
          <strong style="font-size:13px; color:#1e293b;">Enviar a los Supervisores Administradores</strong>
          <div style="font-size:11.5px; color:#64748b; margin-top:2px;">${admins.map(a => `${esc(a.nombre)} ${a.telefono ? `(${esc(telLocal(a.telefono))})` : '<span style="color:#b91c1c;">(sin teléfono)</span>'}`).join(' · ') || 'No hay administradores activos.'}</div>
        </div>
      </label>

      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:14px;">
        <strong style="font-size:13px; color:#1e293b; display:block; margin-bottom:2px;">Colaboradores que reciben el aviso</strong>
        <span style="font-size:11.5px; color:#64748b; display:block; margin-bottom:10px;">Por ejemplo, un usuario de producción. Se elige la ficha y el WhatsApp sale de su celular registrado.</span>
        ${filasColab || '<div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">Ningún colaborador elegido.</div>'}
        <div style="position:relative;">
          <i class="fas fa-search" style="position:absolute; left:11px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:12px;"></i>
          <input type="search" id="txtAvisoAlmBuscar" class="form-input" value="${esc(st.busqueda)}" placeholder="Buscar por nombre, ID o área para agregar…" autocomplete="off" style="width:100%; font-size:13px; padding-left:30px;">
        </div>
        <div id="avisoAlmResultados"></div>
        <span style="font-size:11px; color:#64748b; display:block; margin-top:6px;">Puedes agregar varios; se guardan con «Guardar aviso de almuerzos».</span>
      </div>

      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:14px;">
        <strong style="font-size:13px; color:#1e293b; display:block; margin-bottom:2px;">Otros números</strong>
        <span style="font-size:11.5px; color:#64748b; display:block; margin-bottom:10px;">Por ejemplo, los encargados del catering. Celular de Ecuador (09XXXXXXXX).</span>
        ${filas || '<div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">Sin números extra.</div>'}
        <button type="button" class="btn" data-aa-agregar style="padding:8px 14px; border-radius:8px; font-size:12.5px; font-weight:600; background:#f8fafc; border:1px dashed #94a3b8; color:#334155;"><i class="fas fa-plus"></i> Agregar número</button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        ${ult}
        <button type="button" class="btn btn-success" data-aa-guardar style="padding:9px 20px; border-radius:8px; font-size:12.5px; font-weight:700;"><i class="fas fa-save"></i> Guardar aviso de almuerzos</button>
      </div>
      <p id="avisoAlmMsg" role="status" style="font-size:12px; margin:10px 0 0; min-height:16px;"></p>`;
    pintarResultados();
  }

  // Toma lo escrito en los campos antes de repintar (agregar / quitar no debe borrar lo tecleado)
  function leerCampos() {
    st.contactos = st.contactos.map((x, i) => ({
      ...x,
      nombre: (document.querySelector(`[data-aa-nombre="${i}"]`)?.value ?? x.nombre).trim(),
      telefono: (document.querySelector(`[data-aa-tel="${i}"]`)?.value ?? x.telefono).trim()
    }));
    if (st.cfg) {
      st.cfg.activo = !!document.getElementById('chkAvisoAlmActivo')?.checked;
      st.cfg.hora = document.getElementById('txtAvisoAlmHora')?.value || st.cfg.hora;
      st.cfg.incluir_admins = !!document.getElementById('chkAvisoAlmAdmins')?.checked;
    }
  }

  async function guardar() {
    leerCampos();
    const msg = document.getElementById('avisoAlmMsg');
    const decir = (t, ok) => { if (msg) { msg.textContent = t; msg.style.color = ok ? '#15803d' : '#b91c1c'; } };
    const contactos = st.contactos.filter(x => x.nombre || x.telefono);
    const malo = contactos.find(x => !telValido(x.telefono));
    if (malo) { decir(`Revisa el número de ${malo.nombre || 'un contacto'}: debe ser un celular de Ecuador (09XXXXXXXX).`); return; }
    if (!/^\d{2}:\d{2}$/.test(st.cfg.hora || '')) { decir('Indica la hora de envío.'); return; }
    const sesion = (() => { try { return JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { return {}; } })();
    const datos = {
      activo: st.cfg.activo, hora: st.cfg.hora, incluir_admins: st.cfg.incluir_admins,
      contactos: contactos.map(x => ({ nombre: x.nombre || 'Contacto', telefono: x.telefono.replace(/\D/g, '') })),
      colaboradores: st.colaboradores.map(x => ({ id: String(x.id), nombre: x.nombre || '' })),
      actualizado_por: sesion.nombre || sesion.id || 'Panel', actualizado_en: new Date().toISOString()
    };
    const btn = document.querySelector('[data-aa-guardar]');
    if (btn) btn.disabled = true;
    try {
      await ref().set(datos, { merge: true });
      st.contactos = datos.contactos;
      st.colaboradores = datos.colaboradores;
      Object.assign(st.cfg, datos);
      pintar();
      const m2 = document.getElementById('avisoAlmMsg');
      if (m2) { m2.textContent = datos.activo ? `Guardado. El aviso sale todos los días a las ${datos.hora}.` : 'Guardado. El aviso está desactivado.'; m2.style.color = '#15803d'; }
    } catch (e) {
      decir('No se pudo guardar: ' + (e.message || e));
      if (btn) btn.disabled = false;
    }
  }

  async function cargar() {
    st.cargando = true;
    pintar();
    try {
      const snap = await ref().get();
      st.cfg = snap.exists ? (snap.data() || {}) : { activo: false, hora: '09:30', incluir_admins: true, contactos: [], colaboradores: [] };
      st.colaboradores = (st.cfg.colaboradores || []).filter(x => x && x.id).map(x => ({ id: String(x.id), nombre: x.nombre || '' }));
      st.contactos = (st.cfg.contactos || []).map(x => ({ nombre: x.nombre || '', telefono: String(x.telefono || '') }));
    } catch (e) {
      console.warn('Aviso de almuerzos:', e);
      st.cfg = null;
    }
    st.cargando = false;
    pintar();
  }

  document.addEventListener('click', ev => {
    if (!ev.target.closest('#waAvisoAlmuerzosCont')) return;
    if (ev.target.closest('[data-aa-agregar]')) { leerCampos(); st.contactos.push({ nombre: '', telefono: '' }); pintar(); document.querySelector(`[data-aa-nombre="${st.contactos.length - 1}"]`)?.focus(); return; }
    const q = ev.target.closest('[data-aa-quitar]');
    if (q) { leerCampos(); st.contactos.splice(Number(q.dataset.aaQuitar), 1); pintar(); return; }
    const ac = ev.target.closest('[data-aa-agregar-colab]');
    if (ac) {
      leerCampos();
      const f = fichaDe(ac.dataset.aaAgregarColab);
      if (f && !st.colaboradores.some(x => String(x.id) === String(f.id))) st.colaboradores.push({ id: String(f.id), nombre: f.nombre || '' });
      pintar();
      const inp = document.getElementById('txtAvisoAlmBuscar');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      return;
    }
    const qc = ev.target.closest('[data-aa-quitar-colab]');
    if (qc) { leerCampos(); st.colaboradores.splice(Number(qc.dataset.aaQuitarColab), 1); pintar(); return; }
    if (ev.target.closest('[data-aa-guardar]')) guardar();
  });

  document.addEventListener('input', ev => {
    if (ev.target && ev.target.id === 'txtAvisoAlmBuscar') { st.busqueda = ev.target.value; pintarResultados(); }
  });

  window.cargarAvisoAlmuerzos = cargar;
})();
