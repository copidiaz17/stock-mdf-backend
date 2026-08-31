  import express from "express";
  import Obra from "../models/Obra.js";
  import Material from "../models/Material.js";
  import MaterialObra from "../models/MaterialObra.js";
  import MovimientoMaterial from "../models/MovimientoMaterial.js";
  import ItemObra from "../models/ItemObra.js";
  import { Op } from "sequelize";
  import { sequelize } from "../database.js";

  import { authMiddleware } from "./auth.js";

  import { hasRole, ROLES } from "../middlewares/authorization.js";

  const router = express.Router();

  /* ================================================
    HELPERS DE FECHA
    ================================================ */

  const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

  // Hoy en horario de Argentina (Render corre en UTC, así que no
  // podemos usar toISOString() a secas: después de las 21 hs daría mañana).
  function hoyISO() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date());
  }

  function esFechaValida(valor) {
    return (
      typeof valor === "string" &&
      RE_FECHA.test(valor) &&
      !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))
    );
  }

  /*
    Fecha "real" del movimiento con fallback al alta.
    Los movimientos viejos se cargaron antes de que el backend
    guardara fechaMovimiento, así que pueden tenerla nula: para
    esos usamos DATE(createdAt) y así no quedan fuera de los
    filtros ni del orden.
  */
  function fechaEfectiva() {
    return sequelize.fn(
      "COALESCE",
      sequelize.col("MovimientoMaterial.fechaMovimiento"),
      sequelize.fn("DATE", sequelize.col("MovimientoMaterial.createdAt"))
    );
  }

  // Traduce ?desde=&hasta= a condiciones sobre la fecha efectiva.
  // Devuelve { condiciones } o { error } si alguna fecha es inválida.
  function condicionesDeRango({ desde, hasta }) {
    const condiciones = [];

    if (desde) {
      if (!esFechaValida(desde)) {
        return { error: "El parámetro 'desde' debe tener formato AAAA-MM-DD" };
      }
      condiciones.push(sequelize.where(fechaEfectiva(), { [Op.gte]: desde }));
    }

    if (hasta) {
      if (!esFechaValida(hasta)) {
        return { error: "El parámetro 'hasta' debe tener formato AAAA-MM-DD" };
      }
      condiciones.push(sequelize.where(fechaEfectiva(), { [Op.lte]: hasta }));
    }

    if (desde && hasta && desde > hasta) {
      return { error: "El rango de fechas está invertido: 'desde' es posterior a 'hasta'" };
    }

    return { condiciones };
  }

  // Valida la fecha que manda el formulario de ingreso/salida.
  // Devuelve { fecha } o { error }.
  function fechaDelMovimiento(valor) {
    if (valor === undefined || valor === null || valor === "") {
      return { fecha: hoyISO() };
    }
    if (!esFechaValida(valor)) {
      return { error: "La fecha del movimiento debe tener formato AAAA-MM-DD" };
    }
    if (valor > hoyISO()) {
      return { error: "La fecha del movimiento no puede ser futura" };
    }
    return { fecha: valor };
  }

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
        const { materialId, cantidad, observaciones, itemObraId } = req.body;

        if (!materialId || !cantidad) {
          return res
            .status(400)
            .json({ message: "materialId y cantidad son obligatorios" });
        }

        const { fecha, error } = fechaDelMovimiento(req.body.fechaMovimiento);
        if (error) return res.status(400).json({ message: error });

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
          fechaMovimiento: fecha,
          itemObraId: itemObraId || null,
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
        const { materialId, cantidad, observaciones, itemObraId } = req.body;

        if (!materialId || !cantidad) {
          return res
            .status(400)
            .json({ message: "materialId y cantidad son obligatorios" });
        }

        // La salida se imputa siempre a un ítem de obra: sin eso no hay
        // forma de saber a qué partida se consumió el material.
        if (!itemObraId) {
          return res.status(400).json({
            message: "La salida debe estar imputada a un ítem de obra",
          });
        }

        const item = await ItemObra.findOne({
          where: { id: itemObraId, obraId },
        });

        if (!item) {
          return res.status(400).json({
            message: "El ítem de obra indicado no pertenece a esta obra",
          });
        }

        const { fecha, error } = fechaDelMovimiento(req.body.fechaMovimiento);
        if (error) return res.status(400).json({ message: error });

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
          fechaMovimiento: fecha,
          itemObraId,
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

    Filtros opcionales (query string):
      materialId  -> un material puntual
      itemObraId  -> un ítem de obra; "sin-imputar" trae los que no tienen
      tipo        -> "ingreso" | "salida"
      desde/hasta -> AAAA-MM-DD sobre la FECHA REAL del movimiento
      limit/offset-> paginado (limit por defecto 50, máximo 500)

    Responde { total, limit, offset, movimientos }.
    ================================================ */
  router.get(
    "/:id/movimientos",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obraId = req.params.id;
        const { materialId, itemObraId, tipo, desde, hasta } = req.query;

        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const condiciones = [{ obraId }];

        if (materialId) condiciones.push({ materialId });

        if (tipo) {
          if (!["ingreso", "salida"].includes(tipo)) {
            return res
              .status(400)
              .json({ message: "El tipo debe ser 'ingreso' o 'salida'" });
          }
          condiciones.push({ tipo });
        }

        if (itemObraId === "sin-imputar") {
          condiciones.push({ itemObraId: null });
        } else if (itemObraId) {
          condiciones.push({ itemObraId });
        }

        const rango = condicionesDeRango({ desde, hasta });
        if (rango.error) return res.status(400).json({ message: rango.error });
        condiciones.push(...rango.condiciones);

        const { count, rows } = await MovimientoMaterial.findAndCountAll({
          where: { [Op.and]: condiciones },
          attributes: {
            include: [[fechaEfectiva(), "fechaEfectiva"]],
          },
          include: [
            { model: Material, attributes: ["id", "nombre", "unidad"] },
            {
              model: ItemObra,
              attributes: ["id", "nombre", "codigo"],
              required: false,
            },
          ],
          order: [
            [fechaEfectiva(), "DESC"],
            ["id", "DESC"],
          ],
          limit,
          offset,
        });

        res.json({ total: count, limit, offset, movimientos: rows });
      } catch (error) {
        console.error("Error al obtener movimientos:", error);
        res.status(500).json({ message: "Error al obtener los movimientos" });
      }
    }
  );

  /* ================================================
    CONSUMO DE MATERIALES POR ÍTEM DE OBRA

    Agrupa las SALIDAS por ítem de obra y material, para responder
    "¿qué materiales se usaron en esta partida?".

    Filtros opcionales: itemObraId, desde, hasta.

    Ojo: no devolvemos un total de cantidad por ítem porque sumar
    bolsas + m3 + kg no significa nada. El total que sí sirve es la
    cantidad por material y cuántos movimientos hubo.
    ================================================ */
  router.get(
    "/:id/consumo-por-item",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
      try {
        const obraId = req.params.id;
        const { itemObraId, desde, hasta } = req.query;

        const condiciones = [{ obraId }, { tipo: "salida" }];

        if (itemObraId === "sin-imputar") {
          condiciones.push({ itemObraId: null });
        } else if (itemObraId) {
          condiciones.push({ itemObraId });
        }

        const rango = condicionesDeRango({ desde, hasta });
        if (rango.error) return res.status(400).json({ message: rango.error });
        condiciones.push(...rango.condiciones);

        const filas = await MovimientoMaterial.findAll({
          where: { [Op.and]: condiciones },
          attributes: [
            "itemObraId",
            "materialId",
            [
              sequelize.fn(
                "SUM",
                sequelize.col("MovimientoMaterial.cantidad")
              ),
              "cantidad",
            ],
            [
              sequelize.fn("COUNT", sequelize.col("MovimientoMaterial.id")),
              "movimientos",
            ],
            [sequelize.fn("MIN", fechaEfectiva()), "primerMovimiento"],
            [sequelize.fn("MAX", fechaEfectiva()), "ultimoMovimiento"],
          ],
          include: [
            { model: Material, attributes: ["nombre", "unidad"] },
            {
              model: ItemObra,
              attributes: ["nombre", "codigo"],
              required: false,
            },
          ],
          // Agrupamos por TODAS las columnas no agregadas que seleccionamos,
          // no sólo por los ids: con ONLY_FULL_GROUP_BY activo (Aiven trae
          // ese sql_mode por defecto) agrupar sólo por la PK falla si el
          // motor no infiere la dependencia funcional.
          group: [
            "MovimientoMaterial.itemObraId",
            "MovimientoMaterial.materialId",
            "Material.nombre",
            "Material.unidad",
            "ItemObra.nombre",
            "ItemObra.codigo",
          ],
          raw: true,
          nest: true,
        });

        // Armamos { ítem -> materiales[] } en memoria: son pocas filas
        // (materiales distintos por partida) y así el SQL queda simple.
        const porItem = new Map();

        for (const fila of filas) {
          const clave = fila.itemObraId ?? "sin-imputar";

          if (!porItem.has(clave)) {
            porItem.set(clave, {
              itemObraId: fila.itemObraId ?? null,
              codigo: fila.ItemObra?.codigo ?? null,
              nombre: fila.ItemObra?.nombre ?? "Sin imputar a ítem",
              movimientos: 0,
              materiales: [],
            });
          }

          const grupo = porItem.get(clave);
          const movimientos = Number(fila.movimientos) || 0;

          grupo.movimientos += movimientos;
          grupo.materiales.push({
            materialId: fila.materialId,
            nombre: fila.Material?.nombre ?? "(material eliminado)",
            unidad: fila.Material?.unidad ?? "",
            cantidad: Number(fila.cantidad) || 0,
            movimientos,
            primerMovimiento: fila.primerMovimiento,
            ultimoMovimiento: fila.ultimoMovimiento,
          });
        }

        const items = [...porItem.values()];

        for (const item of items) {
          item.materiales.sort((a, b) => a.nombre.localeCompare(b.nombre));
        }

        // Los imputados primero (por código, si tienen), "Sin imputar" al final.
        items.sort((a, b) => {
          if (!a.itemObraId) return 1;
          if (!b.itemObraId) return -1;
          return (a.codigo || a.nombre).localeCompare(b.codigo || b.nombre);
        });

        res.json({
          obraId: Number(obraId),
          desde: desde || null,
          hasta: hasta || null,
          items,
        });
      } catch (error) {
        console.error("Error al calcular consumo por ítem:", error);
        res
          .status(500)
          .json({ message: "Error al calcular el consumo por ítem de obra" });
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
