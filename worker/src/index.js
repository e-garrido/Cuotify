/**
 * Cuotify — servidor de avisos
 *
 * Lo único que guarda de ti es tu suscripción push y los DÍAS del mes en
 * que tienes cuotas. Ni importes, ni nombres, ni cuánto debes: el mensaje
 * lo compone tu propio móvil leyendo su base de datos local.
 *
 * Rutas:
 *   POST /suscribir  { id, subscription, dias:[1..31] }
 *   POST /baja       { id }
 *   GET  /salud
 * Y un cron diario que envía el toque a quien le toque hoy.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/salud') return json({ ok: true });

    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let cuerpo;
    try {
      cuerpo = await req.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    if (url.pathname === '/suscribir') return suscribir(cuerpo, env);
    if (url.pathname === '/baja') return baja(cuerpo, env);
    return json({ error: 'No encontrado' }, 404);
  },

  async scheduled(evento, env, ctx) {
    ctx.waitUntil(avisarHoy(env));
  },
};

/* ---------------------------------------------------------------- */

function idValido(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

async function suscribir(cuerpo, env) {
  const { id, subscription, dias } = cuerpo || {};

  if (!idValido(id)) return json({ error: 'id inválido' }, 400);
  if (!subscription?.endpoint?.startsWith('https://')) {
    return json({ error: 'suscripción inválida' }, 400);
  }
  if (!Array.isArray(dias) || dias.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) {
    return json({ error: 'dias inválidos' }, 400);
  }

  const limpios = [...new Set(dias)].sort((a, b) => a - b);
  await env.SUSCRIPCIONES.put(
    `sub:${id}`,
    JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.keys || null,
      dias: limpios,
      actualizado: new Date().toISOString(),
    })
  );
  return json({ ok: true, dias: limpios.length });
}

async function baja(cuerpo, env) {
  const { id } = cuerpo || {};
  if (!idValido(id)) return json({ error: 'id inválido' }, 400);
  await env.SUSCRIPCIONES.delete(`sub:${id}`);
  return json({ ok: true });
}

/* ---------------- Envío diario ---------------- */

async function avisarHoy(env) {
  const hoy = new Date().getUTCDate();
  let cursor;
  let enviados = 0;

  do {
    const lista = await env.SUSCRIPCIONES.list({ prefix: 'sub:', cursor });
    cursor = lista.list_complete ? null : lista.cursor;

    for (const clave of lista.keys) {
      // Un fallo con una suscripcion no puede dejar sin aviso a las demas:
      // el cron solo pasa una vez al dia y no hay segunda oportunidad.
      try {
        const dato = await env.SUSCRIPCIONES.get(clave.name, 'json');
        if (!dato || !Array.isArray(dato.dias) || !dato.dias.includes(hoy)) continue;

        const estado = await enviarPush(dato.endpoint, env);
        // 404/410 = el navegador tiro la suscripcion: la borramos
        if (estado === 404 || estado === 410) {
          await env.SUSCRIPCIONES.delete(clave.name);
        } else if (estado >= 200 && estado < 300) {
          enviados++;
        }
      } catch (e) {
        console.log(`fallo con ${clave.name}: ${e.message}`);
      }
    }
  } while (cursor);

  console.log(`Día ${hoy}: ${enviados} avisos enviados`);
}

/* Push sin contenido: solo despierta al service worker, que ya compone
   el mensaje con los datos que nunca salieron del dispositivo. */
async function enviarPush(endpoint, env) {
  const jwt = await firmaVapid(endpoint, env);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Length': '0',
    },
  });
  if (!res.ok) console.log(`push ${res.status} en ${new URL(endpoint).host}`);
  return res.status;
}

/* ---------------- VAPID (JWT ES256) ---------------- */

const b64url = (buf) => {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const deB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let clavePrivada = null;

async function importaClave(env) {
  if (clavePrivada) return clavePrivada;
  // La pública en crudo es 0x04 || X(32) || Y(32)
  const cruda = deB64url(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(cruda.slice(1, 33)),
    y: b64url(cruda.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  clavePrivada = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  return clavePrivada;
}

async function firmaVapid(endpoint, env) {
  const clave = await importaClave(env);
  const cabecera = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT,
      })
    )
  );
  const firma = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    clave,
    new TextEncoder().encode(`${cabecera}.${cuerpo}`)
  );
  return `${cabecera}.${cuerpo}.${b64url(firma)}`;
}
