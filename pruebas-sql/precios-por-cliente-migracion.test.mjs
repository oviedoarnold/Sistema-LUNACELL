/*
  0042 aplicada sobre una base que ya tiene la 0041 y operaciones guardadas, como
  en producción. Los recorridos de precios están en precios-por-cliente.test.mjs.
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

const contexto = baseConOperaciones("0041_cargo_e_isv_por_venta.sql")

describe("la 0042 sobre una base con operaciones", () => {
  let antes
  let registrarAntes
  let sincronizarAntes
  let firmaRegistrar
  let firmaSincronizar

  beforeAll(async () => {
    const { db } = contexto

    await venderComoLaVersionPublicada(contexto, [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")

    antes = await fotoDeDatos(contexto)
    firmaRegistrar = await firmaDe(db, "registrar_venta_ubicacion")
    firmaSincronizar = await firmaDe(db, "sincronizar_venta_sin_conexion")
    registrarAntes = await cuerpoDe(db, firmaRegistrar)
    sincronizarAntes = await cuerpoDe(db, firmaSincronizar)

    await aplicarMigracion(db, "0042_precios_por_cliente.sql")
  })

  it("no cambia ventas, cobros, clientes, productos, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(1)
    expect(await fotoDeDatos(contexto)).toEqual(antes)
  })

  it("en registrar_venta_ubicacion solo cambia de dónde sale el precio", async () => {
    const asignacion = /v_producto\.precio := precio_de_venta\(v_empresa, p_cliente_id, v_item\.producto_id\); /g
    const despues = soloCodigo(await cuerpoDe(contexto.db, firmaRegistrar))

    expect(despues.match(asignacion)).toHaveLength(2)
    expect(despues.replace(asignacion, "")).toBe(soloCodigo(registrarAntes))
  })

  it("en sincronizar_venta_sin_conexion solo cambia con qué precio compara", async () => {
    const comparacion = "precio_de_venta(v_usuario.empresa_id, p_cliente_id, p.id)"
    const despues = soloCodigo(await cuerpoDe(contexto.db, firmaSincronizar))

    expect(despues).toContain(comparacion)
    expect(despues.replace(comparacion, "p.precio")).toBe(soloCodigo(sincronizarAntes))
  })

  it("nace sin precios: todos siguen con el general", async () => {
    expect(Number((await contexto.db.query("select count(*) as n from precios_por_cliente")).rows[0].n)).toBe(0)
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(contexto.db, "0042_precios_por_cliente.sql")

    expect(await fotoDeDatos(contexto)).toEqual(antes)
  })

  it("la versión publicada sigue vendiendo igual, con su cargo y sin duplicar reintentos", async () => {
    const { repetida, nueva } = await siguenVendiendoIgual(contexto, "antes-1")

    expect(repetida.repetida).toBe(true)
    expect(nueva).toMatchObject({ total: 115, repetida: false })
  })
})
