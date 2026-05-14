const VERSION = 'v21';
const APP_SHELL = 'app-shell-' + VERSION;
const MAP_CACHE  = 'map-tiles-' + VERSION;
const API_CACHE  = 'api-' + VERSION;

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/firebase-init.js',
  '/js/auth.js',
  '/js/i18n.js',
  '/js/currency.js',
  '/js/weather.js',
  '/js/db.js',
  '/js/map.js',
  '/js/pages/dashboard.js',
  '/js/pages/itinerary.js',
  '/js/pages/accommodation.js',
  '/js/pages/activities.js',
  '/js/pages/expenses.js',
  '/js/pages/archive.js',
  '/js/mileage.js',
  '/js/imgbb.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: precache app shell ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: prune old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  const KEEP = [APP_SHELL, MAP_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route by resource type ────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and any Firebase/Google auth traffic
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('firebase.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;
  if (url.hostname.includes('accounts.google.com')) return;
  if (url.hostname.includes('firebaseapp.com')) return;

  // OSM map tiles → Cache First (long-lived)
  if (url.hostname.includes('openstreetmap.org') || url.hostname.includes('tile.')) {
    event.respondWith(cacheFirst(request, MAP_CACHE, 7 * 24 * 3600));
    return;
  }

  // Weather + currency APIs → Network First with fallback
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('er-api.com') ||
      url.hostname.includes('nominatim.openstreetmap.org')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Google Fonts → Cache First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, APP_SHELL));
    return;
  }

  // Firebase CDN (SDK) → Cache First
  if (url.hostname.includes('gstatic.com') || url.hostname.includes('firebasejs')) {
    event.respondWith(cacheFirst(request, APP_SHELL));
    return;
  }

  // App shell → Cache First, fallback to network
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, APP_SHELL));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
