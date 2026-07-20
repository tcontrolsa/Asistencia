/**
 * TCONTROL ASISTENCIA - ARCHIVADOR DIARIO AUTOMÁTICO
 * 
 * Este script se ejecuta en segundo plano en Google Apps Script.
 * Busca registros en Firestore que tengan más de 60 días de antigüedad,
 * los descarga, los clasifica en las hojas de cálculo correspondientes
 * (REGISTROS y VACACIONES) y finalmente los elimina de Firestore.
 */

// =================== CONFIGURACIÓN ===================
const FIRESTORE_PROJECT_ID = "tcontrol-asistencia";
const DIAS_A_MANTENER = 60;

// Nombres de las hojas de cálculo destino
const HOJA_REGISTROS_NAME = "REGISTROS";
const HOJA_VACACIONES_NAME = "VACACIONES";

// Encabezados oficiales de 24 columnas
const ENCABEZADOS_OFICIALES = [
  'FECHA', 'ID', 'NOMBRE', 'TIPO', 'ALMUERZO', 'HORA', 'LAT', 'LNG', 'DISPOSITIVO', 'TIMESTAMP', 
  'DIA', 'MODO', 'HORAS_EXTRA', 'AUTORIZA', 'RAZON_SALIDA_TEMPRANA', 'QUIEN_JUSTIFICA', 
  'RAZON_ENTRADA_TARDIA', 'QUIEN_JUSTIFICA_ENTRADA', 'TIPO_SALIDA', 'RAZON_PERMISO', 
  'JUSTIFICADO', 'RAZON_JUSTIFICAC', 'PERMISO_PERSONAL_MINS', 'PERMISO_MEDICO_MINS', 'TIEMPO_JUSTIFICADO_MINS'
];

/**
 * Función principal que realiza el archivado de datos antiguos.
 * Programada para ejecutarse automáticamente.
 */
function ejecutarArchivadoDiario() {
  console.log("=== INICIANDO ARCHIVADO AUTOMÁTICO DIARIO DE FIRESTORE ===");
  
  // 1. Calcular límite de fecha de corte (cualquier registro anterior a la fecha actual/hoy)
  const limite = new Date();
  limite.setHours(0, 0, 0, 0); // Hoy a las 00:00:00 local
  const limitDateNormalized = limite.getTime();
  console.log("Fecha límite de corte (hoy a las 00:00:00): " + limite.toString() + " (Normalized: " + limitDateNormalized + ")");

  // 2. Descargar TODOS los registros de Firestore recursivamente usando paginación
  const documentos = obtenerTodosLosRegistrosFirestore();
  console.log("Total registros descargados desde Firestore: " + documentos.length);
  
  if (documentos.length === 0) {
    console.log("No hay registros en Firestore por evaluar.");
    return;
  }

  // 3. Obtener u organizar las hojas de Sheets destino
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetRegs = ss.getSheetByName(HOJA_REGISTROS_NAME);
  if (!sheetRegs) {
    sheetRegs = ss.insertSheet(HOJA_REGISTROS_NAME);
    sheetRegs.appendRow(ENCABEZADOS_OFICIALES);
    sheetRegs.getRange(1, 1, 1, ENCABEZADOS_OFICIALES.length).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
  }

  let sheetVacs = ss.getSheetByName(HOJA_VACACIONES_NAME);
  if (!sheetVacs) {
    sheetVacs = ss.insertSheet(HOJA_VACACIONES_NAME);
    sheetVacs.appendRow(ENCABEZADOS_OFICIALES);
    sheetVacs.getRange(1, 1, 1, ENCABEZADOS_OFICIALES.length).setFontWeight("bold").setBackground("#10b981").setFontColor("#ffffff");
  }

  const filasRegs = [];
  const filasVacs = [];
  const docNamesToDelete = [];

  // 4. Evaluar y filtrar los registros que son más antiguos que el corte de 60 días
  documentos.forEach(function(doc) {
    const fields = parseFirestoreFields(doc.fields);
    
    // Parsear fecha de forma robusta
    const parsedDate = parsearFechaDocumento(fields.fecha, fields.timestamp);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      console.log("Eval-Log: ID=" + (fields.empleadoId || 'S/ID') + " | FechaDoc=" + (fields.fecha || 'S/F') + " | FALLÓ AL PARSEAR FECHA");
      return; // Omitir si no se puede determinar la fecha
    }

    const docDateNormalized = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime();

    console.log("Eval-Log: ID=" + (fields.empleadoId || 'S/ID') + " | FechaDoc=" + (fields.fecha || 'S/F') + " | Parseada=" + parsedDate.getFullYear() + "-" + (parsedDate.getMonth()+1) + "-" + parsedDate.getDate() + " | Registro: " + docDateNormalized + " | Límite: " + limitDateNormalized + " | ¿Archivar?: " + (docDateNormalized < limitDateNormalized ? "SÍ" : "NO"));

    // Solo archivar si es anterior a los 60 días límite
    if (docDateNormalized < limitDateNormalized) {
      const docPathName = doc.name; // Ej: "projects/tcontrol-asistencia/databases/(default)/documents/registros/DOC_ID"
      docNamesToDelete.push(docPathName);

      // Formatear fecha a DD-MM-YYYY
      let r_fecha = fields.fecha || '';
      if (r_fecha && r_fecha.indexOf('-') === 4) {
        const parts = r_fecha.split('-');
        r_fecha = parts[2] + '-' + parts[1] + '-' + parts[0];
      } else if (parsedDate) {
        const day = String(parsedDate.getDate()).padStart(2, '0');
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const year = parsedDate.getFullYear();
        r_fecha = day + '-' + month + '-' + year;
      }

      // Formatear timestamp
      let r_timestamp = fields.timestamp || '';
      if (r_timestamp) {
        r_timestamp = formatearTimestamp(r_timestamp);
      }

      const r_id = fields.empleadoId || '';
      const r_nombre = fields.nombre || '';
      const r_tipo = fields.tipo || '';
      const r_almuerzo = fields.almuerzo || '';
      const r_hora = fields.hora || '';
      const r_lat = fields.lat || '';
      const r_lng = fields.lng || '';
      const r_dispositivo = fields.dispositivo || '';
      const r_dia = fields.dia || '';
      const r_modo = fields.modo || '';
      const r_horasExtra = fields.horasExtra || '';
      const r_autoriza = fields.autoriza || '';
      const r_razonSalidaTemprana = fields.razon_salida_temprana || fields.razonSalidaTemprana || fields.razon_salida || '';
      const r_quienJustifica = fields.quien_justifica || fields.quienJustifica || '';
      const r_razonEntradaTardia = fields.razon_entrada_tardia || fields.razonEntradaTardia || '';
      const r_quienJustificaEntrada = fields.quien_justifica_entrada || fields.quienJustificaEntrada || '';
      const r_tipoSalida = fields.tipo_salida || fields.tipoSalida || '';
      const r_razonPermiso = fields.razon_permiso || fields.razonPermiso || '';
      const r_justificado = fields.justificado || '';
      const r_razonJustificac = fields.razon_justificac || fields.razon_ausencia || '';
      const r_permisoPersonalMins = fields.permiso_personal_mins || 0;
      const r_permisoMedicoMins = fields.permiso_medico_mins || 0;

      const esVacaciones = (String(r_tipo).toUpperCase() === 'VACACIONES' || String(r_tipo).toUpperCase() === 'VACACION');

      if (esVacaciones) {
        // Rellenar únicamente FECHA, ID, TIPO, TIMESTAMP
        const rowVac = [
          r_fecha, r_id, '', r_tipo, '', '', '', '', '', r_timestamp,
          '', '', '', '', '', '', '', '', '', '', '', '', '', ''
        ];
        filasVacs.push(rowVac);
      } else {
        const rowReg = [
          r_fecha, r_id, r_nombre, r_tipo, r_almuerzo, r_hora, r_lat, r_lng, r_dispositivo, r_timestamp,
          r_dia, r_modo, r_horasExtra, r_autoriza, r_razonSalidaTemprana, r_quienJustifica,
          r_razonEntradaTardia, r_quienJustificaEntrada, r_tipoSalida, r_razonPermiso,
          r_justificado, r_razonJustificac, r_permisoPersonalMins, r_permisoMedicoMins
        ];
        filasRegs.push(rowReg);
      }
    }
  });

  console.log("Registros antiguos filtrados para archivar: " + docNamesToDelete.length);
  if (docNamesToDelete.length === 0) {
    console.log("No hay registros que cumplan con la antigüedad de 60 días para ser archivados hoy.");
    return;
  }

  // 5. Guardar en Sheets
  if (filasRegs.length > 0) {
    sheetRegs.getRange(sheetRegs.getLastRow() + 1, 1, filasRegs.length, filasRegs[0].length).setValues(filasRegs);
    console.log("Guardados " + filasRegs.length + " registros de asistencia en la hoja 'REGISTROS'.");
  }
  if (filasVacs.length > 0) {
    sheetVacs.getRange(sheetVacs.getLastRow() + 1, 1, filasVacs.length, filasVacs[0].length).setValues(filasVacs);
    console.log("Guardados " + filasVacs.length + " registros de vacaciones en la hoja 'VACACIONES'.");
  }

  // 6. Eliminar en lotes desde Firestore REST API
  const batchSize = 100;
  const commitUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents:commit";
  
  for (let j = 0; j < docNamesToDelete.length; j += batchSize) {
    const chunk = docNamesToDelete.slice(j, j + batchSize);
    const writes = chunk.map(function(pathName) {
      return { "delete": pathName };
    });

    const commitPayload = { "writes": writes };
    const commitOptions = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(commitPayload),
      "muteHttpExceptions": true
    };

    let deleteRes;
    try {
      deleteRes = UrlFetchApp.fetch(commitUrl, commitOptions);
      if (deleteRes.getResponseCode() === 200) {
        console.log("Lote de eliminación " + (Math.floor(j / batchSize) + 1) + " completado (" + chunk.length + " eliminados de Firebase).");
      } else {
        console.warn("Fallo al eliminar lote en Firebase: " + deleteRes.getContentText());
      }
    } catch(err) {
      console.warn("Error en la petición de red para eliminar lote: " + err.toString());
    }
  }

  console.log("=== PROCESO DE ARCHIVADO DIARIO AUTOMÁTICO FINALIZADO ===");
}

/**
 * Descarga todos los registros de la colección recursivamente resolviendo la paginación
 */
function obtenerTodosLosRegistrosFirestore() {
  const documentos = [];
  let pageToken = "";
  const baseUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/registros?pageSize=300";
  
  do {
    let url = baseUrl;
    if (pageToken) {
      url += "&pageToken=" + pageToken;
    }
    
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      console.error("Error al listar documentos de Firestore: " + response.getContentText());
      break;
    }
    
    const data = JSON.parse(response.getContentText());
    if (data.documents && data.documents.length > 0) {
      documentos.push.apply(documentos, data.documents);
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  
  return documentos;
}

/**
 * Función para instalar el activador de tiempo automático diario a las 20:00.
 * Ejecuta esta función manualmente una sola vez en la consola de Google Apps Script.
 */
function instalarTriggerDiario() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ejecutarArchivadoDiario') {
      ScriptApp.deleteTrigger(triggers[i]);
      console.log("Activador anterior borrado.");
    }
  }

  ScriptApp.newTrigger('ejecutarArchivadoDiario')
    .timeBased()
    .everyDays(1)
    .atHour(20) // Programado a las 20:00 (se ejecuta en la ventana de 20:00 a 21:00)
    .create();

  console.log("✅ Activador diario instalado con éxito para ejecutarse a las 20:00.");
}

// =================== FUNCIONES AUXILIARES ===================

/**
 * Parsea la estructura de campos de Firestore a un formato simple de objeto JS
 */
function parseFirestoreFields(fields) {
  const result = {};
  if (!fields) return result;
  for (const key in fields) {
    const valueObj = fields[key];
    const type = Object.keys(valueObj)[0];
    let val = valueObj[type];
    if (type === 'integerValue') {
      val = parseInt(val, 10);
    } else if (type === 'doubleValue') {
      val = parseFloat(val);
    } else if (type === 'booleanValue') {
      val = !!val;
    } else if (type === 'timestampValue') {
      val = val;
    }
    result[key] = val;
  }
  return result;
}

/**
 * Formatea un string de fecha ISO 8601 a formato legible DD-MM-YYYY HH:mm:ss
 */
function formatearTimestamp(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  
  return day + '-' + month + '-' + year + ' ' + hh + ':' + mm + ':' + ss;
}

/**
 * Parseador robusto de fecha de registros de asistencia
 */
function parsearFechaDocumento(docFecha, timestampVal) {
  let parsedDate = null;

  if (!docFecha && timestampVal) {
    parsedDate = new Date(timestampVal);
  }

  if (!docFecha) return parsedDate;

  // Si es un Timestamp de Firebase (objeto con seconds)
  if (docFecha && docFecha.seconds) {
    parsedDate = new Date(docFecha.seconds * 1000);
  } else if (docFecha instanceof Date) {
    parsedDate = docFecha;
  } else {
    let docFechaStr = String(docFecha).trim();
    const matchDMY = docFechaStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (matchDMY) {
      const d = parseInt(matchDMY[1], 10);
      const m = parseInt(matchDMY[2], 10);
      const y = parseInt(matchDMY[3], 10);
      parsedDate = new Date(y, m - 1, d);
    } else {
      const matchYMD = docFechaStr.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
      if (matchYMD) {
        const y = parseInt(matchYMD[1], 10);
        const m = parseInt(matchYMD[2], 10);
        const d = parseInt(matchYMD[3], 10);
        parsedDate = new Date(y, m - 1, d);
      } else {
        parsedDate = new Date(docFechaStr);
      }
    }
  }
  return parsedDate;
}
