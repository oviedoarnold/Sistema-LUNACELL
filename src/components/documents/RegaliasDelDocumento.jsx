import { motivoParaLeer } from "../../utils/regalias"

/*
  Lo entregado sin cargo con la venta (0054), aparte de los productos
  facturados: no es un descuento ni suma al total. Va en la vista previa, la
  impresión, el PDF y el historial, porque todos usan esta plantilla.

  Si el documento se anuló, la regalía sigue aquí: se entregó y no volvió al
  inventario, y eso es lo que se dice.
*/
function RegaliasDelDocumento({ regalias = [], anulado = false }) {
  if (!regalias.length) return null

  const { motivo, detalleMotivo } = regalias[0]

  return (
    <section className="inv-regalias" aria-label="Regalías y cortesías">
      <div className="inv-regalias-titulo">REGALÍAS / CORTESÍAS</div>

      <table className="inv-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="r">Cant.</th>
            <th className="r">Importe</th>
          </tr>
        </thead>

        <tbody>
          {regalias.map((r) => (
            <tr key={r.productId}>
              <td>
                <span className="prod-name">{r.name}</span>
                {r.code && <span className="prod-code">{r.code}</span>}
              </td>
              <td className="r">{r.qty}</td>
              <td className="r">SIN CARGO</td>
            </tr>
          ))}
        </tbody>
      </table>

      {motivo && <p className="inv-regalias-nota">Motivo: {motivoParaLeer(motivo, detalleMotivo)}</p>}

      {anulado && (
        <p className="inv-regalias-nota">
          Documento anulado: la regalía se entregó al cliente y no se restituyó al inventario.
        </p>
      )}
    </section>
  )
}

export default RegaliasDelDocumento
