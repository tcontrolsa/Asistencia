// ========== CONFIGURACIÓN ==========
        const API_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';

        // ========== FUNCIONES DE UI ==========
        function showLoading(show) {
            const loading = document.getElementById('loadingOverlay');
            if (loading) {
                if (show) loading.classList.remove('hidden');
                else loading.classList.add('hidden');
            }
        }

        function mostrarMensaje(mensaje, tipo = 'success') {
            const alert = document.getElementById('saveAlert');
            if (alert) {
                alert.style.display = 'flex';
                setTimeout(() => {
                    alert.style.display = 'none';
                }, 3000);
            }
            // También mostrar en consola para depuración
            console.log(`[${tipo.toUpperCase()}] ${mensaje}`);
        }

        // Mostrar/ocultar campos condicionales
        document.getElementById('configMarcacionAutomatica')?.addEventListener('change', function (e) {
            const div = document.getElementById('divTiempoAutomatico');
            if (div) div.style.display = e.target.checked ? 'block' : 'none';
        });

        document.getElementById('configModoMantenimiento')?.addEventListener('change', function (e) {
            const div = document.getElementById('divMensajeMantenimiento');
            if (div) div.style.display = e.target.checked ? 'block' : 'none';
        });

        // ========== FUNCIÓN PARA LIMPIAR COORDENADAS ==========
        function limpiarCoordenada(valor) {
            if (!valor) return null;

            // Si es número, redondear a 6 decimales
            if (typeof valor === 'number') {
                return Math.round(valor * 1000000) / 1000000;
            }

            // Si es string, limpiar caracteres no numéricos excepto punto y signo menos
            let limpio = valor.toString().trim();
            limpio = limpio.replace(/[^\d.-]/g, '');

            // Convertir a número
            let numero = parseFloat(limpio);
            if (isNaN(numero)) return null;

            // Redondear a 6 decimales
            return Math.round(numero * 1000000) / 1000000;
        }

        // ========== FUNCIONES JSONP (INTERCEPTOR FIREBASE) ==========
        function jsonpRequest(params) {
            if (window.USE_FIREBASE && window.FirebaseBackend) {
                return window.FirebaseBackend.procesarAccion(params);
            }
            return new Promise((resolve, reject) => {
                const callback = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
                window[callback] = function (data) {
                    delete window[callback];
                    if (script.parentNode) script.parentNode.removeChild(script);
                    resolve(data);
                };

                const url = new URL(API_URL);
                url.searchParams.append('callback', callback);
    url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');

                // Seguridad: Inyectar credenciales desde la sesión local
                const session = localStorage.getItem('SUPERVISOR_SESSION') || localStorage.getItem('SESSION_DATA');
                if (session) {
                    const data = JSON.parse(session);
                    url.searchParams.append('empleadoId', data.empleadoId || data.id);
                    url.searchParams.append('deviceToken', data.token);
                }

                Object.keys(params).forEach(key => {
                    if (params[key] !== undefined && params[key] !== null) {
                        if (key === 'empleadoId' || key === 'deviceToken') return; // Evitar duplicar
                        url.searchParams.append(key, typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key].toString());
                    }
                });

                const script = document.createElement('script');
                script.src = url.toString();
                script.onerror = () => {
                    delete window[callback];
                    if (script.parentNode) script.parentNode.removeChild(script);
                    reject(new Error('Error de conexión con el servidor'));
                };
                document.body.appendChild(script);
            });
        }

        // ========== CARGAR CONFIGURACIONES ==========
        async function cargarConfiguraciones() {
            showLoading(true);

            try {
                const res = await jsonpRequest({ accion: 'obtenerConfiguraciones' });
                showLoading(false);

                console.log("Configuraciones recibidas:", res);

                if (res.error) {
                    mostrarMensaje('Error al cargar: ' + res.error, 'error');
                    return;
                }

                // Cargar ubicación
                if (res.ubicacion) {
                    document.getElementById('configLatitud').value = res.ubicacion.lat || -0.1288771313385675;
                    document.getElementById('configLongitud').value = res.ubicacion.lng || -78.47896772889067;
                    document.getElementById('configRadio').value = res.ubicacion.radio || 250;
                } else {
                    // Valores por defecto
                    document.getElementById('configLatitud').value = -0.1288771313385675;
                    document.getElementById('configLongitud').value = -78.47896772889067;
                    document.getElementById('configRadio').value = 250;
                }

                // Cargar horarios
                if (res.horarios) {
                    document.getElementById('configHoraInicio').value = res.horarios.hora_inicio || '08:00';
                    document.getElementById('configHoraFin').value = res.horarios.hora_fin || '16:15';
                    document.getElementById('configHoraAlmuerzo').value = res.horarios.hora_almuerzo || '09:30';
                    document.getElementById('configHoraEntradaLimite').value = res.horarios.hora_entrada_limite || '08:15';
                    document.getElementById('configHoraSalida').value = res.horarios.hora_salida || '16:15';
                    document.getElementById('configAlmuerzoActivo').checked = res.horarios.almuerzo_activo !== false;
                    document.getElementById('configMarcacionAutomatica').checked = res.horarios.marcacion_automatica || false;
                    document.getElementById('configTiempoAutomatico').value = res.horarios.tiempo_automatico || 10;

                    // Mostrar/ocultar campo de tiempo automático
                    const divAuto = document.getElementById('divTiempoAutomatico');
                    if (divAuto) divAuto.style.display = res.horarios.marcacion_automatica ? 'block' : 'none';
                } else {
                    // Valores por defecto
                    document.getElementById('configHoraInicio').value = '08:00';
                    document.getElementById('configHoraFin').value = '16:15';
                    document.getElementById('configHoraAlmuerzo').value = '09:30';
                    document.getElementById('configHoraEntradaLimite').value = '08:15';
                    document.getElementById('configHoraSalida').value = '16:15';
                    document.getElementById('configAlmuerzoActivo').checked = true;
                    document.getElementById('configMarcacionAutomatica').checked = false;
                    document.getElementById('configTiempoAutomatico').value = 10;
                }

                // Cargar configuración de registro
                if (res.registro) {
                    document.getElementById('configToleranciaGPS').value = res.registro.tolerancia_gps || 50;
                    document.getElementById('configRequiereFoto').checked = res.registro.requiere_foto || false;
                    document.getElementById('configPermiteRegistroManual').checked = res.registro.permite_registro_manual || false;
                } else {
                    document.getElementById('configToleranciaGPS').value = 50;
                    document.getElementById('configRequiereFoto').checked = false;
                    document.getElementById('configPermiteRegistroManual').checked = false;
                }

                // Cargar otras configuraciones
                if (res.otras) {
                    document.getElementById('configWhatsApp').value = res.otras.whatsapp_number || '593999999999';
                    document.getElementById('configMensajeSoporte').value = res.otras.mensaje_soporte || 'Hola, necesito soporte técnico para el sistema CONTROL 2026';
                    document.getElementById('configModoMantenimiento').checked = res.otras.modo_mantenimiento || false;
                    document.getElementById('configMensajeMantenimiento').value = res.otras.mensaje_mantenimiento || 'El sistema se encuentra en mantenimiento. Por favor intenta más tarde.';

                    const divMant = document.getElementById('divMensajeMantenimiento');
                    if (divMant) divMant.style.display = res.otras.modo_mantenimiento ? 'block' : 'none';
                } else {
                    document.getElementById('configWhatsApp').value = '593999999999';
                    document.getElementById('configMensajeSoporte').value = 'Hola, necesito soporte técnico para el sistema CONTROL 2026';
                    document.getElementById('configModoMantenimiento').checked = false;
                    document.getElementById('configMensajeMantenimiento').value = 'El sistema se encuentra en mantenimiento. Por favor intenta más tarde.';
                }

                // Cargar lista de supervisores
                if (res.supervisores) {
                    cargarListaSupervisores(res.supervisores);
                } else {
                    // Intentar cargar supervisores por separado si no vienen en la respuesta
                    const supervisoresRes = await jsonpRequest({ accion: 'obtenerSupervisores' });
                    if (supervisoresRes && !supervisoresRes.error) {
                        cargarListaSupervisores(supervisoresRes);
                    } else {
                        cargarListaSupervisores([]);
                    }
                }

                mostrarMensaje('Configuraciones cargadas correctamente', 'success');

            } catch (error) {
                showLoading(false);
                console.error('Error:', error);
                mostrarMensaje('Error al cargar configuraciones: ' + error.message, 'error');
            }
        }

        function cargarListaSupervisores(supervisores) {
            const container = document.getElementById('listaSupervisores');
            if (!container) return;

            if (!supervisores || supervisores.length === 0) {
                container.innerHTML = '<div class="text-muted">No hay supervisores registrados</div>';
                return;
            }

            container.innerHTML = supervisores.map(sup => `
            <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                <div>
                    <strong>${sup.nombre || sup.id}</strong><br>
                    <small class="text-muted">ID: ${sup.id}</small>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="eliminarSupervisor('${sup.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
        }

        // ========== GUARDAR CONFIGURACIONES ==========
        async function guardarConfiguraciones() {
            showLoading(true);

            // Limpiar coordenadas antes de guardar
            const latLimpia = limpiarCoordenada(document.getElementById('configLatitud').value);
            const lngLimpia = limpiarCoordenada(document.getElementById('configLongitud').value);

            if (latLimpia === null || lngLimpia === null) {
                showLoading(false);
                mostrarMensaje('Coordenadas inválidas. Verifica el formato.', 'error');
                return;
            }

            const configuraciones = {
                ubicacion: {
                    lat: latLimpia,
                    lng: lngLimpia,
                    radio: parseInt(document.getElementById('configRadio').value) || 250
                },
                horarios: {
                    hora_inicio: document.getElementById('configHoraInicio').value,
                    hora_fin: document.getElementById('configHoraFin').value,
                    hora_almuerzo: document.getElementById('configHoraAlmuerzo').value,
                    hora_entrada_limite: document.getElementById('configHoraEntradaLimite').value,
                    hora_salida: document.getElementById('configHoraSalida').value,
                    almuerzo_activo: document.getElementById('configAlmuerzoActivo').checked,
                    marcacion_automatica: document.getElementById('configMarcacionAutomatica').checked,
                    tiempo_automatico: parseInt(document.getElementById('configTiempoAutomatico').value) || 10
                },
                registro: {
                    tolerancia_gps: parseInt(document.getElementById('configToleranciaGPS').value) || 50,
                    requiere_foto: document.getElementById('configRequiereFoto').checked,
                    permite_registro_manual: document.getElementById('configPermiteRegistroManual').checked
                },
                otras: {
                    whatsapp_number: document.getElementById('configWhatsApp').value,
                    mensaje_soporte: document.getElementById('configMensajeSoporte').value,
                    modo_mantenimiento: document.getElementById('configModoMantenimiento').checked,
                    mensaje_mantenimiento: document.getElementById('configMensajeMantenimiento').value
                }
            };

            console.log("Guardando configuraciones:", configuraciones);

            try {
                const res = await jsonpRequest({
                    accion: 'guardarConfiguraciones',
                    configuraciones: JSON.stringify(configuraciones)
                });

                showLoading(false);

                if (res.error) {
                    mostrarMensaje('Error al guardar: ' + res.error, 'error');
                } else {
                    mostrarMensaje('Configuración guardada exitosamente', 'success');
                    // Recargar para confirmar
                    setTimeout(() => cargarConfiguraciones(), 1000);
                }
            } catch (error) {
                showLoading(false);
                mostrarMensaje('Error al guardar: ' + error.message, 'error');
            }
        }

        // ========== AGREGAR/ELIMINAR SUPERVISOR ==========
        async function agregarSupervisor() {
            const empleadoId = document.getElementById('nuevoSupervisorId').value.trim();
            if (!empleadoId) {
                mostrarMensaje('Ingresa el ID del empleado', 'error');
                return;
            }

            showLoading(true);

            try {
                const res = await jsonpRequest({
                    accion: 'agregarSupervisor',
                    empleadoId: empleadoId
                });

                showLoading(false);

                if (res.error) {
                    mostrarMensaje('Error: ' + res.error, 'error');
                } else {
                    document.getElementById('nuevoSupervisorId').value = '';
                    mostrarMensaje('Supervisor agregado exitosamente', 'success');
                    await cargarConfiguraciones();
                }
            } catch (error) {
                showLoading(false);
                mostrarMensaje('Error: ' + error.message, 'error');
            }
        }

        async function eliminarSupervisor(empleadoId) {
            if (!confirm(`¿Eliminar al supervisor ${empleadoId}?`)) return;

            showLoading(true);

            try {
                const res = await jsonpRequest({
                    accion: 'eliminarSupervisor',
                    empleadoId: empleadoId
                });

                showLoading(false);

                if (res.error) {
                    mostrarMensaje('Error: ' + res.error, 'error');
                } else {
                    mostrarMensaje('Supervisor eliminado', 'success');
                    await cargarConfiguraciones();
                }
            } catch (error) {
                showLoading(false);
                mostrarMensaje('Error: ' + error.message, 'error');
            }
        }

        // ========== OBTENER UBICACIÓN ACTUAL ==========
        function obtenerUbicacionActual() {
            if (!navigator.geolocation) {
                mostrarMensaje('Geolocalización no soportada', 'error');
                return;
            }

            mostrarMensaje('Obteniendo ubicación...', 'info');

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = Math.round(position.coords.latitude * 1000000) / 1000000;
                    const lng = Math.round(position.coords.longitude * 1000000) / 1000000;

                    document.getElementById('configLatitud').value = lat;
                    document.getElementById('configLongitud').value = lng;
                    mostrarMensaje(`Ubicación actual cargada: ${lat}, ${lng}`, 'success');
                },
                (error) => {
                    mostrarMensaje('Error al obtener ubicación: ' + error.message, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }

        // ========== INICIALIZACIÓN ==========
        document.addEventListener('DOMContentLoaded', () => {
            cargarConfiguraciones();
        });