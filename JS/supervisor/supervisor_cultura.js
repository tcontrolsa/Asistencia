/**
 * Asistencia Tcontrol - Modulo Cultura Tcontrol
 * Extraido en Fase 2 de Modularizacion (Optimizacion de mantenibilidad)
 * Fecha: 2026-09-17
 */

// ============================================================
// ============================================================
// MÓDULO CULTURA TCONTROL — GESTIÓN DEL BANCO DE PREGUNTAS
// ============================================================
// ============================================================
window.PREGUNTAS_CULTURA_DEFAULT = [
  {
    id: 'proposito',
    tipo: 'PROPOSITO',
    pilar: 'Propósito',
    iconoPilar: '🎯',
    pregunta: '¿Cuál es el Propósito de Tcontrol?',
    pista: 'Recuerda: El propósito de Tcontrol es "Diseñar soluciones para el futuro".',
    opciones: [
      { letra: 'A', texto: 'Diseñar soluciones para el futuro', correcta: true },
      { letra: 'B', texto: 'Vender equipos eléctricos al menor costo', correcta: false },
      { letra: 'C', texto: 'Importar maquinaria industrial usada', correcta: false }
    ],
    activo: true
  },
  {
    id: 'mision',
    tipo: 'MISION',
    pilar: 'Misión',
    iconoPilar: '⚡',
    pregunta: '¿Cuál es la Misión principal de Tcontrol?',
    pista: 'Recuerda: La misión es "Brindar soluciones eléctricas confiables mediante diseño y fabricación de tableros, cuartos eléctricos y automatización con calidad, eficiencia y seguridad".',
    opciones: [
      { letra: 'A', texto: 'Comercializar herramientas manuales para construcción', correcta: false },
      { letra: 'B', texto: 'Brindar soluciones eléctricas confiables mediante el diseño y fabricación de tableros de control industrial, cuartos eléctricos y sistemas de automatización adaptados a cada cliente con calidad y seguridad', correcta: true },
      { letra: 'C', texto: 'Realizar únicamente instalaciones residenciales básicas', correcta: false }
    ],
    activo: true
  },
  {
    id: 'vision',
    tipo: 'VISION',
    pilar: 'Visión (2030)',
    iconoPilar: '🚀',
    pregunta: 'Para el año 2030, la Visión de Tcontrol es:',
    pista: 'Recuerda: La visión 2030 es "Ser referentes nacionales en soluciones electromecánicas de calidad (>95% satisfacción), con certificaciones internacionales y expansión a al menos 2 países".',
    opciones: [
      { letra: 'A', texto: 'Ser referentes nacionales como proveedores de soluciones electromecánicas de calidad (>95% satisfacción), certificaciones internacionales y expandir operaciones a 2 países de la región', correcta: true },
      { letra: 'B', texto: 'Cambiar el modelo de negocio al comercio minorista', correcta: false },
      { letra: 'C', texto: 'Reducir las operaciones a una sola ciudad local', correcta: false }
    ],
    activo: true
  },
  {
    id: 'valores_calidad',
    tipo: 'VALORES',
    pilar: 'Valores y Calidad',
    iconoPilar: '🛡️',
    pregunta: '¿Cuáles son los principios fundamentales de calidad y seguridad en Tcontrol?',
    pista: 'Recuerda: En Tcontrol la calidad superior, precisión técnica y seguridad del personal y cliente son nuestros pilares de trabajo diario.',
    opciones: [
      { letra: 'A', texto: 'Priorizar la velocidad sobre la seguridad y el control de calidad', correcta: false },
      { letra: 'B', texto: 'Cumplimiento estricto de normas técnicas, precisión en ensamblaje y protección total del personal', correcta: true },
      { letra: 'C', texto: 'Entregar proyectos sin protocolos de prueba ni calibración', correcta: false }
    ],
    activo: true
  },
  {
    id: 'seguridad_industrial',
    tipo: 'SEGURIDAD',
    pilar: 'Seguridad Industrial',
    iconoPilar: '⚙️',
    pregunta: '¿Cuál es la regla de oro ante una condición insegura en planta o campo?',
    pista: 'Recuerda: Si una condición no es segura, se debe detener el trabajo y reportar inmediatamente.',
    opciones: [
      { letra: 'A', texto: 'Detener el trabajo, aislar el peligro y comunicar de inmediato al supervisor / HSE', correcta: true },
      { letra: 'B', texto: 'Continuar con el trabajo para no retrasar la entrega', correcta: false },
      { letra: 'C', texto: 'Esperar a que otro compañero resuelva la situación', correcta: false }
    ],
    activo: true
  }
];

window.bancoPreguntasCulturaCache = [];

window.cargarBancoPreguntasCultura = async function (force = false) {
  const container = $('preguntasCulturaContainer');
  if (container && !window.bancoPreguntasCulturaCache.length) {
    container.innerHTML = `
          <div style="text-align:center; padding:40px; color:#94a3b8; grid-column: 1/-1;">
            <i class="fas fa-spinner fa-spin" style="font-size:24px; margin-bottom:8px; display:block;"></i>
            Cargando preguntas de cultura...
          </div>
        `;
  }

  try {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('cultura_preguntas_cache') || 'null'); } catch (e) { }
    if (cached && Array.isArray(cached) && cached.length > 0 && !force) {
      window.bancoPreguntasCulturaCache = cached;
      window.renderPreguntasCultura(cached);
    }

    const res = await jsonpRequest({ accion: 'obtenerPreguntasCultura' });
    if (res && res.preguntas && Array.isArray(res.preguntas) && res.preguntas.length > 0) {
      window.bancoPreguntasCulturaCache = res.preguntas;
    } else if (res && Array.isArray(res) && res.length > 0) {
      window.bancoPreguntasCulturaCache = res;
    } else if (!window.bancoPreguntasCulturaCache.length) {
      window.bancoPreguntasCulturaCache = JSON.parse(JSON.stringify(window.PREGUNTAS_CULTURA_DEFAULT));
    }

    if (res && res.habilitado !== undefined) {
      if (typeof window._actualizarSwitchCulturaGlobalUI === 'function') {
        window._actualizarSwitchCulturaGlobalUI(res.habilitado);
      }
    } else {
      const localHab = localStorage.getItem('cultura_habilitada_global');
      if (typeof window._actualizarSwitchCulturaGlobalUI === 'function') {
        window._actualizarSwitchCulturaGlobalUI(localHab !== 'false');
      }
    }

    try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
    window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  } catch (err) {
    console.warn('Error cargando preguntas de cultura:', err);
    if (!window.bancoPreguntasCulturaCache.length) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem('cultura_preguntas_cache') || 'null'); } catch (e) { }
      window.bancoPreguntasCulturaCache = (cached && cached.length) ? cached : JSON.parse(JSON.stringify(window.PREGUNTAS_CULTURA_DEFAULT));
    }
    window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  }
};

window.renderPreguntasCultura = function (lista) {
  const container = $('preguntasCulturaContainer');
  if (!container) return;

  const items = lista || window.bancoPreguntasCulturaCache || [];
  if ($('lblTotalPreguntasCultura')) {
    const activas = items.filter(x => x.activo !== false).length;
    $('lblTotalPreguntasCultura').textContent = `${activas} de ${items.length}`;
  }

  if (!items.length) {
    container.innerHTML = `
          <div style="text-align:center; padding:40px; color:#94a3b8; grid-column: 1/-1; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:12px;">
            <i class="fas fa-lightbulb" style="font-size:32px; margin-bottom:10px; color:#cbd5e1; display:block;"></i>
            <h5 style="margin:0 0 6px 0; color:#475569; font-weight:700;">No hay preguntas en el banco</h5>
            <p style="margin:0 0 14px 0; font-size:12px; color:#64748b;">Crea tu primera pregunta de cultura o restaura la base predeterminada.</p>
            <button type="button" class="btn btn-outline" onclick="window.restablecerPreguntasCultura()" style="font-size:12px; padding:6px 14px;"><i class="fas fa-undo"></i> Cargar Preguntas Predeterminadas</button>
          </div>
        `;
    return;
  }

  const getPilarBadgeStyle = (tipo) => {
    switch (tipo) {
      case 'PROPOSITO': return { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' };
      case 'MISION': return { bg: '#fef3c7', color: '#b45309', border: '#fde68a' };
      case 'VISION': return { bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe' };
      case 'VALORES': return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
      case 'SEGURIDAD': return { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' };
      case 'INNOVACION': return { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' };
      default: return { bg: '#f1f5f9', color: '#334155', border: '#cbd5e1' };
    }
  };

  container.innerHTML = items.map((q) => {
    const pStyle = getPilarBadgeStyle(q.tipo);
    const esActiva = q.activo !== false;
    const opcionesHtml = (q.opciones || []).map(opt => {
      const esCorrecta = opt.correcta === true || String(opt.correcta) === 'true';
      return `
            <div style="display:flex; align-items:flex-start; gap:8px; padding:6px 8px; border-radius:6px; font-size:12px; background:${esCorrecta ? '#f0fdf4' : '#f8fafc'}; border:1px solid ${esCorrecta ? '#86efac' : '#e2e8f0'}; margin-bottom:4px;">
              <span style="font-weight:800; color:${esCorrecta ? '#15803d' : '#64748b'}; width:18px;">${opt.letra || '•'}</span>
              <span style="flex:1; color:${esCorrecta ? '#166534' : '#334155'}; font-weight:${esCorrecta ? '600' : '400'}; line-height:1.35;">${escapeHtml(opt.texto || '')}</span>
              ${esCorrecta ? '<span title="Respuesta Correcta" style="color:#16a34a; font-size:13px;"><i class="fas fa-check-circle"></i></span>' : ''}
            </div>
          `;
    }).join('');

    return `
          <div class="cultura-pregunta-card" style="background:white; border:1px solid ${esActiva ? 'var(--g200)' : '#cbd5e1'}; border-radius:12px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 1px 3px rgba(0,0,0,0.03); opacity:${esActiva ? '1' : '0.6'};">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="background:${pStyle.bg}; color:${pStyle.color}; border:1px solid ${pStyle.border}; padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:750; display:inline-flex; align-items:center; gap:5px;">
                  <span>${q.iconoPilar || '💡'}</span> <span>${escapeHtml(q.pilar || q.tipo || 'Cultura')}</span>
                </span>
                <div style="display:flex; align-items:center; gap:6px;">
                  <button type="button" onclick="window.toggleActivoPreguntaCultura('${q.id}')" class="btn" style="padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${esActiva ? '#ecfdf5' : '#f1f5f9'}; color:${esActiva ? '#059669' : '#64748b'}; border:1px solid ${esActiva ? '#a7f3d0' : '#cbd5e1'}; cursor:pointer;" title="Activar/Desactivar para el quiz diario">
                    ${esActiva ? '<i class="fas fa-eye"></i> Activa' : '<i class="fas fa-eye-slash"></i> Inactiva'}
                  </button>
                </div>
              </div>
              <h5 style="margin:0 0 10px 0; font-size:13.5px; font-weight:800; color:#0f172a; line-height:1.4;">
                ${escapeHtml(q.pregunta || '')}
              </h5>
              <div style="margin-bottom:12px;">
                ${opcionesHtml}
              </div>
              ${q.pista ? `
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:8px 10px; font-size:11px; color:#1e40af; line-height:1.35; margin-bottom:14px;">
                  <i class="fas fa-info-circle me-1" style="color:#2563eb;"></i> <strong>Pista Pedagógica:</strong> ${q.pista}
                </div>
              ` : ''}
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #f1f5f9; padding-top:10px; margin-top:6px;">
              <button type="button" onclick="window.editarPreguntaCultura('${q.id}')" class="btn btn-outline" style="padding:5px 10px; font-size:11.5px; font-weight:600; border-radius:6px; display:inline-flex; align-items:center; gap:4px; color:#0284c7; border-color:#bae6fd; background:#f0f9ff;">
                <i class="fas fa-edit"></i> Editar
              </button>
              <button type="button" onclick="window.eliminarPreguntaCultura('${q.id}')" class="btn btn-outline" style="padding:5px 10px; font-size:11.5px; font-weight:600; border-radius:6px; display:inline-flex; align-items:center; gap:4px; color:#dc2626; border-color:#fecaca; background:#fef2f2;">
                <i class="fas fa-trash-alt"></i> Eliminar
              </button>
            </div>
          </div>
        `;
  }).join('');
};

window.filtrarPreguntasCultura = function () {
  const q = ($('buscarPreguntaCultura')?.value || '').toLowerCase().trim();
  const pilar = $('filtroPilarCultura')?.value || 'TODOS';
  let lista = window.bancoPreguntasCulturaCache || [];

  if (pilar !== 'TODOS') {
    lista = lista.filter(item => (item.tipo || '').toUpperCase() === pilar);
  }
  if (q) {
    lista = lista.filter(item => {
      const preg = (item.pregunta || '').toLowerCase();
      const pil = (item.pilar || '').toLowerCase();
      const pist = (item.pista || '').toLowerCase();
      const opts = (item.opciones || []).map(o => (o.texto || '').toLowerCase()).join(' ');
      return preg.includes(q) || pil.includes(q) || pist.includes(q) || opts.includes(q);
    });
  }
  window.renderPreguntasCultura(lista);
};

window.onCulturaPilarChange = function (val) {
  const container = $('culturaPilarCustomContainer');
  const iconoSelect = $('culturaIconoSelect');
  if (container) {
    container.style.display = (val === 'OTRO') ? 'block' : 'none';
  }
  const iconMap = {
    PROPOSITO: '🎯',
    MISION: '⚡',
    VISION: '🚀',
    VALORES: '🛡️',
    SEGURIDAD: '⚙️',
    INNOVACION: '💡',
    OTRO: '🌟'
  };
  if (iconoSelect && iconMap[val]) {
    iconoSelect.value = iconMap[val];
  }
};

window.abrirModalPreguntaCultura = function (id = null) {
  const modal = $('modalPreguntaCultura');
  if (!modal) return;

  $('culturaPreguntaId').value = id || '';
  $('modalPreguntaCulturaTitulo').innerHTML = id
    ? '<i class="fas fa-edit" style="color:var(--red);"></i> <span>Editar Pregunta de Cultura</span>'
    : '<i class="fas fa-plus-circle" style="color:var(--red);"></i> <span>Nueva Pregunta de Cultura</span>';

  if (id) {
    const item = (window.bancoPreguntasCulturaCache || []).find(x => x.id === id);
    if (item) {
      $('culturaPilarSelect').value = item.tipo || 'PROPOSITO';
      $('culturaIconoSelect').value = item.iconoPilar || '🎯';
      if (item.tipo === 'OTRO') {
        $('culturaPilarCustomContainer').style.display = 'block';
        $('culturaPilarCustomText').value = item.pilar || '';
      } else {
        $('culturaPilarCustomContainer').style.display = 'none';
        $('culturaPilarCustomText').value = '';
      }
      $('culturaPreguntaTexto').value = item.pregunta || '';
      $('culturaPistaTexto').value = (item.pista || '').replace(/<[^>]*>/g, '');

      const opts = item.opciones || [];
      for (let i = 0; i < 4; i++) {
        const txtInput = $(`culturaOptTexto_${i}`);
        if (txtInput) txtInput.value = opts[i] ? opts[i].texto || '' : '';
      }
      const idxCorrecta = opts.findIndex(o => o.correcta === true || String(o.correcta) === 'true');
      const radios = document.querySelectorAll('input[name="culturaOptCorrecta"]');
      radios.forEach(r => {
        r.checked = (parseInt(r.value) === (idxCorrecta >= 0 ? idxCorrecta : 0));
      });
    }
  } else {
    $('culturaPilarSelect').value = 'PROPOSITO';
    $('culturaIconoSelect').value = '🎯';
    $('culturaPilarCustomContainer').style.display = 'none';
    $('culturaPilarCustomText').value = '';
    $('culturaPreguntaTexto').value = '';
    $('culturaPistaTexto').value = '';
    for (let i = 0; i < 4; i++) {
      const txtInput = $(`culturaOptTexto_${i}`);
      if (txtInput) txtInput.value = '';
    }
    const radios = document.querySelectorAll('input[name="culturaOptCorrecta"]');
    radios.forEach(r => { r.checked = (r.value === '0'); });
  }

  modal.classList.remove('hidden');
};

window.cerrarModalPreguntaCultura = function () {
  const modal = $('modalPreguntaCultura');
  if (modal) modal.classList.add('hidden');
};

window.editarPreguntaCultura = function (id) {
  window.abrirModalPreguntaCultura(id);
};

window.eliminarPreguntaCultura = function (id) {
  if (!confirm('¿Seguro que deseas eliminar esta pregunta del banco?')) return;
  window.bancoPreguntasCulturaCache = (window.bancoPreguntasCulturaCache || []).filter(x => x.id !== id);
  try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
  window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  mostrarToast('Pregunta eliminada localmente. Haz clic en Guardar Cambios para sincronizar.', 'info');
};

window.toggleActivoPreguntaCultura = function (id) {
  const item = (window.bancoPreguntasCulturaCache || []).find(x => x.id === id);
  if (!item) return;
  item.activo = (item.activo === false) ? true : false;
  try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
  window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  mostrarToast(item.activo ? 'Pregunta activada' : 'Pregunta desactivada', 'info');
};

window.guardarPreguntaDesdeModal = function () {
  const id = $('culturaPreguntaId').value.trim();
  const tipo = $('culturaPilarSelect').value;
  const icono = $('culturaIconoSelect').value;
  const pilarSel = $('culturaPilarSelect');
  const optSelected = pilarSel.options[pilarSel.selectedIndex];
  let pilarNombre = optSelected ? optSelected.dataset.pilar || optSelected.text.replace(/^[^\s]+\s+/, '') : tipo;
  if (tipo === 'OTRO') {
    const cust = $('culturaPilarCustomText').value.trim();
    if (cust) pilarNombre = cust;
  }

  const pregunta = $('culturaPreguntaTexto').value.trim();
  const pista = $('culturaPistaTexto').value.trim();

  if (!pregunta) {
    mostrarToast('Por favor escribe la pregunta.', 'error');
    return;
  }

  const radios = document.querySelectorAll('input[name="culturaOptCorrecta"]');
  let correctaIdx = 0;
  radios.forEach(r => { if (r.checked) correctaIdx = parseInt(r.value); });

  const letras = ['A', 'B', 'C', 'D'];
  const opciones = [];
  for (let i = 0; i < 4; i++) {
    const val = ($(`culturaOptTexto_${i}`)?.value || '').trim();
    if (val) {
      opciones.push({
        letra: letras[i],
        texto: val,
        correcta: (i === correctaIdx)
      });
    }
  }

  if (opciones.length < 2) {
    mostrarToast('Debes ingresar al menos 2 opciones de respuesta.', 'error');
    return;
  }

  if (!opciones.some(o => o.correcta)) {
    opciones[0].correcta = true;
  }

  const nuevaPregunta = {
    id: id || ('q_' + Date.now()),
    tipo: tipo,
    pilar: pilarNombre,
    iconoPilar: icono,
    pregunta: pregunta,
    pista: pista,
    opciones: opciones,
    activo: true
  };

  if (!window.bancoPreguntasCulturaCache) window.bancoPreguntasCulturaCache = [];

  if (id) {
    const idx = window.bancoPreguntasCulturaCache.findIndex(x => x.id === id);
    if (idx >= 0) {
      window.bancoPreguntasCulturaCache[idx] = { ...window.bancoPreguntasCulturaCache[idx], ...nuevaPregunta };
    } else {
      window.bancoPreguntasCulturaCache.push(nuevaPregunta);
    }
  } else {
    window.bancoPreguntasCulturaCache.push(nuevaPregunta);
  }

  try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
  window.cerrarModalPreguntaCultura();
  window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  mostrarToast('Pregunta guardada. Haz clic en "Guardar Cambios" para sincronizar.', 'success');
};

window.guardarBancoPreguntasCultura = async function () {
  mostrarLoader(true);
  try {
    const payload = {
      accion: 'guardarPreguntasCultura',
      preguntas: window.bancoPreguntasCulturaCache
    };

    let res = null;
    if (window.FirebaseBackend && typeof window.FirebaseBackend.guardarPreguntasCultura === 'function') {
      res = await window.FirebaseBackend.guardarPreguntasCultura(payload);
    } else {
      res = await jsonpRequest({
        accion: 'guardarPreguntasCultura',
        preguntas: JSON.stringify(window.bancoPreguntasCulturaCache)
      });
    }

    try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
    mostrarToast('Banco de preguntas de cultura sincronizado exitosamente.', 'success');
  } catch (err) {
    console.error('Error guardando preguntas de cultura:', err);
    mostrarToast('Error al sincronizar con el servidor: ' + err.message, 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.restablecerPreguntasCultura = function () {
  if (!confirm('¿Deseas restablecer el banco de preguntas a los valores corporativos predeterminados?')) return;
  window.bancoPreguntasCulturaCache = JSON.parse(JSON.stringify(window.PREGUNTAS_CULTURA_DEFAULT));
  try { localStorage.setItem('cultura_preguntas_cache', JSON.stringify(window.bancoPreguntasCulturaCache)); } catch (e) { }
  window.renderPreguntasCultura(window.bancoPreguntasCulturaCache);
  mostrarToast('Base predeterminada restaurada. Recuerda guardar cambios.', 'info');
};

window._actualizarSwitchCulturaGlobalUI = function (habilitado) {
  const chk = $('chkCulturaTcontrolGlobal');
  const badge = $('badgeEstadoCulturaGlobal');
  const icono = $('iconoEstadoCulturaGlobal');
  const lbl = $('lblTextoSwitchCulturaGlobal');
  const box = $('boxControlCulturaGlobal');

  const esHab = (habilitado === true || habilitado === 'true');
  if (chk) chk.checked = esHab;

  if (badge) {
    badge.textContent = esHab ? 'HABILITADO GENERAL' : 'DESHABILITADO GLOBAL';
    badge.style.background = esHab ? '#dcfce7' : '#fee2e2';
    badge.style.color = esHab ? '#15803d' : '#b91c1c';
    badge.style.borderColor = esHab ? '#86efac' : '#fca5a5';
  }

  if (icono) {
    icono.className = esHab ? 'fas fa-toggle-on' : 'fas fa-toggle-off';
    if (icono.parentElement) {
      icono.parentElement.style.background = esHab ? '#dcfce7' : '#fee2e2';
      icono.parentElement.style.color = esHab ? '#16a34a' : '#dc2626';
    }
  }

  if (lbl) {
    lbl.textContent = esHab ? 'Habilitado para todos' : 'Deshabilitado para todos';
    lbl.style.color = esHab ? '#16a34a' : '#dc2626';
  }

  if (box) {
    box.style.background = esHab ? 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)' : 'linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%)';
    box.style.borderColor = esHab ? '#bbf7d0' : '#fecaca';
  }
};

window.toggleCulturaTcontrolGlobal = async function (habilitado) {
  window._actualizarSwitchCulturaGlobalUI(habilitado);
  try {
    localStorage.setItem('cultura_habilitada_global', habilitado ? 'true' : 'false');
  } catch (e) { }

  try {
    let res = null;
    if (window.FirebaseBackend && typeof window.FirebaseBackend.toggleCulturaTcontrol === 'function') {
      res = await window.FirebaseBackend.toggleCulturaTcontrol({ habilitado });
    } else {
      res = await jsonpRequest({
        accion: 'toggleCulturaTcontrol',
        habilitado: habilitado
      });
    }

    if (res && res.ok !== false && !res.error) {
      mostrarToast(habilitado ? '✅ Cultura Tcontrol habilitada para todos los colaboradores.' : '⏸️ Cultura Tcontrol deshabilitada globalmente.', 'success');
    } else {
      mostrarToast('Error al actualizar estado en el servidor: ' + (res?.error || 'Error desconocido'), 'error');
    }
  } catch (err) {
    console.error("Error al guardar estado global de Cultura:", err);
    mostrarToast('Error de conexión al actualizar Cultura Tcontrol: ' + err.message, 'error');
  }
};

window.toggleCulturaEmpleado = async function (empleadoId) {
  if (!empleadoId) return;
  const emp = (typeof empCache !== 'undefined' && empCache.length)
    ? empCache.find(x => String(x.id).trim() === String(empleadoId).trim())
    : null;

  const estadoActual = emp
    ? !(emp.cultura_habilitada === false || emp.cultura_activa === false || emp.cultura_habilitada === 'false' || emp.cultura_activa === 'false')
    : true;
  const nuevoEstado = !estadoActual;

  const confMsg = nuevoEstado
    ? `¿Habilitar el quiz de Cultura Tcontrol para este colaborador?`
    : `¿Exonerar / deshabilitar a este colaborador del quiz de Cultura Tcontrol?`;
  if (!confirm(confMsg)) return;

  mostrarLoader(true);
  try {
    let res = null;
    if (window.FirebaseBackend && typeof window.FirebaseBackend.toggleCulturaEmpleado === 'function') {
      res = await window.FirebaseBackend.toggleCulturaEmpleado({ empleadoId, habilitado: nuevoEstado });
    } else if (window.FirebaseBackend && typeof window.FirebaseBackend.actualizarEmpleado === 'function') {
      res = await window.FirebaseBackend.actualizarEmpleado({ empleadoId, campo: 'cultura_habilitada', valor: nuevoEstado });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarEmpleado',
        empleadoId: empleadoId,
        campo: 'cultura_habilitada',
        valor: nuevoEstado
      });
    }

    if (emp) {
      emp.cultura_habilitada = nuevoEstado;
      emp.cultura_activa = nuevoEstado;
    }

    mostrarLoader(false);
    mostrarToast(nuevoEstado ? '✅ Cultura Tcontrol habilitada para el colaborador.' : '⏸️ Colaborador exonerado de Cultura Tcontrol.', 'success');

    // Re-renderizar detalle de empleado para reflejar cambio inmediato
    if (typeof mostrarDetalle === 'function') {
      mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al cambiar Cultura de empleado:", err);
    mostrarToast('Error al actualizar empleado: ' + err.message, 'error');
  }
};

