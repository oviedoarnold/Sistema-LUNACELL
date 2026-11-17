/*
  Cómo se nombran los estados y los métodos de las liquidaciones entre
  ubicaciones (0046). Los usan la pantalla, el reporte diario y su CSV/PDF.
*/

// El estado de un pedido respecto a su efectivo.
export const ESTADO_DEL_PEDIDO = {
  pendiente: "Pendiente",
  parcial: "Parcialmente liquidado",
  por_confirmar: "Pendiente de confirmación",
  liquidado: "Liquidado",
  sin_efectivo: "En cuenta de la empresa",
}

export const ESTADO_DE_LIQUIDACION = {
  por_confirmar: "Pendiente de confirmación",
  confirmada: "Confirmada",
  rechazada: "Rechazada",
}

export const METODOS = {
  entrega_en_efectivo: "Entrega en efectivo",
  deposito_a_cuenta: "Depósito a la cuenta de la empresa",
}
