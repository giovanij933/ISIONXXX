// The shell only: each app inside it keeps its own service worker and cache.
// Bump the version string whenever you change index.html so clients pick up the new shell.
const CACHE = 'isx-shell-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('isx-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for the shell's own files; anything else goes to the network untouched.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !new URL(e.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
      const fresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res }).catch(() => hit);
      return hit || fresh;
    })
  );
});
