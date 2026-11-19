/*
  0050 contra PostgreSQL de verdad: contraliquidaciones, reembolsos desde una
  tercera ubicación y obligaciones entre ubicaciones en cualquier sentido.

  Cada caso arma su propia empresa con Bodega (origen, cobra), Ruta local
  (destino, factura) y Camión 01 (una tercera ubicación). El ISV es 0 para que
  los importes sean los de los ejemplos del propietario: un pedido de 4
  cargadores de 100 vale L 400. Tarjeta lleva 1.7 %. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones } from "./arnes.mjs"
import { crearEmpresa, crearCliente, crearVendedor } from "./fixtures.mjs"

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
  const admin = await crearEmpresa(db, "Lunacell C2b")
  const { empresa } = admin

  await db.query("update empresas set tasa_isv = 0, tasa_cargo_tarjeta = 1.7, tasa_cargo_enlace = 1.7 where id = $1", [empresa])
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

  await db.query(`insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 100)`, [empresa, bodega, cargador])

  const cliente = await crearCliente(db, empresa, "Cliente C2b")
  const vendedor = (u, permisos) => crearVendedor(db, { empresa, ubicacion: u, permisos })

  return {
    admin,
    empresa,
    bodega,
    ruta,
    camion1,
    cargador,
    cliente,
    enBodega: await vendedor(bodega, ["pos"]),
    cancelaBodega: await vendedor(bodega, ["pos", "orders-cancel"]),
    cancelaRuta: await vendedor(ruta, ["pos", "orders-cancel"]),
    resuelveRuta: await vendedor(ruta, ["pos", "orders-resolve"]),
    liquidaBodega: await vendedor(bodega, ["settlements-manage"]),
    liquidaRuta: await vendedor(ruta, ["settlements-manage"]),
    consultaCamion: await vendedor(camion1, ["settlements-view"]),
  }
}

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })

// Bodega entrega 4 cargadores (L 400) para que los facture Ruta local.
const entregar = (e, { cobros = [efectivo(400)] } = {}) =>
  fila(
    e.enBodega.authId,
    `select public.entregar_pedido(
       p_destino => $1, p_cliente_id => $2, p_items => $3::jsonb, p_forma_pago => 'contado',
       p_cobros => $4::jsonb, p_fecha_vencimiento => null, p_clave_idempotencia => $5) as r`,
    [e.ruta, e.cliente, JSON.stringify([{ producto_id: e.cargador, cantidad: 4 }]), JSON.stringify(cobros), randomUUID()]
  )

const cancelar = (quien, pedido, { reembolsos = [] } = {}) =>
  fila(quien.authId, "select public.cancelar_pedido($1, 'El cliente ya no lo quiere', null, $2::jsonb, $3) as r", [
    pedido,
    JSON.stringify(reembolsos),
    randomUUID(),
  ])

const reembolsar = (quien, pedido, { medio = "efectivo", importe, ubicacion = null, referencia = "", clave = randomUUID() }) =>
  fila(quien.authId, "select public.registrar_reembolso_de_pedido($1, $2, $3, $4, $5, $6) as r", [pedido, medio, importe, ubicacion, referencia, clave])

const liquidar = (quien, { origen, destino, monto, pedido = null, clave = randomUUID() }) =>
  fila(
    quien.authId,
    `select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => $3, p_metodo => 'entrega_en_efectivo',
       p_pedido => $4, p_clave_idempotencia => $5) as r`,
    [origen, destino, monto, pedido, clave]
  )

const resolver = (quien, id, confirmar, motivo = null) => fila(quien.authId, "select public.resolver_liquidacion($1, $2, $3) as r", [id, confirmar, motivo])

// Bodega entrega a Ruta local y Ruta local confirma.
async function liquidarAlDestino(e, monto) {
  const l = await liquidar(e.admin, { origen: e.bodega, destino: e.ruta, monto })

  await resolver(e.admin, l.id, true)

  return l
}

const control = (quien) => fila(quien.authId, "select public.control_de_liquidaciones() as r")
const info = (quien, pedido) => fila(quien.authId, "select public.cancelacion_de_pedido($1) as r", [pedido])

// Las obligaciones del pedido: [quien debe, quien recibe, total, pendiente].
async function deudas(e, pedido, quien = e.admin) {
  return (await control(quien)).pedidos
    .filter((p) => p.pedido_id === pedido)
    .map((p) => [p.origen, p.destino, num(p.efectivo), num(p.pendiente)])
    .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))
}

const porDevolver = async (e, pedido, medio = "efectivo") => num((await info(e.admin, pedido)).dinero.find((d) => d.medio === medio)?.pendiente ?? 0)

// Lo comercial que nada de esto puede tocar.
async function comercial(e) {
  const filas = async (consulta) => (await db.query(consulta, [e.empresa])).rows

  return {
    ventas: await filas("select * from ventas where empresa_id = $1 order by id"),
    pagos: await filas("select * from pagos where empresa_id = $1 order by id"),
    abonos: await filas("select * from abonos where empresa_id = $1 order by id"),
    cobros: await filas("select * from cobros_por_medio where empresa_id = $1 order by id"),
  }
}

describe("los casos del propietario", () => {
  it("caso 1: Bodega cobra L 400 y devuelve L 400: no hay obligación interna", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id, { reembolsos: [{ medio: "efectivo", importe: 400 }] })

    expect(await deudas(e, p.pedido_id)).toEqual([])
    expect(await porDevolver(e, p.pedido_id)).toBe(0)
  })

  it("caso 2: Bodega no liquida y Ruta local devuelve L 400: Bodega le debe L 400 a Ruta local", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 400 })

    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 400, 400]])
  })

  it("caso 3: liquidación completa confirmada y Bodega devuelve: Ruta local le devuelve L 400 a Bodega, sin tocar la original ni lo comercial", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const original = await liquidarAlDestino(e, 400)
    const filaOriginal = (await db.query("select * from liquidaciones_ubicacion where id = $1", [original.id])).rows[0]

    // Con la liquidación confirmada ya se cancela (0050).
    expect((await cancelar(e.cancelaBodega, p.pedido_id)).estado).toBe("cancelado")

    const antes = await comercial(e)

    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 400 })
    expect(await deudas(e, p.pedido_id)).toEqual([["Ruta local", "Bodega", 400, 400]])

    // La registra quien debe (Ruta local) y la confirma quien recibe (Bodega).
    expect((await falla(liquidar(e.liquidaBodega, { origen: e.ruta, destino: e.bodega, monto: 400 }))).code).toBe("42501")

    const contra = await liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 400 })

    expect(contra).toMatchObject({ estado: "por_confirmar", origen_id: e.ruta, destino_id: e.bodega })
    expect((await falla(resolver(e.liquidaRuta, contra.id, true))).code).toBe("42501")
    await resolver(e.liquidaBodega, contra.id, true)

    expect(await deudas(e, p.pedido_id)).toEqual([["Ruta local", "Bodega", 400, 0]])
    expect((await db.query("select * from liquidaciones_ubicacion where id = $1", [original.id])).rows[0]).toEqual(filaOriginal)
    expect(await comercial(e)).toEqual(antes)

    const historial = (await control(e.admin)).liquidaciones

    expect(historial.find((l) => l.id === contra.id)).toMatchObject({ contraliquidacion: true, estado: "confirmada", pedidos: [{ numero: p.numero, motivo: "cancelacion" }] })
    expect(historial.find((l) => l.id === original.id)).toMatchObject({ contraliquidacion: false, pedidos: [{ numero: p.numero, motivo: "cobro" }] })
  })

  it("caso 4: liquidación completa y devuelve Ruta local: no hay una segunda obligación", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 400)
    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 400 })

    expect(await deudas(e, p.pedido_id)).toEqual([])
  })

  it("caso 5: liquidación parcial de L 100 y Bodega devuelve todo: Ruta local le devuelve L 100", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 100)
    await cancelar(e.cancelaBodega, p.pedido_id)
    expect(await deudas(e, p.pedido_id)).toEqual([])

    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 400 })
    expect(await deudas(e, p.pedido_id)).toEqual([["Ruta local", "Bodega", 100, 100]])
  })

  it("caso 5 (al revés): liquidación parcial de L 100 y Ruta local devuelve todo: Bodega le debe L 300", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 100)
    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 400 })

    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 300, 300]])
  })

  it("caso 6: Camión 01 devuelve L 400 sin liquidaciones previas: Bodega le debe L 400 a Camión 01", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.admin, p.pedido_id, { importe: 400, ubicacion: e.camion1, referencia: "Recibo 77, entregó el chofer" })

    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Camión 01", 400, 400]])
    expect(await porDevolver(e, p.pedido_id)).toBe(0)

    // Camión 01 ve lo que se le debe; sin abrir el pedido ni tener permisos en él.
    expect((await control(e.consultaCamion)).pedidos.map((x) => [x.origen, x.destino])).toEqual([["Bodega", "Camión 01"]])
    expect((await falla(info(e.consultaCamion, p.pedido_id))).code).toBe("PI008")
  })

  it("caso 6 con liquidación parcial: Bodega debe L 300 y Ruta local L 100 a Camión 01", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 100)
    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.admin, p.pedido_id, { importe: 400, ubicacion: e.camion1, referencia: "Recibo 78" })

    expect(await deudas(e, p.pedido_id)).toEqual([
      ["Bodega", "Camión 01", 300, 300],
      ["Ruta local", "Camión 01", 100, 100],
    ])
  })

  it("decisión del propietario: con dinero por devolver, cubre primero quien cobró", async () => {
    const e = await escenario()
    const p = await entregar(e)

    // Bodega conserva L 300, Ruta local L 100; Camión 01 devuelve L 200 y quedan L 200.
    await liquidarAlDestino(e, 100)
    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.admin, p.pedido_id, { importe: 200, ubicacion: e.camion1, referencia: "Recibo 79" })

    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Camión 01", 200, 200]])
    expect(await porDevolver(e, p.pedido_id)).toBe(200)

    // Bodega devuelve lo que falta: ya no le alcanza para cubrir a Camión 01 sola, y Ruta local pone lo suyo.
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 200 })
    expect(await deudas(e, p.pedido_id)).toEqual([
      ["Bodega", "Camión 01", 100, 100],
      ["Ruta local", "Camión 01", 100, 100],
    ])
  })

  it("caso 7: Bodega devuelve L 100 y Ruta local L 150: Bodega le debe L 150 y quedan L 150 por devolver", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 100 })
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 150 })

    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 150, 150]])
    expect(await porDevolver(e, p.pedido_id)).toBe(150)

    // Lo pendiente no es deuda: al devolverlo Bodega, la obligación con Ruta local no cambia.
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 150 })
    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 150, 150]])
    expect(await porDevolver(e, p.pedido_id)).toBe(0)
  })

  it("caso 8: pago mixto: lo electrónico lo devuelve la empresa y solo el efectivo crea obligación", async () => {
    const e = await escenario()
    const p = await entregar(e, { cobros: [efectivo(200), { medio: "tarjeta", monto: 200, referencia: "AUT-1", tasa: 1.7, cargo: 3.4 }] })

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.admin, p.pedido_id, { medio: "tarjeta", importe: 203.4, referencia: "Reverso 1" })
    expect(await deudas(e, p.pedido_id)).toEqual([])

    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 200 })
    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 200, 200]])

    const linea = (await control(e.admin)).pedidos.find((x) => x.pedido_id === p.pedido_id)

    expect([num(linea.electronico), num(linea.cargo), linea.motivo]).toEqual([0, 0, "cancelacion"])
  })
})

describe("bloqueos y concurrencia", () => {
  it("con una liquidación por confirmar no se cancela; confirmada o rechazada, sí", async () => {
    const e = await escenario()
    const p = await entregar(e)
    const l = await liquidar(e.admin, { origen: e.bodega, destino: e.ruta, monto: 400 })

    const r = await falla(cancelar(e.cancelaBodega, p.pedido_id))

    expect(r.code).toBe("PI013")
    expect(r.message).toContain(l.numero)
    expect((await info(e.cancelaBodega, p.pedido_id)).bloqueo_por_liquidacion).toBe(`${l.numero} (por confirmar)`)

    await resolver(e.admin, l.id, true)
    expect((await info(e.cancelaBodega, p.pedido_id)).bloqueo_por_liquidacion).toBeNull()
    expect((await cancelar(e.cancelaBodega, p.pedido_id)).estado).toBe("cancelado")
  })

  it("con una contraliquidación por confirmar no se devuelve efectivo; lo electrónico sí; al resolverse, el efectivo también", async () => {
    const e = await escenario()
    const p = await entregar(e, { cobros: [efectivo(300), { medio: "tarjeta", monto: 100, referencia: "AUT-2", tasa: 1.7, cargo: 1.7 }] })

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 100 })

    const l = await liquidar(e.liquidaBodega, { origen: e.bodega, destino: e.ruta, monto: 100 })

    expect((await info(e.admin, p.pedido_id)).bloqueo_de_reembolsos).toBe(`${l.numero} (por confirmar)`)
    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 50 }))).code).toBe("PI013")
    expect(await reembolsar(e.admin, p.pedido_id, { medio: "tarjeta", importe: 101.7, referencia: "Reverso 2" })).toMatchObject({ repetido: false })

    await resolver(e.liquidaRuta, l.id, false, "No llegó el sobre")
    expect((await info(e.admin, p.pedido_id)).bloqueo_de_reembolsos).toBeNull()
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 50 })
    expect(await deudas(e, p.pedido_id)).toEqual([["Bodega", "Ruta local", 100, 100]])
  })

  it("liquidar y devolver efectivo a la vez: la devolución espera y encuentra la liquidación por confirmar", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaRuta, p.pedido_id, { importe: 200 })

    const r = await enDosSesiones(base, db, {
      primera: {
        authId: e.liquidaBodega.authId,
        hacer: (c) =>
          c.query(
            "select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => 200, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $3)",
            [e.bodega, e.ruta, randomUUID()]
          ),
      },
      segunda: {
        authId: e.cancelaBodega.authId,
        hacer: (c) => c.query("select public.registrar_reembolso_de_pedido($1, 'efectivo', 50, null, '', $2)", [p.pedido_id, randomUUID()]),
      },
    })

    expect(r.error?.code).toBe("PI013")
    expect(await porDevolver(e, p.pedido_id)).toBe(200)
  })

  it("cancelar y liquidar a la vez: la liquidación espera, encuentra el pedido cancelado y no registra nada", async () => {
    const e = await escenario()
    const p = await entregar(e)

    const r = await enDosSesiones(base, db, {
      primera: {
        authId: e.cancelaBodega.authId,
        hacer: (c) => c.query("select public.cancelar_pedido($1, 'Se envió por error', null, '[]'::jsonb, $2)", [p.pedido_id, randomUUID()]),
      },
      segunda: {
        authId: e.liquidaBodega.authId,
        hacer: (c) =>
          c.query(
            "select public.registrar_liquidacion(p_origen => $1, p_destino => $2, p_monto => 400, p_metodo => 'entrega_en_efectivo', p_clave_idempotencia => $3)",
            [e.bodega, e.ruta, randomUUID()]
          ),
      },
    })

    expect(r.error?.code).toBe("LQ002")
    expect(Number((await db.query("select count(*) from liquidaciones_ubicacion where empresa_id = $1", [e.empresa])).rows[0].count)).toBe(0)
  })

  it("una contraliquidación no pasa de lo que se debe, y su reintento no la duplica", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 400)
    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.cancelaBodega, p.pedido_id, { importe: 150 })

    expect((await falla(liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 150.01 }))).code).toBe("LQ002")

    const clave = randomUUID()
    const primera = await liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 150, clave })

    expect(await liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 150, clave })).toMatchObject({ id: primera.id, repetida: true })
    expect((await falla(liquidar(e.liquidaRuta, { origen: e.ruta, destino: e.bodega, monto: 0.01 }))).code).toBe("LQ002")
  })

  it("el rechazo y la resolución de C1 siguen bloqueados con una liquidación confirmada; un pedido facturado no se cancela", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await liquidarAlDestino(e, 100)
    expect((await falla(fila(e.resuelveRuta.authId, "select public.rechazar_pedido($1, $2, $3) as r", [p.pedido_id, "No corresponde aquí", randomUUID()]))).code).toBe("PI013")

    await fila(e.resuelveRuta.authId, "select public.facturar_pedido($1) as r", [p.pedido_id])
    expect((await falla(cancelar(e.admin, p.pedido_id))).code).toBe("PI012")
  })
})

describe("reembolso desde una tercera ubicación", () => {
  it("solo el administrador, y con la referencia de la entrega real", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)

    expect((await falla(reembolsar(e.cancelaBodega, p.pedido_id, { importe: 10, ubicacion: e.camion1, referencia: "Recibo" }))).code).toBe("42501")
    expect((await falla(reembolsar(e.cancelaRuta, p.pedido_id, { importe: 10, ubicacion: e.camion1, referencia: "Recibo" }))).code).toBe("42501")

    const sinReferencia = await falla(reembolsar(e.admin, p.pedido_id, { importe: 10, ubicacion: e.camion1 }))

    expect(sinReferencia.code).toBe("PI015")
    expect(sinReferencia.message).toContain("referencia")

    await reembolsar(e.admin, p.pedido_id, { importe: 10, ubicacion: e.camion1, referencia: "Recibo 80" })

    const delAdmin = await info(e.admin, p.pedido_id)

    expect(delAdmin.ubicaciones_para_reembolsar.map((u) => [u.nombre, u.otra])).toEqual([
      ["Bodega", false],
      ["Ruta local", false],
      ["Camión 01", true],
    ])
    expect(delAdmin.reembolsos).toMatchObject([{ ubicacion: "Camión 01", referencia: "Recibo 80", en_otra_ubicacion: true }])
    expect(delAdmin.obligaciones).toEqual([{ debe: "Bodega", recibe: "Camión 01", monto: 10, por_confirmar: 0, liquidado: 0, pendiente: 10 }])
    expect((await info(e.cancelaRuta, p.pedido_id)).ubicaciones_para_reembolsar.map((u) => u.nombre)).toEqual(["Ruta local"])
  })

  it("baja la caja de Camión 01 en el reporte diario, no la de Bodega", async () => {
    const e = await escenario()
    const p = await entregar(e)

    await cancelar(e.cancelaBodega, p.pedido_id)
    await reembolsar(e.admin, p.pedido_id, { importe: 400, ubicacion: e.camion1, referencia: "Recibo 81" })

    const diario = await fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")
    const de = (id) => diario.por_ubicacion.find((u) => u.ubicacion_id === id)

    expect(num(de(e.camion1).reembolsos_pagados)).toBe(400)
    expect(num(de(e.bodega).reembolsos_pagados)).toBe(0)
    expect(num(diario.indicadores.reembolsos_de_pedidos_pendientes)).toBe(0)
  })
})
