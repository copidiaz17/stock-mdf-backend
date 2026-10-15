// backend/routes/maquinas.js
//
// Máquinas controladas una por una, cada una con su código (MAQ-001...).
// No hay depósito: siempre están en una obra, y se trasladan de obra a obra.
// Estados: en_uso -> en_reparacion -> en_uso ... -> baja.

import express from "express";
import { Op } from "sequelize";
import { sequelize } from "../database.js";
import Obra from "../models/Obra.js";
import Usuario from "../models/Usuario.js";
import Maquina from "../models/Maquina.js";
import MovimientoMaquina from "../models/MovimientoMaquina.js";
import { authMiddleware } from "./auth.js";
import { hasRole, ROLES } from "../middlewares/authorization.js";
import { fechaDelMovimiento } from "../lib/fechas.js";
import { siguienteCodigo, MOTIVOS_BAJA } from "../services/maquinas.js";

const router = express.Router();

const LEER = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER];
const CARGAR = [ROLES.ADMIN, ROLES.OPERATOR];

class ErrorDeCarga extends Error {}

function texto(valor, largo = 255) {
  const t = String(valor ?? "").trim();
  return t ? t.slice(0, largo) : null;
}

function responderError(res, error, contexto) {
  if (error instanceof ErrorDeCarga) return res.status(400).json({ message: error.message });
  if (error?.name === "SequelizeUniqueConstraintError") {
    return res.status(400).json({ message: "Ya existe una máquina con ese código" });
  }
  console.error(contexto, error);
  return res.status(500).json({ message: "Error interno, no se guardó nada" });
}

function fechaOError(valor) {
  const { fecha, error } = fechaDelMovimiento(valor);
  if (error) throw new ErrorDeCarga(error);
  return fecha;
}

async function obraOError(id, mensaje = "Elegí la obra") {
  const obra = await Obra.findByPk(Number(id));
  if (!obra) throw new ErrorDeCarga(mensaje);
  return obra;
}

// Carga la máquina con lock y aplica un cambio + su movimiento, todo junto.
async function cambiarMaquina(id, aplicar) {
  return sequelize.transaction(async (transaction) => {
    const maquina = await Maquina.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!maquina) throw new ErrorDeCarga("La máquina no existe");
    await aplicar(maquina, transaction);
    return maquina;
  });
}

/* ================================================
   LISTADO
   ?obraId=  ?estado=en_uso|en_reparacion|baja|activas(por defecto)|todas
   ?buscar=  (código, nombre o marca)
   ================================================ */
router.get("/", authMiddleware, hasRole(LEER), async (req, res) => {
  try {
    const where = {};
    const estado = req.query.estado || "activas";

    if (estado === "activas") where.estado = { [Op.ne]: "baja" };
    else if (estado !== "todas") where.estado = estado;

    if (req.query.obraId) where.obraId = Number(req.query.obraId);

    const buscar = texto(req.query.buscar, 100);
    if (buscar) {
      where[Op.or] = ["codigo", "nombre", "marca", "modelo"].map((campo) => ({
        [campo]: { [Op.like]: `%${buscar}%` },
      }));
    }

    const maquinas = await Maquina.findAll({
      where,
      include: [{ model: Obra, attributes: ["id", "nombre"] }],
      order: [["codigo", "ASC"]],
    });

    res.json(maquinas);
  } catch (error) {
    responderError(res, error, "Error al listar máquinas:");
  }
});

// Código sugerido para una máquina nueva.
router.get("/codigo-siguiente", authMiddleware, hasRole(LEER), async (req, res) => {
  try {
    res.json({ codigo: await siguienteCodigo() });
  } catch (error) {
    responderError(res, error, "Error al calcular código:");
  }
});

/* ================================================
   DETALLE CON HISTORIAL
   ================================================ */
router.get("/:id", authMiddleware, hasRole(LEER), async (req, res) => {
  try {
    const maquina = await Maquina.findByPk(req.params.id, {
      include: [{ model: Obra, attributes: ["id", "nombre"] }],
    });
    if (!maquina) return res.status(404).json({ message: "La máquina no existe" });

    const historial = await MovimientoMaquina.findAll({
      where: { maquinaId: maquina.id },
      include: [
        { model: Obra, as: "ObraOrigen", attributes: ["id", "nombre"] },
        { model: Obra, as: "ObraDestino", attributes: ["id", "nombre"] },
        { model: Usuario, attributes: ["id", "nombre"] },
      ],
      order: [
        ["fecha", "DESC"],
        ["id", "DESC"],
      ],
    });

    res.json({ maquina, historial });
  } catch (error) {
    responderError(res, error, "Error al obtener la máquina:");
  }
});

/* ================================================
   ALTA
   { nombre, marca, modelo, numeroSerie, codigo?, obraId, fecha, observaciones }
   ================================================ */
router.post("/", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const nombre = texto(req.body.nombre);
    if (!nombre) throw new ErrorDeCarga("Poné qué máquina es (ej.: Hormigonera 400 L)");
    const obra = await obraOError(req.body.obraId, "Elegí en qué obra está");
    const fecha = fechaOError(req.body.fecha);

    const maquina = await sequelize.transaction(async (transaction) => {
      const codigo = texto(req.body.codigo, 30) || (await siguienteCodigo(transaction));

      const nueva = await Maquina.create(
        {
          codigo,
          nombre,
          marca: texto(req.body.marca, 100),
          modelo: texto(req.body.modelo, 100),
          numeroSerie: texto(req.body.numeroSerie, 100),
          observaciones: texto(req.body.observaciones),
          obraId: obra.id,
          estado: "en_uso",
        },
        { transaction }
      );

      await MovimientoMaquina.create(
        {
          maquinaId: nueva.id,
          tipo: "alta",
          obraDestinoId: obra.id,
          fecha,
          observaciones: texto(req.body.observaciones),
          usuarioId: req.user?.id ?? null,
        },
        { transaction }
      );

      return nueva;
    });

    res.status(201).json(maquina);
  } catch (error) {
    responderError(res, error, "Error en alta de máquina:");
  }
});

/* ================================================
   EDITAR DATOS (no cambia de obra ni de estado)
   ================================================ */
router.put("/:id", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const maquina = await Maquina.findByPk(req.params.id);
    if (!maquina) throw new ErrorDeCarga("La máquina no existe");

    const nombre = texto(req.body.nombre);
    const codigo = texto(req.body.codigo, 30);
    if (!nombre) throw new ErrorDeCarga("El nombre no puede quedar vacío");
    if (!codigo) throw new ErrorDeCarga("El código no puede quedar vacío");

    await maquina.update({
      codigo,
      nombre,
      marca: texto(req.body.marca, 100),
      modelo: texto(req.body.modelo, 100),
      numeroSerie: texto(req.body.numeroSerie, 100),
      observaciones: texto(req.body.observaciones),
    });

    res.json(maquina);
  } catch (error) {
    responderError(res, error, "Error al editar máquina:");
  }
});

/* ================================================
   TRASLADO A OTRA OBRA   { obraDestinoId, fecha, observaciones }
   ================================================ */
router.post("/:id/traslado", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const destino = await obraOError(req.body.obraDestinoId, "Elegí la obra de destino");
    const fecha = fechaOError(req.body.fecha);

    await cambiarMaquina(req.params.id, async (maquina, transaction) => {
      if (maquina.estado !== "en_uso") {
        throw new ErrorDeCarga(
          maquina.estado === "baja"
            ? "La máquina está dada de baja"
            : "Está en reparación: registrá primero que volvió"
        );
      }
      if (maquina.obraId === destino.id) throw new ErrorDeCarga("Ya está en esa obra");

      const origen = maquina.obraId;
      await maquina.update({ obraId: destino.id }, { transaction });
      await MovimientoMaquina.create(
        {
          maquinaId: maquina.id,
          tipo: "traslado",
          obraOrigenId: origen,
          obraDestinoId: destino.id,
          fecha,
          observaciones: texto(req.body.observaciones),
          usuarioId: req.user?.id ?? null,
        },
        { transaction }
      );
    });

    res.json({ message: `Trasladada a ${destino.nombre}` });
  } catch (error) {
    responderError(res, error, "Error en traslado de máquina:");
  }
});

/* ================================================
   A REPARACIÓN   { fecha, observaciones }
   ================================================ */
router.post("/:id/reparacion", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const fecha = fechaOError(req.body.fecha);

    await cambiarMaquina(req.params.id, async (maquina, transaction) => {
      if (maquina.estado !== "en_uso") throw new ErrorDeCarga("Sólo una máquina en uso puede ir a reparación");

      await maquina.update({ estado: "en_reparacion" }, { transaction });
      await MovimientoMaquina.create(
        {
          maquinaId: maquina.id,
          tipo: "reparacion",
          obraOrigenId: maquina.obraId,
          fecha,
          observaciones: texto(req.body.observaciones),
          usuarioId: req.user?.id ?? null,
        },
        { transaction }
      );
    });

    res.json({ message: "Enviada a reparación" });
  } catch (error) {
    responderError(res, error, "Error al enviar a reparación:");
  }
});

/* ================================================
   VUELTA DE REPARACIÓN   { obraDestinoId, fecha, observaciones }
   Puede volver a otra obra distinta de la que salió.
   ================================================ */
router.post("/:id/vuelta", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const destino = await obraOError(req.body.obraDestinoId, "Elegí a qué obra vuelve");
    const fecha = fechaOError(req.body.fecha);

    await cambiarMaquina(req.params.id, async (maquina, transaction) => {
      if (maquina.estado !== "en_reparacion") throw new ErrorDeCarga("La máquina no está en reparación");

      await maquina.update({ estado: "en_uso", obraId: destino.id }, { transaction });
      await MovimientoMaquina.create(
        {
          maquinaId: maquina.id,
          tipo: "vuelta",
          obraDestinoId: destino.id,
          fecha,
          observaciones: texto(req.body.observaciones),
          usuarioId: req.user?.id ?? null,
        },
        { transaction }
      );
    });

    res.json({ message: `Volvió de reparación a ${destino.nombre}` });
  } catch (error) {
    responderError(res, error, "Error en vuelta de reparación:");
  }
});

/* ================================================
   BAJA   { motivo: rota|perdida|robada|otro, fecha, observaciones }
   ================================================ */
router.post("/:id/baja", authMiddleware, hasRole(CARGAR), async (req, res) => {
  try {
    const motivo = req.body.motivo;
    if (!MOTIVOS_BAJA.includes(motivo)) throw new ErrorDeCarga(`Elegí el motivo: ${MOTIVOS_BAJA.join(", ")}`);
    const fecha = fechaOError(req.body.fecha);

    await cambiarMaquina(req.params.id, async (maquina, transaction) => {
      if (maquina.estado === "baja") throw new ErrorDeCarga("Ya está dada de baja");

      await maquina.update({ estado: "baja" }, { transaction });
      await MovimientoMaquina.create(
        {
          maquinaId: maquina.id,
          tipo: "baja",
          obraOrigenId: maquina.obraId,
          motivo,
          fecha,
          observaciones: texto(req.body.observaciones),
          usuarioId: req.user?.id ?? null,
        },
        { transaction }
      );
    });

    res.json({ message: "Baja registrada" });
  } catch (error) {
    responderError(res, error, "Error en baja de máquina:");
  }
});

export default router;
