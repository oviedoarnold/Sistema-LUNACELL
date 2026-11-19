/*
  0052 contra PostgreSQL de verdad: devoluciones después de facturar (C4) y
  ajustes de crédito (C5). La factura A + B + C (L 200, L 300, L 500) suma
  L 1,000 con ISV 0; los casos de ISV usan 15 %. Bodega vende; Ruta local y
  Camión 01 son otras ubicaciones. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"

import { comoUsuario, enDosSesiones, esperarBloqueo } from "./arnes.mjs"
import { usarBaseDePrueba, num, falla, empresaConTresUbicaciones } from "./ayudantes.mjs"
import { crearEmpresa, crearVendedor, deudaDe, contar } from "./fixtures.mjs"

let base
let db

const { fila } = usarBaseDePrueba((levantada) => {
  base = levantada
  db = levantada.admin
})

async function escenario({ tasaIsv = 0 } = {}) {
  const e = await empresaConTresUbicaciones(db, { nombre: "Lunacell C4", tasaIsv, existencia: 100, nombreCliente: "Cliente C4" })
  const producto = async (nombre, precio) => {
    const id = (await db.query("insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, $3, $4, 1) returning id", [e.empresa, `P-${randomUUID().slice(0, 8)}`, nombre, precio])).rows[0].id

    await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 100)", [e.empresa, e.bodega, id])

    return id
  }

  return {
    ...e,
    A: await producto("Producto A", 200),
    B: await producto("Producto B", 300),
    C: await producto("Producto C", 500),
    vendeBodega: await e.vendedor(e.bodega, ["pos", "sales-history"]),
    devuelveBodega: await e.vendedor(e.bodega, ["pos", "sales-history", "sales-return"]),
    devuelveRuta: await e.vendedor(e.ruta, ["pos", "sales-history", "sales-return"]),
    anulaBodega: await e.vendedor(e.bodega, ["pos", "sales-history", "sales-void"]),
  }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const tarjeta = (monto) => ({ medio: "tarjeta", monto, referencia: "AUT-1", tasa: 1.7, cargo: Math.round(monto * 1.7) / 100 })

// Una factura de Bodega: A + B + C por omisión.
const vender = (e, { items = [[e.A, 1], [e.B, 1], [e.C, 1]], forma = "contado", cobros = forma === "contado" ? [efectivo(1000)] : [] } = {}) =>
  fila(
    e.vendeBodega.authId,
    `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
       p_fecha_vencimiento => $5, p_clave_idempotencia => $6) as r`,
    [JSON.stringify(items.map(([producto_id, cantidad]) => ({ producto_id, cantidad }))), forma, JSON.stringify(cobros), e.cliente, forma === "credito" ? "2030-01-01" : null, randomUUID()]
  )

const devolver = (quien, venta, productos, { ubicacion = null, motivo = "El cliente lo devolvió", clave = randomUUID() } = {}) =>
  fila(quien.authId, "select public.registrar_devolucion_de_venta($1, $2, $3::jsonb, $4, $5) as r", [
    venta,
    motivo,
    JSON.stringify(productos.map(([producto_id, cantidad, condicion = "buen_estado"]) => ({ producto_id, cantidad, condicion }))),
    ubicacion,
    clave,
  ])

const reembolsar = (quien, venta, { medio = "efectivo", importe, referencia = "", clave = randomUUID() }) =>
  fila(quien.authId, "select public.registrar_reembolso_de_venta($1, $2, $3, $4, $5) as r", [venta, medio, importe, referencia, clave])

const info = (quien, venta) => fila(quien.authId, "select public.devolucion_de_venta($1) as r", [venta])
const pagar = (e, monto) => fila(e.admin.authId, "select registrar_pago_cliente($1, $2) as r", [e.cliente, monto])

async function dinero(e, venta) {
  const d = (await info(e.admin, venta)).dinero

  return Object.fromEntries(["total", "devuelto", "neto", "pagado", "saldo", "a_favor", "reembolsado", "pendiente"].map((k) => [k, num(d[k])]))
}

const existencia = async (ubicacion, producto) =>
  num((await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? 0)
const laVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const diario = (e) => fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")

describe("C4: devoluciones de una factura de contado", () => {
  it("1. parcial: B vuelve, la factura conserva su historia y queda L 300 a favor hasta que se devuelve", async () => {
    const e = await escenario()
    const v = await vender(e)
    const antes = await laVenta(v.venta_id)

    const r = await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]])

    expect([num(r.valor), num(r.cargo), num(r.ajuste_credito), num(r.a_favor)]).toEqual([300, 0, 0, 300])
    expect(await laVenta(v.venta_id)).toEqual(antes)
    expect(await dinero(e, v.venta_id)).toEqual({ total: 1000, devuelto: 300, neto: 700, pagado: 1000, saldo: 0, a_favor: 300, reembolsado: 0, pendiente: 300 })
    expect(await existencia(e.bodega, e.B)).toBe(100)

    await reembolsar(e.devuelveBodega, v.venta_id, { importe: 300 })
    expect((await dinero(e, v.venta_id)).pendiente).toBe(0)
    expect((await falla(reembolsar(e.devuelveBodega, v.venta_id, { importe: 1 }))).code).toBe("DV007")
  })

  it("2, 15 y 16. completa en partes con pago mixto: la última devuelve el cargo y cada medio tiene su tope", async () => {
    const e = await escenario()
    const v = await vender(e, { cobros: [efectivo(500), tarjeta(500)] })

    await devolver(e.devuelveBodega, v.venta_id, [[e.A, 1]])
    const ultima = await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1], [e.C, 1]])

    expect([num(ultima.valor), num(ultima.cargo)]).toEqual([800, 8.5])
    expect(await dinero(e, v.venta_id)).toMatchObject({ devuelto: 1000, neto: 0, a_favor: 1008.5, pendiente: 1008.5 })
    expect((await falla(devolver(e.devuelveBodega, v.venta_id, [[e.A, 1]]))).code).toBe("DV005")

    expect((await falla(reembolsar(e.devuelveBodega, v.venta_id, { medio: "tarjeta", importe: 508.5, referencia: "R" }))).code).toBe("42501")
    expect((await falla(reembolsar(e.admin, v.venta_id, { medio: "tarjeta", importe: 508.5 }))).code).toBe("DV007")
    expect((await falla(reembolsar(e.devuelveBodega, v.venta_id, { importe: 500.01 }))).code).toBe("DV007")

    await reembolsar(e.admin, v.venta_id, { medio: "tarjeta", importe: 508.5, referencia: "Reverso 1" })
    await reembolsar(e.devuelveBodega, v.venta_id, { importe: 500 })
    expect((await dinero(e, v.venta_id)).pendiente).toBe(0)
  })

  it("ISV 15 %: cada parte lleva su ISV y la última cierra el céntimo", async () => {
    const e = await escenario({ tasaIsv: 15 })
    const v = await vender(e, { items: [[e.cargador, 3]], cobros: [efectivo(345)] })

    expect(num((await devolver(e.devuelveBodega, v.venta_id, [[e.cargador, 1]])).valor)).toBe(115)
    expect(num((await devolver(e.devuelveBodega, v.venta_id, [[e.cargador, 2]])).valor)).toBe(230)
    expect((await dinero(e, v.venta_id)).neto).toBe(0)
  })
})

describe("C5: ajustes de crédito", () => {
  it("3. sin abonos: el saldo baja a L 700; el ajuste no es dinero ni cobro", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })
    const cobrosAntes = num((await diario(e)).indicadores.cobros_total)

    const r = await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]])

    expect([num(r.ajuste_credito), num(r.a_favor)]).toEqual([300, 0])
    expect(await deudaDe(db, e.cliente)).toBe(700)
    expect(await dinero(e, v.venta_id)).toMatchObject({ neto: 700, pagado: 0, saldo: 700, a_favor: 0 })
    expect((await db.query("select estado from pagos where empresa_id = $1", [e.empresa])).rows.map((p) => p.estado)).toEqual(["ajuste"])
    expect(num((await diario(e)).indicadores.cobros_total)).toBe(cobrosAntes)
  })

  it("4. con L 400 abonados: neto 700, pagado 400, saldo 300", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })

    await pagar(e, 400)
    await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]])

    expect(await dinero(e, v.venta_id)).toMatchObject({ neto: 700, pagado: 400, saldo: 300, a_favor: 0 })
    expect(await deudaDe(db, e.cliente)).toBe(300)
  })

  it("5 y 6. con L 800 abonados: saldo 0 y L 100 a favor del cliente, que no sale de ninguna caja hasta reembolsarse", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })

    await pagar(e, 800)

    const r = await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]])

    expect([num(r.ajuste_credito), num(r.a_favor)]).toEqual([200, 100])
    expect(await dinero(e, v.venta_id)).toMatchObject({ neto: 700, pagado: 800, saldo: 0, a_favor: 100, pendiente: 100 })
    expect((await laVenta(v.venta_id)).estado).toBe("pagada")
    expect(num((await diario(e)).indicadores.reembolsos_de_pedidos_pendientes)).toBe(100)

    await reembolsar(e.devuelveBodega, v.venta_id, { importe: 100 })
    expect((await dinero(e, v.venta_id)).pendiente).toBe(0)
    expect(num((await diario(e)).indicadores.reembolsos_pagados_efectivo)).toBe(100)
  })

  it("7 y 8. varias facturas y FIFO: la devolución no toca la otra factura ni sus abonos; un pago nuevo sigue el FIFO", async () => {
    const e = await escenario()
    const vieja = await vender(e, { forma: "credito" })
    const nueva = await vender(e, { forma: "credito", items: [[e.C, 1]] })

    await pagar(e, 1200)

    const abonosNueva = (await db.query("select * from abonos where venta_id = $1 order by id", [nueva.venta_id])).rows

    await devolver(e.devuelveBodega, vieja.venta_id, [[e.B, 1]])

    expect(await dinero(e, vieja.venta_id)).toMatchObject({ saldo: 0, a_favor: 300 })
    expect((await db.query("select * from abonos where venta_id = $1 order by id", [nueva.venta_id])).rows).toEqual(abonosNueva)
    expect(await deudaDe(db, e.cliente)).toBe(300)

    await pagar(e, 300)
    expect(await contar(db, "abonos", "venta_id = $1 and devolucion_id is null", [vieja.venta_id])).toBe(1)
    expect(await deudaDe(db, e.cliente)).toBe(0)
  })

  it("C. crédito sin abonos devuelto completo: sin deuda, sin reembolso, con su historia", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })

    await devolver(e.devuelveBodega, v.venta_id, [[e.A, 1], [e.B, 1], [e.C, 1]])

    expect(await dinero(e, v.venta_id)).toMatchObject({ devuelto: 1000, neto: 0, saldo: 0, a_favor: 0, pendiente: 0 })
    expect(await deudaDe(db, e.cliente)).toBe(0)
    expect((await falla(reembolsar(e.admin, v.venta_id, { importe: 1 }))).code).toBe("DV007")
    expect((await laVenta(v.venta_id)).estado).toBe("pagada")
  })
})

describe("C4: el inventario", () => {
  it("9 a 14. bueno suma solo donde se recibe, dañado no suma, en varias partes y nunca de más", async () => {
    const e = await escenario()
    const v = await vender(e, { items: [[e.A, 4]], cobros: [efectivo(800)] })

    await devolver(e.devuelveBodega, v.venta_id, [[e.A, 1], [e.A, 1, "danado"]])
    await devolver(e.admin, v.venta_id, [[e.A, 1]], { ubicacion: e.ruta })
    await devolver(e.admin, v.venta_id, [[e.A, 1]], { ubicacion: e.camion1 })

    expect([await existencia(e.bodega, e.A), await existencia(e.ruta, e.A), await existencia(e.camion1, e.A)]).toEqual([97, 1, 1])
    expect((await falla(devolver(e.devuelveBodega, v.venta_id, [[e.A, 1]]))).code).toBe("DV005")
    expect(await contar(db, "movimientos_inventario", "venta_id = $1 and tipo = 'devolucion'", [v.venta_id])).toBe(3)
  })

  it("el vendedor recibe solo en su ubicación", async () => {
    const e = await escenario()
    const v = await vender(e)

    expect((await falla(devolver(e.devuelveBodega, v.venta_id, [[e.A, 1]], { ubicacion: e.ruta }))).code).toBe("42501")
  })
})

describe("facturas de pedidos y liquidaciones", () => {
  async function facturaDePedido(e) {
    const entrega = await e.vendedor(e.bodega, ["pos"])
    const factura = await e.vendedor(e.ruta, ["pos", "sales-history", "sales-return"])
    const p = await fila(
      entrega.authId,
      `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => 'contado',
         p_cobros => $4::jsonb, p_fecha_vencimiento => null, p_clave_idempotencia => $5) as r`,
      [e.ruta, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad: 4 }]), JSON.stringify([efectivo(400)]), randomUUID()]
    )
    const f = await fila(factura.authId, "select public.facturar_pedido($1) as r", [p.pedido_id])

    return { pedido: p.pedido_id, venta: f.venta_id, factura }
  }

  const deudas = async (e) =>
    (await fila(e.admin.authId, "select public.control_de_liquidaciones() as r")).pedidos.map((p) => [p.origen, p.destino, num(p.efectivo), num(p.pendiente)])

  it("19 y 20. la devolución de una factura de pedido no cambia ninguna obligación; el dinero sale de la ubicación que facturó", async () => {
    const e = await escenario()
    const f = await facturaDePedido(e)
    const l = await fila(e.admin.authId, "select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => 400, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $3) as r", [e.bodega, e.ruta, randomUUID()])

    await fila(e.admin.authId, "select public.resolver_liquidacion($1, true) as r", [l.id])

    const antes = await deudas(e)
    const liquidacion = (await db.query("select * from liquidaciones_ubicacion where id = $1", [l.id])).rows[0]

    await devolver(e.admin, f.venta, [[e.cargador, 1]], { ubicacion: e.bodega })
    const r = await reembolsar(f.factura, f.venta, { importe: 100 })

    expect(r.ubicacion_id).toBe(e.ruta)
    expect(await existencia(e.bodega, e.cargador)).toBe(97)
    expect(await deudas(e)).toEqual(antes)
    expect((await db.query("select * from liquidaciones_ubicacion where id = $1", [l.id])).rows[0]).toEqual(liquidacion)
  })

  it("21 y 23. un solo camino: con devoluciones ya no se anula (ni C3 ni anular_venta); sin ellas, C3 sigue igual", async () => {
    const e = await escenario()
    const f = await facturaDePedido(e)

    await devolver(e.admin, f.venta, [[e.cargador, 1]])
    expect((await falla(fila(e.admin.authId, "select public.anular_factura_de_pedido($1, 'El cliente devolvió todo', $2) as r", [f.venta, randomUUID()]))).code).toBe("AV010")

    const normal = await vender(e)

    await devolver(e.devuelveBodega, normal.venta_id, [[e.A, 1]])
    expect((await falla(fila(e.anulaBodega.authId, "select public.anular_venta($1, 'Venta registrada por error', 'no_cobrado', $2) as r", [normal.venta_id, randomUUID()]))).code).toBe("AV010")
    expect(await existencia(e.bodega, e.A)).toBe(100)

    const otra = await facturaDePedido(e)

    expect((await fila(e.admin.authId, "select public.anular_factura_de_pedido($1, 'El cliente devolvió todo', $2) as r", [otra.venta, randomUUID()])).estado).toBe("anulada")
    expect((await falla(devolver(e.admin, otra.venta, [[e.cargador, 1]]))).code).toBe("DV003")
  })
})

describe("seguridad, reintentos y reportes", () => {
  it("22. una factura fiscal no admite devoluciones", async () => {
    const e = await escenario()
    const v = await vender(e)

    await db.query("update ventas set es_fiscal = true where id = $1", [v.venta_id])
    expect((await falla(devolver(e.admin, v.venta_id, [[e.A, 1]]))).code).toBe("DV004")
    expect((await info(e.admin, v.venta_id)).puede_registrar).toBe(false)
  })

  it("27. reintento y doble clic: una sola devolución, un solo movimiento, un solo reembolso", async () => {
    const e = await escenario()
    const v = await vender(e)
    const clave = randomUUID()

    await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]], { clave })
    expect(await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]], { clave })).toMatchObject({ repetido: true })
    expect((await falla(devolver(e.devuelveBodega, v.venta_id, [[e.C, 1]], { clave }))).code).toBe("DV006")
    expect(await existencia(e.bodega, e.B)).toBe(100)

    const pago = randomUUID()

    await reembolsar(e.devuelveBodega, v.venta_id, { importe: 300, clave: pago })
    expect(await reembolsar(e.devuelveBodega, v.venta_id, { importe: 300, clave: pago })).toMatchObject({ repetido: true })
    expect(await contar(db, "reembolsos_de_venta", "venta_id = $1", [v.venta_id])).toBe(1)
  })

  it("28. dos devoluciones del último producto a la vez: la segunda espera y no pasa", async () => {
    const e = await escenario()
    const v = await vender(e, { items: [[e.A, 1]], cobros: [efectivo(200)] })
    const sql = "select public.registrar_devolucion_de_venta($1, 'Lo devolvió', $2::jsonb, null, $3)"
    const productos = JSON.stringify([{ producto_id: e.A, cantidad: 1, condicion: "buen_estado" }])

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.devuelveBodega.authId, hacer: (c) => c.query(sql, [v.venta_id, productos, randomUUID()]) },
      segunda: { authId: e.admin.authId, hacer: (c) => c.query(sql, [v.venta_id, productos, randomUUID()]) },
    })

    expect(r.error?.code).toBe("DV005")
    expect(await existencia(e.bodega, e.A)).toBe(100)
  })

  it("29 y 30. permisos: sin el permiso, en otra ubicación, el contador y otra empresa, no", async () => {
    const e = await escenario()
    const v = await vender(e)
    const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.bodega, permisos: ["sales-history", "sales-return"] })
    const otra = await crearEmpresa(db, "Otra empresa")

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

    for (const quien of [e.vendeBodega, e.anulaBodega, e.devuelveRuta, contador]) {
      expect((await falla(devolver(quien, v.venta_id, [[e.A, 1]]))).code).toBe("42501")
    }

    expect((await falla(devolver(otra, v.venta_id, [[e.A, 1]]))).code).toBe("DV002")
    expect((await info(e.vendeBodega, v.venta_id)).puede_registrar).toBe(false)
    expect((await info(e.devuelveBodega, v.venta_id)).puede_registrar).toBe(true)

    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.registrar_devolucion_de_venta(uuid, text, jsonb, uuid, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.dinero_de_la_venta(uuid)', 'execute') as interna`
    )

    expect(rows[0]).toEqual({ anon: false, interna: false })
  })

  it("los registros no se modifican ni se borran", async () => {
    const e = await escenario()
    const v = await vender(e)

    await devolver(e.devuelveBodega, v.venta_id, [[e.B, 1]])
    expect((await falla(db.query("update devoluciones_de_venta set valor = 1 where venta_id = $1", [v.venta_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from devolucion_venta_detalle"))).code).toBe("42501")
  })

  it("24 y 25. ventas normales sin devoluciones siguen igual en los reportes", async () => {
    const e = await escenario()

    await vender(e)

    const antes = await diario(e)
    const v = await vender(e)

    await devolver(e.devuelveBodega, v.venta_id, [[e.A, 1]])

    const despues = await diario(e)

    expect(num(despues.indicadores.ventas_total)).toBe(num(antes.indicadores.ventas_total) + 1000)
    expect(num(despues.indicadores.reembolsos_de_pedidos_pendientes)).toBe(200)
  })
})

/*
  Una devolución a crédito y un abono del mismo cliente a la vez. Para que el
  cruce sea real y no dependa del orden en que Node manda las consultas, la
  devolución se detiene justo antes de registrar (un candado consultivo en un
  disparador de prueba), con todos sus candados tomados; la otra operación no
  sale hasta que PostgreSQL diga que está esperando un candado, y entonces se
  suelta la devolución. Con el orden de candados al revés (la factura antes que
  el cliente), este cruce termina en un deadlock (40P01).
*/
const PAUSA = 4052

async function devolucionDetenida(e, { venta, productos, otra }) {
  const a = await base.conectar()
  const b = await base.conectar()

  await db.query(`create or replace function public.pausa_de_prueba() returns trigger language plpgsql as $$
                   begin perform pg_advisory_xact_lock(${PAUSA}); return new; end $$`)
  await db.query("create trigger pausa_de_prueba before insert on public.devoluciones_de_venta for each row execute function public.pausa_de_prueba()")
  await db.query("select pg_advisory_lock($1)", [PAUSA])

  try {
    await comoUsuario(a, e.devuelveBodega.authId)
    await comoUsuario(b, e.admin.authId)
    const [pidA, pidB] = await Promise.all([a, b].map(async (c) => (await c.query("select pg_backend_pid() as pid")).rows[0].pid))

    await a.query("begin")
    await b.query("begin")

    const resultado = (promesa) => promesa.then((r) => ({ r: r.rows[0].r }), (error) => ({ error }))
    const deA = resultado(
      a.query("select public.registrar_devolucion_de_venta($1, 'Lo devolvió', $2::jsonb, null, $3) as r", [
        venta,
        JSON.stringify(productos.map(([producto_id, cantidad]) => ({ producto_id, cantidad, condicion: "buen_estado" }))),
        randomUUID(),
      ])
    )

    await esperarBloqueo(db, pidA)
    const deB = resultado(otra(b))

    await esperarBloqueo(db, pidB)
    await db.query("select pg_advisory_unlock($1)", [PAUSA])

    const devolucion = await deA
    await a.query(devolucion.error ? "rollback" : "commit")
    const pago = await deB
    await b.query(pago.error ? "rollback" : "commit")

    return { devolucion, pago }
  } finally {
    await db.query("select pg_advisory_unlock_all()")
    await db.query("drop trigger if exists pausa_de_prueba on public.devoluciones_de_venta")
    await db.query("drop function if exists public.pausa_de_prueba()")
    await a.end()
    await b.end()
  }
}

const pagoEnSesion = (e, monto) => (c) => c.query("select registrar_pago_cliente($1, $2, $3) as r", [e.cliente, monto, randomUUID()])

/*
  La cuenta del cliente después del cruce: cada factura sin saldo negativo,
  los pagos encadenados (cada uno parte del saldo en que dejó la cuenta el
  anterior, sea ajuste o dinero) y el último deja la deuda real. Los ajustes
  no entran en lo cobrado del día.
*/
async function cuentaCoherente(e) {
  const facturas = (
    await db.query("select v.total - coalesce((select sum(a.monto) from abonos a where a.venta_id = v.id), 0) as saldo from ventas v where v.cliente_id = $1", [e.cliente])
  ).rows
  const pagos = (await db.query("select estado, monto, saldo_anterior, saldo_posterior from pagos where cliente_id = $1 order by saldo_anterior desc", [e.cliente])).rows.map(
    (g) => ({ estado: g.estado, monto: num(g.monto), antes: num(g.saldo_anterior), despues: num(g.saldo_posterior) })
  )
  const deuda = await deudaDe(db, e.cliente)

  expect(facturas.every((f) => num(f.saldo) >= 0)).toBe(true)
  pagos.forEach((g, i) => {
    expect(g.despues).toBe(Math.round((g.antes - g.monto) * 100) / 100)
    if (i > 0) expect(g.antes).toBe(pagos[i - 1].despues)
  })
  expect(pagos.at(-1).despues).toBe(deuda)

  const reales = pagos.filter((g) => g.estado === "aplicado").reduce((n, g) => n + g.monto, 0)
  expect(num((await diario(e)).indicadores.abonos_total)).toBe(reales)

  return { pagos, deuda }
}

const devolucionEnSesion = (venta, productos) => (c) =>
  c.query("select public.registrar_devolucion_de_venta($1, 'Lo devolvió', $2::jsonb, null, $3) as r", [
    venta,
    JSON.stringify(productos.map((producto_id) => ({ producto_id, cantidad: 1, condicion: "buen_estado" }))),
    randomUUID(),
  ])

describe("concurrencia entre devoluciones a crédito y abonos del cliente", () => {
  it("A. la devolución empieza antes que el abono: el abono espera, sin deadlock, y abona sobre el saldo ya rebajado", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })

    const { devolucion, pago } = await devolucionDetenida(e, { venta: v.venta_id, productos: [[e.B, 1]], otra: pagoEnSesion(e, 500) })

    expect(devolucion.error).toBeUndefined()
    expect(pago.error).toBeUndefined()
    expect([num(devolucion.r.ajuste_credito), num(devolucion.r.a_favor)]).toEqual([300, 0])
    expect((await cuentaCoherente(e)).pagos).toEqual([
      { estado: "ajuste", monto: 300, antes: 1000, despues: 700 },
      { estado: "aplicado", monto: 500, antes: 700, despues: 200 },
    ])
    expect(await contar(db, "abonos", "venta_id = $1", [v.venta_id])).toBe(2)
  })

  it("B. el abono empieza antes que la devolución: la devolución espera y ajusta solo el saldo que quedó; el resto, a favor", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.admin.authId, hacer: pagoEnSesion(e, 800) },
      segunda: { authId: e.devuelveBodega.authId, hacer: devolucionEnSesion(v.venta_id, [e.B]) },
    })

    expect(r.error).toBeUndefined()
    expect([num(r.respuesta.rows[0].r.ajuste_credito), num(r.respuesta.rows[0].r.a_favor)]).toEqual([200, 100])
    expect((await cuentaCoherente(e)).pagos).toEqual([
      { estado: "aplicado", monto: 800, antes: 1000, despues: 200 },
      { estado: "ajuste", monto: 200, antes: 200, despues: 0 },
    ])
    expect((await laVenta(v.venta_id)).estado).toBe("pagada")
    expect(await dinero(e, v.venta_id)).toMatchObject({ saldo: 0, a_favor: 100, pendiente: 100 })
  })

  it("C. devolución en una factura mientras se abona otra del mismo cliente: sin deadlock, el abono va por FIFO a la más vieja", async () => {
    const e = await escenario()
    const vieja = await vender(e, { forma: "credito", items: [[e.A, 1]] })
    const nueva = await vender(e, { forma: "credito", items: [[e.B, 1], [e.C, 1]] })

    const { devolucion, pago } = await devolucionDetenida(e, { venta: nueva.venta_id, productos: [[e.C, 1]], otra: pagoEnSesion(e, 200) })

    expect(devolucion.error).toBeUndefined()
    expect(pago.error).toBeUndefined()
    expect(pago.r.aplicaciones.map((x) => [x.venta_id, num(x.monto_aplicado)])).toEqual([[vieja.venta_id, 200]])
    expect((await cuentaCoherente(e)).deuda).toBe(300)
    expect(await dinero(e, nueva.venta_id)).toMatchObject({ saldo: 300, a_favor: 0 })
    expect((await laVenta(vieja.venta_id)).estado).toBe("pagada")
  })

  it("D. dos devoluciones de la misma factura a crédito: se ordenan, cada una ajusta lo suyo y ninguna pasa de lo vendido", async () => {
    const e = await escenario()
    const v = await vender(e, { forma: "credito" })
    const dos = (primera, segunda) =>
      enDosSesiones(base, db, {
        primera: { authId: e.devuelveBodega.authId, hacer: devolucionEnSesion(v.venta_id, primera) },
        segunda: { authId: e.admin.authId, hacer: devolucionEnSesion(v.venta_id, segunda) },
      })

    expect((await dos([e.A], [e.B])).error).toBeUndefined()
    expect((await dos([e.C], [e.C, e.A])).error?.code).toBe("DV005")

    expect((await cuentaCoherente(e)).pagos.map((g) => [g.estado, g.monto])).toEqual([
      ["ajuste", 200],
      ["ajuste", 300],
      ["ajuste", 500],
    ])
    expect(await contar(db, "devoluciones_de_venta", "venta_id = $1", [v.venta_id])).toBe(3)
    expect(await dinero(e, v.venta_id)).toMatchObject({ devuelto: 1000, saldo: 0, a_favor: 0 })
  })
})
