import { useRef, useState } from "react"

import { formatMoney } from "../../utils/format"
import { supabase } from "../../lib/supabase"
import { crearRescate } from "../../lib/api/ventasSinConexion"
import { importarCifrado } from "../../lib/sinConexion/exportacion"
import { rescatarVentas, resumenDeRescate, validarVentaDeRespaldo } from "../../lib/sinConexion/rescate"
import { RESULTADOS_DE_RESCATE } from "../../lib/sinConexion/textos"

/*
  Rescate de un respaldo cifrado de emergencia (rescatar_venta_sin_conexion).

  1. El administrador elige el archivo y escribe la frase: se abre aquí, en
     el navegador; ni el archivo ni la frase viajan al servidor.
  2. Se muestran las ventas que trae y si están bien formadas.
  3. Al rescatar, cada venta queda en conciliación (nunca se registra
     directo) y cada intento queda en la auditoría del servidor, también
     los rechazados.

  No se rescata dos veces: lo ya rescatado en esta sesión no se reenvía, y
  aunque se reenviara, la RPC es idempotente por clave.
*/
const TAMANO_MAXIMO = 20 * 1024 * 1024

const nuevoLote = () => `rescate-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${crypto.randomUUID().slice(0, 8)}`

function RescateDeRespaldo({ enviar = crearRescate(supabase), alTerminar }) {
  const [archivo, setArchivo] = useState(null)
  const [frase, setFrase] = useState("")
  const [abriendo, setAbriendo] = useState(false)
  const [ventas, setVentas] = useState(null)
  const [error, setError] = useState("")
  const [rescatando, setRescatando] = useState(false)
  const [avance, setAvance] = useState(0)
  const [resultados, setResultados] = useState(null)
  const yaRescatadas = useRef(new Set())

  const abrir = async (evento) => {
    evento.preventDefault()
    setError("")
    setVentas(null)
    setResultados(null)

    if (!archivo) {
      setError("Elige el archivo de respaldo.")
      return
    }

    if (archivo.size > TAMANO_MAXIMO) {
      setError("El archivo de respaldo es demasiado grande.")
      return
    }

    setAbriendo(true)

    try {
      const lista = await importarCifrado(await archivo.text(), frase)
      setVentas(lista)
      setFrase("")
    } catch (problema) {
      setError(problema?.message || "No se pudo abrir el respaldo.")
    } finally {
      setAbriendo(false)
    }
  }

  const rescatar = async () => {
    if (rescatando || !ventas?.length) return

    setRescatando(true)
    setAvance(0)
    setError("")

    try {
      const { resultados: lista, detenidoPor } = await rescatarVentas(ventas, {
        enviar,
        lote: nuevoLote(),
        yaRescatadas: yaRescatadas.current,
        alAvanzar: (_r, hechas) => setAvance(hechas),
      })

      for (const r of lista) {
        if (["en_conciliacion", "ya_en_conciliacion", "ya_registrada"].includes(r.resultado)) yaRescatadas.current.add(r.clave)
      }

      setResultados(lista)

      if (detenidoPor === "sesion") setError("Solo un administrador con sesión vigente puede rescatar ventas.")
      if (detenidoPor === "red") setError("Se perdió la conexión: las ventas no enviadas se pueden rescatar de nuevo.")

      alTerminar?.()
    } finally {
      setRescatando(false)
    }
  }

  const resumen = resultados ? resumenDeRescate(resultados) : null
  const porClave = new Map((resultados || []).map((r, i) => [`${r.clave}-${i}`, r]))

  return (
    <section aria-labelledby="rescate-titulo">
      <h2 id="rescate-titulo" className="pos-titulo">
        Rescatar ventas de un respaldo cifrado
      </h2>

      <p className="hint">
        Para las ventas de un teléfono que no puede sincronizar (sesión vencida, equipo dañado o cambiado). Cada venta
        rescatada queda en conciliación para revisarla; nunca se registra directo.
      </p>

      <form onSubmit={abrir} noValidate>
        <div className="field">
          <label htmlFor="rescate-archivo">Archivo de respaldo</label>
          <input
            id="rescate-archivo"
            type="file"
            accept=".json,application/json"
            onChange={(e) => setArchivo(e.target.files?.[0] || null)}
          />
        </div>

        <div className="field">
          <label htmlFor="rescate-frase">Frase del respaldo</label>
          <input id="rescate-frase" type="password" autoComplete="off" value={frase} onChange={(e) => setFrase(e.target.value)} />
        </div>

        <button type="submit" className="btn btn-secondary" disabled={abriendo || rescatando}>
          {abriendo ? "Abriendo…" : "Abrir respaldo"}
        </button>
      </form>

      {error && (
        <div className="alert-banner" role="alert">
          <span>{error}</span>
        </div>
      )}

      {ventas && !resultados && (
        <div className="conciliacion-resultado">
          <p role="status">
            El respaldo trae {ventas.length} {ventas.length === 1 ? "venta" : "ventas"}.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Comprobante</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col" className="r">
                    Total
                  </th>
                  <th scope="col">Revisión</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((venta, indice) => (
                  <tr key={`${venta?.clave}-${indice}`}>
                    <td>{venta?.numeroProvisional || "—"}</td>
                    <td>{venta?.registradaEn ? new Date(venta.registradaEn).toLocaleString("es-HN") : "—"}</td>
                    <td>{venta?.nombreCliente || "—"}</td>
                    <td className="r">{Number.isFinite(venta?.totalCobrado) ? formatMoney(venta.totalCobrado) : "—"}</td>
                    <td>{validarVentaDeRespaldo(venta) || "Lista para rescatar"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" className="btn btn-primary" onClick={rescatar} disabled={rescatando || ventas.length === 0}>
            {rescatando ? `Rescatando ${avance} de ${ventas.length}…` : `Rescatar ${ventas.length} ${ventas.length === 1 ? "venta" : "ventas"}`}
          </button>
        </div>
      )}

      {resultados && (
        <div className="conciliacion-resultado" role="status">
          <p>
            <b>Rescate terminado:</b> {resumen.aceptadas} aceptadas, {resumen.rechazadas} rechazadas, {resumen.invalidas} no
            enviadas por estar mal formadas o repetidas, {resumen.errores} con error y {resumen.sinEnviar} sin enviar.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Comprobante</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {[...porClave.entries()].map(([llave, r]) => (
                  <tr key={llave}>
                    <td>{r.numeroProvisional || "—"}</td>
                    <td>{RESULTADOS_DE_RESCATE[r.resultado] || r.resultado}</td>
                    <td>
                      {[r.codigo, r.detalle, r.numeroFactura && `Documento ${r.numeroFactura}`].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default RescateDeRespaldo
