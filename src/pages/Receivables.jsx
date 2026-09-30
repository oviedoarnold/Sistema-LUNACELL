import { useContext, useMemo, useState } from "react"
import { FaCheckCircle, FaHandHoldingUsd, FaList, FaSearch } from "react-icons/fa"
import Swal from "sweetalert2"

import { ClientsContext, ProductContext, SalesContext } from "../context/contexts"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import DetalleDeCuenta from "../components/receivables/DetalleDeCuenta"
import ModalDeCobro from "../components/receivables/ModalDeCobro"

import { cuentasPorCobrar, deudaTotalDeLasCuentas } from "../utils/cuentasPorCobrar"
import { registrarPagoCliente } from "../lib/api/cobros"
import { coincideBusqueda } from "../utils/texto"
import { claveDeIdempotencia } from "../utils/ids"
import { formatMoney } from "../utils/format"

/*
  Cuentas por cobrar, una por cliente.

  Antes esto vivía dentro del historial y mostraba una fila por factura, así
  que un cliente con cuatro facturas aparecía cuatro veces y había que
  cobrarle cuatro veces. Pero un cliente que paga no paga facturas: paga lo
  que debe.

  Las facturas siguen existiendo enteras y separadas en la base. Lo que se
  junta es la presentación y el cobro.
*/
function Receivables() {
  const { sales = [], cargando, refrescarVentas } = useContext(SalesContext)
  const { clients = [] } = useContext(ClientsContext)
  const { company } = useContext(ProductContext)

  /*
    company llega nula —no ausente— mientras la empresa no ha cargado, así
    que el valor por omisión de la desestructuración no la cubre.
  */
  const moneda = company?.currency || "L"

  const [busqueda, setBusqueda] = useState("")
  const [detalleDe, setDetalleDe] = useState(null)
  const [cobrandoA, setCobrandoA] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [errorDeCobro, setErrorDeCobro] = useState("")

  /*
    La clave identifica la INTENCIÓN de cobro, no el clic.

    Se genera al abrir la ventana y NO se renueva al reintentar: si la red
    se cayó sin decir si el cobro entró, el segundo intento lleva la misma
    clave y el motor devuelve el pago que ya existía en vez de cobrarle al
    cliente dos veces.

    Tampoco se renueva cuando el usuario corrige el monto tras un fallo, y
    eso es deliberado. Si el primer intento sí llegó a registrarse, el
    motor rechaza la clave por venir con otro monto —que es exactamente lo
    que debe pasar— en vez de cobrar una segunda vez sin que nadie lo note.
    Cerrar y volver a abrir empieza una intención nueva.
  */
  const [claveDelCobro, setClaveDelCobro] = useState(null)

  const cuentas = useMemo(
    () => cuentasPorCobrar(sales, clients),
    [sales, clients]
  )

  const cuentasVisibles = useMemo(
    () =>
      cuentas.filter((cuenta) =>
        [cuenta.nombre, cuenta.rtn, cuenta.telefono].some((dato) =>
          coincideBusqueda(dato, busqueda)
        )
      ),
    [cuentas, busqueda]
  )

  const deudaTotal = deudaTotalDeLasCuentas(cuentas)

  /*
    Las ventanas leen de `cuentas` en cada render en vez de guardarse una
    copia: así, apenas se registra un abono, el detalle y el modal ven la
    deuda nueva sin que nadie tenga que sincronizarlos.
  */
  const cuentaDelDetalle = detalleDe
    ? cuentas.find((cuenta) => cuenta.clienteId === detalleDe)
    : null

  const cuentaDelCobro = cobrandoA
    ? cuentas.find((cuenta) => cuenta.clienteId === cobrandoA)
    : null

  const abrirCobro = (cuenta) => {
    setClaveDelCobro(claveDeIdempotencia())
    setErrorDeCobro("")
    setCobrandoA(cuenta.clienteId)
  }

  const cerrarCobro = () => {
    setCobrandoA(null)
    setErrorDeCobro("")
    setClaveDelCobro(null)
  }

  const confirmarCobro = async ({ monto, nota }) => {
    if (!cuentaDelCobro || enviando) return

    setEnviando(true)
    setErrorDeCobro("")

    let pago

    try {
      pago = await registrarPagoCliente(cuentaDelCobro.clienteId, {
        monto,
        nota,
        clave: claveDelCobro,
      })
    } catch (problema) {
      /*
        El servidor mandó. Puede haber rechazado porque otro cajero cobró
        entre que se abrió esta ventana y se pulsó Confirmar, así que además
        de decirlo se recarga: quedarse enseñando una deuda que ya no existe
        invita a intentarlo otra vez con el mismo monto equivocado.
      */
      setErrorDeCobro(problema.message)

      await refrescarVentas().catch(() => {})

      return
    } finally {
      setEnviando(false)
    }

    cerrarCobro()

    await refrescarVentas().catch(() => {})

    mostrarResumen(pago, moneda)
  }

  return (
    <div className="view active crud">
      <PageHeader descripcion="Lo que cada cliente debe, en una sola cuenta." />

      {cargando && (
        <p className="crud-cargando" role="status">
          Cargando cuentas…
        </p>
      )}

      <div className="historial-totales">
        <div className="historial-total">
          <span className="historial-total-label">Clientes con deuda</span>
          <strong className="historial-total-valor">{cuentas.length}</strong>
        </div>

        <div className="historial-total alineado-derecha">
          <span className="historial-total-label">Total por cobrar</span>

          <strong
            className={
              deudaTotal > 0
                ? "historial-total-valor pendiente"
                : "historial-total-valor saldado"
            }
          >
            {formatMoney(deudaTotal, moneda)}
          </strong>
        </div>
      </div>

      <div className="toolbar">
        <SearchInput
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar cliente..."
          etiqueta="Buscar por nombre, RTN o teléfono"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Facturas pendientes</th>
              <th scope="col" className="celda-numero">Deuda total</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {cuentasVisibles.map((cuenta) => (
              <tr key={cuenta.clienteId}>
                <td>
                  <span className="product-name">{cuenta.nombre}</span>

                  <span className="product-cat">
                    {cuenta.rtn || cuenta.telefono || "—"}
                  </span>
                </td>

                <td>
                  <span className="cxc-facturas">
                    {cuenta.facturasPendientes}
                  </span>

                  {cuenta.masAntigua && (
                    <span className="product-cat">
                      la más antigua, {cuenta.masAntigua.fecha}
                    </span>
                  )}
                </td>

                <td className="celda-numero">
                  <strong className="cxc-saldo">
                    {formatMoney(cuenta.deudaTotal, moneda)}
                  </strong>
                </td>

                <td>
                  <div className="row-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setDetalleDe(cuenta.clienteId)}
                    >
                      <FaList aria-hidden="true" />
                      Ver detalle
                    </button>

                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => abrirCobro(cuenta)}
                    >
                      <FaHandHoldingUsd aria-hidden="true" />
                      Abonar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {cuentasVisibles.length === 0 &&
          (cuentas.length ? (
            <EmptyState
              Icono={FaSearch}
              titulo="No se encontraron resultados"
              descripcion="Prueba con otro nombre, RTN o teléfono."
            />
          ) : (
            <EmptyState
              Icono={FaCheckCircle}
              titulo="Nadie debe nada"
              descripcion="Cuando una venta al crédito quede con saldo, su cliente aparecerá aquí."
            />
          ))}
      </div>

      {cuentaDelDetalle && (
        <DetalleDeCuenta
          cuenta={cuentaDelDetalle}
          moneda={moneda}
          onCerrar={() => setDetalleDe(null)}
        />
      )}

      {cuentaDelCobro && (
        <ModalDeCobro
          key={cuentaDelCobro.clienteId}
          cuenta={cuentaDelCobro}
          moneda={moneda}
          cobrando={enviando}
          error={errorDeCobro}
          onConfirmar={confirmarCobro}
          onCerrar={cerrarCobro}
        />
      )}
    </div>
  )
}

/*
  El resumen de lo que pasó, con los números del servidor y no con los que
  se habían enseñado antes de confirmar.
*/
function mostrarResumen(pago, moneda) {
  const lineas = pago.aplicaciones
    .map(
      (aplicacion) =>
        `${aplicacion.numero}: ${formatMoney(aplicacion.aplicado, moneda)}` +
        (aplicacion.saldoPosterior > 0
          ? ` · queda ${formatMoney(aplicacion.saldoPosterior, moneda)}`
          : " · cancelada")
    )
    .join("\n")

  const saldado = pago.saldoPosterior <= 0

  Swal.fire({
    icon: "success",

    title: pago.repetido
      ? "Este abono ya estaba registrado"
      : saldado
        ? "Cuenta cancelada"
        : "Abono registrado",

    text:
      `Se recibieron ${formatMoney(pago.monto, moneda)}. ` +
      `La deuda pasó de ${formatMoney(pago.saldoAnterior, moneda)} a ` +
      `${formatMoney(pago.saldoPosterior, moneda)}.\n\n${lineas}`,
  })
}

export default Receivables
