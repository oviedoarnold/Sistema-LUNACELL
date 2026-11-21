/*
  0053: número visible del traslado, contra PostgreSQL de verdad.

  Se aplica sobre una base con la 0052 y traslados de dos empresas, como
  llega a producción. Los traslados de antes se numeran por empresa y por
  fecha sin cambiar nada más; los nuevos toman el siguiente número, dos
  simultáneos no lo repiten, y un rechazo o un reintento no lo gastan.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, comoUsuario, comoDueno, enDosSesiones } from "./arnes.mjs"
import { crearEmpresa } from "./fixtures.mjs"
import { firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const MIGRACION = "0053_numero_de_traslado.sql"

let base
let db

async function como(authId, sql, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(sql, valores)
  } finally {
    await comoDueno(db)
  }
}

const SQL_TRASLADO = "select registrar_traslado($1, $2, $3::jsonb, $4, $5) as res"

const argumentos = ({ origen, destino, items, nota = "", clave = null }) => [
  origen,
  destino,
  JSON.stringify(items.map(([producto_id, cantidad]) => ({ producto_id, cantidad }))),
  nota,
  clave,
]

const trasladar = async (e, datos) => (await como(e.authId, SQL_TRASLADO, argumentos(datos))).rows[0].res

// Una empresa con bodega, tienda, dos productos y existencia en la bodega.
async function empresaConBodega() {
  const { empresa, authId } = await crearEmpresa(db)

  const ubicaciones = await db.query(
    `insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Bodega', 'bodega'), ($1, 'Tienda', 'tienda')
     returning id, nombre`,
    [empresa]
  )
  const productos = await db.query(
    `insert into productos (empresa_id, codigo, nombre, precio, costo)
     select $1, 'N-' || substr(md5(random()::text), 1, 8), x, 100, 10 from unnest(array['Cargador', 'Cubo']) x
     returning id, nombre`,
    [empresa]
  )

  const id = (filas, nombre) => filas.rows.find((f) => f.nombre === nombre).id
  const e = {
    empresa,
    authId,
    bodega: id(ubicaciones, "Bodega"),
    tienda: id(ubicaciones, "Tienda"),
    cargador: id(productos, "Cargador"),
    cubo: id(productos, "Cubo"),
  }

  for (const producto of [e.cargador, e.cubo]) {
    await como(authId, "select registrar_movimiento_ubicacion($1, $2, 'entrada', 100)", [producto, e.bodega])
  }

  return e
}

const numerosDe = async (empresa) =>
  (await db.query("select numero, nota from traslados where empresa_id = $1 order by correlativo", [empresa])).rows

const foto = async () => ({
  traslados: (await db.query("select id, empresa_id, origen_id, destino_id, usuario_id, estado, nota, clave_idempotencia, creado_en from traslados order by id")).rows,
  detalle: (await db.query("select * from traslado_detalle order by traslado_id, producto_id")).rows,
  inventario: (await db.query("select * from inventario_ubicacion order by ubicacion_id, producto_id")).rows,
  movimientos: (await db.query("select * from movimientos_inventario order by id")).rows,
})

let a
let b
let antes
let cuerpoAntes

beforeAll(async () => {
  base = await levantarBase({ hasta: "0052_devoluciones_ventas_y_ajustes_credito.sql" })
  db = base.admin

  a = await empresaConBodega()
  b = await empresaConBodega()

  await trasladar(a, { origen: a.bodega, destino: a.tienda, items: [[a.cargador, 1]], nota: "A primero" })
  await trasladar(a, { origen: a.bodega, destino: a.tienda, items: [[a.cubo, 2]], nota: "A segundo" })
  await trasladar(a, { origen: a.tienda, destino: a.bodega, items: [[a.cargador, 1]], nota: "A el más antiguo" })
  await trasladar(b, { origen: b.bodega, destino: b.tienda, items: [[b.cargador, 5]], nota: "B único" })

  // El último registrado lleva la fecha más antigua: se numera por fecha, no por orden de inserción.
  await db.query("update traslados set creado_en = creado_en - interval '1 day' where nota = 'A el más antiguo'")

  antes = await foto()
  cuerpoAntes = await cuerpoDe(db, await firmaDe(db, "registrar_traslado"))

  await aplicarMigracion(db, MIGRACION)
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

describe("la 0053 sobre traslados que ya existen", () => {
  it("numera los de cada empresa desde TR-000001, del más antiguo al más reciente", async () => {
    expect(await numerosDe(a.empresa)).toEqual([
      { numero: "TR-000001", nota: "A el más antiguo" },
      { numero: "TR-000002", nota: "A primero" },
      { numero: "TR-000003", nota: "A segundo" },
    ])
    expect(await numerosDe(b.empresa)).toEqual([{ numero: "TR-000001", nota: "B único" }])
  })

  it("no cambia nada más: traslados, detalle, existencias, libro ni registrar_traslado", async () => {
    expect(await foto()).toEqual(antes)
    expect(await cuerpoDe(db, await firmaDe(db, "registrar_traslado"))).toBe(cuerpoAntes)
  })

  it("aplicarla otra vez no renumera ni cambia nada", async () => {
    await aplicarMigracion(db, MIGRACION)

    expect(await foto()).toEqual(antes)
    expect((await numerosDe(a.empresa)).map((t) => t.numero)).toEqual(["TR-000001", "TR-000002", "TR-000003"])
  })

  it("quien ve el traslado lee su número", async () => {
    const r = await como(a.authId, "select numero from traslados order by correlativo")

    expect(r.rows.map((t) => t.numero)).toEqual(["TR-000001", "TR-000002", "TR-000003"])
  })
})

describe("los traslados nuevos", () => {
  it("toman el siguiente número de su empresa; la otra empresa sigue con el suyo", async () => {
    const nuevo = await trasladar(a, { origen: a.bodega, destino: a.tienda, items: [[a.cargador, 1]], nota: "A cuarto" })
    await trasladar(b, { origen: b.bodega, destino: b.tienda, items: [[b.cubo, 1]], nota: "B segundo" })

    // registrar_traslado responde lo mismo que antes.
    expect(Object.keys(nuevo).sort()).toEqual(["destino_id", "estado", "items", "origen_id", "repetida", "traslado_id"])
    expect((await numerosDe(a.empresa)).at(-1)).toEqual({ numero: "TR-000004", nota: "A cuarto" })
    expect((await numerosDe(b.empresa)).at(-1)).toEqual({ numero: "TR-000002", nota: "B segundo" })
  })

  it("un reintento con la misma clave y un traslado rechazado no gastan número", async () => {
    const datos = { origen: a.bodega, destino: a.tienda, items: [[a.cubo, 1]], nota: "A quinto", clave: "clave-0053" }
    const primero = await trasladar(a, datos)
    const reintento = await trasladar(a, datos)

    expect(reintento.traslado_id).toBe(primero.traslado_id)
    expect(reintento.repetida).toBe(true)

    await expect(
      trasladar(a, { origen: a.bodega, destino: a.tienda, items: [[a.cubo, 100000]], nota: "No alcanza" })
    ).rejects.toMatchObject({ code: "LT005" })

    await trasladar(a, { origen: a.bodega, destino: a.tienda, items: [[a.cargador, 1]], nota: "A sexto" })

    expect((await numerosDe(a.empresa)).slice(-2)).toEqual([
      { numero: "TR-000005", nota: "A quinto" },
      { numero: "TR-000006", nota: "A sexto" },
    ])
  })

  it("dos traslados simultáneos de la misma empresa no repiten número: el segundo espera al primero", async () => {
    const enSesion = (datos) => (sesion) => sesion.query(SQL_TRASLADO, argumentos(datos))

    const { respuesta, error, espera } = await enDosSesiones(base, db, {
      primera: { authId: a.authId, hacer: enSesion({ origen: a.bodega, destino: a.tienda, items: [[a.cargador, 1]], nota: "Simultáneo 1" }) },
      segunda: { authId: a.authId, hacer: enSesion({ origen: a.tienda, destino: a.bodega, items: [[a.cubo, 1]], nota: "Simultáneo 2" }) },
    })

    expect(error).toBeUndefined()
    expect(respuesta.rows[0].res.traslado_id).toBeTruthy()
    // Espera en el candado del número, no en las celdas: los dos traslados mueven productos distintos.
    expect(espera).toBe("Lock/advisory")
    expect((await numerosDe(a.empresa)).slice(-2)).toEqual([
      { numero: "TR-000007", nota: "Simultáneo 1" },
      { numero: "TR-000008", nota: "Simultáneo 2" },
    ])
  })

  it("el número no se puede cambiar, ni siquiera por el dueño de la base", async () => {
    await expect(
      db.query("update traslados set correlativo = 99, numero = 'TR-000099' where empresa_id = $1 and correlativo = 1", [a.empresa])
    ).rejects.toMatchObject({ code: "42501" })

    // La nota y lo demás siguen como estaban: la prueba no las tocó.
    expect((await numerosDe(a.empresa))[0]).toEqual({ numero: "TR-000001", nota: "A el más antiguo" })
  })

  it("la aplicación no puede escribir la tabla ni ejecutar las funciones de los disparadores", async () => {
    await expect(
      como(a.authId, "update traslados set nota = 'x' where empresa_id = $1", [a.empresa])
    ).rejects.toMatchObject({ code: "42501" })

    const ejecutables = await db.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p
        where p.proname in ('asignar_numero_de_traslado', 'numero_de_traslado_inmutable')
        order by p.proname`
    )

    expect(ejecutables.rows).toEqual([
      { proname: "asignar_numero_de_traslado", authenticated: false, anon: false },
      { proname: "numero_de_traslado_inmutable", authenticated: false, anon: false },
    ])
  })
})
