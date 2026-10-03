import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { crearVenta, ErrorDeVenta } from "./ventas"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El contrato de crearVenta desde INV-3.3: una venta es UNA llamada a
  registrar_venta_ubicacion(), y el navegador solo dice qué se lleva el
  cliente y cómo paga. Empresa, usuario, ubicación, precios, importes,
  número de documento y si es fiscal los decide la base.
*/

const EMPRESA = "empresa-1"
const AUTH = "auth-1"
const BODEGA = "bodega"

const montar = ({ existencia = 10, fallarEn = {} } = {}) => {
  const falso = crearSupabaseFalso({
    tablas: {
      empresas: [
        {
          id: EMPRESA,
          nombre: "LUNACELL",
          tasa_isv: 15,
          cai: "",
          proximo_correlativo_factura: 1,
          proximo_correlativo_cotizacion: 1,
          proximo_correlativo_interno: 9,
        },
      ],
      usuarios: [
        { id: "u1", auth_id: AUTH, empresa_id: EMPRESA, activo: true, ubicacion_id: BODEGA },
      ],
      ubicaciones: [
        { id: BODEGA, empresa_id: EMPRESA, nombre: "Lunacell Bodega", tipo: "bodega", activa: true, vende: true, emite_fiscal: false },
      ],
      productos: [
        { id: "p1", empresa_id: EMPRESA, codigo: "C-1", nombre: "Cargador", precio: 120, activo: true },
      ],
      inventario_ubicacion: [
        { empresa_id: EMPRESA, ubicacion_id: BODEGA, producto_id: "p1", cantidad: existencia },
      ],
      ventas: [],
      detalle_venta: [],
      movimientos_inventario: [],
    },
    sesionInicial: { user: { id: AUTH } },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

/*
  Lo que hoy arma SalesContext: renglones con precio, subtotal y nombre, y
  los totales calculados en el navegador. Se mandan a propósito para
  comprobar que NO viajan.
*/
const venta = (cambios = {}) => ({
  items: [
    { productId: "p1", id: "p1", name: "Cargador", code: "C-1", qty: 2, quantity: 2, price: 1, subtotal: 2 },
  ],
  subtotal: 2,
  tax: 0.3,
  taxRate: 15,
  total: 2.3,
  paymentType: "contado",
  customerName: "Consumidor Final",
  rtn: "",
  note: "",
  ...cambios,
})

const llamadasAlRpc = (falso) =>
  falso.rpc.mock.calls.filter(([nombre]) => nombre === "registrar_venta_ubicacion")

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("una venta es una sola llamada al RPC", () => {
  it("llama una vez a registrar_venta_ubicacion y devuelve el id de la venta", async () => {
    const falso = montar()

    const ventaId = await crearVenta(venta(), { clave: "k-1" })

    expect(llamadasAlRpc(falso)).toHaveLength(1)
    expect(ventaId).toBe(falso.datos.ventas[0].id)
  })

  it("envía solo los datos que el contrato permite", async () => {
    const falso = montar()

    await crearVenta(
      venta({
        paymentType: "credito",
        clientId: "c1",
        customerName: "Ferremax",
        rtn: "08011999123456",
        dueDate: "2027-01-31",
        note: "Entregar mañana",
      }),
      { clave: "k-2" }
    )

    const [[, argumentos]] = llamadasAlRpc(falso)

    expect(argumentos).toEqual({
      p_items: [{ producto_id: "p1", cantidad: 2 }],
      p_forma_pago: "credito",
      p_cliente_id: "c1",
      p_nombre_cliente: "Ferremax",
      p_rtn_comprador: "08011999123456",
      p_fecha_vencimiento: "2027-01-31",
      p_nota: "Entregar mañana",
      p_clave_idempotencia: "k-2",
    })
  })

  /*
    Lo que pertenece al servidor no viaja. Si viajara, manipular el
    payload podría abaratar una venta, cambiar de camión o elegir número.
  */
  it("no envía empresa, usuario, ubicación, precios, importes ni número", async () => {
    const falso = montar()

    await crearVenta(venta(), { clave: "k-3" })

    const [[, argumentos]] = llamadasAlRpc(falso)
    const texto = JSON.stringify(argumentos)

    for (const prohibido of [
      "empresa_id",
      "usuario_id",
      "ubicacion_id",
      "precio",
      "price",
      "subtotal",
      "isv",
      "tax",
      "total",
      "correlativo",
      "numero_factura",
      "es_fiscal",
    ]) {
      expect(texto).not.toContain(prohibido)
    }
  })

  it("una venta de contado no manda vencimiento aunque venga en los datos", async () => {
    const falso = montar()

    await crearVenta(venta({ dueDate: "2027-01-31" }), { clave: "k-4" })

    const [[, argumentos]] = llamadasAlRpc(falso)

    expect(argumentos.p_fecha_vencimiento).toBeNull()
    expect(argumentos.p_cliente_id).toBeNull()
  })

  /*
    La regresión que INV-3.3 cierra: el navegador ya no escribe la venta
    por partes ni pide el número por su cuenta.
  */
  it("no escribe tablas directamente ni pide correlativo", async () => {
    const falso = montar()

    await crearVenta(venta(), { clave: "k-5" })

    expect(falso.from).not.toHaveBeenCalledWith("ventas")
    expect(falso.from).not.toHaveBeenCalledWith("detalle_venta")
    expect(falso.from).not.toHaveBeenCalledWith("movimientos_inventario")
    expect(falso.rpc).not.toHaveBeenCalledWith("siguiente_correlativo", expect.anything())
  })

  it("los importes guardados son los del servidor, no los del navegador", async () => {
    const falso = montar()

    await crearVenta(venta(), { clave: "k-6" })

    const [guardada] = falso.datos.ventas

    // 2 × 120 = 240 + 15 % = 276; el navegador decía 2.3.
    expect(guardada.subtotal).toBe(240)
    expect(guardada.total).toBe(276)
    expect(guardada.numero_factura).toBe("VTA-000009")
  })
})

describe("reintento con la misma clave", () => {
  it("devuelve la misma venta cuando el servidor responde repetida", async () => {
    const falso = montar()

    const primera = await crearVenta(venta(), { clave: "k-7" })
    const segunda = await crearVenta(venta(), { clave: "k-7" })

    expect(segunda).toBe(primera)
    expect(falso.datos.ventas).toHaveLength(1)
    expect(llamadasAlRpc(falso)).toHaveLength(2)
  })

  it("el reintento no hace ninguna escritura propia", async () => {
    const falso = montar()

    await crearVenta(venta(), { clave: "k-8" })
    falso.from.mockClear()

    await crearVenta(venta(), { clave: "k-8" })

    expect(falso.from).not.toHaveBeenCalled()
    expect(falso.datos.movimientos_inventario).toHaveLength(1)
  })
})

describe("los rechazos del RPC", () => {
  /*
    Cada código se traduce a un motivo que la pantalla puede usar sin leer
    SQLSTATE, y el mensaje del motor llega tal cual: ya dice qué hacer
    —cuánto hay, en qué ubicación— y envolverlo lo escondería.
  */
  it.each([
    ["LV001", "sin-ubicacion"],
    ["LV002", "ubicacion-inactiva"],
    ["LV003", "venta-invalida"],
    ["LV004", "credito-sin-cliente"],
    ["LV005", "clave-reusada"],
    ["LV006", "producto-invalido"],
    ["LV007", "existencia-insuficiente"],
    ["LV008", "ubicacion-no-vende"],
    ["42501", "sin-permiso"],
  ])("%s se entrega como ErrorDeVenta con motivo %s", async (code, motivo) => {
    montar({
      fallarEn: { registrar_venta_ubicacion: { code, message: "mensaje del motor" } },
    })

    const intento = crearVenta(venta(), { clave: "k-9" })

    await expect(intento).rejects.toBeInstanceOf(ErrorDeVenta)
    await expect(intento).rejects.toMatchObject({
      motivo,
      codigo: code,
      message: "mensaje del motor",
    })
  })

  it("la falta de existencia en la ubicación llega con cuánto hay y dónde", async () => {
    montar({ existencia: 1 })

    await expect(crearVenta(venta(), { clave: "k-10" })).rejects.toThrow(
      "No hay suficiente «Cargador» en Lunacell Bodega: hay 1, se piden 2"
    )
  })

  it("un rechazo no deja venta, detalle, salida ni número consumido", async () => {
    const falso = montar({ existencia: 1 })

    await expect(crearVenta(venta(), { clave: "k-11" })).rejects.toThrow()

    expect(falso.datos.ventas).toHaveLength(0)
    expect(falso.datos.detalle_venta).toHaveLength(0)
    expect(falso.datos.movimientos_inventario).toHaveLength(0)
    expect(falso.datos.empresas[0].proximo_correlativo_interno).toBe(9)
  })

  it("un fallo desconocido se informa sin detalles internos", async () => {
    montar({
      fallarEn: { registrar_venta_ubicacion: { message: "connection reset" } },
    })

    await expect(crearVenta(venta(), { clave: "k-12" })).rejects.toThrow(
      "No se pudo registrar la venta."
    )
  })
})
