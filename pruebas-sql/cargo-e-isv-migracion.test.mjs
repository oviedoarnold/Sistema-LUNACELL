/*
  0041 aplicada sobre una base que ya tiene la 0040 y operaciones guardadas, como
  en producción. Los recorridos de cargo e ISV están en medios-de-pago.test.mjs.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, comoUsuario, comoDueno } from "./arnes.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db
let e

beforeAll(async () => {
  base = await levantarBase({ hasta: "0040_referencias_opcionales.sql" })
  db = base.admin
  e = await escenarioSinConexion(db, { enCamion1: 100 })
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

async function comoVendedor(consulta, valores) {
  await comoUsuario(db, e.vendedor.authId)

  try {
    return (await db.query(consulta, valores)).rows[0].r
  } finally {
    await comoDueno(db)
  }
}

// Como llama hoy la versión publicada: sin p_con_isv y sin cargo en los medios.
const venderComoLaVersionPublicada = (cobros, clave = null) =>
  comoVendedor(
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb, p_clave_idempotencia => $3) as r`,
    [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify(cobros), clave]
  )

const COLUMNAS_DE_VENTA = `id, numero_factura, correlativo, subtotal, isv, tasa_isv, total, forma_pago, estado`
const COLUMNAS_DE_COBRO = `id, venta_id, pago_id, medio, monto, referencia, fecha`

const foto = async () => ({
  ventas: (await db.query(`select ${COLUMNAS_DE_VENTA} from ventas order by id`)).rows,
  cobros: (await db.query(`select ${COLUMNAS_DE_COBRO} from cobros_por_medio order by id`)).rows,
  correlativos: (await db.query("select proximo_correlativo_factura, proximo_correlativo_interno from empresas where id = $1", [e.empresa])).rows,
  inventario: (await db.query("select * from inventario_ubicacion order by ubicacion_id, producto_id")).rows,
})

describe("la 0041 sobre una base con operaciones", () => {
  let antes

  beforeAll(async () => {
    await venderComoLaVersionPublicada([{ medio: "efectivo", monto: 15 }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }], "antes-1")

    antes = await foto()

    expect(Number((await db.query("select count(*) as n from comisiones_de_cobro")).rows[0].n)).toBe(1)

    await aplicarMigracion(db, "0041_cargo_e_isv_por_venta.sql")
  })

  it("no cambia ventas, cobros, correlativos ni inventario", async () => {
    expect(antes.cobros).toHaveLength(2)
    expect(await foto()).toEqual(antes)
  })

  it("lo anterior queda con cargo 0", async () => {
    const { rows } = await db.query(`
      select (select coalesce(sum(cargo), 0)::float8 from cobros_por_medio) as cobros,
             (select coalesce(sum(cargo_por_medio), 0)::float8 from ventas) as ventas`)

    expect(rows[0]).toEqual({ cobros: 0, ventas: 0 })
  })

  it("retira las tablas de comisión", async () => {
    const { rows } = await db.query("select to_regclass('public.comisiones_de_cobro') as a, to_regclass('public.tasas_de_comision') as b")

    expect(rows[0]).toEqual({ a: null, b: null })
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(db, "0041_cargo_e_isv_por_venta.sql")

    expect(await foto()).toEqual(antes)
  })

  it("la versión publicada sigue vendiendo igual, y un reintento suyo no se rechaza", async () => {
    const repetida = await venderComoLaVersionPublicada([{ medio: "efectivo", monto: 15 }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }], "antes-1")
    const nueva = await venderComoLaVersionPublicada([{ medio: "transferencia", monto: 115 }])

    expect(repetida.repetida).toBe(true)
    expect(nueva).toMatchObject({ total: 115, repetida: false })
  })

  it("los cobros siguen sin poder cambiarse", async () => {
    await expect(db.query("update cobros_por_medio set cargo = 1")).rejects.toThrow()
  })

  it("quien no entró no ejecuta la venta", async () => {
    const { rows } = await db.query(
      "select has_function_privilege('anon', 'public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text, boolean)', 'execute') as anon"
    )

    expect(rows[0].anon).toBe(false)
  })
})
