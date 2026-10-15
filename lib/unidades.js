// backend/lib/unidades.js
// Lista cerrada de unidades. Antes se escribían a mano y quedaron
// "unidad", "Unidad", "ud", "Uniad", "unidadf", "10000"...

export const UNIDADES = [
  "unidad",
  "bolsa",
  "kg",
  "g",
  "m",
  "m2",
  "m3",
  "litro",
  "barra",
  "rollo",
  "palet",
  "hoja",
  "pliego",
  "paquete",
  "caja",
  "par",
  "juego",
];

// Variantes que se cargaron a mano -> unidad de la lista.
const EQUIVALENCIAS = {
  unidad: "unidad", unidades: "unidad", ud: "unidad", uds: "unidad", un: "unidad",
  uniad: "unidad", unidada: "unidad", unidadf: "unidad", u: "unidad",
  bolsa: "bolsa", bolsas: "bolsa",
  kg: "kg", kilo: "kg", kilos: "kg", kgs: "kg",
  g: "g", gr: "g", grs: "g", gramos: "g",
  m: "m", mt: "m", mts: "m", mtrs: "m", mtr: "m", metro: "m", metros: "m",
  m2: "m2", "m²": "m2", mts2: "m2",
  m3: "m3", "m³": "m3", mts3: "m3",
  litro: "litro", litros: "litro", lt: "litro", lts: "litro", lto: "litro", l: "litro",
  barra: "barra", barras: "barra",
  rollo: "rollo", rollos: "rollo",
  palet: "palet", pallet: "palet", palets: "palet", pallets: "palet",
  hoja: "hoja", hojas: "hoja",
  pliego: "pliego", pliegos: "pliego",
  paquete: "paquete", paquetes: "paquete",
  caja: "caja", cajas: "caja",
  par: "par", pares: "par",
  juego: "juego", juegos: "juego",
};

// Devuelve la unidad de la lista que corresponde, o null si no se
// puede saber (vacía, un número como "200", "10m", etc.).
export function normalizarUnidad(valor) {
  const limpia = String(valor ?? "").trim().toLowerCase().replace(/\.$/, "");
  return EQUIVALENCIAS[limpia] ?? null;
}

export function esUnidadValida(valor) {
  return UNIDADES.includes(valor);
}
