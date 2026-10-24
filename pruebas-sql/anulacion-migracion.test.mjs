/*
  A-5: la migración 0033 sobre una base que ya tiene datos, que es como
  llega a producción.

  Se levanta la base hasta la 0032, se cargan usuarios con permisos, ventas
  y movimientos, y se aplica la 0033 encima. No puede cambiar nada de lo
  que había ni darle a nadie el permiso de anular.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { levantarBase, aplicarMigracion } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db
let antes
let esc

const foto = async () => ({
  permisos: (await db.query("select usuario_id, seccion from permisos_usuario order by usuario_id, seccion")).rows,
  ventas: (await db.query("select id, estado, numero_factura, correlativo, total from ventas order by id")).rows,
  movimientos: (await db.query("select id, tipo, cantidad, ubicacion_id from movimientos_inventario order by id")).rows,
  existencias: (await db.query("select ubicacion_id, producto_id, cantidad from inventario_ubicacion order by 1, 2")).rows,
  contadores: (
    await db.query("select id, proximo_correlativo_factura, proximo_correlativo_interno, proximo_correlativo_cotizacion from empresas order by id")
  ).rows,
})

beforeAll(async () => {
  base = await levantarBase({ hasta: "0032_contadores_solo_por_registro.sql" })
  db = base.admin

  esc = await escenarioSinConexion(db)
  await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos", "sales-history", "inventory-own"] })
  await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion2, permisos: ["dashboard", "pos", "quotes", "clients", "sales-history"] })
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: esc.vendedor.authId, role: "authenticated" })])
  await db.query("select registrar_venta_ubicacion($1::jsonb, 'contado')", [JSON.stringify([{ producto_id: esc.cargador.id, cantidad: 1 }])])
  await db.query("select set_config('request.jwt.claims', '', false)")

  antes = await foto()
  await aplicarMigracion(db, "0033_anulacion_de_ventas.sql")
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

describe("0033 sobre datos existentes", () => {
  it("1. no cambia permisos, ventas, movimientos, existencias ni contadores", async () => {
    expect(await foto()).toEqual(antes)
  })

  it("2. no le da «Anular ventas» a nadie", async () => {
    expect((await db.query("select count(*)::int as n from permisos_usuario where seccion = 'sales-void'")).rows[0].n).toBe(0)
  })

  it("3. el registro de anulaciones nace vacío", async () => {
    expect((await db.query("select count(*)::int as n from anulaciones_venta")).rows[0].n).toBe(0)
  })

  it("4. aplicarla dos veces no rompe nada", async () => {
    await aplicarMigracion(db, "0033_anulacion_de_ventas.sql")

    expect(await foto()).toEqual(antes)
  })

  /*
    El bloque de reversión de docs/anulacion-de-ventas.md, leído del propio
    documento: se prueba lo que se ejecutaría, no una copia.
  */
  it("5. la reversión del documento deja la base como antes y la 0033 se puede volver a aplicar", async () => {
    const doc = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "anulacion-de-ventas.md"), "utf8")
    const reversion = doc.match(/```sql\r?\n(\s*begin;[\s\S]*?commit;)\s*```/)[1]

    await db.query(reversion)

    const queda = await db.query(
      `select to_regclass('public.anulaciones_venta') as tabla,
              to_regprocedure('public.anular_venta(uuid,text,text,text)') as funcion`
    )
    expect(queda.rows[0]).toEqual({ tabla: null, funcion: null })
    expect(await foto()).toEqual(antes)

    await aplicarMigracion(db, "0033_anulacion_de_ventas.sql")
    expect((await db.query("select count(*)::int as n from anulaciones_venta")).rows[0].n).toBe(0)
  })
})
