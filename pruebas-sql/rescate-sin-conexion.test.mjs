/*
  OFF-1.1: rescate administrativo de ventas sin conexión.

  El rescate existe para subir las ventas de un teléfono cuya sesión ya no
  sirve. Por eso tiene que ser seguro en las dos direcciones: nunca crea
  una venta (solo filas de conciliación), no cruza empresas, no duplica ni
  reescribe lo que ya está, y cada intento —aceptado o no— queda auditado.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { crearEmpresa, contar } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  rescatar,
  fallo,
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

const auditoriaDe = async (empresa) =>
  (await db.query("select * from auditoria_rescates where empresa_id = $1 order by id", [empresa])).rows

describe("rescate", () => {
  it("1. el administrador sube una venta a conciliación, nunca como venta", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)

    const r = await rescatar(db, esc.admin.authId, venta, "lote-a")
    const fila = (await db.query("select * from ventas_por_conciliar where id = $1", [r.conciliacion_id])).rows[0]
    const [auditoria] = await auditoriaDe(esc.empresa)

    expect(r.estado).toBe("en_conciliacion")
    expect(fila.motivo).toBe("rescate")
    expect(fila.recibida_por).toBe("rescate")
    expect(fila.rescatada_por).toBe(esc.admin.usuario)
    expect(fila.usuario_id).toBe(esc.vendedor.usuario)
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
    expect(auditoria).toMatchObject({ resultado: "en_conciliacion", lote: "lote-a", administrador_id: esc.admin.usuario })
    expect(auditoria.clave).toBe(venta.clave_idempotencia)
    expect(auditoria.huella).toBe(fila.huella)
  })

  it("2. un vendedor no puede rescatar", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(rescatar(db, esc.vendedor.authId, ventaSinConexion(esc)))

    expect(error.code).toBe("42501")
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("3. el administrador de otra empresa no puede rescatar ventas ajenas", async () => {
    const esc = await escenarioSinConexion(db)
    const ajena = await crearEmpresa(db, "Otra")

    const r = await rescatar(db, ajena.authId, ventaSinConexion(esc))

    expect(r).toMatchObject({ estado: "rechazado", codigo: "42501" })
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
    expect((await auditoriaDe(ajena.empresa))[0]).toMatchObject({ resultado: "rechazado", codigo: "42501" })
  })

  it("4. no acepta una ubicación de otra empresa", async () => {
    const esc = await escenarioSinConexion(db)
    const ajena = await escenarioSinConexion(db)

    const r = await rescatar(db, esc.admin.authId, ventaSinConexion(esc, { ubicacion_id: ajena.camion1 }))

    expect(r).toMatchObject({ estado: "rechazado", codigo: "OF001" })
  })

  it("5. rescatar dos veces lo mismo no duplica y queda auditado", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)

    const primera = await rescatar(db, esc.admin.authId, venta)
    const segunda = await rescatar(db, esc.admin.authId, venta)

    expect(segunda.estado).toBe("ya_en_conciliacion")
    expect(segunda.conciliacion_id).toBe(primera.conciliacion_id)
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(1)
    expect((await auditoriaDe(esc.empresa)).map((a) => a.resultado)).toEqual(["en_conciliacion", "ya_en_conciliacion"])
  })

  it("6. la misma clave con otro contenido se rechaza (OF003), se audita y no cambia el original", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const r = await rescatar(db, esc.admin.authId, venta)

    const otra = await rescatar(db, esc.admin.authId, { ...venta, nota: "manipulada" })
    const fila = (await db.query("select nota from ventas_por_conciliar where id = $1", [r.conciliacion_id])).rows[0]

    expect(otra).toMatchObject({ estado: "rechazado", codigo: "OF003" })
    expect(fila.nota).toBe("")
    expect((await auditoriaDe(esc.empresa)).at(-1)).toMatchObject({ resultado: "rechazado", codigo: "OF003" })
  })

  it("7. rescatar una venta que el vendedor ya sincronizó responde ya_registrada", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const r = await sincronizar(db, esc.vendedor.authId, venta)

    const rescate = await rescatar(db, esc.admin.authId, venta)

    expect(rescate).toMatchObject({ estado: "ya_registrada", venta_id: r.venta_id })
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("8. si después el vendedor sincroniza la venta rescatada, no se duplica", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const r = await rescatar(db, esc.admin.authId, venta)

    const despues = await sincronizar(db, esc.vendedor.authId, venta)

    expect(despues).toMatchObject({ estado: "ya_en_conciliacion", conciliacion_id: r.conciliacion_id })
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("9. contenido mal formado se rechaza y se audita", async () => {
    const esc = await escenarioSinConexion(db)

    const r = await rescatar(db, esc.admin.authId, ventaSinConexion(esc, { total_cobrado: 1 }))

    expect(r).toMatchObject({ estado: "rechazado", codigo: "OF001" })
    expect((await auditoriaDe(esc.empresa))[0]).toMatchObject({ resultado: "rechazado", codigo: "OF001" })
  })
})

describe("auditoría de rescates", () => {
  it("10. es inmutable y solo la lee el administrador", async () => {
    const esc = await escenarioSinConexion(db)
    await rescatar(db, esc.admin.authId, ventaSinConexion(esc))
    const [fila] = await auditoriaDe(esc.empresa)

    const borrar = await fallo(db.query("delete from auditoria_rescates where id = $1", [fila.id]))
    const cambiar = await fallo(db.query("update auditoria_rescates set resultado = 'rechazado' where id = $1", [fila.id]))
    const verAdmin = await consultarComo(db, esc.admin.authId, "select id from auditoria_rescates where id = $1", [fila.id])
    const verVendedor = await consultarComo(db, esc.vendedor.authId, "select id from auditoria_rescates where id = $1", [fila.id])

    expect(borrar.message).toMatch(/no se modifica/i)
    expect(cambiar.message).toMatch(/no se modifica/i)
    expect(verAdmin.rowCount).toBe(1)
    expect(verVendedor.rowCount).toBe(0)
  })
})
