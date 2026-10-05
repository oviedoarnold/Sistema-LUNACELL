import ModalShell from "../forms/ModalShell"

/*
  Qué se movió en un traslado, de dónde, hacia dónde, cuándo y quién.

  Es una ventana de solo lectura: un traslado aplicado no se edita, uno
  equivocado se corrige con otro en sentido contrario. Recibe los datos
  ya nombrados —ubicaciones, productos, usuario— para no volver a
  consultar nada al abrirse.
*/
function DetalleDeTraslado({ traslado, onCerrar }) {
  const total = traslado.renglones.reduce((suma, r) => suma + r.qty, 0)

  const datos = [
    ["Fecha y hora", traslado.fecha],
    ["Origen", traslado.origen],
    ["Destino", traslado.destino],
    ["Estado", traslado.estado],
    ["Usuario", traslado.usuario || "—"],
    ["Nota", traslado.nota || "—"],
  ]

  return (
    <ModalShell
      titulo="Detalle del traslado"
      onCerrar={onCerrar}
      cerrarAlPulsarFuera
      ancho="modal-wide"
      acciones={
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>
          Cerrar
        </button>
      }
    >
      <dl className="transfers-detalle-datos">
        {datos.map(([termino, valor]) => (
          <div className="transfers-detalle-dato" key={termino}>
            <dt>{termino}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>

      <div className="table-wrap">
        <table aria-label="Productos trasladados">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col" className="transfers-cantidad">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {traslado.renglones.map((r) => (
              <tr key={r.productId}>
                <td>{r.nombre}</td>
                <td className="transfers-cantidad">{r.qty}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="transfers-cantidad">{total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ModalShell>
  )
}

export default DetalleDeTraslado
