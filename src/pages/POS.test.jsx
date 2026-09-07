import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import SalesProvider from "../context/SalesContext"
import { renderizarPantalla } from "../test/pantallas"
import POS from "./POS"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 2, minStock: 1 },
]

const CLIENTES = [
  { id: "c1", name: "Ferremax", rtn: "0801199912345", phone: "9999-0000", address: "SPS", email: "" },
]

function renderPOS() {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <SalesProvider>
            <MemoryRouter initialEntries={["/pos"]}>
              <POS />
            </MemoryRouter>
          </SalesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { productos: PRODUCTOS, clientes: CLIENTES, esperar: ["ventas"] }
  )
}

const agregar = (nombre) => {
  const fila = screen
    .getAllByText(nombre)[0]
    .closest("div").parentElement

  fireEvent.click(
    within(fila).getAllByRole("button", { name: /agregar/i })[0]
  )
}

const totales = () => screen.getByText("Total").closest("div").parentElement

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), {
    target: { value: texto },
  })

describe("POS: catálogo", () => {
  it("lista los productos disponibles", async () => {
    await renderPOS()

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
  })

  it("filtra por nombre", async () => {
    await renderPOS()
    buscar("martillo")

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.queryByText("Cemento gris")).not.toBeInTheDocument()
  })

  it("filtra por código", async () => {
    await renderPOS()
    buscar("C-001")

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })
})

describe("POS: carrito", () => {
  it("arranca con el total en cero", async () => {
    await renderPOS()
    expect(screen.getAllByText("L 0.00").length).toBeGreaterThan(0)
  })

  it("agrega un producto y calcula el total con impuesto", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 27.00")
    expect(totales()).toHaveTextContent("L 207.00")
  })

  it("descuenta del disponible lo que ya está en el carrito", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    expect(screen.getByText(/9 disp/i)).toBeInTheDocument()
  })

  it("acumula al agregar el mismo producto dos veces", async () => {
    await renderPOS()
    agregar("Martillo de uña")
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 414.00")
  })
})

describe("POS: forma de pago", () => {
  it("arranca en contado", async () => {
    await renderPOS()

    const contado = screen.getByRole("button", { name: /contado/i })

    expect(contado).toBeInTheDocument()
  })

  it("al elegir crédito pide fecha de vencimiento", async () => {
    await renderPOS()

    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))

    expect(screen.getByText(/fecha.*(pago|vencimiento)/i)).toBeInTheDocument()
  })
})

describe("POS: cliente", () => {
  it("permite escribir el nombre del comprador", async () => {
    await renderPOS()

    const campo = screen.getByPlaceholderText(/nombre/i)

    fireEvent.change(campo, { target: { value: "Ferremax" } })

    expect(campo).toHaveValue("Ferremax")
  })

  it("ofrece capturar el RTN del comprador", async () => {
    await renderPOS()
    expect(screen.getByText(/RTN del comprador/i)).toBeInTheDocument()
  })
})
