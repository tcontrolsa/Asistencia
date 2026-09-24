# 🛡️ TCONTROL — Sistema de Gestión y Control Biométrico de Asistencia (2026)

Plataforma progresiva (PWA) de alta disponibilidad para el control de asistencia laboral, gestión de jornadas, geocercas satelitales, selección y control de catering/almuerzos, panel de supervisión en tiempo real y notificaciones automáticas vía WhatsApp.

---

## 🏗️ Arquitectura del Sistema

```
                      ┌────────────────────────────────────────┐
                      │   CLIENTES / NAVEGADORES (PWA)         │
                      │  index.html (Empleado)                 │
                      │  supervisor.html (Supervisor / RRHH)   │
                      │  guardia.html (Garita de Seguridad)    │
                      │  catering.html (Comedor / Proveedor)   │
                      └──────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│       FIREBASE FIRESTORE        │             │      GOOGLE APPS SCRIPT         │
│  (Motor de datos en tiempo real)│             │   (Motor de cálculos y Sheets)  │
│  - Colección: empleados         │             │  - Hoja: REGISTROS              │
│  - Colección: registros         │             │  - Hoja: EMPLEADOS              │
│  - Colección: dispositivos      │             │  - Hoja: VACACIONES             │
│  - Colección: configuracion     │             │  - Hoja: CALCULAR_vacaciones    │
│  - Colección: consumo_almuerzos │             │  - Hoja: ALMUERZOS_EXTRA        │
└─────────────────────────────────┘             └─────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     OPENWA WHATSAPP SERVICE     │
│  (iniciar_tunel.py / Cloudflare)│
│  - Notificaciones de retraso    │
│  - Avisos de ausencia y salida  │
│  - Alertas operativas           │
└─────────────────────────────────┘
```

---

## 📱 Módulos de la Aplicación

| Módulo | Archivo Principal | Script Core | Propósito |
|---|---|---|---|
| **App Empleado** | `index.html` | `JS/index_core.js` | Credencial digital, marcaciones con geocerca GPS, menú de almuerzos, trivia de cultura, consulta de rol de pagos. |
| **Panel Supervisor** | `supervisor.html` | `JS/supervisor_core.js` | Dashboard en vivo, aprobaciones, justificaciones médicas/personales, control de horas extras y exportación XLSX/PDF. |
| **Terminal Guardia** | `guardia.html` | `JS/guardia_core.js` | Marcación rápida por ID en garita para personal sin smartphone o eventuales. |
| **Terminal Catering** | `catering.html` | `JS/catering_core.js` | Conteo de raciones solicitadas (normal, dieta, vegetariano), registro de entregas. |
| **Ajustes Sistema** | `admin_config.html` | `JS/admin_config_core.js` | Parámetros de coordenadas centrales, radio en metros, horarios límites y modo mantenimiento (acceso protegido). |
| **Rastreo Satelital** | `ubicacion.html` | `JS/ubicacion_core.js` | Mapa satelital en vivo con Leaflet para seguimiento de personal en campo (acceso protegido). |
| **Simulador / Inspector** | `visor_empleado.html` | Embebido | Herramienta de pruebas para inspeccionar estados de credenciales (acceso administrativo). |
| **Diagnóstico** | `diagnostico.html` | `JS/diagnostico_core.js` | Validador de conectividad JSONP y Firestore. |

---

## ⚙️ Estructura de Directorios

```
Asistencia/
├── assets/                    # Recursos gráficos y multimedia
│   ├── icons/                 # Íconos PWA (192px, 512px)
│   ├── images/                # Logotipos corporativos y marcas oficiales
│   └── legacy_media/          # Animaciones y multimedia de respaldo
├── backend/                   # Lógica de servidor y scripts de Google Workspace
│   ├── apps_script/           # Automatizaciones en Google Apps Script
│   │   ├── api_completa.gs    # API REST de Sheets y sincronización
│   │   ├── archivador_diario.gs # Archivador de histórico (>60 días)
│   │   ├── autocompletar_salidas.gs # Regularización de marcaciones
│   │   ├── copiar_base.gs     # Sincronización entre libros
│   │   └── mantenimiento_registros.gs # Depuración y deduplicación
│   └── data/                  # Estructuras y plantillas de datos (ignorado en Git)
├── services/                  # Microservicios locales y puentes
│   └── whatsapp/              # Servicio de túnel Cloudflare y CORS bridge OpenWA
│       ├── iniciar_tunel.py
│       ├── whatsapp_cors_bridge.py
│       └── iniciar_tunel_whatsapp.bat
├── tools/                     # Scripts auxiliares y herramientas de desarrollo
│   └── scratch/               # Pruebas de estrés y scripts de verificación
├── CSS/                       # Hojas de estilo modulares
│   ├── index.css              # Estilos de la app de empleado PWA
│   ├── supervisor.css         # Estilos del panel de supervisión
│   ├── guardia.css            # Estilos del terminal de guardia
│   ├── catering.css           # Estilos del terminal de comedor
│   ├── admin_config.css       # Estilos de configuración
│   ├── ubicacion.css          # Estilos del mapa satelital
│   └── diagnostico.css        # Estilos de la herramienta de pruebas
├── JS/                        # Lógica de cliente y motores
│   ├── index_core.js          # Lógica central del empleado
│   ├── supervisor_core.js     # Lógica central de supervisión
│   ├── supervisor/            # Submódulos especializados del supervisor
│   │   ├── supervisor_cultura.js
│   │   ├── supervisor_directorio.js
│   │   ├── supervisor_emergencias.js
│   │   ├── supervisor_invitados.js
│   │   ├── supervisor_mapa.js
│   │   ├── supervisor_reportes_custom.js
│   │   └── supervisor_whatsapp.js
│   ├── firebase_backend.js    # Motor de abstracción y persistencia en Firestore
│   ├── openwa_service.js      # Servicio de mensajería y plantillas WhatsApp
│   ├── tcontrol_core.js       # Utilidades y configuración compartida
│   ├── config.js              # Endpoint canónico de Apps Script y parámetros globales
│   ├── guardia_core.js        # Lógica de garita
│   ├── catering_core.js       # Lógica de comedor
│   └── ubicacion_core.js      # Lógica del mapa GPS
├── firestore.rules            # Reglas de seguridad de Cloud Firestore
├── iniciar_tunel_whatsapp.bat # Lanzador de acceso directo para el túnel WhatsApp
├── sw.js                      # Service Worker de la PWA (Cache v1.82 - Stale-While-Revalidate)
├── offline.html               # Pantalla de contingencia sin conexión
└── manifest.json              # Configuración de instalación PWA
```

---

## 🔒 Buenas Prácticas de Seguridad y Privacidad (LOPDP)

1. **Aislamiento de Sesiones:** Cada módulo almacena su sesión en llaves dedicadas (`SUPERVISOR_SESSION`, `GUARDIA_SESSION`, `CATERING_SESSION`) evitando colisiones en dispositivos compartidos.
2. **Protección de Datos:** Las exportaciones con información sensible de empleados (`firestore_empleados.json`) están excluidas del control de versiones mediante `.gitignore`.
3. **Puntos de Configuración:** Los paneles de configuración y rastreo en vivo cuentan con guardianes de autenticación que impiden el acceso a visitantes no autorizados.
4. **Respaldo Histórico:** Los registros se conservan 60 días en Firestore para consulta inmediata antes de ser transferidos de forma segura a Google Sheets por el archivador diario.