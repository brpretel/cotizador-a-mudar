export function getCtxObj(state) {
  return state[state.accessContext]; // state.origen o state.destino
}

export function money(n) {
  const num = Number(n || 0);
  return `$${num.toLocaleString("es-CO")}`;
}

export function ceilDiv(a, b) {
  const A = Number(a || 0);
  const B = Number(b || 1);
  return Math.ceil(A / B);
}

export function clampMin(n, min) {
  const x = Number(n || 0);
  return Math.max(x, min);
}