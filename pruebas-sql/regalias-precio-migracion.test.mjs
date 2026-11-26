/*
  0055 aplicada sobre una base con la 0054 y operaciones, como en producción:
  ventas, una anulada y una regalía ya entregada. No debe cambiar ninguna fila
  (la regalía de antes queda sin precio), ninguna función de vender o regalar,
  ni los permisos y políticas. La versión publicada del reporte sigue leyendo
  lo mismo.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { baseConOperaciones, fotoDeDatos, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0054_regalias.sql")
const MIGRACION = "0055_precio_de_regalias.sql"
const TABLAS = ["pagos", "abonos", "movimientos_inventario", "anulaciones_venta", "devoluciones_de_venta", "pedidos_ubicacion", "traslados"]
const SIN_CAMBIOS = [
  "registrar_venta_con_regalias", "regalias_pedidas", "regalias_guardadas", "regalia_no_cambia",
  "registrar_venta_ubicacion", "registrar_venta_con_medios", "aplicar_precios_negociados", "anular_venta",
  "registrar_devolucion_de_venta", "registrar_pago_cliente", "recibir_venta_sin_conexion",
  "entregar_pedido", "facturar_pedido", "anular_factura_de_pedido", "registrar_traslado",
]
// Las columnas de regalias_venta y del reporte que ya existían con la 0054.
const COLUMNAS_0054 = "id, empresa_id, venta_id, cliente_id, producto_id, nombre, codigo, cantidad, ubicacion_id, usuario_id, usuario_nombre, motivo, detalle_motivo, costo_unitario, creado_en"
const DEL_REPORTE_0054 = [
  "regalia_id", "fecha", "venta_id", "numero_factura", "estado_factura", "cliente_id", "cliente", "producto_id", "producto",
  "codigo", "cantidad", "ubicacion_id", "ubicacion", "usuario", "motivo", "detalle_motivo", "costo_unitario", "costo_total",
]

const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r
const filas = async (consulta, valores) => (await contexto.db.query(consulta, valores)).rows
const soloDe0054 = (fila) => Object.fromEntries(DEL_REPORTE_0054.map((k) => [k, fila[k]]))
const reporte = async (authId) => (await consultarComo(contexto.db, authId, "select * from public.reporte_de_regalias() order by fecha, producto")).rows

const regalar = () =>
  r(
    contexto.e.vendedor.authId,
    `select public.registrar_venta_con_regalias(p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb,
       p_regalias => $3::jsonb, p_motivo_regalia => 'cliente_frecuente', p_cliente_id => $4, p_clave_idempotencia => $5) as r`,
    [
      JSON.stringify([{ producto_id: contexto.e.cargador.id, cantidad: 1 }]),
      JSON.stringify([{ medio: "efectivo", monto: 115 }]),
      JSON.stringify([{ producto_id: contexto.e.cargador.id, cantidad: 2 }]),
      contexto.e.clienteId,
      randomUUID(),
    ]
  )

// Políticas, privilegios y RLS; de regalias_venta se deja fuera solo la columna nueva.
const permisosDeLaBase = async () => ({
  politicas: await filas("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2"),
  tablas: await filas("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3"),
  columnas: await filas(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                          where table_schema = 'public' and not (table_name = 'regalias_venta' and column_name = 'precio_unitario') order by 1, 2, 3, 4`),
  asignados: await filas("select usuario_id, empresa_id, seccion from permisos_usuario order by 1, 3"),
  rls: await filas("select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1"),
  reporte: await filas(`select proacl::text, prosecdef, proconfig, provolatile, pg_get_function_arguments(oid) as argumentos
                          from pg_proc where oid = 'public.reporte_de_regalias(date, date, uuid)'::regprocedure`),
})

describe("la 0055 sobre una base con la 0054, ventas y una regalía entregada", () => {
  let antes
  let regaliasAntes
  let reporteAntes
  let permisosAntes
  let cuerpos
  let entregada

  beforeAll(async () => {
    const { db, e } = contexto

    for (const seccion of ["regalias", "sales-history"]) {
      await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, $3)", [e.vendedor.usuario, e.empresa, seccion])
    }

    const anulada = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])
    await r(e.admin.authId, "select public.anular_venta($1, 'Venta de prueba anulada', null, $2) as r", [anulada.venta_id, randomUUID()])
    entregada = await regalar()

    antes = await fotoDeDatos(contexto, { tablas: TABLAS })
    regaliasAntes = await filas(`select ${COLUMNAS_0054} from regalias_venta order by id`)
    reporteAntes = await reporte(e.admin.authId)
    permisosAntes = await permisosDeLaBase()
    cuerpos = Object.fromEntries(await Promise.all(SIN_CAMBIOS.map(async (n) => [n, await cuerpoDe(db, await firmaDe(db, n))])))

    await aplicarMigracion(db, MIGRACION)
  })

  it("no cambia ninguna fila: la regalía de antes conserva todo y queda sin precio", async () => {
    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await filas(`select ${COLUMNAS_0054} from regalias_venta order by id`)).toEqual(regaliasAntes)
    expect(await filas("select precio_unitario from regalias_venta")).toEqual([{ precio_unitario: null }])
  })

  it("no cambia la función que registra la venta con regalías ni ninguna otra de vender, cobrar o anular", async () => {
    const { db } = contexto

    for (const n of SIN_CAMBIOS) expect([n, await cuerpoDe(db, await firmaDe(db, n))]).toEqual([n, cuerpos[n]])
  })

  it("la versión publicada lee el reporte igual que antes; lo nuevo llega vacío para la regalía de antes", async () => {
    const despues = await reporte(contexto.e.admin.authId)

    expect(despues.map(soloDe0054)).toEqual(reporteAntes.map(soloDe0054))
    expect(despues.map((f) => [f.precio_unitario, f.valor_comercial])).toEqual([[null, null]])
  })

  it("conserva políticas, privilegios, RLS y los atributos y permisos del reporte; la columna nueva no se concede", async () => {
    expect(await permisosDeLaBase()).toEqual(permisosAntes)
    expect(
      (await filas(`select grantee from information_schema.column_privileges
                     where table_schema = 'public' and table_name = 'regalias_venta' and column_name = 'precio_unitario'
                       and grantee in ('anon', 'authenticated', 'PUBLIC')`)).length
    ).toBe(0)
  })

  it("aplicarla otra vez no cambia nada", async () => {
    await aplicarMigracion(contexto.db, MIGRACION)

    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await filas(`select ${COLUMNAS_0054}, precio_unitario from regalias_venta order by id`)).toEqual(regaliasAntes.map((f) => ({ ...f, precio_unitario: null })))
    expect(await permisosDeLaBase()).toEqual(permisosAntes)
  })

  it("una regalía nueva guarda su precio; el período mezcla la de antes (sin precio) y la nueva", async () => {
    const nueva = await regalar()
    const valores = (await reporte(contexto.e.admin.authId)).map((f) => [f.venta_id, f.cantidad, f.precio_unitario, f.valor_comercial])

    expect(valores).toEqual([
      [entregada.venta_id, 2, null, null],
      [nueva.venta_id, 2, "100.00", "200.00"],
    ])
  })
})
