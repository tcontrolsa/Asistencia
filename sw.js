// =====================================================
// TCONTROL - Service Worker v1.0
// Estrategia: Network First para la app shell,
//             Cache Only como fallback offline
// =====================================================

const CACHE_NAME = 'tcontrol-v1.3';
const OFFLINE_URL = './offline.html';

// Recursos a pre-cachear en la instalación (app shell)
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './JS/firebase_backend.js',
  // CDNs críticos (Bootstrap, FontAwesome)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
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
        './icon-512.png'
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

// ===== ESTRATEGIA DE FETCH (DEBUG: NETWORK ONLY) =====
self.addEventListener('fetch', event => {
  // En este modo de depuración, simplemente dejamos que la red maneje todo.
  // Esto evita cualquier problema de caché en GitHub Pages.
  return; 
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
