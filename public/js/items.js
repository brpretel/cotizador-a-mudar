let CATALOG = null;

function parseCSVLine(line) {
  // CSV simple: sin comillas complejas (si tu CSV tiene comillas, lo ajustamos luego)
  // formato: zona,espacio,objeto,tipo,variante,medidas_l,medidas_a,medidas_h,volumen_m3
  const parts = line.split(",").map(s => s.trim());
  return parts;
}

export async function loadCatalog() {
  if (CATALOG) return CATALOG;

  const res = await fetch("./data/objetos.csv", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar objetos.csv");

  const text = await res.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // header
  const header = lines.shift();

  const rows = lines.map(line => {
    const [
      zona, espacio, objeto, tipo, variante,
      L, A, H, m3
    ] = parseCSVLine(line);

    return {
      zona,
      espacio,
      objeto,
      tipo,
      variante,
      medidas: { L: Number(L), A: Number(A), H: Number(H) },
      m3: Number(m3)
    };
  });

  // group
  const grouped = {};
  for (const r of rows) {
    grouped[r.zona] ??= {};
    grouped[r.zona][r.espacio] ??= {};
    grouped[r.zona][r.espacio][r.objeto] ??= [];
    grouped[r.zona][r.espacio][r.objeto].push(r);
  }

  CATALOG = { rows, grouped };
  return CATALOG;
}

export function getCatalog() {
  return CATALOG;
}