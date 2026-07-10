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
    
    function getLocalHoyStr(date = new Date()) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function calcularAlmuerzosPeriodo(e, R_INI, R_FIN) {
      let todosRegs = e.registros || [];
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
      localStorage.removeItem('tcontrol_almuerzos_extra_cache_v1');
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tcontrol_archivados_cache_')) {
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

    function mostrarLoader(show) {
      const loader = document.getElementById('loader');
      if (loader) loader.classList.toggle('hidden', !show);
    }

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

      // Feriados nacionales y locales (Quito)
      const feriados = [
        '1/1',   // Año Nuevo
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

    function esEnCampo(lat, lng) {
      if (!lat || !lng) return false;
      let distancia = calcularDistancia(LAT_EMPRESA, LNG_EMPRESA, parseFloat(lat), parseFloat(lng));
      return distancia > RADIO_METROS;
    }

    function fixFotoUrl(url) {
      if (!url) return null;
      // Convertir URLs de Google Drive a formato compatible con img src
      if (url.includes('drive.google.com/file/d/')) {
        const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
      }
      if (url.includes('drive.google.com/open?id=') || url.includes('id=')) {
        const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
      }
      if (url.includes('/uc?export=view&id=') || url.includes('/uc?id=')) {
        const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
      }
      return url;
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
      return src ? `<img class="employee-photo" src="${escapeHtml(src)}" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="employee-photo-placeholder" style="display:none">${ini}</div>` : `<div class="employee-photo-placeholder">${ini}</div>`;
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
      const s = String(val).trim();
      // Ya está en formato YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
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
          window[cbName] = function() {};
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
      if($('donutPorcentaje')) $('donutPorcentaje').textContent = pctH + '%';
      if($('legendPresentes')) $('legendPresentes').textContent = hoyP;
      if($('legendTardanzas')) $('legendTardanzas').textContent = hoyT;
      if($('legendAusentes')) $('legendAusentes').textContent = hoyA;
      if($('legendSalieron')) $('legendSalieron').textContent = hoySalieron;

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
        if($('dashAsistencia')) $('dashAsistencia').textContent = aPct + '%';
        if($('dashPuntualidad')) $('dashPuntualidad').textContent = pPct + '%';
        if($('dashAlmPlanta')) $('dashAlmPlanta').textContent = almPct + '%';
        if($('dashTotalEmpleados')) $('dashTotalEmpleados').textContent = empCache.length;
        if($('tasaAlmuerzoPlanta')) $('tasaAlmuerzoPlanta').textContent = almPct + '%';

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
        if($('topPuntuales')) $('topPuntuales').innerHTML = topP.length ? topP.map((e, i) => {
          let datesTooltip = e.fechas && e.fechas.length ? `title="Tardanzas: ${e.fechas.join(', ')} (Total: ${e.minutosTard} min)"` : `title="100% Puntual"`;
          return `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')" ${datesTooltip} style="cursor:pointer;"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--g400);font-weight:600;margin-bottom:-2px">${e.asist - e.tardanzas} de ${e.asist} punt.</span><span>${e.p}%</span></div></div>`;
        }).join('') : '<div class="empty-state">Sin datos</div>';
        
        let topTard = Object.values(tardMap).sort((a, b) => {
          if (b.tardanzas !== a.tardanzas) return b.tardanzas - a.tardanzas;
          return b.minutosTard - a.minutosTard; // Tie-breaker: más minutos de retraso acumulados primero
        }).slice(0, 10);
        if($('topTardanzasRanking')) $('topTardanzasRanking').innerHTML = topTard.length ? topTard.map((e, i) => {
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
        if($('promedioDiario')) $('promedioDiario').textContent = promDia;
        if($('diasExcelente')) $('diasExcelente').textContent = diasExc;

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
        if($('horasExtraTotal')) $('horasExtraTotal').textContent = formatearMinutos(extraTotal);

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
              let sortedRegs = [...regsDia].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));

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

            if (minsFaltantes > 15) {
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

        // Subtítulo de almuerzo de planta con extras
        let extrasPeriodo = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return fNorm >= periodo.inicio && fNorm <= hoy_;
        });
        let totalExtrasPeriodo = extrasPeriodo.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
        let totalLunchesPeriodo = almP + totalExtrasPeriodo;
        if ($('dashAlmPlantaSub')) {
          $('dashAlmPlantaSub').innerHTML = `<span style="font-weight:600; color:var(--blue)">${almP}</span> emp. + <span style="font-weight:600; color:var(--indigo)">${totalExtrasPeriodo}</span> ext. = <strong>${totalLunchesPeriodo}</strong> total`;
        }

        cargarResumenMensual();
        cargarAnalisisTardanzas();
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

        let extrasPeriodo = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return fNorm >= R_INI && fNorm <= R_FIN;
        });
        let totalAlmExt = extrasPeriodo.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);

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
      let punt = stats.filter(r => r.tardanzas === 0 && r.nE > 0).length;
      $('tarTotal').textContent = totT;
      $('tarMinutos').textContent = formatearMinutos(totM);
      $('tarExtra').textContent = totX;
      $('tarPuntuales').textContent = punt;
      let rank = stats.filter(r => r.tardanzas > 0).sort((a, b) => b.tardanzas - a.tardanzas);
      let maxT = rank[0]?.tardanzas || 1;
      $('rankingTardanzas').innerHTML = rank.length ? rank.slice(0, 10).map(r => `<div class="hbar-row" onclick="mostrarDetalle('${r.id}')"><div class="hbar-label" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre.split(' ')[0])}</div><div class="hbar-track"><div class="hbar-fill" style="width:${calcularPct(r.tardanzas, maxT)}%;background:var(--amber);"></div></div><div class="hbar-number">${r.tardanzas} tard.</div></div>`).join('') : '<div class="empty-state">Sin tardanzas</div>';
    }

    // ============================================================
    // ASISTENCIA - 7 CARDS
    function cargarAsistencia() {
      hoy = getLocalHoyStr();
      const esAdminMaster = window.isMaster || false;
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
      
      let extrasHoy = (window.almuerzosExtra || []).filter(ae => normalizarFechaStr(ae.fecha) === hoy);
      let totalExtrasHoy = extrasHoy.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);

      let almPlanta = empCache.filter(e => {
        const esPresenteOAlm = e.entradaHoy || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
        return esPresenteOAlm && (e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA');
      }).length + totalExtrasHoy;
      let almFuera = empCache.filter(e => {
        const esPresenteOAlm = e.entradaHoy || (e.cargo || '').toUpperCase() === 'SIN ASISTENCIA';
        return esPresenteOAlm && (e.almuerzoHoy === 'NO' || e.almuerzoHoy === 'FUERA');
      }).length;

      $('asisTotal').textContent = total;
      $('asisPresentes').textContent = pres - salieron;
      $('asisAusentes').textContent = ausentes;
      $('asisTardanzas').textContent = tards;
      $('asisSalieron').textContent = salieron;
      if ($('asisSinSalida')) $('asisSinSalida').textContent = sinSalida;
      if ($('asisVisitantes')) $('asisVisitantes').textContent = totalExtrasHoy;
      $('asisAlmuerzoPlanta').textContent = almPlanta;
      $('asisAlmuerzoFuera').textContent = almFuera;
      if ($('asisAlmuerzoPlantaSub')) {
        $('asisAlmuerzoPlantaSub').textContent = totalExtrasHoy > 0 ? `Incluye ${totalExtrasHoy} extras` : '';
      }

      window._asisData = empCache.map(e => {
        let eReg = (e.registros || []).find(r => r.tipo === 'ENTRADA' && r.fecha === hoy);
        let sReg = (e.registros || []).find(r => r.tipo === 'SALIDA' && r.fecha === hoy);

        // Preparar edición para el Admin
        let horaEntradaRaw = e.horaEntrada || eReg?.hora || '-';
        let horaSalidaRaw = e.horaSalida || sReg?.hora || (e.entradaHoy ? 'Pendiente' : '-');

        let clickEntrada = esAdminMaster ? `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'hora', '${horaEntradaRaw}')"` : "";
        let clickSalida = esAdminMaster ? `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'SALIDA', '${sReg?.id || ''}', 'hora', '${horaSalidaRaw}')"` : "";

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
                            <option value="Otro" ${razonAusenciaHoy && !['Vacación','Permiso Médico','Permiso Personal','Calamidad Doméstica','Trabajo de Campo','Salida a Campo','Cumpleaños','Salida Justificada'].includes(razonAusenciaHoy) ? 'selected' : ''}>✏️ Otro...</option>
                        </select>
                    </div>
                  `;
                  if (razonAusenciaHoy && !['Vacación','Permiso Médico','Permiso Personal','Calamidad Doméstica','Trabajo de Campo','Salida a Campo','Cumpleaños','Salida Justificada'].includes(razonAusenciaHoy)) {
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

        // Hacer modo y extras editables para Admin
        let modoHtml = modo;
        let extrasHtml = extras;
        if (esAdminMaster) {
          const clickModo = `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'modo', '${modo}')"`;
          const clickExtras = `onclick="event.stopPropagation();editarValorRegistro('${e.id}', 'ENTRADA', '${eReg?.id || ''}', 'horasExtra', '${extrasVal}')"`;
          modoHtml = `<span class="editable-pill" ${clickModo}>${modo}</span>`;
          extrasHtml = `<span class="editable-pill" ${clickExtras}>${extras}</span>`;
        }

        let toggle = '';
        let puedeEditar = e.entradaHoy || esAdminMaster || isSinAsistencia;

        if (!e.entradaHoy && !isSinAsistencia) {
             toggle = `<span class="pill dim" style="font-size:10px; opacity:0.5; background:transparent; border:none;">Ausente</span>`;
        } else {
             toggle = `<div class="almuerzo-toggle"><button class="toggle-option ${(e.almuerzoHoy === 'SI' || e.almuerzoHoy === 'PLANTA') ? 'active-si' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','SI')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-building"></i> Sí</button><button class="toggle-option ${(e.almuerzoHoy === 'NO' || e.almuerzoHoy === 'FUERA') ? 'active-no' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','NO')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-home"></i> No</button></div>`;
        }

        return { ...e, _eH: eHtml, _sH: sHtml, _est: estHtml, _ausencia: ausenciaHtml, _toggle: toggle, _tard: tard, _entradaHoy: e.entradaHoy, _almuerzoHoy: e.almuerzoHoy, _salidaHoy: e.salidaHoy, _modo: modoHtml, _extras: extrasHtml, id: e.id, isSinAsistencia };
      });
      
      let extrasHoyTb = (window.almuerzosExtra || []).filter(ae => normalizarFechaStr(ae.fecha) === hoy);
      extrasHoyTb.forEach((extra, idx) => {
         window._asisData.push({
            id: `extra_${idx}`,
            nombre: `Visitante/Extra (${extra.observaciones || 'Sin detalle'})`,
            area: 'Visita/Extra',
            foto_url: '',
            _eH: `<span class="pill dim" style="opacity:0.5; font-size:10px;">--:--</span>`,
            _sH: `<span class="pill dim" style="opacity:0.5; font-size:10px;">--:--</span>`,
            _modo: `<span class="pill dim" style="opacity:0.5; font-size:10px;">N/A</span>`,
            _extras: `<span class="pill dim" style="opacity:0.5; font-size:10px;">N/A</span>`,
            _est: `<span class="pill" style="background:#f3f4f6; color:#6b7280; font-size:10px; border:1px dashed #cbd5e1;"><i class="fas fa-id-badge"></i> Visitante</span>`,
            _ausencia: `<span class="pill dim" style="opacity:0.5; font-size:10px;">—</span>`,
            _toggle: `<span class="pill" style="background:#dbeafe; color:#1e40af; font-size:11px; font-weight:600;"><i class="fas fa-building" style="margin-right:4px;"></i> +${extra.cantidad} Extra(s)</span>`,
            _entradaHoy: false,
            _salidaHoy: false,
            _tard: false,
            _almuerzoHoy: 'SI',
            isVisitante: true
         });
      });

      filtrarAsistenciaTabla();
    }



    function setFiltroAsistencia(filtro) {
      filtroAsistenciaActual = filtro;
      filtrarAsistenciaTabla();
    }

    function filtrarAsistenciaTabla() {
      document.querySelectorAll('.kpi-card[data-filter]').forEach(btn => {
        if (btn.getAttribute('data-filter') === filtroAsistenciaActual) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      let q = ($('searchAsistencia')?.value || '').toLowerCase();
      let data = (window._asisData || []).filter(e => {
        if (q && !e.nombre.toLowerCase().includes(q) && !(e.area || '').toLowerCase().includes(q) && !(e.id || '').includes(q)) return false;
        if (filtroAsistenciaActual === 'presente' && (!e._entradaHoy || e._salidaHoy)) return false;
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
      // Mantener orden alfabético
      data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
      if (!data.length) {
        $('asistenciaTablaContainer').innerHTML = '<div class="empty-state"><i class="fas fa-users-slash"></i><p>No hay empleados que coincidan con el filtro</p></div>';
        return;
      }

      let totalVisible = data.length;
      let countEntradas = data.filter(e => e._entradaHoy).length;
      let countSalidas = data.filter(e => e._salidaHoy).length;
      let countAlmPlanta = data.filter(e => {
        const esPresenteOAlm = e._entradaHoy || e.isSinAsistencia;
        return esPresenteOAlm && (e._almuerzoHoy === 'SI' || e._almuerzoHoy === 'PLANTA');
      }).length;
      let countCampo = data.filter(e => {
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
          body: e => `<td><div class="employee-cell">${photoCell(e)}<strong>${escapeHtml(e.nombre)}</strong></div></td>`,
          footer: `<td><strong>TOTALES (${totalVisible})</strong></td>`
        },
        'Área': {
          header: `<th>Área</th>`,
          body: e => `<td>${escapeHtml(e.area || '—')}</td>`,
          footer: `<td>—</td>`
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
          footer: `<td>${countCampo} Campo</td>`
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
        return `<tr onclick="mostrarDetalle('${e.id}')">${cellsHtml}</tr>`;
      }).join('');

      let footerCellsHtml = activeCols.map(c => colDefs[c].footer).join('');
      let footerHtml = `<tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid var(--g300); position:sticky; bottom:0; z-index:10;">${footerCellsHtml}</tr>`;

      html += `</tbody><tfoot>${footerHtml}</tfoot></table>`;
      $('asistenciaTablaContainer').innerHTML = html;
    }
    
    window.guardarRazonAusenciaGlobal = async function(empleadoId, valorSeleccionado) {
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
      }
    };

    window.guardarRazonAusenciaFecha = async function(empleadoId, fecha, valorSeleccionado) {
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch(e) {}
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

    window.toggleTodasLasColumnas = function(checked) {
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
      if (!periodo || !empCache.length) return;

      const hoyRep = getLocalHoyStr();
      const fechaInicio = $('filtroFechaReportesInicio')?.value;
      const fechaFin = $('filtroFechaReportesFinalizacion')?.value;
      const R_INI = fechaInicio ? fechaInicio : periodo.inicio;
      const R_FIN = fechaFin ? fechaFin : periodo.fin;

      let stats = empCache.map(e => {
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
          const isJustificado = regsDia.some(r =>
            r.justificado === 'SI' ||
            ['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Feriado', 'Sábado/Domingo', 'Salida Justificada'].includes(r.razon_ausencia)
          );

          if (regsDia.length === 0) {
            if (!esFestivo && diasLaborables.includes(fecha)) {
              totalTiempoPorJustificar += 480;
            }
            return;
          }

          let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO');
          let atrasoMinsHoy = 0;
          if (primerReg && String(primerReg.tipo || '').toUpperCase() === 'ENTRADA') {
            let mE = obtenerMinutos(primerReg.hora);
            let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
            if (mE !== null && mE > refEntrada + 5) {
              atrasoMinsHoy = mE - refEntrada;
            }
          }

          let periodosDia = [];
          let entradaPendiente = null;
          let ultimoSalidaMins = null;
          let ultimoSalidaReg = null;

          let sortedRegs = [...regsDia].sort((a, b) => {
            const timeA = a.hora;
            const timeB = b.hora;
            return String(timeA).localeCompare(String(timeB));
          });

          let processedLunchGap1 = false;
          sortedRegs.forEach(r => {
            const tipo = String(r.tipo || '').toUpperCase();
            if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
              let mE = obtenerMinutos(r.hora);
              if (ultimoSalidaMins !== null && mE !== null && mE > ultimoSalidaMins) {
                let gap = mE - ultimoSalidaMins;
                if (!processedLunchGap1 && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
                  let lunchMins = Math.min(45, gap);
                  gap -= lunchMins;
                  processedLunchGap1 = true;
                }
                if (gap > 0) {
                  let clasif = clasificarGap(ultimoSalidaReg, gap);
                  if (clasif.tipo === 'medico') {
                    totalTiempoMedico += gap;
                  } else if (clasif.tipo === 'personal') {
                    totalTiempoPersonal += gap;
                  } else {
                    if (!isJustificado) {
                      totalTiempoPorJustificar += gap;
                    }
                  }
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
          let dayPersonal = 0;
          let dayMedico = 0;
          let dayJustificar = 0;

          const hasCumpleanos = regsDia.some(r => r.razon_ausencia === 'Cumpleaños');
          if (hasCumpleanos) dayPersonal += 240;

          ultimoSalidaMins = null;
          ultimoSalidaReg = null;

          let processedLunchGap2 = false;
          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
            let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
            if (mE === null || mS === null || mS <= mE) return;
            let duracion = mS - mE;
            minutosTrabajadosHoy += duracion;

            if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
              let gap = mE - ultimoSalidaMins;
              if (!processedLunchGap2 && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
                let lunchMins = Math.min(45, gap);
                gap -= lunchMins;
                processedLunchGap2 = true;
              }
              if (gap > 0) {
                let clasif = clasificarGap(ultimoSalidaReg, gap);
                if (clasif.tipo === 'medico') dayMedico += gap;
                else if (clasif.tipo === 'personal') dayPersonal += gap;
                else dayJustificar += gap;
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
          let extraMins100Acum = 0;
          let shiftMins = 0;

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
            // Ya calculados directamente en el loop anterior
          } else {
            horasExtra50 += extraMins50Acum;
          }
          const entradaDia = regsDia.find(r => r.tipo === 'ENTRADA');
          const persMins  = (entradaDia && entradaDia.permiso_personal_mins) ? Number(entradaDia.permiso_personal_mins) : 0;
          const medMins   = (entradaDia && entradaDia.permiso_medico_mins)   ? Number(entradaDia.permiso_medico_mins)   : 0;

          if (!isJustificado) {
            let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
            totalTiempoPersonal += persMins;
            totalTiempoMedico   += medMins;
            let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar + persMins + medMins;
            let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
            totalTiempoPorJustificar += unaccountedMissing;
          } else {
            totalTiempoPersonal += persMins;
            totalTiempoMedico   += medMins;
          }

          // Ajustar atrasos del día descontando permisos del día
          if (atrasoMinsHoy > 0) {
            const permisoTotalHoy = (dayPersonal + persMins) + (dayMedico + medMins);
            const adjustedAtrasoHoy = Math.max(0, atrasoMinsHoy - permisoTotalHoy);
            if (adjustedAtrasoHoy > 0) {
              atrasos++;
              minutosAtrasos += adjustedAtrasoHoy;
            }
          }
        });

        puntualidad = diasAsistidos ? Math.round((1 - atrasos / diasAsistidos) * 100) : 0;

        return {
          id: e.id,
          nombre: e.nombre,
          area: e.area,
          asistencias: diasAsistidos,
          faltas: faltas,
          permisoMedico: totalTiempoMedico,
          permisoPersonal: totalTiempoPersonal,
          tiempoPorJustificar: totalTiempoPorJustificar,
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
      let extrasPeriodo = (window.almuerzosExtra || []).filter(ae => {
        let fNorm = normalizarFechaStr(ae.fecha);
        return fNorm >= R_INI && fNorm <= R_FIN;
      });
      let totalAlmExt = extrasPeriodo.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
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

    window.cargarReportesConFiltroFecha = function() {
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

    window.limpiarFiltroRangoFechasReportes = function() {
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

    window.filtrarReportePorRangoFechas = function() {
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

    window.syncPeriodo = function(source) {
      if (source === 'dash') {
        const val = $('periodoMensualDash')?.value;
        const selRep = $('periodoMensual');
        if (selRep && val !== undefined) {
          selRep.value = val;
        }
      } else {
        const val = $('periodoMensual')?.value;
        const selDash = $('periodoMensualDash');
        if (selDash && val !== undefined) {
          selDash.value = val;
        }
      }
      cargarResumenMensual();
    };

    window.syncFecha = function(source) {
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

    window.limpiarFiltroFechaDashboard = function() {
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
    function volverAAsistencia() { cambiarPanel('asistencia'); cargarAsistencia(); }

    // ============================================================
    // DETALLE
    // ============================================================
    function mostrarDetalle(id, indexPeriodo = 0, customInicio = null, customFin = null) {
      const ADMIN_ID = "1058";
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }

      // Definir esAdminMaster de forma global para los closures si es necesario, 
      // pero aquí lo usaremos dentro de mostrarDetalle.
      const esAdminMaster = (String(sessionData.id) === ADMIN_ID);
      window.esAdminMaster = esAdminMaster; // Asegurarlo en el scope global por si acaso lo llaman desde onclicks dinámicos

      let e = empCache.find(x => x.id === id);
      if (!e) return;
      
      // Obtener el período seleccionado o el actual por defecto
      let periodoSeleccionado = periodos[indexPeriodo] || periodos[0];
      
      let R_INI = customInicio || (periodoSeleccionado ? periodoSeleccionado.inicio : '');
      let R_FIN = customFin || (periodoSeleccionado ? periodoSeleccionado.fin : '');

      // Filtrar registros al rango seleccionado
      let todosRegs = e.registros || [];
      let regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN)
                          .sort((a, b) => b.fecha.localeCompare(a.fecha));

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

      let porDia = {};
      // Asegurar que los registros estén ordenados cronológicamente para el emparejamiento
      [...regs].sort((a, b) => {
        const timeA = a.hora;
        const timeB = b.hora;
        return String(timeA).localeCompare(String(timeB));
      }).forEach(r => {
        // Normalizar la fecha a YYYY-MM-DD para evitar fechas mal formateadas de Sheets
        const fechaNorm = normalizarFechaStr(r.fecha);
        if (!fechaNorm) return;
        if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
        porDia[fechaNorm].registros.push(r);
        if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
      });

      // Ordenar de más reciente a más antiguo (YYYY-MM-DD → comparación de string correcta)
      let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => b.localeCompare(a));

      // Mostrar todos los días del período
      // Acumuladores para la fila de totales
      let totTP = 0, totTM = 0, totTJ = 0, totHoras = 0, totAtrasos = 0;
      let totH50 = 0, totH100 = 0, totHCN = 0, totHC50 = 0, totHC100 = 0;
      let totExtra50 = 0, totExtra100 = 0;
      let totEmpresa = 0, totCampo = 0, totSalidaTemprana = 0; // NUEVO
      const esSuperPermiso = ['7','1058'].includes(String(sessionData.id || ''));

      let filas = fechasOrdenadas.map(f => {
        let d = porDia[f];
        let regsDia = d.registros;
        const dayOfWeek = new Date(f + 'T12:00:00').getDay();
        const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
        const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
        const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

        const isJustificado = regsDia.some(r =>
          r.justificado === 'SI' ||
          esAusenciaTipo(r.tipo) ||
          ['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Feriado', 'Sábado/Domingo', 'Salida Justificada'].includes(r.razon_ausencia)
        );

        const tieneAsistencia = regsDia.some(r => ['ENTRADA', 'SALIDA', 'RETORNO_CAMPO', 'SALIDA_CAMPO'].includes(String(r.tipo || '').toUpperCase()));
        const esFalta = regsDia.some(r => esAusenciaTipo(r.tipo)) || !tieneAsistencia;

        let periodosDia = [];
        let entradaPendiente = null;
        let minutosPermisoHoy = 0;
        let ultimoSalidaMins = null, ultimoSalidaReg = null;

        regsDia.forEach(r => {
          const tipo = String(r.tipo || '').toUpperCase();
          if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
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
          if (esAdminMaster && p.entrada) {
            const tsVal = formatearTimestampCompleto(p.entrada.timestamp);
            return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.entrada.tipo}', '${p.entrada.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-edit-tiny" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.entrada.tipo}', '${p.entrada.id}', 'timestamp', '${tsVal}', '${f}')" title="Editar timestamp completo (actualiza fecha y hora)"><i class="fas fa-clock"></i></button><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.entrada.id}', '${e.id}', '${f}', '${p.entrada.tipo}')"><i class="fas fa-trash"></i></button></div>`;
          }
          if (esAdminMaster && !p.entrada) {
            let defEntStr = esFestivo ? '07:00:00' : '07:30:00';
            let defEntLbl = esFestivo ? '07:00' : '07:30';
            return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'ENTRADA', '${defEntStr}', '${f}')"><i class="fas fa-plus"></i> ${defEntLbl}</button>`;
          }
          return valor;
        }).join('<br>');

        let horaS = periodosDia.map(p => {
          const valor = p.salida ? formatearHora(p.salida.hora || p.salida.timestamp) : '--:--';
          if (esAdminMaster && p.salida) {
            const tsVal = formatearTimestampCompleto(p.salida.timestamp);
            return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.salida.tipo}', '${p.salida.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-edit-tiny" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.salida.tipo}', '${p.salida.id}', 'timestamp', '${tsVal}', '${f}')" title="Editar timestamp completo (actualiza fecha y hora)"><i class="fas fa-clock"></i></button><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.salida.id}', '${e.id}', '${f}', '${p.salida.tipo}')"><i class="fas fa-trash"></i></button></div>`;
          }
          if (esAdminMaster && !p.salida) {
            let defSalStr = esFestivo ? '15:00:00' : '16:15:00';
            let defSalLbl = esFestivo ? '15:00' : '16:15';
            return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'SALIDA', '${defSalStr}', '${f}')"><i class="fas fa-plus"></i> ${defSalLbl}</button>`;
          }
          return valor;
        }).join('<br>');

        let aBadge = (d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? '<span class="pill ok">🏢 Sí</span>' : (d.almuerzo === 'NO' || d.almuerzo === 'FUERA') ? '<span class="pill" style="background:#dbeafe; color:#1e40af;">🏠 No</span>' : '<span class="pill dim">❓ —</span>';
        if (esAdminMaster && !esFalta) {
          aBadge = `<span class="editable-pill" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}', '${(d.almuerzo === 'SI' || d.almuerzo === 'PLANTA') ? 'NO' : 'SI'}', '${f}')">${aBadge}</span>`;
        }

        let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO');
        let atrasoMins = 0;
        if (primerReg && String(primerReg.tipo || '').toUpperCase() === 'ENTRADA') {
          let mE = obtenerMinutos(primerReg.hora);
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
        if (dayOfWeek === 0)      razonDia = '🅢 Domingo';
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
          <select onchange="window.guardarRazonAusenciaFecha('${e.id}', '${f}', this.value)" ${(!esSuperPermiso || !esFalta) ? 'disabled' : ''} style="font-size:10px; border:1px solid #d1d5db; border-radius:6px; padding:2px 4px; background:#f8fafc; cursor:pointer; width:110px;">
            <option value="">-- Sin Razón --</option>
            <option value="Vacación" ${razonAusenciaVal === 'Vacación' || razonAusenciaVal === 'Vacacion' ? 'selected' : ''}>🏖️ Vacación</option>
            <option value="Permiso Médico" ${razonAusenciaVal === 'Permiso Médico' ? 'selected' : ''}>🩺 Permiso Médico</option>
            <option value="Permiso Personal" ${razonAusenciaVal === 'Permiso Personal' ? 'selected' : ''}>👤 Permiso Personal</option>
            <option value="Calamidad Doméstica" ${razonAusenciaVal === 'Calamidad Doméstica' ? 'selected' : ''}>🏠 Calamidad Dom.</option>
            <option value="Salida a Campo" ${razonAusenciaVal === 'Salida a Campo' || razonAusenciaVal === 'Trabajo de Campo' ? 'selected' : ''}>🚗 Salida a Campo</option>
            <option value="Cumpleaños" ${razonAusenciaVal === 'Cumpleaños' ? 'selected' : ''}>🎂 Cumpleaños</option>
            <option value="Salida Justificada" ${razonAusenciaVal === 'Salida Justificada' ? 'selected' : ''}>✅ Salida Justificada</option>
            <option value="Otro" ${razonAusenciaVal && !['Vacación','Vacacion','Permiso Médico','Permiso Personal','Calamidad Doméstica','Trabajo de Campo','Salida a Campo','Cumpleaños','Salida Justificada'].includes(razonAusenciaVal) ? 'selected' : ''}>✏️ Otro...</option>
          </select>
        `;
        if (razonAusenciaVal && !['Vacación','Vacacion','Permiso Médico','Permiso Personal','Calamidad Doméstica','Trabajo de Campo','Salida a Campo','Cumpleaños','Salida Justificada'].includes(razonAusenciaVal)) {
            selectRazonHtml += `<div style="font-size:9px; color:var(--indigo); margin-top:2px; font-weight:700;">${escapeHtml(razonAusenciaVal)}</div>`;
        } else if (razonJustificadaVal) {
            selectRazonHtml += `<div style="font-size:9px; color:var(--green); margin-top:2px; font-weight:700;">Justif: ${escapeHtml(razonJustificadaVal)}</div>`;
        }

        let rowStyle = "";
        let badgeDia = "";
        if (dayOfWeek === 0) {
          rowStyle = "background-color: rgba(239, 68, 68, 0.04);";
          badgeDia = `<span class="pill miss" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">DOMINGO</span>`;
        } else if (dayOfWeek === 6) {
          rowStyle = "background-color: rgba(59, 130, 246, 0.04);";
          badgeDia = `<span class="pill" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; background: #dbeafe; color: #1e40af; font-weight: 700;">SÁBADO</span>`;
        } else if (esFeriadoODomingo(f)) {
          rowStyle = "background-color: rgba(245, 158, 11, 0.04);";
          badgeDia = `<span class="pill late" style="font-size: 9px; padding: 1px 6px; margin-top: 4px; display: inline-block; font-weight: 700;">FERIADO</span>`;
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

        const hasCumpleanos = regsDia.some(r => r.razon_ausencia === 'Cumpleaños');
        if (hasCumpleanos) tiempoPersonal += 240;
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

        // Descontar almuerzo si superó 4 horas (solo en días normales)
        let netWorked = minutosTrabajadosHoy;
        if (!esFestivo && netWorked > 240) {
          netWorked -= 45;
          if (minsEmpresa > 240) minsEmpresa -= 45;
          else if (minsCampo > 240) minsCampo -= 45;
        }
        minsEmpresa = Math.max(0, minsEmpresa);
        minsCampo = Math.max(0, minsCampo);
        
        let minsSalidaTemprana = 0;
        if (!esFestivo && ultimoSalidaMins !== null && ultimoSalidaMins < 975) {
          const hasSalidaTemprana = regsDia.some(r => {
            const val = r.tipo_salida || r.tipo || '';
            return val.includes('SALIDA_TEMPRANA');
          });
          if (hasSalidaTemprana || ultimoSalidaMins < 975) {
            minsSalidaTemprana = 975 - ultimoSalidaMins;
          }
        }

        // Auto-autorización de horas extras
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
        if (esAdminMaster && regsDia.length > 0 && !esFalta) {
          extBadgeHtml = `<span class="editable-pill" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${regsDia[0].tipo}', '${regsDia[0].id}', 'horasExtra', '${extBadgeVal}', '${f}')">${extBadge}</span>`;
        }

        let extraMins50Acum = 0;
        let extraMins100Acum = 0;
        let shiftMins = 0;

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
              // Normal (no campo) - Horas extra solo después de las 16:15
              if (autorizadoGlobal && mS > H_FIN) {
                extraMins50Acum += (mS - Math.max(mE, H_FIN));
              }
            }
          }
        });

        if (esFestivo) {
          // Ya calculados directamente en el loop anterior
        } else {
          h50 = extraMins50Acum;
        }

        if (isJustificado) {
          tiempoPorJustificar = 0;
        } else {
          // Sumar minutos de permiso asignados manualmente por supervisor
          const entradaDia = regsDia.find(r => r.tipo === 'ENTRADA');
          const persMins = (entradaDia && entradaDia.permiso_personal_mins) ? Number(entradaDia.permiso_personal_mins) : 0;
          const medMins  = (entradaDia && entradaDia.permiso_medico_mins)   ? Number(entradaDia.permiso_medico_mins)   : 0;
          tiempoPersonal += persMins;
          tiempoMedico   += medMins;
          let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
          let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoPorJustificar;
          let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
          tiempoPorJustificar += unaccountedMissing;
        }

        // Ajustar atrasos descontando los permisos del día (tiempo personal y médico)
        const originalAtrasoMins = atrasoMins;
        atrasoMins = Math.max(0, originalAtrasoMins - tiempoPersonal - tiempoMedico);

        // Sumar tiempo personal y médico a TOTAL HRS (netWorked)
        netWorked += (tiempoPersonal + tiempoMedico);

        // MODALIDAD — editable inline para supervisores autorizados
        const todosRegsConModo = regsDia.filter(r => r.modo);
        const tieneCampo   = todosRegsConModo.some(r => r.modo === 'CAMPO');
        const tieneEmpresa = todosRegsConModo.some(r => r.modo === 'EMPRESA' || r.modo === 'OFICINA');
        const modActual = tieneCampo && tieneEmpresa ? 'MIXTO' : tieneCampo ? 'CAMPO' : 'EMPRESA';

        let modalidadCell;
        if (esSuperPermiso && !esFalta) {
          modalidadCell = `<select data-emp="${e.id}" data-fecha="${f}" onchange="guardarPermiso('${e.id}','${f}','modalidad',this.value)" style="font-size:10px;border:1px solid #d1d5db;border-radius:6px;padding:2px 4px;background:#f8fafc;cursor:pointer;">
            <option value="EMPRESA" ${modActual==='EMPRESA'?'selected':''}>🏢 Empresa</option>
            <option value="CAMPO"   ${modActual==='CAMPO'?'selected':''}>🏗️ Campo</option>
            <option value="MIXTO"   ${modActual==='MIXTO'?'selected':''}>🔀 Mixto</option>
          </select>`;
        } else {
          const mIcon = modActual==='CAMPO' ? '🏗️' : modActual==='MIXTO' ? '🔀' : '🏢';
          modalidadCell = `<span style="font-size:10px;">${mIcon} ${modActual}</span>`;
        }

        // T.PERSONAL / T.MEDICO — celda inline editable
        // ponytail: click convierte el texto en <input>, Enter/blur llama guardarPermiso
        function celdaTiempo(tipo, mins, empId, fecha) {
          const display = mins > 0 ? minutosAHHMMSS(mins) : '—';
          const color = tipo === 'personal' ? 'var(--indigo)' : 'var(--teal)';
          if (!esSuperPermiso || esFalta) return `<span style="color:${color};">${display}</span>`;
          const uid = `cel_${tipo}_${empId}_${fecha.replace(/-/g,'')}`;
          return `<span id="${uid}" style="color:${color};cursor:pointer;border-bottom:1px dashed ${color};" title="Clic para editar" onclick="editarCeldaTiempo('${uid}','${empId}','${fecha}','${tipo}',${mins})">${display}</span>`;
        }

        const celTP = celdaTiempo('personal', tiempoPersonal, e.id, f);
        const celTM = celdaTiempo('medico',   tiempoMedico,   e.id, f);

        let btnPermisoHtml = '';


        // Acumular totales
        totTP     += tiempoPersonal;
        totTM     += tiempoMedico;
        totTJ     += tiempoPorJustificar;
        totHoras  += netWorked;
        totAtrasos+= atrasoMins;
        totEmpresa+= minsEmpresa;
        totCampo  += minsCampo;
        totSalidaTemprana += minsSalidaTemprana;
        totH50    += h50;   totH100   += h100;
        totHCN    += hCN;   totHC50   += hC50;   totHC100  += hC100;
        totExtra50  += (h50 + hC50);
        totExtra100 += (h100 + hC100);

        return `<tr style="${rowStyle}">
      <td style="white-space:nowrap; font-weight:600; font-size:11px; padding:3px 5px;">${fechaFormateada}</td>
      <td style="font-size:11px; padding:3px 4px; text-align:center;">${modalidadCell}</td>
      <td class="hora-cell" style="font-size:11px;padding:3px 4px;">${horaE}</td>
      <td class="hora-cell" style="font-size:11px;padding:3px 4px;">${horaS}</td>
      <td style="font-size:11px; padding:3px 4px;">${selectRazonHtml}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${celTP}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${celTM}</td>
      <td style="text-align:center; color:var(--red); font-size:11px; padding:3px 4px;">${tiempoPorJustificar > 0 ? minutosAHHMMSS(tiempoPorJustificar) : '—'}</td>
      <td style="text-align:center; color:var(--green); font-weight:600; font-size:11px; padding:3px 4px;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
      <td style="font-size:11px;padding:3px 4px;">${aBadge}</td>
      <td style="font-size:11px;padding:3px 4px;">${extBadgeHtml}</td>
      <td style="text-align:center; color:${atrasoMins > 0 ? 'var(--red)' : 'inherit'}; font-size:11px; padding:3px 4px;">${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
      <td style="text-align:center; color:var(--red); font-size:11px; padding:3px 4px;">${minsSalidaTemprana > 0 ? minutosAHHMMSS(minsSalidaTemprana) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${h50 > 0 ? minutosAHHMMSS(h50) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${h100 > 0 ? minutosAHHMMSS(h100) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${hCN > 0 ? minutosAHHMMSS(hCN) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${hC50 > 0 ? minutosAHHMMSS(hC50) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;">${hC100 > 0 ? minutosAHHMMSS(hC100) : '—'}</td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;"><strong>${(h50+hC50) > 0 ? minutosAHHMMSS(h50+hC50) : '—'}</strong></td>
      <td style="text-align:center; font-size:11px; padding:3px 4px;"><strong>${(h100+hC100) > 0 ? minutosAHHMMSS(h100+hC100) : '—'}</strong></td>
    </tr>`;
      }).join('');

      let thH = Math.floor(totHoras / 60) || 0,
        thM = totHoras % 60 || 0,
        thS = 0;

      let tpH = Math.floor((totTP + totTM) / 60) || 0,
        tpM = (totTP + totTM) % 60 || 0;

      // Fila de totales para el tfoot
      const mA = v => v > 0 ? `<strong>${minutosAHHMMSS(v)}</strong>` : '—';
      const tfootRow = `<tr style="background:var(--g50);border-top:2px solid var(--g300);font-weight:700;font-size:11px;">
        <td style="padding:4px 5px;">TOTALES</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td style="text-align:center;color:var(--indigo);">${mA(totTP)}</td>
        <td style="text-align:center;color:var(--teal);">${mA(totTM)}</td>
        <td style="text-align:center;color:var(--red);">${mA(totTJ)}</td>
        <td style="text-align:center;color:var(--green);">${mA(totHoras)}</td>
        <td></td>
        <td></td>
        <td style="text-align:center;color:var(--red);">${mA(totAtrasos)}</td>
        <td style="text-align:center;color:var(--red);">${mA(totSalidaTemprana)}</td>
        <td style="text-align:center;">${mA(totH50)}</td>
        <td style="text-align:center;">${mA(totH100)}</td>
        <td style="text-align:center;">${mA(totHCN)}</td>
        <td style="text-align:center;">${mA(totHC50)}</td>
        <td style="text-align:center;">${mA(totHC100)}</td>
        <td style="text-align:center;">${mA(totExtra50)}</td>
        <td style="text-align:center;">${mA(totExtra100)}</td>
      </tr>`;
      let puntualidadVal = dias ? Math.max(0, Math.round((1 - tardT / dias) * 100)) : 100;
      let puntualidadColor = puntualidadVal >= 90 ? 'var(--green)' : puntualidadVal >= 70 ? 'var(--amber)' : 'var(--red)';
      let optionsPeriodos = periodos.map((p, i) => `<option value="${i}" ${i === indexPeriodo ? 'selected' : ''}>${p.label}</option>`).join('');

      $('detalleContent').innerHTML = `
    <div class="detail-view">
      <div class="detail-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; gap:16px; align-items:center;">
          <div class="detail-photo-container" ${esAdminMaster ? `onclick="triggerPhotoUpload('${e.id}')" title="Subir nueva foto"` : ''}>
            ${photoCell(e, 'large')}
            ${esAdminMaster ? `<div class="photo-upload-overlay"><i class="fas fa-camera"></i></div>` : ''}
          </div>
          <div class="detail-info">
            <div class="detail-name" ${esAdminMaster ? `style="cursor:pointer" onclick="editarMetaEmpleado('${e.id}', 'nombre', '${e.nombre}')"` : ''}>${escapeHtml(e.nombre)}</div>
            <div class="detail-meta">
              <span ${esAdminMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'id', '${e.id}')"` : ''}><i class="fas fa-id-card"></i> ${escapeHtml(e.id)}</span>
              <span ${esAdminMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'area', '${e.area || ''}')"` : ''}><i class="fas fa-building"></i> ${escapeHtml(e.area || 'Sin área')}</span>
              <span ${esAdminMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'id_dispositivo', '${e.id_dispositivo || ''}')" title="Editar enlace de Rol de Pagos"` : ''}><i class="fas fa-file-invoice-dollar"></i> ${e.id_dispositivo ? 'Con Rol' : 'Sin Rol'}</span>
              ${tardT > 0 ? `<span class="pill late" style="margin-left:8px"><i class="fas fa-clock"></i> ${tardT} tardanzas</span>` : '<span class="pill ok" style="margin-left:8px"><i class="fas fa-check-circle"></i> Puntual</span>'}
            </div>
          </div>
        </div>
        <div class="periodo-selector" style="background:var(--white); padding:8px 16px; border-radius:8px; border:1px solid var(--g200); box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center;">
            <label style="font-size:12px; font-weight:600; color:var(--g600); margin-right:8px;"><i class="fas fa-calendar-alt"></i> Período:</label>
            <select id="filtroPeriodoDetalle" class="filter-select" onchange="mostrarDetalle('${e.id}', parseInt(this.value))" style="font-size:13px; font-weight:500;">
              ${optionsPeriodos}
            </select>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; font-weight:600; color:var(--g600);">Desde:</label>
            <input type="date" id="detFechaInicio" value="${R_INI}" onchange="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value), this.value, $('detFechaFin').value)" style="border:1px solid var(--g200); border-radius:6px; padding:2px 6px; font-size:12px; font-family:inherit;">
            <label style="font-size:12px; font-weight:600; color:var(--g600);">Hasta:</label>
            <input type="date" id="detFechaFin" value="${R_FIN}" onchange="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value), $('detFechaInicio').value, this.value)" style="border:1px solid var(--g200); border-radius:6px; padding:2px 6px; font-size:12px; font-family:inherit;">
            <button class="btn btn-secondary" onclick="mostrarDetalle('${e.id}', parseInt($('filtroPeriodoDetalle').value))" title="Restablecer al rango por defecto del período" style="font-size:11px; padding:3px 8px; height:auto; display:inline-flex; align-items:center; gap:4px; border:1px solid var(--g300); background:#f8fafc; color:var(--g600); border-radius:6px; cursor:pointer;">
              <i class="fas fa-sync-alt"></i> Restablecer
            </button>
          </div>
        </div>
      </div>
      
      <div style="padding:var(--pad);background:var(--g50);border-bottom:1px solid var(--g200)">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(290px, 1fr)); gap:16px; width:100%;">
          
          <!-- RESUMEN ASISTENCIA -->
          <div style="background:var(--white); border:1px solid var(--g200); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px;">
            <div style="font-size:11.5px; font-weight:700; color:var(--g600); border-bottom:1px solid var(--g100); padding-bottom:6px; display:flex; align-items:center; gap:6px; text-transform:uppercase;">
              <i class="fas fa-calendar-check" style="color:var(--blue);"></i> Resumen de Asistencia
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px;">
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Días Trab.</div>
                <div style="font-size:16px; font-weight:800; color:var(--g800);">${dias}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Puntualidad</div>
                <div style="font-size:16px; font-weight:800; color:${puntualidadColor};">${puntualidadVal}%</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Prom. Entrada</div>
                <div style="font-size:13px; font-weight:700; color:var(--g700);">${minsToHHMM(pE)}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Prom. Salida</div>
                <div style="font-size:13px; font-weight:700; color:var(--g700);">${minsToHHMM(pS)}</div>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--g500); padding:2px 4px; border-top:1px solid var(--g50); pt:4px;">
              <span>Entradas: <strong>${entT}</strong></span>
              <span>Salidas: <strong>${salT}</strong></span>
            </div>
          </div>

          <!-- JORNADA Y TIEMPOS -->
          <div style="background:var(--white); border:1px solid var(--g200); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px;">
            <div style="font-size:11.5px; font-weight:700; color:var(--g600); border-bottom:1px solid var(--g100); padding-bottom:6px; display:flex; align-items:center; gap:6px; text-transform:uppercase;">
              <i class="fas fa-clock" style="color:var(--green);"></i> Jornada y Tiempos
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; height:100%;">
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center; display:flex; flex-direction:column; justify-content:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Total Horas</div>
                <div style="font-size:16px; font-weight:800; color:var(--green);">${String(thH).padStart(2, '0')}:${String(thM).padStart(2, '0')}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center; display:flex; flex-direction:column; justify-content:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Atrasos Acum.</div>
                <div style="font-size:16px; font-weight:800; color:${totAtrasos > 0 ? 'var(--red)' : 'var(--g800)'};">${minutosAHHMMSS(totAtrasos)}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center; display:flex; flex-direction:column; justify-content:center; grid-column:span 2;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Tiempo por Justificar</div>
                <div style="font-size:16px; font-weight:800; color:${totTJ > 0 ? 'var(--red)' : 'var(--green)'};">${minutosAHHMMSS(totTJ)}</div>
              </div>
            </div>
          </div>

          <!-- PERMISOS Y ALMUERZOS -->
          <div style="background:var(--white); border:1px solid var(--g200); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px;">
            <div style="font-size:11.5px; font-weight:700; color:var(--g600); border-bottom:1px solid var(--g100); padding-bottom:6px; display:flex; align-items:center; gap:6px; text-transform:uppercase;">
              <i class="fas fa-hand-holding-heart" style="color:var(--indigo);"></i> Permisos y Almuerzos
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px;">
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">T. Personal</div>
                <div style="font-size:14px; font-weight:800; color:var(--indigo);">${minutosAHHMMSS(totTP)}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">T. Médico</div>
                <div style="font-size:14px; font-weight:800; color:var(--teal);">${minutosAHHMMSS(totTM)}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Alm. Planta</div>
                <div style="font-size:14px; font-weight:800; color:var(--purple);">${almP}</div>
              </div>
              <div style="background:var(--g50); padding:6px 8px; border-radius:8px; text-align:center;">
                <div style="font-size:9.5px; color:var(--g500); font-weight:600; text-transform:uppercase; margin-bottom:2px;">Alm. Fuera</div>
                <div style="font-size:14px; font-weight:800; color:var(--g600);">${almF}</div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
      <div style="padding:var(--pad)">
        <div class="metric-title" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span><i class="fas fa-history"></i> Historial del período</span>
            <button class="btn btn-success" onclick="exportarExcelDetalleEmpleado('${e.id}', ${indexPeriodo}, '${R_INI}', '${R_FIN}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px;">
              <i class="fas fa-file-excel"></i> Exportar Excel
            </button>
            <button class="btn btn-primary" onclick="window.mostrarModalFuturos('${e.id}')" style="font-size:11px; padding:4px 10px; height:auto; display:inline-flex; align-items:center; gap:6px; background:var(--purple); border-color:var(--purple); color:white; cursor:pointer;">
              <i class="fas fa-calendar-plus"></i> Registrar Evento Futuro
            </button>
          </div>
          <span style="color:var(--indigo);font-weight:600;font-size:13px;background:#e0e7ff;padding:4px 10px;border-radius:12px;">${periodoSeleccionado ? periodoSeleccionado.label : ''}</span>
        </div>
        <div class="table-wrapper">
          <div class="table-scroll-wrap">
            <table class="employee-table table-compact">
              <thead>
                <tr>
                  <th style="font-size:10px;padding:4px 5px;">Fecha</th>
                  <th style="font-size:10px;padding:4px 5px;">Modalidad</th>
                  <th style="font-size:10px;padding:4px 5px;">Entrada</th>
                  <th style="font-size:10px;padding:4px 5px;">Salida</th>
                  <th style="font-size:10px;padding:4px 5px;">Razón</th>
                  <th style="font-size:10px;padding:4px 5px;">T.PERSONAL</th>
                  <th style="font-size:10px;padding:4px 5px;">T.MEDICO</th>
                  <th style="font-size:10px;padding:4px 5px;">T.JUSTIF.</th>
                  <th style="font-size:10px;padding:4px 5px;">TOTAL HRS</th>
                  <th style="font-size:10px;padding:4px 5px;">Alm.</th>
                  <th style="font-size:10px;padding:4px 5px;">H.E.Aut.</th>
                  <th style="font-size:10px;padding:4px 5px;">ATRASOS</th>
                  <th style="font-size:10px;padding:4px 5px;">S. TEMPRANA</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Horas Extra 50%">HE 50% (A)</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Horas Extra 100%">HE 100% (B)</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Horas Campo Normales">HC Norm.</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Horas Campo 50%">HC 50% (C)</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Horas Campo 100%">HC 100% (D)</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Total Extras 50% (A+C)">∑ 50%</th>
                  <th style="font-size:10px;padding:4px 5px;" title="Total Extras 100% (B+D)">∑ 100%</th>
                </tr>
              </thead>
              <tbody>${filas || '<tr><td colspan="19" class="empty-state">Sin registros</td></tr>'}</tbody>
              <tfoot>${tfootRow}</tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>`;
      cambiarPanel('detalle');
    }

    function volverADirectorio() { cambiarPanel('directorio'); cargarDirectorio(); }

    // ============================================================
    // MODAL PERMISO SUPERVISOR
    // ============================================================
    window.abrirModalPermiso = function(empleadoId, fecha, ppActual, pmActual) {
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

    window.guardarPermiso = async function(empleadoId, fecha, tipo, valor) {
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch(e) {}
      const supervisorId = String(sessionData.id || '');

      // Modalidad: valor es 'EMPRESA' | 'CAMPO' | 'MIXTO'
      if (tipo === 'modalidad') {
        try {
          let res;
          if (window.FirebaseBackend && window.FirebaseBackend.guardarModalidadSupervisor) {
            res = await window.FirebaseBackend.guardarModalidadSupervisor({ empleadoId, fecha, modalidad: valor, supervisorId });
          } else {
            // ponytail: Sheets no implementado aún
            res = { ok: false, error: 'Solo disponible en modo Firebase' };
          }
          if (res && res.ok) {
            // Actualizar cache local
            const emp = empCache.find(x => x.id === empleadoId);
            if (emp) (emp.registros || []).filter(r => r.fecha === fecha).forEach(r => r.modo = valor);
            mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
            if (typeof mostrarToast === 'function') mostrarToast(`✅ Modalidad guardada: ${valor}`, 'ok');
          } else {
            if (typeof mostrarToast === 'function') mostrarToast('Error: ' + (res?.error || 'desconocido'), 'error');
          }
        } catch(err) { alert('Error: ' + err.message); }
        return;
      }

      // Tiempo personal / médico
      const mins = parsearInputTiempo(valor);
      if (mins === null || mins < 0) {
        if (typeof mostrarToast === 'function') mostrarToast('⚠️ Valor inválido. Usa: 60, 1h, 1:30', 'warn');
        return;
      }

      const params = { empleadoId, fecha, tipo, mins, supervisorId };
      try {
        let resultado;
        if (window.FirebaseBackend && window.FirebaseBackend.guardarPermisoSupervisor) {
          resultado = await window.FirebaseBackend.guardarPermisoSupervisor(params);
        } else {
          resultado = await new Promise((resolve, reject) => {
            const cb = 'cb_guardarPermiso_' + Date.now();
            const script = document.createElement('script');
            const qs = Object.entries({...params, accion:'guardarPermisoSupervisor', callback:cb})
              .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
            script.src = window.API_URL + '?' + qs;
            script.onerror = () => reject(new Error('Error de red'));
            window[cb] = r => { window[cb] = function(){}; setTimeout(()=>{delete window[cb];},60000); script.remove(); resolve(r); };
            document.body.appendChild(script);
          });
        }
        if (resultado && resultado.ok) {
          const emp = empCache.find(x => x.id === empleadoId);
          if (emp) {
            const reg = (emp.registros || []).find(r => r.fecha === fecha && r.tipo === 'ENTRADA');
            if (reg) {
              if (tipo === 'personal') reg.permiso_personal_mins = mins;
              else                    reg.permiso_medico_mins   = mins;
            }
          }
          mostrarDetalle(empleadoId, parseInt(document.getElementById('filtroPeriodoDetalle')?.value || '0'));
          if (typeof mostrarToast === 'function') mostrarToast(`✅ ${tipo === 'personal' ? 'T.Personal' : 'T.Médico'}: ${mins} min`, 'ok');
        } else {
          if (typeof mostrarToast === 'function') mostrarToast('Error: ' + (resultado?.error || 'desconocido'), 'error');
        }
      } catch(err) { alert('Error de comunicación: ' + err.message); }
    };

    // editarCeldaTiempo: popup modal interactivo para ingresar T.PERSONAL y T.MEDICO con conversor de horas y minutos
    window.editarCeldaTiempo = function(uid, empId, fecha, tipo, minsActual) {
      // Eliminar modal anterior si existe
      const prev = document.getElementById('modalConversorTiempo');
      if (prev) prev.remove();

      const labelTipo = tipo === 'personal' ? 'Tiempo Personal' : 'Tiempo Médico';
      const colorTheme = tipo === 'personal' ? '#6366f1' : '#0d9488';
      const iconTheme = tipo === 'personal' ? 'fa-user' : 'fa-stethoscope';

      const initialHrs = Math.floor(minsActual / 60);
      const initialMins = minsActual % 60;

      const modal = document.createElement('div');
      modal.id = 'modalConversorTiempo';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
        z-index: 10000; display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
      `;

      modal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; animation: modalFadeIn 0.2s ease-out;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="background: ${colorTheme}15; color: ${colorTheme}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;">
                <i class="fas ${iconTheme}"></i>
              </div>
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">${labelTipo}</h3>
                <span style="font-size: 11px; color: #64748b;">${fecha}</span>
              </div>
            </div>
            <button onclick="document.getElementById('modalConversorTiempo').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background 0.2s;" onmouseover="this.style.background='#f1f5f9'; this.style.color='#475569'" onmouseout="this.style.background='none'; this.style.color='#94a3b8'">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div style="margin-bottom: 20px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">Horas</label>
                <input id="convHrs" type="number" min="0" step="any" value="${initialHrs}" placeholder="0" 
                  style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; outline: none; box-sizing: border-box;" 
                  onfocus="this.style.borderColor='${colorTheme}'; this.style.boxShadow='0 0 0 3px ${colorTheme}15'" 
                  onblur="this.style.borderColor='#cbd5e1'; this.style.boxShadow='none'">
              </div>
              <div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 6px;">Minutos</label>
                <input id="convMins" type="number" min="0" value="${initialMins}" placeholder="0" 
                  style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; outline: none; box-sizing: border-box;" 
                  onfocus="this.style.borderColor='${colorTheme}'; this.style.boxShadow='0 0 0 3px ${colorTheme}15'" 
                  onblur="this.style.borderColor='#cbd5e1'; this.style.boxShadow='none'">
              </div>
            </div>

            <div style="margin-bottom: 16px;">
              <span style="display: block; font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 8px;">Accesos Rápidos</span>
              <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                <button onclick="setConvVals(0, 15)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">15m</button>
                <button onclick="setConvVals(0, 30)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">30m</button>
                <button onclick="setConvVals(1, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">1h</button>
                <button onclick="setConvVals(2, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">2h</button>
                <button onclick="setConvVals(4, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">4h</button>
                <button onclick="setConvVals(8, 0)" style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #475569; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='${colorTheme}'; this.style.color='#fff'; this.style.borderColor='${colorTheme}'" onmouseout="this.style.background='#f1f5f9'; this.style.color='#475569'; this.style.borderColor='#e2e8f0'">8h</button>
                <button onclick="setConvVals(0, 0)" style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #ef4444; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#ef4444'; this.style.color='#fff'; this.style.borderColor='#ef4444'" onmouseout="this.style.background='#fef2f2'; this.style.color='#ef4444'; this.style.borderColor='#fee2e2'">Limpiar</button>
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 12px; padding: 12px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 12px; font-weight: 500; color: #64748b;">Total en minutos:</span>
                <span id="previewTotalMins" style="font-size: 15px; font-weight: 700; color: ${colorTheme};">0 min</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #94a3b8;">Formato a registrar:</span>
                <span id="previewFormatted" style="font-size: 12px; font-weight: 600; color: #475569; font-family: monospace;">00:00:00</span>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button onclick="document.getElementById('modalConversorTiempo').remove()" 
              style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">
              Cancelar
            </button>
            <button id="btnSaveConv"
              style="padding: 8px 20px; border-radius: 8px; border: none; background: ${colorTheme}; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              <i class="fas fa-save"></i> Guardar
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Global helper for settings values
      window.setConvVals = function(h, m) {
        document.getElementById('convHrs').value = h;
        document.getElementById('convMins').value = m;
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

        document.getElementById('previewTotalMins').textContent = `${total} min`;
        document.getElementById('previewFormatted').textContent = formatted;
      };

      document.getElementById('convHrs').addEventListener('input', updatePreview);
      document.getElementById('convMins').addEventListener('input', updatePreview);

      updatePreview();

      modal.addEventListener('click', e => {
        if (e.target === modal) modal.remove();
      });

      document.getElementById('btnSaveConv').onclick = () => {
        let hrs = parseFloat(document.getElementById('convHrs').value) || 0;
        let mins = parseInt(document.getElementById('convMins').value) || 0;
        if (hrs < 0) hrs = 0;
        if (mins < 0) mins = 0;
        const total = Math.round(hrs * 60) + mins;

        guardarPermiso(empId, fecha, tipo, total);
        modal.remove();
      };
    };



    // NAVEGACIÓN
    // ============================================================
    function cambiarPanel(panel) {
      panelActual = panel;
      document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.panel === panel));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.id === 'panel-' + panel));
      let titles = { 
        dashboard: 'Dashboard', 
        reportes: 'Reporte Interactivo',
        asistencia: 'Control de Asistencia', 
        detalle: 'Detalle de Empleado',
        opciones: 'Opciones adicionales',
        emergencias: 'Simulacros y Emergencias'
      };
      $('pageTitle').textContent = titles[panel] || 'Supervisor';
      if (panel !== 'detalle') {
        if (panel === 'dashboard') {
          cargarDashboard();
        }
        else if (panel === 'reportes') {
          inicializarReporteInteractivo();
        }
        else if (panel === 'emergencias') {
          cargarEmergenciasSupervisor();
        }
        else if (panel === 'asistencia') cargarAsistencia();
      }
    }

    // ============================================================
    // MODAL ALMUERZO EXTRA
    // ============================================================
    function mostrarModalExtraLunch() {
      let modal = document.getElementById('extraLunchModal');
      modal.classList.remove('hidden');
      $('visitanteFecha').value = hoy;
      $('visitanteCantidad').focus();
    }

    function cerrarModal() {
      document.getElementById('extraLunchModal').classList.add('hidden');
      ['visitanteObservaciones'].forEach(id => {
        let el = $(id);
        if (el) el.value = '';
      });
      let cant = $('visitanteCantidad');
      if (cant) cant.value = 1;
    }

    async function guardarAlmuerzoExtra() {
      let fecha = $('visitanteFecha').value;
      let cantidad = $('visitanteCantidad').value;
      let observaciones = $('visitanteObservaciones').value.trim();

      if (!fecha) { mostrarToast('Ingrese una fecha válida', 'error'); return; }
      if (!cantidad || cantidad < 1) { mostrarToast('Ingrese una cantidad válida', 'error'); return; }

      let supervisorName = "Supervisor";
      try {
        let sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}');
        let id = sessionData.id || "";
        if (String(id) === "1058") {
          supervisorName = "Admin Master";
        } else if (id) {
          let sup = empCache.find(x => x.id === id);
          if (sup) supervisorName = sup.nombre;
          else supervisorName = "Supervisor ID " + id;
        }
      } catch(e) {}
      
      let observacionesFinal = observaciones;
      if (supervisorName) {
        observacionesFinal = observacionesFinal ? `${observacionesFinal} (Creado por: ${supervisorName})` : `(Creado por: ${supervisorName})`;
      }

      mostrarLoader(true);
      try {
        let res = await jsonpRequest({
          accion: 'registrarAlmuerzoExtra',
          nombre: 'Almuerzo Extra',
          empresa: 'TCONTROL',
          fecha: fecha,
          tipo: 'Formulario',
          observaciones: observacionesFinal,
          cantidad: cantidad
        });
        mostrarLoader(false);
        if (res?.error) { mostrarToast(res.error, 'error'); return; }
        cerrarModal();
        cargarDatosCompletos(true, true, true).then(() => {
          if (panelActual === 'dashboard' && $('filtroCargoReporte')?.value === 'almuerzos extra') {
            filtrarReporteInteractivo();
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
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
      if (!confirm('¿Estás seguro de eliminar este registro permanentemente?')) return;

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({ 
          accion: 'eliminarRegistro', 
          docId: docId,
          empleadoId: empleadoId,
          fecha: fecha,
          tipo: tipo
        });        if (res.ok) {
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

    async function depurarBaseDeDatos() {
      if (!confirm('¿Deseas depurar los registros duplicados de hoy? Esta acción es irreversible.')) return;

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({ accion: 'depurarDuplicados' });
        mostrarLoader(false);
        if (res.ok) {
          mostrarToast(`Depuración exitosa: ${res.eliminados} duplicados eliminados`, 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
        } else {
          mostrarToast(res.error || 'Error en depuración', 'error');
        }
      } catch (e) {
        mostrarLoader(false);
        mostrarToast('Error de conexión', 'error');
      }
    }

    // ============================================================
    // ARCHIVADO A GOOGLE SHEETS
    // ============================================================
    async function iniciarArchivadoFirebase() {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
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
      if (!confirm(`¿Estás seguro de mover permanentemente los registros de hace más de ${diasNum} días a la hoja de cálculo REGISTROS?\n\nEsto limpiará tu Firebase y reducirá los costos. Esta acción es irreversible en Firebase.`)) return;

      mostrarLoader(true);
      mostrarToast('Autocompletando salidas faltantes recientes...', 'info');
      try {
        await autoCompletarSalidasFaltantes();
      } catch (err) {
        console.warn("Fallo al autocompletar salidas antes del archivado:", err);
      }

      try {
        const limite = new Date();
        limite.setDate(limite.getDate() - diasNum);
        const y = limite.getFullYear();
        const m = String(limite.getMonth() + 1).padStart(2, '0');
        const d = String(limite.getDate()).padStart(2, '0');
        const limiteStr = `${y}-${m}-${d}`;

        mostrarToast('Buscando registros en Firebase...', 'info');

        // 1. Obtener registros de Firebase
        const snap = await db.collection('registros').get();

        if (snap.empty) {
          mostrarLoader(false);
          mostrarToast('No hay registros para archivar.', 'info');
          return;
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

        console.log("=== FIN DIAGNÓSTICO ===");
        console.log("- Sin campo 'fecha':", countSinFecha);
        console.log("- Fallas de parseo:", countParseFail);
        console.log("- Omitidos (hoy/futuro):", countMayorOIgual);
        console.log("- Aceptados para archivar:", countMenores);

        if (registrosToArchive.length === 0) {
          mostrarLoader(false);
          mostrarToast('No hay registros tan antiguos para archivar.', 'info');
          return;
        }

        const chunkSiz = 200;
        const totalRegistros = registrosToArchive.length;
        const totalLotes = Math.ceil(totalRegistros / chunkSiz);

        for (let i = 0; i < totalRegistros; i += chunkSiz) {
          const chunk = registrosToArchive.slice(i, i + chunkSiz);
          const loteActual = Math.floor(i / chunkSiz) + 1;

          mostrarToast(`Archivando lote ${loteActual} de ${totalLotes} (${chunk.length} registros)...`, 'info');

          // Enviar lote a Google Apps Script usando POST
          const respuesta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' }, // Evitar preflight CORS estricto
            body: JSON.stringify({
              apiKey: 'TCONTROL_SECURE_2026_XYZ',
              accion: 'archivarRegistros',
              registros: chunk
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
          mostrarToast(`✅ Lote ${loteActual} guardado. Borrando de Firebase...`, 'info');
          let batch = db.batch();
          for (const reg of chunk) {
            batch.delete(db.collection('registros').doc(reg.id));
          }
          await batch.commit();
        }

        mostrarLoader(false);
        mostrarToast('Archivado completado exitosamente.', 'success');
        
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

    function mostrarModalManual() {
      const modal = $('manualRegistroModal');
      const sel = $('manEmpleadoId');
      sel.innerHTML = empCache.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)} (${e.id})</option>`).join('');
      $('manFecha').value = hoy;
      $('manHora').value = "07:30:00";
      modal.classList.remove('hidden');
    }

    function cerrarModalManual() {
      $('manualRegistroModal').classList.add('hidden');
    }

    async function guardarRegistroManual() {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
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

    window.mostrarModalFuturos = function(preselectedEmpId = null) {
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

    window.seleccionarTipoEvento = function(card) {
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

    window.actualizarResumenFuturo = function() {
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

    window.cerrarModalFuturos = function() {
      $('eventoFuturoModal').classList.add('hidden');
    }

    window.guardarEventoFuturo = async function() {
      if (!window.esAdminMaster && !window.isMaster) {
        mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error');
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
    window.editarValorRegistro = async function(empleadoId, tipo, docId, campo, valorActual, fecha) {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
      
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
      }
    }

    async function editarMetaEmpleado(empleadoId, campo, valorActual) {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
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

    function mostrarModalMasivo() {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
      const modal = $('masivoModal');
      $('masFecha').value = hoy;
      modal.classList.remove('hidden');
    }

    function cerrarModalMasivo() {
      $('masivoModal').classList.add('hidden');
    }

    async function ejecutarRegularizacionMasiva() {
      const fecha = $('masFecha').value;
      const hE = $('masHoraE').value;
      const hS = $('masHoraS').value;
      const soloFaltantes = $('masSoloFaltantes').checked;

      if (!fecha) { mostrarToast('Seleccione una fecha', 'error'); return; }

      if (!confirm(`¿Está seguro de regularizar MASIVAMENTE el día ${fecha}? Esta acción afectará a todos los empleados.`)) return;

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'regularizacionMasiva',
          fecha: fecha,
          horaE: hE,
          horaS: hS,
          soloFaltantes: soloFaltantes
        });

        if (res.ok) {
          mostrarToast(`Éxito: ${res.procesados} registros procesados`, 'success');
          cerrarModalMasivo();
          limpiarCachesLocales();
          cargarDatosCompletos(true, true).then(() => {
            cargarAsistencia();
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
    window.mostrarModalJustificar = function(empId, nombre, fecha, tiempoStr, razon) {
      window.currentJustifyEmpId = empId;
      window.currentJustifyFecha = fecha;
      $('justNombre').textContent = nombre;
      $('justFecha').textContent = fecha;
      $('justTiempo').textContent = tiempoStr;
      $('justObservaciones').value = '';
      $('justTipoPermiso').selectedIndex = 0;
      $('justificarModal').classList.remove('hidden');
    };

    window.cerrarModalJustificar = function() {
      $('justificarModal').classList.add('hidden');
      window.currentJustifyEmpId = null;
      window.currentJustifyFecha = null;
    };

    window.guardarJustificacion = async function() {
      if (!window.currentJustifyEmpId || !window.currentJustifyFecha) return;
      
      const tipoPermisoSelect = $('justTipoPermiso');
      const tipoPermisoText = tipoPermisoSelect.options[tipoPermisoSelect.selectedIndex].text;
      const observaciones = $('justObservaciones').value.trim();
      const razonCompleta = tipoPermisoText + (observaciones ? " - " + observaciones : "");

      let supervisorName = "Supervisor";
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch(e) {}
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

    let estaCompletandoSalidas = false;
    let ultimoChequeoAutoCompletar = 0;
    function obtenerFechaYMD(dateObj = new Date()) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    function obtenerDiaSemanaLocal(dateObj) {
      const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
      return dias[dateObj.getDay()];
    }
    async function autoCompletarSalidasFaltantes() {
      if (estaCompletandoSalidas) return;
      
      const ahoraMs = new Date().getTime();
      if (ahoraMs - ultimoChequeoAutoCompletar < 1800000) {
        console.log("🤖 [Auto-completar] Omitido: verificación realizada hace menos de 30 minutos.");
        return;
      }
      
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch(e) {}
      if (!sessionData.id) {
        console.log("🤖 [Auto-completar] Cancelado: No hay sesión de supervisor activa.");
        return;
      }

      estaCompletandoSalidas = true;
      console.log("🤖 [Auto-completar] Iniciando verificación...");
      try {
        const ahora = new Date();
        const hoyStr = obtenerFechaYMD(ahora);

        const fechasAProcesar = [];
        for (let i = 1; i <= 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const fStr = obtenerFechaYMD(d);
          fechasAProcesar.push(fStr);
        }
        console.log("🤖 [Auto-completar] Fechas anteriores a procesar (últimos 7 días):", fechasAProcesar);

        if (fechasAProcesar.length === 0) {
          estaCompletandoSalidas = false;
          return;
        }

        const snap = await db.collection('registros')
          .where('fecha', 'in', fechasAProcesar)
          .get();

        console.log(`🤖 [Auto-completar] Registros recuperados de Firestore: ${snap.size}`);

        const mapaRegs = {};
        snap.docs.forEach(doc => {
          const r = doc.data();
          const empIdStr = String(r.empleadoId || '').trim();
          const key = `${empIdStr}_${r.fecha}`;
          if (!mapaRegs[key]) mapaRegs[key] = {};
          mapaRegs[key][r.tipo] = true;
        });

        const batch = db.batch();
        let creados = 0;

        console.log(`🤖 [Auto-completar] Analizando ${empCache.length} empleados de la cache...`);

        for (const emp of empCache) {
          if ((emp.cargo || '').toUpperCase() === 'SIN ASISTENCIA') continue;
          const empIdStr = String(emp.id || '').trim();

          for (const fecha of fechasAProcesar) {
            const key = `${empIdStr}_${fecha}`;
            const regs = mapaRegs[key] || {};
            
            if (regs.ENTRADA && !regs.SALIDA) {
              console.log(`🤖 [Auto-completar] ¡Detectado! Empleado: ${emp.nombre} (${empIdStr}) el día ${fecha} tiene ENTRADA pero no SALIDA.`);
              try {
                const horaSalida = "16:15:00";
                const idLimpio = horaSalida.replace(/:/g, '');
                const idDocumento = `${empIdStr}_SALIDA_${fecha}_${idLimpio}`;
                
                const [yStr, mStr, dStr] = fecha.split('-');
                const dateObj = new Date(parseInt(yStr), parseInt(mStr) - 1, parseInt(dStr), 16, 15, 0);
                
                const timestampVal = (window.firebase && firebase.firestore && firebase.firestore.Timestamp) 
                  ? firebase.firestore.Timestamp.fromDate(dateObj) 
                  : dateObj;

                batch.set(db.collection('registros').doc(idDocumento), {
                  empleadoId: empIdStr,
                  nombre: emp.nombre || '',
                  fecha: fecha,
                  tipo: 'SALIDA',
                  hora: horaSalida,
                  almuerzo: 'NO',
                  modo: 'OFICINA',
                  horasExtra: 'NO',
                  justificado: 'NO',
                  timestamp: timestampVal,
                  dia: obtenerDiaSemanaLocal(dateObj),
                  observacion_automatica: "Auto-completado salida faltante",
                  observaciones: "No registró salida",
                  razon_salida: "No registró salida"
                });
                creados++;
              } catch (innerErr) {
                console.error(`🤖 [Auto-completar] Error preparando registro para ${emp.nombre}:`, innerErr);
              }
            }
          }
        }

        ultimoChequeoAutoCompletar = new Date().getTime();
        if (creados > 0) {
          console.log(`🤖 [Auto-completar] Guardando ${creados} salidas en Firebase...`);
          await batch.commit();
          mostrarToast(`🤖 Auto-completadas ${creados} salidas faltantes (16:15).`, 'success');
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos(true, true);
        } else {
          console.log("🤖 [Auto-completar] No se encontraron salidas faltantes por completar.");
        }
      } catch (err) {
        console.error("🤖 [Auto-completar] Error auto-completando salidas:", err);
      } finally {
        estaCompletandoSalidas = false;
      }
    }

    // ============================================================
    // CARGA DE DATOS
    // ============================================================
    async function cargarDatosCompletos(force = false, silencioso = false, forceSheets = false) {
      if (estaActualizando) return;
      estaActualizando = true;
      if (!silencioso) {
        mostrarLoader(true);
      } else {
        const bgSync = $('bgSyncIndicator');
        if (bgSync) bgSync.classList.remove('hidden');
        const detContent = $('detalleContent');
        if (detContent && panelActual === 'detalle') {
          detContent.style.opacity = '0.6';
          detContent.style.pointerEvents = 'none';
          detContent.style.transition = 'opacity 0.2s ease';
        }
      }
      try {
        const res = await jsonpRequest({ 
          accion: 'obtenerDatosSupervisor', 
          force: force,
          forceSheets: forceSheets
        });
        if (!silencioso) mostrarLoader(false);
        estaActualizando = false;

        const bgSync = $('bgSyncIndicator');
        if (bgSync) bgSync.classList.add('hidden');
        const detContent = $('detalleContent');
        if (detContent) {
          detContent.style.opacity = '1';
          detContent.style.pointerEvents = 'auto';
        }

        if (!res || res.error) {
          if (!silencioso) mostrarToast(res?.error || 'Error al cargar datos', 'error');
          return;
        }
        empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
        window.almuerzosExtra = res.almuerzosExtra || [];
        window.emergencia = res.emergencia || { activa: false, nombre: '' };
        periodos = generarPeriodos();

        const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
        if (sessionStr) {
          try {
            const session = JSON.parse(sessionStr);
            const id = session.id;
            const esMaster = String(id) === "1058" || window.isMaster || window.esAdminMaster;
            const sup = empCache.find(x => x.id === id);
            
            if (!esMaster && (!sup || (sup.supervisor || '').trim().toUpperCase() !== 'SI')) {
              console.warn("⚠️ Intento de acceso no autorizado detectado. Cerrando sesión...");
              localStorage.removeItem('SUPERVISOR_SESSION');
              location.reload();
              return;
            }

            // Set global permissions
            window.isMaster = esMaster;
            if (esMaster) {
              if ($('navItemReportes')) $('navItemReportes').style.display = 'flex';
              if ($('navItemOpciones')) $('navItemOpciones').style.display = 'flex';
            } else {
              if ($('navItemReportes')) $('navItemReportes').style.display = 'none';
              if ($('navItemOpciones')) $('navItemOpciones').style.display = 'none';
            }

            mostrarInformacionSupervisor(session);
          } catch(e) {}
        }

        let periodoSelect = $('periodoMensual');
        let periodoSelectDash = $('periodoMensualDash');
        let tardanzaSelect = $('periodoTardanzas');
        if (periodoSelect) periodoSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
        if (periodoSelectDash) periodoSelectDash.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
        if (tardanzaSelect) tardanzaSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');

        $('lastUpdate').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        autoCompletarSalidasFaltantes();
        cargarPanelActual();
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
      else if (panelActual === 'emergencias') {
        cargarEmergenciasSupervisor(true);
      }
      else if (panelActual === 'asistencia') cargarAsistencia();
    }

    // ============================================================
    // GESTIÓN DE SESIÓN SUPERVISOR
    // ============================================================
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
        // Búsqueda por Usuario (empleadoId) y PIN (contraseña)
        const res = await jsonpRequest({ accion: 'verificarPIN', empleadoId: user, pin: pin, deviceToken: deviceToken });

        if (res.error) {
          mostrarError(res.error);
        } else if (res.valido) {
          const esMaster = String(res.empleado.id) === "1058";
          if (res.empleado.esSupervisor || esMaster) {
            const sessionData = { id: res.empleado.id, token: deviceToken, timestamp: new Date().getTime() };
            localStorage.setItem('SUPERVISOR_SESSION', JSON.stringify(sessionData));

            // Estado global de permisos
            window.isMaster = esMaster;

            if (esMaster) {
              if ($('navItemReportes')) $('navItemReportes').style.display = 'flex';
              if ($('navItemOpciones')) $('navItemOpciones').style.display = 'flex';
            } else {
              if ($('navItemReportes')) $('navItemReportes').style.display = 'none';
              if ($('navItemOpciones')) $('navItemOpciones').style.display = 'none';
            }

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
        window.mostrarLoader(false); // Evitar error si no está bindeado, usando global
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

    function mostrarInformacionSupervisor(session) {
      const el = $('sidebarSupervisorInfo');
      if (!el) return;
      
      let nombre = "Supervisor";
      let id = session.id || "";
      
      if (String(id) === "1058") {
        nombre = "Admin Master";
      } else {
        let sup = empCache.find(x => x.id === id);
        if (sup) nombre = sup.nombre;
        else nombre = "Supervisor ID " + id;
      }
      
      el.innerHTML = `
        <div style="font-weight:700; color:var(--g800); font-size:12.5px;">${escapeHtml(nombre)}</div>
        <div style="font-size:10px; color:var(--g400); margin-top:2px;">ID: ${escapeHtml(id)}</div>
      `;
    }

    function verificarEstadoSupervisor() {
      const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          window.isMaster = (String(session.id) === "1058");
          mostrarInformacionSupervisor(session);
          if (window.isMaster) {
            if ($('navItemReportes')) $('navItemReportes').style.display = 'flex';
            if ($('navItemOpciones')) $('navItemOpciones').style.display = 'flex';
          } else {
            if ($('navItemReportes')) $('navItemReportes').style.display = 'none';
            if ($('navItemOpciones')) $('navItemOpciones').style.display = 'none';
          }
        } catch (e) { }
        $('login-supervisor').classList.add('hidden');
        cargarDatosCompletos();
      } else {
        window.isMaster = false;
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
      
      top.onscroll = function() {
        if (!isSyncingBottom) {
          isSyncingTop = true;
          bottom.scrollLeft = top.scrollLeft;
          isSyncingTop = false;
        }
      };
      
      bottom.onscroll = function() {
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
      const modalesVisibles = ['extraLunchModal', 'justificarModal', 'manualRegistroModal', 'masivoModal', 'eventoFuturoModal']
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
      limpiarCachesLocales();
      mostrarToast('Borrando caché local de registros...', 'info');
      await cargarDatosCompletos(true, false, true);
    });
    $('btnExtraLunch').addEventListener('click', mostrarModalExtraLunch);
    $('btnNuevoRegistroManual').addEventListener('click', mostrarModalManual);
    $('btnMasivo').addEventListener('click', mostrarModalMasivo);
    if ($('btnArchivar')) $('btnArchivar').addEventListener('click', iniciarArchivadoFirebase);
    if ($('btnDepurar')) $('btnDepurar').addEventListener('click', depurarBaseDeDatos);

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
    document.getElementById('masivoModal').addEventListener('click', e => {
      if (e.target === document.getElementById('masivoModal')) cerrarModalMasivo();
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
    window.addEventListener('archivadosActualizados', async () => {
      const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
      if (sessionStr) {
        console.log("🔄 Actualizando dashboard con nuevos datos históricos...");
        // Cargar sin mostrar loader para que sea transparente al usuario
        const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor' });
        if (res && res.empleados) {
            empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
            cargarPanelActual();
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

    window.inicializarReporteInteractivo = function() {
      actualizarReporteInteractivo();
    };

    window.actualizarReporteInteractivo = function() {
      const selectPeriodo = $('periodoMensual');
      const idx = parseInt(selectPeriodo?.value || 0);
      let periodo = periodos[idx];
      if (!periodo || !empCache.length) return;

      const fechaFiltro = $('filtroFechaReportes')?.value;
      const R_INI = fechaFiltro ? fechaFiltro : periodo.inicio;
      const R_FIN = fechaFiltro ? fechaFiltro : periodo.fin;

      const hoyRep = getLocalHoyStr();
      
      // Calcular estadísticas de manera idéntica a cargarReportes()
      _reportesCustomData = empCache.map(e => {
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
          const isJustificado = regsDia.some(r =>
            r.justificado === 'SI' ||
            ['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Feriado', 'Sábado/Domingo', 'Salida Justificada'].includes(r.razon_ausencia)
          );

          if (regsDia.length === 0) {
            if (!esFestivo && diasLaborables.includes(fecha)) {
              totalTiempoPorJustificar += 480;
            }
            return;
          }

          let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO');
          let atrasoMinsHoy = 0;
          if (primerReg && String(primerReg.tipo || '').toUpperCase() === 'ENTRADA') {
            let mE = obtenerMinutos(primerReg.hora);
            let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
            if (mE !== null && mE > refEntrada + 5) {
              atrasoMinsHoy = mE - refEntrada;
            }
          }

          let periodosDia = [];
          let entradaPendiente = null;
          let ultimoSalidaMins = null;
          let ultimoSalidaReg = null;

          let sortedRegs = [...regsDia].sort((a, b) => {
            const timeA = a.hora;
            const timeB = b.hora;
            return String(timeA).localeCompare(String(timeB));
          });

          let processedLunchGap1 = false;
          sortedRegs.forEach(r => {
            const tipo = String(r.tipo || '').toUpperCase();
            if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
              let mE = obtenerMinutos(r.hora);
              if (ultimoSalidaMins !== null && mE !== null && mE > ultimoSalidaMins) {
                let gap = mE - ultimoSalidaMins;
                if (!processedLunchGap1 && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
                  let lunchMins = Math.min(45, gap);
                  gap -= lunchMins;
                  processedLunchGap1 = true;
                }
                if (gap > 0) {
                  let clasif = clasificarGap(ultimoSalidaReg, gap);
                  if (clasif.tipo === 'medico') {
                    totalTiempoMedico += gap;
                  } else if (clasif.tipo === 'personal') {
                    totalTiempoPersonal += gap;
                  } else {
                    if (!isJustificado) {
                      totalTiempoPorJustificar += gap;
                    }
                  }
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
          let dayPersonal = 0;
          let dayMedico = 0;
          let dayJustificar = 0;

          const hasCumpleanos = regsDia.some(r => r.razon_ausencia === 'Cumpleaños');
          if (hasCumpleanos) dayPersonal += 240;

          ultimoSalidaMins = null;
          ultimoSalidaReg = null;

          let processedLunchGap2 = false;
          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora || p.entrada.timestamp);
            let mS = obtenerMinutos(p.salida.hora || p.salida.timestamp);
            if (mE === null || mS === null || mS <= mE) return;
            let duracion = mS - mE;
            minutosTrabajadosHoy += duracion;

            if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
              let gap = mE - ultimoSalidaMins;
              if (!processedLunchGap2 && ultimoSalidaMins >= 690 && ultimoSalidaMins <= 870) {
                let lunchMins = Math.min(45, gap);
                gap -= lunchMins;
                processedLunchGap2 = true;
              }
              if (gap > 0) {
                let clasif = clasificarGap(ultimoSalidaReg, gap);
                if (clasif.tipo === 'medico') dayMedico += gap;
                else if (clasif.tipo === 'personal') dayPersonal += gap;
                else dayJustificar += gap;
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
          let extraMins100Acum = 0;
          let shiftMins = 0;

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
            // Ya calculados directamente en el loop anterior
          } else {
            horasExtra50 += extraMins50Acum;
          }

          const entradaDia = regsDia.find(r => r.tipo === 'ENTRADA');
          const persMins  = (entradaDia && entradaDia.permiso_personal_mins) ? Number(entradaDia.permiso_personal_mins) : 0;
          const medMins   = (entradaDia && entradaDia.permiso_medico_mins)   ? Number(entradaDia.permiso_medico_mins)   : 0;

          if (!isJustificado) {
            let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
            totalTiempoPersonal += persMins;
            totalTiempoMedico   += medMins;
            let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar + persMins + medMins;
            let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
            totalTiempoPorJustificar += unaccountedMissing;
          } else {
            totalTiempoPersonal += persMins;
            totalTiempoMedico   += medMins;
          }

          // Ajustar atrasos del día descontando permisos del día
          if (atrasoMinsHoy > 0) {
            const permisoTotalHoy = (dayPersonal + persMins) + (dayMedico + medMins);
            const adjustedAtrasoHoy = Math.max(0, atrasoMinsHoy - permisoTotalHoy);
            if (adjustedAtrasoHoy > 0) {
              atrasos++;
              minutosAtrasos += adjustedAtrasoHoy;
            }
          }
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

    window.renderizarColumnasInteractivas = function() {
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

    window.agregarColumnaCustom = function(colId) {
      if (!columnasCustomActivas.includes(colId)) {
        columnasCustomActivas.push(colId);
        guardarColumnasCustomActivas(columnasCustomActivas);
        renderizarColumnasInteractivas();
        filtrarReporteInteractivo();
      }
    };

    window.quitarColumnaCustom = function(colId) {
      const idx = columnasCustomActivas.indexOf(colId);
      if (idx > -1) {
        columnasCustomActivas.splice(idx, 1);
        guardarColumnasCustomActivas(columnasCustomActivas);
        renderizarColumnasInteractivas();
        filtrarReporteInteractivo();
      }
    };

    // Drag and Drop helpers
    window.allowDropCustom = function(e) {
      e.preventDefault();
    };

    window.dragCustom = function(e, colId) {
      e.dataTransfer.setData("text/plain", colId);
    };

    window.dropCustom = function(e, target) {
      e.preventDefault();
      const colId = e.dataTransfer.getData("text/plain");
      if (!colId) return;
      
      if (target === 'activas') {
        agregarColumnaCustom(colId);
      } else {
        quitarColumnaCustom(colId);
      }
    };

    window.sortReporteCustom = function(colId) {
      if (_sortCustomReport.col === colId) {
        _sortCustomReport.dir = _sortCustomReport.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _sortCustomReport.col = colId;
        _sortCustomReport.dir = 'asc';
      }
      filtrarReporteInteractivo();
    };

    window.setFiltroRapidoReporte = function(cargoVal, btnElement) {
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
        btnElement.style.background = 'var(--blue)';
        btnElement.style.color = '#fff';
        btnElement.style.borderColor = 'var(--blue)';
      }
      filtrarReporteInteractivo();
    };

    window.filtrarReporteInteractivo = function() {
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

        let extras = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return (!pInicio || fNorm >= pInicio) && (!pFin || fNorm <= pFin);
        });

        if (q) {
          extras = extras.filter(ae => 
            (ae.nombre || '').toLowerCase().includes(q) || 
            (ae.observaciones || '').toLowerCase().includes(q) || 
            (ae.empresa || '').toLowerCase().includes(q) ||
            (ae.tipo || '').toLowerCase().includes(q)
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
          let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
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
        let rowHtml = `<tr onclick="mostrarDetalle('${e.id}')" style="cursor:pointer"><td><div class="employee-cell">${photoCell(e)}<span>${escapeHtml(e.nombre)}</span></div></td>`;

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

    window.restablecerColumnasDefault = function() {
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

    window.cargarPlantillaReporte = function(tipo) {
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

    window.exportarExcelDetalleEmpleado = function(empleadoId, indexPeriodo, customInicio = null, customFin = null) {
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

      let todosRegs = e.registros || [];
      let regs = todosRegs.filter(r => r.fecha >= R_INI && r.fecha <= R_FIN);

      let porDia = {};
      [...regs].sort((a, b) => {
        const timeA = a.hora;
        const timeB = b.hora;
        return String(timeA).localeCompare(String(timeB));
      }).forEach(r => {
        const fechaNorm = normalizarFechaStr(r.fecha);
        if (!fechaNorm) return;
        if (!porDia[fechaNorm]) porDia[fechaNorm] = { registros: [], almuerzo: null };
        porDia[fechaNorm].registros.push(r);
        if (r.tipo === 'ENTRADA' && r.almuerzo) porDia[fechaNorm].almuerzo = r.almuerzo;
      });

      // Ordenar cronológicamente (de más antiguo a más reciente) para la exportación a Excel
      let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => a.localeCompare(b));

      if (fechasOrdenadas.length === 0) {
        mostrarToast('No hay registros en este período', 'warning');
        return;
      }

      let bodyHtml = '';
      
      // Inicializar acumuladores totales
      let totTP = 0, totTM = 0, totTJ = 0, totHoras = 0, totAtrasos = 0, totSalidaTemprana = 0;
      let totH50 = 0, totH100 = 0, totHCN = 0, totHC50 = 0, totHC100 = 0;
      let totExtra50 = 0, totExtra100 = 0;

      fechasOrdenadas.forEach(f => {
        const regsDia = porDia[f].registros;
        const d = porDia[f];
        const dayOfWeek = new Date(f + 'T12:00:00').getDay();
        const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
        const isJustificado = regsDia.some(r =>
          r.justificado === 'SI' ||
          ['Vacación', 'Vacacion', 'Permiso Médico', 'Permiso Personal', 'Calamidad Doméstica', 'Feriado', 'Sábado/Domingo', 'Salida Justificada'].includes(r.razon_ausencia)
        );

        let periodosDia = [];
        let entradaPendiente = null;
        let ultimoSalidaMins = null;
        let ultimoSalidaReg = null;

        let sortedRegs = [...regsDia].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));

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

        let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO');
        let atrasoMins = 0;
        if (primerReg && String(primerReg.tipo || '').toUpperCase() === 'ENTRADA') {
          let mE = obtenerMinutos(primerReg.hora);
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

        const hasCumpleanos = regsDia.some(r => r.razon_ausencia === 'Cumpleaños');
        if (hasCumpleanos) tiempoPersonal += 240;

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

        let minsSalidaTemprana = 0;
        if (!esFestivo && ultimoSalidaMins !== null && ultimoSalidaMins < 975) {
          minsSalidaTemprana = 975 - ultimoSalidaMins;
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

        if (isJustificado) {
          tiempoPorJustificar = 0;
        } else {
          const entradaDia = regsDia.find(r => r.tipo === 'ENTRADA');
          const persMins = (entradaDia && entradaDia.permiso_personal_mins) ? Number(entradaDia.permiso_personal_mins) : 0;
          const medMins  = (entradaDia && entradaDia.permiso_medico_mins)   ? Number(entradaDia.permiso_medico_mins)   : 0;
          tiempoPersonal += persMins;
          tiempoMedico   += medMins;
          let missingMinutes = esFestivo ? 0 : Math.max(0, 480 - netWorked);
          let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoPorJustificar;
          let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
          tiempoPorJustificar += unaccountedMissing;
        }

        // Ajustar atrasos descontando permisos
        atrasoMins = Math.max(0, atrasoMins - tiempoPersonal - tiempoMedico);
        // Sumar permisos a TOTAL HRS
        netWorked += (tiempoPersonal + tiempoMedico);

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
          <td style="text-align:center;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
          <td style="text-align:center;">${aBadgeVal}</td>
          <td style="text-align:center;">${autorizadoGlobal ? 'SI' : 'NO'}</td>
          <td>${escapeHtml(razonText)}</td>
          <td style="text-align:center;">${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
          <td style="text-align:center;">${h50 > 0 ? minutosAHHMMSS(h50) : '—'}</td>
          <td style="text-align:center;">${h100 > 0 ? minutosAHHMMSS(h100) : '—'}</td>
          <td style="text-align:center;">${hCN > 0 ? minutosAHHMMSS(hCN) : '—'}</td>
          <td style="text-align:center;">${hC50 > 0 ? minutosAHHMMSS(hC50) : '—'}</td>
          <td style="text-align:center;">${hC100 > 0 ? minutosAHHMMSS(hC100) : '—'}</td>
          <td style="text-align:center; font-weight:bold;">${(h50 + hC50) > 0 ? minutosAHHMMSS(h50 + hC50) : '—'}</td>
          <td style="text-align:center; font-weight:bold;">${(h100 + hC100) > 0 ? minutosAHHMMSS(h100 + hC100) : '—'}</td>
        </tr>`;
      });

      // Fila de totales
      let footerHtml = `<tr style="background:#f1f5f9; font-weight:bold;">
        <td>TOTALES</td>
        <td>—</td>
        <td>—</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTP)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTM)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totTJ)}</td>
        <td style="text-align:center;">${minutosAHHMMSS(totHoras)}</td>
        <td style="text-align:center;">—</td>
        <td style="text-align:center;">—</td>
        <td>—</td>
        <td style="text-align:center;">${minutosAHHMMSS(totAtrasos)}</td>
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
            <tr><td colspan="18" class="title-cell">TCONTROL S.A. - REPORTE INDIVIDUAL DE ASISTENCIA</td></tr>
            <tr><td colspan="18" class="meta-cell">Empleado: ${escapeHtml(e.nombre)} (ID: ${escapeHtml(e.id)}) | Periodo: ${periodo.label} (Rango: ${R_INI} a ${R_FIN}) | Generado: ${formatearTimestampCompleto(new Date())}</td></tr>
            <tr><td colspan="18" style="height:15px;"></td></tr>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>TIEMPO PERSONAL</th>
                <th>TIEMPO MEDICO</th>
                <th>TIEMPO POR JUSTIFICAR</th>
                <th>TOTAL HORAS</th>
                <th>Almuerzo</th>
                <th>Autoriz. H.E.</th>
                <th>Razón</th>
                <th>ATRASOS</th>
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

    window.exportarExcelReporteCustom = function() {
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
        extras = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return (!pInicio || fNorm >= pInicio) && (!pFin || fNorm <= pFin);
        });
        if (q) {
          extras = extras.filter(ae => 
            (ae.nombre || '').toLowerCase().includes(q) || 
            (ae.observaciones || '').toLowerCase().includes(q) || 
            (ae.empresa || '').toLowerCase().includes(q) ||
            (ae.tipo || '').toLowerCase().includes(q)
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

    window.exportarGoogleSheetsReporteCustom = async function() {
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
        extras = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return (!pInicio || fNorm >= pInicio) && (!pFin || fNorm <= pFin);
        });
        if (q) {
          extras = extras.filter(ae => 
            (ae.nombre || '').toLowerCase().includes(q) || 
            (ae.observaciones || '').toLowerCase().includes(q) || 
            (ae.empresa || '').toLowerCase().includes(q) ||
            (ae.tipo || '').toLowerCase().includes(q)
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
            } catch(e) {
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

    window.imprimirReporteCustom = function() {
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
        extras = (window.almuerzosExtra || []).filter(ae => {
          let fNorm = normalizarFechaStr(ae.fecha);
          return (!pInicio || fNorm >= pInicio) && (!pFin || fNorm <= pFin);
        });
        if (q) {
          extras = extras.filter(ae => 
            (ae.nombre || '').toLowerCase().includes(q) || 
            (ae.observaciones || '').toLowerCase().includes(q) || 
            (ae.empresa || '').toLowerCase().includes(q) ||
            (ae.tipo || '').toLowerCase().includes(q)
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
            Sistema de Gestión de Asistencia CONTROL 2026 - Reporte Oficial Impreso Autorizado
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

    window.cambiarModoGestion = function(modo) {
      const contSheets = $('contModoSheets');
      const contManual = $('contModoManual');
      const contPasted = $('contModoPasted');
      
      if (contSheets) contSheets.style.display = modo === 'sheets' ? 'block' : 'none';
      if (contManual) contManual.style.display = modo === 'manual' ? 'block' : 'none';
      if (contPasted) contPasted.style.display = modo === 'pasted' ? 'flex' : 'none';
      
      // Actualizar estilos activos de los botones de pestaña
      document.querySelectorAll('.tab-gestion').forEach(btn => {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--g500)';
      });
      
      let modoCapitalized = modo.charAt(0).toUpperCase() + modo.slice(1);
      const activeBtn = $('btnModo' + modoCapitalized);
      if (activeBtn) {
        activeBtn.style.background = 'white';
        activeBtn.style.color = 'var(--g800)';
        activeBtn.style.boxShadow = 'var(--sh)';
      }
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

    window.descargarBaseAGoogleSheetsActualizar = async function() {
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

    window.leerEImportarDesdeGoogleSheetsActualizar = async function() {
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

    window.agregarEmpleadoDesdeFormulario = function() {
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

    window.parsearPegadoMasivo = function(texto) {
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

    window.procesarVistaPreviaMasiva = function() {
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

    window.limpiarVistaPreviaMasiva = function() {
      const txtArea = $('txtMasivoEmpleados');
      if (txtArea) txtArea.value = '';
      
      const tbody = $('tbodyVistaPreviaEmpleados');
      if (tbody) tbody.innerHTML = '';
      const container = $('vistaPreviaEmpleadosContainer');
      if (container) container.style.display = 'none';
      _vistaPreviaMasivaCache = [];
      mostrarToast('Área de trabajo y vista previa limpiadas.', 'info');
    };

    window.guardarMasivoEmpleados = async function() {
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

    window.triggerPhotoUpload = function(empleadoId) {
      if (!window.esAdminMaster && !window.isMaster) {
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
            reader.onload = function(e) {
              const img = new Image();
              img.onload = async function() {
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
    window.cargarEmergenciasSupervisor = async function(silencioso = false) {
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

    window.toggleEmergenciaSupervisor = async function(activa) {
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
            catch(e) { return ''; }
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
      } catch(e) {
        mostrarLoader(false);
        console.error('toggleEmergenciaSupervisor error:', e);
        mostrarToast('Error: ' + (e.message || 'No se pudo conectar con el servidor'), 'error');
      }
    };