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

  // 2. Cargar hoja EMPLEADOS y filtrar los empleados activos (excluyendo cargo "SIN ASISTENCIA")
  const sheetEmp = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("EMPLEADOS");
  if (!sheetEmp) {
    console.error("❌ Hoja EMPLEADOS no encontrada");
    return;
  }
  
  const empsData = sheetEmp.getDataRange().getValues();
  const empleadosActivos = [];
  
  // Mapeo manual de columnas de empleados por seguridad
  const colId = 0;       // A (ID)
  const colNombre = 1;   // B (Nombre)
  const colActivo = 3;   // D (Activo)
  const colCargo = 13;   // N (Cargo)
  
  for (let i = 1; i < empsData.length; i++) {
    const fila = empsData[i];
    const id = String(fila[colId] || '').trim();
    const nombre = String(fila[colNombre] || '').trim();
    const activo = String(fila[colActivo] || '').trim().toUpperCase() === 'SI';
    const cargo = String(fila[colCargo] || '').trim().toUpperCase();
    
    if (id && activo && cargo !== 'SIN ASISTENCIA') {
      empleadosActivos.push({ id: id, nombre: nombre });
    }
  }
  
  console.log(`🤖 [Auto-completar] Total de empleados activos a verificar: ${empleadosActivos.length}`);

  // 3. Cargar hoja REGISTROS y mapear marcaciones existentes de Entrada/Salida para las fechas seleccionadas
  const sheetRegs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("REGISTROS");
  if (!sheetRegs) {
    console.error("❌ Hoja REGISTROS no encontrada");
    return;
  }
  
  const regsData = sheetRegs.getDataRange().getValues();
  const mapaRegs = {};
  
  // Mapeo manual de columnas de registros por seguridad
  const colRegFecha = 0; // A (Fecha)
  const colRegId = 1;    // B (ID)
  const colRegTipo = 3;  // D (Tipo)
  
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
      const empId = String(fila[colRegId] || '').trim();
      const tipo = String(fila[colRegTipo] || '').trim().toUpperCase();
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

  // 4. Evaluar inasistencias de salida e insertar los registros faltantes
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  let creados = 0;
  
  empleadosActivos.forEach(emp => {
    fechasAProcesar.forEach(fecha => {
      const key = `${emp.id}_${fecha}`;
      const regs = mapaRegs[key] || { ENTRADA: false, SALIDA: false };
      
      // Si registró entrada pero no salida, autocompletar
      if (regs.ENTRADA && !regs.SALIDA) {
        console.log(`⚠️ [FALTA DE SALIDA DETECTADA] Empleado: ${emp.nombre} (${emp.id}) el día ${fecha}. Generando salida automática...`);
        
        const nuevaFila = new Array(24).fill('');
        
        const [yStr, mStr, dStr] = fecha.split('-');
        const dateObj = new Date(parseInt(yStr), parseInt(mStr) - 1, parseInt(dStr), 16, 15, 0);
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
        
        sheetRegs.appendRow(nuevaFila);
        creados++;
      }
    });
  });
  
  console.log(`🤖 [Auto-completar] Proceso finalizado. Total de salidas registradas automáticamente: ${creados}`);
}
