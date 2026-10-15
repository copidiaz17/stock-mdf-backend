// backend/services/unificacion.js
//
// Junta varios materiales que son el mismo con distinto nombre.
// Todo pasa al "principal": movimientos, saldos por obra y los que ya se
// habían unificado antes en alguno de los repetidos. Los repetidos no se
// borran: quedan marcados con unificadoEnId (y cada movimiento recuerda en
// materialOriginalId con qué nombre se cargó), así se puede auditar.

import { QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import { normalizarUnidad } from "../lib/unidades.js";

export class ErrorUnificacion extends Error {}

export async function unificarMateriales({ principalId, duplicadosIds, nombre, unidad }) {
  const principal = Number(principalId);
  const repetidos = [...new Set((duplicadosIds || []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0 && id !== principal
  );

  if (!Number.isInteger(principal) || principal <= 0) {
    throw new ErrorUnificacion("Falta el material que queda.");
  }
  if (!repetidos.length) {
    throw new ErrorUnificacion("Elegí al menos un material para unificar.");
  }

  let unidadFinal = null;
  if (unidad !== undefined && unidad !== null && unidad !== "") {
    unidadFinal = normalizarUnidad(unidad);
    if (!unidadFinal) throw new ErrorUnificacion(`La unidad "${unidad}" no está en la lista.`);
  }

  const nombreFinal = nombre === undefined || nombre === null ? null : String(nombre).trim();
  if (nombreFinal === "") throw new ErrorUnificacion("El nombre no puede quedar vacío.");

  return sequelize.transaction(async (transaction) => {
    const q = (sql, replacements, type = QueryTypes.SELECT) =>
      sequelize.query(sql, { replacements, type, transaction });

    const todos = await q(
      `SELECT id, nombre, clase, unificadoEnId FROM materials WHERE id IN (:ids) FOR UPDATE`,
      { ids: [principal, ...repetidos] }
    );
    const porId = new Map(todos.map((m) => [m.id, m]));

    const elPrincipal = porId.get(principal);
    if (!elPrincipal) throw new ErrorUnificacion("El material que queda no existe.");
    if (elPrincipal.unificadoEnId) throw new ErrorUnificacion(`"${elPrincipal.nombre}" ya fue unificado con otro.`);
    if (elPrincipal.clase === "maquina") throw new ErrorUnificacion("Las máquinas no se unifican desde el catálogo.");

    for (const id of repetidos) {
      const m = porId.get(id);
      if (!m) throw new ErrorUnificacion(`El material ${id} no existe.`);
      if (m.unificadoEnId) throw new ErrorUnificacion(`"${m.nombre}" ya fue unificado con otro.`);
      if (m.clase !== elPrincipal.clase) {
        throw new ErrorUnificacion(
          `"${m.nombre}" es ${m.clase} y "${elPrincipal.nombre}" es ${elPrincipal.clase}: primero hay que clasificarlos igual.`
        );
      }
    }

    let movimientos = 0;
    const obrasAfectadas = new Set();

    for (const id of repetidos) {
      // 1. Movimientos: pasan al principal, recordando con qué se cargaron.
      const [resultado, meta] = await sequelize.query(
        `UPDATE movimientomaterials
            SET materialOriginalId = COALESCE(materialOriginalId, materialId),
                materialId = :principal
          WHERE materialId = :id`,
        { replacements: { principal, id }, transaction }
      );
      movimientos += resultado?.affectedRows ?? meta?.affectedRows ?? 0;

      // 2. Saldos por obra: si el principal ya tiene fila en esa obra se
      //    suman; si no, la fila del repetido pasa a ser del principal.
      const saldos = await q(
        `SELECT ObraId, cantidad FROM materialobras WHERE MaterialId = :id FOR UPDATE`,
        { id }
      );

      for (const s of saldos) {
        obrasAfectadas.add(s.ObraId);
        const [existente] = await q(
          `SELECT cantidad FROM materialobras WHERE ObraId = :obra AND MaterialId = :principal FOR UPDATE`,
          { obra: s.ObraId, principal }
        );

        if (existente) {
          await q(
            `UPDATE materialobras SET cantidad = cantidad + :suma, updatedAt = NOW()
              WHERE ObraId = :obra AND MaterialId = :principal`,
            { suma: s.cantidad, obra: s.ObraId, principal },
            QueryTypes.UPDATE
          );
          await q(
            `DELETE FROM materialobras WHERE ObraId = :obra AND MaterialId = :id`,
            { obra: s.ObraId, id },
            QueryTypes.DELETE
          );
        } else {
          await q(
            `UPDATE materialobras SET MaterialId = :principal, updatedAt = NOW()
              WHERE ObraId = :obra AND MaterialId = :id`,
            { principal, obra: s.ObraId, id },
            QueryTypes.UPDATE
          );
        }
      }

      // 3. Los que antes se habían unificado en este repetido, ahora
      //    apuntan al principal (no quedan cadenas).
      await q(
        `UPDATE materials SET unificadoEnId = :principal WHERE unificadoEnId = :id`,
        { principal, id },
        QueryTypes.UPDATE
      );

      await q(
        `UPDATE materials SET unificadoEnId = :principal, updatedAt = NOW() WHERE id = :id`,
        { principal, id },
        QueryTypes.UPDATE
      );
    }

    if (nombreFinal || unidadFinal) {
      await q(
        `UPDATE materials
            SET nombre = COALESCE(:nombre, nombre),
                unidad = COALESCE(:unidad, unidad),
                updatedAt = NOW()
          WHERE id = :principal`,
        { nombre: nombreFinal, unidad: unidadFinal, principal },
        QueryTypes.UPDATE
      );
    }

    return {
      principalId: principal,
      unificados: repetidos.length,
      movimientos,
      obras: obrasAfectadas.size,
    };
  });
}
