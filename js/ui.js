'use strict';

/* =====================================================================
   Piezas de interfaz reutilizables: selectores, parseo de importes,
   toasts, hojas accesibles, tema y animación de cifras.
   ===================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const sinMovimiento = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(ms = 12) {
  if (navigator.vibrate && !sinMovimiento()) navigator.vibrate(ms);
}

/* ---------- Importes con coma decimal ----------
   Los <input type="number"> descartan "12,50" en teclado español.
   Usamos type="text" + inputmode="decimal" y normalizamos aquí. */
export function parseImporte(valor) {
  const s = String(valor ?? '')
    .replace(/[€\s ]/g, '')
    .trim();
  if (!s) return null;

  // "1.234,56" -> el punto es separador de miles; "12.50" -> punto decimal
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function parseEntero(valor, min = 0) {
  const n = Math.trunc(Number(String(valor ?? '').replace(/[\s ]/g, '')));
  return Number.isFinite(n) && n >= min ? n : null;
}

/* Escribe un número en un input de texto con coma decimal */
export function ponImporte(input, v) {
  input.value = v ? String(v).replace('.', ',') : '';
}

/* ---------- Toasts ---------- */
let toastActual = null;

export function toast(mensaje, opciones = {}) {
  const { tipo = 'info', accion, onAccion, duracion = accion ? 6000 : 3200 } = opciones;
  const cont = $('#toasts');
  if (!cont) return;

  if (toastActual) toastActual.remove();

  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  const texto = document.createElement('span');
  texto.className = 'toast-text';
  texto.textContent = mensaje;
  el.append(texto);

  if (accion && onAccion) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = accion;
    btn.addEventListener('click', () => {
      cerrar();
      onAccion();
    });
    el.append(btn);
  }

  cont.append(el);
  toastActual = el;

  let cerrado = false;
  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(t);
    el.classList.add('is-out');
    if (toastActual === el) toastActual = null;
    setTimeout(() => el.remove(), sinMovimiento() ? 0 : 220);
  }
  const t = setTimeout(cerrar, duracion);
  return cerrar;
}

/* ---------- Hojas (bottom sheets) accesibles ---------- */
const FOCUSABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

let hojaAbierta = null;
let focoPrevio = null;

export function abrirHoja(backdrop, { foco } = {}) {
  if (hojaAbierta) cerrarHoja(hojaAbierta);
  focoPrevio = document.activeElement;
  backdrop.hidden = false;
  hojaAbierta = backdrop;
  document.body.classList.add('sin-scroll');

  const destino = foco ? $(foco, backdrop) : $(FOCUSABLES, backdrop);
  requestAnimationFrame(() => destino && destino.focus());
}

export function cerrarHoja(backdrop) {
  if (!backdrop || backdrop.hidden) return;
  backdrop.hidden = true;
  const sheet = $('.sheet', backdrop);
  if (sheet) sheet.style.transform = '';
  if (hojaAbierta === backdrop) hojaAbierta = null;
  document.body.classList.remove('sin-scroll');
  if (focoPrevio && focoPrevio.isConnected) focoPrevio.focus();
  focoPrevio = null;
}

/* Escape cierra; Tab no puede escapar de la hoja abierta */
document.addEventListener('keydown', (e) => {
  if (!hojaAbierta) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    cerrarHoja(hojaAbierta);
    return;
  }
  if (e.key !== 'Tab') return;

  const items = $$(FOCUSABLES, hojaAbierta).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const primero = items[0];
  const ultimo = items[items.length - 1];
  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primero.focus();
  }
});

/* Clic fuera y arrastrar hacia abajo para cerrar */
export function conectarHoja(backdrop) {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cerrarHoja(backdrop);
  });

  const sheet = $('.sheet', backdrop);
  const grabber = $('.sheet-grabber', backdrop);
  if (!sheet || !grabber) return;

  let y0 = null;
  grabber.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    grabber.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  grabber.addEventListener('pointermove', (e) => {
    if (y0 === null) return;
    const dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const soltar = (e) => {
    if (y0 === null) return;
    const dy = Math.max(0, e.clientY - y0);
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) cerrarHoja(backdrop);
  };
  grabber.addEventListener('pointerup', soltar);
  grabber.addEventListener('pointercancel', soltar);
}

/* ---------- Confirmación como promesa ---------- */
export function confirmar({ titulo, mensaje, ok = 'Aceptar', peligro = false }) {
  return new Promise((resolve) => {
    const backdrop = $('#confirmBackdrop');
    $('#confirmTitle').textContent = titulo;
    $('#confirmMsg').textContent = mensaje;

    const btnOk = $('#btnConfirmOk');
    const btnCancel = $('#btnConfirmCancel');
    btnOk.textContent = ok;
    btnOk.classList.toggle('danger', peligro);

    function limpiar(valor) {
      btnOk.removeEventListener('click', aceptar);
      btnCancel.removeEventListener('click', cancelar);
      backdrop.removeEventListener('cerrada', cancelar);
      cerrarHoja(backdrop);
      resolve(valor);
    }
    const aceptar = () => limpiar(true);
    const cancelar = () => limpiar(false);

    btnOk.addEventListener('click', aceptar);
    btnCancel.addEventListener('click', cancelar);
    backdrop.addEventListener('cerrada', cancelar);

    abrirHoja(backdrop, { foco: '#btnConfirmCancel' });
  });
}

/* ---------- Tema ---------- */
const COLOR_BARRA = { light: '#f2f3f7', dark: '#0b0b0f' };

export function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', tema);

  const oscuro =
    tema === 'dark' ||
    (tema === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  $$('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = oscuro ? COLOR_BARRA.dark : COLOR_BARRA.light;
  document.head.append(meta);
}

/* ---------- Animación de cifras ---------- */
export function animarCifra(el, desde, hasta, formatear) {
  if (sinMovimiento() || desde === hasta) {
    el.textContent = formatear(hasta);
    return;
  }
  const t0 = performance.now();
  const dur = 520;
  function paso(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = formatear(desde + (hasta - desde) * e);
    if (p < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

/* ---------- Descarga de archivos ---------- */
export function descargar(nombre, contenido, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
