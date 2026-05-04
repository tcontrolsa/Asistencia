// =========================================================
// SCRIPT DE MIGRACIÓN: GOOGLE SHEETS -> FIREBASE
// =========================================================

async function ejecutarMigracionAFirebase() {
    if (!confirm("⚠️ ADVERTENCIA: Esta acción descargará toda la base de datos de Google Sheets y la subirá a Firebase. ¿Estás seguro de continuar?")) {
        return;
    }

    // 1. Mostrar UI de progreso
    const overlay = document.createElement('div');
    overlay.style = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:99999;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;";
    overlay.innerHTML = `
        <i class="fas fa-cloud-upload-alt fa-4x mb-4" style="color: #3b82f6;"></i>
        <h2 class="mb-3">Migración a Firebase en progreso</h2>
        <div id="mig-status" class="fs-5 mb-2">Conectando con Google Sheets...</div>
        <div class="progress" style="width: 80%; height: 25px; max-width: 500px; background: #333; border-radius: 12px; overflow: hidden;">
            <div id="mig-progress" class="progress-bar progress-bar-striped progress-bar-animated bg-primary" style="width: 0%"></div>
        </div>
        <div id="mig-details" class="text-muted mt-3 small">Obteniendo permisos...</div>
    `;
    document.body.appendChild(overlay);

    const setStatus = (msg, percent, details) => {
        document.getElementById('mig-status').innerText = msg;
        document.getElementById('mig-progress').style.width = percent + '%';
        if (details) document.getElementById('mig-details').innerText = details;
    };

    try {
        // 2. Descargar datos de GAS
        setStatus("Descargando base de datos histórica...", 10, "Esperando respuesta de Google Scripts (puede tardar 10-20 seg)");
        const data = await jsonpRequest({ accion: 'exportarBaseDatosParaFirebase' });
        
        if (data.error) throw new Error(data.error);
        if (!data.empleados || !data.registros) throw new Error("Los datos descargados están incompletos");

        console.log("Datos recibidos:", data);
        const total = data.empleados.length + data.registros.length + data.dispositivos.length;
        let procesados = 0;

        const batchCommit = async (batch, count) => {
            await batch.commit();
            procesados += count;
            const percent = 20 + Math.floor((procesados / total) * 80);
            setStatus("Subiendo a Firebase Firestore...", percent, `${procesados} de ${total} registros procesados`);
        };

        const db = firebase.firestore();

        // 3. Subir Empleados (En lotes de 500 - Límite de Firestore Batch)
        setStatus("Migrando Empleados...", 20, "Preparando lote...");
        let batch = db.batch();
        let batchCount = 0;

        for (const emp of data.empleados) {
            const ref = db.collection('empleados').doc(emp.id.toString());
            batch.set(ref, emp);
            batchCount++;
            
            if (batchCount === 500) {
                await batchCommit(batch, batchCount);
                batch = db.batch();
                batchCount = 0;
            }
        }

        // 4. Subir Dispositivos
        for (const disp of data.dispositivos) {
            const ref = db.collection('dispositivos').doc(disp.id_dispositivo.toString());
            // Agregar timestamp de Firebase
            disp.fecha_registro = firebase.firestore.FieldValue.serverTimestamp();
            disp.ultimo_uso = firebase.firestore.FieldValue.serverTimestamp();
            batch.set(ref, disp);
            batchCount++;
            
            if (batchCount === 500) {
                await batchCommit(batch, batchCount);
                batch = db.batch();
                batchCount = 0;
            }
        }

        // 5. Subir Registros
        setStatus("Migrando Registros de Asistencia...", 50, "Esto tomará unos momentos...");
        for (const reg of data.registros) {
            // Crear un ID único basado en empleadoId + timestamp para evitar duplicados si se corre 2 veces
            const uniqueId = `${reg.empleadoId}_${reg.timestamp.replace(/[^a-zA-Z0-9]/g, '')}`;
            const ref = db.collection('registros').doc(uniqueId);
            
            // Convertir string ISO a Timestamp real de Firebase
            if (reg.timestamp) {
                reg.timestamp = firebase.firestore.Timestamp.fromDate(new Date(reg.timestamp));
            } else {
                reg.timestamp = firebase.firestore.FieldValue.serverTimestamp();
            }
            
            batch.set(ref, reg);
            batchCount++;
            
            if (batchCount === 500) {
                await batchCommit(batch, batchCount);
                batch = db.batch();
                batchCount = 0;
            }
        }

        // Commitear últimos restos
        // 6. Subir Configuración
        if (data.configuracion) {
            setStatus("Migrando Configuración...", 95, "Sincronizando parámetros globales...");
            await db.collection('configuracion').doc('sistema').set({
                valor: data.configuracion,
                fecha_actualizacion: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        setStatus("¡Migración Completada con Éxito!", 100, "La base de datos está lista para usar Firebase");
        setTimeout(() => {
            alert("Migración exitosa. La aplicación ahora está lista para usar Firebase como motor principal.");
            overlay.remove();
        }, 2000);

    } catch (e) {
        console.error(e);
        setStatus("❌ Error en la migración", 100, e.message);
        document.getElementById('mig-progress').classList.add('bg-danger');
        document.getElementById('mig-progress').classList.remove('bg-primary', 'progress-bar-animated');
        
        const btnClose = document.createElement('button');
        btnClose.className = "btn btn-light mt-4";
        btnClose.innerText = "Cerrar";
        btnClose.onclick = () => overlay.remove();
        overlay.appendChild(btnClose);
    }
}
