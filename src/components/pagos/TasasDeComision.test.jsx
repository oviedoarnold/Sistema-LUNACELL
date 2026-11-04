import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

import { useAuth } from "../../hooks/useAuth"
import { configurarTasaDeComision, traerTasasDeComision } from "../../lib/api/comisiones"
import TasasDeComision from "./TasasDeComision"

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }))

vi.mock("../../lib/api/comisiones", () => ({
  traerTasasDeComision: vi.fn(),
  configurarTasaDeComision: vi.fn(),
}))

vi.mock("sweetalert2", () => ({ default: { fire: vi.fn(() => Promise.resolve({})) } }))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ isAdmin: true })
  traerTasasDeComision.mockResolvedValue({ tarjeta: 7, enlace: 7 })
  configurarTasaDeComision.mockResolvedValue()
})

describe("las tasas de comisión", () => {
  it("quien no es administrador no las ve ni las pide", () => {
    useAuth.mockReturnValue({ isAdmin: false })

    const { container } = render(<TasasDeComision />)

    expect(container).toBeEmptyDOMElement()
    expect(traerTasasDeComision).not.toHaveBeenCalled()
  })

  it("dice que son internas y que no se cobran al cliente", async () => {
    render(<TasasDeComision />)

    expect(await screen.findByLabelText("Tarjeta (%)")).toHaveValue(7)
    expect(screen.getByLabelText("Enlace de pago (%)")).toHaveValue(7)
    expect(screen.getByText(/no se le cobra al cliente/i)).toBeInTheDocument()
  })

  it("no deja guardar la misma tasa", async () => {
    render(<TasasDeComision />)
    await screen.findByLabelText("Tarjeta (%)")

    expect(screen.getByRole("button", { name: /guardar tasa de tarjeta/i })).toBeDisabled()
  })

  it("guarda el medio y la tasa escrita", async () => {
    render(<TasasDeComision />)

    fireEvent.change(await screen.findByLabelText("Tarjeta (%)"), { target: { value: "5.5" } })
    fireEvent.click(screen.getByRole("button", { name: /guardar tasa de tarjeta/i }))

    await waitFor(() => expect(configurarTasaDeComision).toHaveBeenCalledWith("tarjeta", 5.5))
    await waitFor(() => expect(screen.getByLabelText("Tarjeta (%)")).toHaveValue(5.5))
  })

  it("si no se pueden cargar, lo dice", async () => {
    traerTasasDeComision.mockRejectedValue(new Error("No se pudieron cargar las tasas de comisión."))

    render(<TasasDeComision />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/no se pudieron cargar/i)
  })
})
