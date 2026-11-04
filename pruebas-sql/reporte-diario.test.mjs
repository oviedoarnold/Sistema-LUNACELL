/*
  0038 contra PostgreSQL de verdad: reporte_diario().

  Las ventas, los cobros, las anulaciones y los traslados se hacen con las
  mismas funciones que usa la aplicación, no insertando filas a mano: así se
  comprueba que el reporte cuenta lo que esas funciones escriben. Solo se
  mueve la fecha de lo ya registrado, para probar otros días.
*/

import { readFileSync } from "node:fs"

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"
import { conciliar, escenarioSinConexion, sincronizar, ventaSinConexion } from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

const RECHAZO = { code: "42501" }

async function como(authId, consulta, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(consulta, valores)
  } finally {
    await comoDueno(db)
  }
}

const reporte = async (authId, dia = null, ubicacion = null) =>
  (await como(authId, "select public.reporte_diario($1::date, $2::uuid) as r", [dia, ubicacion])).rows[0].r

const diaDe = async (fecha) =>
  (
    await db.query("select to_char(($1::timestamptz at time zone 'America/Tegucigalpa')::date, 'YYYY-MM-DD') as d", [fecha])
  ).rows[0].d

/*
  Dos camiones con su vendedor, permisos para vender y cobrar, y existencia
  de sobra. El cargador cuesta 10 y se vende a 100, con 15 % de ISV: 115.
*/
async function escenario(opciones = {}) {
  const esc = await escenarioSinConexion(db, { enCamion1: 100, ...opciones })
  const permisos = ["pos", "sales-history", "inventory-own"]

  await db.query(
    `insert into permisos_usuario (usuario_id, empresa_id, seccion)
     select $1, $2, s from unnest($3::text[]) s
     on conflict do nothing`,
    [esc.vendedor.usuario, esc.empresa, ["sales-history", "inventory-own"]]
  )

  const vendedor2 = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion2, permisos })

  return { ...esc, vendedor2 }
}

const vender = async (esc, authId, { cantidad = 1, forma = "contado", cliente = null, producto = esc.cargador.id } = {}) =>
  (
    await como(
      authId,
      "select public.registrar_venta_ubicacion($1::jsonb, $2, $3) as r",
      [JSON.stringify([{ producto_id: producto, cantidad }]), forma, cliente]
    )
  ).rows[0].r

const moverVentaA = (ventaId, fecha) =>
  Promise.all([
    db.query("update ventas set fecha = $2 where id = $1", [ventaId, fecha]),
    db.query("update movimientos_inventario set fecha = $2 where venta_id = $1", [ventaId, fecha]),
  ])

const anular = (authId, ventaId, tratamiento = "reembolso_pendiente") =>
  como(authId, "select public.anular_venta($1, 'Error al registrar la venta', $2)", [ventaId, tratamiento])

const fila = (lista, clave, valor) => lista.find((x) => x[clave] === valor)

describe("reporte_diario: ventas, ubicaciones y vendedores", () => {
  it("suma las ventas válidas de varias ubicaciones y vendedores, al contado y a crédito", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId)
    await vender(e, e.vendedor.authId, { cantidad: 2, forma: "credito", cliente: e.clienteId })
    await vender(e, e.vendedor2.authId)

    const { indicadores: i, por_ubicacion, por_vendedor, ventas } = await reporte(e.admin.authId)

    expect(i).toMatchObject({
      ventas_total: 460,
      ventas_cantidad: 3,
      ticket_promedio: 153.33,
      contado_total: 230,
      contado_cantidad: 2,
      credito_total: 230,
      credito_cantidad: 1,
      cobros_total: 230,
      abonos_total: 0,
      anuladas_total: 0,
    })

    expect(fila(por_ubicacion, "ubicacion", "Camión 01")).toMatchObject({
      ventas_total: 345, ventas_cantidad: 2, contado_total: 115, credito_total: 230, cobros_total: 115,
    })
    expect(fila(por_ubicacion, "ubicacion", "Camión 02")).toMatchObject({ ventas_total: 115, ventas_cantidad: 1 })

    // Una ubicación activa sin ventas también se ve, en cero.
    expect(fila(por_ubicacion, "ubicacion", "Tienda")).toMatchObject({ ventas_total: 0, ventas_cantidad: 0 })

    expect(fila(por_vendedor, "usuario_id", e.vendedor.usuario)).toMatchObject({ ventas_total: 345, ventas_cantidad: 2 })
    expect(fila(por_vendedor, "usuario_id", e.vendedor2.usuario)).toMatchObject({ ventas_total: 115, ventas_cantidad: 1 })

    expect(ventas).toHaveLength(3)
    expect(ventas[0]).toMatchObject({ ubicacion: "Camión 01", cliente: "Consumidor Final", forma_pago: "contado", total: 115, estado: "pagada" })
    expect(ventas[0].productos).toEqual([expect.objectContaining({ nombre: "Cargador", cantidad: 1 })])
  })

  it("filtrar por ubicación deja solo lo de esa ubicación, con su vendedor", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId)
    await vender(e, e.vendedor2.authId, { cantidad: 3 })

    const r = await reporte(e.admin.authId, null, e.camion2)

    expect(r.indicadores).toMatchObject({ ventas_total: 345, ventas_cantidad: 1 })
    expect(r.por_ubicacion.map((u) => u.ubicacion)).toEqual(["Camión 02"])
    expect(r.por_vendedor.map((v) => v.usuario_id)).toEqual([e.vendedor2.usuario])
    expect(r.ventas.map((v) => v.ubicacion)).toEqual(["Camión 02"])
    expect(r.movimientos.every((m) => m.ubicacion === "Camión 02")).toBe(true)
  })

  it("la ubicación es la de la venta, aunque el vendedor cambie después", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId)
    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.camion2, e.vendedor.usuario])

    const r = await reporte(e.admin.authId)

    expect(r.ventas[0].ubicacion).toBe("Camión 01")
    expect(fila(r.por_ubicacion, "ubicacion", "Camión 02").ventas_total).toBe(0)
  })

  it("una venta histórica sin ubicación aparece aparte, solo en la vista de todas", async () => {
    const e = await escenario()
    const { venta_id } = await vender(e, e.vendedor.authId)

    await db.query("update ventas set ubicacion_id = null where id = $1", [venta_id])

    const todas = await reporte(e.admin.authId)
    expect(fila(todas.por_ubicacion, "ubicacion", "Sin ubicación")).toMatchObject({ ventas_total: 115 })
    expect(todas.indicadores.ventas_total).toBe(115)

    const camion = await reporte(e.admin.authId, null, e.camion1)
    expect(camion.indicadores.ventas_total).toBe(0)
  })

  it("suma con decimales exactos, sin el error de los binarios", async () => {
    const e = await escenario()

    await db.query("update empresas set tasa_isv = 0 where id = $1", [e.empresa])
    await db.query("update productos set precio = 0.10 where id = $1", [e.cargador.id])
    await db.query("update productos set precio = 0.20 where id = $1", [e.cubo.id])

    await vender(e, e.vendedor.authId)
    await vender(e, e.vendedor.authId, { producto: e.cubo.id })

    const { rows } = await como(
      e.admin.authId,
      "select public.reporte_diario()->'indicadores'->>'ventas_total' as total, public.reporte_diario()->'indicadores'->>'ticket_promedio' as ticket"
    )

    expect(rows[0]).toEqual({ total: "0.30", ticket: "0.15" })
  })
})

describe("reporte_diario: cobros y abonos", () => {
  it("un abono cuenta el día del abono, no el de la venta, y una sola vez", async () => {
    const e = await escenario()
    const { venta_id } = await vender(e, e.vendedor.authId, { cantidad: 2, forma: "credito", cliente: e.clienteId })

    await moverVentaA(venta_id, "2026-03-10 12:00:00-06")
    await como(e.vendedor.authId, "select public.registrar_pago_cliente($1, 100)", [e.clienteId])

    const delaVenta = await reporte(e.admin.authId, "2026-03-10")
    expect(delaVenta.indicadores).toMatchObject({ ventas_total: 230, credito_total: 230, abonos_total: 0, cobros_total: 0 })

    const delAbono = await reporte(e.admin.authId)
    expect(delAbono.indicadores).toMatchObject({ ventas_total: 0, abonos_total: 100, abonos_cantidad: 1, cobros_total: 100 })
    expect(delAbono.abonos[0]).toMatchObject({ monto: 100, ubicacion: "Camión 01" })
    expect(new Date(delAbono.abonos[0].fecha_venta).toISOString()).toBe("2026-03-10T18:00:00.000Z")
  })

  it("un pago repartido entre dos facturas suma su monto, no el doble", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, { forma: "credito", cliente: e.clienteId })
    await vender(e, e.vendedor.authId, { forma: "credito", cliente: e.clienteId })
    await como(e.vendedor.authId, "select public.registrar_pago_cliente($1, 200)", [e.clienteId])

    const { indicadores } = await reporte(e.admin.authId)

    expect(indicadores).toMatchObject({ abonos_total: 200, abonos_cantidad: 2, cobros_total: 200, credito_total: 230 })
  })

  it("contado y abonos del mismo día forman los cobros; el crédito sin cobrar no", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId)
    await vender(e, e.vendedor.authId, { forma: "credito", cliente: e.clienteId })
    await como(e.vendedor.authId, "select public.registrar_pago_cliente($1, 15)", [e.clienteId])

    const { indicadores } = await reporte(e.admin.authId)

    expect(indicadores).toMatchObject({ ventas_total: 230, cobros_total: 130, abonos_total: 15 })
  })

  it("un abono se atribuye a donde se cobró, y si lo cobró un administrador, a la ubicación de la venta", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, { forma: "credito", cliente: e.clienteId })

    await db.query("update usuarios set ubicacion_id = null where id = $1", [e.admin.usuario])
    await como(e.admin.authId, "select public.registrar_pago_cliente($1, 15)", [e.clienteId])

    const { rows } = await db.query("select ubicacion_id from pagos where cliente_id = $1", [e.clienteId])
    expect(rows[0].ubicacion_id).toBeNull()

    const r = await reporte(e.admin.authId)
    expect(fila(r.por_ubicacion, "ubicacion", "Camión 01").abonos_total).toBe(15)
    expect(venta.venta_id).toBeTruthy()
  })
})

describe("reporte_diario: anulaciones", () => {
  it("una venta anulada sale de los totales y queda aparte, sin perder su rastro", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, { cantidad: 2 })
    const { venta_id } = await vender(e, e.vendedor.authId)

    await anular(e.admin.authId, venta_id)

    const r = await reporte(e.admin.authId)

    expect(r.indicadores).toMatchObject({
      ventas_total: 230,
      ventas_cantidad: 1,
      cobros_total: 230,
      anuladas_total: 115,
      anuladas_cantidad: 1,
      reembolsos_pendientes: 115,
    })
    expect(r.ventas).toHaveLength(2)
    expect(fila(r.ventas, "id", venta_id).estado).toBe("anulada")
    expect(r.anulaciones[0]).toMatchObject({ total: 115, tratamiento_dinero: "reembolso_pendiente", ubicacion: "Camión 01" })
    expect(fila(r.movimientos_resumen, "clase", "anulacion_venta")).toMatchObject({ movimientos: 1, unidades: 1 })
    expect(fila(r.por_ubicacion, "ubicacion", "Camión 01")).toMatchObject({ ventas_total: 230, anuladas_total: 115 })
  })

  it("anulada otro día: la anulación cuenta cuando se anuló, y el día de la venta ya no suma", async () => {
    const e = await escenario()
    const { venta_id } = await vender(e, e.vendedor.authId)

    await moverVentaA(venta_id, "2026-03-10 12:00:00-06")
    await anular(e.admin.authId, venta_id, "no_cobrado")

    const delDiaDeLaVenta = await reporte(e.admin.authId, "2026-03-10")
    expect(delDiaDeLaVenta.indicadores).toMatchObject({ ventas_total: 0, ventas_cantidad: 0, anuladas_total: 0 })
    expect(delDiaDeLaVenta.ventas[0].estado).toBe("anulada")

    const deHoy = await reporte(e.admin.authId)
    expect(deHoy.indicadores).toMatchObject({ ventas_total: 0, anuladas_total: 115, reembolsos_pendientes: 0 })
    expect(deHoy.ventas).toEqual([])
    expect(new Date(deHoy.anulaciones[0].fecha_venta).toISOString()).toBe("2026-03-10T18:00:00.000Z")
  })
})

describe("reporte_diario: ventas sin conexión y conciliación", () => {
  it("una venta sincronizada cuenta una vez, el día en que se hizo", async () => {
    const e = await escenario()
    const venta = ventaSinConexion(e)

    expect((await sincronizar(db, e.vendedor.authId, venta)).estado).toBe("registrada")
    expect((await sincronizar(db, e.vendedor.authId, venta)).estado).toBe("ya_registrada")

    const r = await reporte(e.admin.authId, await diaDe(venta.registrada_en))

    expect(r.indicadores).toMatchObject({ ventas_total: 230, ventas_cantidad: 1, por_conciliar: 0 })
    expect(r.ventas[0].origen).toBe("sin_conexion")
  })

  it("una venta por conciliar no cuenta hasta que se aplica, y entonces cuenta como venta real", async () => {
    const e = await escenario({ enCamion1: 1 })
    const venta = ventaSinConexion(e)

    const resultado = await sincronizar(db, e.vendedor.authId, venta)
    expect(resultado.estado).toBe("en_conciliacion")

    const dia = await diaDe(venta.registrada_en)

    const pendiente = await reporte(e.admin.authId, dia)
    expect(pendiente.indicadores).toMatchObject({ ventas_total: 0, ventas_cantidad: 0, por_conciliar: 1 })
    expect(pendiente.ventas).toEqual([])

    await db.query("update inventario_ubicacion set cantidad = 10 where ubicacion_id = $1 and producto_id = $2", [e.camion1, e.cargador.id])
    await conciliar(db, e.admin.authId, resultado.conciliacion_id, "aplicar")

    const aplicada = await reporte(e.admin.authId, dia)
    expect(aplicada.indicadores).toMatchObject({ ventas_total: 230, ventas_cantidad: 1, por_conciliar: 0 })
    expect(aplicada.ventas[0]).toMatchObject({ origen: "conciliacion", ubicacion: "Camión 01" })
  })

  it("una conciliación anulada no genera venta ni la cuenta", async () => {
    const e = await escenario({ enCamion1: 1 })
    const venta = ventaSinConexion(e)
    const { conciliacion_id } = await sincronizar(db, e.vendedor.authId, venta)

    await conciliar(db, e.admin.authId, conciliacion_id, "anular")

    const r = await reporte(e.admin.authId, await diaDe(venta.registrada_en))

    expect(r.indicadores).toMatchObject({ ventas_total: 0, ventas_cantidad: 0, anuladas_total: 0, por_conciliar: 0 })
  })
})

describe("reporte_diario: movimientos de inventario", () => {
  it("distingue ventas de traslados, y un traslado se ve en cada ubicación por su lado", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId, { cantidad: 2 })
    await como(
      e.admin.authId,
      "select public.registrar_traslado($1, $2, $3::jsonb)",
      [e.camion1, e.camion2, JSON.stringify([{ producto_id: e.cargador.id, cantidad: 3 }])]
    )

    const todas = await reporte(e.admin.authId)

    expect(fila(todas.movimientos_resumen, "clase", "venta")).toMatchObject({ movimientos: 1, unidades: -2 })
    expect(fila(todas.movimientos_resumen, "clase", "traslado_salida")).toMatchObject({ movimientos: 1, unidades: -3 })
    expect(fila(todas.movimientos_resumen, "clase", "traslado_entrada")).toMatchObject({ movimientos: 1, unidades: 3 })
    expect(fila(todas.movimientos, "clase", "venta").documento).toBe(todas.ventas[0].numero)
    expect(fila(todas.movimientos, "clase", "traslado_entrada")).toMatchObject({ origen: "Camión 01", destino: "Camión 02", ubicacion: "Camión 02" })

    // Un traslado no es una venta ni dinero.
    expect(todas.indicadores).toMatchObject({ ventas_cantidad: 1, ventas_total: 230 })

    const origen = await reporte(e.admin.authId, null, e.camion1)
    expect(origen.movimientos_resumen.map((r) => r.clase).sort()).toEqual(["traslado_salida", "venta"])

    const destino = await reporte(e.admin.authId, null, e.camion2)
    expect(destino.movimientos_resumen.map((r) => r.clase)).toEqual(["traslado_entrada"])
  })
})

describe("reporte_diario: el corte del día en Honduras", () => {
  it("corta a medianoche de Honduras, no de UTC", async () => {
    const e = await escenario()

    const antes = await vender(e, e.vendedor.authId)
    const justo = await vender(e, e.vendedor.authId, { cantidad: 2 })
    const despues = await vender(e, e.vendedor.authId, { cantidad: 3 })

    // 23:59:59 del 10 en Honduras ya es el 11 en UTC.
    await moverVentaA(antes.venta_id, "2026-03-11 05:59:59+00")
    // 00:00:00 del 11 en Honduras.
    await moverVentaA(justo.venta_id, "2026-03-11 06:00:00+00")
    // 23:59:59 del 11 en Honduras.
    await moverVentaA(despues.venta_id, "2026-03-12 05:59:59+00")

    const dia10 = await reporte(e.admin.authId, "2026-03-10")
    expect(dia10.indicadores).toMatchObject({ ventas_cantidad: 1, ventas_total: 115 })
    expect(fila(dia10.movimientos_resumen, "clase", "venta").unidades).toBe(-1)

    const dia11 = await reporte(e.admin.authId, "2026-03-11")
    expect(dia11.indicadores).toMatchObject({ ventas_cantidad: 2, ventas_total: 575 })

    const dia12 = await reporte(e.admin.authId, "2026-03-12")
    expect(dia12.indicadores).toMatchObject({ ventas_cantidad: 0, ventas_total: 0 })
  })

  it("sin día, usa el de hoy en Honduras", async () => {
    const e = await escenario()
    const r = await reporte(e.admin.authId)
    const { rows } = await db.query("select to_char((now() at time zone 'America/Tegucigalpa')::date, 'YYYY-MM-DD') as d")

    expect(r.dia).toBe(rows[0].d)
  })
})

describe("reporte_diario: quién puede consultarlo", () => {
  it("rechaza al vendedor, aunque tenga `settings`", async () => {
    const e = await escenario()
    const conSettings = await crearVendedor(db, { empresa: e.empresa, permisos: ["settings", "sales-history"] })

    await expect(reporte(e.vendedor.authId)).rejects.toMatchObject(RECHAZO)
    await expect(reporte(conSettings.authId)).rejects.toMatchObject(RECHAZO)
  })

  it("rechaza al contador, aunque tenga todos los permisos de consulta", async () => {
    const e = await escenario()
    const contador = await crearVendedor(db, {
      empresa: e.empresa,
      permisos: ["sales-history", "inventory-all", "products-read", "settings"],
    })

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

    await expect(reporte(contador.authId)).rejects.toMatchObject(RECHAZO)
  })

  it("rechaza a un administrador con cambio de contraseña pendiente o inactivo", async () => {
    const e = await escenario()

    await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [e.admin.usuario])
    await expect(reporte(e.admin.authId)).rejects.toMatchObject(RECHAZO)
  })

  it("anon no puede ejecutarla", async () => {
    const { rows } = await db.query(
      "select has_function_privilege('anon', 'public.reporte_diario(date, uuid)', 'execute') as anon, has_function_privilege('authenticated', 'public.reporte_diario(date, uuid)', 'execute') as autenticado"
    )

    expect(rows[0]).toEqual({ anon: false, autenticado: true })
  })

  it("no muestra datos de otra empresa, ni filtrando por una ubicación ajena", async () => {
    const e = await escenario()
    const otra = await crearEmpresa(db, "Otra empresa")

    await vender(e, e.vendedor.authId)

    const propia = await reporte(otra.authId)
    expect(propia.indicadores).toMatchObject({ ventas_total: 0, ventas_cantidad: 0 })
    expect(propia.ventas).toEqual([])
    expect(propia.por_ubicacion.map((u) => u.ubicacion)).not.toContain("Camión 01")

    const ajena = await reporte(otra.authId, null, e.camion1)
    expect(ajena.indicadores.ventas_total).toBe(0)
    expect(ajena.ventas).toEqual([])
    expect(ajena.movimientos).toEqual([])
    expect(ajena.por_ubicacion).toEqual([])
  })
})

describe("reporte_diario: lo que no hace", () => {
  it("no expone costos ni corre con privilegios ajenos", async () => {
    const e = await escenario()

    await db.query("update productos set costo = 77.77 where id = $1", [e.cargador.id])
    await vender(e, e.vendedor.authId)

    const texto = JSON.stringify(await reporte(e.admin.authId))

    expect(texto).not.toMatch(/costo|margen|utilidad/i)
    expect(texto).not.toContain("77.77")

    const { rows } = await db.query(
      "select prosecdef, provolatile, prosrc from pg_proc where proname = 'reporte_diario'"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].prosecdef).toBe(false)
    expect(rows[0].provolatile).toBe("s")
    expect(rows[0].prosrc).not.toMatch(/\bcosto\b/i)
  })

  it("la migración se puede aplicar dos veces", async () => {
    const sql = readFileSync(new URL("../supabase/migrations/0038_reporte_diario.sql", import.meta.url), "utf8")

    await db.query(sql)

    const { rows } = await db.query("select count(*)::int as n from pg_proc where proname = 'reporte_diario'")
    expect(rows[0].n).toBe(1)
  })

  it("no escribe: correlativos, ventas y movimientos quedan igual", async () => {
    const e = await escenario()

    await vender(e, e.vendedor.authId)

    const foto = async () =>
      (
        await db.query(
          `select
             (select count(*) from ventas) as ventas,
             (select count(*) from movimientos_inventario) as movimientos,
             (select to_jsonb(x) from (select proximo_correlativo_factura, proximo_correlativo_interno from empresas where id = $1) x) as correlativos`,
          [e.empresa]
        )
      ).rows[0]

    const antes = await foto()
    await reporte(e.admin.authId)

    expect(await foto()).toEqual(antes)
  })
})
