/*
  De dónde sale la existencia de un producto.

  Hoy el catálogo trae un solo número por producto: la vista
  productos_con_stock suma el libro de movimientos y la capa de acceso a
  datos lo deja plano en `stock`. Ese número es global, sin ubicación.

  Este módulo existe para que ese detalle viva en un solo lugar. Las
  reglas de carrito, la validación de la venta y el aviso de faltantes en
  cotizaciones ya no leen `producto.stock`: preguntan aquí. Cuando el
  inventario pase a ser por producto y ubicación, lo que cambia es esta
  función y quien decida qué ubicación consultar, no las reglas.

  Es un solo dato y una sola función a propósito: no es una capa de
  abstracción, es la costura por donde va a entrar la ubicación.
*/
export function existenciaEnCatalogo(producto) {
  return Number(producto?.stock || 0)
}
