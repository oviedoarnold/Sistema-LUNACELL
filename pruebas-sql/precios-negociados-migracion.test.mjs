/*
  0043 aplicada sobre una base que ya tiene la 0042 y operaciones guardadas, como en
  producción. Los recorridos de precios están en precios-negociados.test.mjs.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, comoUsuario, comoDueno } from "./arnes.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db
let e

beforeAll(async () => {
  base = await levantarBase({ hasta: "0042_precios_por_cliente.sql" })
  db = base.admin
  e = await escenarioSinConexion(db, { enCamion1: 100 })
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

async function venderComoLaVersionPublicada(cobros, clave = null) {
  await comoUsuario(db, e.vendedor.authId)

  try {
    const { rows } = await db.query(
      `select public.registrar_venta_con_medios(
         p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb,
         p_cliente_id => $3, p_clave_idempotencia => $4) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify(cobros), e.clienteId, clave]
    )

    return rows[0].r
  } finally {
    await comoDueno(db)
  }
}

const COLUMNAS_DETALLE = "id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal"

const foto = async () => ({
  ventas: (await db.query("select * from ventas order by id")).rows,
  detalle: (await db.query(`select ${COLUMNAS_DETALLE} from detalle_venta order by id`)).rows,
  cobros: (await db.query("select * from cobros_por_medio order by id")).rows,
  clientes: (await db.query("select * from clientes order by id")).rows,
  productos: (await db.query("select * from productos order by id")).rows,
  precios: (await db.query("select * from precios_por_cliente order by id")).rows,
  correlativos: (await db.query("select proximo_correlativo_factura, proximo_correlativo_interno from empresas where id = $1", [e.empresa])).rows,
  inventario: (await db.query("select * from inventario_ubicacion order by ubicacion_id, producto_id")).rows,
})

const firmaDe = async (nombre) =>
  (await db.query("select oid::regprocedure::text as firma from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [nombre])).rows[0].firma

const cuerpoDe = async (firma) =>
  (await db.query("select replace(prosrc, chr(13), '') as cuerpo from pg_proc where oid = $1::regprocedure", [firma])).rows[0].cuerpo

// Sin comentarios ni espacios de más: lo que se compara es el código.
const soloCodigo = (cuerpo) =>
  cuerpo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()

describe("la 0043 sobre una base con operaciones", () => {
  let antes
  const cuerposAntes = {}
  const firmas = {}

  beforeAll(async () => {
    await venderComoLaVersionPublicada([{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")

    antes = await foto()

    for (const nombre of ["registrar_venta_ubicacion", "conciliar_venta", "registrar_venta_con_medios", "sincronizar_venta_sin_conexion"]) {
      firmas[nombre] = await firmaDe(nombre)
      cuerposAntes[nombre] = await cuerpoDe(firmas[nombre])
    }

    await aplicarMigracion(db, "0043_precios_negociados.sql")
  })

  it("no cambia ventas, renglones, cobros, clientes, precios, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(1)
    expect(await foto()).toEqual(antes)
  })

  it("los renglones existentes nacen sin negociación", async () => {
    const { rows } = await db.query(
      "select count(*)::int as n from detalle_venta where precio_referencia is not null or negociado_por is not null or negociado_en is not null or motivo_negociacion is not null"
    )

    expect(rows[0].n).toBe(0)
  })

  it("no toca registrar_venta_ubicacion ni conciliar_venta", async () => {
    expect(await cuerpoDe(firmas.registrar_venta_ubicacion)).toBe(cuerposAntes.registrar_venta_ubicacion)
    expect(await cuerpoDe(firmas.conciliar_venta)).toBe(cuerposAntes.conciliar_venta)
  })

  it("en registrar_venta_con_medios solo agrega la aplicación del precio", async () => {
    const despues = soloCodigo(await cuerpoDe(firmas.registrar_venta_con_medios))
    const agregado =
      "if (v_venta->>'repetida')::boolean then if negociacion_distinta((v_venta->>'venta_id')::uuid, p_items) then " +
      "raise exception 'La clave % ya se usó con otros precios negociados', p_clave_idempotencia using errcode = 'LM005'; " +
      "end if; else v_venta := v_venta || aplicar_precios_negociados((v_venta->>'venta_id')::uuid, p_items); end if; "

    expect(despues).toContain(agregado)
    expect(despues.replace(agregado, "")).toBe(soloCodigo(cuerposAntes.registrar_venta_con_medios))
  })

  it("en sincronizar_venta_sin_conexion solo cambia cómo trata lo negociado", async () => {
    const despues = soloCodigo(await cuerpoDe(firmas.sincronizar_venta_sin_conexion))
    const original = soloCodigo(cuerposAntes.sincronizar_venta_sin_conexion)
    const restaurada = despues
      .replace("v_negociados jsonb; ", "")
      .replace("where coalesce(r->>'negociado', '') <> 'true' and precio_de_venta", "where precio_de_venta")
      .replace(/select jsonb_agg\(jsonb_build_object\( 'producto_id', r->'producto_id', 'precio_negociado'.*?p_registrada_en\); end if; /, "")
      .replace("when sqlstate 'OF009' or sqlstate 'LN001' then", "when sqlstate 'OF009' then")

    expect(restaurada).toBe(original)
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(db, "0043_precios_negociados.sql")

    expect(await foto()).toEqual(antes)
  })

  it("la versión publicada sigue vendiendo igual, con su cargo y sin duplicar reintentos", async () => {
    const repetida = await venderComoLaVersionPublicada([{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")
    const nueva = await venderComoLaVersionPublicada([{ medio: "efectivo", monto: 115 }])

    expect(repetida.repetida).toBe(true)
    expect(nueva).toMatchObject({ total: 115, repetida: false })
  })
})
