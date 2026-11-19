/*
  0051 aplicada sobre una base con la 0050 y operaciones, como en producción:
  ventas, pedidos facturados (contado y crédito con prima), uno cancelado con
  C2a y una venta normal anulada. No debe cambiar ninguna fila, y las facturas
  de pedidos ya emitidas se anulan después con la función nueva.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, fotoDeDatos, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0050_contraliquidaciones_entre_ubicaciones.sql")
const MIGRACION = "0051_anulacion_facturas_pedidos.sql"
const TABLAS = ["pagos", "abonos", "pedidos_ubicacion", "eventos_de_pedido", "movimientos_inventario", "liquidaciones_ubicacion", "anulaciones_venta", "cancelaciones_de_pedido", "reembolsos_de_pedido"]

const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r

describe("la 0051 sobre una base con pedidos, C2a, C2b y anulaciones", () => {
  let antes
  let cuerpoDeAnularVenta
  let contado
  let credito

  beforeAll(async () => {
    const { db, e } = contexto
    const entrega = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos", "orders-cancel"] })

    const pedir = (forma, cobros) =>
      r(
        entrega.authId,
        `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
           p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
        [e.camion1, e.clienteId, JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
      )

    contado = await pedir("contado", [{ medio: "efectivo", monto: 115 }])
    credito = await pedir("credito", [{ medio: "efectivo", monto: 40 }])

    const cancelado = await pedir("contado", [{ medio: "efectivo", monto: 115 }])

    for (const p of [contado, credito]) await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [p.pedido_id])

    await r(e.admin.authId, "select public.cancelar_pedido($1, 'Cancelado con C2a', null, '[]'::jsonb, $2) as r", [cancelado.pedido_id, randomUUID()])

    const normal = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    await r(e.admin.authId, "select public.anular_venta($1, 'Venta registrada por error', 'no_cobrado', $2) as r", [normal.venta_id, randomUUID()])

    antes = await fotoDeDatos(contexto, { tablas: TABLAS })
    cuerpoDeAnularVenta = await cuerpoDe(db, await firmaDe(db, "anular_venta"))

    await aplicarMigracion(db, MIGRACION)
  })

  it("no cambia ninguna fila ni anular_venta()", async () => {
    expect(antes.pedidos_ubicacion).toHaveLength(3)
    expect(antes.anulaciones_venta).toHaveLength(1)
    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await cuerpoDe(contexto.db, await firmaDe(contexto.db, "anular_venta"))).toBe(cuerpoDeAnularVenta)
  })

  it("aplicarla otra vez no cambia nada", async () => {
    await aplicarMigracion(contexto.db, MIGRACION)
    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
  })

  it("las facturas de pedidos ya emitidas se anulan con la función nueva; vender sigue igual", async () => {
    const { e } = contexto
    const anular = (ventaId) => r(e.admin.authId, "select public.anular_factura_de_pedido($1, 'El cliente devolvió todo', $2) as r", [ventaId, randomUUID()])
    const ventaDe = async (pedido) => (await contexto.db.query("select venta_id from pedidos_ubicacion where id = $1", [pedido.pedido_id])).rows[0].venta_id

    for (const p of [contado, credito]) {
      expect((await anular(await ventaDe(p))).estado).toBe("anulada")
    }

    const pendientes = (await contexto.db.query("select count(*)::int as n from pedidos_ubicacion where estado = 'cancelado'")).rows[0].n

    expect(pendientes).toBe(3)
    expect((await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])).venta_id).toBeTruthy()
  })
})
