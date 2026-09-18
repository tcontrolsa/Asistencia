/**
 * Función que busca de forma automática las marcaciones de salida faltantes en los últimos 7 días
 * e inserta un registro de SALIDA a las 16:15:00 con la justificación "No registró salida".
 * 
 * Se puede ejecutar manualmente o configurar como un activador por tiempo (Time-driven trigger)
 * en la consola de Google Apps Script para que se ejecute diariamente de forma automática (ej. a las 23:00).
 */
function autoCompletarSalidasFaltantesSheets() {
  const tz = Session.getScriptTimeZone();
  const hoy = new Date();
  const hoyStr = Utilities.formatDate(hoy, tz, 'yyyy-MM-dd');
  
  // 1. Obtener la lista de los últimos 7 días (excluyendo hoy para evitar cerrar turnos activos)
  const fechasAProcesar = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const fStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    fechasAProcesar.push(fStr);
  }
  
  console.log("🤖 [Auto-completar] Rango de fechas a analizar (últimos 7 días):", fechasAProcesar);

  // 2. Cargar hoja EMPLEADOS asegurando leer TODAS las filas reales de la hoja
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  
  // Leer todas las filas hasta la última fila física real (garantiza superar límites de getDataRange)
  const empsData = sheetEmp.getRange(1, 1, lastRowEmp, lastColEmp).getValues();
  
  // Detección dinámica de cabeceras para máxima compatibilidad
  const headersEmp = (empsData[0] || []).map(h => String(h || '').trim().toUpperCase());
  let colId = headersEmp.findIndex(h => h === 'ID' || h === 'CEDULA' || h === 'CÉDULA' || h.includes('IDENTIFICAC'));
  if (colId === -1) colId = 0; // Fallback Col A
  
  let colNombre = headersEmp.findIndex(h => h === 'NOMBRE' || h.includes('EMPLEADO') || h.includes('NOMBRE COMPLETO'));
  if (colNombre === -1) colNombre = 1; // Fallback Col B

  let colActivo = headersEmp.findIndex(h => h === 'ACTIVO' || h === 'ESTADO');
  if (colActivo === -1) colActivo = 3; // Fallback Col D

  let colCargo = headersEmp.findIndex(h => h === 'CARGO' || h === 'PUESTO' || h === 'ROL');
  if (colCargo === -1) colCargo = 13; // Fallback Col N
  
  console.log(`📋 [Auto-completar] Mapeo de columnas EMPLEADOS: ID=[${colId}], Nombre=[${colNombre}], Activo=[${colActivo}], Cargo=[${colCargo}]. Total filas leídas: ${lastRowEmp - 1}`);

  // Helper flexible para validar si un empleado está activo (acepta booleanos, textos 'SI', 'TRUE', '1', o celda vacía por defecto)
  function esEmpleadoValidoActivo(valorActivo) {
    if (valorActivo === null || valorActivo === undefined || String(valorActivo).trim() === '') {
      return true; // Por defecto activo si la celda no tiene marca explícita de inactividad
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
      continue; // Saltar filas completamente vacías o sin ID/Nombre
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

  // 3. Cargar hoja REGISTROS y mapear marcaciones existentes de Entrada/Salida para las fechas seleccionadas
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
  
  // Mapeo dinámico de columnas de registros
  const headersRegs = (regsData[0] || []).map(h => String(h || '').trim().toUpperCase());
  let colRegFecha = headersRegs.findIndex(h => h === 'FECHA');
  if (colRegFecha === -1) colRegFecha = 0; // A
  let colRegId = headersRegs.findIndex(h => h === 'ID' || h === 'CEDULA' || h === 'CÉDULA');
  if (colRegId === -1) colRegId = 1; // B
  let colRegTipo = headersRegs.findIndex(h => h === 'TIPO');
  if (colRegTipo === -1) colRegTipo = 3; // D
  
  for (let i = 1; i < regsData.length; i++) {
    const fila = regsData[i];
    let fechaFila = fila[colRegFecha];
    let fStr = '';
    
    if (fechaFila instanceof Date) {
      fStr = Utilities.formatDate(fechaFila, tz, 'yyyy-MM-dd');
    } else if (fechaFila) {
      fStr = String(fechaFila).trim();
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

  // 4. Evaluar inasistencias de salida y preparar lote de inserción
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const filasAInsertar = [];
  
  empleadosActivos.forEach(emp => {
    fechasAProcesar.forEach(fecha => {
      const key = `${emp.id}_${fecha}`;
      const regs = mapaRegs[key] || { ENTRADA: false, SALIDA: false };
      
      // Si registró entrada pero no salida, autocompletar
      if (regs.ENTRADA && !regs.SALIDA) {
        console.log(`⚠️ [FALTA DE SALIDA DETECTADA] Empleado: ${emp.nombre} (${emp.id}) el día ${fecha}. Generando salida automática...`);
        
        const nuevaFila = new Array(24).fill('');
        
        const [yStr, mStr, dStr] = fecha.split('-');
        const dateObj = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10), 16, 15, 0);
        const diaSemana = diasSemana[dateObj.getDay()];
        
        // Rellenar arreglo de fila según la estructura oficial (A-X)
        nuevaFila[0] = fecha;                    // A: FECHA
        nuevaFila[1] = emp.id;                   // B: ID
        nuevaFila[2] = emp.nombre;               // C: NOMBRE
        nuevaFila[3] = 'SALIDA';                 // D: TIPO
        nuevaFila[4] = 'NO';                     // E: ALMUERZO
        nuevaFila[5] = '16:15:00';               // F: HORA
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
  
  // 5. Inserción de registros en lote (Batch Write) para evitar cuotas/tiempos de espera de Google Apps Script
  if (filasAInsertar.length > 0) {
    const startRow = sheetRegs.getLastRow() + 1;
    sheetRegs.getRange(startRow, 1, filasAInsertar.length, 24).setValues(filasAInsertar);
    console.log(`✅ [Auto-completar] Proceso finalizado con éxito. Se insertaron ${filasAInsertar.length} registros de salida automáticamente en bloque.`);
  } else {
    console.log("✅ [Auto-completar] No se detectaron salidas pendientes en los últimos 7 días.");
  }
}
