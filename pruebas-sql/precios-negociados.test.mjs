/*
  0043 contra PostgreSQL de verdad: precios negociados durante una venta.

  Las ventas se hacen con las funciones que usa la aplicación. El cargador vale 100 de
  precio general, lleva 15 % de ISV y el cliente A lo tiene a 80.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { crearCliente, crearVendedor } from "./fixtures.mjs"
import {
  conciliar,
  correlativoInterno,
  escenarioSinConexion,
  existencia,
  fallo,
  sincronizar,
  totalDe,
  ventaSinConexion,
} from "./escenario-sin-conexion.mjs"

// Una sola base para todo el archivo: cada prueba arma su propia empresa.
let db
let cerrarBase = async () => {}

beforeAll(async () => {
  const base = await levantarBase()

  db = base.admin
  cerrarBase = () => base.cerrar()
}, 180000)

afterAll(() => cerrarBase())

const como = (authId, consulta, valores = []) => consultarComo(db, authId, consulta, valores)

const unaFila = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0].r

const guardarPrecios = (authId, cliente, precios) =>
  como(authId, "select public.guardar_precios_de_cliente($1, $2::jsonb) as r", [cliente, JSON.stringify(precios)])

const negociado = (e, precio, motivo = "mayoreo", cantidad = 1) => ({
  producto_id: e.cargador.id,
  cantidad,
  precio_negociado: precio,
  motivo_negociacion: motivo,
})

const vender = (authId, items, cobros, { cliente = null, forma = "contado", clave = null, venc = null, conIsv = true } = {}) =>
  unaFila(
    authId,
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
       p_fecha_vencimiento => $5, p_clave_idempotencia => $6, p_con_isv => $7) as r`,
    [JSON.stringify(items), forma, JSON.stringify(cobros), cliente, venc, clave, conIsv]
  )

const efectivo = (monto) => ({ medio: "efectivo", monto })

const laVenta = async (id) =>
  (
    await db.query(
      `select v.subtotal::float8 as subtotal, v.isv::float8 as isv, v.total::float8 as total,
              v.cargo_por_medio::float8 as cargo, d.precio::float8 as precio, d.subtotal::float8 as linea,
              d.precio_referencia::float8 as referencia, d.negociado_por, d.negociado_por_nombre as por,
              d.negociado_en, d.motivo_negociacion as motivo
         from ventas v join detalle_venta d on d.venta_id = v.id where v.id = $1`,
      [id]
    )
  ).rows[0]

const precioGeneral = async (e) => Number((await db.query("select precio from productos where id = $1", [e.cargador.id])).rows[0].precio)

const precioEspecial = async (e) =>
  Number((await db.query("select precio from precios_por_cliente where cliente_id = $1 and producto_id = $2", [e.clienteA, e.cargador.id])).rows[0].precio)

async function escenario() {
  const e = await escenarioSinConexion(db, { enCamion1: 100 })
  const nombre = (await db.query("select id, nombre from usuarios where auth_id = $1", [e.vendedor.authId])).rows[0]

  await guardarPrecios(e.admin.authId, e.clienteId, [{ producto_id: e.cargador.id, precio: 80 }])

  return { ...e, clienteA: e.clienteId, vendedorId: nombre.id, vendedorNombre: nombre.nombre }
}

describe("negociar en línea", () => {
  it("sobre el precio general: aplica lo negociado y guarda su trazabilidad", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)])
    const v = await laVenta(r.venta_id)

    expect(r).toMatchObject({ subtotal: 60, isv: 9, total: 69 })
    expect(v).toMatchObject({ precio: 60, linea: 60, subtotal: 60, isv: 9, total: 69, referencia: 100, motivo: "mayoreo" })
    expect(v.negociado_por).toBe(e.vendedorId)
    expect(v.por).toBe(e.vendedorNombre)
    expect(Math.abs(new Date(v.negociado_en).getTime() - Date.now())).toBeLessThan(60000)
    expect(await precioGeneral(e)).toBe(100)
  })

  it("sobre el precio especial: la referencia es el especial, y ambos precios permanentes siguen iguales", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 70)], [efectivo(80.5)], { cliente: e.clienteA })

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 70, total: 80.5, referencia: 80 })
    expect(await precioGeneral(e)).toBe(100)
    expect(await precioEspecial(e)).toBe(80)

    const siguiente = await vender(e.vendedor.authId, [{ producto_id: e.cargador.id, cantidad: 1 }], [efectivo(92)], { cliente: e.clienteA })

    expect(await laVenta(siguiente.venta_id)).toMatchObject({ precio: 80, referencia: null, por: null, motivo: null })
  })

  it("el administrador también negocia, y queda su nombre", async () => {
    const e = await escenario()

    await db.query("update usuarios set ubicacion_id = $1 where auth_id = $2", [e.camion1, e.admin.authId])

    const r = await vender(e.admin.authId, [negociado(e, 50)], [efectivo(57.5)])
    const { nombre } = (await db.query("select nombre from usuarios where auth_id = $1", [e.admin.authId])).rows[0]

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 50, por: nombre })
  })

  it("subir el precio no pide motivo; bajarlo sí", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 130, null)], [efectivo(149.5)])

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 130, referencia: 100, motivo: null })
    expect((await fallo(vender(e.vendedor.authId, [negociado(e, 60, null)], [efectivo(69)]))).code).toBe("LN001")
  })

  it("un precio igual al de referencia no deja rastro de negociación", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 100, null)], [efectivo(115)])

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 100, referencia: null, por: null })
  })

  it("con cantidad: redondea por línea y calcula el ISV sobre el subtotal", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 33.33, "promocion", 3)], [efectivo(114.99)])

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 33.33, linea: 99.99, subtotal: 99.99, isv: 15, total: 114.99 })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(97)
  })

  it("una línea negociada convive con otra normal", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60), { producto_id: e.cubo.id, cantidad: 1 }], [efectivo(126.5)])
    const lineas = (await db.query("select producto_id, precio::float8 as precio, precio_referencia from detalle_venta where venta_id = $1", [r.venta_id])).rows

    expect(lineas.find((l) => l.producto_id === e.cargador.id)).toMatchObject({ precio: 60 })
    expect(lineas.find((l) => l.producto_id === e.cubo.id)).toMatchObject({ precio: 50, precio_referencia: null })
  })

  it.each([
    ["cero", 0],
    ["negativo", -5],
    ["no numérico", "barato"],
    ["texto NaN", "NaN"],
    ["más de dos decimales", 10.123],
    ["demasiado grande", 99999999999],
  ])("rechaza un precio %s sin descontar ni gastar correlativo", async (_, precio) => {
    const e = await escenario()
    const stock = await existencia(db, e.camion1, e.cargador.id)
    const correlativo = await correlativoInterno(db, e.empresa)
    const error = await fallo(vender(e.vendedor.authId, [negociado(e, precio)], [efectivo(10)]))

    expect(error.code).toBe("LN001")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
    expect(await correlativoInterno(db, e.empresa)).toBe(correlativo)
    expect(Number((await db.query("select count(*) as n from ventas where empresa_id = $1", [e.empresa])).rows[0].n)).toBe(0)
  })

  it("rechaza un motivo fuera de la lista y un producto repetido", async () => {
    const e = await escenario()

    expect((await fallo(vender(e.vendedor.authId, [negociado(e, 60, "porque si")], [efectivo(69)]))).code).toBe("LN001")
    expect(
      (await fallo(vender(e.vendedor.authId, [negociado(e, 60), { producto_id: e.cargador.id, cantidad: 1 }], [efectivo(184)]))).code
    ).toBe("LN001")
  })
})

describe("el flujo autorizado", () => {
  it("un precio enviado directo a registrar_venta_ubicacion se ignora", async () => {
    const e = await escenario()
    const r = await unaFila(e.vendedor.authId, "select public.registrar_venta_ubicacion($1::jsonb, 'contado') as r", [
      JSON.stringify([negociado(e, 1)]),
    ])

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 100, total: 115, referencia: null })
  })

  it("el servidor decide: si los medios suman otra cosa, rechaza y no descuenta", async () => {
    const e = await escenario()
    const stock = await existencia(db, e.camion1, e.cargador.id)

    expect((await fallo(vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(115)]))).code).toBe("LM002")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
  })

  it("quien no tiene permiso de facturar no negocia, y su venta no queda a medias", async () => {
    const e = await escenario()
    const sinPos = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["clients"] })
    const stock = await existencia(db, e.camion1, e.cargador.id)

    expect((await fallo(vender(sinPos.authId, [negociado(e, 60)], [efectivo(69)]))).code).toBe("42501")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
  })

  it("el contador no negocia, aunque tenga la marca de facturar", async () => {
    const e = await escenario()
    const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos"] })

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

    expect((await fallo(vender(contador.authId, [negociado(e, 60)], [efectivo(69)]))).code).toBe("42501")
  })

  it("nadie cambia un renglón a mano ni llama a las piezas internas", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)])

    for (const authId of [e.vendedor.authId, e.admin.authId]) {
      expect((await fallo(como(authId, "update public.detalle_venta set precio = 1 where venta_id = $1", [r.venta_id]))).code).toBe("42501")
      expect(
        (await fallo(como(authId, "select public.aplicar_precios_negociados($1, '[]'::jsonb)", [r.venta_id]))).code
      ).toBe("42501")
    }

    const { rows } = await db.query(`
      select has_function_privilege('authenticated', 'public.aplicar_precios_negociados(uuid, jsonb, boolean, timestamptz)', 'execute') as aplicar,
             has_function_privilege('authenticated', 'public.negociacion_distinta(uuid, jsonb)', 'execute') as distinta,
             has_function_privilege('anon', 'public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text, boolean)', 'execute') as anon`)

    expect(rows[0]).toEqual({ aplicar: false, distinta: false, anon: false })
  })

  it("la trazabilidad no incluye costos", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)])
    const { rows } = await como(e.vendedor.authId, "select * from public.detalle_venta where venta_id = $1", [r.venta_id])

    expect(Object.keys(rows[0]).join()).not.toMatch(/costo|margen/i)
  })
})

describe("con las fases anteriores", () => {
  it("el cargo del 7 % y el pago mixto se calculan sobre lo negociado", async () => {
    const e = await escenario()
    const tarjeta = await vender(e.vendedor.authId, [negociado(e, 60)], [{ medio: "tarjeta", monto: 69, referencia: "", cargo: 4.83 }])
    const mixto = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(19), { medio: "enlace", monto: 50, referencia: "", cargo: 3.5 }])

    expect(await laVenta(tarjeta.venta_id)).toMatchObject({ total: 69, cargo: 4.83 })
    expect(await laVenta(mixto.venta_id)).toMatchObject({ total: 69, cargo: 3.5 })

    // Un cargo calculado sobre el precio anterior se rechaza.
    expect(
      (await fallo(vender(e.vendedor.authId, [negociado(e, 60)], [{ medio: "tarjeta", monto: 69, referencia: "", cargo: 8.05 }]))).code
    ).toBe("LM001")
  })

  it("el ISV sigue la casilla", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(60)], { conIsv: false })

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 60, subtotal: 60, isv: 0, total: 60 })
  })

  it("a crédito la deuda es lo negociado, y el abono la cubre", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 70)], [], { cliente: e.clienteA, forma: "credito", venc: "2030-01-01" })

    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 70, total: 80.5 })

    const pago = await unaFila(
      e.admin.authId,
      "select public.registrar_pago_con_medios(p_cliente_id => $1, p_monto => 80.5, p_cobros => $2::jsonb) as r",
      [e.clienteA, JSON.stringify([efectivo(80.5)])]
    )

    expect(pago.pago_id).toBeTruthy()
    expect((await db.query("select estado from ventas where id = $1", [r.venta_id])).rows[0].estado).toBe("pagada")
  })

  it("la anulación devuelve la existencia y conserva el precio vendido", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)])
    const stock = await existencia(db, e.camion1, e.cargador.id)

    await como(e.admin.authId, "select public.anular_venta($1, $2, $3, $4)", [r.venta_id, "Prueba de anulación negociada", "reembolso_pendiente", "anula-negociada"])

    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock + 1)
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 60, total: 69, referencia: 100 })
  })

  it("un reintento devuelve la misma venta; con otro precio se rechaza", async () => {
    const e = await escenario()
    const primera = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)], { clave: "neg-1" })
    const stock = await existencia(db, e.camion1, e.cargador.id)
    const segunda = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)], { clave: "neg-1" })

    expect(segunda).toMatchObject({ venta_id: primera.venta_id, repetida: true, total: 69 })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
    expect((await fallo(vender(e.vendedor.authId, [negociado(e, 50)], [efectivo(57.5)], { clave: "neg-1" }))).code).toBe("LM005")
    expect(
      (await fallo(vender(e.vendedor.authId, [{ producto_id: e.cargador.id, cantidad: 1 }], [efectivo(69)], { clave: "neg-1" }))).code
    ).toBe("LM005")
  })

  it("cambiar los precios permanentes no toca una venta negociada", async () => {
    const e = await escenario()
    const r = await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)], { cliente: e.clienteA })
    const antes = await laVenta(r.venta_id)

    await guardarPrecios(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 10 }])
    await db.query("update productos set precio = 999 where id = $1", [e.cargador.id])

    expect(await laVenta(r.venta_id)).toEqual(antes)
  })

  it("el reporte diario suma lo negociado, no el precio de catálogo", async () => {
    const e = await escenario()

    await vender(e.vendedor.authId, [negociado(e, 60)], [efectivo(69)])

    const reporte = await unaFila(e.admin.authId, "select public.reporte_diario() as r")

    expect(JSON.stringify(reporte)).toContain("69")
    expect(JSON.stringify(reporte)).not.toContain("115")
  })
})

describe("ventas sin conexión", () => {
  const renglon = (e, precio, extra = {}) => ({
    producto_id: e.cargador.id,
    codigo: e.cargador.codigo,
    nombre: e.cargador.nombre,
    cantidad: 1,
    precio_unitario: precio,
    ...extra,
  })

  const negociadoLocal = (e, precio, referencia = 100, motivo = "mayoreo") =>
    renglon(e, precio, { negociado: true, precio_referencia: referencia, motivo_negociacion: motivo })

  const ventaDe = (e, renglones, cambios = {}) =>
    ventaSinConexion(e, { renglones, total_cobrado: totalDe(renglones, cambios.tasa_isv ?? e.tasa), ...cambios })

  it("entra como registrada, con lo cobrado y quién y cuándo lo negoció", async () => {
    const e = await escenario()
    const venta = ventaDe(e, [negociadoLocal(e, 60)])
    const r = await sincronizar(db, e.vendedor.authId, venta)
    const v = await laVenta(r.venta_id)

    expect(r.estado).toBe("registrada")
    expect(v).toMatchObject({ precio: 60, total: 69, referencia: 100, motivo: "mayoreo", por: e.vendedorNombre })
    expect(new Date(v.negociado_en).getTime()).toBe(new Date(venta.registrada_en).getTime())
  })

  it("un cambio posterior del precio general o especial no altera la venta pendiente", async () => {
    const e = await escenario()
    const venta = ventaDe(e, [negociadoLocal(e, 70, 80)], { cliente_id: e.clienteA })

    await guardarPrecios(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 40 }])
    await db.query("update productos set precio = 500 where id = $1", [e.cargador.id])

    const r = await sincronizar(db, e.vendedor.authId, venta)

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 70, total: 80.5, referencia: 80 })
  })

  it("un reintento no duplica ni vuelve a descontar", async () => {
    const e = await escenario()
    const venta = ventaDe(e, [negociadoLocal(e, 60)])
    const primera = await sincronizar(db, e.vendedor.authId, venta)
    const stock = await existencia(db, e.camion1, e.cargador.id)
    const segunda = await sincronizar(db, e.vendedor.authId, venta)

    expect(segunda).toMatchObject({ estado: "ya_registrada", venta_id: primera.venta_id })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
  })

  it("sin la marca de negociado, un precio alterado sigue yendo a conciliación", async () => {
    const e = await escenario()
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [renglon(e, 1)]))

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
  })

  it.each([
    ["en cero", (e) => negociadoLocal(e, 0)],
    ["sin motivo al bajar", (e) => negociadoLocal(e, 60, 100, null)],
    ["con un motivo inventado", (e) => negociadoLocal(e, 60, 100, "porque si")],
  ])("un precio negociado %s va a conciliación y no se pierde", async (_, armar) => {
    const e = await escenario()
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [armar(e)]))

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
    expect(Number((await db.query("select count(*) as n from ventas where empresa_id = $1", [e.empresa])).rows[0].n)).toBe(0)
  })

  it("quien ya no puede facturar va a conciliación", async () => {
    const e = await escenario()

    await db.query("delete from permisos_usuario where usuario_id = $1", [e.vendedorId])

    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [negociadoLocal(e, 60)]))

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "sin-permiso" })
  })

  it("no se puede enviar a nombre de otro vendedor", async () => {
    const e = await escenario()
    const error = await fallo(sincronizar(db, e.admin.authId, ventaDe(e, [negociadoLocal(e, 60)])))

    expect(error.code).toBe("OF002")
  })

  it("al conciliar conserva lo cobrado y la trazabilidad del vendedor", async () => {
    const e = await escenario()

    await db.query("delete from permisos_usuario where usuario_id = $1", [e.vendedorId])

    const venta = ventaDe(e, [negociadoLocal(e, 60)])
    const r = await sincronizar(db, e.vendedor.authId, venta)
    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")
    const v = await laVenta(aplicada.venta_id)

    expect(v).toMatchObject({ precio: 60, total: 69, referencia: 100, motivo: "mayoreo", por: e.vendedorNombre })
    expect(new Date(v.negociado_en).getTime()).toBe(new Date(venta.registrada_en).getTime())
  })

  it("al conciliar datos no válidos, conserva lo cobrado y no guarda el motivo inventado", async () => {
    const e = await escenario()
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [renglon(e, 60, { negociado: true, precio_referencia: "x", motivo_negociacion: "porque si" })]))
    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await laVenta(aplicada.venta_id)).toMatchObject({ precio: 60, total: 69, referencia: 60, motivo: null })
  })

  it("una conciliación sin negociación no deja rastro", async () => {
    const e = await escenario()
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [renglon(e, 1)]))
    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await laVenta(aplicada.venta_id)).toMatchObject({ precio: 1, referencia: null, por: null })
  })

  it("sin ISV entra con tasa 0 sobre lo negociado", async () => {
    const e = await escenario()
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [negociadoLocal(e, 60)], { tasa_isv: 0 }))

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 60, isv: 0, total: 60 })
  })

  it("una venta anterior a esta versión, con el precio vigente, entra igual", async () => {
    const e = await escenario()
    const clienteB = await crearCliente(db, e.empresa, "Cliente B")
    const r = await sincronizar(db, e.vendedor.authId, ventaDe(e, [renglon(e, 100)], { cliente_id: clienteB }))

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 100, referencia: null })
  })
})
