/*
  A-1b: la aplicación no puede escribir los contadores de `empresas`.

  Después de la 0031 nadie puede pedirle a siguiente_correlativo() un número
  de factura o interno sin registrar un documento. Pero quedaba otra puerta:
  `authenticated` tiene UPDATE sobre las columnas proximo_correlativo_* y la
  política empresas_update deja escribir al administrador. Un administrador
  podía adelantar el contador con un UPDATE directo por la API y dejar un
  hueco en el rango autorizado del CAI, sin pasar por ninguna función.

  Desde la 0032 un disparador lo impide, con el criterio de 0027 y 0030: se
  vigila a la aplicación (authenticated/anon). Los contadores los mueven
  solo las funciones que registran documentos, que corren como el dueño de
  la base, y el dueño (SQL Editor, migraciones), que es quien ajusta el
  contador al inicio de un rango autorizado nuevo.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, aplicarMigracion } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  conciliar,
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

const CONTADORES = ["proximo_correlativo_factura", "proximo_correlativo_interno", "proximo_correlativo_cotizacion"]

/*
  La empresa del escenario sin conexión (un camión habilitado, existencia y
  un vendedor con POS), con CAI, una tienda fiscal y contadores conocidos.
*/
async function escenario() {
  const esc = await escenarioSinConexion(db)

  await db.query(
    `update empresas
        set cai = 'CAI-PRUEBA', rango_desde = 1, rango_hasta = 5000,
            fecha_limite_emision = '2027-12-31',
            proximo_correlativo_factura = 100,
            proximo_correlativo_interno = 200,
            proximo_correlativo_cotizacion = 300
      where id = $1`,
    [esc.empresa]
  )
  await db.query("update ubicaciones set emite_fiscal = true where id = $1", [esc.tienda])
  await db.query(
    "insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 20)",
    [esc.empresa, esc.tienda, esc.cargador.id]
  )

  const cajero = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.tienda, permisos: ["pos", "quotes"] })

  return { ...esc, cajero }
}

const contadores = async (empresa) => {
  const r = await db.query(
    `select proximo_correlativo_factura::int as factura,
            proximo_correlativo_interno::int as interno,
            proximo_correlativo_cotizacion::int as cotizacion
       from empresas where id = $1`,
    [empresa]
  )

  return r.rows[0]
}

const INICIALES = { factura: 100, interno: 200, cotizacion: 300 }

const cambiarComo = (authId, empresa, columna, valor) =>
  consultarComo(db, authId, `update empresas set ${columna} = $2 where id = $1`, [empresa, valor])

const venderComo = (authId, producto) =>
  consultarComo(db, authId, "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', null) as res", [
    JSON.stringify([{ producto_id: producto, cantidad: 1 }]),
  ]).then((r) => r.rows[0].res)

describe("la aplicación no escribe los contadores", () => {
  it.each(CONTADORES)("1. el administrador no puede cambiar %s directamente", async (columna) => {
    const esc = await escenario()

    const error = await fallo(cambiarComo(esc.admin.authId, esc.empresa, columna, 5000))

    expect(error.code).toBe("42501")
    expect(await contadores(esc.empresa)).toEqual(INICIALES)
  })

  it("2. tampoco puede bajarlos", async () => {
    const esc = await escenario()

    const error = await fallo(cambiarComo(esc.admin.authId, esc.empresa, "proximo_correlativo_factura", 1))

    expect(error.code).toBe("42501")
    expect(await contadores(esc.empresa)).toEqual(INICIALES)
  })

  it("3. un vendedor no los cambia: RLS ya no le deja tocar la fila", async () => {
    const esc = await escenario()

    for (const columna of CONTADORES) {
      const r = await cambiarComo(esc.vendedor.authId, esc.empresa, columna, 5000)
      expect(r.rowCount).toBe(0)
    }
    expect(await contadores(esc.empresa)).toEqual(INICIALES)
  })

  it("4. el administrador sigue guardando los datos de la empresa, aunque reenvíe el mismo contador", async () => {
    const esc = await escenario()

    await consultarComo(
      db,
      esc.admin.authId,
      `update empresas
          set nombre = 'LUNACELL', cai = 'CAI-NUEVO', rango_hasta = 6000,
              proximo_correlativo_factura = proximo_correlativo_factura
        where id = $1`,
      [esc.empresa]
    )

    const r = (await db.query("select nombre, cai, rango_hasta::int from empresas where id = $1", [esc.empresa])).rows[0]
    expect(r).toEqual({ nombre: "LUNACELL", cai: "CAI-NUEVO", rango_hasta: 6000 })
    expect(await contadores(esc.empresa)).toEqual(INICIALES)
  })
})

describe("los contadores se siguen moviendo por donde deben", () => {
  it("5. una venta fiscal gasta su número de factura", async () => {
    const esc = await escenario()

    await venderComo(esc.cajero.authId, esc.cargador.id)

    expect(await contadores(esc.empresa)).toEqual({ ...INICIALES, factura: 101 })
  })

  it("6. una venta interna gasta su número interno", async () => {
    const esc = await escenario()

    await venderComo(esc.vendedor.authId, esc.cargador.id)

    expect(await contadores(esc.empresa)).toEqual({ ...INICIALES, interno: 201 })
  })

  it("7. una cotización gasta su número de cotización", async () => {
    const esc = await escenario()

    const r = await consultarComo(db, esc.cajero.authId, "select siguiente_correlativo('cotizacion') as n")

    expect(Number(r.rows[0].n)).toBe(300)
    expect(await contadores(esc.empresa)).toEqual({ ...INICIALES, cotizacion: 301 })
  })

  it("8. una venta sin conexión sincronizada gasta su número interno", async () => {
    const esc = await escenario()

    const r = await sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc))

    expect(r.estado).toBe("registrada")
    expect(await contadores(esc.empresa)).toEqual({ ...INICIALES, interno: 201 })
  })

  it("9. aplicar una venta desde conciliación gasta su número interno", async () => {
    const esc = await escenario()
    await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])
    const r = await sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc))

    await conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar", "El precio cambió después de la venta")

    expect(await contadores(esc.empresa)).toEqual({ ...INICIALES, interno: 201 })
  })

  it("10. el dueño de la base sí ajusta el contador (inicio de un rango autorizado nuevo)", async () => {
    const esc = await escenario()

    await db.query("update empresas set proximo_correlativo_factura = 1001 where id = $1", [esc.empresa])

    expect((await contadores(esc.empresa)).factura).toBe(1001)
  })
})

describe("la migración", () => {
  it("11. se puede volver a aplicar sin error y no cambia ningún contador", async () => {
    const esc = await escenario()

    await aplicarMigracion(db, "0032_contadores_solo_por_registro.sql")

    expect(await contadores(esc.empresa)).toEqual(INICIALES)
  })
})
