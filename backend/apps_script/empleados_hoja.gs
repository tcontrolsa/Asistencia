/**
 * TCONTROL · Fichas de Firestore en la hoja EMPLEADOS
 *
 * Desde que la app y el panel trabajan sobre Firestore, las fichas nuevas (registro propio serie 2000, personal
 * externo serie 9000, altas desde el panel) ya no llegaban a la hoja EMPLEADOS, y los cambios de activo, área,
 * cargo o rol tampoco. La hoja la usan "¿Olvidaste tu contraseña?" (acceso_seguro.gs: teléfono y rol), el
 * autocompletado de salidas y el mantenimiento, así que esas personas quedaban fuera.
 *
 * Qué hace:
 *   - Fichas que no están en la hoja → fila nueva (ID, nombre, área, activo, foto, supervisor, teléfono, cargo,
 *     nacimiento). Nunca contraseña.
 *   - Fichas que ya están → se igualan ÁREA, ACTIVO, SUPERVISOR y CARGO a Firestore (sin contar mayúsculas ni
 *     tildes). NOMBRE (la hoja usa nombres cortos) y TELÉFONO (el de la hoja recibe el código de recuperación)
 *     solo se llenan si en la hoja están vacíos.
 *   - Fichas pasadas a otro ID (migrado_a) no se agregan.
 *
 * Editor (▶): revisarFichasEnEmpleados()      → solo muestra qué cambiaría
 *             sincronizarFichasEnEmpleados()  → lo aplica (también corre en mantenimientoDiario, 04:00)
 */

function revisarFichasEnEmpleados() { return sincronizarFichasEnEmpleados_(false); }
function sincronizarFichasEnEmpleados() { return sincronizarFichasEnEmpleados_(true); }

function sincronizarFichasEnEmpleados_(aplicar) {
  var C = COLUMNAS_EMPLEADOS;
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_EMPLEADOS);
  if (!hoja) throw new Error('No existe la hoja ' + HOJA_EMPLEADOS);
  var ultimaCol = Math.max(hoja.getLastColumn(), C.BASE_LNG + 1);
  var filas = Math.max(hoja.getLastRow() - 1, 0);
  var datos = filas ? hoja.getRange(2, 1, filas, ultimaCol).getValues() : [];
  var filaDe = {};
  datos.forEach(function (f, i) { var id = String(f[C.ID] || '').trim(); if (id && filaDe[id] === undefined) filaDe[id] = i; });

  var texto = function (v) { return v === undefined || v === null ? '' : String(v).trim(); };
  var activoDe = function (e) { return (e.activo === false || texto(e.activo).toUpperCase() === 'NO') ? 'NO' : 'SI'; };
  var digitos = function (v) { return texto(v).replace(/\D/g, ''); };
  var base = function (v) { return texto(v).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  var igual = function (a, b) { return base(a) === base(b); };

  var nuevas = [], cambios = [], tocadas = {};
  listarEmpleadosFirestore_().forEach(function (e) {
    var id = texto(e.id);
    if (!id || texto(e.migrado_a)) return;
    var quiere = {};
    quiere[C.NOMBRE] = texto(e.nombre);
    quiere[C.AREA] = texto(e.area);
    quiere[C.ACTIVO] = activoDe(e);
    quiere[C.SUPERVISOR] = texto(e.supervisor) || 'NO';
    quiere[C.CARGO] = texto(e.cargo);

    var i = filaDe[id];
    if (i === undefined) {
      var fila = [];
      for (var k = 0; k < ultimaCol; k++) fila.push('');
      Object.keys(quiere).forEach(function (col) { fila[col] = quiere[col]; });
      fila[C.ID] = id;
      fila[C.FOTO_URL] = texto(e.foto_url);
      fila[C.TELEFONO] = texto(e.telefono);
      fila[C.FECHA_NACIMIENTO] = texto(e.fechaNacimiento);
      nuevas.push(fila);
      return;
    }
    var f = datos[i], detalle = [];
    Object.keys(quiere).forEach(function (col) {
      if (!quiere[col] && col != C.ACTIVO) return;          // dato vacío en Firestore: no borra la hoja
      if (col == C.NOMBRE && texto(f[col])) return;          // la hoja usa nombres cortos: solo se llena si falta
      if (igual(f[col], quiere[col])) return;                // "Taller" = "TALLER", "si" = "SI"
      detalle.push(col + ':' + texto(f[col]) + '→' + quiere[col]); f[col] = quiere[col];
    });
    if (!digitos(f[C.TELEFONO]) && digitos(e.telefono)) { detalle.push('teléfono (vacío en la hoja)'); f[C.TELEFONO] = texto(e.telefono); }
    if (detalle.length) { cambios.push(id + ' ' + detalle.join(', ')); tocadas[i] = true; }
  });

  var nombresCol = {};
  nombresCol[C.NOMBRE] = 'NOMBRE'; nombresCol[C.AREA] = 'ÁREA'; nombresCol[C.ACTIVO] = 'ACTIVO';
  nombresCol[C.SUPERVISOR] = 'SUPERVISOR'; nombresCol[C.CARGO] = 'CARGO';
  var legible = function (s) { return s.replace(/(\d+):/g, function (m, c) { return (nombresCol[c] || 'col ' + c) + ': '; }); };

  Logger.log((aplicar ? 'SINCRONIZADO' : 'REVISIÓN (no se escribió nada)') + ' · fichas nuevas en la hoja: ' + nuevas.length +
    (nuevas.length ? ' (' + nuevas.map(function (f) { return f[C.ID]; }).join(', ') + ')' : '') +
    ' · filas con cambios: ' + cambios.length);
  cambios.forEach(function (c) { Logger.log('  ' + legible(c)); });

  if (!aplicar) return { nuevas: nuevas.length, cambios: cambios.length };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(tocadas).forEach(function (i) {
      i = Number(i);
      var f = datos[i];
      [C.NOMBRE, C.AREA, C.ACTIVO, C.SUPERVISOR, C.TELEFONO, C.CARGO].forEach(function (col) {
        hoja.getRange(i + 2, col + 1).setValue(f[col]);
      });
    });
    if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, ultimaCol).setValues(nuevas);
  } finally { lock.releaseLock(); }
  var cache = CacheService.getScriptCache();
  nuevas.forEach(function (f) { cache.remove('emp_acc_' + f[C.ID]); });
  Object.keys(tocadas).forEach(function (i) { cache.remove('emp_acc_' + texto(datos[Number(i)][C.ID])); });
  return { nuevas: nuevas.length, cambios: cambios.length };
}
