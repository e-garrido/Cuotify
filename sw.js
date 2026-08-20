'use strict';

/* =====================================================================
   Estrategia por tipo de recurso.

   El SW anterior era cache-first para TODO: quien tuviera la PWA
   instalada se quedaba congelado en la versión cacheada hasta que
   alguien se acordara de subir a mano el número de CACHE. Ahora el
   código de la app se pide siempre a la red primero (con la caché como
   red de seguridad offline) y solo los iconos, que no cambian, siguen
   sirviéndose desde caché.
   ===================================================================== */

const VERSION = 'v9';
const CACHE = `cuotify-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/calc.js',
  './js/state.js',
  './js/ui.js',
  './js/render.js',
  './manifest.webmanifest',
  './icons/logo.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

/* El código de la app: siempre red primero */
const esAppShell = (url) =>
  url.pathname.endsWith('.html') ||
  url.pathname.endsWith('.js') ||
  url.pathname.endsWith('.css') ||
  url.pathname.endsWith('.webmanifest') ||
  url.pathname.endsWith('/');

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // Un asset que falle no puede tumbar toda la instalación
      Promise.allSettled(ASSETS.map((a) => c.add(a)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* La página pide el relevo cuando el usuario acepta actualizar */
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || esAppShell(url)) {
    e.respondWith(redPrimero(req));
  } else {
    e.respondWith(cachePrimero(req));
  }
});

async function redPrimero(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // El fallback a index.html solo tiene sentido en una navegación:
    // devolver HTML por una imagen rota no ayuda a nadie.
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function cachePrimero(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}
