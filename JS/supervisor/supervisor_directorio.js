/**
 * Asistencia Tcontrol - Modulo Directorio de Colaboradores
 * Extraido en Fase 5 de Modularizacion
 * Fecha: 2026-09-23
 */

// ============================================================
// MÓDULO DIRECTORIO DE COLABORADORES
// ============================================================
window.directorioFiltroKpi = 'todos';
window.directorioVista = localStorage.getItem('TCONTROL_DIR_VISTA') || 'grid';
window.directorioUltimaLista = [];

window.setFiltroKpiDirectorio = function (filtro, elCard) {
  window.directorioFiltroKpi = filtro;
  document.querySelectorAll('.directorio-kpi-grid .kpi-card').forEach(c => c.classList.remove('active'));
  const card = elCard || (filtro === 'cumpleanos' ? $('kpiDirCardCumpleanos') : (filtro === 'todos' ? $('kpiDirCardTodos') : null));
  if (card) card.classList.add('active');
  filtrarDirectorio();
};

window.cambiarVistaDirectorio = function (vista) {
  window.directorioVista = vista;
  localStorage.setItem('TCONTROL_DIR_VISTA', vista);

  const btnGrid = $('btnDirVistaGrid');
  const btnTabla = $('btnDirVistaTabla');
  const containerGrid = $('directorioGridContainer');
  const containerTabla = $('directorioTablaContainer');

  if (btnGrid) btnGrid.classList.toggle('active', vista === 'grid');
  if (btnTabla) btnTabla.classList.toggle('active', vista === 'tabla');

  if (containerGrid) containerGrid.style.display = (vista === 'grid') ? 'grid' : 'none';
  if (containerTabla) containerTabla.style.display = (vista === 'tabla') ? 'block' : 'none';
};

window.limpiarBuscadorDirectorio = function () {
  const input = $('srchDirectorio');
  if (input) input.value = '';
  filtrarDirectorio();
};

window.limpiarTodosFiltrosDirectorio = function () {
  const input = $('srchDirectorio');
  const selArea = $('filtroAreaDirectorio');
  const selRol = $('filtroRolDirectorio');
  const selEstado = $('filtroEstadoDirectorio');
  const selAlm = $('filtroAlmuerzoDirectorio');
  const selCumple = $('filtroCumpleanosDirectorio');

  if (input) input.value = '';
  if (selArea) selArea.value = '';
  if (selRol) selRol.value = '';
  if (selEstado) selEstado.value = '';
  if (selAlm) selAlm.value = '';
  if (selCumple) selCumple.value = '';

  window.directorioFiltroKpi = 'todos';
  document.querySelectorAll('.directorio-kpi-grid .kpi-card').forEach(c => c.classList.remove('active'));
  const cardTodos = $('kpiDirCardTodos');
  if (cardTodos) cardTodos.classList.add('active');

  filtrarDirectorio();
};

window.renderBannerCumpleanosDirectorio = function (listaCumples) {
  const banner = $('dirBannerCumpleanos');
  if (!banner) return;

  if (!listaCumples || listaCumples.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  // Ordenar por días faltantes (hoy primero)
  listaCumples.sort((a, b) => a.estado.diasFaltan - b.estado.diasFaltan);

  const hayHoy = listaCumples.some(item => item.estado.esHoy);

  const chipsHtml = listaCumples.map(item => {
    const e = item.emp;
    const st = item.estado;
    const nombreFmt = (typeof obtenerPrimerNombreYPrimerApellido === 'function')
      ? obtenerPrimerNombreYPrimerApellido(e.nombre)
      : (e.nombre || 'Colaborador');
    const edadStr = st.edad ? ` (${st.edad} años)` : '';

    if (st.esHoy) {
      return `
        <div style="background:#fef3c7; border:1.5px solid #f59e0b; border-radius:10px; padding:6px 12px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 2px 5px rgba(245,158,11,0.15);">
          <span style="font-size:16px;">🎂</span>
          <div>
            <div style="font-weight:800; font-size:12px; color:#92400e;">¡Hoy! ${escapeHtml(nombreFmt)}${edadStr}</div>
            <div style="font-size:10px; color:#b45309;">${escapeHtml(e.cargo || e.area || '')}</div>
          </div>
          <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:#16a34a; color:white; border:none; border-radius:6px; padding:4px 9px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin-left:4px;" title="Felicitar por WhatsApp">
            <i class="fab fa-whatsapp"></i> Felicitar
          </button>
        </div>`;
    }

    const diasText = st.diasFaltan === 1 ? 'Mañana' : `En ${st.diasFaltan} días`;
    return `
      <div style="background:#ffffff; border:1px solid #fed7aa; border-radius:10px; padding:6px 12px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <span style="font-size:14px; color:#ea580c;">🎉</span>
        <div>
          <div style="font-weight:750; font-size:11.5px; color:#1e293b;">${escapeHtml(nombreFmt)}${edadStr}</div>
          <div style="font-size:10px; color:#ea580c; font-weight:600;">${diasText} (${st.fechaLegible})</div>
        </div>
        <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:3px 7px; font-size:10px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:3px; margin-left:2px;" title="Enviar WhatsApp">
          <i class="fab fa-whatsapp"></i>
        </button>
      </div>`;
  }).join('');

  banner.innerHTML = `
    <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border:1px solid #fde68a; border-radius:14px; padding:12px 16px; box-shadow:0 3px 8px rgba(245,158,11,0.08);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">${hayHoy ? '🎂' : '🗓️'}</span>
          <span style="font-weight:800; font-size:13px; color:#92400e;">
            ${hayHoy ? '¡Cumpleaños de Hoy y Próximos Colaboradores!' : 'Próximos Cumpleaños (15 días)'}
          </span>
          <span style="background:#fde68a; color:#78350f; padding:1px 7px; border-radius:20px; font-size:10.5px; font-weight:800;">${listaCumples.length}</span>
        </div>
        <button type="button" onclick="window.setFiltroKpiDirectorio('cumpleanos')" style="background:none; border:none; color:#b45309; font-size:11.5px; font-weight:700; cursor:pointer; text-decoration:underline;">
          Ver todos en la lista →
        </button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        ${chipsHtml}
      </div>
    </div>`;

  banner.style.display = 'block';
};

window.cargarDirectorio = function () {
  if (!empCache || empCache.length === 0) {
    return;
  }

  // 1. Calcular KPIs
  const total = empCache.length;
  const activos = empCache.filter(e => e.activo !== 'NO').length;
  const inactivos = empCache.filter(e => e.activo === 'NO').length;
  const supervisores = empCache.filter(e => {
    const sup = String(e.supervisor || '').toUpperCase();
    return sup === 'SI' || sup === 'SUPERVISOR ADMIN';
  }).length;
  const conWp = empCache.filter(e => e.telefono && String(e.telefono).trim().length >= 7).length;

  // Calcular cumpleaños de colaboradores activos (hoy y próximos 30 días)
  let countCumpleanosHoy = 0;
  let countCumpleanosProximos = 0;
  const listaCumplesCercanos = [];

  empCache.forEach(e => {
    if (e.activo === 'NO') return;
    const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
      ? obtenerFechaNacimientoEmpleado(e)
      : (e.fechaNacimiento || e.fecha_nacimiento || '');
    const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
      ? obtenerEstadoCumpleanos(rawN)
      : null;
    if (!estadoC) return;
    if (estadoC.esHoy) {
      countCumpleanosHoy++;
      listaCumplesCercanos.push({ emp: e, estado: estadoC });
    } else if (estadoC.diasFaltan <= 30) {
      countCumpleanosProximos++;
      if (estadoC.diasFaltan <= 15) {
        listaCumplesCercanos.push({ emp: e, estado: estadoC });
      }
    }
  });

  const totalCumpleanos = countCumpleanosHoy + countCumpleanosProximos;

  if ($('dirKpiTotal')) $('dirKpiTotal').textContent = total;
  if ($('dirKpiActivos')) $('dirKpiActivos').textContent = activos;
  if ($('dirKpiInactivos')) $('dirKpiInactivos').textContent = inactivos;
  if ($('dirKpiSupervisores')) $('dirKpiSupervisores').textContent = supervisores;
  if ($('dirKpiWhatsApp')) $('dirKpiWhatsApp').textContent = conWp;
  if ($('dirKpiCumpleanos')) $('dirKpiCumpleanos').textContent = totalCumpleanos;
  if ($('dirKpiCumpleanosSub')) {
    $('dirKpiCumpleanosSub').textContent = countCumpleanosHoy > 0
      ? `🎂 ${countCumpleanosHoy} Hoy · ${countCumpleanosProximos} próx.`
      : `${totalCumpleanos} en próx. 30 días`;
  }

  // Renderizar banner interactivo de cumpleaños si hay cumpleañeros cercanos
  if (typeof renderBannerCumpleanosDirectorio === 'function') {
    renderBannerCumpleanosDirectorio(listaCumplesCercanos);
  }

  // 2. Poblar selector y datalists de Áreas y Cargos
  const selArea = $('filtroAreaDirectorio');
  const valAreaActual = selArea ? selArea.value : '';
  const areasSet = new Set();
  const cargosSet = new Set();

  empCache.forEach(e => {
    if (e.area && String(e.area).trim()) areasSet.add(String(e.area).trim().toUpperCase());
    if (e.cargo && String(e.cargo).trim()) cargosSet.add(String(e.cargo).trim());
  });

  const areasSorted = Array.from(areasSet).sort((a, b) => a.localeCompare(b));
  const cargosSorted = Array.from(cargosSet).sort((a, b) => a.localeCompare(b));

  if (selArea) {
    let optsHtml = '<option value="">🏢 Todas las áreas</option>';
    areasSorted.forEach(a => {
      optsHtml += `<option value="${escapeHtml(a)}" ${a === valAreaActual ? 'selected' : ''}>${escapeHtml(a)}</option>`;
    });
    selArea.innerHTML = optsHtml;
  }

  // Datalists para los modales
  const dlAreas = $('listaAreasDirectorioDatalist');
  if (dlAreas) {
    dlAreas.innerHTML = areasSorted.map(a => `<option value="${escapeHtml(a)}">`).join('');
  }
  const dlCargos = $('listaCargosDirectorioDatalist');
  if (dlCargos) {
    dlCargos.innerHTML = cargosSorted.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  // 3. Restaurar vista preferida (grid vs tabla)
  cambiarVistaDirectorio(window.directorioVista || 'grid');

  // 4. Ejecutar filtrado y renderizado
  filtrarDirectorio();
};

window.filtrarDirectorio = function () {
  if (!empCache) return;

  const srchEl = $('srchDirectorio');
  const term = srchEl ? srchEl.value.trim().toLowerCase() : '';
  const areaFiltro = $('filtroAreaDirectorio') ? $('filtroAreaDirectorio').value.toUpperCase() : '';
  const rolFiltro = $('filtroRolDirectorio') ? $('filtroRolDirectorio').value : '';
  const estadoFiltro = $('filtroEstadoDirectorio') ? $('filtroEstadoDirectorio').value : '';
  const almFiltro = $('filtroAlmuerzoDirectorio') ? $('filtroAlmuerzoDirectorio').value : '';
  const cumpleFiltro = $('filtroCumpleanosDirectorio') ? $('filtroCumpleanosDirectorio').value : '';
  const kpiFiltro = window.directorioFiltroKpi || 'todos';

  // Botón limpiar búsqueda
  const btnLimpiar = $('btnLimpiarSrchDir');
  if (btnLimpiar) btnLimpiar.style.display = term ? 'block' : 'none';

  // Indicador de filtros activos
  const indicadorFiltros = $('dirFiltroActivoIndicator');
  const hayFiltrosActivos = (term !== '' || areaFiltro !== '' || rolFiltro !== '' || (estadoFiltro !== '' && estadoFiltro !== 'SI') || almFiltro !== '' || cumpleFiltro !== '' || kpiFiltro !== 'todos');
  if (indicadorFiltros) indicadorFiltros.style.display = hayFiltrosActivos ? 'block' : 'none';

  // Filtrar empleados
  const filtrados = empCache.filter(emp => {
    // 1. Buscador texto
    if (term) {
      const matchId = String(emp.id || '').toLowerCase().includes(term);
      const matchNom = String(emp.nombre || '').toLowerCase().includes(term);
      const matchArea = String(emp.area || '').toLowerCase().includes(term);
      const matchCargo = String(emp.cargo || '').toLowerCase().includes(term);
      const matchTel = String(emp.telefono || '').toLowerCase().includes(term);
      const rawNac = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const matchNac = rawNac ? String(rawNac).toLowerCase().includes(term) : false;
      if (!matchId && !matchNom && !matchArea && !matchCargo && !matchTel && !matchNac) return false;
    }

    // 2. Filtro Área
    if (areaFiltro && String(emp.area || '').toUpperCase() !== areaFiltro) {
      return false;
    }

    // 3. Filtro Rol
    if (rolFiltro) {
      const sup = String(emp.supervisor || '').toUpperCase();
      if (rolFiltro === 'SUPERVISOR_ADMIN' && sup !== 'SUPERVISOR ADMIN') return false;
      if (rolFiltro === 'SUPERVISOR' && sup !== 'SI' && sup !== 'SUPERVISOR ADMIN') return false;
      if (rolFiltro === 'REGULAR' && (sup === 'SI' || sup === 'SUPERVISOR ADMIN')) return false;
    }

    // 4. Filtro Estado (Activo / Inactivo)
    if (estadoFiltro) {
      const esActivo = emp.activo !== 'NO';
      if (estadoFiltro === 'SI' && !esActivo) return false;
      if (estadoFiltro === 'NO' && esActivo) return false;
    }

    // 5. Filtro Almuerzo Hoy
    if (almFiltro) {
      const almEmp = (typeof resolverAlmuerzoHoyEmpleado === 'function')
        ? resolverAlmuerzoHoyEmpleado(emp)
        : (emp.almuerzoHoy || '');
      if (almFiltro === 'SI' && almEmp !== 'SI') return false;
      if (almFiltro === 'NO' && almEmp !== 'NO') return false;
      if (almFiltro === 'SIN_ASIGNAR' && almEmp !== '') return false;
    }

    // 6. Filtro Cumpleaños Dropdown
    if (cumpleFiltro) {
      const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
        ? obtenerEstadoCumpleanos(rawN)
        : null;
      if (!estadoC) return false;
      if (cumpleFiltro === 'HOY' && !estadoC.esHoy) return false;
      if (cumpleFiltro === '7' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 7)) return false;
      if (cumpleFiltro === '15' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 15)) return false;
      if (cumpleFiltro === '30' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 30)) return false;
    }

    // 7. Filtro KPI clicado
    if (kpiFiltro === 'activos' && emp.activo === 'NO') return false;
    if (kpiFiltro === 'inactivos' && emp.activo !== 'NO') return false;
    if (kpiFiltro === 'supervisores') {
      const sup = String(emp.supervisor || '').toUpperCase();
      if (sup !== 'SI' && sup !== 'SUPERVISOR ADMIN') return false;
    }
    if (kpiFiltro === 'whatsapp') {
      if (!emp.telefono || String(emp.telefono).trim().length < 7) return false;
    }
    if (kpiFiltro === 'cumpleanos') {
      const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
        ? obtenerEstadoCumpleanos(rawN)
        : null;
      if (!estadoC || (!estadoC.esHoy && estadoC.diasFaltan > 30)) return false;
    }

    return true;
  });

  window.directorioUltimaLista = filtrados;

  // Actualizar contadores
  if ($('dirConteoFiltrados')) $('dirConteoFiltrados').textContent = filtrados.length;
  if ($('dirConteoTotal')) $('dirConteoTotal').textContent = empCache.length;

  // Renderizar vistas
  const emptyState = $('directorioEmptyState');
  const containerGrid = $('directorioGridContainer');
  const containerTabla = $('directorioTablaContainer');

  if (filtrados.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (containerGrid) containerGrid.innerHTML = '';
    if ($('tbodyDirectorioTabla')) $('tbodyDirectorioTabla').innerHTML = '';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    renderDirectorioCards(filtrados);
    renderDirectorioTabla(filtrados);
  }
};

function normalizarEstadoAlmuerzo(val) {
  if (!val) return '';
  const v = String(val).toUpperCase().trim();
  if (v === 'SI' || v === 'SÍ' || v === 'PLANTA') return 'SI';
  if (v === 'NO' || v === 'FUERA') return 'NO';
  return '';
}
window.normalizarEstadoAlmuerzo = normalizarEstadoAlmuerzo;

function resolverAlmuerzoHoyEmpleado(emp, targetFecha) {
  if (!emp) return '';
  const fHoy = targetFecha || hoy || getLocalHoyStr();
  let val = emp.almuerzoHoy;
  if (!val && Array.isArray(emp.registros)) {
    const reg = emp.registros.find(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO' || r.tipo === 'ENTRADA_CAMPO') && normalizarFechaStr(r.fecha) === fHoy);
    if (reg && reg.almuerzo) val = reg.almuerzo;
  }
  return normalizarEstadoAlmuerzo(val);
}
window.resolverAlmuerzoHoyEmpleado = resolverAlmuerzoHoyEmpleado;

// ============================================================
// UTILIDADES PARA FECHA DE NACIMIENTO EN DIRECTORIO
// ============================================================
function obtenerFechaNacimientoEmpleado(emp) {
  if (!emp) return '';
  let val = emp.fechaNacimiento || emp.fecha_nacimiento || emp.fNacimiento || emp.fechanacimiento || '';
  if (val && typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      val = val.toDate();
    } else if (val.seconds !== undefined) {
      val = new Date(val.seconds * 1000);
    }
  }
  if (val instanceof Date && !isNaN(val)) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(val || '').trim();
}
window.obtenerFechaNacimientoEmpleado = obtenerFechaNacimientoEmpleado;

function normalizarFechaParaInput(val) {
  if (!val) return '';
  let s = String(val).trim().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('/')) {
    const p = s.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) {
        // DD/MM/YYYY -> YYYY-MM-DD
        const dd = p[0].padStart(2, '0');
        const mm = p[1].padStart(2, '0');
        return `${p[2]}-${mm}-${dd}`;
      } else if (p[0].length === 4) {
        // YYYY/MM/DD -> YYYY-MM-DD
        const mm = p[1].padStart(2, '0');
        const dd = p[2].padStart(2, '0');
        return `${p[0]}-${mm}-${dd}`;
      }
    }
  }
  if (s.includes('-')) {
    const p = s.split('-');
    if (p.length === 3 && p[2].length === 4) {
      // DD-MM-YYYY -> YYYY-MM-DD
      const dd = p[0].padStart(2, '0');
      const mm = p[1].padStart(2, '0');
      return `${p[2]}-${mm}-${dd}`;
    }
  }
  return s;
}
window.normalizarFechaParaInput = normalizarFechaParaInput;

function calcularEdad(fechaVal) {
  if (!fechaVal) return null;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return null;
  const [anioStr, mesStr, diaStr] = norm.split('-');
  const anio = parseInt(anioStr, 10);
  const mes = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);
  if (isNaN(anio) || isNaN(mes) || isNaN(dia)) return null;

  const hoyD = new Date();
  let edad = hoyD.getFullYear() - anio;
  const m = hoyD.getMonth() - mes;
  if (m < 0 || (m === 0 && hoyD.getDate() < dia)) {
    edad--;
  }
  return (edad >= 0 && edad < 120) ? edad : null;
}
window.calcularEdad = calcularEdad;

function esCumpleanosFecha(fechaVal) {
  if (!fechaVal) return false;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return false;
  const parts = norm.split('-');
  const mes = parseInt(parts[1], 10);
  const dia = parseInt(parts[2], 10);
  const hoyD = new Date();
  return (hoyD.getMonth() + 1 === mes && hoyD.getDate() === dia);
}
window.esCumpleanosFecha = esCumpleanosFecha;

function formatearFechaNacimientoLegible(fechaVal) {
  if (!fechaVal) return '';
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return String(fechaVal);
  const [yyyy, mmStr, ddStr] = norm.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mIdx = parseInt(mmStr, 10) - 1;
  const mesNom = meses[mIdx] || mmStr;
  return `${parseInt(ddStr, 10)} ${mesNom} ${yyyy}`;
}
window.formatearFechaNacimientoLegible = formatearFechaNacimientoLegible;

function obtenerEstadoCumpleanos(fechaVal) {
  if (!fechaVal) return null;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return null;
  const [anioStr, mesStr, diaStr] = norm.split('-');
  const anio = parseInt(anioStr, 10);
  const mes = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);
  if (isNaN(mes) || isNaN(dia)) return null;

  const hoyD = new Date();
  const hoyAnio = hoyD.getFullYear();
  const hoyCero = new Date(hoyAnio, hoyD.getMonth(), hoyD.getDate(), 0, 0, 0, 0);

  // Fecha de cumpleaños este año
  let proximoCump = new Date(hoyAnio, mes, dia, 0, 0, 0, 0);

  // Si ya pasó este año, el próximo es el año que viene
  if (proximoCump.getTime() < hoyCero.getTime()) {
    proximoCump = new Date(hoyAnio + 1, mes, dia, 0, 0, 0, 0);
  }

  const diffMs = proximoCump.getTime() - hoyCero.getTime();
  const diasFaltan = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const esHoy = (diasFaltan === 0);
  const edadCumplida = (!isNaN(anio) && anio > 1900) ? (proximoCump.getFullYear() - anio) : null;
  const fLegible = formatearFechaNacimientoLegible(fechaVal);

  return {
    esHoy,
    esProximo: (diasFaltan > 0 && diasFaltan <= 30),
    diasFaltan,
    edad: edadCumplida,
    fechaLegible: fLegible
  };
}
window.obtenerEstadoCumpleanos = obtenerEstadoCumpleanos;

function capitalizarPalabra(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
window.capitalizarPalabra = capitalizarPalabra;

function obtenerPrimerNombreYPrimerApellido(nombreCompleto) {
  if (!nombreCompleto) return 'Colaborador';
  const clean = String(nombreCompleto).trim();
  if (!clean) return 'Colaborador';
  const partes = clean.split(/\s+/);

  if (partes.length === 1) {
    return capitalizarPalabra(partes[0]);
  }
  if (partes.length === 2) {
    return `${capitalizarPalabra(partes[1])} ${capitalizarPalabra(partes[0])}`;
  }
  if (partes.length >= 3) {
    // Formato oficial habitual en nóminas de Ecuador:
    // [APELLIDO PATERNO] [APELLIDO MATERNO] [PRIMER NOMBRE] [SEGUNDO NOMBRE...]
    // Ejemplo: ABALCO CHUQUIN NAYDELIN RUBIELA -> Naydelin Abalco
    const primerApellido = capitalizarPalabra(partes[0]);
    const primerNombre = capitalizarPalabra(partes[2]);
    return `${primerNombre} ${primerApellido}`;
  }
  return clean;
}
window.obtenerPrimerNombreYPrimerApellido = obtenerPrimerNombreYPrimerApellido;

window.renderDirectorioCards = function (lista) {
  const container = $('directorioGridContainer');
  if (!container) return;

  container.innerHTML = lista.map(emp => {
    const esActivo = emp.activo !== 'NO';
    const supUpper = String(emp.supervisor || '').toUpperCase();
    const esAdmin = supUpper === 'SUPERVISOR ADMIN';
    const esSup = supUpper === 'SI';

    let rolBadge = `<span class="dir-badge-pill dir-badge-rol-reg"><i class="fas fa-user"></i> Empleado</span>`;
    if (esAdmin) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-admin"><i class="fas fa-crown"></i> Sup. Admin</span>`;
    } else if (esSup) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-sup"><i class="fas fa-user-shield"></i> Supervisor</span>`;
    }

    const rawTel = (emp.telefono || '').toString().trim();
    let wpBadgeHtml = '';
    if (rawTel && rawTel.length >= 7) {
      wpBadgeHtml = `
            <a href="javascript:void(0)" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp a ${escapeHtml(emp.nombre)}" style="color:#16a34a; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-size:11.5px;">
              <i class="fab fa-whatsapp" style="font-size:13px;"></i> ${escapeHtml(rawTel)}
            </a>`;
    } else {
      wpBadgeHtml = `
            <span style="color:#94a3b8; font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para agregar WhatsApp">
              <i class="fab fa-whatsapp" style="color:#cbd5e1;"></i> Sin registrar
            </span>`;
    }

    const rawFNac = obtenerFechaNacimientoEmpleado(emp);
    const estadoC = obtenerEstadoCumpleanos(rawFNac);
    const fNacLegible = estadoC ? estadoC.fechaLegible : formatearFechaNacimientoLegible(rawFNac);

    let fNacCardHtml = '';
    if (estadoC && estadoC.esHoy) {
      fNacCardHtml = `
            <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:800; display:inline-flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(245,158,11,0.2);" title="¡Hoy es su cumpleaños! Fecha: ${escapeHtml(fNacLegible)}">
              🎂 ¡Hoy! ${estadoC.edad !== null ? `(${estadoC.edad} años)` : ''}
            </span>`;
    } else if (estadoC && estadoC.diasFaltan <= 7) {
      fNacCardHtml = `
            <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:750; display:inline-flex; align-items:center; gap:4px;" title="Próximo cumpleaños en ${estadoC.diasFaltan} días (${escapeHtml(fNacLegible)})">
              🎉 En ${estadoC.diasFaltan} día${estadoC.diasFaltan > 1 ? 's' : ''} ${estadoC.edad !== null ? `(${estadoC.edad} a.)` : ''}
            </span>`;
    } else if (estadoC && estadoC.diasFaltan <= 30) {
      fNacCardHtml = `
            <span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:4px;" title="Cumpleaños próximo: ${escapeHtml(fNacLegible)}">
              🗓️ En ${estadoC.diasFaltan} días ${estadoC.edad !== null ? `(${estadoC.edad} a.)` : ''}
            </span>`;
    } else if (fNacLegible) {
      const edadEmp = calcularEdad(rawFNac);
      fNacCardHtml = `
            <span style="color:#1e293b; font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="Fecha de nacimiento">
              ${escapeHtml(fNacLegible)} ${edadEmp !== null ? `<span style="color:#64748b; font-size:10.5px; font-weight:500;">(${edadEmp} a.)</span>` : ''}
            </span>`;
    } else {
      fNacCardHtml = `
            <span style="color:#94a3b8; font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para registrar fecha de nacimiento">
              <i class="fas fa-calendar-plus" style="color:#cbd5e1;"></i> Sin registrar
            </span>`;
    }

    const almNorm = resolverAlmuerzoHoyEmpleado(emp);
    let almBadge = `<span style="font-size:10px; color:#94a3b8; font-weight:600;"><i class="fas fa-minus-circle"></i> Sin registro</span>`;
    if (almNorm === 'SI') {
      almBadge = `<span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:750;"><i class="fas fa-utensils"></i> Planta</span>`;
    } else if (almNorm === 'NO') {
      almBadge = `<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:750;"><i class="fas fa-motorcycle"></i> Fuera</span>`;
    }

    // Foto con marco
    const fotoHtml = (typeof photoCell === 'function') ? photoCell(emp, 'medium') : `
          <div style="width:58px; height:58px; border-radius:50%; background:linear-gradient(135deg, var(--red), var(--red-dk)); color:white; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:18px;">
            ${(emp.nombre || '?').charAt(0)}
          </div>`;

    return `
          <div class="dir-emp-card">
            <!-- Header de Tarjeta -->
            <div class="dir-card-header">
              <div class="dir-photo-container" onclick="mostrarDetalle('${emp.id}')" title="Ver detalle completo de asistencia">
                ${fotoHtml}
                <div class="dir-status-dot ${esActivo ? 'active' : 'inactive'}" title="${esActivo ? 'Usuario Activo' : 'Usuario Inactivo'}"></div>
              </div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                  <h4 style="margin:0; font-size:13.5px; font-weight:750; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="${escapeHtml(emp.nombre)}">
                    ${escapeHtml(emp.nombre)}
                  </h4>
                  ${rolBadge}
                </div>
                <div style="display:flex; gap:6px; align-items:center; margin-top:3px; font-size:11px; color:#64748b; font-weight:600;">
                  <span style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-family:'Fira Code', monospace;">ID: ${escapeHtml(emp.id)}</span>
                  <span>·</span>
                  <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(emp.cargo || 'Sin cargo')}">${escapeHtml(emp.cargo || 'Sin cargo')}</span>
                </div>
              </div>
            </div>

            <!-- Cuerpo de Tarjeta -->
            <div class="dir-card-body">
              <div class="dir-info-row">
                <span><i class="fas fa-building" style="color:#64748b; margin-right:4px;"></i> Área:</span>
                <strong style="color:#1e293b; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(emp.area || 'Sin área')}</strong>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-cake-candles" style="color:#f59e0b; margin-right:4px;"></i> F. Nacimiento:</span>
                <div>${fNacCardHtml}</div>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-phone-alt" style="color:#64748b; margin-right:4px;"></i> Contacto:</span>
                <div>${wpBadgeHtml}</div>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-user-check" style="color:#64748b; margin-right:4px;"></i> Estado:</span>
                ${esActivo
        ? `<span style="background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:750; border:1px solid #bbf7d0;"><i class="fas fa-check-circle" style="font-size:8px;"></i> Activo</span>`
        : `<span style="background:#fee2e2; color:#be123c; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:750; border:1px solid #fecaca;"><i class="fas fa-ban" style="font-size:8px;"></i> Inactivo</span>`
      }
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-utensils" style="color:#64748b; margin-right:4px;"></i> Almuerzo Hoy:</span>
                <div style="display:flex; align-items:center; gap:6px;">
                  ${almBadge}
                  <select onchange="window.cambiarAlmuerzoDirectorio('${emp.id}', this.value)" class="dir-alm-select ${almNorm === 'SI' ? 'is-planta' : (almNorm === 'NO' ? 'is-fuera' : 'is-none')}" title="Cambiar almuerzo de hoy para este colaborador">
                    <option value="SI" ${almNorm === 'SI' ? 'selected' : ''}>Planta (Sí)</option>
                    <option value="NO" ${almNorm === 'NO' ? 'selected' : ''}>Fuera (No)</option>
                    <option value="" ${!almNorm ? 'selected' : ''}>— Sin asignar —</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Barra de Acciones Rápidas -->
            <div class="dir-card-actions">
              <button type="button" class="dir-btn-action btn-edit" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Editar ficha completa del usuario (Área, Cargo, PIN, Rol, WhatsApp)">
                <i class="fas fa-user-edit"></i> Editar
              </button>
              <button type="button" class="dir-btn-action btn-detail" onclick="mostrarDetalle('${emp.id}')" title="Ver expediente de asistencia 360 y registros">
                <i class="fas fa-id-badge"></i> Detalle
              </button>
              <button type="button" class="dir-btn-action btn-wp" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp directo">
                <i class="fab fa-whatsapp"></i>
              </button>
              <button type="button" class="dir-btn-action btn-key" onclick="window.resetearPasswordEmpleado(${jsAttr(emp.id)}, ${jsAttr(emp.nombre)})" title="Resetear contraseña / PIN de vinculación">
                <i class="fas fa-key"></i>
              </button>
              <button type="button" class="dir-btn-action" onclick="window.mostrarModalFuturos('${emp.id}')" title="Programar evento o ausencia (permiso, vacación)" style="background:#faf5ff; border-color:#e9d5ff; color:#7e22ce;">
                <i class="fas fa-calendar-plus"></i>
              </button>
              <button type="button" class="dir-btn-action" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" title="Registrar salida o trabajo en campo" style="background:#f0fdf4; border-color:#bbf7d0; color:#15803d;">
                <i class="fas fa-hammer"></i>
              </button>
            </div>
          </div>`;
  }).join('');
};

window.renderDirectorioTabla = function (lista) {
  const tbody = $('tbodyDirectorioTabla');
  if (!tbody) return;

  tbody.innerHTML = lista.map(emp => {
    const esActivo = emp.activo !== 'NO';
    const supUpper = String(emp.supervisor || '').toUpperCase();
    const esAdmin = supUpper === 'SUPERVISOR ADMIN';
    const esSup = supUpper === 'SI';

    let rolBadge = `<span class="dir-badge-pill dir-badge-rol-reg"><i class="fas fa-user"></i> Empleado</span>`;
    if (esAdmin) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-admin"><i class="fas fa-crown"></i> Sup. Admin</span>`;
    } else if (esSup) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-sup"><i class="fas fa-user-shield"></i> Supervisor</span>`;
    }

    const rawTel = (emp.telefono || '').toString().trim();
    let wpCell = `<span style="color:#94a3b8; font-size:11px;">—</span>`;
    if (rawTel && rawTel.length >= 7) {
      wpCell = `
            <a href="javascript:void(0)" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" style="color:#16a34a; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-size:11.5px;" title="Enviar WhatsApp">
              <i class="fab fa-whatsapp"></i> ${escapeHtml(rawTel)}
            </a>`;
    }

    const almNorm = resolverAlmuerzoHoyEmpleado(emp);

    const fotoMini = (typeof photoCell === 'function') ? photoCell(emp, 'small') : `
          <div style="width:30px; height:30px; border-radius:50%; background:var(--blue); color:white; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">
            ${(emp.nombre || '?').charAt(0)}
          </div>`;

    return `
          <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
            <!-- Colaborador -->
            <td style="padding:10px 12px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="Ver detalle">
                  ${fotoMini}
                </div>
                <div>
                  <div style="font-weight:750; font-size:12px; color:#0f172a; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="${escapeHtml(emp.nombre)}">
                    ${escapeHtml(emp.nombre)}
                  </div>
                  <div style="font-size:10.5px; color:#64748b; font-family:'Fira Code', monospace; margin-top:1px;">
                    ID: <strong>${escapeHtml(emp.id)}</strong>
                  </div>
                </div>
              </div>
            </td>

            <!-- Área & Cargo -->
            <td style="padding:10px 12px; font-size:11.5px;">
              <div style="font-weight:700; color:#1e293b;">${escapeHtml(emp.area || '—')}</div>
              <div style="font-size:10.5px; color:#64748b;">${escapeHtml(emp.cargo || '—')}</div>
            </td>

            <!-- F. Nacimiento -->
            <td style="padding:10px 12px; font-size:11.5px; white-space:nowrap;">
              ${(() => {
                const rawN = obtenerFechaNacimientoEmpleado(emp);
                const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
                  ? obtenerEstadoCumpleanos(rawN)
                  : null;
                const fLegible = estadoC ? estadoC.fechaLegible : formatearFechaNacimientoLegible(rawN);
                const edad = estadoC ? estadoC.edad : calcularEdad(rawN);

                if (estadoC && estadoC.esHoy) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2.5px 8px; border-radius:6px; font-size:10.5px; font-weight:800; display:inline-flex; align-items:center; gap:4px; width:fit-content; box-shadow:0 1px 3px rgba(245,158,11,0.2);" title="¡Hoy es su cumpleaños!">
                        🎂 ¡Hoy! ${edad !== null ? `(${edad} años)` : ''}
                      </span>
                      <span style="color:#475569; font-size:10.5px; font-weight:600;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (estadoC && estadoC.diasFaltan <= 7) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800; display:inline-flex; align-items:center; gap:4px; width:fit-content;" title="Próximo cumpleaños en ${estadoC.diasFaltan} días">
                        🎉 En ${estadoC.diasFaltan} día${estadoC.diasFaltan > 1 ? 's' : ''} ${edad !== null ? `(${edad} a.)` : ''}
                      </span>
                      <span style="color:#64748b; font-size:10.5px;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (estadoC && estadoC.diasFaltan <= 30) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:700; display:inline-flex; align-items:center; gap:4px; width:fit-content;" title="Cumpleaños próximo en ${estadoC.diasFaltan} días">
                        🗓️ En ${estadoC.diasFaltan} días ${edad !== null ? `(${edad} a.)` : ''}
                      </span>
                      <span style="color:#64748b; font-size:10.5px;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (fLegible) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:1px;">
                      <span style="font-weight:700; color:#1e293b; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
                        <i class="fas fa-cake-candles" style="color:#f59e0b; font-size:10px;"></i> ${escapeHtml(fLegible)}
                      </span>
                      ${edad !== null ? `<span style="font-size:10.5px; color:#64748b;">${edad} años</span>` : ''}
                    </div>`;
                }
                return `
                  <span style="color:#94a3b8; font-size:11px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para registrar fecha de nacimiento">
                    <i class="fas fa-calendar-plus" style="color:#cbd5e1; margin-right:3px;"></i>—
                  </span>`;
              })()}
            </td>

            <!-- Contacto WhatsApp -->
            <td style="padding:10px 12px;">
              ${wpCell}
            </td>

            <!-- Almuerzo Hoy -->
            <td style="padding:10px 12px; text-align:center;">
              <select onchange="window.cambiarAlmuerzoDirectorio('${emp.id}', this.value)" class="dir-alm-select ${almNorm === 'SI' ? 'is-planta' : (almNorm === 'NO' ? 'is-fuera' : 'is-none')}" title="Almuerzo de hoy: clic para modificar">
                <option value="SI" ${almNorm === 'SI' ? 'selected' : ''}>🍱 Planta (Sí)</option>
                <option value="NO" ${almNorm === 'NO' ? 'selected' : ''}>🥪 Fuera (No)</option>
                <option value="" ${!almNorm ? 'selected' : ''}>⚪ Sin registro</option>
              </select>
            </td>

            <!-- Acciones Rápidas -->
            <td style="padding:10px 12px; text-align:center;">
              <div class="dir-table-actions">
                <button type="button" class="dir-table-btn" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Editar Ficha de Usuario" style="color:#2563eb; border-color:#bfdbfe; background:#eff6ff;">
                  <i class="fas fa-user-edit"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="mostrarDetalle('${emp.id}')" title="Ver Detalle de Asistencia 360" style="color:#475569;">
                  <i class="fas fa-id-badge"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp" style="color:#16a34a; border-color:#bbf7d0; background:#f0fdf4;">
                  <i class="fab fa-whatsapp"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.resetearPasswordEmpleado(${jsAttr(emp.id)}, ${jsAttr(emp.nombre)})" title="Resetear Contraseña / PIN" style="color:#be123c; border-color:#fecdd3; background:#fff1f2;">
                  <i class="fas fa-key"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.mostrarModalFuturos('${emp.id}')" title="Programar Ausencia o Permiso" style="color:#7c3aed; border-color:#ddd6fe; background:#f5f3ff;">
                  <i class="fas fa-calendar-plus"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" title="Registrar Trabajo en Campo" style="color:#059669; border-color:#a7f3d0; background:#ecfdf5;">
                  <i class="fas fa-hammer"></i>
                </button>
              </div>
            </td>
          </tr>`;
  }).join('');
};

window.cambiarAlmuerzoDirectorio = async function (empleadoId, nuevoEstado) {
  if (!empleadoId) return;
  const estadoNorm = normalizarEstadoAlmuerzo(nuevoEstado); // 'SI', 'NO', or ''
  const fHoy = hoy || getLocalHoyStr();

  const idx = empCache.findIndex(e => String(e.id).trim() === String(empleadoId).trim());
  if (idx === -1) return;

  const emp = empCache[idx];
  const estadoAnterior = emp.almuerzoHoy || '';

  // Actualización optimista inmediata en memoria
  emp.almuerzoHoy = estadoNorm;

  if (!emp.registros) emp.registros = [];
  let reg = emp.registros.find(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO' || r.tipo === 'ENTRADA_CAMPO') && normalizarFechaStr(r.fecha) === fHoy);
  let regAnterior = reg ? reg.almuerzo : null;

  if (reg) {
    reg.almuerzo = estadoNorm;
  } else if (estadoNorm) {
    // Crear registro local SOLO_ALMUERZO para sincronizar conteos y reportes
    emp.registros.push({
      id: `${emp.id}_SOLO_ALMUERZO_${fHoy}`,
      empleadoId: emp.id,
      nombre: emp.nombre,
      fecha: fHoy,
      tipo: 'SOLO_ALMUERZO',
      almuerzo: estadoNorm,
      hora: new Date().toLocaleTimeString('es-EC', { hour12: false })
    });
  }

  // Refrescar UI y KPIs de inmediato
  if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
  if (typeof cargarAsistencia === 'function') cargarAsistencia();
  if (typeof cargarDashboard === 'function') cargarDashboard();

  const etiquetaAlm = estadoNorm === 'SI' ? 'Planta' : (estadoNorm === 'NO' ? 'Fuera' : 'Sin asignar');
  mostrarToast(`Almuerzo hoy: ${etiquetaAlm}`, 'info');

  try {
    const res = await jsonpRequest({
      accion: 'actualizarAlmuerzoSupervisor',
      empleadoId: empleadoId,
      almuerzo: estadoNorm,
      fecha: fHoy
    });
    if (res && !res.error) {
      mostrarToast(`Almuerzo guardado correctamente (${etiquetaAlm})`, 'success');
      limpiarCachesLocales();
    } else {
      mostrarToast(res?.error || 'Error al guardar almuerzo en servidor', 'error');
      // Revertir optimismo
      emp.almuerzoHoy = estadoAnterior;
      if (reg) reg.almuerzo = regAnterior;
      if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
      if (typeof cargarAsistencia === 'function') cargarAsistencia();
      if (typeof cargarDashboard === 'function') cargarDashboard();
    }
  } catch (err) {
    console.error("Error en cambiarAlmuerzoDirectorio:", err);
    mostrarToast('Error de conexión al actualizar almuerzo', 'error');
    emp.almuerzoHoy = estadoAnterior;
    if (reg) reg.almuerzo = regAnterior;
    if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
    if (typeof cargarAsistencia === 'function') cargarAsistencia();
    if (typeof cargarDashboard === 'function') cargarDashboard();
  }
};

// ============================================================
// EXPORTACIÓN A EXCEL DEL DIRECTORIO
// ============================================================
window.exportarDirectorioExcel = async function () {

  const lista = (window.directorioUltimaLista && window.directorioUltimaLista.length > 0)
    ? window.directorioUltimaLista
    : (empCache || []);

  if (lista.length === 0) {
    mostrarToast('No hay colaboradores para exportar', 'warning');
    return;
  }

  mostrarLoader(true);
  try {
    await window.asegurarXLSX();
    const headers = [
      "Cédula / ID",
      "Nombre Completo",
      "Área / Departamento",
      "Cargo",
      "WhatsApp / Teléfono",
      "Fecha de Nacimiento",
      "Edad",
      "PIN / Contraseña",
      "Rol en el Sistema",
      "Estado Nómina",
      "Cultura Tcontrol",
      "Rol de Pagos",
      "Almuerzo Hoy"
    ];

    const rows = lista.map(emp => {
      const supUpper = String(emp.supervisor || '').toUpperCase();
      const rolTexto = (supUpper === 'SUPERVISOR ADMIN') ? 'Supervisor Admin' : (supUpper === 'SI' ? 'Supervisor' : 'Empleado Regular');
      const estadoTexto = (emp.activo === 'NO') ? 'Inactivo' : 'Activo';
      const culturaTexto = (emp.cultura_habilitada === false || emp.cultura_activa === false) ? 'Exonerado' : 'Habilitado';
      const rolPagosTexto = emp.id_dispositivo ? 'Vinculado' : 'Sin Rol';
      const almNorm = resolverAlmuerzoHoyEmpleado(emp);
      const almuerzoTexto = almNorm === 'SI' ? 'Planta' : (almNorm === 'NO' ? 'Fuera' : 'Sin registro');
      const rawNac = obtenerFechaNacimientoEmpleado(emp);
      const edadCalc = calcularEdad(rawNac);
      const fNacTexto = formatearFechaNacimientoLegible(rawNac);

      return [
        emp.id ? String(emp.id) : '',
        emp.nombre || '',
        emp.area || 'SIN ASIGNAR',
        emp.cargo || 'SIN ASIGNAR',
        emp.telefono || '',
        fNacTexto || '',
        edadCalc !== null ? edadCalc : '',
        emp.pin ? String(emp.pin) : '',
        rolTexto,
        estadoTexto,
        culturaTexto,
        rolPagosTexto,
        almuerzoTexto
      ];
    });

    const dataAoA = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(dataAoA);

    // Ajustar anchos de columnas
    ws['!cols'] = [
      { wch: 16 }, // Cédula
      { wch: 32 }, // Nombre
      { wch: 22 }, // Área
      { wch: 22 }, // Cargo
      { wch: 18 }, // WhatsApp
      { wch: 18 }, // Fecha de Nacimiento
      { wch: 8 },  // Edad
      { wch: 12 }, // PIN
      { wch: 20 }, // Rol
      { wch: 14 }, // Estado
      { wch: 18 }, // Cultura
      { wch: 15 }, // Rol de Pagos
      { wch: 16 }  // Almuerzo
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Directorio Colaboradores");

    const hoyStr = getLocalHoyStr();
    const filename = `Directorio_Personal_TCONTROL_${hoyStr}.xlsx`;
    XLSX.writeFile(wb, filename);

    mostrarLoader(false);
    mostrarToast(`Directorio exportado exitosamente (${rows.length} colaboradores)`, 'success');
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al exportar directorio a Excel:", err);
    mostrarToast('Error al generar archivo Excel: ' + err.message, 'error');
  }
};

// ============================================================
// MODALES DE EDICIÓN Y CREACIÓN DE USUARIOS EN DIRECTORIO
// ============================================================
window.abrirModalEditarEmpleado = function (empleadoId) {
  if (!empCache) return;
  const emp = empCache.find(e => e.id === empleadoId);
  if (!emp) {
    mostrarToast('Colaborador no encontrado', 'error');
    return;
  }

  if ($('editDirEmpIdOriginal')) $('editDirEmpIdOriginal').value = emp.id;
  if ($('editDirId')) $('editDirId').value = emp.id;
  if ($('editDirIdBadge')) $('editDirIdBadge').textContent = emp.id;
  if ($('editDirNombreBadge')) $('editDirNombreBadge').textContent = emp.nombre;
  if ($('editDirNombre')) $('editDirNombre').value = emp.nombre || '';
  if ($('editDirArea')) $('editDirArea').value = emp.area || '';
  if ($('editDirCargo')) $('editDirCargo').value = emp.cargo || '';
  if ($('editDirTelefono')) $('editDirTelefono').value = emp.telefono || '';
  if ($('editDirPin')) $('editDirPin').value = emp.pin || '';

  const fNacInputVal = normalizarFechaParaInput(obtenerFechaNacimientoEmpleado(emp));
  if ($('editDirFechaNacimiento')) $('editDirFechaNacimiento').value = fNacInputVal;

  const supUpper = String(emp.supervisor || '').toUpperCase();
  if ($('editDirSupervisor')) {
    if (supUpper === 'SUPERVISOR ADMIN') $('editDirSupervisor').value = 'SUPERVISOR ADMIN';
    else if (supUpper === 'SI') $('editDirSupervisor').value = 'SI';
    else $('editDirSupervisor').value = 'NO';
  }

  if ($('editDirActivo')) {
    $('editDirActivo').value = (emp.activo === 'NO') ? 'NO' : 'SI';
  }

  if ($('editDirCultura')) {
    $('editDirCultura').value = (emp.cultura_habilitada === false || emp.cultura_activa === false) ? 'NO' : 'SI';
  }

  const imgPreview = $('editDirFotoPreview');
  if (imgPreview) {
    imgPreview.src = emp.foto_url || './assets/images/Logotipo T Control.png';
  }

  const modal = $('modalEditarEmpleadoDirectorio');
  if (modal) modal.classList.remove('hidden');
};

window.cerrarModalEditarEmpleadoDirectorio = function () {
  const modal = $('modalEditarEmpleadoDirectorio');
  if (modal) modal.classList.add('hidden');
};

window.guardarEdicionEmpleadoDirectorio = async function () {
  const id = $('editDirId') ? $('editDirId').value.trim() : '';
  const nombre = $('editDirNombre') ? $('editDirNombre').value.trim() : '';
  const area = $('editDirArea') ? $('editDirArea').value.trim().toUpperCase() : '';
  const cargo = $('editDirCargo') ? $('editDirCargo').value.trim() : '';
  const telefono = $('editDirTelefono') ? $('editDirTelefono').value.trim() : '';
  const pin = $('editDirPin') ? $('editDirPin').value.trim() : '';
  const supervisor = $('editDirSupervisor') ? $('editDirSupervisor').value : 'NO';
  const activo = $('editDirActivo') ? $('editDirActivo').value : 'SI';
  const cultura = $('editDirCultura') ? $('editDirCultura').value : 'SI';
  const fechaNacimiento = $('editDirFechaNacimiento') ? $('editDirFechaNacimiento').value.trim() : '';

  if (!id || !nombre || !area || !cargo) {
    mostrarToast('Por favor, completa los campos obligatorios (*)', 'warning');
    return;
  }

  const empActual = (empCache || []).find(e => String(e.id).trim() === String(id).trim());
  let pinFinal = pin;
  if (!pinFinal && empActual) {
    pinFinal = empActual.pin || '';
  } else if (pinFinal && (pinFinal.length !== 4 || isNaN(pinFinal))) {
    mostrarToast('Si ingresas un PIN, debe tener exactamente 4 dígitos numéricos', 'warning');
    return;
  }

  const datos = {
    nombre: nombre,
    area: area,
    cargo: cargo,
    telefono: telefono,
    pin: pinFinal,
    supervisor: supervisor,
    activo: activo,
    cultura_habilitada: (cultura === 'SI'),
    cultura_activa: (cultura === 'SI'),
    fechaNacimiento: fechaNacimiento
  };

  mostrarLoader(true);
  try {
    let res = null;
    if (window.FirebaseBackend && window.USE_FIREBASE) {
      res = await window.FirebaseBackend.actualizarEmpleado({
        empleadoId: id,
        datos: datos
      });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarEmpleado',
        empleadoId: id,
        datos: JSON.stringify(datos)
      });
    }

    mostrarLoader(false);

    if (res && (res.ok || !res.error)) {
      // Actualizar registro en empCache
      const idx = empCache.findIndex(e => e.id === id);
      if (idx > -1) {
        Object.assign(empCache[idx], datos);
      }

      cerrarModalEditarEmpleadoDirectorio();
      mostrarToast(`¡Colaborador ${nombre} actualizado exitosamente!`, 'success');

      // Refrescar vistas
      cargarDirectorio();
      if (typeof cargarAsistencia === 'function' && panelActual === 'asistencia') {
        cargarAsistencia();
      }
    } else {
      mostrarToast(res?.error || 'Error al actualizar colaborador', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al guardar edición de empleado:", err);
    mostrarToast('Error de conexión al guardar cambios', 'error');
  }
};

window.obtenerSiguienteIdDisponible = function () {
  const todos = [...(empCache || []), ...(window.empEliminadosCache || [])];
  const idsNumericos = todos
    .map(e => {
      const clean = String(e.id || '').trim();
      if (/^\d+$/.test(clean)) {
        return parseInt(clean, 10);
      }
      return null;
    })
    .filter(num => num !== null && num > 0);

  if (idsNumericos.length === 0) return '1';

  const ocupados = new Set(todos.map(e => String(e.id || '').trim()));
  let maxId = Math.max(...idsNumericos);
  let siguiente = maxId + 1;
  while (ocupados.has(String(siguiente))) {
    siguiente++;
  }
  return String(siguiente);
};

window.abrirModalNuevoEmpleadoDirectorio = function () {
  const form = $('formNuevoEmpleadoDirectorio');
  if (form) form.reset();
  if ($('nuevoDirFechaNacimiento')) $('nuevoDirFechaNacimiento').value = '';

  // Autocalcular y rellenar el siguiente ID disponible
  const siguienteId = window.obtenerSiguienteIdDisponible();
  if ($('nuevoDirId')) {
    $('nuevoDirId').value = siguienteId;
  }

  const modal = $('modalNuevoEmpleadoDirectorio');
  if (modal) modal.classList.remove('hidden');
};

window.cerrarModalNuevoEmpleadoDirectorio = function () {
  const modal = $('modalNuevoEmpleadoDirectorio');
  if (modal) modal.classList.add('hidden');
};

window.guardarNuevoEmpleadoDirectorio = async function () {
  const id = $('nuevoDirId') ? $('nuevoDirId').value.trim() : '';
  const nombre = $('nuevoDirNombre') ? $('nuevoDirNombre').value.trim() : '';
  const area = $('nuevoDirArea') ? $('nuevoDirArea').value.trim().toUpperCase() : '';
  const cargo = $('nuevoDirCargo') ? $('nuevoDirCargo').value.trim() : '';
  const telefono = $('nuevoDirTelefono') ? $('nuevoDirTelefono').value.trim() : '';
  const fechaNacimiento = $('nuevoDirFechaNacimiento') ? $('nuevoDirFechaNacimiento').value.trim() : '';
  const supervisor = $('nuevoDirSupervisor') ? $('nuevoDirSupervisor').value : 'NO';

  if (!id || !nombre || !area || !cargo) {
    mostrarToast('Por favor, completa todos los campos requeridos (*)', 'warning');
    return;
  }

  // Validar si ya existe el ID
  if (empCache && empCache.some(e => String(e.id).trim() === String(id).trim())) {
    mostrarToast(`Ya existe un colaborador con el ID ${id}`, 'error');
    return;
  }

  const empObj = {
    id: id,
    nombre: nombre,
    area: area,
    cargo: cargo,
    pin: '', // Clave vacía: el usuario creará su propio PIN/contraseña en su primer inicio de sesión
    telefono: telefono,
    supervisor: supervisor,
    activo: 'SI',
    cultura_habilitada: true,
    cultura_activa: true,
    fechaNacimiento: fechaNacimiento,
    fecha_ingreso: (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0],
    creado: new Date().toISOString()
  };

  mostrarLoader(true);
  try {
    let res = null;
    if (window.FirebaseBackend && window.USE_FIREBASE) {
      res = await window.FirebaseBackend.actualizarMasivoEmpleados({
        empleados: [empObj]
      });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarMasivoEmpleados',
        empleados: JSON.stringify([empObj])
      });
    }

    mostrarLoader(false);

    if (res && (res.ok || !res.error)) {
      // Agregar a empCache local
      if (empCache) {
        empCache.push(empObj);
        empCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
      }

      cerrarModalNuevoEmpleadoDirectorio();
      mostrarToast(`¡Colaborador ${nombre} registrado con éxito!`, 'success');

      // Identificar al supervisor en sesión para el reporte
      let creadorNombre = 'Supervisor';
      try {
        const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
        if (sessionStr) {
          const sess = JSON.parse(sessionStr);
          const supEmp = (empCache || []).find(x => String(x.id).trim() === String(sess.id).trim());
          creadorNombre = supEmp?.nombre || sess.nombre || `Supervisor (${sess.id})`;
        }
      } catch(e) {}

      // Enviar notificación con enlace al nuevo colaborador y alerta a supervisores
      if (window.OpenWAService && typeof window.OpenWAService.notificarNuevoEmpleadoRegistrado === 'function') {
        window.OpenWAService.notificarNuevoEmpleadoRegistrado(empObj, creadorNombre).then(waRes => {
          if (waRes && waRes.ok) {
            if (waRes.enviadoColaborador) {
              mostrarToast(`📲 Notificación y enlace enviados al WhatsApp de ${nombre}`, 'success');
            } else if (telefono) {
              mostrarToast(`Colaborador guardado. (Nota WhatsApp: no se pudo entregar al colaborador)`, 'info');
            }
            if (waRes.supervisoresNotificados > 0) {
              console.log(`[OpenWA] ${waRes.supervisoresNotificados} supervisores alertados sobre el nuevo usuario.`);
            }
          }
        }).catch(errWa => {
          console.warn("Error enviando notificaciones WhatsApp:", errWa);
        });
      }

      cargarDirectorio();
    } else {
      mostrarToast(res?.error || 'Error al registrar colaborador', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al registrar nuevo empleado:", err);
    mostrarToast('Error de conexión al registrar colaborador', 'error');
  }
};
