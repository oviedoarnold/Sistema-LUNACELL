/*
  0040 aplicada sobre una base que ya tiene la 0039 y cobros guardados, como en
  producción. Los recorridos completos sin referencia están en
  medios-de-pago.test.mjs.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, comoUsuario, comoDueno } from "./arnes.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db
let e

beforeAll(async () => {
  base = await levantarBase({ hasta: "0039_medios_de_pago.sql" })
  db = base.admin
  e = await escenarioSinConexion(db, { enCamion1: 100 })
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

async function vender(cobros) {
  await comoUsuario(db, e.vendedor.authId)

  try {
    const { rows } = await db.query(
      `select public.registrar_venta_con_medios(
         p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify(cobros)]
    )

    return rows[0].r
  } finally {
    await comoDueno(db)
  }
}

const fotoDeCobros = async () =>
  (await db.query("select id, medio, monto, referencia, fecha from cobros_por_medio order by id")).rows

const invalidos = async (cobros) =>
  (await db.query("select public.medios_de_cobro_invalidos($1::jsonb) as motivo", [JSON.stringify(cobros)])).rows[0].motivo

describe("la 0040 sobre una base con cobros", () => {
  let antes
  let comisionesAntes

  beforeAll(async () => {
    await vender([{ medio: "efectivo", monto: 15 }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }])

    antes = await fotoDeCobros()
    comisionesAntes = (await db.query("select * from comisiones_de_cobro order by cobro_id")).rows

    // Antes de aplicarla, sin referencia se rechaza: es lo que cambia.
    expect(await invalidos([{ medio: "tarjeta", monto: 115 }])).toMatch(/referencia/i)

    await aplicarMigracion(db, "0040_referencias_opcionales.sql")
  })

  it("no toca los cobros ni las comisiones ya guardados", async () => {
    expect(antes).toHaveLength(2)
    expect(await fotoDeCobros()).toEqual(antes)
    expect((await db.query("select * from comisiones_de_cobro order by cobro_id")).rows).toEqual(comisionesAntes)
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(db, "0040_referencias_opcionales.sql")

    expect(await fotoDeCobros()).toEqual(antes)
  })

  it("los cobros siguen sin poder cambiarse", async () => {
    await expect(db.query("update cobros_por_medio set referencia = 'OTRA'")).rejects.toThrow()
    await expect(db.query("delete from cobros_por_medio")).rejects.toThrow()
  })

  it("no abre la función a quien no entró", async () => {
    const { rows } = await db.query(
      "select has_function_privilege('anon', 'public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text)', 'execute') as anon"
    )

    expect(rows[0].anon).toBe(false)
  })

  it.each([
    ["efectivo con referencia", "efectivo", "RECIBO"],
    ["tarjeta con referencia en blanco", "tarjeta", "   "],
    ["referencia demasiado larga", "enlace", "x".repeat(121)],
  ])("la tabla sigue rechazando %s, aunque no pase por la función", async (_, medio, referencia) => {
    const [{ venta_id: ventaId }] = (
      await db.query("select venta_id from cobros_por_medio where venta_id is not null limit 1")
    ).rows

    await expect(
      db.query(
        `insert into cobros_por_medio (empresa_id, venta_id, medio, monto, referencia, ubicacion_id, usuario_id, fecha)
         select empresa_id, id, $2, 1, $3, ubicacion_id, usuario_id, now() from ventas where id = $1`,
        [ventaId, medio, referencia]
      )
    ).rejects.toThrow(/cobros_por_medio_referencia/)
  })
})
