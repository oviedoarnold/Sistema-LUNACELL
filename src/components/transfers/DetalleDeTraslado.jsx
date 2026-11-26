import {
  FaArrowRight,
  FaCalendarAlt,
  FaCheck,
  FaExclamationTriangle,
  FaHashtag,
  FaMapMarkerAlt,
  FaRegCheckCircle,
  FaRegStickyNote,
  FaUser,
} from "react-icons/fa"

import ModalShell from "../forms/ModalShell"

const CLASE_DEL_ESTADO = {
  aplicado: "badge badge-paid",
  recibido: "badge badge-paid",
  pendiente: "badge badge-low",
  con_incidencia: "badge badge-out",
}

/*
  Qué se movió en un traslado, de dónde, hacia dónde, cuándo y quién.

  Recibe los datos ya nombrados —ubicaciones, productos, usuarios— para no
  volver a consultar nada al abrirse. Desde la 0056 muestra también la
  recepción (quién y cuándo, y si fue una confirmación administrativa, con
  su observación) y la incidencia, y a quien puede recibir le ofrece
  «Confirmar recepción» y, si todavía no hay incidencia, «Reportar
  incidencia». Lo recibido no se edita: uno equivocado se corrige con otro
  traslado en sentido contrario.

  Producto y código a la izquierda y cantidad a la derecha, siempre a la
  vista: la tabla es compacta y no obliga a desplazarse de lado.
*/
function DetalleDeTraslado({ traslado, puedeRecibir = false, procesando = false, onConfirmar, onReportar, onCerrar }) {
  const total = traslado.unidades ?? traslado.renglones.reduce((suma, r) => suma + r.qty, 0)
  const porRecibir = traslado.status === "pendiente" || traslado.status === "con_incidencia"
  const estado = <span className={CLASE_DEL_ESTADO[traslado.status] || "badge badge-neutral"}>{traslado.estado}</span>

  const datos = [
    ["Número", traslado.numero || "—", FaHashtag],
    ["Origen", traslado.origen, FaMapMarkerAlt],
    ["Destino", traslado.destino, FaArrowRight],
    ["Enviado", traslado.fecha, FaCalendarAlt],
    ["Enviado por", traslado.usuario || "—", FaUser],
    ["Estado", estado, FaRegCheckCircle],
    ["Nota", traslado.nota || "—", FaRegStickyNote],
  ]

  if (traslado.status === "recibido") {
    datos.push(["Recibido", `${traslado.recibidoPor || "—"} · ${traslado.recibidoEn}`, FaCheck])
  }

  if (traslado.status === "aplicado") {
    datos.push(["Recepción", "Aplicado antes del control de recepción", FaCheck])
  }

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={procesando}>
        Cerrar
      </button>
      {puedeRecibir && porRecibir && traslado.status === "pendiente" && (
        <button type="button" className="btn btn-secondary" onClick={onReportar} disabled={procesando}>
          <FaExclamationTriangle aria-hidden="true" />Reportar incidencia
        </button>
      )}
      {puedeRecibir && porRecibir && (
        <button type="button" className="btn btn-primary" onClick={onConfirmar} disabled={procesando} aria-busy={procesando || undefined}>
          <FaCheck aria-hidden="true" />Confirmar recepción
        </button>
      )}
    </>
  )

  return (
    <ModalShell titulo="Detalle del traslado" onCerrar={onCerrar} cerrarAlPulsarFuera={!procesando} acciones={acciones}>
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

      {traslado.administrativa && (
        <section className="transfers-aviso transfers-aviso-administrativo" aria-label="Confirmación administrativa">
          <h4>Confirmación administrativa</h4>
          <p>
            Confirmó {traslado.recibidoPor || "—"} el {traslado.recibidoEn}
          </p>
          <p className="transfers-aviso-nota">{traslado.observacion}</p>
        </section>
      )}

      {traslado.incidencia && (
        <section className="transfers-aviso transfers-aviso-incidencia" aria-label="Incidencia">
          <h4>Incidencia</h4>
          <p>
            Reportada por {traslado.incidenciaPor || "—"} el {traslado.incidenciaEn}
          </p>
          <p className="transfers-aviso-nota">{traslado.incidencia}</p>
        </section>
      )}

      <section className="ficha-seccion" aria-label={`Productos (${traslado.renglones.length})`}>
        <h4>Productos ({traslado.renglones.length})</h4>

        <div className="table-wrap">
          <table aria-label="Productos trasladados" className="tabla-compacta">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Código</th>
                <th scope="col" className="celda-cifra">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {traslado.renglones.map((r) => (
                <tr key={r.productId}>
                  <td>{r.nombre}</td>
                  <td className="celda-codigo">{r.productCode || "S/C"}</td>
                  <td className="celda-cifra">{r.qty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total de unidades</td>
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
