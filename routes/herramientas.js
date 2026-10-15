// backend/routes/herramientas.js
//
// Herramientas que se controlan POR CANTIDAD en cada obra (palas, baldes,
// carretillas...). Usan el mismo saldo por obra que los materiales
// (materialobras) pero no se consumen ni se imputan a ítems: se dan de
// alta, se trasladan de una obra a otra y se dan de baja.
//
// Montado en /obras/:obraId/herramientas

import express from "express";
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import Obra from "../models/Obra.js";
import Material from "../models/Material.js";
import MovimientoMaterial from "../models/MovimientoMaterial.js";
import { authMiddleware } from "./auth.js";
import { hasRole, ROLES } from "../middlewares/authorization.js";
import { fechaDelMovimiento, cantidadValida } from "../lib/fechas.js";
import { MOTIVOS_BAJA } from "../services/maquinas.js";

const router = express.Router({ mergeParams: true });

const TIPOS_HERRAMIENTA = ["ingreso", "traslado_salida", "traslado_ingreso", "baja", "salida"];

class ErrorDeCarga extends Error {}

// Valida obra + herramienta + cantidad + fecha comunes a alta/traslado/baja.
async function validarBase(req) {
  const obraId = Number(req.params.obraId);
  const obra = await Obra.findByPk(obraId);
  if (!obra) throw new ErrorDeCarga("La obra no existe");

  const material = await Material.findByPk(req.body.materialId);
  if (!material || material.unificadoEnId) throw new ErrorDeCarga("La herramienta no existe");
  if (material.clase !== "herramienta") {
    throw new ErrorDeCarga(`"${material.nombre}" no está clasificada como herramienta`);
  }

  const cantidad = cantidadValida(req.body.cantidad);
  if (!cantidad) throw new ErrorDeCarga("La cantidad tiene que ser un número entero mayor que cero");

  const { fecha, error } = fechaDelMovimiento(req.body.fecha);
  if (error) throw new ErrorDeCarga(error);

  const observaciones = String(req.body.observaciones || "").trim().slice(0, 255) || null;

  return { obraId, obra, material, cantidad, fecha, observaciones };
}

// Suma (o resta, con delta negativo) al saldo de una herramienta en una obra.
// Con lock de fila: dos traslados al mismo tiempo no pisan el saldo.
async function moverSaldo(obraId, materialId, delta, transaction) {
  const [fila] = await sequelize.query(
    `SELECT cantidad FROM materialobras WHERE ObraId = :obraId AND MaterialId = :materialId FOR UPDATE`,
    { replacements: { obraId, materialId }, type: QueryTypes.SELECT, transaction }
  );

  const actual = fila ? Number(fila.cantidad) : 0;
  if (actual + delta < 0) {
    throw new ErrorDeCarga(`No alcanza: en la obra hay ${actual}`);
  }

  if (fila) {
    await sequelize.query(
      `UPDATE materialobras SET cantidad = cantidad + :delta, updatedAt = NOW()
        WHERE ObraId = :obraId AND MaterialId = :materialId`,
      { replacements: { obraId, materialId, delta }, transaction }
    );
  } else {
    await sequelize.query(
      `INSERT INTO materialobras (ObraId, MaterialId, cantidad, createdAt, updatedAt)
       VALUES (:obraId, :materialId, :delta, NOW(), NOW())`,
      { replacements: { obraId, materialId, delta }, transaction }
    );
  }
}

function responderError(res, error, contexto) {
  if (error instanceof ErrorDeCarga) {
    return res.status(400).json({ message: error.message });
  }
  console.error(contexto, error);
  return res.status(500).json({ message: "Error interno, no se guardó nada" });
}

/* ================================================
   HERRAMIENTAS EN LA OBRA
   ================================================ */
router.get(
  "/",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
  async (req, res) => {
    try {
      const filas = await sequelize.query(
        `SELECT ma.id, ma.nombre, ma.unidad, mo.cantidad
           FROM materialobras mo JOIN materials ma ON ma.id = mo.MaterialId
          WHERE mo.ObraId = :obraId AND mo.cantidad > 0
            AND ma.clase = 'herramienta' AND ma.unificadoEnId IS NULL
          ORDER BY ma.nombre`,
        { replacements: { obraId: req.params.obraId }, type: QueryTypes.SELECT }
      );
      res.json(filas);
    } catch (error) {
      responderError(res, error, "Error al listar herramientas:");
    }
  }
);

/* ================================================
   MOVIMIENTOS DE HERRAMIENTAS DE LA OBRA
   ?limit= (50 por defecto, máximo 500)
   ================================================ */
router.get(
  "/movimientos",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

      const { count, rows } = await MovimientoMaterial.findAndCountAll({
        where: { obraId: req.params.obraId, tipo: { [Op.in]: TIPOS_HERRAMIENTA } },
        include: [
          {
            model: Material,
            attributes: ["id", "nombre", "unidad"],
            where: { clase: "herramienta" },
            required: true,
          },
          { model: Obra, as: "ObraRelacionada", attributes: ["id", "nombre"], required: false },
        ],
        order: [
          ["fechaMovimiento", "DESC"],
          ["id", "DESC"],
        ],
        limit,
      });

      res.json({ total: count, movimientos: rows });
    } catch (error) {
      responderError(res, error, "Error al listar movimientos de herramientas:");
    }
  }
);

/* ================================================
   ALTA (compra o llegada de herramientas a la obra)
   { materialId, cantidad, fecha, observaciones }
   ================================================ */
router.post(
  "/alta",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
  async (req, res) => {
    try {
      const d = await validarBase(req);

      await sequelize.transaction(async (transaction) => {
        await moverSaldo(d.obraId, d.material.id, d.cantidad, transaction);
        await MovimientoMaterial.create(
          {
            obraId: d.obraId,
            materialId: d.material.id,
            cantidad: d.cantidad,
            tipo: "ingreso",
            fechaMovimiento: d.fecha,
            observaciones: d.observaciones,
            usuarioId: req.user?.id ?? null,
          },
          { transaction }
        );
      });

      res.json({ message: "Alta registrada" });
    } catch (error) {
      responderError(res, error, "Error en alta de herramienta:");
    }
  }
);

/* ================================================
   TRASLADO A OTRA OBRA
   { materialId, cantidad, obraDestinoId, fecha, observaciones }
   Sale de esta obra y entra en la otra, en la misma transacción.
   ================================================ */
router.post(
  "/traslado",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
  async (req, res) => {
    try {
      const d = await validarBase(req);

      const destinoId = Number(req.body.obraDestinoId);
      if (destinoId === d.obraId) throw new ErrorDeCarga("La obra de destino es la misma");
      const destino = await Obra.findByPk(destinoId);
      if (!destino) throw new ErrorDeCarga("Elegí la obra de destino");

      await sequelize.transaction(async (transaction) => {
        await moverSaldo(d.obraId, d.material.id, -d.cantidad, transaction);
        await moverSaldo(destinoId, d.material.id, d.cantidad, transaction);

        const comun = {
          materialId: d.material.id,
          cantidad: d.cantidad,
          fechaMovimiento: d.fecha,
          observaciones: d.observaciones,
          usuarioId: req.user?.id ?? null,
        };

        await MovimientoMaterial.create(
          { ...comun, obraId: d.obraId, tipo: "traslado_salida", obraRelacionadaId: destinoId },
          { transaction }
        );
        await MovimientoMaterial.create(
          { ...comun, obraId: destinoId, tipo: "traslado_ingreso", obraRelacionadaId: d.obraId },
          { transaction }
        );
      });

      res.json({ message: `Trasladado a ${destino.nombre}` });
    } catch (error) {
      responderError(res, error, "Error en traslado de herramienta:");
    }
  }
);

/* ================================================
   BAJA (rota, perdida, robada u otro)
   { materialId, cantidad, motivo, fecha, observaciones }
   ================================================ */
router.post(
  "/baja",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
  async (req, res) => {
    try {
      const d = await validarBase(req);

      const motivo = req.body.motivo;
      if (!MOTIVOS_BAJA.includes(motivo)) {
        throw new ErrorDeCarga(`Elegí el motivo: ${MOTIVOS_BAJA.join(", ")}`);
      }

      await sequelize.transaction(async (transaction) => {
        await moverSaldo(d.obraId, d.material.id, -d.cantidad, transaction);
        await MovimientoMaterial.create(
          {
            obraId: d.obraId,
            materialId: d.material.id,
            cantidad: d.cantidad,
            tipo: "baja",
            motivo,
            fechaMovimiento: d.fecha,
            observaciones: d.observaciones,
            usuarioId: req.user?.id ?? null,
          },
          { transaction }
        );
      });

      res.json({ message: "Baja registrada" });
    } catch (error) {
      responderError(res, error, "Error en baja de herramienta:");
    }
  }
);

export default router;
