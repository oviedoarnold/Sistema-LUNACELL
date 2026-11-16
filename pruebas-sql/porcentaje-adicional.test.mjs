/*
  0044 contra PostgreSQL de verdad: el porcentaje adicional de tarjeta y enlace,
  configurable por el administrador, auditado, y guardado con cada cobro.

  Las ventas, abonos, anulaciones y conciliaciones se hacen con las funciones que usa
  la aplicación. Lo que la 0044 hace sobre una base con operaciones está en
  porcentaje-adicional-migracion.test.mjs.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"
import { conciliar, escenarioSinConexion, existencia, fallo, ventaSinConexion } from "./escenario-sin-conexion.mjs"

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

// El cargador a 100 sin ISV: diez unidades son 1,000, como el ejemplo del requerimiento.
async function escenario() {
  const e = await escenarioSinConexion(db, { enCamion1: 100 })
  const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["settings", "sales-history"] })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  // Cobrar abonos es de quien tiene el historial de ventas.
  await db.query(
    "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'sales-history') on conflict do nothing",
    [e.vendedor.usuario, e.empresa]
  )

  return { ...e, contador }
}

// Como lo calcula el POS: en centavos y puntos básicos, sin decimales binarios.
const cargoDe = (monto, tasa) => Math.round((Math.round(monto * 100) * Math.round(tasa * 100)) / 10000) / 100

const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })
const conTasa = (medio, monto, tasa = 1.7) => ({ medio, monto, referencia: "", tasa, cargo: cargoDe(monto, tasa) })

const vender = (e, cobros, { cantidad = 10, forma = "contado", clave = null, authId = e.vendedor.authId } = {}) =>
  unaFila(
    authId,
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
       p_fecha_vencimiento => $5, p_clave_idempotencia => $6, p_con_isv => false) as r`,
    [
      JSON.stringify([{ producto_id: e.cargador.id, cantidad }]),
      forma,
      JSON.stringify(cobros),
      forma === "credito" ? e.clienteId : null,
      forma === "credito" ? "2030-01-01" : null,
      clave,
    ]
  )

const abonar = (e, monto, cobros, clave = null) =>
  unaFila(
    e.vendedor.authId,
    `select public.registrar_pago_con_medios(p_cliente_id => $1, p_monto => $2, p_cobros => $3::jsonb, p_clave_idempotencia => $4) as r`,
    [e.clienteId, monto, JSON.stringify(cobros), clave]
  )

const configurar = (authId, tarjeta, enlace) =>
  unaFila(authId, "select public.configurar_cargos_por_medio($1, $2) as r", [tarjeta, enlace])

const tasasDe = async (empresa) =>
  (await db.query("select tasa_cargo_tarjeta::float8 as tarjeta, tasa_cargo_enlace::float8 as enlace from empresas where id = $1", [empresa])).rows[0]

const laVenta = async (id) =>
  (await db.query("select total::float8 as total, cargo_por_medio::float8 as cargo, tasa_cargo::float8 as tasa from ventas where id = $1", [id])).rows[0]

const cobrosDe = async (columna, id) =>
  (
    await db.query(
      `select medio, monto::float8 as monto, cargo::float8 as cargo, tasa_cargo::float8 as tasa
         from cobros_por_medio where ${columna} = $1 order by medio`,
      [id]
    )
  ).rows

const historial = async (empresa) =>
  (
    await db.query(
      `select medio, tasa_anterior::float8 as anterior, tasa_nueva::float8 as nueva, cambiado_por, cambiado_por_nombre as nombre
         from cambios_de_cargo_por_medio where empresa_id = $1 order by id`,
      [empresa]
    )
  ).rows

// Con medios, como lo manda el teléfono.
const PARAMETROS_SIN_CONEXION = `
  p_clave_idempotencia => $1, p_usuario_auth => $2, p_ubicacion_id => $3,
  p_dispositivo => $4, p_numero_provisional => $5, p_registrada_en => $6,
  p_reloj_dispositivo => $7, p_tasa_isv => $8, p_renglones => $9::jsonb,
  p_total_cobrado => $10, p_forma_pago => $11, p_cobros => $12::jsonb, p_cliente_id => $13,
  p_nombre_cliente => $14, p_rtn_comprador => $15, p_fecha_vencimiento => $16, p_nota => $17`

const sincronizar = (authId, v, cobros, funcion = "sincronizar_venta_con_medios", extra = "") =>
  unaFila(
    authId,
    `select public.${funcion}(${PARAMETROS_SIN_CONEXION}${extra}) as r`,
    [
      v.clave_idempotencia, v.usuario_auth, v.ubicacion_id, v.dispositivo, v.numero_provisional, v.registrada_en,
      v.reloj_dispositivo, v.tasa_isv, JSON.stringify(v.renglones), v.total_cobrado, v.forma_pago,
      JSON.stringify(cobros), v.cliente_id, v.nombre_cliente, v.rtn_comprador, v.fecha_vencimiento, v.nota,
      ...(extra ? ["lote-1"] : []),
    ]
  )

// Diez cargadores sin ISV: 1,000. `despues` la fecha la pone después de lo que acaba de pasar.
const ventaDelTelefono = (e, { despues = false } = {}) => {
  const ahora = Date.now() + (despues ? 30000 : 0)
  const cambios = despues ? { registrada_en: new Date(ahora).toISOString(), reloj_dispositivo: new Date(ahora).toISOString() } : {}

  return ventaSinConexion(e, {
    tasa_isv: 0,
    renglones: [{ producto_id: e.cargador.id, codigo: e.cargador.codigo, nombre: e.cargador.nombre, cantidad: 10, precio_unitario: 100 }],
    ...cambios,
  })
}

describe("la tasa de la empresa", () => {
  it("nace en 1.7 % para tarjeta y para enlace", async () => {
    const e = await escenario()

    expect(await tasasDe(e.empresa)).toEqual({ tarjeta: 1.7, enlace: 1.7 })
  })

  it("el administrador cambia cada una por separado, y queda en el historial con quién, cuándo, antes y después", async () => {
    const e = await escenario()
    const r = await configurar(e.admin.authId, 2, 1.5)

    expect(r).toEqual({ tarjeta: 2, enlace: 1.5 })
    expect(await tasasDe(e.empresa)).toEqual({ tarjeta: 2, enlace: 1.5 })

    const nombre = (await db.query("select nombre from usuarios where id = $1", [e.admin.usuario])).rows[0].nombre

    expect(await historial(e.empresa)).toEqual([
      { medio: "tarjeta", anterior: 1.7, nueva: 2, cambiado_por: e.admin.usuario, nombre },
      { medio: "enlace", anterior: 1.7, nueva: 1.5, cambiado_por: e.admin.usuario, nombre },
    ])

    // Solo lo que cambia: guardar el mismo valor no agrega nada.
    await configurar(e.admin.authId, 2, 1.7)

    expect((await historial(e.empresa)).map((c) => [c.medio, c.anterior, c.nueva])).toEqual([
      ["tarjeta", 1.7, 2],
      ["enlace", 1.7, 1.5],
      ["enlace", 1.5, 1.7],
    ])

    const { rows } = await db.query("select cambiado_en from cambios_de_cargo_por_medio where empresa_id = $1", [e.empresa])

    expect(rows.every((f) => f.cambiado_en instanceof Date)).toBe(true)
  })

  it.each([["vendedor"], ["contador"]])("el %s no la cambia, ni por la función ni escribiendo la tabla", async (rol) => {
    const e = await escenario()
    const quien = rol === "vendedor" ? e.vendedor.authId : e.contador.authId

    expect((await fallo(configurar(quien, 5, 5))).code).toBe("42501")

    // Directo a la tabla: al vendedor la política no le deja ninguna fila; al contador, su disparador lo detiene.
    const directo = await como(quien, "update empresas set tasa_cargo_tarjeta = 5 where id = $1", [e.empresa]).catch((error) => error)

    expect(rol === "vendedor" ? directo.rowCount : directo.code).toBe(rol === "vendedor" ? 0 : "42501")
    expect(await tasasDe(e.empresa)).toEqual({ tarjeta: 1.7, enlace: 1.7 })
    expect(await historial(e.empresa)).toEqual([])
  })

  it.each([
    ["mayor que 100", 100.01, 1.7],
    ["negativa", -1, 1.7],
    ["con tres decimales", 1.755, 1.7],
    ["vacía", null, 1.7],
  ])("rechaza una tasa %s (LM006) y no cambia nada", async (_, tarjeta, enlace) => {
    const e = await escenario()

    expect((await fallo(configurar(e.admin.authId, tarjeta, enlace))).code).toBe("LM006")
    expect(await tasasDe(e.empresa)).toEqual({ tarjeta: 1.7, enlace: 1.7 })
  })

  it("acepta 0 y 100, los extremos", async () => {
    const e = await escenario()

    expect(await configurar(e.admin.authId, 0, 100)).toEqual({ tarjeta: 0, enlace: 100 })
  })

  it("cada empresa cambia solo la suya, y solo su administrador lee su historial", async () => {
    const e = await escenario()
    const otra = await crearEmpresa(db, "Otra")

    await configurar(e.admin.authId, 2, 2)

    expect(await tasasDe(otra.empresa)).toEqual({ tarjeta: 1.7, enlace: 1.7 })

    const leer = async (authId) =>
      (await como(authId, "select empresa_id from cambios_de_cargo_por_medio")).rows.map((f) => f.empresa_id)

    expect(await leer(e.admin.authId)).toEqual([e.empresa, e.empresa])
    expect(await leer(otra.authId)).toEqual([])
    expect(await leer(e.vendedor.authId)).toEqual([])
    expect(await leer(e.contador.authId)).toEqual([])
  })

  it("el historial no se escribe desde la aplicación, ni se modifica o borra", async () => {
    const e = await escenario()

    await configurar(e.admin.authId, 2, 1.7)

    const insertar = await como(
      e.admin.authId,
      "insert into cambios_de_cargo_por_medio (empresa_id, medio, tasa_anterior, tasa_nueva, cambiado_por_nombre) values ($1, 'tarjeta', 1, 2, 'x')",
      [e.empresa]
    ).catch((error) => error)

    expect(insertar.code).toBe("42501")

    // Ni el dueño de la base.
    expect((await fallo(db.query("update cambios_de_cargo_por_medio set tasa_nueva = 9 where empresa_id = $1", [e.empresa]))).code).toBe("42501")
    expect((await fallo(db.query("delete from cambios_de_cargo_por_medio where empresa_id = $1", [e.empresa]))).code).toBe("42501")
  })

  it("un cambio fuera de la aplicación también queda, sin usuario", async () => {
    const e = await escenario()

    await db.query("update empresas set tasa_cargo_enlace = 3 where id = $1", [e.empresa])

    expect(await historial(e.empresa)).toEqual([
      { medio: "enlace", anterior: 1.7, nueva: 3, cambiado_por: null, nombre: "Fuera de la aplicación" },
    ])
  })
})

describe("en el POS", () => {
  it.each([
    ["efectivo", efectivo(1000), 0],
    ["transferencia", { medio: "transferencia", monto: 1000, referencia: "" }, 0],
    ["tarjeta", conTasa("tarjeta", 1000), 17],
    ["enlace", conTasa("enlace", 1000), 17],
  ])("1,000 con %s: el cargo es %d, y la venta sigue siendo 1,000", async (medio, cobro, cargo) => {
    const e = await escenario()
    const venta = await vender(e, [cobro])

    expect(await laVenta(venta.venta_id)).toMatchObject({ total: 1000, cargo })
    expect((await cobrosDe("venta_id", venta.venta_id))[0]).toMatchObject({ medio, cargo, tasa: cargo ? 1.7 : 0 })
  })

  it("mixto: 600 en efectivo y 400 con tarjeta llevan 6.80, y se cobran 1,006.80", async () => {
    const e = await escenario()
    const venta = await vender(e, [efectivo(600), conTasa("tarjeta", 400)])

    expect(await laVenta(venta.venta_id)).toEqual({ total: 1000, cargo: 6.8, tasa: 1.7 })
    expect(await cobrosDe("venta_id", venta.venta_id)).toEqual([
      { medio: "efectivo", monto: 600, cargo: 0, tasa: 0 },
      { medio: "tarjeta", monto: 400, cargo: 6.8, tasa: 1.7 },
    ])
  })

  it("el servidor no se fía de la tasa que manda el navegador", async () => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)

    // Una tasa que no es la vigente, aunque el cargo cuadre con ella.
    for (const cobro of [conTasa("tarjeta", 1000, 0), conTasa("tarjeta", 1000, 7), conTasa("enlace", 1000, 1)]) {
      const error = await fallo(vender(e, [cobro]))

      expect(error.code).toBe("LM007")
      expect(error.message).toMatch(/el porcentaje adicional de (tarjeta|enlace de pago) es 1\.7 %/i)
    }

    // Un cargo que no cuadra con la tasa que declara.
    expect((await fallo(vender(e, [{ ...conTasa("tarjeta", 1000), cargo: 16.99 }]))).code).toBe("LM001")

    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
    expect((await db.query("select count(*)::int as n from ventas where empresa_id = $1", [e.empresa])).rows[0].n).toBe(0)
  })

  it("después de un cambio, lo calculado con la tasa anterior se rechaza y lo de la nueva entra; lo anterior queda intacto", async () => {
    const e = await escenario()
    const antes = await vender(e, [conTasa("tarjeta", 1000)])

    await configurar(e.admin.authId, 2, 1.5)

    const error = await fallo(vender(e, [conTasa("tarjeta", 1000)]))

    expect(error.code).toBe("LM007")
    expect(error.message).toBe("El porcentaje adicional de Tarjeta es 2 %. Revisa el total y vuelve a confirmar.")

    const tarjeta = await vender(e, [conTasa("tarjeta", 1000, 2)])
    const enlace = await vender(e, [conTasa("enlace", 1000, 1.5)])

    expect(await laVenta(tarjeta.venta_id)).toEqual({ total: 1000, cargo: 20, tasa: 2 })
    expect(await laVenta(enlace.venta_id)).toEqual({ total: 1000, cargo: 15, tasa: 1.5 })
    expect(await laVenta(antes.venta_id)).toEqual({ total: 1000, cargo: 17, tasa: 1.7 })
    expect(await cobrosDe("venta_id", antes.venta_id)).toEqual([{ medio: "tarjeta", monto: 1000, cargo: 17, tasa: 1.7 }])
  })

  it("tarjeta y enlace con distinta tasa: cada cobro guarda la suya, y la venta no inventa una", async () => {
    const e = await escenario()

    await configurar(e.admin.authId, 2, 1.5)

    const venta = await vender(e, [conTasa("tarjeta", 600, 2), conTasa("enlace", 400, 1.5)])

    expect(await laVenta(venta.venta_id)).toEqual({ total: 1000, cargo: 18, tasa: null })
    expect((await cobrosDe("venta_id", venta.venta_id)).map((c) => [c.medio, c.cargo, c.tasa])).toEqual([
      ["enlace", 6, 1.5],
      ["tarjeta", 12, 2],
    ])
  })

  it("un reintento de una venta cobrada antes del cambio devuelve la misma venta, sin rechazarla", async () => {
    const e = await escenario()
    const cobros = [conTasa("tarjeta", 1000)]
    const primera = await vender(e, cobros, { clave: "antes-del-cambio" })

    await configurar(e.admin.authId, 2, 2)

    const segunda = await vender(e, cobros, { clave: "antes-del-cambio" })

    expect(segunda).toMatchObject({ repetida: true, venta_id: primera.venta_id })
    expect(await cobrosDe("venta_id", primera.venta_id)).toHaveLength(1)
  })

  it("con la tasa en 0, tarjeta no lleva cargo y guarda 0", async () => {
    const e = await escenario()

    await configurar(e.admin.authId, 0, 1.7)

    const venta = await vender(e, [conTasa("tarjeta", 1000, 0)])

    expect(await laVenta(venta.venta_id)).toEqual({ total: 1000, cargo: 0, tasa: 0 })
  })
})

describe("en los abonos", () => {
  it("un abono de 400 con tarjeta recibe 406.80 y baja la deuda 400", async () => {
    const e = await escenario()

    await vender(e, [], { forma: "credito" })

    const pago = await abonar(e, 400, [conTasa("tarjeta", 400)])
    const { rows } = await db.query("select monto::float8 as monto, cargo_por_medio::float8 as cargo, tasa_cargo::float8 as tasa from pagos where id = $1", [pago.pago_id])

    expect(rows[0]).toEqual({ monto: 400, cargo: 6.8, tasa: 1.7 })
    expect(rows[0].monto + rows[0].cargo).toBe(406.8)
    expect((await db.query("select sum(monto)::float8 as s from abonos where pago_id = $1", [pago.pago_id])).rows[0].s).toBe(400)
    expect(Number(pago.saldo_anterior) - Number(pago.saldo_posterior)).toBe(400)
    expect(await cobrosDe("pago_id", pago.pago_id)).toEqual([{ medio: "tarjeta", monto: 400, cargo: 6.8, tasa: 1.7 }])
  })

  it("con la tasa anterior se rechaza sin registrar el abono; con la vigente entra", async () => {
    const e = await escenario()

    await vender(e, [], { forma: "credito" })
    await configurar(e.admin.authId, 2, 2)

    expect((await fallo(abonar(e, 400, [conTasa("tarjeta", 400)]))).code).toBe("LM007")
    expect((await db.query("select count(*)::int as n from pagos where empresa_id = $1", [e.empresa])).rows[0].n).toBe(0)

    const pago = await abonar(e, 400, [conTasa("tarjeta", 400, 2)])

    expect(await cobrosDe("pago_id", pago.pago_id)).toEqual([{ medio: "tarjeta", monto: 400, cargo: 8, tasa: 2 }])
  })
})

describe("anulaciones y reportes", () => {
  it("al anular después de un cambio se devuelve el cargo que se cobró, no uno nuevo", async () => {
    const e = await escenario()
    const venta = await vender(e, [conTasa("tarjeta", 1000)])

    await configurar(e.admin.authId, 2, 2)
    await unaFila(e.admin.authId, "select public.anular_venta($1, 'Se equivocó de producto', 'reembolso_pendiente', 'anular-1') as r", [venta.venta_id])

    const { rows } = await db.query("select total::float8 as total, cargo_a_devolver::float8 as cargo from anulaciones_venta where venta_id = $1", [venta.venta_id])

    expect(rows[0]).toEqual({ total: 1000, cargo: 17 })
  })

  it("el reporte dice con qué tasa se cobró cada venta y cada abono", async () => {
    const e = await escenario()
    const venta = await vender(e, [efectivo(600), conTasa("tarjeta", 400)])

    await configurar(e.admin.authId, 2, 2)
    await vender(e, [], { forma: "credito", cantidad: 5 })

    const pago = await abonar(e, 100, [conTasa("enlace", 100, 2)])
    const r = await unaFila(e.admin.authId, "select public.reporte_medios_de_pago() as r")
    const abono = (await db.query("select id from abonos where pago_id = $1", [pago.pago_id])).rows[0].id

    expect(r.por_venta[venta.venta_id]).toEqual([
      { medio: "efectivo", monto: 600, cargo: 0, tasa: 0, referencia: "" },
      { medio: "tarjeta", monto: 400, cargo: 6.8, tasa: 1.7, referencia: "" },
    ])
    expect(r.por_abono[abono]).toEqual([
      { medio: "enlace", monto: 100, cargo: 2, tasa: 2, referencia: "" },
    ])
    expect(r.totales).toMatchObject({ cargos: 8.8 })
  })
})

describe("sin conexión", () => {
  it("con la tasa que regía al vender entra directo, y guarda esa tasa", async () => {
    const e = await escenario()
    const r = await sincronizar(e.vendedor.authId, ventaDelTelefono(e), [conTasa("tarjeta", 1000)])

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toEqual({ total: 1000, cargo: 17, tasa: 1.7 })
  })

  it("vendida antes del cambio y sincronizada después: entra con la tasa de su momento", async () => {
    const e = await escenario()
    const venta = ventaDelTelefono(e)

    await configurar(e.admin.authId, 2, 2)

    const r = await sincronizar(e.vendedor.authId, venta, [conTasa("tarjeta", 1000)])

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toEqual({ total: 1000, cargo: 17, tasa: 1.7 })
  })

  it("vendida después del cambio con la tasa vieja: va a conciliación, conserva lo cobrado y no se duplica", async () => {
    const e = await escenario()

    await configurar(e.admin.authId, 2, 2)

    const venta = ventaDelTelefono(e, { despues: true })
    const cobros = [conTasa("tarjeta", 1000)]
    const r = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
    expect(r.detalle).toBe("Tarjeta se cobró con 1.7 %, y en la fecha de la venta regía 2 %")

    const otra = await sincronizar(e.vendedor.authId, venta, cobros)

    expect(otra.estado).toBe("ya_en_conciliacion")
    expect(otra.conciliacion_id).toBe(r.conciliacion_id)

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await laVenta(aplicada.venta_id)).toEqual({ total: 1000, cargo: 17, tasa: 1.7 })
    expect((await db.query("select count(*)::int as n from ventas where empresa_id = $1", [e.empresa])).rows[0].n).toBe(1)
  })

  it("un reintento con otros medios para la misma clave se rechaza (OF003)", async () => {
    const e = await escenario()
    const venta = ventaDelTelefono(e)

    await sincronizar(e.vendedor.authId, venta, [conTasa("tarjeta", 1000)])

    expect((await fallo(sincronizar(e.vendedor.authId, venta, [efectivo(1000)]))).code).toBe("OF003")
  })

  it("un rescate va a conciliación con la tasa que declaró el teléfono", async () => {
    const e = await escenario()
    const r = await sincronizar(e.admin.authId, ventaDelTelefono(e), [conTasa("enlace", 1000)], "rescatar_venta_con_medios", ", p_lote => $18")

    expect(r.estado).toBe("en_conciliacion")

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await cobrosDe("venta_id", aplicada.venta_id)).toEqual([{ medio: "enlace", monto: 1000, cargo: 17, tasa: 1.7 }])
  })
})

describe("seguridad", () => {
  it("las piezas internas no son llamables desde la aplicación; cambiar la tasa sí, y la decide la función", async () => {
    const { rows } = await db.query(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as app,
             has_function_privilege('anon', p.oid, 'execute') as anonimo
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('tasa_de_cargo', 'cargo_de_cobro', 'cargo_de_cobros_distinto', 'cobros_con_tasa', 'tasa_de_cargo_de',
                           'anotar_cambio_de_cargo', 'cambio_de_cargo_inmutable', 'recibir_venta_sin_conexion', 'configurar_cargos_por_medio')
       order by p.proname`)

    expect(rows.filter((f) => f.app).map((f) => f.proname)).toEqual(["configurar_cargos_por_medio"])
    expect(rows.filter((f) => f.anonimo)).toEqual([])
    expect(rows).toHaveLength(9)
  })

  it("ya no existe el cálculo con el 7 % escrito", async () => {
    const { rows } = await db.query(`
      select p.oid::regprocedure::text as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'cargo_de_cobro'`)

    expect(rows.map((f) => f.firma)).toEqual(["cargo_de_cobro(text,numeric,numeric)"])
  })
})
