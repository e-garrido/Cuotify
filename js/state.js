'use strict';

import { addMonthsToKey, hoyISO, nowKey } from './calc.js';

/* =====================================================================
   Estado, persistencia y copias de seguridad.

   v1 guardaba `pagadas: N` (un contador). v2 guarda `pagos: ['YYYY-MM']`.
   `load()` migra la clave antigua sin destruirla, así que una versión
   vieja cacheada en otra pestaña sigue encontrando sus datos.
   ===================================================================== */

const KEY_V2 = 'cuotify.data.v2';
const KEY_V1 = 'gastos.data.v1';
const FORMATO = 2;

export const state = {
  presupuesto: 0,
  gastos: [],
  tema: 'auto', // 'auto' | 'light' | 'dark'
};

/* ---------- Iconos ----------
   Cada icono es un id que apunta a un <symbol> del sprite de index.html,
   y lleva su propio tono: así todas las compras de una misma categoría
   comparten color y la lista se lee de un vistazo. */
export const ICONOS = [
  { id: 'compra',   hue: 28,  nombre: 'Compra' },
  { id: 'movil',    hue: 210, nombre: 'Móvil' },
  { id: 'portatil', hue: 250, nombre: 'Portátil' },
  { id: 'juegos',   hue: 280, nombre: 'Videojuegos' },
  { id: 'coche',    hue: 8,   nombre: 'Coche' },
  { id: 'hogar',    hue: 150, nombre: 'Hogar' },
  { id: 'mueble',   hue: 40,  nombre: 'Muebles' },
  { id: 'electro',  hue: 190, nombre: 'Electrodomésticos' },
  { id: 'ropa',     hue: 330, nombre: 'Ropa' },
  { id: 'viaje',    hue: 200, nombre: 'Viajes' },
  { id: 'audio',    hue: 265, nombre: 'Audio' },
  { id: 'tv',       hue: 220, nombre: 'Televisión' },
  { id: 'bici',     hue: 100, nombre: 'Bicicleta' },
  { id: 'salud',    hue: 350, nombre: 'Salud' },
  { id: 'mascota',  hue: 20,  nombre: 'Mascotas' },
  { id: 'estudios', hue: 310, nombre: 'Estudios' },
];

export const ICONO_DEFECTO = 'compra';

const POR_ID = new Map(ICONOS.map((i) => [i.id, i]));

export function iconoValido(id) {
  return POR_ID.has(id) ? id : ICONO_DEFECTO;
}

export function hueDeIcono(id) {
  return (POR_ID.get(id) || POR_ID.get(ICONO_DEFECTO)).hue;
}

export function nombreDeIcono(id) {
  return (POR_ID.get(id) || POR_ID.get(ICONO_DEFECTO)).nombre;
}

/* Las versiones anteriores guardaban un emoji: lo traducimos al abrir */
const EMOJI_A_ID = {
  '🛒': 'compra', '📱': 'movil', '💻': 'portatil', '🎮': 'juegos',
  '🚗': 'coche', '🏠': 'hogar', '🛋️': 'mueble', '🛋': 'mueble',
  '🧊': 'electro', '👕': 'ropa', '✈️': 'viaje', '✈': 'viaje',
  '🎧': 'audio', '📺': 'tv', '🚲': 'bici', '💊': 'salud',
  '🐶': 'mascota', '🎓': 'estudios',
};

const PISTAS = [
  [/ipad|iphone|movil|móvil|samsung|xiaomi|telefon|teléfon/i, 'movil'],
  [/portatil|portátil|mac|pc|ordenador|laptop/i, 'portatil'],
  [/play ?station|ps5|ps4|xbox|switch|nintendo|consola|juego/i, 'juegos'],
  [/coche|moto|car |seat|renault|taller|neumatic|neumátic/i, 'coche'],
  [/casa|hipoteca|reforma|obra|piso|alquiler/i, 'hogar'],
  [/sofa|sofá|mesa|silla|colchon|colchón|mueble|armario/i, 'mueble'],
  [/nevera|frigo|lavadora|lavavajilla|horno|secadora|microondas/i, 'electro'],
  [/ropa|zapat|abrigo|camis|pantal|vestido/i, 'ropa'],
  [/viaje|vuelo|hotel|avion|avión|billete|crucero/i, 'viaje'],
  [/auricular|cascos|airpod|altavoz|bose|sonido/i, 'audio'],
  [/tele|tv|televis|monitor|pantalla|proyector/i, 'tv'],
  [/bici|bicicleta|patinete|scooter/i, 'bici'],
  [/dentist|medic|médic|gafas|salud|clinic|clínic|ortodon/i, 'salud'],
  [/perro|gato|veterinar|mascota/i, 'mascota'],
  [/curso|master|máster|carrera|universidad|academia|matricula|matrícula/i, 'estudios'],
];

export function sugerirIcono(nombre) {
  const n = String(nombre || '');
  for (const [re, id] of PISTAS) if (re.test(n)) return id;
  return ICONO_DEFECTO;
}

/* ---------- Normalización defensiva ----------
   Nunca dejamos entrar un gasto que pueda propagar NaN por la interfaz. */

function nEntero(v, min, fallback) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function nDecimal(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function esClaveMes(k) {
  return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
}

function normIcono(valor, nombre) {
  if (typeof valor !== 'string' || !valor) return sugerirIcono(nombre);
  if (EMOJI_A_ID[valor]) return EMOJI_A_ID[valor];   // dato de una versión anterior
  return POR_ID.has(valor) ? valor : sugerirIcono(nombre);
}

function normGasto(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const cuotas = nEntero(raw.cuotas, 1, 1);
  const fechaInicio = /^\d{4}-\d{2}-\d{2}$/.test(raw.fechaInicio)
    ? raw.fechaInicio
    : hoyISO();
  const inicio = fechaInicio.slice(0, 7);

  // Migración v1: `pagadas: N` == las N primeras cuotas desde el inicio,
  // que es exactamente lo que asumía el cálculo antiguo.
  let pagos;
  if (Array.isArray(raw.pagos)) {
    pagos = raw.pagos.filter(esClaveMes);
  } else {
    const n = Math.min(cuotas, nEntero(raw.pagadas, 0, 0));
    pagos = Array.from({ length: n }, (_, i) => addMonthsToKey(inicio, i));
  }
  // Sin duplicados y sin meses fuera del plan
  const validos = new Set(
    Array.from({ length: cuotas }, (_, i) => addMonthsToKey(inicio, i))
  );
  pagos = [...new Set(pagos)].filter((k) => validos.has(k));

  const nombre = String(raw.nombre || '').trim() || 'Sin nombre';

  return {
    id: String(raw.id || '') || uid(),
    nombre,
    icono: normIcono(raw.icono, nombre),
    precioTotal: nDecimal(raw.precioTotal),
    cuotaMensual: nDecimal(raw.cuotaMensual),
    cuotas,
    fechaInicio,
    pagos,
  };
}

function normEstado(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    presupuesto: nDecimal(parsed.presupuesto),
    gastos: Array.isArray(parsed.gastos) ? parsed.gastos.map(normGasto).filter(Boolean) : [],
    tema: ['auto', 'light', 'dark'].includes(parsed.tema) ? parsed.tema : 'auto',
  };
}

/* ---------- Carga y guardado ---------- */

export function load() {
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(KEY_V2) || 'null');
  } catch (e) {
    parsed = null;
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(localStorage.getItem(KEY_V1) || 'null');
    } catch (e) {
      parsed = null;
    }
  }
  const limpio = normEstado(parsed);
  if (limpio) Object.assign(state, limpio);
  return state;
}

/* Devuelve false si el navegador rechaza escribir (cuota llena, modo
   privado de Safari...). Quien llama avisa: nunca se pierde en silencio. */
export function save() {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify({ formato: FORMATO, ...state }));
    return true;
  } catch (e) {
    return false;
  }
}

export function uid() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Copia de seguridad ---------- */

export function nombreCopia() {
  return `cuotify-${hoyISO()}.json`;
}

export function serializar() {
  return JSON.stringify(
    { app: 'cuotify', formato: FORMATO, exportado: new Date().toISOString(), ...state },
    null,
    2
  );
}

/* modo: 'reemplazar' | 'fusionar'.
   Devuelve { ok, mensaje, gastos } sin tocar el estado si algo falla. */
export function importar(texto, modo) {
  let parsed;
  try {
    parsed = JSON.parse(texto);
  } catch (e) {
    return { ok: false, mensaje: 'El archivo no es un JSON válido.' };
  }

  const limpio = normEstado(parsed);
  if (!limpio || !Array.isArray(limpio.gastos)) {
    return { ok: false, mensaje: 'El archivo no parece una copia de Cuotify.' };
  }
  if (!limpio.gastos.length && !limpio.presupuesto) {
    return { ok: false, mensaje: 'La copia está vacía: no se ha importado nada.' };
  }

  if (modo === 'fusionar') {
    const porId = new Map(state.gastos.map((g) => [g.id, g]));
    for (const g of limpio.gastos) porId.set(g.id, g);
    state.gastos = [...porId.values()];
    if (limpio.presupuesto) state.presupuesto = limpio.presupuesto;
  } else {
    state.gastos = limpio.gastos;
    state.presupuesto = limpio.presupuesto;
  }

  const n = limpio.gastos.length;
  return {
    ok: true,
    gastos: n,
    mensaje: `${n} gasto${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}`,
  };
}

/* Solo para las pruebas manuales de la migración */
export const _claves = { KEY_V1, KEY_V2 };
