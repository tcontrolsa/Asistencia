/**
 * Asistencia Tcontrol - Modulo Control de Emergencias y Simulacros
 * Extraido en Fase 5 de Modularizacion
 * Fecha: 2026-09-23
 */

// ============================================================
// ponytail: CONTROL DE EMERGENCIAS Y SIMULACROS EN SUPERVISOR
// ============================================================
window.cargarEmergenciasSupervisor = async function (silencioso = false) {
  if (!silencioso) {
    await cargarDatosCompletos(true, false);
  }

  const em = window.emergencia || { activa: false, nombre: '' };
  const statusDiv = $('statusEmergenciaDetalle');
  if (statusDiv) {
    statusDiv.innerHTML = `
          <div style="padding: 12px; border-radius: 8px; background: ${em.activa ? '#fef2f2' : '#f0fdf4'}; border: 1px solid ${em.activa ? '#fca5a5' : '#bbf7d0'}; color: ${em.activa ? '#991b1b' : '#166534'}; font-weight: bold; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <span style="font-size: 15px;">📢 Estado del Evento: <strong>${em.activa ? 'ACTIVO' : 'INACTIVO'}</strong></span>
              ${em.activa ? `<br><span style="font-size: 12.5px; font-weight: normal; color: #7f1d1d; margin-top: 4px; display: inline-block;">Nombre del Evento: <strong>${em.nombre}</strong> (Iniciado el ${em.fecha || 'hoy'})</span>` : ''}
            </div>
            <div>
              <i class="fas ${em.activa ? 'fa-bell fa-beat' : 'fa-shield-alt'}" style="font-size: 20px;"></i>
            </div>
          </div>
        `;
  }

  // Update control panel inputs and buttons
  const supInput = $('supEmEventName');
  if (supInput) {
    supInput.value = em.nombre || '';
  }
  const btnStart = $('btnSupEmStart');
  const btnStop = $('btnSupEmStop');
  if (btnStart) btnStart.style.display = em.activa ? 'none' : 'flex';
  if (btnStop) btnStop.style.display = em.activa ? 'flex' : 'none';

  // Group employees by emergency status
  let aSalvoCount = 0;
  let requiereAyudaCount = 0;
  let pendientesCount = 0;

  const hoyStr = getLocalHoyStr(new Date());
  const reportesHTML = [];

  empCache.forEach(emp => {
    // Find if this employee registered their status today within their ENTRADA record
    const regEntrada = (emp.registros || []).find(r => r.tipo === 'ENTRADA' && r.fecha === hoyStr);
    const hasEstado = regEntrada && regEntrada.estado;

    let statusText = "⚪ PENDIENTE";
    let statusBadgeColor = "#64748b";
    let statusBgColor = "#f1f5f9";
    let detalle = "-";
    let horaReporte = "-";

    if (hasEstado) {
      const val = regEntrada.estado || "";
      if (val.startsWith("A salvo")) {
        aSalvoCount++;
        statusText = "🟢 A SALVO / OK";
        statusBadgeColor = "#0f766e";
        statusBgColor = "#ccfbf1";
      } else if (val.startsWith("Requiere ayuda")) {
        requiereAyudaCount++;
        statusText = "🔴 REQUIERE AYUDA";
        statusBadgeColor = "#b91c1c";
        statusBgColor = "#fee2e2";
      } else {
        // General or other status
        aSalvoCount++;
        statusText = "🟢 REGISTRADO";
        statusBadgeColor = "#0f766e";
        statusBgColor = "#ccfbf1";
      }

      // Split comments if any
      const dashIdx = val.indexOf(" - ");
      detalle = dashIdx !== -1 ? val.substring(dashIdx + 3) : "Sin comentarios";
      // Hora de reporte independiente de la hora de entrada
      // Prioridad: estado_timestamp (Firebase ms) > estado_hora (Sheets "HH:MM") > "-"
      if (regEntrada.estado_timestamp) {
        // Soporta: número ms (Date.now() int64), o Firestore Timestamp {seconds, toMillis}
        let ms = regEntrada.estado_timestamp;
        if (typeof ms === 'object') {
          ms = typeof ms.toMillis === 'function' ? ms.toMillis() : (ms.seconds || 0) * 1000;
        }
        const d = new Date(ms);
        if (!isNaN(d)) {
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          horaReporte = `${hh}:${mm}`;
        }
      } else if (regEntrada.estado_hora) {
        horaReporte = regEntrada.estado_hora; // viene del GAS como "HH:MM"
      } else {
        horaReporte = "-";
      }
    } else {
      pendientesCount++;
    }

    reportesHTML.push(`
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; font-size: 13px; font-weight: 600; color: #1e293b;">${emp.nombre || 'Sin nombre'}</td>
            <td style="padding: 12px; font-size: 13px; color: #475569;">${emp.departamento || emp.cargo || 'Área general'}</td>
            <td style="padding: 12px;">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; color: ${statusBadgeColor}; background: ${statusBgColor}; text-align: center;">
                ${statusText}
              </span>
            </td>
            <td style="padding: 12px; font-size: 13px; color: #334155; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${detalle}">
              ${detalle}
            </td>
            <td style="padding: 12px; font-size: 13px; color: #64748b;">${horaReporte}</td>
          </tr>
        `);
  });

  // Update counters
  const elSalvo = $('numASalvo');
  const elAyuda = $('numRequiereAyuda');
  const elPend = $('numPendientes');
  if (elSalvo) elSalvo.textContent = aSalvoCount;
  if (elAyuda) elAyuda.textContent = requiereAyudaCount;
  if (elPend) elPend.textContent = pendientesCount;

  // Update table body
  const tbody = $('listaReportesEmergenciaBody');
  if (tbody) {
    tbody.innerHTML = reportesHTML.length > 0 ? reportesHTML.join('') : `
          <tr>
            <td colspan="5" style="text-align: center; padding: 20px; color: #64748b;">No hay personal activo registrado para mostrar.</td>
          </tr>
        `;
  }
};

window.toggleEmergenciaSupervisor = async function (activa) {
  const inputEl = $('supEmEventName');
  const nombre = inputEl ? inputEl.value.trim() : '';
  if (activa && !nombre) {
    mostrarToast('Por favor ingrese el nombre del evento/simulacro.', 'warning');
    return;
  }

  // Pre-verificación: ¿está el backend disponible?
  if (window.USE_FIREBASE && !window.FirebaseBackend) {
    mostrarToast('Error: El motor Firebase no está cargado. Recarga la página.', 'error');
    return;
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'toggleEmergencia',
      activa: activa,
      nombre: nombre,
      empleadoId: (() => {
        try { return JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').id || ''; }
        catch (e) { return ''; }
      })()
    });

    mostrarLoader(false);
    if (res.ok) {
      mostrarToast(activa ? '🚨 Alerta de emergencia iniciada' : '🟢 Alerta de emergencia finalizada', 'success');

      if (!window.emergencia) window.emergencia = {};
      window.emergencia.activa = activa;
      window.emergencia.nombre = activa ? nombre : '';

      await cargarEmergenciasSupervisor();
    } else {
      mostrarToast(res.error || 'Error al actualizar la alerta', 'error');
    }
  } catch (e) {
    mostrarLoader(false);
    console.error('toggleEmergenciaSupervisor error:', e);
    mostrarToast('Error: ' + (e.message || 'No se pudo conectar con el servidor'), 'error');
  }
};

// ponytail: Supervisor Multi-date Trabajo en Campo modal, auto-load & overwrite confirmation
let _supDiasCampoState = [];

window.mostrarModalCampoSupervisor = async function (empId = null) {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (!modal) return;

  const selEmp = document.getElementById('supCampoEmpSelect');
  if (selEmp && empCache.length > 0) {
    selEmp.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${e.id})</option>`).join('');
  }

  let targetId = empId;
  if (!targetId && empCache.length > 0) {
    targetId = empCache[0].id;
  }
  if (selEmp && targetId) {
    selEmp.value = targetId;
  }

  const emp = empCache.find(e => e.id === targetId);
  const empNombre = emp ? emp.nombre : (targetId || '');

  document.getElementById('supCampoEmpId').value = targetId || '';
  document.getElementById('supCampoEmpNombreDisplay').value = `${targetId || ''} - ${empNombre}`;
  document.getElementById('supCampoProyectoInput').value = '';

  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  document.getElementById('supCampoFechaInicioInput').value = hoyStr;
  document.getElementById('supCampoFechaFinInput').value = hoyStr;
  document.getElementById('supCampoObservacionesInput').value = '';

  await cargarIngenierosAutorizadoresSupervisor();
  await generarListaDiasCampoSupervisor();
  modal.classList.remove('hidden');
};

window.alCambiarEmpCampoModal = function (newEmpId) {
  const emp = empCache.find(e => e.id === newEmpId);
  document.getElementById('supCampoEmpId').value = newEmpId;
  document.getElementById('supCampoEmpNombreDisplay').value = `${newEmpId} - ${emp ? emp.nombre : newEmpId}`;
  generarListaDiasCampoSupervisor();
};

window.abrirModalCampoSupervisor = function (empId) {
  window.mostrarModalCampoSupervisor(empId);
};

window.cerrarModalCampoSupervisor = function () {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (modal) modal.classList.add('hidden');
};

window.generarListaDiasCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const fIniStr = document.getElementById('supCampoFechaInicioInput')?.value;
  const fFinStr = document.getElementById('supCampoFechaFinInput')?.value;
  const container = document.getElementById('supListaDiasCampoContainer');
  const cntSpan = document.getElementById('supCntDiasCampo');

  if (!container || !fIniStr || !fFinStr) return;

  function parseFechaLocalStr(fStr) {
    if (!fStr) return null;
    const parts = fStr.split('-');
    if (parts.length < 3) return null;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const dIni = parseFechaLocalStr(fIniStr);
  const dFin = parseFechaLocalStr(fFinStr);

  if (!dIni || !dFin || dFin < dIni) {
    container.innerHTML = `<div style="background:#fef3c7; border:1px solid #fde68a; padding:8px 12px; border-radius:6px; font-size:12px; color:#b45309;">Selecciona un rango de fechas válido.</div>`;
    return;
  }

  // Buscar únicamente registros existentes de TRABAJO EN CAMPO (por modo, tipo o razón)
  function esRegistroCampoSup(r) {
    if (!r) return false;
    const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
    const m = String(r.modo || '').toUpperCase();
    const raz = String(r.razon_ausencia || r.razon || r.observaciones || '').toUpperCase();
    return (
      m === 'CAMPO' ||
      t.includes('CAMPO') ||
      t === 'TRABAJO_DE_CAMPO' ||
      t === 'SALIDA_A_CAMPO' ||
      raz.includes('CAMPO') ||
      raz.includes('TRABAJO_DE_CAMPO') ||
      raz.includes('TRABAJO EN CAMPO')
    );
  }

  let regsExistentes = [];
  const empObj = (empCache || []).find(e => e.id === empId);
  if (empObj && Array.isArray(empObj.registros)) {
    empObj.registros.forEach(r => {
      if (esRegistroCampoSup(r)) regsExistentes.push(r);
    });
  }

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (empId && firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('registros').where('empleadoId', '==', empId).get();
      snap.forEach(doc => {
        const d = doc.data();
        if (esRegistroCampoSup(d)) {
          if (!regsExistentes.some(x => x.id === doc.id || (x.fecha === d.fecha && x.tipo === d.tipo))) {
            regsExistentes.push({ id: doc.id, ...d });
          }
        }
      });
    } catch (e) { }
  }

  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const fechas = [];
  let curr = new Date(dIni);

  while (curr <= dFin) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const fStr = `${y}-${m}-${d}`;
    const diaNombre = diasSemana[curr.getDay()];

    const regsFecha = regsExistentes.filter(r => r.fecha === fStr && esRegistroCampoSup(r));
    const regEntrada = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'ENTRADA_CAMPO' || t === 'RETORNO_CAMPO' || (t.includes('ENTRADA') && t.includes('CAMPO')) || t === 'ENTRADA';
    });
    const regSalida = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'SALIDA_CAMPO' || (t.includes('SALIDA') && t.includes('CAMPO')) || t === 'SALIDA';
    });

    const hoyObj = new Date();
    const hoyStr = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;

    const yaExiste = regsFecha.length > 0;
    const hEntrada = regEntrada && regEntrada.hora ? regEntrada.hora.substring(0, 5) : '';
    const hSalida = regSalida && regSalida.hora ? regSalida.hora.substring(0, 5) : '';

    fechas.push({
      fecha: fStr,
      diaNombre: diaNombre,
      isFestivo: (typeof esFeriado === 'function' && esFeriado(fStr)) || curr.getDay() === 0 || curr.getDay() === 6,
      hE: hEntrada,
      hS: hSalida,
      yaExiste: yaExiste,
      docEntradaId: regEntrada ? regEntrada.id : null,
      docSalidaId: regSalida ? regSalida.id : null
    });

    curr.setDate(curr.getDate() + 1);
  }

  // Auto-cargar Proyecto, Observaciones y Autorizado Por si existe algún registro de CAMPO previo en el rango
  const regConInfo = regsExistentes.find(r => {
    if (!r.fecha) return false;
    return r.fecha >= fIniStr && r.fecha <= fFinStr && (r.observaciones || r.razon_ausencia || r.autoriza);
  });

  if (regConInfo) {
    const proyInput = document.getElementById('supCampoProyectoInput');
    const obsInput = document.getElementById('supCampoObservacionesInput');
    const autSelect = document.getElementById('supCampoAutorizadoPorSelect');

    const rawObs = String(regConInfo.observaciones || regConInfo.razon_ausencia || '').trim();
    let projFound = '';
    let obsFound = '';

    const match = rawObs.match(/\[Proyecto:\s*([^\]]+)\]/i);
    if (match) {
      projFound = match[1].trim();
      obsFound = rawObs.replace(match[0], '').trim();
    } else {
      obsFound = rawObs;
    }

    if (proyInput && projFound) proyInput.value = projFound;
    if (obsInput && obsFound && obsFound.toUpperCase() !== 'TRABAJO EN CAMPO') obsInput.value = obsFound;
    if (autSelect && regConInfo.autoriza) {
      autSelect.value = regConInfo.autoriza;
    }
  }

  _supDiasCampoState = fechas;
  if (cntSpan) cntSpan.textContent = `${fechas.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

function calcularTotalesDiaCampo(fechaVal, hEStr, hSStr) {
  if (!hEStr || !hSStr) return { t50: '0h 0m', t100: '0h 0m' };
  function toMins(hStr) {
    const parts = hStr.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  const mE = toMins(hEStr);
  let mS = toMins(hSStr);
  if (mE === null || mS === null) return { t50: '0h 0m', t100: '0h 0m' };
  if (mS < mE) {
    mS += 24 * 60;
  }
  if (mS <= mE) return { t50: '0h 0m', t100: '0h 0m' };

  const minutosBrutos = mS - mE;
  const minutosNetos = Math.max(0, minutosBrutos - 30);

  const parts = fechaVal.split('-');
  const dObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
  const esFestivo = (typeof esFeriado === 'function' && esFeriado(fechaVal)) || dObj.getDay() === 0 || dObj.getDay() === 6;

  let t50 = 0, t100 = 0;
  if (esFestivo) {
    t100 = minutosNetos;
  } else {
    const antes = Math.max(0, 450 - mE);
    const despues = Math.max(0, mS - 975);
    t50 = antes + despues;
  }

  function fmt(m) {
    return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  }
  return { t50: fmt(t50), t100: fmt(t100) };
}
window.calcularTotalesDiaCampo = calcularTotalesDiaCampo;

window.renderListaDiasCampoSupervisorHTML = function () {
  const container = document.getElementById('supListaDiasCampoContainer');
  if (!container) return;

  if (_supDiasCampoState.length === 0) {
    container.innerHTML = `<div style="background:#f1f5f9; padding:8px; border-radius:6px; font-size:12px; text-align:center; color:#64748b;">No hay fechas seleccionadas en el rango.</div>`;
    return;
  }

  container.innerHTML = _supDiasCampoState.map((item, idx) => {
    const totales = calcularTotalesDiaCampo(item.fecha, item.hE, item.hS);
    const bgStyle = item.yaExiste ? '#fff7ed' : '#ffffff';
    const borderStyle = item.yaExiste ? '#fdba74' : '#e2e8f0';

    return `
        <div style="background: ${bgStyle}; border: 1px solid ${borderStyle}; padding: 10px; border-radius: 8px; margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <span style="font-weight:700; font-size:12.5px; color:#1e293b;">${item.fecha} (${item.diaNombre})</span>
              ${item.isFestivo ? '<span style="background:#fef3c7; color:#b45309; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">Festivo / Finde</span>' : ''}
              ${item.yaExiste ? '<span style="background:#ffedd5; color:#c2410c; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">⚠️ Registro existente (Se actualizará)</span>' : ''}
            </div>
            ${_supDiasCampoState.length > 1 ? `<button type="button" onclick="eliminarDiaCampoSupervisor(${idx})" style="background:none; border:none; color:#ef4444; font-weight:700; cursor:pointer; font-size:16px; padding:0 4px;" title="Quitar fecha">&times;</button>` : ''}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">ENTRADA</label>
              <input type="time" class="form-input" value="${item.hE}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">SALIDA</label>
              <input type="time" class="form-input" value="${item.hS}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b45309; display:block;">50%</small>
              <span style="font-weight:800; font-size:12px; color:#d97706;">${totales.t50}</span>
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b91c1c; display:block;">100%</small>
              <span style="font-weight:800; font-size:12px; color:#dc2626;">${totales.t100}</span>
            </div>
          </div>
        </div>
        `;
  }).join('');
};

window.actualizarHorarioDiaCampoSupervisor = function (idx, prop, val) {
  if (_supDiasCampoState[idx]) {
    _supDiasCampoState[idx][prop] = val;
    renderListaDiasCampoSupervisorHTML();
  }
};

window.eliminarDiaCampoSupervisor = function (idx) {
  _supDiasCampoState.splice(idx, 1);
  const cntSpan = document.getElementById('supCntDiasCampo');
  if (cntSpan) cntSpan.textContent = `${_supDiasCampoState.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

window.cargarIngenierosAutorizadoresSupervisor = async function () {
  const select = document.getElementById('supCampoAutorizadoPorSelect');
  if (!select) return;

  select.innerHTML = '<option value="">-- Cargando Autorizadores (Ingeniería)... --</option>';
  let ingenieros = [];

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('empleados').get();
      snap.forEach(doc => {
        const d = doc.data();
        const areaStr = String(d.area || d.cargo || '').toUpperCase().trim();
        const normStr = areaStr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const esActivo = d.activo === 'SI' || d.activo === true || d.activo !== 'NO';
        const esIngenieria = normStr.includes('INGENIERIA') || normStr.includes('INGENIERO') || normStr.includes('ING');

        if (esActivo && esIngenieria) {
          ingenieros.push({ id: doc.id, nombre: d.nombre, area: d.area || d.cargo || 'INGENIERIA' });
        }
      });
    } catch (e) { }
  }

  const unicosMap = new Map();
  ingenieros.forEach(item => {
    if (item.nombre && !unicosMap.has(item.nombre)) {
      unicosMap.set(item.nombre, item);
    }
  });
  const listaFinal = Array.from(unicosMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (listaFinal.length > 0) {
    select.innerHTML = '<option value="">-- Seleccionar Autorizador (Ingeniería) [Opcional] --</option>' +
      listaFinal.map(i => `<option value="${i.nombre}">${i.nombre} (${i.area || 'INGENIERIA'})</option>`).join('');
  } else {
    select.innerHTML = '<option value="">-- Sin personal del área de Ingeniería encontrado --</option>';
  }
};

window.guardarTrabajoEnCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const proyecto = document.getElementById('supCampoProyectoInput')?.value.trim();
  const obs = document.getElementById('supCampoObservacionesInput')?.value.trim();
  const autoriza = document.getElementById('supCampoAutorizadoPorSelect')?.value || '';

  if (!empId) { mostrarToast('ID de empleado no especificado', 'error'); return; }
  if (!_supDiasCampoState || _supDiasCampoState.length === 0) { mostrarToast('No hay fechas seleccionadas en el rango.', 'error'); return; }

  const diasExistentes = _supDiasCampoState.filter(d => d.yaExiste);
  if (diasExistentes.length > 0) {
    const listaFechas = diasExistentes.map(d => `${d.fecha} (${d.diaNombre})`).join('\n• ');
    const confirmar = confirm(`⚠️ ATENCIÓN:\nYa existe(n) registro(s) previo(s) para la(s) fecha(s):\n• ${listaFechas}\n\n¿Deseas SOBREESCRIBIR / ACTUALIZAR estos registros?`);
    if (!confirmar) return;
  }

  const emp = empCache.find(e => e.id === empId);
  const empNombre = emp ? emp.nombre : empId;

  let obsFinal = 'Trabajo en Campo';
  if (proyecto && obs) {
    obsFinal = `[Proyecto: ${proyecto}] ${obs}`;
  } else if (proyecto) {
    obsFinal = `[Proyecto: ${proyecto}] Trabajo en Campo`;
  } else if (obs) {
    obsFinal = obs;
  }

  const btn = document.getElementById('btnGuardarCampoSup');
  if (btn) btn.disabled = true;

  try {
    const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
    if (!firestoreDb || typeof firestoreDb.collection !== 'function') {
      mostrarToast('Base de datos Firebase no disponible', 'error');
      if (btn) btn.disabled = false;
      return;
    }

    let guardadosCount = 0;
    for (const item of _supDiasCampoState) {
      const hE = item.hE ? (item.hE.length === 5 ? item.hE + ':00' : item.hE) : '';
      const hS = item.hS ? (item.hS.length === 5 ? item.hS + ':00' : item.hS) : '';

      if (hE) {
        const hEClean = hE.replace(/:/g, '');
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_${hEClean}`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hE}`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hE,
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      if (hS) {
        const hSClean = hS.replace(/:/g, '');
        const targetSalidaId = item.docSalidaId || `${empId}_SALIDA_CAMPO_${item.fecha}_${hSClean}`;
        const tsSalida = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hS}`));

        const dataSalida = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hS,
          tipo: 'SALIDA_CAMPO',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsSalida,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetSalidaId).set(dataSalida, { merge: true });
      }

      if (!hE && !hS) {
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_080000`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T08:00:00`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: '',
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      guardadosCount++;
    }

    mostrarToast(`✅ Trabajo en Campo guardado/actualizado para ${guardadosCount} día(s)`, 'success');
    cerrarModalCampoSupervisor();

    if (typeof window.cargarResumenGeneral === 'function') {
      window.cargarResumenGeneral();
    }
  } catch (e) {
    mostrarToast('Error al guardar Trabajo en Campo: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};
