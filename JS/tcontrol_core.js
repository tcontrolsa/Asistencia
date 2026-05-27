/**
 * TCONTROL 2026 - Core & Configuration
 * Centraliza el objeto de configuración maestro, fallbacks y utilidades globales.
 */

// ========== CONFIGURACIÓN GLOBAL MAESTRA (FUENTE ÚNICA DE VERDAD) ==========
window.TCONTROL_CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec',
    ADMIN_ID: "1058",
    LAT_EMPRESA: -0.1288771313385675,
    LNG_EMPRESA: -78.47896772889067,
    RADIO_METROS: 250,
    HORA_LIMITE_ALMUERZO: "09:30",
    HORA_INICIO_ESPERADA: "07:30", // Homologado
    HORA_ENTRADA_LIMITE: "07:45",  // Homologado
    HORA_SALIDA: "16:15",          // Homologado
    ALMUERZO_ACTIVO: true,
    WHATSAPP_NUMBER: "593996356114",
    WHATSAPP_MESSAGE: "Hola, necesito soporte técnico para el sistema CONTROL 2026"
};

// ========== COMUNICACIÓN API (SIMPLIFICADA / FALLBACK GLOBAL) ==========
async function jsonpRequest(params) {
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return await window.FirebaseBackend.procesarAccion(params);
    }

    return new Promise((resolve) => {
        const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        window[callback] = (data) => {
            delete window[callback];
            resolve(data);
        };
        const script = document.createElement('script');
        const query = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
        script.src = `${window.TCONTROL_CONFIG.API_URL}?${query}&callback=${callback}`;
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

// Formato de fecha estricto dd/mm/yyyy hh:mm:ss
function obtenerFechaHoraEstricta(dateObj = new Date()) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    const ss = String(dateObj.getSeconds()).padStart(2, '0');
    return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
}

// ========== PULL TO REFRESH ==========
document.addEventListener('DOMContentLoaded', () => {
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    
    const scrollContainer = document.querySelector('.main-content');
    if (!scrollContainer) {
        return;
    }

    let pptrIndicator = document.createElement('div');
    pptrIndicator.id = 'ptr-indicator';
    pptrIndicator.innerHTML = '<i class="fas fa-sync-alt" style="color:var(--red); font-size: 20px;"></i>';
    Object.assign(pptrIndicator.style, {
        position: 'fixed',
        top: '-60px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '40px',
        height: '40px',
        backgroundColor: 'white',
        borderRadius: '50%',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '10000',
        transition: 'top 0.2s ease, transform 0.2s ease'
    });
    document.body.appendChild(pptrIndicator);

    scrollContainer.addEventListener('touchstart', (e) => {
        if (scrollContainer.scrollTop <= 2) {
            startY = e.touches[0].clientY;
            currentY = startY;
            isPulling = true;
            pptrIndicator.style.transition = 'none';
        }
    }, { passive: true });

    scrollContainer.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        
        currentY = e.touches[0].clientY;
        let diff = currentY - startY;

        if (diff > 0 && scrollContainer.scrollTop <= 2) {
            if (e.cancelable) e.preventDefault();
            let pullDistance = Math.min(diff * 0.4, 90);
            pptrIndicator.style.top = `${-60 + pullDistance}px`;
            pptrIndicator.style.transform = `translateX(-50%) rotate(${pullDistance * 4}deg)`;
        } else if (diff < 0) {
            isPulling = false;
            pptrIndicator.style.transition = 'top 0.3s ease, transform 0.3s ease';
            pptrIndicator.style.top = '-60px';
        }
    }, { passive: false });

    scrollContainer.addEventListener('touchend', (e) => {
        if (!isPulling) return;
        isPulling = false;
        let diff = currentY - startY;
        if (diff > 100 && scrollContainer.scrollTop <= 2) {
            pptrIndicator.style.transition = 'top 0.3s ease, transform 0.3s ease';
            pptrIndicator.style.top = '20px';
            pptrIndicator.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--red); font-size: 20px;"></i>';
            setTimeout(() => {
                location.reload();
            }, 600);
        } else {
            pptrIndicator.style.transition = 'top 0.3s ease, transform 0.3s ease';
            pptrIndicator.style.top = '-60px';
        }
    });
});
