'use strict';

import { state, hueDeIcono, iconoValido, nombreDeIcono } from './state.js';
import {
  euro, euroCorto, keyLabel, keyLabelLargo, monthInfo, nowKey,
  cargosMes, pendienteMes, activosEn,
  pagadas, terminado, finKey, mesesDelPlan, estaPagado,
  deudaTotal, totalPagado, pendienteTotalDe, libreEn, vencidasDe, intereses,
  haEmpezado, adquiridos, fechaCorta,
} from './calc.js';
import { $, animarCifra, sinMovimiento } from './ui.js';

const MESES_VISTA = 6;

/* Callbacks inyectados desde app.js (evita import circular) */
let acciones = {};
export function setAcciones(a) {
  acciones = a;
}

let saldoPrevio = null;

/* =====================================================================
   Resumen
   ===================================================================== */
export function renderResumen() {
  const K = nowKey();
  const comprometido = cargosMes(state.gastos, K);
  const pendiente = pendienteMes(state.gastos, K);
  const saldo = state.presupuesto - comprometido;

  /* Saldo: presupuesto menos TODO lo comprometido este mes.
     No baja al marcar un pago, porque ese dinero ya estaba comprometido.
     Lo que sí baja al pagar es "pendiente", justo debajo. */
  const saldoEl = $('#saldoValue');
  animarCifra(saldoEl, saldoPrevio ?? saldo, saldo, euro);
  saldoPrevio = saldo;

  const negativo = saldo < 0;
  $('#saldoCard').classList.toggle('is-negativo', negativo);

  const activos = activosEn(state.gastos, K).length;
  const sinPresupuesto = state.presupuesto <= 0;
  $('#saldoLabel').textContent = negativo
    ? 'Te pasas del presupuesto'
    : 'Saldo disponible este mes';
  $('#saldoSub').textContent = sinPresupuesto
    ? 'Define un presupuesto para ver cuánto te queda'
    : `${activos} gasto${activos === 1 ? '' : 's'} activo${activos === 1 ? '' : 's'} · ` +
      `${Math.round((comprometido / state.presupuesto) * 100)}% del presupuesto en cuotas`;

  $('#presupuestoVal').textContent = state.presupuesto ? euro(state.presupuesto) : '—';
  $('#cuotasMesVal').textContent = euro(comprometido);

  renderAnillo(sinPresupuesto ? null : comprometido / state.presupuesto);
  renderPendienteMes(comprometido, pendiente, K);
  renderDeuda();
  renderProximos();
  renderGastos($('#gastosList'), { admin: false });
}

/* Anillo: qué parte del presupuesto se lleva la financiación */
function renderAnillo(ratio) {
  const anillo = $('#saldoRing');
  if (ratio === null) {
    anillo.hidden = true;
    return;
  }
  anillo.hidden = false;
  const pct = Math.max(0, Math.min(1, ratio));
  const c = 2 * Math.PI * 22;
  const arco = $('#saldoRingArc');
  arco.style.strokeDasharray = `${c}`;
  arco.style.strokeDashoffset = `${c * (1 - pct)}`;
  $('#saldoRingText').textContent = `${Math.round(ratio * 100)}%`;
  anillo.setAttribute(
    'aria-label',
    `Las cuotas ocupan el ${Math.round(ratio * 100)}% de tu presupuesto`
  );
}

/* Línea de progreso de pagos del mes: esto SÍ se mueve al pagar */
function renderPendienteMes(comprometido, pendiente, K) {
  const fila = $('#pagoMes');
  if (comprometido <= 0) {
    fila.hidden = true;
    return;
  }
  fila.hidden = false;

  const delMes = activosEn(state.gastos, K);
  const pagadosMes = delMes.filter((g) => estaPagado(g, K)).length;
  const pct = Math.round(((comprometido - pendiente) / comprometido) * 100);

  $('#pagoMesTexto').textContent =
    pendiente <= 0
      ? '¡Todo pagado este mes!'
      : `Pendiente este mes: ${euro(pendiente)}`;
  $('#pagoMesSub').textContent = `${pagadosMes} de ${delMes.length} cuotas marcadas`;

  const barra = $('#pagoMesFill');
  barra.style.width = `${pct}%`;
  const wrap = $('#pagoMesBar');
  wrap.setAttribute('aria-valuenow', String(pct));
  wrap.setAttribute(
    'aria-label',
    `Pagado este mes: ${pct}% de ${euro(comprometido)}`
  );
  fila.classList.toggle('is-completo', pendiente <= 0);
}

/* =====================================================================
   Deuda total: el dato que la app no mostraba en ninguna parte
   ===================================================================== */
function renderDeuda() {
  const card = $('#deudaCard');
  const pendiente = deudaTotal(state.gastos);
  const pagado = totalPagado(state.gastos);

  // Si todo lo que hay es futuro, no debes nada todavía
  if (!adquiridos(state.gastos).length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  $('#deudaValue').textContent = euro(pendiente);
  $('#deudaPagado').textContent = euro(pagado);

  const fin = libreEn(state.gastos);
  $('#deudaFin').textContent = fin ? keyLabel(fin) : '—';
  $('#deudaFinLabel').textContent = fin ? 'Libre de deudas en' : 'Sin deuda viva';

  const total = pendiente + pagado;
  const pct = total > 0 ? Math.round((pagado / total) * 100) : 100;
  $('#deudaFill').style.width = `${pct}%`;
  const bar = $('#deudaBar');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.setAttribute('aria-label', `Has pagado el ${pct}% de tu deuda total`);
  $('#deudaPct').textContent = `${pct}% pagado`;
}

/* =====================================================================
   Próximos cargos — columnas, serie única.
   Altura proporcional al importe, línea de presupuesto como referencia.
   ===================================================================== */
function renderProximos() {
  const cont = $('#nextMonths');
  const vacio = $('#nextMonthsEmpty');
  ocultarTip();
  cont.innerHTML = '';

  const meses = Array.from({ length: MESES_VISTA }, (_, i) => {
    const m = monthInfo(i);
    return { ...m, importe: cargosMes(state.gastos, m.key), offset: i };
  });

  const hayCargos = meses.some((m) => m.importe > 0);
  vacio.hidden = hayCargos;
  cont.hidden = !hayCargos;
  if (!hayCargos) return;

  /* La escala la manda el dato, no el presupuesto. Si el presupuesto es
     mucho mayor que los cargos, meterlo en la escala convierte las barras
     en briznas ilegibles; en ese caso la referencia sobra, porque justo
     entonces es cuando no hay ningún riesgo de pasarse. */
  const mayor = Math.max(...meses.map((m) => m.importe)) || 1;
  const conHolgura = mayor * 1.25;
  const verRef = state.presupuesto > 0 && state.presupuesto <= mayor * 1.6;
  const tope = verRef ? Math.max(conHolgura, state.presupuesto * 1.12) : conHolgura;

  const ref = $('#chartRef');
  ref.hidden = !verRef;
  if (verRef) {
    ref.style.setProperty('--y', String(state.presupuesto / tope));
    $('#chartRefLabel').textContent = `Presupuesto ${euroCorto(state.presupuesto)}`;
  }

  for (const m of meses) {
    const excede = state.presupuesto > 0 && m.importe > state.presupuesto;
    const cuotas = activosEn(state.gastos, m.key).length;

    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'bar-slot';
    if (m.offset === 0) slot.classList.add('is-now');
    if (excede) slot.classList.add('is-excede');
    slot.setAttribute(
      'aria-label',
      `${keyLabelLargo(m.key)}: ${euro(m.importe)} en ${cuotas} cuota${
        cuotas === 1 ? '' : 's'
      }${excede ? '. Supera el presupuesto' : ''}`
    );

    slot.innerHTML = `
      <span class="bar-val"></span>
      <span class="bar-track">
        <span class="bar-fill"></span>
      </span>
      <span class="bar-mes"></span>
    `;
    slot.querySelector('.bar-val').textContent = m.importe ? euroCorto(m.importe) : '—';
    slot.querySelector('.bar-mes').textContent = m.offset === 0 ? 'Este mes' : m.label;
    slot.dataset.tip =
      `${euro(m.importe)} · ${cuotas} cuota${cuotas === 1 ? '' : 's'}` +
      (excede ? ' · supera el presupuesto' : '');

    const fill = slot.querySelector('.bar-fill');
    const h = `${Math.max(m.importe > 0 ? 4 : 0, (m.importe / tope) * 100)}%`;
    if (sinMovimiento()) fill.style.height = h;
    else requestAnimationFrame(() => (fill.style.height = h));

    slot.addEventListener('pointerenter', () => mostrarTip(slot));
    slot.addEventListener('focus', () => mostrarTip(slot));
    slot.addEventListener('pointerleave', ocultarTip);
    slot.addEventListener('blur', ocultarTip);
    // En táctil no hay hover: el toque alterna la etiqueta
    slot.addEventListener('click', () => {
      if (slot.classList.contains('is-open')) ocultarTip();
      else mostrarTip(slot);
    });

    cont.append(slot);
  }
}

/* El tooltip vive en .chart-plot, no dentro del carrusel: ese contenedor
   tiene scroll horizontal y por tanto también recorta en vertical. Aquí lo
   colocamos a mano sobre la barra y lo mantenemos dentro del gráfico. */
function mostrarTip(slot) {
  const tip = $('#chartTip');
  const plot = slot.closest('.chart-plot');
  if (!tip || !plot) return;

  document.querySelectorAll('.bar-slot.is-open').forEach((s) => s.classList.remove('is-open'));
  slot.classList.add('is-open');

  tip.textContent = slot.dataset.tip || '';
  tip.hidden = false;

  const r = slot.getBoundingClientRect();
  const p = plot.getBoundingClientRect();
  const centro = r.left - p.left + r.width / 2;
  const mitad = tip.offsetWidth / 2;
  tip.style.left = `${Math.max(mitad, Math.min(p.width - mitad, centro))}px`;
}

function ocultarTip() {
  const tip = $('#chartTip');
  if (tip) tip.hidden = true;
  document.querySelectorAll('.bar-slot.is-open').forEach((s) => s.classList.remove('is-open'));
}

/* =====================================================================
   Lista de gastos
   ===================================================================== */
export function renderGastosList() {
  const busqueda = ($('#buscador')?.value || '').trim().toLowerCase();
  const filtro = $('#filtros .seg-btn.is-active')?.dataset.filtro || 'activos';
  renderGastos($('#gastosListFull'), { admin: true, busqueda, filtro });
}

function textoVacio(busqueda, filtro) {
  if (busqueda) return `Ningún gasto coincide con «${busqueda}».`;
  if (filtro === 'finalizados') return 'Todavía no has terminado de pagar nada.';
  if (filtro === 'activos' && state.gastos.length)
    return 'No te queda ningún pago pendiente.';
  return 'Aún no hay gastos. Toca + para añadir tu primera compra a plazos.';
}

export function renderGastos(container, { admin = false, busqueda = '', filtro = 'todos' } = {}) {
  if (!container) return;

  let lista = state.gastos;
  if (filtro === 'activos') lista = lista.filter((g) => !terminado(g));
  else if (filtro === 'finalizados') lista = lista.filter((g) => terminado(g));
  if (busqueda) lista = lista.filter((g) => g.nombre.toLowerCase().includes(busqueda));

  // Pendientes primero; dentro, los que tienen cuotas vencidas arriba
  const orden = (g) => (terminado(g) ? 2 : vencidasDe(g).length ? 0 : 1);
  lista = [...lista].sort((a, b) => orden(a) - orden(b));

  container.innerHTML = '';
  if (!lista.length) {
    const vacio = document.createElement('p');
    vacio.className = 'lista-vacia';
    vacio.textContent = textoVacio(busqueda, filtro);
    container.append(vacio);
    return;
  }

  for (const g of lista) container.append(tarjetaGasto(g, admin));
}

function tarjetaGasto(g, admin) {
  const p = pagadas(g);
  const fin = terminado(g);
  const pct = g.cuotas ? Math.round((p / g.cuotas) * 100) : 0;
  const quedan = Math.max(0, g.cuotas - p);
  const vencidas = vencidasDe(g).length;
  const restante = pendienteTotalDe(g);
  const empezado = haEmpezado(g);

  const card = document.createElement('article');
  card.className = 'gasto-card';
  card.style.setProperty('--hue', hueDeIcono(g.icono));
  if (fin) card.classList.add('is-fin');
  if (vencidas) card.classList.add('is-vencido');
  if (!empezado) card.classList.add('is-programado');

  card.innerHTML = `
    <div class="gasto-head">
      <span class="gasto-icono"><svg class="ic" aria-hidden="true"><use/></svg></span>
      <span class="gasto-name"></span>
      <span class="gasto-status">${fin ? 'Pagado' : empezado ? pct + '%' : 'Programado'}</span>
    </div>
    <div class="gasto-meta">
      <span class="gasto-cuota"></span>
      <span class="gasto-total"></span>
    </div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-fill"></div>
    </div>
    <div class="gasto-foot">
      <span class="gasto-cuotas"></span>
      <span class="gasto-actions"></span>
    </div>
  `;

  const idIcono = iconoValido(g.icono);
  card.querySelector('.gasto-icono use').setAttribute('href', `#ic-${idIcono}`);
  card.querySelector('.gasto-icono').setAttribute('aria-label', nombreDeIcono(idIcono));
  card.querySelector('.gasto-icono').setAttribute('role', 'img');
  card.querySelector('.gasto-name').textContent = g.nombre;
  card.querySelector('.gasto-status').classList.toggle('done', fin);
  card.querySelector('.gasto-status').classList.toggle('prog', !fin && !empezado);

  const cuotaEl = card.querySelector('.gasto-cuota');
  cuotaEl.textContent = euro(g.cuotaMensual);
  const permes = document.createElement('small');
  permes.textContent = '/mes';
  cuotaEl.append(permes);

  card.querySelector('.gasto-total').textContent = fin
    ? `${g.cuotas} cuotas · terminado en ${keyLabel(finKey(g))}`
    : empezado
      ? `quedan ${quedan} · hasta ${keyLabel(finKey(g))}`
      : `${g.cuotas} cuotas · hasta ${keyLabel(finKey(g))}`;

  const track = card.querySelector('.progress-track');
  track.setAttribute('aria-valuenow', String(pct));
  track.setAttribute('aria-label', `${g.nombre}: ${p} de ${g.cuotas} cuotas pagadas`);
  const fill = card.querySelector('.progress-fill');
  if (sinMovimiento()) fill.style.width = `${pct}%`;
  else requestAnimationFrame(() => (fill.style.width = `${pct}%`));

  card.querySelector('.gasto-cuotas').textContent = fin
    ? `${g.cuotas} de ${g.cuotas} cuotas`
    : empezado
      ? `${p} de ${g.cuotas} · quedan ${euro(restante)}`
      : `${g.cuotas} cuotas · ${euro(restante)} en total`;

  /* Todavía no adquirido: no suma en la deuda */
  if (!empezado) {
    const nota = document.createElement('p');
    nota.className = 'gasto-nota gasto-nota--info';
    nota.textContent = `Empieza el ${fechaCorta(g.fechaInicio)} · aún no cuenta como deuda`;
    card.querySelector('.gasto-meta').after(nota);
  }

  /* Aviso de cuotas vencidas sin marcar */
  if (vencidas) {
    const aviso = document.createElement('button');
    aviso.type = 'button';
    aviso.className = 'gasto-aviso';
    aviso.textContent = `${vencidas} cuota${vencidas === 1 ? '' : 's'} sin marcar · Ponerme al día`;
    aviso.addEventListener('click', (e) => {
      e.stopPropagation();
      acciones.onAlDia?.(g.id);
    });
    card.querySelector('.gasto-meta').after(aviso);
  }

  /* Sobrecoste de la financiación */
  const extra = intereses(g);
  if (extra > 0) {
    const nota = document.createElement('p');
    nota.className = 'gasto-nota';
    nota.textContent = `${euro(g.precioTotal)} al contado · pagas ${euro(extra)} más`;
    card.querySelector('.gasto-meta').after(nota);
  }

  /* Acciones */
  const acc = card.querySelector('.gasto-actions');
  if (admin) {
    acc.append(
      miniBoton('Editar', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z', () =>
        acciones.onEditar?.(g.id)
      ),
      miniBoton('Eliminar', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z', () =>
        acciones.onEliminar?.(g.id), true
      )
    );
  }
  const pagar = document.createElement('button');
  pagar.type = 'button';
  pagar.className = 'pagar-btn';
  pagar.disabled = fin || !empezado;
  // La etiqueta no cambia de ancho entre tarjetas: la fecha ya la da la
  // nota de arriba, y repetirla aquí partía el botón en dos líneas.
  pagar.textContent = fin ? 'Listo' : 'Pagar cuota';
  pagar.setAttribute(
    'aria-label',
    fin
      ? `${g.nombre} está pagado`
      : empezado
        ? `Marcar una cuota de ${g.nombre} como pagada`
        : `${g.nombre} empieza el ${fechaCorta(g.fechaInicio)}: todavía no se puede pagar`
  );
  pagar.addEventListener('click', (e) => {
    e.stopPropagation();
    acciones.onPagar?.(g.id);
  });
  acc.append(pagar);

  /* La tarjeta entera abre el detalle, salvo en los controles */
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    acciones.onEditar?.(g.id);
  });

  return card;
}

function miniBoton(etiqueta, path, onClick, peligro = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini-btn' + (peligro ? ' danger' : '');
  b.setAttribute('aria-label', etiqueta);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/* Historial de meses pagados, para el formulario de edición */
export function renderHistorial(g) {
  const cont = $('#historial');
  const wrap = $('#historialWrap');
  if (!g || !g.cuotas) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  cont.innerHTML = '';
  const atrasadas = new Set(vencidasDe(g));

  for (const k of mesesDelPlan(g)) {
    const pagado = estaPagado(g, k);
    const vencido = atrasadas.has(k);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hist-chip';
    if (pagado) b.classList.add('is-pagado');
    if (vencido) b.classList.add('is-vencido');
    b.textContent = keyLabel(k);
    b.setAttribute('aria-pressed', String(pagado));
    b.setAttribute(
      'aria-label',
      `${keyLabelLargo(k)}: ${pagado ? 'pagada' : vencido ? 'vencida sin pagar' : 'pendiente'}`
    );
    b.addEventListener('click', () => acciones.onToggleMes?.(g.id, k));
    cont.append(b);
  }
}

export function resetAnimacion() {
  saldoPrevio = null;
}
