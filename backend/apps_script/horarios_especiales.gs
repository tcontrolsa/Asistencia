/**
 * TCONTROL · Horarios especiales por persona (Apps Script) · 2026-11-26
 *
 * Excepciones al horario general (L–V 07:30–16:15) guardadas en la ficha (empleados/{id}.horario_especial, texto JSON:
 * [{"dias":[1,2,3,4,5],"entrada":"07:45","salida":"16:30","desde":"2026-11-26","hasta":"","nota":""}]).
 * Las reglas viven en JS/reglas_jornada.js (copiado a reglas_jornada.gs): ReglasJornada.horarioDe / registrarHorarios.
 * Aquí solo se cargan las excepciones desde Firestore (una lectura por ejecución) y se piden la salida y la entrada de
 * una persona en una fecha. Lo usan: salida automática (autocompletar_salidas.gs), confirmación automática de horas
 * extra (mantenimiento_registros.gs), autorización de extras al marcar (api_completa.gs) y el cargo nocturno (cargo_jornada.gs).
 */
var HORARIOS_ESPECIALES_CARGADOS_ = false;

// Lee las fichas con horario especial y las deja registradas en ReglasJornada. Si falla, rige el horario general.
function cargarHorariosEspeciales_() {
  if (HORARIOS_ESPECIALES_CARGADOS_) return;
  try {
    window.ReglasJornada.registrarHorarios(listarEmpleadosFirestore_());
    HORARIOS_ESPECIALES_CARGADOS_ = true;
  } catch (e) {
    Logger.log('Horarios especiales: no se pudieron leer las fichas (' + e + '). Rige el horario general.');
  }
}

// emp: ficha o ID; fecha 'AAAA-MM-DD'. Minutos desde la medianoche (975 = 16:15 y 450 = 07:30 sin excepción).
function horarioSalidaMin_(emp, fecha) {
  try { return window.ReglasJornada.horarioDe(emp, fecha).salida; } catch (e) { return 975; }
}
function horarioEntradaMin_(emp, fecha) {
  try { return window.ReglasJornada.horarioDe(emp, fecha).entrada; } catch (e) { return 450; }
}
