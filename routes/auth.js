// backend/routes/auth.js

import express from "express";
import Usuario from "../models/Usuario.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();
const SECRET = process.env.JWT_SECRET; 

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    console.log("Datos recibidos en /login:", req.body); 

    const { email, password } = req.body;

    // Buscar usuario con raw: true para obtener fácil acceso a 'rol'
    const user = await Usuario.findOne({ 
        where: { email },
        raw: true 
    });
    console.log("Usuario encontrado:", user); 

    if (!user) return res.status(400).json({ message: "Usuario no encontrado" });

    const match = await bcrypt.compare(password, user.password);
    console.log("Resultado bcrypt:", match); 

    if (!match) return res.status(400).json({ message: "Contraseña incorrecta" });

    // 🟢 CORRECCIÓN FINAL: Asegurar que 'rol' se firme en el payload.
    const token = jwt.sign(
        { 
            id: user.id, 
            email: user.email,
            nombre: user.nombre, 
            rol: user.rol // 👈 🎯 ESTA LÍNEA GARANTIZA EL CAMPO EN EL JWT
        }, 
        SECRET, 
        { expiresIn: "1h" }
    );
    console.log("Token generado:", token);

    return res.json({ token });
  } catch (error) {
    console.log("Error en /login:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Middleware para proteger rutas (no necesita cambios)
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ message: "No autorizado" });

  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido" });
    req.user = user; 
    next();
  });
};

export default router;