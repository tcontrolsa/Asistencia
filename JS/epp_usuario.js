// Módulo EPP: página del colaborador (epp.html)
// Pedir EPP se hace por etapas: 1) tu trabajo (solo si tienes más de uno) → 2) qué necesitas → 3) talla y cantidad → 4) enviar.
(() => {
  const D = window.EppDatos;
  const app = document.getElementById('eppApp');
  const KEY_ID = 'EPP_DEMO_USUARIO';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = iso => new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
  const leerLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? def; } catch (e) { return def; } };
  const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const LS = { tallas: id => `EPP_TALLAS_${id}`, puestos: id => `EPP_PUESTOS_${id}` };

  const ESTADOS = {
    PENDIENTE: ['En revisión', 'info', 'fa-clock'],
    PREPARADA: ['Lista para retirar', 'ok', 'fa-box-open'],
    ENTREGADA: ['Falta tu firma', 'alerta', 'fa-signature'],
    CONFIRMADA: ['Recibida', 'neutro', 'fa-circle-check'],
    RECHAZADA: ['No aprobada', 'error', 'fa-circle-xmark'],
    CANCELADA: ['Cancelada', 'neutro', 'fa-ban']
  };
  const VIGENCIAS = {
    VIGENTE: ['Vigente', 'ok'],
    POR_VENCER: ['Por vencer', 'alerta'],
    VENCIDO: ['Toca reponer', 'error'],
    USO_DIARIO: ['Uso diario', 'neutro']
  };

  const st = {
    vista: 'mis', w: null, mis: [], mias: [],
    usuario: (() => { try { return localStorage.getItem(KEY_ID) || 'D01'; } catch (e) { return 'D01'; } })()
  };

  function aviso(texto, tipo = 'ok') {
    document.querySelectorAll('.epp-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = `epp-toast ${tipo}`;
    t.setAttribute('role', 'status');
    t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  async function intentar(fn, exito) {
    try { await fn(); if (exito) aviso(exito); } catch (e) { aviso(e.message || 'No se pudo completar', 'error'); }
    pintar();
  }

  // ---------------------------------------------------------------- Mis EPP
  function vistaMis(lista) {
    if (!lista.length) return `<div class="epp-vacio"><i class="fas fa-hard-hat"></i><b>Aún no tienes EPP entregados</b><span>Cuando recibas tu equipo aparecerá aquí, con su fecha de reposición.</span><button class="epp-btn primario" data-a="pedir">Pedir EPP</button></div>`;
    const atencion = lista.filter(i => ['VENCIDO', 'POR_VENCER'].includes(i.estado)).length;
    return `${atencion ? `<div class="epp-banda alerta"><i class="fas fa-triangle-exclamation"></i> ${atencion === 1 ? '1 EPP necesita reposición' : `${atencion} EPP necesitan reposición`}</div>` : ''}
      <div class="epp-lista">${lista.map(i => {
        const e = D.eppDe(i.eppId), v = VIGENCIAS[i.estado];
        const repone = i.vence ? `Reposición: ${fecha(i.vence)}` : 'Se repone según el uso';
        return `<article class="epp-card">
          <span class="epp-ico"><i class="fas ${e.icono}"></i></span>
          <div class="epp-card-txt">
            <b>${esc(e.nombre)}</b>
            <small>${i.talla && i.talla !== 'Única' ? `Talla ${esc(i.talla)} · ` : ''}Entregado ${fecha(i.entregadaEn)}</small>
            <small>${repone}${i.confirmada ? '' : ' · <span class="epp-falta">Falta tu firma</span>'}</small>
          </div>
          <div class="epp-card-fin">
            <span class="epp-chip ${v[1]}">${v[0]}</span>
            ${['VENCIDO', 'POR_VENCER'].includes(i.estado) ? `<button class="epp-btn mini" data-a="reponer" data-epp="${esc(i.eppId)}">Pedir</button>` : ''}
          </div>
        </article>`;
      }).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Pedir EPP por etapas
  const puestosPlanos = () => D.puestosDe(st.usuario).flatMap(a => a.puestos.map(p => ({ ...p, area: a.nombre })));

  // EPP de los puestos elegidos, sin repetir; si está en varios queda la cadencia más corta
  function candidatos(w) {
    const mapa = new Map();
    puestosPlanos().filter(p => w.puestos.includes(p.id)).forEach(p => p.epp.forEach(e => {
      const c = mapa.get(e.eppId) || { eppId: e.eppId, tipo: 'Condicional', dias: e.dias, texto: e.texto, obs: '', puestos: [] };
      if (e.tipo === 'Obligatorio') c.tipo = 'Obligatorio';
      if (e.dias < c.dias) { c.dias = e.dias; c.texto = e.texto; }
      if (e.obs && !c.obs) c.obs = e.obs;
      c.puestos.push(p.nombre);
      mapa.set(e.eppId, c);
    }));
    const prioridad = c => {
      const { m, pend } = estadoDe(c);
      if (pend) return 9;
      const base = !m ? 2 : { VENCIDO: 0, POR_VENCER: 1, VIGENTE: 4, USO_DIARIO: 5 }[m.estado];
      return base + (c.tipo === 'Condicional' ? 0.5 : 0);
    };
    return [...mapa.values()].sort((a, b) => prioridad(a) - prioridad(b));
  }

  function estadoDe(c) {
    return {
      m: st.mis.find(x => x.eppId === c.eppId),
      pend: st.mias.some(s => ['PENDIENTE', 'PREPARADA'].includes(s.estado) && s.items.some(i => i.eppId === c.eppId))
    };
  }

  function etiqueta(c) {
    const { m, pend } = estadoDe(c);
    if (pend) return ['Ya lo pediste', 'info'];
    if (!m) return c.tipo === 'Obligatorio' ? ['Primera entrega', 'info'] : ['Según tu actividad', 'neutro'];
    if (m.estado === 'VENCIDO') return ['Toca reponer', 'error'];
    if (m.estado === 'POR_VENCER') return [`Reponer pronto · ${fecha(m.vence)}`, 'alerta'];
    if (m.estado === 'USO_DIARIO') return ['Uso diario', 'neutro'];
    return [`Vigente hasta ${fecha(m.vence)}`, 'ok'];
  }

  function agregar(w, c) {
    const e = D.eppDe(c.eppId), { m } = estadoDe(c);
    const guardada = leerLS(LS.tallas(st.usuario), {})[c.eppId] || (m && m.talla);
    w.sel[c.eppId] = {
      talla: e.tallas.includes(guardada) ? guardada : (e.tallas.length === 1 ? e.tallas[0] : ''),
      cant: 1, motivo: m ? 'Reposición por desgaste' : 'Primera entrega'
    };
  }

  function nuevoAsistente(pre) {
    const planos = puestosPlanos();
    const w = { paso: 2, puestos: [], sel: {}, comentario: '', pre: pre || null, lista: false, intento: false };
    if (planos.length === 1) w.puestos = [planos[0].id];
    else {
      w.puestos = pre ? planos.filter(p => p.epp.some(e => e.eppId === pre)).map(p => p.id)
        : leerLS(LS.puestos(st.usuario), []).filter(id => planos.some(p => p.id === id));
      if (!w.puestos.length) w.paso = 1;
    }
    return w;
  }

  // Al entrar a "qué necesitas" se marca lo que toca reponer, para que baste con confirmar
  function prepararSeleccion(w) {
    if (w.lista) return;
    w.sel = {};
    candidatos(w).forEach(c => {
      const { m, pend } = estadoDe(c);
      if (pend) return;
      if (c.eppId === w.pre || (m && ['VENCIDO', 'POR_VENCER'].includes(m.estado))) agregar(w, c);
    });
    w.lista = true;
  }

  const pasosDe = () => (puestosPlanos().length > 1 ? ['Tu trabajo', 'Qué necesitas', 'Talla y cantidad', 'Enviar'] : ['Qué necesitas', 'Talla y cantidad', 'Enviar']);

  function cabeceraPasos(w) {
    const nombres = pasosDe(), n = puestosPlanos().length > 1 ? w.paso : w.paso - 1;
    return `<div class="epp-pasos" role="progressbar" aria-valuemin="1" aria-valuemax="${nombres.length}" aria-valuenow="${n}">
      <div class="epp-pasos-barra">${nombres.map((_, i) => `<span class="${i < n ? 'hecho' : ''}"></span>`).join('')}</div>
      <small>Paso ${n} de ${nombres.length} · <b>${nombres[n - 1]}</b></small>
    </div>`;
  }

  function barra(w, textoSiguiente, deshabilitado) {
    const primero = w.paso === (puestosPlanos().length > 1 ? 1 : 2);
    return `<div class="epp-relleno"></div><div class="epp-carrito epp-barra">
      ${primero ? '' : '<button class="epp-btn" data-a="atras"><i class="fas fa-arrow-left"></i> Atrás</button>'}
      <button class="epp-btn primario" data-a="siguiente" ${deshabilitado ? 'disabled' : ''}>${textoSiguiente}</button>
    </div>`;
  }

  function pasoTrabajo(w) {
    const porArea = {};
    puestosPlanos().forEach(p => { (porArea[p.area] = porArea[p.area] || []).push(p); });
    return `<h1>¿Qué trabajo vas a hacer?</h1><p class="epp-ayuda">Según tu trabajo te mostramos los EPP que te tocan. Puedes marcar más de uno.</p>
      ${Object.entries(porArea).map(([area, lista]) => `<h2 class="epp-sub">${esc(area)}</h2>
        <div class="epp-opciones">${lista.map(p => `<button type="button" class="epp-opcion${w.puestos.includes(p.id) ? ' activo' : ''}" data-a="puesto" data-id="${esc(p.id)}" aria-pressed="${w.puestos.includes(p.id)}">
          <span class="epp-marca-chk"><i class="fas fa-check"></i></span>
          <span class="epp-opcion-txt"><b>${esc(p.nombre)}</b>${p.actividad ? `<small>${esc(p.actividad)}</small>` : ''}</span>
        </button>`).join('')}</div>`).join('')}
      ${barra(w, 'Siguiente', !w.puestos.length)}`;
  }

  function pasoElegir(w) {
    prepararSeleccion(w);
    const lista = candidatos(w), n = Object.keys(w.sel).length;
    const planos = puestosPlanos();
    const trabajo = planos.length > 1 ? `<p class="epp-perfil"><i class="fas fa-briefcase"></i> ${planos.filter(p => w.puestos.includes(p.id)).map(p => `<b>${esc(p.nombre)}</b>`).join(', ')} · <button class="epp-enlace" data-a="paso" data-p="1">Cambiar</button></p>` : '';
    return `<h1>¿Qué necesitas?</h1>${trabajo}
      <p class="epp-ayuda">Toca los EPP que quieres pedir. Ya marcamos los que te toca reponer.</p>
      <div class="epp-opciones">${lista.map(c => {
        const e = D.eppDe(c.eppId), [txt, tipo] = etiqueta(c), { pend } = estadoDe(c), activo = !!w.sel[c.eppId];
        return `<button type="button" class="epp-opcion${activo ? ' activo' : ''}${pend ? ' bloqueado' : ''}" data-a="toggle" data-epp="${esc(c.eppId)}" aria-pressed="${activo}" ${pend ? 'disabled' : ''}>
          <span class="epp-marca-chk"><i class="fas fa-check"></i></span>
          <span class="epp-ico mini"><i class="fas ${e.icono}"></i></span>
          <span class="epp-opcion-txt"><b>${esc(e.nombre)}</b>
            <small>${c.tipo === 'Condicional' ? `Solo si lo necesitas${c.obs ? `: ${esc(c.obs)}` : ''}` : `Se cambia cada ${esc(c.texto)}`}</small>
          </span>
          <span class="epp-chip ${tipo}">${esc(txt)}</span>
        </button>`;
      }).join('')}</div>
      ${barra(w, n ? `Siguiente (${n})` : 'Elige al menos uno', !n)}`;
  }

  function pasoDetalle(w) {
    const items = candidatos(w).filter(c => w.sel[c.eppId]);
    return `<h1>Talla y cantidad</h1><p class="epp-ayuda">Revisa cada artículo. Recordamos tu talla para la próxima vez.</p>
      <div class="epp-lista">${items.map(c => {
        const e = D.eppDe(c.eppId), s = w.sel[c.eppId], maxC = e.maxCant || 5;
        const falta = w.intento && !s.talla;
        return `<article class="epp-det${falta ? ' falta' : ''}" id="det-${esc(c.eppId)}">
          <header><span class="epp-ico mini"><i class="fas ${e.icono}"></i></span><b>${esc(e.nombre)}</b><button type="button" class="epp-quitar" data-a="toggle" data-epp="${esc(c.eppId)}" aria-label="Quitar ${esc(e.nombre)}"><i class="fas fa-xmark"></i></button></header>
          ${e.tallas.length > 1 ? `<div class="epp-fila"><span>Talla</span><div class="epp-chips">${e.tallas.map(t => `<button type="button" class="epp-chipbtn${s.talla === t ? ' activo' : ''}" data-a="talla" data-epp="${esc(c.eppId)}" data-t="${esc(t)}" aria-pressed="${s.talla === t}">${esc(t)}</button>`).join('')}</div></div>
          ${falta ? '<p class="epp-error">Elige tu talla.</p>' : ''}` : ''}
          <div class="epp-fila"><span>Cantidad</span><div class="epp-stepper">
            <button type="button" data-a="menos" data-epp="${esc(c.eppId)}" aria-label="Menos" ${s.cant <= 1 ? 'disabled' : ''}><i class="fas fa-minus"></i></button>
            <b aria-live="polite">${s.cant}</b>
            <button type="button" data-a="mas" data-epp="${esc(c.eppId)}" aria-label="Más" ${s.cant >= maxC ? 'disabled' : ''}><i class="fas fa-plus"></i></button>
          </div></div>
          <div class="epp-fila"><span>Motivo</span><div class="epp-chips">${D.MOTIVOS.map(m => `<button type="button" class="epp-chipbtn${s.motivo === m ? ' activo' : ''}" data-a="motivo" data-epp="${esc(c.eppId)}" data-m="${esc(m)}" aria-pressed="${s.motivo === m}">${esc(m)}</button>`).join('')}</div></div>
        </article>`;
      }).join('')}</div>
      ${barra(w, 'Siguiente', false)}`;
  }

  function pasoEnviar(w) {
    const items = candidatos(w).filter(c => w.sel[c.eppId]);
    const total = items.reduce((a, c) => a + w.sel[c.eppId].cant, 0);
    return `<h1>Revisa y envía</h1>
      <ul class="epp-resumen epp-resumen-caja">${items.map(c => {
        const e = D.eppDe(c.eppId), s = w.sel[c.eppId];
        return `<li><span class="epp-ico mini"><i class="fas ${e.icono}"></i></span><span class="epp-opcion-txt"><b>${s.cant} × ${esc(e.nombre)}</b>
          <small>${s.talla && s.talla !== 'Única' ? `Talla ${esc(s.talla)} · ` : ''}${esc(s.motivo)}</small></span></li>`;
      }).join('')}</ul>
      <label class="epp-etiqueta">Comentario para bodega (opcional)<textarea id="eppComentario" maxlength="300" rows="2" placeholder="Ej.: lo necesito para el lunes">${esc(w.comentario)}</textarea></label>
      <p class="epp-ayuda"><i class="fas fa-circle-info"></i> Bodega la revisa y te avisa aquí cuando esté lista para retirar.</p>
      ${barra(w, `<i class="fas fa-paper-plane"></i> Enviar solicitud (${total})`, false)}`;
  }

  function vistaPedir() {
    const planos = puestosPlanos();
    if (!planos.length) return `<div class="epp-vacio"><i class="fas fa-user-gear"></i><b>Todavía no tienes EPP asignado</b><span>Tu puesto aún no está en la matriz de EPP. Avisa a SSOMA o a bodega para que te asignen.</span></div>`;
    if (!st.w) st.w = nuevoAsistente();
    const w = st.w;
    const cuerpo = [null, pasoTrabajo, pasoElegir, pasoDetalle, pasoEnviar][w.paso](w);
    return `${cabeceraPasos(w)}${cuerpo}`;
  }

  function validarTallas(w) {
    const falta = Object.entries(w.sel).find(([id, s]) => !s.talla);
    if (!falta) return true;
    w.intento = true;
    pintar();
    setTimeout(() => document.getElementById(`det-${falta[0]}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
    return false;
  }

  function siguiente() {
    const w = st.w;
    if (w.paso === 1) {
      guardarLS(LS.puestos(st.usuario), w.puestos);
      w.lista = false; w.pre = null; w.paso = 2;
    } else if (w.paso === 2) {
      w.paso = 3; w.intento = false;
    } else if (w.paso === 3) {
      if (!validarTallas(w)) return;
      w.paso = 4;
    } else {
      const items = Object.entries(w.sel).map(([eppId, s]) => ({ eppId, talla: s.talla, cant: s.cant, motivo: s.motivo }));
      const tallas = leerLS(LS.tallas(st.usuario), {});
      items.forEach(i => { if (i.talla && i.talla !== 'Única') tallas[i.eppId] = i.talla; });
      guardarLS(LS.tallas(st.usuario), tallas);
      intentar(async () => {
        await D.crearSolicitud(st.usuario, items, w.comentario);
        st.w = null; st.vista = 'sol';
      }, 'Solicitud enviada');
      return;
    }
    pintar();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- Solicitudes
  function vistaSolicitudes(lista) {
    if (!lista.length) return `<div class="epp-vacio"><i class="fas fa-clipboard-list"></i><b>No tienes solicitudes</b><span>Aquí verás el avance de lo que pidas.</span></div>`;
    return `<div class="epp-lista">${lista.map(s => {
      const e = ESTADOS[s.estado];
      return `<article class="epp-sol">
        <header><b>${esc(s.id)}</b><span class="epp-chip ${e[1]}"><i class="fas ${e[2]}"></i> ${e[0]}</span></header>
        <ul>${s.items.map(i => `<li>${i.cant} × ${esc(D.eppDe(i.eppId).nombre)} <small>${i.talla && i.talla !== 'Única' ? `Talla ${esc(i.talla)} · ` : ''}${esc(i.motivo)}</small></li>`).join('')}</ul>
        <footer>
          <small>Pedida ${fecha(s.creada)}${s.entregadaEn ? ` · Entregada ${fecha(s.entregadaEn)}` : ''}</small>
          ${s.motivoRechazo ? `<p class="epp-nota error">Motivo: ${esc(s.motivoRechazo)}</p>` : ''}
          ${s.estado === 'PREPARADA' ? '<p class="epp-nota">Retíralo en bodega.</p>' : ''}
          <div class="epp-acciones">
            ${s.estado === 'PENDIENTE' ? `<button class="epp-btn" data-a="cancelar" data-id="${esc(s.id)}">Cancelar</button>` : ''}
            ${s.estado === 'ENTREGADA' ? `<button class="epp-btn primario" data-a="firmar" data-id="${esc(s.id)}"><i class="fas fa-signature"></i> Recibí</button>` : ''}
          </div>
        </footer>
      </article>`;
    }).join('')}</div>`;
  }

  async function pintar() {
    const db = await D.datos();
    const yo = D.colaborador(st.usuario);
    const mias = db.solicitudes.filter(s => s.empleadoId === yo.id).sort((a, b) => b.creada.localeCompare(a.creada));
    const mis = await D.misEpp(yo.id);
    st.mis = mis; st.mias = mias;
    const porFirmar = mias.filter(s => s.estado === 'ENTREGADA');
    const porConfirmar = porFirmar.length;
    const enCurso = st.w ? Object.keys(st.w.sel).length : 0;
    const cuerpo = st.vista === 'mis' ? `<h1>Mis EPP</h1>${vistaMis(mis)}` : st.vista === 'pedir' ? vistaPedir() : `<h1>Mis solicitudes</h1>${vistaSolicitudes(mias)}`;
    const tab = (v, ico, txt, n) => `<button class="${st.vista === v ? 'activo' : ''}" data-a="vista" data-v="${v}" ${st.vista === v ? 'aria-current="page"' : ''}><i class="fas ${ico}"></i><span>${txt}</span>${n ? `<em>${n}</em>` : ''}</button>`;
    const antes = document.getElementById('eppComentario');
    const foco = antes && document.activeElement === antes;
    app.innerHTML = `
      ${D.demo ? `<div class="epp-demo"><i class="fas fa-flask"></i> Demostración
        <select id="eppUsuario" aria-label="Colaborador de prueba">${D.COLABORADORES.map(c => `<option value="${c.id}" ${c.id === yo.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      </div>` : ''}
      <header class="epp-cab">
        <span class="epp-avatar">${esc(yo.nombre.charAt(0))}</span>
        <div><b>${esc(yo.nombre)}</b><small>${esc(yo.cargo)} · ${esc(yo.area)}</small></div>
        <a class="epp-guia" href="guias/epp/guia-epp.html#colaborador" target="_blank" rel="noopener" aria-label="Guía de uso" title="Guía de uso"><i class="fas fa-circle-question"></i></a>
        ${D.demo ? '' : '<button class="epp-salir" data-a="salir" aria-label="Salir"><i class="fas fa-right-from-bracket"></i></button>'}
      </header>
      ${porConfirmar ? `<button class="epp-aviso-firma" data-a="firmar" data-id="${esc(porFirmar[0].id)}"><i class="fas fa-signature"></i><span>${porConfirmar === 1 ? 'Tienes 1 entrega por firmar' : `Tienes ${porConfirmar} entregas por firmar`}</span><b>Firmar</b></button>` : ''}
      <main class="epp-main">${cuerpo}</main>
      <nav class="epp-nav" aria-label="Secciones">
        ${tab('mis', 'fa-hard-hat', 'Mis EPP')}${tab('pedir', 'fa-plus', 'Pedir', enCurso)}${tab('sol', 'fa-clipboard-list', 'Solicitudes', porConfirmar)}
      </nav>`;
    if (foco) document.getElementById('eppComentario')?.focus();
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

  async function firmar(id) {
    const s = (await D.datos()).solicitudes.find(x => x.id === id);
    if (!s) return;
    let firma;
    const d = dialogo(`<form method="dialog">
      <h2>Confirmar lo que recibiste</h2>
      <ul class="epp-resumen">${s.items.map(i => `<li><span>${i.cant} × ${esc(D.eppDe(i.eppId).nombre)}<small>${i.talla && i.talla !== 'Única' ? `Talla ${esc(i.talla)} · ` : ''}Entregado ${fecha(s.entregadaEn)}</small></span></li>`).join('')}</ul>
      <p class="epp-legal">Recibí estos EPP en buen estado.</p>
      <div class="epp-firma"><canvas aria-label="Recuadro de firma"></canvas><button type="button" class="epp-btn mini" data-limpiar>Borrar</button></div>
      <p class="epp-error" hidden>Firma en el recuadro para continuar.</p>
      <div class="epp-acciones"><button class="epp-btn" value="no" formnovalidate>Ahora no</button><button class="epp-btn primario" value="si">Recibí</button></div>
    </form>`, (f, valor) => {
      if (valor === 'si') intentar(() => D.confirmar(id, st.usuario, firma.imagen()), 'Recepción firmada');
    }, (f, valor) => {
      if (valor !== 'si' || !firma.vacia()) return true;
      f.querySelector('.epp-error').hidden = false;
      return false;
    });
    firma = window.EppFirma.montar(d.querySelector('canvas'));
    d.querySelector('[data-limpiar]').addEventListener('click', () => firma.limpiar());
  }

  app.addEventListener('click', ev => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, v, epp, id, p, t, m } = b.dataset, w = st.w;
    if (a === 'vista') { st.vista = v; pintar(); window.scrollTo(0, 0); }
    if (a === 'pedir') { st.w = nuevoAsistente(); st.vista = 'pedir'; pintar(); window.scrollTo(0, 0); }
    if (a === 'reponer') { st.w = nuevoAsistente(epp); st.vista = 'pedir'; pintar(); window.scrollTo(0, 0); }
    if (a === 'puesto') {
      w.puestos = w.puestos.includes(id) ? w.puestos.filter(x => x !== id) : [...w.puestos, id];
      w.lista = false; pintar();
    }
    if (a === 'paso') { w.paso = Number(p); pintar(); window.scrollTo(0, 0); }
    if (a === 'toggle') {
      if (w.sel[epp]) delete w.sel[epp]; else agregar(w, { eppId: epp });
      if (w.paso === 3 && !Object.keys(w.sel).length) w.paso = 2;
      pintar();
    }
    if (a === 'talla') { w.sel[epp].talla = t; pintar(); }
    if (a === 'motivo') { w.sel[epp].motivo = m; pintar(); }
    if (a === 'mas') { w.sel[epp].cant = Math.min(D.eppDe(epp).maxCant || 5, w.sel[epp].cant + 1); pintar(); }
    if (a === 'menos') { w.sel[epp].cant = Math.max(1, w.sel[epp].cant - 1); pintar(); }
    if (a === 'siguiente') siguiente();
    if (a === 'atras') { w.paso = Math.max(puestosPlanos().length > 1 ? 1 : 2, w.paso - 1); pintar(); window.scrollTo(0, 0); }
    if (a === 'cancelar' && confirm(`¿Cancelar la solicitud ${id}?`)) intentar(() => D.cancelar(id, st.usuario), 'Solicitud cancelada');
    if (a === 'firmar') firmar(id);
    if (a === 'salir') D.salir();
  });
  app.addEventListener('input', ev => {
    if (ev.target.id === 'eppComentario' && st.w) st.w.comentario = ev.target.value;
  });
  app.addEventListener('change', ev => {
    if (ev.target.id !== 'eppUsuario') return;
    st.usuario = ev.target.value; st.w = null; st.vista = 'mis';
    try { localStorage.setItem(KEY_ID, st.usuario); } catch (e) { }
    pintar();
  });
  D.iniciar(app, 'colaborador').then(yo => {
    if (yo) st.usuario = yo.id;
    D.alCambiar(pintar);
    pintar();
  }).catch(e => console.warn('EPP:', e));
})();
