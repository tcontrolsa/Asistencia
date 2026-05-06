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

// Variable global para usar desde INDEX_PRUEBAS.html
window.FirebaseBackend = {

    // ==========================================
    // ENRUTADOR PRINCIPAL (Imita procesarAccion)
    // ==========================================
    async procesarAccion(params) {
        console.log("🔥 Firebase ejecutando acción:", params.accion);
        try {
            switch (params.accion) {
                case 'verificarDispositivo':
                    return await this.verificarDispositivo(params);
                case 'registrarDispositivo':
                    return await this.registrarDispositivoConPIN(params);
                case 'verificarPIN':
                    return await this.verificarPIN(params);
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
                    return await this.actualizarRegistroGeneral(params);
                case 'actualizarEmpleado':
                    return await this.actualizarEmpleado(params);
                case 'eliminarRegistro':
                    return await this.eliminarRegistro(params);
                case 'depurarDuplicados':
                    return await this.depurarDuplicados(params);
                case 'regularizacionMasiva':
                    return await this.regularizacionMasiva(params);
                case 'desvincularDispositivo':
                    return await this.desvincularDispositivo(params);
                default:
                    return { error: "Acción no soportada en Firebase: " + params.accion };
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
        const empDoc = await db.collection('empleados').doc(empleadoId).get();

        if (!empDoc.exists || empDoc.data().activo !== 'SI') {
            return { registrado: false };
        }

        const empData = empDoc.data();

        // Actualizar último uso sin esperar (no bloquea)
        dispRef.update({ ultimo_uso: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => { });

        return {
            registrado: true,
            empleado: {
                id: empleadoId,
                nombre: empData.nombre,
                area: empData.area,
                foto_url: empData.foto_url,
                cargo: empData.cargo,
                fechaNacimiento: empData.fechaNacimiento,
                baseLat: empData.baseLat,
                baseLng: empData.baseLng
            }
        };
    },
    async verificarPIN(params) {
        const pin = params.pin;
        const token = params.deviceToken;
        const idRequerido = params.empleadoId; // Opcional (usado en supervisor.html)
        if (!pin || !token) return { error: "PIN o Token ausente" };

        let empDoc = null;
        let empData = null;

        if (idRequerido) {
            // Búsqueda específica por ID y validación de PIN
            const doc = await db.collection('empleados').doc(idRequerido.toString()).get();
            if (doc.exists) {
                const data = doc.data();
                if (data.pin?.toString() === pin.toString() || pin === "TCONTROL2026") {
                    empDoc = doc;
                    empData = data;
                }
            }
        } else {
            // Caso especial: Clave Maestra Terminal
            if (pin === "TCONTROL2026") {
                const doc = await db.collection('empleados').doc("1058").get();
                if (doc.exists) {
                    empDoc = doc;
                    empData = doc.data();
                }
            }
            
            if (!empDoc) {
                // Búsqueda general por PIN (App Empleado)
                let empQuery = await db.collection('empleados').where('pin', '==', pin.toString()).get();
                if (empQuery.empty) {
                    const pinNum = parseInt(pin);
                    if (!isNaN(pinNum)) {
                        empQuery = await db.collection('empleados').where('pin', '==', pinNum).get();
                    }
                }
                if (!empQuery.empty) {
                    empDoc = empQuery.docs[0];
                    empData = empDoc.data();
                }
            }
        }

        if (!empDoc) {
            return { error: "PIN o Contraseña incorrecta", valido: false };
        }

        if (empData.activo !== 'SI') {
            return { error: "Empleado inactivo", valido: false };
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

        return {
            ok: true,
            valido: true,
            empleado: {
                id: empDoc.id,
                nombre: empData.nombre,
                area: empData.area,
                foto_url: empData.foto_url,
                cargo: empData.cargo,
                fechaNacimiento: empData.fechaNacimiento,
                baseLat: empData.baseLat,
                baseLng: empData.baseLng,
                esSupervisor: empData.supervisor === 'SI'
            }
        };
    },

    async registrarDispositivoConPIN(params) {
        const empleadoId = params.empleadoId?.toString();
        const pin = params.pin?.toString();
        const token = params.deviceToken;

        const empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists) return { error: "Empleado no encontrado" };

        await db.collection('empleados').doc(empleadoId).update({
            pin: pin,
            deviceToken: token
        });

        await db.collection('dispositivos').doc(token).set({
            id_dispositivo: token,
            id_empleado: empleadoId,
            fecha_registro: firebase.firestore.FieldValue.serverTimestamp(),
            ultimo_uso: firebase.firestore.FieldValue.serverTimestamp(),
            activo: true
        });

        return { ok: true };
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
            const data = doc.data();

            // Detección robusta de "hoy"
            let esHoy = false;

            // Normalizar fecha si viene como string ISO (ej: 2026-05-04T05:00:00.000Z)
            let fechaLimpia = data.fecha || "";
            if (fechaLimpia.includes('T')) {
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
            const data = doc.data();
            registros.push({
                fecha: data.fecha,
                tipo: data.tipo,
                hora: this._limpiarHora(data.hora),
                almuerzo: data.almuerzo || '',
                dispositivo: data.dispositivo || '',
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null,
                dia: data.dia || '',
                modo: data.modo || 'OFICINA',
                horasExtra: data.horasExtra || 'NO',
                autoriza: data.autoriza || '',
                razon_salida_temprana: data.razon_salida_temprana || '',
                quien_justifica: data.quien_justifica || '',
                razon_entrada_tardia: data.razon_entrada_tardia || '',
                quien_justifica_entrada: data.quien_justifica_entrada || '',
                tipo_salida: data.tipo_salida || '',
                razon_permiso: data.razon_permiso || ''
            });
        });

        // Ordenar en cliente (de más reciente a más antiguo)
        registros.sort((a, b) => {
            if (a.timestamp && b.timestamp) {
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            }
            return 0;
        });

        // Retornar los últimos 100
        return registros.slice(0, 100);
    },

    async guardarRegistro(params) {
        let data = params;
        if (params.datos && typeof params.datos === 'string') {
            try { data = JSON.parse(params.datos); } catch (e) { }
        }

        const empleadoId = data.id?.toString();
        const empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists || empDoc.data().activo !== 'SI') return { error: "Empleado inválido o inactivo" };
        const infoEmpleado = empDoc.data();

        // Fechas
        let ahora = new Date();
        let fechaRegistro = ahora;

        if (data.tipo === 'FALTA' && data.fecha_falta) {
            const partes = data.fecha_falta.toString().trim().split('-');
            if (partes.length === 3) {
                fechaRegistro = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
            }
        }

        const mes = (fechaRegistro.getMonth() + 1).toString().padStart(2, '0');
        const dia = fechaRegistro.getDate().toString().padStart(2, '0');
        const fechaStr = `${fechaRegistro.getFullYear()}-${mes}-${dia}`;

        const h = ahora.getHours().toString().padStart(2, '0');
        const m = ahora.getMinutes().toString().padStart(2, '0');
        const s = ahora.getSeconds().toString().padStart(2, '0');
        const horaStr = data.tipo === 'FALTA' ? "00:00:00" : `${h}:${m}:${s}`;

        const modo = data.modo || "OFICINA";
        const horasExtra = modo === "CAMPO" ? "SI" : "NO";
        const autoriza = modo === "CAMPO" ? "SISTEMA (CAMPO)" : "";

        // Evitar duplicados (excepto FALTA/ESTADO)
        if (!["ESTADO", "FALTA"].includes(data.tipo)) {
            const hoyActualStr = `${ahora.getFullYear()}-${(ahora.getMonth() + 1).toString().padStart(2, '0')}-${ahora.getDate().toString().padStart(2, '0')}`;
            const dupQuery = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .where('fecha', '==', hoyActualStr)
                // Sin orderBy para no requerir índice compuesto en Firebase
                .get();

            if (!dupQuery.empty) {
                // Ordenar en el cliente para encontrar el más reciente de hoy
                let docs = dupQuery.docs.map(d => d.data());
                docs.sort((a, b) => {
                    let ta = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp).getTime()) : 0;
                    let tb = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp).getTime()) : 0;
                    return tb - ta; // Descendente
                });

                if (docs[0].tipo === data.tipo) {
                    return { error: `Ya registraste tu ${data.tipo} recientemente hoy` };
                }
            }
        }

        // Guardar en Firestore
        const nuevoRegistro = {
            fecha: fechaStr,
            empleadoId: empleadoId,
            nombre: infoEmpleado.nombre,
            tipo: data.tipo,
            almuerzo: data.almuerzo || "",
            hora: horaStr,
            lat: parseFloat(data.lat) || null,
            lng: parseFloat(data.lng) || null,
            dispositivo: data.dispositivo || "",
            timestamp: data.tipo === 'FALTA' ? firebase.firestore.Timestamp.fromDate(fechaRegistro) : firebase.firestore.FieldValue.serverTimestamp(),
            dia: this._obtenerDiaSemana(fechaRegistro),
            modo: modo,
            horasExtra: horasExtra,
            autoriza: autoriza,
            razon_salida_temprana: data.razon_salida || "",
            quien_justifica: data.quien_justifica || "",
            razon_entrada_tardia: data.razon_entrada_tardia || "",
            quien_justifica_entrada: data.quien_justifica_entrada || "",
            tipo_salida: data.tipo_salida || "",
            razon_permiso: data.razon_permiso || ""
        };

        // Guardar en Firestore con ID Determinístico para evitar duplicados
        // Formato: IDEMPLEADO_TIPO_FECHA_HORA (ej: 101_ENTRADA_2026-05-05_081500)
        const idLimpio = horaStr.replace(/:/g, '');
        const idDocumento = `${empleadoId}_${data.tipo}_${fechaStr}_${idLimpio}`;

        await db.collection('registros').doc(idDocumento).set(nuevoRegistro);
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
            const data = doc.data();
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
                horarios: { hora_almuerzo: "09:30", hora_entrada_limite: "08:15", hora_salida: "16:15", almuerzo_activo: true, hora_inicio: "08:00", hora_fin: "16:15", marcacion_automatica: false, tiempo_automatico: 10 },
                registro: { tolerancia_gps: 50, requiere_foto: false, permite_registro_manual: true },
                otras: { whatsapp_number: "593999999999", mensaje_soporte: "Hola, necesito soporte técnico", modo_mantenimiento: false }
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

                console.log("🚀 Configuración cargada desde Firebase:", resultado);
                return resultado;
            }

            console.warn("⚠️ No se encontró el documento 'configuracion/sistema', usando valores por defecto.");
            return configDefault;
        } catch (error) {
            console.error("🔥 Error en obtenerConfiguraciones:", error);
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
        const id = params.empleadoId;
        const nuevoAlmuerzo = params.almuerzo; // "SI" o "NO"
        const hoy = new Date();
        const hoyStr = params.fecha || new Date().toISOString().split('T')[0];

        // Buscar registro de entrada de ese día para este empleado
        const regSnap = await db.collection('registros')
            .where('empleadoId', '==', id)
            .where('fecha', '==', hoyStr)
            .where('tipo', '==', 'ENTRADA')
            .get();

        if (regSnap.empty) {
            // Si no existe, tal vez es un error de registro o el admin quiere forzarlo
            // Por consistencia, si no hay entrada, no solemos registrar almuerzo en la tabla de registros
            // Pero podríamos registrarlo en consumo_almuerzos si fuera necesario.
            return { error: "No se encontró registro de entrada para el " + hoyStr };
        }

        await db.collection('registros').doc(regSnap.docs[0].id).update({
            almuerzo: nuevoAlmuerzo
        });

        // Registrar en auditoría
        await db.collection('auditoria_almuerzos').add({
            empleadoId: id,
            fecha: hoyStr,
            nuevoValor: nuevoAlmuerzo,
            autor: "SUPERVISOR",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        return { ok: true };
    },

    async actualizarRegistroGeneral(params) {
        let docId = params.docId;
        const campo = params.campo;
        let valor = params.valor;
        const empleadoId = params.empleadoId;
        const tipo = params.tipo;
        const fecha = params.fecha || new Date().toLocaleDateString('en-CA');

        if (!campo) return { error: "Falta el campo a actualizar" };

        // Si no hay docId, intentamos buscarlo por empleadoId/fecha/tipo
        if (!docId && empleadoId) {
            const query = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .where('fecha', '==', fecha)
                .where('tipo', '==', tipo)
                .get();
            if (!query.empty) {
                docId = query.docs[0].id;
            }
        }

        if (docId) {
            const updateData = {};
            updateData[campo] = valor;
            await db.collection('registros').doc(docId).update(updateData);
            return { ok: true };
        } else if (empleadoId && campo === 'hora') {
            // Crear registro nuevo si no existía (ej: poner hora a un ausente)
            const empDoc = await db.collection('empleados').doc(empleadoId).get();
            if (!empDoc.exists) return { error: "Empleado no existe" };
            const empData = empDoc.data();

            await db.collection('registros').add({
                empleadoId: empleadoId,
                nombre: empData.nombre,
                fecha: fecha,
                tipo: tipo,
                hora: valor,
                almuerzo: "NO",
                modo: "OFICINA",
                horasExtra: "NO",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { ok: true };
        }

        return { error: "No se encontró el registro para actualizar" };
    },

    async obtenerAsistenciaEmpleado(params) {
        const id = params.empleadoId;
        const query = await db.collection('registros')
            .where('empleadoId', '==', id)
            .get();

        return query.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    },

    async obtenerReporteMensual(params) {
        // En Firebase, si no hay índices complejos, esto puede ser lento si bajamos todo.
        // Pero para el sistema TCONTROL solemos bajar los últimos 30-60 días.
        const query = await db.collection('registros').get();
        return query.docs.map(doc => ({ ...doc.data(), id: doc.id }));
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
        if (!docId) return { error: "Falta ID del registro" };
        await db.collection('registros').doc(docId).delete();
        return { ok: true };
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
        const id = params.empleadoId;
        const campo = params.campo;
        const valor = params.valor;

        if (!id || !campo) return { error: "Faltan parámetros" };

        const updateData = {};
        updateData[campo] = valor;

        await db.collection('empleados').doc(id).update(updateData);
        return { ok: true };
    },

    async obtenerListaCatering() {
        try {
            const hoy = new Date();
            const hoyStr = hoy.toLocaleDateString('en-CA');

            // 1. Obtener todos los registros de ENTRADA de hoy (más flexible que filtrar por 'SI' en DB)
            const regSnap = await db.collection('registros')
                .where('fecha', '==', hoyStr)
                .where('tipo', '==', 'ENTRADA')
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
        const hoyStr = hoy.toLocaleDateString('en-CA');

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

    async obtenerDatosSupervisor() {
        try {
            const hoy = new Date();
            const hoyStr = hoy.toLocaleDateString('en-CA');

            // 1. Empleados activos
            const empSnap = await db.collection('empleados').where('activo', '==', 'SI').get();
            const empleadosMap = {};
            empSnap.forEach(doc => {
                const data = doc.data();
                empleadosMap[doc.id] = {
                    ...data,
                    id: doc.id,
                    registros: [],
                    entradaHoy: false,
                    salidaHoy: false
                };
            });

            // 2. Registros de los últimos 60 días (para dashboard y reportes)
            const limite = new Date();
            limite.setDate(limite.getDate() - 60);
            const limiteStr = limite.toLocaleDateString('en-CA');

            const regSnap = await db.collection('registros')
                .where('fecha', '>=', limiteStr)
                .get();

            regSnap.forEach(doc => {
                const data = doc.data();
                const eid = data.empleadoId;
                if (empleadosMap[eid]) {
                    // Normalizar para el frontend legacy
                    const reg = { ...data, id: doc.id };

                    // Normalización de valor de almuerzo para compatibilidad con supervisor.html
                    const vAlm = (reg.almuerzo || "").toString().toUpperCase().trim();
                    if (vAlm === "SI" || vAlm === "SÍ") {
                        reg.almuerzo = "SI";
                    } else {
                        reg.almuerzo = "NO";
                    }

                    empleadosMap[eid].registros.push(reg);

                    if (data.fecha === hoyStr) {
                        if (data.tipo === 'ENTRADA') {
                            empleadosMap[eid].entradaHoy = true;
                            empleadosMap[eid].horaEntrada = data.hora;
                            empleadosMap[eid].almuerzoHoy = reg.almuerzo;

                            // Calcular horaEntradaMs para cálculos de puntualidad en el frontend
                            if (data.hora) {
                                const [h, m, s] = data.hora.split(':');
                                const d = new Date();
                                d.setHours(parseInt(h), parseInt(m), parseInt(s || 0));
                                empleadosMap[eid].horaEntradaMs = d.getTime();
                            }
                        }
                        if (data.tipo === 'SALIDA') {
                            empleadosMap[eid].salidaHoy = true;
                            empleadosMap[eid].horaSalida = data.hora;

                            if (data.hora) {
                                const [h, m, s] = data.hora.split(':');
                                const d = new Date();
                                d.setHours(parseInt(h), parseInt(m), parseInt(s || 0));
                                empleadosMap[eid].horaSalidaMs = d.getTime();
                            }
                        }
                    }
                }
            });

            return {
                empleados: Object.values(empleadosMap),
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

    async depurarDuplicados() {
        try {
            console.log("🧹 Iniciando depuración de duplicados...");
            const snap = await db.collection('registros').get();
            const docs = snap.docs;
            console.log(`📦 Analizando ${docs.length} registros...`);

            const unicos = new Map();
            const duplicados = [];

            docs.forEach(doc => {
                const data = doc.data();
                // Llave única: empleado_fecha_tipo_hora
                const llave = `${data.empleadoId}_${data.fecha}_${data.tipo}_${data._id_original || data.hora}`;

                if (unicos.has(llave)) {
                    duplicados.push(doc.id);
                } else {
                    unicos.set(llave, doc.id);
                }
            });

            console.log(`⚠️ Se encontraron ${duplicados.length} duplicados.`);

            if (duplicados.length > 0) {
                let batch = db.batch();
                let count = 0;
                let totalEliminados = 0;

                for (const id of duplicados) {
                    batch.delete(db.collection('registros').doc(id));
                    count++;
                    totalEliminados++;

                    if (count === 400) {
                        await batch.commit();
                        batch = db.batch();
                        count = 0;
                    }
                }
                if (count > 0) await batch.commit();

                return { ok: true, eliminados: totalEliminados };
            }

            return { ok: true, eliminados: 0 };
        } catch (e) {
            console.error("❌ Error en depuración:", e);
            return { error: e.message };
        }
    },

    async regularizacionMasiva(params) {
        try {
            const { fecha, horaE, horaS, soloFaltantes } = params;
            if (!fecha) return { error: "Falta fecha" };

            console.log(`⚡ Iniciando regularización masiva para el ${fecha}...`);

            const empsSnap = await db.collection('empleados').get();
            const regsSnap = await db.collection('registros').where('fecha', '==', fecha).get();

            const regsByEmp = {};
            regsSnap.docs.forEach(d => {
                const data = d.data();
                if (!regsByEmp[data.empleadoId]) regsByEmp[data.empleadoId] = { E: false, S: false };
                if (data.tipo === 'ENTRADA' || data.tipo === 'RETORNO_CAMPO') regsByEmp[data.empleadoId].E = true;
                if (data.tipo === 'SALIDA' || data.tipo === 'SALIDA_CAMPO') regsByEmp[data.empleadoId].S = true;
            });

            let batch = db.batch();
            let total = 0;
            let count = 0;

            for (const empDoc of empsSnap.docs) {
                const eid = empDoc.id;
                const status = regsByEmp[eid] || { E: false, S: false };

                // Entrada
                if (!status.E || !soloFaltantes) {
                    const ref = db.collection('registros').doc();
                    batch.set(ref, {
                        empleadoId: eid,
                        fecha: fecha,
                        tipo: 'ENTRADA',
                        hora: horaE,
                        modo: 'OFICINA',
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }

                // Salida
                if (!status.S || !soloFaltantes) {
                    const ref = db.collection('registros').doc();
                    batch.set(ref, {
                        empleadoId: eid,
                        fecha: fecha,
                        tipo: 'SALIDA',
                        hora: horaS,
                        modo: 'OFICINA',
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }

                if (count >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    total += count;
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
                total += count;
            }

            return { ok: true, procesados: total };
        } catch (e) {
            console.error("❌ Error en regularización masiva:", e);
            return { error: e.message };
        }
    },

    // Auxiliares
    _obtenerDiaSemana(fecha) {
        const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        return dias[fecha.getDay()];
    },

    _normalizarUrlFoto(url) {
        if (!url) return "";
        // Si es un link de Google Drive (formato /file/d/ID/view o ?id=ID)
        if (url.includes('drive.google.com')) {
            let id = "";
            if (url.includes('/file/d/')) {
                id = url.split('/file/d/')[1].split('/')[0];
            } else if (url.includes('id=')) {
                id = url.split('id=')[1].split('&')[0];
            }
            if (id) {
                // El formato /thumbnail es más robusto contra errores 403 que /uc
                return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
            }
        }
        return url;
    },

    _limpiarHora(hora) {
        if (!hora) return "";
        let hStr = hora.toString();
        // Si viene como ISO (ej: 1899-12-30T12:44:00.000Z)
        if (hStr.includes('T')) {
            let partes = hStr.split('T')[1];
            return partes.split('.')[0].substring(0, 8); // Retorna HH:mm:ss
        }
        return hStr;
    }
};

console.log("🚀 Motor de Firebase inicializado y listo para usar.");
