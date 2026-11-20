/*
  0046 contra PostgreSQL de verdad: Bodega entrega y cobra, Camión 01 factura, y
  el efectivo que Bodega cobró para Camión 01 se liquida en dos pasos.

  Cada caso arma su propia empresa: Bodega con existencias, Camión 01 y Camión 02,
  un usuario por ubicación con los permisos que pida el caso, un contador y otra
  empresa aparte. El cargador vale 100 y el ISV es 15 % (115 con ISV); tarjeta y
  enlace llevan 1.7 %. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"

import { enDosSesiones } from "./arnes.mjs"
import { usarBaseDePrueba, num, falla } from "./ayudantes.mjs"
import { crearEmpresa, crearCliente, crearVendedor, crearFactura, crearAbonoLegado, contar } from "./fixtures.mjs"

let base
let db

const { como, fila } = usarBaseDePrueba((levantada) => {
  base = levantada
  db = levantada.admin
})

async function escenario() {
  const admin = await crearEmpresa(db, "Lunacell de prueba")
  const { empresa } = admin

  await db.query("update empresas set tasa_isv = 15, tasa_cargo_tarjeta = 1.7, tasa_cargo_enlace = 1.7 where id = $1", [empresa])

  const ubicacion = async (nombre, tipo) =>
    (await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`, [empresa, nombre, tipo])).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")

  const cargador = (
    await db.query(`insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Cargador', 100, 37) returning id`, [
      empresa,
      `C-${randomUUID().slice(0, 8)}`,
    ])
  ).rows[0].id

  await db.query(
    `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $4, 50), ($1, $3, $4, 50)`,
    [empresa, bodega, camion1, cargador]
  )

  const cliente = await crearCliente(db, empresa, "Cliente A")

  const enBodega = await crearVendedor(db, { empresa, ubicacion: bodega, permisos: ["pos", "settlements-manage"] })
  const enCamion1 = await crearVendedor(db, { empresa, ubicacion: camion1, permisos: ["pos", "settlements-manage"] })
  const consultaCamion1 = await crearVendedor(db, { empresa, ubicacion: camion1, permisos: ["pos", "settlements-view"] })
  const enCamion2 = await crearVendedor(db, { empresa, ubicacion: camion2, permisos: ["pos", "settlements-manage"] })
  const sinPermiso = await crearVendedor(db, { empresa, ubicacion: bodega, permisos: ["pos"] })
  const contador = await crearVendedor(db, { empresa, permisos: ["settlements-view"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  const otra = await crearEmpresa(db, "Otra empresa")

  return { admin, empresa, bodega, camion1, camion2, cargador, cliente, enBodega, enCamion1, consultaCamion1, enCamion2, sinPermiso, contador, otra }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const tarjeta = (monto) => ({ medio: "tarjeta", monto, referencia: "", tasa: 1.7, cargo: Math.round(monto * 1.7) / 100 })

// Bodega entrega `cantidad` cargadores para Camión 01 (115 cada uno con ISV).
const pedido = (e, { cantidad = 2, cobros = [efectivo(115 * cantidad)], forma = "contado", destino = e.camion1 } = {}) =>
  fila(
    e.enBodega.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => $4,
       p_cobros => $5::jsonb, p_fecha_vencimiento => $6, p_clave_idempotencia => $7) as r`,
    [destino, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad }]), forma, JSON.stringify(cobros), forma === "credito" ? "2030-01-01" : null, randomUUID()]
  )

const facturar = (e, id) => fila(e.enCamion1.authId, "select public.facturar_pedido($1) as r", [id])

function registrar(e, quien, { monto, origen = e.bodega, destino = e.camion1, metodo = "entrega_en_efectivo", pedidoId = null, clave = randomUUID(), referencia = "", observacion = "" }) {
  return fila(
    quien.authId,
    `select public.registrar_liquidacion(
       p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => $4,
       p_referencia => $5, p_observacion => $6, p_pedido => $7, p_clave_idempotencia => $8) as r`,
    [origen, destino, monto, metodo, referencia, observacion, pedidoId, clave]
  )
}

const resolver = (quien, id, confirmar = true, motivo = null) =>
  fila(quien.authId, "select public.resolver_liquidacion($1, $2, $3) as r", [id, confirmar, motivo])

const control = (quien, origen = null, destino = null) =>
  fila(quien.authId, "select public.control_de_liquidaciones($1, $2) as r", [origen, destino])

const par = (c, e) => c.pares.find((p) => p.origen_id === e.bodega && p.destino_id === e.camion1)
const delPedido = (c, id) => c.pedidos.find((p) => p.pedido_id === id)

const cifras = (x) => ({
  efectivo: num(x.efectivo),
  electronico: num(x.electronico),
  por_confirmar: num(x.por_confirmar),
  liquidado: num(x.liquidado),
  pendiente: num(x.pendiente),
})

describe("lo que queda por liquidar", () => {
  it("el efectivo que Bodega cobra para Camión 01 queda pendiente desde el cobro, aunque no se haya facturado", async () => {
    const e = await escenario()
    const p = await pedido(e)
    const c = await control(e.admin)

    expect(cifras(par(c, e))).toEqual({ efectivo: 230, electronico: 0, por_confirmar: 0, liquidado: 0, pendiente: 230 })
    expect(delPedido(c, p.pedido_id)).toMatchObject({ estado: "pendiente", estado_liquidacion: "pendiente", origen: "Bodega", destino: "Camión 01" })
    expect(delPedido(c, p.pedido_id).medios).toEqual([expect.objectContaining({ medio: "efectivo" })])

    // Facturar no cambia el saldo: la obligación nació con el cobro.
    await facturar(e, p.pedido_id)
    expect(cifras(par(await control(e.admin), e)).pendiente).toBe(230)
  })

  it("lo electrónico y su cargo del 1.70 % van a la cuenta de la empresa: nada por liquidar", async () => {
    const e = await escenario()
    const p = await pedido(e, { cantidad: 1, cobros: [tarjeta(115)] })
    const c = await control(e.admin)

    expect(cifras(delPedido(c, p.pedido_id))).toEqual({ efectivo: 0, electronico: 115, por_confirmar: 0, liquidado: 0, pendiente: 0 })
    expect(num(delPedido(c, p.pedido_id).cargo)).toBe(1.96)
    expect(delPedido(c, p.pedido_id).estado_liquidacion).toBe("sin_efectivo")

    const error = await falla(registrar(e, e.enBodega, { monto: 1 }))

    expect(error.code).toBe("LQ002")
  })

  it("un pago mixto solo deja por liquidar la parte en efectivo", async () => {
    const e = await escenario()
    const p = await pedido(e, { cobros: [efectivo(130), tarjeta(100)] })

    expect(cifras(delPedido(await control(e.admin), p.pedido_id))).toEqual({ efectivo: 130, electronico: 100, por_confirmar: 0, liquidado: 0, pendiente: 130 })
  })

  it("a crédito, la prima en efectivo queda por liquidar y el saldo del crédito no", async () => {
    const e = await escenario()
    const p = await pedido(e, { forma: "credito", cobros: [efectivo(80)] })

    expect(cifras(delPedido(await control(e.admin), p.pedido_id)).pendiente).toBe(80)
  })

  it("un pedido de Bodega para Bodega no existe; un pedido para Camión 02 es otro par", async () => {
    const e = await escenario()

    await pedido(e)
    await pedido(e, { cantidad: 1, destino: e.camion2 })

    const c = await control(e.admin)

    expect(c.pares.map((x) => [x.origen, x.destino, num(x.pendiente)])).toEqual([
      ["Bodega", "Camión 01", 230],
      ["Bodega", "Camión 02", 115],
    ])
  })
})

describe("la entrega y la confirmación", () => {
  it("una entrega parcial queda por confirmar; al confirmarla pasa a liquidado y el pedido queda parcial", async () => {
    const e = await escenario()
    const p = await pedido(e)
    const l = await registrar(e, e.enBodega, { monto: 100, referencia: "Sobre 12", observacion: "Entregado al chofer" })

    expect(l).toMatchObject({
      numero: "LIQ-000001", estado: "por_confirmar", origen_id: e.bodega, destino_id: e.camion1,
      metodo: "entrega_en_efectivo", referencia: "Sobre 12", observacion: "Entregado al chofer",
      registrada_por: e.enBodega.usuario, repetida: false,
    })
    expect(l).not.toHaveProperty("huella")
    expect(l).not.toHaveProperty("clave_idempotencia")

    let c = await control(e.admin)

    expect(cifras(par(c, e))).toMatchObject({ por_confirmar: 100, liquidado: 0, pendiente: 130 })
    expect(delPedido(c, p.pedido_id).estado_liquidacion).toBe("por_confirmar")

    const r = await resolver(e.enCamion1, l.id)

    expect(r).toMatchObject({ estado: "confirmada", resuelta_por: e.enCamion1.usuario, repetida: false })

    c = await control(e.admin)
    expect(cifras(par(c, e))).toMatchObject({ por_confirmar: 0, liquidado: 100, pendiente: 130 })
    expect(delPedido(c, p.pedido_id).estado_liquidacion).toBe("parcial")
    expect(c.liquidaciones[0]).toMatchObject({ numero: "LIQ-000001", estado: "confirmada", pedidos: [{ numero: p.numero, monto: 100 }] })
  })

  it("liquidado todo, el pedido queda liquidado", async () => {
    const e = await escenario()
    const p = await pedido(e)
    const l = await registrar(e, e.enBodega, { monto: 230, metodo: "deposito_a_cuenta", referencia: "DEP-55" })

    await resolver(e.enCamion1, l.id)

    expect(delPedido(await control(e.admin), p.pedido_id).estado_liquidacion).toBe("liquidado")
  })

  it("no se liquida más de lo pendiente, y lo que está por confirmar ya no está disponible", async () => {
    const e = await escenario()

    await pedido(e)

    expect((await falla(registrar(e, e.enBodega, { monto: 230.01 }))).code).toBe("LQ002")

    await registrar(e, e.enBodega, { monto: 200 })

    const error = await falla(registrar(e, e.enBodega, { monto: 31 }))

    expect(error.code).toBe("LQ002")
    expect(error.message).toContain("30.00")
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("rechazar exige un motivo y devuelve el monto a lo pendiente", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 230 })

    expect((await falla(resolver(e.enCamion1, l.id, false, "  "))).code).toBe("LQ001")

    const r = await resolver(e.enCamion1, l.id, false, "Faltaron 20 lempiras en el sobre")

    expect(r).toMatchObject({ estado: "rechazada", motivo_rechazo: "Faltaron 20 lempiras en el sobre" })
    expect(cifras(par(await control(e.admin), e))).toMatchObject({ por_confirmar: 0, liquidado: 0, pendiente: 230 })

    // Ya rechazada, no se confirma.
    expect((await falla(resolver(e.enCamion1, l.id, true))).code).toBe("LQ004")
  })

  it("confirmar dos veces devuelve la misma confirmación", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 50 })
    const primera = await resolver(e.enCamion1, l.id)
    const segunda = await resolver(e.admin, l.id)

    expect(segunda).toMatchObject({ estado: "confirmada", resuelta_en: primera.resuelta_en, resuelta_por: e.enCamion1.usuario, repetida: true })
  })

  it("reparte entre los pedidos del más antiguo al más reciente, o sale solo del pedido indicado", async () => {
    const e = await escenario()
    const viejo = await pedido(e, { cantidad: 1 })
    const nuevo = await pedido(e, { cantidad: 2 })

    const fifo = await registrar(e, e.enBodega, { monto: 150 })
    const det = (await db.query("select pedido_id, monto from liquidacion_detalle where liquidacion_id = $1 order by monto desc", [fifo.id])).rows

    expect(det.map((d) => [d.pedido_id, num(d.monto)])).toEqual([
      [viejo.pedido_id, 115],
      [nuevo.pedido_id, 35],
    ])

    const solo = await registrar(e, e.enBodega, { monto: 195, pedidoId: nuevo.pedido_id })
    const det2 = (await db.query("select pedido_id, monto from liquidacion_detalle where liquidacion_id = $1", [solo.id])).rows

    expect(det2.map((d) => [d.pedido_id, num(d.monto)])).toEqual([[nuevo.pedido_id, 195]])
    expect((await falla(registrar(e, e.enBodega, { monto: 1, pedidoId: viejo.pedido_id }))).code).toBe("LQ002")
  })

  it("rechaza montos sin sentido, métodos desconocidos, fechas futuras y pares inválidos", async () => {
    const e = await escenario()

    await pedido(e)

    for (const datos of [
      { monto: 0 },
      { monto: -5 },
      { monto: 10.005 },
      { monto: 10, metodo: "cheque" },
      { monto: 10, destino: e.bodega },
      { monto: 10, destino: e.otra.ubicacion ?? randomUUID() },
      { monto: 10, clave: "  " },
    ]) {
      expect((await falla(registrar(e, e.enBodega, datos))).code).toBe("LQ001")
    }

    const futura = await falla(
      fila(e.enBodega.authId, "select public.registrar_liquidacion($1, $2, 10, 'entrega_en_efectivo', current_date + 3, p_clave_idempotencia => $3) as r", [e.bodega, e.camion1, randomUUID()])
    )

    expect(futura.code).toBe("LQ001")
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(0)
  })
})

describe("doble clic, reintentos y concurrencia", () => {
  it("la misma clave con los mismos datos devuelve la misma liquidación; con otros datos se rechaza", async () => {
    const e = await escenario()

    await pedido(e)

    const clave = randomUUID()
    const primera = await registrar(e, e.enBodega, { monto: 100, clave })
    const segunda = await registrar(e, e.enBodega, { monto: 100, clave })

    expect(segunda).toMatchObject({ id: primera.id, numero: primera.numero, repetida: true })
    expect((await falla(registrar(e, e.enBodega, { monto: 90, clave }))).code).toBe("LQ003")
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
    expect(await contar(db, "liquidacion_detalle", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("enviada dos veces a la vez con la misma clave: la segunda espera y recibe la misma", async () => {
    const e = await escenario()

    await pedido(e)

    const clave = randomUUID()
    const llamada = (c) =>
      c.query(`select public.registrar_liquidacion($1, $2, 100, 'entrega_en_efectivo', p_clave_idempotencia => $3) as r`, [e.bodega, e.camion1, clave])

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enBodega.authId, hacer: llamada },
      segunda: { authId: e.enBodega.authId, hacer: llamada },
    })

    expect(r.error).toBeUndefined()
    expect(r.respuesta.rows[0].r.repetida).toBe(true)
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("dos entregas distintas a la vez no pueden pasarse del saldo", async () => {
    const e = await escenario()

    await pedido(e)

    const llamada = (c) =>
      c.query(`select public.registrar_liquidacion($1, $2, 150, 'entrega_en_efectivo', p_clave_idempotencia => $3) as r`, [e.bodega, e.camion1, randomUUID()])

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enBodega.authId, hacer: llamada },
      segunda: { authId: e.admin.authId, hacer: llamada },
    })

    expect(r.error.code).toBe("LQ002")
    expect(cifras(par(await control(e.admin), e))).toMatchObject({ por_confirmar: 150, pendiente: 80 })
  })

  it("confirmar y rechazar a la vez: gana la primera y la segunda ve el resultado", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 100 })

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enCamion1.authId, hacer: (c) => c.query("select public.resolver_liquidacion($1, true) as r", [l.id]) },
      segunda: { authId: e.admin.authId, hacer: (c) => c.query("select public.resolver_liquidacion($1, false, 'No llegó el sobre') as r", [l.id]) },
    })

    expect(r.error.code).toBe("LQ004")
    expect((await db.query("select estado from liquidaciones_ubicacion where id = $1", [l.id])).rows[0].estado).toBe("confirmada")
  })

  /*
    El caso real: el vendedor confirma desde su teléfono y el administrador,
    con la pantalla desactualizada, confirma casi a la vez. La segunda espera
    al candado, recibe la misma confirmación marcada `repetida` y no mueve
    nada: el monto se cuenta una sola vez y queda quien confirmó primero.
  */
  it("dos usuarios confirmando a la vez: una sola confirmación y el monto una sola vez", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 100 })
    const confirmar = (c) => c.query("select public.resolver_liquidacion($1, true) as r", [l.id])

    const r = await enDosSesiones(base, db, {
      primera: { authId: e.enCamion1.authId, hacer: confirmar },
      segunda: { authId: e.admin.authId, hacer: confirmar },
    })

    expect(r.error).toBeUndefined()
    expect(r.respuesta.rows[0].r).toMatchObject({ estado: "confirmada", resuelta_por: e.enCamion1.usuario, repetida: true })

    const guardada = (await db.query("select estado, resuelta_por from liquidaciones_ubicacion where id = $1", [l.id])).rows[0]

    expect(guardada).toEqual({ estado: "confirmada", resuelta_por: e.enCamion1.usuario })
    expect(await contar(db, "liquidaciones_ubicacion", "empresa_id = $1", [e.empresa])).toBe(1)
    expect(await contar(db, "liquidacion_detalle", "empresa_id = $1", [e.empresa])).toBe(1)
    expect(cifras(par(await control(e.admin), e))).toMatchObject({ por_confirmar: 0, liquidado: 100, pendiente: 130 })
  })
})

describe("quién ve y quién opera", () => {
  it("sin permiso de liquidaciones no se consulta ni se registra", async () => {
    const e = await escenario()

    await pedido(e)

    expect((await falla(control(e.sinPermiso))).code).toBe("42501")
    expect((await falla(registrar(e, e.sinPermiso, { monto: 10 }))).code).toBe("42501")
    expect((await como(e.sinPermiso.authId, "select count(*)::int as n from liquidaciones_ubicacion")).rows[0].n).toBe(0)
  })

  it("con permiso de consultar se ve, pero no se registra ni se confirma", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 10 })
    const c = await control(e.consultaCamion1)

    expect(num(par(c, e).pendiente)).toBe(220)
    expect(par(c, e).puede_registrar).toBe(false)
    expect(c.liquidaciones[0].puede_resolver).toBe(false)
    expect((await falla(resolver(e.consultaCamion1, l.id))).code).toBe("42501")
  })

  it("registra solo quien entrega (su ubicación es el origen) y confirma solo quien recibe", async () => {
    const e = await escenario()

    await pedido(e)

    expect((await falla(registrar(e, e.enCamion1, { monto: 10 }))).code).toBe("42501")

    const l = await registrar(e, e.enBodega, { monto: 10 })

    expect((await falla(resolver(e.enBodega, l.id))).code).toBe("42501")
    expect((await falla(resolver(e.enCamion2, l.id))).code).toBe("42501")

    const c = await control(e.enCamion1)

    expect(c.liquidaciones[0].puede_resolver).toBe(true)
    expect(par(c, e).puede_registrar).toBe(false)
  })

  it("otra ubicación no ve los saldos ajenos; el administrador ve y opera todo", async () => {
    const e = await escenario()

    await pedido(e)

    const ajena = await control(e.enCamion2)

    expect(ajena).toEqual({ pares: [], pedidos: [], liquidaciones: [] })

    const l = await registrar(e, e.admin, { monto: 30 })

    expect(await resolver(e.admin, l.id)).toMatchObject({ estado: "confirmada" })
  })

  it("el contador con permiso de consultar ve todo y no escribe nada", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 10 })

    expect(num(par(await control(e.contador), e).pendiente)).toBe(220)
    expect((await falla(registrar(e, e.contador, { monto: 10 }))).code).toBe("42501")
    expect((await falla(resolver(e.contador, l.id))).code).toBe("42501")
  })

  it("otra empresa no ve nada ni puede resolver una liquidación ajena", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 10 })

    expect(await control(e.otra)).toEqual({ pares: [], pedidos: [], liquidaciones: [] })
    expect((await falla(resolver(e.otra, l.id))).code).toBe("42501")
    expect((await falla(registrar(e, e.otra, { monto: 10 }))).code).toBe("LQ001")
  })

  it("nadie recibe los permisos por defecto: hay que darlos en Usuarios", async () => {
    const e = await escenario()
    const nuevo = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.bodega, permisos: ["pos"] })

    expect((await como(nuevo.authId, "select public.usuario_tiene_permiso('settlements-view') as v")).rows[0].v).toBe(false)
    expect((await como(e.admin.authId, "select public.usuario_tiene_permiso('settlements-manage') as v")).rows[0].v).toBe(true)
  })
})

describe("el registro no se toca", () => {
  it("no se inserta, modifica ni borra por fuera de las funciones", async () => {
    const e = await escenario()

    await pedido(e)

    const l = await registrar(e, e.enBodega, { monto: 10 })

    expect((await falla(como(e.admin.authId, "update liquidaciones_ubicacion set monto = 1 where id = $1", [l.id]))).code).toBe("42501")
    expect((await falla(como(e.admin.authId, "delete from liquidacion_detalle where liquidacion_id = $1", [l.id]))).code).toBe("42501")

    // Ni siquiera el dueño de la base reescribe lo registrado.
    expect((await falla(db.query("update liquidaciones_ubicacion set monto = 1 where id = $1", [l.id]))).code).toBe("42501")
    expect((await falla(db.query("delete from liquidaciones_ubicacion where id = $1", [l.id]))).code).toBe("42501")
    expect((await falla(db.query("update liquidacion_detalle set monto = 1 where liquidacion_id = $1", [l.id]))).code).toBe("42501")
    expect((await falla(db.query("truncate liquidacion_detalle cascade"))).code).toBe("42501")
  })

  it("una liquidación no es venta, cobro ni abono: no toca facturas, cobros, cuentas ni inventario", async () => {
    const e = await escenario()
    const p = await pedido(e, { forma: "credito", cobros: [efectivo(100)] })

    await facturar(e, p.pedido_id)

    const foto = async () =>
      (
        await db.query(
          `select (select count(*) from ventas where empresa_id = $1)::int as ventas,
                  (select count(*) from abonos where empresa_id = $1)::int as abonos,
                  (select count(*) from pagos where empresa_id = $1)::int as pagos,
                  (select count(*) from cobros_por_medio where empresa_id = $1)::int as cobros,
                  (select count(*) from movimientos_inventario where empresa_id = $1)::int as movimientos,
                  (select sum(cantidad) from inventario_ubicacion where empresa_id = $1)::int as existencias,
                  (select jsonb_agg(to_jsonb(v) order by v.id) from ventas v where empresa_id = $1) as filas_ventas`,
          [e.empresa]
        )
      ).rows[0]

    const antes = await foto()
    const l = await registrar(e, e.enBodega, { monto: 100 })

    await resolver(e.enCamion1, l.id)
    expect(await foto()).toEqual(antes)
  })
})

describe("la caja por ubicación", () => {
  const diario = (e, ubicacion = null) => fila(e.admin.authId, "select public.reporte_diario_de_caja(null, $1) as r", [ubicacion])
  const medios = (e, ubicacion = null) => fila(e.admin.authId, "select public.reporte_medios_de_caja(null, $1) as r", [ubicacion])
  const diarioBase = (e, ubicacion = null) => fila(e.admin.authId, "select public.reporte_diario(null, $1) as r", [ubicacion])
  const mediosBase = (e, ubicacion = null) => fila(e.admin.authId, "select public.reporte_medios_de_pago(null, $1) as r", [ubicacion])
  const deUbicacion = (lista, id) => lista.find((x) => x.ubicacion_id === id)

  // Una venta normal de Camión 01: un cargador al contado, 115.
  const ventaNormal = (e, cobros) =>
    fila(
      e.enCamion1.authId,
      `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb) as r`,
      [JSON.stringify([{ producto_id: e.cargador, cantidad: 1 }]), JSON.stringify(cobros)]
    )

  it("con solo ventas normales, la caja es exactamente el reporte de siempre", async () => {
    const e = await escenario()

    await ventaNormal(e, [efectivo(115)])
    await ventaNormal(e, [tarjeta(115)])

    const sinNuevos = (r) => {
      const { cobros_de_pedidos: _c, liquidaciones_del_dia: _l, saldos_por_liquidar: _s, ...resto } = r
      const { cobros_por_cuenta_de_otras: _x, cobros_por_cuenta_de_otras_cantidad: _y, ...indicadores } = resto.indicadores ?? {}
      return { ...resto, indicadores, por_ubicacion: resto.por_ubicacion?.map(({ cobros_por_cuenta_de_otras: _z, ...u }) => u) }
    }

    expect(sinNuevos(await diario(e))).toEqual(sinNuevos(await diarioBase(e)))

    const m = await medios(e)
    const b = await mediosBase(e)

    expect(m.por_medio).toEqual(b.por_medio)
    expect(m.por_venta).toEqual(b.por_venta)
    expect({ ...m.totales, por_cuenta_de_otras: undefined }).toEqual({ ...b.totales, por_cuenta_de_otras: undefined })
    expect(m.por_ubicacion.map(({ por_cuenta_de_otras: _p, ...u }) => u)).toEqual(b.por_ubicacion)
  })

  it("el cobro del pedido es de Bodega, con su medio; la venta es de Camión 01 y ya no figura «sin registrar»", async () => {
    const e = await escenario()

    await ventaNormal(e, [efectivo(115)])

    const p = await pedido(e)

    await facturar(e, p.pedido_id)

    const d = await diario(e)
    const b = await diarioBase(e)

    // Las ventas no cambian: siguen siendo de quien factura.
    expect(d.indicadores.ventas_total).toEqual(b.indicadores.ventas_total)
    expect(num(deUbicacion(d.por_ubicacion, e.camion1).ventas_total)).toBe(345)

    // Los cobros: Camión 01 solo su venta normal; Bodega, el pedido.
    expect(num(deUbicacion(d.por_ubicacion, e.camion1).cobros_total)).toBe(115)
    expect(num(deUbicacion(d.por_ubicacion, e.bodega).cobros_total)).toBe(230)
    expect(num(deUbicacion(d.por_ubicacion, e.bodega).cobros_por_cuenta_de_otras)).toBe(230)
    expect(num(d.indicadores.cobros_total)).toBe(345)
    expect(num(d.indicadores.cobros_por_cuenta_de_otras)).toBe(230)
    expect(d.cobros_de_pedidos).toEqual([expect.objectContaining({ pedido: p.numero, ubicacion: "Bodega", destino: "Camión 01", medio: "efectivo", monto: 230 })])
    expect(d.ventas.find((v) => v.forma_pago === "contado" && v.pedido === p.numero)).toMatchObject({ cobrado_en: "Bodega" })

    const m = await medios(e)

    expect(num(m.totales.sin_registrar)).toBe(0)
    expect(num(m.totales.total)).toBe(345)
    expect(num(deUbicacion(m.por_ubicacion, e.bodega).efectivo)).toBe(230)
    expect(num(deUbicacion(m.por_ubicacion, e.camion1).efectivo)).toBe(115)
    expect(m.por_medio.map((x) => [x.medio, num(x.operaciones), num(x.monto)])).toEqual([["efectivo", 2, 345]])
    expect(m.por_venta[d.ventas.find((v) => v.pedido === p.numero).id]).toEqual([expect.objectContaining({ medio: "efectivo", monto: 230 })])
  })

  it("el cobro cuenta desde el día del cobro, aunque no se haya facturado", async () => {
    const e = await escenario()

    await pedido(e, { cobros: [tarjeta(230)] })

    const m = await medios(e, e.bodega)

    expect(num(deUbicacion(m.por_ubicacion, e.bodega).tarjeta)).toBe(230)
    expect(num(m.totales.cargos)).toBe(3.91)
    expect(num((await diario(e, e.bodega)).indicadores.cobros_total)).toBe(230)
    expect(num((await diario(e, e.camion1)).indicadores.cobros_total)).toBe(0)
  })

  it("la prima de un crédito se cuenta una sola vez: como cobro de Bodega, no también como abono", async () => {
    const e = await escenario()
    const p = await pedido(e, { forma: "credito", cobros: [efectivo(80)] })

    await facturar(e, p.pedido_id)

    const b = await diarioBase(e)
    const d = await diario(e)

    // El reporte de siempre la cuenta como abono de Bodega...
    expect(num(b.indicadores.abonos_total)).toBe(80)
    // ...la caja, como cobro por cuenta de Camión 01, y una sola vez.
    expect(num(d.indicadores.abonos_total)).toBe(0)
    expect(d.abonos).toEqual([])
    expect(num(d.indicadores.cobros_total)).toBe(80)
    expect(num(deUbicacion(d.por_ubicacion, e.bodega).cobros_total)).toBe(80)

    const m = await medios(e)

    expect(num(m.totales.sin_registrar)).toBe(0)
    expect(num(m.totales.total)).toBe(80)
  })

  it("una liquidación no aparece como cobro ni como venta: solo mueve lo pendiente a liquidado", async () => {
    const e = await escenario()
    const p = await pedido(e)

    await facturar(e, p.pedido_id)

    const sinLiquidaciones = ({ liquidaciones_del_dia: _l, saldos_por_liquidar: _s, ...resto }) => resto
    const antesD = await diario(e)
    const antesM = await medios(e)

    expect(antesD.liquidaciones_del_dia).toEqual([])
    expect(antesD.saldos_por_liquidar.map((x) => [x.origen, x.destino, num(x.pendiente), num(x.por_confirmar), num(x.liquidado)])).toEqual([["Bodega", "Camión 01", 230, 0, 0]])

    const l = await registrar(e, e.enBodega, { monto: 200, referencia: "Sobre 3" })

    await resolver(e.enCamion1, l.id)

    const d = await diario(e)

    expect(sinLiquidaciones(d)).toEqual(sinLiquidaciones(antesD))
    expect(await medios(e)).toEqual(antesM)
    expect(d.saldos_por_liquidar.map((x) => [num(x.pendiente), num(x.por_confirmar), num(x.liquidado)])).toEqual([[30, 0, 200]])
    expect(d.liquidaciones_del_dia).toEqual([expect.objectContaining({ numero: "LIQ-000001", estado: "confirmada", origen: "Bodega", destino: "Camión 01", monto: 200 })])

    // Filtrado por una ubicación ajena al par, no aparece.
    expect((await diario(e, e.camion2)).saldos_por_liquidar).toEqual([])
  })

  // Como en producción: un abono antiguo sin ubicación hace que el reporte tenga una fila «Sin ubicación».
  it("la fila «Sin ubicación» no recibe los cobros ni las facturas de pedidos de las demás", async () => {
    const e = await escenario()
    const vieja = await crearFactura(db, { empresa: e.empresa, clienteId: e.cliente, total: 500 })

    await crearAbonoLegado(db, { empresa: e.empresa, ventaId: vieja, monto: 100 })

    const p = await pedido(e)

    await facturar(e, p.pedido_id)

    const d = await diario(e)
    const b = await diarioBase(e)
    const sinUbicacion = d.por_ubicacion.find((u) => u.ubicacion_id === null)

    expect(b.por_ubicacion.find((u) => u.ubicacion_id === null)).toMatchObject({ abonos_total: 100, cobros_total: 100 })
    expect([num(sinUbicacion.cobros_total), num(sinUbicacion.abonos_total), num(sinUbicacion.cobros_por_cuenta_de_otras)]).toEqual([100, 100, 0])
    expect(num(deUbicacion(d.por_ubicacion, e.bodega).cobros_total)).toBe(230)
    expect(num(deUbicacion(d.por_ubicacion, e.camion1).cobros_total)).toBe(0)

    // Las filas suman lo mismo que el total.
    expect(d.por_ubicacion.reduce((t, u) => t + num(u.cobros_total), 0)).toBe(num(d.indicadores.cobros_total))
    expect(d.por_ubicacion.reduce((t, u) => t + num(u.cobros_por_cuenta_de_otras), 0)).toBe(num(d.indicadores.cobros_por_cuenta_de_otras))
  })

  it("los reportes de caja son solo para administradores", async () => {
    const e = await escenario()

    expect((await falla(fila(e.enBodega.authId, "select public.reporte_diario_de_caja() as r"))).code).toBe("42501")
    expect((await falla(fila(e.enBodega.authId, "select public.reporte_medios_de_caja() as r"))).code).toBe("42501")
    expect((await falla(fila(e.enBodega.authId, "select public.caja_de_pedidos_del_dia(now() - interval '1 day', now(), null) as r"))).code).toBe("42501")
  })
})
