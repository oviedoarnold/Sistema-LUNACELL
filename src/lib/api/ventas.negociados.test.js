// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

import { aVentaDeApp, crearVenta } from "./ventas"

const rpc = vi.fn()

vi.mock("../supabase", () => ({
  supabase: { rpc: (...a) => rpc(...a) },
}))

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { venta_id: "v1" }, error: null })
})

const contado = { paymentType: "contado", cobros: [{ medio: "efectivo", monto: 10 }] }

describe("crearVenta con precio negociado", () => {
  it("envía el precio y el motivo solo en la línea negociada", async () => {
    await crearVenta({
      ...contado,
      items: [
        { productId: "p1", qty: 2, precioNegociado: 120, motivoNegociacion: "mayoreo" },
        { productId: "p2", qty: 1 },
      ],
    })

    expect(rpc.mock.calls[0][1].p_items).toEqual([
      { producto_id: "p1", cantidad: 2, precio_negociado: 120, motivo_negociacion: "mayoreo" },
      { producto_id: "p2", cantidad: 1 },
    ])
  })

  it("a crédito con ISV va por el flujo que acepta la negociación", async () => {
    await crearVenta({
      paymentType: "credito",
      clientId: "c1",
      items: [{ productId: "p1", qty: 1, precioNegociado: 120, motivoNegociacion: "otro" }],
    })

    expect(rpc.mock.calls[0][0]).toBe("registrar_venta_con_medios")
  })

  it("sin negociación, a crédito sigue por el camino de siempre", async () => {
    await crearVenta({ paymentType: "credito", clientId: "c1", items: [{ productId: "p1", qty: 1 }] })

    expect(rpc.mock.calls[0][0]).toBe("registrar_venta_ubicacion")
    expect(rpc.mock.calls[0][1].p_items).toEqual([{ producto_id: "p1", cantidad: 1 }])
  })

  it("traduce el rechazo del servidor", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "LN001", message: "Bajar el precio necesita un motivo" } })

    await expect(crearVenta({ ...contado, items: [{ productId: "p1", qty: 1, precioNegociado: 1 }] })).rejects.toMatchObject({
      motivo: "precio-negociado-invalido",
      message: "Bajar el precio necesita un motivo",
    })
  })
})

describe("una venta guardada", () => {
  const fila = (renglon) => ({
    id: "v1",
    fecha: "2026-11-05T15:30:00.000Z",
    detalle_venta: [{ producto_id: "p1", nombre: "Cargador", cantidad: 1, precio: 120, subtotal: 120, ...renglon }],
  })

  it("trae la negociación del renglón, con el precio realmente vendido", () => {
    const [item] = aVentaDeApp(
      fila({
        precio_referencia: 150,
        negociado_por_nombre: "Juan",
        negociado_en: "2026-11-05T15:30:00.000Z",
        motivo_negociacion: "mayoreo",
      })
    ).items

    expect(item.price).toBe(120)
    expect(item.negociacion).toEqual({ referencia: 150, motivo: "mayoreo", por: "Juan", en: "2026-11-05T15:30:00.000Z" })
  })

  it("una venta sin negociación no lleva ese dato", () => {
    expect(aVentaDeApp(fila({})).items[0]).not.toHaveProperty("negociacion")
  })
})
