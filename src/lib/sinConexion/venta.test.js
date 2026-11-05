// @vitest-environment node
import { describe, it, expect } from "vitest"

import { CARGADOR, CUBO, CLIENTE, copiaDePrueba, sesionDe, ahoraDePrueba } from "./pruebas/ayudas"
import { construirVentaLocal, totalesDe, ErrorDeVentaLocal } from "./venta"
import { disponibleLocal, antiguedadDeCopia } from "./copiaLocal"

const base = (cambios = {}) => ({
  copia: copiaDePrueba(),
  sesion: sesionDe(),
  dispositivo: "dispositivo-de-prueba-0001",
  carrito: [{ productoId: CARGADOR.id, cantidad: 2 }],
  formaPago: "contado",
  ahora: ahoraDePrueba(),
  ...cambios,
})

describe("totales", () => {
  it("usan la misma fórmula que el servidor: redondeo por línea e ISV sobre el subtotal", () => {
    // 0.33 × 3 = 0.99; 150 × 2 = 300; ISV 15 % de 300.99 = 45.1485 → 45.15.
    expect(totalesDe([{ precio_unitario: 0.33, cantidad: 3 }, { precio_unitario: 150, cantidad: 2 }], 15)).toEqual({
      subtotal: 300.99,
      isv: 45.15,
      total: 346.14,
    })
  })
})

describe("construirVentaLocal", () => {
  it("toma el precio de la copia local, no del carrito", () => {
    const venta = construirVentaLocal(base({ carrito: [{ productoId: CARGADOR.id, cantidad: 2, precio: 1 }] }))

    expect(venta.renglones).toEqual([
      { producto_id: CARGADOR.id, codigo: "11", nombre: "Cargador", cantidad: 2, precio_unitario: 150 },
    ])
    expect(venta.totalCobrado).toBe(345)
    expect(venta.tasaIsv).toBe(15)
  })

  it("usa el precio especial del cliente que trae la copia", () => {
    const copia = { ...copiaDePrueba(), preciosPorCliente: { [CLIENTE.id]: { [CARGADOR.id]: 120 } } }
    const venta = construirVentaLocal(base({ copia, clienteId: CLIENTE.id }))

    expect(venta.renglones[0].precio_unitario).toBe(120)
    expect(venta.totalCobrado).toBe(276)
  })

  it("sin cliente, o con un producto fuera de su lista, usa el precio general", () => {
    const copia = { ...copiaDePrueba(), preciosPorCliente: { [CLIENTE.id]: { [CUBO.id]: 1 } } }

    expect(construirVentaLocal(base({ copia })).renglones[0].precio_unitario).toBe(150)
    expect(construirVentaLocal(base({ copia, clienteId: CLIENTE.id })).renglones[0].precio_unitario).toBe(150)
  })

  it("una copia anterior, sin precios especiales, sigue vendiendo al general", () => {
    expect(construirVentaLocal(base({ clienteId: CLIENTE.id })).renglones[0].precio_unitario).toBe(150)
  })

  describe("precio negociado", () => {
    const carrito = (extra) => [{ productoId: CARGADOR.id, cantidad: 2, ...extra }]

    it("guarda lo cobrado, el precio de referencia y el motivo", () => {
      const venta = construirVentaLocal(base({ carrito: carrito({ precioNegociado: 120, motivoNegociacion: "mayoreo" }) }))

      expect(venta.renglones[0]).toMatchObject({
        precio_unitario: 120,
        negociado: true,
        precio_referencia: 150,
        motivo_negociacion: "mayoreo",
      })
      expect(venta.totalCobrado).toBe(276)
    })

    it("sobre un precio especial, la referencia es el especial", () => {
      const copia = { ...copiaDePrueba(), preciosPorCliente: { [CLIENTE.id]: { [CARGADOR.id]: 130 } } }
      const venta = construirVentaLocal(
        base({ copia, clienteId: CLIENTE.id, carrito: carrito({ precioNegociado: 120, motivoNegociacion: "otro" }) })
      )

      expect(venta.renglones[0]).toMatchObject({ precio_unitario: 120, precio_referencia: 130 })
    })

    it("igual a la referencia no es una negociación", () => {
      const venta = construirVentaLocal(base({ carrito: carrito({ precioNegociado: 150 }) }))

      expect(venta.renglones[0]).toEqual({
        producto_id: CARGADOR.id,
        codigo: CARGADOR.codigo,
        nombre: CARGADOR.nombre,
        cantidad: 2,
        precio_unitario: 150,
      })
    })

    it.each([
      ["cero", { precioNegociado: 0, motivoNegociacion: "otro" }],
      ["negativo", { precioNegociado: -1, motivoNegociacion: "otro" }],
      ["no numérico", { precioNegociado: "x", motivoNegociacion: "otro" }],
      ["sin motivo al bajar", { precioNegociado: 120 }],
    ])("rechaza un precio %s", (_, extra) => {
      expect(() => construirVentaLocal(base({ carrito: carrito(extra) }))).toThrow(ErrorDeVentaLocal)
    })

    it("subir el precio no pide motivo", () => {
      const venta = construirVentaLocal(base({ carrito: carrito({ precioNegociado: 200 }) }))

      expect(venta.renglones[0]).toMatchObject({ precio_unitario: 200, negociado: true, motivo_negociacion: null })
    })
  })

  it("lleva una clave de idempotencia única con el dispositivo", () => {
    const a = construirVentaLocal(base())
    const b = construirVentaLocal(base())

    expect(a.clave).toMatch(/^off-dispositivo-de-prueba-0001-[0-9a-f-]{36}$/)
    expect(a.clave).not.toBe(b.clave)
  })

  it("registra quién, dónde, desde qué dispositivo y cuándo, y nace pendiente", () => {
    const ahora = ahoraDePrueba()
    const venta = construirVentaLocal(base({ ahora }))

    expect(venta).toMatchObject({
      empresaId: "empresa-1",
      usuarioAuth: "auth-vendedor",
      ubicacionId: "camion-01",
      dispositivo: "dispositivo-de-prueba-0001",
      registradaEn: ahora.toISOString(),
      estado: "pendiente",
      intentos: 0,
    })
  })

  it("crédito solo para un cliente que ya existe en la copia", () => {
    const credito = (clienteId) =>
      construirVentaLocal(base({ formaPago: "credito", clienteId, fechaVencimiento: "2026-11-10" }))

    expect(credito(CLIENTE.id).clienteId).toBe(CLIENTE.id)
    expect(() => credito("44444444-4444-4444-8444-444444444444")).toThrow(ErrorDeVentaLocal)
    expect(() => credito(null)).toThrow(/cliente registrado/i)
  })

  it("rechaza una ubicación que no vende sin conexión", () => {
    const copia = copiaDePrueba({ ubicacion: { id: "camion-01", nombre: "Camión 01", vendeSinConexion: false } })

    expect(() => construirVentaLocal(base({ copia }))).toThrow(/no está habilitada/i)
  })

  it("no mezcla la copia de otro usuario o de otra ubicación", () => {
    expect(() => construirVentaLocal(base({ sesion: sesionDe("auth-otro") }))).toThrow(/otro usuario u otra ubicación/i)
    expect(() => construirVentaLocal(base({ sesion: sesionDe(undefined, { ubicacionId: "camion-02" }) }))).toThrow(
      /otro usuario u otra ubicación/i
    )
  })

  it("rechaza productos que no están en la copia y cantidades inválidas", () => {
    expect(() => construirVentaLocal(base({ carrito: [{ productoId: "fantasma", cantidad: 1 }] }))).toThrow(/producto/i)
    expect(() => construirVentaLocal(base({ carrito: [{ productoId: CARGADOR.id, cantidad: 0 }] }))).toThrow(/cantidad/i)
    expect(() => construirVentaLocal(base({ carrito: [{ productoId: CARGADOR.id, cantidad: 1.5 }] }))).toThrow(/cantidad/i)
    expect(() => construirVentaLocal(base({ carrito: [] }))).toThrow(/sin productos/i)
  })
})

describe("disponible local", () => {
  const venta = (estado, cantidad, extra = {}) => ({
    ...sesionDe(),
    estado,
    renglones: [{ producto_id: CARGADOR.id, cantidad }],
    ...extra,
  })

  it("resta lo que este dispositivo vendió y el servidor todavía no refleja en la copia", () => {
    const copia = copiaDePrueba()
    const ventas = [
      venta("pendiente", 2),
      venta("sincronizando", 1),
      venta("error", 1),
      venta("en_conciliacion", 1),
      venta("registrada", 1, { confirmadaEn: "2026-10-10T11:00:00.000Z" }),
      venta("registrada", 3, { confirmadaEn: "2026-10-10T09:00:00.000Z" }),
    ]

    // 10 − (2 + 1 + 1 + 1 + 1). La registrada antes de la copia ya está descontada en ella.
    expect(disponibleLocal(copia, ventas, CARGADOR.id)).toBe(4)
    expect(disponibleLocal(copia, ventas, CUBO.id)).toBe(4)
  })

  it("no resta ventas de otro usuario", () => {
    expect(disponibleLocal(copiaDePrueba(), [{ ...venta("pendiente", 5), usuarioAuth: "auth-otro" }], CARGADOR.id)).toBe(10)
  })
})

describe("antigüedad de la copia", () => {
  const copia = copiaDePrueba({ tomadaEn: "2026-10-10T00:00:00.000Z" })

  it("avisa a las 12 horas y con fuerza a las 24, sin bloquear", () => {
    expect(antiguedadDeCopia(copia, new Date("2026-10-10T11:00:00.000Z")).aviso).toBe("ninguno")
    expect(antiguedadDeCopia(copia, new Date("2026-10-10T13:00:00.000Z")).aviso).toBe("leve")
    expect(antiguedadDeCopia(copia, new Date("2026-10-11T01:00:00.000Z")).aviso).toBe("fuerte")
  })
})

/*
  Una venta en conciliación ya salió del camión pero el servidor no la
  descontó: se resta mientras nadie decide. Cuando un administrador decide,
  la copia que se tome DESPUÉS ya refleja esa decisión y no hay que
  restarla otra vez.
*/
describe("disponible local con ventas conciliadas", () => {
  const enConciliacion = (conciliacion) => ({
    ...sesionDe(),
    estado: "en_conciliacion",
    renglones: [{ producto_id: CARGADOR.id, cantidad: 1 }],
    ...(conciliacion ? { conciliacion } : {}),
  })

  it("sin decisión se resta siempre", () => {
    expect(disponibleLocal(copiaDePrueba(), [enConciliacion({ estado: "pendiente" })], CARGADOR.id)).toBe(9)
    expect(disponibleLocal(copiaDePrueba(), [enConciliacion()], CARGADOR.id)).toBe(9)
  })

  it("resuelta antes de tomar la copia ya no se resta: la copia refleja la decisión", () => {
    const aplicada = enConciliacion({ estado: "aplicada", resueltaEn: "2026-10-10T09:30:00.000Z" })
    const anulada = enConciliacion({ estado: "anulada", resueltaEn: "2026-10-10T09:30:00.000Z" })

    expect(disponibleLocal(copiaDePrueba(), [aplicada, anulada], CARGADOR.id)).toBe(10)
  })

  it("resuelta después de tomar la copia se sigue restando hasta la próxima copia", () => {
    const aplicada = enConciliacion({ estado: "aplicada", resueltaEn: "2026-10-10T11:00:00.000Z" })

    expect(disponibleLocal(copiaDePrueba(), [aplicada], CARGADOR.id)).toBe(9)
  })
})
