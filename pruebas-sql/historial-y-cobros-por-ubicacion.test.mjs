/*
  OFF-1.1: historial y cuentas por cobrar por ubicación.

  Vendedores: ventas, detalle, abonos, pagos y cobros de SU ubicación.
  Administradores: todas. La venta del POS no cambia.

  registrar_pago_cliente() es SECURITY DEFINER: pasa por encima de RLS.
  Si solo se limitara la lectura, un vendedor podría abonar a una factura
  de otro camión que no ve. Por eso el alcance del cobro se limita dentro
  de la función, con la misma regla.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { crearVendedor, crearFactura } from "./fixtures.mjs"
import { escenarioSinConexion, fallo } from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

/*
  Dos camiones con un vendedor cada uno, una venta a crédito de cada uno al
  mismo cliente (la del Camión 02 más vieja) y una venta histórica sin
  ubicación, como las de antes del inventario por ubicación.
*/
async function escenario() {
  const esc = await escenarioSinConexion(db)
  await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'receivables'), ($1, $2, 'sales-history')", [
    esc.vendedor.usuario,
    esc.empresa,
  ])
  const vendedor2 = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion2, permisos: ["pos", "receivables"] })

  const aCredito = async (authId) =>
    (
      await consultarComo(
        db,
        authId,
        "select registrar_venta_ubicacion($1::jsonb, 'credito', $2) as r",
        [JSON.stringify([{ producto_id: esc.cargador.id, cantidad: 1 }]), esc.clienteId]
      )
    ).rows[0].r.venta_id

  const deCamion2 = await aCredito(vendedor2.authId)
  await db.query("update ventas set fecha = now() - interval '10 days' where id = $1", [deCamion2])
  const deCamion1 = await aCredito(esc.vendedor.authId)
  const historica = await crearFactura(db, { empresa: esc.empresa, clienteId: esc.clienteId, total: 50, fecha: new Date(Date.now() - 30 * 86400000).toISOString() })

  return { ...esc, vendedor2, deCamion1, deCamion2, historica }
}

const idsDe = (r) => r.rows.map((f) => f.id).sort()

const pagar = (authId, clienteId, monto) =>
  consultarComo(db, authId, "select registrar_pago_cliente($1, $2) as r", [clienteId, monto]).then((r) => r.rows[0].r)

describe("historial por ubicación", () => {
  it("1. el vendedor ve solo las ventas de su ubicación; el administrador todas", async () => {
    const e = await escenario()
    const ver = (authId) => consultarComo(db, authId, "select id from ventas where empresa_id = $1", [e.empresa])

    expect(idsDe(await ver(e.vendedor.authId))).toEqual([e.deCamion1])
    expect(idsDe(await ver(e.vendedor2.authId))).toEqual([e.deCamion2])
    expect(idsDe(await ver(e.admin.authId))).toEqual([e.deCamion1, e.deCamion2, e.historica].sort())
  })

  it("2. el detalle sigue a su venta", async () => {
    const e = await escenario()
    const ver = (authId) => consultarComo(db, authId, "select venta_id from detalle_venta where empresa_id = $1", [e.empresa])

    expect((await ver(e.vendedor.authId)).rows.map((f) => f.venta_id)).toEqual([e.deCamion1])
    expect((await ver(e.admin.authId)).rowCount).toBe(2)
  })

  it("3. el vendedor sigue viendo su venta recién hecha en el POS", async () => {
    const e = await escenario()
    const r = await consultarComo(db, e.vendedor.authId, "select registrar_venta_ubicacion($1::jsonb, 'contado') as r", [
      JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]),
    ])

    const visible = await consultarComo(db, e.vendedor.authId, "select id from ventas where id = $1", [r.rows[0].r.venta_id])

    expect(visible.rowCount).toBe(1)
  })
})

describe("cobros por ubicación", () => {
  it("4. el cobro del vendedor solo abona a facturas de su ubicación, aunque haya una más vieja en otra", async () => {
    const e = await escenario()

    const r = await pagar(e.vendedor.authId, e.clienteId, 50)

    expect(r.aplicaciones.map((a) => a.venta_id)).toEqual([e.deCamion1])
    expect(Number(r.saldo_anterior)).toBe(115)
  })

  it("5. el sobrepago del vendedor se mide contra la deuda de su ubicación", async () => {
    const e = await escenario()

    const error = await fallo(pagar(e.vendedor.authId, e.clienteId, 200))

    expect(error.code).toBe("LC001")
  })

  it("6. el pago queda con la ubicación de quien cobró, y solo se ve allí", async () => {
    const e = await escenario()
    const r = await pagar(e.vendedor.authId, e.clienteId, 50)
    const ver = (authId) => consultarComo(db, authId, "select id from pagos where id = $1", [r.pago_id])

    expect((await db.query("select ubicacion_id from pagos where id = $1", [r.pago_id])).rows[0].ubicacion_id).toBe(e.camion1)
    expect((await ver(e.vendedor.authId)).rowCount).toBe(1)
    expect((await ver(e.vendedor2.authId)).rowCount).toBe(0)
    expect((await ver(e.admin.authId)).rowCount).toBe(1)
  })

  it("7. los abonos siguen a su factura", async () => {
    const e = await escenario()
    await pagar(e.vendedor.authId, e.clienteId, 50)
    const ver = (authId) => consultarComo(db, authId, "select id from abonos where empresa_id = $1", [e.empresa])

    expect((await ver(e.vendedor.authId)).rowCount).toBe(1)
    expect((await ver(e.vendedor2.authId)).rowCount).toBe(0)
  })

  it("8. un vendedor sin ubicación operativa no cobra", async () => {
    const e = await escenario()
    const sinUbicacion = await crearVendedor(db, { empresa: e.empresa, permisos: ["receivables"] })

    const error = await fallo(pagar(sinUbicacion.authId, e.clienteId, 10))

    expect(error.code).toBe("LC005")
  })

  it("9. el administrador cobra sobre todas las ubicaciones, de la más vieja a la más nueva", async () => {
    const e = await escenario()

    const r = await pagar(e.admin.authId, e.clienteId, 280)

    expect(r.aplicaciones.map((a) => a.venta_id)).toEqual([e.historica, e.deCamion2, e.deCamion1])
    expect((await db.query("select ubicacion_id from pagos where id = $1", [r.pago_id])).rows[0].ubicacion_id).toBeNull()
  })
})
