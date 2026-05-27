const logConexion = document.getElementById('logConexion');
const logInfo = document.getElementById('logInfo');
const statusGeneral = document.getElementById('statusGeneral');

function log(msg, tipo = 'info', seccion = 'conexion') {
    const box = seccion === 'conexion' ? logConexion : logInfo;
    const entry = document.createElement('div');
    entry.className = `log-entry ${tipo}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `[${timestamp}] ${msg}`;
    box.appendChild(entry);
    box.scrollTop = box.scrollHeight;
    console.log(`[${timestamp}] [${tipo.toUpperCase()}] ${msg}`);
}

function limpiarLog() {
    logConexion.innerHTML = '';
    logInfo.innerHTML = '';
    log('Log limpiado', 'success');
}

function validarURL() {
    const url = document.getElementById('apiUrl').value.trim();
    logInfo.innerHTML = '';
    
    log('Validando URL...', 'info', 'info');
    
    // Validaciones básicas
    if (!url) {
        log('❌ URL vacía', 'error', 'info');
        actualizarStatus('error', 'URL no ingresada');
        return;
    }
    
    if (!url.startsWith('https://')) {
        log('❌ URL debe empezar con https://', 'error', 'info');
        actualizarStatus('error', 'Protocolo inválido');
        return;
    }
    
    if (!url.includes('script.google.com')) {
        log('❌ URL debe contener script.google.com', 'error', 'info');
        actualizarStatus('error', 'Host inválido');
        return;
    }
    
    if (!url.includes('/macros/s/')) {
        log('❌ URL debe contener /macros/s/', 'error', 'info');
        actualizarStatus('error', 'Formato de URL inválido');
        return;
    }
    
    if (!url.includes('/exec')) {
        log('❌ URL debe terminar con /exec', 'error', 'info');
        actualizarStatus('error', 'Falta /exec al final');
        return;
    }
    
    // Extraer ID de deployment
    const match = url.match(/\/macros\/s\/([a-zA-Z0-9_-]+)/);
    if (match) {
        const deploymentId = match[1];
        log(`✓ URL válida`, 'success', 'info');
        log(`Deployment ID: ${deploymentId}`, 'success', 'info');
        log(`Longitud ID: ${deploymentId.length} caracteres`, 'info', 'info');
        actualizarStatus('ok', 'URL correcta');
    } else {
        log('❌ No se pudo extraer Deployment ID', 'error', 'info');
        actualizarStatus('error', 'Formato incorrecto');
    }
}

function actualizarStatus(estado, msg) {
    const clases = {
        'ok': 'ok',
        'error': 'error',
        'warning': 'warning'
    };
    statusGeneral.className = `status ${clases[estado] || 'warning'}`;
    const icons = { 'ok': '✓', 'error': '❌', 'warning': '⚠️' };
    statusGeneral.textContent = `${icons[estado]} ${msg}`;
}

function jsonpRequest(params) {
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return window.FirebaseBackend.procesarAccion(params);
    }
    return new Promise((resolve, reject) => {
        const url = document.getElementById('apiUrl').value.trim();
        
        if (!url.startsWith('https://')) {
            reject(new Error('URL no válida'));
            return;
        }
        
        const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const timeout = setTimeout(() => {
            delete window[callback];
            reject(new Error('TIMEOUT (15s) - El servidor no respondió'));
        }, 15000);

        window[callback] = (data) => {
            clearTimeout(timeout);
            delete window[callback];
            resolve(data);
        };

        const fullUrl = new URL(url);
        fullUrl.searchParams.append('callback', callback);
        Object.keys(params).forEach(k => {
            if (params[k] !== undefined) {
                fullUrl.searchParams.append(k, params[k].toString());
            }
        });

        log(`Enviando solicitud JSONP a: ${url}`, 'info', 'conexion');
        log(`Callback: ${callback}`, 'info', 'conexion');
        log(`Parámetros: ${JSON.stringify(params)}`, 'info', 'conexion');

        const script = document.createElement('script');
        script.src = fullUrl.toString();
        script.onerror = () => {
            clearTimeout(timeout);
            delete window[callback];
            reject(new Error('Error al cargar el script (CORS o error de red)'));
        };
        document.body.appendChild(script);
        
        setTimeout(() => {
            if (script.parentNode) script.parentNode.removeChild(script);
        }, 20000);
    });
}

async function testConexion() {
    logConexion.innerHTML = '';
    log('Iniciando prueba de conexión...', 'info');
    actualizarStatus('warning', 'Prueba en progreso...');
    
    try {
        log('Enviando solicitud de prueba...', 'info');
        const res = await jsonpRequest({ accion: 'verificarClaveGuardia', clave: 'TCONTROL2026' });
        
        if (res) {
            log(`✓ Respuesta recibida del servidor`, 'success');
            log(`Datos: ${JSON.stringify(res)}`, 'success');
            actualizarStatus('ok', 'Conexión exitosa');
        } else {
            log('❌ Respuesta vacía del servidor', 'error');
            actualizarStatus('error', 'Respuesta inválida');
        }
    } catch (err) {
        log(`❌ Error: ${err.message}`, 'error');
        actualizarStatus('error', err.message);
    }
}

async function testListaCatering() {
    logConexion.innerHTML = '';
    log('Probando: obtenerListaCatering', 'info');
    actualizarStatus('warning', 'Cargando...');
    
    try {
        const res = await jsonpRequest({ accion: 'obtenerListaCatering' });
        
        if (res && res.empleados) {
            log(`✓ ${res.empleados.length} empleados cargados`, 'success');
            log(`Primero: ${res.empleados[0]?.nombre || 'N/A'}`, 'success');
            actualizarStatus('ok', 'Catering funcionando');
        } else if (res && res.error) {
            log(`⚠️ Error del servidor: ${res.error}`, 'warning');
            actualizarStatus('warning', res.error);
        } else {
            log(`❌ Respuesta inválida: ${JSON.stringify(res)}`, 'error');
            actualizarStatus('error', 'Formato de respuesta incorrecto');
        }
    } catch (err) {
        log(`❌ ${err.message}`, 'error');
        actualizarStatus('error', err.message);
    }
}

async function testDatosSupervisor() {
    logConexion.innerHTML = '';
    log('Probando: obtenerDatosSupervisor', 'info');
    actualizarStatus('warning', 'Cargando...');
    
    try {
        const res = await jsonpRequest({ accion: 'obtenerDatosSupervisor' });
        
        if (res && res.empleados) {
            log(`✓ ${res.empleados.length} empleados en supervisor`, 'success');
            actualizarStatus('ok', 'Datos supervisor OK');
        } else if (res && res.error) {
            log(`⚠️ ${res.error}`, 'warning');
            actualizarStatus('warning', res.error);
        } else {
            log(`❌ Respuesta inválida`, 'error');
            actualizarStatus('error', 'Formato incorrecto');
        }
    } catch (err) {
        log(`❌ ${err.message}`, 'error');
        actualizarStatus('error', err.message);
    }
}

async function testVerificarCambios() {
    logConexion.innerHTML = '';
    log('Probando: verificarCambios', 'info');
    actualizarStatus('warning', 'Verificando...');
    
    try {
        const res = await jsonpRequest({ 
            accion: 'verificarCambios',
            ultimoTimestamp: null,
            totalRegistros: 0
        });
        
        if (res && !res.error) {
            log(`✓ Respuesta válida`, 'success');
            log(`Cambios: ${res.hayCambios || false}`, 'success');
            actualizarStatus('ok', 'Verificación OK');
        } else {
            log(`⚠️ ${res?.error || 'Respuesta inválida'}`, 'warning');
            actualizarStatus('warning', 'Verificación con advertencia');
        }
    } catch (err) {
        log(`❌ ${err.message}`, 'error');
        actualizarStatus('error', err.message);
    }
}

async function testDepurarDuplicados() {
    if (!confirm('¿Seguro que deseas depurar los duplicados? Esta acción no se puede deshacer.')) return;
    logInfo.innerHTML = '';
    log('Iniciando depuración de duplicados en Firestore...', 'warning', 'info');
    actualizarStatus('warning', 'Depurando...');
    
    try {
        const res = await jsonpRequest({ accion: 'depurarDuplicados' });
        if (res.ok) {
            log(`✓ Éxito: Se eliminaron ${res.eliminados} registros duplicados`, 'success', 'info');
            actualizarStatus('ok', 'Limpieza completada');
        } else {
            log(`❌ Error: ${res.error}`, 'error', 'info');
            actualizarStatus('error', res.error);
        }
    } catch (err) {
        log(`❌ ${err.message}`, 'error', 'info');
        actualizarStatus('error', err.message);
    }
}

function mostrarInfo() {
    logInfo.innerHTML = '';
    log(`User Agent: ${navigator.userAgent}`, 'info', 'info');
    log(`Navegador: ${navigator.appName} ${navigator.appVersion}`, 'info', 'info');
    log(`URL actual: ${window.location.href}`, 'info', 'info');
    log(`Local Storage disponible: ${typeof(Storage) !== 'undefined'}`, 'success', 'info');
    
    const url = document.getElementById('apiUrl').value.trim();
    if (url.startsWith('https://')) {
        log(`URL Apps Script: ${url}`, 'success', 'info');
    } else {
        log(`URL Apps Script: NO CONFIGURADA`, 'error', 'info');
    }
}

// Inicializar
window.addEventListener('load', () => {
    mostrarInfo();
    validarURL();
});