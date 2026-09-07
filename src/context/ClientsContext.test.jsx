import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useContext } from "react"

import ClientsProvider from "./ClientsContext"
import { AuthProvider } from "./AuthContext"
import { ClientsContext } from "./contexts"
import { esperarQueSeAsiente, montarDatos } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

function envoltura({ children }) {
  return (
    <AuthProvider>
      <ClientsProvider>{children}</ClientsProvider>
    </AuthProvider>
  )
}

async function montarContexto(clientes = []) {
  const falso = montarDatos({ clientes })

  const vista = renderHook(() => useContext(ClientsContext), {
    wrapper: envoltura,
  })

  await waitFor(() => {
    expect(falso.from).toHaveBeenCalledWith("clientes")
  })

  await esperarQueSeAsiente(falso)

  return { ...vista, falso }
}

const clientePrueba = {
  name: "  Ferremax  ",
  rtn: " 0801199912345 ",
  phone: " 9999-0000 ",
  address: " San Pedro Sula ",
  email: " ventas@ferremax.hn ",
}

describe("ClientsContext", () => {
  it("arranca sin clientes cuando la ferretería no tiene ninguno", async () => {
    const { result } = await montarContexto()

    expect(result.current.clients).toEqual([])
  })

  it("lee los clientes que ya están en la base", async () => {
    const { result } = await montarContexto([{ id: "c1", name: "Taller Díaz" }])

    expect(result.current.clients).toHaveLength(1)
    expect(result.current.clients[0].name).toBe("Taller Díaz")
  })

  it("agrega un cliente recortando los espacios", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.addClient(clientePrueba)
    })

    const [cliente] = result.current.clients

    expect(cliente.name).toBe("Ferremax")
    expect(cliente.rtn).toBe("0801199912345")
    expect(cliente.address).toBe("San Pedro Sula")
  })

  it("guarda el cliente nuevo con la empresa de quien lo crea", async () => {
    const { result, falso } = await montarContexto()

    await act(async () => {
      await result.current.addClient({ name: "Nuevo" })
    })

    expect(falso.datos.clientes[0].empresa_id).toBe("empresa-prueba")
  })

  it("deja que la base asigne el identificador del cliente nuevo", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.addClient({ name: "Nuevo" })
    })

    expect(result.current.clients[0].id).toBeTruthy()
  })

  it("actualiza un cliente existente", async () => {
    const { result } = await montarContexto([{ id: "c1", name: "Antes" }])

    await act(async () => {
      await result.current.updateClient("c1", { name: "Después" })
    })

    expect(result.current.clients[0].name).toBe("Después")
  })

  it("no toca a los demás clientes al actualizar uno", async () => {
    const { result } = await montarContexto([
      { id: "c1", name: "Uno" },
      { id: "c2", name: "Dos" },
    ])

    await act(async () => {
      await result.current.updateClient("c1", { name: "Uno editado" })
    })

    const dos = result.current.clients.find((c) => c.id === "c2")

    expect(dos.name).toBe("Dos")
  })

  it("elimina un cliente", async () => {
    const { result } = await montarContexto([{ id: "c1", name: "Temporal" }])

    await act(async () => {
      await result.current.deleteClient("c1")
    })

    expect(result.current.clients).toHaveLength(0)
  })

  it("encuentra un cliente por identificador", async () => {
    const { result } = await montarContexto([{ id: "c1", name: "Buscado" }])

    expect(result.current.getClientById("c1").name).toBe("Buscado")
  })

  it("devuelve algo falsy si el cliente no existe", async () => {
    const { result } = await montarContexto()

    expect(result.current.getClientById("no-existe")).toBeFalsy()
  })
})
