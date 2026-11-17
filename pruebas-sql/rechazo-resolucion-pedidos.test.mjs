/*
  0048 contra PostgreSQL de verdad: Bodega entrega un pedido para Ruta local,
  Ruta local lo rechaza y Bodega lo resuelve: lo factura ella misma o lo envía
  a Camión 01.

  Cada caso arma su propia empresa. Bodega tiene existencias; Ruta local, Camión
  01 y Camión 02 facturan; hay una ubicación apagada, una que no factura y una
  fiscal. El cargador vale 100 y el ISV es 15 % (115 con ISV); tarjeta y enlace
  llevan 1.7 %. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones } from "./arnes.mjs"
import { crearEmpresa, crearCliente, crearVendedor, deudaDe, contar } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(() => base?.cerrar())

const como = (authId, consulta, valores = []) => consultarComo(db, authId, consulta, valores)
const fila = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0]?.r
const num = (valor) => (valor === null || valor === undefined ? valor : Number(valor))

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

  const ubicacion = async (nombre, tipo, extra = "") => {
    const id = (await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`, [empresa, nombre, tipo])).rows[0].id

    if (extra) await db.query(`update ubicaciones set ${extra} where id = $1`, [id])

    return id
  }

  const bodega = await ubicacion("Bodega", "bodega")
  const ruta = await ubicacion("Ruta local", "camion")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const apagada = await ubicacion("Camión viejo", "camion", "activa = false")
  const noVende = await ubicacion("Taller", "bodega", "vende = false")
  const fiscal = await ubicacion("Tienda fiscal", "tienda", "emite_fiscal = true")

  const cargador = (
    await db.query(`insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Cargador', 100, 37) returning id`, [
      empresa,
      `C-${randomUUID().slice(0, 8)}`,
    ])
  ).rows[0].id

  await db.query(`insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 50)`, [empresa, bodega, cargador])

  const cliente = await crearCliente(db, empresa, "Cliente A")
  const vendedor = (ubicacionId, permisos) => crearVendedor(db, { empresa, ubicacion: ubicacionId, permisos })

  const enBodega = await vendedor(bodega, ["pos"])
  const resuelveBodega = await vendedor(bodega, ["pos", "orders-resolve"])
  const resuelveSinFacturar = await vendedor(bodega, ["orders-resolve"])
  const enRuta = await vendedor(ruta, ["pos"])
  const resuelveRuta = await vendedor(ruta, ["pos", "orders-resolve"])
  const sinPosRuta = await vendedor(ruta, ["sales-history"])
  const enCamion1 = await vendedor(camion1, ["pos"])
  const enCamion2 = await vendedor(camion2, ["pos"])
  const contador = await crearVendedor(db, { empresa, permisos: ["pos", "sales-history", "orders-resolve", "orders-cancel"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  const otra = await crearEmpresa(db, "Otra empresa")
  const deOtra = (await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Ajena', 'tienda') returning id`, [otra.empresa])).rows[0].id

  return {
    admin, empresa, bodega, ruta, camion1, camion2, apagada, noVende, fiscal, cargador, cliente,
    enBodega, resuelveBodega, resuelveSinFacturar, enRuta, resuelveRuta, sinPosRuta, enCamion1, enCamion2, contador, otra, deOtra,
  }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const tarjeta = (monto) => ({ medio: "tarjeta", monto, referencia: "", tasa: 1.7, cargo: Math.round(monto * 1.7) / 100 })

// Bodega entrega `cantidad` cargadores (115 cada uno con ISV) para Ruta local.
const entregar = (e, { cantidad = 2, forma = "contado", cobros = forma === "contado" ? [efectivo(115 * cantidad)] : [], destino = e.ruta, conIsv = true } = {}) =>
  fila(
    e.enBodega.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
       p_cobros => $5::jsonb, p_con_isv => $6, p_fecha_vencimiento => $7, p_clave_idempotencia => $8) as r`,
    [destino, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad }]), forma, JSON.stringify(cobros), conIsv, forma === "credito" ? "2030-01-01" : null, randomUUID()]
  )

const rechazar = (quien, pedido, motivo = "Este pedido no es de esta ruta", clave = randomUUID()) =>
  fila(quien.authId, "select public.rechazar_pedido($1, $2, $3) as r", [pedido, motivo, clave])

const resolver = (quien, pedido, decision, { destino = null, nota = "", clave = randomUUID() } = {}) =>
  fila(quien.authId, "select public.resolver_pedido($1, $2, $3, $4, $5) as r", [pedido, decision, destino, nota, clave])

const facturar = (quien, pedido) => fila(quien.authId, "select public.facturar_pedido($1) as r", [pedido])
const detalle = (quien, pedido) => fila(quien.authId, "select public.detalle_de_pedido($1) as r", [pedido])
const avisos = (quien) => fila(quien.authId, "select public.avisos_de_pedidos() as r")
const control = (quien) => fila(quien.authId, "select public.control_de_liquidaciones() as r")

const elPedido = async (id) => (await db.query("select * from pedidos_ubicacion where id = $1", [id])).rows[0]
const laVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const eventos = async (id) =>
  (await db.query("select tipo, usuario_nombre, ubicacion_usuario, motivo, detalle from eventos_de_pedido where pedido_id = $1 order by creado_en, id", [id])).rows
const existencia = async (ubicacion, producto) =>
  (await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? null

// Lo que rechazar y resolver no pueden tocar.
async function huellaComercial(e) {
  const filas = async (consulta) => (await db.query(consulta, [e.empresa])).rows

  return {
    inventario: await filas("select ubicacion_id, producto_id, cantidad from inventario_ubicacion where empresa_id = $1 order by 1, 2"),
    movimientos: await filas("select id, tipo, cantidad, ubicacion_id, pedido_id from movimientos_inventario where empresa_id = $1 order by id"),
    cobros: await filas("select id, medio, monto, cargo, ubicacion_id, pedido_id, venta_id, pago_id from cobros_por_medio where empresa_id = $1 order by id"),
    detalle: await filas("select * from pedido_detalle where empresa_id = $1 order by id"),
    liquidaciones: await filas("select * from liquidaciones_ubicacion where empresa_id = $1 order by id"),
  }
}

// Las liquidaciones las opera el administrador.
const registrarLiquidacion = (e, monto, { origen = e.bodega, destino = e.ruta, pedido = null } = {}) =>
  fila(
    e.admin.authId,
    `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo',
       p_pedido => $4, p_clave_idempotencia => $5) as r`,
    [origen, destino, monto, pedido, randomUUID()]
  )

const resolverLiquidacion = (e, id, confirmar, motivo = null) =>
  fila(e.admin.authId, "select public.resolver_liquidacion($1, $2, $3) as r", [id, confirmar, motivo])

const parDe = (c, origen, destino) => c.pares.find((p) => p.origen_id === origen && p.destino_id === destino)

describe("rechazar un pedido pendiente", () => {
  it("pasa a por resolver con motivo, usuario y ubicación, sin tocar inventario, cobros ni liquidaciones", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const antes = await huellaComercial(e)
    const pedidoAntes = await elPedido(p.pedido_id)

    const r = await rechazar(e.enRuta, p.pedido_id, "Corresponde facturarlo en Bodega")

    expect(r).toMatchObject({ estado: "por_resolver", numero: p.numero, destino: "Ruta local", total: 230, cobrado: 230, repetido: false })

    const despues = await elPedido(p.pedido_id)
    const { estado: _estado, ...restoAntes } = pedidoAntes
    const { estado, ...restoDespues } = despues

    expect(estado).toBe("por_resolver")
    expect(restoDespues).toEqual(restoAntes)
    expect(await huellaComercial(e)).toEqual(antes)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(0)
    expect(await contar(db, "pagos", "empresa_id = $1", [e.empresa])).toBe(0)

    const historia = await eventos(p.pedido_id)

    expect(historia.map((x) => x.tipo)).toEqual(["entregado", "rechazado"])
    expect(historia[1]).toMatchObject({ motivo: "Corresponde facturarlo en Bodega", ubicacion_usuario: e.ruta, detalle: { destino_id: e.ruta, destino: "Ruta local" } })
  })

  it("exige motivo y clave", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(rechazar(e.enRuta, p.pedido_id, "  no "))).code).toBe("PI001")
    expect((await falla(rechazar(e.enRuta, p.pedido_id, ""))).code).toBe("PI001")
    expect((await falla(rechazar(e.enRuta, p.pedido_id, "x".repeat(501)))).code).toBe("PI001")
    expect((await falla(rechazar(e.enRuta, p.pedido_id, "Motivo válido", " "))).code).toBe("PI001")
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")
  })

  it("mientras está por resolver nadie lo factura, ni el administrador", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    expect((await falla(facturar(e.enRuta, p.pedido_id))).code).toBe("PI008")
    expect((await falla(facturar(e.admin, p.pedido_id))).code).toBe("PI008")
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(0)
  })

  it("un pedido facturado no se rechaza", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await facturar(e.enRuta, p.pedido_id)

    const r = await falla(rechazar(e.enRuta, p.pedido_id))

    expect(r.code).toBe("PI012")
    expect(r.message).toContain("ya está facturado")
  })

  it("el reintento con la misma clave no duplica; la clave con otro motivo da PI011; rechazar otra vez da PI012", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()

    await rechazar(e.enRuta, p.pedido_id, "Motivo del rechazo", clave)
    const otraVez = await rechazar(e.enRuta, p.pedido_id, "Motivo del rechazo", clave)

    expect(otraVez).toMatchObject({ estado: "por_resolver", repetido: true })
    expect((await falla(rechazar(e.enRuta, p.pedido_id, "Otro motivo distinto", clave))).code).toBe("PI011")
    expect((await falla(rechazar(e.enRuta, p.pedido_id, "Motivo del rechazo"))).code).toBe("PI012")
    expect((await eventos(p.pedido_id)).filter((x) => x.tipo === "rechazado")).toHaveLength(1)
  })

  it("lo rechaza quien factura en el destino o el administrador; nadie más", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(rechazar(e.enBodega, p.pedido_id))).code).toBe("42501")
    expect((await falla(rechazar(e.enCamion1, p.pedido_id))).code).toBe("42501")
    expect((await falla(rechazar(e.sinPosRuta, p.pedido_id))).code).toBe("42501")
    expect((await falla(rechazar(e.contador, p.pedido_id))).code).toBe("42501")
    expect((await falla(rechazar(e.otra, p.pedido_id))).code).toBe("PI008")
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")

    const r = await rechazar(e.admin, p.pedido_id, "Lo rechaza el administrador")

    expect(r.estado).toBe("por_resolver")
    expect((await eventos(p.pedido_id))[1].detalle).toMatchObject({ destino: "Ruta local" })
  })
})

describe("facturar en origen", () => {
  it("al contado en efectivo: una factura de Bodega, pagada, sin otro cobro, sin inventario y sin nada que liquidar", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id, "Corresponde a Bodega")

    const antes = await huellaComercial(e)
    const r = await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen", { nota: "El cliente es de Bodega" })

    expect(r).toMatchObject({ estado: "facturado", origen: "Bodega", destino: "Bodega", total: 230, cobrado: 230, saldo: 0, ya_facturado: false, repetido: false, decision: "facturar_en_origen" })

    const venta = await laVenta(r.venta_id)

    expect(venta).toMatchObject({ ubicacion_id: e.bodega, estado: "pagada", forma_pago: "contado", pedido_id: p.pedido_id })
    expect(num(venta.total)).toBe(230)
    expect(await huellaComercial(e)).toEqual(antes)
    expect(await existencia(e.bodega, e.cargador)).toBe(48)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(1)

    // Bodega cobró y Bodega factura: no le debe nada a nadie.
    const c = await control(e.admin)

    expect(c.pedidos.find((x) => x.pedido_id === p.pedido_id)).toBeUndefined()
    expect(parDe(c, e.bodega, e.ruta)).toBeUndefined()
    expect((await falla(registrarLiquidacion(e, 10))).code).toBe("LQ002")

    const historia = await eventos(p.pedido_id)

    expect(historia.map((x) => x.tipo)).toEqual(["entregado", "rechazado", "facturar_en_origen", "facturado"])
    expect(historia[2]).toMatchObject({ motivo: "El cliente es de Bodega", ubicacion_usuario: e.bodega, detalle: { desde: "Ruta local", hacia: "Bodega" } })
  })

  it("a crédito con pago parcial: factura 230, el pago de 100 ya aplicado, deuda 130 y nada que liquidar", async () => {
    const e = await escenario()
    const p = await entregar(e, { forma: "credito", cobros: [efectivo(100)] })

    await rechazar(e.enRuta, p.pedido_id)

    const r = await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen")
    const venta = await laVenta(r.venta_id)

    expect(venta).toMatchObject({ ubicacion_id: e.bodega, estado: "pendiente", forma_pago: "credito" })
    expect(await deudaDe(db, e.cliente)).toBe(130)
    expect(await contar(db, "pagos", "pedido_id = $1", [p.pedido_id])).toBe(1)
    expect(await contar(db, "abonos", "venta_id = $1", [r.venta_id])).toBe(1)
    expect(await contar(db, "cobros_por_medio", "pedido_id = $1", [p.pedido_id])).toBe(1)
    expect((await control(e.admin)).pedidos).toEqual([])
  })

  it("a crédito sin anticipo: la deuda es el total", async () => {
    const e = await escenario()
    const p = await entregar(e, { forma: "credito" })

    await rechazar(e.enRuta, p.pedido_id)
    await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen")

    expect(await deudaDe(db, e.cliente)).toBe(230)
    expect(await contar(db, "pagos", "empresa_id = $1", [e.empresa])).toBe(0)
  })

  it("el reintento devuelve la misma factura; facturar otra vez también; resolver de nuevo da PI012", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()

    await rechazar(e.enRuta, p.pedido_id)

    const r = await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen", { clave })
    const otraVez = await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen", { clave })

    expect(otraVez).toMatchObject({ repetido: true, venta_id: r.venta_id, numero_factura: r.numero_factura })
    expect(await facturar(e.resuelveBodega, p.pedido_id)).toMatchObject({ ya_facturado: true, venta_id: r.venta_id })
    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 }))).code).toBe("PI012")
    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1, clave }))).code).toBe("PI011")
    expect((await falla(rechazar(e.enRuta, p.pedido_id))).code).toBe("42501")
    expect(await contar(db, "ventas", "pedido_id = $1", [p.pedido_id])).toBe(1)
  })

  it("necesita también «Facturar»; sin él no queda nada a medias", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    expect((await falla(resolver(e.resuelveSinFacturar, p.pedido_id, "facturar_en_origen"))).code).toBe("42501")
    expect(await elPedido(p.pedido_id)).toMatchObject({ estado: "por_resolver", destino_id: e.ruta })
    expect((await eventos(p.pedido_id)).map((x) => x.tipo)).toEqual(["entregado", "rechazado"])
  })

  it("el administrador lo factura en la ubicación del pedido, no en la suya", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.camion2, e.admin.usuario])
    await rechazar(e.enRuta, p.pedido_id)

    const r = await resolver(e.admin, p.pedido_id, "facturar_en_origen")

    expect((await laVenta(r.venta_id)).ubicacion_id).toBe(e.bodega)
  })
})

describe("enviar a otra ubicación", () => {
  it("el mismo pedido vuelve a pendiente en Camión 01, que lo factura; sin descontar ni cobrar otra vez", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id, "No es de esta ruta")

    const antes = await huellaComercial(e)
    const r = await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })

    expect(r).toMatchObject({ estado: "pendiente", numero: p.numero, destino: "Camión 01", total: 230, cobrado: 230, repetido: false, decision: "reenviar" })
    expect(await huellaComercial(e)).toEqual(antes)

    // Ruta local ya no lo ve; Camión 01 sí, y lo factura.
    expect((await falla(detalle(e.enRuta, p.pedido_id))).code).toBe("PI008")
    expect((await falla(facturar(e.enRuta, p.pedido_id))).code).toBe("42501")

    const f = await facturar(e.enCamion1, p.pedido_id)

    expect((await laVenta(f.venta_id)).ubicacion_id).toBe(e.camion1)
    expect(await existencia(e.bodega, e.cargador)).toBe(48)
    expect(await existencia(e.camion1, e.cargador)).toBeNull()
    expect(await contar(db, "movimientos_inventario", "pedido_id = $1", [p.pedido_id])).toBe(1)

    const historia = await eventos(p.pedido_id)

    expect(historia.map((x) => x.tipo)).toEqual(["entregado", "rechazado", "reenviado", "facturado"])
    expect(historia[2].detalle).toMatchObject({ desde_id: e.ruta, desde: "Ruta local", hacia_id: e.camion1, hacia: "Camión 01" })
  })

  it("el efectivo pasa a deberse a Camión 01; mientras estaba por resolver no se podía liquidar", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect(num(parDe(await control(e.admin), e.bodega, e.ruta).pendiente)).toBe(230)

    await rechazar(e.enRuta, p.pedido_id)

    expect(parDe(await control(e.admin), e.bodega, e.ruta)).toBeUndefined()
    expect((await falla(registrarLiquidacion(e, 230))).code).toBe("LQ002")
    expect((await falla(registrarLiquidacion(e, 230, { pedido: p.pedido_id }))).code).toBe("LQ002")

    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })

    const c = await control(e.admin)

    expect(parDe(c, e.bodega, e.ruta)).toBeUndefined()
    expect(num(parDe(c, e.bodega, e.camion1).pendiente)).toBe(230)

    // Se liquida al destino nuevo, con el registro de siempre.
    const liq = await registrarLiquidacion(e, 230, { destino: e.camion1 })

    expect(liq).toMatchObject({ estado: "por_confirmar", destino_id: e.camion1 })
  })

  it("pagado completo, con pago parcial y sin anticipo: la factura de Camión 01 reconoce lo pagado", async () => {
    const e = await escenario()
    const casos = [
      { forma: "contado", cobros: [efectivo(230)], saldo: 0, pendiente: 230, estado: "pagada" },
      { forma: "credito", cobros: [efectivo(100)], saldo: 130, pendiente: 100, estado: "pendiente" },
      { forma: "credito", cobros: [], saldo: 230, pendiente: 0, estado: "pendiente" },
    ]

    for (const caso of casos) {
      const p = await entregar(e, caso)

      await rechazar(e.enRuta, p.pedido_id)
      await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })

      const f = await facturar(e.enCamion1, p.pedido_id)
      const deuda = await db.query(
        `select case when v.forma_pago = 'contado' then 0
                     else v.total - coalesce((select sum(a.monto) from abonos a where a.venta_id = v.id), 0) end as saldo,
                v.estado
           from ventas v where v.id = $1`,
        [f.venta_id]
      )

      expect([num(deuda.rows[0].saldo), deuda.rows[0].estado]).toEqual([caso.saldo, caso.estado])
      expect(num((await control(e.admin)).pedidos.find((x) => x.pedido_id === p.pedido_id)?.pendiente ?? 0)).toBe(caso.pendiente)
    }
  })

  it("con tarjeta no hay nada que liquidar y el cargo sigue en la factura; con pago mixto solo el efectivo", async () => {
    const e = await escenario()
    const conTarjeta = await entregar(e, { cobros: [tarjeta(230)] })
    const mixto = await entregar(e, { cobros: [efectivo(130), tarjeta(100)] })

    for (const p of [conTarjeta, mixto]) {
      await rechazar(e.enRuta, p.pedido_id)
      await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })
      await facturar(e.enCamion1, p.pedido_id)
    }

    const c = await control(e.admin)
    const deTarjeta = c.pedidos.find((x) => x.pedido_id === conTarjeta.pedido_id)
    const deMixto = c.pedidos.find((x) => x.pedido_id === mixto.pedido_id)

    expect([num(deTarjeta.efectivo), num(deTarjeta.electronico), num(deTarjeta.pendiente)]).toEqual([0, 230, 0])
    expect([num(deMixto.efectivo), num(deMixto.electronico), num(deMixto.pendiente)]).toEqual([130, 100, 130])
    expect(num((await laVenta((await elPedido(conTarjeta.pedido_id)).venta_id)).cargo_por_medio)).toBe(3.91)
  })

  it("rechazos y reenvíos sucesivos: la historia guarda los dos rechazos y cada destino", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id, "No es de Ruta local")
    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })
    await rechazar(e.enCamion1, p.pedido_id, "Tampoco es de Camión 01")
    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion2 })
    await facturar(e.enCamion2, p.pedido_id)

    const historia = await eventos(p.pedido_id)

    expect(historia.map((x) => x.tipo)).toEqual(["entregado", "rechazado", "reenviado", "rechazado", "reenviado", "facturado"])
    expect(historia.filter((x) => x.tipo === "rechazado").map((x) => [x.motivo, x.detalle.destino])).toEqual([
      ["No es de Ruta local", "Ruta local"],
      ["Tampoco es de Camión 01", "Camión 01"],
    ])
    expect(historia.filter((x) => x.tipo === "reenviado").map((x) => [x.detalle.desde, x.detalle.hacia])).toEqual([
      ["Ruta local", "Camión 01"],
      ["Camión 01", "Camión 02"],
    ])
    expect(await contar(db, "pedidos_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("solo a otra ubicación activa de la empresa que factura, que no sea el origen ni la que lo rechazó", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const sinIsv = await entregar(e, { conIsv: false, cobros: [efectivo(200)] })

    await rechazar(e.enRuta, p.pedido_id)
    await rechazar(e.enRuta, sinIsv.pedido_id)

    const destinoMalo = async (destino, pedido = p.pedido_id) => (await falla(resolver(e.resuelveBodega, pedido, "reenviar", { destino }))).code

    expect(await destinoMalo(null)).toBe("PI003")
    expect(await destinoMalo(e.bodega)).toBe("PI003")
    expect(await destinoMalo(e.ruta)).toBe("PI003")
    expect(await destinoMalo(e.apagada)).toBe("PI003")
    expect(await destinoMalo(e.noVende)).toBe("PI003")
    expect(await destinoMalo(e.deOtra)).toBe("PI003")
    expect(await destinoMalo(e.fiscal, sinIsv.pedido_id)).toBe("PI009")
    expect(await elPedido(p.pedido_id)).toMatchObject({ estado: "por_resolver", destino_id: e.ruta })

    // Con ISV, la ubicación fiscal sí lo recibe.
    expect((await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.fiscal })).destino).toBe("Tienda fiscal")
  })

  it("el reintento con la misma clave no lo mueve otra vez; con otro destino da PI011", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()

    await rechazar(e.enRuta, p.pedido_id)
    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1, clave })

    expect(await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1, clave })).toMatchObject({ repetido: true, destino: "Camión 01" })
    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion2, clave }))).code).toBe("PI011")
    expect((await eventos(p.pedido_id)).filter((x) => x.tipo === "reenviado")).toHaveLength(1)
  })
})

describe("quién resuelve", () => {
  it("quien tiene «Resolver» en la ubicación que entregó, o el administrador; nadie más", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    const intento = async (quien) => (await falla(resolver(quien, p.pedido_id, "reenviar", { destino: e.camion1 }))).code

    expect(await intento(e.enBodega)).toBe("42501")
    expect(await intento(e.resuelveRuta)).toBe("42501")
    expect(await intento(e.enCamion1)).toBe("42501")
    expect(await intento(e.contador)).toBe("42501")
    expect(await intento(e.otra)).toBe("PI008")
    expect(await elPedido(p.pedido_id)).toMatchObject({ estado: "por_resolver", destino_id: e.ruta })

    // Sin «Facturar» se puede reenviar: no emite factura.
    expect((await resolver(e.resuelveSinFacturar, p.pedido_id, "reenviar", { destino: e.camion1 })).estado).toBe("pendiente")
  })

  it("el administrador reenvía cualquier pedido de su empresa", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    expect((await resolver(e.admin, p.pedido_id, "reenviar", { destino: e.camion2 })).destino).toBe("Camión 02")
  })

  it("solo se resuelve un pedido por resolver, y la decisión debe existir", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 }))).code).toBe("PI012")

    await rechazar(e.enRuta, p.pedido_id)

    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "cancelar"))).code).toBe("PI001")
    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1, nota: "x".repeat(501) }))).code).toBe("PI001")
  })
})

describe("liquidaciones registradas", () => {
  it("con una entrega por confirmar no se rechaza; rechazada esa entrega, sí", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const liq = await registrarLiquidacion(e, 100)
    const r = await falla(rechazar(e.enRuta, p.pedido_id))

    expect(r.code).toBe("PI013")
    expect(r.message).toContain(liq.numero)
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")

    await resolverLiquidacion(e, liq.id, false, "No llegó el dinero")

    expect((await rechazar(e.enRuta, p.pedido_id)).estado).toBe("por_resolver")
  })

  it("con una entrega confirmada, aunque sea parcial, no se rechaza", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const liq = await registrarLiquidacion(e, 50)

    await resolverLiquidacion(e, liq.id, true)

    expect((await falla(rechazar(e.enRuta, p.pedido_id))).code).toBe("PI013")
    expect((await falla(rechazar(e.admin, p.pedido_id))).code).toBe("PI013")
  })

  it("si un pedido por resolver tuviera efectivo liquidado, no se resuelve por ninguna vía", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    // Una liquidación anterior escrita directamente: el caso que la etapa C1 no puede ajustar.
    const liq = (
      await db.query(
        `insert into liquidaciones_ubicacion (empresa_id, numero, correlativo, origen_id, destino_id, monto, metodo, fecha_efectiva,
           registrada_por, registrada_por_nombre, clave_idempotencia, huella)
         values ($1, 'LIQ-000099', 99, $2, $3, 50, 'entrega_en_efectivo', current_date, $4, 'Admin', $5, '-') returning id`,
        [e.empresa, e.bodega, e.ruta, e.admin.usuario, randomUUID()]
      )
    ).rows[0].id

    await db.query("insert into liquidacion_detalle (empresa_id, liquidacion_id, pedido_id, monto) values ($1, $2, $3, 50)", [e.empresa, liq, p.pedido_id])

    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 }))).code).toBe("PI013")
    expect((await falla(resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen"))).code).toBe("PI013")
    expect((await detalle(e.resuelveBodega, p.pedido_id)).bloqueo_por_liquidacion).toBe("LIQ-000099 (por confirmar)")
  })
})

describe("a la vez", () => {
  it("dos personas resuelven el mismo pedido: el segundo espera y encuentra el pedido ya resuelto", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.admin.authId, hacer: (c) => c.query("select public.resolver_pedido($1, 'facturar_en_origen', null, '', $2)", [p.pedido_id, randomUUID()]) },
      segunda: { authId: e.resuelveBodega.authId, hacer: (c) => c.query("select public.resolver_pedido($1, 'reenviar', $2, '', $3)", [p.pedido_id, e.camion1, randomUUID()]) },
    })

    expect(r.error?.code).toBe("PI012")
    expect(await elPedido(p.pedido_id)).toMatchObject({ estado: "facturado", destino_id: e.bodega })
    expect(await contar(db, "ventas", "pedido_id = $1", [p.pedido_id])).toBe(1)
  })

  it("facturar y rechazar a la vez: si factura primero, el rechazo llega tarde", async () => {
    const e = await escenario()
    const p = await entregar(e)

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enRuta.authId, hacer: (c) => c.query("select public.facturar_pedido($1)", [p.pedido_id]) },
      segunda: { authId: e.enRuta.authId, hacer: (c) => c.query("select public.rechazar_pedido($1, 'Llegó tarde el rechazo', $2)", [p.pedido_id, randomUUID()]) },
    })

    expect(r.error?.code).toBe("PI012")
    expect((await elPedido(p.pedido_id)).estado).toBe("facturado")
  })

  it("rechazar mientras se registra una liquidación del par: el rechazo espera y la ve", async () => {
    const e = await escenario()
    const p = await entregar(e)

    const r = await enDosSesiones(base, db, {
      primera: {
        authId: e.admin.authId,
        hacer: (c) =>
          c.query(
            "select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => 100, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $3)",
            [e.bodega, e.ruta, randomUUID()]
          ),
      },
      segunda: { authId: e.enRuta.authId, hacer: (c) => c.query("select public.rechazar_pedido($1, 'Rechazo simultáneo', $2)", [p.pedido_id, randomUUID()]) },
    })

    expect(r.error?.code).toBe("PI013")
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")
  })
})

describe("avisos y detalle", () => {
  it("el rechazo avisa a Bodega con el motivo; el reenvío avisa a Camión 01 y Ruta local deja de verlo", async () => {
    const e = await escenario()
    const p = await entregar(e)

    // Bodega ya había abierto su pedido: el rechazo vuelve a dejarlo sin leer.
    await fila(e.enBodega.authId, "select public.marcar_pedido_leido($1) as r", [p.pedido_id])
    expect(await avisos(e.enRuta)).toMatchObject({ pendientes: 1, sin_leer: 1, por_resolver: 0 })

    await rechazar(e.enRuta, p.pedido_id, "No es de Ruta local")

    expect(await avisos(e.enRuta)).toMatchObject({ pendientes: 0, por_resolver: 0, ultimos: [] })

    const deBodega = await avisos(e.enBodega)

    expect(deBodega).toMatchObject({ pendientes: 0, por_resolver: 1, por_resolver_sin_leer: 1 })
    expect(deBodega.ultimos).toEqual([
      expect.objectContaining({ pedido_id: p.pedido_id, estado: "por_resolver", destino: "Ruta local", motivo: "No es de Ruta local", leido: false }),
    ])
    expect(await avisos(e.admin)).toMatchObject({ por_resolver: 1 })
    expect(await avisos(e.contador)).toMatchObject({ pendientes: 0, sin_leer: 0, por_resolver: 0 })
    expect((await avisos(e.enCamion1)).por_resolver).toBe(0)

    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })

    expect(await avisos(e.enBodega)).toMatchObject({ por_resolver: 0 })
    expect(await avisos(e.enCamion1)).toMatchObject({ pendientes: 1, sin_leer: 1 })
    expect((await avisos(e.enCamion1)).ultimos[0]).toMatchObject({ pedido_id: p.pedido_id, estado: "pendiente" })
    expect(await avisos(e.enRuta)).toMatchObject({ pendientes: 0, por_resolver: 0 })
  })

  it("facturar en origen no deja avisos pendientes en ninguna parte", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)
    await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen")

    for (const quien of [e.enBodega, e.enRuta, e.admin]) {
      expect(await avisos(quien)).toMatchObject({ pendientes: 0, por_resolver: 0 })
    }
  })

  it("el detalle dice a cada quien qué puede hacer, el rechazo vigente y a dónde reenviar", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect(await detalle(e.enRuta, p.pedido_id)).toMatchObject({ puede_facturar: true, puede_rechazar: true, puede_resolver: false })
    expect(await detalle(e.enBodega, p.pedido_id)).toMatchObject({ puede_facturar: false, puede_rechazar: false })
    expect(await detalle(e.sinPosRuta, p.pedido_id)).toMatchObject({ puede_rechazar: false })

    await rechazar(e.enRuta, p.pedido_id, "No es de Ruta local")

    const deQuienResuelve = await detalle(e.resuelveBodega, p.pedido_id)

    expect(deQuienResuelve).toMatchObject({
      estado: "por_resolver",
      puede_facturar: false,
      puede_rechazar: false,
      puede_resolver: true,
      puede_facturar_en_origen: true,
      bloqueo_por_liquidacion: null,
      rechazo: { motivo: "No es de Ruta local", ubicacion: "Ruta local" },
    })
    expect(deQuienResuelve.destinos_para_reenviar.map((d) => d.nombre)).toEqual(["Camión 01", "Camión 02", "Tienda fiscal"])
    expect(deQuienResuelve.eventos.map((x) => x.tipo)).toEqual(["entregado", "rechazado"])
    expect(deQuienResuelve.eventos[1]).toMatchObject({ ubicacion: "Ruta local", rechazado_en: "Ruta local", motivo: "No es de Ruta local" })

    expect(await detalle(e.resuelveSinFacturar, p.pedido_id)).toMatchObject({ puede_resolver: true, puede_facturar_en_origen: false })
    expect(await detalle(e.enBodega, p.pedido_id)).toMatchObject({ puede_resolver: false, destinos_para_reenviar: [] })
    expect(await detalle(e.resuelveRuta, p.pedido_id)).toMatchObject({ puede_resolver: false, puede_rechazar: false })
  })

  it("el detalle de la 0045 sigue igual dentro del nuevo, y sin costos", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const nuevo = await detalle(e.enRuta, p.pedido_id)

    expect(JSON.stringify(nuevo)).not.toContain("costo")
    expect(nuevo).toMatchObject({ numero: p.numero, estado: "pendiente", total: 230, cobrado: 230, saldo: 0, puede_facturar: true })
    expect(nuevo.productos[0]).toMatchObject({ cantidad: 2, entregado: 2 })
    expect(nuevo.cobros).toEqual([expect.objectContaining({ medio: "efectivo", ubicacion: "Bodega" })])

    // La aplicación no llama la versión base directamente.
    expect((await falla(fila(e.enRuta.authId, "select public.detalle_de_pedido_base($1) as r", [p.pedido_id]))).code).toBe("42501")
  })
})

describe("reportes de caja", () => {
  const reporte = (e) => fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")
  const medios = (e) => fila(e.admin.authId, "select public.reporte_medios_de_caja() as r")
  const deBodega = (filas, e) => filas.find((u) => u.ubicacion_id === e.bodega)

  it("facturado en origen: el cobro sigue en la caja de Bodega con su medio, pero no como «por cuenta de otra»", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)
    await resolver(e.resuelveBodega, p.pedido_id, "facturar_en_origen")

    const r = await reporte(e)
    const m = await medios(e)

    expect(num(r.indicadores.cobros_total)).toBe(230)
    expect(num(r.indicadores.ventas_total)).toBe(230)
    expect([num(r.indicadores.cobros_por_cuenta_de_otras), r.indicadores.cobros_por_cuenta_de_otras_cantidad]).toEqual([0, 0])
    expect([num(deBodega(r.por_ubicacion, e).cobros_total), num(deBodega(r.por_ubicacion, e).cobros_por_cuenta_de_otras)]).toEqual([230, 0])
    expect(r.cobros_de_pedidos).toEqual([])
    expect(r.saldos_por_liquidar).toEqual([])

    expect([num(m.totales.total), num(m.totales.sin_registrar), num(m.totales.por_cuenta_de_otras)]).toEqual([230, 0, 0])
    expect([num(deBodega(m.por_ubicacion, e).efectivo), num(deBodega(m.por_ubicacion, e).por_cuenta_de_otras)]).toEqual([230, 0])
    expect(m.cobros_de_pedidos).toEqual([])
  })

  it("reenviado y facturado en Camión 01: Bodega lo cobró por cuenta de otra, como siempre", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await rechazar(e.enRuta, p.pedido_id)
    await resolver(e.resuelveBodega, p.pedido_id, "reenviar", { destino: e.camion1 })
    await facturar(e.enCamion1, p.pedido_id)

    const r = await reporte(e)
    const m = await medios(e)

    expect([num(r.indicadores.cobros_total), num(r.indicadores.cobros_por_cuenta_de_otras)]).toEqual([230, 230])
    expect(r.cobros_de_pedidos).toEqual([expect.objectContaining({ pedido_id: p.pedido_id, destino: "Camión 01" })])
    expect(num(m.totales.por_cuenta_de_otras)).toBe(230)
    expect(r.saldos_por_liquidar).toEqual([expect.objectContaining({ origen_id: e.bodega, destino_id: e.camion1 })])
  })
})

describe("nada se cambia por fuera de las funciones", () => {
  it("ni el dueño de la base deja un pedido pendiente para su propia ubicación", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await db.query("update pedidos_ubicacion set estado = 'por_resolver' where id = $1", [p.pedido_id])

    const r = await falla(db.query("update pedidos_ubicacion set estado = 'pendiente', destino_id = $2 where id = $1", [p.pedido_id, e.bodega]))

    expect(r.code).toBe("42501")
    expect(await elPedido(p.pedido_id)).toMatchObject({ estado: "por_resolver", destino_id: e.ruta })
  })

  it("rechazar o resolver no puede cambiar importes, cliente ni productos", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(db.query("update pedidos_ubicacion set estado = 'por_resolver', total = 1, subtotal = 1, isv = 0 where id = $1", [p.pedido_id]))).code).toBe("42501")

    await db.query("update pedidos_ubicacion set estado = 'por_resolver' where id = $1", [p.pedido_id])

    expect((await falla(db.query("update pedidos_ubicacion set estado = 'pendiente', destino_id = $2, cliente_id = $2 where id = $1", [p.pedido_id, e.camion1]))).code).toBe("42501")
    expect((await falla(db.query("update pedidos_ubicacion set estado = 'pendiente' where id = $1", [p.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("update pedidos_ubicacion set estado = 'facturado' where id = $1", [p.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from eventos_de_pedido where pedido_id = $1", [p.pedido_id]))).code).toBe("42501")
  })

  it("la aplicación no escribe los pedidos ni su historia directamente", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(como(e.admin.authId, "update pedidos_ubicacion set estado = 'por_resolver' where id = $1", [p.pedido_id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre) values ($1, $2, 'rechazado', $3, 'x')", [e.empresa, p.pedido_id, e.admin.usuario]))).code).toBe("42501")
  })

  it("anon no ejecuta nada nuevo; las piezas internas tampoco las ejecuta la aplicación", async () => {
    const { rows } = await db.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as app
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('rechazar_pedido', 'resolver_pedido', 'tomar_pedido', 'operacion_de_pedido_repetida', 'liquidaciones_del_pedido',
                           'saldos_de_pedidos', 'saldos_de_pedidos_base', 'detalle_de_pedido', 'detalle_de_pedido_base',
                           'avisos_de_pedidos', 'avisos_de_pedidos_base', 'pedido_en_su_origen_sale_facturado', 'pedido_solo_avanza',
                           'reporte_diario_de_caja', 'reporte_medios_de_caja', 'cobros_de_pedidos_en_origen', 'cobros_sin', 'filas_sin_cobros_propios')
       order by 1`)

    expect(rows.filter((r) => r.anon)).toEqual([])
    expect(rows.filter((r) => r.app).map((r) => r.proname)).toEqual([
      "avisos_de_pedidos",
      "cobros_de_pedidos_en_origen",
      "cobros_sin",
      "detalle_de_pedido",
      "filas_sin_cobros_propios",
      "rechazar_pedido",
      "reporte_diario_de_caja",
      "reporte_medios_de_caja",
      "resolver_pedido",
    ])
  })
})
