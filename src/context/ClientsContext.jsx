import { useCallback, useEffect, useMemo, useState } from "react"

import { ClientsContext } from "./contexts"
import { useAuth } from "../hooks/useAuth"

import {
  traerClientes,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
} from "../lib/api/catalogos"

function ClientsProvider({ children }) {
  const { user } = useAuth()

  const [clients, setClients] = useState([])
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

    traerClientes()
      .then((lista) => {
        if (vigente) {
          setClients(lista)
          setError("")
        }
      })
      .catch((e) => {
        if (vigente) setError(e.message)
      })
      .finally(() => {
        if (vigente) setEmpresaCargada(empresaId)
      })

    return () => {
      vigente = false
    }
  }, [empresaId])

  const refrescar = useCallback(async () => {
    setClients(await traerClientes())
  }, [])

  const addClient = useCallback(
    async (cliente) => {
      const creado = await crearCliente(cliente, empresaId)

      await refrescar()

      return creado
    },
    [empresaId, refrescar]
  )

  const updateClient = useCallback(
    async (id, cliente) => {
      await actualizarCliente(id, cliente, empresaId)
      await refrescar()
    },
    [empresaId, refrescar]
  )

  const deleteClient = useCallback(
    async (id) => {
      await eliminarCliente(id)
      await refrescar()
    },
    [refrescar]
  )

  const getClientById = useCallback(
    (id) => clients.find((c) => String(c.id) === String(id)) || null,
    [clients]
  )

  const value = useMemo(
    () => ({
      clients,
      cargando,
      error,

      addClient,
      updateClient,
      deleteClient,
      getClientById,
    }),
    [clients, cargando, error, addClient, updateClient, deleteClient, getClientById]
  )

  return (
    <ClientsContext.Provider value={value}>
      {children}
    </ClientsContext.Provider>
  )
}

export default ClientsProvider
