// ========== CONFIGURACIÓN GLOBAL ==========
        const CONFIG = window.TCONTROL_CONFIG || {
            API_URL: 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec',
            ADMIN_ID: "1058",
            LAT_EMPRESA: -0.1288771313385675,
            LNG_EMPRESA: -78.47896772889067,
            RADIO_METROS: 250,
            HORA_LIMITE_ALMUERZO: "09:30",
            HORA_INICIO_ESPERADA: "07:30",
            HORA_ENTRADA_LIMITE: "07:45",
            HORA_SALIDA: "16:15",
            ALMUERZO_ACTIVO: true,
            WHATSAPP_NUMBER: "593996356114",
            WHATSAPP_MESSAGE: "Hola, necesito soporte técnico para el sistema CONTROL 2026"
        };

        const API_URL = CONFIG.API_URL;
        const ADMIN_ID = CONFIG.ADMIN_ID;
        let LAT_EMPRESA = CONFIG.LAT_EMPRESA;
        let LNG_EMPRESA = CONFIG.LNG_EMPRESA;
        let RADIO_METROS = CONFIG.RADIO_METROS;
        let HORA_LIMITE_ALMUERZO = CONFIG.HORA_LIMITE_ALMUERZO;
        let HORA_INICIO_ESPERADA = CONFIG.HORA_INICIO_ESPERADA;
        let HORA_ENTRADA_LIMITE = CONFIG.HORA_ENTRADA_LIMITE;
        let HORA_SALIDA = CONFIG.HORA_SALIDA;
        let ALMUERZO_ACTIVO = CONFIG.ALMUERZO_ACTIVO;
        let WHATSAPP_NUMBER = CONFIG.WHATSAPP_NUMBER;
        let WHATSAPP_MESSAGE = CONFIG.WHATSAPP_MESSAGE;


        // ========== VARIABLES GLOBALES ==========
        let deviceToken = null;
        let posicion = { lat: null, lng: null };
        let currentMode = 'OFICINA'; // 'OFICINA' o 'CAMPO'
        let gpsActivo = false;
        let registrosCompletos = [];
        let intervaloGPS = null;
        let currentPage = 'home';
        let isAuthenticated = false;
        let configuracionesSistema = null;

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
            almuerzo: '',
            sopa: '',
            almidon: '',
            proteina1: '',
            proteina2: '',
            ensalada: '',
            otro: '',
            jugo: '',
            razon_entrada_tardia: '',
            quien_justifica_entrada: '',
            tipo_salida: '',
            razon_permiso: ''
        };

        // Variables para selección del menú
        let lugarSeleccionado = null;

        let razonEntradaTardia = null;
        let detalleRazonEntrada = null;

        let razonSalidaTemprana = null;
        let detalleRazonSalida = null;

        let esPermisoIntermedio = false;
        let razonPermiso = null;

        // ========== FUNCIONES GLOBALES PARA EL MENÚ ==========
        window.seleccionarLugar = function (lugar) {
            lugarSeleccionado = lugar;
            const lunchSi = document.getElementById('lunchSi');
            const lunchNo = document.getElementById('lunchNo');
            const btnConfirmar = document.getElementById('btnConfirmarAlmuerzo');

            if (lugar === 'SI') {
                if (lunchSi) lunchSi.classList.add('selected');
                if (lunchNo) lunchNo.classList.remove('selected');
            } else {
                if (lunchNo) lunchNo.classList.add('selected');
                if (lunchSi) lunchSi.classList.remove('selected');
            }

            if (btnConfirmar) btnConfirmar.disabled = false;
        };


        window.confirmarMenuYOpcion = function () {
            const opcion = lugarSeleccionado;
            if (!opcion) {
                mostrarToast('👈 Selecciona dónde almuerzas primero', 'error');
                return;
            }

            empleado.almuerzo = opcion;

            if (opcion === 'SI') {
                mostrarToast('✅ Entrada registrada - Almuerzas en planta', 'success');
            } else {
                mostrarToast('✅ Entrada registrada - Almuerzas fuera de planta', 'success');
            }

            setTimeout(() => {
                registrar();
            }, 800);
        };

        // ========== CARGAR CONFIGURACIONES ==========
        async function cargarConfiguracionesSistema() {
            try {
                const res = await jsonpRequest({ accion: 'obtenerConfiguraciones' });
                if (res && !res.error) {
                    configuracionesSistema = res;
                    if (res.ubicacion) {
                        LAT_EMPRESA = res.ubicacion.lat || LAT_EMPRESA;
                        LNG_EMPRESA = res.ubicacion.lng || LNG_EMPRESA;
                        RADIO_METROS = res.ubicacion.radio || RADIO_METROS;
                    }
                    if (res.horarios) {
                        HORA_LIMITE_ALMUERZO = res.horarios.hora_almuerzo || CONFIG.HORA_LIMITE_ALMUERZO;
                        HORA_INICIO_ESPERADA = res.horarios.hora_inicio || CONFIG.HORA_INICIO_ESPERADA;
                        HORA_ENTRADA_LIMITE = res.horarios.hora_entrada_limite || CONFIG.HORA_ENTRADA_LIMITE;
                        HORA_SALIDA = res.horarios.hora_salida || CONFIG.HORA_SALIDA;
                        ALMUERZO_ACTIVO = res.horarios.almuerzo_activo !== false;
                    }
                    if (res.otras) {
                        WHATSAPP_NUMBER = res.otras.whatsapp_number || WHATSAPP_NUMBER;
                        WHATSAPP_MESSAGE = res.otras.mensaje_soporte || WHATSAPP_MESSAGE;
                    }
                    // Guardar en localStorage para uso offline
                    localStorage.setItem('HORA_SALIDA', HORA_SALIDA);
                    localStorage.setItem('HORA_ENTRADA_LIMITE', HORA_ENTRADA_LIMITE);
                    return true;
                }
            } catch (error) {
                console.error("Error cargando configuraciones:", error);
            }
            return false;
        }

        // ========== FUNCIÓN PARA AJUSTAR LAYOUT ==========
        function ajustarLayout() {
            const appContainer = document.querySelector('.app-container');
            if (appContainer) {
                appContainer.style.display = 'flex';
                void appContainer.offsetHeight;
            }

            const isAndroid = /Android/i.test(navigator.userAgent);
            if (isAndroid) {
                const bottomNav = document.querySelector('.bottom-nav');
                if (bottomNav) {
                    const originalHeight = window.innerHeight;
                    setTimeout(() => {
                        const newHeight = window.innerHeight;
                        const bottomBarHeight = Math.max(0, originalHeight - newHeight);
                        if (bottomBarHeight > 10) {
                            bottomNav.style.paddingBottom = (bottomBarHeight + 8) + 'px';
                            const fab = document.querySelector('.fab-whatsapp');
                            if (fab) fab.style.bottom = (bottomBarHeight + 80) + 'px';
                        }
                    }, 100);
                }
            }
        }

        window.addEventListener('resize', () => setTimeout(ajustarLayout, 50));
        window.addEventListener('orientationchange', () => setTimeout(ajustarLayout, 100));

        // ========== SPLASH SCREEN ==========
        function hideSplash() {
            const splash = document.getElementById('initialSplash');
            if (splash) {
                splash.classList.add('fade-out');
                setTimeout(() => splash.remove(), 500);
            }
            ajustarLayout();
        }

        // ========== FUNCIONES DE UI ==========
        function showLoading(show) {
            const loading = document.getElementById('loadingOverlay');
            if (loading) {
                if (show) loading.classList.remove('hidden');
                else loading.classList.add('hidden');
            }
        }

        function mostrarToast(msg, tipo = 'info') {
            // Vibración háptica en dispositivos compatibles
            if (navigator.vibrate) {
                if (tipo === 'success') navigator.vibrate(50);
                else if (tipo === 'error') navigator.vibrate([80, 40, 80]);
                else navigator.vibrate(30);
            }

            // Eliminar toast anterior si existe
            document.querySelectorAll('.custom-toast').forEach(t => t.remove());

            const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
            const classes = { success: 'success-toast', error: 'error-toast', info: 'info-toast' };

            const toast = document.createElement('div');
            toast.className = `custom-toast ${classes[tipo] || ''}`;
            toast.innerHTML = `<span class="toast-icon">${icons[tipo] || 'ℹ️'}</span><span>${msg}</span>`;
            document.body.appendChild(toast);

            // Auto-dismiss con animación de salida
            const duration = tipo === 'error' ? 3500 : 2800;
            setTimeout(() => {
                toast.style.animation = 'toastOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        function formatearHora(fecha) {
            if (!fecha) return '--:--';
            try {
                const d = new Date(fecha);
                if (isNaN(d.getTime())) return '--:--';
                let hours = d.getHours();
                const minutes = String(d.getMinutes()).padStart(2, '0');
                const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
                hours = hours % 12;
                hours = hours ? hours : 12;
                return `${hours}:${minutes} ${ampm}`;
            } catch (e) {
                return '--:--';
            }
        }

        function formatearFechaCorta() {
            const d = new Date();
            return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        }

        function formatearFechaParaGrupo(fecha) {
            if (!fecha) return 'Fecha desconocida';

            let fechaObj;
            if (typeof fecha === 'string') {
                if (fecha.includes('-')) {
                    const partes = fecha.split('-');
                    fechaObj = new Date(partes[0], partes[1] - 1, partes[2]);
                } else {
                    fechaObj = new Date(fecha);
                }
            } else if (fecha instanceof Date) {
                fechaObj = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
            } else {
                fechaObj = new Date(fecha);
            }

            if (isNaN(fechaObj.getTime())) return 'Fecha inválida';

            const hoy = new Date();
            const hoyNormalizado = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
            const ayerNormalizado = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
            const fechaNormalizada = new Date(fechaObj.getFullYear(), fechaObj.getMonth(), fechaObj.getDate());

            if (fechaNormalizada.getTime() === hoyNormalizado.getTime()) {
                return 'Hoy';
            } else if (fechaNormalizada.getTime() === ayerNormalizado.getTime()) {
                return 'Ayer';
            } else {
                return fechaObj.toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
            }
        }

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

        function abrirWhatsAppSoporte() {
            const mensajeCodificado = encodeURIComponent(WHATSAPP_MESSAGE);
            const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${mensajeCodificado}`;
            window.open(url, '_blank');
        }

        function abrirPanelAdmin() {
            window.open('admin_config.html', '_blank');
        }

        // ========== FUNCIONES DE DISTANCIA ==========
        function calcularDistancia(lat1, lon1, lat2, lon2) {
            const R = 6371e3;
            const φ1 = lat1 * Math.PI / 180;
            const φ2 = lat2 * Math.PI / 180;
            const Δφ = (lat2 - lat1) * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        function verificarDistanciaEmpresa() {
            if (!posicion.lat || !posicion.lng) {
                mostrarToast('Obteniendo ubicación...', 'info');
                return false;
            }

            const lat = parseFloat(posicion.lat);
            const lng = parseFloat(posicion.lng);

            if (isNaN(lat) || isNaN(lng)) {
                mostrarToast('Coordenadas inválidas', 'error');
                return false;
            }

            let targetLat = LAT_EMPRESA;
            let targetLng = LNG_EMPRESA;
            let radio = RADIO_METROS;
            let msgError = 'Fuera del área de la empresa';

            if (currentMode === 'CAMPO') {
                if (!empleado.baseLat || !empleado.baseLng) {
                    mostrarToast('❌ Debes registrar la ubicación del proyecto primero', 'error');
                    return false;
                }
                targetLat = parseFloat(empleado.baseLat);
                targetLng = parseFloat(empleado.baseLng);
                radio = 300; // Radio sugerido para campo
                msgError = 'Fuera del área del proyecto';
            }

            const distancia = calcularDistancia(lat, lng, targetLat, targetLng);
            const indicator = document.getElementById('distanceIndicator');
            if (indicator) {
                indicator.textContent = `📍 ${Math.round(distancia)}m / ${radio}m`;
                indicator.classList.remove('hidden');

                if (distancia <= radio) {
                    setTimeout(() => indicator.classList.add('hidden'), 3000);
                    return true;
                } else {
                    mostrarToast(`❌ ${msgError} (${Math.round(distancia)}m)`, 'error');
                    return false;
                }
            }
            return false;
        }

        function solicitarPermisoGPS() {
            if (!navigator.geolocation) {
                mostrarToast('Geolocalización no soportada', 'error');
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    let lat = position.coords.latitude;
                    let lng = position.coords.longitude;
                    lat = Math.round(lat * 1000000) / 1000000;
                    lng = Math.round(lng * 1000000) / 1000000;
                    posicion = { lat: lat, lng: lng };
                    gpsActivo = true;
                    console.log("Ubicación obtenida del GPS:", posicion);
                    verificarDistanciaEmpresa();
                },
                (error) => {
                    console.error('GPS error:', error);
                    if (error.code === 1) {
                        mostrarToast('Permiso de ubicación denegado. Activa el GPS para registrar asistencia', 'error');
                    } else {
                        mostrarToast('Error al obtener ubicación', 'error');
                    }
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }

        function iniciarGPS() {
            solicitarPermisoGPS();
            if (intervaloGPS) {
                clearInterval(intervaloGPS);
                intervaloGPS = null;
            }
            intervaloGPS = setInterval(solicitarPermisoGPS, 60000);
        }

        // ========== FUNCIÓN JSONP CON RETRY AUTOMÁTICO ==========
        // Reintenta automáticamente si el servidor está bloqueado (error de LockService)
        // Esto es crítico en horas pico (ej: 8am cuando todos marcan entrada a la vez)
        function jsonpRequest(params, _retryCount = 0) {
            // 🔥 INTERCEPTOR FIREBASE
            if (window.USE_FIREBASE && window.FirebaseBackend) {
                return window.FirebaseBackend.procesarAccion(params);
            }

            return new Promise((resolve, reject) => {
                const MAX_RETRIES = 3;
                const RETRY_DELAY_MS = [1000, 2000, 4000]; // backoff exponencial

                const callback = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
                window[callback] = function (data) {
                    delete window[callback];
                    if (script.parentNode) script.parentNode.removeChild(script);

                    // Detectar errores de lock del servidor y reintentar
                    const isLockError = data && data.error && (
                        data.error.toString().toLowerCase().includes('lock') ||
                        data.error.toString().toLowerCase().includes('candado') ||
                        data.error.toString().toLowerCase().includes('tiempo de espera')
                    );

                    if (isLockError && _retryCount < MAX_RETRIES) {
                        const delay = RETRY_DELAY_MS[_retryCount] || 4000;
                        console.warn(`⏳ Servidor ocupado. Reintentando en ${delay}ms (intento ${_retryCount + 1}/${MAX_RETRIES})...`);
                        setTimeout(() => {
                            jsonpRequest(params, _retryCount + 1).then(resolve).catch(reject);
                        }, delay);
                        return;
                    }

                    resolve(data);
                };

                const url = new URL(API_URL);
                url.searchParams.append('callback', callback);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');

                // Inyectar credenciales de sesión para seguridad si existen
                const idParaSeguridad = (params.empleadoId || params.id || (window.empleado && window.empleado.id));
                if (idParaSeguridad) url.searchParams.append('empleadoId', idParaSeguridad);
                if (window.deviceToken) url.searchParams.append('deviceToken', window.deviceToken);

                Object.keys(params).forEach(key => {
                    if (params[key] !== undefined && params[key] !== null) {
                        // Evitar duplicar si ya los inyectamos arriba
                        if (key === 'empleadoId' || key === 'deviceToken') return;
                        url.searchParams.append(key, typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key].toString());
                    }
                });

                const script = document.createElement('script');
                script.src = url.toString();
                script.onerror = () => {
                    delete window[callback];
                    if (script.parentNode) script.parentNode.removeChild(script);

                    if (_retryCount < MAX_RETRIES) {
                        const delay = RETRY_DELAY_MS[_retryCount] || 4000;
                        console.warn(`🔌 Error de red. Reintentando en ${delay}ms...`);
                        setTimeout(() => {
                            jsonpRequest(params, _retryCount + 1).then(resolve).catch(reject);
                        }, delay);
                    } else {
                        reject(new Error('Error de conexión con el servidor'));
                    }
                };

                // Timeout de 25s por intento para evitar requests colgados
                const timeoutId = setTimeout(() => {
                    if (window[callback]) {
                        delete window[callback];
                        if (script.parentNode) script.parentNode.removeChild(script);
                        if (_retryCount < MAX_RETRIES) {
                            const delay = RETRY_DELAY_MS[_retryCount] || 4000;
                            console.warn(`⏰ Timeout. Reintentando en ${delay}ms...`);
                            setTimeout(() => {
                                jsonpRequest(params, _retryCount + 1).then(resolve).catch(reject);
                            }, delay);
                        } else {
                            reject(new Error('Tiempo de espera agotado. Verifica tu conexión.'));
                        }
                    }
                }, 25000);

                window[callback]._timeoutId = timeoutId;
                const _originalCallback = window[callback];
                window[callback] = function (data) {
                    clearTimeout(timeoutId);
                    _originalCallback(data);
                };

                document.body.appendChild(script);
            });
        }


        // ========== FUNCIONES DE AUTENTICACIÓN ==========
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

        // ========== FUNCIONES DE API ==========
        async function verificarDispositivoTienePIN(deviceToken) {
            return jsonpRequest({ accion: 'verificarDispositivo', deviceToken });
        }

        async function registrarDispositivoConPIN(empleadoId, pin, deviceToken) {
            return jsonpRequest({ accion: 'registrarDispositivo', empleadoId, pin, deviceToken });
        }

        async function verificarPINAPI(pin, deviceToken) {
            return jsonpRequest({ accion: 'verificarPIN', pin, deviceToken });
        }

        async function obtenerEstado(id, deviceToken) {
            return jsonpRequest({ accion: 'obtenerEstado', id, deviceToken });
        }

        async function guardarRegistroAPI(data) {
            return jsonpRequest({ accion: 'guardarRegistro', ...data });
        }

        async function obtenerRegistrosEmpleadoAPI(empleadoId, force = false) {
            return jsonpRequest({ accion: 'obtenerRegistros', empleadoId: empleadoId, force: force });
        }

        async function desvincularDispositivoAPI(empleadoId, deviceToken) {
            return jsonpRequest({ accion: 'desvincularDispositivo', empleadoId, deviceToken });
        }

        // ========== FUNCIONES DE REGISTRO ==========
        async function obtenerRegistrosEmpleado(force = false) {
            if (!empleado.id) return;
            try {
                const registros = await obtenerRegistrosEmpleadoAPI(empleado.id, force);

                // Prevenir crash si el backend devuelve un error (ej: falta de índice en Firebase)
                if (registros && registros.error) {
                    console.error('Error del backend al obtener registros:', registros.error);
                    if (registros.error.includes('index')) {
                        console.warn("Falta crear un índice Compuesto en Firestore. Revisa el link de error arriba y dale clic para crearlo.");
                    }
                    registrosCompletos = [];
                } else {
                    registrosCompletos = Array.isArray(registros) ? registros : [];
                }

                if (currentPage === 'history') actualizarHistorialAgrupado();
                if (currentPage === 'profile') renderProfilePage();
            } catch (error) {
                console.error('Error:', error);
                registrosCompletos = [];
            }
        }

        async function registrar() {
            if (!verificarDistanciaEmpresa()) return;

            // Si es SALIDA, verificar si es antes de la hora configurada
            if (empleado.tipoRegistro === 'SALIDA') {
                const horaSalidaConfigrada = obtenerHoraSalidaConfigrada();
                if (horaSalidaConfigrada && esAntesDeSalida(horaSalidaConfigrada)) {
                    // Mostrar modal para seleccionar razón de salida temprana
                    mostrarModalRazonSalida();
                    return;
                }
            }

            // Proceder con el registro normal
            procederConRegistro();
        }

        window.cambiarModo = function (modo) {
            if (modo === 'CAMPO') {
                if (!posicion.lat || !posicion.lng) {
                    mostrarToast('Ubicación no detectada. Esperando GPS...', 'warning');
                    solicitarPermisoGPS();
                    return;
                }
                const dist = calcularDistancia(posicion.lat, posicion.lng, LAT_EMPRESA, LNG_EMPRESA);
                if (dist <= 250000) {
                    mostrarToast(`No puedes activar CAMPO a menos de 250km de la base (Distancia actual: ${(dist/1000).toFixed(1)} km)`, 'error');
                    return;
                }
            }
            currentMode = modo;
            renderHomePage();
            ajustarLayout();
        };

        window.fijarBaseCampo = async function () {
            if (!posicion.lat || !posicion.lng) {
                mostrarToast('Obteniendo ubicación actual...', 'info');
                solicitarPermisoGPS();
                return;
            }

            showLoading(true);
            try {
                const res = await jsonpRequest({
                    accion: 'actualizarBaseCampo',
                    empleadoId: empleado.id,
                    lat: posicion.lat,
                    lng: posicion.lng
                });
                showLoading(false);
                if (res.ok) {
                    empleado.baseLat = posicion.lat;
                    empleado.baseLng = posicion.lng;
                    mostrarToast('✅ Ubicación de proyecto registrada', 'success');
                    renderHomePage();
                } else {
                    mostrarToast('Error: ' + res.error, 'error');
                }
            } catch (e) {
                showLoading(false);
                mostrarToast('Error de conexión', 'error');
            }
        };

        function obtenerHoraSalidaConfigrada() {
            // Usar variable global HORA_SALIDA si existe, sino del localStorage, sino default
            return HORA_SALIDA || localStorage.getItem('HORA_SALIDA') || CONFIG.HORA_SALIDA;
        }

        function esAntesDeSalida(horaSalida) {
            const ahora = new Date();
            const [horaSalidaHora, horaSalidaMin] = horaSalida.split(':').map(Number);
            const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes();
            const salidaMinutos = horaSalidaHora * 60 + horaSalidaMin;
            return ahoraMinutos < salidaMinutos;
        }

        function mostrarModalRazonSalida() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #dc2626; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Registra tu salida</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">Selecciona el motivo de tu salida anticipada</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="procesarRazonSalida('cumpleanos', 'Cumpleaños')">
                            <div class="razon-icon">🎂</div>
                            <div class="razon-label">Cumpleaños</div>
                        </div>
                        
                        <div class="razon-item" onclick="procesarRazonSalida('permiso_medico', 'Permiso médico')">
                            <div class="razon-icon">🏥</div>
                            <div class="razon-label">Permiso médico</div>
                        </div>
                        
                        <div class="razon-item" onclick="procesarRazonSalida('permiso_personal', 'Permiso personal')">
                            <div class="razon-icon">📋</div>
                            <div class="razon-label">Permiso personal</div>
                        </div>
                        
                        <div class="razon-item" onclick="procesarRazonSalida('salida_campo', 'Salida a Campo')">
                            <div class="razon-icon">🚗</div>
                            <div class="razon-label">Salida a Campo</div>
                        </div>
                        
                        <div class="razon-item" onclick="mostrarJustificacionSalida('salida_justificada', 'Salida Justificada')">
                            <div class="razon-icon">✅</div>
                            <div class="razon-label">Salida Justificada</div>
                        </div>
                        
                        ${(empleado.cargo || '').toLowerCase() === 'pasante' ? `
                        <div class="razon-item" onclick="procesarRazonSalida('salida_pasante', 'Salida Pasante')" style="border: 2px solid #7c3aed; background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); box-shadow: 0 4px 16px rgba(124,58,237,0.10);">
                            <div class="razon-icon">🎓</div>
                            <div class="razon-label" style="color:#6d28d9; font-weight:700;">Salida Pasante</div>
                        </div>
                        ` : ''}
                    
                    <div class="d-grid gap-2" style="margin-top: 16px;">
                        <button class="btn btn-outline-secondary" onclick="renderHomePage()">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        function mostrarJustificacionSalida(razon, label) {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-clipboard-check" style="font-size: 40px; color: #0284c7; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(18px, 5vw, 22px); color: #0f172a; margin: 0; font-weight: 700;">Salida Justificada</h3>
                        <p style="color: #64748b; font-size: clamp(13px, 3.5vw, 15px); margin-top: 10px; line-height: 1.4;">¿Quién autoriza esta salida?</p>
                    </div>
                    
                    <div style="background: #eff6ff; border-left: 4px solid #0284c7; padding: 14px 16px; border-radius: 10px; margin-bottom: 18px;">
                        <input type="text" id="quienJustifica" placeholder="Nombre de la persona o jefe" 
                               style="width: 100%; padding: 14px 16px; border: 2px solid #bfdbfe; border-radius: 10px; font-size: clamp(16px, 4.5vw, 18px); color: #1e293b; background: white;"
                               onkeypress="if(event.key==='Enter') procesarRazonSalidaJustificada()">
                    </div>
                    
                    <div class="d-grid gap-2">
                        <button class="btn btn-primary btn-lg" onclick="procesarRazonSalidaJustificada()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-check-circle"></i> Confirmar
                        </button>
                        <button class="btn btn-outline-secondary" onclick="mostrarModalRazonSalida()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-arrow-left"></i> Atrás
                        </button>
                    </div>
                </div>
            </div>
        `;
            document.getElementById('quienJustifica').focus();
            ajustarLayout();
        }

        window.procesarRazonSalidaJustificada = function () {
            const nombre = document.getElementById('quienJustifica')?.value.trim();
            if (!nombre) {
                mostrarToast('Ingresa el nombre de quién autoriza', 'error');
                return;
            }

            razonSalidaTemprana = 'salida_justificada';
            detalleRazonSalida = {
                razon: 'salida_justificada',
                quien_justifica: nombre
            };

            empleado.razon_salida_temprana = razonSalidaTemprana;
            empleado.quien_justifica_salida = detalleRazonSalida.quien_justifica;

            mostrarModalTipoSalidaTemprana();
        };

        window.procesarRazonSalida = function (razon, label) {
            razonSalidaTemprana = razon;
            detalleRazonSalida = {
                razon: razon,
                quien_justifica: ''
            };

            empleado.razon_salida_temprana = razon;
            empleado.quien_justifica_salida = '';

            // Asignar tipo_salida según la razón para automatización de estatus
            if (razon === 'salida_campo') {
                empleado.tipo_salida = 'TRABAJO_CAMPO';
            } else if (razon === 'cumpleanos') {
                empleado.tipo_salida = 'CUMPLEAÑOS';
            } else if (razon === 'salida_pasante') {
                empleado.tipo_salida = 'SALIDA_PASANTE';
            } else {
                empleado.tipo_salida = 'SALIDA_TEMPRANA_JUSTIFICADA';
            }

            // Solo preguntar si va a regresar para razones de PERMISO y SALIDA JUSTIFICADA
            // Salida pasante es siempre salida final (no regresa)
            if (razon === 'permiso_medico' || razon === 'permiso_personal' || razon === 'salida_justificada') {
                mostrarModalTipoSalidaTemprana();
            } else {
                procederConRegistro();
            }
        };

        window.cancelarRazonSalida = function () {
            razonSalidaTemprana = null;
            detalleRazonSalida = null;
            renderHomePage();
        };

        async function procederConRegistro() {
            if (!verificarDistanciaEmpresa()) return;

            // Advertencia para marcación sospechosa (Entrada muy reciente y marcando Salida)
            if (empleado.tipoRegistro === 'SALIDA' && Array.isArray(registrosCompletos)) {
                const hoyStr = new Date().toISOString().split('T')[0];
                const entradaHoy = registrosCompletos.find(r => r.fecha === hoyStr && r.tipo === 'ENTRADA');
                if (entradaHoy) {
                    const tsEntrada = entradaHoy.timestamp || entradaHoy.hora;
                    const dEntrada = parseDateSafe(tsEntrada);
                    if (dEntrada) {
                        const diferenciaMinutos = (new Date() - dEntrada) / (1000 * 60);
                        if (diferenciaMinutos < 15) {
                            const confirmarSalidaSospechosa = confirm(
                                "🚨 ADVERTENCIA IMPORTANTE:\n\n" +
                                "Has registrado tu ENTRADA hace menos de 15 minutos.\n" +
                                "Si olvidaste marcar tu Entrada por la mañana, marcar la Salida ahora causará que tu jornada sea calculada en SEGUNDOS.\n\n" +
                                "¿Deseas continuar de todas formas? Debes comunicar este olvido al área respectiva de inmediato para su corrección."
                            );
                            if (!confirmarSalidaSospechosa) {
                                return;
                            }
                        }
                    }
                }
            }

            showLoading(true);

            let latRegistro = posicion.lat;
            let lngRegistro = posicion.lng;

            if (typeof latRegistro === 'string') {
                latRegistro = parseFloat(latRegistro.replace(/\./g, '').replace(',', '.'));
            }
            if (typeof lngRegistro === 'string') {
                lngRegistro = parseFloat(lngRegistro.replace(/\./g, '').replace(',', '.'));
            }

            if (!isNaN(latRegistro) && !isNaN(lngRegistro)) {
                if (Math.abs(latRegistro) > 10 && Math.abs(latRegistro) < 1000) {
                    latRegistro = latRegistro / 1000;
                }
                if (Math.abs(lngRegistro) > 180 && Math.abs(lngRegistro) < 1000) {
                    lngRegistro = lngRegistro / 1000;
                }
                if (Math.abs(latRegistro) > 10 && Math.abs(latRegistro) < 100) {
                    latRegistro = latRegistro / 10;
                }

                latRegistro = Math.round(latRegistro * 1000000) / 1000000;
                lngRegistro = Math.round(lngRegistro * 1000000) / 1000000;
            } else {
                latRegistro = null;
                lngRegistro = null;
            }

            const datos = {
                id: empleado.id,
                nombre: empleado.nombre,
                tipo: empleado.tipoRegistro,
                almuerzo: empleado.almuerzo || '',
                lat: latRegistro,
                lng: lngRegistro,
                dispositivo: deviceToken,
                sopa: empleado.sopa || '',
                almidon: empleado.almidon || '',
                proteina1: empleado.proteina1 || '',
                proteina2: empleado.proteina2 || '',
                ensalada: empleado.ensalada || '',
                otro: empleado.otro || '',
                jugo: empleado.jugo || '',
                razon_salida: detalleRazonSalida?.razon || '',
                quien_justifica: detalleRazonSalida?.quien_justifica || '',
                razon_entrada_tardia: detalleRazonEntrada?.razon || '',
                quien_justifica_entrada: detalleRazonEntrada?.quien_justifica || '',
                tipo_salida: empleado.tipo_salida || '',
                modo: currentMode,
                razon_permiso: empleado.razon_permiso || ''
            };

            try {
                const res = await guardarRegistroAPI(datos);
                showLoading(false);

                if (res.error) {
                    mostrarToast(res.error, 'error');
                    return;
                }

                const ahora = new Date();
                const horaActual = formatearHora(ahora);

                if (empleado.tipoRegistro === 'ENTRADA') {
                    estado.tieneEntrada = true;
                    estado.horaEntrada = horaActual;
                    estado.almuerzo = empleado.almuerzo;
                    mostrarToast(`✅ Entrada registrada a las ${horaActual}`, 'success');
                } else {
                    estado.tieneSalida = true;
                    estado.horaSalida = horaActual;
                    if (detalleRazonSalida?.razon) {
                        mostrarToast(`✅ Salida registrada (${detalleRazonSalida.razon})`, 'success');
                    } else {
                        mostrarToast(`✅ Salida registrada a las ${horaActual}`, 'success');
                    }
                }

                await obtenerRegistrosEmpleado();
                if (currentPage === 'home') renderHomePage();
                if (currentPage === 'history') renderHistoryPage();

                // Limpiar variables de razón de salida, entrada y permisos
                razonSalidaTemprana = null;
                detalleRazonSalida = null;
                razonEntradaTardia = null;
                detalleRazonEntrada = null;
                esPermisoIntermedio = false;
                razonPermiso = null;
            } catch (error) {
                showLoading(false);
                mostrarToast('Error al registrar: ' + error.message, 'error');
            }
        }

        function horaLimiteAlmuerzoPasada() {
            if (!ALMUERZO_ACTIVO) return false;

            const ahora = new Date();
            const [horaLimite, minutoLimite] = HORA_LIMITE_ALMUERZO.split(':').map(Number);
            const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes();
            const limiteMinutos = horaLimite * 60 + minutoLimite;
            return ahoraMinutos > limiteMinutos;
        }

        function iniciarRegistro(tipo) {
            if (!verificarDistanciaEmpresa()) return;

            const status = calcularStatusActual();
            const esReentrada = status.label.includes('PERMISO') || status.label.includes('CAMPO');

            empleado.tipoRegistro = tipo;

            if (tipo === 'ENTRADA') {
                // Si ya tiene entrada hoy pero tiene salida intermedia o permiso, es re-entrada
                if (estado.tieneEntrada && esReentrada) {
                    // Es re-entrada de permiso o campo - registrar directamente como ENTRADA
                    empleado.almuerzo = estado.almuerzo || '';
                    registrar();
                    return;
                }

                // Verificar si la entrada es tardía (después de 8:15)
                if (esEntradaTardia()) {
                    mostrarModalRazonEntrada();
                    return;
                }

                if (horaLimiteAlmuerzoPasada()) {
                    mostrarToast(`⚠️ Fuera del horario (límite ${HORA_LIMITE_ALMUERZO}). Se registra almuerzo fuera de planta.`, 'error');
                    empleado.almuerzo = 'NO';
                    setTimeout(() => registrar(), 2000);
                } else {
                    mostrarLunchSelector();
                }
            } else if (tipo === 'SALIDA') {
                // Primero verificar si es salida temprana
                const horaSalidaConfigrada = obtenerHoraSalidaConfigrada();
                if (horaSalidaConfigrada && esAntesDeSalida(horaSalidaConfigrada)) {
                    // Es salida temprana - mostrar modal de razón
                    mostrarModalRazonSalida();
                    return;
                }

                // Si tiene entrada pero NO tiene salida, preguntar si es permiso intermedio
                if (estado.tieneEntrada && !estado.tieneSalida) {
                    // Es potencial permiso intermedio
                    mostrarModalTipoSalida();
                    return;
                }

                empleado.almuerzo = estado.almuerzo || '';
                registrar();
            } else if (tipo === 'RETORNO_CAMPO') {
                empleado.tipoRegistro = 'RETORNO_CAMPO';
                registrar();
            }
        }

        function esEntradaTardia() {
            const ahora = new Date();
            const [horaLimite, minutoLimite] = HORA_ENTRADA_LIMITE.split(':').map(Number);
            const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes();
            const limiteMinutos = horaLimite * 60 + minutoLimite;
            return ahoraMinutos > limiteMinutos;
        }

        function mostrarModalTipoSalida() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <i class="fas fa-door-open" style="font-size: 48px; color: #dc2626; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Tipo de Salida</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">¿Es un permiso o tu salida final?</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="seleccionarTipoSalida('intermedia')" style="border: 2px solid #10b981; background: #f0fdf4;">
                            <div class="razon-icon">🔄</div>
                            <div class="razon-label">Permiso (Regreso)</div>
                        </div>

                        <div class="razon-item" onclick="seleccionarTipoSalida('campo')" style="border: 2px solid #f59e0b; background: #fffbeb;">
                            <div class="razon-icon">🚗</div>
                            <div class="razon-label">Salida a Campo</div>
                        </div>
                        
                        <div class="razon-item" onclick="seleccionarTipoSalida('final')">
                            <div class="razon-icon">🚪</div>
                            <div class="razon-label">Salida Final</div>
                        </div>
                    </div>

                    <div class="d-grid gap-2" style="margin-top: 20px;">
                        <button class="btn btn-outline-secondary" onclick="renderHomePage()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        function mostrarModalTipoSalidaTemprana() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-question-circle" style="font-size: 48px; color: #0284c7; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">¿Cuál es tu situación?</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">Indica si regresas o es tu salida definitiva</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="seleccionarTipoSalidaTemprana('permiso')" style="border: 3px solid #10b981; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); box-shadow: 0 6px 20px rgba(16, 185, 129, 0.1);">
                            <div class="razon-icon">🔄</div>
                            <div class="razon-label">Voy a regresar</div>
                            <div style="font-size: clamp(11px, 2.8vw, 12px); color: #64748b; margin-top: 4px;">(Permiso)</div>
                        </div>
                        
                        <div class="razon-item" onclick="seleccionarTipoSalidaTemprana('salida_final')" style="border: 3px solid #ef4444; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); box-shadow: 0 6px 20px rgba(239, 68, 68, 0.1);">
                            <div class="razon-icon">🚪</div>
                            <div class="razon-label">No regreso hoy</div>
                            <div style="font-size: clamp(11px, 2.8vw, 12px); color: #64748b; margin-top: 4px;">(Salida definitiva)</div>
                        </div>
                    </div>
                    
                    <div class="d-grid gap-2" style="margin-top: 18px;">
                        <button class="btn btn-outline-secondary" onclick="mostrarModalRazonSalida()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-arrow-left"></i> Atrás
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        window.seleccionarTipoSalida = function (tipo) {
            if (tipo === 'final') {
                empleado.tipo_salida = 'FINAL';
                empleado.razon_permiso = '';
                procederConRegistro();
            } else if (tipo === 'intermedia') {
                mostrarModalRazonPermiso();
            } else if (tipo === 'campo') {
                empleado.tipoRegistro = 'SALIDA_CAMPO';
                empleado.tipo_salida = 'TRABAJO_CAMPO';
                empleado.razon_permiso = 'En Campo';
                registrar();
            }
        };

        window.seleccionarTipoSalidaTemprana = function (tipo) {
            if (tipo === 'salida_final') {
                // Salida temprana final - registrar como SALIDA_TEMPRANA_JUSTIFICADA
                empleado.tipo_salida = 'SALIDA_TEMPRANA_JUSTIFICADA';
                procederConRegistro();
            } else if (tipo === 'permiso') {
                // Si ya seleccionó una razón específica de permiso anteriormente, usarla directamente
                if (razonSalidaTemprana === 'permiso_medico' || razonSalidaTemprana === 'permiso_personal') {
                    const razonRef = razonSalidaTemprana === 'permiso_medico' ? 'medico' : 'personal';
                    const labelRef = razonSalidaTemprana === 'permiso_medico' ? 'Médico' : 'Personal';
                    seleccionarRazonPermisoConSalidaTemprana(razonRef, labelRef);
                } else {
                    // Si viene de "Salida Justificada" general, preguntar el tipo de permiso
                    mostrarModalRazonPermisoConSalidaTemprana();
                }
            }
        };

        function mostrarModalRazonPermiso() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-hourglass-half" style="font-size: 48px; color: #10b981; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Tipo de Permiso</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">¿Cuál es el motivo?</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="seleccionarRazonPermiso('medico', 'Médico')">
                            <div class="razon-icon">🏥</div>
                            <div class="razon-label">Médico</div>
                        </div>
                        
                        <div class="razon-item" onclick="seleccionarRazonPermiso('personal', 'Personal')">
                            <div class="razon-icon">👤</div>
                            <div class="razon-label">Personal</div>
                        </div>
                    </div>
                    
                    <div class="d-grid gap-2" style="margin-top: 18px;">
                        <button class="btn btn-outline-secondary" onclick="mostrarModalTipoSalida()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-arrow-left"></i> Atrás
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        function mostrarModalRazonPermisoConSalidaTemprana() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-hourglass-half" style="font-size: 48px; color: #10b981; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Tipo de Permiso</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">¿Cuál es el motivo?</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="seleccionarRazonPermisoConSalidaTemprana('medico', 'Médico')">
                            <div class="razon-icon">🏥</div>
                            <div class="razon-label">Médico</div>
                        </div>
                        
                        <div class="razon-item" onclick="seleccionarRazonPermisoConSalidaTemprana('personal', 'Personal')">
                            <div class="razon-icon">👤</div>
                            <div class="razon-label">Personal</div>
                        </div>
                    </div>
                    
                    <div class="d-grid gap-2" style="margin-top: 18px;">
                        <button class="btn btn-outline-secondary" onclick="mostrarModalTipoSalidaTemprana()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-arrow-left"></i> Atrás
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        window.seleccionarRazonPermiso = function (razon, label) {
            razonPermiso = razon;
            empleado.tipo_salida = 'PERMISO';
            // Estandarizar nombres según solicitud
            const labelEstandar = razon === 'medico' ? 'PERMISO MEDICO' : 'PERMISO PERSONAL';
            empleado.razon_permiso = labelEstandar;
            esPermisoIntermedio = true;

            mostrarToast(`✅ ${labelEstandar} registrado.`, 'success');
            setTimeout(() => procederConRegistro(), 1500);
        };

        window.seleccionarRazonPermisoConSalidaTemprana = function (razon, label) {
            razonPermiso = razon;
            empleado.tipo_salida = 'PERMISO_CON_SALIDA_TEMPRANA';
            empleado.razon_permiso = razon;
            esPermisoIntermedio = true;

            mostrarToast(`✅ Permiso ${label} con salida temprana registrado. Puedes regresar cuando lo necesites.`, 'success');
            setTimeout(() => procederConRegistro(), 1500);
        };

        window.cancelarPermiso = function () {
            renderHomePage();
        }

        function mostrarModalRazonEntrada() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-clock" style="font-size: 48px; color: #dc2626; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Registra tu entrada</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">Selecciona el motivo de tu entrada después de las ${HORA_ENTRADA_LIMITE}</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="procesarRazonEntrada('permiso_medico', 'Permiso médico')">
                            <div class="razon-icon">🏥</div>
                            <div class="razon-label">Permiso médico</div>
                        </div>
                        
                        <div class="razon-item" onclick="procesarRazonEntrada('permiso_personal', 'Permiso personal')">
                            <div class="razon-icon">📋</div>
                            <div class="razon-label">Permiso personal</div>
                        </div>
                        
                        <div class="razon-item" onclick="mostrarJustificacionEntrada('entrada_justificada', 'Entrada Justificada')">
                            <div class="razon-icon">✅</div>
                            <div class="razon-label">Entrada Justificada</div>
                        </div>
                        
                        <div class="razon-item" onclick="procesarRazonEntrada('regreso_campo', 'Regreso de Campo')">
                            <div class="razon-icon">🏢</div>
                            <div class="razon-label">Regreso de Campo</div>
                        </div>
                    </div>
                    
                    <div class="d-grid gap-2" style="margin-top: 18px;">
                        <button class="btn btn-outline-secondary" onclick="cancelarRazonEntrada()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        function mostrarJustificacionEntrada(razon, label) {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-clipboard-check" style="font-size: 48px; color: #0284c7; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">Entrada Justificada</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">¿Quién autoriza esta entrada?</p>
                    </div>
                    
                    <div style="background: #eff6ff; border-left: 4px solid #0284c7; padding: 14px 16px; border-radius: 10px; margin-bottom: 18px;">
                        <input type="text" id="quienJustificaEntrada" placeholder="Nombre de la persona o jefe" 
                               style="width: 100%; padding: 14px 16px; border: 2px solid #bfdbfe; border-radius: 10px; font-size: clamp(16px, 4.5vw, 18px); color: #1e293b; background: white;"
                               onkeypress="if(event.key==='Enter') procesarRazonEntradaJustificada()">
                    </div>
                    
                    <div class="d-grid gap-2">
                        <button class="btn btn-primary btn-lg" onclick="procesarRazonEntradaJustificada()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-check-circle"></i> Confirmar
                        </button>
                        <button class="btn btn-outline-secondary" onclick="mostrarModalRazonEntrada()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-arrow-left"></i> Atrás
                        </button>
                    </div>
                </div>
            </div>
        `;
            document.getElementById('quienJustificaEntrada').focus();
            ajustarLayout();
        }

        window.procesarRazonEntradaJustificada = function () {
            const nombre = document.getElementById('quienJustificaEntrada')?.value.trim();
            if (!nombre) {
                mostrarToast('Ingresa el nombre de quién autoriza', 'error');
                return;
            }

            razonEntradaTardia = 'entrada_justificada';
            detalleRazonEntrada = {
                razon: 'entrada_justificada',
                quien_justifica: nombre
            };

            // Verificar si la hora de almuerzo ya pasó
            if (horaLimiteAlmuerzoPasada()) {
                empleado.almuerzo = 'NO';
                mostrarToast(`⚠️ Fuera del horario de almuerzo. Se registra almuerzo fuera de planta.`, 'error');
                setTimeout(() => registrar(), 2000);
            } else {
                mostrarLunchSelector();
            }
        };

        window.procesarRazonEntrada = function (razon, label) {
            razonEntradaTardia = razon;
            detalleRazonEntrada = {
                razon: razon,
                quien_justifica: ''
            };

            // Verificar si la hora de almuerzo ya pasó
            if (horaLimiteAlmuerzoPasada()) {
                empleado.almuerzo = 'NO';
                mostrarToast(`⚠️ Fuera del horario de almuerzo. Se registra almuerzo fuera de planta.`, 'error');
                setTimeout(() => registrar(), 2000);
            } else {
                mostrarLunchSelector();
            }
        };

        window.cancelarRazonEntrada = function () {
            razonEntradaTardia = null;
            detalleRazonEntrada = null;
            renderHomePage();
        }

        function mostrarLunchSelector() {
            const mainContent = document.getElementById('mainContent');
            lugarSeleccionado = null;

            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <i class="fas fa-utensils" style="font-size: 48px; color: #f59e0b; margin-bottom: 12px;"></i>
                        <h3 style="font-size: clamp(22px, 6vw, 28px); color: #0f172a; margin: 0; font-weight: 700;">¿Dónde almuerzas?</h3>
                        <p style="color: #64748b; font-size: clamp(15px, 4.2vw, 18px); margin-top: 10px; line-height: 1.4;">Selecciona tu opción de almuerzo para hoy</p>
                    </div>
                    
                    <div class="modal-razones">
                        <div class="razon-item" onclick="seleccionarLugar('SI')" id="lunchSi">
                            <div class="razon-icon">🏢</div>
                            <div class="razon-label">En planta</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Almuerzo en empresa</div>
                        </div>
                        
                        <div class="razon-item" onclick="seleccionarLugar('NO')" id="lunchNo">
                            <div class="razon-icon">🏠</div>
                            <div class="razon-label">Fuera</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Almuerzo externo</div>
                        </div>
                    </div>
                    
                    <div class="d-grid gap-2" style="margin-top: 24px;">
                        <button class="btn btn-primary btn-lg" onclick="confirmarMenuYOpcion()" id="btnConfirmarAlmuerzo" disabled style="font-size: clamp(16px, 4.2vw, 18px); padding: 14px;">
                            <i class="fas fa-check-circle"></i> Confirmar y registrar
                        </button>
                        <button class="btn btn-outline-secondary" onclick="volverAHome()" style="font-size: clamp(16px, 4.2vw, 18px);">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;
            ajustarLayout();
        }

        function volverAHome() {
            lugarSeleccionado = null;
            if (isAuthenticated) {
                renderHomePage();
            } else {
                renderAuthScreen();
            }
            ajustarLayout();
        }

        // ========== VERIFICACIÓN DE CONTRASEÑA ==========
        async function verificarPIN() {
            const pin = document.getElementById('pinInput').value.trim();
            if (!pin || pin.length < 4) {
                mostrarToast('Ingresa tu contraseña de acceso', 'error');
                return;
            }

            showLoading(true);

            try {
                const res = await verificarPINAPI(pin, deviceToken);
                showLoading(false);

                if (res.error) {
                    const pinResult = document.getElementById('pinResult');
                    if (pinResult) {
                        pinResult.classList.remove('hidden');
                        pinResult.textContent = '❌ ' + res.error;
                    }
                    mostrarToast(res.error, 'error');
                    return;
                }

                if (res.valido) {
                    localStorage.setItem('SESSION_DATA', JSON.stringify({
                        empleadoId: res.empleado.id,
                        token: deviceToken,
                        timestamp: new Date().toISOString()
                    }));

                    const hoyStr = new Date().toISOString().split('T')[0];
                    let horaEntradaRegistro = null;
                    let horaSalidaRegistro = null;

                    const registros = await obtenerRegistrosEmpleadoAPI(res.empleado.id);
                    const registroHoy = registros.filter(r => r.fecha === hoyStr);
                    const entradaHoy = registroHoy.find(r => r.tipo === 'ENTRADA');
                    const salidaHoy = registroHoy.find(r => r.tipo === 'SALIDA');

                    if (entradaHoy) {
                        horaEntradaRegistro = formatearHora(entradaHoy.timestamp || entradaHoy.hora);
                    }
                    if (salidaHoy) {
                        horaSalidaRegistro = formatearHora(salidaHoy.timestamp || salidaHoy.hora);
                    }

                    estado = {
                        tieneEntrada: res.empleado.tieneEntrada || false,
                        tieneSalida: res.empleado.tieneSalida || false,
                        horaEntrada: horaEntradaRegistro || res.empleado.horaEntrada || null,
                        horaSalida: horaSalidaRegistro || res.empleado.horaSalida || null,
                        almuerzo: res.empleado.almuerzo || null,
                        esSupervisor: res.empleado.esSupervisor || false
                    };

                    empleado = {
                        id: res.empleado.id,
                        nombre: res.empleado.nombre || 'Empleado',
                        area: res.empleado.area || 'Área',
                        foto_url: res.empleado.foto_url || '',
                        cargo: res.empleado.cargo || '',
                        fechaNacimiento: res.empleado.fechaNacimiento || '',
                        baseLat: res.empleado.baseLat || null,
                        baseLng: res.empleado.baseLng || null,
                        tipoRegistro: '',
                        almuerzo: ''
                    };

                    // Actualizar interfaz segun cargo inmediatamente
                    actualizarInterfazSegunCargo();

                    // Verificar Cumpleaños
                    if (esCumpleanos(empleado.fechaNacimiento)) {
                        setTimeout(celebrarCumpleanos, 1000);
                    }

                    isAuthenticated = true;
                    await obtenerRegistrosEmpleado();
                    let faltas = obtenerDiasFaltantes();

                    // MECANISMO DE AUTO-SANACIÓN: Si hay faltas, forzar refresco de archivados una vez para descartar cache vieja
                    if (faltas.length > 0) {
                        console.log("⚠️ Detectadas faltas. Re-verificando con refresco forzado...");
                        await obtenerRegistrosEmpleado(true);
                        faltas = obtenerDiasFaltantes();
                    }

                    if (faltas.length > 0) {
                        mostrarModalFaltasPasadas(faltas);
                    } else {
                        renderHomePage();
                    }
                    mostrarToast(`Bienvenido ${empleado.nombre}`, 'success');
                } else {
                    mostrarToast('Contraseña incorrecta', 'error');
                }
            } catch (error) {
                showLoading(false);
                mostrarToast('Error de conexión: ' + error.message, 'error');
            }
            ajustarLayout();
        }

        async function confirmarRegistroInicial() {
            const empleadoId = document.getElementById('registroEmployeeId').value.trim();
            const pin = document.getElementById('registroPinDisplay').textContent;

            if (!empleadoId) {
                mostrarToast('Ingresa tu ID de empleado', 'error');
                return;
            }

            showLoading(true);

            try {
                const res = await registrarDispositivoConPIN(empleadoId, pin, deviceToken);
                showLoading(false);

                if (res.error) {
                    mostrarToast(res.error, 'error');
                    return;
                }

                if (res.ok) {
                    mostrarToast(`Registro exitoso. Tu clave de acceso es: ${pin}`, 'success');
                    localStorage.setItem('SESSION_DATA', JSON.stringify({
                        empleadoId,
                        token: deviceToken,
                        timestamp: new Date().toISOString()
                    }));

                    const estadoRes = await obtenerEstado(empleadoId, null);
                    if (!estadoRes.error) {
                        estado = {
                            tieneEntrada: estadoRes.tieneEntrada || false,
                            tieneSalida: estadoRes.tieneSalida || false,
                            horaEntrada: estadoRes.horaEntrada || null,
                            horaSalida: estadoRes.horaSalida || null,
                            almuerzo: estadoRes.almuerzo || null,
                            esSupervisor: estadoRes.esSupervisor || false
                        };
                        empleado = {
                            id: estadoRes.id,
                            nombre: estadoRes.nombre,
                            area: estadoRes.area,
                            foto_url: estadoRes.foto_url,
                            cargo: estadoRes.cargo || '',
                            fechaNacimiento: estadoRes.fechaNacimiento || '',
                            baseLat: estadoRes.baseLat || null,
                            baseLng: estadoRes.baseLng || null,
                            tipoRegistro: '',
                            almuerzo: ''
                        };

                        if (esCumpleanos(empleado.fechaNacimiento)) {
                            setTimeout(celebrarCumpleanos, 1000);
                        }

                        // Actualizar interfaz inmediatamente según cargo
                        actualizarInterfazSegunCargo();
                        isAuthenticated = true;
                        await obtenerRegistrosEmpleado();
                        const faltas = obtenerDiasFaltantes();
                        if (faltas.length > 0) {
                            mostrarModalFaltasPasadas(faltas);
                        } else {
                            renderHomePage();
                        }
                    }
                }
            } catch (error) {
                showLoading(false);
                mostrarToast('Error de conexión: ' + error.message, 'error');
            }
            ajustarLayout();
        }

        // ========== RENDERIZADO DE PÁGINAS ==========
        function renderAuthScreen() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div id="verifyingScreen">
                    <div class="glass-card text-center py-5">
                        <div class="spinner-border text-primary mb-3" style="width: 3rem; height: 3rem;" role="status"></div>
                        <h5 class="fw-bold">Verificando...</h5>
                        <p class="text-muted">Por favor espera</p>
                    </div>
                </div>
                
                <div id="pinScreen" class="hidden">
                    <div class="glass-card">
                        <div class="text-center mb-4">
                            <div class="bg-primary-light rounded-circle d-inline-flex p-3 mb-3">
                                <i class="fas fa-key fa-2x text-primary"></i>
                            </div>
                            <h3 class="h4 fw-bold">Acceso al sistema</h3>
                            <p class="text-muted small">Ingresa tu contraseña de acceso</p>
                        </div>
                        
                        <div class="mb-4">
                            <input type="password" id="pinInput" class="form-control form-control-lg pin-input" placeholder="••••" maxlength="4" inputmode="numeric" autocomplete="off">
                        </div>
                        
                        <div class="alert alert-info py-2 small mb-4">
                            <i class="fas fa-info-circle"></i> Si es tu primera vez, haz clic en "Registrar dispositivo"
                        </div>
                        
                        <button class="btn btn-primary btn-lg w-100 mb-2" onclick="verificarPIN()">
                            <i class="fas fa-arrow-right"></i> Ingresar
                        </button>
                        
                        <button class="btn btn-outline-primary w-100" onclick="mostrarRegistroInicial()">
                            <i class="fas fa-user-plus"></i> Registrar dispositivo
                        </button>
                        
                        <div id="pinResult" class="hidden alert alert-danger mt-3"></div>
                    </div>
                </div>
                
                <div id="registroInicialScreen" class="hidden">
                    <div class="glass-card">
                        <div class="text-center mb-4">
                            <div class="bg-primary-light rounded-circle d-inline-flex p-3 mb-3">
                                <i class="fas fa-mobile-alt fa-2x text-primary"></i>
                            </div>
                            <h3 class="h4 fw-bold">Registro inicial</h3>
                            <p class="text-muted small">Vincula este dispositivo a tu cuenta</p>
                        </div>
                        
                        <div class="bg-light rounded-3 p-3 mb-3">
                            <div class="d-flex justify-content-between">
                                <span class="text-muted">Contraseña generada</span>
                                <span class="fw-bold text-primary font-monospace fs-4" id="registroPinDisplay">----</span>
                            </div>
                        </div>
                        
                        <div class="alert alert-danger py-2 small mb-3">
                            <i class="fas fa-exclamation-triangle"></i> Guarda esta contraseña. La necesitarás para acceder desde cualquier navegador.
                        </div>
                        
                        <input type="text" id="registroEmployeeId" class="form-control form-control-lg mb-3" placeholder="Ingresa tu ID de empleado">
                        
                        <button class="btn btn-primary btn-lg w-100 mb-2" onclick="confirmarRegistroInicial()">
                            <i class="fas fa-check"></i> Confirmar registro
                        </button>
                        
                        <button class="btn btn-outline-secondary w-100" onclick="volverAPIN()">
                            <i class="fas fa-arrow-left"></i> Volver
                        </button>
                        
                        <div id="registroResult" class="hidden alert alert-danger mt-3"></div>
                    </div>
                </div>
            </div>
        `;

            verificarDispositivoConPIN();
            ajustarLayout();
        }

        async function verificarDispositivoConPIN() {
            try {
                const res = await verificarDispositivoTienePIN(deviceToken);
                const verifyingScreen = document.getElementById('verifyingScreen');
                const pinScreen = document.getElementById('pinScreen');
                const registroScreen = document.getElementById('registroInicialScreen');

                if (verifyingScreen) verifyingScreen.classList.add('hidden');

                if (res && res.tienePin) {
                    if (pinScreen) pinScreen.classList.remove('hidden');
                    document.getElementById('pinInput')?.focus();
                } else {
                    if (registroScreen) {
                        registroScreen.classList.remove('hidden');
                        document.getElementById('registroPinDisplay').textContent = generarPIN();
                    }
                }
            } catch (error) {
                const verifyingScreen = document.getElementById('verifyingScreen');
                const pinScreen = document.getElementById('pinScreen');
                if (verifyingScreen) verifyingScreen.classList.add('hidden');
                if (pinScreen) pinScreen.classList.remove('hidden');
                mostrarToast('Error de conexión con el servidor', 'error');
            }
            ajustarLayout();
        }

        function mostrarRegistroInicial() {
            const pinScreen = document.getElementById('pinScreen');
            const registroScreen = document.getElementById('registroInicialScreen');
            const verifyingScreen = document.getElementById('verifyingScreen');

            if (verifyingScreen) verifyingScreen.classList.add('hidden');
            if (pinScreen) pinScreen.classList.add('hidden');
            if (registroScreen) registroScreen.classList.remove('hidden');

            document.getElementById('registroPinDisplay').textContent = generarPIN();
            ajustarLayout();
        }

        function volverAPIN() {
            const registroScreen = document.getElementById('registroInicialScreen');
            const pinScreen = document.getElementById('pinScreen');

            if (registroScreen) registroScreen.classList.add('hidden');
            if (pinScreen) pinScreen.classList.remove('hidden');
            ajustarLayout();
        }

        function esFeriado(fechaStr) {
            if (!fechaStr) return false;
            let fecha = new Date(fechaStr + 'T12:00:00');
            const m = fecha.getMonth() + 1;
            const d = fecha.getDate();
            const md = `${m}/${d}`;

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

        // ========== JUSTIFICAR FALTAS ANTERIORES ==========
        function obtenerDiasFaltantes() {
            const faltas = [];
            if (!registrosCompletos || registrosCompletos.length === 0) return faltas;

            let earliestDate = null;
            registrosCompletos.forEach(r => {
                const rFecha = getVal(r, 'fecha', 0);
                if (rFecha) {
                    let d = null;
                    if (typeof rFecha === 'string') {
                        const parsed = /^\d{4}-\d{2}-\d{2}T/.test(rFecha) ? rFecha.split('T')[0] : rFecha;
                        d = new Date(parsed);
                    } else if (rFecha instanceof Date) {
                        d = rFecha;
                    }
                    if (d && !isNaN(d.getTime())) {
                        if (!earliestDate || d < earliestDate) earliestDate = d;
                    }
                }
            });

            if (!earliestDate) return faltas;
            earliestDate.setHours(0, 0, 0, 0);

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            const limite15Dias = new Date(hoy);
            limite15Dias.setDate(limite15Dias.getDate() - 15);

            let startDate = earliestDate > limite15Dias ? earliestDate : limite15Dias;

            // Limpiar timezone behavior asegurando horas locales en 0
            for (let d = new Date(startDate); d < hoy; d.setDate(d.getDate() + 1)) {
                // Format YYYY-MM-DD reliably using offset
                const tzDate = new Date(d);
                tzDate.setMinutes(tzDate.getMinutes() - tzDate.getTimezoneOffset());
                const dateStr = tzDate.toISOString().split('T')[0];

                if (d.getDay() === 0 || d.getDay() === 6 || esFeriado(dateStr)) continue; // Skip Sat/Sun/Holidays

                const tieneRegistro = registrosCompletos.some(r => {
                    const rFecha = getVal(r, 'fecha', 0);
                    if (!rFecha) return false;
                    let checkStr = '';
                    if (typeof rFecha === 'string') {
                        if (/^\d{4}-\d{2}-\d{2}T/.test(rFecha)) checkStr = rFecha.split('T')[0];
                        else checkStr = rFecha.substring(0, 10);
                    } else if (rFecha instanceof Date) {
                        const tzDate2 = new Date(rFecha);
                        tzDate2.setMinutes(tzDate2.getMinutes() - tzDate2.getTimezoneOffset());
                        checkStr = tzDate2.toISOString().split('T')[0];
                    }
                    return checkStr === dateStr || checkStr.startsWith(dateStr);
                });

                if (!tieneRegistro) {
                    faltas.push(dateStr);
                }
            }

            return faltas;
        }

        let faltasPendientes = [];

        function mostrarModalFaltasPasadas(faltas) {
            faltasPendientes = faltas.sort((a, b) => new Date(a) - new Date(b));
            renderFaltasMasivas();
            ajustarLayout();
        }

        function renderFaltasMasivas() {
            if (faltasPendientes.length === 0) {
                renderHomePage();
                return;
            }

            const listHtml = faltasPendientes.map((fecha, idx) => {
                const d = new Date(fecha);
                d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
                const diaStr = d.toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' });
                return `
                <div class="falta-row" style="display: flex; align-items: center; gap: 12px; padding: 10px; border-bottom: 1px solid #f1f5f9;">
                    <input type="checkbox" id="chk-${idx}" class="falta-chk" value="${fecha}" checked style="width: 20px; height: 20px; accent-color: #3b82f6;">
                    <label for="chk-${idx}" style="flex: 1; font-weight: 500; font-size: 14px; margin: 0;">${diaStr}</label>
                </div>
            `;
            }).join('');

            document.getElementById('mainContent').innerHTML = `
            <div class="page">
                <div class="glass-card">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-calendar-check" style="font-size: 40px; color: #3b82f6; margin-bottom: 10px;"></i>
                        <h3 style="font-size: 20px; color: #0f172a; margin: 0; font-weight: 800;">Justificar Asistencias</h3>
                        <p style="font-size: 13px; color: #64748b; margin-top: 5px;">Selecciona los días y el motivo</p>
                    </div>

                    <div id="listaFaltas" style="max-height: 200px; overflow-y: auto; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
                        ${listHtml}
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="display: block; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">Motivo de la ausencia</label>
                        <select id="motivoMasivo" style="width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #cbd5e1; font-family: 'Inter', sans-serif; font-size: 14px; background: white;">
                            <option value="Vacaciones">🏖️ Vacaciones</option>
                            <option value="Permiso médico">🏥 Permiso Médico</option>
                            <option value="Calamidad doméstica">🏠 Calamidad Doméstica</option>
                            <option value="Permiso personal">👤 Permiso Personal</option>
                            <option value="Falta injustificada">❌ Falta Injustificada</option>
                        </select>
                    </div>

                    <button onclick="procesarJustificacionMasiva()" class="btn-primary" style="width:100%; padding: 14px; border-radius: 12px; font-weight: 700;">
                        Justificar seleccionados
                    </button>
                    
                    <button onclick="renderHomePage()" style="width:100%; background: none; border: none; color: #64748b; font-size: 13px; font-weight: 600; margin-top: 15px; cursor: pointer;">
                        Saltar por ahora
                    </button>
                </div>
            </div>
        `;
        }

        window.procesarJustificacionMasiva = async function () {
            const checkboxes = document.querySelectorAll('.falta-chk:checked');
            const motivo = document.getElementById('motivoMasivo').value;
            const fechas = Array.from(checkboxes).map(cb => cb.value);

            if (fechas.length === 0) {
                mostrarToast('Selecciona al menos un día', 'error');
                return;
            }

            showLoading(true);
            let exitos = 0;
            let errores = 0;

            try {
                // Procesamos uno por uno SECUENCIALMENTE para evitar errores de bloqueo en Google Sheets
                for (const fecha of fechas) {
                    const datos = {
                        id: empleado.id,
                        nombre: empleado.nombre,
                        tipo: 'FALTA',
                        fecha_falta: fecha,
                        razon_permiso: motivo,
                        dispositivo: deviceToken
                    };
                    try {
                        const res = await guardarRegistroAPI(datos);
                        if (res.error) {
                            console.error(`Error en día ${fecha}:`, res.error);
                            errores++;
                        } else {
                            exitos++;
                        }
                    } catch (e) {
                        console.error(`Excepción en día ${fecha}:`, e);
                        errores++;
                    }
                }

                showLoading(false);
                if (exitos > 0) {
                    mostrarToast(`${exitos} día(s) justificado(s) correctamente`, 'success');
                }
                if (errores > 0) {
                    mostrarToast(`${errores} error(es) al procesar. Revisa tu conexión.`, 'error');
                }

                // Refrescar datos y volver al home si ya no hay faltas
                await obtenerRegistrosEmpleado();
                const faltasActualizadas = obtenerDiasFaltantes();
                if (faltasActualizadas.length === 0) {
                    renderHomePage();
                } else {
                    faltasPendientes = faltasActualizadas;
                    renderFaltasMasivas();
                }
            } catch (error) {
                showLoading(false);
                mostrarToast('Error al procesar: ' + error.message, 'error');
            }
        };

        // ========== LÓGICA DE STATUS LABORAL ==========
        function calcularStatusActual() {
            const hoy = new Date();
            const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

            // Filtrar registros de hoy
            const regsHoy = registrosCompletos.filter(r => {
                const fecha = getVal(r, 'fecha', 0) || r[0];
                let fStr = '';
                if (fecha instanceof Date) fStr = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
                else fStr = /^\d{4}-\d{2}-\d{2}T/.test(String(fecha)) ? String(fecha).split('T')[0] : String(fecha).substring(0, 10);
                return fStr === hoyStr;
            });

            if (regsHoy.length === 0) return { label: 'Fuera de horario', icon: '🌙', color: '#64748b' };

            // Ordenar por hora/timestamp (el último manda)
            const ultimo = [...regsHoy].sort((a, b) => {
                const ha = getVal(a, 'hora', 5) || a[5];
                const hb = getVal(b, 'hora', 5) || b[5];
                return String(ha).localeCompare(String(hb));
            }).pop();

            const tipo = (getVal(ultimo, 'tipo', 3) || ultimo[3]).toUpperCase();
            const razon = String(getVal(ultimo, 'razon_salida', 17) || ultimo[17] || '').toLowerCase();

            switch (tipo) {
                case 'ENTRADA': case 'RETORNO_CAMPO':
                    return { label: 'OFICINA', icon: '🏢', color: '#10b981' };
                case 'SALIDA_CAMPO':
                    return { label: 'CAMPO', icon: '🚗', color: '#f59e0b' };
                case 'SALIDA':
                    const tSalida = String(getVal(ultimo, 'tipo_salida', 21) || ultimo[21] || '').toUpperCase();
                    const rPermiso = String(getVal(ultimo, 'razon_permiso', 22) || ultimo[22] || '').toUpperCase();

                    if (tSalida === 'PERMISO' || tSalida === 'INTERMEDIA' || tSalida.includes('PERMISO')) {
                        const label = (rPermiso.includes('MEDICO') || razon.includes('medico') || tSalida.includes('MEDICO')) ? 'PERMISO MEDICO' : 'PERMISO PERSONAL';
                        return { label: label, icon: '🕐', color: '#8b5cf6' };
                    }
                    if (tSalida === 'TRABAJO_CAMPO' || rPermiso === 'EN CAMPO' || razon.includes('campo')) {
                        return { label: 'CAMPO', icon: '🚗', color: '#f59e0b' };
                    }
                    if (tSalida === 'CUMPLEAÑOS' || razon.includes('cumpleanos')) {
                        return { label: 'CUMPLEAÑOS', icon: '🎂', color: '#ff69b4' };
                    }
                    if (tSalida === 'SALIDA_TEMPRANA_JUSTIFICADA' || razon.includes('justificada')) {
                        return { label: 'SALIDA JUSTIFICADA', icon: '✅', color: '#64748b' };
                    }
                    return { label: 'JORNADA FINALIZADA', icon: '🏡', color: '#64748b' };
                case 'ESTADO':
                    return { label: (razon || 'ESTADO').toUpperCase(), icon: '👤', color: '#8b5cf6' };
                case 'FALTA':
                    const rFalta = String(getVal(ultimo, 'razon_permiso', 22) || ultimo[22] || getVal(ultimo, 'razon_salida', 17) || ultimo[17] || '').toUpperCase();
                    if (rFalta.includes('VACACIONES')) return { label: 'VACACIONES', icon: '🏖️', color: '#3b82f6' };
                    if (rFalta.includes('MEDICO')) return { label: 'PERMISO MEDICO', icon: '🏥', color: '#ef4444' };
                    if (rFalta.includes('PERSONAL')) return { label: 'PERMISO PERSONAL', icon: '👤', color: '#8b5cf6' };
                    return { label: rFalta || 'AUSENCIA JUSTIFICADA', icon: '🏖️', color: '#3b82f6' };
                default:
                    return { label: 'EN ACTIVIDAD', icon: '⚙️', color: '#10b981' };
            }
        }

        // ========== RENDER HOME (CREDENCIAL) ==========
        function renderHomePage() {
            const mainContent = document.getElementById('mainContent');
            const nombreCompleto = empleado.nombre || 'EMPLEADO';
            const partes = nombreCompleto.split(' ');
            const primerNombre = partes[0] || 'EMPLEADO';
            const apellido = partes.slice(1).join(' ') || '';

            const fechaVigencia = new Date();
            fechaVigencia.setFullYear(fechaVigencia.getFullYear() + 1);

            const tieneEntrada = estado.tieneEntrada;
            const tieneSalida = estado.tieneSalida;
            const almuerzo = estado.almuerzo;

            const horaEntradaMostrar = estado.horaEntrada || (tieneEntrada ? 'Registrada' : 'Pendiente');
            const horaSalidaMostrar = estado.horaSalida || (tieneSalida ? 'Registrada' : 'Pendiente');

            const esAdmin = empleado.id === ADMIN_ID;
            const statusActual = calcularStatusActual();

            // Detectar puntualidad del empleado según registros del mes
            function calcularInsigniaPersonal() {
                if (!registrosCompletos || registrosCompletos.length === 0) return null;
                let atrasos = 0, diasConEntrada = 0;
                const grupos = {};
                registrosCompletos.forEach(reg => {
                    const fecha = getVal(reg, 'fecha', 0) || reg[0];
                    if (fecha) { if (!grupos[fecha]) grupos[fecha] = []; grupos[fecha].push(reg); }
                });
                Object.values(grupos).forEach(regs => {
                    const e = regs.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'ENTRADA');
                    if (e) {
                        diasConEntrada++;
                        const horaEntrada = getVal(e, 'timestamp', 2) || getVal(e, 'hora', 5) || e[2] || e[5];
                        if (calcularMinutosAtraso(horaEntrada) > 0) atrasos++;
                    }
                });
                if (diasConEntrada === 0) return { tipo: 'sin-registro', icono: '📋', texto: 'SIN REGISTROS' };
                const porcentaje = (atrasos / diasConEntrada) * 100;
                if (porcentaje === 0) return { tipo: 'puntual', icono: '⭐', texto: 'ASISTENCIA PERFECTA' };
                if (porcentaje <= 5) return { tipo: 'puntual', icono: '🏅', texto: 'MUY PUNTUAL' };
                if (porcentaje >= 40) return { tipo: 'atrasado', icono: '🔴', texto: 'ATRASOS FRECUENTES' };
                return null; // Solo muestra para el mejor o peor de los casos
            }

            // Retorna el emoji del área de trabajo
            function iconoDeArea(area) {
                if (!area) return { emoji: '🏢', label: 'General' };
                const a = area.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (a.includes('taller') || a.includes('mecanica') || a.includes('metal')) return { emoji: '🔧', label: area };
                if (a.includes('sistemas') || a.includes('ti') || a.includes('tecn') || a.includes('software')) return { emoji: '💻', label: area };
                if (a.includes('contab') || a.includes('finan') || a.includes('administr')) return { emoji: '📊', label: area };
                if (a.includes('bodega') || a.includes('logist') || a.includes('almacen')) return { emoji: '📦', label: area };
                if (a.includes('produccion') || a.includes('planta') || a.includes('manufactur')) return { emoji: '⚙️', label: area };
                if (a.includes('diseno') || a.includes('calidad') || a.includes('ing')) return { emoji: '📐', label: area };
                if (a.includes('ventas') || a.includes('comercial')) return { emoji: '📈', label: area };
                if (a.includes('rrhh') || a.includes('recursos') || a.includes('personal')) return { emoji: '👥', label: area };
                if (a.includes('gerenc') || a.includes('direcc') || a.includes('jefatur')) return { emoji: '🏆', label: area };
                if (a.includes('campo') || a.includes('civil') || a.includes('construc')) return { emoji: '🏗️', label: area };
                if (a.includes('electr')) return { emoji: '⚡', label: area };
                return { emoji: '🏢', label: area };
            }

            // Inicializar variables para la credencial
            const esCumpleanosHoy = esCumpleanos(empleado.fechaNacimiento);
            const stats = calcularEstadisticas();
            const areaInfo = iconoDeArea(empleado.area);

            // Crear globos persistentes que permanecen todo el día (via elementos fixed)
            if (esCumpleanosHoy && !document.getElementById('birthdayBalloons')) {
                const balloonContainer = document.createElement('div');
                balloonContainer.id = 'birthdayBalloons';
                const colors = ['#ff69b4', '#ffb6c1', '#ffd700', '#87ceeb', '#98fb98', '#f472b6', '#c084fc'];
                for (let i = 0; i < 12; i++) {
                    const b = document.createElement('div');
                    b.className = 'balloon';
                    b.style.left = (Math.random() * 90 + 5) + 'vw';
                    b.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                    b.style.animationDuration = (Math.random() * 4 + 5) + 's';
                    b.style.animationDelay = (Math.random() * 6) + 's';
                    balloonContainer.appendChild(b);
                    const c = document.createElement('div');
                    c.className = 'confetti';
                    c.style.left = (Math.random() * 100) + 'vw';
                    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                    c.style.width = (Math.random() * 8 + 4) + 'px';
                    c.style.height = (Math.random() * 8 + 4) + 'px';
                    c.style.animationDuration = (Math.random() * 3 + 3) + 's';
                    c.style.animationDelay = (Math.random() * 5) + 's';
                    balloonContainer.appendChild(c);
                }
                document.body.appendChild(balloonContainer);
            }

            mainContent.innerHTML = `
            <div class="credencial-header-profesional">
                <div class="header-logo-section">
                    <div class="header-logo-icon">T</div>
                    <div>
                        <div class="header-text-main">TCONTROL</div>
                        <div class="header-text-sub">Asistencia</div>
                    </div>
                </div>
                <div class="header-date-section">
                    <div class="header-date-day">${new Date().getDate()}</div>
                    <div class="header-date-month">${new Date().toLocaleDateString('es-EC', { month: 'short' })}</div>
                </div>
            </div>

            <div class="credencial-wrapper">
                <div class="credencial-profesional ${esCumpleanosHoy ? 'birthday-glow' : ''}">
                    <div class="photo-name-section">
                        <div class="photo-frame" style="position: relative;">
                            ${esCumpleanosHoy ? `
                            <div class="birthday-hat-overlay">
                                <div class="birthday-hat-badge">🥳</div>
                            </div>` : ''}
                            <div onclick="showPhotoModal('${empleado.foto_url || ''}')">
                                ${empleado.foto_url && empleado.foto_url.trim() ?
                    `<img class="employee-photo-profesional" src="${empleado.foto_url}" alt="Foto">` :
                    `<div class="employee-photo-placeholder-profesional">👤</div>`
                }
                            </div>
                            <div class="photo-verified">
                                <i class="fas fa-check"></i>
                            </div>
                            <div class="employee-id-badge">ID: ${empleado.id || '---'}</div>
                        </div>
                        <!-- Insignias debajo del ID del usuario -->
                        <div class="insignias-container-credencial" style="margin-top: 38px; display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0px; position: relative; z-index: 20;">
                            ${generarInsigniasHTMLCompacto(stats)}
                        </div>
                        <div style="margin-top: 15px; margin-bottom: 6px;">
                            <div style="color: #64748b; font-size: clamp(12px, 3.5vw, 14px); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                                ${(() => {
                    const h = new Date().getHours();
                    if (h >= 5 && h < 12) return 'Buenos días';
                    if (h >= 12 && h < 18) return 'Buenas tardes';
                    return 'Buenas noches';
                })()}
                            </div>
                            <div class="employee-name-profesional" style="margin-top: 2px;">${primerNombre} ${apellido}</div>
                        </div>
                        <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
                            <div style="color: #64748b; font-size: clamp(12px, 3.5vw, 14px); font-weight: 600;">${empleado.area || 'General'}</div>
                            <div style="color: #1e293b; font-size: clamp(11px, 3vw, 12px); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">${empleado.cargo || 'Empleado'}</div>
                        </div>

                        <!-- Selector de Modo de Trabajo Compacto -->
                        <div class="mode-selector-premium" style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                            <div onclick="cambiarModo('OFICINA')" style="cursor: pointer; padding: 8px 16px; border-radius: 100px; border: 2px solid ${currentMode === 'OFICINA' ? '#10b981' : '#f1f5f9'}; background: ${currentMode === 'OFICINA' ? '#f0fdf4' : 'white'}; color: ${currentMode === 'OFICINA' ? '#166534' : '#94a3b8'}; font-size: 11px; font-weight: 800; transition: all 0.3s; display: flex; align-items: center; gap: 6px; box-shadow: ${currentMode === 'OFICINA' ? '0 4px 10px rgba(16,185,129,0.15)' : 'none'};">
                                <i class="fas fa-building" style="font-size: 12px;"></i> OFICINA
                            </div>
                            <div onclick="cambiarModo('CAMPO')" style="cursor: pointer; padding: 8px 16px; border-radius: 100px; border: 2px solid ${currentMode === 'CAMPO' ? '#f59e0b' : '#f1f5f9'}; background: ${currentMode === 'CAMPO' ? '#fffbeb' : 'white'}; color: ${currentMode === 'CAMPO' ? '#92400e' : '#94a3b8'}; font-size: 11px; font-weight: 800; transition: all 0.3s; display: flex; align-items: center; gap: 6px; box-shadow: ${currentMode === 'CAMPO' ? '0 4px 10px rgba(245,158,11,0.15)' : 'none'};">
                                <i class="fas fa-map-marker-alt" style="font-size: 12px;"></i> CAMPO
                            </div>
                        </div>

                        ${currentMode === 'CAMPO' ? `
                            <div style="margin-top: 10px; animation: fadeIn 0.3s ease;">
                                <button onclick="fijarBaseCampo()" style="padding: 8px 16px; border-radius: 12px; background: #0369a1; color: white; border: none; font-weight: 700; font-size: 11px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(3,105,161,0.2);">
                                    <i class="fas fa-location-arrow"></i> ${empleado.baseLat ? 'ACTUALIZAR PROYECTO' : 'FIJAR UBICACIÓN PROYECTO'}
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    

                    
                    <div class="status-section">
                        <div class="status-title">ESTADO DE ASISTENCIA - HOY</div>
                        <div class="status-grid">
                            <!-- Tarjeta Unificada de Entrada y Salida -->
                            <div class="status-card unified">
                                <div class="unified-item">
                                    <div class="unified-label">ENTRADA</div>
                                    <div class="unified-value ${tieneEntrada ? 'success' : 'pending'}" style="font-size: 17px;">${horaEntradaMostrar}</div>
                                </div>
                                <div class="unified-divider"></div>
                                <div class="unified-item">
                                    <div class="unified-label">SALIDA</div>
                                    <div class="unified-value ${tieneSalida ? 'success' : 'pending'}" style="font-size: 17px;">${horaSalidaMostrar}</div>
                                </div>
                            </div>
                            <!-- Tarjeta de Almuerzo -->
                            <!-- Tarjeta de Almuerzo: Ahora proporcional e integrada en el grid -->
                            <div class="status-card lunch ${(almuerzo === 'SI' || almuerzo === 'PLANTA') ? 'lunch-animated-si' : (almuerzo === 'NO' || almuerzo === 'FUERA') ? 'lunch-animated-no' : ''}" 
                                 style="position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 110px;">
                                
                                <div class="status-icon" style="height: 70px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; position: relative;">
                                    ${(almuerzo === 'SI' || almuerzo === 'PLANTA')
                    ? `
                                        <div style="position: absolute; width: 60px; height: 60px; background: radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%); animation: pulse-glow 2s infinite;"></div>
                                        <img src="almuerzo.gif" alt="Almuerzo" style="width: 90px; height: auto; position: relative; z-index: 2; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2)); animation: float-img 3s ease-in-out infinite;">
                                        `
                    : `
                                        <i class="fas fa-utensils" style="font-size: 24px; color: var(--warning);"></i>
                                        `
                }
                                </div>

                                <div class="status-label" style="font-size: 10px;">ALMUERZO</div>
                                <div class="status-value" style="font-size: clamp(12px, 3.5vw, 14px); font-weight: 800; ${(almuerzo === 'SI' || almuerzo === 'PLANTA') ? 'color:#059669;' : (almuerzo === 'NO' || almuerzo === 'FUERA') ? 'color:#2563eb;' : ''}">
                                    ${(almuerzo === 'SI' || almuerzo === 'PLANTA') ? 'Sí' : (almuerzo === 'NO' || almuerzo === 'FUERA') ? 'No' : '---'}
                                </div>

                                <style>
                                    @keyframes pulse-glow {
                                        0% { transform: scale(0.8); opacity: 0.5; }
                                        50% { transform: scale(1.2); opacity: 0.8; }
                                        100% { transform: scale(0.8); opacity: 0.5; }
                                    }
                                    @keyframes float-img {
                                        0% { transform: translateY(0px); }
                                        50% { transform: translateY(-5px); }
                                        100% { transform: translateY(0px); }
                                    }
                                </style>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Footer simplificado -->
                    <div class="credencial-footer-profesional" style="padding: 15px; border-top: 1px solid #f1f5f9; background: #f8fafc;">
                         <div style="text-align: center; width: 100%; color: #94a3b8; font-size: 11px; font-weight: 700; letter-spacing: 1px;">TCONTROL S.A. © 2026</div>
                    </div>
                </div>
                
                <!-- Botón de Acción Único y Dinámico -->
                <div class="main-action-wrapper">
                    ${(() => {
                    let btn = { type: 'ENTRADA', label: 'REGISTRAR ENTRADA', class: 'bg-entrada', icon: 'fa-sign-in-alt', disabled: '' };
                    if (statusActual.label.includes('CAMPO')) {
                        btn = { type: 'RETORNO_CAMPO', label: 'RETORNO DE CAMPO', class: 'bg-campo', icon: 'fa-undo', disabled: '' };
                    } else if (tieneEntrada && !tieneSalida) {
                        if (statusActual.label.includes('PERMISO')) {
                            btn = { type: 'ENTRADA', label: 'REGISTRAR RE-ENTRADA', class: 'bg-reentrada', icon: 'fa-door-open', disabled: '' };
                        } else {
                            btn = { type: 'SALIDA', label: 'REGISTRAR SALIDA', class: 'bg-salida', icon: 'fa-sign-out-alt', disabled: '' };
                        }
                    } else if (tieneSalida) {
                        btn = { type: 'NONE', label: 'JORNADA FINALIZADA', class: 'bg-salida', icon: 'fa-check-circle', disabled: 'disabled' };
                    }
                    return `
                        <button class="btn-main-action ${btn.class}" onclick="${btn.type !== 'NONE' ? `iniciarRegistro('${btn.type}')` : ''}" ${btn.disabled}>
                            <div class="btn-type"><i class="fas ${btn.icon}"></i> ${btn.label}</div>
                            ${tieneSalida
                                ? `<div id="btnTime" class="btn-time" data-completa="true">COMPLETA</div>`
                                : `<div id="btnTime" class="btn-time">--:--:--</div>`
                            }
                        </button>
                        `;
                })()}
                </div>
                
                ${esCumpleanosHoy ? `
                    <div class="birthday-banner glass-card" style="margin-top: 16px; margin-bottom: 8px; border: 1px solid #f472b6; background: linear-gradient(135deg, #fdf2f8, #fbcfe8);">
                        <div class="birthday-banner-content">
                            <div style="font-size: 24px; text-align: center; margin-bottom: 6px;">🎁</div>
                            <h3 style="color: #db2777; font-size: clamp(14px, 4vw, 16px); font-weight: 800; text-align: center; margin: 0 0 8px 0;">¡Feliz Cumpleaños!</h3>
                            <div style="background: rgba(255,255,255,0.6); border-radius: 8px; padding: 10px;">
                                <p style="color: #9d174d; font-size: clamp(11px, 3.2vw, 13px); line-height: 1.4; margin: 0; text-align: center; font-weight: 600;">
                                    Disfrute su medio día laborable libre. Recuerde registrar su salida como "Cumpleaños".
                                </p>
                            </div>
                        </div>
                    </div>
                ` : ''}
                
                ${estado.esSupervisor ? `
                    <button class="btn-supervisor" onclick="window.open('supervisor.html', '_blank')">
                        <i class="fas fa-chart-line"></i> PANEL SUPERVISOR
                    </button>
                ` : ''}
                
                ${esAdmin ? `
                    <button class="btn-admin" onclick="abrirPanelAdmin()">
                        <i class="fas fa-sliders-h"></i> CONFIGURACIÓN DEL SISTEMA
                    </button>
                ` : ''}
            </div>
        `;

            const fabWhatsApp = document.getElementById('fabWhatsApp');
            if (fabWhatsApp) fabWhatsApp.style.display = 'flex';

            // ====== RELOJ EN VIVO ======
            if (window._clockInterval) clearInterval(window._clockInterval);
            function actualizarReloj() {
                const clockEl = document.getElementById('liveClock');
                const dateEl = document.getElementById('liveDate');
                const btnTime = document.getElementById('btnTime');

                if (!clockEl && !btnTime) return; // No cortamos el intervalo para permitir que se recupere si volvemos a la home

                const ahora = new Date();
                const hh = String(ahora.getHours()).padStart(2, '0');
                const mm = String(ahora.getMinutes()).padStart(2, '0');
                const ss = String(ahora.getSeconds()).padStart(2, '0');
                const timeStr = `${hh}:${mm}:${ss}`;

                if (clockEl) clockEl.textContent = timeStr;
                if (btnTime) {
                    if (btnTime.getAttribute('data-completa') === 'true') {
                        btnTime.textContent = 'COMPLETA';
                    } else {
                        btnTime.textContent = timeStr;
                    }
                }

                if (dateEl) {
                    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
                    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                    dateEl.textContent = `${dias[ahora.getDay()]} ${ahora.getDate()} ${meses[ahora.getMonth()]}`;
                }
            }
            actualizarReloj();
            window._clockInterval = setInterval(actualizarReloj, 1000);

            ajustarLayout();
        }

        // ========== RENDER HISTORY (RESUMEN) - VERSIÓN MEJORADA CON ESTADÍSTICAS ==========
        function renderHistoryPage() {
            const mainContent = document.getElementById('mainContent');

            // Calcular estadísticas generales
            const stats = calcularEstadisticas();

            // Formatear fecha/hora actual
            function obtenerFechaHoraActualFormateada() {
                const ahora = new Date();
                const dia = String(ahora.getDate()).padStart(2, '0');
                const mes = String(ahora.getMonth() + 1).padStart(2, '0');
                const anio = ahora.getFullYear();
                const hh = String(ahora.getHours()).padStart(2, '0');
                const mm = String(ahora.getMinutes()).padStart(2, '0');
                const ss = String(ahora.getSeconds()).padStart(2, '0');
                return `${dia}-${mes}-${anio} ${hh}:${mm}:${ss}`;
            }

            const formatMins = (mins) => {
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                return `${h}h ${m}m`;
            };

            // Generar logros del periodo
            let logrosHTML = '';
            
            // Logro 1: Asistencia (basado en días trabajados)
            let asistenciaTitulo = '';
            let asistenciaDesc = '';
            let asistenciaIcono = '';
            let asistenciaColor = '';
            
            if (stats.diasTrabajados >= 15) {
                asistenciaTitulo = 'Asistencia de Platino';
                asistenciaDesc = `¡Extraordinario! Has registrado ${stats.diasTrabajados} días laborados en este período. Excelente compromiso.`;
                asistenciaIcono = '🏆';
                asistenciaColor = 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
            } else if (stats.diasTrabajados >= 8) {
                asistenciaTitulo = 'Asistencia de Oro';
                asistenciaDesc = `Muy buena constancia con ${stats.diasTrabajados} días laborados en este período. ¡Sigue así!`;
                asistenciaIcono = '🥇';
                asistenciaColor = 'linear-gradient(135deg, #fef3c7, #fde68a)';
            } else if (stats.diasTrabajados >= 1) {
                asistenciaTitulo = 'Asistencia de Plata';
                asistenciaDesc = `Has registrado ${stats.diasTrabajados} días laborados en este período. Buen inicio.`;
                asistenciaIcono = '🥈';
                asistenciaColor = 'linear-gradient(135deg, #ffedd5, #fed7aa)';
            } else {
                asistenciaTitulo = 'Iniciando Camino';
                asistenciaDesc = 'Aún no registras asistencias en este período. ¡Registra tu entrada hoy!';
                asistenciaIcono = '🥉';
                asistenciaColor = 'linear-gradient(135deg, #f1f5f9, #e2e8f0)';
            }

            logrosHTML += `
                <div class="achievement-card" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    <div class="achievement-icon" style="font-size: 24px; background: ${asistenciaColor}; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;">
                        ${asistenciaIcono}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 13px; color: #1e293b;">${asistenciaTitulo}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${asistenciaDesc}</div>
                    </div>
                </div>
            `;

            // Logro 2: Puntualidad (basado en porcentaje)
            const puntualidadPct = stats.diasTrabajados > 0 ? Math.max(0, Math.round(((stats.diasTrabajados - stats.atrasos) / stats.diasTrabajados) * 100)) : 100;
            let puntualidadTitulo = '';
            let puntualidadDesc = '';
            let puntualidadIcono = '';
            let puntualidadColor = '';
            
            if (stats.diasTrabajados === 0) {
                puntualidadTitulo = 'Sin Registro';
                puntualidadDesc = 'Se evaluará tu puntualidad una vez que registres asistencias.';
                puntualidadIcono = '⏱️';
                puntualidadColor = 'linear-gradient(135deg, #f1f5f9, #e2e8f0)';
            } else if (puntualidadPct === 100) {
                puntualidadTitulo = 'Puntualidad Impecable (100%)';
                puntualidadDesc = '¡Asombroso! No registras ningún atraso en este período. Eres un ejemplo de puntualidad.';
                puntualidadIcono = '🌟';
                puntualidadColor = 'linear-gradient(135deg, #ecfdf5, #a7f3d0)';
            } else if (puntualidadPct >= 90) {
                puntualidadTitulo = 'Puntualidad de Élite';
                puntualidadDesc = `Excelente puntualidad del ${puntualidadPct}% (${stats.diasTrabajados - stats.atrasos} de ${stats.diasTrabajados} días a tiempo).`;
                puntualidadIcono = '🎖️';
                puntualidadColor = 'linear-gradient(135deg, #ecfdf5, #d1fae5)';
            } else if (puntualidadPct >= 75) {
                puntualidadTitulo = 'Buen Ritmo de Entrada';
                puntualidadDesc = `Has mantenido un ${puntualidadPct}% de puntualidad en el periodo. ¡Sigue concentrado!`;
                puntualidadIcono = '👍';
                puntualidadColor = 'linear-gradient(135deg, #eff6ff, #dbeafe)';
            } else {
                puntualidadTitulo = 'Puntualidad por Mejorar';
                puntualidadDesc = `Tienes un ${puntualidadPct}% de puntualidad (${stats.atrasos} atrasos en ${stats.diasTrabajados} días). ¡Llega más temprano!`;
                puntualidadIcono = '⚠️';
                puntualidadColor = 'linear-gradient(135deg, #fff5f5, #fed7d7)';
            }

            logrosHTML += `
                <div class="achievement-card" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); margin-top: 8px;">
                    <div class="achievement-icon" style="font-size: 24px; background: ${puntualidadColor}; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;">
                        ${puntualidadIcono}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 13px; color: #1e293b;">${puntualidadTitulo}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${puntualidadDesc}</div>
                    </div>
                </div>
            `;

            // Logro 3: Campo
            if (stats.minutosCampo > 0) {
                const campoMinsStr = formatMins(stats.minutosCampo);
                logrosHTML += `
                    <div class="achievement-card" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); margin-top: 8px;">
                        <div class="achievement-icon" style="font-size: 24px; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;">
                            🏗️
                        </div>
                        <div style="flex: 1;">
                            <div style="font-weight: 700; font-size: 13px; color: #1e293b;">Héroe de Campo</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Has sumado ${campoMinsStr} trabajando activamente en campo durante este período.</div>
                        </div>
                    </div>
                `;
            }

            // Logro 4: Almuerzo Saludable (basado en almuerzos en planta)
            if (stats.almuerzos > 0) {
                let almTitulo = '';
                let almDesc = '';
                let almIcono = '';
                let almColor = '';
                
                if (stats.almuerzos >= 15) {
                    almTitulo = 'Almuerzo Platinum';
                    almDesc = `¡Espectacular! Has almorzado en planta ${stats.almuerzos} veces en este período, priorizando tu permanencia y bienestar.`;
                    almIcono = '👑';
                    almColor = 'linear-gradient(135deg, #f0fdf4, #bbf7d0)';
                } else if (stats.almuerzos >= 8) {
                    almTitulo = 'Almuerzo de Oro';
                    almDesc = `Muy buen hábito. Has registrado ${stats.almuerzos} almuerzos en la planta durante este período.`;
                    almIcono = '🥗';
                    almColor = 'linear-gradient(135deg, #f0fdf4, #dcfce7)';
                } else {
                    almTitulo = 'Almuerzo de Plata';
                    almDesc = `Has registrado ${stats.almuerzos} almuerzos en la planta. ¡Sigue manteniendo tu constancia!`;
                    almIcono = '🥪';
                    almColor = 'linear-gradient(135deg, #fdf8f6, #fee2e2)';
                }

                logrosHTML += `
                    <div class="achievement-card" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); margin-top: 8px;">
                        <div class="achievement-icon" style="font-size: 24px; background: ${almColor}; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); flex-shrink: 0;">
                            ${almIcono}
                        </div>
                        <div style="flex: 1;">
                            <div style="font-weight: 700; font-size: 13px; color: #1e293b;">${almTitulo}</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${almDesc}</div>
                        </div>
                    </div>
                `;
            }

            const hoy = new Date();
            const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

            const registrosHoy = registrosCompletos.filter(r => {
                const fecha = getVal(r, 'fecha', 0) || r[0];
                if (!fecha) return false;
                let fechaRegistro;
                if (typeof fecha === 'string' && fecha.includes('-')) {
                    fechaRegistro = fecha;
                } else if (fecha instanceof Date) {
                    fechaRegistro = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
                } else {
                    const d = new Date(fecha);
                    if (isNaN(d.getTime())) return false;
                    fechaRegistro = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
                return fechaRegistro === hoyStr;
            });

            const entrada = registrosHoy.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'ENTRADA');
            const salida = registrosHoy.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'SALIDA');

            const entradaHora = entrada ? formatearHora(getVal(entrada, 'timestamp', 2) || getVal(entrada, 'hora', 5) || entrada[2] || entrada[5]) : '--:--';
            const salidaHora = salida ? formatearHora(getVal(salida, 'timestamp', 2) || getVal(salida, 'hora', 5) || salida[2] || salida[5]) : '--:--';
            const almuerzoText = entrada ? (getVal(entrada, 'almuerzo', 4) === 'SI' ? '🍽️ Dentro de planta' : getVal(entrada, 'almuerzo', 4) === 'NO' ? '🏠 Fuera de planta' : '❓ No registrado') : '❓ No registrado';

            mainContent.innerHTML = `
            <div class="page">
                
                <!-- RESUMEN DE PERÍODO (Estadísticas Generales y Horas Unificadas) -->
                <div class="glass-card mt-3">
                    <h5 class="fw-bold mb-3" style="font-size: clamp(14px, 4.5vw, 16px);"><i class="fas fa-chart-bar text-primary"></i> Resumen del Período</h5>
                    
                    <div class="row g-3">
                        <!-- Tarjeta 1: Asistencia y Almuerzos -->
                        <div class="col-12 col-md-4">
                            <div class="stat-card" style="padding: 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03); height: 100%; display: flex; flex-direction: column;">
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; border-bottom: 1.5px solid rgba(226, 232, 240, 0.8); padding-bottom: 10px;">
                                    <div style="font-size: 20px; background: rgba(99, 102, 241, 0.1); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">📅</div>
                                    <div style="font-weight: 750; font-size: clamp(11px, 3.2vw, 13px); color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">Asistencia y Almuerzos</div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 12px; flex-grow: 1; justify-content: center;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600;">Días Trabajados</span>
                                        <span style="font-size: clamp(15px, 4.5vw, 18px); color: #4f46e5; font-weight: 850;">${stats.diasTrabajados}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600;">Almuerzos en Planta</span>
                                        <span style="font-size: clamp(15px, 4.5vw, 18px); color: #0284c7; font-weight: 850;">${stats.almuerzos}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Tarjeta 2: Horas Extras y Campo -->
                        <div class="col-12 col-md-4">
                            <div class="stat-card" style="padding: 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03); height: 100%; display: flex; flex-direction: column;">
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; border-bottom: 1.5px solid rgba(226, 232, 240, 0.8); padding-bottom: 10px;">
                                    <div style="font-size: 20px; background: rgba(245, 158, 11, 0.1); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">⏳</div>
                                    <div style="font-weight: 750; font-size: clamp(11px, 3.2vw, 13px); color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">Horas Extras y Campo</div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 12px; flex-grow: 1; justify-content: center;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600; display: block;">Extras (50%)</span>
                                            <small style="font-size: 9px; color: #94a3b8; font-weight: 500;">(A+C Autorizadas)</small>
                                        </div>
                                        <span style="font-size: clamp(14px, 4.2vw, 16px); color: #d97706; font-weight: 850;">${stats.horas_extras_50}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600; display: block;">Extras (100%)</span>
                                            <small style="font-size: 9px; color: #94a3b8; font-weight: 500;">(B+D Feriado/Sáb/Dom)</small>
                                        </div>
                                        <span style="font-size: clamp(14px, 4.2vw, 16px); color: #dc2626; font-weight: 850;">${stats.horas_extras_100}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600; display: block;">Horas en Campo</span>
                                            <small style="font-size: 9px; color: #94a3b8; font-weight: 500;">(Labores de Campo)</small>
                                        </div>
                                        <span style="font-size: clamp(14px, 4.2vw, 16px); color: #2563eb; font-weight: 850;">${stats.horas_campo}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Tarjeta 3: Puntualidad y Control -->
                        <div class="col-12 col-md-4">
                            <div class="stat-card" style="padding: 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(226, 232, 240, 0.8); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03); height: 100%; display: flex; flex-direction: column;">
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; border-bottom: 1.5px solid rgba(226, 232, 240, 0.8); padding-bottom: 10px;">
                                    <div style="font-size: 20px; background: rgba(239, 68, 68, 0.1); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">⏱️</div>
                                    <div style="font-weight: 750; font-size: clamp(11px, 3.2vw, 13px); color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">Puntualidad y Control</div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 12px; flex-grow: 1; justify-content: center;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600;">Días con Atraso</span>
                                        <span style="font-size: clamp(15px, 4.5vw, 18px); color: #1f2937; font-weight: 850;">${stats.atrasos}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600;">Demoras Acumuladas</span>
                                        <span style="font-size: clamp(13px, 3.8vw, 15px); color: #4b5563; font-weight: 800;">+${stats.minutosAtrasoTotal} min</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: clamp(11px, 3vw, 12px); color: #64748b; font-weight: 600;">Salidas Tempranas</span>
                                        <span style="font-size: clamp(15px, 4.5vw, 18px); color: #10b981; font-weight: 850;">${stats.salidas_tempranas}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- SECCIÓN DE LOGROS -->
                <div class="glass-card mt-3">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h5 class="fw-bold m-0" style="font-size: clamp(14px, 4.5vw, 16px); color: #1e3a8a;"><i class="fas fa-trophy text-warning"></i> Mis Logros</h5>
                        <span style="font-size: 10px; color: #64748b; font-weight: 600;">Actual al: ${obtenerFechaHoraActualFormateada()}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${logrosHTML}
                    </div>
                </div>
                
                <!-- HISTORIAL COMPLETO ORGANIZADO -->
                <div class="glass-card mt-3">
                    <h5 class="fw-bold mb-3" style="font-size: clamp(14px, 4.5vw, 16px);"><i class="fas fa-history"></i> Historial completo</h5>
                    <div id="historialAgrupado"></div>
                </div>
            </div>
            `;

            actualizarHistorialAgrupado();

            if (entrada && !salida) {
                const btnContainer = document.createElement('div');
                btnContainer.className = 'mt-3';
                btnContainer.innerHTML = `
                <button class="btn btn-danger btn-lg w-100" onclick="iniciarRegistro('SALIDA')" style="font-size: clamp(14px, 4.2vw, 16px); padding: clamp(12px, 3.5vw, 14px);">
                    <i class="fas fa-sign-out-alt"></i> REGISTRAR SALIDA
                </button>
            `;
                document.querySelector('.glass-card:first-child')?.appendChild(btnContainer);
            }

            ajustarLayout();
        }

        // ========== HELPER PARA ACCESO SEGURO A DATOS ==========
        function getVal(reg, key, idx) {
            if (!reg) return null;
            return (typeof reg === 'object' && key in reg) ? reg[key] : (Array.isArray(reg) ? reg[idx] : null);
        }

        /**
         * Parsea una fecha de forma segura soportando múltiples formatos
         * (ISO, D/M/YYYY HH:mm:ss, strings con AM/PM, etc.)
         */
        function parseDateSafe(ts) {
            if (!ts) return null;
            if (ts instanceof Date) return ts;

            // Si es un objeto de Firebase (seconds/nanoseconds)
            if (ts && typeof ts.toDate === 'function') return ts.toDate();
            if (ts && ts.seconds) return new Date(ts.seconds * 1000);

            let d = new Date(ts);
            if (!isNaN(d.getTime())) return d;

            // Intentar parsear formatos manuales (ej: 14/5/2026 16:20:25 o con p. m.)
            try {
                let s = String(ts).replace(',', '').trim();
                // Normalizar p. m. / a. m. a PM/AM para que el motor de JS lo entienda mejor si es posible
                s = s.replace(/p\.\s*m\./i, 'PM').replace(/a\.\s*m\./i, 'AM');

                const parts = s.split(' ');
                if (parts.length >= 1) {
                    const dateParts = parts[0].split('/');
                    if (dateParts.length === 3) {
                        const day = parseInt(dateParts[0]);
                        const month = parseInt(dateParts[1]) - 1;
                        const year = parseInt(dateParts[2]);

                        let hour = 0, min = 0, sec = 0;
                        if (parts[1]) {
                            const timeParts = parts[1].split(':');
                            hour = parseInt(timeParts[0]) || 0;
                            min = parseInt(timeParts[1]) || 0;
                            sec = parseInt(timeParts[2]) || 0;

                            // Ajuste manual de PM/AM
                            if (s.toUpperCase().includes('PM')) {
                                if (hour < 12) hour += 12;
                            } else if (s.toUpperCase().includes('AM')) {
                                if (hour === 12) hour = 0;
                            }
                        }

                        d = new Date(year, month, day, hour, min, sec);
                        if (!isNaN(d.getTime())) return d;
                    }
                }
            } catch (e) { console.error("Error parseando fecha manual:", ts, e); }

            return null;
        }

        // Calcular minutos de atraso respecto a HORA_INICIO_ESPERADA (desde configuración)
        function calcularMinutosAtraso(horaEntrada, fechaEntrada) {
            try {
                if (!horaEntrada) return 0;

                // Convertir a Date
                const d = new Date(horaEntrada);
                if (isNaN(d.getTime())) return 0;

                // Obtener hora en minutos desde medianoche
                const horaReal = d.getHours() * 60 + d.getMinutes();

                // Hora esperada desde configuración (ej: "08:00")
                const [horaEsp, minEsp] = HORA_INICIO_ESPERADA.split(':').map(x => parseInt(x));
                const horaEsperada = (horaEsp * 60) + (minEsp || 0);

                // Calcular diferencia (solo positiva para atrasos)
                const diferencia = horaReal - horaEsperada;
                return diferencia > 0 ? diferencia : 0;
            } catch (e) {
                return 0;
            }
        }

        // ========== CALCULAR ESTADÍSTICAS ==========
        function calcularEstadisticas() {
            // Obtener periodo fiscal (26 al 25)
            const hoy = new Date();
            const dia = hoy.getDate();
            let inicioPeriodo, finPeriodo;

            if (dia >= 26) {
                inicioPeriodo = new Date(hoy.getFullYear(), hoy.getMonth(), 26);
                finPeriodo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 25);
            } else {
                inicioPeriodo = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 26);
                finPeriodo = new Date(hoy.getFullYear(), hoy.getMonth(), 25);
            }

            function formatearFechaLocal(d) {
                let y = d.getFullYear();
                let m = String(d.getMonth() + 1).padStart(2, '0');
                let day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            }

            const iniStr = formatearFechaLocal(inicioPeriodo);
            const finStr = formatearFechaLocal(finPeriodo);

            // Filtrar registros por el periodo actual
            const registrosFiltrados = registrosCompletos.filter(r => {
                const f = getVal(r, 'fecha', 0) || r[0];
                return f && f >= iniStr && f <= finStr;
            });

            if (!registrosFiltrados || registrosFiltrados.length === 0) {
                return {
                    diasTrabajados: 0,
                    atrasos: 0,
                    almuerzos: 0,
                    salidas_tempranas: 0,
                    horas_extras_50: '0h 0m',
                    horas_extras_100: '0h 0m',
                    horas_campo: '0h 0m',
                    minutosAtrasoTotal: 0,
                    minutosExtras50: 0,
                    minutosExtras100: 0,
                    minutosCampo: 0
                };
            }

            // Agrupar por día para cálculos más precisos
            const grupos = {};
            registrosFiltrados.forEach(reg => {
                const fecha = getVal(reg, 'fecha', 0) || reg[0];
                if (fecha) {
                    if (!grupos[fecha]) {
                        grupos[fecha] = [];
                    }
                    grupos[fecha].push(reg);
                }
            });

            // Días trabajados (contar días únicos)
            const diasTrabajados = Object.keys(grupos).length;

            let totalExtras50 = 0;
            let totalExtras100 = 0;
            let totalHorasCampo = 0;

            let horasExtra50 = 0;
            let horasExtra100 = 0;
            let horasCampoNormales = 0;
            let horasCampo50 = 0;
            let horasCampo100 = 0;

            let atrasos = 0;
            let minutosAtrasoTotal = 0;
            let almuerzos = 0;
            let salidas_tempranas = 0;

            // Aligned references from supervisor (strictly 450 = 7:30 and 975 = 16:15)
            const H_INI_REF = 450;
            const H_FIN_REF = 975;

            function esFeriadoODomingo(fechaStr) {
                if (!fechaStr) return false;
                const d = new Date(fechaStr + 'T12:00:00');
                if (d.getDay() === 0) return true;
                return esFeriado(fechaStr);
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

            Object.entries(grupos).forEach(([fechaKey, registrosDia]) => {
                const entrada = registrosDia.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'ENTRADA');
                const salida = registrosDia.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'SALIDA');
                const esFestivo = esFeriadoODomingo(fechaKey) || (new Date(fechaKey + 'T12:00:00').getDay() === 6);

                // Calcular atraso automáticamente basado en hora local real (nunca usar timestamp por desfase UTC)
                if (entrada) {
                    const horaEntrada = getVal(entrada, 'hora', 5) || entrada[5];
                    const mEntrada = obtenerMinutos(horaEntrada);
                    if (mEntrada !== null) {
                        const refEntrada = esFestivo ? 420 : H_INI_REF;
                        if (mEntrada > refEntrada) {
                            atrasos++;
                            minutosAtrasoTotal += (mEntrada - refEntrada);
                        }
                    }
                }

                // Contar almuerzos por día (si hay entrada con almuerzo=SI o PLANTA)
                if (entrada && ((getVal(entrada, 'almuerzo', 4) || entrada[4]) === 'SI' || (getVal(entrada, 'almuerzo', 4) || entrada[4]) === 'PLANTA')) {
                    almuerzos++;
                }

                // Contar salidas tempranas por día
                if (registrosDia.some(r => {
                    const val = getVal(r, 'tipo_salida', 21) || r[21];
                    return val && val.toString().includes('SALIDA_TEMPRANA');
                })) {
                    salidas_tempranas++;
                }

                // Procesar periodos del día para horas de trabajo
                let periodosDia = [];
                let entradaPendiente = null;

                let sortedRegs = [...registrosDia].sort((a, b) => {
                    const timeA = getVal(a, 'hora', 5) || a[5];
                    const timeB = getVal(b, 'hora', 5) || b[5];
                    return String(timeA).localeCompare(String(timeB));
                });

                sortedRegs.forEach(r => {
                    const tipo = String(getVal(r, 'tipo', 3) || r[3]).toUpperCase();
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
                periodosDia.forEach(p => {
                    if (!p.entrada || !p.salida) return;
                    let mE = obtenerMinutos(getVal(p.entrada, 'hora', 5) || p.entrada[5]);
                    let mS = obtenerMinutos(getVal(p.salida, 'hora', 5) || p.salida[5]);
                    if (mE === null || mS === null || mS <= mE) return;
                    minutosTrabajadosHoy += (mS - mE);
                });

                let netWorked = minutosTrabajadosHoy;
                if (!esFestivo && netWorked > 240) netWorked -= 45; // Restar descanso

                // Auto-autorización de horas extras
                let autorizado = registrosDia.some(r => getVal(r, 'horasExtra', 13) === 'SI' || r[13] === 'SI');
                if (esFestivo) {
                    if (netWorked > 60) autorizado = true;
                } else {
                    if (netWorked >= 600) autorizado = true;
                }

                let extraMins50Acum = 0;

                periodosDia.forEach(p => {
                    if (!p.entrada || !p.salida) return;
                    let mE = obtenerMinutos(getVal(p.entrada, 'hora', 5) || p.entrada[5]);
                    let mS = obtenerMinutos(getVal(p.salida, 'hora', 5) || p.salida[5]);
                    if (mE === null || mS === null || mS <= mE) return;
                    let duracion = mS - mE;

                    const modoEntrada = getVal(p.entrada, 'modo', 10) || p.entrada[10];
                    const modoSalida = getVal(p.salida, 'modo', 10) || p.salida[10];
                    let enCampo = modoEntrada === 'CAMPO' || modoSalida === 'CAMPO';

                    if (esFestivo) {
                        if (enCampo) {
                            if (autorizado) horasCampo100 += duracion;
                        } else {
                            if (autorizado) horasExtra100 += duracion;
                        }
                    } else {
                        let H_INI = H_INI_REF, H_FIN = H_FIN_REF;
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

                if (!esFestivo) {
                    horasExtra50 += extraMins50Acum;
                }
            });

            totalExtras50 = horasExtra50 + horasCampo50;
            totalExtras100 = horasExtra100 + horasCampo100;
            totalHorasCampo = horasCampoNormales + horasCampo50 + horasCampo100;

            const formatMins = (mins) => {
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                return `${h}h ${m}m`;
            };

            return {
                diasTrabajados: diasTrabajados,
                atrasos: atrasos,
                almuerzos: almuerzos,
                salidas_tempranas: salidas_tempranas,
                horas_extras_50: formatMins(totalExtras50),
                horas_extras_100: formatMins(totalExtras100),
                horas_campo: formatMins(totalHorasCampo),
                minutosAtrasoTotal: minutosAtrasoTotal,
                minutosExtras50: totalExtras50,
                minutosExtras100: totalExtras100,
                minutosCampo: totalHorasCampo
            };
        }

        function generarInsigniasHTMLCompacto(stats) {
            if (!stats) return '';
            const formatMins = (mins) => {
                const h = Math.floor(mins / 60);
                const m = Math.floor(mins % 60);
                return `${h}h ${m}m`;
            };
            let html = '';

            // 1. Asistencia
            let asisIcon = '🥉';
            let asisTitle = 'Sin Asistencia';
            let asisBg = 'linear-gradient(135deg, #f1f5f9, #e2e8f0)';
            let asisBorder = 'rgba(203, 213, 225, 0.4)';
            if (stats.diasTrabajados >= 15) {
                asisIcon = '🏆';
                asisTitle = `Asistencia de Platino: ${stats.diasTrabajados} días`;
                asisBg = 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
                asisBorder = '#94a3b8';
            } else if (stats.diasTrabajados >= 8) {
                asisIcon = '🥇';
                asisTitle = `Asistencia de Oro: ${stats.diasTrabajados} días`;
                asisBg = 'linear-gradient(135deg, #fef3c7, #fde68a)';
                asisBorder = '#fbbf24';
            } else if (stats.diasTrabajados >= 1) {
                asisIcon = '🥈';
                asisTitle = `Asistencia de Plata: ${stats.diasTrabajados} días`;
                asisBg = 'linear-gradient(135deg, #ffedd5, #fed7aa)';
                asisBorder = '#fb923c';
            }

            html += `
                <div class="compact-badge" title="${asisTitle}" style="background: ${asisBg}; border: 2.5px solid ${asisBorder}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; cursor: help;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.08)';">
                    ${asisIcon}
                </div>
            `;

            // 2. Puntualidad
            const puntualidadPct = stats.diasTrabajados > 0 ? Math.max(0, Math.round(((stats.diasTrabajados - stats.atrasos) / stats.diasTrabajados) * 100)) : 100;
            let puntIcon = '⏱️';
            let puntTitle = 'Puntualidad por Evaluar';
            let puntBg = 'linear-gradient(135deg, #f1f5f9, #e2e8f0)';
            let puntBorder = 'rgba(203, 213, 225, 0.4)';
            if (stats.diasTrabajados > 0) {
                if (puntualidadPct === 100) {
                    puntIcon = '🌟';
                    puntTitle = 'Puntualidad Impecable (100%)';
                    puntBg = 'linear-gradient(135deg, #ecfdf5, #a7f3d0)';
                    puntBorder = '#34d399';
                } else if (puntualidadPct >= 90) {
                    puntIcon = '🎖️';
                    puntTitle = `Puntualidad de Élite (${puntualidadPct}%)`;
                    puntBg = 'linear-gradient(135deg, #ecfdf5, #d1fae5)';
                    puntBorder = '#6ee7b7';
                } else if (puntualidadPct >= 75) {
                    puntIcon = '👍';
                    puntTitle = `Buen Ritmo de Entrada (${puntualidadPct}%)`;
                    puntBg = 'linear-gradient(135deg, #eff6ff, #dbeafe)';
                    puntBorder = '#60a5fa';
                } else {
                    puntIcon = '⚠️';
                    puntTitle = `Puntualidad por Mejorar (${puntualidadPct}% - ${stats.atrasos} atrasos)`;
                    puntBg = 'linear-gradient(135deg, #fff5f5, #fed7d7)';
                    puntBorder = '#f87171';
                }
            }

            html += `
                <div class="compact-badge" title="${puntTitle}" style="background: ${puntBg}; border: 2.5px solid ${puntBorder}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; cursor: help;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.08)';">
                    ${puntIcon}
                </div>
            `;

            // 3. Almuerzo
            let almIcon = '🍽️';
            let almTitle = 'Sin almuerzos en planta';
            let almBg = 'linear-gradient(135deg, #f1f5f9, #e2e8f0)';
            let almBorder = 'rgba(203, 213, 225, 0.4)';
            if (stats.almuerzos >= 15) {
                almIcon = '👑';
                almTitle = `Almuerzo Platinum: ${stats.almuerzos} en planta`;
                almBg = 'linear-gradient(135deg, #f0fdf4, #bbf7d0)';
                almBorder = '#4ade80';
            } else if (stats.almuerzos >= 8) {
                almIcon = '🥗';
                almTitle = `Almuerzo de Oro: ${stats.almuerzos} en planta`;
                almBg = 'linear-gradient(135deg, #f0fdf4, #dcfce7)';
                almBorder = '#86efac';
            } else if (stats.almuerzos >= 1) {
                almIcon = '🥪';
                almTitle = `Almuerzo de Plata: ${stats.almuerzos} en planta`;
                almBg = 'linear-gradient(135deg, #fdf8f6, #fee2e2)';
                almBorder = '#fca5a5';
            }

            html += `
                <div class="compact-badge" title="${almTitle}" style="background: ${almBg}; border: 2.5px solid ${almBorder}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; cursor: help;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.08)';">
                    ${almIcon}
                </div>
            `;

            // 4. Labores de Campo
            if (stats.minutosCampo > 0) {
                const campoMinsStr = formatMins(stats.minutosCampo);
                html += `
                    <div class="compact-badge" title="Héroe de Campo: ${campoMinsStr} laboradas" style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border: 2.5px solid #38bdf8; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; cursor: help;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.08)';">
                        🏗️
                    </div>
                `;
            }

            return html;
        }

        function actualizarHistorialAgrupado() {
            const container = document.getElementById('historialAgrupado');
            if (!container) return;

            if (!registrosCompletos || registrosCompletos.length === 0) {
                container.innerHTML = '<p class="text-muted text-center py-3" style="font-size: clamp(12px, 3.8vw, 14px);">No hay registros disponibles</p>';
                return;
            }

            // Agrupar por semana
            const registrosPorSemana = {};
            registrosCompletos.forEach(reg => {
                const fecha = getVal(reg, 'fecha', 0) || reg[0];
                if (!fecha) return;

                const d = new Date(fecha);
                // Corrige la zona horaria para parseos de YYYY-MM-DD cerrados (evitando que ayer = hoy)
                if (typeof fecha === 'string' && fecha.length <= 10) {
                    d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
                }
                const inicio = new Date(d);
                inicio.setDate(d.getDate() - d.getDay()); // Domingo
                const semanaKey = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`;

                if (!registrosPorSemana[semanaKey]) {
                    registrosPorSemana[semanaKey] = { registros: {}, stats: { dias: 0, atrasos: 0, horas: 0, permisos: 0, justificaciones: 0 } };
                }

                if (!registrosPorSemana[semanaKey].registros[fecha]) {
                    registrosPorSemana[semanaKey].registros[fecha] = [];
                }
                registrosPorSemana[semanaKey].registros[fecha].push(reg);
            });

            // Calcular estadísticas por semana
            Object.entries(registrosPorSemana).forEach(([semana, data]) => {
                Object.entries(data.registros).forEach(([fecha, regs]) => {
                    const diaRegs = regs || [];
                    const entrada = diaRegs.find(r => { const t = getVal(r, 'tipo', 3) || r[3]; return t === 'ENTRADA' || t === 'SOLO_ALMUERZO'; });
                    const salida = diaRegs.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'SALIDA');

                    if (entrada || salida) data.stats.dias++;
                    if (diaRegs.some(r => getVal(r, 'razon_entrada_tardia', 19) || r[19])) data.stats.atrasos++;

                    // Separar Permisos de Justificaciones Pasadas
                    const hasPermiso = diaRegs.some(r => {
                        const tipoReg = getVal(r, 'tipo', 3) || r[3];
                        return tipoReg !== 'FALTA' && (getVal(r, 'razon_permiso', 22) || r[22]);
                    });
                    if (hasPermiso) data.stats.permisos++;

                    const hasFalta = diaRegs.some(r => (getVal(r, 'tipo', 3) || r[3]) === 'FALTA');
                    if (hasFalta) data.stats.justificaciones++;

                    if (entrada && salida) {
                        try {
                            const entradaTs = getVal(entrada, 'timestamp', 2) || getVal(entrada, 'hora', 5) || entrada[2] || entrada[5];
                            const salidaTs = getVal(salida, 'timestamp', 2) || getVal(salida, 'hora', 5) || salida[2] || salida[5];

                            const dEntrada = parseDateSafe(entradaTs);
                            const dSalida = parseDateSafe(salidaTs);

                            if (dEntrada && dSalida) {
                                let horasBrutas = (dSalida - dEntrada) / (1000 * 60 * 60);
                                // Restar 45 min (0.75 h)
                                let horasNetas = Math.max(0, horasBrutas - 0.75);
                                data.stats.horas += horasNetas;
                            }
                        } catch (e) { }
                    }
                });
            });

            const semanasOrdenadas = Object.keys(registrosPorSemana).sort((a, b) => new Date(b) - new Date(a));

            let html = `<div style="display: flex; flex-direction: column; gap: 12px;">`;

            semanasOrdenadas.forEach(semanaKey => {
                const semanaData = registrosPorSemana[semanaKey];
                const fechasEnSemana = Object.keys(semanaData.registros).sort((a, b) => new Date(b) - new Date(a));

                let semanaLabel = 'Semana sin fecha';
                try {
                    const inicioDia = new Date(semanaKey);
                    inicioDia.setMinutes(inicioDia.getMinutes() + inicioDia.getTimezoneOffset());
                    const finDia = new Date(inicioDia);
                    finDia.setDate(finDia.getDate() + 6);

                    if (!isNaN(inicioDia.getTime()) && !isNaN(finDia.getTime())) {
                        semanaLabel = `${inicioDia.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' })} al ${finDia.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' })}`;
                    }
                } catch (e) {
                    console.error('Error parsing week date:', semanaKey, e);
                }

                // Build dias HTML outside template string
                let diasHTML = '';
                fechasEnSemana.forEach(fecha => {
                    const diaRegs = semanaData.registros[fecha];
                    const entrada = diaRegs.find(r => { const t = getVal(r, 'tipo', 3) || r[3]; return t === 'ENTRADA' || t === 'SOLO_ALMUERZO'; });
                    const salida = diaRegs.find(r => (getVal(r, 'tipo', 3) || r[3]) === 'SALIDA');

                    // Calcular atraso automáticamente si hay entrada
                    let minutosAtrasoDelDia = 0;
                    if (entrada) {
                        const horaEntrada = getVal(entrada, 'timestamp', 2) || getVal(entrada, 'hora', 5) || entrada[2] || entrada[5];
                        minutosAtrasoDelDia = calcularMinutosAtraso(horaEntrada, fecha);
                    }

                    const hasAtraso = minutosAtrasoDelDia > 0;
                    const hasPermiso = diaRegs.some(r => getVal(r, 'razon_permiso', 22) || r[22]);
                    const hasSalidaTemprana = diaRegs.some(r => {
                        const val = getVal(r, 'tipo_salida', 21) || r[21];
                        return val && val.toString().includes('SALIDA_TEMPRANA');
                    });

                    let duracion = '--';
                    if (entrada && salida) {
                        try {
                            const entradaTs = getVal(entrada, 'timestamp', 2) || getVal(entrada, 'hora', 5) || entrada[2] || entrada[5];
                            const salidaTs = getVal(salida, 'timestamp', 2) || getVal(salida, 'hora', 5) || salida[2] || salida[5];

                            const dE = parseDateSafe(entradaTs);
                            const dS = parseDateSafe(salidaTs);

                            if (dE && dS) {
                                let msBrutos = dS - dE;
                                // Restar 45 min = 45 * 60 * 1000 ms
                                let msNetos = Math.max(0, msBrutos - (45 * 60 * 1000));

                                if (msNetos > 0) {
                                    const h = Math.floor(msNetos / (1000 * 60 * 60));
                                    const m = Math.floor((msNetos % (1000 * 60 * 60)) / (1000 * 60));
                                    duracion = h + 'h ' + m + 'm';
                                } else {
                                    duracion = '0h 0m';
                                }
                            }
                        } catch (e) { }
                    }

                    const esFaltaJustificada = diaRegs.some(r => (getVal(r, 'tipo', 3) || r[3]) === 'FALTA');
                    const statusIcon = esFaltaJustificada ? '📁' : (entrada && salida ? '✅' : entrada ? '⚠️' : '❌');
                    let fechaFormato = 'Fecha inválida';
                    try {
                        const fechaObj = new Date(fecha);
                        if (typeof fecha === 'string' && fecha.length <= 10) {
                            fechaObj.setMinutes(fechaObj.getMinutes() + fechaObj.getTimezoneOffset());
                        }
                        if (!isNaN(fechaObj.getTime())) {
                            fechaFormato = fechaObj.toLocaleDateString('es-EC', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
                        }
                    } catch (e) { }

                    const entradaHora = esFaltaJustificada ? 'JUSTIFICADO' : (entrada ? formatearHora(getVal(entrada, 'timestamp', 2) || getVal(entrada, 'hora', 5) || entrada[2] || entrada[5]) : '--:--');
                    const salidaHora = esFaltaJustificada ? 'N/A' : (salida ? formatearHora(getVal(salida, 'timestamp', 2) || getVal(salida, 'hora', 5) || salida[2] || salida[5]) : '--:--');
                    const almuerzoVal = entrada ? (getVal(entrada, 'almuerzo', 4) || entrada[4]) : '';
                    const almuerzoIcon = (almuerzoVal === 'SI' || almuerzoVal === 'PLANTA') ? '🏢' : (almuerzoVal === 'NO' || almuerzoVal === 'FUERA') ? '🏠' : '-';

                    const detallesRazones = diaRegs.map(reg => {
                        const razonAtraso = getVal(reg, 'razon_entrada_tardia', 19) || reg[19];
                        const razonSalida = getVal(reg, 'razon_salida', 17) || reg[17];
                        const razonPermiso = getVal(reg, 'razon_permiso', 22) || reg[22];
                        const razonAusencia = getVal(reg, 'razon_ausencia', 23) || reg[23];
                        const tipoReg = getVal(reg, 'tipo', 3) || reg[3];

                        if (tipoReg === 'FALTA') {
                            return '<div style="padding: 6px 10px; background: rgba(255,152,0,0.1); border-left: 3px solid #ff9800; border-radius: 4px; font-size: clamp(9px, 2.8vw, 11px); color: #e65100;"><strong>📌 Justificación:</strong> ' + (razonAusencia || razonPermiso || 'Falta revisada') + '</div>';
                        }

                        if (razonAtraso) {
                            const minutosTexto = minutosAtrasoDelDia > 0 ? ` <strong style="color: #d32f2f;">+${minutosAtrasoDelDia}m</strong>` : '';
                            return '<div style="padding: 6px 10px; background: rgba(244,67,54,0.1); border-left: 3px solid #f44336; border-radius: 4px; font-size: clamp(9px, 2.8vw, 11px); color: #c62828;"><strong>🔴 Atraso:</strong> ' + razonAtraso + minutosTexto + '</div>';
                        }
                        if (razonSalida) return '<div style="padding: 6px 10px; background: rgba(33,150,243,0.1); border-left: 3px solid #2196f3; border-radius: 4px; font-size: clamp(9px, 2.8vw, 11px); color: #1565c0;"><strong>⏱️ Salida temp:</strong> ' + razonSalida + '</div>';
                        if (razonPermiso) return '<div style="padding: 6px 10px; background: rgba(76,175,80,0.1); border-left: 3px solid #4caf50; border-radius: 4px; font-size: clamp(9px, 2.8vw, 11px); color: #2e7d32;"><strong>🔑 Permiso:</strong> ' + razonPermiso + '</div>';
                        return '';
                    }).join('');

                    diasHTML += `
                    <div class="dia-item" style="padding: clamp(12px, 3.5vw, 14px); border-bottom: 1px solid #f0f0f0; background: ${hasAtraso || hasSalidaTemprana ? 'rgba(255,193,7,0.05)' : 'white'};">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px;">
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: clamp(12px, 3.5vw, 14px); display: flex; align-items: center; gap: 6px;">
                                    ${statusIcon} ${fechaFormato}
                                </div>
                                <div style="font-size: clamp(10px, 3vw, 12px); color: #666; margin-top: 4px;">
                                    ⏰ ${entradaHora} → ${salidaHora} <span style="font-weight: 600; color: #333;">${duracion}</span>
                                </div>
                            </div>
                            <div style="text-align: right; font-size: clamp(9px, 2.8vw, 11px);">
                                ${almuerzoIcon}
                            </div>
                        </div>
                        ${detallesRazones ? `<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;">${detallesRazones}</div>` : ''}
                    </div>
                `;
                });

                html += `
                <div class="semana-container" style="border-radius: clamp(12px, 4vw, 16px); border: 1px solid #e0e0e0; overflow: hidden;">
                    <div class="semana-header" onclick="toggleSemana(this)" style="padding: clamp(12px, 3.5vw, 14px); background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 600;">
                        <div>
                            <div style="font-size: clamp(12px, 3.5vw, 14px);">📅 ${semanaLabel}</div>
                            <div style="font-size: clamp(10px, 3vw, 12px); opacity: 0.9; margin-top: 4px;">
                                ${semanaData.stats.dias} días • ${semanaData.stats.atrasos} atrasos • ${semanaData.stats.justificaciones} justif. • ${semanaData.stats.horas.toFixed(1)}h
                            </div>
                        </div>
                        <i class="fas fa-chevron-down" style="transition: transform 0.3s;"></i>
                    </div>
                    
                    <div class="semana-content" style="padding: 0; display: none;">
                        ${diasHTML}
                    </div>
                </div>
            `;
            });

            html += `</div>`;
            container.innerHTML = html;
        }

        function toggleSemana(element) {
            const content = element.nextElementSibling;
            const icon = element.querySelector('i');

            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.style.transform = 'rotate(180deg)';
            } else {
                content.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
            }
        }

        function calcularDuracion(entrada, salida) {
            try {
                const entradaDate = new Date(entrada);
                const salidaDate = new Date(salida);
                if (isNaN(entradaDate) || isNaN(salidaDate)) return '--';
                const diffMs = salidaDate - entradaDate;
                const diffHoras = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMinutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                return `${diffHoras}h ${diffMinutos}min`;
            } catch {
                return '--';
            }
        }
        function renderProfilePage() {
            const mainContent = document.getElementById('mainContent');
            const totalDias = new Set(registrosCompletos.map(r => r.fecha)).size;
            const totalEntradas = registrosCompletos.filter(r => r.tipo === 'ENTRADA').length;
            const totalSalidas = registrosCompletos.filter(r => r.tipo === 'SALIDA').length;

            const mesActual = new Date().getMonth();
            const añoActual = new Date().getFullYear();
            const registrosMes = registrosCompletos.filter(r => {
                if (!r.fecha) return false;
                const fecha = new Date(r.fecha);
                return fecha.getMonth() === mesActual && fecha.getFullYear() === añoActual;
            });
            const diasTrabajadosMes = new Set(registrosMes.map(r => r.fecha)).size;

            mainContent.innerHTML = `
            <div class="page" style="padding-bottom: 30px; animation: fadeIn 0.35s ease;">
                <!-- Tarjeta Principal de Perfil Premium -->
                <div class="glass-card text-center" style="background: linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.85) 100%); border-radius: 24px; padding: 30px 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.06); border: 1px solid rgba(255, 255, 255, 0.7); position: relative; overflow: hidden;">
                    <!-- Decoración estética de fondo -->
                    <div style="position: absolute; top: -50px; right: -50px; width: 120px; height: 120px; background: radial-gradient(circle, rgba(220,38,38,0.08) 0%, transparent 70%); pointer-events: none;"></div>
                    
                    <div class="photo-container-premium d-inline-block" onclick="showPhotoModal('${empleado.foto_url || ''}')" style="position: relative; border-radius: 50%; padding: 4px; background: linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%); box-shadow: 0 10px 28px rgba(220,38,38,0.2); cursor: pointer; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); display: inline-block;">
                        ${empleado.foto_url && empleado.foto_url.trim() ?
                            `<img class="employee-photo-profesional" src="${empleado.foto_url}" alt="Foto" style="border-radius: 50%; width: 110px; height: 110px; object-fit: cover; border: 4px solid white;">` :
                            `<div class="employee-photo-placeholder-profesional" style="border-radius: 50%; width: 110px; height: 110px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%); font-size: 40px; border: 4px solid white; color: #475569;">👤</div>`
                        }
                    </div>
                    
                    <h3 class="fw-bold mt-3 mb-1" style="font-size: 22px; color: #0f172a; letter-spacing: -0.5px;">${empleado.nombre || 'Empleado'}</h3>
                    <p class="text-primary fw-bold mb-0" style="font-size: 14px; color: var(--primary); letter-spacing: 0.8px; text-transform: uppercase;">${empleado.cargo || 'Sin Cargo'}</p>
                    <p class="text-muted small mb-2" style="font-size: 12px; font-weight: 500; background: rgba(100,116,139,0.06); display: inline-block; padding: 3px 12px; border-radius: 20px; margin-top: 5px;">Área: ${empleado.area || 'Área'}</p>
                    
                    <div class="d-flex justify-content-center gap-2 mt-2 flex-wrap">
                        <span class="badge" style="background: rgba(15, 23, 42, 0.05); color: #1e293b; font-size: 11.5px; padding: 6px 12px; border-radius: 8px; font-weight: 600; border: 1px solid rgba(15,23,42,0.05);"><i class="fas fa-id-card me-1" style="color: #64748b;"></i> ID: ${empleado.id || '-'}</span>
                        ${estado.esSupervisor ? '<span class="badge" style="background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(37,99,235,0.15)); color: #1d4ed8; font-size: 11.5px; padding: 6px 12px; border-radius: 8px; font-weight: 700; border: 1px solid rgba(37,99,235,0.1);"><i class="fas fa-crown me-1" style="color: #3b82f6;"></i> Supervisor</span>' : ''}
                    </div>

                    <!-- Estadísticas de Asistencia Recientes -->
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 24px; padding-top: 20px; border-top: 1px dashed rgba(148,163,184,0.3);">
                        <div style="text-align: center; background: rgba(22,163,74,0.04); padding: 10px 5px; border-radius: 12px; border: 1px solid rgba(22,163,74,0.06);">
                            <div style="font-size: 20px; font-weight: 800; color: #16a34a; line-height: 1;">${totalEntradas}</div>
                            <div style="font-size: 9.5px; color: #16a34a; font-weight: 700; text-transform: uppercase; margin-top: 6px; letter-spacing: 0.3px;">Entradas</div>
                        </div>
                        <div style="text-align: center; background: rgba(59,130,246,0.04); padding: 10px 5px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.06);">
                            <div style="font-size: 20px; font-weight: 800; color: #2563eb; line-height: 1;">${diasTrabajadosMes}</div>
                            <div style="font-size: 9.5px; color: #2563eb; font-weight: 700; text-transform: uppercase; margin-top: 6px; letter-spacing: 0.3px;">Días (Mes)</div>
                        </div>
                        <div style="text-align: center; background: rgba(220,38,38,0.04); padding: 10px 5px; border-radius: 12px; border: 1px solid rgba(220,38,38,0.06);">
                            <div style="font-size: 20px; font-weight: 800; color: #dc2626; line-height: 1;">${totalSalidas}</div>
                            <div style="font-size: 9.5px; color: #dc2626; font-weight: 700; text-transform: uppercase; margin-top: 6px; letter-spacing: 0.3px;">Salidas</div>
                        </div>
                    </div>
                </div>
                
                <!-- Tarjeta de Información del Dispositivo -->
                <div class="glass-card mt-3" style="padding: 20px 18px; border-radius: 20px; background: rgba(255,255,255,0.85); box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(255,255,255,0.7);">
                    <h5 class="fw-bold mb-3" style="font-size: 14.5px; color: #1e293b; display: flex; align-items: center; gap: 8px; letter-spacing: -0.2px;"><i class="fas fa-shield-alt" style="color: #64748b;"></i> Seguridad y Conectividad</h5>
                    
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(248,250,252,0.8); padding: 10px 14px; border-radius: 10px; border: 1px solid #f1f5f9; box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);">
                            <span style="font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fas fa-fingerprint me-1"></i> TOKEN:</span>
                            <span class="font-monospace" style="font-size: 11px; color: #334155; font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">${deviceToken || '--'}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(248,250,252,0.8); padding: 10px 14px; border-radius: 10px; border: 1px solid #f1f5f9; box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);">
                            <span style="font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fas fa-location-crosshairs me-1"></i> GPS:</span>
                            <span style="font-size: 11px; color: #334155; font-weight: 700;">${gpsActivo && posicion.lat ? `<i class="fas fa-circle text-success me-1" style="font-size: 8px;"></i> ${posicion.lat.toFixed(6)}, ${posicion.lng.toFixed(6)}` : '<span style="color:#ef4444;"><i class="fas fa-triangle-exclamation me-1"></i> No disponible</span>'}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Tarjeta de Acciones / Ajustes -->
                <div class="glass-card mt-3" style="padding: 20px 18px; border-radius: 20px; background: rgba(255,255,255,0.85); box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(255,255,255,0.7);">
                    <h5 class="fw-bold mb-3" style="font-size: 14.5px; color: #1e293b; display: flex; align-items: center; gap: 8px; letter-spacing: -0.2px;"><i class="fas fa-sliders" style="color: #64748b;"></i> Acciones y Soporte</h5>
                    
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button class="btn btn-outline-secondary w-100" onclick="location.reload()" style="font-size: 13.5px; padding: 12px 14px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; transition: all 0.2s; border-color: #cbd5e1; color: #334155; background: white;">
                            <i class="fas fa-arrows-rotate" style="color: #64748b;"></i> Sincronizar Datos
                        </button>
                        <button class="btn btn-outline-primary w-100" onclick="verificarDistanciaEmpresa()" style="font-size: 13.5px; padding: 12px 14px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; transition: all 0.2s; border-color: rgba(59,130,246,0.5); color: #2563eb; background: rgba(59,130,246,0.02);">
                            <i class="fas fa-location-dot" style="color: #3b82f6;"></i> Probar Rango de Ubicación
                        </button>
                        <button class="btn btn-outline-danger w-100" onclick="cerrarSesion()" style="font-size: 13.5px; padding: 12px 14px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; transition: all 0.2s; border-color: #fca5a5; background: #fff5f5; color: #dc2626;">
                            <i class="fas fa-right-from-bracket"></i> Cerrar Sesión en Dispositivo
                        </button>
                    </div>
                </div>
                
                <div class="text-center text-muted small py-4" style="font-size: 11.5px; font-weight: 500; opacity: 0.7;">
                    <i class="fas fa-shield-halved"></i> CONTROL 2026 v2.0
                </div>
            </div>
            `;

            ajustarLayout();
        }

        // ========== CERRAR SESIÓN ==========
        async function cerrarSesion() {
            if (confirm('¿Cerrar sesión? Se eliminará el acceso de este dispositivo.')) {
                showLoading(true);
                if (empleado.id && deviceToken) {
                    try {
                        await desvincularDispositivoAPI(empleado.id, deviceToken);
                    } catch (e) { }
                }
                localStorage.clear();
                isAuthenticated = false;
                showLoading(false);
                location.reload();
            }
        }

        // ========== NAVEGACIÓN ==========
        function navigateTo(page) {
            currentPage = page;

            document.querySelectorAll('.nav-item').forEach(item => {
                if (item.dataset.page === page) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            const fabWhatsApp = document.getElementById('fabWhatsApp');
            if (fabWhatsApp) {
                fabWhatsApp.style.display = (page === 'home' && isAuthenticated) ? 'flex' : 'none';
            }

            if (page === 'home') {
                renderHomePage();
            } else if (page === 'history') {
                renderHistoryPage();
            } else if (page === 'extras') {
                renderHorasExtrasPage();
            } else if (page === 'profile') {
                renderProfilePage();
            } else if (page === 'admin') {
                renderAdminPage();
            }

            ajustarLayout();
        }

        function renderAdminPage() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page">
                <div class="glass-card mb-4 text-center">
                    <div class="admin-icon mb-2">
                        <i class="fas fa-user-shield" style="font-size: 40px; color: var(--primary);"></i>
                    </div>
                    <h3 class="fw-bold mb-1">Panel Master</h3>
                    <p class="text-muted small">Acceso centralizado a todos los módulos</p>
                </div>

                <div class="row g-3">
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('supervisor.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-chart-line text-primary" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Supervisor</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('catering.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-utensils text-success" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Catering</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('guardia.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-shield-alt text-danger" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Guardia</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('admin_config.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-cog text-secondary" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Configuración</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('diagnostico.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-tools text-warning" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Diagnóstico</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="glass-card text-center p-3 h-100" onclick="window.open('ubicacion.html', '_blank')" style="cursor: pointer;">
                            <div class="mb-2"><i class="fas fa-map-marked-alt text-info" style="font-size: 24px;"></i></div>
                            <div class="fw-bold small">Ubicación</div>
                        </div>
                    </div>
                </div>

                <div class="mt-4 text-center">
                    <small class="text-muted">Este panel es visible únicamente para el administrador del sistema.</small>
                </div>
            </div>
            `;
        }

        // ========== VERIFICACIÓN INICIAL (OPTIMIZADA - CARGA EN PARALELO) ==========
        async function verificarEstadoInicial() {
            // Ocultar splash rápido: no esperar peticiones de red
            setTimeout(hideSplash, 800);

            // Inicializar token y GPS inmediatamente (no bloquean)
            deviceToken = generarDeviceToken();
            iniciarGPS();

            const distanceIndicator = document.createElement('div');
            distanceIndicator.id = 'distanceIndicator';
            distanceIndicator.className = 'distance-indicator hidden';
            document.body.appendChild(distanceIndicator);

            const sessionData = localStorage.getItem('SESSION_DATA');
            if (sessionData) {
                try {
                    const data = JSON.parse(sessionData);
                    if (data.empleadoId && data.token === deviceToken) {
                        showLoading(true);

                        // ✨ PARALELO: config + estado + registros al mismo tiempo
                        const [configRes, estadoRes, registros] = await Promise.all([
                            cargarConfiguracionesSistema().catch(() => null),
                            obtenerEstado(data.empleadoId, null).catch(e => ({ error: e.message })),
                            obtenerRegistrosEmpleadoAPI(data.empleadoId).catch(() => [])
                        ]);

                        showLoading(false);

                        if (estadoRes && !estadoRes.error) {
                            const hoyStr = new Date().toISOString().split('T')[0];
                            const listaRegistros = Array.isArray(registros) ? registros : [];
                            if (registros && registros.error) {
                                console.error('Error al recuperar registros iniciales:', registros.error);
                            }
                            const registroHoy = listaRegistros.filter(r => r.fecha === hoyStr);
                            const entradaHoy = registroHoy.find(r => r.tipo === 'ENTRADA');
                            const salidaHoy = registroHoy.find(r => r.tipo === 'SALIDA');

                            estado = {
                                tieneEntrada: estadoRes.tieneEntrada || false,
                                tieneSalida: estadoRes.tieneSalida || false,
                                horaEntrada: entradaHoy ? formatearHora(entradaHoy.timestamp || entradaHoy.hora) : (estadoRes.horaEntrada || null),
                                horaSalida: salidaHoy ? formatearHora(salidaHoy.timestamp || salidaHoy.hora) : (estadoRes.horaSalida || null),
                                almuerzo: estadoRes.almuerzo || null,
                                esSupervisor: estadoRes.esSupervisor || false
                            };

                            empleado = {
                                id: estadoRes.id,
                                nombre: estadoRes.nombre,
                                area: estadoRes.area,
                                foto_url: estadoRes.foto_url,
                                cargo: estadoRes.cargo || '',
                                fechaNacimiento: estadoRes.fechaNacimiento || '',
                                baseLat: estadoRes.baseLat || null,
                                baseLng: estadoRes.baseLng || null,
                                authExtras: estadoRes.authExtras || 'NO',
                                tipoRegistro: '',
                                almuerzo: ''
                            };

                            actualizarInterfazSegunCargo();
                            registrosCompletos = listaRegistros;
                            isAuthenticated = true;

                            if (esCumpleanos(empleado.fechaNacimiento)) {
                                setTimeout(celebrarCumpleanos, 1000);
                            }

                            const faltas = obtenerDiasFaltantes();
                            if (faltas.length > 0) {
                                mostrarModalFaltasPasadas(faltas);
                            } else {
                                renderHomePage();
                            }

                            // Cargar configuraciones en segundo plano (no bloquea la UI)
                            if (!configRes) {
                                cargarConfiguracionesSistema().catch(() => { });
                            }
                            return;
                        }
                    }
                } catch (e) {
                    console.error('Error cargando sesión:', e);
                    showLoading(false);
                }
            } else {
                // Sin sesión: cargar configuración en segundo plano
                cargarConfiguracionesSistema().catch(() => { });
            }

            isAuthenticated = false;
            renderAuthScreen();
        }

        // ========== INICIALIZACIÓN ==========
        // ========== CÁLCULOS Y FUNCIONES COODINADOR ==========

        function actualizarInterfazSegunCargo() {
            const navItemExtras = document.getElementById('navItemExtras');
            const navItemAdmin = document.getElementById('navItemAdmin');
            if (!navItemExtras) return;

            const cargoActual = empleado.cargo || '';
            console.log('Verificando cargo:', cargoActual);

            // Normalizar: quitar tildes, pasar a minúsculas y quitar espacios extra
            const cargoNormalizado = cargoActual.toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim();

            console.log('Cargo normalizado:', cargoNormalizado);

            // Búsqueda más flexible: Coordinador/Jefe/Supervisor de Producción/Taller o Asistente de Producción
            const esCoordinador = (
                (
                    cargoNormalizado.includes('produccion') ||
                    cargoNormalizado.includes('taller')
                ) && (
                    cargoNormalizado.includes('coordinador') ||
                    cargoNormalizado.includes('coodinador') ||
                    cargoNormalizado.includes('jefe') ||
                    cargoNormalizado.includes('supervisor')
                )
            ) || (
                cargoNormalizado.includes('asistente') && cargoNormalizado.includes('produccion')
            );

            console.log('¿Acceso a pestaña Extras?:', esCoordinador);

            if (esCoordinador) {
                navItemExtras.style.display = 'flex';
            } else {
                navItemExtras.style.display = 'none';
            }

            // Lógica para el botón Admin (Solo para el ADMIN_ID)
            if (navItemAdmin) {
                const esAdmin = empleado.id === ADMIN_ID;
                navItemAdmin.style.display = esAdmin ? 'flex' : 'none';
            }

            // Forzar ajuste de layout si cambió la visibilidad
            ajustarLayout();
        }



        let tallerEmpleadosCache = [];

        async function renderHorasExtrasPage() {
            const mainContent = document.getElementById('mainContent');
            mainContent.innerHTML = `
            <div class="page" style="padding-top: 0;">
                <div class="glass-card" style="position: sticky; top: -16px; z-index: 100; margin-bottom: 16px; padding: 16px; border-radius: 0 0 16px 16px; border-top: none; margin-left: -16px; margin-right: -16px; margin-top: -16px; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.06); border-bottom: 1px solid rgba(226, 232, 240, 0.8);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h3 class="fw-bold mb-0" style="font-size: 20px; color: #1e293b;">Autorización Extras</h3>
                            <p class="text-muted small mb-0" style="font-size: 11px; font-weight: 500;">Área TALLER / PRODUCCIÓN</p>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-primary btn-sm" onclick="toggleTodosFiltrados(true)" style="border-radius: 8px; padding: 6px 12px; font-size: 11px; font-weight:600; background-color: var(--primary); border: none; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                                <i class="fas fa-check-double me-1"></i> Autorizar Filtrados
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="toggleTodosFiltrados(false)" style="border-radius: 8px; padding: 6px 12px; font-size: 11px; font-weight:600; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                                <i class="fas fa-times me-1"></i> Quitar Filtrados
                            </button>
                        </div>
                    </div>
                    <div class="row g-2">
                        <div class="col-6">
                            <input type="text" id="buscarExtras" class="form-input" placeholder="🔍 Buscar por nombre o ID..." oninput="aplicarFiltrosExtras()" style="border-radius: 8px; font-size: 12.5px; padding: 8px 12px; width: 100%; border: 1px solid #cbd5e1; background: #ffffff;">
                        </div>
                        <div class="col-6">
                            <select id="filtroCargoExtras" class="form-select" onchange="aplicarFiltrosExtras()" style="border-radius: 8px; font-size: 12.5px; padding: 8px 12px; width: 100%; border: 1px solid #cbd5e1; background: #ffffff; height: 37px;">
                                <option value="TODOS">-- Todos los Cargos --</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div id="listaTaller" class="mt-2" style="display: flex; flex-direction: column; gap: 10px; padding: 0 4px 24px 4px;">
                    <div class="text-center py-5">
                        <div class="spinner-border text-primary" role="status"></div>
                        <p class="mt-2 text-muted">Cargando personal...</p>
                    </div>
                </div>
            </div>
        `;

            await cargarEmpleadosTaller();
            ajustarLayout();
        }

        async function cargarEmpleadosTaller() {
            try {
                const res = await jsonpRequest({ accion: 'obtenerEmpleadosTaller' });
                const container = document.getElementById('listaTaller');

                if (res.error) {
                    container.innerHTML = `<div class="alert alert-danger">${res.error}</div>`;
                    return;
                }

                if (!res.empleados || res.empleados.length === 0) {
                    container.innerHTML = `<div class="text-center py-5 text-muted"><i class="fas fa-users-slash fs-1 d-block mb-3"></i>No hay personal activo en Taller</div>`;
                    return;
                }

                tallerEmpleadosCache = res.empleados.sort((a, b) => a.nombre.localeCompare(b.nombre));

                // Populate filter select
                const selectCargo = document.getElementById('filtroCargoExtras');
                if (selectCargo) {
                    const cargos = [...new Set(tallerEmpleadosCache.map(p => p.cargo || 'OPERARIO'))].sort();
                    selectCargo.innerHTML = `<option value="TODOS">-- Todos los Cargos (${tallerEmpleadosCache.length}) --</option>` +
                        cargos.map(c => `<option value="${c}">${c} (${tallerEmpleadosCache.filter(p => (p.cargo || 'OPERARIO') === c).length})</option>`).join('');
                }

                dibujarEmpleadosTaller(tallerEmpleadosCache);
            } catch (e) {
                mostrarToast('Error al cargar personal: ' + e.message, 'error');
            }
        }

        window.dibujarEmpleadosTaller = function(lista) {
            const container = document.getElementById('listaTaller');
            const selectCargo = document.getElementById('filtroCargoExtras');
            const cargoFiltro = selectCargo ? selectCargo.value : 'TODOS';
            const buscador = document.getElementById('buscarExtras');
            const busqueda = buscador ? buscador.value.toLowerCase().trim() : '';

            const filtrados = lista.filter(per => {
                const cumpleCargo = (cargoFiltro === 'TODOS') || ((per.cargo || 'OPERARIO') === cargoFiltro);
                const cumpleBusqueda = !busqueda || 
                                       (per.nombre || '').toLowerCase().includes(busqueda) || 
                                       (per.id || '').toString().includes(busqueda);
                return cumpleCargo && cumpleBusqueda;
            });

            if (filtrados.length === 0) {
                container.innerHTML = `<div class="text-center py-4 text-muted"><i class="fas fa-user-slash d-block mb-2"></i>No hay personal que coincida</div>`;
                return;
            }

            let html = '';
            filtrados.forEach(per => {
                const isChecked = per.authExtras === 'SI';
                const isCampo = per.ubicacion === 'CAMPO';
                
                // Normalizar URL en frontend por seguridad si viniera sin normalizar
                const fotoUrlNormalizada = (per.foto_url && per.foto_url.trim()) ? 
                    (per.foto_url.includes('drive.google.com') && !per.foto_url.includes('thumbnail') ? 
                        `https://drive.google.com/thumbnail?id=${per.foto_url.includes('/file/d/') ? per.foto_url.split('/file/d/')[1].split('/')[0] : per.foto_url.split('id=')[1].split('&')[0]}&sz=w200` : 
                        per.foto_url) : 
                    '';

                const photoHTML = fotoUrlNormalizada ?
                    `<img class="taller-photo" src="${fotoUrlNormalizada}" alt="Foto" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">` :
                    `<div class="taller-photo-placeholder" style="width: 44px; height: 44px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid #e2e8f0; color: #94a3b8;">👤</div>`;

                // Toda la tarjeta es clickeable para activar/desactivar de manera simplificada
                html += `
                <div class="taller-item glass-card" 
                     onclick="${isCampo ? '' : `toggleCardAutorizacion(this, '${per.id}')`}" 
                     style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.4); box-shadow: 0 4px 6px rgba(0,0,0,0.02); transition: all 0.2s; cursor: ${isCampo ? 'default' : 'pointer'}; ${isCampo ? 'border-left: 4px solid #3b82f6; background: rgba(59, 130, 246, 0.04);' : ''}">
                    <div style="display: flex; align-items: center; gap: 12px; pointer-events: none;">
                        ${photoHTML}
                        <div class="taller-info">
                            <h4 style="margin: 0; font-size: 13.5px; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 6px;">
                                ${per.nombre} 
                                ${isCampo ? '<span class="badge bg-primary" style="font-size: 9px; padding: 2px 6px; border-radius: 4px;">CAMPO</span>' : ''}
                            </h4>
                            <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b; font-weight: 500;">
                                ID: ${per.id} • <span style="color: var(--primary); font-weight: 600;">${per.cargo || 'OPERARIO'}</span>
                            </p>
                        </div>
                    </div>
                    <label class="switch-container" style="margin: 0;" onclick="event.stopPropagation();">
                        <input type="checkbox" id="chk-${per.id}" ${isCampo || isChecked ? 'checked' : ''} ${isCampo ? 'disabled' : ''} onchange="toggleAutorizacionExtraLocal('${per.id}', this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            `;
            });
            container.innerHTML = html;
        };

        window.toggleCardAutorizacion = function(element, empleadoId) {
            const chk = document.getElementById(`chk-${empleadoId}`);
            if (chk && !chk.disabled) {
                chk.checked = !chk.checked;
                toggleAutorizacionExtraLocal(empleadoId, chk.checked);
            }
        };

        window.aplicarFiltrosExtras = function() {
            dibujarEmpleadosTaller(tallerEmpleadosCache);
        };

        window.toggleAutorizacionExtraLocal = async function(empleadoId, autorizado) {
            const emp = tallerEmpleadosCache.find(p => p.id === empleadoId);
            if (emp) {
                emp.authExtras = autorizado ? 'SI' : 'NO';
            }
            await toggleAutorizacionExtra(empleadoId, autorizado);
        };

        window.toggleTodosFiltrados = async function(autorizado) {
            const selectCargo = document.getElementById('filtroCargoExtras');
            const cargo = selectCargo ? selectCargo.value : 'TODOS';
            const buscador = document.getElementById('buscarExtras');
            const busqueda = buscador ? buscador.value.toLowerCase().trim() : '';

            const filtrados = tallerEmpleadosCache.filter(per => {
                if (per.ubicacion === 'CAMPO') return false;
                const cumpleCargo = (cargo === 'TODOS') || ((per.cargo || 'OPERARIO') === cargo);
                const cumpleBusqueda = !busqueda || 
                                       (per.nombre || '').toLowerCase().includes(busqueda) || 
                                       (per.id || '').toString().includes(busqueda);
                return cumpleCargo && cumpleBusqueda;
            });

            if (filtrados.length === 0) {
                mostrarToast('No hay empleados modificables en este filtro', 'info');
                return;
            }

            const confirmacion = confirm(`¿Deseas ${autorizado ? 'AUTORIZAR' : 'DESAUTORIZAR'} horas extras a los ${filtrados.length} empleados de la lista actual?`);
            if (!confirmacion) return;

            showLoading(true);
            let exitos = 0;
            let fallidos = 0;

            for (let per of filtrados) {
                try {
                    const res = await jsonpRequest({
                        accion: 'actualizarAutorizacionExtras',
                        empleadoId: per.id,
                        autorizado: autorizado ? 'SI' : 'NO',
                        autorizaNombre: empleado.nombre
                    });
                    if (res.ok) {
                        per.authExtras = autorizado ? 'SI' : 'NO';
                        exitos++;
                    } else {
                        fallidos++;
                    }
                } catch (e) {
                    fallidos++;
                }
            }

            showLoading(false);
            mostrarToast(`Proceso completo. Éxito: ${exitos}, Fallidos: ${fallidos}`, exitos > 0 ? 'success' : 'error');
            dibujarEmpleadosTaller(tallerEmpleadosCache);
        };

        async function toggleAutorizacionExtra(empleadoId, autorizado) {
            const valor = autorizado ? 'SI' : 'NO';
            try {
                const res = await jsonpRequest({
                    accion: 'actualizarAutorizacionExtras',
                    empleadoId: empleadoId,
                    autorizado: valor,
                    autorizaNombre: empleado.nombre
                });

                if (res.ok) {
                    mostrarToast(`✅ Estado actualizado: ${valor}`, 'success');
                } else {
                    mostrarToast('❌ Error: ' + res.error, 'error');
                }
            } catch (e) {
                mostrarToast('Error de red', 'error');
            }
        }

        function esCumpleanos(fechaNac) {
            if (!fechaNac) return false;
            console.log('🔍 Analizando fecha:', fechaNac);

            let dia, mes;
            const hoy = new Date();

            // Caso 1: Formato DD/MM/YYYY
            if (typeof fechaNac === 'string' && fechaNac.includes('/')) {
                const partes = fechaNac.split('/');
                if (partes.length >= 2) {
                    dia = parseInt(partes[0]);
                    mes = parseInt(partes[1]);
                }
            }
            // Caso 2: Formato ISO (YYYY-MM-DD...) o ya es un objeto Date
            else {
                const d = new Date(fechaNac);
                if (!isNaN(d.getTime())) {
                    dia = d.getDate();
                    mes = d.getMonth() + 1;
                }
            }

            if (dia === undefined || mes === undefined) {
                console.warn('⚠️ No se pudo procesar la fecha:', fechaNac);
                return false;
            }

            const matched = hoy.getDate() === dia && (hoy.getMonth() + 1) === mes;
            if (matched) console.log('🎯 ¡Coincidencia de cumpleaños detectada!');
            return matched;
        }

        function celebrarCumpleanos() {
            const container = document.body;
            const colors = ['#f472b6', '#fbbf24', '#3b82f6', '#22c55e', '#ef4444'];

            // Globos flotantes
            for (let i = 0; i < 15; i++) {
                const b = document.createElement('div');
                b.className = 'balloon';
                b.style.left = (Math.random() * 90 + 5) + 'vw';
                b.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                b.style.animationDuration = (Math.random() * 3 + 4) + 's';
                b.style.animationDelay = (Math.random() * 2) + 's';
                container.appendChild(b);
                setTimeout(() => b.remove(), 7000);
            }

            // Confeti
            for (let i = 0; i < 50; i++) {
                const c = document.createElement('div');
                c.className = 'confetti';
                c.style.left = (Math.random() * 100) + 'vw';
                c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                c.style.width = (Math.random() * 8 + 4) + 'px';
                c.style.height = (Math.random() * 8 + 4) + 'px';
                c.style.animationDuration = (Math.random() * 2 + 2) + 's';
                c.style.animationDelay = (Math.random() * 3) + 's';
                container.appendChild(c);
                setTimeout(() => c.remove(), 5000);
            }

            const photo = document.querySelector('.employee-photo-profesional');
            if (photo) photo.classList.add('birthday-glow');
        }

        // Inicialización final
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', () => {
                    if (isAuthenticated) {
                        navigateTo(item.dataset.page);
                    }
                });
            });

            const fabWhatsApp = document.getElementById('fabWhatsApp');
            if (fabWhatsApp) {
                fabWhatsApp.addEventListener('click', abrirWhatsAppSoporte);
            }

            verificarEstadoInicial();

            // Actualización en segundo plano cada 60 segundos (no cada 30s para reducir carga)
            // Se difiere 10s para no competir con la carga inicial
            setTimeout(() => {
                setInterval(() => {
                    if (isAuthenticated && empleado.id) {
                        obtenerRegistrosEmpleado();
                    }
                }, 60000);
            }, 10000);
        });

        // ========== TOGGLE FIREBASE ==========
        function toggleFirebase() {
            const current = localStorage.getItem('tcontrol_use_firebase') !== 'false';
            if (current) {
                localStorage.setItem('tcontrol_use_firebase', 'false');
                window.location.reload();
            } else {
                if (confirm("¿Estás seguro de activar Firebase? Asegúrate de haber migrado la base de datos primero.")) {
                    localStorage.setItem('tcontrol_use_firebase', 'true');
                    window.location.reload();
                }
            }
        }

        // ========================================================
        // PWA: REGISTRO DEL SERVICE WORKER + BOTÓN DE INSTALACIÓN
        // ========================================================
        (function initPWA() {
            // 1. Registrar Service Worker
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./sw.js')
                        .then(reg => {
                            console.log('[PWA] Service Worker registrado:', reg.scope);

                            // Detectar actualizaciones disponibles
                            reg.addEventListener('updatefound', () => {
                                const newSW = reg.installing;
                                newSW.addEventListener('statechange', () => {
                                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                                        // Hay nueva versión — notificar al usuario
                                        console.log('[PWA] Nueva versión disponible');
                                        if (typeof mostrarToast === 'function') {
                                            mostrarToast('🔄 Nueva versión disponible. Recarga para actualizar.', 'info');
                                        }
                                    }
                                });
                            });
                        })
                        .catch(err => console.warn('[PWA] Error registrando SW:', err));
                });
            }

            // 2. Botón de instalación (beforeinstallprompt)
            let deferredPrompt = null;
            const banner = document.getElementById('pwaInstallBanner');
            const closeBtn = document.getElementById('pwaInstallClose');

            window.addEventListener('beforeinstallprompt', e => {
                e.preventDefault();
                deferredPrompt = e;
                // Mostrar solo si el usuario no lo descartó antes
                if (!localStorage.getItem('pwa_install_dismissed')) {
                    setTimeout(() => {
                        if (banner) banner.classList.add('show');
                    }, 3000); // Esperar 3s para no interrumpir la carga
                }
            });

            // Clic en el banner → lanzar prompt de instalación
            if (banner) {
                banner.addEventListener('click', async e => {
                    if (e.target === closeBtn || closeBtn.contains(e.target)) return;
                    if (!deferredPrompt) return;
                    banner.classList.remove('show');
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    console.log('[PWA] Resultado instalación:', outcome);
                    deferredPrompt = null;
                    if (outcome === 'dismissed') {
                        localStorage.setItem('pwa_install_dismissed', '1');
                    }
                });
            }

            // Cerrar banner
            if (closeBtn) {
                closeBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    banner.classList.remove('show');
                    localStorage.setItem('pwa_install_dismissed', '1');
                });
            }

            // 3. Detectar si ya está instalada como PWA
            window.addEventListener('appinstalled', () => {
                console.log('[PWA] App instalada exitosamente');
                if (banner) banner.classList.remove('show');
                if (typeof mostrarToast === 'function') {
                    mostrarToast('✅ TCONTROL instalada en tu dispositivo', 'success');
                }
            });
        })();

        // Escuchar actualización de archivados en segundo plano
        window.addEventListener('archivadosActualizados', async () => {
            if (typeof isAuthenticated !== 'undefined' && isAuthenticated) {
                console.log("🔄 Actualizando vista con nuevos datos históricos...");
                await obtenerRegistrosEmpleado();
                renderHomePage();
                if (typeof obtenerDiasFaltantes === 'function') {
                    let faltas = obtenerDiasFaltantes();
                    if (faltas.length > 0) {
                        mostrarModalFaltasPasadas(faltas);
                    }
                }
            }
        });
        // ========================================================