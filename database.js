// backend/database.js
import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

// Leer variables desde .env
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;

/*
  SSL prendido por defecto y sólo se apaga si se pide explícitamente
  con DB_SSL=false. Antes dependía de NODE_ENV: si esa variable
  faltaba en Render, el backend intentaba conectarse sin SSL y Aiven
  lo rechazaba. Así el olvido falla del lado seguro, y para una base
  local alcanza con poner DB_SSL=false en el .env.
*/
const usarSSL = String(process.env.DB_SSL ?? 'true').toLowerCase() !== 'false';

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: Number(DB_PORT || 3306),
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
        // Aiven puede tardar en aceptar la conexión cuando el servicio
        // estuvo ocioso.
        connectTimeout: 30000,
        ...(usarSSL
            ? { ssl: { require: true, rejectUnauthorized: false } }
            : {}),
    },
    pool: {
        max: 5,
        min: 1,
        acquire: 60000,
        idle: 30000,
        evict: 30000,
    },
});

export { sequelize, DataTypes };
