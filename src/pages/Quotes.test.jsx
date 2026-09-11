import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import QuotesProvider from "../context/QuotesContext"
import { EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import {
  CAMPOS_DEL_CLIENTE,
  abrirClienteNuevo as abrirAltaDeCliente,
  agregarProducto as agregar,
  filasDelCarrito,
  guardarCliente,
  llenarAltaDeCliente,
  modalDeCliente,
  paso,
  quitarDelCarrito,
} from "../test/carrito"
import Quotes from "./Quotes"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 4, minStock: 1 },
]

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const cotizacion = (extra = {}) => ({
  id: "Q-1",
  quoteNumber: "COT-00001",
  date: "20/08/2026",
  timestamp: Date.now(),
  clientId: "c1",
  clientName: "Ferremax",
  rtn: "0801199912345",
  validity: "2027-06-30",
  includeTax: true,
  taxRate: 15,
  items: [
    { productId: "p1", id: "p1", code: "M-001", name: "Martillo de uña", price: 180, qty: 2, quantity: 2, subtotal: 360 },
  ],
  subtotal: 360,
  tax: 54,
  total: 414,
  company: empresa,
  ...extra,
})

function renderQuotes(cotizaciones = []) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <QuotesProvider>
            <MemoryRouter initialEntries={["/quotes"]}>
              <Quotes />
            </MemoryRouter>
          </QuotesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { productos: PRODUCTOS, cotizaciones, esperar: ["cotizaciones"] }
  )
}

const totales = () => screen.getByText("Total").closest("div").parentElement

const filaDe = (numero) =>
  screen.getByText(numero, { exact: false }).closest(".sale-card")

const abrirClienteNuevo = () => abrirAltaDeCliente(/nombre del cliente/i)

const quitar = quitarDelCarrito


describe("Quotes: catálogo", () => {
  it("lista los productos para cotizar", async () => {
    await renderQuotes()

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
  })

  it("filtra por nombre", async () => {
    await renderQuotes()

    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), {
      target: { value: "cemento" },
    })

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })
})

describe("Quotes: armado", () => {
  it("arranca sin productos", async () => {
    await renderQuotes()
    expect(screen.getByText(/agrega productos/i)).toBeInTheDocument()
  })

  it("calcula el total con ISV incluido", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 207.00")
  })

  it("permite cotizar sin ISV", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    fireEvent.click(screen.getByLabelText(/incluir isv/i))

    expect(totales()).toHaveTextContent("L 180.00")
  })

  it("sube la cantidad desde el carrito", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    paso("Martillo de uña", "+")

    expect(totales()).toHaveTextContent("L 414.00")
  })

  it("baja la cantidad desde el carrito", async () => {
    await renderQuotes()
    agregar("Martillo de uña")
    paso("Martillo de uña", "+")

    paso("Martillo de uña", "−")

    expect(totales()).toHaveTextContent("L 207.00")
  })

  /*
    Una cotización tampoco ofrece más de lo que hay: el tope es la
    existencia, igual que al facturar.
  */
  it("no deja subir la cantidad por encima de la existencia", async () => {
    await renderQuotes()
    agregar("Cemento gris")
    paso("Cemento gris", "+")
    paso("Cemento gris", "+")
    paso("Cemento gris", "+")

    paso("Cemento gris", "+")

    expect(totales()).toHaveTextContent("L 1,150.00")
  })

  it("quita un producto del carrito", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    quitar("Martillo de uña")

    expect(filasDelCarrito()).toHaveLength(0)
  })

  it("acumula al agregar el mismo producto dos veces", async () => {
    await renderQuotes()
    agregar("Martillo de uña")
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 414.00")
  })
})

describe("Quotes: alta de cliente", () => {
  it("abre el formulario de cliente nuevo", async () => {
    await renderQuotes()

    abrirClienteNuevo()

    expect(
      screen.getByRole("heading", { name: /nuevo cliente/i })
    ).toBeInTheDocument()
  })

  it("el formulario pide nombre, RTN, teléfono, correo y dirección", async () => {
    await renderQuotes()

    abrirClienteNuevo()
    const modal = modalDeCliente()

    CAMPOS_DEL_CLIENTE.forEach((campo) =>
      expect(modal.getByLabelText(campo)).toBeInTheDocument()
    )
  })

  it("arrastra al formulario lo que ya se había escrito", async () => {
    await renderQuotes()

    fireEvent.change(screen.getByPlaceholderText(/nombre del cliente/i), {
      target: { value: "Taller Nuevo" },
    })
    abrirClienteNuevo()

    expect(modalDeCliente().getByLabelText(/^nombre$/i)).toHaveValue(
      "Taller Nuevo"
    )
  })

  it("exige nombre, teléfono y dirección", async () => {
    const { falso } = await renderQuotes()

    abrirClienteNuevo()
    guardarCliente()

    expect(falso.datos.clientes ?? []).toHaveLength(0)
  })

  /*
    Igual que en el punto de venta: hay que esperar a la base antes de
    seleccionar, o lo seleccionado es una promesa.
  */
  it("deja seleccionado el cliente que devolvió la base", async () => {
    await renderQuotes()

    abrirClienteNuevo()
    llenarAltaDeCliente()
    guardarCliente()

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/nombre del cliente/i)
      ).toHaveValue("Taller Nuevo")
    )
  })

  it("guarda el cliente una sola vez", async () => {
    const { falso } = await renderQuotes()

    abrirClienteNuevo()
    llenarAltaDeCliente()
    guardarCliente()

    await waitFor(() => expect(falso.datos.clientes).toHaveLength(1))
  })
})

describe("Quotes: historial", () => {
  it("avisa cuando no hay cotizaciones", async () => {
    await renderQuotes()
    expect(screen.getByText(/historial de cotizaciones/i)).toBeInTheDocument()
  })

  it("lista las cotizaciones guardadas", async () => {
    await renderQuotes([cotizacion()])
    expect(screen.getByText("Ferremax")).toBeInTheDocument()
  })

  it("marca vigente la que aún no vence", async () => {
    await renderQuotes([cotizacion()])
    expect(within(filaDe("COT-00001")).getByText("Vigente")).toBeInTheDocument()
  })

  it("marca vencida la que ya pasó su vigencia", async () => {
    await renderQuotes([cotizacion({ validity: "2020-01-01" })])
    expect(within(filaDe("COT-00001")).getByText("Vencida")).toBeInTheDocument()
  })

  it("marca sin vigencia la que no tiene fecha", async () => {
    await renderQuotes([cotizacion({ validity: "" })])

    expect(
      within(filaDe("COT-00001")).getByText("Sin vigencia")
    ).toBeInTheDocument()
  })

  it("ofrece facturar cada cotización", async () => {
    await renderQuotes([cotizacion()])

    expect(
      within(filaDe("COT-00001")).getByRole("button", { name: /facturar/i })
    ).toBeInTheDocument()
  })

  it("busca por nombre de cliente", async () => {
    await renderQuotes([
      cotizacion(),
      cotizacion({ id: "Q-2", quoteNumber: "COT-00002", clientName: "Taller Díaz" }),
    ])

    fireEvent.change(screen.getByPlaceholderText(/buscar por cliente/i), {
      target: { value: "taller" },
    })

    expect(screen.getByText("Taller Díaz")).toBeInTheDocument()
    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
  })
})
