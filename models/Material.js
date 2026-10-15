import { sequelize, DataTypes } from "../database.js";

/*
  Clases del catálogo:
  - material:    se consume en la obra y se imputa a un ítem.
  - herramienta: se controla por cantidad en cada obra (palas, baldes...);
                 se da de alta, se traslada y se da de baja, no se consume.
  - maquina:     el material se convirtió en máquinas con número (tabla
                 maquinas). Queda en el catálogo sólo por su historial.
*/
export const CLASES = ["material", "herramienta", "maquina"];

const Material = sequelize.define("Material", {
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  unidad: {
    type: DataTypes.STRING,
    allowNull: false
  },
  stock_total: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  clase: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "material"
  },
  // Si se unificó con otro, apunta al que quedó. Estos no se muestran
  // en ninguna lista pero se conservan para saber qué se juntó con qué.
  unificadoEnId: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
},
{
tableName: "materials", // ✅ debe coincidir con la DB
  freezeTableName: true
}
);

export default Material;
