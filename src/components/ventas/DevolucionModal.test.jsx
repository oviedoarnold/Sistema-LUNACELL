import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

/*
  La ventana de devoluciones (0052): qué se ve antes de confirmar, lo que se
  envía, el reembolso de lo que queda a favor y los rechazos de la base. La
  llamada a la base se simula: lo que decide está probado en
  pruebas-sql/devoluciones-de-ventas.test.mjs.
*/

vi.mock("../../lib/api/ventas", () => ({ traerDevolucion: vi.fn(), registrarDevolucion: vi.fn(), registrarReembolsoDeVenta: vi.fn() }))

const { traerDevolucion, registrarDevolucion, registrarReembolsoDeVenta } = await import("../../lib/api/ventas")
const { default: DevolucionModal } = await import("./DevolucionModal")

const venta = {
  id: "V-1",
  invoiceNumber: "VTA-000020",
  clientName: "Taller Central",
  items: [{ productId: "p1", name: "Cargador", qty: 2, price: 100, subtotal: 200 }],
  subtotal: 200,
  total: 230,
}

const respuesta = ({ dinero = {}, ...resto } = {}) => ({
  puede_registrar: true,
  puede_reembolsar_electronico: false,
  bloqueo: null,
  productos: [{ producto_id: "p1", nombre: "Cargador", vendido: 2, devuelto: 0, disponible: 2, valor_unitario: 115 }],
  dinero: { forma_pago: "credito", total: 230, cargo_original: 0, devuelto: 0, cargo_devuelto: 0, neto: 230, saldo: 50, a_favor: 0, pendiente: 0, medios: [], ...dinero },
  devoluciones: [],
  reembolsos: [],
  ubicaciones_para_recibir: [
    { id: "u1", nombre: "Camión 01" },
    { id: "u2", nombre: "Bodega" },
  ],
  ...resto,
})

function abrir() {
  const onCambio = vi.fn()
  render(<DevolucionModal venta={venta} moneda="L" onCerrar={vi.fn()} onCambio={onCambio} />)

  return { onCambio }
}

const confirmar = () => screen.getByRole("button", { name: "Confirmar devolución" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("clave-1")
})

describe("registrar una devolución", () => {
  it("enseña el dinero de la venta y, antes de confirmar, cuánto baja, el nuevo saldo y lo que queda a favor", async () => {
    traerDevolucion.mockResolvedValue(respuesta())
    abrir()

    const dinero = await screen.findByLabelText("Dinero de la venta")
    expect(dinero).toHaveTextContent("Saldo del crédito")
    expect(dinero).toHaveTextContent("L 50.00")
    expect(confirmar()).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/motivo de la devolución/i), { target: { value: "No era el modelo" } })
    fireEvent.change(screen.getByLabelText("Cantidad devuelta de Cargador"), { target: { value: "1" } })

    const resumen = screen.getByLabelText("Resumen")
    expect(resumen).toHaveTextContent("La venta baja L 115.00")
    expect(resumen).toHaveTextContent("El saldo de esta factura baja L 50.00 y queda en L 0.00")
    expect(resumen).toHaveTextContent("Quedan L 65.00 a favor del cliente")
    expect(confirmar()).toBeEnabled()
  })

  it("envía productos, estado, ubicación y la clave del intento, y recarga lo registrado", async () => {
    traerDevolucion.mockResolvedValue(respuesta())
    registrarDevolucion.mockResolvedValue({ a_favor: 65 })
    const { onCambio } = abrir()

    fireEvent.change(await screen.findByLabelText(/motivo de la devolución/i), { target: { value: "No era el modelo" } })
    fireEvent.change(screen.getByLabelText("Cantidad devuelta de Cargador"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Estado de Cargador"), { target: { value: "danado" } })
    fireEvent.change(screen.getByLabelText("Dónde se recibieron"), { target: { value: "u2" } })
    fireEvent.click(confirmar())

    expect(await screen.findByRole("status")).toHaveTextContent("Quedan L 65.00 a favor del cliente por reembolsar")
    expect(registrarDevolucion).toHaveBeenCalledWith("V-1", {
      motivo: "No era el modelo",
      productos: [{ producto_id: "p1", cantidad: 1, condicion: "danado" }],
      ubicacionId: "u2",
      clave: "clave-1",
    })
    expect(traerDevolucion).toHaveBeenCalledTimes(2)
    expect(onCambio).toHaveBeenCalled()
  })

  it("si la base la rechaza, dice por qué y conserva lo escrito", async () => {
    traerDevolucion.mockResolvedValue(respuesta())
    registrarDevolucion.mockRejectedValue(new Error("Un producto no es de esta venta o se devuelve más de lo que queda por devolver"))
    abrir()

    fireEvent.change(await screen.findByLabelText(/motivo de la devolución/i), { target: { value: "No era el modelo" } })
    fireEvent.change(screen.getByLabelText("Cantidad devuelta de Cargador"), { target: { value: "2" } })
    fireEvent.click(confirmar())

    expect(await screen.findByRole("alert")).toHaveTextContent("se devuelve más de lo que queda")
    expect(screen.getByLabelText("Cantidad devuelta de Cargador")).toHaveValue("2")
  })

  it("una factura fiscal explica el bloqueo y no ofrece registrar", async () => {
    traerDevolucion.mockResolvedValue(respuesta({ puede_registrar: false, bloqueo: "Las facturas fiscales no admiten devoluciones todavía." }))
    abrir()

    expect(await screen.findByRole("alert")).toHaveTextContent("Las facturas fiscales no admiten devoluciones")
    expect(screen.queryByRole("button", { name: "Confirmar devolución" })).toBeNull()
    expect(screen.queryByLabelText(/motivo de la devolución/i)).toBeNull()
  })
})

describe("reembolsar lo que quedó a favor", () => {
  const conExcedente = () =>
    respuesta({
      productos: [{ producto_id: "p1", nombre: "Cargador", vendido: 2, devuelto: 2, disponible: 0, valor_unitario: 115 }],
      dinero: { forma_pago: "contado", devuelto: 230, neto: 0, a_favor: 230, pendiente: 230, medios: [{ medio: "efectivo", cobrado: 230, reembolsado: 0 }] },
      devoluciones: [
        { fecha: "2026-11-19T15:00:00Z", motivo: "No era el modelo", usuario: "Arnold", ubicacion: "Camión 01", valor: 230, cargo: 0, productos: [{ nombre: "Cargador", cantidad: 2, condicion: "buen_estado" }] },
      ],
    })

  it("sin productos por devolver abre el reembolso, con el tope del medio, y lo registra", async () => {
    traerDevolucion.mockResolvedValue(conExcedente())
    registrarReembolsoDeVenta.mockResolvedValue({ id: "r-1" })
    abrir()

    const medio = await screen.findByLabelText("Se devuelve con")
    expect(within(medio).getByRole("option", { name: "Efectivo (hasta L 230.00)" })).toBeInTheDocument()
    expect(screen.getByLabelText("Registrado")).toHaveTextContent("Cargador × 2 · recibido en Camión 01")

    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "230" } })
    fireEvent.click(screen.getByRole("button", { name: "Registrar reembolso" }))

    await waitFor(() =>
      expect(registrarReembolsoDeVenta).toHaveBeenCalledWith("V-1", { medio: "efectivo", importe: 230, referencia: "", clave: "clave-1" })
    )
    expect(await screen.findByRole("status")).toHaveTextContent("Reembolso de L 230.00 registrado")
  })

  it("el vendedor sin medio que pueda usar ve que lo electrónico lo registra el administrador", async () => {
    const soloTarjeta = conExcedente()
    soloTarjeta.dinero.medios = [{ medio: "tarjeta", cobrado: 239, reembolsado: 0 }]
    traerDevolucion.mockResolvedValue(soloTarjeta)
    abrir()

    expect(await screen.findByText(/por transferencia, tarjeta o enlace las registra el administrador/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Registrar reembolso" })).toBeNull()
  })
})
