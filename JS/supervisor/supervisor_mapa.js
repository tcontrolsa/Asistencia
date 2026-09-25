/**
 * Asistencia Tcontrol - Modulo Mapa de Disponibilidad y Asistencia
 * Extraido en Fase 2 de Modularizacion (Optimizacion de mantenibilidad)
 * Fecha: 2026-09-17
 */

// ============================================================
// MÓDULO: MAPA DE ASISTENCIA Y DISPONIBILIDAD DE PERSONAL
// ============================================================
window._mapaRangoActual = 'semana';
window._mapaFechaRef = new Date();
window._mapaVistaActual = 'matriz';
window._mapaFiltroKpi = 'todos';
window._mapaFiltroEstado = 'TODOS';
window._mapaFiltroArea = '';
window._mapaSearchQuery = '';
window._mapaCustomInicio = null;
window._mapaCustomFin = null;

function formatearFechaCortaMapa(fechaStr) {
  if (!fechaStr) return '';
  const parts = fechaStr.split('-');
  if (parts.length < 3) return fechaStr;
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const mIdx = parseInt(parts[1], 10) - 1;
  return `${parts[2]} ${meses[mIdx] || parts[1]}`;
}

function obtenerNombreDiaMapa(fechaStr) {
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const d = new Date(fechaStr + 'T12:00:00');
  return dias[d.getDay()] || '';
}

window.obtenerRangoFechasMapa = function () {
  let fechas = [];
  let inicio = '';
  let fin = '';
  let label = '';

  if (window._mapaCustomInicio && window._mapaCustomFin) {
    inicio = window._mapaCustomInicio;
    fin = window._mapaCustomFin;
    let cur = new Date(inicio + 'T12:00:00');
    const finDate = new Date(fin + 'T12:00:00');
    let safety = 0;
    while (cur <= finDate && safety < 90) {
      const yyyy = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      fechas.push(`${yyyy}-${mm}-${dd}`);
      cur.setDate(cur.getDate() + 1);
      safety++;
    }
    label = `${formatearFechaCortaMapa(inicio)} - ${formatearFechaCortaMapa(fin)} (${fechas.length} días)`;
    return { fechas, inicio, fin, label };
  }

  const refDate = new Date(window._mapaFechaRef.getTime());

  if (window._mapaRangoActual === 'semana') {
    const dow = refDate.getDay();
    const diffToMon = (dow === 0 ? -6 : 1 - dow); // Lunes es 1, Domingo es 0
    const monday = new Date(refDate);
    monday.setDate(refDate.getDate() + diffToMon);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      fechas.push(`${yyyy}-${mm}-${dd}`);
    }
    inicio = fechas[0];
    fin = fechas[fechas.length - 1];
    label = `Semana: ${formatearFechaCortaMapa(inicio)} al ${formatearFechaCortaMapa(fin)}`;
  }
  else if (window._mapaRangoActual === '14dias') {
    const startDate = new Date(refDate);
    startDate.setDate(refDate.getDate() - 6);

    for (let i = 0; i < 14; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      fechas.push(`${yyyy}-${mm}-${dd}`);
    }
    inicio = fechas[0];
    fin = fechas[fechas.length - 1];
    label = `14 Días: ${formatearFechaCortaMapa(inicio)} al ${formatearFechaCortaMapa(fin)}`;
  }
  else if (window._mapaRangoActual === 'mes') {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let cur = new Date(firstDay);
    while (cur <= lastDay) {
      const yyyy = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      fechas.push(`${yyyy}-${mm}-${dd}`);
      cur.setDate(cur.getDate() + 1);
    }
    inicio = fechas[0];
    fin = fechas[fechas.length - 1];
    const mesesLargo = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    label = `Mes de ${mesesLargo[month]} ${year}`;
  }
  else if (window._mapaRangoActual === 'periodo') {
    let matched = (periodos || []).find(p => {
      const fRefStr = getLocalHoyStr(refDate);
      return fRefStr >= p.inicio && fRefStr <= p.fin;
    }) || (periodos && periodos[0]);

    if (matched) {
      inicio = matched.inicio;
      fin = matched.fin;
      let cur = new Date(inicio + 'T12:00:00');
      const finDate = new Date(fin + 'T12:00:00');
      let safety = 0;
      while (cur <= finDate && safety < 40) {
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, '0');
        const dd = String(cur.getDate()).padStart(2, '0');
        fechas.push(`${yyyy}-${mm}-${dd}`);
        cur.setDate(cur.getDate() + 1);
        safety++;
      }
      label = `Período: ${matched.label || `${inicio} al ${fin}`}`;
    } else {
      const y = refDate.getFullYear();
      const m = refDate.getMonth();
      const pIni = new Date(y, m - 1, 26);
      const pFin = new Date(y, m, 25);
      inicio = getLocalHoyStr(pIni);
      fin = getLocalHoyStr(pFin);
      let cur = new Date(pIni);
      while (cur <= pFin) {
        fechas.push(getLocalHoyStr(cur));
        cur.setDate(cur.getDate() + 1);
      }
      label = `Período 26-25 (${formatearFechaCortaMapa(inicio)} - ${formatearFechaCortaMapa(fin)})`;
    }
  }

  return { fechas, inicio, fin, label };
};

window.obtenerEstadoEmpleadoEnFecha = function (emp, fechaStr) {
  const hoyStr = getLocalHoyStr();
  const esHoy = (fechaStr === hoyStr);
  const regs = (emp.registros || []).filter(r => normalizarFechaStr(r.fecha) === fechaStr);

  const rEntrada = regs.find(r => r.tipo === 'ENTRADA');
  const rSalida = regs.find(r => r.tipo === 'SALIDA');

  const rAusencia = regs.find(r => {
    const t = String(r.tipo || '').toUpperCase();
    return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'SOLO_ALMUERZO';
  });
  const razonStr = String(rAusencia?.razon_ausencia || rAusencia?.razon_permiso || rAusencia?.observacion || rAusencia?.tipo || '').toUpperCase();
  const modoStr = String(regs.find(r => r.modo)?.modo || rEntrada?.modo || '').toUpperCase();

  const dObj = new Date(fechaStr + 'T12:00:00');
  const dow = dObj.getDay(); // 0=Dom, 6=Sab
  const esFinSemanaOFeriado = (dow === 0 || dow === 6 || (typeof esFeriadoODomingo === 'function' && esFeriadoODomingo(fechaStr)));

  // 1. TRABAJO DE CAMPO
  if (modoStr.includes('CAMPO') || razonStr.includes('CAMPO') || razonStr.includes('TRABAJO_DE_CAMPO')) {
    return {
      codigo: 'CAMPO',
      label: 'En Campo',
      sub: rAusencia?.observacion || (rEntrada?.hora ? `Ent: ${rEntrada.hora.slice(0, 5)}` : 'Salida Campo'),
      icono: 'fas fa-route',
      color: '#c2410c',
      bg: '#fff7ed',
      border: '#fed7aa',
      alm: (rEntrada?.almuerzo || emp.almuerzoHoy || ''),
      detalle: `Trabajo en campo: ${rAusencia?.observacion || 'Autorizado'}`
    };
  }

  // 2. VACACIONES
  if (razonStr.includes('VACACI') || (emp.estado || '').toUpperCase() === 'VACACIONES') {
    return {
      codigo: 'VACACIONES',
      label: 'Vacación',
      sub: 'Gozando período',
      icono: 'fas fa-umbrella-beach',
      color: '#0891b2',
      bg: '#ecfeff',
      border: '#a5f3fc',
      alm: '',
      detalle: 'Vacaciones programadas'
    };
  }

  // 3. PERMISO MÉDICO
  if (razonStr.includes('MEDIC') || razonStr.includes('SALUD') || razonStr.includes('DOCTOR')) {
    return {
      codigo: 'PERMISO_MEDICO',
      label: 'P. Médico',
      sub: rAusencia?.observacion || 'Certificado médico',
      icono: 'fas fa-stethoscope',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ddd6fe',
      alm: '',
      detalle: `Permiso médico: ${rAusencia?.observacion || 'Justificado'}`
    };
  }

  // 4. PERMISOS / CALAMIDAD
  if (razonStr.includes('PERMISO') || razonStr.includes('CALAMIDAD') || razonStr.includes('PERSONAL')) {
    return {
      codigo: 'PERMISO',
      label: 'Permiso',
      sub: rAusencia?.observacion || 'Permiso personal',
      icono: 'fas fa-file-signature',
      color: '#9333ea',
      bg: '#faf5ff',
      border: '#f3e8ff',
      alm: '',
      detalle: `Permiso autorizado: ${rAusencia?.observacion || 'Aprobado'}`
    };
  }

  // 5. ENTRADA REGISTRADA
  if (rEntrada || (esHoy && emp.entradaHoy)) {
    const horaE = rEntrada?.hora || emp.horaEntrada || '';
    const horaS = rSalida?.hora || emp.horaSalida || '';
    const mEnt = obtenerMinutos(horaE);
    const refEnt = esFinSemanaOFeriado ? 420 : HORA_ENTRADA_REF;
    const esTardanza = (mEnt !== null && mEnt > refEnt + 5);

    if (esTardanza) {
      return {
        codigo: 'TARDANZA',
        label: 'Tardanza',
        sub: horaE ? horaE.slice(0, 5) : 'Con atraso',
        icono: 'fas fa-exclamation-triangle',
        color: '#b45309',
        bg: '#fffbeb',
        border: '#fde68a',
        alm: (rEntrada?.almuerzo || emp.almuerzoHoy || ''),
        detalle: `Entrada con retraso: ${horaE}${horaS ? ' · Salida: ' + horaS : ''}`
      };
    }

    return {
      codigo: 'PRESENTE',
      label: 'En Planta',
      sub: horaE ? horaE.slice(0, 5) : 'Puntual',
      icono: 'fas fa-building',
      color: '#15803d',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      alm: (rEntrada?.almuerzo || emp.almuerzoHoy || ''),
      detalle: `Asistencia regular: ${horaE}${horaS ? ' · Salida: ' + horaS : ''}`
    };
  }

  // 6. FIN DE SEMANA / FERIADO SIN MARCACIÓN
  if (esFinSemanaOFeriado) {
    return {
      codigo: 'DESCANSO',
      label: 'Descanso',
      sub: dow === 0 ? 'Domingo' : dow === 6 ? 'Sábado' : 'Feriado',
      icono: 'fas fa-bed',
      color: '#64748b',
      bg: '#f8fafc',
      border: '#e2e8f0',
      alm: '',
      detalle: 'Día no laborable / Descanso'
    };
  }

  // 7. DÍA HÁBIL SIN REGISTRO
  if (esHoy) {
    return {
      codigo: 'SIN_MARCAR',
      label: 'Sin Marcar',
      sub: 'Pendiente hoy',
      icono: 'fas fa-bell',
      color: '#dc2626',
      bg: '#fef2f2',
      border: '#fecaca',
      alm: emp.almuerzoHoy || '',
      detalle: 'Sin registro de entrada al momento'
    };
  }

  if (fechaStr < hoyStr) {
    return {
      codigo: 'FALTA',
      label: 'Falta',
      sub: 'Injustificada',
      icono: 'fas fa-times-circle',
      color: '#ef4444',
      bg: '#fee2e2',
      border: '#fca5a5',
      alm: '',
      detalle: 'Falta laboral no registrada'
    };
  }

  // DÍA FUTURO PROGRAMADO
  return {
    codigo: 'PROGRAMADO',
    label: 'Programado',
    sub: 'Jornada normal',
    icono: 'fas fa-calendar',
    color: '#94a3b8',
    bg: '#ffffff',
    border: '#e2e8f0',
    alm: '',
    detalle: 'Jornada laboral programada'
  };
};

window.inicializarMapaAsistencia = function () {
  // Poblar selector de áreas si está vacío
  const selArea = $('mapaFiltroArea');
  if (selArea && selArea.options.length <= 1 && empCache && empCache.length > 0) {
    const areas = [...new Set(empCache.map(e => e.area).filter(Boolean))].sort();
    areas.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      selArea.appendChild(opt);
    });
  }

  const rango = window.obtenerRangoFechasMapa();
  if ($('mapaFechaInicio') && !window._mapaCustomInicio) $('mapaFechaInicio').value = rango.inicio;
  if ($('mapaFechaFin') && !window._mapaCustomFin) $('mapaFechaFin').value = rango.fin;
  if ($('mapaRangoLabel')) $('mapaRangoLabel').textContent = rango.label;

  window.renderMapaAsistencia();
};

window.cambiarRangoMapa = function (rango) {
  window._mapaRangoActual = rango;
  window._mapaCustomInicio = null;
  window._mapaCustomFin = null;

  document.querySelectorAll('.mapa-range-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  if (rango === 'semana') $('btnRangoSemana')?.classList.add('active');
  else if (rango === '14dias') $('btnRango14Dias')?.classList.add('active');
  else if (rango === 'mes') $('btnRangoMes')?.classList.add('active');
  else if (rango === 'periodo') $('btnRangoPeriodo')?.classList.add('active');

  const rangoInfo = window.obtenerRangoFechasMapa();
  if ($('mapaFechaInicio')) $('mapaFechaInicio').value = rangoInfo.inicio;
  if ($('mapaFechaFin')) $('mapaFechaFin').value = rangoInfo.fin;

  window.renderMapaAsistencia();
};

window.navegarRangoMapa = function (delta) {
  if (delta === 0) {
    window._mapaFechaRef = new Date();
  } else {
    const stepDays = (window._mapaRangoActual === 'semana') ? 7 : (window._mapaRangoActual === '14dias') ? 14 : 30;
    window._mapaFechaRef.setDate(window._mapaFechaRef.getDate() + (delta * stepDays));
  }

  window._mapaCustomInicio = null;
  window._mapaCustomFin = null;

  const rangoInfo = window.obtenerRangoFechasMapa();
  if ($('mapaFechaInicio')) $('mapaFechaInicio').value = rangoInfo.inicio;
  if ($('mapaFechaFin')) $('mapaFechaFin').value = rangoInfo.fin;

  window.renderMapaAsistencia();
};

window.aplicarFechasCustomMapa = function () {
  const fIni = $('mapaFechaInicio')?.value;
  const fFin = $('mapaFechaFin')?.value;

  if (!fIni || !fFin) return;
  if (fFin < fIni) {
    mostrarToast('La fecha fin no puede ser anterior a la fecha inicio', 'error');
    return;
  }

  window._mapaCustomInicio = fIni;
  window._mapaCustomFin = fFin;

  document.querySelectorAll('.mapa-range-btn').forEach(btn => btn.classList.remove('active'));
  window.renderMapaAsistencia();
};

window.cambiarVistaMapa = function (vista) {
  window._mapaVistaActual = vista;
  $('btnVistaMatriz')?.classList.toggle('active', vista === 'matriz');
  $('btnVistaTarjetas')?.classList.toggle('active', vista === 'tarjetas');
  $('btnVistaCobertura')?.classList.toggle('active', vista === 'cobertura');

  const wMatriz = $('mapaMatrizViewWrapper');
  const wTarjetas = $('mapaTarjetasViewWrapper');
  const wCobertura = $('mapaCoberturaViewWrapper');

  if (wMatriz) {
    wMatriz.style.display = (vista === 'matriz') ? 'block' : 'none';
    wMatriz.classList.toggle('active', vista === 'matriz');
  }
  if (wTarjetas) {
    wTarjetas.style.display = (vista === 'tarjetas') ? 'block' : 'none';
    wTarjetas.classList.toggle('active', vista === 'tarjetas');
  }
  if (wCobertura) {
    wCobertura.style.display = (vista === 'cobertura') ? 'block' : 'none';
    wCobertura.classList.toggle('active', vista === 'cobertura');
  }

  window.renderMapaAsistencia();
};

window.setFiltroKpiMapa = function (filtro, el) {
  window._mapaFiltroKpi = filtro;
  document.querySelectorAll('.mapa-kpi-grid .kpi-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  window.renderMapaAsistencia();
};

window.setFiltroEstadoMapa = function (estado, el) {
  window._mapaFiltroEstado = estado;
  document.querySelectorAll('.mapa-legend-bar .legend-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  window.renderMapaAsistencia();
};

window.filtrarMapaAsistencia = function () {
  window._mapaSearchQuery = ($('searchMapaAsistencia')?.value || '').trim().toLowerCase();
  window._mapaFiltroArea = $('mapaFiltroArea')?.value || '';
  window.renderMapaAsistencia();
};

window.recargarDatosMapa = async function () {
  mostrarLoader(true);
  try {
    await cargarDatosCompletos(true, false);
    window.inicializarMapaAsistencia();
    mostrarToast('Datos del Mapa actualizados desde el servidor', 'success');
  } catch (e) {
    mostrarToast('Error al recargar datos: ' + e.message, 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.renderMapaAsistencia = function () {
  const rangoInfo = window.obtenerRangoFechasMapa();
  if ($('mapaRangoLabel')) $('mapaRangoLabel').textContent = rangoInfo.label;

  const hoyStr = getLocalHoyStr();

  // 1. CÁLCULO DE KPIS (RESUMEN HOY Y RANGO)
  let kpiTotal = empCache.length;
  let kpiPlanta = 0;
  let kpiSinMarcar = 0;
  let kpiCampo = 0;
  let kpiVacaciones = 0;
  let kpiPermisos = 0;
  let kpiTardanzas = 0;
  let kpiFuturos = 0;
  let kpiAlmPlanta = 0;
  let kpiAlmFuera = 0;

  empCache.forEach(e => {
    const stHoy = window.obtenerEstadoEmpleadoEnFecha(e, hoyStr);
    if (stHoy.codigo === 'PRESENTE') kpiPlanta++;
    else if (stHoy.codigo === 'TARDANZA') { kpiPlanta++; kpiTardanzas++; }
    else if (stHoy.codigo === 'SIN_MARCAR') kpiSinMarcar++;
    else if (stHoy.codigo === 'CAMPO') kpiCampo++;
    else if (stHoy.codigo === 'VACACIONES') kpiVacaciones++;
    else if (stHoy.codigo === 'PERMISO_MEDICO' || stHoy.codigo === 'PERMISO') kpiPermisos++;

    // Almuerzo
    const esPresenteOAlm = e.entradaHoy || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    if (esPresenteOAlm && (e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA')) kpiAlmPlanta++;
    else if (esPresenteOAlm && (e.almuerzoHoy === 'NO' || e.almuerzoHoy === 'FUERA')) kpiAlmFuera++;

    // Contar eventos futuros en el rango
    rangoInfo.fechas.forEach(f => {
      if (f > hoyStr) {
        const stF = window.obtenerEstadoEmpleadoEnFecha(e, f);
        if (stF.codigo === 'VACACIONES' || stF.codigo === 'CAMPO' || stF.codigo === 'PERMISO' || stF.codigo === 'PERMISO_MEDICO') {
          kpiFuturos++;
        }
      }
    });
  });

  // Sumar almuerzos extra de visitantes hoy (excluyendo refrigerios)
  let extrasHoy = window.obtenerAlmuerzosExtraConsolidados(hoyStr, hoyStr);
  let totalExtrasHoy = extrasHoy.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);
  kpiAlmPlanta += totalExtrasHoy;

  if ($('mapaKpiTotal')) $('mapaKpiTotal').textContent = kpiTotal;
  if ($('mapaKpiPlanta')) $('mapaKpiPlanta').textContent = kpiPlanta;
  if ($('mapaKpiSinMarcar')) $('mapaKpiSinMarcar').textContent = kpiSinMarcar;
  if ($('mapaKpiCampo')) $('mapaKpiCampo').textContent = kpiCampo;
  if ($('mapaKpiVacaciones')) $('mapaKpiVacaciones').textContent = kpiVacaciones;
  if ($('mapaKpiPermisos')) $('mapaKpiPermisos').textContent = kpiPermisos;
  if ($('mapaKpiTardanzas')) $('mapaKpiTardanzas').textContent = kpiTardanzas;
  if ($('mapaKpiFuturos')) $('mapaKpiFuturos').textContent = kpiFuturos;
  if ($('mapaKpiAlmPlanta')) $('mapaKpiAlmPlanta').textContent = kpiAlmPlanta;
  if ($('mapaKpiAlmFuera')) $('mapaKpiAlmFuera').textContent = kpiAlmFuera;

  // 2. FILTRADO DE EMPLEADOS
  let filtrados = empCache.filter(e => {
    // Filtro búsqueda texto
    if (window._mapaSearchQuery) {
      const q = window._mapaSearchQuery;
      const matchNom = (e.nombre || '').toLowerCase().includes(q);
      const matchId = String(e.id || '').toLowerCase().includes(q);
      const matchArea = (e.area || '').toLowerCase().includes(q);
      const matchCargo = (e.cargo || '').toLowerCase().includes(q);
      if (!matchNom && !matchId && !matchArea && !matchCargo) return false;
    }

    // Filtro Área
    if (window._mapaFiltroArea && (e.area || '') !== window._mapaFiltroArea) {
      return false;
    }

    // Filtro KPI seleccionado
    const stHoy = window.obtenerEstadoEmpleadoEnFecha(e, hoyStr);
    if (window._mapaFiltroKpi === 'presente' && stHoy.codigo !== 'PRESENTE' && stHoy.codigo !== 'TARDANZA') return false;
    if (window._mapaFiltroKpi === 'sin_marcar' && stHoy.codigo !== 'SIN_MARCAR') return false;
    if (window._mapaFiltroKpi === 'en_campo' && stHoy.codigo !== 'CAMPO') return false;
    if (window._mapaFiltroKpi === 'vacaciones' && stHoy.codigo !== 'VACACIONES') return false;
    if (window._mapaFiltroKpi === 'permisos' && stHoy.codigo !== 'PERMISO' && stHoy.codigo !== 'PERMISO_MEDICO') return false;
    if (window._mapaFiltroKpi === 'tardanza' && stHoy.codigo !== 'TARDANZA') return false;
    if (window._mapaFiltroKpi === 'almuerzo_si' && e.almuerzoHoy !== 'SI' && e.almuerzoHoy !== 'PLANTA') return false;
    if (window._mapaFiltroKpi === 'almuerzo_no' && e.almuerzoHoy !== 'NO' && e.almuerzoHoy !== 'FUERA') return false;
    if (window._mapaFiltroKpi === 'futuros') {
      const tieneFuturo = rangoInfo.fechas.some(f => {
        if (f <= hoyStr) return false;
        const stF = window.obtenerEstadoEmpleadoEnFecha(e, f);
        return stF.codigo === 'VACACIONES' || stF.codigo === 'CAMPO' || stF.codigo === 'PERMISO' || stF.codigo === 'PERMISO_MEDICO';
      });
      if (!tieneFuturo) return false;
    }

    // Filtro Estado Leyenda
    if (window._mapaFiltroEstado !== 'TODOS') {
      const coincideEnRango = rangoInfo.fechas.some(f => {
        const st = window.obtenerEstadoEmpleadoEnFecha(e, f);
        return st.codigo === window._mapaFiltroEstado;
      });
      if (!coincideEnRango) return false;
    }

    return true;
  });

  // Actualizar contadores visibles
  if ($('mapaResultCount')) $('mapaResultCount').textContent = filtrados.length;
  if ($('mapaTotalCount')) $('mapaTotalCount').textContent = empCache.length;

  // Renderizar la vista activa
  if (window._mapaVistaActual === 'matriz') {
    window.renderMatrizMapa(filtrados, rangoInfo);
  } else if (window._mapaVistaActual === 'tarjetas') {
    window.renderTarjetasMapa(filtrados, rangoInfo);
  } else if (window._mapaVistaActual === 'cobertura') {
    window.renderCoberturaMapa(filtrados, rangoInfo);
  }
};

window.renderMatrizMapa = function (empleados, rangoInfo) {
  const container = $('mapaMatrizContainer');
  if (!container) return;

  if (!empleados || empleados.length === 0) {
    container.innerHTML = `
          <div style="padding:48px 20px; text-align:center; color:#64748b;">
            <i class="fas fa-users-slash" style="font-size:32px; color:#cbd5e1; margin-bottom:12px; display:block;"></i>
            <div style="font-size:14.5px; font-weight:750; color:#1e293b;">No hay colaboradores que coincidan con los filtros</div>
            <div style="font-size:12px; margin-top:4px;">Prueba cambiando el rango de fechas, seleccionando "Todos" o limpiando el texto de búsqueda.</div>
          </div>`;
    return;
  }

  const hoyStr = getLocalHoyStr();

  // Encabezado de la tabla
  let thColsHtml = rangoInfo.fechas.map(f => {
    const esHoy = (f === hoyStr);
    const nomDia = obtenerNombreDiaMapa(f);
    const dd = f.slice(8, 10);
    const mm = f.slice(5, 7);

    return `
          <th class="${esHoy ? 'col-is-today' : ''}" style="text-align:center; min-width:96px; padding:6px 4px;">
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; opacity:0.8;">${nomDia}</div>
            <div style="font-size:12.5px; font-weight:800; line-height:1.2;">${dd}/${mm}</div>
            ${esHoy ? '<span style="display:inline-block; font-size:9px; background:#3b82f6; color:white; padding:1px 5px; border-radius:4px; font-weight:800; margin-top:2px;">HOY</span>' : ''}
          </th>`;
  }).join('');

  // Filas de colaboradores
  let rowsHtml = empleados.map(emp => {
    const fotoHtml = (typeof photoCell === 'function') ? photoCell(emp) : `
          <div style="width:30px; height:30px; border-radius:50%; background:#e0e7ff; color:#4338ca; font-weight:700; font-size:11px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #c7d2fe; flex-shrink:0;">
            ${(emp.nombre || '').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'TC'}
          </div>`;

    let cellsHtml = rangoInfo.fechas.map(f => {
      const esHoy = (f === hoyStr);
      const st = window.obtenerEstadoEmpleadoEnFecha(emp, f);

      return `
            <td class="mapa-matrix-cell ${esHoy ? 'col-is-today' : ''}">
              <div class="mapa-status-chip" 
                   title="${escapeHtml(emp.nombre)} [${f}]: ${st.label} - ${st.detalle || st.sub}"
                   onclick="${f >= hoyStr ? `window.mostrarModalFuturos('${emp.id}', '${f}')` : `mostrarDetalle('${emp.id}')`}"
                   style="background:${st.bg}; border:1px solid ${st.border}; color:${st.color};">
                <div style="display:flex; align-items:center; gap:4px; font-size:10px; font-weight:800;">
                  <i class="${st.icono}"></i>
                  <span>${st.label}</span>
                </div>
                <div style="font-size:8.5px; font-weight:600; opacity:0.85; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px;">
                  ${st.sub}
                </div>
              </div>
            </td>`;
    }).join('');

    return `
          <tr>
            <td class="col-emp-sticky">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px; min-width:0; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="Ver detalle de asistencia de ${escapeHtml(emp.nombre)}">
                  ${fotoHtml}
                  <div style="min-width:0;">
                    <div style="font-weight:750; font-size:11.5px; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:145px;">
                      ${escapeHtml(emp.nombre)}
                    </div>
                    <div style="font-size:10px; color:#64748b; display:flex; align-items:center; gap:6px; margin-top:1px;">
                      <span>ID: <strong>${emp.id}</strong></span>
                      <span>·</span>
                      <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px;" title="${escapeHtml(emp.area || '')}">${escapeHtml(emp.area || '—')}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex; gap:3px; flex-shrink:0;">
                  <button type="button" onclick="window.mostrarModalFuturos('${emp.id}')" title="Registrar vacación/permiso para ${escapeHtml(emp.nombre)}" style="background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; border-radius:5px; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:9px;">
                    <i class="fas fa-calendar-plus"></i>
                  </button>
                  <button type="button" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" title="Registrar salida a campo para ${escapeHtml(emp.nombre)}" style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; border-radius:5px; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:9px;">
                    <i class="fas fa-hammer"></i>
                  </button>
                </div>
              </div>
            </td>
            ${cellsHtml}
          </tr>`;
  }).join('');

  // Fila de resumen diario en pie de tabla
  let footerDailyCols = rangoInfo.fechas.map(f => {
    let presDia = 0, campoDia = 0, ausDia = 0;
    empleados.forEach(e => {
      const st = window.obtenerEstadoEmpleadoEnFecha(e, f);
      if (st.codigo === 'PRESENTE' || st.codigo === 'TARDANZA') presDia++;
      else if (st.codigo === 'CAMPO') campoDia++;
      else if (st.codigo === 'VACACIONES' || st.codigo === 'PERMISO' || st.codigo === 'PERMISO_MEDICO' || st.codigo === 'FALTA') ausDia++;
    });

    return `
          <td style="text-align:center; padding:5px 3px; font-size:9.5px; background:#f8fafc;">
            <div style="color:#15803d; font-weight:750;" title="Presentes en planta"><i class="fas fa-building" style="font-size:8.5px;"></i> ${presDia}</div>
            <div style="color:#ea580c; font-weight:750;" title="En campo"><i class="fas fa-route" style="font-size:8.5px;"></i> ${campoDia}</div>
            <div style="color:#dc2626; font-weight:750;" title="Ausencias / Vacaciones"><i class="fas fa-times-circle" style="font-size:8.5px;"></i> ${ausDia}</div>
          </td>`;
  }).join('');

  container.innerHTML = `
        <table class="mapa-matrix-table">
          <thead>
            <tr>
              <th class="col-emp-sticky">Colaborador (${empleados.length})</th>
              ${thColsHtml}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid #cbd5e1; font-weight:750;">
              <td class="col-emp-sticky" style="font-size:10.5px; color:#475569;">
                <div style="font-weight:800;">TOTALES DIARIOS</div>
                <div style="font-size:9px; color:#64748b; font-weight:600;">(🟩 Planta · 🟧 Campo · 🟥 Ausentes)</div>
              </td>
              ${footerDailyCols}
            </tr>
          </tfoot>
        </table>`;
};

window.renderTarjetasMapa = function (empleados, rangoInfo) {
  const container = $('mapaTarjetasContainer');
  if (!container) return;

  if (!empleados || empleados.length === 0) {
    container.innerHTML = `
          <div style="padding:48px 20px; text-align:center; color:#64748b; grid-column: 1 / -1;">
            <i class="fas fa-id-card" style="font-size:32px; color:#cbd5e1; margin-bottom:12px; display:block;"></i>
            <div style="font-size:14.5px; font-weight:750; color:#1e293b;">No hay tarjetas para mostrar</div>
          </div>`;
    return;
  }

  const hoyStr = getLocalHoyStr();
  const ultimos7Dias = rangoInfo.fechas.slice(-7);

  container.innerHTML = empleados.map(emp => {
    const stHoy = window.obtenerEstadoEmpleadoEnFecha(emp, hoyStr);
    const fotoHtml = (typeof photoCell === 'function') ? photoCell(emp) : '';

    // Mini ribbon de últimos 7 días
    let miniTimelineHtml = ultimos7Dias.map(f => {
      const stF = window.obtenerEstadoEmpleadoEnFecha(emp, f);
      const nomDia = obtenerNombreDiaMapa(f).slice(0, 1);
      const esHoy = (f === hoyStr);
      return `
            <div style="display:flex; flex-direction:column; align-items:center; gap:2px;" title="${f}: ${stF.label} (${stF.sub})">
              <span style="font-size:9px; color:${esHoy ? '#2563eb' : '#94a3b8'}; font-weight:${esHoy ? '800' : '600'};">${nomDia}</span>
              <div style="width:14px; height:14px; border-radius:50%; background:${stF.color}; border:${esHoy ? '2px solid #2563eb' : 'none'};" title="${stF.label}"></div>
            </div>`;
    }).join('');

    return `
          <div class="mapa-emp-card">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  ${fotoHtml}
                  <div style="min-width:0;">
                    <h4 style="margin:0; font-size:13px; font-weight:750; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')">
                      ${escapeHtml(emp.nombre)}
                    </h4>
                    <div style="font-size:11px; color:#64748b; font-weight:600; margin-top:2px;">
                      <span>ID: ${emp.id}</span> · <span>${escapeHtml(emp.area || 'Sin Área')}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Badge Estado Hoy -->
              <div style="background:${stHoy.bg}; border:1px solid ${stHoy.border}; border-radius:10px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <i class="${stHoy.icono}" style="font-size:16px; color:${stHoy.color};"></i>
                  <div>
                    <div style="font-size:12px; font-weight:800; color:${stHoy.color};">${stHoy.label}</div>
                    <div style="font-size:10px; color:#64748b; font-weight:600;">${stHoy.sub}</div>
                  </div>
                </div>
                ${stHoy.alm ? `<span style="font-size:10px; font-weight:700; background:#ffffff; color:#4338ca; padding:2px 7px; border-radius:6px; border:1px solid #c7d2fe;"><i class="fas fa-utensils"></i> Alm: ${stHoy.alm}</span>` : ''}
              </div>

              <!-- Ribbon de 7 días -->
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; margin-bottom:12px;">
                <div style="font-size:9.5px; font-weight:700; color:#64748b; margin-bottom:4px; text-transform:uppercase;">Historial Reciente (7 días)</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  ${miniTimelineHtml}
                </div>
              </div>
            </div>

            <!-- Botones de Acción -->
            <div style="display:flex; gap:6px; border-top:1px solid #f1f5f9; padding-top:10px;">
              <button type="button" onclick="mostrarDetalle('${emp.id}')" class="btn" style="flex:1; padding:6px; font-size:11px; font-weight:700; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; border-radius:7px; cursor:pointer;">
                <i class="fas fa-user-clock"></i> Detalle
              </button>
              <button type="button" onclick="window.mostrarModalFuturos('${emp.id}')" class="btn" style="flex:1; padding:6px; font-size:11px; font-weight:700; background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; border-radius:7px; cursor:pointer;">
                <i class="fas fa-calendar-plus"></i> Ausencia
              </button>
              <button type="button" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" class="btn" style="flex:1; padding:6px; font-size:11px; font-weight:700; background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; border-radius:7px; cursor:pointer;">
                <i class="fas fa-hammer"></i> Campo
              </button>
            </div>
          </div>`;
  }).join('');
};

window.renderCoberturaMapa = function (empleados, rangoInfo) {
  const container = $('mapaCoberturaContainer');
  if (!container) return;

  if (!empleados || empleados.length === 0) {
    container.innerHTML = `
          <div style="padding:48px 20px; text-align:center; color:#64748b; grid-column: 1 / -1;">
            <i class="fas fa-chart-bar" style="font-size:32px; color:#cbd5e1; margin-bottom:12px; display:block;"></i>
            <div style="font-size:14.5px; font-weight:750; color:#1e293b;">No hay información de cobertura disponible</div>
          </div>`;
    return;
  }

  const hoyStr = getLocalHoyStr();

  // Agrupar empleados por Área
  const areasMap = {};
  empleados.forEach(emp => {
    const area = emp.area || 'Sin Área Asignada';
    if (!areasMap[area]) areasMap[area] = [];
    areasMap[area].push(emp);
  });

  const areas = Object.keys(areasMap).sort();

  container.innerHTML = areas.map(areaNom => {
    const staff = areasMap[areaNom];
    const tot = staff.length;
    let pres = 0, campo = 0, aus = 0;

    staff.forEach(e => {
      const st = window.obtenerEstadoEmpleadoEnFecha(e, hoyStr);
      if (st.codigo === 'PRESENTE' || st.codigo === 'TARDANZA') pres++;
      else if (st.codigo === 'CAMPO') campo++;
      else aus++;
    });

    const pctPres = Math.round((pres / tot) * 100) || 0;
    const pctCampo = Math.round((campo / tot) * 100) || 0;
    const pctAus = Math.round((aus / tot) * 100) || 0;

    // Lista de chips de colaboradores
    const chipsHtml = staff.map(e => {
      const st = window.obtenerEstadoEmpleadoEnFecha(e, hoyStr);
      return `
            <div style="display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:16px; background:${st.bg}; border:1px solid ${st.border}; color:${st.color}; font-size:10.5px; font-weight:700; cursor:pointer;" onclick="mostrarDetalle('${e.id}')" title="${escapeHtml(e.nombre)}: ${st.label}">
              <i class="${st.icono}"></i>
              <span>${escapeHtml(e.nombre.split(' ')[0])}</span>
            </div>`;
    }).join(' ');

    return `
          <div class="mapa-cov-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h4 style="margin:0; font-size:14px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:6px;">
                <i class="fas fa-building" style="color:var(--blue);"></i> ${escapeHtml(areaNom)}
              </h4>
              <span style="font-size:11px; font-weight:700; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:10px;">${tot} colaboradores</span>
            </div>

            <!-- Barra de Progreso de Cobertura -->
            <div style="height:10px; width:100%; background:#f1f5f9; border-radius:6px; overflow:hidden; display:flex; margin-bottom:12px;">
              <div style="width:${pctPres}%; background:#16a34a;" title="En Planta: ${pres} (${pctPres}%)"></div>
              <div style="width:${pctCampo}%; background:#ea580c;" title="En Campo: ${campo} (${pctCampo}%)"></div>
              <div style="width:${pctAus}%; background:#ef4444;" title="Ausente/Permiso: ${aus} (${pctAus}%)"></div>
            </div>

            <!-- Métricas Clave -->
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; text-align:center; margin-bottom:14px;">
              <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:6px;">
                <div style="font-size:16px; font-weight:800; color:#15803d;">${pres}</div>
                <div style="font-size:9.5px; font-weight:700; color:#166534;">En Planta</div>
              </div>
              <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:6px;">
                <div style="font-size:16px; font-weight:800; color:#c2410c;">${campo}</div>
                <div style="font-size:9.5px; font-weight:700; color:#9a3412;">En Campo</div>
              </div>
              <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:6px;">
                <div style="font-size:16px; font-weight:800; color:#dc2626;">${aus}</div>
                <div style="font-size:9.5px; font-weight:700; color:#991b1b;">Ausentes</div>
              </div>
            </div>

            <!-- Desglose de Personal -->
            <div style="border-top:1px solid #f1f5f9; padding-top:10px;">
              <div style="font-size:10px; font-weight:750; color:#64748b; text-transform:uppercase; margin-bottom:6px;">Personal del Área Hoy</div>
              <div style="display:flex; flex-wrap:wrap; gap:5px;">
                ${chipsHtml}
              </div>
            </div>
          </div>`;
  }).join('');
};

window.exportarExcelMapaAsistencia = function () {
  const rangoInfo = window.obtenerRangoFechasMapa();
  if (!empCache || empCache.length === 0) {
    mostrarToast('No hay datos disponibles para exportar', 'error');
    return;
  }

  let csv = 'ID,Nombre,Area,Cargo';
  rangoInfo.fechas.forEach(f => {
    csv += `,"${f} (${obtenerNombreDiaMapa(f)})"`;
  });
  csv += '\n';

  empCache.forEach(emp => {
    const nom = (emp.nombre || '').replaceAll('"', '""');
    const area = (emp.area || '').replaceAll('"', '""');
    const cargo = (emp.cargo || '').replaceAll('"', '""');
    let row = `"${emp.id}","${nom}","${area}","${cargo}"`;

    rangoInfo.fechas.forEach(f => {
      const st = window.obtenerEstadoEmpleadoEnFecha(emp, f);
      const cellVal = `${st.label} - ${st.sub}`.replaceAll('"', '""');
      row += `,"${cellVal}"`;
    });
    csv += row + '\n';
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Mapa_Asistencia_${rangoInfo.inicio}_al_${rangoInfo.fin}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast('Archivo de Mapa de Asistencia generado y descargado exitosamente', 'success');
};

