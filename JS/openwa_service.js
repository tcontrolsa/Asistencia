// ============================================================
// SERVICIO DE NOTIFICACIONES WHATSAPP CON OPENWA — TCONTROL
// ============================================================

(function (window) {
    'use strict';

    const DEFAULT_CONFIG_WHATSAPP = {
        servidorUrl: 'http://192.168.10.129:2785',
        servidorUrlLocal: 'http://192.168.10.129:2785',
        apiKey: 'owa_k1_0b88a4ca047df765c8256adaa1607c60afb4db126e383187653b0f0d0828d6d7',
        activo: true,
        autoEnvioNoRegistro: false,
        horaCorteNoRegistro: '08:15',
        diasEnvio: ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'],
        plantillaNoRegistro: (
            "🔔 *NOTIFICACIÓN DE ASISTENCIA — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Te informamos que al momento (*{hora}* del {fecha}) no registras marcación de ingreso en el sistema de Asistencia Tcontrol.\n\n" +
            "⚠️ *Por favor:* Si ya te encuentras en tu jornada laboral, recuerda registrar tu asistencia en la aplicación móvil o comunicarte con tu supervisor / RRHH para justificar la novedad.\n\n" +
            "📱 *App de Asistencia:* {link}\n" +
            "_Este es un mensaje automático de control y seguimiento._\n" +
            "🔒 _Aviso Legal: Mensaje emitido por TCONTROL S.A. en cumplimiento de la LOPDP exclusivamente para fines de control laboral._"
        ),
        plantillaAusente: (
            "📋 *AVISO DE AUSENCIA LABORAL — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Se ha registrado tu *AUSENCIA* en la jornada laboral del día de hoy (*{fecha}*).\n\n" +
            "📌 *Acción requerida:* Por favor presenta el justificativo respectivo (médico, calamidad o permiso personal) a tu supervisor o mediante la aplicación de Asistencia en el transcurso del día.\n\n" +
            "📱 *App de Asistencia:* {link}\n" +
            "_Departamento de Talento Humano / Operaciones Tcontrol._\n" +
            "🔒 _Aviso Legal: Comunicación confidencial amparada por la LOPDP (Ecuador) para fines de gestión laboral._"
        ),
        plantillaVacaciones: (
            "🏖️ *REGISTRO DE VACACIONES — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Te recordamos que te encuentras gozando de tu período oficial de *VACACIONES* para el día de hoy (*{fecha}*).\n\n" +
            "¡Deseamos que disfrutes de tu descanso!\n\n" +
            "_Departamento de Talento Humano T-Control._\n" +
            "🔒 _Aviso Legal: Notificación institucional emitida bajo la LOPDP._"
        ),
        plantillaPermiso: (
            "📝 *REGISTRO DE PERMISO / LICENCIA — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Te informamos que se encuentra registrado tu *PERMISO LABORAL* ({razon}) para la jornada del día de hoy (*{fecha}*).\n\n" +
            "Si tienes alguna duda o novedad sobre tu itinerario, por favor comunícate con tu supervisor.\n\n" +
            "_Control de Asistencia T-Control._\n" +
            "🔒 _Aviso Legal: Comunicación confidencial de gestión laboral bajo la LOPDP._"
        ),
        plantillaSalidaFaltante: (
            "🚪 *RECORDATORIO DE REGISTRO DE SALIDA — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Detectamos que registraste tu ingreso hoy ({fecha}), pero aún *no has registrado tu marcación de salida*.\n\n" +
            "⏰ *Recordatorio:* Recuerda marcar tu salida en la app antes de retirarte para que tus horas laboradas queden registradas correctamente.\n\n" +
            "📱 *App de Asistencia:* {link}\n" +
            "_Control de Asistencia Tcontrol._\n" +
            "🔒 _Aviso Legal: Mensaje institucional emitido conforme a la LOPDP para control de jornada de trabajo._"
        ),
        plantillaEmergencia: (
            "🚨 *ALERTA GENERAL DE SEGURIDAD — TCONTROL*\n\n" +
            "Estimado/a *{nombre}*,\n\n" +
            "Se ha activado una alerta operativa / simulacro de emergencia en la plataforma.\n\n" +
            "⚠️ *Instrucción Inmediata:* Por favor ingresa a la aplicación de Asistencia y pulsa el botón *🚨 Reportar mi Estado* para confirmar tu ubicación y seguridad.\n\n" +
            "📱 *Confirmar Estado:* {link}\n" +
            "_Comité de Seguridad y Operaciones Tcontrol._\n" +
            "🔒 _Aviso Legal: Comunicación prioritaria de seguridad física y laboral bajo la LOPDP._"
        ),
        enlaceApp: 'https://tcontrol.ec/asistencia'
    };

    const OpenWAService = {
        config: { ...DEFAULT_CONFIG_WHATSAPP },
        _inicializado: false,
        _sesionInfo: null,
        _sessionId: '5a509468-647a-4973-b10c-bf87d04666ea',
        _ultimoCheckAuto: null,

        // Inicializar configuración cargando de Firebase / LocalStorage
        async inicializar() {
            try {
                let configGuardada = null;
                if (window.FirebaseBackend && typeof window.FirebaseBackend.obtenerConfiguracionWhatsApp === 'function') {
                    const res = await window.FirebaseBackend.obtenerConfiguracionWhatsApp();
                    if (res && res.config) configGuardada = res.config;
                }

                if (!configGuardada) {
                    const local = localStorage.getItem('tcontrol_config_whatsapp');
                    if (local) {
                        try { configGuardada = JSON.parse(local); } catch(e) {}
                    }
                }

                if (configGuardada) {
                    this.config = { ...DEFAULT_CONFIG_WHATSAPP, ...configGuardada };
                }

                // Asegurar API key por defecto si venía vacía en caché
                if (!this.config.apiKey) {
                    this.config.apiKey = DEFAULT_CONFIG_WHATSAPP.apiKey;
                }

                // Asegurar contenedor de imágenes de plantillas
                if (!this.config.imagenesPlantillas) {
                    this.config.imagenesPlantillas = {};
                }
                ['no_registro', 'ausente', 'salida_faltante', 'emergencia', 'sin_marcar'].forEach(k => {
                    if (!this.config.imagenesPlantillas[k]) {
                        try {
                            const img = localStorage.getItem('tcontrol_wa_img_' + k) || (k === 'sin_marcar' ? localStorage.getItem('tcontrol_wa_img_no_registro') : null);
                            if (img) this.config.imagenesPlantillas[k] = img;
                        } catch(e) {}
                    }
                });
                if (this.config.imagenesPlantillas['no_registro'] && !this.config.imagenesPlantillas['sin_marcar']) {
                    this.config.imagenesPlantillas['sin_marcar'] = this.config.imagenesPlantillas['no_registro'];
                }
                if (this.config.imagenesPlantillas['sin_marcar'] && !this.config.imagenesPlantillas['no_registro']) {
                    this.config.imagenesPlantillas['no_registro'] = this.config.imagenesPlantillas['sin_marcar'];
                }

                // Auto-migración si el almacenamiento local aún tenía túneles temporales muertos conocidos o puerto antiguo 8081
                const esUrlObsoleta = this.config.servidorUrl && (
                    this.config.servidorUrl.includes(':8081') ||
                    this.config.servidorUrl.includes('quote-bacteria-valve-lights') ||
                    this.config.servidorUrl.includes('trails-aids-spending-targeted')
                );
                if (esUrlObsoleta) {
                    this.config.servidorUrl = DEFAULT_CONFIG_WHATSAPP.servidorUrl;
                    try { localStorage.setItem('tcontrol_config_whatsapp', JSON.stringify(this.config)); } catch(e) {}
                }
            } catch (e) {
                console.warn("[OpenWA] Error cargando configuración, usando valores por defecto:", e);
            }

            // Sincronización en tiempo real con Firestore para que cambios de túnel se reflejen de inmediato en celulares y PCs
            if (typeof db !== 'undefined' && db && !this._listenerFirestoreIniciado) {
                this._listenerFirestoreIniciado = true;
                try {
                    db.collection('configuracion').doc('whatsapp').onSnapshot(snap => {
                        if (snap && snap.exists) {
                            const d = snap.data() || {};
                            if (d.servidorUrl && d.servidorUrl !== this.config.servidorUrl) {
                                console.log(`[OpenWA] URL del servidor WhatsApp actualizada en tiempo real: ${d.servidorUrl}`);
                                this.config.servidorUrl = d.servidorUrl;
                                if (typeof $ === 'function') {
                                    const el = $('txtWhatsAppServidorUrl');
                                    if (el) el.value = d.servidorUrl;
                                }
                            }
                            if (d.servidorUrlLocal) this.config.servidorUrlLocal = d.servidorUrlLocal;
                            if (d.apiKey) this.config.apiKey = d.apiKey;
                        }
                    }, err => {
                        console.warn("[OpenWA] Aviso en listener tiempo real Firestore:", err);
                    });
                } catch(eSnap) {}
            }

            this._inicializado = true;
            return this.config;
        },

        // Helper para armar cabeceras con API Key si existe
        _obtenerHeaders(customApiKey = null) {
            const headers = {
                'Accept': 'application/json'
            };
            let domKey = '';
            try {
                const el = document.getElementById('txtWhatsAppApiKey');
                if (el && el.value) domKey = el.value.trim();
            } catch(e) {}

            const apiKey = (customApiKey !== null ? customApiKey : (domKey || this.config.apiKey || DEFAULT_CONFIG_WHATSAPP.apiKey || '')).trim();
            if (apiKey) {
                headers['X-API-Key'] = apiKey;
                headers['Authorization'] = 'Bearer ' + apiKey;
            }
            return headers;
        },

        // Guardar configuración en Firebase y LocalStorage
        async guardarConfiguracion(nuevaConfig) {
            this.config = { ...this.config, ...nuevaConfig };
            if (nuevaConfig.imagenesPlantillas) {
                this.config.imagenesPlantillas = { ...this.config.imagenesPlantillas, ...nuevaConfig.imagenesPlantillas };
            }
            try {
                localStorage.setItem('tcontrol_config_whatsapp', JSON.stringify(this.config));
            } catch(e) {}

            try {
                if (window.FirebaseBackend && typeof window.FirebaseBackend.guardarConfiguracionWhatsApp === 'function') {
                    await window.FirebaseBackend.guardarConfiguracionWhatsApp({ config: this.config });
                } else if (typeof window.jsonpRequest === 'function') {
                    await window.jsonpRequest({
                        accion: 'guardarConfiguracionWhatsApp',
                        config: JSON.stringify(this.config)
                    });
                }
            } catch (e) {
                console.error("[OpenWA] Error persistiendo configuración en la nube:", e);
            }
            return { ok: true, config: this.config };
        },

        // Normalizar clave de tipo de plantilla para garantizar sincronía total entre modal y panel
        normalizarTipoPlantilla(tipo) {
            if (!tipo) return 'no_registro';
            const t = String(tipo).toLowerCase().trim();
            if (t === 'sin_marcar' || t === 'no_registro' || t === 'entrada_faltante' || t === 'entrada') return 'no_registro';
            if (t === 'vacaciones' || t === 'vacacion') return 'vacaciones';
            if (t === 'permisos' || t === 'permiso') return 'permisos';
            if (t === 'ausente' || t === 'ausencia' || t === 'ausencia_laboral') return 'ausente';
            if (t === 'salida' || t === 'salida_faltante') return 'salida_faltante';
            if (t === 'emergencia' || t === 'alerta_emergencia') return 'emergencia';
            return tipo;
        },

        // Obtener imagen asociada a una plantilla (soporta estándar, alias y personalizadas)
        obtenerImagenPlantilla(tipoRaw) {
            if (!tipoRaw) return null;
            const tipo = this.normalizarTipoPlantilla(tipoRaw);
            if (this.config.imagenesPlantillas) {
                if (this.config.imagenesPlantillas[tipo]) return this.config.imagenesPlantillas[tipo];
                if (this.config.imagenesPlantillas[tipoRaw]) return this.config.imagenesPlantillas[tipoRaw];
                if (tipo === 'no_registro' && this.config.imagenesPlantillas['sin_marcar']) return this.config.imagenesPlantillas['sin_marcar'];
                if (tipoRaw === 'sin_marcar' && this.config.imagenesPlantillas['no_registro']) return this.config.imagenesPlantillas['no_registro'];
            }
            if (window._waPlantillasImagenes) {
                if (window._waPlantillasImagenes[tipo]) return window._waPlantillasImagenes[tipo];
                if (window._waPlantillasImagenes[tipoRaw]) return window._waPlantillasImagenes[tipoRaw];
            }
            if (window._plantillasPersonalizadas && window._plantillasPersonalizadas[tipo]?.imagenBase64) {
                return window._plantillasPersonalizadas[tipo].imagenBase64;
            }
            try {
                const imgLocal = localStorage.getItem('tcontrol_wa_img_' + tipo) || 
                                 localStorage.getItem('tcontrol_wa_img_' + tipoRaw) ||
                                 (tipo === 'no_registro' ? localStorage.getItem('tcontrol_wa_img_sin_marcar') : null) ||
                                 (tipoRaw === 'sin_marcar' ? localStorage.getItem('tcontrol_wa_img_no_registro') : null);
                if (imgLocal) return imgLocal;
            } catch(e) {}
            return null;
        },

        // Guardar o eliminar imagen asociada a una plantilla
        guardarImagenPlantilla(tipoRaw, imagenBase64) {
            if (!tipoRaw) return;
            const tipo = this.normalizarTipoPlantilla(tipoRaw);
            if (!this.config.imagenesPlantillas) {
                this.config.imagenesPlantillas = {};
            }
            if (imagenBase64) {
                this.config.imagenesPlantillas[tipo] = imagenBase64;
                if (tipo === 'no_registro') this.config.imagenesPlantillas['sin_marcar'] = imagenBase64;
                try { 
                    localStorage.setItem('tcontrol_wa_img_' + tipo, imagenBase64);
                    if (tipo === 'no_registro') localStorage.setItem('tcontrol_wa_img_sin_marcar', imagenBase64);
                } catch(e) {}
            } else {
                delete this.config.imagenesPlantillas[tipo];
                if (tipo === 'no_registro') delete this.config.imagenesPlantillas['sin_marcar'];
                try { 
                    localStorage.removeItem('tcontrol_wa_img_' + tipo);
                    if (tipo === 'no_registro') localStorage.removeItem('tcontrol_wa_img_sin_marcar');
                } catch(e) {}
            }

            if (tipo.startsWith('custom_') && window._plantillasPersonalizadas && window._plantillasPersonalizadas[tipo]) {
                if (imagenBase64) {
                    window._plantillasPersonalizadas[tipo].imagenBase64 = imagenBase64;
                } else {
                    delete window._plantillasPersonalizadas[tipo].imagenBase64;
                }
                try { localStorage.setItem('tcontrol_wa_plantillas_custom', JSON.stringify(window._plantillasPersonalizadas)); } catch(e) {}
            }
        },

        // Normalizar número telefónico para WhatsApp Ecuador y formato OpenWA/WAHA
        // 0984660105 -> 593984660105@c.us
        // +593 98 466 0105 -> 593984660105@c.us
        normalizarNumero(numeroRaw) {
            if (!numeroRaw) return null;
            let num = String(numeroRaw).trim();
            // Remover espacios, guiones, paréntesis y signos +
            num = num.replace(/[^\d]/g, '');

            if (!num) return null;

            // Caso Ecuador celular: 09XXXXXXXX (10 dígitos empezando con 09)
            if (num.startsWith('09') && num.length === 10) {
                num = '593' + num.substring(1);
            } else if (num.startsWith('9') && num.length === 9) {
                num = '593' + num;
            } else if (num.startsWith('59309') && num.length === 13) {
                num = '593' + num.substring(5);
            }

            // Validar longitud mínima razonable (e.g. 10 a 15 dígitos)
            if (num.length < 9) return null;

            if (!num.endsWith('@c.us') && !num.endsWith('@g.us')) {
                num = `${num}@c.us`;
            }
            return num;
        },

        // Detectar si una petición causaría bloqueo de Contenido Mixto (HTTPS -> HTTP) en el navegador
        _esInseguroEnHttps(url) {
            return (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && (url || '').trim().startsWith('http://'));
        },

        // Obtener URL base segura para peticiones (maneja auto-upgrade a HTTPS para evitar bloqueo de Contenido Mixto en smartphones)
        _obtenerUrlBase(servidorUrl = null) {
            let url = (servidorUrl || this.config.servidorUrl || DEFAULT_CONFIG_WHATSAPP.servidorUrl || '').trim().replace(/\/+$/, '');
            // Si la URL guardada es de un túnel temporal obsoleto o cerrado, descartar y volver a la URL del servidor local
            if (url.includes('quote-bacteria-valve-lights') || url.includes('trails-aids-spending-targeted')) {
                url = (this.config.servidorUrlLocal || DEFAULT_CONFIG_WHATSAPP.servidorUrlLocal || 'http://192.168.10.129:2785').replace(/\/+$/, '');
            }
            return url;
        },

        // Probar conexión y obtener estado de la sesión
        async probarConexion(servidorUrl = null, apiKeyCustom = null) {
            const urlBase = this._obtenerUrlBase(servidorUrl);
            const apiKey = apiKeyCustom !== null ? apiKeyCustom : (this.config.apiKey || DEFAULT_CONFIG_WHATSAPP.apiKey || '');
            let timeoutId = null;

            if (this._esInseguroEnHttps(urlBase)) {
                return {
                    ok: false,
                    error: `Bloqueo de Contenido Mixto: La aplicación web se ejecuta en HTTPS seguro, pero la URL configurada para WhatsApp es HTTP insegura (${urlBase}). Los navegadores de celulares y computadoras bloquean estas conexiones. Ejecuta 'iniciar_tunel_whatsapp.bat' en el PC principal para habilitar el túnel HTTPS.`
                };
            }

            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => {
                    try { controller.abort(); } catch(e) {}
                }, 6000);

                const reqHeaders = this._obtenerHeaders(apiKey);

                // 1. Probe rápido con no-cors para verificar conectividad con el servidor sin generar alertas CORS en consola
                let esServidorVivo = false;
                try {
                    const probeRes = await fetch(`${urlBase}/api/health`, {
                        method: 'GET',
                        mode: 'no-cors',
                        signal: controller.signal
                    });
                    if (probeRes && (probeRes.type === 'opaque' || probeRes.status === 0 || probeRes.ok)) {
                        esServidorVivo = true;
                    }
                } catch(eProbe) {
                    try {
                        const probeRes2 = await fetch(`${urlBase}/health`, {
                            method: 'GET',
                            mode: 'no-cors',
                            signal: controller.signal
                        });
                        if (probeRes2 && (probeRes2.type === 'opaque' || probeRes2.status === 0 || probeRes2.ok)) {
                            esServidorVivo = true;
                        }
                    } catch(eProbe2) {}
                }

                if (!esServidorVivo) {
                    if (timeoutId) clearTimeout(timeoutId);
                    const urlLocal = (this.config.servidorUrlLocal || DEFAULT_CONFIG_WHATSAPP.servidorUrlLocal || 'http://192.168.10.129:2785').replace(/\/+$/, '');
                    if (urlBase !== urlLocal && (!servidorUrl)) {
                        try {
                            const probeLocal = await fetch(`${urlLocal}/api/health`, { method: 'GET', mode: 'no-cors' });
                            if (probeLocal) {
                                return {
                                    ok: false,
                                    error: `La URL configurada (${urlBase}) no responde. Sin embargo, el servidor local en ${urlLocal} está activo. Cambia la URL a ${urlLocal} o levanta el túnel con iniciar_tunel_whatsapp.bat.`
                                };
                            }
                        } catch(eLoc) {}
                    }
                    return {
                        ok: false,
                        error: `No se pudo conectar a ${urlBase}. Verifica que el servicio esté activo en el servidor o levanta el túnel con iniciar_tunel_whatsapp.bat.`
                    };
                }

                // 2. Si se ha especificado un API Key, consultar la sesión activa
                let accountInfo = null;
                let sesionLista = true;
                let requiereApiKey = false;
                let dataHealth = { status: 'ok', version: '5.0.0' };

                if (apiKey && apiKey.trim()) {
                    try {
                        const ctrlMeta = new AbortController();
                        const tMeta = setTimeout(() => { try { ctrlMeta.abort(); } catch(e) {} }, 3000);

                        const resMeta = await fetch(`${urlBase}/api/sessions`, {
                            headers: reqHeaders,
                            signal: ctrlMeta.signal
                        });
                        clearTimeout(tMeta);

                        if (resMeta.status === 401) {
                            requiereApiKey = true;
                            sesionLista = false;
                        } else if (resMeta.ok) {
                            const dataSessions = await resMeta.json();
                            const lista = Array.isArray(dataSessions) ? dataSessions : (dataSessions.data || []);
                            const sesActiva = lista.find(s => s.status === 'ready' || s.status === 'WORKING' || s.status === 'RUNNING' || s.status === 'PAIRED') || lista[0];
                            if (sesActiva) {
                                this._sessionId = sesActiva.id || sesActiva.name || this._sessionId;
                                accountInfo = sesActiva;
                                sesionLista = (sesActiva.status === 'ready' || sesActiva.status === 'WORKING' || sesActiva.status === 'RUNNING' || sesActiva.status === 'PAIRED' || !!sesActiva.phone);
                            }
                        }
                    } catch(eMeta) {
                        // CORS o error de red al consultar metadata
                    } finally {
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                } else {
                    if (timeoutId) clearTimeout(timeoutId);
                }

                const hostNumber = accountInfo?.phone || accountInfo?.me?.user || accountInfo?.user || '593963561149';
                const hostName = accountInfo?.pushName || accountInfo?.pushname || accountInfo?.name || (requiereApiKey ? 'Requiere API Key' : 'Soporte TI (robot)');

                this._sesionInfo = {
                    conectado: true,
                    sesionLista: sesionLista,
                    requiereApiKey: requiereApiKey,
                    estado: requiereApiKey ? 'UNAUTHORIZED' : 'READY',
                    version: dataHealth.version || '5.0.0',
                    numeroEmisor: hostNumber,
                    nombreEmisor: hostName,
                    sessionId: this._sessionId
                };

                return {
                    ok: true,
                    conectado: true,
                    sesionLista: sesionLista,
                    requiereApiKey: requiereApiKey,
                    info: this._sesionInfo
                };
            } catch (e) {
                if (timeoutId) clearTimeout(timeoutId);
                const esTimeout = e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('abort'));
                return {
                    ok: false,
                    error: esTimeout
                        ? `Tiempo de espera agotado al conectar con ${urlBase}.`
                        : `No se pudo conectar a ${urlBase} (${e.message})`
                };
            }
        },

        // Resolver y validar destinatario WhatsApp (soporta verificación previa con OpenWA /contacts/check/{cleanNumber})
        async resolverChatId(numeroDestino, servidorUrl = null) {
            const urlBase = this._obtenerUrlBase(servidorUrl);
            const sessId = this._sessionId || '5a509468-647a-4973-b10c-bf87d04666ea';
            let toChatId = this.normalizarNumero(numeroDestino);

            if (!toChatId) {
                return { ok: false, error: 'Número de WhatsApp inválido o no especificado.' };
            }

            // Si el número ya incluye @lid, respetarlo directamente
            if (numeroDestino && String(numeroDestino).includes('@lid')) {
                return { ok: true, chatId: String(numeroDestino).trim() };
            }

            // Normalizar dígitos internacionales para la consulta OpenWA (ej: 593984660105 en vez de 0984660105)
            const cleanDigits = toChatId.replace(/@.*$/, '').replace(/\D/g, '');

            // Si la consulta causaría bloqueo de Contenido Mixto (HTTPS -> HTTP), omitir probe para no disparar alertas en navegador
            if (this._esInseguroEnHttps(urlBase)) {
                return { ok: true, chatId: toChatId };
            }

            // Consultar endpoint oficial /contacts/check/ de OpenWA
            if (cleanDigits && cleanDigits.length >= 9) {
                try {
                    const checkRes = await fetch(`${urlBase}/api/sessions/${sessId}/contacts/check/${cleanDigits}`, {
                        headers: this._obtenerHeaders()
                    });
                    if (checkRes.ok) {
                        const checkData = await checkRes.json();
                        if (checkData && checkData.exists && checkData.whatsappId) {
                            return { ok: true, chatId: checkData.whatsappId };
                        } else if (checkData && checkData.exists === false) {
                            return { ok: false, error: `El número ${numeroDestino} no está registrado en WhatsApp.` };
                        }
                    }
                } catch(e) {
                    // Si falla por DNS o red, y no estábamos usando la IP local, intentar fallback local si estamos en HTTP/LAN
                    const urlLocal = (this.config.servidorUrlLocal || DEFAULT_CONFIG_WHATSAPP.servidorUrlLocal || 'http://192.168.10.129:2785').replace(/\/+$/, '');
                    if (urlBase !== urlLocal && !servidorUrl && (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:')) {
                        try {
                            const checkResLoc = await fetch(`${urlLocal}/api/sessions/${sessId}/contacts/check/${cleanDigits}`, {
                                headers: this._obtenerHeaders()
                            });
                            if (checkResLoc.ok) {
                                const checkDataLoc = await checkResLoc.json();
                                if (checkDataLoc && checkDataLoc.exists && checkDataLoc.whatsappId) {
                                    return { ok: true, chatId: checkDataLoc.whatsappId };
                                }
                            }
                        } catch(eLoc) {}
                    }
                    // Si falla el check de contacto, continuar con el toChatId normalizado
                }
            }

            return { ok: true, chatId: toChatId };
        },

        // Enviar un mensaje de texto directo (soporta endpoints WAHA y OpenWA)
        async enviarMensajeTexto(numeroDestino, mensajeTexto, servidorUrl = null) {
            const urlBase = this._obtenerUrlBase(servidorUrl);
            const sessId = this._sessionId || '5a509468-647a-4973-b10c-bf87d04666ea';

            if (!mensajeTexto || !mensajeTexto.trim()) {
                return { ok: false, error: 'El contenido del mensaje no puede estar vacío.' };
            }

            if (this._esInseguroEnHttps(urlBase)) {
                return {
                    ok: false,
                    error: `Bloqueo de Contenido Mixto: La aplicación corre en HTTPS, pero el servidor WhatsApp está en HTTP (${urlBase}). Los celulares y navegadores bloquean estas conexiones. Inicia el túnel Cloudflare en el PC con iniciar_tunel_whatsapp.bat.`
                };
            }

            const resChat = await this.resolverChatId(numeroDestino, servidorUrl);
            if (!resChat.ok) {
                return { ok: false, error: resChat.error };
            }
            const toChatId = resChat.chatId;

            const headers = {
                'Content-Type': 'application/json',
                ...this._obtenerHeaders()
            };

            try {
                // 1. Intentar endpoint OpenWA v5 sessions por UUID/nombre: POST /api/sessions/{session}/messages/send-text
                let response = await fetch(`${urlBase}/api/sessions/${sessId}/messages/send-text`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        chatId: toChatId,
                        text: mensajeTexto.trim()
                    })
                });

                // 2. Fallback a POST /api/sendText
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sendText`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            chatId: toChatId,
                            text: mensajeTexto.trim(),
                            session: 'robot'
                        })
                    });
                }

                // 3. Fallback a POST /api/messages/sendText
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/messages/sendText`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            to: toChatId,
                            content: mensajeTexto.trim()
                        })
                    });
                }

                const data = await response.json();
                if (response.ok || response.status === 200 || response.status === 201) {
                    return {
                        ok: true,
                        mensajeId: data.messageId || data.id || data.data || 'OK',
                        destinatario: toChatId
                    };
                } else {
                    let errMsg = data.message || data.error || `Error HTTP ${response.status} en el servidor WhatsApp`;
                    if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('could not resolve the recipient')) {
                        errMsg = `WhatsApp no pudo resolver el destinatario (${toChatId}). Asegúrate de que el número esté registrado en WhatsApp o abre un chat con este contacto desde el teléfono emisor primero.`;
                    }
                    return {
                        ok: false,
                        error: errMsg
                    };
                }
            } catch (e) {
                console.error("[OpenWA] Error enviando mensaje:", e);
                const urlLocal = (this.config.servidorUrlLocal || DEFAULT_CONFIG_WHATSAPP.servidorUrlLocal || 'http://192.168.10.129:2785').replace(/\/+$/, '');
                if (urlBase !== urlLocal && !servidorUrl && (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:')) {
                    console.warn(`[OpenWA] Fallo de conexión con ${urlBase}. Intentando fallback automático a servidor local (${urlLocal})...`);
                    return this.enviarMensajeTexto(numeroDestino, mensajeTexto, urlLocal);
                }
                const esCors = e.message && (e.message.includes('Failed to fetch') || e.name === 'TypeError');
                let errDesc = esCors
                    ? `Error de conexión con el servidor WhatsApp (${urlBase}). Verifica si el servidor o túnel está activo.`
                    : `Fallo de conexión con el servidor WhatsApp (${e.message}).`;
                if (esCors && this._esInseguroEnHttps(urlBase)) {
                    errDesc = `Bloqueo de Contenido Mixto: El navegador impidió conectar con '${urlBase}' porque esta aplicación usa HTTPS. Inicia el túnel Cloudflare con iniciar_tunel_whatsapp.bat.`;
                }
                return {
                    ok: false,
                    error: errDesc
                };
            }
        },

        // Enviar un mensaje con imagen adjunta (soporta endpoints WAHA y OpenWA)
        async enviarMensajeImagen(numeroDestino, mensajeTexto, base64Imagen, servidorUrl = null) {
            const urlBase = this._obtenerUrlBase(servidorUrl);
            const sessId = this._sessionId || '5a509468-647a-4973-b10c-bf87d04666ea';

            if (!base64Imagen) {
                return this.enviarMensajeTexto(numeroDestino, mensajeTexto, servidorUrl);
            }

            if (this._esInseguroEnHttps(urlBase)) {
                return {
                    ok: false,
                    error: `Bloqueo de Contenido Mixto: La aplicación corre en HTTPS, pero el servidor WhatsApp está en HTTP (${urlBase}). Los celulares y navegadores bloquean estas conexiones. Inicia el túnel Cloudflare en el PC con iniciar_tunel_whatsapp.bat.`
                };
            }

            const resChat = await this.resolverChatId(numeroDestino, servidorUrl);
            if (!resChat.ok) {
                return { ok: false, error: resChat.error };
            }
            const toChatId = resChat.chatId;

            const headers = {
                'Content-Type': 'application/json',
                ...this._obtenerHeaders()
            };
            
            // Extraer tipo MIME y datos raw de base64
            const matches = base64Imagen.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            let mimetype = 'image/jpeg';
            let b64Data = base64Imagen;
            if (matches && matches.length === 3) {
                mimetype = matches[1];
                b64Data = matches[2];
            } else if (base64Imagen.includes('base64,')) {
                b64Data = base64Imagen.split('base64,')[1];
            }
            const dataUri = base64Imagen.startsWith('data:') ? base64Imagen : `data:${mimetype};base64,${b64Data}`;
            const caption = (mensajeTexto || '').trim();

            try {
                // 1. Endpoint nativo OpenWA v0.23+ send-image: POST /api/sessions/{session}/messages/send-image
                let response = await fetch(`${urlBase}/api/sessions/${sessId}/messages/send-image`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        chatId: toChatId,
                        base64: b64Data,
                        mimetype: mimetype,
                        caption: caption
                    })
                });

                // 2. Si el servidor devuelve 400 o 404, intentar estructura WAHA con objeto file
                if (!response.ok && (response.status === 400 || response.status === 404)) {
                    const fallbackWaha = await fetch(`${urlBase}/api/sessions/${sessId}/messages/send-image`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            chatId: toChatId,
                            file: {
                                mimetype: mimetype,
                                filename: "imagen.jpg",
                                data: b64Data
                            },
                            caption: caption
                        })
                    });
                    if (fallbackWaha.ok) {
                        response = fallbackWaha;
                    }
                }

                // 2. Si 404, intentar POST /api/sendImage (WAHA estándar)
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sendImage`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            chatId: toChatId,
                            file: {
                                mimetype: mimetype,
                                filename: "imagen.jpg",
                                data: b64Data
                            },
                            caption: caption,
                            session: sessId
                        })
                    });
                }

                // 3. Si 404, intentar POST /api/sendImage con payload OpenWA clásico (to, file con DataURI)
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sendImage`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            to: toChatId,
                            chatId: toChatId,
                            file: dataUri,
                            filename: 'imagen.jpg',
                            caption: caption,
                            session: 'robot'
                        })
                    });
                }

                // 4. Si 404, intentar POST /api/sendImageBase64 (OpenWA legacy)
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sendImageBase64`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            to: toChatId,
                            chatId: toChatId,
                            base64: dataUri,
                            filename: 'imagen.jpg',
                            caption: caption,
                            session: 'robot'
                        })
                    });
                }
                
                // 5. Si 404, intentar POST /api/sessions/{session}/messages/send-file (WAHA file)
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sessions/${sessId}/messages/send-file`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            chatId: toChatId,
                            file: {
                                mimetype: mimetype,
                                filename: "imagen.jpg",
                                data: b64Data
                            },
                            caption: caption
                        })
                    });
                }

                // 6. Si 404, intentar POST /api/sendFile (WAHA estándar)
                if (response.status === 404) {
                    response = await fetch(`${urlBase}/api/sendFile`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            chatId: toChatId,
                            file: {
                                mimetype: mimetype,
                                filename: "imagen.jpg",
                                data: b64Data
                            },
                            caption: caption,
                            session: sessId
                        })
                    });
                }

                const data = await response.json();
                if (response.ok || response.status === 200 || response.status === 201) {
                    return {
                        ok: true,
                        mensajeId: data.messageId || data.id || data.data || 'OK',
                        destinatario: toChatId
                    };
                } else {
                    console.warn("[OpenWA] Servidor devolvió error al enviar imagen:", data);
                    // Fallback a texto si el servidor rechazó la imagen para no dejar al usuario sin notificación
                    console.info("[OpenWA] Intentando fallback a envío de texto...");
                    const fallbackRes = await this.enviarMensajeTexto(numeroDestino, mensajeTexto, servidorUrl);
                    if (fallbackRes.ok) {
                        return {
                            ok: true,
                            mensajeId: fallbackRes.mensajeId,
                            destinatario: toChatId,
                            advertencia: 'Imagen no compatible con el servidor, enviado como texto'
                        };
                    }
                    return {
                        ok: false,
                        error: data.message || data.error || `Error HTTP ${response.status} en el servidor WhatsApp`
                    };
                }
            } catch (e) {
                console.error("[OpenWA] Error enviando imagen:", e);
                const urlLocal = (this.config.servidorUrlLocal || DEFAULT_CONFIG_WHATSAPP.servidorUrlLocal || 'http://192.168.10.129:2785').replace(/\/+$/, '');
                if (urlBase !== urlLocal && !servidorUrl && (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:')) {
                    console.warn(`[OpenWA] Fallo de conexión con ${urlBase}. Intentando fallback automático de imagen a servidor local (${urlLocal})...`);
                    return this.enviarMensajeImagen(numeroDestino, mensajeTexto, base64Imagen, urlLocal);
                }
                try {
                    const fallbackRes = await this.enviarMensajeTexto(numeroDestino, mensajeTexto, servidorUrl);
                    if (fallbackRes.ok) {
                        return {
                            ok: true,
                            mensajeId: fallbackRes.mensajeId,
                            destinatario: toChatId,
                            advertencia: 'Enviado como texto por fallo en endpoint de imagen'
                        };
                    }
                } catch(e2) {}

                const esCors = e.message && (e.message.includes('Failed to fetch') || e.name === 'TypeError');
                let errDescImg = esCors
                    ? `Error de conexión con el servidor WhatsApp (${urlBase}). Verifica si el servidor o túnel está activo.`
                    : `Fallo de conexión con el servidor WhatsApp (${e.message}).`;
                if (esCors && this._esInseguroEnHttps(urlBase)) {
                    errDescImg = `Bloqueo de Contenido Mixto: El navegador impidió conectar con '${urlBase}' porque esta aplicación usa HTTPS. Inicia el túnel Cloudflare con iniciar_tunel_whatsapp.bat.`;
                }
                return {
                    ok: false,
                    error: errDescImg
                };
            }
        },

        // Formatear plantilla según el tipo (no_registro, ausente, salida_faltante, emergencia)
        formatearMensaje(tipoRaw = 'no_registro', empleado = null, variablesExtras = {}) {
            const tipo = this.normalizarTipoPlantilla(tipoRaw);
            let plantilla = '';
            if (tipo === 'ausente') {
                if (empleado && empleado._esVacaciones) {
                    plantilla = this.config.plantillaVacaciones || DEFAULT_CONFIG_WHATSAPP.plantillaVacaciones;
                } else if (empleado && empleado._esPermiso) {
                    plantilla = this.config.plantillaPermiso || DEFAULT_CONFIG_WHATSAPP.plantillaPermiso;
                } else {
                    plantilla = this.config.plantillaAusente || DEFAULT_CONFIG_WHATSAPP.plantillaAusente;
                }
            } else if (tipo === 'vacaciones') {
                plantilla = this.config.plantillaVacaciones || DEFAULT_CONFIG_WHATSAPP.plantillaVacaciones;
            } else if (tipo === 'permisos' || tipo === 'permiso') {
                plantilla = this.config.plantillaPermiso || DEFAULT_CONFIG_WHATSAPP.plantillaPermiso;
            } else if (tipo === 'salida_faltante') {
                plantilla = this.config.plantillaSalidaFaltante || DEFAULT_CONFIG_WHATSAPP.plantillaSalidaFaltante;
            } else if (tipo === 'emergencia') {
                plantilla = this.config.plantillaEmergencia || DEFAULT_CONFIG_WHATSAPP.plantillaEmergencia;
            } else if (tipo.startsWith('custom_')) {
                if (window._plantillasPersonalizadas && window._plantillasPersonalizadas[tipo]) {
                    plantilla = window._plantillasPersonalizadas[tipo].texto || '';
                } else if (variablesExtras.plantillaCustom) {
                    plantilla = variablesExtras.plantillaCustom;
                }
            } else {
                plantilla = this.config.plantillaNoRegistro || DEFAULT_CONFIG_WHATSAPP.plantillaNoRegistro;
            }

            const link = this.config.enlaceApp || DEFAULT_CONFIG_WHATSAPP.enlaceApp;
            const ahora = new Date();
            const diaStr = ahora.getDate().toString().padStart(2, '0');
            const mesStr = (ahora.getMonth() + 1).toString().padStart(2, '0');
            const fechaStr = variablesExtras.fecha || `${diaStr}/${mesStr}/${ahora.getFullYear()}`;

            const hStr = ahora.getHours().toString().padStart(2, '0');
            const mStr = ahora.getMinutes().toString().padStart(2, '0');
            const horaStr = variablesExtras.hora || `${hStr}:${mStr}`;

            const rawNombre = empleado?.nombre || variablesExtras.nombre || 'Colaborador';
            const nombreEmp = (typeof window.obtenerPrimerNombreYPrimerApellido === 'function')
                ? window.obtenerPrimerNombreYPrimerApellido(rawNombre)
                : (typeof obtenerPrimerNombreYPrimerApellido === 'function' ? obtenerPrimerNombreYPrimerApellido(rawNombre) : rawNombre);
            const cargoEmp = empleado?.cargo || variablesExtras.cargo || 'Personal';
            const areaEmp = empleado?.area || variablesExtras.area || 'Operaciones';
            const razonEmp = variablesExtras.razon || empleado?._razonAusencia || 'autorizado';

            return plantilla
                .replace(/\{nombre\}/gi, nombreEmp)
                .replace(/\{fecha\}/gi, fechaStr)
                .replace(/\{hora\}/gi, horaStr)
                .replace(/\{link\}/gi, link)
                .replace(/\{cargo\}/gi, cargoEmp)
                .replace(/\{area\}/gi, areaEmp)
                .replace(/\{razon\}/gi, razonEmp);
        },

        // Alias retrocompatible
        formatearMensajeNoRegistro(empleado, fechaCustom = null, horaCustom = null) {
            return this.formatearMensaje('no_registro', empleado, { fecha: fechaCustom, hora: horaCustom });
        },

        // Enviar notificación a un solo empleado con tipo de plantilla
        async enviarNotificacionEmpleado(empleado, tipoRaw = 'no_registro', variablesExtras = {}) {
            const tipo = this.normalizarTipoPlantilla(tipoRaw);
            const telefono = empleado?.telefono || empleado?.celular || empleado?.phone;
            const nombreEmp = empleado?.nombre || variablesExtras?.nombre || 'Colaborador';
            const idEmp = empleado?.id || variablesExtras?.id || '';

            if (!telefono) {
                const errRes = { ok: false, error: `El colaborador ${nombreEmp} no tiene teléfono registrado.` };
                this.registrarLogEnvio({
                    idEmpleado: idEmp,
                    nombreEmpleado: nombreEmp,
                    telefono: 'SIN_NUMERO',
                    tipoNotificacion: tipo,
                    estado: 'SIN_TELEFONO',
                    mensajeEnviado: '',
                    detalleRespuesta: errRes.error,
                    origen: variablesExtras.origen || 'MANUAL'
                });
                return errRes;
            }

            const mensaje = this.formatearMensaje(tipo, empleado, variablesExtras);
            
            let imagenBase64 = (variablesExtras && variablesExtras.imagenBase64) ? variablesExtras.imagenBase64 : this.obtenerImagenPlantilla(tipo);
            
            let res = null;
            if (imagenBase64) {
                res = await this.enviarMensajeImagen(telefono, mensaje, imagenBase64);
            } else {
                res = await this.enviarMensajeTexto(telefono, mensaje);
            }

            // Registrar log de auditoría en Google Sheets (Hoja LOGS_WHATSAPP)
            this.registrarLogEnvio({
                idEmpleado: idEmp,
                nombreEmpleado: nombreEmp,
                telefono: telefono,
                tipoNotificacion: tipo,
                estado: res.ok ? 'ENVIADO' : 'ERROR',
                mensajeEnviado: mensaje,
                detalleRespuesta: res.mensajeId || res.error || (res.ok ? 'OK' : 'Error de envío'),
                origen: variablesExtras.origen || 'MANUAL'
            });

            return res;
        },

        // Enviar notificaciones masivas con retardo preventivo entre envíos y registro en lote
        async enviarNotificacionesMasivas(listaEmpleados, onProgress = null, tipoRaw = 'no_registro', variablesExtras = {}) {
            if (typeof onProgress === 'string') {
                tipoRaw = onProgress;
                onProgress = null;
            }
            const tipo = this.normalizarTipoPlantilla(tipoRaw);
            const resultados = {
                total: listaEmpleados.length,
                enviados: 0,
                fallidos: 0,
                sinTelefono: 0,
                detalles: []
            };

            const batchLogs = [];

            for (let i = 0; i < listaEmpleados.length; i++) {
                const emp = listaEmpleados[i];
                const telefono = emp?.telefono || emp?.celular;
                const nombreEmp = emp?.nombre || emp?.id || 'Colaborador';
                const idEmp = emp?.id || '';

                if (!telefono || !this.normalizarNumero(telefono)) {
                    resultados.sinTelefono++;
                    resultados.detalles.push({
                        empleado: emp,
                        exito: false,
                        motivo: 'Sin número de WhatsApp registrado'
                    });
                    batchLogs.push({
                        idEmpleado: idEmp,
                        nombreEmpleado: nombreEmp,
                        telefono: 'SIN_NUMERO',
                        tipoNotificacion: tipo,
                        estado: 'SIN_TELEFONO',
                        mensajeEnviado: '',
                        detalleRespuesta: 'Sin número de WhatsApp registrado',
                        origen: variablesExtras.origen || 'MASIVO'
                    });
                } else {
                    const mensaje = this.formatearMensaje(tipo, emp, variablesExtras);
                    let imagenBase64 = (variablesExtras && variablesExtras.imagenBase64) ? variablesExtras.imagenBase64 : this.obtenerImagenPlantilla(tipo);

                    let res;
                    if (imagenBase64) {
                        res = await this.enviarMensajeImagen(telefono, mensaje, imagenBase64);
                    } else {
                        res = await this.enviarMensajeTexto(telefono, mensaje);
                    }

                    if (res.ok) {
                        resultados.enviados++;
                        resultados.detalles.push({
                            empleado: emp,
                            exito: true,
                            mensajeId: res.mensajeId
                        });
                        batchLogs.push({
                            idEmpleado: idEmp,
                            nombreEmpleado: nombreEmp,
                            telefono: telefono,
                            tipoNotificacion: tipo,
                            estado: 'ENVIADO',
                            mensajeEnviado: mensaje,
                            detalleRespuesta: res.mensajeId || 'OK',
                            origen: variablesExtras.origen || 'MASIVO'
                        });
                    } else {
                        resultados.fallidos++;
                        resultados.detalles.push({
                            empleado: emp,
                            exito: false,
                            motivo: res.error
                        });
                        batchLogs.push({
                            idEmpleado: idEmp,
                            nombreEmpleado: nombreEmp,
                            telefono: telefono,
                            tipoNotificacion: tipo,
                            estado: 'ERROR',
                            mensajeEnviado: mensaje,
                            detalleRespuesta: res.error || 'Error de envío',
                            origen: variablesExtras.origen || 'MASIVO'
                        });
                    }
                }

                if (typeof onProgress === 'function') {
                    onProgress({
                        actual: i + 1,
                        total: listaEmpleados.length,
                        enviados: resultados.enviados,
                        fallidos: resultados.fallidos,
                        sinTelefono: resultados.sinTelefono,
                        empleadoActual: emp
                    });
                }

                // Pausa de 1.2 segundos entre envíos sucesivos para no saturar la sesión
                if (i < listaEmpleados.length - 1) {
                    await new Promise(r => setTimeout(r, 1200));
                }
            }

            // Guardar lote completo de logs en la hoja LOGS_WHATSAPP
            if (batchLogs.length > 0) {
                this.registrarLogsEnvioBatch(batchLogs);
            }

            return resultados;
        },

        // Registrar log individual de auditoría en Google Sheets (Hoja LOGS_WHATSAPP)
        _obtenerNombreSupervisorActual() {
            try {
                if (window.currentUser && (window.currentUser.nombre || window.currentUser.id)) {
                    return window.currentUser.nombre || window.currentUser.id;
                }
                const sess = localStorage.getItem('SUPERVISOR_SESSION');
                if (sess) {
                    const parsed = JSON.parse(sess);
                    return parsed.nombre || parsed.usuario || parsed.id || 'Supervisor';
                }
            } catch (e) { }
            return 'Sistema';
        },

        async registrarLogEnvio(logData) {
            try {
                const ahora = new Date();
                const diaStr = ahora.getDate().toString().padStart(2, '0');
                const mesStr = (ahora.getMonth() + 1).toString().padStart(2, '0');
                const fechaStr = `${ahora.getFullYear()}-${mesStr}-${diaStr}`;
                const horaStr = `${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')}:${ahora.getSeconds().toString().padStart(2, '0')}`;
                const sup = this._obtenerNombreSupervisorActual();

                const payload = {
                    accion: 'registrarLogWhatsApp',
                    fecha: logData.fecha || fechaStr,
                    hora: logData.hora || horaStr,
                    timestamp: logData.timestamp || ahora.toISOString(),
                    supervisor: logData.supervisor || sup,
                    nombreEmpleado: logData.nombreEmpleado || logData.destinatario || logData.nombre || '',
                    idEmpleado: logData.idEmpleado || logData.empleadoId || logData.id || '',
                    telefono: logData.telefono || '',
                    tipoNotificacion: logData.tipoNotificacion || logData.tipo || 'GENERAL',
                    estado: logData.estado || 'ENVIADO',
                    mensaje: logData.mensaje || logData.mensajeEnviado || '',
                    detalleRespuesta: logData.detalleRespuesta || logData.detalle || logData.error || 'OK',
                    origen: logData.origen || 'MANUAL',
                    ...logData
                };

                if (window.FirebaseBackend && window.FirebaseBackend.registrarLogWhatsApp) {
                    await window.FirebaseBackend.registrarLogWhatsApp(payload);
                } else if (typeof jsonpRequest === 'function') {
                    await jsonpRequest(payload);
                }
            } catch (e) {
                console.warn("[OpenWA] No se pudo registrar log individual de WhatsApp:", e);
            }
        },

        // Registrar lote de logs de auditoría en Google Sheets (Hoja LOGS_WHATSAPP)
        async registrarLogsEnvioBatch(logsArray) {
            if (!logsArray || logsArray.length === 0) return;
            try {
                const ahora = new Date();
                const diaStr = ahora.getDate().toString().padStart(2, '0');
                const mesStr = (ahora.getMonth() + 1).toString().padStart(2, '0');
                const fechaStr = `${ahora.getFullYear()}-${mesStr}-${diaStr}`;
                const horaStr = `${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')}:${ahora.getSeconds().toString().padStart(2, '0')}`;
                const sup = this._obtenerNombreSupervisorActual();

                const logsFormateados = logsArray.map(l => ({
                    fecha: l.fecha || fechaStr,
                    hora: l.hora || horaStr,
                    timestamp: l.timestamp || ahora.toISOString(),
                    supervisor: l.supervisor || sup,
                    nombreEmpleado: l.nombreEmpleado || l.destinatario || l.nombre || '',
                    idEmpleado: l.idEmpleado || l.empleadoId || l.id || '',
                    telefono: l.telefono || '',
                    tipoNotificacion: l.tipoNotificacion || l.tipo || 'GENERAL',
                    estado: l.estado || 'ENVIADO',
                    mensaje: l.mensaje || l.mensajeEnviado || '',
                    detalleRespuesta: l.detalleRespuesta || l.detalle || l.error || 'OK',
                    origen: l.origen || 'AUTOMATICO_RECORDATORIO',
                    ...l
                }));

                const payload = {
                    accion: 'registrarLogWhatsApp',
                    logs: logsFormateados,
                    supervisor: sup
                };

                if (window.FirebaseBackend && window.FirebaseBackend.registrarLogWhatsApp) {
                    await window.FirebaseBackend.registrarLogWhatsApp(payload);
                } else if (typeof jsonpRequest === 'function') {
                    await jsonpRequest(payload);
                }
            } catch (e) {
                console.warn("[OpenWA] Error en registro batch de logs WhatsApp:", e);
            }
        },

        // Obtener historial de logs desde Google Sheets
        async obtenerLogsWhatsApp(limite = 150) {
            try {
                if (window.FirebaseBackend && window.FirebaseBackend.obtenerLogsWhatsApp) {
                    return await window.FirebaseBackend.obtenerLogsWhatsApp({ limite });
                } else if (typeof jsonpRequest === 'function') {
                    return await jsonpRequest({ accion: 'obtenerLogsWhatsApp', limite });
                }
            } catch (e) {
                console.error("[OpenWA] Error consultando logs de WhatsApp:", e);
                return { ok: false, error: e.toString(), logs: [] };
            }
        },

        // Chequeo de reglas automáticas de recordatorio
        async ejecutarChequeoAutomatico(listaEmpleadosSinMarcar = [], forzar = false) {
            if (!forzar && (!this.config.activo || !this.config.autoEnvioNoRegistro)) {
                return { ejecutado: false, motivo: 'Envío automático desactivado' };
            }

            const ahora = new Date();
            const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
            const diaActual = diasSemana[ahora.getDay()];
            const diasPermitidos = this.config.diasEnvio || ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'];

            if (!forzar && !diasPermitidos.includes(diaActual)) {
                return { ejecutado: false, motivo: `Hoy (${diaActual}) no es un día configurado para envíos automáticos` };
            }

            const horaCorte = this.config.horaCorteNoRegistro || '08:15';
            const [corteH, corteM] = horaCorte.split(':').map(Number);
            const horaActualMinutos = ahora.getHours() * 60 + ahora.getMinutes();
            const corteMinutos = (corteH * 60) + (corteM || 0);

            if (!forzar && horaActualMinutos < corteMinutos) {
                return { ejecutado: false, motivo: `Aún no se alcanza la hora de corte (${horaCorte})` };
            }

            const fechaHoyStr = ahora.toISOString().split('T')[0];
            const checkKey = `tcontrol_waha_autocheck_${fechaHoyStr}`;
            if (!forzar && localStorage.getItem(checkKey)) {
                return { ejecutado: false, motivo: `El chequeo automático de hoy (${fechaHoyStr}) ya fue procesado` };
            }

            if (!forzar) {
                localStorage.setItem(checkKey, new Date().toISOString());
            }
            this._ultimoCheckAuto = new Date();

            return await this.enviarNotificacionesMasivas(listaEmpleadosSinMarcar, null, 'no_registro');
        },

        // Notificar a los Supervisores Administradores sobre una nueva solicitud de almuerzo o refrigerio
        async notificarSupAdminsSolicitudInvitado(detalles = {}) {
            try {
                let destinatarios = [];
                if (typeof db !== 'undefined' && db) {
                    try {
                        const snap = await db.collection('empleados').get();
                        snap.forEach(doc => {
                            const d = doc.data() || {};
                            const id = String(d.id || doc.id).trim();
                            const supVal = String(d.supervisor || d.rol || '').trim().toUpperCase();
                            if ((id === '1058' || supVal.includes('ADMIN')) && d.telefono) {
                                destinatarios.push({
                                    id: id,
                                    nombre: d.nombre || 'Sup. Admin',
                                    telefono: d.telefono
                                });
                            }
                        });
                    } catch (e) {
                        console.warn("[OpenWA] Error consultando Sup. Admins en Firestore:", e);
                    }
                }

                if (destinatarios.length === 0) {
                    destinatarios = [
                        { id: '1058', nombre: 'Fernando Sanmartin', telefono: '0984660105' },
                        { id: '8', nombre: 'Martina Rodriguez', telefono: '0962707809' }
                    ];
                }

                const isAlm = (detalles.tipoSolicitud === 'ALMUERZO_EXTRA' || detalles.subtipo === 'ALMUERZO_EXTRA');
                const tipoLabel = isAlm
                    ? '🍱 Almuerzo Extra'
                    : (detalles.subtipo === 'REFRIGERIO_GALLETAS' ? '🍪 Break con Galletas TCONTROL' : '🥪 Refrigerio (Sánduche)');

                const fechaReq = detalles.fecha || new Date().toISOString().slice(0, 10);
                const horaReq = detalles.horaServicio ? `\n• *Hora para servir:* ${detalles.horaServicio}` : '';
                const obs = detalles.observaciones ? `\n• *Detalle:* ${detalles.observaciones}` : '';

                const mensaje = 
                    `🔔 *TCONTROL - Nueva Solicitud de Catering / Invitados*\n\n` +
                    `Estimado(a) *Sup. Admin*, se ha registrado un nuevo pedido de invitados:\n\n` +
                    `• *Servicio:* ${tipoLabel} (x${detalles.cantidad || 1})\n` +
                    `• *Fecha requerida:* ${fechaReq}${horaReq}\n` +
                    `• *Solicitante:* ${detalles.empleadoNombre || 'Colaborador'} (${detalles.empleadoArea || 'Área'})\n` +
                    `• *Invitado:* ${detalles.invitado || 'Invitado'} ${detalles.empresa ? '· ' + detalles.empresa : ''}${obs}\n\n` +
                    `👉 *Acción requerida:* Favor ingresar al panel de Supervisor (pestaña *Invitados & Catering*) para revisar y coordinar la confirmación y atención.`;

                const envios = destinatarios.map(d => this.enviarMensajeTexto(d.telefono, mensaje));
                await Promise.allSettled(envios);
                return { ok: true, total: destinatarios.length };
            } catch (err) {
                console.warn("[OpenWA] Error en notificarSupAdminsSolicitudInvitado:", err);
                return { ok: false, error: err.message };
            }
        },

        // Enviar recordatorio manual/periódico a Sup. Admins con el resumen de solicitudes pendientes
        async notificarSupAdminsRecordatorioPendientes(solicitudesPendientes = []) {
            try {
                let destinatarios = [];
                if (typeof db !== 'undefined' && db) {
                    try {
                        const snap = await db.collection('empleados').get();
                        snap.forEach(doc => {
                            const d = doc.data() || {};
                            const id = String(d.id || doc.id).trim();
                            const supVal = String(d.supervisor || d.rol || '').trim().toUpperCase();
                            if ((id === '1058' || supVal.includes('ADMIN')) && d.telefono) {
                                destinatarios.push({
                                    id: id,
                                    nombre: d.nombre || 'Sup. Admin',
                                    telefono: d.telefono
                                });
                            }
                        });
                    } catch (e) {}
                }
                if (destinatarios.length === 0) {
                    destinatarios = [
                        { id: '1058', nombre: 'Fernando Sanmartin', telefono: '0984660105' },
                        { id: '8', nombre: 'Martina Rodriguez', telefono: '0962707809' }
                    ];
                }

                const count = solicitudesPendientes.length;
                const resumenLineas = solicitudesPendientes.slice(0, 5).map(s => {
                    const isAlm = (s.subtipo === 'ALMUERZO_EXTRA' || s.tipoSolicitud === 'ALMUERZO_EXTRA');
                    const icon = isAlm ? '🍱' : '🥪';
                    return `• ${icon} ${s.fecha}: ${s.invitado} (x${s.cantidad}) - Por: ${s.solicitante || s.empleadoNombre}`;
                }).join('\n');

                const mensaje = 
                    `🔔 *TCONTROL - Recordatorio para Sup. Admin*\n\n` +
                    `Estimado(a) *Sup. Admin*, existen *${count}* solicitud(es) de refrigerios o almuerzos de invitados pendientes de revisión:\n\n` +
                    `${resumenLineas}\n${count > 5 ? `...y ${count - 5} más.\n` : ''}\n` +
                    `👉 Favor ingresar al panel de Supervisor (pestaña *Invitados & Catering*) para confirmar los pedidos con cocina.`;

                const envios = destinatarios.map(d => this.enviarMensajeTexto(d.telefono, mensaje));
                await Promise.allSettled(envios);
                return { ok: true, total: destinatarios.length };
            } catch (err) {
                console.warn("[OpenWA] Error en notificarSupAdminsRecordatorioPendientes:", err);
                return { ok: false, error: err.message };
            }
        },

        // Notificar a Sup. Admins cuando una solicitud de invitado es cancelada o eliminada
        async notificarSupAdminsCancelacionInvitado(detalles = {}) {
            try {
                let destinatarios = [];
                if (typeof db !== 'undefined' && db) {
                    try {
                        const snap = await db.collection('empleados').get();
                        snap.forEach(doc => {
                            const d = doc.data() || {};
                            const id = String(d.id || doc.id).trim();
                            const supVal = String(d.supervisor || d.rol || '').trim().toUpperCase();
                            if ((id === '1058' || supVal.includes('ADMIN')) && d.telefono) {
                                destinatarios.push({
                                    id: id,
                                    nombre: d.nombre || 'Sup. Admin',
                                    telefono: d.telefono
                                });
                            }
                        });
                    } catch (e) {}
                }
                if (destinatarios.length === 0) {
                    destinatarios = [
                        { id: '1058', nombre: 'Fernando Sanmartin', telefono: '0984660105' },
                        { id: '8', nombre: 'Martina Rodriguez', telefono: '0962707809' }
                    ];
                }

                const tipoLabel = (detalles.subtipo === 'ALMUERZO_EXTRA' || detalles.tipoSolicitud === 'ALMUERZO_EXTRA')
                    ? '🍱 Almuerzo Extra'
                    : ((detalles.subtipo === 'REFRIGERIO_SANDUCHE') ? '🥪 Sánduche' : '🍪 Break Galletas');

                const mensaje = 
                    `🗑️ *TCONTROL - Solicitud de Invitado Cancelada / Eliminada*\n\n` +
                    `Estimado(a) *Sup. Admin*, se ha retirado una solicitud de invitados en la hoja *ALMUERZOS_EXTRA*:\n\n` +
                    `• *Servicio:* ${tipoLabel} (x${detalles.cantidad || 1})\n` +
                    `• *Fecha:* ${detalles.fecha || 'Hoy'}\n` +
                    `• *Invitado:* ${detalles.invitado || 'Invitado'}\n` +
                    `• *Solicitante:* ${detalles.solicitante || 'Colaborador'}\n` +
                    `• *Eliminado por:* ${detalles.eliminadoPor || 'Supervisor'}\n\n` +
                    `ℹ️ _El registro ha sido eliminado del sistema y de la lista de cocina._`;

                const envios = destinatarios.map(d => this.enviarMensajeTexto(d.telefono, mensaje));
                await Promise.allSettled(envios);
                return { ok: true, total: destinatarios.length };
            } catch (err) {
                console.warn("[OpenWA] Error en notificarSupAdminsCancelacionInvitado:", err);
                return { ok: false, error: err.message };
            }
        },

        // Notificar al nuevo colaborador con el link de acceso y avisar a los Supervisores Administradores
        async notificarNuevoEmpleadoRegistrado(empInfo = {}, creadorNombre = 'Supervisor') {
            try {
                // URL oficial de acceso a la app
                const appUrl = 'https://asistencia.tcontrolsa.com/index.html';
                const supUrl = 'https://asistencia.tcontrolsa.com/supervisor.html';

                const nombre = empInfo.nombre || 'Colaborador';
                const id = empInfo.id || '';
                const area = empInfo.area || 'General';
                const cargo = empInfo.cargo || 'Personal';
                const telefono = empInfo.telefono || '';
                const rol = empInfo.supervisor === 'SUPERVISOR ADMIN' ? '👑 Supervisor Admin' : (empInfo.supervisor === 'SI' ? '🛡️ Supervisor' : '👤 Empleado regular');

                // 1. Enviar mensaje de bienvenida al nuevo colaborador (si tiene teléfono)
                let resColaborador = { ok: false };
                if (telefono) {
                    const msgBienvenida = 
                        `👋 *¡Hola, ${nombre}! Bienvenido/a a TCONTROL.*\n\n` +
                        `Te informamos que has sido registrado/a en el sistema de control de asistencia.\n\n` +
                        `👤 *Tus Datos de Acceso:*\n` +
                        `🆔 *ID:* ${id}\n` +
                        `🏢 *Área:* ${area}\n` +
                        `💼 *Cargo:* ${cargo}\n\n` +
                        `🌐 *Enlace de Ingreso a la App:*\n` +
                        `👉 ${appUrl}\n\n` +
                        `📱 *Instrucciones para tu primer ingreso:*\n` +
                        `1. Abre el enlace arriba desde tu teléfono o computador.\n` +
                        `2. Digita tu número de ID (${id}).\n` +
                        `3. El sistema te solicitará crear y registrar tu contraseña o PIN personal de 4 dígitos.\n\n` +
                        `_¡Muchos éxitos y bienvenido/a al equipo!_ ✨`;

                    resColaborador = await this.enviarMensajeTexto(telefono, msgBienvenida);
                    if (resColaborador.ok && this.registrarLogEnvio) {
                        this.registrarLogEnvio({
                            tipo: 'BIENVENIDA_NUEVO_EMPLEADO',
                            empleadoId: id,
                            empleadoNombre: nombre,
                            telefono: telefono,
                            mensaje: msgBienvenida,
                            estado: 'ENVIADO'
                        });
                    }
                }

                // 2. Notificar a los Supervisores / Supervisor Admins
                let destinatarios = [];
                if (typeof db !== 'undefined' && db) {
                    try {
                        const snap = await db.collection('empleados').get();
                        snap.forEach(doc => {
                            const d = doc.data() || {};
                            const docId = String(d.id || doc.id).trim();
                            const supVal = String(d.supervisor || d.rol || '').trim().toUpperCase();
                            if ((docId === '1058' || supVal.includes('ADMIN') || supVal === 'SI') && d.telefono && docId !== id) {
                                destinatarios.push({
                                    id: docId,
                                    nombre: d.nombre || 'Supervisor',
                                    telefono: d.telefono
                                });
                            }
                        });
                    } catch (e) {}
                }
                if (destinatarios.length === 0) {
                    destinatarios = [
                        { id: '1058', nombre: 'Fernando Sanmartin', telefono: '0984660105' },
                        { id: '8', nombre: 'Martina Rodriguez', telefono: '0962707809' }
                    ];
                }

                const fechaHoraStr = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });
                const msgSup = 
                    `🔔 *[TCONTROL] Nuevo Colaborador Registrado*\n\n` +
                    `Se ha registrado un nuevo usuario en la plataforma:\n\n` +
                    `👤 *Colaborador:* ${nombre}\n` +
                    `🆔 *ID:* ${id}\n` +
                    `🏢 *Área:* ${area}\n` +
                    `💼 *Cargo:* ${cargo}\n` +
                    `📱 *WhatsApp:* ${telefono || 'No registrado'}\n` +
                    `🛡️ *Rol:* ${rol}\n` +
                    `✍️ *Registrado por:* ${creadorNombre}\n` +
                    `📅 *Fecha:* ${fechaHoraStr}\n\n` +
                    `🌐 *Panel Supervisor:* ${supUrl}`;

                const enviosSup = destinatarios.map(d => this.enviarMensajeTexto(d.telefono, msgSup));
                await Promise.allSettled(enviosSup);

                return { ok: true, enviadoColaborador: resColaborador.ok, supervisoresNotificados: destinatarios.length };
            } catch (err) {
                console.warn("[OpenWA] Error en notificarNuevoEmpleadoRegistrado:", err);
                return { ok: false, error: err.message };
            }
        }
    };

    // Helper global fallback para verificación y disparo manual de alertas
    window.verificarAutoEnvioWhatsApp = window.verificarAutoEnvioWhatsApp || function(forzar = false) {
        if (typeof window.abrirModalNotificarWhatsApp === 'function') {
            window.abrirModalNotificarWhatsApp('sin_marcar');
        } else if (typeof window.abrirModalEnvioWhatsApp === 'function') {
            window.abrirModalEnvioWhatsApp('sin_marcar');
        } else {
            console.warn("[OpenWA] verificarAutoEnvioWhatsApp invocado antes de inicialización completa");
        }
    };

    // Auto-inicialización
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => OpenWAService.inicializar());
    } else {
        OpenWAService.inicializar();
    }

    OpenWAService.DEFAULT_CONFIG_WHATSAPP = DEFAULT_CONFIG_WHATSAPP;
    window.OpenWAService = OpenWAService;
    window.DEFAULT_CONFIG_WHATSAPP = DEFAULT_CONFIG_WHATSAPP;

})(window);
