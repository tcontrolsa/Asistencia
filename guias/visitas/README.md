# Guía de Visitas

Guía interactiva del módulo de Visitas: página del visitante, app del anfitrión, terminal de portería y panel.

- `guia-visitas.html`: la página. Todo el texto está al inicio del primer `<script>`:
  `VISTAS` (pestañas), `PASOS` (paso a paso de cada rol), `VERSION`, `FECHA` y `CAMBIOS`.
  Las tablas, el recorrido, las reglas y las preguntas frecuentes están en `TABLA_TIPOS`, `DOS_CAMINOS`, `FLUJO`, `REGLAS` y `FAQ`.
- `img/`: capturas (prefijo `v` visitante, `a` anfitrión, `g` portería, `p` panel). Se tomaron en local (`python-http`, puerto 8001)
  con **datos ficticios**: un script temporal respondía en el navegador en lugar de la base de visitas, así que no se creó,
  aprobó ni registró ninguna visita real. Los nombres (Carlos Ejemplo, Lucía Muestra, ANFITRIÓN DE EJEMPLO…) son inventados
  y los teléfonos aparecen como 09XXXXXXXX.

## Para actualizar

1. Cambia el texto en `PASOS` (o el bloque que corresponda) y, si hace falta, reemplaza la captura en `img/` con el mismo nombre.
2. Sube `VERSION`, cambia `FECHA` y agrega una línea en `CAMBIOS`.
3. Pide a Claude que vuelva a publicar la guía.

No subir capturas con datos de visitantes o colaboradores reales (repo público).
