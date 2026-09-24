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
    WHATSAPP_NUMBER: "593963561149",
    WHATSAPP_MESSAGE: "Hola, necesito soporte técnico para el sistema CONTROL 2026"
};

window.fixFotoUrl = window.formatearUrlFoto = function(url, size = 200) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();
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
        let fileId = '';
        if (url.includes('/file/d/')) {
            const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (m) fileId = m[1];
        } else if (url.includes('id=')) {
            const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
            if (m) fileId = m[1];
        } else if (url.includes('/d/')) {
            const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m) fileId = m[1];
        }
        if (fileId) {
            return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
        }
    }
    return url;
};

// ========== CRIPTOGRAFÍA Y SEGURIDAD ==========
async function hashPassword(str) {
    if (!str) return '';
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(str.toString().trim());
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        console.warn("Fallback hash:", e);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return 'h_' + Math.abs(hash).toString(16);
    }
}
window.hashPassword = hashPassword;

// ========== COMUNICACIÓN API (SIMPLIFICADA / FALLBACK GLOBAL) ==========
async function jsonpRequest(params) {
    if (window.USE_FIREBASE && window.FirebaseBackend) {
        return await window.FirebaseBackend.procesarAccion(params);
    }

    return new Promise((resolve) => {
        const callback = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        let settled = false;
        const script = document.createElement('script');

        const cleanup = () => {
            window[callback] = function() {};
            setTimeout(() => { delete window[callback]; }, 60000);
            if (script.parentNode) script.remove();
        };

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ error: 'Timeout de conexión' });
        }, 15000);

        window[callback] = (data) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cleanup();
            resolve(data);
        };

        const query = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
        script.src = `${window.TCONTROL_CONFIG.API_URL}?${query}&callback=${callback}`;
        script.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cleanup();
            resolve({ error: 'Error de red' });
        };
        document.head.appendChild(script);
    });
}

// ========== UTILIDADES DE FORMATO ==========
function formatearHora(valor, force24h = false) {
    if (!valor) return '--:--';
    try {
        let H = null;
        let M = null;

        if (valor instanceof Date) {
            if (!isNaN(valor.getTime())) {
                H = valor.getHours();
                M = valor.getMinutes();
            }
        } else if (typeof valor === 'object') {
            if (typeof valor.toDate === 'function') {
                const d = valor.toDate();
                if (!isNaN(d.getTime())) { H = d.getHours(); M = d.getMinutes(); }
            } else if (typeof valor.seconds === 'number') {
                const d = new Date(valor.seconds * 1000);
                if (!isNaN(d.getTime())) { H = d.getHours(); M = d.getMinutes(); }
            }
        } else if (typeof valor === 'string') {
            let s = valor.trim();
            const m12 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?$/i);
            if (m12 && m12[4]) {
                H = parseInt(m12[1], 10);
                M = parseInt(m12[2], 10);
                const isPm = /p/i.test(m12[4]);
                const isAm = /a/i.test(m12[4]);
                if (isPm && H < 12) H += 12;
                if (isAm && H === 12) H = 0;
            } else if (m12) {
                H = parseInt(m12[1], 10);
                M = parseInt(m12[2], 10);
            } else if (/^\d{4}-\d{2}-\d{2}T/.test(s) || s.includes('GMT') || s.includes('Z')) {
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    H = d.getHours();
                    M = d.getMinutes();
                }
            } else {
                const mDmy = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
                if (mDmy) {
                    H = parseInt(mDmy[1], 10);
                    M = parseInt(mDmy[2], 10);
                } else {
                    const d = new Date(s);
                    if (!isNaN(d.getTime())) {
                        H = d.getHours();
                        M = d.getMinutes();
                    }
                }
            }
        } else if (typeof valor === 'number') {
            if (valor > 1e11) {
                const d = new Date(valor);
                if (!isNaN(d.getTime())) { H = d.getHours(); M = d.getMinutes(); }
            }
        }

        if (H === null || M === null || isNaN(H) || isNaN(M)) return '--:--';

        if (force24h) {
            return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
        }

        const ampm = H >= 12 ? 'p. m.' : 'a. m.';
        let hours12 = H % 12;
        hours12 = hours12 ? hours12 : 12;
        const minutesStr = String(M).padStart(2, '0');
        return `${hours12}:${minutesStr} ${ampm}`;
    } catch (e) {
        return '--:--';
    }
}

function formatearHora24(valor) {
    return formatearHora(valor, true);
}

function obtenerMinutos(valor) {
    if (!valor) return null;
    if (typeof valor === 'object') {
        if (typeof valor.toDate === 'function') {
            let d = valor.toDate();
            return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
        }
        if (typeof valor.seconds === 'number') {
            let d = new Date(valor.seconds * 1000);
            return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
        }
        if (typeof valor._seconds === 'number') {
            let d = new Date(valor._seconds * 1000);
            return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
        }
        if (valor instanceof Date) return !isNaN(valor.getTime()) ? valor.getHours() * 60 + valor.getMinutes() : null;
    }
    if (typeof valor === 'number') {
        if (valor > 0 && valor < 1) {
            let s = Math.round(valor * 86400);
            return Math.floor(s / 3600) * 60 + Math.floor((s % 3600) / 60);
        }
        if (valor > 1e11) {
            let d = new Date(valor);
            if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
        }
        return null;
    }
    if (typeof valor === 'string') {
        let s = valor.trim();
        if (/^\d{4}-\d{2}-\d{2}T/.test(s) || s.includes('GMT') || s.includes('Z')) {
            let d = new Date(s);
            if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
        }
        const ampmMatch = s.match(/(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)/i);
        let m12 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (m12) {
            let h = parseInt(m12[1], 10);
            let m = parseInt(m12[2], 10);
            if (ampmMatch) {
                const isPm = /p/i.test(ampmMatch[1]);
                const isAm = /a/i.test(ampmMatch[1]);
                if (isPm && h < 12) h += 12;
                if (isAm && h === 12) h = 0;
            }
            return h * 60 + m;
        }
        let d = new Date(s);
        if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
        let m = s.match(/(\d{1,2}):(\d{2})/);
        if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    return null;
}

// Formato de fecha estricto dd/mm/yyyy hh:mm:ss
function obtenerFechaHoraEstricta(dateObj = new Date()) {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    const ss = String(dateObj.getSeconds()).padStart(2, '0');
    return `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
}

// ========== PULL TO REFRESH ==========
document.addEventListener('DOMContentLoaded', () => {
    // Desactivar en la vista del supervisor
    if (window.location.pathname.includes('supervisor') || document.getElementById('btnMobileMenu')) {
        return;
    }

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

// ========== FUNCIONES DE DISTANCIA GLOBAL Y UTILIDADES DE FECHA / SEGURIDAD ==========
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseFechaLocalStr(fStr) {
    if (!fStr) return null;
    const parts = String(fStr).trim().split('-');
    if (parts.length < 3) return null;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    return isNaN(d.getTime()) ? null : d;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

function normalizarFechaStr(fecha) {
    if (!fecha) return '';
    if (fecha instanceof Date && !isNaN(fecha.getTime())) {
        const y = fecha.getFullYear();
        const m = String(fecha.getMonth() + 1).padStart(2, '0');
        const d = String(fecha.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
        const parts = s.split(/[-/]/);
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return s;
}
window.normalizarFechaStr = normalizarFechaStr;

function generarDeviceToken(prefix = 'DEV') {
    return prefix + '_' + Math.random().toString(36).substr(2, 9).toUpperCase();
}
window.generarDeviceToken = generarDeviceToken;

// ========== MÓDULO LEGAL Y PROTECCIÓN DE DATOS PERSONALES (LOPDP ECUADOR) ==========
window.TCONTROL_LEGAL = {
    EMPRESA: "TCONTROL S.A.",
    NORMATIVA: "Ley Orgánica de Protección de Datos Personales (LOPDP) - Registro Oficial Suplemento 459 (República del Ecuador)",
    FECHA_VIGENCIA: "2026",
    FINALIDAD: "Control biométrico de asistencia, cumplimiento de jornada laboral, gestión de descansos y horas extraordinarias conforme al Código del Trabajo y la LOPDP.",
    
    // Descargo corto para pies de página, login y credenciales
    AVISO_CORTO: "TCONTROL S.A. trata sus datos personales, biométricos y de ubicación en estricto cumplimiento de la Ley Orgánica de Protección de Datos Personales (LOPDP Ecuador), exclusivamente para la gestión y control de la jornada laboral.",
    
    // Descargo específico para marcación con foto y GPS
    AVISO_MARCACION: "La fotografía y las coordenadas GPS se procesan única y exclusivamente al momento de la marcación para verificar identidad y presencia laboral dentro del perímetro autorizado (Arts. 7 y 25 LOPDP). No se realiza rastreo continuo.",
    
    // Descargo para archivo de desvinculaciones
    AVISO_DESVINCULACION: "El traslado de registros a la base de DESVINCULADOS se ampara en el Art. 21 de la LOPDP, Código del Trabajo y Ley de Seguridad Social, manteniéndose en custodia confidencial para fines exclusivos de auditorías patronales, tributarias y laborales durante el término de prescripción legal.",
    
    // Descargo para notificaciones de WhatsApp
    AVISO_WHATSAPP: "Aviso Legal: Mensaje automático institucional de TCONTROL S.A. emitido conforme a la LOPDP exclusivamente con fines de control y registro laboral."
};

/**
 * Abre el modal institucional con el aviso legal completo y descargos sobre protección de datos personales.
 */
window.abrirModalAvisoPrivacidad = function(seccion = 'general') {
    let modal = document.getElementById('modalAvisoPrivacidadTcontrol');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalAvisoPrivacidadTcontrol';
        modal.className = 'tcontrol-legal-modal-overlay';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.72); backdrop-filter:blur(4px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; animation:fadeIn 0.2s ease-out;';
        
        modal.innerHTML = `
            <div style="background:#ffffff; border-radius:20px; width:100%; max-width:680px; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); border:1px solid #e2e8f0; overflow:hidden; font-family:'Outfit',system-ui,-apple-system,sans-serif;">
                
                <!-- Encabezado del Modal -->
                <div style="padding:18px 24px; background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color:#ffffff; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:40px; height:40px; border-radius:10px; background:linear-gradient(135deg, #dc2626 0%, #ef4444 100%); display:flex; align-items:center; justify-content:center; font-size:18px; color:#ffffff; box-shadow:0 4px 12px rgba(220,38,38,0.35);">
                            <i class="fas fa-shield-halved"></i>
                        </div>
                        <div>
                            <h3 style="margin:0; font-size:16px; font-weight:800; letter-spacing:-0.2px; color:#ffffff;">Aviso Legal y Protección de Datos</h3>
                            <div style="font-size:11px; color:#94a3b8; margin-top:2px;">TCONTROL S.A. • Ley Orgánica de Protección de Datos Personales (Ecuador)</div>
                        </div>
                    </div>
                    <button type="button" onclick="window.cerrarModalAvisoPrivacidad()" aria-label="Cerrar" style="background:rgba(255,255,255,0.1); border:none; color:#cbd5e1; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:15px; transition:background 0.2s;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <!-- Barra de Certificación Normativa -->
                <div style="padding:8px 24px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:12px; flex-wrap:wrap; font-size:11px; font-weight:700; color:#475569; flex-shrink:0;">
                    <span style="display:inline-flex; align-items:center; gap:5px; color:#0369a1;"><i class="fas fa-gavel"></i> LOPDP Registro Oficial Sup. 459</span>
                    <span style="color:#cbd5e1;">•</span>
                    <span style="display:inline-flex; align-items:center; gap:5px; color:#15803d;"><i class="fas fa-briefcase"></i> Código del Trabajo</span>
                    <span style="color:#cbd5e1;">•</span>
                    <span style="display:inline-flex; align-items:center; gap:5px; color:#7c3aed;"><i class="fas fa-lock"></i> Uso Exclusivamente Laboral</span>
                </div>

                <!-- Cuerpo con scroll -->
                <div style="padding:20px 24px; overflow-y:auto; font-size:12.5px; line-height:1.6; color:#334155; display:flex; flex-direction:column; gap:16px;">
                    
                    <div style="background:#eff6ff; border-left:4px solid #3b82f6; padding:12px 16px; border-radius:8px; font-size:12px; color:#1e40af;">
                        <strong>Declaración Institucional:</strong> TCONTROL S.A. garantiza la confidencialidad, integridad y uso estrictamente laboral de los datos personales de sus colaboradores, contratistas y usuarios, en estricto acatamiento a los principios de <em>Juridicidad, Finalidad, Proporcionalidad y Seguridad</em> establecidos en la legislación ecuatoriana.
                    </div>

                    <!-- Cláusula 1 -->
                    <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; background:#ffffff;">
                        <h4 style="margin:0 0 8px; font-size:13px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <span style="width:22px; height:22px; border-radius:6px; background:#dbeafe; color:#1d4ed8; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">1</span>
                            Responsable del Tratamiento y Finalidad
                        </h4>
                        <p style="margin:0; font-size:12px; color:#475569;">
                            El responsable del tratamiento de los datos es <strong>TCONTROL S.A.</strong>, domiciliada en la ciudad de Quito, Ecuador. Los datos personales recabados (nombres, cédula/ID, área, cargo, teléfono institucional, correos y registros de tiempo) son tratados de forma legítima bajo el Art. 7 (numerales 2 y 8) de la LOPDP para el cumplimiento del contrato individual de trabajo, verificación de jornada laboral ordinaria y suplementaria, cálculo de haberes y presentación de informes ante el Ministerio del Trabajo y el IESS.
                        </p>
                    </div>

                    <!-- Cláusula 2 -->
                    <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; background:#ffffff;">
                        <h4 style="margin:0 0 8px; font-size:13px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <span style="width:22px; height:22px; border-radius:6px; background:#fef3c7; color:#b45309; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">2</span>
                            Tratamiento de Datos Biométricos (Fotografía / Selfie)
                        </h4>
                        <p style="margin:0; font-size:12px; color:#475569;">
                            De conformidad con el Artículo 25 de la LOPDP relativo al tratamiento de categorías especiales de datos (datos biométricos sensibles), la captura o verificación de fotografía se efectúa con la exclusiva finalidad de autenticar la identidad del titular en el momento exacto del registro presencial y evitar la suplantación de identidad. <strong>TCONTROL S.A. no comercializa, no cede ni somete estos datos a algoritmos de perfilamiento con fines ajenos a la relación de trabajo.</strong>
                        </p>
                    </div>

                    <!-- Cláusula 3 -->
                    <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; background:#ffffff;">
                        <h4 style="margin:0 0 8px; font-size:13px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <span style="width:22px; height:22px; border-radius:6px; background:#dcfce7; color:#15803d; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">3</span>
                            Geolocalización GPS Puntual (Sin Rastreo Continuo)
                        </h4>
                        <p style="margin:0; font-size:12px; color:#475569;">
                            Las coordenadas de latitud y longitud son leídas <em>únicamente en el segundo preciso en que el colaborador presiona el botón de marcación</em> (entrada, salida o retorno de campo) para validar que se encuentre dentro del radio de la empresa o en el perímetro del proyecto asignado. <strong>El sistema NO efectúa rastreo continuo, ni monitorea los desplazamientos del colaborador en tiempo real, ni recopila ubicaciones fuera del acto voluntario de registro.</strong>
                        </p>
                    </div>

                    <!-- Cláusula 4 -->
                    <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; background:#ffffff;">
                        <h4 style="margin:0 0 8px; font-size:13px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <span style="width:22px; height:22px; border-radius:6px; background:#f3e8ff; color:#7e22ce; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">4</span>
                            Conservación de Datos y Módulo de Desvinculaciones
                        </h4>
                        <p style="margin:0; font-size:12px; color:#475569;">
                            Al concluir la relación laboral por cualquier causa, los datos personales e históricos de marcaciones, saldos de vacaciones y liquidaciones del colaborador son trasladados de las bases operativas activas al archivo pasivo de <strong>"DESVINCULADOS"</strong>. Esta custodia se realiza amparada en el Artículo 21 de la LOPDP para satisfacer exigencias de auditoría patronal, fiscal (SRI), previsional (IESS) y defensa jurídica por el plazo de prescripción legal contemplado en las leyes de la República del Ecuador.
                        </p>
                    </div>

                    <!-- Cláusula 5 -->
                    <div style="border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; background:#ffffff;">
                        <h4 style="margin:0 0 8px; font-size:13px; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <span style="width:22px; height:22px; border-radius:6px; background:#fee2e2; color:#b91c1c; display:inline-flex; align-items:center; justify-content:center; font-size:11px;">5</span>
                            Derechos del Titular (Derechos ARCO)
                        </h4>
                        <p style="margin:0; font-size:12px; color:#475569;">
                            El titular de los datos personales podrá ejercer en cualquier momento sus derechos de <strong>Acceso, Rectificación, Actualización, Eliminación y Oposición</strong> contemplados en la LOPDP mediante comunicación dirigida al departamento de Talento Humano o a través de los canales institucionales de TCONTROL S.A., salvaguardando los límites temporales que la ley laboral y tributaria obligue a conservar.
                        </p>
                    </div>

                </div>

                <!-- Footer del Modal -->
                <div style="padding:14px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                    <span style="font-size:11px; color:#64748b;">
                        <i class="fas fa-lock" style="color:#0284c7;"></i> Tratamiento confidencial • TCONTROL 2026
                    </span>
                    <button type="button" onclick="window.cerrarModalAvisoPrivacidad()" style="padding:8px 20px; border-radius:10px; font-size:12px; font-weight:800; background:#0f172a; color:#ffffff; border:none; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                        Entendido y Aceptar
                    </button>
                </div>

            </div>
        `;
        document.body.appendChild(modal);

        // Cerrar al hacer clic en el fondo
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                window.cerrarModalAvisoPrivacidad();
            }
        });
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
};

/**
 * Cierra el modal institucional de aviso legal.
 */
window.cerrarModalAvisoPrivacidad = function() {
    const modal = document.getElementById('modalAvisoPrivacidadTcontrol');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
};
