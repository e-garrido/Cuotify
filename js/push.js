'use strict';

import { proximosAvisos, diasConVencimiento } from './calc.js';
import { guardarAvisos, borrarAvisos } from './idb.js';

/* =====================================================================
   Avisos de vencimiento.

   Reparto de responsabilidades, a propósito:
   · Al servidor solo suben los DÍAS del mes con vencimiento ([5, 20]).
   · Los nombres e importes se quedan en IndexedDB, en tu dispositivo.
   · Cuando llega el push, el service worker lee IndexedDB y redacta el
     mensaje. El servidor nunca supo qué te iba a decir.
   ===================================================================== */

/* Rellena esto con la URL que te dé `wrangler deploy` */
export const SERVIDOR = 'https://cuotify-avisos.TU-SUBDOMINIO.workers.dev';

const VAPID_PUBLICA =
  'BHOTMXrcWfLiwn8qBviJnGruN3qM94lhZ-zorhkzFCiHU2pV2XAbZpOob-0Oia53gDaiczCXdmUUqSXxkPMUoi0';

const CLAVE_ID = 'cuotify.dispositivo';

export function soportado() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/* En iPhone el push SOLO existe si la app está en la pantalla de inicio */
export function instalada() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function configurado() {
  return !SERVIDOR.includes('TU-SUBDOMINIO');
}

function idDispositivo() {
  let id = localStorage.getItem(CLAVE_ID);
  if (!id) {
    id = 'd' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    localStorage.setItem(CLAVE_ID, id);
  }
  return id;
}

function aUint8(base64) {
  const s = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function suscripcionActual() {
  if (!soportado()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function estaActivo() {
  return Boolean(await suscripcionActual());
}

/* Activar: pide permiso, se suscribe y manda solo los días */
export async function activar(gastos) {
  if (!soportado()) return { ok: false, motivo: 'Este navegador no admite avisos' };
  if (!configurado()) return { ok: false, motivo: 'Falta configurar la URL del servidor' };

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, motivo: 'Permiso denegado' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aUint8(VAPID_PUBLICA),
    });
  }

  const r = await sincronizar(gastos, sub);
  if (!r.ok) return r;
  return { ok: true };
}

export async function desactivar() {
  const sub = await suscripcionActual();
  if (sub) await sub.unsubscribe();
  await borrarAvisos();
  try {
    await fetch(`${SERVIDOR}/baja`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idDispositivo() }),
    });
  } catch (e) {
    /* si el servidor no responde, la suscripción ya está anulada aquí */
  }
  return { ok: true };
}

/* Guarda la agenda en local y manda al servidor solo los días.
   Se llama en cada cambio de datos, para que el aviso no se desfase. */
export async function sincronizar(gastos, sub) {
  const suscripcion = sub || (await suscripcionActual());
  await guardarAvisos(proximosAvisos(gastos));
  if (!suscripcion || !configurado()) return { ok: true, local: true };

  const dias = diasConVencimiento(gastos);
  if (!dias.length) dias.push(1); // sin vencimientos, un recordatorio mensual

  try {
    const res = await fetch(`${SERVIDOR}/suscribir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: idDispositivo(),
        subscription: suscripcion.toJSON(),
        dias,
      }),
    });
    if (!res.ok) return { ok: false, motivo: `El servidor respondió ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: 'No se ha podido contactar con el servidor' };
  }
}
