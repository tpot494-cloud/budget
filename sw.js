// sw.js — keeps a copy of the app on the phone so it opens without internet.
// IMPORTANT: when you upload a new version of any file, VERSION must change too
// (I'll do this for you in each update). That's how the phone knows to refresh.

const VERSION = 'v1.2.0';
const CACHE = 'budget-' + VERSION;
const FILES = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'store.js',
  'calc.js',
  'ui.js',
  'views-home.js',
  'views-spending.js',
  'views-bills.js',
  'views-setup.js',
  'views-debt.js',
  'calc-debt.js',
  'views-savings.js',
  'manifest.webmanifest',
  'manrope.woff2',
  'space-grotesk.woff2',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's own short-term cache, so an update never
  // mixes new and old files.
  event.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('budget-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve the app from the phone first; fall back to the network for anything not cached.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
