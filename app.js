'use strict';

/* ===================== Estado y persistencia ===================== */
const STORE_KEY = 'gastos.data.v1';

let state = {
  presupuesto: 0,
  gastos: [],
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.presupuesto = parsed.presupuesto || 0;
      state.gastos = parsed.gastos || [];
    }
  } catch (e) {
    state = { presupuesto: 0, gastos: [] };
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* ===================== Utilidades ===================== */
const fmtEuro = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function euro(val) {
  return fmtEuro.format(val || 0);
}

function nowKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthInfo(offset) {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: d
      .toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
      .replace('.', ''),
  };
}

function addMonthsToKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function startKey(g) {
  return g.fechaInicio ? g.fechaInicio.slice(0, 7) : nowKey();
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/* Cargo de un gasto en el mes 'K' (yyyy-mm), 0 si ese mes no corresponde */
function cargosDe(g, K) {
  const m = monthsBetween(startKey(g), K);
  if (m < 0 || m < pagadas(g) || m >= g.cuotas) return 0;
  return g.cuotaMensual || 0;
}

function cargosMes(K) {
  return state.gastos.reduce((s, g) => s + cargosDe(g, K), 0);
}

function uid() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function keyLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
    .replace('.', '');
}

function pagadas(g) {
  return Math.max(0, Math.min(g.cuotas, g.pagadas || 0));
}

function terminado(g) {
  return pagadas(g) >= g.cuotas;
}

/* ===================== Navegación entre pestañas ===================== */
const screens = document.querySelectorAll('.screen');
const order = ['resumen', 'gastos', 'add'];

function go(which) {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.tab === which)
  );
  const targetIdx = order.indexOf(which);
  screens.forEach((s) => {
    const idx = order.indexOf(s.dataset.screen);
    const active = s.dataset.screen === which;
    s.classList.toggle('is-active', active);
    s.classList.remove('is-left');
    if (active && idx > targetIdx) s.classList.add('is-left');
  });
  if (which === 'resumen') renderResumen();
  if (which === 'gastos') renderGastosList();
  if (which === 'add') setupForm();
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => go(t.dataset.tab))
);

/* ===================== Render: Resumen ===================== */
function renderResumen() {
  const cuotasMes = cargosMes(nowKey());

  const saldo = state.presupuesto - cuotasMes;
  const saldoEl = document.getElementById('saldoValue');
  saldoEl.textContent = euro(saldo);
  saldoEl.classList.toggle('negativo', saldo < 0);

  document.getElementById('presupuestoVal').textContent = euro(state.presupuesto);
  document.getElementById('cuotasMesVal').textContent = euro(cuotasMes);

  const activos = state.gastos.filter((g) => cargosDe(g, nowKey()) > 0).length;
  document.getElementById('saldoSub').textContent =
    `${activos} gasto${activos === 1 ? '' : 's'} activo${activos === 1 ? '' : 's'} este mes ` +
    (state.presupuesto > 0 ? '· de tu presupuesto mensual' : '· sin presupuesto definido');

  renderNextMonths();
  renderGastos(document.getElementById('gastosList'));
}

function renderNextMonths() {
  const wrap = document.getElementById('nextMonths');
  wrap.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const m = monthInfo(i);
    const amount = cargosMes(m.key);
    wrap.insertAdjacentHTML(
      'beforeend',
      `<div class="month-chip${i === 0 ? ' is-now' : ''}">
        <div class="month-name">${m.label}</div>
        <div class="chip-amount">${euro(amount)}</div>
      </div>`
    );
  }
}

/* ===================== Render: lista de gastos ===================== */
function renderGastosList() {
  renderGastos(document.getElementById('gastosListFull'), true);
}

function renderGastos(container, admin) {
  const all = state.gastos;
  if (!all.length) {
    container.innerHTML =
      '<div class="gasto-empty">Aún no hay gastos. Toca <b>+</b> para añadir tu primera compra a plazos.</div>';
    return;
  }

  const done = all.filter((g) => terminado(g));
  const pend = all.filter((g) => !terminado(g));

  container.innerHTML = '';
  for (const g of [...pend, ...done]) {
    const p = pagadas(g);
    const fin = terminado(g);
    const pct = g.cuotas ? Math.round((p / g.cuotas) * 100) : 0;
    const quedan = Math.max(0, g.cuotas - p);
    const finKey = addMonthsToKey(startKey(g), g.cuotas - 1);

    const card = document.createElement('div');
    card.className = 'gasto-card';
    card.innerHTML = `
      <div class="gasto-head">
        <span class="gasto-name"></span>
        <span class="gasto-status ${fin ? 'done' : ''}">${fin ? 'Pagado' : pct + '%'}</span>
      </div>
      <div class="gasto-meta">
        <span class="gasto-cuota">${euro(g.cuotaMensual)}<small>/mes</small></span>
        <span class="gasto-total">${fin ? '' : 'quedan ' + quedan + ' · '}hasta ${keyLabel(finKey)}</span>
      </div>
      <div class="progress-track ${fin ? 'fin' : ''}">
        <div class="progress-fill" style="width:${fin ? 100 : pct}%"></div>
      </div>
      <div class="gasto-foot">
        <span class="gasto-cuotas">${p} de ${g.cuotas} cuotas${fin ? ' · finalizado' : ''}</span>
        <span class="gasto-actions">
          ${
            admin
              ? `<button class="mini-btn" data-edit="${g.id}" aria-label="Editar">
                   <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>
                 </button>
                 <button class="mini-btn danger" data-del="${g.id}" aria-label="Eliminar">
                   <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
                 </button>`
              : ''
          }
          <button class="pagar-btn" data-id="${g.id}" ${fin ? 'disabled' : ''}>${fin ? 'Listo' : 'Pagar cuota'}</button>
        </span>
      </div>
    `;
    card.querySelector('.gasto-name').textContent = g.nombre;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.pagar-btn') || e.target.closest('.mini-btn')) return;
      openForm(g);
    });
    card.querySelector('.pagar-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      pagarCuota(g.id);
    });
    const editBtn = card.querySelector('[data-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openForm(g);
      });
    }
    const delBtn = card.querySelector('[data-del]');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(g);
      });
    }

    container.appendChild(card);
  }
}

function pagarCuota(id) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g || terminado(g)) return;
  g.pagadas = Math.min(g.cuotas, pagadas(g) + 1);
  save();
  renderResumen();
  renderGastosList();
}

/* ===================== Formulario ===================== */
let editingId = null;

function setupForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = 'Nuevo gasto';
  ['fNombre', 'fPrecio', 'fCuota', 'fCuotasTotales', 'fPagadas'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('fFecha').value = hoyISO();
  document.getElementById('fDelete').classList.add('is-hidden');
}

function openForm(g) {
  editingId = g.id;
  document.getElementById('formTitle').textContent = 'Editar gasto';
  document.getElementById('fId').value = g.id;
  document.getElementById('fNombre').value = g.nombre;
  document.getElementById('fPrecio').value = g.precioTotal || '';
  document.getElementById('fCuota').value = g.cuotaMensual || '';
  document.getElementById('fCuotasTotales').value = g.cuotas || '';
  document.getElementById('fFecha').value = g.fechaInicio || hoyISO();
  document.getElementById('fPagadas').value = g.pagadas || 0;
  document.getElementById('fDelete').classList.remove('is-hidden');
  go('add');
}

function guardarForm() {
  const nombre = document.getElementById('fNombre').value.trim();
  const precio = parseFloat(document.getElementById('fPrecio').value) || 0;
  const cuota = parseFloat(document.getElementById('fCuota').value) || 0;
  const cuotas = Math.max(
    1,
    parseInt(document.getElementById('fCuotasTotales').value, 10) || 1
  );
  const fechaInicio = document.getElementById('fFecha').value;
  const pag = Math.min(
    cuotas,
    Math.max(0, parseInt(document.getElementById('fPagadas').value, 10) || 0)
  );

  if (!nombre) {
    document.getElementById('fNombre').focus();
    return;
  }

  if (editingId) {
    const g = state.gastos.find((x) => x.id === editingId);
    if (g) {
      g.nombre = nombre;
      g.precioTotal = precio;
      g.cuotaMensual = cuota;
      g.cuotas = cuotas;
      g.fechaInicio = fechaInicio || hoyISO();
      g.pagadas = pag;
    }
  } else {
    state.gastos.push({
      id: uid(),
      nombre,
      precioTotal: precio,
      cuotaMensual: cuota,
      cuotas,
      fechaInicio: fechaInicio || hoyISO(),
      pagadas: pag,
    });
  }
  save();
  editingId = null;
  go('resumen');
}

function eliminarForm() {
  if (!editingId) return;
  const g = state.gastos.find((x) => x.id === editingId);
  if (g) confirmDelete(g);
}

function confirmDelete(g) {
  document.getElementById('confirmTitle').textContent = 'Eliminar gasto';
  document.getElementById('confirmMsg').textContent =
    `¿Seguro que quieres eliminar «${g.nombre}»? Se perderán las ${g.cuotas - pagadas(g)} cuotas que quedan por pagar.`;
  pendingDeleteId = g.id;
  document.getElementById('confirmBackdrop').hidden = false;
}

function doDelete(id) {
  state.gastos = state.gastos.filter((x) => x.id !== id);
  save();
  editingId = null;
  pendingDeleteId = null;
  document.getElementById('confirmBackdrop').hidden = true;
  const onGastos = document.querySelector('.screen.is-active').dataset.screen === 'gastos';
  if (onGastos) renderGastosList();
  else go('resumen');
}

/* ===================== Eventos ===================== */
let pendingDeleteId = null;

document.getElementById('btnAddHeader').addEventListener('click', () => go('add'));
document.getElementById('fSave').addEventListener('click', guardarForm);
document.getElementById('fDelete').addEventListener('click', eliminarForm);
document.getElementById('btnBack').addEventListener('click', () => go('resumen'));

document.querySelectorAll('[data-go="add"]').forEach((b) =>
  b.addEventListener('click', () => go('add'))
);

/* Hoja de confirmación de borrado */
const confirmBackdrop = document.getElementById('confirmBackdrop');
document.getElementById('btnConfirmCancel').addEventListener('click', () => {
  confirmBackdrop.hidden = true;
  pendingDeleteId = null;
});
document.getElementById('btnConfirmOk').addEventListener('click', () => {
  if (pendingDeleteId) doDelete(pendingDeleteId);
});
confirmBackdrop.addEventListener('click', (e) => {
  if (e.target === confirmBackdrop) {
    confirmBackdrop.hidden = true;
    pendingDeleteId = null;
  }
});

/* Presupuesto */
const backdrop = document.getElementById('sheetBackdrop');
document.getElementById('btnEditPresupuesto').addEventListener('click', () => {
  document.getElementById('fPresupuesto').value = state.presupuesto || '';
  backdrop.hidden = false;
});
backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) backdrop.hidden = true;
});
document.getElementById('btnSavePresupuesto').addEventListener('click', () => {
  state.presupuesto = parseFloat(document.getElementById('fPresupuesto').value) || 0;
  save();
  backdrop.hidden = true;
  renderResumen();
});

/* ===================== Arranque ===================== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

load();
renderResumen();