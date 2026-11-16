/*
  0045 aplicada sobre una base que ya tiene la 0044 y operaciones (ventas al contado
  y a crédito, abonos, movimientos, permisos), como en producción. Los recorridos de
  los pedidos están en pedidos-interubicacion.test.mjs.
*/

import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0044_porcentaje_adicional_configurable.sql")

// Lo que ya existía, sin las columnas nuevas: esas se comprueban aparte.
async function foto() {
  const filas = async (consulta) => (await contexto.db.query(consulta)).rows
  const sin = (tabla, ...columnas) =>
    filas(`select to_jsonb(x) ${columnas.map((c) => `- '${c}'`).join(" ")} as fila from ${tabla} x order by id`)

  return {
    ventas: await sin("ventas", "pedido_id"),
    pagos: await sin("pagos", "pedido_id"),
    cobros: await sin("cobros_por_medio", "pedido_id"),
    movimientos: await sin("movimientos_inventario", "pedido_id"),
    detalle: await sin("detalle_venta"),
    abonos: await sin("abonos"),
    empresas: await sin("empresas"),
    clientes: await sin("clientes"),
    productos: await sin("productos"),
    permisos: await filas("select * from permisos_usuario order by usuario_id, seccion"),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
  }
}

describe("la 0045 sobre una base con operaciones", () => {
  let antes
  let ventaAntes

  beforeAll(async () => {
    const { db, e } = contexto

    ventaAntes = await venderComoLaVersionPublicada(contexto, [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 1.96, tasa: 1.7 }], "antes-1")

    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing", [e.vendedor.usuario, e.empresa])

    await consultarComo(
      db,
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'credito', p_cobros => '[]'::jsonb, p_cliente_id => $2) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 2 }]), e.clienteId]
    )

    await consultarComo(
      db,
      e.vendedor.authId,
      `select public.registrar_pago_con_medios($1, 50, '[{"medio":"efectivo","monto":50}]'::jsonb, 'abono-antes') as r`,
      [e.clienteId]
    )

    antes = await foto()

    await aplicarMigracion(db, "0045_pedidos_interubicacion.sql")
  })

  it("no cambia ventas, cobros, pagos, abonos, movimientos, permisos, correlativos ni inventario", async () => {
    expect(antes.ventas).toHaveLength(2)
    expect(antes.cobros).toHaveLength(2)
    expect(antes.abonos).toHaveLength(1)
    expect(await foto()).toEqual(antes)
  })

  it("lo existente queda sin pedido y nadie recibe los privilegios nuevos", async () => {
    const { rows } = await contexto.db.query(`
      select (select count(*) from ventas where pedido_id is not null)::int as ventas,
             (select count(*) from cobros_por_medio where pedido_id is not null)::int as cobros,
             (select count(*) from movimientos_inventario where pedido_id is not null)::int as movimientos,
             (select count(*) from permisos_usuario where seccion in ('orders-resolve', 'orders-cancel'))::int as privilegios,
             (select count(*) from pedidos_ubicacion)::int as pedidos`)

    expect(rows[0]).toEqual({ ventas: 0, cobros: 0, movimientos: 0, privilegios: 0, pedidos: 0 })
  })

  it("las ventas, los abonos y la anulación siguen funcionando igual", async () => {
    const { db, e } = contexto
    const repetida = await venderComoLaVersionPublicada(contexto, [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 1.96, tasa: 1.7 }], "antes-1")
    const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    expect(repetida).toMatchObject({ repetida: true, venta_id: ventaAntes.venta_id })

    const abono = await consultarComo(
      db,
      e.vendedor.authId,
      `select public.registrar_pago_con_medios($1, 20, '[{"medio":"efectivo","monto":20}]'::jsonb) as r`,
      [e.clienteId]
    )

    expect(abono.rows[0].r.monto).toBe(20)

    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-void') on conflict do nothing", [e.vendedor.usuario, e.empresa])

    const anulada = await consultarComo(db, e.vendedor.authId, "select public.anular_venta($1, 'Prueba después de la 0045') as r", [nueva.venta_id])

    expect(anulada.rows[0].r.estado).toBe("anulada")
  })

  it("el contador sigue sin poder escribir en las tablas nuevas", async () => {
    const { rows } = await contexto.db.query(`
      select c.relname as tabla
        from pg_class c
       where c.relnamespace = 'public'::regnamespace
         and c.relname in ('pedidos_ubicacion', 'pedido_detalle', 'eventos_de_pedido', 'pedido_lecturas')
         and exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'impedir_escritura_del_contador')
       order by 1`)

    expect(rows.map((r) => r.tabla)).toEqual(["eventos_de_pedido", "pedido_detalle", "pedido_lecturas", "pedidos_ubicacion"])
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()

    await aplicarMigracion(contexto.db, "0045_pedidos_interubicacion.sql")

    expect(await foto()).toEqual(datos)
  })
})
