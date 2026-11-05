import { useMemo, useState } from "react"

import SelectorDeMedios, { AvisoDeMedios } from "../pagos/SelectorDeMedios"
import ModalShell from "../forms/ModalShell"
import FormField from "../forms/FormField"
import { formatMoney } from "../../utils/format"
import { previaDelReparto } from "../../utils/cuentasPorCobrar"
import {
  cobrosDelSelector,
  problemaDelSelector,
  selectorVacio,
  cargoDeCobros,
  TASA_DE_CARGO,
} from "../../utils/mediosDePago"

/*
  Cobrarle a un cliente.

  El monto es lo único que se decide aquí. A qué factura va cada lempira lo
  decide el motor, de la más antigua a la más reciente, y por eso esta
  ventana no tiene dónde elegir factura: no es una omisión, es la regla.

  Lo que se enseña antes de confirmar es una PREVIA. Se calcula en el
  navegador con la misma regla, pero no manda: entre abrir esta ventana y
  pulsar Confirmar, otro cajero puede haber cobrado. El reparto que vale es
  el que devuelve el servidor, y es el que se muestra después.
*/
function ModalDeCobro({
  cuenta,
  moneda,
  cobrando,
  error,
  onConfirmar,
  onCerrar,
}) {
  const [monto, setMonto] = useState("")
  const [nota, setNota] = useState("")
  const [avisoLocal, setAvisoLocal] = useState("")
  const [medios, setMedios] = useState(selectorVacio)

  const montoNumero = Number(monto)

  const previa = useMemo(() => {
    if (!Number.isFinite(montoNumero) || montoNumero <= 0) return []

    return previaDelReparto(cuenta.facturas, Math.min(montoNumero, cuenta.deudaTotal))
  }, [cuenta.facturas, cuenta.deudaTotal, montoNumero])

  /*
    Estas dos comprobaciones son cortesía, no seguridad: evitan un viaje
    inútil y explican el problema antes de pulsar. La autoridad es el
    servidor, que vuelve a comprobarlo contra la deuda de ese momento.
  */
  const validar = () => {
    if (!Number.isFinite(montoNumero) || montoNumero <= 0) {
      setAvisoLocal("El monto debe ser mayor que cero.")

      return false
    }

    if (montoNumero > cuenta.deudaTotal) {
      setAvisoLocal(
        `El monto no puede superar la deuda de ${formatMoney(
          cuenta.deudaTotal,
          moneda
        )}.`
      )

      return false
    }

    const problema = problemaDelSelector(medios, montoNumero)

    if (problema) {
      setAvisoLocal(problema)

      return false
    }

    setAvisoLocal("")

    return true
  }

  const enviar = (evento) => {
    evento.preventDefault()

    if (cobrando) return
    if (!validar()) return

    onConfirmar({ monto: montoNumero, nota: nota.trim(), cobros: cobrosDelSelector(medios, montoNumero) })
  }

  const aviso = avisoLocal || error
  const cargo = Number.isFinite(montoNumero) ? cargoDeCobros(cobrosDelSelector(medios, montoNumero)) : 0

  /*
    Con un monto que no vale, el botón sigue activo para que el aviso diga cuánto
    debe el cliente. Con uno válido, se espera a que los medios lo sumen.
  */
  const montoValido = Number.isFinite(montoNumero) && montoNumero > 0 && montoNumero <= cuenta.deudaTotal
  const mediosSinCuadrar = montoValido && problemaDelSelector(medios, montoNumero) !== null

  return (
    <ModalShell
      titulo={`Abonar · ${cuenta.nombre}`}
      onCerrar={onCerrar}
      acciones={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>
            Cancelar
          </button>

          <button
            type="submit"
            form="form-cobro"
            className="btn btn-primary"
            disabled={cobrando || mediosSinCuadrar}
          >
            {cobrando ? "Registrando…" : "Confirmar abono"}
          </button>
        </>
      }
    >
      <div className="cxc-resumen">
        <div className="cxc-resumen-dato">
          <span className="cxc-resumen-label">Deuda total</span>
          <strong className="cxc-resumen-valor">
            {formatMoney(cuenta.deudaTotal, moneda)}
          </strong>
        </div>

        <div className="cxc-resumen-dato">
          <span className="cxc-resumen-label">Facturas pendientes</span>
          <strong className="cxc-resumen-valor">
            {cuenta.facturasPendientes}
          </strong>
        </div>
      </div>

      {/*
        noValidate para que hable esta pantalla y no el navegador. Con la
        validación nativa, un monto fuera de rango ni siquiera llegaba al
        manejador: el navegador lo paraba con un globo que no dice cuánto
        debe el cliente y que un lector de pantalla no anuncia igual. El
        mensaje de aquí sí nombra la deuda y va en un role="alert".

        min y max se quedan: siguen guiando las flechas del control.
      */}
      <form id="form-cobro" onSubmit={enviar} noValidate>
        <div className="form-grid">
          {/*
            El aviso va en el campo y no suelto: FormField lo asocia al
            control con aria-describedby, le pone aria-invalid y lo anuncia
            con role="alert". Ahí caben los dos, el que detecta esta
            pantalla y el que devuelve el servidor, porque los dos hablan
            del mismo dato: el monto.
          */}
          <FormField etiqueta="Monto del abono" error={aviso || null}>
            <input
              id="cobro-monto"
              type="number"
              step="0.01"
              min="0"
              max={cuenta.deudaTotal}
              value={monto}
              onChange={(evento) => {
                setMonto(evento.target.value)
                setAvisoLocal("")
              }}
              placeholder="0.00"
            />
          </FormField>

          <FormField etiqueta="Nota (opcional)">
            <input
              id="cobro-nota"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder="Referencia, recibo, quien paga…"
            />
          </FormField>
        </div>

        {/*
          El monto va en la etiqueta y no solo en el resumen de arriba: en
          un teléfono los campos se apilan y este botón cae debajo de la
          nota, lejos del campo al que llena. Diciendo la cifra se explica
          solo, esté donde esté.
        */}
        <button
          type="button"
          className="btn btn-secondary btn-sm cxc-atajo"
          onClick={() => {
            setMonto(String(cuenta.deudaTotal))
            setAvisoLocal("")
          }}
        >
          Abonar toda la deuda ({formatMoney(cuenta.deudaTotal, moneda)})
        </button>

        <SelectorDeMedios
          valor={medios}
          total={Number.isFinite(montoNumero) ? montoNumero : 0}
          onCambiar={(siguiente) => {
            setMedios(siguiente)
            setAvisoLocal("")
          }}
        />

        <AvisoDeMedios valor={medios} total={Number.isFinite(montoNumero) ? montoNumero : 0} />

        {cargo > 0 && (
          <dl className="cobro-con-cargo">
            <div>
              <dt>Cargo por medio de pago ({TASA_DE_CARGO}%)</dt>
              <dd>{formatMoney(cargo, moneda)}</dd>
            </div>

            <div>
              <dt>Total a cobrar</dt>
              <dd>{formatMoney(montoNumero + cargo, moneda)}</dd>
            </div>
          </dl>
        )}

        {previa.length > 0 && (
          <div className="cxc-previa">
            <h4 className="cxc-previa-titulo">Así se repartiría</h4>

            <p className="cxc-previa-nota">
              Es una vista previa. El reparto definitivo lo confirma el
              sistema al registrar el abono.
            </p>

            <ul className="cxc-previa-lista">
              {previa.map((linea) => (
                <li key={linea.ventaId} className="cxc-previa-fila">
                  <span className="celda-codigo">{linea.numero}</span>

                  <span className="cxc-previa-monto">
                    {formatMoney(linea.aplicado, moneda)}
                  </span>

                  <span className="cxc-previa-resto">
                    {linea.saldoPosterior > 0
                      ? `queda ${formatMoney(linea.saldoPosterior, moneda)}`
                      : "queda cancelada"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </ModalShell>
  )
}

export default ModalDeCobro
