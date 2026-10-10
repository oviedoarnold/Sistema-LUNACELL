import { useCallback, useContext, useState } from "react"
import { FaLock } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import AuditoriaDeRescates from "../components/conciliacion/AuditoriaDeRescates"
import RescateDeRespaldo from "../components/conciliacion/RescateDeRespaldo"
import VentasPorConciliar from "../components/conciliacion/VentasPorConciliar"
import { LocationsContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"

/*
  Conciliación de ventas sin conexión (OFF-1.3).

  Solo para administradores: la base solo deja conciliar y rescatar a un
  administrador (acceso_administrador, 0027/0028), y aquí se dice antes de
  que el servidor lo rechace. Tres partes:
  - ventas por conciliar: revisar y aplicar, aplicar con ajuste o anular;
  - rescate: subir un respaldo cifrado de un teléfono;
  - auditoría: cada intento de rescate, aceptado o no.
*/
const PESTANAS = [
  { id: "conciliar", texto: "Ventas por conciliar" },
  { id: "rescate", texto: "Rescate de respaldo" },
  { id: "auditoria", texto: "Auditoría de rescates" },
]

function Conciliacion() {
  const { isAdmin, getUserById } = useAuth()
  const { obtenerUbicacionPorId } = useContext(LocationsContext) || {}
  const [pestana, setPestana] = useState("conciliar")
  const [vuelta, setVuelta] = useState(0)

  const nombreDelVendedor = useCallback((id) => getUserById?.(id)?.name || "Usuario desconocido", [getUserById])
  const nombreDeUbicacion = useCallback(
    (id) => obtenerUbicacionPorId?.(id)?.name || "Ubicación desconocida",
    [obtenerUbicacionPorId]
  )

  if (!isAdmin) {
    return (
      <div className="view active crud">
        <PageHeader descripcion="Revisión de ventas hechas sin conexión." />
        <EmptyState
          Icono={FaLock}
          titulo="Solo para administradores"
          descripcion="Conciliar y rescatar ventas sin conexión solo lo puede hacer un administrador."
        />
      </div>
    )
  }

  return (
    <div className="view active crud">
      <PageHeader descripcion="Revisa las ventas sin conexión que requieren una decisión y rescata respaldos de emergencia." />

      <div className="conciliacion-pestanas" role="tablist" aria-label="Secciones de conciliación">
        {PESTANAS.map(({ id, texto }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`pestana-${id}`}
            aria-selected={pestana === id}
            aria-controls={`panel-${id}`}
            className={pestana === id ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setPestana(id)}
          >
            {texto}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`pestana-${pestana}`}>
        {pestana === "conciliar" && (
          <VentasPorConciliar key={vuelta} nombreDelVendedor={nombreDelVendedor} nombreDeUbicacion={nombreDeUbicacion} />
        )}
        {pestana === "rescate" && <RescateDeRespaldo alTerminar={() => setVuelta((n) => n + 1)} />}
        {pestana === "auditoria" && <AuditoriaDeRescates vuelta={vuelta} />}
      </div>
    </div>
  )
}

export default Conciliacion
