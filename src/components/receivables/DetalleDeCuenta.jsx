import ModalShell from "../forms/ModalShell"
import { formatMoney } from "../../utils/format"

/*
  De dónde sale la deuda de un cliente.

  Es una ventana de solo lectura, y lo es a propósito: aquí no hay forma de
  elegir a qué factura va el dinero ni de abonar a una suelta. El orden en
  que se listan es el orden en que el motor las va a cobrar —la más antigua
  primero—, así que leerla de arriba abajo ya dice qué se cancela antes.
*/
function DetalleDeCuenta({ cuenta, moneda, onCerrar }) {
  return (
    <ModalShell
      titulo={`Facturas pendientes · ${cuenta.nombre}`}
      onCerrar={onCerrar}
      cerrarAlPulsarFuera
      ancho="modal-lg"
      acciones={
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>
          Cerrar
        </button>
      }
    >
      <div className="table-wrap">
        <table>
          <caption className="tabla-leyenda">
            Se aplican de la más antigua a la más reciente.
          </caption>

          <thead>
            <tr>
              <th scope="col">Factura</th>
              <th scope="col">Fecha</th>
              <th scope="col" className="celda-numero">Total</th>
              <th scope="col" className="celda-numero">Abonado</th>
              <th scope="col" className="celda-numero">Pendiente</th>
            </tr>
          </thead>

          <tbody>
            {cuenta.facturas.map((factura) => (
              <tr key={factura.ventaId}>
                <td>
                  <span className="celda-codigo">{factura.numero}</span>
                </td>

                <td className="celda-secundaria">{factura.fecha}</td>

                <td className="celda-numero">
                  {formatMoney(factura.total, moneda)}
                </td>

                <td className="celda-numero celda-secundaria">
                  {formatMoney(factura.abonado, moneda)}
                </td>

                <td className="celda-numero cxc-saldo">
                  {formatMoney(factura.saldo, moneda)}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                Deuda total
              </th>

              <td className="celda-numero cxc-saldo">
                {formatMoney(cuenta.deudaTotal, moneda)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ModalShell>
  )
}

export default DetalleDeCuenta
