/*
  0054 contra PostgreSQL de verdad: regalías a clientes.

  Bodega vende el Cargador (L 100, costo 37) y el Vidrio (L 50, costo 12), con
  ISV 15 %. Ruta local es otra ubicación de la misma empresa. Nada sale de
  producción: la empresa, los productos y las ventas se inventan aquí.
*/

import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"

import { enDosSesiones } from "./arnes.mjs"
import { usarBaseDePrueba, num, falla, empresaConTresUbicaciones } from "./ayudantes.mjs"
import { crearEmpresa, crearCliente, crearVendedor, deudaDe, contar } from "./fixtures.mjs"

let base
let db

const { como, fila } = usarBaseDePrueba((levantada) => {
  base = levantada
  db = levantada.admin
})

const PRECIOS = {}

async function escenario({ existencia = 20 } = {}) {
  const e = await empresaConTresUbicaciones(db, { nombre: "Lunacell Regalías", tasaIsv: 15, existencia, nombreCliente: "Cliente R" })
  const vidrio = (
    await db.query("insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Vidrio privado', 50, 12) returning id", [
      e.empresa,
      `V-${randomUUID().slice(0, 8)}`,
    ])
  ).rows[0].id

  await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 30)", [e.empresa, e.bodega, vidrio])
  PRECIOS[e.cargador] = 100
  PRECIOS[vidrio] = 50

  return {
    ...e,
    vidrio,
    autorizado: await e.vendedor(e.bodega, ["pos", "sales-history", "regalias"]),
    sinPermiso: await e.vendedor(e.bodega, ["pos", "sales-history"]),
    deRuta: await e.vendedor(e.ruta, ["pos", "sales-history", "regalias"]),
  }
}

const lista = (pares) => JSON.stringify(pares.map(([producto_id, cantidad]) => ({ producto_id, cantidad })))
const totalDe = (items) => Math.round(items.reduce((s, [p, c]) => s + PRECIOS[p] * c, 0) * 115) / 100
const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })

const SQL_REGALAR = `select public.registrar_venta_con_regalias(
  p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_regalias => $4::jsonb,
  p_motivo_regalia => $5, p_detalle_motivo => $6, p_cliente_id => $7, p_fecha_vencimiento => $8,
  p_clave_idempotencia => $9) as r`

function argumentos(e, { items = [[e.cargador, 5]], regalias = [[e.cargador, 1]], forma = "contado", cobros, cliente = e.cliente, motivo = "cortesia_comercial", detalle = "", clave = randomUUID() } = {}) {
  const medios = cobros ?? (forma === "contado" ? [efectivo(totalDe(items))] : [])

  return [lista(items), forma, JSON.stringify(medios), lista(regalias), motivo, detalle, cliente, forma === "credito" ? "2030-01-01" : null, clave]
}

const regalar = (quien, e, opciones) => fila(quien.authId, SQL_REGALAR, argumentos(e, opciones))

const vender = (quien, e, { items = [[e.cargador, 5]], clave = randomUUID() } = {}) =>
  fila(
    quien.authId,
    `select public.registrar_venta_con_medios(p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb,
       p_cliente_id => $3, p_clave_idempotencia => $4) as r`,
    [lista(items), JSON.stringify([efectivo(totalDe(items))]), e.cliente, clave]
  )

const existencia = async (ubicacion, producto) =>
  num((await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? 0)
const laVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const regaliasDe = async (venta) => (await db.query("select * from regalias_venta where venta_id = $1 order by producto_id", [venta])).rows
const movimientosDe = async (venta) =>
  (await db.query("select producto_id, tipo, cantidad::int, ubicacion_id from movimientos_inventario where venta_id = $1 order by tipo, producto_id", [venta])).rows
const anular = (quien, venta, clave = randomUUID()) =>
  fila(quien.authId, "select public.anular_venta($1, 'El cliente desistió de la compra', null, $2) as r", [venta, clave])
const correlativos = async (empresa) =>
  (await db.query("select proximo_correlativo_factura, proximo_correlativo_interno from empresas where id = $1", [empresa])).rows[0]

async function contador(e, permisos = ["sales-history"]) {
  const c = await crearVendedor(db, { empresa: e.empresa, permisos })

  await db.query("update usuarios set rol = 'contador' where id = $1", [c.usuario])

  return c
}

describe("0054: vender con regalías", () => {
  it("1. una venta normal sin regalías sigue igual y no deja registro de regalías", async () => {
    const e = await escenario()
    const v = await vender(e.sinPermiso, e)

    expect(num(v.total)).toBe(575)
    expect(await regaliasDe(v.venta_id)).toEqual([])
    expect(await existencia(e.bodega, e.cargador)).toBe(15)
  })

  it("2 y 4. vende 5 y regala 1 del mismo producto: cobra 5, descuenta 6 y la regalía queda aparte", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e)
    const venta = await laVenta(v.venta_id)

    expect([num(venta.subtotal), num(venta.isv), num(venta.total), venta.forma_pago, venta.estado]).toEqual([500, 75, 575, "contado", "pagada"])
    expect((await db.query("select cantidad::int, subtotal::float8 from detalle_venta where venta_id = $1", [v.venta_id])).rows).toEqual([{ cantidad: 5, subtotal: 500 }])
    expect(await existencia(e.bodega, e.cargador)).toBe(14)

    const [r] = await regaliasDe(v.venta_id)
    expect(r).toMatchObject({ cliente_id: e.cliente, producto_id: e.cargador, nombre: "Cargador", cantidad: 1, ubicacion_id: e.bodega, usuario_id: e.autorizado.usuario, motivo: "cortesia_comercial", costo_unitario: "37.00" })
    expect(await movimientosDe(v.venta_id)).toEqual([
      { producto_id: e.cargador, tipo: "regalia", cantidad: -1, ubicacion_id: e.bodega },
      { producto_id: e.cargador, tipo: "salida", cantidad: -5, ubicacion_id: e.bodega },
    ])
    expect(num((await db.query("select sum(monto + cargo) as s from cobros_por_medio where venta_id = $1", [v.venta_id])).rows[0].s)).toBe(575)
    expect(v.regalias).toEqual([{ producto_id: e.cargador, cantidad: 1 }])
  })

  it("3. varias regalías, y el costo guardado no cambia al corregir el catálogo", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e, { items: [[e.cargador, 1]], regalias: [[e.vidrio, 2], [e.cargador, 1], [e.vidrio, 1]] })

    expect((await regaliasDe(v.venta_id)).map((r) => [r.producto_id, r.cantidad, r.costo_unitario]).sort()).toEqual(
      [[e.cargador, 1, "37.00"], [e.vidrio, 3, "12.00"]].sort()
    )
    expect([await existencia(e.bodega, e.cargador), await existencia(e.bodega, e.vidrio)]).toEqual([18, 27])
    expect(num((await laVenta(v.venta_id)).total)).toBe(115)

    await db.query("update productos set costo = 99, nombre = 'Otro nombre' where id = $1", [e.vidrio])
    expect((await regaliasDe(v.venta_id)).find((r) => r.producto_id === e.vidrio)).toMatchObject({ costo_unitario: "12.00", nombre: "Vidrio privado" })
  })

  it("5 y 6. valida la suma de lo vendido y lo regalado: alcanza justo, o se rechaza todo sin dejar nada", async () => {
    const e = await escenario({ existencia: 6 })
    const antes = await correlativos(e.empresa)
    const r = await falla(regalar(e.autorizado, e, { regalias: [[e.cargador, 2]] }))

    expect(r.code).toBe("RG007")
    expect(r.message).toContain("hay 6, y entre lo vendido (5) y lo regalado (2) se piden 7")
    expect(await existencia(e.bodega, e.cargador)).toBe(6)
    expect(await correlativos(e.empresa)).toEqual(antes)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(0)
    expect(await contar(db, "movimientos_inventario", "empresa_id = $1 and venta_id is not null", [e.empresa])).toBe(0)

    await regalar(e.autorizado, e)
    expect(await existencia(e.bodega, e.cargador)).toBe(0)
  })

  it("descuenta solo de la ubicación de quien entrega: sin existencia allí no la toma de otra", async () => {
    const e = await escenario()

    await db.query("insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, 1)", [e.empresa, e.ruta, e.cargador])
    expect((await falla(regalar(e.deRuta, e, { items: [[e.cargador, 1]], regalias: [[e.vidrio, 1]] }))).code).toBe("RG007")
    expect(await existencia(e.bodega, e.vidrio)).toBe(30)
  })

  it("un producto inactivo no se regala", async () => {
    const e = await escenario()

    await db.query("update productos set activo = false where id = $1", [e.vidrio])
    expect((await falla(regalar(e.autorizado, e, { regalias: [[e.vidrio, 1]] }))).code).toBe("RG006")
  })

  it("7 y 8. contado y crédito: la regalía no cambia total, saldo ni cuentas por cobrar", async () => {
    const e = await escenario()
    const credito = await regalar(e.autorizado, e, { forma: "credito" })
    const venta = await laVenta(credito.venta_id)

    expect([num(venta.total), venta.estado]).toEqual([575, "pendiente"])
    expect(await deudaDe(db, e.cliente)).toBe(575)
    expect(await contar(db, "abonos", "venta_id = $1", [credito.venta_id])).toBe(0)
    expect(await contar(db, "cobros_por_medio", "venta_id = $1", [credito.venta_id])).toBe(0)
  })

  it("9, 10 y 11. precio especial, precio negociado y varios medios: se calculan igual que sin regalía", async () => {
    const e = await escenario()

    await db.query("insert into precios_por_cliente (empresa_id, cliente_id, producto_id, precio) values ($1, $2, $3, 80)", [e.empresa, e.cliente, e.cargador])

    const items = JSON.stringify([
      { producto_id: e.cargador, cantidad: 2 },
      { producto_id: e.vidrio, cantidad: 1, precio_negociado: 40, motivo_negociacion: "mayoreo" },
    ])
    const tarjeta = { medio: "tarjeta", monto: 100, referencia: "AUT-1", tasa: 1.7, cargo: 1.7 }
    const cobros = JSON.stringify([efectivo(130), tarjeta])
    const v = await fila(e.autorizado.authId, SQL_REGALAR, [items, "contado", cobros, lista([[e.vidrio, 1]]), "compra_volumen", "", e.cliente, null, randomUUID()])

    const detalle = (await db.query("select producto_id, precio::float8 from detalle_venta where venta_id = $1", [v.venta_id])).rows
    expect(Object.fromEntries(detalle.map((d) => [d.producto_id, d.precio]))).toEqual({ [e.cargador]: 80, [e.vidrio]: 40 })
    expect([num(v.total), num((await laVenta(v.venta_id)).cargo_por_medio)]).toEqual([230, 1.7])
    expect(await existencia(e.bodega, e.vidrio)).toBe(28)
  })
})

describe("0054: reintentos y concurrencia", () => {
  it("12. reintentar con la misma clave devuelve la misma venta sin duplicar nada", async () => {
    const e = await escenario()
    const clave = randomUUID()
    const primera = await regalar(e.autorizado, e, { clave })
    const segunda = await regalar(e.autorizado, e, { clave })

    expect([segunda.venta_id, segunda.repetida]).toEqual([primera.venta_id, true])
    expect(await regaliasDe(primera.venta_id)).toHaveLength(1)
    expect(await movimientosDe(primera.venta_id)).toHaveLength(2)
    expect(await existencia(e.bodega, e.cargador)).toBe(14)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("13. la misma clave con otras regalías, otra cantidad u otro motivo se rechaza", async () => {
    const e = await escenario()
    const clave = randomUUID()

    await regalar(e.autorizado, e, { clave })
    expect((await falla(regalar(e.autorizado, e, { clave, regalias: [[e.cargador, 2]] }))).code).toBe("RG005")
    expect((await falla(regalar(e.autorizado, e, { clave, regalias: [[e.vidrio, 1]] }))).code).toBe("RG005")
    expect((await falla(regalar(e.autorizado, e, { clave, motivo: "cliente_frecuente" }))).code).toBe("RG005")
    expect((await falla(regalar(e.autorizado, e, { clave, items: [[e.cargador, 4]] }))).code).toBe("LV005")

    // Una venta ya registrada sin regalías no las recibe después con la misma clave.
    const otra = randomUUID()
    await vender(e.autorizado, e, { clave: otra })
    expect((await falla(regalar(e.autorizado, e, { clave: otra }))).code).toBe("RG005")
    expect(await existencia(e.bodega, e.cargador)).toBe(9)
  })

  it("14a. dos sesiones por las últimas unidades: la segunda espera el candado y no vende lo regalado", async () => {
    const e = await escenario({ existencia: 2 })
    const { error, espera } = await enDosSesiones(base, db, {
      primera: { authId: e.autorizado.authId, hacer: (c) => c.query(SQL_REGALAR, argumentos(e, { items: [[e.cargador, 1]] })) },
      segunda: { authId: e.sinPermiso.authId, hacer: (c) => c.query(
        "select public.registrar_venta_con_medios($1::jsonb, 'contado', $2::jsonb, $3) as r",
        [lista([[e.cargador, 1]]), JSON.stringify([efectivo(115)]), e.cliente]
      ) },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error.code).toBe("LV007")
    expect(await existencia(e.bodega, e.cargador)).toBe(0)
  })

  it("14b. una regalía espera a la venta que tiene la celda, y después ve lo que queda", async () => {
    const e = await escenario({ existencia: 2 })
    const { error, espera } = await enDosSesiones(base, db, {
      primera: { authId: e.sinPermiso.authId, hacer: (c) => c.query(
        "select public.registrar_venta_con_medios($1::jsonb, 'contado', $2::jsonb, $3) as r",
        [lista([[e.cargador, 2]]), JSON.stringify([efectivo(230)]), e.cliente]
      ) },
      segunda: { authId: e.autorizado.authId, hacer: (c) => c.query(SQL_REGALAR, argumentos(e, { items: [[e.vidrio, 1]], regalias: [[e.cargador, 1]] })) },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error.code).toBe("RG007")
    expect([await existencia(e.bodega, e.cargador), await existencia(e.bodega, e.vidrio)]).toEqual([0, 30])
  })

  it("14c. el mismo intento desde dos sesiones a la vez: uno registra y el otro recibe esa venta", async () => {
    const e = await escenario()
    const args = argumentos(e, { clave: randomUUID() })
    const resultado = await enDosSesiones(base, db, {
      primera: { authId: e.autorizado.authId, hacer: (c) => c.query(SQL_REGALAR, args) },
      segunda: { authId: e.autorizado.authId, hacer: (c) => c.query(SQL_REGALAR, args) },
    })

    expect(resultado.respuesta.rows[0].r.repetida).toBe(true)
    expect(await existencia(e.bodega, e.cargador)).toBe(14)
    expect(await contar(db, "regalias_venta", "empresa_id = $1", [e.empresa])).toBe(1)
  })
})

describe("0054: quién registra", () => {
  it("15. vendedor sin permiso, contador, anónimo y usuario de otra empresa no regalan; el administrador sí", async () => {
    const e = await escenario()
    const c = await contador(e, ["sales-history", "regalias"])
    const otra = await crearEmpresa(db, "Otra empresa")

    expect((await falla(regalar(e.sinPermiso, e))).code).toBe("42501")
    expect((await falla(regalar(c, e))).code).toBe("42501")
    expect((await falla(regalar({ authId: null }, e))).code).toBe("42501")
    expect((await falla(regalar(otra, e))).code).toBe("42501")

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.bodega, e.admin.usuario])
    expect((await regalar(e.admin, e)).venta_id).toBeTruthy()
    expect(await contar(db, "regalias_venta", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("D2 y D4: sin cliente registrado, con un cliente ajeno o sin motivo no se registra", async () => {
    const e = await escenario()
    const ajena = await crearEmpresa(db, "Ajena")
    const clienteAjeno = await crearCliente(db, ajena.empresa, "Ajeno")

    expect((await falla(regalar(e.autorizado, e, { cliente: null }))).code).toBe("RG003")
    expect((await falla(regalar(e.autorizado, e, { cliente: clienteAjeno }))).code).toBe("42501")
    expect((await falla(regalar(e.autorizado, e, { motivo: "porque si" }))).code).toBe("RG002")
    expect((await falla(regalar(e.autorizado, e, { motivo: "otro", detalle: "  " }))).code).toBe("RG002")
    expect((await falla(regalar(e.autorizado, e, { regalias: [] }))).code).toBe("RG001")
    expect((await falla(regalar(e.autorizado, e, { regalias: [[e.cargador, 0]] }))).code).toBe("RG001")
    expect((await falla(regalar(e.autorizado, e, { clave: "" }))).code).toBe("RG001")
    expect(await existencia(e.bodega, e.cargador)).toBe(20)

    const v = await regalar(e.autorizado, e, { motivo: "otro", detalle: "Aniversario del cliente" })
    expect((await regaliasDe(v.venta_id))[0]).toMatchObject({ motivo: "otro", detalle_motivo: "Aniversario del cliente" })
  })

  it("23. en una factura fiscal se rechaza sin gastar el correlativo ni tocar el inventario", async () => {
    const e = await escenario()

    await db.query("update empresas set cai = 'CAI-PRUEBA', rango_desde = 1, rango_hasta = 5000, fecha_limite_emision = '2099-12-31' where id = $1", [e.empresa])
    await db.query("update ubicaciones set emite_fiscal = true where id = $1", [e.bodega])

    const antes = await correlativos(e.empresa)
    expect((await falla(regalar(e.autorizado, e))).code).toBe("RG004")
    expect(await correlativos(e.empresa)).toEqual(antes)
    expect(await existencia(e.bodega, e.cargador)).toBe(20)

    // La venta fiscal sin regalías sigue como siempre.
    expect((await vender(e.autorizado, e)).es_fiscal).toBe(true)
  })
})

describe("0054: lectura, costo y protección del registro", () => {
  it("16. se lee como la venta: su ubicación sí, otra ubicación u otra empresa no; anon nada", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e)
    const otra = await crearEmpresa(db, "Otra lectura")
    const leer = async (authId) => (await como(authId, "select id from regalias_venta where venta_id = $1", [v.venta_id])).rows.length

    expect(await leer(e.autorizado.authId)).toBe(1)
    expect(await leer(e.sinPermiso.authId)).toBe(1)
    expect(await leer(e.admin.authId)).toBe(1)
    expect(await leer(e.deRuta.authId)).toBe(0)
    expect(await leer(otra.authId)).toBe(0)
    expect((await falla(como(null, "select id from regalias_venta"))).code).toBe("42501")
  })

  it("D7. nadie lee el costo por la API, ni lo filtra ni lo ordena: ni el administrador por la tabla", async () => {
    const e = await escenario()
    const c = await contador(e)

    await regalar(e.autorizado, e)

    for (const authId of [e.autorizado.authId, e.sinPermiso.authId, c.authId, e.admin.authId]) {
      for (const consulta of ["select costo_unitario from regalias_venta", "select * from regalias_venta", "select id from regalias_venta where costo_unitario > 1", "select id from regalias_venta order by costo_unitario"]) {
        expect([authId, consulta, (await falla(como(authId, consulta))).code]).toEqual([authId, consulta, "42501"])
      }
    }
  })

  it("nadie escribe en el registro directamente; ni el dueño lo cambia o lo borra", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e)

    for (const consulta of [
      "insert into regalias_venta (empresa_id, venta_id, cliente_id, producto_id, nombre, cantidad, ubicacion_id, usuario_id, usuario_nombre, motivo, costo_unitario) select empresa_id, venta_id, cliente_id, producto_id, nombre, 1, ubicacion_id, usuario_id, usuario_nombre, motivo, 0 from regalias_venta limit 1",
      "update regalias_venta set cantidad = 9",
      "delete from regalias_venta",
    ]) {
      expect((await falla(como(e.admin.authId, consulta))).code).toBe("42501")
    }

    expect((await falla(db.query("update regalias_venta set cantidad = 9 where venta_id = $1", [v.venta_id]))).code).toBe("42501")
    expect((await falla(db.query("delete from regalias_venta where venta_id = $1", [v.venta_id]))).code).toBe("42501")

    // Un movimiento de regalía sin venta, o que suma, no cabe en el libro.
    const suelto = await falla(
      db.query("insert into movimientos_inventario (empresa_id, producto_id, ubicacion_id, tipo, cantidad) values ($1, $2, $3, 'regalia', 1)", [e.empresa, e.cargador, e.bodega])
    )
    expect(suelto.code).toBe("23514")
  })
})

describe("0054: anular y devolver (D5 y D6)", () => {
  it("20, A y B. anular devuelve lo vendido y conserva la regalía entregada, que no vuelve al inventario", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e)
    const regaliaAntes = await regaliasDe(v.venta_id)

    const r = await anular(e.admin, v.venta_id)

    expect(r.estado).toBe("anulada")
    expect((await laVenta(v.venta_id)).estado).toBe("anulada")
    expect(await existencia(e.bodega, e.cargador)).toBe(19)
    expect(await regaliasDe(v.venta_id)).toEqual(regaliaAntes)
    expect(await movimientosDe(v.venta_id)).toEqual([
      { producto_id: e.cargador, tipo: "anulacion_venta", cantidad: 5, ubicacion_id: e.bodega },
      { producto_id: e.cargador, tipo: "regalia", cantidad: -1, ubicacion_id: e.bodega },
      { producto_id: e.cargador, tipo: "salida", cantidad: -5, ubicacion_id: e.bodega },
    ])
  })

  it("C. anular dos veces responde «ya anulada» sin movimientos nuevos", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e, { regalias: [[e.vidrio, 2]] })

    await anular(e.admin, v.venta_id)
    const movimientos = await movimientosDe(v.venta_id)

    expect((await anular(e.admin, v.venta_id)).estado).toBe("ya_anulada")
    expect(await movimientosDe(v.venta_id)).toEqual(movimientos)
    expect([await existencia(e.bodega, e.cargador), await existencia(e.bodega, e.vidrio)]).toEqual([20, 28])
  })

  it("21 y D. devolver parte de lo vendido no toca la regalía ni la deja devolver", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e)
    const devuelve = await e.vendedor(e.bodega, ["pos", "sales-history", "sales-return"])
    const devolver = (cantidad) =>
      fila(devuelve.authId, "select public.registrar_devolucion_de_venta($1, 'El cliente lo devolvió', $2::jsonb, null, $3) as r", [
        v.venta_id,
        JSON.stringify([{ producto_id: e.cargador, cantidad, condicion: "buen_estado" }]),
        randomUUID(),
      ])

    const d = await devolver(2)
    expect([num(d.valor), num(d.a_favor)]).toEqual([230, 230])
    expect(await existencia(e.bodega, e.cargador)).toBe(16)
    expect((await falla(devolver(4))).code).toBe("DV005")
    expect(await regaliasDe(v.venta_id)).toHaveLength(1)
  })
})

describe("0054: reportes (D8)", () => {
  it("22 y E. el reporte de regalías: costo solo al administrador, ubicación del vendedor, factura anulada a la vista", async () => {
    const e = await escenario()
    const c = await contador(e)
    const sinHistorial = await e.vendedor(e.bodega, ["pos"])
    const otra = await crearEmpresa(db, "Otra reporte")
    const v = await regalar(e.autorizado, e, { regalias: [[e.cargador, 1], [e.vidrio, 2]] })

    await anular(e.admin, v.venta_id)

    const reporte = async (authId) => (await como(authId, "select * from public.reporte_de_regalias() order by producto")).rows
    const admin = await reporte(e.admin.authId)

    expect(admin.map((r) => [r.producto, r.cantidad, r.estado_factura, num(r.costo_unitario), num(r.costo_total), r.ubicacion, r.motivo])).toEqual([
      ["Cargador", 1, "anulada", 37, 37, "Bodega", "cortesia_comercial"],
      ["Vidrio privado", 2, "anulada", 12, 24, "Bodega", "cortesia_comercial"],
    ])
    expect(admin[0]).toMatchObject({ numero_factura: (await laVenta(v.venta_id)).numero_factura, cliente_id: e.cliente, usuario: expect.stringMatching(/^Vendedor/) })

    for (const authId of [c.authId, e.sinPermiso.authId]) {
      const filas = await reporte(authId)
      expect(filas).toHaveLength(2)
      expect(filas.every((r) => r.costo_unitario === null && r.costo_total === null)).toBe(true)
    }

    expect(await reporte(e.deRuta.authId)).toEqual([])
    expect(await reporte(otra.authId)).toEqual([])
    expect((await falla(reporte(sinHistorial.authId))).code).toBe("42501")
    expect((await falla(reporte(null))).code).toBe("42501")
  })

  it("ventas, cobros y cuentas por cobrar no cuentan la regalía; los movimientos sí la muestran", async () => {
    const e = await escenario()
    const v = await regalar(e.autorizado, e, { regalias: [[e.vidrio, 3]] })
    const diario = await fila(e.admin.authId, "select public.reporte_diario_de_caja() as r")

    expect([num(diario.indicadores.ventas_total), num(diario.indicadores.cobros_total), num(diario.indicadores.abonos_total)]).toEqual([575, 575, 0])
    expect(diario.movimientos.filter((m) => m.documento === v.numero_factura).map((m) => [m.clase, m.cantidad]).sort()).toEqual(
      [["regalia", -3], ["venta", -5]].sort()
    )
    expect(await deudaDe(db, e.cliente)).toBe(0)
  })
})
