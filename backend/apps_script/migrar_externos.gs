/**
 * TCONTROL · Personal de servicios externos: cambia sus ID viejos por los de la serie 9000 en el historial.
 * Complemento de db/etl/migrar_externos.py (que hace lo mismo en Firestore).
 *
 * Ejecutar desde el editor (▶):
 *   simularMigracionExternos()  cuenta las filas que cambiarían, sin tocar nada
 *   migrarIdsExternos()         las cambia (columna ID de REGISTROS y VACACIONES)
 * Se puede repetir: si ya no quedan ID viejos, no hace nada. Postgres se actualiza en la siguiente sincronización.
 */

var MAPA_EXTERNOS = { '2018': '9001', '2019': '9002', '2020': '9003', '2021': '9004', '2022': '9005' };
var HOJAS_EXTERNOS = ['REGISTROS', 'VACACIONES'];
var COLUMNA_ID_EXTERNOS = 2;   // B

function simularMigracionExternos() { return migrarIdsExternos_(true); }
function migrarIdsExternos() { return migrarIdsExternos_(false); }

/** Ejecutar una vez (▶): programa migrarIdsExternos para hoy a las 18:45 (después de que salgan). Se borra solo al correr. */
function programarMigracionExternos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'migrarIdsExternosProgramado') ScriptApp.deleteTrigger(t);
  });
  var hoy = Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyy-MM-dd');
  var cuando = new Date(hoy + 'T18:45:00-05:00');
  ScriptApp.newTrigger('migrarIdsExternosProgramado').timeBased().at(cuando).create();
  Logger.log('Migración de la hoja programada para ' + cuando);
}

function migrarIdsExternosProgramado() {
  try {
    migrarIdsExternos_(false);
  } finally {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'migrarIdsExternosProgramado') ScriptApp.deleteTrigger(t);
    });
  }
}

function migrarIdsExternos_(simular) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('Otro proceso está escribiendo en el libro. Intenta en un minuto.');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var resumen = {};
    HOJAS_EXTERNOS.forEach(function (nombre) {
      var hoja = ss.getSheetByName(nombre);
      if (!hoja || hoja.getLastRow() < 2) return;
      var rango = hoja.getRange(2, COLUMNA_ID_EXTERNOS, hoja.getLastRow() - 1, 1);
      var ids = rango.getValues();
      var cambios = 0, porId = {};
      ids.forEach(function (fila) {
        var actual = String(fila[0]).trim();
        if (MAPA_EXTERNOS[actual]) {
          porId[actual] = (porId[actual] || 0) + 1;
          fila[0] = MAPA_EXTERNOS[actual];
          cambios++;
        }
      });
      resumen[nombre] = { filas: cambios, porId: porId };
      // Solo se reescribe la columna ID, y solo si hay algo que cambiar
      if (!simular && cambios) rango.setValues(ids);
    });
    Logger.log((simular ? 'SIMULACIÓN (nada cambió): ' : 'HECHO: ') + JSON.stringify(resumen));
    return resumen;
  } finally {
    lock.releaseLock();
  }
}
