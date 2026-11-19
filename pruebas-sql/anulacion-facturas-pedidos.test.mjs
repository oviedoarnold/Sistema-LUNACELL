/*
  0051 contra PostgreSQL de verdad: anular la factura de un pedido
  interubicación. Bodega entrega (y cobra), Ruta local factura y Camión 01 es
  una tercera ubicación. ISV 0: 4 cargadores de 100 son L 400. Lo de después
  de anular —recibir productos, devolver el dinero, liquidar— es lo de C2a y
  C2b, y aquí se prueba que funciona igual sobre una factura anulada.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"

import { enDosSesiones } from "./arnes.mjs"
import { usarBaseDePrueba, num, falla, empresaConTresUbicaciones } from "./ayudantes.mjs"
import { crearEmpresa, crearVendedor, deudaDe, contar } from "./fixtures.mjs"

let base
let db

const { como, fila } = usarBaseDePrueba((levantada) => {
  base = levantada
  db = levantada.admin
})

async function escenario() {
  const e = await empresaConTresUbicaciones(db, { nombre: "Lunacell C3", tasaIsv: 0, existencia: 100, nombreCliente: "Cliente C3" })
  const { vendedor, bodega, ruta, camion1 } = e

  return {
    ...e,
    enBodega: await vendedor(bodega, ["pos"]),
    facturaRuta: await vendedor(ruta, ["pos"]),
    anulaRuta: await vendedor(ruta, ["pos", "sales-history", "sales-void"]),
    anulaBodega: await vendedor(bodega, ["pos", "sales-history", "sales-void"]),
    historialRuta: await vendedor(ruta, ["pos", "sales-history"]),
    cancelaBodega: await vendedor(bodega, ["pos", "orders-cancel"]),
    cancelaRuta: await vendedor(ruta, ["pos", "orders-cancel"]),
    resuelveRuta: await vendedor(ruta, ["pos", "orders-resolve"]),
    liquidaBodega: await vendedor(bodega, ["settlements-manage"]),
    liquidaRuta: await vendedor(ruta, ["settlements-manage"]),
    enCamion: await vendedor(camion1, ["pos", "sales-history", "sales-void", "orders-cancel"]),
  }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const tarjeta = (monto) => ({ medio: "tarjeta", monto, referencia: "AUT-1", tasa: 1.7, cargo: Math.round(monto * 1.7) / 100 })

// Bodega entrega 4 cargadores (L 400) para Ruta local, que lo factura.
async function facturado(e, { forma = "contado", cobros = forma === "contado" ? [efectivo(400)] : [] } = {}) {
  const p = await fila(
    e.enBodega.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
       p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
    [e.ruta, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad: 4 }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
  )
  const f = await fila(e.facturaRuta.authId, "select public.facturar_pedido($1) as r", [p.pedido_id])

  return { pedido: p.pedido_id, numero: p.numero, venta: f.venta_id, factura: f.numero_factura }
}

const anular = (quien, venta, { motivo = "El cliente devolvió el pedido completo", clave = randomUUID() } = {}) =>
  fila(quien.authId, "select public.anular_factura_de_pedido($1, $2, $3) as r", [venta, motivo, clave])

const recibir = (quien, pedido, { ubicacion = null, cantidad = 4, condicion = "buen_estado", nota = "", e }) =>
  fila(quien.authId, "select public.registrar_recepcion_de_pedido($1, $2, $3::jsonb, $4, $5) as r", [
    pedido,
    ubicacion,
    JSON.stringify([{ producto_id: e.cargador, cantidad, condicion }]),
    nota,
    randomUUID(),
  ])

const reembolsar = (quien, pedido, { medio = "efectivo", importe, ubicacion = null, referencia = "" }) =>
  fila(quien.authId, "select public.registrar_reembolso_de_pedido($1, $2, $3, $4, $5, $6) as r", [pedido, medio, importe, ubicacion, referencia, randomUUID()])

const liquidar = (quien, { origen, destino, monto }) =>
  fila(
    quien.authId,
    `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $4) as r`,
    [origen, destino, monto, randomUUID()]
  )

const resolver = (quien, id, confirmar, motivo = null) => fila(quien.authId, "select public.resolver_liquidacion($1, $2, $3) as r", [id, confirmar, motivo])
const info = (quien, pedido) => fila(quien.authId, "select public.cancelacion_de_pedido($1) as r", [pedido])
const pagar = (quien, cliente, monto) => fila(quien.authId, "select registrar_pago_cliente($1, $2) as r", [cliente, monto])

const laVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const elPedido = async (id) => (await db.query("select * from pedidos_ubicacion where id = $1", [id])).rows[0]
const existencia = async (ubicacion, producto) =>
  num((await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? 0)
const dinero = async (e, pedido) => Object.fromEntries((await info(e.admin, pedido)).dinero.map((d) => [d.medio, [num(d.total), num(d.devuelto), num(d.pendiente)]]))

// Las obligaciones del pedido: [quien debe, quien recibe, total, pendiente].
async function deudas(e, pedido) {
  return (await fila(e.admin.authId, "select public.control_de_liquidaciones() as r")).pedidos
    .filter((p) => p.pedido_id === pedido)
    .map((p) => [p.origen, p.destino, num(p.efectivo), num(p.pendiente)])
}

// Lo histórico que la anulación no toca.
async function historico(e) {
  const filas = async (consulta) => (await db.query(consulta, [e.empresa])).rows

  return {
    pagos: await filas("select * from pagos where empresa_id = $1 order by id"),
    abonos: await filas("select * from abonos where empresa_id = $1 order by id"),
    cobros: await filas("select * from cobros_por_medio where empresa_id = $1 order by id"),
    liquidaciones: await filas("select * from liquidaciones_ubicacion where empresa_id = $1 order by id"),
    movimientos: await filas("select * from movimientos_inventario where empresa_id = $1 order by id"),
    detalle: await filas("select d.* from detalle_venta d join ventas v on v.id = d.venta_id where v.empresa_id = $1 order by d.id"),
  }
}

describe("anular la factura de un pedido", () => {
  it("1. sin anticipo (crédito): la deuda queda en 0, sin reembolso ni cobro inventado", async () => {
    const e = await escenario()
    const f = await facturado(e, { forma: "credito" })

    expect(await deudaDe(db, e.cliente)).toBe(400)

    const antes = await historico(e)
    const r = await anular(e.anulaRuta, f.venta)

    expect(r).toMatchObject({ estado: "anulada", numero_factura: f.factura, pedido: f.numero, dinero_por_devolver: 0 })
    expect(num(r.saldo_cancelado)).toBe(400)
    expect(await deudaDe(db, e.cliente)).toBe(0)
    expect((await laVenta(f.venta)).estado).toBe("anulada")
    expect((await elPedido(f.pedido)).estado).toBe("cancelado")
    expect(await historico(e)).toEqual(antes)
    expect(await dinero(e, f.pedido)).toEqual({})
    expect(await contar(db, "reembolsos_de_pedido", "pedido_id = $1", [f.pedido])).toBe(0)

    const registro = (await db.query("select * from anulaciones_venta where venta_id = $1", [f.venta])).rows[0]

    expect(registro).toMatchObject({ tratamiento_dinero: "pedido", forma_pago: "credito", estado_anterior: "pendiente", movimientos: [] })
    expect((await db.query("select estado_anterior from cancelaciones_de_pedido where pedido_id = $1", [f.pedido])).rows[0].estado_anterior).toBe("facturado")
  })

  it("2. con anticipo de L 400 en Bodega (prima de un crédito de L 1,000): la deuda desaparece y los L 400 quedan por devolver", async () => {
    const e = await escenario()
    await db.query("update productos set precio = 250 where id = $1", [e.cargador])
    const f = await facturado(e, { forma: "credito", cobros: [efectivo(400)] })

    expect(await deudaDe(db, e.cliente)).toBe(600)

    const r = await anular(e.admin, f.venta)

    expect(num(r.saldo_cancelado)).toBe(600)
    expect(num(r.dinero_por_devolver)).toBe(400)
    expect(await deudaDe(db, e.cliente)).toBe(0)
    expect(await dinero(e, f.pedido)).toEqual({ efectivo: [400, 0, 400] })
    expect(await deudas(e, f.pedido)).toEqual([])

    // El reembolso no se da por hecho: se registra cuando ocurre, en partes.
    await reembolsar(e.cancelaBodega, f.pedido, { importe: 150 })
    await reembolsar(e.cancelaBodega, f.pedido, { importe: 250 })
    expect(await dinero(e, f.pedido)).toEqual({ efectivo: [400, 400, 0] })
  })

  it("3 y 4. pagada completa con pago mixto: lo electrónico se devuelve con su cargo original, aunque cambie el porcentaje", async () => {
    const e = await escenario()
    const f = await facturado(e, { cobros: [efectivo(200), tarjeta(200)] })

    await db.query("update empresas set tasa_cargo_tarjeta = 5 where id = $1", [e.empresa])
    await anular(e.anulaRuta, f.venta)

    expect(await dinero(e, f.pedido)).toEqual({ efectivo: [200, 0, 200], tarjeta: [203.4, 0, 203.4] })
    expect((await falla(reembolsar(e.cancelaBodega, f.pedido, { medio: "tarjeta", importe: 203.4, referencia: "R" }))).code).toBe("42501")
    await reembolsar(e.admin, f.pedido, { medio: "tarjeta", importe: 203.4, referencia: "Reverso 9" })
    await reembolsar(e.cancelaRuta, f.pedido, { importe: 200 })

    expect(await dinero(e, f.pedido)).toEqual({ efectivo: [200, 200, 0], tarjeta: [203.4, 203.4, 0] })
    expect(await deudas(e, f.pedido)).toEqual([["Bodega", "Ruta local", 200, 200]])
  })

  it("5 y 6. abonos después de facturar: no se anula (C5), y no se toca ningún pago", async () => {
    const e = await escenario()
    const f = await facturado(e, { forma: "credito" })

    await pagar(e.admin, e.cliente, 100)

    const antes = await historico(e)
    const r = await falla(anular(e.admin, f.venta))

    expect(r.code).toBe("AV005")
    expect(r.message).toContain("después de facturar")
    expect(await historico(e)).toEqual(antes)
    expect((await laVenta(f.venta)).estado).toBe("pendiente")
    expect((await elPedido(f.pedido)).estado).toBe("facturado")
  })

  it("7. cliente con varias facturas: anular una no cambia las demás ni sus abonos", async () => {
    const e = await escenario()
    const vieja = await facturado(e, { forma: "credito" })

    await pagar(e.admin, e.cliente, 100)

    const nueva = await facturado(e, { forma: "credito" })

    expect(await deudaDe(db, e.cliente)).toBe(700)
    await anular(e.admin, nueva.venta)

    expect(await deudaDe(db, e.cliente)).toBe(300)
    expect((await laVenta(vieja.venta)).estado).toBe("pendiente")
    expect(num((await db.query("select sum(monto) as s from abonos where venta_id = $1", [vieja.venta])).rows[0].s)).toBe(100)

    // Un pago nuevo va a la factura vigente, nunca a la anulada.
    await pagar(e.admin, e.cliente, 50)
    expect(await contar(db, "abonos", "venta_id = $1", [nueva.venta])).toBe(0)
    expect(await deudaDe(db, e.cliente)).toBe(250)
  })
})

describe("los productos", () => {
  it("8. anular no mueve inventario: ni Bodega ni Ruta local suben; quedan 4 por recibir", async () => {
    const e = await escenario()
    const f = await facturado(e)

    expect(await existencia(e.bodega, e.cargador)).toBe(96)
    await anular(e.anulaRuta, f.venta)

    expect(await existencia(e.bodega, e.cargador)).toBe(96)
    expect(await existencia(e.ruta, e.cargador)).toBe(0)
    expect((await info(e.admin, f.pedido)).productos.map((p) => num(p.pendiente))).toEqual([4])
    expect(await contar(db, "movimientos_inventario", "venta_id = $1 and tipo = 'anulacion_venta'", [f.venta])).toBe(0)
  })

  it("9, 10 y 12. recibidos en origen y en destino, uno dañado: solo suma lo bueno, solo donde se recibe, nunca más de lo entregado", async () => {
    const e = await escenario()
    const f = await facturado(e)

    await anular(e.anulaRuta, f.venta)
    await recibir(e.cancelaBodega, f.pedido, { cantidad: 2, e })
    await recibir(e.cancelaRuta, f.pedido, { cantidad: 1, condicion: "danado", e })
    await recibir(e.cancelaRuta, f.pedido, { cantidad: 1, e })

    expect(await existencia(e.bodega, e.cargador)).toBe(98)
    expect(await existencia(e.ruta, e.cargador)).toBe(1)
    expect((await falla(recibir(e.cancelaBodega, f.pedido, { cantidad: 1, e }))).code).toBe("PI014")
  })

  it("11. en otra ubicación: solo el administrador, con nota", async () => {
    const e = await escenario()
    const f = await facturado(e)

    await anular(e.anulaRuta, f.venta)
    expect((await falla(recibir(e.enCamion, f.pedido, { ubicacion: e.camion1, e }))).code).toBe("42501")
    expect((await falla(recibir(e.admin, f.pedido, { ubicacion: e.camion1, e }))).code).toBe("PI014")
    await recibir(e.admin, f.pedido, { ubicacion: e.camion1, nota: "Lo trajo el cliente al camión", e })

    expect(await existencia(e.camion1, e.cargador)).toBe(4)
  })
})

describe("liquidaciones", () => {
  it("13. con una liquidación por confirmar no se anula; al confirmarse, sí", async () => {
    const e = await escenario()
    const f = await facturado(e)
    const l = await liquidar(e.liquidaBodega, { origen: e.bodega, destino: e.ruta, monto: 400 })

    const r = await falla(anular(e.admin, f.venta))

    expect(r.code).toBe("PI013")
    expect(r.message).toContain(l.numero)

    await resolver(e.liquidaRuta, l.id, true)
    expect((await anular(e.admin, f.venta)).estado).toBe("anulada")
  })

  it("14 y 15. liquidada y confirmada, Bodega devuelve: Ruta local le devuelve L 400 con una contraliquidación, sin tocar la original", async () => {
    const e = await escenario()
    const f = await facturado(e)
    const original = await liquidar(e.liquidaBodega, { origen: e.bodega, destino: e.ruta, monto: 400 })

    await resolver(e.liquidaRuta, original.id, true)

    const filaOriginal = (await db.query("select * from liquidaciones_ubicacion where id = $1", [original.id])).rows[0]

    await anular(e.anulaRuta, f.venta)
    expect(await deudas(e, f.pedido)).toEqual([])

    await reembolsar(e.cancelaBodega, f.pedido, { importe: 400 })
    expect(await deudas(e, f.pedido)).toEqual([["Ruta local", "Bodega", 400, 400]])

    const contra = await liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 400 })

    await resolver(e.liquidaBodega, contra.id, true)
    expect(await deudas(e, f.pedido)).toEqual([["Ruta local", "Bodega", 400, 0]])
    expect((await db.query("select * from liquidaciones_ubicacion where id = $1", [original.id])).rows[0]).toEqual(filaOriginal)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("16. reembolsos parciales desde el destino y desde una tercera ubicación: las obligaciones siguen al efectivo", async () => {
    const e = await escenario()
    const f = await facturado(e)

    await anular(e.anulaRuta, f.venta)
    await reembolsar(e.cancelaRuta, f.pedido, { importe: 100 })
    await reembolsar(e.admin, f.pedido, { importe: 150, ubicacion: e.camion1, referencia: "Recibo 5" })

    expect(await deudas(e, f.pedido)).toEqual([
      ["Bodega", "Camión 01", 150, 150],
      ["Bodega", "Ruta local", 100, 100],
    ])
    expect(await dinero(e, f.pedido)).toEqual({ efectivo: [400, 250, 150] })
  })

  it("antes de anular, la factura vigente sigue debiéndole a Ruta local; después, ya no", async () => {
    const e = await escenario()
    const f = await facturado(e)

    expect(await deudas(e, f.pedido)).toEqual([["Bodega", "Ruta local", 400, 400]])
    await anular(e.anulaRuta, f.venta)
    expect(await deudas(e, f.pedido)).toEqual([])
    expect((await falla(liquidar(e.liquidaBodega, { origen: e.bodega, destino: e.ruta, monto: 1 }))).code).toBe("LQ002")
  })
})

describe("seguridad y concurrencia", () => {
  it("17. reintento y doble clic: una sola anulación", async () => {
    const e = await escenario()
    const f = await facturado(e)
    const clave = randomUUID()

    await anular(e.anulaRuta, f.venta, { clave })
    expect(await anular(e.anulaRuta, f.venta, { clave })).toMatchObject({ estado: "ya_anulada", numero_factura: f.factura })
    expect(await anular(e.admin, f.venta)).toMatchObject({ estado: "ya_anulada" })
    expect(await contar(db, "anulaciones_venta", "venta_id = $1", [f.venta])).toBe(1)
    expect(await contar(db, "cancelaciones_de_pedido", "pedido_id = $1", [f.pedido])).toBe(1)
    expect(await contar(db, "eventos_de_pedido", "pedido_id = $1 and tipo = 'cancelado'", [f.pedido])).toBe(1)
  })

  it("18. anular y abonar a la vez: el abono espera y va a la deuda vigente; anular y liquidar: la liquidación no encuentra saldo", async () => {
    const e = await escenario()
    const f = await facturado(e, { forma: "credito" })

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.admin.authId, hacer: (c) => c.query("select public.anular_factura_de_pedido($1, 'El cliente devolvió todo', $2)", [f.venta, randomUUID()]) },
      segunda: { authId: e.admin.authId, hacer: (c) => c.query("select registrar_pago_cliente($1, 100)", [e.cliente]) },
    })

    // El abono esperó a la anulación y ya no encontró deuda: no entró, y nada quedó en la factura anulada.
    expect(r.espera).toBeTruthy()
    expect(r.error).toBeTruthy()
    expect(await contar(db, "abonos", "venta_id = $1", [f.venta])).toBe(0)
    expect(await contar(db, "pagos", "empresa_id = $1", [e.empresa])).toBe(0)

    const g = await facturado(e)
    const s = await enDosSesiones(base, db, {
      primera: { authId: e.admin.authId, hacer: (c) => c.query("select public.anular_factura_de_pedido($1, 'El cliente devolvió todo', $2)", [g.venta, randomUUID()]) },
      segunda: {
        authId: e.liquidaBodega.authId,
        hacer: (c) =>
          c.query("select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => 400, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $3)", [
            e.bodega,
            e.ruta,
            randomUUID(),
          ]),
      },
    })

    expect(s.error?.code).toBe("LQ002")
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(0)
  })

  it("19. permisos: vendedor con Anular ventas en la ubicación que facturó y el mismo día; nadie más", async () => {
    const e = await escenario()
    const f = await facturado(e)

    for (const quien of [e.historialRuta, e.anulaBodega, e.cancelaRuta, e.enCamion]) {
      expect((await falla(anular(quien, f.venta))).code).toBe("42501")
    }

    const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.ruta, permisos: ["sales-history", "sales-void"] })

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])
    expect((await falla(anular(contador, f.venta))).code).toBe("42501")

    await db.query("update ventas set fecha = fecha - interval '2 days' where id = $1", [f.venta])
    expect((await falla(anular(e.anulaRuta, f.venta))).code).toBe("AV003")
    expect((await anular(e.admin, f.venta)).estado).toBe("anulada")
  })

  it("20. otra empresa no la ve; una venta normal se sigue anulando con anular_venta()", async () => {
    const e = await escenario()
    const f = await facturado(e)
    const otra = await crearEmpresa(db, "Otra empresa")

    expect((await falla(anular(otra, f.venta))).code).toBe("AV002")

    // Una venta normal de Bodega no es una factura de pedido: esta función no la toca, y anular_venta() sí la anula.
    const normal = await fila(
      e.anulaBodega.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb, p_clave_idempotencia => $3) as r`,
      [JSON.stringify([{ producto_id: e.cargador, cantidad: 1 }]), JSON.stringify([efectivo(100)]), randomUUID()]
    )

    expect((await falla(anular(e.admin, normal.venta_id))).code).toBe("AV002")
    expect((await laVenta(normal.venta_id)).estado).toBe("pagada")
    expect((await fila(e.anulaBodega.authId, "select public.anular_venta($1, 'Venta registrada por error', 'no_cobrado', $2) as r", [normal.venta_id, randomUUID()])).estado).toBe("anulada")
    expect(await existencia(e.bodega, e.cargador)).toBe(96)
  })

  it("21. una factura fiscal no se anula y no cambia nada", async () => {
    const e = await escenario()
    const f = await facturado(e)

    await db.query("update ventas set es_fiscal = true where id = $1", [f.venta])

    const r = await falla(anular(e.admin, f.venta))

    expect(r.code).toBe("AV004")
    expect(r.message).toContain("contador")
    expect((await elPedido(f.pedido)).estado).toBe("facturado")
  })

  it("exige motivo de 10 caracteres y clave", async () => {
    const e = await escenario()
    const f = await facturado(e)

    expect((await falla(anular(e.admin, f.venta, { motivo: "corto" }))).code).toBe("AV001")
    expect((await falla(fila(e.admin.authId, "select public.anular_factura_de_pedido($1, $2, null) as r", [f.venta, "Motivo suficiente"]))).code).toBe("PI001")
  })

  it("anon no la ejecuta; la venta anulada y el pedido cancelado no vuelven atrás", async () => {
    const e = await escenario()
    const f = await facturado(e)

    await anular(e.admin, f.venta)

    const { rows } = await db.query("select has_function_privilege('anon', 'public.anular_factura_de_pedido(uuid, text, text)', 'execute') as anon")

    expect(rows[0].anon).toBe(false)
    expect((await falla(db.query("update pedidos_ubicacion set estado = 'facturado' where id = $1", [f.pedido]))).code).toBe("42501")
    expect((await falla(db.query("update ventas set estado = 'pagada' where id = $1", [f.venta]))).code).toBe("42501")
  })

  it("un pedido facturado no pasa a cancelado sin anular su factura", async () => {
    const e = await escenario()
    const f = await facturado(e)

    expect((await falla(db.query("update pedidos_ubicacion set estado = 'cancelado' where id = $1", [f.pedido]))).message).toContain("anulación de su factura")
    expect((await falla(fila(e.admin.authId, "select public.cancelar_pedido($1, 'Ya está facturado', null, '[]'::jsonb, $2) as r", [f.pedido, randomUUID()]))).code).toBe("PI012")
  })
})

describe("reportes y cuentas por cobrar", () => {
  it("23 y 24. la factura anulada sale de ventas y deudas; el dinero del pedido queda como reembolso pendiente una sola vez", async () => {
    const e = await escenario()
    const f = await facturado(e)
    const diario = () => fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")

    const antes = await diario()

    expect(num(antes.indicadores.ventas_total)).toBe(400)
    await anular(e.anulaRuta, f.venta)

    const despues = await diario()

    expect(num(despues.indicadores.ventas_total)).toBe(0)
    expect(num(despues.indicadores.anuladas_total)).toBe(400)
    expect(num(despues.indicadores.reembolsos_pendientes)).toBe(0)
    expect(num(despues.indicadores.reembolsos_de_pedidos_pendientes)).toBe(400)
    expect(num(despues.indicadores.total_cobrado)).toBe(num(antes.indicadores.total_cobrado))
  })
})
