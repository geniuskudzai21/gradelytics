const CACHE_NAME = 'gradelytics-v2';
const RUNTIME_CACHE = 'gradelytics-runtime-v2';
const OFFLINE_URL = '/index.html';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/variables.css',
  '/css/landing.css',
  '/css/style.css',
  '/css/resp.css',
  '/css/auth.css',
  '/css/admin.css',
  '/images/logo.png',
  '/images/logo2.png',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png',
  '/images/icons/maskable-192.png',
  '/images/icons/maskable-512.png',
  '/pages/dashboard.html',
  '/pages/auth.html',
  '/pages/admin.html',
  '/pages/privacy.html',
  '/pages/terms.html',
  '/js/supabase-config.js',
  '/js/supabase.js',
  '/js/script.js',
  '/js/script2.js',
  '/js/admin.js',
  '/ai/ai-config.js',
  '/ai/ai-markdown.js',
  '/ai/ai-core.js',
  '/ai/ai-vision.js',
  '/ai/ai-prediction.js',
  '/ai/ai-chat.js',
  '/ai/ai-analytics.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirstCrossOrigin(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('You are offline.', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirstCrossOrigin(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('You are offline.', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || (await network);
}
