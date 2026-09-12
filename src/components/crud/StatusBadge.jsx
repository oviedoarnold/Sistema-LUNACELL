/*
  Distintivo de estado.

  No decide qué significa nada: la página le pasa la variante ya
  resuelta y el texto que hay que leer. Así el mismo distintivo sirve
  para un producto agotado y para una factura vencida sin que este
  archivo tenga que saber de inventario ni de cobros.

  Lleva siempre un icono o un punto además del color, porque el estado
  no puede depender solo del color para entenderse.
*/
function StatusBadge({ variante = "neutral", Icono, children }) {
  return (
    <span className={`badge badge-${variante}`}>
      {Icono ? <Icono aria-hidden="true" /> : <span className="badge-dot" />}

      {children}
    </span>
  )
}

export default StatusBadge
