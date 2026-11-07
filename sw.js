/*
 * Offline support. Strategy: network first (so new content shows up right after you deploy),
 * falling back to the cached copy when offline or when the network takes longer than 2.5s.
 * Bump VERSION if you ever need to force-clear old caches.
 */
const VERSION = 'v1';
const CACHE = 'doomscholar-' + VERSION;
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/storage.js', 'js/diagram.js', 'js/cards.js', 'js/app.js',
  'content/registry.js', 'content/manifest.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('doomscholar-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const fromCache = () => caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined));

    const timer = setTimeout(() => fromCache().then(finish), 2500);

    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        finish(res);
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => finish(hit || Response.error()));
      });
  });
}
