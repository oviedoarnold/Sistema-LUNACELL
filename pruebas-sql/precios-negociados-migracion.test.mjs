/*
  0043 aplicada sobre una base que ya tiene la 0042 y operaciones guardadas, como en
  producción. Los recorridos de precios están en precios-negociados.test.mjs.
*/

import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion } from "./arnes.mjs"
import {
  baseConOperaciones,
  cuerpoDe,
  firmaDe,
  fotoDeDatos,
  siguenVendiendoIgual,
  soloCodigo,
  venderComoLaVersionPublicada,
} from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0042_precios_por_cliente.sql")

// Las columnas que ya existían: las nuevas nacen vacías y se comprueban aparte.
const foto = () =>
  fotoDeDatos(contexto, {
    detalle: "id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal",
    tablas: ["precios_por_cliente"],
  })

const FUNCIONES = ["registrar_venta_ubicacion", "conciliar_venta", "registrar_venta_con_medios", "sincronizar_venta_sin_conexion"]

describe("la 0043 sobre una base con operaciones", () => {
  let antes
  const cuerposAntes = {}
  const firmas = {}
  const codigoDespues = async (nombre) => soloCodigo(await cuerpoDe(contexto.db, firmas[nombre]))

  beforeAll(async () => {
    await venderComoLaVersionPublicada(contexto, [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")

    antes = await foto()

    for (const nombre of FUNCIONES) {
      firmas[nombre] = await firmaDe(contexto.db, nombre)
      cuerposAntes[nombre] = await cuerpoDe(contexto.db, firmas[nombre])
    }

    await aplicarMigracion(contexto.db, "0043_precios_negociados.sql")
  })

  it("no cambia ventas, renglones, cobros, clientes, precios, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(1)
    expect(await foto()).toEqual(antes)
  })

  it("los renglones existentes nacen sin negociación", async () => {
    const { rows } = await contexto.db.query(
      "select count(*)::int as n from detalle_venta where precio_referencia is not null or negociado_por is not null or negociado_en is not null or motivo_negociacion is not null"
    )

    expect(rows[0].n).toBe(0)
  })

  it("no toca registrar_venta_ubicacion ni conciliar_venta", async () => {
    for (const nombre of ["registrar_venta_ubicacion", "conciliar_venta"]) {
      expect(await cuerpoDe(contexto.db, firmas[nombre])).toBe(cuerposAntes[nombre])
    }
  })

  it("en registrar_venta_con_medios solo agrega la aplicación del precio", async () => {
    const despues = await codigoDespues("registrar_venta_con_medios")
    const agregado =
      "if (v_venta->>'repetida')::boolean then if negociacion_distinta((v_venta->>'venta_id')::uuid, p_items) then " +
      "raise exception 'La clave % ya se usó con otros precios negociados', p_clave_idempotencia using errcode = 'LM005'; " +
      "end if; else v_venta := v_venta || aplicar_precios_negociados((v_venta->>'venta_id')::uuid, p_items); end if; "

    expect(despues).toContain(agregado)
    expect(despues.replace(agregado, "")).toBe(soloCodigo(cuerposAntes.registrar_venta_con_medios))
  })

  it("en sincronizar_venta_sin_conexion solo cambia cómo trata lo negociado", async () => {
    const restaurada = (await codigoDespues("sincronizar_venta_sin_conexion"))
      .replace("v_negociados jsonb; ", "")
      .replace("where coalesce(r->>'negociado', '') <> 'true' and precio_de_venta", "where precio_de_venta")
      .replace(/select jsonb_agg\(jsonb_build_object\( 'producto_id', r->'producto_id', 'precio_negociado'.*?p_registrada_en\); end if; /, "")
      .replace("when sqlstate 'OF009' or sqlstate 'LN001' then", "when sqlstate 'OF009' then")

    expect(restaurada).toBe(soloCodigo(cuerposAntes.sincronizar_venta_sin_conexion))
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(contexto.db, "0043_precios_negociados.sql")

    expect(await foto()).toEqual(antes)
  })

  it("la versión publicada sigue vendiendo como antes, sin duplicar reintentos", async () => {
    const { repetida, nueva } = await siguenVendiendoIgual(contexto, "antes-1")

    expect([repetida.repetida, nueva.repetida, nueva.total]).toEqual([true, false, 115])
  })
})
