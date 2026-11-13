/**
 * TCONTROL · Tarjeta de visita en imagen (PNG) para WhatsApp y correo
 *
 * La misma tarjeta que muestra el panel: título, QR, código, nombre, empresa (y foto del visitante
 * frecuente si la dio), a quién visita, vigencia o fecha y el recordatorio de documento/EPP.
 * Apps Script no dibuja HTML, así que se arma en una copia temporal de una plantilla vertical de
 * Google Slides, se exporta su miniatura PNG (1600 px) y la copia se manda a la papelera enseguida. Si algo falla, visitas.gs envía solo el QR, como antes.
 *
 * Requiere: visitas.gs (nombreCortoVisita_, codigoVisita_), evaluacion_desempeno.gs (rpcTunel_),
 * notificaciones.gs (fechaTexto_), qrcode_lib.gs (qrcode).
 * Una sola vez: crearPlantillaTarjeta() (▶) y en la presentación creada poner el tamaño de página
 * 300 × 432 pt (Slides no deja fijarlo por código); luego probarTarjetaVisita() deja en tu Drive
 * «prueba-tarjeta-visita.png» para revisarla. Necesita la API de Google Slides activada (Servicios).
 */

var TARJETA_FUENTE = 'Plus Jakarta Sans';

// Datos de la tarjeta a partir del aviso de la cola (notificarVisita)
function datosTarjetaVisita_(p) {
  var frecuente = p.origen === 'frecuente';
  var lineas = ['Visita a ' + (nombreCortoVisita_(p.anfitrionNombre) || 'TCONTROL')];
  if (frecuente) lineas.push('Vale del ' + fechaCortaTarjeta_(p.desde) + ' al ' + fechaCortaTarjeta_(p.hasta) + ' · ' + (p.diasTexto || 'cualquier día'));
  else if (p.fecha) lineas.push(fechaTexto_(p.fecha) + (p.hora ? ' · ' + p.hora : '') + (p.tipoNombre ? ' · ' + p.tipoNombre : ''));
  return {
    titulo: frecuente ? 'TCONTROL · VISITANTE FRECUENTE' : 'TCONTROL · PASE DE VISITA',
    codigo: p.codigo, nombre: p.visitanteNombre || '', empresa: p.visitanteEmpresa || '', lineas: lineas,
    pie: 'Presentar con documento de identidad' + (esVerdadVisita_(p.epp) ? ' y EPP' : '') + '.',
    foto: frecuente && esVerdadVisita_(p.foto) ? fotoFrecuenteBase64_(p.codigo) : ''
  };
}

function fechaCortaTarjeta_(f) {
  var m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(f || '');
}

// Foto del visitante frecuente (api.frecuente_foto_servicio con un token de servicio de 5 minutos)
function fotoFrecuenteBase64_(codigo) {
  try {
    var secreto = PropertiesService.getScriptProperties().getProperty('PGRST_JWT_SECRET');
    if (!secreto || !codigo) return '';
    var b64url = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
    var header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    var payload = b64url(Utilities.newBlob(JSON.stringify({ role: 'tcontrol_lector', servicio: 'visitas', exp: Math.floor(Date.now() / 1000) + 300 })).getBytes());
    var token = header + '.' + payload + '.' + b64url(Utilities.computeHmacSha256Signature(header + '.' + payload, secreto));
    var r = rpcTunel_('frecuente_foto_servicio', JSON.stringify({ codigo: String(codigo) }), token);
    var foto = r && r.body && r.body.ok ? String(r.body.foto || '') : '';
    return foto.indexOf('data:image/jpeg;base64,') === 0 ? foto.split('base64,')[1] : '';
  } catch (e) {
    Logger.log('Foto del visitante no disponible: ' + e);
    return '';
  }
}

// QR "TCV1:CODIGO" en PNG, con margen pequeño (la tarjeta ya tiene su borde)
function qrTarjetaBlob_(codigo) {
  var q = qrcode(0, 'M');
  q.addData('TCV1:' + codigo);
  q.make();
  var gif = String(q.createDataURL(12, 8)).split('base64,')[1];
  return Utilities.newBlob(Utilities.base64Decode(gif), 'image/gif', 'qr.gif').getAs('image/png');
}

// PNG en base64 de la tarjeta; '' si no se pudo (se envía el QR solo).
// Slides no deja fijar el tamaño de página por código: se copia una plantilla VERTICAL (crearPlantillaTarjeta)
// y todo se dibuja a escala de su ancho (diseño base 300 × 432 pt).
function tarjetaVisitaBase64_(d) {
  if (!d || !d.codigo || typeof qrcode !== 'function') return '';
  var plantilla = PropertiesService.getScriptProperties().getProperty('TARJETA_PLANTILLA_ID');
  if (!plantilla) { Logger.log('Tarjeta de visita: falta la plantilla. Ejecuta crearPlantillaTarjeta() una vez.'); return ''; }
  var conFoto = !!d.foto;
  var oauth = ScriptApp.getOAuthToken();
  var id = '';
  try {
    id = DriveApp.getFileById(plantilla).makeCopy('tmp-tarjeta-visita').getId();
    var pres = SlidesApp.openById(id);
    var W = pres.getPageWidth(), H = pres.getPageHeight();
    if (H <= W) throw new Error('La plantilla debe ser vertical (300 × 432 pt). Revisa Archivo → Configuración de página.');
    var k = W / 300;
    var n = function (x) { return x * k; };
    var slide = pres.getSlides()[0];
    slide.getPageElements().forEach(function (e) { e.remove(); });
    slide.getBackground().setSolidFill('#ffffff');

    var marco = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, n(6), n(6), W - n(12), H - n(12));
    marco.getFill().setSolidFill('#ffffff');
    marco.getBorder().setWeight(n(2)).getLineFill().setSolidFill('#0f172a');

    textoTarjeta_(slide, d.titulo, n(14), n(18), W - n(28), n(18), { size: n(10.5), bold: true, color: '#2563eb' });
    var qr = slide.insertImage(qrTarjetaBlob_(d.codigo));
    qr.setLeft((W - n(196)) / 2).setTop(n(40)).setWidth(n(196)).setHeight(n(196));
    textoTarjeta_(slide, codigoVisita_(d.codigo).split('').join(' '), n(14), n(240), W - n(28), n(28), { size: n(19), bold: true, font: 'Roboto Mono' });

    var y = n(274);
    if (conFoto) {
      var img = slide.insertImage(Utilities.newBlob(Utilities.base64Decode(d.foto), 'image/jpeg', 'foto.jpg'));
      img.setLeft(n(30)).setTop(y).setWidth(n(62)).setHeight(n(62));
      textoTarjeta_(slide, d.nombre, n(102), y + n(2), W - n(132), n(36), { size: n(13.5), bold: true, align: 'START' });
      textoTarjeta_(slide, d.empresa, n(102), y + n(38), W - n(132), n(20), { size: n(10.5), color: '#475569', align: 'START' });
      y += n(70);
    } else {
      textoTarjeta_(slide, d.nombre, n(18), y, W - n(36), n(24), { size: n(14), bold: true });
      textoTarjeta_(slide, d.empresa, n(18), y + n(24), W - n(36), n(18), { size: n(10.5), color: '#475569' });
      y += n(48);
    }
    textoTarjeta_(slide, d.lineas.join('\n'), n(18), y, W - n(36), n(48), { size: n(10), color: '#475569' });
    textoTarjeta_(slide, d.pie, n(18), H - n(40), W - n(36), n(18), { size: n(8.5), color: '#64748b' });

    var pageId = slide.getObjectId();
    pres.saveAndClose();
    var th = UrlFetchApp.fetch('https://slides.googleapis.com/v1/presentations/' + id + '/pages/' + pageId +
      '/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE',
      { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + oauth } });
    if (th.getResponseCode() !== 200) throw new Error('Miniatura: ' + th.getContentText().slice(0, 200));
    var png = UrlFetchApp.fetch(JSON.parse(th.getContentText()).contentUrl).getBlob().getBytes();
    return Utilities.base64Encode(png);
  } catch (e) {
    Logger.log('Tarjeta de visita no generada: ' + e);
    return '';
  } finally {
    // La copia temporal (con datos del visitante) no se queda en Drive
    if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { Logger.log('No se pudo borrar la tarjeta temporal: ' + e); } }
  }
}

function textoTarjeta_(slide, texto, x, y, w, h, o) {
  var caja = slide.insertTextBox(String(texto || ' '), x, y, w, h);
  caja.setContentAlignment(SlidesApp.ContentAlignment.TOP);
  var t = caja.getText();
  t.getTextStyle().setFontFamily(o.font || TARJETA_FUENTE).setFontSize(o.size || 11).setBold(!!o.bold).setForegroundColor(o.color || '#0f172a');
  t.getParagraphStyle().setParagraphAlignment(o.align === 'START' ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER)
    .setSpaceAbove(0).setSpaceBelow(0).setLineSpacing(110);
  return caja;
}

/**
 * Ejecutar UNA vez desde el editor (▶): crea la plantilla de la tarjeta y guarda su ID.
 * Luego ábrela con el enlace del registro y en Archivo → Configuración de página → Personalizado
 * pon 300 × 432 puntos (o 10,58 × 15,24 cm) y Aplicar. Después ejecuta probarTarjetaVisita().
 */
function crearPlantillaTarjeta() {
  var props = PropertiesService.getScriptProperties();
  var actual = props.getProperty('TARJETA_PLANTILLA_ID');
  if (actual) {
    try { var f = DriveApp.getFileById(actual); if (!f.isTrashed()) { Logger.log('Ya existe la plantilla: ' + f.getUrl()); return; } } catch (e) { }
  }
  var pres = SlidesApp.create('Plantilla tarjeta de visita (no borrar)');
  pres.getSlides()[0].getPageElements().forEach(function (e) { e.remove(); });
  pres.saveAndClose();
  props.setProperty('TARJETA_PLANTILLA_ID', pres.getId());
  Logger.log('Plantilla creada: ' + pres.getUrl() + ' → ábrela y en Archivo → Configuración de página → Personalizado pon 300 × 432 puntos.');
}

/** Después de la plantilla (▶): guarda una tarjeta de ejemplo en tu Drive para revisarla. */
function probarTarjetaVisita() {
  var b64 = tarjetaVisitaBase64_({
    titulo: 'TCONTROL · VISITANTE FRECUENTE', codigo: 'PRUEBA23', nombre: 'Visitante de Prueba', empresa: 'Empresa de ejemplo',
    lineas: ['Visita a Anfitrión Prueba', 'Vale del 12/11/2026 al 12/12/2026 · lunes, miércoles, viernes'],
    pie: 'Presentar con documento de identidad y EPP.', foto: ''
  });
  if (!b64) throw new Error('No se generó la tarjeta: revisa el registro de ejecución.');
  var f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'prueba-tarjeta-visita.png'));
  Logger.log('Tarjeta de prueba: ' + f.getUrl() + ' (' + Math.round(b64.length * 0.75 / 1024) + ' KB)');
}
