// app.js
// Variables globales
let deviceToken = null;
let posicion = { lat: null, lng: null };
let gpsActivo = false;
let registrosCompletos = [];
let intervaloGPS = null;

let estado = {
    tieneEntrada: false,
    tieneSalida: false,
    horaEntrada: null,
    horaSalida: null,
    almuerzo: null,
    esSupervisor: false
};

let empleado = {
    id: '',
    nombre: '',
    area: '',
    foto_url: '',
    tipoRegistro: '',
    almuerzo: ''
};

// ========== UTILIDADES ==========
function generarDeviceToken() {
    let token = localStorage.getItem('DEVICE_TOKEN');
    if (!token) {
        token = 'DEV_' + Math.random().toString(36).substr(2, 8).toUpperCase();
        localStorage.setItem('DEVICE_TOKEN', token);
    }
    return token;
}

function generarPIN() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function formatearFechaCompleta() {
    return new Date().toLocaleDateString('es-EC', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatearFechaCorta() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatearHora(fecha) {
    if (!fecha) return '--:--';
    try {
        const d = new Date(fecha);
        if (isNaN(d.getTime())) return '--:--';
        return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

function mostrarToast(msg, tipo = 'info') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast hidden';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.background = tipo === 'error' ? '#dc2626' : tipo === 'success' ? '#059669' : '#0f172a';
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

function showLoading(show) {
    let loading = document.getElementById('loading');
    if (!loading && show) {
        loading = document.createElement('div');
        loading.id = 'loading';
        loading.className = 'loading hidden';
        loading.innerHTML = '<div class="spinner"></div>';
        document.body.appendChild(loading);
    }
    if (loading) {
        loading.classList.toggle('hidden', !show);
    }
}

// ========== GPS ==========
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function verificarDistanciaEmpresa() {
    if (!posicion.lat || !posicion.lng) {
        mostrarToast('Obteniendo ubicación...', 'info');
        return false;
    }
    const distancia = calcularDistancia(posicion.lat, posicion.lng, CONFIG.EMPRESA.LAT, CONFIG.EMPRESA.LNG);
    let indicator = document.getElementById('distanceIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'distanceIndicator';
        indicator.className = 'distance-indicator hidden';
        document.body.appendChild(indicator);
    }
    indicator.textContent = `📍 ${Math.round(distancia)}m / ${CONFIG.EMPRESA.RADIO_METROS}m`;
    indicator.classList.remove('hidden');

    if (distancia <= CONFIG.EMPRESA.RADIO_METROS) {
        indicator.classList.add('valid');
        indicator.classList.remove('invalid');
        return true;
    } else {
        indicator.classList.add('invalid');
        indicator.classList.remove('valid');
        mostrarToast(`❌ Fuera del área (${Math.round(distancia)}m)`, 'error');
        return false;
    }
}

function solicitarPermisoGPS() {
    if (!navigator.geolocation) {
        mostrarToast('Geolocalización no soportada', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            posicion = { lat: position.coords.latitude, lng: position.coords.longitude };
            gpsActivo = true;
            verificarDistanciaEmpresa();
        },
        (error) => {
            console.error('GPS error:', error);
            mostrarToast('Activa el GPS para registrar asistencia', 'error');
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function iniciarGPS() {
    solicitarPermisoGPS();
    if (intervaloGPS) clearInterval(intervaloGPS);
    intervaloGPS = setInterval(solicitarPermisoGPS, 30000);
}

// ========== VERIFICAR EMPLEADO EXISTENTE ==========
async function verificarEmpleadoExistente() {
    const empleadoId = document.getElementById('registroEmployeeId').value.trim();
    if (!empleadoId) {
        mostrarToast('Ingresa un ID primero', 'error');
        return;
    }

    showLoading(true);
    try {
        const res = await api.obtenerEstado(empleadoId, null);
        showLoading(false);

        const resultDiv = document.getElementById('registroResult');
        resultDiv.classList.remove('hidden');

        if (res.error) {
            resultDiv.innerHTML = `<i class="fas fa-times-circle"></i> ${res.error}`;
            resultDiv.style.background = '#fee2e2';
            resultDiv.style.color = '#991b1b';
            mostrarToast(res.error, 'error');
        } else if (res.nombre) {
            resultDiv.innerHTML = `<i class="fas fa-check-circle"></i> ✅ Empleado encontrado: ${res.nombre} (Área: ${res.area})<br>Estado: ${res.tieneEntrada ? 'Entrada registrada' : 'Sin entrada'} | ${res.tieneSalida ? 'Salida registrada' : 'Sin salida'}`;
            resultDiv.style.background = '#dcfce7';
            resultDiv.style.color = '#166534';
            mostrarToast(`✅ Empleado encontrado: ${res.nombre}`, 'success');
        } else {
            resultDiv.innerHTML = `<i class="fas fa-question-circle"></i> Empleado no encontrado. Verifica que el ID exista en la hoja EMPLEADOS.`;
            resultDiv.style.background = '#fef9c3';
            resultDiv.style.color = '#854d0e';
            mostrarToast('⚠️ Empleado no encontrado', 'error');
        }
    } catch (error) {
        showLoading(false);
        mostrarToast('Error de conexión', 'error');
    }
}

// ========== VERIFICACIÓN INICIAL ==========
async function verificarEstadoInicial() {
    iniciarGPS();
    showLoading(true);
    deviceToken = generarDeviceToken();

    const sessionData = localStorage.getItem('SESSION_DATA');
    if (sessionData) {
        try {
            const data = JSON.parse(sessionData);
            if (data.empleadoId && data.token === deviceToken) {
                await cargarEmpleadoPorId(data.empleadoId);
                showLoading(false);
                return;
            }
        } catch (e) { }
    }

    try {
        const res = await api.verificarDispositivo(deviceToken);
        showLoading(false);

        if (res && res.tienePin) {
            document.getElementById('verifyingScreen').classList.add('hidden');
            document.getElementById('pinScreen').classList.remove('hidden');
            document.getElementById('pinInput').focus();
        } else {
            document.getElementById('verifyingScreen').classList.add('hidden');
            document.getElementById('registroInicialScreen').classList.remove('hidden');
            document.getElementById('registroPinDisplay').textContent = generarPIN();
        }
    } catch (error) {
        showLoading(false);
        mostrarToast('Error de conexión', 'error');
        document.getElementById('verifyingScreen').classList.add('hidden');
        document.getElementById('pinScreen').classList.remove('hidden');
    }
}

// ========== PIN ==========
async function verificarPIN() {
    const pin = document.getElementById('pinInput').value.trim();
    if (!pin || pin.length < 4) {
        mostrarToast('Ingresa PIN de 4 dígitos', 'error');
        return;
    }

    showLoading(true);
    try {
        const res = await api.verificarPIN(pin, deviceToken);
        showLoading(false);

        if (res.error) {
            mostrarToast(res.error, 'error');
            return;
        }

        if (res.valido) {
            localStorage.setItem('SESSION_DATA', JSON.stringify({
                empleadoId: res.empleado.id,
                token: deviceToken,
                timestamp: new Date().toISOString()
            }));

            estado = {
                tieneEntrada: res.empleado.tieneEntrada,
                tieneSalida: res.empleado.tieneSalida,
                horaEntrada: res.empleado.horaEntrada,
                horaSalida: res.empleado.horaSalida,
                almuerzo: res.empleado.almuerzo,
                esSupervisor: res.empleado.esSupervisor
            };

            empleado = {
                id: res.empleado.id,
                nombre: res.empleado.nombre,
                area: res.empleado.area,
                foto_url: res.empleado.foto_url,
                tipoRegistro: '',
                almuerzo: ''
            };

            actualizarCredencial();
            document.getElementById('pinScreen').classList.add('hidden');
            document.getElementById('credentialScreen').classList.remove('hidden');
            document.getElementById('btnLogout').style.display = 'flex';
            document.getElementById('deviceStatusHeader').innerHTML = `<i class="fas fa-check-circle"></i> ${empleado.nombre.split(' ')[0]}`;

            await obtenerRegistrosEmpleado();
            mostrarToast(`Bienvenido ${empleado.nombre}`, 'success');

            if (estado.esSupervisor) {
                document.getElementById('btnSupervisor').style.display = 'flex';
            }
        } else {
            mostrarToast('PIN incorrecto', 'error');
        }
    } catch (error) {
        showLoading(false);
        mostrarToast('Error de conexión', 'error');
    }
}

// ========== REGISTRO INICIAL ==========
function mostrarRegistroInicial() {
    document.getElementById('pinScreen').classList.add('hidden');
    document.getElementById('registroInicialScreen').classList.remove('hidden');
    document.getElementById('registroPinDisplay').textContent = generarPIN();
    document.getElementById('registroResult').classList.add('hidden');
}

async function confirmarRegistroInicial() {
    const empleadoId = document.getElementById('registroEmployeeId').value.trim();
    const pin = document.getElementById('registroPinDisplay').textContent;

    if (!empleadoId) {
        mostrarToast('❌ Ingresa tu ID de empleado', 'error');
        return;
    }

    showLoading(true);

    try {
        const res = await api.registrarDispositivo(empleadoId, pin, deviceToken);
        showLoading(false);

        if (res.error) {
            let mensajeError = res.error;
            if (res.error.includes('no encontrado')) {
                mensajeError = `❌ Empleado ID ${empleadoId} no encontrado. Verifica que exista en la hoja EMPLEADOS y esté ACTIVO.`;
            } else if (res.error.includes('inactivo')) {
                mensajeError = `❌ El empleado ${empleadoId} está marcado como INACTIVO. Contacta a RRHH.`;
            }
            mostrarToast(mensajeError, 'error');

            const resultDiv = document.getElementById('registroResult');
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = `<i class="fas fa-times-circle"></i> ${mensajeError}`;
            resultDiv.style.background = '#fee2e2';
            resultDiv.style.color = '#991b1b';
            return;
        }

        if (res.ok) {
            mostrarToast(`✅ Registro exitoso. Guarda tu PIN: ${pin}`, 'success');
            localStorage.setItem('SESSION_DATA', JSON.stringify({
                empleadoId,
                token: deviceToken,
                timestamp: new Date().toISOString()
            }));
            await cargarEmpleadoPorId(empleadoId);
        } else {
            mostrarToast('❌ Error desconocido al registrar', 'error');
        }
    } catch (error) {
        showLoading(false);
        mostrarToast('❌ Error de conexión con el servidor', 'error');
    }
}

async function cargarEmpleadoPorId(id) {
    showLoading(true);
    try {
        const res = await api.obtenerEstado(id, null);
        showLoading(false);

        if (res.error) {
            mostrarToast(res.error, 'error');
            volverAPIN();
            return;
        }

        estado = {
            tieneEntrada: res.tieneEntrada,
            tieneSalida: res.tieneSalida,
            horaEntrada: res.horaEntrada,
            horaSalida: res.horaSalida,
            almuerzo: res.almuerzo,
            esSupervisor: res.esSupervisor || false
        };

        empleado = {
            id: res.id,
            nombre: res.nombre,
            area: res.area,
            foto_url: res.foto_url,
            tipoRegistro: '',
            almuerzo: ''
        };

        actualizarCredencial();
        document.getElementById('registroInicialScreen').classList.add('hidden');
        document.getElementById('pinScreen').classList.add('hidden');
        document.getElementById('credentialScreen').classList.remove('hidden');
        document.getElementById('btnLogout').style.display = 'flex';
        document.getElementById('deviceStatusHeader').innerHTML = `<i class="fas fa-check-circle"></i> ${empleado.nombre.split(' ')[0]}`;

        await obtenerRegistrosEmpleado();
        mostrarToast(`Bienvenido ${empleado.nombre}`, 'success');

        if (estado.esSupervisor) {
            document.getElementById('btnSupervisor').style.display = 'flex';
        }
    } catch (error) {
        showLoading(false);
        mostrarToast('Error al cargar empleado', 'error');
        volverAPIN();
    }
}

function volverAPIN() {
    document.getElementById('registroInicialScreen').classList.add('hidden');
    document.getElementById('pinScreen').classList.remove('hidden');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
    document.getElementById('pinResult').classList.add('hidden');
    document.getElementById('btnLogout').style.display = 'none';
}

function cerrarSesion() {
    if (confirm('¿Cerrar sesión? Se eliminará el acceso de este dispositivo.')) {
        localStorage.clear();
        location.reload();
    }
}

function abrirSupervisor() {
    window.open('supervisor.html', '_blank');
}

// ========== CREDENCIAL MEJORADA ==========
function actualizarCredencial() {
    // Verificar que los elementos existan
    if (!document.getElementById('employeeNamePremium')) return;

    const nombreCompleto = empleado.nombre || 'EMPLEADO';
    const partes = nombreCompleto.split(' ');
    const primerNombre = partes[0] || 'EMPLEADO';
    const apellido = partes.slice(1).join(' ') || '';

    // Actualizar nombre
    document.getElementById('employeeNamePremium').textContent = `${primerNombre} ${apellido}`.trim();
    document.getElementById('employeeIdPremium').textContent = empleado.id || '-';
    document.getElementById('employeeAreaPremium').textContent = empleado.area || 'Área';
    document.getElementById('deviceInfoPremium').textContent = 'Activo';

    // Foto
    const photoImg = document.getElementById('employeePhotoPremium');
    const photoPlaceholder = document.getElementById('photoPlaceholderPremium');
    if (empleado.foto_url && empleado.foto_url.trim()) {
        photoImg.src = empleado.foto_url;
        photoImg.classList.remove('hidden');
        photoPlaceholder.classList.add('hidden');
    } else {
        photoImg.classList.add('hidden');
        photoPlaceholder.classList.remove('hidden');
    }

    // Fecha y hora
    const now = new Date();
    document.getElementById('dateInfoPremium').textContent = formatearFechaCorta();
    document.getElementById('currentTimePremium').textContent = now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('todayDatePremium').textContent = formatearFechaCompleta().split(',')[0];
    document.getElementById('footerDatePremium').innerHTML = `<i class="far fa-calendar-alt"></i> ${formatearFechaCompleta()}`;

    // Estadísticas
    const totalEntradas = registrosCompletos.filter(r => r.tipo === 'ENTRADA').length;
    const totalSalidas = registrosCompletos.filter(r => r.tipo === 'SALIDA').length;
    const diasUnicos = new Set(registrosCompletos.map(r => r.fecha)).size;

    document.getElementById('statEntradas').textContent = totalEntradas;
    document.getElementById('statSalidas').textContent = totalSalidas;
    document.getElementById('statDias').textContent = diasUnicos;

    // Timeline
    const hoy = new Date().toISOString().split('T')[0];
    const registrosHoy = registrosCompletos.filter(r => r.fecha === hoy);
    const entradaHoy = registrosHoy.find(r => r.tipo === 'ENTRADA');
    const salidaHoy = registrosHoy.find(r => r.tipo === 'SALIDA');
    const almuerzoHoy = entradaHoy?.almuerzo;

    // Entrada
    if (entradaHoy) {
        document.getElementById('timelineEntradaHora').textContent = formatearHora(entradaHoy.timestamp || entradaHoy.hora);
        document.getElementById('timelineEntradaStatus').innerHTML = '<i class="fas fa-check-circle"></i> Completada';
        document.getElementById('timelineEntradaStatus').className = 'timeline-status-premium completed';
    } else {
        document.getElementById('timelineEntradaHora').textContent = '--:--';
        document.getElementById('timelineEntradaStatus').innerHTML = '<i class="fas fa-hourglass-half"></i> Pendiente';
        document.getElementById('timelineEntradaStatus').className = 'timeline-status-premium pending';
    }

    // Almuerzo
    if (almuerzoHoy === 'SI') {
        document.getElementById('timelineAlmuerzoInfo').textContent = '🍽️ Dentro de planta';
        document.getElementById('timelineAlmuerzoStatus').innerHTML = '<i class="fas fa-check-circle"></i> Registrado';
        document.getElementById('timelineAlmuerzoStatus').className = 'timeline-status-premium completed';
    } else if (almuerzoHoy === 'NO') {
        document.getElementById('timelineAlmuerzoInfo').textContent = '🏠 Fuera de planta';
        document.getElementById('timelineAlmuerzoStatus').innerHTML = '<i class="fas fa-check-circle"></i> Registrado';
        document.getElementById('timelineAlmuerzoStatus').className = 'timeline-status-premium completed';
    } else {
        document.getElementById('timelineAlmuerzoInfo').textContent = 'No registrado';
        document.getElementById('timelineAlmuerzoStatus').innerHTML = '<i class="fas fa-question-circle"></i> Por definir';
        document.getElementById('timelineAlmuerzoStatus').className = 'timeline-status-premium pending';
    }

    // Salida
    if (salidaHoy) {
        document.getElementById('timelineSalidaHora').textContent = formatearHora(salidaHoy.timestamp || salidaHoy.hora);
        document.getElementById('timelineSalidaStatus').innerHTML = '<i class="fas fa-check-circle"></i> Completada';
        document.getElementById('timelineSalidaStatus').className = 'timeline-status-premium completed';
    } else if (entradaHoy && !salidaHoy) {
        document.getElementById('timelineSalidaHora').textContent = '--:--';
        document.getElementById('timelineSalidaStatus').innerHTML = '<i class="fas fa-play-circle"></i> En curso';
        document.getElementById('timelineSalidaStatus').className = 'timeline-status-premium pending';
    } else {
        document.getElementById('timelineSalidaHora').textContent = '--:--';
        document.getElementById('timelineSalidaStatus').innerHTML = '<i class="fas fa-hourglass-half"></i> Pendiente';
        document.getElementById('timelineSalidaStatus').className = 'timeline-status-premium pending';
    }

    // Botones
    document.getElementById('btnEntradaPremium').disabled = estado.tieneEntrada;
    document.getElementById('btnSalidaPremium').disabled = !estado.tieneEntrada || estado.tieneSalida;
}

// Actualizar hora cada segundo
setInterval(() => {
    if (document.getElementById('credentialScreen') && !document.getElementById('credentialScreen').classList.contains('hidden')) {
        const now = new Date();
        const timeElement = document.getElementById('currentTimePremium');
        if (timeElement) {
            timeElement.textContent = now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }
}, 1000);

async function obtenerRegistrosEmpleado() {
    if (!empleado.id) return;
    try {
        const registros = await api.obtenerRegistros(empleado.id);
        registrosCompletos = registros || [];
        actualizarCredencial();
        actualizarMiniDashboard();
    } catch (error) {
        console.error('Error:', error);
    }
}

function actualizarMiniDashboard() {
    if (!empleado.id) return;

    const resumenNombre = document.getElementById('resumenNombre');
    const resumenId = document.getElementById('resumenId');
    const resumenAvatar = document.getElementById('resumenAvatar');
    const resumenFecha = document.getElementById('resumenFecha');

    if (resumenFecha) resumenFecha.textContent = formatearFechaCorta();
    if (resumenNombre) resumenNombre.textContent = empleado.nombre || 'Empleado';
    if (resumenId) resumenId.textContent = empleado.id;
    if (resumenAvatar) resumenAvatar.textContent = (empleado.nombre?.charAt(0) || '?').toUpperCase();

    const hoy = new Date().toISOString().split('T')[0];
    const registrosHoy = registrosCompletos.filter(r => r.fecha === hoy);
    const entrada = registrosHoy.find(r => r.tipo === 'ENTRADA');
    const salida = registrosHoy.find(r => r.tipo === 'SALIDA');

    const tieneEntrada = !!entrada;
    const tieneSalida = !!salida;
    const almuerzo = entrada?.almuerzo;

    const resumenEntradaHora = document.getElementById('resumenEntradaHora');
    const resumenSalidaHora = document.getElementById('resumenSalidaHora');
    const resumenAlmuerzo = document.getElementById('resumenAlmuerzo');

    if (resumenEntradaHora) resumenEntradaHora.textContent = entrada ? formatearHora(entrada.timestamp || entrada.hora) : '--:--';
    if (resumenSalidaHora) resumenSalidaHora.textContent = salida ? formatearHora(salida.timestamp || salida.hora) : '--:--';
    if (resumenAlmuerzo) resumenAlmuerzo.innerHTML = almuerzo === 'SI' ? 'Dentro de planta' : almuerzo === 'NO' ? 'Fuera de planta' : 'No registrado';

    const entradaCard = document.getElementById('resumenEntradaCard');
    const salidaCard = document.getElementById('resumenSalidaCard');
    const estadoGeneral = document.getElementById('resumenEstadoGeneral');
    const btnSalida = document.getElementById('btnSalidaResumen');

    if (entradaCard) {
        if (tieneEntrada) {
            entradaCard.className = 'time-card entry';
            const entradaStatus = document.getElementById('resumenEntradaStatus');
            if (entradaStatus) entradaStatus.innerHTML = '<i class="fas fa-check-circle"></i> Completada';
        } else {
            entradaCard.className = 'time-card pending';
            const entradaStatus = document.getElementById('resumenEntradaStatus');
            if (entradaStatus) entradaStatus.innerHTML = '<i class="fas fa-hourglass-half"></i> Pendiente';
        }
    }

    if (salidaCard) {
        if (tieneSalida) {
            salidaCard.className = 'time-card exit';
            const salidaStatus = document.getElementById('resumenSalidaStatus');
            if (salidaStatus) salidaStatus.innerHTML = '<i class="fas fa-check-circle"></i> Completada';
            if (btnSalida) btnSalida.style.display = 'none';
            if (estadoGeneral) {
                estadoGeneral.className = 'status-badge completed';
                estadoGeneral.innerHTML = '<i class="fas fa-check-circle"></i><span>Jornada completada</span>';
            }
        } else if (tieneEntrada && !tieneSalida) {
            salidaCard.className = 'time-card pending';
            const salidaStatus = document.getElementById('resumenSalidaStatus');
            if (salidaStatus) salidaStatus.innerHTML = '<i class="fas fa-hourglass-half"></i> Pendiente';
            if (btnSalida) btnSalida.style.display = 'flex';
            if (estadoGeneral) {
                estadoGeneral.className = 'status-badge in-progress';
                estadoGeneral.innerHTML = '<i class="fas fa-play-circle"></i><span>Jornada en curso</span>';
            }
        } else {
            salidaCard.className = 'time-card pending';
            if (btnSalida) btnSalida.style.display = 'none';
            if (estadoGeneral) {
                estadoGeneral.className = 'status-badge pending';
                estadoGeneral.innerHTML = '<i class="fas fa-clock"></i><span>Jornada pendiente</span>';
            }
        }
    }
}

// ========== REGISTRO ==========
function cambiarTab(tab) {
    const tabCredencial = document.getElementById('tabCredencial');
    const tabResumen = document.getElementById('tabResumen');
    const tabContentCredencial = document.getElementById('tabContentCredencial');
    const tabContentResumen = document.getElementById('tabContentResumen');

    if (tabCredencial && tabResumen) {
        tabCredencial.classList.toggle('active', tab === 'credencial');
        tabResumen.classList.toggle('active', tab === 'resumen');
    }
    if (tabContentCredencial && tabContentResumen) {
        tabContentCredencial.classList.toggle('active', tab === 'credencial');
        tabContentResumen.classList.toggle('active', tab === 'resumen');
    }
    if (tab === 'resumen') actualizarMiniDashboard();
}

function volverACredencial() {
    const lunchContainer = document.getElementById('lunchContainer');
    const confirmContainer = document.getElementById('confirmContainer');
    const credentialScreen = document.getElementById('credentialScreen');

    if (lunchContainer) lunchContainer.classList.add('hidden');
    if (confirmContainer) confirmContainer.classList.add('hidden');
    if (credentialScreen) credentialScreen.classList.remove('hidden');
}

function iniciarRegistro(tipo) {
    if (!verificarDistanciaEmpresa()) return;

    empleado.tipoRegistro = tipo;

    if (tipo === 'ENTRADA') {
        const credentialScreen = document.getElementById('credentialScreen');
        const lunchContainer = document.getElementById('lunchContainer');
        if (credentialScreen) credentialScreen.classList.add('hidden');
        if (lunchContainer) lunchContainer.classList.remove('hidden');
        empleado.almuerzo = '';
        const btnConfirmar = document.getElementById('btnConfirmar');
        if (btnConfirmar) btnConfirmar.disabled = true;
    } else {
        const previewNombre = document.getElementById('previewNombre');
        const previewId = document.getElementById('previewId');
        const previewTipo = document.getElementById('previewTipo');
        const previewAlmuerzoRow = document.getElementById('previewAlmuerzoRow');
        const previewDistanciaRow = document.getElementById('previewDistanciaRow');
        const previewDistancia = document.getElementById('previewDistancia');

        if (previewNombre) previewNombre.textContent = empleado.nombre;
        if (previewId) previewId.textContent = empleado.id;
        if (previewTipo) previewTipo.textContent = 'SALIDA';
        if (previewAlmuerzoRow) previewAlmuerzoRow.style.display = 'none';

        if (posicion.lat && previewDistancia && previewDistanciaRow) {
            const dist = calcularDistancia(posicion.lat, posicion.lng, CONFIG.EMPRESA.LAT, CONFIG.EMPRESA.LNG);
            previewDistancia.textContent = `${Math.round(dist)}m / ${CONFIG.EMPRESA.RADIO_METROS}m`;
            previewDistanciaRow.style.display = 'flex';
        }

        const credentialScreen = document.getElementById('credentialScreen');
        const confirmContainer = document.getElementById('confirmContainer');
        if (credentialScreen) credentialScreen.classList.add('hidden');
        if (confirmContainer) confirmContainer.classList.remove('hidden');
    }
}

function seleccionarAlmuerzo(op) {
    empleado.almuerzo = op;
    const lunchSi = document.getElementById('lunchSi');
    const lunchNo = document.getElementById('lunchNo');
    if (op === 'SI') {
        if (lunchSi) {
            lunchSi.style.background = '#fee2e2';
            lunchSi.style.borderColor = '#dc2626';
        }
        if (lunchNo) {
            lunchNo.style.background = '#f8fafc';
            lunchNo.style.borderColor = '#e2e8f0';
        }
    } else {
        if (lunchNo) {
            lunchNo.style.background = '#fee2e2';
            lunchNo.style.borderColor = '#dc2626';
        }
        if (lunchSi) {
            lunchSi.style.background = '#f8fafc';
            lunchSi.style.borderColor = '#e2e8f0';
        }
    }
    const btnConfirmar = document.getElementById('btnConfirmar');
    if (btnConfirmar) btnConfirmar.disabled = false;
}

function irAConfirmacion() {
    if (!empleado.almuerzo) {
        mostrarToast('Selecciona una opción', 'error');
        return;
    }

    const previewNombre = document.getElementById('previewNombre');
    const previewId = document.getElementById('previewId');
    const previewTipo = document.getElementById('previewTipo');
    const previewAlmuerzo = document.getElementById('previewAlmuerzo');
    const previewAlmuerzoRow = document.getElementById('previewAlmuerzoRow');
    const previewDistanciaRow = document.getElementById('previewDistanciaRow');
    const previewDistancia = document.getElementById('previewDistancia');

    if (previewNombre) previewNombre.textContent = empleado.nombre;
    if (previewId) previewId.textContent = empleado.id;
    if (previewTipo) previewTipo.textContent = 'ENTRADA';
    if (previewAlmuerzo) previewAlmuerzo.textContent = empleado.almuerzo === 'SI' ? 'Planta' : 'Fuera';
    if (previewAlmuerzoRow) previewAlmuerzoRow.style.display = 'flex';

    if (posicion.lat && previewDistancia && previewDistanciaRow) {
        const dist = calcularDistancia(posicion.lat, posicion.lng, CONFIG.EMPRESA.LAT, CONFIG.EMPRESA.LNG);
        previewDistancia.textContent = `${Math.round(dist)}m / ${CONFIG.EMPRESA.RADIO_METROS}m`;
        previewDistanciaRow.style.display = 'flex';
    }

    const lunchContainer = document.getElementById('lunchContainer');
    const confirmContainer = document.getElementById('confirmContainer');
    if (lunchContainer) lunchContainer.classList.add('hidden');
    if (confirmContainer) confirmContainer.classList.remove('hidden');
}

function registrarSalidaDesdeResumen() {
    if (!verificarDistanciaEmpresa()) return;
    empleado.tipoRegistro = 'SALIDA';
    empleado.almuerzo = estado.almuerzo || '';

    const previewNombre = document.getElementById('previewNombre');
    const previewId = document.getElementById('previewId');
    const previewTipo = document.getElementById('previewTipo');
    const previewAlmuerzoRow = document.getElementById('previewAlmuerzoRow');
    const previewDistanciaRow = document.getElementById('previewDistanciaRow');
    const previewDistancia = document.getElementById('previewDistancia');

    if (previewNombre) previewNombre.textContent = empleado.nombre;
    if (previewId) previewId.textContent = empleado.id;
    if (previewTipo) previewTipo.textContent = 'SALIDA';
    if (previewAlmuerzoRow) previewAlmuerzoRow.style.display = 'none';

    if (posicion.lat && previewDistancia && previewDistanciaRow) {
        const dist = calcularDistancia(posicion.lat, posicion.lng, CONFIG.EMPRESA.LAT, CONFIG.EMPRESA.LNG);
        previewDistancia.textContent = `${Math.round(dist)}m / ${CONFIG.EMPRESA.RADIO_METROS}m`;
        previewDistanciaRow.style.display = 'flex';
    }

    cambiarTab('credencial');
    const credentialScreen = document.getElementById('credentialScreen');
    const confirmContainer = document.getElementById('confirmContainer');
    if (credentialScreen) credentialScreen.classList.add('hidden');
    if (confirmContainer) confirmContainer.classList.remove('hidden');
}

async function registrar() {
    if (!verificarDistanciaEmpresa()) return;

    showLoading(true);
    const datos = {
        id: empleado.id,
        nombre: empleado.nombre,
        tipo: empleado.tipoRegistro,
        almuerzo: empleado.almuerzo || '',
        lat: posicion.lat,
        lng: posicion.lng,
        dispositivo: deviceToken
    };

    try {
        const res = await api.guardarRegistro(datos);
        showLoading(false);

        if (res.error) {
            mostrarToast(res.error, 'error');
            return;
        }

        mostrarToast('Registro exitoso', 'success');

        if (empleado.tipoRegistro === 'ENTRADA') {
            estado.tieneEntrada = true;
            estado.horaEntrada = formatearHora(new Date());
            estado.almuerzo = empleado.almuerzo;
        } else {
            estado.tieneSalida = true;
            estado.horaSalida = formatearHora(new Date());
        }

        actualizarCredencial();
        await obtenerRegistrosEmpleado();

        const confirmContainer = document.getElementById('confirmContainer');
        const credentialScreen = document.getElementById('credentialScreen');
        if (confirmContainer) confirmContainer.classList.add('hidden');
        if (credentialScreen) credentialScreen.classList.remove('hidden');
    } catch (error) {
        showLoading(false);
        mostrarToast('Error al registrar', 'error');
    }
}

// ========== EVENTOS ==========
document.addEventListener('DOMContentLoaded', () => {
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verificarPIN();
        });
    }

    const registroEmployeeId = document.getElementById('registroEmployeeId');
    if (registroEmployeeId) {
        registroEmployeeId.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verificarEmpleadoExistente();
        });
    }

    setTimeout(verificarEstadoInicial, 100);
    setInterval(() => {
        if (empleado.id) obtenerRegistrosEmpleado();
    }, 30000);
});