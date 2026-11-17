import { describe, it, expect, vi } from "vitest"

import {
  ErrorDePedido,
  entregarPedido,
  facturarPedido,
  marcarPedidoLeido,
  traerAvisosDePedidos,
  traerBandeja,
  traerDetalleDePedido,
} from "./pedidos"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El contrato con las funciones de la 0045: qué viaja, cómo se lee la
  respuesta y qué se hace con cada rechazo. El navegador nunca manda el
  origen, los importes ni la numeración.
*/

const montar = (rpcs) => {
  const llamadas = []
  const rpcsExtra = Object.fromEntries(
    Object.entries(rpcs).map(([nombre, responder]) => [
      nombre,
      (argumentos) => {
        llamadas.push([nombre, argumentos])

        return responder(argumentos)
      },
    ])
  )

  globalThis.__supabaseFalso = crearSupabaseFalso({ sesionInicial: { user: { id: "auth-1" } }, rpcsExtra })

  return llamadas
}

const RESUMEN = {
  pedido_id: "ped-1",
  numero: "PED-000001",
  estado: "pendiente",
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  nombre_cliente: "Ferremax",
  forma_pago: "credito",
  total: "230.00",
  cobrado: "80.00",
  saldo: "150.00",
  entregado_en: "2026-11-16T15:00:00Z",
}

const PEDIDO = {
  destinoId: "camion-01",
  clienteId: "c1",
  items: [
    { productId: "p1", qty: 2, precioNegociado: 90, motivoNegociacion: "mayoreo" },
    { productId: "p2", qty: "1" },
  ],
  formaPago: "credito",
  cobros: [{ medio: "efectivo", monto: 80, referencia: "", cargo: 0 }],
  conIsv: true,
  fechaVencimiento: "2026-12-31",
  rtn: "0801",
}

describe("entregar un pedido", () => {
  it("manda solo la intención y la clave; lee números del servidor", async () => {
    const llamadas = montar({ entregar_pedido: () => ({ data: { ...RESUMEN, repetido: false }, error: null }) })
    const r = await entregarPedido(PEDIDO, "clave-1")

    expect(llamadas).toEqual([
      [
        "entregar_pedido",
        {
          p_destino: "camion-01",
          p_cliente_id: "c1",
          p_items: [
            { producto_id: "p1", cantidad: 2, precio_negociado: 90, motivo_negociacion: "mayoreo" },
            { producto_id: "p2", cantidad: 1 },
          ],
          p_forma_pago: "credito",
          p_cobros: [{ medio: "efectivo", monto: 80, referencia: "", cargo: 0 }],
          p_con_isv: true,
          p_fecha_vencimiento: "2026-12-31",
          p_rtn_comprador: "0801",
          p_nota: "",
          p_clave_idempotencia: "clave-1",
        },
      ],
    ])
    expect(r).toMatchObject({ id: "ped-1", numero: "PED-000001", total: 230, cobrado: 80, saldo: 150, repetido: false })
  })

  it("al contado no manda fecha de vencimiento", async () => {
    const llamadas = montar({ entregar_pedido: () => ({ data: RESUMEN, error: null }) })

    await entregarPedido({ ...PEDIDO, formaPago: "contado", conIsv: false }, "clave-2")

    expect(llamadas[0][1]).toMatchObject({ p_forma_pago: "contado", p_fecha_vencimiento: null, p_con_isv: false })
  })

  it.each([
    ["PI007", "stock-insuficiente"],
    ["PI005", "clave-reusada"],
    ["PI003", "destino-invalido"],
    ["PI009", "isv-obligatorio"],
    ["LM007", "porcentaje-cambiado"],
    ["LN001", "precio-negociado-invalido"],
    ["42501", "sin-permiso"],
  ])("un rechazo %s llega como «%s» con el mensaje del servidor", async (code, motivo) => {
    montar({ entregar_pedido: () => ({ data: null, error: { code, message: "Mensaje del servidor" } }) })

    const error = await entregarPedido(PEDIDO, "clave-3").catch((e) => e)

    expect(error).toBeInstanceOf(ErrorDePedido)
    expect(error).toMatchObject({ motivo, codigo: code, message: "Mensaje del servidor" })
  })

  // En la base se llama «prima»; en pantalla, «pago parcial».
  it("un rechazo PI010 llega como «prima-invalida» y habla de pago parcial", async () => {
    montar({ entregar_pedido: () => ({ data: null, error: { code: "PI010", message: "La prima debe ser menor que el total del pedido" } }) })

    const error = await entregarPedido(PEDIDO, "clave-3").catch((e) => e)

    expect(error).toMatchObject({ motivo: "prima-invalida", codigo: "PI010" })
    expect(error.message).toBe("El pago parcial debe ser menor que el total del pedido. Si el cliente paga todo, envíalo al contado.")
    expect(error.message).not.toMatch(/prima/i)
  })

  it("sin respuesta del servidor dice que reintentar es seguro", async () => {
    montar({ entregar_pedido: () => ({ data: null, error: { message: "Failed to fetch" }, status: 0 }) })

    const error = await entregarPedido(PEDIDO, "clave-4").catch((e) => e)

    expect(error.motivo).toBe("sin-respuesta")
    expect(error.message).toMatch(/Reintentar es seguro/)
  })
})

describe("facturar, la bandeja, el detalle y los avisos", () => {
  it("facturar manda solo el pedido y avisa si ya estaba facturado", async () => {
    const llamadas = montar({
      facturar_pedido: () => ({ data: { ...RESUMEN, estado: "facturado", venta_id: "v-1", numero_factura: "VTA-000001", ya_facturado: true }, error: null }),
    })
    const r = await facturarPedido("ped-1")

    expect(llamadas).toEqual([["facturar_pedido", { p_pedido: "ped-1" }]])
    expect(r).toMatchObject({ ventaId: "v-1", numeroFactura: "VTA-000001", yaFacturado: true })
  })

  it("la bandeja pide la vista y el estado", async () => {
    const llamadas = montar({ bandeja_de_pedidos: () => ({ data: [{ ...RESUMEN, leido: true }], error: null }) })
    const lista = await traerBandeja({ vista: "enviados", estado: "todos" })

    expect(llamadas[0]).toEqual(["bandeja_de_pedidos", { p_vista: "enviados", p_estado: "todos" }])
    expect(lista).toEqual([expect.objectContaining({ id: "ped-1", leido: true, saldo: 150 })])
  })

  it("el detalle trae productos con sus precios y los cobros de origen", async () => {
    montar({
      detalle_de_pedido: () => ({
        data: {
          ...RESUMEN,
          puede_facturar: true,
          productos: [{ producto_id: "p1", nombre: "Cargador", cantidad: 2, precio: "90", subtotal: "180", precio_general: "100", precio_especial: null, precio_referencia: "100", entregado: 2 }],
          cobros: [{ medio: "tarjeta", monto: "80", cargo: "1.36", tasa: "1.70", ubicacion: "Bodega" }],
          eventos: [],
        },
        error: null,
      }),
    })

    const d = await traerDetalleDePedido("ped-1")

    expect(d.puedeFacturar).toBe(true)
    expect(d.productos[0]).toMatchObject({ precio: 90, precioGeneral: 100, precioEspecial: null, precioReferencia: 100, entregado: 2 })
    expect(d.cobros[0]).toMatchObject({ medio: "tarjeta", monto: 80, cargo: 1.36, tasa: 1.7, ubicacion: "Bodega" })
  })

  it("marcar como leído y los avisos", async () => {
    const llamadas = montar({
      marcar_pedido_leido: () => ({ data: true, error: null }),
      avisos_de_pedidos: () => ({ data: { pendientes: 3, sin_leer: 1, ultimos: [RESUMEN] }, error: null }),
    })

    await marcarPedidoLeido("ped-1")
    const avisos = await traerAvisosDePedidos()

    expect(llamadas.map(([nombre, a]) => [nombre, a])).toEqual([
      ["marcar_pedido_leido", { p_pedido: "ped-1" }],
      ["avisos_de_pedidos", {}],
    ])
    expect(avisos).toMatchObject({ pendientes: 3, sinLeer: 1, ultimos: [expect.objectContaining({ numero: "PED-000001" })] })
  })
})
