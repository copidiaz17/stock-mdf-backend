// backend/scripts/migrar-herramientas.js
//
// Prepara la base para herramientas, máquinas y unificación de materiales.
// Se puede correr varias veces: sólo agrega lo que falta.
//
//   node scripts/migrar-herramientas.js            -> muestra qué haría
//   node scripts/migrar-herramientas.js --aplicar  -> lo hace
//
// Usa la base del .env (o de las variables DB_* si ya están definidas).
// No borra ni modifica datos, salvo pasar las unidades escritas a mano
// ("Unidad", "ud", "mts"...) a la unidad de la lista.

import { QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import { normalizarUnidad } from "../lib/unidades.js";

const APLICAR = process.argv.includes("--aplicar");

async function columnas(tabla) {
  const filas = await sequelize.query(`SHOW COLUMNS FROM \`${tabla}\``, { type: QueryTypes.SELECT });
  return new Set(filas.map((f) => f.Field));
}

async function existeTabla(tabla) {
  const filas = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :tabla`,
    { replacements: { tabla }, type: QueryTypes.SELECT }
  );
  return filas.length > 0;
}

const pasos = [];
function paso(descripcion, sql) {
  pasos.push({ descripcion, sql });
}

async function planificar() {
  const mat = await columnas("materials");
  if (!mat.has("clase")) {
    paso("materials.clase", "ALTER TABLE materials ADD COLUMN clase VARCHAR(20) NOT NULL DEFAULT 'material'");
  }
  if (!mat.has("unificadoEnId")) {
    paso("materials.unificadoEnId", "ALTER TABLE materials ADD COLUMN unificadoEnId INT NULL, ADD INDEX idx_materials_unificado (unificadoEnId)");
  }

  const mov = await columnas("movimientomaterials");
  if (!mov.has("usuarioId")) {
    paso("movimientomaterials.usuarioId", "ALTER TABLE movimientomaterials ADD COLUMN usuarioId INT NULL");
  }
  if (!mov.has("obraRelacionadaId")) {
    paso("movimientomaterials.obraRelacionadaId", "ALTER TABLE movimientomaterials ADD COLUMN obraRelacionadaId INT NULL");
  }
  if (!mov.has("motivo")) {
    paso("movimientomaterials.motivo", "ALTER TABLE movimientomaterials ADD COLUMN motivo VARCHAR(30) NULL");
  }
  if (!mov.has("materialOriginalId")) {
    paso("movimientomaterials.materialOriginalId", "ALTER TABLE movimientomaterials ADD COLUMN materialOriginalId INT NULL");
  }

  if (!(await existeTabla("maquinas"))) {
    paso(
      "tabla maquinas",
      `CREATE TABLE maquinas (
         id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
         codigo VARCHAR(30) NOT NULL,
         nombre VARCHAR(255) NOT NULL,
         marca VARCHAR(100) NULL,
         modelo VARCHAR(100) NULL,
         numeroSerie VARCHAR(100) NULL,
         obraId INT NULL,
         estado VARCHAR(20) NOT NULL DEFAULT 'en_uso',
         observaciones VARCHAR(255) NULL,
         materialOrigenId INT NULL,
         createdAt DATETIME NOT NULL,
         updatedAt DATETIME NOT NULL,
         UNIQUE KEY uq_maquinas_codigo (codigo),
         KEY idx_maquinas_obra (obraId),
         KEY idx_maquinas_estado (estado)
       )`
    );
  }

  if (!(await existeTabla("movimientomaquinas"))) {
    paso(
      "tabla movimientomaquinas",
      `CREATE TABLE movimientomaquinas (
         id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
         maquinaId INT NOT NULL,
         tipo VARCHAR(20) NOT NULL,
         obraOrigenId INT NULL,
         obraDestinoId INT NULL,
         fecha DATE NOT NULL,
         motivo VARCHAR(30) NULL,
         observaciones VARCHAR(255) NULL,
         usuarioId INT NULL,
         createdAt DATETIME NOT NULL,
         updatedAt DATETIME NOT NULL,
         KEY idx_movmaq_maquina (maquinaId)
       )`
    );
  }
}

// Unidades escritas a mano -> unidad de la lista. Las que no se pueden
// deducir ("200", "10m", vacías) quedan igual para corregir en el catálogo.
async function planificarUnidades() {
  const materiales = await sequelize.query(`SELECT id, unidad FROM materials`, { type: QueryTypes.SELECT });
  const cambios = new Map();
  let sinDeducir = 0;

  for (const m of materiales) {
    const nueva = normalizarUnidad(m.unidad);
    if (!nueva) {
      sinDeducir++;
      continue;
    }
    if (nueva !== m.unidad) {
      if (!cambios.has(nueva)) cambios.set(nueva, []);
      cambios.get(nueva).push(m);
    }
  }

  for (const [nueva, lista] of cambios) {
    const antes = [...new Set(lista.map((m) => JSON.stringify(m.unidad)))].join(", ");
    paso(
      `unidad ${antes} -> "${nueva}" (${lista.length} materiales)`,
      { sql: "UPDATE materials SET unidad = :nueva WHERE id IN (:ids)", replacements: { nueva, ids: lista.map((m) => m.id) } }
    );
  }

  return sinDeducir;
}

try {
  const [{ base }] = await sequelize.query("SELECT DATABASE() base", { type: QueryTypes.SELECT });
  console.log(`Base: ${base} en ${process.env.DB_HOST}`);

  await planificar();
  // Las unidades se planifican después de que exista todo lo demás.
  const sinDeducir = await planificarUnidades();

  if (!pasos.length) {
    console.log("No hay nada para hacer: la base ya está al día.");
  } else {
    console.log(`${APLICAR ? "Aplicando" : "Se haría"}:`);
    for (const p of pasos) {
      console.log(` - ${p.descripcion}`);
      if (APLICAR) {
        if (typeof p.sql === "string") await sequelize.query(p.sql);
        else await sequelize.query(p.sql.sql, { replacements: p.sql.replacements });
      }
    }
  }
  console.log(`Unidades que no se pueden deducir (se corrigen en el catálogo): ${sinDeducir}`);
  if (!APLICAR && pasos.length) console.log("\nPara aplicarlo: node scripts/migrar-herramientas.js --aplicar");
} catch (error) {
  console.error("FALLÓ:", error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
