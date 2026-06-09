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
    let panelActual = 'dashboard';
    let filtroAsistenciaActual = 'todos';
    const hoy = new Date().toISOString().split('T')[0];
    let estaActualizando = false;
    let _sortReportes = { col: null, dir: 'asc' };

    // ============================================================
    // UTILIDADES
    // ============================================================
    function $(id) { return document.getElementById(id); }

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
        return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
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

    function calcularDistancia(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    function esFeriadoODomingo(fechaStr) {
      if (!fechaStr) return false;
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
        const timeout = setTimeout(() => {
          delete window[cbName];
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('Timeout'));
        }, 20000);

        window[cbName] = function (data) {
          clearTimeout(timeout);
          delete window[cbName];
          if (script.parentNode) script.parentNode.removeChild(script);
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

        const script = document.createElement('script');
        script.src = url.toString();
        script.onerror = () => {
          clearTimeout(timeout);
          delete window[cbName];
          if (script.parentNode) script.parentNode.removeChild(script);
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
      let exito = await actualizarAlmuerzo(id, estado, fecha);
      if (exito) {
        let idx = empCache.findIndex(e => e.id === id);
        if (idx !== -1) {
          if (!fecha || fecha === hoy) {
            empCache[idx].almuerzoHoy = estado;
          }
          let reg = empCache[idx].registros?.find(r => r.tipo === 'ENTRADA' && r.fecha === (fecha || hoy));
          if (reg) reg.almuerzo = estado;
        }
        if (panelActual === 'detalle') mostrarDetalle(id);
        else {
          cargarAsistencia();
          cargarDashboard();
        }
        cargarDirectorio();
      }
    }

    // ============================================================
    // DASHBOARD
    // ============================================================
    function cargarDashboard() {
      let hoy = new Date().toISOString().split('T')[0];
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
          if (m !== null && m > refEntradaHoy) hoyT++;
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

      const hoy_ = new Date().toISOString().split('T')[0];
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
            if (m !== null && m > refEntradaR) tard++;
            if (r.almuerzo === 'SI') almP++;
          });
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
              if (m > HORA_ENTRADA_REF) {
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

              sortedRegs.forEach(r => {
                const tipo = String(r.tipo || '').toUpperCase();
                if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
                  let mE = obtenerMinutos(r.hora);
                  if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
                    let gap = mE - ultimoSalidaMins;
                    let clasif = clasificarGap(ultimoSalidaReg, gap);
                    if (clasif.tipo === 'medico') dayMedico += gap;
                    else if (clasif.tipo === 'personal') dayPersonal += gap;
                    else dayJustificar += gap;
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
                let mE = obtenerMinutos(p.entrada.hora);
                let mS = obtenerMinutos(p.salida.hora);
                if (mE === null || mS === null || mS <= mE) return;
                minutosTrabajadosHoy += (mS - mE);
              });

              let netWorked = minutosTrabajadosHoy;
              if (!esFestivo && netWorked > 240) netWorked -= 45;

              let expectedNet = 480;
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

            if (minsFaltantes > 0) {
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

      html += `</tbody></table>`;
      $('tablaResumenMensual').innerHTML = html;
    }

    function cargarAnalisisTardanzas() {
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
          if (mins - refEnt > 1) { t++; m += mins - refEnt; }
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
      const esAdminMaster = window.isMaster || false;
      // Ordenar empleados alfabéticamente
      empCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

      let total = empCache.length;
      let pres = empCache.filter(e => e.entradaHoy).length;
      let ausentes = total - pres;
      const esFestivoHoy = esFeriadoODomingo(hoy) || (new Date(hoy + 'T12:00:00').getDay() === 6);
      const refEntradaHoy = esFestivoHoy ? 420 : HORA_ENTRADA_REF;
      const refSalidaHoy = esFestivoHoy ? 900 : HORA_SALIDA_REF;

      let tards = empCache.filter(e => { if (!e.entradaHoy) return false; let m = obtenerMinutos(e.horaEntradaMs); return m !== null && m > refEntradaHoy; }).length;
      let salieron = empCache.filter(e => e.salidaHoy).length;
      let sinSalida = pres - salieron;
      let almPlanta = empCache.filter(e => e.entradaHoy && e.almuerzoHoy === 'SI').length;
      let almFuera = empCache.filter(e => e.entradaHoy && e.almuerzoHoy === 'NO').length;

      $('asisTotal').textContent = total;
      $('asisPresentes').textContent = pres;
      $('asisAusentes').textContent = ausentes;
      $('asisTardanzas').textContent = tards;
      $('asisSalieron').textContent = salieron;
      if ($('asisSinSalida')) $('asisSinSalida').textContent = sinSalida;
      $('asisAlmuerzoPlanta').textContent = almPlanta;
      $('asisAlmuerzoFuera').textContent = almFuera;

      let extrasHoy = (window.almuerzosExtra || []).filter(ae => normalizarFechaStr(ae.fecha) === hoy);
      let totalExtrasHoy = extrasHoy.reduce((acc, ae) => acc + parseInt(ae.cantidad || 0), 0);
      if ($('asisAlmuerzoPlantaSub')) {
        $('asisAlmuerzoPlantaSub').innerHTML = `en comedor <span style="font-weight:700; color:var(--indigo)">(+ ${totalExtrasHoy} ext.)</span>`;
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
        let tard = mEnt !== null && mEnt > refEntradaHoy;

        let eHtml = e.entradaHoy ? `<span class="editable-cell" ${clickEntrada}>${mEnt !== null ? minsToHHMM(mEnt) : 'Registrada'}${tard ? ` <span class="delta pos">+${formatearMinutos(mEnt - refEntradaHoy)}</span>` : ''}</span>` : `<span class="editable-cell empty" ${clickEntrada}>-</span>`;

        let sHoraV = e.horaSalidaMs || sReg?.hora || sReg?.timestamp;
        let mSal = e.salidaHoy ? obtenerMinutos(sHoraV) : null;
        let sHtml = e.salidaHoy ? `<span class="editable-cell" ${clickSalida}>${mSal !== null ? minsToHHMM(mSal) : 'Registrada'}${mSal - refSalidaHoy > 1 ? ` <span class="delta neg">+${formatearMinutos(mSal - refSalidaHoy)}</span>` : ''}</span>` : (e.entradaHoy ? `<span class="editable-cell empty" ${clickSalida}>Pendiente</span>` : `<span class="editable-cell empty" ${clickSalida}>-</span>`);

        let fReg = (e.registros || []).find(r => r.tipo === 'FALTA' && r.fecha === hoy);
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
                            <option value="Otro" ${razonAusenciaHoy && !['Vacación','Permiso Médico','Permiso Personal','Calamidad Doméstica'].includes(razonAusenciaHoy) ? 'selected' : ''}>✏️ Otro...</option>
                        </select>
                    </div>
                  `;
                  if (razonAusenciaHoy && !['Vacación','Permiso Médico','Permiso Personal','Calamidad Doméstica'].includes(razonAusenciaHoy)) {
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
        if (isSinAsistencia) {
             toggle = `<div class="almuerzo-toggle" style="box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-radius:12px;"><button class="toggle-option ${e.almuerzoHoy === 'SI' ? 'active-si' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','SI')" style="flex:1; border-radius:12px 0 0 12px; font-weight:600; font-size:11px; padding:6px 4px;"><i class="fas fa-check-circle" style="margin-right:4px;"></i> Planta</button><button class="toggle-option ${e.almuerzoHoy === 'NO' ? 'active-no' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','NO')" style="flex:1; border-radius:0 12px 12px 0; font-weight:600; font-size:11px; padding:6px 4px;"><i class="fas fa-times-circle" style="margin-right:4px;"></i> Fuera</button></div>`;
        } else {
             if (!e.entradaHoy) {
                 toggle = `<span class="pill dim" style="font-size:10px; opacity:0.5; background:transparent; border:none;">Ausente</span>`;
             } else {
                 let puedeEditar = e.entradaHoy || esAdminMaster;
                 toggle = `<div class="almuerzo-toggle"><button class="toggle-option ${e.almuerzoHoy === 'SI' ? 'active-si' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','SI')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-building"></i> Sí</button><button class="toggle-option ${e.almuerzoHoy === 'NO' ? 'active-no' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','NO')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-home"></i> No</button></div>`;
             }
        }

        return { ...e, _eH: eHtml, _sH: sHtml, _est: estHtml, _ausencia: ausenciaHtml, _toggle: toggle, _tard: tard, _entradaHoy: e.entradaHoy, _almuerzoHoy: e.almuerzoHoy, _salidaHoy: e.salidaHoy, _modo: modoHtml, _extras: extrasHtml, id: e.id, isSinAsistencia };
      });
      filtrarAsistenciaTabla();
    }

    async function editarValorRegistro(empleadoId, tipoReg, docId, campo, valorActual, fechaManual) {
      let nuevoValor = "";
      let targetFecha = fechaManual || hoy;

      if (campo === 'hora') {
        nuevoValor = prompt(`Editar HORA (${tipoReg}) para el empleado ${empleadoId} [${targetFecha}]:`, valorActual);
      } else if (campo === 'modo') {
        nuevoValor = confirm(`¿Cambiar MODO a CAMPO? (Cancelar para OFICINA)`) ? 'CAMPO' : 'OFICINA';
      } else if (campo === 'horasExtra') {
        nuevoValor = confirm(`¿Autorizar HORAS EXTRAS?`) ? 'SI' : 'NO';
      } else if (campo === 'timestamp') {
        let tsLegible = formatearTimestampCompleto(valorActual);
        nuevoValor = prompt(`Editar TIMESTAMP para ${tipoReg} para el empleado ${empleadoId} [${targetFecha}]:\nUse el formato: DD/MM/YYYY HH:MM:SS`, tsLegible);
        if (nuevoValor === null) return;
        const parsed = parsearTimestamp(nuevoValor);
        if (!parsed) {
          mostrarToast('Formato de timestamp inválido. Use el formato: DD/MM/YYYY HH:MM:SS', 'error');
          return;
        }
        nuevoValor = parsed.timestampFormatted;
      }

      if (nuevoValor === null || nuevoValor === "") return;

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'actualizarRegistroGeneral',
          docId: docId,
          empleadoId: empleadoId,
          tipo: tipoReg,
          fecha: targetFecha,
          campo: campo,
          valor: nuevoValor
        });

        if (res.ok) {
          mostrarToast('Registro actualizado correctamente', 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
          if (panelActual === 'detalle') mostrarDetalle(empleadoId);
          else cargarAsistencia();
        } else {
          mostrarToast(res.error || 'Error al actualizar', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
      }
    }

    async function editarMetaEmpleado(empleadoId, campo, valorActual) {
      let nuevoValor = prompt(`Editar ${campo.toUpperCase()} para el empleado ${empleadoId}:`, valorActual);
      if (nuevoValor === null || nuevoValor === "") return;

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'actualizarEmpleado',
          empleadoId: empleadoId,
          campo: campo,
          valor: nuevoValor
        });

        if (res.ok) {
          mostrarToast('Empleado actualizado correctamente', 'success');
          await cargarDatosCompletos();
          mostrarDetalle(campo === 'id' ? nuevoValor : empleadoId);
        } else {
          mostrarToast(res.error || 'Error al actualizar', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
      }
    }

    async function eliminarRegistroSupervisor(docId, empleadoId, fecha, tipo) {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
      if (!confirm('¿Está seguro de eliminar este registro permanentemente?')) return;
      mostrarLoader(true);
      try {
        const res = await jsonpRequest({ 
          accion: 'eliminarRegistro', 
          docId: docId,
          empleadoId: empleadoId,
          fecha: fecha,
          tipo: tipo
        });
        if (res.ok) {
          mostrarToast('Registro eliminado', 'success');
          await cargarDatosCompletos();
          if (panelActual === 'detalle') mostrarDetalle(empleadoId);
        } else {
          mostrarToast(res.error || 'Error al eliminar', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
      }
    }

    function setFiltroAsistencia(filtro) {
      filtroAsistenciaActual = filtro;
      filtrarAsistenciaTabla();
    }

    function filtrarAsistenciaTabla() {
      let q = ($('searchAsistencia')?.value || '').toLowerCase();
      let data = (window._asisData || []).filter(e => {
        if (q && !e.nombre.toLowerCase().includes(q) && !(e.area || '').toLowerCase().includes(q) && !(e.id || '').includes(q)) return false;
        if (filtroAsistenciaActual === 'presente' && !e._entradaHoy) return false;
        if (filtroAsistenciaActual === 'ausente' && e._entradaHoy) return false;
        if (filtroAsistenciaActual === 'tardanza' && !e._tard) return false;
        if (filtroAsistenciaActual === 'almuerzo_si' && e._almuerzoHoy !== 'SI') return false;
        if (filtroAsistenciaActual === 'almuerzo_no' && e._almuerzoHoy !== 'NO') return false;
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
      let html = `<table class="employee-table table-compact"><thead><tr><th onclick="sortAsistencia('nombre')" style="cursor:pointer">Empleado <i class="fas fa-sort" style="opacity:.3;font-size:9px"></i></th><th>Área</th><th>Entrada</th><th>Salida</th><th>Modo</th><th>Extras</th><th>Estado</th><th>Razón Ausencia</th><th>Almuerzo</th></tr></thead><tbody>`;
      html += data.map(e => `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<strong>${escapeHtml(e.nombre)}</strong></div></td><td>${escapeHtml(e.area || '—')}</td><td>${e._eH}</td><td>${e._sH}</td><td>${e._modo}</td><td>${e._extras}</td><td>${e._est}</td><td>${e._ausencia}</td><td>${e._toggle}</td></tr>`).join('');
      html += `</tbody></table>`;
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
      
      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'guardarRegistro',
          id: empleadoId,
          tipo: 'FALTA',
          fecha_falta: hoy,
          razon_ausencia: razonFinal
        });
        if (res.ok) {
          mostrarToast('Razón de ausencia guardada', 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
          cargarAsistencia();
        } else {
          mostrarToast(res.error || 'Error al guardar', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
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
      
      let html = '<div style="margin-bottom:16px;padding:12px;background:var(--g50);border-radius:12px;border:1px solid var(--g200)">';
      html += '<div style="font-weight:600;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:8px;">';
      html += '<div style="display:flex;align-items:center;gap:8px"><i class="fas fa-sliders-h"></i> Columnas visibles</div>';
      html += `<label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500;cursor:pointer;user-select:none;color:var(--red);"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleTodasLasColumnas(this.checked)" style="cursor:pointer"> Seleccionar Todo</label>`;
      html += '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">';

      COLUMNAS_DISPONIBLES.forEach(col => {
        const isChecked = columnasVisibles.includes(col.id);
        html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 8px;border-radius:6px;transition:all .2s;background:${isChecked ? 'var(--red-lt)' : 'white'};border:1px solid ${isChecked ? 'var(--red)' : 'var(--g200)'}">`;
        html += `<input type="checkbox" ${isChecked ? 'checked' : ''} onchange="cambiarVisibilidadColumna('${col.id}')" style="cursor:pointer">`;
        html += `<span style="font-size:var(--fxs);font-weight:500;color:${isChecked ? 'var(--red)' : 'var(--g600)'}">${col.label}</span>`;
        html += `</label>`;
      });

      html += '</div></div>';
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

      const hoyRep = new Date().toISOString().split('T')[0];
      const fechaFiltro = $('filtroFechaReportes')?.value;
      const R_INI = fechaFiltro ? fechaFiltro : periodo.inicio;
      const R_FIN = fechaFiltro ? fechaFiltro : periodo.fin;

      let stats = empCache.map(e => {
        let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= R_INI && r.fecha <= R_FIN);
        let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= R_INI && r.fecha <= R_FIN);
        // Días laborables solo hasta hoy (no días futuros del período)
        let diasLaborablesTotal = obtenerDiasHabiles(R_INI, R_FIN);
        let diasLaborables = diasLaborablesTotal.filter(d => d <= hoyRep);
        let diasAsistidos = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f)).size;

        // FALTAS: días hábiles transcurridos menos días asistidos
        let faltas = Math.max(0, diasLaborables.length - diasAsistidos);

        // ATRASOS + ALMUERZO + PUNTUALIDAD
        let atrasos = 0;
        let minutosAtrasos = 0;
        let almPlanta = 0, almFuera = 0;
        entradas.forEach(r => {
          let m = obtenerMinutos(r.hora);
          if (m !== null) {
            const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
            const refEntradaR = esFestivoR ? 420 : HORA_ENTRADA_REF;
            if (m > refEntradaR) {
              atrasos++;
              minutosAtrasos += m - refEntradaR;
            }
          }
        });
        
        let registrosAlmuerzo = (e.registros || []).filter(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO') && r.fecha >= R_INI && r.fecha <= R_FIN);
        registrosAlmuerzo.forEach(r => {
          if (r.almuerzo === 'SI') almPlanta++;
          if (r.almuerzo === 'NO') almFuera++;
        });
        let puntualidad = diasAsistidos ? Math.round((1 - atrasos / diasAsistidos) * 100) : 0;

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
          const isJustificado = regsDia.some(r => r.justificado === 'SI');

          if (regsDia.length === 0) {
            if (!esFestivo && diasLaborables.includes(fecha)) {
              totalTiempoPorJustificar += 480;
            }
            return;
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

          sortedRegs.forEach(r => {
            const tipo = String(r.tipo || '').toUpperCase();
            if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
              let mE = obtenerMinutos(r.hora);
              if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
                let gap = mE - ultimoSalidaMins;
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

          ultimoSalidaMins = null;
          ultimoSalidaReg = null;

          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora);
            let mS = obtenerMinutos(p.salida.hora);
            if (mE === null || mS === null || mS <= mE) return;
            let duracion = mS - mE;
            minutosTrabajadosHoy += duracion;

            if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
              let gap = mE - ultimoSalidaMins;
              let clasif = clasificarGap(ultimoSalidaReg, gap);
              if (clasif.tipo === 'medico') dayMedico += gap;
              else if (clasif.tipo === 'personal') dayPersonal += gap;
              else dayJustificar += gap;
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
          } else {
            if (netWorked >= 600) autorizado = true;
          }

          let extraMins50Acum = 0;
          let extraMins100Acum = 0;
          let shiftMins = 0;

          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora);
            let mS = obtenerMinutos(p.salida.hora);
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

          if (!isJustificado) {
            let missingMinutes = 0;
            missingMinutes = Math.max(0, 480 - netWorked);
            let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar;
            let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
            totalTiempoPorJustificar += unaccountedMissing;
          }
        });

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
      const btnLimpiar = $('btnLimpiarFechaRep');
      if (inputFecha && inputFecha.value) {
        if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
      } else {
        if (btnLimpiar) btnLimpiar.style.display = 'none';
      }
      cargarReportes();
    };

    window.limpiarFiltroFechaReportes = function() {
      const inputFecha = $('filtroFechaReportes');
      const btnLimpiar = $('btnLimpiarFechaRep');
      if (inputFecha) inputFecha.value = '';
      if (btnLimpiar) btnLimpiar.style.display = 'none';
      cargarReportes();
    };

    function filtrarTablaReportes() {
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
      let headerHtml = `<th onclick="sortarTablaReportes('nombre')">Empleado ${sortIcon('nombre')}</th><th onclick="sortarTablaReportes('area')">Área ${sortIcon('area')}</th>`;
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasVisibles.includes(col.id)) {
          headerHtml += `<th onclick="sortarTablaReportes('${col.id}')" style="text-align:center">${col.label} ${sortIcon(col.id)}</th>`;
        }
      });

      let html = `<table class="employee-table table-compact"><thead><tr>${headerHtml}</tr></thead><tbody>`;

      html += data.map(e => {
        let rowHtml = `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<span>${escapeHtml(e.nombre)}</span></div></td><td>${escapeHtml(e.area || '—')}</td>`;

        COLUMNAS_DISPONIBLES.forEach(col => {
          if (columnasVisibles.includes(col.id)) {
            const valor = e[col.id];
            let contenido = '';
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
        });

        rowHtml += '</tr>';
        return rowHtml;
      }).join('');

      html += '</tbody></table>';

      let selectorHtml = renderizadorSelectorColumnas();
      let scrollHint = '<div class="scroll-hint"><i class="fas fa-arrows-alt-h"></i> Arrastra para desplazarte — clic en columna para ordenar</div>';
      $('tablaReportes').innerHTML = selectorHtml + scrollHint + `<div class="table-scroll-wrap" id="reportesScrollWrap">${html}</div>`;

      // Drag-to-scroll con mouse
      const wrap = document.getElementById('reportesScrollWrap');
      if (wrap) {
        let isDown = false, startX, scrollLeft;
        wrap.addEventListener('mousedown', e => { isDown = true; startX = e.pageX - wrap.offsetLeft; scrollLeft = wrap.scrollLeft; });
        wrap.addEventListener('mouseleave', () => { isDown = false; });
        wrap.addEventListener('mouseup', () => { isDown = false; });
        wrap.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); const x = e.pageX - wrap.offsetLeft; wrap.scrollLeft = scrollLeft - (x - startX); });
      }
    }
    function volverAAsistencia() { cambiarPanel('asistencia'); cargarAsistencia(); }

    // ============================================================
    // DETALLE
    // ============================================================
    function mostrarDetalle(id, indexPeriodo = 0) {
      const ADMIN_ID = "1058";
      let sessionData = {};
      try { sessionData = JSON.parse(localStorage.getItem('SUPERVISOR_SESSION') || '{}'); } catch (e) { }

      // Definir esAdminMaster de forma global para los closures si es necesario, 
      // pero aquí lo usaremos dentro de mostrarDetalle.
      const esAdminMaster = (sessionData.id === ADMIN_ID);
      window.esAdminMaster = esAdminMaster; // Asegurarlo en el scope global por si acaso lo llaman desde onclicks dinámicos

      let e = empCache.find(x => x.id === id);
      if (!e) return;
      
      // Obtener el período seleccionado o el actual por defecto
      let periodoSeleccionado = periodos[indexPeriodo] || periodos[0];
      
      // Filtrar registros al período seleccionado
      let todosRegs = e.registros || [];
      let regs = todosRegs.filter(r => r.fecha >= periodoSeleccionado.inicio && r.fecha <= periodoSeleccionado.fin)
                          .sort((a, b) => b.fecha.localeCompare(a.fecha));

      let entT = regs.filter(r => r.tipo === 'ENTRADA').length;
      let salT = regs.filter(r => r.tipo === 'SALIDA').length;
      let almP = regs.filter(r => r.tipo === 'ENTRADA' && r.almuerzo === 'SI').length;
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
          if (m > refEnt) tardT++;
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

      let tSegs = 0, tPermisoSegs = 0;
      // Ordenar de más reciente a más antiguo (YYYY-MM-DD → comparación de string correcta)
      let fechasOrdenadas = Object.keys(porDia).filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort((a, b) => b.localeCompare(a));

      // Calcular totales mensuales
      fechasOrdenadas.forEach(f => {
        let d = porDia[f];
        let entradaPendiente = null;
        let ultimoSalidaMins = null;
        let minutosDia = 0;

        d.registros.forEach(r => {
          const tipo = String(r.tipo || '').toUpperCase();
          if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
            let mE = obtenerMinutos(r.hora);
            if (ultimoSalidaMins !== null && mE !== null && mE > ultimoSalidaMins) {
              tPermisoSegs += (mE - ultimoSalidaMins) * 60;
            }
            entradaPendiente = r;
          } else if (tipo === 'SALIDA' || tipo === 'SALIDA_CAMPO') {
            if (entradaPendiente) {
              let mE = obtenerMinutos(entradaPendiente.hora);
              let mS = obtenerMinutos(r.hora);
              if (mE !== null && mS !== null && mS > mE) minutosDia += (mS - mE);
              ultimoSalidaMins = mS;
              entradaPendiente = null;
            }
          }
        });

        // Descontar 45 min si trabajó más de 4 horas ese día (solo en días normales)
        const esFestivo = esFeriadoODomingo(f) || (new Date(f + 'T12:00:00').getDay() === 6);
        if (!esFestivo && minutosDia > 240) minutosDia -= 45;
        tSegs += minutosDia * 60;
      });

      // Mostrar todos los días del período
      let filas = fechasOrdenadas.map(f => {
        let d = porDia[f];
        let regsDia = d.registros;
        const dayOfWeek = new Date(f + 'T12:00:00').getDay();
        const esFestivo = esFeriadoODomingo(f) || (dayOfWeek === 6);
        const isJustificado = regsDia.some(r => r.justificado === 'SI');

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

        let aBadge = d.almuerzo === 'SI' ? '<span class="pill ok">🏢 Planta</span>' : d.almuerzo === 'NO' ? '<span class="pill" style="background:#dbeafe; color:#1e40af;">🏠 Fuera</span>' : '<span class="pill dim">❓ —</span>';
        if (esAdminMaster) {
          aBadge = `<span class="editable-pill" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}', '${d.almuerzo === 'SI' ? 'NO' : 'SI'}', '${f}')">${aBadge}</span>`;
        }

        let primerReg = regsDia.find(r => r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_CAMPO');
        let atrasoMins = 0;
        if (primerReg && String(primerReg.tipo || '').toUpperCase() === 'ENTRADA') {
          let mE = obtenerMinutos(primerReg.hora);
          let refEntrada = esFestivo ? 420 : HORA_ENTRADA_REF;
          if (mE !== null && mE > refEntrada) atrasoMins = mE - refEntrada;
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
            else if (r.razon_justificac) ico = '✅';
            razonesBadges.push(`<span class="pill" style="background:#fff7ed; color:#c2410c; border:1px solid #fed7aa; font-size:11px;">${ico} ${escapeHtml(txt)}</span>`);
          }
        });

        let razonesCompletas = razonesBadges.length > 0 ? `<div style="display:flex; flex-direction:column; gap:4px;">${razonesBadges.join('')}</div>` : '';
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
        ultimoSalidaMins = null;
        ultimoSalidaReg = null;

        periodosDia.forEach(p => {
          if (!p.entrada || !p.salida) return;
          let mE = obtenerMinutos(p.entrada.hora);
          let mS = obtenerMinutos(p.salida.hora);
          if (mE === null || mS === null || mS <= mE) return;

          let duracion = mS - mE;
          minutosTrabajadosHoy += duracion;

          if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
            let gap = mE - ultimoSalidaMins;
            let clasif = clasificarGap(ultimoSalidaReg, gap);
            if (clasif.tipo === 'medico') {
              tiempoMedico += gap;
            } else if (clasif.tipo === 'personal') {
              tiempoPersonal += gap;
            } else {
              tiempoPorJustificar += gap;
            }
          }
          ultimoSalidaMins = mS;
          ultimoSalidaReg = p.salida;
        });

        // Descontar almuerzo si superó 4 horas (solo en días normales)
        let netWorked = minutosTrabajadosHoy;
        if (!esFestivo && netWorked > 240) netWorked -= 45;

        // Auto-autorización de horas extras
        let autorizadoGlobal = regsDia.some(r => r.horasExtra === 'SI');
        if (esFestivo) {
          if (netWorked > 60) autorizadoGlobal = true;
        } else {
          if (netWorked >= 600) autorizadoGlobal = true;
        }

        let extBadgeVal = autorizadoGlobal ? 'SI' : 'NO';
        let extBadge = autorizadoGlobal ? '<span class="pill ok">SI</span>' : '<span class="pill dim">NO</span>';
        if (regsDia.some(r => (r.autoriza || '').includes('CAMPO'))) {
          extBadge = '<span class="pill ok" title="Auto-autorizado por Campo">CAMPO</span>';
        }
        let extBadgeHtml = extBadge;
        if (esAdminMaster && regsDia.length > 0) {
          extBadgeHtml = `<span class="editable-pill" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${regsDia[0].tipo}', '${regsDia[0].id}', 'horasExtra', '${extBadgeVal}', '${f}')">${extBadge}</span>`;
        }

        let extraMins50Acum = 0;
        let extraMins100Acum = 0;
        let shiftMins = 0;

        periodosDia.forEach(p => {
          if (!p.entrada || !p.salida) return;
          let mE = obtenerMinutos(p.entrada.hora);
          let mS = obtenerMinutos(p.salida.hora);
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
          let missingMinutes = Math.max(0, 480 - netWorked);
          let totalPermisosHoy = tiempoPersonal + tiempoMedico + tiempoPorJustificar;
          let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
          tiempoPorJustificar += unaccountedMissing;
        }

        return `<tr style="${rowStyle}">
      <td style="white-space:nowrap; font-weight:600;">${fechaFormateada}</td>
      <td class="hora-cell">${horaE}</td>
      <td class="hora-cell">${horaS}</td>
      <td style="text-align:center; color:var(--indigo)">${tiempoPersonal > 0 ? minutosAHHMMSS(tiempoPersonal) : '—'}</td>
      <td style="text-align:center; color:var(--teal)">${tiempoMedico > 0 ? minutosAHHMMSS(tiempoMedico) : '—'}</td>
      <td style="text-align:center; color:var(--red)">${tiempoPorJustificar > 0 ? minutosAHHMMSS(tiempoPorJustificar) : '—'}</td>
      <td style="text-align:center; color:var(--green); font-weight:600;">${netWorked > 0 ? minutosAHHMMSS(netWorked) : '—'}</td>
      <td>${aBadge}</td>
      <td>${extBadgeHtml}</td>
      <td>${razonesCompletas}</td>
      <td style="text-align:center; color:${atrasoMins > 0 ? 'var(--red)' : 'inherit'}">${atrasoMins > 0 ? minutosAHHMMSS(atrasoMins) : '—'}</td>
      <td style="text-align:center">${h50 > 0 ? minutosAHHMMSS(h50) : '—'}</td>
      <td style="text-align:center">${h100 > 0 ? minutosAHHMMSS(h100) : '—'}</td>
      <td style="text-align:center">${hCN > 0 ? minutosAHHMMSS(hCN) : '—'}</td>
      <td style="text-align:center">${hC50 > 0 ? minutosAHHMMSS(hC50) : '—'}</td>
      <td style="text-align:center">${hC100 > 0 ? minutosAHHMMSS(hC100) : '—'}</td>
      <td style="text-align:center"><strong>${(h50 + hC50) > 0 ? minutosAHHMMSS(h50 + hC50) : '—'}</strong></td>
      <td style="text-align:center"><strong>${(h100 + hC100) > 0 ? minutosAHHMMSS(h100 + hC100) : '—'}</strong></td>
    </tr>`;
      }).join('');

      let thH = Math.floor(tSegs / 3600) || 0,
        thM = Math.floor((tSegs % 3600) / 60) || 0,
        thS = Math.floor(tSegs % 60) || 0;

      let tpH = Math.floor(tPermisoSegs / 3600) || 0,
        tpM = Math.floor((tPermisoSegs % 3600) / 60) || 0;

      let optionsPeriodos = periodos.map((p, i) => `<option value="${i}" ${i === indexPeriodo ? 'selected' : ''}>${p.label}</option>`).join('');

      $('detalleContent').innerHTML = `
    <div class="detail-view">
      <div class="detail-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; gap:16px; align-items:center;">
          ${photoCell(e, 'large')}
          <div class="detail-info">
            <div class="detail-name" ${esAdminMaster ? `style="cursor:pointer" onclick="editarMetaEmpleado('${e.id}', 'nombre', '${e.nombre}')"` : ''}>${escapeHtml(e.nombre)}</div>
            <div class="detail-meta">
              <span ${esAdminMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'id', '${e.id}')"` : ''}><i class="fas fa-id-card"></i> ${escapeHtml(e.id)}</span>
              <span ${esAdminMaster ? `class="editable-cell" onclick="editarMetaEmpleado('${e.id}', 'area', '${e.area || ''}')"` : ''}><i class="fas fa-building"></i> ${escapeHtml(e.area || 'Sin área')}</span>
              ${tardT > 0 ? `<span class="pill late" style="margin-left:8px"><i class="fas fa-clock"></i> ${tardT} tardanzas</span>` : '<span class="pill ok" style="margin-left:8px"><i class="fas fa-check-circle"></i> Puntual</span>'}
            </div>
          </div>
        </div>
        <div class="periodo-selector" style="background:var(--white); padding:8px 16px; border-radius:8px; border:1px solid var(--g200); box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <label style="font-size:12px; font-weight:600; color:var(--g600); margin-right:8px;"><i class="fas fa-calendar-alt"></i> Período:</label>
          <select id="filtroPeriodoDetalle" class="filter-select" onchange="mostrarDetalle('${e.id}', parseInt(this.value))" style="font-size:13px; font-weight:500;">
            ${optionsPeriodos}
          </select>
        </div>
      </div>
      
      <div style="padding:var(--pad);background:var(--g50);border-bottom:1px solid var(--g200)">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:12px;">
            <div class="kpi-card" style="--card-color:var(--blue); padding:12px; display:flex; flex-direction:column; justify-content:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-calendar-check"></i> Días Trabajados</div>
              <div class="detail-stat-value" style="font-size:var(--fxl)">${dias}</div>
            </div>
            <div class="kpi-card" style="--card-color:var(--green); padding:12px; display:flex; flex-direction:column; justify-content:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-sign-in-alt"></i> Total Entradas</div>
              <div class="detail-stat-value" style="font-size:var(--fxl)">${entT}</div>
            </div>
            <div class="kpi-card" style="--card-color:var(--amber); padding:12px; display:flex; flex-direction:column; justify-content:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-sign-out-alt"></i> Total Salidas</div>
              <div class="detail-stat-value" style="font-size:var(--fxl)">${salT}</div>
            </div>
            <div class="kpi-card" style="--card-color:var(--purple); padding:12px; display:flex; flex-direction:column; justify-content:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-utensils"></i> Alm. en Planta</div>
              <div class="detail-stat-value" style="font-size:var(--fxl)">${almP}</div>
            </div>
            <div style="background:var(--white); padding:12px; border-radius:8px; border:1px solid var(--g200); display:flex; flex-direction:column; justify-content:center; text-align:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-hourglass-start"></i> Prom. entrada</div>
              <div class="detail-stat-value" style="font-size:var(--flg); margin-top:4px;">${minsToHHMM(pE)}</div>
            </div>
            <div style="background:var(--white); padding:12px; border-radius:8px; border:1px solid var(--g200); display:flex; flex-direction:column; justify-content:center; text-align:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-hourglass-end"></i> Prom. salida</div>
              <div class="detail-stat-value" style="font-size:var(--flg); margin-top:4px;">${minsToHHMM(pS)}</div>
            </div>
            <div style="background:var(--white); padding:12px; border-radius:8px; border:1px solid var(--g200); display:flex; flex-direction:column; justify-content:center; text-align:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-chart-line"></i> Horas totales</div>
              <div class="detail-stat-value" style="font-size:var(--flg); color:var(--green); margin-top:4px;">${String(thH).padStart(2, '0')}:${String(thM).padStart(2, '0')}:${String(thS).padStart(2, '0')}</div>
            </div>
            <div style="background:var(--white); padding:12px; border-radius:8px; border:1px solid var(--g200); display:flex; flex-direction:column; justify-content:center; text-align:center;">
              <div class="kpi-label" style="font-size:11px"><i class="fas fa-user-clock"></i> Horas Permiso</div>
              <div class="detail-stat-value" style="font-size:var(--flg); color:var(--indigo); margin-top:4px;">${String(tpH).padStart(2, '0')}:${String(tpM).padStart(2, '0')}</div>
            </div>
        </div>
      </div>
      <div style="padding:var(--pad)">
        <div class="metric-title" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <span><i class="fas fa-history"></i> Historial del período</span>
          <span style="color:var(--indigo);font-weight:600;font-size:13px;background:#e0e7ff;padding:4px 10px;border-radius:12px;">${periodoSeleccionado ? periodoSeleccionado.label : ''}</span>
        </div>
        <div class="table-wrapper">
          <div class="table-scroll-wrap">
            <table class="employee-table table-compact">
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
              <tbody>${filas || '<tr><td colspan="18" class="empty-state">Sin registros</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
      cambiarPanel('detalle');
    }

    function volverADirectorio() { cambiarPanel('directorio'); cargarDirectorio(); }

    // ============================================================
    // NAVEGACIÓN
    // ============================================================
    function cambiarPanel(panel) {
      panelActual = panel;
      document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.panel === panel));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.id === 'panel-' + panel));
      let titles = { 
        dashboard: 'Dashboard Ejecutivo', 
        asistencia: 'Control de Asistencia', 
        detalle: 'Detalle de Empleado',
        reportes: 'Creador Interactivo de Reportes',
        opciones: 'Opciones adicionales'
      };
      $('pageTitle').textContent = titles[panel] || 'Supervisor';
      if (panel !== 'detalle') {
        if (panel === 'dashboard') cargarDashboard();
        else if (panel === 'asistencia') cargarAsistencia();
        else if (panel === 'reportes') inicializarReporteInteractivo();
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

      mostrarLoader(true);
      try {
        let res = await jsonpRequest({
          accion: 'registrarAlmuerzoExtra',
          nombre: 'Almuerzo Extra',
          empresa: 'TCONTROL',
          fecha: fecha,
          tipo: 'Formulario',
          observaciones: observaciones,
          cantidad: cantidad
        });
        mostrarLoader(false);
        if (res?.error) { mostrarToast(res.error, 'error'); return; }
        mostrarToast('Almuerzo Extra registrado', 'success');
        cerrarModal();
        cargarDatosCompletos(true);
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
          docId: '', // ID vacío para que cree uno nuevo
          empleadoId: empleadoId,
          tipo: tipo,
          fecha: fecha,
          campo: 'hora',
          valor: hora
        });

        if (res.ok) {
          mostrarToast('Registro completado', 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
          if (panelActual === 'detalle') mostrarDetalle(empleadoId);
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
        });
        if (res.ok) {
          mostrarToast('Registro eliminado', 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
          if (panelActual === 'detalle') mostrarDetalle(empleadoId);
          else if (panelActual === 'asistencia') cargarAsistencia();
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
      try {
        const limite = new Date();
        limite.setDate(limite.getDate() - diasNum);
        const limiteStr = limite.toLocaleDateString('en-CA');

        mostrarToast('Buscando registros antiguos...', 'info');

        // 1. Obtener registros antiguos de Firebase
        const snap = await db.collection('registros').where('fecha', '<', limiteStr).get();

        if (snap.empty) {
          mostrarLoader(false);
          mostrarToast('No hay registros tan antiguos para archivar.', 'info');
          return;
        }

        const registrosToArchive = [];
        snap.forEach(doc => {
          let data = doc.data();
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
              ts = `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
            } else {
              ts = String(ts);
            }
          }
          data.timestamp = ts || '';

          registrosToArchive.push({ ...data, id: doc.id });
        });

        mostrarToast(`Enviando ${registrosToArchive.length} registros a Sheets...`, 'info');

        // 2. Enviar a Google Apps Script usando POST
        const respuesta = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' }, // Evitar preflight CORS estricto
          body: JSON.stringify({
            accion: 'archivarRegistros',
            registros: registrosToArchive
          })
        });

        const result = await respuesta.json();

        if (result.ok) {
          mostrarToast(`✅ Guardados en Sheets. Borrando de Firebase...`, 'success');

          // 3. Si se guardaron bien, borrarlos de Firebase en lotes
          let batch = db.batch();
          let count = 0;
          for (const reg of registrosToArchive) {
            batch.delete(db.collection('registros').doc(reg.id));
            count++;
            if (count === 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();

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
        } else {
          mostrarLoader(false);
          mostrarToast('Error al guardar en Sheets: ' + (result.error || 'Desconocido'), 'error');
        }
      } catch (err) {
        console.error("Error archivando:", err);
        mostrarLoader(false);
        mostrarToast('Error en el proceso de archivado.', 'error');
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
          docId: '',
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
          await cargarDatosCompletos(true);
          if (panelActual === 'detalle') mostrarDetalle(eid);
          else cargarAsistencia();
        } else {
          mostrarToast(res.error || 'Error', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
      }
    }

    // --- FUNCIONES DE EDICIÓN ADMIN ---
    async function editarValorRegistro(empleadoId, tipo, docId, campo, valorActual, fecha) {
      if (!window.esAdminMaster && !window.isMaster) { mostrarToast('Solo el administrador (1058) puede realizar esta acción.', 'error'); return; }
      
      let nuevo;
      if (campo === 'timestamp') {
        let tsLegible = formatearTimestampCompleto(valorActual);
        nuevo = prompt(`Editar TIMESTAMP para ${tipo} (${fecha || 'Hoy'}):\nUse el formato: DD/MM/YYYY HH:MM:SS`, tsLegible);
        if (nuevo === null) return;
        const parsed = parsearTimestamp(nuevo);
        if (!parsed) {
          mostrarToast('Formato de timestamp inválido. Use el formato: DD/MM/YYYY HH:MM:SS', 'error');
          return;
        }
        nuevo = parsed.timestampFormatted;
      } else {
        nuevo = prompt(`Editar ${campo} para ${tipo} (${fecha || 'Hoy'}):`, valorActual);
        if (nuevo === null || nuevo === valorActual) return;
      }

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'actualizarRegistroGeneral',
          docId: docId || '',
          empleadoId: empleadoId,
          tipo: tipo,
          fecha: fecha || hoy,
          campo: campo,
          valor: nuevo
        });
        if (res.ok) {
          mostrarToast('Registro actualizado', 'success');
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
          if (panelActual === 'detalle') mostrarDetalle(empleadoId);
          else cargarAsistencia();
        } else {
          mostrarToast(res.error || 'Error', 'error');
        }
      } catch (e) {
        mostrarToast('Error de conexión', 'error');
      } finally {
        mostrarLoader(false);
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
          await cargarDatosCompletos();
          const finalId = (campo === 'id') ? nuevo : empleadoId;
          if (panelActual === 'detalle') mostrarDetalle(finalId);
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
          await cargarDatosCompletos(true);
          cargarAsistencia();
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
        if (sessionData.id === "1058") {
          supervisorName = "Admin Master";
        } else {
          let sup = empCache.find(x => x.id === sessionData.id);
          if (sup) supervisorName = sup.nombre;
          else supervisorName = "Supervisor ID " + sessionData.id;
        }
      }

      mostrarLoader(true);
      try {
        const res = await jsonpRequest({
          accion: 'justificarDia',
          empleadoId: window.currentJustifyEmpId,
          fecha: window.currentJustifyFecha,
          razon: razonCompleta,
          supervisor: supervisorName
        });

        mostrarLoader(false);
        if (res && res.ok) {
          mostrarToast('Día justificado correctamente', 'success');
          window.cerrarModalJustificar();
          limpiarCachesLocales();
          await cargarDatosCompletos(true);
        } else {
          mostrarToast(res?.error || 'Error al guardar justificación', 'error');
        }
      } catch (e) {
        mostrarLoader(false);
        mostrarToast('Error al guardar justificación: ' + e.message, 'error');
      }
    };

    // ============================================================
    // CARGA DE DATOS
    // ============================================================
    async function cargarDatosCompletos(force = false) {
      if (estaActualizando) return;
      estaActualizando = true;
      mostrarLoader(true);
      try {
        const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor', force: force });
        mostrarLoader(false);
        estaActualizando = false;
        if (!res || res.error) {
          mostrarToast(res?.error || 'Error al cargar datos', 'error');
          return;
        }
        empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
        window.almuerzosExtra = res.almuerzosExtra || [];
        periodos = generarPeriodos();

        let periodoSelect = $('periodoMensual');
        let tardanzaSelect = $('periodoTardanzas');
        if (periodoSelect) periodoSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
        if (tardanzaSelect) tardanzaSelect.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');

        $('lastUpdate').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        cargarPanelActual();
      } catch (e) {
        mostrarLoader(false);
        estaActualizando = false;
        mostrarToast('Error de conexión: ' + e.message, 'error');
      }
    }

    function cargarPanelActual() {
      if (panelActual === 'dashboard') cargarDashboard();
      else if (panelActual === 'asistencia') cargarAsistencia();
    }

    // ============================================================
    // GESTIÓN DE SESIÓN SUPERVISOR
    // ============================================================
    async function intentarLoginSupervisor() {
      const pin = $('supPin').value.trim();

      if (!pin) {
        mostrarError('Ingrese su contraseña');
        return;
      }

      mostrarLoader(true);
      $('login-error').classList.add('hidden');

      try {
        const deviceToken = generarDeviceToken();
        // Búsqueda solo por PIN para unificar el sistema
        const res = await jsonpRequest({ accion: 'verificarPIN', pin: pin, deviceToken: deviceToken });

        if (res.error) {
          mostrarError(res.error);
        } else if (res.valido) {
          const esMaster = res.empleado.id === "1058";
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

    function verificarEstadoSupervisor() {
      const sessionStr = localStorage.getItem('SUPERVISOR_SESSION');
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          window.isMaster = (session.id === "1058");
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

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => cambiarPanel(item.dataset.panel));
    });
    $('btnRefresh').addEventListener('click', async () => {
      limpiarCachesLocales();
      mostrarToast('Borrando caché local de registros...', 'info');
      await cargarDatosCompletos(true);
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
    document.getElementById('masivoModal').addEventListener('click', e => {
      if (e.target === document.getElementById('masivoModal')) cerrarModalMasivo();
    });

    // Inicio
    console.log("🛠️ Iniciando Panel Supervisor...");
    if (!window.FirebaseBackend) {
      console.error("❌ FirebaseBackend no cargado. Reintentando...");
    }
    verificarEstadoSupervisor();

    // Eventos Login
    if ($('supPin')) {
      $('supPin').addEventListener('keypress', e => { if (e.key === 'Enter') intentarLoginSupervisor(); });
      setTimeout(() => $('supPin').focus(), 500);
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

    // Asegurar que al hacer clic en cualquier parte del card se enfoque el input
    if (document.querySelector('.login-card')) {
      document.querySelector('.login-card').addEventListener('click', () => $('supPin').focus());
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
      const selectPeriodo = $('periodoCustomReportes');
      if (selectPeriodo && periodos.length) {
        selectPeriodo.innerHTML = periodos.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
      }
      actualizarReporteInteractivo();
    };

    window.actualizarReporteInteractivo = function() {
      const selectPeriodo = $('periodoCustomReportes');
      const idx = parseInt(selectPeriodo?.value || 0);
      let periodo = periodos[idx];
      if (!periodo || !empCache.length) return;

      const hoyRep = new Date().toISOString().split('T')[0];
      
      // Calcular estadísticas de manera idéntica a cargarReportes()
      _reportesCustomData = empCache.map(e => {
        let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
        let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
        let diasLaborablesTotal = obtenerDiasHabiles(periodo.inicio, periodo.fin);
        let diasLaborables = diasLaborablesTotal.filter(d => d <= hoyRep);
        let diasAsistidos = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f)).size;

        let faltas = Math.max(0, diasLaborables.length - diasAsistidos);

        let atrasos = 0;
        let minutosAtrasos = 0;
        let almPlanta = 0, almFuera = 0;
        entradas.forEach(r => {
          let m = obtenerMinutos(r.hora);
          if (m !== null) {
            const esFestivoR = esFeriadoODomingo(r.fecha) || (new Date(r.fecha + 'T12:00:00').getDay() === 6);
            const refEntradaR = esFestivoR ? 420 : HORA_ENTRADA_REF;
            if (m > refEntradaR) {
              atrasos++;
              minutosAtrasos += m - refEntradaR;
            }
          }
        });

        let registrosAlmuerzo = (e.registros || []).filter(r => (r.tipo === 'ENTRADA' || r.tipo === 'SOLO_ALMUERZO') && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
        registrosAlmuerzo.forEach(r => {
          if (r.almuerzo === 'SI') almPlanta++;
          if (r.almuerzo === 'NO') almFuera++;
        });
        let puntualidad = diasAsistidos ? Math.round((1 - atrasos / diasAsistidos) * 100) : 0;

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
        let currDate = new Date(periodo.inicio + 'T00:00:00');
        let endDate = new Date(periodo.fin + 'T00:00:00');
        while (currDate <= endDate) {
          todasLasFechas.push(currDate.toISOString().split('T')[0]);
          currDate.setDate(currDate.getDate() + 1);
        }

        todasLasFechas.forEach(fecha => {
          const regsDia = (e.registros || []).filter(r => r.fecha === fecha);
          const esFestivo = esFeriadoODomingo(fecha) || (new Date(fecha + 'T12:00:00').getDay() === 6);
          const isJustificado = regsDia.some(r => r.justificado === 'SI');

          if (regsDia.length === 0) {
            if (!esFestivo && diasLaborables.includes(fecha)) {
              totalTiempoPorJustificar += 480;
            }
            return;
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

          sortedRegs.forEach(r => {
            const tipo = String(r.tipo || '').toUpperCase();
            if (tipo === 'ENTRADA' || tipo === 'RETORNO_CAMPO') {
              let mE = obtenerMinutos(r.hora);
              if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
                let gap = mE - ultimoSalidaMins;
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

          ultimoSalidaMins = null;
          ultimoSalidaReg = null;

          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora);
            let mS = obtenerMinutos(p.salida.hora);
            if (mE === null || mS === null || mS <= mE) return;
            let duracion = mS - mE;
            minutosTrabajadosHoy += duracion;

            if (ultimoSalidaMins !== null && mE > ultimoSalidaMins) {
              let gap = mE - ultimoSalidaMins;
              let clasif = clasificarGap(ultimoSalidaReg, gap);
              if (clasif.tipo === 'medico') dayMedico += gap;
              else if (clasif.tipo === 'personal') dayPersonal += gap;
              else dayJustificar += gap;
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
          } else {
            if (netWorked >= 600) autorizado = true;
          }

          let extraMins50Acum = 0;
          let extraMins100Acum = 0;
          let shiftMins = 0;

          periodosDia.forEach(p => {
            if (!p.entrada || !p.salida) return;
            let mE = obtenerMinutos(p.entrada.hora);
            let mS = obtenerMinutos(p.salida.hora);
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

          if (!isJustificado) {
            let missingMinutes = 0;
            missingMinutes = Math.max(0, 480 - netWorked);
            let totalPermisosHoy = dayPersonal + dayMedico + dayJustificar;
            let unaccountedMissing = Math.max(0, missingMinutes - totalPermisosHoy);
            totalTiempoPorJustificar += unaccountedMissing;
          }
        });

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
      const containerDisponibles = $('columnasDisponibles');
      const containerActivas = $('columnasActivas');
      if (!containerDisponibles || !containerActivas) return;

      containerDisponibles.innerHTML = '';
      containerActivas.innerHTML = '';

      COLUMNAS_DISPONIBLES.forEach(col => {
        const isActiva = columnasCustomActivas.includes(col.id);
        const chip = document.createElement('div');
        chip.className = `chip-item ${isActiva ? 'activa' : 'disponible'}`;
        chip.setAttribute('draggable', 'true');
        chip.setAttribute('id', `chip-${col.id}`);
        chip.innerHTML = `${isActiva ? '<i class="fas fa-check"></i>' : '<i class="fas fa-plus"></i>'} ${col.label}`;
        
        chip.addEventListener('dragstart', (e) => dragCustom(e, col.id));
        chip.addEventListener('click', () => {
          if (isActiva) quitarColumnaCustom(col.id);
          else agregarColumnaCustom(col.id);
        });

        if (isActiva) {
          containerActivas.appendChild(chip);
        } else {
          containerDisponibles.appendChild(chip);
        }
      });

      if (!columnasCustomActivas.length) {
        containerActivas.innerHTML = '<div style="color:var(--g400); font-size:11.5px; padding:10px; width:100%; text-align:center;"><i class="fas fa-info-circle"></i> No hay columnas en el reporte. Selecciona algunas de la izquierda.</div>';
      }
      if (columnasCustomActivas.length === COLUMNAS_DISPONIBLES.length) {
        containerDisponibles.innerHTML = '<div style="color:var(--g400); font-size:11.5px; padding:10px; width:100%; text-align:center;"><i class="fas fa-check-circle"></i> Todas las columnas añadidas.</div>';
      }
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

      // Headers
      function sortIconCustom(colId) {
        if (_sortCustomReport.col !== colId) return '<i class="fas fa-sort" style="opacity:.2;margin-left:4px;font-size:9px"></i>';
        return _sortCustomReport.dir === 'asc'
          ? '<i class="fas fa-sort-up" style="color:var(--red);margin-left:4px;font-size:9px"></i>'
          : '<i class="fas fa-sort-down" style="color:var(--red);margin-left:4px;font-size:9px"></i>';
      }

      let headersHtml = `<th onclick="sortReporteCustom('nombre')">Empleado ${sortIconCustom('nombre')}</th><th onclick="sortReporteCustom('area')">Área ${sortIconCustom('area')}</th>`;
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          headersHtml += `<th onclick="sortReporteCustom('${col.id}')" style="text-align:center; cursor:pointer;">${col.label} ${sortIconCustom(col.id)}</th>`;
        }
      });

      const headerTr = $('reporteCustomHeaders');
      if (headerTr) headerTr.innerHTML = headersHtml;

      // Body
      const bodyT = $('reporteCustomBody');
      if (!bodyT) return;

      if (!data.length) {
        bodyT.innerHTML = `<tr><td colspan="${columnasCustomActivas.length + 2}" style="text-align:center; padding:30px; color:var(--g500);"><i class="fas fa-search" style="font-size:18px; margin-bottom:8px; display:block;"></i> No se encontraron resultados.</td></tr>`;
        if ($('reporteCustomInfo')) $('reporteCustomInfo').textContent = 'Mostrando 0 empleados';
        return;
      }

      bodyT.innerHTML = data.map(e => {
        let rowHtml = `<tr><td><div class="employee-cell">${photoCell(e)}<span>${escapeHtml(e.nombre)}</span></div></td><td>${escapeHtml(e.area || '—')}</td>`;

        COLUMNAS_DISPONIBLES.forEach(col => {
          if (columnasCustomActivas.includes(col.id)) {
            const valor = e[col.id];
            let contenido = '';
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
        });

        rowHtml += '</tr>';
        return rowHtml;
      }).join('');

      if ($('reporteCustomInfo')) {
        $('reporteCustomInfo').textContent = `Mostrando ${data.length} empleados de ${empCache.length}`;
      }
    };

    window.restablecerColumnasDefault = function() {
      columnasCustomActivas = ['asistencias', 'faltas', 'atrasos', 'puntualidad', 'totalExtras50', 'totalExtras100'];
      guardarColumnasCustomActivas(columnasCustomActivas);
      renderizarColumnasInteractivas();
      filtrarReporteInteractivo();
      mostrarToast('Columnas restablecidas por defecto', 'info');
    };

    window.cargarPlantillaReporte = function(tipo) {
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

    window.exportarExcelReporteCustom = function() {
      if (!_reportesCustomData.length) {
        mostrarToast('No hay datos para exportar', 'warning');
        return;
      }

      const selectPeriodo = $('periodoCustomReportes');
      const idx = parseInt(selectPeriodo?.value || 0);
      let periodo = periodos[idx];
      let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';

      let q = ($('searchReportesCustom')?.value || '').toLowerCase();
      let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
      let data = (_reportesCustomData || []).filter(e => {
          let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
          let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
          return matchQ && matchCargo;
      });

      let headersHtml = '<th>Empleado</th><th>Área</th>';
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          headersHtml += `<th>${col.label}</th>`;
        }
      });

      let bodyHtml = data.map(e => {
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
            <tr><td colspan="${columnasCustomActivas.length + 2}" class="title-cell">TCONTROL S.A. - REPORTE DE ASISTENCIA</td></tr>
            <tr><td colspan="${columnasCustomActivas.length + 2}" class="meta-cell">Periodo: ${periodoStr} | Generado: ${new Date().toLocaleString('es')}</td></tr>
            <tr><td colspan="${columnasCustomActivas.length + 2}" style="height:15px;"></td></tr>
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
      if (!_reportesCustomData.length) {
        mostrarToast('No hay datos para exportar', 'warning');
        return;
      }

      const selectPeriodo = $('periodoCustomReportes');
      const idx = parseInt(selectPeriodo?.value || 0);
      let periodo = periodos[idx];
      let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';
      
      // Nombre de hoja seguro (max 30 chars, sin caracteres ilegales)
      let nombreHoja = `Rep_${periodoStr.replace(/ — /g, '_').replace(/ /g, '_')}`;
      
      let q = ($('searchReportesCustom')?.value || '').toLowerCase();
      let fCargo = ($('filtroCargoReporte')?.value || '').toLowerCase();
      let data = (_reportesCustomData || []).filter(e => {
          let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
          let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
          return matchQ && matchCargo;
      });

      // Construir cabeceras
      let headers = ['Empleado', 'Área'];
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          headers.push(col.label);
        }
      });

      // Construir filas
      let filas = data.map(e => {
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
      let data = (_reportesCustomData || []).filter(e => {
          let matchQ = !q || e.nombre.toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q);
          let matchCargo = !fCargo || (e.cargo || '').toLowerCase() === fCargo;
          return matchQ && matchCargo;
      });
      if (!data.length) {
        mostrarToast('No hay datos para imprimir', 'warning');
        return;
      }

      const selectPeriodo = $('periodoCustomReportes');
      const idx = parseInt(selectPeriodo?.value || 0);
      let periodo = periodos[idx];
      let periodoStr = periodo ? periodo.label.replace('⭐ ', '').replace(' (Actual)', '') : 'Reporte';

      let printWindow = window.open('', '_blank');
      if (!printWindow) {
        mostrarToast('Error al abrir la ventana de impresión. Por favor habilite los pop-ups.', 'error');
        return;
      }

      // Generar headers de impresión
      let headersHtml = '<th>Empleado</th><th>Área</th>';
      COLUMNAS_DISPONIBLES.forEach(col => {
        if (columnasCustomActivas.includes(col.id)) {
          headersHtml += `<th>${col.label}</th>`;
        }
      });

      // Generar filas de impresión
      let bodyHtml = data.map(e => {
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

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Reporte de Asistencia - ${periodoStr}</title>
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
            <h1>TCONTROL S.A. - REPORTE OFICIAL DE ASISTENCIA</h1>
            <p>Período de Consulta: ${periodoStr}</p>
          </div>
          <div class="info-meta">
            <div>Generado el: ${new Date().toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div>Total Empleados Evaluados: ${data.length}</div>
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
      const COLUMNAS_ORDENADAS = ['id', 'nombre', 'area', 'cargo', 'pin', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento'];
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
        supervisor: "Supervisor",
        activo: "Activo",
        foto_url: "URL Foto",
        baseLat: "Latitud",
        baseLng: "Longitud",
        fechaNacimiento: "F. Nacimiento"
      };
      
      function camelCaseToTitle(key) {
        const result = key.replace(/([A-Z])/g, " $1");
        return result.charAt(0).toUpperCase() + result.slice(1);
      }
      
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
          'deviceToken', 'id_dispositivo'
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
        const COLUMNAS_ORDENADAS = ['id', 'nombre', 'area', 'cargo', 'pin', 'supervisor', 'activo', 'foto_url', 'baseLat', 'baseLng', 'fechaNacimiento'];
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
          supervisor: "Supervisor (SI/NO)",
          activo: "Activo (SI/NO)",
          foto_url: "URL Foto",
          baseLat: "Latitud Base",
          baseLng: "Longitud Base",
          fechaNacimiento: "Fecha Nacimiento"
        };
        
        function camelCaseToTitle(key) {
          const result = key.replace(/([A-Z])/g, " $1");
          return result.charAt(0).toUpperCase() + result.slice(1);
        }
        
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
          await cargarDatosCompletos(true);
        } else {
          mostrarToast(res?.error || 'Error al guardar los datos de empleados.', 'error');
        }
      } catch (err) {
        mostrarLoader(false);
        mostrarToast('Error de red al enviar la actualización masiva: ' + err.message, 'error');
      }
    };