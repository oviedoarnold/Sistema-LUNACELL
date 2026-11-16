/*
  0044 aplicada sobre una base que ya tiene la 0043 y operaciones cobradas con el 7 %
  de la 0041, como en producción. Los recorridos están en porcentaje-adicional.test.mjs.
*/

import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { existencia, fallo, ventaSinConexion } from "./escenario-sin-conexion.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0043_precios_negociados.sql")

// Lo que ya existía, sin las columnas nuevas: esas se comprueban aparte.
async function foto() {
  const filas = async (consulta, valores = []) => (await contexto.db.query(consulta, valores)).rows
  const sin = (tabla, ...columnas) =>
    filas(`select to_jsonb(x) ${columnas.map((c) => `- '${c}'`).join(" ")} as fila from ${tabla} x order by id`)

  return {
    ventas: await sin("ventas", "tasa_cargo"),
    pagos: await sin("pagos", "tasa_cargo"),
    cobros: await sin("cobros_por_medio", "tasa_cargo"),
    empresas: await sin("empresas", "tasa_cargo_tarjeta", "tasa_cargo_enlace"),
    detalle: await sin("detalle_venta"),
    abonos: await sin("abonos"),
    anulaciones: await sin("anulaciones_venta"),
    clientes: await sin("clientes"),
    productos: await sin("productos"),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
    conciliar: await filas("select * from cobros_por_conciliar order by conciliacion_id"),
  }
}

const PARAMETROS = `
  p_clave_idempotencia => $1, p_usuario_auth => $2, p_ubicacion_id => $3,
  p_dispositivo => $4, p_numero_provisional => $5, p_registrada_en => $6,
  p_reloj_dispositivo => $7, p_tasa_isv => $8, p_renglones => $9::jsonb,
  p_total_cobrado => $10, p_forma_pago => $11, p_cobros => $12::jsonb`

const sincronizar = async (v, cobros) =>
  (
    await consultarComo(contexto.db, contexto.e.vendedor.authId, `select public.sincronizar_venta_con_medios(${PARAMETROS}) as r`, [
      v.clave_idempotencia, v.usuario_auth, v.ubicacion_id, v.dispositivo, v.numero_provisional, v.registrada_en,
      v.reloj_dispositivo, v.tasa_isv, JSON.stringify(v.renglones), v.total_cobrado, v.forma_pago, JSON.stringify(cobros),
    ])
  ).rows[0].r

describe("la 0044 sobre una base con operaciones cobradas al 7 %", () => {
  // Como la manda la versión publicada: cargo del 7 % y sin tasa.
  const TARJETA_AL_7 = [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }]
  let antes
  let ventaAntes
  let pendienteDelTelefono

  beforeAll(async () => {
    const { db, e } = contexto

    ventaAntes = await venderComoLaVersionPublicada(contexto, TARJETA_AL_7, "antes-1")

    // Una venta hecha en el teléfono antes de instalar, que todavía no se sincroniza.
    pendienteDelTelefono = ventaSinConexion(e)

    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing", [e.vendedor.usuario, e.empresa])

    antes = await foto()

    await aplicarMigracion(db, "0044_porcentaje_adicional_configurable.sql")
  })

  it("no cambia ventas, cobros, pagos, abonos, anulaciones, renglones, clientes, productos, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(1)
    expect(antes.cobros).toHaveLength(1)
    expect(await foto()).toEqual(antes)
  })

  it("lo existente nace sin tasa: no se rellena hacia atrás", async () => {
    const { rows } = await contexto.db.query(`
      select (select count(*) from cobros_por_medio where tasa_cargo is not null)::int as cobros,
             (select count(*) from ventas where tasa_cargo is not null)::int as ventas,
             (select count(*) from pagos where tasa_cargo is not null)::int as pagos`)

    expect(rows[0]).toEqual({ cobros: 0, ventas: 0, pagos: 0 })

    const venta = (await contexto.db.query("select cargo_por_medio::float8 as cargo from ventas where id = $1", [ventaAntes.venta_id])).rows[0]

    expect(venta.cargo).toBe(8.05)
  })

  it("la empresa queda en 1.7 % y el historial anota el paso desde el 7 %, sin usuario", async () => {
    const { db, e } = contexto
    const { rows: tasas } = await db.query("select tasa_cargo_tarjeta::float8 as t, tasa_cargo_enlace::float8 as l from empresas where id = $1", [e.empresa])
    const { rows } = await db.query(
      "select medio, tasa_anterior::float8 as anterior, tasa_nueva::float8 as nueva, cambiado_por, cambiado_por_nombre as nombre from cambios_de_cargo_por_medio where empresa_id = $1 order by id",
      [e.empresa]
    )

    expect(tasas[0]).toEqual({ t: 1.7, l: 1.7 })
    expect(rows).toEqual([
      { medio: "tarjeta", anterior: 7, nueva: 1.7, cambiado_por: null, nombre: "Migración 0044" },
      { medio: "enlace", anterior: 7, nueva: 1.7, cambiado_por: null, nombre: "Migración 0044" },
    ])
  })

  it("un reintento de la venta cobrada al 7 % devuelve esa misma venta", async () => {
    const repetida = await venderComoLaVersionPublicada(contexto, TARJETA_AL_7, "antes-1")

    expect(repetida).toMatchObject({ repetida: true, venta_id: ventaAntes.venta_id })
  })

  it("la versión publicada ya no registra una tarjeta nueva al 7 %: se rechaza sin tocar nada; el efectivo sigue", async () => {
    const { db, e } = contexto
    const stock = await existencia(db, e.camion1, e.cargador.id)
    const error = await fallo(venderComoLaVersionPublicada(contexto, TARJETA_AL_7))

    expect(error.code).toBe("LM007")
    expect(error.message).toBe("El porcentaje adicional de Tarjeta es 1.7 %. Revisa el total y vuelve a confirmar.")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)

    const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    expect(nueva.venta_id).toBeTruthy()
  })

  it("una venta del teléfono cobrada al 7 % antes de instalar entra directo, con la tasa de su momento", async () => {
    const r = await sincronizar(pendienteDelTelefono, [{ medio: "tarjeta", monto: 230, referencia: "", cargo: 16.1 }])
    const { rows } = await contexto.db.query(
      "select v.cargo_por_medio::float8 as cargo, c.tasa_cargo::float8 as tasa from ventas v join cobros_por_medio c on c.venta_id = v.id where v.id = $1",
      [r.venta_id]
    )

    expect(r.estado).toBe("registrada")
    expect(rows).toEqual([{ cargo: 16.1, tasa: 7 }])
  })

  it("una del teléfono hecha después de instalar, todavía al 7 %, va a conciliación y conserva lo cobrado", async () => {
    const ahora = new Date(Date.now() + 30000).toISOString()
    const r = await sincronizar(
      ventaSinConexion(contexto.e, { registrada_en: ahora, reloj_dispositivo: ahora }),
      [{ medio: "tarjeta", monto: 230, referencia: "", cargo: 16.1 }]
    )

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
    expect(r.detalle).toBe("Tarjeta se cobró con otro porcentaje, y en la fecha de la venta regía 1.7 %")

    const { rows } = await contexto.db.query("select cobros from cobros_por_conciliar where conciliacion_id = $1", [r.conciliacion_id])

    expect(rows[0].cobros).toEqual([{ medio: "tarjeta", monto: 230, cargo: 16.1, tasa: null, referencia: "" }])
  })

  it("aplicarla otra vez no cambia nada ni duplica el historial", async () => {
    const { db } = contexto
    const contar = async () => (await db.query("select count(*)::int as n from cambios_de_cargo_por_medio")).rows[0].n
    const historial = await contar()
    const datos = await foto()

    await aplicarMigracion(db, "0044_porcentaje_adicional_configurable.sql")

    expect(await contar()).toBe(historial)
    expect(await foto()).toEqual(datos)
  })
})
