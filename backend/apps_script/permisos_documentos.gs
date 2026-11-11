/**
 * TCONTROL · Permisos: documentos de permiso médico y calamidad (fase 3 del flujo de permisos, 2026-11-11)
 *
 * Los certificados son datos de salud (LOPDP): se guardan en una carpeta PRIVADA de Drive (dueña: la cuenta del
 * proyecto; no se comparte con nadie). Solo se leen a través de verDocumentoPermiso, que comprueba quién pide.
 *
 * Quién llama: la app y el panel envían el token de su sesión de Firebase (firebase.auth().currentUser.getIdToken()).
 * Se verifica con Google (identitytoolkit accounts:lookup); el uid de la sesión es el ID del colaborador.
 *   - Subir:  el dueño de la solicitud, alguien de TTHH (configuracion/permisos.tthh) o un administrador.
 *   - Ver:    los mismos.
 * Estados del documento (solicitudes_permiso.docs_estado):
 *   PENDIENTE → ENTREGADO (subido, por validar) → VALIDADO
 *                         ↘ RECHAZADO (motivo; puede volver a subir mientras no venza)
 *   PENDIENTE / RECHAZADO + plazo vencido (72 h corridas) → VENCIDO (lo marca permisos_escalado.gs)
 *   VENCIDO → DESCONTADO (TTHH confirma) o PENDIENTE con un plazo nuevo (prórroga). Validar, rechazar, descontar y
 *   prorrogar los hace TTHH desde la app o el panel (JS/permisos.js) directamente en Firestore.
 *
 * Usa: fetchFirestore_ (firestore_servidor.gs), notifBaseFirestore_, valorFirestore_, crearNotificacion_ (notificaciones.gs),
 *      valorAvisoAlm_ (aviso_almuerzos.gs), leerEmpleadoFirestore_ (evaluacion_desempeno.gs), destinatariosTthhPermisos_
 *      (permisos_escalado.gs).
 * Rutas (api_completa.gs → doPost): subirDocumentoPermiso, verDocumentoPermiso.
 */

var PERM_DOCS_CARPETA = 'PERMISOS_DOCUMENTOS (privado)';
var PERM_DOCS_MAX_BYTES = 6 * 1024 * 1024;
var PERM_DOCS_TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
var PERM_DOCS_ESTADOS_SUBIR = ['PENDIENTE', 'RECHAZADO'];

// ---------------------------------------------------------------- identidad
// Devuelve el ID del colaborador dueño del token de Firebase, o null
function uidDeTokenFirebase_(idToken) {
  if (!idToken) return null;
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + EVAL_API_KEY_FIREBASE, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: String(idToken) })
  });
  if (res.getResponseCode() !== 200) return null;
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  return u && u.localId ? String(u.localId) : null;
}

function esTthhOAdminPermisos_(id) {
  id = String(id || '');
  if (!id) return false;
  if (id === '1058') return true;
  var r = fetchFirestore_(notifBaseFirestore_() + '/' + PERM_CFG + '?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (r.getResponseCode() === 200) {
    var cfg = valorAvisoAlm_({ mapValue: { fields: JSON.parse(r.getContentText()).fields || {} } }) || {};
    if ((cfg.tthh || []).some(function (x) { return x && String(x.id) === id; })) return true;
  }
  var emp = leerEmpleadoFirestore_(id) || {};
  return String(emp.supervisor || emp.rol || '').toUpperCase().indexOf('ADMIN') !== -1;
}

function leerSolicitudPermiso_(solId) {
  var r = fetchFirestore_(notifBaseFirestore_() + '/' + PERM_COL + '/' + encodeURIComponent(solId) + '?key=' + EVAL_API_KEY_FIREBASE, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var doc = JSON.parse(r.getContentText());
  var s = valorAvisoAlm_({ mapValue: { fields: doc.fields || {} } }) || {};
  s.id = solId;
  s._nombreDoc = doc.name;
  s._updateTime = doc.updateTime;
  return s;
}

function carpetaDocsPermisos_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PERM_DOCS_CARPETA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var carpeta = DriveApp.createFolder(PERM_DOCS_CARPETA);
  try {
    var padres = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
    if (padres.hasNext()) carpeta.moveTo(padres.next());
  } catch (e) { }
  carpeta.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  props.setProperty('PERM_DOCS_CARPETA_ID', carpeta.getId());
  return carpeta;
}

// ---------------------------------------------------------------- subir
// p: { idToken, solicitudId, nombre, mime, base64 }
function subirDocumentoPermiso(p) {
  try {
    var uid = uidDeTokenFirebase_(p.idToken);
    if (!uid) return { error: 'Tu sesión venció. Confirma tu contraseña y vuelve a intentarlo.', sesion: true };
    var s = leerSolicitudPermiso_(String(p.solicitudId || ''));
    if (!s || !s.empleadoId) return { error: 'La solicitud no existe' };
    var esDueno = String(s.empleadoId) === uid;
    var esTthh = !esDueno && esTthhOAdminPermisos_(uid);
    if (!esDueno && !esTthh) return { error: 'No puedes subir documentos a esta solicitud' };
    if (s.estado !== 'REGISTRADA') return { error: 'Esta solicitud no necesita documentos' };
    var estadoDocs = String(s.docs_estado || 'PENDIENTE');
    if (PERM_DOCS_ESTADOS_SUBIR.indexOf(estadoDocs) === -1 && !(esTthh && estadoDocs === 'VENCIDO')) {
      return { error: estadoDocs === 'VENCIDO' ? 'El plazo de 72 horas venció. Pide a TTHH una prórroga.' : 'Ya hay un documento entregado: espera la revisión de TTHH.' };
    }
    var mime = String(p.mime || '').toLowerCase();
    if (PERM_DOCS_TIPOS.indexOf(mime) === -1) return { error: 'Sube un PDF o una foto (JPG o PNG)' };
    var bytes = Utilities.base64Decode(String(p.base64 || ''));
    if (!bytes.length) return { error: 'El archivo está vacío' };
    if (bytes.length > PERM_DOCS_MAX_BYTES) return { error: 'El archivo supera 6 MB' };
    var limpio = String(p.nombre || 'documento').replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 80);
    var nombre = s.empleadoId + '_' + s.id + '_' + Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyyMMdd-HHmm') + '_' + limpio;
    var archivo = carpetaDocsPermisos_().createFile(Utilities.newBlob(bytes, mime, nombre));
    archivo.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    var ahora = new Date().toISOString();
    var quien = (leerEmpleadoFirestore_(uid) || {}).nombre || uid;
    var doc = { id: archivo.getId(), nombre: limpio, mime: mime, tamano: bytes.length, subido_en: ahora, subido_por: quien, subido_por_id: uid };
    var campos = { docs_estado: 'ENTREGADO', docs_entregado_en: ahora, docs_motivo_rechazo: '' };
    var fields = {};
    Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
    var res = fetchFirestore_(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ writes: [{
        update: { name: s._nombreDoc, fields: fields },
        updateMask: { fieldPaths: Object.keys(campos) },
        updateTransforms: [
          { fieldPath: 'docs', appendMissingElements: { values: [valorFirestore_(doc)] } },
          { fieldPath: 'historial', appendMissingElements: { values: [valorFirestore_({ en: ahora, quien: quien, accion: 'DOCUMENTO_SUBIDO' })] } }
        ],
        currentDocument: { updateTime: s._updateTime }
      }] })
    });
    if (res.getResponseCode() !== 200) {
      archivo.setTrashed(true);
      return { error: 'La solicitud cambió mientras subías el archivo. Recarga y vuelve a intentarlo.' };
    }
    avisarDocumentoSubido_(s, quien);
    return { ok: true, documento: doc };
  } catch (e) {
    return { error: 'No se pudo guardar el documento: ' + (e.message || e) };
  }
}

// Aviso a TTHH: hay un documento por validar (sin nombre del archivo ni motivo: datos mínimos)
function avisarDocumentoSubido_(s, quien) {
  try {
    var corto = (typeof nombreCorto_ === 'function' ? nombreCorto_(s.nombre) : String(s.nombre || '').split(/\s+/).slice(0, 3).join(' ')) + ' (ID ' + s.empleadoId + ')';
    var tipo = (PERM_TIPOS[s.tipo] || s.tipo);
    destinatariosTthhPermisos_().forEach(function (d) {
      if (String(d.id) === String(s.empleadoId)) return;
      crearNotificacion_({ para: d.id, tipo: 'permiso_documento', titulo: 'Documento por validar', texto: corto + ' · ' + tipo + ' ' + periodoPermiso_(s),
        enlace: { modulo: 'permisos', id: s.id }, clave: 'permiso_' + s.id + '_doc_' + d.id, reemplazar: true });
    });
  } catch (e) { Logger.log('Aviso de documento no creado: ' + e); }
}

// ---------------------------------------------------------------- ver
// p: { idToken, solicitudId, docId } → { ok, base64, mime, nombre }
function verDocumentoPermiso(p) {
  try {
    var uid = uidDeTokenFirebase_(p.idToken);
    if (!uid) return { error: 'Tu sesión venció. Confirma tu contraseña y vuelve a intentarlo.', sesion: true };
    var s = leerSolicitudPermiso_(String(p.solicitudId || ''));
    if (!s) return { error: 'La solicitud no existe' };
    if (String(s.empleadoId) !== uid && !esTthhOAdminPermisos_(uid)) return { error: 'No puedes ver este documento' };
    var doc = (s.docs || []).filter(function (d) { return d && d.id === String(p.docId || ''); })[0];
    if (!doc) return { error: 'El documento no pertenece a esta solicitud' };
    var blob = DriveApp.getFileById(doc.id).getBlob();
    return { ok: true, base64: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType(), nombre: doc.nombre };
  } catch (e) {
    return { error: 'No se pudo abrir el documento: ' + (e.message || e) };
  }
}

// ---------------------------------------------------------------- vencimiento (lo llama escalarPermisosVencidos)
function vencerDocumentosPermisos_(aplicar) {
  var ahora = new Date();
  var vencidas = solicitudesPorEstado_('REGISTRADA').filter(function (s) {
    var est = String(s.docs_estado || 'PENDIENTE');
    return PERM_DOCS_ESTADOS_SUBIR.indexOf(est) !== -1 && s.docs_vence && new Date(s.docs_vence) <= ahora;
  });
  if (!vencidas.length) { Logger.log('Documentos: ninguno vencido'); return; }
  var destinos = aplicar ? destinatariosTthhPermisos_() : [];
  vencidas.forEach(function (s) {
    var linea = s.id + ' · ' + s.nombre + ' (' + s.empleadoId + ') · ' + (PERM_TIPOS[s.tipo] || s.tipo) + ' · vencía ' + s.docs_vence;
    if (!aplicar) { Logger.log('Documento vencería: ' + linea); return; }
    var iso = ahora.toISOString();
    var campos = { docs_estado: 'VENCIDO', docs_vencido_en: iso };
    var fields = {};
    Object.keys(campos).forEach(function (k) { fields[k] = valorFirestore_(campos[k]); });
    var res = fetchFirestore_(notifBaseFirestore_().replace(/\/documents$/, '/documents:commit') + '?key=' + EVAL_API_KEY_FIREBASE, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ writes: [{
        update: { name: s._nombreDoc, fields: fields },
        updateMask: { fieldPaths: Object.keys(campos) },
        updateTransforms: [{ fieldPath: 'historial', appendMissingElements: { values: [valorFirestore_({ en: iso, quien: 'Sistema', accion: 'DOCUMENTOS_VENCIDOS' })] } }],
        currentDocument: { updateTime: s._updateTime }
      }] })
    });
    if (res.getResponseCode() !== 200) { Logger.log('No se marcó (cambió mientras tanto): ' + linea); return; }
    Logger.log('Documentos vencidos: ' + linea);
    var corto = (typeof nombreCorto_ === 'function' ? nombreCorto_(s.nombre) : String(s.nombre || '').split(/\s+/).slice(0, 3).join(' ')) + ' (ID ' + s.empleadoId + ')';
    var tipo = PERM_TIPOS[s.tipo] || s.tipo;
    var enlace = { modulo: 'permisos', id: s.id };
    destinos.forEach(function (d) {
      if (String(d.id) === String(s.empleadoId)) return;
      crearNotificacion_({ para: d.id, tipo: 'permiso_vencido', titulo: 'Documentos no entregados en 72 h', texto: corto + ' · ' + tipo + ' ' + periodoPermiso_(s) + ' · confirma el descuento o da una prórroga',
        enlace: enlace, clave: 'permiso_' + s.id + '_vencido_' + d.id });
    });
    crearNotificacion_({ para: s.empleadoId, tipo: 'permiso_vencido', titulo: 'Venció el plazo de tus documentos', texto: tipo + ' ' + periodoPermiso_(s) + ' · TTHH decidirá si se descuenta del rol',
      enlace: enlace, clave: 'permiso_' + s.id + '_vencido_col' });
    var r = whatsappA_(s.empleadoId, 'Hola *' + primerNombre_(s.nombre) + '*, te escribimos de TCONTROL.\n\n⏰ Venció el plazo de 72 horas para entregar los documentos de tu *' + tipo + '* ' + periodoPermiso_(s) +
      '.\n\nTTHH revisará si se descuenta del rol. Si ya los tienes, comunícate con TTHH.');
    if (!r || r.ok === false) Logger.log('WhatsApp a ' + s.empleadoId + ' no enviado: ' + (r && r.error));
  });
}
