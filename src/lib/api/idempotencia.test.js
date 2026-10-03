import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { crearVenta } from "./ventas"
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
  proximo_correlativo_interno: 3000,
}

/*
  Desde INV-3.3 la venta la registra registrar_venta_ubicacion(), que
  descuenta de la ubicación del usuario en sesión: hace falta un usuario
  con ubicación y existencia en ella.
*/
const AUTH = "auth-1"

const montar = () => {
  const falso = crearSupabaseFalso({
    sesionInicial: { user: { id: AUTH } },
    tablas: {
      empresas: [EMPRESA_FILA],
      usuarios: [
        { id: USUARIO, auth_id: AUTH, empresa_id: EMPRESA, activo: true, ubicacion_id: "bodega" },
      ],
      ubicaciones: [
        { id: "bodega", empresa_id: EMPRESA, nombre: "Bodega", tipo: "bodega", activa: true, vende: true },
      ],
      productos: [
        { id: "p1", empresa_id: EMPRESA, codigo: "M-001", nombre: "Martillo", precio: 100, activo: true },
      ],
      inventario_ubicacion: [
        { empresa_id: EMPRESA, ubicacion_id: "bodega", producto_id: "p1", cantidad: 50 },
      ],
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

const contexto = {}

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
    Un número gastado en un reintento deja un hueco en la secuencia. En la
    numeración autorizada por el SAR eso no se admite, y en la interna
    tampoco se quiere. Sin ubicación fiscal la venta usa la interna, y la
    autorizada no se toca.
  */
  it("no quema un correlativo en el reintento", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(falso.datos.empresas[0].proximo_correlativo_interno).toBe(3001)
    expect(falso.datos.empresas[0].proximo_correlativo_factura).toBe(1000)
  })

  it("no descuenta la existencia de la ubicación dos veces", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })
    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(48)
  })

  /*
    Reutilizar la clave para otra venta no es un reintento: el motor lo
    rechaza en vez de devolver la venta vieja como si fuera la nueva.
  */
  it("la misma clave con otros productos se rechaza", async () => {
    const falso = montar()

    await crearVenta(venta(), { ...contexto, clave: "intento-1" })

    const otra = { ...venta(), items: [{ ...RENGLON, qty: 5 }] }

    await expect(
      crearVenta(otra, { ...contexto, clave: "intento-1" })
    ).rejects.toMatchObject({ motivo: "clave-reusada" })

    expect(falso.datos.ventas).toHaveLength(1)
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
