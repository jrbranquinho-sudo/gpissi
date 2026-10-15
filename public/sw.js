// GPISSI Service Worker - Suporte a rastreamento, cache e sincronização em segundo plano
const CACHE_NAME = 'gpissi-v2-cache';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/novo.html',
  '/tracker.html',
  '/account.html',
  '/css/style.css',
  '/js/gps-utils.js',
  '/js/app.js',
  '/js/tracker.js',
  '/js/account.js',
  '/images/logosembg.png',
  '/images/caveirasembg.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Falha parcial ao pré-carregar cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Não interceptar chamadas de API, OSRM, mapas ou telemetria
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('router.project-osrm.org') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('openfreemap.org') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// Suporte a mensagens do cliente para manter o worker acordado
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PING_TRACKER') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'PONG_TRACKER', timestamp: Date.now() });
    }
  }
});
