/*
  0049 contra PostgreSQL de verdad: un pedido que Bodega entregó para Ruta local
  se cancela antes de facturarse; el cliente devuelve productos y se le devuelve
  su dinero.

  Cada caso arma su propia empresa: Bodega con existencias, Ruta local (destino),
  Camión 01 (una tercera ubicación) y usuarios con y sin «Autorizar cancelación
  de pedidos». El cargador vale 100 y el ISV es 15 % (115 con ISV); tarjeta y
  enlace llevan 1.7 %. Nada sale de producción.
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
  await db.query("update usuarios set ubicacion_id = null where id = $1", [admin.usuario])

  const ubicacion = async (nombre, tipo) =>
    (await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`, [empresa, nombre, tipo])).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const ruta = await ubicacion("Ruta local", "camion")
  const camion1 = await ubicacion("Camión 01", "camion")

  const cargador = (
    await db.query(`insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Cargador', 100, 37) returning id`, [
      empresa,
      `C-${randomUUID().slice(0, 8)}`,
    ])
  ).rows[0].id

  await db.query(`insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 50)`, [empresa, bodega, cargador])

  const cliente = await crearCliente(db, empresa, "Cliente A")
  const vendedor = (u, permisos) => crearVendedor(db, { empresa, ubicacion: u, permisos })

  const enBodega = await vendedor(bodega, ["pos"])
  const cancelaBodega = await vendedor(bodega, ["pos", "orders-cancel"])
  const enRuta = await vendedor(ruta, ["pos", "orders-resolve"])
  const cancelaRuta = await vendedor(ruta, ["pos", "orders-cancel"])
  const cancelaCamion1 = await vendedor(camion1, ["pos", "orders-cancel"])
  const resuelveBodega = await vendedor(bodega, ["pos", "orders-resolve"])
  const contador = await crearVendedor(db, { empresa, permisos: ["pos", "sales-history", "orders-cancel"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  const otra = await crearEmpresa(db, "Otra empresa")

  return { admin, empresa, bodega, ruta, camion1, cargador, cliente, enBodega, cancelaBodega, enRuta, cancelaRuta, cancelaCamion1, resuelveBodega, contador, otra }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const electronico = (medio, monto) => ({ medio, monto, referencia: medio === "efectivo" ? "" : "REF-1", tasa: medio === "transferencia" ? undefined : 1.7, cargo: medio === "transferencia" ? 0 : Math.round(monto * 1.7) / 100 })

// Bodega entrega `cantidad` cargadores (115 cada uno con ISV) para Ruta local.
const entregar = (e, { cantidad = 2, forma = "contado", cobros = forma === "contado" ? [efectivo(115 * cantidad)] : [] } = {}) =>
  fila(
    e.enBodega.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
       p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
    [e.ruta, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
  )

const cancelar = (quien, pedido, { motivo = "El cliente ya no lo quiere", recepcion = null, reembolsos = [], clave = randomUUID() } = {}) =>
  fila(quien.authId, "select public.cancelar_pedido($1, $2, $3::jsonb, $4::jsonb, $5) as r", [
    pedido,
    motivo,
    recepcion ? JSON.stringify(recepcion) : null,
    JSON.stringify(reembolsos),
    clave,
  ])

const recibir = (quien, pedido, { ubicacion = null, productos, nota = "", clave = randomUUID() }) =>
  fila(quien.authId, "select public.registrar_recepcion_de_pedido($1, $2, $3::jsonb, $4, $5) as r", [pedido, ubicacion, JSON.stringify(productos), nota, clave])

const reembolsar = (quien, pedido, { medio = "efectivo", importe, ubicacion = null, referencia = "", clave = randomUUID() }) =>
  fila(quien.authId, "select public.registrar_reembolso_de_pedido($1, $2, $3, $4, $5, $6) as r", [pedido, medio, importe, ubicacion, referencia, clave])

const info = (quien, pedido) => fila(quien.authId, "select public.cancelacion_de_pedido($1) as r", [pedido])
const control = (e) => fila(e.admin.authId, "select public.control_de_liquidaciones() as r")
const facturar = (quien, pedido) => fila(quien.authId, "select public.facturar_pedido($1) as r", [pedido])

const elPedido = async (id) => (await db.query("select * from pedidos_ubicacion where id = $1", [id])).rows[0]
const existencia = async (ubicacion, producto) =>
  num((await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? null)
const dinero = async (quien, pedido) => Object.fromEntries((await info(quien, pedido)).dinero.map((d) => [d.medio, { total: num(d.total), devuelto: num(d.devuelto), pendiente: num(d.pendiente) }]))
const pendientes = async (quien, pedido) => (await info(quien, pedido)).productos.map((p) => [p.buen_estado, p.danado, p.pendiente])

const todos = (e, cantidad = 2, condicion = "buen_estado") => [{ producto_id: e.cargador, cantidad, condicion }]

// Lo comercial que una cancelación no puede tocar.
async function comercial(e) {
  const filas = async (consulta) => (await db.query(consulta, [e.empresa])).rows

  return {
    ventas: await filas("select * from ventas where empresa_id = $1 order by id"),
    pagos: await filas("select * from pagos where empresa_id = $1 order by id"),
    abonos: await filas("select * from abonos where empresa_id = $1 order by id"),
    cobros: await filas("select * from cobros_por_medio where empresa_id = $1 order by id"),
    liquidaciones: await filas("select * from liquidaciones_ubicacion where empresa_id = $1 order by id"),
    detalle: await filas("select * from pedido_detalle where empresa_id = $1 order by id"),
  }
}

const liquidar = (e, monto, { origen = e.bodega, destino = e.ruta } = {}) =>
  fila(
    e.admin.authId,
    `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $4) as r`,
    [origen, destino, monto, randomUUID()]
  )
const resolverLiquidacion = (e, id, confirmar, motivo = null) => fila(e.admin.authId, "select public.resolver_liquidacion($1, $2, $3) as r", [id, confirmar, motivo])

describe("cancelar", () => {
  it("sin anticipo: queda cancelado, no se factura, no mueve inventario ni dinero y los productos quedan por recibir", async () => {
    const e = await escenario()
    const p = await entregar(e, { forma: "credito" })
    const antes = await comercial(e)

    const r = await cancelar(e.cancelaBodega, p.pedido_id, { motivo: "Se envió por error" })

    expect(r).toMatchObject({ estado: "cancelado", numero: p.numero, repetido: false })
    expect(await comercial(e)).toEqual(antes)
    expect(await existencia(e.bodega, e.cargador)).toBe(48)
    expect(await contar(db, "movimientos_inventario", "pedido_id = $1 and tipo = 'devolucion'", [p.pedido_id])).toBe(0)
    expect(await deudaDe(db, e.cliente)).toBe(0)
    expect((await falla(facturar(e.cancelaRuta, p.pedido_id))).code).toBe("PI008")
    expect(await pendientes(e.cancelaBodega, p.pedido_id)).toEqual([[0, 0, 2]])
    expect((await info(e.cancelaBodega, p.pedido_id)).dinero).toEqual([])

    const c = (await db.query("select * from cancelaciones_de_pedido where pedido_id = $1", [p.pedido_id])).rows[0]

    expect(c).toMatchObject({ estado_anterior: "pendiente", motivo: "Se envió por error", usuario_id: e.cancelaBodega.usuario, ubicacion_usuario: e.bodega })
    expect([num(c.principal_recibido), num(c.cargo_recibido)]).toEqual([0, 0])
    expect((await db.query("select tipo from eventos_de_pedido where pedido_id = $1 order by id", [p.pedido_id])).rows.map((x) => x.tipo)).toEqual(["entregado", "cancelado"])
  })

  it("exige motivo y clave, y datos válidos", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(cancelar(e.cancelaBodega, p.pedido_id, { motivo: "no" }))).code).toBe("PI001")
    expect((await falla(cancelar(e.cancelaBodega, p.pedido_id, { clave: " " }))).code).toBe("PI001")
    expect((await falla(fila(e.cancelaBodega.authId, "select public.cancelar_pedido($1, 'Motivo válido', null, '{}'::jsonb, $2) as r", [p.pedido_id, randomUUID()]))).code).toBe("PI001")
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")
  })

  it("un pedido rechazado (por resolver) también se cancela; uno facturado o cancelado, no", async () => {
    const e = await escenario()
    const rechazado = await entregar(e)
    const facturado = await entregar(e)

    await fila(e.enRuta.authId, "select public.rechazar_pedido($1, 'No es de Ruta local', $2) as r", [rechazado.pedido_id, randomUUID()])
    expect((await cancelar(e.cancelaBodega, rechazado.pedido_id)).estado).toBe("cancelado")
    expect((await db.query("select estado_anterior from cancelaciones_de_pedido where pedido_id = $1", [rechazado.pedido_id])).rows[0].estado_anterior).toBe("por_resolver")

    // Lo cancelado ya no se rechaza, no se resuelve ni se cancela otra vez.
    expect((await falla(fila(e.resuelveBodega.authId, "select public.resolver_pedido($1, 'facturar_en_origen', null, '', $2) as r", [rechazado.pedido_id, randomUUID()]))).code).toBe("PI012")
    expect((await falla(cancelar(e.cancelaBodega, rechazado.pedido_id))).message).toContain("ya está cancelado")

    await facturar(e.cancelaRuta, facturado.pedido_id)
    const r = await falla(cancelar(e.cancelaBodega, facturado.pedido_id))

    expect(r.code).toBe("PI012")
    expect(r.message).toContain("anulación de facturas de pedido")
  })

  it("con la misma clave no se repite; con la clave y otro motivo, PI011", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()
    const opciones = { clave, recepcion: { productos: todos(e) }, reembolsos: [{ medio: "efectivo", importe: 100 }] }

    await cancelar(e.cancelaBodega, p.pedido_id, opciones)
    expect(await cancelar(e.cancelaBodega, p.pedido_id, opciones)).toMatchObject({ estado: "cancelado", repetido: true })
    expect((await falla(cancelar(e.cancelaBodega, p.pedido_id, { ...opciones, motivo: "Otro motivo distinto" }))).code).toBe("PI011")

    expect(await contar(db, "cancelaciones_de_pedido", "pedido_id = $1", [p.pedido_id])).toBe(1)
    expect(await contar(db, "recepciones_de_pedido", "pedido_id = $1", [p.pedido_id])).toBe(1)
    expect(await contar(db, "reembolsos_de_pedido", "pedido_id = $1", [p.pedido_id])).toBe(1)
    expect(await existencia(e.bodega, e.cargador)).toBe(50)
  })

  it("dos personas cancelan a la vez: la segunda espera y encuentra el pedido cancelado", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const sql = "select public.cancelar_pedido($1, 'Cancelación simultánea', null, '[]'::jsonb, $2)"

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.cancelaBodega.authId, hacer: (c) => c.query(sql, [p.pedido_id, randomUUID()]) },
      segunda: { authId: e.cancelaRuta.authId, hacer: (c) => c.query(sql, [p.pedido_id, randomUUID()]) },
    })

    expect(r.error?.code).toBe("PI012")
    expect(await contar(db, "cancelaciones_de_pedido", "pedido_id = $1", [p.pedido_id])).toBe(1)
  })
})

describe("quién cancela", () => {
  it("con «Autorizar cancelación» en el origen o el destino, o el administrador; nadie más", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect((await falla(cancelar(e.enBodega, p.pedido_id))).code).toBe("42501")
    expect((await falla(cancelar(e.enRuta, p.pedido_id))).code).toBe("42501")
    expect((await falla(cancelar(e.cancelaCamion1, p.pedido_id))).code).toBe("42501")
    expect((await falla(cancelar(e.contador, p.pedido_id))).code).toBe("42501")
    expect((await falla(cancelar(e.otra, p.pedido_id))).code).toBe("PI008")
    expect((await elPedido(p.pedido_id)).estado).toBe("pendiente")

    expect((await cancelar(e.cancelaRuta, p.pedido_id)).estado).toBe("cancelado")

    const otro = await entregar(e)

    expect((await cancelar(e.admin, otro.pedido_id)).estado).toBe("cancelado")
  })

  it("la pantalla sabe quién puede cancelar y desde dónde puede recibir o reembolsar", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect(await info(e.cancelaBodega, p.pedido_id)).toMatchObject({ puede_cancelar: true, puede_registrar: false, bloqueo_por_liquidacion: null })
    expect(await info(e.enBodega, p.pedido_id)).toMatchObject({ puede_cancelar: false, ubicaciones_para_recibir: [], ubicaciones_para_reembolsar: [] })
    expect((await falla(info(e.cancelaCamion1, p.pedido_id))).code).toBe("PI008")

    const deBodega = await info(e.cancelaBodega, p.pedido_id)

    expect(deBodega.ubicaciones_para_recibir.map((u) => u.nombre)).toEqual(["Bodega"])
    expect(deBodega.ubicaciones_para_reembolsar.map((u) => u.nombre)).toEqual(["Bodega"])
    expect(deBodega.puede_reembolsar_electronico).toBe(false)

    const delAdmin = await info(e.admin, p.pedido_id)

    expect(delAdmin.ubicaciones_para_recibir.map((u) => [u.nombre, u.otra])).toEqual([
      ["Bodega", false],
      ["Ruta local", false],
      ["Camión 01", true],
    ])
    expect(delAdmin.ubicaciones_para_reembolsar.map((u) => u.nombre)).toEqual(["Bodega", "Ruta local"])
    expect(delAdmin.puede_reembolsar_electronico).toBe(true)

    await cancelar(e.cancelaBodega, p.pedido_id)
    expect(await info(e.cancelaRuta, p.pedido_id)).toMatchObject({ puede_cancelar: false, puede_registrar: true, cancelacion: { motivo: "El cliente ya no lo quiere" } })
  })
})

describe("los productos que vuelven", () => {
  it("todos en buen estado en Bodega: vuelven a su existencia una sola vez, con su movimiento", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id, { recepcion: { ubicacion_id: e.bodega, productos: todos(e) } })

    expect(await existencia(e.bodega, e.cargador)).toBe(50)
    expect(await pendientes(e.cancelaBodega, p.pedido_id)).toEqual([[2, 0, 0]])

    const movimientos = (await db.query("select tipo, cantidad, ubicacion_id, recepcion_id from movimientos_inventario where pedido_id = $1 order by id", [p.pedido_id])).rows

    expect(movimientos.map((m) => [m.tipo, m.cantidad, m.ubicacion_id])).toEqual([
      ["entrega_pedido", -2, e.bodega],
      ["devolucion", 2, e.bodega],
    ])
    expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { ubicacion: e.bodega, productos: todos(e, 1) }))).code).toBe("PI014")
  })

  it("en el destino, uno bueno y uno dañado: solo el bueno suma, y solo en Ruta local", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaRuta, p.pedido_id, {
      recepcion: { productos: [{ producto_id: e.cargador, cantidad: 1, condicion: "buen_estado" }, { producto_id: e.cargador, cantidad: 1, condicion: "danado" }] },
    })

    expect(await existencia(e.ruta, e.cargador)).toBe(1)
    expect(await existencia(e.bodega, e.cargador)).toBe(48)
    expect(await pendientes(e.cancelaRuta, p.pedido_id)).toEqual([[1, 1, 0]])
    expect(await contar(db, "movimientos_inventario", "pedido_id = $1 and tipo = 'devolucion'", [p.pedido_id])).toBe(1)
  })

  it("ninguno al cancelar; se reciben después, en partes, y nunca más de lo entregado", async () => {
    const e = await escenario()
    const p = await entregar(e, { cantidad: 3, cobros: [efectivo(345)] })

    expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 1) }))).code).toBe("PI012")

    await cancelar(e.cancelaBodega, p.pedido_id)
    expect(await existencia(e.bodega, e.cargador)).toBe(47)

    await recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 1) })
    await recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 1, "danado") })

    const r = await falla(recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 2) }))

    expect(r.code).toBe("PI014")
    expect(r.message).toContain("faltan 1")
    expect(await pendientes(e.cancelaBodega, p.pedido_id)).toEqual([[1, 1, 1]])
    expect(await existencia(e.bodega, e.cargador)).toBe(48)

    // Datos que no valen.
    for (const productos of [[], [{ producto_id: e.cargador, cantidad: 0, condicion: "buen_estado" }], [{ producto_id: e.cargador, cantidad: 1, condicion: "roto" }], [{ producto_id: e.cargador, cantidad: "1.5", condicion: "buen_estado" }], [{ producto_id: randomUUID(), cantidad: 1, condicion: "buen_estado" }]]) {
      expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { productos }))).code).toBe("PI014")
    }
  })

  it("el reintento de una recepción no la duplica; la clave con otros productos da PI011", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()

    await cancelar(e.cancelaBodega, p.pedido_id)
    await recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 1), clave })
    expect(await recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 1), clave })).toMatchObject({ repetido: true })
    expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { productos: todos(e, 2), clave }))).code).toBe("PI011")
    expect(await existencia(e.bodega, e.cargador)).toBe(49)
  })

  it("en una tercera ubicación: el empleado no puede; el administrador sí, con una nota que la respalde", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)

    expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { ubicacion: e.camion1, productos: todos(e, 1) }))).code).toBe("42501")
    expect((await falla(recibir(e.cancelaBodega, p.pedido_id, { ubicacion: e.ruta, productos: todos(e, 1) }))).code).toBe("42501")
    expect((await falla(recibir(e.cancelaCamion1, p.pedido_id, { productos: todos(e, 1) }))).code).toBe("42501")
    expect((await falla(recibir(e.admin, p.pedido_id, { ubicacion: e.camion1, productos: todos(e, 1) }))).code).toBe("PI014")

    await recibir(e.admin, p.pedido_id, { ubicacion: e.camion1, productos: todos(e, 1), nota: "Lo entregó el cliente en Camión 01, acta 15" })

    expect(await existencia(e.camion1, e.cargador)).toBe(1)
    expect(await existencia(e.bodega, e.cargador)).toBe(48)
    expect((await db.query("select en_otra_ubicacion, nota from recepciones_de_pedido where pedido_id = $1", [p.pedido_id])).rows[0]).toEqual({
      en_otra_ubicacion: true,
      nota: "Lo entregó el cliente en Camión 01, acta 15",
    })
    expect(await contar(db, "traslados", "empresa_id = $1", [e.empresa])).toBe(0)
  })
})

describe("el dinero del cliente", () => {
  it("pago parcial en efectivo: queda por devolver, se devuelve en varias partes y nunca de más", async () => {
    const e = await escenario()
    const p = await entregar(e, { forma: "credito", cobros: [efectivo(100)] })
    const antes = await comercial(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    expect(await dinero(e.cancelaBodega, p.pedido_id)).toEqual({ efectivo: { total: 100, devuelto: 0, pendiente: 100 } })
    expect(await comercial(e)).toEqual(antes)

    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 50 })
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 30 })

    const r = await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 21 }))

    expect(r.code).toBe("PI015")
    expect(r.message).toContain("supera lo pendiente")

    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 20 })
    expect(await dinero(e.cancelaBodega, p.pedido_id)).toEqual({ efectivo: { total: 100, devuelto: 100, pendiente: 0 } })
    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 0.01 }))).code).toBe("PI015")
    expect(await comercial(e)).toEqual(antes)
  })

  it("pagado completo con tarjeta: se devuelve el cargo; solo el administrador y con referencia", async () => {
    const e = await escenario()
    const p = await entregar(e, { cobros: [electronico("tarjeta", 230)] })

    await cancelar(e.cancelaBodega, p.pedido_id)
    expect(await dinero(e.admin, p.pedido_id)).toEqual({ tarjeta: { total: 233.91, devuelto: 0, pendiente: 233.91 } })
    expect((await db.query("select principal_recibido, cargo_recibido from cancelaciones_de_pedido where pedido_id = $1", [p.pedido_id])).rows[0]).toEqual({
      principal_recibido: "230.00",
      cargo_recibido: "3.91",
    })

    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { medio: "tarjeta", importe: 233.91, referencia: "X" }))).code).toBe("42501")
    expect((await falla(reembolsar(e.admin, p.pedido_id, { medio: "tarjeta", importe: 233.91 }))).code).toBe("PI015")
    expect((await falla(reembolsar(e.admin, p.pedido_id, { medio: "efectivo", importe: 10 }))).code).toBe("PI015")

    await reembolsar(e.admin, p.pedido_id, { medio: "tarjeta", importe: 233.91, referencia: "Reverso en terminal 0042" })

    expect(await dinero(e.admin, p.pedido_id)).toEqual({ tarjeta: { total: 233.91, devuelto: 233.91, pendiente: 0 } })
    expect((await db.query("select ubicacion_id, referencia from reembolsos_de_pedido where pedido_id = $1", [p.pedido_id])).rows[0]).toEqual({
      ubicacion_id: null,
      referencia: "Reverso en terminal 0042",
    })
  })

  it("transferencia y enlace se devuelven por su medio; el mixto controla cada parte", async () => {
    const e = await escenario()
    const transferencia = await entregar(e, { cobros: [electronico("transferencia", 230)] })
    const mixto = await entregar(e, { cobros: [efectivo(130), electronico("enlace", 100)] })

    await cancelar(e.admin, transferencia.pedido_id, { reembolsos: [{ medio: "transferencia", importe: 230, referencia: "TRF-889" }] })
    expect(await dinero(e.admin, transferencia.pedido_id)).toEqual({ transferencia: { total: 230, devuelto: 230, pendiente: 0 } })

    await cancelar(e.cancelaBodega, mixto.pedido_id)
    expect(await dinero(e.admin, mixto.pedido_id)).toEqual({
      efectivo: { total: 130, devuelto: 0, pendiente: 130 },
      enlace: { total: 101.7, devuelto: 0, pendiente: 101.7 },
    })
    expect((await falla(reembolsar(e.cancelaBodega, mixto.pedido_id, { importe: 131 }))).code).toBe("PI015")

    await reembolsar(e.cancelaBodega, mixto.pedido_id, { importe: 130 })
    await reembolsar(e.admin, mixto.pedido_id, { medio: "enlace", importe: 101.7, referencia: "Reverso del enlace" })
    expect(await dinero(e.admin, mixto.pedido_id)).toEqual({
      efectivo: { total: 130, devuelto: 130, pendiente: 0 },
      enlace: { total: 101.7, devuelto: 101.7, pendiente: 0 },
    })
  })

  it("el efectivo sale del origen o del destino; desde una tercera ubicación, todavía no", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)

    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 10, ubicacion: e.ruta }))).code).toBe("42501")
    expect((await falla(reembolsar(e.admin, p.pedido_id, { importe: 10, ubicacion: e.camion1 }))).code).toBe("PI015")
    expect((await falla(reembolsar(e.enBodega, p.pedido_id, { importe: 10 }))).code).toBe("42501")
    expect((await falla(reembolsar(e.contador, p.pedido_id, { importe: 10 }))).code).toBe("42501")

    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 30 })
    await reembolsar(e.admin, p.pedido_id, { importe: 20, ubicacion: e.ruta })
    await reembolsar(e.admin, p.pedido_id, { importe: 10 })

    expect((await db.query("select u.nombre, r.importe from reembolsos_de_pedido r join ubicaciones u on u.id = r.ubicacion_id where r.pedido_id = $1 order by r.reembolsado_en, r.id", [p.pedido_id])).rows.map((x) => [x.nombre, num(x.importe)])).toEqual([
      ["Ruta local", 30],
      ["Ruta local", 20],
      ["Bodega", 10],
    ])
  })

  it("el reintento de un reembolso no lo duplica; la clave con otro importe da PI011", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const clave = randomUUID()

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 100, clave })
    expect(await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 100, clave })).toMatchObject({ repetido: true })
    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 101, clave }))).code).toBe("PI011")
    expect((await dinero(e.cancelaBodega, p.pedido_id)).efectivo).toEqual({ total: 230, devuelto: 100, pendiente: 130 })
  })

  it("dos reembolsos a la vez no pueden pasar de lo pendiente", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const sql = "select public.registrar_reembolso_de_pedido($1, 'efectivo', 150, null, '', $2)"

    await cancelar(e.cancelaBodega, p.pedido_id)

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.cancelaBodega.authId, hacer: (c) => c.query(sql, [p.pedido_id, randomUUID()]) },
      segunda: { authId: e.cancelaRuta.authId, hacer: (c) => c.query(sql, [p.pedido_id, randomUUID()]) },
    })

    expect(r.error?.code).toBe("PI015")
    expect((await dinero(e.cancelaBodega, p.pedido_id)).efectivo).toEqual({ total: 230, devuelto: 150, pendiente: 80 })
  })
})

describe("liquidaciones", () => {
  it("cancelado: Ruta local ya no tiene derecho a lo cobrado; mientras no se devuelva, nadie le debe a nadie", async () => {
    const e = await escenario()
    const p = await entregar(e)

    expect(num((await control(e)).pares[0].pendiente)).toBe(230)

    await cancelar(e.cancelaBodega, p.pedido_id)

    expect((await control(e)).pedidos).toEqual([])
    expect((await falla(liquidar(e, 10))).code).toBe("LQ002")
  })

  it("si devuelve Bodega, no queda nada; si devuelve Ruta local en efectivo, Bodega se lo debe y lo liquida como siempre", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 80 })
    expect((await control(e)).pedidos).toEqual([])

    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 150 })

    const c = await control(e)
    const fila_ = c.pedidos.find((x) => x.pedido_id === p.pedido_id)

    expect([num(fila_.efectivo), num(fila_.pendiente), fila_.estado]).toEqual([150, 150, "cancelado"])
    expect(c.pares[0]).toMatchObject({ origen_id: e.bodega, destino_id: e.ruta })

    const liq = await liquidar(e, 150)

    await resolverLiquidacion(e, liq.id, true)
    expect(num((await control(e)).pedidos.find((x) => x.pedido_id === p.pedido_id).pendiente)).toBe(0)
  })

  it("lo electrónico no crea obligaciones entre ubicaciones", async () => {
    const e = await escenario()
    const p = await entregar(e, { cobros: [electronico("tarjeta", 230)] })

    await cancelar(e.admin, p.pedido_id, { reembolsos: [{ medio: "tarjeta", importe: 233.91, referencia: "Reverso 1" }] })
    expect((await control(e)).pedidos).toEqual([])
  })

  it("con una entrega por confirmar o confirmada no se cancela; con una rechazada, sí", async () => {
    const e = await escenario()
    const porConfirmar = await entregar(e)
    const liq = await liquidar(e, 100)

    const r = await falla(cancelar(e.cancelaBodega, porConfirmar.pedido_id))

    expect(r.code).toBe("PI013")
    expect(r.message).toContain(liq.numero)
    expect((await info(e.cancelaBodega, porConfirmar.pedido_id)).bloqueo_por_liquidacion).toBe(`${liq.numero} (por confirmar)`)

    await resolverLiquidacion(e, liq.id, false, "No llegó el dinero")
    expect((await cancelar(e.cancelaBodega, porConfirmar.pedido_id)).estado).toBe("cancelado")

    const confirmado = await entregar(e)
    const parcial = await liquidar(e, 50)

    await resolverLiquidacion(e, parcial.id, true)
    expect((await falla(cancelar(e.admin, confirmado.pedido_id))).code).toBe("PI013")
    expect((await elPedido(confirmado.pedido_id)).estado).toBe("pendiente")
  })

  it("los pedidos activos siguen exactamente igual", async () => {
    const e = await escenario()
    const activo = await entregar(e)
    const cancelado = await entregar(e)
    const antes = (await control(e)).pedidos.find((x) => x.pedido_id === activo.pedido_id)

    await cancelar(e.cancelaBodega, cancelado.pedido_id, { reembolsos: [{ medio: "efectivo", importe: 230 }] })

    expect((await control(e)).pedidos).toEqual([antes])
  })
})

describe("reportes de caja", () => {
  const diario = (e) => fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")
  const medios = (e) => fila(e.admin.authId, "select public.reporte_medios_de_caja() as r")
  const de = (filas, id) => filas.find((u) => u.ubicacion_id === id)

  it("sin reembolsos ni pendientes, los reportes son los de antes", async () => {
    const e = await escenario()

    await entregar(e)

    const d = await diario(e)
    const sinReembolsos = await fila(e.admin.authId, "select public.reporte_diario_de_caja_sin_reembolsos() as r")

    expect(d).toEqual(sinReembolsos)
    expect(await medios(e)).toEqual(await fila(e.admin.authId, "select public.reporte_medios_de_caja_sin_reembolsos() as r"))
    expect(d.indicadores.reembolsos_pagados).toBeUndefined()
  })

  it("lo pendiente no baja la caja; lo devuelto en efectivo baja la de quien pagó, y lo cobrado no cambia", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)

    const pendiente = await diario(e)

    expect([num(pendiente.indicadores.cobros_total), num(pendiente.indicadores.reembolsos_pagados), num(pendiente.indicadores.reembolsos_de_pedidos_pendientes)]).toEqual([230, 0, 230])
    expect(num(pendiente.indicadores.total_cobrado_neto)).toBe(230)

    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 100 })
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 30 })

    const d = await diario(e)
    const m = await medios(e)

    expect([num(d.indicadores.cobros_total), num(d.indicadores.reembolsos_pagados), num(d.indicadores.total_cobrado_neto), num(d.indicadores.reembolsos_de_pedidos_pendientes)]).toEqual([230, 130, 100, 100])
    expect([num(de(d.por_ubicacion, e.bodega).cobros_total), num(de(d.por_ubicacion, e.bodega).reembolsos_pagados), num(de(d.por_ubicacion, e.bodega).cobros_netos)]).toEqual([230, 100, 130])
    expect(d.reembolsos_de_pedidos.map((x) => [x.ubicacion, num(x.importe)])).toEqual([
      ["Bodega", 100],
      ["Ruta local", 30],
    ])
    expect([num(m.totales.reembolsos_efectivo), num(m.totales.reembolsos_electronicos), num(m.totales.total_neto)]).toEqual([130, 0, 100])
    expect([num(de(m.por_ubicacion, e.bodega).efectivo), num(de(m.por_ubicacion, e.bodega).efectivo_neto)]).toEqual([230, 130])
  })
})

describe("nada se cambia por fuera", () => {
  it("las cancelaciones, recepciones y reembolsos no se modifican ni se borran, ni por el dueño", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id, { recepcion: { productos: todos(e, 1) }, reembolsos: [{ medio: "efectivo", importe: 10 }] })

    for (const tabla of ["cancelaciones_de_pedido", "recepciones_de_pedido", "recepcion_detalle", "reembolsos_de_pedido"]) {
      expect((await falla(db.query(`delete from ${tabla} where pedido_id = $1`, [p.pedido_id]))).code).toBe("42501")
      expect((await falla(db.query(`update ${tabla} set pedido_id = pedido_id where pedido_id = $1`, [p.pedido_id]))).code).toBe("42501")
    }

    expect((await falla(db.query("update pedidos_ubicacion set estado = 'pendiente' where id = $1", [p.pedido_id]))).code).toBe("42501")
    expect((await falla(db.query("update pedidos_ubicacion set estado = 'cancelado', total = 1 where id = $1", [(await entregar(e)).pedido_id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "insert into reembolsos_de_pedido (empresa_id, pedido_id, medio, importe, ubicacion_id, usuario_id, usuario_nombre, usuario_rol, clave_idempotencia, huella) values ($1, $2, 'efectivo', 1, $3, $4, 'x', 'admin', 'k', 'h')", [e.empresa, p.pedido_id, e.bodega, e.admin.usuario]))).code).toBe("42501")
  })

  it("anon no ejecuta nada; las piezas internas tampoco la aplicación", async () => {
    const { rows } = await db.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as app
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('cancelar_pedido', 'registrar_recepcion_de_pedido', 'registrar_reembolso_de_pedido', 'cancelacion_de_pedido',
                           'dinero_a_devolver', 'productos_por_recibir', 'recibir_productos_del_pedido', 'reembolsar_al_cliente',
                           'quien_cancela', 'exigir_clave', 'saldos_de_pedidos')
       order by 1`)

    expect(rows.filter((r) => r.anon)).toEqual([])
    expect(rows.filter((r) => r.app).map((r) => r.proname)).toEqual(["cancelacion_de_pedido", "cancelar_pedido", "registrar_recepcion_de_pedido", "registrar_reembolso_de_pedido"])
  })
})
