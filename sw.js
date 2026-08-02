// Offline shell.
//
// Every record this app draws is already in localStorage. Before this file the
// app still went blank without a signal, because the HTML, CSS and modules
// themselves came off the network. Now they do not, so Recoil opens and reads
// your whole history on a plane, in a lift, or on a dead connection.
//
// Lives at the root because a service worker can only control paths at or below
// its own, and this one has to control everything.

// Bump on release. A new value drops every old cache on activate, which is the
// whole cache-busting story: no stale module can outlive a deploy.
const VERSION = 'recoil-v2';

// The shell, not the data. Anything the app needs before it can render.
const SHELL = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/src/ui/styles.css',
  '/src/ui/charts.css',
  '/src/ui/app.js',
  '/src/ui/router.js',
  '/src/ui/pull.js',
  '/src/ui/settings.js',
  '/src/ui/screens-metric.js',
  '/src/ui/analysis.js',
  '/src/ui/charts.js',
  '/src/ui/chart-core.js',
  '/src/ui/charts-compare.js',
  '/src/ui/connect.js',
  '/src/ui/metrics.js',
  '/src/ui/voice.js',
  '/src/data/normalize.js',
  '/src/data/stats.js',
  '/src/data/sync.js',
  '/src/data/trends.js',
  '/src/data/activities.js',
  '/fonts/intertight-regular.woff2',
  '/fonts/jetbrainsmono-regular.woff2',
  '/icons/favicon.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, not addAll: one 404 on a renamed asset would otherwise
    // reject the whole install and leave the app with no offline support at
    // all, which is a worse failure than one missing file.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Whoop calls and the OAuth exchange must never be served from cache. A
  // stale token response or a stale day of records is worse than an error,
  // because the app would present it as current.
  if (url.pathname.startsWith('/.netlify/')) return;

  // Navigations: try the network so a deploy is picked up, fall back to the
  // cached shell. The app boots from localStorage either way.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: cache first, since it is all versioned or immutable.
  // Refresh in the background so the next load is current.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        caches.open(VERSION).then((c) => c.put(request, res.clone()));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
