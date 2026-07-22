/**
 * Script de Mantenimiento de Registros de Asistencia
 * 
 * Funciones incluidas:
 * 1. completarCamposVacios() - Escanea REGISTROS y VACACIONES completando las celdas vacías en DIA (Col K) y NOMBRE (Col C).
 * 2. subrayarDuplicados() - Subraya los registros con combinación duplicada de Fecha (Col A), ID (Col B) y Tipo (Col D).
 * 3. verificarConflictosVacaciones() - Informa si hay fechas coincidentes para un empleado en REGISTROS y VACACIONES.
 * 4. crearHojaReporte() - Vuelca los resultados del mantenimiento en la hoja "REPORTE_MANTENIMIENTO" con un formato profesional.
 * 5. ejecutarMantenimiento() - Ejecuta secuencialmente todas las acciones anteriores y muestra un reporte.
 */

// Mapeo oficial de columnas de REGISTROS y VACACIONES (0-based)
const COL_REGISTROS = {
  FECHA: 0,       // A
  ID: 1,          // B
  NOMBRE: 2,      // C
  TIPO: 3,        // D
  TIMESTAMP: 9,   // J
  DIA: 10         // K
};

// Variable global para acumular los logs del mantenimiento
let logsMantenimiento = [];

/**
 * Formatea cualquier valor de fecha (Date, string ISO, string de texto) a 'yyyy-MM-dd'.
 * Necesario porque Google Sheets puede retornar objetos Date con zona horaria diferente.
 */
function formatearFechaLog(val) {
  if (!val) return '';
  // Si es un objeto Date (lo que retorna Sheets para celdas de tipo fecha)
  if (Object.prototype.toString.call(val) === '[object Date]') {
    try {
      return Utilities.formatDate(val, 'America/Guayaquil', 'dd/MM/yyyy');
    } catch (e) {
      // Fallback manual si la zona horaria falla
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${d}/${m}/${y}`;
    }
  }
  const s = String(val).trim();
  // Si ya tiene formato dd/MM/yyyy, devolver directamente
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // Si tiene formato YYYY-MM-DD, convertir
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  // Si es una fecha de texto como "Wed Jul 15 2026 00:00:00 GMT...", parsear
  try {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, 'America/Guayaquil', 'dd/MM/yyyy');
    }
  } catch (e) {}
  return s;
}

/**
 * 1. Escanea las hojas REGISTROS y VACACIONES completando las celdas vacías en DIA (Col K) y NOMBRE (Col C)
 */
function completarCamposVacios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // A. Cargar mapeo de empleados (ID -> NOMBRE) desde la hoja EMPLEADOS
  const sheetEmp = ss.getSheetByName('EMPLEADOS');
  const empMap = {};
  if (sheetEmp) {
    const empData = sheetEmp.getDataRange().getValues();
    for (let i = 1; i < empData.length; i++) {
      const id = String(empData[i][0] || '').trim();
      const nombre = String(empData[i][1] || '').trim();
      if (id && nombre) {
        empMap[id] = nombre;
      }
    }
    Logger.log(`ℹ️ Se cargaron ${Object.keys(empMap).length} empleados registrados para referencias.`);
  } else {
    Logger.log("⚠️ No se encontró la hoja EMPLEADOS. No se completarán nombres vacíos.");
  }

  // B. Procesar ambas hojas
  procesarHojaVacias('REGISTROS', empMap);
  procesarHojaVacias('VACACIONES', empMap);
}

/**
 * Función interna para completar DIA y NOMBRE en una hoja específica
 */
function procesarHojaVacias(sheetName, empMap) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(`❌ Hoja ${sheetName} no encontrada.`);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log(`ℹ️ Hoja ${sheetName} vacía o sin registros para procesar.`);
    return;
  }

  // Obtener rangos para lectura y escritura en bloque
  const rangeFecha = sheet.getRange(2, 1, lastRow - 1, 1);
  const rangeId = sheet.getRange(2, 2, lastRow - 1, 1);
  const rangeNombre = sheet.getRange(2, 3, lastRow - 1, 1);
  const rangeDia = sheet.getRange(2, 11, lastRow - 1, 1);

  const fechas = rangeFecha.getValues();
  const ids = rangeId.getValues();
  const nombres = rangeNombre.getValues();
  const dias = rangeDia.getValues();

  let completadosDia = 0;
  let completadosNombre = 0;

  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

  for (let i = 0; i < fechas.length; i++) {
    const rowNum = i + 2;
    const fechaVal = fechas[i][0];
    const idVal = String(ids[i][0] || '').trim();
    const nombreVal = String(nombres[i][0] || '').trim();
    const diaVal = String(dias[i][0] || '').trim();

    // 1. Validar y completar DIA (Columna K) si está vacío
    if (diaVal === '') {
      let dateObj = null;
      if (fechaVal instanceof Date) {
        dateObj = fechaVal;
      } else if (fechaVal) {
        const partes = String(fechaVal).trim().split('-');
        if (partes.length === 3) {
          dateObj = new Date(partes[0], partes[1] - 1, partes[2], 12, 0, 0);
        }
      }

      if (dateObj && !isNaN(dateObj.getTime())) {
        const diaSemanaNombre = diasSemana[dateObj.getDay()];
        dias[i][0] = diaSemanaNombre;
        completadosDia++;
        
        logsMantenimiento.push({
          tipo: "COMPLETADO",
          hoja: sheetName,
          fila: rowNum,
          id: idVal,
          nombre: nombreVal || empMap[idVal] || "Desconocido",
          fecha: formatearFechaLog(fechaVal),
          detalle: `Columna K (DIA) vacía completada con "${diaSemanaNombre}".`
        });
      }
    }

    // 2. Validar y completar NOMBRE (Columna C) si está vacío
    if (nombreVal === '') {
      if (idVal !== '') {
        const nombreEmpleado = empMap[idVal];
        if (nombreEmpleado) {
          nombres[i][0] = nombreEmpleado;
          completadosNombre++;
          
          logsMantenimiento.push({
            tipo: "COMPLETADO",
            hoja: sheetName,
            fila: rowNum,
            id: idVal,
            nombre: nombreEmpleado,
            fecha: formatearFechaLog(fechaVal),
            detalle: `Columna C (NOMBRE) vacía completada desde catálogo EMPLEADOS.`
          });
        }
      }
    }
  }

  // Guardar cambios si los hay
  if (completadosDia > 0) {
    rangeDia.setValues(dias);
  }
  if (completadosNombre > 0) {
    rangeNombre.setValues(nombres);
  }

  Logger.log(`📊 [Resumen ${sheetName}] DIA completados: ${completadosDia} | NOMBRE completados: ${completadosNombre}`);
}

/**
 * 2. Subraya registros duplicados filtrando por Fecha (Col A), ID (Col B) y Tipo (Col D)
 */
function subrayarDuplicados() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REGISTROS');
  if (!sheet) {
    Logger.log("❌ Hoja REGISTROS no encontrada.");
    return;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return;

  // Limpiar subrayados anteriores en el rango de datos de forma preventiva
  const fullDataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
  fullDataRange.setFontLine(null);

  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(COL_REGISTROS.TIPO + 1, 6)).getValues();
  const seen = {};
  const filasASubrayar = new Set();

  for (let i = 0; i < values.length; i++) {
    const rowNum = i + 2; // Índice en la hoja de cálculo
    const fechaRaw = values[i][COL_REGISTROS.FECHA];
    const fecha = String(fechaRaw).trim();              // Para clave de duplicados
    const fechaFmt = formatearFechaLog(fechaRaw);       // Para mostrar en reporte
    const id = String(values[i][COL_REGISTROS.ID]).trim();
    const tipo = String(values[i][COL_REGISTROS.TIPO]).trim().toUpperCase();
    const nombre = String(values[i][COL_REGISTROS.NOMBRE] || '').trim();

    if (!fecha || !id) continue;

    // Clave compuesta de duplicados
    const key = `${fecha}_${id}_${tipo}`;

    if (seen[key]) {
      filasASubrayar.add(rowNum);
      
      logsMantenimiento.push({
        tipo: "DUPLICADO",
        hoja: "REGISTROS",
        fila: rowNum,
        id: id,
        nombre: nombre,
        fecha: fechaFmt,
        detalle: `Registro duplicado detectado (mismo Fecha/ID/Tipo). Fila subrayada.`
      });

      if (seen[key] !== true) {
        filasASubrayar.add(seen[key]); // También subrayamos la primera ocurrencia
        const firstIdx = seen[key] - 2;
        const firstNombre = String(values[firstIdx][COL_REGISTROS.NOMBRE] || '').trim();
        
        logsMantenimiento.push({
          tipo: "DUPLICADO",
          hoja: "REGISTROS",
          fila: seen[key],
          id: id,
          nombre: firstNombre,
          fecha: fechaFmt,
          detalle: `Registro duplicado original detectado (mismo Fecha/ID/Tipo). Fila subrayada.`
        });
        seen[key] = true;
      }
    } else {
      seen[key] = rowNum;
    }
  }

  if (filasASubrayar.size > 0) {
    filasASubrayar.forEach(row => {
      sheet.getRange(row, 1, 1, lastCol).setFontLine('underline');
    });
    Logger.log(`⚠️ Se detectaron y subrayaron ${filasASubrayar.size} filas que corresponden a registros duplicados.`);
  } else {
    Logger.log("✅ No se encontraron registros duplicados de Fecha, ID y Tipo.");
  }
}

/**
 * 2b. Elimina las filas duplicadas de la hoja REGISTROS,
 *     conservando solo la primera ocurrencia de cada combinación Fecha + ID + Tipo.
 *     Las filas se eliminan de abajo hacia arriba para no afectar los índices.
 */
function eliminarDuplicados() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REGISTROS');
  if (!sheet) {
    Logger.log('❌ Hoja REGISTROS no encontrada.');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(COL_REGISTROS.TIPO + 1, 6)).getValues();
  const seen = {};
  const filasAEliminar = []; // se acumulan en orden ascendente

  for (let i = 0; i < values.length; i++) {
    const rowNum = i + 2;
    const fecha = String(values[i][COL_REGISTROS.FECHA]).trim();
    const id    = String(values[i][COL_REGISTROS.ID]).trim();
    const tipo  = String(values[i][COL_REGISTROS.TIPO]).trim().toUpperCase();

    if (!fecha || !id) continue;

    const key = `${fecha}_${id}_${tipo}`;

    if (seen[key]) {
      // Es duplicado: marcar para eliminar
      filasAEliminar.push(rowNum);

      logsMantenimiento.push({
        tipo: 'DUPLICADO',
        hoja: 'REGISTROS',
        fila: rowNum,
        id: id,
        nombre: String(values[i][COL_REGISTROS.NOMBRE] || '').trim(),
        fecha: formatearFechaLog(values[i][COL_REGISTROS.FECHA]),
        detalle: `Fila eliminada por ser duplicado (mismo Fecha/ID/Tipo). Se conservó la fila ${seen[key]}.`
      });
    } else {
      seen[key] = rowNum; // Primera ocurrencia: conservar
    }
  }

  if (filasAEliminar.length === 0) {
    Logger.log('✅ No se encontraron filas duplicadas para eliminar.');
    return;
  }

  // Eliminar de abajo hacia arriba para que los índices no se desplacen
  filasAEliminar.reverse().forEach(row => sheet.deleteRow(row));

  Logger.log(`🗑️ Se eliminaron ${filasAEliminar.length} filas duplicadas de REGISTROS.`);
}

/**
 * 3. Compara hojas REGISTROS y VACACIONES para indicar fechas coincidentes (conflictos)
 */
function verificarConflictosVacaciones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetRegs = ss.getSheetByName('REGISTROS');
  const sheetVacs = ss.getSheetByName('VACACIONES');

  if (!sheetRegs || !sheetVacs) {
    Logger.log("❌ No se encontró la hoja REGISTROS o la hoja VACACIONES.");
    return;
  }

  const regsValues = sheetRegs.getDataRange().getValues();
  const vacsValues = sheetVacs.getDataRange().getValues();

  const regsMap = {};
  // Mapear marcaciones reales que no sean inasistencias justificadas o vacaciones
  for (let i = 1; i < regsValues.length; i++) {
    const fechaRaw = regsValues[i][COL_REGISTROS.FECHA];
    const fecha = String(fechaRaw).trim();   // Para clave del mapa
    const id = String(regsValues[i][COL_REGISTROS.ID]).trim();
    const nombre = String(regsValues[i][COL_REGISTROS.NOMBRE]).trim();
    const tipo = String(regsValues[i][COL_REGISTROS.TIPO]).trim().toUpperCase();

    if (!fecha || !id) continue;

    // Si el tipo ya es vacaciones o vacación, es normal tener el registro
    if (['VACACIONES', 'VACACION'].includes(tipo)) continue;

    const key = `${fecha}_${id}`;
    regsMap[key] = { nombre: nombre, tipo: tipo, fila: i + 1 };
  }

  const conflictos = [];
  for (let j = 1; j < vacsValues.length; j++) {
    const vFechaRaw = vacsValues[j][0];
    const vFecha = String(vFechaRaw).trim();    // Para clave del mapa
    const vFechaFmt = formatearFechaLog(vFechaRaw); // Para mostrar en reporte
    const vId = String(vacsValues[j][1]).trim();
    const vNombre = String(vacsValues[j][2]).trim();

    if (!vFecha || !vId) continue;

    const key = `${vFecha}_${vId}`;
    if (regsMap[key]) {
      const cObj = {
        id: vId,
        nombre: vNombre || regsMap[key].nombre,
        fecha: vFechaFmt,
        filaReg: regsMap[key].fila,
        tipoReg: regsMap[key].tipo,
        filaVac: j + 1
      };
      conflictos.push(cObj);

      logsMantenimiento.push({
        tipo: "CONFLICTO",
        hoja: "REGISTROS / VACACIONES",
        fila: `REG: ${cObj.filaReg} / VAC: ${cObj.filaVac}`,
        id: vId,
        nombre: cObj.nombre,
        fecha: vFecha,
        detalle: `Coincidencia de marcación activa (${cObj.tipoReg}) y vacaciones en fecha ${vFecha}.`
      });
    }
  }

  if (conflictos.length > 0) {
    let output = `⚠️ ALERTA: Se encontraron ${conflictos.length} fechas coincidentes entre marcaciones y vacaciones:\n`;
    conflictos.forEach(c => {
      output += `- Empleado: ${c.nombre} (ID: ${c.id}) | Fecha: ${c.fecha}\n`;
      output += `  * Marcación: ${c.tipoReg} en fila ${c.filaReg} de REGISTROS.\n`;
      output += `  * Vacación: Registro en fila ${c.filaVac} de VACACIONES.\n`;
    });
    Logger.log(output);
  } else {
    Logger.log("✅ No se detectaron discrepancias entre vacaciones y marcaciones de asistencia.");
  }
}

/**
 * 4. Vuelca los resultados del mantenimiento en la hoja "REPORTE_MANTENIMIENTO" con un formato profesional
 *    - Agrupa por ID de empleado
 *    - Ordena cada grupo por fecha de forma descendente
 */
function crearHojaReporte() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('REPORTE_MANTENIMIENTO');
  
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet('REPORTE_MANTENIMIENTO');
  }

  // Si no hay logs, crear un reporte vacío indicando que todo está limpio
  if (logsMantenimiento.length === 0) {
    sheet.getRange(1, 1, 1, 7).merge();
    sheet.getRange(1, 1)
         .setValue("REPORTE DE MANTENIMIENTO Y LIMPIEZA DE BASE DE DATOS")
         .setFontWeight("bold").setFontSize(13).setFontColor("#ffffff")
         .setBackground("#1e3a8a").setHorizontalAlignment("center");
    sheet.getRange(2, 1, 1, 7).merge();
    sheet.getRange(2, 1).setValue("Ejecutado el: " + new Date().toLocaleString())
         .setFontSize(10).setFontStyle("italic").setBackground("#f3f4f6").setHorizontalAlignment("center");
    sheet.getRange(4, 1, 1, 7).merge();
    sheet.getRange(4, 1).setValue("✅ No se encontraron celdas vacías, duplicados ni conflictos en el mantenimiento.")
         .setFontColor("green").setFontWeight("bold").setHorizontalAlignment("center");
    sheet.autoResizeColumn(1);
    return;
  }

  // -----------------------------------------------------------------------
  // A. ORDENAR: primero por ID (asc), luego por fecha extraída del detalle (desc)
  // -----------------------------------------------------------------------
  // Función auxiliar para ordenar por fecha del log (ya tenemos log.fecha directo)
  const ordenados = logsMantenimiento.slice().sort((a, b) => {
    // Primero: agrupar por ID (ascendente)
    const idCmp = String(a.id).localeCompare(String(b.id));
    if (idCmp !== 0) return idCmp;
    // Segundo: dentro del grupo, fecha descendente
    const fa = String(a.fecha || '');
    const fb = String(b.fecha || '');
    if (fa > fb) return -1;
    if (fa < fb) return 1;
    return 0;
  });

  // -----------------------------------------------------------------------
  // B. ENCABEZADO VISUAL
  // -----------------------------------------------------------------------
  // Fila 1: Título
  sheet.getRange(1, 1, 1, 7).merge();
  sheet.getRange(1, 1)
       .setValue("REPORTE DE MANTENIMIENTO Y LIMPIEZA DE BASE DE DATOS")
       .setFontWeight("bold").setFontSize(13).setFontColor("#ffffff")
       .setBackground("#1e3a8a").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 35);

  // Fila 2: Fecha de ejecución
  sheet.getRange(2, 1, 1, 7).merge();
  sheet.getRange(2, 1)
       .setValue("Ejecutado el: " + new Date().toLocaleString('es-EC', { timeZone: ss.getSpreadsheetTimeZone() }))
       .setFontSize(10).setFontStyle("italic").setFontColor("#4b5563")
       .setBackground("#f3f4f6").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);

  // Fila 3: Resumen rápido de totales por tipo
  const totalCompletados = ordenados.filter(l => l.tipo === 'COMPLETADO').length;
  const totalDuplicados  = ordenados.filter(l => l.tipo === 'DUPLICADO').length;
  const totalConflictos  = ordenados.filter(l => l.tipo === 'CONFLICTO').length;
  sheet.getRange(3, 1, 1, 7).merge();
  sheet.getRange(3, 1)
       .setValue(`Hallazgos: ${ordenados.length} total  |  ✅ Completados: ${totalCompletados}  |  ⚠️ Duplicados: ${totalDuplicados}  |  🔴 Conflictos: ${totalConflictos}`)
       .setFontSize(10).setFontWeight("bold").setFontColor("#1e3a8a")
       .setBackground("#dbeafe").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(3, 20);

  // Fila 4: Cabeceras de columna
  const headers = ["HALLAZGO / CATEGORÍA", "HOJA AFECTADA", "FILA(S)", "ID EMPLEADO", "NOMBRE", "FECHA", "DESCRIPCIÓN DE LA ACCIÓN / DETALLE"];
  sheet.getRange(4, 1, 1, 7)
       .setValues([headers])
       .setFontWeight("bold").setFontSize(10).setFontColor("#ffffff")
       .setBackground("#2563eb").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(4, 25);

  // -----------------------------------------------------------------------
  // C. RENDERIZAR FILAS AGRUPADAS POR ID
  // -----------------------------------------------------------------------
  let currentRow = 5;
  let lastId = null;
  let groupRowStart = null;
  let groupBgIndex = 0; // alterna el fondo del grupo entre dos tonos

  const GROUP_BG_A = "#f0f9ff"; // azul muy claro para grupos pares
  const GROUP_BG_B = "#fefce8"; // amarillo muy claro para grupos impares

  for (let i = 0; i < ordenados.length; i++) {
    const log = ordenados[i];
    const isNewId = log.id !== lastId;

    // Insertar fila de grupo (separador + identificador del empleado)
    if (isNewId) {
      // Cerrar el grupo anterior con un borde inferior visible
      if (groupRowStart !== null && currentRow > groupRowStart) {
        sheet.getRange(groupRowStart, 1, currentRow - groupRowStart, 7)
             .setBorder(null, null, true, null, null, null, "#93c5fd", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
      }

      // Fila de cabecera del grupo: ID + Nombre del empleado
      sheet.getRange(currentRow, 1, 1, 7).merge();
      const nombreGrupo = log.nombre || log.id || 'Sin identificar';
      sheet.getRange(currentRow, 1)
           .setValue(`👤  ${nombreGrupo}  (ID: ${log.id})`)
           .setFontWeight("bold").setFontSize(11).setFontColor("#1e3a8a")
           .setBackground("#bfdbfe").setHorizontalAlignment("left").setVerticalAlignment("middle");
      sheet.setRowHeight(currentRow, 26);
      currentRow++;

      lastId = log.id;
      groupRowStart = currentRow;
      groupBgIndex++;
    }

    // Fila de datos
    const rowValues = [log.tipo, log.hoja, log.fila, log.id, log.nombre, log.fecha || '', log.detalle];
    const rowRange = sheet.getRange(currentRow, 1, 1, 7);
    rowRange.setValues([rowValues]);
    rowRange.setFontSize(10).setVerticalAlignment("middle");
    rowRange.setBorder(true, true, true, true, true, true, "#e5e7eb", SpreadsheetApp.BorderStyle.SOLID);

    // Fondo alternante por grupo
    const bgRow = groupBgIndex % 2 === 0 ? GROUP_BG_A : GROUP_BG_B;
    rowRange.setBackground(bgRow);

    // Alineaciones
    sheet.getRange(currentRow, 1, 1, 4).setHorizontalAlignment("center"); // CATEGORÍA, HOJA, FILA, ID
    sheet.getRange(currentRow, 5, 1, 1).setHorizontalAlignment("left");   // NOMBRE
    sheet.getRange(currentRow, 6, 1, 1).setHorizontalAlignment("center"); // FECHA centrada
    sheet.getRange(currentRow, 7, 1, 1).setHorizontalAlignment("left");   // DESCRIPCIÓN

    // Color por categoría
    const cellTipo = sheet.getRange(currentRow, 1);
    if (log.tipo === 'COMPLETADO') {
      cellTipo.setFontColor("#15803d").setFontWeight("bold");
    } else if (log.tipo === 'DUPLICADO') {
      cellTipo.setFontColor("#b45309").setFontWeight("bold");
    } else if (log.tipo === 'CONFLICTO') {
      cellTipo.setFontColor("#b91c1c").setFontWeight("bold");
    }

    currentRow++;
  }

  // Borde inferior del último grupo
  if (groupRowStart !== null && currentRow > groupRowStart) {
    sheet.getRange(groupRowStart, 1, currentRow - groupRowStart, 7)
         .setBorder(null, null, true, null, null, null, "#93c5fd", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  // -----------------------------------------------------------------------
  // D. AJUSTES FINALES
  // -----------------------------------------------------------------------
  for (let c = 1; c <= 7; c++) {
    sheet.autoResizeColumn(c);
    const width = sheet.getColumnWidth(c);
    sheet.setColumnWidth(c, Math.max(width + 15, c === 7 ? 340 : 90));
  }

  // Congelar filas de título y cabecera
  sheet.setFrozenRows(4);

  Logger.log(`📋 Se ha creado la hoja 'REPORTE_MANTENIMIENTO' con ${ordenados.length} hallazgos agrupados por empleado.`);
}


/**
 * 5. Función de entrada principal para ejecutar todas las verificaciones
 */
function ejecutarMantenimiento() {
  Logger.log("⏱️ Iniciando proceso de mantenimiento de base de datos...");
  logsMantenimiento = [];
  
  Logger.log("\n--- PASO 1: Completando días de la semana vacíos (Columna K) y nombres vacíos (Columna C) ---");
  completarCamposVacios();

  Logger.log("\n--- PASO 2: Subrayando registros duplicados ---");
  subrayarDuplicados();

  Logger.log("\n--- PASO 2b: Eliminando registros duplicados ---");
  eliminarDuplicados();

  Logger.log("\n--- PASO 3: Verificando cruce de asistencia y vacaciones ---");
  verificarConflictosVacaciones();

  Logger.log("\n--- PASO 4: Generando hoja de reporte interactivo ---");
  crearHojaReporte();

  Logger.log("\n🏁 Proceso de mantenimiento finalizado con éxito.");
}
