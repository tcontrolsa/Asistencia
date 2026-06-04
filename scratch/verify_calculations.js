// Script de prueba para validar los cálculos de horarios, sobretiempos y justificaciones
const assert = require('assert');

// Mock de utilidades
function obtenerMinutos(valor) {
  if (!valor) return null;
  let m = valor.match(/(\d{1,2}):(\d{2})/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  return null;
}

function esFeriadoODomingo(fechaStr) {
  let fecha = new Date(fechaStr + 'T12:00:00');
  let dia = fecha.getDay();
  if (dia === 0) return true; // Domingo
  
  // Mock feriado
  const feriados = ['01-01', '05-01', '12-25'];
  const md = fechaStr.slice(5); // MM-DD
  return feriados.includes(md);
}

function calcularJornada({ fecha, registros, diasLaborables, HORA_ENTRADA_REF = 450, HORA_SALIDA_REF = 975 }) {
  const esFestivo = esFeriadoODomingo(fecha) || (new Date(fecha + 'T12:00:00').getDay() === 6);
  const isJustificado = registros.some(r => r.justificado === 'SI');

  let totalTiempoMedico = 0;
  let totalTiempoPersonal = 0;
  let totalTiempoPorJustificar = 0;
  let horasExtra100 = 0;
  let horasExtra50 = 0;

  if (registros.length === 0) {
    if (!esFestivo && diasLaborables.includes(fecha)) {
      totalTiempoPorJustificar += 480;
    }
    return { totalTiempoPorJustificar, horasExtra100, horasExtra50 };
  }

  let sortedRegs = [...registros].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));

  let periodosDia = [];
  let entradaPendiente = null;
  let ultimoSalidaMins = null;
  let ultimoSalidaReg = null;

  // Primer paso: calcular gaps
  sortedRegs.forEach(r => {
    const tipo = String(r.tipo || '').toUpperCase();
    if (tipo === 'ENTRADA') {
      let mE = obtenerMinutos(r.hora);
      if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
        let gap = mE - ultimoSalidaMins;
        if (r.razon === 'medico') totalTiempoMedico += gap;
        else if (r.razon === 'personal') totalTiempoPersonal += gap;
        else {
          if (!isJustificado) totalTiempoPorJustificar += gap;
        }
      }
      entradaPendiente = r;
    } else if (tipo === 'SALIDA') {
      if (entradaPendiente) {
        periodosDia.push({ entrada: entradaPendiente, salida: r });
        ultimoSalidaMins = obtenerMinutos(r.hora);
        ultimoSalidaReg = r;
        entradaPendiente = null;
      }
    }
  });

  let minutosTrabajadosHoy = 0;
  let dayPersonal = 0;
  let dayMedico = 0;
  let dayJustificar = 0;

  ultimoSalidaMins = null;
  ultimoSalidaReg = null;

  periodosDia.forEach(p => {
    let mE = obtenerMinutos(p.entrada.hora);
    let mS = obtenerMinutos(p.salida.hora);
    minutosTrabajadosHoy += (mS - mE);

    if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
      let gap = mE - ultimoSalidaMins;
      if (p.salida.razon === 'medico') dayMedico += gap;
      else if (p.salida.razon === 'personal') dayPersonal += gap;
      else dayJustificar += gap;
    }
    ultimoSalidaMins = mS;
  });

  let netWorked = minutosTrabajadosHoy;
  if (netWorked > 240) netWorked -= 45;

  let autorizado = registros.some(r => r.horasExtra === 'SI') || netWorked > 60; // Auto-autorizado si > 1h en festivos

  let extraMins50Acum = 0;
  let extraMins100Acum = 0;
  let shiftMins = 0;

  periodosDia.forEach(p => {
    let mE = obtenerMinutos(p.entrada.hora);
    let mS = obtenerMinutos(p.salida.hora);

    if (esFestivo) {
      let H_INI = 435; // 07:15
      let H_FIN = 915; // 15:15
      shiftMins += Math.max(0, Math.min(mS, H_FIN) - Math.max(mE, H_INI));
      if (mS > H_FIN) {
        extraMins100Acum += (mS - Math.max(mE, H_FIN));
      }
    } else {
      let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
      if (autorizado && mS > H_FIN) {
        extraMins50Acum += (mS - Math.max(mE, H_FIN));
      }
    }
  });

  if (esFestivo) {
    if (netWorked > 240) {
      shiftMins = Math.max(0, shiftMins - 45);
    }
    if (autorizado) {
      let extrasExcedentes = (extraMins100Acum >= 40) ? extraMins100Acum : 0;
      horasExtra100 += (shiftMins + extrasExcedentes);
    }
  } else {
    if (extraMins50Acum >= 40) {
      horasExtra50 += extraMins50Acum;
    }
  }

  if (!isJustificado) {
    let missingMinutes = 0;
    if (esFestivo) {
      missingMinutes = Math.max(0, 435 - netWorked);
    } else {
      missingMinutes = Math.max(0, 480 - netWorked);
    }
    let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar;
    let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
    totalTiempoPorJustificar += unaccountedMissing;
  }

  return { totalTiempoPorJustificar, horasExtra100, horasExtra50 };
}

// ==========================================
// CASOS DE PRUEBA
// ==========================================

console.log("?? Ejecutando pruebas de cálculo...");

// Caso 1: Sábado normal (Festivo) trabajado de 07:15 a 16:00 (sobretiempo de 45 mins)
// Esperado: 8 horas extras 100% (7h 15m shift net + 45m extra), 0 tiempo por justificar
const res1 = calcularJornada({
  fecha: '2026-06-06', // Sábado
  registros: [
    { tipo: 'ENTRADA', hora: '07:15:00' },
    { tipo: 'SALIDA', hora: '16:00:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 1 (Sábado completo con extras):", res1);
assert.strictEqual(res1.horasExtra100, 480, "Caso 1: Horas Extra 100% debería ser 480 mins (8h)");
assert.strictEqual(res1.totalTiempoPorJustificar, 0, "Caso 1: Tiempo por justificar debería ser 0");

// Caso 2: Sábado (Festivo) trabajado de 07:15 a 15:30 (sobretiempo de 15 mins - bajo el umbral de 40 mins)
// Esperado: 7.25 horas extras 100% (435 mins), 0 tiempo por justificar
const res2 = calcularJornada({
  fecha: '2026-06-06', // Sábado
  registros: [
    { tipo: 'ENTRADA', hora: '07:15:00' },
    { tipo: 'SALIDA', hora: '15:30:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 2 (Sábado con extras bajo el umbral):", res2);
assert.strictEqual(res2.horasExtra100, 435, "Caso 2: Horas Extra 100% debería ser 435 mins (7h 15m)");
assert.strictEqual(res2.totalTiempoPorJustificar, 0, "Caso 2: Tiempo por justificar debería ser 0");

// Caso 3: Sábado (Festivo) trabajado incompleto de 08:15 a 15:15 (tarde por 1h)
// Esperado: 375 mins (6h 15m) de extras 100%, 60 mins de tiempo por justificar
const res3 = calcularJornada({
  fecha: '2026-06-06',
  registros: [
    { tipo: 'ENTRADA', hora: '08:15:00' },
    { tipo: 'SALIDA', hora: '15:15:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 3 (Sábado incompleto):", res3);
assert.strictEqual(res3.horasExtra100, 375, "Caso 3: Horas Extra 100% debería ser 375 mins");
assert.strictEqual(res3.totalTiempoPorJustificar, 60, "Caso 3: Tiempo por justificar debería ser 60 mins (1h)");

// Caso 4: Sábado (Festivo) incompleto PERO JUSTIFICADO
// Esperado: 375 mins de extras, 0 mins de tiempo por justificar
const res4 = calcularJornada({
  fecha: '2026-06-06',
  registros: [
    { tipo: 'ENTRADA', hora: '08:15:00', justificado: 'SI' },
    { tipo: 'SALIDA', hora: '15:15:00', justificado: 'SI' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 4 (Sábado incompleto justificado):", res4);
assert.strictEqual(res4.totalTiempoPorJustificar, 0, "Caso 4: Tiempo por justificar debería ser 0 porque está justificado");

// Caso 5: Domingo no trabajado
// Esperado: 0 tiempo por justificar
const res5 = calcularJornada({
  fecha: '2026-06-07', // Domingo
  registros: [],
  diasLaborables: []
});
console.log("Caso 5 (Domingo no trabajado):", res5);
assert.strictEqual(res5.totalTiempoPorJustificar, 0, "Caso 5: No debería acumular tiempo por justificar");

console.log("?? TODAS LAS PRUEBAS PASARON CORRECTAMENTE!");
