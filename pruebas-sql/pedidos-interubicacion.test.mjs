/*
  0045 contra PostgreSQL de verdad: Bodega entrega y Camión 01 factura.

  Cada caso arma su propia empresa: Bodega con existencias, Camión 01 y Camión 02
  sin ninguna, una tienda fiscal, un vendedor por ubicación, un contador y otra
  empresa aparte. El cargador vale 100, el cubo 50 (40 para el cliente A), el ISV
  es 15 % y tarjeta y enlace llevan 1.7 %. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones } from "./arnes.mjs"
import { crearEmpresa, crearCliente, crearVendedor, crearFactura, deudaDe, contar } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(() => base?.cerrar())

const como = (authId, consulta, valores = []) => consultarComo(db, authId, consulta, valores)
const fila = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0]?.r

// El código de error de una llamada que debe fallar.
async function falla(promesa) {
  try {
    await promesa
  } catch (error) {
    return { code: error.code, message: error.message }
  }

  throw new Error("Se esperaba un error y la operación pasó")
}

async function escenario() {
  const admin = await crearEmpresa(db, "Lunacell de prueba")
  const { empresa } = admin

  await db.query("update empresas set tasa_isv = 15, tasa_cargo_tarjeta = 1.7, tasa_cargo_enlace = 1.7 where id = $1", [empresa])

  const ubicacion = async (nombre, tipo) =>
    (
      await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`, [empresa, nombre, tipo])
    ).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const tienda = await ubicacion("Tienda", "tienda")

  const producto = async (nombre, precio) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, $3, $4, 37) returning id`,
        [empresa, `C-${randomUUID().slice(0, 8)}`, nombre, precio]
      )
    ).rows[0].id

  const cargador = await producto("Cargador", 100)
  const cubo = await producto("Cubo", 50)

  await db.query(
    `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 10), ($1, $2, $4, 5)`,
    [empresa, bodega, cargador, cubo]
  )

  const clienteA = await crearCliente(db, empresa, "Cliente A")
  const clienteB = await crearCliente(db, empresa, "Cliente B")

  await db.query(
    "insert into precios_por_cliente (empresa_id, cliente_id, producto_id, precio) values ($1, $2, $3, 40)",
    [empresa, clienteA, cubo]
  )

  const enBodega = await crearVendedor(db, { empresa, ubicacion: bodega, permisos: ["pos", "sales-history"] })
  const enCamion1 = await crearVendedor(db, { empresa, ubicacion: camion1, permisos: ["pos", "sales-history", "sales-void"] })
  const enCamion2 = await crearVendedor(db, { empresa, ubicacion: camion2, permisos: ["pos", "sales-history"] })
  const enTienda = await crearVendedor(db, { empresa, ubicacion: tienda, permisos: ["pos"] })
  const sinPos = await crearVendedor(db, { empresa, ubicacion: bodega, permisos: ["sales-history"] })
  const sinUbicacion = await crearVendedor(db, { empresa, permisos: ["pos"] })
  const contador = await crearVendedor(db, { empresa, permisos: ["sales-history"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  const otra = await crearEmpresa(db, "Otra empresa")

  return {
    admin, empresa, bodega, camion1, camion2, tienda, cargador, cubo, clienteA, clienteB,
    enBodega, enCamion1, enCamion2, enTienda, sinPos, sinUbicacion, contador, otra,
  }
}

const linea = (producto, cantidad, extra = {}) => ({ producto_id: producto, cantidad, ...extra })
const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const tarjeta = (monto, tasa = 1.7) => ({
  medio: "tarjeta",
  monto,
  referencia: "",
  tasa,
  cargo: Math.round(Math.round(monto * 100) * Math.round(tasa * 100) / 10000) / 100,
})

function entregar(e, quien, { destino = e.camion1, cliente = e.clienteA, items, forma = "contado", cobros = [], conIsv = true, venc = null, clave = randomUUID(), nota = "" }) {
  return fila(
    quien.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
       p_cobros => $5::jsonb, p_con_isv => $6, p_fecha_vencimiento => $7,
       p_nota => $8, p_clave_idempotencia => $9) as r`,
    [destino, cliente, JSON.stringify(items), forma, JSON.stringify(cobros), conIsv, venc, nota, clave]
  )
}

const facturar = (quien, pedido) => fila(quien.authId, "select public.facturar_pedido($1) as r", [pedido])

const existencia = async (ubicacion, producto) =>
  (await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]
    ?.cantidad ?? null

const elPedido = async (id) => (await db.query("select * from pedidos_ubicacion where id = $1", [id])).rows[0]
const laVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const num = (valor) => (valor === null || valor === undefined ? valor : Number(valor))

// Dos cargadores al contado en efectivo: 230.
const pedidoSimple = (e, quien = e.enBodega, extra = {}) =>
  entregar(e, quien, { items: [linea(e.cargador, 2)], cobros: [efectivo(230)], ...extra })

describe("Bodega entrega el pedido", () => {
  it("descuenta solo de Bodega, guarda el cobro allí y deja el pedido pendiente sin factura", async () => {
    const e = await escenario()
    const r = await pedidoSimple(e)
    const p = await elPedido(r.pedido_id)

    expect(r).toMatchObject({ numero: "PED-000001", estado: "pendiente", origen: "Bodega", destino: "Camión 01", total: 230, cobrado: 230, saldo: 0, repetido: false })
    expect(await existencia(e.bodega, e.cargador)).toBe(8)
    // Camión 01 no tenía existencias y sigue sin celda: no hubo entrada ficticia.
    expect(await existencia(e.camion1, e.cargador)).toBeNull()
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(0)
    expect(p).toMatchObject({ forma_pago: "contado", estado: "pendiente", venta_id: null, entregado_por: e.enBodega.usuario })

    const mov = (await db.query("select * from movimientos_inventario where pedido_id = $1", [r.pedido_id])).rows

    expect(mov).toHaveLength(1)
    expect(mov[0]).toMatchObject({ tipo: "entrega_pedido", cantidad: -2, ubicacion_id: e.bodega, venta_id: null, usuario_id: e.enBodega.usuario })

    const cobros = (await db.query("select * from cobros_por_medio where pedido_id = $1", [r.pedido_id])).rows

    expect(cobros).toHaveLength(1)
    expect(cobros[0]).toMatchObject({ medio: "efectivo", ubicacion_id: e.bodega, usuario_id: e.enBodega.usuario, venta_id: null, pago_id: null })
    expect(num(cobros[0].monto)).toBe(230)

    const eventos = (await db.query("select tipo, usuario_id from eventos_de_pedido where pedido_id = $1", [r.pedido_id])).rows

    expect(eventos).toEqual([{ tipo: "entregado", usuario_id: e.enBodega.usuario }])
  })

  it("con existencia insuficiente en Bodega no deja nada: ni pedido, ni descuento, ni cobro", async () => {
    const e = await escenario()
    const error = await falla(entregar(e, e.enBodega, { items: [linea(e.cargador, 11)], cobros: [efectivo(1265)] }))

    expect(error.code).toBe("PI007")
    expect(error.message).toContain("Bodega")
    expect(await existencia(e.bodega, e.cargador)).toBe(10)
    expect(await contar(db, "pedidos_ubicacion", "empresa_id = $1", [e.empresa])).toBe(0)
    expect(await contar(db, "cobros_por_medio", "empresa_id = $1", [e.empresa])).toBe(0)
  })

  it("un reintento con la misma clave devuelve el mismo pedido y no descuenta otra vez", async () => {
    const e = await escenario()
    const clave = randomUUID()
    const primero = await pedidoSimple(e, e.enBodega, { clave })
    const segundo = await pedidoSimple(e, e.enBodega, { clave })

    expect(segundo).toMatchObject({ pedido_id: primero.pedido_id, repetido: true })
    expect(await existencia(e.bodega, e.cargador)).toBe(8)
    expect(await contar(db, "pedidos_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
    expect(await contar(db, "cobros_por_medio", "pedido_id = $1", [primero.pedido_id])).toBe(1)
    expect(await contar(db, "movimientos_inventario", "pedido_id = $1", [primero.pedido_id])).toBe(1)
  })

  it("la misma clave con otro pedido se rechaza", async () => {
    const e = await escenario()
    const clave = randomUUID()

    await pedidoSimple(e, e.enBodega, { clave })

    const error = await falla(entregar(e, e.enBodega, { clave, items: [linea(e.cargador, 3)], cobros: [efectivo(345)] }))

    expect(error.code).toBe("PI005")
    expect(await existencia(e.bodega, e.cargador)).toBe(8)
  })

  it("enviado dos veces a la vez con la misma clave: el segundo espera y recibe el mismo pedido", async () => {
    const e = await escenario()
    const clave = randomUUID()
    const llamada = (c) =>
      c.query(
        `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => 'contado',
           p_cobros => $4::jsonb, p_clave_idempotencia => $5) as r`,
        [e.camion1, e.clienteA, JSON.stringify([linea(e.cargador, 2)]), JSON.stringify([efectivo(230)]), clave]
      )

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enBodega.authId, hacer: llamada },
      segunda: { authId: e.enBodega.authId, hacer: llamada },
    })

    expect(r.error).toBeUndefined()
    expect(r.respuesta.rows[0].r.repetido).toBe(true)
    expect(await existencia(e.bodega, e.cargador)).toBe(8)
    expect(await contar(db, "pedidos_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("dos pedidos distintos a la vez no dejan la existencia en negativo", async () => {
    const e = await escenario()
    const llamada = (c) =>
      c.query(
        `select public.entregar_pedido(p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => 'contado',
           p_cobros => $4::jsonb, p_clave_idempotencia => $5) as r`,
        [e.camion1, e.clienteA, JSON.stringify([linea(e.cargador, 6)]), JSON.stringify([efectivo(690)]), randomUUID()]
      )

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enBodega.authId, hacer: llamada },
      segunda: { authId: e.enBodega.authId, hacer: llamada },
    })

    expect(r.error.code).toBe("PI007")
    expect(await existencia(e.bodega, e.cargador)).toBe(4)
  })

  it("guarda el precio general, el especial del cliente y el negociado con su motivo", async () => {
    const e = await escenario()
    const r = await entregar(e, e.enBodega, {
      items: [linea(e.cargador, 2, { precio_negociado: 90, motivo_negociacion: "mayoreo" }), linea(e.cubo, 1)],
      cobros: [efectivo(253)],
    })

    // (2 × 90 + 40) × 1.15 = 253
    expect(r).toMatchObject({ subtotal: 220, isv: 33, total: 253 })

    const renglones = (await db.query("select * from pedido_detalle where pedido_id = $1 order by nombre", [r.pedido_id])).rows

    expect(renglones.map((d) => ({ nombre: d.nombre, precio: num(d.precio), general: num(d.precio_general), especial: num(d.precio_especial), referencia: num(d.precio_referencia), motivo: d.motivo_negociacion }))).toEqual([
      { nombre: "Cargador", precio: 90, general: 100, especial: null, referencia: 100, motivo: "mayoreo" },
      { nombre: "Cubo", precio: 40, general: 50, especial: 40, referencia: null, motivo: null },
    ])
    expect(renglones[0].negociado_por).toBe(e.enBodega.usuario)
  })

  it("bajar el precio sin motivo se rechaza (LN001)", async () => {
    const e = await escenario()
    const error = await falla(entregar(e, e.enBodega, { items: [linea(e.cargador, 1, { precio_negociado: 80 })], cobros: [efectivo(92)] }))

    expect(error.code).toBe("LN001")
    expect(await existencia(e.bodega, e.cargador)).toBe(10)
  })

  it("pago mixto con tarjeta: guarda el porcentaje vigente y su cargo", async () => {
    const e = await escenario()
    const r = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], cobros: [efectivo(130), tarjeta(100)] })
    const cobros = (await db.query("select medio, monto, cargo, tasa_cargo from cobros_por_medio where pedido_id = $1 order by medio", [r.pedido_id])).rows

    expect(cobros.map((c) => [c.medio, num(c.monto), num(c.cargo), num(c.tasa_cargo)])).toEqual([
      ["efectivo", 130, 0, 0],
      ["tarjeta", 100, 1.7, 1.7],
    ])
    expect(r.cargo).toBe(1.7)
    expect(num((await elPedido(r.pedido_id)).tasa_cargo)).toBe(1.7)
  })

  it("un cargo calculado con otro porcentaje se rechaza (LM007), y medios que no suman el total (LM002)", async () => {
    const e = await escenario()

    expect((await falla(entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], cobros: [tarjeta(230, 7)] }))).code).toBe("LM007")
    expect((await falla(entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], cobros: [efectivo(200)] }))).code).toBe("LM002")
    expect(await existencia(e.bodega, e.cargador)).toBe(10)
  })

  it("a crédito sin prima: no cobra nada", async () => {
    const e = await escenario()
    const r = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], forma: "credito", venc: "2026-12-31" })

    expect(r).toMatchObject({ forma_pago: "credito", cobrado: 0, saldo: 230 })
    expect(await contar(db, "cobros_por_medio", "pedido_id = $1", [r.pedido_id])).toBe(0)
  })

  it("a crédito con prima: la prima queda en Bodega; no puede ser el total", async () => {
    const e = await escenario()
    const r = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], forma: "credito", cobros: [efectivo(80)] })

    expect(r).toMatchObject({ cobrado: 80, saldo: 150 })
    expect((await db.query("select ubicacion_id from cobros_por_medio where pedido_id = $1", [r.pedido_id])).rows).toEqual([{ ubicacion_id: e.bodega }])

    const error = await falla(entregar(e, e.enBodega, { items: [linea(e.cargador, 1)], forma: "credito", cobros: [efectivo(115)] }))

    expect(error.code).toBe("PI010")
  })

  it("rechaza destinos que no corresponden", async () => {
    const e = await escenario()

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.camion1, e.enCamion2.usuario])
    await db.query("update ubicaciones set activa = false where id = $1", [e.camion2])

    const noVende = (await db.query("insert into ubicaciones (empresa_id, nombre, tipo, vende) values ($1, 'Taller', 'otro', false) returning id", [e.empresa])).rows[0].id

    for (const destino of [e.bodega, e.camion2, noVende, e.otra.empresa]) {
      expect((await falla(pedidoSimple(e, e.enBodega, { destino }))).code).toBe("PI003")
    }

    expect(await existencia(e.bodega, e.cargador)).toBe(10)
  })

  it("exige un cliente registrado de la empresa", async () => {
    const e = await escenario()
    const ajeno = await crearCliente(db, e.otra.empresa)

    expect((await falla(pedidoSimple(e, e.enBodega, { cliente: null }))).code).toBe("PI004")
    expect((await falla(pedidoSimple(e, e.enBodega, { cliente: ajeno }))).code).toBe("PI004")
  })

  it("sin permiso de facturar, como contador o sin ubicación no se entrega", async () => {
    const e = await escenario()

    expect((await falla(pedidoSimple(e, e.sinPos))).code).toBe("42501")
    expect((await falla(pedidoSimple(e, e.contador))).code).toBe("42501")
    expect((await falla(pedidoSimple(e, e.sinUbicacion))).code).toBe("PI002")
    expect(await existencia(e.bodega, e.cargador)).toBe(10)
  })

  it("a un destino que emite facturas fiscales el pedido lleva ISV", async () => {
    const e = await escenario()

    await db.query("update ubicaciones set emite_fiscal = true where id = $1", [e.tienda])

    expect((await falla(pedidoSimple(e, e.enBodega, { destino: e.tienda, conIsv: false, cobros: [efectivo(200)] }))).code).toBe("PI009")

    const sinIsv = await pedidoSimple(e, e.enBodega, { conIsv: false, cobros: [efectivo(200)] })

    expect(sinIsv).toMatchObject({ isv: 0, total: 200, tasa_isv: 0 })
  })
})

describe("Camión 01 factura el pedido", () => {
  it("al contado: una factura pagada en Camión 01, sin tocar inventario ni registrar otro cobro", async () => {
    const e = await escenario()
    const pedido = await entregar(e, e.enBodega, {
      items: [linea(e.cargador, 2, { precio_negociado: 90, motivo_negociacion: "cliente_frecuente" }), linea(e.cubo, 1)],
      cobros: [efectivo(153), tarjeta(100)],
    })
    const cobrosAntes = await contar(db, "cobros_por_medio", "empresa_id = $1", [e.empresa])
    const movimientosAntes = await contar(db, "movimientos_inventario", "empresa_id = $1", [e.empresa])
    const r = await facturar(e.enCamion1, pedido.pedido_id)
    const v = await laVenta(r.venta_id)

    expect(r).toMatchObject({ estado: "facturado", ya_facturado: false, es_fiscal: false, numero_factura: "VTA-000001" })
    expect(v).toMatchObject({ ubicacion_id: e.camion1, usuario_id: e.enCamion1.usuario, pedido_id: pedido.pedido_id, forma_pago: "contado", estado: "pagada", cliente_id: e.clienteA })
    expect([num(v.subtotal), num(v.isv), num(v.total), num(v.cargo_por_medio), num(v.tasa_cargo)]).toEqual([220, 33, 253, 1.7, 1.7])
    expect(v.nota).toBe("Pedido PED-000001, entregado en Bodega")

    const detalle = (await db.query("select nombre, cantidad, precio, precio_referencia, motivo_negociacion, negociado_por from detalle_venta where venta_id = $1 order by nombre", [r.venta_id])).rows

    expect(detalle.map((d) => [d.nombre, d.cantidad, num(d.precio), num(d.precio_referencia), d.motivo_negociacion])).toEqual([
      ["Cargador", 2, 90, 100, "cliente_frecuente"],
      ["Cubo", 1, 40, null, null],
    ])
    expect(detalle[0].negociado_por).toBe(e.enBodega.usuario)

    expect(await existencia(e.bodega, e.cargador)).toBe(8)
    expect(await existencia(e.camion1, e.cargador)).toBeNull()
    expect(await contar(db, "cobros_por_medio", "empresa_id = $1", [e.empresa])).toBe(cobrosAntes)
    expect(await contar(db, "movimientos_inventario", "empresa_id = $1", [e.empresa])).toBe(movimientosAntes)
    expect(await contar(db, "abonos", "venta_id = $1", [r.venta_id])).toBe(0)

    const p = await elPedido(pedido.pedido_id)

    expect(p).toMatchObject({ estado: "facturado", venta_id: r.venta_id, facturado_por: e.enCamion1.usuario })
    expect((await db.query("select tipo from eventos_de_pedido where pedido_id = $1 order by id", [pedido.pedido_id])).rows.map((x) => x.tipo)).toEqual(["entregado", "facturado"])
  })

  it("facturar otra vez devuelve la misma factura: nunca hay dos", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)
    const primera = await facturar(e.enCamion1, pedido.pedido_id)
    const segunda = await facturar(e.enCamion1, pedido.pedido_id)

    expect(segunda).toMatchObject({ venta_id: primera.venta_id, ya_facturado: true, numero_factura: primera.numero_factura })
    expect(await contar(db, "ventas", "pedido_id = $1", [pedido.pedido_id])).toBe(1)
  })

  it("desde dos dispositivos a la vez: el segundo espera y recibe la factura del primero", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)
    const llamada = (c) => c.query("select public.facturar_pedido($1) as r", [pedido.pedido_id])

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enCamion1.authId, hacer: llamada },
      segunda: { authId: e.admin.authId, hacer: llamada },
    })

    expect(r.error).toBeUndefined()
    expect(r.respuesta.rows[0].r.ya_facturado).toBe(true)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(1)
    expect((await db.query("select proximo_correlativo_interno from empresas where id = $1", [e.empresa])).rows[0].proximo_correlativo_interno).toBe("2")
  })

  it("a crédito con prima: la deuda nace una vez, por el saldo, y la prima solo abona a esta factura", async () => {
    const e = await escenario()
    const vieja = await crearFactura(db, { empresa: e.empresa, clienteId: e.clienteA, total: 500, fecha: "2026-01-01T12:00:00Z" })
    const pedido = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], forma: "credito", cobros: [tarjeta(80)], venc: "2026-12-31" })

    // Mientras está pendiente, la deuda del cliente es solo la factura vieja.
    expect(await deudaDe(db, e.clienteA)).toBe(500)

    const r = await facturar(e.enCamion1, pedido.pedido_id)
    const v = await laVenta(r.venta_id)

    expect(v).toMatchObject({ forma_pago: "credito", estado: "pendiente", ubicacion_id: e.camion1 })
    expect(num(v.cargo_por_medio)).toBe(0)
    expect(String(v.fecha_vencimiento.toISOString?.() ?? v.fecha_vencimiento)).toContain("2026-12-3")

    const abonos = (await db.query("select * from abonos where venta_id = $1", [r.venta_id])).rows

    expect(abonos).toHaveLength(1)
    expect([num(abonos[0].monto), num(abonos[0].saldo_anterior), num(abonos[0].saldo_posterior)]).toEqual([80, 230, 150])
    expect(await contar(db, "abonos", "venta_id = $1", [vieja])).toBe(0)

    const pago = (await db.query("select * from pagos where id = $1", [abonos[0].pago_id])).rows[0]
    const p = await elPedido(pedido.pedido_id)

    expect(pago).toMatchObject({ pedido_id: pedido.pedido_id, ubicacion_id: e.bodega, usuario_id: e.enBodega.usuario })
    expect(new Date(pago.fecha).getTime()).toBe(new Date(p.entregado_en).getTime())
    expect([num(pago.monto), num(pago.cargo_por_medio), num(pago.tasa_cargo)]).toEqual([80, 1.36, 1.7])

    // La prima no se vuelve a registrar como cobro.
    expect(await contar(db, "cobros_por_medio", "pago_id = $1 or venta_id = $2", [pago.id, r.venta_id])).toBe(0)
    expect(await deudaDe(db, e.clienteA)).toBe(650)
  })

  it("a crédito sin prima: la deuda es el total, sin pagos", async () => {
    const e = await escenario()
    const pedido = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2)], forma: "credito" })

    await facturar(e.enCamion1, pedido.pedido_id)

    expect(await deudaDe(db, e.clienteA)).toBe(230)
    expect(await contar(db, "pagos", "cliente_id = $1", [e.clienteA])).toBe(0)
  })

  it("si cambian los precios o el porcentaje mientras espera, factura con lo guardado", async () => {
    const e = await escenario()
    const pedido = await entregar(e, e.enBodega, { items: [linea(e.cargador, 1), linea(e.cubo, 1)], cobros: [tarjeta(161)] })

    await db.query("update productos set precio = 999 where empresa_id = $1", [e.empresa])
    await db.query("update precios_por_cliente set precio = 1 where cliente_id = $1", [e.clienteA])
    await db.query("update empresas set tasa_isv = 18, tasa_cargo_tarjeta = 9 where id = $1", [e.empresa])

    const v = await laVenta((await facturar(e.enCamion1, pedido.pedido_id)).venta_id)

    expect([num(v.subtotal), num(v.isv), num(v.tasa_isv), num(v.total), num(v.cargo_por_medio), num(v.tasa_cargo)]).toEqual([140, 21, 15, 161, 2.74, 1.7])
  })

  it("en un destino fiscal usa la numeración autorizada", async () => {
    const e = await escenario()

    await db.query(
      `update empresas set cai = 'CAI-PRUEBA', rango_desde = 1, rango_hasta = 100, fecha_limite_emision = '2027-12-31',
         establecimiento = '000', punto_emision = '001', tipo_documento = '01' where id = $1`,
      [e.empresa]
    )
    await db.query("update ubicaciones set emite_fiscal = true where id = $1", [e.tienda])

    const pedido = await pedidoSimple(e, e.enBodega, { destino: e.tienda })
    const r = await facturar(e.enTienda, pedido.pedido_id)
    const v = await laVenta(r.venta_id)

    expect(r).toMatchObject({ es_fiscal: true, numero_factura: "000-001-01-00000001" })
    expect(v).toMatchObject({ es_fiscal: true, cai_emision: "CAI-PRUEBA", ubicacion_id: e.tienda })
    expect(num(v.isv)).toBe(30)
  })

  it("solo factura la ubicación destino (o el administrador)", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)

    expect((await falla(facturar(e.enBodega, pedido.pedido_id))).code).toBe("42501")
    expect((await falla(facturar(e.enCamion2, pedido.pedido_id))).code).toBe("42501")
    expect((await falla(facturar(e.contador, pedido.pedido_id))).code).toBe("42501")
    expect((await falla(facturar(e.otra, pedido.pedido_id))).code).toBe("PI008")
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(0)
    expect((await elPedido(pedido.pedido_id)).estado).toBe("pendiente")

    expect((await facturar(e.admin, pedido.pedido_id)).estado).toBe("facturado")
  })

  it("si el destino ya no puede facturar, el pedido sigue pendiente", async () => {
    const e = await escenario()
    const camion3 = (await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Camión 03', 'camion') returning id", [e.empresa])).rows[0].id
    const pedido = await pedidoSimple(e, e.enBodega, { destino: camion3 })

    await db.query("update ubicaciones set activa = false where id = $1", [camion3])

    expect((await falla(facturar(e.admin, pedido.pedido_id))).code).toBe("PI003")
    expect((await elPedido(pedido.pedido_id)).estado).toBe("pendiente")
  })

  it("la anulación actual no alcanza a una factura de pedido: no devuelve nada a ninguna ubicación", async () => {
    const e = await escenario()
    const contado = await facturar(e.enCamion1, (await pedidoSimple(e)).pedido_id)
    const conPrima = await facturar(
      e.enCamion1,
      (await entregar(e, e.enBodega, { items: [linea(e.cargador, 1)], forma: "credito", cobros: [efectivo(15)] })).pedido_id
    )
    const anular = (venta) => fila(e.enCamion1.authId, "select public.anular_venta($1, 'Prueba de anulación de pedido') as r", [venta])

    expect((await falla(anular(contado.venta_id))).code).toBe("AV007")
    expect((await falla(anular(conPrima.venta_id))).code).toBe("AV005")
    expect(await existencia(e.bodega, e.cargador)).toBe(7)
    expect(await existencia(e.camion1, e.cargador)).toBeNull()
    expect((await laVenta(contado.venta_id)).estado).toBe("pagada")
  })
})

describe("avisos y bandeja", () => {
  const avisos = (quien) => fila(quien.authId, "select public.avisos_de_pedidos() as r")
  const bandeja = (quien, vista, estado) => fila(quien.authId, "select public.bandeja_de_pedidos($1, $2) as r", [vista, estado])
  const leer = (quien, pedido) => fila(quien.authId, "select public.marcar_pedido_leido($1) as r", [pedido])

  it("el destino ve el aviso; leerlo no cambia el pedido ni se duplica", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)

    expect(await avisos(e.enCamion1)).toMatchObject({ pendientes: 1, sin_leer: 1 })
    expect((await avisos(e.enCamion1)).ultimos[0]).toMatchObject({ numero: "PED-000001", origen: "Bodega", leido: false })

    await leer(e.enCamion1, pedido.pedido_id)
    await leer(e.enCamion1, pedido.pedido_id)

    expect(await avisos(e.enCamion1)).toMatchObject({ pendientes: 1, sin_leer: 0 })
    expect(await contar(db, "pedido_lecturas", "pedido_id = $1", [pedido.pedido_id])).toBe(1)
    expect((await elPedido(pedido.pedido_id)).estado).toBe("pendiente")

    // Otro usuario del mismo destino todavía no lo leyó.
    const otro = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos"] })

    expect(await avisos(otro)).toMatchObject({ pendientes: 1, sin_leer: 1 })

    await facturar(e.enCamion1, pedido.pedido_id)

    expect(await avisos(e.enCamion1)).toMatchObject({ pendientes: 0, sin_leer: 0 })
  })

  it("la bandeja filtra por estado y separa recibidos de enviados", async () => {
    const e = await escenario()
    const uno = await pedidoSimple(e)
    const dos = await entregar(e, e.enBodega, { items: [linea(e.cubo, 1)], cobros: [efectivo(46)] })

    await facturar(e.enCamion1, uno.pedido_id)

    const numeros = (lista) => lista.map((p) => p.numero)

    expect(numeros(await bandeja(e.enCamion1, "recibidos", "pendiente"))).toEqual(["PED-000002"])
    expect(numeros(await bandeja(e.enCamion1, "recibidos", "facturado"))).toEqual(["PED-000001"])
    expect(numeros(await bandeja(e.enCamion1, "recibidos", "todos"))).toEqual(["PED-000002", "PED-000001"])
    expect(await bandeja(e.enCamion1, "recibidos", "por_resolver")).toEqual([])
    expect(await bandeja(e.enCamion1, "enviados", "todos")).toEqual([])
    expect(numeros(await bandeja(e.enBodega, "enviados", "todos"))).toEqual(["PED-000002", "PED-000001"])
    expect((await bandeja(e.enBodega, "enviados", "facturado"))[0]).toMatchObject({ numero_factura: "VTA-000001", destino: "Camión 01" })
    expect(await avisos(e.enBodega)).toMatchObject({ pendientes: 0 })
    expect(dos.numero).toBe("PED-000002")
  })

  it("aislamiento: otra ubicación, otra empresa y el contador", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)

    expect(await avisos(e.enCamion2)).toMatchObject({ pendientes: 0 })
    expect(await bandeja(e.enCamion2, "recibidos", "todos")).toEqual([])
    expect((await falla(fila(e.enCamion2.authId, "select public.detalle_de_pedido($1) as r", [pedido.pedido_id]))).code).toBe("PI008")
    expect((await falla(leer(e.enCamion2, pedido.pedido_id))).code).toBe("PI008")
    expect((await como(e.enCamion2.authId, "select * from pedidos_ubicacion")).rows).toHaveLength(0)
    expect((await como(e.enCamion2.authId, "select * from pedido_detalle")).rows).toHaveLength(0)
    expect((await como(e.enCamion1.authId, "select * from cobros_por_medio")).rows).toHaveLength(0)

    expect(await avisos(e.otra)).toMatchObject({ pendientes: 0 })
    expect((await como(e.otra.authId, "select * from pedidos_ubicacion")).rows).toHaveLength(0)

    // El contador consulta todo, sin avisos y sin escribir.
    expect(await avisos(e.contador)).toMatchObject({ pendientes: 0 })
    expect(await bandeja(e.contador, "recibidos", "todos")).toHaveLength(1)
    expect((await falla(leer(e.contador, pedido.pedido_id))).code).toBe("42501")

    // Las dos ubicaciones del pedido sí lo ven.
    expect((await como(e.enCamion1.authId, "select id from pedidos_ubicacion")).rows).toHaveLength(1)
    expect((await como(e.enBodega.authId, "select id from pedido_detalle")).rows).toHaveLength(1)
  })

  it("el detalle trae lo necesario para facturar y ningún costo", async () => {
    const e = await escenario()
    const pedido = await entregar(e, e.enBodega, { items: [linea(e.cargador, 2), linea(e.cubo, 1)], forma: "credito", cobros: [efectivo(50)] })
    const d = await fila(e.enCamion1.authId, "select public.detalle_de_pedido($1) as r", [pedido.pedido_id])

    expect(d).toMatchObject({ numero: "PED-000001", origen: "Bodega", destino: "Camión 01", total: 276, cobrado: 50, saldo: 226, puede_facturar: true, entregado_por: expect.any(String) })
    expect(d.productos.map((p) => [p.nombre, p.cantidad, p.entregado, p.precio_general, p.precio_especial])).toEqual([
      ["Cargador", 2, 2, 100, null],
      ["Cubo", 1, 1, 50, 40],
    ])
    expect(d.cobros).toEqual([expect.objectContaining({ medio: "efectivo", monto: 50, ubicacion: "Bodega" })])
    expect(JSON.stringify(d)).not.toMatch(/costo|"37"/)

    const desdeBodega = await fila(e.enBodega.authId, "select public.detalle_de_pedido($1) as r", [pedido.pedido_id])

    expect(desdeBodega.puede_facturar).toBe(false)
  })
})

describe("privilegios de resolver y cancelar", () => {
  const puede = (quien, funcion, pedido) => fila(quien.authId, `select public.${funcion}($1) as r`, [pedido])
  const dar = (e, usuario, seccion) => db.query("insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, $3)", [usuario, e.empresa, seccion])
  const quitar = (usuario, seccion) => db.query("delete from permisos_usuario where usuario_id = $1 and seccion = $2", [usuario, seccion])

  it("la base acepta los dos privilegios nuevos y ninguno inventado", async () => {
    const e = await escenario()

    await dar(e, e.enBodega.usuario, "orders-resolve")
    await dar(e, e.enBodega.usuario, "orders-cancel")

    expect((await falla(dar(e, e.enBodega.usuario, "orders-everything"))).code).toBe("23514")
  })

  for (const [funcion, seccion] of [["usuario_puede_resolver_pedido", "orders-resolve"], ["usuario_puede_autorizar_cancelacion", "orders-cancel"]]) {
    it(`${seccion}: concedido al encargado de Bodega, retirado, y sin efecto fuera de sus ubicaciones`, async () => {
      const e = await escenario()
      const pedido = await pedidoSimple(e)

      expect(await puede(e.enBodega, funcion, pedido.pedido_id)).toBe(false)

      await dar(e, e.enBodega.usuario, seccion)
      expect(await puede(e.enBodega, funcion, pedido.pedido_id)).toBe(true)

      await quitar(e.enBodega.usuario, seccion)
      expect(await puede(e.enBodega, funcion, pedido.pedido_id)).toBe(false)

      // Con el privilegio, pero el pedido no es de su ubicación.
      await dar(e, e.enCamion2.usuario, seccion)
      expect(await puede(e.enCamion2, funcion, pedido.pedido_id)).toBe(false)

      // El contador nunca, aunque se le marque por SQL.
      await dar(e, e.contador.usuario, seccion)
      expect(await puede(e.contador, funcion, pedido.pedido_id)).toBe(false)

      expect(await puede(e.admin, funcion, pedido.pedido_id)).toBe(true)
      expect(await puede(e.otra, funcion, pedido.pedido_id)).toBe(false)

      // El vendedor no puede dárselo a sí mismo.
      await como(e.enCamion1.authId, "select public.guardar_permisos_usuario($1, $2)", [e.enCamion1.usuario, [seccion, "pos"]]).catch(() => {})
      expect(await contar(db, "permisos_usuario", "usuario_id = $1 and seccion = $2", [e.enCamion1.usuario, seccion])).toBe(0)
    })
  }
})

describe("nada se escribe por fuera de las funciones", () => {
  it("la aplicación no puede insertar, cambiar ni borrar pedidos", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)

    expect((await falla(como(e.enCamion1.authId, "update pedidos_ubicacion set total = 1 where id = $1", [pedido.pedido_id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "delete from pedidos_ubicacion where id = $1", [pedido.pedido_id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "insert into pedido_lecturas (pedido_id, usuario_id, empresa_id) values ($1, $2, $3)", [pedido.pedido_id, e.admin.usuario, e.empresa]))).code).toBe("42501")
  })

  it("ni el dueño de la base reescribe lo entregado", async () => {
    const e = await escenario()
    const pedido = await pedidoSimple(e)

    expect((await falla(db.query("update pedidos_ubicacion set total = 1 where id = $1", [pedido.pedido_id]))).message).toContain("pendiente solo puede pasar a facturado")
    expect((await falla(db.query("update pedido_detalle set precio = 1 where pedido_id = $1", [pedido.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from eventos_de_pedido where pedido_id = $1", [pedido.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from cobros_por_medio where pedido_id = $1", [pedido.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from pedidos_ubicacion where id = $1", [pedido.pedido_id]))).code).toBe("42501")

    await facturar(e.enCamion1, pedido.pedido_id)

    expect((await falla(db.query("update pedidos_ubicacion set estado = 'pendiente', venta_id = null, facturado_en = null, facturado_por = null, facturado_por_nombre = null where id = $1", [pedido.pedido_id]))).code).toBe("42501")
  })
})
