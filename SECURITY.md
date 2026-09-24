# Política de Seguridad — TCONTROL Asistencia

## 1. Cumplimiento Normativo y Privacidad
El sistema de control de asistencia de **TCONTROL S.A.** procesa datos laborales y biométricos bajo los principios de la **Ley Orgánica de Protección de Datos Personales (LOPDP - Ecuador)**.

- **Finalidad exclusiva:** La recopilación de coordenadas GPS, horarios y registros de asistencia tiene como fin único el cumplimiento del contrato y control de la jornada de trabajo.
- **Minimización de datos:** La ubicación satelital solo se registra al momento exacto de la marcación o durante turnos de campo expresamente configurados.
- **Protección de credenciales:** Ningún archivo de volcado o copia con datos personales (`firestore_empleados.json`, logs de WhatsApp) debe comprometerse en repositorios públicos.

## 2. Niveles de Acceso y Roles
- **EMPLEADO:** Acceso restringido exclusivamente a su credencial personal, solicitud de almuerzo y consulta de sus propias horas.
- **GUARDIA:** Terminal de garita con token de dispositivo único y clave de activación para registrar asistencias de terceros en planta.
- **SUPERVISOR:** Gestión de jornadas, autorizaciones de horas extras y justificaciones médicas/personales de su área asignada.
- **SUPERVISOR_ADMIN / ADMIN_MASTER:** Configuración central de geocercas, horarios corporativos y desvinculaciones.

## 3. Reporte Responsable de Vulnerabilidades
Si detectas alguna vulnerabilidad de seguridad o fuga de información en la plataforma:
- **Canal de reporte:** Notifica de inmediato al departamento de Tecnología y Sistemas de TCONTROL S.A.
- **Compromiso de respuesta:** Las alertas de seguridad serán evaluadas y remediadas en un plazo máximo de 24 horas laborables.
