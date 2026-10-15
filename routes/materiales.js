import express from "express";
import { Op } from "sequelize";
import Material from "../models/Material.js";
import { authMiddleware } from "./auth.js";
import { hasRole, ROLES } from "../middlewares/authorization.js";
import { UNIDADES, normalizarUnidad } from "../lib/unidades.js";
import { descomponer, comparar } from "../lib/similitud.js";

const router = express.Router();

const CLASES_CREABLES = ["material", "herramienta"];

/*
  Materiales del catálogo parecidos a un nombre, de la misma clase.
  Devuelve [{ id, nombre, unidad, nivel: "igual" | "parecido" }].
*/
async function buscarParecidos(nombre, clase, excluirId = null) {
  const partes = descomponer(nombre);
  const candidatos = await Material.findAll({
    where: { unificadoEnId: null, clase },
    attributes: ["id", "nombre", "unidad"],
    raw: true,
  });

  return candidatos
    .filter((m) => m.id !== excluirId)
    .map((m) => ({ ...m, nivel: comparar(partes, descomponer(m.nombre)) }))
    .filter((m) => m.nivel)
    .sort((a, b) => (a.nivel === "igual" ? 0 : 1) - (b.nivel === "igual" ? 0 : 1))
    .slice(0, 8);
}

/* ================================================
// Listar materiales (GET)
//   ?clase=material (por defecto) | herramienta | todas
// Los unificados en otro y los convertidos en máquinas no aparecen.
//------------------------------------------------
*/
router.get(
    "/",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
        try {
            const clase = req.query.clase || "material";
            const where = { unificadoEnId: null };

            if (clase === "todas") where.clase = { [Op.in]: CLASES_CREABLES };
            else if (CLASES_CREABLES.includes(clase)) where.clase = clase;
            else return res.status(400).json({ message: "Clase inválida" });

            const materiales = await Material.findAll({
                where,
                attributes: ["id", "nombre", "unidad", "clase"],
                order: [["nombre", "ASC"]],
            });
            res.json(materiales);
        } catch (error) {
            console.log(error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Lista cerrada de unidades para los formularios.
router.get("/unidades", authMiddleware, (req, res) => {
    res.json(UNIDADES);
});

// Parecidos a un nombre, para avisar ANTES de crear un repetido.
router.get(
    "/parecidos",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.VIEWER]),
    async (req, res) => {
        try {
            const nombre = String(req.query.nombre || "").trim();
            const clase = CLASES_CREABLES.includes(req.query.clase) ? req.query.clase : "material";
            if (nombre.length < 3) return res.json([]);
            res.json(await buscarParecidos(nombre, clase));
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "Error al buscar parecidos" });
        }
    }
);

/* ================================================
// Crear nuevo material o herramienta (POST)
//   { nombre, unidad, clase, confirmarParecido }
// Si ya existe uno igual se rechaza; si hay parecidos se pide confirmar.
---------------------------------------------------
*/
router.post(
    "/",
    authMiddleware,
    hasRole([ROLES.ADMIN, ROLES.OPERATOR]),
    async (req, res) => {
        try {
            const nombre = String(req.body.nombre || "").trim().replace(/\s+/g, " ");
            const clase = req.body.clase || "material";

            if (!nombre) {
                return res.status(400).json({ message: "El nombre es obligatorio" });
            }
            if (!CLASES_CREABLES.includes(clase)) {
                return res.status(400).json({ message: "Clase inválida" });
            }

            const unidad = normalizarUnidad(req.body.unidad);
            if (!unidad) {
                return res.status(400).json({
                    message: `Elegí la unidad de la lista: ${UNIDADES.join(", ")}`,
                });
            }

            const parecidos = await buscarParecidos(nombre, clase);
            const igual = parecidos.find((p) => p.nivel === "igual");

            if (igual) {
                return res.status(409).json({
                    message: `Ya existe "${igual.nombre}". Usá ese en vez de crear otro.`,
                    bloqueado: true,
                    parecidos,
                });
            }

            if (parecidos.length && !req.body.confirmarParecido) {
                return res.status(409).json({
                    message: "Hay materiales parecidos. Revisá que no sea uno de estos.",
                    bloqueado: false,
                    parecidos,
                });
            }

            const material = await Material.create({ nombre, unidad, clase });
            res.json(material);
        } catch (error) {
            console.log("error al crear el material", error);
            res.status(500).json({ message: "Error al crear material" });
        }
    }
);

export default router;
