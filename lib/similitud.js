// backend/lib/similitud.js
//
// Detecta materiales cargados con distintos nombres para lo mismo
// ("cemento x 25 kg" / "cemento  bolsa x 25 kg", "hierro torcionado"
// / "hierro torsionado"...). Sólo SUGIERE: la unificación la confirma
// una persona, porque "barra 6 m" y "barra 12 m" se parecen y no son
// lo mismo. Por eso los números tienen que coincidir.

// Palabras que no distinguen un material de otro. Ojo: "palet" y "rollo"
// NO van acá: un palet de ladrillos no es un ladrillo.
const VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "para", "p", "c", "con", "por", "x",
  "n", "nro", "num", "numero", "y", "en", "a", "al", "tipo",
  "bolsa", "unidad", "ud", "un", "barra",
]);

// Si los dos nombres dicen un color y no es el mismo, son productos distintos.
const COLORES = new Set([
  "rojo", "roja", "negro", "negra", "azul", "blanco", "blanca", "verde", "amarillo",
  "amarilla", "marron", "gris", "celeste", "naranja", "transparente", "violeta",
]);

// Unidades de medida pegadas al nombre: se ignoran como palabra,
// el número que las acompaña sí cuenta.
const UNIDADES_EN_NOMBRE = new Set([
  "m", "mt", "mts", "mtrs", "metro", "metros", "mm", "cm", "kg", "kilo", "kilos",
  "g", "gr", "l", "lt", "lts", "litro", "litros", "m2", "m3", "pulg", "w", "a", "v",
]);

// Errores de tipeo que aparecen en los catálogos reales.
const SINONIMOS = {
  torcionado: "torsionado",
  hierrro: "hierro",
  hiero: "hierro",
  fierro: "hierro",
  disoc: "disco",
  coerte: "corte",
};

function sinAcentos(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function singular(palabra) {
  return palabra.length > 4 && palabra.endsWith("s") ? palabra.slice(0, -1) : palabra;
}

// "Varilla de hierrro N° 8 x 12mts" -> { palabras: [hierro, varilla], numeros: [12, 8] }
export function descomponer(nombre) {
  let t = sinAcentos(String(nombre ?? "").toLowerCase());
  t = t.replace(/[°º]/g, " ");
  t = t.replace(/(\d),(\d)/g, "$1.$2");            // 1,6 -> 1.6
  t = t.replace(/(\d)([a-z])/g, "$1 $2");          // 12mm -> 12 mm
  t = t.replace(/([a-z])(\d)/g, "$1 $2");          // n8 -> n 8
  const crudos = t.split(/[^a-z0-9./]+/).filter(Boolean);

  const palabras = new Set();
  // Los números se guardan con repetidos: "100 x 100" no es "100".
  const numeros = [];

  for (let tok of crudos) {
    tok = tok.replace(/^[./]+|[./]+$/g, ""); // "p/" -> "p", "7.5." -> "7.5"
    if (!tok) continue;
    if (/^\d+(\.\d+)?$/.test(tok)) {
      numeros.push(String(Number(tok)));
      continue;
    }
    if (/^\d+\/\d+$/.test(tok)) {
      numeros.push(tok);
      continue;
    }
    if (VACIAS.has(tok) || UNIDADES_EN_NOMBRE.has(tok)) continue;
    if (tok.length < 2) continue;
    palabras.add(singular(SINONIMOS[tok] ?? tok));
  }

  return { palabras: [...palabras].sort(), numeros: numeros.sort() };
}

// Clave para detectar repetidos exactos (mismo nombre salvo mayúsculas,
// espacios, acentos, plurales y palabras de relleno).
export function claveNombre(nombre) {
  const { palabras, numeros } = descomponer(nombre);
  return [...palabras, "|", ...numeros].join(" ");
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = guardado;
    }
  }
  return fila[b.length];
}

// Tolera un error de tipeo ("fuasion"/"fusion") sólo en palabras largas
// que empiezan igual: "tierra" y "sierra" son cosas distintas.
function mismaPalabra(a, b) {
  return a === b || (a.length >= 6 && b.length >= 6 && a[0] === b[0] && distancia(a, b) <= 1);
}

function colores(palabras) {
  return palabras.filter((p) => COLORES.has(p)).map((p) => p.replace(/a$/, "o"));
}

function coincidencias(a, b) {
  let n = 0;
  for (const x of a) if (b.some((y) => mismaPalabra(x, y))) n++;
  return n;
}

function incluido(chico, grande) {
  return chico.every((x) => grande.includes(x));
}

/*
  Compara dos materiales ya descompuestos.
  Devuelve "igual", "parecido" o null.
  - igual: mismas palabras (tolerando un error de tipeo) y mismos números.
  - parecido: mismos números y las palabras de uno están dentro del otro
    ("plasticor x 25 kg" / "plasticor x 25 kg holcim"), o se parecen mucho.
*/
export function comparar(a, b) {
  if (!a.palabras.length || !b.palabras.length) return null;

  const mismosNumeros = a.numeros.join(" ") === b.numeros.join(" ");
  if (!mismosNumeros) return null;

  const colA = colores(a.palabras);
  const colB = colores(b.palabras);
  if (colA.length && colB.length && colA.join() !== colB.join()) return null;

  const comunes = coincidencias(a.palabras, b.palabras);
  if (!comunes) return null;

  if (comunes === a.palabras.length && comunes === b.palabras.length) return "igual";

  // Uno contenido en el otro ("plasticor x 25 kg" / "plasticor x 25 kg holcim"),
  // siempre que el corto diga algo concreto: "tubos" a secas calza con todo.
  const chico = a.palabras.length <= b.palabras.length ? a : b;
  const grande = chico === a ? b : a;
  const concreto = chico.palabras.length >= 2 || chico.numeros.length > 0;
  if (concreto && coincidencias(chico.palabras, grande.palabras) === chico.palabras.length) {
    return "parecido";
  }

  const union = a.palabras.length + b.palabras.length - comunes;
  return comunes / union >= 0.75 ? "parecido" : null;
}

/*
  Arma grupos de candidatos a unificar.
  `materiales` = [{ id, nombre, unidad, movimientos }].
  Cada grupo se arma alrededor del material más usado (el "principal"
  sugerido) para que no se encadenen parecidos de parecidos.
*/
export function sugerirGrupos(materiales) {
  const lista = materiales
    .map((m) => ({ ...m, partes: descomponer(m.nombre) }))
    .sort((x, y) => (y.movimientos || 0) - (x.movimientos || 0) || x.id - y.id);

  const asignado = new Set();
  const grupos = [];

  for (const semilla of lista) {
    if (asignado.has(semilla.id)) continue;
    const miembros = [];

    for (const otro of lista) {
      if (otro.id === semilla.id || asignado.has(otro.id)) continue;
      const nivel = comparar(semilla.partes, otro.partes);
      if (nivel) miembros.push({ ...otro, nivel });
    }

    if (!miembros.length) continue;

    asignado.add(semilla.id);
    for (const m of miembros) asignado.add(m.id);

    const limpiar = ({ partes, ...resto }) => resto;
    grupos.push({
      principal: limpiar(semilla),
      miembros: miembros.map(limpiar),
      seguro: miembros.every((m) => m.nivel === "igual"),
    });
  }

  // Primero los seguros, después por cantidad de uso.
  return grupos.sort(
    (a, b) =>
      Number(b.seguro) - Number(a.seguro) ||
      (b.principal.movimientos || 0) - (a.principal.movimientos || 0)
  );
}

/*
  Sugerencia de clase para el catálogo:
  - "maquina": se controla una por una (tiene número).
  - "herramienta": se controla por cantidad.
  - null: material común.
  Es sólo una sugerencia para la pantalla de clasificación.
*/
const MAQUINAS = [
  "amoladora", "hormigonera", "grupo electrogeno", "generador", "soldadora",
  "taladro", "rotomartillo", "roto martillo", "martillo demoledor", "sierra circular",
  "sensitiva", "vibrador", "compresor", "cortadora", "mezcladora", "freezer",
  "heladera", "ventilador", "anafe", "hidrolavadora", "atornillador", "caladora",
  "pulidora", "motosierra", "desmalezadora", "bomba", "maquina", "inverter",
];

const HERRAMIENTAS = [
  "pala", "pico", "balde", "carretilla", "cuchara", "fratacho", "llana", "nivel",
  "martillo", "tenaza", "pinza", "alicate", "destornillador", "llave francesa",
  "llave stilson", "serrucho", "tijera", "cortafierro", "maza", "escalera",
  "andamio", "puntal", "telescopico", "careta", "manguera nivel", "plomada",
  "regla", "cinta metrica", "metro plegable", "arco de sierra", "pistola",
  "botiquin", "vizcachera",
];

// Repuestos y consumibles DE una herramienta: siguen siendo materiales.
const CONSUMIBLES = /\b(disco|discos|mecha|mechas|hoja|hojas|lija|electrodo|electrodos|correa|rueda|cabo|repuesto|punta|puntas|broca|tanza|cepillo|carbon|carbones|hilo)\b/;

export function sugerirClase(nombre) {
  const t = sinAcentos(String(nombre ?? "").toLowerCase());
  if (CONSUMIBLES.test(t)) return null;
  if (/\b(para|p\/)\s*\w*\s*(hormigonera|carretilla|soldadora|amoladora|sensitiva|taladro)/.test(t)) return null;

  const contiene = (lista) =>
    lista.some((clave) => new RegExp(`(^|[^a-z])${clave}`).test(t));

  if (contiene(MAQUINAS)) return "maquina";
  if (contiene(HERRAMIENTAS)) return "herramienta";
  return null;
}
