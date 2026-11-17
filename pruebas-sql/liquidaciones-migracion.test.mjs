/*
  0046 aplicada sobre una base que ya tiene la 0045 y operaciones, como en
  producción: ventas al contado y a crédito, abonos, y pedidos de contado y a
  crédito con prima, facturados y pendientes. Los recorridos de las liquidaciones
  están en liquidaciones-entre-ubicaciones.test.mjs.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0045_pedidos_interubicacion.sql")

const REPORTES = ["reporte_diario", "reporte_medios_de_pago"]

async function foto() {
  const filas = async (consulta) => (await contexto.db.query(consulta)).rows
  const todo = (tabla) => filas(`select to_jsonb(x) as fila from ${tabla} x order by id`)

  return {
    ventas: await todo("ventas"),
    pagos: await todo("pagos"),
    abonos: await todo("abonos"),
    cobros: await todo("cobros_por_medio"),
    pedidos: await todo("pedidos_ubicacion"),
    detalle: await todo("pedido_detalle"),
    eventos: await todo("eventos_de_pedido"),
    movimientos: await todo("movimientos_inventario"),
    empresas: await todo("empresas"),
    permisos: await filas("select * from permisos_usuario order by usuario_id, seccion"),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
  }
}

describe("la 0046 sobre una base con operaciones y pedidos", () => {
  let antes
  let cuerpos
  let reportesAntes

  beforeAll(async () => {
    const { db, e } = contexto
    const como = (authId, consulta, valores) => consultarComo(db, authId, consulta, valores)

    await venderComoLaVersionPublicada(contexto, [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 1.96, tasa: 1.7 }], "antes-1")
    await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }], "antes-2")

    await como(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'credito', p_cobros => '[]'::jsonb, p_cliente_id => $2) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 2 }]), e.clienteId]
    )
    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing", [e.vendedor.usuario, e.empresa])
    await como(e.vendedor.authId, `select public.registrar_pago_con_medios($1, 50, '[{"medio":"efectivo","monto":50}]'::jsonb, 'abono-antes') as r`, [e.clienteId])

    // Camión 02 entrega y cobra; Camión 01 factura.
    const entrega = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })
    const pedir = async (forma, cobros) =>
      (
        await como(
          entrega.authId,
          `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
             p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
          [e.camion1, e.clienteId, JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
        )
      ).rows[0].r

    const contado = await pedir("contado", [{ medio: "efectivo", monto: 115 }])
    const credito = await pedir("credito", [{ medio: "efectivo", monto: 40 }])

    await pedir("contado", [{ medio: "tarjeta", monto: 115, referencia: "", tasa: 1.7, cargo: 1.96 }])
    await como(e.vendedor.authId, "select public.facturar_pedido($1) as r", [contado.pedido_id])
    await como(e.vendedor.authId, "select public.facturar_pedido($1) as r", [credito.pedido_id])

    antes = await foto()

    cuerpos = {}
    for (const nombre of REPORTES) cuerpos[nombre] = await cuerpoDe(db, await firmaDe(db, nombre))

    reportesAntes = {}
    for (const nombre of REPORTES) {
      reportesAntes[nombre] = (await como(e.admin.authId, `select public.${nombre}() as r`)).rows[0].r
    }

    await aplicarMigracion(db, "0046_liquidaciones_entre_ubicaciones.sql")
  })

  it("no cambia ventas, pagos, abonos, cobros, pedidos, movimientos, permisos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(5)
    expect(antes.pedidos).toHaveLength(3)
    expect(antes.cobros.length).toBeGreaterThanOrEqual(5)
    expect(await foto()).toEqual(antes)
  })

  it("no reescribe los reportes de siempre: mismo código y mismas cifras", async () => {
    const { db, e } = contexto

    for (const nombre of REPORTES) {
      expect(await cuerpoDe(db, await firmaDe(db, nombre))).toBe(cuerpos[nombre])
      expect((await consultarComo(db, e.admin.authId, `select public.${nombre}() as r`)).rows[0].r).toEqual(reportesAntes[nombre])
    }
  })

  it("nadie recibe los permisos nuevos y no hay ninguna liquidación", async () => {
    const { rows } = await contexto.db.query(`
      select (select count(*) from permisos_usuario where seccion in ('settlements-view', 'settlements-manage'))::int as permisos,
             (select count(*) from liquidaciones_ubicacion)::int as liquidaciones,
             (select count(*) from liquidacion_detalle)::int as detalle`)

    expect(rows[0]).toEqual({ permisos: 0, liquidaciones: 0, detalle: 0 })
  })

  it("los pedidos que ya existen aparecen por liquidar: solo su efectivo", async () => {
    const { db, e } = contexto
    const c = (await consultarComo(db, e.admin.authId, "select public.control_de_liquidaciones() as r")).rows[0].r

    expect(c.pares).toHaveLength(1)
    expect(c.pares[0]).toMatchObject({ origen_id: e.camion2, destino_id: e.camion1 })
    expect([c.pares[0].efectivo, c.pares[0].electronico, c.pares[0].pendiente].map(Number)).toEqual([155, 115, 155])
  })

  it("el contador sigue sin poder escribir en las tablas nuevas", async () => {
    const { rows } = await contexto.db.query(`
      select c.relname as tabla
        from pg_class c
       where c.relnamespace = 'public'::regnamespace
         and c.relname in ('liquidaciones_ubicacion', 'liquidacion_detalle')
         and exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'impedir_escritura_del_contador')
       order by 1`)

    expect(rows.map((r) => r.tabla)).toEqual(["liquidacion_detalle", "liquidaciones_ubicacion"])
  })

  it("anon no ejecuta ninguna de las funciones nuevas", async () => {
    const { rows } = await contexto.db.query(`
      select p.proname
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('registrar_liquidacion', 'resolver_liquidacion', 'control_de_liquidaciones', 'saldos_de_pedidos',
                           'reporte_diario_de_caja', 'reporte_medios_de_caja', 'caja_de_pedidos_del_dia',
                           'liquidacion_visible', 'usuario_opera_liquidacion', 'liquidacion_solo_se_resuelve', 'sumar_de')
         and has_function_privilege('anon', p.oid, 'execute')`)

    expect(rows).toEqual([])
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()

    await aplicarMigracion(contexto.db, "0046_liquidaciones_entre_ubicaciones.sql")

    expect(await foto()).toEqual(datos)
  })
})
