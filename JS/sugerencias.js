/**
 * TCONTROL · Comentarios, sugerencias e ideas de funcionalidades (2026-11-19)
 * Compartido por index.html (app → Más → Sugerencias) y supervisor.html (panel → Sugerencias).
 *
 * Datos (Firestore): sugerencias/{auto}
 *   empleadoId, nombre, area, tipo (COMENTARIO|SUGERENCIA|IDEA), modulo, texto,
 *   estado (NUEVA|EN_REVISION|PLANIFICADA|IMPLEMENTADA|DESCARTADA), respuesta, respondido_por, respondido_en,
 *   creado_en (ISO), creado_ms
 * Cada persona ve solo lo suyo; los gestores ven todo y responden (reglas en firestore.rules).
 *
 * Uso: Sugerencias.montarApp(contenedor, { empleado: {id, nombre, area} })
 *      Sugerencias.montarPanel(contenedor, { usuario: {id, nombre}, onNuevas })
 *      Sugerencias.contarNuevas() → Promise<número>
 */
(function () {
  'use strict';

  const COL = 'sugerencias';
  const MAX_TEXTO = 1000;
  const TIPOS = {
    COMENTARIO: { label: 'Comentario', icono: 'fa-comment-dots', ayuda: 'Algo que quieres decirnos sobre la app.' },
    SUGERENCIA: { label: 'Sugerencia', icono: 'fa-lightbulb', ayuda: 'Algo que se podría mejorar o cambiar.' },
    IDEA: { label: 'Idea de funcionalidad', icono: 'fa-wand-magic-sparkles', ayuda: 'Una función nueva que te gustaría tener.' }
  };
  const ESTADOS = {
    NUEVA: { label: 'Recibida', cls: 'sg-e-nueva' },
    EN_REVISION: { label: 'En revisión', cls: 'sg-e-rev' },
    PLANIFICADA: { label: 'Planificada', cls: 'sg-e-plan' },
    IMPLEMENTADA: { label: 'Implementada', cls: 'sg-e-ok' },
    DESCARTADA: { label: 'No se hará', cls: 'sg-e-no' }
  };
  const MODULOS = ['General', 'Marcación', 'Almuerzo', 'Permisos y vacaciones', 'Resumen y pagos', 'Visitas', 'Desempeño', 'EPP', 'Otro'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const db = () => window.firebase.firestore();
  const nombreCorto = n => String(n || '').split(/\s+/).slice(0, 3).join(' ');
  const fechaHora = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const chipEstado = e => { const x = ESTADOS[e] || ESTADOS.NUEVA; return `<span class="sg-estado ${x.cls}">${x.label}</span>`; };
  const chipTipo = t => { const x = TIPOS[t] || TIPOS.COMENTARIO; return `<span class="sg-tipo"><i class="fas ${x.icono}"></i> ${x.label}</span>`; };
  const porFechaDesc = (a, b) => (b.creado_ms || 0) - (a.creado_ms || 0);

  async function esperarSesion(id) {
    // La sesión de Firebase Auth la abre sesion_firebase.js; sin ella las reglas rechazan la lectura y escritura.
    try { if (id && window.SesionFirebase) await window.SesionFirebase.asegurar(String(id), { motivo: 'enviar tu mensaje' }); } catch (e) { }
  }

  async function enviar(emp, datos) {
    const texto = String(datos.texto || '').trim();
    if (texto.length < 10) throw new Error('Cuéntanos un poco más (mínimo 10 caracteres).');
    if (texto.length > MAX_TEXTO) throw new Error(`Máximo ${MAX_TEXTO} caracteres.`);
    if (!TIPOS[datos.tipo]) throw new Error('Elige qué quieres enviar.');
    const ahora = new Date();
    const doc = {
      empleadoId: String(emp.id), nombre: String(emp.nombre || ''), area: String(emp.area || ''),
      tipo: datos.tipo, modulo: MODULOS.includes(datos.modulo) ? datos.modulo : 'General', texto,
      estado: 'NUEVA', respuesta: '', respondido_por: '', respondido_en: '',
      creado_en: ahora.toISOString(), creado_ms: ahora.getTime()
    };
    await esperarSesion(emp.id);
    const ref = await db().collection(COL).add(doc);
    return Object.assign({ _id: ref.id }, doc);
  }

  async function responder(id, estado, respuesta, usuario) {
    if (!ESTADOS[estado]) throw new Error('Estado no válido');
    await db().collection(COL).doc(id).update({
      estado, respuesta: String(respuesta || '').trim().slice(0, MAX_TEXTO),
      respondido_por: nombreCorto(usuario && usuario.nombre) || String(usuario && usuario.id || ''),
      respondido_en: new Date().toISOString()
    });
  }

  async function contarNuevas() {
    try {
      const s = await db().collection(COL).where('estado', '==', 'NUEVA').get();
      return s.size;
    } catch (e) { return 0; }
  }

  // ------------------------------------------------------------------ app (colaborador)
  function montarApp(cont, ctx) {
    const emp = ctx.empleado;
    let tipo = 'SUGERENCIA';
    let mias = [];
    let cargando = true, errorLista = '';

    function pintar() {
      cont.innerHTML = `
      <div class="sg-app">
        <div class="sg-hero">
          <h2><i class="fas fa-comments"></i> Comentarios e ideas</h2>
          <p>Tu opinión mejora la app. Léelo todo el equipo de sistemas y te respondemos aquí mismo.</p>
        </div>
        <form class="sg-form" id="sgForm" novalidate>
          <div class="sg-tipos" role="radiogroup" aria-label="Qué quieres enviar">
            ${Object.keys(TIPOS).map(k => `
              <button type="button" role="radio" aria-checked="${k === tipo}" data-tipo="${k}" class="${k === tipo ? 'sg-on' : ''}">
                <i class="fas ${TIPOS[k].icono}"></i><span>${TIPOS[k].label}</span>
              </button>`).join('')}
          </div>
          <p class="sg-ayuda" id="sgAyuda">${esc(TIPOS[tipo].ayuda)}</p>
          <label class="sg-lbl" for="sgModulo">¿Sobre qué parte de la app?</label>
          <select id="sgModulo" class="sg-campo">${MODULOS.map(m => `<option>${esc(m)}</option>`).join('')}</select>
          <label class="sg-lbl" for="sgTexto">Cuéntanos</label>
          <textarea id="sgTexto" class="sg-campo" rows="5" maxlength="${MAX_TEXTO}" placeholder="Escribe aquí con tus palabras…"></textarea>
          <div class="sg-contador"><span id="sgCuenta">0</span>/${MAX_TEXTO}</div>
          <div class="sg-error" id="sgError" role="alert" hidden></div>
          <button type="submit" class="sg-btn" id="sgEnviar"><i class="fas fa-paper-plane"></i> Enviar</button>
          <p class="sg-nota">Tu nombre y área van con el mensaje para poder responderte. No escribas contraseñas ni datos personales de otras personas.</p>
        </form>
        <h3 class="sg-h3">Mis envíos</h3>
        <div class="sg-lista" id="sgMias">${listaMias()}</div>
      </div>`;
      enlazar();
    }

    function listaMias() {
      if (cargando) return '<div class="sg-vacio">Cargando…</div>';
      if (errorLista) return `<div class="sg-vacio">${esc(errorLista)}</div>`;
      if (!mias.length) return '<div class="sg-vacio">Aún no has enviado nada. ¡Anímate!</div>';
      return mias.map(s => `
        <article class="sg-tarjeta">
          <div class="sg-cab">${chipTipo(s.tipo)}${chipEstado(s.estado)}</div>
          <div class="sg-meta">${esc(s.modulo || 'General')} · ${esc(fechaHora(s.creado_en))}</div>
          <p class="sg-texto">${esc(s.texto)}</p>
          ${s.respuesta ? `<div class="sg-resp"><strong><i class="fas fa-reply"></i> Respuesta${s.respondido_por ? ' de ' + esc(s.respondido_por) : ''}</strong><p>${esc(s.respuesta)}</p></div>` : ''}
        </article>`).join('');
    }

    function enlazar() {
      const form = cont.querySelector('#sgForm');
      const txt = cont.querySelector('#sgTexto');
      const err = cont.querySelector('#sgError');
      cont.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
        tipo = b.dataset.tipo;
        cont.querySelectorAll('[data-tipo]').forEach(x => { const on = x === b; x.classList.toggle('sg-on', on); x.setAttribute('aria-checked', on); });
        cont.querySelector('#sgAyuda').textContent = TIPOS[tipo].ayuda;
      }));
      txt.addEventListener('input', () => { cont.querySelector('#sgCuenta').textContent = txt.value.length; });
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const btn = cont.querySelector('#sgEnviar');
        err.hidden = true;
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
        try {
          const nuevo = await enviar(emp, { tipo, modulo: cont.querySelector('#sgModulo').value, texto: txt.value });
          mias.unshift(nuevo);
          txt.value = '';
          cont.querySelector('#sgCuenta').textContent = '0';
          cont.querySelector('#sgMias').innerHTML = listaMias();
          if (typeof window.showToast === 'function') window.showToast('¡Gracias! Recibimos tu mensaje.', 'success');
          else alert('¡Gracias! Recibimos tu mensaje.');
        } catch (e) {
          const permiso = e && (e.code === 'permission-denied');
          err.textContent = permiso ? 'No se pudo enviar: vuelve a iniciar sesión e inténtalo de nuevo.' : (e.message || 'No se pudo enviar. Inténtalo de nuevo.');
          err.hidden = false;
        } finally {
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
        }
      });
    }

    async function cargar() {
      try {
        await esperarSesion(emp.id);
        const s = await db().collection(COL).where('empleadoId', '==', String(emp.id)).get();
        mias = s.docs.map(d => Object.assign({ _id: d.id }, d.data())).sort(porFechaDesc);
        errorLista = '';
      } catch (e) {
        errorLista = 'No se pudieron cargar tus envíos ahora.';
      }
      cargando = false;
      const l = cont.querySelector('#sgMias');
      if (l) l.innerHTML = listaMias();
    }

    pintar();
    cargar();
  }

  // ------------------------------------------------------------------ panel (supervisores)
  function montarPanel(cont, ctx) {
    const usuario = ctx.usuario || {};
    let todas = [], filtroEstado = 'ABIERTAS', filtroTipo = '', error = '';

    const visibles = () => todas.filter(s => {
      if (filtroTipo && s.tipo !== filtroTipo) return false;
      if (filtroEstado === 'ABIERTAS') return ['NUEVA', 'EN_REVISION'].includes(s.estado);
      if (filtroEstado === 'TODAS') return true;
      return s.estado === filtroEstado;
    });

    function tarjeta(s) {
      return `
      <article class="sg-tarjeta" data-id="${esc(s._id)}">
        <div class="sg-cab">${chipTipo(s.tipo)}${chipEstado(s.estado)}</div>
        <div class="sg-meta"><strong>${esc(nombreCorto(s.nombre))}</strong> · ID ${esc(s.empleadoId)} · ${esc(s.area || 'Sin área')} · ${esc(s.modulo || 'General')} · ${esc(fechaHora(s.creado_en))}</div>
        <p class="sg-texto">${esc(s.texto)}</p>
        <div class="sg-resp-form">
          <textarea class="sg-campo" rows="2" maxlength="${MAX_TEXTO}" placeholder="Respuesta para el colaborador (opcional)">${esc(s.respuesta || '')}</textarea>
          <div class="sg-acciones">
            <select class="sg-campo sg-sel-estado">${Object.keys(ESTADOS).map(k => `<option value="${k}"${k === s.estado ? ' selected' : ''}>${ESTADOS[k].label}</option>`).join('')}</select>
            <button type="button" class="sg-btn sg-guardar"><i class="fas fa-check"></i> Guardar</button>
          </div>
          ${s.respondido_por ? `<div class="sg-meta">Última respuesta: ${esc(s.respondido_por)} · ${esc(fechaHora(s.respondido_en))}</div>` : ''}
        </div>
      </article>`;
    }

    function pintar() {
      const lista = visibles();
      const nuevas = todas.filter(s => s.estado === 'NUEVA').length;
      cont.innerHTML = `
      <div class="sg-panel">
        <div class="sg-filtros">
          <select id="sgFEstado" class="sg-campo">
            <option value="ABIERTAS">Abiertas (recibidas y en revisión)</option>
            <option value="TODAS">Todas</option>
            ${Object.keys(ESTADOS).map(k => `<option value="${k}">${ESTADOS[k].label}</option>`).join('')}
          </select>
          <select id="sgFTipo" class="sg-campo">
            <option value="">Todos los tipos</option>
            ${Object.keys(TIPOS).map(k => `<option value="${k}">${TIPOS[k].label}</option>`).join('')}
          </select>
          <button type="button" class="sg-btn sg-btn-sec" id="sgRecargar"><i class="fas fa-rotate"></i> Actualizar</button>
        </div>
        <div class="sg-resumen">${todas.length} en total · ${nuevas} sin atender</div>
        ${error ? `<div class="sg-error">${esc(error)}</div>` : ''}
        <div class="sg-lista">${lista.length ? lista.map(tarjeta).join('') : '<div class="sg-vacio">No hay mensajes con este filtro.</div>'}</div>
      </div>`;
      cont.querySelector('#sgFEstado').value = filtroEstado;
      cont.querySelector('#sgFTipo').value = filtroTipo;
      cont.querySelector('#sgFEstado').addEventListener('change', e => { filtroEstado = e.target.value; pintar(); });
      cont.querySelector('#sgFTipo').addEventListener('change', e => { filtroTipo = e.target.value; pintar(); });
      cont.querySelector('#sgRecargar').addEventListener('click', cargar);
      cont.querySelectorAll('.sg-guardar').forEach(b => b.addEventListener('click', async () => {
        const art = b.closest('.sg-tarjeta');
        const id = art.dataset.id;
        const estado = art.querySelector('.sg-sel-estado').value;
        const resp = art.querySelector('textarea').value;
        b.disabled = true;
        try {
          await responder(id, estado, resp, usuario);
          const s = todas.find(x => x._id === id);
          if (s) Object.assign(s, { estado, respuesta: resp.trim(), respondido_por: nombreCorto(usuario.nombre) || usuario.id, respondido_en: new Date().toISOString() });
          if (typeof ctx.onNuevas === 'function') ctx.onNuevas(todas.filter(x => x.estado === 'NUEVA').length);
          pintar();
        } catch (e) {
          b.disabled = false;
          alert('No se pudo guardar: ' + (e.message || e));
        }
      }));
    }

    async function cargar() {
      cont.innerHTML = '<div class="sg-vacio">Cargando…</div>';
      try {
        const s = await db().collection(COL).get();
        todas = s.docs.map(d => Object.assign({ _id: d.id }, d.data())).sort(porFechaDesc);
        error = '';
      } catch (e) {
        error = 'No se pudieron cargar los mensajes (' + (e.code || e.message || 'error') + ').';
      }
      if (typeof ctx.onNuevas === 'function') ctx.onNuevas(todas.filter(x => x.estado === 'NUEVA').length);
      pintar();
    }

    cargar();
  }

  window.Sugerencias = { montarApp, montarPanel, contarNuevas, enviar, responder };
})();
