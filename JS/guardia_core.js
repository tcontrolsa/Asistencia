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

function showLoading(show) {
    $('loadingOverlay').classList.toggle('hidden', !show);
}

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
    
    // Actualizar estilos de pestañas
    document.querySelectorAll('.tab').forEach((t, index) => {
        if ((tab === 'registro' && index === 0) || (tab === 'presentes' && index === 1)) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    
    // Mostrar/ocultar paneles
    if (tab === 'registro') {
        $('panelRegistro').classList.remove('hidden');
        $('panelPresentes').classList.add('hidden');
    } else {
        $('panelRegistro').classList.add('hidden');
        $('panelPresentes').classList.remove('hidden');
        cargarPresentes();
    }
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
        const timeout = setTimeout(() => {
            delete window[callback];
            reject(new Error('Timeout'));
        }, 15000);

        window[callback] = (data) => {
            clearTimeout(timeout);
            delete window[callback];
            resolve(data);
        };

        const url = new URL(API_URL);
        url.searchParams.append('callback', callback);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');
        
        // Inyectar credenciales de sesión si existen
        const session = localStorage.getItem('SUPERVISOR_SESSION');
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

        const script = document.createElement('script');
        script.src = url.toString();
        script.onerror = () => { clearTimeout(timeout); reject(new Error('Error de red')); };
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

async function obtenerPresentes() {
    return await jsonpRequest({ accion: 'obtenerDatosSupervisor' });
}

// ============================================================
//  PRESENTES
// ============================================================
async function cargarPresentes() {
    showLoading(true);
    try {
        const res = await obtenerPresentes();
        showLoading(false);
        
        if (res.error) {
            mostrarToast(res.error, 'error');
            return;
        }
        
        const empleados = res.empleados || [];
        // Filtrar solo los que tienen entrada hoy
        const presentes = empleados.filter(emp => emp.entradaHoy === true);
        listaPresentes = presentes;
        
        const count = presentes.length;
        $('presentCount').innerHTML = count;
        
        if (count === 0) {
            $('presentList').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-clock"></i>
                    <p>No hay empleados registrados hoy</p>
                </div>
            `;
            return;
        }
        
        // Ordenar por hora de entrada (más reciente primero)
        presentes.sort((a, b) => {
            if (!a.horaEntradaMs) return 1;
            if (!b.horaEntradaMs) return -1;
            return b.horaEntradaMs - a.horaEntradaMs;
        });
        
        $('presentList').innerHTML = presentes.map(emp => {
            const fotoUrl = convertirUrlDrive(emp.foto_url);
            const tieneFoto = fotoUrl && fotoUrl.trim() !== '';
            const inicial = (emp.nombre || '?').charAt(0).toUpperCase();
            const horaEntrada = emp.horaEntradaMs ? new Date(emp.horaEntradaMs).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            const almuerzo = emp.almuerzoHoy === 'SI' ? '🏢 Planta' : (emp.almuerzoHoy === 'NO' ? '🏠 Fuera' : '');
            
            return `
                <div class="present-item">
                    ${tieneFoto ? 
                        `<img class="present-photo" src="${fotoUrl}" alt="${emp.nombre}" onclick="showPhotoModal('${fotoUrl}')" style="cursor:pointer;">` : 
                        `<div class="present-photo-placeholder">${inicial}</div>`
                    }
                    <div class="present-info">
                        <div class="present-name">${escapeHtml(emp.nombre)}</div>
                        <div class="present-time">
                            <i class="fas fa-clock"></i> ${horaEntrada}
                            ${emp.salidaHoy ? `<span class="present-badge badge-salida-small"><i class="fas fa-sign-out-alt"></i> Salida: ${emp.horaSalidaMs ? new Date(emp.horaSalidaMs).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>` : ''}
                            ${almuerzo ? `<span class="present-badge badge-almuerzo"><i class="fas fa-utensils"></i> ${almuerzo}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        showLoading(false);
        mostrarToast('Error al cargar presentes: ' + err.message, 'error');
    }
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
    
    showLoading(true);
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
            localStorage.setItem('SUPERVISOR_SESSION', JSON.stringify(sessionData));
            
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
    localStorage.removeItem('SUPERVISOR_SESSION');
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
    
    showLoading(true);
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
    
    showLoading(true);
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
            // Actualizar lista de presentes después de registrar
            if (tabActual === 'presentes') {
                cargarPresentes();
            }
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
    const session = localStorage.getItem('SUPERVISOR_SESSION');
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
$('iId')?.addEventListener('keypress', e => { if (e.key === 'Enter') buscar(); });

window.addEventListener('beforeunload', () => {
    if (watchId) navigator.geolocation.clearWatch(watchId);
});

verificarEstadoSesion();