import { useState } from "react"

import ModalShell from "../forms/ModalShell"

/*
  Respaldo cifrado de emergencia: las ventas que el servidor todavía no
  confirmó salen del teléfono en un archivo protegido con una frase. Sirve
  si el teléfono se va a quedar sin conexión por días, se va a reiniciar o
  a cambiar. Un administrador lo sube en «Conciliación → Rescate».

  La frase no se guarda en ningún lado: sin ella el archivo no se abre.
  Exportar NO borra nada: las ventas siguen en el teléfono y se sincronizan
  igual cuando vuelva la conexión.
*/
const LARGO_MINIMO = 10

function descargar(texto, nombreArchivo) {
  const blob = new Blob([texto], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement("a")

  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ModalDeRespaldo({ exportarRespaldo, onCerrar, descargarArchivo = descargar }) {
  const [frase, setFrase] = useState("")
  const [repeticion, setRepeticion] = useState("")
  const [error, setError] = useState("")
  const [generando, setGenerando] = useState(false)
  const [resultado, setResultado] = useState(null)

  const generar = async (evento) => {
    evento.preventDefault()
    setError("")

    if (frase.length < LARGO_MINIMO) {
      setError(`La frase debe tener al menos ${LARGO_MINIMO} caracteres.`)
      return
    }

    if (frase !== repeticion) {
      setError("Las dos frases no coinciden.")
      return
    }

    setGenerando(true)

    try {
      const { texto, cantidad, nombreArchivo } = await exportarRespaldo(frase)

      descargarArchivo(texto, nombreArchivo)
      setResultado({ cantidad, nombreArchivo })
      setFrase("")
      setRepeticion("")
    } catch (problema) {
      setError(problema?.message || "No se pudo generar el respaldo.")
    } finally {
      setGenerando(false)
    }
  }

  const acciones = resultado ? (
    <button type="button" className="btn btn-primary" onClick={onCerrar}>
      Listo
    </button>
  ) : (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        Cancelar
      </button>
      <button type="submit" form="form-respaldo" className="btn btn-primary" disabled={generando}>
        {generando ? "Generando…" : "Generar archivo cifrado"}
      </button>
    </>
  )

  return (
    <ModalShell titulo="Respaldo cifrado de emergencia" onCerrar={onCerrar} acciones={acciones}>
      {resultado ? (
        <div role="status">
          <p>
            <b>Archivo generado:</b> {resultado.nombreArchivo}
          </p>
          <p>
            Contiene {resultado.cantidad} {resultado.cantidad === 1 ? "venta" : "ventas"} sin confirmar.{" "}
            <b>Las ventas siguen guardadas en este teléfono</b> y se enviarán solas cuando vuelva la conexión.
          </p>
          <p className="hint">
            Entrega el archivo y la frase por separado a un administrador. Sin la frase no se puede abrir.
          </p>
        </div>
      ) : (
        <form id="form-respaldo" onSubmit={generar} noValidate>
          <p className="hint">El archivo queda cifrado con esta frase. No se guarda en ningún lado: anótala aparte.</p>

          <div className="field">
            <label htmlFor="respaldo-frase">Frase de protección</label>
            <input
              id="respaldo-frase"
              type="password"
              autoComplete="new-password"
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
            />
            <span className="hint">Al menos {LARGO_MINIMO} caracteres.</span>
          </div>

          <div className="field">
            <label htmlFor="respaldo-repeticion">Repite la frase</label>
            <input
              id="respaldo-repeticion"
              type="password"
              autoComplete="new-password"
              value={repeticion}
              onChange={(e) => setRepeticion(e.target.value)}
            />
          </div>

          {error && (
            <span className="error-msg show" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </ModalShell>
  )
}

export default ModalDeRespaldo
