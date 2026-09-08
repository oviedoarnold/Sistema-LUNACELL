import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import Landing from "./Landing"

/*
  La portada no tenía pruebas. Se agregan ahora porque es la única página
  que ve alguien que todavía no entró al sistema, y porque acaba de
  reescribirse entera: sin nada que lo sujete, es la primera que vuelve a
  llenarse de texto heredado o de cifras de adorno.
*/

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  )

describe("Landing · identidad", () => {
  it("se presenta como LUNACELL & ASOCS.", () => {
    renderLanding()

    expect(screen.getAllByText("LUNACELL & ASOCS.").length).toBeGreaterThan(0)
  })

  it("muestra el lema de la empresa", () => {
    renderLanding()

    expect(
      screen.getAllByText(/accesorios que marcan la diferencia/i).length
    ).toBeGreaterThan(0)
  })

  it("no queda ni una mención al sistema anterior", () => {
    const { container } = renderLanding()

    expect(container.textContent).not.toMatch(/ferreter/i)
  })
})

describe("Landing · acceso al sistema", () => {
  it("ofrece el botón de ingreso", () => {
    renderLanding()

    expect(
      screen.getAllByRole("link", { name: /ingresar al sistema/i }).length
    ).toBeGreaterThan(0)
  })

  it("todos los accesos llevan a /login", () => {
    renderLanding()

    screen
      .getAllByRole("link", { name: /ingresar al sistema/i })
      .forEach((enlace) => expect(enlace).toHaveAttribute("href", "/login"))
  })

  it("el enlace de módulos lleva al recorrido", () => {
    renderLanding()

    expect(screen.getByRole("link", { name: /ver los módulos/i })).toHaveAttribute(
      "href",
      "/demo"
    )
  })
})

describe("Landing · nada inventado", () => {
  /*
    La portada anterior enseñaba un panel con ventas de adorno —L 18,450 en
    el día, L 312,900 en el mes— que ningún dato respaldaba. Quien las leyera
    las tomaría por cifras de la empresa.
  */
  it("no muestra importes de ventas", () => {
    const { container } = renderLanding()

    expect(container.textContent).not.toMatch(/L\s?[\d,]{4,}/)
  })

  it("no inventa teléfonos ni direcciones", () => {
    const { container } = renderLanding()

    expect(container.textContent).not.toMatch(/\d{4}-\d{4}/)
  })

  it("no inventa antigüedad ni número de clientes", () => {
    const { container } = renderLanding()

    expect(container.textContent).not.toMatch(/\+?\d+\s*(años|clientes|sucursales)/i)
  })

  /*
    La vista previa del panel enseña las ubicaciones que el sistema
    administra de verdad, en vez de cifras de relleno.
  */
  it("la vista previa muestra las ubicaciones reales", () => {
    renderLanding()

    expect(screen.getByText("Bodega Principal")).toBeInTheDocument()
    expect(screen.getByText("Lunacell Store")).toBeInTheDocument()
    expect(screen.getByText("Camión 01")).toBeInTheDocument()
    expect(screen.getByText("Camión 02")).toBeInTheDocument()
  })
})
