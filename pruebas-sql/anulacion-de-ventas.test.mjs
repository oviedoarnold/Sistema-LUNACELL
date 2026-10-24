/*
  A-5: anulación de ventas, contra PostgreSQL real.

  Lo que se afirma aquí:
  - la venta conserva su número y todo lo demás; pasa a «anulada», la
    mercadería vuelve UNA vez a la ubicación de la venta y queda un
    registro inmutable de quién, cuándo y por qué;
  - el administrador anula en cualquier ubicación de su empresa y sin
    plazo; el vendedor, con sales-history y sales-void, solo en su
    ubicación ACTUAL y el mismo día en hora de Honduras;
  - no se anulan facturas fiscales, ventas con abonos, ventas antiguas sin
    ubicación ni —por un vendedor— ventas de conciliación;
  - los correlativos no se mueven, una venta anulada no revive y una
    resincronización sin conexión no la duplica ni la reactiva;
  - dos anulaciones, o un cobro y una anulación, se esperan una a la otra.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones } from "./arnes.mjs"
import { crearVendedor, crearFactura, deudaDe, contar } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  conciliar,
  fallo,
  existencia,
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

const MOTIVO = "Se registró dos veces por error"

/*
  El escenario de las ventas sin conexión (Camión 01 con 10 cargadores,
  Camión 02 con 20, un vendedor del Camión 01 que solo factura) más un
  vendedor del Camión 01 que además puede ver el historial y anular.
*/
async function escenario(opciones) {
  const esc = await escenarioSinConexion(db, opciones)
  const anulador = await crearVendedor(db, {
    empresa: esc.empresa,
    ubicacion: esc.camion1,
    permisos: ["pos", "sales-history", "sales-void"],
  })

  return { ...esc, anulador }
}

const vender = async (authId, producto, { cantidad = 2, forma = "contado", cliente = null } = {}) =>
  (
    await consultarComo(db, authId, "select registrar_venta_ubicacion($1::jsonb, $2, $3) as r", [
      JSON.stringify([{ producto_id: producto.id, cantidad }]),
      forma,
      cliente,
    ])
  ).rows[0].r.venta_id

const anular = async (authId, ventaId, { motivo = MOTIVO, tratamiento = null, clave = null } = {}) =>
  (
    await consultarComo(db, authId, "select anular_venta($1, $2, $3, $4) as r", [ventaId, motivo, tratamiento, clave])
  ).rows[0].r

const pagar = async (authId, clienteId, monto) =>
  (await consultarComo(db, authId, "select registrar_pago_cliente($1, $2) as r", [clienteId, monto])).rows[0].r

const venta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const anulacionDe = async (id) => (await db.query("select * from anulaciones_venta where venta_id = $1", [id])).rows[0]
const movimientosDeAnulacion = async (id) =>
  (
    await db.query(
      "select producto_id, ubicacion_id, cantidad, usuario_id from movimientos_inventario where venta_id = $1 and tipo = 'anulacion_venta'",
      [id]
    )
  ).rows

const contadores = async (empresa) =>
  (
    await db.query(
      "select proximo_correlativo_factura as f, proximo_correlativo_interno as i, proximo_correlativo_cotizacion as c from empresas where id = $1",
      [empresa]
    )
  ).rows[0]

/* Lo que una anulación rechazada no puede haber tocado. */
async function nadaCambio(e, ventaId, existenciaAntes) {
  expect((await venta(ventaId)).estado).not.toBe("anulada")
  expect(await anulacionDe(ventaId)).toBeUndefined()
  expect(await movimientosDeAnulacion(ventaId)).toEqual([])
  expect(await existencia(db, e.camion1, e.cargador.id)).toBe(existenciaAntes)
}

/* Una hora concreta de hoy (o de otro día) en Honduras, como timestamptz. */
const horaDeHonduras = async (dias, hora) =>
  (
    await db.query(
      `select ((date_trunc('day', now() at time zone 'America/Tegucigalpa') + make_interval(days => $1) + $2::interval)
               at time zone 'America/Tegucigalpa') as t`,
      [dias, hora]
    )
  ).rows[0].t

describe("anular una venta de contado", () => {
  it("1. el vendedor con los dos permisos la anula: estado, existencia, movimiento y registro", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    const antes = await venta(id)
    const correlativos = await contadores(e.empresa)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(8)

    const r = await anular(e.anulador.authId, id, { motivo: `   ${MOTIVO}   ` })

    expect(r).toMatchObject({ estado: "anulada", venta_id: id, numero_factura: antes.numero_factura, tratamiento_dinero: "reembolso_pendiente" })
    const despues = await venta(id)
    expect(despues.estado).toBe("anulada")
    expect([despues.numero_factura, despues.correlativo, despues.total, despues.fecha, despues.nombre_cliente]).toEqual([
      antes.numero_factura,
      antes.correlativo,
      antes.total,
      antes.fecha,
      antes.nombre_cliente,
    ])
    expect(await contar(db, "detalle_venta", "venta_id = $1", [id])).toBe(1)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
    expect(await movimientosDeAnulacion(id)).toEqual([
      { producto_id: e.cargador.id, ubicacion_id: e.camion1, cantidad: 2, usuario_id: e.anulador.usuario },
    ])
    expect(await contadores(e.empresa)).toEqual(correlativos)

    const a = await anulacionDe(id)
    const nombre = (await db.query("select nombre from usuarios where id = $1", [e.anulador.usuario])).rows[0].nombre
    expect(a).toMatchObject({
      empresa_id: e.empresa,
      numero_documento: antes.numero_factura,
      estado_anterior: "pagada",
      forma_pago: "contado",
      ubicacion_venta: e.camion1,
      usuario_id: e.anulador.usuario,
      usuario_nombre: nombre,
      usuario_rol: "vendedor",
      ubicacion_usuario: e.camion1,
      motivo: MOTIVO,
      tratamiento_dinero: "reembolso_pendiente",
    })
    expect(Number(a.saldo_cancelado)).toBe(0)
    expect(a.movimientos).toHaveLength(1)
    expect(a.anulada_en).toBeInstanceOf(Date)
  })

  it("2. guarda «no se cobró» si se elige, y rechaza un tratamiento desconocido", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)

    expect((await fallo(anular(e.anulador.authId, id, { tratamiento: "reembolsado" }))).code).toBe("AV001")
    await nadaCambio(e, id, 8)

    await anular(e.anulador.authId, id, { tratamiento: "no_cobrado" })
    expect((await anulacionDe(id)).tratamiento_dinero).toBe("no_cobrado")
  })

  it("3. el motivo necesita 10 caracteres sin contar los espacios de los extremos", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)

    expect((await fallo(anular(e.anulador.authId, id, { motivo: "123456789" }))).code).toBe("AV001")
    expect((await fallo(anular(e.anulador.authId, id, { motivo: "   123456789    " }))).code).toBe("AV001")
    expect((await fallo(anular(e.anulador.authId, id, { motivo: null }))).code).toBe("AV001")
    await nadaCambio(e, id, 8)

    await anular(e.anulador.authId, id, { motivo: "  1234567890 " })
    expect((await anulacionDe(id)).motivo).toBe("1234567890")
  })
})

describe("anular una venta a crédito", () => {
  it("4. sin abonos: la deuda desaparece, el stock vuelve y no se toca ningún pago", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador, { forma: "credito", cliente: e.clienteId })
    expect(await deudaDe(db, e.clienteId)).toBe(230)
    const pagos = await contar(db, "pagos", "empresa_id = $1", [e.empresa])

    const r = await anular(e.anulador.authId, id, { tratamiento: "no_cobrado" })

    expect(r).toMatchObject({ estado: "anulada", tratamiento_dinero: "credito_sin_abonos" })
    expect(Number(r.saldo_cancelado)).toBe(230)
    expect(await deudaDe(db, e.clienteId)).toBe(0)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
    expect((await anulacionDe(id)).estado_anterior).toBe("pendiente")
    expect(await contar(db, "pagos", "empresa_id = $1", [e.empresa])).toBe(pagos)
    expect((await fallo(pagar(e.admin.authId, e.clienteId, 10))).code).toBe("LC002")
  })

  it.each([
    ["un abono parcial", 100],
    ["abonos que la saldaron", 230],
  ])("5. con %s no se anula, y nada cambia", async (_, monto) => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador, { forma: "credito", cliente: e.clienteId })
    await pagar(e.admin.authId, e.clienteId, monto)
    const abonos = await contar(db, "abonos", "venta_id = $1", [id])

    for (const authId of [e.anulador.authId, e.admin.authId]) {
      const error = await fallo(anular(authId, id))
      expect(error.code).toBe("AV005")
      expect(error.message).toBe(
        "Esta venta tiene abonos registrados y no puede anularse mediante el procedimiento actual. Contacta con el administrador"
      )
    }

    await nadaCambio(e, id, 8)
    expect(await contar(db, "abonos", "venta_id = $1", [id])).toBe(abonos)
  })
})

describe("lo que no se anula", () => {
  it.each([
    ["marcada como fiscal", "es_fiscal = true"],
    ["con CAI sellado", "cai_emision = 'CAI-PRUEBA'"],
  ])("6. una factura %s, ni siquiera el administrador", async (_, marca) => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await db.query(`update ventas set ${marca} where id = $1`, [id])

    expect((await fallo(anular(e.admin.authId, id))).code).toBe("AV004")
    await nadaCambio(e, id, 8)
  })

  it("7. una venta antigua sin ubicación", async () => {
    const e = await escenario()
    const id = await crearFactura(db, { empresa: e.empresa, clienteId: e.clienteId, total: 50 })

    expect((await fallo(anular(e.admin.authId, id))).code).toBe("AV006")
    expect((await venta(id)).estado).toBe("pendiente")
  })

  it("8. una venta cuyo inventario no cuadra con su detalle, o con un producto borrado", async () => {
    const e = await escenario()
    const descuadrada = await vender(e.anulador.authId, e.cargador)
    await db.query("update detalle_venta set cantidad = 3 where venta_id = $1", [descuadrada])

    expect((await fallo(anular(e.admin.authId, descuadrada))).code).toBe("AV007")

    const sinProducto = await vender(e.anulador.authId, e.cargador)
    await db.query("update detalle_venta set producto_id = null where venta_id = $1", [sinProducto])

    expect((await fallo(anular(e.admin.authId, sinProducto))).code).toBe("AV007")
    await nadaCambio(e, sinProducto, 6)
  })
})

describe("quién puede anular", () => {
  it.each([
    ["solo sales-history", ["pos", "sales-history"]],
    ["solo sales-void", ["pos", "sales-void"]],
    ["ninguno de los dos", ["pos"]],
  ])("9. un vendedor con %s no anula", async (_, permisos) => {
    const e = await escenario()
    const v = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos })
    const id = await vender(v.authId, e.cargador)

    expect((await fallo(anular(v.authId, id))).code).toBe("42501")
    await nadaCambio(e, id, 8)
  })

  it("10. el vendedor anula la venta que registró otro vendedor de su misma ubicación", async () => {
    const e = await escenario()
    const id = await vender(e.vendedor.authId, e.cargador)

    await anular(e.anulador.authId, id)

    expect((await venta(id)).usuario_id).toBe(e.vendedor.usuario)
    expect((await anulacionDe(id)).usuario_id).toBe(e.anulador.usuario)
  })

  it("11. el vendedor no anula una venta de otra ubicación de su empresa", async () => {
    const e = await escenario()
    const delCamion2 = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })
    const id = await vender(delCamion2.authId, e.cargador)

    expect((await fallo(anular(e.anulador.authId, id))).code).toBe("42501")
    expect((await venta(id)).estado).toBe("pagada")
    expect(await existencia(db, e.camion2, e.cargador.id)).toBe(18)
  })

  it("12. nadie anula una venta de otra empresa, ni una que no existe", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    const otra = await escenario()

    expect((await fallo(anular(otra.admin.authId, id))).code).toBe("AV002")
    expect((await fallo(anular(otra.anulador.authId, id))).code).toBe("AV002")
    expect((await fallo(anular(e.admin.authId, "00000000-0000-4000-8000-000000000000"))).code).toBe("AV002")
    await nadaCambio(e, id, 8)
  })

  it("13. al cambiar de ubicación pierde las ventas de la anterior y anula las de la nueva", async () => {
    const e = await escenario()
    const enCamion1 = await vender(e.anulador.authId, e.cargador)

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.camion2, e.anulador.usuario])

    expect((await fallo(anular(e.anulador.authId, enCamion1))).code).toBe("42501")
    await nadaCambio(e, enCamion1, 8)

    const enCamion2 = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, enCamion2)

    expect(await existencia(db, e.camion2, e.cargador.id)).toBe(20)
    expect((await anulacionDe(enCamion2)).ubicacion_usuario).toBe(e.camion2)
  })

  it("14. un vendedor sin ubicación asignada no anula", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await db.query("update usuarios set ubicacion_id = null where id = $1", [e.anulador.usuario])

    expect((await fallo(anular(e.anulador.authId, id))).code).toBe("42501")
  })

  it.each([
    ["desactivado", "activo = false"],
    ["con contraseña temporal", "debe_cambiar_contrasena = true"],
  ])("15. un usuario %s no anula, aunque sea administrador", async (_, cambio) => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    // Otro administrador activo: la empresa no puede quedarse sin ninguno.
    await db.query(
      "insert into usuarios (empresa_id, email, nombre, rol, activo) values ($1, $2, 'Otro administrador', 'admin', true)",
      [e.empresa, `otro-admin-${e.empresa}@prueba.local`]
    )

    for (const usuario of [e.anulador, e.admin]) {
      await db.query(`update usuarios set ${cambio} where id = $1`, [usuario.usuario])
      expect((await fallo(anular(usuario.authId, id))).code).toBe("42501")
    }

    await nadaCambio(e, id, 8)
  })

  it("16. sin sesión no se puede ni llamar", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)

    expect((await fallo(anular(null, id))).code).toBe("42501")

    const r = await db.query(
      `select has_function_privilege('anon', 'anular_venta(uuid,text,text,text)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'anular_venta(uuid,text,text,text)', 'EXECUTE') as autenticado,
              exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = 'anular_venta(uuid,text,text,text)'::regprocedure and a.grantee = 0) as publico`
    )
    expect(r.rows[0]).toEqual({ anon: false, autenticado: true, publico: false })
  })
})

describe("el plazo del vendedor, en hora de Honduras", () => {
  it("17. anula una venta de hoy a las 00:00 de Honduras", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await db.query("update ventas set fecha = $1 where id = $2", [await horaDeHonduras(0, "00:00:00"), id])

    await anular(e.anulador.authId, id)

    expect((await venta(id)).estado).toBe("anulada")
  })

  it("18. no anula una de ayer a las 23:59:59 de Honduras, aunque en UTC ya sea hoy", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    const ayer = await horaDeHonduras(-1, "23:59:59")
    await db.query("update ventas set fecha = $1 where id = $2", [ayer, id])

    // Honduras es UTC−6: en UTC esa venta ya es de las 05:59:59 de hoy.
    const enUtc = (await db.query("select to_char($1::timestamptz at time zone 'UTC', 'HH24:MI:SS') as h", [ayer])).rows[0].h
    expect(enUtc).toBe("05:59:59")

    const error = await fallo(anular(e.anulador.authId, id))
    expect(error.code).toBe("AV003")
    await nadaCambio(e, id, 8)
  })

  it("19. el administrador anula sin límite de días", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await db.query("update ventas set fecha = now() - interval '30 days' where id = $1", [id])

    await anular(e.admin.authId, id)

    const a = await anulacionDe(id)
    expect(a).toMatchObject({ usuario_rol: "admin", usuario_id: e.admin.usuario, ubicacion_usuario: null })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
  })

  it("20. el administrador devuelve a la ubicación de la venta aunque esté desactivada", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await db.query("update usuarios set ubicacion_id = $1 where ubicacion_id = $2", [e.camion2, e.camion1])
    await db.query("update ubicaciones set activa = false where id = $1", [e.camion1])

    await anular(e.admin.authId, id)

    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
    expect(await existencia(db, e.camion2, e.cargador.id)).toBe(20)
  })
})

describe("ventas sin conexión y de conciliación", () => {
  it("21. una venta sin conexión anulada no revive ni se duplica al reenviarse", async () => {
    const e = await escenario()
    const original = ventaSinConexion(e)
    const r = await sincronizar(db, e.vendedor.authId, original)
    const id = r.venta_id
    const antes = await venta(id)

    await anular(e.anulador.authId, id)

    const otraVez = await sincronizar(db, e.vendedor.authId, original)
    expect(otraVez).toMatchObject({ estado: "ya_registrada", venta_id: id })

    const despues = await venta(id)
    expect(despues.estado).toBe("anulada")
    expect([despues.numero_provisional, despues.clave_idempotencia, despues.huella_origen, despues.origen]).toEqual([
      antes.numero_provisional,
      antes.clave_idempotencia,
      antes.huella_origen,
      "sin_conexion",
    ])
    expect(await contar(db, "ventas", "clave_idempotencia = $1", [original.clave_idempotencia])).toBe(1)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)

    const otroContenido = { ...original, renglones: original.renglones.map((x) => ({ ...x, cantidad: 1 })) }
    otroContenido.total_cobrado = 115
    expect((await fallo(sincronizar(db, e.vendedor.authId, otroContenido))).code).toBe("OF003")
  })

  it("22. una venta de conciliación solo la anula el administrador, y el ajuste se conserva", async () => {
    const e = await escenario({ enCamion1: 1 })
    const r = await sincronizar(db, e.vendedor.authId, ventaSinConexion(e))
    expect(r.estado).toBe("en_conciliacion")
    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar_con_ajuste", "Faltaba una unidad en el sistema")
    const id = aplicada.venta_id
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(0)

    expect((await fallo(anular(e.anulador.authId, id))).code).toBe("AV008")

    await anular(e.admin.authId, id)

    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(2)
    expect(await contar(db, "movimientos_inventario", "ubicacion_id = $1 and tipo = 'ajuste'", [e.camion1])).toBe(1)
    expect((await db.query("select estado, venta_id from ventas_por_conciliar where id = $1", [r.conciliacion_id])).rows[0]).toEqual({
      estado: "aplicada",
      venta_id: id,
    })
  })
})

describe("una sola vez", () => {
  it("23. anular dos veces responde «ya_anulada» y no devuelve el stock de nuevo", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, id)

    const otraVez = await anular(e.admin.authId, id, { motivo: "Otro motivo cualquiera" })

    expect(otraVez).toMatchObject({ estado: "ya_anulada", venta_id: id, motivo: MOTIVO })
    expect(await movimientosDeAnulacion(id)).toHaveLength(1)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
    expect(await contar(db, "anulaciones_venta", "venta_id = $1", [id])).toBe(1)
  })

  it("24. la misma clave para otra venta se rechaza", async () => {
    const e = await escenario()
    const una = await vender(e.anulador.authId, e.cargador)
    const otra = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, una, { clave: "anular-1" })

    expect((await anular(e.anulador.authId, una, { clave: "anular-1" })).estado).toBe("ya_anulada")
    expect((await fallo(anular(e.anulador.authId, otra, { clave: "anular-1" }))).code).toBe("AV009")
  })

  it("25. la base no admite una segunda devolución del mismo producto de la misma venta", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, id)

    const error = await fallo(
      db.query(
        `insert into movimientos_inventario (empresa_id, producto_id, venta_id, ubicacion_id, tipo, cantidad, motivo)
         values ($1, $2, $3, $4, 'anulacion_venta', 2, 'otra vez')`,
        [e.empresa, e.cargador.id, id, e.camion1]
      )
    )
    expect(error.code).toBe("23505")
  })

  it("26. dos anulaciones simultáneas: la segunda espera y encuentra la venta ya anulada", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    const sql = "select anular_venta($1, $2) as r"

    const { respuesta, espera } = await enDosSesiones(base, db, {
      primera: { authId: e.anulador.authId, hacer: (c) => c.query(sql, [id, MOTIVO]) },
      segunda: { authId: e.admin.authId, hacer: (c) => c.query(sql, [id, "Anulación del administrador"]) },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(respuesta.rows[0].r.estado).toBe("ya_anulada")
    expect(await movimientosDeAnulacion(id)).toHaveLength(1)
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(10)
  })

  it("27. un cobro en curso hace esperar a la anulación, que después ve el abono y se detiene", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador, { forma: "credito", cliente: e.clienteId })

    const { error } = await enDosSesiones(base, db, {
      primera: { authId: e.admin.authId, hacer: (c) => c.query("select registrar_pago_cliente($1, 100)", [e.clienteId]) },
      segunda: { authId: e.anulador.authId, hacer: (c) => c.query("select anular_venta($1, $2)", [id, MOTIVO]) },
    })

    expect(error.code).toBe("AV005")
    expect((await venta(id)).estado).toBe("pendiente")
  })

  it("28. una anulación en curso hace esperar al cobro, que después ya no encuentra deuda", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador, { forma: "credito", cliente: e.clienteId })

    const { error } = await enDosSesiones(base, db, {
      primera: { authId: e.anulador.authId, hacer: (c) => c.query("select anular_venta($1, $2)", [id, MOTIVO]) },
      segunda: { authId: e.admin.authId, hacer: (c) => c.query("select registrar_pago_cliente($1, 100)", [e.clienteId]) },
    })

    expect(error.code).toBe("LC002")
    expect((await venta(id)).estado).toBe("anulada")
    expect(await contar(db, "abonos", "venta_id = $1", [id])).toBe(0)
  })
})

describe("el registro y el estado no se tocan después", () => {
  it("29. el registro no se cambia ni se borra, ni como dueño ni desde la aplicación", async () => {
    const e = await escenario()
    const id = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, id)

    expect((await fallo(db.query("update anulaciones_venta set motivo = 'Cambiado por el dueño' where venta_id = $1", [id]))).code).toBe("42501")
    expect((await fallo(db.query("delete from anulaciones_venta where venta_id = $1", [id]))).code).toBe("42501")

    for (const authId of [e.anulador.authId, e.admin.authId]) {
      for (const sql of [
        "update anulaciones_venta set motivo = 'Cambiado desde la app' where venta_id = $1",
        "delete from anulaciones_venta where venta_id = $1",
      ]) {
        expect((await fallo(consultarComo(db, authId, sql, [id]))).code).toBe("42501")
      }
    }

    expect(
      (
        await fallo(
          consultarComo(
            db,
            e.admin.authId,
            `insert into anulaciones_venta (empresa_id, venta_id, numero_documento, estado_anterior, forma_pago, total,
               ubicacion_venta, usuario_id, usuario_nombre, usuario_rol, motivo, tratamiento_dinero)
             values ($1, $2, 'X', 'pagada', 'contado', 1, $3, $4, 'X', 'admin', 'Motivo suficiente', 'no_cobrado')`,
            [e.empresa, await vender(e.anulador.authId, e.cargador), e.camion1, e.admin.usuario]
          )
        )
      ).code
    ).toBe("42501")
    expect((await anulacionDe(id)).motivo).toBe(MOTIVO)
  })

  it("30. una venta anulada no vuelve a estar vigente, y no se anula sin registro", async () => {
    const e = await escenario()
    const anulada = await vender(e.anulador.authId, e.cargador)
    await anular(e.anulador.authId, anulada)

    expect((await fallo(db.query("update ventas set estado = 'pagada' where id = $1", [anulada]))).code).toBe("42501")

    const vigente = await vender(e.anulador.authId, e.cargador)
    expect((await fallo(db.query("update ventas set estado = 'anulada' where id = $1", [vigente]))).code).toBe("42501")
    expect((await venta(vigente)).estado).toBe("pagada")
  })

  it("31. el vendedor ve las anulaciones de su ubicación; el administrador, todas", async () => {
    const e = await escenario()
    const delCamion2 = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion2, permisos: ["pos"] })
    const enCamion1 = await vender(e.anulador.authId, e.cargador)
    const enCamion2 = await vender(delCamion2.authId, e.cargador)
    await anular(e.anulador.authId, enCamion1)
    await anular(e.admin.authId, enCamion2)

    const ver = async (authId) =>
      (await consultarComo(db, authId, "select venta_id from anulaciones_venta where empresa_id = $1", [e.empresa])).rows
        .map((f) => f.venta_id)
        .sort()

    expect(await ver(e.anulador.authId)).toEqual([enCamion1])
    expect(await ver(e.admin.authId)).toEqual([enCamion1, enCamion2].sort())
    expect(await ver((await escenario()).admin.authId)).toEqual([])
  })
})

describe("el permiso «Anular ventas»", () => {
  it("32. el administrador lo asigna y lo retira a un usuario sin tocar sus otros permisos", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos", "sales-history"] })
    const permisosDe = async () =>
      (await db.query("select seccion from permisos_usuario where usuario_id = $1 order by seccion", [v.usuario])).rows.map((f) => f.seccion)

    await consultarComo(db, e.admin.authId, "select guardar_permisos_usuario($1, $2)", [v.usuario, ["pos", "sales-history", "sales-void"]])
    expect(await permisosDe()).toEqual(["pos", "sales-history", "sales-void"])

    const id = await vender(v.authId, e.cargador)
    await anular(v.authId, id)

    await consultarComo(db, e.admin.authId, "select guardar_permisos_usuario($1, $2)", [v.usuario, ["pos", "sales-history"]])
    expect(await permisosDe()).toEqual(["pos", "sales-history"])
    const otra = await vender(v.authId, e.cargador)
    expect((await fallo(anular(v.authId, otra))).code).toBe("42501")

    expect((await fallo(consultarComo(db, e.admin.authId, "select guardar_permisos_usuario($1, $2)", [v.usuario, ["inventado"]]))).code).toBe("23514")
  })

  it("33. un vendedor no se lo puede dar a sí mismo", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos", "sales-history"] })

    await consultarComo(db, v.authId, "select guardar_permisos_usuario($1, $2)", [v.usuario, ["pos", "sales-history", "sales-void"]]).catch(
      () => {}
    )

    expect(await contar(db, "permisos_usuario", "usuario_id = $1 and seccion = 'sales-void'", [v.usuario])).toBe(0)
  })
})
