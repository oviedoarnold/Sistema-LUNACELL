import { useCallback, useMemo } from "react"

import { useAuth } from "./useAuth"
import { useExistencias } from "./useExistencias"

/*
  Cuánto hay de cada producto en la ubicación operativa de quien está en
  sesión: lo único que se puede vender desde ahí.

  Es la misma regla que aplica registrar_venta_ubicacion() en la base, que
  descuenta de la ubicación del usuario y de ninguna otra, y la misma
  fuente que la pantalla Existencias (`existencias_por_ubicacion`). El
  `stock` del catálogo es la suma de todo el libro de movimientos, sin
  ubicación: aquí no se usa nunca, tampoco como respaldo.

  Mientras no hay datos de esa ubicación —cargando, con error o sin
  ubicación asignada— la existencia es 0 y `motivo` dice por qué, para que
  la pantalla bloquee la venta y lo explique.
*/
const MOTIVOS = {
  "sin-ubicacion":
    "No tienes una ubicación operativa asignada. Pide que te asignen desde dónde trabajas antes de facturar.",
  cargando: "Cargando la existencia de tu ubicación…",
}

function estadoDe({ ubicacionId, cargando, error }) {
  if (!ubicacionId) return "sin-ubicacion"
  if (cargando) return "cargando"
  if (error) return "error"

  return "lista"
}

export function useExistenciaDeMiUbicacion() {
  const { user } = useAuth()
  const ubicacionId = user?.locationId || ""

  // Usuario y ubicación: si cualquiera cambia, lo cargado antes ya no vale.
  const { existencias, cargando, error, recargar } = useExistencias({
    clave: `${user?.id || ""}|${ubicacionId}`,
    activo: Boolean(ubicacionId),
  })

  const estado = estadoDe({ ubicacionId, cargando, error })
  const lista = estado === "lista"

  const porProducto = useMemo(
    () =>
      new Map(
        existencias
          .filter((fila) => fila.locationId === ubicacionId)
          .map((fila) => [String(fila.productId), fila.quantity])
      ),
    [existencias, ubicacionId]
  )

  const existenciaDe = useCallback(
    (producto) => (lista ? porProducto.get(String(producto?.id)) ?? 0 : 0),
    [lista, porProducto]
  )

  return {
    existenciaDe,
    lista,
    error: estado === "error",
    motivo: estado === "error" ? error : MOTIVOS[estado] || "",
    recargar,
  }
}

export default useExistenciaDeMiUbicacion
