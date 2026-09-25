// =========================================================
// MOTOR FIREBASE PARA TCONTROL ASISTENCIA
// =========================================================

// Configuración de Firebase provista por el usuario
const firebaseConfig = {
    apiKey: "AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4",
    authDomain: "tcontrol-asistencia.firebaseapp.com",
    projectId: "tcontrol-asistencia",
    storageBucket: "tcontrol-asistencia.firebasestorage.app",
    messagingSenderId: "400445408344",
    appId: "1:400445408344:web:1ef803575febd8d311362d",
    measurementId: "G-X0NRST4Y8L"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
try {
    db.settings({
        experimentalForceLongPolling: true
    });
} catch (e) {
    console.warn("Aviso configurando settings de Firestore:", e);
}
window.db = db;

// Variable global para usar desde INDEX_PRUEBAS.html
window.FirebaseBackend = {

    // ==========================================
    // ENRUTADOR PRINCIPAL (Imita procesarAccion)
    // ==========================================
    async procesarAccion(params) {
        const accion = (params.accion || "").trim();
        console.log("🔥 Firebase ejecutando acción:", accion);
        try {
            switch (accion) {
                case 'verificarDispositivo':
                    return await this.verificarDispositivo(params);
                case 'verificarEmpleadoTienePin':
                    return await this.verificarEmpleadoTienePin(params);
                case 'registrarDispositivo':
                    return await this.registrarDispositivoConPIN(params);
                case 'verificarPIN':
                    return await this.verificarPIN(params);
                case 'actualizarPerfilEmpleado':
                    return await this.actualizarPerfilEmpleado(params);
                case 'obtenerEstado':
                    return await this.obtenerEstado(params);
                case 'guardarRegistro':
                    return await this.guardarRegistro(params);
                case 'obtenerRegistros':
                    return await this.obtenerRegistros(params);
                case 'actualizarBaseCampo':
                    return await this.actualizarBaseCampo(params);
                case 'obtenerPersonalArea':
                    return await this.obtenerPersonalArea(params);
                case 'obtenerEmpleadosTaller':
                    return await this.obtenerEmpleadosTaller(params);
                case 'actualizarAutorizacionExtras':
                    return await this.actualizarAutorizacionExtras(params);
                case 'obtenerConfiguraciones':
                    return await this.obtenerConfiguraciones(params);
                case 'guardarConfiguraciones':
                    return await this.guardarConfiguraciones(params);
                case 'obtenerMenuSemanal':
                    return await this.obtenerMenuSemanal(params);
                case 'guardarMenuSemanal':
                    return await this.guardarMenuSemanal(params);
                case 'archivarMenuConsumido':
                    return await this.archivarMenuConsumido(params);
                case 'obtenerHistorialMenuSugerencias':
                    return await this.obtenerHistorialMenuSugerencias(params);
                case 'obtenerPreguntasCultura':
                    return await this.obtenerPreguntasCultura(params);
                case 'guardarPreguntasCultura':
                    return await this.guardarPreguntasCultura(params);
                case 'toggleCulturaTcontrol':
                    return await this.toggleCulturaTcontrol(params);
                case 'toggleCulturaEmpleado':
                    return await this.toggleCulturaEmpleado(params);
                case 'toggleEmergencia':
                    return await this.toggleEmergencia(params);
                case 'verificarClaveGuardia':
                    return await this.verificarClaveGuardia(params);
                case 'obtenerListaCatering':
                    return await this.obtenerListaCatering(params);
                case 'marcarAlmuerzoConsumido':
                    return await this.marcarAlmuerzoConsumido(params);
                case 'obtenerSupervisores':
                    return await this.obtenerSupervisores(params);
                case 'agregarSupervisor':
                    return await this.agregarSupervisor(params);
                case 'eliminarSupervisor':
                    return await this.eliminarSupervisor(params);
                case 'obtenerDatosSupervisor':
                    return await this.obtenerDatosSupervisor(params);
                case 'verificarCambios':
                    return await this.verificarCambios(params);
                case 'actualizarAlmuerzoSupervisor':
                    return await this.actualizarAlmuerzoSupervisor(params);
                case 'obtenerAsistenciaEmpleado':
                    return await this.obtenerAsistenciaEmpleado(params);
                case 'obtenerReporteMensual':
                    return await this.obtenerReporteMensual(params);
                case 'actualizarRegistroGeneral':
                case 'actualizarRegistroArchivado':
                    return await this.actualizarRegistroGeneral(params);
                case 'guardarModalidadSupervisor':
                    return await this.guardarModalidadSupervisor(params);
                case 'justificarDia':
                    return await this.justificarDia(params);
                case 'actualizarEmpleado':
                    return await this.actualizarEmpleado(params);
                case 'actualizarMasivoEmpleados':
                    return await this.actualizarMasivoEmpleados(params);
                case 'eliminarRegistro':
                    return await this.eliminarRegistro(params);
                case 'eliminarEmpleadoDefinitivo':
                    return await this.eliminarEmpleadoDefinitivo(params);
                case 'desvincularColaborador':
                    return await this.desvincularColaborador(params);
                case 'listarDesvinculados':
                    return await this.listarDesvinculados(params);
                case 'resetearPinesTodosLosEmpleados':
                case 'resetearPinesEmpleados':
                    return await this.resetearPinesTodosLosEmpleados(params);

                case 'desvincularDispositivo':
                    return await this.desvincularDispositivo(params);
                case 'escribirHojaActualizar':
                    return await this._post(params);
                case 'leerHojaActualizar':
                    return await this._jsonp(params);
                case 'registrarLog':
                    return await this.registrarLog(params);
                case 'registrarLogWhatsApp':
                    return await this.registrarLogWhatsApp(params);
                case 'obtenerLogsWhatsApp':
                    return await this.obtenerLogsWhatsApp(params);
                case 'guardarPermisoSupervisor':
                    return await this.guardarPermisoSupervisor(params);
                case 'crearSolicitudInvitado':
                    return await this.crearSolicitudInvitado(params);
                case 'obtenerSolicitudesInvitados':
                    return await this.obtenerSolicitudesInvitados(params);
                case 'actualizarEstadoSolicitudInvitado':
                    return await this.actualizarEstadoSolicitudInvitado(params);
                case 'eliminarSolicitudInvitado':
                case 'eliminarAlmuerzoExtra':
                    return await this.eliminarSolicitudInvitado(params);
                case 'registrarAlmuerzoExtra':
                case 'archivarRegistros':
                case 'crearReporteGoogleSheets':
                case 'archivarMenuConsumido':
                case 'obtenerHistorialMenuSugerencias':
                    return await this._jsonp(params);
                case 'obtenerAlmuerzosExtra':
                    try {
                        const resJson = await this._jsonp(params, 0, 1, 6000);
                        if (resJson && resJson.ok && Array.isArray(resJson.almuerzos)) {
                            try {
                                localStorage.setItem('tcontrol_almuerzos_extra_cache_v2', JSON.stringify({
                                    almuerzos: resJson.almuerzos,
                                    lastSync: new Date().toISOString()
                                }));
                            } catch (e) { }
                            return resJson;
                        }
                        throw new Error((resJson && resJson.error) || 'Respuesta inválida de Sheets');
                    } catch (eAlm) {
                        try {
                            const cached = localStorage.getItem('tcontrol_almuerzos_extra_cache_v2');
                            if (cached) {
                                const parsed = JSON.parse(cached);
                                if (parsed && parsed.almuerzos) {
                                    return { ok: true, almuerzos: parsed.almuerzos, desdeCache: true };
                                }
                            }
                        } catch (eC) { }
                        return { ok: true, almuerzos: [], error: eAlm.message || eAlm.toString(), desdeCache: false };
                    }
                case 'obtenerVacacionesEmpleado':
                    // Retorno instantáneo desde caché local si está disponible (< 6 horas) y no es forzado
                    if (!params.force) {
                        try {
                            const storedVac = localStorage.getItem('tcontrol_vacaciones_cache_v3') || localStorage.getItem('tcontrol_vacaciones_cache_v2');
                            if (storedVac) {
                                const parsedVac = JSON.parse(storedVac);
                                const ageMs = parsedVac.lastSync ? (Date.now() - new Date(parsedVac.lastSync).getTime()) : Infinity;
                                if (ageMs < 6 * 3600 * 1000 && parsedVac.kpiVacacionesIndividual && Object.keys(parsedVac.kpiVacacionesIndividual).length > 0) {
                                    window.kpiVacaciones = parsedVac.kpiVacaciones;
                                    window._kpiVacacionesCache = parsedVac.kpiVacaciones;
                                    window.kpiVacacionesIndividual = parsedVac.kpiVacacionesIndividual;
                                    const rawVacList = parsedVac.vacaciones || [];
                                    const empIdReq = params.empleadoId ? String(params.empleadoId).trim() : null;
                                    const empCedReq = params.cedula ? String(params.cedula).trim() : null;
                                    let filteredVacs = rawVacList;
                                    let tHoy = null;
                                    let rHoy = null;

                                    if (empIdReq || empCedReq) {
                                        filteredVacs = rawVacList.filter(v => {
                                            const vId = String(v.empleadoId || v.id || (Array.isArray(v) ? v[1] : '')).trim();
                                            const vCed = String(v.cedula || (Array.isArray(v) ? v[0] : '')).trim();
                                            return (empIdReq && vId === empIdReq) || (empCedReq && (vCed === empCedReq || vId === empCedReq));
                                        });
                                        const kpiInd = parsedVac.kpiVacacionesIndividual || {};
                                        const info = kpiInd[empIdReq] || (empCedReq ? kpiInd[empCedReq] : null);
                                        if (info) {
                                            tHoy = info.tomadas;
                                            rHoy = info.restantes;
                                        }
                                    }

                                    return {
                                        ok: true,
                                        vacaciones: filteredVacs,
                                        vacacionesTomadasHoy: tHoy,
                                        vacacionesRestantesHoy: rHoy,
                                        kpiVacaciones: parsedVac.kpiVacaciones || { adjudicadas: 0, tomadas: 0, restantes: 0 },
                                        kpiVacacionesIndividual: parsedVac.kpiVacacionesIndividual,
                                        desdeCache: true
                                    };
                                }
                            }
                        } catch (eC) { }
                    }
                    if (this._pendingVacacionesPromise) {
                        return await this._pendingVacacionesPromise;
                    }
                    this._pendingVacacionesPromise = (async () => {
                        try {
                            const raw = await this._jsonp(params, 0, 1, 15000);
                            if (raw && raw.ok) {
                                const rawIndiv = raw.kpiVacacionesIndividual || {};
                                const kpiIndivLimpio = {};
                                let sA = 0, sT = 0, sR = 0;
                                for (const [k, v] of Object.entries(rawIndiv)) {
                                    const kl = String(k).toLowerCase().trim();
                                    if (!k || kl.includes('sumatoria') || kl.includes('total') || kl.includes('promedio') || kl.includes('resumen')) continue;
                                    const a = parseFloat(v.adjudicadas) || 0;
                                    const t = parseFloat(v.tomadas) || 0;
                                    const r = parseFloat(v.restantes) || 0;
                                    kpiIndivLimpio[k] = { adjudicadas: a, tomadas: t, restantes: r };
                                    sA += a;
                                    sT += t;
                                    sR += r;
                                }
                                raw.kpiVacacionesIndividual = kpiIndivLimpio;
                                const globalSheets = raw.kpiVacaciones || {};
                                raw.kpiVacaciones = {
                                    adjudicadas: sA > 0 ? sA : (parseFloat(globalSheets.adjudicadas) || 0),
                                    tomadas: sT > 0 ? sT : (parseFloat(globalSheets.tomadas) || 0),
                                    restantes: sR !== 0 ? sR : (parseFloat(globalSheets.restantes) || 0)
                                };
                                window.kpiVacaciones = raw.kpiVacaciones;
                                window._kpiVacacionesCache = raw.kpiVacaciones;
                                window.kpiVacacionesIndividual = kpiIndivLimpio;
                                window._lastSheetsVacOk = Date.now();
                                try {
                                    const cacheData = JSON.stringify({
                                        vacaciones: raw.vacaciones || [],
                                        kpiVacaciones: raw.kpiVacaciones,
                                        kpiVacacionesIndividual: kpiIndivLimpio,
                                        lastSync: new Date().toISOString()
                                    });
                                    localStorage.setItem('tcontrol_vacaciones_cache_v3', cacheData);
                                    localStorage.setItem('tcontrol_vacaciones_cache_v2', cacheData);
                                } catch (e) { }
                                return raw;
                            }
                            throw new Error((raw && raw.error) || 'Respuesta no exitosa de Sheets');
                        } catch (errVac) {
                            console.warn("⚠️ Sheets timeout o error al obtener vacaciones:", errVac);
                            window._lastSheetsVacError = Date.now();
                            try {
                                const storedVac = localStorage.getItem('tcontrol_vacaciones_cache_v3') || localStorage.getItem('tcontrol_vacaciones_cache_v2');
                                if (storedVac) {
                                    const parsedVac = JSON.parse(storedVac);
                                    if (parsedVac && parsedVac.kpiVacacionesIndividual && Object.keys(parsedVac.kpiVacacionesIndividual).length > 0) {
                                        const rawVacList = parsedVac.vacaciones || [];
                                        const empIdReq = params.empleadoId ? String(params.empleadoId).trim() : null;
                                        const empCedReq = params.cedula ? String(params.cedula).trim() : null;
                                        let filteredVacs = rawVacList;
                                        let tHoy = null;
                                        let rHoy = null;

                                        if (empIdReq || empCedReq) {
                                            filteredVacs = rawVacList.filter(v => {
                                                const vId = String(v.empleadoId || v.id || (Array.isArray(v) ? v[1] : '')).trim();
                                                const vCed = String(v.cedula || (Array.isArray(v) ? v[0] : '')).trim();
                                                return (empIdReq && vId === empIdReq) || (empCedReq && (vCed === empCedReq || vId === empCedReq));
                                            });
                                            const kpiInd = parsedVac.kpiVacacionesIndividual || {};
                                            const info = kpiInd[empIdReq] || (empCedReq ? kpiInd[empCedReq] : null);
                                            if (info) {
                                                tHoy = info.tomadas;
                                                rHoy = info.restantes;
                                            }
                                        }

                                        return {
                                            ok: true,
                                            vacaciones: filteredVacs,
                                            vacacionesTomadasHoy: tHoy,
                                            vacacionesRestantesHoy: rHoy,
                                            kpiVacaciones: parsedVac.kpiVacaciones || { adjudicadas: 0, tomadas: 0, restantes: 0 },
                                            kpiVacacionesIndividual: parsedVac.kpiVacacionesIndividual || {},
                                            desdeCache: true
                                        };
                                    }
                                }
                            } catch (eC) { }
                            return {
                                ok: false,
                                error: errVac.message || 'Timeout en la conexión con Sheets',
                                vacaciones: window._vacacionesCache || [],
                                kpiVacaciones: window.kpiVacaciones || { adjudicadas: 0, tomadas: 0, restantes: 0 },
                                kpiVacacionesIndividual: window.kpiVacacionesIndividual || {}
                            };
                        } finally {
                            this._pendingVacacionesPromise = null;
                        }
                    })();
                    return await this._pendingVacacionesPromise;
                default:
                    console.warn("⚠️ Acción no reconocida:", accion);
                    return { error: "Acción no soportada en Firebase: " + accion };
            }
        } catch (error) {
            console.error("🔥 Error en FirebaseBackend:", error);
            return { error: error.message || error.toString() };
        }
    },

    // ==========================================
    // 1. AUTENTICACIÓN Y DISPOSITIVOS
    // ==========================================
    async verificarDispositivo(params) {
        const token = params.deviceToken;
        if (!token) return { error: "Token no proporcionado" };

        const dispRef = db.collection('dispositivos').doc(token);
        const dispDoc = await dispRef.get();

        if (!dispDoc.exists || !dispDoc.data().activo) {
            return { registrado: false };
        }

        const empleadoId = dispDoc.data().id_empleado;
        let empDoc = await db.collection('empleados').doc(empleadoId.toString()).get();
        if (!empDoc.exists) {
            const snapStr = await db.collection('empleados').where('id', '==', empleadoId.toString()).limit(1).get();
            if (!snapStr.empty) empDoc = snapStr.docs[0];
        }

        if (!empDoc || !empDoc.exists || (empDoc.data().activo !== 'SI' && empDoc.data().activo !== 'si' && empDoc.data().activo !== true)) {
            return { registrado: false };
        }

        const empData = empDoc.data();
        const pinExistente = empData.pin ? empData.pin.toString().trim() : '';
        const tienePin = (pinExistente !== '');

        // Actualizar último uso sin esperar (no bloquea)
        dispRef.update({ ultimo_uso: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => { });

        return {
            registrado: true,
            tienePin: tienePin,
            empleado: {
                id: empleadoId,
                nombre: empData.nombre,
                area: empData.area,
                foto_url: empData.foto_url,
                cargo: empData.cargo,
                fechaNacimiento: empData.fechaNacimiento,
                telefono: empData.telefono || empData.celular || "",
                baseLat: empData.baseLat,
                baseLng: empData.baseLng,
                cultura_habilitada: empData.cultura_habilitada !== false && empData.cultura_activa !== false,
                cultura_activa: empData.cultura_habilitada !== false && empData.cultura_activa !== false
            }
        };
    },
    async verificarPIN(params) {
        const pin = params.pin ? params.pin.toString().trim() : '';
        const token = params.deviceToken;
        const idRequerido = params.empleadoId ? params.empleadoId.toString().trim() : '';

        console.log("🔐 Verificando PIN...", { pin: pin ? '***' : '', token: token, idRequerido: idRequerido });

        if (!pin || !token) return { error: "PIN o Token ausente", valido: false };

        let empDoc = null;
        let empData = null;

        // 1. CASO PRINCIPAL: Si se pasó un ID (Login con ID + Contraseña)
        if (idRequerido) {
            console.log("🔍 Buscando empleado por ID específico:", idRequerido);
            let doc = await db.collection('empleados').doc(idRequerido).get();
            if (!doc.exists) {
                const snapStr = await db.collection('empleados').where('id', '==', idRequerido).limit(1).get();
                if (!snapStr.empty) {
                    doc = snapStr.docs[0];
                } else {
                    const num = parseInt(idRequerido, 10);
                    if (!isNaN(num)) {
                        const snapNum = await db.collection('empleados').where('id', '==', num).limit(1).get();
                        if (!snapNum.empty) doc = snapNum.docs[0];
                    }
                }
            }
            if (doc && doc.exists) {
                const data = doc.data();
                const pinEnBd = data.pin ? data.pin.toString().trim() : '';

                // Si no tiene contraseña establecida, se deniega y se redirige a vincular
                if (!pinEnBd) {
                    return {
                        error: "Tu cuenta aún no tiene contraseña configurada. Por favor, haz clic en 'Vincular Dispositivo' para establecerla.",
                        valido: false,
                        debeRegistrarPin: true
                    };
                }

                if (pinEnBd === pin) {
                    empDoc = doc;
                    empData = data;
                } else {
                    return { error: "Contraseña incorrecta", valido: false };
                }
            } else {
                return { error: "Usuario no encontrado", valido: false };
            }
        } else {
            // 2. CASO FALLBACK: Búsqueda por PIN único sólo si no se proporcionó ID
            console.log("🔎 Búsqueda por PIN único en colección.");
            const pinNum = parseInt(pin, 10);
            const queries = [db.collection('empleados').where('pin', '==', pin).get()];
            if (!isNaN(pinNum) && pinNum.toString() === pin) {
                queries.push(db.collection('empleados').where('pin', '==', pinNum).get());
            }
            const snaps = await Promise.all(queries);
            const activeSnap = snaps.find(s => s && !s.empty);
            if (activeSnap) {
                empDoc = activeSnap.docs[0];
                empData = empDoc.data();
            }
        }

        if (!empDoc) {
            console.warn("❌ Contraseña no encontrada.");
            return { error: "Acceso denegado: ID o Contraseña incorrecta.", valido: false };
        }

        console.log("✅ Empleado encontrado:", empData.nombre);
        if (empData.activo !== 'SI' && empData.activo !== 'si' && empData.activo !== true) {
            return { error: "El empleado no se encuentra activo", valido: false };
        }

        // Registrar token si es necesario
        if (empData.deviceToken !== token) {
            await db.collection('empleados').doc(empDoc.id).update({ deviceToken: token });
        }

        // Registrar o actualizar dispositivo
        const dispRef = db.collection('dispositivos').doc(token);
        await dispRef.set({
            id_dispositivo: token,
            id_empleado: empDoc.id,
            fecha_registro: firebase.firestore.FieldValue.serverTimestamp(),
            ultimo_uso: firebase.firestore.FieldValue.serverTimestamp(),
            activo: true
        });

        // Actualizar token en empleado
        await db.collection('empleados').doc(empDoc.id).update({
            deviceToken: token
        });

        // Si el PIN tiene menos de 20 caracteres, es un PIN antiguo (no es SHA-256)
        const debeActualizarPassword = (empData.pin?.toString().length || 0) < 20;

        const supRaw = (empData.supervisor || empData.rol || '').toString().trim().toUpperCase();
        const esSupervisor = (empData.supervisor === 'SI' || supRaw === 'SUPERVISOR ADMIN' || supRaw === 'SUPERVISOR_ADMIN' || supRaw === 'ADMIN' || supRaw === 'SUPERVISOR');

        return {
            ok: true,
            valido: true,
            debeActualizarPassword: debeActualizarPassword,
            empleado: {
                id: empDoc.id,
                nombre: empData.nombre,
                area: empData.area,
                foto_url: empData.foto_url,
                cargo: empData.cargo,
                telefono: empData.telefono || empData.celular || "",
                fechaNacimiento: empData.fechaNacimiento,
                baseLat: empData.baseLat,
                baseLng: empData.baseLng,
                supervisor: empData.supervisor || (esSupervisor ? 'SI' : 'NO'),
                esSupervisor: esSupervisor,
                pagos_url: empData.id_dispositivo || "",
                cultura_habilitada: empData.cultura_habilitada !== false && empData.cultura_activa !== false,
                cultura_activa: empData.cultura_habilitada !== false && empData.cultura_activa !== false
            }
        };
    },

    async verificarEmpleadoTienePin(params) {
        const empleadoId = (params.empleadoId || params.id || "").toString().trim();
        if (!empleadoId) return { error: "ID de empleado no proporcionado" };

        let empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists) {
            const snapStr = await db.collection('empleados').where('id', '==', empleadoId).limit(1).get();
            if (!snapStr.empty) {
                empDoc = snapStr.docs[0];
            } else {
                const num = parseInt(empleadoId, 10);
                if (!isNaN(num)) {
                    const snapNum = await db.collection('empleados').where('id', '==', num).limit(1).get();
                    if (!snapNum.empty) {
                        empDoc = snapNum.docs[0];
                    }
                }
            }
        }

        if (!empDoc || !empDoc.exists) return { error: "Empleado no encontrado en el sistema" };

        const empData = empDoc.data();
        if (empData.activo !== 'SI' && empData.activo !== 'si' && empData.activo !== true) return { error: "El empleado no se encuentra activo" };

        const pinExistente = empData.pin ? empData.pin.toString().trim() : '';
        const tienePin = (pinExistente !== '');

        const fotoRaw = empData.foto_url || empData.fotoUrl || empData.foto || empData.url_foto || empData.URL_FOTO || '';
        const fotoFinal = this._normalizarUrlFoto(fotoRaw);

        return {
            ok: true,
            tienePin: tienePin,
            nombre: empData.nombre || 'Empleado',
            foto_url: fotoFinal,
            area: empData.area || '',
            cargo: empData.cargo || ''
        };
    },

    async registrarDispositivoConPIN(params) {
        const empleadoId = params.empleadoId?.toString().trim();
        const pin = params.pin?.toString().trim();
        const token = params.deviceToken;
        const rawPin = params.rawPin?.toString().trim();

        if (!empleadoId) return { error: "Ingresa tu ID / Cédula de empleado" };
        if (!pin) return { error: "Ingresa tu contraseña" };
        if (!token) return { error: "Token de dispositivo ausente" };

        let empRef = db.collection('empleados').doc(empleadoId);
        let empDoc = await empRef.get();
        if (!empDoc.exists) {
            const snapStr = await db.collection('empleados').where('id', '==', empleadoId).limit(1).get();
            if (!snapStr.empty) {
                empDoc = snapStr.docs[0];
                empRef = empDoc.ref;
            } else {
                const num = parseInt(empleadoId, 10);
                if (!isNaN(num)) {
                    const snapNum = await db.collection('empleados').where('id', '==', num).limit(1).get();
                    if (!snapNum.empty) {
                        empDoc = snapNum.docs[0];
                        empRef = empDoc.ref;
                    }
                }
            }
        }
        if (!empDoc || !empDoc.exists) return { error: "Empleado no encontrado en el sistema" };

        const empData = empDoc.data();
        if (empData.activo !== 'SI' && empData.activo !== 'si' && empData.activo !== true) return { error: "El empleado no se encuentra activo" };

        const pinExistente = empData.pin ? empData.pin.toString().trim() : '';

        // 🛡️ CASO 1: Si es la primera vez (no tiene PIN), es OBLIGATORIO establecer una contraseña de al menos 4 caracteres
        if (pinExistente === '') {
            if ((rawPin && rawPin.length < 4) || (!rawPin && pin.length < 4)) {
                return { error: "Por seguridad, la contraseña debe contener al menos 4 caracteres." };
            }
        } else {
            // 🛡️ CASO 2: Si el empleado YA TIENE contraseña registrada, DEBE coincidir obligatoriamente
            const coincide = (pinExistente === pin) || (rawPin && pinExistente === rawPin);
            if (!coincide) {
                return { error: "Contraseña incorrecta. Si la olvidaste, solicita a Recursos Humanos / Administrador el restablecimiento." };
            }
        }

        // 1. Actualizar empleado con el nuevo token (y la contraseña si era la primera vez o si se actualiza a hash SHA-256)
        const updateData = { deviceToken: token };
        if (pinExistente === '' || pinExistente.length < 20) {
            updateData.pin = pin;
        }
        await empRef.update(updateData);

        // 📱 OPCIÓN 2: Desactivar/reemplazar cualquier dispositivo anterior registrado para este empleado
        try {
            const dispPrevios = await db.collection('dispositivos')
                .where('id_empleado', '==', empleadoId)
                .get();

            if (!dispPrevios.empty) {
                const batch = db.batch();
                dispPrevios.forEach(doc => {
                    if (doc.id !== token) {
                        batch.delete(doc.ref);
                    }
                });
                await batch.commit();
            }
        } catch (e) {
            console.warn("Aviso al desvincular equipos anteriores:", e);
        }

        // 3. Registrar el dispositivo actual como el único activo
        await db.collection('dispositivos').doc(token).set({
            id_dispositivo: token,
            id_empleado: empleadoId,
            fecha_registro: firebase.firestore.FieldValue.serverTimestamp(),
            ultimo_uso: firebase.firestore.FieldValue.serverTimestamp(),
            activo: true
        });

        return { ok: true, esVinculacionExistente: pinExistente !== '' };
    },

    async actualizarPerfilEmpleado(params) {
        const empleadoId = params.empleadoId?.toString() || params.id?.toString();
        if (!empleadoId) return { error: "ID no proporcionado" };

        let empRef = db.collection('empleados').doc(empleadoId);
        let empDoc = await empRef.get();
        if (!empDoc.exists) {
            const snapStr = await db.collection('empleados').where('id', '==', empleadoId).limit(1).get();
            if (!snapStr.empty) {
                empDoc = snapStr.docs[0];
                empRef = empDoc.ref;
            } else {
                const num = parseInt(empleadoId, 10);
                if (!isNaN(num)) {
                    const snapNum = await db.collection('empleados').where('id', '==', num).limit(1).get();
                    if (!snapNum.empty) {
                        empDoc = snapNum.docs[0];
                        empRef = empDoc.ref;
                    }
                }
            }
        }
        if (!empDoc || !empDoc.exists) return { error: "Empleado no encontrado" };

        const empData = empDoc.data();

        // Si se va a cambiar la contraseña y el usuario envía la contraseña antigua (cambio desde perfil de empleado)
        if (params.oldPasswordHash || params.oldPin) {
            const pinActual = empData.pin ? empData.pin.toString().trim() : '';
            if (pinActual !== '') {
                const oldHash = params.oldPasswordHash?.toString().trim();
                const oldPin = params.oldPin?.toString().trim();
                const coincide = (pinActual === oldHash) || (oldPin && pinActual === oldPin);
                if (!coincide) {
                    return { error: "La contraseña actual es incorrecta." };
                }
            }
        }

        const updateData = {};
        if (params.nombre !== undefined && params.nombre !== null) {
            updateData.nombre = params.nombre.toString().trim();
        }
        if (params.foto_url !== undefined && params.foto_url !== null) {
            updateData.foto_url = params.foto_url.toString().trim();
        }
        if (params.telefono !== undefined && params.telefono !== null) {
            updateData.telefono = params.telefono.toString().trim();
        }
        if (params.fechaNacimiento !== undefined && params.fechaNacimiento !== null) {
            updateData.fechaNacimiento = params.fechaNacimiento.toString().trim();
        }
        if (params.cultura_habilitada !== undefined) {
            const hab = (params.cultura_habilitada === true || params.cultura_habilitada === 'true');
            updateData.cultura_habilitada = hab;
            updateData.cultura_activa = hab;
        }

        // Manejo de PIN / Contraseña (permite tanto asignar clave como resetear / dejar en blanco '')
        if (params.passwordHash !== undefined || params.pin !== undefined) {
            const nuevoPin = params.passwordHash !== undefined ? params.passwordHash : params.pin;
            updateData.pin = nuevoPin !== null ? nuevoPin.toString().trim() : '';
        }

        // Manejo de Device Token / Dispositivo (permite desvincular o limpiar)
        if (params.deviceToken !== undefined) {
            updateData.deviceToken = params.deviceToken !== null ? params.deviceToken.toString().trim() : '';
        }
        if (params.id_dispositivo !== undefined) {
            updateData.id_dispositivo = params.id_dispositivo !== null ? params.id_dispositivo.toString().trim() : '';
        }

        if (Object.keys(updateData).length > 0) {
            await empRef.update(updateData);
        }

        // Si se resetea la contraseña o el token de dispositivo, limpiar también la colección 'dispositivos' para este empleado
        if ((params.passwordHash !== undefined && params.passwordHash === '') ||
            (params.pin !== undefined && params.pin === '') ||
            (params.deviceToken !== undefined && params.deviceToken === '')) {
            try {
                const idEmpBuscado = empData.id ? empData.id.toString() : empleadoId;
                const snapDispositivos = await db.collection('dispositivos')
                    .where('id_empleado', '==', idEmpBuscado)
                    .get();
                if (!snapDispositivos.empty) {
                    const batch = db.batch();
                    snapDispositivos.forEach(d => batch.delete(d.ref));
                    await batch.commit();
                }
            } catch (errDisp) {
                console.warn("Aviso al limpiar colección dispositivos:", errDisp);
            }
        }

        // Dual-write to Sheets si corresponde
        try {
            this._jsonp({ accion: 'actualizarPerfilEmpleado', ...params });
        } catch (e) { }

        return { ok: true, mensaje: "Perfil actualizado exitosamente en Firebase" };
    },

    // ==========================================
    // 2. ESTADO Y REGISTROS
    // ==========================================
    async obtenerEstado(params) {
        const empleadoId = params.id?.toString();
        if (!empleadoId) return { error: "ID no proporcionado" };

        const empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists) return { error: "Empleado no encontrado" };
        const empData = empDoc.data();

        // Obtener registros recientes (últimos 50 para seguridad)
        // Filtramos "hoy" en JS para evitar problemas de formato (YYYY-MM-DD vs DD/MM/YYYY)
        const regQuery = await db.collection('registros')
            .where('empleadoId', '==', empleadoId)
            .get();

        const hoy = new Date();
        const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
        const dia = hoy.getDate().toString().padStart(2, '0');
        const hoyStr = `${hoy.getFullYear()}-${mes}-${dia}`;

        // Formato alternativo que a veces viene de Excel
        const hoyStrAlt = `${dia}/${mes}/${hoy.getFullYear()}`;

        let tieneEntrada = false;
        let tieneSalida = false;
        let horaEntrada = null;
        let horaSalida = null;
        let ultimoAlmuerzo = null;

        regQuery.docs.forEach(doc => {
            const data = this._processDoc(doc.id, doc.data());
            if (!data) return;

            // Detección robusta de "hoy"
            let esHoy = false;

            // Normalizar fecha si viene como string ISO (ej: 2026-05-04T05:00:00.000Z)
            let fechaLimpia = data.fecha || "";
            if (/^\d{4}-\d{2}-\d{2}T/.test(fechaLimpia)) {
                fechaLimpia = fechaLimpia.split('T')[0];
            }

            if (fechaLimpia === hoyStr || fechaLimpia === hoyStrAlt) {
                esHoy = true;
            } else if (data.timestamp) {
                const fTimestamp = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
                if (fTimestamp.toDateString() === hoy.toDateString()) {
                    esHoy = true;
                }
            }

            if (esHoy) {
                if (data.tipo === 'ENTRADA') {
                    tieneEntrada = true;
                    horaEntrada = this._limpiarHora(data.hora);
                    ultimoAlmuerzo = data.almuerzo;
                }
                if (data.tipo === 'SALIDA') {
                    tieneSalida = true;
                    horaSalida = this._limpiarHora(data.hora);
                }
            }
            console.log(`- Registro ${data.tipo} (${fechaLimpia}): ${esHoy ? 'ES HOY ✅' : 'No es hoy ❌'}`);
        });

        const fotoFinal = this._normalizarUrlFoto(empData.foto_url || empData.fotoUrl || empData.foto || "");

        return {
            id: empDoc.id,
            nombre: empData.nombre,
            area: empData.area,
            foto_url: fotoFinal,
            cargo: empData.cargo,
            telefono: empData.telefono || empData.celular || "",
            fechaNacimiento: empData.fechaNacimiento,
            baseLat: empData.baseLat,
            baseLng: empData.baseLng,
            authExtras: empData.authExtras || 'NO',
            esSupervisor: empData.supervisor === 'SI' || empData.esSupervisor === true || empData.cargo?.toUpperCase().includes("SUPERVISOR"),
            tieneEntrada: tieneEntrada,
            tieneSalida: tieneSalida,
            horaEntrada: horaEntrada,
            horaSalida: horaSalida,
            almuerzo: ultimoAlmuerzo,
            pagos_url: empData.id_dispositivo || "",
            cultura_habilitada: empData.cultura_habilitada !== false && empData.cultura_activa !== false,
            cultura_activa: empData.cultura_habilitada !== false && empData.cultura_activa !== false,
            error: null
        };
    },

    async obtenerRegistros(params) {
        const empleadoId = params.empleadoId?.toString();

        // Limitar a últimos 30 días para rendimiento
        const hace30dias = new Date();
        hace30dias.setDate(hace30dias.getDate() - 30);

        const querySnap = await db.collection('registros')
            .where('empleadoId', '==', empleadoId)
            // Sin orderBy para evitar exigir Índices Compuestos en Firebase
            .get();

        let registros = [];
        querySnap.forEach(doc => {
            const data = this._processDoc(doc.id, doc.data());
            if (!data) return;
            let tsVal = null;
            if (data.timestamp) {
                if (typeof data.timestamp.toDate === 'function') {
                    tsVal = data.timestamp.toDate().toISOString();
                } else if (data.timestamp instanceof Date) {
                    tsVal = data.timestamp.toISOString();
                } else {
                    const parsedD = new Date(data.timestamp);
                    tsVal = !isNaN(parsedD.getTime()) ? parsedD.toISOString() : String(data.timestamp);
                }
            }
            const rObj = {
                fecha: this._normFecha(data.fecha),
                tipo: (data.tipo || '').toUpperCase(),
                hora: this._limpiarHora(data.hora),
                almuerzo: data.almuerzo || '',
                dispositivo: data.dispositivo || '',
                timestamp: tsVal,
                dia: data.dia || '',
                modo: data.modo || 'OFICINA',
                horasExtra: data.horasExtra || 'NO',
                autoriza: data.autoriza || '',
                razon_salida_temprana: data.razon_salida_temprana || '',
                quien_justifica: data.quien_justifica || '',
                razon_entrada_tardia: data.razon_entrada_tardia || '',
                quien_justifica_entrada: data.quien_justifica_entrada || '',
                tipo_salida: data.tipo_salida || '',
                razon_permiso: data.razon_permiso || '',
                estado: data.estado || '',
                estado_timestamp: data.estado_timestamp ? (data.estado_timestamp.toDate ? data.estado_timestamp.toDate().getTime() : new Date(data.estado_timestamp).getTime()) : null,
                permiso_personal_mins: data.permiso_personal_mins || 0,
                permiso_medico_mins: data.permiso_medico_mins || 0,
                tiempo_justificado_mins: data.tiempo_justificado_mins || 0
            };
            if (rObj.timestamp) {
                this._extraerFechaHoraDesdeTimestamp(rObj);
            }
            registros.push(rObj);
        });

        // --- INICIO: Integración de Registros Archivados ---
        if (params.incluirArchivados !== false) {
            const CACHE_ARCHIVADOS_KEY = `tcontrol_archivados_cache_${empleadoId}_v2`;
            let archivadosData = { registros: [], lastSync: null };
            try {
                const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
                if (storedArch) archivadosData = JSON.parse(storedArch);
            } catch (e) { console.warn("Error leyendo caché archivados:", e); }

            // Cache por 30 minutos (antes era 12 horas) para evitar falsas faltas tras archivar
            const horasArchivados = archivadosData.lastSync ? (new Date() - new Date(archivadosData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchArchivados = async () => {
                try {
                    const resJson = await this._jsonp({
                        accion: 'obtenerRegistrosArchivados',
                        empleadoId: empleadoId
                    }, 0, 2, 20000);
                    if (resJson.ok && resJson.registros) {
                        archivadosData.registros = resJson.registros;
                        archivadosData.lastSync = new Date().toISOString();
                        try {
                            localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archivadosData));
                            console.log("✅ Registros archivados de Sheets actualizados para el empleado.");
                        } catch (e) { }
                    }
                } catch (e) { console.warn("Error consultando archivados:", e); }
            };

            const tieneSincronizacionPrevia = Boolean(archivadosData.lastSync);
            if (params.force || !tieneSincronizacionPrevia) {
                if (params.asyncSync && tieneSincronizacionPrevia) {
                    _fetchArchivados();
                } else {
                    console.log(`📥 Sincronizando registros archivados de Sheets para empleado ${empleadoId}...`);
                    await _fetchArchivados();
                }
            } else if (horasArchivados > 4) {
                // Sincronización en segundo plano sin congelar la interfaz
                _fetchArchivados();
            }

            // Filtrar archivados del empleado actual y mapearlos al formato esperado
            const empIdStr = String(empleadoId).trim();
            const archivadosDelEmpleado = archivadosData.registros.filter(r => {
                const rId = String(r.empleadoId || r.id_empleado || r.id || '').trim();
                return rId === empIdStr || (Number(rId) && Number(empIdStr) && Number(rId) === Number(empIdStr));
            }).map(data => {
                const aObj = {
                    fecha: this._normFecha(data.fecha),
                    tipo: (data.tipo || '').toUpperCase(),
                    hora: this._limpiarHora(data.hora),
                    almuerzo: data.almuerzo || '',
                    dispositivo: data.dispositivo || '',
                    timestamp: data.timestamp || null,
                    dia: data.dia || '',
                    modo: data.modo || 'OFICINA',
                    horasExtra: data.horasExtra || 'NO',
                    autoriza: data.autoriza || '',
                    razon_salida_temprana: data.razonSalidaTemprana || data.razon_salida_temprana || '',
                    quien_justifica: data.quienJustifica || data.quien_justifica || '',
                    razon_entrada_tardia: data.razonEntradaTardia || data.razon_entrada_tardia || '',
                    quien_justifica_entrada: data.quienJustificaEntrada || data.quien_justifica_entrada || '',
                    tipo_salida: data.tipoSalida || data.tipo_salida || '',
                    razon_permiso: data.razonPermiso || data.razon_permiso || '',
                    permiso_personal_mins: data.permiso_personal_mins || 0,
                    permiso_medico_mins: data.permiso_medico_mins || 0,
                    tiempo_justificado_mins: data.tiempo_justificado_mins || 0
                };
                if (aObj.timestamp) {
                    this._extraerFechaHoraDesdeTimestamp(aObj);
                }
                return aObj;
            });

            // Evitar duplicar registros entre Firebase y Google Sheets
            const existingKeys = new Set();
            registros.forEach(r => {
                const hNorm = (r.hora || '').slice(0, 5);
                existingKeys.add(`${r.fecha}|${(r.tipo || '').toUpperCase()}|${hNorm}`);
                existingKeys.add(`${r.fecha}|${(r.tipo || '').toUpperCase()}`);
            });

            const archivadosUnicos = [];
            archivadosDelEmpleado.forEach(arch => {
                const hNorm = (arch.hora || '').slice(0, 5);
                const kExact = `${arch.fecha}|${(arch.tipo || '').toUpperCase()}|${hNorm}`;
                const kTipo = `${arch.fecha}|${(arch.tipo || '').toUpperCase()}`;

                if (existingKeys.has(kExact) || existingKeys.has(kTipo)) {
                    // Enriquecer el registro de Firebase si venían datos de Sheets
                    const fbReg = registros.find(r => r.fecha === arch.fecha && (r.tipo || '').toUpperCase() === (arch.tipo || '').toUpperCase());
                    if (fbReg) {
                        if (arch.permiso_personal_mins) fbReg.permiso_personal_mins = arch.permiso_personal_mins;
                        if (arch.permiso_medico_mins) fbReg.permiso_medico_mins = arch.permiso_medico_mins;
                        if (arch.tiempo_justificado_mins) fbReg.tiempo_justificado_mins = arch.tiempo_justificado_mins;
                        if (arch.razon_permiso) fbReg.razon_permiso = arch.razon_permiso;
                        if (arch.razon_salida_temprana && !fbReg.razon_salida_temprana) fbReg.razon_salida_temprana = arch.razon_salida_temprana;
                        if (arch.razon_entrada_tardia && !fbReg.razon_entrada_tardia) fbReg.razon_entrada_tardia = arch.razon_entrada_tardia;
                    }
                    return; // No duplicar
                }
                archivadosUnicos.push(arch);
            });

            registros = registros.concat(archivadosUnicos);
        }
        // --- FIN: Integración de Registros Archivados ---

        // Ordenar en cliente (de más reciente a más antiguo)
        // Usar timestamp si existe, sino fecha y hora combinados
        registros.sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.fecha + 'T' + (a.hora || '00:00:00')).getTime();
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.fecha + 'T' + (b.hora || '00:00:00')).getTime();
            return timeB - timeA;
        });

        // Retornar hasta 1000 para asegurar que cubrimos el rango de faltas
        return registros.slice(0, 1000);
    },

    async guardarRegistro(params) {
        let data = params;
        if (params.datos && typeof params.datos === 'string') {
            try { data = JSON.parse(params.datos); } catch (e) { }
        }

        const empleadoId = (data.id || data.empleadoId)?.toString();
        if (!empleadoId) return { error: "ID de empleado faltante" };
        let empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists) {
            const snap = await db.collection('empleados').where('id', '==', empleadoId).limit(1).get();
            if (!snap.empty) empDoc = snap.docs[0];
            else {
                const num = Number(empleadoId);
                if (!isNaN(num)) {
                    const snapNum = await db.collection('empleados').where('id', '==', num).limit(1).get();
                    if (!snapNum.empty) empDoc = snapNum.docs[0];
                }
            }
        }
        if (!empDoc || !empDoc.exists) return { error: "Empleado no encontrado" };
        const infoEmpleado = empDoc.data();
        if (infoEmpleado.activo && infoEmpleado.activo !== 'SI') return { error: "Empleado inactivo" };

        // Fechas
        let ahora = new Date();
        let fechaRegistro = ahora;

        const esMarcacionOrdinaria = (tipo) => {
            const t = String(tipo || '').toUpperCase().trim();
            if (t === 'TRABAJO_DE_CAMPO' || t === 'SALIDA_A_CAMPO') return false;
            return ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'ENTRADA_CAMPO', 'SALIDA_CAMPO', 'RETORNO_CAMPO'].includes(t);
        };
        const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

        const reqFecha = data.fecha_falta || data.fecha || null;
        if (reqFecha) {
            const partes = reqFecha.toString().trim().split('-');
            if (partes.length === 3) {
                const anio = parseInt(partes[0]);
                const mes = parseInt(partes[1]) - 1;
                const dia = parseInt(partes[2]);
                if (!isNaN(anio) && !isNaN(mes) && !isNaN(dia)) {
                    fechaRegistro = new Date(anio, mes, dia, 12, 0, 0);
                }
            }
        }

        const mes = (fechaRegistro.getMonth() + 1).toString().padStart(2, '0');
        const dia = fechaRegistro.getDate().toString().padStart(2, '0');
        const fechaStr = `${fechaRegistro.getFullYear()}-${mes}-${dia}`;

        const h = ahora.getHours().toString().padStart(2, '0');
        const m = ahora.getMinutes().toString().padStart(2, '0');
        const s = ahora.getSeconds().toString().padStart(2, '0');

        const hoyStrLocal = this._hoyStr();
        const esFechaPasada = (fechaStr < hoyStrLocal);

        // =========================================================================
        // VERIFICAR EN REGISTROS ANTES DE GUARDAR EN FIREBASE:
        // Si es una ausencia (VACACIONES, CAMPO, PERMISO, etc.) en fecha pasada o archivada,
        // NUNCA guardar como documento nuevo en Firestore, porque al archivar duplicaría
        // la fila en la hoja REGISTROS. Se debe actualizar directamente en Google Sheets.
        // =========================================================================
        if (esAusenciaTipo(data.tipo) && (esFechaPasada || String(data.docId || '').startsWith('arch_'))) {
            console.log(`ℹ️ [guardarRegistro] Ausencia en fecha pasada o archivada (${fechaStr}). Actualizando directamente en REGISTROS sin crear duplicado en Firestore.`);
            
            // 1. Limpiar cualquier documento huérfano previo en Firestore para evitar que se archive
            try {
                await this.eliminarRegistroFirestorePorFecha(empleadoId, fechaStr);
            } catch (eClean) { }

            // 2. Actualizar directamente en Google Sheets REGISTROS
            const modoAus = data.modo || "OFICINA";
            const sheetsRes = await this.actualizarRegistroGeneral({
                empleadoId: empleadoId,
                tipo: data.tipo,
                fecha: fechaStr,
                campo: 'justificado',
                valor: 'SI',
                razon_justificac: data.razon_ausencia || data.observacion || data.razon_justificac || data.tipo,
                razon_ausencia: data.razon_ausencia || data.observacion || data.razon_justificac || data.tipo,
                quien_justifica: data.quien_justifica || 'Supervisor',
                modo: modoAus
            });

            return sheetsRes || { ok: true, msg: `${data.tipo} actualizado con éxito en REGISTROS` };
        }

        let horaStr = "00:00:00";
        if (data.hora && String(data.hora).trim() !== "") {
            horaStr = String(data.hora).trim();
        } else if (!esAusenciaTipo(data.tipo)) {
            horaStr = `${h}:${m}:${s}`;
        }

        const modo = data.modo || "OFICINA";
        let horasExtra = modo === "CAMPO" ? "SI" : "NO";
        let autoriza = data.autoriza || (modo === "CAMPO" ? "SISTEMA (CAMPO)" : "");

        if (data.tipo === 'SALIDA') {
            const hPartes = String(horaStr).trim().split(':');
            if (hPartes.length >= 2) {
                const minsSalida = parseInt(hPartes[0], 10) * 60 + parseInt(hPartes[1], 10);
                const dayOfWeek = fechaRegistro.getDay(); // 0: Dom, 6: Sab
                const refSalida = dayOfWeek === 6 ? 900 : (dayOfWeek === 0 ? 450 : 975); // 16:15 = 975 min, Sabado 15:00 = 900 min
                if (minsSalida - refSalida > 45) {
                    horasExtra = "SI";
                    if (!autoriza) autoriza = "SISTEMA (>45 MIN)";
                }
            }
        }

        // Lógica de Estado de Emergencia dentro de ENTRADA
        if (data.tipo === 'ESTADO') {
            const hoyActualStr = `${ahora.getFullYear()}-${(ahora.getMonth() + 1).toString().padStart(2, '0')}-${ahora.getDate().toString().padStart(2, '0')}`;
            const entradaSnap = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .where('tipo', '==', 'ENTRADA')
                .get();

            let entradaDocId = null;
            entradaSnap.forEach(doc => {
                const docData = this._processDoc(doc.id, doc.data());
                if (docData && docData.fecha === hoyActualStr) {
                    entradaDocId = doc.id;
                }
            });

            if (entradaDocId) {
                await db.collection('registros').doc(entradaDocId).update({
                    estado: data.razon_ausencia || "A salvo",
                    estado_timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                return { ok: true, msg: "Estado de emergencia guardado en la Entrada de hoy" };
            } else {
                return { error: "Debes haber registrado tu ENTRADA de hoy para poder reportar tu estado de emergencia" };
            }
        }

        // Evitar duplicados (excepto ausencias/ESTADO)
        if (esMarcacionOrdinaria(data.tipo) && data.tipo !== 'ESTADO') {
            const hoyActualStr = `${ahora.getFullYear()}-${(ahora.getMonth() + 1).toString().padStart(2, '0')}-${ahora.getDate().toString().padStart(2, '0')}`;
            const dupQuery = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                // Sin orderBy ni fecha en query para evitar requerir índice compuesto en Firebase
                .get();

            if (!dupQuery.empty) {
                // Procesar y ordenar localmente
                let docs = dupQuery.docs.map(d => this._processDoc(d.id, d.data())).filter(Boolean);
                docs = docs.filter(d => d.fecha === hoyActualStr);

                docs.sort((a, b) => {
                    let ta = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp).getTime()) : 0;
                    let tb = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp).getTime()) : 0;
                    return tb - ta; // Descendente
                });

                if (docs.length > 0 && docs[0].tipo === data.tipo) {
                    return { error: `Ya registraste tu ${data.tipo} recientemente hoy` };
                }
            }
        }

        let almuerzo = data.almuerzo || "";
        if (data.tipo === 'SALIDA') {
            const hPartes = horaStr.split(':');
            const minDelDia = parseInt(hPartes[0]) * 60 + parseInt(hPartes[1]);
            if (minDelDia < 570) { // Antes de las 09:30 a.m.
                almuerzo = "NO";
            }
        }

        const idLimpio = horaStr.replace(/:/g, '');
        const idDocumento = `${empleadoId}_${data.tipo}_${fechaStr}_${idLimpio}`;

        let tsObj = firebase.firestore.FieldValue.serverTimestamp();
        if (data.hora && String(data.hora).trim() !== "") {
            try {
                const parsedDate = new Date(`${fechaStr}T${horaStr}`);
                if (!isNaN(parsedDate.getTime())) {
                    tsObj = firebase.firestore.Timestamp.fromDate(parsedDate);
                }
            } catch (e) { }
        } else if (esAusenciaTipo(data.tipo)) {
            tsObj = firebase.firestore.Timestamp.fromDate(fechaRegistro);
        }

        // Guardar en Firestore
        const nuevoRegistro = {
            empleadoId: empleadoId,
            nombre: infoEmpleado.nombre,
            fecha: fechaStr,
            hora: horaStr,
            tipo: data.tipo,
            almuerzo: almuerzo,
            lat: parseFloat(data.lat) || null,
            lng: parseFloat(data.lng) || null,
            dispositivo: data.dispositivo || "",
            timestamp: tsObj,
            modo: modo,
            horasExtra: horasExtra,
            autoriza: autoriza
        };

        if (esAusenciaTipo(data.tipo)) {
            nuevoRegistro.razon_ausencia = data.razon_ausencia || data.observacion || "";
            nuevoRegistro.razon_justificac = data.razon_justificac || data.razon_ausencia || data.observacion || "";
            nuevoRegistro.justificado = data.justificado || 'SI';
        } else if (data.razon_ausencia) {
            nuevoRegistro.observaciones = data.razon_ausencia;
            nuevoRegistro.razon_ausencia = data.razon_ausencia;
        }

        if (data.justificado) nuevoRegistro.justificado = data.justificado;
        if (data.quien_justifica) nuevoRegistro.quien_justifica = data.quien_justifica;
        if (data.observacion) nuevoRegistro.observacion = data.observacion;
        if (data.observaciones) nuevoRegistro.observaciones = data.observaciones;

        // Guardar en Firestore siempre (disponibilidad inmediata en cliente)
        await db.collection('registros').doc(idDocumento).set(nuevoRegistro, { merge: true });

        // SI YA EXISTE UN REGISTRO DE AUSENCIA PREVIO PARA ESTA FECHA Y EMPLEADO, BORRAR EL ANTERIOR DOCUMENTO PARA EVITAR DUPLICIDAD
        if (esAusenciaTipo(data.tipo)) {
            try {
                const snapAusencias = await db.collection('registros')
                    .where('empleadoId', '==', empleadoId)
                    .get();

                let docsABorrar = [];
                snapAusencias.forEach(doc => {
                    const docData = doc.data();
                    const processedData = this._processDoc(doc.id, docData);
                    if (processedData && processedData.fecha === fechaStr && esAusenciaTipo(processedData.tipo || '')) {
                        if (doc.id !== idDocumento) {
                            docsABorrar.push(doc.id);
                        }
                    }
                });

                for (const dId of docsABorrar) {
                    await db.collection('registros').doc(dId).delete();
                }
            } catch (err) {
                console.warn("⚠️ Error al limpiar ausencia previa en Firestore:", err);
            }
        }

        await db.collection('registros').doc(idDocumento).set(nuevoRegistro);

        // Sincronización en segundo plano con Google Sheets (para registrar fila en REGISTROS)
        if (esAusenciaTipo(data.tipo)) {
            this._jsonp({
                accion: 'guardarRegistro',
                id: empleadoId,
                empleadoId: empleadoId,
                tipo: data.tipo,
                fecha: fechaStr,
                fecha_falta: fechaStr,
                hora: horaStr,
                modo: modo,
                razon_ausencia: nuevoRegistro.razon_ausencia,
                razon_justificac: nuevoRegistro.razon_justificac,
                justificado: nuevoRegistro.justificado,
                quien_justifica: data.quien_justifica || 'Supervisor'
            }, 0, 1, 15000).catch(err => {
                console.info("ℹ️ Sincronización secundaria Sheets (guardarRegistro):", err.message);
            });
        }

        return { ok: true, msg: `${data.tipo} registrado con éxito (${modo})` };
    },

    async actualizarBaseCampo(params) {
        const id = params.empleadoId?.toString();
        if (!id) return { error: "ID faltante" };

        await db.collection('empleados').doc(id).update({
            baseLat: params.lat,
            baseLng: params.lng
        });
        return { ok: true };
    },

    async obtenerPersonalArea(params) {
        const area = params.area;
        const querySnap = await db.collection('empleados')
            .where('area', '==', area)
            .where('activo', '==', 'SI')
            .get();

        const empleados = [];
        querySnap.forEach(doc => {
            const data = doc.data();
            empleados.push({
                id: doc.id,
                nombre: data.nombre,
                foto_url: this._normalizarUrlFoto(data.foto_url || data.fotoUrl || "")
            });
        });
        return { empleados };
    },

    async obtenerEmpleadosTaller() {
        try {
            const hoy = new Date();
            const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
            const dia = hoy.getDate().toString().padStart(2, '0');
            const hoyStr = `${hoy.getFullYear()}-${mes}-${dia}`;
            const hoyStrAlt = `${dia}/${mes}/${hoy.getFullYear()}`;

            // 1. Obtener todos los empleados de Taller o Producción
            const empSnap = await db.collection('empleados')
                .where('activo', '==', 'SI')
                .get();

            // 2. Obtener registros recientes (filtramos por ID de empleado si es posible o traemos los últimos)
            // Para simplificar y evitar índices, traemos registros y filtramos en JS
            const regSnap = await db.collection('registros').limit(500).get();

            const authMapa = new Map();
            regSnap.forEach(doc => {
                const data = doc.data();

                let esHoy = false;
                if (data.fecha === hoyStr || data.fecha === hoyStrAlt) esHoy = true;
                else if (data.timestamp) {
                    const fTs = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
                    if (fTs.toDateString() === hoy.toDateString()) esHoy = true;
                }

                if (esHoy && data.tipo === 'ENTRADA') {
                    authMapa.set(data.empleadoId, {
                        autorizado: data.horasExtra || "NO",
                        ubicacion: data.modo || "OFICINA"
                    });
                }
            });

            const taller = [];
            empSnap.forEach(doc => {
                const data = doc.data();
                const area = (data.area || "").toUpperCase();
                if (area === "TALLER" || area === "PRODUCCION") {
                    const infoAuth = authMapa.get(doc.id) || { autorizado: "NO", ubicacion: "OFICINA" };
                    taller.push({
                        id: doc.id,
                        nombre: data.nombre,
                        cargo: data.cargo || "OPERARIO",
                        foto_url: this._normalizarUrlFoto(data.foto_url || data.fotoUrl || ""),
                        authExtras: infoAuth.autorizado,
                        ubicacion: infoAuth.ubicacion === "CAMPO" ? "CAMPO" : "EMPRESA"
                    });
                }
            });

            return { empleados: taller };
        } catch (error) {
            console.error("Error en obtenerEmpleadosTaller:", error);
            return { error: error.message };
        }
    },

    async actualizarAutorizacionExtras(params) {
        const id = params.empleadoId?.toString();
        const autorizado = params.autorizado; // "SI" o "NO"

        if (!id) return { error: "ID faltante" };

        // Buscamos el registro de ENTRADA de hoy para este empleado para actualizarlo
        const hoy = new Date();
        const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
        const dia = hoy.getDate().toString().padStart(2, '0');
        const hoyStr = `${hoy.getFullYear()}-${mes}-${dia}`;
        const hoyStrAlt = `${dia}/${mes}/${hoy.getFullYear()}`;

        const regSnap = await db.collection('registros')
            .where('empleadoId', '==', id)
            .where('tipo', '==', 'ENTRADA')
            .get();

        let registroDocId = null;
        regSnap.forEach(doc => {
            const data = this._processDoc(doc.id, doc.data());
            if (!data) return;
            let esHoy = false;
            if (data.fecha === hoyStr || data.fecha === hoyStrAlt) esHoy = true;
            else if (data.timestamp) {
                const fTs = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
                if (fTs.toDateString() === hoy.toDateString()) esHoy = true;
            }

            if (esHoy) {
                registroDocId = doc.id;
            }
        });

        if (registroDocId) {
            await db.collection('registros').doc(registroDocId).update({
                horasExtra: autorizado,
                autoriza: params.autorizaNombre || "SUPERVISOR"
            });
            return { ok: true, mensaje: `Registro de hoy actualizado a ${autorizado}` };
        } else {
            return { error: "No se encontró registro de entrada para hoy" };
        }
    },

    async obtenerConfiguraciones() {
        try {
            const configSnap = await db.collection('configuracion').doc('sistema').get();

            // Valores por defecto base
            const configDefault = {
                ubicacion: { lat: -0.128877, lng: -78.478967, radio: 250 },
                horarios: { hora_almuerzo: "09:30", hora_entrada_limite: "07:45", hora_salida: "16:15", almuerzo_activo: true, hora_inicio: "07:30", hora_fin: "16:15", marcacion_automatica: false, tiempo_automatico: 10 },
                registro: { tolerancia_gps: 50, requiere_foto: false, permite_registro_manual: true },
                otras: { whatsapp_number: "593963561149", mensaje_soporte: "Hola, necesito soporte técnico", modo_mantenimiento: false }
            };

            if (configSnap.exists) {
                const rawData = configSnap.data();
                let configFinal = {};

                // 1. Intentar cargar desde el campo 'valor' (formato JSON de GAS)
                if (rawData.valor && typeof rawData.valor === 'string') {
                    try {
                        configFinal = JSON.parse(rawData.valor);
                    } catch (e) {
                        console.warn("⚠️ El campo 'valor' no es un JSON válido, usando campos directos");
                    }
                }

                // 2. Si no hay 'valor' o está vacío, usar los campos directos del documento
                // Esto permite editar la configuración directamente en la consola de Firebase
                if (Object.keys(configFinal).length === 0) {
                    configFinal = { ...rawData };
                }

                // 3. Mezclar con valores por defecto para asegurar que no falte nada
                const resultado = {
                    ubicacion: { ...configDefault.ubicacion, ...(configFinal.ubicacion || {}) },
                    horarios: { ...configDefault.horarios, ...(configFinal.horarios || {}) },
                    registro: { ...configDefault.registro, ...(configFinal.registro || {}) },
                    otras: { ...configDefault.otras, ...(configFinal.otras || {}) }
                };

                const emSnap = await db.collection('configuracion').doc('emergencia').get();
                resultado.emergencia = emSnap.exists ? emSnap.data() : { activa: false, nombre: '', habilitadoPor: '', fecha: '' };

                console.log("🚀 Configuración cargada desde Firebase:", resultado);
                return resultado;
            }

            console.warn("⚠️ No se encontró el documento 'configuracion/sistema', usando valores por defecto.");
            const emSnap2 = await db.collection('configuracion').doc('emergencia').get();
            configDefault.emergencia = emSnap2.exists ? emSnap2.data() : { activa: false, nombre: '', habilitadoPor: '', fecha: '' };
            return configDefault;
        } catch (error) {
            console.error("🔥 Error en obtenerConfiguraciones:", error);
            return { error: error.message };
        }
    },

    async toggleEmergencia(params) {
        try {
            const activa = params.activa === 'true' || params.activa === true;
            const nombre = params.nombre || '';
            const empleadoId = params.empleadoId || '';
            await db.collection('configuracion').doc('emergencia').set({
                activa: activa,
                nombre: nombre,
                habilitadoPor: empleadoId,
                fecha: this._hoyStr()
            });
            return { ok: true };
        } catch (error) {
            console.error("🔥 Error en toggleEmergencia:", error);
            return { error: error.message };
        }
    },

    async desvincularDispositivo(params) {
        const id = params.empleadoId?.toString();
        if (!id) return { error: "ID faltante" };

        await db.collection('empleados').doc(id).update({
            deviceToken: "",
            id_dispositivo: ""
        });

        return { ok: true, mensaje: "Dispositivo desvinculado correctamente" };
    },

    async actualizarAlmuerzoSupervisor(params) {
        const id = String(params.empleadoId || '').trim();
        const nuevoAlmuerzo = String(params.almuerzo || '').trim().toUpperCase(); // "SI" o "NO"
        const hoy = new Date();
        const hoyStrLocal = this._hoyStr();
        const targetFecha = params.fecha || hoyStrLocal;

        // 1. Sincronizar con Google Sheets (hoja REGISTROS)
        let sheetsPromise = (async () => {
            try {
                return await this._jsonp({
                    accion: 'actualizarAlmuerzoSupervisor',
                    empleadoId: id,
                    almuerzo: nuevoAlmuerzo,
                    fecha: targetFecha
                }, 0, 2, 35000);
            } catch (e) {
                console.warn("⚠️ Aviso al sincronizar almuerzo en Sheets:", e.message);
                return { error: e.message };
            }
        })();

        // 2. Si el registro existe en Firestore (día actual o no archivado), actualizarlo
        try {
            const allSnap = await db.collection('registros')
                .where('empleadoId', '==', id)
                .get();

            const docs = allSnap.docs.map(doc => this._processDoc(doc.id, doc.data())).filter(Boolean);
            let matchedReg = docs.find(r => r.fecha === targetFecha && ['ENTRADA', 'ENTRADA_CAMPO', 'RETORNO_CAMPO', 'SOLO_ALMUERZO'].includes(r.tipo));
            if (!matchedReg) {
                matchedReg = docs.find(r => r.fecha === targetFecha);
            }

            if (matchedReg) {
                await db.collection('registros').doc(matchedReg.id).update({
                    almuerzo: nuevoAlmuerzo
                });
            } else {
                // Verificar si es usuario solo almuerzo para hoy
                const empDoc = await db.collection('empleados').doc(id).get();
                const empData = empDoc.exists ? empDoc.data() : {};
                const cargo = String(empData.cargo || '').trim().toUpperCase();
                const esSoloAlmuerzo = cargo === 'SOLO ALMUERZO' || cargo === 'SOLO_ALMUERZO' || cargo === 'SIN ASISTENCIA';
                if (esSoloAlmuerzo && targetFecha === hoyStrLocal) {
                    const h = hoy.getHours().toString().padStart(2, '0');
                    const m = hoy.getMinutes().toString().padStart(2, '0');
                    const s = hoy.getSeconds().toString().padStart(2, '0');
                    const horaStr = `${h}:${m}:${s}`;
                    const idLimpio = horaStr.replace(/:/g, '');
                    const idDocumento = `${id}_SOLO_ALMUERZO_${targetFecha}_${idLimpio}`;
                    await db.collection('registros').doc(idDocumento).set({
                        empleadoId: id,
                        nombre: empData.nombre || 'Desconocido',
                        fecha: targetFecha,
                        tipo: 'SOLO_ALMUERZO',
                        almuerzo: nuevoAlmuerzo,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        modo: 'OFICINA',
                        horasExtra: 'NO'
                    });
                }
            }
        } catch (errFs) {
            console.warn("⚠️ Aviso al actualizar almuerzo en Firestore:", errFs.message);
        }

        // 3. Actualizar la caché local de archivados para que el cambio persista en la UI inmediatamente
        try {
            const CACHE_ARCHIVADOS_KEY = `tcontrol_archivados_cache_${id}_v2`;
            const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
            if (storedArch) {
                const archData = JSON.parse(storedArch);
                if (archData && Array.isArray(archData.registros)) {
                    archData.registros.forEach(r => {
                        if (r.fecha === targetFecha) {
                            r.almuerzo = nuevoAlmuerzo;
                        }
                    });
                    localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archData));
                }
            }
        } catch (e) { }

        // Si es fecha pasada, esperar la confirmación de Google Sheets
        if (targetFecha < hoyStrLocal) {
            const resSheets = await sheetsPromise;
            return resSheets || { ok: true, mensaje: "Almuerzo actualizado" };
        }

        // Registrar auditoría en Firebase
        try {
            await db.collection('auditoria_almuerzos').add({
                empleadoId: id,
                fecha: targetFecha,
                nuevoValor: nuevoAlmuerzo,
                autor: "SUPERVISOR",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { }

        return { ok: true, mensaje: "Almuerzo actualizado" };
    },

    async actualizarRegistroGeneral(params) {
        let docId = params.docId;
        const campo = params.campo;
        let valor = params.valor;
        const empleadoId = params.empleadoId;
        const tipo = params.tipo;
        const fecha = params.fecha || this._hoyStr();
        const hoyStrLocal = this._hoyStr();
        const esFechaPasada = fecha < hoyStrLocal;

        if (!campo) return { error: "Falta el campo a actualizar" };

        // 1. Sincronización con Google Sheets (timeout de 35s con reintentos)
        let sheetsRes = null;
        const sheetsPromise = (async () => {
            try {
                let sheetsCampo = campo;
                let sheetsValor = valor;
                if (campo === 'hora' || campo === 'timestamp') {
                    let fParts = (fecha || '').includes('/') ? fecha.split('/') : (fecha || '').split('-');
                    let y, mo, d;
                    if (fParts[0] && fParts[0].length === 4) {
                        y = fParts[0]; mo = fParts[1]; d = fParts[2];
                    } else if (fParts[2] && fParts[2].length === 4) {
                        d = fParts[0]; mo = fParts[1]; y = fParts[2];
                    }
                    let hVal = (campo === 'hora') ? valor : (String(valor).includes(' ') ? String(valor).split(' ')[1] : valor);
                    if (hVal && String(hVal).length === 5) hVal = hVal + ':00';
                    if (y && mo && d && hVal) {
                        sheetsCampo = 'timestamp';
                        sheetsValor = `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y} ${hVal}`;
                    }
                }

                return await this._jsonp({
                    accion: 'actualizarRegistroArchivado',
                    empleadoId: empleadoId,
                    fecha: fecha,
                    tipo: tipo,
                    campo: sheetsCampo,
                    valor: sheetsValor,
                    modo: params.modo,
                    almuerzo: params.almuerzo,
                    horasExtra: params.horasExtra,
                    justificado: params.justificado,
                    razon_justificac: params.razon_justificac,
                    quien_justifica: params.quien_justifica
                }, 0, 2, 35000);
            } catch (e) {
                console.info("ℹ️ Aviso de sincronización Sheets:", e.message);
                return { error: e.message };
            }
        })();

        // 2. Actualizar caché local de archivados para que se refleje inmediatamente en el cliente
        try {
            const CACHE_ARCHIVADOS_KEY = `tcontrol_archivados_cache_${empleadoId}_v2`;
            const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
            if (storedArch) {
                const archData = JSON.parse(storedArch);
                if (archData && Array.isArray(archData.registros)) {
                    archData.registros.forEach(r => {
                        if (r.fecha === fecha && (!tipo || r.tipo === tipo)) {
                            if (campo === 'horasExtra') r.horasExtra = valor;
                            else if (campo === 'almuerzo') r.almuerzo = valor;
                            else if (campo === 'modo' || campo === 'modalidad') r.modo = valor;
                            else if (campo === 'hora') r.hora = valor;
                            else if (campo === 'timestamp') r.timestamp = valor;
                            if (params.horasExtra !== undefined) r.horasExtra = params.horasExtra;
                            if (params.almuerzo !== undefined) r.almuerzo = params.almuerzo;
                            if (params.modo !== undefined) r.modo = params.modo;
                        }
                    });
                    localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archData));
                }
            }
        } catch (e) { }

        // Si era un ID explícito de Sheets o es una fecha pasada, esperar y retornar resultado de Sheets
        if ((docId && String(docId).startsWith('arch_')) || esFechaPasada) {
            sheetsRes = await sheetsPromise;
            if (sheetsRes && sheetsRes.ok) {
                return sheetsRes;
            }
            if (sheetsRes && sheetsRes.error && !esFechaPasada) {
                // Si Sheets falló pero era fecha actual, continúa intentando Firestore
            } else if (sheetsRes && sheetsRes.error && esFechaPasada) {
                return sheetsRes;
            }
            return sheetsRes || { ok: true };
        }

        // 2. EN FIRESTORE: Solo buscar y actualizar SI YA EXISTE. NUNCA crear nuevo documento.
        if (!docId && empleadoId) {
            try {
                const query = await db.collection('registros')
                    .where('empleadoId', '==', empleadoId)
                    .where('tipo', '==', tipo)
                    .get();
                let matchedDoc = null;
                query.forEach(doc => {
                    const docData = this._processDoc(doc.id, doc.data());
                    if (docData && docData.fecha === fecha) {
                        matchedDoc = doc;
                    }
                });
                if (matchedDoc) {
                    docId = matchedDoc.id;
                }
            } catch (errQuery) {
                console.warn("⚠️ Error consultando doc en Firestore:", errQuery.message);
            }
        }

        if (docId) {
            try {
                const docRef = db.collection('registros').doc(docId);
                const docSnap = await docRef.get();

                if (docSnap.exists) {
                    const updateData = {};
                    let baseDate = null;
                    let cleanHora = null;
                    let cleanFecha = null;

                    if (campo === 'timestamp' || campo === 'hora') {
                        const hVal = (campo === 'hora') ? valor : (String(valor).includes(' ') ? String(valor).split(' ')[1] : valor);
                        const [h, m, s] = String(hVal).split(':').map(Number);
                        let fParts = (fecha || '').includes('/') ? fecha.split('/') : (fecha || '').split('-');
                        let year, month, day;
                        if (fParts[0] && fParts[0].length === 4) {
                            year = Number(fParts[0]); month = Number(fParts[1]); day = Number(fParts[2]);
                        } else if (fParts[2] && fParts[2].length === 4) {
                            day = Number(fParts[0]); month = Number(fParts[1]); year = Number(fParts[2]);
                        } else if (docSnap.data().timestamp) {
                            const oldDate = docSnap.data().timestamp.toDate ? docSnap.data().timestamp.toDate() : new Date(docSnap.data().timestamp);
                            if (!isNaN(oldDate.getTime())) {
                                year = oldDate.getFullYear(); month = oldDate.getMonth() + 1; day = oldDate.getDate();
                            }
                        }
                        if (year && month && day) {
                            baseDate = new Date(year, month - 1, day, h || 0, m || 0, s || 0);
                            cleanFecha = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                            cleanHora = `${String(h||0).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:${String(s||0).padStart(2,'0')}`;
                        }
                    }

                    if (baseDate && !isNaN(baseDate.getTime())) {
                        updateData.timestamp = firebase.firestore.Timestamp.fromDate(baseDate);
                        updateData.fecha = cleanFecha || fecha;
                        updateData.hora = cleanHora || valor;
                    } else {
                        updateData[campo] = valor;
                    }
                    if (params.modo) updateData.modo = params.modo;
                    if (params.almuerzo) updateData.almuerzo = params.almuerzo;
                    if (params.horasExtra) updateData.horasExtra = params.horasExtra;
                    if (params.justificado) updateData.justificado = params.justificado;
                    if (params.razon_justificac) updateData.razon_justificac = params.razon_justificac;
                    if (params.razon_ausencia) updateData.razon_ausencia = params.razon_ausencia;
                    await docRef.update(updateData);
                    return { ok: true, sheetsRes };
                } else {
                    // El documento no existe en Firestore: NO CREARLO para evitar duplicados con Google Sheets
                    console.log(`ℹ️ [actualizarRegistroGeneral] Doc ${docId} no existe en Firestore. Actualizado en Google Sheets sin crear duplicado en Firestore.`);
                    return { ok: true, sheetsRes, noFirestoreDoc: true };
                }
            } catch (errUpd) {
                console.warn("⚠️ Error actualizando doc en Firestore:", errUpd.message);
            }
        }

        return { ok: true, sheetsRes };
    },

    async actualizarRegistroArchivado(params) {
        return await this.actualizarRegistroGeneral(params);
    },

    async guardarModalidadSupervisor(params) {
        const empleadoId = String(params.empleadoId || '').trim();
        const fecha = String(params.fecha || '').trim();
        const modalidad = String(params.modalidad || params.modo || '').trim().toUpperCase();
        const supervisorId = String(params.supervisorId || '').trim();

        // 1. Google Sheets primero
        let sheetsRes = null;
        try {
            sheetsRes = await this._jsonp({
                accion: 'actualizarRegistroArchivado',
                empleadoId: empleadoId,
                fecha: fecha,
                tipo: 'ENTRADA',
                campo: 'modo',
                valor: modalidad,
                supervisorId: supervisorId
            });
        } catch (e) {
            console.warn("⚠️ Sheets modalidad aviso:", e);
        }

        // 2. En Firestore: actualizar SOLO si el documento ya existe (no crear nuevos)
        try {
            const query = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .get();
            const batch = db.batch();
            let hasUpdates = false;
            query.forEach(doc => {
                const d = this._processDoc(doc.id, doc.data());
                if (d && d.fecha === fecha) {
                    batch.update(doc.ref, { modo: modalidad });
                    hasUpdates = true;
                }
            });
            if (hasUpdates) await batch.commit();
        } catch (e) {
            console.warn("⚠️ Firestore modalidad aviso:", e);
        }

        return { ok: true, sheetsRes, modalidad };
    },

    async justificarDia(params) {
        const empleadoId = params.empleadoId;
        const fecha = params.fecha;
        const supervisor = params.supervisor || 'Supervisor';
        const razon = params.razon || 'Justificado';

        try {
            // 1. Buscar registros del empleado sin fecha en query en Firebase
            const allSnap = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .get();

            const docs = allSnap.docs.map(doc => this._processDoc(doc.id, doc.data())).filter(Boolean);
            const matchedDocs = docs.filter(data => data.fecha === fecha);

            if (matchedDocs.length > 0) {
                // Actualizar todos los registros existentes para ese día
                const batch = db.batch();
                matchedDocs.forEach(d => {
                    batch.update(db.collection('registros').doc(d.id), {
                        justificado: 'SI',
                        quien_justifica: supervisor,
                        razon_justificac: razon,
                        timestamp: firebase.firestore.Timestamp.fromDate(new Date())
                    });
                });
                await batch.commit();
            } else {
                // Si no hay marcaciones ese día, creamos una marcación de tipo 'JUSTIFICACION'
                const empDoc = await db.collection('empleados').doc(empleadoId).get();
                const nombre = empDoc.exists ? empDoc.data().nombre : empleadoId;

                const fechaPartes = fecha.split('-').map(Number);
                const fechaObj = new Date(fechaPartes[0], fechaPartes[1] - 1, fechaPartes[2], 0, 0, 0);

                await db.collection('registros').add({
                    empleadoId: empleadoId,
                    nombre: nombre,
                    tipo: 'JUSTIFICACION',
                    almuerzo: 'NO',
                    modo: 'OFICINA',
                    horasExtra: 'NO',
                    justificado: 'SI',
                    quien_justifica: supervisor,
                    razon_justificac: razon,
                    timestamp: firebase.firestore.Timestamp.fromDate(fechaObj)
                });
            }

            // 2. Sincronizar la justificación con Google Sheets SOLO si es una fecha pasada
            const hoyStrLocal = this._hoyStr();
            if (fecha < hoyStrLocal) {
                try {
                    await this._jsonp({
                        accion: 'actualizarRegistroArchivado',
                        empleadoId: empleadoId,
                        fecha: fecha,
                        tipo: 'JUSTIFICACION',
                        campo: 'justificado',
                        valor: 'SI',
                        quien_justifica: supervisor,
                        razon_justificac: razon
                    });
                } catch (e) {
                    console.warn("⚠️ Error al enviar justificación a Sheets:", e);
                }
            }

            return { ok: true };
        } catch (error) {
            console.error("🔥 Error en justificarDia:", error);
            return { error: error.message };
        }
    },

    async obtenerAsistenciaEmpleado(params) {
        const id = params.empleadoId;
        const query = await db.collection('registros')
            .where('empleadoId', '==', id)
            .get();

        return query.docs.map(doc => this._processDoc(doc.id, doc.data())).filter(Boolean);
    },

    async obtenerReporteMensual(params) {
        // En Firebase, si no hay índices complejos, esto puede ser lento si bajamos todo.
        // Pero para el sistema TCONTROL solemos bajar los últimos 30-60 días.
        const query = await db.collection('registros').get();
        return query.docs.map(doc => this._processDoc(doc.id, doc.data())).filter(Boolean);
    },

    async verificarClaveGuardia(params) {
        const clave = params.clave || params.pin;
        if (clave === "TCONTROL2026") {
            return { ok: true };
        }
        return { error: "Contraseña incorrecta" };
    },

    async eliminarRegistro(params) {
        const docId = params.docId;
        const empleadoId = params.empleadoId;
        const fecha = params.fecha;
        const tipo = params.tipo;

        if (docId && String(docId).startsWith('arch_')) {
            try {
                return await this._jsonp({
                    accion: 'eliminarRegistroArchivado',
                    empleadoId: empleadoId,
                    fecha: fecha,
                    tipo: tipo
                });
            } catch (e) { return { error: "Error de conexión con Sheets: " + e.message }; }
        }

        if (docId) {
            await db.collection('registros').doc(docId).delete();
            return { ok: true };
        }
        return { error: "ID de documento faltante" };
    },

    async eliminarRegistroFirestorePorFecha(empleadoId, fecha) {
        if (!empleadoId || !fecha) return;
        try {
            const eidStr = String(empleadoId).trim();
            const snap = await db.collection('registros')
                .where('empleadoId', '==', eidStr)
                .get();
            const docsToDelete = [];
            snap.forEach(doc => {
                const docData = this._processDoc(doc.id, doc.data());
                if (docData && docData.fecha === fecha) {
                    docsToDelete.push(doc.id);
                }
            });
            for (const dId of docsToDelete) {
                await db.collection('registros').doc(dId).delete();
                console.log(`🗑️ [Firestore] Eliminado doc huérfano ${dId} de fecha ${fecha}`);
            }
        } catch (err) {
            console.warn("⚠️ Aviso al limpiar Firestore por fecha:", err.message);
        }
    },

    async guardarConfiguraciones(params) {
        try {
            const config = typeof params.configuraciones === 'string' ?
                JSON.parse(params.configuraciones) : params.configuraciones;

            await db.collection('configuracion').doc('sistema').set({
                valor: config,
                fecha_actualizacion: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { ok: true };
        } catch (e) {
            return { error: e.message };
        }
    },

    async obtenerMenuSemanal() {
        try {
            const doc = await db.collection('configuracion').doc('menu_semanal').get();
            const data = (doc.exists && doc.data()) ? doc.data() : {};

            const diasDefault = {
                lunes: { sopa: '', plato: '', jugo: '' },
                martes: { sopa: '', plato: '', jugo: '' },
                miercoles: { sopa: '', plato: '', jugo: '' },
                jueves: { sopa: '', plato: '', jugo: '' },
                viernes: { sopa: '', plato: '', jugo: '' },
                sabado: { sopa: '', plato: '', jugo: '' },
                domingo: { sopa: '', plato: '', jugo: '' }
            };

            let tieneContenido = false;
            const res = {};
            for (const dia of Object.keys(diasDefault)) {
                res[dia] = Object.assign({}, diasDefault[dia], data[dia] || {});
                if (res[dia].plato || res[dia].sopa || res[dia].jugo) {
                    tieneContenido = true;
                }
            }

            if (tieneContenido) {
                try { localStorage.setItem('tcontrol_menu_semanal_cache', JSON.stringify(res)); } catch (e) { }
                return res;
            }

            // Fallback a cache local si Firestore devolviera objeto vacío
            try {
                const cached = localStorage.getItem('tcontrol_menu_semanal_cache');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && typeof parsed === 'object') return parsed;
                }
            } catch (e) { }

            return res;
        } catch (e) {
            console.error("Error al obtener menú semanal:", e);
            try {
                const cached = localStorage.getItem('tcontrol_menu_semanal_cache');
                if (cached) return JSON.parse(cached);
            } catch (e2) { }
            return {
                lunes: { sopa: '', plato: '', jugo: '' },
                martes: { sopa: '', plato: '', jugo: '' },
                miercoles: { sopa: '', plato: '', jugo: '' },
                jueves: { sopa: '', plato: '', jugo: '' },
                viernes: { sopa: '', plato: '', jugo: '' },
                sabado: { sopa: '', plato: '', jugo: '' },
                domingo: { sopa: '', plato: '', jugo: '' }
            };
        }
    },

    async guardarMenuSemanal(params) {
        try {
            let menu = params.menu;
            if (typeof menu === 'string') {
                try { menu = JSON.parse(menu); } catch (e) { }
            }
            if (!menu || typeof menu !== 'object') {
                return { error: 'Formato de menú inválido' };
            }
            await db.collection('configuracion').doc('menu_semanal').set(menu);
            try { localStorage.setItem('tcontrol_menu_semanal_cache', JSON.stringify(menu)); } catch (e) { }
            return { ok: true };
        } catch (e) {
            console.error("Error al guardar menú semanal:", e);
            return { error: e.message };
        }
    },

    async archivarMenuConsumido(params) {
        try {
            let regs = params.registros;
            if (typeof regs === 'string') {
                try { regs = JSON.parse(regs); } catch (e) { }
            }
            if (Array.isArray(regs) && regs.length > 0) {
                const batch = db.batch();
                regs.forEach(r => {
                    const idDoc = ((r.fecha || '').replace(/\//g, '-') + '_' + (r.dia || '').toLowerCase()).trim();
                    if (idDoc) {
                        const docRef = db.collection('auditoria_almuerzos').doc(idDoc);
                        batch.set(docRef, {
                            ...r,
                            archivadoEn: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                });
                await batch.commit();
            }
            return { ok: true };
        } catch (e) {
            console.warn("Aviso: No se pudo archivar menú en auditoría:", e);
            return { ok: true };
        }
    },

    async obtenerHistorialMenuSugerencias() {
        try {
            const sopas = new Set(['Crema de verduras', 'Locro de papa', 'Sopa de pollo con fideos', 'Caldo de bolas de verde', 'Menestrón de carne', 'Sopa de lenteja', 'Crema de zapallo']);
            const platos = new Set(['Seco de pollo con arroz y ensalada', 'Carne apanada con menestra', 'Lomo saltado tradicional', 'Pollo al jugo con papas doradas', 'Filete de pescado con patacones', 'Guiso de carne con arroz blanco', 'Asado con ensalada fresca']);
            const jugos = new Set(['Jugo de mora', 'Jugo de naranjilla', 'Jugo de maracuyá', 'Limonada imperial', 'Jugo de piña', 'Jugo de guanábana', 'Jugo de mandarina']);

            try {
                const snap = await db.collection('auditoria_almuerzos').limit(20).get();
                snap.forEach(d => {
                    const m = d.data();
                    if (m.sopa) sopas.add(m.sopa);
                    if (m.plato) platos.add(m.plato);
                    if (m.jugo) jugos.add(m.jugo);
                });
            } catch (eSnap) { }

            return {
                ok: true,
                sopas: Array.from(sopas),
                platos: Array.from(platos),
                jugos: Array.from(jugos)
            };
        } catch (e) {
            return {
                ok: true,
                sopas: ['Crema de verduras', 'Locro de papa', 'Sopa de pollo', 'Menestrón'],
                platos: ['Seco de pollo', 'Carne apanada', 'Lomo saltado', 'Pescado frito'],
                jugos: ['Jugo de mora', 'Jugo de naranjilla', 'Jugo de maracuyá', 'Limonada']
            };
        }
    },

    async obtenerPreguntasCultura() {
        try {
            const doc = await db.collection('configuracion').doc('cultura_preguntas').get();
            let habilitado = true;
            if (doc.exists && doc.data()) {
                const data = doc.data();
                if (data.habilitado !== undefined) habilitado = (data.habilitado === true || data.habilitado === 'true');
                if (Array.isArray(data.preguntas) && data.preguntas.length > 0) {
                    try {
                        localStorage.setItem('cultura_preguntas_cache', JSON.stringify(data.preguntas));
                        localStorage.setItem('cultura_habilitada_global', habilitado ? 'true' : 'false');
                    } catch (e) { }
                    return { ok: true, preguntas: data.preguntas, habilitado: habilitado };
                }
            }

            // Intentar leer desde Google Sheets si no está en Firebase
            try {
                const sheetsRes = await this._jsonp({ accion: 'obtenerPreguntasCultura' });
                if (sheetsRes && Array.isArray(sheetsRes.preguntas) && sheetsRes.preguntas.length > 0) {
                    return { ok: true, preguntas: sheetsRes.preguntas, habilitado: habilitado };
                }
            } catch (errSheets) {
                console.warn("⚠️ No se pudo consultar preguntas desde Google Sheets:", errSheets);
            }

            // Intentar leer de cache local
            try {
                const cached = localStorage.getItem('cultura_preguntas_cache');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) return { ok: true, preguntas: parsed, habilitado: habilitado };
                }
            } catch (e) { }

            return {
                ok: true,
                habilitado: habilitado,
                preguntas: [
                    {
                        id: 'proposito',
                        tipo: 'PROPOSITO',
                        pilar: 'Propósito',
                        clasePilar: 'quiz-pillar-proposito',
                        iconoPilar: '🎯',
                        pregunta: '¿Cuál es el Propósito de Tcontrol?',
                        pista: 'Recuerda: El propósito de Tcontrol es <strong>"Diseñar soluciones para el futuro"</strong>.',
                        opciones: [
                            { letra: 'A', texto: 'Diseñar soluciones para el futuro', correcta: true },
                            { letra: 'B', texto: 'Vender equipos eléctricos al menor costo', correcta: false },
                            { letra: 'C', texto: 'Importar maquinaria industrial usada', correcta: false }
                        ],
                        activo: true
                    },
                    {
                        id: 'mision',
                        tipo: 'MISION',
                        pilar: 'Misión',
                        clasePilar: 'quiz-pillar-mision',
                        iconoPilar: '⚡',
                        pregunta: '¿Cuál es la Misión principal de Tcontrol?',
                        pista: 'Recuerda: La misión es <strong>"Brindar soluciones eléctricas confiables mediante diseño y fabricación de tableros, cuartos eléctricos y automatización con calidad, eficiencia y seguridad"</strong>.',
                        opciones: [
                            { letra: 'A', texto: 'Comercializar herramientas manuales para construcción', correcta: false },
                            { letra: 'B', texto: 'Brindar soluciones eléctricas confiables mediante el diseño y fabricación de tableros de control industrial, cuartos eléctricos y sistemas de automatización adaptados a cada cliente con calidad y seguridad', correcta: true },
                            { letra: 'C', texto: 'Realizar únicamente instalaciones residenciales básicas', correcta: false }
                        ],
                        activo: true
                    },
                    {
                        id: 'vision',
                        tipo: 'VISION',
                        pilar: 'Visión (2030)',
                        clasePilar: 'quiz-pillar-vision',
                        iconoPilar: '🚀',
                        pregunta: 'Para el año 2030, la Visión de Tcontrol es:',
                        pista: 'Recuerda: La visión 2030 es <strong>"Ser referentes nacionales en soluciones electromecánicas de calidad (>95% satisfacción), con certificaciones internacionales y expansión a al menos 2 países"</strong>.',
                        opciones: [
                            { letra: 'A', texto: 'Ser referentes nacionales como proveedores de soluciones electromecánicas de calidad (>95% satisfacción), certificaciones internacionales y expandir operaciones a 2 países de la región', correcta: true },
                            { letra: 'B', texto: 'Cambiar el modelo de negocio al comercio minorista', correcta: false },
                            { letra: 'C', texto: 'Reducir las operaciones a una sola ciudad local', correcta: false }
                        ],
                        activo: true
                    },
                    {
                        id: 'valores_calidad',
                        tipo: 'VALORES',
                        pilar: 'Valores y Calidad',
                        clasePilar: 'quiz-pillar-proposito',
                        iconoPilar: '🛡️',
                        pregunta: '¿Cuáles son los principios fundamentales de calidad y seguridad en Tcontrol?',
                        pista: 'Recuerda: En Tcontrol la <strong>calidad superior, precisión técnica y seguridad del personal y cliente</strong> son nuestros pilares de trabajo diario.',
                        opciones: [
                            { letra: 'A', texto: 'Priorizar la velocidad sobre la seguridad y el control de calidad', correcta: false },
                            { letra: 'B', texto: 'Cumplimiento estricto de normas técnicas, precisión en ensamblaje y protección total del personal', correcta: true },
                            { letra: 'C', texto: 'Entregar proyectos sin protocolos de prueba ni calibración', correcta: false }
                        ],
                        activo: true
                    }
                ]
            };
        } catch (e) {
            console.error("Error al obtener preguntas de cultura:", e);
            return { error: e.message };
        }
    },

    async guardarPreguntasCultura(params) {
        try {
            const raw = params.preguntas;
            const preguntas = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const dataToSet = {
                preguntas: preguntas,
                actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (params.habilitado !== undefined) {
                dataToSet.habilitado = (params.habilitado === true || params.habilitado === 'true');
            }

            // 1. Guardar en Firestore
            await db.collection('configuracion').doc('cultura_preguntas').set(dataToSet, { merge: true });

            // 2. Guardar en Google Sheets (Hoja CULTURA_PREGUNTAS)
            try {
                await this._jsonp({
                    accion: 'guardarPreguntasCultura',
                    preguntas: typeof params.preguntas === 'string' ? params.preguntas : JSON.stringify(params.preguntas)
                });
            } catch (errSheets) {
                console.warn("⚠️ No se pudo sincronizar preguntas con Google Sheets:", errSheets);
            }

            // 3. Guardar en cache local
            try {
                localStorage.setItem('cultura_preguntas_cache', JSON.stringify(preguntas));
                if (dataToSet.habilitado !== undefined) {
                    localStorage.setItem('cultura_habilitada_global', dataToSet.habilitado ? 'true' : 'false');
                }
            } catch (e) { }

            return { ok: true, mensaje: "Banco de preguntas guardado en Google Sheets y Firebase" };
        } catch (e) {
            console.error("Error al guardar preguntas de cultura:", e);
            return { error: e.message };
        }
    },

    async toggleCulturaTcontrol(params) {
        try {
            const habilitado = (params.habilitado === true || params.habilitado === 'true');
            await db.collection('configuracion').doc('cultura_preguntas').set({
                habilitado: habilitado,
                actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            try {
                localStorage.setItem('cultura_habilitada_global', habilitado ? 'true' : 'false');
            } catch (e) { }

            return { ok: true, habilitado: habilitado };
        } catch (e) {
            console.error("Error en toggleCulturaTcontrol:", e);
            return { ok: false, error: e.message };
        }
    },

    async toggleCulturaEmpleado(params) {
        try {
            const empleadoId = (params.empleadoId || params.id || "").toString().trim();
            if (!empleadoId) return { error: "ID de empleado no especificado" };
            const habilitado = (params.habilitado === true || params.habilitado === 'true');
            await db.collection('empleados').doc(empleadoId).set({
                cultura_habilitada: habilitado,
                cultura_activa: habilitado
            }, { merge: true });
            return { ok: true, empleadoId: empleadoId, habilitado: habilitado };
        } catch (e) {
            console.error("Error en toggleCulturaEmpleado:", e);
            return { ok: false, error: e.message };
        }
    },

    async obtenerConfiguracionWhatsApp() {
        try {
            const doc = await db.collection('configuracion').doc('whatsapp').get();
            if (doc.exists && doc.data()) {
                return { ok: true, config: doc.data() };
            }
            return { ok: true, config: null };
        } catch (e) {
            console.error("Error al obtener configuración de WhatsApp:", e);
            return { error: e.message };
        }
    },

    async guardarConfiguracionWhatsApp(params) {
        try {
            const config = typeof params.config === 'string' ? JSON.parse(params.config) : (params.config || params);
            await db.collection('configuracion').doc('whatsapp').set({
                ...config,
                actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            try {
                const configParaSheets = { ...config };
                if (configParaSheets.imagenesPlantillas) {
                    delete configParaSheets.imagenesPlantillas;
                }
                await this._jsonp({
                    accion: 'guardarConfiguracionWhatsApp',
                    config: JSON.stringify(configParaSheets)
                });
            } catch (errSheets) {
                console.warn("Aviso al sincronizar config WhatsApp con Sheets:", errSheets);
            }

            return { ok: true, mensaje: "Configuración de WhatsApp guardada con éxito" };
        } catch (e) {
            console.error("Error al guardar configuración de WhatsApp:", e);
            return { error: e.message };
        }
    },

    async obtenerSupervisores() {
        const query = await db.collection('empleados').where('supervisor', '==', 'SI').get();
        return query.docs.map(doc => ({
            id: doc.id,
            nombre: doc.data().nombre
        }));
    },

    async agregarSupervisor(params) {
        const id = params.empleadoId;
        await db.collection('empleados').doc(id).update({ supervisor: 'SI' });
        return { ok: true };
    },

    async eliminarSupervisor(params) {
        const id = params.empleadoId;
        await db.collection('empleados').doc(id).update({ supervisor: 'NO' });
        return { ok: true };
    },

    async actualizarEmpleado(params) {
        const id = (params.empleadoId || params.id || '').toString().trim();
        if (!id) return { error: "Falta ID de empleado" };

        let updateData = {};
        if (params.datos && typeof params.datos === 'object') {
            updateData = { ...params.datos };
        } else if (params.campo) {
            updateData[params.campo] = params.valor;
        } else {
            const camposPermitidos = ['nombre', 'area', 'cargo', 'telefono', 'pin', 'supervisor', 'rol', 'activo', 'cultura_habilitada', 'cultura_activa', 'id_dispositivo', 'foto_url', 'fechaNacimiento'];
            camposPermitidos.forEach(k => {
                if (params[k] !== undefined) updateData[k] = params[k];
            });
        }

        if (Object.keys(updateData).length === 0) {
            return { error: "No se proporcionaron campos para actualizar" };
        }

        if (updateData.cultura_habilitada !== undefined) {
            updateData.cultura_activa = updateData.cultura_habilitada;
        }

        await db.collection('empleados').doc(id).set(updateData, { merge: true });
        return { ok: true, empleadoId: id, actualizados: Object.keys(updateData) };
    },

    async eliminarEmpleadoDefinitivo(params) {
        let ids = [];
        if (params.empleadoIds) {
            ids = String(params.empleadoIds).split(',').map(s => s.trim()).filter(Boolean);
        } else if (params.empleadoId) {
            ids = [String(params.empleadoId).trim()];
        }

        if (ids.length === 0) return { error: "No se proporcionaron IDs para eliminar." };

        let count = 0;
        let detalles = [];

        for (const id of ids) {
            try {
                const docRef = db.collection('empleados').doc(id);
                const docSnap = await docRef.get();
                let nombre = docSnap.exists ? (docSnap.data().nombre || id) : id;
                await docRef.delete();
                count++;
                detalles.push({ id, nombre });
            } catch (e) {
                console.warn(`Error eliminando empleado ${id} en Firestore:`, e);
            }
        }

        let resSheets = null;
        try {
            resSheets = await this._jsonp(params);
        } catch (e) {
            console.warn("Error en eliminación Sheets:", e);
        }

        const totalFinal = resSheets && resSheets.totalEliminados ? resSheets.totalEliminados : count;
        const detallesFinal = resSheets && resSheets.detalles ? resSheets.detalles : detalles;
        const msg = resSheets && resSheets.mensaje ? resSheets.mensaje : `Se eliminaron ${totalFinal} colaborador(es) de la base de datos.`;

        return {
            ok: true,
            totalEliminados: totalFinal,
            detalles: detallesFinal,
            mensaje: msg
        };
    },

    async desvincularColaborador(params) {
        const empId = params.empleadoId ? String(params.empleadoId).trim() : '';
        const empCedula = params.cedula ? String(params.cedula).trim() : '';
        const motivo = params.motivo || 'Desvinculación laboral';
        const fechaDesv = params.fechaDesvinculacion || new Date().toISOString().split('T')[0];
        const supervisor = params.supervisor || 'Supervisor';

        if (!empId && !empCedula) return { error: "No se proporcionó el ID o Cédula del colaborador." };

        // 1. Archivar y retirar de Firestore
        let empNombre = params.nombre || '';
        try {
            const docRef = db.collection('empleados').doc(empId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                const data = docSnap.data();
                empNombre = empNombre || data.nombre || empId;
                await db.collection('empleados_desvinculados').doc(empId).set({
                    ...data,
                    desvinculado: true,
                    fechaDesvinculacion: fechaDesv,
                    motivoDesvinculacion: motivo,
                    desvinculadoPor: supervisor,
                    observaciones: params.observaciones || '',
                    timestampDesvinculacion: firebase.firestore.FieldValue.serverTimestamp()
                });
                await docRef.delete();
            } else {
                await db.collection('empleados_desvinculados').doc(empId).set({
                    id: empId,
                    cedula: empCedula,
                    nombre: empNombre || `Colaborador (${empId})`,
                    desvinculado: true,
                    fechaDesvinculacion: fechaDesv,
                    motivoDesvinculacion: motivo,
                    desvinculadoPor: supervisor,
                    observaciones: params.observaciones || '',
                    timestampDesvinculacion: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        } catch (e) {
            console.warn("Aviso al archivar en Firestore:", e);
        }

        // 2. Ejecutar traslado atómico a la hoja DESVINCULADOS en Google Sheets
        let resSheets = null;
        try {
            resSheets = await this._jsonp({
                accion: 'desvincularColaborador',
                empleadoId: empId,
                cedula: empCedula,
                nombre: empNombre,
                motivo: motivo,
                fechaDesvinculacion: fechaDesv,
                supervisor: supervisor,
                observaciones: params.observaciones || ''
            }, 0, 2, 45000);
        } catch (e) {
            console.warn("Aviso al ejecutar traslado a DESVINCULADOS en Google Sheets:", e);
            // Si la conexión con Sheets tarda o tiene timeout, Firestore ya archivó correctamente al colaborador
            return {
                ok: true,
                mensaje: `Colaborador ${empNombre || empId} desvinculado con éxito en el sistema. (La sincronización de respaldo en Google Sheets continúa en segundo plano).`,
                desvinculadoFirestore: true
            };
        }

        return resSheets || { ok: true, mensaje: "Colaborador desvinculado correctamente." };
    },

    async listarDesvinculados(params) {
        try {
            let resSheets = { ok: true, desvinculados: [] };
            try {
                resSheets = await this._jsonp({ accion: 'listarDesvinculados' });
            } catch (e) {
                console.warn("Sheets listarDesvinculados fallo, continuando con Firestore:", e);
            }

            let listaSheets = (resSheets && Array.isArray(resSheets.desvinculados)) ? resSheets.desvinculados : [];
            const idsMap = new Set(listaSheets.map(d => String(d.id || '').trim()));

            // También consultar Firestore: empleados_desvinculados
            try {
                const desvSnap = await db.collection('empleados_desvinculados').get();
                desvSnap.forEach(doc => {
                    const data = doc.data();
                    const docId = String(doc.id).trim();
                    if (!idsMap.has(docId)) {
                        listaSheets.push({
                            id: docId,
                            nombre: data.nombre || `Colaborador (${docId})`,
                            fechaDesvinculacion: data.fechaDesvinculacion || '',
                            motivo: data.motivoDesvinculacion || 'Desvinculación laboral',
                            supervisor: data.desvinculadoPor || 'Admin',
                            observaciones: data.observaciones || '',
                            registrosRespaldados: 'En Firestore'
                        });
                        idsMap.add(docId);
                    }
                });
            } catch (fsErr) {
                console.warn("Error leyendo empleados_desvinculados en Firestore:", fsErr);
            }

            return { ok: true, desvinculados: listaSheets };
        } catch (e) {
            console.error("Error al listar desvinculados:", e);
            return { ok: false, error: e.toString(), desvinculados: [] };
        }
    },

    async actualizarMasivoEmpleados(params) {
        try {
            if (!params.empleados) return { error: "No se proporcionaron datos de empleados" };
            const lista = typeof params.empleados === 'string' ? JSON.parse(params.empleados) : params.empleados;

            console.log(`⚡ Iniciando importación masiva y dinámica de ${lista.length} empleados...`);

            let batch = db.batch();
            let count = 0;
            let guardados = 0;

            for (const emp of lista) {
                if (!emp.id) continue;
                const docRef = db.collection('empleados').doc(emp.id.toString());

                const dataObj = {};

                // Mapear dinámicamente todas las propiedades recibidas
                for (const key in emp) {
                    if (emp.hasOwnProperty(key)) {
                        if (key === 'id') continue; // ID es el doc id, no va en el cuerpo del doc

                        let val = emp[key];

                        // Conversión de tipos segura
                        if (key === 'baseLat' || key === 'baseLng') {
                            if (val !== undefined && val !== null && val !== '') {
                                const num = Number(val);
                                if (!isNaN(num)) {
                                    dataObj[key] = num;
                                }
                            }
                        } else if (key === 'pin') {
                            if (val !== undefined && val !== null && val !== '') {
                                dataObj[key] = val.toString();
                            }
                        } else if (key === 'supervisor') {
                            dataObj[key] = val || 'NO';
                        } else if (key === 'activo') {
                            dataObj[key] = val || 'SI';
                        } else {
                            dataObj[key] = val !== undefined && val !== null ? val.toString() : '';
                        }
                    }
                }

                // Asegurar campos mínimos obligatorios por si no estuvieran presentes
                if (dataObj.activo === undefined) dataObj.activo = 'SI';
                if (dataObj.supervisor === undefined) dataObj.supervisor = 'NO';

                batch.set(docRef, dataObj, { merge: true });
                count++;
                guardados++;

                if (count === 400) {
                    await batch.commit();
                    batch = db.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
            }

            console.log(`✅ Importación masiva completada: ${guardados} empleados procesados.`);
            return { ok: true, procesados: guardados };
        } catch (error) {
            console.error("🔥 Error en actualizarMasivoEmpleados:", error);
            return { error: error.message || error.toString() };
        }
    },

    async resetearPinesTodosLosEmpleados(params = {}) {
        try {
            console.log("🔄 Iniciando restablecimiento de contraseñas/PINs de todos los empleados...");
            const querySnap = await db.collection('empleados').get();

            if (querySnap.empty) {
                return { ok: false, error: "No se encontraron empleados en la base de datos." };
            }

            let batch = db.batch();
            let count = 0;
            let totalActualizados = 0;

            for (const doc of querySnap.docs) {
                // Actualizar PIN a vacío para que el usuario deba registrar su nueva contraseña
                const updateData = { pin: "" };

                // Si se solicita desvincular dispositivos también (opcional)
                if (params.desvincularDispositivos) {
                    updateData.deviceToken = "";
                }

                batch.update(doc.ref, updateData);
                count++;
                totalActualizados++;

                // Límite de lote Firestore de 500
                if (count === 400) {
                    await batch.commit();
                    batch = db.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
            }

            // Si se solicitó desvincular dispositivos, limpiar colección de dispositivos
            if (params.desvincularDispositivos) {
                try {
                    const dispSnap = await db.collection('dispositivos').get();
                    let dispBatch = db.batch();
                    let dispCount = 0;
                    for (const doc of dispSnap.docs) {
                        dispBatch.delete(doc.ref);
                        dispCount++;
                        if (dispCount === 400) {
                            await dispBatch.commit();
                            dispBatch = db.batch();
                            dispCount = 0;
                        }
                    }
                    if (dispCount > 0) {
                        await dispBatch.commit();
                    }
                } catch (e) {
                    console.warn("Aviso al limpiar dispositivos:", e);
                }
            }

            // Sincronizar con Google Sheets (dual write)
            try {
                this._jsonp({ accion: 'resetearPinesEmpleados' });
            } catch (e) {
                console.warn("Aviso al sincronizar reseteo con Sheets:", e);
            }

            console.log(`✅ Contraseñas/PINs restablecidos para ${totalActualizados} empleados.`);
            return {
                ok: true,
                mensaje: `Se restablecieron los PINs de ${totalActualizados} empleados exitosamente. Ahora cada empleado podrá registrar su nueva contraseña personal.`,
                empleadosAfectados: totalActualizados
            };
        } catch (error) {
            console.error("🔥 Error en resetearPinesTodosLosEmpleados:", error);
            return { error: error.message || error.toString() };
        }
    },

    async obtenerListaCatering() {
        try {
            const hoy = new Date();
            const hoyStr = this._hoyStr(hoy);

            // 1. Obtener todos los registros de ENTRADA y SOLO_ALMUERZO de hoy
            const regSnap = await db.collection('registros')
                .where('fecha', '==', hoyStr)
                .where('tipo', 'in', ['ENTRADA', 'SOLO_ALMUERZO'])
                .get();

            // 2. Obtener consumos de hoy
            const conSnap = await db.collection('consumo_almuerzos')
                .where('fecha', '==', hoyStr)
                .get();

            const consumidosIds = new Set(conSnap.docs.map(doc => doc.data().empleadoId));

            const empleadosList = [];
            for (const doc of regSnap.docs) {
                const data = doc.data();

                // Normalización de valor de almuerzo
                const valorAlmuerzo = (data.almuerzo || "").toString().toUpperCase().trim();
                const quiereAlmuerzo = valorAlmuerzo === "SI" || valorAlmuerzo === "SÍ";

                if (quiereAlmuerzo) {
                    const empDoc = await db.collection('empleados').doc(data.empleadoId).get();
                    if (empDoc.exists) {
                        const empData = empDoc.data();
                        empleadosList.push({
                            id: data.empleadoId,
                            nombre: empData.nombre,
                            area: empData.area,
                            foto_url: empData.foto_url,
                            hora_entrada: data.hora,
                            consumido: consumidosIds.has(data.empleadoId)
                        });
                    }
                }
            }
            return { empleados: empleadosList };
        } catch (e) {
            return { error: e.message };
        }
    },

    async marcarAlmuerzoConsumido(params) {
        const id = params.empleadoId;
        const nombre = params.nombre;
        const hoy = new Date();
        const hoyStr = this._hoyStr(hoy);

        const uniqueId = `${id}_${hoyStr}`;
        await db.collection('consumo_almuerzos').doc(uniqueId).set({
            empleadoId: id,
            nombre: nombre,
            fecha: hoyStr,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            hora: hoy.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        });
        return { ok: true };
    },

    async crearSolicitudInvitado(params) {
        try {
            const ahora = new Date();
            const hoyStr = this._hoyStr(ahora);
            const fechaTarget = params.fecha || hoyStr;
            const esParaHoy = (fechaTarget === hoyStr);
            const minActual = ahora.getHours() * 60 + ahora.getMinutes();

            const tipoSolicitud = (params.tipoSolicitud || 'ALMUERZO_EXTRA').toUpperCase();
            const subtipo = (params.subtipo || tipoSolicitud).toUpperCase();

            // 0. Validar que no sea fecha en el pasado
            if (fechaTarget < hoyStr) {
                return { ok: false, error: "No es posible registrar solicitudes para fechas pasadas." };
            }

            // 1. Validaciones de horario límite (RIGEN ÚNICAMENTE SI LA SOLICITUD ES PARA EL MISMO DÍA)
            if (esParaHoy) {
                if (tipoSolicitud === 'ALMUERZO_EXTRA' || subtipo === 'ALMUERZO_EXTRA') {
                    // Máximo hasta las 09:40 (9 * 60 + 40 = 580)
                    if (minActual > 580) {
                        return { ok: false, error: "Las solicitudes de Almuerzo Extra para hoy cerraron a las 09:40. Puede programar su solicitud anticipada seleccionando una fecha futura." };
                    }
                } else if (subtipo === 'REFRIGERIO_SANDUCHE' || (tipoSolicitud === 'REFRIGERIO' && !subtipo.includes('GALLETA'))) {
                    // Sánduches máximo hasta las 08:40 (8 * 60 + 40 = 520)
                    if (minActual > 520) {
                        return { ok: false, error: "Las solicitudes de sánduches para el mismo día cerraron a las 08:40. Para hoy puede solicitar Break con galletas de TCONTROL, o seleccionar una fecha futura para sánduches." };
                    }
                }
            }

            // 1.1 Validación de exclusión de usuarios de Taller
            const infoAreaCargo = ((params.empleadoArea || '') + ' ' + (params.cargo || '')).toUpperCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (infoAreaCargo.includes('TALLER')) {
                return { ok: false, error: "Esta opción no está disponible para personal del área de Taller." };
            }

            if (params.empleadoId && typeof db !== 'undefined' && db) {
                try {
                    const empDoc = await db.collection('empleados').doc(params.empleadoId.toString()).get();
                    if (empDoc.exists) {
                        const dataEmp = empDoc.data() || {};
                        const docAreaCargo = ((dataEmp.area || '') + ' ' + (dataEmp.cargo || '')).toUpperCase()
                            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        if (docAreaCargo.includes('TALLER')) {
                            return { ok: false, error: "Esta opción no está disponible para personal del área de Taller." };
                        }
                    }
                } catch (eDoc) {
                    console.warn("Aviso verificando área de empleado:", eDoc);
                }
            }

            const cantidad = parseInt(params.cantidad) || 1;
            const invitado = (params.invitado || 'Invitado').trim();
            const empresa = (params.empresa || 'TCONTROL').trim();
            const empleadoId = String(params.empleadoId || '').trim();
            const empleadoNombre = (params.empleadoNombre || 'Colaborador').trim();
            const empleadoArea = (params.empleadoArea || '').trim();
            const horaServicio = (params.horaServicio || '').trim();
            const observaciones = (params.observaciones || '').trim();

            const horaActualStr = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}:${String(ahora.getSeconds()).padStart(2, '0')}`;

            // Construir observaciones con trazabilidad de área y hora estimada
            let obsCompleta = observaciones;
            if (horaServicio) obsCompleta = obsCompleta ? `${obsCompleta} [Hora req: ${horaServicio}]` : `[Hora req: ${horaServicio}]`;
            if (empleadoArea) obsCompleta = obsCompleta ? `${obsCompleta} [Área: ${empleadoArea}]` : `[Área: ${empleadoArea}]`;
            if (empleadoNombre && !invitado.toLowerCase().includes(empleadoNombre.toLowerCase())) {
                obsCompleta = obsCompleta ? `${obsCompleta} (Sol: ${empleadoNombre})` : `(Sol: ${empleadoNombre})`;
            }

            // 2. Registro exclusivo en Firestore (disponibilidad instantánea, sin latencia ni cuotas de Sheets)
            const idDoc = `inv_${fechaTarget.replace(/-/g, '')}_${horaActualStr.replace(/:/g, '')}_${empleadoId || 'ext'}_${Math.random().toString(36).slice(2, 6)}`;
            const dataFirestore = {
                id: idDoc,
                fecha: fechaTarget,
                hora: horaActualStr,
                tipoSolicitud: tipoSolicitud,
                subtipo: subtipo,
                cantidad: cantidad,
                invitado: invitado,
                empresa: empresa,
                empleadoId: empleadoId,
                empleadoNombre: empleadoNombre,
                empleadoArea: empleadoArea,
                horaServicio: horaServicio,
                observaciones: observaciones,
                observacionesCompletas: obsCompleta,
                estado: 'SOLICITADO',
                creadoPor: params.creadoPor || 'USUARIO',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('solicitudes_invitados').doc(idDoc).set(dataFirestore);

            return { ok: true, mensaje: "Solicitud registrada con éxito", data: dataFirestore };
        } catch (error) {
            console.error("🔥 Error en crearSolicitudInvitado:", error);
            return { ok: false, error: error.message };
        }
    },

    async obtenerSolicitudesInvitados(params = {}) {
        try {
            let query = db.collection('solicitudes_invitados');
            if (params.empleadoId) {
                query = query.where('empleadoId', '==', String(params.empleadoId).trim());
            } else if (params.fecha) {
                query = query.where('fecha', '==', params.fecha);
            }
            const snap = await query.get();
            let docs = [];
            snap.forEach(d => {
                docs.push({ id: d.id, ...d.data() });
            });
            if (params.fecha && params.empleadoId) {
                docs = docs.filter(d => d.fecha === params.fecha);
            } else if (params.fechaDesde) {
                docs = docs.filter(d => (d.fecha || '') >= params.fechaDesde);
            }
            // Ordenar por fecha asc, hora asc
            docs.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (b.hora || '').localeCompare(a.hora || ''));
            return { ok: true, solicitudes: docs };
        } catch (error) {
            console.error("Error en obtenerSolicitudesInvitados:", error);
            return { ok: false, error: error.message, solicitudes: [] };
        }
    },

    async actualizarEstadoSolicitudInvitado(params) {
        try {
            const id = params.id;
            if (!id) return { ok: false, error: "ID de solicitud no provisto" };
            const nuevoEstado = params.estado || 'CONFIRMADO';
            await db.collection('solicitudes_invitados').doc(id).update({
                estado: nuevoEstado,
                actualizadoPor: params.actualizadoPor || 'Supervisor',
                fechaActualizacion: new Date().toISOString()
            });
            return { ok: true, mensaje: "Estado actualizado correctamente" };
        } catch (error) {
            console.error("Error en actualizarEstadoSolicitudInvitado:", error);
            return { ok: false, error: error.message };
        }
    },

    async eliminarSolicitudInvitado(params) {
        try {
            const id = params.id;
            if (!id) return { ok: false, error: "ID no provisto" };

            let fecha = params.fecha || '';
            let invitado = params.invitado || params.nombre || '';
            let empleadoId = params.empleadoId || params.supervisorId || '';

            // 1. Si es ID de Firestore, obtener datos para sincronizar borrado con Sheets y luego eliminar
            if (db && !id.startsWith('sheet_extra_')) {
                try {
                    const docRef = db.collection('solicitudes_invitados').doc(id);
                    const docSnap = await docRef.get();
                    if (docSnap.exists) {
                        const data = docSnap.data() || {};
                        fecha = fecha || data.fecha || '';
                        invitado = invitado || data.invitado || '';
                        empleadoId = empleadoId || data.empleadoId || '';
                    }
                    await docRef.delete();
                } catch (eDoc) {
                    console.warn("Aviso eliminando en Firestore:", eDoc);
                }
            }

            // 2. Eliminar de la hoja ALMUERZOS_EXTRA en Google Sheets
            let sheetsResult = null;
            try {
                sheetsResult = await this._jsonp({
                    accion: 'eliminarAlmuerzoExtra',
                    fecha: fecha,
                    nombre: invitado,
                    invitado: invitado,
                    supervisorId: empleadoId,
                    filaIndex: params.filaIndex || ''
                });
                if (sheetsResult && !sheetsResult.ok) {
                    console.warn("⚠️ Respuesta de Google Sheets al eliminar:", sheetsResult);
                }
            } catch (eSheet) {
                console.warn("Aviso eliminando en Sheets:", eSheet);
                sheetsResult = { ok: false, error: eSheet.message || eSheet.toString() };
            }

            // 3. Limpiar de la caché local de Almuerzos Extras para evitar que reaparezca tras recarga
            try {
                const CACHE_KEY = 'tcontrol_almuerzos_extra_cache_v2';
                const storedAlm = localStorage.getItem(CACHE_KEY);
                if (storedAlm) {
                    const parsed = JSON.parse(storedAlm);
                    if (parsed && Array.isArray(parsed.almuerzos)) {
                        parsed.almuerzos = parsed.almuerzos.filter(ae => {
                            if (params.filaIndex && ae.filaIndex === params.filaIndex) return false;
                            const fStr = String(ae.fecha || '').slice(0, 10);
                            const nStr = String(ae.nombre || '').toLowerCase();
                            const invStr = String(invitado || '').toLowerCase();
                            if (fStr === fecha && (nStr.includes(invStr) || invStr.includes(nStr))) return false;
                            return true;
                        });
                        localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
                    }
                }
            } catch (eCache) { }

            if (sheetsResult && sheetsResult.error) {
                return {
                    ok: true,
                    alertaSheets: true,
                    errorSheets: sheetsResult.error,
                    mensaje: "Eliminado de Firestore, pero en Sheets: " + sheetsResult.error
                };
            }

            return { ok: true, mensaje: "Solicitud eliminada de Firestore y ALMUERZOS_EXTRA", sheetsResult: sheetsResult };
        } catch (error) {
            console.error("Error en eliminarSolicitudInvitado:", error);
            return { ok: false, error: error.message };
        }
    },

    async obtenerDatosSupervisor(params = {}) {
        try {
            const hoy = new Date();
            const hoyStr = this._hoyStr(hoy);

            // 1. Empleados (activos e inactivos)
            const empSnap = await db.collection('empleados').get();
            const empleadosMap = {};
            const empleadosEliminadosMap = {};
            empSnap.forEach(doc => {
                const data = doc.data();
                const valAct = String(data.activo || '').trim().toUpperCase();
                const valEst = String(data.estado || '').trim().toUpperCase();
                const esInactivo = (valAct === 'NO' || valAct === 'FALSE' || data.activo === false || valEst === 'INACTIVO');
                const esActivo = !esInactivo;
                const item = {
                    ...data,
                    id: doc.id,
                    activo: esActivo ? 'SI' : 'NO',
                    estado: esActivo ? 'ACTIVO' : 'INACTIVO',
                    registros: [],
                    entradaHoy: false,
                    salidaHoy: false
                };
                if (esActivo) {
                    empleadosMap[doc.id] = item;
                } else {
                    empleadosEliminadosMap[doc.id] = {
                        ...item,
                        nombre: data.nombre || `Colaborador (${doc.id})`,
                        area: data.area || 'Inactivo',
                        cargo: data.cargo || 'Inactivo',
                        esEliminado: true
                    };
                }
            });

            // 1.2 Empleados Desvinculados en Firestore
            try {
                const desvSnap = await db.collection('empleados_desvinculados').get();
                desvSnap.forEach(doc => {
                    const d = doc.data();
                    const dId = String(doc.id).trim();
                    if (!empleadosMap[dId] && !empleadosEliminadosMap[dId]) {
                        empleadosEliminadosMap[dId] = {
                            ...d,
                            id: dId,
                            nombre: d.nombre || `Colaborador (${dId})`,
                            area: d.area || 'Desvinculado',
                            cargo: d.cargo || 'Desvinculado',
                            esEliminado: true,
                            esDesvinculado: true,
                            fecha_salida: d.fechaDesvinculacion || '',
                            motivo_salida: d.motivoDesvinculacion || 'Desvinculado',
                            desvinculadoPor: d.desvinculadoPor || '',
                            activo: 'NO',
                            estado: 'INACTIVO',
                            registros: [],
                            entradaHoy: false,
                            salidaHoy: false
                        };
                    }
                });
            } catch (errDesv) {
                console.warn("Aviso: No se pudo leer empleados_desvinculados en obtenerDatosSupervisor:", errDesv);
            }

            // 2. Caching de Registros para reducir lecturas (Ahorro crítico de Firebase)
            const limite = new Date();
            limite.setDate(limite.getDate() - 60);
            const limiteStr = this._hoyStr(limite);

            const CACHE_KEY = 'tcontrol_registros_cache_v1';
            let cacheData = { registros: {}, lastSync: null };
            try {
                const stored = localStorage.getItem(CACHE_KEY);
                if (stored) cacheData = JSON.parse(stored);
            } catch (e) { console.warn("Error leyendo caché:", e); }

            let query = db.collection('registros');

            // Si hay caché reciente (de hoy), solo traemos datos desde ayer para atrapar cambios recientes
            // Si el administrador necesita forzar recarga total, puede limpiar caché local o hacer refresh duro
            const ayer = new Date();
            ayer.setDate(ayer.getDate() - 1);
            const ayerStr = this._hoyStr(ayer);

            if (cacheData.lastSync && !params.force) {
                console.log("⚡ Usando caché local. Obteniendo solo registros desde:", ayerStr);
                query = query.where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(new Date(ayerStr + 'T00:00:00')));
            } else {
                console.log("📥 Obteniendo registros desde Firestore (últimos 60 días):", limiteStr);
                query = query.where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(new Date(limiteStr + 'T00:00:00')));
                // Limpiar registros antiguos del caché para no mantener registros eliminados/archivados
                cacheData.registros = {};
            }

            const regSnap = await query.get();

            // Combinar registros obtenidos con el caché
            regSnap.forEach(doc => {
                const docData = this._processDoc(doc.id, doc.data());
                if (docData) {
                    cacheData.registros[doc.id] = docData;
                }
            });

            // Limpiar caché de registros más antiguos que 60 días para liberar memoria
            const allRegistros = Object.values(cacheData.registros).filter(r => r.fecha >= limiteStr);

            // Guardar caché actualizado
            try {
                let cacheToSave = { registros: {}, lastSync: new Date().toISOString() };
                allRegistros.forEach(r => cacheToSave.registros[r.id] = r);
                localStorage.setItem(CACHE_KEY, JSON.stringify(cacheToSave));
            } catch (e) { console.warn("Error guardando caché (posible límite de localStorage):", e); }

            // 2.5 Caching y obtención de Registros Archivados en Sheets (Con soporte IndexedDB para > 5MB)
            const CACHE_ARCHIVADOS_KEY = 'tcontrol_archivados_cache_v2';
            let archivadosData = { registros: [], lastSync: null };

            // 1. Intentar leer de IndexedDB primero (soporta los 12MB completos sin límite de cuota)
            try {
                const idbArch = await this._leerIDB('tcontrol_archivados_cache_idb');
                if (idbArch && Array.isArray(idbArch.registros) && idbArch.registros.length > 0) {
                    archivadosData = idbArch;
                    this._cacheArchivadosMemoria = idbArch.registros;
                    console.log(`⚡ ${idbArch.registros.length} registros archivados cargados desde IndexedDB`);
                }
            } catch (e) { console.warn("Error leyendo IndexedDB archivados:", e); }

            // 2. Si no estaba en IndexedDB, fallback a memoria o localStorage
            if (!archivadosData.registros || archivadosData.registros.length === 0) {
                if (this._cacheArchivadosMemoria && this._cacheArchivadosMemoria.length > 0) {
                    archivadosData.registros = this._cacheArchivadosMemoria;
                } else {
                    try {
                        const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
                        if (storedArch) archivadosData = JSON.parse(storedArch);
                    } catch (e) { console.warn("Error leyendo caché archivados localStorage:", e); }
                }
            }

            const horasArchivados = archivadosData.lastSync ? (new Date() - new Date(archivadosData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchArchivados = async () => {
                try {
                    // Timeout de 75 segundos con reintentos para soportar respuestas pesadas de Sheets (~12MB)
                    const resJson = await this._jsonp({ accion: 'obtenerRegistrosArchivados' }, 0, 2, 75000);
                    if (resJson && resJson.ok && resJson.registros) {
                        this._cacheArchivadosMemoria = resJson.registros;
                        archivadosData.registros = resJson.registros;
                        archivadosData.lastSync = new Date().toISOString();
                        
                        // Guardar en IndexedDB (sin límite de 5MB)
                        try {
                            await this._guardarIDB('tcontrol_archivados_cache_idb', { registros: resJson.registros, lastSync: archivadosData.lastSync });
                            console.log(`✅ Registros archivados de Sheets (${resJson.registros.length}) guardados en IndexedDB.`);
                        } catch (e) {
                            console.warn("Aviso guardando en IndexedDB:", e);
                        }

                        // Guardar un subconjunto reciente en localStorage como respaldo
                        try {
                            const regsRecientes = [...resJson.registros].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 2500);
                            localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify({ registros: regsRecientes, lastSync: archivadosData.lastSync }));
                        } catch (e) { }

                        // Notificar a la interfaz que los datos históricos completos están listos
                        window.dispatchEvent(new CustomEvent('archivadosActualizados', { detail: { registros: resJson.registros } }));
                    }
                } catch (e) {
                    console.warn("Aviso en _fetchArchivados:", e);
                }
            };

            // NUNCA congelar la pantalla del supervisor esperando a Sheets: solo esperar si se fuerza expresamente
            if (params.force || params.forceSheets || params.forceAll) {
                console.log("📥 Forzando actualización de registros archivados de Sheets...");
                await _fetchArchivados();
            } else if (!archivadosData.registros || archivadosData.registros.length === 0 || horasArchivados > 24) {
                console.log("🔄 Sincronizando registros archivados de Sheets en segundo plano...");
                _fetchArchivados(); // En segundo plano, la interfaz abre de inmediato
            }

            // 2.6 Caching y obtención de Almuerzos Extras
            const CACHE_ALMUERZOS_EXTRA_KEY = 'tcontrol_almuerzos_extra_cache_v2';
            let almuerzosExtraData = { almuerzos: [], lastSync: null };
            try {
                const storedAlm = localStorage.getItem(CACHE_ALMUERZOS_EXTRA_KEY);
                if (storedAlm) almuerzosExtraData = JSON.parse(storedAlm);
            } catch (e) { console.warn("Error leyendo caché almuerzos extras:", e); }

            const horasAlmuerzos = almuerzosExtraData.lastSync ? (new Date() - new Date(almuerzosExtraData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchAlmuerzosExtra = async () => {
                try {
                    const resJson = await this._jsonp({ accion: 'obtenerAlmuerzosExtra' }, 0, 1, 6000);
                    if (resJson && resJson.ok && resJson.almuerzos) {
                        almuerzosExtraData.almuerzos = resJson.almuerzos;
                        almuerzosExtraData.lastSync = new Date().toISOString();
                        try {
                            localStorage.setItem(CACHE_ALMUERZOS_EXTRA_KEY, JSON.stringify(almuerzosExtraData));
                            console.log("✅ Almuerzos extras de Sheets actualizados en caché.");
                        } catch (e) { }
                    }
                } catch (e) { /* Fallback transparente a datos de caché */ }
            };

            if (params.force || params.forceSheets || params.forceAll) {
                console.log("📥 Forzando actualización de almuerzos extras de Sheets...");
                await _fetchAlmuerzosExtra();
            } else if (!almuerzosExtraData.almuerzos || almuerzosExtraData.almuerzos.length === 0 || horasAlmuerzos > 1) {
                console.log("🔄 Sincronizando almuerzos extras de Sheets en segundo plano...");
                _fetchAlmuerzosExtra(); // En segundo plano, la interfaz abre de inmediato
            }

            const archivadosNorm = archivadosData.registros.map(reg => {
                const normR = {
                    id: reg.id || `arch_${reg.empleadoId}_${reg.fecha}_${reg.tipo}`,
                    empleadoId: String(reg.empleadoId || reg.id_empleado || '').trim(),
                    fecha: this._normFecha(reg.fecha),
                    tipo: (reg.tipo || '').toUpperCase(),
                    hora: this._limpiarHora(reg.hora),
                    almuerzo: reg.almuerzo || '',
                    modo: reg.modo || 'OFICINA',
                    lat: reg.lat || '',
                    lng: reg.lng || '',
                    dispositivo: reg.dispositivo || '',
                    timestamp: reg.timestamp || '',
                    // Mapear campos de Sheets → campos estándar
                    razon_salida: reg.razon_salida || reg.razonSalidaTemprana || '',
                    quien_justifica: reg.quien_justifica || reg.quienJustifica || '',
                    razon_entrada_tardia: reg.razon_entrada_tardia || reg.razonEntradaTardia || '',
                    quien_justifica_entrada: reg.quien_justifica_entrada || reg.quienJustificaEntrada || '',
                    tipo_salida: reg.tipo_salida || reg.tipoSalida || '',
                    razon_permiso: reg.razon_permiso || reg.razonPermiso || '',
                    horasExtra: reg.horasExtra || '',
                    autoriza: reg.autoriza || '',
                    justificado: reg.justificado || '',
                    razon_justificac: reg.razon_justificac || '',
                    permiso_personal_mins: Number(reg.permiso_personal_mins || 0),
                    permiso_medico_mins: Number(reg.permiso_medico_mins || 0),
                    tiempo_justificado_mins: Number(reg.tiempo_justificado_mins || 0)
                };
                if (normR.timestamp) {
                    this._extraerFechaHoraDesdeTimestamp(normR);
                }
                return normR;
            }).filter(r => r.fecha && r.empleadoId); // descartar filas vacías

            // Registros de Firebase: también normalizar fecha y hora desde timestamp si existe
            const registrosFirebase = allRegistros.map(r => {
                const rf = {
                    ...r,
                    empleadoId: String(r.empleadoId || r.id_empleado || '').trim(),
                    fecha: this._normFecha(r.fecha),
                    hora: this._limpiarHora(r.hora),
                    tiempo_justificado_mins: Number(r.tiempo_justificado_mins || 0),
                    permiso_personal_mins: Number(r.permiso_personal_mins || 0),
                    permiso_medico_mins: Number(r.permiso_medico_mins || 0)
                };
                if (rf.timestamp) {
                    this._extraerFechaHoraDesdeTimestamp(rf);
                }
                return rf;
            });

            // Indexar archivados por empleado|fecha|tipo y empleado|fecha para enriquecer registros de Firebase
            const archMapTipo = new Map();
            const archMapFecha = new Map();
            archivadosNorm.forEach(arch => {
                const kTipo = `${arch.empleadoId}|${arch.fecha}|${arch.tipo}`;
                const kFecha = `${arch.empleadoId}|${arch.fecha}`;
                if (!archMapTipo.has(kTipo)) archMapTipo.set(kTipo, arch);
                if (!archMapFecha.has(kFecha)) archMapFecha.set(kFecha, arch);
            });

            // Enriquecer registros de Firebase con datos de Sheets (permisos, tiempo_justificado_mins, etc.)
            registrosFirebase.forEach(rf => {
                const kTipo = `${rf.empleadoId}|${rf.fecha}|${(rf.tipo || '').toUpperCase()}`;
                const kFecha = `${rf.empleadoId}|${rf.fecha}`;
                const arch = archMapTipo.get(kTipo) || (rf.tipo === 'ENTRADA' ? archMapFecha.get(kFecha) : null);
                if (arch) {
                    if (arch.tiempo_justificado_mins) rf.tiempo_justificado_mins = Number(arch.tiempo_justificado_mins);
                    if (arch.permiso_personal_mins) rf.permiso_personal_mins = Number(arch.permiso_personal_mins);
                    if (arch.permiso_medico_mins) rf.permiso_medico_mins = Number(arch.permiso_medico_mins);
                    if (arch.razon_permiso && !rf.razon_permiso) rf.razon_permiso = arch.razon_permiso;
                    if (arch.razon_salida && !rf.razon_salida) rf.razon_salida = arch.razon_salida;
                    if (arch.razon_entrada_tardia && !rf.razon_entrada_tardia) rf.razon_entrada_tardia = arch.razon_entrada_tardia;
                    if (arch.justificado && !rf.justificado) rf.justificado = arch.justificado;
                    if (arch.razon_justificac && !rf.razon_justificac) rf.razon_justificac = arch.razon_justificac;
                }
            });

            // Fechas cubiertas por Firebase por empleado (para evitar duplicados con archivados de forma individual)
            const empFechasEnFirebase = new Set(registrosFirebase.map(r => `${r.empleadoId}|${r.fecha}`).filter(Boolean));
            // Solo incluir archivados de fechas que NO están en Firebase para ese empleado específico
            const archivadosFiltrados = archivadosNorm.filter(r => r.fecha && !empFechasEnFirebase.has(`${r.empleadoId}|${r.fecha}`));
            const registrosCompletos = registrosFirebase.concat(archivadosFiltrados);

            // 3. Procesar todos los registros combinados
            registrosCompletos.forEach(reg => {
                const eid = String(reg.empleadoId || reg.id_empleado || (reg.id && !String(reg.id).includes('_') ? reg.id : (reg.id ? String(reg.id).split('_')[0] : ''))).trim();
                if (!eid) return;

                // Normalizar almuerzo: solo SI/NO si tiene valor, vacío si no
                const vAlm = (reg.almuerzo || '').toString().trim().toUpperCase();
                reg.almuerzo = (vAlm === 'SI' || vAlm === 'SÍ' || vAlm === 'PLANTA') ? 'SI' : ((vAlm === 'NO' || vAlm === 'FUERA') ? 'NO' : '');

                if (empleadosMap[eid]) {
                    empleadosMap[eid].registros.push(reg);

                    if (reg.fecha === hoyStr) {
                        if (reg.tipo === 'ENTRADA') {
                            empleadosMap[eid].entradaHoy = true;
                            empleadosMap[eid].horaEntrada = reg.hora;
                            if (!empleadosMap[eid].almuerzoHoy) empleadosMap[eid].almuerzoHoy = reg.almuerzo;

                            if (reg.hora) {
                                const [h, m, s] = reg.hora.split(':');
                                const d = new Date();
                                d.setHours(parseInt(h), parseInt(m), parseInt(s || 0));
                                empleadosMap[eid].horaEntradaMs = d.getTime();
                            }
                        }
                        if (reg.tipo === 'SOLO_ALMUERZO') {
                            if (!empleadosMap[eid].almuerzoHoy) empleadosMap[eid].almuerzoHoy = reg.almuerzo;
                        }
                        if (reg.tipo === 'SALIDA') {
                            empleadosMap[eid].salidaHoy = true;
                            empleadosMap[eid].horaSalida = reg.hora;

                            if (reg.hora) {
                                const [h, m, s] = reg.hora.split(':');
                                const d = new Date();
                                d.setHours(parseInt(h), parseInt(m), parseInt(s || 0));
                                empleadosMap[eid].horaSalidaMs = d.getTime();
                            }
                        }
                    }
                } else {
                    if (!empleadosEliminadosMap[eid]) {
                        const nombreElim = reg.nombre || reg.empleadoNombre || `Colaborador (${eid})`;
                        empleadosEliminadosMap[eid] = {
                            id: String(eid),
                            nombre: nombreElim,
                            area: 'Eliminado',
                            cargo: 'Eliminado',
                            esEliminado: true,
                            activo: false,
                            registros: [],
                            entradaHoy: false,
                            salidaHoy: false
                        };
                    }
                    empleadosEliminadosMap[eid].registros.push(reg);
                }
            });

            // Eliminar duplicados por (empleadoId + fecha + tipo + hora)
            Object.keys(empleadosMap).forEach(eid => {
                const emp = empleadosMap[eid];
                const seen = new Set();
                emp.registros = emp.registros.filter(r => {
                    const key = `${r.fecha}|${r.tipo}|${(r.hora || '').slice(0, 5)}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                // Automatización silenciosa: si ya registró su salida antes de las 09:30, quite el almuerzo
                if (emp.salidaHoy && emp.horaSalida) {
                    const parts = emp.horaSalida.split(':');
                    const mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    if (mins < 570) {
                        emp.almuerzoHoy = "NO";
                    }
                }
            });

            // Deduplicar registros de eliminados
            Object.keys(empleadosEliminadosMap).forEach(eid => {
                const emp = empleadosEliminadosMap[eid];
                const seen = new Set();
                emp.registros = emp.registros.filter(r => {
                    const key = `${r.fecha}|${r.tipo}|${(r.hora || '').slice(0, 5)}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            });

            // Cargar y fusionar vacaciones desde caché local (inmediato) y sincronizar con Sheets en segundo plano
            const CACHE_VAC_KEY = 'tcontrol_vacaciones_cache_v3';
            if (!window._vacacionesCache || window._vacacionesCache.length === 0) {
                try {
                    const storedVac = localStorage.getItem(CACHE_VAC_KEY) || localStorage.getItem('tcontrol_vacaciones_cache_v2');
                    if (storedVac) {
                        const parsedVac = JSON.parse(storedVac);
                        if (parsedVac.vacaciones) window._vacacionesCache = parsedVac.vacaciones;
                        if (parsedVac.kpiVacaciones) {
                            window.kpiVacaciones = parsedVac.kpiVacaciones;
                            window._kpiVacacionesCache = parsedVac.kpiVacaciones;
                        }
                        if (parsedVac.kpiVacacionesIndividual) window.kpiVacacionesIndividual = parsedVac.kpiVacacionesIndividual;
                    }
                } catch (e) { }
            }

            const _fetchVacacionesSheets = async () => {
                try {
                    const vacRes = await this.procesarAccion({ accion: 'obtenerVacacionesEmpleado' });
                    if (vacRes && vacRes.ok) {
                        if (typeof renderizarCardKpiVacaciones === 'function') {
                            try { renderizarCardKpiVacaciones(); } catch (e) { }
                        }
                    }
                } catch (e) {
                    window._lastSheetsVacError = Date.now();
                }
            };

            const ahoraTs = Date.now();
            if (params.force || params.forceSheets || params.forceAll) {
                await _fetchVacacionesSheets();
            } else if (ahoraTs - (window._lastSheetsVacOk || 0) > 600000 && ahoraTs - (window._lastSheetsVacError || 0) > 300000) {
                _fetchVacacionesSheets(); // En segundo plano, ¡nunca bloquea el arranque ni dispara el watchdog del loader!
            }

            let vacacionesList = window._vacacionesCache || [];

            if (vacacionesList.length > 0) {
                Object.keys(empleadosMap).forEach(eid => {
                    const emp = empleadosMap[eid];
                    const cedulaEmp = emp.cedula ? String(emp.cedula).trim() : '';
                    const vacsEmp = vacacionesList.filter(v => {
                        const vId = String(v.empleadoId || '').trim();
                        return vId === eid || (cedulaEmp && vId === cedulaEmp);
                    });
                    vacsEmp.forEach(v => {
                        const yaExiste = emp.registros.some(r => {
                            const rFecha = r.fecha;
                            const rTipo = String(r.tipo || '').toUpperCase();
                            return rFecha === v.fecha && (rTipo === 'VACACIONES' || rTipo === 'VACACION');
                        });
                        if (!yaExiste) {
                            emp.registros.push({
                                id: eid,
                                fecha: v.fecha,
                                tipo: 'VACACIONES',
                                razon_ausencia: 'Vacación',
                                justificado: 'SI'
                            });
                        }
                    });
                });
            }

            // Leer alerta de emergencia
            let emergencia = { activa: false, nombre: '', habilitadoPor: '', fecha: '' };
            try {
                const emSnap = await db.collection('configuracion').doc('emergencia').get();
                if (emSnap.exists) {
                    emergencia = emSnap.data();
                }
            } catch (e) {
                console.error("Error al leer emergencia en obtenerDatosSupervisor:", e);
            }

            // Leer solicitudes de invitados desde Firestore (para vista en tiempo real)
            let solicitudesInvitadosList = [];
            try {
                const solSnap = await db.collection('solicitudes_invitados').limit(300).get();
                solSnap.forEach(doc => {
                    solicitudesInvitadosList.push({ id: doc.id, ...doc.data() });
                });
                solicitudesInvitadosList.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.hora || '').localeCompare(a.hora || ''));
            } catch (errSol) {
                console.warn("Aviso: No se pudo leer solicitudes_invitados en obtenerDatosSupervisor:", errSol);
            }

            return {
                empleados: Object.values(empleadosMap),
                empleadosEliminados: Object.values(empleadosEliminadosMap),
                almuerzosExtra: almuerzosExtraData.almuerzos || [],
                solicitudesInvitados: solicitudesInvitadosList,
                emergencia: emergencia,
                kpiVacaciones: window._kpiVacacionesCache || null,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("🔥 Error en obtenerDatosSupervisor:", error);
            return { error: error.message };
        }
    },

    async verificarCambios(params) {
        return await this.obtenerDatosSupervisor();
    },



    // ==========================================
    // AUXILIARES
    // ==========================================
    async _post(params, _retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = [1000, 2000, 4000];

        try {
            const api_url = (window.TCONTROL_CONFIG && window.TCONTROL_CONFIG.API_URL) || window.API_URL || 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
            let payload = { ...params };
            payload.apiKey = 'TCONTROL_SECURE_2026_XYZ';
            if (payload.empleados && typeof payload.empleados === 'string') {
                try {
                    payload.empleados = JSON.parse(payload.empleados);
                } catch (e) { }
            }
            const res = await fetch(api_url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            let rawText = await res.text();
            rawText = (rawText || '').trim();
            // Desencapsular de formato JSONP si Apps Script lo envolvió en callback(...) o cb_...(...)
            const cbMatch = rawText.match(/^[a-zA-Z0-9_$]+\(([\s\S]*)\);?$/);
            if (cbMatch) {
                rawText = cbMatch[1].trim();
            }
            let data = {};
            try {
                data = JSON.parse(rawText);
            } catch (jsonErr) {
                console.warn("[Sheets POST] Respuesta no es JSON válido:", rawText);
                data = { status: 'ok', raw: rawText };
            }

            const isLockError = data && data.error && (
                data.error.toString().toLowerCase().includes('lock') ||
                data.error.toString().toLowerCase().includes('candado') ||
                data.error.toString().toLowerCase().includes('tiempo de espera') ||
                data.error.toString().toLowerCase().includes('service invoked too many times')
            );

            if (isLockError && _retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS[_retryCount] || 4000;
                console.warn(`⏳ Sheets POST is busy. Retrying in ${delay}ms...`);
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(this._post(params, _retryCount + 1));
                    }, delay);
                });
            }

            return data;
        } catch (error) {
            console.error("❌ Error en _post a Sheets:", error);
            if (_retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS[_retryCount] || 4000;
                console.warn(`🔌 Sheets POST network error. Retrying in ${delay}ms...`);
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(this._post(params, _retryCount + 1));
                    }, delay);
                });
            }
            return { error: "Error de red al conectar con Sheets: " + error.message };
        }
    },

    _jsonp(params, _retryCount = 0, maxRetries = 2, timeoutMs = 15000) {
        const MAX_RETRIES = maxRetries;
        const RETRY_DELAY_MS = [1000, 2000];

        return new Promise((resolve, reject) => {
            const callbackName = 'cb_' + Math.floor(Math.random() * 1000000);
            const api_url = (window.TCONTROL_CONFIG && window.TCONTROL_CONFIG.API_URL) || window.API_URL || 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';

            let settled = false;
            const script = document.createElement('script');

            // Replace callback with a no-op instead of deleting it.
            // Removing a <script> from the DOM does NOT cancel the in-flight
            // HTTP request — the browser will still execute the response.
            // A no-op absorbs the late call and avoids ReferenceError.
            const cleanup = () => {
                window[callbackName] = function () { };
                setTimeout(() => { delete window[callbackName]; }, 60000);
                if (script.parentNode) script.parentNode.removeChild(script);
            };

            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                if (_retryCount < MAX_RETRIES - 1) {
                    const delay = RETRY_DELAY_MS[_retryCount] || 2000;
                    if (maxRetries > 1) console.warn(`⏳ Sheets connection timeout. Retrying in ${delay}ms...`);
                    setTimeout(() => {
                        this._jsonp(params, _retryCount + 1, maxRetries, timeoutMs).then(resolve).catch(reject);
                    }, delay);
                } else {
                    reject(new Error("Timeout en la conexión con Sheets"));
                }
            }, timeoutMs);

            window[callbackName] = (data) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                cleanup();

                // If it is a lock error or service busy, retry too!
                const isLockError = data && data.error && (
                    data.error.toString().toLowerCase().includes('lock') ||
                    data.error.toString().toLowerCase().includes('candado') ||
                    data.error.toString().toLowerCase().includes('tiempo de espera') ||
                    data.error.toString().toLowerCase().includes('service invoked too many times')
                );

                if (isLockError && _retryCount < MAX_RETRIES - 1) {
                    const delay = RETRY_DELAY_MS[_retryCount] || 2000;
                    if (maxRetries > 1) console.warn(`⏳ Sheets is busy. Retrying in ${delay}ms (attempt ${_retryCount + 1}/${MAX_RETRIES})...`);
                    setTimeout(() => {
                        this._jsonp(params, _retryCount + 1, maxRetries, timeoutMs).then(resolve).catch(reject);
                    }, delay);
                    return;
                }

                resolve(data);
            };

            const url = new URL(api_url);
            url.searchParams.set('callback', callbackName);
            url.searchParams.append('apiKey', 'TCONTROL_SECURE_2026_XYZ');
            for (let key in params) {
                url.searchParams.set(key, params[key]);
            }

            script.src = url.toString();
            script.onerror = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                cleanup();
                if (_retryCount < MAX_RETRIES - 1) {
                    const delay = RETRY_DELAY_MS[_retryCount] || 2000;
                    if (maxRetries > 1) console.warn(`🔌 Sheets network error. Retrying in ${delay}ms...`);
                    setTimeout(() => {
                        this._jsonp(params, _retryCount + 1, maxRetries, timeoutMs).then(resolve).catch(reject);
                    }, delay);
                } else {
                    reject(new Error("Error de red al conectar con Sheets"));
                }
            };
            script.onload = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
            };
            document.body.appendChild(script);
        });
    },

    // ==========================================
    // INDEXEDDB HELPER (Para datasets pesados > 5MB sin límite de localStorage)
    // ==========================================
    _abrirIDB() {
        return new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') return resolve(null);
            try {
                const req = indexedDB.open('TControlLocalDB', 1);
                req.onupgradeneeded = (e) => {
                    const idb = e.target.result;
                    if (!idb.objectStoreNames.contains('heavy_cache')) {
                        idb.createObjectStore('heavy_cache');
                    }
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    },

    async _guardarIDB(clave, valor) {
        try {
            const db = await this._abrirIDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction('heavy_cache', 'readwrite');
                tx.objectStore('heavy_cache').put(valor, clave);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    },

    async _leerIDB(clave) {
        try {
            const db = await this._abrirIDB();
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction('heavy_cache', 'readonly');
                const req = tx.objectStore('heavy_cache').get(clave);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    },

    _hoyStr(dateObj = new Date()) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    _obtenerDiaSemana(fecha) {
        const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        return dias[fecha.getDay()];
    },

    _normalizarUrlFoto(url, size = 200) {
        if (!url || typeof url !== 'string') return "";
        url = url.trim();
        if (!url) return "";
        if (url.startsWith('data:image') || url.startsWith('blob:')) return url;

        // Si ya es googleusercontent, asegurar parámetro de tamaño
        if (url.includes('googleusercontent.com/d/')) {
            if (!url.includes('=')) {
                return `${url}=w${size}`;
            }
            return url;
        }

        // Si es un link de Google Drive (formato /file/d/ID/view o ?id=ID o /d/ID)
        if (url.includes('drive.google.com') || url.includes('docs.google.com') || url.includes('googleusercontent.com')) {
            let id = "";
            if (url.includes('/file/d/')) {
                const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                if (m) id = m[1];
            } else if (url.includes('id=')) {
                const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                if (m) id = m[1];
            } else if (url.includes('/d/')) {
                const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
                if (m) id = m[1];
            }
            if (id) {
                return `https://lh3.googleusercontent.com/d/${id}=w${size}`;
            }
        }
        return url;
    },

    _extraerFechaHoraDesdeTimestamp(item) {
        if (!item || !item.timestamp) return item;
        const ts = item.timestamp;
        let d = null;
        let fechaStr = null;
        let horaStr = null;

        if (typeof ts === 'object' && typeof ts.toDate === 'function') {
            d = ts.toDate();
        } else if (typeof ts === 'object' && ts.seconds !== undefined) {
            d = new Date(ts.seconds * 1000);
        } else if (ts instanceof Date) {
            d = ts;
        } else if (typeof ts === 'string') {
            const s = ts.trim();
            // Si tiene 'Z', 'GMT' o formato ISO con T, evaluar con new Date para aplicar la zona horaria local
            if (/^\d{4}-\d{2}-\d{2}T/.test(s) || s.includes('Z') || s.includes('GMT')) {
                const parsed = new Date(s);
                if (!isNaN(parsed.getTime())) {
                    d = parsed;
                }
            } else {
                const mDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[,\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
                const mYMD = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[,\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
                if (mDMY) {
                    const day = String(mDMY[1]).padStart(2, '0');
                    const month = String(mDMY[2]).padStart(2, '0');
                    const year = mDMY[3];
                    const hour = String(mDMY[4]).padStart(2, '0');
                    const min = String(mDMY[5]).padStart(2, '0');
                    const sec = String(mDMY[6] || '00').padStart(2, '0');
                    fechaStr = `${year}-${month}-${day}`;
                    horaStr = `${hour}:${min}:${sec}`;
                } else if (mYMD) {
                    const year = mYMD[1];
                    const month = String(mYMD[2]).padStart(2, '0');
                    const day = String(mYMD[3]).padStart(2, '0');
                    const hour = String(mYMD[4]).padStart(2, '0');
                    const min = String(mYMD[5]).padStart(2, '0');
                    const sec = String(mYMD[6] || '00').padStart(2, '0');
                    fechaStr = `${year}-${month}-${day}`;
                    horaStr = `${hour}:${min}:${sec}`;
                } else {
                    const parsed = new Date(s);
                    if (!isNaN(parsed.getTime())) {
                        d = parsed;
                    }
                }
            }
        }

        if (d && !isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            fechaStr = `${y}-${m}-${day}`;
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            horaStr = `${hh}:${mm}:${ss}`;
            item.dia = this._obtenerDiaSemana(d);
        }

        // NUNCA sobreescribir fecha u hora si el registro ya las tiene limpias y válidas
        if (!item.fecha && fechaStr) item.fecha = fechaStr;
        if (!item.hora && horaStr) item.hora = horaStr;
        return item;
    },

    _processDoc(id, data) {
        if (!data) return null;
        const res = { id, ...data };
        if (data.timestamp) {
            this._extraerFechaHoraDesdeTimestamp(res);
        }

        // Si el tipo es de ausencia, calcular dinámicamente hora y razon_ausencia si no están
        const esMarcacionOrdinaria = (tipo) => {
            const t = String(tipo || '').toUpperCase().trim();
            if (t === 'TRABAJO_DE_CAMPO' || t === 'SALIDA_A_CAMPO') return false;
            return ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO', 'ENTRADA_CAMPO', 'SALIDA_CAMPO', 'RETORNO_CAMPO'].includes(t);
        };
        const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

        if (esAusenciaTipo(res.tipo)) {
            if (!res.hora || res.hora === '') res.hora = '00:00:00';
            if (!res.razon_ausencia) {
                const t = String(res.tipo).toUpperCase();
                if (t === 'VACACIONES' || t === 'VACACION') res.razon_ausencia = 'Vacación';
                else if (t === 'PERMISO_MEDICO') res.razon_ausencia = 'Permiso Médico';
                else if (t === 'PERMISO_PERSONAL') res.razon_ausencia = 'Permiso Personal';
                else if (t === 'CALAMIDAD_DOMESTICA') res.razon_ausencia = 'Calamidad Doméstica';
                else if (t === 'TRABAJO_DE_CAMPO' || t === 'SALIDA_A_CAMPO') res.razon_ausencia = 'Salida a Campo';
                else if (t === 'FALTA_JUSTIFICADA') res.razon_ausencia = 'Falta Justificada';
                else if (t === 'SALIDA_JUSTIFICADA') res.razon_ausencia = 'Salida Justificada';
                else res.razon_ausencia = res.tipo;
            }
            if (!res.justificado) res.justificado = 'SI';
        }

        return res;
    },

    _limpiarHora(hora) {
        if (!hora) return "";
        if (hora instanceof Date && !isNaN(hora.getTime())) {
            const hh = String(hora.getHours()).padStart(2, '0');
            const mm = String(hora.getMinutes()).padStart(2, '0');
            const ss = String(hora.getSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        let hStr = hora.toString().trim();
        // Si viene como ISO (ej: 1899-12-30T12:44:00.000Z o con Z)
        if (/^\d{4}-\d{2}-\d{2}T/.test(hStr) || hStr.includes('Z')) {
            const d = new Date(hStr);
            if (!isNaN(d.getTime())) {
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            }
        }
        // Si viene con fecha larga (ej: Sat Dec 30 1899 07:30:00 GMT...)
        const mTime = hStr.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
        if (mTime) {
            const parts = mTime[1].split(':');
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${(parts[2] || '00').padStart(2, '0')}`;
        }
        if (/^\d{1,2}:\d{2}$/.test(hStr)) {
            const p = hStr.split(':');
            return `${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}:00`;
        }
        return hStr;
    },

    _normFecha(val) {
        if (!val) return '';
        if (val instanceof Date && !isNaN(val.getTime())) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        // YYYY/MM/DD
        const mYMD = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (mYMD) return `${mYMD[1]}-${mYMD[2].padStart(2, '0')}-${mYMD[3].padStart(2, '0')}`;
        // DD/MM/YYYY o DD-MM-YYYY
        const mDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (mDMY) return `${mDMY[3]}-${mDMY[2].padStart(2, '0')}-${mDMY[1].padStart(2, '0')}`;
        // Cualquier otro formato parseable como Date
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return s;
    },

    async registrarLog(params) {
        try {
            const data = params.datos ? (typeof params.datos === 'string' ? JSON.parse(params.datos) : params.datos) : params;
            await db.collection('logs').add({
                ...data,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { ok: true };
        } catch (e) {
            console.error("Error in registrarLog:", e);
            return { error: e.message };
        }
    },

    async registrarLogWhatsApp(params) {
        let guardadoFirestore = false;
        try {
            if (typeof db !== 'undefined' && db) {
                if (params.logs && Array.isArray(params.logs)) {
                    const batch = db.batch();
                    params.logs.slice(0, 200).forEach(l => {
                        const ref = db.collection('logs_whatsapp').doc();
                        const docData = {};
                        for (const [k, v] of Object.entries(l || {})) {
                            if (k !== 'accion' && v !== undefined && typeof v !== 'function') {
                                docData[k] = v;
                            }
                        }
                        batch.set(ref, {
                            ...docData,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    });
                    await batch.commit();
                    guardadoFirestore = true;
                } else {
                    const docData = {};
                    for (const [k, v] of Object.entries(params || {})) {
                        if (k !== 'accion' && v !== undefined && typeof v !== 'function') {
                            docData[k] = v;
                        }
                    }
                    await db.collection('logs_whatsapp').add({
                        ...docData,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    guardadoFirestore = true;
                }
            }
        } catch (fe) {
            console.warn("Aviso guardando logs_whatsapp en Firestore:", fe);
        }

        // Respaldo asíncrono en segundo plano a Google Sheets vía POST (sin bloquear ni arrojar error de timeout)
        try {
            this._post({
                accion: 'registrarLogWhatsApp',
                ...params
            }).catch(() => { });
        } catch (e) { }

        return { ok: true, guardado: guardadoFirestore };
    },

    async obtenerLogsWhatsApp(params) {
        const limite = params && params.limite ? parseInt(params.limite, 10) : 100;

        // 1. Intentar consultar desde Firestore (rápido y en tiempo real)
        if (typeof db !== 'undefined' && db) {
            try {
                let snap;
                try {
                    snap = await db.collection('logs_whatsapp')
                        .orderBy('createdAt', 'desc')
                        .limit(limite)
                        .get();
                } catch (orderErr) {
                    // Si no hay índice de createdAt aún, consultar con límite simple y ordenar en memoria
                    snap = await db.collection('logs_whatsapp')
                        .limit(limite * 2)
                        .get();
                }

                if (snap && !snap.empty) {
                    const logs = snap.docs.map(doc => {
                        const d = doc.data();
                        let f = d.fecha || '';
                        let h = d.hora || '';
                        if ((!f || !h) && d.createdAt && d.createdAt.toDate) {
                            const dateObj = d.createdAt.toDate();
                            if (!f) f = this._hoyStr(dateObj);
                            if (!h) h = dateObj.toTimeString().slice(0, 8);
                        }
                        return {
                            id: doc.id,
                            ...d,
                            fecha: f,
                            hora: h,
                            nombreEmpleado: d.nombreEmpleado || d.destinatario || d.nombre || '',
                            idEmpleado: d.idEmpleado || d.empleadoId || d.id || '',
                            tipoNotificacion: d.tipoNotificacion || d.tipo || 'General',
                            detalleRespuesta: d.detalleRespuesta || d.detalle || d.error || ''
                        };
                    });

                    // Ordenar por fecha y hora descendente
                    logs.sort((a, b) => {
                        const tA = (a.timestamp || `${a.fecha}T${a.hora}`) || '';
                        const tB = (b.timestamp || `${b.fecha}T${b.hora}`) || '';
                        return tB.localeCompare(tA);
                    });

                    return { ok: true, logs: logs.slice(0, limite) };
                }
            } catch (fe) {
                console.warn("Aviso leyendo logs_whatsapp en Firestore:", fe);
            }
        }

        // 2. Fallback a Google Sheets si Firestore no tiene registros o no está disponible
        try {
            const sheetsRes = await this._jsonp({
                accion: 'obtenerLogsWhatsApp',
                ...params
            }, 0, 1, 6000);
            return sheetsRes || { ok: true, logs: [] };
        } catch (e) {
            return { ok: true, logs: [], error: e.toString() };
        }
    },

    async guardarPermisoSupervisor(params) {
        try {
            const empleadoId = params.empleadoId?.toString();
            const fecha = params.fecha; // YYYY-MM-DD
            const tipo = params.tipo; // "personal" o "medico" o "justificado"
            const minutos = parseInt(params.mins !== undefined ? params.mins : params.minutos) || 0;
            const supervisorId = params.supervisorId || 'Supervisor';

            if (!empleadoId || !fecha) return { error: "Parámetros incompletos" };

            const updateField = tipo === 'personal'
                ? 'permiso_personal_mins'
                : (tipo === 'medico' ? 'permiso_medico_mins' : 'tiempo_justificado_mins');

            // 1. PRIMERO: Buscar y actualizar en la hoja REGISTROS de Google Sheets
            const sheetsParams = { ...params, accion: 'guardarPermisoSupervisor' };
            try {
                const resSheets = await this._jsonp(sheetsParams, 0, 1, 35000);
                if (resSheets && resSheets.ok) {
                    console.log("✅ Permiso actualizado en Google Sheets (Hoja REGISTROS):", resSheets.msg || 'OK');
                } else if (resSheets && resSheets.error) {
                    console.warn("⚠️ Sheets reportó al guardar permiso:", resSheets.error);
                }
            } catch (errSheets) {
                console.warn("⚠️ Advertencia al actualizar permiso en Google Sheets:", errSheets.message);
            }

            // 2. EN FIRESTORE: Solo buscar y actualizar SI YA EXISTE. NUNCA crear nuevo documento.
            const regSnap = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .get();

            let entryDocId = null;
            let fallbackDocId = null;
            regSnap.forEach(doc => {
                const docData = this._processDoc(doc.id, doc.data());
                if (docData && docData.fecha === fecha) {
                    if (docData.tipo === 'ENTRADA') {
                        entryDocId = doc.id;
                    } else if (!fallbackDocId) {
                        fallbackDocId = doc.id;
                    }
                }
            });
            const targetDocId = entryDocId || fallbackDocId;

            const updateObj = { [updateField]: minutos };
            if (params.comentario !== undefined) {
                updateObj.razon_permiso = String(params.comentario || '').trim();
            }

            if (targetDocId) {
                await db.collection('registros').doc(targetDocId).update(updateObj);
            } else {
                // Si no existía registro previo en Firestore, NO CREAR NUEVO DOCUMENTO para evitar duplicados con Google Sheets
                console.log(`ℹ️ [guardarPermisoSupervisor] No hay doc previo en Firestore para ${empleadoId} en ${fecha}. Actualizado en Sheets sin crear duplicado en Firestore.`);
            }

            // 3. Invalidar y refrescar cachés locales
            try {
                localStorage.removeItem('tcontrol_registros_cache_v1');
                localStorage.removeItem('tcontrol_registros_cache_v2');
                localStorage.removeItem(`tcontrol_archivados_cache_${empleadoId}_v1`);
                localStorage.removeItem(`tcontrol_archivados_cache_${empleadoId}_v2`);
                localStorage.removeItem('tcontrol_archivados_cache_v2');

                const CACHE_ARCHIVADOS_KEY = `tcontrol_archivados_cache_${empleadoId}_v2`;
                const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
                if (storedArch) {
                    const archData = JSON.parse(storedArch);
                    if (archData && Array.isArray(archData.registros)) {
                        const targetArch = archData.registros.find(r => r.fecha === fecha);
                        if (targetArch) {
                            targetArch[updateField] = minutos;
                            if (params.comentario !== undefined) targetArch.razon_permiso = String(params.comentario || '').trim();
                            localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archData));
                        }
                    }
                }
            } catch (e) { }

            return { ok: true };
        } catch (e) {
            console.error("Error in guardarPermisoSupervisor:", e);
            return { error: e.message };
        }
    }
};

function parsearTimestamp(tsString) {
    if (!tsString) return null;
    tsString = String(tsString).trim();
    const regexDMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
    const regexYMD = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;

    let year, month, day, hour, minute, second;
    let match = tsString.match(regexDMY);
    if (match) {
        day = match[1].padStart(2, '0');
        month = match[2].padStart(2, '0');
        year = match[3];
        hour = match[4].padStart(2, '0');
        minute = match[5].padStart(2, '0');
        second = (match[6] || '00').padStart(2, '0');
    } else {
        match = tsString.match(regexYMD);
        if (match) {
            year = match[1];
            month = match[2].padStart(2, '0');
            day = match[3].padStart(2, '0');
            hour = match[4].padStart(2, '0');
            minute = match[5].padStart(2, '0');
            second = (match[6] || '00').padStart(2, '0');
        } else {
            const d = new Date(tsString);
            if (isNaN(d.getTime())) return null;
            year = d.getFullYear();
            month = String(d.getMonth() + 1).padStart(2, '0');
            day = String(d.getDate()).padStart(2, '0');
            hour = String(d.getHours()).padStart(2, '0');
            minute = String(d.getMinutes()).padStart(2, '0');
            second = String(d.getSeconds()).padStart(2, '0');
        }
    }
    return {
        fecha: `${year}-${month}-${day}`,
        hora: `${hour}:${minute}:${second}`,
        timestampFormatted: `${day}/${month}/${year} ${hour}:${minute}:${second}`
    };
}

console.log("🚀 Motor de Firebase inicializado y listo para usar.");

window.resetearPinesTodosLosEmpleados = async function (desvincularDispositivos = false) {
    if (!confirm("⚠️ ADVERTENCIA:\n\n¿Estás seguro de que deseas BORRAR los PINs/Contraseñas de TODOS los empleados?\n\nAl hacerlo, ningún empleado tendrá contraseña guardada y cada usuario deberá ingresar a la app para registrar y confirmar su nueva contraseña personal.")) {
        return;
    }
    const confirmacion = prompt("Para confirmar la eliminación masiva de contraseñas, escribe exactamente la palabra: BORRAR");
    if (confirmacion !== 'BORRAR') {
        alert("Operación cancelada. El texto ingresado no coincide.");
        return;
    }

    console.log("Iniciando reseteo masivo de PINs...");
    try {
        let res = null;
        if (window.FirebaseBackend && window.USE_FIREBASE) {
            res = await window.FirebaseBackend.resetearPinesTodosLosEmpleados({ desvincularDispositivos });
        } else if (typeof jsonpRequest === 'function') {
            res = await jsonpRequest({ accion: 'resetearPinesEmpleados', desvincularDispositivos });
        } else if (window.FirebaseBackend) {
            res = await window.FirebaseBackend.resetearPinesTodosLosEmpleados({ desvincularDispositivos });
        }

        if (res && res.ok) {
            alert("✅ " + (res.mensaje || "PINs restablecidos correctamente."));
        } else {
            alert("❌ Error: " + (res?.error || "No se pudo completar la operación."));
        }
        return res;
    } catch (e) {
        alert("❌ Error: " + e.message);
    }
};
