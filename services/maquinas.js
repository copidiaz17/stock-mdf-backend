// backend/services/maquinas.js

import { QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import Maquina from "../models/Maquina.js";
import MovimientoMaquina from "../models/MovimientoMaquina.js";

export const MOTIVOS_BAJA = ["rota", "perdida", "robada", "otro"];

// Errores con mensaje para mostrarle al usuario tal cual.
export class ErrorConversion extends Error {}

// Siguiente código libre: MAQ-001, MAQ-002...
export async function siguienteCodigo(transaction) {
  const [fila] = await sequelize.query(
    `SELECT MAX(CAST(SUBSTRING(codigo, 5) AS UNSIGNED)) n
       FROM maquinas WHERE codigo REGEXP '^MAQ-[0-9]+$'`,
    { type: QueryTypes.SELECT, transaction }
  );
  const n = Number(fila?.n || 0) + 1;
  return `MAQ-${String(n).padStart(3, "0")}`;
}

/*
  Convierte un material que en realidad son máquinas (p. ej. "Amoladora
  grande", 3 en Chacarera y 1 en Icaño) en máquinas con número, una por
  unidad y en la obra donde estaba. El material queda con clase "maquina"
  para conservar su historial, y deja de aparecer en materiales.
*/
export const TOPE_CONVERSION = 60;

export async function convertirEnMaquinas(materialId, usuarioId, fecha) {
  return sequelize.transaction(async (transaction) => {
    const [material] = await sequelize.query(
      `SELECT id, nombre, clase, unificadoEnId FROM materials WHERE id = :id FOR UPDATE`,
      { replacements: { id: materialId }, type: QueryTypes.SELECT, transaction }
    );

    if (!material || material.unificadoEnId) {
      throw new ErrorConversion("El material no existe.");
    }
    if (material.clase === "maquina") {
      throw new ErrorConversion("Ya se convirtió en máquinas.");
    }

    const saldos = await sequelize.query(
      `SELECT mo.ObraId obraId, mo.cantidad, o.nombre obra
         FROM materialobras mo JOIN obras o ON o.id = mo.ObraId
        WHERE mo.MaterialId = :id AND mo.cantidad > 0
        ORDER BY o.nombre`,
      { replacements: { id: materialId }, type: QueryTypes.SELECT, transaction }
    );

    const total = saldos.reduce((s, x) => s + x.cantidad, 0);
    if (total > TOPE_CONVERSION) {
      throw new ErrorConversion(
        `Serían ${total} máquinas. Si de verdad son tantas, se controlan mejor como herramienta por cantidad.`
      );
    }

    const creadas = [];
    let codigo = await siguienteCodigo(transaction);

    for (const s of saldos) {
      for (let i = 0; i < s.cantidad; i++) {
        const maquina = await Maquina.create(
          {
            codigo,
            nombre: material.nombre.trim(),
            obraId: s.obraId,
            estado: "en_uso",
            materialOrigenId: material.id,
          },
          { transaction }
        );

        await MovimientoMaquina.create(
          {
            maquinaId: maquina.id,
            tipo: "alta",
            obraDestinoId: s.obraId,
            fecha,
            observaciones: `Alta inicial: estaba cargada como material (${s.cantidad} en ${s.obra})`,
            usuarioId,
          },
          { transaction }
        );

        creadas.push({ id: maquina.id, codigo, obra: s.obra });
        const n = Number(codigo.slice(4)) + 1;
        codigo = `MAQ-${String(n).padStart(3, "0")}`;
      }
    }

    await sequelize.query(
      `UPDATE materials SET clase = 'maquina', updatedAt = NOW() WHERE id = :id`,
      { replacements: { id: materialId }, transaction }
    );

    return { material: material.nombre, creadas };
  });
}
