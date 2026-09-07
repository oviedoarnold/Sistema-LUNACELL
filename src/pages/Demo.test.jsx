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

describe("Demo", () => {
  it("muestra la cuenta con la que se entra", () => {
    renderDemo()

    expect(screen.getByText("demo@oviedoarnold.lat")).toBeInTheDocument()
    expect(screen.getByText("Demo2026")).toBeInTheDocument()
  })

  it("explica que la cuenta tiene permisos recortados", () => {
    renderDemo()

    expect(
      screen.getByText(/Inventario, Proveedores ni Configuración/i)
    ).toBeInTheDocument()
  })

  /*
    La página dejó de sembrar datos cuando el sistema pasó a la base: ya no
    hay nada que preparar, solo por dónde entrar.
  */
  it("lleva al login", () => {
    renderDemo()

    expect(screen.getByRole("link", { name: /iniciar sesión/i })).toHaveAttribute(
      "href",
      "/login"
    )
  })

  it("advierte que lo que se registre queda guardado", () => {
    renderDemo()

    expect(screen.getByText(/queda guardado/i)).toBeInTheDocument()
  })
})
