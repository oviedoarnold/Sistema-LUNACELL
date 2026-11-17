/*
  0047 aplicada sobre una base que ya tiene la 0046 y operaciones, como en
  producción: no cambia filas ni otras funciones, y solo corrige la fila
  «Sin ubicación» del reporte diario de caja.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearAbonoLegado, crearFactura, crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0046_liquidaciones_entre_ubicaciones.sql")

const DATOS = ["ventas", "pagos", "abonos", "cobros_por_medio", "pedidos_ubicacion", "liquidaciones_ubicacion", "movimientos_inventario", "permisos_usuario", "inventario_ubicacion"]

async function foto() {
  const datos = {}

  for (const tabla of DATOS) {
    datos[tabla] = (await contexto.db.query(`select to_jsonb(x) as fila from ${tabla} x order by to_jsonb(x)::text`)).rows
  }

  // Todas las funciones salvo las dos que la 0047 crea o reemplaza.
  datos.funciones = (
    await contexto.db.query(`
      select p.oid::regprocedure::text as firma, md5(p.prosrc) as cuerpo, p.proconfig as config
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname not in ('reporte_diario_de_caja', 'sumar_de_la_ubicacion')
       order by 1`)
  ).rows

  return datos
}

const filaSinUbicacion = async () => {
  const { db, e } = contexto
  const r = (await consultarComo(db, e.admin.authId, "select public.reporte_diario_de_caja() as r")).rows[0].r

  return r.por_ubicacion.find((u) => u.ubicacion_id === null)
}

describe("la 0047 sobre una base con la 0046 y operaciones", () => {
  let antes
  let filaAntes

  beforeAll(async () => {
    const { db, e } = contexto

    await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }], "antes-1")

    // Un abono antiguo sin ubicación: el reporte tiene una fila «Sin ubicación».
    const vieja = await crearFactura(db, { empresa: e.empresa, clienteId: e.clienteId, total: 500 })

    await crearAbonoLegado(db, { empresa: e.empresa, ventaId: vieja, monto: 40 })

    // Un pedido: Camión 02 entrega y cobra 115 en efectivo, Camión 01 factura.
    const entrega = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })
    const p = (
      await consultarComo(
        db,
        entrega.authId,
        `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => 'contado',
           p_cobros => $4::jsonb, p_clave_idempotencia => $5) as r`,
        [e.camion1, e.clienteId, JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify([{ medio: "efectivo", monto: 115 }]), randomUUID()]
      )
    ).rows[0].r

    await consultarComo(db, e.vendedor.authId, "select public.facturar_pedido($1) as r", [p.pedido_id])

    filaAntes = await filaSinUbicacion()
    antes = await foto()

    await aplicarMigracion(db, "0047_caja_fila_sin_ubicacion.sql")
  })

  it("no cambia filas ni ninguna otra función", async () => {
    expect(antes.ventas.length).toBeGreaterThan(0)
    expect(await foto()).toEqual(antes)
  })

  it("la fila «Sin ubicación» ya no recibe lo cobrado en las demás ubicaciones", async () => {
    // Con la 0046 sola, la fila recibía el cobro del pedido de Camión 02 como «por cuenta de otra».
    expect(Number(filaAntes.cobros_por_cuenta_de_otras)).toBe(115)

    const despues = await filaSinUbicacion()

    expect([Number(despues.cobros_total), Number(despues.abonos_total), Number(despues.cobros_por_cuenta_de_otras)]).toEqual([40, 40, 0])
  })

  it("anon no ejecuta la función nueva", async () => {
    const { rows } = await contexto.db.query(
      "select has_function_privilege('anon', 'public.sumar_de_la_ubicacion(jsonb, text, text)', 'execute') as anon, has_function_privilege('anon', 'public.reporte_diario_de_caja(date, uuid)', 'execute') as reporte"
    )

    expect(rows[0]).toEqual({ anon: false, reporte: false })
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()

    await aplicarMigracion(contexto.db, "0047_caja_fila_sin_ubicacion.sql")

    expect(await foto()).toEqual(datos)
  })
})
