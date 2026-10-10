// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { CARGADOR, copiaDePrueba, sesionDe, ahoraDePrueba } from "./pruebas/ayudas"
import { construirVentaLocal } from "./venta"
import { rescatarVentas, validarVentaDeRespaldo, resumenDeRescate } from "./rescate"

let correlativo = 0
const venta = (cambios = {}) => ({
  ...construirVentaLocal({
    copia: copiaDePrueba(),
    sesion: sesionDe(),
    dispositivo: "dispositivo-de-prueba-0001",
    carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
    ahora: ahoraDePrueba(),
  }),
  numeroProvisional: `PROV-DISP-${String((correlativo += 1)).padStart(6, "0")}`,
  ...cambios,
})

const ok = (data) => ({ data, error: null, status: 200 })

describe("validar una venta del archivo de emergencia", () => {
  it("acepta una venta bien formada", () => {
    expect(validarVentaDeRespaldo(venta())).toBeNull()
  })

  it.each([
    ["sin clave válida", { clave: "no-es-off" }],
    ["sin dispositivo válido", { dispositivo: "x" }],
    ["sin vendedor", { usuarioAuth: "" }],
    ["sin número provisional", { numeroProvisional: "" }],
    ["con fecha inválida", { registradaEn: "ayer" }],
    ["sin renglones", { renglones: [] }],
    [
      "con cantidad fraccionaria",
      { renglones: [{ producto_id: CARGADOR.id, codigo: "11", nombre: "Cargador", cantidad: 1.5, precio_unitario: 150 }] },
    ],
    ["con forma de pago desconocida", { formaPago: "trueque" }],
    ["a crédito sin cliente", { formaPago: "credito", clienteId: null }],
    ["con total no numérico", { totalCobrado: "172.5" }],
  ])("rechaza una venta %s", (_caso, cambios) => {
    expect(validarVentaDeRespaldo(venta(cambios))).toMatch(/./)
  })

  it("rechaza lo que no es un objeto", () => {
    expect(validarVentaDeRespaldo(null)).toMatch(/./)
    expect(validarVentaDeRespaldo("venta")).toMatch(/./)
  })
})

describe("rescatar ventas", () => {
  it("envía cada venta con el lote y registra cada resultado, incluido «rechazado» aunque la RPC no lance", async () => {
    const [a, b, c, d] = [venta(), venta(), venta(), venta()]
    const enviar = vi.fn(async (v) => {
      if (v.clave === a.clave) return ok({ estado: "en_conciliacion", conciliacion_id: "conc-1", motivo: "rescate" })
      if (v.clave === b.clave) return ok({ estado: "ya_en_conciliacion", conciliacion_id: "conc-0" })
      if (v.clave === c.clave) return ok({ estado: "ya_registrada", venta_id: "venta-9", numero_factura: "INT-9" })
      return ok({ estado: "rechazado", codigo: "OF003", detalle: "La clave ya se usó para una venta distinta" })
    })

    const { resultados, detenidoPor } = await rescatarVentas([a, b, c, d], { enviar, lote: "lote-1" })

    expect(detenidoPor).toBeNull()
    expect(enviar).toHaveBeenCalledTimes(4)
    expect(enviar.mock.calls.every(([, lote]) => lote === "lote-1")).toBe(true)
    expect(resultados.map((r) => r.resultado)).toEqual(["en_conciliacion", "ya_en_conciliacion", "ya_registrada", "rechazado"])
    expect(resultados[3]).toMatchObject({ codigo: "OF003", detalle: "La clave ya se usó para una venta distinta" })
    expect(resultados[2]).toMatchObject({ ventaId: "venta-9", numeroFactura: "INT-9" })
    expect(resumenDeRescate(resultados)).toEqual({ aceptadas: 3, rechazadas: 1, invalidas: 0, errores: 0, sinEnviar: 0 })
  })

  it("no envía dos veces la misma venta del archivo ni las mal formadas", async () => {
    const a = venta()
    const mala = venta({ renglones: [] })
    const enviar = vi.fn(async () => ok({ estado: "en_conciliacion", conciliacion_id: "conc-1" }))

    const { resultados } = await rescatarVentas([a, { ...a }, mala], { enviar, lote: "lote-2" })

    expect(enviar).toHaveBeenCalledTimes(1)
    expect(resultados.map((r) => r.resultado)).toEqual(["en_conciliacion", "repetida_en_archivo", "invalida"])
  })

  it("no vuelve a enviar lo que ya se rescató en esta sesión", async () => {
    const a = venta()
    const enviar = vi.fn(async () => ok({ estado: "en_conciliacion", conciliacion_id: "conc-1" }))

    const { resultados } = await rescatarVentas([a], { enviar, lote: "lote-5", yaRescatadas: new Set([a.clave]) })

    expect(enviar).not.toHaveBeenCalled()
    expect(resultados[0].resultado).toBe("ya_rescatada")
  })

  it("sin permiso de administrador se detiene y no envía el resto", async () => {
    const enviar = vi.fn(async () => ({ data: null, error: { code: "42501", message: "Solo un administrador" }, status: 403 }))

    const { resultados, detenidoPor } = await rescatarVentas([venta(), venta()], { enviar, lote: "lote-3" })

    expect(detenidoPor).toBe("sesion")
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(resultados.map((r) => r.resultado)).toEqual(["error", "no_enviada"])
  })

  it("sin red se detiene; un error temporal no detiene las demás", async () => {
    const [a, b, c] = [venta(), venta(), venta()]
    const enviar = vi.fn(async (v) => {
      if (v.clave === a.clave) return { data: null, error: { code: "40001", message: "bloqueo" }, status: 500 }
      if (v.clave === b.clave) throw new TypeError("Failed to fetch")
      return ok({ estado: "en_conciliacion" })
    })

    const { resultados, detenidoPor } = await rescatarVentas([a, b, c], { enviar, lote: "lote-4" })

    expect(detenidoPor).toBe("red")
    expect(resultados.map((r) => r.resultado)).toEqual(["error", "error", "no_enviada"])
  })

  it("una respuesta desconocida no se toma como éxito", async () => {
    const { resultados } = await rescatarVentas([venta()], { enviar: async () => ok({ estado: "quien-sabe" }), lote: "l" })

    expect(resultados[0].resultado).toBe("error")
  })

  it("avisa el avance de cada venta", async () => {
    const alAvanzar = vi.fn()

    await rescatarVentas([venta(), venta()], { enviar: async () => ok({ estado: "en_conciliacion" }), lote: "l", alAvanzar })

    expect(alAvanzar).toHaveBeenCalledTimes(2)
  })
})
