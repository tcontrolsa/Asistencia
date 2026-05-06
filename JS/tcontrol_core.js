/**
 * TCONTROL 2026 - Core & Configuration
 * Centraliza variables globales, configuración y utilidades básicas.
 */

// ========== CONFIGURACIÓN ==========
const API_URL = 'https://script.google.com/macros/s/AKfycbwpG1d9FoP6Iqszcf0xWNxgB-f-pduqWLkPYOQ7fhyDZ4m0MXIEoG_cqgMOXr9mUd9C/exec';
const ADMIN_ID = "1058";

// Valores por defecto (se sobrescriben con Firebase)
let LAT_EMPRESA = -0.1288771313385675;
let LNG_EMPRESA = -78.47896772889067;
let RADIO_METROS = 250;
let HORA_LIMITE_ALMUERZO = "09:30";
let HORA_INICIO_ESPERADA = "08:00";
let HORA_ENTRADA_LIMITE = "08:15";
let HORA_SALIDA = "16:15";
let ALMUERZO_ACTIVO = true;
let WHATSAPP_NUMBER = "593999999999";
let WHATSAPP_MESSAGE = "Hola, necesito soporte técnico para el sistema CONTROL 2026";

// ========== VARIABLES GLOBALES DE ESTADO ==========
let deviceToken = null;
let posicion = { lat: null, lng: null };
let currentMode = 'OFICINA';
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
    id: '', nombre: '', area: '', foto_url: '', cargo: '',
    baseLat: null, baseLng: null, authExtras: 'NO'
};

// Variables de UI/Formularios
let lugarSeleccionado = null;
let razonEntradaTardia = null;
let detalleRazonEntrada = null;
let razonSalidaTemprana = null;
let detalleRazonSalida = null;
let esPermisoIntermedio = false;
let razonPermiso = null;

// ========== COMUNICACIÓN API (SIMPLIFICADA) ==========
async function jsonpRequest(params) {
    // Si Firebase está activo, usamos el motor de Firebase directamente
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return await window.FirebaseBackend.procesarAccion(params);
    }

    // Fallback Legacy (GAS) - Solo si Firebase fallara
    return new Promise((resolve) => {
        const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        window[callback] = (data) => {
            delete window[callback];
            resolve(data);
        };
        const script = document.createElement('script');
        const query = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
        script.src = `${API_URL}?${query}&callback=${callback}`;
        document.head.appendChild(script);
        setTimeout(() => { if (script.parentNode) script.remove(); }, 10000);
    });
}

// ========== UTILIDADES DE FORMATO ==========
function formatearHora(fecha) {
    if (!fecha) return '--:--';
    try {
        const d = new Date(fecha);
        if (isNaN(d.getTime())) return '--:--';
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
        hours = hours % 12 || 12;
        return `${hours}:${minutes} ${ampm}`;
    } catch (e) { return '--:--'; }
}

function formatearFechaCorta() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function showLoading(show) {
    const loading = document.getElementById('loadingOverlay');
    if (loading) {
        if (show) loading.classList.remove('hidden');
        else loading.classList.add('hidden');
    }
}

function mostrarToast(msg, tipo = 'info') {
    if (navigator.vibrate) {
        if (tipo === 'success') navigator.vibrate(50);
        else if (tipo === 'error') navigator.vibrate([80, 40, 80]);
    }
    document.querySelectorAll('.custom-toast').forEach(t => t.remove());
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `custom-toast ${tipo}-toast`;
    toast.innerHTML = `<span class="toast-icon">${icons[tipo] || 'ℹ️'}</span><span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
