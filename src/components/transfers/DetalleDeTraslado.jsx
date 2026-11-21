import { FaArrowRight, FaCalendarAlt, FaHashtag, FaMapMarkerAlt, FaRegCheckCircle, FaRegStickyNote, FaUser } from "react-icons/fa"

import ModalShell from "../forms/ModalShell"

/*
  Qué se movió en un traslado, de dónde, hacia dónde, cuándo y quién.

  Es una ventana de solo lectura: un traslado aplicado no se edita, uno
  equivocado se corrige con otro en sentido contrario. Recibe los datos
  ya nombrados —ubicaciones, productos, usuario— para no volver a
  consultar nada al abrirse.

  Producto a la izquierda y cantidad a la derecha, siempre a la vista: la
  tabla es compacta y no obliga a desplazarse de lado.
*/
function DetalleDeTraslado({ traslado, onCerrar }) {
  const total = traslado.renglones.reduce((suma, r) => suma + r.qty, 0)
  const estado = (
    <span className={traslado.status === "aplicado" ? "badge badge-paid" : "badge badge-neutral"}>{traslado.estado}</span>
  )

  const datos = [
    ["Número", traslado.numero || "—", FaHashtag],
    ["Origen", traslado.origen, FaMapMarkerAlt],
    ["Destino", traslado.destino, FaArrowRight],
    ["Fecha y hora", traslado.fecha, FaCalendarAlt],
    ["Estado", estado, FaRegCheckCircle],
    ["Usuario", traslado.usuario || "—", FaUser],
    ["Nota", traslado.nota || "—", FaRegStickyNote],
  ]

  return (
    <ModalShell
      titulo="Detalle del traslado"
      onCerrar={onCerrar}
      cerrarAlPulsarFuera
      acciones={
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>
          Cerrar
        </button>
      }
    >
      <dl className="ficha-datos">
        {datos.map(([termino, valor, Icono]) => (
          <div className="ficha-dato" key={termino}>
            <dt>
              <Icono aria-hidden="true" />
              {termino}
            </dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>

      <section className="ficha-seccion" aria-label={`Productos (${traslado.renglones.length})`}>
        <h4>Productos ({traslado.renglones.length})</h4>

        <div className="table-wrap">
          <table aria-label="Productos trasladados" className="tabla-compacta">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="celda-cifra">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {traslado.renglones.map((r) => (
                <tr key={r.productId}>
                  <td>{r.nombre}</td>
                  <td className="celda-cifra">{r.qty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="celda-cifra">{total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </ModalShell>
  )
}

export default DetalleDeTraslado
