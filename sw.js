// Service Worker fuer App-Shell und Gateway-Dashboard: cached statische
// UI-Dateien, laesst Gateway-API-Routen aber immer am Cache vorbei.
const CACHE_NAME = 'egomorph-core-v38';
const URLS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'style.css',
  'load-screen.css',
  'loader.js',
  'skills/internetSkill.js',
  'skills/internet/manifest.json',
  'skills/extendedFileSkill.js',
  'skills/extended-files/manifest.json',
  'skills/learnWithEgomorphSkill.js',
  'skills/learn-with-egomorph/manifest.json',
  'skillSystem.js',
  'agentResponse.js',
  'conversationStore.js',
  'resourceProfile.js',
  'app.js',
  'Safetyfilter.js',
  'chatModel.js',
  'ltmManager.js',
  'translations/de.js',
  'translations/en.js',
  'translations/fr.js',
  'Writer.js',
  'ego_icon_192.png',
  'ego_icon_512.png',
  'egomorph-core.svg'
];

function isGatewayApiPath(pathname) {
  return pathname === '/health' ||
    pathname === '/gateway/status' ||
    pathname === '/codex/status' ||
    pathname.startsWith('/codex/') ||
    pathname === '/v1/models' ||
    pathname === '/v1/chat/completions' ||
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/egomorph/');
}

self.addEventListener('install', event => {
  event.waitUntil(
    self.registration.active
      ? Promise.resolve()
      : caches.open(CACHE_NAME)
        .then(cache => cache.addAll(URLS_TO_CACHE))
        .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'DOWNLOAD_UPDATE') return;

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => Response.error()));
    return;
  }

  if (isGatewayApiPath(requestUrl.pathname)) {
    event.respondWith(fetch(event.request).catch(() => Response.error()));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request).then(networkResponse => {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return networkResponse;
      }).catch(() => Response.error()))
  );
});
