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
        const accion = (params.accion || "").trim();
        console.log("🔥 Firebase ejecutando acción:", accion);
        try {
            switch (accion) {
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
                    return await this.actualizarRegistroGeneral(params);
                case 'justificarDia':
                    return await this.justificarDia(params);
                case 'actualizarEmpleado':
                    return await this.actualizarEmpleado(params);
                case 'actualizarMasivoEmpleados':
                    return await this.actualizarMasivoEmpleados(params);
                case 'eliminarRegistro':
                    return await this.eliminarRegistro(params);
                case 'depurarDuplicados':
                    return await this.depurarDuplicados(params);
                case 'regularizacionMasiva':
                    return await this.regularizacionMasiva(params);
                case 'desvincularDispositivo':
                    return await this.desvincularDispositivo(params);
                case 'escribirHojaActualizar':
                    return await this._post(params);
                case 'leerHojaActualizar':
                    return await this._jsonp(params);
                case 'registrarLog':
                    return await this.registrarLog(params);
                case 'guardarPermisoSupervisor':
                    return await this.guardarPermisoSupervisor(params);
                // Acciones exclusivas de Google Apps Script (Sheets)
                case 'registrarAlmuerzoExtra':
                case 'archivarRegistros':
                case 'crearReporteGoogleSheets':
                    return await this._jsonp(params);
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
        const idRequerido = params.empleadoId; 
        
        console.log("🔐 Verificando PIN...", { pin: pin, token: token, idRequerido: idRequerido });

        if (!pin || !token) return { error: "PIN o Token ausente" };

        let empDoc = null;
        let empData = null;

        // 1. CASO MAESTRO: Si es la clave maestra, intentar cargar el administrador 1058
        if (pin === "TCONTROL2026") {
            console.log("👑 Clave Maestra detectada.");
            const doc = await db.collection('empleados').doc("1058").get();
            if (doc.exists) {
                empDoc = doc;
                empData = doc.data();
            }
        }

        // 2. CASO ESPECÍFICO: Si se pasó un ID (Login Supervisor con ID + PIN)
        if (!empDoc && idRequerido) {
            console.log("🔍 Buscando empleado por ID específico:", idRequerido);
            const doc = await db.collection('empleados').doc(idRequerido.toString()).get();
            if (doc.exists) {
                const data = doc.data();
                // Validar PIN (puede ser string o number en Firestore)
                if (data.pin?.toString() === pin.toString()) {
                    empDoc = doc;
                    empData = data;
                }
            }
        }

        // 3. CASO GENERAL: Búsqueda por PIN único (Login Empleado)
        if (!empDoc) {
            console.log("🔎 Búsqueda general por PIN en toda la colección.");
            const pinStr = pin.toString();
            const pinNum = parseInt(pin);
            const queries = [db.collection('empleados').where('pin', '==', pinStr).get()];
            if (!isNaN(pinNum)) {
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
            console.warn("❌ PIN no encontrado en ninguna búsqueda.");
            return { error: "Acceso denegado: PIN/Contraseña incorrecta o usuario no encontrado", valido: false };
        }

        console.log("✅ Empleado encontrado:", empData.nombre);
        if (empData.activo !== 'SI') {
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
                esSupervisor: empData.supervisor === 'SI',
                pagos_url: empData.id_dispositivo || ""
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
            registros.push({
                fecha: this._normFecha(data.fecha),
                tipo: data.tipo,
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
                permiso_medico_mins: data.permiso_medico_mins || 0
            });
        });

        // --- INICIO: Integración de Registros Archivados ---
        if (params.incluirArchivados !== false) {
            const CACHE_ARCHIVADOS_KEY = `tcontrol_archivados_cache_${empleadoId}_v1`;
            let archivadosData = { registros: [], lastSync: null };
            try {
                const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
                if (storedArch) archivadosData = JSON.parse(storedArch);
            } catch(e) { console.warn("Error leyendo caché archivados:", e); }

            // Cache por 30 minutos (antes era 12 horas) para evitar falsas faltas tras archivar
            const horasArchivados = archivadosData.lastSync ? (new Date() - new Date(archivadosData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchArchivados = async () => {
                try {
                    const resJson = await this._jsonp({ 
                        accion: 'obtenerRegistrosArchivados',
                        empleadoId: empleadoId 
                    });
                    if (resJson.ok && resJson.registros) {
                        archivadosData.registros = resJson.registros;
                        archivadosData.lastSync = new Date().toISOString();
                        try {
                            localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archivadosData));
                            console.log("✅ Registros archivados de Sheets actualizados para el empleado.");
                            window.dispatchEvent(new Event('archivadosActualizados'));
                        } catch(e) {}
                    }
                } catch(e) { console.warn("Error consultando archivados:", e); }
            };

            if (params.force) {
                console.log(`📥 Forzando sincronización de registros archivados de Sheets para empleado ${empleadoId}...`);
                await _fetchArchivados();
            } else if (horasArchivados > 0.5) { 
                console.log(`📥 Sincronizando registros archivados de Sheets para empleado ${empleadoId}...`);
                await _fetchArchivados(); // Ahora espera para no generar faltas falsas en la UI
            }

            // Filtrar archivados del empleado actual y mapearlos al formato esperado
            const archivadosDelEmpleado = archivadosData.registros.filter(r => r.empleadoId === empleadoId).map(data => ({
                fecha: this._normFecha(data.fecha),
                tipo: data.tipo,
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
                permiso_medico_mins: data.permiso_medico_mins || 0
            }));

            registros = registros.concat(archivadosDelEmpleado);
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

        const empleadoId = data.id?.toString();
        const empDoc = await db.collection('empleados').doc(empleadoId).get();
        if (!empDoc.exists || empDoc.data().activo !== 'SI') return { error: "Empleado inválido o inactivo" };
        const infoEmpleado = empDoc.data();

        // Fechas
        let ahora = new Date();
        let fechaRegistro = ahora;

        const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
        const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

        if (esAusenciaTipo(data.tipo) && data.fecha_falta) {
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
        const horaStr = esAusenciaTipo(data.tipo) ? "00:00:00" : `${h}:${m}:${s}`;

        const modo = data.modo || "OFICINA";
        const horasExtra = modo === "CAMPO" ? "SI" : "NO";
        const autoriza = modo === "CAMPO" ? "SISTEMA (CAMPO)" : "";

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

        // Guardar en Firestore (Minimización de campos a 11 campos clave)
        const nuevoRegistro = {
            empleadoId: empleadoId,
            nombre: infoEmpleado.nombre,
            tipo: data.tipo,
            almuerzo: almuerzo,
            lat: parseFloat(data.lat) || null,
            lng: parseFloat(data.lng) || null,
            dispositivo: data.dispositivo || "",
            timestamp: esAusenciaTipo(data.tipo) ? firebase.firestore.Timestamp.fromDate(fechaRegistro) : firebase.firestore.FieldValue.serverTimestamp(),
            modo: modo,
            horasExtra: horasExtra,
            autoriza: autoriza
        };
        if (esAusenciaTipo(data.tipo)) {
            nuevoRegistro.razon_ausencia = data.razon_ausencia || "";
        }

        const hoyStrLocal = this._hoyStr();
        const isPastDate = fechaStr < hoyStrLocal;

        // Si es fecha pasada, escribir directamente en la hoja de REGISTROS (Google Sheets)
        // para evitar el dual-write y duplicados, ya que el archivo ocurre por día.
        if (isPastDate) {
            try {
                const sheetsParams = { ...params, accion: 'guardarRegistro' };
                await this._jsonp(sheetsParams);
            } catch (e) {
                console.warn("⚠️ Error al sincronizar histórico con Sheets:", e);
                return { error: "Error de conexión con histórico: " + e.message };
            }
            return { ok: true, msg: `${data.tipo} registrado en histórico` };
        }

        // Si es fecha actual, guardar SOLO en Firestore con ID Determinístico
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
        const id = params.empleadoId;
        const nuevoAlmuerzo = params.almuerzo; // "SI" o "NO"
        const hoy = new Date();
        const hoyStr = params.fecha || new Date().toISOString().split('T')[0];

        // Buscar registro de entrada/almuerzo del empleado sin filtrar por fecha en query
        const allSnap = await db.collection('registros')
            .where('empleadoId', '==', id)
            .where('tipo', 'in', ['ENTRADA', 'SOLO_ALMUERZO'])
            .get();

        const docs = allSnap.docs.map(doc => this._processDoc(doc.id, doc.data())).filter(Boolean);
        const matchedReg = docs.find(r => r.fecha === hoyStr);

        const hoyStrLocal = this._hoyStr();
        const isPastDate = hoyStr < hoyStrLocal;

        if (!matchedReg) {
            if (isPastDate) {
                // Para fechas anteriores, si no está en Firebase, debe estar en Sheets.
                // Lo enviamos a Sheets y NO lo creamos en Firebase para evitar dualidad.
                try {
                    await this._jsonp(params);
                } catch (e) { console.warn("Error Sheets:", e); }
            } else {
                // Crear registro SOLO_ALMUERZO en Firebase para la fecha actual
                const empDoc = await db.collection('empleados').doc(id).get();
                const nombre = empDoc.exists ? empDoc.data().nombre : 'Desconocido';
                
                const h = hoy.getHours().toString().padStart(2, '0');
                const m = hoy.getMinutes().toString().padStart(2, '0');
                const s = hoy.getSeconds().toString().padStart(2, '0');
                const horaStr = `${h}:${m}:${s}`;
                
                const idLimpio = horaStr.replace(/:/g, '');
                const idDocumento = `${id}_SOLO_ALMUERZO_${hoyStr}_${idLimpio}`;
                
                await db.collection('registros').doc(idDocumento).set({
                    empleadoId: id,
                    nombre: nombre,
                    tipo: 'SOLO_ALMUERZO',
                    almuerzo: nuevoAlmuerzo,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    modo: 'OFICINA',
                    horasExtra: 'NO'
                });
            }
        } else {
            // Actualizar el existente en Firebase
            await db.collection('registros').doc(matchedReg.id).update({
                almuerzo: nuevoAlmuerzo
            });
            
            // Si es fecha anterior y aún estaba en Firebase, también mandarlo a Sheets 
            // por si estaba archivado parcialmente
            if (isPastDate) {
                try {
                    await this._jsonp(params);
                } catch (e) { console.warn("Error Sheets:", e); }
            }
        }

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
        const fecha = params.fecha || this._hoyStr();

        if (!campo) return { error: "Falta el campo a actualizar" };

        // Caso 1: ID explícitamente de Sheets
        if (docId && String(docId).startsWith('arch_')) {
            try {
                return await this._jsonp({
                    accion: 'actualizarRegistroArchivado',
                    empleadoId: empleadoId,
                    fecha: fecha,
                    tipo: tipo,
                    campo: campo,
                    valor: valor
                });
            } catch (e) { return { error: "Error de conexión con Sheets: " + e.message }; }
        }

        // Si no hay docId, intentamos buscarlo por empleadoId/fecha/tipo en Firebase
        if (!docId && empleadoId) {
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
        }

        if (docId) {
            const docRef = db.collection('registros').doc(docId);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                const updateData = {};
                if (campo === 'timestamp') {
                    const parsed = parsearTimestamp(valor);
                    if (!parsed) return { error: "Formato de timestamp inválido" };
                    const [dPart, tPart] = parsed.timestampFormatted.split(' ');
                    const [day, month, year] = dPart.split('/').map(Number);
                    const [hour, minute, second] = tPart.split(':').map(Number);
                    const dateObj = new Date(year, month - 1, day, hour, minute, second);
                    updateData.timestamp = firebase.firestore.Timestamp.fromDate(dateObj);
                } else {
                    updateData[campo] = valor;
                    if (campo === 'hora') {
                         if (docSnap.data().timestamp) {
                             const oldDate = docSnap.data().timestamp.toDate ? docSnap.data().timestamp.toDate() : new Date(docSnap.data().timestamp);
                             const [h, m, s] = valor.split(':').map(Number);
                             const newDate = new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate(), h || 0, m || 0, s || 0);
                             updateData.timestamp = firebase.firestore.Timestamp.fromDate(newDate);
                         }
                    }
                }
                if (params.justificado) updateData.justificado = params.justificado;
                if (params.razon_justificac) updateData.razon_justificac = params.razon_justificac;
                if (params.razon_ausencia) updateData.razon_ausencia = params.razon_ausencia;
                await docRef.update(updateData);
                return { ok: true };
            } else {
                // El documento no existe: lo creamos con set
                const empDoc = await db.collection('empleados').doc(empleadoId).get();
                if (!empDoc.exists) return { error: "Empleado no existe" };
                const empData = empDoc.data();

                const fechaPartes = fecha.split('-').map(Number);
                const hVal = (campo === 'hora' ? valor : '00:00:00');
                const [h, m, s] = hVal.split(':').map(Number);
                const dateObj = new Date(fechaPartes[0], fechaPartes[1] - 1, fechaPartes[2], h || 0, m || 0, s || 0);

                const newData = {
                    empleadoId: empleadoId,
                    nombre: empData.nombre,
                    tipo: tipo,
                    almuerzo: params.almuerzo || "NO",
                    modo: params.modo || "OFICINA",
                    horasExtra: params.horasExtra || "NO",
                    observacion: params.observacion || "",
                    timestamp: firebase.firestore.Timestamp.fromDate(dateObj)
                };
                if (campo && campo !== 'hora') {
                    newData[campo] = valor;
                }
                if (params.justificado) newData.justificado = params.justificado;
                if (params.razon_justificac) newData.razon_justificac = params.razon_justificac;
                if (params.razon_ausencia) newData.razon_ausencia = params.razon_ausencia;
                await docRef.set(newData);
                return { ok: true };
            }
        } else if (empleadoId && campo === 'hora') {
            // Si el registro no está en Firebase y la fecha es antigua (ej: > 2 días), enviar a Sheets
            const hoy = new Date();
            const limiteFirebase = new Date();
            limiteFirebase.setDate(limiteFirebase.getDate() - 2);
            const fechaRegistro = new Date(fecha + 'T12:00:00');

            if (fechaRegistro < limiteFirebase) {
                try {
                    return await this._jsonp({
                        accion: 'actualizarRegistroArchivado',
                        empleadoId: empleadoId,
                        fecha: fecha,
                        tipo: tipo,
                        campo: campo,
                        valor: valor,
                        almuerzo: params.almuerzo,
                        modo: params.modo,
                        horasExtra: params.horasExtra,
                        observacion: params.observacion
                    });
                } catch (e) { return { error: "Error de conexión con Sheets: " + e.message }; }
            }

            // Crear registro nuevo en Firebase
            const empDoc = await db.collection('empleados').doc(empleadoId).get();
            if (!empDoc.exists) return { error: "Empleado no existe" };
            const empData = empDoc.data();

            const fechaPartes = fecha.split('-').map(Number);
            const [h, m, s] = valor.split(':').map(Number);
            const dateObj = new Date(fechaPartes[0], fechaPartes[1] - 1, fechaPartes[2], h || 0, m || 0, s || 0);

            const newData = {
                empleadoId: empleadoId,
                nombre: empData.nombre,
                tipo: tipo,
                almuerzo: params.almuerzo || "NO",
                modo: params.modo || "OFICINA",
                horasExtra: params.horasExtra || "NO",
                observacion: params.observacion || "",
                timestamp: firebase.firestore.Timestamp.fromDate(dateObj)
            };
            if (params.justificado) newData.justificado = params.justificado;
            if (params.razon_justificac) newData.razon_justificac = params.razon_justificac;
            if (params.razon_ausencia) newData.razon_ausencia = params.razon_ausencia;

            await db.collection('registros').add(newData);
            return { ok: true };
        }

        return { error: "No se encontró el registro para actualizar" };
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

    async obtenerListaCatering() {
        try {
            const hoy = new Date();
            const hoyStr = this._hoyStr(hoy);

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

    async obtenerDatosSupervisor(params = {}) {
        try {
            const hoy = new Date();
            const hoyStr = this._hoyStr(hoy);

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

            // 2. Caching de Registros para reducir lecturas (Ahorro crítico de Firebase)
            const limite = new Date();
            limite.setDate(limite.getDate() - 60);
            const limiteStr = this._hoyStr(limite);

            const CACHE_KEY = 'tcontrol_registros_cache_v1';
            let cacheData = { registros: {}, lastSync: null };
            try {
                const stored = localStorage.getItem(CACHE_KEY);
                if (stored) cacheData = JSON.parse(stored);
            } catch(e) { console.warn("Error leyendo caché:", e); }

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
            } catch(e) { console.warn("Error guardando caché (posible límite de localStorage):", e); }

            // 2.5 Caching y obtención de Registros Archivados en Sheets
            const CACHE_ARCHIVADOS_KEY = 'tcontrol_archivados_cache_v1';
            let archivadosData = { registros: [], lastSync: null };
            try {
                const storedArch = localStorage.getItem(CACHE_ARCHIVADOS_KEY);
                if (storedArch) archivadosData = JSON.parse(storedArch);
            } catch(e) { console.warn("Error leyendo caché archivados:", e); }

            const horasArchivados = archivadosData.lastSync ? (new Date() - new Date(archivadosData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchArchivados = async () => {
                try {
                    const resJson = await this._jsonp({ accion: 'obtenerRegistrosArchivados' });
                    if (resJson.ok && resJson.registros) {
                        archivadosData.registros = resJson.registros;
                        archivadosData.lastSync = new Date().toISOString();
                        try {
                            localStorage.setItem(CACHE_ARCHIVADOS_KEY, JSON.stringify(archivadosData));
                            console.log("✅ Registros archivados de Sheets actualizados en caché.");
                            window.dispatchEvent(new Event('archivadosActualizados'));
                        } catch(e) {}
                    }
                } catch(e) { console.warn("Error consultando archivados:", e); }
            };
            
            if (params.forceSheets || params.forceAll) {
                console.log("📥 Forzando obtención de registros archivados de Sheets (Bloqueante)...");
                await _fetchArchivados();
            } else if (horasArchivados > 12) {
                console.log("📥 Obteniendo registros archivados históricos de Sheets...");
                await _fetchArchivados();
            }

            // 2.6 Caching y obtención de Almuerzos Extras
            const CACHE_ALMUERZOS_EXTRA_KEY = 'tcontrol_almuerzos_extra_cache_v1';
            let almuerzosExtraData = { almuerzos: [], lastSync: null };
            try {
                const storedAlm = localStorage.getItem(CACHE_ALMUERZOS_EXTRA_KEY);
                if (storedAlm) almuerzosExtraData = JSON.parse(storedAlm);
            } catch(e) { console.warn("Error leyendo caché almuerzos extras:", e); }

            const horasAlmuerzos = almuerzosExtraData.lastSync ? (new Date() - new Date(almuerzosExtraData.lastSync)) / (1000 * 60 * 60) : 999;
            const _fetchAlmuerzosExtra = async () => {
                try {
                    const resJson = await this._jsonp({ accion: 'obtenerAlmuerzosExtra' });
                    if (resJson.ok && resJson.almuerzos) {
                        almuerzosExtraData.almuerzos = resJson.almuerzos;
                        almuerzosExtraData.lastSync = new Date().toISOString();
                        try {
                            localStorage.setItem(CACHE_ALMUERZOS_EXTRA_KEY, JSON.stringify(almuerzosExtraData));
                            console.log("✅ Almuerzos extras de Sheets actualizados en caché.");
                        } catch(e) {}
                    }
                } catch(e) { console.warn("Error consultando almuerzos extras:", e); }
            };

            if (params.forceSheets || params.forceAll) {
                console.log("📥 Forzando obtención de almuerzos extras de Sheets...");
                await _fetchAlmuerzosExtra();
            } else if (horasAlmuerzos > 12) {
                console.log("📥 Obteniendo almuerzos extras históricos de Sheets...");
                await _fetchAlmuerzosExtra();
            }

            const archivadosNorm = archivadosData.registros.map(reg => ({
                id: reg.id || `arch_${reg.empleadoId}_${reg.fecha}_${reg.tipo}`,
                empleadoId: reg.empleadoId || reg.id_empleado || '',
                fecha: this._normFecha(reg.fecha),
                tipo: (reg.tipo || '').toUpperCase(),
                hora: reg.hora || '',
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
                permiso_personal_mins: reg.permiso_personal_mins || 0,
                permiso_medico_mins: reg.permiso_medico_mins || 0
            })).filter(r => r.fecha && r.empleadoId); // descartar filas vacías

            // Registros de Firebase: también normalizar fecha por si acaso
            const registrosFirebase = allRegistros.map(r => ({ ...r, fecha: this._normFecha(r.fecha) }));

            // Fechas cubiertas por Firebase por empleado (para evitar duplicados con archivados de forma individual)
            const empFechasEnFirebase = new Set(registrosFirebase.map(r => `${r.empleadoId}|${r.fecha}`).filter(Boolean));
            // Solo incluir archivados de fechas que NO están en Firebase para ese empleado específico
            const archivadosFiltrados = archivadosNorm.filter(r => r.fecha && !empFechasEnFirebase.has(`${r.empleadoId}|${r.fecha}`));
            const registrosCompletos = registrosFirebase.concat(archivadosFiltrados);

            // 3. Procesar todos los registros combinados
            registrosCompletos.forEach(reg => {
                const eid = reg.empleadoId;
                if (!eid || !empleadosMap[eid]) return;

                // Normalizar almuerzo: solo SI/NO si tiene valor, vacío si no
                const vAlm = (reg.almuerzo || '').toString().trim().toUpperCase();
                reg.almuerzo = (vAlm === 'SI' || vAlm === 'SÍ') ? 'SI' : (vAlm === 'NO' ? 'NO' : '');

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

            // Leer alerta de emergencia
            let emergencia = { activa: false, nombre: '', habilitadoPor: '', fecha: '' };
            try {
                const emSnap = await db.collection('configuracion').doc('emergencia').get();
                if (emSnap.exists) {
                    emergencia = emSnap.data();
                }
            } catch(e) {
                console.error("Error al leer emergencia en obtenerDatosSupervisor:", e);
            }

            return {
                empleados: Object.values(empleadosMap),
                almuerzosExtra: almuerzosExtraData.almuerzos || [],
                emergencia: emergencia,
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
            const tInicio = firebase.firestore.Timestamp.fromDate(new Date(fecha + 'T00:00:00'));
            const tFin = firebase.firestore.Timestamp.fromDate(new Date(fecha + 'T23:59:59'));
            const regsSnap = await db.collection('registros')
                .where('timestamp', '>=', tInicio)
                .where('timestamp', '<=', tFin)
                .get();

            const regsByEmp = {};
            regsSnap.docs.forEach(d => {
                const data = this._processDoc(d.id, d.data());
                if (!data) return;
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
                    const eDate = new Date(fecha + 'T' + (horaE || '07:30:00'));
                    batch.set(ref, {
                        empleadoId: eid,
                        tipo: 'ENTRADA',
                        modo: 'OFICINA',
                        timestamp: firebase.firestore.Timestamp.fromDate(eDate)
                    });
                    count++;
                }

                // Salida
                if (!status.S || !soloFaltantes) {
                    const ref = db.collection('registros').doc();
                    const sDate = new Date(fecha + 'T' + (horaS || '16:15:00'));
                    batch.set(ref, {
                        empleadoId: eid,
                        tipo: 'SALIDA',
                        modo: 'OFICINA',
                        timestamp: firebase.firestore.Timestamp.fromDate(sDate)
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

    // ==========================================
    // AUXILIARES
    // ==========================================
    async _post(params) {
        try {
            const api_url = (window.TCONTROL_CONFIG && window.TCONTROL_CONFIG.API_URL) || window.API_URL || 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
            let payload = { ...params };
            payload.apiKey = 'TCONTROL_SECURE_2026_XYZ';
            if (payload.empleados && typeof payload.empleados === 'string') {
                try {
                    payload.empleados = JSON.parse(payload.empleados);
                } catch(e) {}
            }
            const res = await fetch(api_url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            return await res.json();
        } catch (error) {
            console.error("❌ Error en _post a Sheets:", error);
            return { error: "Error de red al conectar con Sheets: " + error.message };
        }
    },

    _jsonp(params) {
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
                window[callbackName] = function() {};
                setTimeout(() => { delete window[callbackName]; }, 60000);
                if (script.parentNode) script.parentNode.removeChild(script);
            };

            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("Timeout en la conexión con Sheets"));
            }, 25000);

            window[callbackName] = (data) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                cleanup();
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
                reject(new Error("Error de red al conectar con Sheets"));
            };
            script.onload = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
            };
            document.body.appendChild(script);
        });
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

    _processDoc(id, data) {
        if (!data) return null;
        const res = { id, ...data };
        if (data.timestamp) {
            let d;
            if (typeof data.timestamp.toDate === 'function') {
                d = data.timestamp.toDate();
            } else if (data.timestamp instanceof Date) {
                d = data.timestamp;
            } else {
                d = new Date(data.timestamp);
            }
            if (d && !isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                res.fecha = `${y}-${m}-${day}`;
                
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                res.hora = `${hh}:${mm}:${ss}`;
                
                res.dia = this._obtenerDiaSemana(d);
            }
        }

        // Si el tipo es de ausencia, calcular dinámicamente hora y razon_ausencia si no están
        const esMarcacionOrdinaria = (tipo) => ['ENTRADA', 'SALIDA', 'ESTADO', 'SOLO_ALMUERZO'].includes(String(tipo).toUpperCase());
        const esAusenciaTipo = (tipo) => !esMarcacionOrdinaria(tipo);

        if (esAusenciaTipo(res.tipo)) {
            res.hora = '00:00:00';
            if (!res.razon_ausencia) {
                const t = String(res.tipo).toUpperCase();
                if (t === 'VACACIONES' || t === 'VACACION') res.razon_ausencia = 'Vacación';
                else if (t === 'PERMISO_MEDICO') res.razon_ausencia = 'Permiso Médico';
                else if (t === 'PERMISO_PERSONAL') res.razon_ausencia = 'Permiso Personal';
                else if (t === 'CALAMIDAD_DOMESTICA') res.razon_ausencia = 'Calamidad Doméstica';
                else if (t === 'TRABAJO_DE_CAMPO' || t === 'SALIDA_A_CAMPO') res.razon_ausencia = 'Salida a Campo';
                else res.razon_ausencia = res.tipo;
            }
        }

        return res;
    },

    _limpiarHora(hora) {
        if (!hora) return "";
        let hStr = hora.toString();
        // Si viene como ISO (ej: 1899-12-30T12:44:00.000Z)
        if (/^\d{4}-\d{2}-\d{2}T/.test(hStr)) {
            let partes = hStr.split('T')[1];
            return partes.split('.')[0].substring(0, 8); // Retorna HH:mm:ss
        }
        return hStr;
    },

    _normFecha(val) {
        if (!val) return '';
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        // DD/MM/YYYY
        const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
        // Cualquier otro formato parseable
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

    async guardarPermisoSupervisor(params) {
        try {
            const empleadoId = params.empleadoId?.toString();
            const fecha = params.fecha; // YYYY-MM-DD
            const tipo = params.tipo; // "personal" o "medico"
            const minutos = parseInt(params.mins !== undefined ? params.mins : params.minutos) || 0;

            if (!empleadoId || !fecha) return { error: "Parámetros incompletos" };

            const hoyStrLocal = this._hoyStr();
            const isPastDate = fecha < hoyStrLocal;

            if (isPastDate) {
                try {
                    const sheetsParams = { ...params, accion: 'guardarPermisoSupervisor' };
                    return await this._jsonp(sheetsParams);
                } catch(e) {
                    console.warn("Error writing past permission to Sheets:", e);
                    return { error: "Error de conexión con Sheets: " + e.message };
                }
            }

            // Buscar la entrada de ese día
            const regSnap = await db.collection('registros')
                .where('empleadoId', '==', empleadoId)
                .where('tipo', '==', 'ENTRADA')
                .get();

            let entryDocId = null;
            regSnap.forEach(doc => {
                const docData = this._processDoc(doc.id, doc.data());
                if (docData && docData.fecha === fecha) {
                    entryDocId = doc.id;
                }
            });

            if (entryDocId) {
                const updateField = tipo === 'personal' ? 'permiso_personal_mins' : 'permiso_medico_mins';
                await db.collection('registros').doc(entryDocId).update({
                    [updateField]: minutos
                });
                
                // Invalidate local storage cache to force refetch of all days
                try {
                    localStorage.removeItem('tcontrol_registros_cache_v1');
                    localStorage.removeItem(`tcontrol_archivados_cache_${empleadoId}_v1`);
                } catch(e) {}

                // Sincronizar en Sheets (dual write)
                try {
                    const sheetsParams = { ...params, accion: 'guardarPermisoSupervisor' };
                    await this._jsonp(sheetsParams);
                } catch(e) {
                    console.warn("Error dual write to Sheets:", e);
                }
                
                return { ok: true };
            } else {
                return { error: "No se encontró registro de entrada para ese día en Firebase" };
            }
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
