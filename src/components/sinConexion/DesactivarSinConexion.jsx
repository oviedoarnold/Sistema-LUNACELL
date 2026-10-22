import { useCallback, useEffect, useState } from "react"

import FormField from "../forms/FormField"
import ModalShell from "../forms/ModalShell"
import { resumenParaDesactivarSinConexion } from "../../lib/api/ubicaciones"

/*
  Confirmación antes de quitarle a una ubicación las ventas sin conexión.

  El servidor solo sabe lo que ya le llegó. Las ventas que siguen en los
  teléfonos no las ve nadie más que el teléfono, y después de desactivar
  llegan a Conciliación con «ubicación no habilitada». No se pierden, pero
  hay que revisarlas: por eso se pide confirmar que los teléfonos
  sincronizaron y escribir el nombre de la ubicación.

  Si no se puede consultar lo que sí sabe el servidor, no se muestran
  ceros: se dice que no se pudo y no se deja continuar.
*/
function fechaLegible(iso) {
  return iso ? new Date(iso).toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short" }) : "Ninguna"
}

function DesactivarSinConexion({ ubicacion, onCancelar, onConfirmar }) {
  const [consulta, setConsulta] = useState({ estado: "cargando", resumen: null, error: "" })
  const [confirmado, setConfirmado] = useState(false)
  const [nombre, setNombre] = useState("")

  // Solo actualiza el estado cuando llega la respuesta; «cargando» lo pone quien la pide.
  const consultar = useCallback(
    () =>
      resumenParaDesactivarSinConexion(ubicacion.id).then(
        (resumen) => setConsulta({ estado: "listo", resumen, error: "" }),
        (error) => setConsulta({ estado: "error", resumen: null, error: error.message })
      ),
    [ubicacion.id]
  )

  useEffect(() => {
    void consultar()
  }, [consultar])

  const reintentar = () => {
    setConsulta({ estado: "cargando", resumen: null, error: "" })
    void consultar()
  }

  const { estado, resumen, error } = consulta
  const puedeDesactivar = estado === "listo" && confirmado && nombre.trim() === ubicacion.name

  return (
    <ModalShell
      titulo="Desactivar ventas sin conexión"
      onCerrar={onCancelar}
      acciones={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirmar} disabled={!puedeDesactivar}>
            Desactivar ventas sin conexión
          </button>
        </>
      }
    >
      <p>
        «{ubicacion.name}» dejará de vender sin conexión. Los teléfonos lo reciben cuando abren el POS con conexión.
      </p>

      {estado === "cargando" && (
        <p className="crud-cargando" role="status">Comprobando las ventas sin conexión de esta ubicación…</p>
      )}

      {estado === "error" && (
        <div className="alert-banner" role="alert">
          <span>
            {error} No se puede desactivar sin comprobarlo.{" "}
            <button type="button" className="btn btn-secondary btn-sm" onClick={reintentar}>Reintentar</button>
          </span>
        </div>
      )}

      {estado === "listo" && (
        <ul className="config-descripcion">
          <li>
            Ventas por conciliar pendientes: <strong data-testid="resumen-por-conciliar">{resumen.porConciliar}</strong>
          </li>
          <li>Última venta sin conexión recibida: <strong>{fechaLegible(resumen.ultimaRecibida)}</strong></li>
          <li>
            Teléfonos que vendieron sin conexión en los últimos 7 días: <strong>{resumen.telefonosUltimos7Dias}</strong>
          </li>
          <li>Usuarios asignados a esta ubicación: <strong>{resumen.usuariosAsignados}</strong></li>
        </ul>
      )}

      <div className="alert-banner" role="note">
        <span>
          <strong>El servidor no puede saber qué ventas siguen guardadas solo en los teléfonos.</strong>
          Antes de desactivar, cada teléfono de esta ubicación debe abrir el POS con conexión y mostrar «Sin ventas
          pendientes», o generar un respaldo cifrado. Lo que llegue después irá a Conciliación: no se pierde, pero
          habrá que revisarlo.
        </span>
      </div>

      <div className="config-casilla">
        <label htmlFor="desactivar-sin-conexion-confirmo">
          <input
            id="desactivar-sin-conexion-confirmo"
            type="checkbox"
            checked={confirmado}
            onChange={(e) => setConfirmado(e.target.checked)}
          />
          Confirmo que los teléfonos de esta ubicación sincronizaron o generaron su respaldo cifrado.
        </label>
      </div>

      <div className="form-grid">
        <FormField etiqueta={`Escribe el nombre de la ubicación (${ubicacion.name}) para confirmar`} ancho="full">
          <input
            id="desactivar-sin-conexion-nombre"
            value={nombre}
            autoComplete="off"
            onChange={(e) => setNombre(e.target.value)}
          />
        </FormField>
      </div>
    </ModalShell>
  )
}

export default DesactivarSinConexion
