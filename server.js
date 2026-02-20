// server.js
import express from "express";
import cors from "cors";

import { sequelize } from "./database.js"; 

import "./models/Usuario.js"; 
import "./models/Obra.js";  
import "./models/Material.js";
import "./models/MaterialObra.js";
import "./models/ItemObra.js"; 
import "./models/MovimientoMaterial.js"; 

import "./models/associations.js"; 

import authRoutes from "./routes/auth.js";
import obrasRoutes from "./routes/obras.js";
import materialesRoutes from "./routes/materiales.js";
import usuariosRoutes from "./routes/usuarios.js";




const app = express();

const PORT = process.env.PORT || 3000;

// Configurar trust proxy para Render
app.set("trust proxy", 1);

app.use(express.json());

// CORS para producción y desarrollo
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5175";
const allowedOrigins = [
  FRONTEND_URL,
  "https://stock-mdf-frontend.onrender.com",
  "http://localhost:5175",
  "http://localhost:5173",
  "http://localhost:5174"
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // health checks sin origin
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS bloqueado para origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use("/auth", authRoutes);
app.use("/materiales", materialesRoutes);
app.use("/obras", obrasRoutes);
app.use("/usuarios", usuariosRoutes);


app.get("/", (req, res) => {
  res.send("Servidor Backend funcionando correctamente");
});

app.use((err, req, res, next) => {
  console.error("⛔ ERROR EN EXPRESS:", err);
  res.status(500).send({ message: "Error interno del servidor" });
});

// Validar variables de entorno
console.log("🔍 Variables de entorno cargadas:");
console.log("   NODE_ENV:", process.env.NODE_ENV || "(no definido)");
console.log("   PORT:", process.env.PORT || "(no definido)");
console.log("   DB_HOST:", process.env.DB_HOST || "(no definido)");
console.log("   DB_PORT:", process.env.DB_PORT || "(no definido)");
console.log("   DB_NAME:", process.env.DB_NAME || "(no definido)");
console.log("   DB_USER:", process.env.DB_USER || "(no definido)");
console.log("   DB_PASSWORD:", process.env.DB_PASSWORD ? "✅ definido" : "❌ NO definido");
console.log("   JWT_SECRET:", process.env.JWT_SECRET ? "✅ definido" : "❌ NO definido");
console.log("   FRONTEND_URL:", process.env.FRONTEND_URL || "(no definido)");

if (!process.env.JWT_SECRET) {
  console.error("⛔ JWT_SECRET no está definido.");
  process.exit(1);
}

console.log("🔄 Intentando conectar a la base de datos...");

sequelize.authenticate()
  .then(() => {
    console.log("✅ Conexión a DB correcta");
    return sequelize.sync();
  })
  .then(() => {
    console.log("✅ Tablas sincronizadas");
    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("⛔ Error de conexión DB:", err.message || err);
    setTimeout(() => process.exit(1), 1000);
  });
