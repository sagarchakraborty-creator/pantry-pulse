// Pantry Pulse service worker: offline app shell, background low-stock check, notification taps.
// Bump VERSION on every release, or phones keep the old copy.
const VERSION = '2026-10-20.1';
const SHELL = `pantry-shell-${VERSION}`;
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'icons/badge-96.png'];

// The first install takes over at once; later versions wait until the user taps "Refresh" in the update bar.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => { if (!self.registration.active) self.skipWaiting(); }));
});
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pantry-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first so updates arrive, cache when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com');
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});

// Android Chrome runs this roughly once or twice a day for an installed app.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'pantry-check') e.waitUntil(backgroundCheck());
});
async function backgroundCheck() {
  const c = await caches.open('pantry-state');
  const res = await c.match('state.json');
  if (!res) return;
  const s = await res.json();
  const names = [...s.low, ...s.soon];
  if (names.length) {
    const days = Math.round((new Date(s.refillDate) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : s.refillDay;
    await self.registration.showNotification(`${s.count} item${s.count === 1 ? '' : 's'} to refill ${when}`, {
      body: names.slice(0, 6).join(', '), tag: 'refill', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
    });
  } else if (s.stale) {
    await self.registration.showNotification('Time for a stock check', {
      body: `${s.stale} item${s.stale === 1 ? '' : 's'} not updated in ${s.checkEvery}+ days.`, tag: 'check', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
    });
  }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});
