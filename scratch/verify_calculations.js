// Script de prueba para validar los cálculos de horarios, sobretiempos y justificaciones (Sin almuerzo en fines de semana/feriados)
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
  // Solo descontar almuerzo en días laborables normales (no en fines de semana/feriados)
  if (!esFestivo && netWorked > 240) netWorked -= 45;

  let autorizado = registros.some(r => r.horasExtra === 'SI') || netWorked > 60; // Auto-autorizado si > 1h en festivos

  let extraMins50Acum = 0;
  let extraMins100Acum = 0;
  let shiftMins = 0;

  periodosDia.forEach(p => {
    let mE = obtenerMinutos(p.entrada.hora);
    let mS = obtenerMinutos(p.salida.hora);

    if (esFestivo) {
      if (autorizado) horasExtra100 += (mS - mE);
    } else {
      let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
      if (autorizado && mS > H_FIN) {
        extraMins50Acum += (mS - Math.max(mE, H_FIN));
      }
    }
  });

  if (esFestivo) {
    // Ya acumulados directamente
  } else {
    horasExtra50 += extraMins50Acum;
  }

  if (!isJustificado) {
    // La jornada esperada neta es siempre 480 minutos (8 horas)
    let justMins = 0;
    let entradaDia = registros.find(r => r.tipo === 'ENTRADA');
    if (entradaDia && entradaDia.tiempo_justificado_mins) {
      justMins = Number(entradaDia.tiempo_justificado_mins);
    }

    let missingMinutes = Math.max(0, 480 - netWorked);
    let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar;
    let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
    totalTiempoPorJustificar += unaccountedMissing;
    totalTiempoPorJustificar = Math.max(0, totalTiempoPorJustificar - justMins);
  }

  return { totalTiempoPorJustificar, horasExtra100, horasExtra50 };
}

// ==========================================
// CASOS DE PRUEBA
// ==========================================

console.log("?? Ejecutando pruebas de cálculo...");

// Caso 1: Sábado normal (Festivo) trabajado de 07:00 a 15:45 (sobretiempo de 45 mins)
// Esperado: 8h 45m (525 mins) extras 100% (8h shift + 45m extra), 0 tiempo por justificar
const res1 = calcularJornada({
  fecha: '2026-06-06', // Sábado
  registros: [
    { tipo: 'ENTRADA', hora: '07:00:00' },
    { tipo: 'SALIDA', hora: '15:45:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 1 (Sábado completo con extras):", res1);
assert.strictEqual(res1.horasExtra100, 525, "Caso 1: Horas Extra 100% debería ser 525 mins (8h 45m)");
assert.strictEqual(res1.totalTiempoPorJustificar, 0, "Caso 1: Tiempo por justificar debería ser 0");

// Caso 2: Sábado (Festivo) trabajado de 07:00 a 15:30
// Esperado: 8h 30m (510 mins) extras 100%, 0 tiempo por justificar (sin umbral de 40 min en festivos)
const res2 = calcularJornada({
  fecha: '2026-06-06', // Sábado
  registros: [
    { tipo: 'ENTRADA', hora: '07:00:00' },
    { tipo: 'SALIDA', hora: '15:30:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 2 (Sábado con extras sin umbral):", res2);
assert.strictEqual(res2.horasExtra100, 510, "Caso 2: Horas Extra 100% debería ser 510 mins (8h 30m)");
assert.strictEqual(res2.totalTiempoPorJustificar, 0, "Caso 2: Tiempo por justificar debería ser 0");

// Caso 3: Sábado (Festivo) trabajado incompleto de 08:00 a 15:00 (tarde por 1h)
// Esperado: 7h (420 mins) de extras 100%, 60 mins de tiempo por justificar (faltó 1h para completar 8h)
const res3 = calcularJornada({
  fecha: '2026-06-06',
  registros: [
    { tipo: 'ENTRADA', hora: '08:00:00' },
    { tipo: 'SALIDA', hora: '15:00:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 3 (Sábado incompleto):", res3);
assert.strictEqual(res3.horasExtra100, 420, "Caso 3: Horas Extra 100% debería ser 420 mins");
assert.strictEqual(res3.totalTiempoPorJustificar, 60, "Caso 3: Tiempo por justificar debería ser 60 mins (1h)");

// Caso 4: Sábado (Festivo) incompleto PERO JUSTIFICADO
// Esperado: 7h (420 mins) de extras, 0 mins de tiempo por justificar
const res4 = calcularJornada({
  fecha: '2026-06-06',
  registros: [
    { tipo: 'ENTRADA', hora: '08:00:00', justificado: 'SI' },
    { tipo: 'SALIDA', hora: '15:00:00', justificado: 'SI' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 4 (Sábado incompleto justificado):", res4);
assert.strictEqual(res4.horasExtra100, 420, "Caso 4: Horas Extra 100% debería ser 420 mins");
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

// Caso 6: El caso del usuario (entrada 07:17, salida 15:15 en festivo/fin de semana)
// Esperado:
//   - Horas trabajadas netas: 15:15 - 07:17 = 7h 58m = 478 mins.
//   - Tiempo por justificar: 480 - 478 = 2 mins (00:02:00)
//   - Horas extras 100%: 7h 58m = 478 mins (07:58:00) (bajo la opción B, igual al total trabajado)
const res6 = calcularJornada({
  fecha: '2026-06-06', // Sábado (Festivo)
  registros: [
    { tipo: 'ENTRADA', hora: '07:17:00' },
    { tipo: 'SALIDA', hora: '15:15:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 6 (Caso del usuario: entrada 07:17, salida 15:15):", res6);
assert.strictEqual(res6.horasExtra100, 478, "Caso 6: Horas Extra 100% debería ser 478 mins (07:58:00)");
assert.strictEqual(res6.totalTiempoPorJustificar, 2, "Caso 6: Tiempo por justificar debería ser 2 mins (00:02:00)");

// Caso 7: Sábado incompleto con 45 minutos justificados
// Esperado:
//   - Horas trabajadas netas: 15:00 - 08:00 = 7h = 420 mins.
//   - Tiempo por justificar: 480 - 420 - 45 (justificados) = 15 mins (00:15:00)
const res7 = calcularJornada({
  fecha: '2026-06-06',
  registros: [
    { tipo: 'ENTRADA', hora: '08:00:00', tiempo_justificado_mins: 45 },
    { tipo: 'SALIDA', hora: '15:00:00' }
  ],
  diasLaborables: ['2026-06-06']
});
console.log("Caso 7 (Sábado incompleto con tiempo justificado):", res7);
assert.strictEqual(res7.horasExtra100, 420, "Caso 7: Horas Extra 100% debería ser 420 mins");
assert.strictEqual(res7.totalTiempoPorJustificar, 15, "Caso 7: Tiempo por justificar debería ser 15 mins");

console.log("?? TODAS LAS PRUEBAS PASARON CORRECTAMENTE!");

