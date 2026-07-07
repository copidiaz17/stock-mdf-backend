  import express from "express";
  import Obra from "../models/Obra.js";
  import Material from "../models/Material.js";
  import MaterialObra from "../models/MaterialObra.js";
  import MovimientoMaterial from "../models/MovimientoMaterial.js";
  import ItemObra from "../models/ItemObra.js";
  import { Op } from "sequelize";

  import { authMiddleware } from "./auth.js";

  import { hasRole, ROLES } from "../middlewares/authorization.js";

  const router = express.Router();

  /* ================================================
    CREAR NUEVA OBRA (POST) - ADMIN / OPERADOR
    ================================================ */
  router.post(
    "/",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
    async (req, res) => {
      try {
        const { nombre, ubicacion } = req.body;

        if (!nombre) {
          return res.status(400).json({ message: "El nombre es obligatorio" });
        }

        const obra = await Obra.create({ nombre, ubicacion });
        res.status(201).json(obra);
      } catch (error) {
        console.error("Error al crear obra:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /* ================================================
    LISTAR TODAS LAS OBRAS
    ================================================ */
  router.get(
    "/",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obras = await Obra.findAll({
          attributes: ["id", "nombre", "ubicacion", "createdAt"],
        });

        res.json(obras);
      } catch (error) {
        console.error("ERROR CRÍTICO EN GET /OBRAS:", error);
        res.status(500).json({
          error: "Fallo interno al obtener la lista de obras.",
        });
      }
    }
  );

  /* ================================================
    DETALLE DE UNA OBRA
    ================================================ */
  router.get(
    "/:id",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obra = await Obra.findByPk(req.params.id);
        if (!obra)
          return res.status(404).json({ message: "Obra no encontrada" });

        res.json(obra);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  /* ================================================
    OBTENER MATERIALES DE UNA OBRA
    ================================================ */
  router.get(
    "/:id/materiales",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obraId = req.params.id;

        const materialesObra = await MaterialObra.findAll({
          where: { ObraId: obraId },
          include: [
            {
              model: Material,
              attributes: ["id", "nombre", "unidad"],
            },
          ],
        });

        const resultado = materialesObra
          .filter((mo) => mo.cantidad > 0)
          .map((mo) => ({
            id: mo.Material.id,
            nombre: mo.Material.nombre,
            unidad: mo.Material.unidad,
            MaterialObra: {
              cantidad: mo.cantidad,
              observaciones: mo.observaciones,
            },
          }));

        res.json(resultado);
      } catch (error) {
        console.error("ERROR CRÍTICO AL CARGAR MATERIALES:", error);
        res.status(500).json({
          error: "Fallo al obtener el stock de materiales.",
        });
      }
    }
  );

  /* ================================================
    INGRESO DE MATERIAL A OBRA  (POST)
    ================================================ */
  router.post(
    "/:id/ingreso",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
    async (req, res) => {
      try {
        const obraId = req.params.id;
        const { materialId, cantidad, observaciones } = req.body;

        if (!materialId || !cantidad) {
          return res
            .status(400)
            .json({ message: "materialId y cantidad son obligatorios" });
        }

        let materialObra = await MaterialObra.findOne({
          where: { ObraId: obraId, MaterialId: materialId },
        });

        if (!materialObra) {
          materialObra = await MaterialObra.create({
            ObraId: obraId,
            MaterialId: materialId,
            cantidad: 0,
          });
        }

        materialObra.cantidad += Number(cantidad);
        await materialObra.save();

        await MovimientoMaterial.create({
          obraId,
          materialId,
          cantidad,
          tipo: "ingreso",
          observaciones,
        });

        res.json({ message: "Ingreso registrado correctamente" });
      } catch (error) {
        console.error("Error en ingreso:", error);
        res.status(500).json({ error: "Error al registrar ingreso" });
      }
    }
  );

  /* ================================================
    SALIDA DE MATERIAL (POST)
    ================================================ */
  router.post(
    "/:id/salida",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
    async (req, res) => {
      try {
        const obraId = req.params.id;
        const { materialId, cantidad, observaciones } = req.body;

        if (!materialId || !cantidad) {
          return res
            .status(400)
            .json({ message: "materialId y cantidad son obligatorios" });
        }

        const materialObra = await MaterialObra.findOne({
          where: { ObraId: obraId, MaterialId: materialId },
        });

        if (!materialObra || materialObra.cantidad < cantidad) {
          return res.status(400).json({
            message: "Stock insuficiente o material no existente",
          });
        }

        materialObra.cantidad -= Number(cantidad);
        await materialObra.save();

        await MovimientoMaterial.create({
          obraId,
          materialId,
          cantidad,
          tipo: "salida",
          observaciones,
        });

        res.json({ message: "Salida registrada correctamente" });
      } catch (error) {
        console.error("Error en salida:", error);
        res.status(500).json({ error: "Error al registrar salida" });
      }
    }
  );

  /* ================================================
    HISTORIAL DE MOVIMIENTOS POR OBRA
    ================================================ */
  router.get(
    "/:id/movimientos",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obraId = req.params.id;

        const movimientos = await MovimientoMaterial.findAll({
          where: { obraId },
          include: [{ model: Material, attributes: ["nombre"] }],
          order: [["createdAt", "DESC"]],
          limit: 50,
        });

        res.json(movimientos);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  router.get(
  "/:id/items",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
  async (req, res) => {
    try {
      const obraId = req.params.id;

      const items = await ItemObra.findAll({
        where: { obraId }, // ✅ CLAVE
        attributes: ["id", "nombre", "codigo"],
        order: [["nombre", "ASC"]],
      });

      res.json(items);
    } catch (error) {
      console.error("Error al obtener ítems de obra:", error);
      res.status(500).json({
        message: "Error al obtener ítems de obra",
      });
    }
  }
);

router.post(
  "/:id/items",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
  async (req, res) => {
    try {
      const obraId = req.params.id;
      const { nombre, codigo } = req.body;

      if (!nombre) {
        return res.status(400).json({
          message: "El nombre del ítem es obligatorio",
        });
      }

      const item = await ItemObra.create({
        obraId,
        nombre,
        codigo,
      });

      res.status(201).json(item);
    } catch (error) {
      console.error("Error al crear ítem:", error);

      // error por índice único (obraId + nombre)
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          message: "Ya existe un ítem con ese nombre en esta obra",
        });
      }

      res.status(500).json({
        message: "Error interno al crear el ítem",
      });
    }
  }
);


/* ================================================
   ELIMINAR OBRA (DELETE) - SOLO ADMIN
   ================================================ */
/* ================================================
   ELIMINAR OBRA (DELETE)
   ================================================ */
router.delete(
  "/:id",
  authMiddleware,
  hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
  async (req, res) => {
    try {
      const obraId = req.params.id;

      console.log("🗑 Eliminando obra ID:", obraId);

      // 1️⃣ Eliminar movimientos
      await MovimientoMaterial.destroy({ where: { obraId } });

      // 2️⃣ Eliminar relación materiales-obra
      await MaterialObra.destroy({ where: { ObraId: obraId } });

      // 3️⃣ Eliminar ítems de obra
      await ItemObra.destroy({ where: { obraId } });

      // 4️⃣ Eliminar la obra
      const eliminadas = await Obra.destroy({ where: { id: obraId } });

      if (!eliminadas) {
        return res.status(404).json({ message: "Obra no encontrada" });
      }

      res.json({ message: "Obra eliminada correctamente" });
    } catch (error) {
      console.error("❌ Error eliminando obra:", error);
      res.status(500).json({ message: "Error al eliminar obra" });
    }
  }
);

   
  


  export default router;
