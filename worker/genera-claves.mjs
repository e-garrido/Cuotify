/* Genera un par de claves VAPID (P-256) en base64url, sin dependencias. */
const b64url = (buf) =>
  Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const par = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
);

const publica = await crypto.subtle.exportKey('raw', par.publicKey);   // 65 bytes
const privJwk = await crypto.subtle.exportKey('jwk', par.privateKey);

console.log('VAPID_PUBLIC_KEY  =', b64url(publica));
console.log('VAPID_PRIVATE_KEY =', privJwk.d);
console.log('\n(la privada es un secreto: NUNCA en el repositorio)');
