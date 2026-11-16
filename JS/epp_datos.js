// Módulo EPP: capa de datos. VERSIÓN DE DEMOSTRACIÓN: guarda en este navegador, con colaboradores ficticios.
// Las pantallas solo usan estas funciones (todas async): para producción se reemplaza el interior, no las pantallas.
window.EppDatos = (() => {
  const CLAVE = 'EPP_DEMO_V2';
  const DIA = 86400000;
  const DIAS_LIMITE_FIRMA = 7;   // pasado este plazo la entrega se marca para seguimiento; sigue siendo válida

  const MATRIZ = window.EppMatriz || { catalogo: [], areas: [] };
  const CATALOGO = MATRIZ.catalogo;

  // Colaboradores ficticios; cada uno pertenece a una o más áreas de la matriz real
  const COLABORADORES = [
    { id: 'D01', nombre: 'Colaborador Demo Uno', area: 'MECANIZADO', cargo: 'OPERARIO', areas: ['mecanizado'] },
    { id: 'D02', nombre: 'Colaboradora Demo Dos', area: 'BODEGA', cargo: 'ESPECIALISTA BODEGA', areas: ['bodega'] },
    { id: 'D03', nombre: 'Colaborador Demo Tres', area: 'ENSAMBLE ELÉCTRICO', cargo: 'TÉCNICO', areas: ['ensamble_electrico'] },
    { id: 'D04', nombre: 'Colaboradora Demo Cuatro', area: 'INGENIERIA', cargo: 'INGENIERA', areas: ['ingenieria_calidad_lider_de_produccion'] },
    { id: 'D05', nombre: 'Colaborador Demo Cinco', area: 'TALLER PESADO', cargo: 'SOLDADOR', areas: ['taller_pesado_pulido', 'pintura'] }
  ];

  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  // Despacha quien tiene cargo de bodega, aunque figure en otra área; el área BODEGA sola no basta
  const esBodega = c => normal(c.cargo).includes('BODEGA');

  // Áreas y puestos de la persona, con su EPP y la cadencia de reposición de cada uno
  const puestosDe = c => MATRIZ.areas.filter(a => (c.areas || []).includes(a.id)).map(a => ({
    id: a.id, nombre: a.nombre,
    puestos: a.puestos.map((p, i) => ({ id: `${a.id}-${i + 1}`, nombre: p.nombre, actividad: p.actividad,
      epp: p.epp.map(e => ({ eppId: e.eppId, tipo: e.tipo, dias: e.duracionDias, texto: e.duracionTexto, riesgo: e.riesgo, obs: e.obs })) }))
  }));

  const MOTIVOS = ['Primera entrega', 'Reposición por desgaste', 'Reposición por daño', 'Pérdida'];
  const hace = dias => new Date(Date.now() - dias * DIA).toISOString();

  function inicial() {
    const stock = {};
    CATALOGO.forEach((e, i) => e.tallas.forEach((t, j) => { stock[`${e.id}|${t}`] = { cant: (i * 7 + j * 5) % 24, min: 4 }; }));
    Object.assign(stock, { 'guantes_anticorte|L': { cant: 2, min: 6 }, 'botas_dielectricas|42': { cant: 0, min: 2 }, 'casco|Única': { cant: 18, min: 5 } });
    const linea = (eppId, talla, motivo = 'Primera entrega') => ({ eppId, talla, cant: 1, motivo });
    return {
      secuencia: 7, stock,
      movimientos: [],
      solicitudes: [
        { id: 'EPP-0001', empleadoId: 'D01', creada: hace(400), estado: 'CONFIRMADA', items: [linea('ropa_gabardina', 'M'), linea('botas_puntera', '41')], comentario: '', entregadaEn: hace(398), entregadaPor: 'Despachador de prueba', confirmadaEn: hace(398) },
        { id: 'EPP-0002', empleadoId: 'D01', creada: hace(100), estado: 'CONFIRMADA', items: [linea('guantes_anticorte', 'L')], comentario: '', entregadaEn: hace(99), entregadaPor: 'Despachador de prueba', confirmadaEn: hace(99) },
        { id: 'EPP-0003', empleadoId: 'D01', creada: hace(1), estado: 'PENDIENTE', items: [linea('auditiva', 'Única', 'Reposición por daño')], comentario: 'Se rompió el cordón.' },
        { id: 'EPP-0004', empleadoId: 'D02', creada: hace(2), estado: 'PREPARADA', items: [linea('casco', 'Única'), linea('guantes_anticorte', 'M')], comentario: '', preparadaEn: hace(1), preparadaPor: 'Despachador de prueba' },
        { id: 'EPP-0005', empleadoId: 'D03', creada: hace(0.2), estado: 'PENDIENTE', items: [linea('botas_dielectricas', '42', 'Reposición por desgaste'), linea('gafas', 'Única')], comentario: 'Se me despegó la suela.' },
        { id: 'EPP-0006', empleadoId: 'D02', creada: hace(5), estado: 'ENTREGADA', items: [linea('ropa_camisa', 'S')], comentario: '', entregadaEn: hace(3), entregadaPor: 'Despachador de prueba', recordatorios: [] },
        { id: 'EPP-0007', empleadoId: 'D03', creada: hace(12), estado: 'ENTREGADA', items: [linea('guantes_anticorte', 'L')], comentario: '', entregadaEn: hace(10), entregadaPor: 'Despachador de prueba', recordatorios: [hace(6), hace(2)] }
      ]
    };
  }

  function leer() {
    try { const d = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (d && d.solicitudes) return d; } catch (e) { }
    return guardar(inicial());
  }
  function guardar(db) { try { localStorage.setItem(CLAVE, JSON.stringify(db)); } catch (e) { } return db; }
  function buscar(db, id) {
    const s = db.solicitudes.find(x => x.id === id);
    if (!s) throw new Error('La solicitud ya no existe');
    return s;
  }
  function exigirEstado(s, ...estados) {
    if (!estados.includes(s.estado)) throw new Error('La solicitud cambió de estado. Actualiza la pantalla.');
  }
  const firmar = (s, firma, origen) => Object.assign(s, { estado: 'CONFIRMADA', confirmadaEn: new Date().toISOString(), firma, tieneFirma: true, firmaOrigen: origen });
  const exigirFirma = firma => { if (!String(firma || '').startsWith('data:image/png')) throw new Error('Falta la firma'); };
  const eppDe = id => CATALOGO.find(e => e.id === id) || { nombre: id, icono: 'fa-box', tallas: [], maxCant: 5 };

  // Cadencia de reposición (días) de un EPP según los puestos de la persona: la más corta de la matriz.
  // Lo que se cambia en una semana o menos es de uso diario: no se hace seguimiento de vigencia.
  const DIAS_USO_DIARIO = 7;
  function cadencia(areas, eppId) {
    const d = [];
    areas.forEach(a => a.puestos.forEach(p => p.epp.forEach(e => { if (e.eppId === eppId) d.push(e.dias); })));
    return d.length ? Math.min(...d) : 365;
  }

  // Fecha de reposición: entrega + cadencia; estado para mostrar en pantalla
  function vigencia(fechaIso, cadenciaDias) {
    if (cadenciaDias <= DIAS_USO_DIARIO) return { vence: null, dias: null, estado: 'USO_DIARIO' };
    const vence = new Date(new Date(fechaIso).getTime() + cadenciaDias * DIA);
    const dias = Math.ceil((vence - Date.now()) / DIA);
    const aviso = Math.min(30, Math.max(3, Math.round(cadenciaDias * 0.25)));
    return { vence: vence.toISOString(), dias, estado: dias < 0 ? 'VENCIDO' : dias <= aviso ? 'POR_VENCER' : 'VIGENTE' };
  }

  // Lo último entregado de cada EPP al colaborador, con su fecha de reposición
  function calcularMisEpp(solicitudes, empleadoId, areas) {
    const ultimos = {};
    solicitudes
      .filter(s => s.empleadoId === empleadoId && ['ENTREGADA', 'CONFIRMADA'].includes(s.estado))
      .sort((a, b) => a.entregadaEn.localeCompare(b.entregadaEn))
      .forEach(s => s.items.forEach(i => { ultimos[i.eppId] = { ...i, entregadaEn: s.entregadaEn, solicitud: s.id, confirmada: s.estado === 'CONFIRMADA' }; }));
    const orden = { VENCIDO: 0, POR_VENCER: 1, VIGENTE: 2, USO_DIARIO: 3 };
    return Object.values(ultimos).map(i => ({ ...i, cadencia: cadencia(areas, i.eppId), ...vigencia(i.entregadaEn, cadencia(areas, i.eppId)) }))
      .sort((a, b) => (orden[a.estado] - orden[b.estado]) || ((a.dias ?? 0) - (b.dias ?? 0)));
  }

  return {
    calcularMisEpp, CATALOGO, COLABORADORES, MOTIVOS, DIAS_LIMITE_FIRMA, eppDe, vigencia, cadencia, esBodega,
    puestosDe: id => puestosDe(COLABORADORES.find(c => c.id === id) || {}),

    // Días desde la entrega sin firma. Pasado el límite se marca para seguimiento: la entrega no se anula
    firmaPendiente(s) {
      const dias = Math.floor((Date.now() - new Date(s.entregadaEn)) / DIA);
      return { dias, vencida: dias >= DIAS_LIMITE_FIRMA };
    },
    colaborador: id => COLABORADORES.find(c => c.id === id) || { id, nombre: id, area: '', cargo: '' },

    async datos() { return leer(); },

    async misEpp(empleadoId) { return calcularMisEpp(leer().solicitudes, empleadoId, puestosDe(this.colaborador(empleadoId))); },
    async verFirma(id) { return buscar(leer(), id).firma; },

    async crearSolicitud(empleadoId, items, comentario) {
      if (!items.length) throw new Error('Agrega al menos un EPP');
      const permitidos = new Set(puestosDe(this.colaborador(empleadoId)).flatMap(a => a.puestos.flatMap(p => p.epp.map(e => e.eppId))));
      if (items.some(i => !permitidos.has(i.eppId))) throw new Error('Hay un EPP que no corresponde a tu puesto');
      const db = leer();
      db.secuencia += 1;
      const s = { id: `EPP-${String(db.secuencia).padStart(4, '0')}`, empleadoId, creada: new Date().toISOString(), estado: 'PENDIENTE', items, comentario: String(comentario || '').slice(0, 300) };
      db.solicitudes.push(s);
      guardar(db);
      return s;
    },

    async cancelar(id, empleadoId) {
      const db = leer(), s = buscar(db, id);
      if (s.empleadoId !== empleadoId) throw new Error('Esta solicitud no es tuya');
      exigirEstado(s, 'PENDIENTE');
      s.estado = 'CANCELADA';
      s.canceladaEn = new Date().toISOString();
      guardar(db);
    },

    async preparar(id, quien) {
      const db = leer(), s = buscar(db, id);
      exigirEstado(s, 'PENDIENTE');
      Object.assign(s, { estado: 'PREPARADA', preparadaEn: new Date().toISOString(), preparadaPor: quien });
      guardar(db);
    },

    async rechazar(id, quien, motivo) {
      if (!String(motivo || '').trim()) throw new Error('Indica el motivo');
      const db = leer(), s = buscar(db, id);
      exigirEstado(s, 'PENDIENTE', 'PREPARADA');
      Object.assign(s, { estado: 'RECHAZADA', rechazadaEn: new Date().toISOString(), rechazadaPor: quien, motivoRechazo: String(motivo).trim().slice(0, 300) });
      guardar(db);
    },

    // El stock baja al entregar; si falta algo no se entrega nada.
    // Con firma queda cerrada y esa misma firma cubre las entregas anteriores sin firmar de la persona (pendientes).
    async entregar(id, quien, firma, pendientes = []) {
      const db = leer(), s = buscar(db, id);
      exigirEstado(s, 'PREPARADA');
      const falta = s.items.filter(i => ((db.stock[`${i.eppId}|${i.talla}`] || {}).cant || 0) < i.cant);
      if (falta.length) throw new Error(`Sin stock: ${falta.map(i => `${eppDe(i.eppId).nombre} (${i.talla})`).join(', ')}`);
      const ahora = new Date().toISOString();
      s.items.forEach(i => {
        db.stock[`${i.eppId}|${i.talla}`].cant -= i.cant;
        db.movimientos.push({ en: ahora, clave: `${i.eppId}|${i.talla}`, delta: -i.cant, quien, nota: s.id });
      });
      Object.assign(s, { estado: 'ENTREGADA', entregadaEn: ahora, entregadaPor: quien, recordatorios: [] });
      if (firma) {
        exigirFirma(firma);
        [s, ...pendientes.map(p => buscar(db, p))].forEach(x => firmar(x, firma, 'BODEGA'));
      }
      guardar(db);
    },

    // El colaborador firma desde su app
    async confirmar(id, empleadoId, firma) {
      exigirFirma(firma);
      const db = leer(), s = buscar(db, id);
      if (s.empleadoId !== empleadoId) throw new Error('Esta entrega no es tuya');
      exigirEstado(s, 'ENTREGADA');
      firmar(s, firma, 'APP');
      guardar(db);
    },

    // El colaborador firma en la pantalla del despachador una entrega que quedó pendiente
    async firmarEnBodega(ids, firma) {
      exigirFirma(firma);
      const db = leer();
      ids.forEach(id => { const s = buscar(db, id); exigirEstado(s, 'ENTREGADA'); firmar(s, firma, 'BODEGA'); });
      guardar(db);
    },

    // Una vez al día por entrega. Hoy solo queda anotado: el envío por WhatsApp se conecta después
    async recordar(id) {
      const db = leer(), s = buscar(db, id);
      exigirEstado(s, 'ENTREGADA');
      s.recordatorios = s.recordatorios || [];
      const hoy = new Date().toDateString();
      if (s.recordatorios.some(r => new Date(r).toDateString() === hoy)) throw new Error('Ya se recordó hoy');
      s.recordatorios.push(new Date().toISOString());
      guardar(db);
    },

    async ingresarStock(clave, cantidad, quien) {
      const n = parseInt(cantidad, 10);
      if (!Number.isInteger(n) || n <= 0) throw new Error('Indica una cantidad mayor a 0');
      const db = leer();
      if (!db.stock[clave]) throw new Error('Artículo no encontrado');
      db.stock[clave].cant += n;
      db.movimientos.push({ en: new Date().toISOString(), clave, delta: n, quien, nota: 'Ingreso' });
      guardar(db);
    },

    reiniciar() { try { localStorage.removeItem(CLAVE); } catch (e) { } },

    // Avisa cuando la otra página cambia los datos
    alCambiar(fn) { window.addEventListener('storage', e => { if (e.key === CLAVE || e.key === null) fn(); }); }
  };
})();
