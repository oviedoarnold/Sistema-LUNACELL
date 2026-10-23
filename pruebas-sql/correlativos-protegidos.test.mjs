/*
  A-1: los números de factura y de documento interno solo los gasta el
  registro de un documento.

  siguiente_correlativo() es SECURITY DEFINER y la aplicación tiene que
  poder llamarla, porque numera las cotizaciones. Hasta la 0031 cualquier
  usuario con sesión podía pedirle también 'factura' o 'interno' y subir
  el contador sin crear ningún documento: un hueco en el rango autorizado
  del CAI. Desde la 0031, la aplicación solo puede pedir 'cotizacion'; los
  otros dos los piden registrar_venta_ubicacion() y conciliar_venta(), que
  corren como el dueño de la base.

  Se comprueba como en documento-fiscal-o-interno: mirando el contador
  antes y después, que es lo único que demuestra que no se gastó un número.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones, aplicarMigracion } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"
import { fallo } from "./escenario-sin-conexion.mjs"

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
  Una empresa con CAI, una tienda fiscal y un camión interno, existencia en
  los dos, y un vendedor con permiso de facturar.
*/
async function escenario() {
  const admin = await crearEmpresa(db, "Empresa de correlativos")
  const { empresa } = admin

  await db.query(
    `update empresas
        set cai = 'CAI-PRUEBA', rango_desde = 1, rango_hasta = 5000,
            fecha_limite_emision = '2027-12-31',
            proximo_correlativo_factura = 100,
            proximo_correlativo_interno = 200,
            proximo_correlativo_cotizacion = 300
      where id = $1`,
    [empresa]
  )

  const ubicacion = async (nombre, tipo) =>
    (await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id", [empresa, nombre, tipo]))
      .rows[0].id

  const tienda = await ubicacion("Tienda", "tienda")
  const camion = await ubicacion("Camión 01", "camion")
  await db.query("update ubicaciones set emite_fiscal = true where id = $1", [tienda])

  const producto = (
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, $2, 'Cargador', 100, 10) returning id`,
      [empresa, `C-${Math.random().toString(36).slice(2, 10)}`]
    )
  ).rows[0].id

  for (const u of [tienda, camion]) {
    await db.query(
      "insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 50)",
      [empresa, u, producto]
    )
  }

  const vendedor = await crearVendedor(db, { empresa, ubicacion: tienda, permisos: ["pos", "quotes"] })

  return { admin, empresa, tienda, camion, producto, vendedor }
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

const pedir = (authId, tipo) => consultarComo(db, authId, "select siguiente_correlativo($1) as n", [tipo])

const venderComo = (authId, producto) =>
  consultarComo(db, authId, "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', null) as res", [
    JSON.stringify([{ producto_id: producto, cantidad: 1 }]),
  ]).then((r) => r.rows[0].res)

describe("la aplicación no gasta números de factura ni internos", () => {
  it("1. un vendedor no puede pedir un número de factura", async () => {
    const esc = await escenario()

    const error = await fallo(pedir(esc.vendedor.authId, "factura"))

    expect(error.code).toBe("42501")
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 300 })
  })

  it("2. tampoco un número interno", async () => {
    const esc = await escenario()

    const error = await fallo(pedir(esc.vendedor.authId, "interno"))

    expect(error.code).toBe("42501")
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 300 })
  })

  it("3. ni siquiera el administrador desde la aplicación", async () => {
    const esc = await escenario()

    expect((await fallo(pedir(esc.admin.authId, "factura"))).code).toBe("42501")
    expect((await fallo(pedir(esc.admin.authId, "interno"))).code).toBe("42501")
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 300 })
  })

  it("4. un anónimo ni siquiera puede llamarla", async () => {
    const esc = await escenario()

    for (const tipo of ["factura", "interno", "cotizacion"]) {
      expect((await fallo(pedir(null, tipo))).code).toBe("42501")
    }
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 300 })
  })
})

describe("lo que sí sigue funcionando", () => {
  it("5. la aplicación sigue numerando las cotizaciones", async () => {
    const esc = await escenario()

    const r = await pedir(esc.vendedor.authId, "cotizacion")

    expect(Number(r.rows[0].n)).toBe(300)
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 301 })
  })

  it("6. una venta en una ubicación fiscal recibe su número de factura", async () => {
    const esc = await escenario()

    const res = await venderComo(esc.vendedor.authId, esc.producto)

    const venta = (await db.query("select correlativo::int, es_fiscal from ventas where id = $1", [res.venta_id])).rows[0]
    expect(venta).toEqual({ correlativo: 100, es_fiscal: true })
    expect(await contadores(esc.empresa)).toEqual({ factura: 101, interno: 200, cotizacion: 300 })
  })

  it("7. una venta en una ubicación no fiscal recibe su número interno", async () => {
    const esc = await escenario()
    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [esc.camion, esc.vendedor.usuario])

    const res = await venderComo(esc.vendedor.authId, esc.producto)

    const venta = (await db.query("select correlativo::int, es_fiscal from ventas where id = $1", [res.venta_id])).rows[0]
    expect(venta).toEqual({ correlativo: 200, es_fiscal: false })
    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 201, cotizacion: 300 })
  })

  it("8. dos cotizaciones a la vez esperan su turno y reciben números distintos", async () => {
    const esc = await escenario()
    const otro = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.tienda, permisos: ["quotes"] })
    const numero = (c) => c.query("select siguiente_correlativo('cotizacion') as n").then((r) => Number(r.rows[0].n))

    let primero
    const { respuesta, error } = await enDosSesiones(base, db, {
      primera: { authId: esc.vendedor.authId, hacer: async (c) => (primero = await numero(c)) },
      segunda: { authId: otro.authId, hacer: numero },
    })

    expect(error).toBeUndefined()
    expect([primero, respuesta]).toEqual([300, 301])
    expect((await contadores(esc.empresa)).cotizacion).toBe(302)
  })
})

describe("la migración", () => {
  it("9. se puede volver a aplicar sin error y no cambia ningún contador", async () => {
    const esc = await escenario()

    await aplicarMigracion(db, "0031_correlativos_solo_desde_el_registro.sql")

    expect(await contadores(esc.empresa)).toEqual({ factura: 100, interno: 200, cotizacion: 300 })
  })

  it("10. conserva la firma, el retorno, SECURITY DEFINER y el search_path", async () => {
    const r = await db.query(`
      select p.oid::regprocedure::text as firma, p.prorettype::regtype::text as retorno,
             p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as dueno
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'siguiente_correlativo'`)

    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      firma: "siguiente_correlativo(text)",
      retorno: "bigint",
      prosecdef: true,
      proconfig: ["search_path=public"],
    })
  })
})
