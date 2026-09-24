/**
 * Asistencia Tcontrol - Modulo Creador Interactivo de Reportes Custom
 * Extraido en Fase 5 de Modularizacion
 * Fecha: 2026-09-23
 */

// ============================================================
// CREADOR INTERACTIVO DE REPORTES CUSTOM
// ============================================================
const DEFAULT_COLUMNAS_CUSTOM = ['area', 'asistencias', 'diasCampo', 'faltas', 'diasVacaciones', 'diasJustificados', 'diasExtras', 'atrasos', 'minutosAtrasos', 'almPlanta', 'puntualidad', 'totalExtras50', 'totalExtras100'];

function obtenerColumnasCustomActivas() {
  const saved = localStorage.getItem('columnasCustomActivasReporte');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        ['diasCampo', 'diasVacaciones', 'diasJustificados', 'diasExtras'].forEach(colId => {
          if (!parsed.includes(colId)) {
            const idxFaltas = parsed.indexOf('faltas');
            if (idxFaltas > -1) {
              parsed.splice(idxFaltas + 1, 0, colId);
            } else {
              parsed.push(colId);
            }
          }
        });
        return parsed;
      }
    } catch (e) { }
  }
  return [...DEFAULT_COLUMNAS_CUSTOM];
}

function guardarColumnasCustomActivas(columnas) {
  localStorage.setItem('columnasCustomActivasReporte', JSON.stringify(columnas));
}

let columnasCustomActivas = obtenerColumnasCustomActivas();
window.columnasCustomActivas = columnasCustomActivas;
window.obtenerColumnasCustomActivas = obtenerColumnasCustomActivas;
let _sortCustomReport = { col: 'nombre', dir: 'asc' };

window.inicializarReporteInteractivo = function () {
  actualizarReporteInteractivo();
};

window.actualizarReporteInteractivo = function () {
  const rango = window.obtenerRangoFechasReportes();
  const bodyT = $('reporteCustomBody');

  // Asegurar que selectores de periodo tengan opciones si aún no las tienen
  const selectPeriodo = $('periodoMensual');
  if (selectPeriodo && (!selectPeriodo.options || selectPeriodo.options.length === 0)) {
    const listaP = (periodos && periodos.length) ? periodos : ((typeof generarPeriodos === 'function') ? generarPeriodos() : []);
    selectPeriodo.innerHTML = listaP.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
  }

  const emps = (empCache && empCache.length) ? empCache : (window.empCache || []);
  const tieneEmpleados = (emps && emps.length) || (window.empEliminadosCache && window.empEliminadosCache.length) || (window._cacheDesvinculados && window._cacheDesvinculados.length);

  if (!tieneEmpleados) {
    if (bodyT) {
      bodyT.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:45px; color:var(--g500);">
        <i class="fas fa-spinner fa-spin" style="font-size:24px; color:var(--blue); margin-bottom:10px; display:block;"></i>
        Cargando datos de colaboradores y registros...
      </td></tr>`;
    }
    if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = 'Cargando información...';
    return;
  }

  cargarReportes();
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
};

window.renderizarColumnasInteractivas = function () {
  const container = $('columnasSelectorInteractivo');
  if (!container) return;

  container.innerHTML = '';

  COLUMNAS_DISPONIBLES.forEach(col => {
    const isActiva = columnasCustomActivas.includes(col.id);
    const chip = document.createElement('div');
    chip.className = `chip-item ${isActiva ? 'activa' : 'disponible'}`;
    
    if (isActiva) {
      chip.style.borderColor = col.color || '#2563eb';
      chip.style.backgroundColor = col.colorBg || '#eff6ff';
      chip.style.color = col.color || '#1e40af';
      chip.innerHTML = `<i class="fas ${col.icono || 'fa-check-circle'}" style="color:${col.color || '#2563eb'};"></i> <span style="font-weight:700;">${col.label}</span>`;
    } else {
      chip.style.borderColor = 'var(--g200)';
      chip.style.backgroundColor = '#ffffff';
      chip.style.color = 'var(--g600)';
      chip.innerHTML = `<i class="fas ${col.icono || 'fa-circle'}" style="opacity:0.4;"></i> <span>${col.label}</span>`;
    }

    chip.addEventListener('click', () => {
      if (isActiva) {
        quitarColumnaCustom(col.id);
      } else {
        agregarColumnaCustom(col.id);
      }
    });

    container.appendChild(chip);
  });

  if ($('lblCountColsActivas')) {
    $('lblCountColsActivas').textContent = columnasCustomActivas.length;
  }
};

window.toggleSelectorColumnas = function () {
  const c = $('reportsLayoutContainer');
  if (!c) return;
  const isOculto = c.style.display === 'none' || getComputedStyle(c).display === 'none';
  c.style.display = isOculto ? 'block' : 'none';
  const btn = $('btnToggleColsLayout');
  if (btn) {
    btn.classList.toggle('active', isOculto);
    btn.style.background = isOculto ? '#eff6ff' : '#ffffff';
    btn.style.borderColor = isOculto ? '#2563eb' : 'var(--g300)';
    btn.style.color = isOculto ? '#1e40af' : 'var(--g700)';
  }
};

window.agregarColumnaCustom = function (colId) {
  if (!columnasCustomActivas.includes(colId)) {
    columnasCustomActivas.push(colId);
    guardarColumnasCustomActivas(columnasCustomActivas);
    renderizarColumnasInteractivas();
    filtrarReporteInteractivo();
  }
};

window.quitarColumnaCustom = function (colId) {
  const idx = columnasCustomActivas.indexOf(colId);
  if (idx > -1) {
    columnasCustomActivas.splice(idx, 1);
    guardarColumnasCustomActivas(columnasCustomActivas);
    renderizarColumnasInteractivas();
    filtrarReporteInteractivo();
  }
};

// Drag and Drop helpers
window.allowDropCustom = function (e) {
  e.preventDefault();
};

window.dragCustom = function (e, colId) {
  e.dataTransfer.setData("text/plain", colId);
};

window.dropCustom = function (e, target) {
  e.preventDefault();
  const colId = e.dataTransfer.getData("text/plain");
  if (!colId) return;

  if (target === 'activas') {
    agregarColumnaCustom(colId);
  } else {
    quitarColumnaCustom(colId);
  }
};

window.sortReporteCustom = function (colId) {
  if (_sortCustomReport.col === colId) {
    _sortCustomReport.dir = _sortCustomReport.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortCustomReport.col = colId;
    _sortCustomReport.dir = 'asc';
  }
  filtrarReporteInteractivo();
};

window.setFiltroRapidoReporte = function (cargoVal, btnElement) {
  if (cargoVal === 'desvinculados') {
    const chkDesv = $('chkIncluirDesvinculadosRep');
    if (chkDesv && !chkDesv.checked) chkDesv.checked = true;
  } else if (cargoVal === 'eliminados') {
    const chk = $('chkIncluirEliminadosRep');
    if (chk && !chk.checked) chk.checked = true;
  }
  if ($('filtroCargoReporte')) {
    $('filtroCargoReporte').value = cargoVal;
  }
  if (btnElement && btnElement.parentElement) {
    const btns = btnElement.parentElement.querySelectorAll('.btn-filter, .btn-filter-pill');
    btns.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    // Actualizar el estilo visual para mostrar el botón activo con un color de fondo diferente
    btns.forEach(b => {
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const isElim = cargoVal === 'eliminados';
    const isDesv = cargoVal === 'desvinculados';
    btnElement.style.background = isDesv ? '#7c3aed' : (isElim ? '#e11d48' : 'var(--blue)');
    btnElement.style.color = '#fff';
    btnElement.style.borderColor = isDesv ? '#7c3aed' : (isElim ? '#e11d48' : 'var(--blue)');
  }
  if (typeof actualizarReporteInteractivo === 'function') actualizarReporteInteractivo();
  if (typeof cargarReportes === 'function') cargarReportes();
  filtrarReporteInteractivo();
};

window.obtenerDatosFiltradosReporteCustom = function (q = '', fCargo = '') {
  q = (q || '').toLowerCase();
  fCargo = (fCargo || '').toLowerCase();

  const baseData = (window._reportesCustomData && window._reportesCustomData.length)
    ? window._reportesCustomData
    : (_reportesCustomData && _reportesCustomData.length ? _reportesCustomData : (window._reportesData || []));

  return baseData.filter(e => {
    let matchQ = !q || (e.nombre || '').toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q) || String(e.id || '').toLowerCase().includes(q);
    let matchCargo = !fCargo;
    if (fCargo === 'desvinculados') {
      matchCargo = !!e.esDesvinculado || (e.cargo || '').toLowerCase() === 'desvinculado' || (e.area || '').toLowerCase() === 'desvinculado' || (e.estadoBadge && e.estadoBadge.toLowerCase().includes('desvinculado')) || (e.motivo_salida && e.motivo_salida.length > 0);
    } else if (fCargo === 'eliminados') {
      matchCargo = !!e.esEliminado || e.activo === false || (e.area || '').toLowerCase() === 'eliminado' || (e.cargo || '').toLowerCase() === 'eliminado';
    } else if (fCargo === 'sin asistencia') {
      matchCargo = (e.asistencias === 0 || !e.asistencias);
    } else if (fCargo) {
      matchCargo = (e.cargo || '').toLowerCase() === fCargo;
    }
    return matchQ && matchCargo;
  });
};

window.filtrarReporteInteractivo = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();

  const headerTr = $('reporteCustomHeaders');
  const bodyT = $('reporteCustomBody');
  if (!bodyT) return;

  const rango = (typeof window.obtenerRangoFechasReportes === 'function')
    ? window.obtenerRangoFechasReportes()
    : { R_INI: '', R_FIN: '', labelRango: '', labelCorto: '', esFiltroPersonalizado: false, indexPeriodo: 0 };

  // Actualizar badge visual de estado del rango si existe
  const badgeRango = $('badgeEstadoRangoReporte');
  if (badgeRango) {
    if (rango.esFiltroPersonalizado) {
      badgeRango.className = 'badge-rango-activo badge-rango-filtro';
      badgeRango.innerHTML = `<i class="fas fa-filter"></i> Filtro: <strong>${escapeHtml(rango.labelRango)}</strong>`;
      badgeRango.style.display = 'inline-flex';
    } else {
      badgeRango.className = 'badge-rango-activo badge-rango-periodo';
      badgeRango.innerHTML = `<i class="fas fa-calendar-alt"></i> Período: <strong>${escapeHtml(rango.labelRango)}</strong>`;
      badgeRango.style.display = 'inline-flex';
    }
  }

  // Headers
  function sortIconCustom(colId) {
    if (_sortCustomReport.col !== colId) return '<i class="fas fa-sort" style="opacity:.2;margin-left:4px;font-size:9px"></i>';
    return _sortCustomReport.dir === 'asc'
      ? '<i class="fas fa-sort-up" style="color:var(--red);margin-left:4px;font-size:9px"></i>'
      : '<i class="fas fa-sort-down" style="color:var(--red);margin-left:4px;font-size:9px"></i>';
  }

  if (fCargo === 'almuerzos extra') {
    // Ocultar personalizador de columnas cuando se muestran almuerzos extra
    if ($('reportsLayoutContainer')) {
      $('reportsLayoutContainer').style.display = 'none';
    }

    let extras = window.obtenerAlmuerzosExtraConsolidados(rango.R_INI, rango.R_FIN);

    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }

    // Ordenar
    if (_sortCustomReport.col) {
      extras.sort((a, b) => {
        let va = a[_sortCustomReport.col] ?? '';
        let vb = b[_sortCustomReport.col] ?? '';
        if (typeof va === 'string') {
          return _sortCustomReport.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return _sortCustomReport.dir === 'asc' ? va - vb : vb - va;
      });
    }

    let headersHtml = `
          <th onclick="sortReporteCustom('fecha')" style="cursor:pointer">Fecha ${sortIconCustom('fecha')}</th>
          <th onclick="sortReporteCustom('nombre')" style="cursor:pointer">Descripción ${sortIconCustom('nombre')}</th>
          <th onclick="sortReporteCustom('cantidad')" style="text-align:center; cursor:pointer">Cantidad ${sortIconCustom('cantidad')}</th>
          <th onclick="sortReporteCustom('empresa')" style="cursor:pointer">Empresa/Destino ${sortIconCustom('empresa')}</th>
          <th onclick="sortReporteCustom('observaciones')" style="cursor:pointer">Observaciones ${sortIconCustom('observaciones')}</th>
          <th onclick="sortReporteCustom('tipo')" style="cursor:pointer">Tipo ${sortIconCustom('tipo')}</th>
        `;

    if (headerTr) headerTr.innerHTML = headersHtml;

    if (!extras.length) {
      bodyT.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--g500);"><i class="fas fa-search" style="font-size:18px; margin-bottom:8px; display:block;"></i> No hay almuerzos extras registrados en este rango/período (${escapeHtml(rango.labelRango)}).</td></tr>`;
      if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = `Mostrando 0 registros (0 almuerzos extras) | ${rango.labelRango}`;
      return;
    }

    bodyT.innerHTML = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return `<tr>
            <td style="font-family:'Fira Code',monospace;font-size:11px">${dateStr}</td>
            <td>
              <div class="employee-cell">
                <div class="employee-photo-placeholder" style="background:var(--indigo-lt); color:var(--indigo); display:flex; align-items:center; justify-content:center;"><i class="fas fa-utensils"></i></div>
                <strong>${escapeHtml(ae.nombre || 'Almuerzo Extra')}</strong>
              </div>
            </td>
            <td style="text-align:center"><span class="pill late" style="font-weight:700;font-size:11px;padding:2px 7px">${ae.cantidad || 1}</span></td>
            <td>${escapeHtml(ae.empresa || '—')}</td>
            <td>${escapeHtml(ae.observaciones || '—')}</td>
            <td><span class="pill ok" style="font-size:10px;padding:2px 7px">${escapeHtml(ae.tipo || 'Manual')}</span></td>
          </tr>`;
    }).join('');

    if ($('reporteCustomInfo')) {
      let totalCant = extras.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
      $('reporteCustomInfo').textContent = `Mostrando ${extras.length} registros (${totalCant} almuerzos extras) | ${rango.labelRango}`;
    }
    return;
  }

  let data = window.obtenerDatosFiltradosReporteCustom(q, fCargo);

  // Ordenar
  if (_sortCustomReport.col) {
    data = [...data].sort((a, b) => {
      let va = a[_sortCustomReport.col] ?? 0;
      let vb = b[_sortCustomReport.col] ?? 0;
      if (typeof va === 'string') return _sortCustomReport.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return _sortCustomReport.dir === 'asc' ? va - vb : vb - va;
    });
  }

  let headersHtml = `<th onclick="sortReporteCustom('nombre')" style="cursor:pointer; min-width:230px; background:#f8fafc; border-bottom:2.5px solid #2563eb;">
    <div style="display:flex; align-items:center; gap:6px;">
      <i class="fas fa-user-tie" style="color:#2563eb; font-size:12px;"></i>
      <span style="font-weight:700; color:#1e293b;">COLABORADOR</span>
      ${sortIconCustom('nombre')}
    </div>
  </th>`;

  COLUMNAS_DISPONIBLES.forEach(col => {
    if (columnasCustomActivas.includes(col.id)) {
      const iconHtml = col.icono ? `<i class="fas ${col.icono}" style="color:${col.color || '#2563eb'}; font-size:11px; margin-right:4px;"></i>` : '';
      if (col.id === 'area') {
        headersHtml += `<th onclick="sortReporteCustom('area')" style="cursor:pointer; min-width:140px; background:#f8fafc; border-bottom:2.5px solid #64748b;">
          <div style="display:flex; align-items:center; gap:5px;">
            ${iconHtml}<span style="font-weight:700; color:#334155;">ÁREA</span> ${sortIconCustom('area')}
          </div>
        </th>`;
      } else {
        headersHtml += `<th onclick="sortReporteCustom('${col.id}')" style="text-align:center; cursor:pointer; min-width:115px; background:${col.colorBg || '#f8fafc'}; border-bottom:2.5px solid ${col.color || '#2563eb'};">
          <div style="display:flex; align-items:center; justify-content:center; gap:4px;" title="${col.catLabel || col.label}">
            ${iconHtml}<span style="color:${col.color || '#1e293b'}; font-weight:700;">${col.label}</span> ${sortIconCustom(col.id)}
          </div>
        </th>`;
      }
    }
  });

  if (headerTr) headerTr.innerHTML = headersHtml;

  if (!data.length) {
    bodyT.innerHTML = `<tr><td colspan="${columnasCustomActivas.length + 1}" style="text-align:center; padding:35px; color:var(--g500);"><i class="fas fa-search" style="font-size:22px; margin-bottom:8px; display:block; color:var(--blue);"></i> No se encontraron resultados para el rango/período (<strong>${escapeHtml(rango.labelRango)}</strong>).</td></tr>`;
    if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = `Mostrando 0 colaboradores | ${rango.labelRango}`;
    return;
  }

  bodyT.innerHTML = data.map(e => {
    let nombreEmpDisplay = escapeHtml(e.nombre);
    if (e.esDesvinculado || (e.cargo || '').toLowerCase() === 'desvinculado' || (e.area || '').toLowerCase() === 'desvinculado') {
      const fSalidaStr = (e.fecha_salida || e.fechaDesvinculacion) ? (normalizarFechaStr(e.fecha_salida || e.fechaDesvinculacion) || e.fecha_salida) : '';
      nombreEmpDisplay += ` <span class="pill" style="font-size:9.5px; padding:2px 7px; background:#f5f3ff; color:#7c3aed; font-weight:700; border:1px solid #ddd6fe;" title="Colaborador Desvinculado"><i class="fas fa-user-slash"></i> Desvinculado</span>`;
      if (fSalidaStr) {
        nombreEmpDisplay += ` <span style="font-size:10px; color:#8b5cf6; font-weight:600; margin-left:2px;">(Salida: ${fSalidaStr})</span>`;
      }
    } else if (e.esEliminado) {
      nombreEmpDisplay += ` <span class="pill" style="font-size:9px; padding:1px 6px; background:#ffe4e6; color:#e11d48; font-weight:700; border:1px solid #fecdd3;" title="Colaborador eliminado con registros históricos">🗑️ Eliminado</span>`;
    }
    let rowHtml = `<tr onclick="mostrarDetalle('${e.id}', ${rango.indexPeriodo}, '${rango.R_INI}', '${rango.R_FIN}')" style="cursor:pointer" title="Ver detalle de asistencia de ${escapeHtml(e.nombre)}">
      <td><div class="employee-cell">${photoCell(e)}<span style="font-weight:600; color:#0f172a;">${nombreEmpDisplay}</span></div></td>`;

    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        const valor = e[col.id];
        let contenido = '';

        if (col.id === 'area') {
          contenido = `<span style="color:#475569; font-weight:600; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-building" style="font-size:9px; opacity:0.4;"></i> ${escapeHtml(valor || '—')}</span>`;
          rowHtml += `<td>${contenido}</td>`;
        } else {
          if (col.id === 'asistencias') {
            contenido = `<span class="rep-badge-pill rep-badge-asis"><i class="fas fa-check" style="font-size:8.5px;"></i> ${valor}</span>`;
          } else if (col.id === 'diasCampo') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill" style="background:#ecfeff; color:#0891b2; border:1px solid #a5f3fc; font-weight:700;"><i class="fas fa-hard-hat" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">0</span>`;
          } else if (col.id === 'faltas') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-falta-alert"><i class="fas fa-times-circle" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span class="rep-badge-falta-zero">0</span>`;
          } else if (col.id === 'diasVacaciones') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; font-weight:700;"><i class="fas fa-umbrella-beach" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">0</span>`;
          } else if (col.id === 'diasJustificados') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill" style="background:#f5f3ff; color:#7c3aed; border:1px solid #ddd6fe; font-weight:700;"><i class="fas fa-shield-alt" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">0</span>`;
          } else if (col.id === 'diasExtras') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill" style="background:#eef2ff; color:#4338ca; border:1px solid #c7d2fe; font-weight:700;"><i class="fas fa-calendar-plus" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">0</span>`;
          } else if (col.id === 'atrasos') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-atraso-alert"><i class="fas fa-clock" style="font-size:8.5px;"></i> ${valor}</span>`
              : `<span class="rep-badge-atraso-zero">0</span>`;
          } else if (col.id === 'minutosAtrasos') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-atraso-alert">${minutosAHHMMSS(valor)}</span>`
              : `<span style="font-family:'Fira Code',monospace; font-size:11px; color:#94a3b8;">00:00:00</span>`;
          } else if (col.id === 'almPlanta' || col.id === 'almFuera') {
            contenido = `<span class="rep-badge-pill rep-badge-alm"><i class="fas fa-utensils" style="font-size:8.5px;"></i> ${valor}</span>`;
          } else if (col.id === 'puntualidad') {
            if (valor >= 90) {
              contenido = `<span class="rep-badge-pill rep-badge-pct-hi"><i class="fas fa-star" style="font-size:8.5px;"></i> ${valor}%</span>`;
            } else if (valor >= 75) {
              contenido = `<span class="rep-badge-pill rep-badge-pct-mid">${valor}%</span>`;
            } else {
              contenido = `<span class="rep-badge-pill rep-badge-pct-low"><i class="fas fa-exclamation-circle" style="font-size:8.5px;"></i> ${valor}%</span>`;
            }
          } else if (col.id === 'horasExtra50') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-ex50">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#cbd5e1; font-family:'Fira Code',monospace; font-size:11px;">—</span>`;
          } else if (col.id === 'horasExtra100') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-ex100">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#cbd5e1; font-family:'Fira Code',monospace; font-size:11px;">—</span>`;
          } else if (col.id === 'totalExtras50') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-totextra">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">00:00:00</span>`;
          } else if (col.id === 'totalExtras100') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-totextra" style="background:#ede9fe; color:#4338ca; border-color:#c7d2fe;">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#94a3b8; font-family:'Fira Code',monospace; font-size:11px;">00:00:00</span>`;
          } else if (col.cat === 'campo') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-campo">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#cbd5e1; font-family:'Fira Code',monospace; font-size:11px;">—</span>`;
          } else if (col.cat === 'permisos') {
            contenido = (valor > 0)
              ? `<span class="rep-badge-pill rep-badge-perm" style="background:${col.colorBg}; color:${col.color}; border-color:${col.color}40;">${minutosAHHMMSS(valor)}</span>`
              : `<span style="color:#cbd5e1; font-family:'Fira Code',monospace; font-size:11px;">—</span>`;
          } else {
            contenido = `<span style="font-family:'Fira Code',monospace; font-size:11px;">${valor}</span>`;
          }
          rowHtml += `<td style="text-align:center;">${contenido}</td>`;
        }
      }
    });

    rowHtml += '</tr>';
    return rowHtml;
  }).join('');

  let footerHtml = `<tr class="rep-totals-row">
        <td style="padding:10px 14px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <i class="fas fa-calculator" style="color:#38bdf8;"></i>
            <span>TOTALES / PROMEDIOS</span>
          </div>
        </td>`;

  COLUMNAS_DISPONIBLES.forEach(col => {
    if (columnasCustomActivas.includes(col.id)) {
      if (col.id === 'area') {
        footerHtml += `<td style="text-align:center; color:#64748b;">—</td>`;
      } else {
        let total = 0;
        let count = 0;
        data.forEach(e => {
          let val = parseFloat(e[col.id]) || 0;
          total += val;
          count++;
        });

        let displayVal = '';
        if (col.tipo === 'tiempo') {
          displayVal = minutosAHHMMSS(total);
        } else if (col.tipo === 'pct') {
          let avg = count ? Math.round(total / count) : 0;
          displayVal = `${avg}%`;
        } else {
          displayVal = total;
        }
        footerHtml += `<td style="text-align:center;">
          <span style="font-family:'Fira Code',monospace; font-size:11.5px; font-weight:800; color:#ffffff;">${displayVal}</span>
        </td>`;
      }
    }
  });
  footerHtml += '</tr>';

  bodyT.innerHTML += footerHtml;

  // Sync double scrollbars
  const tableScroll = $('reporteCustomScroll');
  const topScroll = $('customRepTopScroll');
  if (tableScroll && topScroll) {
    const dummy = topScroll.querySelector('.top-scroll-dummy');
    if (dummy) {
      setTimeout(() => {
        dummy.style.width = tableScroll.scrollWidth + 'px';
        topScroll.scrollLeft = tableScroll.scrollLeft;
      }, 50);
    }
  }

  if (typeof initScrollSync === 'function') {
    initScrollSync('customRepTopScroll', 'reporteCustomScroll');
  }

  if ($('reporteCustomInfo')) {
    let infoRango = rango.esFiltroPersonalizado ? ` | Filtro: ${rango.labelRango}` : ` | ${rango.labelRango}`;
    $('reporteCustomInfo').textContent = `Mostrando ${data.length} de ${empCache.length} colaboradores${infoRango}`;
  }
};

window.restablecerColumnasDefault = function () {
  // Restablecer el filtro rápido de cargo si estaba en almuerzos extra
  if ($('filtroCargoReporte') && $('filtroCargoReporte').value === 'almuerzos extra') {
    $('filtroCargoReporte').value = '';
    const btns = document.querySelectorAll('#filtrosRapidosCargo .btn-filter, #filtrosRapidosCargo .btn-filter-pill');
    btns.forEach(b => {
      b.classList.remove('active');
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const btnTodos = Array.from(btns).find(b => b.textContent.trim().toUpperCase() === 'TODOS');
    if (btnTodos) {
      btnTodos.classList.add('active');
      btnTodos.style.background = 'var(--blue)';
      btnTodos.style.color = '#fff';
      btnTodos.style.borderColor = 'var(--blue)';
    }
  }
  columnasCustomActivas = [...DEFAULT_COLUMNAS_CUSTOM];
  guardarColumnasCustomActivas(columnasCustomActivas);
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
  mostrarToast('Columnas restablecidas por defecto', 'info');
};

window.cargarPlantillaReporte = function (tipo) {
  // Restablecer el filtro rápido de cargo si estaba en almuerzos extra
  if ($('filtroCargoReporte') && $('filtroCargoReporte').value === 'almuerzos extra') {
    $('filtroCargoReporte').value = '';
    const btns = document.querySelectorAll('#filtrosRapidosCargo .btn-filter, #filtrosRapidosCargo .btn-filter-pill');
    btns.forEach(b => {
      b.classList.remove('active');
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const btnTodos = Array.from(btns).find(b => b.textContent.trim().toUpperCase() === 'TODOS');
    if (btnTodos) {
      btnTodos.classList.add('active');
      btnTodos.style.background = 'var(--blue)';
      btnTodos.style.color = '#fff';
      btnTodos.style.borderColor = 'var(--blue)';
    }
  }
  if (tipo === 'almuerzos') {
    columnasCustomActivas = ['asistencias', 'almPlanta', 'almFuera'];
    mostrarToast('Plantilla de Almuerzos cargada', 'success');
  } else if (tipo === 'extras') {
    columnasCustomActivas = ['horasExtra50', 'horasExtra100', 'horasCampoNormales', 'horasCampo50', 'horasCampo100', 'totalExtras50', 'totalExtras100'];
    mostrarToast('Plantilla de Horas Extra cargada', 'success');
  } else if (tipo === 'asistencias') {
    columnasCustomActivas = ['asistencias', 'faltas', 'atrasos', 'minutosAtrasos', 'puntualidad'];
    mostrarToast('Plantilla de Asistencia y Atrasos cargada', 'success');
  } else if (tipo === 'completo') {
    columnasCustomActivas = COLUMNAS_DISPONIBLES.map(c => c.id);
    mostrarToast('Plantilla de Reporte Completo cargada', 'success');
  }
  guardarColumnasCustomActivas(columnasCustomActivas);
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
};

window.exportarExcelDetalleEmpleado = function (empleadoId, indexPeriodo, customInicio = null, customFin = null) {
  const empIdStr = String(empleadoId || '').trim();
  let e = empCache.find(x => String(x.id).trim() === empIdStr)
       || (window.empEliminadosCache || []).find(x => String(x.id).trim() === empIdStr)
       || (window._cacheDesvinculados || []).find(x => String(x.id).trim() === empIdStr);
  if (!e) {
    mostrarToast('Empleado no encontrado', 'error');
    return;
  }
  let periodo = periodos[indexPeriodo] || periodos[0];
  if (!periodo) {
    mostrarToast('Periodo no encontrado', 'error');
    return;
  }

  const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
  const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

  let R_INI = customInicio || (periodo ? periodo.inicio : '');
  let R_FIN = customFin || (periodo ? periodo.fin : '');

  let todosRegs = (e.registros || []).map(r => {
    const fNorm = normalizarFechaStr(r.fecha);
    return fNorm ? { ...r, fecha: fNorm } : r;
  });
  let regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN);

  let porDia = {};
  [...regs].sort((a, b) => {
    if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
    return String(a.hora || '').localeCompare(String(b.hora || ''));
  }).forEach(r => {
    const fechaNorm = normalizarFechaStr(r.fecha);
    if (!fechaNorm) return;
    if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
    porDia[fechaNorm].registros.push(r);
    if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
  });

  let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => b.localeCompare(a));

  let bodyHtml = '';

  // Inicializar acumuladores totales
  let totTP = 0, totTM = 0, totTJ = 0, totHoras = 0, totAtrasos = 0, totSalidaTemprana = 0;
  let totH50 = 0, totH100 = 0, totHCN = 0, totHC50 = 0, totHC100 = 0;
  let totExtra50 = 0, totExtra100 = 0;
  let totDescuentoBruto = 0;
  let rowCounter = 0;

  fechasOrdenadas.forEach(f => {
    const regsDia = porDia[f].registros;
    const d = porDia[f];
    const dayOfWeek = new Date(f + 'T12:00:00').getDay();
    const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
    const isJustificado = regsDia.some(r => {
      if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) return true;
      if (r.razon_ausencia && String(r.razon_ausencia).trim() !== '' && String(r.razon_ausencia).trim() !== '—') return true;
      const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
      if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'RETORNO_CAMPO', 'SALIDA_CAMPO'].includes(tipo)) return true;
      return false;
    });

    let periodosDia = [];
    let entradaPendiente = null;
    let ultimoSalidaMins = null;
    let ultimoSalidaReg = null;

    let sortedRegs = [...regsDia].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return String(a.hora || '').localeCompare(String(b.hora || ''));
    });

    sortedRegs.forEach(r => {
      const tipo = String(r.tipo || '').toUpperCase();
      if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
        entradaPendiente = r;
      } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
        if (entradaPendiente) {
          periodosDia.push({ entrada: entradaPendiente, salida: r });
          entradaPendiente = null;
        } else {
          periodosDia.push({ entrada: null, salida: r });
        }
      }
    });
    if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });
    if (periodosDia.length === 0) periodosDia.push({ entrada: null, salida: null });

    let horaE = periodosDia.map(p => p.entrada ? formatearHora(p.entrada.hora || p.entrada.timestamp) : '--:--').join(', ');
    let horaS = periodosDia.map(p => p.salida ? formatearHora(p.salida.hora || p.salida.timestamp) : '--:--').join(', ');

    let aBadgeVal = (d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? 'SI' : (d.almuerzo === 'NO' || d.almuerzo === 'FUERA') ? 'NO' : '—';

    let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO');
    let atrasoMins = 0;
    if (primerReg) {
      let mE = obtenerMinutos(primerReg.hora || primerReg.timestamp);
      let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
      if (mE !== null && mE > refEntrada + 5) atrasoMins = mE - refEntrada;
    }

    let razonAusenciaVal = '';
    let razonJustificadaVal = '';
    regsDia.forEach(r => {
      if (r.razon_ausencia) {
        razonAusenciaVal = r.razon_ausencia;
      } else if (r.tipo && esAusenciaTipo(r.tipo)) {
        const t = r.tipo.toUpperCase();
        if (t === 'VACACIONES' || t === 'VACACION') razonAusenciaVal = 'Vacación';
        else if (t === 'PERMISO_MEDICO') razonAusenciaVal = 'Permiso Médico';
        else if (t === 'PERMISO_PERSONAL') razonAusenciaVal = 'Permiso Personal';
        else if (t === 'CALAMIDAD_DOMESTICA') razonAusenciaVal = 'Calamidad Doméstica';
        else if (t === 'CUMPLEAÑOS' || t === 'CUMPLEANOS') razonAusenciaVal = 'Cumpleaños';
        else if (t === 'SALIDA_JUSTIFICADA') razonAusenciaVal = 'Salida Justificada';
      }
      if (r.razon_justificac) razonJustificadaVal = r.razon_justificac;
    });

    let razonText = razonAusenciaVal || razonJustificadaVal || '—';

    let h50 = 0, h100 = 0, hCN = 0, hC50 = 0, hC100 = 0;
    let minutosTrabajadosHoy = 0;
    let tiempoPersonal = 0;
    let tiempoMedico = 0;
    let tiempoPorJustificar = 0;



    ultimoSalidaMins = null;
    ultimoSalidaReg = null;

    let processedLunchGap = false;
    periodosDia.forEach(p => {
      if (!p.entrada || !p.salida) return;
      let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;

      let duracion = mS - mE;
      minutosTrabajadosHoy += duracion;

      if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
        let gap = mE - ultimoSalidaMins;
        if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
          let lunchMins = Math.min(45, gap);
          gap -= lunchMins;
          processedLunchGap = true;
        }
        if (gap > 0) {
          let clasif = clasificarGap(ultimoSalidaReg, gap);
          if (clasif.tipo === 'medico') {
            tiempoMedico += gap;
          } else if (clasif.tipo === 'personal') {
            tiempoPersonal += gap;
          } else {
            tiempoPorJustificar += gap;
          }
        }
      }
      ultimoSalidaMins = mS;
      ultimoSalidaReg = p.salida;
    });

    // Descontar almuerzo
    let netWorked = minutosTrabajadosHoy;
    if (!esFestivo && netWorked > 240) {
      netWorked -= 45;
    }

    let ultSalReg = [...regsDia].reverse().find(r => {
      const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
      return t.includes('SALIDA');
    });
    if (ultSalReg) {
      let mS = obtenerMinutos(ultSalReg.hora || ultSalReg.timestamp);
      if (mS !== null) ultimoSalidaMins = mS;
    }

    let minsSalidaTemprana = 0;
    let refSalida = esFestivo ? 975 : HORA_SALIDA_REF;
    if (!esFestivo && ultimoSalidaMins !== null && ultimoSalidaMins < refSalida) {
      minsSalidaTemprana = refSalida - ultimoSalidaMins;
    }

    // Horas extras independientes (no compensan faltantes)
    let autorizadoGlobal = regsDia.some(r => r.horasExtra === 'SI') || regsDia.some(r => (r.autoriza || '').includes('CAMPO'));
    if (esFestivo && netWorked > 60) {
      autorizadoGlobal = true;
    } else if (!esFestivo && netWorked >= 600) {
      autorizadoGlobal = true;
    }

    periodosDia.forEach(p => {
      if (!p.entrada || !p.salida) return;
      let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;
      let duracion = mS - mE;
      let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

      if (esFestivo) {
        if (enCampo) {
          if (autorizadoGlobal) hC100 += duracion;
        } else {
          if (autorizadoGlobal) h100 += duracion;
        }
      } else {
        let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
        if (enCampo) {
          if (mS <= H_INI || mE >= H_FIN) {
            hC50 += duracion;
          } else {
            let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
            let mExtra = duracion - mNormal;
            hCN += mNormal;
            hC50 += mExtra;
          }
        } else {
          if (autorizadoGlobal && mS > H_FIN) {
            h50 += (mS - Math.max(mE, H_FIN));
          }
        }
      }
    });

    let tiempoJustificado = 0;
    const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
    const justMins = regPermiso ? Number(regPermiso.tiempo_justificado_mins || 0) : 0;
    tiempoJustificado += justMins;

    const hasCumpleanos = regsDia.some(r => {
      const raz = String(r.razon_ausencia || '').toLowerCase();
      const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
      return raz.includes('cumplea') || raz.includes('cumplean') || tip.includes('CUMPLE');
    });
    if (hasCumpleanos) tiempoJustificado += 240;

    const esHoyOFuturo = f >= getLocalHoyStr();
    if (isJustificado || esHoyOFuturo) {
      tiempoPorJustificar = 0;
    } else {
      const persMins = (regPermiso && regPermiso.permiso_personal_mins) ? Number(regPermiso.permiso_personal_mins) : 0;
      const medMins = (regPermiso && regPermiso.permiso_medico_mins) ? Number(regPermiso.permiso_medico_mins) : 0;
      tiempoPersonal += persMins;
      tiempoMedico += medMins;
      let netWorkedOrdinario = (typeof calcularNetWorkedOrdinario === 'function') ? calcularNetWorkedOrdinario(periodosDia, esFestivo) : netWorked;
      let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorkedOrdinario);
      let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoJustificado + tiempoPorJustificar;
      let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
      tiempoPorJustificar += unaccountedMissing;
    }

    // Los 45 min de almuerzo son derecho del usuario y neutros: no computan como falta ni atraso
    let missingMinutesDia = esFestivo ? 0 : Math.max(0, 480 - ((typeof calcularNetWorkedOrdinario === 'function') ? calcularNetWorkedOrdinario(periodosDia, esFestivo) : netWorked));
    if (!esFestivo && (atrasoMins + minsSalidaTemprana) > missingMinutesDia) {
      atrasoMins = Math.max(0, missingMinutesDia - minsSalidaTemprana);
    }

    // Ajustar atrasos y salida temprana descontando permisos
    const originalAtrasoMins = atrasoMins;
    const originalSalidaTemprana = minsSalidaTemprana;
    if (isJustificado) {
      atrasoMins = 0;
      minsSalidaTemprana = 0;
    } else {
      const permisosTotales = tiempoPersonal + tiempoMedico + tiempoJustificado;
      atrasoMins = Math.max(0, originalAtrasoMins - permisosTotales);
      const permisosRestantes = Math.max(0, permisosTotales - originalAtrasoMins);
      minsSalidaTemprana = Math.max(0, originalSalidaTemprana - permisosRestantes);
    }
    // Horas netas trabajadas e independientes de permisos personales
    const descuentoDia = tiempoPersonal + (tiempoPorJustificar > 0 ? Math.max(tiempoPorJustificar, atrasoMins) : atrasoMins);
    totDescuentoBruto += descuentoDia;

    // Acumuladores
    totTP += tiempoPersonal;
    totTM += tiempoMedico;
    totTJ += tiempoPorJustificar;
    totHoras += netWorked;
    totAtrasos += atrasoMins;
    totSalidaTemprana += minsSalidaTemprana;
    totH50 += h50;
    totH100 += h100;
    totHCN += hCN;
    totHC50 += hC50;
    totHC100 += hC100;
    totExtra50 += (h50 + hC50);
    totExtra100 += (h100 + hC100);

    // Formatear fecha para mostrar
    let dObj = new Date(f + 'T12:00:00');
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    let fechaEx = `${diasSemana[dObj.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;

    // Contador para zebra striping
    const rowBg = (rowCounter % 2 === 0) ? '#ffffff' : '#f8fafc';
    rowCounter++;
    const tdTime = `style="background-color:${rowBg}; border:0.5pt solid #cbd5e1; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`;

      let tdDescStyle = (descuentoDia > 0)
        ? `style="background-color:#ffe4e6; color:#9f1239; font-weight:bold; border:0.5pt solid #fecdd3; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdAtrasoStyle = (atrasoMins > 0)
        ? `style="background-color:#fef3c7; color:#92400e; font-weight:bold; border:0.5pt solid #fde68a; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdSalidaTempStyle = (minsSalidaTemprana > 0)
        ? `style="background-color:#ffedd5; color:#c2410c; font-weight:bold; border:0.5pt solid #fed7aa; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdH50Style = (h50 > 0)
        ? `style="background-color:#eff6ff; color:#1d4ed8; font-weight:bold; border:0.5pt solid #bfdbfe; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdH100Style = (h100 > 0)
        ? `style="background-color:#eef2ff; color:#4338ca; font-weight:bold; border:0.5pt solid #c7d2fe; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdHCNStyle = (hCN > 0)
        ? `style="background-color:#ecfeff; color:#0891b2; font-weight:bold; border:0.5pt solid #a5f3fc; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdHC50Style = (hC50 > 0)
        ? `style="background-color:#ecfeff; color:#0e7490; font-weight:bold; border:0.5pt solid #a5f3fc; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdHC100Style = (hC100 > 0)
        ? `style="background-color:#ecfeff; color:#155e75; font-weight:bold; border:0.5pt solid #a5f3fc; height:26px; font-size:9pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdTot50Style = ((h50 + hC50) > 0)
        ? `style="background-color:#dbeafe; color:#1e3a8a; font-weight:bold; border-left:1pt solid #93c5fd; border-right:1pt solid #93c5fd; border-top:0.5pt solid #cbd5e1; border-bottom:0.5pt solid #cbd5e1; height:26px; font-size:9.5pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      let tdTot100Style = ((h100 + hC100) > 0)
        ? `style="background-color:#e0e7ff; color:#312e81; font-weight:bold; border-left:1pt solid #a5b4fc; border-right:1pt solid #a5b4fc; border-top:0.5pt solid #cbd5e1; border-bottom:0.5pt solid #cbd5e1; height:26px; font-size:9.5pt; font-family:Consolas, monospace; text-align:center; padding:3px 6px; mso-number-format:\\@;"`
        : tdTime;

      bodyHtml += `<tr>
          <td style="background-color:${rowBg}; font-weight:600; color:#0f172a; text-align:center; border:0.5pt solid #cbd5e1; height:26px;">${fechaEx}</td>
          <td ${tdTime}>${horaE}</td>
          <td ${tdTime}>${horaS}</td>
          <td ${tdTime}>${tiempoPersonal > 0 ? minutosAHHMMSS(tiempoPersonal) : '—'}</td>
          <td ${tdTime}>${tiempoMedico > 0 ? minutosAHHMMSS(tiempoMedico) : '—'}</td>
          <td ${tdTime}>${tiempoPorJustificar > 0 ? minutosAHHMMSS(tiempoPorJustificar) : '—'}</td>
          <td ${tdDescStyle}>${descuentoDia > 0 ? minutosAHHMMSS(descuentoDia) : '—'}</td>
          <td style="background-color:${rowBg}; font-weight:600; color:#0f172a; font-family:Consolas, monospace; font-size:9pt; text-align:center; border:0.5pt solid #cbd5e1; height:26px; mso-number-format:\\@;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
          <td style="background-color:${rowBg}; text-align:center; border:0.5pt solid #cbd5e1; height:26px; font-weight:600; color:${aBadgeVal === 'SI' ? '#047857' : aBadgeVal === 'NO' ? '#b91c1c' : '#94a3b8'};">${aBadgeVal}</td>
          <td style="background-color:${rowBg}; text-align:center; border:0.5pt solid #cbd5e1; height:26px; font-weight:bold; color:${autorizadoGlobal ? '#1d4ed8' : '#94a3b8'};">${autorizadoGlobal ? 'SI' : 'NO'}</td>
          <td style="background-color:${rowBg}; border:0.5pt solid #cbd5e1; height:26px; font-size:9pt; color:#334155; padding:3px 6px;">${escapeHtml(razonText)}</td>
          <td ${tdAtrasoStyle}>${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
          <td ${tdSalidaTempStyle}>${minsSalidaTemprana > 0 ? minutosAHHMMSS(minsSalidaTemprana) : '—'}</td>
          <td ${tdH50Style}>${h50 > 0 ? minutosAHHMMSS(h50) : '—'}</td>
          <td ${tdH100Style}>${h100 > 0 ? minutosAHHMMSS(h100) : '—'}</td>
          <td ${tdHCNStyle}>${hCN > 0 ? minutosAHHMMSS(hCN) : '—'}</td>
          <td ${tdHC50Style}>${hC50 > 0 ? minutosAHHMMSS(hC50) : '—'}</td>
          <td ${tdHC100Style}>${hC100 > 0 ? minutosAHHMMSS(hC100) : '—'}</td>
          <td ${tdTot50Style}>${(h50 + hC50) > 0 ? minutosAHHMMSS(h50 + hC50) : '—'}</td>
          <td ${tdTot100Style}>${(h100 + hC100) > 0 ? minutosAHHMMSS(h100 + hC100) : '—'}</td>
        </tr>`;
    });

  const totDescontarFinal = Math.max(0, totDescuentoBruto - 240);

  // Fila de totales corporativa
  let footerHtml = `
    <tr>
      <td colspan="3" style="background-color:#0f172a; color:#ffffff; font-weight:bold; text-align:left; height:34px; border:1pt solid #0f172a; font-size:10pt; padding:6px 10px; letter-spacing:0.5px;">TOTALES DEL PERÍODO</td>
      <td style="background-color:#0f172a; color:#c4b5fd; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totTP)}</td>
      <td style="background-color:#0f172a; color:#5eead4; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totTM)}</td>
      <td style="background-color:#0f172a; color:#f0abfc; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totTJ)}</td>
      <td style="background-color:#0f172a; color:#fda4af; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totDescontarFinal)}</td>
      <td style="background-color:#0f172a; color:#fde047; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totHoras)}</td>
      <td style="background-color:#0f172a; color:#ffffff; text-align:center; border:1pt solid #0f172a;">—</td>
      <td style="background-color:#0f172a; color:#ffffff; text-align:center; border:1pt solid #0f172a;">—</td>
      <td style="background-color:#0f172a; color:#ffffff; text-align:center; border:1pt solid #0f172a;">—</td>
      <td style="background-color:#0f172a; color:#fcd34d; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totAtrasos)}</td>
      <td style="background-color:#0f172a; color:#fdba74; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totSalidaTemprana)}</td>
      <td style="background-color:#0f172a; color:#93c5fd; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totH50)}</td>
      <td style="background-color:#0f172a; color:#a5b4fc; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totH100)}</td>
      <td style="background-color:#0f172a; color:#67e8f9; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totHCN)}</td>
      <td style="background-color:#0f172a; color:#22d3ee; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totHC50)}</td>
      <td style="background-color:#0f172a; color:#06b6d4; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totHC100)}</td>
      <td style="background-color:#0f172a; color:#38bdf8; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:10pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totExtra50)}</td>
      <td style="background-color:#0f172a; color:#818cf8; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:10pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(totExtra100)}</td>
    </tr>
  `;

  let excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Reporte Individual</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                    <x:Print>
                      <x:Orientation>Landscape</x:Orientation>
                    </x:Print>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            table { border-collapse:collapse; font-family:Arial, sans-serif; }
            th { font-family:Arial, sans-serif; }
            td { font-family:Arial, sans-serif; }
          </style>
        </head>
        <body>
          <table>
            <!-- BANNER DE ENCABEZADO CORPORATIVO -->
            <tr>
              <td colspan="20" style="background-color:#0f172a; color:#ffffff; font-size:15pt; font-weight:bold; height:42px; text-align:center; vertical-align:middle; border:1pt solid #0f172a; letter-spacing:1px;">
                TCONTROL S.A. &mdash; REPORTE INDIVIDUAL DE ASISTENCIA Y CONTROL LABORAL
              </td>
            </tr>
            <tr>
              <td colspan="20" style="background-color:#1e293b; color:#94a3b8; font-size:9pt; height:24px; text-align:center; vertical-align:middle; border:1pt solid #1e293b;">
                Colaborador: <strong style="color:#ffffff;">${escapeHtml(e.nombre)}</strong> &nbsp;|&nbsp;
                ID: <strong style="color:#38bdf8;">${escapeHtml(e.id)}</strong> &nbsp;|&nbsp;
                Período: <strong style="color:#ffffff;">${periodo.label}</strong> (Rango: ${R_INI} al ${R_FIN}) &nbsp;|&nbsp;
                Generado: <strong style="color:#ffffff;">${formatearTimestampCompleto(new Date())}</strong>
              </td>
            </tr>
            <tr><td colspan="20" style="height:12px; border:none;"></td></tr>
            <thead>
              <tr>
                <th colspan="3" style="background-color:#1e293b; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #334155; font-size:9.5pt; letter-spacing:0.5px;">MARCACIONES</th>
                <th colspan="4" style="background-color:#6d28d9; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9.5pt; letter-spacing:0.5px;">PERMISOS Y DESCUENTOS</th>
                <th colspan="4" style="background-color:#0369a1; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9.5pt; letter-spacing:0.5px;">JORNADA Y ESTADO</th>
                <th colspan="2" style="background-color:#b45309; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9.5pt; letter-spacing:0.5px;">NOVEDADES</th>
                <th colspan="5" style="background-color:#1e40af; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9.5pt; letter-spacing:0.5px;">HORAS EXTRAORDINARIAS & CAMPO</th>
                <th colspan="2" style="background-color:#1e1b4b; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9.5pt; letter-spacing:0.5px;">TOTALES EXTRAS NÓMINA</th>
              </tr>
              <tr>
                <th style="background-color:#334155; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">FECHA</th>
                <th style="background-color:#334155; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">ENTRADA</th>
                <th style="background-color:#334155; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">SALIDA</th>
                <th style="background-color:#7c3aed; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">T. PERSONAL</th>
                <th style="background-color:#0d9488; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">T. MÉDICO</th>
                <th style="background-color:#c026d3; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">POR JUSTIFICAR</th>
                <th style="background-color:#be123c; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">A DESCONTAR</th>
                <th style="background-color:#0369a1; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">TOTAL HORAS</th>
                <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">ALMUERZO</th>
                <th style="background-color:#475569; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">AUTORIZ. H.E.</th>
                <th style="background-color:#475569; color:#ffffff; font-weight:bold; height:34px; text-align:left; border:0.5pt solid #475569; font-size:9pt; padding-left:6px; min-width:140px;">RAZÓN / ESTADO</th>
                <th style="background-color:#b45309; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">ATRASOS</th>
                <th style="background-color:#c2410c; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">SALIDA TEMP.</th>
                <th style="background-color:#1d4ed8; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">H. EXTRA 50%</th>
                <th style="background-color:#4338ca; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">H. EXTRA 100%</th>
                <th style="background-color:#0891b2; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">CAMPO NORMAL</th>
                <th style="background-color:#0e7490; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">CAMPO 50%</th>
                <th style="background-color:#155e75; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">CAMPO 100%</th>
                <th style="background-color:#1e3a8a; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">TOTAL 50%</th>
                <th style="background-color:#312e81; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt;">TOTAL 100%</th>
              </tr>
            </thead>
            <tbody>
              ${bodyHtml}
              ${footerHtml}
            </tbody>
            <tfoot>
              <tr><td colspan="20" style="height:14px; border:none;"></td></tr>
              <tr>
                <td colspan="20" style="background-color:#f8fafc; color:#64748b; font-size:8pt; font-style:italic; border:0.5pt solid #cbd5e1; height:24px; padding:4px 8px; text-align:center;">
                  CONFIDENCIAL &mdash; TCONTROL S.A. | Información laboral individual protegida por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador) y el Código del Trabajo.
                </td>
              </tr>
              <tr><td colspan="20" style="height:35px; border:none;"></td></tr>
              <tr>
                <td colspan="6" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
                  FIRMA DEL COLABORADOR<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">${escapeHtml(e.nombre)}</span>
                </td>
                <td colspan="7" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
                  SUPERVISOR DIRECTO<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">Control de Asistencia y Turnos</span>
                </td>
                <td colspan="7" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
                  TALENTO HUMANO / NÓMINA<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">Auditoría y Liquidación</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </body>
        </html>
      `;

  const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Reporte_Individual_${e.nombre.replace(/ /g, '_')}_${R_INI}_a_${R_FIN}.xls`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast('Reporte individual exportado a Excel con éxito', 'success');
};

window.exportarExcelReporteCustom = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const rango = (typeof window.obtenerRangoFechasReportes === 'function')
    ? window.obtenerRangoFechasReportes()
    : { R_INI: '', R_FIN: '', labelRango: 'Reporte', labelCorto: 'Reporte', esFiltroPersonalizado: false };
  let periodoStr = rango.labelRango;
  let safeFileName = (rango.labelCorto || 'Reporte').replace(/[^a-zA-Z0-9_\-]/g, '_');

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    extras = window.obtenerAlmuerzosExtraConsolidados(rango.R_INI, rango.R_FIN);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    const baseData = (window._reportesCustomData && window._reportesCustomData.length)
      ? window._reportesCustomData
      : (_reportesCustomData && _reportesCustomData.length ? _reportesCustomData : (window._reportesData || []));
    hasData = baseData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para exportar', 'warning');
    return;
  }

  let tableContentHtml = '';
  let totalCols = 0;

  if (fCargo === 'almuerzos extra') {
    totalCols = 6;
    let totalCant = extras.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
    let rowsHtml = extras.map((ae, idx) => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      const rowBg = (idx % 2 === 0) ? '#ffffff' : '#f8fafc';
      return `<tr>
            <td style="background-color:${rowBg}; font-family:Consolas, monospace; font-size:10pt; text-align:center; border:0.5pt solid #cbd5e1; height:26px; mso-number-format:\\@;">${dateStr}</td>
            <td style="background-color:${rowBg}; font-weight:600; color:#0f172a; border:0.5pt solid #cbd5e1; padding:4px 8px; height:26px;">${escapeHtml(ae.nombre || 'Almuerzo Extra')}</td>
            <td style="background-color:${rowBg}; text-align:center; font-weight:bold; color:#0284c7; border:0.5pt solid #cbd5e1; height:26px;">${ae.cantidad || 1}</td>
            <td style="background-color:${rowBg}; color:#334155; border:0.5pt solid #cbd5e1; padding:4px 8px; height:26px;">${escapeHtml(ae.empresa || '—')}</td>
            <td style="background-color:${rowBg}; color:#475569; border:0.5pt solid #cbd5e1; padding:4px 8px; height:26px;">${escapeHtml(ae.observaciones || '—')}</td>
            <td style="background-color:${rowBg}; text-align:center; font-weight:600; color:#047857; border:0.5pt solid #cbd5e1; height:26px;">${escapeHtml(ae.tipo || 'Manual')}</td>
          </tr>`;
    }).join('');

    tableContentHtml = `
      <thead>
        <tr>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:center; border:0.5pt solid #0369a1; font-size:10pt;">FECHA</th>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:left; border:0.5pt solid #0369a1; font-size:10pt; padding-left:8px;">DESCRIPCIÓN</th>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:center; border:0.5pt solid #0369a1; font-size:10pt;">CANTIDAD</th>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:left; border:0.5pt solid #0369a1; font-size:10pt; padding-left:8px;">EMPRESA / DESTINO</th>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:left; border:0.5pt solid #0369a1; font-size:10pt; padding-left:8px;">OBSERVACIONES</th>
          <th style="background-color:#0284c7; color:#ffffff; font-weight:bold; height:32px; text-align:center; border:0.5pt solid #0369a1; font-size:10pt;">TIPO</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr>
          <td colspan="2" style="background-color:#0f172a; color:#ffffff; font-weight:bold; text-align:left; height:32px; border:1pt solid #0f172a; font-size:10pt; padding-left:8px;">TOTAL ALMUERZOS EXTRAS CONSOLIDADOS</td>
          <td style="background-color:#0f172a; color:#fde047; font-weight:bold; text-align:center; height:32px; border:1pt solid #0f172a; font-size:11pt;">${totalCant}</td>
          <td colspan="3" style="background-color:#0f172a; color:#94a3b8; font-size:9pt; text-align:left; border:1pt solid #0f172a; padding-left:8px;">${extras.length} Registros de consumo</td>
        </tr>
      </tbody>
    `;
  } else {
    // 1. Columnas activas ordenadas
    const activeCols = COLUMNAS_DISPONIBLES.filter(col => columnasCustomActivas.includes(col.id));
    totalCols = activeCols.length + 2; // Empleado + Área + Columnas

    // 2. Super-Headers organizados por categorías
    const CAT_STYLES = {
      asistencia: { label: 'ASISTENCIA Y PUNTUALIDAD', bg: '#065f46', color: '#ffffff' },
      almuerzos: { label: 'ALMUERZOS', bg: '#0369a1', color: '#ffffff' },
      permisos: { label: 'PERMISOS Y DESCUENTOS', bg: '#6d28d9', color: '#ffffff' },
      extras: { label: 'HORAS EXTRAORDINARIAS', bg: '#1e40af', color: '#ffffff' },
      campo: { label: 'TRABAJO EN CAMPO', bg: '#0e7490', color: '#ffffff' },
      totalesExtras: { label: 'TOTALES EXTRAS NÓMINA', bg: '#1e1b4b', color: '#ffffff' },
      general: { label: 'INFORMACIÓN GENERAL', bg: '#334155', color: '#ffffff' }
    };

    let superHeadersHtml = `<th colspan="2" style="background-color:#1e293b; color:#ffffff; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #334155; font-size:9.5pt; letter-spacing:0.5px;">DATOS DEL COLABORADOR</th>`;

    let currentCat = null;
    let currentCatCount = 0;
    activeCols.forEach((col, idx) => {
      const cat = col.cat || 'general';
      if (cat !== currentCat) {
        if (currentCat !== null) {
          const cfg = CAT_STYLES[currentCat] || { label: currentCat.toUpperCase(), bg: '#334155', color: '#ffffff' };
          superHeadersHtml += `<th colspan="${currentCatCount}" style="background-color:${cfg.bg}; color:${cfg.color}; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9pt; letter-spacing:0.5px;">${cfg.label}</th>`;
        }
        currentCat = cat;
        currentCatCount = 1;
      } else {
        currentCatCount++;
      }
      if (idx === activeCols.length - 1) {
        const cfg = CAT_STYLES[currentCat] || { label: currentCat.toUpperCase(), bg: '#334155', color: '#ffffff' };
        superHeadersHtml += `<th colspan="${currentCatCount}" style="background-color:${cfg.bg}; color:${cfg.color}; font-weight:bold; text-align:center; height:28px; border:0.5pt solid #475569; font-size:9pt; letter-spacing:0.5px;">${cfg.label}</th>`;
      }
    });

    // 3. Column Headers individuales con sus colores específicos
    let colHeadersHtml = `
      <th style="background-color:#334155; color:#ffffff; font-weight:bold; height:34px; text-align:left; border:0.5pt solid #475569; font-size:9.5pt; padding:4px 8px; min-width:200px;">COLABORADOR</th>
      <th style="background-color:#334155; color:#ffffff; font-weight:bold; height:34px; text-align:left; border:0.5pt solid #475569; font-size:9.5pt; padding:4px 8px; min-width:130px;">ÁREA / CARGO</th>
    `;
    activeCols.forEach(col => {
      colHeadersHtml += `<th style="background-color:${col.colorHeader || '#1e40af'}; color:#ffffff; font-weight:bold; height:34px; text-align:center; border:0.5pt solid #475569; font-size:9pt; padding:4px 6px; text-transform:uppercase; min-width:85px;">${col.label}</th>`;
    });

    // 4. Filas de datos con Zebra Striping y destacados contextuales
    let data = window.obtenerDatosFiltradosReporteCustom(q, fCargo);

    let rowsHtml = data.map((e, rowIndex) => {
      const rowBg = (rowIndex % 2 === 0) ? '#ffffff' : '#f8fafc';
      let rowCells = `
        <td style="background-color:${rowBg}; color:#0f172a; font-weight:600; text-align:left; border:0.5pt solid #cbd5e1; padding:5px 8px; height:26px;">${escapeHtml(e.nombre)}</td>
        <td style="background-color:${rowBg}; color:#475569; text-align:left; border:0.5pt solid #cbd5e1; padding:5px 8px; height:26px;">${escapeHtml(e.area || '—')}</td>
      `;

      activeCols.forEach(col => {
        const valor = e[col.id];
        let displayVal = '';
        let cellBg = rowBg;
        let cellColor = '#1e293b';
        let cellWeight = 'normal';
        let cellFont = 'Arial, sans-serif';
        let borderCustom = '';

        if (col.tipo === 'tiempo') {
          const mins = Number(valor) || 0;
          displayVal = (mins > 0) ? minutosAHHMMSS(mins) : '—';
          cellFont = 'Consolas, monospace';
          if (col.id === 'minutosAtrasos' && mins > 0) {
            cellBg = '#fef3c7'; cellColor = '#92400e'; cellWeight = 'bold';
          } else if (col.id === 'tiempoADescontar' && mins > 0) {
            cellBg = '#ffe4e6'; cellColor = '#9f1239'; cellWeight = 'bold';
          } else if (col.id === 'horasExtra50' && mins > 0) {
            cellBg = '#eff6ff'; cellColor = '#1d4ed8'; cellWeight = 'bold';
          } else if (col.id === 'horasExtra100' && mins > 0) {
            cellBg = '#eef2ff'; cellColor = '#4338ca'; cellWeight = 'bold';
          } else if (col.id === 'totalExtras50' && mins > 0) {
            cellBg = '#dbeafe'; cellColor = '#1e3a8a'; cellWeight = 'bold';
            borderCustom = 'border-left:1pt solid #93c5fd; border-right:1pt solid #93c5fd;';
          } else if (col.id === 'totalExtras100' && mins > 0) {
            cellBg = '#e0e7ff'; cellColor = '#312e81'; cellWeight = 'bold';
            borderCustom = 'border-left:1pt solid #a5b4fc; border-right:1pt solid #a5b4fc;';
          } else if (col.cat === 'campo' && mins > 0) {
            cellBg = '#ecfeff'; cellColor = '#0891b2'; cellWeight = 'bold';
          } else if (col.cat === 'permisos' && mins > 0) {
            cellBg = '#f5f3ff'; cellColor = '#7c3aed'; cellWeight = 'bold';
          } else if (mins === 0) {
            cellColor = '#94a3b8';
          }
        } else if (col.tipo === 'pct') {
          const num = Number(valor) || 0;
          displayVal = `${num}%`;
          cellWeight = 'bold';
          if (num >= 90) {
            cellBg = '#dcfce7'; cellColor = '#15803d';
          } else if (num >= 75) {
            cellBg = '#fef9c3'; cellColor = '#854d0e';
          } else {
            cellBg = '#fee2e2'; cellColor = '#991b1b';
          }
        } else {
          const num = Number(valor) || 0;
          displayVal = num;
          if (col.id === 'faltas') {
            if (num > 0) {
              cellBg = '#fee2e2'; cellColor = '#991b1b'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'diasCampo') {
            if (num > 0) {
              cellBg = '#ecfeff'; cellColor = '#0891b2'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'diasVacaciones') {
            if (num > 0) {
              cellBg = '#ecfdf5'; cellColor = '#059669'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'diasJustificados') {
            if (num > 0) {
              cellBg = '#f5f3ff'; cellColor = '#7c3aed'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'diasExtras') {
            if (num > 0) {
              cellBg = '#eef2ff'; cellColor = '#4338ca'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'atrasos') {
            if (num > 0) {
              cellBg = '#fef3c7'; cellColor = '#92400e'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'asistencias') {
            if (num > 0) {
              cellBg = '#ecfdf5'; cellColor = '#047857'; cellWeight = 'bold';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (col.id === 'almPlanta' || col.id === 'almFuera') {
            if (num > 0) {
              cellBg = '#f0f9ff'; cellColor = '#0369a1'; cellWeight = '600';
            } else {
              cellColor = '#94a3b8';
            }
          } else if (num === 0) {
            cellColor = '#94a3b8';
          }
        }

        rowCells += `<td style="background-color:${cellBg}; color:${cellColor}; font-weight:${cellWeight}; font-family:${cellFont}; font-size:9.5pt; text-align:center; border:0.5pt solid #cbd5e1; height:26px; padding:3px 6px; ${borderCustom} mso-number-format:\\@;">${displayVal}</td>`;
      });

      return `<tr>${rowCells}</tr>`;
    }).join('');

    // 5. Fila de Totales / Promedios consolidada
    let totalsCellsHtml = `<td colspan="2" style="background-color:#0f172a; color:#ffffff; font-weight:bold; text-align:left; height:34px; border:1pt solid #0f172a; font-size:10pt; padding:6px 10px; letter-spacing:0.5px;">TOTALES / PROMEDIOS (${data.length} COLABORADORES)</td>`;

    activeCols.forEach(col => {
      if (col.tipo === 'pct') {
        const avg = data.length ? Math.round(data.reduce((acc, e) => acc + (Number(e[col.id]) || 0), 0) / data.length) : 0;
        totalsCellsHtml += `<td style="background-color:#0f172a; color:#4ade80; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:10pt; mso-number-format:\\@;">${avg}%</td>`;
      } else if (col.tipo === 'tiempo') {
        const sum = data.reduce((acc, e) => acc + (Number(e[col.id]) || 0), 0);
        totalsCellsHtml += `<td style="background-color:#0f172a; color:#fde047; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:9.5pt; font-family:Consolas, monospace; mso-number-format:\\@;">${minutosAHHMMSS(sum)}</td>`;
      } else {
        const sum = data.reduce((acc, e) => acc + (Number(e[col.id]) || 0), 0);
        totalsCellsHtml += `<td style="background-color:#0f172a; color:#ffffff; font-weight:bold; text-align:center; height:34px; border:1pt solid #0f172a; font-size:10pt;">${sum}</td>`;
      }
    });

    tableContentHtml = `
      <thead>
        <tr>${superHeadersHtml}</tr>
        <tr>${colHeadersHtml}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr>${totalsCellsHtml}</tr>
      </tbody>
    `;
  }

  // Signature columns count
  const sigCol1 = Math.max(1, Math.floor(totalCols / 3));
  const sigCol2 = Math.max(1, Math.floor(totalCols / 3));
  const sigCol3 = Math.max(1, totalCols - sigCol1 - sigCol2);

  // Formato HTML corporativo premium para Microsoft Excel
  let excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Reporte Asistencia</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
                <x:Print>
                  <x:Orientation>Landscape</x:Orientation>
                </x:Print>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        table { border-collapse:collapse; font-family:Arial, sans-serif; }
        th { font-family:Arial, sans-serif; }
        td { font-family:Arial, sans-serif; }
      </style>
    </head>
    <body>
      <table>
        <!-- BANNER DE ENCABEZADO CORPORATIVO -->
        <tr>
          <td colspan="${totalCols}" style="background-color:#0f172a; color:#ffffff; font-size:15pt; font-weight:bold; height:42px; text-align:center; vertical-align:middle; border:1pt solid #0f172a; letter-spacing:1px;">
            TCONTROL S.A. &mdash; REPORTE CONSOLIDADO DE ASISTENCIA Y NÓMINA
          </td>
        </tr>
        <tr>
          <td colspan="${totalCols}" style="background-color:#1e293b; color:#94a3b8; font-size:9pt; height:24px; text-align:center; vertical-align:middle; border:1pt solid #1e293b;">
            ${rango.esFiltroPersonalizado ? 'Rango de Fechas' : 'Período Nómina'}: <strong style="color:#38bdf8;">${periodoStr}</strong> &nbsp;|&nbsp; 
            Filtro: <strong style="color:#ffffff;">${fCargo ? fCargo.toUpperCase() : 'TODOS LOS COLABORADORES'}</strong> &nbsp;|&nbsp; 
            Generado: <strong style="color:#ffffff;">${formatearTimestampCompleto(new Date())}</strong>
          </td>
        </tr>
        <tr><td colspan="${totalCols}" style="height:12px; border:none;"></td></tr>

        ${tableContentHtml}

        <!-- PIE DE PÁGINA Y AUDITORÍA PATRONAL -->
        <tr><td colspan="${totalCols}" style="height:14px; border:none;"></td></tr>
        <tr>
          <td colspan="${totalCols}" style="background-color:#f8fafc; color:#64748b; font-size:8pt; font-style:italic; border:0.5pt solid #cbd5e1; height:24px; padding:4px 8px; text-align:center;">
            CONFIDENCIAL &mdash; TCONTROL S.A. | Información laboral protegida por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador) y el Código del Trabajo. Exclusivo para gestión interna y auditoría patronal autorizada.
          </td>
        </tr>
        <tr><td colspan="${totalCols}" style="height:35px; border:none;"></td></tr>
        <tr>
          <td colspan="${sigCol1}" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
            ELABORADO POR<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">Supervisor de Turno / RRHH</span>
          </td>
          <td colspan="${sigCol2}" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
            REVISADO POR<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">Jefatura de Talento Humano</span>
          </td>
          <td colspan="${sigCol3}" style="border-top:1.5pt solid #475569; text-align:center; font-size:9pt; font-weight:bold; color:#1e293b; padding-top:6px;">
            APROBADO POR<br><span style="font-size:8pt; font-weight:normal; color:#64748b;">Gerencia General / Auditoría</span>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Reporte_Asistencia_${safeFileName}.xls`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast('Reporte exportado a Excel con estilos premium', 'success');
};

window.exportarGoogleSheetsReporteCustom = async function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const rango = (typeof window.obtenerRangoFechasReportes === 'function')
    ? window.obtenerRangoFechasReportes()
    : { R_INI: '', R_FIN: '', labelRango: 'Reporte', labelCorto: 'Reporte', esFiltroPersonalizado: false };

  // Nombre de hoja seguro (max 30 chars, sin caracteres ilegales para pestaña de Google Sheets)
  let prefix = fCargo === 'almuerzos extra' ? 'AlmExt' : 'Rep';
  let safeTabName = `${prefix}_${(rango.labelCorto || 'Rep').replace(/[^a-zA-Z0-9]/g, '_')}`.substring(0, 30);
  let nombreHoja = safeTabName;

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    extras = window.obtenerAlmuerzosExtraConsolidados(rango.R_INI, rango.R_FIN);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    const baseData = (window._reportesCustomData && window._reportesCustomData.length)
      ? window._reportesCustomData
      : (_reportesCustomData && _reportesCustomData.length ? _reportesCustomData : (window._reportesData || []));
    hasData = baseData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para exportar', 'warning');
    return;
  }

  // Construir cabeceras y filas
  let headers = [];
  let filas = [];

  if (fCargo === 'almuerzos extra') {
    headers = ['Fecha', 'Descripción', 'Cantidad', 'Empresa/Destino', 'Observaciones', 'Tipo'];
    filas = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return [
        dateStr,
        ae.nombre || 'Almuerzo Extra',
        ae.cantidad || 1,
        ae.empresa || '',
        ae.observaciones || '',
        ae.tipo || 'Manual'
      ];
    });
  } else {
    headers = ['Empleado', 'Área'];
    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        headers.push(col.label);
      }
    });

    let data = window.obtenerDatosFiltradosReporteCustom(q, fCargo);

    filas = data.map(e => {
      let fila = [e.nombre, e.area || ''];
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          const valor = e[col.id];
          if (col.tipo === 'tiempo') {
            fila.push(minutosAHHMMSS(valor));
          } else if (col.tipo === 'pct') {
            fila.push(`${valor}%`);
          } else {
            fila.push(valor);
          }
        }
      });
      return fila;
    });
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'crearReporteGoogleSheets',
      nombreReporte: nombreHoja,
      headers: JSON.stringify(headers),
      filas: JSON.stringify(filas)
    });
    mostrarLoader(false);
    if (res && res.ok) {
      if (res.url) {
        mostrarToast('¡Reporte exportado con éxito! <a href="' + res.url + '" target="_blank" style="text-decoration:underline;color:white;font-weight:bold;margin-left:6px;">Abrir Google Sheets <i class="fas fa-external-link-alt"></i></a>', 'success');
        try {
          window.open(res.url, '_blank');
        } catch (e) {
          console.log("window.open blocked by popup blocker:", e);
        }
      } else {
        mostrarToast('¡Reporte exportado a Google Sheets con éxito!', 'success');
      }
    } else {
      mostrarToast(res?.error || 'Error al exportar a Google Sheets', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    mostrarToast('Error de red al conectar con Google Sheets: ' + err.message, 'error');
  }
};

window.imprimirReporteCustom = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const rango = (typeof window.obtenerRangoFechasReportes === 'function')
    ? window.obtenerRangoFechasReportes()
    : { R_INI: '', R_FIN: '', labelRango: 'Reporte', labelCorto: 'Reporte', esFiltroPersonalizado: false };
  let periodoStr = rango.labelRango;

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    extras = window.obtenerAlmuerzosExtraConsolidados(rango.R_INI, rango.R_FIN);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    const baseData = (window._reportesCustomData && window._reportesCustomData.length)
      ? window._reportesCustomData
      : (_reportesCustomData && _reportesCustomData.length ? _reportesCustomData : (window._reportesData || []));
    hasData = baseData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para imprimir', 'warning');
    return;
  }

  let printWindow = window.open('', '_blank');
  if (!printWindow) {
    mostrarToast('Error al abrir la ventana de impresión. Por favor habilite los pop-ups.', 'error');
    return;
  }

  // Generar headers y filas de impresión
  let headersHtml = '';
  let bodyHtml = '';
  let totalMetaLabel = '';
  let tituloReporte = '';

  if (fCargo === 'almuerzos extra') {
    headersHtml = '<th>Fecha</th><th>Descripción</th><th style="text-align:center;">Cantidad</th><th>Empresa/Destino</th><th>Observaciones</th><th>Tipo</th>';
    tituloReporte = 'TCONTROL S.A. - REPORTE DE ALMUERZOS EXTRAS';
    let totalQty = extras.reduce((sum, ae) => sum + parseInt(ae.cantidad || 0), 0);
    totalMetaLabel = `Total Almuerzos Extras: ${totalQty} | Registros: ${extras.length}`;

    bodyHtml = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return `<tr>
            <td style="font-family:monospace;">${dateStr}</td>
            <td style="font-weight:600;">${escapeHtml(ae.nombre || 'Almuerzo Extra')}</td>
            <td style="text-align:center;">${ae.cantidad || 1}</td>
            <td>${escapeHtml(ae.empresa || '—')}</td>
            <td>${escapeHtml(ae.observaciones || '—')}</td>
            <td>${escapeHtml(ae.tipo || 'Manual')}</td>
          </tr>`;
    }).join('');
  } else {
    headersHtml = '<th>Empleado</th><th>Área</th>';
    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        headersHtml += `<th>${col.label}</th>`;
      }
    });
    tituloReporte = 'TCONTROL S.A. - REPORTE OFICIAL DE ASISTENCIA';

    let data = window.obtenerDatosFiltradosReporteCustom(q, fCargo);
    totalMetaLabel = `Total Empleados Evaluados: ${data.length}`;

    bodyHtml = data.map(e => {
      let rowHtml = `<tr><td style="font-weight:600;">${escapeHtml(e.nombre)}</td><td>${escapeHtml(e.area || '—')}</td>`;
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          const valor = e[col.id];
          let contenido = '';
          if (col.tipo === 'tiempo') {
            contenido = minutosAHHMMSS(valor);
          } else if (col.tipo === 'pct') {
            contenido = `${valor}%`;
          } else {
            contenido = valor;
          }
          rowHtml += `<td style="text-align:center;">${contenido}</td>`;
        }
      });
      rowHtml += '</tr>';
      return rowHtml;
    }).join('');
  }

  printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${tituloReporte} - ${periodoStr}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #333;
              padding: 20px;
              margin: 0;
            }
            .header {
              text-align: center;
              margin-bottom: 25px;
              border-bottom: 3px solid #1e40af;
              padding-bottom: 12px;
            }
            .header h1 {
              margin: 0;
              font-size: 22px;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .header p {
              margin: 6px 0 0 0;
              font-size: 13px;
              color: #4b5563;
              font-weight: bold;
            }
            .info-meta {
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              color: #64748b;
              margin-bottom: 15px;
              font-weight: 600;
              background: #f8fafc;
              padding: 8px 12px;
              border-radius: 6px;
              border: 1px solid #e2e8f0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th {
              background-color: #1e40af;
              color: #ffffff;
              font-weight: bold;
              text-align: left;
              padding: 8px 6px;
              font-size: 10px;
              text-transform: uppercase;
              border: 1px solid #cbd5e1;
            }
            td {
              padding: 7px 6px;
              font-size: 10px;
              border: 1px solid #cbd5e1;
            }
            tr:nth-child(even) {
              background-color: #f8fafc;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              font-size: 10px;
              color: #94a3b8;
              border-top: 1px dashed #cbd5e1;
              padding-top: 15px;
            }
            @page {
              size: A4 landscape;
              margin: 12mm;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${tituloReporte}</h1>
            <p>${rango.esFiltroPersonalizado ? 'Filtro de Fechas: ' : 'Período: '}${periodoStr}</p>
          </div>
          <div class="info-meta">
            <div>Generado el: ${formatearTimestampCompleto(new Date())}</div>
            <div>${totalMetaLabel}</div>
          </div>
          <table>
            <thead>
              <tr>${headersHtml}</tr>
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
          </table>
          <div class="footer">
            <strong>TCONTROL S.A.</strong> — Sistema de Gestión de Asistencia y Jornada Laboral CONTROL 2026<br>
            <span style="font-size: 8.5px; color: #64748b;">DOCUMENTO CONFIDENCIAL: Contiene datos personales y de asistencia amparados por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador). Su uso se limita estrictamente a fines de control laboral y auditoría patronal autorizada. Prohibida su divulgación o copia sin autorización.</span>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 600);
            };
          </script>
        </body>
        </html>
      `);
  printWindow.document.close();
};
