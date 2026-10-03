/*
  La 0019 contra PostgreSQL de verdad: el libro de inventario ya no se
  escribe desde fuera de las funciones, y todo movimiento nuevo lleva
  ubicación, sin tocar los históricos que no la tienen.

  Lo que importa probar es tanto lo que se cierra como lo que NO se rompe:
  las dos funciones siguen escribiendo, la empresa sigue leyendo su libro,
  y borrar una venta o un usuario sigue pudiendo poner en nulo la
  referencia de un movimiento histórico.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, contar } from "./fixtures.mjs"

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
  Una empresa con su administrador operando desde la bodega, un producto
  con 10 en ella y un movimiento histórico sin ubicación, como los doce
  que hay en producción de antes de INV-3.2.1.
*/
async function escenario() {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  const bodega = (
    await db.query(
      `insert into ubicaciones (empresa_id, nombre, tipo)
       values ($1, 'Bodega del libro', 'bodega') returning id`,
      [empresa]
    )
  ).rows[0].id

  const producto = (
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, 'L-' || substr(md5(random()::text), 1, 8), 'Cargador', 100, 10)
       returning id`,
      [empresa]
    )
  ).rows[0].id

  await db.query("update usuarios set ubicacion_id = $1 where id = $2", [
    bodega,
    usuario,
  ])

  await db.query(
    `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
     values ($1, $2, $3, 10)`,
    [empresa, bodega, producto]
  )

  /*
    La historia se siembra saltando el disparador, porque es justo lo que
    el esquema de hoy ya no deja crear.
  */
  await db.query("set session_replication_role = replica")

  let historico

  try {
    historico = (
      await db.query(
        `insert into movimientos_inventario (empresa_id, producto_id, usuario_id, tipo, cantidad, motivo)
         values ($1, $2, $3, 'entrada', 10, 'Existencia inicial') returning id`,
        [empresa, producto, usuario]
      )
    ).rows[0].id
  } finally {
    await db.query("set session_replication_role = origin")
  }

  return { empresa, usuario, authId, bodega, producto, historico }
}

/* Corre una consulta como ese usuario y vuelve a dueño pase lo que pase. */
async function como(authId, sql, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(sql, valores)
  } finally {
    await comoDueno(db)
  }
}

// ── LO QUE SE CIERRA ──────────────────────────────────────

describe("nadie escribe el libro desde fuera de las funciones", () => {
  it("1. authenticated ya no puede insertar un movimiento, ni con ubicación", async () => {
    const e = await escenario()

    await expect(
      como(
        e.authId,
        `insert into movimientos_inventario (empresa_id, producto_id, ubicacion_id, tipo, cantidad, motivo)
         values ($1, $2, $3, 'entrada', 5, 'a mano')`,
        [e.empresa, e.producto, e.bodega]
      )
    ).rejects.toThrow(/permission denied/i)
  })

  it("2. authenticated ya no puede editar ni borrar un movimiento", async () => {
    const e = await escenario()

    await expect(
      como(e.authId, "update movimientos_inventario set cantidad = 99 where id = $1", [e.historico])
    ).rejects.toThrow(/permission denied/i)

    await expect(
      como(e.authId, "delete from movimientos_inventario where id = $1", [e.historico])
    ).rejects.toThrow(/permission denied/i)

    const m = await db.query("select cantidad from movimientos_inventario where id = $1", [e.historico])

    expect(m.rows[0].cantidad).toBe(10)
  })

  it("3. ni authenticated ni anon conservan insert, update o delete", async () => {
    const r = await db.query(
      `select rol, privilegio,
              has_table_privilege(rol, 'public.movimientos_inventario', privilegio) as tiene
         from unnest(array['authenticated', 'anon']) as rol,
              unnest(array['INSERT', 'UPDATE', 'DELETE']) as privilegio`
    )

    expect(r.rows.filter((f) => f.tiene)).toEqual([])
  })

  it("4. la empresa sigue leyendo su libro", async () => {
    const e = await escenario()

    const r = await como(
      e.authId,
      "select id from movimientos_inventario where producto_id = $1",
      [e.producto]
    )

    expect(r.rows.map((f) => String(f.id))).toEqual([String(e.historico)])
  })
})

describe("todo movimiento nuevo lleva ubicación", () => {
  it("5. ni el dueño puede insertar uno sin ubicación", async () => {
    const e = await escenario()

    await expect(
      db.query(
        `insert into movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo)
         values ($1, $2, 'ajuste', 1, 'sin ubicación')`,
        [e.empresa, e.producto]
      )
    ).rejects.toMatchObject({ code: "23502" })
  })

  it("6. con ubicación, el dueño sí puede", async () => {
    const e = await escenario()

    await db.query(
      `insert into movimientos_inventario (empresa_id, producto_id, ubicacion_id, tipo, cantidad, motivo)
       values ($1, $2, $3, 'ajuste', 1, 'con ubicación')`,
      [e.empresa, e.producto, e.bodega]
    )

    expect(
      await contar(db, "movimientos_inventario", "producto_id = $1 and ubicacion_id = $2", [
        e.producto,
        e.bodega,
      ])
    ).toBe(1)
  })

  it("7. la función del disparador no es SECURITY DEFINER y fija su search_path", async () => {
    const r = await db.query(
      `select prosecdef, proconfig
         from pg_proc
        where oid = 'movimientos_exigir_ubicacion()'::regprocedure`
    )

    expect(r.rows[0].prosecdef).toBe(false)
    expect(r.rows[0].proconfig).toEqual(["search_path=public"])
  })
})

// ── LO QUE NO SE ROMPE ────────────────────────────────────

describe("las funciones siguen escribiendo", () => {
  it("8. una venta por registrar_venta_ubicacion deja su salida con ubicación", async () => {
    const e = await escenario()

    const r = await como(
      e.authId,
      "select registrar_venta_ubicacion($1::jsonb) as res",
      [JSON.stringify([{ producto_id: e.producto, cantidad: 3 }])]
    )

    const venta = r.rows[0].res.venta_id
    const salida = await db.query(
      "select ubicacion_id, cantidad from movimientos_inventario where venta_id = $1",
      [venta]
    )

    expect(salida.rows).toEqual([{ ubicacion_id: e.bodega, cantidad: -3 }])
  })

  it("9. una entrada por registrar_movimiento_ubicacion sigue funcionando", async () => {
    const e = await escenario()

    const r = await como(
      e.authId,
      "select registrar_movimiento_ubicacion($1, $2, 'entrada', 4) as res",
      [e.producto, e.bodega]
    )

    expect(r.rows[0].res.existencia_nueva).toBe(14)
  })

  /*
    La razón por la que esto es un disparador y no un check: las llaves
    foráneas de venta_id y usuario_id ponen en nulo la referencia de los
    movimientos históricos cuando se borra lo referido. Con un check sobre
    la ubicación, ese UPDATE automático fallaría.
  */
  it("10. borrar una venta sigue soltando la referencia de un movimiento histórico", async () => {
    const e = await escenario()

    const venta = (
      await db.query(
        `insert into ventas (empresa_id, numero_factura, correlativo, forma_pago, total)
         values ($1, 'FAC-HIST', 90001, 'contado', 100) returning id`,
        [e.empresa]
      )
    ).rows[0].id

    await db.query("update movimientos_inventario set venta_id = $1 where id = $2", [
      venta,
      e.historico,
    ])

    await db.query("delete from ventas where id = $1", [venta])

    const m = await db.query(
      "select venta_id, ubicacion_id from movimientos_inventario where id = $1",
      [e.historico]
    )

    expect(m.rows[0]).toEqual({ venta_id: null, ubicacion_id: null })
  })

  it("11. borrar un usuario sigue soltando la referencia de un movimiento histórico", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, { empresa: e.empresa })

    await db.query("update movimientos_inventario set usuario_id = $1 where id = $2", [
      v.usuario,
      e.historico,
    ])

    await db.query("delete from usuarios where id = $1", [v.usuario])

    const m = await db.query("select usuario_id from movimientos_inventario where id = $1", [
      e.historico,
    ])

    expect(m.rows[0].usuario_id).toBeNull()
  })

  it("12. los movimientos históricos sin ubicación siguen ahí, intactos", async () => {
    const e = await escenario()

    const m = await db.query(
      "select ubicacion_id, cantidad, motivo from movimientos_inventario where id = $1",
      [e.historico]
    )

    expect(m.rows[0]).toEqual({
      ubicacion_id: null,
      cantidad: 10,
      motivo: "Existencia inicial",
    })
  })
})
