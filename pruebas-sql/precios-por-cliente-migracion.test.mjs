/*
  0042 aplicada sobre una base que ya tiene la 0041 y operaciones guardadas, como
  en producción. Los recorridos de precios están en precios-por-cliente.test.mjs.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, aplicarMigracion, comoUsuario, comoDueno } from "./arnes.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db
let e

beforeAll(async () => {
  base = await levantarBase({ hasta: "0041_cargo_e_isv_por_venta.sql" })
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

const foto = async () => ({
  ventas: (await db.query("select * from ventas order by id")).rows,
  detalle: (await db.query("select * from detalle_venta order by id")).rows,
  cobros: (await db.query("select * from cobros_por_medio order by id")).rows,
  clientes: (await db.query("select * from clientes order by id")).rows,
  productos: (await db.query("select * from productos order by id")).rows,
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

describe("la 0042 sobre una base con operaciones", () => {
  let antes
  let registrarAntes
  let sincronizarAntes
  let firmaRegistrar
  let firmaSincronizar

  beforeAll(async () => {
    await venderComoLaVersionPublicada([{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")

    antes = await foto()
    firmaRegistrar = await firmaDe("registrar_venta_ubicacion")
    firmaSincronizar = await firmaDe("sincronizar_venta_sin_conexion")
    registrarAntes = await cuerpoDe(firmaRegistrar)
    sincronizarAntes = await cuerpoDe(firmaSincronizar)

    await aplicarMigracion(db, "0042_precios_por_cliente.sql")
  })

  it("no cambia ventas, cobros, clientes, productos, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(1)
    expect(await foto()).toEqual(antes)
  })

  it("en registrar_venta_ubicacion solo cambia de dónde sale el precio", async () => {
    const asignacion = /v_producto\.precio := precio_de_venta\(v_empresa, p_cliente_id, v_item\.producto_id\); /g
    const despues = soloCodigo(await cuerpoDe(firmaRegistrar))

    expect(despues.match(asignacion)).toHaveLength(2)
    expect(despues.replace(asignacion, "")).toBe(soloCodigo(registrarAntes))
  })

  it("en sincronizar_venta_sin_conexion solo cambia con qué precio compara", async () => {
    const comparacion = "precio_de_venta(v_usuario.empresa_id, p_cliente_id, p.id)"
    const despues = soloCodigo(await cuerpoDe(firmaSincronizar))

    expect(despues).toContain(comparacion)
    expect(despues.replace(comparacion, "p.precio")).toBe(soloCodigo(sincronizarAntes))
  })

  it("nace sin precios: todos siguen con el general", async () => {
    expect(Number((await db.query("select count(*) as n from precios_por_cliente")).rows[0].n)).toBe(0)
  })

  it("se puede volver a correr sin fallar", async () => {
    await aplicarMigracion(db, "0042_precios_por_cliente.sql")

    expect(await foto()).toEqual(antes)
  })

  it("la versión publicada sigue vendiendo igual, con su cargo y sin duplicar reintentos", async () => {
    const repetida = await venderComoLaVersionPublicada([{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }], "antes-1")
    const nueva = await venderComoLaVersionPublicada([{ medio: "efectivo", monto: 115 }])

    expect(repetida.repetida).toBe(true)
    expect(nueva).toMatchObject({ total: 115, repetida: false })
  })
})
