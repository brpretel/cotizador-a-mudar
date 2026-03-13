import { TARIFAS } from "./config.js";
import { state } from "./state.js";
import { ceilDiv, clampMin } from "./utils.js";

/* -----------------------------
   Helpers de tarifa
----------------------------- */
function getRouteConfig() {
  const rutaKey = state.tipoRuta?.toUpperCase();
  return TARIFAS.RUTAS[rutaKey] || null;
}

function getTarifaCompartidaMeta() {
  const rutaKey = state.tipoRuta?.toUpperCase();
  const ruta = getRouteConfig();
  if (!ruta || !rutaKey) return null;

  const agresiva = state.fechaMudanzaEsMismaSemana === true;

  if (rutaKey === "URBANO") {
    return agresiva
      ? {
          label: "URB. COMP. AGRESIVA",
          precioKm: ruta.COMPARTIDA.AGRESIVA.PRECIO_KM,
          descuentoPct: 20
        }
      : {
          label: "URB. COMPARTIDA",
          precioKm: ruta.COMPARTIDA.PRECIO_KM,
          descuentoPct: 15
        };
  }

  if (rutaKey === "NACIONAL") {
    return agresiva
      ? {
          label: "NAC. COMP. AGRESIVA",
          precioKm: ruta.COMPARTIDA.AGRESIVA.PRECIO_KM,
          descuentoPct: 20
        }
      : {
          label: "NAC. COMPARTIDA",
          precioKm: ruta.COMPARTIDA.PRECIO_KM,
          descuentoPct: 15
        };
  }

  return null;
}

/* -----------------------------
   Precio base
----------------------------- */
export function calcularPrecioBase() {
  const rutaKey = state.tipoRuta?.toUpperCase();
  const ruta = TARIFAS.RUTAS[rutaKey];
  if (!ruta) return 0;

  const km = Number(state.distanciaKm || 0);
  const kmFacturar = Math.max(km, ruta.KM_MIN);

  if (state.tipoMudanza === "completa") {
    const precio = kmFacturar * ruta.COSTO_PUBLICO_KM;
    state.precioBase = Math.max(precio, ruta.PRECIO_MIN);
    state.tarifaAplicadaLabel =
      rutaKey === "URBANO" ? "SERVICIO EXCLUSIVO URBANO" : "SERVICIO EXCLUSIVO NACIONAL";
    state.precioKmAplicado = ruta.COSTO_PUBLICO_KM;
    state.descuentoAplicadoPct = 0;
    state.tiempoEstimadoServicio = "De un día para otro";
  } else if (state.tipoMudanza === "compartida") {
    const meta = getTarifaCompartidaMeta();
    if (!meta) {
      state.precioBase = 0;
      state.tarifaAplicadaLabel = "";
      state.precioKmAplicado = 0;
      state.descuentoAplicadoPct = 0;
      state.tiempoEstimadoServicio = "2 a 5 días";
    } else {
      state.precioBase = kmFacturar * meta.precioKm;
      state.tarifaAplicadaLabel = meta.label;
      state.precioKmAplicado = meta.precioKm;
      state.descuentoAplicadoPct = meta.descuentoPct;
      state.tiempoEstimadoServicio = "2 a 5 días";
    }
  } else {
    state.precioBase = 0;
    state.tarifaAplicadaLabel = "";
    state.precioKmAplicado = 0;
    state.descuentoAplicadoPct = 0;
    state.tiempoEstimadoServicio = "";
  }

  recalcAll();
  return state.precioFinal;
}

/* -----------------------------
   Recalc global
----------------------------- */
export function recalcAll() {
  state.precioFinal = state.precioBase;

  aplicarRecargosPorContexto("origen");
  aplicarRecargosPorContexto("destino");

  const totalItemsM3 = (state.itemsMudanza || []).reduce(
    (acc, it) => acc + Number(it.m3Total || 0),
    0
  );

  if (totalItemsM3 > 0) {
    state.precioFinal += totalItemsM3 * TARIFAS.M3_ESTANDAR;
    state.precioFinal += calcItemsEscaleraRecargoPorContexto("origen", totalItemsM3);
    state.precioFinal += calcItemsEscaleraRecargoPorContexto("destino", totalItemsM3);
  }
}

function calcItemsEscaleraRecargoPorContexto(ctxName, totalItemsM3) {
  const data = state[ctxName];
  if (!data) return 0;

  if (data.hayAscensor !== false) return 0;

  const pisos = clampMin(data.pisos, 1);
  const pisosCobrar = Math.max(pisos - 1, 0);
  if (pisosCobrar <= 0) return 0;

  return totalItemsM3 * pisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
}

/* -----------------------------
   Especiales
----------------------------- */
export function upsertEspecial(ctxName, especial) {
  const ctx = state[ctxName];
  ctx.especiales ??= [];

  const idx = ctx.especiales.findIndex((e) => e.key === especial.key);
  if (idx >= 0) ctx.especiales[idx] = { ...ctx.especiales[idx], ...especial };
  else ctx.especiales.push(especial);

  recalcAll();
}

export function removeEspecial(ctxName, key) {
  const ctx = state[ctxName];
  ctx.especiales = (ctx.especiales || []).filter((e) => e.key !== key);
  recalcAll();
}

export function clearEspeciales(ctxName) {
  const ctx = state[ctxName];
  ctx.especiales = [];
  recalcAll();
}

/* -----------------------------
   Items mudanza
----------------------------- */
export function upsertItemMudanza(item) {
  state.itemsMudanza ??= [];
  const idx = state.itemsMudanza.findIndex((i) => i.key === item.key);
  if (idx >= 0) state.itemsMudanza[idx] = { ...state.itemsMudanza[idx], ...item };
  else state.itemsMudanza.push(item);

  recalcAll();
}

export function removeItemMudanza(key) {
  state.itemsMudanza = (state.itemsMudanza || []).filter((i) => i.key !== key);
  recalcAll();
}

export function clearItemsMudanza() {
  state.itemsMudanza = [];
  recalcAll();
}

/* -----------------------------
   Recargos por contexto
----------------------------- */
function aplicarRecargosPorContexto(ctxName) {
  const data = state[ctxName];
  if (!data) return;

  const pisos = clampMin(data.pisos, 1);
  const pisosCobrar = Math.max(pisos - 1, 0);

  if (data.camionMenos40m === false) {
    const extra = clampMin(data.metrosExtra, 0);
    const bloques20 = ceilDiv(extra, 20);
    state.precioFinal += bloques20 * TARIFAS.RECARGOS.POR_20M_ADICIONAL;
  }

  for (const it of data.especiales || []) {
    const m3 = Number(it.m3Total || 0);
    if (m3 <= 0) continue;
    if (!it.metodo) continue;

    let recargoM3 = 0;

    if (it.metodo === "escalera") {
      recargoM3 = pisosCobrar * TARIFAS.RECARGOS.POR_PISO_ESCALERA;
    }

    if (it.metodo === "fachada_manual") {
      recargoM3 = TARIFAS.RECARGOS.FACHADA_MANUAL;
    }

    if (it.metodo === "montacarga") {
      recargoM3 = TARIFAS.RECARGOS.FACHADA_MONTACARGA;
    }

    const costoM3 = TARIFAS.M3_ESTANDAR + recargoM3;
    state.precioFinal += m3 * costoM3;
  }
}