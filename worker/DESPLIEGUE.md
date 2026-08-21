# Desplegar el servidor de avisos

Todo esto se hace **una sola vez**. Necesitas una cuenta gratuita en
Cloudflare (dash.cloudflare.com). El plan gratuito sobra: los cron no
cuestan nada y esto usa 1 petición al día.

## 1. Entrar en tu cuenta

    cd worker
    npx wrangler login

## 2. Crear el almacén donde se guardan las suscripciones

    npx wrangler kv namespace create SUSCRIPCIONES

Te devuelve un `id`. Cópialo en `wrangler.toml`, sustituyendo
`PENDIENTE_DE_RELLENAR`.

## 3. Guardar la clave privada como secreto

    npx wrangler secret put VAPID_PRIVATE_KEY

Y pega el valor que está en `CLAVES.txt`. **Nunca** la pongas en
`wrangler.toml` ni la subas a GitHub.

## 4. Desplegar

    npx wrangler deploy

Te dará una URL del tipo `https://cuotify-avisos.ALGO.workers.dev`.

## 5. Decirle a la app dónde está el servidor

En `js/push.js`, línea ~20, cambia:

    export const SERVIDOR = 'https://cuotify-avisos.TU-SUBDOMINIO.workers.dev';

por la URL real. Sube `js/push.js` a GitHub Pages.

## 6. Probar en el iPhone

1. Abre tu web de GitHub Pages en **Safari** (no en Chrome).
2. Compartir → **Añadir a pantalla de inicio**. Sin esto el push no
   existe en iOS, es un requisito de Apple.
3. Abre la app **desde el icono**, ve a Ajustes → Avisos de vencimiento,
   y acepta el permiso.

## Comprobar que funciona

Ver los registros en vivo:

    npx wrangler tail

Forzar un envío sin esperar al día (en otra terminal):

    npx wrangler dev --test-scheduled
    curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"

## Si el aviso no llega

El push se manda **sin contenido**: solo despierta al service worker,
que compone el mensaje leyendo IndexedDB. Es lo que permite que tus
importes no salgan del móvil.

Si Apple lo rechazara por venir sin contenido, en `wrangler tail` verás
un código 400 en `web.push.apple.com`. En ese caso hay que añadir carga
cifrada (aes128gcm) en `enviarPush()`. Dímelo y lo montamos.

Códigos que verás en el registro:
- **201** correcto, entregado al servicio de Apple/Google
- **400** petición mal formada
- **401/403** firma VAPID rechazada
- **404/410** suscripción caducada (el Worker la borra solo)
