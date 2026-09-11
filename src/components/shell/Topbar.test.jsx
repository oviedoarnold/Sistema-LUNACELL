import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import Topbar from "./Topbar"
import { MODULOS_DEL_MENU, tituloDeLaRuta } from "./menuDelPanel"
import { NAV_ROUTES } from "../../routes/navigation"

const montar = (ruta = "/dashboard", props = {}) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Topbar {...props} />
    </MemoryRouter>
  )

describe("Topbar · título de la página", () => {
  it.each([
    ["/dashboard", "Dashboard"],
    ["/pos", "Facturar"],
    ["/quotes", "Cotizar"],
    ["/products", "Inventario"],
    ["/clients", "Clientes"],
    ["/suppliers", "Proveedores"],
    ["/sales-history", "Historial"],
    ["/locations", "Ubicaciones"],
    ["/settings", "Configuración"],
  ])("en %s muestra %s", (ruta, titulo) => {
    montar(ruta)

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument()
  })

  it("una ruta desconocida no inventa un título", () => {
    montar("/algo-que-no-existe")

    expect(screen.getByRole("heading").textContent).toBe("")
  })
})

describe("Topbar · botón de menú", () => {
  it("avisa al armazón para abrir el cajón", () => {
    const onAbrirMenu = vi.fn()
    montar("/dashboard", { onAbrirMenu })

    fireEvent.click(screen.getByRole("button", { name: /abrir menú/i }))

    expect(onAbrirMenu).toHaveBeenCalled()
  })

  it("declara qué controla y si está desplegado", () => {
    montar("/dashboard", { menuAbierto: true })

    const boton = screen.getByRole("button", { name: /abrir menú/i })

    expect(boton).toHaveAttribute("aria-controls", "panel-sidebar")
    expect(boton).toHaveAttribute("aria-expanded", "true")
  })

  it("con el cajón cerrado lo refleja", () => {
    montar("/dashboard", { menuAbierto: false })

    expect(
      screen.getByRole("button", { name: /abrir menú/i })
    ).toHaveAttribute("aria-expanded", "false")
  })
})

/*
  El menú y las rutas protegidas son dos listas distintas: una decide qué
  se dibuja y otra a dónde mandar a quien entra donde no debe. Si se
  separan, el panel acaba con un módulo que no se puede abrir o con una
  ruta a la que no se llega desde ningún sitio.
*/
describe("el menú y las rutas del router no se separan", () => {
  it("cubre exactamente las mismas rutas", () => {
    const delMenu = MODULOS_DEL_MENU.map((m) => m.to).sort()
    const delRouter = NAV_ROUTES.map((r) => r.path).sort()

    expect(delMenu).toEqual(delRouter)
  })

  it("cada módulo exige el mismo permiso que su ruta", () => {
    MODULOS_DEL_MENU.forEach((modulo) => {
      const ruta = NAV_ROUTES.find((r) => r.path === modulo.to)

      expect(modulo.permiso).toBe(ruta.permission)
    })
  })

  it("todos los módulos tienen etiqueta e icono", () => {
    MODULOS_DEL_MENU.forEach((modulo) => {
      expect(modulo.label).toBeTruthy()
      expect(modulo.Icono).toBeTypeOf("function")
    })
  })
})

describe("tituloDeLaRuta", () => {
  it("reconoce una subruta del módulo", () => {
    expect(tituloDeLaRuta("/products/123")).toBe("Inventario")
  })

  it("devuelve vacío para una ruta ajena al panel", () => {
    expect(tituloDeLaRuta("/login")).toBe("")
  })
})
