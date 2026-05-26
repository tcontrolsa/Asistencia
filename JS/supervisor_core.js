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

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function mostrarToast(msg, tipo) {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = 'toast-msg' + (tipo ? ' ' + tipo : '');
      el.textContent = msg;
      container.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }

    function mostrarLoader(show) {
      const loader = document.getElementById('loader');
      if (loader) loader.classList.toggle('hidden', !show);
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
      for (let i = 0; i < 12; i++) {
        let iniDate = new Date(ahora.getFullYear(), ahora.getMonth() - i - 1, 26);
        let finDate = new Date(ahora.getFullYear(), ahora.getMonth() - i, 25);
        let label = iniDate.getDate() + ' ' + iniDate.toLocaleDateString('es', { month: 'short' }) + ' — ' + finDate.getDate() + ' ' + finDate.toLocaleDateString('es', { month: 'short', year: 'numeric' });
        lista.push({
          inicio: iniDate.toISOString().split('T')[0],
          fin: finDate.toISOString().split('T')[0],
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

      let hoyP = 0, hoyA = 0, hoyT = 0, hoySalieron = 0;
      empCache.forEach(e => {
        let entr = (e.registros || []).find(r => r.fecha === hoy && r.tipo === 'ENTRADA');
        let sal = (e.registros || []).find(r => r.fecha === hoy && r.tipo === 'SALIDA');
        if (entr) {
          hoyP++;
          let m = obtenerMinutos(entr.hora);
          if (m !== null && m > HORA_ENTRADA_REF) hoyT++;
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
            if (m !== null && m > HORA_ENTRADA_REF) tard++;
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

        let puntMap = {}, tardMap = {}, sinSalidaMap = {};
        empCache.forEach(e => {
          let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);
          let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= hoy_);
          
          let entradasPorDia = {};
          entradas.forEach(r => {
            if (!entradasPorDia[r.fecha]) entradasPorDia[r.fecha] = [];
            entradasPorDia[r.fecha].push(r);
          });

          let tardE = 0, nE = 0, faltasS = 0;
          
          Object.keys(entradasPorDia).forEach(fecha => {
            let regs = entradasPorDia[fecha];
            // Tomar la primera entrada del día
            regs.sort((a, b) => obtenerMinutos(a.hora) - obtenerMinutos(b.hora));
            let firstE = regs[0];
            
            let m = obtenerMinutos(firstE.hora);
            if (m !== null) {
              nE++;
              if (m > HORA_ENTRADA_REF) tardE++;
            }
            
            // Exceptuar el día de hoy ya que aún no termina
            if (fecha !== hoy_) {
              let tieneSalida = salidas.some(s => s.fecha === fecha);
              if (!tieneSalida) faltasS++;
            }
          });

          if (nE > 0) puntMap[e.id] = { nombre: e.nombre, area: e.area, p: Math.round((1 - tardE / nE) * 100), id: e.id, asist: nE };
          if (tardE > 0) tardMap[e.id] = { nombre: e.nombre, area: e.area, tardanzas: tardE, id: e.id, asist: nE };
          if (faltasS > 0) sinSalidaMap[e.id] = { nombre: e.nombre, area: e.area, faltasSalida: faltasS, id: e.id };
        });

        let topP = Object.values(puntMap).sort((a, b) => {
          if (b.p !== a.p) return b.p - a.p;
          return b.asist - a.asist; // Desempate: mayor asistencia
        }).slice(0, 10);
        if($('topPuntuales')) $('topPuntuales').innerHTML = topP.length ? topP.map((e, i) => `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--g400);font-weight:600;margin-bottom:-2px">${e.asist} asist.</span><span>${e.p}%</span></div></div>`).join('') : '<div class="empty-state">Sin datos</div>';
        
        let topTard = Object.values(tardMap).sort((a, b) => {
          if (b.tardanzas !== a.tardanzas) return b.tardanzas - a.tardanzas;
          return b.asist - a.asist; // Desempate: mayor asistencia
        }).slice(0, 10);
        if($('topTardanzasRanking')) $('topTardanzasRanking').innerHTML = topTard.length ? topTard.map((e, i) => `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--g400);font-weight:600;margin-bottom:-2px">en ${e.asist} asis.</span><span>${e.tardanzas} tard.</span></div></div>`).join('') : '<div class="empty-state">Sin tardanzas</div>';
        
        let sinSList = Object.values(sinSalidaMap).sort((a, b) => b.faltasSalida - a.faltasSalida).slice(0, 10);
        if ($('sinSalidaRanking')) {
          $('sinSalidaRanking').innerHTML = sinSList.length ? sinSList.map((e, i) => `<div class="ranking-item" onclick="mostrarDetalle('${e.id}')"><div class="ranking-position ${i === 0 ? 'top' : ''}">${i + 1}</div><div class="ranking-info"><div class="ranking-name">${escapeHtml(e.nombre)}</div><div class="ranking-area">${escapeHtml(e.area || 'Sin área')}</div></div><div class="ranking-value" style="color:var(--purple);font-weight:700;display:flex; flex-direction:column; align-items:flex-end"><span style="font-size:10px;color:var(--purple-lt);font-weight:600;margin-bottom:-2px">faltas</span><span>${e.faltasSalida} sin salida</span></div></div>`).join('') : '<div class="empty-state">Todos han registrado su salida</div>';
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
            if (m !== null && m - HORA_SALIDA_REF > 1) extraTotal += m - HORA_SALIDA_REF;
          });
        });
        if($('horasExtraTotal')) $('horasExtraTotal').textContent = formatearMinutos(extraTotal);

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
      let html = `<table class="employee-table"><thead><tr><th>Empleado</th><th>Área</th><th>Asistencias</th><th>Faltas</th><th>Tardanzas</th><th>Alm. Planta</th><th>Alm. Fuera</th><th>Puntualidad</th></tr></thead><tbody>`;
      html += data.sort((a, b) => b.asist - a.asist).map(e => {
        let pc = e.punt >= 90 ? 'ok' : e.punt >= 70 ? 'late' : 'miss';
        return `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<strong>${escapeHtml(e.nombre)}</strong></div></div></td><td>${escapeHtml(e.area || '—')}</div></td><td><span class="pill ok">${e.asist}</span></td><td><span class="pill ${e.faltas ? 'miss' : 'ok'}">${e.faltas}</span></td><td><span class="pill ${e.tards ? 'late' : 'ok'}">${e.tards}</span></div></td><td><span class="pill late">${e.almP}</span></div></td><td><span class="pill" style="background:#dbeafe">${e.almF}</span></div></td><td><span class="pill ${pc}">${e.punt}%</span></div></tr>`;
      }).join('');
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
          if (mins - HORA_ENTRADA_REF > 1) { t++; m += mins - HORA_ENTRADA_REF; }
        });
        salidas.forEach(r => {
          let mins = obtenerMinutos(r.hora);
          if (mins !== null && mins - HORA_SALIDA_REF > 1) x++;
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
      let tards = empCache.filter(e => { if (!e.entradaHoy) return false; let m = obtenerMinutos(e.horaEntradaMs); return m !== null && m > HORA_ENTRADA_REF; }).length;
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
        let tard = mEnt !== null && mEnt > HORA_ENTRADA_REF;

        let eHtml = e.entradaHoy ? `<span class="editable-cell" ${clickEntrada}>${mEnt !== null ? minsToHHMM(mEnt) : 'Registrada'}${tard ? ` <span class="delta pos">+${formatearMinutos(mEnt - HORA_ENTRADA_REF)}</span>` : ''}</span>` : `<span class="editable-cell empty" ${clickEntrada}>-</span>`;

        let sHoraV = e.horaSalidaMs || sReg?.hora || sReg?.timestamp;
        let mSal = e.salidaHoy ? obtenerMinutos(sHoraV) : null;
        let sHtml = e.salidaHoy ? `<span class="editable-cell" ${clickSalida}>${mSal !== null ? minsToHHMM(mSal) : 'Registrada'}${mSal - HORA_SALIDA_REF > 1 ? ` <span class="delta neg">+${formatearMinutos(mSal - HORA_SALIDA_REF)}</span>` : ''}</span>` : (e.entradaHoy ? `<span class="editable-cell empty" ${clickSalida}>Pendiente</span>` : `<span class="editable-cell empty" ${clickSalida}>-</span>`);

        let estHtml = !e.entradaHoy ? '<span class="pill miss"><i class="fas fa-times"></i> Ausente</span>' : tard ? '<span class="pill late"><i class="fas fa-exclamation"></i> Tarde</span>' : '<span class="pill ok"><i class="fas fa-check"></i> Puntual</span>';

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

        let puedeEditar = e.entradaHoy || esAdminMaster;
        let toggle = `<div class="almuerzo-toggle"><button class="toggle-option ${e.almuerzoHoy === 'SI' ? 'active-si' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','SI')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-building"></i> Sí</button><button class="toggle-option ${e.almuerzoHoy === 'NO' ? 'active-no' : ''} ${!puedeEditar ? 'disabled' : ''}" onclick="event.stopPropagation();cambiarEstadoAlmuerzo('${e.id}','NO')" ${!puedeEditar ? 'disabled' : ''}><i class="fas fa-home"></i> No</button></div>`;

        return { ...e, _eH: eHtml, _sH: sHtml, _est: estHtml, _toggle: toggle, _tard: tard, _entradaHoy: e.entradaHoy, _almuerzoHoy: e.almuerzoHoy, _salidaHoy: e.salidaHoy, _modo: modoHtml, _extras: extrasHtml, id: e.id };
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
          await cargarDatosCompletos();
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
      let html = `<table class="employee-table"><thead><tr><th onclick="sortAsistencia('nombre')" style="cursor:pointer">Empleado <i class="fas fa-sort" style="opacity:.3;font-size:9px"></i></th><th>Área</th><th>Entrada</th><th>Salida</th><th>Modo</th><th>Extras</th><th>Estado</th><th>Almuerzo</th></tr></thead><tbody>`;
      html += data.map(e => `<tr onclick="mostrarDetalle('${e.id}')"><td><div class="employee-cell">${photoCell(e)}<strong>${escapeHtml(e.nombre)}</strong></div></td><td>${escapeHtml(e.area || '—')}</td><td>${e._eH}</td><td>${e._sH}</td><td>${e._modo}</td><td>${e._extras}</td><td>${e._est}</td><td>${e._toggle}</td></tr>`).join('');
      html += `</tbody></table>`;
      $('asistenciaTablaContainer').innerHTML = html;
    }

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
      let html = '<div style="margin-bottom:16px;padding:12px;background:var(--g50);border-radius:12px;border:1px solid var(--g200)">';
      html += '<div style="font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px"><i class="fas fa-sliders-h"></i> Columnas visibles</div>';
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
      let stats = empCache.map(e => {
        let entradas = (e.registros || []).filter(r => r.tipo === 'ENTRADA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
        let salidas = (e.registros || []).filter(r => r.tipo === 'SALIDA' && r.fecha >= periodo.inicio && r.fecha <= periodo.fin);
        // Días laborables solo hasta hoy (no días futuros del período)
        let diasLaborablesTotal = obtenerDiasHabiles(periodo.inicio, periodo.fin);
        let diasLaborables = diasLaborablesTotal.filter(d => d <= hoyRep);
        let diasAsistidos = new Set(entradas.map(r => normalizarFechaStr(r.fecha)).filter(f => f)).size;

        // FALTAS: días hábiles transcurridos menos días asistidos
        let faltas = Math.max(0, diasLaborables.length - diasAsistidos);

        // PERMISOS: leer desde razon_salida de los registros reales
        let permisoMedico = 0, permisoPersonal = 0;
        salidas.forEach(r => {
          const rs = (r.razon_salida || r.razonSalidaTemprana || '').toLowerCase();
          if (rs.includes('medico') || rs === 'permiso_medico') permisoMedico++;
          else if (rs.includes('personal') || rs === 'permiso_personal') permisoPersonal++;
        });

        // ATRASOS + ALMUERZO + PUNTUALIDAD
        let atrasos = 0;
        let minutosAtrasos = 0;
        let almPlanta = 0, almFuera = 0;
        entradas.forEach(r => {
          let m = obtenerMinutos(r.hora);
          if (m !== null && m > HORA_ENTRADA_REF) {
            atrasos++;
            minutosAtrasos += m - HORA_ENTRADA_REF;
          }
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

        const diasUnicos = [...new Set((e.registros || []).map(r => r.fecha))].filter(f => f >= periodo.inicio && f <= periodo.fin);

        diasUnicos.forEach(fecha => {
          const regsDia = (e.registros || []).filter(r => r.fecha === fecha);
          const entrada = regsDia.find(r => r.tipo === 'ENTRADA');
          const salida = regsDia.find(r => r.tipo === 'SALIDA');
          if (!entrada || !salida) return;

          const esFestivo = esFeriadoODomingo(fecha);
          const mEnt = obtenerMinutos(entrada.hora);
          const mSal = obtenerMinutos(salida.hora);
          if (mEnt === null || mSal === null || mSal <= mEnt) return;

          const enCampo = entrada.modo === 'CAMPO' || salida.modo === 'CAMPO';
          const autorizado = (entrada.horasExtra === 'SI' || salida.horasExtra === 'SI');

          if (esFestivo) {
            if (autorizado) {
              if (enCampo) horasCampo100 += (mSal - mEnt);
              else horasExtra100 += (mSal - mEnt);
            }
          } else {
            // Horario normal: 07:30 - 16:15
            const H_INI = HORA_ENTRADA_REF;
            const H_FIN = HORA_SALIDA_REF;

            let normal = 0, extra50 = 0;

            // Tiempo antes de la jornada
            if (mEnt < H_INI) {
              if (enCampo) extra50 += (H_INI - mEnt);
              else if (autorizado) extra50 += (H_INI - mEnt);
              normal += (Math.min(mSal, H_FIN) - H_INI);
            } else {
              normal += (Math.min(mSal, H_FIN) - mEnt);
            }

            // Tiempo después de la jornada
            if (mSal > H_FIN) {
              if (autorizado) extra50 += (mSal - H_FIN);
            }

            if (enCampo) {
              horasCampoNormales += Math.max(0, normal);
              horasCampo50 += Math.max(0, extra50);
            } else {
              horasExtra50 += Math.max(0, extra50);
            }
          }
        });

        return {
          id: e.id,
          nombre: e.nombre,
          area: e.area,
          asistencias: diasAsistidos,
          faltas: faltas,
          permisoMedico: permisoMedico,
          permisoPersonal: permisoPersonal,
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
      $('repPermisoMedico').textContent = totalPermisoMedico;
      $('repPermisoPersonal').textContent = totalPermisoPersonal;
      $('repAtrasos').textContent = totalAtrasos;
      $('repHorasExtra50').textContent = formatearHorasDecimal(totalHorasExtra50);
      $('repHorasExtra100').textContent = formatearHorasDecimal(totalHorasExtra100);
      $('repHorasCampoNormales').textContent = formatearHorasDecimal(totalHorasCampoNormales);
      $('repHorasCampo50').textContent = formatearHorasDecimal(totalHorasCampo50);
      $('repHorasCampo100').textContent = formatearHorasDecimal(totalHorasCampo100);
      $('repTotalExtras50').textContent = formatearHorasDecimal(totalExtras50);
      $('repTotalExtras100').textContent = formatearHorasDecimal(totalExtras100);
      $('repTotalHorasExtra').textContent = formatearHorasDecimal(totalHorasExtra);

      window._reportesData = stats;
      // Cargar preferencias de columnas al cargar datos
      if (!localStorage.getItem('columnasVisiblesReporte_v2')) {
        guardarColumnasVisibles(COLUMNAS_DISPONIBLES.map(c => c.id));
      }
      filtrarTablaReportes();
    }

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
              contenido = `<span style="font-family:'DM Mono',monospace;font-size:10px">${minutosAHHMMSS(valor)}</span>`;
            } else if (col.tipo === 'pct') {
              let pc = valor >= 90 ? 'ok' : valor >= 70 ? 'late' : 'miss';
              contenido = `<span class="pill ${pc}" style="font-size:10px;padding:2px 7px">${valor}%</span>`;
            } else if (col.id === 'faltas') {
              contenido = `<span class="pill ${valor > 0 ? 'miss' : 'ok'}" style="font-size:10px;padding:2px 7px">${valor}</span>`;
            } else if (col.id === 'atrasos') {
              contenido = `<span class="pill ${valor > 0 ? 'late' : 'ok'}" style="font-size:10px;padding:2px 7px">${valor}</span>`;
            } else if (col.id.startsWith('total') || col.id.startsWith('Total')) {
              contenido = `<strong style="font-family:'DM Mono',monospace;font-size:10px">${valor}</strong>`;
            } else {
              contenido = `<span style="font-family:'DM Mono',monospace;font-size:10px">${valor}</span>`;
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
        if (r.tipo === 'ENTRADA') { sE += m; cE++; if (m > HORA_ENTRADA_REF) tardT++; }
        else { sS += m; cS++; }
      });
      let pE = cE ? Math.round(sE / cE) : null;
      let pS = cS ? Math.round(sS / cS) : null;

      let porDia = {};
      // Asegurar que los registros estén ordenados cronológicamente para el emparejamiento
      [...regs].sort((a, b) => {
        const timeA = a.timestamp || a.hora;
        const timeB = b.timestamp || b.hora;
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

        // Descontar 45 min si trabajó más de 4 horas ese día
        if (minutosDia > 240) minutosDia -= 45;
        tSegs += minutosDia * 60;
      });

      // Mostrar todos los días del período
      let filas = fechasOrdenadas.map(f => {
        let d = porDia[f];
        let regsDia = d.registros;

        let periodosDia = [];
        let entradaPendiente = null;
        let minutosPermisoHoy = 0;
        let ultimoSalidaMins = null;

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
            return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.entrada.tipo}', '${p.entrada.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.entrada.id}', '${e.id}', '${f}', '${p.entrada.tipo}')"><i class="fas fa-trash"></i></button></div>`;
          }
          if (esAdminMaster && !p.entrada) {
            return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'ENTRADA', '07:30:00', '${f}')"><i class="fas fa-plus"></i> 07:30</button>`;
          }
          return valor;
        }).join('<br>');

        let horaS = periodosDia.map(p => {
          const valor = p.salida ? formatearHora(p.salida.hora || p.salida.timestamp) : '--:--';
          if (esAdminMaster && p.salida) {
            return `<div class="editable-row-cell"><span class="editable-cell" onclick="event.stopPropagation();editarValorRegistro('${e.id}', '${p.salida.tipo}', '${p.salida.id}', 'hora', '${valor}', '${f}')">${valor}</span><button class="btn-delete-tiny" onclick="event.stopPropagation();eliminarRegistroSupervisor('${p.salida.id}', '${e.id}', '${f}', '${p.salida.tipo}')"><i class="fas fa-trash"></i></button></div>`;
          }
          if (esAdminMaster && !p.salida) {
            return `<button class="btn-quick-add" onclick="event.stopPropagation();completarRegistro('${e.id}', 'SALIDA', '16:15:00', '${f}')"><i class="fas fa-plus"></i> 16:15</button>`;
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
          if (mE !== null && mE > HORA_ENTRADA_REF) atrasoMins = mE - HORA_ENTRADA_REF;
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
        });

        let razonesCompletas = razonesBadges.length > 0 ? `<div style="display:flex; flex-direction:column; gap:4px;">${razonesBadges.join('')}</div>` : '';
        const diaSemana = obtenerDiaSemanaStr(f);
        let fechaFormateada = `<span style="font-size:10px;color:var(--g400);display:block">${diaSemana}</span>${f.slice(8, 10)}/${f.slice(5, 7)}`;

        let h50 = 0, h100 = 0, hCN = 0, hC50 = 0, hC100 = 0;
        let minutosTrabajadosHoy = 0;
        let esFestivo = esFeriadoODomingo(f);
        let autorizadoGlobal = regsDia.some(r => r.horasExtra === 'SI');

        periodosDia.forEach(p => {
          if (!p.entrada || !p.salida) return;
          let mE = obtenerMinutos(p.entrada.hora);
          let mS = obtenerMinutos(p.salida.hora);
          if (mE === null || mS === null || mS <= mE) return;
          let duracion = mS - mE;
          minutosTrabajadosHoy += duracion;
          let enCampo = p.entrada.modo === 'CAMPO' || p.salida.modo === 'CAMPO';

          if (esFestivo) {
            if (autorizadoGlobal) {
              if (enCampo) hC100 += duracion;
              else h100 += duracion;
            }
          } else {
            let H_INI = HORA_ENTRADA_REF, H_FIN = HORA_SALIDA_REF;
            if (mS <= H_INI || mE >= H_FIN) {
              if (autorizadoGlobal || enCampo) {
                if (enCampo) hC50 += duracion;
                else if (autorizadoGlobal) h50 += duracion;
              }
            } else {
              let mNormal = Math.min(mS, H_FIN) - Math.max(mE, H_INI);
              let mExtra = duracion - mNormal;
              if (enCampo) { hCN += mNormal; hC50 += mExtra; }
              else { if (autorizadoGlobal) h50 += mExtra; }
            }
          }
        });

        // Descontar 45 minutos (30 almuerzo + 15 break) si trabajó más de 4 horas
        if (minutosTrabajadosHoy > 240) {
          minutosTrabajadosHoy -= 45;
        }

        return `<tr>
      <td style="white-space:nowrap; font-weight:600;">${fechaFormateada}</td>
      <td class="hora-cell">${horaE}</td>
      <td class="hora-cell">${horaS}</td>
      <td style="text-align:center; color:var(--indigo)">${minutosPermisoHoy > 0 ? minutosAHHMMSS(minutosPermisoHoy) : '—'}</td>
      <td style="text-align:center; color:var(--green); font-weight:600;">${minutosTrabajadosHoy > 0 ? minutosAHHMMSS(minutosTrabajadosHoy) : '—'}</td>
      <td>${aBadge}</td>
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
                  <th>TIEMPO PERMISO</th>
                  <th>TOTAL HORAS</th>
                  <th>Almuerzo</th>
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
              <tbody>${filas || '<tr><td colspan="15" class="empty-state">Sin registros</td></tr>'}</tbody>
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
      let titles = { dashboard: 'Dashboard Ejecutivo', asistencia: 'Control de Asistencia', detalle: 'Detalle de Empleado' };
      $('pageTitle').textContent = titles[panel] || 'Supervisor';
      if (panel !== 'detalle') {
        if (panel === 'dashboard') cargarDashboard();
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
      $('visitanteNombre').focus();
    }

    function cerrarModal() {
      document.getElementById('extraLunchModal').classList.add('hidden');
      ['visitanteNombre', 'visitanteEmpresa', 'visitanteObservaciones'].forEach(id => {
        let el = $(id);
        if (el) el.value = '';
      });
      let cant = $('visitanteCantidad');
      if (cant) cant.value = 1;
    }

    async function guardarAlmuerzoExtra() {
      let nombre = $('visitanteNombre').value.trim();
      if (!nombre) { mostrarToast('Ingrese nombre', 'error'); return; }
      mostrarLoader(true);
      try {
        let res = await jsonpRequest({
          accion: 'registrarAlmuerzoExtra',
          nombre: nombre,
          empresa: $('visitanteEmpresa').value.trim(),
          fecha: $('visitanteFecha').value,
          tipo: $('visitanteTipo').value,
          observaciones: $('visitanteObservaciones').value.trim(),
          cantidad: $('visitanteCantidad').value
        });
        mostrarLoader(false);
        if (res?.error) { mostrarToast(res.error, 'error'); return; }
        mostrarToast('Registrado: ' + nombre, 'success');
        cerrarModal();
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
          localStorage.removeItem('tcontrol_registros_cache_v1'); // Forzar recarga de cache
          await cargarDatosCompletos();
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
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos();
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
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos();
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

          await cargarDatosCompletos();
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
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos();
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
      let nuevo = prompt(`Editar ${campo} para ${tipo} (${fecha || 'Hoy'}):`, valorActual);
      if (nuevo === null || nuevo === valorActual) return;

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
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos();
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
          localStorage.removeItem('tcontrol_registros_cache_v1');
          await cargarDatosCompletos();
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
    // CARGA DE DATOS
    // ============================================================
    async function cargarDatosCompletos() {
      if (estaActualizando) return;
      estaActualizando = true;
      mostrarLoader(true);
      try {
        const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor' });
        mostrarLoader(false);
        estaActualizando = false;
        if (!res || res.error) {
          mostrarToast(res?.error || 'Error al cargar datos', 'error');
          return;
        }
        empCache = (res.empleados || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
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

            if (esMaster && $('navItemReportes')) $('navItemReportes').style.display = 'flex';

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
        mostrarLoader(false);
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
          if (window.isMaster && $('navItemReportes')) $('navItemReportes').style.display = 'flex';
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
    $('btnRefresh').addEventListener('click', cargarDatosCompletos);
    $('btnExtraLunch').addEventListener('click', mostrarModalExtraLunch);
    $('btnNuevoRegistroManual').addEventListener('click', mostrarModalManual);
    $('btnMasivo').addEventListener('click', mostrarModalMasivo);
    if ($('btnArchivar')) $('btnArchivar').addEventListener('click', iniciarArchivadoFirebase);
    if ($('btnDepurar')) $('btnDepurar').addEventListener('click', depurarBaseDeDatos);

    document.getElementById('extraLunchModal').addEventListener('click', e => {
      if (e.target === document.getElementById('extraLunchModal')) cerrarModal();
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
            empCache = res.empleados;
            renderAll();
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