import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

/*
  La confirmación de una anulación: qué se ve antes de confirmar, el motivo
  obligatorio, el dinero en las ventas de contado y lo que pasa si la base
  la rechaza. La llamada a la base se simula: lo que decide está probado en
  pruebas-sql/anulacion-de-ventas.test.mjs.
*/

vi.mock("../../lib/api/ventas", () => ({ anularVenta: vi.fn() }))

const { anularVenta } = await import("../../lib/api/ventas")
const { default: AnularVentaModal } = await import("./AnularVentaModal")

const contado = {
  id: "v-1",
  invoiceNumber: "VTA-000009",
  clientName: "Consumidor Final",
  paymentType: "contado",
  total: 230,
  items: [{ productId: "p-1", name: "Cargador", qty: 2, price: 100 }],
}

const credito = { ...contado, id: "v-2", invoiceNumber: "VTA-000010", paymentType: "credito", clientName: "Taller Central" }

function abrir(props = {}) {
  const onAnulada = vi.fn()
  const onCerrar = vi.fn()
  render(<AnularVentaModal venta={contado} ubicacion="Camión 01" onAnulada={onAnulada} onCerrar={onCerrar} {...props} />)

  return { onAnulada, onCerrar }
}

const motivo = () => screen.getByLabelText(/motivo de la anulación/i)
const confirmar = () => screen.getByRole("button", { name: "Anular venta" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("antes de confirmar", () => {
  it("muestra documento, cliente, ubicación, productos, total y qué va a pasar", () => {
    abrir()

    expect(screen.getByRole("dialog", { name: "Anular VTA-000009" })).toBeInTheDocument()
    for (const texto of ["Consumidor Final", "Camión 01", "Cargador", "× 2", "L 230.00"]) {
      expect(screen.getAllByText(texto, { exact: false }).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(/se conserva y no se vuelve a usar/)).toHaveTextContent("Las existencias regresan a Camión 01")
  })

  it("no deja confirmar con un motivo de menos de 10 caracteres sin contar los espacios", () => {
    abrir()

    expect(confirmar()).toBeDisabled()
    fireEvent.change(motivo(), { target: { value: "   corto    " } })
    expect(confirmar()).toBeDisabled()
    fireEvent.change(motivo(), { target: { value: "Se registró dos veces" } })
    expect(confirmar()).toBeEnabled()
  })

  it("en una venta de contado pregunta por el dinero, con «Reembolso pendiente» marcado", () => {
    abrir()

    expect(screen.getByRole("radio", { name: /reembolso pendiente/i })).toBeChecked()
    expect(screen.getByRole("radio", { name: /no se cobró/i })).not.toBeChecked()
    expect(screen.getByText("Anular no registra que el dinero se devolvió.")).toBeInTheDocument()
  })

  it("en una venta a crédito no pregunta por el dinero y avisa que se cancela el saldo", () => {
    abrir({ venta: credito })

    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.getByText(/el saldo pendiente de esta venta se cancela/i)).toBeInTheDocument()
  })

  it("si la venta no se puede anular, dice por qué y no deja confirmar", () => {
    abrir({ razon: "Solo puedes anular ventas del mismo día." })

    expect(screen.getByRole("alert")).toHaveTextContent("Solo puedes anular ventas del mismo día.")
    expect(screen.queryByLabelText(/motivo de la anulación/i)).toBeNull()
    expect(confirmar()).toBeDisabled()
  })
})

describe("al confirmar", () => {
  it("envía la venta, el motivo sin espacios de más, el dinero y una clave del intento", async () => {
    anularVenta.mockResolvedValue({ estado: "anulada", numero_factura: "VTA-000009" })
    const { onAnulada } = abrir()

    fireEvent.change(motivo(), { target: { value: "  Se registró dos veces  " } })
    fireEvent.click(screen.getByRole("radio", { name: /no se cobró/i }))
    fireEvent.click(confirmar())

    await waitFor(() => expect(onAnulada).toHaveBeenCalledWith({ estado: "anulada", numero_factura: "VTA-000009" }))
    expect(anularVenta).toHaveBeenCalledWith("v-1", {
      motivo: "Se registró dos veces",
      tratamientoDinero: "no_cobrado",
      clave: "anular-v-1",
    })
  })

  it("en una venta a crédito no manda tratamiento del dinero", async () => {
    anularVenta.mockResolvedValue({ estado: "anulada" })
    abrir({ venta: credito })

    fireEvent.change(motivo(), { target: { value: "El cliente desistió de la compra" } })
    fireEvent.click(confirmar())

    await waitFor(() => expect(anularVenta).toHaveBeenCalled())
    expect(anularVenta.mock.calls[0][1].tratamientoDinero).toBeNull()
  })

  it("si la base la rechaza, muestra el motivo y permite cerrar", async () => {
    anularVenta.mockRejectedValue(Object.assign(new Error("texto del servidor"), { motivo: "con-abonos" }))
    const { onAnulada, onCerrar } = abrir()

    fireEvent.change(motivo(), { target: { value: "Se registró dos veces" } })
    fireEvent.click(confirmar())

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta venta tiene abonos registrados")
    expect(onAnulada).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onCerrar).toHaveBeenCalled()
  })

  it("mientras está en curso no se puede repetir ni cerrar", async () => {
    let terminar
    anularVenta.mockReturnValue(new Promise((r) => (terminar = r)))
    const { onCerrar } = abrir()

    fireEvent.change(motivo(), { target: { value: "Se registró dos veces" } })
    fireEvent.click(confirmar())

    expect(await screen.findByRole("button", { name: "Anulando..." })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCerrar).not.toHaveBeenCalled()
    expect(anularVenta).toHaveBeenCalledTimes(1)

    terminar({ estado: "anulada" })
  })
})
