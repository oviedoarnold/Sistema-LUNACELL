// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { crearEnvio, crearRescate } from "../api/ventasSinConexion"
import { CARGADOR, CLIENTE, ahoraDePrueba, copiaDePrueba, sesionDe } from "./pruebas/ayudas"
import { validarVentaDeRespaldo } from "./rescate"
import { construirVentaLocal } from "./venta"

/* Un cargador de 150 con 15 % de ISV: 172.50. */
const venta = (cambios = {}) =>
  construirVentaLocal({
    copia: copiaDePrueba(),
    sesion: sesionDe(),
    dispositivo: "DISP0001",
    carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
    ahora: ahoraDePrueba(),
    ...cambios,
  })

const EFECTIVO = [{ medio: "efectivo", monto: 172.5, referencia: "" }]

const clienteDeSupabase = () => ({ rpc: vi.fn(() => Promise.resolve({ data: { estado: "registrada" }, error: null, status: 200 })) })

describe("la venta en el teléfono", () => {
  it("guarda los medios tal como se cobraron", () => {
    const mixto = [{ medio: "efectivo", monto: 72.5, referencia: "" }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }]

    expect(venta({ cobros: mixto }).cobros).toEqual(mixto)
  })

  it("no acepta medios que no suman el total", () => {
    expect(() => venta({ cobros: [{ medio: "efectivo", monto: 172, referencia: "" }] })).toThrow(/deben sumar/i)
  })

  it("no acepta medios en una venta a crédito", () => {
    expect(() =>
      venta({ formaPago: "credito", clienteId: CLIENTE.id, cobros: EFECTIVO })
    ).toThrow(/crédito no lleva/i)
  })

  it("sin medios, no inventa ninguno", () => {
    expect(venta()).not.toHaveProperty("cobros")
  })
})

describe("el envío al servidor", () => {
  it("con medios va por la función nueva", async () => {
    const supabase = clienteDeSupabase()

    await crearEnvio(supabase)(venta({ cobros: EFECTIVO }))

    expect(supabase.rpc).toHaveBeenCalledWith("sincronizar_venta_con_medios", expect.objectContaining({ p_cobros: EFECTIVO }))
  })

  it("una venta guardada antes de esta versión sigue por el camino de siempre", async () => {
    const supabase = clienteDeSupabase()

    await crearEnvio(supabase)(venta())

    expect(supabase.rpc).toHaveBeenCalledWith("sincronizar_venta_sin_conexion", expect.not.objectContaining({ p_cobros: expect.anything() }))
  })

  it("el rescate elige igual", async () => {
    const supabase = clienteDeSupabase()

    await crearRescate(supabase)(venta({ cobros: EFECTIVO }), "lote-1")
    await crearRescate(supabase)(venta(), "lote-1")

    expect(supabase.rpc.mock.calls.map(([nombre]) => nombre)).toEqual(["rescatar_venta_con_medios", "rescatar_venta_sin_conexion"])
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ p_cobros: EFECTIVO, p_lote: "lote-1" })
  })
})

describe("el archivo de rescate", () => {
  const conNumero = (cambios) => ({ ...venta(), numeroProvisional: "PROV-DISP-000001", ...cambios })

  it("acepta una venta sin medios, de un respaldo anterior, y una con medios", () => {
    expect(validarVentaDeRespaldo(conNumero({}))).toBeNull()
    expect(validarVentaDeRespaldo(conNumero({ cobros: EFECTIVO }))).toBeNull()
  })

  it.each([
    ["no es una lista", "efectivo"],
    ["una fila vacía", [null]],
    ["sin medio", [{ monto: 10 }]],
    ["importe no numérico", [{ medio: "efectivo", monto: "10" }]],
    ["importe en cero", [{ medio: "efectivo", monto: 0 }]],
  ])("rechaza medios con %s", (_, cobros) => {
    expect(validarVentaDeRespaldo(conNumero({ cobros }))).toMatch(/medios de pago/i)
  })
})
