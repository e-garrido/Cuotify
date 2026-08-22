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

const VERSION = 'v24';
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
  './js/idb.js',
  './js/push.js',
  './manifest.webmanifest',
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

/* =====================================================================
   Avisos de vencimiento

   El push llega SIN contenido: el servidor solo sabe que hoy te tocaba
   algo, no qué. El mensaje se compone aquí leyendo IndexedDB, así que
   los nombres e importes nunca han salido del dispositivo.
   ===================================================================== */

const BD = 'cuotify';
const ALMACEN = 'avisos';

function leerAvisos() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(BD, 1);
    } catch (e) {
      return resolve([]);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(ALMACEN, 'readonly');
        const get = tx.objectStore(ALMACEN).get('proximos');
        get.onsuccess = () => { resolve(get.result || []); db.close(); };
        get.onerror = () => { resolve([]); db.close(); };
      } catch (e) {
        resolve([]);
        db.close();
      }
    };
  });
}

/* Sin decimales cuando son cero: en una notificación se lee de un vistazo
   «444 €», y «444,00 €» solo añade ruido. Con céntimos sí se muestran. */
const euro = (v) => {
  const n = v || 0;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/* «30 de agosto» a partir de un ISO, montando la fecha por partes: con
   new Date('2026-08-30') el huso puede restarte un día. */
function fechaTexto(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' })
    .format(new Date(y, m - 1, d));
}

const suma = (lista) => lista.reduce((s, a) => s + (a.importe || 0), 0);

const cuotas = (n) => (n === 1 ? '1 cuota' : `${n} cuotas`);

/* El servidor solo sabe que hoy tocaba avisar. Todo lo que dice el mensaje
   sale de IndexedDB, así que aquí es donde hay que ser concreto: un aviso
   que no da una cifra obliga a abrir la app para saber si importa. */
function redactar(lista, hoy) {
  const deHoy = lista.filter((a) => a.fecha === hoy);
  const mes = hoy.slice(0, 7);
  const restoMes = lista.filter((a) => a.fecha > hoy && a.fecha.slice(0, 7) === mes);
  const siguiente = lista.find((a) => a.fecha > hoy);

  /* El total del mes cuenta lo de hoy: si vence una cuota hoy, sigue
     siendo una cuota de este mes. */
  const resumenMes = `Total cuotas este mes: ${euro(suma(deHoy) + suma(restoMes))}`;

  if (deHoy.length === 1) {
    const a = deHoy[0];
    return { titulo: `Hoy vence ${a.nombre}: ${euro(a.importe)}`, cuerpo: resumenMes };
  }
  if (deHoy.length > 1) {
    return {
      titulo: `Hoy vencen ${cuotas(deHoy.length)}: ${euro(suma(deHoy))}`,
      cuerpo: resumenMes,
    };
  }

  /* Sin vencimientos hoy. El aviso llega igual porque el día coincide con
     otro mes del plan, así que al menos que sirva de resumen. */
  if (restoMes.length) {
    const p = restoMes[0];
    return {
      titulo: resumenMes,
      cuerpo: `La próxima, ${p.nombre} el ${fechaTexto(p.fecha)}: ${euro(p.importe)}.`,
    };
  }
  if (siguiente) {
    return {
      titulo: 'Este mes ya lo tienes cubierto',
      cuerpo: `La próxima cuota es ${siguiente.nombre}, el ${fechaTexto(siguiente.fecha)}: ${euro(siguiente.importe)}.`,
    };
  }
  return { titulo: 'Sin cuotas pendientes', cuerpo: 'No tienes ningún vencimiento a la vista.' };
}


self.addEventListener('push', (e) => {
  // iOS cancela la suscripción si un push no muestra notificación,
  // así que esto SIEMPRE tiene que acabar en showNotification.
  e.waitUntil(
    (async () => {
      let lista = [];
      try {
        lista = await leerAvisos();
      } catch (err) {
        lista = [];
      }
      const { titulo, cuerpo } = redactar(lista, hoyISO());
      await self.registration.showNotification(titulo, {
        body: cuerpo,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: 'cuotify-vencimiento',
        renotify: true,
        data: { url: './' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of abiertas) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })()
  );
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
