import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import { renderizarPantalla } from "../test/pantallas"
import Suppliers from "./Suppliers"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PROVEEDORES = [
  {
    id: "s1",
    name: "Distribuidora Ferretera",
    contact: "Carlos Mejía",
    phone: "2550-1234",
    email: "ventas@dist.hn",
    notes: "Cemento y varilla",
  },
  {
    id: "s2",
    name: "Pinturas del Norte",
    contact: "Ana López",
    phone: "2558-7788",
    email: "",
    notes: "",
  },
]

function renderSuppliers(proveedores = PROVEEDORES, usuario = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <Suppliers />
      </ProductProvider>
    </AuthProvider>,
    { proveedores, esperar: ["proveedores"], ...usuario }
  )
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
    target: { value: texto },
  })

describe("Suppliers", () => {
  it("lista los proveedores guardados", async () => {
    await renderSuppliers()

    expect(screen.getByText("Distribuidora Ferretera")).toBeInTheDocument()
    expect(screen.getByText("Pinturas del Norte")).toBeInTheDocument()
  })

  it("filtra por nombre del proveedor", async () => {
    await renderSuppliers()
    buscar("pinturas")

    expect(screen.getByText("Pinturas del Norte")).toBeInTheDocument()
    expect(
      screen.queryByText("Distribuidora Ferretera")
    ).not.toBeInTheDocument()
  })

  it("filtra por nombre del contacto", async () => {
    await renderSuppliers()
    buscar("carlos")

    expect(screen.getByText("Distribuidora Ferretera")).toBeInTheDocument()
    expect(screen.queryByText("Pinturas del Norte")).not.toBeInTheDocument()
  })

  it("no muestra nada cuando la búsqueda no coincide", async () => {
    await renderSuppliers()
    buscar("proveedor-inexistente")

    expect(
      screen.queryByText("Distribuidora Ferretera")
    ).not.toBeInTheDocument()
  })

  it("abre el formulario de proveedor nuevo", async () => {
    await renderSuppliers()

    fireEvent.click(screen.getByRole("button", { name: /nuevo proveedor/i }))

    expect(
      screen.getByRole("heading", { name: /nuevo proveedor/i })
    ).toBeInTheDocument()
  })

  it("muestra un mensaje cuando no hay proveedores", async () => {
    await renderSuppliers([])

    expect(screen.getByText(/no hay proveedores/i)).toBeInTheDocument()
  })

  // Borrar un proveedor lo decide solo el administrador (0025).
  it("el administrador puede eliminar cada proveedor", async () => {
    await renderSuppliers()

    expect(screen.getAllByRole("button", { name: /eliminar/i })).toHaveLength(2)
  })

  it("quien solo tiene `suppliers` edita pero no ve eliminar", async () => {
    await renderSuppliers(PROVEEDORES, { rolDelUsuario: "vendedor", permisosDelUsuario: ["suppliers"] })

    expect(screen.getAllByRole("button", { name: /editar/i })).toHaveLength(2)
    expect(screen.queryAllByRole("button", { name: /eliminar/i })).toHaveLength(0)
  })
})
