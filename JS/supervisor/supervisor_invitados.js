/**
 * Asistencia Tcontrol - Modulo Invitados y Catering
 * Extraido en Fase 2 de Modularizacion (Optimizacion de mantenibilidad)
 * Fecha: 2026-09-17
 */

// ============================================================
// PANEL INVITADOS & CATERING (ALMUERZOS EXTRA Y REFRIGERIOS)
// ============================================================
function esAlmuerzoExtraItem(ae) {
  if (!ae) return false;
  const t = String(ae.tipo || ae.subtipo || '').toUpperCase();
  return !t.includes('REFRIGERIO');
}

function esRefrigerioSanducheItem(ae) {
  if (!ae) return false;
  const t = String(ae.tipo || ae.subtipo || '').toUpperCase();
  return t.includes('SANDUCHE');
}

function esRefrigerioGalletasItem(ae) {
  if (!ae) return false;
  const t = String(ae.tipo || ae.subtipo || '').toUpperCase();
  return t.includes('GALLETA');
}

window.cargarPanelInvitados = async function (force = false) {
  const hoy = (typeof hoyStr !== 'undefined' && hoyStr) ? hoyStr : new Date().toISOString().slice(0, 10);
  const inputFecha = $('filtroFechaInvitados');
  if (inputFecha && !inputFecha.value) {
    inputFecha.value = hoy;
  }

  if (force) {
    mostrarLoader(true);
    try {
      const [resSol, resExtra] = await Promise.all([
        jsonpRequest({ accion: 'obtenerSolicitudesInvitados' }),
        jsonpRequest({ accion: 'obtenerAlmuerzosExtra' })
      ]);
      if (resSol && resSol.ok && resSol.solicitudes) {
        window.solicitudesInvitados = resSol.solicitudes;
      }
      if (resExtra && resExtra.ok && resExtra.almuerzos) {
        window.almuerzosExtra = resExtra.almuerzos;
      }
    } catch (e) {
      console.warn("Error forzando actualización de invitados:", e);
    } finally {
      mostrarLoader(false);
    }
  }

  window.filtrarTablaInvitados();
};

window.setFiltroFechaInvitadosHoy = function () {
  const hoy = (typeof hoyStr !== 'undefined' && hoyStr) ? hoyStr : new Date().toISOString().slice(0, 10);
  const input = $('filtroFechaInvitados');
  if (input) {
    input.value = hoy;
    window.filtrarTablaInvitados();
  }
};

window.setFiltroFechaInvitadosManana = function () {
  const ahora = new Date();
  ahora.setDate(ahora.getDate() + 1);
  const manana = ahora.toISOString().slice(0, 10);
  const input = $('filtroFechaInvitados');
  if (input) {
    input.value = manana;
    window.filtrarTablaInvitados();
  }
};

window.setFiltroFechaInvitadosTodas = function () {
  const input = $('filtroFechaInvitados');
  if (input) {
    input.value = '';
    window.filtrarTablaInvitados();
  }
};

// Helper para desglosar observaciones compuestas de la hoja ALMUERZOS_EXTRA o Firestore
function desglosarObservacionesInvitado(rawObs) {
  let obs = String(rawObs || '').trim();
  let horaReq = '';
  let area = '';
  let sol = '';

  const matchHora = obs.match(/\[Hora\s*req:\s*([^\]]+)\]/i);
  if (matchHora) {
    horaReq = matchHora[1].trim();
    obs = obs.replace(matchHora[0], '').trim();
  }

  const matchArea = obs.match(/\[Área:\s*([^\]]+)\]/i) || obs.match(/\[Area:\s*([^\]]+)\]/i);
  if (matchArea) {
    area = matchArea[1].trim();
    obs = obs.replace(matchArea[0], '').trim();
  }

  const matchSol = obs.match(/\(Sol:\s*([^\)]+)\)/i);
  if (matchSol) {
    sol = matchSol[1].trim();
    obs = obs.replace(matchSol[0], '').trim();
  }

  // Limpiar espacios repetidos
  obs = obs.replace(/\s{2,}/g, ' ').trim();
  return { obsLimpia: obs, horaReq, area, sol };
}

window.mostrarDetalleCalculoCard = function (tipo) {
  let periodo = periodos[parseInt($('periodoMensual')?.value || 0)];
  const fechaInicio = $('filtroFechaReportesInicio')?.value;
  const fechaFin = $('filtroFechaReportesFinalizacion')?.value;
  const R_INI = fechaInicio ? fechaInicio : (periodo ? periodo.inicio : '');
  const R_FIN = fechaFin ? fechaFin : (periodo ? periodo.fin : '');

  let stats = window._reportesData || [];
  let totalAlmPlanta = stats.reduce((s, r) => s + (r.almPlanta || 0), 0);
  let totalAlmFuera = stats.reduce((s, r) => s + (r.almFuera || 0), 0);
  let extrasPeriodo = (typeof window.obtenerAlmuerzosExtraConsolidados === 'function') ? window.obtenerAlmuerzosExtraConsolidados(R_INI, R_FIN) : [];
  let totalAlmExt = extrasPeriodo.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);
  let totalAlmLunch = totalAlmPlanta + totalAlmExt;

  if (tipo === 'almTotal' || tipo === 'almPlanta' || tipo === 'almExtras' || tipo === 'almFuera') {
    let titulo = "Detalle de Almuerzos en Planta";
    let contenido = `
      <div style="text-align:left; font-size:13px; color:#1e293b; line-height:1.6;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>🍽️ <strong>Almuerzos Colaboradores:</strong></span>
            <strong style="color:#10b981; font-size:14px;">${totalAlmPlanta}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>➕ <strong>Almuerzos Extras (Invitados/Visitas):</strong></span>
            <strong style="color:#0284c7; font-size:14px;">${totalAlmExt}</strong>
          </div>
          <hr style="border:0; border-top:1px dashed #cbd5e1; margin:8px 0;">
          <div style="display:flex; justify-content:space-between; font-size:14px;">
            <span>🏢 <strong>TOTAL ALMUERZOS EN PLANTA:</strong></span>
            <strong style="color:#059669; font-size:16px;">${totalAlmLunch}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:12px; color:#64748b; margin-top:6px;">
            <span>🏠 Almuerzos marcados Fuera:</span>
            <span>${totalAlmFuera}</span>
          </div>
        </div>
        ${extrasPeriodo.length > 0 ? `
          <div style="font-weight:700; margin-bottom:6px; font-size:12px; color:#475569;">Desglose de Extras / Invitados (${extrasPeriodo.length} registros):</div>
          <div style="max-height:180px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:6px; background:#ffffff; font-size:11.5px;">
            ${extrasPeriodo.map(e => `
              <div style="display:flex; justify-content:space-between; padding:4px 6px; border-bottom:1px solid #f1f5f9;">
                <span><strong>${escapeHtml(e.fecha)}</strong> - ${escapeHtml(e.invitado || e.nombre || 'Visita')} <small style="color:#64748b;">(${escapeHtml(e.solicitante || 'Supervisor')})</small></span>
                <span style="font-weight:700; color:#0284c7;">+${e.cantidad || 1}</span>
              </div>
            `).join('')}
          </div>
        ` : '<div style="font-size:11.5px; color:#94a3b8;">No se registraron solicitudes de almuerzos extra en este rango.</div>'}
      </div>
    `;

    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: titulo,
        html: contenido,
        icon: 'info',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#2563eb'
      });
    } else {
      mostrarToast(`Total Planta: ${totalAlmLunch} (${totalAlmPlanta} emp. + ${totalAlmExt} extras)`, 'info');
    }
  } else {
    mostrarToast(`Métrica: ${tipo}`, 'info');
  }
};

window.setFiltroKpiInvitados = function (tipo) {
  const select = $('filtroTipoInvitados');
  if (select) {
    select.value = tipo || 'TODOS';
    window.filtrarTablaInvitados();
  }
};

window.filtrarTablaInvitados = function () {
  const fechaFiltro = $('filtroFechaInvitados')?.value || '';
  const tipoFiltro = $('filtroTipoInvitados')?.value || 'TODOS';
  const estadoFiltro = $('filtroEstadoInvitados')?.value || 'TODOS';
  const queryBusqueda = ($('filtroBusquedaInvitados')?.value || '').toLowerCase().trim();

  // Sincronizar estilo activo de los botones pill de fecha
  const hoyStrLocal = normalizarFechaStr(new Date().toISOString().slice(0, 10));
  const ahoraDate = new Date();
  ahoraDate.setDate(ahoraDate.getDate() + 1);
  const mananaStrLocal = normalizarFechaStr(ahoraDate.toISOString().slice(0, 10));

  const btnPillHoy = $('btnPillHoy');
  const btnPillManana = $('btnPillManana');
  const btnPillTodas = $('btnPillTodas');
  if (btnPillHoy) btnPillHoy.classList.toggle('active', fechaFiltro === hoyStrLocal);
  if (btnPillManana) btnPillManana.classList.toggle('active', fechaFiltro === mananaStrLocal);
  if (btnPillTodas) btnPillTodas.classList.toggle('active', !fechaFiltro);

  const todos = window.obtenerListaConsolidadaInvitados();

  // Filtrar
  let filtrados = todos;
  if (fechaFiltro) {
    filtrados = filtrados.filter(i => i.fecha === fechaFiltro);
  }
  if (tipoFiltro !== 'TODOS') {
    filtrados = filtrados.filter(i => i.subtipo === tipoFiltro);
  }
  if (estadoFiltro !== 'TODOS') {
    filtrados = filtrados.filter(i => i.estado === estadoFiltro);
  }
  if (queryBusqueda) {
    filtrados = filtrados.filter(i =>
      (i.invitado || '').toLowerCase().includes(queryBusqueda) ||
      (i.empresa || '').toLowerCase().includes(queryBusqueda) ||
      (i.solicitante || '').toLowerCase().includes(queryBusqueda) ||
      (i.observaciones || '').toLowerCase().includes(queryBusqueda) ||
      (i.area || '').toLowerCase().includes(queryBusqueda)
    );
  }

  // Calcular KPIs para la fecha seleccionada (o todos si no hay filtro de fecha)
  const baseKpi = fechaFiltro ? todos.filter(i => i.fecha === fechaFiltro && i.estado !== 'CANCELADO') : todos.filter(i => i.estado !== 'CANCELADO');
  let kpiAlm = 0, kpiSand = 0, kpiGall = 0, kpiTot = 0;

  baseKpi.forEach(item => {
    const cant = parseInt(item.cantidad) || 0;
    kpiTot += cant;
    if (item.subtipo === 'ALMUERZO_EXTRA') kpiAlm += cant;
    else if (item.subtipo === 'REFRIGERIO_SANDUCHE') kpiSand += cant;
    else if (item.subtipo === 'REFRIGERIO_GALLETAS') kpiGall += cant;
  });

  if ($('kpiInvitadosAlmuerzos')) $('kpiInvitadosAlmuerzos').textContent = kpiAlm;
  if ($('kpiInvitadosSanduches')) $('kpiInvitadosSanduches').textContent = kpiSand;
  if ($('kpiInvitadosGalletas')) $('kpiInvitadosGalletas').textContent = kpiGall;
  if ($('kpiInvitadosTotal')) $('kpiInvitadosTotal').textContent = kpiTot;

  // Actualizar badge de la barra de navegación para solicitudes de hoy
  const pedidosHoy = todos.filter(i => i.fecha === hoyStrLocal && i.estado !== 'CANCELADO');
  const badgeNav = $('badgeInvitadosCount');
  if (badgeNav) {
    if (pedidosHoy.length > 0) {
      badgeNav.textContent = pedidosHoy.length;
      badgeNav.style.display = 'inline-block';
    } else {
      badgeNav.style.display = 'none';
    }
  }
  if (typeof window.actualizarNotificacionesSupAdminInvitados === 'function') {
    window.actualizarNotificacionesSupAdminInvitados();
  }

  // Renderizar tabla
  const tbody = $('tbodyInvitadosSupervisor');
  if (!tbody) return;

  if (filtrados.length === 0) {
    tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align:center; padding:45px 20px; color:#94a3b8;">
              <div style="font-size:32px; margin-bottom:10px;">🍽️</div>
              <div style="font-weight:750; font-size:14px; color:#334155;">No hay solicitudes registradas</div>
              <div style="font-size:12px; color:#94a3b8; margin-top:4px;">No se encontraron pedidos con los filtros aplicados. Prueba seleccionando "Ver Todo" o cambiando la fecha.</div>
            </td>
          </tr>
        `;
    return;
  }

  tbody.innerHTML = filtrados.map(item => {
    const isAlm = item.subtipo === 'ALMUERZO_EXTRA';
    const isSand = item.subtipo === 'REFRIGERIO_SANDUCHE';
    const badgeIcon = isAlm ? '🍱' : (isSand ? '🥪' : '🍪');
    const badgeText = isAlm ? 'Almuerzo Extra' : (isSand ? 'Sánduche' : 'Break Galletas');
    const badgeBg = isAlm ? '#eff6ff' : (isSand ? '#fff7ed' : '#fefce8');
    const badgeColor = isAlm ? '#1e40af' : (isSand ? '#c2410c' : '#a16207');

    const estadoStyles = {
      'SOLICITADO': { bg: '#fef9c3', color: '#854d0e', text: '⏳ Solicitado' },
      'CONFIRMADO': { bg: '#dbeafe', color: '#1e40af', text: '✓ Confirmado' },
      'ENTREGADO': { bg: '#dcfce7', color: '#15803d', text: '🍽️ Entregado' },
      'CANCELADO': { bg: '#fee2e2', color: '#b91c1c', text: '✕ Cancelado' }
    };
    const est = estadoStyles[item.estado] || estadoStyles['SOLICITADO'];

    return `
          <tr style="${item.estado === 'CANCELADO' ? 'opacity: 0.55; background: #fafafa;' : ''}">
            <td>
              <div style="font-weight:750; font-size:12.5px; color:#0f172a; white-space:nowrap;">
                <i class="far fa-calendar-alt text-primary" style="margin-right:4px;"></i>${item.fecha}
              </div>
              <div style="font-size:11px; color:#64748b; margin-top:2px; white-space:nowrap;">
                <i class="far fa-clock" style="margin-right:3px;"></i>${item.hora || '--:--'}
              </div>
            </td>
            <td>
              <div style="font-weight:750; font-size:12.5px; color:#0f172a;">${escapeHtml(item.solicitante)}</div>
              ${item.area ? `<span style="font-size:10px; font-weight:700; background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; display:inline-block; margin-top:2px;"><i class="fas fa-building" style="margin-right:3px;"></i>${escapeHtml(item.area)}</span>` : ''}
            </td>
            <td>
              <span style="font-size:11px; font-weight:750; background:${badgeBg}; color:${badgeColor}; padding:4px 9px; border-radius:8px; display:inline-flex; align-items:center; gap:5px; border:1px solid ${badgeColor}33; white-space:nowrap;">
                ${badgeIcon} ${badgeText}
              </span>
            </td>
            <td style="text-align:center;">
              <span style="display:inline-block; min-width:28px; padding:3px 8px; border-radius:8px; font-weight:800; font-size:13px; background:#f1f5f9; color:#0f172a;">${item.cantidad}</span>
            </td>
            <td>
              <div style="font-weight:750; font-size:13px; color:#1e293b;">${escapeHtml(item.invitado)}</div>
              ${item.empresa && item.empresa !== 'TCONTROL' ? `<div style="font-size:11px; color:#0284c7; font-weight:700; margin-top:3px; display:inline-flex; align-items:center; gap:4px; background:#f0f9ff; border:1px solid #bae6fd; padding:1px 6px; border-radius:4px;"><i class="fas fa-briefcase"></i>${escapeHtml(item.empresa)}</div>` : ''}
            </td>
            <td>
              ${item.horaServicio ? `<div style="font-size:11px; font-weight:750; color:#c2410c; background:#fff7ed; border:1px solid #ffedd5; padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; margin-bottom:4px;"><i class="fas fa-bell"></i>Servir a las: ${escapeHtml(item.horaServicio)}</div>` : ''}
              <div style="font-size:11.5px; color:#475569; line-height:1.35;" title="${escapeHtml(item.observaciones || '')}">
                ${item.observaciones ? escapeHtml(item.observaciones) : '<span style="color:#cbd5e1; font-style:italic;">Sin observaciones adicionales</span>'}
              </div>
            </td>
            <td style="text-align:center;">
              <select onchange="window.cambiarEstadoInvitadoSupervisor('${item.id}', this.value, '${item.origen}')" style="font-size:11.5px; font-weight:750; padding:4px 8px; border-radius:20px; border:1px solid ${est.color}44; background:${est.bg}; color:${est.color}; cursor:pointer; outline:none; transition:all 0.15s;">
                <option value="SOLICITADO" ${item.estado === 'SOLICITADO' ? 'selected' : ''}>⏳ Solicitado</option>
                <option value="CONFIRMADO" ${item.estado === 'CONFIRMADO' ? 'selected' : ''}>✓ Confirmado</option>
                <option value="ENTREGADO" ${item.estado === 'ENTREGADO' ? 'selected' : ''}>🍽️ Entregado</option>
                <option value="CANCELADO" ${item.estado === 'CANCELADO' ? 'selected' : ''}>✕ Cancelado</option>
              </select>
            </td>
            <td style="text-align:center;">
              <button type="button" class="btn-del-invitado" onclick="window.eliminarInvitadoSupervisor('${item.id}')" title="Eliminar registro de ALMUERZOS_EXTRA y notificar a Sup. Admin" style="border:none; background:#fee2e2; color:#dc2626; border-radius:8px; width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; transition:all 0.15s; box-shadow:0 1px 3px rgba(220,38,38,0.15);">
                <i class="fas fa-trash-alt"></i>
              </button>
            </td>
          </tr>
        `;
  }).join('');
};

window.cambiarEstadoInvitadoSupervisor = async function (id, nuevoEstado, origen) {
  if (origen === 'SHEETS') {
    mostrarToast("Registro de Sheets actualizado localmente", "info");
    const matchSheet = (window.almuerzosExtra || []).find((_, idx) => `sheet_extra_${idx}`.includes(id));
    if (matchSheet) matchSheet.estado = nuevoEstado;
    window.filtrarTablaInvitados();
    return;
  }

  mostrarLoader(true);
  try {
    let sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}');
    const supName = sessionData.nombre || 'Supervisor';
    const res = await jsonpRequest({
      accion: 'actualizarEstadoSolicitudInvitado',
      id: id,
      estado: nuevoEstado,
      actualizadoPor: supName
    });
    mostrarLoader(false);
    if (res && res.ok) {
      mostrarToast("Estado actualizado correctamente", "success");
      const item = (window.solicitudesInvitados || []).find(x => x.id === id);
      if (item) item.estado = nuevoEstado;
      window.filtrarTablaInvitados();
    } else {
      mostrarToast("Error: " + (res?.error || "Desconocido"), "error");
    }
  } catch (e) {
    mostrarLoader(false);
    mostrarToast("Error de conexión", "error");
  }
};

window.eliminarInvitadoSupervisor = async function (id) {
  const todos = (typeof window.obtenerListaConsolidadaInvitados === 'function')
    ? window.obtenerListaConsolidadaInvitados()
    : [];
  const item = todos.find(x => x.id === id);

  const descItem = item ? `"${item.invitado}" (${item.subtipo === 'ALMUERZO_EXTRA' ? 'Almuerzo Extra' : 'Refrigerio'} - ${item.fecha})` : 'esta solicitud';
  if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente a ${descItem}?\n\nEsta acción borrará el registro de la hoja ALMUERZOS_EXTRA y notificará al respectivo Sup. Admin.`)) return;

  mostrarLoader(true);
  try {
    let sessionData = {};
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
    const nombreEliminador = sessionData.nombre || 'Supervisor';

    // 1. Eliminar en Firestore y en Google Sheets ALMUERZOS_EXTRA
    const res = await jsonpRequest({
      accion: 'eliminarSolicitudInvitado',
      id: id,
      fecha: item?.fecha || '',
      nombre: item?.invitado || '',
      invitado: item?.invitado || '',
      supervisorId: item?.empleadoId || '',
      filaIndex: item?.filaIndex || ''
    });

    mostrarLoader(false);
    if (res && res.ok) {
      if (res.alertaSheets) {
        mostrarToast("Eliminado de Firestore. Pendiente actualizar Apps Script: " + (res.errorSheets || "Acción no reconocida"), "warning");
      } else {
        mostrarToast("Registro eliminado de ALMUERZOS_EXTRA y del sistema", "success");
      }

      // 2. Limpiar de las cachés en memoria
      window.solicitudesInvitados = (window.solicitudesInvitados || []).filter(x => x.id !== id);
      if (item) {
        window.almuerzosExtra = (window.almuerzosExtra || []).filter((ae, idx) => {
          if (item.filaIndex && ae.filaIndex === item.filaIndex) return false;
          const fNorm = normalizarFechaStr(ae.fecha);
          const nNorm = (ae.nombre || '').toLowerCase();
          const invNorm = (item.invitado || '').toLowerCase();
          if (fNorm === item.fecha && (nNorm.includes(invNorm) || invNorm.includes(nNorm))) return false;
          return true;
        });

        // 2.1 Limpiar caché persistente en localStorage
        try {
          const CACHE_KEY = 'tcontrol_almuerzos_extra_cache_v2';
          const stored = localStorage.getItem(CACHE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && Array.isArray(parsed.almuerzos)) {
              parsed.almuerzos = window.almuerzosExtra;
              localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
            }
          }
        } catch (eCache) { }
      }

      // 3. Notificar a Sup. Admin por WhatsApp
      if (window.OpenWAService && typeof window.OpenWAService.notificarSupAdminsCancelacionInvitado === 'function') {
        window.OpenWAService.notificarSupAdminsCancelacionInvitado({
          invitado: item?.invitado || 'Invitado',
          solicitante: item?.solicitante || 'Colaborador',
          subtipo: item?.subtipo || 'ALMUERZO_EXTRA',
          cantidad: item?.cantidad || 1,
          fecha: item?.fecha || '',
          eliminadoPor: nombreEliminador
        }).catch(eNotif => console.warn("Aviso notificando cancelación:", eNotif));
      }

      // 4. Actualizar tabla y notificaciones
      window.filtrarTablaInvitados();
      if (typeof window.actualizarNotificacionesSupAdminInvitados === 'function') {
        window.actualizarNotificacionesSupAdminInvitados();
      }
    } else {
      mostrarToast("Error eliminando registro: " + (res?.error || "Desconocido"), "error");
    }
  } catch (e) {
    mostrarLoader(false);
    mostrarToast("Error de conexión al eliminar", "error");
  }
};

window.copiarResumenCocinaInvitados = function () {
  const fechaFiltro = $('filtroFechaInvitados')?.value || (typeof hoyStr !== 'undefined' ? hoyStr : new Date().toISOString().slice(0, 10));
  const todos = window.obtenerListaConsolidadaInvitados().filter(i => i.fecha === fechaFiltro && i.estado !== 'CANCELADO');

  if (todos.length === 0) {
    mostrarToast("No hay pedidos activos para la fecha seleccionada (" + fechaFiltro + ")", "warning");
    return;
  }

  const almuerzos = todos.filter(i => i.subtipo === 'ALMUERZO_EXTRA');
  const sanduches = todos.filter(i => i.subtipo === 'REFRIGERIO_SANDUCHE');
  const galletas = todos.filter(i => i.subtipo === 'REFRIGERIO_GALLETAS');

  let txt = `*📋 RESUMEN DE PEDIDOS PARA INVITADOS - TCONTROL*\n`;
  txt += `*📅 Fecha:* ${fechaFiltro}\n\n`;

  if (almuerzos.length > 0) {
    const totA = almuerzos.reduce((a, b) => a + (parseInt(b.cantidad) || 0), 0);
    txt += `*🍱 ALMUERZOS EXTRA (Total: ${totA})*\n`;
    almuerzos.forEach(a => {
      txt += `• (${a.cantidad}x) ${a.invitado} - Solicitante: ${a.solicitante} (${a.area || 'Planta'})${a.observaciones ? ' [' + a.observaciones + ']' : ''}\n`;
    });
    txt += `\n`;
  }

  if (sanduches.length > 0) {
    const totS = sanduches.reduce((a, b) => a + (parseInt(b.cantidad) || 0), 0);
    txt += `*🥪 REFRIGERIOS - SÁNDUCHES (Total: ${totS})*\n`;
    sanduches.forEach(s => {
      txt += `• (${s.cantidad}x) ${s.invitado} - Solicitante: ${s.solicitante}${s.horaServicio ? ' [Hora: ' + s.horaServicio + ']' : ''}${s.observaciones ? ' [' + s.observaciones + ']' : ''}\n`;
    });
    txt += `\n`;
  }

  if (galletas.length > 0) {
    const totG = galletas.reduce((a, b) => a + (parseInt(b.cantidad) || 0), 0);
    txt += `*🍪 BREAKS CON GALLETAS TCONTROL (Total: ${totG})*\n`;
    galletas.forEach(g => {
      txt += `• (${g.cantidad}x) ${g.invitado} - Solicitante: ${g.solicitante}${g.horaServicio ? ' [Hora: ' + g.horaServicio + ']' : ''}${g.observaciones ? ' [' + g.observaciones + ']' : ''}\n`;
    });
    txt += `\n`;
  }

  const totalGen = todos.reduce((a, b) => a + (parseInt(b.cantidad) || 0), 0);
  txt += `*👥 TOTAL INVITADOS:* ${totalGen} personas\n`;
  txt += `_Generado desde el Sistema de Asistencia TCONTROL_`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      mostrarToast("¡Resumen de cocina copiado al portapapeles!", "success");
    }).catch(() => {
      window.prompt("Copia el resumen:", txt);
    });
  } else {
    window.prompt("Copia el resumen:", txt);
  }
};

window.exportarInvitadosExcel = async function () {
  const fechaFiltro = $('filtroFechaInvitados')?.value || '';
  const todos = window.obtenerListaConsolidadaInvitados();
  const datos = fechaFiltro ? todos.filter(i => i.fecha === fechaFiltro) : todos;

  if (datos.length === 0) {
    mostrarToast("No hay datos para exportar", "warning");
    return;
  }

  try {
    await window.asegurarXLSX();
    const rows = datos.map(item => ({
      'Fecha': item.fecha,
      'Hora Solicitud': item.hora,
      'Solicitante': item.solicitante,
      'Área Solicitante': item.area,
      'Tipo de Servicio': item.subtipo,
      'Cantidad': item.cantidad,
      'Invitado / Motivo': item.invitado,
      'Empresa': item.empresa,
      'Hora Servicio': item.horaServicio,
      'Observaciones': item.observaciones,
      'Estado': item.estado,
      'Origen Registro': item.origen
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invitados_Catering");
    const filename = `Pedidos_Invitados_${fechaFiltro || 'Todos'}.xlsx`;
    XLSX.writeFile(wb, filename);
    mostrarToast("Archivo Excel descargado exitosamente", "success");
  } catch (eXlsx) {
    console.warn("Fallo carga de XLSX, usando fallback CSV:", eXlsx);
    // Fallback CSV
    let csv = 'Fecha,Hora,Solicitante,Area,Tipo,Cantidad,Invitado,Empresa,HoraServicio,Observaciones,Estado\n';
    datos.forEach(d => {
      csv += `"${d.fecha}","${d.hora}","${d.solicitante}","${d.area}","${d.subtipo}","${d.cantidad}","${d.invitado}","${d.empresa}","${d.horaServicio}","${(d.observaciones || '').replaceAll('"', '""')}","${d.estado}"\n`;
    });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Pedidos_Invitados_${fechaFiltro || 'Todos'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    mostrarToast("Reporte descargado en CSV", "success");
  }
};

window.abrirModalSolicitudInvitadoSupervisor = function () {
  if (typeof abrirModalAlmuerzoExtra === 'function') {
    abrirModalAlmuerzoExtra();
  } else if (typeof mostrarModalExtraLunch === 'function') {
    mostrarModalExtraLunch();
  } else {
    const modal = $('extraLunchModal');
    if (modal) {
      const f = $('visitanteFecha');
      if (f) f.value = (typeof hoyStr !== 'undefined' ? hoyStr : new Date().toISOString().slice(0, 10));
      modal.classList.remove('hidden');
    }
  }
};

// ============================================================
// NOTIFICACIONES & ALERTAS SUP. ADMIN (INVITADOS & CATERING)
// ============================================================
window.actualizarNotificacionesSupAdminInvitados = function () {
  const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
  if (!sessionStr) return;
  let sessionData = {};
  try { sessionData = JSON.parse(sessionStr); } catch (e) { }
  const sup = empCache.find(x => String(x.id).trim() === String(sessionData.id).trim());
  const rol = getSupervisorRole(sessionData, sup);
  const esSupAdmin = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN');

  const banner = $('bannerAlertaSupAdminInvitados');
  const badgeNav = $('badgeInvitadosCount');

  if (!esSupAdmin) {
    if (banner) banner.style.display = 'none';
    return;
  }

  // Obtener lista consolidada de pedidos
  const todos = (typeof window.obtenerListaConsolidadaInvitados === 'function')
    ? window.obtenerListaConsolidadaInvitados()
    : [];

  // Filtrar solicitudes con estado SOLICITADO (o pendientes no canceladas/confirmadas)
  const pendientes = todos.filter(i => (i.estado === 'SOLICITADO' || !i.estado) && i.estado !== 'CANCELADO' && i.estado !== 'CONFIRMADO' && i.estado !== 'ENTREGADO');

  if (banner) {
    if (pendientes.length > 0) {
      banner.style.display = 'flex';
      const badgeCount = $('badgeSupAdminCountInvitados');
      if (badgeCount) badgeCount.textContent = `${pendientes.length} pendiente${pendientes.length > 1 ? 's' : ''}`;

      const texto = $('textoSupAdminAlertaInvitados');
      if (texto) {
        const primerReq = pendientes[0];
        const subtipoLabel = primerReq.subtipo === 'ALMUERZO_EXTRA' ? 'Almuerzo Extra' : (primerReq.subtipo === 'REFRIGERIO_SANDUCHE' ? 'Sánduche' : 'Break Galletas');
        const fechaLabel = primerReq.fecha || 'Hoy';
        texto.innerHTML = `Hay <strong>${pendientes.length} solicitud(es) de refrigerios / almuerzos para invitados</strong> pendientes de revisión. Más reciente: <em>${primerReq.solicitante} (${primerReq.cantidad}x ${subtipoLabel} para el ${fechaLabel})</em>.`;
      }
    } else {
      banner.style.display = 'none';
    }
  }

  const badgeSubtab = $('badgeSubtabInvitadosCount');

  if (badgeNav || badgeSubtab) {
    if (pendientes.length > 0) {
      if (badgeNav) {
        badgeNav.textContent = pendientes.length;
        badgeNav.style.display = 'inline-block';
        badgeNav.style.background = '#ea580c';
        badgeNav.title = `${pendientes.length} solicitudes de invitados pendientes de revisión`;
      }
      if (badgeSubtab) {
        badgeSubtab.textContent = pendientes.length;
        badgeSubtab.style.display = 'inline-block';
        badgeSubtab.style.background = '#ea580c';
      }
    } else {
      const hoyStrLocal = normalizarFechaStr(new Date().toISOString().slice(0, 10));
      const pedidosHoy = todos.filter(i => i.fecha === hoyStrLocal && i.estado !== 'CANCELADO');
      if (pedidosHoy.length > 0) {
        if (badgeNav) {
          badgeNav.textContent = pedidosHoy.length;
          badgeNav.style.display = 'inline-block';
          badgeNav.style.background = '#2563eb';
          badgeNav.title = `${pedidosHoy.length} pedidos para hoy`;
        }
        if (badgeSubtab) {
          badgeSubtab.textContent = pedidosHoy.length;
          badgeSubtab.style.display = 'inline-block';
          badgeSubtab.style.background = '#2563eb';
        }
      } else {
        if (badgeNav) badgeNav.style.display = 'none';
        if (badgeSubtab) badgeSubtab.style.display = 'none';
      }
    }
  }
};

window.notificarManualSupAdminsWhatsApp = async function () {
  if (!window.OpenWAService || typeof window.OpenWAService.notificarSupAdminsRecordatorioPendientes !== 'function') {
    mostrarToast("Servicio OpenWA no disponible", "warning");
    return;
  }

  const todos = (typeof window.obtenerListaConsolidadaInvitados === 'function')
    ? window.obtenerListaConsolidadaInvitados()
    : [];

  const pendientes = todos.filter(i => (i.estado === 'SOLICITADO' || !i.estado) && i.estado !== 'CANCELADO' && i.estado !== 'CONFIRMADO' && i.estado !== 'ENTREGADO');

  if (pendientes.length === 0) {
    const confirmarHoy = confirm("No hay solicitudes con estado 'SOLICITADO'. ¿Deseas enviar un recordatorio a los Sup. Admin con los pedidos activos del día de hoy?");
    if (!confirmarHoy) return;
    const hoyStrLocal = normalizarFechaStr(new Date().toISOString().slice(0, 10));
    const deHoy = todos.filter(i => i.fecha === hoyStrLocal && i.estado !== 'CANCELADO');
    if (deHoy.length === 0) {
      mostrarToast("No hay pedidos registrados para el día de hoy.", "info");
      return;
    }
    mostrarLoader(true);
    try {
      const resultado = await window.OpenWAService.notificarSupAdminsRecordatorioPendientes(deHoy);
      mostrarLoader(false);
      if (resultado && resultado.enviados > 0) {
        mostrarToast(`Recordatorio WhatsApp enviado a ${resultado.enviados} Sup. Admin`, "success");
      } else {
        mostrarToast("No se pudo completar el envío de WhatsApp", "warning");
      }
    } catch (e) {
      mostrarLoader(false);
      mostrarToast("Error enviando notificación: " + e.message, "error");
    }
    return;
  }

  mostrarLoader(true);
  try {
    mostrarToast("Enviando recordatorio WhatsApp a los Sup. Admin...", "info");
    const resultado = await window.OpenWAService.notificarSupAdminsRecordatorioPendientes(pendientes);
    mostrarLoader(false);
    if (resultado && resultado.enviados > 0) {
      mostrarToast(`¡Notificación enviada a ${resultado.enviados} Sup. Admin por WhatsApp!`, "success");
    } else {
      mostrarToast("No se pudo completar el envío de WhatsApp", "warning");
    }
  } catch (e) {
    mostrarLoader(false);
    mostrarToast("Error enviando notificación: " + e.message, "error");
  }
};
