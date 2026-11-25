/*
  0054 aplicada sobre una base con la 0053 y operaciones, como en producción:
  ventas de contado y a crédito, un abono y una venta anulada. No debe cambiar
  ninguna fila, ningún reporte, ninguna función de vender, cobrar, anular,
  devolver, pedidos o traslados, ni los permisos y políticas que ya existían.
  Nadie recibe el permiso nuevo.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { baseConOperaciones, fotoDeDatos, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0053_numero_de_traslado.sql")
const MIGRACION = "0054_regalias.sql"
const TABLAS = ["pagos", "abonos", "movimientos_inventario", "anulaciones_venta", "devoluciones_de_venta", "pedidos_ubicacion", "traslados"]
const SIN_CAMBIOS = [
  "registrar_venta_ubicacion", "registrar_venta_con_medios", "aplicar_precios_negociados", "anular_venta",
  "registrar_devolucion_de_venta", "registrar_pago_cliente", "recibir_venta_sin_conexion",
  "entregar_pedido", "facturar_pedido", "anular_factura_de_pedido", "registrar_traslado",
]
const NUEVAS = "('regalias_venta')"

const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r

// Políticas y privilegios de lo que ya existía: la tabla nueva queda fuera.
async function permisosDeLaBase() {
  const { db } = contexto
  const filas = async (consulta) => (await db.query(consulta)).rows

  return {
    politicas: await filas(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
                             where schemaname = 'public' and tablename not in ${NUEVAS} order by 1, 2`),
    tablas: await filas(`select table_name, grantee, privilege_type from information_schema.role_table_grants
                          where table_schema = 'public' and table_name not in ${NUEVAS} order by 1, 2, 3`),
    columnas: await filas(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                            where table_schema = 'public' and table_name not in ${NUEVAS} order by 1, 2, 3, 4`),
    asignados: await filas("select usuario_id, empresa_id, seccion from permisos_usuario order by 1, 3"),
    rls: await filas(`select relname, relrowsecurity from pg_class
                       where relnamespace = 'public'::regnamespace and relkind = 'r' and relname not in ${NUEVAS} order by 1`),
  }
}

describe("la 0054 sobre una base con ventas, cobros y anulaciones", () => {
  let antes
  let reportesAntes
  let permisosAntes
  let cuerpos
  let contado

  const reportes = async () => ({
    diario: await r(contexto.e.admin.authId, "select public.reporte_diario_de_caja() as r"),
    medios: await r(contexto.e.admin.authId, "select public.reporte_medios_de_caja() as r"),
  })

  beforeAll(async () => {
    const { db, e } = contexto

    contado = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])
    const anulada = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    await r(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'credito', p_cobros => '[]'::jsonb, p_cliente_id => $2,
         p_fecha_vencimiento => '2030-01-01', p_clave_idempotencia => $3) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 2 }]), e.clienteId, randomUUID()]
    )
    await r(e.admin.authId, "select registrar_pago_cliente($1, 100) as r", [e.clienteId])
    await r(e.admin.authId, "select public.anular_venta($1, 'Venta de prueba anulada', null, $2) as r", [anulada.venta_id, randomUUID()])

    antes = await fotoDeDatos(contexto, { tablas: TABLAS })
    reportesAntes = await reportes()
    permisosAntes = await permisosDeLaBase()
    cuerpos = Object.fromEntries(await Promise.all(SIN_CAMBIOS.map(async (n) => [n, await cuerpoDe(db, await firmaDe(db, n))])))

    await aplicarMigracion(db, MIGRACION)
  })

  it("27. no cambia ninguna fila, ningún reporte ni las funciones de vender, cobrar, anular, devolver, pedidos y traslados", async () => {
    const { db } = contexto

    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await reportes()).toEqual(reportesAntes)

    for (const n of SIN_CAMBIOS) expect([n, await cuerpoDe(db, await firmaDe(db, n))]).toEqual([n, cuerpos[n]])
  })

  it("no amplía políticas, privilegios ni RLS de lo que ya existía, y nadie recibe el permiso nuevo", async () => {
    expect(await permisosDeLaBase()).toEqual(permisosAntes)
    expect(Number((await contexto.db.query("select count(*) as n from permisos_usuario where seccion = 'regalias'")).rows[0].n)).toBe(0)
  })

  it("aplicarla otra vez no cambia nada", async () => {
    await aplicarMigracion(contexto.db, MIGRACION)
    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await permisosDeLaBase()).toEqual(permisosAntes)
  })

  it("una venta de antes se anula como siempre, y regalar exige el permiso que nadie tiene", async () => {
    const { db, e } = contexto
    const anulada = await r(e.admin.authId, "select public.anular_venta($1, 'Anulada después de migrar', null, $2) as r", [contado.venta_id, randomUUID()])

    expect(anulada.estado).toBe("anulada")

    const regalar = () =>
      r(
        e.vendedor.authId,
        `select public.registrar_venta_con_regalias(p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb,
           p_regalias => $1::jsonb, p_motivo_regalia => 'cliente_frecuente', p_cliente_id => $3, p_clave_idempotencia => $4) as r`,
        [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify([{ medio: "efectivo", monto: 115 }]), e.clienteId, randomUUID()]
      )

    await expect(regalar()).rejects.toMatchObject({ code: "42501" })

    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'regalias')", [e.vendedor.usuario, e.empresa])
    expect((await regalar()).regalias).toEqual([{ producto_id: e.cargador.id, cantidad: 1 }])
  })
})
