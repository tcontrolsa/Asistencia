/**
 * TCONTROL · Limpieza del libro CONTROL_ASISTENCIA_2026 (2026-10-29)
 *
 * Hojas que ninguna pantalla usa (Firestore las reemplazó o son datos del reloj anterior) se copian a un
 * libro de archivo nuevo y, solo si la copia quedó completa, se borran de este libro. Las copias viejas
 * del libro se mueven a la papelera de Drive (se pueden recuperar durante 30 días).
 *
 * Uso desde el editor (▶), en este orden:
 *   1. revisarLimpiezaLibro()   NO cambia nada: muestra en el registro qué se archivaría y qué copias se borrarían
 *   2. ejecutarLimpiezaLibro()  archiva y borra las hojas, y manda las copias viejas a la papelera
 *
 * Nunca toca las hojas que usa la aplicación (HOJAS_EN_USO): si alguna faltara, no hace nada.
 */

var LIMPIEZA_HOJAS_ARCHIVAR = [
  // Sin ningún uso en el código
  'antigua', 'base', 'Regis_antiguo',          // reloj biométrico anterior (no se migraron a Postgres a propósito)
  'REPORTE_MANTENIMIENTO',                      // informe de una limpieza ya hecha
  'RESPALDO_FECHAS',                            // respaldo de la corrección de fechas del 12/10/2026 (ya verificada)
  'LOGS',                                       // vacía
  'Hoja 16',                                    // enlaces a carpetas de SharePoint, sin uso en el código
  // Reemplazadas por Firestore (solo las menciona código antiguo que la app ya no llama)
  'CONSUMO_ALMUERZOS', 'AUDITORIA_ALMUERZOS', 'DISPOSITIVOS', 'HISTORIAL_MENU', 'CULTURA_PREGUNTAS'
];

// Hojas que usa la aplicación: deben existir antes y después de la limpieza
var LIMPIEZA_HOJAS_EN_USO = [
  'REGISTROS', 'VACACIONES', 'CALCULAR_vacaciones', 'EMPLEADOS', 'DESVINCULADOS', 'ALMUERZOS_EXTRA', 'ACTUALIZAR',
  'LOGS_WHATSAPP', 'EVALUACIONES', 'VISITAS_RESPALDO', 'VISITAS_CONTINGENCIA', 'CREDENCIAL_CAMPO',
  'VERIFICACIONES_CREDENCIAL', 'ACCESOS', 'CONFIGURACION'
];

// Copias viejas del libro en Drive (revisadas el 29/10/2026: solo las ve el propietario)
var LIMPIEZA_COPIAS_VIEJAS = [
  '1ZxMb0mC1qONXdr3L7e6t-nkRq-Db4v3nCmsa3eRcP14',  // Copia de CONTROL_ASISTENCIA_2026 - 15 de septiembre, 7:43
  '1Zw7MppOKDM8uzAj-19FFqRXOWjtXltYixDD0B2sbgXg',  // Copia de CONTROL_ASISTENCIA_2026 - 20 de septiembre, 20:24
  '1iTR0OnxhshYUbCzONBoLRa3PEII2Tzah06_iwA4EIho',  // Copia de CONTROL_ASISTENCIA_2026 - 8 de septiembre, 11:27
  '12JypQRPTHIZyV6QGPG1BGZuD3uYsO_KbsoWSqchEdMQ',  // Copia de CONTROL_ASISTENCIA_2026 - 8 de septiembre, 15:48
  '1xA7AhZmiwqk6hT6EjIknzwkWzkMw4thxD25nBhlVMIo',  // Copia de CONTROL_ASISTENCIA_2026 - 1 de julio, 7:02
  '1TYYHuXk56VLeH8sz4PtSdhkNSI1UJdIqKjkS5nw2RfE',  // Copia de CONTROL_ASISTENCIA_2026 (mayo)
  '1u6ncNoppdC5VKdFjxl1vy5H2k_Wn8RjZa2b2feCOLao'   // CONTROL_ASISTENCIA_2026 antiguo (febrero–abril, 49 KB)
];

function revisarLimpiezaLibro() {
  var plan = planLimpieza_();
  Logger.log(textoPlan_(plan));
  return plan;
}

function ejecutarLimpiezaLibro() {
  var plan = planLimpieza_();
  Logger.log(textoPlan_(plan));
  if (plan.faltanEnUso.length) throw new Error('No se hizo nada: faltan hojas que usa la aplicación: ' + plan.faltanEnUso.join(', '));

  var ss = SpreadsheetApp.getActive();
  var resultado = { archivo: null, archivadas: [], borradas: [], noBorradas: [], papelera: [], omitidas: [] };

  // 1. Copiar las hojas a un libro de archivo y borrarlas de este solo si la copia quedó completa
  if (plan.hojas.length) {
    var fecha = Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd');
    var archivo = SpreadsheetApp.create('ARCHIVO_CONTROL_ASISTENCIA_2026_hojas_antiguas_' + fecha);
    var carpetas = DriveApp.getFileById(ss.getId()).getParents();
    if (carpetas.hasNext()) DriveApp.getFileById(archivo.getId()).moveTo(carpetas.next());
    resultado.archivo = archivo.getUrl();

    plan.hojas.forEach(function (h) {
      var origen = ss.getSheetByName(h.nombre);
      var copia = origen.copyTo(archivo).setName(h.nombre);
      // Valores (no formato): la copia debe tener exactamente lo mismo
      var iguales = copia.getLastRow() === origen.getLastRow() && copia.getLastColumn() === origen.getLastColumn() &&
        JSON.stringify(copia.getDataRange().getDisplayValues()) === JSON.stringify(origen.getDataRange().getDisplayValues());
      if (!iguales) { resultado.noBorradas.push(h.nombre + ' (la copia no coincide)'); return; }
      resultado.archivadas.push(h.nombre);
      ss.deleteSheet(origen);
      resultado.borradas.push(h.nombre);
    });
    var vacia = archivo.getSheetByName('Hoja 1') || archivo.getSheetByName('Sheet1') || archivo.getSheets()[0];
    if (vacia && archivo.getSheets().length > 1 && vacia.getLastRow() === 0) archivo.deleteSheet(vacia);
  }

  // 2. Copias viejas del libro a la papelera (recuperables 30 días); nunca este mismo libro
  plan.copias.forEach(function (c) {
    if (!c.existe || c.id === ss.getId()) { resultado.omitidas.push(c.id); return; }
    DriveApp.getFileById(c.id).setTrashed(true);
    resultado.papelera.push(c.nombre);
  });

  // 3. Verificación final
  var faltan = LIMPIEZA_HOJAS_EN_USO.filter(function (n) { return !ss.getSheetByName(n); });
  resultado.verificacion = faltan.length ? 'ATENCIÓN: faltan ' + faltan.join(', ') : 'OK: las ' + LIMPIEZA_HOJAS_EN_USO.length + ' hojas en uso siguen en el libro';
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function planLimpieza_() {
  var ss = SpreadsheetApp.getActive();
  var plan = { hojas: [], noEncontradas: [], faltanEnUso: [], copias: [] };
  LIMPIEZA_HOJAS_ARCHIVAR.forEach(function (n) {
    if (LIMPIEZA_HOJAS_EN_USO.indexOf(n) !== -1) throw new Error('Configuración inválida: ' + n + ' está en uso');
    var h = ss.getSheetByName(n);
    if (h) plan.hojas.push({ nombre: n, filas: h.getLastRow(), columnas: h.getLastColumn() });
    else plan.noEncontradas.push(n);
  });
  plan.faltanEnUso = LIMPIEZA_HOJAS_EN_USO.filter(function (n) { return !ss.getSheetByName(n); });
  LIMPIEZA_COPIAS_VIEJAS.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      plan.copias.push({ id: id, existe: !f.isTrashed(), nombre: f.getName(), modificado: f.getLastUpdated() });
    } catch (e) {
      plan.copias.push({ id: id, existe: false, nombre: '(no encontrado)' });
    }
  });
  return plan;
}

function textoPlan_(plan) {
  var l = ['== Limpieza de CONTROL_ASISTENCIA_2026 =='];
  l.push('Hojas a archivar y borrar (' + plan.hojas.length + '):');
  plan.hojas.forEach(function (h) { l.push('  - ' + h.nombre + ': ' + h.filas + ' filas x ' + h.columnas + ' columnas'); });
  if (plan.noEncontradas.length) l.push('Ya no existen: ' + plan.noEncontradas.join(', '));
  l.push(plan.faltanEnUso.length ? 'ATENCIÓN, faltan hojas en uso: ' + plan.faltanEnUso.join(', ') : 'Hojas en uso: todas presentes (' + LIMPIEZA_HOJAS_EN_USO.length + ')');
  l.push('Copias viejas a la papelera:');
  plan.copias.forEach(function (c) { l.push('  - ' + c.nombre + (c.existe ? '' : ' (no está o ya en papelera)')); });
  return l.join('\n');
}
