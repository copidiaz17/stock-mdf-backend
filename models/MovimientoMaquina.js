// models/MovimientoMaquina.js
// Historial de cada máquina: alta, traslados, reparaciones y baja.

import { sequelize, DataTypes } from "../database.js";

export const TIPOS_MAQUINA = ["alta", "traslado", "reparacion", "vuelta", "baja"];

const MovimientoMaquina = sequelize.define(
  "MovimientoMaquina",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    maquinaId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    tipo: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    obraOrigenId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    obraDestinoId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    fecha: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    motivo: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    observaciones: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    usuarioId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "movimientomaquinas",
    freezeTableName: true,
  }
);

export default MovimientoMaquina;
