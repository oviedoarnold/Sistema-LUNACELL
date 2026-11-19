/*
  0050 aplicada sobre una base que ya tiene la 0049 y operaciones, como en
  producción: ventas, pedidos facturados y pendientes, uno facturado en origen
  (C1), liquidaciones confirmadas y por confirmar, y pedidos cancelados con
  C2a (uno devuelto por el origen y otro por el destino). Los recorridos de
  C2b están en contraliquidaciones.test.mjs.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0049_cancelacion_pedidos_interubicacion.sql")

const REEMPLAZADAS = ["saldos_de_pedidos", "registrar_liquidacion", "reembolsar_al_cliente", "cancelar_pedido", "cancelacion_de_pedido", "control_de_liquidaciones"]
const NUEVAS = ["obligaciones_de_pedidos", "liquidaciones_por_confirmar_del_pedido"]

async function foto() {
  const filas = async (consulta) => (await contexto.db.query(consulta)).rows
  const todo = (tabla) => filas(`select to_jsonb(x) as fila from ${tabla} x order by id`)

  return {
    ventas: await todo("ventas"),
    pagos: await todo("pagos"),
    abonos: await todo("abonos"),
    cobros: await todo("cobros_por_medio"),
    pedidos: await todo("pedidos_ubicacion"),
    pedido_detalle: await todo("pedido_detalle"),
    eventos: await todo("eventos_de_pedido"),
    movimientos: await todo("movimientos_inventario"),
    liquidaciones: await todo("liquidaciones_ubicacion"),
    liquidacion_detalle: await todo("liquidacion_detalle"),
    cancelaciones: await todo("cancelaciones_de_pedido"),
    reembolsos: await todo("reembolsos_de_pedido"),
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

// La pantalla de liquidaciones sin lo que la 0050 le agrega (motivo, pedido real, contraliquidación).
const sinLoNuevo = (control) => ({
  pares: control.pares.map(({ por_cancelaciones, ...par }) => par),
  pedidos: control.pedidos.map(({ motivo, pedido_origen_id, pedido_origen, pedido_destino_id, pedido_destino, ...pedido }) => pedido),
  liquidaciones: control.liquidaciones.map(({ contraliquidacion, ...l }) => ({ ...l, pedidos: l.pedidos.map(({ motivo, ...p }) => p) })),
})

describe("la 0050 sobre una base con operaciones, pedidos, C1, liquidaciones y cancelaciones de C2a", () => {
  let antes
  let funcionesAntes
  let salidasAntes
  let pendiente
  let devueltoPorElDestino

  const r = async (authId, consulta, valores) => (await consultarComo(contexto.db, authId, consulta, valores)).rows[0].r

  async function salidas() {
    const { e } = contexto

    return {
      diario: await r(e.admin.authId, "select public.reporte_diario_de_caja() as r"),
      medios: await r(e.admin.authId, "select public.reporte_medios_de_caja() as r"),
      control: sinLoNuevo(await r(e.admin.authId, "select public.control_de_liquidaciones() as r")),
      avisos: await r(e.vendedor.authId, "select public.avisos_de_pedidos() as r"),
      detalle: await r(e.vendedor.authId, "select public.detalle_de_pedido($1) as r", [pendiente.pedido_id]),
      bandeja: await r(e.vendedor.authId, "select public.bandeja_de_pedidos('recibidos', 'todos') as r"),
    }
  }

  beforeAll(async () => {
    const { db, e } = contexto

    await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }], "antes-1")

    // Camión 02 entrega y cobra; Camión 01 factura.
    const entrega = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos", "orders-resolve"] })

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
    const devueltoPorElOrigen = await pedir("contado", [{ medio: "efectivo", monto: 115 }])

    devueltoPorElDestino = await pedir("contado", [{ medio: "efectivo", monto: 115 }])
    pendiente = await pedir("contado", [{ medio: "efectivo", monto: 115 }])

    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [contado.pedido_id])
    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [credito.pedido_id])

    // C1: rechazado y facturado en origen.
    await r(e.vendedor.authId, "select public.rechazar_pedido($1, 'Es de Camión 02', $2) as r", [enOrigen.pedido_id, randomUUID()])
    await r(entrega.authId, "select public.resolver_pedido($1, 'facturar_en_origen', null, '', $2) as r", [enOrigen.pedido_id, randomUUID()])

    // C2a: uno lo devuelve el origen y otro el destino (Camión 02 le debe a Camión 01).
    const cancelar = (pedido, desde) =>
      r(e.admin.authId, "select public.cancelar_pedido($1, 'Cancelado con C2a', null, $2::jsonb, $3) as r", [
        pedido,
        JSON.stringify([{ medio: "efectivo", importe: 115, ubicacion_id: desde }]),
        randomUUID(),
      ])

    await cancelar(devueltoPorElOrigen.pedido_id, e.camion2)
    await cancelar(devueltoPorElDestino.pedido_id, e.camion1)

    const liquidar = (monto, pedido = null) =>
      r(
        e.admin.authId,
        `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo',
           p_pedido => $4, p_clave_idempotencia => $5) as r`,
        [e.camion2, e.camion1, monto, pedido, randomUUID()]
      )

    const confirmada = await liquidar(115, contado.pedido_id)

    await r(e.admin.authId, "select public.resolver_liquidacion($1, true) as r", [confirmada.id])
    await liquidar(20, credito.pedido_id)

    antes = await foto()
    funcionesAntes = await funciones()
    salidasAntes = await salidas()

    await aplicarMigracion(db, "0050_contraliquidaciones_entre_ubicaciones.sql")
  })

  it("no cambia ninguna fila", async () => {
    expect(antes.pedidos).toHaveLength(6)
    expect(antes.liquidaciones).toHaveLength(2)
    expect(antes.cancelaciones).toHaveLength(2)
    expect(await foto()).toEqual(antes)
  })

  it("solo cambian las funciones que reemplaza; agrega dos piezas internas que la aplicación no ejecuta", async () => {
    const despues = await funciones()

    for (const [nombre, f] of Object.entries(funcionesAntes)) {
      if (!REEMPLAZADAS.includes(nombre)) expect([nombre, despues[nombre]]).toEqual([nombre, f])
    }

    for (const nombre of REEMPLAZADAS) expect(despues[nombre].cuerpo).not.toBe(funcionesAntes[nombre].cuerpo)

    for (const nombre of NUEVAS) {
      expect(funcionesAntes[nombre]).toBeUndefined()
      // Como las demás piezas internas: security definer y search_path vacío.
      expect(despues[nombre]).toMatchObject({ definer: true, config: funcionesAntes.saldos_de_pedidos.config })

      const { rows } = await contexto.db.query(
        `select has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
        [nombre]
      )

      expect(rows[0]).toEqual({ auth: false, anon: false })
    }
  })

  it("reportes, bandeja, avisos y detalle dan exactamente lo mismo; liquidaciones, lo mismo más lo nuevo", async () => {
    expect(await salidas()).toEqual(salidasAntes)
  })

  it("la obligación que ya había por un cancelado de C2a sigue igual, ahora con su motivo", async () => {
    const { e } = contexto
    const control = await r(e.admin.authId, "select public.control_de_liquidaciones() as r")
    const lineas = control.pedidos.filter((p) => p.pedido_id === devueltoPorElDestino.pedido_id)

    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({ origen_id: e.camion2, destino_id: e.camion1, motivo: "cancelacion", estado: "cancelado" })
    expect([Number(lineas[0].efectivo), Number(lineas[0].pendiente)]).toEqual([115, 115])
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()
    const codigo = await funciones()

    await aplicarMigracion(contexto.db, "0050_contraliquidaciones_entre_ubicaciones.sql")

    expect(await foto()).toEqual(datos)
    expect(await funciones()).toEqual(codigo)
  })

  it("el pedido pendiente se cancela y su efectivo lo devuelve una tercera ubicación; vender sigue igual", async () => {
    const { e, db } = contexto
    const admin = e.admin

    await r(admin.authId, "select public.cancelar_pedido($1, 'Cancelado tras la migración', null, '[]'::jsonb, $2) as r", [pendiente.pedido_id, randomUUID()])

    const tercera = (await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Tienda centro', 'tienda') returning id", [e.empresa])).rows[0].id

    await r(admin.authId, "select public.registrar_reembolso_de_pedido($1, 'efectivo', 115, $2, 'Recibo 1', $3) as r", [pendiente.pedido_id, tercera, randomUUID()])

    const lineas = (await r(admin.authId, "select public.control_de_liquidaciones() as r")).pedidos.filter((p) => p.pedido_id === pendiente.pedido_id)

    expect(lineas.map((p) => [p.origen, p.destino, Number(p.pendiente)])).toEqual([["Camión 02", "Tienda centro", 115]])

    const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

    expect(nueva.venta_id).toBeTruthy()
  })
})
