/*
  0039 y 0041 contra PostgreSQL de verdad: medios de pago, cargo e ISV.

  Las ventas, los cobros, las anulaciones y las conciliaciones se hacen con las
  funciones que usa la aplicación. Solo se mueve la fecha de lo ya registrado,
  para probar otros días. Una vez aplicada la migración, las tablas de cobros no
  admiten cambios, y por eso los escenarios no las tocan.
*/

import { readFileSync } from "node:fs"

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"
import {
  conciliar,
  correlativoInterno,
  escenarioSinConexion,
  existencia,
  fallo,
  ventaSinConexion,
} from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

async function como(authId, consulta, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(consulta, valores)
  } finally {
    await comoDueno(db)
  }
}

const unaFila = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0].r

/* El cargador se vende a 100 y lleva 15 % de ISV: una unidad son 115. */
async function escenario() {
  const esc = await escenarioSinConexion(db, { enCamion1: 100 })

  await db.query(
    `insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing`,
    [esc.vendedor.usuario, esc.empresa]
  )

  return esc
}

const efectivo = (monto) => ({ medio: "efectivo", monto })
const tarjeta = (monto, referencia = "AUT-1") => ({ medio: "tarjeta", monto, referencia })
const enlace = (monto, referencia = "LINK-1") => ({ medio: "enlace", monto, referencia })
const transferencia = (monto, referencia = "TRF-1") => ({ medio: "transferencia", monto, referencia })

const vender = (e, authId, cobros, { cantidad = 1, forma = "contado", cliente = null, clave = null, venc = null } = {}) =>
  unaFila(
    authId,
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
       p_fecha_vencimiento => $5, p_clave_idempotencia => $6) as r`,
    [JSON.stringify([{ producto_id: e.cargador.id, cantidad }]), forma, cobros === null ? null : JSON.stringify(cobros), cliente, venc, clave]
  )

const ventaACredito = (e, authId = e.vendedor.authId, cantidad = 2) =>
  vender(e, authId, null, { cantidad, forma: "credito", cliente: e.clienteId, venc: "2030-01-01" })

const cobrar = (authId, cliente, monto, cobros, clave = null) =>
  unaFila(
    authId,
    `select public.registrar_pago_con_medios(
       p_cliente_id => $1, p_monto => $2, p_cobros => $3::jsonb, p_clave_idempotencia => $4) as r`,
    [cliente, monto, JSON.stringify(cobros), clave]
  )

const PARAMETROS_SIN_CONEXION = `
  p_clave_idempotencia => $1, p_usuario_auth => $2, p_ubicacion_id => $3,
  p_dispositivo => $4, p_numero_provisional => $5, p_registrada_en => $6,
  p_reloj_dispositivo => $7, p_tasa_isv => $8, p_renglones => $9::jsonb,
  p_total_cobrado => $10, p_forma_pago => $11, p_cobros => $12::jsonb, p_cliente_id => $13,
  p_nombre_cliente => $14, p_rtn_comprador => $15, p_fecha_vencimiento => $16, p_nota => $17`

const valoresSinConexion = (v, cobros) => [
  v.clave_idempotencia, v.usuario_auth, v.ubicacion_id, v.dispositivo, v.numero_provisional, v.registrada_en,
  v.reloj_dispositivo, v.tasa_isv, JSON.stringify(v.renglones), v.total_cobrado, v.forma_pago,
  cobros === null ? null : JSON.stringify(cobros),
  v.cliente_id, v.nombre_cliente, v.rtn_comprador, v.fecha_vencimiento, v.nota,
]

const sincronizar = (authId, venta, cobros) =>
  unaFila(authId, `select public.sincronizar_venta_con_medios(${PARAMETROS_SIN_CONEXION}) as r`, valoresSinConexion(venta, cobros))

const rescatar = (authId, venta, cobros, lote = "lote-1") =>
  unaFila(
    authId,
    `select public.rescatar_venta_con_medios(${PARAMETROS_SIN_CONEXION}, p_lote => $18) as r`,
    [...valoresSinConexion(venta, cobros), lote]
  )

const cobrosDeVenta = async (ventaId) =>
  (await db.query("select medio, monto::float8 as monto, referencia, ubicacion_id, usuario_id from cobros_por_medio where venta_id = $1 order by medio", [ventaId])).rows

const cobrosDePago = async (pagoId) =>
  (await db.query("select medio, monto::float8 as monto, referencia, ubicacion_id from cobros_por_medio where pago_id = $1 order by medio, monto", [pagoId])).rows

const medios = (authId, dia = null, ubicacion = null) =>
  unaFila(authId, "select public.reporte_medios_de_pago($1::date, $2::uuid) as r", [dia, ubicacion])

const diario = (authId, dia = null, ubicacion = null) =>
  unaFila(authId, "select public.reporte_diario($1::date, $2::uuid) as r", [dia, ubicacion])

const fila = (lista, clave, valor) => lista.find((x) => x[clave] === valor)

describe("venta al contado con medios de pago", () => {
  it("un solo medio guarda el total, con la ubicación y el usuario de la venta", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [efectivo(115)])

    expect(await cobrosDeVenta(venta.venta_id)).toEqual([
      { medio: "efectivo", monto: 115, referencia: "", ubicacion_id: e.camion1, usuario_id: e.vendedor.usuario },
    ])
  })

  it("los cuatro medios en un pago mixto, con decimales exactos", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [efectivo(0.1), transferencia(0.2), tarjeta(114.6), enlace(0.1)])

    expect((await cobrosDeVenta(venta.venta_id)).map((c) => [c.medio, c.monto])).toEqual([
      ["efectivo", 0.1], ["enlace", 0.1], ["tarjeta", 114.6], ["transferencia", 0.2],
    ])
  })

  it("no cambia el total de la venta ni su forma de pago", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [efectivo(15), tarjeta(100)])
    const { rows } = await db.query("select forma_pago, estado, subtotal::float8 as s, isv::float8 as i, total::float8 as t from ventas where id = $1", [venta.venta_id])

    expect(rows[0]).toEqual({ forma_pago: "contado", estado: "pagada", s: 100, i: 15, t: 115 })
  })

  it("si los medios no suman el total se deshace todo: venta, existencia y correlativo", async () => {
    const e = await escenario()
    const antes = { stock: await existencia(db, e.camion1, e.cargador.id), correlativo: await correlativoInterno(db, e.empresa) }

    const error = await fallo(vender(e, e.vendedor.authId, [efectivo(114.99)], { clave: "venta-corta" }))

    expect(error.code).toBe("LM002")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes.stock)
    expect(await correlativoInterno(db, e.empresa)).toBe(antes.correlativo)
    expect((await db.query("select 1 from ventas where clave_idempotencia = 'venta-corta'")).rows).toHaveLength(0)
  })

  it.each([
    ["sin medios", null],
    ["lista vacía", []],
    ["medio desconocido", [{ medio: "cheque", monto: 115 }]],
    ["importe en cero", [efectivo(0), tarjeta(115)]],
    ["importe negativo", [efectivo(-5), tarjeta(120)]],
    ["más de dos decimales", [efectivo(114.999), tarjeta(0.001)]],
    ["importe que no es número", [{ medio: "efectivo", monto: "mucho" }]],
    ["medio repetido", [efectivo(100), efectivo(15)]],
    ["enlace con referencia que no es texto", [{ medio: "enlace", monto: 115, referencia: 123 }]],
    ["efectivo con referencia", [{ medio: "efectivo", monto: 115, referencia: "RECIBO" }]],
    ["referencia demasiado larga", [tarjeta(115, "x".repeat(121))]],
  ])("rechaza %s sin registrar la venta", async (_, cobros) => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)
    const error = await fallo(vender(e, e.vendedor.authId, cobros))

    expect(error.code).toBe("LM001")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
  })
})

describe("sin referencia (0040)", () => {
  it.each([
    ["transferencia", { medio: "transferencia", monto: 115 }],
    ["tarjeta", { medio: "tarjeta", monto: 115, referencia: "" }],
    ["enlace", { medio: "enlace", monto: 115, referencia: "   " }],
  ])("una venta con %s se registra, y la referencia queda vacía", async (medio, cobro) => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [cobro])

    expect(await cobrosDeVenta(venta.venta_id)).toEqual([
      expect.objectContaining({ medio, monto: 115, referencia: "" }),
    ])
  })

  it("sigue exigiendo que los importes sumen el total", async () => {
    const e = await escenario()
    const error = await fallo(vender(e, e.vendedor.authId, [{ medio: "tarjeta", monto: 100 }]))

    expect(error.code).toBe("LM002")
  })

  it("una referencia escrita se sigue guardando", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [tarjeta(115, " AUT-7 ")])

    expect(await cobrosDeVenta(venta.venta_id)).toEqual([expect.objectContaining({ referencia: "AUT-7" })])
  })

  it("un reintento sin referencia no duplica", async () => {
    const e = await escenario()
    const cobros = [{ medio: "tarjeta", monto: 115 }]
    const primera = await vender(e, e.vendedor.authId, cobros, { clave: "sin-ref-1" })
    const segunda = await vender(e, e.vendedor.authId, cobros, { clave: "sin-ref-1" })

    expect(segunda.repetida).toBe(true)
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect(await cobrosDeVenta(primera.venta_id)).toHaveLength(1)
  })

  it("agregar la referencia en un reintento cuenta como otros medios", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [{ medio: "tarjeta", monto: 115 }], { clave: "sin-ref-2" })

    const error = await fallo(vender(e, e.vendedor.authId, [tarjeta(115)], { clave: "sin-ref-2" }))

    expect(error.code).toBe("LM005")
  })

  it("un abono mixto se registra sin referencia", async () => {
    const e = await escenario()

    await ventaACredito(e)

    const pago = await cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(40), { medio: "transferencia", monto: 60 }])

    expect(await cobrosDePago(pago.pago_id)).toEqual([
      expect.objectContaining({ medio: "efectivo", monto: 40, referencia: "" }),
      expect.objectContaining({ medio: "transferencia", monto: 60, referencia: "" }),
    ])
  })

  it("una venta sin conexión sincroniza sin referencia, sin duplicar al reintentar", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const cobros = [{ medio: "enlace", monto: 230 }]
    const primera = await sincronizar(e.vendedor.authId, venta, cobros)
    const segunda = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(primera.estado).toBe("registrada")
    expect(segunda.estado).toBe("ya_registrada")
    expect(await cobrosDeVenta(primera.venta_id)).toEqual([expect.objectContaining({ medio: "enlace", referencia: "" })])
  })

  it("un rescate sin referencia se aplica al conciliar", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const r = await rescatar(e.admin.authId, venta, [{ medio: "transferencia", monto: 230 }])

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "rescate" })

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")
    const { rows } = await db.query("select referencia from cobros_por_medio where venta_id = $1", [aplicada.venta_id])

    expect(rows).toEqual([{ referencia: "" }])
  })

  it("el reporte cuenta el cobro sin referencia", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [{ medio: "tarjeta", monto: 115 }])

    const r = await medios(e.admin.authId)

    expect(r.totales.total).toBe(115)
    expect(r.por_medio).toEqual([expect.objectContaining({ medio: "tarjeta" })])
  })
})

describe("venta a crédito", () => {
  it("conserva la distinción: queda pendiente y sin medios", async () => {
    const e = await escenario()
    const venta = await ventaACredito(e)
    const { rows } = await db.query("select forma_pago, estado from ventas where id = $1", [venta.venta_id])

    expect(rows[0]).toEqual({ forma_pago: "credito", estado: "pendiente" })
    expect(await cobrosDeVenta(venta.venta_id)).toEqual([])
  })

  it("rechaza medios en una venta a crédito", async () => {
    const e = await escenario()
    const error = await fallo(vender(e, e.vendedor.authId, [efectivo(115)], { forma: "credito", cliente: e.clienteId, venc: "2030-01-01" }))

    expect(error.code).toBe("LM003")
  })
})

describe("reintentos", () => {
  it("la misma venta con la misma clave devuelve la que existe, sin duplicar cobros", async () => {
    const e = await escenario()
    const cobros = [efectivo(15), tarjeta(100)]
    const primera = await vender(e, e.vendedor.authId, cobros, { clave: "reintento-1" })
    const segunda = await vender(e, e.vendedor.authId, [tarjeta(100), efectivo(15)], { clave: "reintento-1" })

    expect(segunda.repetida).toBe(true)
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect(await cobrosDeVenta(primera.venta_id)).toHaveLength(2)
  })

  it("la misma clave con otros medios se rechaza", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [efectivo(115)], { clave: "reintento-2" })

    const error = await fallo(vender(e, e.vendedor.authId, [tarjeta(115)], { clave: "reintento-2" }))

    expect(error.code).toBe("LM005")
  })

  it("una venta registrada por el camino anterior sigue sin medios al reintentarla", async () => {
    const e = await escenario()
    const vieja = await unaFila(
      e.vendedor.authId,
      "select public.registrar_venta_ubicacion(p_items => $1::jsonb, p_forma_pago => 'contado', p_clave_idempotencia => 'camino-viejo') as r",
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }])]
    )

    const reintento = await vender(e, e.vendedor.authId, [efectivo(115)], { clave: "camino-viejo" })

    expect(reintento.repetida).toBe(true)
    expect(await cobrosDeVenta(vieja.venta_id)).toEqual([])
  })
})

describe("abonos", () => {
  it("un abono mixto guarda sus medios y su ubicación, sin tocar el reparto", async () => {
    const e = await escenario()
    const venta = await ventaACredito(e)
    const pago = await cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(40), transferencia(60)], "abono-1")

    expect(pago.aplicaciones).toEqual([expect.objectContaining({ venta_id: venta.venta_id, monto_aplicado: 100 })])
    expect(await cobrosDePago(pago.pago_id)).toEqual([
      { medio: "efectivo", monto: 40, referencia: "", ubicacion_id: e.camion1 },
      { medio: "transferencia", monto: 60, referencia: "TRF-1", ubicacion_id: e.camion1 },
    ])
  })

  it("los medios deben sumar el monto, y si no, no entra el pago", async () => {
    const e = await escenario()

    await ventaACredito(e)

    const error = await fallo(cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(99.99)]))

    expect(error.code).toBe("LM002")
    expect((await db.query("select 1 from pagos where empresa_id = $1", [e.empresa])).rows).toHaveLength(0)
  })

  it("un sobrepago sigue rechazándose con el código de siempre, sin cobros", async () => {
    const e = await escenario()

    await ventaACredito(e)

    const error = await fallo(cobrar(e.vendedor.authId, e.clienteId, 1000, [efectivo(1000)]))

    expect(error.code).toBe("LC001")
    expect((await db.query("select 1 from cobros_por_medio where empresa_id = $1", [e.empresa])).rows).toHaveLength(0)
  })

  it("reintentar no cobra dos veces, y otros medios con la misma clave se rechazan", async () => {
    const e = await escenario()

    await ventaACredito(e)

    const primero = await cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(100)], "abono-2")
    const segundo = await cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(100)], "abono-2")

    expect(segundo.repetido).toBe(true)
    expect(await cobrosDePago(primero.pago_id)).toHaveLength(1)

    const error = await fallo(cobrar(e.vendedor.authId, e.clienteId, 100, [tarjeta(100)], "abono-2"))

    expect(error.code).toBe("LM005")
  })

  it("un pago del administrador sobre varias ubicaciones reparte cada medio con importes exactos", async () => {
    const e = await escenario()
    const vendedor2 = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })
    const vieja = await ventaACredito(e, e.vendedor.authId, 1)

    await db.query("update ventas set fecha = now() - interval '1 hour' where id = $1", [vieja.venta_id])
    await ventaACredito(e, vendedor2.authId, 1)

    // Dos facturas de 115 en dos camiones; se paga el total con dos medios.
    const pago = await cobrar(e.admin.authId, e.clienteId, 230, [efectivo(50), tarjeta(180)])
    const filas = await cobrosDePago(pago.pago_id)

    expect(filas).toEqual([
      { medio: "efectivo", monto: 50, referencia: "", ubicacion_id: e.camion1 },
      { medio: "tarjeta", monto: 65, referencia: "AUT-1", ubicacion_id: e.camion1 },
      { medio: "tarjeta", monto: 115, referencia: "AUT-1", ubicacion_id: e.camion2 },
    ])

    const r = await medios(e.admin.authId)

    expect(fila(r.por_ubicacion, "ubicacion", "Camión 01")).toMatchObject({ efectivo: 50, tarjeta: 65, total: 115 })
    expect(fila(r.por_ubicacion, "ubicacion", "Camión 02")).toMatchObject({ tarjeta: 115, total: 115 })
  })
})

describe("el cargo del 7 %", () => {
  const conCargo = (medio, monto, referencia = "") => ({ medio, monto, referencia, cargo: Math.round(monto * 7) / 100 })
  const cargoDeVenta = async (id) =>
    Number((await db.query("select cargo_por_medio from ventas where id = $1", [id])).rows[0].cargo_por_medio)
  const cargos = async (id) =>
    (await db.query("select medio, monto::float8 as monto, cargo::float8 as cargo from cobros_por_medio where venta_id = $1 order by medio", [id])).rows

  it.each([["tarjeta"], ["enlace"]])("%s lleva 7 %% sobre su importe, y el total de la venta no cambia", async (medio) => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [conCargo(medio, 115)])
    const { rows } = await db.query("select total::float8 as total from ventas where id = $1", [venta.venta_id])

    expect(rows[0].total).toBe(115)
    expect(await cargoDeVenta(venta.venta_id)).toBe(8.05)
    expect(await cargos(venta.venta_id)).toEqual([{ medio, monto: 115, cargo: 8.05 }])
  })

  it("en pago mixto solo lleva cargo la parte de la tarjeta", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [efectivo(15), conCargo("tarjeta", 100)])

    expect(await cargoDeVenta(venta.venta_id)).toBe(7)
    expect(await cargos(venta.venta_id)).toEqual([
      { medio: "efectivo", monto: 15, cargo: 0 },
      { medio: "tarjeta", monto: 100, cargo: 7 },
    ])
  })

  it.each([
    ["uno menor", 1],
    ["uno mayor", 99],
    ["cero", 0],
  ])("rechaza %s al que da la cuenta, sin registrar la venta", async (_, cargo) => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)
    const error = await fallo(vender(e, e.vendedor.authId, [{ medio: "tarjeta", monto: 115, cargo }]))

    expect(error.code).toBe("LM001")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
  })

  it("efectivo y transferencia no admiten cargo", async () => {
    const e = await escenario()

    for (const medio of ["efectivo", "transferencia"]) {
      const error = await fallo(vender(e, e.vendedor.authId, [{ medio, monto: 115, cargo: 8.05 }]))

      expect(error.code).toBe("LM001")
    }
  })

  it("una versión anterior no manda cargo y queda con cargo 0", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [tarjeta(115)])

    expect(await cargoDeVenta(venta.venta_id)).toBe(0)
  })

  it("un reintento no duplica el cargo, y otro cargo con la misma clave se rechaza", async () => {
    const e = await escenario()
    const cobros = [conCargo("tarjeta", 115)]
    const primera = await vender(e, e.vendedor.authId, cobros, { clave: "cargo-1" })
    const segunda = await vender(e, e.vendedor.authId, cobros, { clave: "cargo-1" })

    expect(segunda.repetida).toBe(true)
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect(await cargoDeVenta(primera.venta_id)).toBe(8.05)
    expect(await cargos(primera.venta_id)).toHaveLength(1)

    const error = await fallo(vender(e, e.vendedor.authId, [tarjeta(115)], { clave: "cargo-1" }))

    expect(error.code).toBe("LM005")
  })

  it("en un abono la deuda baja el monto, y el cargo va aparte en el pago", async () => {
    const e = await escenario()

    await ventaACredito(e)

    const pago = await cobrar(e.vendedor.authId, e.clienteId, 100, [conCargo("tarjeta", 100)])
    const { rows } = await db.query("select monto::float8 as monto, cargo_por_medio::float8 as cargo from pagos where id = $1", [pago.pago_id])
    const { rows: abonos } = await db.query("select sum(monto)::float8 as suma from abonos where pago_id = $1", [pago.pago_id])

    expect(rows[0]).toEqual({ monto: 100, cargo: 7 })
    expect(abonos[0].suma).toBe(100)
  })

  it("un abono repartido entre ubicaciones suma exactamente el cargo del medio", async () => {
    const e = await escenario()
    const vendedor2 = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })

    await db.query("update inventario_ubicacion set cantidad = 100 where ubicacion_id = $1", [e.camion2]).catch(() => {})
    await db.query(
      "insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 100) on conflict do nothing",
      [e.empresa, e.camion2, e.cargador.id]
    ).catch(() => {})

    await ventaACredito(e, e.vendedor.authId, 1)
    await ventaACredito(e, vendedor2.authId, 1)

    const pago = await cobrar(e.admin.authId, e.clienteId, 200, [conCargo("enlace", 200)])
    const { rows } = await db.query("select monto::float8 as monto, cargo::float8 as cargo from cobros_por_medio where pago_id = $1", [pago.pago_id])

    expect(rows).toHaveLength(2)
    expect(rows.reduce((s, r) => s + r.monto, 0)).toBe(200)
    expect(Math.round(rows.reduce((s, r) => s + r.cargo, 0) * 100)).toBe(1400)
  })

  it("al anular con reembolso se guarda el cargo a devolver, y sale de los cobros", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [conCargo("tarjeta", 115)])

    await unaFila(
      e.admin.authId,
      "select public.anular_venta($1, 'Se equivocó de producto', $2, $3) as r",
      [venta.venta_id, "reembolso_pendiente", "anular-cargo-1"]
    )

    const { rows } = await db.query("select total::float8 as total, cargo_a_devolver::float8 as cargo from anulaciones_venta where venta_id = $1", [venta.venta_id])
    const r = await medios(e.admin.authId)
    const d = await diario(e.admin.authId)

    expect(rows[0]).toEqual({ total: 115, cargo: 8.05 })
    expect(r.totales).toMatchObject({ total: 0, cargos: 0, cargos_a_devolver: 8.05 })
    expect(d.indicadores.reembolsos_pendientes).toBe(123.05)
    expect(d.indicadores.cargos_total).toBe(0)
  })

  it("los reportes cuentan el cargo aparte, y cobros_total sigue coincidiendo", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [efectivo(15), conCargo("tarjeta", 100)])
    await ventaACredito(e)
    await cobrar(e.vendedor.authId, e.clienteId, 100, [conCargo("enlace", 100)])

    const r = await medios(e.admin.authId)
    const d = await diario(e.admin.authId)

    expect(r.totales.total).toBe(d.indicadores.cobros_total)
    expect(r.totales).toMatchObject({ total: 215, cargos: 14, total_cobrado: 229 })
    expect(d.indicadores).toMatchObject({ cobros_total: 215, cargos_total: 14, total_cobrado: 229 })
    expect(r.por_medio.map((m) => [m.medio, m.monto, m.cargo, m.total_cobrado])).toEqual([
      ["efectivo", 15, 0, 15],
      ["tarjeta", 100, 7, 107],
      ["enlace", 100, 7, 107],
    ])
  })

  it("la comisión interna ya no existe", async () => {
    const { rows } = await db.query(`
      select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('comisiones_de_cobro', 'tasas_de_comision')`)
    const { rows: funciones } = await db.query(`
      select count(*)::int as n from pg_proc where proname in ('configurar_tasa_de_comision', 'anotar_comision_de_cobro', 'sembrar_tasas_de_comision')`)

    expect(rows[0].n).toBe(0)
    expect(funciones[0].n).toBe(0)
  })
})

describe("el ISV de cada venta", () => {
  const venderConIsv = (e, cobros, conIsv, { clave = null, forma = "contado", cliente = null, venc = null } = {}) =>
    unaFila(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(
         p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
         p_fecha_vencimiento => $5, p_clave_idempotencia => $6, p_con_isv => $7) as r`,
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), forma, JSON.stringify(cobros), cliente, venc, clave, conIsv]
    )
  const laVenta = async (id) =>
    (await db.query("select subtotal::float8 as subtotal, isv::float8 as isv, tasa_isv::float8 as tasa, total::float8 as total, estado from ventas where id = $1", [id])).rows[0]

  it("sin la casilla la venta queda con tasa 0, y los medios suman ese total", async () => {
    const e = await escenario()
    const venta = await venderConIsv(e, [efectivo(100)], false)

    expect(venta).toMatchObject({ total: 100, isv: 0 })
    expect(await laVenta(venta.venta_id)).toMatchObject({ subtotal: 100, isv: 0, tasa: 0, total: 100 })
  })

  it("con la casilla marcada todo sigue igual", async () => {
    const e = await escenario()
    const venta = await venderConIsv(e, [efectivo(115)], true)

    expect(await laVenta(venta.venta_id)).toMatchObject({ isv: 15, tasa: 15, total: 115 })
  })

  it("sin ISV, si los medios suman el total con ISV se rechaza y no queda nada", async () => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)
    const error = await fallo(venderConIsv(e, [efectivo(115)], false))

    expect(error.code).toBe("LM002")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
  })

  it("el cargo se calcula sobre el importe sin ISV", async () => {
    const e = await escenario()
    const venta = await venderConIsv(e, [{ medio: "tarjeta", monto: 100, referencia: "", cargo: 7 }], false)

    expect(await laVenta(venta.venta_id)).toMatchObject({ total: 100 })
    expect((await db.query("select cargo_por_medio::float8 as c from ventas where id = $1", [venta.venta_id])).rows[0].c).toBe(7)
  })

  it("a crédito sin ISV la deuda es el total sin ISV", async () => {
    const e = await escenario()
    const venta = await venderConIsv(e, [], false, { forma: "credito", cliente: e.clienteId, venc: "2030-01-01" })

    expect(await laVenta(venta.venta_id)).toMatchObject({ total: 100, estado: "pendiente" })

    const error = await fallo(cobrar(e.vendedor.authId, e.clienteId, 115, [efectivo(115)]))

    expect(error.message).toMatch(/deuda|supera/i)
  })

  it("un reintento con otra decisión de ISV se rechaza, y con la misma no duplica", async () => {
    const e = await escenario()
    const primera = await venderConIsv(e, [efectivo(100)], false, { clave: "isv-1" })
    const segunda = await venderConIsv(e, [efectivo(100)], false, { clave: "isv-1" })

    expect(segunda.repetida).toBe(true)
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect((await fallo(venderConIsv(e, [efectivo(115)], true, { clave: "isv-1" }))).code).toBe("LM005")
  })

  it("una factura fiscal no se vende sin ISV, y no gasta su número", async () => {
    const e = await escenario()

    await db.query(
      `update empresas set cai = 'A1B2C3', rango_desde = 1, rango_hasta = 1000, fecha_limite_emision = '2030-12-31' where id = $1`,
      [e.empresa]
    )
    await db.query("update ubicaciones set vende_sin_conexion = false, emite_fiscal = true where id = $1", [e.camion1])

    const antes = (await db.query("select proximo_correlativo_factura as n from empresas where id = $1", [e.empresa])).rows[0].n
    const error = await fallo(venderConIsv(e, [efectivo(100)], false))
    const despues = (await db.query("select proximo_correlativo_factura as n from empresas where id = $1", [e.empresa])).rows[0].n

    expect(error.code).toBe("LV009")
    expect(despues).toBe(antes)
  })

  it("sin conexión con tasa 0 entra sin ISV y sin conciliación, y un reintento no duplica", async () => {
    const e = await escenario()
    const venta = { ...ventaSinConexion(e), tasa_isv: 0, total_cobrado: 200 }
    const cobros = [{ medio: "tarjeta", monto: 200, referencia: "", cargo: 14 }]
    const primera = await sincronizar(e.vendedor.authId, venta, cobros)
    const segunda = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(primera).toMatchObject({ estado: "registrada", total: 200 })
    expect(segunda.estado).toBe("ya_registrada")
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect(await laVenta(primera.venta_id)).toMatchObject({ subtotal: 200, isv: 0, tasa: 0, total: 200 })
    expect((await db.query("select cargo_por_medio::float8 as c from ventas where id = $1", [primera.venta_id])).rows[0].c).toBe(14)
  })

  it("una venta sin ISV que va a conciliación se aplica sin ISV y con su cargo", async () => {
    const e = await escenario()
    const venta = { ...ventaSinConexion(e), tasa_isv: 0, total_cobrado: 200 }
    const r = await rescatar(e.admin.authId, venta, [{ medio: "enlace", monto: 200, referencia: "", cargo: 14 }])

    expect(r.estado).toBe("en_conciliacion")

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await laVenta(aplicada.venta_id)).toMatchObject({ isv: 0, total: 200 })
    expect((await db.query("select cargo_por_medio::float8 as c from ventas where id = $1", [aplicada.venta_id])).rows[0].c).toBe(14)
  })

  it("una tasa distinta de 0 y de la empresa sigue yendo a conciliación", async () => {
    const e = await escenario()
    const venta = { ...ventaSinConexion(e), tasa_isv: 10, total_cobrado: 220 }
    const r = await sincronizar(e.vendedor.authId, venta, [efectivo(220)])

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
  })

  it("una venta pendiente de una versión anterior, con ISV, sigue entrando igual", async () => {
    const e = await escenario()
    const r = await sincronizar(e.vendedor.authId, ventaSinConexion(e), [efectivo(230)])

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ tasa: 15, total: 230 })
  })

  it("quitar_isv_de_venta y cargo_de_cobro no son llamables desde la aplicación", async () => {
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('quitar_isv_de_venta', 'cargo_de_cobro', 'anotar_cargo_a_devolver')
         and has_function_privilege('authenticated', p.oid, 'execute')`)

    expect(rows).toEqual([])
  })
})

describe("ventas sin conexión", () => {
  it("una venta sincronizada guarda sus medios con la fecha en que se hizo", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const r = await sincronizar(e.vendedor.authId, venta, [efectivo(30), tarjeta(200)])

    expect(r.estado).toBe("registrada")

    const { rows } = await db.query("select fecha from cobros_por_medio where venta_id = $1", [r.venta_id])

    expect(rows.map((f) => f.fecha.toISOString())).toEqual([venta.registrada_en, venta.registrada_en])
  })

  it("la venta pendiente de un teléfono con la versión anterior sigue entrando, sin medios", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const vieja = await unaFila(
      e.vendedor.authId,
      `select public.sincronizar_venta_sin_conexion(
         p_clave_idempotencia => $1, p_usuario_auth => $2, p_ubicacion_id => $3,
         p_dispositivo => $4, p_numero_provisional => $5, p_registrada_en => $6,
         p_reloj_dispositivo => $7, p_tasa_isv => $8, p_renglones => $9::jsonb,
         p_total_cobrado => $10, p_forma_pago => $11) as r`,
      valoresSinConexion(venta, null).slice(0, 11)
    )

    expect(vieja.estado).toBe("registrada")
    expect(await cobrosDeVenta(vieja.venta_id)).toEqual([])

    const { rows } = await db.query("select to_char(($1::timestamptz at time zone 'America/Tegucigalpa')::date, 'YYYY-MM-DD') as d", [venta.registrada_en])
    const reporte = await medios(e.admin.authId, rows[0].d)

    expect(reporte.totales.sin_registrar).toBe(230)
  })

  it("reintentar no duplica los cobros, y otros medios para la misma clave se rechazan", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const primera = await sincronizar(e.vendedor.authId, venta, [efectivo(230)])
    const segunda = await sincronizar(e.vendedor.authId, venta, [efectivo(230)])

    expect(segunda.estado).toBe("ya_registrada")
    expect(await cobrosDeVenta(primera.venta_id)).toHaveLength(1)

    const error = await fallo(sincronizar(e.vendedor.authId, venta, [tarjeta(230)]))

    expect(error.code).toBe("OF003")
  })

  it("medios que no suman lo cobrado devuelven OF001 y la venta sigue en el teléfono", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const error = await fallo(sincronizar(e.vendedor.authId, venta, [efectivo(229)]))

    expect(error.code).toBe("OF001")
    expect((await db.query("select 1 from ventas where clave_idempotencia = $1", [venta.clave_idempotencia])).rows).toHaveLength(0)
  })

  it("una venta a crédito sincroniza sin medios", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e, { forma_pago: "credito", cliente_id: e.clienteId, fecha_vencimiento: "2030-01-01" })
    const r = await sincronizar(e.vendedor.authId, venta, [])

    expect(r.estado).toBe("registrada")
    expect(await cobrosDeVenta(r.venta_id)).toEqual([])
  })

  it("una a crédito con medios devuelve OF001", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e, { forma_pago: "credito", cliente_id: e.clienteId, fecha_vencimiento: "2030-01-01" })
    const error = await fallo(sincronizar(e.vendedor.authId, venta, [efectivo(230)]))

    expect(error.code).toBe("OF001")
  })

  it("en conciliación los medios no cuentan hasta aplicarla, y al aplicar conservan la fecha de la venta", async () => {
    const e = await escenario()
    const renglones = [{ producto_id: e.cargador.id, codigo: e.cargador.codigo, nombre: e.cargador.nombre, cantidad: 1, precio_unitario: 90 }]
    const venta = ventaSinConexion(e, { renglones })
    const cobros = [efectivo(3.5), tarjeta(100)]

    const r = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
    expect((await medios(e.admin.authId)).totales.total).toBe(0)

    const repetida = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(repetida.estado).toBe("ya_en_conciliacion")

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")
    const { rows } = await db.query("select fecha from cobros_por_medio where venta_id = $1", [aplicada.venta_id])

    expect(rows.map((f) => f.fecha.toISOString())).toEqual([venta.registrada_en, venta.registrada_en])

    // Después de aplicada, el reintento del teléfono no duplica nada.
    const otraVez = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(otraVez.estado).toBe("ya_registrada")
    expect(await cobrosDeVenta(aplicada.venta_id)).toHaveLength(2)
  })

  it("en conciliación, otros medios para la misma clave se rechazan", async () => {
    const e = await escenario()
    const renglones = [{ producto_id: e.cargador.id, codigo: e.cargador.codigo, nombre: e.cargador.nombre, cantidad: 1, precio_unitario: 90 }]
    const venta = ventaSinConexion(e, { renglones })

    await sincronizar(e.vendedor.authId, venta, [efectivo(103.5)])

    const error = await fallo(sincronizar(e.vendedor.authId, venta, [tarjeta(103.5)]))

    expect(error.code).toBe("OF003")
  })

  it("una conciliación anulada no genera cobros", async () => {
    const e = await escenario()
    const renglones = [{ producto_id: e.cargador.id, codigo: e.cargador.codigo, nombre: e.cargador.nombre, cantidad: 1, precio_unitario: 90 }]
    const venta = ventaSinConexion(e, { renglones })
    const r = await sincronizar(e.vendedor.authId, venta, [efectivo(103.5)])

    await conciliar(db, e.admin.authId, r.conciliacion_id, "anular")

    expect((await db.query("select 1 from cobros_por_medio where empresa_id = $1", [e.empresa])).rows).toHaveLength(0)
  })

  it("un rescate conserva los medios y los aplica al conciliar", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const r = await rescatar(e.admin.authId, venta, [transferencia(230)])

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "rescate" })

    const repetido = await rescatar(e.admin.authId, venta, [transferencia(230)])

    expect(repetido.estado).toBe("ya_en_conciliacion")

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect((await cobrosDeVenta(aplicada.venta_id)).map((c) => c.medio)).toEqual(["transferencia"])
  })

  it("un rescate con medios inválidos u otros medios se rechaza, y queda auditado", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)

    expect(await rescatar(e.admin.authId, venta, [efectivo(1)])).toMatchObject({ estado: "rechazado", codigo: "OF001" })

    await rescatar(e.admin.authId, venta, [efectivo(230)])

    expect(await rescatar(e.admin.authId, venta, [tarjeta(230)])).toMatchObject({ estado: "rechazado", codigo: "OF003" })

    const { rows } = await db.query(
      "select codigo from auditoria_rescates where clave = $1 and resultado = 'rechazado' order by id",
      [venta.clave_idempotencia]
    )

    expect(rows.map((f) => f.codigo)).toEqual(["OF001", "OF003"])
  })

  it("un vendedor no puede rescatar", async () => {
    const e = await escenario()
    const error = await fallo(rescatar(e.vendedor.authId, ventaSinConexion(e), [efectivo(230)]))

    expect(error.code).toBe("42501")
  })

  it("la venta de otro usuario sigue siendo OF002", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)
    const error = await fallo(sincronizar(e.admin.authId, venta, [efectivo(230)]))

    expect(error.code).toBe("OF002")
  })
})

describe("anulaciones", () => {
  const anular = (authId, ventaId, tratamiento = "reembolso_pendiente") =>
    como(authId, "select public.anular_venta($1, 'Error al registrar la venta', $2)", [ventaId, tratamiento])

  it("una venta anulada sale de los cobros y conserva sus registros", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [efectivo(115)])

    const venta = await vender(e, e.vendedor.authId, [tarjeta(115)])

    await anular(e.admin.authId, venta.venta_id)

    expect(await cobrosDeVenta(venta.venta_id)).toHaveLength(1)

    const r = await medios(e.admin.authId)

    expect(r.totales).toMatchObject({ total: 115, registrado: 115, cargos: 0, total_cobrado: 115, cargos_a_devolver: 0 })
    expect(r.por_medio.map((m) => m.medio)).toEqual(["efectivo"])

    // El detalle sigue diciendo con qué se había cobrado.
    expect(r.por_venta[venta.venta_id]).toEqual([{ medio: "tarjeta", monto: 115, cargo: 0, referencia: "AUT-1" }])

    const { anulaciones } = await diario(e.admin.authId)

    expect(r.por_anulacion[anulaciones[0].id]).toEqual([{ medio: "tarjeta", monto: 115, cargo: 0, referencia: "AUT-1" }])
  })

  it("los medios no impiden anular, y devolver la mercadería sigue funcionando", async () => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)
    const venta = await vender(e, e.vendedor.authId, [efectivo(115)])

    await anular(e.admin.authId, venta.venta_id)

    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
  })
})

describe("el reporte", () => {
  it("coincide siempre con los cobros de reporte_diario, también con ventas e históricos sin medios", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, [efectivo(15), tarjeta(100)])
    await unaFila(
      e.vendedor.authId,
      "select public.registrar_venta_ubicacion(p_items => $1::jsonb, p_forma_pago => 'contado') as r",
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }])]
    )
    await ventaACredito(e)
    await cobrar(e.vendedor.authId, e.clienteId, 100, [enlace(100)])
    await unaFila(e.vendedor.authId, "select public.registrar_pago_cliente($1, 30) as r", [e.clienteId])

    const r = await medios(e.admin.authId)
    const d = await diario(e.admin.authId)

    expect(r.totales.total).toBe(d.indicadores.cobros_total)
    expect(r.totales).toMatchObject({ total: 360, registrado: 215, sin_registrar: 145, cargos: 0, total_cobrado: 360 })
    expect(r.por_medio.map((m) => [m.medio, m.monto, m.cargo, m.total_cobrado])).toEqual([
      ["efectivo", 15, 0, 15],
      ["tarjeta", 100, 0, 100],
      ["enlace", 100, 0, 100],
      ["sin_registrar", 145, 0, 145],
    ])
  })

  it("filtra por ubicación, y cada una coincide con su fila de reporte_diario", async () => {
    const e = await escenario()
    const vendedor2 = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })

    await vender(e, e.vendedor.authId, [efectivo(115)])
    await vender(e, vendedor2.authId, [tarjeta(115)])

    const uno = await medios(e.admin.authId, null, e.camion1)
    const dos = await medios(e.admin.authId, null, e.camion2)

    expect(uno.por_medio.map((m) => m.medio)).toEqual(["efectivo"])
    expect(dos.por_medio.map((m) => m.medio)).toEqual(["tarjeta"])
    expect(uno.por_ubicacion).toEqual([expect.objectContaining({ ubicacion: "Camión 01", efectivo: 115, total: 115 })])
    expect(uno.totales.total).toBe((await diario(e.admin.authId, null, e.camion1)).indicadores.cobros_total)
    expect(dos.totales.total).toBe((await diario(e.admin.authId, null, e.camion2)).indicadores.cobros_total)
  })

  it("corta el día en la medianoche de Honduras", async () => {
    const e = await escenario()
    const ayer = await vender(e, e.vendedor.authId, [efectivo(115)])
    const hoy = await vender(e, e.vendedor.authId, [efectivo(115)])

    await db.query("update ventas set fecha = '2026-03-10T05:59:59Z' where id = $1", [ayer.venta_id])
    await db.query("update ventas set fecha = '2026-03-10T06:00:00Z' where id = $1", [hoy.venta_id])

    expect((await medios(e.admin.authId, "2026-03-09")).totales.total).toBe(115)
    expect((await medios(e.admin.authId, "2026-03-10")).totales.total).toBe(115)
  })

  it("un día sin cobros responde en cero, sin fallar", async () => {
    const e = await escenario()
    const r = await medios(e.admin.authId, "2020-01-01")

    expect(r).toEqual({
      totales: { total: 0, registrado: 0, sin_registrar: 0, cargos: 0, total_cobrado: 0, cargos_a_devolver: 0 },
      por_medio: [], por_ubicacion: [], por_venta: {}, por_abono: {}, por_anulacion: {},
    })
  })

  it("el detalle de un abono dice con qué medios se pagó", async () => {
    const e = await escenario()

    await ventaACredito(e)
    await cobrar(e.vendedor.authId, e.clienteId, 100, [efectivo(40), tarjeta(60)])

    const r = await medios(e.admin.authId)
    const { abonos } = await diario(e.admin.authId)

    expect(r.por_abono[abonos[0].id]).toEqual([
      { medio: "efectivo", monto: 40, cargo: 0, referencia: "" },
      { medio: "tarjeta", monto: 60, cargo: 0, referencia: "AUT-1" },
    ])
  })
})

describe("seguridad", () => {
  async function conUnaVentaConTarjeta() {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [tarjeta(115)])
    const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos", "sales-history"] })

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

    return { e, venta, contador }
  }

  const TABLAS = ["cobros_por_medio", "cobros_por_conciliar"]

  it("el vendedor y el contador no leen los cobros", async () => {
    const { e, contador } = await conUnaVentaConTarjeta()

    for (const authId of [e.vendedor.authId, contador.authId]) {
      for (const tabla of TABLAS) {
        const { rows } = await como(authId, `select * from public.${tabla}`)

        expect(rows).toEqual([])
      }
    }
  })

  it("el administrador lee las de su empresa y no las de otra", async () => {
    const { e } = await conUnaVentaConTarjeta()
    const otra = await crearEmpresa(db, "Otra empresa")

    expect((await como(e.admin.authId, "select * from public.cobros_por_medio")).rows).toHaveLength(1)
    expect((await como(otra.authId, "select * from public.cobros_por_medio")).rows).toEqual([])
    expect((await medios(otra.authId)).totales.total).toBe(0)
  })

  it("el reporte rechaza a vendedor y contador, y anon no lo ejecuta", async () => {
    const { e, contador } = await conUnaVentaConTarjeta()

    expect((await fallo(medios(e.vendedor.authId))).code).toBe("42501")
    expect((await fallo(medios(contador.authId))).code).toBe("42501")

    const { rows } = await db.query("select has_function_privilege('anon', 'public.reporte_medios_de_pago(date, uuid)', 'execute') as puede")

    expect(rows[0].puede).toBe(false)
  })

  it("el contador no vende ni cobra por las funciones nuevas", async () => {
    const { e, contador } = await conUnaVentaConTarjeta()

    // Con deuda real: sin ella, el cobro se rechaza antes de intentar escribir.
    await ventaACredito(e)

    expect((await fallo(vender(e, contador.authId, [efectivo(115)]))).code).toBe("42501")
    expect((await fallo(cobrar(contador.authId, e.clienteId, 10, [efectivo(10)]))).code).toBe("42501")
  })

  it.each(TABLAS)("nadie de la aplicación escribe en %s directamente", async (tabla) => {
    const { e } = await conUnaVentaConTarjeta()

    for (const authId of [e.admin.authId, e.vendedor.authId]) {
      const insertar = await fallo(como(authId, `insert into public.${tabla} default values`))

      expect(insertar.code).toBe("42501")
    }
  })

  it.each(TABLAS)("%s tiene el bloqueo del contador", async (tabla) => {
    const { rows } = await db.query(
      `select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname = $1 and t.tgname = 'impedir_escritura_del_contador'`,
      [tabla]
    )

    expect(rows).toHaveLength(1)
  })

  it("ni el dueño cambia, borra ni vacía un cobro", async () => {
    const { venta } = await conUnaVentaConTarjeta()

    expect((await fallo(db.query("update cobros_por_medio set monto = 1 where venta_id = $1", [venta.venta_id]))).code).toBe("42501")
    expect((await fallo(db.query("delete from cobros_por_medio where venta_id = $1", [venta.venta_id]))).code).toBe("42501")
    expect((await fallo(db.query("truncate cobros_por_medio cascade"))).code).toBe("42501")
  })

  it("las piezas internas no son llamables desde la aplicación", async () => {
    const { rows } = await db.query(`
      select p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('guardar_cobros_de_venta', 'guardar_cobros_de_pago', 'guardar_cobros_sin_conexion',
                           'cobros_guardados', 'aplicar_cobros_de_conciliacion')
         and has_function_privilege('authenticated', p.oid, 'execute')`)

    expect(rows).toEqual([])
  })

  it("anon no ejecuta ninguna de las funciones nuevas", async () => {
    const { rows } = await db.query(`
      select p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('registrar_venta_con_medios', 'registrar_pago_con_medios', 'sincronizar_venta_con_medios',
                           'rescatar_venta_con_medios', 'reporte_medios_de_pago')
         and has_function_privilege('anon', p.oid, 'execute')`)

    expect(rows).toEqual([])
  })

  it("el reporte no expone costos", async () => {
    const { e } = await conUnaVentaConTarjeta()

    expect(JSON.stringify(await medios(e.admin.authId))).not.toMatch(/costo|margen|utilidad/i)
  })
})

describe("la migración", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0039_medios_de_pago.sql", import.meta.url), "utf8")

  it("no escribe en ventas, abonos, pagos, inventario ni correlativos", () => {
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+(public\.)?(ventas|detalle_venta|abonos|pagos|inventario_ubicacion|movimientos_inventario|productos|clientes|empresas|permisos_usuario)\b/i)
    expect(sql).not.toMatch(/productos\.costo|\.costo\b/i)
  })

  it("se puede aplicar dos veces, y no inventa medios para lo que ya existe", async () => {
    const e = await escenario()
    const vieja = await unaFila(
      e.vendedor.authId,
      "select public.registrar_venta_ubicacion(p_items => $1::jsonb, p_forma_pago => 'contado') as r",
      [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }])]
    )
    await db.query(readFileSync(new URL("../supabase/migrations/0041_cargo_e_isv_por_venta.sql", import.meta.url), "utf8"))

    expect(await cobrosDeVenta(vieja.venta_id)).toEqual([])
  })
})
