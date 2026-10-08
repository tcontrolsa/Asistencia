// ============================================================
//  CONFIGURACIÓN
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
const CLAVE_GUARDIA = 'TCONTROL2026';

// Estado
let lat = null, lng = null, gpsOk = false, watchId = null;
let empleadoActual = { id: '', nombre: '', area: '', tipo: '', almuerzo: '', foto_url: '' };
let estadoEmpleado = {};
let listaPresentes = [];
let tabActual = 'registro';

// ============================================================
//  UTILIDADES
// ============================================================
function $(id) { return document.getElementById(id); }

function mostrarToast(msg, tipo = 'info') {
    const container = $('toastContainer');
    container.innerHTML = `<div class="toast-msg ${tipo}">${msg}</div>`;
    setTimeout(() => { container.innerHTML = ''; }, 3000);
}

// Pantalla de espera con mensaje. Si tarda, avisa que sigue trabajando (6 s) o que la conexión falla (20 s).
let tLoadingLento = null, tLoadingMuyLento = null;
function showLoading(show, mensaje) {
    $('loadingOverlay').classList.toggle('hidden', !show);
    clearTimeout(tLoadingLento); clearTimeout(tLoadingMuyLento);
    const nota = $('loadingNota');
    if (!show) return;
    if ($('loadingMsg')) $('loadingMsg').textContent = mensaje || 'Procesando…';
    if (nota) {
        nota.textContent = '';
        tLoadingLento = setTimeout(() => { nota.textContent = 'La conexión está lenta, sigue trabajando…'; }, 6000);
        tLoadingMuyLento = setTimeout(() => { nota.textContent = 'Está tardando demasiado. Revisa el internet del equipo.'; }, 20000);
    }
}

// Guía rápida para el guardia (botón "?" de la cabecera)
function mostrarAyuda() {
    if (document.querySelector('.ayuda-modal')) return;
    const conVisitas = !!$('panelVisitas');
    const m = document.createElement('div');
    m.className = 'ayuda-modal';
    m.innerHTML = `<div class="ayuda-caja" role="dialog" aria-modal="true" aria-labelledby="ayudaTitulo">
        <div class="ayuda-cab"><h3 id="ayudaTitulo"><i class="fas fa-question-circle"></i> Guía de la terminal</h3>
            <button type="button" class="ayuda-x" aria-label="Cerrar">&times;</button></div>
        <div class="ayuda-cuerpo">
            <h4><i class="fas fa-clipboard-list"></i> Registrar entrada o salida</h4>
            <ol><li>Escriba el número de empleado y presione <b>Buscar</b>.</li>
                <li>Compare la foto con la persona.</li>
                <li>En la entrada, elija dónde almorzará: <b>En planta</b> o <b>Fuera de planta</b>.</li>
                <li>Presione <b>Registrar</b> y espere el mensaje de confirmación.</li></ol>
            <p class="ayuda-nota">Una salida antes de las 16:15 pide confirmación. Si dice <b>Jornada completada</b>, esa persona ya tiene entrada y salida hoy.</p>
            <h4><i class="fas fa-users"></i> Presentes</h4>
            <p>Quiénes marcaron entrada hoy, la más reciente primero. 🏢 almuerza en planta, 🏠 fuera. Toque la foto para ampliarla. La lista se actualiza sola después de cada registro.</p>
            ${conVisitas ? `<h4><i class="fas fa-id-card-alt"></i> Visitas</h4>
            <ol><li>Active la portería de visitas con su clave (es distinta de la de la terminal).</li>
                <li>Escanee el QR del visitante o escriba su código de 8 caracteres.</li>
                <li>Mire su documento de identidad: el nombre debe coincidir. No lo copie ni lo anote.</li>
                <li>Registre la <b>entrada</b>; al irse, busque de nuevo su código y registre la <b>salida</b>.</li></ol>
            <p><b>¿Llegó alguien sin cita?</b> En «¿Llegó alguien sin cita?» toque <b>Mostrar QR</b>: el visitante lo escanea y se registra en su celular; luego escanee el QR que le aparece. Si no tiene celular, toque <b>Registrarlo yo</b>, llene sus datos, léale el aviso de datos y registre su entrada.</p>
            <p class="ayuda-nota">Si la ficha sale en amarillo, no permita el ingreso: lea el aviso (no aprobada, otro día, etc.) y comuníquese con el anfitrión.</p>` : ''}
            <h4><i class="fas fa-exclamation-triangle"></i> Si algo falla</h4>
            <ul><li><b>Sin GPS / Permiso denegado:</b> active la ubicación del equipo y toque <i class="fas fa-sync-alt"></i> en la barra del GPS.</li>
                <li><b>«La conexión está lenta»:</b> espere; el sistema sigue trabajando. Si pasa de 20 segundos, revise el internet.</li>
                <li><b>Empleado no encontrado:</b> confirme el número con la persona o con su supervisor.</li></ul>
        </div></div>`;
    const cerrar = () => { m.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') cerrar(); };
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('.ayuda-x')) cerrar(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(m);
    m.querySelector('.ayuda-x').focus();
}

// Spinner pequeño para botones e indicadores en línea
const SPIN = '<span class="spin-sm" aria-hidden="true"></span>';

// Convertir URL de Drive a formato de imagen
function convertirUrlDrive(url) {
    if (!url) return null;
    if (url.includes('lh3.googleusercontent.com')) return url;
    
    let fileId = null;
    const matchFileD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFileD) fileId = matchFileD[1];
    const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchId) fileId = matchId[1];
    const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (matchD) fileId = matchD[1];
    const matchOpen = url.match(/open\?id=([a-zA-Z0-9_-]+)/);
    if (matchOpen) fileId = matchOpen[1];
    
    if (fileId) return `https://lh3.googleusercontent.com/d/${fileId}`;
    return url;
}

// Modal para ampliar foto
function showPhotoModal(url) {
    if (!url || url.trim() === '') {
        mostrarToast('No hay foto disponible', 'info');
        return;
    }
    const modal = document.createElement('div');
    modal.className = 'photo-modal';
    modal.onclick = () => modal.remove();
    
    const img = document.createElement('img');
    img.src = url;
    img.onerror = () => {
        modal.innerHTML = '<div style="color:white; text-align:center;"><i class="fas fa-image fa-4x mb-3"></i><br>No se pudo cargar la imagen</div>';
    };
    
    modal.appendChild(img);
    document.body.appendChild(modal);
}

// Cambiar entre pestañas
function cambiarTab(tab) {
    tabActual = tab;
    
    // Actualizar estilos de pestañas (registro, presentes, visitas)
    const orden = ['registro', 'presentes', 'visitas'];
    document.querySelectorAll('.tab').forEach((t, index) => t.classList.toggle('active', orden[index] === tab));

    // Mostrar/ocultar paneles
    $('panelRegistro').classList.toggle('hidden', tab !== 'registro');
    $('panelPresentes').classList.toggle('hidden', tab !== 'presentes');
    if ($('panelVisitas')) $('panelVisitas').classList.toggle('hidden', tab !== 'visitas');
    // La barra de GPS solo aplica al registro de asistencia
    if ($('gpsBar')) $('gpsBar').classList.toggle('hidden', tab === 'visitas');
    if (tab !== 'visitas' && window.GuardiaVisitas) window.GuardiaVisitas.detenerCamara();
    if (tab === 'presentes') cargarPresentes();
    if (tab === 'visitas' && window.GuardiaVisitas) window.GuardiaVisitas.montar($('panelVisitas'));
}

// ============================================================
//  JSONP
// ============================================================
function jsonpRequest(params) {
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return window.FirebaseBackend.procesarAccion(params);
    }
    return new Promise((resolve, reject) => {
        const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        let settled = false;
        const script = document.createElement('script');

        const cleanup = () => {
            window[callback] = function() {};
            setTimeout(() => { delete window[callback]; }, 60000);
            if (script.parentNode) script.parentNode.removeChild(script);
        };

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Timeout'));
        }, 15000);

        window[callback] = (data) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cleanup();
            resolve(data);
        };

        const url = new URL(API_URL);
        url.searchParams.append('callback', callback);
        url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');
        
        // Inyectar credenciales de sesión si existen
        const session = localStorage.getItem('GUARDIA_SESSION') || localStorage.getItem('SUPERVISOR_SESSION');
        if (session) {
            const data = JSON.parse(session);
            url.searchParams.append('empleadoId', data.id);
            url.searchParams.append('deviceToken', data.token);
        }

        Object.keys(params).forEach(k => {
            if (params[k] !== undefined && params[k] !== null) {
                if (k === 'empleadoId' || k === 'deviceToken') return;
                url.searchParams.append(k, params[k].toString());
            }
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
//  API
// ============================================================
async function validarClave(clave) {
    return await jsonpRequest({ accion: 'verificarClaveGuardia', clave });
}

async function obtenerEstado(id) {
    return await jsonpRequest({ accion: 'obtenerEstado', id, deviceToken: 'GUARDIA' });
}

async function registrarAsistencia(datos) {
    return await jsonpRequest({ ...datos, accion: 'guardarRegistro', dispositivo: 'GUARDIA' });
}

// ============================================================
//  PRESENTES
// ============================================================
// Antes se usaba obtenerDatosSupervisor (todos los empleados, 60 días de registros y el histórico
// archivado). Aquí solo hace falta lo de hoy: los registros desde las 00:00 y los empleados activos
// (estos en memoria 10 min). Lo último cargado se muestra al instante mientras se actualiza.
const CACHE_PRESENTES = 'guardia_presentes_hoy';
let empleadosGuardia = null;          // { t, mapa }
let cargaPresentes = null;            // promesa en curso (evita cargas simultáneas)
let presentesTs = 0;

const hoyStrLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const horaCorta = ms => ms ? new Date(ms).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '--:--';

async function empleadosActivosGuardia() {
    if (empleadosGuardia && Date.now() - empleadosGuardia.t < 10 * 60 * 1000) return empleadosGuardia.mapa;
    const snap = await firebase.firestore().collection('empleados').get();
    const mapa = {};
    snap.forEach(doc => {
        const d = doc.data();
        const act = String(d.activo || '').trim().toUpperCase(), est = String(d.estado || '').trim().toUpperCase();
        if (act === 'NO' || act === 'FALSE' || d.activo === false || est === 'INACTIVO') return;
        mapa[doc.id] = { id: doc.id, nombre: d.nombre || doc.id, foto_url: d.foto_url || '' };
    });
    empleadosGuardia = { t: Date.now(), mapa };
    return mapa;
}

function msDeHora(hora) {
    if (!hora) return 0;
    const [h, m, s] = String(hora).split(':');
    const d = new Date(); d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, parseInt(s, 10) || 0, 0);
    return d.getTime();
}

async function obtenerPresentesHoy() {
    const FB = window.FirebaseBackend;
    if (!(window.USE_FIREBASE && FB && window.firebase)) {
        // Respaldo (sin Firebase): la acción completa de Apps Script
        const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor' });
        if (res.error) throw new Error(res.error);
        return (res.empleados || []).filter(e => e.entradaHoy === true);
    }
    const hoy = hoyStrLocal();
    const [empleados, regSnap] = await Promise.all([
        empleadosActivosGuardia(),
        firebase.firestore().collection('registros')
            .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(new Date(hoy + 'T00:00:00'))).get()
    ]);
    const porEmp = {};
    regSnap.forEach(doc => {
        const reg = FB._processDoc(doc.id, doc.data());
        if (!reg || reg.fecha !== hoy) return;
        const eid = String(reg.empleadoId || reg.id_empleado || String(reg.id || '').split('_')[0]).trim();
        const emp = empleados[eid];
        if (!emp) return;
        const p = porEmp[eid] || (porEmp[eid] = { ...emp, entradaHoy: false, salidaHoy: false, almuerzoHoy: '' });
        const vAlm = String(reg.almuerzo || '').trim().toUpperCase();
        const alm = (vAlm === 'SI' || vAlm === 'SÍ' || vAlm === 'PLANTA') ? 'SI' : ((vAlm === 'NO' || vAlm === 'FUERA') ? 'NO' : '');
        if (reg.tipo === 'ENTRADA') {
            p.entradaHoy = true;
            p.horaEntradaMs = msDeHora(reg.hora);
            if (!p.almuerzoHoy) p.almuerzoHoy = alm;
        } else if (reg.tipo === 'SOLO_ALMUERZO') {
            if (!p.almuerzoHoy) p.almuerzoHoy = alm;
        } else if (reg.tipo === 'SALIDA') {
            p.salidaHoy = true;
            p.horaSalidaMs = msDeHora(reg.hora);
        }
    });
    return Object.values(porEmp).filter(p => {
        // Igual que el panel: si salió antes de las 09:30, no almuerza
        if (p.salidaHoy && p.horaSalidaMs) { const d = new Date(p.horaSalidaMs); if (d.getHours() * 60 + d.getMinutes() < 570) p.almuerzoHoy = 'NO'; }
        return p.entradaHoy;
    });
}

function pintarPresentes(presentes) {
    listaPresentes = presentes;
    $('presentCount').textContent = presentes.length;
    if (!presentes.length) {
        $('presentList').innerHTML = `<div class="empty-state"><i class="fas fa-user-clock"></i><p>No hay empleados registrados hoy</p></div>`;
        return;
    }
    // Más reciente primero
    const lista = presentes.slice().sort((a, b) => (b.horaEntradaMs || 0) - (a.horaEntradaMs || 0));
    $('presentList').innerHTML = lista.map(emp => {
        const fotoUrl = convertirUrlDrive(emp.foto_url);
        const inicial = escapeHtml((emp.nombre || '?').charAt(0).toUpperCase());
        const almuerzo = emp.almuerzoHoy === 'SI' ? '🏢 Planta' : (emp.almuerzoHoy === 'NO' ? '🏠 Fuera' : '');
        return `
            <div class="present-item">
                ${fotoUrl
                    ? `<img class="present-photo" src="${escapeHtml(fotoUrl)}" alt="" decoding="async" data-foto="${escapeHtml(fotoUrl)}" style="cursor:pointer;" onerror="this.outerHTML='<div class=&quot;present-photo-placeholder&quot;>${inicial}</div>'">`
                    : `<div class="present-photo-placeholder">${inicial}</div>`}
                <div class="present-info">
                    <div class="present-name">${escapeHtml(emp.nombre)}</div>
                    <div class="present-time">
                        <i class="fas fa-clock"></i> ${horaCorta(emp.horaEntradaMs)}
                        ${emp.salidaHoy ? `<span class="present-badge badge-salida-small"><i class="fas fa-sign-out-alt"></i> Salida: ${horaCorta(emp.horaSalidaMs)}</span>` : ''}
                        ${almuerzo ? `<span class="present-badge badge-almuerzo"><i class="fas fa-utensils"></i> ${almuerzo}</span>` : ''}
                    </div>
                </div>
            </div>`;
    }).join('');
}

function pintarEsqueletoPresentes() {
    $('presentCount').innerHTML = SPIN;
    const fila = `<div class="present-item sk-fila"><div class="sk sk-foto"></div><div style="flex:1"><div class="sk sk-linea" style="width:60%"></div><div class="sk sk-linea" style="width:35%;margin-top:8px"></div></div></div>`;
    $('presentList').innerHTML = fila.repeat(5) + `<p class="cargando-nota lento-6s">La conexión está lenta, sigue cargando…</p>`;
}

function estadoPresentes(html) { if ($('presentEstado')) $('presentEstado').innerHTML = html; }

function cargarPresentes() {
    if (cargaPresentes) return cargaPresentes;
    // Lo último cargado (de hoy) se muestra al instante; si no hay nada, esqueleto animado
    if (!presentesTs) {
        try {
            const c = JSON.parse(localStorage.getItem(CACHE_PRESENTES) || 'null');
            if (c && c.fecha === hoyStrLocal() && Array.isArray(c.lista)) { pintarPresentes(c.lista); presentesTs = c.ts; }
        } catch (e) { }
    }
    if (!presentesTs) pintarEsqueletoPresentes();
    estadoPresentes(`${SPIN} Actualizando…`);
    const btn = $('btnActualizarPresentes');
    if (btn) { btn.disabled = true; btn.innerHTML = `${SPIN} Actualizando…`; }
    cargaPresentes = obtenerPresentesHoy()
        .then(lista => {
            presentesTs = Date.now();
            pintarPresentes(lista);
            estadoPresentes(`<i class="fas fa-check-circle" style="color:var(--success)"></i> Actualizado a las ${horaCorta(presentesTs)}`);
            try { localStorage.setItem(CACHE_PRESENTES, JSON.stringify({ fecha: hoyStrLocal(), ts: presentesTs, lista })); } catch (e) { }
        })
        .catch(err => {
            if (presentesTs) {
                estadoPresentes(`<i class="fas fa-exclamation-triangle" style="color:var(--warning,#f59e0b)"></i> Sin conexión. Datos de las ${horaCorta(presentesTs)}`);
            } else {
                $('presentCount').textContent = '–';
                $('presentList').innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>No se pudo cargar la lista.<br><small>${escapeHtml(err.message || '')}</small></p></div>`;
                estadoPresentes('');
            }
            if (tabActual === 'presentes') mostrarToast('No se pudo actualizar la lista de presentes', 'error');
        })
        .finally(() => {
            cargaPresentes = null;
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar'; }
        });
    return cargaPresentes;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
//  GPS
// ============================================================
function startGPS() {
    if (!navigator.geolocation) {
        actualizarGPS(false, 'GPS no soportado', '');
        return;
    }
    if (watchId) navigator.geolocation.clearWatch(watchId);
    
    watchId = navigator.geolocation.watchPosition(
        pos => {
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            gpsOk = true;
            actualizarGPS(true, 'GPS activo', `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`);
        },
        err => {
            gpsOk = false;
            const msgs = { 1: 'Permiso denegado', 2: 'Sin señal', 3: 'Timeout' };
            actualizarGPS(false, msgs[err.code] || 'Error GPS', '');
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function actualizarGPS(ok, status, coord) {
    $('gpsIcon').className = 'gps-icon' + (ok ? ' ok' : '');
    $('gpsIcon').innerHTML = ok ? '📍' : '📡';
    $('gpsStatus').textContent = status;
    $('gpsCoord').textContent = coord || '---';
    $('gpsBar').style.borderColor = ok ? 'var(--success)' : 'var(--gray-200)';
}

function refGPS() {
    mostrarToast('Actualizando GPS...', 'info');
    if (watchId) navigator.geolocation.clearWatch(watchId);
    startGPS();
}

// ============================================================
//  LOGIN
// ============================================================
// ============================================================
//  LOGIN
// ============================================================
async function login() {
    const pin = $('iClave').value.trim();
    
    if (!pin) { 
        mostrarToast('Ingrese la contraseña', 'error'); 
        return; 
    }
    
    showLoading(true, 'Verificando clave…');
    try {
        const deviceToken = generarDeviceToken();
        // Usar verificarClaveGuardia que valida contra TCONTROL2026
        const res = await jsonpRequest({ accion: 'verificarClaveGuardia', pin: pin, deviceToken: deviceToken });
        
        showLoading(false);
        if (res.error) {
            mostrarToast(res.error, 'error');
        } else if (res.ok) {
            // Guardar sesión genérica para el terminal de guardia
            const sessionData = { id: 'GUARDIA', token: deviceToken, timestamp: new Date().getTime() };
            localStorage.setItem('GUARDIA_SESSION', JSON.stringify(sessionData));
            
            $('vLogin').classList.add('hidden');
            $('vTerm').classList.remove('hidden');
            mostrarToast('Terminal Activa', 'success');
            startGPS();
            $('iId').focus();
            cargarPresentes();
        } else {
            mostrarToast('Contraseña incorrecta', 'error');
        }
    } catch (err) {
        showLoading(false);
        mostrarToast('Error de conexión', 'error');
    }
}

function generarDeviceToken() {
    let token = localStorage.getItem('DEVICE_TOKEN_GUARDIA');
    if (!token) {
        token = 'GRD_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('DEVICE_TOKEN_GUARDIA', token);
    }
    return token;
}

function logout() {
    localStorage.removeItem('GUARDIA_SESSION');
    $('vTerm').classList.add('hidden');
    $('vLogin').classList.remove('hidden');
    $('iClave').value = '';
    $('iClave').focus();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    limpiarTodo();
}

// ============================================================
//  BÚSQUEDA
// ============================================================
async function buscar() {
    const id = $('iId').value.trim();
    if (!id) { mostrarToast('Ingrese ID', 'error'); return; }
    if (!gpsOk) { mostrarToast('Espere GPS', 'info'); return; }
    
    showLoading(true, 'Buscando empleado ' + id + '…');
    try {
        const res = await obtenerEstado(id);
        showLoading(false);
        
        if (res.error) {
            mostrarToast(res.error, 'error');
            return;
        }
        
        estadoEmpleado = res;
        empleadoActual = {
            id: id,
            nombre: res.nombre || 'Sin nombre',
            area: res.area || '',
            tipo: !res.tieneEntrada ? 'ENTRADA' : (!res.tieneSalida ? 'SALIDA' : null),
            almuerzo: '',
            foto_url: res.foto_url || ''
        };
        
        if (!empleadoActual.tipo) {
            mostrarToast('Jornada completada', 'error');
            return;
        }
        
        mostrarPantallaRegistro();
    } catch (err) {
        showLoading(false);
        mostrarToast('Error', 'error');
    }
}

// ============================================================
//  REGISTRO
// ============================================================
function mostrarPantallaRegistro() {
    const fotoUrl = convertirUrlDrive(empleadoActual.foto_url);
    const tieneFoto = fotoUrl && fotoUrl.trim() !== '';
    
    let badgeHtml = '';
    if (empleadoActual.tipo === 'ENTRADA') {
        badgeHtml = '<span class="status-badge badge-pendiente"><i class="fas fa-clock"></i> Pendiente entrada</span>';
    } else {
        badgeHtml = '<span class="status-badge badge-salida"><i class="fas fa-sign-out-alt"></i> Pendiente salida</span>';
    }
    
    $('profileInfo').innerHTML = `
        <div class="profile-credencial">
            <div class="photo-frame" onclick="showPhotoModal('${fotoUrl || ''}')">
                ${tieneFoto ? 
                    `<img class="employee-photo" src="${fotoUrl}" alt="Foto" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                     <div class="employee-photo-placeholder" style="display:none">👤</div>` : 
                    `<div class="employee-photo-placeholder">👤</div>`
                }
                <div class="photo-verified">
                    <i class="fas fa-check"></i>
                </div>
            </div>
            <div class="employee-name">${escapeHtml(empleadoActual.nombre)}</div>
            <div class="employee-area">${escapeHtml(empleadoActual.area || 'Departamento')}</div>
            ${badgeHtml}
        </div>
    `;
    
    const lunchSection = $('lunchSection');
    if (empleadoActual.tipo === 'ENTRADA') {
        lunchSection.classList.remove('hidden');
        $('lunchPlanta').classList.remove('selected');
        $('lunchFuera').classList.remove('selected');
        empleadoActual.almuerzo = '';
        $('sumAlmRow').classList.remove('hidden');
    } else {
        lunchSection.classList.add('hidden');
        $('sumAlmRow').classList.add('hidden');
        empleadoActual.almuerzo = '';
    }
    
    $('sumTipo').innerHTML = empleadoActual.tipo === 'ENTRADA' ? '<i class="fas fa-sign-in-alt"></i> ENTRADA' : '<i class="fas fa-sign-out-alt"></i> SALIDA';
    $('sumAlm').textContent = '-';
    $('sumGps').innerHTML = gpsOk ? `<i class="fas fa-map-marker-alt"></i> ${lat.toFixed(5)}°, ${lng.toFixed(5)}°` : '<i class="fas fa-exclamation-triangle"></i> Sin GPS';
    
    $('screenSearch').classList.add('hidden');
    $('screenRegister').classList.remove('hidden');
}

function seleccionarAlmuerzo(opcion) {
    empleadoActual.almuerzo = opcion;
    $('lunchPlanta').classList.toggle('selected', opcion === 'SI');
    $('lunchFuera').classList.toggle('selected', opcion === 'NO');
    $('sumAlm').innerHTML = opcion === 'SI' ? '<i class="fas fa-building"></i> En planta' : '<i class="fas fa-home"></i> Fuera de planta';
}

function volverABuscar() {
    $('screenRegister').classList.add('hidden');
    $('screenSearch').classList.remove('hidden');
    $('iId').value = '';
    $('iId').focus();
    limpiarDatosEmpleado();
}

async function registrar() {
    if (empleadoActual.tipo === 'ENTRADA' && !empleadoActual.almuerzo) {
        mostrarToast('Seleccione opción de almuerzo', 'error');
        return;
    }
    
    if (empleadoActual.tipo === 'SALIDA') {
        const ahora = new Date();
        const mins = ahora.getHours() * 60 + ahora.getMinutes();
        if (mins < (16 * 60 + 15)) {
            const horaStr = ahora.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
            const confirmar = confirm("⚠️ Salida anticipada (" + horaStr + ").\nLa jornada oficial finaliza a las 16:15.\n\n¿Desea confirmar el registro de salida para " + (empleadoActual.nombre || '') + "?");
            if (!confirmar) return;
        }
    }
    
    showLoading(true, 'Registrando ' + (empleadoActual.tipo === 'ENTRADA' ? 'entrada' : 'salida') + ' de ' + (empleadoActual.nombre || '') + '…');
    const btn = $('btnRegistrar');
    btn.disabled = true;
    
    try {
        const res = await registrarAsistencia({
            id: empleadoActual.id,
            nombre: empleadoActual.nombre,
            tipo: empleadoActual.tipo,
            almuerzo: empleadoActual.almuerzo,
            lat: lat,
            lng: lng
        });
        
        showLoading(false);
        btn.disabled = false;
        
        if (res && res.ok) {
            mostrarToast(`${empleadoActual.tipo} registrada correctamente`, 'success');
            // La lista de presentes se actualiza en segundo plano (queda lista al abrir la pestaña)
            cargarPresentes();
            setTimeout(() => {
                volverABuscar();
            }, 1500);
        } else {
            mostrarToast(res?.error || 'Error al registrar', 'error');
        }
    } catch (err) {
        showLoading(false);
        btn.disabled = false;
        mostrarToast('Error de conexión', 'error');
    }
}

// ============================================================
//  LIMPIEZA
// ============================================================
function limpiarTodo() {
    empleadoActual = { id: '', nombre: '', area: '', tipo: '', almuerzo: '', foto_url: '' };
    estadoEmpleado = {};
    $('iId').value = '';
    $('screenRegister').classList.add('hidden');
    $('screenSearch').classList.remove('hidden');
}

function limpiarDatosEmpleado() {
    empleadoActual = { id: '', nombre: '', area: '', tipo: '', almuerzo: '', foto_url: '' };
    estadoEmpleado = {};
}

function verificarEstadoSesion() {
    const session = localStorage.getItem('GUARDIA_SESSION') || localStorage.getItem('SUPERVISOR_SESSION');
    if (session) {
        $('vLogin').classList.add('hidden');
        $('vTerm').classList.remove('hidden');
        startGPS();
        cargarPresentes();
    } else {
        $('vLogin').classList.remove('hidden');
    }
}

$('iClave')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
$('presentList')?.addEventListener('click', e => { const f = e.target.closest('[data-foto]'); if (f) showPhotoModal(f.dataset.foto); });
$('iId')?.addEventListener('keypress', e => { if (e.key === 'Enter') buscar(); });

window.addEventListener('beforeunload', () => {
    if (watchId) navigator.geolocation.clearWatch(watchId);
});

verificarEstadoSesion();

// ============================================================
//  ACTUALIZACIÓN FORZADA REMOTA (TERMINAL GUARDIA)
// ============================================================
async function verificarActualizacionRemotaGuardia() {
    try {
        if (!window.FirebaseBackend || typeof window.FirebaseBackend.obtenerConfiguraciones !== 'function') return;
        const config = await window.FirebaseBackend.obtenerConfiguraciones();
        if (!config || !config.forzar_actualizacion_ts) return;

        const tsRemoto = Number(config.forzar_actualizacion_ts);
        const tsLocal = Number(localStorage.getItem('guardia_ultima_act_forzada') || 0);

        if (tsRemoto > tsLocal) {
            console.log(`⚡ [GUARDIA] Actualización forzada detectada (ts: ${tsRemoto}). Purgando caché y recargando...`);
            localStorage.setItem('guardia_ultima_act_forzada', String(tsRemoto));
            mostrarToast('🔄 Actualizando terminal a la última versión...', 'info');

            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }

            setTimeout(() => {
                const url = new URL(window.location.href);
                url.searchParams.set('v_update', tsRemoto);
                window.location.replace(url.toString());
            }, 600);
        }
    } catch (e) {
        console.warn('[GUARDIA] Error comprobando actualización remota:', e);
    }
}

// Comprobación inicial y periódica cada 15 min
setTimeout(verificarActualizacionRemotaGuardia, 3000);
setInterval(verificarActualizacionRemotaGuardia, 15 * 60 * 1000);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        verificarActualizacionRemotaGuardia();
    }
});