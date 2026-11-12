// Panel → Directorio → «Visitantes frecuentes» (db/postgres/018_visitantes_frecuentes.sql).
// Credencial con QR para quien viene al menos una vez por semana (proveedores, técnicos…): la portería la
// escanea como una visita y crea la visita del día. Siempre pide la contraseña al abrir.
// Supervisor: solo sus visitantes (él es el anfitrión). Supervisor admin o master: cualquier anfitrión.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ses: null, datos: null, error: '', cargando: false, vista: 'lista', form: {}, sugAnf: [], sugRec: [], qr: null, enviando: false };
  const toast = (m, t) => (typeof mostrarToast === 'function' ? mostrarToast(m, t) : alert(m));
  const supervisor = () => { try { return JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { return {}; } };
  const fechaCorta = f => { const m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const codigoBonito = c => String(c || '').replace(/^(.{4})(.{4})$/, '$1-$2');
  const DIAS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];
  const FRECUENCIAS = { semanal: 'Una vez por semana', varias: 'Varias veces por semana', diaria: 'Todos los días' };

  // ---------------------------------------------------------------- servidor
  async function rpc(p) {
    const fb = window.FirebaseBackend;
    let causa = '';
    for (let i = 0; i < 2; i++) {
      const b = fb && fb._urlHistorico ? await fb._urlHistorico(i > 0) : '';
      if (!b) { causa = 'sin dirección'; continue; }
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(`${b}/rpc/visita_frecuente`, { method: 'POST', signal: ctrl.signal,
          headers: { Authorization: 'Bearer ' + st.ses.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p }) });
        if (r.status === 401) { st.ses = null; throw new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'); }
        if (r.ok) return await r.json();
        causa = 'HTTP ' + r.status;
      } catch (e) { if (/sesión/.test(e.message)) throw e; causa = e.message; } finally { clearTimeout(t); }
    }
    const r = await fb._post({ accion: 'evalRpc', token: st.ses.token, fn: 'visita_frecuente', p: JSON.stringify(p) });
    if (!r || typeof r.status !== 'number') throw new Error('Sin conexión con la base de visitas (' + causa + ')');
    if (r.status === 401) { st.ses = null; throw new Error('Tu sesión venció. Ingresa tu contraseña de nuevo.'); }
    return r.body;
  }
  async function llamar(p) {
    const r = await rpc(p);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'No se pudo completar');
    return r;
  }
  async function cargar() {
    st.cargando = true; st.error = ''; pintar();
    try { st.datos = await llamar({ accion: 'listar' }); } catch (e) { st.error = e.message; }
    st.cargando = false; pintar();
  }

  // QR con la misma librería que la portería y la página de visitas (se carga solo cuando hace falta)
  let cargaQr = null;
  function libQr() {
    if (typeof window.qrcode === 'function') return Promise.resolve(true);
    if (!cargaQr) cargaQr = new Promise(ok => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      s.onload = () => ok(true); s.onerror = () => { cargaQr = null; ok(false); };
      document.head.appendChild(s);
    });
    return cargaQr;
  }
  function imagenQr(codigo, celda = 7) {
    const q = window.qrcode(0, 'M'); q.addData('TCV1:' + codigo); q.make();
    return q.createDataURL(celda, 2);
  }

  // ---------------------------------------------------------------- ventana
  function caja() {
    let m = document.getElementById('modalFrecuentes');
    if (!m) {
      m = document.createElement('div');
      m.id = 'modalFrecuentes';
      m.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(15,23,42,.6); display:flex; align-items:flex-start; justify-content:center; padding:16px; overflow-y:auto;';
      m.addEventListener('click', ev => { if (ev.target === m) cerrar(); });
      m.addEventListener('click', alClic);
      m.addEventListener('submit', alEnviar);
      m.addEventListener('input', alEscribir);
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrar() { document.getElementById('modalFrecuentes')?.remove(); st.ses = null; st.datos = null; }

  const estiloInput = 'width:100%; padding:8px 10px; border-radius:8px; border:1.5px solid #cbd5e1; font-size:13px; box-sizing:border-box; background:#fff;';
  const etiqueta = 'display:block; font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; text-transform:uppercase;';
  const boton = (fondo, color, borde = fondo) => `padding:8px 14px; border-radius:8px; border:1.5px solid ${borde}; background:${fondo}; color:${color}; font-weight:800; font-size:12px; cursor:pointer;`;
  const chip = (fondo, color, texto) => `<span style="flex:none; font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px; background:${fondo}; color:${color};">${texto}</span>`;

  function estadoChip(f) {
    if (f.estado === 'REVOCADA') return chip('#fee2e2', '#b91c1c', 'Revocada');
    if (f.vencida) return chip('#f1f5f9', '#475569', 'Vencida');
    if (!f.vigente) return chip('#fef3c7', '#92400e', 'Desde ' + fechaCorta(f.desde));
    const quedan = Math.round((new Date(f.hasta + 'T12:00:00') - new Date(st.datos.hoy + 'T12:00:00')) / 86400000);
    return quedan <= 7 ? chip('#fef3c7', '#92400e', quedan === 0 ? 'Vence hoy' : `Vence en ${quedan} d`) : chip('#dcfce7', '#166534', 'Vigente');
  }

  function tarjeta(f) {
    const activa = f.estado === 'ACTIVA';
    return `<article style="border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin-bottom:10px; background:#fff; ${activa && !f.vencida ? '' : 'opacity:.75;'}">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="min-width:0;"><div style="font-weight:800; font-size:14px; color:#0f172a;">${esc(f.nombre)}</div>
          <div style="font-size:12px; color:#64748b; margin-top:2px;">${esc(f.empresa || '')}${f.tipoNombre ? ' · ' + esc(f.tipoNombre) : ''}${st.datos.admin ? ' · visita a ' + esc(f.anfitrion) : ''}</div></div>
        ${estadoChip(f)}
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:6px 14px; margin-top:10px; font-size:12.5px; color:#334155;">
        <span><i class="fas fa-calendar-days" style="color:#2563eb;"></i> ${fechaCorta(f.desde)} → ${fechaCorta(f.hasta)}</span>
        <span><i class="fas fa-repeat" style="color:#7c3aed;"></i> ${esc(FRECUENCIAS[f.frecuencia] || f.frecuencia)} · ${esc(f.diasTexto)}</span>
        <span><i class="fas fa-door-open" style="color:#059669;"></i> ${f.entradas ? `${f.entradas} ingreso${f.entradas === 1 ? '' : 's'} · último ${fechaCorta(String(f.ultimaEntrada || '').slice(0, 10))}` : 'Aún no ingresa'}</span>
        <span><i class="fas fa-qrcode" style="color:#0f172a;"></i> <code>${esc(codigoBonito(f.codigo))}</code>${f.whatsapp || f.email ? '' : ' · <span style="color:#b45309;">sin WhatsApp ni correo</span>'}</span>
      </div>
      ${f.motivo ? `<div style="font-size:12px; color:#64748b; margin-top:6px;">${esc(f.motivo)}</div>` : ''}
      ${f.estado === 'REVOCADA' ? `<div style="font-size:12px; color:#b91c1c; margin-top:6px;">Revocada por ${esc(f.revocadaPor || '')} el ${fechaCorta(String(f.revocadaEn || '').slice(0, 10))}${f.motivoRevocacion ? ': ' + esc(f.motivoRevocacion) : ''}</div>` : ''}
      ${activa ? `<div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:12px;">
        <button type="button" data-a="revocar" data-id="${f.id}" style="${boton('#fef2f2', '#b91c1c', '#fecaca')}">Revocar</button>
        <button type="button" data-a="renovar" data-id="${f.id}" style="${boton('#fff', '#334155', '#cbd5e1')}"><i class="fas fa-calendar-plus"></i> Renovar</button>
        ${!f.vencida && (f.whatsapp || f.email) ? `<button type="button" data-a="reenviar" data-id="${f.id}" style="${boton('#fff', '#166534', '#bbf7d0')}"><i class="fab fa-whatsapp"></i> Reenviar</button>` : ''}
        ${!f.vencida ? `<button type="button" data-a="qr" data-id="${f.id}" style="${boton('#0f172a', '#fff')}"><i class="fas fa-qrcode"></i> Ver QR</button>` : ''}
      </div>` : ''}
    </article>`;
  }

  function vistaLista() {
    const d = st.datos;
    const lista = d.frecuentes || [];
    const activas = lista.filter(f => f.estado === 'ACTIVA' && !f.vencida), otras = lista.filter(f => !(f.estado === 'ACTIVA' && !f.vencida));
    return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <p style="margin:0; font-size:12.5px; color:#475569; flex:1; min-width:220px;">Para quien viene <b>al menos una vez por semana</b>. Con su QR entra por portería sin invitación${d.admin ? '' : '; aquí ves a tus visitantes'}.</p>
        <button type="button" data-a="nueva" style="${boton('#2563eb', '#fff')}"><i class="fas fa-plus"></i> Nueva credencial</button></div>
      ${st.error ? `<p style="color:#b91c1c; font-size:13px; font-weight:600;">${esc(st.error)}</p>` : ''}
      ${activas.length ? activas.map(tarjeta).join('') : '<p style="text-align:center; color:#64748b; padding:20px 0;">No hay credenciales vigentes.</p>'}
      ${otras.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:12.5px; font-weight:700; color:#475569;">Vencidas o revocadas en los últimos 60 días (${otras.length})</summary>
        <div style="margin-top:8px;">${otras.map(tarjeta).join('')}</div></details>` : ''}`;
  }

  function vistaForm() {
    const d = st.datos, f = st.form, yo = supervisor();
    const tipos = (d.tipos || []);
    const sugerencias = (lista, attr) => lista.length ? `<div style="border:1px solid #cbd5e1; border-radius:8px; margin-top:4px; max-height:180px; overflow:auto; background:#fff;">${lista.map((x, i) =>
      `<button type="button" ${attr}="${i}" style="display:block; width:100%; text-align:left; padding:7px 10px; border:0; border-bottom:1px solid #f1f5f9; background:#fff; cursor:pointer; font-size:12.5px;">
        <b>${esc(x.nombre)}</b> <span style="color:#64748b;">${esc(x.empresa || x.area || '')}${x.fecha ? ' · ' + fechaCorta(x.fecha) : ''}</span></button>`).join('')}</div>` : '';
    return `<form data-crear novalidate>
      <div style="padding:10px 12px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe; margin-bottom:12px;">
        <label style="${etiqueta}"><i class="fas fa-magnifying-glass"></i> Copiar de una visita reciente <span style="text-transform:none; font-weight:500;">(opcional)</span></label>
        <input name="buscarReciente" autocomplete="off" placeholder="Escribe 3 letras del nombre o la empresa" value="${esc(f.buscarReciente || '')}" style="${estiloInput}">
        ${sugerencias(st.sugRec, 'data-rec')}
      </div>
      ${st.error ? `<p style="color:#b91c1c; font-size:13px; font-weight:600; margin:0 0 10px;">${esc(st.error)}</p>` : ''}
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;">
        <div><label style="${etiqueta}">Nombre y apellido</label><input name="nombre" maxlength="80" required value="${esc(f.nombre || '')}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Empresa</label><input name="empresa" maxlength="80" required placeholder='O "Particular"' value="${esc(f.empresa || '')}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Tipo de visita</label><select name="tipo" required style="${estiloInput}"><option value="">Elige…</option>
          ${tipos.map(t => `<option value="${esc(t.id)}" ${f.tipo === t.id ? 'selected' : ''}>${esc(t.nombre)}${t.epp ? ' (EPP)' : ''}</option>`).join('')}</select></div>
        <div><label style="${etiqueta}">Anfitrión</label>
          ${d.admin ? (f.anfitrionId ? `<div style="${estiloInput} display:flex; justify-content:space-between; gap:6px;"><b style="font-size:12.5px;">${esc(f.anfitrionNombre)}</b><button type="button" data-a="cambiarAnf" style="border:0; background:none; color:#2563eb; font-weight:700; cursor:pointer; font-size:12px;">Cambiar</button></div>`
            : `<input name="buscarAnf" autocomplete="off" placeholder="Busca por nombre (3 letras)" value="${esc(f.buscarAnf || '')}" style="${estiloInput}">${sugerencias(st.sugAnf, 'data-anf')}`)
            : `<div style="${estiloInput} background:#f8fafc;"><b style="font-size:12.5px;">${esc(yo.nombre || 'Tú')}</b> <span style="color:#64748b; font-size:11.5px;">(tú)</span></div>`}</div>
      </div>
      <div style="margin-top:10px;"><label style="${etiqueta}">Motivo de sus visitas</label><input name="motivo" maxlength="200" required placeholder="Ej.: entrega semanal de materiales" value="${esc(f.motivo || '')}" style="${estiloInput}"></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; margin-top:10px;">
        <div><label style="${etiqueta}">WhatsApp <span style="text-transform:none; font-weight:500;">(para enviarle el QR)</span></label><input name="whatsapp" type="tel" inputmode="tel" maxlength="16" placeholder="09XXXXXXXX" value="${esc(f.whatsapp || '')}" style="${estiloInput}"></div>
        <div><label style="${etiqueta}">Correo <span style="text-transform:none; font-weight:500;">(opcional)</span></label><input name="email" type="email" maxlength="120" value="${esc(f.email || '')}" style="${estiloInput}"></div>
      </div>
      <fieldset style="border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; margin:12px 0 0;">
        <legend style="font-size:12px; font-weight:800; color:#0f172a; padding:0 4px;">Vigencia y frecuencia</legend>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px;">
          <div><label style="${etiqueta}">Viene</label><select name="frecuencia" style="${estiloInput}">${Object.entries(FRECUENCIAS).map(([k, t]) => `<option value="${k}" ${f.frecuencia === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label style="${etiqueta}">Desde</label><input name="desde" type="date" min="${d.hoy}" value="${esc(f.desde)}" style="${estiloInput}"></div>
          <div><label style="${etiqueta}">Hasta</label><input name="hasta" type="date" min="${sumarDias(f.desde || d.hoy, 6)}" max="${sumarDias(f.desde || d.hoy, d.diasMax)}" value="${esc(f.hasta)}" style="${estiloInput}"></div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">${[[30, '1 mes'], [90, '3 meses'], [d.diasMax, d.diasMax === 180 ? '6 meses' : d.diasMax + ' días']].map(([n, t]) =>
          `<button type="button" data-plazo="${n}" style="${boton('#fff', '#1d4ed8', '#bfdbfe')} padding:4px 10px;">${t}</button>`).join('')}
          <span style="font-size:11.5px; color:#64748b; align-self:center;">Mínimo una semana, máximo ${d.diasMax} días; al vencer se renueva.</span></div>
        <div style="margin-top:10px;"><span style="${etiqueta}">Días permitidos <span style="text-transform:none; font-weight:500;">(ninguno marcado = cualquier día)</span></span>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">${DIAS.map(([n, t]) => `<label style="display:inline-flex; align-items:center; gap:4px; padding:5px 9px; border-radius:8px; border:1.5px solid #cbd5e1; font-size:12.5px; font-weight:700; cursor:pointer;">
            <input type="checkbox" name="dia" value="${n}" ${(f.dias || []).includes(String(n)) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      </fieldset>
      <label style="display:flex; gap:8px; align-items:flex-start; margin-top:12px; font-size:12.5px; color:#334155;">
        <input type="checkbox" name="aceptaPrivacidad" ${f.aceptaPrivacidad ? 'checked' : ''} style="margin-top:2px;">
        <span>El visitante conoce y acepta el aviso de privacidad de visitas: sus datos se usan solo para controlar su ingreso y se anonimizan al terminar la credencial.</span></label>
      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:14px;">
        <button type="button" data-a="volver" style="${boton('#fff', '#334155', '#cbd5e1')}">Cancelar</button>
        <button type="submit" ${st.enviando ? 'disabled' : ''} style="${boton('#059669', '#fff')}">${st.enviando ? '<i class="fas fa-spinner fa-spin"></i> Creando…' : '<i class="fas fa-id-card"></i> Crear credencial'}</button>
      </div></form>`;
  }

  function vistaQr() {
    const f = st.qr;
    return `<div style="text-align:center;">
      <div id="frecCredencial" style="display:inline-block; border:2px solid #0f172a; border-radius:14px; padding:14px 18px; background:#fff; max-width:300px;">
        <div style="font-size:11px; font-weight:800; letter-spacing:.08em; color:#2563eb;">TCONTROL · VISITANTE FRECUENTE</div>
        <img src="${imagenQr(f.codigo)}" alt="Código QR de la credencial" style="width:210px; height:210px; image-rendering:pixelated; margin:8px auto; display:block;">
        <div style="font-family:monospace; font-size:20px; font-weight:800; letter-spacing:3px;">${esc(codigoBonito(f.codigo))}</div>
        <div style="font-weight:800; font-size:15px; margin-top:6px;">${esc(f.nombre)}</div>
        <div style="font-size:12px; color:#475569;">${esc(f.empresa || '')}</div>
        <div style="font-size:12px; color:#475569; margin-top:6px;">Visita a ${esc(f.anfitrion)}<br>Vale del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)} · ${esc(f.diasTexto)}</div>
        <div style="font-size:10.5px; color:#64748b; margin-top:6px;">Presentar con documento de identidad${f.epp ? ' y EPP' : ''}.</div>
      </div>
      <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:12px;">
        <button type="button" data-a="volver" style="${boton('#fff', '#334155', '#cbd5e1')}">Volver</button>
        <button type="button" data-a="imprimir" style="${boton('#0f172a', '#fff')}"><i class="fas fa-print"></i> Imprimir</button></div></div>`;
  }

  function pintar() {
    const m = caja();
    let cuerpo;
    if (!st.ses) {
      cuerpo = `<form data-pin style="max-width:320px; margin:8px auto; text-align:center;">
        <p style="font-size:13px; color:#475569;"><i class="fas fa-lock"></i> Las credenciales tienen datos de los visitantes. Confirma tu contraseña.</p>
        <input name="pin" type="password" maxlength="40" required autocomplete="current-password" style="${estiloInput} text-align:center; font-size:16px;">
        ${st.error ? `<p style="color:#b91c1c; font-size:12.5px; font-weight:600;">${esc(st.error)}</p>` : ''}
        <button type="submit" ${st.enviando ? 'disabled' : ''} style="${boton('#0f172a', '#fff')} margin-top:10px; width:100%;">${st.enviando ? '<i class="fas fa-spinner fa-spin"></i> Verificando…' : 'Continuar'}</button></form>`;
    } else if (!st.datos) {
      cuerpo = st.error ? `<p style="color:#b91c1c; font-size:13px; font-weight:600;">${esc(st.error)}</p>` : '<p style="text-align:center; color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Cargando…</p>';
    } else {
      cuerpo = st.vista === 'form' ? vistaForm() : st.vista === 'qr' ? vistaQr() : vistaLista();
    }
    const foco = document.activeElement && m.contains(document.activeElement) ? document.activeElement.name : '';
    m.innerHTML = `<div style="background:#f8fafc; border-radius:14px; width:100%; max-width:680px; overflow:hidden; box-shadow:0 20px 25px -5px rgba(0,0,0,.3);">
      <div style="background:linear-gradient(135deg,#0f766e,#14b8a6); color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center;">
        <div><div style="font-weight:800; font-size:15px;"><i class="fas fa-id-card-clip"></i> Visitantes frecuentes</div>
          <div style="font-size:11.5px; opacity:.9;">Credencial con QR para ingresar por portería</div></div>
        <div style="display:flex; gap:6px;">${st.datos && st.vista === 'lista' ? `<button type="button" data-a="recargar" title="Actualizar" style="background:rgba(255,255,255,.15); border:0; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer;"><i class="fas fa-rotate"></i></button>` : ''}
          <button type="button" data-a="cerrar" aria-label="Cerrar" style="background:none; border:none; color:#fff; font-size:22px; cursor:pointer;">&times;</button></div>
      </div>
      <div style="padding:14px 16px;">${cuerpo}</div></div>`;
    const reenfocar = foco && m.querySelector(`[name="${foco}"]`);
    if (reenfocar) { reenfocar.focus(); if (reenfocar.setSelectionRange && reenfocar.type !== 'date' && reenfocar.type !== 'email') { const n = reenfocar.value.length; reenfocar.setSelectionRange(n, n); } }
    else m.querySelector('[data-pin] input')?.focus();
  }

  // ---------------------------------------------------------------- formulario
  function leerForm() {
    const fm = document.querySelector('#modalFrecuentes form[data-crear]');
    if (!fm) return;
    ['nombre', 'empresa', 'tipo', 'motivo', 'whatsapp', 'email', 'frecuencia', 'desde', 'hasta', 'buscarReciente', 'buscarAnf'].forEach(k => { if (fm[k]) st.form[k] = fm[k].value; });
    st.form.dias = [...fm.querySelectorAll('[name=dia]:checked')].map(x => x.value);
    st.form.aceptaPrivacidad = !!fm.aceptaPrivacidad?.checked;
  }
  function nuevaCredencial() {
    const yo = supervisor(), hoy = st.datos.hoy;
    st.form = { frecuencia: 'semanal', desde: hoy, hasta: sumarDias(hoy, 30), dias: [],
      anfitrionId: st.datos.admin ? String(yo.id || '') : '', anfitrionNombre: st.datos.admin ? String(yo.nombre || '') : '' };
    st.sugAnf = []; st.sugRec = []; st.error = ''; st.vista = 'form'; pintar();
  }
  let tBusca = null;
  function alEscribir(ev) {
    const n = ev.target.name;
    if (n !== 'buscarReciente' && n !== 'buscarAnf') { if (n === 'desde') { leerForm(); pintar(); } return; }
    clearTimeout(tBusca);
    tBusca = setTimeout(async () => {
      leerForm();
      const q = st.form[n] || '';
      if (q.trim().length < 3) { if (n === 'buscarAnf') st.sugAnf = []; else st.sugRec = []; return pintar(); }
      try {
        if (n === 'buscarAnf') st.sugAnf = (await llamar({ accion: 'anfitriones', q })).anfitriones || [];
        else st.sugRec = (await llamar({ accion: 'recientes', q })).visitas || [];
      } catch (e) { st.error = e.message; }
      pintar();
    }, 350);
  }

  async function crear() {
    leerForm();
    const f = st.form;
    if (st.datos.admin && !f.anfitrionId) { st.error = 'Elige al anfitrión de la lista.'; return pintar(); }
    if (!f.aceptaPrivacidad) { st.error = 'Confirma que el visitante aceptó el aviso de privacidad.'; return pintar(); }
    st.enviando = true; st.error = ''; pintar();
    try {
      const r = await llamar({ accion: 'crear', nombre: f.nombre, empresa: f.empresa, tipo: f.tipo, motivo: f.motivo, whatsapp: f.whatsapp, email: f.email,
        frecuencia: f.frecuencia, desde: f.desde, hasta: f.hasta, dias: f.dias, anfitrionId: f.anfitrionId, aceptaPrivacidad: 'true' });
      toast(r.enviada ? `Credencial creada; se le envía el QR a ${r.frecuente.nombre}` : 'Credencial creada. No tiene WhatsApp ni correo: muéstrale o imprime el QR.', 'success');
      st.enviando = false;
      await cargar();
      await libQr();
      st.qr = r.frecuente; st.vista = 'qr'; pintar();
    } catch (e) { st.enviando = false; st.error = e.message; pintar(); }
  }

  function imprimir() {
    const html = document.getElementById('frecCredencial')?.outerHTML;
    if (!html) return;
    const w = window.open('', '_blank', 'width=420,height=620');
    if (!w) return toast('El navegador bloqueó la ventana de impresión', 'warning');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Credencial de visitante</title></head>
      <body style="font-family:Arial,sans-serif; display:flex; justify-content:center; padding:20px;">${html}
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };<\/script></body></html>`);
    w.document.close();
  }

  async function accion(a, id) {
    const f = (st.datos.frecuentes || []).find(x => String(x.id) === String(id));
    if (!f) return;
    try {
      if (a === 'qr') {
        if (!await libQr()) return toast('No se pudo cargar el generador de QR (revisa la conexión)', 'error');
        st.qr = f; st.vista = 'qr'; return pintar();
      }
      if (a === 'reenviar') { await llamar({ accion: 'reenviar', id }); return toast(`Se reenvía la credencial a ${f.nombre}`, 'success'); }
      if (a === 'renovar') {
        const base = f.hasta > st.datos.hoy ? f.hasta : st.datos.hoy;
        const hasta = prompt(`Renovar la credencial de ${f.nombre}.\nNueva fecha de vencimiento (AAAA-MM-DD), hasta ${st.datos.diasMax} días desde hoy:`, sumarDias(base, 30));
        if (hasta === null) return;
        await llamar({ accion: 'renovar', id, hasta: hasta.trim() });
        toast('Credencial renovada' + (f.whatsapp || f.email ? '; se le envía de nuevo el QR' : ''), 'success');
      }
      if (a === 'revocar') {
        const motivo = prompt(`¿Revocar la credencial de ${f.nombre}? Ya no podrá ingresar con su QR.${f.whatsapp || f.email ? ' Se le avisará.' : ''}\nMotivo (opcional):`, '');
        if (motivo === null) return;
        await llamar({ accion: 'revocar', id, motivo });
        toast('Credencial revocada', 'success');
      }
      await cargar();
    } catch (e) { st.error = e.message; pintar(); }
  }

  // ---------------------------------------------------------------- eventos
  async function alEnviar(ev) {
    ev.preventDefault();
    const fm = ev.target;
    if (fm.matches('[data-pin]')) {
      if (st.enviando) return;
      st.error = ''; st.enviando = true; pintar();
      try {
        const id = String(supervisor().id || '');
        const r = await window.FirebaseBackend._post({ accion: 'tokenEvaluacion', empleadoId: id, pin: fm.pin.value });
        if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'No se pudo verificar tu contraseña.');
        st.ses = { token: r.token, exp: r.exp };
        st.enviando = false;
        await cargar();
      } catch (e) { st.enviando = false; st.error = e.message; pintar(); }
    }
    if (fm.matches('[data-crear]') && !st.enviando) crear();
  }

  function alClic(ev) {
    const plazo = ev.target.closest('[data-plazo]');
    if (plazo) { leerForm(); st.form.hasta = sumarDias(st.form.desde || st.datos.hoy, Number(plazo.dataset.plazo)); return pintar(); }
    const anf = ev.target.closest('[data-anf]');
    if (anf) { leerForm(); const x = st.sugAnf[+anf.dataset.anf]; st.form.anfitrionId = x.id; st.form.anfitrionNombre = x.nombre; st.sugAnf = []; return pintar(); }
    const rec = ev.target.closest('[data-rec]');
    if (rec) {
      leerForm();
      const x = st.sugRec[+rec.dataset.rec];
      Object.assign(st.form, { nombre: x.nombre || '', empresa: x.empresa || '', motivo: x.motivo || '', whatsapp: x.whatsapp || '', email: x.email || '',
        tipo: x.tipo || st.form.tipo, buscarReciente: '' });
      if (st.datos.admin && x.anfitrionId) { st.form.anfitrionId = x.anfitrionId; st.form.anfitrionNombre = x.anfitrionNombre || x.anfitrionId; }
      st.sugRec = []; return pintar();
    }
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, id } = b.dataset;
    if (a === 'cerrar') return cerrar();
    if (a === 'recargar') return cargar();
    if (a === 'nueva') return nuevaCredencial();
    if (a === 'volver') { st.vista = 'lista'; st.error = ''; return pintar(); }
    if (a === 'cambiarAnf') { leerForm(); st.form.anfitrionId = ''; st.form.anfitrionNombre = ''; return pintar(); }
    if (a === 'imprimir') return imprimir();
    accion(a, id);
  }

  // Siempre pide la contraseña al abrir (no reutiliza sesiones anteriores)
  window.abrirVisitantesFrecuentes = function () {
    if (!supervisor().id) return toast('Inicia sesión en el panel', 'warning');
    Object.assign(st, { ses: null, datos: null, error: '', vista: 'lista', form: {}, qr: null, enviando: false });
    pintar();
  };
})();
