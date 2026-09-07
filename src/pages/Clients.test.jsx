import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ClientsProvider from "../context/ClientsContext"
import { renderizarPantalla } from "../test/pantallas"
import Clients from "./Clients"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const CLIENTES = [
  {
    id: "c1",
    name: "Ferremax",
    rtn: "0801199912345",
    phone: "9999-0000",
    address: "San Pedro Sula",
    email: "ventas@ferremax.hn",
  },
  {
    id: "c2",
    name: "Taller Díaz",
    rtn: "",
    phone: "8888-1111",
    address: "Choloma",
    email: "",
  },
]

function renderClients(clientes = CLIENTES) {
  return renderizarPantalla(
    <AuthProvider>
      <ClientsProvider>
        <Clients />
      </ClientsProvider>
    </AuthProvider>,
    { clientes, esperar: ["clientes"] }
  )
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar cliente/i), {
    target: { value: texto },
  })

describe("Clients", () => {
  it("lista los clientes guardados", async () => {
    await renderClients()

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.getByText("Taller Díaz")).toBeInTheDocument()
  })

  it("muestra el RTN y el teléfono de cada cliente", async () => {
    await renderClients()

    expect(screen.getByText("0801199912345")).toBeInTheDocument()
    expect(screen.getByText("9999-0000")).toBeInTheDocument()
  })

  it("usa un guion cuando falta un dato", async () => {
    await renderClients()

    const fila = screen.getByText("Taller Díaz").closest("tr")

    expect(within(fila).getAllByText("—").length).toBeGreaterThan(0)
  })

  it("filtra por nombre", async () => {
    await renderClients()
    buscar("ferremax")

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.queryByText("Taller Díaz")).not.toBeInTheDocument()
  })

  it("filtra por RTN", async () => {
    await renderClients()
    buscar("0801199912345")

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.queryByText("Taller Díaz")).not.toBeInTheDocument()
  })

  it("filtra por teléfono", async () => {
    await renderClients()
    buscar("8888")

    expect(screen.getByText("Taller Díaz")).toBeInTheDocument()
    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
  })

  it("no muestra filas cuando nada coincide", async () => {
    await renderClients()
    buscar("no-existe-este-cliente")

    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
    expect(screen.queryByText("Taller Díaz")).not.toBeInTheDocument()
  })

  it("abre el formulario al pedir un cliente nuevo", async () => {
    await renderClients()

    fireEvent.click(screen.getByRole("button", { name: /nuevo cliente/i }))

    expect(
      screen.getByRole("heading", { name: /nuevo cliente/i })
    ).toBeInTheDocument()
  })

  it("cada cliente ofrece editar y eliminar", async () => {
    await renderClients()

    expect(screen.getAllByRole("button", { name: /editar/i })).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: /eliminar/i })).toHaveLength(2)
  })
})
