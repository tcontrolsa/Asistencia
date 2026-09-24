function procesarRegistros() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaRegistros = ss.getSheetByName("REGISTROS");
  var hojaEmpleados = ss.getSheetByName("EMPLEADOS");
  var hojaBase = ss.getSheetByName("BASE");
  
  // Verificar que exista la hoja EMPLEADOS
  if (!hojaEmpleados) {
    SpreadsheetApp.getUi().alert("No se encuentra la hoja 'EMPLEADOS'. Por favor, créela con las columnas: ID, NOMBRE");
    return;
  }
  
  // Verificar que exista la hoja BASE, si no, crearla
  if (!hojaBase) {
    hojaBase = ss.insertSheet("BASE");
    hojaBase.getRange("A1:D1").setValues([["ID de Usuario", "Nombre", "Tiempo", "Estado de Trabajo"]]);
    hojaBase.getRange("G1").setValue("FECHA A PROCESAR");
    hojaBase.getRange("H1").setValue("dd/mm/yyyy");
  }
  
  // Leer la fecha desde G1
  var fechaG1 = hojaBase.getRange("G1").getValue();
  if (!fechaG1 || fechaG1 === "FECHA A PROCESAR") {
    SpreadsheetApp.getUi().alert("Por favor, ingrese una fecha válida en la celda G1 de la hoja BASE");
    return;
  }
  
  // Convertir fecha G1 a objeto Date y formatear para comparación
  var fechaProcesar = null;
  var fechaProcesarStr = "";
  var fechaProcesarVisual = "";
  
  if (fechaG1 instanceof Date) {
    fechaProcesar = fechaG1;
    fechaProcesarStr = Utilities.formatDate(fechaProcesar, Session.getScriptTimeZone(), "yyyy-MM-dd");
    fechaProcesarVisual = Utilities.formatDate(fechaProcesar, Session.getScriptTimeZone(), "d/M/yyyy");
  } else if (typeof fechaG1 === "string") {
    fechaProcesar = new Date(fechaG1);
    fechaProcesarStr = Utilities.formatDate(fechaProcesar, Session.getScriptTimeZone(), "yyyy-MM-dd");
    fechaProcesarVisual = Utilities.formatDate(fechaProcesar, Session.getScriptTimeZone(), "d/M/yyyy");
  }
  
  Logger.log("Procesando fecha: " + fechaProcesarStr);
  
  // Leer todos los empleados de la hoja EMPLEADOS
  var ultimaFilaEmpleados = hojaEmpleados.getLastRow();
  if (ultimaFilaEmpleados <= 1) {
    SpreadsheetApp.getUi().alert("La hoja 'EMPLEADOS' no tiene datos");
    return;
  }
  
  var datosEmpleados = hojaEmpleados.getRange(2, 1, ultimaFilaEmpleados - 1, 2).getValues();
  
  // Crear mapa de empleados (ID -> Nombre)
  var mapaEmpleados = {};
  for (var i = 0; i < datosEmpleados.length; i++) {
    var id = datosEmpleados[i][0];
    var nombre = datosEmpleados[i][1];
    if (id && nombre) {
      mapaEmpleados[id.toString()] = formatearNombre(nombre.toString());
    }
  }
  
  // Obtener datos de REGISTROS
  var ultimaFila = hojaRegistros.getLastRow();
  var registrosFiltrados = [];
  
  if (ultimaFila > 1) {
    var datos = hojaRegistros.getRange(2, 1, ultimaFila - 1, 10).getValues();
    
    // Filtrar solo registros de la fecha en G1
    for (var i = 0; i < datos.length; i++) {
      var fila = datos[i];
      var fechaRegistro = fila[0];
      var fechaRegistroStr = "";
      
      if (fechaRegistro instanceof Date) {
        fechaRegistroStr = Utilities.formatDate(fechaRegistro, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else if (typeof fechaRegistro === "string") {
        var fechaTemp = new Date(fechaRegistro);
        fechaRegistroStr = Utilities.formatDate(fechaTemp, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
      
      if (fechaRegistroStr === fechaProcesarStr) {
        registrosFiltrados.push(fila);
      }
    }
  }
  
  // Función para formatear nombre: "APELLIDO NOMBRE" -> "Apellido Nombre"
  function formatearNombre(nombreCompleto) {
    if (!nombreCompleto || typeof nombreCompleto !== "string") return nombreCompleto;
    
    // Convertir a minúsculas y luego capitalizar cada palabra
    var palabras = nombreCompleto.toLowerCase().split(" ");
    for (var i = 0; i < palabras.length; i++) {
      if (palabras[i].length > 0) {
        palabras[i] = palabras[i].charAt(0).toUpperCase() + palabras[i].slice(1);
      }
    }
    return palabras.join(" ");
  }
  
  // Agrupar registros de asistencia por ID
  var mapaAsistencia = {};
  
  for (var i = 0; i < registrosFiltrados.length; i++) {
    var fila = registrosFiltrados[i];
    var id = fila[1].toString();
    var nombreOriginal = fila[2];
    var tipo = fila[3];
    var hora = fila[5];
    
    var nombreFormateado = formatearNombre(nombreOriginal);
    
    if (!mapaAsistencia[id]) {
      mapaAsistencia[id] = {
        id: id,
        nombre: nombreFormateado,
        entradaHora: null,
        salidaHora: null,
        entradaTieneHora: false,
        salidaTieneHora: false
      };
    }
    
    // Procesar hora
    var horaStr = "";
    var tieneHora = false;
    
    if (hora instanceof Date) {
      horaStr = Utilities.formatDate(hora, Session.getScriptTimeZone(), "HH:mm");
      tieneHora = true;
    } else if (typeof hora === "string" && hora.trim() !== "") {
      horaStr = hora.substring(0, 5);
      tieneHora = true;
    }
    
    if (tipo === "ENTRADA") {
      mapaAsistencia[id].entradaHora = horaStr;
      mapaAsistencia[id].entradaTieneHora = tieneHora;
    } else if (tipo === "SALIDA") {
      mapaAsistencia[id].salidaHora = horaStr;
      mapaAsistencia[id].salidaTieneHora = tieneHora;
    }
  }
  
  // Generar resultados para todos los empleados
  var nuevosRegistros = [];
  
  // Primero, procesar empleados que asistieron (están en mapaAsistencia)
  for (var id in mapaAsistencia) {
    var reg = mapaAsistencia[id];
    
    // Hora por defecto para asistentes
    var horaEntrada = reg.entradaHora || "07:30";
    var horaSalida = reg.salidaHora || "16:15";
    var tieneHoraEntrada = reg.entradaTieneHora;
    var tieneHoraSalida = reg.salidaTieneHora;
    
    // Formatear tiempo ENTRADA
    var tiempoEntrada = tieneHoraEntrada ? (fechaProcesarVisual + " " + horaEntrada) : fechaProcesarVisual;
    
    // Formatear tiempo SALIDA
    var tiempoSalida = tieneHoraSalida ? (fechaProcesarVisual + " " + horaSalida) : fechaProcesarVisual;
    
    nuevosRegistros.push({
      id: reg.id,
      nombre: reg.nombre,
      tiempo: tiempoEntrada,
      estado: "Entrada",
      fechaObj: fechaProcesar,
      horaOrden: tieneHoraEntrada ? horaEntrada : "00:00",
      nombreLower: reg.nombre.toLowerCase(),
      tipoOrden: 1
    });
    
    nuevosRegistros.push({
      id: reg.id,
      nombre: reg.nombre,
      tiempo: tiempoSalida,
      estado: "Salida",
      fechaObj: fechaProcesar,
      horaOrden: tieneHoraSalida ? horaSalida : "23:59",
      nombreLower: reg.nombre.toLowerCase(),
      tipoOrden: 2
    });
  }
  
  // Segundo, procesar empleados que faltaron (están en mapaEmpleados pero no en mapaAsistencia)
  for (var id in mapaEmpleados) {
    if (!mapaAsistencia[id]) {
      var nombreEmpleado = mapaEmpleados[id];
      var tiempoAusencia = fechaProcesarVisual + " 0:00:00";
      
      // Registro de ausencia - ENTRADA
      nuevosRegistros.push({
        id: id,
        nombre: nombreEmpleado,
        tiempo: tiempoAusencia,
        estado: "ausencia entrada",
        fechaObj: fechaProcesar,
        horaOrden: "00:00",
        nombreLower: nombreEmpleado.toLowerCase(),
        tipoOrden: 3
      });
      
      // Registro de ausencia - SALIDA
      nuevosRegistros.push({
        id: id,
        nombre: nombreEmpleado,
        tiempo: tiempoAusencia,
        estado: "ausencia salida",
        fechaObj: fechaProcesar,
        horaOrden: "00:00",
        nombreLower: nombreEmpleado.toLowerCase(),
        tipoOrden: 4
      });
    }
  }
  
  // Ordenar: primero por fecha, luego alfabéticamente, luego entrada/salida/ausencia
  nuevosRegistros.sort(function(a, b) {
    // 1. Por fecha
    if (a.fechaObj.getTime() !== b.fechaObj.getTime()) {
      return a.fechaObj.getTime() - b.fechaObj.getTime();
    }
    // 2. Por nombre alfabéticamente (A-Z)
    if (a.nombreLower < b.nombreLower) return -1;
    if (a.nombreLower > b.nombreLower) return 1;
    // 3. Orden: Entrada (1), Salida (2), ausencia entrada (3), ausencia salida (4)
    return a.tipoOrden - b.tipoOrden;
  });
  
  // Limpiar toda la hoja BASE (columnas A-D) excepto encabezados
  var ultimaFilaBase = hojaBase.getLastRow();
  if (ultimaFilaBase > 1) {
    hojaBase.getRange(2, 1, ultimaFilaBase - 1, 4).clearContent();
  }
  
  // Preparar los nuevos registros para escribir
  var datosAInsertar = [];
  for (var i = 0; i < nuevosRegistros.length; i++) {
    datosAInsertar.push([
      nuevosRegistros[i].id,
      nuevosRegistros[i].nombre,
      nuevosRegistros[i].tiempo,
      nuevosRegistros[i].estado
    ]);
  }
  
  // Escribir todos los datos ordenados
  if (datosAInsertar.length > 0) {
    hojaBase.getRange(2, 1, datosAInsertar.length, 4).setValues(datosAInsertar);
  }
  
  hojaBase.autoResizeColumns(1, 4);
  
  var asistentes = Object.keys(mapaAsistencia).length;
  var ausentes = Object.keys(mapaEmpleados).length - asistentes;
  
  Logger.log("Procesados " + asistentes + " asistentes y " + ausentes + " ausentes para la fecha " + fechaProcesarStr);
  SpreadsheetApp.getUi().alert("Fecha: " + fechaG1 + "\nAsistentes: " + asistentes + "\nAusentes: " + ausentes);
}

// Función para ejecutar automáticamente cuando se edita la hoja REGISTROS
function onEdit(e) {
  var range = e.range;
  var sheet = range.getSheet();
  
  if (sheet.getName() === "REGISTROS") {
    SpreadsheetApp.flush();
    procesarRegistros();
  }
}

// Función para crear menú personalizado
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Procesar Registros')
    .addItem('Procesar fecha en G1', 'procesarRegistros')
    .addToUi();
}