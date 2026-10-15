// models/MovimientoMaterial.js

import { sequelize, DataTypes } from "../database.js";

/*
  Tipos de movimiento:
  - ingreso / salida:                 materiales (la salida se imputa a un ítem)
  - ingreso / traslado_salida /
    traslado_ingreso / baja:          herramientas por cantidad
*/
export const TIPOS = ["ingreso", "salida", "traslado_salida", "traslado_ingreso", "baja"];

const MovimientoMaterial = sequelize.define('MovimientoMaterial', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    obraId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    materialId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tipo: {
        type: DataTypes.STRING,
        allowNull: false
    },
    observaciones: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // <<-- CAMPO PARA CONTROL DE COSTOS -->>
    itemObraId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    // <<-- CAMPO PARA FECHAS HISTÓRICAS -->>
    fechaMovimiento: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: DataTypes.NOW
    },
    // Quién lo cargó (la columna existía pero nunca se llenaba).
    usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // En un traslado de herramientas: la otra obra (destino u origen).
    obraRelacionadaId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // En una baja: rota / perdida / robada / otro.
    motivo: {
        type: DataTypes.STRING(30),
        allowNull: true
    },
    // Si el material se unificó con otro, con qué material se cargó originalmente.
    materialOriginalId: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
    // NOTA: Sequelize ya agrega createdAt y updatedAt
},

{
     tableName: "movimientomaterials",
}

);

export default MovimientoMaterial;
