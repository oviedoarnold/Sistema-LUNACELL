import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { crearVenta, crearAbono } from "./ventas"
import { crearCotizacion } from "./cotizaciones"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const EMPRESA = "empresa-1"
const USUARIO = "usuario-1"

const EMPRESA_FILA = {
  id: EMPRESA,
  nombre: "Ferretería",
  proximo_correlativo_factura: 1000,
  proximo_correlativo_cotizacion: 2000,
}

const montar = () => {
  const falso = crearSupabaseFalso({
    tablas: {
      empresas: [EMPRESA_FILA],
      ventas: [],
      detalle_venta: [],
      abonos: [],
      cotizaciones: [],
      detalle_cotizacion: [],
      movimientos_inventario: [],
    },
  })

  globalThis.__supabaseFalso = falso

  return falso
}

const RENGLON = {
  productId: "p1",
  name: "Martillo",
  code: "M-001",
  qty: 2,
  price: 100,
  subtotal: 200,
}

const venta = () => ({
  items: [RENGLON],
  subtotal: 200,
  tax: 30,
  taxRate: 15,
  total: 230,
  paymentType: "contado",
  customerName: "Consumidor Final",
})

const cotizacion = () => ({
  clientName: "Ferremax",
  validity: "2027-12-31",
  includeTax: true,
  taxRate: 15,
  subtotal: 200,
  tax: 30,
  total: 230,
  items: [RENGLON],
})

const contexto = { empresaId: EMPRESA, usuarioId: USUARIO, empresa: {} }

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("facturar dos veces con la misma clave", () => {
  it("emite una sola factura", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(falso.datos.ventas).toHaveLength(1)
  })

  it("el segundo intento devuelve la factura del primero", async () => {
    montar()

    const primera = await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    const segunda = await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(segunda).toBe(primera)
  })

  /*
    El correlativo pertenece a la numeración autorizada por el SAR. Gastar
    uno en un reintento dejaría un hueco en la secuencia, que es justo lo
    que esa numeración no admite.
  */
  it("no quema un correlativo en el reintento", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(falso.datos.empresas[0].proximo_correlativo_factura).toBe(1001)
  })

  it("no descarga el inventario dos veces", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    const salidas = falso.datos.movimientos_inventario.filter(
      (m) => m.tipo === "salida"
    )

    expect(salidas).toHaveLength(1)
  })

  it("no duplica los renglones de la factura", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(falso.datos.detalle_venta).toHaveLength(1)
  })

  it("dos cobros distintos sí emiten dos facturas", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-2" })

    expect(falso.datos.ventas).toHaveLength(2)
  })

  /*
    Sin clave no hay nada que comparar, así que cada llamada emite. Es el
    comportamiento anterior, y queda escrito para que se note si alguien
    deja de mandarla.
  */
  it("sin clave, cada llamada emite una factura", async () => {
    const falso = montar()

    await crearVenta(venta(), contexto)
    await crearVenta(venta(), contexto)

    expect(falso.datos.ventas).toHaveLength(2)
  })
})

describe("abonar dos veces con la misma clave", () => {
  const contextoAbono = { empresaId: EMPRESA, usuarioId: USUARIO }

  it("registra un solo abono", async () => {
    const falso = montar()

    await crearAbono("v1", { amount: 50 }, { ...contextoAbono, clave: "abono-1" })
    await crearAbono("v1", { amount: 50 }, { ...contextoAbono, clave: "abono-1" })

    expect(falso.datos.abonos).toHaveLength(1)
  })

  it("el segundo intento devuelve el abono del primero", async () => {
    montar()

    const primero = await crearAbono("v1", { amount: 50 }, { ...contextoAbono, clave: "abono-1" })
    const segundo = await crearAbono("v1", { amount: 50 }, { ...contextoAbono, clave: "abono-1" })

    expect(segundo.id).toBe(primero.id)
    expect(segundo.amount).toBe(50)
  })

  it("dos abonos distintos sí se registran los dos", async () => {
    const falso = montar()

    await crearAbono("v1", { amount: 50 }, { ...contextoAbono, clave: "abono-1" })
    await crearAbono("v1", { amount: 30 }, { ...contextoAbono, clave: "abono-2" })

    expect(falso.datos.abonos).toHaveLength(2)
  })
})

describe("cotizar dos veces con la misma clave", () => {
  const contextoCotizacion = { empresaId: EMPRESA, usuarioId: USUARIO }

  it("guarda una sola cotización", async () => {
    const falso = montar()

    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })
    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })

    expect(falso.datos.cotizaciones).toHaveLength(1)
  })

  it("no quema un correlativo en el reintento", async () => {
    const falso = montar()

    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })
    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })

    expect(falso.datos.empresas[0].proximo_correlativo_cotizacion).toBe(2001)
  })

  it("no duplica los renglones", async () => {
    const falso = montar()

    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })
    await crearCotizacion(cotizacion(), { ...contextoCotizacion, clave: "cot-1" })

    expect(falso.datos.detalle_cotizacion).toHaveLength(1)
  })
})
