import { useCallback, useEffect, useMemo, useState } from "react"

import { LocationsContext } from "./contexts"
import { useAuth } from "../hooks/useAuth"

import {
  traerUbicaciones,
  crearUbicacion,
  actualizarUbicacion,
  cambiarEstadoUbicacion,
} from "../lib/api/ubicaciones"

/*
  Las ubicaciones viven en su propio contexto y no dentro de
  ProductContext.

  Es a propósito: ahí ya conviven productos, proveedores y los datos de la
  empresa, y por eso media aplicación depende del contexto de productos
  para leer la tasa de ISV. Sumarle las ubicaciones —que el POS, el
  inventario y los traslados van a consultar— apretaría ese nudo justo
  antes de la fase en la que más va a costar deshacerlo.
*/
function LocationsProvider({ children }) {
  const { user } = useAuth()

  const [locations, setLocations] = useState([])
  const [empresaCargada, setEmpresaCargada] = useState(null)
  const [error, setError] = useState("")

  const empresaId = user?.empresa_id

  /*
    Se deriva en lugar de encenderse dentro del efecto: mientras la empresa
    del usuario no coincida con la ya cargada, la pantalla está esperando.
  */
  const cargando = Boolean(empresaId) && empresaCargada !== empresaId

  useEffect(() => {
    if (!empresaId) {
      return
    }

    let vigente = true

    traerUbicaciones()
      .then((lista) => {
        if (vigente) {
          setLocations(lista)
          setError("")
        }
      })
      .catch((problema) => {
        if (vigente) setError(problema.message)
      })
      .finally(() => {
        if (vigente) setEmpresaCargada(empresaId)
      })

    return () => {
      vigente = false
    }
  }, [empresaId])

  const refrescar = useCallback(async () => {
    setLocations(await traerUbicaciones())
  }, [])

  const agregarUbicacion = useCallback(
    async (ubicacion) => {
      const creada = await crearUbicacion(ubicacion, empresaId)

      await refrescar()

      return creada
    },
    [empresaId, refrescar]
  )

  const editarUbicacion = useCallback(
    async (id, ubicacion) => {
      await actualizarUbicacion(id, ubicacion, empresaId)
      await refrescar()
    },
    [empresaId, refrescar]
  )

  const cambiarEstado = useCallback(
    async (id, activa) => {
      await cambiarEstadoUbicacion(id, activa)
      await refrescar()
    },
    [refrescar]
  )

  const obtenerUbicacionPorId = useCallback(
    (id) => locations.find((u) => String(u.id) === String(id)) || null,
    [locations]
  )

  /*
    Las activas son las únicas que pueden recibir mercadería. Se deriva
    aquí para que quien las necesite —el inventario por ubicación, los
    traslados— no repita el filtro ni se le olvide.
  */
  const ubicacionesActivas = useMemo(
    () => locations.filter((ubicacion) => ubicacion.active),
    [locations]
  )

  const value = useMemo(
    () => ({
      locations,
      ubicacionesActivas,
      cargando,
      error,

      agregarUbicacion,
      editarUbicacion,
      cambiarEstado,
      obtenerUbicacionPorId,
      refrescar,
    }),
    [
      locations,
      ubicacionesActivas,
      cargando,
      error,
      agregarUbicacion,
      editarUbicacion,
      cambiarEstado,
      obtenerUbicacionPorId,
      refrescar,
    ]
  )

  return (
    <LocationsContext.Provider value={value}>
      {children}
    </LocationsContext.Provider>
  )
}

export default LocationsProvider
