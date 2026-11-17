const CACHE_NAME = 'rapportini-offline-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  'https://jsdelivr.net',
  'https://jsdelivr.net',
  'https://cloudflare.com',
  'https://unpkg.com'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
