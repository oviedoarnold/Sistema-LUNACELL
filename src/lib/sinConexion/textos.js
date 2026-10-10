/*
  Cómo se le explica a una persona cada motivo de conciliación (0027) y
  cada resultado de un rescate. Lo comparten el POS (ventas del teléfono)
  y la pantalla de conciliación.
*/
export const MOTIVOS_DE_CONCILIACION = {
  "existencia-insuficiente": "No había existencia suficiente en el servidor.",
  "precio-distinto": "El precio o el impuesto cambiaron desde la venta.",
  "reloj-desfasado": "La hora del teléfono no coincidía con la del servidor.",
  "ubicacion-cambiada": "El vendedor ya no estaba asignado a esa ubicación.",
  "ubicacion-no-habilitada": "La ubicación ya no estaba habilitada para vender sin conexión.",
  "fecha-fuera-de-rango": "La venta es demasiado antigua o tiene una fecha imposible.",
  "usuario-inactivo": "El vendedor estaba desactivado o con la contraseña por cambiar.",
  "sin-permiso": "El vendedor ya no tenía permiso para facturar.",
  "cliente-invalido": "El cliente ya no existe en la empresa.",
  "producto-invalido": "Uno de los productos ya no existe o está inactivo.",
  rescate: "Subida por un administrador desde un respaldo cifrado.",
  "otro-negocio": "El servidor la rechazó por otra regla de negocio.",
}

export const motivoDeConciliacion = (motivo) => MOTIVOS_DE_CONCILIACION[motivo] || "Requiere revisión."

export const RESULTADOS_DE_RESCATE = {
  en_conciliacion: "Quedó en conciliación",
  ya_en_conciliacion: "Ya estaba en conciliación",
  ya_registrada: "Ya estaba registrada",
  ya_rescatada: "Ya se rescató en esta sesión",
  rechazado: "Rechazada por el servidor",
  invalida: "Mal formada: no se envió",
  repetida_en_archivo: "Repetida en el archivo: no se envió",
  error: "Error al enviar",
  no_enviada: "No se envió",
}

export const ACCIONES_DE_CONCILIACION_TEXTO = {
  aplicar: "Aplicar",
  aplicar_con_ajuste: "Aplicar con ajuste",
  anular: "Anular",
}
