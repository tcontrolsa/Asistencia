/**
 * TCONTROL · Página pública de verificación de la credencial de campo (verificar.html)
 *
 * El guardia del cliente llega aquí al escanear el QR del carné: ?c=<identificador>&t=<código de 30 s>.
 * La respuesta y la foto vienen del servidor (credencial_campo.gs), no del teléfono del colaborador.
 */
(function () {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycbxgmtQXWi-qDYyjT8kG6jsIEWZPbXXcHtLMaYqTlx2Allv7qkb9oe6ZGYt6lP6lCPZb/exec';
  const API_KEY = 'TCONTROL_SECURE_2026_XYZ'; // la misma clave pública que usa la PWA
  const TELEFONO = '(593-2) 280 4107';

  const app = document.getElementById('vcApp');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-EC', { hour12: false }); };

  const VEREDICTOS = {
    VALIDA: ['vc-ok', 'fa-circle-check', 'CREDENCIAL VÁLIDA', 'Colaborador activo de TCONTROL S.A. Compare la foto con la persona.'],
    VALIDA_FISICA: ['vc-ok', 'fa-circle-check', 'CREDENCIAL FÍSICA VÁLIDA', 'Colaborador activo de TCONTROL S.A. Este QR corresponde a la tarjeta impresa: si se lo muestran en un teléfono, pida la credencial de la app.'],
    QR_VENCIDO: ['vc-alerta', 'fa-clock-rotate-left', 'QR VENCIDO', 'El código tiene más de 30 segundos o es una captura. Pida al colaborador que abra la credencial en su app y vuelva a escanear.'],
    INACTIVO: ['vc-mal', 'fa-circle-xmark', 'CREDENCIAL NO VIGENTE', 'Esta credencial no corresponde a un colaborador activo de TCONTROL S.A. No autorice el ingreso.'],
    NO_VALIDA: ['vc-mal', 'fa-circle-xmark', 'CREDENCIAL NO VÁLIDA', 'Este código no fue emitido por TCONTROL S.A. No autorice el ingreso.']
  };

  function veredicto(clave) {
    const v = VEREDICTOS[clave] || VEREDICTOS.NO_VALIDA;
    return `<div class="vc-veredicto ${v[0]}" role="status"><i class="fas ${v[1]}" aria-hidden="true"></i><div><strong>${v[2]}</strong><span>${v[3]}</span></div></div>`;
  }

  function pintar(r) {
    const clave = r.estado === 'VALIDA' && r.tipo === 'fisica' ? 'VALIDA_FISICA' : r.estado;
    let html = veredicto(clave);
    if (r.estado === 'VALIDA' && r.persona) {
      const p = r.persona;
      const foto = p.foto_url
        ? `<img class="vc-foto" src="${esc(p.foto_url)}" alt="Foto registrada por TCONTROL" referrerpolicy="no-referrer">`
        : '<div class="vc-foto"><i class="fas fa-user"></i></div>';
      html += `
        <div class="vc-persona">${foto}<div><div class="vc-nombre">${esc(p.nombre)}</div><div class="vc-cargo">${esc(p.cargo)}</div></div></div>
        <dl class="vc-lista">
          <dt>Empresa</dt><dd>${esc(p.empresa)}</dd>
          ${p.area ? `<dt>Área</dt><dd>${esc(p.area)}</dd>` : ''}
          <dt>Cédula</dt><dd>${esc(p.cedula || '—')}</dd>
          <dt>ID de empleado</dt><dd>${esc(p.codigo)}</dd>
          <dt>Consulta</dt><dd>${esc(hora(r.consulta))}</dd>
        </dl>`;
    } else if (r.consulta) {
      html += `<dl class="vc-lista"><dt>Consulta</dt><dd>${esc(hora(r.consulta))}</dd></dl>`;
    }
    html += `<p class="vc-nota">La foto y los datos de esta página vienen del sistema de TCONTROL, no del teléfono del colaborador. Para confirmar por teléfono: <b>${TELEFONO}</b>.</p>`;
    app.innerHTML = `<div class="vc-card">${html}</div>`;
  }

  function error(msg) {
    app.innerHTML = `<div class="vc-card"><div class="vc-veredicto vc-alerta" role="alert"><i class="fas fa-wifi" aria-hidden="true"></i><div><strong>NO SE PUDO VERIFICAR</strong><span>${esc(msg)}</span></div></div>
      <button type="button" class="cc-btn" id="vcReintentar">Reintentar</button>
      <p class="vc-nota">También puede confirmar por teléfono: <b>${TELEFONO}</b>.</p></div>`;
    document.getElementById('vcReintentar').addEventListener('click', consultar);
  }

  async function consultar() {
    const q = new URLSearchParams(location.search);
    const c = (q.get('c') || '').trim().toLowerCase();
    const t = (q.get('t') || '').trim();
    if (!/^[0-9a-f]{20}$/.test(c)) return pintar({ estado: 'NO_VALIDA' });
    app.innerHTML = '<div class="vc-card vc-cargando"><i class="fas fa-spinner fa-spin"></i> Consultando a TCONTROL…</div>';
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ accion: 'credencialCampoVerificar', apiKey: API_KEY, c, t })
      });
      const r = await res.json();
      if (!r || !r.ok) return error((r && r.error) || 'Respuesta inesperada del servidor.');
      pintar(r);
    } catch (e) {
      error('Sin conexión con el servidor. Revise los datos móviles e intente de nuevo.');
    }
  }

  consultar();
})();
