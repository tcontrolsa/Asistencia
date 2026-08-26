// ============================================================
//  CONFIGURACIÓN
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';

// Estado global
let empleados = [];
let filtroActual = 'todos';
let timeoutAutoRefresh = null;
let isRefreshing = false;
let procesandoIds = new Set();
let currentScripts = new Set(); // Para limpiar scripts antiguos

// ============================================================
//  UTILIDADES
// ============================================================
function $(id) { 
    return document.getElementById(id); 
}

function mostrarToast(msg, esError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-fast' + (esError ? ' error' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeString(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function convertirUrlDrive(url) {
    const urlStr = safeString(url);
    if (!urlStr) return null;
    
    if (urlStr.includes('lh3.googleusercontent.com')) return urlStr;
    
    let fileId = null;
    let match = urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) { fileId = match[1]; }
    
    if (!fileId) {
        match = urlStr.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (match) { fileId = match[1]; }
    }
    
    if (!fileId) {
        match = urlStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) { fileId = match[1]; }
    }
    
    if (!fileId) {
        match = urlStr.match(/open\?id=([a-zA-Z0-9_-]+)/);
        if (match) { fileId = match[1]; }
    }
    
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
    
    return urlStr.startsWith('http') ? urlStr : null;
}

function actualizarHoraActualizacion() {
    const ahora = new Date();
    const horaStr = ahora.toLocaleTimeString('es-EC', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    const lastUpdate = $('lastUpdate');
    if (lastUpdate) {
        lastUpdate.innerHTML = `<i class="bi bi-clock"></i> Última actualización: ${horaStr}`;
    }
}

// ============================================================
//  JSONP REQUEST (INTERCEPTOR FIREBASE)
// ============================================================
function jsonpRequest(params) {
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return window.FirebaseBackend.procesarAccion(params);
    }
    return new Promise((resolve, reject) => {
        // Generar callback único
        const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        let settled = false;

        const cleanup = () => {
            window[callbackName] = function() {};
            setTimeout(() => { delete window[callbackName]; }, 60000);
            const scripts = document.querySelectorAll(`script[src*="${callbackName}"]`);
            scripts.forEach(script => {
                if (script.parentNode) script.parentNode.removeChild(script);
            });
        };

        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Timeout de conexión'));
        }, 20000);
        
        window[callbackName] = function(response) {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            resolve(response);
        };
        
        const url = new URL(API_URL);
        url.searchParams.append('callback', callbackName);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');

        // Inyectar credenciales de sesión si existen
        const session = localStorage.getItem('SUPERVISOR_SESSION');
        if (session) {
            const data = JSON.parse(session);
            url.searchParams.append('empleadoId', data.id);
            url.searchParams.append('deviceToken', data.token);
        }
        
        Object.keys(params).forEach(key => {
            const value = params[key];
            if (value !== undefined && value !== null) {
                if (key === 'empleadoId' || key === 'deviceToken') return;
                url.searchParams.append(key, safeString(value));
            }
        });
        
        // Crear y agregar script
        const script = document.createElement('script');
        script.src = url.toString();
        script.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            reject(new Error('Error de red'));
        };
        
        document.head.appendChild(script);
        
        // Auto-limpiar después de 5 segundos (por si acaso)
        setTimeout(() => {
            if (window[callbackName]) {
                cleanup();
                reject(new Error('Timeout en respuesta'));
            }
        }, 21000);
    });
}

// ============================================================
//  API CALLS CON REINTENTOS
// ============================================================
async function callWithRetry(action, params = {}, maxRetries = 2) {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            const fullParams = { accion: action, ...params };
            const result = await jsonpRequest(fullParams);
            return result;
        } catch (error) {
            console.warn(`Intento ${i + 1}/${maxRetries + 1} falló para ${action}:`, error.message);
            if (i === maxRetries) throw error;
            // Esperar antes de reintentar (backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

async function cargarListaCatering() {
    console.log('📡 Cargando lista de catering...');
    return await callWithRetry('obtenerListaCatering');
}

async function marcarConsumido(empleadoId, empleadoNombre) {
    console.log(`📡 Marcando consumo para ${empleadoId}...`);
    return await callWithRetry('marcarAlmuerzoConsumido', {
        empleadoId: safeString(empleadoId),
        nombre: safeString(empleadoNombre)
    });
}

// ============================================================
//  CARGA DE DATOS
// ============================================================
async function cargarDatos() {
    if (isRefreshing) {
        console.log('⏳ Ya hay una carga en progreso');
        return;
    }
    
    isRefreshing = true;
    const btn = document.querySelector('.refresh-btn');
    if (btn) btn.classList.add('loading');
    
    try {
        const res = await cargarListaCatering();
        
        if (btn) btn.classList.remove('loading');
        isRefreshing = false;
        
        if (res && res.error) {
            console.error('Error del servidor:', res.error);
            if (!empleados.length) {
                mostrarToast('Error: ' + safeString(res.error), true);
            }
            return;
        }
        
        if (res && Array.isArray(res.empleados)) {
            empleados = res.empleados;
            console.log(`✅ ${empleados.length} empleados cargados`);
            actualizarStats();
            filtrarLista();
            actualizarHoraActualizacion();
        } else {
            console.warn('Respuesta inválida:', res);
        }
    } catch (err) {
        if (btn) btn.classList.remove('loading');
        isRefreshing = false;
        console.error('Error en cargarDatos:', err);
        
        if (!empleados.length) {
            mostrarToast('Error de conexión', true);
            const container = $('employeeList');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="bi bi-wifi-off"></i>
                        <p>Error de conexión</p>
                        <small>Verifica tu conexión a internet</small>
                        <br><br>
                        <button onclick="window.manualRefresh()" class="btn btn-sm btn-danger">Reintentar</button>
                    </div>
                `;
            }
        }
    }
}

function actualizarStats() {
    const total = empleados.length;
    const consumidos = empleados.filter(e => e.consumido === true).length;
    const pendientes = total - consumidos;
    
    if ($('totalCount')) $('totalCount').textContent = total;
    if ($('pendingCount')) $('pendingCount').textContent = pendientes;
    if ($('consumedCount')) $('consumedCount').textContent = consumidos;
}

// ============================================================
//  FILTRADO Y RENDERIZADO
// ============================================================
function filtrarPor(tipo) {
    filtroActual = tipo;
    
    document.querySelectorAll('.stat-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (tipo === 'todos') document.querySelector('.stat-btn.total').classList.add('active');
    if (tipo === 'pendientes') document.querySelector('.stat-btn.pending').classList.add('active');
    if (tipo === 'consumidos') document.querySelector('.stat-btn.consumed').classList.add('active');
    
    localStorage.setItem('catering_filtro', tipo);
    filtrarLista();
}

function filtrarLista() {
    const searchTerm = (safeString($('searchInput')?.value || '')).toLowerCase();
    
    let filtrados = [...empleados];
    
    if (searchTerm) {
        filtrados = filtrados.filter(emp => 
            safeString(emp.nombre).toLowerCase().includes(searchTerm) || 
            safeString(emp.id).toLowerCase().includes(searchTerm)
        );
    }
    
    if (filtroActual === 'pendientes') {
        filtrados = filtrados.filter(emp => emp.consumido === false);
    } else if (filtroActual === 'consumidos') {
        filtrados = filtrados.filter(emp => emp.consumido === true);
    }
    
    renderizarLista(filtrados);
}

function renderizarLista(lista) {
    const container = $('employeeList');
    if (!container) return;
    
    if (!lista || lista.length === 0) {
        let mensaje = '';
        if (filtroActual === 'pendientes') mensaje = '✅ No hay almuerzos pendientes';
        else if (filtroActual === 'consumidos') mensaje = '📋 No hay almuerzos consumidos registrados';
        else mensaje = '🍽️ No hay empleados que almuerzan en planta hoy';
        
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-egg-fried"></i>
                <p>${mensaje}</p>
                <small>Actualiza la lista si crees que debería haber empleados</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = lista.map(emp => {
        const fotoUrl = convertirUrlDrive(emp.foto_url);
        const tieneFoto = fotoUrl && fotoUrl.trim() !== '';
        const inicial = (safeString(emp.nombre).charAt(0) || '?').toUpperCase();
        const consumido = emp.consumido === true;
        const procesando = procesandoIds.has(safeString(emp.id));
        const id = escapeHtml(safeString(emp.id));
        const nombre = escapeHtml(safeString(emp.nombre));
        const area = escapeHtml(safeString(emp.area || 'Sin área'));
        let hora = safeString(emp.hora_entrada || '--:--');
        
        // Limpiar formato de hora si es necesario
        if (hora.includes('Dec 30 1899')) {
            const match = hora.match(/(\d{2}:\d{2})/);
            if (match) hora = match[1];
            else hora = '--:--';
        }
        
        return `
            <div class="employee-card ${consumido ? 'consumed' : ''} ${procesando ? 'processing' : ''}" 
                 data-id="${id}"
                 data-nombre="${nombre}"
                 onclick="${consumido || procesando ? '' : `registrarConsumo('${id.replace(/'/g, "\\'")}', '${nombre.replace(/'/g, "\\'")}')`}">
                ${tieneFoto ? 
                    `<img class="emp-photo" src="${escapeHtml(fotoUrl)}" alt="${nombre}" 
                          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                     <div class="emp-photo-placeholder" style="display:none">${inicial}</div>` : 
                    `<div class="emp-photo-placeholder">${inicial}</div>`
                }
                <div class="emp-info">
                    <div class="emp-name">${nombre}</div>
                    <div class="emp-meta">
                        <span><i class="bi bi-person-badge"></i> ${id}</span>
                        <span><i class="bi bi-building"></i> ${area}</span>
                        <span><i class="bi bi-clock"></i> ${hora}</span>
                    </div>
                </div>
                <div class="emp-status ${consumido ? 'status-consumed' : 'status-pending'}">
                    ${consumido ? '<i class="bi bi-check-circle-fill"></i> Consumido' : '<i class="bi bi-egg-fried"></i> Servir'}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
//  REGISTRAR CONSUMO
// ============================================================
async function registrarConsumo(id, nombre) {
    if (procesandoIds.has(id)) return;
    
    const empleadoIndex = empleados.findIndex(e => safeString(e.id) === id);
    if (empleadoIndex === -1) return;
    
    if (empleados[empleadoIndex].consumido === true) return;
    
    procesandoIds.add(id);
    const estadoAnterior = empleados[empleadoIndex].consumido;
    
    // Actualizar UI optimistamente
    empleados[empleadoIndex].consumido = true;
    actualizarStats();
    filtrarLista();
    mostrarToast(`✓ ${nombre} - Almuerzo marcado como consumido`);
    
    try {
        const res = await marcarConsumido(id, nombre);
        
        if (res && res.error) {
            empleados[empleadoIndex].consumido = estadoAnterior;
            actualizarStats();
            filtrarLista();
            mostrarToast('Error: ' + safeString(res.error), true);
        } else {
            console.log(`✅ Consumo registrado: ${nombre}`);
            // Recargar datos después de 1 segundo
            setTimeout(() => cargarDatos(), 1000);
        }
    } catch (err) {
        empleados[empleadoIndex].consumido = estadoAnterior;
        actualizarStats();
        filtrarLista();
        mostrarToast('Error: ' + safeString(err.message), true);
    } finally {
        procesandoIds.delete(id);
    }
}

// ============================================================
//  RECARGA AUTOMÁTICA
// ============================================================
function iniciarRecargaAutomatica() {
    if (timeoutAutoRefresh) clearInterval(timeoutAutoRefresh);
    // Recargar cada 45 segundos
    timeoutAutoRefresh = setInterval(() => {
        if (document.visibilityState === 'visible' && !isRefreshing) {
            console.log('🔄 Recarga automática');
            cargarDatos();
        }
    }, 45000);
}

function restaurarPreferencias() {
    const filtroGuardado = localStorage.getItem('catering_filtro');
    if (filtroGuardado && ['todos', 'pendientes', 'consumidos'].includes(filtroGuardado)) {
        filtroActual = filtroGuardado;
        const btns = document.querySelectorAll('.stat-btn');
        btns.forEach(btn => btn.classList.remove('active'));
        if (filtroActual === 'todos' && btns[0]) btns[0].classList.add('active');
        if (filtroActual === 'pendientes' && btns[1]) btns[1].classList.add('active');
        if (filtroActual === 'consumidos' && btns[2]) btns[2].classList.add('active');
    }
}

// Función global para refresh manual
window.manualRefresh = function() {
    console.log('🔄 Refresh manual solicitado');
    cargarDatos();
};

// ============================================================
//  GESTIÓN DE SESIÓN
// ============================================================
async function intentarLoginCatering() {
    const id = $('supId').value.trim();
    const pin = $('supPin').value.trim();
    
    if (!id || !pin) {
        mostrarError('Ingrese ID y PIN');
        return;
    }
    
    $('login-error').classList.add('hidden');
    const loading = document.querySelector('.btn-login');
    loading.disabled = true;
    loading.textContent = 'Verificando...';
    
    try {
        const deviceToken = generarDeviceToken();
        const passHash = typeof hashPassword === 'function' ? await hashPassword(pin) : pin;
        let res = await jsonpRequest({ accion: 'verificarPIN', pin: passHash, deviceToken: deviceToken, empleadoId: id });
        
        if ((!res || !res.valido) && (!res?.error || res?.error === "Contraseña incorrecta")) {
            const resPlain = await jsonpRequest({ accion: 'verificarPIN', pin: pin, deviceToken: deviceToken, empleadoId: id });
            if (resPlain && resPlain.valido) {
                res = resPlain;
            }
        }
        
        if (res && res.error) {
            mostrarError(res.error);
        } else if (res && res.valido) {
            if (res.empleado.esSupervisor) {
                const sessionData = { id: res.empleado.id, token: deviceToken, timestamp: new Date().getTime() };
                localStorage.setItem('SUPERVISOR_SESSION', JSON.stringify(sessionData));
                $('login-catering').classList.add('hidden');
                cargarDatos();
            } else {
                mostrarError('Rango insuficiente.');
            }
        } else {
            mostrarError('PIN incorrecto.');
        }
    } catch(e) {
        mostrarError('Error de conexión');
    } finally {
        loading.disabled = false;
        loading.textContent = 'Ingresar';
    }
}

function mostrarError(msg) {
    const el = $('login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function generarDeviceToken() {
    let token = localStorage.getItem('DEVICE_TOKEN_CATERING');
    if (!token) {
        token = 'CAT_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('DEVICE_TOKEN_CATERING', token);
    }
    return token;
}

function verificarEstadoSesion() {
    const session = localStorage.getItem('SUPERVISOR_SESSION');
    if (session) {
        $('login-catering').classList.add('hidden');
        cargarDatos();
    } else {
        $('login-catering').classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 App de Catering v2.0 iniciada');
    restaurarPreferencias();
    verificarEstadoSesion();
    iniciarRecargaAutomatica();
    
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('👁️ App visible - recargando');
            cargarDatos();
        }
    });
});

// Prevenir errores de extensión silenciosamente
window.addEventListener('error', (e) => {
    if (e.message && e.message.includes('Could not establish connection')) {
        e.preventDefault();
        return false;
    }
});