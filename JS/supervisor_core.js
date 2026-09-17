// ============================================================
// CONFIGURACIÓN
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
const HORA_ENTRADA_REF = 450; // 7:30
const HORA_SALIDA_REF = 975;  // 16:15
const LAT_EMPRESA = -0.1288771313385675;
const LNG_EMPRESA = -78.47896772889067;
const RADIO_METROS = 250;

let empCache = [];
let periodos = [];
let panelActual = 'asistencia';
let filtroAsistenciaActual = 'todos';

// ============================================================
// CARGADORES DINÁMICOS DE LIBRERÍAS EXTERNAS PESADAS (LAZY LOAD)
// Ahorra más de 1.1 MB en la carga inicial de la página.
// ============================================================
window.asegurarXLSX = function () {
  if (typeof XLSX !== 'undefined') return Promise.resolve(window.XLSX);
  if (window._promesaCargaXLSX) return window._promesaCargaXLSX;

  window._promesaCargaXLSX = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.async = true;
    script.onload = () => {
      console.log('✅ Librería XLSX (Excel) cargada bajo demanda');
      resolve(window.XLSX);
    };
    script.onerror = () => {
      window._promesaCargaXLSX = null;
      reject(new Error('No se pudo cargar la librería XLSX'));
    };
    document.head.appendChild(script);
  });
  return window._promesaCargaXLSX;
};

window.asegurarHtml2Pdf = function () {
  if (typeof html2pdf !== 'undefined') return Promise.resolve(window.html2pdf);
  if (window._promesaCargaHtml2Pdf) return window._promesaCargaHtml2Pdf;

  window._promesaCargaHtml2Pdf = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.async = true;
    script.onload = () => {
      console.log('✅ Librería html2pdf (PDF) cargada bajo demanda');
      resolve(window.html2pdf);
    };
    script.onerror = () => {
      window._promesaCargaHtml2Pdf = null;
      reject(new Error('No se pudo cargar la librería html2pdf'));
    };
    document.head.appendChild(script);
  });
  return window._promesaCargaHtml2Pdf;
};

// Precarga no bloqueante en tiempo ocioso (después de 4 segundos)
if (typeof window !== 'undefined') {
  const iniciarPrecargaOciosa = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        window.asegurarXLSX().catch(() => {});
      }, { timeout: 6000 });
    }
  };
  if (document.readyState === 'complete') {
    setTimeout(iniciarPrecargaOciosa, 3000);
  } else {
    window.addEventListener('load', () => setTimeout(iniciarPrecargaOciosa, 3000));
  }
}

// ============================================================
// GESTIÓN DE SESIÓN SUPERVISOR Y ROLES (GLOBAL HELPERS)
// ============================================================
function getSupervisorRole(idOrSession, supObj) {
  let id = "";
  let supData = supObj;
  if (idOrSession && typeof idOrSession === 'object') {
    id = String(idOrSession.id || '').trim();
    if (!supData) supData = idOrSession;
  } else {
    id = String(idOrSession || '').trim();
  }

  if (id === "1058") return 'ADMIN_MASTER';

  const emp = supData || (typeof empCache !== 'undefined' ? empCache.find(x => String(x.id).trim() === id) : null);
  const supVal = String(emp?.supervisor || emp?.rol || '').trim().toUpperCase();

  if (supVal === 'SUPERVISOR ADMIN' || supVal === 'SUPERVISOR_ADMIN' || supVal === 'ADMIN_SUPERVISOR' || supVal === 'ADMIN') {
    return 'SUPERVISOR_ADMIN';
  }
  if (supVal === 'SI' || supVal === 'SUPERVISOR') {
    return 'SUPERVISOR';
  }
  return 'EMPLEADO';
}
window.getSupervisorRole = getSupervisorRole;

function esAdminMaster(idOrSession) {
  let sessionData = idOrSession;
  if (!sessionData) {
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  }
  return getSupervisorRole(sessionData) === 'ADMIN_MASTER';
}
window.esAdminMaster = esAdminMaster;

function tienePermisoAdmin(idOrSession) {
  let sessionData = idOrSession;
  if (!sessionData) {
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  }
  const rol = getSupervisorRole(sessionData);
  return rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN';
}
window.tienePermisoAdmin = tienePermisoAdmin;

function getLocalHoyStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcularAlmuerzosPeriodo(e, R_INI, R_FIN) {
  let todosRegs = (e.registros || []).map(r => {
    const fNorm = normalizarFechaStr(r.fecha);
    return fNorm ? { ...r, fecha: fNorm } : r;
  });
  let regsPeriodo = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN);
  let fechasAsistidas = new Set(regsPeriodo.filter(r => r.tipo === 'ENTRADA').map(r => normalizarFechaStr(r.fecha)).filter(Boolean));
  const esSinAsis = (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';

  let almPlanta = 0;
  let almFuera = 0;

  let regsPorFecha = {};
  regsPeriodo.forEach(r => {
    const fNorm = normalizarFechaStr(r.fecha);
    if (!fNorm) return;
    if (!regsPorFecha[fNorm]) regsPorFecha[fNorm] = [];
    regsPorFecha[fNorm].push(r);
  });

  Object.keys(regsPorFecha).forEach(fNorm => {
    if (!fechasAsistidas.has(fNorm) && !esSinAsis) {
      return;
    }
    let regsDia = regsPorFecha[fNorm];

    // Automatización silenciosa: si ya registró su salida antes de las 09:30, quite el almuerzo
    let salidaTemprana = regsDia.some(r => {
      if (r.tipo === 'SALIDA' && r.hora) {
        const parts = r.hora.split(':');
        const mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        return mins < 570; // 09:30
      }
      return false;
    });

    if (salidaTemprana) {
      almFuera++;
      return;
    }

    let regsAlm = regsDia.filter(r => r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO');
    let regPrincipal = regsAlm.find(r => r.tipo === 'ENTRADA') || regsAlm[0];
    if (regPrincipal) {
      const valAlm = regPrincipal.almuerzo;
      if (valAlm === 'SI' || valAlm === 'PLANTA') {
        almPlanta++;
      } else if (valAlm === 'NO' || valAlm === 'FUERA') {
        almFuera++;
      }
    }
  });

  return { almPlanta, almFuera };
}

let hoy = getLocalHoyStr();
let estaActualizando = false;
let _sortReportes = { col: null, dir: 'asc' };

// ============================================================
// UTILIDADES
// ============================================================
function $(id) { return document.getElementById(id); }

function camelCaseToTitle(key) {
  const result = String(key || '').replace(/([A-Z])/g, " $1");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

function clasificarGap(salidaReg, gap) {
  if (!salidaReg) return { tipo: 'justificar', mins: gap };
  const razon = String(salidaReg.razon_salida || '').toLowerCase();
  const tipo = String(salidaReg.tipo_salida || '').toLowerCase();
  const razonPermiso = String(salidaReg.razon_permiso || '').toLowerCase();

  if (razon === 'permiso_medico' || tipo.includes('medico') || razonPermiso.includes('medico')) {
    return { tipo: 'medico', mins: gap };
  }
  if (razon === 'permiso_personal' || razon === 'cumpleanos' || tipo.includes('personal') || razonPermiso.includes('personal')) {
    return { tipo: 'personal', mins: gap };
  }
  return { tipo: 'justificar', mins: gap };
}

function limpiarCachesLocales() {
  localStorage.removeItem('tcontrol_registros_cache_v1');
  localStorage.removeItem('tcontrol_archivados_cache_v1');
  localStorage.removeItem('tcontrol_archivados_cache_v2');
  localStorage.removeItem('tcontrol_almuerzos_extra_cache_v1');
  localStorage.removeItem('tcontrol_almuerzos_extra_cache_v2');
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('tcontrol_archivados_cache_') || key.startsWith('tcontrol_almuerzos_extra_cache_'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mostrarToast(msg, tipo) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast-msg' + (tipo ? ' ' + tipo : '');
  el.innerHTML = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

let _loaderWatchdogTimer = null;
function mostrarLoader(show, msg = 'Cargando datos...', subtext = 'Sincronizando información en tiempo real') {
  const loader = document.getElementById('loader');
  const txt = document.getElementById('loaderText') || (loader ? loader.querySelector('.loader-text, .loading-text') : null);
  const sub = document.getElementById('loaderSubtext');
  if (_loaderWatchdogTimer) {
    clearTimeout(_loaderWatchdogTimer);
    _loaderWatchdogTimer = null;
  }
  if (loader) {
    if (show) {
      if (txt && msg) txt.textContent = msg;
      if (sub) {
        sub.textContent = subtext;
        sub.style.display = subtext ? 'block' : 'none';
      }
      loader.classList.remove('hidden');
      // Watchdog de seguridad: auto-cerrar si excede 12 segundos para nunca congelar al usuario
      _loaderWatchdogTimer = setTimeout(() => {
        if (loader && !loader.classList.contains('hidden')) {
          console.warn("⚠️ Loader ocultado automáticamente por temporizador de seguridad.");
          loader.classList.add('hidden');
        }
      }, 12000);
    } else {
      loader.classList.add('hidden');
    }
  }
}
window.mostrarLoader = mostrarLoader;

// ========== SPLASH SCREEN ==========
function hideSplash() {
  const splash = document.getElementById('initialSplash');
  if (splash) {
    splash.classList.add('fade-out');
    const appLayout = document.querySelector('.app-layout');
    if (appLayout) {
      appLayout.classList.remove('page-content-enter');
      void appLayout.offsetWidth;
      appLayout.classList.add('page-content-enter');
    }
    setTimeout(() => {
      if (splash && splash.parentNode) splash.remove();
    }, 650);
  }
}
window.hideSplash = hideSplash;

function formatearTimestampCompleto(ts) {
  if (!ts) return '';

  if (typeof ts === 'string') {
    const parsed = parsearTimestamp(ts);
    if (parsed) {
      return parsed.timestampFormatted.replace(/\//g, '-');
    }
  }

  let dateObj;
  if (typeof ts.toDate === 'function') dateObj = ts.toDate();
  else if (ts && typeof ts === 'object' && ts.seconds) dateObj = new Date(ts.seconds * 1000);
  else dateObj = new Date(ts);

  if (dateObj && !isNaN(dateObj.getTime())) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    const ss = String(dateObj.getSeconds()).padStart(2, '0');
    return `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
  }
  return String(ts);
}

function parsearTimestamp(tsString) {
  if (!tsString) return null;
  tsString = String(tsString).trim();
  const regexDMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
  const regexYMD = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;

  let year, month, day, hour, minute, second;
  let match = tsString.match(regexDMY);
  if (match) {
    day = match[1].padStart(2, '0');
    month = match[2].padStart(2, '0');
    year = match[3];
    hour = match[4].padStart(2, '0');
    minute = match[5].padStart(2, '0');
    second = (match[6] || '00').padStart(2, '0');
  } else {
    match = tsString.match(regexYMD);
    if (match) {
      year = match[1];
      month = match[2].padStart(2, '0');
      day = match[3].padStart(2, '0');
      hour = match[4].padStart(2, '0');
      minute = match[5].padStart(2, '0');
      second = (match[6] || '00').padStart(2, '0');
    } else {
      const d = new Date(tsString);
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
    fecha: `${year}-${month}-${day}`,
    hora: `${hour}:${minute}:${second}`,
    timestampFormatted: `${day}/${month}/${year} ${hour}:${minute}:${second}`
  };
}

function formatearFechaA_DMY(fecha) {
  if (!fecha) return '';
  if (typeof fecha.toDate === 'function') {
    const d = fecha.toDate();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  if (fecha instanceof Date) {
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  const str = String(fecha).trim();
  const matchDMY = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (matchDMY) {
    const dd = matchDMY[1].padStart(2, '0');
    const mm = matchDMY[2].padStart(2, '0');
    const yyyy = matchDMY[3];
    return `${dd}-${mm}-${yyyy}`;
  }
  const matchYMD = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (matchYMD) {
    const yyyy = matchYMD[1];
    const mm = matchYMD[2].padStart(2, '0');
    const dd = matchYMD[3].padStart(2, '0');
    return `${dd}-${mm}-${yyyy}`;
  }
  const d = new Date(str);
  if (d && !isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  return str;
}

function obtenerMinutos(valor) {
  if (!valor) return null;
  if (typeof valor === 'number') {
    if (valor > 0 && valor < 1) {
      let s = Math.round(valor * 86400);
      return Math.floor(s / 3600) * 60 + Math.floor((s % 3600) / 60);
    }
    if (valor > 1e12) {
      let d = new Date(valor);
      if (!isNaN(d)) return d.getHours() * 60 + d.getMinutes();
    }
    return null;
  }
  if (typeof valor === 'string') {
    let m = valor.match(/(\d{1,2}):(\d{2})/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    let d = new Date(valor);
    if (!isNaN(d)) return d.getHours() * 60 + d.getMinutes();
  }
  if (valor instanceof Date) return valor.getHours() * 60 + valor.getMinutes();
  return null;
}

function minsToHHMM(mins) {
  if (mins === null || mins === undefined) return '--:--';
  let h = Math.floor(Math.abs(Math.round(mins)) / 60);
  let m = Math.abs(Math.round(mins)) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function formatearHora(valor) {
  let m = obtenerMinutos(valor);
  return m !== null ? minsToHHMM(m) : '--:--';
}

function calcularPct(v, t) {
  return t ? Math.round((v / t) * 100) : 0;
}

function formatearMinutos(min) {
  if (!min) return '0m';
  let h = Math.floor(Math.abs(min) / 60);
  let m = Math.abs(min) % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

function formatearHorasDecimal(minutos) {
  if (!minutos) return '0.00';
  return (minutos / 60).toFixed(2);
}

function minutosAHHMMSS(minutos) {
  if (!minutos || minutos < 0) return '00:00:00';
  const horas = Math.floor(minutos / 60);
  const mins = Math.floor(minutos % 60);
  const segs = Math.floor((minutos % 1) * 60);
  return String(horas).padStart(2, '0') + ':' + String(mins).padStart(2, '0') + ':' + String(segs).padStart(2, '0');
}



function esFeriadoODomingo(fechaStr) {
  if (!fechaStr) return false;
  if (fechaStr === '2026-06-26') return true; // Feriado imprevisto 26/06/2026
  // Usar mediodía para evitar problemas de zona horaria
  let fecha = new Date(fechaStr + 'T12:00:00');
  let dia = fecha.getDay();
  // Domingo = 0
  if (dia === 0) return true;

  const m = fecha.getMonth() + 1;
  const d = fecha.getDate();
  const md = `${m}/${d}`;

  // Feriados nacionales y locales (Quito / Ecuador)
  const feriados = [
    '1/1',   // Año Nuevo
    '2/16',  // Carnaval 2026
    '2/17',  // Carnaval 2026
    '4/3',   // Viernes Santo 2026
    '4/30',  // Feriado decretado
    '5/1',   // Día del Trabajo
    '5/25',  // Batalla del Pichincha
    '8/10',  // Primer Grito de Independencia
    '10/9',  // Independencia de Guayaquil
    '11/2',  // Día de los Difuntos
    '11/3',  // Independencia de Cuenca
    '12/6',  // Fundación de Quito
    '12/25'  // Navidad
  ];
  return feriados.includes(md);
}

function esEmpleadoSoloAlmuerzo(e) {
  if (!e) return false;
  if (e.isSinAsistencia || e.isVisitante) return true;
  const cargo = String(e.cargo || '').toUpperCase().trim();
  const area = String(e.area || e.departamento || '').toUpperCase().trim();
  const tipo = String(e.tipo || e.tipoRegistro || '').toUpperCase().trim();

  if (cargo === 'SIN ASISTENCIA' || cargo.includes('SIN ASISTENCIA') || cargo.includes('SOLO ALMUERZO') || cargo.includes('COMENSAL')) return true;
  if (area.includes('SOLO ALMUERZO') || area.includes('COMENSAL')) return true;
  if (tipo.includes('SOLO ALMUERZO') || tipo.includes('COMENSAL')) return true;
  if (e.soloAlmuerzo === true || String(e.soloAlmuerzo).toUpperCase() === 'SI') return true;
  return false;
}
window.esEmpleadoSoloAlmuerzo = esEmpleadoSoloAlmuerzo;

function esEmpleadoExcluidoAsistencia(e) {
  if (!e) return true;
  if (esEmpleadoSoloAlmuerzo(e)) return true;
  const tipo = String(e.tipoRegistro || e.tipo || '').toUpperCase();
  if (tipo === 'MASTER' || tipo === 'VISITANTE') return true;
  return false;
}
window.esEmpleadoExcluidoAsistencia = esEmpleadoExcluidoAsistencia;

function esEnCampo(lat, lng) {
  if (!lat || !lng) return false;
  let distancia = calcularDistancia(LAT_EMPRESA, LNG_EMPRESA, parseFloat(lat), parseFloat(lng));
  return distancia > RADIO_METROS;
}

function fixFotoUrl(url, size = 200) {
  if (!url) return null;
  url = url.trim();
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url;

  // Si ya es googleusercontent, asegurar parámetro de tamaño para usar CDN de Google y evitar 429
  if (url.includes('googleusercontent.com/d/')) {
    if (!url.includes('=')) {
      return `${url}=w${size}`;
    }
    return url;
  }
  // Convertir URLs de Google Drive a formato CDN optimizado con thumbnail
  if (url.includes('drive.google.com/file/d/')) {
    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w${size}`;
  }
  if (url.includes('drive.google.com/open?id=') || url.includes('/uc?export=view&id=') || url.includes('/uc?id=') || url.includes('id=')) {
    const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w${size}`;
  }
  if (url.includes('/d/')) {
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w${size}`;
  }
  return url;
}

function obtenerBadgeEstadoEmpleado(e) {
  if (!e) return '';
  if (e.isVisitante) {
    return `<span class="status-indicator-badge status-visitante" title="Visitante / Extra"><i class="fas fa-id-badge"></i></span>`;
  }
  if (e.isSinAsistencia || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA') {
    return `<span class="status-indicator-badge status-comedor" title="Sin Asistencia / Solo Comedor"><i class="fas fa-utensils"></i></span>`;
  }

  // Si ya salió al final del día
  if (e._salidaHoy || e.salidaHoy) {
    return `<span class="status-indicator-badge status-salio" title="Ya Salió (Jornada Concluida)"><i class="fas fa-door-open"></i></span>`;
  }

  // Detectar razones de ausencia / permiso
  let razon = e.razon_ausencia || e.razon_permiso || e._razonAusenciaHoy || '';
  if (!razon && Array.isArray(e.registros)) {
    const hoy = typeof obtenerFechaHoyLocal === 'function' ? obtenerFechaHoyLocal() : new Date().toISOString().split('T')[0];
    const fReg = e.registros.find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    if (fReg) razon = fReg.razon_ausencia || fReg.razon_permiso || '';
  }

  const razonUpper = (razon || '').toUpperCase();

  // Vacaciones
  if (razonUpper.includes('VACACI') || (e.estado || '').toUpperCase() === 'VACACIONES') {
    return `<span class="status-indicator-badge status-vacaciones" title="De Vacaciones"><i class="fas fa-umbrella-beach"></i></span>`;
  }

  // Permiso Médico
  if (razonUpper.includes('MÉDICO') || razonUpper.includes('MEDICO') || razonUpper.includes('SALUD')) {
    return `<span class="status-indicator-badge status-medico" title="Permiso Médico"><i class="fas fa-file-medical"></i></span>`;
  }

  // Permiso Personal o Calamidad o Cumpleaños
  if (razonUpper.includes('PERSONAL') || razonUpper.includes('CALAMIDAD') || razonUpper.includes('CUMPLEAÑ') || razonUpper.includes('JUSTIFICAD') || razonUpper.includes('PERMISO')) {
    return `<span class="status-indicator-badge status-personal" title="Con Permiso / Justificado"><i class="fas fa-user-clock"></i></span>`;
  }

  // Modo Campo / Salida a Campo
  let modoStr = String(e._modo || e.modo || '').toUpperCase();
  if (modoStr.includes('CAMPO') || razonUpper.includes('CAMPO')) {
    return `<span class="status-indicator-badge status-campo" title="En Campo / Proyecto"><i class="fas fa-route"></i></span>`;
  }

  // En Empresa (Marcó entrada hoy y no ha salido)
  if (e._entradaHoy || e.entradaHoy) {
    return `<span class="status-indicator-badge status-empresa" title="En Empresa / Planta"><i class="fas fa-building"></i></span>`;
  }

  // Ausente (Sin registro de entrada ni justificación)
  return `<span class="status-indicator-badge status-ausente" title="Ausente (Sin Registro)"><i class="fas fa-user-slash"></i></span>`;
}

function photoCell(e, size) {
  let ini = (e.nombre?.charAt(0) || '?').toUpperCase();
  const src = fixFotoUrl(e.foto_url);
  if (size === 'large') {
    return src ? `<img class="detail-photo" src="${escapeHtml(src)}" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="detail-photo-placeholder" style="display:none">${ini}</div>` : `<div class="detail-photo-placeholder">${ini}</div>`;
  }
  if (size === 'card') {
    return src ? `<img class="employee-card-photo" src="${escapeHtml(src)}" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="employee-card-photo-placeholder" style="display:none">${ini}</div>` : `<div class="employee-card-photo-placeholder">${ini}</div>`;
  }

  const imgHtml = src ? `<img class="employee-photo" src="${escapeHtml(src)}" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="employee-photo-placeholder" style="display:none">${ini}</div>` : `<div class="employee-photo-placeholder">${ini}</div>`;
  const badgeHtml = obtenerBadgeEstadoEmpleado(e);
  return `<div class="avatar-status-wrapper">${imgHtml}${badgeHtml}</div>`;
}

function generarPeriodos() {
  let lista = [];
  let ahora = new Date();
  // El período en curso va del 26 del mes anterior al 25 del mes actual
  // Si la fecha actual ya es 26 o superior, entramos al período del mes siguiente
  let baseMonth = ahora.getMonth();
  if (ahora.getDate() >= 26) {
    baseMonth += 1;
  }

  function formatearFechaLocal(d) {
    let y = d.getFullYear();
    let m = String(d.getMonth() + 1).padStart(2, '0');
    let day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  for (let i = 0; i < 12; i++) {
    let iniDate = new Date(ahora.getFullYear(), baseMonth - i - 1, 26);
    let finDate = new Date(ahora.getFullYear(), baseMonth - i, 25);
    let label = iniDate.getDate() + ' ' + iniDate.toLocaleDateString('es', { month: 'short' }) + ' — ' + finDate.getDate() + ' ' + finDate.toLocaleDateString('es', { month: 'short', year: 'numeric' });
    lista.push({
      inicio: formatearFechaLocal(iniDate),
      fin: formatearFechaLocal(finDate),
      label: i === 0 ? '⭐ ' + label + ' (Actual)' : label
    });
  }
  return lista;
}

// Días de la semana en español
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function obtenerDiaSemanaStr(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return DIAS_SEMANA[d.getDay()];
}

// Normaliza cualquier formato de fecha a YYYY-MM-DD
function normalizarFechaStr(val) {
  if (!val || val === 'undefined') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(val).trim();
  // Ya está en formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // YYYY/MM/DD
  const mYMD = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (mYMD) {
    return `${mYMD[1]}-${mYMD[2].padStart(2, '0')}-${mYMD[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY o DD-MM-YYYY (evita que el motor JS parsee en formato US MM/DD/YYYY)
  const m1 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m1) {
    return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  }
  // Intentar parsear como Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return s;
}
window.normalizarFechaStr = normalizarFechaStr;

// ============================================================
// HELPERS DE CONSOLIDACIÓN DE INVITADOS Y ALMUERZOS EXTRA
// ============================================================
function desglosarObservacionesInvitado(rawObs) {
  let obs = String(rawObs || '').trim();
  let horaReq = '';
  let area = '';
  let sol = '';

  const matchHora = obs.match(/\[Hora\s*req:\s*([^\]]+)\]/i);
  if (matchHora) {
    horaReq = matchHora[1].trim();
    obs = obs.replace(matchHora[0], '').trim();
  }

  const matchArea = obs.match(/\[Área:\s*([^\]]+)\]/i) || obs.match(/\[Area:\s*([^\]]+)\]/i);
  if (matchArea) {
    area = matchArea[1].trim();
    obs = obs.replace(matchArea[0], '').trim();
  }

  const matchSol = obs.match(/\(Sol:\s*([^\)]+)\)/i);
  if (matchSol) {
    sol = matchSol[1].trim();
    obs = obs.replace(matchSol[0], '').trim();
  }

  obs = obs.replace(/\s{2,}/g, ' ').trim();
  return { obsLimpia: obs, horaReq, area, sol };
}
window.desglosarObservacionesInvitado = desglosarObservacionesInvitado;

function esAlmuerzoExtraItem(ae) {
  if (!ae) return false;
  if (ae.estado === 'CANCELADO') return false;
  const t = String(ae.subtipo || ae.tipoSolicitud || ae.tipo || '').toUpperCase();
  return !t.includes('REFRIGERIO') && !t.includes('SANDUCHE') && !t.includes('GALLETA');
}
window.esAlmuerzoExtraItem = esAlmuerzoExtraItem;

window.obtenerListaConsolidadaInvitados = function () {
  const lista = [];
  const usedSheetRowKeys = new Set();

  // 1. Prioridad: Documentos en Firestore (solicitudesInvitados)
  (window.solicitudesInvitados || []).forEach(s => {
    if (s.estado === 'CANCELADO') return;
    const id = s.id || `inv_${s.fecha}_${s.hora}_${s.empleadoId}`;
    const fNorm = normalizarFechaStr(s.fecha) || s.fecha;

    let invitadoLimpio = (s.invitado || '').trim() || 'Invitado';
    let solicitanteDetectado = s.empleadoNombre || 'Colaborador';
    const matchInvS = invitadoLimpio.match(/^(.*?)\s*\(Inv\.\s*de\s*(.*?)\)$/i);
    if (matchInvS) {
      invitadoLimpio = matchInvS[1].trim();
      if (!s.empleadoNombre || s.empleadoNombre === 'Colaborador') solicitanteDetectado = matchInvS[2].trim();
    }

    const desg = desglosarObservacionesInvitado(s.observaciones || s.observacionesCompletas || '');
    const invNorm = invitadoLimpio.toLowerCase();

    let matchFilaIndex = null;
    const aeList = window.almuerzosExtra || [];
    for (let idx = 0; idx < aeList.length; idx++) {
      const ae = aeList[idx];
      const sheetRowKey = ae.filaIndex || (idx + 1);
      if (usedSheetRowKeys.has(sheetRowKey)) continue;

      const aeFecha = normalizarFechaStr(ae.fecha);
      if (aeFecha !== fNorm) continue;

      let aeInvLimpio = (ae.nombre || '').trim();
      const mInv = aeInvLimpio.match(/^(.*?)\s*\(Inv\.\s*de\s*(.*?)\)$/i);
      if (mInv) aeInvLimpio = mInv[1].trim();
      const aeInvNorm = aeInvLimpio.toLowerCase();

      if (invNorm && aeInvNorm && (invNorm === aeInvNorm || (invNorm.length >= 3 && aeInvNorm.length >= 3 && (invNorm.includes(aeInvNorm) || aeInvNorm.includes(invNorm))))) {
        matchFilaIndex = sheetRowKey;
        usedSheetRowKeys.add(sheetRowKey);
        break;
      }
    }

    lista.push({
      id: id,
      fecha: fNorm,
      hora: s.hora || '',
      solicitante: solicitanteDetectado || desg.sol || 'Colaborador',
      empleadoId: s.empleadoId || '',
      area: s.empleadoArea || desg.area || '',
      tipoSolicitud: s.tipoSolicitud || 'ALMUERZO_EXTRA',
      subtipo: s.subtipo || s.tipoSolicitud || 'ALMUERZO_EXTRA',
      cantidad: parseInt(s.cantidad) || 1,
      invitado: invitadoLimpio,
      empresa: s.empresa || 'TCONTROL',
      horaServicio: s.horaServicio || desg.horaReq || '',
      observaciones: desg.obsLimpia || '',
      estado: s.estado || 'SOLICITADO',
      origen: 'FIRESTORE',
      filaIndex: matchFilaIndex
    });
  });

  // 2. Registros de Google Sheets (almuerzosExtra) que no fueron emparejados con un documento de Firestore
  (window.almuerzosExtra || []).forEach((ae, idx) => {
    const sheetRowKey = ae.filaIndex || (idx + 1);
    if (usedSheetRowKeys.has(sheetRowKey)) return;

    const fNorm = normalizarFechaStr(ae.fecha);
    const tUpper = String(ae.tipo || '').toUpperCase();
    let subtipo = 'ALMUERZO_EXTRA';
    if (tUpper.includes('SANDUCHE')) subtipo = 'REFRIGERIO_SANDUCHE';
    else if (tUpper.includes('GALLETA')) subtipo = 'REFRIGERIO_GALLETAS';
    else if (tUpper.includes('REFRIGERIO')) subtipo = 'REFRIGERIO_SANDUCHE';

    let invitadoLimpio = (ae.nombre || '').trim() || 'Almuerzo Extra';
    let solicitanteDetectado = '';
    const matchInv = invitadoLimpio.match(/^(.*?)\s*\(Inv\.\s*de\s*(.*?)\)$/i);
    if (matchInv) {
      invitadoLimpio = matchInv[1].trim();
      solicitanteDetectado = matchInv[2].trim();
    }

    const desg = desglosarObservacionesInvitado(ae.observaciones || '');

    lista.push({
      id: `sheet_extra_${fNorm}_${sheetRowKey}`,
      fecha: fNorm,
      hora: ae.horaRegistro || '--:--',
      solicitante: solicitanteDetectado || desg.sol || (ae.supervisorId ? (empCache.find(e => String(e.id) === String(ae.supervisorId))?.nombre || `ID: ${ae.supervisorId}`) : 'Supervisor'),
      empleadoId: ae.supervisorId || '',
      area: ae.supervisorId ? (empCache.find(e => String(e.id) === String(ae.supervisorId))?.area || '') : desg.area,
      tipoSolicitud: subtipo.includes('REFRIGERIO') ? 'REFRIGERIO' : 'ALMUERZO_EXTRA',
      subtipo: subtipo,
      cantidad: parseInt(ae.cantidad) || 1,
      invitado: invitadoLimpio,
      empresa: ae.empresa || 'TCONTROL',
      horaServicio: desg.horaReq || '',
      observaciones: desg.obsLimpia || '',
      estado: 'CONFIRMADO',
      origen: 'SHEETS',
      filaIndex: sheetRowKey
    });
  });

  lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.hora || '').localeCompare(a.hora || ''));
  return lista;
};

window.obtenerAlmuerzosExtraConsolidados = function (fechaInicio = null, fechaFin = null) {
  const lista = (typeof window.obtenerListaConsolidadaInvitados === 'function')
    ? window.obtenerListaConsolidadaInvitados()
    : [
        ...(window.solicitudesInvitados || []),
        ...(window.almuerzosExtra || [])
      ];

  const fIniNorm = fechaInicio ? normalizarFechaStr(fechaInicio) : null;
  const fFinNorm = fechaFin ? normalizarFechaStr(fechaFin) : null;

  return (lista || []).filter(item => {
    if (item.estado === 'CANCELADO') return false;
    if (!esAlmuerzoExtraItem(item)) return false;

    const fNorm = normalizarFechaStr(item.fecha);
    if (!fNorm) return false;
    if (fIniNorm && fNorm < fIniNorm) return false;
    if (fFinNorm && fNorm > fFinNorm) return false;
    return true;
  });
};

function obtenerDiasHabiles(inicio, fin) {
  let dias = [];
  let fecha = new Date(inicio + 'T12:00:00');
  let fFin = new Date(fin + 'T12:00:00');
  while (fecha <= fFin) {
    let fStr = fecha.toISOString().split('T')[0];
    let dia = fecha.getDay();
    // Lunes a Viernes (1-5) que no sean feriados
    if (dia >= 1 && dia <= 5 && !esFeriadoODomingo(fStr)) {
      dias.push(fStr);
    }
    fecha.setDate(fecha.getDate() + 1);
  }
  return dias;
}

// ============================================================
// JSONP REQUEST (INTERCEPTOR FIREBASE)
// ============================================================
function jsonpRequest(params) {
  if (window.USE_FIREBASE && window.FirebaseBackend) {
    return window.FirebaseBackend.procesarAccion(params);
  }
  return new Promise((resolve, reject) => {
    const cbName = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    let settled = false;
    const script = document.createElement('script');

    const cleanup = () => {
      window[cbName] = function () { };
      setTimeout(() => { delete window[cbName]; }, 60000);
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timeout'));
    }, 20000);

    window[cbName] = function (data) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve(data);
    };

    const url = new URL(API_URL);
    url.searchParams.set('callback', cbName);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');

    // Inyectar credenciales de supervisor si existen
    const session = localStorage.getItem('SUPERVISOR_SESSION');
    if (session) {
      const data = JSON.parse(session);
      url.searchParams.set('empleadoId', data.id);
      url.searchParams.set('deviceToken', data.token);
    }

    params.apiKey = 'TCONTROL_SECURE_2026_XYZ';
    Object.entries(params).forEach(([k, v]) => {
      if (k === 'empleadoId' || k === 'deviceToken') return; // Evitar duplicar
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    script.src = url.toString();
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Error de red'));
    };
    document.body.appendChild(script);
  });
}

// ============================================================
// ACTUALIZAR ALMUERZO
// ============================================================
async function actualizarAlmuerzo(empleadoId, nuevoValor, fecha) {
  mostrarLoader(true);
  try {
    const res = await jsonpRequest({ accion: 'actualizarAlmuerzoSupervisor', empleadoId: empleadoId, almuerzo: nuevoValor, fecha: fecha || hoy });
    mostrarLoader(false);
    if (res?.error) {
      mostrarToast(res.error, 'error');
      return false;
    }
    mostrarToast('Almuerzo actualizado', 'success');
    return true;
  } catch (e) {
    mostrarLoader(false);
    mostrarToast('Error al actualizar almuerzo', 'error');
    return false;
  }
}

async function cambiarEstadoAlmuerzo(id, estado, fecha) {
  let idx = empCache.findIndex(e => e.id === id);
  let estadoAnterior = null;
  let regAnterior = null;
  let targetFecha = fecha || hoy;

  if (idx !== -1) {
    if (!fecha || fecha === hoy) {
      estadoAnterior = empCache[idx].almuerzoHoy;
      empCache[idx].almuerzoHoy = estado;
    }
    let reg = empCache[idx].registros?.find(r => r.tipo === 'ENTRADA' && r.fecha === targetFecha);
    if (reg) {
      regAnterior = reg.almuerzo;
      reg.almuerzo = estado;
    }
  }

  // Redibujar la UI inmediatamente
  if (panelActual === 'detalle') mostrarDetalle(id);
  else {
    cargarAsistencia();
    cargarDashboard();
  }
  if (typeof cargarDirectorio === 'function') cargarDirectorio();
  if (typeof filtrarTablaReportes === 'function') filtrarTablaReportes();
  if (typeof filtrarReporteInteractivo === 'function') filtrarReporteInteractivo();

  // Enviar la petición en segundo plano
  try {
    const res = await jsonpRequest({
      accion: 'actualizarAlmuerzoSupervisor',
      empleadoId: id,
      almuerzo: estado,
      fecha: targetFecha
    });
    if (res && !res.error) {
      mostrarToast('Almuerzo actualizado', 'success');
      // Limpiar caches de la app
      limpiarCachesLocales();
      // Silenciosamente recargar en background
      await cargarDatosCompletos(true, true);
    } else {
      mostrarToast(res?.error || 'Error al actualizar almuerzo', 'error');
      // Revertir
      if (idx !== -1) {
        if (!fecha || fecha === hoy) empCache[idx].almuerzoHoy = estadoAnterior;
        let reg = empCache[idx].registros?.find(r => r.tipo === 'ENTRADA' && r.fecha === targetFecha);
        if (reg) reg.almuerzo = regAnterior;
      }
      if (panelActual === 'detalle') mostrarDetalle(id);
      else {
        cargarAsistencia();
        cargarDashboard();
      }
      if (typeof cargarDirectorio === 'function') cargarDirectorio();
    }
  } catch (e) {
    mostrarToast('Error al actualizar almuerzo (sin conexión)', 'error');
    // Revertir
    if (idx !== -1) {
      if (!fecha || fecha === hoy) empCache[idx].almuerzoHoy = estadoAnterior;
      let reg = empCache[idx].registros?.find(r => r.tipo === 'ENTRADA' && r.fecha === targetFecha);
      if (reg) reg.almuerzo = regAnterior;
    }
    if (panelActual === 'detalle') mostrarDetalle(id);
    else {
      cargarAsistencia();
      cargarDashboard();
    }
    if (typeof cargarDirectorio === 'function') cargarDirectorio();
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function cargarDashboard() {
  let hoy = getLocalHoyStr();
  let circ = 2 * Math.PI * 54;
  let dc = document.getElementById('donutCircle');
  if (dc) { dc.style.strokeDasharray = circ; dc.style.strokeDashoffset = circ; }

  const esFestivoHoy = esFeriadoODomingo(hoy) || (new Date(hoy + 'T12:00:00').getDay() === 6);
  const refEntradaHoy = esFestivoHoy ? 420 : HORA_ENTRADA_REF;

  let hoyP = 0, hoyA = 0, hoyT = 0, hoySalieron = 0;
  empCache.forEach(e => {
    let entr = (e.registros || []).find(r => r.fecha === hoy && r.tipo === 'ENTRADA');
    let sal = (e.registros || []).find(r => r.fecha === hoy && r.tipo === 'SALIDA');
    if (entr) {
      hoyP++;
      let m = obtenerMinutos(entr.hora);
      if (m !== null && m > refEntradaHoy + 5) hoyT++;
      if (sal) hoySalieron++;
    } else {
      hoyA++;
    }
  });
  let pctH = calcularPct(hoyP, empCache.length);
  if (dc) dc.style.strokeDashoffset = circ * (1 - pctH / 100);
  if ($('donutPorcentaje')) $('donutPorcentaje').textContent = pctH + '%';
  if ($('legendPresentes')) $('legendPresentes').textContent = hoyP;
  if ($('legendTardanzas')) $('legendTardanzas').textContent = hoyT;
  if ($('legendAusentes')) $('legendAusentes').textContent = hoyA;
  if ($('legendSalieron')) $('legendSalieron').textContent = hoySalieron;

  const hoy_ = getLocalHoyStr();
  let periodo = periodos[0];
  if (periodo && empCache.length) {
    // Solo días hábiles transcurridos (no futuros) para cálculos correctos
    let diasHabTodos = obtenerDiasHabiles(periodo.inicio, periodo.fin);
    let diasHab = diasHabTodos.filter(d => d <= hoy_);
    let totalPos = empCache.length * diasHab.length || 1;
    let asist = 0, tard = 0, almP = 0;
    empCache.forEach(e => {
      let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);
      let dias = new Set(entradas.map(r => r.fecha)).size;
      asist += dias;
      entradas.forEach(r => {
        let m = obtenerMinutos(r.hora);
        const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
        const refEntradaR = esFestivoR ? 420 : HORA_ENTRADA_REF;
        if (m !== null && m > refEntradaR + 5) tard++;
      });

      const resAlm = calcularAlmuerzosPeriodo(e, periodo.inicio, hoy_);
      almP += resAlm.almPlanta;
    });
    let aPct = calcularPct(asist, totalPos);
    let pPct = asist ? Math.round((1 - tard / asist) * 100) : 0;
    let almPct = asist ? calcularPct(almP, asist) : 0;
    if ($('dashAsistencia')) $('dashAsistencia').textContent = aPct + '%';
    if ($('dashPuntualidad')) $('dashPuntualidad').textContent = pPct + '%';
    if ($('dashAlmPlanta')) $('dashAlmPlanta').textContent = almPct + '%';
    if ($('dashTotalEmpleados')) $('dashTotalEmpleados').textContent = empCache.length;
    if ($('tasaAlmuerzoPlanta')) $('tasaAlmuerzoPlanta').textContent = almPct + '%';

    // ==========================================
    // CÁLCULO DE KPIS ANALÍTICOS (DASHBOARD)
    // ==========================================
    const empAsistencia = empCache.filter(e => {
      const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
      const soloAlm = (typeof esEmpleadoSoloAlmuerzo === 'function') ? esEmpleadoSoloAlmuerzo(e) : false;
      const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
      return act && !soloAlm && !excluido && e.tipoRegistro !== 'MASTER';
    });

    let asistEfectivas = 0;
    let vacEfectivas = 0;
    let diasExtras = 0;
    let totalEsperadas = 0;

    empAsistencia.forEach(e => {
      let primerRegFecha = '';
      (e.registros || []).forEach(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        if (!f || f > hoy_) return;
        const t = (r.tipo || '').toUpperCase();
        const just = (r.justificado || '').toUpperCase();
        const razon = (r.razon_ausencia || r.razon_justificac || '').toUpperCase();
        // Solo registros de asistencia reales de la base (nunca vacaciones históricas de RRHH)
        const esVal = (t === 'ENTRADA' || t === 'CAMPO' || t === 'ENTRADA_CAMPO' || t === 'RETORNO_CAMPO' || t === 'SALIDA' || (just === 'SI' && t !== 'VACACIONES' && t !== 'VACACION' && !razon.includes('VACACI')));
        if (esVal) {
          if (!primerRegFecha || f < primerRegFecha) primerRegFecha = f;
        }
      });

      let evalIniEmp = periodo.inicio;
      if (primerRegFecha && primerRegFecha > periodo.inicio) {
        evalIniEmp = primerRegFecha;
      }
      let evalFinEmp = (periodo.fin < hoy_) ? periodo.fin : hoy_;

      let diasHabEmp = (evalIniEmp <= evalFinEmp) ? obtenerDiasHabiles(evalIniEmp, evalFinEmp) : [];
      totalEsperadas += diasHabEmp.length;

      let regsEnMes = (e.registros || []).filter(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        return f && f >= evalIniEmp && f <= evalFinEmp;
      });
      let diasEfectivos = new Set();
      let diasVac = new Set();
      let diasExt = new Set();

      regsEnMes.forEach(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        const t = (r.tipo || '').toUpperCase();
        const just = (r.justificado || '').toUpperCase();
        const razon = (r.razon_ausencia || r.razon_justificac || '').toUpperCase();
        const esHab = diasHabEmp.includes(f);
        if (t === 'VACACIONES' || t === 'VACACION' || razon.includes('VACACI')) {
          if (esHab) diasVac.add(f);
        } else if (t === 'ENTRADA' || t === 'CAMPO' || t === 'ENTRADA_CAMPO' || just === 'SI') {
          if (esHab) diasEfectivos.add(f);
          else diasExt.add(f);
        }
      });
      asistEfectivas += diasEfectivos.size;
      vacEfectivas += diasVac.size;
      diasExtras += diasExt.size;
    });

    if (totalEsperadas <= 0) totalEsperadas = 1;

    let kpiAsistenciaPct = totalEsperadas > 0 ? (((asistEfectivas + vacEfectivas) / totalEsperadas) * 100).toFixed(1) : '100.0';
    if (parseFloat(kpiAsistenciaPct) > 100) kpiAsistenciaPct = '100.0';

    if ($('kpiAsistenciaVal')) $('kpiAsistenciaVal').textContent = kpiAsistenciaPct + '%';
    if ($('kpiAsistenciaDetalle1')) $('kpiAsistenciaDetalle1').textContent = `${asistEfectivas}`;
    if ($('kpiAsistenciaDetalle2')) $('kpiAsistenciaDetalle2').textContent = `${totalEsperadas}`;
    if ($('kpiAsistenciaDetalleVacaciones')) $('kpiAsistenciaDetalleVacaciones').textContent = `${vacEfectivas}`;
    if ($('kpiAsistenciaDetalleExtras')) $('kpiAsistenciaDetalleExtras').textContent = `${diasExtras}`;
    if ($('kpiAsistenciaDetalleColabs')) $('kpiAsistenciaDetalleColabs').textContent = `${empAsistencia.length}`;

    let difTotal = totalEsperadas - (asistEfectivas + vacEfectivas);
    if ($('lblBtnDiferenciaTotal')) $('lblBtnDiferenciaTotal').textContent = difTotal > 0 ? difTotal : 0;

    const kpiAsistStatus = $('kpiAsistenciaStatus');
    const kpiAsistBorder = $('kpiAsistenciaBorder');
    if (kpiAsistStatus && kpiAsistBorder) {
      const pctVal = parseFloat(kpiAsistenciaPct);
      if (pctVal >= 95) {
        kpiAsistStatus.textContent = 'Excelente';
        kpiAsistStatus.style.color = 'var(--green)';
        kpiAsistStatus.style.background = 'rgba(16, 185, 129, 0.1)';
        kpiAsistBorder.style.background = 'var(--green)';
      } else if (pctVal >= 85) {
        kpiAsistStatus.textContent = 'Aceptable';
        kpiAsistStatus.style.color = 'var(--amber)';
        kpiAsistStatus.style.background = 'rgba(245, 158, 11, 0.1)';
        kpiAsistBorder.style.background = 'var(--amber)';
      } else {
        kpiAsistStatus.textContent = 'Crítico';
        kpiAsistStatus.style.color = 'var(--red)';
        kpiAsistStatus.style.background = 'rgba(239, 68, 68, 0.1)';
        kpiAsistBorder.style.background = 'var(--red)';
      }
    }

    // Vacaciones KPI Card - Cumplimiento de Goce Anual (Tomadas / Adjudicadas)
    const renderizarCardKpiVacaciones = () => {
      const kpiVac = window.kpiVacaciones || window._kpiVacacionesCache;
      const kpiVacIndiv = window.kpiVacacionesIndividual || {};

      let sumaAdjIndiv = 0;
      let sumaTomIndiv = 0;
      let sumaResIndiv = 0;
      let countIndiv = 0;

      for (const [k, v] of Object.entries(kpiVacIndiv)) {
        const kLower = String(k).toLowerCase().trim();
        if (!k || kLower.includes('sumatoria') || kLower.includes('total') || kLower.includes('promedio') || kLower.includes('resumen')) continue;
        sumaAdjIndiv += parseFloat(v.adjudicadas) || 0;
        sumaTomIndiv += parseFloat(v.tomadas) || 0;
        sumaResIndiv += parseFloat(v.restantes) || 0;
        countIndiv++;
      }

      let adjudicadas = 0;
      let tomadas = 0;
      let restantes = 0;

      if (countIndiv > 0) {
        adjudicadas = sumaAdjIndiv;
        tomadas = sumaTomIndiv;
        restantes = sumaResIndiv;
      } else if (kpiVac) {
        adjudicadas = parseFloat(kpiVac.adjudicadas) || 0;
        tomadas = parseFloat(kpiVac.tomadas) || 0;
        restantes = parseFloat(kpiVac.restantes) || 0;
      }

      window.kpiVacaciones = { adjudicadas, tomadas, restantes };
      window._kpiVacacionesCache = window.kpiVacaciones;

      // Tasa Global Acumulada de la Empresa (Tomadas / Adjudicadas)
      let kpiVacPct = adjudicadas > 0 ? ((tomadas / adjudicadas) * 100).toFixed(1) : '100.0';
      if (parseFloat(kpiVacPct) > 100) kpiVacPct = '100.0';

      // Promedio del KPI de Goce individual de los colaboradores evaluados
      let sumaKpiVacIndiv = 0;
      let colabsConVac = 0;

      empAsistencia.forEach(e => {
        const empKey = String(e.id).trim();
        const vInfo = kpiVacIndiv[empKey] || (e.cedula && kpiVacIndiv[String(e.cedula).trim()]) || kpiVacIndiv[e.id];
        if (vInfo && (parseFloat(vInfo.adjudicadas) > 0 || parseFloat(vInfo.tomadas) > 0)) {
          const a = parseFloat(vInfo.adjudicadas) || 0;
          const t = parseFloat(vInfo.tomadas) || 0;
          const p = a > 0 ? ((t / a) * 100) : 100;
          sumaKpiVacIndiv += Math.min(100, p);
          colabsConVac++;
        }
      });
      const promedioVacIndivPct = colabsConVac > 0 ? (sumaKpiVacIndiv / colabsConVac).toFixed(1) : kpiVacPct;

      const formatDias = (n) => (n % 1 === 0 ? n : n.toFixed(1));

      if ($('kpiVacacionesVal')) $('kpiVacacionesVal').textContent = kpiVacPct + '%';
      if ($('kpiVacacionesDetalleTomadas')) $('kpiVacacionesDetalleTomadas').textContent = `${formatDias(tomadas)} d`;
      if ($('kpiVacacionesDetalle1')) $('kpiVacacionesDetalle1').textContent = `${formatDias(restantes)} d`;
      if ($('kpiVacacionesDetalle2')) $('kpiVacacionesDetalle2').textContent = `${formatDias(adjudicadas)} d`;
      if ($('kpiVacacionesDetallePromedio')) $('kpiVacacionesDetallePromedio').textContent = `${promedioVacIndivPct}%`;

      const kpiVacStatus = $('kpiVacacionesStatus');
      const kpiVacBorder = $('kpiVacacionesBorder');
      if (kpiVacStatus && kpiVacBorder) {
        const pct = parseFloat(kpiVacPct);
        if (pct >= 85) {
          kpiVacStatus.innerHTML = '<i class="fas fa-check-circle"></i> Meta Cumplida';
          kpiVacStatus.style.color = 'var(--green)';
          kpiVacStatus.style.background = 'rgba(16, 185, 129, 0.1)';
          kpiVacBorder.style.background = 'var(--green)';
        } else if (pct >= 50) {
          kpiVacStatus.innerHTML = '<i class="fas fa-hourglass-half"></i> En Progreso';
          kpiVacStatus.style.color = 'var(--amber)';
          kpiVacStatus.style.background = 'rgba(245, 158, 11, 0.1)';
          kpiVacBorder.style.background = 'var(--amber)';
        } else {
          kpiVacStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Bajo Goce';
          kpiVacStatus.style.color = '#0284c7';
          kpiVacStatus.style.background = 'rgba(2, 132, 199, 0.1)';
          kpiVacBorder.style.background = '#0284c7';
        }
      }
    };

    if (window.kpiVacaciones || window._kpiVacacionesCache || (window.kpiVacacionesIndividual && Object.keys(window.kpiVacacionesIndividual).length > 0)) {
      renderizarCardKpiVacaciones();
    } else {
      jsonpRequest({ accion: 'obtenerVacacionesEmpleado' }).then(vacRes => {
        if (vacRes && vacRes.ok) {
          const rawIndiv = vacRes.kpiVacacionesIndividual || {};
          const limpio = {};
          let sumA = 0, sumT = 0, sumR = 0;
          for (const [k, v] of Object.entries(rawIndiv)) {
            const kl = String(k).toLowerCase().trim();
            if (!k || kl.includes('sumatoria') || kl.includes('total') || kl.includes('promedio') || kl.includes('resumen')) continue;
            const a = parseFloat(v.adjudicadas) || 0;
            const t = parseFloat(v.tomadas) || 0;
            const r = parseFloat(v.restantes) || 0;
            limpio[k] = { adjudicadas: a, tomadas: t, restantes: r };
            sumA += a;
            sumT += t;
            sumR += r;
          }
          window.kpiVacacionesIndividual = limpio;
          const globalVac = vacRes.kpiVacaciones || {};
          window.kpiVacaciones = {
            adjudicadas: sumA > 0 ? sumA : (parseFloat(globalVac.adjudicadas) || 0),
            tomadas: sumT > 0 ? sumT : (parseFloat(globalVac.tomadas) || 0),
            restantes: sumR !== 0 ? sumR : (parseFloat(globalVac.restantes) || 0)
          };
          window._kpiVacacionesCache = window.kpiVacaciones;
          renderizarCardKpiVacaciones();
          if (typeof window.renderDetailedKPIs === 'function') {
            window.renderDetailedKPIs();
          }
        }
      }).catch(e => console.warn('Precarga vacaciones:', e));
    }

    let puntMap = {}, tardMap = {}, sinSalidaMap = {}, puntMapBackup = {};
    empCache.forEach(e => {
      let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);
      let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);

      let entradasPorDia = {};
      entradas.forEach(r => {
        if (!entradasPorDia[r.fecha]) entradasPorDia[r.fecha] = [];
        entradasPorDia[r.fecha].push(r);
      });

      let tardE = 0, nE = 0, faltasS = 0, minutosTardE = 0;
      let detallesTardanzas = [];
      let detallesFaltasSalida = [];

      Object.keys(entradasPorDia).forEach(fecha => {
        let regs = entradasPorDia[fecha];
        regs.sort((a, b) => obtenerMinutos(a.hora) - obtenerMinutos(b.hora));
        let firstE = regs[0];

        let m = obtenerMinutos(firstE.hora);
        if (m !== null) {
          nE++;
          if (m > HORA_ENTRADA_REF + 5) {
            tardE++;
            let diffMin = m - HORA_ENTRADA_REF;
            minutosTardE += diffMin;
            let fechaLegible = `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
            detallesTardanzas.push(`${fechaLegible} (${firstE.hora.slice(0, 5)})`);
          }
        }

        if (fecha !== hoy_) {
          let tieneSalida = salidas.some(s => s.fecha === fecha);
          if (!tieneSalida) {
            faltasS++;
            let fechaLegible = `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
            detallesFaltasSalida.push(fechaLegible);
          }
        }
      });

      if (nE >= 3) {
        puntMap[e.id] = { nombre: e.nombre, area: e.area, p: Math.round((1 - tardE / nE) * 100), id: e.id, asist: nE, tardanzas: tardE, minutosTard: minutosTardE, fechas: detallesTardanzas };
      } else if (nE > 0) {
        puntMapBackup[e.id] = { nombre: e.nombre, area: e.area, p: Math.round((1 - tardE / nE) * 100), id: e.id, asist: nE, tardanzas: tardE, minutosTard: minutosTardE, fechas: detallesTardanzas };
      }
      if (tardE > 0) tardMap[e.id] = { nombre: e.nombre, area: e.area, tardanzas: tardE, id: e.id, asist: nE, minutosTard: minutosTardE, fechas: detallesTardanzas };
      if (faltasS > 0) sinSalidaMap[e.id] = { nombre: e.nombre, area: e.area, faltasSalida: faltasS, id: e.id, totalEntradas: nE, fechas: detallesFaltasSalida };
    });

    let sourcePunt = Object.keys(puntMap).length > 0 ? puntMap : puntMapBackup;
    let topP = Object.values(sourcePunt).sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.minutosTard !== a.minutosTard) return a.minutosTard - b.minutosTard; // Tie-breaker 1: menos minutos de atraso primero
      return b.asist - a.asist; // Tie-breaker 2: más días de asistencia
    }).slice(0, 10);
    if ($('topPuntuales')) $('topPuntuales').innerHTML = topP.length ? topP.map((e, i) => {
      let datesTooltip = e.fechas && e.fechas.length ? `title="Tardanzas: ${e.fechas.join(', ')} (Total: ${e.minutosTard} min)"` : `title="100% Puntual"`;
      return `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')" ${datesTooltip} style="cursor:pointer;"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--g400);font-weight:600;margin-bottom:-2px">${e.asist - e.tardanzas} de ${e.asist} punt.</span><span>${e.p}%</span></div></div>`;
    }).join('') : '<div class="empty-state">Sin datos</div>';

    let topTard = Object.values(tardMap).sort((a, b) => {
      if (b.tardanzas !== a.tardanzas) return b.tardanzas - a.tardanzas;
      return b.minutosTard - a.minutosTard; // Tie-breaker: más minutos de retraso acumulados primero
    }).slice(0, 10);
    if ($('topTardanzasRanking')) $('topTardanzasRanking').innerHTML = topTard.length ? topTard.map((e, i) => {
      let datesTooltip = e.fechas && e.fechas.length ? `title="Tardanzas: ${e.fechas.join(', ')}"` : '';
      return `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')" ${datesTooltip} style="cursor:pointer;"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--g400);font-weight:600;margin-bottom:-2px">${e.tardanzas} de ${e.asist} asis.</span><span style="color:var(--red); font-weight:bold;">${e.tardanzas} tard. (${e.minutosTard}m)</span></div></div>`;
    }).join('') : '<div class="empty-state">Sin tardanzas</div>';

    let sinSList = Object.values(sinSalidaMap).sort((a, b) => {
      if (b.faltasSalida !== a.faltasSalida) return b.faltasSalida - a.faltasSalida;
      return b.totalEntradas - a.totalEntradas; // Tie-breaker: más entradas
    }).slice(0, 10);
    if ($('sinSalidaRanking')) {
      $('sinSalidaRanking').innerHTML = sinSList.length ? sinSList.map((e, i) => {
        let datesTooltip = e.fechas && e.fechas.length ? `title="Fechas sin salida: ${e.fechas.join(', ')}"` : '';
        return `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')" ${datesTooltip} style="cursor:pointer;"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="color:var(--purple);font-weight:700;display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--purple-lt);font-weight:600;margin-bottom:-2px">${e.faltasSalida} de ${e.totalEntradas || '?'} entr.</span><span>${e.faltasSalida} sin salida</span></div></div>`;
      }).join('') : '<div class="empty-state">Todos han registrado su salida</div>';
    }

    // Calcular e imprimir Faltas y Ausencias del Período
    let listadoFaltas = [];
    empCache.forEach(e => {
      let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);
      let fechasAsistidas = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f));

      let fechasFaltas = [];
      diasHab.forEach(fecha => {
        if (!fechasAsistidas.has(fecha)) {
          fechasFaltas.push(fecha);
        }
      });

      if (fechasFaltas.length > 0) {
        listadoFaltas.push({
          id: e.id,
          nombre: e.nombre,
          area: e.area,
          fechas: fechasFaltas.sort((a, b) => b.localeCompare(a))
        });
      }
    });

    let htmlFaltas = listadoFaltas.sort((a, b) => b.fechas.length - a.fechas.length).map((e, i) => {
      let datesChips = e.fechas.slice(0, 4).map(f => `<span class="absence-chip">${f.slice(8, 10)}/${f.slice(5, 7)}</span>`).join(' ');
      if (e.fechas.length > 4) {
        datesChips += ` <span class="absence-chip-more">+${e.fechas.length - 4} más</span>`;
      }
      let datesTextAll = e.fechas.map(f => `${f.slice(8, 10)}/${f.slice(5, 7)}`).join(', ');
      return `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')" style="cursor:pointer; display:flex; align-items:center; gap:12px; padding:6px 0; border-bottom:1px solid var(--g100);">
            <div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div>
            <div class="ranking-info" style="flex:1;">
              <div class="ranking-name" style="font-weight:600; font-size:12px;">${escapeHtml(e.nombre)}</div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
                <span class="ranking-area" style="font-size:11px; color:var(--g500);">${escapeHtml(e.area || 'Sin área')}</span>
              </div>
              <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;" title="Fechas: ${datesTextAll}">
                ${datesChips}
              </div>
            </div>
            <div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end; justify-content:center;">
              <span style="font-size:12px; font-weight:700; color:var(--red); background:var(--red-lt); padding:3px 8px; border-radius:6px; display:flex; align-items:center; gap:4px;">
                <i class="fas fa-exclamation-circle"></i> ${e.fechas.length}
              </span>
            </div>
          </div>`;
    }).join('');

    if ($('ausenciasRanking')) {
      $('ausenciasRanking').innerHTML = htmlFaltas || '<div class="empty-state">Sin faltas en el período</div>';
    }

    let sumDiaria = 0, diasExc = 0;
    let cntDia = {};
    empCache.forEach(e => {
      (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= hoy_)
        .forEach(r => { cntDia[r.fecha] = (cntDia[r.fecha] || 0) + 1; });
    });
    diasHab.forEach(d => {
      let c = cntDia[d] || 0;
      sumDiaria += c;
      if (calcularPct(c, empCache.length) >= 90) diasExc++;
    });
    let promDia = diasHab.length ? Math.round(sumDiaria / diasHab.length) : 0;
    if ($('promedioDiario')) $('promedioDiario').textContent = promDia;
    if ($('diasExcelente')) $('diasExcelente').textContent = diasExc;

    // Horas extra: solo autorizadas, dentro del período
    let extraTotal = 0;
    empCache.forEach(e => {
      (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= hoy_ && (r.horasExtra === 'SI' || r.autoriza)).forEach(r => {
        let m = obtenerMinutos(r.hora);
        const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
        const refSalidaR = esFestivoR ? 900 : HORA_SALIDA_REF;
        if (m !== null && m - refSalidaR > 1) extraTotal += m - refSalidaR;
      });
    });
    if ($('horasExtraTotal')) $('horasExtraTotal').textContent = formatearMinutos(extraTotal);

    // ------------------------------------------------------------
    // CÁLCULO DE JUSTIFICACIONES PENDIENTES EN EL PERÍODO
    // ------------------------------------------------------------
    let justificacionesPendientes = [];
    let totalMinutosJustificarPeriodo = 0;

    // Generar la lista de fechas del período actual excluyendo el día de hoy
    let todasLasFechas = [];
    let currDate = new Date(periodo.inicio + 'T00:00:00');
    let endDate = new Date(hoy_ + 'T00:00:00');
    while (currDate < endDate) {
      todasLasFechas.push(currDate.toISOString().split('T')[0]);
      currDate.setDate(currDate.getDate() + 1);
    }

    empCache.forEach(e => {
      todasLasFechas.forEach(fecha => {
        const regsDia = (e.registros || []).filter(r => r.fecha === fecha);
        const esFestivo = esFeriadoODomingo(fecha) || (new Date(fecha + 'T12:00:00').getDay() === 6);

        // Si ya está justificado o es un día festivo sin asistencia, ignorar
        if (regsDia.some(r => r.justificado === 'SI')) return;

        let minsFaltantes = 0;
        let razon = "";

        if (regsDia.length === 0) {
          if (!esFestivo && diasHab.includes(fecha)) {
            minsFaltantes = 480;
            razon = "Inasistencia";
          }
        } else {
          let sortedRegs = [...regsDia].sort((a, b) => {
            if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
            return String(a.hora || '').localeCompare(String(b.hora || ''));
          });

          let periodosDia = [];
          let entradaPendiente = null;
          let ultimoSalidaMins = null;
          let ultimoSalidaReg = null;

          // Calcular gaps intermedios
          let dayMedico = 0;
          let dayPersonal = 0;
          let dayJustificar = 0;

          let processedLunchGap = false;
          sortedRegs.forEach(r => {
            const tipo = String(r.tipo || '').toUpperCase();
            if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
              let mE = obtenerMinutos(r.hora);
              if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
                let gap = mE - ultimoSalidaMins;
                if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
                  let lunchMins = Math.min(45, gap);
                  gap -= lunchMins;
                  processedLunchGap = true;
                }
                if (gap > 0) {
                  let clasif = clasificarGap(ultimoSalidaReg, gap);
                  if (clasif.tipo === 'medico') dayMedico += gap;
                  else if (clasif.tipo === 'personal') dayPersonal += gap;
                  else dayJustificar += gap;
                }
              }
              entradaPendiente = r;
            } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
              if (entradaPendiente) {
                periodosDia.push({ entrada: entradaPendiente, salida: r });
                ultimoSalidaMins = obtenerMinutos(r.hora);
                ultimoSalidaReg = r;
                entradaPendiente = null;
              } else {
                periodosDia.push({ entrada: null, salida: r });
              }
            }
          });
          if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });

          let minutosTrabajadosHoy = 0;
          ultimoSalidaMins = null;
          ultimoSalidaReg = null;

          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
            let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
            if (mE === null || mS === null || mS <= mE) return;
            minutosTrabajadosHoy += (mS - mE);
          });

          let netWorked = minutosTrabajadosHoy;
          if (!esFestivo && netWorked > 240) netWorked -= 45;

          let expectedNet = esFestivo ? 0 : 480;
          let missingMinutes = Math.max(0, expectedNet - netWorked);
          let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar;
          let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);

          minsFaltantes = dayJustificar + unaccountedMissing;

          // Determinar la razón
          if (minsFaltantes > 0) {
            let tieneEntradaSinSalida = periodosDia.some(p => p.entrada && !p.salida);
            if (tieneEntradaSinSalida) {
              razon = "Salida Faltante";
            } else if (dayJustificar > 0 && unaccountedMissing === 0) {
              razon = "Salida Intermedia";
            } else if (unaccountedMissing > 0 && dayJustificar === 0) {
              razon = "Jornada Incompleta";
            } else {
              razon = "Jornada Incompleta / Gaps";
            }
          }
        }

        if (minsFaltantes > 0 || razon) {
          totalMinutosJustificarPeriodo += minsFaltantes;
          justificacionesPendientes.push({
            empId: e.id,
            nombre: e.nombre,
            area: e.area,
            fecha: fecha,
            tiempoMins: minsFaltantes,
            razon: razon
          });
        }
      });
    });

    if ($('justificacionesRanking')) {
      $('justificacionesRanking').innerHTML = justificacionesPendientes.length ? justificacionesPendientes.map((item, i) => {
        let labelTiempo = minutosAHHMMSS(item.tiempoMins);
        let fechaLegible = `${item.fecha.slice(8, 10)}/` + `${item.fecha.slice(5, 7)}`;
        return `<div class="ranking-item">
              <div class="ranking-position">${i + 1}</div>
              <div class="ranking-info" style="flex:1;">
                <div class="ranking-name" onclick="mostrarDetalle('${item.empId}')" style="cursor:pointer; text-decoration:underline;">${escapeHtml(item.nombre)}</div>
                <div class="ranking-area" style="font-size:11px;">${escapeHtml(item.area || 'Sin área')} • <span class="pill" style="font-size: 9px; padding: 1px 6px; background:#fee2e2; color:#991b1b; font-weight:700;">${item.razon}</span></div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                <div style="font-size:10px; color:var(--g400); font-weight:600;">${fechaLegible}</div>
                <div style="font-weight:700; color:var(--red); font-size:13px; display:flex; align-items:center; gap:6px;">
                  <span>${labelTiempo}</span>
                  <button class="btn-primary" style="padding:4px 8px; font-size:10px; border-radius:4px; font-weight:600;" onclick="window.mostrarModalJustificar('${item.empId}', '${escapeHtml(item.nombre)}', '${item.fecha}', '${labelTiempo}', '${item.razon}')">Justificar</button>
                </div>
              </div>
            </div>`;
      }).join('') : '<div class="empty-state">No hay justificaciones pendientes</div>';
    }
    if ($('justificacionesTotalTime')) {
      $('justificacionesTotalTime').textContent = minutosAHHMMSS(totalMinutosJustificarPeriodo);
    }

    // Subtítulo de almuerzo de planta con extras (excluyendo refrigerios)
    let extrasPeriodo = window.obtenerAlmuerzosExtraConsolidados(periodo.inicio, hoy_);
    let totalExtrasPeriodo = extrasPeriodo.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);
    let totalLunchesPeriodo = almP + totalExtrasPeriodo;
    if ($('dashAlmPlantaSub')) {
      $('dashAlmPlantaSub').innerHTML = `<span style="font-weight:600; color:var(--blue)">${almP}</span> emp. + <span style="font-weight:600; color:var(--indigo)">${totalExtrasPeriodo}</span> ext. = <strong>${totalLunchesPeriodo}</strong> total`;
    }

    cargarResumenMensual();
    cargarAnalisisTardanzas();
    if (typeof window.renderDetailedKPIs === 'function') {
      window.renderDetailedKPIs();
    }
  }
}

function cargarResumenMensual() {
  cargarReportes();
  if (typeof actualizarReporteInteractivo === 'function') {
    actualizarReporteInteractivo();
  }
}

function filtrarResumenMensual() {
  let q = ($('searchResumenMensual')?.value || '').toLowerCase();
  let data = (window._resumenMensualData || []).filter(e => !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q));
  if (!data.length) {
    $('tablaResumenMensual').innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando datos...</p></div>';
    return;
  }
  let html = `<table class="employee-table table-compact"><thead><tr><th>Empleado</th><th>Área</th><th>Asistencias</th><th>Faltas</th><th>Tardanzas</th><th>Alm. Planta</th><th>Alm. Fuera</th><th>Puntualidad</th></tr></thead><tbody>`;
  html += data.sort((a, b) => b.asist - a.asist).map(e => {
    let pc = e.punt >= 90 ? 'ok' : e.punt >= 70 ? 'late' : 'miss';
    return `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<strong>${escapeHtml(e.nombre)}</strong></div></div></td><td>${escapeHtml(e.area || '—')}</div></td><td><span class="pill ok">${e.asist}</span></td><td><span class="pill ${e.faltas ? 'miss' : 'ok'}">${e.faltas}</span></td><td><span class="pill ${e.tards ? 'late' : 'ok'}">${e.tards}</span></div></td><td><span class="pill late">${e.almP}</span></div></td><td><span class="pill" style="background:#dbeafe">${e.almF}</span></div></td><td><span class="pill ${pc}">${e.punt}%</span></div></tr>`;
  }).join('');

  // Calcular almuerzos extra del período para agregar fila final si es > 0
  let idx = parseInt($('periodoMensual')?.value || 0);
  let periodoSel = periodos[idx];
  if (periodoSel) {
    const fechaFiltro = $('filtroFechaReportes')?.value;
    const R_INI = fechaFiltro ? fechaFiltro : periodoSel.inicio;
    const R_FIN = fechaFiltro ? fechaFiltro : periodoSel.fin;

    let extrasPeriodo = window.obtenerAlmuerzosExtraConsolidados(R_INI, R_FIN);
    let totalAlmExt = extrasPeriodo.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);

    if (totalAlmExt > 0) {
      let rowHtml = `<tr style="background-color:rgba(99,102,241,0.05); font-style:italic;">
            <td>
              <div class="employee-cell">
                <div class="employee-photo-placeholder" style="background:var(--indigo-lt); color:var(--indigo); display:flex; align-items:center; justify-content:center;"><i class="fas fa-utensils"></i></div>
                <strong>Almuerzos Extras (Formulario)</strong>
              </div>
            </td>
            <td>Varios</td>
            <td style="text-align:center">—</td>
            <td style="text-align:center">—</td>
            <td style="text-align:center">—</td>
            <td style="text-align:center"><span class="pill late" style="font-size:10px;padding:2px 7px;font-weight:bold;">${totalAlmExt}</span></td>
            <td style="text-align:center">—</td>
            <td style="text-align:center">—</td>
          </tr>`;
      html += rowHtml;
    }
  }

  let sumAsist = data.reduce((acc, e) => acc + (parseInt(e.asist) || 0), 0);
  let sumFaltas = data.reduce((acc, e) => acc + (parseInt(e.faltas) || 0), 0);
  let sumTards = data.reduce((acc, e) => acc + (parseInt(e.tards) || 0), 0);
  let sumAlmP = data.reduce((acc, e) => acc + (parseInt(e.almP) || 0), 0);
  let sumAlmF = data.reduce((acc, e) => acc + (parseInt(e.almF) || 0), 0);
  let avgPunt = data.length ? Math.round(data.reduce((acc, e) => acc + (parseFloat(e.punt) || 0), 0) / data.length) : 0;
  let totalAlmPFinal = sumAlmP + (typeof totalAlmExt !== 'undefined' ? totalAlmExt : 0);

  html += `<tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid var(--g300); position:sticky; bottom:0; z-index:10;">
        <td><strong>TOTALES (${data.length})</strong></td>
        <td>—</td>
        <td>${sumAsist}</td>
        <td>${sumFaltas}</td>
        <td>${sumTards}</td>
        <td>${totalAlmPFinal}</td>
        <td>${sumAlmF}</td>
        <td>${avgPunt}% (Prom.)</td>
      </tr>`;

  html += `</tbody></table>`;
  $('tablaResumenMensual').innerHTML = html;
}

function cargarAnalisisTardanzas() {
  if (!$('tarTotal')) return;
  let periodo = periodos[parseInt($('periodoTardanzas')?.value || 0)];
  if (!periodo || !empCache.length) return;
  let stats = empCache.map(e => {
    let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
    let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
    let t = 0, m = 0, x = 0, sE = 0, nE = 0;
    entradas.forEach(r => {
      let mins = obtenerMinutos(r.hora);
      if (mins === null) return;
      sE += mins; nE++;
      const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
      const refEnt = esFestivoR ? 420 : HORA_ENTRADA_REF;
      if (mins - refEnt > 5) { t++; m += mins - refEnt; }
    });
    salidas.forEach(r => {
      let mins = obtenerMinutos(r.hora);
      if (mins === null) return;
      const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
      const refSal = esFestivoR ? 900 : HORA_SALIDA_REF;
      if (mins - refSal > 1) x++;
    });
    return { ...e, tardanzas: t, minP: m, extra: x, promE: nE ? Math.round(sE / nE) : null, nE, id: e.id };
  });
  let totT = stats.reduce((s, r) => s + r.tardanzas, 0);
  let totM = stats.reduce((s, r) => s + r.minP, 0);
  let totX = stats.reduce((s, r) => s + r.extra, 0);
  if ($('tarTotal')) $('tarTotal').textContent = totT;
  if ($('tarMinutos')) $('tarMinutos').textContent = formatearMinutos(totM);
  if ($('tarExtra')) $('tarExtra').textContent = totX;
  if ($('tarPuntuales')) $('tarPuntuales').textContent = punt;
  let rank = stats.filter(r => r.tardanzas > 0).sort((a, b) => b.tardanzas - a.tardanzas);
  let maxT = rank[0]?.tardanzas || 1;
  $('rankingTardanzas').innerHTML = rank.length ? rank.slice(0, 10).map(r => `<div class="hbar-row" onclick="mostrarDetalle('${r.id}')"><div class="hbar-label" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre.split(' ')[0])}</div><div class="hbar-track"><div class="hbar-fill" style="width:${calcularPct(r.tardanzas, maxT)}%;background:var(--amber);"></div></div><div class="hbar-number">${r.tardanzas} tard.</div></div>`).join('') : '<div class="empty-state">Sin tardanzas</div>';
}

// ============================================================
// HELPER: OBTENER FECHAS PENDIENTES DE REGULARIZAR POR EMPLEADO
// Evalúa días laborables ordinarios anteriores a hoy (excluyendo jornada en curso)
window.obtenerFechasPendientesRegularizarEmpleado = function (emp, customInicio = null, customFin = null) {
  if (!emp || emp.isVisitante || (emp.cargo || '').toUpperCase() === 'SIN ASISTENCIA') return [];

  const hoyStrLocal = getLocalHoyStr();
  let inicio = customInicio;
  let fin = customFin;
  if (!inicio || !fin) {
    const pActual = (typeof periodos !== 'undefined' && Array.isArray(periodos) && periodos[0]) ? periodos[0] : null;
    const pAnterior = (typeof periodos !== 'undefined' && Array.isArray(periodos) && periodos[1]) ? periodos[1] : null;
    if (pActual) {
      // Evaluar período actual y el anterior para cubrir regularizaciones pendientes pasadas
      inicio = pAnterior ? pAnterior.inicio : pActual.inicio;
      fin = pActual.fin;
    } else {
      let d = new Date();
      fin = fin || d.toISOString().split('T')[0];
      d.setDate(d.getDate() - 60);
      inicio = inicio || d.toISOString().split('T')[0];
    }
  }

  // Agrupar registros por fecha normalizada
  const porDia = {};
  (emp.registros || []).forEach(r => {
    let f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
    if (!f || f < inicio || f > fin) return;
    if (!porDia[f]) porDia[f] = [];
    porDia[f].push(r);
  });

  // Generar rango de fechas ordinarias hasta ayer (excluyendo estrictamente hoy)
  const fechasRango = [];
  let curr = new Date(inicio + 'T12:00:00');
  const dFin = new Date(fin + 'T12:00:00');
  while (curr <= dFin) {
    const fStr = curr.toISOString().split('T')[0];
    if (fStr < hoyStrLocal) {
      fechasRango.push(fStr);
    }
    curr.setDate(curr.getDate() + 1);
  }

  const fechasPendientes = [];

  fechasRango.forEach(f => {
    const dObj = new Date(f + 'T12:00:00');
    const dayOfWeek = dObj.getDay();
    const esFestivo = (typeof esFeriadoODomingo === 'function') ? esFeriadoODomingo(f) : false;
    const esDiaLaboralOrdinario = (dayOfWeek !== 0 && dayOfWeek !== 6 && !esFestivo);
    if (!esDiaLaboralOrdinario) return;

    const regsDia = porDia[f] || [];
    let periodosDia = [];
    let curEntrada = null;
    let tieneMarcacionReal = false;
    let isJustificado = false;
    let tienePermisoEspecial = false;

    // Verificar si está justificado o de vacaciones
    regsDia.forEach(r => {
      const t = String(r.tipo || '').toUpperCase();
      const just = String(r.justificado || '').toUpperCase();
      const raz = String(r.razon_ausencia || r.razon_permiso || r.razon_justificac || '').toUpperCase();

      if (just === 'SI' || t === 'FALTA_JUSTIFICADA' || t === 'SALIDA_JUSTIFICADA' || t === 'CUMPLEANOS' || t === 'CUMPLEAÑOS' || raz.includes('JUSTIFIC') || raz.includes('CUMPLEA')) {
        isJustificado = true;
      }
      if (t.includes('VACAC') || raz.includes('VACAC') || (emp.estado || '').toUpperCase() === 'VACACIONES') {
        tienePermisoEspecial = true;
        isJustificado = true;
      }
      if (t.includes('MEDIC') || raz.includes('MEDIC') || t.includes('CALAMIDAD') || raz.includes('CALAMIDAD') || t.includes('PERSONAL') || raz.includes('PERSONAL')) {
        tienePermisoEspecial = true;
      }
    });

    // Vacaciones en módulo RRHH
    const vacsRRHH = (window.vacacionesData && Array.isArray(window.vacacionesData.vacaciones)) ? window.vacacionesData.vacaciones : [];
    if (vacsRRHH.some(v => v && (String(v.empleadoId) === String(emp.id) || String(v.id_empleado) === String(emp.id)) && ((typeof normalizarFechaStr === 'function' ? normalizarFechaStr(v.fecha) : v.fecha) === f))) {
      tienePermisoEspecial = true;
      isJustificado = true;
    }

    if (tienePermisoEspecial && isJustificado) return;

    // Ordenar registros del día
    regsDia.sort((a, b) => {
      let ha = a.hora || (a.timestamp ? String(a.timestamp).substring(11, 19) : '');
      let hb = b.hora || (b.timestamp ? String(b.timestamp).substring(11, 19) : '');
      return ha.localeCompare(hb);
    });

    regsDia.forEach(r => {
      const t = String(r.tipo || '').toUpperCase();
      if (t === 'ENTRADA' || t === 'CAMPO' || t === 'ENTRADA_CAMPO' || t === 'TRABAJO_DE_CAMPO') {
        tieneMarcacionReal = true;
        if (curEntrada) {
          periodosDia.push({ entrada: curEntrada, salida: null });
        }
        curEntrada = r;
      } else if (t === 'SALIDA' || t === 'RETORNO_CAMPO') {
        tieneMarcacionReal = true;
        if (curEntrada) {
          periodosDia.push({ entrada: curEntrada, salida: r });
          curEntrada = null;
        } else {
          periodosDia.push({ entrada: null, salida: r });
        }
      }
    });
    if (curEntrada) {
      periodosDia.push({ entrada: curEntrada, salida: null });
    }

    const esFalta = !tieneMarcacionReal && !isJustificado;
    const faltaMarcacionEntrada = periodosDia.some(p => !p.entrada && p.salida);
    const faltaMarcacionSalida = periodosDia.some(p => p.entrada && !p.salida);

    const fParts = f.split('-');
    const fFmt = (fParts.length === 3) ? `${fParts[2]}/${fParts[1]}` : f;

    if (esFalta) {
      fechasPendientes.push({ fecha: f, label: fFmt, motivo: 'Inasistencia', tipo: 'ausencia' });
      return;
    }
    if (faltaMarcacionSalida) {
      fechasPendientes.push({ fecha: f, label: fFmt, motivo: 'Sin Salida', tipo: 'incompleto' });
      return;
    }
    if (faltaMarcacionEntrada) {
      fechasPendientes.push({ fecha: f, label: fFmt, motivo: 'Sin Entrada', tipo: 'incompleto' });
      return;
    }

    // Calcular tiempo trabajado y tiempo por justificar
    let minutosTrabajadosHoy = 0;
    let ultimoSalidaMins = null;
    let tiempoMedico = 0;
    let tiempoPersonal = 0;
    let processedLunchGap = false;

    periodosDia.forEach(p => {
      if (!p.entrada || !p.salida) return;
      let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;
      let duracion = mS - mE;
      minutosTrabajadosHoy += duracion;

      if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
        let gap = mE - ultimoSalidaMins;
        if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
          gap -= Math.min(45, gap);
          processedLunchGap = true;
        }
        if (gap > 0) {
          let clasif = (typeof clasificarGap === 'function') ? clasificarGap(p.salida, gap) : { tipo: 'desconocido' };
          if (clasif.tipo === 'medico') tiempoMedico += gap;
          else if (clasif.tipo === 'personal') tiempoPersonal += gap;
        }
      }
      ultimoSalidaMins = mS;
    });

    let netWorked = minutosTrabajadosHoy;
    if (netWorked > 240) netWorked -= 45;

    let tiempoJustificado = 0;
    const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
    if (regPermiso) {
      tiempoPersonal += Number(regPermiso.permiso_personal_mins || 0);
      tiempoMedico += Number(regPermiso.permiso_medico_mins || 0);
      tiempoJustificado += Number(regPermiso.tiempo_justificado_mins || 0);
    }

    if (!isJustificado) {
      let missingMinutes = Math.max(0, 480 - netWorked);
      let totalPermisosHoy = tiempoPersonal + tiempoMedico;
      let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
      let tj = Math.max(0, unaccountedMissing - tiempoJustificado);
      if (tj > 60) {
        fechasPendientes.push({ fecha: f, label: fFmt, motivo: 'Tiempo por justificar', tipo: 'tiempo', minutos: tj });
      }
    }
  });

  // Ordenar fechas pendientes descendente (más recientes primero)
  fechasPendientes.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return fechasPendientes;
};

// ============================================================
// ASISTENCIA - CARDS Y TABLA
function cargarAsistencia() {
  hoy = getLocalHoyStr();
  const canEditAttendance = tienePermisoAdmin();
  // Ordenar empleados alfabéticamente
  empCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

  let total = empCache.length;
  let pres = empCache.filter(e => e.entradaHoy).length;
  let ausentes = total - pres;
  const esFestivoHoy = esFeriadoODomingo(hoy) || (new Date(hoy + 'T12:00:00').getDay() === 6);
  const refEntradaHoy = esFestivoHoy ? 420 : HORA_ENTRADA_REF;
  const refSalidaHoy = esFestivoHoy ? 900 : HORA_SALIDA_REF;

  let tards = empCache.filter(e => { if (!e.entradaHoy) return false; let m = obtenerMinutos(e.horaEntradaMs); return m !== null && m > refEntradaHoy + 5; }).length;
  let salieron = empCache.filter(e => e.salidaHoy).length;
  let sinSalida = pres - salieron;

  let extrasHoy = window.obtenerAlmuerzosExtraConsolidados(hoy, hoy);
  let totalExtrasHoy = extrasHoy.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);

  let almPlanta = empCache.filter(e => {
    const esPresenteOAlm = e.entradaHoy || (typeof esEmpleadoSoloAlmuerzo === 'function' && esEmpleadoSoloAlmuerzo(e)) || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    return esPresenteOAlm && (e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA');
  }).length + totalExtrasHoy;
  let almFuera = empCache.filter(e => {
    const esPresenteOAlm = e.entradaHoy || (typeof esEmpleadoSoloAlmuerzo === 'function' && esEmpleadoSoloAlmuerzo(e)) || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    return esPresenteOAlm && (e.almuerzoHoy === 'NO' || e.almuerzoHoy === 'FUERA');
  }).length;

  // Conteos para filtros específicos
  let countSinMarcar = 0;
  let countCampo = 0;
  let countVacaciones = 0;
  let countPermisos = 0;
  let countPorRegularizar = 0;

  const pActual = (typeof periodos !== 'undefined' && Array.isArray(periodos) && periodos[0]) ? periodos[0] : null;
  const pAnterior = (typeof periodos !== 'undefined' && Array.isArray(periodos) && periodos[1]) ? periodos[1] : null;
  const evalInicio = pAnterior ? pAnterior.inicio : (pActual ? pActual.inicio : null);
  const evalFin = pActual ? pActual.fin : null;

  empCache.forEach(e => {
    let fReg = (e.registros || []).find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    let rHoy = fReg ? (fReg.razon_ausencia || fReg.razon_permiso || '') : '';
    let rUpper = rHoy.toUpperCase();
    let isSinAsis = (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
    let modoStr = (e.modo || '').toUpperCase();
    let regCampo = (e.registros || []).some(reg => reg.modo === 'CAMPO' && reg.fecha === hoy);

    if (!isSinAsis) {
      let fechasReg = window.obtenerFechasPendientesRegularizarEmpleado(e, evalInicio, evalFin);
      e._fechasRegularizar = fechasReg || [];
      if (fechasReg && fechasReg.length > 0) {
        countPorRegularizar++;
      }

      if (rUpper.includes('VACACI') || (e.estado || '').toUpperCase() === 'VACACIONES') {
        countVacaciones++;
      } else if (rUpper.includes('CAMPO') || modoStr.includes('CAMPO') || regCampo) {
        countCampo++;
      } else if (rUpper.length > 0) {
        countPermisos++;
      } else if (!e.entradaHoy) {
        countSinMarcar++;
      }
    } else {
      e._fechasRegularizar = [];
    }
  });

  if ($('asisTotal')) $('asisTotal').textContent = total;
  if ($('asisPresentes')) $('asisPresentes').textContent = pres - salieron;
  if ($('asisAusentes')) $('asisAusentes').textContent = ausentes;
  if ($('asisSinMarcar')) $('asisSinMarcar').textContent = countSinMarcar;

  const cardSinMarcar = document.querySelector('.kpi-card[data-filter="sin_marcar"]');
  if (cardSinMarcar) {
    if (countSinMarcar > 0) {
      cardSinMarcar.classList.add('has-alerts');
      if ($('asisSinMarcarDot')) $('asisSinMarcarDot').style.display = 'block';
    } else {
      cardSinMarcar.classList.remove('has-alerts');
      if ($('asisSinMarcarDot')) $('asisSinMarcarDot').style.display = 'none';
    }
  }

  if ($('asisPorRegularizar')) $('asisPorRegularizar').textContent = countPorRegularizar;
  const cardPorRegularizar = document.querySelector('.kpi-card[data-filter="por_regularizar"]');
  if (cardPorRegularizar) {
    if (countPorRegularizar > 0) {
      cardPorRegularizar.classList.add('has-alerts');
      if ($('asisPorRegularizarDot')) $('asisPorRegularizarDot').style.display = 'block';
    } else {
      cardPorRegularizar.classList.remove('has-alerts');
      if ($('asisPorRegularizarDot')) $('asisPorRegularizarDot').style.display = 'none';
    }
  }

  if ($('asisCampo')) $('asisCampo').textContent = countCampo;
  if ($('asisVacaciones')) $('asisVacaciones').textContent = countVacaciones;
  if ($('asisPermisos')) $('asisPermisos').textContent = countPermisos;
  if ($('searchTotalCount')) $('searchTotalCount').textContent = total;

  if ($('asisTardanzas')) $('asisTardanzas').textContent = tards;
  if ($('asisSalieron')) $('asisSalieron').textContent = salieron;
  if ($('asisSinSalida')) $('asisSinSalida').textContent = sinSalida;
  if ($('asisVisitantes')) $('asisVisitantes').textContent = totalExtrasHoy;
  if ($('asisAlmuerzoPlanta')) $('asisAlmuerzoPlanta').textContent = almPlanta;
  if ($('asisAlmuerzoFuera')) $('asisAlmuerzoFuera').textContent = almFuera;
  if ($('asisAlmuerzoPlantaSub')) {
    $('asisAlmuerzoPlantaSub').textContent = totalExtrasHoy > 0 ? `Incluye ${totalExtrasHoy} extras` : '';
  }

  // Actualizar botón unificado de notificación WhatsApp en barra de Asistencia
  const totalAlertasWhatsApp = countSinMarcar;
  if ($('lblCountTotalPendientesWhatsApp')) $('lblCountTotalPendientesWhatsApp').textContent = totalAlertasWhatsApp;
  if ($('btnNotificarWhatsAppUnificado')) $('btnNotificarWhatsAppUnificado').style.display = 'inline-flex';

  if ($('lblCountSinMarcarWhatsApp')) $('lblCountSinMarcarWhatsApp').textContent = countSinMarcar;
  if ($('lblCountAusentesWhatsApp')) $('lblCountAusentesWhatsApp').textContent = ausentes;
  if ($('lblCountSalidaWhatsApp')) $('lblCountSalidaWhatsApp').textContent = sinSalida;

  window._asisData = empCache.map(e => {
    let eReg = (e.registros || []).find(r => r.tipo === 'ENTRADA' && r.fecha === hoy);
    let sReg = (e.registros || []).find(r => r.tipo === 'SALIDA' && r.fecha === hoy);

    // Preparar edición para Admin y Sup Admin
    let horaEntradaRaw = e.horaEntrada || eReg?.hora || '-';
    let horaSalidaRaw = e.horaSalida || sReg?.hora || (e.entradaHoy ? 'Pendiente' : '-');

    let clickEntrada = canEditAttendance ? `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'hora', '${horaEntradaRaw}')"` : "";
    let clickSalida = canEditAttendance ? `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'SALIDA', '${sReg?.id || ''}', 'hora', '${horaSalidaRaw}')"` : "";

    let horaV = e.horaEntradaMs || eReg?.hora || eReg?.timestamp;
    let mEnt = e.entradaHoy ? obtenerMinutos(horaV) : null;
    let tard = mEnt !== null && mEnt > refEntradaHoy + 5;

    let eHtml = e.entradaHoy ? `<span class="editable-cell" ${clickEntrada}>${mEnt !== null ? minsToHHMM(mEnt) : 'Registrada'}${tard ? ` <span class="delta pos">+${formatearMinutos(mEnt - refEntradaHoy)}</span>` : ''}</span>` : `<span class="editable-cell empty" ${clickEntrada}>-</span>`;

    let sHoraV = e.horaSalidaMs || sReg?.hora || sReg?.timestamp;
    let mSal = e.salidaHoy ? obtenerMinutos(sHoraV) : null;
    let sHtml = e.salidaHoy ? `<span class="editable-cell" ${clickSalida}>${mSal !== null ? minsToHHMM(mSal) : 'Registrada'}${mSal - refSalidaHoy > 1 ? ` <span class="delta neg">+${formatearMinutos(mSal - refSalidaHoy)}</span>` : ''}</span>` : (e.entradaHoy ? `<span class="editable-cell empty" ${clickSalida}>Pendiente</span>` : `<span class="editable-cell empty" ${clickSalida}>-</span>`);

    let fReg = (e.registros || []).find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    let razonAusenciaHoy = fReg ? (fReg.razon_ausencia || fReg.razon_permiso || '') : '';
    let isSinAsistencia = (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';

    let estHtml = '';
    let ausenciaHtml = '-';

    if (isSinAsistencia) {
      estHtml = '<span class="pill" style="background:#f1f5f9; color:#64748b; border:1px dashed #cbd5e1;"><i class="fas fa-utensils"></i> Solo Alm.</span>';
      ausenciaHtml = '<span class="pill dim" style="opacity:0.6; font-size:10px; background:transparent; border:none;">N/A</span>';
    } else {
      if (!e.entradaHoy) {
        estHtml = '<span class="pill miss"><i class="fas fa-times"></i> Ausente</span>';

        // WhatsApp Button
        let tel = (e.telefono || '').replace(/\D/g, '');
        if (tel && tel.length >= 9) {
          if (tel.startsWith('0')) tel = '593' + tel.substring(1);
          let msg = encodeURIComponent("Hola, te recordamos que no has registrado tu asistencia el día de hoy.");
          estHtml += ` <a href="https://wa.me/${tel}?text=${msg}" target="_blank" onclick="event.stopPropagation();" style="color:#25d366; margin-left:6px; font-size:16px; vertical-align:middle; transition: transform 0.2s;" title="Notificar por WhatsApp"><i class="fab fa-whatsapp"></i></a>`;
        }

        // Dropdown Razón
        let selectHtml = `
                    <div style="position:relative; width:100%; min-width:120px;">
                        <select onchange="window.guardarRazonAusenciaGlobal('${e.id}', this.value)" onclick="event.stopPropagation();" style="font-size:10px; padding:4px 8px; border-radius:12px; width:100%; border:1px solid ${razonAusenciaHoy ? '#fdba74' : '#cbd5e1'}; background:${razonAusenciaHoy ? '#fff7ed' : '#f8fafc'}; color:${razonAusenciaHoy ? '#c2410c' : '#64748b'}; font-weight:600; cursor:pointer; outline:none;">
                            <option value="">${razonAusenciaHoy ? 'Cambiar Razón...' : '+ Agregar Razón'}</option>
                            <option value="Vacación" ${razonAusenciaHoy === 'Vacación' ? 'selected' : ''}>🏖️ Vacación</option>
                            <option value="Permiso Médico" ${razonAusenciaHoy === 'Permiso Médico' ? 'selected' : ''}>🩺 Permiso Médico</option>
                            <option value="Permiso Personal" ${razonAusenciaHoy === 'Permiso Personal' ? 'selected' : ''}>👤 Permiso Personal</option>
                            <option value="Calamidad Doméstica" ${razonAusenciaHoy === 'Calamidad Doméstica' ? 'selected' : ''}>🏠 Calamidad Dom.</option>
                            <option value="Salida a Campo" ${razonAusenciaHoy === 'Salida a Campo' || razonAusenciaHoy === 'Trabajo de Campo' ? 'selected' : ''}>🚗 Salida a Campo</option>
                            <option value="Cumpleaños" ${razonAusenciaHoy === 'Cumpleaños' ? 'selected' : ''}>🎂 Cumpleaños</option>
                            <option value="Salida Justificada" ${razonAusenciaHoy === 'Salida Justificada' ? 'selected' : ''}>✅ Salida Justificada</option>
                            <option value="Otro" ${razonAusenciaHoy && !['Vacación', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Trabajo de Campo', 'Salida a Campo', 'Cumpleaños', 'Salida Justificada'].includes(razonAusenciaHoy) ? 'selected' : ''}>✏️ Otro...</option>
                        </select>
                    </div>
                  `;
        if (razonAusenciaHoy && !['Vacación', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Trabajo de Campo', 'Salida a Campo', 'Cumpleaños', 'Salida Justificada'].includes(razonAusenciaHoy)) {
          selectHtml += `<div style="font-size:10px; color:var(--indigo); margin-top:4px; line-height:1; font-weight:700; text-align:center;">${escapeHtml(razonAusenciaHoy)}</div>`;
        }
        ausenciaHtml = selectHtml;
      } else {
        estHtml = tard ? '<span class="pill late"><i class="fas fa-exclamation"></i> Tarde</span>' : '<span class="pill ok"><i class="fas fa-check"></i> Puntual</span>';
      }
    }

    // Modo y Extras
    let modo = eReg?.modo || sReg?.modo || (e.entradaHoy ? 'EMPRESA' : '-');
    let extrasVal = (eReg?.horasExtra === 'SI' || sReg?.horasExtra === 'SI') ? 'SI' : 'NO';
    let extras = (extrasVal === 'SI') ? '<span class="pill ok">AUTORIZADO</span>' : '<span class="pill dim">NO</span>';
    if ((eReg?.autoriza || '').includes('CAMPO')) extras = '<span class="pill ok" title="Auto-autorizado por Campo">CAMPO</span>';

    // Hacer modo y extras editables para Admin y Sup Admin
    let modoHtml = modo;
    let extrasHtml = extras;
    if (canEditAttendance) {
      const clickModo = `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'modo', '${modo}')"`;
      const clickExtras = `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'horasExtra', '${extrasVal}')"`;
      modoHtml = `<span class="editable-pill" ${clickModo}>${modo}</span>`;
      extrasHtml = `<span class="editable-pill" ${clickExtras}>${extras}</span>`;
    }

    let toggle = '';
    let puedeEditar = e.entradaHoy || canEditAttendance || isSinAsistencia;

    if (!e.entradaHoy && !isSinAsistencia) {
      toggle = `<span class="pill dim" style="font-size:10px; opacity:0.5; background:transparent; border:none;">Ausente</span>`;
    } else {
      toggle = `<div class="almuerzo-toggle"><button class="toggle-option ${(e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA') ? 'active-si' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','SI')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-building"></i> Sí</button><button class="toggle-option ${(e.almuerzoHoy === 'NO' || e.almuerzoHoy === 'FUERA') ? 'active-no' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','NO')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-home"></i> No</button></div>`;
    }

    return { ...e, _eH: eHtml, _sH: sHtml, _est: estHtml, _ausencia: ausenciaHtml, _toggle: toggle, _tard: tard, _entradaHoy: e.entradaHoy, _almuerzoHoy: e.almuerzoHoy, _salidaHoy: e.salidaHoy, _modo: modoHtml, _extras: extrasHtml, _razonAusenciaHoy: razonAusenciaHoy, id: e.id, isSinAsistencia, _fechasRegularizar: e._fechasRegularizar || [] };
  });

  let extrasHoyTb = window.obtenerAlmuerzosExtraConsolidados(hoy, hoy);
  extrasHoyTb.forEach((extra, idx) => {
    window._asisData.push({
      id: extra.id || `extra_${idx}`,
      nombre: `Visitante/Extra (${extra.invitado || extra.nombre || extra.observaciones || 'Sin detalle'})`,
      area: extra.area || 'Visita/Extra',
      foto_url: '',
      _eH: `<span class="pill dim" style="opacity:0.5; font-size:10px;">${extra.hora || '--:--'}</span>`,
      _sH: `<span class="pill dim" style="opacity:0.5; font-size:10px;">--:--</span>`,
      _modo: `<span class="pill dim" style="opacity:0.5; font-size:10px;">N/A</span>`,
      _extras: `<span class="pill dim" style="opacity:0.5; font-size:10px;">N/A</span>`,
      _est: `<span class="pill" style="background:#f3f4f6; color:#6b7280; font-size:10px; border:1px dashed #cbd5e1;"><i class="fas fa-id-badge"></i> Invitado</span>`,
      _ausencia: `<span class="pill dim" style="opacity:0.5; font-size:10px;">—</span>`,
      _toggle: `<span class="pill" style="background:#dbeafe; color:#1e40af; font-size:11px; font-weight:600;"><i class="fas fa-building" style="margin-right:4px;"></i> +${extra.cantidad || 1} Extra(s)</span>`,
      _entradaHoy: false,
      _salidaHoy: false,
      _tard: false,
      _almuerzoHoy: 'SI',
      isVisitante: true,
      _fechasRegularizar: []
    });
  });

  filtrarAsistenciaTabla();
}



function setFiltroAsistencia(filtro) {
  filtroAsistenciaActual = filtro;
  filtrarAsistenciaTabla();
}

window.limpiarBusquedaAsistencia = function () {
  const input = $('searchAsistencia');
  if (input) {
    input.value = '';
    filtrarAsistenciaTabla();
    input.focus();
  }
};

function filtrarAsistenciaTabla() {
  document.querySelectorAll('.kpi-card[data-filter]').forEach(btn => {
    if (btn.getAttribute('data-filter') === filtroAsistenciaActual) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  let searchInput = $('searchAsistencia');
  let q = (searchInput?.value || '').toLowerCase().trim();
  let clearBtn = $('btnClearSearchAsistencia');
  if (clearBtn) {
    clearBtn.style.display = q.length > 0 ? 'flex' : 'none';
  }

  let data = (window._asisData || []).filter(e => {
    if (q && !e.nombre.toLowerCase().includes(q) && !(e.area || '').toLowerCase().includes(q) && !(e.id || '').includes(q) && !(e.cargo || '').toLowerCase().includes(q)) return false;

    let fReg = (e.registros || []).find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    let rHoy = fReg ? (fReg.razon_ausencia || fReg.razon_permiso || '') : (e._razonAusenciaHoy || e.razon_ausencia || e.razon_permiso || '');
    let rUpper = String(rHoy || '').toUpperCase();
    let modoStr = String(e._modo || e.modo || '').toUpperCase();
    let regCampo = (e.registros || []).some(reg => reg.modo === 'CAMPO' && reg.fecha === hoy);

    if (filtroAsistenciaActual === 'presente' && (!e._entradaHoy || e._salidaHoy)) return false;
    if (filtroAsistenciaActual === 'sin_marcar') {
      if (e._entradaHoy || e.isVisitante || e.isSinAsistencia) return false;
      if (rUpper.length > 0 || (e.estado || '').toUpperCase() === 'VACACIONES') return false;
      return true;
    }
    if (filtroAsistenciaActual === 'en_campo') {
      if (e.isVisitante) return false;
      return modoStr.includes('CAMPO') || rUpper.includes('CAMPO') || regCampo;
    }
    if (filtroAsistenciaActual === 'vacaciones') {
      if (e.isVisitante) return false;
      return rUpper.includes('VACACI') || (e.estado || '').toUpperCase() === 'VACACIONES';
    }
    if (filtroAsistenciaActual === 'permisos') {
      if (e.isVisitante) return false;
      if (rUpper.includes('VACACI') || rUpper.includes('CAMPO')) return false;
      return rUpper.length > 0;
    }
    if (filtroAsistenciaActual === 'por_regularizar') {
      if (e.isVisitante || e.isSinAsistencia) return false;
      return (e._fechasRegularizar && e._fechasRegularizar.length > 0);
    }
    if (filtroAsistenciaActual === 'ausente' && (e._entradaHoy || e.isVisitante)) return false;
    if (filtroAsistenciaActual === 'tardanza' && !e._tard) return false;
    if (filtroAsistenciaActual === 'almuerzo_si') {
      if (e.isVisitante) {
        // Permitir visitante/extra
      } else {
        const esPresenteOAlm = e._entradaHoy || e.isSinAsistencia;
        if (!esPresenteOAlm || (e._almuerzoHoy !== 'SI' && e._almuerzoHoy !== 'PLANTA')) return false;
      }
    }
    if (filtroAsistenciaActual === 'almuerzo_no') {
      const esPresenteOAlm = e._entradaHoy || e.isSinAsistencia;
      if (!esPresenteOAlm || (e._almuerzoHoy !== 'NO' && e._almuerzoHoy !== 'FUERA')) return false;
    }
    if (filtroAsistenciaActual === 'salieron' && !e._salidaHoy) return false;
    if (filtroAsistenciaActual === 'sin_salida' && (!e._entradaHoy || e._salidaHoy)) return false;
    return true;
  });

  if ($('searchResultCount')) {
    $('searchResultCount').textContent = data.length;
  }
  if ($('searchTotalCount')) {
    $('searchTotalCount').textContent = (window._asisData || []).length;
  }

  // Mantener orden alfabético
  data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
  if (!data.length) {
    $('asistenciaTablaContainer').innerHTML = '<div class="empty-state"><i class="fas fa-users-slash"></i><p>No hay empleados que coincidan con el filtro</p></div>';
    return;
  }

  let totalVisible = data.length;
  let countEntradas = data.filter(e => e._entradaHoy).length;
  let countSalidas = data.filter(e => e._salidaHoy).length;
  let countAlmPlanta = data.reduce((acc, e) => {
    if (e.isVisitante) return acc + (parseInt(e.cantidad, 10) || 1);
    const esPresenteOAlm = e._entradaHoy || (typeof esEmpleadoSoloAlmuerzo === 'function' && esEmpleadoSoloAlmuerzo(e)) || e.isSinAsistencia;
    if (esPresenteOAlm && (e._almuerzoHoy === 'SI' || e._almuerzoHoy === 'PLANTA')) {
      return acc + 1;
    }
    return acc;
  }, 0);
  let countCampoVis = data.filter(e => {
    let modoStr = (e._modo || '').toUpperCase();
    return modoStr.includes('CAMPO') || (e.registros || []).some(r => r.modo === 'CAMPO' && r.fecha === hoy);
  }).length;
  let countExtrasAut = data.filter(e => {
    let extStr = (e._extras || '').toUpperCase();
    return extStr.includes('AUTORIZADO') || extStr.includes('CAMPO');
  }).length;

  const colDefs = {
    'Empleado': {
      header: `<th onclick="sortAsistencia('nombre')" style="cursor:pointer">Empleado <i class="fas fa-sort" style="opacity:.3;font-size:9px"></i></th>`,
      body: e => {
        const cantReg = (e._fechasRegularizar || []).length;
        const targetF = cantReg > 0 ? e._fechasRegularizar[0].fecha : '';
        const badgeReg = cantReg > 0
          ? `<button type="button" onclick="event.stopPropagation(); window.irADetalleFecha('${e.id}', '${targetF}')" title="${cantReg} fecha(s) por regularizar. Clic para ir directamente al registro del ${targetF}" style="background:#ffedd5; color:#c2410c; border:1px solid #fed7aa; border-radius:4px; padding:1px 5px; font-size:9px; font-weight:800; margin-left:5px; display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><i class="fas fa-calendar-times" style="font-size:8.5px;"></i> ${cantReg} pend.</button>`
          : '';
        return `<td><div class="employee-cell">${photoCell(e)}<div><strong>${escapeHtml(e.nombre)}</strong>${badgeReg}${e.id && !e.isVisitante ? `<div style="font-size:10px; color:#64748b; font-weight:600;"><i class="fas fa-id-badge" style="font-size:9px; color:#6366f1;"></i> ID: ${escapeHtml(e.id)}</div>` : ''}</div></div></td>`;
      },
      footer: `<td><strong>TOTALES (${totalVisible})</strong></td>`
    },
    'Área': {
      header: `<th>Área</th>`,
      body: e => `<td>${escapeHtml(e.area || '—')}</td>`,
      footer: `<td>—</td>`
    },
    'Regularización': {
      header: `<th>Fechas por Regularizar</th>`,
      body: e => {
        const list = e._fechasRegularizar || [];
        if (!list.length) return `<td style="text-align:center;"><span style="color:#94a3b8; font-size:11px;">Al día</span></td>`;
        const chips = list.slice(0, 3).map(f => `
          <button type="button" 
                  onclick="event.stopPropagation(); window.irADetalleFecha('${e.id}', '${f.fecha}')" 
                  class="btn-chip-regularizar-tabla" 
                  title="Clic para ir directamente a la fecha ${f.fecha} (${f.motivo}) en el detalle">
            <i class="fas fa-calendar-day" style="color: #ea580c; font-size: 9.5px;"></i>
            <span>${f.label}</span>
            <span style="background: #ffedd5; color: #c2410c; padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 700;">${f.motivo}</span>
          </button>
        `).join(' ');
        const mas = list.length > 3 
          ? `<button type="button" onclick="event.stopPropagation(); window.irADetalleFecha('${e.id}', '${list[3].fecha}')" class="btn-chip-regularizar-tabla" style="background:#fff7ed; color:#ea580c;" title="Ver ${list.length - 3} fechas más">+${list.length - 3} más</button>` 
          : '';
        return `<td><div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;"><button type="button" onclick="event.stopPropagation(); window.irADetalleFecha('${e.id}', '${list[0].fecha}')" class="pill warn" style="background:#ffedd5; color:#c2410c; font-weight:800; font-size:10px; border:1px solid #fed7aa; cursor:pointer;" title="Clic para ir a la primera fecha pendiente (${list[0].fecha})"><i class="fas fa-calendar-times"></i> ${list.length}</button> ${chips} ${mas}</div></td>`;
      },
      footer: `<td>${data.filter(e => (e._fechasRegularizar || []).length > 0).length} Colaboradores</td>`
    },
    'Entrada': {
      header: `<th>Entrada</th>`,
      body: e => `<td>${e._eH}</td>`,
      footer: `<td>${countEntradas} Entradas</td>`
    },
    'Salida': {
      header: `<th>Salida</th>`,
      body: e => `<td>${e._sH}</td>`,
      footer: `<td>${countSalidas} Salidas</td>`
    },
    'Modo': {
      header: `<th>Modo</th>`,
      body: e => `<td>${e._modo}</td>`,
      footer: `<td>${countCampoVis} Campo</td>`
    },
    'Extras': {
      header: `<th>Extras</th>`,
      body: e => `<td>${e._extras}</td>`,
      footer: `<td>${countExtrasAut} Aut.</td>`
    },
    'Estado': {
      header: `<th>Estado</th>`,
      body: e => `<td>${e._est}</td>`,
      footer: `<td>—</td>`
    },
    'Razón Ausencia': {
      header: `<th>Razón Ausencia</th>`,
      body: e => `<td>${e._ausencia}</td>`,
      footer: `<td>—</td>`
    },
    'Almuerzo': {
      header: `<th>Almuerzo</th>`,
      body: e => `<td>${e._toggle}</td>`,
      footer: `<td>${countAlmPlanta} Planta</td>`
    }
  };

  const activeColsMap = {
    'todos': ['Empleado', 'Área', 'Entrada', 'Salida', 'Modo', 'Extras', 'Estado', 'Razón Ausencia', 'Almuerzo'],
    'presente': ['Empleado', 'Área', 'Entrada', 'Modo', 'Extras', 'Estado', 'Almuerzo'],
    'sin_marcar': ['Empleado', 'Área', 'Estado', 'Razón Ausencia', 'Almuerzo'],
    'en_campo': ['Empleado', 'Área', 'Entrada', 'Salida', 'Modo', 'Extras', 'Estado', 'Almuerzo'],
    'vacaciones': ['Empleado', 'Área', 'Estado', 'Razón Ausencia'],
    'permisos': ['Empleado', 'Área', 'Estado', 'Razón Ausencia', 'Almuerzo'],
    'por_regularizar': ['Empleado', 'Área', 'Regularización', 'Entrada', 'Salida', 'Estado', 'Almuerzo'],
    'ausente': ['Empleado', 'Área', 'Estado', 'Razón Ausencia', 'Almuerzo'],
    'tardanza': ['Empleado', 'Área', 'Entrada', 'Modo', 'Extras', 'Estado', 'Almuerzo'],
    'almuerzo_si': ['Empleado', 'Área', 'Estado', 'Almuerzo'],
    'almuerzo_no': ['Empleado', 'Área', 'Estado', 'Almuerzo'],
    'salieron': ['Empleado', 'Área', 'Salida', 'Modo', 'Extras', 'Estado', 'Almuerzo'],
    'sin_salida': ['Empleado', 'Área', 'Entrada', 'Salida', 'Modo', 'Extras', 'Estado', 'Almuerzo']
  };

  const activeCols = activeColsMap[filtroAsistenciaActual] || activeColsMap['todos'];

  let headersHtml = activeCols.map(c => colDefs[c].header).join('');
  let html = `<table class="employee-table table-compact"><thead><tr>${headersHtml}</tr></thead><tbody>`;

  html += data.map(e => {
    let cellsHtml = activeCols.map(c => colDefs[c].body(e)).join('');
    const targetFecha = (e._fechasRegularizar && e._fechasRegularizar.length > 0) ? e._fechasRegularizar[0].fecha : '';
    const clickHandler = (filtroAsistenciaActual === 'por_regularizar' && targetFecha)
      ? `window.irADetalleFecha('${e.id}', '${targetFecha}')`
      : `mostrarDetalle('${e.id}')`;
    return `<tr onclick="${clickHandler}" style="cursor:pointer;">${cellsHtml}</tr>`;
  }).join('');

  let footerCellsHtml = activeCols.map(c => colDefs[c].footer).join('');
  let footerHtml = `<tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid var(--g300); position:sticky; bottom:0; z-index:10;">${footerCellsHtml}</tr>`;

  html += `</tbody><tfoot>${footerHtml}</tfoot></table>`;
  $('asistenciaTablaContainer').innerHTML = html;
}

window.guardarRazonAusenciaGlobal = async function (empleadoId, valorSeleccionado) {
  if (!valorSeleccionado) return;
  let razonFinal = valorSeleccionado;
  if (valorSeleccionado === 'Otro') {
    let otra = prompt("Ingrese la razón de la ausencia:");
    if (!otra) {
      cargarAsistencia(); // Refresh UI if cancelled
      return;
    }
    razonFinal = otra;
  }

  const mappedTipo = mapRazonAusenciaATipo(razonFinal);

  // OPTIMISTIC UPDATE
  const emp = empCache.find(x => x.id === empleadoId);
  let originalRegs = null;
  if (emp) {
    originalRegs = JSON.parse(JSON.stringify(emp.registros || []));
    if (!emp.registros) emp.registros = [];
    let fReg = emp.registros.find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === hoy;
    });
    if (!fReg) {
      fReg = {
        id: `${empleadoId}_${mappedTipo}_${hoy}`,
        empleadoId: empleadoId,
        tipo: mappedTipo,
        fecha: hoy,
        razon_ausencia: razonFinal
      };
      emp.registros.push(fReg);
    } else {
      fReg.tipo = mappedTipo;
      fReg.razon_ausencia = razonFinal;
    }
    cargarAsistencia(); // Update UI instantly
  }

  const bgSync = $('bgSyncIndicator');
  if (bgSync) bgSync.classList.remove('hidden');
  try {
    const res = await jsonpRequest({
      accion: 'guardarRegistro',
      id: empleadoId,
      tipo: mappedTipo,
      fecha_falta: hoy,
      razon_ausencia: razonFinal
    });
    if (res.ok) {
      mostrarToast('Razón de ausencia guardada', 'success');
      // Silent background reload to keep in sync
      limpiarCachesLocales();
      cargarDatosCompletos(true, true).then(() => {
        cargarAsistencia();
      }).catch(err => console.error("Error al recargar datos en segundo plano:", err));
    } else {
      mostrarToast(res.error || 'Error al guardar', 'error');
      // Revert optimistic update
      if (emp && originalRegs) {
        emp.registros = originalRegs;
        cargarAsistencia();
      }
    }
  } catch (e) {
    mostrarToast('Error de conexión', 'error');
    // Revert optimistic update
    if (emp && originalRegs) {
      emp.registros = originalRegs;
      cargarAsistencia();
    }
  } finally {
    if (bgSync) bgSync.classList.add('hidden');
  }
};

window.guardarRazonAusenciaFecha = async function (empleadoId, fecha, valorSeleccionado) {
  let sessionData = {};
  try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  const supervisorId = String(sessionData.id || '');
  const AUTORIZADOS = ['7', '1058'];
  if (!AUTORIZADOS.includes(supervisorId)) {
    if (typeof mostrarToast === 'function') mostrarToast('No autorizado para modificar razones de ausencia.', 'error');
    return;
  }

  let razonFinal = valorSeleccionado;
  if (valorSeleccionado === 'Otro') {
    let otra = prompt("Ingrese la razón de la ausencia:");
    if (!otra) {
      const idxSel = parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0');
      mostrarDetalle(empleadoId, idxSel);
      return;
    }
    razonFinal = otra;
  }

  const mappedTipo = mapRazonAusenciaATipo(razonFinal);

  // Optimistic update of local cache
  const emp = empCache.find(x => x.id === empleadoId);
  let originalRegs = null;
  if (emp) {
    originalRegs = JSON.parse(JSON.stringify(emp.registros || []));
    if (!emp.registros) emp.registros = [];
    let fReg = emp.registros.find(r => {
      const t = String(r.tipo).toUpperCase();
      return t !== 'ENTRADA' && t !== 'SALIDA' && t !== 'ESTADO' && t !== 'SOLO_ALMUERZO' && r.fecha === fecha;
    });
    if (!fReg) {
      fReg = {
        id: `${empleadoId}_${mappedTipo}_${fecha}_000000`,
        empleadoId: empleadoId,
        tipo: mappedTipo,
        fecha: fecha,
        razon_ausencia: razonFinal
      };
      emp.registros.push(fReg);
    } else {
      fReg.tipo = mappedTipo;
      fReg.razon_ausencia = razonFinal;
    }
    // Force refresh the detail view with current period selection
    const idxSel = parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0');
    mostrarDetalle(empleadoId, idxSel);
  }

  const bgSync = $('bgSyncIndicator');
  if (bgSync) bgSync.classList.remove('hidden');
  try {
    let res;
    if (window.FirebaseBackend && window.FirebaseBackend.guardarRegistro) {
      res = await window.FirebaseBackend.guardarRegistro({
        id: empleadoId,
        tipo: mappedTipo,
        fecha_falta: fecha,
        razon_ausencia: razonFinal
      });
    } else {
      res = await jsonpRequest({
        accion: 'guardarRegistro',
        id: empleadoId,
        tipo: mappedTipo,
        fecha_falta: fecha,
        razon_ausencia: razonFinal
      });
    }

    if (res && (res.ok || !res.error)) {
      if (typeof mostrarToast === 'function') mostrarToast('Razón de ausencia guardada con éxito', 'success');
      // Reload in background to keep data in sync
      limpiarCachesLocales();
      cargarDatosCompletos(true, true).then(() => {
        const idxSel = parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0');
        mostrarDetalle(empleadoId, idxSel);
      }).catch(err => console.error("Error al recargar datos:", err));
    } else {
      if (typeof mostrarToast === 'function') mostrarToast(res?.error || 'Error al guardar razón', 'error');
      // Revert optimistic update
      if (emp && originalRegs) {
        emp.registros = originalRegs;
        const idxSel = parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0');
        mostrarDetalle(empleadoId, idxSel);
      }
    }
  } catch (e) {
    if (typeof mostrarToast === 'function') mostrarToast('Error de conexión al guardar razón', 'error');
    if (emp && originalRegs) {
      emp.registros = originalRegs;
      const idxSel = parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0');
      mostrarDetalle(empleadoId, idxSel);
    }
  } finally {
    if (bgSync) bgSync.classList.add('hidden');
  }
};

let _sortAsisDir = 'asc';
function sortAsistencia(campo) {
  _sortAsisDir = _sortAsisDir === 'asc' ? 'desc' : 'asc';
  empCache.sort((a, b) => {
    let cmp = (a[campo] || '').localeCompare(b[campo] || '', 'es', { sensitivity: 'base' });
    return _sortAsisDir === 'asc' ? cmp : -cmp;
  });
  cargarAsistencia();
}

// ============================================================
// GESTOR DE COLUMNAS VISIBLES
// ============================================================
const COLUMNAS_DISPONIBLES = [
  { id: 'area', label: 'Área', tipo: 'texto' },
  { id: 'asistencias', label: 'Asistencias', tipo: 'numero' },
  { id: 'faltas', label: 'Faltas', tipo: 'numero' },
  { id: 'atrasos', label: 'Nº Atrasos', tipo: 'numero' },
  { id: 'minutosAtrasos', label: 'Total Tiempo Atrasos', tipo: 'tiempo' },
  { id: 'almPlanta', label: 'Almuerzos en Planta', tipo: 'numero' },
  { id: 'almFuera', label: 'Almuerzos Fuera', tipo: 'numero' },
  { id: 'puntualidad', label: 'Puntualidad', tipo: 'pct' },
  { id: 'permisoMedico', label: 'Permiso Médico', tipo: 'tiempo' },
  { id: 'permisoPersonal', label: 'Permiso Personal', tipo: 'tiempo' },
  { id: 'tiempoPorJustificar', label: 'Tiempo por Justificar', tipo: 'tiempo' },
  { id: 'tiempoADescontar', label: 'Tiempo a Descontar', tipo: 'tiempo' },
  { id: 'horasExtra50', label: 'Horas Extra 50% (A)', tipo: 'tiempo' },
  { id: 'horasExtra100', label: 'Horas Extra 100% (B)', tipo: 'tiempo' },
  { id: 'horasCampoNormales', label: 'Horas Campo Normales', tipo: 'tiempo' },
  { id: 'horasCampo50', label: 'Horas Campo 50% (C)', tipo: 'tiempo' },
  { id: 'horasCampo100', label: 'Horas Campo 100% (D)', tipo: 'tiempo' },
  { id: 'totalExtras50', label: 'Total Extras 50% (A+C)', tipo: 'tiempo' },
  { id: 'totalExtras100', label: 'Total Extras 100% (B+D)', tipo: 'tiempo' }
];

function obtenerColumnasVisibles() {
  const saved = localStorage.getItem('columnasVisiblesReporte_v2');
  if (saved) {
    return JSON.parse(saved);
  }
  return COLUMNAS_DISPONIBLES.map(c => c.id);
}

function guardarColumnasVisibles(columnas) {
  localStorage.setItem('columnasVisiblesReporte_v2', JSON.stringify(columnas));
}

function renderizadorSelectorColumnas() {
  const columnasVisibles = obtenerColumnasVisibles();
  const allChecked = COLUMNAS_DISPONIBLES.every(col => columnasVisibles.includes(col.id));

  let html = '';
  html += '<div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;width:100%;font-size:11.5px;color:var(--g700);border-bottom:1px solid var(--g100);padding-bottom:6px;">';
  html += '<span>Configurar Columnas</span>';
  html += `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;color:var(--red);"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleTodasLasColumnas(this.checked)" style="cursor:pointer"> Todo</label>`;
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:4px">';

  COLUMNAS_DISPONIBLES.forEach(col => {
    const isChecked = columnasVisibles.includes(col.id);
    html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:all .2s;background:${isChecked ? 'var(--red-lt)' : 'transparent'};border:1px solid ${isChecked ? 'var(--red)' : 'transparent'}">`;
    html += `<input type="checkbox" ${isChecked ? 'checked' : ''} onchange="cambiarVisibilidadColumna('${col.id}')" style="cursor:pointer">`;
    html += `<span style="font-size:11px;font-weight:500;color:${isChecked ? 'var(--red)' : 'var(--g600)'}">${col.label}</span>`;
    html += `</label>`;
  });

  html += '</div>';
  return html;
}

window.toggleTodasLasColumnas = function (checked) {
  let columnas = [];
  if (checked) {
    columnas = COLUMNAS_DISPONIBLES.map(c => c.id);
  }
  guardarColumnasVisibles(columnas);
  filtrarTablaReportes();
};

function cambiarVisibilidadColumna(colId) {
  let columnasVisibles = obtenerColumnasVisibles();
  const idx = columnasVisibles.indexOf(colId);
  if (idx > -1) {
    columnasVisibles.splice(idx, 1);
  } else {
    columnasVisibles.push(colId);
  }
  guardarColumnasVisibles(columnasVisibles);
  filtrarTablaReportes();
}

function sortarTablaReportes(colId) {
  if (_sortReportes.col === colId) {
    _sortReportes.dir = _sortReportes.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortReportes.col = colId;
    _sortReportes.dir = 'asc';
  }
  filtrarTablaReportes();
}

// ============================================================
// REPORTES - CÁLCULOS COMPLETOS
// ============================================================
function cargarReportes() {
  let periodo = periodos[parseInt($('periodoMensual')?.value || 0)];
  if (!periodo || (!empCache.length && !window.empEliminadosCache?.length)) return;

  const hoyRep = getLocalHoyStr();
  const fechaInicio = $('filtroFechaReportesInicio')?.value;
  const fechaFin = $('filtroFechaReportesFinalizacion')?.value;
  const R_INI = fechaInicio ? fechaInicio : periodo.inicio;
  const R_FIN = fechaFin ? fechaFin : periodo.fin;

  const incluirEliminados = $('chkIncluirEliminadosRep')?.checked || false;
  let listaEmpleados = [...empCache];
  if (incluirEliminados && window.empEliminadosCache && window.empEliminadosCache.length > 0) {
    listaEmpleados = listaEmpleados.concat(window.empEliminadosCache);
  }

  let stats = listaEmpleados.map(e => {
    let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= R_INI && r.fecha <= R_FIN);
    let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= R_INI && r.fecha <= R_FIN);
    // Días laborables solo hasta hoy (no días futuros del período)
    let diasLaborablesTotal = obtenerDiasHabiles(R_INI, R_FIN);
    let diasLaborables = diasLaborablesTotal.filter(d => d <= hoyRep);
    let diasAsistidos = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f)).size;

    // FALTAS: días hábiles transcurridos menos días asistidos
    let faltas = Math.max(0, diasLaborables.length - diasAsistidos);

    // ATRASOS + ALMUERZO + PUNTUALIDAD (atrasos se calculan y descuentan dentro del loop diario abajo)
    let atrasos = 0;
    let minutosAtrasos = 0;
    let almPlanta = 0, almFuera = 0;

    const resAlm = calcularAlmuerzosPeriodo(e, R_INI, R_FIN);
    almPlanta = resAlm.almPlanta;
    almFuera = resAlm.almFuera;
    let puntualidad = 0;

    // HORAS EXTRAS Y CAMPO LOGIC
    let horasExtra50 = 0;
    let horasExtra100 = 0;
    let horasCampoNormales = 0;
    let horasCampo50 = 0;
    let horasCampo100 = 0;

    let totalTiempoPersonal = 0;
    let totalTiempoMedico = 0;
    let totalTiempoPorJustificar = 0;
    let totalDescuentoBruto = 0;

    // Generar lista de todas las fechas en el rango R_INI a R_FIN
    let todasLasFechas = [];
    let currDate = new Date(R_INI + 'T00:00:00');
    let endDate = new Date(R_FIN + 'T00:00:00');
    while (currDate <= endDate) {
      todasLasFechas.push(currDate.toISOString().split('T')[0]);
      currDate.setDate(currDate.getDate() + 1);
    }

    todasLasFechas.forEach(fecha => {
      const regsDia = (e.registros || []).filter(r => r.fecha === fecha);
      const esFestivo = esFeriadoODomingo(fecha) || (new Date(fecha + 'T12:00:00').getDay() === 6);
      const isJustificado = regsDia.some(r => {
        if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) return true;
        if (r.razon_ausencia && String(r.razon_ausencia).trim() !== '' && String(r.razon_ausencia).trim() !== '—') return true;
        const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
        if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'RETORNO_CAMPO', 'SALIDA_CAMPO'].includes(tipo)) return true;
        return false;
      });
      const esHoyOFuturo = fecha >= getLocalHoyStr();

      if (regsDia.length === 0) {
        return;
      }

      let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO' || String(r.tipo || '').toUpperCase() === 'ENTRADA_CAMPO');
      let atrasoMinsHoy = 0;
      if (primerReg) {
        let mE = obtenerMinutos(primerReg.hora || primerReg.timestamp);
        let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
        if (mE !== null && mE > refEntrada + 5) {
          atrasoMinsHoy = mE - refEntrada;
        }
      }

      let periodosDia = [];
      let entradaPendiente = null;

      let sortedRegs = [...regsDia].sort((a, b) => {
        if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
        return String(a.hora || '').localeCompare(String(b.hora || ''));
      });

      sortedRegs.forEach(r => {
        const tipo = String(r.tipo || '').toUpperCase();
        if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO' || tipo === 'ENTRADA_CAMPO') {
          entradaPendiente = r;
        } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
          if (entradaPendiente) {
            periodosDia.push({ entrada: entradaPendiente, salida: r });
            entradaPendiente = null;
          } else {
            periodosDia.push({ entrada: null, salida: r });
          }
        }
      });
      if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });

      let minutosTrabajadosHoy = 0;
      let tiempoPersonalHoy = 0;
      let tiempoMedicoHoy = 0;
      let tiempoJustificarHoy = 0;

      const hasCumpleanos = regsDia.some(r => {
        const raz = String(r.razon_ausencia || '').toLowerCase();
        const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
        return raz.includes('cumplea') || raz.includes('cumplean') || tip.includes('CUMPLE');
      });

      let ultimoSalidaMins = null;
      let ultimoSalidaReg = null;
      let processedLunchGap = false;

      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;

        let duracion = mS - mE;
        minutosTrabajadosHoy += duracion;

        if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
          let gap = mE - ultimoSalidaMins;
          if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
            let lunchMins = Math.min(45, gap);
            gap -= lunchMins;
            processedLunchGap = true;
          }
          if (gap > 0) {
            let clasif = clasificarGap(ultimoSalidaReg, gap);
            if (clasif.tipo === 'medico') {
              tiempoMedicoHoy += gap;
            } else if (clasif.tipo === 'personal') {
              tiempoPersonalHoy += gap;
            } else {
              tiempoJustificarHoy += gap;
            }
          }
        }
        ultimoSalidaMins = mS;
        ultimoSalidaReg = p.salida;
      });

      let netWorked = minutosTrabajadosHoy;
      if (!esFestivo && netWorked > 240) netWorked -= 45;

      // Auto-autorización de horas extras
      let autorizado = regsDia.some(r => r.horasExtra === 'SI');
      if (esFestivo) {
        if (netWorked > 60) autorizado = true;
        if (netWorked <= 60) autorizado = false;
      } else {
        if (netWorked >= 600) autorizado = true;
        if (netWorked - 480 <= 60) autorizado = false;
      }

      let extraMins50Acum = 0;

      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;
        let duracion = mS - mE;
        let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

        if (esFestivo) {
          if (enCampo) {
            if (autorizado) horasCampo100 += duracion;
          } else {
            if (autorizado) horasExtra100 += duracion;
          }
        } else {
          let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
          if (enCampo) {
            if (mS <= H_INI || mE >= H_FIN) {
              horasCampo50 += duracion;
            } else {
              let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
              let mExtra = duracion - mNormal;
              horasCampoNormales += mNormal;
              horasCampo50 += mExtra;
            }
          } else {
            if (autorizado && mS > H_FIN) {
              extraMins50Acum += (mS - Math.max(mE, H_FIN));
            }
          }
        }
      });

      if (esFestivo) {
        // Ya calculados
      } else {
        horasExtra50 += extraMins50Acum;
      }

      // Sumar permisos asignados manualmente
      const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
      const persMins = regPermiso ? Number(regPermiso.permiso_personal_mins || 0) : 0;
      const medMins = regPermiso ? Number(regPermiso.permiso_medico_mins || 0) : 0;
      const justMins = regPermiso ? Number(regPermiso.tiempo_justificado_mins || 0) : 0;
      tiempoPersonalHoy += persMins;
      tiempoMedicoHoy += medMins;
      let tiempoJustificadoHoy = justMins + (hasCumpleanos ? 240 : 0);

      if (isJustificado || esHoyOFuturo) {
        tiempoJustificarHoy = 0;
      } else {
        let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
        let totalPermisosHoy = tiempoPersonalHoy + tiempoMedicoHoy + tiempoJustificarHoy;
        let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
        tiempoJustificarHoy += unaccountedMissing;
        tiempoJustificarHoy = Math.max(0, tiempoJustificarHoy - tiempoJustificadoHoy);
      }

      // Ajustar atrasos del día descontando permisos del día
      atrasoMinsHoy = Math.max(0, atrasoMinsHoy - tiempoPersonalHoy - tiempoMedicoHoy - tiempoJustificadoHoy);
      if (atrasoMinsHoy > 0) {
        atrasos++;
        minutosAtrasos += atrasoMinsHoy;
      }

      let descuentoBrutoHoy = tiempoPersonalHoy + (tiempoJustificarHoy > 0 ? Math.max(tiempoJustificarHoy, atrasoMinsHoy) : atrasoMinsHoy);
      totalDescuentoBruto += descuentoBrutoHoy;

      totalTiempoPersonal += tiempoPersonalHoy;
      totalTiempoMedico += tiempoMedicoHoy;
      totalTiempoPorJustificar += tiempoJustificarHoy;
    });

    puntualidad = diasAsistidos ? Math.round((1 - atrasos / diasAsistidos) * 100) : 0;

    return {
      id: e.id,
      nombre: e.nombre,
      area: e.area,
      cargo: e.cargo || '',
      esEliminado: !!e.esEliminado,
      foto_url: e.foto_url,
      asistencias: diasAsistidos,
      faltas: faltas,
      permisoMedico: totalTiempoMedico,
      permisoPersonal: totalTiempoPersonal,
      tiempoPorJustificar: totalTiempoPorJustificar,
      tiempoADescontar: Math.max(0, totalDescuentoBruto - 240),
      atrasos: atrasos,
      minutosAtrasos: minutosAtrasos,
      almPlanta: almPlanta,
      almFuera: almFuera,
      puntualidad: puntualidad,
      horasExtra50: horasExtra50,
      horasExtra100: horasExtra100,
      horasCampoNormales: horasCampoNormales,
      horasCampo50: horasCampo50,
      horasCampo100: horasCampo100,
      totalExtras50: horasExtra50 + horasCampo50,
      totalExtras100: horasExtra100 + horasCampo100,
      totalHorasExtra: (horasExtra50 + horasExtra100 + horasCampo50 + horasCampo100)
    };
  });

  // Totales generales
  let totalFaltas = stats.reduce((s, r) => s + r.faltas, 0);
  let totalPermisoMedico = stats.reduce((s, r) => s + r.permisoMedico, 0);
  let totalPermisoPersonal = stats.reduce((s, r) => s + r.permisoPersonal, 0);
  let totalAtrasos = stats.reduce((s, r) => s + r.atrasos, 0);
  let totalTiempoPorJustificar = stats.reduce((s, r) => s + r.tiempoPorJustificar, 0);
  let totalTiempoADescontar = stats.reduce((s, r) => s + r.tiempoADescontar, 0);
  let totalHorasExtra50 = stats.reduce((s, r) => s + r.horasExtra50, 0);
  let totalHorasExtra100 = stats.reduce((s, r) => s + r.horasExtra100, 0);
  let totalHorasCampoNormales = stats.reduce((s, r) => s + r.horasCampoNormales, 0);
  let totalHorasCampo50 = stats.reduce((s, r) => s + r.horasCampo50, 0);
  let totalHorasCampo100 = stats.reduce((s, r) => s + r.horasCampo100, 0);
  let totalExtras50 = stats.reduce((s, r) => s + r.totalExtras50, 0);
  let totalExtras100 = stats.reduce((s, r) => s + r.totalExtras100, 0);
  let totalHorasExtra = stats.reduce((s, r) => s + r.totalHorasExtra, 0);

  $('repFaltas').textContent = totalFaltas;
  $('repPermisoMedico').textContent = formatearMinutos(totalPermisoMedico);
  $('repPermisoPersonal').textContent = formatearMinutos(totalPermisoPersonal);
  $('repAtrasos').textContent = totalAtrasos;
  if ($('repTiempoPorJustificar')) {
    $('repTiempoPorJustificar').textContent = formatearMinutos(totalTiempoPorJustificar);
  }
  if ($('repTiempoADescontar')) {
    $('repTiempoADescontar').textContent = formatearMinutos(totalTiempoADescontar);
  }
  $('repHorasExtra50').textContent = formatearHorasDecimal(totalHorasExtra50);
  $('repHorasExtra100').textContent = formatearHorasDecimal(totalHorasExtra100);
  $('repHorasCampoNormales').textContent = formatearHorasDecimal(totalHorasCampoNormales);
  $('repHorasCampo50').textContent = formatearHorasDecimal(totalHorasCampo50);
  $('repHorasCampo100').textContent = formatearHorasDecimal(totalHorasCampo100);
  $('repTotalExtras50').textContent = formatearHorasDecimal(totalExtras50);
  $('repTotalExtras100').textContent = formatearHorasDecimal(totalExtras100);
  $('repTotalHorasExtra').textContent = formatearHorasDecimal(totalHorasExtra);

  // Almuerzos reporte
  let totalAlmPlanta = stats.reduce((s, r) => s + r.almPlanta, 0);
  let totalAlmFuera = stats.reduce((s, r) => s + r.almFuera, 0);
  let extrasPeriodo = window.obtenerAlmuerzosExtraConsolidados(R_INI, R_FIN);
  let totalAlmExt = extrasPeriodo.reduce((acc, ae) => acc + (parseInt(ae.cantidad, 10) || 1), 0);
  let totalAlmLunch = totalAlmPlanta + totalAlmExt;

  if ($('repAlmuerzosEmp')) $('repAlmuerzosEmp').textContent = totalAlmPlanta;
  if ($('repAlmuerzosExt')) $('repAlmuerzosExt').textContent = totalAlmExt;
  if ($('repAlmuerzosTotal')) $('repAlmuerzosTotal').textContent = totalAlmLunch;
  if ($('repAlmuerzosFuera')) $('repAlmuerzosFuera').textContent = totalAlmFuera;

  window._reportesData = stats;
  // Cargar preferencias de columnas al cargar datos
  if (!localStorage.getItem('columnasVisiblesReporte_v2')) {
    guardarColumnasVisibles(COLUMNAS_DISPONIBLES.map(c => c.id));
  }
  filtrarTablaReportes();
}

window.cargarReportesConFiltroFecha = function () {
  const inputFecha = $('filtroFechaReportes');
  const inputFechaDash = $('filtroFechaDashboard');
  const btnLimpiar = $('btnLimpiarFechaRep');
  const btnLimpiarDash = $('btnLimpiarFechaDash');

  const hasValue = (inputFecha && inputFecha.value) || (inputFechaDash && inputFechaDash.value);
  if (hasValue) {
    if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
    if (btnLimpiarDash) btnLimpiarDash.style.display = 'inline-block';
  } else {
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    if (btnLimpiarDash) btnLimpiarDash.style.display = 'none';
  }
  cargarReportes();
  if (typeof actualizarReporteInteractivo === 'function') {
    actualizarReporteInteractivo();
  }
};

window.limpiarFiltroRangoFechasReportes = function () {
  const inputFechaInicio = $('filtroFechaReportesInicio');
  const inputFechaFin = $('filtroFechaReportesFinalizacion');
  const inputFechaDash = $('filtroFechaDashboard');
  const btnLimpiar = $('btnLimpiarFechaRep');
  const btnLimpiarDash = $('btnLimpiarFechaDash');

  if (inputFechaInicio) inputFechaInicio.value = '';
  if (inputFechaFin) inputFechaFin.value = '';
  if (inputFechaDash) inputFechaDash.value = '';
  if (btnLimpiar) btnLimpiar.style.display = 'none';
  if (btnLimpiarDash) btnLimpiarDash.style.display = 'none';

  cargarReportes();
  if (typeof actualizarReporteInteractivo === 'function') {
    actualizarReporteInteractivo();
  }
};

window.filtrarReportePorRangoFechas = function () {
  const fechaInicio = $('filtroFechaReportesInicio')?.value;
  const fechaFin = $('filtroFechaReportesFinalizacion')?.value;
  const btnLimpiar = $('btnLimpiarFechaRep');

  if (fechaInicio || fechaFin) {
    if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
  } else {
    if (btnLimpiar) btnLimpiar.style.display = 'none';
  }

  cargarReportes();
  if (typeof actualizarReporteInteractivo === 'function') {
    actualizarReporteInteractivo();
  }
};

window.syncPeriodo = function (source) {
  let val;
  if (source === 'dash') {
    val = $('periodoMensualDash')?.value;
  } else if (source === 'kpi') {
    val = $('kpiDetallePeriodo')?.value;
  } else {
    val = $('periodoMensual')?.value;
  }
  if (val !== undefined) {
    if ($('periodoMensual')) $('periodoMensual').value = val;
    if ($('periodoMensualDash')) $('periodoMensualDash').value = val;
    if ($('kpiDetallePeriodo')) $('kpiDetallePeriodo').value = val;
  }
  cargarResumenMensual();
  if (typeof window.renderDetailedKPIs === 'function') {
    window.renderDetailedKPIs();
  }
};

window.syncFecha = function (source) {
  if (source === 'dash') {
    const val = $('filtroFechaDashboard')?.value;
    const inpRep = $('filtroFechaReportes');
    if (inpRep && val !== undefined) {
      inpRep.value = val;
    }

    const btnLimpiarRep = $('btnLimpiarFechaRep');
    const btnLimpiarDash = $('btnLimpiarFechaDash');
    if (val) {
      if (btnLimpiarRep) btnLimpiarRep.style.display = 'inline-block';
      if (btnLimpiarDash) btnLimpiarDash.style.display = 'inline-block';
    } else {
      if (btnLimpiarRep) btnLimpiarRep.style.display = 'none';
      if (btnLimpiarDash) btnLimpiarDash.style.display = 'none';
    }
  } else {
    const val = $('filtroFechaReportes')?.value;
    const inpDash = $('filtroFechaDashboard');
    if (inpDash && val !== undefined) {
      inpDash.value = val;
    }

    const btnLimpiarRep = $('btnLimpiarFechaRep');
    const btnLimpiarDash = $('btnLimpiarFechaDash');
    if (val) {
      if (btnLimpiarRep) btnLimpiarRep.style.display = 'inline-block';
      if (btnLimpiarDash) btnLimpiarDash.style.display = 'inline-block';
    } else {
      if (btnLimpiarRep) btnLimpiarRep.style.display = 'none';
      if (btnLimpiarDash) btnLimpiarDash.style.display = 'none';
    }
  }
  cargarReportesConFiltroFecha();
};

window.limpiarFiltroFechaDashboard = function () {
  const inpDash = $('filtroFechaDashboard');
  const inpRep = $('filtroFechaReportes');
  if (inpDash) inpDash.value = '';
  if (inpRep) inpRep.value = '';

  const btnLimpiarRep = $('btnLimpiarFechaRep');
  const btnLimpiarDash = $('btnLimpiarFechaDash');
  if (btnLimpiarRep) btnLimpiarRep.style.display = 'none';
  if (btnLimpiarDash) btnLimpiarDash.style.display = 'none';

  cargarReportesConFiltroFecha();
};

function filtrarTablaReportes() {
  if (!$('tablaReportes')) return;
  let q = ($('searchReportes')?.value || '').toLowerCase();
  let data = (window._reportesData || []).filter(e => !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q));
  const columnasVisibles = obtenerColumnasVisibles();

  if (!data.length) {
    $('tablaReportes').innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando datos...</p></div>';
    return;
  }

  // Aplicar orden
  if (_sortReportes.col) {
    data = [...data].sort((a, b) => {
      let va = a[_sortReportes.col] ?? 0;
      let vb = b[_sortReportes.col] ?? 0;
      if (typeof va === 'string') return _sortReportes.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return _sortReportes.dir === 'asc' ? va - vb : vb - va;
    });
  }

  function sortIcon(colId) {
    if (_sortReportes.col !== colId) return '<i class="fas fa-sort" style="opacity:.2;margin-left:4px;font-size:9px"></i>';
    return _sortReportes.dir === 'asc'
      ? '<i class="fas fa-sort-up" style="color:var(--red);margin-left:4px;font-size:9px"></i>'
      : '<i class="fas fa-sort-down" style="color:var(--red);margin-left:4px;font-size:9px"></i>';
  }

  // Construir headers según columnas visibles
  let headerHtml = `<th onclick="sortarTablaReportes('nombre')">Empleado ${sortIcon('nombre')}</th>`;
  COLUMNAS_DISPONIBLES.forEach(col => {
    if (columnasVisibles.includes(col.id)) {
      if (col.id === 'area') {
        headerHtml += `<th onclick="sortarTablaReportes('area')">Área ${sortIcon('area')}</th>`;
      } else {
        headerHtml += `<th onclick="sortarTablaReportes('${col.id}')" style="text-align:center">${col.label} ${sortIcon(col.id)}</th>`;
      }
    }
  });

  let html = `<table class="employee-table table-compact"><thead><tr>${headerHtml}</tr></thead><tbody>`;

  html += data.map(e => {
    let rowHtml = `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<span>${escapeHtml(e.nombre)}</span></div></td>`;

    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasVisibles.includes(col.id)) {
        const valor = e[col.id];
        let contenido = '';
        if (col.id === 'area') {
          contenido = escapeHtml(valor || '—');
          rowHtml += `<td>${contenido}</td>`;
        } else {
          if (col.tipo === 'tiempo') {
            contenido = `<span style="font-family:'Fira Code',monospace;font-size:10px">${minutosAHHMMSS(valor)}</span>`;
          } else if (col.tipo === 'pct') {
            let pc = valor >= 90 ? 'ok' : valor >= 70 ? 'late' : 'miss';
            contenido = `<span class="pill ${pc}" style="font-size:10px;padding:2px 7px">${valor}%</span>`;
          } else if (col.id === 'faltas') {
            contenido = `<span class="pill ${valor > 0 ? 'miss' : 'ok'}" style="font-size:10px;padding:2px 7px">${valor}</span>`;
          } else if (col.id === 'atrasos') {
            contenido = `<span class="pill ${valor > 0 ? 'late' : 'ok'}" style="font-size:10px;padding:2px 7px">${valor}</span>`;
          } else if (col.id.startsWith('total') || col.id.startsWith('Total')) {
            contenido = `<strong style="font-family:'Fira Code',monospace;font-size:10px">${valor}</strong>`;
          } else {
            contenido = `<span style="font-family:'Fira Code',monospace;font-size:10px">${valor}</span>`;
          }
          rowHtml += `<td style="text-align:center">${contenido}</td>`;
        }
      }
    });

    rowHtml += '</tr>';
    return rowHtml;
  }).join('');

  html += '</tbody></table>';

  // Update dropdown columns list dynamically
  if ($('monthlyColsDropdown')) {
    $('monthlyColsDropdown').innerHTML = renderizadorSelectorColumnas();
  }

  let scrollHint = '<div class="scroll-hint"><i class="fas fa-arrows-alt-h"></i> Arrastra para desplazarte — clic en columna para ordenar</div>';
  $('tablaReportes').innerHTML = scrollHint + `<div class="table-scroll-wrap" id="reportesScrollWrap">${html}</div>`;

  // Sync double scrollbars
  const tableScroll = $('reportesScrollWrap');
  const topScroll = $('monthlyTopScroll');
  if (tableScroll && topScroll) {
    const dummy = topScroll.querySelector('.top-scroll-dummy');
    if (dummy) {
      setTimeout(() => {
        dummy.style.width = tableScroll.scrollWidth + 'px';
        topScroll.scrollLeft = tableScroll.scrollLeft;
      }, 50);
    }
  }

  // Drag-to-scroll con mouse
  const wrap = document.getElementById('reportesScrollWrap');
  if (wrap) {
    let isDown = false, startX, scrollLeft;
    wrap.addEventListener('mousedown', e => { isDown = true; startX = e.pageX - wrap.offsetLeft; scrollLeft = wrap.scrollLeft; });
    wrap.addEventListener('mouseleave', () => { isDown = false; });
    wrap.addEventListener('mouseup', () => { isDown = false; });
    wrap.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); const x = e.pageX - wrap.offsetLeft; wrap.scrollLeft = scrollLeft - (x - startX); });
  }
  if (typeof initScrollSync === 'function') {
    initScrollSync('monthlyTopScroll', 'reportesScrollWrap');
  }
}
let panelOrigenDetalle = 'asistencia';
function volverAAsistencia() {
  if (panelOrigenDetalle === 'directorio') {
    volverADirectorio();
  } else {
    cambiarPanel('asistencia');
    cargarAsistencia();
  }
}
window.volverAAsistencia = volverAAsistencia;

// ============================================================
// DETALLE
// ============================================================
async function mostrarDetalle(id, indexPeriodo = 0, customInicio = null, customFin = null, fechaEnfocar = null) {
  if (panelActual !== 'detalle') {
    panelOrigenDetalle = panelActual;
  }
  window.mostrarDetalle = mostrarDetalle;
  window.idDetalleActual = id;
  window.indexPeriodoDetalleActual = indexPeriodo;
  window.customInicioDetalleActual = customInicio;
  window.customFinDetalleActual = customFin;
  window.fechaEnfocarDetalleActual = fechaEnfocar || window.fechaEnfocarDetalleActual || null;
  const ADMIN_ID = "1058";
  let sessionData = {};
  try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }

  // Definir si es Administrador General usando la función esAdminMaster y la sesión actual
  const esMaster = (typeof window.esAdminMaster === 'function')
    ? window.esAdminMaster(sessionData)
    : (String(sessionData.id) === ADMIN_ID);
  window.isMaster = esMaster;

  let e = empCache.find(x => x.id === id);
  if (!e) return;

  // Cargar vacaciones del empleado en segundo plano para no demorar la visualización
  let vacacionesList = [];
  jsonpRequest({ accion: 'obtenerVacacionesEmpleado', empleadoId: id }).then(function (vacRes) {
    if (vacRes && !vacRes.error) {
      vacacionesList = vacRes.vacaciones || [];
      rebuildTable();
      actualizarCardVacaciones(vacRes.vacacionesTomadasHoy, vacRes.vacacionesRestantesHoy);
    }
  }).catch(err => {
    console.error("Error al precargar vacaciones en segundo plano:", err);
  });

  // Obtener el período seleccionado o el actual por defecto
  let periodoSeleccionado = periodos[indexPeriodo] || periodos[0];

  let R_INI = customInicio || (periodoSeleccionado ? periodoSeleccionado.inicio : '');
  let R_FIN = customFin || (periodoSeleccionado ? periodoSeleccionado.fin : '');

  // Filtrar registros al rango seleccionado normalizando fechas
  let todosRegs = (e.registros || []).map(r => {
    const fNorm = normalizarFechaStr(r.fecha);
    return fNorm ? { ...r, fecha: fNorm } : r;
  });
  let regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Cargar historial completo de registros archivados si es necesario (ej: periodos anteriores o rango personalizado)
  if (!e._historialCompletoCargado && (window.FirebaseBackend || typeof jsonpRequest === 'function')) {
    e._historialCompletoCargado = true;
    (async () => {
      try {
        let fullRegs = null;
        if (window.FirebaseBackend && window.USE_FIREBASE) {
          fullRegs = await window.FirebaseBackend.obtenerRegistros({ empleadoId: id, force: false, incluirArchivados: true });
        } else if (typeof jsonpRequest === 'function') {
          fullRegs = await jsonpRequest({ accion: 'obtenerRegistros', empleadoId: id, force: false, incluirArchivados: true });
        }
        if (Array.isArray(fullRegs) && fullRegs.length > 0) {
          const existingMap = new Map();
          (e.registros || []).forEach(r => {
            const fNorm = normalizarFechaStr(r.fecha) || r.fecha;
            existingMap.set(`${fNorm}_${(r.tipo || '').toUpperCase()}_${r.hora || ''}`, r);
          });
          let hasChanges = false;
          fullRegs.forEach(r => {
            const fNorm = normalizarFechaStr(r.fecha) || r.fecha;
            const k = `${fNorm}_${(r.tipo || '').toUpperCase()}_${r.hora || ''}`;
            const existing = existingMap.get(k);
            if (!existing) {
              if (!e.registros) e.registros = [];
              e.registros.push({ ...r, fecha: fNorm });
              existingMap.set(k, r);
              hasChanges = true;
            } else {
              if (r.permiso_personal_mins !== undefined && existing.permiso_personal_mins !== r.permiso_personal_mins) {
                existing.permiso_personal_mins = r.permiso_personal_mins;
                hasChanges = true;
              }
              if (r.permiso_medico_mins !== undefined && existing.permiso_medico_mins !== r.permiso_medico_mins) {
                existing.permiso_medico_mins = r.permiso_medico_mins;
                hasChanges = true;
              }
              if (r.tiempo_justificado_mins !== undefined && existing.tiempo_justificado_mins !== r.tiempo_justificado_mins) {
                existing.tiempo_justificado_mins = r.tiempo_justificado_mins;
                hasChanges = true;
              }
              if (r.razon_permiso && existing.razon_permiso !== r.razon_permiso) {
                existing.razon_permiso = r.razon_permiso;
                hasChanges = true;
              }
            }
          });
          if (hasChanges && window.idDetalleActual === id) {
            todosRegs = (e.registros || []).map(r => {
              const fNorm = normalizarFechaStr(r.fecha);
              return fNorm ? { ...r, fecha: fNorm } : r;
            });
            regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN)
              .sort((a, b) => b.fecha.localeCompare(a.fecha));
            rebuildTable();
          }
        }
      } catch (err) {
        console.warn("Aviso cargando registros históricos en segundo plano:", err);
      }
    })();
  }

  let entT = regs.filter(r => r.tipo === 'ENTRADA').length;
  let salT = regs.filter(r => r.tipo === 'SALIDA').length;
  const resAlm = calcularAlmuerzosPeriodo(e, R_INI, R_FIN);
  let almP = resAlm.almPlanta;
  let almF = resAlm.almFuera;
  let dias = new Set(regs.filter(r => r.tipo === 'ENTRADA').map(r => r.fecha)).size;

  let sE = 0, cE = 0, sS = 0, cS = 0, tardT = 0;
  regs.forEach(r => {
    let m = obtenerMinutos(r.hora);
    if (m === null) return;
    if (r.tipo === 'ENTRADA') {
      sE += m;
      cE++;
      const esFestivo = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
      const refEnt = esFestivo ? 420 : HORA_ENTRADA_REF;
      if (m > refEnt + 5) tardT++;
    }
    else { sS += m; cS++; }
  });
  let pE = cE ? Math.round(sE / cE) : null;
  let pS = cS ? Math.round(sS / cS) : null;

  let totTP = 0, totTM = 0, totTJ = 0, totHoras = 0, totAtrasos = 0;
  let thH = 0, thM = 0;

  function generarBannerRegularizarHTML(listaFechas) {
    if (!listaFechas || listaFechas.length === 0) {
      return `
        <div id="bannerFechasRegularizar" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 5px solid #16a34a; border-radius: 10px; padding: 7px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #166534; font-weight: 600;">
          <i class="fas fa-check-circle" style="color: #16a34a; font-size: 14px;"></i>
          <span>Asistencia al día: No hay fechas pendientes de regularizar en este período.</span>
        </div>`;
    }

    const chipsHtml = listaFechas.map(it => `
      <button type="button" onclick="window.enfocarFechaEnDetalle('${it.fecha}')" class="btn-chip-regularizar-detalle" style="background: #ffffff; border: 1.5px solid #f97316; color: #9a3412; padding: 4px 10px; border-radius: 7px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: all 0.15s ease;" title="Clic para ir directamente al registro del ${it.fecha}${it.minutos ? ' (' + it.minutos + ' min pendientes)' : ''}">
        <i class="fas fa-calendar-day" style="color: #ea580c; font-size: 11px;"></i>
        <span>${it.label}</span>
        <span style="background: #ffedd5; color: #c2410c; padding: 1px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; border: 1px solid #fed7aa;">${it.motivo}</span>
      </button>
    `).join('');

    return `
      <div id="bannerFechasRegularizar" style="background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border: 1.5px solid #fb923c; border-left: 5px solid #ea580c; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 2px 6px rgba(234,88,12,0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-calendar-times" style="color: #ea580c; font-size: 15px;"></i>
            <span style="font-weight: 800; font-size: 12.5px; color: #9a3412;">
              Fechas que deben regularizarse (${listaFechas.length}):
            </span>
          </div>
          <span style="font-size: 11px; color: #c2410c; font-weight: 600;">
            <i class="fas fa-hand-pointer"></i> Haz clic en una fecha para ir directamente a su fila en la tabla
          </span>
        </div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap; max-height: 120px; overflow-y: auto; padding: 2px;">
          ${chipsHtml}
        </div>
      </div>`;
  }

  function rebuildTable() {
    let porDia = {};
    // Asegurar que los registros estén ordenados cronológicamente para el emparejamiento
    [...regs].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return String(a.hora || '').localeCompare(String(b.hora || ''));
    }).forEach(r => {
      // Normalizar la fecha a YYYY-MM-DD para evitar fechas mal formateadas de Sheets
      const fechaNorm = normalizarFechaStr(r.fecha);
      if (!fechaNorm) return;
      if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
      porDia[fechaNorm].registros.push(r);
      if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
    });

    // Agregar las vacaciones al objeto porDia como registros virtuales de tipo VACACIONES
    vacacionesList.forEach(v => {
      const fNorm = normalizarFechaStr(v.fecha);
      if (!fNorm) return;
      if (fNorm >= R_INI && fNorm <= R_FIN) {
        if (!porDia[fNorm]) {
          porDia[fNorm] = { registros: [], almuerzo: null };
        }
        // Evitar duplicar si por alguna razón ya existe un registro de tipo VACACIONES o VACACION en ese día
        const yaExiste = porDia[fNorm].registros.some(r => r.tipo === 'VACACIONES' || r.tipo === 'VACACION');
        if (!yaExiste) {
          porDia[fNorm].registros.push({
            id: `${id}_VACACIONES_${fNorm}_000000`,
            empleadoId: id,
            tipo: 'VACACIONES',
            fecha: fNorm,
            razon_ausencia: 'Vacación',
            justificado: 'SI'
          });
        }
      }
    });

    // Asegurar que todos los días laborables del rango (desde fecha de ingreso hasta ayer) existan en porDia
    // CRÍTICO: Excluir hoy (fecha actual) de la inyección de inasistencias porque está en curso
    const hoyStrLocal = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0];
    const dHoy = new Date(hoyStrLocal + 'T12:00:00');
    dHoy.setDate(dHoy.getDate() - 1);
    const ayerStrLocal = dHoy.toISOString().split('T')[0];
    const limiteFinLocal = (R_FIN && R_FIN < ayerStrLocal) ? R_FIN : ayerStrLocal;

    let inicioEvalEmp = R_INI;
    if (e.fecha_ingreso && String(e.fecha_ingreso).trim().length >= 10) {
      const fi = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(e.fecha_ingreso) : String(e.fecha_ingreso).slice(0, 10);
      if (fi && fi > R_INI) inicioEvalEmp = fi;
    }
    if (inicioEvalEmp && limiteFinLocal && inicioEvalEmp <= limiteFinLocal) {
      const diasHabilesRango = (typeof obtenerDiasHabiles === 'function') ? obtenerDiasHabiles(inicioEvalEmp, limiteFinLocal) : [];
      diasHabilesRango.forEach(fHab => {
        if (!porDia[fHab]) {
          porDia[fHab] = { registros: [], almuerzo: null, faltaInasistencia: true };
        }
      });
    }

    // Ordenar de más reciente a más antiguo (YYYY-MM-DD → comparación de string correcta)
    let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => b.localeCompare(a));

    // Mostrar todos los días del período
    // Acumuladores para la fila de totales
    totTP = 0; totTM = 0; totTJustificado = 0; totTJ = 0; totHoras = 0; totAtrasos = 0;
    let totH50 = 0, totH100 = 0, totHCN = 0, totHC50 = 0, totHC100 = 0;
    let totExtra50 = 0, totExtra100 = 0;
    let totEmpresa = 0, totCampo = 0, totSalidaTemprana = 0;
    let totDescuentoBruto = 0;
    const esSuperPermiso = ['7', '1058'].includes(String(sessionData.id || ''));
    let fechasARegularizar = [];

    let filas = fechasOrdenadas.map(f => {
      let d = porDia[f];
      let regsDia = [...d.registros].sort((a, b) => {
        if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
        return String(a.hora || '').localeCompare(String(b.hora || ''));
      });
      const dayOfWeek = new Date(f + 'T12:00:00').getDay();
      const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
      const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
      const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

      const isJustificado = regsDia.some(r => {
        if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) return true;
        if (r.razon_ausencia && String(r.razon_ausencia).trim() !== '' && String(r.razon_ausencia).trim() !== '—') return true;
        const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
        if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'RETORNO_CAMPO', 'SALIDA_CAMPO', 'ENTRADA_CAMPO'].includes(tipo)) return true;
        return false;
      });

      const tieneAsistencia = regsDia.some(r => ['ENTRADA', 'SALIDA', 'RETORNO_CAMPO', 'SALIDA_CAMPO', 'ENTRADA_CAMPO'].includes(String(r.tipo || '').toUpperCase()));
      const esFalta = regsDia.some(r => esAusenciaTipo(r.tipo)) || !tieneAsistencia;

      let periodosDia = [];
      let entradaPendiente = null;
      let minutosPermisoHoy = 0;
      let ultimoSalidaMins = null, ultimoSalidaReg = null;

      regsDia.forEach(r => {
        const tipo = String(r.tipo || '').toUpperCase();
        if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO' || tipo === 'ENTRADA_CAMPO') {
          let mE = obtenerMinutos(r.hora);
          if (ultimoSalidaMins !== null && mE !== null && mE > ultimoSalidaMins) {
            minutosPermisoHoy += (mE - ultimoSalidaMins);
          }
          entradaPendiente = r;
        } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
          if (entradaPendiente) {
            periodosDia.push({ entrada: entradaPendiente, salida: r });
            ultimoSalidaMins = obtenerMinutos(r.hora);
            entradaPendiente = null;
          } else {
            periodosDia.push({ entrada: null, salida: r });
          }
        }
      });
      if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });
      if (periodosDia.length === 0) periodosDia.push({ entrada: null, salida: null });

      // Mostrar todos los tramos de horas con capacidad de edición y borrado para Admin
      let horaE = periodosDia.map(p => {
        const valor = p.entrada ? formatearHora(p.entrada.hora || p.entrada.timestamp) : '--:--';
        if (esMaster && p.entrada) {
          const tsVal = formatearTimestampCompleto(p.entrada.timestamp);
          return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.entrada.tipo}', '${p.entrada.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-edit-tiny" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.entrada.tipo}', '${p.entrada.id}', 'timestamp', '${tsVal}', '${f}')" title="Editar timestamp completo (actualiza fecha y hora)"><i class="fas fa-clock"></i></button><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.entrada.id}', '${e.id}', '${f}', '${p.entrada.tipo}')"><i class="fas fa-trash"></i></button></div>`;
        }
        if (esMaster && !p.entrada && (!esFalta || (d.registros && d.registros.length === 0))) {
          let defEntStr = esFestivo ? '07:00:00' : '07:30:00';
          let defEntLbl = esFestivo ? '07:00' : '07:30';
          return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'ENTRADA', '${defEntStr}', '${f}')"><i class="fas fa-plus"></i> ${defEntLbl}</button>`;
        }
        return valor;
      }).join('<br>');

      let horaS = periodosDia.map(p => {
        const valor = p.salida ? formatearHora(p.salida.hora || p.salida.timestamp) : '--:--';
        if (esMaster && p.salida) {
          const tsVal = formatearTimestampCompleto(p.salida.timestamp);
          return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.salida.tipo}', '${p.salida.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-edit-tiny" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.salida.tipo}', '${p.salida.id}', 'timestamp', '${tsVal}', '${f}')" title="Editar timestamp completo (actualiza fecha y hora)"><i class="fas fa-clock"></i></button><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.salida.id}', '${e.id}', '${f}', '${p.salida.tipo}')"><i class="fas fa-trash"></i></button></div>`;
        }
        if (esMaster && !p.salida && (!esFalta || (d.registros && d.registros.length === 0))) {
          let defSalStr = esFestivo ? '15:00:00' : '16:15:00';
          let defSalLbl = esFestivo ? '15:00' : '16:15';
          return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'SALIDA', '${defSalStr}', '${f}')"><i class="fas fa-plus"></i> ${defSalLbl}</button>`;
        }
        return valor;
      }).join('<br>');

      let aBadge = (d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? '<span class="pill ok">🏢 Sí</span>' : (d.almuerzo === 'NO' || d.almuerzo === 'FUERA') ? '<span class="pill" style="background:#dbeafe; color:#1e40af;">🏠 No</span>' : '<span class="pill dim">❓ —</span>';
      if (esMaster && !esFalta) {
        aBadge = `<span class="editable-pill" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}', '${(d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? 'NO' : 'SI'}', '${f}')">${aBadge}</span>`;
      }

      let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO');
      let atrasoMins = 0;
      if (primerReg) {
        let mE = obtenerMinutos(primerReg.hora || primerReg.timestamp);
        let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
        if (mE !== null && mE > refEntrada + 5) atrasoMins = mE - refEntrada;
      }

      let razonesBadges = [];
      regsDia.forEach(r => {
        if (r.razon_entrada_tardia) {
          let txt = r.razon_entrada_tardia;
          let ico = '📌';
          if (txt === 'permiso_medico') { txt = 'Permiso médico'; ico = '🏥'; }
          else if (txt === 'cumpleanos') { txt = 'Cumpleaños'; ico = '🎂'; }
          else if (txt === 'permiso_personal') { txt = 'Permiso personal'; ico = '📋'; }
          else if (txt === 'salida_campo') { txt = 'Salida a Campo'; ico = '🚗'; }
          else if (txt === 'salida_justificada') { txt = 'Entrada Justif.'; ico = '✅'; }
          let q = r.quien_justifica_entrada ? ` (${r.quien_justifica_entrada})` : '';
          razonesBadges.push(`<span class="pill" style="background:#e0e7ff; color:#3730a3; font-size:11px;">${ico} ${txt}${q}</span>`);
        }
        if (r.razon_salida_temprana) {
          let txt = r.razon_salida_temprana;
          let ico = '📌';
          if (txt === 'permiso_medico') { txt = 'Permiso médico'; ico = '🏥'; }
          else if (txt === 'cumpleanos') { txt = 'Cumpleaños'; ico = '🎂'; }
          else if (txt === 'permiso_personal') { txt = 'Permiso personal'; ico = '📋'; }
          else if (txt === 'salida_campo') { txt = 'Salida a Campo'; ico = '🚗'; }
          else if (txt === 'salida_justificada') { txt = 'Justificada'; ico = '✅'; }
          let q = r.quien_justifica ? ` (${r.quien_justifica})` : '';
          razonesBadges.push(`<span class="pill" style="background:#fce7f3; color:#831843; font-size:11px;">${ico} ${txt}${q}</span>`);
        }
        if (r.tipo_salida && r.tipo_salida.includes('PERMISO')) {
          let txt = r.razon_permiso || 'Permiso';
          let ico = '👤';
          if (txt.toLowerCase().includes('medico')) ico = '🏥';
          razonesBadges.push(`<span class="pill" style="background:#c7d2fe; color:#3730a3; font-size:11px;">${ico} ${txt}</span>`);
        } else if (r.tipo_salida === 'SALIDA_PASANTE' || r.razon_salida === 'salida_pasante') {
          razonesBadges.push(`<span class="pill" style="background:#ede9fe; color:#6d28d9; font-size:11px;">🎓 Salida Pasante</span>`);
        } else if (r.razon_salida) {
          let txt = r.razon_salida;
          let ico = '📌';
          if (txt === 'permiso_medico') { txt = 'Permiso médico'; ico = '🏥'; }
          else if (txt === 'cumpleanos') { txt = 'Cumpleaños'; ico = '🎂'; }
          else if (txt === 'permiso_personal') { txt = 'Permiso personal'; ico = '📋'; }
          else if (txt === 'salida_campo') { txt = 'Salida a Campo'; ico = '🚗'; }
          else if (txt === 'salida_justificada') { txt = 'Justificada'; ico = '✅'; }
          let q = r.quien_justifica ? ` (${r.quien_justifica})` : '';
          razonesBadges.push(`<span class="pill" style="background:#fce7f3; color:#831843; font-size:11px;">${ico} ${txt}${q}</span>`);
        }
        if (r.razon_ausencia || r.razon_justificac) {
          let txt = r.razon_ausencia || r.razon_justificac;
          let ico = '✏️';
          if (txt === 'Vacación' || txt === 'Vacacion') ico = '🏖️';
          else if (txt === 'Permiso Médico') ico = '🩺';
          else if (txt === 'Permiso Personal') ico = '👤';
          else if (txt === 'Calamidad Doméstica') ico = '🏠';
          else if (txt === 'Trabajo de Campo' || txt === 'Salida a Campo') { txt = 'Salida a Campo'; ico = '🚗'; }
          else if (r.razon_justificac) ico = '✅';
          razonesBadges.push(`<span class="pill" style="background:#fff7ed; color:#c2410c; border:1px solid #fed7aa; font-size:11px;">${ico} ${escapeHtml(txt)}</span>`);
        }
      });

      // RAZÓN: solo mostrar razón de ausencia del día (vacación, feriado, fin de semana, permiso)
      // ponytail: badges de salida/campo se omiten aquí — ya visibles en otras columnas
      let razonDia = '';
      if (dayOfWeek === 0) razonDia = '🅢 Domingo';
      else if (dayOfWeek === 6) razonDia = '🅢 Sábado';
      else if (esFeriadoODomingo(f)) razonDia = '🏛️ Feriado';

      let razonAusenciaVal = '';
      let razonJustificadaVal = '';
      regsDia.forEach(r => {
        if (r.razon_ausencia) {
          razonAusenciaVal = r.razon_ausencia;
        } else if (r.tipo && esAusenciaTipo(r.tipo)) {
          const t = r.tipo.toUpperCase();
          if (t === 'VACACIONES' || t === 'VACACION') razonAusenciaVal = 'Vacación';
          else if (t === 'PERMISO_MEDICO') razonAusenciaVal = 'Permiso Médico';
          else if (t === 'PERMISO_PERSONAL') razonAusenciaVal = 'Permiso Personal';
          else if (t === 'CALAMIDAD_DOMESTICA') razonAusenciaVal = 'Calamidad Doméstica';
          else if (t === 'TRABAJO_DE_CAMPO' || t === 'SALIDA_A_CAMPO') razonAusenciaVal = 'Salida a Campo';
          else if (t === 'CUMPLEAÑOS' || t === 'CUMPLEANOS') razonAusenciaVal = 'Cumpleaños';
          else if (t === 'SALIDA_JUSTIFICADA') razonAusenciaVal = 'Salida Justificada';
          else razonAusenciaVal = r.tipo;
        } else if (r.justificado === 'SI' && r.razon_justificac) {
          razonJustificadaVal = r.razon_justificac;
        }
      });

      let selectRazonHtml = `
          <select onchange="window.guardarRazonAusenciaFecha('${e.id}', '${f}', this.value)" ${(!esSuperPermiso || !esFalta) ? 'disabled' : ''} style="font-size:10px; border:1px solid #d1d5db; border-radius:5px; padding:1px 3px; background:#f8fafc; cursor:pointer; width:92px; max-width:92px;">
            <option value="">-- Razón --</option>
            <option value="Vacación" ${razonAusenciaVal === 'Vacación' || razonAusenciaVal === 'Vacacion' ? 'selected' : ''}>🏖️ Vacación</option>
            <option value="Permiso Médico" ${razonAusenciaVal === 'Permiso Médico' ? 'selected' : ''}>🩺 Permiso Med.</option>
            <option value="Permiso Personal" ${razonAusenciaVal === 'Permiso Personal' ? 'selected' : ''}>👤 Permiso Pers.</option>
            <option value="Calamidad Doméstica" ${razonAusenciaVal === 'Calamidad Doméstica' ? 'selected' : ''}>🏠 Calamidad</option>
            <option value="Salida a Campo" ${razonAusenciaVal === 'Salida a Campo' || razonAusenciaVal === 'Trabajo de Campo' ? 'selected' : ''}>🚗 S. Campo</option>
            <option value="Cumpleaños" ${razonAusenciaVal === 'Cumpleaños' ? 'selected' : ''}>🎂 Cumpleaños</option>
            <option value="Salida Justificada" ${razonAusenciaVal === 'Salida Justificada' ? 'selected' : ''}>✅ S. Justif.</option>
            <option value="Otro" ${razonAusenciaVal && !['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Trabajo de Campo', 'Salida a Campo', 'Cumpleaños', 'Salida Justificada'].includes(razonAusenciaVal) ? 'selected' : ''}>✏️ Otro...</option>
          </select>
        `;
      if (razonAusenciaVal && !['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Trabajo de Campo', 'Salida a Campo', 'Cumpleaños', 'Salida Justificada'].includes(razonAusenciaVal)) {
        selectRazonHtml += `<div style="font-size:9px; color:var(--indigo); margin-top:2px; font-weight:700;">${escapeHtml(razonAusenciaVal)}</div>`;
      } else if (razonJustificadaVal) {
        selectRazonHtml += `<div style="font-size:9px; color:var(--green); margin-top:2px; font-weight:700;">Justif: ${escapeHtml(razonJustificadaVal)}</div>`;
      }

      let rowStyle = "";
      let badgeDia = "";
      if (dayOfWeek === 0) {
        rowStyle = "background-color: rgba(239, 68, 68, 0.04);";
        badgeDia = `<span class="pill danger" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">DOMINGO</span>`;
      } else if (dayOfWeek === 6) {
        rowStyle = "background-color: rgba(245, 158, 11, 0.04);";
        badgeDia = `<span class="pill warn" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">SÁBADO</span>`;
      } else if (esFeriadoODomingo(f)) {
        rowStyle = "background-color: rgba(99, 102, 241, 0.04);";
        badgeDia = `<span class="pill indigo" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">FERIADO</span>`;
      } else {
        badgeDia = `<span class="pill ok" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">LABORAL</span>`;
      }

      const diaSemana = obtenerDiaSemanaStr(f);
      let fechaFormateada = `<span style="font-size:10px;color:var(--g400);display:block">${diaSemana}</span>${f.slice(8, 10)}/${f.slice(5, 7)}${badgeDia}`;

      let h50 = 0, h100 = 0, hCN = 0, hC50 = 0, hC100 = 0;
      let minutosTrabajadosHoy = 0;
      let tiempoPersonal = 0;
      let tiempoMedico = 0;
      let tiempoPorJustificar = 0;
      let minsEmpresa = 0;
      let minsCampo = 0;

      ultimoSalidaMins = null;
      ultimoSalidaReg = null;

      let processedLunchGap = false;
      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;

        let duracion = mS - mE;
        minutosTrabajadosHoy += duracion;

        let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';
        if (enCampo) {
          minsCampo += duracion;
        } else {
          minsEmpresa += duracion;
        }

        if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
          let gap = mE - ultimoSalidaMins;
          if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
            let lunchMins = Math.min(45, gap);
            gap -= lunchMins;
            processedLunchGap = true;
          }
          if (gap > 0) {
            let clasif = clasificarGap(ultimoSalidaReg, gap);
            if (clasif.tipo === 'medico') {
              tiempoMedico += gap;
            } else if (clasif.tipo === 'personal') {
              tiempoPersonal += gap;
            } else {
              tiempoPorJustificar += gap;
            }
          }
        }
        ultimoSalidaMins = mS;
        ultimoSalidaReg = p.salida;
      });

      let netWorked = minutosTrabajadosHoy;
      if (!esFestivo && netWorked > 240) {
        netWorked -= 45;
        if (minsEmpresa > 240) minsEmpresa -= 45;
        else if (minsCampo > 240) minsCampo -= 45;
      }
      minsEmpresa = Math.max(0, minsEmpresa);
      minsCampo = Math.max(0, minsCampo);

      let ultSalReg = [...regsDia].reverse().find(r => {
        const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
        return t.includes('SALIDA');
      });
      if (ultSalReg) {
        let mS = obtenerMinutos(ultSalReg.hora || ultSalReg.timestamp);
        if (mS !== null) ultimoSalidaMins = mS;
      }

      let minsSalidaTemprana = 0;
      let refSalida = esFestivo ? 975 : HORA_SALIDA_REF;
      if (!esFestivo && ultimoSalidaMins !== null && ultimoSalidaMins < refSalida) {
        minsSalidaTemprana = refSalida - ultimoSalidaMins;
      }

      let autorizadoGlobal = regsDia.some(r => r.horasExtra === 'SI');
      if (esFestivo) {
        if (netWorked > 60) autorizadoGlobal = true;
        if (netWorked <= 60) autorizadoGlobal = false;
      } else {
        if (netWorked >= 600) autorizadoGlobal = true;
        if (netWorked - 480 <= 60) autorizadoGlobal = false;
      }

      let extBadgeVal = autorizadoGlobal ? 'SI' : 'NO';
      let extBadge = autorizadoGlobal ? '<span class="pill ok">SI</span>' : '<span class="pill dim">NO</span>';
      if (regsDia.some(r => (r.autoriza || '').includes('CAMPO'))) {
        extBadge = '<span class="pill ok" title="Auto-autorizado por Campo">CAMPO</span>';
      }
      let extBadgeHtml = extBadge;
      if (esMaster && regsDia.length > 0 && !esFalta) {
        extBadgeHtml = `<span class="editable-pill" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${regsDia[0].tipo}', '${regsDia[0].id}', 'horasExtra', '${extBadgeVal}', '${f}')">${extBadge}</span>`;
      }

      let extraMins50Acum = 0;
      let extraMins100Acum = 0;

      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;
        let duracion = mS - mE;
        let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

        if (esFestivo) {
          if (enCampo) {
            if (autorizadoGlobal) hC100 += duracion;
          } else {
            if (autorizadoGlobal) h100 += duracion;
          }
        } else {
          let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
          if (enCampo) {
            if (mS <= H_INI || mE >= H_FIN) {
              hC50 += duracion;
            } else {
              let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
              let mExtra = duracion - mNormal;
              hCN += mNormal;
              hC50 += mExtra;
            }
          } else {
            if (autorizadoGlobal && mS > H_FIN) {
              extraMins50Acum += (mS - Math.max(mE, H_FIN));
            }
          }
        }
      });

      if (esFestivo) {
      } else {
        h50 = extraMins50Acum;
      }

      let tiempoJustificado = 0;
      const hasCumpleanos = regsDia.some(r => {
        const raz = String(r.razon_ausencia || '').toLowerCase();
        const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
        return raz.includes('cumplea') || raz.includes('cumplean') || tip.includes('CUMPLE');
      });
      if (hasCumpleanos) tiempoJustificado += 240;

      const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
      const persMins = regPermiso ? Number(regPermiso.permiso_personal_mins || 0) : 0;
      const medMins = regPermiso ? Number(regPermiso.permiso_medico_mins || 0) : 0;
      const justMins = regPermiso ? Number(regPermiso.tiempo_justificado_mins || 0) : 0;
      tiempoPersonal += persMins;
      tiempoMedico += medMins;
      tiempoJustificado += justMins;

      const esHoyOFuturo = f >= getLocalHoyStr();
      if (isJustificado || esHoyOFuturo) {
        tiempoPorJustificar = 0;
      } else {
        let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
        let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoPorJustificar;
        let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
        tiempoPorJustificar += unaccountedMissing;
        tiempoPorJustificar = Math.max(0, tiempoPorJustificar - tiempoJustificado);
      }

      const originalAtrasoMins = atrasoMins;
      const originalSalidaTemprana = minsSalidaTemprana;
      if (isJustificado) {
        atrasoMins = 0;
        minsSalidaTemprana = 0;
      } else {
        const permisosTotales = tiempoPersonal + tiempoMedico + tiempoJustificado;
        atrasoMins = Math.max(0, originalAtrasoMins - permisosTotales);
        const permisosRestantes = Math.max(0, permisosTotales - originalAtrasoMins);
        minsSalidaTemprana = Math.max(0, originalSalidaTemprana - permisosRestantes);
      }

      netWorked += (tiempoPersonal + tiempoMedico);

      const descuentoDia = tiempoPersonal + (tiempoPorJustificar > 0 ? Math.max(tiempoPorJustificar, atrasoMins) : atrasoMins);
      const descuentoDiaVis = tiempoPersonal + atrasoMins;

      const todosRegsConModo = regsDia.filter(r => r.modo);
      const tieneCampo = todosRegsConModo.some(r => r.modo === 'CAMPO');
      const tieneEmpresa = todosRegsConModo.some(r => r.modo === 'EMPRESA' || r.modo === 'OFICINA');
      const modActual = tieneCampo && tieneEmpresa ? 'MIXTO' : tieneCampo ? 'CAMPO' : 'EMPRESA';

      let modalidadCell;
      if (esSuperPermiso && !esFalta) {
        modalidadCell = `<select data-emp="${e.id}" data-fecha="${f}" onchange="guardarPermiso('${e.id}','${f}','modalidad',this.value)" style="font-size:10px;border:1px solid #d1d5db;border-radius:6px;padding:2px 4px;background:#f8fafc;cursor:pointer;">
            <option value="EMPRESA" ${modActual === 'EMPRESA' ? 'selected' : ''}>🏢 Empresa</option>
            <option value="CAMPO"   ${modActual === 'CAMPO' ? 'selected' : ''}>🏗️ Campo</option>
            <option value="MIXTO"   ${modActual === 'MIXTO' ? 'selected' : ''}>🔀 Mixto</option>
          </select>`;
      } else {
        const mIcon = modActual === 'CAMPO' ? '🏗️' : modActual === 'MIXTO' ? '🔀' : '🏢';
        modalidadCell = `<span style="font-size:10px;">${mIcon} ${modActual}</span>`;
      }

      const eRegPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia[0];
      const comentarioPermiso = eRegPermiso ? (eRegPermiso.razon_permiso || '') : '';
      const comentarioEscapadoPermiso = comentarioPermiso.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

      let badgesTiemposHtml = [];
      if (tiempoJustificado > 0) {
        badgesTiemposHtml.push(`<span class="badge-tiempo badge-just" title="Tiempo Justificado: ${minutosAHHMMSS(tiempoJustificado)}">TJ: ${minutosAHHMMSS(tiempoJustificado)}</span>`);
      }
      if (tiempoPersonal > 0) {
        badgesTiemposHtml.push(`<span class="badge-tiempo badge-pers" title="Tiempo Personal: ${minutosAHHMMSS(tiempoPersonal)}">TP: ${minutosAHHMMSS(tiempoPersonal)}</span>`);
      }
      if (tiempoMedico > 0) {
        badgesTiemposHtml.push(`<span class="badge-tiempo badge-med" title="Tiempo Médico: ${minutosAHHMMSS(tiempoMedico)}">TM: ${minutosAHHMMSS(tiempoMedico)}</span>`);
      }
      if (tiempoPorJustificar > 0) {
        badgesTiemposHtml.push(`<span class="badge-tiempo badge-falt" title="Tiempo Por Justificar: ${minutosAHHMMSS(tiempoPorJustificar)}">Falt: ${minutosAHHMMSS(tiempoPorJustificar)}</span>`);
      }

      const badgesStr = badgesTiemposHtml.length > 0 ? badgesTiemposHtml.join(' ') : '<span style="color:#94a3b8; font-size:10px;">—</span>';

      let btnGestionTiempos = '';
      if (esSuperPermiso && !esFalta) {
        btnGestionTiempos = `<button type="button" onclick="editarCeldaTiempo('cel_gest_${e.id}_${f.replace(/-/g, '')}','${e.id}','${f}','justificado',${tiempoJustificado},'${comentarioEscapadoPermiso}',${tiempoPersonal},${tiempoMedico},${tiempoPorJustificar},${originalAtrasoMins})" style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:2px 6px; font-size:10px; font-weight:700; color:#b45309; cursor:pointer; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; transition:all 0.15s;" onmouseover="this.style.background='#fde68a'" onmouseout="this.style.background='#fef3c7'" title="Gestionar o Justificar tiempo">
            <i class="fas fa-plus-circle" style="color:#d97706; font-size:10px;"></i> + Tiempo
          </button>`;
      }

      const celdaGestionTiempos = `<div style="display:flex; align-items:center; justify-content:center; gap:5px; flex-wrap:wrap;">
          ${badgesStr}
          ${btnGestionTiempos}
        </div>`;

      totTP += tiempoPersonal;
      totTM += tiempoMedico;
      totTJustificado += tiempoJustificado;
      totTJ += tiempoPorJustificar;
      totDescuentoBruto += descuentoDia;
      totHoras += netWorked;
      totAtrasos += atrasoMins;
      totEmpresa += minsEmpresa;
      totCampo += minsCampo;
      totSalidaTemprana += minsSalidaTemprana;
      totH50 += h50; totH100 += h100;
      totHCN += hCN; totHC50 += hC50; totHC100 += hC100;
      totExtra50 += (h50 + hC50);
      totExtra100 += (h100 + hC100);

      // Detección de necesidad de regularización en días laborables ordinarios
      const esDiaLaboralOrdinario = (dayOfWeek !== 0 && dayOfWeek !== 6 && !esFestivo);
      const faltaMarcacionEntrada = periodosDia.some(p => !p.entrada && p.salida);
      const faltaMarcacionSalida = periodosDia.some(p => p.entrada && !p.salida);
      const esFaltaSinJustificar = esFalta && !isJustificado;

      // CRÍTICO: Excluir estrictamente la fecha actual (hoy) ya que la jornada está en curso
      if (esDiaLaboralOrdinario && f < hoyStrLocal) {
        const fParts = f.split('-');
        const fFmt = (fParts.length === 3) ? `${fParts[2]}/${fParts[1]}` : f;
        if (esFaltaSinJustificar) {
          fechasARegularizar.push({ fecha: f, label: fFmt, motivo: 'Inasistencia', tipo: 'ausencia' });
        } else if (faltaMarcacionSalida) {
          fechasARegularizar.push({ fecha: f, label: fFmt, motivo: 'Sin Salida', tipo: 'incompleto' });
        } else if (faltaMarcacionEntrada) {
          fechasARegularizar.push({ fecha: f, label: fFmt, motivo: 'Sin Entrada', tipo: 'incompleto' });
        } else if (tiempoPorJustificar > 60) {
          fechasARegularizar.push({ fecha: f, label: fFmt, motivo: 'Tiempo por justificar', tipo: 'tiempo', minutos: tiempoPorJustificar });
        }
      }

      const esAusenciaEspecial = esFalta && (
        ['Vacación', 'Vacacion', 'Vacaciones', 'Permiso Médico', 'Permiso Personal', 'Salida Justificada'].includes(razonAusenciaVal) ||
        ['Vacación', 'Vacacion', 'Vacaciones', 'Permiso Médico', 'Permiso Personal', 'Salida Justificada'].includes(razonJustificadaVal)
      );

      if (esAusenciaEspecial) {
        const razonMostrar = razonAusenciaVal || razonJustificadaVal || 'Ausencia';
        const icon = razonMostrar.toLowerCase().includes('vacac') ? '🏖️' : razonMostrar.toLowerCase().includes('medico') ? '🩺' : '📋';
        return `<tr id="fila-fecha-${f}" style="${rowStyle}">
        <td style="white-space:nowrap; font-weight:600; font-size:10px; padding:2px 3px;">${fechaFormateada}</td>
        <td colspan="14" style="font-size:10px; padding:4px 8px; font-weight:600; background:rgba(79, 70, 229, 0.03);">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#312e81; background:#e0e7ff; padding:2px 6px; border-radius:5px; border:1px solid #c7d2fe;">
              ${icon} ${razonMostrar.toUpperCase()}
            </span>
            <div style="display:flex; align-items:center; gap:4px; color:#64748b; font-size:10px;">
              <span>Razón:</span>
              ${selectRazonHtml}
            </div>
          </div>
        </td>
      </tr>`;
      }

      return `<tr id="fila-fecha-${f}" style="${rowStyle}">
      <td style="white-space:nowrap; font-weight:600; font-size:10px; padding:2px 3px;">${fechaFormateada}</td>
      <td style="font-size:10px; padding:2px 3px; text-align:center;">${modalidadCell}</td>
      <td class="hora-cell" style="font-size:10px; padding:2px 3px;">${horaE}</td>
      <td class="hora-cell" style="font-size:10px; padding:2px 3px;">${horaS}</td>
      <td style="font-size:10px; padding:2px 3px;">${selectRazonHtml}</td>
      <td style="text-align:center; color:${atrasoMins > 0 ? 'var(--red)' : 'inherit'}; font-size:10px; padding:2px 3px;">${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
      <td style="text-align:center; font-size:10px; padding:2px 4px;">${celdaGestionTiempos}</td>
      <td style="text-align:center; color:var(--red); font-weight:600; font-size:10px; padding:2px 3px;">${descuentoDiaVis > 0 ? minutosAHHMMSS(descuentoDiaVis) : '—'}</td>
      <td style="text-align:center; color:var(--green); font-weight:600; font-size:10px; padding:2px 3px;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
      <td style="font-size:10px; padding:2px 3px;">${aBadge}</td>
      <td style="font-size:10px; padding:2px 3px;">${extBadgeHtml}</td>
      <td style="text-align:center; font-size:10px; padding:2px 3px;" title="Oficina: ${minutosAHHMMSS(h50)} | Campo: ${minutosAHHMMSS(hC50)}"><strong>${(h50 + hC50) > 0 ? minutosAHHMMSS(h50 + hC50) : '—'}</strong></td>
      <td style="text-align:center; font-size:10px; padding:2px 3px;" title="Oficina: ${minutosAHHMMSS(h100)} | Campo: ${minutosAHHMMSS(hC100)}"><strong>${(h100 + hC100) > 0 ? minutosAHHMMSS(h100 + hC100) : '—'}</strong></td>
    </tr>`;
    }).join('');

    thH = Math.floor(totHoras / 60) || 0;
    thM = totHoras % 60 || 0;

    const totDescontarFinal = Math.max(0, totDescuentoBruto - 240);

    let celdaTotalDescuentoHtml = '—';
    if (totDescontarFinal > 0) {
      celdaTotalDescuentoHtml = `<span style="color:var(--red); font-weight:700;" title="Total Bruto: ${minutosAHHMMSS(totDescuentoBruto)} - 4h Beneficio = ${minutosAHHMMSS(totDescontarFinal)}">${minutosAHHMMSS(totDescontarFinal)}</span>`;
    } else if (totDescuentoBruto > 0) {
      celdaTotalDescuentoHtml = `<div style="display:flex; flex-direction:column; align-items:center; line-height:1.1;" title="Total Bruto: ${minutosAHHMMSS(totDescuentoBruto)} — Totalmente cubierto por las 4h de beneficio de la empresa">
            <span style="color:#16a34a; font-weight:700;">00:00:00</span>
            <span style="font-size:8px; color:#16a34a; font-weight:600;">(Cubierto 4h)</span>
          </div>`;
    }

    // Fila de totales para el tfoot
    const mA = v => v > 0 ? `<strong>${minutosAHHMMSS(v)}</strong>` : '—';
    const tfootRow = `<tr style="background:var(--g50);border-top:2px solid var(--g300);font-weight:700;font-size:10px;">
        <td style="padding:3px 4px;">TOTALES</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td style="text-align:center;color:var(--red);">${mA(totAtrasos)}</td>
        <td style="text-align:center; padding:3px 4px;">
          <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:5px; font-size:9.5px;">
            ${totTJustificado > 0 ? `<span style="color:#854d0e;" title="Total Tiempo Justificado">TJ: <strong>${minutosAHHMMSS(totTJustificado)}</strong></span>` : ''}
            ${totTP > 0 ? `<span style="color:var(--indigo);" title="Total Tiempo Personal">TP: <strong>${minutosAHHMMSS(totTP)}</strong></span>` : ''}
            ${totTM > 0 ? `<span style="color:var(--teal);" title="Total Tiempo Médico">TM: <strong>${minutosAHHMMSS(totTM)}</strong></span>` : ''}
            ${totTJ > 0 ? `<span style="color:var(--red);" title="Total Por Justificar">Falt: <strong>${minutosAHHMMSS(totTJ)}</strong></span>` : ''}
            ${(totTJustificado === 0 && totTP === 0 && totTM === 0 && totTJ === 0) ? '—' : ''}
          </div>
        </td>
        <td style="text-align:center; padding:2px 3px;">${celdaTotalDescuentoHtml}</td>
        <td style="text-align:center;color:var(--green);">${mA(totHoras)}</td>
        <td></td>
        <td></td>
        <td style="text-align:center;">${mA(totExtra50)}</td>
        <td style="text-align:center;">${mA(totExtra100)}</td>
      </tr>`;

    const tbody = document.getElementById('tbody-historial-periodo');
    if (tbody) {
      tbody.innerHTML = filas || '<tr><td colspan="13" class="empty-state">Sin registros</td></tr>';
    }
    const tfoot = document.getElementById('tfoot-historial-periodo');
    if (tfoot) {
      tfoot.innerHTML = tfootRow;
    }

    const wrapBanner = document.getElementById('contenedorBannerRegularizarDetalle');
    if (wrapBanner) {
      wrapBanner.innerHTML = generarBannerRegularizarHTML(fechasARegularizar);
    }

    return { filas, tfootRow, fechasARegularizar };
  }

  // Renderizado inicial con la tabla vacía de vacaciones
  const initialTable = rebuildTable();
  let filas = initialTable.filas;
  let tfootRow = initialTable.tfootRow;
  let fechasARegularizar = initialTable.fechasARegularizar || [];

  function actualizarCardVacaciones(vacacionesTomadasHoy, vacacionesRestantesHoy) {
    const container = document.getElementById('card-vacaciones-detalle');
    if (container) {
      let totalVacsTomadas = vacacionesTomadasHoy !== null && vacacionesTomadasHoy !== undefined
        ? vacacionesTomadasHoy
        : vacacionesList.length;
      let totalVacsRestantes = vacacionesRestantesHoy !== null && vacacionesRestantesHoy !== undefined
        ? vacacionesRestantesHoy
        : '--';

      let listaVacacionesHTML = '';
      if (vacacionesList.length > 0) {
        const sortedVacs = [...vacacionesList].sort((a, b) => b.fecha.localeCompare(a.fecha));
        listaVacacionesHTML = sortedVacs.map(v => {
          return `<div style="font-size:11px; padding:4px 0; border-bottom:1px dashed #f1f5f9; display:flex; justify-content:space-between; color:#334155;">
                <span>📅 ${v.fecha}</span>
                <span style="font-weight:700; color:#4f46e5;">🏖️ Tomada</span>
              </div>`;
        }).join('');
      } else {
        listaVacacionesHTML = `<div style="font-size:11px; color:#94a3b8; text-align:center; padding:5px 0;">Sin vacaciones registradas</div>`;
      }

      container.innerHTML = `
            <div style="font-size:10px; font-weight:700; color:#64748b; border-bottom:1px solid #f1f5f9; padding-bottom:3px; margin-bottom:2px; display:flex; align-items:center; justify-content:space-between; text-transform:uppercase; letter-spacing:0.02em;">
              <span style="display:flex; align-items:center; gap:4px;"><i class="fas fa-umbrella-beach" style="color:#4f46e5; font-size:11px;"></i> Vacaciones</span>
              <span style="font-size:9.5px; color:#475569;"><strong style="color:#0f172a;">${totalVacsTomadas}</strong> tom. / <strong style="color:var(--green);">${totalVacsRestantes}</strong> rest.</span>
            </div>
            <div style="max-height: 48px; overflow-y: auto; padding-right: 2px;">
              ${listaVacacionesHTML}
            </div>
          `;
    }
  }

  let puntualidadVal = dias ? Math.max(0, Math.round((1 - tardT / dias) * 100)) : 100;
  let puntualidadColor = puntualidadVal >= 90 ? 'var(--green)' : puntualidadVal >= 70 ? 'var(--amber)' : 'var(--red)';
  let optionsPeriodos = periodos.map((p, i) => `<option value="${i}" ${i === indexPeriodo ? 'selected' : ''}>${p.label}</option>`).join('');

  const rawTel = (e.telefono || e.celular || e.whatsapp || '').toString().trim();
  const numWaPuro = (typeof window.normalizarNumeroParaWhatsApp === 'function')
    ? window.normalizarNumeroParaWhatsApp(rawTel)
    : rawTel.replace(/[^\d]/g, '');
  const tieneWa = !!(numWaPuro && numWaPuro.length >= 9);

  let badgeWhatsAppHtml = '';
  if (tieneWa) {
    badgeWhatsAppHtml = `
          <span style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:4px;" ${esMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'telefono', '${escapeHtml(rawTel)}')" title="Clic para editar número de WhatsApp"` : ''}>
            <i class="fab fa-whatsapp" style="color:#16a34a; font-size:12px;"></i> WhatsApp: ${escapeHtml(rawTel)}
            ${esMaster ? `<i class="fas fa-pen" style="font-size:8.5px; opacity:0.6; margin-left:2px;"></i>` : ''}
          </span>
          <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:linear-gradient(135deg, #25d366 0%, #16a34a 100%); color:white; border:none; padding:2px 10px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:5px; cursor:pointer; box-shadow:0 1px 4px rgba(22,163,74,0.25); transition:transform 0.15s;" title="Enviar mensaje directo de WhatsApp a ${escapeHtml(e.nombre)}">
            <i class="fab fa-whatsapp" style="font-size:12px;"></i> Enviar WhatsApp
          </button>
        `;
  } else {
    badgeWhatsAppHtml = `
          <span style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" title="No tiene WhatsApp registrado. Clic para registrarlo">
            <i class="fab fa-whatsapp" style="color:#ef4444; font-size:12px;"></i> Sin WhatsApp
            <i class="fas fa-plus-circle" style="font-size:9px; margin-left:2px;"></i>
          </span>
          <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:#fff1f2; color:#be123c; border:1px solid #fca5a5; padding:2px 10px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:5px; cursor:pointer; transition:all 0.15s;" title="Registrar número para enviar WhatsApp">
            <i class="fab fa-whatsapp" style="font-size:12px;"></i> Agregar WhatsApp
          </button>
        `;
  }

  const culturaActivaEmp = !(e.cultura_habilitada === false || e.cultura_activa === false || e.cultura_habilitada === 'false' || e.cultura_activa === 'false');
  const badgeCulturaHtml = `
        <button type="button" onclick="window.toggleCulturaEmpleado('${e.id}')" title="${culturaActivaEmp ? 'Cultura Tcontrol Habilitada para este usuario. Clic para deshabilitar / exonerar' : 'Cultura Tcontrol Deshabilitada para este usuario. Clic para habilitar'}" style="background:${culturaActivaEmp ? '#eff6ff' : '#f8fafc'}; color:${culturaActivaEmp ? '#1d4ed8' : '#64748b'}; border:1px solid ${culturaActivaEmp ? '#bfdbfe' : '#cbd5e1'}; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:5px; cursor:pointer; transition:all 0.15s;">
          <i class="fas fa-lightbulb" style="color:${culturaActivaEmp ? '#2563eb' : '#94a3b8'};"></i>
          Cultura: <span style="color:${culturaActivaEmp ? '#15803d' : '#be123c'};">${culturaActivaEmp ? 'Habilitado' : 'Exonerado'}</span>
          <i class="fas fa-sync-alt" style="font-size:8.5px; opacity:0.6;"></i>
        </button>
      `;

  $('detalleContent').innerHTML = `
    <div class="detail-view">
      <!-- CABECERA REDISEÑADA: COMPACTA Y MODERNA -->
      <div class="detail-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:12px 18px; background:#ffffff; border-bottom:1px solid #e2e8f0;">
        <div style="display:flex; gap:12px; align-items:center;">
          <div class="detail-photo-container" style="width:72px; height:72px; min-width:72px; box-shadow:0 2px 6px rgba(0,0,0,0.06); border:2px solid #ffffff;" ${esMaster ? `onclick="triggerPhotoUpload('${e.id}')" title="Subir nueva foto"` : ''}>
            ${photoCell(e, 'large')}
            ${esMaster ? `<div class="photo-upload-overlay" style="font-size:10px;"><i class="fas fa-camera"></i></div>` : ''}
          </div>
          <div class="detail-info">
            <div class="detail-name" style="font-size:18px; font-weight:700; color:#0f172a; line-height:1.2; margin-bottom:4px;" ${esMaster ? `style="cursor:pointer" onclick="editarMetaEmpleado('${e.id}', 'nombre', '${e.nombre}')"` : ''}>${escapeHtml(e.nombre)}</div>
            <div class="detail-meta" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              <span style="background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:6px; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" ${esMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'id', '${e.id}')"` : ''}><i class="fas fa-id-card"></i> ${escapeHtml(e.id)}</span>
              <span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:6px; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" ${esMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'area', '${e.area || ''}')"` : ''}><i class="fas fa-building"></i> ${escapeHtml(e.area || 'Sin área')}</span>
              <span style="background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:6px; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" ${esMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'id_dispositivo', '${e.id_dispositivo || ''}')" title="Editar enlace de Rol de Pagos"` : ''}><i class="fas fa-file-invoice-dollar"></i> ${e.id_dispositivo ? 'Con Rol' : 'Sin Rol'}</span>
              ${badgeWhatsAppHtml}
              ${badgeCulturaHtml}
              <button onclick="window.resetearPasswordEmpleado('${e.id}', '${escapeHtml(e.nombre)}')" title="Resetear contraseña para permitir que el empleado vuelva a vincular su dispositivo" style="background:#fff1f2; color:#be123c; border:1px solid #fca5a5; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:4px; cursor:pointer; transition:all 0.15s;"><i class="fas fa-key" style="font-size:10px;"></i> Resetear Contraseña</button>
              ${tardT > 0 ?
      `<span style="background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:6px; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-clock"></i> ${tardT} tardanzas</span>` :
      `<span style="background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:6px; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-check-circle"></i> Puntual</span>`
    }
            </div>
          </div>
        </div>
        
        <!-- SELECTOR DE PERÍODOS INLINE -->
        <div class="periodo-selector" style="background:#ffffff; padding:6px 12px; border-radius:8px; border:1px solid #cbd5e1; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:12px; box-shadow:none;">
          <div style="display:flex; align-items:center;">
            <label style="font-weight:600; color:#475569; margin-right:6px; font-size:11.5px;"><i class="fas fa-calendar-alt"></i> Período:</label>
            <select id="filtroPeriodoDetalle" class="filter-select" onchange="mostrarDetalle('${e.id}', parseInt(this.value))" style="font-size:12px; font-weight:500; border:1px solid #cbd5e1; border-radius:6px; padding:2px 4px; outline:none; background:#ffffff;">
              ${optionsPeriodos}
            </select>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-weight:600; color:#475569; font-size:11.5px;">Desde:</label>
            <input type="date" id="detFechaInicio" value="${R_INI}" onchange="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value), this.value, $('detFechaFin').value)" style="border:1px solid #cbd5e1; border-radius:6px; padding:2px 4px; font-size:12px; font-family:inherit; outline:none; color:#334155; background:#ffffff;">
            <label style="font-weight:600; color:#475569; font-size:11.5px;">Hasta:</label>
            <input type="date" id="detFechaFin" value="${R_FIN}" onchange="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value), $('detFechaInicio').value, this.value)" style="border:1px solid #cbd5e1; border-radius:6px; padding:2px 4px; font-size:12px; font-family:inherit; outline:none; color:#334155; background:#ffffff;">
            <button class="btn btn-secondary" onclick="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value))" title="Restablecer al rango por defecto del período" style="font-size:11px; padding:3px 8px; height:auto; display:inline-flex; align-items:center; gap:4px; border:1px solid #cbd5e1; background:#f8fafc; color:#475569; border-radius:6px; cursor:pointer; font-weight:600;">
              <i class="fas fa-sync-alt"></i> Restablecer
            </button>
          </div>
        </div>
      </div>
      
      <!-- SECCIÓN DE MÉTRICAS REDISEÑADA Y COMPACTA (ponytail: minimal height) -->
      <div style="padding:6px 14px; background:#ffffff; border-bottom:1px solid #e2e8f0;">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:8px; width:100%;">
          
          <!-- RESUMEN ASISTENCIA -->
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:10px; font-weight:700; color:#64748b; border-bottom:1px solid #f1f5f9; padding-bottom:3px; margin-bottom:2px; display:flex; align-items:center; gap:5px; text-transform:uppercase; letter-spacing:0.02em;">
              <i class="fas fa-calendar-check" style="color:var(--blue); font-size:11px;"></i> Asistencia
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px 8px;">
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Días Trab.</span>
                <div style="font-size:13px; font-weight:700; color:#0f172a;">${dias} <span style="font-size:9px; color:#94a3b8; font-weight:400;">(${entT}e/${salT}s)</span></div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Puntualidad</span>
                <div style="font-size:13px; font-weight:700; color:${puntualidadColor};">${puntualidadVal}%</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Prom. Ent.</span>
                <div style="font-size:11.5px; font-weight:600; color:#334155;">${minsToHHMM(pE)}</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Prom. Sal.</span>
                <div style="font-size:11.5px; font-weight:600; color:#334155;">${minsToHHMM(pS)}</div>
              </div>
            </div>
          </div>

          <!-- JORNADA Y TIEMPOS -->
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:10px; font-weight:700; color:#64748b; border-bottom:1px solid #f1f5f9; padding-bottom:3px; margin-bottom:2px; display:flex; align-items:center; gap:5px; text-transform:uppercase; letter-spacing:0.02em;">
              <i class="fas fa-clock" style="color:var(--green); font-size:11px;"></i> Jornada y Tiempos
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px 8px;">
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Total Horas</span>
                <div style="font-size:13px; font-weight:700; color:var(--green);">${String(thH).padStart(2, '0')}:${String(thM).padStart(2, '0')}</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Atrasos Acum.</span>
                <div style="font-size:13px; font-weight:700; color:${totAtrasos > 0 ? 'var(--red)' : '#0f172a'};">${minutosAHHMMSS(totAtrasos)}</div>
              </div>
              <div style="grid-column: span 2; border-top: 1px dashed #f1f5f9; padding-top: 3px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:9px; color:#64748b; font-weight:600;">T. por Justificar:</span>
                <span style="font-size:13px; font-weight:700; color:${totTJ > 0 ? 'var(--red)' : 'var(--green)'};">${minutosAHHMMSS(totTJ)}</span>
              </div>
            </div>
          </div>

          <!-- PERMISOS Y ALMUERZOS -->
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:10px; font-weight:700; color:#64748b; border-bottom:1px solid #f1f5f9; padding-bottom:3px; margin-bottom:2px; display:flex; align-items:center; gap:5px; text-transform:uppercase; letter-spacing:0.02em;">
              <i class="fas fa-hand-holding-heart" style="color:var(--indigo); font-size:11px;"></i> Permisos y Almuerzos
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px 8px;">
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">T. Personal</span>
                <div style="font-size:11.5px; font-weight:600; color:var(--indigo);">${minutosAHHMMSS(totTP)}</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">T. Médico</span>
                <div style="font-size:11.5px; font-weight:600; color:var(--teal);">${minutosAHHMMSS(totTM)}</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Alm. Planta</span>
                <div style="font-size:11.5px; font-weight:600; color:var(--purple);">${almP}d</div>
              </div>
              <div>
                <span style="font-size:9px; color:#64748b; font-weight:600;">Alm. Fuera</span>
                <div style="font-size:11.5px; font-weight:600; color:#475569;">${almF}d</div>
              </div>
            </div>
          </div>

          <!-- HISTORIAL DE VACACIONES -->
          <div id="card-vacaciones-detalle" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:10px; font-weight:700; color:#64748b; border-bottom:1px solid #f1f5f9; padding-bottom:3px; margin-bottom:2px; display:flex; align-items:center; gap:5px; text-transform:uppercase; letter-spacing:0.02em;">
              <i class="fas fa-umbrella-beach" style="color:#4f46e5; font-size:11px;"></i> Vacaciones
            </div>
            <div style="display:flex; align-items:center; justify-content:center; padding:6px 0; color:#64748b; font-size:10px; gap:4px;">
              <div class="spinner-border text-primary" role="status" style="width:12px; height:12px; border-width:2px;"></div>
              <span>Cargando...</span>
            </div>
          </div>
          
        </div>
      </div>
      <div style="padding:var(--pad)">
        <div class="metric-title" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span><i class="fas fa-history"></i> Historial del período</span>
            <button class="btn btn-primary" onclick="window.mostrarModalManual('${e.id}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px; background:#2563eb; border-color:#2563eb; color:white; cursor:pointer;" title="Crear Registro Manual de Asistencia para ${escapeHtml(e.nombre)}">
              <i class="fas fa-plus-circle"></i> Registro Manual
            </button>
            <button class="btn btn-success" onclick="exportarExcelDetalleEmpleado('${e.id}', ${indexPeriodo}, '${R_INI}', '${R_FIN}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px;">
              <i class="fas fa-file-excel"></i> Exportar Excel
            </button>
            <button class="btn btn-primary" onclick="window.mostrarModalFuturos('${e.id}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px; background:var(--purple); border-color:var(--purple); color:white; cursor:pointer;">
              <i class="fas fa-calendar-plus"></i> Registrar Evento (jornada completa)
            </button>
            <button class="btn btn-primary" onclick="window.mostrarModalCampoSupervisor('${e.id}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px; background:#059669; border-color:#059669; color:white; cursor:pointer;">
              <i class="fas fa-hammer"></i> Trabajo en Campo
            </button>
          </div>
          <span style="color:var(--indigo);font-weight:600;font-size:13px;background:#e0e7ff;padding:4px 10px;border-radius:12px;">${periodoSeleccionado ? periodoSeleccionado.label : ''}</span>
        </div>
        
        <!-- BANNER FECHAS POR REGULARIZAR -->
        <div id="contenedorBannerRegularizarDetalle">
          ${generarBannerRegularizarHTML(fechasARegularizar)}
        </div>

        <div class="table-wrapper">
          <div class="table-scroll-wrap">
            <table class="employee-table table-compact table-ultra-compact">
              <thead>
                <tr>
                  <th style="font-size:10px;padding:3px 4px;">Fecha</th>
                  <th style="font-size:10px;padding:3px 4px;">Mod.</th>
                  <th style="font-size:10px;padding:3px 4px;">Entrada</th>
                  <th style="font-size:10px;padding:3px 4px;">Salida</th>
                  <th style="font-size:10px;padding:3px 4px;">Razón</th>
                  <th style="font-size:10px;padding:3px 4px;text-align:center;">Atraso</th>
                  <th style="font-size:10px;padding:3px 4px;text-align:center;" title="Gestión de Tiempos: Justificado (TJ), Personal (TP), Médico (TM), Por Justificar (Falt)">Novedades / Tiempos</th>
                  <th style="font-size:10px;padding:3px 4px;text-align:center;color:var(--red);" title="Tiempo a Descontar (Tiempo Personal + Faltante/Atrasos sin duplicar)">T. Descontar</th>
                  <th style="font-size:10px;padding:3px 4px;" title="Total Horas Trabajadas">Tot.Hrs</th>
                  <th style="font-size:10px;padding:3px 4px;">Alm.</th>
                  <th style="font-size:10px;padding:3px 4px;" title="Horas Extra Autorizadas">HE Aut.</th>
                  <th style="font-size:10px;padding:3px 4px;" title="Horas Extra 50% (Oficina + Campo)">H.E. 50%</th>
                  <th style="font-size:10px;padding:3px 4px;" title="Horas Extra 100% (Oficina + Campo)">H.E. 100%</th>
                </tr>
              </thead>
              <tbody id="tbody-historial-periodo">${filas || '<tr><td colspan="13" class="empty-state">Sin registros</td></tr>'}</tbody>
              <tfoot id="tfoot-historial-periodo">${tfootRow}</tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  cambiarPanel('detalle');

  if (window.fechaEnfocarDetalleActual) {
    const fEnf = window.fechaEnfocarDetalleActual;
    window.fechaEnfocarDetalleActual = null;
    setTimeout(() => {
      window.enfocarFechaEnDetalle(fEnf);
    }, 350);
  }
}

function volverADirectorio() { cambiarPanel('directorio'); cargarDirectorio(); }
window.volverADirectorio = volverADirectorio;

// ============================================================
// MÓDULO DIRECTORIO DE COLABORADORES
// ============================================================
window.directorioFiltroKpi = 'todos';
window.directorioVista = localStorage.getItem('TCONTROL_DIR_VISTA') || 'grid';
window.directorioUltimaLista = [];

window.setFiltroKpiDirectorio = function (filtro, elCard) {
  window.directorioFiltroKpi = filtro;
  document.querySelectorAll('.directorio-kpi-grid .kpi-card').forEach(c => c.classList.remove('active'));
  const card = elCard || (filtro === 'cumpleanos' ? $('kpiDirCardCumpleanos') : (filtro === 'todos' ? $('kpiDirCardTodos') : null));
  if (card) card.classList.add('active');
  filtrarDirectorio();
};

window.cambiarVistaDirectorio = function (vista) {
  window.directorioVista = vista;
  localStorage.setItem('TCONTROL_DIR_VISTA', vista);

  const btnGrid = $('btnDirVistaGrid');
  const btnTabla = $('btnDirVistaTabla');
  const containerGrid = $('directorioGridContainer');
  const containerTabla = $('directorioTablaContainer');

  if (btnGrid) btnGrid.classList.toggle('active', vista === 'grid');
  if (btnTabla) btnTabla.classList.toggle('active', vista === 'tabla');

  if (containerGrid) containerGrid.style.display = (vista === 'grid') ? 'grid' : 'none';
  if (containerTabla) containerTabla.style.display = (vista === 'tabla') ? 'block' : 'none';
};

window.limpiarBuscadorDirectorio = function () {
  const input = $('srchDirectorio');
  if (input) input.value = '';
  filtrarDirectorio();
};

window.limpiarTodosFiltrosDirectorio = function () {
  const input = $('srchDirectorio');
  const selArea = $('filtroAreaDirectorio');
  const selRol = $('filtroRolDirectorio');
  const selEstado = $('filtroEstadoDirectorio');
  const selAlm = $('filtroAlmuerzoDirectorio');
  const selCumple = $('filtroCumpleanosDirectorio');

  if (input) input.value = '';
  if (selArea) selArea.value = '';
  if (selRol) selRol.value = '';
  if (selEstado) selEstado.value = '';
  if (selAlm) selAlm.value = '';
  if (selCumple) selCumple.value = '';

  window.directorioFiltroKpi = 'todos';
  document.querySelectorAll('.directorio-kpi-grid .kpi-card').forEach(c => c.classList.remove('active'));
  const cardTodos = $('kpiDirCardTodos');
  if (cardTodos) cardTodos.classList.add('active');

  filtrarDirectorio();
};

window.renderBannerCumpleanosDirectorio = function (listaCumples) {
  const banner = $('dirBannerCumpleanos');
  if (!banner) return;

  if (!listaCumples || listaCumples.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  // Ordenar por días faltantes (hoy primero)
  listaCumples.sort((a, b) => a.estado.diasFaltan - b.estado.diasFaltan);

  const hayHoy = listaCumples.some(item => item.estado.esHoy);

  const chipsHtml = listaCumples.map(item => {
    const e = item.emp;
    const st = item.estado;
    const nombreFmt = (typeof obtenerPrimerNombreYPrimerApellido === 'function')
      ? obtenerPrimerNombreYPrimerApellido(e.nombre)
      : (e.nombre || 'Colaborador');
    const edadStr = st.edad ? ` (${st.edad} años)` : '';

    if (st.esHoy) {
      return `
        <div style="background:#fef3c7; border:1.5px solid #f59e0b; border-radius:10px; padding:6px 12px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 2px 5px rgba(245,158,11,0.15);">
          <span style="font-size:16px;">🎂</span>
          <div>
            <div style="font-weight:800; font-size:12px; color:#92400e;">¡Hoy! ${escapeHtml(nombreFmt)}${edadStr}</div>
            <div style="font-size:10px; color:#b45309;">${escapeHtml(e.cargo || e.area || '')}</div>
          </div>
          <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:#16a34a; color:white; border:none; border-radius:6px; padding:4px 9px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin-left:4px;" title="Felicitar por WhatsApp">
            <i class="fab fa-whatsapp"></i> Felicitar
          </button>
        </div>`;
    }

    const diasText = st.diasFaltan === 1 ? 'Mañana' : `En ${st.diasFaltan} días`;
    return `
      <div style="background:#ffffff; border:1px solid #fed7aa; border-radius:10px; padding:6px 12px; display:inline-flex; align-items:center; gap:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <span style="font-size:14px; color:#ea580c;">🎉</span>
        <div>
          <div style="font-weight:750; font-size:11.5px; color:#1e293b;">${escapeHtml(nombreFmt)}${edadStr}</div>
          <div style="font-size:10px; color:#ea580c; font-weight:600;">${diasText} (${st.fechaLegible})</div>
        </div>
        <button type="button" onclick="window.abrirModalMensajeIndividualWhatsApp('${e.id}')" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:3px 7px; font-size:10px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:3px; margin-left:2px;" title="Enviar WhatsApp">
          <i class="fab fa-whatsapp"></i>
        </button>
      </div>`;
  }).join('');

  banner.innerHTML = `
    <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border:1px solid #fde68a; border-radius:14px; padding:12px 16px; box-shadow:0 3px 8px rgba(245,158,11,0.08);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">${hayHoy ? '🎂' : '🗓️'}</span>
          <span style="font-weight:800; font-size:13px; color:#92400e;">
            ${hayHoy ? '¡Cumpleaños de Hoy y Próximos Colaboradores!' : 'Próximos Cumpleaños (15 días)'}
          </span>
          <span style="background:#fde68a; color:#78350f; padding:1px 7px; border-radius:20px; font-size:10.5px; font-weight:800;">${listaCumples.length}</span>
        </div>
        <button type="button" onclick="window.setFiltroKpiDirectorio('cumpleanos')" style="background:none; border:none; color:#b45309; font-size:11.5px; font-weight:700; cursor:pointer; text-decoration:underline;">
          Ver todos en la lista →
        </button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        ${chipsHtml}
      </div>
    </div>`;

  banner.style.display = 'block';
};

window.cargarDirectorio = function () {
  if (!empCache || empCache.length === 0) {
    return;
  }

  // 1. Calcular KPIs
  const total = empCache.length;
  const activos = empCache.filter(e => e.activo !== 'NO').length;
  const inactivos = empCache.filter(e => e.activo === 'NO').length;
  const supervisores = empCache.filter(e => {
    const sup = String(e.supervisor || '').toUpperCase();
    return sup === 'SI' || sup === 'SUPERVISOR ADMIN';
  }).length;
  const conWp = empCache.filter(e => e.telefono && String(e.telefono).trim().length >= 7).length;

  // Calcular cumpleaños de colaboradores activos (hoy y próximos 30 días)
  let countCumpleanosHoy = 0;
  let countCumpleanosProximos = 0;
  const listaCumplesCercanos = [];

  empCache.forEach(e => {
    if (e.activo === 'NO') return;
    const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
      ? obtenerFechaNacimientoEmpleado(e)
      : (e.fechaNacimiento || e.fecha_nacimiento || '');
    const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
      ? obtenerEstadoCumpleanos(rawN)
      : null;
    if (!estadoC) return;
    if (estadoC.esHoy) {
      countCumpleanosHoy++;
      listaCumplesCercanos.push({ emp: e, estado: estadoC });
    } else if (estadoC.diasFaltan <= 30) {
      countCumpleanosProximos++;
      if (estadoC.diasFaltan <= 15) {
        listaCumplesCercanos.push({ emp: e, estado: estadoC });
      }
    }
  });

  const totalCumpleanos = countCumpleanosHoy + countCumpleanosProximos;

  if ($('dirKpiTotal')) $('dirKpiTotal').textContent = total;
  if ($('dirKpiActivos')) $('dirKpiActivos').textContent = activos;
  if ($('dirKpiInactivos')) $('dirKpiInactivos').textContent = inactivos;
  if ($('dirKpiSupervisores')) $('dirKpiSupervisores').textContent = supervisores;
  if ($('dirKpiWhatsApp')) $('dirKpiWhatsApp').textContent = conWp;
  if ($('dirKpiCumpleanos')) $('dirKpiCumpleanos').textContent = totalCumpleanos;
  if ($('dirKpiCumpleanosSub')) {
    $('dirKpiCumpleanosSub').textContent = countCumpleanosHoy > 0
      ? `🎂 ${countCumpleanosHoy} Hoy · ${countCumpleanosProximos} próx.`
      : `${totalCumpleanos} en próx. 30 días`;
  }

  // Renderizar banner interactivo de cumpleaños si hay cumpleañeros cercanos
  if (typeof renderBannerCumpleanosDirectorio === 'function') {
    renderBannerCumpleanosDirectorio(listaCumplesCercanos);
  }

  // 2. Poblar selector y datalists de Áreas y Cargos
  const selArea = $('filtroAreaDirectorio');
  const valAreaActual = selArea ? selArea.value : '';
  const areasSet = new Set();
  const cargosSet = new Set();

  empCache.forEach(e => {
    if (e.area && String(e.area).trim()) areasSet.add(String(e.area).trim().toUpperCase());
    if (e.cargo && String(e.cargo).trim()) cargosSet.add(String(e.cargo).trim());
  });

  const areasSorted = Array.from(areasSet).sort((a, b) => a.localeCompare(b));
  const cargosSorted = Array.from(cargosSet).sort((a, b) => a.localeCompare(b));

  if (selArea) {
    let optsHtml = '<option value="">🏢 Todas las áreas</option>';
    areasSorted.forEach(a => {
      optsHtml += `<option value="${escapeHtml(a)}" ${a === valAreaActual ? 'selected' : ''}>${escapeHtml(a)}</option>`;
    });
    selArea.innerHTML = optsHtml;
  }

  // Datalists para los modales
  const dlAreas = $('listaAreasDirectorioDatalist');
  if (dlAreas) {
    dlAreas.innerHTML = areasSorted.map(a => `<option value="${escapeHtml(a)}">`).join('');
  }
  const dlCargos = $('listaCargosDirectorioDatalist');
  if (dlCargos) {
    dlCargos.innerHTML = cargosSorted.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  // 3. Restaurar vista preferida (grid vs tabla)
  cambiarVistaDirectorio(window.directorioVista || 'grid');

  // 4. Ejecutar filtrado y renderizado
  filtrarDirectorio();
};

window.filtrarDirectorio = function () {
  if (!empCache) return;

  const srchEl = $('srchDirectorio');
  const term = srchEl ? srchEl.value.trim().toLowerCase() : '';
  const areaFiltro = $('filtroAreaDirectorio') ? $('filtroAreaDirectorio').value.toUpperCase() : '';
  const rolFiltro = $('filtroRolDirectorio') ? $('filtroRolDirectorio').value : '';
  const estadoFiltro = $('filtroEstadoDirectorio') ? $('filtroEstadoDirectorio').value : '';
  const almFiltro = $('filtroAlmuerzoDirectorio') ? $('filtroAlmuerzoDirectorio').value : '';
  const cumpleFiltro = $('filtroCumpleanosDirectorio') ? $('filtroCumpleanosDirectorio').value : '';
  const kpiFiltro = window.directorioFiltroKpi || 'todos';

  // Botón limpiar búsqueda
  const btnLimpiar = $('btnLimpiarSrchDir');
  if (btnLimpiar) btnLimpiar.style.display = term ? 'block' : 'none';

  // Indicador de filtros activos
  const indicadorFiltros = $('dirFiltroActivoIndicator');
  const hayFiltrosActivos = (term !== '' || areaFiltro !== '' || rolFiltro !== '' || (estadoFiltro !== '' && estadoFiltro !== 'SI') || almFiltro !== '' || cumpleFiltro !== '' || kpiFiltro !== 'todos');
  if (indicadorFiltros) indicadorFiltros.style.display = hayFiltrosActivos ? 'block' : 'none';

  // Filtrar empleados
  const filtrados = empCache.filter(emp => {
    // 1. Buscador texto
    if (term) {
      const matchId = String(emp.id || '').toLowerCase().includes(term);
      const matchNom = String(emp.nombre || '').toLowerCase().includes(term);
      const matchArea = String(emp.area || '').toLowerCase().includes(term);
      const matchCargo = String(emp.cargo || '').toLowerCase().includes(term);
      const matchTel = String(emp.telefono || '').toLowerCase().includes(term);
      const rawNac = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const matchNac = rawNac ? String(rawNac).toLowerCase().includes(term) : false;
      if (!matchId && !matchNom && !matchArea && !matchCargo && !matchTel && !matchNac) return false;
    }

    // 2. Filtro Área
    if (areaFiltro && String(emp.area || '').toUpperCase() !== areaFiltro) {
      return false;
    }

    // 3. Filtro Rol
    if (rolFiltro) {
      const sup = String(emp.supervisor || '').toUpperCase();
      if (rolFiltro === 'SUPERVISOR_ADMIN' && sup !== 'SUPERVISOR ADMIN') return false;
      if (rolFiltro === 'SUPERVISOR' && sup !== 'SI' && sup !== 'SUPERVISOR ADMIN') return false;
      if (rolFiltro === 'REGULAR' && (sup === 'SI' || sup === 'SUPERVISOR ADMIN')) return false;
    }

    // 4. Filtro Estado (Activo / Inactivo)
    if (estadoFiltro) {
      const esActivo = emp.activo !== 'NO';
      if (estadoFiltro === 'SI' && !esActivo) return false;
      if (estadoFiltro === 'NO' && esActivo) return false;
    }

    // 5. Filtro Almuerzo Hoy
    if (almFiltro) {
      const almEmp = (typeof resolverAlmuerzoHoyEmpleado === 'function')
        ? resolverAlmuerzoHoyEmpleado(emp)
        : (emp.almuerzoHoy || '');
      if (almFiltro === 'SI' && almEmp !== 'SI') return false;
      if (almFiltro === 'NO' && almEmp !== 'NO') return false;
      if (almFiltro === 'SIN_ASIGNAR' && almEmp !== '') return false;
    }

    // 6. Filtro Cumpleaños Dropdown
    if (cumpleFiltro) {
      const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
        ? obtenerEstadoCumpleanos(rawN)
        : null;
      if (!estadoC) return false;
      if (cumpleFiltro === 'HOY' && !estadoC.esHoy) return false;
      if (cumpleFiltro === '7' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 7)) return false;
      if (cumpleFiltro === '15' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 15)) return false;
      if (cumpleFiltro === '30' && (estadoC.diasFaltan < 0 || estadoC.diasFaltan > 30)) return false;
    }

    // 7. Filtro KPI clicado
    if (kpiFiltro === 'activos' && emp.activo === 'NO') return false;
    if (kpiFiltro === 'inactivos' && emp.activo !== 'NO') return false;
    if (kpiFiltro === 'supervisores') {
      const sup = String(emp.supervisor || '').toUpperCase();
      if (sup !== 'SI' && sup !== 'SUPERVISOR ADMIN') return false;
    }
    if (kpiFiltro === 'whatsapp') {
      if (!emp.telefono || String(emp.telefono).trim().length < 7) return false;
    }
    if (kpiFiltro === 'cumpleanos') {
      const rawN = (typeof obtenerFechaNacimientoEmpleado === 'function')
        ? obtenerFechaNacimientoEmpleado(emp)
        : (emp.fechaNacimiento || emp.fecha_nacimiento || '');
      const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
        ? obtenerEstadoCumpleanos(rawN)
        : null;
      if (!estadoC || (!estadoC.esHoy && estadoC.diasFaltan > 30)) return false;
    }

    return true;
  });

  window.directorioUltimaLista = filtrados;

  // Actualizar contadores
  if ($('dirConteoFiltrados')) $('dirConteoFiltrados').textContent = filtrados.length;
  if ($('dirConteoTotal')) $('dirConteoTotal').textContent = empCache.length;

  // Renderizar vistas
  const emptyState = $('directorioEmptyState');
  const containerGrid = $('directorioGridContainer');
  const containerTabla = $('directorioTablaContainer');

  if (filtrados.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (containerGrid) containerGrid.innerHTML = '';
    if ($('tbodyDirectorioTabla')) $('tbodyDirectorioTabla').innerHTML = '';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    renderDirectorioCards(filtrados);
    renderDirectorioTabla(filtrados);
  }
};

function normalizarEstadoAlmuerzo(val) {
  if (!val) return '';
  const v = String(val).toUpperCase().trim();
  if (v === 'SI' || v === 'SÍ' || v === 'PLANTA') return 'SI';
  if (v === 'NO' || v === 'FUERA') return 'NO';
  return '';
}
window.normalizarEstadoAlmuerzo = normalizarEstadoAlmuerzo;

function resolverAlmuerzoHoyEmpleado(emp, targetFecha) {
  if (!emp) return '';
  const fHoy = targetFecha || hoy || getLocalHoyStr();
  let val = emp.almuerzoHoy;
  if (!val && Array.isArray(emp.registros)) {
    const reg = emp.registros.find(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO' || r.tipo === 'ENTRADA_CAMPO') && normalizarFechaStr(r.fecha) === fHoy);
    if (reg && reg.almuerzo) val = reg.almuerzo;
  }
  return normalizarEstadoAlmuerzo(val);
}
window.resolverAlmuerzoHoyEmpleado = resolverAlmuerzoHoyEmpleado;

// ============================================================
// UTILIDADES PARA FECHA DE NACIMIENTO EN DIRECTORIO
// ============================================================
function obtenerFechaNacimientoEmpleado(emp) {
  if (!emp) return '';
  let val = emp.fechaNacimiento || emp.fecha_nacimiento || emp.fNacimiento || emp.fechanacimiento || '';
  if (val && typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      val = val.toDate();
    } else if (val.seconds !== undefined) {
      val = new Date(val.seconds * 1000);
    }
  }
  if (val instanceof Date && !isNaN(val)) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(val || '').trim();
}
window.obtenerFechaNacimientoEmpleado = obtenerFechaNacimientoEmpleado;

function normalizarFechaParaInput(val) {
  if (!val) return '';
  let s = String(val).trim().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('/')) {
    const p = s.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) {
        // DD/MM/YYYY -> YYYY-MM-DD
        const dd = p[0].padStart(2, '0');
        const mm = p[1].padStart(2, '0');
        return `${p[2]}-${mm}-${dd}`;
      } else if (p[0].length === 4) {
        // YYYY/MM/DD -> YYYY-MM-DD
        const mm = p[1].padStart(2, '0');
        const dd = p[2].padStart(2, '0');
        return `${p[0]}-${mm}-${dd}`;
      }
    }
  }
  if (s.includes('-')) {
    const p = s.split('-');
    if (p.length === 3 && p[2].length === 4) {
      // DD-MM-YYYY -> YYYY-MM-DD
      const dd = p[0].padStart(2, '0');
      const mm = p[1].padStart(2, '0');
      return `${p[2]}-${mm}-${dd}`;
    }
  }
  return s;
}
window.normalizarFechaParaInput = normalizarFechaParaInput;

function calcularEdad(fechaVal) {
  if (!fechaVal) return null;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return null;
  const [anioStr, mesStr, diaStr] = norm.split('-');
  const anio = parseInt(anioStr, 10);
  const mes = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);
  if (isNaN(anio) || isNaN(mes) || isNaN(dia)) return null;

  const hoyD = new Date();
  let edad = hoyD.getFullYear() - anio;
  const m = hoyD.getMonth() - mes;
  if (m < 0 || (m === 0 && hoyD.getDate() < dia)) {
    edad--;
  }
  return (edad >= 0 && edad < 120) ? edad : null;
}
window.calcularEdad = calcularEdad;

function esCumpleanosFecha(fechaVal) {
  if (!fechaVal) return false;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return false;
  const parts = norm.split('-');
  const mes = parseInt(parts[1], 10);
  const dia = parseInt(parts[2], 10);
  const hoyD = new Date();
  return (hoyD.getMonth() + 1 === mes && hoyD.getDate() === dia);
}
window.esCumpleanosFecha = esCumpleanosFecha;

function formatearFechaNacimientoLegible(fechaVal) {
  if (!fechaVal) return '';
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return String(fechaVal);
  const [yyyy, mmStr, ddStr] = norm.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mIdx = parseInt(mmStr, 10) - 1;
  const mesNom = meses[mIdx] || mmStr;
  return `${parseInt(ddStr, 10)} ${mesNom} ${yyyy}`;
}
window.formatearFechaNacimientoLegible = formatearFechaNacimientoLegible;

function obtenerEstadoCumpleanos(fechaVal) {
  if (!fechaVal) return null;
  const norm = normalizarFechaParaInput(fechaVal);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return null;
  const [anioStr, mesStr, diaStr] = norm.split('-');
  const anio = parseInt(anioStr, 10);
  const mes = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);
  if (isNaN(mes) || isNaN(dia)) return null;

  const hoyD = new Date();
  const hoyAnio = hoyD.getFullYear();
  const hoyCero = new Date(hoyAnio, hoyD.getMonth(), hoyD.getDate(), 0, 0, 0, 0);

  // Fecha de cumpleaños este año
  let proximoCump = new Date(hoyAnio, mes, dia, 0, 0, 0, 0);

  // Si ya pasó este año, el próximo es el año que viene
  if (proximoCump.getTime() < hoyCero.getTime()) {
    proximoCump = new Date(hoyAnio + 1, mes, dia, 0, 0, 0, 0);
  }

  const diffMs = proximoCump.getTime() - hoyCero.getTime();
  const diasFaltan = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const esHoy = (diasFaltan === 0);
  const edadCumplida = (!isNaN(anio) && anio > 1900) ? (proximoCump.getFullYear() - anio) : null;
  const fLegible = formatearFechaNacimientoLegible(fechaVal);

  return {
    esHoy,
    esProximo: (diasFaltan > 0 && diasFaltan <= 30),
    diasFaltan,
    edad: edadCumplida,
    fechaLegible: fLegible
  };
}
window.obtenerEstadoCumpleanos = obtenerEstadoCumpleanos;

function capitalizarPalabra(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
window.capitalizarPalabra = capitalizarPalabra;

function obtenerPrimerNombreYPrimerApellido(nombreCompleto) {
  if (!nombreCompleto) return 'Colaborador';
  const clean = String(nombreCompleto).trim();
  if (!clean) return 'Colaborador';
  const partes = clean.split(/\s+/);

  if (partes.length === 1) {
    return capitalizarPalabra(partes[0]);
  }
  if (partes.length === 2) {
    return `${capitalizarPalabra(partes[1])} ${capitalizarPalabra(partes[0])}`;
  }
  if (partes.length >= 3) {
    // Formato oficial habitual en nóminas de Ecuador:
    // [APELLIDO PATERNO] [APELLIDO MATERNO] [PRIMER NOMBRE] [SEGUNDO NOMBRE...]
    // Ejemplo: ABALCO CHUQUIN NAYDELIN RUBIELA -> Naydelin Abalco
    const primerApellido = capitalizarPalabra(partes[0]);
    const primerNombre = capitalizarPalabra(partes[2]);
    return `${primerNombre} ${primerApellido}`;
  }
  return clean;
}
window.obtenerPrimerNombreYPrimerApellido = obtenerPrimerNombreYPrimerApellido;

window.renderDirectorioCards = function (lista) {
  const container = $('directorioGridContainer');
  if (!container) return;

  container.innerHTML = lista.map(emp => {
    const esActivo = emp.activo !== 'NO';
    const supUpper = String(emp.supervisor || '').toUpperCase();
    const esAdmin = supUpper === 'SUPERVISOR ADMIN';
    const esSup = supUpper === 'SI';

    let rolBadge = `<span class="dir-badge-pill dir-badge-rol-reg"><i class="fas fa-user"></i> Empleado</span>`;
    if (esAdmin) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-admin"><i class="fas fa-crown"></i> Sup. Admin</span>`;
    } else if (esSup) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-sup"><i class="fas fa-user-shield"></i> Supervisor</span>`;
    }

    const rawTel = (emp.telefono || '').toString().trim();
    let wpBadgeHtml = '';
    if (rawTel && rawTel.length >= 7) {
      wpBadgeHtml = `
            <a href="javascript:void(0)" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp a ${escapeHtml(emp.nombre)}" style="color:#16a34a; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-size:11.5px;">
              <i class="fab fa-whatsapp" style="font-size:13px;"></i> ${escapeHtml(rawTel)}
            </a>`;
    } else {
      wpBadgeHtml = `
            <span style="color:#94a3b8; font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para agregar WhatsApp">
              <i class="fab fa-whatsapp" style="color:#cbd5e1;"></i> Sin registrar
            </span>`;
    }

    const rawFNac = obtenerFechaNacimientoEmpleado(emp);
    const estadoC = obtenerEstadoCumpleanos(rawFNac);
    const fNacLegible = estadoC ? estadoC.fechaLegible : formatearFechaNacimientoLegible(rawFNac);

    let fNacCardHtml = '';
    if (estadoC && estadoC.esHoy) {
      fNacCardHtml = `
            <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:800; display:inline-flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(245,158,11,0.2);" title="¡Hoy es su cumpleaños! Fecha: ${escapeHtml(fNacLegible)}">
              🎂 ¡Hoy! ${estadoC.edad !== null ? `(${estadoC.edad} años)` : ''}
            </span>`;
    } else if (estadoC && estadoC.diasFaltan <= 7) {
      fNacCardHtml = `
            <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:750; display:inline-flex; align-items:center; gap:4px;" title="Próximo cumpleaños en ${estadoC.diasFaltan} días (${escapeHtml(fNacLegible)})">
              🎉 En ${estadoC.diasFaltan} día${estadoC.diasFaltan > 1 ? 's' : ''} ${estadoC.edad !== null ? `(${estadoC.edad} a.)` : ''}
            </span>`;
    } else if (estadoC && estadoC.diasFaltan <= 30) {
      fNacCardHtml = `
            <span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 8px; border-radius:8px; font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; gap:4px;" title="Cumpleaños próximo: ${escapeHtml(fNacLegible)}">
              🗓️ En ${estadoC.diasFaltan} días ${estadoC.edad !== null ? `(${estadoC.edad} a.)` : ''}
            </span>`;
    } else if (fNacLegible) {
      const edadEmp = calcularEdad(rawFNac);
      fNacCardHtml = `
            <span style="color:#1e293b; font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="Fecha de nacimiento">
              ${escapeHtml(fNacLegible)} ${edadEmp !== null ? `<span style="color:#64748b; font-size:10.5px; font-weight:500;">(${edadEmp} a.)</span>` : ''}
            </span>`;
    } else {
      fNacCardHtml = `
            <span style="color:#94a3b8; font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para registrar fecha de nacimiento">
              <i class="fas fa-calendar-plus" style="color:#cbd5e1;"></i> Sin registrar
            </span>`;
    }

    const almNorm = resolverAlmuerzoHoyEmpleado(emp);
    let almBadge = `<span style="font-size:10px; color:#94a3b8; font-weight:600;"><i class="fas fa-minus-circle"></i> Sin registro</span>`;
    if (almNorm === 'SI') {
      almBadge = `<span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:750;"><i class="fas fa-utensils"></i> Planta</span>`;
    } else if (almNorm === 'NO') {
      almBadge = `<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:750;"><i class="fas fa-motorcycle"></i> Fuera</span>`;
    }

    // Foto con marco
    const fotoHtml = (typeof photoCell === 'function') ? photoCell(emp, 'medium') : `
          <div style="width:58px; height:58px; border-radius:50%; background:linear-gradient(135deg, var(--red), var(--red-dk)); color:white; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:18px;">
            ${(emp.nombre || '?').charAt(0)}
          </div>`;

    return `
          <div class="dir-emp-card">
            <!-- Header de Tarjeta -->
            <div class="dir-card-header">
              <div class="dir-photo-container" onclick="mostrarDetalle('${emp.id}')" title="Ver detalle completo de asistencia">
                ${fotoHtml}
                <div class="dir-status-dot ${esActivo ? 'active' : 'inactive'}" title="${esActivo ? 'Usuario Activo' : 'Usuario Inactivo'}"></div>
              </div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                  <h4 style="margin:0; font-size:13.5px; font-weight:750; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="${escapeHtml(emp.nombre)}">
                    ${escapeHtml(emp.nombre)}
                  </h4>
                  ${rolBadge}
                </div>
                <div style="display:flex; gap:6px; align-items:center; margin-top:3px; font-size:11px; color:#64748b; font-weight:600;">
                  <span style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-family:'Fira Code', monospace;">ID: ${escapeHtml(emp.id)}</span>
                  <span>·</span>
                  <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(emp.cargo || 'Sin cargo')}">${escapeHtml(emp.cargo || 'Sin cargo')}</span>
                </div>
              </div>
            </div>

            <!-- Cuerpo de Tarjeta -->
            <div class="dir-card-body">
              <div class="dir-info-row">
                <span><i class="fas fa-building" style="color:#64748b; margin-right:4px;"></i> Área:</span>
                <strong style="color:#1e293b; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(emp.area || 'Sin área')}</strong>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-cake-candles" style="color:#f59e0b; margin-right:4px;"></i> F. Nacimiento:</span>
                <div>${fNacCardHtml}</div>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-phone-alt" style="color:#64748b; margin-right:4px;"></i> Contacto:</span>
                <div>${wpBadgeHtml}</div>
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-user-check" style="color:#64748b; margin-right:4px;"></i> Estado:</span>
                ${esActivo
        ? `<span style="background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:750; border:1px solid #bbf7d0;"><i class="fas fa-check-circle" style="font-size:8px;"></i> Activo</span>`
        : `<span style="background:#fee2e2; color:#be123c; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:750; border:1px solid #fecaca;"><i class="fas fa-ban" style="font-size:8px;"></i> Inactivo</span>`
      }
              </div>
              <div class="dir-info-row">
                <span><i class="fas fa-utensils" style="color:#64748b; margin-right:4px;"></i> Almuerzo Hoy:</span>
                <div style="display:flex; align-items:center; gap:6px;">
                  ${almBadge}
                  <select onchange="window.cambiarAlmuerzoDirectorio('${emp.id}', this.value)" class="dir-alm-select ${almNorm === 'SI' ? 'is-planta' : (almNorm === 'NO' ? 'is-fuera' : 'is-none')}" title="Cambiar almuerzo de hoy para este colaborador">
                    <option value="SI" ${almNorm === 'SI' ? 'selected' : ''}>Planta (Sí)</option>
                    <option value="NO" ${almNorm === 'NO' ? 'selected' : ''}>Fuera (No)</option>
                    <option value="" ${!almNorm ? 'selected' : ''}>— Sin asignar —</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Barra de Acciones Rápidas -->
            <div class="dir-card-actions">
              <button type="button" class="dir-btn-action btn-edit" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Editar ficha completa del usuario (Área, Cargo, PIN, Rol, WhatsApp)">
                <i class="fas fa-user-edit"></i> Editar
              </button>
              <button type="button" class="dir-btn-action btn-detail" onclick="mostrarDetalle('${emp.id}')" title="Ver expediente de asistencia 360 y registros">
                <i class="fas fa-id-badge"></i> Detalle
              </button>
              <button type="button" class="dir-btn-action btn-wp" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp directo">
                <i class="fab fa-whatsapp"></i>
              </button>
              <button type="button" class="dir-btn-action btn-key" onclick="window.resetearPasswordEmpleado('${emp.id}', '${escapeHtml(emp.nombre)}')" title="Resetear contraseña / PIN de vinculación">
                <i class="fas fa-key"></i>
              </button>
              <button type="button" class="dir-btn-action" onclick="window.mostrarModalFuturos('${emp.id}')" title="Programar evento o ausencia (permiso, vacación)" style="background:#faf5ff; border-color:#e9d5ff; color:#7e22ce;">
                <i class="fas fa-calendar-plus"></i>
              </button>
              <button type="button" class="dir-btn-action" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" title="Registrar salida o trabajo en campo" style="background:#f0fdf4; border-color:#bbf7d0; color:#15803d;">
                <i class="fas fa-hammer"></i>
              </button>
            </div>
          </div>`;
  }).join('');
};

window.renderDirectorioTabla = function (lista) {
  const tbody = $('tbodyDirectorioTabla');
  if (!tbody) return;

  tbody.innerHTML = lista.map(emp => {
    const esActivo = emp.activo !== 'NO';
    const supUpper = String(emp.supervisor || '').toUpperCase();
    const esAdmin = supUpper === 'SUPERVISOR ADMIN';
    const esSup = supUpper === 'SI';

    let rolBadge = `<span class="dir-badge-pill dir-badge-rol-reg"><i class="fas fa-user"></i> Empleado</span>`;
    if (esAdmin) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-admin"><i class="fas fa-crown"></i> Sup. Admin</span>`;
    } else if (esSup) {
      rolBadge = `<span class="dir-badge-pill dir-badge-rol-sup"><i class="fas fa-user-shield"></i> Supervisor</span>`;
    }

    const rawTel = (emp.telefono || '').toString().trim();
    let wpCell = `<span style="color:#94a3b8; font-size:11px;">—</span>`;
    if (rawTel && rawTel.length >= 7) {
      wpCell = `
            <a href="javascript:void(0)" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" style="color:#16a34a; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-size:11.5px;" title="Enviar WhatsApp">
              <i class="fab fa-whatsapp"></i> ${escapeHtml(rawTel)}
            </a>`;
    }

    const almNorm = resolverAlmuerzoHoyEmpleado(emp);

    const fotoMini = (typeof photoCell === 'function') ? photoCell(emp, 'small') : `
          <div style="width:30px; height:30px; border-radius:50%; background:var(--blue); color:white; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">
            ${(emp.nombre || '?').charAt(0)}
          </div>`;

    return `
          <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
            <!-- Colaborador -->
            <td style="padding:10px 12px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="Ver detalle">
                  ${fotoMini}
                </div>
                <div>
                  <div style="font-weight:750; font-size:12px; color:#0f172a; cursor:pointer;" onclick="mostrarDetalle('${emp.id}')" title="${escapeHtml(emp.nombre)}">
                    ${escapeHtml(emp.nombre)}
                  </div>
                  <div style="font-size:10.5px; color:#64748b; font-family:'Fira Code', monospace; margin-top:1px;">
                    ID: <strong>${escapeHtml(emp.id)}</strong>
                  </div>
                </div>
              </div>
            </td>

            <!-- Área & Cargo -->
            <td style="padding:10px 12px; font-size:11.5px;">
              <div style="font-weight:700; color:#1e293b;">${escapeHtml(emp.area || '—')}</div>
              <div style="font-size:10.5px; color:#64748b;">${escapeHtml(emp.cargo || '—')}</div>
            </td>

            <!-- F. Nacimiento -->
            <td style="padding:10px 12px; font-size:11.5px; white-space:nowrap;">
              ${(() => {
                const rawN = obtenerFechaNacimientoEmpleado(emp);
                const estadoC = (typeof obtenerEstadoCumpleanos === 'function')
                  ? obtenerEstadoCumpleanos(rawN)
                  : null;
                const fLegible = estadoC ? estadoC.fechaLegible : formatearFechaNacimientoLegible(rawN);
                const edad = estadoC ? estadoC.edad : calcularEdad(rawN);

                if (estadoC && estadoC.esHoy) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2.5px 8px; border-radius:6px; font-size:10.5px; font-weight:800; display:inline-flex; align-items:center; gap:4px; width:fit-content; box-shadow:0 1px 3px rgba(245,158,11,0.2);" title="¡Hoy es su cumpleaños!">
                        🎂 ¡Hoy! ${edad !== null ? `(${edad} años)` : ''}
                      </span>
                      <span style="color:#475569; font-size:10.5px; font-weight:600;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (estadoC && estadoC.diasFaltan <= 7) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800; display:inline-flex; align-items:center; gap:4px; width:fit-content;" title="Próximo cumpleaños en ${estadoC.diasFaltan} días">
                        🎉 En ${estadoC.diasFaltan} día${estadoC.diasFaltan > 1 ? 's' : ''} ${edad !== null ? `(${edad} a.)` : ''}
                      </span>
                      <span style="color:#64748b; font-size:10.5px;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (estadoC && estadoC.diasFaltan <= 30) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <span style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; padding:2px 7px; border-radius:6px; font-size:10px; font-weight:700; display:inline-flex; align-items:center; gap:4px; width:fit-content;" title="Cumpleaños próximo en ${estadoC.diasFaltan} días">
                        🗓️ En ${estadoC.diasFaltan} días ${edad !== null ? `(${edad} a.)` : ''}
                      </span>
                      <span style="color:#64748b; font-size:10.5px;">${escapeHtml(fLegible)}</span>
                    </div>`;
                }
                if (fLegible) {
                  return `
                    <div style="display:flex; flex-direction:column; gap:1px;">
                      <span style="font-weight:700; color:#1e293b; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
                        <i class="fas fa-cake-candles" style="color:#f59e0b; font-size:10px;"></i> ${escapeHtml(fLegible)}
                      </span>
                      ${edad !== null ? `<span style="font-size:10.5px; color:#64748b;">${edad} años</span>` : ''}
                    </div>`;
                }
                return `
                  <span style="color:#94a3b8; font-size:11px; cursor:pointer;" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Clic para registrar fecha de nacimiento">
                    <i class="fas fa-calendar-plus" style="color:#cbd5e1; margin-right:3px;"></i>—
                  </span>`;
              })()}
            </td>

            <!-- Contacto WhatsApp -->
            <td style="padding:10px 12px;">
              ${wpCell}
            </td>

            <!-- Almuerzo Hoy -->
            <td style="padding:10px 12px; text-align:center;">
              <select onchange="window.cambiarAlmuerzoDirectorio('${emp.id}', this.value)" class="dir-alm-select ${almNorm === 'SI' ? 'is-planta' : (almNorm === 'NO' ? 'is-fuera' : 'is-none')}" title="Almuerzo de hoy: clic para modificar">
                <option value="SI" ${almNorm === 'SI' ? 'selected' : ''}>🍱 Planta (Sí)</option>
                <option value="NO" ${almNorm === 'NO' ? 'selected' : ''}>🥪 Fuera (No)</option>
                <option value="" ${!almNorm ? 'selected' : ''}>⚪ Sin registro</option>
              </select>
            </td>

            <!-- Acciones Rápidas -->
            <td style="padding:10px 12px; text-align:center;">
              <div class="dir-table-actions">
                <button type="button" class="dir-table-btn" onclick="window.abrirModalEditarEmpleado('${emp.id}')" title="Editar Ficha de Usuario" style="color:#2563eb; border-color:#bfdbfe; background:#eff6ff;">
                  <i class="fas fa-user-edit"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="mostrarDetalle('${emp.id}')" title="Ver Detalle de Asistencia 360" style="color:#475569;">
                  <i class="fas fa-id-badge"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.abrirModalMensajeIndividualWhatsApp('${emp.id}')" title="Enviar WhatsApp" style="color:#16a34a; border-color:#bbf7d0; background:#f0fdf4;">
                  <i class="fab fa-whatsapp"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.resetearPasswordEmpleado('${emp.id}', '${escapeHtml(emp.nombre)}')" title="Resetear Contraseña / PIN" style="color:#be123c; border-color:#fecdd3; background:#fff1f2;">
                  <i class="fas fa-key"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.mostrarModalFuturos('${emp.id}')" title="Programar Ausencia o Permiso" style="color:#7c3aed; border-color:#ddd6fe; background:#f5f3ff;">
                  <i class="fas fa-calendar-plus"></i>
                </button>
                <button type="button" class="dir-table-btn" onclick="window.mostrarModalCampoSupervisor('${emp.id}')" title="Registrar Trabajo en Campo" style="color:#059669; border-color:#a7f3d0; background:#ecfdf5;">
                  <i class="fas fa-hammer"></i>
                </button>
              </div>
            </td>
          </tr>`;
  }).join('');
};

window.cambiarAlmuerzoDirectorio = async function (empleadoId, nuevoEstado) {
  if (!empleadoId) return;
  const estadoNorm = normalizarEstadoAlmuerzo(nuevoEstado); // 'SI', 'NO', or ''
  const fHoy = hoy || getLocalHoyStr();

  const idx = empCache.findIndex(e => String(e.id).trim() === String(empleadoId).trim());
  if (idx === -1) return;

  const emp = empCache[idx];
  const estadoAnterior = emp.almuerzoHoy || '';

  // Actualización optimista inmediata en memoria
  emp.almuerzoHoy = estadoNorm;

  if (!emp.registros) emp.registros = [];
  let reg = emp.registros.find(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO' || r.tipo === 'ENTRADA_CAMPO') && normalizarFechaStr(r.fecha) === fHoy);
  let regAnterior = reg ? reg.almuerzo : null;

  if (reg) {
    reg.almuerzo = estadoNorm;
  } else if (estadoNorm) {
    // Crear registro local SOLO_ALMUERZO para sincronizar conteos y reportes
    emp.registros.push({
      id: `${emp.id}_SOLO_ALMUERZO_${fHoy}`,
      empleadoId: emp.id,
      nombre: emp.nombre,
      fecha: fHoy,
      tipo: 'SOLO_ALMUERZO',
      almuerzo: estadoNorm,
      hora: new Date().toLocaleTimeString('es-EC', { hour12: false })
    });
  }

  // Refrescar UI y KPIs de inmediato
  if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
  if (typeof cargarAsistencia === 'function') cargarAsistencia();
  if (typeof cargarDashboard === 'function') cargarDashboard();

  const etiquetaAlm = estadoNorm === 'SI' ? 'Planta' : (estadoNorm === 'NO' ? 'Fuera' : 'Sin asignar');
  mostrarToast(`Almuerzo hoy: ${etiquetaAlm}`, 'info');

  try {
    const res = await jsonpRequest({
      accion: 'actualizarAlmuerzoSupervisor',
      empleadoId: empleadoId,
      almuerzo: estadoNorm,
      fecha: fHoy
    });
    if (res && !res.error) {
      mostrarToast(`Almuerzo guardado correctamente (${etiquetaAlm})`, 'success');
      limpiarCachesLocales();
    } else {
      mostrarToast(res?.error || 'Error al guardar almuerzo en servidor', 'error');
      // Revertir optimismo
      emp.almuerzoHoy = estadoAnterior;
      if (reg) reg.almuerzo = regAnterior;
      if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
      if (typeof cargarAsistencia === 'function') cargarAsistencia();
      if (typeof cargarDashboard === 'function') cargarDashboard();
    }
  } catch (err) {
    console.error("Error en cambiarAlmuerzoDirectorio:", err);
    mostrarToast('Error de conexión al actualizar almuerzo', 'error');
    emp.almuerzoHoy = estadoAnterior;
    if (reg) reg.almuerzo = regAnterior;
    if (typeof filtrarDirectorio === 'function') filtrarDirectorio();
    if (typeof cargarAsistencia === 'function') cargarAsistencia();
    if (typeof cargarDashboard === 'function') cargarDashboard();
  }
};

// ============================================================
// EXPORTACIÓN A EXCEL DEL DIRECTORIO
// ============================================================
window.exportarDirectorioExcel = async function () {

  const lista = (window.directorioUltimaLista && window.directorioUltimaLista.length > 0)
    ? window.directorioUltimaLista
    : (empCache || []);

  if (lista.length === 0) {
    mostrarToast('No hay colaboradores para exportar', 'warning');
    return;
  }

  mostrarLoader(true);
  try {
    await window.asegurarXLSX();
    const headers = [
      "Cédula / ID",
      "Nombre Completo",
      "Área / Departamento",
      "Cargo",
      "WhatsApp / Teléfono",
      "Fecha de Nacimiento",
      "Edad",
      "PIN / Contraseña",
      "Rol en el Sistema",
      "Estado Nómina",
      "Cultura Tcontrol",
      "Rol de Pagos",
      "Almuerzo Hoy"
    ];

    const rows = lista.map(emp => {
      const supUpper = String(emp.supervisor || '').toUpperCase();
      const rolTexto = (supUpper === 'SUPERVISOR ADMIN') ? 'Supervisor Admin' : (supUpper === 'SI' ? 'Supervisor' : 'Empleado Regular');
      const estadoTexto = (emp.activo === 'NO') ? 'Inactivo' : 'Activo';
      const culturaTexto = (emp.cultura_habilitada === false || emp.cultura_activa === false) ? 'Exonerado' : 'Habilitado';
      const rolPagosTexto = emp.id_dispositivo ? 'Vinculado' : 'Sin Rol';
      const almNorm = resolverAlmuerzoHoyEmpleado(emp);
      const almuerzoTexto = almNorm === 'SI' ? 'Planta' : (almNorm === 'NO' ? 'Fuera' : 'Sin registro');
      const rawNac = obtenerFechaNacimientoEmpleado(emp);
      const edadCalc = calcularEdad(rawNac);
      const fNacTexto = formatearFechaNacimientoLegible(rawNac);

      return [
        emp.id ? String(emp.id) : '',
        emp.nombre || '',
        emp.area || 'SIN ASIGNAR',
        emp.cargo || 'SIN ASIGNAR',
        emp.telefono || '',
        fNacTexto || '',
        edadCalc !== null ? edadCalc : '',
        emp.pin ? String(emp.pin) : '',
        rolTexto,
        estadoTexto,
        culturaTexto,
        rolPagosTexto,
        almuerzoTexto
      ];
    });

    const dataAoA = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(dataAoA);

    // Ajustar anchos de columnas
    ws['!cols'] = [
      { wch: 16 }, // Cédula
      { wch: 32 }, // Nombre
      { wch: 22 }, // Área
      { wch: 22 }, // Cargo
      { wch: 18 }, // WhatsApp
      { wch: 18 }, // Fecha de Nacimiento
      { wch: 8 },  // Edad
      { wch: 12 }, // PIN
      { wch: 20 }, // Rol
      { wch: 14 }, // Estado
      { wch: 18 }, // Cultura
      { wch: 15 }, // Rol de Pagos
      { wch: 16 }  // Almuerzo
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Directorio Colaboradores");

    const hoyStr = getLocalHoyStr();
    const filename = `Directorio_Personal_TCONTROL_${hoyStr}.xlsx`;
    XLSX.writeFile(wb, filename);

    mostrarLoader(false);
    mostrarToast(`Directorio exportado exitosamente (${rows.length} colaboradores)`, 'success');
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al exportar directorio a Excel:", err);
    mostrarToast('Error al generar archivo Excel: ' + err.message, 'error');
  }
};

// ============================================================
// MODALES DE EDICIÓN Y CREACIÓN DE USUARIOS EN DIRECTORIO
// ============================================================
window.abrirModalEditarEmpleado = function (empleadoId) {
  if (!empCache) return;
  const emp = empCache.find(e => e.id === empleadoId);
  if (!emp) {
    mostrarToast('Colaborador no encontrado', 'error');
    return;
  }

  if ($('editDirEmpIdOriginal')) $('editDirEmpIdOriginal').value = emp.id;
  if ($('editDirId')) $('editDirId').value = emp.id;
  if ($('editDirIdBadge')) $('editDirIdBadge').textContent = emp.id;
  if ($('editDirNombreBadge')) $('editDirNombreBadge').textContent = emp.nombre;
  if ($('editDirNombre')) $('editDirNombre').value = emp.nombre || '';
  if ($('editDirArea')) $('editDirArea').value = emp.area || '';
  if ($('editDirCargo')) $('editDirCargo').value = emp.cargo || '';
  if ($('editDirTelefono')) $('editDirTelefono').value = emp.telefono || '';
  if ($('editDirPin')) $('editDirPin').value = emp.pin || '';

  const fNacInputVal = normalizarFechaParaInput(obtenerFechaNacimientoEmpleado(emp));
  if ($('editDirFechaNacimiento')) $('editDirFechaNacimiento').value = fNacInputVal;

  const supUpper = String(emp.supervisor || '').toUpperCase();
  if ($('editDirSupervisor')) {
    if (supUpper === 'SUPERVISOR ADMIN') $('editDirSupervisor').value = 'SUPERVISOR ADMIN';
    else if (supUpper === 'SI') $('editDirSupervisor').value = 'SI';
    else $('editDirSupervisor').value = 'NO';
  }

  if ($('editDirActivo')) {
    $('editDirActivo').value = (emp.activo === 'NO') ? 'NO' : 'SI';
  }

  if ($('editDirCultura')) {
    $('editDirCultura').value = (emp.cultura_habilitada === false || emp.cultura_activa === false) ? 'NO' : 'SI';
  }

  const imgPreview = $('editDirFotoPreview');
  if (imgPreview) {
    imgPreview.src = emp.foto_url || './Logotipo T Control.png';
  }

  const modal = $('modalEditarEmpleadoDirectorio');
  if (modal) modal.classList.remove('hidden');
};

window.cerrarModalEditarEmpleadoDirectorio = function () {
  const modal = $('modalEditarEmpleadoDirectorio');
  if (modal) modal.classList.add('hidden');
};

window.guardarEdicionEmpleadoDirectorio = async function () {
  const id = $('editDirId') ? $('editDirId').value.trim() : '';
  const nombre = $('editDirNombre') ? $('editDirNombre').value.trim() : '';
  const area = $('editDirArea') ? $('editDirArea').value.trim().toUpperCase() : '';
  const cargo = $('editDirCargo') ? $('editDirCargo').value.trim() : '';
  const telefono = $('editDirTelefono') ? $('editDirTelefono').value.trim() : '';
  const pin = $('editDirPin') ? $('editDirPin').value.trim() : '';
  const supervisor = $('editDirSupervisor') ? $('editDirSupervisor').value : 'NO';
  const activo = $('editDirActivo') ? $('editDirActivo').value : 'SI';
  const cultura = $('editDirCultura') ? $('editDirCultura').value : 'SI';
  const fechaNacimiento = $('editDirFechaNacimiento') ? $('editDirFechaNacimiento').value.trim() : '';

  if (!id || !nombre || !area || !cargo) {
    mostrarToast('Por favor, completa los campos obligatorios (*)', 'warning');
    return;
  }

  const empActual = (empCache || []).find(e => String(e.id).trim() === String(id).trim());
  let pinFinal = pin;
  if (!pinFinal && empActual) {
    pinFinal = empActual.pin || '';
  } else if (pinFinal && (pinFinal.length !== 4 || isNaN(pinFinal))) {
    mostrarToast('Si ingresas un PIN, debe tener exactamente 4 dígitos numéricos', 'warning');
    return;
  }

  const datos = {
    nombre: nombre,
    area: area,
    cargo: cargo,
    telefono: telefono,
    pin: pinFinal,
    supervisor: supervisor,
    activo: activo,
    cultura_habilitada: (cultura === 'SI'),
    cultura_activa: (cultura === 'SI'),
    fechaNacimiento: fechaNacimiento
  };

  mostrarLoader(true);
  try {
    let res = null;
    if (window.FirebaseBackend && window.USE_FIREBASE) {
      res = await window.FirebaseBackend.actualizarEmpleado({
        empleadoId: id,
        datos: datos
      });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarEmpleado',
        empleadoId: id,
        datos: JSON.stringify(datos)
      });
    }

    mostrarLoader(false);

    if (res && (res.ok || !res.error)) {
      // Actualizar registro en empCache
      const idx = empCache.findIndex(e => e.id === id);
      if (idx > -1) {
        Object.assign(empCache[idx], datos);
      }

      cerrarModalEditarEmpleadoDirectorio();
      mostrarToast(`¡Colaborador ${nombre} actualizado exitosamente!`, 'success');

      // Refrescar vistas
      cargarDirectorio();
      if (typeof cargarAsistencia === 'function' && panelActual === 'asistencia') {
        cargarAsistencia();
      }
    } else {
      mostrarToast(res?.error || 'Error al actualizar colaborador', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al guardar edición de empleado:", err);
    mostrarToast('Error de conexión al guardar cambios', 'error');
  }
};

window.obtenerSiguienteIdDisponible = function () {
  const todos = [...(empCache || []), ...(window.empEliminadosCache || [])];
  const idsNumericos = todos
    .map(e => {
      const clean = String(e.id || '').trim();
      if (/^\d+$/.test(clean)) {
        return parseInt(clean, 10);
      }
      return null;
    })
    .filter(num => num !== null && num > 0);

  if (idsNumericos.length === 0) return '1';

  const ocupados = new Set(todos.map(e => String(e.id || '').trim()));
  let maxId = Math.max(...idsNumericos);
  let siguiente = maxId + 1;
  while (ocupados.has(String(siguiente))) {
    siguiente++;
  }
  return String(siguiente);
};

window.abrirModalNuevoEmpleadoDirectorio = function () {
  const form = $('formNuevoEmpleadoDirectorio');
  if (form) form.reset();
  if ($('nuevoDirFechaNacimiento')) $('nuevoDirFechaNacimiento').value = '';

  // Autocalcular y rellenar el siguiente ID disponible
  const siguienteId = window.obtenerSiguienteIdDisponible();
  if ($('nuevoDirId')) {
    $('nuevoDirId').value = siguienteId;
  }

  const modal = $('modalNuevoEmpleadoDirectorio');
  if (modal) modal.classList.remove('hidden');
};

window.cerrarModalNuevoEmpleadoDirectorio = function () {
  const modal = $('modalNuevoEmpleadoDirectorio');
  if (modal) modal.classList.add('hidden');
};

window.guardarNuevoEmpleadoDirectorio = async function () {
  const id = $('nuevoDirId') ? $('nuevoDirId').value.trim() : '';
  const nombre = $('nuevoDirNombre') ? $('nuevoDirNombre').value.trim() : '';
  const area = $('nuevoDirArea') ? $('nuevoDirArea').value.trim().toUpperCase() : '';
  const cargo = $('nuevoDirCargo') ? $('nuevoDirCargo').value.trim() : '';
  const telefono = $('nuevoDirTelefono') ? $('nuevoDirTelefono').value.trim() : '';
  const fechaNacimiento = $('nuevoDirFechaNacimiento') ? $('nuevoDirFechaNacimiento').value.trim() : '';
  const supervisor = $('nuevoDirSupervisor') ? $('nuevoDirSupervisor').value : 'NO';

  if (!id || !nombre || !area || !cargo) {
    mostrarToast('Por favor, completa todos los campos requeridos (*)', 'warning');
    return;
  }

  // Validar si ya existe el ID
  if (empCache && empCache.some(e => String(e.id).trim() === String(id).trim())) {
    mostrarToast(`Ya existe un colaborador con el ID ${id}`, 'error');
    return;
  }

  const empObj = {
    id: id,
    nombre: nombre,
    area: area,
    cargo: cargo,
    pin: '', // Clave vacía: el usuario creará su propio PIN/contraseña en su primer inicio de sesión
    telefono: telefono,
    supervisor: supervisor,
    activo: 'SI',
    cultura_habilitada: true,
    cultura_activa: true,
    fechaNacimiento: fechaNacimiento
  };

  mostrarLoader(true);
  try {
    let res = null;
    if (window.FirebaseBackend && window.USE_FIREBASE) {
      res = await window.FirebaseBackend.actualizarMasivoEmpleados({
        empleados: [empObj]
      });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarMasivoEmpleados',
        empleados: JSON.stringify([empObj])
      });
    }

    mostrarLoader(false);

    if (res && (res.ok || !res.error)) {
      // Agregar a empCache local
      if (empCache) {
        empCache.push(empObj);
        empCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
      }

      cerrarModalNuevoEmpleadoDirectorio();
      mostrarToast(`¡Colaborador ${nombre} registrado con éxito!`, 'success');

      // Identificar al supervisor en sesión para el reporte
      let creadorNombre = 'Supervisor';
      try {
        const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
        if (sessionStr) {
          const sess = JSON.parse(sessionStr);
          const supEmp = (empCache || []).find(x => String(x.id).trim() === String(sess.id).trim());
          creadorNombre = supEmp?.nombre || sess.nombre || `Supervisor (${sess.id})`;
        }
      } catch(e) {}

      // Enviar notificación con enlace al nuevo colaborador y alerta a supervisores
      if (window.OpenWAService && typeof window.OpenWAService.notificarNuevoEmpleadoRegistrado === 'function') {
        window.OpenWAService.notificarNuevoEmpleadoRegistrado(empObj, creadorNombre).then(waRes => {
          if (waRes && waRes.ok) {
            if (waRes.enviadoColaborador) {
              mostrarToast(`📲 Notificación y enlace enviados al WhatsApp de ${nombre}`, 'success');
            } else if (telefono) {
              mostrarToast(`Colaborador guardado. (Nota WhatsApp: no se pudo entregar al colaborador)`, 'info');
            }
            if (waRes.supervisoresNotificados > 0) {
              console.log(`[OpenWA] ${waRes.supervisoresNotificados} supervisores alertados sobre el nuevo usuario.`);
            }
          }
        }).catch(errWa => {
          console.warn("Error enviando notificaciones WhatsApp:", errWa);
        });
      }

      cargarDirectorio();
    } else {
      mostrarToast(res?.error || 'Error al registrar colaborador', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al registrar nuevo empleado:", err);
    mostrarToast('Error de conexión al registrar colaborador', 'error');
  }
};

// ============================================================
// MODAL PERMISO SUPERVISOR
// ============================================================
window.abrirModalPermiso = function (empleadoId, fecha, ppActual, pmActual) {
  // Eliminar modal anterior si existe
  const prev = document.getElementById('modalPermisoSupervisor');
  if (prev) prev.remove();

  const modal = document.createElement('div');
  modal.id = 'modalPermisoSupervisor';
  modal.style.cssText = `
        position:fixed;top:0;left:0;right:0;bottom:0;
        background:rgba(0,0,0,0.45);z-index:9999;
        display:flex;align-items:center;justify-content:center;
      `;
  modal.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:24px 28px;min-width:320px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
          <div style="font-weight:700;font-size:15px;margin-bottom:4px;color:#1e293b;">
            <i class="fas fa-clock" style="color:#6366f1;margin-right:6px;"></i>Asignar Permiso
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:16px;">${empleadoId} — ${fecha}</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div>
              <label style="font-size:11px;font-weight:600;color:#4b5563;display:block;margin-bottom:3px;">
                <i class="fas fa-user" style="color:#6366f1;"></i> Tiempo Personal (minutos)
              </label>
              <input id="mpPersMins" type="number" min="0" max="480" value="${ppActual || 0}"
                style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:#4b5563;display:block;margin-bottom:3px;">
                <i class="fas fa-stethoscope" style="color:#0d9488;"></i> Tiempo Médico (minutos)
              </label>
              <input id="mpMedMins" type="number" min="0" max="480" value="${pmActual || 0}"
                style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;">
            </div>
          </div>
          <div style="font-size:10px;color:#94a3b8;margin-top:8px;">
            ⓘ Ej: 60 = 1 hora. Los minutos se suman a T.Personal / T.Médico y reducen el Tiempo por Justificar.
          </div>
          <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end;">
            <button onclick="document.getElementById('modalPermisoSupervisor').remove()"
              style="padding:7px 16px;border-radius:8px;border:1px solid #d1d5db;background:#f8fafc;cursor:pointer;font-size:13px;">
              Cancelar
            </button>
            <button onclick="guardarPermiso('${empleadoId}','${fecha}','personal', document.getElementById('mpPersMins').value); guardarPermiso('${empleadoId}','${fecha}','medico', document.getElementById('mpMedMins').value);"
              style="padding:7px 18px;border-radius:8px;border:none;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">
              <i class="fas fa-save"></i> Guardar
            </button>
          </div>
        </div>
      `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};

// parsearInputTiempo: acepta "60", "1h", "1:30", "1h30m" → minutos enteros
function parsearInputTiempo(str) {
  str = String(str || '').trim().toLowerCase();
  // formato 1h30m o 1h
  const mh = str.match(/^(\d+)h(?:(\d+)m?)?$/);
  if (mh) return parseInt(mh[1]) * 60 + parseInt(mh[2] || 0);
  // formato 1:30
  const mc = str.match(/^(\d+):(\d{1,2})$/);
  if (mc) return parseInt(mc[1]) * 60 + parseInt(mc[2]);
  // formato puro minutos
  const n = parseInt(str);
  return isNaN(n) ? null : n;
}

function mapRazonAusenciaATipo(razon) {
  if (!razon) return 'FALTA';
  const r = razon.toString().trim().toLowerCase();
  if (r.includes('vacación') || r.includes('vacacion') || r.includes('vacaciones')) return 'VACACIONES';
  if (r.includes('médico') || r.includes('medico')) return 'PERMISO_MEDICO';
  if (r.includes('personal')) return 'PERMISO_PERSONAL';
  if (r.includes('doméstica') || r.includes('domestica') || r.includes('calamidad')) return 'CALAMIDAD_DOMESTICA';
  if (r.includes('campo')) return 'TRABAJO_DE_CAMPO';
  return r.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, '_');
}

window.guardarPermiso = async function (empleadoId, fecha, tipo, valor, comentario = null) {
  let sessionData = {};
  try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  const supervisorId = String(sessionData.id || '');

  // Modalidad: valor es 'EMPRESA' | 'CAMPO' | 'MIXTO'
  if (tipo === 'modalidad') {
    const emp = empCache.find(x => x.id === empleadoId);
    let originalModo = null;
    if (emp) {
      const regs = (emp.registros || []).filter(r => r.fecha === fecha);
      if (regs.length > 0) {
        originalModo = regs[0].modo;
        regs.forEach(r => r.modo = valor);
      }
    }

    // Redibujar UI de forma inmediata
    mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
    if (typeof filtrarTablaReportes === 'function') filtrarTablaReportes();

    const bgSync = $('bgSyncIndicator');
    if (bgSync) bgSync.classList.remove('hidden');

    try {
      let res;
      if (window.FirebaseBackend && window.FirebaseBackend.guardarModalidadSupervisor) {
        res = await window.FirebaseBackend.guardarModalidadSupervisor({ empleadoId, fecha, modalidad: valor, supervisorId });
      } else {
        res = await jsonpRequest({
          accion: 'guardarModalidadSupervisor',
          empleadoId: empleadoId,
          fecha: fecha,
          modalidad: valor,
          supervisorId: supervisorId
        });
      }
      if (res && res.ok) {
        if (typeof mostrarToast === 'function') mostrarToast(`✅ Modalidad guardada: ${valor}`, 'ok');
        limpiarCachesLocales();
        await cargarDatosCompletos(true, true);
      } else {
        if (typeof mostrarToast === 'function') mostrarToast('Error: ' + (res?.error || 'desconocido'), 'error');
        // Revertir
        if (emp && originalModo !== null) {
          (emp.registros || []).filter(r => r.fecha === fecha).forEach(r => r.modo = originalModo);
          mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
        }
      }
    } catch (err) {
      if (typeof mostrarToast === 'function') mostrarToast('Error de conexión: ' + err.message, 'error');
      // Revertir
      if (emp && originalModo !== null) {
        (emp.registros || []).filter(r => r.fecha === fecha).forEach(r => r.modo = originalModo);
        mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
      }
    } finally {
      if (bgSync) bgSync.classList.add('hidden');
    }
    return;
  }

  // Tiempo personal / médico
  const mins = parsearInputTiempo(valor);
  if (mins === null || mins < 0) {
    if (typeof mostrarToast === 'function') mostrarToast('⚠️ Valor inválido. Usa: 60, 1h, 1:30', 'warn');
    return;
  }

  // Optimistic cache update
  const emp = empCache.find(x => x.id === empleadoId);
  let originalPermiso = null;
  let reg = null;
  if (emp) {
    if (!emp.registros) emp.registros = [];
    reg = (emp.registros || []).find(r => r.fecha === fecha && r.tipo === 'ENTRADA')
      || (emp.registros || []).find(r => r.fecha === fecha && (r.permiso_personal_mins || r.permiso_medico_mins || r.tiempo_justificado_mins))
      || (emp.registros || []).find(r => r.fecha === fecha);
    if (reg) {
      originalPermiso = {
        personal: reg.permiso_personal_mins || 0,
        medico: reg.permiso_medico_mins || 0,
        justificado: reg.tiempo_justificado_mins || 0,
        comentario: reg.razon_permiso || '',
        esNuevo: false
      };
      if (tipo === 'personal') reg.permiso_personal_mins = mins;
      else if (tipo === 'medico') reg.permiso_medico_mins = mins;
      else if (tipo === 'justificado') reg.tiempo_justificado_mins = mins;
      if (comentario !== null) reg.razon_permiso = comentario;
    } else {
      originalPermiso = { personal: 0, medico: 0, justificado: 0, comentario: '', esNuevo: true };
      reg = {
        fecha: fecha,
        tipo: 'PERMISO',
        hora: '08:00:00',
        modo: 'OFICINA',
        justificado: 'SI',
        permiso_personal_mins: (tipo === 'personal' ? mins : 0),
        permiso_medico_mins: (tipo === 'medico' ? mins : 0),
        tiempo_justificado_mins: (tipo === 'justificado' ? mins : 0),
        razon_permiso: comentario || ''
      };
      emp.registros.push(reg);
    }
  }

  // Redraw immediately
  mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
  if (typeof filtrarTablaReportes === 'function') filtrarTablaReportes();

  const bgSync = $('bgSyncIndicator');
  if (bgSync) bgSync.classList.remove('hidden');

  const params = { empleadoId, fecha, tipo, mins, supervisorId };
  if (comentario !== null) {
    params.comentario = comentario;
  }

  try {
    let resultado;
    if (window.FirebaseBackend && window.FirebaseBackend.guardarPermisoSupervisor) {
      resultado = await window.FirebaseBackend.guardarPermisoSupervisor(params);
    } else {
      resultado = await new Promise((resolve, reject) => {
        const cb = 'cb_guardarPermiso_' + Date.now();
        const script = document.createElement('script');
        const qs = Object.entries({ ...params, accion: 'guardarPermisoSupervisor', callback: cb })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        script.src = window.API_URL + '?' + qs;
        script.onerror = () => reject(new Error('Error de red'));
        window[cb] = r => { window[cb] = function () { }; setTimeout(() => { delete window[cb]; }, 60000); script.remove(); resolve(r); };
        document.body.appendChild(script);
      });
    }
    if (resultado && (resultado.ok || !resultado.error)) {
      if (typeof mostrarToast === 'function') mostrarToast(`✅ ${tipo === 'personal' ? 'T.Personal' : 'T.Médico'}: ${mins} min`, 'ok');
      limpiarCachesLocales();
      await cargarDatosCompletos(true, true);
    } else {
      if (typeof mostrarToast === 'function') mostrarToast(resultado?.error || 'Error al guardar', 'error');
      // Revertir
      if (reg && originalPermiso && emp) {
        if (originalPermiso.esNuevo) {
          const idx = emp.registros.indexOf(reg);
          if (idx >= 0) emp.registros.splice(idx, 1);
        } else {
          reg.permiso_personal_mins = originalPermiso.personal;
          reg.permiso_medico_mins = originalPermiso.medico;
          reg.tiempo_justificado_mins = originalPermiso.justificado;
          reg.razon_permiso = originalPermiso.comentario;
        }
        mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
      }
    }
  } catch (err) {
    if (typeof mostrarToast === 'function') mostrarToast('Error de comunicación: ' + err.message, 'error');
    // Revertir
    if (reg && originalPermiso && emp) {
      if (originalPermiso.esNuevo) {
        const idx = emp.registros.indexOf(reg);
        if (idx >= 0) emp.registros.splice(idx, 1);
      } else {
        reg.permiso_personal_mins = originalPermiso.personal;
        reg.permiso_medico_mins = originalPermiso.medico;
        reg.tiempo_justificado_mins = originalPermiso.justificado;
        reg.razon_permiso = originalPermiso.comentario;
      }
      mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
    }
  } finally {
    if (bgSync) bgSync.classList.add('hidden');
  }
};

// editarCeldaTiempo: modal interactivo profesional para ingresar T.JUSTIFICADO, T.PERSONAL, T.MEDICO con confirmación
window.editarCeldaTiempo = function (uid, empId, fecha, tipoInicial = 'justificado', minsJustificado = 0, comentarioActual = '', minsPersonal = 0, minsMedico = 0, minsPorJustificar = 0, atrasoMins = 0) {
  // Eliminar modal anterior si existe
  const prev = document.getElementById('modalConversorTiempo');
  if (prev) prev.remove();

  const emp = empCache.find(x => x.id === empId);
  const nombreEmp = emp ? emp.nombre : empId;

  const modal = document.createElement('div');
  modal.id = 'modalConversorTiempo';
  modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
        z-index: 10000; display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
      `;

  const mapTipos = {
    justificado: { label: 'Tiempo Justificado', color: '#d97706', bgIcon: '#fef3c7', icon: 'fa-scale-balanced', defaultMins: minsJustificado },
    personal: { label: 'Tiempo Personal', color: '#6366f1', bgIcon: '#e0e7ff', icon: 'fa-user', defaultMins: minsPersonal },
    medico: { label: 'Tiempo Médico', color: '#0d9488', bgIcon: '#ccfbf1', icon: 'fa-stethoscope', defaultMins: minsMedico },
    cumpleanos: { label: 'Cumpleaños', color: '#e11d48', bgIcon: '#ffe4e6', icon: 'fa-birthday-cake', defaultMins: 480 }
  };

  let currentTipo = tipoInicial in mapTipos ? tipoInicial : 'justificado';
  let currentMins = mapTipos[currentTipo].defaultMins || 0;
  if (currentMins === 0) {
    if (minsPorJustificar > 0) currentMins = minsPorJustificar;
    else if (atrasoMins > 0) currentMins = atrasoMins;
  }
  let currentHrs = Math.floor(currentMins / 60);
  let currentRemMins = currentMins % 60;

  const conf = mapTipos[currentTipo];

  modal.innerHTML = `
        <div id="modalCardBody" style="background: #ffffff; border-radius: 16px; padding: 24px; max-width: 420px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; animation: modalFadeIn 0.2s ease-out;">
          <!-- HEADER -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div id="modalIconContainer" style="background: ${conf.bgIcon}; color: ${conf.color}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px; transition: all 0.2s;">
                <i id="modalHeaderIcon" class="fas ${conf.icon}"></i>
              </div>
              <div>
                <h3 id="modalTitleText" style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">${conf.label}</h3>
                <span style="font-size: 11px; color: #64748b; font-weight: 500;">📅 ${fecha} &bull; ${nombreEmp}</span>
              </div>
            </div>
            <button onclick="document.getElementById('modalConversorTiempo').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background 0.2s;" onmouseover="this.style.background='#f1f5f9'; this.style.color='#475569'" onmouseout="this.style.background='none'; this.style.color='#94a3b8'">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <!-- BANNER JORNADA MÍNIMA 8 HORAS -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
            <div style="display: flex; align-items: center; gap: 6px; color: #475569; font-weight:500;">
              <i class="fas fa-briefcase" style="color: #6366f1;"></i>
              <span>Jornada Base: <strong>8h (480 min)</strong></span>
            </div>
            ${minsPorJustificar > 0 ? `<div style="color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; border:1px solid #fde68a; display:flex; align-items:center; gap:4px;">
              <i class="fas fa-exclamation-triangle"></i> Faltante: ${minutosAHHMMSS(minsPorJustificar)}
            </div>` : `<div style="color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; border:1px solid #bbf7d0; display:flex; align-items:center; gap:4px;">
              <i class="fas fa-check-circle"></i> Jornada Completa
            </div>`}
          </div>

          <!-- FORMULARIO INTERACTIVO -->
          <div id="modalFormContainer">
            <!-- SELECTOR DE TIPO DE TIEMPO -->
            <div style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.02em;">Tipo de Tiempo / Permiso</label>
              <select id="convTipoTiempo" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 13.5px; font-weight: 600; color: #0f172a; outline: none; background: #f8fafc; cursor: pointer; box-sizing: border-box;">
                <option value="justificado" ${currentTipo === 'justificado' ? 'selected' : ''}>⚖️ Tiempo Justificado</option>
                <option value="personal" ${currentTipo === 'personal' ? 'selected' : ''}>👤 Tiempo Personal</option>
                <option value="medico" ${currentTipo === 'medico' ? 'selected' : ''}>🩺 Tiempo Médico</option>
                <option value="cumpleanos" ${currentTipo === 'cumpleanos' ? 'selected' : ''}>🥳 Cumpleaños</option>
              </select>
            </div>

            <div style="margin-bottom: 20px;">
              <!-- HORAS / MINUTOS -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
                <div>
                  <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">Horas</label>
                  <input id="convHrs" type="number" min="0" step="any" value="${currentHrs}" placeholder="0" 
                    style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; outline: none; box-sizing: border-box;">
                </div>
                <div>
                  <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">Minutos</label>
                  <input id="convMins" type="number" min="0" value="${currentRemMins}" placeholder="0" 
                    style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; outline: none; box-sizing: border-box;">
                </div>
              </div>

              <!-- ACCESOS RÁPIDOS -->
              <div style="margin-bottom: 16px;">
                <span style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 8px;">Accesos Rápidos</span>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                  ${atrasoMins > 0 ? `<button type="button" onclick="setConvVals(${Math.floor(atrasoMins / 60)}, ${atrasoMins % 60})" style="background: #fee2e2; border: 1px solid #fecdd3; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 700; color: #991b1b; cursor: pointer; transition: all 0.2s;" title="Cargar tiempo de atraso">⏰ Atraso (${minutosAHHMMSS(atrasoMins)})</button>` : ''}
                  ${minsPorJustificar > 0 ? `<button type="button" onclick="setConvVals(${Math.floor(minsPorJustificar / 60)}, ${minsPorJustificar % 60})" style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 700; color: #b45309; cursor: pointer; transition: all 0.2s;" title="Cargar el tiempo faltante de la jornada">⚡ Faltante (${minutosAHHMMSS(minsPorJustificar)})</button>` : ''}
                  <button type="button" onclick="setConvVals(0, 15)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">15m</button>
                  <button type="button" onclick="setConvVals(0, 30)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">30m</button>
                  <button type="button" onclick="setConvVals(1, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">1h</button>
                  <button type="button" onclick="setConvVals(2, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">2h</button>
                  <button type="button" onclick="setConvVals(4, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">4h</button>
                  <button type="button" onclick="setConvVals(8, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;">8h</button>
                  <button type="button" onclick="setConvVals(0, 0)" style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #ef4444; cursor: pointer; transition: all 0.2s;">Limpiar</button>
                </div>
              </div>

              <!-- COMENTARIO / RAZÓN -->
              <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">Comentario / Razón</label>
                <textarea id="convComentario" placeholder="Escribe el motivo del permiso..." rows="2"
                  style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #0f172a; outline: none; box-sizing: border-box; resize: none; font-family: inherit;">${comentarioActual}</textarea>
              </div>

              <!-- PREVIEW -->
              <div style="background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 12px; padding: 12px 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-size: 12px; font-weight: 500; color: #64748b;">Total en minutos:</span>
                  <span id="previewTotalMins" style="font-size: 15px; font-weight: 700; color: ${conf.color};">0 min</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: #94a3b8;">Formato a registrar:</span>
                  <span id="previewFormatted" style="font-size: 12px; font-weight: 600; color: #475569; font-family: monospace;">00:00:00</span>
                </div>
              </div>
            </div>

            <!-- ACCIONES -->
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button type="button" onclick="document.getElementById('modalConversorTiempo').remove()" 
                style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">
                Cancelar
              </button>
              <button type="button" id="btnSaveConv"
                style="padding: 8px 20px; border-radius: 8px; border: none; background: ${conf.color}; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                <i class="fas fa-arrow-right"></i> Continuar
              </button>
            </div>
          </div>
        </div>
      `;

  document.body.appendChild(modal);

  window.setConvVals = function (h, m) {
    document.getElementById('convHrs').value = h;
    document.getElementById('convMins').value = m;
    updatePreview();
  };

  const updateThemeUI = (tipoKey) => {
    currentTipo = tipoKey;
    const c = mapTipos[currentTipo];
    const iconElem = document.getElementById('modalHeaderIcon');
    const iconCont = document.getElementById('modalIconContainer');
    const titleText = document.getElementById('modalTitleText');
    const saveBtn = document.getElementById('btnSaveConv');
    const prevMins = document.getElementById('previewTotalMins');

    if (iconElem) iconElem.className = `fas ${c.icon}`;
    if (iconCont) { iconCont.style.background = c.bgIcon; iconCont.style.color = c.color; }
    if (titleText) titleText.textContent = c.label;
    if (saveBtn) saveBtn.style.background = c.color;
    if (prevMins) prevMins.style.color = c.color;

    // Cargar minutos por defecto del tipo seleccionado
    const defaultVal = c.defaultMins || 0;
    document.getElementById('convHrs').value = Math.floor(defaultVal / 60);
    document.getElementById('convMins').value = defaultVal % 60;
    updatePreview();
  };

  const updatePreview = () => {
    let hrs = parseFloat(document.getElementById('convHrs').value) || 0;
    let mins = parseInt(document.getElementById('convMins').value) || 0;
    if (hrs < 0) hrs = 0;
    if (mins < 0) mins = 0;
    const total = Math.round(hrs * 60) + mins;
    const computedHrs = Math.floor(total / 60);
    const computedMins = total % 60;
    const formatted = `${String(computedHrs).padStart(2, '0')}:${String(computedMins).padStart(2, '0')}:00`;

    const prevMins = document.getElementById('previewTotalMins');
    const prevFmt = document.getElementById('previewFormatted');
    if (prevMins) prevMins.textContent = `${total} min`;
    if (prevFmt) prevFmt.textContent = formatted;
  };

  document.getElementById('convTipoTiempo').addEventListener('change', (e) => updateThemeUI(e.target.value));
  document.getElementById('convHrs').addEventListener('input', updatePreview);
  document.getElementById('convMins').addEventListener('input', updatePreview);

  updatePreview();

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });

  // PASO DE CONFIRMACIÓN
  document.getElementById('btnSaveConv').onclick = () => {
    let hrs = parseFloat(document.getElementById('convHrs').value) || 0;
    let mins = parseInt(document.getElementById('convMins').value) || 0;
    if (hrs < 0) hrs = 0;
    if (mins < 0) mins = 0;
    const totalMins = Math.round(hrs * 60) + mins;
    const comentario = document.getElementById('convComentario').value;
    const c = mapTipos[currentTipo];
    const formattedFmt = minutosAHHMMSS(totalMins);

    const cardBody = document.getElementById('modalCardBody');
    if (!cardBody) return;

    // Renderizar pantalla de confirmación
    cardBody.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="background: ${c.bgIcon}; color: ${c.color}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px;">
                <i class="fas fa-clipboard-check"></i>
              </div>
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">Confirmar Información</h3>
                <span style="font-size: 11px; color: #64748b;">Verifica el tiempo a guardar</span>
              </div>
            </div>
            <button onclick="document.getElementById('modalConversorTiempo').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 20px; display:flex; flex-direction:column; gap:10px; font-size:13px;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed #e2e8f0; padding-bottom:6px;">
              <span style="color:#64748b; font-weight:500;">Empleado:</span>
              <strong style="color:#0f172a;">${nombreEmp}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed #e2e8f0; padding-bottom:6px;">
              <span style="color:#64748b; font-weight:500;">Fecha:</span>
              <strong style="color:#0f172a;">${fecha}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed #e2e8f0; padding-bottom:6px;">
              <span style="color:#64748b; font-weight:500;">Tipo de Tiempo:</span>
              <span style="font-weight:700; color:${c.color}; background:${c.bgIcon}; padding:2px 8px; border-radius:6px; font-size:12px;">
                <i class="fas ${c.icon}"></i> ${c.label}
              </span>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed #e2e8f0; padding-bottom:6px;">
              <span style="color:#64748b; font-weight:500;">Tiempo Afectado:</span>
              <strong style="color:#0f172a;">${formattedFmt} <span style="font-size:11px; color:#64748b;">(${totalMins} min)</span></strong>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <span style="color:#64748b; font-weight:500;">Comentario / Razón:</span>
              <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; font-size:12px; color:#334155; font-style:${comentario ? 'normal' : 'italic'};">
                ${comentario || 'Sin comentario especificado'}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button type="button" id="btnVolverEditModal"
              style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">
              <i class="fas fa-arrow-left"></i> Modificar
            </button>
            <button type="button" id="btnConfirmarFinalSave"
              style="padding: 8px 20px; border-radius: 8px; border: none; background: #16a34a; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              <i class="fas fa-check-circle"></i> Confirmar y Guardar
            </button>
          </div>
        `;

    document.getElementById('btnVolverEditModal').onclick = () => {
      window.editarCeldaTiempo(uid, empId, fecha, currentTipo, minsJustificado, comentario, minsPersonal, minsMedico, minsPorJustificar);
    };

    document.getElementById('btnConfirmarFinalSave').onclick = () => {
      guardarPermiso(empId, fecha, currentTipo, totalMins, comentario);
      modal.remove();
    };
  };
};



// ============================================================
// CONTROLADORES DE SUBPESTAÑAS (ASISTENCIA & GESTIÓN/SERVICIOS)
// ============================================================
window.subtabAsistenciaActual = 'control';
window.subtabServiciosActual = 'emergencias';

window.cambiarSubtabAsistencia = function (subtab) {
  window.subtabAsistenciaActual = subtab || 'control';

  // 1. Actualizar botones de subpestañas
  const subtabsBar = $('subtabsBarAsistencia');
  if (subtabsBar) {
    subtabsBar.querySelectorAll('.btn-subtab').forEach(b => b.classList.remove('active'));
    if (subtab === 'directorio') $('subtab-btn-asis-directorio')?.classList.add('active');
    else if (subtab === 'mapa') $('subtab-btn-asis-mapa')?.classList.add('active');
    else $('subtab-btn-asis-control')?.classList.add('active');
  }

  // 2. Actualizar paneles visibles
  const subControl = $('subpanel-asistencia-control');
  const subDir = $('subpanel-asistencia-directorio');
  const subMapa = $('subpanel-asistencia-mapa');

  if (subControl) subControl.style.display = (subtab === 'control' || !subtab) ? 'block' : 'none';
  if (subDir) subDir.style.display = (subtab === 'directorio') ? 'block' : 'none';
  if (subMapa) subMapa.style.display = (subtab === 'mapa') ? 'block' : 'none';

  // 3. Títulos y Breadcrumbs
  let title = 'Control de Asistencia';
  if (subtab === 'directorio') title = 'Asistencia — Directorio de Colaboradores';
  else if (subtab === 'mapa') title = 'Asistencia — Mapa y Disponibilidad';

  if ($('pageTitle')) $('pageTitle').textContent = title;
  if ($('breadcrumbCurrentItem')) $('breadcrumbCurrentItem').textContent = title;

  // 4. Cargar datos según corresponda
  if (subtab === 'directorio') {
    cargarDirectorio();
  } else if (subtab === 'mapa') {
    if (typeof window.inicializarMapaAsistencia === 'function') window.inicializarMapaAsistencia();
  } else {
    cargarAsistencia();
  }
};

window.cambiarSubtabServicios = function (subtab) {
  window.subtabServiciosActual = subtab || 'emergencias';

  // 1. Actualizar botones de subpestañas
  const subtabsBar = $('subtabsBarServicios');
  if (subtabsBar) {
    subtabsBar.querySelectorAll('.btn-subtab').forEach(b => b.classList.remove('active'));
    if (subtab === 'menu') $('subtab-btn-serv-menu')?.classList.add('active');
    else if (subtab === 'cultura') $('subtab-btn-serv-cultura')?.classList.add('active');
    else if (subtab === 'invitados') $('subtab-btn-serv-invitados')?.classList.add('active');
    else $('subtab-btn-serv-emergencias')?.classList.add('active');
  }

  // 2. Actualizar subpaneles visibles
  const subEm = $('subpanel-servicios-emergencias');
  const subMenu = $('subpanel-servicios-menu');
  const subCultura = $('subpanel-servicios-cultura');
  const subInv = $('subpanel-servicios-invitados');

  if (subEm) subEm.style.display = (subtab === 'emergencias' || !subtab) ? 'block' : 'none';
  if (subMenu) subMenu.style.display = (subtab === 'menu') ? 'block' : 'none';
  if (subCultura) subCultura.style.display = (subtab === 'cultura') ? 'block' : 'none';
  if (subInv) subInv.style.display = (subtab === 'invitados') ? 'block' : 'none';

  // 3. Títulos y Breadcrumbs
  let title = 'Gestión & Servicios';
  if (subtab === 'emergencias') title = 'Gestión & Servicios — Simulacros y Emergencias';
  else if (subtab === 'menu') title = 'Gestión & Servicios — Menú Semanal';
  else if (subtab === 'cultura') title = 'Gestión & Servicios — Cultura Tcontrol';
  else if (subtab === 'invitados') title = 'Gestión & Servicios — Invitados & Catering';

  if ($('pageTitle')) $('pageTitle').textContent = title;
  if ($('breadcrumbCurrentItem')) $('breadcrumbCurrentItem').textContent = title;

  // 4. Cargar datos según corresponda
  if (subtab === 'emergencias') {
    cargarEmergenciasSupervisor();
  } else if (subtab === 'menu') {
    cargarMenuSemanal();
  } else if (subtab === 'cultura') {
    if (typeof window.cargarBancoPreguntasCultura === 'function') window.cargarBancoPreguntasCultura();
  } else if (subtab === 'invitados') {
    if (typeof window.cargarPanelInvitados === 'function') window.cargarPanelInvitados();
  }
};

// ============================================================
// NAVEGACIÓN PRINCIPAL
// ============================================================
function cambiarPanel(panel) {
  // Enrutamiento inteligente de alias / subpestañas históricas
  if (panel === 'directorio') {
    cambiarPanel('asistencia');
    window.cambiarSubtabAsistencia('directorio');
    return;
  }
  if (panel === 'mapa') {
    cambiarPanel('asistencia');
    window.cambiarSubtabAsistencia('mapa');
    return;
  }
  if (panel === 'emergencias') {
    cambiarPanel('servicios');
    window.cambiarSubtabServicios('emergencias');
    return;
  }
  if (panel === 'menu') {
    cambiarPanel('servicios');
    window.cambiarSubtabServicios('menu');
    return;
  }
  if (panel === 'cultura') {
    cambiarPanel('servicios');
    window.cambiarSubtabServicios('cultura');
    return;
  }
  if (panel === 'invitados') {
    cambiarPanel('servicios');
    window.cambiarSubtabServicios('invitados');
    return;
  }

  panelActual = panel;
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.panel === panel));
  document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.id === 'panel-' + panel));
  let titles = {
    dashboard: 'Dashboard',
    reportes: 'Reporte Interactivo',
    asistencia: 'Control de Asistencia',
    servicios: 'Gestión & Servicios',
    detalle: 'Detalle de Empleado',
    opciones: 'Opciones adicionales',
    whatsapp: 'Notificaciones WhatsApp'
  };
  const titleText = titles[panel] || 'Supervisor';
  if ($('pageTitle')) $('pageTitle').textContent = titleText;
  if ($('breadcrumbCurrentItem')) $('breadcrumbCurrentItem').textContent = titleText;
  if ($('btnBreadcrumbBack')) {
    $('btnBreadcrumbBack').style.display = (panel === 'detalle') ? 'inline-flex' : 'none';
  }
  window.volverPanelAnterior = function () { volverAAsistencia(); };

  if (panel !== 'detalle') {
    if (panel === 'dashboard') {
      cargarDashboard();
    }
    else if (panel === 'reportes') {
      inicializarReporteInteractivo();
    }
    else if (panel === 'asistencia') {
      window.cambiarSubtabAsistencia(window.subtabAsistenciaActual || 'control');
    }
    else if (panel === 'servicios') {
      window.cambiarSubtabServicios(window.subtabServiciosActual || 'emergencias');
    }
    else if (panel === 'whatsapp') {
      if (typeof window.inicializarPanelWhatsApp === 'function') window.inicializarPanelWhatsApp();
    }
    else if (panel === 'opciones') {
      if (window.actualizarKPIsOpciones) window.actualizarKPIsOpciones();
      if (window.poblarTablaRolesActuales) window.poblarTablaRolesActuales();
    }
  }
  if (typeof window.actualizarNotificacionesSupAdminInvitados === 'function') {
    window.actualizarNotificacionesSupAdminInvitados();
  }
}
window.cambiarPanel = cambiarPanel;

// ============================================================
// SECCIÓN PLANIFICADOR DE MENÚ SEMANAL
// ============================================================
async function cargarMenuSemanal() {
  mostrarLoader(true);
  try {
    const res = await jsonpRequest({ accion: 'obtenerMenuSemanal' });
    mostrarLoader(false);
    if (res && !res.error) {
      renderFormMenuSemanal(res);
      cargarSugerenciasMenu();
    } else {
      mostrarToast(res.error || 'Error al cargar el menú', 'error');
    }
  } catch (e) {
    mostrarLoader(false);
    console.error(e);
    mostrarToast('Error de conexión', 'error');
  }
}

function renderFormMenuSemanal(menu) {
  const container = $('formMenuSemanalContainer');
  if (!container) return;

  const dias = [
    { key: 'lunes', label: 'Lunes' },
    { key: 'martes', label: 'Martes' },
    { key: 'miercoles', label: 'Miércoles' },
    { key: 'jueves', label: 'Jueves' },
    { key: 'viernes', label: 'Viernes' },
    { key: 'sabado', label: 'Sábado' },
    { key: 'domingo', label: 'Domingo' }
  ];

  container.innerHTML = dias.map(d => {
    const dMenu = menu[d.key] || { sopa: '', plato: '', jugo: '' };
    return `
          <div class="menu-dia-card" style="background:#f8fafc; border:1px solid var(--g200); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="font-size:14px; font-weight:800; color:var(--indigo); border-bottom:1.5px solid var(--indigo); padding-bottom:4px; display:flex; align-items:center; gap:6px;">
              <i class="fas fa-calendar-day"></i> ${d.label}
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <div>
                <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:3px; text-transform:uppercase;">🍜 Sopa</label>
                <input type="text" class="form-control menu-input" list="datalist-sopas" data-dia="${d.key}" data-campo="sopa" value="${escapeHtml(dMenu.sopa || '')}" placeholder="Ej: Crema de verduras" style="font-size:12.5px; padding:6px 10px; border-radius:8px; border: 1.5px solid var(--g200); font-family: inherit;">
              </div>
              <div>
                <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:3px; text-transform:uppercase;">🥩 Plato Fuerte</label>
                <input type="text" class="form-control menu-input" list="datalist-platos" data-dia="${d.key}" data-campo="plato" value="${escapeHtml(dMenu.plato || '')}" placeholder="Ej: Lomo saltado" style="font-size:12.5px; padding:6px 10px; border-radius:8px; border: 1.5px solid var(--g200); font-family: inherit;">
              </div>
              <div>
                <label style="font-size:11px; font-weight:700; color:#475569; display:block; margin-bottom:3px; text-transform:uppercase;">🥤 Bebida</label>
                <input type="text" class="form-control menu-input" list="datalist-jugos" data-dia="${d.key}" data-campo="jugo" value="${escapeHtml(dMenu.jugo || '')}" placeholder="Ej: Jugo de naranja" style="font-size:12.5px; padding:6px 10px; border-radius:8px; border: 1.5px solid var(--g200); font-family: inherit;">
              </div>
            </div>
          </div>
        `;
  }).join('') + `
        <datalist id="datalist-sopas"></datalist>
        <datalist id="datalist-platos"></datalist>
        <datalist id="datalist-jugos"></datalist>
      `;
}

function calcularFechaDiaSemana(diaKey) {
  const ahora = new Date();
  const diasSemanaKeys = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const targetIdx = diasSemanaKeys.indexOf(diaKey);
  const hoyIdx = ahora.getDay();

  const diff = targetIdx - hoyIdx;
  const targetDate = new Date(ahora);
  targetDate.setDate(ahora.getDate() + diff);

  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`; // DD/MM/YYYY
}

async function cargarSugerenciasMenu() {
  try {
    const sugRes = await jsonpRequest({ accion: 'obtenerHistorialMenuSugerencias' });
    if (sugRes && !sugRes.error) {
      const dSopas = $('datalist-sopas');
      const dPlatos = $('datalist-platos');
      const dJugos = $('datalist-jugos');
      if (dSopas) dSopas.innerHTML = (sugRes.sopas || []).map(s => `<option value="${escapeHtml(s)}">`).join('');
      if (dPlatos) dPlatos.innerHTML = (sugRes.platos || []).map(p => `<option value="${escapeHtml(p)}">`).join('');
      if (dJugos) dJugos.innerHTML = (sugRes.jugos || []).map(j => `<option value="${escapeHtml(j)}">`).join('');
    }
  } catch (e) {
    console.warn("Error cargando sugerencias de menú:", e);
  }
}

window.guardarMenuSemanal = async function () {
  const inputs = document.querySelectorAll('.menu-input');
  if (!inputs || inputs.length === 0) {
    mostrarToast('El formulario de menú aún no se ha cargado. Por favor espera un momento.', 'warning');
    return;
  }

  const menu = {
    lunes: {}, martes: {}, miercoles: {}, jueves: {}, viernes: {}, sabado: {}, domingo: {}
  };

  let camposLlenos = 0;
  inputs.forEach(input => {
    const dia = input.dataset.dia;
    const campo = input.dataset.campo;
    const val = (input.value || '').trim();
    if (menu[dia]) {
      menu[dia][campo] = val;
    }
    if (val) camposLlenos++;
  });

  if (camposLlenos === 0) {
    const confirmarVacio = confirm('Todos los campos del menú están vacíos. ¿Deseas limpiar y guardar el menú en blanco?');
    if (!confirmarVacio) return;
  }

  mostrarLoader(true);
  try {
    // 1. Descargar el menú anterior antes de guardar para archivar
    try {
      const menuAnteriorRes = await jsonpRequest({ accion: 'obtenerMenuSemanal' });
      if (menuAnteriorRes && !menuAnteriorRes.error) {
        const registrosMenu = [];
        const diasKeys = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
        diasKeys.forEach(key => {
          const dMenu = menuAnteriorRes[key];
          if (dMenu && (dMenu.sopa || dMenu.plato || dMenu.jugo)) {
            registrosMenu.push({
              fecha: calcularFechaDiaSemana(key),
              dia: key.charAt(0).toUpperCase() + key.slice(1),
              sopa: dMenu.sopa || '',
              plato: dMenu.plato || '',
              jugo: dMenu.jugo || ''
            });
          }
        });

        // 2. Archivar en histórico
        if (registrosMenu.length > 0) {
          await jsonpRequest({
            accion: 'archivarMenuConsumido',
            registros: JSON.stringify(registrosMenu)
          });
        }
      }
    } catch (eArch) {
      console.warn("Aviso al archivar histórico de menú:", eArch);
    }

    // 3. Guardar el nuevo menú en Firestore
    const res = await jsonpRequest({
      accion: 'guardarMenuSemanal',
      menu: menu
    });

    mostrarLoader(false);
    if (res && res.ok) {
      mostrarToast('¡Menú semanal guardado y publicado correctamente!', 'success');
      cargarSugerenciasMenu(); // Recargar datalists
    } else {
      mostrarToast(res?.error || 'Error al guardar el menú', 'error');
    }
  } catch (e) {
    mostrarLoader(false);
    console.error(e);
    mostrarToast('Error de conexión al guardar el menú: ' + (e.message || e), 'error');
  }
};

// ============================================================
// MODAL ALMUERZO EXTRA
// ============================================================
function mostrarModalExtraLunch() {
  let modal = document.getElementById('extraLunchModal');
  modal.classList.remove('hidden');
  $('visitanteFecha').value = hoy;
  if ($('visitanteNombre')) $('visitanteNombre').value = '';
  if ($('visitanteEmpresa')) $('visitanteEmpresa').value = '';
  if ($('visitanteHoraServicio')) $('visitanteHoraServicio').value = '';
  if ($('visitanteObservaciones')) $('visitanteObservaciones').value = '';
  if ($('visitanteTipoServicio')) $('visitanteTipoServicio').value = 'ALMUERZO_EXTRA';
  if ($('visitanteCantidad')) $('visitanteCantidad').value = 1;
  $('visitanteCantidad').focus();
}

function cerrarModal() {
  document.getElementById('extraLunchModal').classList.add('hidden');
  ['visitanteObservaciones', 'visitanteNombre', 'visitanteEmpresa', 'visitanteHoraServicio'].forEach(id => {
    let el = $(id);
    if (el) el.value = '';
  });
  let cant = $('visitanteCantidad');
  if (cant) cant.value = 1;
}

async function guardarAlmuerzoExtra() {
  let fecha = $('visitanteFecha').value;
  let cantidad = $('visitanteCantidad').value;
  let tipo = $('visitanteTipoServicio')?.value || 'ALMUERZO_EXTRA';
  let nombre = $('visitanteNombre')?.value.trim() || 'Almuerzo Extra';
  let empresa = $('visitanteEmpresa')?.value.trim() || 'TCONTROL';
  let horaServicio = $('visitanteHoraServicio')?.value || '';
  let observaciones = $('visitanteObservaciones').value.trim();

  if (!fecha) { mostrarToast('Ingrese una fecha válida', 'error'); return; }
  if (!cantidad || cantidad < 1) { mostrarToast('Ingrese una cantidad válida', 'error'); return; }
  if (!nombre) { mostrarToast('Ingrese el nombre del invitado o motivo', 'warning'); return; }

  let supervisorName = "Supervisor";
  let supervisorId = "";
  try {
    let sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}');
    supervisorId = String(sessionData.id || "").trim();
    if (supervisorId === "1058") {
      supervisorName = "Admin Master";
    } else if (supervisorId) {
      let sup = empCache.find(x => String(x.id).trim() === supervisorId);
      if (sup) supervisorName = sup.nombre;
      else supervisorName = "Supervisor ID " + supervisorId;
    }
  } catch (e) { }

  let observacionesFinal = observaciones;
  if (supervisorId || supervisorName) {
    const supInfoStr = supervisorId ? `ID: ${supervisorId} - ${supervisorName}` : supervisorName;
    observacionesFinal = observacionesFinal ? `${observacionesFinal} (Creado por: ${supInfoStr})` : `(Creado por: ${supInfoStr})`;
  }

  mostrarLoader(true);
  try {
    let res = await jsonpRequest({
      accion: 'crearSolicitudInvitado',
      nombre: nombre,
      invitado: nombre,
      empresa: empresa,
      fecha: fecha,
      tipoSolicitud: tipo.includes('REFRIGERIO') ? 'REFRIGERIO' : 'ALMUERZO_EXTRA',
      subtipo: tipo,
      observaciones: observacionesFinal,
      cantidad: cantidad,
      horaServicio: horaServicio,
      supervisorId: supervisorId,
      supervisorName: supervisorName,
      creadoPor: 'SUPERVISOR'
    });
    mostrarLoader(false);
    if (res?.error) { mostrarToast(res.error, 'error'); return; }
    mostrarToast("Pedido registrado con éxito", "success");
    cerrarModal();
    cargarDatosCompletos(true, true, true).then(() => {
      if (panelActual === 'dashboard' && $('filtroCargoReporte')?.value === 'almuerzos extra') {
        filtrarReporteInteractivo();
      }
      if (panelActual === 'invitados' && typeof window.cargarPanelInvitados === 'function') {
        window.cargarPanelInvitados(true);
      }
    });
  } catch (e) {
    mostrarLoader(false);
    mostrarToast('Error: ' + e.message, 'error');
  }
}

async function completarRegistro(empleadoId, tipo, hora, fecha) {
  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarRegistroGeneral',
      docId: `${empleadoId}_${tipo}_${fecha}_${hora.replace(/:/g, '')}`,
      empleadoId: empleadoId,
      tipo: tipo,
      fecha: fecha,
      campo: 'hora',
      valor: hora
    });
    if (res.ok) {
      mostrarToast('Registro completado', 'success');
      limpiarCachesLocales();
      cargarDatosCompletos(true, true).then(() => {
        if (panelActual === 'detalle') mostrarDetalle(empleadoId);
        else if (panelActual === 'asistencia') cargarAsistencia();
      });
    } else {
      mostrarToast(res.error || 'Error', 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión', 'error');
  } finally {
    mostrarLoader(false);
  }
}

async function eliminarRegistroSupervisor(docId, empleadoId, fecha, tipo) {
  if (!tienePermisoAdmin()) { mostrarToast('Solo Administradores y Supervisores Admin pueden realizar esta acción.', 'error'); return; }
  if (!confirm('¿Estás seguro de eliminar este registro permanentemente?')) return;

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'eliminarRegistro',
      docId: docId,
      empleadoId: empleadoId,
      fecha: fecha,
      tipo: tipo
    }); if (res.ok) {
      mostrarToast('Registro eliminado', 'success');
      limpiarCachesLocales();
      cargarDatosCompletos(true, true).then(() => {
        if (panelActual === 'detalle') mostrarDetalle(empleadoId);
        else if (panelActual === 'asistencia') cargarAsistencia();
      });
    } else {
      mostrarToast(res.error || 'Error al eliminar', 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión', 'error');
  } finally {
    mostrarLoader(false);
  }
}



// ============================================================
// ARCHIVADO A GOOGLE SHEETS
// ============================================================
async function iniciarArchivadoFirebase() {
  const isAdmin = (typeof esAdminMaster === 'function') ? esAdminMaster() : !!window.isMaster;
  if (!isAdmin) { mostrarToast('Solo el Administrador General (1058) puede realizar esta acción.', 'error'); return; }
  mostrarLoader(true);
  let infoDias = "No se pudo determinar el registro más antiguo.";
  let diasSugeridos = 60;

  try {
    // Buscar el registro más antiguo para informar al usuario
    const oldSnap = await db.collection('registros').orderBy('fecha', 'asc').limit(1).get();

    if (!oldSnap.empty) {
      const oldestDateStr = oldSnap.docs[0].data().fecha;
      let oldestDate;
      if (oldestDateStr.includes('/')) {
        const parts = oldestDateStr.split('/');
        oldestDate = new Date(parts[2], parts[1] - 1, parts[0]);
      } else {
        oldestDate = new Date(oldestDateStr);
      }

      if (!isNaN(oldestDate)) {
        const diffTime = Math.abs(new Date() - oldestDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        infoDias = `Tu registro más antiguo es del ${oldestDateStr} (hace ${diffDays} días).`;
        if (diffDays > 60) diasSugeridos = 60;
        else diasSugeridos = Math.max(1, diffDays - 10); // Sugerir dejar al menos 10 días
      }
    }
  } catch (e) {
    console.warn("No se pudo pre-cargar el análisis de BD:", e);
  }

  mostrarLoader(false);

  const diasArchivar = prompt(`📊 Análisis de Base de Datos:\n${infoDias}\n\n¿Registros más antiguos a cuántos días deseas archivar y borrar de Firebase?\n\n(Recomendado: ${diasSugeridos})`, diasSugeridos.toString());

  if (!diasArchivar || isNaN(diasArchivar)) return;

  const diasNum = parseInt(diasArchivar);
  if (!confirm(`¿Estás seguro de mover permanentemente los registros y solicitudes de invitados de hace más de ${diasNum} días a las hojas de cálculo REGISTROS y ALMUERZOS_EXTRA?\n\nEsto limpiará tu Firebase y mantendrá la base liviana y de alta velocidad. Esta acción es irreversible en Firebase.`)) return;

  mostrarLoader(true);

  try {
    const limite = new Date();
    limite.setDate(limite.getDate() - diasNum);
    const y = limite.getFullYear();
    const m = String(limite.getMonth() + 1).padStart(2, '0');
    const d = String(limite.getDate()).padStart(2, '0');
    const limiteStr = `${y}-${m}-${d}`;

    mostrarToast('Buscando registros y solicitudes en Firebase...', 'info');

    // 1. Obtener registros de asistencia de Firebase
    const snap = await db.collection('registros').get();

    // 2. Obtener solicitudes de catering/invitados de Firebase
    let snapInvitados = null;
    try {
      snapInvitados = await db.collection('solicitudes_invitados').get();
    } catch (eInv) {
      console.warn("Aviso consultando solicitudes_invitados para archivar:", eInv);
    }

    const registrosToArchive = [];
    const limitDateNormalized = new Date(limite.getFullYear(), limite.getMonth(), limite.getDate()).getTime();

    console.log("=== DIAGNÓSTICO DE ARCHIVADO ===");
    console.log("Fecha límite original (limite):", limite);
    console.log("Límite normalizado (limitDateNormalized):", limitDateNormalized, new Date(limitDateNormalized).toISOString());
    console.log("Total registros en Firebase:", snap.size);

    let countSinFecha = 0;
    let countParseFail = 0;
    let countMayorOIgual = 0;
    let countMenores = 0;

    snap.forEach(doc => {
      let data = doc.data();
      let docFecha = data.fecha;
      let parsedDate = null;

      if (!docFecha && data.timestamp) {
        let ts = data.timestamp;
        if (ts && typeof ts.toDate === 'function') parsedDate = ts.toDate();
        else if (ts && ts.seconds) parsedDate = new Date(ts.seconds * 1000);
        else parsedDate = new Date(ts);

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const y = parsedDate.getFullYear();
          const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
          const d = String(parsedDate.getDate()).padStart(2, '0');
          docFecha = `${y}-${m}-${d}`;
        }
      }

      if (!docFecha) {
        countSinFecha++;
        return;
      }

      // Parsear y normalizar la fecha de forma robusta
      if (!parsedDate) {
        if (typeof docFecha.toDate === 'function') {
          // Es un Timestamp de Firebase
          parsedDate = docFecha.toDate();
        } else if (docFecha instanceof Date) {
          // Es un objeto Date
          parsedDate = docFecha;
        } else {
          // Es un string
          let docFechaStr = String(docFecha).trim();
          const matchDMY = docFechaStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
          if (matchDMY) {
            const d = parseInt(matchDMY[1], 10);
            const m = parseInt(matchDMY[2], 10);
            const y = parseInt(matchDMY[3], 10);
            parsedDate = new Date(y, m - 1, d);
          } else {
            const matchYMD = docFechaStr.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
            if (matchYMD) {
              const y = parseInt(matchYMD[1], 10);
              const m = parseInt(matchYMD[2], 10);
              const d = parseInt(matchYMD[3], 10);
              parsedDate = new Date(y, m - 1, d);
            } else {
              parsedDate = new Date(docFechaStr);
            }
          }
        }
      }

      if (!parsedDate || isNaN(parsedDate.getTime())) {
        countParseFail++;
        if (countParseFail <= 5) {
          console.warn(`[DIAGNOSTICO] Error al parsear fecha para doc ID ${doc.id}. Valor recibido:`, docFecha);
        }
        return;
      }

      const docDateNormalized = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime();

      // Si el registro es anterior a la fecha límite (excluyendo hoy si diasNum = 0)
      if (docDateNormalized < limitDateNormalized) {
        countMenores++;
        // Formatear el timestamp de Firebase (seconds/nanoseconds) a fecha legible estándar (24h)
        let ts = data.timestamp;
        if (ts) {
          let dateObj;
          if (ts && typeof ts.toDate === 'function') dateObj = ts.toDate();
          else if (ts && ts.seconds) dateObj = new Date(ts.seconds * 1000);
          else dateObj = new Date(ts);

          if (dateObj && !isNaN(dateObj.getTime())) {
            const d = dateObj.getDate();
            const m = dateObj.getMonth() + 1;
            const y = dateObj.getFullYear();
            const hh = String(dateObj.getHours()).padStart(2, '0');
            const mm = String(dateObj.getMinutes()).padStart(2, '0');
            const ss = String(dateObj.getSeconds()).padStart(2, '0');
            ts = `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
          } else {
            ts = String(ts);
          }
        }
        data.timestamp = ts || '';
        data.fecha = formatearFechaA_DMY(docFecha);

        registrosToArchive.push({ ...data, id: doc.id });
      } else {
        countMayorOIgual++;
        if (countMayorOIgual <= 5) {
          console.log(`[DIAGNOSTICO] Registro omitido (hoy o futuro). ID: ${doc.id}, Fecha original:`, docFecha, `-> parsedDate:`, parsedDate.toISOString(), `-> docDateNormalized:`, docDateNormalized);
        }
      }
    });

    // Procesar solicitudes de invitados para archivar en ALMUERZOS_EXTRA
    const almuerzosToArchive = [];
    if (snapInvitados && !snapInvitados.empty) {
      snapInvitados.forEach(doc => {
        const data = doc.data() || {};
        const docFecha = data.fecha;
        let parsedDate = null;
        if (docFecha) {
          const matchYMD = String(docFecha).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
          if (matchYMD) {
            parsedDate = new Date(parseInt(matchYMD[1], 10), parseInt(matchYMD[2], 10) - 1, parseInt(matchYMD[3], 10));
          } else {
            parsedDate = new Date(docFecha);
          }
        } else if (data.timestamp) {
          let ts = data.timestamp;
          if (ts && typeof ts.toDate === 'function') parsedDate = ts.toDate();
          else if (ts && ts.seconds) parsedDate = new Date(ts.seconds * 1000);
          else parsedDate = new Date(ts);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const docDateNormalized = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime();
          if (docDateNormalized < limitDateNormalized) {
            const nomCompleto = (data.invitado || 'Invitado') + (data.empleadoNombre ? ` (Inv. de ${data.empleadoNombre})` : '');
            almuerzosToArchive.push({
              id: doc.id,
              fecha: formatearFechaA_DMY(docFecha || parsedDate),
              nombre: nomCompleto,
              empresa: data.empresa || '',
              tipo: data.subtipo || data.tipoSolicitud || 'ALMUERZO_EXTRA',
              cantidad: data.cantidad || 1,
              hora: data.hora || '',
              timestamp: data.horaServicio ? `[Hora req: ${data.horaServicio}]` : '',
              observaciones: data.observacionesCompletas || data.observaciones || '',
              supervisorId: data.empleadoId || ''
            });
          }
        }
      });
    }

    console.log("=== FIN DIAGNÓSTICO ===");
    console.log("- Sin campo 'fecha':", countSinFecha);
    console.log("- Fallas de parseo:", countParseFail);
    console.log("- Omitidos (hoy/futuro):", countMayorOIgual);
    console.log("- Asistencias para archivar:", countMenores);
    console.log("- Pedidos de catering para archivar:", almuerzosToArchive.length);

    if (registrosToArchive.length === 0 && almuerzosToArchive.length === 0) {
      mostrarLoader(false);
      mostrarToast('No hay registros ni solicitudes antiguas para archivar.', 'info');
      return;
    }

    const chunkSiz = 200;
    const totalRegistros = registrosToArchive.length;
    const totalLotes = Math.max(1, Math.ceil(totalRegistros / chunkSiz));

    for (let i = 0; i < Math.max(totalRegistros, 1); i += chunkSiz) {
      const chunk = registrosToArchive.slice(i, i + chunkSiz);
      const loteActual = Math.floor(i / chunkSiz) + 1;
      const esPrimerLote = (i === 0);
      const chunkAlmuerzos = esPrimerLote ? almuerzosToArchive : [];

      if (chunk.length === 0 && chunkAlmuerzos.length === 0) break;

      mostrarToast(`Archivando lote ${loteActual} de ${totalLotes} (${chunk.length} asistencias, ${chunkAlmuerzos.length} pedidos de catering)...`, 'info');

      // Enviar lote a Google Apps Script usando POST
      const respuesta = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // Evitar preflight CORS estricto
        body: JSON.stringify({
          apiKey: 'TCONTROL_SECURE_2026_XYZ',
          accion: 'archivarRegistros',
          registros: chunk,
          almuerzosExtra: chunkAlmuerzos
        })
      });

      if (!respuesta.ok) {
        throw new Error(`Error de red HTTP ${respuesta.status} en lote ${loteActual}`);
      }

      const result = await respuesta.json();
      if (!result.ok) {
        throw new Error(result.error || `Error del servidor en lote ${loteActual}`);
      }

      // Si se guardaron bien, borrarlos de Firebase inmediatamente
      if (chunk.length > 0) {
        mostrarToast(`✅ Lote ${loteActual} guardado. Borrando asistencias de Firebase...`, 'info');
        let batch = db.batch();
        for (const reg of chunk) {
          batch.delete(db.collection('registros').doc(reg.id));
        }
        await batch.commit();
      }

      // Si se transfirieron almuerzos extra en este lote, borrarlos de Firebase
      if (chunkAlmuerzos.length > 0) {
        mostrarToast(`✅ Pedidos de catering guardados en ALMUERZOS_EXTRA. Borrando de Firebase...`, 'info');
        let batchInv = db.batch();
        let countBatch = 0;
        for (const alm of chunkAlmuerzos) {
          batchInv.delete(db.collection('solicitudes_invitados').doc(alm.id));
          countBatch++;
          if (countBatch >= 400) {
            await batchInv.commit();
            batchInv = db.batch();
            countBatch = 0;
          }
        }
        if (countBatch > 0) {
          await batchInv.commit();
        }
      }
    }

    mostrarLoader(false);
    mostrarToast(`Archivado exitoso: ${registrosToArchive.length} asistencias en REGISTROS y ${almuerzosToArchive.length} pedidos en ALMUERZOS_EXTRA.`, 'success');

    // Limpiar todas las cachés locales (incluyendo tcontrol_archivados_cache)
    // Esto evita que aparezca la ventana de "Justificar Asistencias"
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('tcontrol_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    await cargarDatosCompletos(true);
  } catch (err) {
    console.error("Error archivando:", err);
    mostrarLoader(false);
    mostrarToast(`Error en el proceso de archivado: ${err.message || err}`, 'error');
  }
}
window.iniciarArchivadoFirebase = iniciarArchivadoFirebase;

function mostrarModalManual(empleadoIdDefault = null, fechaDefault = null) {
  const modal = $('manualRegistroModal');
  if (!modal) return;
  const sel = $('manEmpleadoId');
  if (sel) {
    sel.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (ID: ${e.id})</option>`).join('');
    if (empleadoIdDefault) {
      sel.value = String(empleadoIdDefault).trim();
    }
  }
  const hoyLocal = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr(new Date()) : new Date().toISOString().slice(0, 10);
  if ($('manFecha')) $('manFecha').value = fechaDefault || hoyLocal;
  
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  const ss = String(ahora.getSeconds()).padStart(2, '0');
  if ($('manHora')) $('manHora').value = `${hh}:${mm}:${ss}`;

  if ($('manTipo')) $('manTipo').value = 'ENTRADA';
  if ($('manModo')) $('manModo').value = 'EMPRESA';
  if ($('manAlmuerzo')) $('manAlmuerzo').value = '';
  if ($('manHorasExtra')) $('manHorasExtra').value = '';
  if ($('manObservacion')) $('manObservacion').value = '';

  modal.classList.remove('hidden');
}

function cerrarModalManual() {
  const modal = $('manualRegistroModal');
  if (modal) modal.classList.add('hidden');
}

window.mostrarModalManual = mostrarModalManual;
window.cerrarModalManual = cerrarModalManual;
window.guardarRegistroManual = guardarRegistroManual;

async function guardarRegistroManual() {
  if (!tienePermisoAdmin()) { mostrarToast('Solo Administradores y Supervisores Admin pueden realizar esta acción.', 'error'); return; }
  const eid = $('manEmpleadoId').value;
  const fecha = $('manFecha').value;
  const tipo = $('manTipo').value;
  const hora = $('manHora').value;
  const modo = $('manModo').value;
  const almuerzo = $('manAlmuerzo').value;
  const horasExtra = $('manHorasExtra').value;
  const observacion = $('manObservacion').value;

  if (!fecha || !hora) { mostrarToast('Complete fecha y hora', 'error'); return; }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarRegistroGeneral',
      docId: `${eid}_${tipo}_${fecha}_${hora.replace(/:/g, '')}`,
      empleadoId: eid,
      tipo: tipo,
      fecha: fecha,
      campo: 'hora',
      valor: hora,
      modo: modo,
      almuerzo: almuerzo,
      horasExtra: horasExtra,
      observacion: observacion
    });

    if (res.ok) {
      mostrarToast('Registro guardado', 'success');
      cerrarModalManual();
      limpiarCachesLocales();
      cargarDatosCompletos(true, true).then(() => {
        if (panelActual === 'detalle') mostrarDetalle(eid);
        else cargarAsistencia();
      });
    } else {
      mostrarToast(res.error || 'Error', 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión', 'error');
  } finally {
    mostrarLoader(false);
  }
}

window.resetearPasswordEmpleado = async function (empleadoId, nombreEmpleado) {
  if (!empleadoId) return;

  const mensaje = `🔑 RESETEAR CONTRASEÑA DE ACCESO\n\n` +
    `Empleado: ${nombreEmpleado}\n` +
    `ID / Cédula: ${empleadoId}\n\n` +
    `¿Deseas resetear la contraseña para que el colaborador pueda crear una nueva o vincular su teléfono de nuevo?`;

  if (!confirm(mensaje)) return;

  let nuevaClave = prompt(`(Opcional) Si deseas asignarle una contraseña manual a ${nombreEmpleado}, escríbela aquí:\n(Déjala vacía para que el empleado cree su propia clave al vincular)`);
  if (nuevaClave === null) return; // Cancelado por el usuario

  mostrarLoader(true);
  try {
    let passHash = '';
    if (nuevaClave.trim() !== '') {
      if (nuevaClave.trim().length < 4) {
        mostrarToast('La contraseña debe tener al menos 4 caracteres', 'warning');
        mostrarLoader(false);
        return;
      }
      if (typeof hashPassword === 'function') {
        passHash = await hashPassword(nuevaClave.trim());
      } else {
        passHash = nuevaClave.trim();
      }
    }

    let res = null;
    if (window.FirebaseBackend && window.USE_FIREBASE) {
      res = await window.FirebaseBackend.actualizarPerfilEmpleado({
        empleadoId: empleadoId,
        passwordHash: passHash,
        deviceToken: ''
      });
    } else {
      res = await jsonpRequest({
        accion: 'actualizarPerfilEmpleado',
        empleadoId: empleadoId,
        passwordHash: passHash,
        deviceToken: ''
      });
    }

    mostrarLoader(false);
    if (res && (res.ok || res.mensaje)) {
      const detalleMsg = passHash === ''
        ? `Se eliminó la contraseña de ${nombreEmpleado}. Ahora puede vincular su teléfono y crear una contraseña nueva.`
        : `Contraseña manual asignada correctamente a ${nombreEmpleado}.`;
      mostrarToast(`✅ ${detalleMsg}`, 'success');
      if (typeof mostrarDetalle === 'function') mostrarDetalle(empleadoId);
    } else {
      mostrarToast(res?.error || 'Error al resetear la contraseña', 'error');
    }
  } catch (e) {
    mostrarLoader(false);
    mostrarToast('Error de comunicación: ' + e.message, 'error');
  }
};

window.mostrarModalFuturos = function (preselectedEmpId = null) {
  const modal = $('eventoFuturoModal');
  const sel = $('futEmpleadoId');
  sel.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${e.id})</option>`).join('');
  if (preselectedEmpId) {
    sel.value = preselectedEmpId;
  }
  // Reset tipo cards to VACACIONES
  $('futTipo').value = 'VACACIONES';
  document.querySelectorAll('.fut-tipo-card').forEach(c => {
    if (c.dataset.tipo === 'VACACIONES') {
      c.style.border = '2px solid #6366f1';
      c.style.background = '#ede9fe';
      c.classList.add('selected');
      c.querySelector('div:nth-child(2)').style.color = '#4f46e5';
    } else {
      c.style.border = '2px solid #e5e7eb';
      c.style.background = 'white';
      c.classList.remove('selected');
      c.querySelector('div:nth-child(2)').style.color = '#374151';
    }
  });
  $('futFechaInicio').value = hoy;
  $('futFechaFin').value = hoy;
  $('futObservacion').value = '';
  actualizarResumenFuturo();
  modal.classList.remove('hidden');
}

window.seleccionarTipoEvento = function (card) {
  document.querySelectorAll('.fut-tipo-card').forEach(c => {
    c.style.border = '2px solid #e5e7eb';
    c.style.background = 'white';
    c.classList.remove('selected');
    const label = c.querySelector('div:nth-child(2)');
    if (label) label.style.color = '#374151';
    const sub = c.querySelector('div:nth-child(3)');
    if (sub) sub.style.color = '#9ca3af';
  });
  card.style.border = '2px solid #6366f1';
  card.style.background = '#ede9fe';
  card.classList.add('selected');
  const label = card.querySelector('div:nth-child(2)');
  if (label) label.style.color = '#4f46e5';
  const sub = card.querySelector('div:nth-child(3)');
  if (sub) sub.style.color = '#7c6fe5';
  $('futTipo').value = card.dataset.tipo;
  actualizarResumenFuturo();
}

window.actualizarResumenFuturo = function () {
  const fInicio = $('futFechaInicio').value;
  const fFin = $('futFechaFin').value;
  const resumen = $('futResumen');
  const resumenText = $('futResumenText');
  if (!fInicio || !fFin || fFin < fInicio) {
    resumen.style.display = 'none';
    return;
  }
  // Contar solo días laborales
  let labCount = 0, festCount = 0;
  let cur = new Date(fInicio + 'T12:00:00');
  const fin = new Date(fFin + 'T12:00:00');
  while (cur <= fin) {
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    const fStr = `${yyyy}-${mm}-${dd}`;
    const dow = cur.getDay();
    if (dow === 0 || dow === 6 || esFeriadoODomingo(fStr)) {
      festCount++;
    } else {
      labCount++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  let msg = `<strong>${labCount}</strong> día(s) laborable(s) se registrarán`;
  if (festCount > 0) msg += ` · <span style="color:#7c3aed;">${festCount} fin(es) de semana/feriado(s) omitido(s)</span>`;
  if (labCount === 0) msg = `<span style="color:#dc2626;">⚠️ No hay días laborales en el rango seleccionado</span>`;
  resumenText.innerHTML = msg;
  resumen.style.display = 'flex';
}

window.cerrarModalFuturos = function () {
  $('eventoFuturoModal').classList.add('hidden');
}

window.guardarEventoFuturo = async function () {
  if (!tienePermisoAdmin()) {
    mostrarToast('Solo Administradores y Supervisores Admin pueden realizar esta acción.', 'error');
    return;
  }
  const eid = $('futEmpleadoId').value;
  const fInicio = $('futFechaInicio').value;
  const fFin = $('futFechaFin').value;
  const tipo = $('futTipo').value;
  const observacion = $('futObservacion').value.trim() || 'Registrado por supervisor';

  if (!fInicio || !fFin) {
    mostrarToast('Seleccione fecha de inicio y fin', 'error');
    return;
  }
  if (fFin < fInicio) {
    mostrarToast('La fecha fin no puede ser menor a la fecha inicio', 'error');
    return;
  }

  // Generar SOLO fechas laborales en el rango (excluir sábados, domingos y feriados)
  const fechas = [];
  let current = new Date(fInicio + 'T12:00:00');
  const end = new Date(fFin + 'T12:00:00');
  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const fStr = `${yyyy}-${mm}-${dd}`;
    const dow = current.getDay();
    // Solo días laborales (lunes-viernes, no feriados)
    if (dow !== 0 && dow !== 6 && !esFeriadoODomingo(fStr)) {
      fechas.push(fStr);
    }
    current.setDate(current.getDate() + 1);
  }

  if (fechas.length === 0) {
    mostrarToast('No hay días laborales en el rango seleccionado', 'error');
    return;
  }

  mostrarLoader(true);
  mostrarToast(`Registrando ${fechas.length} día(s) laborable(s)...`, 'info');

  try {
    let successCount = 0;
    let errorMsg = null;

    for (const f of fechas) {
      const res = await jsonpRequest({
        accion: 'actualizarRegistroGeneral',
        docId: `${eid}_${tipo}_${f}_000000`,
        empleadoId: eid,
        tipo: tipo,
        fecha: f,
        campo: 'hora',
        valor: '00:00:00',
        modo: 'EMPRESA',
        almuerzo: '',
        horasExtra: 'NO',
        observacion: observacion,
        razon_justificac: observacion,
        justificado: 'SI'
      });
      if (res.ok) {
        successCount++;
      } else {
        errorMsg = res.error;
      }
    }

    if (successCount === fechas.length) {
      mostrarToast(`✅ ${successCount} día(s) registrado(s) correctamente`, 'success');
      cerrarModalFuturos();
      limpiarCachesLocales();
      await cargarDatosCompletos(true, true);
      if (panelActual === 'detalle') mostrarDetalle(eid);
      else cargarAsistencia();
    } else {
      mostrarToast(`Se registraron ${successCount}/${fechas.length} días. Error: ${errorMsg || 'desconocido'}`, 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión al registrar eventos futuros', 'error');
  } finally {
    mostrarLoader(false);
  }
}

// --- FUNCIONES DE EDICIÓN ADMIN ---
window.editarValorRegistro = async function (empleadoId, tipo, docId, campo, valorActual, fecha) {
  if (!tienePermisoAdmin()) { mostrarToast('Solo Administradores y Supervisores Admin pueden realizar esta acción.', 'error'); return; }

  let nuevoValor = null;
  let targetFecha = fecha || hoy;

  if (campo === 'hora') {
    nuevoValor = prompt(`Editar HORA (${tipo}) para el empleado ${empleadoId} [${targetFecha}]:`, valorActual);
    if (nuevoValor === null) return;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (nuevoValor !== "" && !timeRegex.test(nuevoValor)) {
      mostrarToast('Formato de hora inválido. Use HH:MM o HH:MM:SS', 'error');
      return;
    }
    if (nuevoValor !== "" && nuevoValor.split(':').length === 2) {
      nuevoValor += ':00';
    }
  } else if (campo === 'modo') {
    if (valorActual === 'CAMPO') {
      nuevoValor = confirm(`¿Cambiar MODO a OFICINA? (Aceptar para OFICINA, Cancelar para mantener CAMPO)`) ? 'OFICINA' : 'CAMPO';
    } else {
      nuevoValor = confirm(`¿Cambiar MODO a CAMPO? (Aceptar para CAMPO, Cancelar para mantener OFICINA)`) ? 'CAMPO' : 'OFICINA';
    }
    if (nuevoValor === valorActual) return;
  } else if (campo === 'horasExtra') {
    if (valorActual === 'SI') {
      nuevoValor = confirm(`¿Quitar la autorización de HORAS EXTRAS?`) ? 'NO' : 'SI';
    } else {
      nuevoValor = confirm(`¿Autorizar HORAS EXTRAS?`) ? 'SI' : 'NO';
    }
    if (nuevoValor === valorActual) return;
  } else if (campo === 'timestamp') {
    let tsLegible = formatearTimestampCompleto(valorActual);
    nuevoValor = prompt(`Editar TIMESTAMP para ${tipo} (${targetFecha}):\nUse el formato: DD/MM/YYYY HH:MM:SS`, tsLegible);
    if (nuevoValor === null) return;
    const parsed = parsearTimestamp(nuevoValor);
    if (!parsed) {
      mostrarToast('Formato de timestamp inválido. Use el formato: DD/MM/YYYY HH:MM:SS', 'error');
      return;
    }
    nuevoValor = parsed.timestampFormatted;
  } else {
    nuevoValor = prompt(`Editar ${campo} para ${tipo} (${targetFecha}):`, valorActual);
    if (nuevoValor === null || nuevoValor === valorActual) return;
  }

  if (nuevoValor === null) return;

  // Realizar actualización optimista en el cache local
  let emp = empCache.find(e => e.id === empleadoId);
  let originalRegistros = emp ? JSON.parse(JSON.stringify(emp.registros || [])) : null;
  let originalAlmuerzoHoy = emp ? emp.almuerzoHoy : null;

  if (emp) {
    if (!emp.registros) emp.registros = [];
    let reg = null;
    if (docId) {
      reg = emp.registros.find(r => r.id === docId);
    }
    if (!reg) {
      reg = emp.registros.find(r => r.fecha === targetFecha && r.tipo === tipo);
    }

    if (reg) {
      if (campo === 'timestamp') {
        const parsed = parsearTimestamp(nuevoValor);
        if (parsed) {
          reg.timestamp = parsed.timestampFormatted;
          reg.fecha = parsed.fecha;
          reg.hora = parsed.hora;
        }
      } else {
        reg[campo] = nuevoValor;
        if (campo === 'hora') {
          reg.hora = nuevoValor;
        }
      }
    } else {
      let newReg = {
        id: docId || 'temp_' + Date.now(),
        empleadoId: empleadoId,
        nombre: emp.nombre,
        fecha: targetFecha,
        tipo: tipo,
        hora: campo === 'hora' ? nuevoValor : '00:00:00',
        almuerzo: campo === 'almuerzo' ? nuevoValor : 'NO',
        modo: campo === 'modo' ? nuevoValor : 'OFICINA',
        horasExtra: campo === 'horasExtra' ? nuevoValor : 'NO',
        observacion: campo === 'observacion' ? nuevoValor : '',
        timestamp: new Date().toISOString()
      };
      if (campo === 'timestamp') {
        const parsed = parsearTimestamp(nuevoValor);
        if (parsed) {
          newReg.timestamp = parsed.timestampFormatted;
          newReg.fecha = parsed.fecha;
          newReg.hora = parsed.hora;
        }
      }
      emp.registros.push(newReg);
    }

    if (targetFecha === hoy && tipo === 'ENTRADA' && campo === 'almuerzo') {
      emp.almuerzoHoy = nuevoValor;
    }
  }

  // Redibujar la UI inmediatamente
  mostrarToast('Procesando edición...', 'info');
  if (panelActual === 'detalle') mostrarDetalle(empleadoId);
  else {
    cargarAsistencia();
    cargarDashboard();
  }
  if (typeof filtrarTablaReportes === 'function') filtrarTablaReportes();
  if (typeof filtrarReporteInteractivo === 'function') filtrarReporteInteractivo();

  // Enviar la petición en segundo plano
  const bgSync = $('bgSyncIndicator');
  if (bgSync) bgSync.classList.remove('hidden');
  try {
    const res = await jsonpRequest({
      accion: 'actualizarRegistroGeneral',
      docId: docId || '',
      empleadoId: empleadoId,
      tipo: tipo,
      fecha: targetFecha,
      campo: campo,
      valor: nuevoValor
    });
    if (res && res.ok) {
      mostrarToast('Registro actualizado', 'success');
      limpiarCachesLocales();
      await cargarDatosCompletos(true, true); // silent sync
    } else {
      mostrarToast(res?.error || 'Error al actualizar', 'error');
      // Revertir
      if (emp && originalRegistros) {
        emp.registros = originalRegistros;
        if (targetFecha === hoy) emp.almuerzoHoy = originalAlmuerzoHoy;
      }
      if (panelActual === 'detalle') mostrarDetalle(empleadoId);
      else {
        cargarAsistencia();
        cargarDashboard();
      }
    }
  } catch (e) {
    mostrarToast('Error de conexión al actualizar', 'error');
    // Revertir
    if (emp && originalRegistros) {
      emp.registros = originalRegistros;
      if (targetFecha === hoy) emp.almuerzoHoy = originalAlmuerzoHoy;
    }
    if (panelActual === 'detalle') mostrarDetalle(empleadoId);
    else {
      cargarAsistencia();
      cargarDashboard();
    }
  } finally {
    if (bgSync) bgSync.classList.add('hidden');
  }
}

async function editarMetaEmpleado(empleadoId, campo, valorActual) {
  const isAdmin = (typeof esAdminMaster === 'function') ? esAdminMaster() : !!window.isMaster;
  if (!isAdmin) { mostrarToast('Solo el Administrador General (1058) puede realizar esta acción.', 'error'); return; }
  let nuevo = prompt(`Editar ${campo} del empleado:`, valorActual);
  if (nuevo === null || nuevo === valorActual) return;

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarEmpleado',
      empleadoId: empleadoId,
      campo: campo,
      valor: nuevo
    });
    if (res.ok) {
      mostrarToast('Empleado actualizado', 'success');
      const finalId = (campo === 'id') ? nuevo : empleadoId;
      cargarDatosCompletos(false, true).then(() => {
        if (panelActual === 'detalle') mostrarDetalle(finalId);
      });
    } else {
      mostrarToast(res.error || 'Error', 'error');
    }
  } catch (e) {
    mostrarToast('Error de conexión', 'error');
  } finally {
    mostrarLoader(false);
  }
}



// ============================================================
// ============================================================
// MODAL DE JUSTIFICACIÓN
// ============================================================
window.mostrarModalJustificar = function (empId, nombre, fecha, tiempoStr, razon) {
  window.currentJustifyEmpId = empId;
  window.currentJustifyFecha = fecha;
  $('justNombre').textContent = nombre;
  $('justFecha').textContent = fecha;
  $('justTiempo').textContent = tiempoStr;
  $('justObservaciones').value = '';
  $('justTipoPermiso').selectedIndex = 0;
  $('justificarModal').classList.remove('hidden');
};

window.cerrarModalJustificar = function () {
  $('justificarModal').classList.add('hidden');
  window.currentJustifyEmpId = null;
  window.currentJustifyFecha = null;
};

window.guardarJustificacion = async function () {
  if (!window.currentJustifyEmpId || !window.currentJustifyFecha) return;

  const tipoPermisoSelect = $('justTipoPermiso');
  const tipoPermisoText = tipoPermisoSelect.options[tipoPermisoSelect.selectedIndex].text;
  const observaciones = $('justObservaciones').value.trim();
  const razonCompleta = tipoPermisoText + (observaciones ? " - " + observaciones : "");

  let supervisorName = "Supervisor";
  let sessionData = {};
  try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  if (sessionData.id) {
    if (String(sessionData.id) === "1058") {
      supervisorName = "Admin Master";
    } else {
      let sup = empCache.find(x => x.id === sessionData.id);
      if (sup) supervisorName = sup.nombre;
      else supervisorName = "Supervisor ID " + sessionData.id;
    }
  }

  // Optimistic update of local cache
  let empId = window.currentJustifyEmpId;
  let fecha = window.currentJustifyFecha;
  let emp = empCache.find(e => e.id === empId);

  // Save current state for backup
  let originalRegistros = emp ? JSON.parse(JSON.stringify(emp.registros || [])) : null;

  if (emp) {
    if (!emp.registros) emp.registros = [];
    let regs = emp.registros.filter(r => r.fecha === fecha);
    if (regs.length > 0) {
      regs.forEach(r => {
        r.justificado = 'SI';
        r.quien_justifica = supervisorName;
        r.razon_justificac = razonCompleta;
      });
    } else {
      emp.registros.push({
        id: 'temp_' + Date.now(),
        empleadoId: empId,
        nombre: emp.nombre,
        fecha: fecha,
        tipo: 'JUSTIFICACION',
        hora: '00:00:00',
        almuerzo: 'NO',
        modo: 'OFICINA',
        horasExtra: 'NO',
        justificado: 'SI',
        quien_justifica: supervisorName,
        razon_justificac: razonCompleta,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Close modal immediately and show initial toast
  window.cerrarModalJustificar();
  mostrarToast('Día justificado (procesando...)', 'success');

  // Redraw UI immediately
  if (panelActual === 'detalle') mostrarDetalle(empId);
  else {
    cargarAsistencia();
    cargarDashboard();
  }
  if (typeof filtrarTablaReportes === 'function') filtrarTablaReportes();
  if (typeof filtrarReporteInteractivo === 'function') filtrarReporteInteractivo();

  // Perform network request in background
  try {
    const res = await jsonpRequest({
      accion: 'justificarDia',
      empleadoId: empId,
      fecha: fecha,
      razon: razonCompleta,
      supervisor: supervisorName
    });

    if (res && res.ok) {
      mostrarToast('Día justificado correctamente', 'success');
      limpiarCachesLocales();
      // Silently sync cache in background
      await cargarDatosCompletos(true, true);
    } else {
      mostrarToast(res?.error || 'Error al guardar justificación', 'error');
      // Revert on error
      if (emp && originalRegistros) {
        emp.registros = originalRegistros;
      }
      if (panelActual === 'detalle') mostrarDetalle(empId);
      else {
        cargarAsistencia();
        cargarDashboard();
      }
    }
  } catch (e) {
    mostrarToast('Error de conexión al guardar justificación', 'error');
    // Revert on error
    if (emp && originalRegistros) {
      emp.registros = originalRegistros;
    }
    if (panelActual === 'detalle') mostrarDetalle(empId);
    else {
      cargarAsistencia();
      cargarDashboard();
    }
  }
};

// ============================================================
// CARGA DE DATOS
// ============================================================
async function cargarDatosCompletos(force = false, silencioso = false, forceSheets = false) {
  if (estaActualizando) return;
  estaActualizando = true;

  // Si ya disponemos de datos en memoria, sincronizar siempre de forma no bloqueante (en segundo plano)
  const tieneDatosPrevios = Array.isArray(empCache) && empCache.length > 0;
  const usarLoaderPantallaCompleta = !silencioso && !tieneDatosPrevios;

  if (usarLoaderPantallaCompleta) {
    mostrarLoader(true);
  } else {
    const bgSync = $('bgSyncIndicator');
    if (bgSync) bgSync.classList.remove('hidden');
  }
  try {
    const res = await jsonpRequest({
      accion: 'obtenerDatosSupervisor',
      force: force,
      forceSheets: forceSheets
    });
    if (usarLoaderPantallaCompleta) mostrarLoader(false);
    estaActualizando = false;

    const bgSync = $('bgSyncIndicator');
    if (bgSync) bgSync.classList.add('hidden');

    if (!res || res.error) {
      if (!silencioso && !tieneDatosPrevios) mostrarToast(res?.error || 'Error al cargar datos', 'error');
      return;
    }
    empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
    empCache.forEach(emp => {
      if (emp.registros && emp.registros.length) {
        emp.registros.forEach(r => {
          if (r.fecha) r.fecha = normalizarFechaStr(r.fecha) || r.fecha;
        });
      }
    });

    let eliminadosList = res.empleadosEliminados || [];
    eliminadosList.forEach(emp => {
      if (emp.registros && emp.registros.length) {
        emp.registros.forEach(r => {
          if (r.fecha) r.fecha = normalizarFechaStr(r.fecha) || r.fecha;
        });
      }
    });
    const activeIds = new Set(empCache.map(e => String(e.id).trim()));
    const elimIds = new Set(eliminadosList.map(e => String(e.id).trim()));

    if (res.registros && res.registros.length) {
      const elimMap = {};
      res.registros.forEach(r => {
        const rId = String(r.empleadoId || r.id_empleado || (r.id && !String(r.id).includes('_') ? r.id : '')).trim();
        if (rId && !activeIds.has(rId) && !elimIds.has(rId)) {
          if (!elimMap[rId]) {
            elimMap[rId] = {
              id: rId,
              nombre: r.nombre || `Colaborador (${rId})`,
              area: 'Eliminado',
              cargo: 'Eliminado',
              esEliminado: true,
              activo: false,
              registros: []
            };
          }
          elimMap[rId].registros.push(r);
        }
      });
      eliminadosList = eliminadosList.concat(Object.values(elimMap));
    }
    window.empEliminadosCache = eliminadosList.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
    window.almuerzosExtra = res.almuerzosExtra || [];
    window.solicitudesInvitados = res.solicitudesInvitados || [];
    if (typeof window.filtrarTablaInvitados === 'function' && panelActual === 'invitados') {
      window.filtrarTablaInvitados();
    }
    window.emergencia = res.emergencia || { activa: false, nombre: '' };
    periodos = generarPeriodos();

    const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr);
        const id = session.id;
        const sup = empCache.find(x => String(x.id).trim() === String(id).trim());
        const rol = getSupervisorRole(session, sup);

        if (rol === 'EMPLEADO') {
          console.warn("⚠️ Intento de acceso no autorizado detectado. Cerrando sesión...");
          localStorage.removeItem('SUPERVISOR_SESSION');
          location.reload();
          return;
        }

        // Set global permissions
        window.isMaster = (rol === 'ADMIN_MASTER');
        window.isSupervisorAdmin = (rol === 'SUPERVISOR_ADMIN');

        if ($('navItemReportes')) $('navItemReportes').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';
        if ($('navItemOpciones')) $('navItemOpciones').style.display = (rol === 'ADMIN_MASTER') ? 'flex' : 'none';
        if ($('navItemWhatsApp')) $('navItemWhatsApp').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';

        mostrarInformacionSupervisor(session);
      } catch (e) { }
    }

    let periodoSelect = $('periodoMensual');
    let periodoSelectDash = $('periodoMensualDash');
    let tardanzaSelect = $('periodoTardanzas');
    let kpiDetallePeriodo = $('kpiDetallePeriodo');
    if (periodoSelect) periodoSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    if (periodoSelectDash) periodoSelectDash.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    if (tardanzaSelect) tardanzaSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    if (kpiDetallePeriodo) kpiDetallePeriodo.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');

    $('lastUpdate').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    cargarPanelActual();
    if (typeof window.actualizarNotificacionesSupAdminInvitados === 'function') {
      window.actualizarNotificacionesSupAdminInvitados();
    }
  } catch (e) {
    if (!silencioso) {
      mostrarLoader(false);
      mostrarToast('Error de conexión: ' + e.message, 'error');
    }
    const bgSync = $('bgSyncIndicator');
    if (bgSync) bgSync.classList.add('hidden');
    const detContent = $('detalleContent');
    if (detContent) {
      detContent.style.opacity = '1';
      detContent.style.pointerEvents = 'auto';
    }
    estaActualizando = false;
  }
}

function cargarPanelActual() {
  if (panelActual === 'dashboard') {
    cargarDashboard();
  }
  else if (panelActual === 'reportes') {
    inicializarReporteInteractivo();
  }
  else if (panelActual === 'asistencia') {
    if (window.subtabAsistenciaActual === 'directorio') {
      cargarDirectorio();
    } else if (window.subtabAsistenciaActual === 'mapa') {
      if (typeof window.inicializarMapaAsistencia === 'function') window.inicializarMapaAsistencia();
    } else {
      cargarAsistencia();
    }
  }
  else if (panelActual === 'servicios') {
    if (window.subtabServiciosActual === 'menu') {
      cargarMenuSemanal();
    } else if (window.subtabServiciosActual === 'cultura') {
      if (typeof window.cargarBancoPreguntasCultura === 'function') window.cargarBancoPreguntasCultura();
    } else if (window.subtabServiciosActual === 'invitados') {
      if (typeof window.cargarPanelInvitados === 'function') window.cargarPanelInvitados();
    } else {
      cargarEmergenciasSupervisor(true);
    }
  }
  else if (panelActual === 'whatsapp') {
    if (typeof window.inicializarPanelWhatsApp === 'function') window.inicializarPanelWhatsApp();
  }
  else if (panelActual === 'detalle' && window.idDetalleActual) {
    mostrarDetalle(window.idDetalleActual, window.indexPeriodoDetalleActual || 0, window.customInicioDetalleActual, window.customFinDetalleActual);
  }
  else if (panelActual === 'opciones') {
    if (window.actualizarKPIsOpciones) window.actualizarKPIsOpciones();
    if (window.poblarTablaRolesActuales) window.poblarTablaRolesActuales();
    if (window.renderGestionDesvinculacion && $('contModoDesvincular') && $('contModoDesvincular').style.display !== 'none') {
      window.renderGestionDesvinculacion();
    }
  }
}

// ============================================================
// GESTIÓN DE SESIÓN SUPERVISOR Y ROLES
// ============================================================
function getSupervisorRole(idOrSession, supObj) {
  let id = "";
  let supData = supObj;
  if (idOrSession && typeof idOrSession === 'object') {
    id = String(idOrSession.id || '').trim();
    if (!supData) supData = idOrSession;
  } else {
    id = String(idOrSession || '').trim();
  }

  if (id === "1058") return 'ADMIN_MASTER';

  const emp = supData || (typeof empCache !== 'undefined' ? empCache.find(x => String(x.id).trim() === id) : null);
  const supVal = String(emp?.supervisor || emp?.rol || '').trim().toUpperCase();

  if (supVal === 'SUPERVISOR ADMIN' || supVal === 'SUPERVISOR_ADMIN' || supVal === 'ADMIN_SUPERVISOR' || supVal === 'ADMIN') {
    return 'SUPERVISOR_ADMIN';
  }
  if (supVal === 'SI' || supVal === 'SUPERVISOR') {
    return 'SUPERVISOR';
  }
  return 'EMPLEADO';
}
window.getSupervisorRole = getSupervisorRole;

function esAdminMaster(idOrSession) {
  let sessionData = idOrSession;
  if (!sessionData) {
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  }
  return getSupervisorRole(sessionData) === 'ADMIN_MASTER';
}
window.esAdminMaster = esAdminMaster;

function tienePermisoAdmin(idOrSession) {
  let sessionData = idOrSession;
  if (!sessionData) {
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }
  }
  const rol = getSupervisorRole(sessionData);
  return rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN';
}
window.tienePermisoAdmin = tienePermisoAdmin;

async function intentarLoginSupervisor() {
  const user = $('supUser').value.trim();
  const pin = $('supPin').value.trim();

  if (!user) {
    mostrarError('Ingrese su usuario');
    return;
  }
  if (!pin) {
    mostrarError('Ingrese su contraseña');
    return;
  }

  mostrarLoader(true);
  $('login-error').classList.add('hidden');

  try {
    const deviceToken = generarDeviceToken();
    const passHash = typeof hashPassword === 'function' ? await hashPassword(pin) : pin;

    // 1. Probar validación con Hash Criptográfico
    let res = await jsonpRequest({ accion: 'verificarPIN', empleadoId: user, pin: passHash, deviceToken: deviceToken });

    // 2. Fallback de compatibilidad si el usuario aún tiene contraseña en texto plano en la BD
    if ((!res || !res.valido) && (!res?.error || res?.error === "Contraseña incorrecta")) {
      const resPlain = await jsonpRequest({ accion: 'verificarPIN', empleadoId: user, pin: pin, deviceToken: deviceToken });
      if (resPlain && resPlain.valido) {
        res = resPlain;
      }
    }

    if (res && res.error) {
      mostrarError(res.error);
    } else if (res && res.valido) {
      const rol = getSupervisorRole(res.empleado);
      if (res.empleado.esSupervisor || rol !== 'EMPLEADO') {
        const sessionData = {
          id: res.empleado.id,
          nombre: res.empleado.nombre || '',
          foto_url: res.empleado.foto_url || '',
          cargo: res.empleado.cargo || '',
          supervisor: res.empleado.supervisor || '',
          rol: rol,
          token: deviceToken,
          timestamp: new Date().getTime()
        };
        localStorage.setItem('SUPERVISOR_SESSION', JSON.stringify(sessionData));

        // Estado global de permisos
        window.isMaster = (rol === 'ADMIN_MASTER');
        window.isSupervisorAdmin = (rol === 'SUPERVISOR_ADMIN');

        if ($('navItemReportes')) $('navItemReportes').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';
        if ($('navItemOpciones')) $('navItemOpciones').style.display = (rol === 'ADMIN_MASTER') ? 'flex' : 'none';
        if ($('navItemWhatsApp')) $('navItemWhatsApp').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';

        mostrarInformacionSupervisor(sessionData);
        $('login-supervisor').classList.add('hidden');
        cargarDatosCompletos();
      } else {
        mostrarError('El usuario no tiene rango de Supervisor.');
      }
    } else {
      mostrarError('PIN o Contraseña incorrecta.');
    }
  } catch (e) {
    mostrarError('Error de conexión');
  } finally {
    window.mostrarLoader(false);
  }
}

function mostrarError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function generarDeviceToken() {
  let token = localStorage.getItem('DEVICE_TOKEN_SUPERVISOR');
  if (!token) {
    token = 'SUP_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    localStorage.setItem('DEVICE_TOKEN_SUPERVISOR', token);
  }
  return token;
}

function cerrarSesionSupervisor() {
  if (confirm("¿Estás seguro de que deseas cerrar sesión del panel de supervisión?")) {
    localStorage.removeItem('SUPERVISOR_SESSION');
    location.reload();
  }
}
window.cerrarSesionSupervisor = cerrarSesionSupervisor;

function mostrarInformacionSupervisor(session) {
  if (!session) return;

  const id = session.id || "";
  const sup = empCache.find(x => String(x.id).trim() === String(id).trim());
  const rol = getSupervisorRole(session, sup);

  let nombre = session.nombre || "";
  let foto_url = session.foto_url || "";
  let cargo = session.cargo || (rol === 'ADMIN_MASTER' ? "Administrador General" : (rol === 'SUPERVISOR_ADMIN' ? "Supervisor Administrador" : "Supervisor"));

  if (sup) {
    if (sup.nombre) nombre = sup.nombre;
    if (sup.foto_url || sup.fotoUrl || sup.foto) foto_url = sup.foto_url || sup.fotoUrl || sup.foto;
    if (sup.cargo) cargo = sup.cargo;
  }

  if (!nombre) {
    nombre = (rol === 'ADMIN_MASTER') ? "Fernando Sanmartin" : (rol === 'SUPERVISOR_ADMIN' ? `Supervisor Admin #${id}` : `Supervisor #${id}`);
  }

  if (foto_url && typeof fixFotoUrl === 'function') {
    foto_url = fixFotoUrl(foto_url, 200);
  }

  // Si la sesión almacenada tenía la URL directa sin optimizar, actualizarla
  if (session && session.foto_url && session.foto_url !== foto_url) {
    try {
      session.foto_url = foto_url;
      localStorage.setItem('SUPERVISOR_SESSION', JSON.stringify(session));
    } catch (e) { }
  }

  // Obtener inicial para fallback
  const primerLetra = nombre.trim().charAt(0).toUpperCase() || 'S';
  let rolBadge = '<span class="sup-badge-sup"><i class="fas fa-user-shield"></i> Supervisor</span>';
  let rolLabelTopBar = 'Supervisor';

  if (rol === 'ADMIN_MASTER') {
    rolBadge = '<span class="sup-badge-admin"><i class="fas fa-crown"></i> Admin Master</span>';
    rolLabelTopBar = 'Admin';
  } else if (rol === 'SUPERVISOR_ADMIN') {
    rolBadge = '<span class="sup-badge-sup-admin"><i class="fas fa-user-tie"></i> Sup. Admin</span>';
    rolLabelTopBar = 'Sup. Admin';
  }

  const renderKey = `${id}|${nombre}|${rol}|${foto_url}`;

  // 1. Renderizar en Sidebar (#sidebarSupervisorInfo) - Solo si cambió para no reiniciar peticiones de imagen
  const elSidebar = $('sidebarSupervisorInfo');
  if (elSidebar && elSidebar.dataset.renderedSup !== renderKey) {
    elSidebar.dataset.renderedSup = renderKey;
    const avatarImgHtml = foto_url
      ? `<img src="${foto_url}" alt="${escapeHtml(nombre)}" class="sup-avatar-img" referrerpolicy="no-referrer" onerror="if(!this.dataset.retried && this.src.includes('googleusercontent.com')){ this.dataset.retried='1'; const m=this.src.match(/\\/d\\/([a-zA-Z0-9_-]+)/); if(m){ this.src='https://drive.google.com/thumbnail?id='+m[1]+'&sz=w200'; return; } } this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
             <div class="sup-avatar-fallback" style="display:none;">${primerLetra}</div>`
      : `<div class="sup-avatar-fallback">${primerLetra}</div>`;

    elSidebar.innerHTML = `
          <div class="sup-card-container">
            <div class="sup-avatar-wrapper">
              ${avatarImgHtml}
            </div>
            <div class="sup-info-text">
              <div class="sup-name" title="${escapeHtml(nombre)}">${escapeHtml(nombre)}</div>
              <div class="sup-role-row">
                ${rolBadge}
                <span class="sup-id-badge">#${escapeHtml(id)}</span>
              </div>
            </div>
            <button type="button" class="btn-logout-card" onclick="cerrarSesionSupervisor()" title="Cerrar Sesión">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
        `;
  }

  // 2. Renderizar en TopBar (#topbarSupervisorProfile) - Solo si cambió
  const elTopBar = $('topbarSupervisorProfile');
  if (elTopBar && elTopBar.dataset.renderedSup !== renderKey) {
    elTopBar.dataset.renderedSup = renderKey;
    const topbarAvatarHtml = foto_url
      ? `<img src="${foto_url}" alt="${escapeHtml(nombre)}" referrerpolicy="no-referrer" onerror="if(!this.dataset.retried && this.src.includes('googleusercontent.com')){ this.dataset.retried='1'; const m=this.src.match(/\\/d\\/([a-zA-Z0-9_-]+)/); if(m){ this.src='https://drive.google.com/thumbnail?id='+m[1]+'&sz=w200'; return; } } this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
             <div class="topbar-fallback" style="display:none;">${primerLetra}</div>`
      : `<div class="topbar-fallback">${primerLetra}</div>`;

    const partesNombre = nombre.trim().split(/\s+/);
    const nombreCorto = partesNombre.length > 2 ? partesNombre[2] : partesNombre[0];

    elTopBar.innerHTML = `
          <div class="topbar-user-chip">
            <div class="topbar-avatar">
              ${topbarAvatarHtml}
            </div>
            <div class="topbar-user-meta">
              <span class="topbar-user-name" title="${escapeHtml(nombre)}">${escapeHtml(nombreCorto)}</span>
              <span class="topbar-user-role">${rolLabelTopBar}</span>
            </div>
            <button type="button" class="btn-logout-header" onclick="cerrarSesionSupervisor()" title="Cerrar Sesión">
              <i class="fas fa-power-off"></i>
              <span>Salir</span>
            </button>
          </div>
        `;
  }
}

function verificarEstadoSupervisor() {
  const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      const rol = getSupervisorRole(session);
      window.isMaster = (rol === 'ADMIN_MASTER');
      window.isSupervisorAdmin = (rol === 'SUPERVISOR_ADMIN');

      mostrarInformacionSupervisor(session);

      if ($('navItemReportes')) $('navItemReportes').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';
      if ($('navItemOpciones')) $('navItemOpciones').style.display = (rol === 'ADMIN_MASTER') ? 'flex' : 'none';
      if ($('navItemWhatsApp')) $('navItemWhatsApp').style.display = (rol === 'ADMIN_MASTER' || rol === 'SUPERVISOR_ADMIN') ? 'flex' : 'none';
    } catch (e) { }
    $('login-supervisor').classList.add('hidden');
    cargarDatosCompletos();
  } else {
    window.isMaster = false;
    window.isSupervisorAdmin = false;
    $('login-supervisor').classList.remove('hidden');
  }
}

// Sync double scrollbars helper
const initScrollSync = (topId, bottomId) => {
  const top = $(topId);
  const bottom = $(bottomId);
  if (!top || !bottom) return;

  let isSyncingTop = false;
  let isSyncingBottom = false;

  top.onscroll = function () {
    if (!isSyncingBottom) {
      isSyncingTop = true;
      bottom.scrollLeft = top.scrollLeft;
      isSyncingTop = false;
    }
  };

  bottom.onscroll = function () {
    if (!isSyncingTop) {
      isSyncingBottom = true;
      top.scrollLeft = bottom.scrollLeft;
      isSyncingBottom = false;
    }
  };
};

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.dataset.panel) cambiarPanel(item.dataset.panel);
  });
});

// Dismiss visible columns dropdown when clicking outside
document.addEventListener('click', e => {
  const dropdown = $('monthlyColsDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    const btn = dropdown.previousElementSibling;
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

// Initialize Scroll Syncs
initScrollSync('monthlyTopScroll', 'reportesScrollWrap');
initScrollSync('customRepTopScroll', 'reporteCustomScroll');

// Sincronización en tiempo real en segundo plano (cada 2 minutos)
setInterval(() => {
  const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
  if (!sessionStr) return; // No hacer nada si no hay sesión activa

  // Pausar sincronización si el navegador está en segundo plano (ahorro de batería y datos)
  if (document.hidden) return;

  // Pausar sincronización si el supervisor tiene algún modal de edición/justificación abierto
  const modalesVisibles = ['extraLunchModal', 'justificarModal', 'manualRegistroModal', 'eventoFuturoModal']
    .some(id => {
      const el = $(id);
      return el && !el.classList.contains('hidden');
    });

  if (modalesVisibles) return;

  console.log("🤖 [Real-Time Sync] Sincronizando datos de asistencia desde Firebase...");

  // Realizar actualización silenciosa de los datos desde Firebase (usando caché, force = false)
  cargarDatosCompletos(false, true).catch(err => {
    console.error("🤖 [Real-Time Sync] Error al sincronizar datos:", err);
  });
}, 120000);

$('btnRefresh').addEventListener('click', async () => {
  const btn = $('btnRefresh');
  const icon = btn ? btn.querySelector('i') : null;
  if (icon) icon.classList.add('fa-spin');
  limpiarCachesLocales();
  mostrarToast('Sincronizando datos frescos en segundo plano...', 'info');
  try {
    await cargarDatosCompletos(true, true, true);
    mostrarToast('✅ Datos actualizados correctamente', 'success');
  } catch (err) {
    mostrarToast('Error al sincronizar: ' + err.message, 'error');
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
});
$('btnExtraLunch').addEventListener('click', mostrarModalExtraLunch);
if ($('btnNuevoRegistroManual')) $('btnNuevoRegistroManual').addEventListener('click', mostrarModalManual);
if ($('btnArchivar')) $('btnArchivar').addEventListener('click', iniciarArchivadoFirebase);

document.getElementById('extraLunchModal').addEventListener('click', e => {
  if (e.target === document.getElementById('extraLunchModal')) cerrarModal();
});
document.getElementById('justificarModal').addEventListener('click', e => {
  if (e.target === document.getElementById('justificarModal')) cerrarModalJustificar();
});
document.getElementById('manualRegistroModal').addEventListener('click', e => {
  if (e.target === document.getElementById('manualRegistroModal')) cerrarModalManual();
});
document.getElementById('eventoFuturoModal').addEventListener('click', e => {
  if (e.target === document.getElementById('eventoFuturoModal')) cerrarModalFuturos();
});

// Buscadores Debounced para optimización de rendimiento
const inputSearchAsistencia = $('searchAsistencia');
if (inputSearchAsistencia) {
  inputSearchAsistencia.addEventListener('input', debounce(() => {
    filtrarAsistenciaTabla();
  }, 250));
}
const inputSearchReportes = $('searchReportes');
if (inputSearchReportes) {
  inputSearchReportes.addEventListener('input', debounce(() => {
    const customSearch = $('searchReportesCustom');
    if (customSearch) customSearch.value = inputSearchReportes.value;
    filtrarReporteInteractivo();
  }, 250));
}
const inputSearchReportesCustom = $('searchReportesCustom');
if (inputSearchReportesCustom) {
  inputSearchReportesCustom.addEventListener('input', debounce(() => {
    const topSearch = $('searchReportes');
    if (topSearch) topSearch.value = inputSearchReportesCustom.value;
    filtrarReporteInteractivo();
  }, 250));
}

// Inicio
console.log("🛠️ Iniciando Panel Supervisor...");
setTimeout(hideSplash, 2800);
if (!window.FirebaseBackend) {
  console.error("❌ FirebaseBackend no cargado. Reintentando...");
}
verificarEstadoSupervisor();

// Eventos Login
if ($('supUser')) {
  $('supUser').addEventListener('keypress', e => { if (e.key === 'Enter') intentarLoginSupervisor(); });
  setTimeout(() => $('supUser').focus(), 500);
}
if ($('supPin')) {
  $('supPin').addEventListener('keypress', e => { if (e.key === 'Enter') intentarLoginSupervisor(); });
}

// Escuchar actualización de datos en segundo plano
let _actualizandoArchivadosSup = false;
window.addEventListener('archivadosActualizados', async () => {
  const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
  if (sessionStr && !_actualizandoArchivadosSup && !estaActualizando) {
    _actualizandoArchivadosSup = true;
    try {
      console.log("🔄 Actualizando dashboard con nuevos datos históricos...");
      // Cargar sin mostrar loader para que sea transparente al usuario
      const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor', force: false });
      if (res && res.empleados) {
        // Preservar historial previamente cargado de colaboradores ya abiertos
        const mapHistCargado = new Map();
        const mapRegsCargados = new Map();
        (empCache || []).forEach(emp => {
          if (emp._historialCompletoCargado) {
            mapHistCargado.set(String(emp.id).trim(), true);
            mapRegsCargados.set(String(emp.id).trim(), emp.registros);
          }
        });

        empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
        empCache.forEach(emp => {
          const empIdKey = String(emp.id).trim();
          if (mapHistCargado.has(empIdKey)) {
            emp._historialCompletoCargado = true;
            emp.registros = mapRegsCargados.get(empIdKey) || emp.registros;
          }
          if (emp.registros && emp.registros.length) {
            emp.registros.forEach(r => {
              if (r.fecha) r.fecha = normalizarFechaStr(r.fecha) || r.fecha;
            });
          }
        });
        if (res.empleadosEliminados) {
          window.empEliminadosCache = res.empleadosEliminados.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
        }
        if (res.almuerzosExtra) window.almuerzosExtra = res.almuerzosExtra;
        if (res.solicitudesInvitados) window.solicitudesInvitados = res.solicitudesInvitados;

        if (panelActual === 'detalle' && window.idDetalleActual) {
          mostrarDetalle(window.idDetalleActual, window.indexPeriodoDetalleActual || 0, window.customInicioDetalleActual, window.customFinDetalleActual);
        } else {
          cargarPanelActual();
        }
      }
    } catch (e) {
      console.warn("Aviso actualizando datos de supervisor tras archivados:", e);
    } finally {
      setTimeout(() => { _actualizandoArchivadosSup = false; }, 5000);
    }
  }
});

// Asegurar que al hacer clic en cualquier parte del card se enfoque el input adecuado
if (document.querySelector('.login-card')) {
  document.querySelector('.login-card').addEventListener('click', () => {
    if ($('supUser') && !$('supUser').value) {
      $('supUser').focus();
    } else if ($('supPin')) {
      $('supPin').focus();
    }
  });
}
if ($('btnIngresarSup')) $('btnIngresarSup').addEventListener('click', intentarLoginSupervisor);
if ($('togglePin')) {
  $('togglePin').addEventListener('click', (e) => {
    e.stopPropagation(); // Evitar que el clic en el ojo desenfoque/enfoque raro
    const inp = $('supPin');
    const type = inp.getAttribute('type') === 'password' ? 'text' : 'password';
    inp.setAttribute('type', type);
    $('togglePin').classList.toggle('fa-eye');
    $('togglePin').classList.toggle('fa-eye-slash');
    inp.focus();
  });
}

// ============================================================
// CREADOR INTERACTIVO DE REPORTES CUSTOM
// ============================================================
function obtenerColumnasCustomActivas() {
  const saved = localStorage.getItem('columnasCustomActivasReporte');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { }
  }
  return ['asistencias', 'faltas', 'atrasos', 'puntualidad', 'totalExtras50', 'totalExtras100'];
}

function guardarColumnasCustomActivas(columnas) {
  localStorage.setItem('columnasCustomActivasReporte', JSON.stringify(columnas));
}

let columnasCustomActivas = obtenerColumnasCustomActivas();
let _sortCustomReport = { col: 'nombre', dir: 'asc' };
let _reportesCustomData = [];

window.inicializarReporteInteractivo = function () {
  actualizarReporteInteractivo();
};

window.actualizarReporteInteractivo = function () {
  const selectPeriodo = $('periodoMensual');
  const idx = parseInt(selectPeriodo?.value || 0);
  let periodo = periodos[idx];
  if (!periodo || (!empCache.length && !window.empEliminadosCache?.length)) return;

  const fechaFiltro = $('filtroFechaReportes')?.value;
  const R_INI = fechaFiltro ? fechaFiltro : periodo.inicio;
  const R_FIN = fechaFiltro ? fechaFiltro : periodo.fin;

  const hoyRep = getLocalHoyStr();

  const incluirEliminados = $('chkIncluirEliminadosRep')?.checked || false;
  let listaEmpleados = [...empCache];
  if (incluirEliminados && window.empEliminadosCache && window.empEliminadosCache.length > 0) {
    listaEmpleados = listaEmpleados.concat(window.empEliminadosCache);
  }

  // Calcular estadísticas de manera idéntica a cargarReportes()
  _reportesCustomData = listaEmpleados.map(e => {
    let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= R_INI && r.fecha <= R_FIN);
    let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= R_INI && r.fecha <= R_FIN);
    let diasLaborablesTotal = obtenerDiasHabiles(R_INI, R_FIN);
    let diasLaborables = diasLaborablesTotal.filter(d => d <= hoyRep);
    let diasAsistidos = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f)).size;

    let faltas = Math.max(0, diasLaborables.length - diasAsistidos);

    // ATRASOS + ALMUERZO + PUNTUALIDAD (atrasos se calculan y descuentan dentro del loop diario abajo)
    let atrasos = 0;
    let minutosAtrasos = 0;
    let almPlanta = 0, almFuera = 0;

    const resAlm = calcularAlmuerzosPeriodo(e, R_INI, R_FIN);
    almPlanta = resAlm.almPlanta;
    almFuera = resAlm.almFuera;
    let puntualidad = 0;

    let horasExtra50 = 0;
    let horasExtra100 = 0;
    let horasCampoNormales = 0;
    let horasCampo50 = 0;
    let horasCampo100 = 0;

    let totalTiempoPersonal = 0;
    let totalTiempoMedico = 0;
    let totalTiempoPorJustificar = 0;
    let totalDescuentoBruto = 0;

    // Generar lista de todas las fechas en el rango
    let todasLasFechas = [];
    let currDate = new Date(R_INI + 'T00:00:00');
    let endDate = new Date(R_FIN + 'T00:00:00');
    while (currDate <= endDate) {
      todasLasFechas.push(currDate.toISOString().split('T')[0]);
      currDate.setDate(currDate.getDate() + 1);
    }

    todasLasFechas.forEach(fecha => {
      const regsDia = (e.registros || []).filter(r => r.fecha === fecha);
      const esFestivo = esFeriadoODomingo(fecha) || (new Date(fecha + 'T12:00:00').getDay() === 6);
      const isJustificado = regsDia.some(r => {
        if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) return true;
        if (r.razon_ausencia && String(r.razon_ausencia).trim() !== '' && String(r.razon_ausencia).trim() !== '—') return true;
        const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
        if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'RETORNO_CAMPO', 'SALIDA_CAMPO'].includes(tipo)) return true;
        return false;
      });
      const esHoyOFuturo = fecha >= getLocalHoyStr();

      if (regsDia.length === 0) {
        return;
      }

      let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO');
      let atrasoMinsHoy = 0;
      if (primerReg) {
        let mE = obtenerMinutos(primerReg.hora || primerReg.timestamp);
        let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
        if (mE !== null && mE > refEntrada + 5) {
          atrasoMinsHoy = mE - refEntrada;
        }
      }

      let periodosDia = [];
      let entradaPendiente = null;

      let sortedRegs = [...regsDia].sort((a, b) => {
        if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
        return String(a.hora || '').localeCompare(String(b.hora || ''));
      });

      sortedRegs.forEach(r => {
        const tipo = String(r.tipo || '').toUpperCase();
        if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
          entradaPendiente = r;
        } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
          if (entradaPendiente) {
            periodosDia.push({ entrada: entradaPendiente, salida: r });
            entradaPendiente = null;
          } else {
            periodosDia.push({ entrada: null, salida: r });
          }
        }
      });
      if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });

      let minutosTrabajadosHoy = 0;
      let tiempoPersonalHoy = 0;
      let tiempoMedicoHoy = 0;
      let tiempoJustificarHoy = 0;

      const hasCumpleanos = regsDia.some(r => {
        const raz = String(r.razon_ausencia || '').toLowerCase();
        const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
        return raz.includes('cumplea') || raz.includes('cumplean') || tip.includes('CUMPLE');
      });

      let ultimoSalidaMins = null;
      let ultimoSalidaReg = null;
      let processedLunchGap = false;

      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;

        let duracion = mS - mE;
        minutosTrabajadosHoy += duracion;

        if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
          let gap = mE - ultimoSalidaMins;
          if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
            let lunchMins = Math.min(45, gap);
            gap -= lunchMins;
            processedLunchGap = true;
          }
          if (gap > 0) {
            let clasif = clasificarGap(ultimoSalidaReg, gap);
            if (clasif.tipo === 'medico') {
              tiempoMedicoHoy += gap;
            } else if (clasif.tipo === 'personal') {
              tiempoPersonalHoy += gap;
            } else {
              tiempoJustificarHoy += gap;
            }
          }
        }
        ultimoSalidaMins = mS;
        ultimoSalidaReg = p.salida;
      });

      let netWorked = minutosTrabajadosHoy;
      if (!esFestivo && netWorked > 240) netWorked -= 45;

      // Auto-autorización de horas extras
      let autorizado = regsDia.some(r => r.horasExtra === 'SI');
      if (esFestivo) {
        if (netWorked > 60) autorizado = true;
        if (netWorked <= 60) autorizado = false;
      } else {
        if (netWorked >= 600) autorizado = true;
        if (netWorked - 480 <= 60) autorizado = false;
      }

      let extraMins50Acum = 0;

      periodosDia.forEach(p => {
        if (!p.entrada || !p.salida) return;
        let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
        let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
        if (mE === null || mS === null || mS <= mE) return;
        let duracion = mS - mE;
        let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

        if (esFestivo) {
          if (enCampo) {
            if (autorizado) horasCampo100 += duracion;
          } else {
            if (autorizado) horasExtra100 += duracion;
          }
        } else {
          let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
          if (enCampo) {
            if (mS <= H_INI || mE >= H_FIN) {
              horasCampo50 += duracion;
            } else {
              let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
              let mExtra = duracion - mNormal;
              horasCampoNormales += mNormal;
              horasCampo50 += mExtra;
            }
          } else {
            if (autorizado && mS > H_FIN) {
              extraMins50Acum += (mS - Math.max(mE, H_FIN));
            }
          }
        }
      });

      if (esFestivo) {
        // Ya calculados
      } else {
        horasExtra50 += extraMins50Acum;
      }

      // Sumar permisos asignados manualmente
      const regPermiso = regsDia.find(r => r.tipo === 'ENTRADA') || regsDia.find(r => r.tiempo_justificado_mins || r.permiso_personal_mins || r.permiso_medico_mins) || regsDia[0];
      const persMins = regPermiso ? Number(regPermiso.permiso_personal_mins || 0) : 0;
      const medMins = regPermiso ? Number(regPermiso.permiso_medico_mins || 0) : 0;
      const justMins = regPermiso ? Number(regPermiso.tiempo_justificado_mins || 0) : 0;
      tiempoPersonalHoy += persMins;
      tiempoMedicoHoy += medMins;
      let tiempoJustificadoHoy = justMins + (hasCumpleanos ? 240 : 0);

      if (isJustificado || esHoyOFuturo) {
        tiempoJustificarHoy = 0;
      } else {
        let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
        let totalPermisosHoy = tiempoPersonalHoy + tiempoMedicoHoy + tiempoJustificarHoy;
        let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
        tiempoJustificarHoy += unaccountedMissing;
        tiempoJustificarHoy = Math.max(0, tiempoJustificarHoy - tiempoJustificadoHoy);
      }

      // Ajustar atrasos del día descontando permisos del día
      atrasoMinsHoy = Math.max(0, atrasoMinsHoy - tiempoPersonalHoy - tiempoMedicoHoy - tiempoJustificadoHoy);
      if (atrasoMinsHoy > 0) {
        atrasos++;
        minutosAtrasos += atrasoMinsHoy;
      }

      // Descuento bruto del día: tiempo personal + (si hay tiempo por justificar: max(tjustificar, atraso), si no: solo atraso)
      const descuentoBrutoHoy = tiempoPersonalHoy + (tiempoJustificarHoy > 0 ? Math.max(tiempoJustificarHoy, atrasoMinsHoy) : atrasoMinsHoy);
      totalDescuentoBruto += descuentoBrutoHoy;

      totalTiempoPersonal += tiempoPersonalHoy;
      totalTiempoMedico += tiempoMedicoHoy;
      totalTiempoPorJustificar += tiempoJustificarHoy;
    });

    puntualidad = diasAsistidos ? Math.round((1 - atrasos / diasAsistidos) * 100) : 0;

    return {
      id: e.id,
      nombre: e.nombre,
      area: e.area,
      cargo: e.cargo || '',
      foto_url: e.foto_url,
      asistencias: diasAsistidos,
      faltas: faltas,
      permisoMedico: totalTiempoMedico,
      permisoPersonal: totalTiempoPersonal,
      tiempoPorJustificar: totalTiempoPorJustificar,
      tiempoADescontar: Math.max(0, totalDescuentoBruto - 240),
      atrasos: atrasos,
      minutosAtrasos: minutosAtrasos,
      almPlanta: almPlanta,
      almFuera: almFuera,
      puntualidad: puntualidad,
      horasExtra50: horasExtra50,
      horasExtra100: horasExtra100,
      horasCampoNormales: horasCampoNormales,
      horasCampo50: horasCampo50,
      horasCampo100: horasCampo100,
      totalExtras50: horasExtra50 + horasCampo50,
      totalExtras100: horasExtra100 + horasCampo100,
      totalHorasExtra: (horasExtra50 + horasExtra100 + horasCampo50 + horasCampo100)
    };
  });
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
};

window.renderizarColumnasInteractivas = function () {
  const container = $('columnasSelectorInteractivo');
  if (!container) return;

  container.innerHTML = '';

  COLUMNAS_DISPONIBLES.forEach(col => {
    const isActiva = columnasCustomActivas.includes(col.id);
    const chip = document.createElement('div');
    chip.className = `chip-item ${isActiva ? 'activa' : 'disponible'}`;
    chip.innerHTML = `${isActiva ? '<i class="fas fa-check-circle" style="color: #2563eb;"></i>' : '<i class="far fa-circle" style="opacity: 0.5;"></i>'} ${col.label}`;

    chip.addEventListener('click', () => {
      if (isActiva) {
        quitarColumnaCustom(col.id);
      } else {
        agregarColumnaCustom(col.id);
      }
    });

    container.appendChild(chip);
  });
};

window.agregarColumnaCustom = function (colId) {
  if (!columnasCustomActivas.includes(colId)) {
    columnasCustomActivas.push(colId);
    guardarColumnasCustomActivas(columnasCustomActivas);
    renderizarColumnasInteractivas();
    filtrarReporteInteractivo();
  }
};

window.quitarColumnaCustom = function (colId) {
  const idx = columnasCustomActivas.indexOf(colId);
  if (idx > -1) {
    columnasCustomActivas.splice(idx, 1);
    guardarColumnasCustomActivas(columnasCustomActivas);
    renderizarColumnasInteractivas();
    filtrarReporteInteractivo();
  }
};

// Drag and Drop helpers
window.allowDropCustom = function (e) {
  e.preventDefault();
};

window.dragCustom = function (e, colId) {
  e.dataTransfer.setData("text/plain", colId);
};

window.dropCustom = function (e, target) {
  e.preventDefault();
  const colId = e.dataTransfer.getData("text/plain");
  if (!colId) return;

  if (target === 'activas') {
    agregarColumnaCustom(colId);
  } else {
    quitarColumnaCustom(colId);
  }
};

window.sortReporteCustom = function (colId) {
  if (_sortCustomReport.col === colId) {
    _sortCustomReport.dir = _sortCustomReport.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _sortCustomReport.col = colId;
    _sortCustomReport.dir = 'asc';
  }
  filtrarReporteInteractivo();
};

window.setFiltroRapidoReporte = function (cargoVal, btnElement) {
  if (cargoVal === 'eliminados') {
    const chk = $('chkIncluirEliminadosRep');
    if (chk && !chk.checked) {
      chk.checked = true;
    }
  }
  if ($('filtroCargoReporte')) {
    $('filtroCargoReporte').value = cargoVal;
  }
  if (btnElement && btnElement.parentElement) {
    const btns = btnElement.parentElement.querySelectorAll('.btn-filter');
    btns.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    // Actualizar el estilo visual para mostrar el botón activo con un color de fondo diferente
    btns.forEach(b => {
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const isElim = cargoVal === 'eliminados';
    btnElement.style.background = isElim ? '#e11d48' : 'var(--blue)';
    btnElement.style.color = '#fff';
    btnElement.style.borderColor = isElim ? '#e11d48' : 'var(--blue)';
  }
  if (typeof cargarReportes === 'function') cargarReportes();
  if (typeof actualizarReporteInteractivo === 'function') actualizarReporteInteractivo();
  filtrarReporteInteractivo();
};

window.filtrarReporteInteractivo = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();

  const headerTr = $('reporteCustomHeaders');
  const bodyT = $('reporteCustomBody');
  if (!bodyT) return;

  // Headers
  function sortIconCustom(colId) {
    if (_sortCustomReport.col !== colId) return '<i class="fas fa-sort" style="opacity:.2;margin-left:4px;font-size:9px"></i>';
    return _sortCustomReport.dir === 'asc'
      ? '<i class="fas fa-sort-up" style="color:var(--red);margin-left:4px;font-size:9px"></i>'
      : '<i class="fas fa-sort-down" style="color:var(--red);margin-left:4px;font-size:9px"></i>';
  }

  if (fCargo === 'almuerzos extra') {
    // Ocultar personalizador de columnas cuando se muestran almuerzos extra
    if ($('reportsLayoutContainer')) {
      $('reportsLayoutContainer').style.display = 'none';
    }

    const selectPeriodo = $('periodoMensual');
    const idx = parseInt(selectPeriodo?.value || 0);
    let periodo = periodos[idx];
    let pInicio = periodo ? periodo.inicio : '';
    let pFin = periodo ? periodo.fin : '';

    let extras = window.obtenerAlmuerzosExtraConsolidados(pInicio, pFin);

    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }

    // Ordenar
    if (_sortCustomReport.col) {
      extras.sort((a, b) => {
        let va = a[_sortCustomReport.col] ?? '';
        let vb = b[_sortCustomReport.col] ?? '';
        if (typeof va === 'string') {
          return _sortCustomReport.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return _sortCustomReport.dir === 'asc' ? va - vb : vb - va;
      });
    }

    let headersHtml = `
          <th onclick="sortReporteCustom('fecha')" style="cursor:pointer">Fecha ${sortIconCustom('fecha')}</th>
          <th onclick="sortReporteCustom('nombre')" style="cursor:pointer">Descripción ${sortIconCustom('nombre')}</th>
          <th onclick="sortReporteCustom('cantidad')" style="text-align:center; cursor:pointer">Cantidad ${sortIconCustom('cantidad')}</th>
          <th onclick="sortReporteCustom('empresa')" style="cursor:pointer">Empresa/Destino ${sortIconCustom('empresa')}</th>
          <th onclick="sortReporteCustom('observaciones')" style="cursor:pointer">Observaciones ${sortIconCustom('observaciones')}</th>
          <th onclick="sortReporteCustom('tipo')" style="cursor:pointer">Tipo ${sortIconCustom('tipo')}</th>
        `;

    if (headerTr) headerTr.innerHTML = headersHtml;

    if (!extras.length) {
      bodyT.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--g500);"><i class="fas fa-search" style="font-size:18px; margin-bottom:8px; display:block;"></i> No hay almuerzos extras registrados en este período.</td></tr>`;
      if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = 'Mostrando 0 registros (0 almuerzos extras)';
      return;
    }

    bodyT.innerHTML = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return `<tr>
            <td style="font-family:'Fira Code',monospace;font-size:11px">${dateStr}</td>
            <td>
              <div class="employee-cell">
                <div class="employee-photo-placeholder" style="background:var(--indigo-lt); color:var(--indigo); display:flex; align-items:center; justify-content:center;"><i class="fas fa-utensils"></i></div>
                <strong>${escapeHtml(ae.nombre || 'Almuerzo Extra')}</strong>
              </div>
            </td>
            <td style="text-align:center"><span class="pill late" style="font-weight:700;font-size:11px;padding:2px 7px">${ae.cantidad || 1}</span></td>
            <td>${escapeHtml(ae.empresa || '—')}</td>
            <td>${escapeHtml(ae.observaciones || '—')}</td>
            <td><span class="pill ok" style="font-size:10px;padding:2px 7px">${escapeHtml(ae.tipo || 'Manual')}</span></td>
          </tr>`;
    }).join('');

    if ($('reporteCustomInfo')) {
      let totalCant = extras.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
      $('reporteCustomInfo').textContent = `Mostrando ${extras.length} registros (${totalCant} almuerzos extras)`;
    }
    return;
  }

  // Mostrar personalizador de columnas cuando se muestran reportes regulares
  if ($('reportsLayoutContainer')) {
    $('reportsLayoutContainer').style.display = 'grid';
  }

  let data = (_reportesCustomData || []).filter(e => {
    let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
    let matchCargo = !fCargo;
    if (fCargo === 'eliminados') {
      matchCargo = !!e.esEliminado || e.activo === false || (e.area || '').toLowerCase() === 'eliminado' || (e.cargo || '').toLowerCase() === 'eliminado';
    } else if (fCargo) {
      matchCargo = (e.cargo || '').toLowerCase() === fCargo;
    }
    return matchQ && matchCargo;
  });

  // Ordenar
  if (_sortCustomReport.col) {
    data = [...data].sort((a, b) => {
      let va = a[_sortCustomReport.col] ?? 0;
      let vb = b[_sortCustomReport.col] ?? 0;
      if (typeof va === 'string') return _sortCustomReport.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return _sortCustomReport.dir === 'asc' ? va - vb : vb - va;
    });
  }

  let headersHtml = `<th onclick="sortReporteCustom('nombre')" style="cursor:pointer">Empleado ${sortIconCustom('nombre')}</th>`;
  COLUMNAS_DISPONIBLES.forEach(col => {
    if (columnasCustomActivas.includes(col.id)) {
      if (col.id === 'area') {
        headersHtml += `<th onclick="sortReporteCustom('area')" style="cursor:pointer">Área ${sortIconCustom('area')}</th>`;
      } else {
        headersHtml += `<th onclick="sortReporteCustom('${col.id}')" style="text-align:center; cursor:pointer;">${col.label} ${sortIconCustom(col.id)}</th>`;
      }
    }
  });

  if (headerTr) headerTr.innerHTML = headersHtml;

  if (!data.length) {
    bodyT.innerHTML = `<tr><td colspan="${columnasCustomActivas.length + 1}" style="text-align:center; padding:30px; color:var(--g500);"><i class="fas fa-search" style="font-size:18px; margin-bottom:8px; display:block;"></i> No se encontraron resultados.</td></tr>`;
    if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = 'Mostrando 0 empleados';
    return;
  }

  bodyT.innerHTML = data.map(e => {
    let nombreEmpDisplay = escapeHtml(e.nombre);
    if (e.esEliminado) {
      nombreEmpDisplay += ` <span class="pill" style="font-size:9px; padding:1px 6px; background:#ffe4e6; color:#e11d48; font-weight:700; border:1px solid #fecdd3;" title="Colaborador eliminado con registros históricos">🗑️ Eliminado</span>`;
    }
    let rowHtml = `<tr onclick="mostrarDetalle('${e.id}')" style="cursor:pointer"><td><div class="employee-cell">${photoCell(e)}<span>${nombreEmpDisplay}</span></div></td>`;

    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        const valor = e[col.id];
        let contenido = '';
        if (col.id === 'area') {
          contenido = escapeHtml(valor || '—');
          rowHtml += `<td>${contenido}</td>`;
        } else {
          if (col.tipo === 'tiempo') {
            contenido = `<span style="font-family:'Fira Code',monospace;font-size:11px">${minutosAHHMMSS(valor)}</span>`;
          } else if (col.tipo === 'pct') {
            let pc = valor >= 90 ? 'ok' : valor >= 70 ? 'late' : 'miss';
            contenido = `<span class="pill ${pc}" style="font-size:11px;padding:2px 7px">${valor}%</span>`;
          } else if (col.id === 'faltas') {
            contenido = `<span class="pill ${valor > 0 ? 'miss' : 'ok'}" style="font-size:11px;padding:2px 7px">${valor}</span>`;
          } else if (col.id === 'atrasos') {
            contenido = `<span class="pill ${valor > 0 ? 'late' : 'ok'}" style="font-size:11px;padding:2px 7px">${valor}</span>`;
          } else if (col.id.startsWith('total') || col.id.startsWith('Total')) {
            contenido = `<strong style="font-family:'Fira Code',monospace;font-size:11px">${valor}</strong>`;
          } else {
            contenido = `<span style="font-family:'Fira Code',monospace;font-size:11px">${valor}</span>`;
          }
          rowHtml += `<td style="text-align:center">${contenido}</td>`;
        }
      }
    });

    rowHtml += '</tr>';
    return rowHtml;
  }).join('');

  let footerHtml = `<tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid var(--g300); position:sticky; bottom:0; z-index:10;">
        <td><strong>TOTALES / PROMEDIOS</strong></td>`;

  COLUMNAS_DISPONIBLES.forEach(col => {
    if (columnasCustomActivas.includes(col.id)) {
      if (col.id === 'area') {
        footerHtml += `<td>—</td>`;
      } else {
        let total = 0;
        let count = 0;
        data.forEach(e => {
          let val = parseFloat(e[col.id]) || 0;
          total += val;
          count++;
        });

        let displayVal = '';
        if (col.tipo === 'tiempo') {
          displayVal = minutosAHHMMSS(total);
        } else if (col.tipo === 'pct') {
          let avg = count ? Math.round(total / count) : 0;
          displayVal = `${avg}%`;
        } else {
          displayVal = total;
        }
        footerHtml += `<td style="text-align:center">${displayVal}</td>`;
      }
    }
  });
  footerHtml += '</tr>';

  bodyT.innerHTML += footerHtml;

  // Sync double scrollbars
  const tableScroll = $('reporteCustomScroll');
  const topScroll = $('customRepTopScroll');
  if (tableScroll && topScroll) {
    const dummy = topScroll.querySelector('.top-scroll-dummy');
    if (dummy) {
      setTimeout(() => {
        dummy.style.width = tableScroll.scrollWidth + 'px';
        topScroll.scrollLeft = tableScroll.scrollLeft;
      }, 50);
    }
  }

  if (typeof initScrollSync === 'function') {
    initScrollSync('customRepTopScroll', 'reporteCustomScroll');
  }

  if ($('reporteCustomInfo')) {
    $('reporteCustomInfo').textContent = `Mostrando ${data.length} empleados de ${empCache.length}`;
  }
};

window.restablecerColumnasDefault = function () {
  // Restablecer el filtro rápido de cargo si estaba en almuerzos extra
  if ($('filtroCargoReporte') && $('filtroCargoReporte').value === 'almuerzos extra') {
    $('filtroCargoReporte').value = '';
    const btns = document.querySelectorAll('#filtrosRapidosCargo .btn-filter');
    btns.forEach(b => {
      b.classList.remove('active');
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const btnTodos = Array.from(btns).find(b => b.textContent.trim().toUpperCase() === 'TODOS');
    if (btnTodos) {
      btnTodos.classList.add('active');
      btnTodos.style.background = 'var(--blue)';
      btnTodos.style.color = '#fff';
      btnTodos.style.borderColor = 'var(--blue)';
    }
  }
  columnasCustomActivas = [];
  guardarColumnasCustomActivas(columnasCustomActivas);
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
  mostrarToast('Columnas restablecidas por defecto', 'info');
};

window.cargarPlantillaReporte = function (tipo) {
  // Restablecer el filtro rápido de cargo si estaba en almuerzos extra
  if ($('filtroCargoReporte') && $('filtroCargoReporte').value === 'almuerzos extra') {
    $('filtroCargoReporte').value = '';
    const btns = document.querySelectorAll('#filtrosRapidosCargo .btn-filter');
    btns.forEach(b => {
      b.classList.remove('active');
      b.style.background = '#f8fafc';
      b.style.color = 'var(--g600)';
      b.style.borderColor = 'var(--g200)';
    });
    const btnTodos = Array.from(btns).find(b => b.textContent.trim().toUpperCase() === 'TODOS');
    if (btnTodos) {
      btnTodos.classList.add('active');
      btnTodos.style.background = 'var(--blue)';
      btnTodos.style.color = '#fff';
      btnTodos.style.borderColor = 'var(--blue)';
    }
  }
  if (tipo === 'almuerzos') {
    columnasCustomActivas = ['asistencias', 'almPlanta', 'almFuera'];
    mostrarToast('Plantilla de Almuerzos cargada', 'success');
  } else if (tipo === 'extras') {
    columnasCustomActivas = ['horasExtra50', 'horasExtra100', 'horasCampoNormales', 'horasCampo50', 'horasCampo100', 'totalExtras50', 'totalExtras100'];
    mostrarToast('Plantilla de Horas Extra cargada', 'success');
  } else if (tipo === 'asistencias') {
    columnasCustomActivas = ['asistencias', 'faltas', 'atrasos', 'minutosAtrasos', 'puntualidad'];
    mostrarToast('Plantilla de Asistencia y Atrasos cargada', 'success');
  } else if (tipo === 'completo') {
    columnasCustomActivas = COLUMNAS_DISPONIBLES.map(c => c.id);
    mostrarToast('Plantilla de Reporte Completo cargada', 'success');
  }
  guardarColumnasCustomActivas(columnasCustomActivas);
  renderizarColumnasInteractivas();
  filtrarReporteInteractivo();
};

window.exportarExcelDetalleEmpleado = function (empleadoId, indexPeriodo, customInicio = null, customFin = null) {
  let e = empCache.find(x => x.id === empleadoId);
  if (!e) {
    mostrarToast('Empleado no encontrado', 'error');
    return;
  }
  let periodo = periodos[indexPeriodo] || periodos[0];
  if (!periodo) {
    mostrarToast('Periodo no encontrado', 'error');
    return;
  }

  const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
  const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

  let R_INI = customInicio || (periodo ? periodo.inicio : '');
  let R_FIN = customFin || (periodo ? periodo.fin : '');

  let todosRegs = (e.registros || []).map(r => {
    const fNorm = normalizarFechaStr(r.fecha);
    return fNorm ? { ...r, fecha: fNorm } : r;
  });
  let regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN);

  let porDia = {};
  [...regs].sort((a, b) => {
    if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
    return String(a.hora || '').localeCompare(String(b.hora || ''));
  }).forEach(r => {
    const fechaNorm = normalizarFechaStr(r.fecha);
    if (!fechaNorm) return;
    if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
    porDia[fechaNorm].registros.push(r);
    if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
  });

  let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => b.localeCompare(a));

  let bodyHtml = '';

  // Inicializar acumuladores totales
  let totTP = 0, totTM = 0, totTJ = 0, totHoras = 0, totAtrasos = 0, totSalidaTemprana = 0;
  let totH50 = 0, totH100 = 0, totHCN = 0, totHC50 = 0, totHC100 = 0;
  let totExtra50 = 0, totExtra100 = 0;
  let totDescuentoBruto = 0;

  fechasOrdenadas.forEach(f => {
    const regsDia = porDia[f].registros;
    const d = porDia[f];
    const dayOfWeek = new Date(f + 'T12:00:00').getDay();
    const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
    const isJustificado = regsDia.some(r => {
      if (r.justificado === 'SI' || r.justificado === true || r.justificada === 'SI' || r.justificada === true) return true;
      if (r.razon_ausencia && String(r.razon_ausencia).trim() !== '' && String(r.razon_ausencia).trim() !== '—') return true;
      const tipo = String(r.tipo || r.tipo_salida || '').toUpperCase();
      if (tipo && !['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'RETORNO_CAMPO', 'SALIDA_CAMPO'].includes(tipo)) return true;
      return false;
    });

    let periodosDia = [];
    let entradaPendiente = null;
    let ultimoSalidaMins = null;
    let ultimoSalidaReg = null;

    let sortedRegs = [...regsDia].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return String(a.hora || '').localeCompare(String(b.hora || ''));
    });

    sortedRegs.forEach(r => {
      const tipo = String(r.tipo || '').toUpperCase();
      if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
        entradaPendiente = r;
      } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
        if (entradaPendiente) {
          periodosDia.push({ entrada: entradaPendiente, salida: r });
          entradaPendiente = null;
        } else {
          periodosDia.push({ entrada: null, salida: r });
        }
      }
    });
    if (entradaPendiente) periodosDia.push({ entrada: entradaPendiente, salida: null });
    if (periodosDia.length === 0) periodosDia.push({ entrada: null, salida: null });

    let horaE = periodosDia.map(p => p.entrada ? formatearHora(p.entrada.hora || p.entrada.timestamp) : '--:--').join(', ');
    let horaS = periodosDia.map(p => p.salida ? formatearHora(p.salida.hora || p.salida.timestamp) : '--:--').join(', ');

    let aBadgeVal = (d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? 'SI' : (d.almuerzo === 'NO' || d.almuerzo === 'FUERA') ? 'NO' : '—';

    let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO' || r.tipo === 'ENTRADA_CAMPO');
    let atrasoMins = 0;
    if (primerReg) {
      let mE = obtenerMinutos(primerReg.hora || primerReg.timestamp);
      let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
      if (mE !== null && mE > refEntrada + 5) atrasoMins = mE - refEntrada;
    }

    let razonAusenciaVal = '';
    let razonJustificadaVal = '';
    regsDia.forEach(r => {
      if (r.razon_ausencia) {
        razonAusenciaVal = r.razon_ausencia;
      } else if (r.tipo && esAusenciaTipo(r.tipo)) {
        const t = r.tipo.toUpperCase();
        if (t === 'VACACIONES' || t === 'VACACION') razonAusenciaVal = 'Vacación';
        else if (t === 'PERMISO_MEDICO') razonAusenciaVal = 'Permiso Médico';
        else if (t === 'PERMISO_PERSONAL') razonAusenciaVal = 'Permiso Personal';
        else if (t === 'CALAMIDAD_DOMESTICA') razonAusenciaVal = 'Calamidad Doméstica';
        else if (t === 'CUMPLEAÑOS' || t === 'CUMPLEANOS') razonAusenciaVal = 'Cumpleaños';
        else if (t === 'SALIDA_JUSTIFICADA') razonAusenciaVal = 'Salida Justificada';
      }
      if (r.razon_justificac) razonJustificadaVal = r.razon_justificac;
    });

    let razonText = razonAusenciaVal || razonJustificadaVal || '—';

    let h50 = 0, h100 = 0, hCN = 0, hC50 = 0, hC100 = 0;
    let minutosTrabajadosHoy = 0;
    let tiempoPersonal = 0;
    let tiempoMedico = 0;
    let tiempoPorJustificar = 0;



    ultimoSalidaMins = null;
    ultimoSalidaReg = null;

    let processedLunchGap = false;
    periodosDia.forEach(p => {
      if (!p.entrada || !p.salida) return;
      let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;

      let duracion = mS - mE;
      minutosTrabajadosHoy += duracion;

      if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
        let gap = mE - ultimoSalidaMins;
        if (!processedLunchGap && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
          let lunchMins = Math.min(45, gap);
          gap -= lunchMins;
          processedLunchGap = true;
        }
        if (gap > 0) {
          let clasif = clasificarGap(ultimoSalidaReg, gap);
          if (clasif.tipo === 'medico') {
            tiempoMedico += gap;
          } else if (clasif.tipo === 'personal') {
            tiempoPersonal += gap;
          } else {
            tiempoPorJustificar += gap;
          }
        }
      }
      ultimoSalidaMins = mS;
      ultimoSalidaReg = p.salida;
    });

    // Descontar almuerzo
    let netWorked = minutosTrabajadosHoy;
    if (!esFestivo && netWorked > 240) {
      netWorked -= 45;
    }

    let ultSalReg = [...regsDia].reverse().find(r => {
      const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
      return t.includes('SALIDA');
    });
    if (ultSalReg) {
      let mS = obtenerMinutos(ultSalReg.hora || ultSalReg.timestamp);
      if (mS !== null) ultimoSalidaMins = mS;
    }

    let minsSalidaTemprana = 0;
    let refSalida = esFestivo ? 975 : HORA_SALIDA_REF;
    if (!esFestivo && ultimoSalidaMins !== null && ultimoSalidaMins < refSalida) {
      minsSalidaTemprana = refSalida - ultimoSalidaMins;
    }

    let autorizadoGlobal = regsDia.some(r => r.horasExtra === 'SI');
    if (esFestivo) {
      if (netWorked > 60) autorizadoGlobal = true;
    } else {
      if (netWorked >= 600) autorizadoGlobal = true;
      if (netWorked - 480 <= 60) autorizadoGlobal = false;
    }

    periodosDia.forEach(p => {
      if (!p.entrada || !p.salida) return;
      let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
      let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
      if (mE === null || mS === null || mS <= mE) return;
      let duracion = mS - mE;
      let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

      if (esFestivo) {
        if (enCampo) {
          if (autorizadoGlobal) hC100 += duracion;
        } else {
          if (autorizadoGlobal) h100 += duracion;
        }
      } else {
        let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
        if (enCampo) {
          if (mS <= H_INI || mE >= H_FIN) {
            hC50 += duracion;
          } else {
            let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
            let mExtra = duracion - mNormal;
            hCN += mNormal;
            hC50 += mExtra;
          }
        } else {
          if (autorizadoGlobal && mS > H_FIN) {
            h50 += (mS - Math.max(mE, H_FIN));
          }
        }
      }
    });

    let tiempoJustificado = 0;
    const hasCumpleanos = regsDia.some(r => {
      const raz = String(r.razon_ausencia || '').toLowerCase();
      const tip = String(r.tipo || r.tipo_salida || '').toUpperCase();
      return raz.includes('cumplea') || raz.includes('cumplean') || tip.includes('CUMPLE');
    });
    if (hasCumpleanos) tiempoJustificado += 240;

    const esHoyOFuturo = f >= getLocalHoyStr();
    if (isJustificado || esHoyOFuturo) {
      tiempoPorJustificar = 0;
    } else {
      const entradaDia = regsDia.find(r => r.tipo === 'ENTRADA');
      const persMins = (entradaDia && entradaDia.permiso_personal_mins) ? Number(entradaDia.permiso_personal_mins) : 0;
      const medMins = (entradaDia && entradaDia.permiso_medico_mins) ? Number(entradaDia.permiso_medico_mins) : 0;
      tiempoPersonal += persMins;
      tiempoMedico += medMins;
      let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
      let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoPorJustificar;
      let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
      tiempoPorJustificar += unaccountedMissing;
    }

    // Ajustar atrasos y salida temprana descontando permisos
    const originalAtrasoMins = atrasoMins;
    const originalSalidaTemprana = minsSalidaTemprana;
    if (isJustificado) {
      atrasoMins = 0;
      minsSalidaTemprana = 0;
    } else {
      const permisosTotales = tiempoPersonal + tiempoMedico + tiempoJustificado;
      atrasoMins = Math.max(0, originalAtrasoMins - permisosTotales);
      const permisosRestantes = Math.max(0, permisosTotales - originalAtrasoMins);
      minsSalidaTemprana = Math.max(0, originalSalidaTemprana - permisosRestantes);
    }
    // Sumar permisos a TOTAL HRS
    netWorked += (tiempoPersonal + tiempoMedico);

    const descuentoDia = tiempoPersonal + (tiempoPorJustificar > 0 ? Math.max(tiempoPorJustificar, atrasoMins) : atrasoMins);
    totDescuentoBruto += descuentoDia;

    // Acumuladores
    totTP += tiempoPersonal;
    totTM += tiempoMedico;
    totTJ += tiempoPorJustificar;
    totHoras += netWorked;
    totAtrasos += atrasoMins;
    totSalidaTemprana += minsSalidaTemprana;
    totH50 += h50;
    totH100 += h100;
    totHCN += hCN;
    totHC50 += hC50;
    totHC100 += hC100;
    totExtra50 += (h50 + hC50);
    totExtra100 += (h100 + hC100);

    // Formatear fecha para mostrar
    let dObj = new Date(f + 'T12:00:00');
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    let fechaEx = `${diasSemana[dObj.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;

    bodyHtml += `<tr>
          <td>${fechaEx}</td>
          <td>${horaE}</td>
          <td>${horaS}</td>
          <td style="text-align:center;">${tiempoPersonal > 0 ? minutosAHHMMSS(tiempoPersonal) : '—'}</td>
          <td style="text-align:center;">${tiempoMedico > 0 ? minutosAHHMMSS(tiempoMedico) : '—'}</td>
          <td style="text-align:center;">${tiempoPorJustificar > 0 ? minutosAHHMMSS(tiempoPorJustificar) : '—'}</td>
          <td style="text-align:center; color:#dc2626; font-weight:bold;">${descuentoDia > 0 ? minutosAHHMMSS(descuentoDia) : '—'}</td>
          <td style="text-align:center;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
          <td style="text-align:center;">${aBadgeVal}</td>
          <td style="text-align:center;">${autorizadoGlobal ? 'SI' : 'NO'}</td>
          <td>${escapeHtml(razonText)}</td>
          <td style="text-align:center;">${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
          <td style="text-align:center;">${minsSalidaTemprana > 0 ? minutosAHHMMSS(minsSalidaTemprana) : '—'}</td>
          <td style="text-align:center;">${h50 > 0 ? minutosAHHMMSS(h50) : '—'}</td>
          <td style="text-align:center;">${h100 > 0 ? minutosAHHMMSS(h100) : '—'}</td>
          <td style="text-align:center;">${hCN > 0 ? minutosAHHMMSS(hCN) : '—'}</td>
          <td style="text-align:center;">${hC50 > 0 ? minutosAHHMMSS(hC50) : '—'}</td>
          <td style="text-align:center;">${hC100 > 0 ? minutosAHHMMSS(hC100) : '—'}</td>
          <td style="text-align:center; font-weight:bold;">${(h50 + hC50) > 0 ? minutosAHHMMSS(h50 + hC50) : '—'}</td>
          <td style="text-align:center; font-weight:bold;">${(h100 + hC100) > 0 ? minutosAHHMMSS(h100 + hC100) : '—'}</td>
        </tr>`;
  });

  const totDescontarFinal = Math.max(0, totDescuentoBruto - 240);

  // Fila de totales
  let footerHtml = `<tr style="background:#f1f5f9; font-weight:bold;">
        <td>TOTALES</td>
        <td>—</td>
        <td>—</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTP)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTM)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTJ)}</td>
        <td style="text-align:center; color:#dc2626;">${minutosAHHMMSS(totDescontarFinal)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totHoras)}</td>
        <td style="text-align:center;">—</td>
        <td style="text-align:center;">—</td>
        <td>—</td>
        <td style="text-align:center;">${minutosAHHMMSS(totAtrasos)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totSalidaTemprana)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totH50)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totH100)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totHCN)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totHC50)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totHC100)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totExtra50)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totExtra100)}</td>
      </tr>`;

  let excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Reporte Individual</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            table { border-collapse:collapse; font-family:Arial, sans-serif; }
            th { background-color:#1e40af; color:#ffffff; font-weight:bold; height:32px; text-align:left; border:0.5pt solid #cbd5e1; font-size:11px; text-transform:uppercase; }
            td { border:0.5pt solid #cbd5e1; height:26px; font-size:11px; }
            .title-cell { font-size:16px; font-weight:bold; color:#1e40af; height:45px; text-align:left; }
            .meta-cell { font-size:10px; color:#64748b; height:20px; text-align:left; }
          </style>
        </head>
        <body>
          <table>
            <tr><td colspan="19" class="title-cell">TCONTROL S.A. - REPORTE INDIVIDUAL DE ASISTENCIA</td></tr>
            <tr><td colspan="19" class="meta-cell">Empleado: ${escapeHtml(e.nombre)} (ID: ${escapeHtml(e.id)}) | Periodo: ${periodo.label} (Rango: ${R_INI} a ${R_FIN}) | Generado: ${formatearTimestampCompleto(new Date())}</td></tr>
            <tr><td colspan="19" style="height:15px;"></td></tr>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>TIEMPO PERSONAL</th>
                <th>TIEMPO MEDICO</th>
                <th>TIEMPO POR JUSTIFICAR</th>
                <th>TIEMPO A DESCONTAR</th>
                <th>TOTAL HORAS</th>
                <th>Almuerzo</th>
                <th>Autoriz. H.E.</th>
                <th>Razón</th>
                <th>ATRASOS</th>
                <th>SALIDA TEMPRANA</th>
                <th>HORAS EXTRA (A)</th>
                <th>HORAS EXTRA 100% (B)</th>
                <th>HORAS CAMPO NORMALES</th>
                <th>HORAS CAMPO 50% (C)</th>
                <th>HORAS CAMPO 100% (D)</th>
                <th>TOTAL EXTRAS 50% (A+C)</th>
                <th>TOTAL EXTRAS 100% (B+D)</th>
              </tr>
            </thead>
            <tbody>
              ${bodyHtml}
              ${footerHtml}
            </tbody>
            <tfoot>
              <tr><td colspan="20" style="height:12px;"></td></tr>
              <tr><td colspan="20" style="font-size:8pt; color:#64748b; font-style:italic;">CONFIDENCIAL — TCONTROL S.A. | Información laboral protegida por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador). Exclusivo para gestión interna y auditoría patronal autorizada.</td></tr>
            </tfoot>
          </table>
        </body>
        </html>
      `;

  const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Reporte_Individual_${e.nombre.replace(/ /g, '_')}_${R_INI}_a_${R_FIN}.xls`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast('Reporte individual exportado con éxito', 'success');
};

window.exportarExcelReporteCustom = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const selectPeriodo = $('periodoMensual');
  const idx = parseInt(selectPeriodo?.value || 0);
  let periodo = periodos[idx];
  let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    let pInicio = periodo ? periodo.inicio : '';
    let pFin = periodo ? periodo.fin : '';
    extras = window.obtenerAlmuerzosExtraConsolidados(pInicio, pFin);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    hasData = _reportesCustomData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para exportar', 'warning');
    return;
  }

  let headersHtml = '';
  let bodyHtml = '';
  let totalCols = 0;

  if (fCargo === 'almuerzos extra') {
    headersHtml = '<th>Fecha</th><th>Descripción</th><th style="text-align:center;">Cantidad</th><th>Empresa/Destino</th><th>Observaciones</th><th>Tipo</th>';
    totalCols = 6;
    bodyHtml = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return `<tr>
            <td>${dateStr}</td>
            <td>${escapeHtml(ae.nombre || 'Almuerzo Extra')}</td>
            <td style="text-align:center;">${ae.cantidad || 1}</td>
            <td>${escapeHtml(ae.empresa || '—')}</td>
            <td>${escapeHtml(ae.observaciones || '—')}</td>
            <td>${escapeHtml(ae.tipo || 'Manual')}</td>
          </tr>`;
    }).join('');
  } else {
    headersHtml = '<th>Empleado</th><th>Área</th>';
    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        headersHtml += `<th>${col.label}</th>`;
      }
    });
    totalCols = columnasCustomActivas.length + 2;

    let data = (_reportesCustomData || []).filter(e => {
      let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
      let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
      return matchQ && matchCargo;
    });

    bodyHtml = data.map(e => {
      let rowHtml = `<tr><td>${escapeHtml(e.nombre)}</td><td>${escapeHtml(e.area || '—')}</td>`;
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          const valor = e[col.id];
          let contenido = '';
          if (col.tipo === 'tiempo') {
            contenido = minutosAHHMMSS(valor);
          } else if (col.tipo === 'pct') {
            contenido = `${valor}%`;
          } else {
            contenido = valor;
          }
          rowHtml += `<td style="text-align:center;">${contenido}</td>`;
        }
      });
      rowHtml += '</tr>';
      return rowHtml;
    }).join('');
  }

  // Formato HTML premium nativo para Excel
  let excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Reporte Asistencia</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            table { border-collapse:collapse; font-family:Arial, sans-serif; }
            th { background-color:#1e40af; color:#ffffff; font-weight:bold; height:32px; text-align:left; border:0.5pt solid #cbd5e1; font-size:11px; text-transform:uppercase; }
            td { border:0.5pt solid #cbd5e1; height:26px; font-size:11px; }
            .title-cell { font-size:16px; font-weight:bold; color:#1e40af; height:45px; text-align:left; }
            .meta-cell { font-size:10px; color:#64748b; height:20px; text-align:left; }
          </style>
        </head>
        <body>
          <table>
            <tr><td colspan="${totalCols}" class="title-cell">TCONTROL S.A. - REPORTE DE ASISTENCIA</td></tr>
            <tr><td colspan="${totalCols}" class="meta-cell">Periodo: ${periodoStr} | Generado: ${formatearTimestampCompleto(new Date())}</td></tr>
            <tr><td colspan="${totalCols}" style="height:15px;"></td></tr>
            <thead>
              <tr>${headersHtml}</tr>
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
            <tfoot>
              <tr><td colspan="${totalCols}" style="height:12px;"></td></tr>
              <tr><td colspan="${totalCols}" style="font-size:8pt; color:#64748b; font-style:italic;">CONFIDENCIAL — TCONTROL S.A. | Información laboral protegida por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador). Exclusivo para gestión interna y auditoría patronal autorizada.</td></tr>
            </tfoot>
          </table>
        </body>
        </html>
      `;

  const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Reporte_Asistencia_${periodoStr.replace(/ /g, '_')}.xls`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast('Reporte exportado a Excel con éxito', 'success');
};

window.exportarGoogleSheetsReporteCustom = async function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const selectPeriodo = $('periodoMensual');
  const idx = parseInt(selectPeriodo?.value || 0);
  let periodo = periodos[idx];
  let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';

  // Nombre de hoja seguro (max 30 chars, sin caracteres ilegales)
  let nombreHoja = `Rep_${periodoStr.replace(/ — /g, '_').replace(/ /g, '_')}`;

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    let pInicio = periodo ? periodo.inicio : '';
    let pFin = periodo ? periodo.fin : '';
    extras = window.obtenerAlmuerzosExtraConsolidados(pInicio, pFin);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    hasData = _reportesCustomData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para exportar', 'warning');
    return;
  }

  // Construir cabeceras y filas
  let headers = [];
  let filas = [];

  if (fCargo === 'almuerzos extra') {
    headers = ['Fecha', 'Descripción', 'Cantidad', 'Empresa/Destino', 'Observaciones', 'Tipo'];
    filas = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return [
        dateStr,
        ae.nombre || 'Almuerzo Extra',
        ae.cantidad || 1,
        ae.empresa || '',
        ae.observaciones || '',
        ae.tipo || 'Manual'
      ];
    });
  } else {
    headers = ['Empleado', 'Área'];
    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        headers.push(col.label);
      }
    });

    let data = (_reportesCustomData || []).filter(e => {
      let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
      let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
      return matchQ && matchCargo;
    });

    filas = data.map(e => {
      let fila = [e.nombre, e.area || ''];
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          const valor = e[col.id];
          if (col.tipo === 'tiempo') {
            fila.push(minutosAHHMMSS(valor));
          } else if (col.tipo === 'pct') {
            fila.push(`${valor}%`);
          } else {
            fila.push(valor);
          }
        }
      });
      return fila;
    });
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'crearReporteGoogleSheets',
      nombreReporte: nombreHoja,
      headers: JSON.stringify(headers),
      filas: JSON.stringify(filas)
    });
    mostrarLoader(false);
    if (res && res.ok) {
      if (res.url) {
        mostrarToast('¡Reporte exportado con éxito! <a href="' + res.url + '" target="_blank" style="text-decoration:underline;color:white;font-weight:bold;margin-left:6px;">Abrir Google Sheets <i class="fas fa-external-link-alt"></i></a>', 'success');
        try {
          window.open(res.url, '_blank');
        } catch (e) {
          console.log("window.open blocked by popup blocker:", e);
        }
      } else {
        mostrarToast('¡Reporte exportado a Google Sheets con éxito!', 'success');
      }
    } else {
      mostrarToast(res?.error || 'Error al exportar a Google Sheets', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    mostrarToast('Error de red al conectar con Google Sheets: ' + err.message, 'error');
  }
};

window.imprimirReporteCustom = function () {
  let q = ($('searchReportesCustom')?.value || '').toLowerCase();
  let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
  const selectPeriodo = $('periodoMensual');
  const idx = parseInt(selectPeriodo?.value || 0);
  let periodo = periodos[idx];
  let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';

  let hasData = false;
  let extras = [];
  if (fCargo === 'almuerzos extra') {
    let pInicio = periodo ? periodo.inicio : '';
    let pFin = periodo ? periodo.fin : '';
    extras = window.obtenerAlmuerzosExtraConsolidados(pInicio, pFin);
    if (q) {
      extras = extras.filter(ae =>
        (ae.nombre || ae.invitado || '').toLowerCase().includes(q) ||
        (ae.observaciones || '').toLowerCase().includes(q) ||
        (ae.empresa || '').toLowerCase().includes(q) ||
        (ae.tipo || ae.subtipo || '').toLowerCase().includes(q)
      );
    }
    hasData = extras.length > 0;
  } else {
    hasData = _reportesCustomData.length > 0;
  }

  if (!hasData) {
    mostrarToast('No hay datos para imprimir', 'warning');
    return;
  }

  let printWindow = window.open('', '_blank');
  if (!printWindow) {
    mostrarToast('Error al abrir la ventana de impresión. Por favor habilite los pop-ups.', 'error');
    return;
  }

  // Generar headers y filas de impresión
  let headersHtml = '';
  let bodyHtml = '';
  let totalMetaLabel = '';
  let tituloReporte = '';

  if (fCargo === 'almuerzos extra') {
    headersHtml = '<th>Fecha</th><th>Descripción</th><th style="text-align:center;">Cantidad</th><th>Empresa/Destino</th><th>Observaciones</th><th>Tipo</th>';
    tituloReporte = 'TCONTROL S.A. - REPORTE DE ALMUERZOS EXTRAS';
    let totalQty = extras.reduce((sum, ae) => sum + parseInt(ae.cantidad || 0), 0);
    totalMetaLabel = `Total Almuerzos Extras: ${totalQty} | Registros: ${extras.length}`;

    bodyHtml = extras.map(ae => {
      let dateStr = formatearFechaA_DMY(ae.fecha);
      return `<tr>
            <td style="font-family:monospace;">${dateStr}</td>
            <td style="font-weight:600;">${escapeHtml(ae.nombre || 'Almuerzo Extra')}</td>
            <td style="text-align:center;">${ae.cantidad || 1}</td>
            <td>${escapeHtml(ae.empresa || '—')}</td>
            <td>${escapeHtml(ae.observaciones || '—')}</td>
            <td>${escapeHtml(ae.tipo || 'Manual')}</td>
          </tr>`;
    }).join('');
  } else {
    headersHtml = '<th>Empleado</th><th>Área</th>';
    COLUMNAS_DISPONIBLES.forEach(col => {
      if (columnasCustomActivas.includes(col.id)) {
        headersHtml += `<th>${col.label}</th>`;
      }
    });
    tituloReporte = 'TCONTROL S.A. - REPORTE OFICIAL DE ASISTENCIA';

    let data = (_reportesCustomData || []).filter(e => {
      let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
      let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
      return matchQ && matchCargo;
    });
    totalMetaLabel = `Total Empleados Evaluados: ${data.length}`;

    bodyHtml = data.map(e => {
      let rowHtml = `<tr><td style="font-weight:600;">${escapeHtml(e.nombre)}</td><td>${escapeHtml(e.area || '—')}</td>`;
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          const valor = e[col.id];
          let contenido = '';
          if (col.tipo === 'tiempo') {
            contenido = minutosAHHMMSS(valor);
          } else if (col.tipo === 'pct') {
            contenido = `${valor}%`;
          } else {
            contenido = valor;
          }
          rowHtml += `<td style="text-align:center;">${contenido}</td>`;
        }
      });
      rowHtml += '</tr>';
      return rowHtml;
    }).join('');
  }

  printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${tituloReporte} - ${periodoStr}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #333;
              padding: 20px;
              margin: 0;
            }
            .header {
              text-align: center;
              margin-bottom: 25px;
              border-bottom: 3px solid #1e40af;
              padding-bottom: 12px;
            }
            .header h1 {
              margin: 0;
              font-size: 22px;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .header p {
              margin: 6px 0 0 0;
              font-size: 13px;
              color: #4b5563;
              font-weight: bold;
            }
            .info-meta {
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              color: #64748b;
              margin-bottom: 15px;
              font-weight: 600;
              background: #f8fafc;
              padding: 8px 12px;
              border-radius: 6px;
              border: 1px solid #e2e8f0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th {
              background-color: #1e40af;
              color: #ffffff;
              font-weight: bold;
              text-align: left;
              padding: 8px 6px;
              font-size: 10px;
              text-transform: uppercase;
              border: 1px solid #cbd5e1;
            }
            td {
              padding: 7px 6px;
              font-size: 10px;
              border: 1px solid #cbd5e1;
            }
            tr:nth-child(even) {
              background-color: #f8fafc;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              font-size: 10px;
              color: #94a3b8;
              border-top: 1px dashed #cbd5e1;
              padding-top: 15px;
            }
            @page {
              size: A4 landscape;
              margin: 12mm;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${tituloReporte}</h1>
            <p>Período de Consulta: ${periodoStr}</p>
          </div>
          <div class="info-meta">
            <div>Generado el: ${formatearTimestampCompleto(new Date())}</div>
            <div>${totalMetaLabel}</div>
          </div>
          <table>
            <thead>
              <tr>${headersHtml}</tr>
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
          </table>
          <div class="footer">
            <strong>TCONTROL S.A.</strong> — Sistema de Gestión de Asistencia y Jornada Laboral CONTROL 2026<br>
            <span style="font-size: 8.5px; color: #64748b;">DOCUMENTO CONFIDENCIAL: Contiene datos personales y de asistencia amparados por la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador). Su uso se limita estrictamente a fines de control laboral y auditoría patronal autorizada. Prohibida su divulgación o copia sin autorización.</span>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 600);
            };
          </script>
        </body>
        </html>
      `);
  printWindow.document.close();
};

// ============================================================
// ACTUALIZACIÓN MASIVA DE EMPLEADOS (EXCEL, SHEETS, FORMULARIO)
// ============================================================
let _vistaPreviaMasivaCache = [];

window.actualizarKPIsOpciones = function () {
  const kpiEmp = $('kpiOpcTotalEmp');
  const kpiSup = $('kpiOpcTotalSupervisores');
  if (!kpiEmp && !kpiSup) return;

  const total = (empCache || []).length;
  const conRoles = (empCache || []).filter(e => {
    const id = String(e.id).trim();
    const rol = getSupervisorRole(e);
    return id === "1058" || rol !== 'EMPLEADO';
  }).length;

  if (kpiEmp) kpiEmp.textContent = total;
  if (kpiSup) kpiSup.textContent = conRoles;
};

window.cambiarSeccionOpciones = function (seccion) {
  const secPersonal = $('secOpcPersonal');
  const secRoles = $('secOpcRoles');
  const secSistema = $('secOpcSistema');

  if (seccion === 'desvincular') {
    if (secPersonal) secPersonal.style.display = 'block';
    if (secRoles) secRoles.style.display = 'none';
    if (secSistema) secSistema.style.display = 'none';
    window.cambiarModoGestion('desvincular');
  } else if (seccion === 'personal') {
    if (secPersonal) secPersonal.style.display = 'block';
    if (secRoles) secRoles.style.display = 'none';
    if (secSistema) secSistema.style.display = 'none';
    const contDesvincular = $('contModoDesvincular');
    if (contDesvincular && contDesvincular.style.display === 'block') {
      window.cambiarModoGestion('sheets');
    }
  } else {
    if (secPersonal) secPersonal.style.display = 'none';
    if (secRoles) {
      secRoles.style.display = (seccion === 'roles') ? 'block' : 'none';
      if (seccion === 'roles') {
        window.renderGestionRolesEmpleados();
      }
    }
    if (secSistema) secSistema.style.display = (seccion === 'sistema') ? 'block' : 'none';
  }

  document.querySelectorAll('.btn-sec-opc').forEach(btn => btn.classList.remove('active'));
  const btnActive = $('btnSec' + seccion.charAt(0).toUpperCase() + seccion.slice(1));
  if (btnActive) btnActive.classList.add('active');

  window.actualizarKPIsOpciones();
};

window.cambiarModoGestion = function (modo) {
  const contSheets = $('contModoSheets');
  const contManual = $('contModoManual');
  const contPasted = $('contModoPasted');
  const contEliminar = $('contModoEliminar');
  const contDesvincular = $('contModoDesvincular');

  if (contSheets) contSheets.style.display = modo === 'sheets' ? 'block' : 'none';
  if (contManual) contManual.style.display = modo === 'manual' ? 'block' : 'none';
  if (contPasted) contPasted.style.display = modo === 'pasted' ? 'block' : 'none';
  if (contEliminar) {
    contEliminar.style.display = modo === 'eliminar' ? 'block' : 'none';
    if (modo === 'eliminar') {
      window.renderGestionEliminacionEmpleados();
    }
  }
  if (contDesvincular) {
    contDesvincular.style.display = modo === 'desvincular' ? 'block' : 'none';
    if (modo === 'desvincular') {
      window.renderGestionDesvinculacion();
    }
  }

  // Actualizar estilos activos de los botones de pestaña dentro de la sección de personal
  document.querySelectorAll('#secOpcPersonal .tab-gestion').forEach(btn => {
    btn.style.background = 'transparent';
    btn.style.color = 'var(--g500)';
    btn.style.boxShadow = 'none';
  });

  let modoCapitalized = modo.charAt(0).toUpperCase() + modo.slice(1);
  const activeBtn = $('btnModo' + modoCapitalized);
  if (activeBtn) {
    activeBtn.style.background = 'white';
    if (modo === 'eliminar') activeBtn.style.color = '#e11d48';
    else if (modo === 'desvincular') activeBtn.style.color = '#7c3aed';
    else activeBtn.style.color = 'var(--g800)';
    activeBtn.style.boxShadow = 'var(--sh)';
  }

  // Sincronizar botón de la barra superior si se activa desvincular
  if (modo === 'desvincular') {
    document.querySelectorAll('.btn-sec-opc').forEach(btn => btn.classList.remove('active'));
    const btnSecDesv = $('btnSecDesvincular');
    if (btnSecDesv) btnSecDesv.classList.add('active');
  } else {
    const btnSecDesv = $('btnSecDesvincular');
    if (btnSecDesv && btnSecDesv.classList.contains('active')) {
      btnSecDesv.classList.remove('active');
      const btnSecPers = $('btnSecPersonal');
      if (btnSecPers) btnSecPers.classList.add('active');
    }
  }
};

// ============================================================
// GESTIÓN Y ASIGNACIÓN DE ROLES DE SEGURIDAD (ADMIN 1058)
// ============================================================
window.renderGestionRolesEmpleados = function () {
  const sel = document.getElementById('selRolEmpleado');
  if (!sel) return;

  const ordenados = (empCache || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

  let html = '<option value="">-- Selecciona un colaborador --</option>';
  ordenados.forEach(emp => {
    const id = String(emp.id).trim();
    const rol = getSupervisorRole(emp);
    let rolLabel = 'Empleado';
    if (rol === 'ADMIN_MASTER') rolLabel = '👑 Admin Master';
    else if (rol === 'SUPERVISOR_ADMIN') rolLabel = '👔 Sup. Admin';
    else if (rol === 'SUPERVISOR') rolLabel = '🛡️ Supervisor';

    html += `<option value="${escapeHtml(id)}">${escapeHtml(emp.nombre || id)} (ID: ${escapeHtml(id)}) - [${rolLabel}]</option>`;
  });

  sel.innerHTML = html;
  window.actualizarInfoRolSeleccionado();
  window.poblarTablaRolesActuales();
};

window.actualizarInfoRolSeleccionado = function () {
  const sel = document.getElementById('selRolEmpleado');
  if (!sel || !sel.value) return;

  const empId = String(sel.value).trim();
  const emp = empCache.find(e => String(e.id).trim() === empId);
  if (!emp) return;

  const rol = getSupervisorRole(emp);
  const radios = document.getElementsByName('rbNuevoRol');

  if (rol === 'ADMIN_MASTER') {
    radios.forEach(r => r.checked = false);
  } else if (rol === 'SUPERVISOR_ADMIN') {
    radios.forEach(r => { if (r.value === 'SUPERVISOR ADMIN') r.checked = true; });
  } else if (rol === 'SUPERVISOR') {
    radios.forEach(r => { if (r.value === 'SI') r.checked = true; });
  } else {
    radios.forEach(r => { if (r.value === 'NO') r.checked = true; });
  }
};

window.guardarAsignacionRol = async function (targetId = null, targetRol = null) {
  const isAdmin = (typeof esAdminMaster === 'function') ? esAdminMaster() : !!window.isMaster;
  if (!isAdmin) {
    mostrarToast('Solo el Administrador General (1058) puede asignar roles.', 'error');
    return;
  }

  const sel = document.getElementById('selRolEmpleado');
  const empId = targetId || (sel ? sel.value : null);

  if (!empId) {
    mostrarToast('Por favor, selecciona un colaborador para asignar rol.', 'warning');
    return;
  }

  if (String(empId).trim() === "1058") {
    mostrarToast('El Administrador General (1058) es permanente y su rol no se puede modificar.', 'warning');
    return;
  }

  let nuevoRol = targetRol;
  if (!nuevoRol) {
    const checkedRadio = document.querySelector('input[name="rbNuevoRol"]:checked');
    nuevoRol = checkedRadio ? checkedRadio.value : 'NO';
  }

  const emp = empCache.find(e => String(e.id).trim() === String(empId).trim());
  const nombreEmp = emp ? emp.nombre : `ID ${empId}`;

  let rolTexto = 'Empleado regular (sin permisos especiales)';
  if (nuevoRol === 'SUPERVISOR ADMIN') rolTexto = 'SUPERVISOR ADMIN (Acceso a Reportes, edición y registros manuales)';
  else if (nuevoRol === 'SI') rolTexto = 'SUPERVISOR (Turno y Operación)';

  if (!confirm(`¿Confirmas asignar el rol "${nuevoRol}" a "${nombreEmp}" (ID: ${empId})?\n\nNuevo Rol: ${rolTexto}`)) {
    return;
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarEmpleado',
      empleadoId: empId,
      campo: 'supervisor',
      valor: nuevoRol
    });

    mostrarLoader(false);

    if (res && res.ok) {
      mostrarToast(`✅ Rol asignado exitosamente a "${nombreEmp}"`, 'success');
      if (emp) {
        emp.supervisor = nuevoRol;
      }
      window.renderGestionRolesEmpleados();
      if (typeof cargarDatosCompletos === 'function') {
        await cargarDatosCompletos(true, true);
      }
    } else {
      mostrarToast(res?.error || 'Error al guardar el rol en el servidor.', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al guardar rol de empleado:", err);
    mostrarToast('Error de conexión al asignar el rol.', 'error');
  }
};

window.poblarTablaRolesActuales = function () {
  const tbody = document.getElementById('tbodyUsuariosConRoles');
  const cntEl = document.getElementById('cntUsuariosConRoles');
  if (!tbody) return;

  const conPrivilegios = (empCache || []).filter(e => {
    const id = String(e.id).trim();
    const rol = getSupervisorRole(e);
    return id === "1058" || rol !== 'EMPLEADO';
  });

  if (cntEl) cntEl.textContent = conPrivilegios.length;

  if (!conPrivilegios.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:8px;">No hay usuarios con privilegios registrados.</td></tr>';
    return;
  }

  let html = '';
  conPrivilegios.forEach(emp => {
    const id = String(emp.id).trim();
    const rol = getSupervisorRole(emp);
    const is1058 = (id === "1058");

    let badge = '<span class="sup-badge-sup"><i class="fas fa-user-shield"></i> Supervisor</span>';
    if (rol === 'ADMIN_MASTER') {
      badge = '<span class="sup-badge-admin"><i class="fas fa-crown"></i> Admin Master</span>';
    } else if (rol === 'SUPERVISOR_ADMIN') {
      badge = '<span class="sup-badge-sup-admin"><i class="fas fa-user-tie"></i> Sup. Admin</span>';
    }

    let accionesHtml = '';
    if (is1058) {
      accionesHtml = '<span style="font-size:10px; color:#94a3b8; font-weight:600;">Permanente</span>';
    } else {
      accionesHtml = `
            <div style="display:flex; gap:4px; justify-content:center;">
              ${rol !== 'SUPERVISOR_ADMIN' ? `<button onclick="window.guardarAsignacionRol('${escapeHtml(id)}', 'SUPERVISOR ADMIN')" class="btn-delete-tiny" style="padding:2px 5px; font-size:9.5px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:4px; cursor:pointer;" title="Hacer Supervisor Admin">Hacer Sup. Admin</button>` : ''}
              ${rol !== 'SUPERVISOR' ? `<button onclick="window.guardarAsignacionRol('${escapeHtml(id)}', 'SI')" class="btn-delete-tiny" style="padding:2px 5px; font-size:9.5px; background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; border-radius:4px; cursor:pointer;" title="Cambiar a Supervisor Regular">Hacer Supervisor</button>` : ''}
              <button onclick="window.guardarAsignacionRol('${escapeHtml(id)}', 'NO')" class="btn-delete-tiny" style="padding:2px 5px; font-size:9.5px; background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:4px; cursor:pointer;" title="Quitar todos los permisos">Quitar Rol</button>
            </div>
          `;
    }

    html += `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="font-weight:700; color:#334155;">#${escapeHtml(id)}</td>
            <td style="font-weight:600; color:#1e293b;">${escapeHtml(emp.nombre || '-')}</td>
            <td style="color:#64748b; font-size:10.5px;">${escapeHtml(emp.area || '-')}</td>
            <td>${badge}</td>
            <td style="text-align:center;">${accionesHtml}</td>
          </tr>
        `;
  });

  tbody.innerHTML = html;
};

function normalizarHeaderAKeyJS(header) {
  var clean = String(header).trim().toUpperCase();

  if (clean === "ID/CÉDULA" || clean === "ID/CEDULA" || clean === "ID" || clean === "CEDULA" || clean === "CÉDULA") return "id";
  if (clean === "NOMBRE COMPLETO" || clean === "NOMBRE") return "nombre";
  if (clean === "ÁREA" || clean === "AREA") return "area";
  if (clean === "CARGO") return "cargo";
  if (clean === "PIN") return "pin";
  if (clean === "SUPERVISOR (SI/NO)" || clean === "SUPERVISOR") return "supervisor";
  if (clean === "ACTIVO (SI/NO)" || clean === "ACTIVO") return "activo";
  if (clean === "URL FOTO" || clean === "FOTO" || clean === "FOTO URL" || clean === "FOTO_URL") return "foto_url";
  if (clean === "LATITUD BASE" || clean === "LATITUD" || clean === "BASELAT" || clean === "LATITUD_BASE") return "baseLat";
  if (clean === "LONGITUD BASE" || clean === "LONGITUD" || clean === "BASELNG" || clean === "LONGITUD_BASE") return "baseLng";
  if (clean === "FECHA NACIMIENTO" || clean === "FECHA_NACIMIENTO" || clean === "F. NACIMIENTO" || clean === "FECHANACIMIENTO") return "fechaNacimiento";

  // Normalizar encabezados personalizados a camelCase
  var conAcentos = "ÁÉÍÓÚÜÑáéíóúüñ";
  var sinAcentos = "AEIOUUNaeiouun";
  var h = "";
  for (var i = 0; i < clean.length; i++) {
    var char = clean.charAt(i);
    var idx = conAcentos.indexOf(char);
    h += idx !== -1 ? sinAcentos.charAt(idx) : char;
  }

  h = h.toLowerCase().replace(/[^a-z0-9_ ]/g, "");
  var parts = h.split(/[\s_]+/);
  var key = parts[0];
  for (var j = 1; j < parts.length; j++) {
    if (parts[j]) {
      key += parts[j].charAt(0).toUpperCase() + parts[j].slice(1);
    }
  }
  return key;
}

function renderVistaPreviaMasiva(empleados) {
  const tbody = $('tbodyVistaPreviaEmpleados');
  if (!tbody) return;

  if (!empleados || !empleados.length) {
    tbody.innerHTML = '';
    return;
  }

  // 1. Obtener todas las propiedades únicas (keys) presentes en todos los empleados
  const ignoreKeys = new Set([
    'registros', 'entradaHoy', 'salidaHoy', 'almuerzoHoy',
    'horaEntrada', 'horaSalida', 'horaEntradaMs', 'horaSalidaMs',
    'deviceToken', 'id_dispositivo'
  ]);
  const keysEncontradas = new Set();

  empleados.forEach(emp => {
    Object.keys(emp).forEach(key => {
      if (!key.startsWith('_') && !ignoreKeys.has(key)) {
        keysEncontradas.add(key);
      }
    });
  });

  // 2. Ordenar las columnas para que las estándar vayan primero y luego las custom
  const COLUMNAS_ORDENADAS = ['id', 'nombre', 'area', 'cargo', 'pin', 'id_dispositivo', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento'];
  const finalKeys = [];

  COLUMNAS_ORDENADAS.forEach(k => {
    if (keysEncontradas.has(k)) {
      finalKeys.push(k);
      keysEncontradas.delete(k);
    }
  });

  keysEncontradas.forEach(k => {
    finalKeys.push(k);
  });

  // 3. Traducir keys a cabeceras en español
  const MAPA_COLUMNAS_ESTANDAR = {
    id: "ID / Cédula",
    nombre: "Nombre completo",
    area: "Área",
    cargo: "Cargo",
    pin: "PIN",
    id_dispositivo: "Dispositivo / Enlace Pagos",
    supervisor: "Supervisor",
    activo: "Activo",
    foto_url: "URL Foto",
    baseLat: "Latitud",
    baseLng: "Longitud",
    fechaNacimiento: "F. Nacimiento"
  };


  function keyToHeaderLabel(key) {
    if (MAPA_COLUMNAS_ESTANDAR[key]) return MAPA_COLUMNAS_ESTANDAR[key];
    return camelCaseToTitle(key);
  }

  // 4. Renderizar el thead dinámicamente
  const thead = tbody.closest('table').querySelector('thead');
  if (thead) {
    let headersHtml = '<tr>';
    finalKeys.forEach(key => {
      let styleAlign = '';
      if (key === 'supervisor' || key === 'activo') {
        styleAlign = ' style="text-align:center"';
      }
      headersHtml += `<th${styleAlign}>${escapeHtml(keyToHeaderLabel(key))}</th>`;
    });
    headersHtml += '</tr>';
    thead.innerHTML = headersHtml;
  }

  // 5. Renderizar el tbody dinámicamente
  tbody.innerHTML = empleados.map(emp => {
    let rowHtml = '<tr>';
    finalKeys.forEach(key => {
      let val = emp[key] !== undefined && emp[key] !== null ? emp[key] : '';

      let tdHtml = '';
      if (key === 'id') {
        tdHtml = `<td style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;">${escapeHtml(val)}</td>`;
      } else if (key === 'nombre') {
        tdHtml = `<td><strong>${escapeHtml(val)}</strong></td>`;
      } else if (key === 'supervisor') {
        tdHtml = `<td style="text-align:center">${val === 'SI' ? '<span class="pill ok">SI</span>' : '<span class="pill dim">NO</span>'}</td>`;
      } else if (key === 'activo') {
        tdHtml = `<td style="text-align:center">${val === 'SI' ? '<span class="pill ok">Activo</span>' : '<span class="pill miss">Inactivo</span>'}</td>`;
      } else if (key === 'pin') {
        tdHtml = `<td style="font-family:'Fira Code',monospace;color:var(--g500);">${escapeHtml(val)}</td>`;
      } else if (key === 'baseLat' || key === 'baseLng') {
        tdHtml = `<td style="font-family:'Fira Code',monospace;font-size:11px;color:var(--g500);">${escapeHtml(val)}</td>`;
      } else if (key === 'foto_url') {
        tdHtml = `<td style="font-size:11px;color:var(--g500);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(val)}">${escapeHtml(val)}</td>`;
      } else {
        // Personalizado
        tdHtml = `<td>${escapeHtml(val)}</td>`;
      }
      rowHtml += tdHtml;
    });
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');
}

window.descargarBaseAGoogleSheetsActualizar = async function () {
  if (!empCache.length) {
    mostrarToast('No hay datos de empleados cargados.', 'warning');
    return;
  }

  mostrarLoader(true);
  try {
    // 1. Encontrar todas las propiedades únicas (keys) presentes en empCache
    const ignoreKeys = new Set([
      'registros', 'entradaHoy', 'salidaHoy', 'almuerzoHoy',
      'horaEntrada', 'horaSalida', 'horaEntradaMs', 'horaSalidaMs',
      'deviceToken', 'esSupervisor', 'creado'
    ]);

    const keysEncontradas = new Set();
    empCache.forEach(emp => {
      Object.keys(emp).forEach(key => {
        if (!key.startsWith('_') && !ignoreKeys.has(key)) {
          keysEncontradas.add(key);
        }
      });
    });

    // 2. Ordenar las columnas para que las estándar vayan primero y luego las custom
    const COLUMNAS_ORDENADAS = ['id', 'nombre', 'area', 'cargo', 'pin', 'id_dispositivo', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento', 'authExtras'];
    const finalKeys = [];

    COLUMNAS_ORDENADAS.forEach(k => {
      if (keysEncontradas.has(k)) {
        finalKeys.push(k);
        keysEncontradas.delete(k);
      }
    });

    keysEncontradas.forEach(k => {
      finalKeys.push(k);
    });

    // 3. Traducir keys a cabeceras en español
    const MAPA_HEADER_LABEL = {
      id: "ID / Cédula",
      nombre: "Nombre completo",
      area: "Área",
      cargo: "Cargo",
      pin: "PIN",
      id_dispositivo: "Dispositivo / Enlace Pagos",
      supervisor: "Supervisor (SI/NO)",
      activo: "Activo (SI/NO)",
      foto_url: "URL Foto",
      baseLat: "Latitud Base",
      baseLng: "Longitud Base",
      fechaNacimiento: "Fecha Nacimiento",
      authExtras: "Autorizar Extras (SI/NO)"
    };


    function keyToHeaderLabel(key) {
      if (MAPA_HEADER_LABEL[key]) return MAPA_HEADER_LABEL[key];
      return camelCaseToTitle(key);
    }

    const encabezados = finalKeys.map(k => keyToHeaderLabel(k));

    // 4. Mapear los empleados con solo estas propiedades
    const empleadosSheets = empCache.map(emp => {
      const empObj = {};
      finalKeys.forEach(k => {
        empObj[k] = emp[k] !== undefined && emp[k] !== null ? emp[k] : '';
      });
      return empObj;
    });

    const res = await jsonpRequest({
      accion: 'escribirHojaActualizar',
      empleados: JSON.stringify(empleadosSheets),
      columnas: JSON.stringify(finalKeys),
      encabezados: JSON.stringify(encabezados)
    });

    mostrarLoader(false);
    if (res && res.ok) {
      if (res.url) {
        mostrarToast('¡Base de datos descargada con éxito! <a href="' + res.url + '" target="_blank" style="text-decoration:underline;color:white;font-weight:bold;margin-left:6px;">Abrir Hoja ACTUALIZAR <i class="fas fa-external-link-alt"></i></a>', 'success');
      } else {
        mostrarToast('¡Base de datos descargada con éxito a la hoja "ACTUALIZAR"!', 'success');
      }
    } else {
      mostrarToast(res?.error || 'Error al descargar a Google Sheets.', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    mostrarToast('Error de red al conectar con Google Sheets: ' + err.message, 'error');
  }
};

window.leerEImportarDesdeGoogleSheetsActualizar = async function () {
  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'leerHojaActualizar'
    });

    mostrarLoader(false);
    if (res && res.ok && res.empleados) {
      const empleados = res.empleados;
      _vistaPreviaMasivaCache = empleados;

      const tbody = $('tbodyVistaPreviaEmpleados');
      const container = $('vistaPreviaEmpleadosContainer');
      const countEl = $('countVistaPrevia');

      if (!empleados.length) {
        mostrarToast('La hoja "ACTUALIZAR" no contiene registros válidos.', 'warning');
        if (container) container.style.display = 'none';
        return;
      }

      renderVistaPreviaMasiva(empleados);

      if (countEl) countEl.textContent = empleados.length;
      if (container) container.style.display = 'block';

      mostrarToast(`Importado desde Sheets: ${empleados.length} registros cargados en vista previa. ¡Verifícalos y presiona "Guardar Personal"!`, 'success');
    } else {
      mostrarToast(res?.error || 'Error al leer la hoja "ACTUALIZAR" de Google Sheets.', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    mostrarToast('Error de red al conectar con Google Sheets: ' + err.message, 'error');
  }
};

window.agregarEmpleadoDesdeFormulario = function () {
  const id = $('frmEmpId').value.trim();
  const nombre = $('frmEmpNombre').value.trim();
  const area = $('frmEmpArea').value.trim();
  const cargo = $('frmEmpCargo').value.trim();
  const pin = $('frmEmpPin').value.trim();
  const supervisor = $('frmEmpSup').value;
  const activo = $('frmEmpActivo').value;

  if (!id || !nombre || !area || !cargo || !pin) {
    mostrarToast('Por favor, complete todos los campos obligatorios (*).', 'warning');
    return;
  }

  if (pin.length !== 4 || isNaN(pin)) {
    mostrarToast('El PIN debe tener exactamente 4 dígitos numéricos.', 'warning');
    return;
  }

  const empObj = {
    id: id,
    nombre: nombre,
    area: area,
    cargo: cargo,
    pin: pin,
    supervisor: supervisor,
    activo: activo
  };

  // Evitar duplicados locales en el caché de vista previa
  const idxExistente = _vistaPreviaMasivaCache.findIndex(e => e.id === id);
  if (idxExistente > -1) {
    _vistaPreviaMasivaCache[idxExistente] = empObj;
    mostrarToast('Empleado actualizado en la lista de vista previa.', 'info');
  } else {
    _vistaPreviaMasivaCache.push(empObj);
    mostrarToast('Empleado agregado a la lista de vista previa.', 'success');
  }

  // Renderizar vista previa
  const tbody = $('tbodyVistaPreviaEmpleados');
  const container = $('vistaPreviaEmpleadosContainer');
  const countEl = $('countVistaPrevia');

  renderVistaPreviaMasiva(_vistaPreviaMasivaCache);

  if (countEl) countEl.textContent = _vistaPreviaMasivaCache.length;
  if (container) container.style.display = 'block';

  // Limpiar formulario para permitir ingresar otro
  $('frmEmpId').value = '';
  $('frmEmpNombre').value = '';
  $('frmEmpArea').value = '';
  $('frmEmpCargo').value = '';
  $('frmEmpPin').value = '';
  $('frmEmpSup').value = 'NO';
  $('frmEmpActivo').value = 'SI';
};

window.parsearPegadoMasivo = function (texto) {
  if (!texto || !texto.trim()) return [];
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lineas.length === 0) return [];

  let primerLinea = lineas[0].toLowerCase();
  let esEncabezado = primerLinea.includes('cedula') || primerLinea.includes('id') || primerLinea.includes('nombre') || primerLinea.includes('pin') || primerLinea.includes('cargo') || primerLinea.includes('area');

  let inicio = esEncabezado ? 1 : 0;
  let empleados = [];

  // Detección de separador
  let sep = '\t';
  if (lineas[0].includes('\t')) sep = '\t';
  else if (lineas[0].includes(';')) sep = ';';
  else if (lineas[0].includes(',')) sep = ',';

  let keys = ['id', 'nombre', 'area', 'cargo', 'pin', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento'];

  if (esEncabezado) {
    const headers = lineas[0].split(sep).map(h => h.trim());
    const parsedKeys = headers.map(h => normalizarHeaderAKeyJS(h));
    // Validar que al menos existan id y nombre
    if (parsedKeys.includes('id') && parsedKeys.includes('nombre')) {
      keys = parsedKeys;
    } else {
      // No es un encabezado de columnas válido, tratar la primera línea como datos
      esEncabezado = false;
      inicio = 0;
    }
  }

  const idxId = keys.indexOf('id');
  const idxNombre = keys.indexOf('nombre');

  for (let i = inicio; i < lineas.length; i++) {
    const linea = lineas[i];
    let celdas = linea.split(sep).map(c => c.trim());
    if (celdas.length < 2) continue; // Mínimo ID y Nombre

    const empIdVal = celdas[idxId !== -1 ? idxId : 0];
    const empNombreVal = celdas[idxNombre !== -1 ? idxNombre : 1];
    if (!empIdVal || !empNombreVal) continue;

    const emp = {};
    for (let colIdx = 0; colIdx < keys.length; colIdx++) {
      const key = keys[colIdx];
      if (!key) continue;

      let val = celdas[colIdx] !== undefined ? celdas[colIdx] : '';

      if (key === 'supervisor') {
        val = String(val).toUpperCase() === 'SI' ? 'SI' : 'NO';
      } else if (key === 'activo') {
        val = String(val).toUpperCase() === 'NO' ? 'NO' : 'SI';
      }
      emp[key] = val;
    }
    empleados.push(emp);
  }
  return empleados;
};

window.procesarVistaPreviaMasiva = function () {
  const txt = $('txtMasivoEmpleados').value;
  if (!txt || !txt.trim()) {
    mostrarToast('Por favor, pega algunos datos antes de previsualizar.', 'warning');
    return;
  }

  const empleados = window.parsearPegadoMasivo(txt);
  _vistaPreviaMasivaCache = empleados;

  const tbody = $('tbodyVistaPreviaEmpleados');
  const container = $('vistaPreviaEmpleadosContainer');
  const countEl = $('countVistaPrevia');

  if (!empleados.length) {
    mostrarToast('No se pudieron parsear los datos. Verifique el formato.', 'error');
    if (container) container.style.display = 'none';
    return;
  }

  renderVistaPreviaMasiva(empleados);

  if (countEl) countEl.textContent = empleados.length;
  if (container) container.style.display = 'block';

  mostrarToast(`Vista previa cargada con ${empleados.length} registros.`, 'success');
};

window.limpiarVistaPreviaMasiva = function () {
  const txtArea = $('txtMasivoEmpleados');
  if (txtArea) txtArea.value = '';

  const tbody = $('tbodyVistaPreviaEmpleados');
  if (tbody) tbody.innerHTML = '';
  const container = $('vistaPreviaEmpleadosContainer');
  if (container) container.style.display = 'none';
  _vistaPreviaMasivaCache = [];
  mostrarToast('Área de trabajo y vista previa limpiadas.', 'info');
};

window.guardarMasivoEmpleados = async function () {
  if (!_vistaPreviaMasivaCache.length) {
    const txt = $('txtMasivoEmpleados')?.value;
    if (txt && txt.trim()) {
      _vistaPreviaMasivaCache = window.parsearPegadoMasivo(txt);
    }
  }

  if (!_vistaPreviaMasivaCache.length) {
    mostrarToast('No hay datos válidos para guardar.', 'warning');
    return;
  }

  if (!confirm(`¿Estás seguro de guardar/actualizar MASIVAMENTE ${_vistaPreviaMasivaCache.length} empleados en Firebase?\n\nEsta acción modificará la base de datos de personal.`)) {
    return;
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'actualizarMasivoEmpleados',
      empleados: JSON.stringify(_vistaPreviaMasivaCache)
    });

    mostrarLoader(false);
    if (res && res.ok) {
      mostrarToast(`¡Personal actualizado con éxito! ${res.procesados} registros guardados.`, 'success');

      const txtArea = $('txtMasivoEmpleados');
      if (txtArea) txtArea.value = '';

      const tbody = $('tbodyVistaPreviaEmpleados');
      if (tbody) tbody.innerHTML = '';
      const container = $('vistaPreviaEmpleadosContainer');
      if (container) container.style.display = 'none';
      _vistaPreviaMasivaCache = [];

      limpiarCachesLocales();
      cargarDatosCompletos(true, true);
    } else {
      mostrarToast(res?.error || 'Error al guardar los datos de empleados.', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    mostrarToast('Error de red al enviar la actualización masiva: ' + err.message, 'error');
  }
};

window.triggerPhotoUpload = function (empleadoId) {
  const isAdmin = (typeof esAdminMaster === 'function') ? esAdminMaster() : !!window.isMaster;
  if (!isAdmin) {
    mostrarToast('Solo el administrador puede cambiar las fotos de los empleados.', 'error');
    return;
  }

  let fileInput = document.getElementById('hiddenPhotoInput');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'hiddenPhotoInput';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      mostrarLoader(true);

      try {
        const reader = new FileReader();
        reader.onload = function (e) {
          const img = new Image();
          img.onload = async function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const maxSize = 160;
            let w = img.width;
            let h = img.height;

            if (w > h) {
              if (w > maxSize) {
                h = Math.round((h * maxSize) / w);
                w = maxSize;
              }
            } else {
              if (h > maxSize) {
                w = Math.round((w * maxSize) / h);
                h = maxSize;
              }
            }

            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);

            const base64Str = canvas.toDataURL('image/jpeg', 0.75);

            try {
              const res = await jsonpRequest({
                accion: 'actualizarEmpleado',
                empleadoId: fileInput.dataset.empleadoId,
                campo: 'foto_url',
                valor: base64Str
              });

              if (res.ok) {
                mostrarToast('Foto actualizada correctamente', 'success');
                mostrarLoader(false);
                cargarDatosCompletos(false, true).then(() => {
                  if (panelActual === 'detalle') mostrarDetalle(fileInput.dataset.empleadoId);
                });
              } else {
                mostrarToast(res.error || 'Error al guardar la foto', 'error');
              }
            } catch (err) {
              mostrarToast('Error de red al guardar la foto', 'error');
            } finally {
              mostrarLoader(false);
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      } catch (err) {
        mostrarToast('Error procesando imagen', 'error');
        mostrarLoader(false);
      }
    });
  }

  fileInput.dataset.empleadoId = empleadoId;
  fileInput.click();
};

// ============================================================
// ponytail: CONTROL DE EMERGENCIAS Y SIMULACROS EN SUPERVISOR
// ============================================================
window.cargarEmergenciasSupervisor = async function (silencioso = false) {
  if (!silencioso) {
    await cargarDatosCompletos(true, false);
  }

  const em = window.emergencia || { activa: false, nombre: '' };
  const statusDiv = $('statusEmergenciaDetalle');
  if (statusDiv) {
    statusDiv.innerHTML = `
          <div style="padding: 12px; border-radius: 8px; background: ${em.activa ? '#fef2f2' : '#f0fdf4'}; border: 1px solid ${em.activa ? '#fca5a5' : '#bbf7d0'}; color: ${em.activa ? '#991b1b' : '#166534'}; font-weight: bold; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <span style="font-size: 15px;">📢 Estado del Evento: <strong>${em.activa ? 'ACTIVO' : 'INACTIVO'}</strong></span>
              ${em.activa ? `<br><span style="font-size: 12.5px; font-weight: normal; color: #7f1d1d; margin-top: 4px; display: inline-block;">Nombre del Evento: <strong>${em.nombre}</strong> (Iniciado el ${em.fecha || 'hoy'})</span>` : ''}
            </div>
            <div>
              <i class="fas ${em.activa ? 'fa-bell fa-beat' : 'fa-shield-alt'}" style="font-size: 20px;"></i>
            </div>
          </div>
        `;
  }

  // Update control panel inputs and buttons
  const supInput = $('supEmEventName');
  if (supInput) {
    supInput.value = em.nombre || '';
  }
  const btnStart = $('btnSupEmStart');
  const btnStop = $('btnSupEmStop');
  if (btnStart) btnStart.style.display = em.activa ? 'none' : 'flex';
  if (btnStop) btnStop.style.display = em.activa ? 'flex' : 'none';

  // Group employees by emergency status
  let aSalvoCount = 0;
  let requiereAyudaCount = 0;
  let pendientesCount = 0;

  const hoyStr = getLocalHoyStr(new Date());
  const reportesHTML = [];

  empCache.forEach(emp => {
    // Find if this employee registered their status today within their ENTRADA record
    const regEntrada = (emp.registros || []).find(r => r.tipo === 'ENTRADA' && r.fecha === hoyStr);
    const hasEstado = regEntrada && regEntrada.estado;

    let statusText = "⚪ PENDIENTE";
    let statusBadgeColor = "#64748b";
    let statusBgColor = "#f1f5f9";
    let detalle = "-";
    let horaReporte = "-";

    if (hasEstado) {
      const val = regEntrada.estado || "";
      if (val.startsWith("A salvo")) {
        aSalvoCount++;
        statusText = "🟢 A SALVO / OK";
        statusBadgeColor = "#0f766e";
        statusBgColor = "#ccfbf1";
      } else if (val.startsWith("Requiere ayuda")) {
        requiereAyudaCount++;
        statusText = "🔴 REQUIERE AYUDA";
        statusBadgeColor = "#b91c1c";
        statusBgColor = "#fee2e2";
      } else {
        // General or other status
        aSalvoCount++;
        statusText = "🟢 REGISTRADO";
        statusBadgeColor = "#0f766e";
        statusBgColor = "#ccfbf1";
      }

      // Split comments if any
      const dashIdx = val.indexOf(" - ");
      detalle = dashIdx !== -1 ? val.substring(dashIdx + 3) : "Sin comentarios";
      // Hora de reporte independiente de la hora de entrada
      // Prioridad: estado_timestamp (Firebase ms) > estado_hora (Sheets "HH:MM") > "-"
      if (regEntrada.estado_timestamp) {
        // Soporta: número ms (Date.now() int64), o Firestore Timestamp {seconds, toMillis}
        let ms = regEntrada.estado_timestamp;
        if (typeof ms === 'object') {
          ms = typeof ms.toMillis === 'function' ? ms.toMillis() : (ms.seconds || 0) * 1000;
        }
        const d = new Date(ms);
        if (!isNaN(d)) {
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          horaReporte = `${hh}:${mm}`;
        }
      } else if (regEntrada.estado_hora) {
        horaReporte = regEntrada.estado_hora; // viene del GAS como "HH:MM"
      } else {
        horaReporte = "-";
      }
    } else {
      pendientesCount++;
    }

    reportesHTML.push(`
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; font-size: 13px; font-weight: 600; color: #1e293b;">${emp.nombre || 'Sin nombre'}</td>
            <td style="padding: 12px; font-size: 13px; color: #475569;">${emp.departamento || emp.cargo || 'Área general'}</td>
            <td style="padding: 12px;">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; color: ${statusBadgeColor}; background: ${statusBgColor}; text-align: center;">
                ${statusText}
              </span>
            </td>
            <td style="padding: 12px; font-size: 13px; color: #334155; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${detalle}">
              ${detalle}
            </td>
            <td style="padding: 12px; font-size: 13px; color: #64748b;">${horaReporte}</td>
          </tr>
        `);
  });

  // Update counters
  const elSalvo = $('numASalvo');
  const elAyuda = $('numRequiereAyuda');
  const elPend = $('numPendientes');
  if (elSalvo) elSalvo.textContent = aSalvoCount;
  if (elAyuda) elAyuda.textContent = requiereAyudaCount;
  if (elPend) elPend.textContent = pendientesCount;

  // Update table body
  const tbody = $('listaReportesEmergenciaBody');
  if (tbody) {
    tbody.innerHTML = reportesHTML.length > 0 ? reportesHTML.join('') : `
          <tr>
            <td colspan="5" style="text-align: center; padding: 20px; color: #64748b;">No hay personal activo registrado para mostrar.</td>
          </tr>
        `;
  }
};

window.toggleEmergenciaSupervisor = async function (activa) {
  const inputEl = $('supEmEventName');
  const nombre = inputEl ? inputEl.value.trim() : '';
  if (activa && !nombre) {
    mostrarToast('Por favor ingrese el nombre del evento/simulacro.', 'warning');
    return;
  }

  // Pre-verificación: ¿está el backend disponible?
  if (window.USE_FIREBASE && !window.FirebaseBackend) {
    mostrarToast('Error: El motor Firebase no está cargado. Recarga la página.', 'error');
    return;
  }

  mostrarLoader(true);
  try {
    const res = await jsonpRequest({
      accion: 'toggleEmergencia',
      activa: activa,
      nombre: nombre,
      empleadoId: (() => {
        try { return JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}').id || ''; }
        catch (e) { return ''; }
      })()
    });

    mostrarLoader(false);
    if (res.ok) {
      mostrarToast(activa ? '🚨 Alerta de emergencia iniciada' : '🟢 Alerta de emergencia finalizada', 'success');

      if (!window.emergencia) window.emergencia = {};
      window.emergencia.activa = activa;
      window.emergencia.nombre = activa ? nombre : '';

      await cargarEmergenciasSupervisor();
    } else {
      mostrarToast(res.error || 'Error al actualizar la alerta', 'error');
    }
  } catch (e) {
    mostrarLoader(false);
    console.error('toggleEmergenciaSupervisor error:', e);
    mostrarToast('Error: ' + (e.message || 'No se pudo conectar con el servidor'), 'error');
  }
};

// ponytail: Supervisor Multi-date Trabajo en Campo modal, auto-load & overwrite confirmation
let _supDiasCampoState = [];

window.mostrarModalCampoSupervisor = async function (empId = null) {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (!modal) return;

  const selEmp = document.getElementById('supCampoEmpSelect');
  if (selEmp && empCache.length > 0) {
    selEmp.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${e.id})</option>`).join('');
  }

  let targetId = empId;
  if (!targetId && empCache.length > 0) {
    targetId = empCache[0].id;
  }
  if (selEmp && targetId) {
    selEmp.value = targetId;
  }

  const emp = empCache.find(e => e.id === targetId);
  const empNombre = emp ? emp.nombre : (targetId || '');

  document.getElementById('supCampoEmpId').value = targetId || '';
  document.getElementById('supCampoEmpNombreDisplay').value = `${targetId || ''} - ${empNombre}`;
  document.getElementById('supCampoProyectoInput').value = '';

  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  document.getElementById('supCampoFechaInicioInput').value = hoyStr;
  document.getElementById('supCampoFechaFinInput').value = hoyStr;
  document.getElementById('supCampoObservacionesInput').value = '';

  await cargarIngenierosAutorizadoresSupervisor();
  await generarListaDiasCampoSupervisor();
  modal.classList.remove('hidden');
};

window.alCambiarEmpCampoModal = function (newEmpId) {
  const emp = empCache.find(e => e.id === newEmpId);
  document.getElementById('supCampoEmpId').value = newEmpId;
  document.getElementById('supCampoEmpNombreDisplay').value = `${newEmpId} - ${emp ? emp.nombre : newEmpId}`;
  generarListaDiasCampoSupervisor();
};

window.abrirModalCampoSupervisor = function (empId) {
  window.mostrarModalCampoSupervisor(empId);
};

window.cerrarModalCampoSupervisor = function () {
  const modal = document.getElementById('trabajoCampoSupModal');
  if (modal) modal.classList.add('hidden');
};

window.generarListaDiasCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const fIniStr = document.getElementById('supCampoFechaInicioInput')?.value;
  const fFinStr = document.getElementById('supCampoFechaFinInput')?.value;
  const container = document.getElementById('supListaDiasCampoContainer');
  const cntSpan = document.getElementById('supCntDiasCampo');

  if (!container || !fIniStr || !fFinStr) return;

  function parseFechaLocalStr(fStr) {
    if (!fStr) return null;
    const parts = fStr.split('-');
    if (parts.length < 3) return null;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const dIni = parseFechaLocalStr(fIniStr);
  const dFin = parseFechaLocalStr(fFinStr);

  if (!dIni || !dFin || dFin < dIni) {
    container.innerHTML = `<div style="background:#fef3c7; border:1px solid #fde68a; padding:8px 12px; border-radius:6px; font-size:12px; color:#b45309;">Selecciona un rango de fechas válido.</div>`;
    return;
  }

  // Buscar únicamente registros existentes de TRABAJO EN CAMPO (por modo, tipo o razón)
  function esRegistroCampoSup(r) {
    if (!r) return false;
    const t = String(r.tipo || r.tipo_salida || '').toUpperCase();
    const m = String(r.modo || '').toUpperCase();
    const raz = String(r.razon_ausencia || r.razon || r.observaciones || '').toUpperCase();
    return (
      m === 'CAMPO' ||
      t.includes('CAMPO') ||
      t === 'TRABAJO_DE_CAMPO' ||
      t === 'SALIDA_A_CAMPO' ||
      raz.includes('CAMPO') ||
      raz.includes('TRABAJO_DE_CAMPO') ||
      raz.includes('TRABAJO EN CAMPO')
    );
  }

  let regsExistentes = [];
  const empObj = (empCache || []).find(e => e.id === empId);
  if (empObj && Array.isArray(empObj.registros)) {
    empObj.registros.forEach(r => {
      if (esRegistroCampoSup(r)) regsExistentes.push(r);
    });
  }

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (empId && firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('registros').where('empleadoId', '==', empId).get();
      snap.forEach(doc => {
        const d = doc.data();
        if (esRegistroCampoSup(d)) {
          if (!regsExistentes.some(x => x.id === doc.id || (x.fecha === d.fecha && x.tipo === d.tipo))) {
            regsExistentes.push({ id: doc.id, ...d });
          }
        }
      });
    } catch (e) { }
  }

  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const fechas = [];
  let curr = new Date(dIni);

  while (curr <= dFin) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const fStr = `${y}-${m}-${d}`;
    const diaNombre = diasSemana[curr.getDay()];

    const regsFecha = regsExistentes.filter(r => r.fecha === fStr && esRegistroCampoSup(r));
    const regEntrada = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'ENTRADA_CAMPO' || t === 'RETORNO_CAMPO' || (t.includes('ENTRADA') && t.includes('CAMPO')) || t === 'ENTRADA';
    });
    const regSalida = regsFecha.find(r => {
      const t = String(r.tipo || '').toUpperCase();
      return t === 'SALIDA_CAMPO' || (t.includes('SALIDA') && t.includes('CAMPO')) || t === 'SALIDA';
    });

    const hoyObj = new Date();
    const hoyStr = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;

    const yaExiste = regsFecha.length > 0;
    const hEntrada = regEntrada && regEntrada.hora ? regEntrada.hora.substring(0, 5) : '';
    const hSalida = regSalida && regSalida.hora ? regSalida.hora.substring(0, 5) : '';

    fechas.push({
      fecha: fStr,
      diaNombre: diaNombre,
      isFestivo: (typeof esFeriado === 'function' && esFeriado(fStr)) || curr.getDay() === 0 || curr.getDay() === 6,
      hE: hEntrada,
      hS: hSalida,
      yaExiste: yaExiste,
      docEntradaId: regEntrada ? regEntrada.id : null,
      docSalidaId: regSalida ? regSalida.id : null
    });

    curr.setDate(curr.getDate() + 1);
  }

  // Auto-cargar Proyecto, Observaciones y Autorizado Por si existe algún registro de CAMPO previo en el rango
  const regConInfo = regsExistentes.find(r => {
    if (!r.fecha) return false;
    return r.fecha >= fIniStr && r.fecha <= fFinStr && (r.observaciones || r.razon_ausencia || r.autoriza);
  });

  if (regConInfo) {
    const proyInput = document.getElementById('supCampoProyectoInput');
    const obsInput = document.getElementById('supCampoObservacionesInput');
    const autSelect = document.getElementById('supCampoAutorizadoPorSelect');

    const rawObs = String(regConInfo.observaciones || regConInfo.razon_ausencia || '').trim();
    let projFound = '';
    let obsFound = '';

    const match = rawObs.match(/\[Proyecto:\s*([^\]]+)\]/i);
    if (match) {
      projFound = match[1].trim();
      obsFound = rawObs.replace(match[0], '').trim();
    } else {
      obsFound = rawObs;
    }

    if (proyInput && projFound) proyInput.value = projFound;
    if (obsInput && obsFound && obsFound.toUpperCase() !== 'TRABAJO EN CAMPO') obsInput.value = obsFound;
    if (autSelect && regConInfo.autoriza) {
      autSelect.value = regConInfo.autoriza;
    }
  }

  _supDiasCampoState = fechas;
  if (cntSpan) cntSpan.textContent = `${fechas.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

function calcularTotalesDiaCampo(fechaVal, hEStr, hSStr) {
  if (!hEStr || !hSStr) return { t50: '0h 0m', t100: '0h 0m' };
  function toMins(hStr) {
    const parts = hStr.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  const mE = toMins(hEStr);
  let mS = toMins(hSStr);
  if (mE === null || mS === null) return { t50: '0h 0m', t100: '0h 0m' };
  if (mS < mE) {
    mS += 24 * 60;
  }
  if (mS <= mE) return { t50: '0h 0m', t100: '0h 0m' };

  const minutosBrutos = mS - mE;
  const minutosNetos = Math.max(0, minutosBrutos - 30);

  const parts = fechaVal.split('-');
  const dObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
  const esFestivo = (typeof esFeriado === 'function' && esFeriado(fechaVal)) || dObj.getDay() === 0 || dObj.getDay() === 6;

  let t50 = 0, t100 = 0;
  if (esFestivo) {
    t100 = minutosNetos;
  } else {
    const antes = Math.max(0, 450 - mE);
    const despues = Math.max(0, mS - 975);
    t50 = antes + despues;
  }

  function fmt(m) {
    return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  }
  return { t50: fmt(t50), t100: fmt(t100) };
}
window.calcularTotalesDiaCampo = calcularTotalesDiaCampo;

window.renderListaDiasCampoSupervisorHTML = function () {
  const container = document.getElementById('supListaDiasCampoContainer');
  if (!container) return;

  if (_supDiasCampoState.length === 0) {
    container.innerHTML = `<div style="background:#f1f5f9; padding:8px; border-radius:6px; font-size:12px; text-align:center; color:#64748b;">No hay fechas seleccionadas en el rango.</div>`;
    return;
  }

  container.innerHTML = _supDiasCampoState.map((item, idx) => {
    const totales = calcularTotalesDiaCampo(item.fecha, item.hE, item.hS);
    const bgStyle = item.yaExiste ? '#fff7ed' : '#ffffff';
    const borderStyle = item.yaExiste ? '#fdba74' : '#e2e8f0';

    return `
        <div style="background: ${bgStyle}; border: 1px solid ${borderStyle}; padding: 10px; border-radius: 8px; margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <span style="font-weight:700; font-size:12.5px; color:#1e293b;">${item.fecha} (${item.diaNombre})</span>
              ${item.isFestivo ? '<span style="background:#fef3c7; color:#b45309; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">Festivo / Finde</span>' : ''}
              ${item.yaExiste ? '<span style="background:#ffedd5; color:#c2410c; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px;">⚠️ Registro existente (Se actualizará)</span>' : ''}
            </div>
            ${_supDiasCampoState.length > 1 ? `<button type="button" onclick="eliminarDiaCampoSupervisor(${idx})" style="background:none; border:none; color:#ef4444; font-weight:700; cursor:pointer; font-size:16px; padding:0 4px;" title="Quitar fecha">&times;</button>` : ''}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">ENTRADA</label>
              <input type="time" class="form-input" value="${item.hE}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hE', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="flex:1; min-width:115px;">
              <label style="font-size:10px; font-weight:700; color:#64748b; display:block;">SALIDA</label>
              <input type="time" class="form-input" value="${item.hS}" onchange="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" oninput="actualizarHorarioDiaCampoSupervisor(${idx}, 'hS', this.value)" style="padding:6px 8px; font-size:13px; height:auto; border-radius:6px; width:100%;">
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b45309; display:block;">50%</small>
              <span style="font-weight:800; font-size:12px; color:#d97706;">${totales.t50}</span>
            </div>
            <div style="text-align:center; min-width:50px;">
              <small style="font-size:9.5px; font-weight:700; color:#b91c1c; display:block;">100%</small>
              <span style="font-weight:800; font-size:12px; color:#dc2626;">${totales.t100}</span>
            </div>
          </div>
        </div>
        `;
  }).join('');
};

window.actualizarHorarioDiaCampoSupervisor = function (idx, prop, val) {
  if (_supDiasCampoState[idx]) {
    _supDiasCampoState[idx][prop] = val;
    renderListaDiasCampoSupervisorHTML();
  }
};

window.eliminarDiaCampoSupervisor = function (idx) {
  _supDiasCampoState.splice(idx, 1);
  const cntSpan = document.getElementById('supCntDiasCampo');
  if (cntSpan) cntSpan.textContent = `${_supDiasCampoState.length} día(s)`;
  renderListaDiasCampoSupervisorHTML();
};

window.cargarIngenierosAutorizadoresSupervisor = async function () {
  const select = document.getElementById('supCampoAutorizadoPorSelect');
  if (!select) return;

  select.innerHTML = '<option value="">-- Cargando Autorizadores (Ingeniería)... --</option>';
  let ingenieros = [];

  const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
  if (firestoreDb && typeof firestoreDb.collection === 'function') {
    try {
      const snap = await firestoreDb.collection('empleados').get();
      snap.forEach(doc => {
        const d = doc.data();
        const areaStr = String(d.area || d.cargo || '').toUpperCase().trim();
        const normStr = areaStr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const esActivo = d.activo === 'SI' || d.activo === true || d.activo !== 'NO';
        const esIngenieria = normStr.includes('INGENIERIA') || normStr.includes('INGENIERO') || normStr.includes('ING');

        if (esActivo && esIngenieria) {
          ingenieros.push({ id: doc.id, nombre: d.nombre, area: d.area || d.cargo || 'INGENIERIA' });
        }
      });
    } catch (e) { }
  }

  const unicosMap = new Map();
  ingenieros.forEach(item => {
    if (item.nombre && !unicosMap.has(item.nombre)) {
      unicosMap.set(item.nombre, item);
    }
  });
  const listaFinal = Array.from(unicosMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (listaFinal.length > 0) {
    select.innerHTML = '<option value="">-- Seleccionar Autorizador (Ingeniería) [Opcional] --</option>' +
      listaFinal.map(i => `<option value="${i.nombre}">${i.nombre} (${i.area || 'INGENIERIA'})</option>`).join('');
  } else {
    select.innerHTML = '<option value="">-- Sin personal del área de Ingeniería encontrado --</option>';
  }
};

window.guardarTrabajoEnCampoSupervisor = async function () {
  const empId = document.getElementById('supCampoEmpId')?.value;
  const proyecto = document.getElementById('supCampoProyectoInput')?.value.trim();
  const obs = document.getElementById('supCampoObservacionesInput')?.value.trim();
  const autoriza = document.getElementById('supCampoAutorizadoPorSelect')?.value || '';

  if (!empId) { mostrarToast('ID de empleado no especificado', 'error'); return; }
  if (!_supDiasCampoState || _supDiasCampoState.length === 0) { mostrarToast('No hay fechas seleccionadas en el rango.', 'error'); return; }

  const diasExistentes = _supDiasCampoState.filter(d => d.yaExiste);
  if (diasExistentes.length > 0) {
    const listaFechas = diasExistentes.map(d => `${d.fecha} (${d.diaNombre})`).join('\n• ');
    const confirmar = confirm(`⚠️ ATENCIÓN:\nYa existe(n) registro(s) previo(s) para la(s) fecha(s):\n• ${listaFechas}\n\n¿Deseas SOBREESCRIBIR / ACTUALIZAR estos registros?`);
    if (!confirmar) return;
  }

  const emp = empCache.find(e => e.id === empId);
  const empNombre = emp ? emp.nombre : empId;

  let obsFinal = 'Trabajo en Campo';
  if (proyecto && obs) {
    obsFinal = `[Proyecto: ${proyecto}] ${obs}`;
  } else if (proyecto) {
    obsFinal = `[Proyecto: ${proyecto}] Trabajo en Campo`;
  } else if (obs) {
    obsFinal = obs;
  }

  const btn = document.getElementById('btnGuardarCampoSup');
  if (btn) btn.disabled = true;

  try {
    const firestoreDb = (typeof db !== 'undefined' ? db : (window.db || null));
    if (!firestoreDb || typeof firestoreDb.collection !== 'function') {
      mostrarToast('Base de datos Firebase no disponible', 'error');
      if (btn) btn.disabled = false;
      return;
    }

    let guardadosCount = 0;
    for (const item of _supDiasCampoState) {
      const hE = item.hE ? (item.hE.length === 5 ? item.hE + ':00' : item.hE) : '';
      const hS = item.hS ? (item.hS.length === 5 ? item.hS + ':00' : item.hS) : '';

      if (hE) {
        const hEClean = hE.replace(/:/g, '');
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_${hEClean}`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hE}`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hE,
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      if (hS) {
        const hSClean = hS.replace(/:/g, '');
        const targetSalidaId = item.docSalidaId || `${empId}_SALIDA_CAMPO_${item.fecha}_${hSClean}`;
        const tsSalida = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T${hS}`));

        const dataSalida = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: hS,
          tipo: 'SALIDA_CAMPO',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsSalida,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetSalidaId).set(dataSalida, { merge: true });
      }

      if (!hE && !hS) {
        const targetEntradaId = item.docEntradaId || `${empId}_Entrada_campo_${item.fecha}_080000`;
        const tsEntrada = firebase.firestore.Timestamp.fromDate(new Date(`${item.fecha}T08:00:00`));

        const dataEntrada = {
          empleadoId: empId,
          nombre: empNombre,
          fecha: item.fecha,
          hora: '',
          tipo: 'Entrada_campo',
          almuerzo: '',
          dispositivo: 'FORM_CAMPO_SUPERVISOR',
          timestamp: tsEntrada,
          modo: 'CAMPO',
          horasExtra: 'SI',
          autoriza: autoriza,
          observaciones: obsFinal,
          razon_ausencia: obsFinal
        };
        await firestoreDb.collection('registros').doc(targetEntradaId).set(dataEntrada, { merge: true });
      }

      guardadosCount++;
    }

    mostrarToast(`✅ Trabajo en Campo guardado/actualizado para ${guardadosCount} día(s)`, 'success');
    cerrarModalCampoSupervisor();

    if (typeof window.cargarResumenGeneral === 'function') {
      window.cargarResumenGeneral();
    }
  } catch (e) {
    mostrarToast('Error al guardar Trabajo en Campo: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ============================================================
// GESTIÓN Y ELIMINACIÓN DE EMPLEADOS (INDIVIDUAL Y MASIVA)
// ============================================================

// Renderizar la lista de colaboradores en el panel de eliminación
window.renderGestionEliminacionEmpleados = function () {
  const selInd = document.getElementById('selEliminarIndividual');
  const listContainer = document.getElementById('listaEliminarCheckboxesContainer');
  if (!selInd || !listContainer) return;

  const mapTodos = new Map();
  (empCache || []).forEach(e => {
    const id = String(e.id || '').trim();
    if (id) {
      const inactivo = (e.estado === 'INACTIVO' || e.activo === 'NO' || e.activo === false || String(e.activo || '').toUpperCase() === 'NO');
      mapTodos.set(id, { ...e, esInactivo: inactivo });
    }
  });
  (window.empEliminadosCache || []).forEach(e => {
    const id = String(e.id || '').trim();
    if (id && !mapTodos.has(id)) {
      mapTodos.set(id, { ...e, esInactivo: true, nombre: e.nombre || `Colaborador (${id})`, area: e.area || 'Inactivo / Eliminado' });
    }
  });

  const todos = Array.from(mapTodos.values());
  const activos = todos.filter(x => !x.esInactivo).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
  const inactivos = todos.filter(x => x.esInactivo).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

  // 1. Dropdown Individual
  let optsHtml = '<option value="">-- Seleccionar colaborador a eliminar --</option>';
  if (inactivos.length > 0) {
    optsHtml += `<optgroup label="⚠️ Inactivos / Borrados en Base (${inactivos.length})">`;
    optsHtml += inactivos.map(e => `<option value="${e.id}">⚠️ [INACTIVO] ${escapeHtml(e.nombre)} (ID: ${escapeHtml(e.id)} - Área: ${escapeHtml(e.area || '—')})</option>`).join('');
    optsHtml += `</optgroup>`;
  }
  if (activos.length > 0) {
    optsHtml += `<optgroup label="Colaboradores Activos (${activos.length})">`;
    optsHtml += activos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (ID: ${escapeHtml(e.id)} - Área: ${escapeHtml(e.area || '—')})</option>`).join('');
    optsHtml += `</optgroup>`;
  }
  selInd.innerHTML = optsHtml;

  // 2. Lista con Checkboxes para Selección Múltiple
  const listaOrdenada = [...inactivos, ...activos];
  let chkHtml = listaOrdenada.map(e => `
        <label class="item-eliminar-emp" data-text="${escapeHtml((e.nombre + ' ' + e.id + ' ' + (e.area || '')).toLowerCase())}" style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border-bottom:1px solid #f1f5f9; cursor:pointer; font-size:11.5px; transition:background 0.15s;">
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" class="chk-eliminar-item" value="${e.id}" onchange="actualizarConteoEliminarSeleccionados()" style="cursor:pointer;">
            <strong style="color:#1e293b;">${e.esInactivo ? '<span style="color:#e11d48; margin-right:4px;">⚠️</span>' : ''}${escapeHtml(e.nombre)}</strong>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="background:#f1f5f9; color:#64748b; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">ID: ${escapeHtml(e.id)}</span>
            <span style="background:${e.esInactivo ? '#fee2e2' : '#e0f2fe'}; color:${e.esInactivo ? '#b91c1c' : '#0369a1'}; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">${escapeHtml(e.esInactivo ? 'Inactivo en Base' : (e.area || '—'))}</span>
          </div>
        </label>
      `).join('');

  listContainer.innerHTML = chkHtml || '<div style="padding:10px; font-size:11px; color:#94a3b8; text-align:center;">No hay colaboradores registrados</div>';
  window.actualizarConteoEliminarSeleccionados();
};

// Actualizar el contador de checkboxes seleccionados
window.actualizarConteoEliminarSeleccionados = function () {
  const checkedCount = document.querySelectorAll('.chk-eliminar-item:checked').length;
  const cntSpan = document.getElementById('cntEliminarEmpSel');
  if (cntSpan) cntSpan.innerText = checkedCount;
};

// Toggle para Seleccionar Todos los visibles
window.toggleSeleccionarTodosEliminar = function (checked) {
  const items = document.querySelectorAll('.item-eliminar-emp');
  items.forEach(item => {
    if (item.style.display !== 'none') {
      const chk = item.querySelector('.chk-eliminar-item');
      if (chk) chk.checked = checked;
    }
  });
  window.actualizarConteoEliminarSeleccionados();
};

// Filtrar lista de checkboxes
window.filtrarListaEliminarEmp = function () {
  const input = document.getElementById('srchEliminarEmp');
  if (!input) return;
  const query = input.value.toLowerCase().trim();
  const items = document.querySelectorAll('.item-eliminar-emp');
  items.forEach(item => {
    const text = item.getAttribute('data-text') || '';
    item.style.display = text.includes(query) ? 'flex' : 'none';
  });
};

// Eliminar Empleado Individual desde Selector Combo u otro lugar
window.eliminarEmpleadoSeleccionadoCombo = function () {
  const sel = document.getElementById('selEliminarIndividual');
  if (!sel || !sel.value) {
    mostrarToast('Por favor, selecciona un colaborador para eliminar', 'warning');
    return;
  }
  window.eliminarEmpleadoIndividual(sel.value);
};

async function ejecutarEliminarEmpleadoBackend(params) {
  if (window.FirebaseBackend && window.FirebaseBackend.eliminarEmpleadoDefinitivo) {
    return await window.FirebaseBackend.eliminarEmpleadoDefinitivo(params);
  }
  return await jsonpRequest({ accion: 'eliminarEmpleadoDefinitivo', ...params });
}

window.eliminarEmpleadoIndividual = async function (empleadoId) {
  if (!empleadoId) return;
  const emp = (empCache || []).find(e => String(e.id) === String(empleadoId))
    || (window.empEliminadosCache || []).find(e => String(e.id) === String(empleadoId));
  const nombreEmp = emp ? emp.nombre : `ID ${empleadoId}`;

  if (!confirm(`⚠️ ALERTA DE ELIMINACIÓN:\n\n¿Estás seguro de eliminar definitivamente a "${nombreEmp}" (ID: ${empleadoId})?\n\nEsta acción removerá el registro de Firebase y Google Sheets.`)) {
    return;
  }

  mostrarLoader(true);
  try {
    const res = await ejecutarEliminarEmpleadoBackend({ empleadoId: empleadoId });
    mostrarLoader(false);

    if (res && res.ok) {
      window.mostrarModalResultadoEliminacion(res);
      if (typeof cargarDatosCompletos === 'function') {
        await cargarDatosCompletos(true, true);
      }
      if (typeof cargarDirectorio === 'function') {
        cargarDirectorio();
      }
      window.renderGestionEliminacionEmpleados();
    } else {
      mostrarToast(res.error || 'Error al eliminar el colaborador', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al eliminar empleado:", err);
    mostrarToast('Error al procesar la eliminación', 'error');
  }
};

// Eliminar Empleados Masivamente desde Checkboxes
window.eliminarEmpleadosSeleccionadosCheckboxes = function () {
  window.eliminarEmpleadosMasivo();
};

window.eliminarEmpleadosMasivo = async function () {
  const checkedBoxes = Array.from(document.querySelectorAll('.chk-eliminar-item:checked'));
  if (checkedBoxes.length === 0) {
    mostrarToast('Por favor, selecciona al menos un colaborador para eliminar', 'warning');
    return;
  }

  const ids = checkedBoxes.map(chk => chk.value);
  if (!confirm(`⚠️ ALERTA DE ELIMINACIÓN MASIVA:\n\n¿Estás seguro de eliminar definitivamente a ${ids.length} colaborador(es)?\n\nEsta acción no se puede deshacer.`)) {
    return;
  }

  mostrarLoader(true);
  try {
    const res = await ejecutarEliminarEmpleadoBackend({ empleadoIds: ids.join(',') });
    mostrarLoader(false);

    if (res && res.ok) {
      window.mostrarModalResultadoEliminacion(res);
      if (typeof cargarDatosCompletos === 'function') {
        await cargarDatosCompletos(true, true);
      }
      if (typeof cargarDirectorio === 'function') {
        cargarDirectorio();
      }
      window.renderGestionEliminacionEmpleados();
    } else {
      mostrarToast(res.error || 'Error al eliminar los colaboradores', 'error');
    }
  } catch (err) {
    mostrarLoader(false);
    console.error("Error al eliminar colaboradores masivo:", err);
    mostrarToast('Error al procesar la eliminación masiva', 'error');
  }
};

// Modal de Respuesta con Resultado de Eliminación
window.mostrarModalResultadoEliminacion = function (res) {
  let oldModal = document.getElementById('modalResultadoEliminacion');
  if (oldModal) oldModal.remove();

  let count = res.totalEliminados || 0;
  let detalles = res.detalles || [];
  let detallesHtml = detalles.map(d => `<li style="padding:4px 0; border-bottom:1px solid #f1f5f9;"><strong>${escapeHtml(d.nombre || d.id)}</strong> (ID: ${escapeHtml(d.id)})</li>`).join('');

  let html = `
        <div id="modalResultadoEliminacion" class="modal-overlay">
          <div class="modal-container" style="max-width:440px; border-top:4px solid #e11d48;">
            <div class="modal-header" style="background:#fff1f2;">
              <h3 class="modal-title" style="color:#be123c;"><i class="fas fa-trash-alt" style="color:#e11d48;"></i> Resultado de Eliminación</h3>
              <button class="modal-close" onclick="document.getElementById('modalResultadoEliminacion').remove()">&times;</button>
            </div>
            <div class="modal-body" style="padding:16px;">
              <div style="display:flex; align-items:center; gap:10px; background:#f0fdf4; border:1px solid #bbf7d0; padding:10px 12px; border-radius:8px; margin-bottom:12px;">
                <i class="fas fa-check-circle" style="color:#16a34a; font-size:20px;"></i>
                <div style="font-size:12.5px; color:#166534; font-weight:600;">${escapeHtml(res.mensaje || `Se procesó la eliminación de ${count} colaborador(es).`)}</div>
              </div>
              <div style="font-size:11.5px; font-weight:700; color:#334155; margin-bottom:6px;">Colaboradores eliminados (${count}):</div>
              <ul style="max-height:160px; overflow-y:auto; font-size:11.5px; color:#475569; padding-left:16px; margin:0 0 12px 0; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px;">
                ${detallesHtml || '<li>Operación completada exitosamente.</li>'}
              </ul>
            </div>
            <div class="modal-footer">
              <button class="btn-primary-modal" onclick="document.getElementById('modalResultadoEliminacion').remove()" style="background:#e11d48;">Entendido</button>
            </div>
          </div>
        </div>
      `;

  document.body.insertAdjacentHTML('beforeend', html);
};

// ============================================================
// MÓDULO DE DESVINCULACIÓN DE PERSONAL (HOJA "DESVINCULADOS")
// ============================================================

window.renderGestionDesvinculacion = function () {
  const txtFecha = document.getElementById('txtFechaDesvinculacion');
  if (txtFecha && !txtFecha.value) {
    txtFecha.value = new Date().toISOString().split('T')[0];
  }

  window.actualizarDropdownDesvincular();
  window.cargarHistorialDesvinculados();
};

window.actualizarDropdownDesvincular = function () {
  const sel = document.getElementById('selDesvincularColaborador');
  if (!sel) return;

  const valActual = sel.value;

  // Map para unificar colaboradores de empCache, window.empEliminadosCache y window._cacheDesvinculados
  const mapColabs = new Map();

  (empCache || []).forEach(e => {
    const id = String(e.id || '').trim();
    if (!id) return;
    const inactivo = (e.estado === 'INACTIVO' || e.activo === 'NO' || e.activo === false || String(e.activo || '').toUpperCase() === 'NO' || !!e.esEliminado);
    mapColabs.set(id, {
      ...e,
      esInactivo: inactivo,
      nombre: e.nombre || 'Sin nombre',
      area: e.area || 'Sin área'
    });
  });

  (window.empEliminadosCache || []).forEach(e => {
    const id = String(e.id || '').trim();
    if (!id) return;
    if (!mapColabs.has(id)) {
      mapColabs.set(id, {
        ...e,
        esInactivo: true,
        nombre: e.nombre || `Colaborador (${id})`,
        area: e.area || 'Inactivo / Eliminado'
      });
    } else {
      const exist = mapColabs.get(id);
      mapColabs.set(id, {
        ...exist,
        ...e,
        esInactivo: true
      });
    }
  });

  (window._cacheDesvinculados || []).forEach(e => {
    const id = String(e.id || '').trim();
    if (!id) return;
    if (!mapColabs.has(id)) {
      mapColabs.set(id, {
        ...e,
        esInactivo: true,
        nombre: e.nombre || `Colaborador (${id})`,
        area: e.area || (e.origen === 'ARCHIVADO' ? 'Archivado en DESVINCULADOS' : 'Inactivo / Eliminado')
      });
    }
  });

  const todos = Array.from(mapColabs.values());
  const activos = todos.filter(x => !x.esInactivo).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
  const inactivos = todos.filter(x => x.esInactivo).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

  let html = '<option value="">-- Selecciona un colaborador --</option>';

  if (inactivos.length > 0) {
    html += `<optgroup label="⚠️ Colaboradores Inactivos / Borrados en Base (${inactivos.length})">`;
    inactivos.forEach(e => {
      const id = String(e.id || '').trim();
      html += `<option value="${id}">⚠️ [INACTIVO/BORRADO] ${escapeHtml(e.nombre)} (ID: ${escapeHtml(id)} - ${escapeHtml(e.area || 'Inactivo')})</option>`;
    });
    html += `</optgroup>`;
  }

  if (activos.length > 0) {
    html += `<optgroup label="Colaboradores Activos (${activos.length})">`;
    activos.forEach(e => {
      const id = String(e.id || '').trim();
      html += `<option value="${id}">${escapeHtml(e.nombre)} (ID: ${escapeHtml(id)} - ${escapeHtml(e.area || 'Sin área')})</option>`;
    });
    html += `</optgroup>`;
  }

  sel.innerHTML = html;
  if (valActual) sel.value = valActual;
};

window.actualizarResumenDesvinculacion = function (empleadoId) {
  const resumenBox = document.getElementById('resumenDesvinculacionBox');
  if (!resumenBox) return;

  const id = String(empleadoId || '').trim();
  if (!id) {
    resumenBox.innerHTML = `
          <div style="text-align:center; padding:15px; color:#94a3b8;">
            <i class="fas fa-user" style="font-size:24px; margin-bottom:6px; display:block;"></i>
            Selecciona un colaborador para previsualizar sus datos.
          </div>
        `;
    return;
  }

  let e = (empCache || []).find(x => String(x.id).trim() === id);
  let esInactivo = false;
  if (!e && window.empEliminadosCache) {
    e = window.empEliminadosCache.find(x => String(x.id).trim() === id);
    esInactivo = true;
  } else if (e) {
    esInactivo = (e.estado === 'INACTIVO' || e.activo === 'NO' || e.activo === false || String(e.activo || '').toUpperCase() === 'NO' || !!e.esEliminado);
  }
  if (!e && window._cacheDesvinculados) {
    e = window._cacheDesvinculados.find(x => String(x.id).trim() === id);
    esInactivo = true;
  }

  if (!e) {
    resumenBox.innerHTML = `
          <div style="text-align:center; padding:15px; color:#ef4444;">
            <i class="fas fa-exclamation-circle" style="font-size:24px; margin-bottom:6px; display:block;"></i>
            Colaborador no encontrado en la base local.
          </div>
        `;
    return;
  }

  const fotoHtml = e.foto_url
    ? `<img src="${escapeHtml(e.foto_url)}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; border:2px solid ${esInactivo ? '#e11d48' : '#7c3aed'};">`
    : `<div style="width:48px; height:48px; border-radius:50%; background:${esInactivo ? '#fee2e2' : '#ede9fe'}; color:${esInactivo ? '#b91c1c' : '#7c3aed'}; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800;">${(e.nombre || 'U').charAt(0)}</div>`;

  const cantRegs = (e.registros || []).length || (e.totalRegs || 0);

  resumenBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
          ${fotoHtml}
          <div>
            <div style="font-size:14px; font-weight:800; color:#1e293b;">${escapeHtml(e.nombre)}</div>
            <div style="font-size:11.5px; color:#64748b; display:flex; gap:6px; flex-wrap:wrap; margin-top:2px;">
              <span style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-weight:600;">ID: ${escapeHtml(e.id)}</span>
              ${e.cedula ? `<span style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-weight:600;">C.I.: ${escapeHtml(e.cedula)}</span>` : ''}
              <span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-weight:600;">${escapeHtml(e.area || 'Sin área')}</span>
            </div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; background:#f8fafc; padding:8px 10px; border-radius:8px; border:1px solid #f1f5f9;">
          <div><strong>Cargo:</strong> ${escapeHtml(e.cargo || '—')}</div>
          <div><strong>Rol App:</strong> ${escapeHtml(e.supervisor || e.rol || 'EMPLEADO')}</div>
          <div><strong>Registros en Base:</strong> <span style="color:#4338ca; font-weight:700;">${cantRegs} registros</span></div>
          <div><strong>Estado:</strong> 
            ${esInactivo
      ? `<span style="color:#b91c1c; font-weight:800; background:#fee2e2; padding:1px 6px; border-radius:4px;"><i class="fas fa-user-slash"></i> Inactivo / Borrado en base</span>`
      : `<span style="color:#16a34a; font-weight:800; background:#dcfce7; padding:1px 6px; border-radius:4px;"><i class="fas fa-check-circle"></i> Activo en base</span>`}
          </div>
        </div>
        <div style="margin-top:10px; font-size:11px; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; padding:8px 10px; border-radius:6px; display:flex; align-items:flex-start; gap:8px;">
          <i class="fas fa-archive" style="margin-top:2px;"></i>
          <span>Al confirmar, el sistema respaldará todos los datos de este colaborador en la hoja <strong>"DESVINCULADOS"</strong> y lo retirará de las bases activas.</span>
        </div>
      `;
};

window.seleccionarParaDesvincular = function (id) {
  const sel = document.getElementById('selDesvincularColaborador');
  if (sel) {
    let opt = sel.querySelector(`option[value="${id}"]`);
    if (!opt) {
      const item = (window._cacheDesvinculados || []).find(x => String(x.id).trim() === String(id).trim())
        || (window.empEliminadosCache || []).find(x => String(x.id).trim() === String(id).trim());
      const nom = item ? item.nombre : `Colaborador (${id})`;
      const optElem = document.createElement('option');
      optElem.value = id;
      optElem.textContent = `⚠️ [INACTIVO/BORRADO] ${nom} (ID: ${id})`;
      sel.appendChild(optElem);
    }
    sel.value = id;
    window.actualizarResumenDesvinculacion(id);
    sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sel.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.35)';
    setTimeout(() => { sel.style.boxShadow = ''; }, 1500);
  }
};

window.confirmarDesvinculacionColaborador = async function () {
  const isAdmin = (typeof esAdminMaster === 'function') ? esAdminMaster() : !!window.isMaster;
  if (!isAdmin) {
    mostrarToast('Solo el Administrador General (1058) puede desvincular personal.', 'error');
    return;
  }

  const selColab = document.getElementById('selDesvincularColaborador');
  const empId = selColab ? selColab.value.trim() : '';
  if (!empId) {
    mostrarToast('Por favor, selecciona el colaborador que deseas desvincular.', 'warning');
    return;
  }

  const e = (empCache || []).find(x => String(x.id).trim() === empId)
    || (window.empEliminadosCache || []).find(x => String(x.id).trim() === empId)
    || (window._cacheDesvinculados || []).find(x => String(x.id).trim() === empId);
  const empNombre = e ? e.nombre : `ID ${empId}`;
  const fechaInput = document.getElementById('txtFechaDesvinculacion');
  const fechaDesv = (fechaInput && fechaInput.value) ? fechaInput.value.trim() : new Date().toISOString().split('T')[0];
  const motivoSel = document.getElementById('selMotivoDesvinculacion');
  const motivo = motivoSel ? motivoSel.value : 'Desvinculación laboral';
  const obsInput = document.getElementById('txtObservacionesDesvinculacion');
  const observaciones = obsInput ? obsInput.value.trim() : '';

  const confirmacion = confirm(
    `¿Estás seguro de que deseas DESVINCULAR a:\n\n` +
    `👤 ${empNombre} (ID: ${empId})\n` +
    `📅 Fecha de salida: ${fechaDesv}\n` +
    `📋 Motivo: ${motivo}\n\n` +
    `Esta acción trasladará automáticamente todos sus registros asociados a la base de "DESVINCULADOS" como respaldo permanente y lo retirará del sistema activo.\n\n` +
    `⚖️ Base Legal: Conforme al Art. 21 de la LOPDP (Ecuador) y normativa laboral, los datos se mantendrán en archivo confidencial para fines de solvencia patronal durante los plazos de prescripción legal.`
  );

  if (!confirmacion) return;

  mostrarLoader(true);
  try {
    let sessionData = {};
    try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (err) { }
    const supervisorNombre = sessionData.nombre ? `${sessionData.nombre} (${sessionData.id || ''})` : (sessionData.id || 'Admin 1058');

    const res = await jsonpRequest({
      accion: 'desvincularColaborador',
      empleadoId: empId,
      cedula: e?.cedula || '',
      nombre: empNombre,
      motivo: motivo,
      fechaDesvinculacion: fechaDesv,
      supervisor: supervisorNombre,
      observaciones: observaciones
    });

    if (res && (res.ok || res.filasArchivadas !== undefined)) {
      mostrarToast(res.mensaje || `Colaborador ${empNombre} desvinculado y archivado correctamente.`, 'success');

      // Limpiar campos del formulario
      if (selColab) selColab.value = '';
      if (obsInput) obsInput.value = '';
      window.actualizarResumenDesvinculacion('');

      // Limpiar caches locales y recargar datos de la aplicación
      limpiarCachesLocales();
      await cargarDatosCompletos(true);

      // Actualizar listados
      window.renderGestionDesvinculacion();
    } else {
      mostrarToast(res?.error || 'Error al procesar la desvinculación.', 'error');
    }
  } catch (err) {
    console.error("Error al desvincular colaborador:", err);
    mostrarToast('Error al desvincular colaborador: ' + (err.message || err), 'error');
  } finally {
    mostrarLoader(false);
  }
};

window.cargarHistorialDesvinculados = async function () {
  const tbody = document.getElementById('tbodyHistorialDesvinculados');
  if (!tbody) return;

  tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding: 24px; text-align: center; color: #64748b;">
            <i class="fas fa-spinner fa-spin" style="font-size:16px; margin-right:6px; color:#7c3aed;"></i>
            Consultando historial de desvinculados e inactivos...
          </td>
        </tr>
      `;

  try {
    const res = await jsonpRequest({ accion: 'listarDesvinculados' });
    let desvinculadosSheets = (res && res.ok && Array.isArray(res.desvinculados)) ? res.desvinculados : [];

    const mapaUnificado = new Map();
    const idsArchivados = new Set();

    desvinculadosSheets.forEach(item => {
      const id = String(item.id || '').trim();
      const key = id || (item.nombre || '').trim();
      if (!key) return;
      idsArchivados.add(id);
      mapaUnificado.set(key, {
        id: item.id || '',
        nombre: item.nombre || 'Sin nombre',
        fechaDesvinculacion: item.fechaDesvinculacion || '—',
        motivo: item.motivo || 'Desvinculación laboral',
        supervisor: item.supervisor || 'Admin',
        observaciones: item.observaciones || '',
        totalRegs: item.conteo ? (item.conteo.total || 0) : (item.registrosRespaldados || 0),
        detalleHojas: item.conteo ? `Emp: ${item.conteo.empleados || 0} | Regs: ${item.conteo.registros || 0} | Vac: ${(item.conteo.vacaciones || 0) + (item.conteo.calcular_vacaciones || 0)}` : '',
        origen: 'ARCHIVADO',
        estadoBadge: 'Archivado en DESVINCULADOS'
      });
    });

    (window.empEliminadosCache || []).forEach(emp => {
      const id = String(emp.id || '').trim();
      const key = id || (emp.nombre || '').trim();
      if (!key) return;
      if (!idsArchivados.has(id) && !mapaUnificado.has(key)) {
        const cantRegs = (emp.registros || []).length;
        mapaUnificado.set(key, {
          id: emp.id || id,
          nombre: emp.nombre || `Colaborador (${id})`,
          fechaDesvinculacion: emp.fecha_salida || emp.fechaDesvinculacion || 'Baja en base',
          motivo: emp.motivo || emp.motivo_salida || 'Inactivo / Eliminado en base',
          supervisor: emp.desvinculadoPor || 'Pendiente de archivar',
          observaciones: emp.observaciones || (emp.area ? `Área: ${emp.area}` : ''),
          totalRegs: cantRegs,
          detalleHojas: `${cantRegs} registros en base`,
          origen: 'INACTIVO_BASE',
          estadoBadge: 'Inactivo / Borrado en Base'
        });
      }
    });

    (empCache || []).forEach(emp => {
      const inactivo = (emp.estado === 'INACTIVO' || emp.activo === 'NO' || emp.activo === false || String(emp.activo || '').toUpperCase() === 'NO');
      if (inactivo) {
        const id = String(emp.id || '').trim();
        const key = id || (emp.nombre || '').trim();
        if (key && !idsArchivados.has(id) && !mapaUnificado.has(key)) {
          const cantRegs = (emp.registros || []).length;
          mapaUnificado.set(key, {
            id: emp.id || id,
            nombre: emp.nombre || `Colaborador (${id})`,
            fechaDesvinculacion: 'Inactivo en base',
            motivo: emp.motivo || 'Marcado Inactivo',
            supervisor: 'Pendiente de archivar',
            observaciones: emp.observaciones || (emp.area ? `Área: ${emp.area}` : ''),
            totalRegs: cantRegs,
            detalleHojas: `${cantRegs} registros en base`,
            origen: 'INACTIVO_BASE',
            estadoBadge: 'Inactivo en Base'
          });
        }
      }
    });

    const listaFinal = Array.from(mapaUnificado.values()).sort((a, b) => {
      if (a.origen !== b.origen) {
        return a.origen === 'INACTIVO_BASE' ? -1 : 1;
      }
      return (b.fechaDesvinculacion || '').localeCompare(a.fechaDesvinculacion || '') || (a.nombre || '').localeCompare(b.nombre || '');
    });

    window._cacheDesvinculados = listaFinal;
    window._filtroEstadoDesvinculados = 'todos';

    // Sincronizar también el selector dropdown con los datos recién cargados
    if (typeof window.actualizarDropdownDesvincular === 'function') {
      window.actualizarDropdownDesvincular();
    }

    // Actualizar contadores de los botones
    const cntArch = listaFinal.filter(x => x.origen === 'ARCHIVADO').length;
    const cntInact = listaFinal.filter(x => x.origen === 'INACTIVO_BASE').length;
    const bTodos = document.getElementById('btnFiltroDesvTodos');
    const bArch = document.getElementById('btnFiltroDesvArch');
    const bInact = document.getElementById('btnFiltroDesvInact');
    if (bTodos) bTodos.textContent = `Todos (${listaFinal.length})`;
    if (bArch) bArch.textContent = `Archivados (${cntArch})`;
    if (bInact) bInact.textContent = `Inactivos en Base (${cntInact})`;

    window.renderTablaHistorialDesvinculados(listaFinal);
  } catch (err) {
    console.error("Error al cargar historial de desvinculados:", err);
    let fallback = [];
    (window.empEliminadosCache || []).forEach(emp => {
      const cantRegs = (emp.registros || []).length;
      fallback.push({
        id: emp.id || '',
        nombre: emp.nombre || 'Colaborador',
        fechaDesvinculacion: emp.fecha_salida || 'Baja en base',
        motivo: emp.motivo || 'Inactivo / Eliminado en base',
        supervisor: 'Sistema',
        observaciones: emp.observaciones || '',
        totalRegs: cantRegs,
        detalleHojas: `${cantRegs} registros`,
        origen: 'INACTIVO_BASE',
        estadoBadge: 'Inactivo / Borrado en Base'
      });
    });
    window._cacheDesvinculados = fallback;
    window.renderTablaHistorialDesvinculados(fallback);
  }
};

window.filtrarEstadoDesvinculados = function (estado) {
  window._filtroEstadoDesvinculados = estado;
  ['Todos', 'Arch', 'Inact'].forEach(suffix => {
    const btn = document.getElementById('btnFiltroDesv' + suffix);
    if (btn) {
      const match = (estado === 'todos' && suffix === 'Todos') || (estado === 'archivados' && suffix === 'Arch') || (estado === 'inactivos' && suffix === 'Inact');
      btn.style.background = match ? 'white' : 'transparent';
      btn.style.color = match ? '#1e293b' : '#64748b';
      btn.style.fontWeight = match ? '700' : '600';
      btn.style.boxShadow = match ? '0 1px 2px rgba(0,0,0,0.05)' : 'none';
    }
  });
  window.filtrarTablaDesvinculados(document.getElementById('txtBuscarDesvinculados')?.value || '');
};

window.renderTablaHistorialDesvinculados = function (lista) {
  const tbody = document.getElementById('tbodyHistorialDesvinculados');
  if (!tbody) return;

  if (!lista || lista.length === 0) {
    tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding: 24px; text-align: center; color: var(--g500);">
              <i class="fas fa-info-circle" style="margin-right:6px; color:#94a3b8;"></i>
              No se encontraron colaboradores en esta sección.
            </td>
          </tr>
        `;
    return;
  }

  let html = '';
  lista.forEach((item, idx) => {
    const esArchivado = item.origen === 'ARCHIVADO';
    const badgeOrigen = esArchivado
      ? `<span style="background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; padding: 2px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-check-circle"></i> Archivado</span>`
      : `<span style="background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; padding: 2px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-user-slash"></i> Inactivo en Base</span>`;

    const accionBtn = !esArchivado
      ? `<button type="button" onclick="window.seleccionarParaDesvincular('${item.id}')" style="background: #7c3aed; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 1px 3px rgba(124,58,237,0.2);" title="Cargar en formulario para respaldar en DESVINCULADOS"><i class="fas fa-archive"></i> Desvincular</button>`
      : `<span style="color: #64748b; font-size: 11px;">${escapeHtml(item.supervisor || 'Admin')}</span>`;

    html += `
          <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='#ffffff'">
            <td style="padding: 9px 10px; font-weight: 700; color: #64748b; text-align: center;">${idx + 1}</td>
            <td style="padding: 9px 10px;">
              <div style="font-weight: 700; color: #1e293b;">${escapeHtml(item.nombre || '—')}</div>
              <div style="font-size: 10.5px; color: #64748b;">ID: ${escapeHtml(item.id || '—')}</div>
            </td>
            <td style="padding: 9px 10px; text-align: center;">
              <div style="font-weight: 600; color: #334155; font-size: 11px;">${escapeHtml(item.fechaDesvinculacion || '—')}</div>
              <div style="margin-top: 2px;">${badgeOrigen}</div>
            </td>
            <td style="padding: 9px 10px;">
              <span style="background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">
                ${escapeHtml(item.motivo || 'Desvinculación laboral')}
              </span>
              ${item.observaciones ? `<div style="font-size: 10.5px; color: #64748b; margin-top: 3px;" title="${escapeHtml(item.observaciones)}"><i class="fas fa-comment-dots"></i> ${escapeHtml(item.observaciones.length > 40 ? item.observaciones.slice(0, 40) + '...' : item.observaciones)}</div>` : ''}
            </td>
            <td style="padding: 9px 10px; text-align: center;">
              <span style="background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;" title="${escapeHtml(item.detalleHojas || '')}">
                ${item.totalRegs} registros
              </span>
            </td>
            <td style="padding: 9px 10px; text-align: center;">
              ${accionBtn}
            </td>
          </tr>
        `;
  });

  tbody.innerHTML = html;
};

window.filtrarTablaDesvinculados = function (query) {
  if (!window._cacheDesvinculados) return;
  const q = (query || '').toLowerCase().trim();
  const filtroEst = window._filtroEstadoDesvinculados || 'todos';

  let filtrados = window._cacheDesvinculados;
  if (filtroEst === 'archivados') {
    filtrados = filtrados.filter(x => x.origen === 'ARCHIVADO');
  } else if (filtroEst === 'inactivos') {
    filtrados = filtrados.filter(x => x.origen === 'INACTIVO_BASE');
  }

  if (q) {
    filtrados = filtrados.filter(item => {
      const texto = `${item.nombre || ''} ${item.id || ''} ${item.motivo || ''} ${item.supervisor || ''} ${item.fechaDesvinculacion || ''} ${item.observaciones || ''}`.toLowerCase();
      return texto.includes(q);
    });
  }

  window.renderTablaHistorialDesvinculados(filtrados);
};

// ==========================================
// MODAL DESGLOSE HISTÓRICO DE ASISTENCIA Y DIFERENCIAS
// ==========================================
window.abrirModalDesgloseHistoricoBase = function (periodoPreseleccionado) {
  try {
    const modal = document.getElementById('modalDesgloseHistoricoBase');
    const tbody = document.getElementById('tbodyModalHistoricoBase');
    if (!modal) {
      console.error('Modal #modalDesgloseHistoricoBase no encontrado en el DOM');
      return;
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (!empCache || !empCache.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding: 25px; text-align: center; color: var(--g600);"><i class="fas fa-spinner fa-spin"></i> Cargando datos de colaboradores...</td></tr>`;
      return;
    }

    // Poblar selector de período en el modal
    const selModal = document.getElementById('selPeriodoModalHistorico');
    const selDash = document.getElementById('periodoMensualDash') || document.getElementById('periodoMensual');
    const idxDash = parseInt(selDash?.value || 0);
    const pDash = (periodos && periodos[idxDash]) ? periodos[idxDash] : (periodos ? periodos[0] : null);

    const ahora = new Date();
    const anioActual = ahora.getFullYear();

    // Detectar años disponibles en los registros de colaboradores
    const aniosSet = new Set();
    aniosSet.add(anioActual);
    aniosSet.add(anioActual - 1);
    if (Array.isArray(empCache)) {
      empCache.forEach(e => {
        (e.registros || []).forEach(r => {
          const y = parseInt((r.fecha || '').slice(0, 4));
          if (y >= 2020 && y <= anioActual + 1) aniosSet.add(y);
        });
        if (e.fecha_ingreso) {
          const y = parseInt(String(e.fecha_ingreso).slice(0, 4));
          if (y >= 2020 && y <= anioActual + 1) aniosSet.add(y);
        }
      });
    }
    const aniosList = Array.from(aniosSet).sort((a, b) => b - a);

    if (selModal) {
      let optsHtml = '';

      // 1. Grupo Opciones Anuales
      optsHtml += `<optgroup label="📅 Vistas Anuales y Consolidadas">`;
      optsHtml += `<option value="ANUAL">📅 Consolidado Anual (${anioActual})</option>`;
      aniosList.forEach(y => {
        optsHtml += `<option value="ANIO_${y}">🗓️ Año ${y} Completo</option>`;
      });
      optsHtml += `<option value="ULTIMOS_365">📅 Últimos 12 Meses (Año Móvil)</option>`;
      optsHtml += `<option value="HISTORICO_BASE">🏛️ Todo el Histórico en Base</option>`;
      optsHtml += `</optgroup>`;

      // 2. Grupo Períodos Mensuales
      optsHtml += `<optgroup label="🗓️ Períodos Mensuales (Corte al 25)">`;
      if (pDash) {
        optsHtml += `<option value="DASHBOARD">⭐ Período Dashboard (${pDash.label})</option>`;
      }
      if (periodos && periodos.length) {
        periodos.forEach((p, idx) => {
          optsHtml += `<option value="PER_${idx}">${p.label}</option>`;
        });
      }
      optsHtml += `<option value="ULTIMOS_60">Últimos 60 Días (En Memoria)</option>`;
      optsHtml += `</optgroup>`;

      selModal.innerHTML = optsHtml;

      if (periodoPreseleccionado) {
        selModal.value = periodoPreseleccionado;
      } else {
        selModal.value = 'DASHBOARD';
      }
    }

    const valorSel = selModal ? selModal.value : 'DASHBOARD';
    const esAnual = (valorSel === 'ANUAL' || valorSel.startsWith('ANIO_') || valorSel === 'ULTIMOS_365' || valorSel === 'HISTORICO_BASE');
    window._actualizarBotonesModoHistorico(esAnual);
    window.procesarYRenderizarHistoricoBase(valorSel);
  } catch (err) {
    console.error('Error al abrir modal desglose histórico:', err);
    if (typeof mostrarToast === 'function') {
      mostrarToast('Error al procesar el desglose histórico: ' + err.message, 'error');
    }
  }
};

window._actualizarBotonesModoHistorico = function (esAnual) {
  const btnMensual = document.getElementById('btnModoHistoricoMensual');
  const btnAnual = document.getElementById('btnModoHistoricoAnual');
  if (!btnMensual || !btnAnual) return;

  if (esAnual) {
    btnAnual.style.background = '#ffffff';
    btnAnual.style.color = '#0f172a';
    btnAnual.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
    btnMensual.style.background = 'transparent';
    btnMensual.style.color = '#64748b';
    btnMensual.style.boxShadow = 'none';
  } else {
    btnMensual.style.background = '#ffffff';
    btnMensual.style.color = '#0f172a';
    btnMensual.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
    btnAnual.style.background = 'transparent';
    btnAnual.style.color = '#64748b';
    btnAnual.style.boxShadow = 'none';
  }
};

window.seleccionarModoHistorico = function (modo) {
  const selModal = document.getElementById('selPeriodoModalHistorico');
  if (!selModal) return;

  if (modo === 'anual') {
    window._actualizarBotonesModoHistorico(true);
    if (!selModal.value.startsWith('ANIO_') && selModal.value !== 'ANUAL' && selModal.value !== 'ULTIMOS_365' && selModal.value !== 'HISTORICO_BASE') {
      selModal.value = 'ANUAL';
    }
    window.procesarYRenderizarHistoricoBase(selModal.value);
  } else {
    window._actualizarBotonesModoHistorico(false);
    if (selModal.value.startsWith('ANIO_') || selModal.value === 'ANUAL' || selModal.value === 'ULTIMOS_365' || selModal.value === 'HISTORICO_BASE') {
      selModal.value = 'DASHBOARD';
    }
    window.procesarYRenderizarHistoricoBase(selModal.value);
  }
};

window.cambiarPeriodoModalHistorico = function (val) {
  const esAnual = (val === 'ANUAL' || val.startsWith('ANIO_') || val === 'ULTIMOS_365' || val === 'HISTORICO_BASE');
  window._actualizarBotonesModoHistorico(esAnual);
  window.procesarYRenderizarHistoricoBase(val);
};

window.procesarYRenderizarHistoricoBase = function (opcionPeriodo) {
  try {
    const tbody = document.getElementById('tbodyModalHistoricoBase');
    if (!tbody) return;

    if (!empCache || !empCache.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding: 25px; text-align: center; color: var(--g600);"><i class="fas fa-spinner fa-spin"></i> Cargando datos de colaboradores...</td></tr>`;
      return;
    }

    const hoy_ = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0];
    const dHoy_ = new Date(hoy_ + 'T12:00:00');
    dHoy_.setDate(dHoy_.getDate() - 1);
    const ayer_ = dHoy_.toISOString().split('T')[0];
    // CRÍTICO: Excluir estrictamente la fecha actual (hoy_) de la auditoría histórica ya que la jornada está en curso
    const finAuditoriaMax = ayer_;

    const empAsistencia = empCache.filter(e => {
      const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
      const soloAlm = (typeof esEmpleadoSoloAlmuerzo === 'function') ? esEmpleadoSoloAlmuerzo(e) : false;
      const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
      return act && !soloAlm && !excluido && e.tipoRegistro !== 'MASTER';
    });

    // 1. Escanear registros válidos de la base para encontrar la primera fecha real de asistencia (global y por año)
    // Regla esencial: Solo registros de asistencia física/real (ENTRADA, CAMPO, SALIDA, etc.), NUNCA vacaciones históricas sincronizadas de RRHH
    let minFechaGlobalBase = '';
    const minFechaAnioBase = {};

    function esRegistroAsistenciaBase(r) {
      if (!r) return false;
      const t = (r.tipo || '').toUpperCase();
      if (t === 'VACACIONES' || t === 'VACACION') return false;
      const razon = (r.razon_ausencia || r.razon_justificac || '').toUpperCase();
      if (razon.includes('VACACI')) return false;
      if (t === 'ENTRADA' || t === 'CAMPO' || t === 'ENTRADA_CAMPO' || t === 'RETORNO_CAMPO' || t === 'SALIDA') return true;
      if ((r.justificado || '').toUpperCase() === 'SI') return true;
      if (r.hora && String(r.hora).trim().length >= 4) return true;
      return false;
    }

    empAsistencia.forEach(e => {
      (e.registros || []).forEach(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        if (!f || f > finAuditoriaMax) return;

        if (esRegistroAsistenciaBase(r)) {
          if (!minFechaGlobalBase || f < minFechaGlobalBase) minFechaGlobalBase = f;
          const y = f.substring(0, 4);
          if (!minFechaAnioBase[y] || f < minFechaAnioBase[y]) {
            minFechaAnioBase[y] = f;
          }
        }
      });
    });

    // 2. Determinar rango y etiqueta según período seleccionado
    let rangoIni = null;
    let rangoFin = finAuditoriaMax;
    let periodoLabel = 'Período';

    if (opcionPeriodo === 'DASHBOARD' || !opcionPeriodo) {
      const selDash = document.getElementById('periodoMensualDash') || document.getElementById('periodoMensual');
      const idx = parseInt(selDash?.value || 0);
      const p = (periodos && periodos[idx]) ? periodos[idx] : (periodos ? periodos[0] : null);
      if (p) {
        rangoIni = p.inicio;
        rangoFin = (p.fin < finAuditoriaMax) ? p.fin : finAuditoriaMax;
        periodoLabel = p.label;
      }
    } else if (opcionPeriodo.startsWith('PER_')) {
      const idx = parseInt(opcionPeriodo.replace('PER_', ''));
      const p = (periodos && periodos[idx]) ? periodos[idx] : null;
      if (p) {
        rangoIni = p.inicio;
        rangoFin = (p.fin < finAuditoriaMax) ? p.fin : finAuditoriaMax;
        periodoLabel = p.label;
      }
    } else if (opcionPeriodo === 'ANUAL') {
      const ahora = new Date();
      const anioActual = ahora.getFullYear();
      const primerRegAnio = minFechaAnioBase[String(anioActual)] || minFechaGlobalBase;
      // Regla clave: el rango de evaluación debe ser desde el primer registro que exista en la base
      rangoIni = (primerRegAnio && primerRegAnio > `${anioActual}-01-01`) ? primerRegAnio : (primerRegAnio || `${anioActual}-01-01`);
      const finAnio = `${anioActual}-12-31`;
      rangoFin = (finAnio < finAuditoriaMax) ? finAnio : finAuditoriaMax;
      periodoLabel = `Consolidado Anual ${anioActual}`;
    } else if (opcionPeriodo.startsWith('ANIO_')) {
      const y = parseInt(opcionPeriodo.replace('ANIO_', ''));
      if (!isNaN(y)) {
        const primerRegAnio = minFechaAnioBase[String(y)];
        rangoIni = (primerRegAnio && primerRegAnio > `${y}-01-01`) ? primerRegAnio : (primerRegAnio || `${y}-01-01`);
        const finY = `${y}-12-31`;
        rangoFin = (finY < finAuditoriaMax) ? finY : finAuditoriaMax;
        periodoLabel = `Año ${y} Completo`;
      }
    } else if (opcionPeriodo === 'ULTIMOS_365' || opcionPeriodo === 'ANIO_MOVIL') {
      const d365 = new Date();
      d365.setDate(d365.getDate() - 365);
      const y365 = d365.getFullYear();
      const m365 = String(d365.getMonth() + 1).padStart(2, '0');
      const day365 = String(d365.getDate()).padStart(2, '0');
      const f365 = `${y365}-${m365}-${day365}`;
      rangoIni = (minFechaGlobalBase && minFechaGlobalBase > f365) ? minFechaGlobalBase : f365;
      rangoFin = finAuditoriaMax;
      periodoLabel = 'Últimos 12 Meses (Año Móvil)';
    } else if (opcionPeriodo === 'ULTIMOS_60') {
      const d60 = new Date();
      d60.setDate(d60.getDate() - 60);
      const y60 = d60.getFullYear();
      const m60 = String(d60.getMonth() + 1).padStart(2, '0');
      const day60 = String(d60.getDate()).padStart(2, '0');
      rangoIni = `${y60}-${m60}-${day60}`;
      rangoFin = finAuditoriaMax;
      periodoLabel = 'Últimos 60 Días';
    } else if (opcionPeriodo === 'HISTORICO_BASE') {
      rangoIni = minFechaGlobalBase || finAuditoriaMax;
      rangoFin = finAuditoriaMax;
      periodoLabel = 'Histórico Completo';
    }

    // Subtítulo dinámico
    const sub = document.getElementById('subtituloModalHistorico');
    if (sub) {
      const fmtI = rangoIni ? (rangoIni.length >= 10 ? `${rangoIni.substring(8, 10)}/${rangoIni.substring(5, 7)}/${rangoIni.substring(0, 4)}` : rangoIni) : 'Inicio';
      const fmtF = rangoFin.length >= 10 ? `${rangoFin.substring(8, 10)}/${rangoFin.substring(5, 7)}/${rangoFin.substring(0, 4)}` : rangoFin;
      sub.textContent = `Auditoría: ${periodoLabel} (${fmtI} al ${fmtF}) — Asistencias Ordinarias + Vacaciones vs. Esperadas (Excluye jornada en curso)`;
    }

    // Días hábiles generales para rango fijo
    const diasHabilesFijo = rangoIni ? ((typeof obtenerDiasHabiles === 'function') ? obtenerDiasHabiles(rangoIni, rangoFin) : []) : [];

    let totalOrdinarias = 0;
    let totalEsperadas = 0;
    let totalVacaciones = 0;
    let totalExtras = 0;
    let totalDiferencias = 0;
    let sumaKpis = 0;
    let datosTabla = [];

    const esVistaConsolidada = (opcionPeriodo === 'ANUAL' || (typeof opcionPeriodo === 'string' && opcionPeriodo.startsWith('ANIO_')) || opcionPeriodo === 'ULTIMOS_365' || opcionPeriodo === 'HISTORICO_BASE');
    const kpiVacIndiv = window.kpiVacacionesIndividual || {};

    empAsistencia.forEach(e => {
      const regsEmp = e.registros || [];
      let primerRegistroEmpValido = '';
      let primerRegistroEmpPeriodo = '';

      regsEmp.forEach(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        if (!f || f > hoy_) return;

        if (esRegistroAsistenciaBase(r)) {
          if (!primerRegistroEmpValido || f < primerRegistroEmpValido) {
            primerRegistroEmpValido = f;
          }
          if (rangoIni && f >= rangoIni && (!primerRegistroEmpPeriodo || f < primerRegistroEmpPeriodo)) {
            primerRegistroEmpPeriodo = f;
          }
        }
      });

      // Regla de inicio de evaluación por colaborador:
      // 1. Si el colaborador tiene fecha_ingreso válida y es posterior a rangoIni, se evalúa desde su ingreso (nuevo ingreso).
      // 2. Si no tiene fecha_ingreso, verificamos su primer registro histórico en la base (primerRegistroEmpValido).
      //    Si ese primer registro es posterior a rangoIni, se toma como inicio aproximado.
      // 3. De lo contrario, se evalúa desde el inicio del período (rangoIni).
      // 4. CRÍTICO: NUNCA usar primerRegistroEmpPeriodo, ya que reducía el período anual a 1 día para quienes marcaron recién.
      let fechaIngresoValida = null;
      if (e.fecha_ingreso && String(e.fecha_ingreso).trim().length >= 10) {
        const fi = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(e.fecha_ingreso) : String(e.fecha_ingreso).slice(0, 10);
        if (fi && fi >= '2020-01-01') fechaIngresoValida = fi;
      }

      let inicioColaborador = fechaIngresoValida;
      if (!inicioColaborador && primerRegistroEmpValido && primerRegistroEmpValido > rangoIni) {
        inicioColaborador = primerRegistroEmpValido;
      }

      let evalIni = (inicioColaborador && inicioColaborador > rangoIni) ? inicioColaborador : (rangoIni || finAuditoriaMax);
      let evalFin = rangoFin <= finAuditoriaMax ? rangoFin : finAuditoriaMax;

      let diasHabEmp = [];
      if (evalIni <= evalFin) {
        if (rangoIni && evalIni === rangoIni) {
          diasHabEmp = diasHabilesFijo;
        } else {
          diasHabEmp = (typeof obtenerDiasHabiles === 'function') ? obtenerDiasHabiles(evalIni, evalFin) : [];
        }
      }

      const esperadas = diasHabEmp.length;
      let diasOrdinariosEfectivos = new Set();
      let diasVacaciones = new Set();
      let diasJustificados = new Set();
      let diasExtrasEfectivos = new Set();

      regsEmp.forEach(r => {
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : (r.fecha || '').split('T')[0];
        if (!f || f < evalIni || f > evalFin) return;

        const t = (r.tipo || '').toUpperCase();
        const just = (r.justificado || '').toUpperCase();
        const razon = (r.razon_ausencia || r.razon_justificac || '').toUpperCase();
        const esHab = diasHabEmp.includes(f);

        // Permisos médicos, calamidad doméstica, permisos personales, faltas justificadas
        const esPermisoOJustificado = (
          t === 'PERMISO_MEDICO' || t.includes('MEDIC') ||
          t === 'CALAMIDAD_DOMESTICA' || t.includes('CALAMIDAD') ||
          t === 'PERMISO_PERSONAL' || t === 'PERMISO' ||
          t === 'FALTA_JUSTIFICADA' || t.includes('JUSTIFICAD') ||
          t === 'CUMPLEANOS' || t.includes('LICENCIA') ||
          just === 'SI' ||
          razon.includes('MEDIC') || razon.includes('CALAMIDAD') || razon.includes('PERMISO') || razon.includes('JUSTIFIC')
        );

        // Vacaciones
        const esVacacion = (t === 'VACACIONES' || t === 'VACACION' || razon.includes('VACACI'));

        if (esVacacion) {
          if (esHab) diasVacaciones.add(f);
        } else if (esPermisoOJustificado) {
          if (esHab) diasJustificados.add(f);
        } else if (t === 'ENTRADA' || t === 'CAMPO' || t === 'ENTRADA_CAMPO' || t === 'TRABAJO_DE_CAMPO' || t === 'RETORNO_CAMPO' || t === 'SALIDA' || (r.hora && String(r.hora).trim().length >= 4)) {
          if (esHab) {
            diasOrdinariosEfectivos.add(f);
          } else {
            diasExtrasEfectivos.add(f);
          }
        }
      });

      // Incorporar vacaciones registradas en el módulo de vacaciones de RRHH
      const vacsRRHH = (window.vacacionesData && Array.isArray(window.vacacionesData.vacaciones)) ? window.vacacionesData.vacaciones : [];
      if (vacsRRHH.length > 0) {
        vacsRRHH.forEach(v => {
          if (v && (String(v.empleadoId) === String(e.id) || String(v.id_empleado) === String(e.id))) {
            const fv = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(v.fecha) : (v.fecha || '').split('T')[0];
            if (fv && fv >= evalIni && fv <= evalFin && diasHabEmp.includes(fv)) {
              diasVacaciones.add(fv);
            }
          }
        });
      }

      // Identificar fechas exactas de inasistencias injustificadas (Diferencia)
      // CRÍTICO: Excluir estrictamente la fecha actual (hoy) ya que la jornada está en curso
      const fechasDiferencia = [];
      diasHabEmp.forEach(d => {
        if (d <= evalFin && !diasOrdinariosEfectivos.has(d) && !diasVacaciones.has(d) && !diasJustificados.has(d)) {
          fechasDiferencia.push(d);
        }
      });

      const ordinarias = diasOrdinariosEfectivos.size;
      const extras = diasExtrasEfectivos.size;

      // Vacaciones tomadas según requerimiento oficial
      const vInfo = kpiVacIndiv[e.id] || (e.cedula && kpiVacIndiv[e.cedula]) || null;
      const tomadasOficial = (vInfo && vInfo.tomadas != null && !isNaN(parseFloat(vInfo.tomadas))) ? parseFloat(vInfo.tomadas) : null;
      const vacaciones = (esVistaConsolidada && tomadasOficial !== null) ? tomadasOficial : diasVacaciones.size;

      // Proteger vacaciones oficiales: si en RRHH tiene registradas más vacaciones que las detectadas en marcas de asistencia,
      // la diferencia no debe imputarse como falta injustificada
      const vacsSinFechaMarcada = Math.max(0, vacaciones - diasVacaciones.size);
      const diferencia = Math.max(0, fechasDiferencia.length - vacsSinFechaMarcada);

      // Cumplimiento (%): Los permisos médicos, vacaciones y faltas justificadas están protegidos y no descuentan cumplimiento
      let pct = esperadas > 0 ? (((esperadas - diferencia) / esperadas) * 100) : 100;
      if (pct > 100) pct = 100;
      if (pct < 0) pct = 0;
      pct = Math.round(pct * 10) / 10;

      totalOrdinarias += ordinarias;
      totalEsperadas += esperadas;
      totalVacaciones += vacaciones;
      totalExtras += extras;
      totalDiferencias += diferencia;
      sumaKpis += pct;

      let rangoTexto = '';
      if (evalIni === evalFin) {
        rangoTexto = evalIni && evalIni.length >= 10 ? `${evalIni.substring(8, 10)}/${evalIni.substring(5, 7)}` : evalIni;
      } else {
        const pIni = evalIni && evalIni.length >= 10 ? `${evalIni.substring(8, 10)}/${evalIni.substring(5, 7)}` : (evalIni || '--');
        const pFin = evalFin && evalFin.length >= 10 ? `${evalFin.substring(8, 10)}/${evalFin.substring(5, 7)}` : (evalFin || '--');
        rangoTexto = `${pIni} — ${pFin}`;
      }

      datosTabla.push({
        id: e.id,
        nombre: e.nombre || 'Desconocido',
        cargo: e.cargo || e.area || 'Sin cargo',
        area: e.area || e.departamento || '',
        evalIni: evalIni,
        evalFin: evalFin,
        rangoTexto: rangoTexto,
        inicioEmp: primerRegistroEmpValido || evalIni,
        esperadas: esperadas,
        ordinarias: ordinarias,
        vacaciones: vacaciones,
        diferencia: diferencia,
        fechasDiferencia: fechasDiferencia,
        diasJustificados: diasJustificados.size,
        extras: extras,
        pct: pct
      });
    });

    datosTabla.sort((a, b) => b.diferencia - a.diferencia || a.pct - b.pct);

    // Cumplimiento Global Ponderado: (Total Esperadas - Total Diferencias) / Total Esperadas
    const promedioGral = totalEsperadas > 0
      ? (Math.max(0, ((totalEsperadas - totalDiferencias) / totalEsperadas) * 100)).toFixed(1)
      : '100.0';

    if (document.getElementById('lblModalHistOrdinarias')) document.getElementById('lblModalHistOrdinarias').textContent = totalOrdinarias.toLocaleString();
    if (document.getElementById('lblModalHistEsperadas')) document.getElementById('lblModalHistEsperadas').textContent = totalEsperadas.toLocaleString();
    if (document.getElementById('lblModalHistVacaciones')) document.getElementById('lblModalHistVacaciones').textContent = Math.round(totalVacaciones).toLocaleString();
    if (document.getElementById('lblModalHistDiferencia')) document.getElementById('lblModalHistDiferencia').textContent = totalDiferencias.toLocaleString();
    if (document.getElementById('lblModalHistExtras')) document.getElementById('lblModalHistExtras').textContent = totalExtras.toLocaleString();
    if (document.getElementById('lblModalHistPromedio')) document.getElementById('lblModalHistPromedio').textContent = `${promedioGral}%`;

    window._datosHistoricoBaseModal = datosTabla;

    const txtSearch = document.getElementById('txtBuscarHistoricoBase');
    if (txtSearch && txtSearch.value.trim()) {
      window.filtrarTablaHistoricoBase(txtSearch.value);
    } else {
      window.renderFilasHistoricoBase(datosTabla);
    }
  } catch (err) {
    console.error('Error al procesar datos histórico:', err);
    if (typeof mostrarToast === 'function') {
      mostrarToast('Error al procesar: ' + err.message, 'error');
    }
  }
};

window.cerrarModalDesgloseHistoricoBase = function () {
  const modal = document.getElementById('modalDesgloseHistoricoBase');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.renderFilasHistoricoBase = function (lista) {
  const tbody = document.getElementById('tbodyModalHistoricoBase');
  if (!tbody) return;

  if (!lista || lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding: 25px; text-align: center; color: var(--g500);">No se encontraron colaboradores en este período.</td></tr>`;
    return;
  }

  let html = '';
  lista.forEach((item, idx) => {
    let colorPct = '#ef4444';
    let badgeEstado = '';

    if (item.pct >= 95) {
      colorPct = '#15803d';
      badgeEstado = `<span style="background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 6px; font-weight: 800; font-size: 10px; border: 1px solid #bbf7d0; display: inline-flex; align-items: center; gap: 3px;"><i class="fas fa-check-circle"></i> 95%+</span>`;
    } else if (item.pct >= 85) {
      colorPct = '#b45309';
      badgeEstado = `<span style="background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 6px; font-weight: 800; font-size: 10px; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 3px;"><i class="fas fa-exclamation-circle"></i> 85%+</span>`;
    } else {
      colorPct = '#b91c1c';
      badgeEstado = `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 6px; font-weight: 800; font-size: 10px; border: 1px solid #fca5a5; display: inline-flex; align-items: center; gap: 3px;"><i class="fas fa-times-circle"></i> &lt;85%</span>`;
    }

    const inicial = escapeHtml((item.nombre || '?').charAt(0));
    const nombreEsc = escapeHtml(item.nombre || '');
    const cargoEsc = escapeHtml(item.cargo || '');

    // Formateo de fechas de inasistencia en la columna Diferencia
    let fechasDifHtml = '';
    if (item.diferencia === 0) {
      fechasDifHtml = `<span style="font-weight: 800; padding: 2px 8px; border-radius: 6px; font-size: 11px; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;">0</span>`;
    } else {
      const fArr = item.fechasDiferencia || [];
      const fmtFechas = fArr.map(f => {
        const parts = f.split('-');
        return {
          iso: f,
          label: parts.length === 3 ? `${parts[2]}/${parts[1]}` : f
        };
      });
      const fullList = fmtFechas.map(x => `${x.label} (${x.iso})`).join(', ');
      let displayFechas = '';
      if (fmtFechas.length <= 3) {
        displayFechas = fmtFechas.map(x => `<button type="button" onclick="window.irADetalleFecha('${item.id}', '${x.iso}')" class="btn-chip-dif" title="Clic para ir a regularizar el ${x.iso} en Detalle de Empleado">${x.label}</button>`).join(' ');
      } else {
        const primeros = fmtFechas.slice(0, 2).map(x => `<button type="button" onclick="window.irADetalleFecha('${item.id}', '${x.iso}')" class="btn-chip-dif" title="Clic para ir a regularizar el ${x.iso} en Detalle de Empleado">${x.label}</button>`).join(' ');
        const restantes = fmtFechas.length - 2;
        displayFechas = `${primeros} <button type="button" onclick="window.irADetalleFecha('${item.id}', '${fmtFechas[2].iso}')" class="btn-chip-dif" title="Ver ${restantes} fechas más en Detalle de Empleado">+${restantes}</button>`;
      }

      fechasDifHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
              <span style="font-weight: 800; padding: 1px 7px; border-radius: 6px; font-size: 11px; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;" title="Total inasistencias sin justificar: ${item.diferencia}">
                -${item.diferencia}
              </span>
              <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap; justify-content: center; max-width: 155px;">
                ${displayFechas}
              </div>
            </div>
          `;
    }

    html += `
          <tr style="border-bottom: 1px solid #f1f5f9; background: #ffffff; transition: background 0.15s ease;" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='#ffffff'">
            <td style="padding: 6px 4px; text-align: center; color: var(--g500); font-weight: 700; font-size: 11px;">${idx + 1}</td>
            <td style="padding: 6px 6px; overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                <div style="width: 24px; height: 24px; border-radius: 50%; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 10px; flex-shrink: 0; border: 1px solid #bfdbfe;">
                  ${inicial}
                </div>
                <div style="min-width: 0; flex: 1;">
                  <strong style="color: #1e293b; font-size: 11.5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${nombreEsc}">${nombreEsc}</strong>
                  <div style="font-size: 10px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${cargoEsc}">${cargoEsc}</div>
                </div>
              </div>
            </td>
            <td style="padding: 6px 4px; text-align: center; font-size: 10.5px; color: #475569; font-weight: 600; white-space: nowrap;" title="Rango evaluado">${item.rangoTexto}</td>
            <td style="padding: 6px 4px; text-align: center; font-weight: 700; color: #1e293b; font-size: 11.5px;">${item.esperadas}</td>
            <td style="padding: 6px 4px; text-align: center; font-weight: 800; color: #2563eb; font-size: 11.5px;">${item.ordinarias}</td>
            <td style="padding: 6px 4px; text-align: center; font-weight: 700; color: #0284c7; font-size: 11.5px;">
              <span style="${item.vacaciones > 0 ? 'background: #e0f2fe; padding: 2px 6px; border-radius: 6px; border: 1px solid #bae6fd;' : ''}" title="${item.vacaciones} días de vacaciones tomadas">${item.vacaciones}</span>
            </td>
            <td style="padding: 6px 4px; text-align: center;">
              ${fechasDifHtml}
            </td>
            <td style="padding: 6px 4px; text-align: center; font-weight: 700; color: #6366f1; font-size: 11.5px;">+${item.extras}</td>
            <td style="padding: 6px 4px; text-align: center;">
              <strong style="color: ${colorPct}; font-size: 12px;">${item.pct.toFixed(1)}%</strong>
            </td>
            <td style="padding: 6px 4px; text-align: center;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 4px;">
                ${badgeEstado}
                <button type="button" onclick="mostrarDetalle('${item.id}'); window.cerrarModalDesgloseHistoricoBase();" style="border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 5px; padding: 2px 6px; font-size: 10px; font-weight: 700; color: #334155; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; transition: all 0.15s ease;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f8fafc'" title="Ver expediente">
                  <i class="fas fa-eye" style="color: #2563eb; font-size: 10px;"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
  });

  tbody.innerHTML = html;
};

window.filtrarTablaHistoricoBase = function (term) {
  if (!window._datosHistoricoBaseModal) return;
  const q = (term || '').toLowerCase().trim();
  if (!q) {
    window.renderFilasHistoricoBase(window._datosHistoricoBaseModal);
    return;
  }
  const filtrados = window._datosHistoricoBaseModal.filter(i =>
    (i.nombre && i.nombre.toLowerCase().includes(q)) ||
    (i.cargo && i.cargo.toLowerCase().includes(q)) ||
    (i.area && i.area.toLowerCase().includes(q))
  );
  window.renderFilasHistoricoBase(filtrados);
};

window.exportarTablaHistoricoBaseExcel = window.exportarDiferenciasExcel = async function () {
  const lista = window._datosHistoricoBaseModal;
  if (!lista || !lista.length) {
    if (typeof mostrarToast === 'function') mostrarToast('No hay datos para exportar', 'warning');
    return;
  }
  try {
    await window.asegurarXLSX();
    const rows = lista.map((it, idx) => {
      const fArr = it.fechasDiferencia || [];
      const fechasStr = fArr.map(f => {
        const p = f.split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : f;
      }).join(', ');

      return {
        '#': idx + 1,
        'Colaborador': it.nombre,
        'Cargo': it.cargo,
        'Área': it.area,
        'Rango Evaluado': it.rangoTexto,
        'Asistencias Esperadas': it.esperadas,
        'Asistencias Ordinarias': it.ordinarias,
        'Vacaciones Tomadas': it.vacaciones,
        'Permisos y Justificaciones': it.diasJustificados || 0,
        'Diferencia (Ausencias Injustificadas)': it.diferencia > 0 ? -it.diferencia : 0,
        'Fechas Inasistencias': fechasStr || 'Ninguna',
        'Días Extras': it.extras,
        '% Cumplimiento': `${it.pct.toFixed(1)}%`,
        'Estado': it.pct >= 95 ? 'Excelente' : (it.pct >= 85 ? 'Aceptable' : 'Crítico')
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Desglose Asistencia");
    const fHoy = (typeof getLocalHoyStr === 'function') ? getLocalHoyStr() : new Date().toISOString().split('T')[0];
    const selModal = document.getElementById('selPeriodoModalHistorico');
    const perLabel = selModal ? (selModal.options[selModal.selectedIndex]?.text || '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30) : '';
    const sufijoPer = perLabel ? `_${perLabel}` : '';
    XLSX.writeFile(wb, `Reporte_Diferencias_Asistencia${sufijoPer}_${fHoy}.xlsx`);
    if (typeof mostrarToast === 'function') mostrarToast('Desglose de diferencias exportado a Excel', 'success');
  } catch (e) {
    console.error('Error exportando excel diferencias:', e);
    if (typeof mostrarToast === 'function') mostrarToast('Error al exportar Excel: ' + e.message, 'error');
  }
};

// ============================================================
// NAVEGACIÓN DIRECTA: A FECHA ESPECÍFICA EN DETALLE DE EMPLEADO
// Detecta automáticamente el período (actual o anterior) de la fecha
// ============================================================
window.irADetalleFecha = function (empleadoId, fechaIso) {
  if (typeof window.cerrarModalDesgloseHistoricoBase === 'function') {
    window.cerrarModalDesgloseHistoricoBase();
  }
  let idxPer = 0;
  if (Array.isArray(periodos) && fechaIso) {
    const found = periodos.findIndex(p => p && fechaIso >= p.inicio && fechaIso <= p.fin);
    if (found >= 0) {
      idxPer = found;
    } else {
      const foundClosest = periodos.findIndex(p => p && fechaIso >= p.inicio);
      if (foundClosest >= 0) idxPer = foundClosest;
    }
  }
  if (typeof window.mostrarDetalle === 'function') {
    window.mostrarDetalle(empleadoId, idxPer, null, null, fechaIso);
  }
};

window.enfocarFechaEnDetalle = function (fecha, reintentos = 6) {
  if (!fecha) return;
  const rowId = 'fila-fecha-' + fecha;
  const row = document.getElementById(rowId);
  if (!row) {
    if (reintentos > 0) {
      setTimeout(() => window.enfocarFechaEnDetalle(fecha, reintentos - 1), 180);
      return;
    }
    if (typeof mostrarToast === 'function') {
      mostrarToast('Fecha ' + fecha + ' no encontrada en el período visualizado.', 'info');
    }
    return;
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('fila-resaltada-regularizar');
  void row.offsetWidth; // Forzar reflow para reiniciar animación
  row.classList.add('fila-resaltada-regularizar');

  setTimeout(() => {
    row.classList.remove('fila-resaltada-regularizar');
  }, 5000);
};

// ==========================================
// EVENTO: ACTUALIZACIÓN REACTIVA DE REGISTROS ARCHIVADOS (SHEETS / INDEXEDDB)
// ==========================================
window.addEventListener('archivadosActualizados', function (ev) {
  console.log('🔄 Registros archivados sincronizados, refrescando datos de supervisión...');
  const archivados = (ev && ev.detail && ev.detail.registros) ? ev.detail.registros : [];
  if (archivados && archivados.length && Array.isArray(empCache)) {
    const empMap = {};
    empCache.forEach(e => {
      empMap[String(e.id).trim()] = e;
      if (e.cedula) empMap[String(e.cedula).trim()] = e;
    });

    archivados.forEach(r => {
      const eid = String(r.empleadoId || r.id_empleado || (r.id ? String(r.id).split('_')[0] : '')).trim();
      if (eid && empMap[eid]) {
        const emp = empMap[eid];
        if (!emp.registros) emp.registros = [];
        const f = (typeof normalizarFechaStr === 'function') ? normalizarFechaStr(r.fecha) : r.fecha;
        const tipo = (r.tipo || '').toUpperCase();
        const yaExiste = emp.registros.some(er => er.fecha === f && er.tipo === tipo);
        if (!yaExiste) {
          emp.registros.push({
            id: r.id || `arch_${eid}_${f}_${tipo}`,
            fecha: f,
            tipo: tipo,
            hora: r.hora || '00:00:00',
            almuerzo: r.almuerzo || '',
            modo: r.modo || 'OFICINA',
            horasExtra: r.horasExtra || 'NO',
            justificado: r.justificado || '',
            razon_justificac: r.razon_justificac || '',
            razon_ausencia: r.razon_ausencia || ''
          });
        }
      }
    });
  }

  // Ocultar banner de sincronización
  const banner = document.getElementById('bannerSincronizandoHistorico');
  if (banner) banner.style.display = 'none';

  // Si el modal de desglose histórico está visible, recalcularlo inmediatamente
  const modal = document.getElementById('modalDesgloseHistoricoBase');
  if (modal && modal.style.display !== 'none' && !modal.classList.contains('hidden')) {
    const selModal = document.getElementById('selPeriodoModalHistorico');
    const valorSel = selModal ? selModal.value : 'ANUAL';
    if (typeof window.procesarYRenderizarHistoricoBase === 'function') {
      window.procesarYRenderizarHistoricoBase(valorSel);
    }
  }
});

window.forzarSincronizacionHistorica = async function () {
  try {
    const banner = document.getElementById('bannerSincronizandoHistorico');
    if (banner) banner.style.display = 'flex';
    const btnIcon = document.getElementById('iconoSyncHistorico');
    if (btnIcon) btnIcon.classList.add('fa-spin');

    if (typeof mostrarToast === 'function') {
      mostrarToast('Sincronizando histórico completo desde Sheets (esto puede tomar ~40s)...', 'info');
    }

    if (window.USE_FIREBASE && window.FirebaseBackend && typeof window.FirebaseBackend.obtenerDatosSupervisor === 'function') {
      const res = await window.FirebaseBackend.obtenerDatosSupervisor({ force: true, forceSheets: true });
      if (res && res.empleados) {
        empCache = res.empleados;
      }
    } else if (typeof jsonpRequest === 'function') {
      const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor', force: true, forceSheets: true });
      if (res && res.empleados) {
        empCache = res.empleados;
      }
    }

    if (btnIcon) btnIcon.classList.remove('fa-spin');
    if (banner) banner.style.display = 'none';
    if (typeof mostrarToast === 'function') {
      mostrarToast('¡Sincronización histórica completada exitosamente!', 'success');
    }

    const selModal = document.getElementById('selPeriodoModalHistorico');
    const valorSel = selModal ? selModal.value : 'ANUAL';
    window.procesarYRenderizarHistoricoBase(valorSel);
  } catch (err) {
    console.error('Error al forzar sincronización histórica:', err);
    const btnIcon = document.getElementById('iconoSyncHistorico');
    if (btnIcon) btnIcon.classList.remove('fa-spin');
    const banner = document.getElementById('bannerSincronizandoHistorico');
    if (banner) banner.style.display = 'none';
    if (typeof mostrarToast === 'function') {
      mostrarToast('Error en la sincronización: ' + err.message, 'error');
    }
  }
};

// ==========================================
// MODAL DESGLOSE DE VACACIONES (GOCE ANUAL)
// ==========================================
window.abrirModalDesgloseVacaciones = function () {
  try {
    const modal = document.getElementById('modalDesgloseVacaciones');
    const tbody = document.getElementById('tbodyModalVacaciones');
    if (!modal) {
      console.error('Modal #modalDesgloseVacaciones no encontrado en el DOM');
      return;
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (!empCache || !empCache.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding: 25px; text-align: center; color: var(--g600);"><i class="fas fa-spinner fa-spin"></i> Cargando datos de vacaciones...</td></tr>`;
      return;
    }

    const kpiVacIndiv = window.kpiVacacionesIndividual || {};
    const empAsistencia = empCache.filter(e => {
      const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
      const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
      return act && !excluido;
    });

    let totalAdjudicadas = 0;
    let totalTomadas = 0;
    let totalRestantes = 0;
    let sumaKpis = 0;
    let colabsConVac = 0;
    let datosTabla = [];

    empAsistencia.forEach(e => {
      const empKey = String(e.id).trim();
      const vInfo = kpiVacIndiv[empKey] || (e.cedula && kpiVacIndiv[String(e.cedula).trim()]) || kpiVacIndiv[e.id] || { adjudicadas: 0, tomadas: 0, restantes: 0 };
      const adj = parseFloat(vInfo.adjudicadas) || 0;
      const tom = parseFloat(vInfo.tomadas) || 0;
      const res = parseFloat(vInfo.restantes) || 0;

      const tieneDatosVac = (adj > 0 || tom > 0 || res !== 0);
      let pct = 0;
      if (adj > 0) {
        pct = Math.min(100, (tom / adj) * 100);
        sumaKpis += pct;
        colabsConVac++;
      } else if (tom > 0) {
        pct = 100;
        sumaKpis += 100;
        colabsConVac++;
      }

      totalAdjudicadas += adj;
      totalTomadas += tom;
      totalRestantes += res;

      datosTabla.push({
        id: e.id,
        nombre: e.nombre || 'Desconocido',
        cargo: e.cargo || e.area || 'Sin cargo',
        area: e.area || e.departamento || '',
        adjudicadas: adj,
        tomadas: tom,
        restantes: res,
        pct: pct,
        tieneDatosVac: tieneDatosVac
      });
    });

    // Ordenar: primero colaboradores con vacaciones (de menor % de goce a mayor), luego sin asignar
    datosTabla.sort((a, b) => {
      if (a.tieneDatosVac !== b.tieneDatosVac) return a.tieneDatosVac ? -1 : 1;
      if (a.pct !== b.pct) return a.pct - b.pct;
      return b.restantes - a.restantes;
    });

    const tasaGlobal = totalAdjudicadas > 0 ? ((totalTomadas / totalAdjudicadas) * 100).toFixed(1) : '100.0';
    const promedioIndiv = colabsConVac > 0 ? (sumaKpis / colabsConVac).toFixed(1) : tasaGlobal;

    const formatDias = (n) => (n % 1 === 0 ? n : n.toFixed(1));

    if (document.getElementById('lblModalVacAdjudicadas')) document.getElementById('lblModalVacAdjudicadas').textContent = `${formatDias(totalAdjudicadas)} d`;
    if (document.getElementById('lblModalVacTomadas')) document.getElementById('lblModalVacTomadas').textContent = `${formatDias(totalTomadas)} d`;
    if (document.getElementById('lblModalVacRestantes')) document.getElementById('lblModalVacRestantes').textContent = `${formatDias(totalRestantes)} d`;
    if (document.getElementById('lblModalVacTasaGlobal')) document.getElementById('lblModalVacTasaGlobal').textContent = `${tasaGlobal}%`;
    if (document.getElementById('lblModalVacPromedioIndiv')) document.getElementById('lblModalVacPromedioIndiv').textContent = `${promedioIndiv}%`;

    window._datosVacacionesModal = datosTabla;
    window.renderFilasVacaciones(datosTabla);
  } catch (err) {
    console.error('Error al abrir modal desglose de vacaciones:', err);
    if (typeof mostrarToast === 'function') {
      mostrarToast('Error al procesar el desglose de vacaciones: ' + err.message, 'error');
    }
  }
};

window.cerrarModalDesgloseVacaciones = function () {
  const modal = document.getElementById('modalDesgloseVacaciones');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.renderFilasVacaciones = function (lista) {
  const tbody = document.getElementById('tbodyModalVacaciones');
  if (!tbody) return;

  if (!lista || lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding: 20px; text-align: center; color: var(--g500);">No se encontraron colaboradores.</td></tr>`;
    return;
  }

  const formatDias = (n) => (n % 1 === 0 ? n : n.toFixed(1));
  let html = '';
  lista.forEach((item, idx) => {
    let colorPct = '#0284c7';
    let badgeEstado = '';

    if (!item.tieneDatosVac) {
      colorPct = '#94a3b8';
      badgeEstado = `<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 11px; border: 1px solid #e2e8f0;"><i class="fas fa-minus"></i> Sin Asignar</span>`;
    } else if (item.pct >= 100) {
      colorPct = '#10b981';
      badgeEstado = `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 11px; border: 1px solid #bbf7d0;"><i class="fas fa-check-circle"></i> Completo</span>`;
    } else if (item.pct >= 50) {
      colorPct = '#f59e0b';
      badgeEstado = `<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 11px; border: 1px solid #fde68a;"><i class="fas fa-hourglass-half"></i> En Goce</span>`;
    } else if (item.pct > 0) {
      colorPct = '#0284c7';
      badgeEstado = `<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 11px; border: 1px solid #bae6fd;"><i class="fas fa-clock"></i> Parcial</span>`;
    } else {
      colorPct = '#ef4444';
      badgeEstado = `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 11px; border: 1px solid #fca5a5;"><i class="fas fa-exclamation-circle"></i> Sin Gozar</span>`;
    }

    const inicial = escapeHtml((item.nombre || '?').charAt(0));
    const nombreEsc = escapeHtml(item.nombre || '');
    const cargoEsc = escapeHtml(item.cargo || '');

    html += `
          <tr style="border-bottom: 1px solid #f1f5f9; background: #ffffff; transition: background 0.15s ease;" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='#ffffff'">
            <td style="padding: 10px 12px; text-align: center; color: var(--g500); font-weight: 700;">${idx + 1}</td>
            <td style="padding: 10px 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 26px; height: 26px; border-radius: 50%; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0;">
                  ${inicial}
                </div>
                <div style="min-width: 0;">
                  <strong style="color: var(--g800);">${nombreEsc}</strong>
                  <div style="font-size: 11px; color: var(--g500);">${cargoEsc}</div>
                </div>
              </div>
            </td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 600;">${formatDias(item.adjudicadas)}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 700; color: #0d9488;">${formatDias(item.tomadas)}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 700; color: ${item.restantes > 0 ? '#b91c1c' : '#10b981'};">${formatDias(item.restantes)}</td>
            <td style="padding: 10px 12px; text-align: center;">
              <div style="display: inline-flex; align-items: center; gap: 8px;">
                <div style="background: #e2e8f0; border-radius: 6px; height: 8px; width: 70px; overflow: hidden;">
                  <div style="background: ${colorPct}; width: ${item.pct}%; height: 100%;"></div>
                </div>
                <strong style="color: ${colorPct}; font-size: 12px;">${item.pct.toFixed(1)}%</strong>
              </div>
            </td>
            <td style="padding: 10px 12px; text-align: center;">${badgeEstado}</td>
            <td style="padding: 10px 12px; text-align: center;">
              <button type="button" class="btn btn-outline" onclick="window.cerrarModalDesgloseVacaciones(); mostrarDetalle('${item.id}', 0);" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; background: #ffffff;" title="Ver perfil del colaborador">
                <i class="fas fa-user" style="color: var(--blue);"></i> Detalle
              </button>
            </td>
          </tr>
        `;
  });

  tbody.innerHTML = html;
};

window.filtrarTablaVacaciones = function (term) {
  if (!window._datosVacacionesModal) return;
  const q = (term || '').toLowerCase().trim();
  if (!q) {
    window.renderFilasVacaciones(window._datosVacacionesModal);
    return;
  }
  const filtrados = window._datosVacacionesModal.filter(i =>
    (i.nombre && i.nombre.toLowerCase().includes(q)) ||
    (i.cargo && i.cargo.toLowerCase().includes(q)) ||
    (i.area && i.area.toLowerCase().includes(q))
  );
  window.renderFilasVacaciones(filtrados);
};

window.exportarTablaVacacionesExcel = async function () {
  const tabla = document.getElementById('tablaVacacionesModal');
  if (!tabla) return;
  try {
    await window.asegurarXLSX();
    const ws = XLSX.utils.table_to_sheet(tabla);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Auditoría Vacaciones");
    XLSX.writeFile(wb, `Reporte_Auditoria_Vacaciones_${new Date().toISOString().split('T')[0]}.xlsx`);
    mostrarToast('Auditoría de vacaciones exportada a Excel', 'success');
  } catch (err) {
    console.error("Error al exportar vacaciones a Excel:", err);
    mostrarToast('Error al exportar: ' + err.message, 'error');
  }
};

// ==========================================
// DETALLE DE KPIS POR COLABORADOR
// ==========================================
window.renderDetailedKPIs = function () {
  const tbody = document.getElementById('tbodyKpiDetalle');
  if (!tbody) return;

  const selPeriodo = document.getElementById('kpiDetallePeriodo') || document.getElementById('periodoMensualDash') || document.getElementById('periodoMensual');
  const idx = parseInt(selPeriodo?.value || 0);
  let periodo = (periodos && periodos[idx]) ? periodos[idx] : (periodos ? periodos[0] : null);
  if (!periodo || !empCache.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding: 20px; text-align: center; color: var(--g500);">Sin datos para el período seleccionado.</td></tr>';
    return;
  }

  const hoy_ = getLocalHoyStr();
  const diasHabTodos = obtenerDiasHabiles(periodo.inicio, periodo.fin);
  const diasHab = diasHabTodos.filter(d => d <= hoy_);
  const diasLaborables = diasHab.length;

  const empActivos = empCache.filter(e => {
    const act = (e.estado === 'ACTIVO' || e.activo === 'SI' || e.activo === true || String(e.activo || '').toUpperCase() === 'SI');
    const excluido = (typeof esEmpleadoExcluidoAsistencia === 'function') ? esEmpleadoExcluidoAsistencia(e) : false;
    return act && !excluido;
  });

  const kpiVacData = window.kpiVacacionesIndividual || {};
  const formatDias = (n) => (n % 1 === 0 ? n : n.toFixed(1));

  let totOrdinarias = 0;
  let totEsperadas = diasLaborables * empActivos.length;
  let totVacaciones = 0;
  let totInasistencias = 0;
  let totExtras = 0;
  let sumaKpiAsist = 0;

  let html = '';
  empActivos.forEach(emp => {
    const regsEmp = (emp.registros || []).filter(r => r.fecha >= periodo.inicio && r.fecha <= hoy_);
    let diasEfectivos = new Set();
    let diasVac = new Set();
    let diasExt = new Set();

    regsEmp.forEach(r => {
      const t = (r.tipo || '').toUpperCase();
      const just = (r.justificado || '').toUpperCase();
      const esHab = diasHab.includes(r.fecha);
      if (t === 'VACACIONES' || t === 'VACACION') {
        if (esHab) diasVac.add(r.fecha);
      } else if (t === 'ENTRADA' || t === 'CAMPO' || just === 'SI') {
        if (esHab) diasEfectivos.add(r.fecha);
        else diasExt.add(r.fecha);
      }
    });

    const ord = diasEfectivos.size;
    const vac = diasVac.size;
    const ext = diasExt.size;
    const inasist = Math.max(0, diasLaborables - (ord + vac));

    totOrdinarias += ord;
    totVacaciones += vac;
    totExtras += ext;
    totInasistencias += inasist;

    let kpiAsistPct = diasLaborables > 0 ? (((ord + vac) / diasLaborables) * 100) : 100;
    if (kpiAsistPct > 100) kpiAsistPct = 100;
    sumaKpiAsist += kpiAsistPct;

    const empKey = String(emp.id).trim();
    const vInfo = kpiVacData[empKey] || (emp.cedula && kpiVacData[String(emp.cedula).trim()]) || kpiVacData[emp.id] || { adjudicadas: 0, tomadas: 0, restantes: 0 };
    const vacAdj = parseFloat(vInfo.adjudicadas) || 0;
    const vacTom = parseFloat(vInfo.tomadas) || 0;
    const vacRes = parseFloat(vInfo.restantes) || 0;

    let kpiVacPct = 0;
    let txtVacPct = '-';
    let colVac = '#94a3b8';

    if (vacAdj > 0) {
      kpiVacPct = Math.min(100, (vacTom / vacAdj) * 100);
      txtVacPct = `${kpiVacPct.toFixed(1)}%`;
      if (kpiVacPct >= 85) colVac = '#10b981';
      else if (kpiVacPct >= 50) colVac = '#f59e0b';
      else colVac = '#0284c7';
    } else if (vacTom > 0) {
      kpiVacPct = 100;
      txtVacPct = '100.0%';
      colVac = '#10b981';
    }

    let colAsist = '#ef4444';
    if (kpiAsistPct >= 95) colAsist = '#10b981';
    else if (kpiAsistPct >= 85) colAsist = '#f59e0b';

    html += `
          <tr style="border-bottom: 1px solid #f1f5f9; cursor: pointer;" onclick="mostrarDetalle('${emp.id}')" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='#ffffff'">
            <td style="padding: 10px 12px; font-weight: 600;">${escapeHtml(emp.nombre)}</td>
            <td style="padding: 10px 12px; text-align: center;">${diasLaborables}</td>
            <td style="padding: 10px 12px; text-align: center; color: #2563eb; font-weight: 700;">${ord}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${inasist > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">${inasist}</td>
            <td style="padding: 10px 12px; text-align: center; color: #7c3aed; font-weight: 600;">+${ext}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 800; color: ${colAsist};">${kpiAsistPct.toFixed(1)}%</td>
            <td style="padding: 10px 12px; text-align: center;">${formatDias(vacAdj)}</td>
            <td style="padding: 10px 12px; text-align: center; color: #0d9488; font-weight: 700;">${formatDias(vacTom)}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${vacRes > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">${formatDias(vacRes)}</td>
            <td style="padding: 10px 12px; text-align: center; font-weight: 800; color: ${colVac};">${txtVacPct}</td>
          </tr>
        `;
  });

  tbody.innerHTML = html || '<tr><td colspan="10" style="padding: 20px; text-align: center; color: var(--g500);">No se encontraron colaboradores activos.</td></tr>';

  // Actualizar barra de resumen global
  const promGlobalAsist = empActivos.length > 0 ? (sumaKpiAsist / empActivos.length).toFixed(1) : '0.0';
  if ($('lblKpiPeriodoNombre')) $('lblKpiPeriodoNombre').textContent = periodo.label || '';
  if ($('lblKpiPeriodoPct')) $('lblKpiPeriodoPct').textContent = `${promGlobalAsist}%`;
  if ($('lblKpiPeriodoEfectivas')) $('lblKpiPeriodoEfectivas').textContent = totOrdinarias;
  if ($('lblKpiPeriodoEsperadas')) $('lblKpiPeriodoEsperadas').textContent = totEsperadas;
  if ($('lblKpiPeriodoVacaciones')) $('lblKpiPeriodoVacaciones').textContent = totVacaciones;
  if ($('lblKpiPeriodoInasistencias')) $('lblKpiPeriodoInasistencias').textContent = totInasistencias;
  if ($('lblKpiPeriodoExtras')) $('lblKpiPeriodoExtras').textContent = totExtras;
  if ($('lblKpiPeriodoColabs')) $('lblKpiPeriodoColabs').textContent = empActivos.length;
  if ($('lblKpiPeriodoDiasLab')) $('lblKpiPeriodoDiasLab').textContent = diasLaborables;

  const badgeStatus = $('lblKpiPeriodoStatus');
  if (badgeStatus) {
    const val = parseFloat(promGlobalAsist);
    if (val >= 95) {
      badgeStatus.textContent = 'Excelente';
      badgeStatus.style.background = '#dcfce7';
      badgeStatus.style.color = '#15803d';
    } else if (val >= 85) {
      badgeStatus.textContent = 'Aceptable';
      badgeStatus.style.background = '#fef3c7';
      badgeStatus.style.color = '#b45309';
    } else {
      badgeStatus.textContent = 'Crítico';
      badgeStatus.style.background = '#fee2e2';
      badgeStatus.style.color = '#b91c1c';
    }
  }
};

window.exportarKPIsExcel = async function () {
  try {
    await window.asegurarXLSX();
    const wb = XLSX.utils.book_new();
    const asistVal = $('kpiAsistenciaVal')?.innerText || '0%';
    const vacVal = $('kpiVacacionesVal')?.innerText || '0%';
    const data = [
      ['Indicador', 'Valor %', 'Detalle 1', 'Detalle 2'],
      ['Cumplimiento de Asistencia', asistVal, 'Efectivas: ' + ($('kpiAsistenciaDetalle1')?.innerText || '0'), 'Esperadas: ' + ($('kpiAsistenciaDetalle2')?.innerText || '0')],
      ['Cumplimiento de Vacaciones', vacVal, 'Tomadas: ' + ($('kpiVacacionesDetalleTomadas')?.innerText || '0'), 'Adjudicadas: ' + ($('kpiVacacionesDetalle2')?.innerText || '0')]
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "KPIs Globales");
    XLSX.writeFile(wb, `Reporte_KPIs_Globales_${new Date().toISOString().split('T')[0]}.xlsx`);
    mostrarToast('KPIs exportados a Excel', 'success');
  } catch (err) {
    console.error("Error exportando KPIs a Excel:", err);
    mostrarToast('Error al exportar KPIs: ' + err.message, 'error');
  }
};

window.exportarKPIsPDF = async function () {
  const section = document.getElementById('kpisDashboardSection');
  if (!section) return;
  try {
    await window.asegurarHtml2Pdf();
    const clone = section.cloneNode(true);
    clone.style.padding = '20px';
    clone.style.background = 'white';
    const opt = {
      margin: 10,
      filename: `Reporte_KPIs_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    mostrarToast('Generando PDF de KPIs...', 'info');
    html2pdf().set(opt).from(clone).save().then(() => {
      mostrarToast('PDF generado exitosamente', 'success');
    });
  } catch (err) {
    console.error("Error generando PDF de KPIs:", err);
    mostrarToast('Error al generar PDF: ' + err.message, 'error');
  }
};

window.exportarKPIsDetalladosExcel = async function () {
  const tabla = document.getElementById('tablaKpiDetalle');
  if (!tabla) return;
  try {
    await window.asegurarXLSX();
    const selPeriodo = document.getElementById('kpiDetallePeriodo');
    const label = selPeriodo ? selPeriodo.options[selPeriodo.selectedIndex]?.text || 'Periodo' : 'Periodo';
    const ws = XLSX.utils.table_to_sheet(tabla);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KPIs Detallados");
    XLSX.writeFile(wb, `KPIs_Detallados_${label.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    mostrarToast('KPIs detallados exportados a Excel', 'success');
  } catch (err) {
    console.error("Error exportando KPIs detallados a Excel:", err);
    mostrarToast('Error al exportar: ' + err.message, 'error');
  }
};

window.exportarKPIsDetalladosPDF = async function () {
  const container = document.getElementById('tablaKpiDetalle')?.parentElement;
  if (!container) return;
  try {
    await window.asegurarHtml2Pdf();
    const clone = container.cloneNode(true);
    clone.style.padding = '20px';
    clone.style.background = 'white';
    const opt = {
      margin: 10,
      filename: `KPIs_Detallados_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    mostrarToast('Generando PDF de KPIs detallados...', 'info');
    html2pdf().set(opt).from(clone).save().then(() => {
      mostrarToast('PDF generado exitosamente', 'success');
    });
  } catch (err) {
    console.error("Error generando PDF detallado:", err);
    mostrarToast('Error al generar PDF: ' + err.message, 'error');
  }
};



// ============================================================
// MODULOS SATELITES EXTRAIDOS EN FASE 2:
// - JS/supervisor/supervisor_cultura.js
// - JS/supervisor/supervisor_whatsapp.js
// - JS/supervisor/supervisor_mapa.js
// - JS/supervisor/supervisor_invitados.js
// Se cargan independientemente en supervisor.html
// ============================================================
