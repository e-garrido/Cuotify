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

/* Iconos sugeridos por palabra clave del nombre */
export const ICONOS = [
  '🛒', '📱', '💻', '🎮', '🚗', '🏠', '🛋️', '🧊',
  '👕', '✈️', '🎧', '📺', '🚲', '💊', '🐶', '🎓',
];

const PISTAS = [
  [/ipad|iphone|movil|móvil|samsung|xiaomi|telefon|teléfon/i, '📱'],
  [/portatil|portátil|mac|pc|ordenador|laptop/i, '💻'],
  [/play ?station|ps5|ps4|xbox|switch|nintendo|consola|juego/i, '🎮'],
  [/coche|moto|car |seat|renault|taller|neumatic|neumátic/i, '🚗'],
  [/casa|hipoteca|reforma|obra|piso|alquiler/i, '🏠'],
  [/sofa|sofá|mesa|silla|colchon|colchón|mueble|armario/i, '🛋️'],
  [/nevera|frigo|lavadora|lavavajilla|horno|secadora|microondas/i, '🧊'],
  [/ropa|zapat|abrigo|camis|pantal|vestido/i, '👕'],
  [/viaje|vuelo|hotel|avion|avión|billete|crucero/i, '✈️'],
  [/auricular|cascos|airpod|altavoz|bose|sonido/i, '🎧'],
  [/tele|tv|televis|monitor|pantalla|proyector/i, '📺'],
  [/bici|bicicleta|patinete|scooter/i, '🚲'],
  [/dentist|medic|médic|gafas|salud|clinic|clínic|ortodon/i, '💊'],
  [/perro|gato|veterinar|mascota/i, '🐶'],
  [/curso|master|máster|carrera|universidad|academia|matricula|matrícula/i, '🎓'],
];

export function sugerirIcono(nombre) {
  const n = String(nombre || '');
  for (const [re, icono] of PISTAS) if (re.test(n)) return icono;
  return '🛒';
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
    icono: typeof raw.icono === 'string' && raw.icono ? raw.icono : sugerirIcono(nombre),
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
