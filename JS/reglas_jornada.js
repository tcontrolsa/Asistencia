/**
 * TCONTROL · Reglas de jornada y bolsa de 4 horas (compartido por el panel y la app) · 2026-11-11
 *
 * Copia fiel del cálculo que hacía el detalle del colaborador en el panel (supervisor_core.js →
 * mostrarDetalle): armado de los días del período y consumo cronológico de la bolsa de 4 h (240 min)
 * por período 26–25. El panel y la app (aviso de permisos personales, JS/permisos.js) usan esta misma
 * función para que los números coincidan siempre. Cualquier cambio de reglas va AQUÍ.
 *
 * Datos que necesita (los mismos que el panel):
 *   - registros del colaborador (Firestore + historial archivado: FirebaseBackend.obtenerRegistros con incluirArchivados)
 *   - días de vacaciones (obtenerVacacionesEmpleado → vacaciones)
 *   - ajustes de descanso por día (window._ajustesDescanso, FirebaseBackend.cargarAjustesDescanso)
 *   - la ficha (fecha de ingreso, fecha de nacimiento, cargo/área para pasantes)
 *
 * Uso: const porDia = ReglasJornada.armarPorDia({ regs, vacaciones, R_INI, R_FIN, empleado, verificandoHistorial, hoy });
 *      const { porDia: mapa, saldo } = ReglasJornada.calcularBolsa({ empleado, porDia, hoy });
 *      ReglasJornada.saldoBolsaPeriodo({ empleado, registros, vacaciones, hoy }) → { saldo, usado, periodo, mapa }
 */
(function () {
  'use strict';

  const HORA_ENTRADA_REF = 450;           // 07:30
  const TOLERANCIA_ENTRADA_MIN = 5;       // hasta 07:35 no es atraso ni faltante
  const HORA_SALIDA_REF = 975;            // 16:15
  const BOLSA_MIN = 240;                  // 4 horas por período
  const PENALIZACION_SIN_SALIDA_MIN = 15;
  const ALMUERZO_MIN = 45;
  const ALMUERZO_FIN_SEMANA_MIN = 30;
  const DESCANSOS_DESDE = '2026-09-26';
  const DESCANSOS_LV = [{ id: 'receso', inicio: 600, min: 15 }, { id: 'almuerzo', inicio: 750, min: 30 }];
  const FERIADOS_MD = ['1/1', '2/16', '2/17', '4/3', '4/30', '5/1', '5/25', '8/10', '10/9', '11/2', '11/3', '12/6', '12/25'];

  const hoyLocal = () => {
    if (typeof window.getLocalHoyStr === 'function') return window.getLocalHoyStr();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function obtenerMinutos(valor) {
    if (!valor) return null;
    if (typeof valor === 'object') {
      if (typeof valor.toDate === 'function') {
        let d = valor.toDate();
        return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
      }
      if (typeof valor.seconds === 'number') {
        let d = new Date(valor.seconds * 1000);
        return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
      }
      if (typeof valor._seconds === 'number') {
        let d = new Date(valor._seconds * 1000);
        return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
      }
      if (valor instanceof Date) return !isNaN(valor.getTime()) ? valor.getHours() * 60 + valor.getMinutes() : null;
    }
    if (typeof valor === 'number') {
      if (valor > 0 && valor < 1) {
        let s = Math.round(valor * 86400);
        return Math.floor(s / 3600) * 60 + Math.floor((s % 3600) / 60);
      }
      if (valor > 1e11) {
        let d = new Date(valor);
        if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
      }
      return null;
    }
    if (typeof valor === 'string') {
      let s = valor.trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}T/i.test(s) || s.includes('GMT') || s.includes('Z')) {
        let d = new Date(s);
        if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
      }
      const ampmMatch = s.match(/(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)/i);
      const m12 = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m12) {
        let h = parseInt(m12[1], 10);
        let m = parseInt(m12[2], 10);
        if (ampmMatch) {
          const isPm = /p/i.test(ampmMatch[1]);
          const isAm = /a/i.test(ampmMatch[1]);
          if (isPm && h < 12) h += 12;
          if (isAm && h === 12) h = 0;
        }
        return h * 60 + m;
      }
      let d = new Date(s);
      if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    }
    return null;
  }

  function normalizarFechaStr(val) {
    if (!val || val === 'undefined') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
    }
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const mYMD = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (mYMD) return `${mYMD[1]}-${mYMD[2].padStart(2, '0')}-${mYMD[3].padStart(2, '0')}`;
    const m1 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s;
  }

  function esFeriadoODomingo(fechaStr) {
    if (!fechaStr) return false;
    if (fechaStr === '2026-06-26') return true; // Feriado imprevisto 26/06/2026
    const fecha = new Date(fechaStr + 'T12:00:00');
    if (fecha.getDay() === 0) return true;
    return FERIADOS_MD.includes(`${fecha.getMonth() + 1}/${fecha.getDate()}`);
  }

  function obtenerDiasHabiles(inicio, fin) {
    const dias = [];
    const fecha = new Date(inicio + 'T12:00:00');
    const fFin = new Date(fin + 'T12:00:00');
    while (fecha <= fFin) {
      const fStr = fecha.toISOString().split('T')[0];
      const dia = fecha.getDay();
      if (dia >= 1 && dia <= 5 && !esFeriadoODomingo(fStr)) dias.push(fStr);
      fecha.setDate(fecha.getDate() + 1);
    }
    return dias;
  }

  // Período de nómina 26–25 que contiene la fecha
  function periodoDe(fecha) {
    const d = new Date((fecha || hoyLocal()) + 'T12:00:00');
    const base = d.getMonth() + (d.getDate() >= 26 ? 0 : -1);
    const f = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { inicio: f(new Date(d.getFullYear(), base, 26)), fin: f(new Date(d.getFullYear(), base + 1, 25)) };
  }

  function esEmpleadoPasante(e) {
    if (!e) return false;
    const cargo = String(e.cargo || e.tipo_cargo || e.rol || '').toUpperCase().trim();
    const area = String(e.area || e.departamento || '').toUpperCase().trim();
    const tipo = String(e.tipo || e.tipoRegistro || e.tipo_empleado || '').toUpperCase().trim();
    return ['PASANTE', 'PASANTIA', 'PASANTÍA'].some(p => cargo.includes(p) || area.includes(p) || tipo.includes(p));
  }

  function obtenerFechaInicioEfectivaEmpleado(e, rangoIniFallback) {
    if (!e) return rangoIniFallback;
    const fIngRaw = e.fecha_ingreso || e.fechaIngreso || e.fecha_inicio || e.fechaInicio;
    if (fIngRaw && String(fIngRaw).trim().length >= 10) {
      const fi = normalizarFechaStr(fIngRaw);
      if (fi && /^\d{4}-\d{2}-\d{2}$/.test(fi) && fi >= '2020-01-01') return fi;
    }
    const rawCreado = e.creado || e.createTime || e.fechaRegistro || e.fecha_creacion || e.fecha_registro || e.fechaCreacion || e.createdAt;
    if (rawCreado && String(rawCreado).trim().length >= 10) {
      const fc = normalizarFechaStr(rawCreado);
      if (fc && /^\d{4}-\d{2}-\d{2}$/.test(fc) && fc >= '2020-01-01') return fc;
    }
    const regs = Array.isArray(e.registros) ? e.registros : [];
    if (regs.length > 0) {
      const fechasReg = regs.map(r => normalizarFechaStr(r.fecha)).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f >= '2020-01-01').sort();
      if (fechasReg.length > 0) return fechasReg[0];
    }
    return hoyLocal();
  }

  // ---------------------------------------------------------------- descansos
  function ajusteDescansoDia(empId, fecha) {
    const a = (window._ajustesDescanso || {})[`${String(empId || '').trim()}_${fecha}`];
    return a ? String(a.d || '').toUpperCase() : '';
  }
  function almorzoEnPlanta(items) {
    const si = r => !!r && ['SI', 'PLANTA', 'EXTRA'].includes(String(r.almuerzo || '').trim().toUpperCase());
    return (items || []).some(x => si(x) || (!!x && (si(x.entrada) || si(x.salida))));
  }
  function almuerzoFinSemana(fecha, items, trabajado) {
    if (!fecha || fecha < DESCANSOS_DESDE) return trabajado > 240 ? ALMUERZO_MIN : 0;
    return almorzoEnPlanta(items) ? ALMUERZO_FIN_SEMANA_MIN : 0;
  }
  function descansoDia(fecha, periodosDia, empId, esFestivo, ajuste, tope) {
    if (!fecha || fecha < DESCANSOS_DESDE) return null;
    if (esFestivo) return almuerzoFinSemana(fecha, periodosDia, 0);
    const aj = ajuste !== undefined && ajuste !== null ? String(ajuste).toUpperCase() : ajusteDescansoDia(empId, fecha);
    if (aj === 'NO') return 0;
    if (aj === 'SI') return ALMUERZO_MIN;
    const tramos = [];
    let ultS = null, pausaAlmuerzo = false;
    (periodosDia || []).forEach(p => {
      if (!p || !p.entrada || !p.salida) return;
      const mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      const mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;
      if (ultS !== null && ultS >= 690 && ultS <= 870 && mE - ultS >= 30) pausaAlmuerzo = true;
      ultS = mS;
      tramos.push([mE, mS]);
    });
    const nuevo = DESCANSOS_LV.reduce((t, d) => {
      if (d.id === 'almuerzo' && pausaAlmuerzo) return t;
      return tramos.some(([a, b]) => a <= d.inicio && d.inicio < b) ? t + d.min : t;
    }, 0);
    return typeof tope === 'number' ? Math.min(nuevo, tope) : nuevo;
  }

  function calcularNetWorkedOrdinario(periodosDia, esFestivo, fecha, empId) {
    if (esFestivo) return 0;
    let ordBruto = 0, hasLunchGap = false, ultimoSalidaMins = null;
    if (Array.isArray(periodosDia)) {
      let primerTramo = true;
      periodosDia.forEach(p => {
        if (!p || !p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;
        if (primerTramo && mE > HORA_ENTRADA_REF && mE <= HORA_ENTRADA_REF + TOLERANCIA_ENTRADA_MIN) mE = HORA_ENTRADA_REF;
        primerTramo = false;
        if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
          if (!hasLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870 && mE - ultimoSalidaMins >= 30) hasLunchGap = true;
        }
        ultimoSalidaMins = mS;
        const ordE = Math.max(HORA_ENTRADA_REF, mE), ordS = Math.min(HORA_SALIDA_REF, mS);
        if (ordS > ordE) ordBruto += (ordS - ordE);
      });
    }
    let ordNeto = ordBruto;
    const dsc = descansoDia(fecha, periodosDia, empId, esFestivo, undefined, (!hasLunchGap && ordNeto > 240) ? 45 : 0);
    if (dsc !== null) ordNeto -= dsc;
    else if (!hasLunchGap && ordNeto > 240) ordNeto -= 45;
    return Math.max(0, ordNeto);
  }

  function esSalidaSinRegistrar(r) {
    if (!r) return false;
    const disp = String(r.dispositivo || '').trim().toUpperCase();
    const razon = String(r.razon_salida || r.razon_salida_temprana || r.razon_justificac || r.razon_ausencia || '').toLowerCase();
    return disp === 'AUTO_COMPLETAR' || razon.includes('no registr');
  }
  // Quita de los tramos trabajados (entrada→salida) los horarios de permiso: un tramo 07:30–16:15 con permiso
  // 10:00–12:00 queda en 07:30–10:00 y 12:00–16:15. Los tramos sin entrada o sin salida no se tocan.
  function recortarPeriodos(periodosDia, permisos) {
    const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
    const out = [];
    (periodosDia || []).forEach(p => {
      const mE = p && p.entrada ? obtenerMinutos(p.entrada.hora || p.entrada.timestamp) : null;
      const mS = p && p.salida ? obtenerMinutos(p.salida.hora || p.salida.timestamp) : null;
      if (mE === null || mS === null || mS <= mE) { out.push(p); return; }
      let trozos = [[mE, mS]];
      permisos.forEach(({ a, b }) => {
        trozos = trozos.flatMap(([x, y]) => (b <= x || a >= y) ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([u, v]) => v > u));
      });
      trozos.forEach(([x, y]) => out.push({
        entrada: x === mE ? p.entrada : { tipo: 'ENTRADA', hora: hm(x), permiso: true },
        salida: y === mS ? p.salida : { tipo: 'SALIDA', hora: hm(y), permiso: true }
      }));
    });
    return out;
  }
  function contarRegistrosInconclusos(periodosDia) {
    return (periodosDia || []).filter(p => p.entrada && (!p.salida || esSalidaSinRegistrar(p.salida))).length;
  }

  // ---------------------------------------------------------------- cumpleaños (media jornada)
  function esCumpleanosEmpleadoEnFecha(emp, fechaStr) {
    if (!emp || !fechaStr) return false;
    const rawN = typeof window.obtenerFechaNacimientoEmpleado === 'function'
      ? window.obtenerFechaNacimientoEmpleado(emp)
      : (emp.fechaNacimiento || emp.fecha_nacimiento || emp.fNacimiento || emp.fechanacimiento || '');
    if (!rawN) return false;
    const norm = v => typeof window.normalizarFechaParaInput === 'function' ? window.normalizarFechaParaInput(v) : String(v).split('T')[0];
    const pNac = String(norm(rawN) || '').split('-'), pFecha = String(norm(fechaStr) || '').split('-');
    if (pNac.length < 3 || pFecha.length < 3) return false;
    return parseInt(pNac[1], 10) === parseInt(pFecha[1], 10) && parseInt(pNac[2], 10) === parseInt(pFecha[2], 10);
  }
  function beneficioCumpleanosDia(emp, fecha, regsDia, tieneAsistencia) {
    const marcado = (regsDia || []).some(r => {
      const raz = String(r.razon_ausencia || r.razon_permiso || '').toLowerCase();
      const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
      return raz.includes('cumplea') || tip.includes('CUMPLE');
    });
    if (marcado) return true;
    return Boolean(tieneAsistencia && esCumpleanosEmpleadoEnFecha(emp, fecha));
  }

  // ---------------------------------------------------------------- días del período
  // regs: registros del período (fecha normalizada). Igual que rebuildTable() del detalle del panel.
  function armarPorDia({ regs, vacaciones, R_INI, R_FIN, empleado, verificandoHistorial, hoy }) {
    const e = empleado || {};
    const id = String(e.id || '');
    const porDia = {};
    [...(regs || [])].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return String(a.hora || '').localeCompare(String(b.hora || ''));
    }).forEach(r => {
      const fechaNorm = normalizarFechaStr(r.fecha);
      if (!fechaNorm) return;
      if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
      const rTipo = String(r.tipo || '').toUpperCase();
      const rH = (r.hora || '').slice(0, 5);
      const yaExiste = porDia[fechaNorm].registros.some(ex => {
        const exTipo = String(ex.tipo || '').toUpperCase();
        const exH = (ex.hora || '').slice(0, 5);
        if (ex.id && r.id && ex.id === r.id) return true;
        if (exTipo === rTipo && exH && rH && exH === rH) return true;
        if (exTipo.includes('SALIDA') && rTipo.includes('SALIDA') && exH && rH && exH === rH) return true;
        const esEntradaEx = exTipo.includes('ENTRADA') || exTipo.includes('RETORNO');
        const esEntradaR = rTipo.includes('ENTRADA') || rTipo.includes('RETORNO');
        if (esEntradaEx && esEntradaR && exH && rH && exH === rH) return true;
        return false;
      });
      if (!yaExiste) {
        porDia[fechaNorm].registros.push(r);
      } else {
        const ex = porDia[fechaNorm].registros.find(x => {
          const exTipo = String(x.tipo || '').toUpperCase();
          const exH = (x.hora || '').slice(0, 5);
          return (x.id && r.id && x.id === r.id) || (exTipo === rTipo && exH === rH);
        });
        if (ex) {
          if (!ex.timestamp && r.timestamp) ex.timestamp = r.timestamp;
          if (r.permiso_personal_mins) ex.permiso_personal_mins = r.permiso_personal_mins;
          if (r.permiso_medico_mins) ex.permiso_medico_mins = r.permiso_medico_mins;
          if (r.tiempo_justificado_mins) ex.tiempo_justificado_mins = r.tiempo_justificado_mins;
          if (r.razon_permiso) ex.razon_permiso = r.razon_permiso;
          if (r.razon_ausencia && !ex.razon_ausencia) ex.razon_ausencia = r.razon_ausencia;
          if (r.razon_justificac && !ex.razon_justificac) ex.razon_justificac = r.razon_justificac;
        }
      }
      if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
    });

    // Vacaciones como registros virtuales (si ese día no marcó asistencia)
    (vacaciones || []).forEach(v => {
      const fNorm = normalizarFechaStr(v.fecha);
      if (!fNorm || fNorm < R_INI || fNorm > R_FIN) return;
      if (!porDia[fNorm]) porDia[fNorm] = { registros: [], almuerzo: null };
      const tieneMarcacionesReales = porDia[fNorm].registros.some(r => ['ENTRADA', 'SALIDA', 'RETORNO_CAMPO', 'SALIDA_CAMPO', 'ENTRADA_CAMPO'].includes(String(r.tipo || '').toUpperCase()));
      if (tieneMarcacionesReales) return;
      if (!porDia[fNorm].registros.some(r => r.tipo === 'VACACIONES' || r.tipo === 'VACACION')) {
        porDia[fNorm].registros.push({ id: `${id}_VACACIONES_${fNorm}_000000`, empleadoId: id, tipo: 'VACACIONES', fecha: fNorm, razon_ausencia: 'Vacación', justificado: 'SI' });
      }
    });

    // Días laborables sin registros hasta ayer (hoy está en curso)
    const hoyStrLocal = hoy || hoyLocal();
    const dHoy = new Date(hoyStrLocal + 'T12:00:00');
    dHoy.setDate(dHoy.getDate() - 1);
    const ayerStrLocal = dHoy.toISOString().split('T')[0];
    let limiteFinLocal = (R_FIN && R_FIN < ayerStrLocal) ? R_FIN : ayerStrLocal;
    const fSalidaEmp = (e.fecha_salida || e.fechaDesvinculacion) ? (normalizarFechaStr(e.fecha_salida || e.fechaDesvinculacion) || e.fecha_salida) : null;
    if (fSalidaEmp && fSalidaEmp < limiteFinLocal) limiteFinLocal = fSalidaEmp;

    const fechaInicioEfectiva = obtenerFechaInicioEfectivaEmpleado(e, R_INI);
    const inicioEvalEmp = (fechaInicioEfectiva && fechaInicioEfectiva > R_INI) ? fechaInicioEfectiva : R_INI;
    if (fechaInicioEfectiva && fechaInicioEfectiva > R_INI) {
      const dPrev = new Date(fechaInicioEfectiva + 'T12:00:00');
      dPrev.setDate(dPrev.getDate() - 1);
      const finPrevio = dPrev.toISOString().split('T')[0];
      if (R_INI <= finPrevio) {
        obtenerDiasHabiles(R_INI, finPrevio).forEach(fPrev => {
          if (!porDia[fPrev]) porDia[fPrev] = { registros: [], almuerzo: null, previoAlRegistro: true };
        });
      }
    }
    if (inicioEvalEmp && limiteFinLocal && inicioEvalEmp <= limiteFinLocal) {
      obtenerDiasHabiles(inicioEvalEmp, limiteFinLocal).forEach(fHab => {
        if (!porDia[fHab]) {
          porDia[fHab] = verificandoHistorial
            ? { registros: [], almuerzo: null, verificandoHistorial: true }
            : { registros: [], almuerzo: null, faltaInasistencia: true };
        }
      });
    }
    return porDia;
  }

  // ---------------------------------------------------------------- bolsa de 4 h
  // Consumo cronológico: las primeras 4 h de descuento del período (atrasos, faltantes, permiso personal,
  // penalización por no marcar salida) las cubre la bolsa; el resto se descuenta.
  // solicitudes (opcional, fase 2 de permisos): los permisos personales por horas APROBADOS cuya parte cargada a
  // vacaciones (vacaciones_por_dia) no debe descontarse otra vez ese día: se suma como tiempo justificado.
  // Fase 3: permiso médico por horas registrado → ese tiempo es médico (no se descuenta) mientras TTHH no confirme
  // el descuento; permiso médico o calamidad por días con descuento confirmado (docs_estado DESCONTADO) → esos días
  // dejan de estar justificados.
  // Fase 5: permiso marcado en la app (salida o entrada tardía) que el jefe rechazó → esa salida temprana o ese
  // atraso de ese día dejan de estar justificados.
  // Permisos por horas (2026-11-12): el horario pedido manda. Toda solicitud por horas que no esté cancelada recorta
  // la jornada marcada en ese horario, haya marcado o no la salida y el regreso del permiso (si los marcó, no se
  // cuenta dos veces). Ese tiempo queda como faltante y se clasifica como siempre: permiso médico registrado →
  // tiempo médico; personal aprobado → bolsa / vacaciones / rol; pendiente, o rechazado cuando el permiso ya había
  // empezado → sin justificar (rechazado antes de la hora: no cuenta, se quedó trabajando).
  // Si el permiso llega al fin de la jornada, la salida autocompletada no lleva los 15 min de penalización.
  function calcularBolsa({ empleado, porDia, hoy, solicitudes }) {
    const justificadoVac = {}, medicoHoras = {}, sinJustificar = {}, marcacionRechazada = {}, permisoHoras = {};
    (solicitudes || []).forEach(s => {
      if (!s) return;
      // Un rechazo que llegó antes de la hora del permiso no cuenta: lo normal es que se quedara trabajando
      const rechazoAntes = s.estado === 'RECHAZADA' && !s.origen && s.resuelta_en && s.hora_desde &&
        new Date(s.resuelta_en) < new Date(`${s.desde}T${String(s.hora_desde).slice(0, 5)}:00`);
      if (s.modalidad === 'HORAS' && s.estado !== 'CANCELADA' && s.desde && !rechazoAntes) {
        const a = obtenerMinutos(s.hora_desde), b = obtenerMinutos(s.hora_hasta);
        if (a !== null && b !== null && b > a) (permisoHoras[s.desde] = permisoHoras[s.desde] || []).push({ a, b });
      }
      if (s.estado === 'RECHAZADA' && s.origen && s.desde) {
        marcacionRechazada[s.desde] = Object.assign(marcacionRechazada[s.desde] || {}, { [s.origen]: true });
        return;
      }
      if (s.estado === 'APROBADA' && s.tipo === 'PERMISO_PERSONAL' && s.modalidad === 'HORAS') {
        Object.keys(s.vacaciones_por_dia || {}).forEach(f => { justificadoVac[f] = (justificadoVac[f] || 0) + (Number(s.vacaciones_por_dia[f]) || 0); });
      } else if (s.estado === 'REGISTRADA' && (s.tipo === 'PERMISO_MEDICO' || s.tipo === 'CALAMIDAD')) {
        if (s.docs_estado === 'DESCONTADO') {
          if (s.modalidad === 'DIAS') (s.fechas || []).forEach(f => { sinJustificar[f] = true; });
        } else if (s.tipo === 'PERMISO_MEDICO' && s.modalidad === 'HORAS' && s.desde) {
          medicoHoras[s.desde] = (medicoHoras[s.desde] || 0) + (Number(s.minutos) || 0);
        }
      }
    });
    const e = empleado || {};
    const hoyStrLocal = hoy || hoyLocal();
    const esPasanteDet = esEmpleadoPasante(e);
    const fechasCronologicas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => a.localeCompare(b));
    let saldoBeneficio4h = esPasanteDet ? 0 : BOLSA_MIN;
    const mapBeneficioPorDia = {};

    fechasCronologicas.forEach(f => {
      const d = porDia[f];
      if (d.verificandoHistorial) {
        mapBeneficioPorDia[f] = { consumo4h: 0, tjNeto: 0, descuentoNeto: 0, rawTJ: 0, rawDescuento: 0, atrasoMinsDia: 0, salidaTempMinsDia: 0 };
        return;
      }
      const regsDia = [...d.registros].sort((a, b) => {
        if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
        return String(a.hora || '').localeCompare(String(b.hora || ''));
      });
      const dayOfWeek = new Date(f + 'T12:00:00').getDay();
      const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
      const tieneAsistencia = regsDia.some(r => ['ENTRADA', 'SALIDA', 'RETORNO_CAMPO', 'SALIDA_CAMPO', 'ENTRADA_CAMPO'].includes(String(r.tipo || '').toUpperCase()));

      const esCampoHoy = regsDia.some(r => {
        const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
        const modo = String(r.modo || r.modo_trabajo || '').toUpperCase();
        const raz = String(r.razon_ausencia || r.razon_permiso || r.razon_justificac || r.razon_salida || r.observacion || '').toUpperCase();
        const est = String(r.estado || '').toUpperCase();
        return t.includes('CAMPO') || modo.includes('CAMPO') || raz.includes('CAMPO') || est.includes('CAMPO');
      });

      const isJustificado = !sinJustificar[f] && (esCampoHoy || regsDia.some(r => {
        const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
        const razAus = String(r.razon_ausencia || '').trim();
        if (tieneAsistencia && (tipo.includes('VACAC') || razAus.toUpperCase().includes('VACAC'))) return false;
        if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) {
          if (tieneAsistencia && (tipo.includes('VACAC') || razAus.toUpperCase().includes('VACAC'))) return false;
          return true;
        }
        const razPerm = String(r.razon_permiso || '').trim();
        const razJust = String(r.razon_justificac || '').trim();
        if (razAus && !['—', '-', '', 'INASISTENCIA', 'FALTA INJUSTIFICADA', 'INJUSTIFICADA'].includes(razAus.toUpperCase())) return true;
        if (razPerm && !['—', '-', '', 'INASISTENCIA', 'FALTA INJUSTIFICADA', 'INJUSTIFICADA'].includes(razPerm.toUpperCase())) return true;
        if (razJust && !['—', '-', ''].includes(razJust.toUpperCase())) return true;
        if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(tipo)) {
          if (tipo.includes('JUSTIFIC') || tipo.includes('CAMPO') || tipo.includes('VACAC') || tipo.includes('MEDIC') || tipo.includes('CALAMIDAD') || tipo.includes('CUMPLE') || tipo.includes('PERSONAL')) return true;
        }
        return false;
      }));

      const periodosDia = [];
      let entradaPendiente = null;
      let ultimoSalidaMins = null;
      regsDia.forEach(r => {
        const tipo = String(r.tipo || '').toUpperCase();
        if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO' || tipo === 'ENTRADA_CAMPO') {
          const mE = obtenerMinutos(r.timestamp || r.hora);
          if (entradaPendiente) {
            const mPend = obtenerMinutos(entradaPendiente.timestamp || entradaPendiente.hora);
            if (mPend !== null && mE !== null && Math.abs(mE - mPend) <= 2) return;
          }
          entradaPendiente = r;
        } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO' || tipo === 'SALIDA_PASANTE' || r.tipo_salida === 'SALIDA_PASANTE' || r.razon_salida === 'salida_pasante') {
          if (entradaPendiente) {
            periodosDia.push({ entrada: entradaPendiente, salida: r });
            ultimoSalidaMins = obtenerMinutos(r.timestamp || r.hora);
            entradaPendiente = null;
          } else {
            periodosDia.push({ entrada: null, salida: r });
          }
        }
      });
      if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });
      if (periodosDia.length === 0) periodosDia.push({ entrada: null, salida: null });

      const primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO');
      let atrasoMins = 0;
      if (primerReg && !esPasanteDet && !esFestivo) {
        const mE = obtenerMinutos(primerReg.timestamp || primerReg.hora);
        const refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
        if (mE !== null && mE > refEntrada + 5) atrasoMins = mE - refEntrada;
      }

      const ultSalReg = [...regsDia].reverse().find(r => String(r.tipo || r.tipo_salida || '').toUpperCase().includes('SALIDA'));
      if (ultSalReg) {
        const mS = obtenerMinutos(ultSalReg.hora || ultSalReg.timestamp);
        if (mS !== null) ultimoSalidaMins = mS;
      }

      let minsSalidaTemprana = 0;
      const refSalida = esFestivo ? 975 : HORA_SALIDA_REF;
      if (!esFestivo && !esPasanteDet && ultimoSalidaMins !== null && ultimoSalidaMins < refSalida) {
        minsSalidaTemprana = refSalida - ultimoSalidaMins;
      }

      let tiempoPersonal = 0, tiempoMedico = 0, tiempoJustificado = 0;
      const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
      tiempoPersonal += regPermiso ? Number(regPermiso.permiso_personal_mins || 0) : 0;
      tiempoMedico += regPermiso ? Number(regPermiso.permiso_medico_mins || 0) : 0;
      if (medicoHoras[f]) tiempoMedico += medicoHoras[f];
      tiempoJustificado += regPermiso ? Number(regPermiso.tiempo_justificado_mins || 0) : 0;
      if (beneficioCumpleanosDia(e, f, regsDia, tieneAsistencia)) tiempoJustificado = Math.max(tiempoJustificado, 240);
      if (justificadoVac[f]) tiempoJustificado += justificadoVac[f];

      const tramosPermiso = permisoHoras[f] || [];
      const periodosNeto = tramosPermiso.length ? recortarPeriodos(periodosDia, tramosPermiso) : periodosDia;
      const permisoHastaFin = tramosPermiso.some(t => t.b >= HORA_SALIDA_REF);
      const inconclusos = periodosDia.filter(p => p.entrada && (!p.salida || (esSalidaSinRegistrar(p.salida) && !permisoHastaFin))).length;
      const netWorkedOrdinario = calcularNetWorkedOrdinario(periodosNeto, esFestivo, f, e.id);
      const missingMinutesDia = esFestivo ? 0 : Math.max(0, 480 - netWorkedOrdinario);
      if (!esFestivo && f >= DESCANSOS_DESDE) minsSalidaTemprana = Math.min(minsSalidaTemprana, missingMinutesDia);
      if (!esFestivo && (atrasoMins + minsSalidaTemprana) > missingMinutesDia) {
        atrasoMins = Math.max(0, missingMinutesDia - minsSalidaTemprana);
      }

      const rawAtrasoMins = atrasoMins;
      const rawSalidaTemprana = minsSalidaTemprana;
      let atrasoMinsDia = atrasoMins;
      let salidaTempMinsDia = minsSalidaTemprana;
      if (esPasanteDet) {
        atrasoMinsDia = 0;
        salidaTempMinsDia = 0;
      } else {
        const rech = marcacionRechazada[f] || {};
        const tieneJustifEntradaTardia = !rech.ENTRADA_TARDIA && regsDia.some(r => r.razon_entrada_tardia && !['—', '-', ''].includes(String(r.razon_entrada_tardia).trim()));
        const permisosTotales = tiempoPersonal + tiempoMedico + tiempoJustificado;
        atrasoMinsDia = tieneJustifEntradaTardia ? 0 : Math.max(0, rawAtrasoMins - permisosTotales);
        const tieneJustifSalidaTemprana = !rech.SALIDA && regsDia.some(r => r.razon_salida_temprana && !['—', '-', ''].includes(String(r.razon_salida_temprana).trim()));
        if (tieneJustifSalidaTemprana) {
          salidaTempMinsDia = 0;
        } else {
          const permisosRestantes = Math.max(0, permisosTotales - (tieneJustifEntradaTardia ? 0 : rawAtrasoMins));
          salidaTempMinsDia = Math.max(0, rawSalidaTemprana - permisosRestantes);
        }
      }

      let rawTJ = 0;
      const esPrevioAlRegistro = Boolean(d.previoAlRegistro);
      const esHoyOFuturo = f >= hoyStrLocal;
      if ((isJustificado && !tieneAsistencia) || esHoyOFuturo || esPrevioAlRegistro || esPasanteDet) {
        rawTJ = (esPasanteDet && periodosDia.some(p => p.entrada && !p.salida)) ? 60 : 0;
      } else {
        const missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorkedOrdinario);
        const unaccountedMissing = Math.max(0, missingMinutes - (tiempoPersonal + tiempoMedico));
        rawTJ = Math.max(0, unaccountedMissing - tiempoJustificado);
        if (!esFestivo) rawTJ += PENALIZACION_SIN_SALIDA_MIN * inconclusos;
      }

      const rawDescuento = tiempoPersonal + (rawTJ > 0 ? Math.max(rawTJ, atrasoMinsDia) : atrasoMinsDia);

      let consumo4h = 0;
      if (!esPasanteDet && saldoBeneficio4h > 0 && rawDescuento > 0) {
        consumo4h = Math.min(saldoBeneficio4h, rawDescuento);
        saldoBeneficio4h -= consumo4h;
      }

      mapBeneficioPorDia[f] = {
        consumo4h,
        tjNeto: Math.max(0, rawTJ - consumo4h),
        descuentoNeto: Math.max(0, rawDescuento - consumo4h),
        rawTJ,
        rawDescuento,
        atrasoMinsDia,
        salidaTempMinsDia,
        faltante: (isJustificado && !tieneAsistencia) || esHoyOFuturo || esPrevioAlRegistro || esPasanteDet || esFestivo ? 0 : Math.max(0, 480 - netWorkedOrdinario),
        tiempoPersonal, tiempoMedico, tiempoJustificado,
        penalSinSalida: (!esFestivo && !((isJustificado && !tieneAsistencia) || esHoyOFuturo || esPrevioAlRegistro || esPasanteDet)) ? PENALIZACION_SIN_SALIDA_MIN * inconclusos : 0,
        saldoBolsa: saldoBeneficio4h
      };
    });
    return { porDia: mapBeneficioPorDia, saldo: saldoBeneficio4h, pasante: esPasanteDet };
  }

  // Saldo de la bolsa del período en curso para un colaborador (app: aviso del permiso personal)
  function saldoBolsaPeriodo({ empleado, registros, vacaciones, hoy, solicitudes }) {
    const h = hoy || hoyLocal();
    const per = periodoDe(h);
    const regs = (registros || []).map(r => {
      const fNorm = normalizarFechaStr(r.fecha);
      return fNorm ? Object.assign({}, r, { fecha: fNorm }) : r;
    }).filter(r => r.fecha >= per.inicio && r.fecha <= per.fin);
    const porDia = armarPorDia({ regs, vacaciones, R_INI: per.inicio, R_FIN: per.fin, empleado, verificandoHistorial: false, hoy: h });
    const r = calcularBolsa({ empleado, porDia, hoy: h, solicitudes });
    return { saldo: r.saldo, usado: (r.pasante ? 0 : BOLSA_MIN) - r.saldo, pasante: r.pasante, periodo: per, mapa: r.porDia };
  }

  window.ReglasJornada = {
    HORA_ENTRADA_REF, TOLERANCIA_ENTRADA_MIN, HORA_SALIDA_REF, BOLSA_MIN, PENALIZACION_SIN_SALIDA_MIN, DESCANSOS_DESDE, DESCANSOS_LV,
    obtenerMinutos, normalizarFechaStr, esFeriadoODomingo, obtenerDiasHabiles, periodoDe, esEmpleadoPasante,
    obtenerFechaInicioEfectivaEmpleado, ajusteDescansoDia, almorzoEnPlanta, almuerzoFinSemana, descansoDia,
    calcularNetWorkedOrdinario, esSalidaSinRegistrar, contarRegistrosInconclusos, recortarPeriodos, esCumpleanosEmpleadoEnFecha,
    beneficioCumpleanosDia, armarPorDia, calcularBolsa, saldoBolsaPeriodo
  };
})();
