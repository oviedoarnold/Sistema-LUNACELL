/*
  0035 contra PostgreSQL de verdad: el costo de los productos solo lo ve
  y lo cambia un administrador.

  Se prueba por cada camino por el que el costo podía salir de la base:
  la tabla, la vista del catálogo, los filtros y el orden (que dejan
  adivinarlo por tanteo), y la función que sí lo entrega. Y lo que no se
  rompe: el precio de venta sigue a la vista de todos, quien tiene
  `products` sigue creando y corrigiendo productos, y la venta y el
  inventario no cambian.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

async function como(authId, consulta, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(consulta, valores)
  } finally {
    await comoDueno(db)
  }
}

const RECHAZO = { code: "42501" }

const costoDe = async (id) =>
  (await db.query("select costo from productos where id = $1", [id])).rows[0].costo

/*
  Una empresa con su administrador y los perfiles que no deben ver el
  costo: vendedor, encargado de inventario (con `products`), encargado de
  bodega (con el inventario de todas las ubicaciones) y contador. Y otra
  empresa, para comprobar que el administrador no ve costos ajenos.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")

  const bodega = (
    await db.query(
      "insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Bodega', 'bodega') returning id",
      [a.empresa]
    )
  ).rows[0].id

  await db.query("update usuarios set ubicacion_id = $1 where id = $2", [bodega, a.usuario])

  const producto = async (empresa, codigo, precio, costo) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, $2, 'Cargador', $3, $4) returning id`,
        [empresa, codigo, precio, costo]
      )
    ).rows[0].id

  const cargador = await producto(a.empresa, "A-1", 100, 37.5)
  const ajeno = await producto(b.empresa, "B-1", 80, 20)

  await db.query(
    `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
     values ($1, $2, $3, 10)`,
    [a.empresa, bodega, cargador]
  )

  const vendedor = await crearVendedor(db, {
    empresa: a.empresa,
    ubicacion: bodega,
    permisos: ["pos", "quotes", "sales-history", "inventory-own"],
  })
  const inventario = await crearVendedor(db, {
    empresa: a.empresa,
    ubicacion: bodega,
    permisos: ["products", "inventory-own"],
  })
  const encargadoBodega = await crearVendedor(db, {
    empresa: a.empresa,
    ubicacion: bodega,
    permisos: ["inventory-all"],
  })
  const contador = await crearVendedor(db, {
    empresa: a.empresa,
    permisos: ["sales-history", "inventory-all", "products", "quotes"],
  })
  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  return { a, b, bodega, cargador, ajeno, vendedor, inventario, encargadoBodega, contador }
}

const perfilesSinCosto = (e) => [
  ["vendedor", e.vendedor.authId],
  ["encargado de inventario", e.inventario.authId],
  ["encargado de bodega", e.encargadoBodega.authId],
  ["contador", e.contador.authId],
]

describe("0035: el administrador consulta los costos", () => {
  it("1. costos_de_productos() le devuelve el costo de su empresa, y solo de ella", async () => {
    const e = await escenario()

    const { rows } = await como(e.a.authId, "select producto_id, costo from costos_de_productos()")

    expect(rows).toEqual([{ producto_id: e.cargador, costo: "37.50" }])
  })

  it("1b. fija el costo al crear y al editar", async () => {
    const e = await escenario()

    const { rows } = await como(
      e.a.authId,
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, 'A-2', 'Cable', 50, 12.25) returning id`,
      [e.a.empresa]
    )
    expect(await costoDe(rows[0].id)).toBe("12.25")

    await como(e.a.authId, "update productos set costo = 40 where id = $1", [e.cargador])
    expect(await costoDe(e.cargador)).toBe("40.00")
  })
})

describe("0035: nadie más recibe el costo, por ningún camino de la API", () => {
  it("2-4. ni contador, ni vendedor, ni inventario, ni bodega leen la columna", async () => {
    const e = await escenario()

    for (const [, authId] of perfilesSinCosto(e)) {
      await expect(como(authId, "select costo from productos")).rejects.toMatchObject(RECHAZO)
      await expect(como(authId, "select * from productos")).rejects.toMatchObject(RECHAZO)
    }
  })

  it("5. tampoco filtran ni ordenan por el costo para adivinarlo", async () => {
    const e = await escenario()

    for (const [, authId] of perfilesSinCosto(e)) {
      await expect(
        como(authId, "select id from productos where costo > 30")
      ).rejects.toMatchObject(RECHAZO)
      await expect(
        como(authId, "select id from productos order by costo")
      ).rejects.toMatchObject(RECHAZO)
    }
  })

  it("5b. costos_de_productos() les responde con un rechazo, no con una lista", async () => {
    const e = await escenario()

    for (const [, authId] of perfilesSinCosto(e)) {
      await expect(como(authId, "select * from costos_de_productos()")).rejects.toMatchObject(RECHAZO)
    }

    await expect(como(null, "select * from costos_de_productos()")).rejects.toMatchObject(RECHAZO)
  })

  it("5c. anon no lee productos ni la vista", async () => {
    await escenario()

    await expect(como(null, "select id from productos")).rejects.toMatchObject(RECHAZO)
    await expect(como(null, "select id from productos_con_stock")).rejects.toMatchObject(RECHAZO)
  })

  it("5d. ninguna vista ni función de la base devuelve una columna de costo, margen o utilidad", async () => {
    const vistas = await db.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in (select table_name from information_schema.views where table_schema = 'public')
          and column_name ~* '(costo|margen|utilidad|ganancia)'`
    )
    expect(vistas.rows).toEqual([])

    // Las funciones que devuelven filas: ninguna columna de salida con esos nombres, salvo la del administrador.
    const salidas = await db.query(
      `select p.proname, a.nombre
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(nombre)
        where n.nspname = 'public'
          and a.nombre ~* '(costo|margen|utilidad|ganancia)'
          and p.proname <> 'costos_de_productos'`
    )
    expect(salidas.rows).toEqual([])
  })

  it("todas las columnas de productos menos el costo siguen concedidas", async () => {
    const { rows } = await db.query(
      `select column_name,
              has_column_privilege('authenticated', 'public.productos', column_name, 'select') as lee
         from information_schema.columns
        where table_schema = 'public' and table_name = 'productos'`
    )

    for (const { column_name: columna, lee } of rows) {
      expect({ columna, lee }).toEqual({ columna, lee: columna !== "costo" })
    }
  })
})

describe("0035: el precio de venta y la operación siguen", () => {
  it("7. todos leen el precio de venta, en la tabla y en la vista", async () => {
    const e = await escenario()

    for (const [, authId] of perfilesSinCosto(e)) {
      const tabla = await como(authId, "select id, precio from productos where id = $1", [e.cargador])
      expect(tabla.rows).toEqual([{ id: e.cargador, precio: "100.00" }])

      const vista = await como(authId, "select * from productos_con_stock where id = $1", [e.cargador])
      expect(vista.rows).toHaveLength(1)
      expect(vista.rows[0].precio).toBe("100.00")
      expect(vista.rows[0]).not.toHaveProperty("costo")
    }
  })

  it("el encargado de inventario crea un producto: el costo queda en 0 aunque lo mande", async () => {
    const e = await escenario()

    const { rows } = await como(
      e.inventario.authId,
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, 'A-3', 'Funda', 60, 25) returning id`,
      [e.a.empresa]
    )

    expect(await costoDe(rows[0].id)).toBe("0.00")
  })

  it("corrige el precio sin poder cambiar el costo", async () => {
    const e = await escenario()

    await como(e.inventario.authId, "update productos set precio = 120, costo = 1 where id = $1", [e.cargador])

    const { rows } = await db.query("select precio, costo from productos where id = $1", [e.cargador])
    expect(rows[0]).toEqual({ precio: "120.00", costo: "37.50" })
  })

  it("8. la venta y el ajuste de inventario siguen funcionando con el costo cerrado", async () => {
    const e = await escenario()

    await comoUsuario(db, e.vendedor.authId)
    try {
      const venta = await db.query(
        "select registrar_venta_ubicacion($1::jsonb) as res",
        [JSON.stringify([{ producto_id: e.cargador, cantidad: 2 }])]
      )
      expect(venta.rows[0].res.venta_id).toBeTruthy()
    } finally {
      await comoDueno(db)
    }

    await como(
      e.inventario.authId,
      "select registrar_movimiento_ubicacion($1, $2, 'entrada', 5, 'Compra')",
      [e.cargador, e.bodega]
    )

    const { rows } = await db.query(
      "select cantidad from inventario_ubicacion where producto_id = $1 and ubicacion_id = $2",
      [e.cargador, e.bodega]
    )
    expect(rows[0].cantidad).toBe(13)
  })
})
