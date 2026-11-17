/*
  0049 aplicada sobre una base que ya tiene la 0048 y operaciones, como en
  producción: ventas, abono, pedidos facturados y pendientes (efectivo, tarjeta,
  crédito con pago parcial), uno facturado en origen (C1) y liquidaciones. Los
  recorridos de cancelación están en cancelacion-pedidos.test.mjs.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0048_rechazo_resolucion_pedidos.sql")

// Las dos que la 0049 renombra a <nombre>_sin_reembolsos y envuelve, y las que reemplaza.
const ENVUELTAS = ["reporte_diario_de_caja", "reporte_medios_de_caja"]
const REEMPLAZADAS = ["pedido_solo_avanza", "saldos_de_pedidos"]

async function foto() {
  const filas = async (consulta) => (await contexto.db.query(consulta)).rows
  const todo = (tabla, sin = "") => filas(`select to_jsonb(x) ${sin} as fila from ${tabla} x order by id`)

  return {
    ventas: await todo("ventas"),
    pagos: await todo("pagos"),
    abonos: await todo("abonos"),
    cobros: await todo("cobros_por_medio"),
    pedidos: await todo("pedidos_ubicacion"),
    pedido_detalle: await todo("pedido_detalle"),
    eventos: await todo("eventos_de_pedido"),
    // La 0049 agrega una columna vacía.
    movimientos: await todo("movimientos_inventario", "- 'recepcion_id'"),
    liquidaciones: await todo("liquidaciones_ubicacion"),
    liquidacion_detalle: await todo("liquidacion_detalle"),
    permisos: await filas("select * from permisos_usuario order by usuario_id, seccion"),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
  }
}

const funciones = async () =>
  Object.fromEntries(
    (
      await contexto.db.query(`
        select p.proname as nombre, md5(replace(p.prosrc, chr(13), '')) as cuerpo, p.proconfig::text as config, p.prosecdef as definer
          from pg_proc p where p.pronamespace = 'public'::regnamespace`)
    ).rows.map((f) => [f.nombre, { cuerpo: f.cuerpo, config: f.config, definer: f.definer }])
  )

describe("la 0049 sobre una base con operaciones, pedidos, C1 y liquidaciones", () => {
  let antes
  let funcionesAntes
  let salidasAntes
  let pendiente
  let entrega

  const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r

  async function salidas() {
    const { e } = contexto

    return {
      diario: await r(e.admin.authId, "select public.reporte_diario_de_caja() as r"),
      medios: await r(e.admin.authId, "select public.reporte_medios_de_caja() as r"),
      control: await r(e.admin.authId, "select public.control_de_liquidaciones() as r"),
      avisos: await r(e.vendedor.authId, "select public.avisos_de_pedidos() as r"),
      detalle: await r(e.vendedor.authId, "select public.detalle_de_pedido($1) as r", [pendiente.pedido_id]),
      bandeja: await r(e.vendedor.authId, "select public.bandeja_de_pedidos('recibidos', 'todos') as r"),
    }
  }

  beforeAll(async () => {
    const { db, e } = contexto

    await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }], "antes-1")
    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing", [e.vendedor.usuario, e.empresa])

    // Camión 02 entrega y cobra; Camión 01 factura.
    entrega = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos", "orders-resolve"] })

    const pedir = (forma, cobros) =>
      r(
        entrega.authId,
        `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
           p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
        [e.camion1, e.clienteId, JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
      )

    const contado = await pedir("contado", [{ medio: "efectivo", monto: 115 }])
    const credito = await pedir("credito", [{ medio: "efectivo", monto: 40 }])
    const enOrigen = await pedir("contado", [{ medio: "tarjeta", monto: 115, referencia: "", tasa: 1.7, cargo: 1.96 }])

    pendiente = await pedir("contado", [{ medio: "efectivo", monto: 115 }])

    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [contado.pedido_id])
    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [credito.pedido_id])

    // C1: rechazado y facturado en origen.
    await r(e.vendedor.authId, "select public.rechazar_pedido($1, 'Es de Camión 02', $2) as r", [enOrigen.pedido_id, randomUUID()])
    await r(entrega.authId, "select public.resolver_pedido($1, 'facturar_en_origen', null, '', $2) as r", [enOrigen.pedido_id, randomUUID()])

    const liquidar = (monto) =>
      r(
        e.admin.authId,
        `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $4) as r`,
        [e.camion2, e.camion1, monto, randomUUID()]
      )

    const confirmada = await liquidar(115)

    await r(e.admin.authId, "select public.resolver_liquidacion($1, true) as r", [confirmada.id])
    await liquidar(20)

    antes = await foto()
    funcionesAntes = await funciones()
    salidasAntes = await salidas()

    await aplicarMigracion(db, "0049_cancelacion_pedidos_interubicacion.sql")
  })

  it("no cambia ninguna fila comercial", async () => {
    expect(antes.pedidos).toHaveLength(4)
    expect(antes.liquidaciones).toHaveLength(2)
    expect(await foto()).toEqual(antes)
  })

  it("los reportes de la 0048 conservan su código con el sufijo _sin_reembolsos; las demás funciones no cambian", async () => {
    const despues = await funciones()

    for (const nombre of ENVUELTAS) {
      expect(despues[`${nombre}_sin_reembolsos`]).toEqual(funcionesAntes[nombre])
    }

    for (const [nombre, f] of Object.entries(funcionesAntes)) {
      if (!ENVUELTAS.includes(nombre) && !REEMPLAZADAS.includes(nombre)) expect([nombre, despues[nombre]]).toEqual([nombre, f])
    }
  })

  it("sin cancelaciones, reportes, liquidaciones, bandeja, avisos y detalle dan exactamente lo mismo", async () => {
    expect(await salidas()).toEqual(salidasAntes)
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()
    const codigo = await funciones()

    await aplicarMigracion(contexto.db, "0049_cancelacion_pedidos_interubicacion.sql")

    expect(await foto()).toEqual(datos)
    expect(await funciones()).toEqual(codigo)
  })

  it("el pedido pendiente de antes se cancela, y lo demás sigue igual: C1, facturar y vender", async () => {
    const { e, db } = contexto
    const admin = e.admin

    const c = await r(admin.authId, "select public.cancelar_pedido($1, 'Cancelado tras la migración', null, $2::jsonb, $3) as r", [
      pendiente.pedido_id,
      JSON.stringify([{ medio: "efectivo", importe: 115, ubicacion_id: e.camion2 }]),
      randomUUID(),
    ])

    expect(c.estado).toBe("cancelado")
    expect((await r(admin.authId, "select public.control_de_liquidaciones() as r")).pedidos.find((p) => p.pedido_id === pendiente.pedido_id)).toBeUndefined()

    const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    expect(nueva.venta_id).toBeTruthy()
    expect((await db.query("select count(*)::int as n from ventas where pedido_id is not null")).rows[0].n).toBe(3)
  })
})
