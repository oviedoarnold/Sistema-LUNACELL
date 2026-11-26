/*
  0056 aplicada sobre una base con la 0055 y operaciones, como en producción:
  ventas, una regalía y traslados ya aplicados con la versión anterior. Los
  traslados históricos quedan intactos («aplicado», sin receptor inventado) y
  no se pueden confirmar; ninguna fila ni función de ventas, pedidos,
  regalías o liquidaciones cambia; la versión publicada sigue enviando.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { baseConOperaciones, fotoDeDatos, venderComoLaVersionPublicada, firmaDe, cuerpoDe } from "./migracion-sobre-operaciones.mjs"
import { crearVendedor } from "./fixtures.mjs"

const contexto = baseConOperaciones("0055_precio_de_regalias.sql")
const MIGRACION = "0056_recepcion_de_traslados.sql"
const TABLAS = ["pagos", "abonos", "movimientos_inventario", "anulaciones_venta", "devoluciones_de_venta", "pedidos_ubicacion", "regalias_venta"]
const SIN_CAMBIOS = [
  "registrar_venta_ubicacion", "registrar_venta_con_medios", "registrar_venta_con_regalias", "aplicar_precios_negociados",
  "anular_venta", "registrar_devolucion_de_venta", "registrar_pago_cliente", "recibir_venta_sin_conexion",
  "entregar_pedido", "facturar_pedido", "anular_factura_de_pedido", "registrar_liquidacion", "registrar_movimiento_ubicacion",
  "asignar_numero_de_traslado", "numero_de_traslado_inmutable", "usuario_tiene_permiso", "empresa_del_usuario",
]
const DETALLE = "select traslado_id, empresa_id, producto_id, cantidad from traslado_detalle order by 1, 3"
const COLUMNAS_ANTES = "id, empresa_id, origen_id, destino_id, usuario_id, estado, nota, clave_idempotencia, creado_en, correlativo, numero"

const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r
const filas = async (consulta, valores) => (await contexto.db.query(consulta, valores)).rows
const falla = (promesa) => promesa.then(() => null, (error) => error)

const trasladar = (authId, origen, destino, cantidad, clave = null) =>
  r(authId, "select registrar_traslado($1, $2, $3::jsonb, 'Histórico', $4) as r",
    [origen, destino, JSON.stringify([{ producto_id: contexto.e.cargador.id, cantidad }]), clave])

const permisosDeLaBase = async () => ({
  politicas: await filas("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2"),
  tablas: await filas("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3"),
  columnas: await filas(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
                          where table_schema = 'public' and table_name <> 'traslados' order by 1, 2, 3, 4`),
  asignados: await filas("select usuario_id, empresa_id, seccion from permisos_usuario order by 1, 3"),
  rls: await filas("select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1"),
  registrar: await filas(`select proacl::text, prosecdef, proconfig, pg_get_function_arguments(oid) as argumentos, pg_get_function_result(oid) as resultado
                            from pg_proc where oid = 'public.registrar_traslado(uuid,uuid,jsonb,text,text)'::regprocedure`),
})

describe("la 0056 sobre una base con la 0055, ventas, una regalía y traslados aplicados", () => {
  let antes
  let trasladosAntes
  let detalleAntes
  let permisosAntes
  let cuerpos
  let historico
  let clave

  beforeAll(async () => {
    const { db, e } = contexto

    await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])
    clave = randomUUID()
    historico = await trasladar(e.admin.authId, e.camion1, e.camion2, 4, clave)
    await trasladar(e.admin.authId, e.camion1, e.camion2, 2)

    antes = await fotoDeDatos(contexto, { tablas: TABLAS })
    trasladosAntes = await filas(`select ${COLUMNAS_ANTES} from traslados order by correlativo`)
    detalleAntes = await filas(DETALLE)
    permisosAntes = await permisosDeLaBase()
    cuerpos = Object.fromEntries(await Promise.all(SIN_CAMBIOS.map(async (n) => [n, await cuerpoDe(db, await firmaDe(db, n))])))

    expect(historico.estado).toBe("aplicado")

    await aplicarMigracion(db, MIGRACION)
  })

  it("no cambia ninguna fila: los traslados históricos siguen «aplicado», sin receptor ni contenido inventados", async () => {
    expect(await fotoDeDatos(contexto, { tablas: TABLAS })).toEqual(antes)
    expect(await filas(`select ${COLUMNAS_ANTES} from traslados order by correlativo`)).toEqual(trasladosAntes)
    expect(await filas(DETALLE)).toEqual(detalleAntes)
    expect(
      await filas(`select estado, unidades, contenido_huella, recibido_por, recibido_en, confirmacion_administrativa, incidencia
                     from traslados order by correlativo`)
    ).toEqual(trasladosAntes.map(() => ({
      estado: "aplicado", unidades: null, contenido_huella: null, recibido_por: null, recibido_en: null, confirmacion_administrativa: false, incidencia: null,
    })))
  })

  it("no cambia las funciones de vender, regalar, cobrar, anular, pedidos, liquidaciones ni el número de traslado", async () => {
    const { db } = contexto

    for (const n of SIN_CAMBIOS) expect([n, await cuerpoDe(db, await firmaDe(db, n))]).toEqual([n, cuerpos[n]])
  })

  it("conserva políticas, privilegios, RLS y los argumentos, atributos y permisos de registrar_traslado", async () => {
    expect(await permisosDeLaBase()).toEqual(permisosAntes)
  })

  it("un traslado histórico no se confirma, no se reporta y no cambia de estado", async () => {
    const { db, e } = contexto
    const receptor = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["inventory-own"] })

    expect((await falla(r(receptor.authId, "select confirmar_recepcion_traslado($1) as r", [historico.traslado_id]))).code).toBe("LT011")
    expect((await falla(r(receptor.authId, "select reportar_incidencia_traslado($1, 'Nota de prueba') as r", [historico.traslado_id]))).code).toBe("LT011")
    expect((await falla(db.query("update traslados set estado = 'pendiente' where id = $1", [historico.traslado_id]))).code).toBe("42501")
    expect(await filas(`select ${COLUMNAS_ANTES} from traslados order by correlativo`)).toEqual(trasladosAntes)
  })

  it("la versión publicada sigue enviando con los mismos argumentos y la misma forma de respuesta; ahora queda pendiente", async () => {
    const { e } = contexto
    const nuevo = await trasladar(e.admin.authId, e.camion1, e.camion2, 1)

    expect(Object.keys(nuevo).sort()).toEqual(["destino_id", "estado", "items", "origen_id", "repetida", "traslado_id"])
    expect(nuevo.estado).toBe("pendiente")
    expect((await trasladar(e.admin.authId, e.camion1, e.camion2, 4, clave))).toMatchObject({ traslado_id: historico.traslado_id, estado: "aplicado", repetida: true })
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const { db } = contexto
    const traslados = await filas("select * from traslados order by correlativo")
    const permisos = await permisosDeLaBase()

    await aplicarMigracion(db, MIGRACION)

    expect(await filas("select * from traslados order by correlativo")).toEqual(traslados)
    expect(await permisosDeLaBase()).toEqual(permisos)
  })
})
