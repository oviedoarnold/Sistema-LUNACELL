/*
  El total de un producto según el catálogo: la vista productos_con_stock
  suma todo el libro de movimientos y la capa de acceso a datos lo deja
  plano en `stock`. Ese número es global, sin ubicación.

  Para vender NO sirve: el punto de venta, la validación de SalesContext y
  los faltantes al facturar una cotización usan la existencia de la
  ubicación operativa (hooks/useExistenciaDeMiUbicacion), que es de donde
  descuenta registrar_venta_ubicacion(). Esto queda solo como valor por
  omisión del carrito de cotizaciones, que arma una oferta y no descuenta
  de ningún lado.
*/
export function existenciaEnCatalogo(producto) {
  return Number(producto?.stock || 0)
}
