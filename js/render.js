'use strict';

import { state, sim, hueDeIcono, iconoValido, nombreDeIcono } from './state.js';
import {
  euro, euroCorto, keyLabel, keyLabelLargo, monthInfo, nowKey,
  cargosMes, pendienteMes, activosEn,
  pagadas, terminado, startKey, finKey, mesesDelPlan, mesesConSaltos, estaPagado,
  deudaTotal, totalPagado, pendienteTotalDe, libreEn, vencidasDe, intereses,
  haEmpezado, adquiridos, fechaCorta, esFijo,
  porCategoria, simular, vencidasTotales,
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
  $('#secSaldo').classList.toggle('is-negativo', negativo);

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
  renderCategorias();
  renderBanner();
  renderGastos($('#gastosList'), { admin: false, tipo: 'plazos' });
  renderSeccionFijos($('#secFijos'), $('#fijosList'), false);
}

/* Los gastos fijos van en su propia seccion: no son deuda y no acaban
   igual que una compra, asi que mezclarlos confunde las dos cosas. La
   seccion no existe hasta que hay alguno. */
function renderSeccionFijos(seccion, lista, admin, opciones = {}) {
  if (!seccion || !lista) return;
  const hay = state.gastos.some(esFijo);
  seccion.hidden = !hay;
  if (hay) renderGastos(lista, { admin, tipo: 'fijo', ...opciones });
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
  const card = $('#secDeuda');
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
   Aviso de cuotas sin marcar
   La tarjeta de cada gasto ya lo avisa, pero solo lo ves al llegar a ella.
   ===================================================================== */
function renderBanner() {
  const b = $('#bannerVencidas');
  const n = vencidasTotales(state.gastos);
  b.hidden = n === 0;
  if (n) {
    $('#bannerVencidasTxt').textContent =
      `Tienes ${n} cuota${n === 1 ? '' : 's'} sin marcar como pagada${n === 1 ? '' : 's'}`;
  }
}

/* =====================================================================
   En qué se te va: reparto de la deuda por categoría.
   Una sola tonalidad en las barras: aquí se comparan magnitudes, y la
   identidad ya la dan el icono y el nombre de cada fila.
   ===================================================================== */
function renderCategorias() {
  const sec = $('#secCategorias');
  const cont = $('#catsList');
  const filas = porCategoria(state.gastos);

  sec.hidden = filas.length < 2;   // con una sola categoría no reparte nada
  if (sec.hidden) return;

  const mayor = filas[0].pendiente || 1;
  cont.innerHTML = '';

  for (const c of filas) {
    const id = iconoValido(c.id);
    const pct = Math.round((c.pendiente / mayor) * 100);

    const fila = document.createElement('div');
    fila.className = 'cat';
    fila.style.setProperty('--hue', hueDeIcono(id));
    fila.innerHTML = `
      <span class="gasto-icono"><svg class="ic" aria-hidden="true"><use/></svg></span>
      <span class="cat-txt">
        <span class="cat-head">
          <span class="cat-nombre"></span>
          <span class="cat-importe"></span>
        </span>
        <span class="cat-track"><span class="cat-fill"></span></span>
        <span class="cat-sub"></span>
      </span>
    `;
    fila.querySelector('use').setAttribute('href', `#ic-${id}`);
    fila.querySelector('.cat-nombre').textContent = nombreDeIcono(id);
    fila.querySelector('.cat-importe').textContent = euro(c.pendiente);
    fila.querySelector('.cat-sub').textContent =
      `${c.n} gasto${c.n === 1 ? '' : 's'}` + (c.mensual ? ` · ${euro(c.mensual)}/mes` : '');

    const fill = fila.querySelector('.cat-fill');
    if (sinMovimiento()) fill.style.width = `${pct}%`;
    else requestAnimationFrame(() => (fill.style.width = `${pct}%`));

    cont.append(fila);
  }
}

/* =====================================================================
   Pantalla de simulación: tantear el mes sin tocar tus datos.

   Dos palancas: apagar gastos reales que ya pagas, y añadir compras
   imaginarias. Ninguna de las dos escribe en state.gastos, así que el
   Resumen no se entera de nada.
   ===================================================================== */

export function renderSimulador() {
  const reales = state.gastos.filter((g) => !sim.excluidos.includes(g.id));
  const meses = Array.from({ length: MESES_VISTA }, (_, i) => {
    const m = monthInfo(i);
    const base = cargosMes(reales, m.key);
    const nuevo = cargosMes(sim.imaginarios, m.key);
    return { key: m.key, label: m.label, offset: i, base, nuevo, total: base + nuevo };
  });

  /* La cifra grande NO es el cargo de este mes: es lo que costaría al mes
     todo lo que hay marcado, empezado o no. El sentido de esta pantalla
     es tantear lo que todavía no pagas, así que un gasto que arranca en
     septiembre tiene que sumar aquí. Cuándo ocurre de verdad se ve en las
     barras de abajo, que sí respetan las fechas. */
  const seleccionados = reales.filter((g) => !terminado(g));
  const alMes =
    seleccionados.reduce((t, g) => t + g.cuotaMensual, 0) +
    sim.imaginarios.reduce((t, g) => t + g.cuotaMensual, 0);

  const pres = state.presupuesto;
  const queda = pres - alMes;
  const excede = pres > 0 && alMes > pres;

  $('#simPagarias').textContent = euro(alMes);
  $('#simQuedan').textContent =
    pres <= 0
      ? 'Define un presupuesto en Ajustes para ver cuánto te quedaría.'
      : excede
        ? `Te pasarías ${euro(-queda)} de tus ${euro(pres)}`
        : `Te quedarían ${euro(queda)} de tus ${euro(pres)}`;
  $('#simTotalCard').classList.toggle('is-excede', excede);

  const pct = pres > 0 ? Math.min(100, Math.round((alMes / pres) * 100)) : 0;
  const track = $('#simTrack');
  track.setAttribute('aria-valuenow', String(pct));
  track.setAttribute('aria-label', `${pct}% del presupuesto`);
  const fill = $('#simFill');
  if (sinMovimiento()) fill.style.width = `${pct}%`;
  else requestAnimationFrame(() => (fill.style.width = `${pct}%`));

  pintarSimReales();
  pintarSimImaginarios();
  pintarBarras(meses, $('#simRefPantalla'), $('#simRefLabelPantalla'), $('#simBarsPantalla'),
    'de gastos imaginarios');

  $('#simVeredictoPantalla').textContent = veredictoSim(meses);
  $('#simVeredictoPantalla').className =
    'sim-veredicto' + (meses.some((m) => pres > 0 && m.total > pres) ? ' is-mal' : '');
}

function filaSim(g, { activo, accion, detalle }) {
  const fila = document.createElement('div');
  fila.className = 'sim-row' + (activo ? '' : ' is-off');
  fila.style.setProperty('--hue', hueDeIcono(g.icono));
  const idIcono = iconoValido(g.icono);
  fila.innerHTML = `
    <span class="sim-row-ic"><svg class="ic" aria-hidden="true"><use href="#ic-${idIcono}"/></svg></span>
    <span class="sim-row-txt">
      <span class="sim-row-nombre"></span>
      <span class="sim-row-detalle"></span>
    </span>
    <span class="sim-row-accion"></span>
  `;
  fila.querySelector('.sim-row-nombre').textContent = g.nombre;
  fila.querySelector('.sim-row-detalle').textContent = detalle;
  fila.querySelector('.sim-row-accion').append(accion);
  return fila;
}

function pintarSimReales() {
  const cont = $('#simReales');
  const ayuda = $('#simAyudaReales');
  cont.innerHTML = '';
  const lista = state.gastos.filter((g) => !terminado(g));

  if (!lista.length) {
    ayuda.textContent = 'Desactiva lo que quieras quitar de la cuenta. No toca tus datos.';
    const p = document.createElement('p');
    p.className = 'lista-vacia';
    p.textContent = 'No tienes ningún gasto activo: empieza añadiendo alguno imaginario.';
    cont.append(p);
    return;
  }

  let futuros = 0;

  for (const g of lista) {
    const activo = !sim.excluidos.includes(g.id);
    /* Aquí sí sale siempre la cuota, porque aquí sí suma: lo que se está
       simulando es tener todo esto a la vez. Pero la fila dice cuándo
       arranca, que es lo que explica por qué las barras de abajo no son
       planas. */
    const empezado = haEmpezado(g);
    if (!empezado) futuros += 1;

    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'sim-switch';
    sw.dataset.simToggle = g.id;
    sw.setAttribute('aria-pressed', String(activo));
    sw.setAttribute('aria-label', `${activo ? 'Quitar' : 'Incluir'} ${g.nombre} en la simulación`);

    const fila = filaSim(g, {
      activo,
      accion: sw,
      detalle: empezado
        ? `${euro(g.cuotaMensual)} al mes · hasta ${keyLabel(finKey(g))}`
        : `${euro(g.cuotaMensual)} al mes · empieza en ${keyLabel(startKey(g))}`,
    });
    if (!empezado) fila.classList.add('is-fuera');
    cont.append(fila);
  }

  ayuda.textContent = futuros
    ? `Desactiva lo que quieras quitar de la cuenta. No toca tus datos. Arriba cuenta todo lo marcado a la vez, incluidos los ${futuros} que aún no han empezado; abajo ves mes a mes cuándo pasa de verdad.`
    : 'Desactiva lo que quieras quitar de la cuenta. No toca tus datos.';
}

function pintarSimImaginarios() {
  const cont = $('#simImaginarios');
  cont.innerHTML = '';
  if (!sim.imaginarios.length) {
    const p = document.createElement('p');
    p.className = 'lista-vacia';
    p.textContent = 'Nada imaginario todavía. Añade abajo lo que estés pensando comprar.';
    cont.append(p);
    return;
  }
  for (const g of sim.imaginarios) {
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'sim-quitar';
    quitar.dataset.simQuitar = g.id;
    quitar.setAttribute('aria-label', `Quitar ${g.nombre} de la simulación`);
    quitar.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    cont.append(
      filaSim(g, {
        activo: true,
        accion: quitar,
        detalle: `${euro(g.cuotaMensual)} al mes · ${g.cuotas} ${g.cuotas === 1 ? 'mes' : 'meses'}`,
      })
    );
  }
}

function veredictoSim(meses) {
  const pres = state.presupuesto;
  if (pres <= 0) {
    const peor = Math.max(...meses.map((m) => m.total));
    return `Tu mes más cargado sería de ${euro(peor)}. Define un presupuesto para saber si te cabe.`;
  }
  const malos = meses.filter((m) => m.total > pres);
  if (!malos.length) {
    const peor = meses.reduce((a, b) => (b.total > a.total ? b : a));
    return `Te cabe en los seis meses. El más apretado sería ${keyLabelLargo(peor.key)}, con ${euro(peor.total)}.`;
  }
  const peor = malos.reduce((a, b) => (b.total > a.total ? b : a));
  return `Te pasarías en ${malos.length} ${malos.length === 1 ? 'mes' : 'meses'}. El peor, ${keyLabelLargo(peor.key)}: ${euro(peor.total - pres)} por encima.`;
}

/* =====================================================================
   Simulador: qué pasa con los próximos meses si añades este gasto.
   `borrador` lo arma app.js con lo que hay escrito en el formulario.
   ===================================================================== */
export function renderSimulacion(borrador) {
  const panel = $('#simPanel');

  if (!borrador || !borrador.cuotaMensual || !borrador.cuotas) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const meses = simular(state.gastos, borrador);
  pintarBarras(meses, $('#simRef'), $('#simRefLabel'), $('#simBars'), 'de este gasto');

  $('#simVeredicto').textContent = veredicto(meses);
  $('#simVeredicto').className =
    'sim-veredicto' + (meses.some((m) => state.presupuesto > 0 && m.total > state.presupuesto)
      ? ' is-mal'
      : '');
}

/* Las barras de 6 meses son las mismas en el alta y en la pantalla de
   simulación: misma escala, misma línea de presupuesto, mismo criterio
   de exceso. Solo cambia qué representa la parte de arriba. */
function pintarBarras(meses, ref, refLabel, cont, queEsLoNuevo) {
  const tope =
    Math.max(...meses.map((m) => m.total), state.presupuesto > 0 ? state.presupuesto : 0) || 1;

  // Línea del presupuesto, con holgura para que no quede pegada al techo
  const escala = Math.max(tope * 1.12, 1);
  ref.hidden = state.presupuesto <= 0;
  if (state.presupuesto > 0) {
    ref.style.setProperty('--y', String(state.presupuesto / escala));
    refLabel.textContent = euroCorto(state.presupuesto);
  }

  cont.innerHTML = '';
  for (const m of meses) {
    const excede = state.presupuesto > 0 && m.total > state.presupuesto;
    const slot = document.createElement('div');
    slot.className = 'sim-slot' + (excede ? ' is-excede' : '');
    slot.innerHTML = `
      <span class="sim-val"></span>
      <span class="sim-track">
        <span class="sim-nuevo"></span>
        <span class="sim-base"></span>
      </span>
      <span class="sim-mes"></span>
    `;
    slot.querySelector('.sim-val').textContent = m.total ? euroCorto(m.total) : '—';
    slot.querySelector('.sim-mes').textContent = m.offset === 0 ? 'Ahora' : m.label;
    slot.querySelector('.sim-base').style.height = `${(m.base / escala) * 100}%`;
    slot.querySelector('.sim-nuevo').style.height = `${(m.nuevo / escala) * 100}%`;
    slot.setAttribute(
      'aria-label',
      `${keyLabelLargo(m.key)}: ${euro(m.total)}, de los cuales ${euro(m.nuevo)} ${queEsLoNuevo}`
    );
    cont.append(slot);
  }
}

function veredicto(meses) {
  const conCargo = meses.filter((m) => m.nuevo > 0);
  if (!conCargo.length) return 'Este gasto no cae dentro de los próximos 6 meses.';

  if (state.presupuesto <= 0) {
    const antes = Math.max(...meses.map((m) => m.base));
    const despues = Math.max(...meses.map((m) => m.total));
    return `Tu mes más cargado pasaría de ${euro(antes)} a ${euro(despues)}. Define un presupuesto para saber si te cabe.`;
  }

  const peor = meses.reduce((a, b) => (b.total > a.total ? b : a));
  if (peor.total > state.presupuesto) {
    return `En ${keyLabel(peor.key)} te pasarías ${euro(peor.total - state.presupuesto)} del presupuesto.`;
  }
  const margen = Math.min(...meses.map((m) => state.presupuesto - m.total));
  return `Te cabe: te seguirían quedando al menos ${euro(margen)} libres al mes.`;
}

/* =====================================================================
   Lista de gastos
   ===================================================================== */
export function renderGastosList() {
  const busqueda = ($('#buscador')?.value || '').trim().toLowerCase();
  const filtro = $('#filtros .seg-btn.is-active')?.dataset.filtro || 'activos';
  renderGastos($('#gastosListFull'), { admin: true, busqueda, filtro, tipo: 'plazos' });
  renderSeccionFijos($('#secFijosFull'), $('#fijosListFull'), true, { busqueda, filtro });
}

function textoVacio(busqueda, filtro) {
  if (busqueda) return `Ningún gasto coincide con «${busqueda}».`;
  if (filtro === 'finalizados') return 'Todavía no has terminado de pagar nada.';
  if (filtro === 'activos' && state.gastos.length)
    return 'No te queda ningún pago pendiente.';
  return 'Todavía no has registrado ninguna compra a plazos.';
}

export function renderGastos(
  container,
  { admin = false, busqueda = '', filtro = 'todos', tipo = 'todos' } = {}
) {
  if (!container) return;

  let lista = state.gastos;
  if (tipo === 'plazos') lista = lista.filter((g) => !esFijo(g));
  else if (tipo === 'fijo') lista = lista.filter(esFijo);
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

    // Sin gastos y sin el + en el resumen, el estado vacío es la única salida
    if (!state.gastos.length) {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'primary-btn cta-vacio';
      cta.textContent = 'Añadir mi primera compra';
      cta.addEventListener('click', () => acciones.onNuevo?.());
      container.append(cta);
    }
    return;
  }

  for (const g of lista) container.append(tarjetaGasto(g, admin));
}

function tarjetaGasto(g, admin) {
  const fijo = esFijo(g);
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

  /* En un fijo no se habla de «cuotas que quedan» ni de dinero pendiente:
     no debes nada, solo sabes hasta cuando lo pagas. */
  card.querySelector('.gasto-total').textContent = fijo
    ? fin
      ? `terminó en ${keyLabel(finKey(g))}`
      : `desde ${keyLabel(startKey(g))} · hasta ${keyLabel(finKey(g))}`
    : fin
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

  card.querySelector('.gasto-cuotas').textContent = fijo
    ? `${p} de ${g.cuotas} ${g.cuotas === 1 ? 'mes' : 'meses'} pagados`
    : fin
      ? `${g.cuotas} de ${g.cuotas} cuotas`
      : empezado
        ? `${p} de ${g.cuotas} · quedan ${euro(restante)}`
        : `${g.cuotas} cuotas · ${euro(restante)} en total`;

  /* Todavía no adquirido: no suma en la deuda */
  if (!empezado) {
    const nota = document.createElement('p');
    nota.className = 'gasto-nota gasto-nota--info';
    nota.textContent = fijo
      ? `Empieza el ${fechaCorta(g.fechaInicio)}`
      : `Empieza el ${fechaCorta(g.fechaInicio)} · aún no cuenta como deuda`;
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
export function renderHistorial(g, modo = 'pagos') {
  const cont = $('#historial');
  const wrap = $('#historialWrap');
  if (!g || !g.cuotas) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  cont.innerHTML = '';
  const atrasadas = new Set(vencidasDe(g));
  const aplazando = modo === 'aplazar';
  const fijo = esFijo(g);

  // Un fijo no se aplaza: su ultimo mes lo fija la fecha de fin
  $('#modoHistorial').hidden = fijo;

  for (const { key: k, saltado } of mesesConSaltos(g)) {
    const pagado = !saltado && estaPagado(g, k);
    const vencido = !saltado && atrasadas.has(k);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hist-chip';
    if (saltado) b.classList.add('is-saltado');
    if (pagado) b.classList.add('is-pagado');
    if (vencido) b.classList.add('is-vencido');
    b.textContent = keyLabel(k);
    b.setAttribute('aria-pressed', String(pagado));

    const estado = saltado
      ? 'aplazada, ese mes no se paga'
      : pagado
        ? 'pagada'
        : vencido
          ? 'vencida sin pagar'
          : 'pendiente';
    b.setAttribute('aria-label', `${keyLabelLargo(k)}: ${estado}`);

    /* En modo pagos un mes aplazado no se puede marcar: no existe cuota. */
    if (aplazando && !fijo) {
      b.disabled = pagado;
      b.addEventListener('click', () => acciones.onToggleSalto?.(g.id, k));
    } else {
      b.disabled = saltado;
      b.addEventListener('click', () => acciones.onToggleMes?.(g.id, k));
    }
    cont.append(b);
  }
}

export function resetAnimacion() {
  saldoPrevio = null;
}
