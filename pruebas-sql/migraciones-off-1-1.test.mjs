/*
  OFF-1.1: las migraciones 0027, 0028 y 0029 aplicadas en orden sobre una
  base que ya tiene datos, como llegarán a producción.

  La base se levanta solo hasta la 0026 —el esquema que hoy tiene
  producción—, se cargan ventas, cobros, existencias y movimientos con las
  funciones de siempre, y después se aplican las tres. Se comprueba que:
  - se aplican en orden y se pueden volver a aplicar sin error;
  - ningún dato existente cambia (cada columna que ya existía, fila por
    fila);
  - las ventas existentes quedan en_linea y ninguna ubicación vende sin
    conexión;
  - registrar_venta_ubicacion no cambia.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, crearCliente, crearFactura } from "./fixtures.mjs"

const NUEVAS = [
  "0027_recepcion_de_ventas_sin_conexion.sql",
  "0028_conciliacion_de_ventas.sql",
  "0029_historial_y_cobros_por_ubicacion.sql",
]

const TABLAS = [
  "empresas", "usuarios", "permisos_usuario", "ubicaciones", "productos", "clientes",
  "inventario_ubicacion", "movimientos_inventario", "ventas", "detalle_venta",
  "pagos", "abonos", "cotizaciones", "detalle_cotizacion",
]

let base
let db
let columnasPrevias
let huellasPrevias
let funcionVentaPrevia

/* Cada tabla resumida en un md5, solo con las columnas que tenía antes. */
async function huellas(columnasPorTabla) {
  const resultado = {}

  for (const [tabla, columnas] of Object.entries(columnasPorTabla)) {
    const fila = `row(${columnas.map((c) => `"${c}"`).join(", ")})::text`
    const r = await db.query(`select count(*)::int as n, md5(coalesce(string_agg(${fila}, '|' order by ${fila}), '')) as h from public.${tabla}`)
    resultado[tabla] = r.rows[0]
  }

  return resultado
}

const md5DeLaVenta = async () =>
  (await db.query("select md5(prosrc) as m from pg_proc where oid = 'public.registrar_venta_ubicacion'::regproc")).rows[0].m

beforeAll(async () => {
  base = await levantarBase({ hasta: "0026_usuarios_acceso_por_nombre.sql" })
  db = base.admin

  // Datos como los de producción: ventas en línea, una histórica sin ubicación, un cobro.
  const { empresa, authId: adminAuth } = await crearEmpresa(db, "Antes de OFF-1.1")
  const ubicacion = async (nombre, tipo) =>
    (await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id", [empresa, nombre, tipo])).rows[0].id
  const camion = await ubicacion("Camión 01", "camion")
  await ubicacion("Camión 02", "camion")
  await ubicacion("Bodega", "bodega")
  await ubicacion("Store", "tienda")

  const producto = (await db.query(
    "insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, 'P-1', 'Cargador', 100, 10) returning id",
    [empresa]
  )).rows[0].id
  await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 10)", [empresa, camion, producto])
  const clienteId = await crearCliente(db, empresa)
  const vendedor = await crearVendedor(db, { empresa, ubicacion: camion, permisos: ["pos", "sales-history"] })

  const vender = (forma) =>
    consultarComo(db, vendedor.authId, "select registrar_venta_ubicacion($1::jsonb, $2, $3) as r", [
      JSON.stringify([{ producto_id: producto, cantidad: 1 }]),
      forma,
      forma === "credito" ? clienteId : null,
    ])
  await vender("contado")
  await vender("credito")
  await crearFactura(db, { empresa, clienteId, total: 50 })
  await consultarComo(db, adminAuth, "select registrar_pago_cliente($1, 60)", [clienteId])

  columnasPrevias = {}
  for (const tabla of TABLAS) {
    const r = await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
      [tabla]
    )
    columnasPrevias[tabla] = r.rows.map((f) => f.column_name)
  }

  huellasPrevias = await huellas(columnasPrevias)
  funcionVentaPrevia = await md5DeLaVenta()

  for (const archivo of NUEVAS) await aplicarMigracion(db, archivo)
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

describe("0027, 0028 y 0029 sobre datos existentes", () => {
  it("1. hay datos de verdad antes de aplicarlas", () => {
    expect(huellasPrevias.ventas.n).toBe(3)
    expect(huellasPrevias.pagos.n).toBe(1)
    expect(huellasPrevias.abonos.n).toBeGreaterThan(0)
    expect(huellasPrevias.movimientos_inventario.n).toBeGreaterThan(0)
  })

  it("2. ningún dato existente cambia", async () => {
    expect(await huellas(columnasPrevias)).toEqual(huellasPrevias)
  })

  it("3. las ventas existentes quedan en línea, sin datos del modo sin conexión", async () => {
    const r = await db.query(
      `select count(*) filter (where origen <> 'en_linea' or dispositivo is not null or registrada_en is not null
                                  or desfase_segundos is not null or huella_origen is not null)::int as raras
         from ventas`
    )

    expect(r.rows[0].raras).toBe(0)
  })

  it("4. ninguna ubicación vende sin conexión y los pagos existentes no tienen ubicación", async () => {
    const u = await db.query("select count(*) filter (where vende_sin_conexion)::int as n, count(*)::int as total from ubicaciones")
    const p = await db.query("select count(*) filter (where ubicacion_id is not null)::int as n from pagos")

    expect(u.rows[0]).toEqual({ n: 0, total: 4 })
    expect(p.rows[0].n).toBe(0)
  })

  it("5. registrar_venta_ubicacion no cambia", async () => {
    expect(await md5DeLaVenta()).toBe(funcionVentaPrevia)
  })

  it("6. se pueden volver a aplicar sin error y sin cambiar nada", async () => {
    for (const archivo of NUEVAS) await aplicarMigracion(db, archivo)

    expect(await huellas(columnasPrevias)).toEqual(huellasPrevias)
  })
})
