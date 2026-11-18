# Guía de Permisos

Guía interactiva del módulo de Permisos (app y panel). Se publica como Artifact privado en claude.ai.

- `guia-permisos.html`: la página. Todo el texto está al inicio del primer `<script>`:
  `VISTAS` (pestañas), `PASOS` (paso a paso de cada rol), `VERSION`, `FECHA` y `CAMBIOS`.
  Las tablas, el flujo, las reglas y las preguntas frecuentes están en `TABLA_TIPOS`, `FLUJO`, `REGLAS` y `FAQ`.
- `img/`: capturas. Se tomaron en local (`python-http`, puerto 8001) con las fichas de prueba
  8001 (jefe) y 8002 (colaborador). En las capturas del panel se reemplazó el nombre real de TTHH por uno de ejemplo
  y las solicitudes pendientes de jefe/TTHH son de ejemplo (no existen en Firestore).

## Para actualizar

1. Cambia el texto en `PASOS` (o el bloque que corresponda) y, si hace falta, reemplaza la captura en `img/` con el mismo nombre.
2. Sube `VERSION`, cambia `FECHA` y agrega una línea en `CAMBIOS`.
3. Pide a Claude que vuelva a publicar la guía (mismo enlace).

No subir esta carpeta al repo si alguna captura muestra datos de personas reales (repo público).
