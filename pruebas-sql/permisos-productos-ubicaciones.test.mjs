/*
  SEC-3a contra PostgreSQL de verdad: productos y ubicaciones se escriben
  solo con el permiso de su sección.

  Hasta 0022 las dos tablas tenían una sola política para todo cuya única
  condición era la empresa: un vendedor con solo `pos` creaba productos,
  cambiaba precios, creaba ubicaciones y marcaba una como fiscal. Y podía
  BORRAR un producto, y con él —por las llaves en cascada— su libro de
  inventario, su existencia y sus renglones de traslado.

  Se prueba lo que se cierra y lo que no se rompe: quien tiene el permiso
  sigue operando, el administrador también, el POS y las funciones de
  inventario siguen leyendo y escribiendo, y nada cruza de empresa.
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

/* Corre una consulta como ese usuario (null = anónimo) y vuelve a dueño. */
async function como(authId, consulta, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(consulta, valores)
  } finally {
    await comoDueno(db)
  }
}

const RECHAZO = { code: "42501" }

const fila = async (tabla, id) =>
  (await db.query(`select * from ${tabla} where id = $1`, [id])).rows[0]

/*
  Empresa A: su administrador (con la bodega como ubicación operativa), un
  vendedor con solo `pos`, uno con `products`, uno con `locations` y uno
  inactivo con `products` y `locations`. Empresa B: su administrador.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")

  const ubicacion = async (empresa, nombre, tipo = "bodega") =>
    (
      await db.query(
        "insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id",
        [empresa, nombre, tipo]
      )
    ).rows[0].id

  const bodega = await ubicacion(a.empresa, "Bodega A")
  const tienda = await ubicacion(a.empresa, "Tienda A", "tienda")
  const bodegaB = await ubicacion(b.empresa, "Bodega B")

  const producto = async (empresa, codigo) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, $2, 'Cargador', 100, 10) returning id`,
        [empresa, codigo]
      )
    ).rows[0].id

  const cargador = await producto(a.empresa, "A-1")
  const ajeno = await producto(b.empresa, "B-1")

  await db.query("update usuarios set ubicacion_id = $1 where id = $2", [bodega, a.usuario])

  const vendedor = await crearVendedor(db, { empresa: a.empresa, ubicacion: tienda, permisos: ["pos"] })
  const catalogo = await crearVendedor(db, { empresa: a.empresa, permisos: ["products"] })
  const sucursales = await crearVendedor(db, { empresa: a.empresa, permisos: ["locations"] })
  const inactivo = await crearVendedor(db, {
    empresa: a.empresa,
    permisos: ["products", "locations"],
    activo: false,
  })

  return { a, b, bodega, tienda, bodegaB, cargador, ajeno, vendedor, catalogo, sucursales, inactivo }
}

const NUEVO_PRODUCTO = `insert into productos (empresa_id, codigo, nombre, precio, costo)
                       values ($1, $2, 'Nuevo', 50, 5) returning id`

// ── PRODUCTOS ─────────────────────────────────────────────

describe("SEC-3a productos: sin el permiso `products` no se escribe", () => {
  it("P1. un vendedor con solo `pos` no crea productos", async () => {
    const e = await escenario()

    await expect(como(e.vendedor.authId, NUEVO_PRODUCTO, [e.a.empresa, "V-1"])).rejects.toMatchObject(RECHAZO)
    expect(await contar(db, "productos", "codigo = 'V-1'")).toBe(0)
  })

  it("P2. tampoco cambia precios", async () => {
    const e = await escenario()

    await expect(
      como(e.vendedor.authId, "update productos set precio = 1 where id = $1", [e.cargador])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("productos", e.cargador)).precio).toBe("100.00")
  })

  it("P3. tampoco desactiva productos", async () => {
    const e = await escenario()

    await expect(
      como(e.vendedor.authId, "update productos set activo = false where id = $1", [e.cargador])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("productos", e.cargador)).activo).toBe(true)
  })

  it("P7. un usuario inactivo, aunque tenga `products`, no escribe", async () => {
    const e = await escenario()

    await expect(como(e.inactivo.authId, NUEVO_PRODUCTO, [e.a.empresa, "I-1"])).rejects.toMatchObject(RECHAZO)
  })

  it("P8. anon no escribe", async () => {
    const e = await escenario()

    await expect(como(null, NUEVO_PRODUCTO, [e.a.empresa, "N-1"])).rejects.toMatchObject(RECHAZO)
  })
})

describe("SEC-3a productos: con el permiso, se opera dentro de la empresa", () => {
  it("P4. quien tiene `products` crea, edita y desactiva productos de su empresa", async () => {
    const e = await escenario()

    const nuevo = (await como(e.catalogo.authId, NUEVO_PRODUCTO, [e.a.empresa, "C-1"])).rows[0].id
    await como(e.catalogo.authId, "update productos set precio = 75 where id = $1", [nuevo])
    await como(e.catalogo.authId, "update productos set activo = false where id = $1", [nuevo])

    const r = await fila("productos", nuevo)
    expect([r.precio, r.activo]).toEqual(["75.00", false])
  })

  it("P5. el administrador también", async () => {
    const e = await escenario()

    const nuevo = (await como(e.a.authId, NUEVO_PRODUCTO, [e.a.empresa, "AD-1"])).rows[0].id
    await como(e.a.authId, "update productos set precio = 60, activo = false where id = $1", [nuevo])

    const r = await fila("productos", nuevo)
    expect([r.precio, r.activo]).toEqual(["60.00", false])
  })

  it("P6. nadie de A escribe productos de B, ni se lleva uno a B", async () => {
    const e = await escenario()

    const cambio = await como(e.catalogo.authId, "update productos set precio = 1 where id = $1", [e.ajeno])
    expect(cambio.rowCount).toBe(0)
    expect((await fila("productos", e.ajeno)).precio).toBe("100.00")

    await expect(como(e.catalogo.authId, NUEVO_PRODUCTO, [e.b.empresa, "X-B"])).rejects.toMatchObject(RECHAZO)
    await expect(
      como(e.catalogo.authId, "update productos set empresa_id = $2 where id = $1", [e.cargador, e.b.empresa])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("productos", e.cargador)).empresa_id).toBe(e.a.empresa)
  })

  it("el vendedor sigue leyendo el catálogo de su empresa, y solo ese", async () => {
    const e = await escenario()

    const r = await como(e.vendedor.authId, "select id from productos")
    expect(r.rows.map((p) => p.id)).toEqual([e.cargador])
  })
})

describe("SEC-3a productos: no se borran, para no llevarse la historia", () => {
  it("P9. nadie autenticado borra un producto: ni el vendedor, ni `products`, ni el administrador", async () => {
    const e = await escenario()

    for (const authId of [e.vendedor.authId, e.catalogo.authId, e.a.authId]) {
      await expect(como(authId, "delete from productos where id = $1", [e.cargador])).rejects.toMatchObject(RECHAZO)
    }
    expect(await contar(db, "productos", "id = $1", [e.cargador])).toBe(1)
  })

  it("P10. el intento de borrado deja intactos libro, existencia, traslados y ventas", async () => {
    const e = await escenario()

    // Historia real, hecha por las funciones del sistema como el administrador.
    await como(e.a.authId, "select registrar_movimiento_ubicacion($1, $2, 'entrada', 20, 'apertura')", [e.cargador, e.bodega])
    await como(
      e.a.authId,
      "select registrar_traslado($1, $2, $3::jsonb, 'reposición', 'sec3a-t1')",
      [e.bodega, e.tienda, JSON.stringify([{ producto_id: e.cargador, cantidad: 5 }])]
    )
    await como(
      e.a.authId,
      "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', 'sec3a-v1')",
      [JSON.stringify([{ producto_id: e.cargador, cantidad: 2 }])]
    )

    const historia = async () => ({
      movimientos: await contar(db, "movimientos_inventario", "producto_id = $1", [e.cargador]),
      existencias: await contar(db, "inventario_ubicacion", "producto_id = $1", [e.cargador]),
      traslados: await contar(db, "traslado_detalle", "producto_id = $1", [e.cargador]),
      ventas: await contar(db, "detalle_venta", "producto_id = $1", [e.cargador]),
    })

    const antes = await historia()
    expect(antes).toEqual({ movimientos: 4, existencias: 2, traslados: 1, ventas: 1 })

    for (const authId of [e.vendedor.authId, e.a.authId]) {
      await expect(como(authId, "delete from productos where id = $1", [e.cargador])).rejects.toMatchObject(RECHAZO)
    }

    expect(await historia()).toEqual(antes)
  })

  it("los privilegios dicen lo mismo: alta y cambio sí, borrado no", async () => {
    const r = await db.query(`
      select has_table_privilege('authenticated', 'public.productos', 'SELECT') as lee,
             has_table_privilege('authenticated', 'public.productos', 'INSERT') as inserta,
             has_table_privilege('authenticated', 'public.productos', 'UPDATE') as actualiza,
             has_table_privilege('authenticated', 'public.productos', 'DELETE') as borra,
             has_table_privilege('anon', 'public.productos', 'DELETE') as anon_borra`)

    expect(r.rows[0]).toEqual({ lee: true, inserta: true, actualiza: true, borra: false, anon_borra: false })
  })

  it("quien tiene `products` sigue moviendo inventario por su función", async () => {
    const e = await escenario()

    await como(e.catalogo.authId, "select registrar_movimiento_ubicacion($1, $2, 'entrada', 3, 'compra')", [e.cargador, e.bodega])

    expect(await contar(db, "movimientos_inventario", "producto_id = $1", [e.cargador])).toBe(1)
  })
})

// ── UBICACIONES ───────────────────────────────────────────

const NUEVA_UBICACION = "insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, 'camion') returning id"

describe("SEC-3a ubicaciones: sin el permiso `locations` no se escribe", () => {
  it("U1. un vendedor con solo `pos` no crea ubicaciones", async () => {
    const e = await escenario()

    await expect(como(e.vendedor.authId, NUEVA_UBICACION, [e.a.empresa, "Camión pirata"])).rejects.toMatchObject(RECHAZO)
    expect(await contar(db, "ubicaciones", "nombre = 'Camión pirata'")).toBe(0)
  })

  it("U2. tampoco las modifica", async () => {
    const e = await escenario()

    await expect(
      como(e.vendedor.authId, "update ubicaciones set nombre = 'Otra' where id = $1", [e.tienda])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("ubicaciones", e.tienda)).nombre).toBe("Tienda A")
  })

  it("U10. inactivo, otra empresa y anon siguen fuera", async () => {
    const e = await escenario()

    await expect(como(e.inactivo.authId, NUEVA_UBICACION, [e.a.empresa, "Inactiva"])).rejects.toMatchObject(RECHAZO)
    await expect(como(null, NUEVA_UBICACION, [e.a.empresa, "Anónima"])).rejects.toMatchObject(RECHAZO)

    const cruzado = await como(e.sucursales.authId, "update ubicaciones set nombre = 'x' where id = $1", [e.bodegaB])
    expect(cruzado.rowCount).toBe(0)
    expect((await fila("ubicaciones", e.bodegaB)).nombre).toBe("Bodega B")
  })
})

describe("SEC-3a ubicaciones: con `locations`, lo ordinario; lo fiscal, solo el administrador", () => {
  it("U3. quien tiene `locations` crea, renombra, cambia el tipo y desactiva", async () => {
    const e = await escenario()

    const nueva = (await como(e.sucursales.authId, NUEVA_UBICACION, [e.a.empresa, "Camión 02"])).rows[0].id
    await como(e.sucursales.authId, "update ubicaciones set nombre = 'Camión 03', tipo = 'otro' where id = $1", [nueva])
    await como(e.sucursales.authId, "update ubicaciones set activa = false where id = $1", [nueva])

    const r = await fila("ubicaciones", nueva)
    expect([r.nombre, r.tipo, r.activa, r.vende, r.emite_fiscal]).toEqual(["Camión 03", "otro", false, true, false])
  })

  it("U4. con `locations` no se marca una ubicación como fiscal", async () => {
    const e = await escenario()

    await expect(
      como(e.sucursales.authId, "update ubicaciones set emite_fiscal = true where id = $1", [e.tienda])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("ubicaciones", e.tienda)).emite_fiscal).toBe(false)
  })

  it("U5. con `locations` no se cambia si vende", async () => {
    const e = await escenario()

    await expect(
      como(e.sucursales.authId, "update ubicaciones set vende = false where id = $1", [e.bodega])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("ubicaciones", e.bodega)).vende).toBe(true)
  })

  it("U4b. tampoco se crea una ubicación ya fiscal o que no vende", async () => {
    const e = await escenario()

    await expect(
      como(e.sucursales.authId, "insert into ubicaciones (empresa_id, nombre, tipo, emite_fiscal) values ($1, 'Fiscal', 'tienda', true)", [e.a.empresa])
    ).rejects.toMatchObject(RECHAZO)
    await expect(
      como(e.sucursales.authId, "insert into ubicaciones (empresa_id, nombre, tipo, vende) values ($1, 'Sin venta', 'bodega', false)", [e.a.empresa])
    ).rejects.toMatchObject(RECHAZO)
    expect(await contar(db, "ubicaciones", "nombre in ('Fiscal', 'Sin venta')")).toBe(0)
  })

  it("U6. el administrador sí marca fiscal, quita la venta y crea con valores explícitos", async () => {
    const e = await escenario()

    await como(e.a.authId, "update ubicaciones set emite_fiscal = true where id = $1", [e.tienda])
    await como(e.a.authId, "update ubicaciones set vende = false where id = $1", [e.bodega])
    const nueva = (
      await como(e.a.authId, "insert into ubicaciones (empresa_id, nombre, tipo, vende) values ($1, 'Depósito', 'bodega', false) returning id", [e.a.empresa])
    ).rows[0].id

    expect((await fila("ubicaciones", e.tienda)).emite_fiscal).toBe(true)
    expect((await fila("ubicaciones", e.bodega)).vende).toBe(false)
    expect((await fila("ubicaciones", nueva)).vende).toBe(false)
  })

  it("las migraciones, como dueño de la base, siguen pudiendo fijar lo fiscal", async () => {
    const e = await escenario()

    await db.query("update ubicaciones set emite_fiscal = true where id = $1", [e.tienda])

    expect((await fila("ubicaciones", e.tienda)).emite_fiscal).toBe(true)
  })

  it("U7. no se lleva una ubicación a otra empresa", async () => {
    const e = await escenario()

    await expect(
      como(e.sucursales.authId, "update ubicaciones set empresa_id = $2 where id = $1", [e.tienda, e.b.empresa])
    ).rejects.toMatchObject(RECHAZO)
    expect((await fila("ubicaciones", e.tienda)).empresa_id).toBe(e.a.empresa)
  })

  it("U8. nadie autenticado borra una ubicación, ni el administrador", async () => {
    const e = await escenario()
    const vacia = (await db.query(NUEVA_UBICACION, [e.a.empresa, "Vacía"])).rows[0].id

    for (const authId of [e.vendedor.authId, e.sucursales.authId, e.a.authId]) {
      await expect(como(authId, "delete from ubicaciones where id = $1", [vacia])).rejects.toMatchObject(RECHAZO)
    }
    expect(await contar(db, "ubicaciones", "id = $1", [vacia])).toBe(1)
  })

  it("U9. sigue sin poder desactivarse la ubicación desde la que alguien opera", async () => {
    const e = await escenario()

    await expect(
      como(e.sucursales.authId, "update ubicaciones set activa = false where id = $1", [e.tienda])
    ).rejects.toMatchObject({ code: "P0001" })
    expect((await fila("ubicaciones", e.tienda)).activa).toBe(true)
  })

  it("el vendedor sigue leyendo las ubicaciones de su empresa, y solo esas", async () => {
    const e = await escenario()

    const r = await como(e.vendedor.authId, "select id from ubicaciones order by nombre")
    expect(r.rows.map((u) => u.id).sort()).toEqual([e.bodega, e.tienda].sort())
  })
})

/*
  El disparador que impide desactivar una ubicación operativa contaba los
  usuarios con la RLS de quien desactivaba. Un no administrador solo ve su
  propia fila, así que contaba cero y la desactivación pasaba.
*/
describe("SEC-3a: la ubicación desde la que alguien opera no se desactiva, la desactive quien la desactive", () => {
  const desactivar = (authId, id) => como(authId, "update ubicaciones set activa = false where id = $1", [id])

  it("T1. el administrador no la desactiva", async () => {
    const e = await escenario()

    await expect(desactivar(e.a.authId, e.tienda)).rejects.toMatchObject({ code: "P0001" })
    expect((await fila("ubicaciones", e.tienda)).activa).toBe(true)
  })

  it("T2. quien tiene `locations` tampoco, aunque no vea a los otros usuarios", async () => {
    const e = await escenario()

    await expect(desactivar(e.sucursales.authId, e.tienda)).rejects.toMatchObject({ code: "P0001" })
    expect((await fila("ubicaciones", e.tienda)).activa).toBe(true)
  })

  it("T3. quien tiene `locations` sí desactiva una ubicación sin usuarios", async () => {
    const e = await escenario()
    const vacia = (await db.query(NUEVA_UBICACION, [e.a.empresa, "Sin nadie"])).rows[0].id

    await desactivar(e.sucursales.authId, vacia)

    expect((await fila("ubicaciones", vacia)).activa).toBe(false)
  })

  it("T4. sin `locations` no se desactiva nada, ni siquiera una vacía", async () => {
    const e = await escenario()
    const vacia = (await db.query(NUEVA_UBICACION, [e.a.empresa, "Sin nadie"])).rows[0].id

    await expect(desactivar(e.vendedor.authId, vacia)).rejects.toMatchObject(RECHAZO)
    expect((await fila("ubicaciones", vacia)).activa).toBe(true)
  })

  it("T5. ni otra empresa ni un usuario inactivo la desactivan", async () => {
    const e = await escenario()

    const ajeno = await desactivar(e.sucursales.authId, e.bodegaB)
    expect(ajeno.rowCount).toBe(0)
    expect((await fila("ubicaciones", e.bodegaB)).activa).toBe(true)

    const inactivo = await desactivar(e.inactivo.authId, e.tienda)
    expect(inactivo.rowCount).toBe(0)
    expect((await fila("ubicaciones", e.tienda)).activa).toBe(true)
  })

  it("T6. el disparador corre como su dueño, con search_path vacío, y nadie de la aplicación lo ejecuta directo", async () => {
    const r = await db.query(`
      select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as dueno,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado,
             coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as publico
        from pg_proc p where p.oid = 'public.ubicaciones_no_desactivar_operativa()'::regprocedure`)

    expect(r.rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=""'],
      dueno: "postgres",
      anon: false,
      autenticado: false,
      publico: false,
    })
  })
})

describe("SEC-3a: el disparador de lo fiscal no corre con privilegios de nadie más", () => {
  it("es SECURITY INVOKER, con search_path vacío, y nadie de la aplicación lo ejecuta directo", async () => {
    const r = await db.query(`
      select p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado,
             coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as publico
        from pg_proc p where p.proname = 'ubicaciones_fiscal_solo_admin'`)

    expect(r.rows).toEqual([
      { prosecdef: false, proconfig: ['search_path=""'], anon: false, autenticado: false, publico: false },
    ])
  })
})

describe("SEC-3a: las políticas quedan separadas por operación", () => {
  it("productos y ubicaciones ya no tienen una política para todo", async () => {
    const r = await db.query(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and tablename in ('productos', 'ubicaciones')
        order by tablename, cmd, policyname`
    )

    expect(r.rows.map((p) => `${p.tablename}:${p.cmd}`)).toEqual([
      "productos:INSERT",
      "productos:SELECT",
      "productos:UPDATE",
      "ubicaciones:INSERT",
      "ubicaciones:SELECT",
      "ubicaciones:UPDATE",
    ])
  })
})
