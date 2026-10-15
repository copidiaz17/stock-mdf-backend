// backend/scripts/unificar-identicos.js
//
// Unifica los materiales que tienen EXACTAMENTE el mismo nombre (salvo
// mayúsculas, espacios y acentos): "Bolsa de cuarzo" x 6, cables repetidos,
// etc. Los nombres parecidos pero distintos NO se tocan: esos se confirman
// a mano en la pantalla de Catálogo.
//
//   node scripts/unificar-identicos.js            -> muestra qué haría
//   node scripts/unificar-identicos.js --aplicar  -> lo hace
//
// Queda el más usado de cada grupo (el de más movimientos).

import { QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import { normalizarUnidad } from "../lib/unidades.js";
import { unificarMateriales } from "../services/unificacion.js";

const APLICAR = process.argv.includes("--aplicar");

function clave(nombre) {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

try {
  const materiales = await sequelize.query(
    `SELECT ma.id, ma.nombre, ma.unidad, ma.clase, COUNT(m.id) movimientos
       FROM materials ma LEFT JOIN movimientomaterials m ON m.materialId = ma.id
      WHERE ma.unificadoEnId IS NULL AND ma.clase IN ('material', 'herramienta')
      GROUP BY ma.id, ma.nombre, ma.unidad, ma.clase`,
    { type: QueryTypes.SELECT }
  );

  const grupos = new Map();
  for (const m of materiales) {
    const k = `${m.clase}|${clave(m.nombre)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push({ ...m, movimientos: Number(m.movimientos) });
  }

  const repetidos = [...grupos.values()].filter((g) => g.length > 1);
  console.log(`${repetidos.length} grupos de nombres idénticos${APLICAR ? "" : " (sin aplicar)"}:`);

  let total = 0;
  for (const grupo of repetidos) {
    grupo.sort((a, b) => b.movimientos - a.movimientos || a.id - b.id);
    const [principal, ...resto] = grupo;
    // La unidad: la del principal si es válida, si no la primera válida del grupo.
    const unidad = grupo.map((m) => normalizarUnidad(m.unidad)).find(Boolean) || null;

    console.log(
      ` - "${principal.nombre.trim()}" [${principal.movimientos} mov] <= ${resto.length} repetido(s)` +
        (unidad ? `, unidad: ${unidad}` : ", unidad: (revisar)")
    );

    if (APLICAR) {
      const r = await unificarMateriales({
        principalId: principal.id,
        duplicadosIds: resto.map((m) => m.id),
        nombre: principal.nombre.trim().replace(/\s+/g, " "),
        unidad,
      });
      total += r.unificados;
    }
  }

  if (APLICAR) console.log(`Listo: ${total} materiales unificados.`);
  else if (repetidos.length) console.log("\nPara aplicarlo: node scripts/unificar-identicos.js --aplicar");
} catch (error) {
  console.error("FALLÓ:", error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
