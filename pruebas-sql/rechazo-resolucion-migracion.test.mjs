/*
  0048 aplicada sobre una base que ya tiene la 0047 y operaciones, como en
  producción: ventas al contado y a crédito con abono, pedidos facturados y
  pendientes (efectivo, tarjeta y crédito con pago parcial) y liquidaciones por
  confirmar y confirmadas. Los recorridos de rechazo y resolución están en
  rechazo-resolucion-pedidos.test.mjs.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll } from "vitest"

import { aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { baseConOperaciones, venderComoLaVersionPublicada } from "./migracion-sobre-operaciones.mjs"

const contexto = baseConOperaciones("0047_caja_fila_sin_ubicacion.sql")

// Las que la 0048 renombra a <nombre>_base y envuelve, y la que reemplaza.
const ENVUELTAS = ["saldos_de_pedidos", "detalle_de_pedido", "avisos_de_pedidos", "reporte_diario_de_caja", "reporte_medios_de_caja"]
const REEMPLAZADAS = ["pedido_solo_avanza"]

async function foto() {
  const filas = async (consulta) => (await contexto.db.query(consulta)).rows
  const todo = (tabla) => filas(`select to_jsonb(x) as fila from ${tabla} x order by id`)

  return {
    ventas: await todo("ventas"),
    detalle_venta: await todo("detalle_venta"),
    pagos: await todo("pagos"),
    abonos: await todo("abonos"),
    cobros: await todo("cobros_por_medio"),
    pedidos: await todo("pedidos_ubicacion"),
    pedido_detalle: await todo("pedido_detalle"),
    // Las columnas que ya existían: la 0048 agrega dos vacías.
    eventos: await filas("select id, empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle, creado_en from eventos_de_pedido order by id"),
    lecturas: await filas("select * from pedido_lecturas order by pedido_id, usuario_id"),
    movimientos: await todo("movimientos_inventario"),
    liquidaciones: await todo("liquidaciones_ubicacion"),
    liquidacion_detalle: await todo("liquidacion_detalle"),
    empresas: await todo("empresas"),
    permisos: await filas("select * from permisos_usuario order by usuario_id, seccion"),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
  }
}

const funciones = async () =>
  Object.fromEntries(
    (
      await contexto.db.query(`
        select p.proname as nombre, md5(replace(p.prosrc, chr(13), '')) as cuerpo, p.proconfig::text as config, p.prosecdef as definer
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace`)
    ).rows.map((f) => [f.nombre, { cuerpo: f.cuerpo, config: f.config, definer: f.definer }])
  )

describe("la 0048 sobre una base con operaciones, pedidos y liquidaciones", () => {
  let antes
  let funcionesAntes
  let salidasAntes
  let pendiente
  let entrega

  const como = (authId, consulta, valores) => consultarComo(contexto.db, authId, consulta, valores)
  const r = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0].r

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
    await como(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'credito', p_cobros => '[]'::jsonb, p_cliente_id => $2) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 2 }]), e.clienteId]
    )
    await db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing", [e.vendedor.usuario, e.empresa])
    await como(e.vendedor.authId, `select public.registrar_pago_con_medios($1, 50, '[{"medio":"efectivo","monto":50}]'::jsonb, 'abono-antes') as r`, [e.clienteId])

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

    await pedir("contado", [{ medio: "tarjeta", monto: 115, referencia: "", tasa: 1.7, cargo: 1.96 }])
    pendiente = await pedir("contado", [{ medio: "efectivo", monto: 115 }])

    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [contado.pedido_id])
    await r(e.vendedor.authId, "select public.facturar_pedido($1) as r", [credito.pedido_id])

    // Una liquidación confirmada y otra por confirmar, del administrador.
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

    await aplicarMigracion(db, "0048_rechazo_resolucion_pedidos.sql")
  })

  it("no cambia ninguna fila comercial", async () => {
    expect(antes.ventas.length).toBeGreaterThanOrEqual(4)
    expect(antes.pedidos).toHaveLength(4)
    expect(antes.liquidaciones).toHaveLength(2)
    expect(await foto()).toEqual(antes)
  })

  it("las envueltas conservan su código exacto con el sufijo _base; las demás funciones no cambian", async () => {
    const despues = await funciones()

    for (const nombre of ENVUELTAS) {
      expect(despues[`${nombre}_base`]).toEqual(funcionesAntes[nombre])
    }

    for (const [nombre, f] of Object.entries(funcionesAntes)) {
      if (!ENVUELTAS.includes(nombre) && !REEMPLAZADAS.includes(nombre)) expect([nombre, despues[nombre]]).toEqual([nombre, f])
    }
  })

  it("con los pedidos y liquidaciones que ya existen, reportes, liquidaciones, bandeja y avisos dan lo mismo", async () => {
    const despues = await salidas()

    expect(despues.diario).toEqual(salidasAntes.diario)
    expect(despues.medios).toEqual(salidasAntes.medios)
    expect(despues.control).toEqual(salidasAntes.control)
    expect(despues.bandeja).toEqual(salidasAntes.bandeja)

    // Los avisos agregan los pedidos por resolver (ninguno) y marcan el estado de cada aviso.
    expect(despues.avisos).toMatchObject({ pendientes: salidasAntes.avisos.pendientes, sin_leer: salidasAntes.avisos.sin_leer, por_resolver: 0, por_resolver_sin_leer: 0 })
    expect(despues.avisos.ultimos).toEqual(salidasAntes.avisos.ultimos.map((u) => ({ ...u, estado: "pendiente" })))

    // El detalle agrega lo nuevo; lo de antes sigue igual, y la historia trae más datos de cada evento.
    const { eventos: eventosAntes, ...restoAntes } = salidasAntes.detalle

    expect(despues.detalle).toMatchObject(restoAntes)
    expect(despues.detalle.eventos).toEqual(eventosAntes.map((ev) => expect.objectContaining(ev)))
    expect(despues.detalle).toMatchObject({ puede_rechazar: true, puede_resolver: false, rechazo: null })
  })

  it("nadie recibe permisos y la regla de origen distinto de destino pasa a revisarse al confirmar", async () => {
    const { rows } = await contexto.db.query(`
      select (select count(*) from permisos_usuario where seccion = 'orders-resolve')::int as resolver,
             (select count(*) from pg_constraint where conname = 'pedidos_origen_distinto_destino')::int as restriccion,
             (select count(*) from pg_trigger where tgname = 'pedido_en_su_origen_sale_facturado' and tgdeferrable and tginitdeferred)::int as disparador`)

    // El único «Resolver» es el que esta prueba le dio a quien entrega.
    expect(rows[0]).toEqual({ resolver: 1, restriccion: 0, disparador: 1 })
  })

  it("aplicarla otra vez no cambia nada", async () => {
    const datos = await foto()
    const codigo = await funciones()

    await aplicarMigracion(contexto.db, "0048_rechazo_resolucion_pedidos.sql")

    expect(await foto()).toEqual(datos)
    expect(await funciones()).toEqual(codigo)
  })

  it("el pedido pendiente de antes se rechaza y se factura en origen; las ventas siguen como siempre", async () => {
    const { e } = contexto

    await r(e.vendedor.authId, "select public.rechazar_pedido($1, 'Era de Camión 02', $2) as r", [pendiente.pedido_id, randomUUID()])

    const f = await r(entrega.authId, "select public.resolver_pedido($1, 'facturar_en_origen', null, '', $2) as r", [pendiente.pedido_id, randomUUID()])

    expect(f).toMatchObject({ estado: "facturado", destino: "Camión 02" })

    const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])
    const repetida = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }], "antes-1")

    expect(nueva.venta_id).toBeTruthy()
    expect(repetida.venta_id).toBe(antes.ventas.find((v) => v.fila.clave_idempotencia === "antes-1").fila.id)
  })
})
