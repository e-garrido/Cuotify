'use strict';

/* =====================================================================
   Cálculo puro: fechas, claves de mes y modelo de cuotas.
   Sin DOM y sin estado global: todo entra por parámetros.
   ===================================================================== */

/* ---------- Formato ---------- */
const fmtEuro = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtEuroCorto = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const num = (v) => (Number.isFinite(v) ? v : 0);

export function euro(v) {
  return fmtEuro.format(num(v));
}

/* Para ejes y barras, donde los céntimos son ruido */
export function euroCorto(v) {
  return fmtEuroCorto.format(num(v));
}

/* ---------- Claves de mes 'YYYY-MM' ---------- */
export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nowKey() {
  return monthKey(new Date());
}

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function addMonthsToKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

export function monthsBetween(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/* 'ago 26' */
export function keyLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
    .replace('.', '');
}

/* 'agosto de 2026', para lectores de pantalla y textos largos */
export function keyLabelLargo(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  });
}

/* Mes actual + offset */
export function monthInfo(offset) {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  return { key: monthKey(d), label: keyLabel(monthKey(d)) };
}

/* =====================================================================
   Modelo de un gasto
   { id, nombre, icono, precioTotal, cuotaMensual, cuotas,
     fechaInicio: 'YYYY-MM-DD', pagos: ['YYYY-MM', ...] }

   `pagos` guarda EN QUÉ MESES se ha pagado, no cuántas cuotas llevas.
   Ese cambio es lo que permite marcar el mes en curso, deshacer un pago
   y detectar cuotas vencidas.
   ===================================================================== */

export function startKey(g) {
  return g.fechaInicio ? g.fechaInicio.slice(0, 7) : nowKey();
}

/* Fecha real de la cuota nº i, respetando el día del mes.
   Si el día no existe en ese mes (31 de febrero) se ajusta al último. */
export function fechaCuota(g, i) {
  const [y, m, d] = (g.fechaInicio || hoyISO()).split('-').map(Number);
  const f = new Date(y, m - 1 + i, 1);
  const ultimoDia = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
  f.setDate(Math.min(d, ultimoDia));
  return f;
}

function aISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/* ¿Ya lo has adquirido? Un gasto cuya primera cuota es futura todavía no
   es una deuda: lo has planificado, pero aún no lo has comprado.
   Comparación por DÍA, no por mes: el 20 de agosto, una compra con primera
   cuota el 30 de agosto sigue siendo futura. */
export function haEmpezado(g) {
  return (g.fechaInicio || hoyISO()) <= hoyISO();
}

export function adquiridos(gastos) {
  return gastos.filter(haEmpezado);
}

/* '30 ago' */
export function fechaCorta(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return '';
  return new Date(y, m - 1, d)
    .toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

export function pagos(g) {
  return Array.isArray(g.pagos) ? g.pagos : [];
}

export function pagadas(g) {
  return Math.min(g.cuotas, pagos(g).length);
}

export function terminado(g) {
  return pagadas(g) >= g.cuotas;
}

/* Índice del mes K dentro del plan, o -1 si cae fuera */
export function indiceEnPlan(g, K) {
  const m = monthsBetween(startKey(g), K);
  return m >= 0 && m < g.cuotas ? m : -1;
}

export function esMesDelPlan(g, K) {
  return indiceEnPlan(g, K) !== -1;
}

export function estaPagado(g, K) {
  return pagos(g).includes(K);
}

/* Todos los meses que abarca el plan, en orden */
export function mesesDelPlan(g) {
  const ini = startKey(g);
  return Array.from({ length: g.cuotas }, (_, i) => addMonthsToKey(ini, i));
}

/* Último mes con cargo */
export function finKey(g) {
  return addMonthsToKey(startKey(g), Math.max(0, g.cuotas - 1));
}

/* ---------- Cargos por mes ---------- */

/* Lo que ese mes te toca pagar, esté pagado o no.
   Es el compromiso del mes: no baja al marcar el pago. */
export function cargoDe(g, K) {
  return esMesDelPlan(g, K) ? num(g.cuotaMensual) : 0;
}

/* Lo que ese mes te queda por pagar. Sí baja al marcar el pago. */
export function pendienteDe(g, K) {
  return esMesDelPlan(g, K) && !estaPagado(g, K) ? num(g.cuotaMensual) : 0;
}

export function cargosMes(gastos, K) {
  return gastos.reduce((s, g) => s + cargoDe(g, K), 0);
}

export function pendienteMes(gastos, K) {
  return gastos.reduce((s, g) => s + pendienteDe(g, K), 0);
}

export function activosEn(gastos, K) {
  return gastos.filter((g) => esMesDelPlan(g, K));
}

/* ---------- Totales de deuda ---------- */

export function pendienteTotalDe(g) {
  return num(g.cuotaMensual) * Math.max(0, g.cuotas - pagadas(g));
}

export function pagadoTotalDe(g) {
  return num(g.cuotaMensual) * pagadas(g);
}

/* Solo lo adquirido: una compra programada para dentro de unos días
   aún no se debe. Sí sigue contando en las cifras del mes, porque ese
   cargo llegará a la cuenta igualmente. */
export function deudaTotal(gastos) {
  return adquiridos(gastos).reduce((s, g) => s + pendienteTotalDe(g), 0);
}

export function totalPagado(gastos) {
  return adquiridos(gastos).reduce((s, g) => s + pagadoTotalDe(g), 0);
}

/* Coste financiado total (cuota x cuotas) */
export function costeFinanciado(g) {
  return num(g.cuotaMensual) * num(g.cuotas);
}

/* Sobrecoste frente al precio al contado: intereses, comisiones... */
export function intereses(g) {
  const extra = costeFinanciado(g) - num(g.precioTotal);
  return num(g.precioTotal) > 0 && extra > 0.01 ? extra : 0;
}

/* ---------- Desglose por categoría ----------
   Agrupa por el icono del gasto, que desde el cambio de emojis a iconos
   ES la categoría. Solo cuenta lo adquirido, igual que la deuda total.
   Devuelve ids: el nombre y el tono los pone quien pinta, porque viven
   en state.js y este módulo no depende de nadie. */
export function porCategoria(gastos) {
  const mapa = new Map();
  for (const g of adquiridos(gastos)) {
    const id = g.icono || 'compra';
    const e = mapa.get(id) || { id, pendiente: 0, mensual: 0, n: 0 };
    e.pendiente += pendienteTotalDe(g);
    if (!terminado(g)) e.mensual += num(g.cuotaMensual);
    e.n += 1;
    mapa.set(id, e);
  }
  return [...mapa.values()]
    .filter((e) => e.pendiente > 0)
    .sort((a, b) => b.pendiente - a.pendiente);
}

/* ---------- Simulación de un gasto que aún no existe ----------
   `borrador` = { cuotaMensual, cuotas, fechaInicio, excluirId }.
   `excluirId` saca de la base el gasto que se está editando, para que al
   editar se vea el cambio y no el importe contado dos veces. */
export function simular(gastos, borrador, meses = 6) {
  const otros = borrador.excluirId
    ? gastos.filter((g) => g.id !== borrador.excluirId)
    : gastos;
  const candidato = {
    fechaInicio: borrador.fechaInicio,
    cuotas: borrador.cuotas,
    cuotaMensual: borrador.cuotaMensual,
  };
  return Array.from({ length: meses }, (_, i) => {
    const m = monthInfo(i);
    const base = cargosMes(otros, m.key);
    const nuevo = cargoDe(candidato, m.key);
    return { key: m.key, label: m.label, offset: i, base, nuevo, total: base + nuevo };
  });
}

/* Total de cuotas vencidas sin marcar, para la insignia del icono */
export function vencidasTotales(gastos) {
  return gastos.reduce((s, g) => s + vencidasDe(g).length, 0);
}

/* Mes en el que se termina de pagar todo. null si no hay deuda viva */
export function libreEn(gastos) {
  const vivos = adquiridos(gastos).filter((g) => !terminado(g));
  if (!vivos.length) return null;
  return vivos.map(finKey).sort().pop();
}

/* ---------- Pagos vencidos y siguiente pago ---------- */

/* Cuotas cuya fecha ya ha pasado y siguen sin marcar.
   Por fecha exacta: si pagas los días 30, el 5 de septiembre todavía no
   debes la cuota de septiembre. */
export function vencidasDe(g) {
  if (!haEmpezado(g)) return [];
  const hoy = hoyISO();
  return mesesDelPlan(g).filter(
    (k, i) => aISO(fechaCuota(g, i)) <= hoy && !estaPagado(g, k)
  );
}

/* Qué mes marca el botón "Pagar cuota":
   el mes en curso si toca y está pendiente; si no, el pendiente más antiguo. */
export function proximoPago(g) {
  if (terminado(g) || !haEmpezado(g)) return null;
  const hoy = nowKey();
  if (esMesDelPlan(g, hoy) && !estaPagado(g, hoy)) return hoy;
  return mesesDelPlan(g).find((k) => !estaPagado(g, k)) || null;
}
