import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ClientsProvider from "../context/ClientsContext"
import ProductProvider from "../context/ProductContext"
import { renderizarPantalla } from "../test/pantallas"
import Clients from "./Clients"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

vi.mock("sweetalert2", () => ({ default: { fire: vi.fn(() => Promise.resolve({})) } }))

const CLIENTES = [{ id: "c1", name: "Ferremax", rtn: "", phone: "9999-0000", address: "SPS", email: "" }]

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 2, minStock: 1 },
]

async function renderClientes(opciones = {}) {
  const r = await renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <Clients />
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { clientes: CLIENTES, productos: PRODUCTOS, esperar: ["clientes"], ...opciones }
  )

  r.falso.datos.precios_por_cliente = [{ id: "e1", cliente_id: "c1", producto_id: "p2", precio: 200 }]

  return r
}

const abrirFerremax = async () => {
  fireEvent.click(screen.getByRole("button", { name: /editar/i }))
  await screen.findByRole("heading", { name: /productos y precios especiales/i })
  await waitFor(() => expect(screen.queryByText(/cargando precios/i)).not.toBeInTheDocument())
}

const guardar = () => fireEvent.click(screen.getByRole("button", { name: /guardar cliente/i }))
const llamadas = (falso) => falso.rpc.mock.calls.filter(([n]) => n === "guardar_precios_de_cliente")

beforeEach(() => Swal.fire.mockClear())

describe("Clientes: productos y precios especiales", () => {
  it("muestra los productos asociados, con el precio general de referencia", async () => {
    await renderClientes()
    await abrirFerremax()

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.getByText(/General: L 250.00/)).toBeInTheDocument()
    expect(screen.getByLabelText(/precio especial de cemento gris/i)).toHaveValue(200)
  })

  it("busca, agrega, edita y elimina, y guarda la lista completa", async () => {
    const { falso } = await renderClientes()

    await abrirFerremax()

    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), { target: { value: "martillo" } })
    fireEvent.click(within(screen.getByText(/martillo de uña/i).closest("li")).getByRole("button", { name: /agregar/i }))
    fireEvent.change(screen.getByLabelText(/precio especial de martillo/i), { target: { value: "150.50" } })
    fireEvent.change(screen.getByLabelText(/precio especial de cemento gris/i), { target: { value: "190" } })

    guardar()

    await waitFor(() => expect(llamadas(falso)).toHaveLength(1))
    expect(llamadas(falso)[0][1]).toEqual({
      p_cliente: "c1",
      p_precios: [
        { producto_id: "p2", precio: 190 },
        { producto_id: "p1", precio: 150.5 },
      ],
    })

    await abrirFerremax()
    fireEvent.click(screen.getByRole("button", { name: /quitar martillo/i }))
    guardar()

    await waitFor(() => expect(llamadas(falso)).toHaveLength(2))
    expect(llamadas(falso)[1][1].p_precios).toEqual([{ producto_id: "p2", precio: 190 }])
  })

  it("un producto ya agregado no aparece en la búsqueda: no se puede repetir", async () => {
    await renderClientes()
    await abrirFerremax()

    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), { target: { value: "cemento" } })

    expect(screen.queryByRole("button", { name: /agregar/i })).not.toBeInTheDocument()
    expect(screen.getByText(/no hay más productos/i)).toBeInTheDocument()
  })

  it.each([["0"], ["-5"], ["10.123"], [""]])("no guarda un precio inválido (%s)", async (valor) => {
    const { falso } = await renderClientes()

    await abrirFerremax()
    fireEvent.change(screen.getByLabelText(/precio especial de cemento gris/i), { target: { value: valor } })
    guardar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Revisa los precios" })))
    expect(llamadas(falso)).toHaveLength(0)
  })

  it("si no cambió la lista, no la vuelve a enviar", async () => {
    const { falso } = await renderClientes()

    await abrirFerremax()
    guardar()

    await waitFor(() => expect(screen.queryByRole("button", { name: /guardar cliente/i })).not.toBeInTheDocument())
    expect(llamadas(falso)).toHaveLength(0)
  })

  it("si no se pudieron leer los precios, guardar el cliente no los borra", async () => {
    const { falso } = await renderClientes()
    const original = falso.from.getMockImplementation()

    falso.from.mockImplementation((tabla) => {
      if (tabla === "precios_por_cliente") throw new Error("sin red")

      return original(tabla)
    })

    fireEvent.click(screen.getByRole("button", { name: /editar/i }))

    expect(await screen.findByText(/no se pudieron cargar los precios/i)).toBeInTheDocument()

    guardar()

    await waitFor(() => expect(screen.queryByRole("button", { name: /guardar cliente/i })).not.toBeInTheDocument())
    expect(llamadas(falso)).toHaveLength(0)
    expect(falso.datos.precios_por_cliente).toHaveLength(1)
  })

  it("un cliente nuevo se guarda con su lista, ya con su identificador", async () => {
    const { falso } = await renderClientes()

    fireEvent.click(screen.getByRole("button", { name: /nuevo cliente/i }))
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Taller Nuevo" } })
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "9999-1111" } })
    fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "SPS" } })
    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), { target: { value: "martillo" } })
    fireEvent.click(within(screen.getByText(/martillo de uña/i).closest("li")).getByRole("button", { name: /agregar/i }))
    fireEvent.change(screen.getByLabelText(/precio especial de martillo/i), { target: { value: "160" } })
    guardar()

    await waitFor(() => expect(llamadas(falso)).toHaveLength(1))
    expect(llamadas(falso)[0][1].p_cliente).toBeTruthy()
    expect(llamadas(falso)[0][1].p_precios).toEqual([{ producto_id: "p1", precio: 160 }])
  })

  it("si fallan los precios del cliente nuevo, no lo duplica al reintentar", async () => {
    const { falso } = await renderClientes({ fallarEn: { guardar_precios_de_cliente: { rpc: { code: "XX000", message: "fallo" } } } })
    const cuantos = falso.datos.clientes.length

    fireEvent.click(screen.getByRole("button", { name: /nuevo cliente/i }))
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Taller Nuevo" } })
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "9999-1111" } })
    fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "SPS" } })
    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), { target: { value: "martillo" } })
    fireEvent.click(within(screen.getByText(/martillo de uña/i).closest("li")).getByRole("button", { name: /agregar/i }))
    guardar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "No se pudo guardar" })))
    await waitFor(() => expect(screen.getByRole("button", { name: /guardar cliente/i })).toBeEnabled())

    guardar()

    await waitFor(() => expect(llamadas(falso).length).toBeGreaterThan(1))
    expect(falso.datos.clientes).toHaveLength(cuantos + 1)
  })

  it("un vendedor los consulta, pero no puede cambiarlos", async () => {
    const { falso } = await renderClientes({ rolDelUsuario: "vendedor", permisosDelUsuario: ["clients"] })

    await abrirFerremax()

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.getByText(/solo un administrador/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/buscar producto/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/precio especial de/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /quitar/i })).not.toBeInTheDocument()

    guardar()

    await waitFor(() => expect(screen.queryByRole("button", { name: /guardar cliente/i })).not.toBeInTheDocument())
    expect(llamadas(falso)).toHaveLength(0)
  })

  it("no muestra costos", async () => {
    await renderClientes()
    await abrirFerremax()

    expect(document.body.textContent).not.toMatch(/costo|margen|utilidad/i)
  })
})
