/*
  El color de cada estado, igual en todas las pantallas.

  Solo presentación: el estado y su significado los decide la base. Aquí se
  dice con qué etiqueta (.badge de lunacell.css) se pinta:

    verde  badge-paid     terminado y bueno: facturado, confirmado, aplicado
    azul   badge-credit   en curso normal: pendiente de facturar
    ámbar  badge-low      pide atención: por resolver, por confirmar
    rojo   badge-out      negativo: cancelado, anulado, rechazado
    gris   badge-neutral  sin estado conocido
*/
export const CLASE_DEL_PEDIDO = {
  pendiente: "badge badge-credit",
  facturado: "badge badge-paid",
  por_resolver: "badge badge-low",
  cancelado: "badge badge-out",
}

export const claseDelPedido = (estado) => CLASE_DEL_PEDIDO[estado] || "badge badge-neutral"
