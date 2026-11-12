/**
 * TCONTROL · Tarjeta de visita en imagen (PNG) para WhatsApp y correo
 *
 * La misma tarjeta que muestra el panel: título, QR, código, nombre, empresa (y foto del visitante
 * frecuente si la dio), a quién visita, vigencia o fecha y el recordatorio de documento/EPP.
 * Apps Script no dibuja HTML, así que se arma en una presentación temporal de Google Slides del
 * tamaño de la tarjeta, se exporta su miniatura PNG (1600 px) y la presentación se manda a la
 * papelera enseguida. Si algo falla, visitas.gs envía solo el QR, como antes.
 *
 * Requiere: visitas.gs (nombreCortoVisita_, codigoVisita_), evaluacion_desempeno.gs (rpcTunel_),
 * notificaciones.gs (fechaTexto_), qrcode_lib.gs (qrcode).
 * La primera vez ejecuta probarTarjetaVisita() desde el editor (▶): pide permiso para Slides y Drive
 * y deja en tu Drive «prueba-tarjeta-visita.png» para revisarla.
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

// PNG en base64 de la tarjeta; '' si no se pudo (se envía el QR solo)
function tarjetaVisitaBase64_(d) {
  if (!d || !d.codigo || typeof qrcode !== 'function') return '';
  var W = 300, conFoto = !!d.foto;
  var H = 432;
  var oauth = ScriptApp.getOAuthToken();
  var id = '';
  try {
    var cre = UrlFetchApp.fetch('https://slides.googleapis.com/v1/presentations', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + oauth },
      payload: JSON.stringify({ title: 'tmp-tarjeta-visita', pageSize: { width: { magnitude: W, unit: 'PT' }, height: { magnitude: H, unit: 'PT' } } })
    });
    if (cre.getResponseCode() !== 200) throw new Error('Slides: ' + cre.getContentText().slice(0, 200));
    id = JSON.parse(cre.getContentText()).presentationId;

    var pres = SlidesApp.openById(id);
    var slide = pres.getSlides()[0];
    slide.getPageElements().forEach(function (e) { e.remove(); });
    slide.getBackground().setSolidFill('#ffffff');

    var marco = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 6, 6, W - 12, H - 12);
    marco.getFill().setSolidFill('#ffffff');
    marco.getBorder().setWeight(2).getLineFill().setSolidFill('#0f172a');

    textoTarjeta_(slide, d.titulo, 14, 18, W - 28, 18, { size: 10.5, bold: true, color: '#2563eb' });
    var qr = slide.insertImage(qrTarjetaBlob_(d.codigo));
    qr.setLeft((W - 196) / 2).setTop(40).setWidth(196).setHeight(196);
    textoTarjeta_(slide, codigoVisita_(d.codigo).split('').join(' '), 14, 240, W - 28, 28, { size: 19, bold: true, font: 'Roboto Mono' });

    var y = 274;
    if (conFoto) {
      var img = slide.insertImage(Utilities.newBlob(Utilities.base64Decode(d.foto), 'image/jpeg', 'foto.jpg'));
      img.setLeft(30).setTop(y).setWidth(62).setHeight(62);
      textoTarjeta_(slide, d.nombre, 102, y + 2, W - 132, 36, { size: 13.5, bold: true, align: 'START' });
      textoTarjeta_(slide, d.empresa, 102, y + 38, W - 132, 20, { size: 10.5, color: '#475569', align: 'START' });
      y += 70;
    } else {
      textoTarjeta_(slide, d.nombre, 18, y, W - 36, 24, { size: 14, bold: true });
      textoTarjeta_(slide, d.empresa, 18, y + 24, W - 36, 18, { size: 10.5, color: '#475569' });
      y += 48;
    }
    textoTarjeta_(slide, d.lineas.join('\n'), 18, y, W - 36, 48, { size: 10, color: '#475569' });
    textoTarjeta_(slide, d.pie, 18, H - 40, W - 36, 18, { size: 8.5, color: '#64748b' });

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
    // La presentación temporal (con datos del visitante) no se queda en Drive
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

/** Ejecutar una vez desde el editor (▶): autoriza Slides/Drive y guarda una tarjeta de ejemplo en tu Drive. */
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
