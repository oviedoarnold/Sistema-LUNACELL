/*
  0036 contra PostgreSQL de verdad: el contador consulta y no escribe.

  Se le dan a propósito permisos de más —`pos`, `products`,
  `sales-history`, `sales-void`, `quotes`, `clients`, `suppliers`,
  `inventory-all`, `locations`— para comprobar que la solo lectura no
  depende de que el administrador se acuerde de no marcarlos: la base lo
  detiene igual, por la API directa y por las funciones SECURITY DEFINER.

  Y lo que no se rompe: el contador lee lo que se le habilitó, de todas las
  ubicaciones, y los demás roles siguen operando.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, crearCliente, contar } from "./fixtures.mjs"

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

const RECHAZO = { code: "42501" }

const TODOS_LOS_PERMISOS = [
  "dashboard", "pos", "quotes", "products", "clients", "suppliers",
  "sales-history", "sales-void", "locations", "settings", "inventory-all",
]

async function crearContador(empresa, permisos = TODOS_LOS_PERMISOS) {
  const contador = await crearVendedor(db, { empresa, permisos })

  await db.query("update usuarios set rol = 'contador' where id = $1", [contador.usuario])

  return contador
}

/*
  Una empresa con dos ubicaciones, un vendedor en cada una y una venta a
  crédito de cada uno; el administrador; un contador con todos los
  permisos y otro solo con el inventario.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")

  const ubicacion = async (nombre, tipo) =>
    (
      await db.query(
        "insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id",
        [a.empresa, nombre, tipo]
      )
    ).rows[0].id

  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")

  await db.query("update usuarios set ubicacion_id = $1 where id = $2", [camion1, a.usuario])

  const cargador = (
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, 'C-1', 'Cargador', 100, 40) returning id`,
      [a.empresa]
    )
  ).rows[0].id

  for (const u of [camion1, camion2]) {
    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 20)`,
      [a.empresa, u, cargador]
    )
  }

  const clienteId = await crearCliente(db, a.empresa)
  const proveedorId = (
    await db.query("insert into proveedores (empresa_id, nombre) values ($1, 'Proveedor') returning id", [a.empresa])
  ).rows[0].id

  const permisosVendedor = ["pos", "quotes", "clients", "sales-history", "inventory-own"]
  const vendedor1 = await crearVendedor(db, { empresa: a.empresa, ubicacion: camion1, permisos: permisosVendedor })
  const vendedor2 = await crearVendedor(db, { empresa: a.empresa, ubicacion: camion2, permisos: permisosVendedor })

  const venderA = async (authId) => {
    await comoUsuario(db, authId)
    try {
      return (
        await db.query(
          "select registrar_venta_ubicacion($1::jsonb, 'credito', $2) as res",
          [JSON.stringify([{ producto_id: cargador, cantidad: 1 }]), clienteId]
        )
      ).rows[0].res
    } finally {
      await comoDueno(db)
    }
  }

  const venta1 = await venderA(vendedor1.authId)
  const venta2 = await venderA(vendedor2.authId)

  const contador = await crearContador(a.empresa)
  const contadorInventario = await crearContador(a.empresa, ["inventory-all"])

  return {
    a, camion1, camion2, cargador, clienteId, proveedorId,
    vendedor1, vendedor2, venta1, venta2, contador, contadorInventario,
  }
}

describe("0036: el contador consulta", () => {
  it("lee las ventas, los abonos y los pagos de todas las ubicaciones con `sales-history`", async () => {
    const e = await escenario()

    const ventas = await como(e.contador.authId, "select id from ventas order by fecha")
    expect(ventas.rows.map((r) => r.id).sort()).toEqual([e.venta1.venta_id, e.venta2.venta_id].sort())

    const detalle = await como(e.contador.authId, "select count(*)::int as n from detalle_venta")
    expect(detalle.rows[0].n).toBe(2)
  })

  it("sin `sales-history` no ve ninguna venta", async () => {
    const e = await escenario()

    const { rows } = await como(e.contadorInventario.authId, "select id from ventas")
    expect(rows).toEqual([])
  })

  it("lee el inventario de todas las ubicaciones con `inventory-all`, y el precio sin el costo", async () => {
    const e = await escenario()

    const existencias = await como(e.contadorInventario.authId, "select ubicacion_id from inventario_ubicacion")
    expect(existencias.rows).toHaveLength(2)

    const catalogo = await como(e.contadorInventario.authId, "select precio from productos_con_stock")
    expect(catalogo.rows).toEqual([{ precio: "100.00" }])

    await expect(como(e.contadorInventario.authId, "select costo from productos")).rejects.toMatchObject(RECHAZO)
  })

  it("no es administrador: no ve usuarios ajenos ni costos", async () => {
    const e = await escenario()

    const usuarios = await como(e.contador.authId, "select id from usuarios")
    expect(usuarios.rows).toEqual([{ id: e.contador.usuario }])

    await expect(como(e.contador.authId, "select * from costos_de_productos()")).rejects.toMatchObject(RECHAZO)
  })
})

describe("0036: 6. el contador no modifica nada por llamadas directas", () => {
  it("ni por la API directa sobre las tablas", async () => {
    const e = await escenario()

    const intentos = [
      ["insert into clientes (empresa_id, nombre) values ($1, 'Nuevo')", [e.a.empresa]],
      ["update clientes set nombre = 'Cambiado' where id = $1", [e.clienteId]],
      ["update productos set precio = 1 where id = $1", [e.cargador]],
      ["insert into productos (empresa_id, codigo, nombre, precio) values ($1, 'X', 'X', 1)", [e.a.empresa]],
      ["delete from proveedores where id = $1", [e.proveedorId]],
      ["update proveedores set nombre = 'Cambiado' where id = $1", [e.proveedorId]],
      ["update ubicaciones set nombre = 'Cambiada' where id = $1", [e.camion1]],
      ["insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'settings')", [e.contador.usuario, e.a.empresa]],
      ["update usuarios set rol = 'admin' where id = $1", [e.contador.usuario]],
      ["insert into cotizaciones (empresa_id, usuario_id, numero, nombre_cliente, subtotal, isv, total) values ($1, $2, 'COT-X', 'X', 1, 0, 1)", [e.a.empresa, e.contador.usuario]],
    ]

    for (const [consulta, valores] of intentos) {
      await expect(como(e.contador.authId, consulta, valores), consulta).rejects.toMatchObject(RECHAZO)
    }

    const { rows } = await db.query("select rol from usuarios where id = $1", [e.contador.usuario])
    expect(rows[0].rol).toBe("contador")
    expect(await contar(db, "clientes", "nombre in ('Nuevo', 'Cambiado')")).toBe(0)
  })

  it("ni por las funciones de venta, cobro, inventario, traslado y anulación", async () => {
    const e = await escenario()

    const intentos = [
      ["select registrar_venta_ubicacion($1::jsonb)", [JSON.stringify([{ producto_id: e.cargador, cantidad: 1 }])]],
      ["select registrar_pago_cliente($1, 10)", [e.clienteId]],
      ["select registrar_movimiento_ubicacion($1, $2, 'entrada', 5, 'x')", [e.cargador, e.camion1]],
      ["select registrar_traslado($1, $2, $3::jsonb)", [e.camion1, e.camion2, JSON.stringify([{ producto_id: e.cargador, cantidad: 1 }])]],
      ["select anular_venta($1, 'Error de captura', 'devolucion_efectivo')", [e.venta1.venta_id]],
    ]

    for (const [consulta, valores] of intentos) {
      await expect(como(e.contador.authId, consulta, valores), consulta).rejects.toBeTruthy()
    }

    expect(await contar(db, "ventas", "empresa_id = $1", [e.a.empresa])).toBe(2)
    expect(await contar(db, "pagos", "empresa_id = $1", [e.a.empresa])).toBe(0)
    expect(await contar(db, "traslados", "empresa_id = $1", [e.a.empresa])).toBe(0)
    expect(await contar(db, "anulaciones_venta", "empresa_id = $1", [e.a.empresa])).toBe(0)

    const { rows } = await db.query(
      "select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2",
      [e.camion1, e.cargador]
    )
    expect(rows[0].cantidad).toBe(19)
  })

  it("el rechazo lo da el disparador aunque la función lo deje pasar", async () => {
    const e = await escenario()

    // El contador tiene `pos` y `sales-history`: las funciones solas lo dejarían cobrar.
    await expect(
      como(e.contador.authId, "insert into clientes (empresa_id, nombre) values ($1, 'X')", [e.a.empresa])
    ).rejects.toThrow(/solo consulta/)
  })

  it("una cuenta de contador inactiva o con contraseña pendiente tampoco escribe", async () => {
    const e = await escenario()

    await db.query("update usuarios set activo = false where id = $1", [e.contador.usuario])
    await expect(
      como(e.contador.authId, "update clientes set nombre = 'X' where id = $1", [e.clienteId])
    ).rejects.toMatchObject(RECHAZO)
  })

  it("cada tabla de `public` lleva el disparador", async () => {
    const { rows } = await db.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and not exists (
            select 1 from pg_trigger t
             where t.tgrelid = c.oid
               and t.tgname = 'impedir_escritura_del_contador'
          )`
    )

    expect(rows).toEqual([])
  })
})

describe("0036: los demás roles siguen operando", () => {
  it("el vendedor vende y cobra; el administrador edita y anula", async () => {
    const e = await escenario()

    const pago = await como(e.vendedor1.authId, "select registrar_pago_cliente($1, 10) as res", [e.clienteId])
    expect(pago.rows[0].res.pago_id).toBeTruthy()

    await como(e.a.authId, "update clientes set nombre = 'Corregido' where id = $1", [e.clienteId])
    expect(await contar(db, "clientes", "nombre = 'Corregido'")).toBe(1)
  })

  it("el vendedor sigue viendo solo su ubicación", async () => {
    const e = await escenario()

    const { rows } = await como(e.vendedor1.authId, "select id from ventas")
    expect(rows.map((r) => r.id)).toEqual([e.venta1.venta_id])
  })

  it("la base solo acepta los tres roles", async () => {
    const e = await escenario()

    await expect(
      db.query("update usuarios set rol = 'auditor' where id = $1", [e.contador.usuario])
    ).rejects.toMatchObject({ code: "23514" })
  })
})
