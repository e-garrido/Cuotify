'use strict';

import {
  state, load, save, uid, sugerirIcono, ICONOS, iconoValido, ICONO_DEFECTO,
  serializar, nombreCopia, importar,
} from './js/state.js';
import { euro, hoyISO, nowKey, proximoPago, estaPagado, vencidasDe, terminado, pagadas } from './js/calc.js';
import {
  $, $$, toast, abrirHoja, cerrarHoja, conectarHoja, confirmar, aplicarTema,
  parseImporte, parseEntero, ponImporte, descargar, haptic,
} from './js/ui.js';
import { setAcciones, renderResumen, renderGastosList, renderHistorial, resetAnimacion } from './js/render.js';

/* =====================================================================
   Navegación
   ===================================================================== */
const ORDEN = ['resumen', 'gastos', 'add', 'ajustes'];
const pantallas = $$('.screen');

function go(which, push = true) {
  if (!ORDEN.includes(which)) which = 'resumen';

  // Salir del formulario cancela siempre la edición en curso.
  // (Antes `editingId` sobrevivía y el siguiente "nuevo gasto"
  //  sobrescribía el gasto que se estaba editando.)
  if (which !== 'add') editandoId = null;

  const destino = ORDEN.indexOf(which);
  pantallas.forEach((s) => {
    const idx = ORDEN.indexOf(s.dataset.screen);
    const activa = s.dataset.screen === which;
    s.classList.toggle('is-active', activa);
    s.classList.toggle('is-left', !activa && idx < destino);
    s.toggleAttribute('inert', !activa);
  });
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === which;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });

  if (which === 'resumen') renderResumen();
  if (which === 'gastos') renderGastosList();

  if (push && history.state?.screen !== which) {
    history.pushState({ screen: which }, '');
  }
  pantallas.find((s) => s.dataset.screen === which)?.scrollTo({ top: 0 });
}

window.addEventListener('popstate', (e) => go(e.state?.screen || 'resumen', false));

/* =====================================================================
   Persistencia con aviso de fallo
   ===================================================================== */
function persistir() {
  if (save()) return true;
  toast('No se han podido guardar los cambios. ¿Almacenamiento lleno o navegación privada?', {
    tipo: 'error',
  });
  return false;
}

function refrescar() {
  renderResumen();
  renderGastosList();
}

/* =====================================================================
   Formulario de gasto
   ===================================================================== */
let editandoId = null;
let iconoManual = false;
let tocados = [];
const TRIO = ['fPrecio', 'fCuota', 'fCuotasTotales'];

function gastoActual() {
  return state.gastos.find((g) => g.id === editandoId) || null;
}

function abrirNuevo() {
  editandoId = null;
  iconoManual = false;
  tocados = [];
  $('#formTitle').textContent = 'Nuevo gasto';
  $('#fNombre').value = '';
  ['fPrecio', 'fCuota', 'fCuotasTotales'].forEach((id) => ($(`#${id}`).value = ''));
  $('#fFecha').value = hoyISO();
  seleccionarIcono(ICONO_DEFECTO);
  $('#fDelete').hidden = true;
  $('#historialWrap').hidden = true;
  actualizarNotaIntereses();
  go('add');
  requestAnimationFrame(() => $('#fNombre').focus());
}

function abrirEditar(id) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g) return;
  editandoId = id;
  iconoManual = true;
  tocados = [];
  $('#formTitle').textContent = 'Editar gasto';
  $('#fNombre').value = g.nombre;
  ponImporte($('#fPrecio'), g.precioTotal);
  ponImporte($('#fCuota'), g.cuotaMensual);
  $('#fCuotasTotales').value = g.cuotas || '';
  $('#fFecha').value = g.fechaInicio || hoyISO();
  seleccionarIcono(g.icono || sugerirIcono(g.nombre));
  $('#fDelete').hidden = false;
  renderHistorial(g);
  actualizarNotaIntereses();
  go('add');
}

/* ---------- Icono ---------- */
function pintarIconos() {
  const cont = $('#iconoPicker');
  cont.innerHTML = '';
  for (const ic of ICONOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icono-opt';
    b.dataset.icono = ic.id;
    b.style.setProperty('--hue', ic.hue);
    b.title = ic.nombre;
    b.setAttribute('aria-label', ic.nombre);
    b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#ic-${ic.id}"/></svg>`;
    b.addEventListener('click', () => {
      iconoManual = true;
      seleccionarIcono(ic.id);
    });
    cont.append(b);
  }
}

function seleccionarIcono(ic) {
  const id = iconoValido(ic);
  $('#fIcono').value = id;
  $$('#iconoPicker .icono-opt').forEach((b) => {
    const on = b.dataset.icono === id;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/* ---------- Autocálculo precio ↔ cuota ↔ nº de cuotas ----------
   Se rellena el campo del trío que el usuario NO ha tocado últimamente,
   así nunca se pisa lo que acaba de escribir. */
function marcarTocado(id) {
  tocados = tocados.filter((x) => x !== id);
  tocados.push(id);
}

function autocalcular() {
  const ultimos = tocados.filter((x) => TRIO.includes(x)).slice(-2);
  if (ultimos.length < 2) return;
  const objetivo = TRIO.find((x) => !ultimos.includes(x));
  if (!objetivo) return;

  const precio = parseImporte($('#fPrecio').value);
  const cuota = parseImporte($('#fCuota').value);
  const n = parseEntero($('#fCuotasTotales').value, 1);

  if (objetivo === 'fCuota' && precio && n) {
    ponImporte($('#fCuota'), Math.round((precio / n) * 100) / 100);
  } else if (objetivo === 'fPrecio' && cuota && n) {
    ponImporte($('#fPrecio'), Math.round(cuota * n * 100) / 100);
  } else if (objetivo === 'fCuotasTotales' && precio && cuota && cuota > 0) {
    $('#fCuotasTotales').value = Math.max(1, Math.round(precio / cuota));
  }
}

function actualizarNotaIntereses() {
  const precio = parseImporte($('#fPrecio').value) || 0;
  const cuota = parseImporte($('#fCuota').value) || 0;
  const n = parseEntero($('#fCuotasTotales').value, 1) || 0;
  const nota = $('#notaIntereses');
  const extra = precio > 0 && cuota > 0 && n > 0 ? cuota * n - precio : 0;

  if (extra > 0.01) {
    nota.hidden = false;
    nota.className = 'nota nota--warn';
    nota.textContent = `Financiado pagas ${euro(cuota * n)}: ${euro(extra)} más que al contado.`;
  } else if (extra < -0.01) {
    nota.hidden = false;
    nota.className = 'nota';
    nota.textContent = `Las cuotas suman ${euro(cuota * n)}, menos que el precio total. ¿Diste una entrada?`;
  } else {
    nota.hidden = true;
  }
}

function guardarForm() {
  const nombre = $('#fNombre').value.trim();
  if (!nombre) {
    toast('Ponle un nombre al gasto', { tipo: 'error' });
    $('#fNombre').focus();
    return;
  }

  const cuota = parseImporte($('#fCuota').value);
  if (!cuota) {
    toast('Indica la cuota mensual', { tipo: 'error' });
    $('#fCuota').focus();
    return;
  }

  const cuotas = parseEntero($('#fCuotasTotales').value, 1);
  if (!cuotas) {
    toast('Indica cuántas cuotas son', { tipo: 'error' });
    $('#fCuotasTotales').focus();
    return;
  }

  const datos = {
    nombre,
    icono: $('#fIcono').value || sugerirIcono(nombre),
    precioTotal: parseImporte($('#fPrecio').value) || 0,
    cuotaMensual: cuota,
    cuotas,
    fechaInicio: $('#fFecha').value || hoyISO(),
  };

  const g = gastoActual();
  if (g) {
    Object.assign(g, datos);
    // Recortar pagos que se hayan quedado fuera del plan al acortarlo
    const validos = new Set(
      Array.from({ length: cuotas }, (_, i) => {
        const [y, m] = datos.fechaInicio.slice(0, 7).split('-').map(Number);
        const d = new Date(y, m - 1 + i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })
    );
    g.pagos = g.pagos.filter((k) => validos.has(k));
  } else {
    state.gastos.push({ id: uid(), pagos: [], ...datos });
  }

  if (!persistir()) return;
  toast(g ? 'Gasto actualizado' : 'Gasto añadido');
  haptic();
  editandoId = null;

  // Un segundo toque rápido volvería a entrar aquí con el formulario aún
  // relleno y crearía otro gasto: cerramos la puerta un instante.
  const btn = $('#fSave');
  btn.disabled = true;
  setTimeout(() => (btn.disabled = false), 600);

  go('resumen');
}

/* =====================================================================
   Acciones sobre gastos
   ===================================================================== */
function onPagar(id) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g || terminado(g)) return;
  const mes = proximoPago(g);
  if (!mes) return;

  g.pagos = [...g.pagos, mes];
  if (!persistir()) return;
  haptic();
  refrescar();

  const restantes = g.cuotas - pagadas(g);
  toast(
    restantes === 0
      ? `${g.nombre}: última cuota pagada`
      : `Cuota marcada · quedan ${restantes}`,
    {
      accion: 'Deshacer',
      onAccion: () => {
        const i = g.pagos.lastIndexOf(mes);
        if (i !== -1) g.pagos.splice(i, 1);
        persistir();
        refrescar();
      },
    }
  );
}

function onToggleMes(id, mes) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g) return;
  if (estaPagado(g, mes)) g.pagos = g.pagos.filter((k) => k !== mes);
  else g.pagos = [...g.pagos, mes];
  if (!persistir()) return;
  haptic();
  renderHistorial(g);
  renderResumen();
}

async function onAlDia(id) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g) return;
  const vencidas = vencidasDe(g);
  if (!vencidas.length) return;

  const ok = await confirmar({
    titulo: 'Ponerte al día',
    mensaje: `Se marcarán como pagadas las ${vencidas.length} cuotas vencidas de «${g.nombre}», hasta ${nowKey().replace('-', '/')}.`,
    ok: 'Marcar como pagadas',
  });
  if (!ok) return;

  const previos = [...g.pagos];
  g.pagos = [...g.pagos, ...vencidas];
  if (!persistir()) return;
  refrescar();
  toast(`${vencidas.length} cuotas marcadas`, {
    accion: 'Deshacer',
    onAccion: () => {
      g.pagos = previos;
      persistir();
      refrescar();
    },
  });
}

async function onEliminar(id) {
  const g = state.gastos.find((x) => x.id === id);
  if (!g) return;
  const quedan = g.cuotas - pagadas(g);
  const ok = await confirmar({
    titulo: 'Eliminar gasto',
    mensaje: `Se borrará «${g.nombre}» y su historial de pagos${quedan > 0 ? `, con ${quedan} cuotas aún por pagar` : ''}.`,
    ok: 'Eliminar',
    peligro: true,
  });
  if (!ok) return;

  const copia = { ...g };
  const pos = state.gastos.indexOf(g);
  state.gastos.splice(pos, 1);
  if (!persistir()) return;

  if (editandoId === id) {
    editandoId = null;
    go('resumen');
  } else {
    refrescar();
  }
  toast(`«${copia.nombre}» eliminado`, {
    accion: 'Deshacer',
    onAccion: () => {
      state.gastos.splice(pos, 0, copia);
      persistir();
      refrescar();
    },
  });
}

setAcciones({ onPagar, onEditar: abrirEditar, onEliminar, onAlDia, onToggleMes });

/* =====================================================================
   Ajustes: tema, copia de seguridad, borrado
   ===================================================================== */
function pintarAjustes() {
  $$('#temaSeg .seg-btn').forEach((b) => {
    const on = b.dataset.tema === state.tema;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#ajustesPresupuesto').textContent = state.presupuesto
    ? euro(state.presupuesto)
    : 'Sin definir';
  const n = state.gastos.length;
  $('#ajustesResumen').textContent = `${n} gasto${n === 1 ? '' : 's'} guardado${n === 1 ? '' : 's'} en este dispositivo`;
}

async function onImportar(archivo) {
  let texto;
  try {
    texto = await archivo.text();
  } catch (e) {
    toast('No se ha podido leer el archivo', { tipo: 'error' });
    return;
  }

  const hayDatos = state.gastos.length > 0;
  let modo = 'reemplazar';
  if (hayDatos) {
    const fusionar = await confirmar({
      titulo: 'Ya tienes datos',
      mensaje: 'Puedes añadir la copia a lo que ya hay (fusionar) o sustituirlo todo por la copia.',
      ok: 'Fusionar',
    });
    if (fusionar) modo = 'fusionar';
    else {
      const seguro = await confirmar({
        titulo: '¿Sustituirlo todo?',
        mensaje: `Se borrarán los ${state.gastos.length} gastos actuales y se quedarán solo los de la copia.`,
        ok: 'Sustituir',
        peligro: true,
      });
      if (!seguro) return;
    }
  }

  const previo = JSON.parse(JSON.stringify({ gastos: state.gastos, presupuesto: state.presupuesto }));
  const r = importar(texto, modo);
  if (!r.ok) {
    toast(r.mensaje, { tipo: 'error' });
    return;
  }
  if (!persistir()) return;
  resetAnimacion();
  refrescar();
  pintarAjustes();
  toast(r.mensaje, {
    accion: 'Deshacer',
    onAccion: () => {
      Object.assign(state, previo);
      persistir();
      resetAnimacion();
      refrescar();
      pintarAjustes();
    },
  });
}

async function onBorrarTodo() {
  const ok = await confirmar({
    titulo: 'Borrar todos los datos',
    mensaje: `Se eliminarán los ${state.gastos.length} gastos y el presupuesto de este dispositivo. Exporta una copia antes si quieres conservarlos.`,
    ok: 'Borrar todo',
    peligro: true,
  });
  if (!ok) return;
  state.gastos = [];
  state.presupuesto = 0;
  if (!persistir()) return;
  resetAnimacion();
  refrescar();
  pintarAjustes();
  toast('Datos borrados');
}

/* =====================================================================
   Conexión de eventos
   ===================================================================== */
function conectar() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => (t.dataset.tab === 'add' ? abrirNuevo() : go(t.dataset.tab)))
  );
  $$('[data-go]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.go === 'add' ? abrirNuevo() : go(b.dataset.go)))
  );

  // Formulario. Ojo: #fSave es type="submit", así que NO lleva listener de
  // click propio; si lo lleva, un clic dispara click + submit y guarda dos
  // veces (creaba el gasto duplicado, y al editar insertaba uno nuevo).
  $('#fDelete').addEventListener('click', () => editandoId && onEliminar(editandoId));
  $('#fNombre').addEventListener('input', (e) => {
    if (!iconoManual) seleccionarIcono(sugerirIcono(e.target.value));
  });
  TRIO.forEach((id) => {
    const el = $(`#${id}`);
    el.addEventListener('input', () => {
      marcarTocado(id);
      actualizarNotaIntereses();
    });
    el.addEventListener('blur', () => {
      autocalcular();
      actualizarNotaIntereses();
    });
  });
  $('#formulario').addEventListener('submit', (e) => {
    e.preventDefault();
    guardarForm();
  });

  // Buscador y filtros
  $('#buscador').addEventListener('input', renderGastosList);
  $$('#filtros .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#filtros .seg-btn').forEach((x) => {
        x.classList.toggle('is-active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      renderGastosList();
    })
  );

  // Hojas
  [$('#sheetBackdrop'), $('#confirmBackdrop')].forEach(conectarHoja);

  // Presupuesto
  const abrirPresupuesto = () => {
    ponImporte($('#fPresupuesto'), state.presupuesto || '');
    abrirHoja($('#sheetBackdrop'), { foco: '#fPresupuesto' });
  };
  $('#btnEditPresupuesto').addEventListener('click', abrirPresupuesto);
  $('#btnAjustesPresupuesto').addEventListener('click', abrirPresupuesto);
  $('#formPresupuesto').addEventListener('submit', (e) => {
    e.preventDefault();
    state.presupuesto = parseImporte($('#fPresupuesto').value) || 0;
    if (!persistir()) return;
    cerrarHoja($('#sheetBackdrop'));
    renderResumen();
    pintarAjustes();
    toast('Presupuesto actualizado');
  });

  // Ajustes
  $$('#temaSeg .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      state.tema = b.dataset.tema;
      aplicarTema(state.tema);
      persistir();
      pintarAjustes();
    })
  );
  $('#btnExportar').addEventListener('click', () => {
    descargar(nombreCopia(), serializar());
    toast('Copia descargada');
  });
  $('#btnImportar').addEventListener('click', () => $('#fileImportar').click());
  $('#fileImportar').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) onImportar(f);
    e.target.value = '';
  });
  $('#btnBorrarTodo').addEventListener('click', onBorrarTodo);

  // El tema automático debe repintar la barra de estado al cambiar el sistema
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.tema === 'auto') aplicarTema('auto');
  });
}

/* =====================================================================
   Service worker: avisar en vez de servir una versión vieja para siempre
   ===================================================================== */
function registrarSW() {
  if (!('serviceWorker' in navigator)) return;

  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Hay una versión nueva de Cuotify', {
              accion: 'Actualizar',
              duracion: 15000,
              onAccion: () => nuevo.postMessage({ type: 'SKIP_WAITING' }),
            });
          }
        });
      });
    })
    .catch(() => {});
}

/* =====================================================================
   Arranque
   ===================================================================== */
load();
aplicarTema(state.tema);
pintarIconos();
conectar();
history.replaceState({ screen: 'resumen' }, '');
go('resumen', false);
pintarAjustes();
registrarSW();
