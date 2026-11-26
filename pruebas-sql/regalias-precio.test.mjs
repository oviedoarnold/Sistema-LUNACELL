/*
  0055 contra PostgreSQL de verdad: el precio de venta de cada regalía y su
  valor comercial en el reporte.

  Bodega vende el Cargador (L 100, costo 37), el Vidrio (L 50, costo 0) y la
  Muestra (L 0, costo 5), con ISV 15 %. Ruta local es otra ubicación de la
  misma empresa. Nada sale de producción: todo se inventa aquí.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"

import { usarBaseDePrueba, num, falla, empresaConTresUbicaciones } from "./ayudantes.mjs"
import { crearVendedor } from "./fixtures.mjs"

let db

const { como, fila } = usarBaseDePrueba((levantada) => {
  db = levantada.admin
})

const PRECIOS = {}

async function producto(e, nombre, precio, costo, existencias) {
  const id = (
    await db.query("insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, $3, $4, $5) returning id", [
      e.empresa,
      `P-${randomUUID().slice(0, 8)}`,
      nombre,
      precio,
      costo,
    ])
  ).rows[0].id

  for (const [ubicacion, cantidad] of existencias) {
    await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, $4)", [e.empresa, ubicacion, id, cantidad])
  }

  PRECIOS[id] = precio

  return id
}

async function escenario() {
  const e = await empresaConTresUbicaciones(db, { nombre: "Lunacell Precio de regalías", tasaIsv: 15, existencia: 50, nombreCliente: "Cliente P" })

  await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 50)", [e.empresa, e.ruta, e.cargador])
  PRECIOS[e.cargador] = 100

  const vidrio = await producto(e, "Vidrio privado", 50, 0, [[e.bodega, 30], [e.ruta, 30]])
  const muestra = await producto(e, "Muestra", 0, 5, [[e.bodega, 10]])

  return {
    ...e,
    vidrio,
    muestra,
    deBodega: await e.vendedor(e.bodega, ["pos", "sales-history", "regalias"]),
    deRuta: await e.vendedor(e.ruta, ["pos", "sales-history", "regalias"]),
  }
}

const lista = (pares) => JSON.stringify(pares.map(([producto_id, cantidad]) => ({ producto_id, cantidad })))
const totalDe = (items) => Math.round(items.reduce((s, [p, c]) => s + PRECIOS[p] * c, 0) * 115) / 100

const regalar = (quien, e, { items = [[e.cargador, 1]], regalias = [[e.cargador, 1]] } = {}) =>
  fila(
    quien.authId,
    `select public.registrar_venta_con_regalias(
       p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb, p_regalias => $3::jsonb,
       p_motivo_regalia => 'cortesia_comercial', p_cliente_id => $4, p_clave_idempotencia => $5) as r`,
    [lista(items), JSON.stringify([{ medio: "efectivo", monto: totalDe(items), referencia: "" }]), lista(regalias), e.cliente, randomUUID()]
  )

const precios = async (venta) =>
  Object.fromEntries((await db.query("select producto_id, precio_unitario from regalias_venta where venta_id = $1", [venta])).rows.map((r) => [r.producto_id, r.precio_unitario]))

const reporte = async (authId, ubicacion = null) =>
  (await como(authId, "select * from public.reporte_de_regalias(p_ubicacion => $1) order by producto, ubicacion", [ubicacion])).rows

async function contador(e) {
  const c = await crearVendedor(db, { empresa: e.empresa, permisos: ["sales-history"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [c.usuario])

  return c
}

describe("0055: el precio de cada regalía", () => {
  it("guarda el precio general del catálogo, con costo o sin él, de una o varias unidades", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { regalias: [[e.cargador, 1], [e.vidrio, 3]] })

    expect(await precios(v.venta_id)).toEqual({ [e.cargador]: "100.00", [e.vidrio]: "50.00" })
  })

  it("un precio de catálogo en cero queda en 0.00, no vacío", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { regalias: [[e.muestra, 2]] })

    expect(await precios(v.venta_id)).toEqual({ [e.muestra]: "0.00" })
  })

  it("cambiar después el precio del catálogo no cambia el de lo ya entregado", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { regalias: [[e.vidrio, 1]] })

    await db.query("update productos set precio = 75 where id = $1", [e.vidrio])
    expect(await precios(v.venta_id)).toEqual({ [e.vidrio]: "50.00" })

    PRECIOS[e.vidrio] = 75
    const despues = await regalar(e.deBodega, e, { regalias: [[e.vidrio, 1]] })
    expect(await precios(despues.venta_id)).toEqual({ [e.vidrio]: "75.00" })
  })

  it("el precio lo decide la base: uno escrito a mano en la fila se reemplaza", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { regalias: [[e.vidrio, 1]] })

    await db.query(
      `insert into regalias_venta (empresa_id, venta_id, cliente_id, producto_id, nombre, cantidad, ubicacion_id, usuario_id, usuario_nombre, motivo, costo_unitario, precio_unitario)
       select empresa_id, venta_id, cliente_id, $2, 'Cargador', 1, ubicacion_id, usuario_id, usuario_nombre, motivo, 37, 999
         from regalias_venta where venta_id = $1`,
      [v.venta_id, e.cargador]
    )

    expect(await precios(v.venta_id)).toEqual({ [e.vidrio]: "50.00", [e.cargador]: "100.00" })
  })

  it("la venta, su ISV, sus cobros y el inventario no cambian por el precio", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { items: [[e.cargador, 2]], regalias: [[e.vidrio, 2]] })
    const venta = (await db.query("select subtotal, isv, total, estado from ventas where id = $1", [v.venta_id])).rows[0]
    const existencia = async (producto) =>
      Number((await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [e.bodega, producto])).rows[0].cantidad)

    expect([num(venta.subtotal), num(venta.isv), num(venta.total), venta.estado]).toEqual([200, 30, 230, "pagada"])
    expect(num((await db.query("select sum(monto + cargo) as s from cobros_por_medio where venta_id = $1", [v.venta_id])).rows[0].s)).toBe(230)
    expect([await existencia(e.cargador), await existencia(e.vidrio)]).toEqual([48, 28])
    expect(
      (await db.query("select tipo, cantidad::int from movimientos_inventario where venta_id = $1 order by tipo, producto_id", [v.venta_id])).rows
    ).toEqual([
      { tipo: "regalia", cantidad: -2 },
      { tipo: "salida", cantidad: -2 },
    ])
  })
})

describe("0055: protección del precio y del registro", () => {
  it("la API no lee la columna nueva ni el costo; el registro sigue sin modificarse ni borrarse", async () => {
    const e = await escenario()
    const c = await contador(e)
    const v = await regalar(e.deBodega, e)

    for (const authId of [e.deBodega.authId, c.authId, e.admin.authId]) {
      for (const consulta of ["select precio_unitario from regalias_venta", "select costo_unitario from regalias_venta", "select * from regalias_venta"]) {
        expect([authId, consulta, (await falla(como(authId, consulta))).code]).toEqual([authId, consulta, "42501"])
      }
    }

    expect((await como(e.deBodega.authId, "select id from regalias_venta where venta_id = $1", [v.venta_id])).rows).toHaveLength(1)
    expect((await falla(db.query("update regalias_venta set precio_unitario = 1 where venta_id = $1", [v.venta_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from regalias_venta where venta_id = $1", [v.venta_id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "update regalias_venta set precio_unitario = 1"))).code).toBe("42501")
  })

  it("el disparador no se ejecuta desde la API, y el reporte no lo ve anon", async () => {
    const privilegios = (
      await db.query(`select has_function_privilege('authenticated', 'public.precio_de_la_regalia()', 'EXECUTE') as auth_disparador,
                             has_function_privilege('anon', 'public.precio_de_la_regalia()', 'EXECUTE') as anon_disparador,
                             has_function_privilege('authenticated', 'public.reporte_de_regalias(date, date, uuid)', 'EXECUTE') as auth_reporte,
                             has_function_privilege('anon', 'public.reporte_de_regalias(date, date, uuid)', 'EXECUTE') as anon_reporte,
                             (select prosecdef from pg_proc where oid = 'public.reporte_de_regalias(date, date, uuid)'::regprocedure) as definer,
                             (select proconfig from pg_proc where oid = 'public.reporte_de_regalias(date, date, uuid)'::regprocedure) as config,
                             (select provolatile from pg_proc where oid = 'public.reporte_de_regalias(date, date, uuid)'::regprocedure) as volatilidad`)
    ).rows[0]

    expect(privilegios).toEqual({
      auth_disparador: false,
      anon_disparador: false,
      auth_reporte: true,
      anon_reporte: false,
      definer: true,
      config: ["search_path=\"\""],
      volatilidad: "s",
    })
    expect((await falla(como(null, "select * from public.reporte_de_regalias()"))).code).toBe("42501")
  })
})

describe("0055: el reporte con precio y valor comercial", () => {
  it("el administrador ve costo, precio y valor; el contador y el vendedor, precio y valor sin costo", async () => {
    const e = await escenario()
    const c = await contador(e)

    await regalar(e.deBodega, e, { regalias: [[e.cargador, 2], [e.vidrio, 1]] })

    expect((await reporte(e.admin.authId)).map((r) => [r.producto, r.cantidad, num(r.costo_unitario), num(r.precio_unitario), num(r.valor_comercial)])).toEqual([
      ["Cargador", 2, 37, 100, 200],
      ["Vidrio privado", 1, 0, 50, 50],
    ])

    for (const authId of [c.authId, e.deBodega.authId]) {
      expect((await reporte(authId)).map((r) => [r.producto, r.costo_unitario, r.costo_total, num(r.precio_unitario), num(r.valor_comercial)])).toEqual([
        ["Cargador", null, null, 100, 200],
        ["Vidrio privado", null, null, 50, 50],
      ])
    }
  })

  it("distingue un precio en cero (valor 0.00) de uno sin registrar (nulo)", async () => {
    const e = await escenario()
    const v = await regalar(e.deBodega, e, { regalias: [[e.muestra, 3]] })

    // Una regalía de antes de la 0055, sin precio: se simula guardándola sin el disparador nuevo.
    await db.query("alter table regalias_venta disable trigger regalias_venta_precio")
    await db.query(
      `insert into regalias_venta (empresa_id, venta_id, cliente_id, producto_id, nombre, cantidad, ubicacion_id, usuario_id, usuario_nombre, motivo, costo_unitario)
       select empresa_id, venta_id, cliente_id, $2, 'Cargador', 1, ubicacion_id, usuario_id, usuario_nombre, motivo, 37
         from regalias_venta where venta_id = $1`,
      [v.venta_id, e.cargador]
    )
    await db.query("alter table regalias_venta enable trigger regalias_venta_precio")

    expect((await reporte(e.admin.authId)).map((r) => [r.producto, r.precio_unitario, r.valor_comercial])).toEqual([
      ["Cargador", null, null],
      ["Muestra", "0.00", "0.00"],
    ])
  })

  it("filtra por ubicación: cada fila con su precio, y el vendedor solo ve la suya", async () => {
    const e = await escenario()

    await regalar(e.deBodega, e, { regalias: [[e.vidrio, 2]] })
    await regalar(e.deRuta, e, { regalias: [[e.vidrio, 1], [e.cargador, 1]] })

    const valores = (filas) => filas.map((r) => [r.producto, r.ubicacion, r.cantidad, num(r.valor_comercial)])

    expect(valores(await reporte(e.admin.authId))).toEqual([
      ["Cargador", "Ruta local", 1, 100],
      ["Vidrio privado", "Bodega", 2, 100],
      ["Vidrio privado", "Ruta local", 1, 50],
    ])
    expect(valores(await reporte(e.admin.authId, e.ruta))).toEqual([
      ["Cargador", "Ruta local", 1, 100],
      ["Vidrio privado", "Ruta local", 1, 50],
    ])
    expect(valores(await reporte(e.deBodega.authId))).toEqual([["Vidrio privado", "Bodega", 2, 100]])
  })

  it("filtra por fechas, y un período sin regalías no devuelve filas", async () => {
    const e = await escenario()

    await regalar(e.deBodega, e, { regalias: [[e.vidrio, 1]] })

    const hoy = (await db.query("select (now() at time zone 'America/Tegucigalpa')::date::text as d")).rows[0].d
    const entre = async (desde, hasta) =>
      (await como(e.admin.authId, "select producto from public.reporte_de_regalias($1::date, $2::date)", [desde, hasta])).rows.map((r) => r.producto)

    expect(await entre(hoy, hoy)).toEqual(["Vidrio privado"])
    expect(await entre("2020-01-01", "2020-01-31")).toEqual([])
  })
})
