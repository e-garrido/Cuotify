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

export function deudaTotal(gastos) {
  return gastos.reduce((s, g) => s + pendienteTotalDe(g), 0);
}

export function totalPagado(gastos) {
  return gastos.reduce((s, g) => s + pagadoTotalDe(g), 0);
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

/* Mes en el que se termina de pagar todo. null si no hay deuda viva */
export function libreEn(gastos) {
  const vivos = gastos.filter((g) => !terminado(g));
  if (!vivos.length) return null;
  return vivos.map(finKey).sort().pop();
}

/* ---------- Pagos vencidos y siguiente pago ---------- */

/* Meses del plan ya vencidos (<= mes actual) que siguen sin marcar */
export function vencidasDe(g) {
  const hoy = nowKey();
  return mesesDelPlan(g).filter((k) => k <= hoy && !estaPagado(g, k));
}

/* Qué mes marca el botón "Pagar cuota":
   el mes en curso si toca y está pendiente; si no, el pendiente más antiguo. */
export function proximoPago(g) {
  if (terminado(g)) return null;
  const hoy = nowKey();
  if (esMesDelPlan(g, hoy) && !estaPagado(g, hoy)) return hoy;
  return mesesDelPlan(g).find((k) => !estaPagado(g, k)) || null;
}
