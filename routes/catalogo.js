// backend/routes/catalogo.js
//
// Administración del catálogo (sólo ADMIN):
// - ver todos los materiales con cuánto se usan
// - sugerencias y ejecución de UNIFICACIÓN de repetidos
// - sugerencias y cambio de CLASE (material / herramienta / máquina)

import express from "express";
import { QueryTypes } from "sequelize";
import { sequelize } from "../database.js";
import Material from "../models/Material.js";
import { authMiddleware } from "./auth.js";
import { hasRole, ROLES } from "../middlewares/authorization.js";
import { normalizarUnidad, UNIDADES } from "../lib/unidades.js";
import { sugerirGrupos, sugerirClase } from "../lib/similitud.js";
import { unificarMateriales, ErrorUnificacion } from "../services/unificacion.js";
import { convertirEnMaquinas, ErrorConversion } from "../services/maquinas.js";
import { hoyISO } from "../lib/fechas.js";

const router = express.Router();
const SOLO_ADMIN = [authMiddleware, hasRole([ROLES.ADMIN])];

// Catálogo vigente con datos de uso.
async function catalogoConUso() {
  return sequelize.query(
    `SELECT ma.id, ma.nombre, ma.unidad, ma.clase,
            COALESCE(mv.movimientos, 0) movimientos,
            mv.ultimo,
            COALESCE(st.stock, 0) stock,
            COALESCE(st.obras, 0) obrasConStock
       FROM materials ma
       LEFT JOIN (
         SELECT materialId, COUNT(*) movimientos,
                MAX(COALESCE(fechaMovimiento, DATE(createdAt))) ultimo
           FROM movimientomaterials GROUP BY materialId
       ) mv ON mv.materialId = ma.id
       LEFT JOIN (
         SELECT MaterialId, SUM(cantidad) stock, SUM(cantidad > 0) obras
           FROM materialobras GROUP BY MaterialId
       ) st ON st.MaterialId = ma.id
      WHERE ma.unificadoEnId IS NULL AND ma.clase IN ('material', 'herramienta')
      ORDER BY ma.nombre`,
    { type: QueryTypes.SELECT }
  );
}

function aNumeros(filas) {
  return filas.map((f) => ({
    ...f,
    movimientos: Number(f.movimientos),
    stock: Number(f.stock),
    obrasConStock: Number(f.obrasConStock),
    unidadValida: Boolean(normalizarUnidad(f.unidad)),
  }));
}

/* Todos los materiales y herramientas del catálogo, con su uso. */
router.get("/materiales", ...SOLO_ADMIN, async (req, res) => {
  try {
    res.json(aNumeros(await catalogoConUso()));
  } catch (error) {
    console.error("Error al listar catálogo:", error);
    res.status(500).json({ message: "Error al listar el catálogo" });
  }
});

/* Grupos de posibles repetidos (cada clase por separado). */
router.get("/sugerencias/unificar", ...SOLO_ADMIN, async (req, res) => {
  try {
    const catalogo = aNumeros(await catalogoConUso());
    const grupos = ["material", "herramienta"].flatMap((clase) =>
      sugerirGrupos(catalogo.filter((m) => m.clase === clase))
    );
    res.json(grupos);
  } catch (error) {
    console.error("Error al sugerir unificaciones:", error);
    res.status(500).json({ message: "Error al buscar repetidos" });
  }
});

/* Unificar: { principalId, duplicadosIds: [], nombre?, unidad? } */
router.post("/unificar", ...SOLO_ADMIN, async (req, res) => {
  try {
    const resultado = await unificarMateriales(req.body);
    res.json(resultado);
  } catch (error) {
    if (error instanceof ErrorUnificacion) return res.status(400).json({ message: error.message });
    console.error("Error al unificar:", error);
    res.status(500).json({ message: "Error al unificar, no se cambió nada" });
  }
});

/*
  Materiales que por el nombre parecen herramientas o máquinas y todavía
  están como material. Con el stock por obra, para saber cuántas máquinas
  saldrían al convertirlas.
*/
router.get("/sugerencias/clasificar", ...SOLO_ADMIN, async (req, res) => {
  try {
    const catalogo = aNumeros(await catalogoConUso());
    const sugeridos = catalogo
      .filter((m) => m.clase === "material")
      .map((m) => ({ ...m, sugerida: sugerirClase(m.nombre) }))
      .filter((m) => m.sugerida)
      .sort((a, b) => b.movimientos - a.movimientos || a.nombre.localeCompare(b.nombre));

    const ids = sugeridos.map((m) => m.id);
    const porObra = ids.length
      ? await sequelize.query(
          `SELECT mo.MaterialId materialId, o.nombre obra, mo.cantidad
             FROM materialobras mo JOIN obras o ON o.id = mo.ObraId
            WHERE mo.MaterialId IN (:ids) AND mo.cantidad > 0
            ORDER BY o.nombre`,
          { replacements: { ids }, type: QueryTypes.SELECT }
        )
      : [];

    for (const m of sugeridos) {
      m.enObras = porObra.filter((p) => p.materialId === m.id).map(({ obra, cantidad }) => ({ obra, cantidad }));
    }

    res.json(sugeridos);
  } catch (error) {
    console.error("Error al sugerir clases:", error);
    res.status(500).json({ message: "Error al buscar herramientas" });
  }
});

/*
  Editar nombre, unidad o clase (material <-> herramienta).
  Para pasar a máquinas con número está /:id/maquinas.
*/
router.put("/materiales/:id", ...SOLO_ADMIN, async (req, res) => {
  try {
    const material = await Material.findByPk(req.params.id);
    if (!material || material.unificadoEnId) return res.status(404).json({ message: "No existe" });
    if (material.clase === "maquina") {
      return res.status(400).json({ message: "Ya se convirtió en máquinas: se editan desde Máquinas" });
    }

    const cambios = {};

    if (req.body.nombre !== undefined) {
      const nombre = String(req.body.nombre).trim().replace(/\s+/g, " ");
      if (!nombre) return res.status(400).json({ message: "El nombre no puede quedar vacío" });
      cambios.nombre = nombre;
    }

    if (req.body.unidad !== undefined) {
      const unidad = normalizarUnidad(req.body.unidad);
      if (!unidad) return res.status(400).json({ message: `Elegí la unidad de la lista: ${UNIDADES.join(", ")}` });
      cambios.unidad = unidad;
    }

    if (req.body.clase !== undefined) {
      if (!["material", "herramienta"].includes(req.body.clase)) {
        return res.status(400).json({ message: "Clase inválida" });
      }
      cambios.clase = req.body.clase;
    }

    await material.update(cambios);
    res.json(material);
  } catch (error) {
    console.error("Error al editar material:", error);
    res.status(500).json({ message: "Error al guardar" });
  }
});

/* Convertir en máquinas con número (una por unidad en stock, en su obra). */
router.post("/materiales/:id/maquinas", ...SOLO_ADMIN, async (req, res) => {
  try {
    const resultado = await convertirEnMaquinas(Number(req.params.id), req.user?.id ?? null, hoyISO());
    res.json(resultado);
  } catch (error) {
    if (error instanceof ErrorConversion) return res.status(400).json({ message: error.message });
    console.error("Error al convertir en máquinas:", error);
    res.status(500).json({ message: "Error al convertir, no se cambió nada" });
  }
});

export default router;
