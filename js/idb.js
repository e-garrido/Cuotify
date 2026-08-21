'use strict';

/* =====================================================================
   Espejo en IndexedDB de la agenda de avisos.

   ¿Por qué no localStorage? Porque un service worker no puede leerlo, y
   es él quien tiene que componer la notificación cuando llega el push.
   IndexedDB sí es accesible desde el worker, así que tus nombres e
   importes viajan del hilo principal al service worker sin pasar por
   ningún servidor.
   ===================================================================== */

const BD = 'cuotify';
const ALMACEN = 'avisos';
const CLAVE = 'proximos';

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function guardarAvisos(lista) {
  try {
    const db = await abrir();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ALMACEN, 'readwrite');
      tx.objectStore(ALMACEN).put(lista, CLAVE);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (e) {
    // Sin IndexedDB la app sigue funcionando: solo se pierden los avisos
    return false;
  }
}

export async function leerAvisos() {
  try {
    const db = await abrir();
    const lista = await new Promise((resolve, reject) => {
      const tx = db.transaction(ALMACEN, 'readonly');
      const req = tx.objectStore(ALMACEN).get(CLAVE);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return lista;
  } catch (e) {
    return [];
  }
}

export async function borrarAvisos() {
  return guardarAvisos([]);
}
