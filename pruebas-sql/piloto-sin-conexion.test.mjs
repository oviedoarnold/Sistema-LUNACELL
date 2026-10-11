/*
  OFF-1.4: garantías que el piloto de Camión 01 necesita del servidor, una
  por una, con PostgreSQL real.

  - Una venta que queda en conciliación no toca inventario, movimientos ni
    correlativos, ni al llegar ni al reenviarse: solo una decisión
    administrativa la aplica.
  - El teléfono y el rescate pueden subir la misma venta en cualquier
    orden: una sola conciliación, nunca una venta doble.
  - Aplicar descuenta una sola vez, aunque después se reenvíe o se vuelva
    a aplicar.
  - El teléfono puede consultar en qué quedó cada venta suya en
    conciliación (sin ver las de otros).
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { contar, crearVendedor } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  rescatar,
  conciliar,
  existencia,
  correlativoInterno,
} from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

// Lo que una venta no debe tocar mientras nadie decide: existencias, libro y numeración.
async function huellaDeLibros(esc) {
  const r = await db.query(
    `select
       (select coalesce(string_agg(ubicacion_id || ':' || producto_id || ':' || cantidad, ',' order by ubicacion_id, producto_id), '')
          from inventario_ubicacion where empresa_id = $1) as inventario,
       (select count(*) from movimientos_inventario where empresa_id = $1) as movimientos,
       (select count(*) from ventas where empresa_id = $1) as ventas`,
    [esc.empresa]
  )

  return { ...r.rows[0], correlativo: await correlativoInterno(db, esc.empresa) }
}

describe("una venta en conciliación no toca los libros", () => {
  it("1. al llegar sin existencia suficiente, ni al reenviarse, no cambia inventario, movimientos, ventas ni correlativos", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const antes = await huellaDeLibros(esc)
    const venta = ventaSinConexion(esc)

    const primera = await sincronizar(db, esc.vendedor.authId, venta)
    const segunda = await sincronizar(db, esc.vendedor.authId, venta)

    expect(primera).toMatchObject({ estado: "en_conciliacion", motivo: "existencia-insuficiente" })
    expect(segunda.estado).toBe("ya_en_conciliacion")
    expect(await huellaDeLibros(esc)).toEqual(antes)
  })

  it("2. con el precio cambiado tampoco: lo cobrado espera la decisión del administrador", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])
    const antes = await huellaDeLibros(esc)

    const r = await sincronizar(db, esc.vendedor.authId, venta)

    expect(r.motivo).toBe("precio-distinto")
    expect(await huellaDeLibros(esc)).toEqual(antes)
  })
})

describe("teléfono y rescate suben la misma venta", () => {
  it("3. primero el rescate y después el teléfono: una sola conciliación y nada descontado", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const antes = await huellaDeLibros(esc)

    const rescate = await rescatar(db, esc.admin.authId, venta, "lote-piloto")
    const telefono = await sincronizar(db, esc.vendedor.authId, venta)

    expect(rescate.estado).toBe("en_conciliacion")
    expect(telefono).toMatchObject({ estado: "ya_en_conciliacion", conciliacion_id: rescate.conciliacion_id })
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(1)
    expect(await huellaDeLibros(esc)).toEqual(antes)
  })

  it("4. primero el teléfono (registrada) y después el rescate: ya_registrada, sin descontar otra vez", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)

    const telefono = await sincronizar(db, esc.vendedor.authId, venta)
    const despues = await huellaDeLibros(esc)
    const rescate = await rescatar(db, esc.admin.authId, venta, "lote-piloto")

    expect(telefono.estado).toBe("registrada")
    expect(rescate).toMatchObject({ estado: "ya_registrada", venta_id: telefono.venta_id })
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
    expect(await huellaDeLibros(esc)).toEqual(despues)
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("5. primero el teléfono (en conciliación) y después el rescate: la misma conciliación", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const venta = ventaSinConexion(esc)

    const telefono = await sincronizar(db, esc.vendedor.authId, venta)
    const rescate = await rescatar(db, esc.admin.authId, venta, "lote-piloto")

    expect(rescate).toMatchObject({ estado: "ya_en_conciliacion", conciliacion_id: telefono.conciliacion_id })
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(1)
  })
})

describe("aplicar descuenta una sola vez", () => {
  it("6. aplicar, reenviar desde el teléfono y volver a aplicar dejan un solo descuento y una sola venta", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])
    const { conciliacion_id: id } = await sincronizar(db, esc.vendedor.authId, venta)

    const aplicada = await conciliar(db, esc.admin.authId, id, "aplicar")
    const reenvio = await sincronizar(db, esc.vendedor.authId, venta)
    const otraVez = await conciliar(db, esc.admin.authId, id, "aplicar")

    expect(aplicada.estado).toBe("aplicada")
    expect(reenvio).toMatchObject({ estado: "ya_registrada", venta_id: aplicada.venta_id })
    expect(otraVez.estado).toBe("ya_aplicada")
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })
})

describe("el teléfono consulta en qué quedaron sus ventas", () => {
  it("7. el vendedor lee el estado y la resolución de sus ventas por conciliar, y no las de otro vendedor", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const venta = ventaSinConexion(esc)
    const { conciliacion_id: id } = await sincronizar(db, esc.vendedor.authId, venta)
    await conciliar(db, esc.admin.authId, id, "anular", "Venta repetida")
    const otro = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos"] })
    const consulta =
      "select clave_idempotencia, estado, resuelta_en, venta_id from ventas_por_conciliar where clave_idempotencia = any($1)"

    const suyas = await consultarComo(db, esc.vendedor.authId, consulta, [[venta.clave_idempotencia]])
    const ajenas = await consultarComo(db, otro.authId, consulta, [[venta.clave_idempotencia]])

    expect(suyas.rows).toEqual([
      expect.objectContaining({ clave_idempotencia: venta.clave_idempotencia, estado: "anulada", venta_id: null }),
    ])
    expect(suyas.rows[0].resuelta_en).toBeTruthy()
    expect(ajenas.rowCount).toBe(0)
  })
})
