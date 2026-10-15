// backend/lib/fechas.js
// Helpers de fecha compartidos por las rutas de materiales, herramientas y máquinas.

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Hoy en horario de Argentina (Render corre en UTC, así que no
// podemos usar toISOString() a secas: después de las 21 hs daría mañana).
export function hoyISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export function esFechaValida(valor) {
  return (
    typeof valor === "string" &&
    RE_FECHA.test(valor) &&
    !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))
  );
}

// Valida la fecha que manda un formulario de movimiento.
// Vacía = hoy. Devuelve { fecha } o { error }.
export function fechaDelMovimiento(valor) {
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

// Cantidad entera y positiva, o null si no lo es.
export function cantidadValida(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}
