// ============================================
// CORE CONFIG
// ============================================
const API_URL  = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
const LAT_EMP  = -0.1288771313385675;
const LNG_EMP  = -78.47896772889067;
const RADIO_M  = 250;
const AUTO_SEC = 60;

// Utilidad de fecha que usa padding para evitar errores de timezone si se usa YYYY-MM-DD
const dateObj = new Date();
const _yy = dateObj.getFullYear();
const _mm = String(dateObj.getMonth() + 1).padStart(2, '0');
const _dd = String(dateObj.getDate()).padStart(2, '0');
const hoyStr = `${_yy}-${_mm}-${_dd}`;

const HOY_FORMATOS = [
  hoyStr,
  `${_dd}/${_mm}/${_yy}`,
  `${_dd}-${_mm}-${_yy}`,
  `${_yy}/${_mm}/${_dd}`,
];

let map, radioCircle, compMarker, markersGroup;
let empleados = [];
let markers = {};
let filtroActual = 'todos';
let timerInterval, timerSec = AUTO_SEC;
let radioVisible = true;

// Colores CSS variables mapeados
const getC = (st) => ({ empresa: '#10b981', campo: '#f59e0b', salida: '#8b5cf6', sin: '#94a3b8' }[st] || '#94a3b8');

// ============================================
// AYUDANTES
// ============================================
function calcDist(la1, lo1, la2, lo2) {
  const R = 6371000;
  const dL = (la2 - la1) * Math.PI / 180;
  const dO = (lo2 - lo1) * Math.PI / 180;
  const a  = Math.sin(dL/2)**2 + Math.cos(la1*Math.PI/180) * Math.cos(la2*Math.PI/180) * Math.sin(dO/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtHora(v) {
  if (v == null || v === '') return '--:--';
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const s = Math.round(v * 86400);
    return String(Math.floor(s / 3600)).padStart(2,'0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2,'0');
  }
  if (typeof v === 'string') {
    const m = v.match(/\d{1,2}:\d{2}/);
    if (m) return m[0].padStart(5, '0');
  }
  return '--:--';
}

function ini(n) { return (n?.charAt(0) || '?').toUpperCase(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }

function getLat(r) { return r.lat ?? r.latitud ?? r.latitude ?? r.Lat ?? r.LAT ?? r.y ?? null; }
function getLng(r) { return r.lng ?? r.lon ?? r.longitud ?? r.longitude ?? r.Lng ?? r.LNG ?? r.x ?? null; }

// ============================================
// LÓGICA DE ESTADO (Agregado estado SALIDA)
// ============================================
function statusEmp(emp) {
  const registros = emp.registros || [];
  const regsHoy = registros.filter(r => HOY_FORMATOS.includes(String(r.fecha || '').split('T')[0]));

  if (!regsHoy.length) return { st: 'sin', lat: null, lng: null };

  const regsGPS = regsHoy.filter(r => {
    const la = getLat(r), lo = getLng(r);
    return la != null && la !== '' && lo != null && lo !== '' && !isNaN(+la) && !isNaN(+lo);
  });

  const sortTime = (arr) => [...arr].sort((a,b) => {
    const va = typeof a.hora==='number'?a.hora:parseFloat(a.hora)||0;
    const vb = typeof b.hora==='number'?b.hora:parseFloat(b.hora)||0;
    return isNaN(va)||isNaN(vb) ? String(a.hora).localeCompare(String(b.hora)) : va-vb;
  });

  const ultimaData = (arr) => {
      const sorted = sortTime(arr);
      return sorted[sorted.length - 1];
  }

  // Encontrar el último registro absoluto del día para prioridad de estado (Salida sobre todo)
  const uTotal = ultimaData(regsHoy);
  const typeOfTotal = String(uTotal.tipo).toUpperCase();

  if (regsGPS.length) {
    const uGPS = ultimaData(regsGPS);
    const la = +getLat(uGPS), lo = +getLng(uGPS);
    const d  = calcDist(LAT_EMP, LNG_EMP, la, lo);
    
    let estado = d <= RADIO_M ? 'empresa' : 'campo';
    if (typeOfTotal === 'SALIDA') estado = 'salida';
    
    return { st: estado, lat: la, lng: lo, hora: uTotal.hora, tipo: uTotal.tipo, dist: Math.round(d), sinGPS: false };
  } else {
    // Registros sin GPS hoy (Web manual probable). 
    let estado = 'empresa';
    if (typeOfTotal === 'SALIDA') estado = 'salida';
    
    // Repartir aleatoriamente dentro del perímetro de la matriz (ej. 200 metros)
    // 1 grado latitud = ~111320 metros.
    const angulo = Math.random() * Math.PI * 2;
    const radioGrados = Math.sqrt(Math.random()) * (180 / 111320); // Distribución circular uniforme ~180m
    const jLat = radioGrados * Math.cos(angulo);
    const jLng = (radioGrados * Math.sin(angulo)) / Math.cos(LAT_EMP * Math.PI / 180);
    
    return { st: estado, lat: LAT_EMP + jLat, lng: LNG_EMP + jLng, hora: uTotal.hora, tipo: uTotal.tipo, dist: 0, sinGPS: true, tipoAc: 'Manual' };
  }
}

// ============================================
// JSONP BRIDGE
// ============================================
// ============================================
// JSONP BRIDGE (INTERCEPTOR FIREBASE)
// ============================================
function jsonp(params) {
  if (window.USE_FIREBASE && window.FirebaseBackend) {
    return window.FirebaseBackend.procesarAccion(params);
  }
  return new Promise((res, rej) => {
    const cb = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    let settled = false;
    const sc = document.createElement('script');

    const cleanup = () => {
      window[cb] = function() {};
      setTimeout(() => { delete window[cb]; }, 60000);
      if (sc.parentNode) sc.parentNode.removeChild(sc);
    };

    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rej(new Error('Timeout de API'));
    }, 25000);
    
    window[cb] = data => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      cleanup();
      res(data);
    };

    const url = new URL(API_URL);
    url.searchParams.set('callback', cb);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');
    params.apiKey = 'TCONTROL_SECURE_2026_XYZ';
    Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });

    sc.src = url.toString();
    sc.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      cleanup();
      rej(new Error('Error de conexión a servidor. Revise permisos de Google Apps Script.'));
    };
    document.body.appendChild(sc);
  });
}

// ============================================
// FUNCIONES DE UI VISUAL
// ============================================
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast show';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.remove(),300); }, 3500);
}

// ============================================
// MAPA PREMIUM
// ============================================
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([LAT_EMP, LNG_EMP], 16);

  // Mapa Clásico OpenStreetMap 
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Inicializar Cluster Premium
  markersGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (cluster) {
      return L.divIcon({ 
        html: '<div class="cluster-premium">' + cluster.getChildCount() + '</div>', 
        className: '', iconSize: [44, 44], iconAnchor: [22, 22] 
      });
    }
  });
  map.addLayer(markersGroup);

  // Central Hub (TCONTROL)
  compMarker = L.marker([LAT_EMP, LNG_EMP], {
    icon: L.divIcon({ html: '<div class="hq-marker"><i class="fas fa-building-user"></i></div>', className:'', iconSize:[54,54], iconAnchor:[27,27], popupAnchor:[0,-28] }),
    zIndexOffset: -100
  }).addTo(map).bindPopup(`
    <div style="font-family:'Inter',sans-serif; text-align:center; padding:12px;">
        <div style="font-family:'Outfit',sans-serif; font-size:18px; font-weight:800; color:var(--text-main);">TCONTROL S.A.</div>
        <div style="font-size:12px; color:var(--text-sub); margin-top:4px;">Recinto operativo (${RADIO_M}m)</div>
    </div>
  `);

  radioCircle = L.circle([LAT_EMP, LNG_EMP], {
    radius: RADIO_M, color: 'var(--c-empresa)', fillColor: 'var(--c-empresa)',
    fillOpacity: 0.05, weight: 1.5, dashArray: '4 4'
  }).addTo(map);
}

// Generador Marcador Premium (HTML)
function uiMarker(emp, info) {
  const bg = getC(info.st);
  const eid = esc(String(emp.id).replace(/[^a-zA-Z0-9_-]/g, '_'));
  
  const initialDiv = `<div class="pm-ph" id="pmh-${eid}" style="background:${bg}; ${emp.foto_url?'display:none':''}">${ini(emp.nombre)}</div>`;
  const imgDiv = emp.foto_url ? `<img src="${esc(emp.foto_url)}" onerror="this.style.display='none';document.getElementById('pmh-${eid}').style.display='flex'">` : '';
  
  // Agregar anillo luminoso solo si tienen estado activo y sí tienen GPS (para evitar apilamiento visual)
  const glow = (info.st !== 'sin' && !info.sinGPS) ? `<div class="pm-glow c-${info.st}"></div>` : '';

  return `
    <div class="premium-marker">
      ${glow}
      <div class="pm-pin" style="border-color:${bg}">${imgDiv}${initialDiv}</div>
    </div>
  `;
}

// Generador PopUp Premium (HTML)
function uiPopup(emp, info) {
  const bg = getC(info.st);
  const ph = `<div class="pop-avatar" style="color:${bg}; border-color:${bg}">${ini(emp.nombre)}</div>`;
  const img = emp.foto_url ? `<img class="pop-avatar" src="${esc(emp.foto_url)}" style="border-color:${bg}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${ph}` : ph;

  const bLbl = { 'empresa': 'En Área', 'campo': 'En Campo', 'salida': 'Jornada Fin', 'sin': 'Ausente' }[info.st];
  
  const distHtml = info.dist != null ? `${info.dist}m` : '—';
  
  return `
    <div class="pop-modern">
      <div class="pop-cover">
        <div class="pop-badge" style="background:${bg}">${bLbl}</div>
        ${img}
      </div>
      <div class="pop-details">
        <div class="pop-name">${esc(emp.nombre)}</div>
        <div class="pop-sub"><i class="fas fa-briefcase"></i> ${esc(emp.area||'Sin área')}</div>
        
        <div class="pop-grid">
          <div class="pop-box">
             <div class="pop-box-t">HORA REG.</div>
             <div class="pop-box-v">${fmtHora(info.hora)}</div>
          </div>
          <div class="pop-box">
             <div class="pop-box-t">DISTANCIA</div>
             <div class="pop-box-v">${distHtml}</div>
          </div>
        </div>
        ${info.sinGPS ? `<div class="sin-gps-notice"><i class="fas fa-satellite-slash"></i> Posición teórica (Sin GPS)</div>` : ''}
      </div>
    </div>
  `;
}

function renderMapPoints(lista) {
  if (markersGroup) markersGroup.clearLayers();
  markers = {};

  // Traer los zIndex correctos: Salidas abajo, Empresa medio, Campo arriba
  const zIdx = { 'campo': 300, 'empresa': 200, 'salida': 100, 'sin': 0 };

  lista.forEach(emp => {
    const info = emp._info;
    if (info.lat == null) return; 
    
    const mk = L.marker([info.lat, info.lng], {
      icon: L.divIcon({ html: uiMarker(emp, info), className:'', iconSize:[42,42], iconAnchor:[21,21], popupAnchor:[0,-20] }),
      zIndexOffset: zIdx[info.st] || 0
    }).bindPopup(uiPopup(emp, info));

    mk.on('click', () => { resaltarTarjeta(emp.id); });
    markersGroup.addLayer(mk);
    markers[emp.id] = mk;
  });
}

// ============================================
// PANEL Y TABLAS FRONTEND
// ============================================
function updateStats() {
  const count = (str) => empleados.filter(e => e._info.st === str).length;
  document.getElementById('numTodos').textContent = empleados.length;
  document.getElementById('numEmpresa').textContent = count('empresa');
  document.getElementById('numCampo').textContent = count('campo');
  document.getElementById('numSalida').textContent = count('salida');
  document.getElementById('numSin').textContent = count('sin');
}

function filtrar(tipo) {
  filtroActual = tipo;
  ['todos', 'empresa', 'campo', 'salida', 'sin'].forEach(t => {
    const el = document.getElementById('f-' + t);
    if(el) el.classList.toggle('active', t === tipo);
  });
  renderLista();
}

function renderLista() {
  const q = (document.getElementById('searchEmp').value||'').toLowerCase();
  const sortMap = { 'empresa':1, 'campo':2, 'salida':3, 'sin':4 };
  
  const d = empleados.filter(e => {
    if (q && !e.nombre.toLowerCase().includes(q) && !(e.area||'').toLowerCase().includes(q)) return false;
    if (filtroActual !== 'todos' && e._info.st !== filtroActual) return false;
    return true;
  }).sort((a,b) => (sortMap[a._info.st]??99) - (sortMap[b._info.st]??99) || a.nombre.localeCompare(b.nombre));

  const lst = document.getElementById('empList');
  if (!d.length) {
    lst.innerHTML = `<div class="empty-state"><i class="fas fa-ghost"></i><p>No se encontraron<br>resultados en radar.</p></div>`;
    return;
  }

  lst.innerHTML = d.map(emp => {
    const i = emp._info;
    const bg = getC(i.st);
    const eid = esc(String(emp.id).replace(/[^a-zA-Z0-9_-]/g, '_'));
    const tIcon = i.tipo === 'ENTRADA' ? 'right-to-bracket' : i.tipo === 'SALIDA' ? 'right-from-bracket' : 'minus';
    
    const ph = `<div class="emp-avatar-ph" id="ap-${eid}" style="background-color:${bg}; ${emp.foto_url?'display:none':''}">${ini(emp.nombre)}</div>`;
    const im = emp.foto_url ? `<img class="emp-avatar" id="ai-${eid}" src="${esc(emp.foto_url)}" onerror="this.style.display='none';document.getElementById('ap-${eid}').style.display='flex'">` : '';

    return `
      <div class="emp-card" id="card-${esc(emp.id)}" onclick="focarPunto('${esc(emp.id)}')">
        <div class="avatar-wrapper">
          ${im}${ph}
          <div class="status-ring" style="background:${bg}"></div>
        </div>
        <div class="emp-info">
          <div class="emp-name">${esc(emp.nombre)}</div>
          <div class="emp-sub"><i class="fas fa-layer-group"></i> ${esc(emp.area||'Sin área')}</div>
        </div>
        <div class="emp-time-box">
          <div class="emp-time"><i class="fas fa-${tIcon}" style="color:${bg};margin-right:3px;"></i> ${fmtHora(i.hora)}</div>
          <div class="emp-dist"><i class="fas fa-location-dot"></i> ${i.dist!=null?i.dist+'m':(i.sinGPS?'Apox.':'—')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function focarPunto(id) {
  const emp = empleados.find(e => String(e.id) === String(id));
  if (!emp) return;
  const i = emp._info;
  
  if (i.lat == null) { showToast('Ubicación no disponible para este usuario hoy.'); return; }
  
  map.flyTo([i.lat, i.lng], 18, { duration: 1.5, easeLinearity: 0.1 });
  setTimeout(() => { if (markers[emp.id]) markers[emp.id].openPopup(); }, 1600);
  
  resaltarTarjeta(id);
  if (window.innerWidth <= 800) document.getElementById('sidebar').classList.remove('open');
}

function resaltarTarjeta(id) {
  document.querySelectorAll('.emp-card').forEach(c => c.classList.remove('selected'));
  const c = document.getElementById('card-' + id);
  if (c) {
    c.classList.add('selected');
    c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ============================================
// CONTROLADORES GLOBALES
// ============================================
function centrarEmpresa() { map.flyTo([LAT_EMP, LNG_EMP], 16, { duration:1.5 }); }
function fitAll() {
  const mks = Object.values(markers);
  if (!mks.length) { centrarEmpresa(); return; }
  map.fitBounds(L.featureGroup(mks).getBounds().pad(0.3));
}
function toggleRadio() {
  radioVisible = !radioVisible;
  radioVisible ? radioCircle.addTo(map) : map.removeLayer(radioCircle);
  const btn = document.getElementById('btnRadio');
  btn.style.color = radioVisible ? 'var(--text-main)' : 'var(--text-sub)';
}

async function cargar(silent = false) {
  if (!silent) {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loaderText').textContent = 'Sincronizando satélites y empleados...';
  }
  
  const btnI = document.getElementById('refreshIcon');
  btnI.classList.add('fa-spin');
  
  try {
    const res = await jsonp({ accion: 'obtenerDatosSupervisor' });
    if (!res || res.error) throw new Error(res?.error || 'Falló la conexión al servidor matriz');

    empleados = (res.empleados || []).map(e => { e._info = statusEmp(e); return e; });
    
    renderMapPoints(empleados);
    renderLista();
    updateStats();

    const nw = new Date();
    document.getElementById('ultimaAct').textContent = nw.toLocaleTimeString('es', { hour12: false });
    
    iniciarRotacion();
  } catch (err) {
    console.error(err);
    showToast(err.message);
  } finally {
    document.getElementById('loader').style.opacity = '0';
    setTimeout(() => document.getElementById('loader').style.display = 'none', 300);
    btnI.classList.remove('fa-spin');
  }
}

function iniciarRotacion() {
  clearInterval(timerInterval);
  timerSec = AUTO_SEC;
  timerInterval = setInterval(() => {
    timerSec--;
    document.getElementById('proxAct').textContent = timerSec + 's';
    if(timerSec <= 0) cargar(true);
  }, 1000);
}

// Iniciar aplicación
initMap();
cargar(false);