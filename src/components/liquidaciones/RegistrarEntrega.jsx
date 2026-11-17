import { useRef, useState } from "react"
import Swal from "sweetalert2"

import FormField from "../forms/FormField"
import ModalShell from "../forms/ModalShell"
import { METODOS, registrarLiquidacion } from "../../lib/api/liquidaciones"
import { useBloqueoDeActualizacion } from "../../hooks/useBloqueoDeActualizacion"
import { formatMoney } from "../../utils/format"
import { claveDeIdempotencia } from "../../utils/ids"
import { hoyEnHonduras } from "../../utils/reporteDiario"

/*
  La ubicación que cobró registra que entrega ese efectivo a la que factura.
  Queda pendiente de confirmación hasta que la otra confirme haberlo recibido.

  La clave del intento nace con la ventana y viaja igual en cada reintento: un
  doble clic o una respuesta perdida no registran dos entregas. El monto lo
  vuelve a revisar la base, que nunca deja liquidar más de lo pendiente.
*/

const MONTO_VALIDO = /^\d+(\.\d{1,2})?$/

function RegistrarEntrega({ par, pedidos, onCerrar, onRegistrada }) {
  const [clave] = useState(claveDeIdempotencia)
  const [pedidoId, setPedidoId] = useState("")
  const [monto, setMonto] = useState(par.pendiente.toFixed(2))
  const [metodo, setMetodo] = useState("entrega_en_efectivo")
  const [fecha, setFecha] = useState(() => hoyEnHonduras())
  const [referencia, setReferencia] = useState("")
  const [observacion, setObservacion] = useState("")
  const [enviando, setEnviando] = useState(false)
  // Dos clics en el mismo instante llegan antes de que el estado se dibuje.
  const enCurso = useRef(false)
  const [error, setError] = useState("")

  useBloqueoDeActualizacion(enviando, "liquidacion")

  const elegido = pedidos.find((p) => p.id === pedidoId)
  const disponible = elegido ? elegido.pendiente : par.pendiente
  const montoEscrito = monto.trim().replace(",", ".")
  const montoNumero = Number(montoEscrito)

  let errorDelMonto = ""

  if (!MONTO_VALIDO.test(montoEscrito) || montoNumero <= 0) errorDelMonto = "Escribe un monto mayor que cero, con hasta dos decimales."
  else if (montoNumero > disponible) errorDelMonto = `No puede superar lo pendiente: ${formatMoney(disponible)}.`

  const elegirPedido = (id) => {
    setPedidoId(id)

    const pedido = pedidos.find((p) => p.id === id)

    setMonto((pedido ? pedido.pendiente : par.pendiente).toFixed(2))
  }

  const registrar = async () => {
    if (enCurso.current || errorDelMonto) return

    enCurso.current = true
    setEnviando(true)
    setError("")

    try {
      for (;;) {
        try {
          const liquidacion = await registrarLiquidacion({
            origenId: par.origenId,
            destinoId: par.destinoId,
            monto: montoNumero,
            metodo,
            fechaEfectiva: fecha,
            referencia: referencia.trim(),
            observacion: observacion.trim(),
            pedidoId: pedidoId || null,
            clave,
          })

          onRegistrada(liquidacion)
          return
        } catch (problema) {
          if (problema.motivo !== "sin-respuesta") throw problema

          const otraVez = await Swal.fire({
            icon: "warning",
            title: "No hubo respuesta del servidor",
            text: "La entrega pudo haberse registrado o no. Reintentar es seguro: no se registra dos veces.",
            showCancelButton: true,
            confirmButtonText: "Reintentar",
            cancelButtonText: "Cancelar",
          })

          if (!otraVez.isConfirmed) return
        }
      }
    } catch (problema) {
      setError(problema.message)
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>
        Cancelar
      </button>
      <button type="button" className="btn btn-primary" onClick={registrar} disabled={enviando || Boolean(errorDelMonto)}>
        {enviando ? "Registrando…" : "Registrar entrega"}
      </button>
    </>
  )

  return (
    <ModalShell titulo="Registrar entrega de efectivo" onCerrar={enviando ? () => {} : onCerrar} acciones={acciones}>
      <div className="liquidaciones-entrega">
        <p className="liquidaciones-entrega-par">
          <b>{par.origen}</b> entrega a <b>{par.destino}</b>
          <span>Pendiente por liquidar: {formatMoney(par.pendiente)}</span>
        </p>

        {error && (
          <p className="alert-banner" role="alert">
            {error}
          </p>
        )}

        <div className="form-grid">
          <FormField etiqueta="Pedido" ayuda="Si no eliges uno, se reparte del pedido más antiguo al más reciente." ancho="full">
            <select id="liquidacion-pedido" value={pedidoId} onChange={(evento) => elegirPedido(evento.target.value)}>
              <option value="">Todos los pendientes de este par</option>
              {pedidos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.numero} · {p.cliente} · {formatMoney(p.pendiente)}
                </option>
              ))}
            </select>
          </FormField>

          <FormField etiqueta="Monto" error={errorDelMonto}>
            <input id="liquidacion-monto" inputMode="decimal" value={monto} onChange={(evento) => setMonto(evento.target.value)} />
          </FormField>

          <FormField etiqueta="Fecha de la entrega">
            <input id="liquidacion-fecha" type="date" value={fecha} max={hoyEnHonduras()} onChange={(evento) => setFecha(evento.target.value)} />
          </FormField>

          <FormField etiqueta="Cómo se entrega" ancho="full">
            <select id="liquidacion-metodo" value={metodo} onChange={(evento) => setMetodo(evento.target.value)}>
              {Object.entries(METODOS).map(([id, etiqueta]) => (
                <option key={id} value={id}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </FormField>

          <FormField etiqueta="Referencia (opcional)" ayuda="Número de depósito, de sobre o de recibo.">
            <input id="liquidacion-referencia" maxLength={120} value={referencia} onChange={(evento) => setReferencia(evento.target.value)} />
          </FormField>

          <FormField etiqueta="Observación (opcional)">
            <input id="liquidacion-observacion" maxLength={500} value={observacion} onChange={(evento) => setObservacion(evento.target.value)} />
          </FormField>
        </div>

        <p className="liquidaciones-entrega-nota">
          Queda pendiente de confirmación hasta que {par.destino} confirme haberlo recibido. No crea factura, cobro ni abono.
        </p>
      </div>
    </ModalShell>
  )
}

export default RegistrarEntrega
