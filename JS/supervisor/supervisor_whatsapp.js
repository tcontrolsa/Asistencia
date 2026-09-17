/**
 * Asistencia Tcontrol - Modulo WhatsApp (OpenWA y Notificaciones)
 * Extraido en Fase 2 de Modularizacion (Optimizacion de mantenibilidad)
 * Fecha: 2026-09-17
 */

// ============================================================
// ============================================================
// MÓDULO NOTIFICACIONES WHATSAPP CON OPENWA — PANEL Y DESPACHO
// ============================================================
// ============================================================
window._waActiveSubtab = 'servidor';
window._waActiveTemplateType = 'no_registro';
window._waModalCategoriaActual = 'sin_marcar';
window._logsWhatsAppCache = [];
window._plantillasPersonalizadas = {};
window._waPlantillasImagenes = {};

window._resolverTipoPlantillaWA = function (tipoRaw) {
  if (!tipoRaw) return 'no_registro';
  const t = String(tipoRaw).toLowerCase().trim();
  if (t === 'sin_marcar' || t === 'no_registro' || t === 'entrada_faltante' || t === 'entrada') return 'no_registro';
  if (t === 'vacaciones' || t === 'vacacion') return 'vacaciones';
  if (t === 'permisos' || t === 'permiso') return 'permisos';
  if (t === 'ausente' || t === 'ausencia' || t === 'ausencia_laboral') return 'ausente';
  if (t === 'salida' || t === 'salida_faltante') return 'salida_faltante';
  if (t === 'emergencia' || t === 'alerta_emergencia') return 'emergencia';
  if (t === 'plantilla_activa') return window._waActiveTemplateType || 'no_registro';
  return tipoRaw;
};

window._guardarImagenPlantillaWA = function (tipoRaw, b64) {
  if (!tipoRaw) return;
  const tNorm = window._resolverTipoPlantillaWA(tipoRaw);
  window._waPlantillasImagenes = window._waPlantillasImagenes || {};
  if (b64) {
    window._waPlantillasImagenes[tNorm] = b64;
    window._waPlantillasImagenes[tipoRaw] = b64;
    if (tNorm === 'no_registro') window._waPlantillasImagenes['sin_marcar'] = b64;
    try {
      localStorage.setItem('tcontrol_wa_img_' + tNorm, b64);
      if (tipoRaw !== tNorm) localStorage.setItem('tcontrol_wa_img_' + tipoRaw, b64);
      if (tNorm === 'no_registro') localStorage.setItem('tcontrol_wa_img_sin_marcar', b64);
    } catch (e) { }
  } else {
    delete window._waPlantillasImagenes[tNorm];
    delete window._waPlantillasImagenes[tipoRaw];
    if (tNorm === 'no_registro') delete window._waPlantillasImagenes['sin_marcar'];
    try {
      localStorage.removeItem('tcontrol_wa_img_' + tNorm);
      if (tipoRaw !== tNorm) localStorage.removeItem('tcontrol_wa_img_' + tipoRaw);
      if (tNorm === 'no_registro') localStorage.removeItem('tcontrol_wa_img_sin_marcar');
    } catch (e) { }
  }

  if (window.OpenWAService && typeof window.OpenWAService.guardarImagenPlantilla === 'function') {
    window.OpenWAService.guardarImagenPlantilla(tNorm, b64);
  }

  if (typeof window.actualizarPreviewImagenPruebaWA === 'function') {
    window.actualizarPreviewImagenPruebaWA();
  }
};

window._obtenerImagenPlantillaWA = function (tipoRaw) {
  if (!tipoRaw) return null;
  const tNorm = window._resolverTipoPlantillaWA(tipoRaw);
  if (window._waPlantillasImagenes) {
    if (window._waPlantillasImagenes[tNorm]) return window._waPlantillasImagenes[tNorm];
    if (window._waPlantillasImagenes[tipoRaw]) return window._waPlantillasImagenes[tipoRaw];
    if (tNorm === 'no_registro' && window._waPlantillasImagenes['sin_marcar']) return window._waPlantillasImagenes['sin_marcar'];
  }
  if (window.OpenWAService && typeof window.OpenWAService.obtenerImagenPlantilla === 'function') {
    const img = window.OpenWAService.obtenerImagenPlantilla(tNorm) || window.OpenWAService.obtenerImagenPlantilla(tipoRaw);
    if (img) return img;
  }
  try {
    const local = localStorage.getItem('tcontrol_wa_img_' + tNorm) ||
      localStorage.getItem('tcontrol_wa_img_' + tipoRaw) ||
      (tNorm === 'no_registro' ? localStorage.getItem('tcontrol_wa_img_sin_marcar') : null);
    if (local) return local;
  } catch (e) { }
  return null;
};

window._actualizarVistaImagenPlantillaWA = function (tipo) {
  tipo = tipo || window._waActiveTemplateType || 'no_registro';
  const b64 = window._obtenerImagenPlantillaWA(tipo);
  const previewCont = $('waPreviewImageContainer');
  const previewImg = $('waPreviewImageEl');
  const btnRem = $('btnRemoverImagenWA');
  const imgInput = $('waImageUpload');

  if (b64) {
    if (previewImg) previewImg.src = b64;
    if (previewCont) previewCont.style.display = 'block';
    if (btnRem) btnRem.style.display = 'inline-flex';
  } else {
    if (previewImg) previewImg.src = '';
    if (previewCont) previewCont.style.display = 'none';
    if (btnRem) btnRem.style.display = 'none';
    if (imgInput) imgInput.value = '';
  }
};

window._removerImagenPlantillaWA = function () {
  const tipo = window._waActiveTemplateType || 'no_registro';
  window._guardarImagenPlantillaWA(tipo, null);
  window._actualizarVistaImagenPlantillaWA(tipo);
  const imgInput = $('waImageUpload');
  if (imgInput) imgInput.value = '';
  mostrarToast('Imagen eliminada de la plantilla', 'info');
};

window._onSubirImagenPlantillaWA = function (e) {
  const file = (e && e.target && e.target.files) ? e.target.files[0] : null;
  if (!file) return;

  const tipo = window._waActiveTemplateType || 'no_registro';

  const esImgMime = file.type && file.type.toLowerCase().startsWith('image/');
  const esImgExt = /\.(jpe?g|png|webp|gif|bmp|jfif)$/i.test(file.name || '');
  if (!esImgMime && !esImgExt) {
    mostrarToast('Por favor selecciona un archivo de imagen válido (JPG, PNG, WebP)', 'warning');
    const inp = $('waImageUpload');
    if (inp) inp.value = '';
    return;
  }

  mostrarToast('Cargando y procesando imagen...', 'info');

  const reader = new FileReader();
  reader.onload = function (evt) {
    const rawB64 = evt.target.result;
    const tempImg = new Image();
    tempImg.onload = function () {
      try {
        const maxDim = 1200;
        let w = tempImg.width;
        let h = tempImg.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tempImg, 0, 0, w, h);
        const b64 = canvas.toDataURL('image/jpeg', 0.85);

        window._guardarImagenPlantillaWA(tipo, b64);
        window._actualizarVistaImagenPlantillaWA(tipo);
        mostrarToast('¡Imagen adjuntada a la plantilla con éxito!', 'success');
      } catch (errCanvas) {
        console.warn('[WA] Fallback de imagen sin canvas:', errCanvas);
        window._guardarImagenPlantillaWA(tipo, rawB64);
        window._actualizarVistaImagenPlantillaWA(tipo);
        mostrarToast('¡Imagen adjuntada a la plantilla con éxito!', 'success');
      }
    };
    tempImg.onerror = function (errImg) {
      console.warn('[WA] No se pudo procesar tempImg, usando Base64 directo:', errImg);
      window._guardarImagenPlantillaWA(tipo, rawB64);
      window._actualizarVistaImagenPlantillaWA(tipo);
      mostrarToast('¡Imagen adjuntada a la plantilla!', 'success');
    };
    tempImg.src = rawB64;
  };
  reader.onerror = function (errRead) {
    console.error('[WA] Error leyendo archivo:', errRead);
    mostrarToast('Error al leer el archivo de imagen', 'error');
  };
  reader.readAsDataURL(file);
};

window.cambiarSubtabWhatsApp = function (tab) {
  window._waActiveSubtab = tab;
  const tabs = ['servidor', 'automatico', 'plantillas', 'logs'];
  tabs.forEach(t => {
    const btn = $(`btnWaSub${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const sec = $(`waSec${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (sec) sec.style.display = (t === tab) ? 'block' : 'none';
  });

  if (tab === 'plantillas') {
    window.cambiarTabPlantillaWhatsApp(window._waActiveTemplateType || 'no_registro');
  } else if (tab === 'servidor') {
    window.actualizarPreviewImagenPruebaWA();
  } else if (tab === 'logs') {
    window.cargarLogsWhatsApp();
  }
};

window.inicializarPanelWhatsApp = async function () {
  if (!window.OpenWAService) {
    console.warn('OpenWAService no está cargado');
    return;
  }
  await window.OpenWAService.inicializar();
  const cfg = window.OpenWAService.config || {};

  if ($('txtWhatsAppServidorUrl')) $('txtWhatsAppServidorUrl').value = cfg.servidorUrl || 'http://192.168.10.129:2785';
  if ($('txtWhatsAppApiKey')) $('txtWhatsAppApiKey').value = cfg.apiKey || '';
  if ($('chkWhatsAppActivo')) $('chkWhatsAppActivo').checked = (cfg.activo !== false);

  if ($('chkWhatsAppAutoNoRegistro')) $('chkWhatsAppAutoNoRegistro').checked = !!cfg.autoEnvioNoRegistro;
  if ($('txtWhatsAppHoraCorte')) $('txtWhatsAppHoraCorte').value = cfg.horaCorteNoRegistro || '08:15';
  if ($('txtWhatsAppEnlaceApp')) $('txtWhatsAppEnlaceApp').value = cfg.enlaceApp || 'https://tcontrol.ec/asistencia';

  // Input listener en plantilla para live preview
  const txtPlantilla = $('txtWhatsAppPlantilla');
  if (txtPlantilla && !txtPlantilla._waInputAttached) {
    txtPlantilla._waInputAttached = true;
    txtPlantilla.addEventListener('input', () => {
      window.actualizarPreviewPlantillaWA();
    });
  }

  // Conectar listener de input file si no se conectó por HTML
  const imgInput = $('waImageUpload');
  if (imgInput && !imgInput._waImgAttached) {
    imgInput._waImgAttached = true;
    imgInput.addEventListener('change', window._onSubirImagenPlantillaWA);
  }

  if ($('txtWhatsAppMensajePrueba') && !$('txtWhatsAppMensajePrueba').value.trim()) {
    const tipo = $('selTipoMensajePrueba')?.value || 'ENTRADA_FALTANTE';
    $('txtWhatsAppMensajePrueba').value = window.generarMensajePruebaTexto(tipo);
  }

  window._actualizarVistaImagenPlantillaWA(window._waActiveTemplateType || 'no_registro');
  window.actualizarPreviewImagenPruebaWA();
  window.cambiarSubtabWhatsApp(window._waActiveSubtab || 'servidor');
  window.probarConexionWhatsApp(true);
};

window.probarConexionWhatsApp = async function (silencioso = false) {
  if (!window.OpenWAService) return;
  const url = $('txtWhatsAppServidorUrl')?.value.trim();
  const key = $('txtWhatsAppApiKey')?.value.trim();
  const badge = $('badgeOpenWAEstado');

  if (badge) {
    badge.style.background = '#e2e8f0';
    badge.style.color = '#475569';
    badge.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verificando...';
  }

  const res = await window.OpenWAService.probarConexion(url, key);
  if (res.ok) {
    if (badge) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.innerHTML = '<i class="fas fa-check-circle"></i> Conectado';
    }
    if ($('lblWhatsAppNumeroEmisor') && res.info) {
      $('lblWhatsAppNumeroEmisor').textContent = res.info.numeroEmisor || 'Conectado';
    }
    if ($('lblWhatsAppNombreEmisor') && res.info) {
      $('lblWhatsAppNombreEmisor').textContent = res.info.nombreEmisor || 'OpenWA';
    }
    if (!silencioso) mostrarToast('Servidor WhatsApp conectado exitosamente', 'success');
  } else {
    if (badge) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#b91c1c';
      badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Desconectado';
    }
    if (!silencioso) mostrarToast(res.error || 'No se pudo conectar al servidor WhatsApp', 'error');
  }
};

window.generarMensajePruebaTexto = function (tipo) {
  const ahora = new Date();
  const horaStr = ahora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const fechaStr = ahora.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const appUrl = $('txtWhatsAppEnlaceApp')?.value.trim() || 'https://tcontrol.ec/asistencia';

  switch (tipo) {
    case 'ENTRADA_FALTANTE':
      return `🔔 *RECORDATORIO DE ASISTENCIA - TCONTROL*\n` +
        `Hola *Carlos Mendoza*, te recordamos que hoy ${fechaStr} a las ${horaStr} no registras marcación de entrada en planta.\n\n` +
        `Por favor registra tu asistencia o notifica a tu supervisor:\n` +
        `📲 ${appUrl}`;
    case 'AUSENCIA_LABORAL':
      return `📋 *NOTIFICACIÓN DE AUSENCIA - TALENTO HUMANO*\n` +
        `Estimado(a) *Carlos Mendoza*, al momento registras una ausencia en tu jornada laboral de hoy ${fechaStr}.\n\n` +
        `Favor justificar con certificado médico o permiso autorizado a la brevedad posible.`;
    case 'SALIDA_FALTANTE':
      return `🚪 *RECORDATORIO DE SALIDA - TCONTROL*\n` +
        `Estimado(a) *Carlos Mendoza*, ha finalizado el horario de tu jornada laboral de hoy ${fechaStr}.\n\n` +
        `Recuerda marcar tu salida en la app para el cómputo correcto de horas laboradas:\n` +
        `📲 ${appUrl}`;
    case 'ALERTA_EMERGENCIA':
      return `🚨 *COMUNICADO DE SEGURIDAD INDUSTRIAL - TCONTROL*\n` +
        `Se informa a todo el personal en planta y campo que a las 14:00 se llevará a cabo una prueba de alarmas y simulacro de evacuación.\n\n` +
        `Favor seguir las instrucciones de los brigadistas designados.`;
    case 'PING_RAPIDO':
      return `⚡ *TEST DE CONEXIÓN OPENWA - TCONTROL*\n` +
        `Verificación de canal de notificaciones WhatsApp operativo.\n` +
        `⏰ Fecha y hora: ${fechaStr} ${horaStr}\n` +
        `Estado: OK ✅`;
    case 'PLANTILLA_ACTIVA':
      const tplActual = $('txtWhatsAppPlantilla')?.value || '';
      if (tplActual.trim()) {
        return tplActual
          .replace(/\{colaborador\}/gi, 'Carlos Mendoza')
          .replace(/\{empresa\}/gi, 'Tcontrol S.A.')
          .replace(/\{fecha\}/gi, fechaStr)
          .replace(/\{hora\}/gi, horaStr)
          .replace(/\{enlace_app\}/gi, appUrl);
      }
      return `Hola *Carlos Mendoza*, este es un mensaje de prueba de la plantilla activa de Tcontrol.`;
    case 'PERSONALIZADO':
    default:
      return `👋 Hola! Este es un mensaje de prueba enviado desde el sistema de Control de Asistencia Tcontrol (${fechaStr} ${horaStr}).`;
  }
};

window.actualizarPreviewImagenPruebaWA = function (tipo) {
  tipo = tipo || $('selTipoMensajePrueba')?.value || 'ENTRADA_FALTANTE';
  const templateKey = window._resolverTipoPlantillaWA(tipo);
  const img = window._obtenerImagenPlantillaWA(templateKey);
  const cont = $('waPruebaImgPreviewContainer');
  const imgEl = $('waPruebaImgPreviewEl');
  if (img && cont && imgEl) {
    imgEl.src = img;
    cont.style.display = 'block';
  } else if (cont) {
    cont.style.display = 'none';
    if (imgEl) imgEl.src = '';
  }
};

window.cargarMensajePruebaSeleccionado = function (tipo) {
  if ($('selTipoMensajePrueba')) {
    $('selTipoMensajePrueba').value = tipo;
  }
  const msgArea = $('txtWhatsAppMensajePrueba');
  if (msgArea) {
    msgArea.value = window.generarMensajePruebaTexto(tipo);
    msgArea.focus();
  }
  window.actualizarPreviewImagenPruebaWA(tipo);
};

window.regenerarMensajePrueba = function () {
  const tipo = $('selTipoMensajePrueba')?.value || 'ENTRADA_FALTANTE';
  window.cargarMensajePruebaSeleccionado(tipo);
};

window.probarEnvioWhatsApp = async function () {
  if (!window.OpenWAService) {
    mostrarToast('Servicio OpenWA no disponible', 'error');
    return;
  }
  const num = $('txtWhatsAppNumeroPrueba')?.value.trim();
  let msg = $('txtWhatsAppMensajePrueba')?.value.trim();

  if (!num) {
    mostrarToast('Ingresa un número telefónico para la prueba', 'error');
    $('txtWhatsAppNumeroPrueba')?.focus();
    return;
  }
  const tipo = $('selTipoMensajePrueba')?.value || 'ENTRADA_FALTANTE';
  if (!msg) {
    msg = window.generarMensajePruebaTexto(tipo);
    if ($('txtWhatsAppMensajePrueba')) $('txtWhatsAppMensajePrueba').value = msg;
  }

  const templateKey = window._resolverTipoPlantillaWA(tipo);
  const imgAdjunta = window._obtenerImagenPlantillaWA(templateKey);

  mostrarLoader(true);
  try {
    let res;
    if (imgAdjunta) {
      res = await window.OpenWAService.enviarMensajeImagen(num, msg, imgAdjunta);
    } else {
      res = await window.OpenWAService.enviarMensajeTexto(num, msg);
    }

    const tipoLog = $('selTipoMensajePrueba')?.value || 'PRUEBA_SISTEMA';
    if (res && res.ok) {
      const detalleAdj = imgAdjunta ? ' (con imagen adjunta)' : '';
      mostrarToast('Mensaje de prueba enviado con éxito a ' + num + detalleAdj, 'success');
      if (window.OpenWAService && window.OpenWAService.registrarLogEnvio) {
        window.OpenWAService.registrarLogEnvio({
          empleadoId: 'TEST-001',
          empleadoNombre: 'Prueba de Sistema',
          telefono: num,
          tipoNotificacion: `PRUEBA_${tipoLog}`,
          mensaje: msg,
          estado: 'ENVIADO',
          error: ''
        });
      }
      if (typeof window.cargarLogsWhatsApp === 'function') {
        setTimeout(() => window.cargarLogsWhatsApp(), 800);
      }
    } else {
      mostrarToast((res && res.error) || 'Error al enviar mensaje de prueba', 'error');
      if (window.OpenWAService && window.OpenWAService.registrarLogEnvio) {
        window.OpenWAService.registrarLogEnvio({
          empleadoId: 'TEST-001',
          empleadoNombre: 'Prueba de Sistema',
          telefono: num,
          tipoNotificacion: `PRUEBA_${tipoLog}`,
          mensaje: msg,
          estado: 'ERROR',
          error: (res && res.error) || 'Fallo de entrega'
        });
      }
      if (typeof window.cargarLogsWhatsApp === 'function') {
        setTimeout(() => window.cargarLogsWhatsApp(), 800);
      }
    }
  } catch (e) {
    mostrarToast('Error de conexión: ' + e.message, 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.guardarConfiguracionWhatsAppDesdePanel = async function () {
  if (!window.OpenWAService) return;
  const cfg = {
    servidorUrl: $('txtWhatsAppServidorUrl')?.value.trim() || window.OpenWAService.config?.servidorUrl || 'http://192.168.10.129:2785',
    apiKey: $('txtWhatsAppApiKey')?.value.trim() || '',
    activo: $('chkWhatsAppActivo')?.checked ?? true,
    autoEnvioNoRegistro: $('chkWhatsAppAutoNoRegistro')?.checked ?? false,
    horaCorteNoRegistro: $('txtWhatsAppHoraCorte')?.value || '08:15',
    enlaceApp: $('txtWhatsAppEnlaceApp')?.value.trim() || 'https://tcontrol.ec/asistencia'
  };

  // Guardar la plantilla activa actual
  const tipo = window._waActiveTemplateType || 'no_registro';
  const texto = $('txtWhatsAppPlantilla')?.value || '';
  if (tipo === 'no_registro') cfg.plantillaNoRegistro = texto;
  else if (tipo === 'vacaciones') cfg.plantillaVacaciones = texto;
  else if (tipo === 'permisos' || tipo === 'permiso') cfg.plantillaPermiso = texto;
  else if (tipo === 'ausente') cfg.plantillaAusente = texto;
  else if (tipo === 'salida_faltante') cfg.plantillaSalidaFaltante = texto;
  else if (tipo === 'emergencia') cfg.plantillaEmergencia = texto;
  else if (tipo.startsWith('custom_') && window._plantillasPersonalizadas[tipo]) {
    window._plantillasPersonalizadas[tipo].texto = texto;
    try { localStorage.setItem('tcontrol_wa_plantillas_custom', JSON.stringify(window._plantillasPersonalizadas)); } catch (e) { }
  }

  if (window.OpenWAService?.config?.imagenesPlantillas) {
    cfg.imagenesPlantillas = { ...window.OpenWAService.config.imagenesPlantillas };
  }

  mostrarLoader(true);
  try {
    await window.OpenWAService.guardarConfiguracion(cfg);
    mostrarToast('Configuración y plantillas de WhatsApp guardadas exitosamente', 'success');
  } catch (e) {
    mostrarToast('Error al guardar configuración: ' + e.message, 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.verificarAutoEnvioWhatsApp = async function (forzar = false) {
  if (!window.OpenWAService) {
    mostrarToast('Servicio OpenWA no disponible', 'error');
    return;
  }

  // Si se invoca con forzar=true (botón "Probar / Disparar Alerta Automática Ahora")
  if (forzar) {
    if (typeof window.abrirModalNotificarWhatsApp === 'function') {
      window.abrirModalNotificarWhatsApp('sin_marcar');
    } else if (typeof window.abrirModalEnvioWhatsApp === 'function') {
      window.abrirModalEnvioWhatsApp('sin_marcar');
    } else {
      mostrarToast('Módulo de envío de alertas WhatsApp no disponible', 'error');
    }
    return;
  }

  // Chequeo periódico en segundo plano
  const hoy = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0];
  const empActivos = (empCache || []).filter(e => {
    const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
    const soloAlm = (typeof esEmpleadoSoloAlmuerzo === 'function') ? esEmpleadoSoloAlmuerzo(e) : ((e.cargo || '').toUpperCase() === 'SIN ASISTENCIA');
    const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
    return act && !soloAlm && !excluido;
  });

  const sinMarcar = empActivos.filter(e => {
    if (e.entradaHoy) return false;

    const fReg = (e.registros || []).find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    const rHoy = fReg ? (fReg.razon_ausencia || fReg.razon_permiso || fReg.razon_justificac || '') : '';
    const rUpper = rHoy.toUpperCase();
    const modoStr = (e.modo || '').toUpperCase();
    const regCampo = (e.registros || []).some(reg => reg.modo === 'CAMPO' && reg.fecha === hoy);

    if (rUpper.includes('VACACI') || (e.estado || '').toUpperCase() === 'VACACIONES') return false;
    if (rUpper.includes('CAMPO') || modoStr.includes('CAMPO') || regCampo) return false;
    if (rUpper.length > 0) return false;

    return true;
  });

  try {
    await window.OpenWAService.ejecutarChequeoAutomatico(sinMarcar, false);
  } catch (e) {
    console.warn("[OpenWA] Error en verificación periódica de WhatsApp:", e);
  }
};

window.restablecerConfiguracionWhatsApp = function () {
  if (!confirm('¿Deseas restablecer la plantilla activa a su texto predeterminado?')) return;
  if (!window.OpenWAService) return;
  const tipo = window._waActiveTemplateType || 'no_registro';
  const defaults = {
    no_registro: (
      "🔔 *NOTIFICACIÓN DE ASISTENCIA — TCONTROL*\n\n" +
      "Estimado/a *{nombre}*,\n\n" +
      "Te informamos que al momento (*{hora}* del {fecha}) no registras marcación de ingreso en el sistema de Asistencia Tcontrol.\n\n" +
      "⚠️ *Por favor:* Si ya te encuentras en tu jornada laboral, recuerda registrar tu asistencia en la aplicación móvil o comunicarte con tu supervisor / RRHH para justificar la novedad.\n\n" +
      "📱 *App de Asistencia:* {link}\n" +
      "_Este es un mensaje automático de control y seguimiento._"
    ),
    ausente: (
      "📋 *AVISO DE AUSENCIA LABORAL — TCONTROL*\n\n" +
      "Estimado/a *{nombre}*,\n\n" +
      "Se ha registrado tu *AUSENCIA* en la jornada laboral del día de hoy (*{fecha}*).\n\n" +
      "📌 *Acción requerida:* Por favor presenta el justificativo respectivo (médico, calamidad o permiso personal) a tu supervisor o mediante la aplicación de Asistencia en el transcurso del día.\n\n" +
      "📱 *App de Asistencia:* {link}\n" +
      "_Departamento de Talento Humano / Operaciones Tcontrol._"
    ),
    salida_faltante: (
      "🚪 *RECORDATORIO DE REGISTRO DE SALIDA — TCONTROL*\n\n" +
      "Estimado/a *{nombre}*,\n\n" +
      "Detectamos que registraste tu ingreso hoy ({fecha}), pero aún *no has registrado tu marcación de salida*.\n\n" +
      "⏰ *Recordatorio:* Recuerda marcar tu salida en la app antes de retirarte para que tus horas laboradas queden registradas correctamente.\n\n" +
      "📱 *App de Asistencia:* {link}\n" +
      "_Control de Asistencia Tcontrol._"
    ),
    emergencia: (
      "🚨 *ALERTA GENERAL DE SEGURIDAD — TCONTROL*\n\n" +
      "Estimado/a *{nombre}*,\n\n" +
      "Se ha activado una alerta operativa / simulacro de emergencia en la plataforma.\n\n" +
      "⚠️ *Instrucción Inmediata:* Por favor ingresa a la aplicación de Asistencia y pulsa el botón *🚨 Reportar mi Estado* para confirmar tu ubicación y seguridad.\n\n" +
      "📱 *Confirmar Estado:* {link}\n" +
      "_Comité de Seguridad y Operaciones Tcontrol._"
    )
  };

  const txt = defaults[tipo] || defaults.no_registro;
  if ($('txtWhatsAppPlantilla')) $('txtWhatsAppPlantilla').value = txt;
  window.actualizarPreviewPlantillaWA();
  mostrarToast('Plantilla restablecida a valor por defecto', 'info');
};

window.cambiarTabPlantillaWhatsApp = function (tipo) {
  window._waActiveTemplateType = tipo;
  const buttons = [
    { id: 'btnTabPlantillaNoRegistro', tipo: 'no_registro' },
    { id: 'btnTabPlantillaVacaciones', tipo: 'vacaciones' },
    { id: 'btnTabPlantillaPermiso', tipo: 'permisos' },
    { id: 'btnTabPlantillaAusente', tipo: 'ausente' },
    { id: 'btnTabPlantillaSalida', tipo: 'salida_faltante' },
    { id: 'btnTabPlantillaEmergencia', tipo: 'emergencia' }
  ];

  buttons.forEach(b => {
    const el = $(b.id);
    if (el) {
      const isActive = (b.tipo === tipo);
      el.style.background = isActive ? '#ecfdf5' : '#ffffff';
      el.style.color = isActive ? '#15803d' : '#475569';
      el.style.borderColor = isActive ? '#86efac' : '#cbd5e1';
      el.style.fontWeight = isActive ? '700' : '600';
    }
  });

  const titulosMap = {
    no_registro: 'Plantilla: Entrada Faltante (Sin Marcar)',
    vacaciones: 'Plantilla: Notificación de Vacaciones',
    permisos: 'Plantilla: Permiso o Justificación Laboral',
    ausente: 'Plantilla: Ausencia Laboral',
    salida_faltante: 'Plantilla: Salida Faltante',
    emergencia: 'Plantilla: Alerta de Emergencia'
  };

  if ($('lblTituloPlantillaActiva')) {
    $('lblTituloPlantillaActiva').textContent = titulosMap[tipo] || (window._plantillasPersonalizadas[tipo]?.nombre || 'Plantilla Personalizada');
  }

  const btnEliminar = $('btnEliminarPlantillaActual');
  if (btnEliminar) {
    btnEliminar.classList.toggle('hidden', !tipo.startsWith('custom_'));
  }

  const cfg = window.OpenWAService ? window.OpenWAService.config : {};
  const def = (window.DEFAULT_CONFIG_WHATSAPP || (window.OpenWAService ? window.OpenWAService.DEFAULT_CONFIG_WHATSAPP : null)) || {};
  let txt = '';
  if (tipo === 'ausente') txt = cfg.plantillaAusente || def.plantillaAusente;
  else if (tipo === 'vacaciones') txt = cfg.plantillaVacaciones || def.plantillaVacaciones;
  else if (tipo === 'permisos' || tipo === 'permiso') txt = cfg.plantillaPermiso || def.plantillaPermiso;
  else if (tipo === 'salida_faltante') txt = cfg.plantillaSalidaFaltante || def.plantillaSalidaFaltante;
  else if (tipo === 'emergencia') txt = cfg.plantillaEmergencia || def.plantillaEmergencia;
  else if (tipo.startsWith('custom_')) txt = window._plantillasPersonalizadas[tipo]?.texto || '';
  else txt = cfg.plantillaNoRegistro || def.plantillaNoRegistro;

  if ($('txtWhatsAppPlantilla')) {
    $('txtWhatsAppPlantilla').value = txt || '';
  }
  window.actualizarPreviewPlantillaWA();
  window._actualizarVistaImagenPlantillaWA(tipo);
};

window.insertarVariableWhatsApp = function (variable) {
  const textarea = $('txtWhatsAppPlantilla');
  if (!textarea) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const text = textarea.value;
  textarea.value = text.substring(0, start) + variable + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + variable.length;
  window.actualizarPreviewPlantillaWA();
};

window.actualizarPreviewPlantillaWA = function () {
  const preview = $('previewWhatsAppBody');
  if (!preview) return;
  const raw = $('txtWhatsAppPlantilla')?.value || '';

  const ahora = new Date();
  const dia = ahora.getDate().toString().padStart(2, '0');
  const mes = (ahora.getMonth() + 1).toString().padStart(2, '0');
  const fecha = `${dia}/${mes}/${ahora.getFullYear()}`;
  const hora = ahora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

  let formatted = raw
    .replace(/\{nombre\}/gi, 'Carlos Mendoza')
    .replace(/\{fecha\}/gi, fecha)
    .replace(/\{hora\}/gi, hora)
    .replace(/\{link\}/gi, $('txtWhatsAppEnlaceApp')?.value || 'https://tcontrol.ec/asistencia')
    .replace(/\{area\}/gi, 'Producción')
    .replace(/\{cargo\}/gi, 'Técnico Electromecánico');

  // WhatsApp Markdown to HTML
  formatted = escapeHtml(formatted)
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/~(.*?)~/g, '<del>$1</del>');

  preview.innerHTML = formatted;
  if ($('previewWhatsAppHora')) $('previewWhatsAppHora').textContent = hora;
};

window.abrirModalNuevaPlantilla = function () {
  const m = $('modalNuevaPlantillaWhatsApp');
  if (m) {
    if ($('txtNuevaPlantillaNombre')) $('txtNuevaPlantillaNombre').value = '';
    if ($('fileNuevaPlantillaImg')) $('fileNuevaPlantillaImg').value = '';
    m.classList.remove('hidden');
  }
};

window.guardarNuevaPlantillaCustom = function () {
  const nom = $('txtNuevaPlantillaNombre')?.value.trim();
  if (!nom) {
    mostrarToast('Ingresa un nombre para la nueva plantilla', 'error');
    return;
  }
  const key = 'custom_' + Date.now();
  const fileInput = $('fileNuevaPlantillaImg');
  const file = fileInput?.files && fileInput.files[0];

  const savePlantilla = (b64Img = null) => {
    window._plantillasPersonalizadas[key] = {
      nombre: nom,
      texto: `Hola *{nombre}*,\n\nTe compartimos este comunicado importante de Tcontrol.\n\n📱 *App:* {link}`,
      imagenBase64: b64Img
    };
    try { localStorage.setItem('tcontrol_wa_plantillas_custom', JSON.stringify(window._plantillasPersonalizadas)); } catch (e) { }
    window.renderTabsPersonalizadasWA();
    window.cambiarTabPlantillaWhatsApp(key);
    $('modalNuevaPlantillaWhatsApp').classList.add('hidden');
    mostrarToast('Plantilla creada exitosamente', 'success');
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => savePlantilla(e.target.result);
    reader.readAsDataURL(file);
  } else {
    savePlantilla(null);
  }
};

window.eliminarPlantillaActual = function () {
  const tipo = window._waActiveTemplateType;
  if (!tipo || !tipo.startsWith('custom_')) return;
  if (!confirm('¿Seguro que deseas eliminar esta plantilla personalizada?')) return;
  delete window._plantillasPersonalizadas[tipo];
  try { localStorage.setItem('tcontrol_wa_plantillas_custom', JSON.stringify(window._plantillasPersonalizadas)); } catch (e) { }
  window.renderTabsPersonalizadasWA();
  window.cambiarTabPlantillaWhatsApp('no_registro');
  mostrarToast('Plantilla eliminada', 'info');
};

window.renderTabsPersonalizadasWA = function () {
  const cont = $('contenedorTabsPersonalizadas');
  if (!cont) return;
  try {
    const local = localStorage.getItem('tcontrol_wa_plantillas_custom');
    if (local) window._plantillasPersonalizadas = JSON.parse(local);
  } catch (e) { }

  cont.innerHTML = Object.entries(window._plantillasPersonalizadas || {}).map(([k, v]) => {
    const isActive = (window._waActiveTemplateType === k);
    return `
          <button type="button" class="btn" onclick="window.cambiarTabPlantillaWhatsApp('${k}')" style="padding:7px 14px; border-radius:8px; font-size:12px; font-weight:${isActive ? '700' : '600'}; border:1px solid ${isActive ? '#86efac' : '#cbd5e1'}; background:${isActive ? '#ecfdf5' : '#ffffff'}; color:${isActive ? '#15803d' : '#475569'}; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            <i class="fas fa-file-alt"></i> ${escapeHtml(v.nombre || 'Personalizada')}
          </button>
        `;
  }).join('');
};

window.cargarLogsWhatsApp = async function () {
  const tbody = $('tbodyLogsWhatsApp');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--g500);"><i class="fas fa-spinner fa-spin"></i> Cargando auditoría de envíos...</td></tr>';

  try {
    let logs = [];
    if (window.OpenWAService && typeof window.OpenWAService.obtenerLogsWhatsApp === 'function') {
      const res = await window.OpenWAService.obtenerLogsWhatsApp(100);
      logs = (res && res.logs) ? res.logs : (Array.isArray(res) ? res : []);
    } else {
      const res = await jsonpRequest({ accion: 'obtenerLogsWhatsApp', limite: 100 });
      logs = (res && res.logs) ? res.logs : (Array.isArray(res) ? res : []);
    }

    window._logsWhatsAppCache = logs;
    window.renderLogsWhatsApp(logs);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--red);">Error cargando logs: ${e.message}</td></tr>`;
  }
};
window.cargarLogsAuditoriaWhatsApp = window.cargarLogsWhatsApp;

window.renderLogsWhatsApp = function (logs) {
  const tbody = $('tbodyLogsWhatsApp');
  if (!tbody) return;
  if (!logs || !logs.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--g500);">No se registran envíos de WhatsApp en la hoja LOGS_WHATSAPP.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const esEnviado = (l.estado === 'ENVIADO');
    return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; font-size:11.5px; color:#64748b;">${l.fecha || '--'}</td>
            <td style="padding: 8px 12px; font-size:11.5px; color:#64748b;">${l.hora || '--'}</td>
            <td style="padding: 8px 12px; font-weight:600; font-size:12px;">${escapeHtml(l.nombreEmpleado || l.destinatario || '--')}</td>
            <td style="padding: 8px 12px; font-family:monospace; font-size:11.5px;">${l.telefono || '--'}</td>
            <td style="padding: 8px 12px; font-size:11.5px;"><span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:10px;">${l.tipoNotificacion || l.tipo || 'General'}</span></td>
            <td style="padding: 8px 12px;">
              <span class="badge" style="background:${esEnviado ? '#dcfce7' : '#fee2e2'}; color:${esEnviado ? '#15803d' : '#b91c1c'}; font-weight:700; font-size:10.5px;">
                ${esEnviado ? '<i class="fas fa-check"></i> ENVIADO' : '<i class="fas fa-times"></i> ' + (l.estado || 'ERROR')}
              </span>
            </td>
            <td style="padding: 8px 12px; font-size:11px; color:#64748b;">${l.origen || 'MANUAL'}</td>
            <td style="padding: 8px 12px; font-size:11px; color:#475569; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(l.detalleRespuesta || '')}">
              ${escapeHtml(l.detalleRespuesta || '--')}
            </td>
          </tr>
        `;
  }).join('');
};

window.filtrarLogsWhatsApp = function (query) {
  const q = (query || '').toLowerCase().trim();
  const logs = window._logsWhatsAppCache || [];
  if (!q) {
    window.renderLogsWhatsApp(logs);
    return;
  }
  const filtered = logs.filter(l => {
    return (l.nombreEmpleado || '').toLowerCase().includes(q) ||
      (l.telefono || '').includes(q) ||
      (l.tipoNotificacion || '').toLowerCase().includes(q) ||
      (l.estado || '').toLowerCase().includes(q);
  });
  window.renderLogsWhatsApp(filtered);
};

// Modal de Envío Rápido / Masivo por WhatsApp
window.abrirModalNotificarWhatsApp = function (categoria = 'sin_marcar') {
  const modal = $('modalNotificarSinMarcarWhatsApp');
  if (!modal) return;
  modal.classList.remove('hidden');
  window.cambiarCategoriaModalWhatsApp(categoria);
};
window.abrirModalEnvioWhatsApp = window.abrirModalNotificarWhatsApp;

window.cerrarModalNotificarSinMarcar = function () {
  const modal = $('modalNotificarSinMarcarWhatsApp');
  if (modal) modal.classList.add('hidden');
  const bar = $('progresoEnvioWhatsAppContainer');
  if (bar) bar.style.display = 'none';
  const btn = $('btnEjecutarEnvioWhatsApp');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
};

window.cambiarCategoriaModalWhatsApp = function (categoria) {
  window._waModalCategoriaActual = categoria;
  const cats = [
    { id: 'btnModalCatSinMarcar', cat: 'sin_marcar' },
    { id: 'btnModalCatVacaciones', cat: 'vacaciones' },
    { id: 'btnModalCatPermisos', cat: 'permisos' },
    { id: 'btnModalCatAusentes', cat: 'ausente' },
    { id: 'btnModalCatSalida', cat: 'salida_faltante' },
    { id: 'btnModalCatEmergencia', cat: 'emergencia' }
  ];

  cats.forEach(c => {
    const el = $(c.id);
    if (el) {
      const isActive = (c.cat === categoria);
      el.style.background = isActive ? '#f0fdf4' : '#ffffff';
      el.style.color = isActive ? '#15803d' : '#475569';
      el.style.borderColor = isActive ? '#bbf7d0' : '#cbd5e1';
      el.style.fontWeight = isActive ? '700' : '600';
    }
  });

  const titulos = {
    sin_marcar: 'Notificar Colaboradores Sin Marcar (Injustificados)',
    vacaciones: 'Notificar Colaboradores en Vacaciones',
    permisos: 'Notificar Colaboradores con Permiso / Justificativo',
    ausente: 'Notificar a Todos los Ausentes',
    salida_faltante: 'Recordatorio de Marcación de Salida',
    emergencia: 'Alerta Operativa y de Seguridad'
  };
  const subtitulos = {
    sin_marcar: 'Colaboradores sin marcación que NO tienen registradas vacaciones ni permisos autorizados',
    vacaciones: 'Colaboradores que se encuentran en su período oficial de vacaciones el día de hoy',
    permisos: 'Colaboradores con permiso, licencia o justificación médica/personal registrada para hoy',
    ausente: 'Listado consolidado de todos los ausentes con el motivo de ausencia correspondiente',
    salida_faltante: 'Colaboradores que marcaron su entrada pero aún no registran su marcación de salida',
    emergencia: 'Envío masivo de alerta institucional o de seguridad a toda la nómina activa'
  };

  if ($('lblTituloModalWhatsApp')) $('lblTituloModalWhatsApp').textContent = titulos[categoria] || 'Notificar por WhatsApp';
  if ($('lblSubtituloModalWhatsApp')) $('lblSubtituloModalWhatsApp').textContent = subtitulos[categoria] || 'Despacho masivo directo vía OpenWA';

  const hoy = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0];

  const empActivos = (empCache || []).filter(e => {
    const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
    const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
    const isSinAsis = (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    return act && !excluido && !isSinAsis;
  });

  // Clasificar rigurosamente cada colaborador según su condición de hoy
  const enriquecidos = empActivos.map(e => {
    const fReg = (e.registros || []).find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    const rHoy = fReg ? (fReg.razon_ausencia || fReg.razon_permiso || fReg.razon_justificac || '') : '';
    const rUpper = rHoy.toUpperCase();
    const modoStr = (e.modo || '').toUpperCase();
    const regCampo = (e.registros || []).some(reg => reg.modo === 'CAMPO' && reg.fecha === hoy);

    const esVacaciones = rUpper.includes('VACACI') || (e.estado || '').toUpperCase() === 'VACACIONES';
    const esCampo = rUpper.includes('CAMPO') || modoStr.includes('CAMPO') || regCampo;
    const esPermiso = !esVacaciones && !esCampo && rUpper.length > 0;
    const esSinMarcar = !e.entradaHoy && !esVacaciones && !esCampo && !esPermiso;
    const esSalidaFaltante = !!(e.entradaHoy && !e.salidaHoy);

    return {
      ...e,
      _esVacaciones: esVacaciones,
      _esCampo: esCampo,
      _esPermiso: esPermiso,
      _esSinMarcar: esSinMarcar,
      _esSalidaFaltante: esSalidaFaltante,
      _razonAusencia: rHoy
    };
  });

  const listaSinMarcar = enriquecidos.filter(e => e._esSinMarcar);
  const listaVacaciones = enriquecidos.filter(e => e._esVacaciones);
  const listaPermisos = enriquecidos.filter(e => e._esPermiso);
  const listaAusentes = enriquecidos.filter(e => !e.entradaHoy && !e._esCampo);
  const listaSalida = enriquecidos.filter(e => e._esSalidaFaltante);
  const listaEmergencia = [...enriquecidos];

  // Actualizar conteos dinámicos en las pestañas del modal
  if ($('lblModalCountSinMarcar')) $('lblModalCountSinMarcar').textContent = listaSinMarcar.length;
  if ($('lblModalCountVacaciones')) $('lblModalCountVacaciones').textContent = listaVacaciones.length;
  if ($('lblModalCountPermisos')) $('lblModalCountPermisos').textContent = listaPermisos.length;
  if ($('lblModalCountAusentes')) $('lblModalCountAusentes').textContent = listaAusentes.length;
  if ($('lblModalCountSalida')) $('lblModalCountSalida').textContent = listaSalida.length;

  let destinatarios = [];
  if (categoria === 'sin_marcar') {
    destinatarios = listaSinMarcar;
  } else if (categoria === 'vacaciones') {
    destinatarios = listaVacaciones;
  } else if (categoria === 'permisos') {
    destinatarios = listaPermisos;
  } else if (categoria === 'ausente') {
    destinatarios = listaAusentes;
  } else if (categoria === 'salida_faltante') {
    destinatarios = listaSalida;
  } else if (categoria === 'emergencia') {
    destinatarios = listaEmergencia;
  }

  window._destinatariosWhatsAppActuales = destinatarios;
  const listContainer = $('listaColaboradoresSinMarcarWhatsApp');
  if (!listContainer) return;

  if ($('lblTotalSinMarcarModal')) $('lblTotalSinMarcarModal').textContent = destinatarios.length;
  const conTel = destinatarios.filter(e => !!(e.telefono || e.celular)).length;
  if ($('lblInfoConTelefono')) $('lblInfoConTelefono').textContent = `${conTel} con teléfono registrado`;

  if (!destinatarios.length) {
    listContainer.innerHTML = `
          <div style="text-align:center; padding:20px; color:#64748b; background:#f8fafc; border-radius:8px; font-size:12.5px;">
            <i class="fas fa-check-circle" style="color:#16a34a; font-size:20px; margin-bottom:6px; display:block;"></i>
            No hay colaboradores pendientes en esta categoría.
          </div>
        `;
  } else {
    listContainer.innerHTML = destinatarios.map((e) => {
      const tel = e.telefono || e.celular || '';
      const tieneTel = !!tel;
      let badgeRazon = '';
      if (e._razonAusencia) {
        badgeRazon = `<span style="font-size:10px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:1px 6px; border-radius:4px; margin-left:6px;"><i class="fas fa-file-medical"></i> ${escapeHtml(e._razonAusencia)}</span>`;
      } else if (e._esVacaciones) {
        badgeRazon = `<span style="font-size:10px; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:1px 6px; border-radius:4px; margin-left:6px;">🏖️ Vacaciones</span>`;
      } else if (e._esPermiso) {
        badgeRazon = `<span style="font-size:10px; background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:1px 6px; border-radius:4px; margin-left:6px;">📝 Permiso</span>`;
      } else if (!e.entradaHoy && categoria === 'ausente') {
        badgeRazon = `<span style="font-size:10px; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; padding:1px 6px; border-radius:4px; margin-left:6px;">⚠️ Sin justificar</span>`;
      }
      return `
            <label style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; margin:0;">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" class="chk-wa-emp" value="${e.id}" ${tieneTel ? 'checked' : 'disabled'} onchange="window.actualizarContadorModalWhatsApp()" style="accent-color:#16a34a; width:16px; height:16px;">
                <div>
                  <div style="display:flex; align-items:center;">
                    <strong style="font-size:12.5px; color:#1e293b;">${escapeHtml(e.nombre)}</strong>
                    ${badgeRazon}
                  </div>
                  <span style="font-size:11px; color:#64748b;">${escapeHtml(e.area || 'Sin área')} • ${escapeHtml(e.cargo || 'Colaborador')}</span>
                </div>
              </div>
              <div>
                ${tieneTel
          ? `<span style="font-family:monospace; font-size:11.5px; color:#15803d; background:#dcfce7; padding:2px 8px; border-radius:6px; font-weight:600;"><i class="fab fa-whatsapp"></i> ${tel}</span>`
          : `<span style="font-size:11px; color:#b91c1c; background:#fee2e2; padding:2px 8px; border-radius:6px; font-weight:700;"><i class="fas fa-times-circle"></i> Sin Teléfono</span>`
        }
              </div>
            </label>
          `;
    }).join('');
  }

  window.actualizarContadorModalWhatsApp();

  // Preview de mensaje
  if ($('previewMensajeModalWhatsApp') && window.OpenWAService) {
    const templateKey = window._resolverTipoPlantillaWA(categoria);
    const msgSample = window.OpenWAService.formatearMensaje(templateKey, { nombre: 'Colaborador', area: 'Operaciones', cargo: 'Personal' });
    const imgAdjunta = (typeof window._obtenerImagenPlantillaWA === 'function') ? window._obtenerImagenPlantillaWA(templateKey) : window.OpenWAService.obtenerImagenPlantilla(templateKey);
    let previewHtml = '';
    if (imgAdjunta) {
      previewHtml += `<div style="margin-bottom:10px; text-align:center;"><img src="${imgAdjunta}" style="max-height:140px; max-width:100%; border-radius:8px; object-fit:cover; border:1px solid #cbd5e1; display:inline-block; box-shadow:0 2px 6px rgba(0,0,0,0.08);" alt="Adjunto"><div style="font-size:11px; color:#16a34a; font-weight:700; margin-top:4px;"><i class="fas fa-image"></i> Imagen adjunta vinculada a esta plantilla</div></div>`;
    }
    previewHtml += `<div style="white-space:pre-wrap;">${escapeHtml(msgSample)}</div>`;
    $('previewMensajeModalWhatsApp').innerHTML = previewHtml;
  }
};

window.toggleSeleccionarTodosWhatsApp = function (checked) {
  document.querySelectorAll('.chk-wa-emp').forEach(chk => {
    if (!chk.disabled) chk.checked = checked;
  });
  window.actualizarContadorModalWhatsApp();
};

window.actualizarContadorModalWhatsApp = function () {
  const checkedBoxes = document.querySelectorAll('.chk-wa-emp:checked');
  const count = checkedBoxes.length;
  if ($('lblCountSeleccionadosWhatsApp')) $('lblCountSeleccionadosWhatsApp').textContent = count;
  const btn = $('btnEjecutarEnvioWhatsApp');
  if (btn) btn.disabled = (count === 0);
};

window.ejecutarEnvioMasivoWhatsApp = async function () {
  if (!window.OpenWAService) {
    mostrarToast('Servicio OpenWA no disponible', 'error');
    return;
  }

  const checkedIds = Array.from(document.querySelectorAll('.chk-wa-emp:checked')).map(c => c.value);
  if (!checkedIds.length) {
    mostrarToast('Selecciona al menos un colaborador con número de teléfono', 'error');
    return;
  }

  const empleadosParaEnviar = (window._destinatariosWhatsAppActuales || []).filter(e => checkedIds.includes(String(e.id)));
  if (!empleadosParaEnviar.length) return;

  const categoria = window._waModalCategoriaActual || 'sin_marcar';
  const templateKey = window._resolverTipoPlantillaWA(categoria);
  const containerProgreso = $('progresoEnvioWhatsAppContainer');
  const fillProgreso = $('barraProgresoWhatsAppFill');
  const txtProgreso = $('lblProgresoWhatsAppTexto');
  const pctProgreso = $('lblProgresoWhatsAppPorcentaje');
  const btn = $('btnEjecutarEnvioWhatsApp');

  if (containerProgreso) containerProgreso.style.display = 'block';
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

  const onProgress = (p) => {
    const pct = Math.round((p.actual / p.total) * 100);
    if (fillProgreso) fillProgreso.style.width = pct + '%';
    if (pctProgreso) pctProgreso.textContent = pct + '%';
    if (txtProgreso) txtProgreso.textContent = `Enviando a ${p.empleadoActual?.nombre || 'colaborador'} (${p.actual}/${p.total})...`;
  };

  try {
    const resultado = await window.OpenWAService.enviarNotificacionesMasivas(empleadosParaEnviar, onProgress, templateKey);
    if (txtProgreso) txtProgreso.textContent = `Envío finalizado: ${resultado.enviados} enviados, ${resultado.fallidos} fallidos`;
    mostrarToast(`Despacho WhatsApp completado: ${resultado.enviados} notificaciones enviadas exitosamente`, 'success');
    setTimeout(() => {
      window.cerrarModalNotificarSinMarcar();
    }, 1800);
  } catch (e) {
    mostrarToast('Error durante el envío masivo: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
};

// ============================================================
// MÓDULO: MENSAJERÍA DIRECTA DE WHATSAPP INDIVIDUAL
// ============================================================
window.normalizarNumeroParaWhatsApp = function (numeroRaw) {
  if (!numeroRaw) return '';
  let num = String(numeroRaw).trim().replace(/[^\d]/g, '');
  if (!num) return '';
  // Ecuador celular: 09XXXXXXXX (10 dígitos) -> 5939XXXXXXXX
  if (num.startsWith('09') && num.length === 10) {
    num = '593' + num.substring(1);
  } else if (num.startsWith('9') && num.length === 9) {
    num = '593' + num;
  } else if (num.startsWith('59309') && num.length === 13) {
    num = '593' + num.substring(5);
  }
  return num.length >= 9 ? num : '';
};

window._empWaIndividualActual = null;

window.abrirModalMensajeIndividualWhatsApp = function (id) {
  const emp = (typeof empCache !== 'undefined' ? empCache.find(x => String(x.id).trim() === String(id).trim()) : null)
    || (window.empEliminadosCache ? window.empEliminadosCache.find(x => String(x.id).trim() === String(id).trim()) : null);

  if (!emp) {
    mostrarToast('Colaborador no encontrado', 'error');
    return;
  }

  window._empWaIndividualActual = emp;

  // Renderizar datos del colaborador en la tarjeta
  if ($('nombreWaIndividual')) $('nombreWaIndividual').textContent = emp.nombre || '--';
  if ($('areaWaIndividual')) $('areaWaIndividual').textContent = emp.area || 'Sin área';
  if ($('cargoWaIndividual')) $('cargoWaIndividual').textContent = emp.cargo || 'Personal';

  const fotoEl = $('fotoWaIndividual');
  if (fotoEl) {
    if (typeof photoCell === 'function') {
      fotoEl.innerHTML = photoCell(emp, 'card');
    } else {
      const ini = (emp.nombre?.charAt(0) || '?').toUpperCase();
      fotoEl.textContent = ini;
    }
  }

  window._actualizarEstadoNumeroWaIndividual();

  // Aplicar plantilla por defecto de saludo si el mensaje está vacío
  const txtMsg = $('txtMensajeWaIndividual');
  if (txtMsg && !txtMsg.value.trim()) {
    const rawFN = (typeof obtenerFechaNacimientoEmpleado === 'function') ? obtenerFechaNacimientoEmpleado(emp) : '';
    const stC = (typeof obtenerEstadoCumpleanos === 'function') ? obtenerEstadoCumpleanos(rawFN) : null;
    if (stC && stC.esHoy) {
      window.aplicarPlantillaWaIndividual('cumple');
    } else {
      window.aplicarPlantillaWaIndividual('saludo');
    }
  } else {
    window.actualizarContadorCaracteresWa();
  }

  const modal = $('modalWhatsAppIndividual');
  if (modal) modal.classList.remove('hidden');
};

window._actualizarEstadoNumeroWaIndividual = function () {
  const emp = window._empWaIndividualActual;
  if (!emp) return;

  const rawTel = (emp.telefono || emp.celular || emp.whatsapp || '').toString().trim();
  const numWa = window.normalizarNumeroParaWhatsApp(rawTel);
  const tieneWa = !!(numWa && numWa.length >= 9);

  const badgeEl = $('badgeTelefonoWaIndividual');
  const secReg = $('secRegistrarTelWaIndividual');
  const btnWaMe = $('btnAbrirChatWaMe');
  const btnOpenWa = $('btnEnviarServidorOpenWa');

  if (tieneWa) {
    if (badgeEl) {
      badgeEl.innerHTML = `
            <span style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:5px;">
              <i class="fab fa-whatsapp" style="color:#16a34a; font-size:13px;"></i> +${numWa}
            </span>
            <div style="font-size:10px; color:#64748b; margin-top:2px;">Tel: ${escapeHtml(rawTel)}</div>
          `;
    }
    if (secReg) secReg.style.display = 'none';
    if (btnWaMe) { btnWaMe.disabled = false; btnWaMe.style.opacity = '1'; btnWaMe.style.cursor = 'pointer'; }
    if (btnOpenWa) { btnOpenWa.disabled = false; btnOpenWa.style.opacity = '1'; btnOpenWa.style.cursor = 'pointer'; }
  } else {
    if (badgeEl) {
      badgeEl.innerHTML = `
            <span style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
              <i class="fas fa-exclamation-circle" style="color:#ef4444;"></i> Sin WhatsApp
            </span>
          `;
    }
    if (secReg) {
      secReg.style.display = 'block';
      const inputNuevo = $('txtNuevoTelefonoWaIndividual');
      if (inputNuevo) inputNuevo.value = rawTel;
    }
    if (btnWaMe) { btnWaMe.disabled = true; btnWaMe.style.opacity = '0.5'; btnWaMe.style.cursor = 'not-allowed'; }
    if (btnOpenWa) { btnOpenWa.disabled = true; btnOpenWa.style.opacity = '0.5'; btnOpenWa.style.cursor = 'not-allowed'; }
  }
};

window.cerrarModalWhatsAppIndividual = function () {
  const modal = $('modalWhatsAppIndividual');
  if (modal) modal.classList.add('hidden');
  window._empWaIndividualActual = null;
};

window.actualizarContadorCaracteresWa = function () {
  const txt = $('txtMensajeWaIndividual')?.value || '';
  const lbl = $('lblLongitudMensajeWa');
  if (lbl) lbl.textContent = `${txt.length} caracteres`;
};

window.aplicarPlantillaWaIndividual = function (tipo) {
  const emp = window._empWaIndividualActual || {};
  const nombreDest = (typeof obtenerPrimerNombreYPrimerApellido === 'function')
    ? obtenerPrimerNombreYPrimerApellido(emp.nombre)
    : ((emp.nombre || 'Colaborador').trim().split(' ')[0]);
  const ahora = new Date();
  const fechaStr = ahora.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let mensaje = '';
  switch (tipo) {
    case 'entrada':
      mensaje = `Hola ${nombreDest}, te recordamos registrar tu marcación de *ENTRADA* en el sistema de asistencia T-Control correspondiente al día de hoy ${fechaStr}. ¡Que tengas una excelente jornada! ⏰`;
      break;
    case 'salida':
      mensaje = `Hola ${nombreDest}, por favor no olvides registrar tu marcación de *SALIDA* al finalizar tus actividades de hoy ${fechaStr}. ¡Buen descanso! 🚪`;
      break;
    case 'ausencia':
      mensaje = `Estimado(a) ${nombreDest}, te saludamos de T-Control. Notamos que no registras marcación el día de hoy ${fechaStr}. Por favor indícanos si tienes alguna novedad, justificación o permiso médico pendiente. 🩺`;
      break;
    case 'saludo':
      mensaje = `Hola ${nombreDest}, te saluda la administración de T-Control. ¿Cómo estás? Te contactamos referente a tu registro de asistencia laboral. 👋`;
      break;
    case 'cumple':
      mensaje = `¡Estimado(a) ${nombreDest}, te deseamos un muy Feliz Cumpleaños! 🎂🎉 De parte de todo el equipo de T-Control te enviamos un afectuoso saludo y los mejores deseos en tu día especial. ¡Que disfrutes al máximo! ✨`;
      break;
    case 'limpiar':
      mensaje = '';
      break;
    default:
      mensaje = '';
  }

  const txtEl = $('txtMensajeWaIndividual');
  if (txtEl) {
    txtEl.value = mensaje;
    txtEl.focus();
  }
  window.actualizarContadorCaracteresWa();
};

window.guardarTelefonoDesdeModalWa = async function () {
  const emp = window._empWaIndividualActual;
  if (!emp) return;

  const input = $('txtNuevoTelefonoWaIndividual');
  const nuevoTel = (input?.value || '').trim();
  const norm = window.normalizarNumeroParaWhatsApp(nuevoTel);

  if (!norm || norm.length < 9) {
    mostrarToast('Por favor ingresa un número celular válido (ej: 0984660105)', 'error');
    if (input) input.focus();
    return;
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarEmpleado',
      empleadoId: emp.id,
      campo: 'telefono',
      valor: nuevoTel
    });

    if (res && res.ok) {
      emp.telefono = nuevoTel;
      mostrarToast('Número de WhatsApp guardado correctamente', 'success');
      window._actualizarEstadoNumeroWaIndividual();

      // Refrescar en segundo plano los datos y la vista de detalle si está abierta
      if (typeof cargarDatosCompletos === 'function') {
        cargarDatosCompletos(false, true).then(() => {
          if (panelActual === 'detalle' && typeof mostrarDetalle === 'function') {
            mostrarDetalle(emp.id);
          }
        });
      }
    } else {
      mostrarToast((res && res.error) || 'No se pudo guardar el número', 'error');
    }
  } catch (e) {
    mostrarToast('Error al conectar con el servidor: ' + e.message, 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.ejecutarAbrirWhatsAppWeb = function () {
  const emp = window._empWaIndividualActual;
  if (!emp) {
    mostrarToast('No hay colaborador seleccionado', 'error');
    return;
  }

  const rawTel = (emp.telefono || emp.celular || emp.whatsapp || '').toString().trim();
  const numWa = window.normalizarNumeroParaWhatsApp(rawTel);

  if (!numWa || numWa.length < 9) {
    mostrarToast('El colaborador no tiene un número celular válido. Ingrésalo arriba y haz clic en Guardar.', 'error');
    const input = $('txtNuevoTelefonoWaIndividual');
    if (input) { input.scrollIntoView({ behavior: 'smooth' }); input.focus(); }
    return;
  }

  const mensaje = ($('txtMensajeWaIndividual')?.value || '').trim();
  if (!mensaje) {
    mostrarToast('Escribe o selecciona un mensaje para enviar', 'warning');
    $('txtMensajeWaIndividual')?.focus();
    return;
  }

  const waUrl = `https://wa.me/${numWa}?text=${encodeURIComponent(mensaje)}`;
  window.open(waUrl, '_blank');

  // Registrar log de auditoría
  if (window.OpenWAService && typeof window.OpenWAService.registrarLogEnvio === 'function') {
    window.OpenWAService.registrarLogEnvio({
      tipo: 'INDIVIDUAL_WAME',
      empleadoId: emp.id,
      empleadoNombre: emp.nombre,
      telefono: numWa,
      mensaje: mensaje,
      estado: 'ABIERTO_WAME'
    });
  }

  mostrarToast(`Abriendo chat de WhatsApp con ${emp.nombre}...`, 'success');
};

window.ejecutarEnvioDirectoOpenWA = async function () {
  const emp = window._empWaIndividualActual;
  if (!emp) {
    mostrarToast('No hay colaborador seleccionado', 'error');
    return;
  }

  const rawTel = (emp.telefono || emp.celular || emp.whatsapp || '').toString().trim();
  const numWa = window.normalizarNumeroParaWhatsApp(rawTel);

  if (!numWa || numWa.length < 9) {
    mostrarToast('El colaborador no tiene un número celular válido', 'error');
    return;
  }

  const mensaje = ($('txtMensajeWaIndividual')?.value || '').trim();
  if (!mensaje) {
    mostrarToast('Escribe o selecciona un mensaje para enviar', 'warning');
    $('txtMensajeWaIndividual')?.focus();
    return;
  }

  if (!window.OpenWAService || typeof window.OpenWAService.enviarMensajeTexto !== 'function') {
    mostrarToast('Servidor OpenWA no disponible. Abriendo chat web...', 'info');
    window.ejecutarAbrirWhatsAppWeb();
    return;
  }

  const btn = $('btnEnviarServidorOpenWa');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  mostrarToast('Enviando mensaje por servidor OpenWA...', 'info');

  try {
    const res = await window.OpenWAService.enviarMensajeTexto(numWa, mensaje);
    if (res && res.ok) {
      mostrarToast(`Mensaje enviado exitosamente a ${emp.nombre}`, 'success');
      if (window.OpenWAService.registrarLogEnvio) {
        window.OpenWAService.registrarLogEnvio({
          tipo: 'INDIVIDUAL_OPENWA',
          empleadoId: emp.id,
          empleadoNombre: emp.nombre,
          telefono: numWa,
          mensaje: mensaje,
          estado: 'ENVIADO'
        });
      }
      setTimeout(() => {
        window.cerrarModalWhatsAppIndividual();
      }, 1200);
    } else {
      const err = (res && res.error) || 'Error desconocido en el servidor';
      mostrarToast(`Fallo en el servidor: ${err}. Puedes abrirlo directamente en wa.me`, 'warning');
    }
  } catch (e) {
    mostrarToast('Error al comunicar con el servidor OpenWA: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
};

