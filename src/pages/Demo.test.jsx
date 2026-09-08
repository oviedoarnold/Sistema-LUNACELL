import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import Demo from "./Demo"

const renderDemo = () =>
  render(
    <MemoryRouter>
      <Demo />
    </MemoryRouter>
  )

describe("Demo · recorrido de módulos", () => {
  it("presenta el sistema de LUNACELL", () => {
    renderDemo()

    expect(
      screen.getByRole("heading", { name: /qué hace el sistema lunacell/i })
    ).toBeInTheDocument()
  })

  it("lista los módulos que ya funcionan", () => {
    renderDemo()

    expect(screen.getByRole("heading", { name: /^dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /^facturación/i })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /^ubicaciones/i })).toBeInTheDocument()
  })

  /*
    Lo que todavía no existe tiene que verse como tal. Un módulo planificado
    presentado como terminado es la forma más rápida de que alguien cuente
    con él para trabajar y se encuentre con que no está.
  */
  it("separa lo planificado de lo disponible", () => {
    renderDemo()

    expect(screen.getByRole("heading", { name: /disponible hoy/i })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /^planificado$/i })).toBeInTheDocument()
  })

  it("marca cada módulo con su estado", () => {
    renderDemo()

    expect(screen.getAllByText("Disponible").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Planificado").length).toBeGreaterThan(0)
  })

  it("advierte que lo planificado todavía no se puede usar", () => {
    renderDemo()

    expect(screen.getByText(/todavía no está construido/i)).toBeInTheDocument()
  })

  it("el inventario por ubicación aparece como planificado, no como hecho", () => {
    renderDemo()

    const tarjeta = screen
      .getByRole("heading", { name: /inventario por ubicación/i })
      .closest("article")

    expect(tarjeta).toHaveTextContent("Planificado")
  })

  /*
    La pantalla publicaba un usuario y una contraseña de otro sistema. No
    debe volver a publicar credenciales de ningún tipo.
  */
  it("no publica ninguna credencial", () => {
    const { container } = renderDemo()

    expect(container.textContent).not.toMatch(/contraseña/i)
    expect(container.textContent).not.toMatch(/@/)
    expect(screen.getByText(/no publica credenciales/i)).toBeInTheDocument()
  })

  it("no menciona la ferretería del sistema anterior", () => {
    const { container } = renderDemo()

    expect(container.textContent).not.toMatch(/ferreter/i)
  })

  it("lleva al login", () => {
    renderDemo()

    screen
      .getAllByRole("link", { name: /ingresar al sistema/i })
      .forEach((enlace) => expect(enlace).toHaveAttribute("href", "/login"))
  })
})
