// =====================================================
// TCONTROL - Service Worker v1.0
// Estrategia: Network First para la app shell,
//             Cache Only como fallback offline
// =====================================================

const CACHE_NAME = 'tcontrol-v1.20';
const OFFLINE_URL = './offline.html';

// Recursos a pre-cachear en la instalación (app shell)
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './CSS/index.css',
  './JS/index_core.js',
  './JS/firebase_backend.js',
  // CDNs críticos (Bootstrap, FontAwesome, Firebase SDKs)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore-compat.js'
];

// ===== INSTALACIÓN =====
self.addEventListener('install', event => {
  console.log('[SW] Instalando TCONTROL PWA...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-cacheando app shell');
      // Cachear recursos locales de forma obligatoria
      return cache.addAll([
        './index.html',
        './manifest.json',
        './icon-192.png',
        './icon-512.png',
        './CSS/index.css',
        './JS/index_core.js',
        './JS/firebase_backend.js'
      ]).then(() => {
        // Intentar cachear CDNs pero no fallar si no hay internet
        return Promise.allSettled(
          PRECACHE_URLS.slice(4).map(url =>
            cache.add(url).catch(e => console.warn('[SW] CDN no cacheado:', url))
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// ===== ACTIVACIÓN =====
self.addEventListener('activate', event => {
  console.log('[SW] Activando nueva versión...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== ESTRATEGIA DE FETCH =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── 0. Ignorar extensiones de Chrome y esquemas no soportados ──
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // ── 1. Solicitudes a la API de Google Apps Script ──
  // SIEMPRE network — los datos de asistencia deben ser en tiempo real
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleapis.com')) {
    // No interceptamos — el navegador maneja directamente (JSONP via script tags)
    return;
  }

  // ── 2. Solicitudes de script tags (JSONP) ──
  // Los script tags de JSONP no se pueden cachear útilmente
  if (event.request.destination === 'script' &&
      url.hostname.includes('google')) {
    return;
  }

  // ── 3. App Shell y recursos estáticos: Network First con fallback a caché ──
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Si la red responde bien, actualizar la caché
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Sin red: servir desde caché
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si es navegación a la app, servir el shell cacheado
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // Para otros recursos, retornar respuesta vacía
          return new Response('', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

// ===== MENSAJES DESDE LA APP =====
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
