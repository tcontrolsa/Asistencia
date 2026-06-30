// =================== CONFIGURACIÃ“N ===================
const HOJA_EMPLEADOS = "EMPLEADOS";
const HOJA_REGISTROS = "REGISTROS";
const HOJA_DISPOSITIVOS = "DISPOSITIVOS";
const HOJA_ALMUERZOS_EXTRA = "ALMUERZOS_EXTRA";
const HOJA_CONFIGURACION = "CONFIGURACION";
const LAT_EMPRESA = -0.1288771313385675;
const LNG_EMPRESA = -78.47896772889067;
const RADIO_METROS = 250;
const CLAVE_GUARDIA = "TCONTROL2026";

// Nombres de columnas para mantener consistencia
// Nombres de columnas para registros (A-T)
const COLUMNAS = {
  FECHA: 0,                   // A
  ID: 1,                      // B
  NOMBRE: 2,                  // C
  TIPO: 3,                    // D
  ALMUERZO: 4,                // E
  HORA: 5,                    // F
  LAT: 6,                     // G
  LNG: 7,                     // H
  DISPOSITIVO: 8,             // I
  TIMESTAMP: 9,               // J
  DIA: 10,                    // K
  MODO: 11,                   // L
  HORAS_EXTRA: 12,            // M
  AUTORIZA: 13,               // N
  RAZON_SALIDA_TEMPRANA: 14,  // O
  QUIEN_JUSTIFICA: 15,        // P
  RAZON_ENTRADA_TARDIA: 16,   // Q
  QUIEN_JUSTIFICA_ENTRADA: 17,// R
  TIPO_SALIDA: 18,            // S
  RAZON_PERMISO: 19,          // T
  RAZON_AUSENCIA: 20          // U
};

// Columnas de la hoja EMPLEADOS
const COLUMNAS_EMPLEADOS = {
  ID: 0,        // A
  NOMBRE: 1,    // B
  AREA: 2,      // C
  ACTIVO: 3,    // D
  FOTO_URL: 4,  // E
  ID_DISPOSITIVO: 5, // F
  PIN: 6,       // G
  DEVICE_TOKEN: 7, // H
  SUPERVISOR: 8, // I
  CARGO: 13,    // N
  FECHA_NACIMIENTO: 17, // R
  BASE_LAT: 18,   // S
  BASE_LNG: 19    // T
};

// Columnas de la hoja DISPOSITIVOS
const COLUMNAS_DISPOSITIVOS = {
  ID_DISPOSITIVO: 0,
  ID_EMPLEADO: 1,
  FECHA_REGISTRO: 2,
  ULTIMO_USO: 3,
  ACTIVO: 4
};

// ========== LÃ“GICA DE CALENDARIO ECUADOR ==========
function obtenerDiaEcuador(fecha) {
  if (!fecha) fecha = new Date();
  const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÃ‰RCOLES', 'JUEVES', 'VIERNES', 'SÃBADO'];
  const diaSemana = dias[fecha.getDay()];
  
  if (esFeriadoEcuador(fecha)) {
    return `FERIADO (${diaSemana})`;
  }
  return diaSemana;
}

function esFeriadoEcuador(fecha) {
  const d = fecha.getDate();
  const m = fecha.getMonth() + 1; // 1-indexed
  const y = fecha.getFullYear();
  const fechaStr = `${d.toString().padStart(2,'0')}/${m.toString().padStart(2,'0')}`;
  
  // Feriados fijos Nacionales y Quito
  const feriadosFijos = [
    '01/01', // AÃ±o Nuevo
    '01/05', // DÃ­a del Trabajo
    '24/05', // Batalla de Pichincha
    '10/08', // Primer Grito de Independencia
    '09/10', // Independencia de Guayaquil
    '02/11', // DÃ­a de los Difuntos
    '03/11', // Independencia de Cuenca
    '06/12', // FundaciÃ³n de Quito
    '25/12'  // Navidad
  ];
  
  if (feriadosFijos.includes(fechaStr)) return true;
  
  // Feriados mÃ³viles 2024 (Carnaval, Viernes Santo)
  if (y === 2024) {
    const moviles2024 = ['12/02', '13/02', '29/03'];
    if (moviles2024.includes(fechaStr)) return true;
  }
  // Feriados mÃ³viles 2025
  if (y === 2025) {
    const moviles2025 = ['03/03', '04/03', '18/04'];
    if (moviles2025.includes(fechaStr)) return true;
  }
  // Feriados mÃ³viles 2026
  if (y === 2026) {
    const moviles2026 = ['16/02', '17/02', '03/04'];
    if (moviles2026.includes(fechaStr)) return true;
  }
  
  return false;
}
// =====================================================

// =================== API BRIDGE ===================
function doGet(e) {
  // Si es para la interfaz original (para compatibilidad)
  if (e && e.parameter && e.parameter.pagina) {
    return servirHtmlOriginal(e);
  }
  
  // Siempre responder como JSONP para evitar CORS
  const callback = (e && e.parameter && e.parameter.callback) || 'callback';
  
  // Validación de API Key
  if (!e || !e.parameter || e.parameter.apiKey !== 'TCONTROL_SECURE_2026_XYZ') {
    const jsonString = JSON.stringify({ error: "No autorizado: API Key inválida o ausente" });
    return ContentService
      .createTextOutput(`${callback}(${jsonString})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  const params = {};
  
  // Copiar todos los parámetros excepto callback
  for (let key in e.parameter) {
    if (key !== 'callback') {
      params[key] = e.parameter[key];
    }
  }
  
  try {
    const resultado = procesarAccion(params);
    const jsonString = JSON.stringify(resultado);
    const jsonpResponse = `${callback}(${jsonString})`;
    
    return ContentService
      .createTextOutput(jsonpResponse)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (error) {
    const jsonString = JSON.stringify({ error: error.toString() });
    const jsonpResponse = `${callback}(${jsonString})`;
    
    return ContentService
      .createTextOutput(jsonpResponse)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

function doPost(e) {
  try {
    if (e && e.postData && e.postData.contents) {
      var data = JSON.parse(e.postData.contents);
      
      // Validación de API Key
      if (!data || data.apiKey !== 'TCONTROL_SECURE_2026_XYZ') {
        return ContentService
          .createTextOutput(JSON.stringify({ error: "No autorizado: API Key inválida o ausente" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      if (data.accion === 'archivarRegistros') {
        var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REGISTROS');
        if (!sheet) {
          sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('REGISTROS');
          sheet.appendRow(['FECHA', 'ID', 'NOMBRE', 'TIPO', 'ALMUERZO', 'HORA', 'LAT', 'LNG', 'DISPOSITIVO', 'TIMESTAMP', 'DIA', 'MODO', 'HORAS_EXTRA', 'AUTORIZA', 'RAZON_SALIDA_TEMPRANA', 'QUIEN_JUSTIFICA', 'RAZON_ENTRADA_TARDIA', 'QUIEN_JUSTIFICA_ENTRADA', 'TIPO_SALIDA', 'RAZON_PERMISO', 'RAZON_AUSENCIA']);
        }
        var registros = data.registros;
        if (!registros || registros.length === 0) {
          return ContentService.createTextOutput(JSON.stringify({ ok: true, mensaje: "Sin registros" })).setMimeType(ContentService.MimeType.JSON);
        }
        var filas = [];
        for (var i = 0; i < registros.length; i++) {
          var r = registros[i];
          var tsStr = r.timestamp ? String(r.timestamp) : new Date().toISOString();
          var r_razonSalidaTemprana = r.razon_salida_temprana || r.razonSalidaTemprana || r.razon_salida || '';
          var r_quienJustifica = r.quien_justifica || r.quienJustifica || '';
          var r_razonEntradaTardia = r.razon_entrada_tardia || r.razonEntradaTardia || '';
          var r_quienJustificaEntrada = r.quien_justifica_entrada || r.quienJustificaEntrada || '';
          var r_tipoSalida = r.tipo_salida || r.tipoSalida || '';
          var r_razonPermiso = r.razon_permiso || r.razonPermiso || '';
          
          filas.push([
            r.fecha||'', r.empleadoId||'', r.nombre||'', r.tipo||'', r.almuerzo||'', r.hora||'', r.lat||'', r.lng||'', r.dispositivo||'', tsStr, r.dia||'', r.modo||'', r.horasExtra||'', r.autoriza||'', r_razonSalidaTemprana, r_quienJustifica, r_razonEntradaTardia, r_quienJustificaEntrada, r_tipoSalida, r_razonPermiso, r.justificado||'', r.razon_justificac||''
          ]);
        }
        sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
        return ContentService.createTextOutput(JSON.stringify({ok: true, guardados: filas.length})).setMimeType(ContentService.MimeType.JSON);
      }
      
      if (data.accion === 'obtenerRegistrosArchivados') {
        var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REGISTROS');
        if (!sheet) return ContentService.createTextOutput(JSON.stringify({ok: true, registros: []})).setMimeType(ContentService.MimeType.JSON);
        var dataRange = sheet.getDataRange().getValues();
        if (dataRange.length <= 1) return ContentService.createTextOutput(JSON.stringify({ok: true, registros: []})).setMimeType(ContentService.MimeType.JSON);
        
        var filterId = data.empleadoId ? String(data.empleadoId).trim() : null;
        var tz = Session.getScriptTimeZone();
        var registros = [];
        
        for (var i = 1; i < dataRange.length; i++) {
          var r = dataRange[i];
          // Filtrar por ID si se proporciona
          if (filterId && String(r[1]).trim() !== filterId) continue;

          // Formatear fecha correctamente
          var fechaVal = r[0];
          var fechaStr = '';
          if (fechaVal instanceof Date) {
            fechaStr = Utilities.formatDate(fechaVal, tz, 'yyyy-MM-dd');
          } else if (fechaVal) {
            var s = String(fechaVal).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
              fechaStr = s.slice(0, 10);
            } else {
              var m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
              if (m1) {
                fechaStr = m1[3] + '-' + m1[2].padStart(2,'0') + '-' + m1[1].padStart(2,'0');
              } else {
                var d = new Date(s);
                fechaStr = isNaN(d.getTime()) ? s : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
              }
            }
          }
          
          var horaVal = r[5];
          var horaStr = '';
          if (horaVal instanceof Date) {
            horaStr = Utilities.formatDate(horaVal, tz, 'HH:mm:ss');
          } else {
            horaStr = horaVal ? String(horaVal) : '';
          }
          
          var r14 = r[14]?String(r[14]):'';
          var r15 = r[15]?String(r[15]):'';
          var r16 = r[16]?String(r[16]):'';
          var r17 = r[17]?String(r[17]):'';
          var r18 = r[18]?String(r[18]):'';
          var r19 = r[19]?String(r[19]):'';
          registros.push({
            fecha: fechaStr, 
            empleadoId: r[1]?String(r[1]):'', 
            nombre: r[2]?String(r[2]):'', 
            tipo: r[3]?String(r[3]):'', 
            almuerzo: r[4]?String(r[4]):'', 
            hora: horaStr, 
            lat: r[6]?String(r[6]):'', 
            lng: r[7]?String(r[7]):'', 
            dispositivo: r[8]?String(r[8]):'', 
            timestamp: r[9]?String(r[9]):'', 
            dia: r[10]?String(r[10]):'', 
            modo: r[11]?String(r[11]):'', 
            horasExtra: r[12]?String(r[12]):'', 
            autoriza: r[13]?String(r[13]):'', 
            razonSalidaTemprana: r14,
            razon_salida_temprana: r14,
            razon_salida: r14,
            quienJustifica: r15,
            quien_justifica: r15,
            razonEntradaTardia: r16,
            razon_entrada_tardia: r16,
            quienJustificaEntrada: r17,
            quien_justifica_entrada: r17,
            tipoSalida: r18,
            tipo_salida: r18,
            razonPermiso: r19,
            razon_permiso: r19,
            justificado: r[20]?String(r[20]):'',
            razon_justificac: r[21]?String(r[21]):''
          });
        }
        return ContentService.createTextOutput(JSON.stringify({ok: true, registros: registros})).setMimeType(ContentService.MimeType.JSON);
      }
      
      if (data.accion === 'escribirHojaActualizar') {
        var res = escribirHojaActualizar(data);
        return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
      }
    }
  } catch(e) {}
  
  return doGet(e);
}

function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  return ContentService.createTextOutput("").setHeaders(headers);
}

function procesarAccion(params) {
  const accion = params.accion;
  
  if (!accion) {
    return { error: "No se especificÃ³ acciÃ³n" };
  }
  
  console.log("Procesando acciÃ³n:", accion, params);
  
  // Enrutamiento
  switch(accion) {
    // Sistema principal
    case 'verificarDispositivo':
      return verificarDispositivoTienePIN(params.deviceToken);
      
    case 'registrarDispositivo':
      return registrarDispositivoConPIN(params.empleadoId, params.pin, params.deviceToken);
      
    case 'verificarPIN':
      return verificarPIN(params.pin, params.deviceToken, params.empleadoId);
      
    case 'obtenerEstado':
      return obtenerEstadoPorIdODevice(params.id, params.deviceToken);
      
    case 'guardarRegistro':
      let datosRegistro = params;
      if (params.datos && typeof params.datos === 'string') {
        try {
          datosRegistro = JSON.parse(params.datos);
        } catch(e) {}
      }
      return guardarRegistro(datosRegistro);
      
    case 'obtenerRegistros':
      return obtenerRegistrosEmpleado(params.empleadoId);
      
    case 'obtenerDatosSupervisor':
      return obtenerDatosSupervisorConTimestamp();
      
    case 'actualizarBaseCampo':
      return actualizarBaseCampo(params.empleadoId, params.lat, params.lng);

    case 'verificarCambios':
      return verificarCambiosRegistros(params.ultimoTimestamp, params.totalRegistros);
      
    case 'desvincularDispositivo':
      return desvincularDispositivo(params.empleadoId, params.deviceToken);
      
    case 'verificarToken':
      return verificarTokenValido(params.token, params.empleadoId);
      
    case 'obtenerInfoEmpleado':
      return obtenerInfoEmpleado(params.id);
      
    case 'obtenerAlmuerzosExtra':
      return obtenerAlmuerzosExtra();
    
    // Terminal Guardia
    case 'verificarClaveGuardia':
      return verificarClaveGuardia(params);
    
    // Catering
    case 'obtenerListaCatering':
      return obtenerListaCatering(params);
    
    case 'marcarAlmuerzoConsumido':
      return marcarAlmuerzoConsumido(params);
    
    case 'obtenerEstadisticasConsumo':
      return obtenerEstadisticasConsumo(params);
    
    case 'crearHojaConsumoAlmuerzos':
      return crearHojaConsumoAlmuerzos(params);

    case 'actualizarAlmuerzoSupervisor':
      return actualizarAlmuerzoSupervisor(params);

    // MIGRACIÓN FIREBASE
    case 'exportarBaseDatosParaFirebase':
      return exportarBaseDatosParaFirebase();
    // AdministraciÃ³n
    case 'obtenerConfiguraciones':
      return obtenerConfiguraciones();
      
    case 'guardarConfiguraciones':
      let configData = params.configuraciones;
      if (typeof configData === 'string') {
        try {
          configData = JSON.parse(configData);
        } catch(e) { return { error: "Formato de configuraciÃ³n invÃ¡lido" }; }
      }
      return guardarConfiguraciones(configData);
      
    case 'obtenerRegistrosArchivados':
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REGISTROS');
      if (!sheet) return { ok: true, registros: [] };
      var dataRange = sheet.getDataRange().getValues();
      if (dataRange.length <= 1) return { ok: true, registros: [] };
      var registros = [];
      var empIdReq = params.empleadoId ? String(params.empleadoId).trim() : null;
      for (var i = 1; i < dataRange.length; i++) {
        var r = dataRange[i];
        var rEmpId = r[1]?String(r[1]).trim():'';
        // Si se pide un empleado especifico, saltar los demas
        if (empIdReq && rEmpId !== empIdReq) continue;
        
        registros.push({
          fecha: r[0]?String(r[0]):'', empleadoId: rEmpId, nombre: r[2]?String(r[2]):'', tipo: r[3]?String(r[3]):'', almuerzo: r[4]?String(r[4]):'', hora: r[5]?String(r[5]):'', lat: r[6]?String(r[6]):'', lng: r[7]?String(r[7]):'', dispositivo: r[8]?String(r[8]):'', timestamp: r[9]?String(r[9]):'', dia: r[10]?String(r[10]):'', modo: r[11]?String(r[11]):'', horasExtra: r[12]?String(r[12]):'', autoriza: r[13]?String(r[13]):'', razonSalidaTemprana: r[14]?String(r[14]):'', quienJustifica: r[15]?String(r[15]):'', razonEntradaTardia: r[16]?String(r[16]):'', quienJustificaEntrada: r[17]?String(r[17]):'', tipoSalida: r[18]?String(r[18]):'', razonPermiso: r[19]?String(r[19]):'', justificado: r[20]?String(r[20]):'', razon_justificac: r[21]?String(r[21]):''
        });
      }
      return { ok: true, registros: registros };

    case 'actualizarRegistroArchivado':
      return actualizarRegistroArchivado(params);
      
    case 'eliminarRegistroArchivado':
      return eliminarRegistroArchivado(params);

    case 'agregarSupervisor':
      return agregarSupervisor(params.empleadoId);
      
    case 'eliminarSupervisor':
      return eliminarSupervisor(params.empleadoId);
      
    case 'listarSupervisores':
      return listarSupervisores();
      
    case 'registrarAlmuerzoExtra':
      return registrarAlmuerzoExtra(params);
      
    case 'obtenerEmpleadosTaller':
      return obtenerEmpleadosTaller();
      
    case 'actualizarAutorizacionExtras':
      return actualizarAutorizacionExtras(params.empleadoId, params.autorizado);
      
    case 'crearReporteGoogleSheets':
      return crearReporteGoogleSheets(params);
      
    case 'escribirHojaActualizar':
      return escribirHojaActualizar(params);
      
    case 'leerHojaActualizar':
      return leerHojaActualizar();
      
    default:
      return { error: `Acción no reconocida: ${accion}` };
  }
}

function normalizarHeaderAKey(header) {
  if (header === null || header === undefined) return "";
  var clean = String(header).trim().toLowerCase();
  
  // Quitar acentos para comparación robusta
  var conAcentos = "áéíóúüñ";
  var sinAcentos = "aeiouun";
  var s = "";
  for (var i = 0; i < clean.length; i++) {
    var char = clean.charAt(i);
    var idx = conAcentos.indexOf(char);
    s += idx !== -1 ? sinAcentos.charAt(idx) : char;
  }
  
  if (s === "id/cedula" || s === "id / cedula" || s === "id" || s === "cedula") return "id";
  if (s === "nombre completo" || s === "nombre") return "nombre";
  if (s === "area") return "area";
  if (s === "cargo") return "cargo";
  if (s === "pin") return "pin";
  if (s === "dispositivo / enlace pagos" || s === "dispositivo" || s === "enlace pagos" || s === "dispositivo/enlace pagos" || s === "id_dispositivo") return "id_dispositivo";
  if (s === "supervisor (si/no)" || s === "supervisor") return "supervisor";
  if (s === "activo (si/no)" || s === "activo") return "activo";
  if (s === "url foto" || s === "foto" || s === "foto url" || s === "foto_url") return "foto_url";
  if (s === "latitud base" || s === "latitud" || s === "baselat" || s === "latitud_base") return "baseLat";
  if (s === "longitud base" || s === "longitud" || s === "baselng" || s === "longitud_base") return "baseLng";
  if (s === "fecha nacimiento" || s === "fecha_nacimiento" || s === "f. nacimiento" || s === "fechanacimiento") return "fechaNacimiento";
  if (s === "autorizar extras (si/no)" || s === "autorizar extras" || s === "authextras" || s === "auth extras") return "authExtras";
  
  // Normalizar encabezados personalizados a camelCase
  s = s.replace(/[^a-z0-9_ ]/g, "");
  var parts = s.split(/[\s_]+/);
  var key = parts[0];
  for (var j = 1; j < parts.length; j++) {
    key += parts[j].charAt(0).toUpperCase() + parts[j].slice(1);
  }
  return key;
}

function escribirHojaActualizar(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("ACTUALIZAR");
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet("ACTUALIZAR");
    }
    
    let empleados = [];
    if (params.empleados) {
      try {
        empleados = typeof params.empleados === 'string' ? JSON.parse(params.empleados) : params.empleados;
      } catch(e) {
        return { error: "Formato de empleados inválido: " + e.toString() };
      }
    }
    
    let columnas = [];
    if (params.columnas) {
      try {
        columnas = typeof params.columnas === 'string' ? JSON.parse(params.columnas) : params.columnas;
      } catch(e) {}
    }
    
    let encabezados = [];
    if (params.encabezados) {
      try {
        encabezados = typeof params.encabezados === 'string' ? JSON.parse(params.encabezados) : params.encabezados;
      } catch(e) {}
    }
    
    // Fallback en caso de que no se envíen columnas o encabezados
    if (columnas.length === 0) {
      columnas = ['id', 'nombre', 'area', 'cargo', 'pin', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento'];
      encabezados = ['ID/Cédula', 'Nombre completo', 'Área', 'Cargo', 'PIN', 'Supervisor (SI/NO)', 'Activo (SI/NO)', 'URL Foto', 'Latitud Base', 'Longitud Base', 'Fecha Nacimiento'];
    }
    
    // Escribir cabecera
    sheet.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    sheet.getRange(1, 1, 1, encabezados.length).setFontWeight("bold")
               .setBackground("#1e3a8a")
               .setFontColor("#ffffff")
               .setHorizontalAlignment("center");
    
    if (empleados.length > 0) {
      const filas = empleados.map(function(e) {
        return columnas.map(function(col) {
          var val = e[col];
          return val !== null && val !== undefined ? String(val) : '';
        });
      });
      
      sheet.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
      sheet.getRange(2, 1, filas.length, encabezados.length).setHorizontalAlignment("left");
    }
    
    // Auto ajustar
    for (let col = 1; col <= encabezados.length; col++) {
      sheet.autoResizeColumn(col);
    }
    
    return { ok: true, url: ss.getUrl() + "#gid=" + sheet.getSheetId() };
  } catch(e) {
    return { error: e.toString() };
  }
}

function leerHojaActualizar() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("ACTUALIZAR");
    if (!sheet) {
      return { error: "La hoja 'ACTUALIZAR' no existe. Primero debe descargar la información." };
    }
    
    const dataRange = sheet.getDataRange().getValues();
    if (dataRange.length <= 1) {
      return { error: "La hoja 'ACTUALIZAR' está vacía o solo contiene cabeceras." };
    }
    
    // Buscar la fila de cabeceras de forma dinámica
    let headerRowIdx = -1;
    let keys = [];
    let idxId = -1;
    let idxNombre = -1;
    
    // Buscamos en las primeras 10 filas
    const maxHeaderRowsSearch = Math.min(dataRange.length, 10);
    for (let rIdx = 0; rIdx < maxHeaderRowsSearch; rIdx++) {
      const row = dataRange[rIdx];
      const tempKeys = row.map(function(h) {
        return normalizarHeaderAKey(h);
      });
      const tempIdxId = tempKeys.indexOf("id");
      const tempIdxNombre = tempKeys.indexOf("nombre");
      if (tempIdxId !== -1 && tempIdxNombre !== -1) {
        headerRowIdx = rIdx;
        keys = tempKeys;
        idxId = tempIdxId;
        idxNombre = tempIdxNombre;
        break;
      }
    }
    
    if (headerRowIdx === -1) {
      const headersFallback = dataRange[0] || [];
      return { 
        error: "La hoja 'ACTUALIZAR' debe contener al menos las columnas 'ID/Cédula' y 'Nombre completo'. Primera fila encontrada: " + headersFallback.join(", ") 
      };
    }
    
    const headers = dataRange[headerRowIdx];
    const empleados = [];
    // Omitir cabecera y filas anteriores
    for (let i = headerRowIdx + 1; i < dataRange.length; i++) {
      const r = dataRange[i];
      const id = r[idxId] ? String(r[idxId]).trim() : '';
      const nombre = r[idxNombre] ? String(r[idxNombre]).trim() : '';
      
      if (!id || !nombre) continue; // Saltar filas vacías o sin ID/Nombre
      
      const emp = {};
      for (let colIdx = 0; colIdx < keys.length; colIdx++) {
        const key = keys[colIdx];
        if (!key) continue;
        
        let val = r[colIdx];
        
        // Formatear/Limpiar campos específicos
        if (key === "id") {
          val = id;
        } else if (key === "nombre") {
          val = nombre;
        } else if (key === "supervisor") {
          val = String(val || 'NO').trim().toUpperCase() === 'SI' ? 'SI' : 'NO';
        } else if (key === "activo") {
          val = String(val || 'SI').trim().toUpperCase() === 'NO' ? 'NO' : 'SI';
        } else if (key === "baseLat" || key === "baseLng") {
          val = val !== null && val !== undefined ? String(val).trim() : '';
        } else if (val instanceof Date) {
          // Formato fecha legible para fechas normales
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          val = val !== null && val !== undefined ? String(val).trim() : '';
        }
        
        emp[key] = val;
      }
      empleados.push(emp);
    }
    
    return { ok: true, empleados: empleados };
  } catch(e) {
    return { error: e.toString() };
  }
}

function crearReporteGoogleSheets(params) {
  try {
    const ss = SpreadsheetApp.getActive();
    let nombreReporte = params.nombreReporte || "Reporte_Personalizado";
    // Limitar longitud del nombre de la hoja (max 30 caracteres) y caracteres ilegales
    nombreReporte = nombreReporte.replace(/[\/\\\?\*\[\]:]/g, '_').substring(0, 30);

    let headers = [];
    let filas = [];
    
    if (params.headers) {
      try {
        headers = JSON.parse(params.headers);
      } catch(e) {
        headers = String(params.headers).split(',');
      }
    }
    
    if (params.filas) {
      try {
        filas = JSON.parse(params.filas);
      } catch(e) {
        return { error: "Formato de filas inválido" };
      }
    }

    if (!headers.length || !filas.length) {
      return { error: "No se proporcionaron datos suficientes para el reporte" };
    }

    // Si ya existe una hoja con el mismo nombre, eliminarla para sobrescribir
    let sheetExistente = ss.getSheetByName(nombreReporte);
    if (sheetExistente) {
      ss.deleteSheet(sheetExistente);
    }

    const sheet = ss.insertSheet(nombreReporte);
    
    // Escribir cabeceras
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Estilizar cabeceras (Fondo Azul, Letras Blancas, Negrita, Centrado)
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold")
               .setBackground("#1e40af")
               .setFontColor("#ffffff")
               .setHorizontalAlignment("center");
               
    // Escribir datos
    sheet.getRange(2, 1, filas.length, headers.length).setValues(filas);
    
    // Estilizar alineación de datos
    const dataRange = sheet.getRange(2, 1, filas.length, headers.length);
    dataRange.setFontFamily("Arial");
    
    // Auto-ajustar columnas
    for (let col = 1; col <= headers.length; col++) {
      sheet.autoResizeColumn(col);
    }

    return { 
      ok: true, 
      mensaje: "Reporte creado exitosamente en Google Sheets", 
      url: ss.getUrl() + "#gid=" + sheet.getSheetId() 
    };
  } catch (error) {
    console.error("Error en crearReporteGoogleSheets:", error);
    return { error: error.toString() };
  }
}

function servirHtmlOriginal(e) {
  let pagina = e.parameter.pagina;
  
  if (pagina === "guardia") {
    return HtmlService.createHtmlOutputFromFile("guardia")
      .setTitle("Terminal Guardia")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else if (pagina === "dashboard") {
    return HtmlService.createHtmlOutputFromFile("dashboard")
      .setTitle("Dashboard Empleado")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else if (pagina === "admin") {
    return HtmlService.createHtmlOutputFromFile("admin")
      .setTitle("Panel de AdministraciÃ³n")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else if (pagina === "supervisor") {
    return HtmlService.createHtmlOutputFromFile("supervisor")
      .setTitle("Supervisor - Control 2026")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else {
    return HtmlService.createHtmlOutputFromFile("index")
      .setTitle("Control de Asistencia")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}

// =================== UTILIDADES ===================
function calcularDistancia(lat1, lon1, lat2, lon2) {
  // Convertir a nÃºmeros por si acaso
  lat1 = parseFloat(lat1);
  lon1 = parseFloat(lon1);
  lat2 = parseFloat(lat2);
  lon2 = parseFloat(lon2);
  
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatearFecha(fecha, formato = "yyyy-MM-dd") {
  if (!fecha) return "";
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), formato);
}

function convertirUrlDrive(url) {
  if (!url) return null;
  if (url.includes('lh3.googleusercontent.com')) return url;
  
  let fileId = null;
  const matchFileD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD) fileId = matchFileD[1];
  const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) fileId = matchId[1];
  const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) fileId = matchD[1];
  const matchOpen = url.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (matchOpen) fileId = matchOpen[1];
  
  if (fileId) return `https://lh3.googleusercontent.com/d/${fileId}`;
  return url;
}

function esEmpleadoActivo(valorActivo) {
  if (valorActivo === null || valorActivo === undefined) return false;
  if (typeof valorActivo === 'boolean') return valorActivo === true;
  if (typeof valorActivo === 'number') return valorActivo === 1;
  if (typeof valorActivo === 'string') {
    const valor = valorActivo.toString().trim().toUpperCase();
    return ['SI', 'S', 'TRUE', 'T', 'ACTIVO', '1'].includes(valor);
  }
  return false;
}

// =================== SISTEMA DE PIN ===================
function verificarDispositivoTienePIN(deviceToken) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const tokenGuardado = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN]?.toString().trim();
      if (tokenGuardado === deviceToken) return { tienePin: true };
    }
    return { tienePin: false };
  } catch (error) {
    console.error("Error en verificarDispositivoTienePIN:", error);
    return { error: error.toString() };
  }
}

function registrarDispositivoConPIN(empleadoId, pin, deviceToken) {
  // getDocumentLock: varios usuarios pueden registrar dispositivos al mismo tiempo
  // pero necesitamos evitar que el mismo empleado se registre dos veces en paralelo
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);
    const empleadoLimpio = empleadoId.toString().trim();
    const pinLimpio = pin.toString().trim();
    
    if (!empleadoLimpio) return { error: "ID de empleado no vÃ¡lido" };
    if (!pinLimpio || pinLimpio.length !== 4) return { error: "PIN no vÃ¡lido" };
    
    const infoEmpleado = obtenerInfoEmpleado(empleadoLimpio);
    if (!infoEmpleado.encontrado) return { error: "Empleado no encontrado" };
    if (!infoEmpleado.activo) return { error: "Empleado inactivo" };
    
    const sheetEmpleados = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheetEmpleados.getDataRange().getValues();
    let filaEmpleado = -1;
    for (let i = 1; i < data.length; i++) {
      const idActual = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
      if (idActual === empleadoLimpio) { filaEmpleado = i + 1; break; }
    }
    if (filaEmpleado === -1) return { error: "No se encontrÃ³ al empleado en la hoja" };
    
    sheetEmpleados.getRange(filaEmpleado, COLUMNAS_EMPLEADOS.PIN + 1).setValue(pinLimpio);
    sheetEmpleados.getRange(filaEmpleado, COLUMNAS_EMPLEADOS.DEVICE_TOKEN + 1).setValue(deviceToken);
    
    const sheetDispositivos = SpreadsheetApp.getActive().getSheetByName(HOJA_DISPOSITIVOS);
    if (sheetDispositivos) {
      const ahora = new Date();
      sheetDispositivos.appendRow([deviceToken, empleadoLimpio, ahora, ahora, "SI"]);
    }
    return { ok: true };
  } catch (error) {
    console.error("Error en registrarDispositivoConPIN:", error);
    return { error: error.toString() };
  } finally { lock.releaseLock(); }
}

function verificarPIN(pin, deviceToken, empleadoId) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    
    // 1. CASO MAESTRO: Si es la clave maestra
    if (pin === "TCONTROL2026") {
      // Intentar cargar el administrador 1058
      for (let i = 1; i < data.length; i++) {
        if (data[i][COLUMNAS_EMPLEADOS.ID].toString().trim() === "1058") {
          const idEmpleado = "1058";
          const info = obtenerEstadoPorIdODevice(idEmpleado, null);
          return {
            valido: true,
            empleado: {
              id: idEmpleado,
              nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE],
              area: data[i][COLUMNAS_EMPLEADOS.AREA],
              cargo: data[i][COLUMNAS_EMPLEADOS.CARGO] || "",
              fechaNacimiento: data[i][COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO] || "",
              foto_url: convertirUrlDrive(data[i][COLUMNAS_EMPLEADOS.FOTO_URL] || ''),
              tieneEntrada: info.tieneEntrada || false,
              tieneSalida: info.tieneSalida || false,
              horaEntrada: info.horaEntrada || null,
              horaSalida: info.horaSalida || null,
              almuerzo: info.almuerzo || null,
              esSupervisor: true
            }
          };
        }
      }
    }

    // 2. CASO GENERAL
    for (let i = 1; i < data.length; i++) {
      const idGuardado = data[i][COLUMNAS_EMPLEADOS.ID]?.toString().trim();
      const pinGuardado = data[i][COLUMNAS_EMPLEADOS.PIN]?.toString().trim();
      const activo = esEmpleadoActivo(data[i][COLUMNAS_EMPLEADOS.ACTIVO]);
      
      const idCoincide = !empleadoId || (idGuardado === empleadoId.toString().trim());
      
      if (idCoincide && pinGuardado === pin && activo) {
        const tokenGuardado = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN]?.toString().trim();
        if (tokenGuardado !== deviceToken) {
          sheet.getRange(i + 1, COLUMNAS_EMPLEADOS.DEVICE_TOKEN + 1).setValue(deviceToken);
          const sheetDispositivos = SpreadsheetApp.getActive().getSheetByName(HOJA_DISPOSITIVOS);
          if (sheetDispositivos) {
            const ahora = new Date();
            sheetDispositivos.appendRow([deviceToken, data[i][COLUMNAS_EMPLEADOS.ID].toString().trim(), ahora, ahora, "SI"]);
          }
        }
        const idEmpleado = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
        const info = obtenerEstadoPorIdODevice(idEmpleado, null);
        const esSupervisor = data[i][COLUMNAS_EMPLEADOS.SUPERVISOR]?.toString().trim().toLowerCase() === 'si';
        return {
          valido: true,
          empleado: {
            id: idEmpleado,
            nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE],
            area: data[i][COLUMNAS_EMPLEADOS.AREA],
            cargo: data[i][COLUMNAS_EMPLEADOS.CARGO] || "",
            fechaNacimiento: data[i][COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO] || "",
            foto_url: convertirUrlDrive(data[i][COLUMNAS_EMPLEADOS.FOTO_URL] || ''),
            tieneEntrada: info.tieneEntrada || false,
            tieneSalida: info.tieneSalida || false,
            horaEntrada: info.horaEntrada || null,
            horaSalida: info.horaSalida || null,
            almuerzo: info.almuerzo || null,
            esSupervisor: esSupervisor
          }
        };
      }
    }
    return { valido: false };
  } catch (error) {
    console.error("Error en verificarPIN:", error);
    return { error: error.toString() };
  }
}

// =================== EMPLEADOS ===================
function obtenerInfoEmpleado(id) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    if (!sheet) throw new Error(`Hoja "${HOJA_EMPLEADOS}" no encontrada`);
    const data = sheet.getDataRange().getValues();
    const idBuscar = id.toString().trim();
    for (let i = 1; i < data.length; i++) {
      const idEmpleado = data[i][COLUMNAS_EMPLEADOS.ID]?.toString().trim() || '';
      if (idEmpleado === idBuscar) {
        const activo = esEmpleadoActivo(data[i][COLUMNAS_EMPLEADOS.ACTIVO]);
        if (!activo) return { error: "Empleado inactivo", encontrado: true, activo: false };
        let fotoUrl = data[i][COLUMNAS_EMPLEADOS.FOTO_URL] || null;
        if (fotoUrl) fotoUrl = convertirUrlDrive(fotoUrl.toString().trim());
        const idDispositivo = data[i][COLUMNAS_EMPLEADOS.ID_DISPOSITIVO] || '';
        const pin = data[i][COLUMNAS_EMPLEADOS.PIN] || '';
        const deviceToken = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN] || '';
        const esSupervisor = data[i][COLUMNAS_EMPLEADOS.SUPERVISOR]?.toString().trim().toLowerCase() === 'si';
        return {
          id: data[i][COLUMNAS_EMPLEADOS.ID],
          nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE],
          area: data[i][COLUMNAS_EMPLEADOS.AREA],
          cargo: data[i][COLUMNAS_EMPLEADOS.CARGO] || "",
          fechaNacimiento: data[i][COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO] || "",
          activo: true,
          foto_url: fotoUrl,
          id_dispositivo: idDispositivo.toString().trim(),
          pin: pin.toString().trim(),
          device_token: deviceToken.toString().trim(),
          baseLat: data[i][COLUMNAS_EMPLEADOS.BASE_LAT] || null,
          baseLng: data[i][COLUMNAS_EMPLEADOS.BASE_LNG] || null,
          esSupervisor: esSupervisor,
          encontrado: true
        };
      }
    }
    return { error: "Empleado no encontrado", encontrado: false };
  } catch (error) {
    console.error("Error en obtenerInfoEmpleado:", error);
    return { error: error.toString() };
  }
}

function actualizarBaseCampo(empleadoId, lat, lng) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    const idBuscar = empleadoId.toString().trim();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][COLUMNAS_EMPLEADOS.ID].toString().trim() === idBuscar) {
        sheet.getRange(i + 1, COLUMNAS_EMPLEADOS.BASE_LAT + 1).setValue(lat);
        sheet.getRange(i + 1, COLUMNAS_EMPLEADOS.BASE_LNG + 1).setValue(lng);
        return { ok: true, mensaje: "UbicaciÃ³n base actualizada correctamente" };
      }
    }
    return { error: "Empleado no encontrado" };
  } catch (e) {
    return { error: e.toString() };
  }
}

function obtenerEstadoPorIdODevice(id, deviceId) {
  try {
    let idReal = id;
    let infoEmpleado = null;
    if ((!id || id.toString().trim() === "") && deviceId && deviceId !== "GUARDIA") {
      const empleadoPorToken = obtenerEmpleadoPorDeviceToken(deviceId);
      if (empleadoPorToken && empleadoPorToken.encontrado) {
        idReal = empleadoPorToken.id;
        infoEmpleado = empleadoPorToken;
      } else if (empleadoPorToken && empleadoPorToken.error) {
        return { error: empleadoPorToken.error, necesitaRegistro: true };
      } else {
        const empleadoPorDevice = obtenerEmpleadoPorDispositivo(deviceId);
        if (empleadoPorDevice && empleadoPorDevice.encontrado) {
          idReal = empleadoPorDevice.id;
          infoEmpleado = empleadoPorDevice;
        } else {
          return { error: "Dispositivo no registrado", necesitaRegistro: true };
        }
      }
    }
    if (idReal && idReal.toString().trim() !== "") {
      if (!infoEmpleado) infoEmpleado = obtenerInfoEmpleado(idReal);
      if (!infoEmpleado.encontrado) return { error: "Empleado no encontrado" };
      if (!infoEmpleado.activo) return { error: "Empleado inactivo - Contacte a RRHH" };
      
      const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
      if (!sheet) throw new Error(`Hoja "${HOJA_REGISTROS}" no encontrada`);
      const data = sheet.getDataRange().getValues();
      const hoyStr = formatearFecha(new Date());
      let tieneEntrada = false, tieneSalida = false, almuerzoRegistrado = "";
      let horaEntradaMs = null, horaSalidaMs = null;
      for (let i = 1; i < data.length; i++) {
        const fila = data[i];
        if (!fila[COLUMNAS.FECHA]) continue;
        const fechaFila = formatearFecha(new Date(fila[COLUMNAS.FECHA]));
        if (fila[COLUMNAS.ID].toString() === idReal.toString() && fechaFila === hoyStr) {
          if (fila[COLUMNAS.TIPO] === "ENTRADA") { 
            tieneEntrada = true; 
            almuerzoRegistrado = fila[COLUMNAS.ALMUERZO] || "";
            if (fila[COLUMNAS.TIMESTAMP] instanceof Date) horaEntradaMs = fila[COLUMNAS.TIMESTAMP].getTime();
            else if (fila[COLUMNAS.HORA]) {
              const [h, m, s] = fila[COLUMNAS.HORA].split(':');
              const d = new Date(); d.setHours(parseInt(h), parseInt(m), parseInt(s)||0);
              horaEntradaMs = d.getTime();
            }
          }
          if (fila[COLUMNAS.TIPO] === "SALIDA") {
            tieneSalida = true;
            if (fila[COLUMNAS.TIMESTAMP] instanceof Date) horaSalidaMs = fila[COLUMNAS.TIMESTAMP].getTime();
            else if (fila[COLUMNAS.HORA]) {
              const [h, m, s] = fila[COLUMNAS.HORA].split(':');
              const d = new Date(); d.setHours(parseInt(h), parseInt(m), parseInt(s)||0);
              horaSalidaMs = d.getTime();
            }
          }
        }
      }
      const opciones = [];
      if (!tieneEntrada) opciones.push("ENTRADA");
      if (tieneEntrada && !tieneSalida) opciones.push("SALIDA");
      return {
        id: idReal,
        nombre: infoEmpleado.nombre,
        area: infoEmpleado.area,
        cargo: infoEmpleado.cargo,
        fechaNacimiento: infoEmpleado.fechaNacimiento,
        foto_url: infoEmpleado.foto_url,
        tieneEntrada: tieneEntrada,
        tieneSalida: tieneSalida,
        horaEntrada: horaEntradaMs ? formatearFecha(new Date(horaEntradaMs), "HH:mm:ss") : null,
        horaSalida: horaSalidaMs ? formatearFecha(new Date(horaSalidaMs), "HH:mm:ss") : null,
        almuerzo: almuerzoRegistrado,
        opciones: opciones,
        tienePin: !!(infoEmpleado.pin),
        baseLat: infoEmpleado.baseLat,
        baseLng: infoEmpleado.baseLng,
        esSupervisor: infoEmpleado.esSupervisor || false
      };
    }
    return { error: "No se pudo identificar al empleado", necesitaRegistro: true };
  } catch (error) {
    console.error("Error en obtenerEstadoPorIdODevice:", error);
    return { error: "Error al consultar estado: " + error.message };
  }
}

function obtenerEmpleadoPorDeviceToken(deviceToken) {
  try {
    if (!deviceToken || deviceToken === "GUARDIA") return null;
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    if (!sheet) throw new Error(`Hoja "${HOJA_EMPLEADOS}" no encontrada`);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const tokenGuardado = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN]?.toString().trim();
      if (tokenGuardado === deviceToken) {
        const idEmpleado = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
        const valorActivo = data[i][COLUMNAS_EMPLEADOS.ACTIVO];
        const activo = esEmpleadoActivo(valorActivo);
        if (!activo) return { error: "Empleado inactivo", encontrado: false };
        const esSupervisor = data[i][COLUMNAS_EMPLEADOS.SUPERVISOR]?.toString().trim().toLowerCase() === 'si';
        return {
          id: idEmpleado,
          nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE],
          area: data[i][COLUMNAS_EMPLEADOS.AREA],
          foto_url: convertirUrlDrive(data[i][COLUMNAS_EMPLEADOS.FOTO_URL] || ''),
          encontrado: true,
          activo: true,
          pin: data[i][COLUMNAS_EMPLEADOS.PIN],
          cargo: data[i][COLUMNAS_EMPLEADOS.CARGO] || "",
          authExtras: data[i][COLUMNAS_EMPLEADOS.AUTH_EXTRAS] || "NO",
          esSupervisor: esSupervisor
        };
      }
    }
    return null;
  } catch (error) {
    console.error("Error en obtenerEmpleadoPorDeviceToken:", error);
    return { error: error.toString() };
  }
}

function obtenerEmpleadoPorDispositivo(deviceId) {
  try {
    if (!deviceId || deviceId === "GUARDIA") return null;
    const deviceLimpio = deviceId.toString().trim();
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    if (!sheet) throw new Error(`Hoja "${HOJA_EMPLEADOS}" no encontrada`);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const dispositivoGuardado = data[i][COLUMNAS_EMPLEADOS.ID_DISPOSITIVO];
      const dispositivoStr = dispositivoGuardado ? dispositivoGuardado.toString().trim() : '';
      if (dispositivoStr === deviceLimpio) {
        const idEmpleado = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
        const valorActivo = data[i][COLUMNAS_EMPLEADOS.ACTIVO];
        const activo = esEmpleadoActivo(valorActivo);
        if (!activo) return { error: "Empleado inactivo", encontrado: false };
        const esSupervisor = data[i][COLUMNAS_EMPLEADOS.SUPERVISOR]?.toString().trim().toLowerCase() === 'si';
        return {
          id: idEmpleado,
          nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE],
          area: data[i][COLUMNAS_EMPLEADOS.AREA],
          foto_url: convertirUrlDrive(data[i][COLUMNAS_EMPLEADOS.FOTO_URL] || ''),
          encontrado: true,
          activo: true,
          cargo: data[i][COLUMNAS_EMPLEADOS.CARGO] || "",
          authExtras: data[i][COLUMNAS_EMPLEADOS.AUTH_EXTRAS] || "NO",
          esSupervisor: esSupervisor
        };
      }
    }
    return null;
  } catch (error) {
    console.error("Error en obtenerEmpleadoPorDispositivo:", error);
    return { error: error.toString() };
  }
}

// =================== REGISTRO ===================
function guardarRegistro(data) {
  // getUserLock: cada empleado escribe su propia fila — no compiten entre ellos
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    
    let lat = null;
    let lng = null;
    if (data.lat && data.lng) {
      lat = parseFloat(data.lat);
      lng = parseFloat(data.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        lat = Math.round(lat * 1000000) / 1000000;
        lng = Math.round(lng * 1000000) / 1000000;
      } else {
        lat = null; lng = null;
      }
    }
    
    // Identificar empleado si viene por token
    if ((!data.id || data.id.toString().trim() === "") && data.dispositivo && data.dispositivo !== "GUARDIA") {
      const empToken = obtenerEmpleadoPorDeviceToken(data.dispositivo);
      if (empToken && empToken.encontrado) {
        data.id = empToken.id;
        data.nombre = empToken.nombre;
      } else {
        const empDev = obtenerEmpleadoPorDispositivo(data.dispositivo);
        if (empDev && empDev.encontrado) {
          data.id = empDev.id;
          data.nombre = empDev.nombre;
        } else {
          return { error: "Dispositivo no reconocido" };
        }
      }
    }
    
    if (!data.id) return { error: "ID de empleado no proporcionado" };
    
    const infoEmpleado = obtenerInfoEmpleado(data.id);
    if (!infoEmpleado.encontrado) return { error: "Empleado no encontrado" };
    if (!infoEmpleado.activo) return { error: "Empleado inactivo" };
    
    const ss = SpreadsheetApp.getActive();
    const hoja = ss.getSheetByName(HOJA_REGISTROS);
    if (!hoja) throw new Error("Hoja REGISTROS no encontrada");
    
    const ahora = new Date();
    
    // =========================================================
    // CORRECCIÃ“N CRÃTICA: Para tipo FALTA (justificaciÃ³n masiva)
    // usar la fecha enviada por el cliente (fecha_falta),
    // NO la fecha de hoy.
    // =========================================================
    let fechaRegistro = ahora;
    let fechaStr = formatearFecha(ahora);
    
    if (data.tipo === 'FALTA' && data.fecha_falta) {
      // Parsear la fecha enviada como string YYYY-MM-DD
      const partes = data.fecha_falta.toString().trim().split('-');
      if (partes.length === 3) {
        const anio = parseInt(partes[0]);
        const mes  = parseInt(partes[1]) - 1; // meses 0-indexed
        const dia  = parseInt(partes[2]);
        if (!isNaN(anio) && !isNaN(mes) && !isNaN(dia)) {
          fechaRegistro = new Date(anio, mes, dia, 0, 0, 0);
          fechaStr = data.fecha_falta.toString().trim().substring(0, 10);
        }
      }
    }
    
    // Determinar Modo (OFICINA o CAMPO)
    const modo = data.modo || "OFICINA";
    
    // Determinar DÃ­a y Horas Extra automÃ¡ticas para CAMPO
    const diaDesc = obtenerDiaEcuador(fechaRegistro);
    let horasExtra = "NO";
    let autoriza = "";
    
    if (modo === "CAMPO") {
      horasExtra = "SI";
      autoriza = "SISTEMA (CAMPO)";
    }
    
    // Validar duplicados bÃ¡sicos (solo para registros que NO sean FALTA ni ESTADO)
    if (!["ESTADO", "FALTA"].includes(data.tipo)) {
      const hoyStr = formatearFecha(ahora); // Para duplicados siempre usar hoy
      const lastRow = hoja.getLastRow();
      if (lastRow > 1) {
        const dataHoja = hoja.getRange(2, 1, lastRow - 1, 4).getValues();
        let ultimoTipo = null;
        for (let i = dataHoja.length - 1; i >= 0; i--) {
          const fFila = formatearFecha(new Date(dataHoja[i][0]));
          if (dataHoja[i][1].toString() === data.id.toString() && fFila === hoyStr) {
            ultimoTipo = dataHoja[i][3];
            break;
          }
        }
        if (ultimoTipo === data.tipo) {
          return { error: `Ya registraste tu ${data.tipo} recientemente hoy` };
        }
      }
    }
    
    // Validar GPS (FALTA no requiere GPS)
    const saltarGPS = ["GUARDIA", "MANUAL"].includes(data.dispositivo) || ["FALTA", "ESTADO"].includes(data.tipo);
    if (!saltarGPS) {
      if (lat === null || lng === null) return { error: "GPS requerido para registro" };
      
      let latTarget = LAT_EMPRESA;
      let lngTarget = LNG_EMPRESA;
      let radioTarget = RADIO_METROS;
      let msgError = "Fuera del rango de la empresa";

      if (modo === "CAMPO") {
        if (!infoEmpleado.baseLat || !infoEmpleado.baseLng) {
          return { error: "Debes registrar primero tu ubicaciÃ³n base para modo campo" };
        }
        latTarget = parseFloat(infoEmpleado.baseLat);
        lngTarget = parseFloat(infoEmpleado.baseLng);
        radioTarget = 300;
        msgError = "Fuera del rango de tu ubicaciÃ³n base de campo";
      }

      const dist = calcularDistancia(latTarget, lngTarget, lat, lng);
      if (dist > radioTarget) return { error: `${msgError} (${Math.round(dist)}m)` };
    }
    
    // Armar fila (21 columnas A-U)
    const nuevaFila = new Array(21).fill("");
    nuevaFila[COLUMNAS.FECHA]                = fechaStr;  // <-- usa la fecha correcta (puede ser pasada)
    nuevaFila[COLUMNAS.ID]                   = data.id.toString().trim();
    nuevaFila[COLUMNAS.NOMBRE]               = infoEmpleado.nombre;
    nuevaFila[COLUMNAS.TIPO]                 = data.tipo;
    nuevaFila[COLUMNAS.ALMUERZO]             = data.almuerzo || "";
    nuevaFila[COLUMNAS.HORA]                 = data.tipo === 'FALTA'
                                               ? "00:00:00"
                                               : Utilities.formatDate(ahora, Session.getScriptTimeZone(), "HH:mm:ss");
    nuevaFila[COLUMNAS.LAT]                  = lat || "";
    nuevaFila[COLUMNAS.LNG]                  = lng || "";
    nuevaFila[COLUMNAS.DISPOSITIVO]          = data.dispositivo || "";
    nuevaFila[COLUMNAS.TIMESTAMP]            = data.tipo === 'FALTA' ? fechaRegistro : ahora;
    nuevaFila[COLUMNAS.DIA]                  = diaDesc;
    nuevaFila[COLUMNAS.MODO]                 = modo;
    nuevaFila[COLUMNAS.HORAS_EXTRA]          = horasExtra;
    nuevaFila[COLUMNAS.AUTORIZA]             = autoriza;
    nuevaFila[COLUMNAS.RAZON_SALIDA_TEMPRANA]= data.razon_salida || "";
    nuevaFila[COLUMNAS.QUIEN_JUSTIFICA]      = data.quien_justifica || "";
    nuevaFila[COLUMNAS.RAZON_ENTRADA_TARDIA] = data.razon_entrada_tardia || "";
    nuevaFila[COLUMNAS.QUIEN_JUSTIFICA_ENTRADA] = data.quien_justifica_entrada || "";
    nuevaFila[COLUMNAS.TIPO_SALIDA]          = data.tipo_salida || "";
    nuevaFila[COLUMNAS.RAZON_PERMISO]        = data.razon_permiso || "";
    nuevaFila[COLUMNAS.RAZON_AUSENCIA]       = data.razon_ausencia || "";
    
    hoja.appendRow(nuevaFila);
    return { ok: true, msg: `${data.tipo} registrado con Ã©xito (${modo})` };
    
  } catch (error) {
    console.error("Error en guardarRegistro:", error);
    return { error: "Error interno: " + error.message };
  } finally { lock.releaseLock(); }
}

// =================== OBTENER REGISTROS ===================
function obtenerRegistrosEmpleado(empleadoId) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
    if (!sheet) throw new Error(`Hoja "${HOJA_REGISTROS}" no encontrada`);
    const data = sheet.getDataRange().getValues();
    const registros = [];
    const timeZone = Session.getScriptTimeZone();
    const idBuscar = empleadoId.toString().trim();
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const idRegistro = fila[COLUMNAS.ID]?.toString().trim() || '';
      if (idRegistro === idBuscar) {
        let fechaObj = fila[COLUMNAS.FECHA];
        let timestampObj = fila[COLUMNAS.TIMESTAMP];
        let fechaStr = '', timestampStr = '', horaStr = fila[COLUMNAS.HORA]?.toString() || '';
        if (fechaObj instanceof Date) fechaStr = Utilities.formatDate(fechaObj, timeZone, 'yyyy-MM-dd');
        else if (typeof fechaObj === 'string') fechaStr = fechaObj;
        if (timestampObj instanceof Date) timestampStr = timestampObj.toISOString();
        else if (typeof timestampObj === 'string') timestampStr = timestampObj;
        registros.push({
          fecha: fechaStr,
          id: fila[COLUMNAS.ID]?.toString() || '',
          nombre: fila[COLUMNAS.NOMBRE]?.toString() || '',
          tipo: fila[COLUMNAS.TIPO]?.toString() || '',
          almuerzo: fila[COLUMNAS.ALMUERZO]?.toString() || '',
          hora: horaStr,
          lat: fila[COLUMNAS.LAT]?.toString() || '',
          lng: fila[COLUMNAS.LNG]?.toString() || '',
          dispositivo: fila[COLUMNAS.DISPOSITIVO]?.toString() || '',
          timestamp: timestampStr,
          modo: fila[COLUMNAS.MODO]?.toString() || '',
          horasExtra: fila[COLUMNAS.HORAS_EXTRA]?.toString() || '',
          autoriza: fila[COLUMNAS.AUTORIZA]?.toString() || '',
          razon_salida: fila[COLUMNAS.RAZON_SALIDA_TEMPRANA]?.toString() || '',
          quien_justifica: fila[COLUMNAS.QUIEN_JUSTIFICA]?.toString() || '',
          razon_entrada_tardia: fila[COLUMNAS.RAZON_ENTRADA_TARDIA]?.toString() || '',
          quien_justifica_entrada: fila[COLUMNAS.QUIEN_JUSTIFICA_ENTRADA]?.toString() || '',
          tipo_salida: fila[COLUMNAS.TIPO_SALIDA]?.toString() || '',
          razon_permiso: fila[COLUMNAS.RAZON_PERMISO]?.toString() || '',
          razon_ausencia: fila[COLUMNAS.RAZON_AUSENCIA]?.toString() || ''
        });
      }
    }
    registros.sort((a, b) => {
      if (a.timestamp && b.timestamp) return new Date(b.timestamp) - new Date(a.timestamp);
      return 0;
    });
    return registros;
  } catch (error) {
    console.error("Error en obtenerRegistrosEmpleado:", error);
    return [];
  }
}

// =================== DATOS PARA SUPERVISOR ===================
function obtenerDatosSupervisorConTimestamp() {
  try {
    const sheetEmpleados = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const sheetRegistros = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
    if (!sheetEmpleados || !sheetRegistros) throw new Error("Hojas no encontradas");
    
    const empleadosData = sheetEmpleados.getDataRange().getValues();
    const registrosData = sheetRegistros.getDataRange().getValues();
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = formatearFecha(new Date());
    
    // Procesar registros
    const registros = [];
    for (let i = 1; i < registrosData.length; i++) {
      const fila = registrosData[i];
      if (!fila[COLUMNAS.FECHA]) continue;
      
      let fechaStr = '';
      let timestampStr = '';
      let horaStr = fila[COLUMNAS.HORA]?.toString() || '';
      
      if (fila[COLUMNAS.FECHA] instanceof Date) {
        fechaStr = formatearFecha(fila[COLUMNAS.FECHA]);
      } else if (typeof fila[COLUMNAS.FECHA] === 'string') {
        fechaStr = fila[COLUMNAS.FECHA];
      }
      
      if (fila[COLUMNAS.TIMESTAMP] instanceof Date) {
        timestampStr = fila[COLUMNAS.TIMESTAMP].toISOString();
      } else if (typeof fila[COLUMNAS.TIMESTAMP] === 'string') {
        timestampStr = fila[COLUMNAS.TIMESTAMP];
      }
      
      // Extraer campos adicionales
      const ubicacion = fila[COLUMNAS.UBICACION]?.toString() || 'EMPRESA';
      const horasExtra = fila[COLUMNAS.HORAS_EXTRA]?.toString() || 'NO';
      const autoriza = fila[COLUMNAS.AUTORIZA]?.toString() || '';
      const dia = fila[COLUMNAS.DIA]?.toString() || '';

      registros.push({
        fecha: fechaStr,
        id: fila[COLUMNAS.ID]?.toString() || '',
        nombre: fila[COLUMNAS.NOMBRE]?.toString() || '',
        tipo: fila[COLUMNAS.TIPO]?.toString() || '',
        almuerzo: fila[COLUMNAS.ALMUERZO]?.toString() || '',
        hora: horaStr,
        timestamp: timestampStr,
        dia: dia,
        ubicacion: ubicacion,
        horasExtra: horasExtra,
        autoriza: autoriza,
        razon_salida: fila[COLUMNAS.RAZON_SALIDA_TEMPRANA]?.toString() || '',
        quien_justifica: fila[COLUMNAS.QUIEN_JUSTIFICA]?.toString() || '',
        razon_entrada_tardia: fila[COLUMNAS.RAZON_ENTRADA_TARDIA]?.toString() || '',
        quien_justifica_entrada: fila[COLUMNAS.QUIEN_JUSTIFICA_ENTRADA]?.toString() || '',
        tipo_salida: fila[COLUMNAS.TIPO_SALIDA]?.toString() || '',
        razon_permiso: fila[COLUMNAS.RAZON_PERMISO]?.toString() || '',
        razon_ausencia: fila[COLUMNAS.RAZON_AUSENCIA]?.toString() || ''
      });
    }
    
    // Procesar empleados
    const empleados = [];
    for (let i = 1; i < empleadosData.length; i++) {
      const fila = empleadosData[i];
      const activo = esEmpleadoActivo(fila[COLUMNAS_EMPLEADOS.ACTIVO]);
      if (!activo) continue;
      
      const id = fila[COLUMNAS_EMPLEADOS.ID]?.toString() || '';
      const nombre = fila[COLUMNAS_EMPLEADOS.NOMBRE]?.toString() || '';
      const area = fila[COLUMNAS_EMPLEADOS.AREA]?.toString() || '';
      let fotoUrl = fila[COLUMNAS_EMPLEADOS.FOTO_URL]?.toString() || '';
      if (fotoUrl) fotoUrl = convertirUrlDrive(fotoUrl);
      
      const registrosEmpleado = registros.filter(r => r.id === id);
      const registroHoy = registrosEmpleado.filter(r => r.fecha === hoyStr);
      const entradaHoy = registroHoy.find(r => r.tipo === 'ENTRADA');
      const salidaHoy = registroHoy.find(r => r.tipo === 'SALIDA');
      const soloAlmuerzoHoy = registroHoy.find(r => r.tipo === 'SOLO_ALMUERZO');
      
      let horaEntradaMs = null;
      let horaSalidaMs = null;
      let almuerzoHoy = null;
      let horasExtraAutorizadas = "NO";
      let ubicacionHoy = "EMPRESA";
      
      if (entradaHoy) {
        almuerzoHoy = entradaHoy.almuerzo || null;
        horasExtraAutorizadas = entradaHoy.horasExtra || "NO";
        ubicacionHoy = entradaHoy.ubicacion || "EMPRESA";
        if (entradaHoy.timestamp) {
          horaEntradaMs = new Date(entradaHoy.timestamp).getTime();
        }
      } else if (soloAlmuerzoHoy) {
        almuerzoHoy = soloAlmuerzoHoy.almuerzo || null;
      }
      
      if (salidaHoy) {
        if (salidaHoy.timestamp) {
          horaSalidaMs = new Date(salidaHoy.timestamp).getTime();
        }
      }
      
      empleados.push({
        id: id,
        nombre: nombre,
        area: area,
        foto_url: fotoUrl,
        activo: true,
        entradaHoy: !!entradaHoy,
        salidaHoy: !!salidaHoy,
        almuerzoHoy: almuerzoHoy,
        horaEntradaMs: horaEntradaMs,
        horaSalidaMs: horaSalidaMs,
        authExtras: horasExtraAutorizadas,
        ubicacionHoy: ubicacionHoy,
        cargo: fila[COLUMNAS_EMPLEADOS.CARGO] || "",
        fechaNacimiento: fila[COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO] || "",
        registros: registrosEmpleado
      });
    }
    
    return { empleados: empleados, registros: registros };
    
  } catch (error) {
    console.error("Error en obtenerDatosSupervisor:", error);
    return { error: error.toString() };
  }
}

function verificarCambiosRegistros(ultimoTimestampCliente, totalRegistrosCliente) {
  try {
    const sheetRegistros = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
    if (!sheetRegistros) return { error: "Hoja REGISTROS no encontrada" };
    const ultimaFila = sheetRegistros.getLastRow();
    if (ultimaFila <= 1) return { hayCambios: false, razon: "sin_registros" };
    const totalRegistrosActual = ultimaFila - 1;
    const ultimoRegistro = sheetRegistros.getRange(ultimaFila, COLUMNAS.TIMESTAMP + 1).getValue();
    let nuevoTimestamp = null;
    if (ultimoRegistro instanceof Date) nuevoTimestamp = ultimoRegistro.toISOString();
    let hayCambios = false, razon = "";
    if (totalRegistrosCliente !== undefined && totalRegistrosActual !== totalRegistrosCliente) {
      hayCambios = true; razon = `cantidad_registros: ${totalRegistrosCliente} -> ${totalRegistrosActual}`;
    } else if (nuevoTimestamp && ultimoTimestampCliente && nuevoTimestamp > ultimoTimestampCliente) {
      hayCambios = true; razon = `timestamp: ${ultimoTimestampCliente} < ${nuevoTimestamp}`;
    } else if (!ultimoTimestampCliente && totalRegistrosActual > 0) {
      hayCambios = true; razon = "primera_verificacion";
    }
    return { hayCambios: hayCambios, razon: razon, nuevoTimestamp: nuevoTimestamp, totalRegistros: totalRegistrosActual };
  } catch (error) {
    console.error("Error en verificarCambiosRegistros:", error);
    return { error: error.toString() };
  }
}

function verificarTokenValido(token, empleadoId) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const idActual = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
      if (idActual === empleadoId.toString().trim()) {
        const tokenGuardado = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN]?.toString().trim();
        if (!tokenGuardado || tokenGuardado !== token) return { valida: false };
        return { valida: true };
      }
    }
    return { valida: false };
  } catch (error) { return { valida: false, error: error.toString() }; }
}

function desvincularDispositivo(empleadoId, deviceToken) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const idActual = data[i][COLUMNAS_EMPLEADOS.ID].toString().trim();
      if (idActual === empleadoId.toString().trim()) {
        const tokenGuardado = data[i][COLUMNAS_EMPLEADOS.DEVICE_TOKEN]?.toString().trim();
        
        if (tokenGuardado === deviceToken) {
          sheet.getRange(i + 1, COLUMNAS_EMPLEADOS.DEVICE_TOKEN + 1).setValue("");
          
          const sheetDispositivos = SpreadsheetApp.getActive().getSheetByName(HOJA_DISPOSITIVOS);
          if (sheetDispositivos) {
            const dispositivosData = sheetDispositivos.getDataRange().getValues();
            for (let j = 1; j < dispositivosData.length; j++) {
              if (dispositivosData[j][COLUMNAS_DISPOSITIVOS.ID_DISPOSITIVO]?.toString().trim() === deviceToken) {
                sheetDispositivos.getRange(j + 1, COLUMNAS_DISPOSITIVOS.ACTIVO + 1).setValue("NO");
                break;
              }
            }
          }
          
          return { ok: true, mensaje: "Dispositivo desvinculado correctamente" };
        }
      }
    }
    
    return { error: "No se encontrÃ³ el dispositivo vinculado" };
  } catch (error) {
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// =================== FUNCIONES PARA ADMINISTRACIÃ“N ===================
function obtenerConfiguraciones() {
  try {
    let ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(HOJA_CONFIGURACION);
    
    if (!sheet) {
      sheet = ss.insertSheet(HOJA_CONFIGURACION);
      const configDefault = {
        ubicacion: { lat: LAT_EMPRESA, lng: LNG_EMPRESA, radio: RADIO_METROS },
        horarios: { hora_almuerzo: "09:30", hora_entrada_limite: "07:45", hora_salida: "16:15", almuerzo_activo: true, hora_inicio: "07:30", hora_fin: "16:15", marcacion_automatica: false, tiempo_automatico: 10 },
        registro: { tolerancia_gps: 50, requiere_foto: false, permite_registro_manual: true },
        otras: { whatsapp_number: "593963561149", mensaje_soporte: "Hola, necesito soporte tÃ©cnico para el sistema CONTROL 2026", modo_mantenimiento: false, mensaje_mantenimiento: "Sistema en mantenimiento. Intente mÃ¡s tarde." }
      };
      sheet.getRange(1, 1).setValue(JSON.stringify(configDefault));
    }
    
    let configJson = sheet.getRange(1, 1).getValue();
    let config = JSON.parse(configJson);
    config.supervisores = listarSupervisores();
    
    return config;
  } catch (error) {
    console.error("Error en obtenerConfiguraciones:", error);
    return { error: error.toString() };
  }
}

function guardarConfiguraciones(config) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    let ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(HOJA_CONFIGURACION);
    
    if (!sheet) sheet = ss.insertSheet(HOJA_CONFIGURACION);
    
    if (!config.ubicacion || !config.horarios || !config.registro || !config.otras) {
      return { error: "Estructura de configuraciÃ³n invÃ¡lida" };
    }
    
    sheet.getRange(1, 1).setValue(JSON.stringify(config));
    return { ok: true, mensaje: "ConfiguraciÃ³n guardada exitosamente" };
  } catch (error) {
    console.error("Error en guardarConfiguraciones:", error);
    return { error: error.toString() };
  } finally { lock.releaseLock(); }
}

function agregarSupervisor(empleadoId) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    const idLimpio = empleadoId.toString().trim();
    if (!idLimpio) return { error: "ID de empleado no vÃ¡lido" };
    
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    let fila = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][COLUMNAS_EMPLEADOS.ID].toString().trim() === idLimpio) {
        fila = i + 1;
        break;
      }
    }
    
    if (fila === -1) return { error: "Empleado no encontrado" };
    
    sheet.getRange(fila, COLUMNAS_EMPLEADOS.SUPERVISOR + 1).setValue("SI");
    return { ok: true, mensaje: "Supervisor agregado correctamente" };
  } catch (error) {
    console.error("Error en agregarSupervisor:", error);
    return { error: error.toString() };
  } finally { lock.releaseLock(); }
}

function eliminarSupervisor(empleadoId) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    const idLimpio = empleadoId.toString().trim();
    if (!idLimpio) return { error: "ID de empleado no vÃ¡lido" };
    
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    let fila = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][COLUMNAS_EMPLEADOS.ID].toString().trim() === idLimpio) {
        fila = i + 1;
        break;
      }
    }
    
    if (fila === -1) return { error: "Empleado no encontrado" };
    
    sheet.getRange(fila, COLUMNAS_EMPLEADOS.SUPERVISOR + 1).setValue("");
    return { ok: true, mensaje: "Supervisor eliminado correctamente" };
  } catch (error) {
    console.error("Error en eliminarSupervisor:", error);
    return { error: error.toString() };
  } finally { lock.releaseLock(); }
}

function listarSupervisores() {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
    const data = sheet.getDataRange().getValues();
    const supervisores = [];
    
    for (let i = 1; i < data.length; i++) {
      const esSupervisor = data[i][COLUMNAS_EMPLEADOS.SUPERVISOR]?.toString().trim().toUpperCase() === "SI";
      if (esSupervisor) {
        supervisores.push({
          id: data[i][COLUMNAS_EMPLEADOS.ID].toString().trim(),
          nombre: data[i][COLUMNAS_EMPLEADOS.NOMBRE]?.toString().trim() || "Sin nombre",
          area: data[i][COLUMNAS_EMPLEADOS.AREA]?.toString().trim() || ""
        });
      }
    }
    return supervisores;
  } catch (error) {
    console.error("Error en listarSupervisores:", error);
    return [];
  }
}

function registrarAlmuerzoExtra(params) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);
    
    const nombre = params.nombre?.toString().trim() || "Almuerzo Extra";
    
    let fecha = params.fecha;
    if (!fecha) {
      fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) return { error: "Fecha inválida" };
        fecha = Utilities.formatDate(fechaObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
    }
    
    const empresa = params.empresa?.toString().trim() || "";
    const tipo = params.tipo?.toString().trim() || "planta";
    const observaciones = params.observaciones?.toString().trim() || "";
    const cantidad = parseInt(params.cantidad) || 1;
    const horaRegistro = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss");
    const timestamp = new Date();
    
    let ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(HOJA_ALMUERZOS_EXTRA);
    
    if (!sheet) {
      sheet = ss.insertSheet(HOJA_ALMUERZOS_EXTRA);
      sheet.appendRow(["FECHA", "NOMBRE", "EMPRESA", "TIPO", "CANTIDAD", "HORA_REGISTRO", "TIMESTAMP", "OBSERVACIONES"]);
    }
    
    sheet.appendRow([fecha, nombre, empresa, tipo, cantidad, horaRegistro, timestamp, observaciones]);
    
  } finally { lock.releaseLock(); }
}

function obtenerAlmuerzosExtra() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(HOJA_ALMUERZOS_EXTRA);
    if (!sheet) return { ok: true, almuerzos: [] };
    var dataRange = sheet.getDataRange().getValues();
    if (dataRange.length <= 1) return { ok: true, almuerzos: [] };
    
    var tz = Session.getScriptTimeZone();
    var almuerzos = [];
    
    for (var i = 1; i < dataRange.length; i++) {
      var r = dataRange[i];
      var fechaVal = r[0];
      var fechaStr = '';
      if (fechaVal instanceof Date) {
        fechaStr = Utilities.formatDate(fechaVal, tz, 'yyyy-MM-dd');
      } else if (fechaVal) {
        var s = String(fechaVal).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          fechaStr = s.slice(0, 10);
        } else {
          var m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m1) {
            fechaStr = m1[3] + '-' + m1[2].padStart(2,'0') + '-' + m1[1].padStart(2,'0');
          } else {
            var d = new Date(s);
            fechaStr = isNaN(d.getTime()) ? s : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
          }
        }
      }
      
      var nombre = r[1] ? String(r[1]).trim() : '';
      var empresa = r[2] ? String(r[2]).trim() : '';
      var tipo = r[3] ? String(r[3]).trim() : '';
      var cantidad = parseInt(r[4]) || 0;
      var obs = r[7] ? String(r[7]).trim() : '';
      
      if (fechaStr && cantidad > 0) {
        almuerzos.push({
          fecha: fechaStr,
          nombre: nombre,
          empresa: empresa,
          tipo: tipo,
          cantidad: cantidad,
          observaciones: obs
        });
      }
    }
    return { ok: true, almuerzos: almuerzos };
  } catch (error) {
    console.error("Error en obtenerAlmuerzosExtra:", error);
    return { error: error.toString() };
  }
}

// =================== FUNCIONES PARA TERMINAL GUARDIA ===================
function verificarClaveGuardia(params) {
  try {
    const clave = params.clave?.toString().trim();
    if (!clave) return { ok: false, error: "Clave no proporcionada" };
    if (clave === CLAVE_GUARDIA) return { ok: true };
    return { ok: false, error: "Clave incorrecta" };
  } catch (error) {
    console.error("Error en verificarClaveGuardia:", error);
    return { ok: false, error: error.toString() };
  }
}

function validarClaveGuardia(clave) {
  return verificarClaveGuardia({ clave: clave });
}



// =================== FUNCIONES PARA CATERING (VERSIÃ“N CORREGIDA) ===================

/**
 * Obtiene los consumos de hoy con su estado desde CONSUMO_ALMUERZOS
 * Devuelve un Map con ID -> { consumido: true, hora: string }
 */
function obtenerConsumosHoyDetallados() {
  try {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName("CONSUMO_ALMUERZOS");
    
    if (!sheet) {
      console.log("ðŸ“ Creando hoja CONSUMO_ALMUERZOS");
      sheet = ss.insertSheet("CONSUMO_ALMUERZOS");
      const headers = ["ID_EMPLEADO", "NOMBRE_EMPLEADO", "FECHA", "HORA_CONSUMO", "TIMESTAMP", "REGISTRADO_POR", "ESTADO"];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#dc2626").setFontColor("#ffffff");
      console.log("âœ… Hoja CONSUMO_ALMUERZOS creada");
      return new Map();
    }
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const lastRow = sheet.getLastRow();
    
    console.log(`ðŸ“Š CONSUMO_ALMUERZOS: ${lastRow} filas totales, buscando fecha: ${hoyStr}`);
    
    if (lastRow <= 1) {
      console.log("âš ï¸ CONSUMO_ALMUERZOS vacÃ­a");
      return new Map();
    }
    
    const allData = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const consumosMap = new Map();
    
    let contadorHoy = 0;
    allData.forEach((row, index) => {
      try {
        const id = row[0]?.toString().trim() || '';
        let fecha = row[2]?.toString().trim() || '';
        
        // CORREGIDO: Normalizar fecha si es objeto Date
        if (row[2] instanceof Date) {
          fecha = Utilities.formatDate(row[2], timeZone, 'yyyy-MM-dd');
        }
        
        let hora = row[3]?.toString().trim() || '--:--';
        
        // CORREGIDO: Formatear hora si es objeto Date
        if (row[3] instanceof Date) {
          hora = Utilities.formatDate(row[3], timeZone, 'HH:mm');
        }
        
        if (!id) return;
        
        if (fecha === hoyStr) {
          contadorHoy++;
          if (!consumosMap.has(id)) {
            consumosMap.set(id, {
              consumido: true,
              hora: hora
            });
            console.log(`  âœ“ ${id} - Consumo registrado a las ${hora}`);
          }
        }
      } catch (e) {
        console.error(`Error procesando fila ${index}:`, e);
      }
    });
    
    console.log(`âœ… Consumos de hoy: ${contadorHoy} registros, ${consumosMap.size} empleados Ãºnicos`);
    return consumosMap;
  } catch (error) {
    console.error("âŒ Error en obtenerConsumosHoyDetallados:", error);
    return new Map();
  }
}

/**
 * Obtiene la lista de empleados para catering (CORREGIDA Y MEJORADA)
 */
function obtenerListaCatering(params) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheetEmpleados = ss.getSheetByName(HOJA_EMPLEADOS);
    const sheetRegistros = ss.getSheetByName(HOJA_REGISTROS);
    
    if (!sheetEmpleados || !sheetRegistros) {
      return { error: "Hojas no encontradas" };
    }
    
    const timeZone = Session.getScriptTimeZone();
    const hoy = new Date();
    const hoyStr = Utilities.formatDate(hoy, timeZone, 'yyyy-MM-dd');
    
    console.log(`ðŸ½ï¸ Catering: Buscando para la fecha ${hoyStr}`);
    
    // Obtener consumos de hoy
    const consumosHoyMap = obtenerConsumosHoyDetallados();
    
    // Obtener datos de empleados y registros
    const empleadosData = sheetEmpleados.getDataRange().getValues();
    const registrosData = sheetRegistros.getDataRange().getValues();
    
    // Crear mapa de registros de ENTRADA de hoy donde almuerzo = "SI"
    const registrosHoyMap = new Map();
    
    for (let i = 1; i < registrosData.length; i++) {
      const fila = registrosData[i];
      
      // Verificar que tenga fecha
      if (!fila[COLUMNAS.FECHA]) continue;
      
      // Obtener fecha como string
      let fechaStr = '';
      if (fila[COLUMNAS.FECHA] instanceof Date) {
        fechaStr = Utilities.formatDate(fila[COLUMNAS.FECHA], timeZone, 'yyyy-MM-dd');
      } else if (typeof fila[COLUMNAS.FECHA] === 'string') {
        fechaStr = fila[COLUMNAS.FECHA];
      }
      
      // Verificar si es hoy, es ENTRADA y almuerzo = "SI"
      const tipo = fila[COLUMNAS.TIPO]?.toString() || '';
      const almuerzo = fila[COLUMNAS.ALMUERZO]?.toString() || '';
      const id = fila[COLUMNAS.ID]?.toString().trim() || '';
      
      if (fechaStr === hoyStr && tipo === "ENTRADA" && almuerzo === "SI" && id) {
        // Evitar duplicados (solo primera entrada del dÃ­a)
        if (!registrosHoyMap.has(id)) {
          // CORREGIDO: Formatear la hora correctamente
          let horaEntrada = '--:--';
          let nombre = fila[COLUMNAS.NOMBRE]?.toString() || '';
          
          // Intentar obtener hora del campo HORA
          if (fila[COLUMNAS.HORA] && fila[COLUMNAS.HORA].toString().trim()) {
            horaEntrada = fila[COLUMNAS.HORA].toString().trim();
          } 
          // Si no, intentar obtener del timestamp
          else if (fila[COLUMNAS.TIMESTAMP]) {
            let fechaObj = fila[COLUMNAS.TIMESTAMP];
            if (!(fechaObj instanceof Date)) {
              fechaObj = new Date(fechaObj);
            }
            if (!isNaN(fechaObj.getTime())) {
              horaEntrada = Utilities.formatDate(fechaObj, timeZone, 'HH:mm');
            }
          }
          
          // CORREGIDO: Asegurar formato HH:MM
          if (horaEntrada && horaEntrada.includes('Dec 30 1899')) {
            // Extraer solo la hora si es una fecha antigua
            const match = horaEntrada.match(/(\d{2}:\d{2}:\d{2})/);
            if (match) {
              horaEntrada = match[1].substring(0, 5);
            } else {
              horaEntrada = '--:--';
            }
          }
          
          // Si la hora tiene segundos, quedarse solo con HH:MM
          if (horaEntrada && horaEntrada.length > 5 && horaEntrada.includes(':')) {
            horaEntrada = horaEntrada.substring(0, 5);
          }
          
          registrosHoyMap.set(id, {
            hora: horaEntrada,
            nombre: nombre
          });
          
          console.log(`  âœ“ Registro: ${id} - Almuerza en planta a las ${horaEntrada}`);
        }
      }
    }
    
    console.log(`ðŸ“‹ Registros de entrada hoy con almuerzo: ${registrosHoyMap.size}`);
    
    // Construir lista de catering
    const listaCatering = [];
    
    for (let i = 1; i < empleadosData.length; i++) {
      const fila = empleadosData[i];
      
      // Verificar si estÃ¡ activo
      const activo = esEmpleadoActivo(fila[COLUMNAS_EMPLEADOS.ACTIVO]);
      if (!activo) continue;
      
      const id = fila[COLUMNAS_EMPLEADOS.ID]?.toString().trim() || '';
      if (!id) continue;
      
      // Verificar si este empleado almuerza en planta hoy
      const registro = registrosHoyMap.get(id);
      if (!registro) continue;
      
      // Obtener datos del empleado
      let fotoUrl = fila[COLUMNAS_EMPLEADOS.FOTO_URL]?.toString() || '';
      if (fotoUrl) fotoUrl = convertirUrlDrive(fotoUrl);
      
      const consumo = consumosHoyMap.get(id);
      const consumido = consumo ? true : false;
      
      listaCatering.push({
        id: id,
        nombre: fila[COLUMNAS_EMPLEADOS.NOMBRE]?.toString() || 'Sin nombre',
        area: fila[COLUMNAS_EMPLEADOS.AREA]?.toString() || 'Sin Ã¡rea',
        foto_url: fotoUrl,
        hora_entrada: registro.hora, // Ahora es un string formateado correctamente
        consumido: consumido,
        hora_consumo: consumo ? consumo.hora : null
      });
    }
    
    // Ordenar: pendientes primero, luego por hora de entrada
    listaCatering.sort((a, b) => {
      if (a.consumido !== b.consumido) return a.consumido ? 1 : -1;
      const horaA = a.hora_entrada === '--:--' ? '99:99' : a.hora_entrada;
      const horaB = b.hora_entrada === '--:--' ? '99:99' : b.hora_entrada;
      return horaA.localeCompare(horaB);
    });
    
    console.log(`âœ… Catering completo: ${listaCatering.length} empleados`);
    console.log(`   - Consumidos: ${listaCatering.filter(e => e.consumido).length}`);
    console.log(`   - Pendientes: ${listaCatering.filter(e => !e.consumido).length}`);
    
    return { empleados: listaCatering };
    
  } catch (error) {
    console.error("âŒ Error en obtenerListaCatering:", error);
    return { error: error.toString() };
  }
}

/**
 * Marca un almuerzo como consumido (CORREGIDO)
 */
function marcarAlmuerzoConsumido(params) {
  // getDocumentLock: verifica que el mismo empleado no consuma almuerzo dos veces
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);
    
    const empleadoId = params.empleadoId?.toString().trim();
    const empleadoNombre = params.nombre?.toString().trim() || '';
    
    if (!empleadoId) return { error: "ID de empleado no vÃ¡lido" };
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const ahora = new Date();
    const horaRegistro = Utilities.formatDate(ahora, timeZone, 'HH:mm:ss');
    const timestamp = ahora;
    
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName("CONSUMO_ALMUERZOS");
    
    if (!sheet) {
      sheet = ss.insertSheet("CONSUMO_ALMUERZOS");
      const headers = ["ID_EMPLEADO", "NOMBRE_EMPLEADO", "FECHA", "HORA_CONSUMO", "TIMESTAMP", "REGISTRADO_POR", "ESTADO"];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#dc2626").setFontColor("#ffffff");
    }
    
    // Verificar si ya fue consumido hoy
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const allData = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      
      for (let i = 0; i < allData.length; i++) {
        const id = allData[i][0]?.toString().trim() || '';
        let fecha = allData[i][2]?.toString().trim() || '';
        
        // Normalizar fecha
        if (allData[i][2] instanceof Date) {
          fecha = Utilities.formatDate(allData[i][2], timeZone, 'yyyy-MM-dd');
        }
        
        if (id === empleadoId && fecha === hoyStr) {
          console.log(`âš ï¸ ${empleadoId} ya consumiÃ³ hoy`);
          return { error: "Este almuerzo ya fue marcado como consumido" };
        }
      }
    }
    
    // Registrar consumo
    sheet.appendRow([
      empleadoId, 
      empleadoNombre, 
      hoyStr, 
      horaRegistro, 
      timestamp, 
      "CATERING_APP",
      "CONSUMIDO"
    ]);
    
    console.log(`âœ… Consumo registrado: ${empleadoNombre} (${empleadoId}) a las ${horaRegistro}`);
    
    return { ok: true, mensaje: "Almuerzo marcado como consumido" };
  } catch (error) {
    console.error("âŒ Error en marcarAlmuerzoConsumido:", error);
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene estadÃ­sticas de consumo
 */
function obtenerEstadisticasConsumo(params) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName("CONSUMO_ALMUERZOS");
    
    if (!sheet) {
      return { 
        total_consumos: 0, 
        consumos_hoy: 0, 
        historial: [],
        mensaje: "Hoja CONSUMO_ALMUERZOS no existe aÃºn"
      };
    }
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const data = sheet.getDataRange().getValues();
    
    let totalConsumos = 0;
    let consumosHoy = 0;
    const historial = [];
    
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      const fecha = fila[2]?.toString() || '';
      const id = fila[0]?.toString() || '';
      const nombre = fila[1]?.toString() || '';
      const hora = fila[3]?.toString() || '';
      const registradoPor = fila[5]?.toString() || '';
      const estado = fila[6]?.toString() || '';
      
      totalConsumos++;
      
      if (fecha === hoyStr) {
        consumosHoy++;
      }
      
      historial.push({
        fecha: fecha,
        id: id,
        nombre: nombre,
        hora: hora,
        registrado_por: registradoPor,
        estado: estado
      });
    }
    
    return {
      total_consumos: totalConsumos,
      consumos_hoy: consumosHoy,
      historial: historial.sort((a, b) => b.fecha.localeCompare(a.fecha)),
      mensaje: "OK"
    };
  } catch (error) {
    console.error("❌ Error en obtenerEstadisticasConsumo:", error);
    return { error: error.toString() };
  }
}

// =================== FIN FUNCIONES CATERING ===================


// =================== ACTUALIZAR ALMUERZO SUPERVISOR ===================
/**
 * Actualiza o crea un registro directamente en la hoja REGISTROS (archivados)
 */
function actualizarRegistroArchivado(params) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
    if (!sheet) return { ok: false, error: "Hoja REGISTROS no encontrada" };
    
    const eid = String(params.empleadoId).trim();
    const fecha = params.fecha;
    const tipo = params.tipo;
    const campo = params.campo;
    const valor = params.valor;
    
    const data = sheet.getDataRange().getValues();
    const tz = Session.getScriptTimeZone();
    let filaIndex = -1;
    
    for (let i = 1; i < data.length; i++) {
      let fStr = '';
      if (data[i][COLUMNAS.FECHA] instanceof Date) {
        fStr = Utilities.formatDate(data[i][COLUMNAS.FECHA], tz, 'yyyy-MM-dd');
      } else {
        fStr = String(data[i][COLUMNAS.FECHA]).trim();
      }
      
      if (String(data[i][COLUMNAS.ID]).trim() === eid && fStr === fecha && String(data[i][COLUMNAS.TIPO]).trim() === tipo) {
        filaIndex = i + 1;
        break;
      }
    }
    
    if (filaIndex !== -1) {
      if (campo === 'timestamp') {
        var parsed = parsearTimestampGAS(valor);
        if (!parsed) return { ok: false, error: "Formato de timestamp inválido para Sheets: " + valor };
        sheet.getRange(filaIndex, COLUMNAS.TIMESTAMP + 1).setValue(parsed.timestampFormatted);
        sheet.getRange(filaIndex, COLUMNAS.FECHA + 1).setValue(parsed.fecha);
        sheet.getRange(filaIndex, COLUMNAS.HORA + 1).setValue(parsed.hora);
        sheet.getRange(filaIndex, COLUMNAS.DIA + 1).setValue(obtenerDiaEcuador(new Date(parsed.fecha + 'T12:00:00')));
        return { ok: true };
      }

      // Actualizar existente
      let colIdx = -1;
      // Mapear campo a columna
      if (campo === 'hora') colIdx = COLUMNAS.HORA;
      else if (campo === 'almuerzo') colIdx = COLUMNAS.ALMUERZO;
      else if (campo === 'modo' || campo === 'ubicacion') colIdx = COLUMNAS.MODO;
      else if (campo === 'horasExtra') colIdx = COLUMNAS.HORAS_EXTRA;
      else if (campo === 'razon_entrada_tardia') colIdx = COLUMNAS.RAZON_ENTRADA_TARDIA;
      else if (campo === 'razon_salida') colIdx = COLUMNAS.RAZON_SALIDA_TEMPRANA;
      else if (campo === 'justificado') {
        sheet.getRange(filaIndex, 20 + 1).setValue('SI');
        if (params.quien_justifica) sheet.getRange(filaIndex, COLUMNAS.QUIEN_JUSTIFICA + 1).setValue(params.quien_justifica);
        if (params.razon_justificac) sheet.getRange(filaIndex, 21 + 1).setValue(params.razon_justificac);
        return { ok: true };
      }
      
      if (colIdx !== -1) {
        sheet.getRange(filaIndex, colIdx + 1).setValue(valor);
        return { ok: true };
      }
      return { ok: false, error: "Campo no mapeado para Sheets" };
    } else {
      // Crear nuevo registro en Sheets si es completar hora o si es justificación
      if (campo === 'hora' || tipo === 'JUSTIFICACION' || campo === 'justificado') {
        const sheetEmp = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
        const emps = sheetEmp.getDataRange().getValues();
        let nombre = eid;
        for (let j = 1; j < emps.length; j++) {
          if (String(emps[j][COLUMNAS_EMPLEADOS.ID]).trim() === eid) {
            nombre = emps[j][COLUMNAS_EMPLEADOS.NOMBRE];
            break;
          }
        }
        
        const nuevaFila = new Array(22).fill('');
        nuevaFila[COLUMNAS.FECHA] = fecha;
        nuevaFila[COLUMNAS.ID] = eid;
        nuevaFila[COLUMNAS.NOMBRE] = nombre;
        nuevaFila[COLUMNAS.TIPO] = tipo || 'JUSTIFICACION';
        nuevaFila[COLUMNAS.HORA] = (campo === 'hora' ? valor : '00:00:00');
        nuevaFila[COLUMNAS.ALMUERZO] = "NO";
        nuevaFila[COLUMNAS.MODO] = "OFICINA";
        nuevaFila[COLUMNAS.HORAS_EXTRA] = "NO";
        nuevaFila[COLUMNAS.TIMESTAMP] = new Date();
        nuevaFila[COLUMNAS.DIA] = obtenerDiaEcuador(new Date(fecha + 'T12:00:00'));
        
        if (campo === 'justificado' || tipo === 'JUSTIFICACION') {
          nuevaFila[20] = 'SI';
          nuevaFila[COLUMNAS.QUIEN_JUSTIFICA] = params.quien_justifica || '';
          nuevaFila[21] = params.razon_justificac || '';
        }
        
        sheet.appendRow(nuevaFila);
        return { ok: true };
      }
      return { ok: false, error: "Registro no encontrado y no es creación de hora/justificación" };
    }
  } catch (error) {
    console.error("Error en actualizarRegistroArchivado:", error);
    return { ok: false, error: error.toString() };
  }
}

/**
 * Elimina un registro de la hoja REGISTROS
 */
function eliminarRegistroArchivado(params) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_REGISTROS);
    if (!sheet) return { ok: false, error: "Hoja REGISTROS no encontrada" };
    
    const eid = String(params.empleadoId).trim();
    const fecha = params.fecha;
    const tipo = params.tipo;
    
    const data = sheet.getDataRange().getValues();
    const tz = Session.getScriptTimeZone();
    
    for (let i = data.length - 1; i >= 1; i--) {
      let fStr = '';
      if (data[i][COLUMNAS.FECHA] instanceof Date) {
        fStr = Utilities.formatDate(data[i][COLUMNAS.FECHA], tz, 'yyyy-MM-dd');
      } else {
        fStr = String(data[i][COLUMNAS.FECHA]).trim();
      }
      
      if (String(data[i][COLUMNAS.ID]).trim() === eid && fStr === fecha && String(data[i][COLUMNAS.TIPO]).trim() === tipo) {
        sheet.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: "Registro no encontrado en Sheets" };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function actualizarAlmuerzoSupervisor(params) {
  // getDocumentLock: el supervisor actualiza filas de otros usuarios
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);
    
    const empleadoId = params.empleadoId?.toString().trim();
    const nuevoAlmuerzo = params.almuerzo?.toString().trim().toUpperCase();
    
    if (!empleadoId) return { error: "ID de empleado no vÃ¡lido" };
    if (!["SI", "NO"].includes(nuevoAlmuerzo)) return { error: "Valor de almuerzo no vÃ¡lido. Use SI o NO" };
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    
    const ss = SpreadsheetApp.getActive();
    const sheetRegistros = ss.getSheetByName(HOJA_REGISTROS);
    
    if (!sheetRegistros) return { error: "Hoja REGISTROS no encontrada" };
    
    // Buscar el registro de entrada de hoy para este empleado
    const data = sheetRegistros.getDataRange().getValues();
    let filaEncontrada = -1;
    let valorAnterior = "";
    let empleadoNombre = "";
    
    for (let i = 1; i < data.length; i++) {
      const fecha = data[i][COLUMNAS.FECHA];
      let fechaStr = '';
      if (fecha instanceof Date) {
        fechaStr = Utilities.formatDate(fecha, timeZone, 'yyyy-MM-dd');
      } else if (typeof fecha === 'string') {
        fechaStr = fecha;
      }
      
      const id = data[i][COLUMNAS.ID]?.toString().trim() || '';
      const tipo = data[i][COLUMNAS.TIPO]?.toString() || '';
      
      if (fechaStr === hoyStr && id === empleadoId && (tipo === "ENTRADA" || tipo === "SOLO_ALMUERZO")) {
        filaEncontrada = i + 1;
        valorAnterior = data[i][COLUMNAS.ALMUERZO]?.toString() || '';
        empleadoNombre = data[i][COLUMNAS.NOMBRE]?.toString() || '';
        break;
      }
    }
    
    if (filaEncontrada === -1) {
      // Si no hay registro previo de ENTRADA o SOLO_ALMUERZO, lo creamos para usuarios sin asistencia.
      const infoEmpleado = obtenerInfoEmpleado(empleadoId);
      empleadoNombre = infoEmpleado.encontrado ? infoEmpleado.nombre : 'Desconocido';
      const ahora = new Date();
      const nuevaFila = new Array(21).fill("");
      nuevaFila[COLUMNAS.FECHA] = hoyStr;
      nuevaFila[COLUMNAS.ID] = empleadoId;
      nuevaFila[COLUMNAS.NOMBRE] = empleadoNombre;
      nuevaFila[COLUMNAS.TIPO] = "SOLO_ALMUERZO";
      nuevaFila[COLUMNAS.ALMUERZO] = nuevoAlmuerzo;
      nuevaFila[COLUMNAS.HORA] = Utilities.formatDate(ahora, timeZone, 'HH:mm:ss');
      nuevaFila[COLUMNAS.TIMESTAMP] = ahora;
      nuevaFila[COLUMNAS.DIA] = obtenerDiaEcuador(ahora);
      nuevaFila[COLUMNAS.MODO] = "OFICINA";
      nuevaFila[COLUMNAS.HORAS_EXTRA] = "NO";
      
      sheetRegistros.appendRow(nuevaFila);
      valorAnterior = "NINGUNO";
    } else {
      // Actualizar el campo de almuerzo
      sheetRegistros.getRange(filaEncontrada, COLUMNAS.ALMUERZO + 1).setValue(nuevoAlmuerzo);
    }
    
    // Registrar en hoja de auditorÃ­a
    let sheetAuditoria = ss.getSheetByName("AUDITORIA_ALMUERZOS");
    if (!sheetAuditoria) {
      sheetAuditoria = ss.insertSheet("AUDITORIA_ALMUERZOS");
      sheetAuditoria.getRange(1, 1, 1, 7).setValues([["FECHA", "HORA", "EMPLEADO_ID", "EMPLEADO_NOMBRE", "VALOR_ANTERIOR", "VALOR_NUEVO", "MODIFICADO_POR"]]);
      sheetAuditoria.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#6366f1").setFontColor("#ffffff");
    }
    
    const ahora = new Date();
    const horaActual = Utilities.formatDate(ahora, timeZone, 'HH:mm:ss');
    
    sheetAuditoria.appendRow([hoyStr, horaActual, empleadoId, empleadoNombre, valorAnterior, nuevoAlmuerzo, "SUPERVISOR"]);
    
    return { ok: true, mensaje: "Almuerzo actualizado correctamente" };
    
  } catch (error) {
    console.error("Error en actualizarAlmuerzoSupervisor:", error);
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// =================== OBTENER DATOS SUPERVISOR ACTUALIZADO ===================
function obtenerDatosSupervisor(params) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheetEmpleados = ss.getSheetByName(HOJA_EMPLEADOS);
    const sheetRegistros = ss.getSheetByName(HOJA_REGISTROS);
    const sheetAuditoria = ss.getSheetByName("AUDITORIA_ALMUERZOS");
    
    if (!sheetEmpleados || !sheetRegistros) {
      return { error: "Hojas no encontradas" };
    }
    
    const timeZone = Session.getScriptTimeZone();
    const hoy = new Date();
    const hoyStr = Utilities.formatDate(hoy, timeZone, 'yyyy-MM-dd');
    
    // Obtener IDs de empleados con almuerzo editado hoy
    const registrosEditadosHoy = new Set();
    if (sheetAuditoria) {
      const auditoriaData = sheetAuditoria.getDataRange().getValues();
      for (let i = 1; i < auditoriaData.length; i++) {
        const fecha = auditoriaData[i][0]?.toString() || '';
        if (fecha === hoyStr) {
          const empleadoId = auditoriaData[i][2]?.toString().trim();
          if (empleadoId) registrosEditadosHoy.add(empleadoId);
        }
      }
    }
    
    // Obtener datos de empleados
    const empleadosData = sheetEmpleados.getDataRange().getValues();
    const registrosData = sheetRegistros.getDataRange().getValues();
    
    // Procesar registros
    const registros = [];
    for (let i = 1; i < registrosData.length; i++) {
      const fila = registrosData[i];
      if (!fila[COLUMNAS.FECHA]) continue;
      
      let fechaStr = '';
      if (fila[COLUMNAS.FECHA] instanceof Date) {
        fechaStr = Utilities.formatDate(fila[COLUMNAS.FECHA], timeZone, 'yyyy-MM-dd');
      } else if (typeof fila[COLUMNAS.FECHA] === 'string') {
        fechaStr = fila[COLUMNAS.FECHA];
      }
      
      let timestampStr = '';
      if (fila[COLUMNAS.TIMESTAMP] instanceof Date) {
        timestampStr = fila[COLUMNAS.TIMESTAMP].toISOString();
      }
      
      registros.push({
        fecha: fechaStr,
        id: fila[COLUMNAS.ID]?.toString() || '',
        nombre: fila[COLUMNAS.NOMBRE]?.toString() || '',
        tipo: fila[COLUMNAS.TIPO]?.toString() || '',
        almuerzo: fila[COLUMNAS.ALMUERZO]?.toString() || '',
        hora: fila[COLUMNAS.HORA]?.toString() || '',
        timestamp: timestampStr,
        dispositivo: fila[COLUMNAS.DISPOSITIVO]?.toString() || ''
      });
    }
    
    // Procesar empleados
    const empleados = [];
    for (let i = 1; i < empleadosData.length; i++) {
      const fila = empleadosData[i];
      const activo = esEmpleadoActivo(fila[COLUMNAS_EMPLEADOS.ACTIVO]);
      if (!activo) continue;
      
      const id = fila[COLUMNAS_EMPLEADOS.ID]?.toString() || '';
      const nombre = fila[COLUMNAS_EMPLEADOS.NOMBRE]?.toString() || '';
      const area = fila[COLUMNAS_EMPLEADOS.AREA]?.toString() || '';
      let fotoUrl = fila[COLUMNAS_EMPLEADOS.FOTO_URL]?.toString() || '';
      if (fotoUrl) fotoUrl = convertirUrlDrive(fotoUrl);
      
      // Filtrar registros del empleado
      const registrosEmpleado = registros.filter(r => r.id === id);
      
      // Buscar registro de hoy
      const registroHoy = registrosEmpleado.filter(r => r.fecha === hoyStr);
      const entradaHoy = registroHoy.find(r => r.tipo === 'ENTRADA');
      const salidaHoy = registroHoy.find(r => r.tipo === 'SALIDA');
      const soloAlmuerzoHoy = registroHoy.find(r => r.tipo === 'SOLO_ALMUERZO');
      
      let horaEntradaMs = null;
      let horaSalidaMs = null;
      let almuerzoHoy = null;
      
      if (entradaHoy) {
        almuerzoHoy = entradaHoy.almuerzo || "NO";
        if (entradaHoy.timestamp) {
          horaEntradaMs = new Date(entradaHoy.timestamp).getTime();
        } else if (entradaHoy.hora) {
          const [h, m, s] = entradaHoy.hora.split(':');
          const fechaBase = new Date();
          fechaBase.setHours(parseInt(h), parseInt(m), parseInt(s) || 0);
          horaEntradaMs = fechaBase.getTime();
        }
      } else if (soloAlmuerzoHoy) {
        almuerzoHoy = soloAlmuerzoHoy.almuerzo || "NO";
      }
      
      if (salidaHoy) {
        if (salidaHoy.timestamp) {
          horaSalidaMs = new Date(salidaHoy.timestamp).getTime();
        } else if (salidaHoy.hora) {
          const [h, m, s] = salidaHoy.hora.split(':');
          const fechaBase = new Date();
          fechaBase.setHours(parseInt(h), parseInt(m), parseInt(s) || 0);
          horaSalidaMs = fechaBase.getTime();
        }
      }
      
      empleados.push({
        id: id,
        nombre: nombre,
        area: area,
        foto_url: fotoUrl,
        activo: true,
        entradaHoy: !!entradaHoy,
        salidaHoy: !!salidaHoy,
        almuerzoHoy: almuerzoHoy,
        horaEntradaMs: horaEntradaMs,
        horaSalidaMs: horaSalidaMs,
        registros: registrosEmpleado
      });
    }
    
    return {
      empleados: empleados,
      registros: registros,
      registrosEditados: Array.from(registrosEditadosHoy)
    };
    
  } catch (error) {
    console.error("Error en obtenerDatosSupervisor:", error);
    return { error: error.toString() };
  }
}
// =================== COORDINACIÃ“N DE PRODUCCIÃ“N ===================

function obtenerEmpleadosTaller() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheetEmp = ss.getSheetByName(HOJA_EMPLEADOS);
    const sheetReg = ss.getSheetByName(HOJA_REGISTROS);
    const empleados = sheetEmp.getDataRange().getValues();
    const registros = sheetReg.getDataRange().getValues();
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    
    // Mapa de autorizaciones de hoy: ID -> { autorizado: SI/NO, ubicacion: CAMPO/EMPRESA }
    const authMapa = new Map();
    for (let i = 1; i < registros.length; i++) {
        let fStr = "";
        if (registros[i][COLUMNAS.FECHA] instanceof Date) fStr = Utilities.formatDate(registros[i][COLUMNAS.FECHA], timeZone, 'yyyy-MM-dd');
        else fStr = registros[i][COLUMNAS.FECHA]?.toString() || "";
        
        if (fStr === hoyStr) {
            const id = registros[i][COLUMNAS.ID].toString().trim();
            authMapa.set(id, {
                autorizado: registros[i][COLUMNAS.HORAS_EXTRA] || "NO",
                ubicacion: registros[i][COLUMNAS.UBICACION] || "EMPRESA"
            });
        }
    }
    
    const taller = [];
    for (let i = 1; i < empleados.length; i++) {
        const area = empleados[i][COLUMNAS_EMPLEADOS.AREA]?.toString().trim().toUpperCase();
        const activo = esEmpleadoActivo(empleados[i][COLUMNAS_EMPLEADOS.ACTIVO]);
        
        if (activo && (area === "TALLER" || area === "PRODUCCION")) {
            const id = empleados[i][COLUMNAS_EMPLEADOS.ID]?.toString().trim();
            const infoAuth = authMapa.get(id) || { autorizado: "NO", ubicacion: "EMPRESA" };
            
            taller.push({
                id: id,
                nombre: empleados[i][COLUMNAS_EMPLEADOS.NOMBRE]?.toString().trim(),
                authExtras: infoAuth.autorizado,
                ubicacion: infoAuth.ubicacion
            });
        }
    }
    return { empleados: taller };
  } catch (error) {
    return { error: error.toString() };
  }
}

function actualizarAutorizacionExtras(empleadoId, autorizado, autorizaNombre) {
  // getDocumentLock: el coordinador actualiza filas de otros empleados
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(HOJA_REGISTROS);
    if (!sheet) return { error: "Hoja REGISTROS no encontrada" };
    
    const timeZone = Session.getScriptTimeZone();
    const hoyStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const data = sheet.getDataRange().getValues();
    
    let filaEncontrada = -1;
    // Buscar de atrÃ¡s hacia adelante para encontrar el registro mÃ¡s reciente de hoy
    for (let i = data.length - 1; i >= 1; i--) {
      const fechaFila = data[i][COLUMNAS.FECHA];
      let fStr = "";
      if (fechaFila instanceof Date) fStr = Utilities.formatDate(fechaFila, timeZone, 'yyyy-MM-dd');
      else fStr = fechaFila?.toString() || "";
      
      if (data[i][COLUMNAS.ID].toString().trim() === empleadoId.toString().trim() && fStr === hoyStr) {
        filaEncontrada = i + 1;
        break;
      }
    }
    
    if (filaEncontrada === -1) {
      return { error: "No se encontrÃ³ registro para el empleado hoy. Debe marcar entrada primero." };
    }
    
    // Actualizar columnas M y N
    sheet.getRange(filaEncontrada, COLUMNAS.HORAS_EXTRA + 1).setValue(autorizado);
    sheet.getRange(filaEncontrada, COLUMNAS.AUTORIZA + 1).setValue(autorizaNombre || "SUPERVISOR");
    
    return { ok: true, mensaje: `Registro de hoy actualizado a ${autorizado}` };
  } catch (error) {
    return { error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resetea todas las autorizaciones de horas extras a "NO".
 * Se recomienda configurar un activador de tiempo (trigger) para ejecutar esto a medianoche.
 */
function resetearAutorizacionesDiarias() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
  if (!sheet) return { error: "Hoja no encontrada" };
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, mensaje: "No hay empleados para resetear" };
  
  const colIndex = COLUMNAS_EMPLEADOS.AUTH_EXTRAS + 1;
  const values = new Array(lastRow - 1).fill(["NO"]);
  
  sheet.getRange(2, colIndex, lastRow - 1, 1).setValues(values);
  console.log("Autorizaciones de horas extras reseteadas a NO");
  return { ok: true, mensaje: "Reseteo completado" };
}

// =======================================================
// EXPORTADOR PARA MIGRACIÓN A FIREBASE
// =======================================================
function exportarBaseDatosParaFirebase() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.getActive();
    
    // 1. Exportar Empleados
    const hojaEmpleados = ss.getSheetByName(HOJA_EMPLEADOS);
    const dataEmpleados = hojaEmpleados.getDataRange().getValues();
    const empleados = [];
    for (let i = 1; i < dataEmpleados.length; i++) {
      const fila = dataEmpleados[i];
      if (fila[COLUMNAS_EMPLEADOS.ID]) {
        empleados.push({
          id: fila[COLUMNAS_EMPLEADOS.ID].toString().trim(),
          nombre: fila[COLUMNAS_EMPLEADOS.NOMBRE] || "",
          area: fila[COLUMNAS_EMPLEADOS.AREA] || "",
          activo: fila[COLUMNAS_EMPLEADOS.ACTIVO] || "SI",
          foto_url: fila[COLUMNAS_EMPLEADOS.FOTO_URL] || "",
          id_dispositivo: fila[COLUMNAS_EMPLEADOS.ID_DISPOSITIVO] || "",
          pin: fila[COLUMNAS_EMPLEADOS.PIN] || "",
          deviceToken: fila[COLUMNAS_EMPLEADOS.DEVICE_TOKEN] || "",
          supervisor: fila[COLUMNAS_EMPLEADOS.SUPERVISOR] || "NO",
          cargo: fila[COLUMNAS_EMPLEADOS.CARGO] || "",
          fechaNacimiento: fila[COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO] ? formatearFecha(new Date(fila[COLUMNAS_EMPLEADOS.FECHA_NACIMIENTO])) : "",
          baseLat: fila[COLUMNAS_EMPLEADOS.BASE_LAT] || null,
          baseLng: fila[COLUMNAS_EMPLEADOS.BASE_LNG] || null,
          authExtras: fila[COLUMNAS_EMPLEADOS.AUTH_EXTRAS] || "NO"
        });
      }
    }
    
    // 2. Exportar Registros (últimos 30 días para no saturar memoria)
    const hojaRegistros = ss.getSheetByName(HOJA_REGISTROS);
    const dataRegistros = hojaRegistros.getDataRange().getValues();
    const registros = [];
    
    // Solo leemos de abajo hacia arriba para coger los más recientes
    const timeZone = Session.getScriptTimeZone();
    const limite = Math.max(1, dataRegistros.length - 2000); // Max 2000 registros
    for (let i = dataRegistros.length - 1; i >= limite; i--) {
      const fila = dataRegistros[i];
      if (fila[COLUMNAS.ID]) {
        let fechaParse = new Date(fila[COLUMNAS.TIMESTAMP]);
        if (isNaN(fechaParse.getTime())) fechaParse = new Date();
        
        // Formatear fecha y hora explícitamente en la zona horaria local para evitar desfases UTC
        let fechaFila = fila[COLUMNAS.FECHA];
        let fechaStr = "";
        if (fechaFila instanceof Date) fechaStr = Utilities.formatDate(fechaFila, timeZone, "yyyy-MM-dd");
        else fechaStr = fechaFila ? fechaFila.toString() : "";

        let horaFila = fila[COLUMNAS.HORA];
        let horaStr = "";
        if (horaFila instanceof Date) horaStr = Utilities.formatDate(horaFila, timeZone, "HH:mm:ss");
        else horaStr = horaFila ? horaFila.toString() : "";

        registros.push({
          fecha: fechaStr,
          empleadoId: fila[COLUMNAS.ID].toString().trim(),
          nombre: fila[COLUMNAS.NOMBRE] || "",
          tipo: fila[COLUMNAS.TIPO] || "",
          almuerzo: fila[COLUMNAS.ALMUERZO] || "",
          hora: horaStr,
          lat: parseFloat(fila[COLUMNAS.LAT]) || null,
          lng: parseFloat(fila[COLUMNAS.LNG]) || null,
          dispositivo: fila[COLUMNAS.DISPOSITIVO] || "",
          timestamp: fechaParse.toISOString(),
          dia: fila[COLUMNAS.DIA] || "",
          modo: fila[COLUMNAS.MODO] || "OFICINA",
          horasExtra: fila[COLUMNAS.HORAS_EXTRA] || "NO",
          autoriza: fila[COLUMNAS.AUTORIZA] || "",
          razon_salida_temprana: fila[COLUMNAS.RAZON_SALIDA_TEMPRANA] || "",
          quien_justifica: fila[COLUMNAS.QUIEN_JUSTIFICA] || "",
          razon_entrada_tardia: fila[COLUMNAS.RAZON_ENTRADA_TARDIA] || "",
          quien_justifica_entrada: fila[COLUMNAS.QUIEN_JUSTIFICA_ENTRADA] || "",
          tipo_salida: fila[COLUMNAS.TIPO_SALIDA] || "",
          razon_permiso: fila[COLUMNAS.RAZON_PERMISO] || ""
        });
      }
    }
    
    // 3. Dispositivos Activos
    const hojaDispositivos = ss.getSheetByName(HOJA_DISPOSITIVOS);
    const dataDisp = hojaDispositivos ? hojaDispositivos.getDataRange().getValues() : [];
    const dispositivos = [];
    for (let i = 1; i < dataDisp.length; i++) {
      if (dataDisp[i][0]) {
        dispositivos.push({
          id_dispositivo: dataDisp[i][0].toString(),
          id_empleado: dataDisp[i][1] ? dataDisp[i][1].toString() : "",
          activo: true
        });
      }
    }
    
    // 4. Configuración
    const hojaConfig = ss.getSheetByName(HOJA_CONFIGURACION);
    const configData = hojaConfig ? hojaConfig.getRange(1, 1).getValue() : "";

    return { 
      ok: true, 
      empleados: empleados,
      registros: registros,
      dispositivos: dispositivos,
      configuracion: configData
    };
    
  } catch (e) {
    return { error: "Error exportando datos: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function parsearTimestampGAS(tsString) {
  if (!tsString) return null;
  tsString = String(tsString).trim();
  const regexDMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
  const regexYMD = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;

  var year, month, day, hour, minute, second;
  var match = tsString.match(regexDMY);
  if (match) {
    day = String(match[1]).padStart(2, '0');
    month = String(match[2]).padStart(2, '0');
    year = match[3];
    hour = String(match[4]).padStart(2, '0');
    minute = String(match[5]).padStart(2, '0');
    second = String(match[6] || '00').padStart(2, '0');
  } else {
    match = tsString.match(regexYMD);
    if (match) {
      year = match[1];
      month = String(match[2]).padStart(2, '0');
      day = String(match[3]).padStart(2, '0');
      hour = String(match[4]).padStart(2, '0');
      minute = String(match[5]).padStart(2, '0');
      second = String(match[6] || '00').padStart(2, '0');
    } else {
      var d = new Date(tsString);
      if (isNaN(d.getTime())) return null;
      year = d.getFullYear();
      month = String(d.getMonth() + 1).padStart(2, '0');
      day = String(d.getDate()).padStart(2, '0');
      hour = String(d.getHours()).padStart(2, '0');
      minute = String(d.getMinutes()).padStart(2, '0');
      second = String(d.getSeconds()).padStart(2, '0');
    }
  }
  return {
    fecha: year + "-" + month + "-" + day,
    hora: hour + ":" + minute + ":" + second,
    timestampFormatted: day + "/" + month + "/" + year + " " + hour + ":" + minute + ":" + second
  };
}