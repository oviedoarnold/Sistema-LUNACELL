/*
  0042 contra PostgreSQL de verdad: productos habituales y precios por cliente.

  Las ventas y los cobros se hacen con las funciones que usa la aplicación. El
  cargador vale 100 de precio general y lleva 15 % de ISV.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearCliente, crearEmpresa, crearVendedor } from "./fixtures.mjs"
import {
  conciliar,
  escenarioSinConexion,
  existencia,
  fallo,
  sincronizar as sincronizarSinMedios,
  totalDe,
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

const guardar = (authId, cliente, precios) =>
  como(authId, "select public.guardar_precios_de_cliente($1, $2::jsonb) as r", [cliente, JSON.stringify(precios)])

const leer = async (cliente) =>
  (
    await db.query(
      "select producto_id, precio::float8 as precio from precios_por_cliente where cliente_id = $1 order by producto_id",
      [cliente]
    )
  ).rows

const vender = (e, authId, cobros, { cliente = null, forma = "contado", clave = null, venc = null, conIsv = true, cantidad = 1 } = {}) =>
  unaFila(
    authId,
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => $2, p_cobros => $3::jsonb, p_cliente_id => $4,
       p_fecha_vencimiento => $5, p_clave_idempotencia => $6, p_con_isv => $7) as r`,
    [JSON.stringify([{ producto_id: e.cargador.id, cantidad }]), forma, JSON.stringify(cobros), cliente, venc, clave, conIsv]
  )

const laVenta = async (id) =>
  (
    await db.query(
      `select v.subtotal::float8 as subtotal, v.isv::float8 as isv, v.total::float8 as total,
              v.cargo_por_medio::float8 as cargo, d.precio::float8 as precio
         from ventas v join detalle_venta d on d.venta_id = v.id where v.id = $1`,
      [id]
    )
  ).rows[0]

const efectivo = (monto) => ({ medio: "efectivo", monto })

async function escenario() {
  const e = await escenarioSinConexion(db, { enCamion1: 100 })
  const clienteB = await crearCliente(db, e.empresa, "Cliente B")
  const clienteSinPrecios = await crearCliente(db, e.empresa, "Cliente sin precios")

  await guardar(e.admin.authId, e.clienteId, [{ producto_id: e.cargador.id, precio: 80 }])
  await guardar(e.admin.authId, clienteB, [{ producto_id: e.cargador.id, precio: 90 }])

  return { ...e, clienteA: e.clienteId, clienteB, clienteSinPrecios }
}

describe("guardar la lista de un cliente", () => {
  it("agrega, edita y elimina en una sola operación", async () => {
    const e = await escenario()

    await guardar(e.admin.authId, e.clienteA, [
      { producto_id: e.cargador.id, precio: 70 },
      { producto_id: e.cubo.id, precio: 40 },
    ])

    expect(await leer(e.clienteA)).toHaveLength(2)

    await guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cubo.id, precio: 45.5 }])

    expect(await leer(e.clienteA)).toEqual([{ producto_id: e.cubo.id, precio: 45.5 }])
    expect(await leer(e.clienteB)).toEqual([{ producto_id: e.cargador.id, precio: 90 }])
  })

  it("actualizado_en solo cambia si cambia el precio", async () => {
    const e = await escenario()
    const fecha = async () => (await db.query("select actualizado_en from precios_por_cliente where cliente_id = $1", [e.clienteA])).rows[0].actualizado_en.getTime()
    const antes = await fecha()

    await guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 80 }])
    expect(await fecha()).toBe(antes)
  })

  it.each([
    ["un producto repetido", (e) => [{ producto_id: e.cargador.id, precio: 70 }, { producto_id: e.cargador.id, precio: 60 }]],
    ["precio en cero", (e) => [{ producto_id: e.cargador.id, precio: 0 }]],
    ["precio negativo", (e) => [{ producto_id: e.cargador.id, precio: -1 }]],
    ["más de dos decimales", (e) => [{ producto_id: e.cargador.id, precio: 70.123 }]],
    ["precio que no es número", (e) => [{ producto_id: e.cargador.id, precio: "mucho" }]],
    ["producto que no existe", () => [{ producto_id: "00000000-0000-4000-8000-000000000001", precio: 70 }]],
    ["una lista que no es lista", () => ({ precio: 70 })],
  ])("rechaza %s sin cambiar nada", async (_, lista) => {
    const e = await escenario()
    const antes = await leer(e.clienteA)
    const error = await fallo(guardar(e.admin.authId, e.clienteA, lista(e)))

    expect(error.code).toBe("LP001")
    expect(await leer(e.clienteA)).toEqual(antes)
  })

  it("un error a mitad de la lista no deja nada a medias", async () => {
    const e = await escenario()
    const antes = await leer(e.clienteA)

    await fallo(guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cubo.id, precio: 40 }, { producto_id: e.cargador.id, precio: 0 }]))

    expect(await leer(e.clienteA)).toEqual(antes)
  })

  it("la tabla no admite dos veces el mismo producto para un cliente", async () => {
    const e = await escenario()
    const error = await fallo(
      db.query("insert into precios_por_cliente (empresa_id, cliente_id, producto_id, precio) values ($1, $2, $3, 1)", [e.empresa, e.clienteA, e.cargador.id])
    )

    expect(error.code).toBe("23505")
  })
})

describe("permisos", () => {
  it("el vendedor y el contador no cambian precios, ni directamente ni por la función", async () => {
    const e = await escenario()
    const contador = await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["pos"] })

    await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

    for (const authId of [e.vendedor.authId, contador.authId]) {
      expect((await fallo(guardar(authId, e.clienteA, []))).code).toBe("42501")
      expect((await fallo(como(authId, "update public.precios_por_cliente set precio = 1"))).code).toBe("42501")
      expect((await fallo(como(authId, "delete from public.precios_por_cliente"))).code).toBe("42501")
      expect((await fallo(como(authId, "insert into public.precios_por_cliente (empresa_id, cliente_id, producto_id, precio) values ($1, $2, $3, 1)", [e.empresa, e.clienteSinPrecios, e.cargador.id]))).code).toBe("42501")
    }

    expect(await leer(e.clienteA)).toEqual([{ producto_id: e.cargador.id, precio: 80 }])
  })

  it("ni el administrador escribe directo en la tabla: solo por la función", async () => {
    const e = await escenario()

    expect((await fallo(como(e.admin.authId, "update public.precios_por_cliente set precio = 1"))).code).toBe("42501")
  })

  it("el vendedor lee los de su empresa, sin costos", async () => {
    const e = await escenario()
    const { rows } = await como(e.vendedor.authId, "select * from public.precios_por_cliente where cliente_id = $1", [e.clienteA])

    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).join()).not.toMatch(/costo|margen/i)
  })

  it("otra empresa no ve ni cambia estos precios", async () => {
    const e = await escenario()
    const otra = await crearEmpresa(db, "Otra empresa")

    expect((await como(otra.authId, "select * from public.precios_por_cliente")).rows).toEqual([])
    expect((await fallo(guardar(otra.authId, e.clienteA, []))).code).toBe("42501")
    expect((await leer(e.clienteA))).toHaveLength(1)
  })

  it("un administrador no agrega productos de otra empresa", async () => {
    const e = await escenario()
    const otra = await escenarioSinConexion(db, { enCamion1: 1 })
    const error = await fallo(guardar(e.admin.authId, e.clienteA, [{ producto_id: otra.cargador.id, precio: 10 }]))

    expect(error.code).toBe("LP001")
  })

  it("quien no entró no ejecuta nada, y las piezas internas no se llaman", async () => {
    const { rows } = await db.query(`
      select has_function_privilege('anon', 'public.guardar_precios_de_cliente(uuid, jsonb)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.precio_de_venta(uuid, uuid, uuid)', 'execute') as interna,
             has_table_privilege('anon', 'public.precios_por_cliente', 'select') as anon_lee`)

    expect(rows[0]).toEqual({ anon: false, interna: false, anon_lee: false })
  })

  it("el contador conserva su bloqueo en la tabla nueva", async () => {
    const { rows } = await db.query(`
      select count(*)::int as n from pg_trigger
       where tgname = 'impedir_escritura_del_contador' and tgrelid = 'public.precios_por_cliente'::regclass`)

    expect(rows[0].n).toBe(1)
  })
})

describe("el precio de cada venta", () => {
  it("dos clientes pagan distinto el mismo producto, y otro paga el general", async () => {
    const e = await escenario()
    const a = await vender(e, e.vendedor.authId, [efectivo(92)], { cliente: e.clienteA })
    const b = await vender(e, e.vendedor.authId, [efectivo(103.5)], { cliente: e.clienteB })
    const c = await vender(e, e.vendedor.authId, [efectivo(115)], { cliente: e.clienteSinPrecios })
    const d = await vender(e, e.vendedor.authId, [efectivo(115)])

    expect(await laVenta(a.venta_id)).toMatchObject({ precio: 80, subtotal: 80, isv: 12, total: 92 })
    expect(await laVenta(b.venta_id)).toMatchObject({ precio: 90, subtotal: 90, total: 103.5 })
    expect(await laVenta(c.venta_id)).toMatchObject({ precio: 100, total: 115 })
    expect(await laVenta(d.venta_id)).toMatchObject({ precio: 100, total: 115 })
  })

  it("un producto que no está en su lista va al precio general", async () => {
    const e = await escenario()
    const venta = await unaFila(
      e.vendedor.authId,
      `select public.registrar_venta_con_medios(
         p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb, p_cliente_id => $3) as r`,
      [JSON.stringify([{ producto_id: e.cubo.id, cantidad: 1 }]), JSON.stringify([efectivo(57.5)]), e.clienteA]
    )

    expect(await laVenta(venta.venta_id)).toMatchObject({ precio: 50, subtotal: 50, total: 57.5 })
  })

  it("el servidor decide: si los medios suman el precio general, rechaza y no descuenta", async () => {
    const e = await escenario()
    const antes = await existencia(db, e.camion1, e.cargador.id)
    const error = await fallo(vender(e, e.vendedor.authId, [efectivo(115)], { cliente: e.clienteA }))

    expect(error.code).toBe("LM002")
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(antes)
  })

  it("se integra con el cargo del 7 %, el pago mixto y el ISV por venta", async () => {
    const e = await escenario()
    const conTodo = await vender(e, e.vendedor.authId, [{ medio: "tarjeta", monto: 92, referencia: "", cargo: 6.44 }], { cliente: e.clienteA })
    const sinIsv = await vender(e, e.vendedor.authId, [efectivo(30), { medio: "enlace", monto: 50, referencia: "", cargo: 3.5 }], { cliente: e.clienteA, conIsv: false })

    expect(await laVenta(conTodo.venta_id)).toMatchObject({ total: 92, cargo: 6.44 })
    expect(await laVenta(sinIsv.venta_id)).toMatchObject({ subtotal: 80, isv: 0, total: 80, cargo: 3.5 })
  })

  it("a crédito la deuda es el total con su precio, y el abono la cubre", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [], { cliente: e.clienteA, forma: "credito", venc: "2030-01-01" })

    expect(await laVenta(venta.venta_id)).toMatchObject({ precio: 80, total: 92 })

    const pago = await unaFila(
      e.admin.authId,
      "select public.registrar_pago_con_medios(p_cliente_id => $1, p_monto => 92, p_cobros => $2::jsonb) as r",
      [e.clienteA, JSON.stringify([efectivo(92)])]
    )

    expect(pago.pago_id).toBeTruthy()
  })

  it("un reintento devuelve la misma venta y no duplica, aunque el precio haya cambiado", async () => {
    const e = await escenario()
    const primera = await vender(e, e.vendedor.authId, [efectivo(92)], { cliente: e.clienteA, clave: "precio-1" })
    const stock = await existencia(db, e.camion1, e.cargador.id)

    await guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 50 }])

    const segunda = await vender(e, e.vendedor.authId, [efectivo(92)], { cliente: e.clienteA, clave: "precio-1" })

    expect(segunda).toMatchObject({ venta_id: primera.venta_id, repetida: true, total: 92 })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
  })

  it("cambiar o quitar un precio no toca las ventas ya hechas", async () => {
    const e = await escenario()
    const venta = await vender(e, e.vendedor.authId, [efectivo(92)], { cliente: e.clienteA })
    const antes = await laVenta(venta.venta_id)

    await guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 10 }])
    expect(await laVenta(venta.venta_id)).toEqual(antes)

    await guardar(e.admin.authId, e.clienteA, [])
    expect(await laVenta(venta.venta_id)).toEqual(antes)

    const nueva = await vender(e, e.vendedor.authId, [efectivo(115)], { cliente: e.clienteA })

    expect(await laVenta(nueva.venta_id)).toMatchObject({ precio: 100 })
  })
})

describe("ventas sin conexión", () => {
  const renglon = (e, precio, cantidad = 1) => ({
    producto_id: e.cargador.id,
    codigo: e.cargador.codigo,
    nombre: e.cargador.nombre,
    cantidad,
    precio_unitario: precio,
  })

  const ventaDe = (e, cliente, precio) =>
    ventaSinConexion(e, { cliente_id: cliente, renglones: [renglon(e, precio)], total_cobrado: totalDe([renglon(e, precio)], e.tasa) })

  it("con el precio vigente del cliente entra como registrada, con ese precio", async () => {
    const e = await escenario()
    const r = await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, e.clienteA, 80))

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 80, total: 92 })
  })

  it("un reintento no duplica", async () => {
    const e = await escenario()
    const venta = ventaDe(e, e.clienteA, 80)
    const primera = await sincronizarSinMedios(db, e.vendedor.authId, venta)
    const stock = await existencia(db, e.camion1, e.cargador.id)
    const segunda = await sincronizarSinMedios(db, e.vendedor.authId, venta)

    expect(segunda).toMatchObject({ estado: "ya_registrada", venta_id: primera.venta_id })
    expect(await existencia(db, e.camion1, e.cargador.id)).toBe(stock)
  })

  it("si el precio cambió mientras estaba sin conexión, va a conciliación y conserva lo cobrado", async () => {
    const e = await escenario()
    const venta = ventaDe(e, e.clienteA, 80)

    await guardar(e.admin.authId, e.clienteA, [{ producto_id: e.cargador.id, precio: 60 }])

    const r = await sincronizarSinMedios(db, e.vendedor.authId, venta)

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })

    const aplicada = await conciliar(db, e.admin.authId, r.conciliacion_id, "aplicar")

    expect(await laVenta(aplicada.venta_id)).toMatchObject({ precio: 80, total: 92 })
  })

  it("una copia vieja que cobró el general a un cliente con especial va a conciliación", async () => {
    const e = await escenario()
    const r = await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, e.clienteA, 100))

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "precio-distinto" })
  })

  it("el especial de un cliente no vale para otro ni sin cliente", async () => {
    const e = await escenario()

    expect(await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, e.clienteB, 80))).toMatchObject({ motivo: "precio-distinto" })
    expect(await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, null, 80))).toMatchObject({ motivo: "precio-distinto" })
  })

  it("sin cliente o sin especial, el precio general sigue entrando", async () => {
    const e = await escenario()

    expect((await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, null, 100))).estado).toBe("registrada")
    expect((await sincronizarSinMedios(db, e.vendedor.authId, ventaDe(e, e.clienteSinPrecios, 100))).estado).toBe("registrada")
  })

  it("sin ISV, con especial, entra con tasa 0", async () => {
    const e = await escenario()
    const venta = { ...ventaDe(e, e.clienteA, 80), tasa_isv: 0, total_cobrado: 80 }
    const r = await sincronizarSinMedios(db, e.vendedor.authId, venta)

    expect(r.estado).toBe("registrada")
    expect(await laVenta(r.venta_id)).toMatchObject({ precio: 80, isv: 0, total: 80 })
  })
})
