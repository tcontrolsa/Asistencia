# Guía de EPP

Guía interactiva del módulo de EPP: Mis EPP (colaborador) y Despacho de EPP (bodega).

- `guia-epp.html`: la página. Todo el texto está al inicio del primer `<script>`:
  `VISTAS` (pestañas), `PASOS` (paso a paso de cada rol), `VERSION`, `FECHA` y `CAMBIOS`.
  Las tablas, el recorrido, las reglas y las preguntas frecuentes están en `TABLA_VIGENCIA`, `FLUJO`, `REGLAS` y `FAQ`.
- `img/`: capturas (prefijo `c` colaborador, `b` bodega). Se tomaron en local (`python-http`, puerto 8001)
  con el **modo de demostración** de las páginas (`epp.html?demo` y `epp_despacho.html?demo`, solo en localhost):
  guarda en el navegador, así que no se creó ni entregó ninguna solicitud real. Los nombres (Colaborador Demo Uno…)
  son ficticios y la pantalla de ingreso se capturó vacía.

## Para actualizar

1. Cambia el texto en `PASOS` (o el bloque que corresponda) y, si hace falta, reemplaza la captura en `img/` con el mismo nombre.
2. Sube `VERSION`, cambia `FECHA` y agrega una línea en `CAMBIOS`.
3. Pide a Claude que vuelva a publicar la guía.

Cuando el módulo se habilite, quita la nota «Mientras el módulo no se habilite…» del primer paso de cada rol.

No subir capturas con datos de colaboradores reales (repo público).
