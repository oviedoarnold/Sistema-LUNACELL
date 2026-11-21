import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import TablaDeUsuarios from "./TablaDeUsuarios"

/*
  La presentación de la lista de usuarios. Las acciones las prueba
  pages/Settings.test.jsx contra el servidor falso; aquí, lo que se ve.
*/

const UBICACIONES = [
  { id: "bodega", name: "Lunacell Bodega" },
  { id: "ruta", name: "Ruta local" },
]

const USUARIOS = [
  { id: "u1", name: "Arnold Oviedo", email: "admin@ejemplo.test", role: "admin", active: true, permissions: [], locationId: "bodega" },
  { id: "u2", name: "Contador", username: "contador1", role: "contador", active: true, permissions: ["dashboard", "sales-history", "products-read"], locationId: "" },
  {
    id: "u3",
    name: "Vendedor Camión 01",
    username: "camion01",
    role: "vendedor",
    active: false,
    permissions: ["pos", "quotes", "clients", "sales-history", "inventory-own", "orders-resolve", "settlements-view", "dashboard"],
    locationId: "ruta",
  },
]

const ETIQUETAS = {
  dashboard: "Dashboard",
  "sales-history": "Historial de ventas",
  "products-read": "Consultar productos",
  pos: "Facturar",
  quotes: "Cotizar",
  clients: "Clientes",
  "inventory-own": "Inventario de su ubicación",
  "orders-resolve": "Resolver pedidos",
  "settlements-view": "Consultar liquidaciones",
}

function renderTabla(cambios = {}) {
  const manejadores = { onEditar: vi.fn(), onActivar: vi.fn(), onDesbloquear: vi.fn(), onRestablecer: vi.fn() }

  render(
    <TablaDeUsuarios
      usuarios={USUARIOS}
      usuarioEnSesion={{ id: "u1" }}
      ubicaciones={UBICACIONES}
      etiquetaDelRol={(r) => ({ admin: "Administrador", contador: "Contador", vendedor: "Vendedor" })[r]}
      etiquetaDelPermiso={(p) => ETIQUETAS[p] || p}
      minutosDeBloqueo={() => 5}
      {...manejadores}
      {...cambios}
    />
  )

  return manejadores
}

const fila = (nombre) => screen.getByText(nombre, { selector: "strong" }).closest("tr")

describe("TablaDeUsuarios", () => {
  it("una fila compacta: ubicación, rol, resumen de permisos y estado", () => {
    renderTabla()

    const vendedor = within(fila("Vendedor Camión 01"))

    expect(vendedor.getByText("@camion01")).toBeInTheDocument()
    expect(vendedor.getByText("Ruta local")).toBeInTheDocument()
    expect(vendedor.getByText("Vendedor")).toHaveClass("badge-rol-vendedor")
    expect(vendedor.getByText(/8 permisos/)).toBeInTheDocument()
    expect(vendedor.getByText("Inactivo")).toHaveClass("badge-neutral")
    expect(vendedor.queryByText("Facturar")).not.toBeInTheDocument()

    expect(within(fila("Arnold Oviedo")).getByText("Acceso total")).toBeInTheDocument()
    expect(within(fila("Arnold Oviedo")).getByText("Activo")).toHaveClass("badge-paid")
    expect(within(fila("Contador")).getByText("—")).toBeInTheDocument()
  })

  it("«Ver» abre los permisos reales agrupados por categoría", () => {
    renderTabla()

    fireEvent.click(screen.getByRole("button", { name: "Ver los permisos de Vendedor Camión 01" }))

    const ventana = screen.getByRole("dialog", { name: "Permisos de Vendedor Camión 01" })
    const grupo = (nombre) => within(within(ventana).getByRole("region", { name: nombre })).getAllByRole("listitem").map((li) => li.textContent)

    expect(grupo("Ventas")).toEqual(["Facturar", "Cotizar", "Historial de ventas"])
    expect(grupo("Inventario")).toEqual(["Inventario de su ubicación"])
    expect(grupo("Pedidos")).toEqual(["Resolver pedidos", "Consultar liquidaciones"])
    expect(grupo("Clientes")).toEqual(["Clientes"])
    expect(grupo("Reportes")).toEqual(["Dashboard"])
    expect(within(ventana).queryByRole("region", { name: "Configuración" })).not.toBeInTheDocument()
  })

  it("busca y filtra por rol, estado y ubicación", () => {
    renderTabla()

    const nombres = () => screen.getAllByRole("row").slice(1).map((f) => f.querySelector("strong").textContent)

    fireEvent.change(screen.getByLabelText("Filtrar por rol"), { target: { value: "vendedor" } })
    expect(nombres()).toEqual(["Vendedor Camión 01"])

    fireEvent.change(screen.getByLabelText("Filtrar por rol"), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "activo" } })
    expect(nombres()).toEqual(["Arnold Oviedo", "Contador"])

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Filtrar por ubicación"), { target: { value: "-" } })
    expect(nombres()).toEqual(["Contador"])

    fireEvent.change(screen.getByLabelText("Filtrar por ubicación"), { target: { value: "" } })
    fireEvent.change(screen.getByPlaceholderText(/buscar por nombre/i), { target: { value: "camion01" } })
    expect(nombres()).toEqual(["Vendedor Camión 01"])
  })

  it("las acciones están en un menú; Escape lo cierra y devuelve el foco", () => {
    const { onActivar } = renderTabla()

    const boton = within(fila("Vendedor Camión 01")).getByRole("button", { name: "Acciones de Vendedor Camión 01" })

    fireEvent.click(boton)

    const menu = screen.getByRole("menu", { name: "Acciones de Vendedor Camión 01" })

    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Editar", "Activar", "Restablecer contraseña"])
    expect(boton).toHaveAttribute("aria-expanded", "true")

    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(boton).toHaveFocus()

    fireEvent.click(boton)
    fireEvent.click(screen.getByRole("menuitem", { name: "Activar" }))

    expect(onActivar).toHaveBeenCalledWith(USUARIOS[2])
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("sobre la propia cuenta solo ofrece editar", () => {
    renderTabla()

    fireEvent.click(screen.getByRole("button", { name: "Acciones de Arnold Oviedo" }))

    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Editar"])
  })
})
