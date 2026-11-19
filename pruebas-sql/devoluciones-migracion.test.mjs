/*
  0052 aplicada sobre una base con la 0051 y operaciones, como en producción:
  ventas de contado y a crédito con abonos, un pedido facturado y uno con su
  factura anulada (C3). No debe cambiar ninguna fila ni ningún reporte, y las
  ventas de antes admiten devoluciones después.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { baseConOperaciones, fotoDeDatos, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0051_anulacion_facturas_pedidos.sql")
const MIGRACION = "0052_devoluciones_ventas_y_ajustes_credito.sql"
const TABLAS = ["pagos", "abonos", "pedidos_ubicacion", "movimientos_inventario", "anulaciones_venta", "cancelaciones_de_pedido", "reembolsos_de_pedido"]
const SIN_CAMBIOS = ["anular_venta", "anular_factura_de_pedido", "registrar_pago_cliente", "registrar_venta_con_medios", "facturar_pedido"]

const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r

// La 0052 agrega dos columnas vacías: se comparan las filas sin ellas, y se comprueba aparte que estén vacías.
async function fotoSinColumnasNuevas() {
  const foto = await fotoDeDatos(contexto, { tablas: TABLAS })

  for (const [tabla, columna] of [["abonos", "devolucion_id"], ["movimientos_inventario", "devolucion_venta_id"]]) {
    expect(foto[tabla].every((fila) => fila[columna] == null)).toBe(true)
    foto[tabla] = foto[tabla].map(({ [columna]: _nueva, ...resto }) => resto)
  }

  return foto
}

describe("la 0052 sobre una base con ventas, abonos, pedidos y anulaciones", () => {
  let antes
  let reportesAntes
  let cuerpos
  let contado

  const reportes = async () => ({
    diario: await r(contexto.e.admin.authId, "select public.reporte_diario_de_caja() as r"),
    medios: await r(contexto.e.admin.authId, "select public.reporte_medios_de_caja() as r"),
  })

  beforeAll(async () => {
    const { db, e } = contexto

    contado = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    const credito = await r(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'credito', p_cobros => '[]'::jsonb, p_cliente_id => $2,
         p_fecha_vencimiento => '2030-01-01', p_clave_idempotencia => $3) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 2 }]), e.clienteId, randomUUID()]
    )

    await r(e.admin.authId, "select registrar_pago_cliente($1, 100) as r", [e.clienteId])
    expect(credito.venta_id).toBeTruthy()

    antes = await fotoDeDatos(contexto, { tablas: TABLAS })
    reportesAntes = await reportes()
    cuerpos = Object.fromEntries(await Promise.all(SIN_CAMBIOS.map(async (n) => [n, await cuerpoDe(db, await firmaDe(db, n))])))

    await aplicarMigracion(db, MIGRACION)
  })

  it("no cambia ninguna fila, ningún reporte ni las funciones de vender, cobrar y anular", async () => {
    const { db } = contexto

    expect(await fotoSinColumnasNuevas()).toEqual(antes)
    expect(await reportes()).toEqual(reportesAntes)

    for (const n of SIN_CAMBIOS) expect([n, await cuerpoDe(db, await firmaDe(db, n))]).toEqual([n, cuerpos[n]])
  })

  it("aplicarla otra vez no cambia nada", async () => {
    await aplicarMigracion(contexto.db, MIGRACION)
    expect(await fotoSinColumnasNuevas()).toEqual(antes)
  })

  it("una venta de antes admite una devolución, y vender sigue igual", async () => {
    const { e } = contexto
    const d = await r(e.admin.authId, "select public.registrar_devolucion_de_venta($1, 'Lo devolvió', $2::jsonb, null, $3) as r", [
      contado.venta_id,
      JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1, condicion: "buen_estado" }]),
      randomUUID(),
    ])

    expect(Number(d.a_favor)).toBeGreaterThan(0)
    expect((await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])).venta_id).toBeTruthy()
  })
})
