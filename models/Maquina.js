// models/Maquina.js
// Máquinas controladas una por una (hormigoneras, amoladoras, grupos
// electrógenos...). Cada una tiene su código y está siempre en una obra.

import { sequelize, DataTypes } from "../database.js";

export const ESTADOS_MAQUINA = ["en_uso", "en_reparacion", "baja"];

const Maquina = sequelize.define(
  "Maquina",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    codigo: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    marca: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    modelo: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    numeroSerie: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    // Obra donde está. En reparación o de baja queda la última obra.
    obraId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "en_uso",
    },
    observaciones: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Si salió de convertir un material del catálogo, cuál.
    materialOrigenId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "maquinas",
    freezeTableName: true,
  }
);

export default Maquina;
