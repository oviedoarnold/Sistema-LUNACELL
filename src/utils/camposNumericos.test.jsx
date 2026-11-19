import { describe, it, expect } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { CAMPO_DE_CANTIDAD, CAMPO_DE_IMPORTE } from "./camposNumericos"

describe("camposNumericos", () => {
  it("los importes abren el teclado decimal y las cantidades el numérico", () => {
    render(
      <>
        <input aria-label="Monto" type="number" step="0.01" {...CAMPO_DE_IMPORTE} defaultValue="150.50" />
        <input aria-label="Cantidad" type="number" min="1" {...CAMPO_DE_CANTIDAD} defaultValue="2" />
      </>
    )

    expect(screen.getByLabelText("Monto")).toHaveAttribute("inputmode", "decimal")
    expect(screen.getByLabelText("Cantidad")).toHaveAttribute("inputmode", "numeric")
  })

  it("girar la rueda quita el foco y no cambia el número", () => {
    render(<input aria-label="Monto" type="number" step="0.01" {...CAMPO_DE_IMPORTE} defaultValue="150.50" />)

    const campo = screen.getByLabelText("Monto")

    campo.focus()
    expect(campo).toHaveFocus()

    fireEvent.wheel(campo, { deltaY: -100 })

    expect(campo).not.toHaveFocus()
    expect(campo).toHaveValue(150.5)
  })
})
