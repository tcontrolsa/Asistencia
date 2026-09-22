/**
 * AUTOCOMPLETAR SALIDAS Y REGULARIZACIÓN DE FINES DE SEMANA
 * 
 * Reglas de Horario:
 * - Días laborables (Lunes a Viernes): Salida oficial 16:15:00.
 * - Fines de semana (Sábado y Domingo): Salida hasta las 15:15:00.
 * 
 * Funciones Principales:
 * 1. autoCompletarSalidasFaltantesSheets():
 *    - Ejecuta la regularización automática de toda la hoja REGISTROS.
 *    - Revisa los últimos 7 días e inserta salidas pendientes (15:15:00 en fines de semana, 16:15:00 entre semana).
 * 2. regularizarSalidasFinDeSemana():
 *    - Escanea toda la hoja REGISTROS y regulariza automáticamente todas las salidas autocompletadas
 *      o del sistema en fines de semana que no cumplan el criterio de 15:15:00 (ej. aquellas en 16:15:00).
 *    - Limpia autorizaciones automáticas de horas extras generadas artificialmente por la hora anterior.
 */

/**
 * Extrae los minutos transcurridos desde las 00:00 (0 a 1439) desde un Date o string "HH:mm:ss" / "HH:mm".
 */
function extraerMinutosDelDia(val) {
  if (val === null || val === undefined || val === '') return null;
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return null;
    return val.getHours() * 60 + val.getMinutes();
  }
  const s = String(val).trim();
  const partes = s.split(':');
  if (partes.length >= 2) {
    const h = parseInt(partes[0], 10);
    const m = parseInt(partes[1], 10);
    if (!isNaN(h) && !isNaN(m)) {
      return h * 60 + m;
    }
  }
  try {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.getHours() * 60 + parsed.getMinutes();
    }
  } catch (e) {}
  return null;
}

/**
 * Determina si una fecha o día corresponde a fin de semana (Sábado o Domingo).
 */
function esFinDeSemanaFecha(fechaVal, diaVal, tz) {
  const diaStr = String(diaVal || '').toUpperCase().trim();
  if (diaStr.includes('SÁB') || diaStr.includes('SAB') || diaStr.includes('DOM')) {
    return true;
  }
  let d = null;
  if (fechaVal instanceof Date && !isNaN(fechaVal.getTime())) {
    d = fechaVal;
  } else if (fechaVal) {
    const s = String(fechaVal).trim();
    if (s.includes('-')) {
      const parts = s.split('-');
      if (parts.length >= 3) {
        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      }
    } else if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length >= 3) {
        if (parts[0].length === 4) {
          d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
          d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        }
      }
    }
  }
  if (d && !isNaN(d.getTime())) {
    const day = d.getDay();
    return (day === 0 || day === 6);
  }
  return false;
}

/**
 * Evalúa si un registro de salida proviene de autocompletado o del sistema (sin marcación física manual).
 */
function esSalidaAutoCompletada(disp, razonSalida, razonJust, quienJust) {
  const d = String(disp || '').trim().toUpperCase();
  const rs = String(razonSalida || '').trim().toLowerCase();
  const rj = String(razonJust || '').trim().toLowerCase();
  const qj = String(quienJust || '').trim().toUpperCase();

  return (
    d === 'AUTO_COMPLETAR' ||
    rs.includes('no registró salida') ||
    rs.includes('no registro salida') ||
    rj.includes('no registró salida') ||
    rj.includes('no registro salida') ||
    qj === 'SISTEMA'
  );
}

/**
 * Escanea toda la hoja REGISTROS y regulariza automáticamente todas las salidas autocompletadas
 * de fin de semana para que cumplan con el criterio de las 15:15:00.
 * Corrige la hora a '15:15:00', el timestamp y remueve horas extras falsas atribuidas por 16:15:00.
 */
function regularizarSalidasFinDeSemana(ssParam) {
  const tz = Session.getScriptTimeZone();
  const ss = ssParam || SpreadsheetApp.getActiveSpreadsheet();
  const sheetRegs = ss.getSheetByName("REGISTROS");
  if (!sheetRegs) {
    console.error("❌ Hoja REGISTROS no encontrada para regularización");
    return { totalAnalizados: 0, totalRegularizados: 0 };
  }

  const lastRow = sheetRegs.getLastRow();
  const lastCol = Math.max(sheetRegs.getLastColumn(), 24);
  if (lastRow <= 1) {
    console.log("ℹ️ Hoja REGISTROS no contiene datos para regularizar");
    return { totalAnalizados: 0, totalRegularizados: 0 };
  }

  const data = sheetRegs.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = (data[0] || []).map(h => String(h || '').trim().toUpperCase());

  let colFecha = headers.findIndex(h => h === 'FECHA');
  if (colFecha === -1) colFecha = 0;
  let colId = headers.findIndex(h => h === 'ID' || h === 'CEDULA' || h === 'CÉDULA');
  if (colId === -1) colId = 1;
  let colNombre = headers.findIndex(h => h === 'NOMBRE' || h.includes('EMPLEADO'));
  if (colNombre === -1) colNombre = 2;
  let colTipo = headers.findIndex(h => h === 'TIPO');
  if (colTipo === -1) colTipo = 3;
  let colHora = headers.findIndex(h => h === 'HORA');
  if (colHora === -1) colHora = 5;
  let colDisp = headers.findIndex(h => h === 'DISPOSITIVO');
  if (colDisp === -1) colDisp = 8;
  let colTimestamp = headers.findIndex(h => h === 'TIMESTAMP' || h.includes('TIMESTAMP'));
  if (colTimestamp === -1) colTimestamp = 9;
  let colDia = headers.findIndex(h => h === 'DIA' || h === 'DÍA');
  if (colDia === -1) colDia = 10;
  let colHE = headers.findIndex(h => h === 'HORAS_EXTRA' || h === 'HORAS EXTRA');
  if (colHE === -1) colHE = 12;
  let colAutoriza = headers.findIndex(h => h === 'AUTORIZA');
  if (colAutoriza === -1) colAutoriza = 13;
  let colRazonSalida = headers.findIndex(h => h === 'RAZON_SALIDA_TEMPRANA' || h.includes('SALIDA_TEMPRANA'));
  if (colRazonSalida === -1) colRazonSalida = 14;
  let colQuienJust = headers.findIndex(h => h === 'QUIEN_JUSTIFICA');
  if (colQuienJust === -1) colQuienJust = 15;
  let colRazonJust = headers.findIndex(h => h === 'RAZON_JUSTIFICAC' || h.includes('JUSTIFICAC'));
  if (colRazonJust === -1) colRazonJust = 21;

  let modificaciones = 0;
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const diasCorregidosKeys = new Set();
  const filasModificadas = new Set(); // índices de data[] a reescribir (no se reescribe toda la hoja)

  for (let i = 1; i < data.length; i++) {
    const fila = data[i];
    const tipo = String(fila[colTipo] || '').trim().toUpperCase();
    if (tipo !== 'SALIDA' && tipo !== 'SALIDA_CAMPO') {
      continue;
    }

    const fechaVal = fila[colFecha];
    const diaVal = fila[colDia];
    const esFinSemana = esFinDeSemanaFecha(fechaVal, diaVal, tz);
    if (!esFinSemana) {
      continue;
    }

    const disp = fila[colDisp];
    const razonSalida = fila[colRazonSalida];
    const razonJust = fila[colRazonJust];
    const quienJust = fila[colQuienJust];
    const esAuto = esSalidaAutoCompletada(disp, razonSalida, razonJust, quienJust);

    // Salida autocompletada en fin de semana
    if (esAuto) {
      const horaVal = fila[colHora];
      const minsHora = extraerMinutosDelDia(horaVal);

      // Criterio de fin de semana: debe ser 15:15:00 (915 minutos).
      // Si tiene 16:15:00 (975 min) o cualquier hora distinta de 15:15:00, regularizar
      if (minsHora !== 915) {
        const empId = fila[colId];
        const empNombre = fila[colNombre];
        const horaAnterior = (horaVal instanceof Date) ? Utilities.formatDate(horaVal, tz, 'HH:mm:ss') : String(horaVal);

        // Actualizar hora a las 15:15:00
        fila[colHora] = '15:15:00';

        // Actualizar TIMESTAMP a las 15:15:00
        let fechaBase = null;
        let fClave = '';
        if (fechaVal instanceof Date && !isNaN(fechaVal.getTime())) {
          fechaBase = new Date(fechaVal.getTime());
          fClave = Utilities.formatDate(fechaVal, tz, 'yyyy-MM-dd');
        } else if (fechaVal) {
          const s = String(fechaVal).trim();
          fClave = s;
          if (s.includes('-')) {
            const p = s.split('-');
            fechaBase = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
          }
        }
        if (fechaBase) {
          fechaBase.setHours(15, 15, 0, 0);
          fila[colTimestamp] = fechaBase;
          if (!fila[colDia] || String(fila[colDia]).trim() === '') {
            fila[colDia] = diasSemana[fechaBase.getDay()];
          }
        }

        // Si se habían asignado horas extras artificiales por el sistema debido a los 16:15:00, removerlas
        const autVal = String(fila[colAutoriza] || '').trim().toUpperCase();
        if (autVal.includes('SISTEMA') || autVal.includes('>45 MIN')) {
          fila[colHE] = 'NO';
          fila[colAutoriza] = '';
        }

        if (empId && fClave) {
          diasCorregidosKeys.add(`${empId}_${fClave}`);
        }

        filasModificadas.add(i);
        modificaciones++;
        console.log(`🔧 [Regularizar Fin de Semana] Fila ${i + 1} regularizada: ${empNombre} (${empId}) - Fecha: ${fClave || fechaVal} | Hora: "${horaAnterior}" ➡️ "15:15:00"`);
      }
    }
  }

  // Segunda pasada para limpiar flags de Horas Extras generadas por el sistema en la ENTRADA de esas mismas jornadas
  if (diasCorregidosKeys.size > 0) {
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const tipo = String(fila[colTipo] || '').trim().toUpperCase();
      if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
        const empId = fila[colId];
        const fechaVal = fila[colFecha];
        let fClave = (fechaVal instanceof Date) ? Utilities.formatDate(fechaVal, tz, 'yyyy-MM-dd') : String(fechaVal || '').trim();
        const key = `${empId}_${fClave}`;
        if (diasCorregidosKeys.has(key)) {
          const autVal = String(fila[colAutoriza] || '').trim().toUpperCase();
          if (autVal.includes('SISTEMA') || autVal.includes('>45 MIN')) {
            fila[colHE] = 'NO';
            fila[colAutoriza] = '';
            filasModificadas.add(i);
          }
        }
      }
    }
  }

  // Guardar solo las filas modificadas: reescribir toda la hoja pisaría ediciones concurrentes
  // (supervisor, archivador) hechas mientras se procesaba y convertiría fórmulas en valores.
  if (modificaciones > 0) {
    filasModificadas.forEach(i => {
      sheetRegs.getRange(i + 1, 1, 1, lastCol).setValues([data[i]]);
    });
    console.log(`✅ [Regularizar Fin de Semana] Proceso completado exitosamente. Se regularizaron ${modificaciones} registros de fin de semana a 15:15:00.`);
  } else {
    console.log("✅ [Regularizar Fin de Semana] Todos los registros de fin de semana ya cumplen el criterio (15:15:00).");
  }

  return { totalAnalizados: data.length - 1, totalRegularizados: modificaciones };
}

/**
 * Función principal para buscar marcaciones de salida faltantes en los últimos 7 días
 * e insertar registros de SALIDA:
 *   - Lunes a Viernes: 16:15:00
 *   - Fines de semana (Sábados y Domingos): 15:15:00
 * 
 * Antes de insertar nuevas salidas, ejecuta la regularización automática de toda la hoja REGISTROS.
 */
function autoCompletarSalidasFaltantesSheets() {
  const tz = Session.getScriptTimeZone();
  const hoy = new Date();
  const hoyStr = Utilities.formatDate(hoy, tz, 'yyyy-MM-dd');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  console.log("🚀 [Auto-completar] Iniciando proceso diario...");

  // PASO 1: Regularizar automáticamente registros de fin de semana existentes que no cumplan el criterio
  console.log("🔄 [Auto-completar - PASO 1] Ejecutando regularización automática de fines de semana...");
  const resultadoReg = regularizarSalidasFinDeSemana(ss);
  console.log(`ℹ️ [Auto-completar - PASO 1] Registros regularizados: ${resultadoReg.totalRegularizados}`);

  // PASO 2: Obtener la lista de los últimos 7 días (excluyendo hoy para no cerrar turnos activos)
  const fechasAProcesar = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const fStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    fechasAProcesar.push(fStr);
  }
  console.log("🤖 [Auto-completar - PASO 2] Rango de fechas a analizar (últimos 7 días):", fechasAProcesar);

  // PASO 3: Cargar hoja EMPLEADOS asegurando leer colaboradores activos
  const sheetEmp = ss.getSheetByName("EMPLEADOS");
  if (!sheetEmp) {
    console.error("❌ Hoja EMPLEADOS no encontrada");
    return;
  }
  
  const lastRowEmp = sheetEmp.getLastRow();
  const lastColEmp = Math.max(sheetEmp.getLastColumn(), 20);
  if (lastRowEmp <= 1) {
    console.warn("⚠️ Hoja EMPLEADOS vacía o sin registros de colaboradores");
    return;
  }
  
  const empsData = sheetEmp.getRange(1, 1, lastRowEmp, lastColEmp).getValues();
  const headersEmp = (empsData[0] || []).map(h => String(h || '').trim().toUpperCase());
  let colId = headersEmp.findIndex(h => h === 'ID' || h === 'CEDULA' || h === 'CÉDULA' || h.includes('IDENTIFICAC'));
  if (colId === -1) colId = 0;
  
  let colNombre = headersEmp.findIndex(h => h === 'NOMBRE' || h.includes('EMPLEADO') || h.includes('NOMBRE COMPLETO'));
  if (colNombre === -1) colNombre = 1;

  let colActivo = headersEmp.findIndex(h => h === 'ACTIVO' || h === 'ESTADO');
  if (colActivo === -1) colActivo = 3;

  let colCargo = headersEmp.findIndex(h => h === 'CARGO' || h === 'PUESTO' || h === 'ROL');
  if (colCargo === -1) colCargo = 13;
  
  function esEmpleadoValidoActivo(valorActivo) {
    if (valorActivo === null || valorActivo === undefined || String(valorActivo).trim() === '') {
      return true;
    }
    if (typeof valorActivo === 'boolean') {
      return valorActivo === true;
    }
    if (typeof valorActivo === 'number') {
      return valorActivo !== 0;
    }
    const val = String(valorActivo).trim().toUpperCase();
    if (['NO', 'N', 'FALSE', 'F', 'INACTIVO', 'DESVINCULADO', '0'].includes(val)) {
      return false;
    }
    return true;
  }

  const empleadosActivos = [];
  let ignoradosInactivos = 0;
  let ignoradosSinAsistencia = 0;
  
  for (let i = 1; i < empsData.length; i++) {
    const fila = empsData[i];
    const id = (fila[colId] !== null && fila[colId] !== undefined) ? String(fila[colId]).trim() : '';
    const nombre = (fila[colNombre] !== null && fila[colNombre] !== undefined) ? String(fila[colNombre]).trim() : '';
    
    if (!id || !nombre) {
      continue;
    }
    
    const activo = esEmpleadoValidoActivo(fila[colActivo]);
    const cargo = (fila[colCargo] !== null && fila[colCargo] !== undefined) ? String(fila[colCargo]).trim().toUpperCase() : '';
    
    if (!activo) {
      ignoradosInactivos++;
      continue;
    }
    if (cargo === 'SIN ASISTENCIA') {
      ignoradosSinAsistencia++;
      continue;
    }
    
    empleadosActivos.push({ id: id, nombre: nombre });
  }
  
  console.log(`🤖 [Auto-completar] Total de empleados activos a verificar: ${empleadosActivos.length} (Inactivos descartados: ${ignoradosInactivos}, Sin Asistencia: ${ignoradosSinAsistencia})`);

  // PASO 4: Cargar hoja REGISTROS y mapear marcaciones existentes
  const sheetRegs = ss.getSheetByName("REGISTROS");
  if (!sheetRegs) {
    console.error("❌ Hoja REGISTROS no encontrada");
    return;
  }
  
  const lastRowRegs = sheetRegs.getLastRow();
  const lastColRegs = Math.max(sheetRegs.getLastColumn(), 24);
  if (lastRowRegs <= 1) {
    console.log("ℹ️ Hoja REGISTROS no contiene datos previos");
    return;
  }
  
  const regsData = sheetRegs.getRange(1, 1, lastRowRegs, lastColRegs).getValues();
  const mapaRegs = {};
  
  const headersRegs = (regsData[0] || []).map(h => String(h || '').trim().toUpperCase());
  let colRegFecha = headersRegs.findIndex(h => h === 'FECHA');
  if (colRegFecha === -1) colRegFecha = 0;
  let colRegId = headersRegs.findIndex(h => h === 'ID' || h === 'CEDULA' || h === 'CÉDULA');
  if (colRegId === -1) colRegId = 1;
  let colRegTipo = headersRegs.findIndex(h => h === 'TIPO');
  if (colRegTipo === -1) colRegTipo = 3;
  
  for (let i = 1; i < regsData.length; i++) {
    const fila = regsData[i];
    let fechaFila = fila[colRegFecha];
    let fStr = '';

    if (fechaFila instanceof Date) {
      fStr = Utilities.formatDate(fechaFila, tz, 'yyyy-MM-dd');
    } else if (fechaFila) {
      fStr = String(fechaFila).trim();
      // Normalizar dd/mm/yyyy y yyyy/mm/dd: si la SALIDA quedó en otro formato no se detectaría y se insertaría una duplicada
      const mDMY = fStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
      const mYMD = fStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      if (mYMD) fStr = `${mYMD[1]}-${mYMD[2].padStart(2, '0')}-${mYMD[3].padStart(2, '0')}`;
      else if (mDMY) fStr = `${mDMY[3]}-${mDMY[2].padStart(2, '0')}-${mDMY[1].padStart(2, '0')}`;
    }
    
    if (fStr && fechasAProcesar.includes(fStr)) {
      const empId = (fila[colRegId] !== null && fila[colRegId] !== undefined) ? String(fila[colRegId]).trim() : '';
      const tipo = (fila[colRegTipo] !== null && fila[colRegTipo] !== undefined) ? String(fila[colRegTipo]).trim().toUpperCase() : '';
      const key = `${empId}_${fStr}`;
      
      if (!mapaRegs[key]) {
        mapaRegs[key] = { ENTRADA: false, SALIDA: false };
      }
      
      if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
        mapaRegs[key].ENTRADA = true;
      } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
        mapaRegs[key].SALIDA = true;
      }
    }
  }

  // PASO 5: Evaluar inasistencias de salida y preparar lote de inserción con horario según día
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const filasAInsertar = [];
  
  empleadosActivos.forEach(emp => {
    fechasAProcesar.forEach(fecha => {
      const key = `${emp.id}_${fecha}`;
      const regs = mapaRegs[key] || { ENTRADA: false, SALIDA: false };
      
      // Si registró entrada pero no salida, autocompletar
      if (regs.ENTRADA && !regs.SALIDA) {
        const [yStr, mStr, dStr] = fecha.split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10) - 1;
        const d = parseInt(dStr, 10);
        const tempD = new Date(y, m, d);
        const dayOfWeek = tempD.getDay(); // 0 = Domingo, 6 = Sábado
        const diaSemana = diasSemana[dayOfWeek];

        // Regla: En fines de semana salida a las 15:15:00; entre semana a las 16:15:00
        const esFinDeSemana = (dayOfWeek === 0 || dayOfWeek === 6);
        const horaSalida = esFinDeSemana ? '15:15:00' : '16:15:00';
        const horaNum = esFinDeSemana ? 15 : 16;
        const dateObj = new Date(y, m, d, horaNum, 15, 0);

        console.log(`⚠️ [FALTA DE SALIDA DETECTADA] ${emp.nombre} (${emp.id}) el ${fecha} (${diaSemana}). Salida configurada: ${horaSalida}`);
        
        const nuevaFila = new Array(24).fill('');
        
        // Rellenar arreglo de fila según la estructura oficial (A-X)
        nuevaFila[0] = fecha;                    // A: FECHA
        nuevaFila[1] = emp.id;                   // B: ID
        nuevaFila[2] = emp.nombre;               // C: NOMBRE
        nuevaFila[3] = 'SALIDA';                 // D: TIPO
        nuevaFila[4] = 'NO';                     // E: ALMUERZO
        nuevaFila[5] = horaSalida;               // F: HORA (15:15:00 en fines de semana, 16:15:00 entre semana)
        nuevaFila[6] = '';                       // G: LAT
        nuevaFila[7] = '';                       // H: LNG
        nuevaFila[8] = 'AUTO_COMPLETAR';         // I: DISPOSITIVO
        nuevaFila[9] = dateObj;                  // J: TIMESTAMP
        nuevaFila[10] = diaSemana;               // K: DIA
        nuevaFila[11] = 'OFICINA';               // L: MODO / UBICACION
        nuevaFila[12] = 'NO';                    // M: HORAS_EXTRA
        nuevaFila[13] = '';                      // N: AUTORIZA
        nuevaFila[14] = 'No registró salida';    // O: RAZON_SALIDA_TEMPRANA
        nuevaFila[15] = 'SISTEMA';               // P: QUIEN_JUSTIFICA
        nuevaFila[16] = '';                      // Q: RAZON_ENTRADA_TARDIA
        nuevaFila[17] = '';                      // R: QUIEN_JUSTIFICA_ENTRADA
        nuevaFila[18] = '';                      // S: TIPO_SALIDA
        nuevaFila[19] = '';                      // T: RAZON_PERMISO
        nuevaFila[20] = 'NO';                    // U: JUSTIFICADO
        nuevaFila[21] = 'No registró salida';    // V: RAZON_JUSTIFICAC
        nuevaFila[22] = '';                      // W: PERMISO_PERSONAL_MINS
        nuevaFila[23] = '';                      // X: PERMISO_MEDICO_MINS
        
        filasAInsertar.push(nuevaFila);
      }
    });
  });
  
  // PASO 6: Inserción de registros en lote (Batch Write)
  if (filasAInsertar.length > 0) {
    const startRow = sheetRegs.getLastRow() + 1;
    sheetRegs.getRange(startRow, 1, filasAInsertar.length, 24).setValues(filasAInsertar);
    console.log(`✅ [Auto-completar] Proceso finalizado con éxito. Se insertaron ${filasAInsertar.length} registros de salida automáticamente en bloque.`);
  } else {
    console.log("✅ [Auto-completar] No se detectaron salidas pendientes por insertar en los últimos 7 días.");
  }
}
