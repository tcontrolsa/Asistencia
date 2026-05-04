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
            switch(params.accion) {
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
        dispRef.update({ ultimo_uso: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});

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
        if (!pin || !token) return { error: "PIN o Token ausente" };

        // Buscar empleado con este PIN
        const empQuery = await db.collection('empleados').where('pin', '==', pin.toString()).get();
        if (empQuery.empty) {
            return { error: "PIN incorrecto o empleado no encontrado" };
        }

        const empDoc = empQuery.docs[0];
        const empData = empDoc.data();

        if (empData.activo !== 'SI') {
            return { error: "Empleado inactivo" };
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
            empleado: {
                id: empDoc.id,
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
            try { data = JSON.parse(params.datos); } catch(e) {}
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
            const hoyActualStr = `${ahora.getFullYear()}-${(ahora.getMonth()+1).toString().padStart(2,'0')}-${ahora.getDate().toString().padStart(2,'0')}`;
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

        await db.collection('registros').add(nuevoRegistro);
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
