/*
  SEC-3b contra PostgreSQL de verdad: clientes, proveedores y cotizaciones
  se escriben solo con el permiso de su sección.

  Hasta 0024 las cuatro tablas tenían una sola política, para todo, cuya
  única condición era la empresa: cualquier empleado activo —un vendedor
  con solo `pos`— creaba, cambiaba y borraba clientes, proveedores y
  cotizaciones de cualquiera. Borrar un cliente dejaba sus facturas sin
  cliente, y la cotización decía haber sido hecha por quien el navegador
  quisiera.

  Reglas del propietario:
  - un cliente se crea con `clients`, `pos` o `quotes` (las tres pantallas
    lo dan de alta) y se cambia con `clients`;
  - un cliente NO se borra nunca, ni siquiera por el administrador: sus
    ventas, facturas y cuentas por cobrar lo necesitan;
  - un proveedor se escribe con `suppliers`;
  - una cotización la crea quien tiene `quotes`, a su nombre, y solo su
    autor o un administrador la cambia o la borra; su detalle sigue a su
    cotización.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, crearCliente, crearFactura, contar } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

/* Corre una consulta como ese usuario (null = anónimo) y vuelve a dueño. */
async function como(authId, consulta, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(consulta, valores)
  } finally {
    await comoDueno(db)
  }
}

const RECHAZO = { code: "42501" }

const fila = async (tabla, id) =>
  (await db.query(`select * from ${tabla} where id = $1`, [id])).rows[0]

let serie = 0

/* Una cotización guardada directamente, con el autor que pida el caso. */
async function cotizacionDe(empresa, usuario) {
  const n = ++serie

  const id = (
    await db.query(
      `insert into cotizaciones (empresa_id, usuario_id, numero, correlativo, total)
       values ($1, $2, $3, $4, 100) returning id`,
      [empresa, usuario, `COT-T${n}`, 900000 + n]
    )
  ).rows[0].id

  const renglon = (
    await db.query(
      `insert into detalle_cotizacion (empresa_id, cotizacion_id, nombre, cantidad, precio, subtotal)
       values ($1, $2, 'Cargador', 1, 100, 100) returning id`,
      [empresa, id]
    )
  ).rows[0].id

  return { id, renglon }
}

/*
  Empresa A: su administrador y un empleado por sección (`pos`, `clients`,
  `quotes` dos veces, `suppliers`, uno solo de inventario y uno inactivo
  con todo). Empresa B: su administrador. Un cliente de A con una factura,
  otro sin ventas, un proveedor de A y una cotización de un vendedor.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")
  const vendedor = (permisos, extra = {}) => crearVendedor(db, { empresa: a.empresa, permisos, ...extra })

  const e = {
    a,
    b,
    pos: await vendedor(["pos"]),
    clientes: await vendedor(["clients"]),
    cotiza: await vendedor(["quotes"]),
    cotiza2: await vendedor(["quotes"]),
    compras: await vendedor(["suppliers"]),
    bodega: await vendedor(["inventory-own"]),
    inactivo: await vendedor(["clients", "pos", "quotes", "suppliers"], { activo: false }),
  }

  e.cliente = await crearCliente(db, a.empresa)
  e.clienteSinVentas = await crearCliente(db, a.empresa)
  e.factura = await crearFactura(db, { empresa: a.empresa, clienteId: e.cliente, usuario: a.usuario, total: 100 })
  e.clienteB = await crearCliente(db, b.empresa)
  e.proveedor = (
    await db.query("insert into proveedores (empresa_id, nombre) values ($1, 'Mayorista') returning id", [a.empresa])
  ).rows[0].id
  e.deCotiza = await cotizacionDe(a.empresa, e.cotiza.usuario)

  return e
}

const NUEVO_CLIENTE = "insert into clientes (empresa_id, nombre) values ($1, $2) returning id"
const NUEVO_PROVEEDOR = "insert into proveedores (empresa_id, nombre) values ($1, $2) returning id"
const NUEVA_COTIZACION = `insert into cotizaciones (empresa_id, usuario_id, numero, correlativo, total)
                          values ($1, $2, $3, $4, 50) returning id`

// ── CLIENTES ──────────────────────────────────────────────

describe("SEC-3b clientes: alta con `clients`, `pos` o `quotes`; cambio con `clients`", () => {
  it("C1. dan de alta un cliente quien tiene `clients`, `pos` o `quotes`", async () => {
    const e = await escenario()

    for (const quien of [e.clientes, e.pos, e.cotiza]) {
      expect((await como(quien.authId, NUEVO_CLIENTE, [e.a.empresa, `Alta ${++serie}`])).rowCount).toBe(1)
    }
  })

  it("C2. quien no tiene ninguna de esas secciones no da de alta clientes", async () => {
    const e = await escenario()

    await expect(como(e.bodega.authId, NUEVO_CLIENTE, [e.a.empresa, "Sin permiso"])).rejects.toMatchObject(RECHAZO)
    await expect(como(e.compras.authId, NUEVO_CLIENTE, [e.a.empresa, "Sin permiso"])).rejects.toMatchObject(RECHAZO)
  })

  it("C3. un inactivo y anon no dan de alta clientes", async () => {
    const e = await escenario()

    await expect(como(e.inactivo.authId, NUEVO_CLIENTE, [e.a.empresa, "Inactivo"])).rejects.toMatchObject(RECHAZO)
    await expect(como(null, NUEVO_CLIENTE, [e.a.empresa, "Anon"])).rejects.toMatchObject(RECHAZO)
  })

  it("C4. con `clients` se cambia un cliente", async () => {
    const e = await escenario()

    const r = await como(e.clientes.authId, "update clientes set telefono = '9999-0000' where id = $1", [e.cliente])

    expect(r.rowCount).toBe(1)
    expect((await fila("clientes", e.cliente)).telefono).toBe("9999-0000")
  })

  it("C5. con solo `pos` o `quotes` no se cambia un cliente", async () => {
    const e = await escenario()

    for (const quien of [e.pos, e.cotiza]) {
      await expect(
        como(quien.authId, "update clientes set telefono = '0000' where id = $1", [e.cliente])
      ).rejects.toMatchObject(RECHAZO)
    }
    expect((await fila("clientes", e.cliente)).telefono).toBe("")
  })

  it("C6. nadie cambia ni ve los clientes de otra empresa", async () => {
    const e = await escenario()

    const r = await como(e.a.authId, "update clientes set telefono = '1' where id = $1", [e.clienteB])

    expect(r.rowCount).toBe(0)
    expect((await como(e.a.authId, "select id from clientes where id = $1", [e.clienteB])).rowCount).toBe(0)
  })
})

describe("SEC-3b clientes: no se borran nunca", () => {
  it("C7. ningún usuario de la aplicación borra un cliente, ni el administrador", async () => {
    const e = await escenario()

    /*
      Un cliente sin ventas a crédito: hoy nada más lo protege. (A uno con
      crédito lo frena de rebote el CHECK de ventas, por eso C8 aparte.)
    */
    for (const quien of [e.a, e.clientes, e.pos, e.cotiza]) {
      await expect(como(quien.authId, "delete from clientes where id = $1", [e.clienteSinVentas])).rejects.toMatchObject(RECHAZO)
    }
    await expect(como(null, "delete from clientes where id = $1", [e.clienteSinVentas])).rejects.toMatchObject(RECHAZO)
    expect(await contar(db, "clientes", "id = $1", [e.clienteSinVentas])).toBe(1)
  })

  it("C8. el cliente con factura se niega por permiso y la factura conserva su cliente", async () => {
    const e = await escenario()

    await expect(como(e.a.authId, "delete from clientes where id = $1", [e.cliente])).rejects.toMatchObject(RECHAZO)

    expect((await fila("ventas", e.factura)).cliente_id).toBe(e.cliente)
  })

  it("C9. authenticated y anon no tienen el privilegio de borrar clientes", async () => {
    const { rows } = await db.query(
      `select has_table_privilege('authenticated', 'public.clientes', 'DELETE') as auth,
              has_table_privilege('anon', 'public.clientes', 'DELETE') as anon`
    )

    expect(rows[0]).toEqual({ auth: false, anon: false })
  })
})

// ── PROVEEDORES ───────────────────────────────────────────

describe("SEC-3b proveedores: se escriben con `suppliers`", () => {
  it("P1. con `suppliers` se crea, cambia y borra un proveedor", async () => {
    const e = await escenario()

    const nuevo = (await como(e.compras.authId, NUEVO_PROVEEDOR, [e.a.empresa, "Nuevo"])).rows[0].id

    expect((await como(e.compras.authId, "update proveedores set contacto = 'Ana' where id = $1", [nuevo])).rowCount).toBe(1)
    expect((await como(e.compras.authId, "delete from proveedores where id = $1", [nuevo])).rowCount).toBe(1)
  })

  it("P2. el administrador también, sin permisos repartidos", async () => {
    const e = await escenario()

    expect((await como(e.a.authId, NUEVO_PROVEEDOR, [e.a.empresa, "Del admin"])).rowCount).toBe(1)
    expect((await como(e.a.authId, "delete from proveedores where id = $1", [e.proveedor])).rowCount).toBe(1)
  })

  it("P3. sin `suppliers` no se crea ni se cambia un proveedor", async () => {
    const e = await escenario()

    await expect(como(e.pos.authId, NUEVO_PROVEEDOR, [e.a.empresa, "Pos"])).rejects.toMatchObject(RECHAZO)
    await expect(
      como(e.pos.authId, "update proveedores set contacto = 'x' where id = $1", [e.proveedor])
    ).rejects.toMatchObject(RECHAZO)
  })

  it("P4. sin `suppliers` no se borra un proveedor", async () => {
    const e = await escenario()

    expect((await como(e.pos.authId, "delete from proveedores where id = $1", [e.proveedor])).rowCount).toBe(0)
    expect(await contar(db, "proveedores", "id = $1", [e.proveedor])).toBe(1)
  })

  it("P5. nadie toca los proveedores de otra empresa", async () => {
    const e = await escenario()

    await expect(como(e.b.authId, NUEVO_PROVEEDOR, [e.a.empresa, "Ajeno"])).rejects.toMatchObject(RECHAZO)
    expect((await como(e.b.authId, "delete from proveedores where id = $1", [e.proveedor])).rowCount).toBe(0)
  })
})

// ── COTIZACIONES ──────────────────────────────────────────

describe("SEC-3b cotizaciones: las crea quien tiene `quotes`, a su nombre", () => {
  it("Q1. con `quotes` se crea una cotización propia con su detalle, y se puede deshacer", async () => {
    const e = await escenario()

    const id = (await como(e.cotiza.authId, NUEVA_COTIZACION, [e.a.empresa, e.cotiza.usuario, `COT-N${++serie}`, 800000 + serie])).rows[0].id
    const renglon = await como(
      e.cotiza.authId,
      `insert into detalle_cotizacion (empresa_id, cotizacion_id, nombre, cantidad, precio, subtotal)
       values ($1, $2, 'Funda', 2, 25, 50)`,
      [e.a.empresa, id]
    )

    expect(renglon.rowCount).toBe(1)
    // El frontend borra la cabecera si el detalle falla: su autor puede.
    expect((await como(e.cotiza.authId, "delete from cotizaciones where id = $1", [id])).rowCount).toBe(1)
  })

  it("Q2. sin `quotes` no se crea una cotización", async () => {
    const e = await escenario()

    await expect(
      como(e.pos.authId, NUEVA_COTIZACION, [e.a.empresa, e.pos.usuario, `COT-P${++serie}`, 800000 + serie])
    ).rejects.toMatchObject(RECHAZO)
  })

  it("Q3. nadie firma una cotización a nombre de otro, ni sin autor", async () => {
    const e = await escenario()

    await expect(
      como(e.cotiza.authId, NUEVA_COTIZACION, [e.a.empresa, e.cotiza2.usuario, `COT-F${++serie}`, 800000 + serie])
    ).rejects.toMatchObject(RECHAZO)
    await expect(
      como(e.cotiza.authId, NUEVA_COTIZACION, [e.a.empresa, null, `COT-F${++serie}`, 800000 + serie])
    ).rejects.toMatchObject(RECHAZO)
  })
})

describe("SEC-3b cotizaciones: solo su autor o un administrador la cambia o la borra", () => {
  it("Q4. otro vendedor con `quotes` no borra ni cambia la cotización ajena", async () => {
    const e = await escenario()

    expect((await como(e.cotiza2.authId, "delete from cotizaciones where id = $1", [e.deCotiza.id])).rowCount).toBe(0)
    expect((await como(e.cotiza2.authId, "update cotizaciones set notas = 'x' where id = $1", [e.deCotiza.id])).rowCount).toBe(0)
    expect(await contar(db, "cotizaciones", "id = $1 and notas = ''", [e.deCotiza.id])).toBe(1)
  })

  it("Q5. su autor la cambia y la borra", async () => {
    const e = await escenario()

    expect((await como(e.cotiza.authId, "update cotizaciones set notas = 'ok' where id = $1", [e.deCotiza.id])).rowCount).toBe(1)
    expect((await como(e.cotiza.authId, "delete from cotizaciones where id = $1", [e.deCotiza.id])).rowCount).toBe(1)
  })

  it("Q6. el autor no se la pasa a otro", async () => {
    const e = await escenario()

    await expect(
      como(e.cotiza.authId, "update cotizaciones set usuario_id = $2 where id = $1", [e.deCotiza.id, e.cotiza2.usuario])
    ).rejects.toMatchObject(RECHAZO)
  })

  it("Q7. el administrador cambia y borra la de cualquiera de su empresa", async () => {
    const e = await escenario()

    expect((await como(e.a.authId, "update cotizaciones set notas = 'admin' where id = $1", [e.deCotiza.id])).rowCount).toBe(1)
    expect((await fila("cotizaciones", e.deCotiza.id)).usuario_id).toBe(e.cotiza.usuario)
    expect((await como(e.a.authId, "delete from cotizaciones where id = $1", [e.deCotiza.id])).rowCount).toBe(1)
  })

  it("Q8. el administrador de otra empresa no la toca", async () => {
    const e = await escenario()

    expect((await como(e.b.authId, "delete from cotizaciones where id = $1", [e.deCotiza.id])).rowCount).toBe(0)
  })
})

describe("SEC-3b detalle de cotización: sigue a su cotización", () => {
  it("D1. otro vendedor no agrega renglones a una cotización ajena", async () => {
    const e = await escenario()

    await expect(
      como(
        e.cotiza2.authId,
        `insert into detalle_cotizacion (empresa_id, cotizacion_id, nombre, cantidad, precio, subtotal)
         values ($1, $2, 'Intruso', 1, 1, 1)`,
        [e.a.empresa, e.deCotiza.id]
      )
    ).rejects.toMatchObject(RECHAZO)
  })

  it("D2. ni cambia ni borra sus renglones", async () => {
    const e = await escenario()

    expect((await como(e.cotiza2.authId, "update detalle_cotizacion set precio = 1 where id = $1", [e.deCotiza.renglon])).rowCount).toBe(0)
    expect((await como(e.cotiza2.authId, "delete from detalle_cotizacion where id = $1", [e.deCotiza.renglon])).rowCount).toBe(0)
    expect(await contar(db, "detalle_cotizacion", "id = $1 and precio = 100", [e.deCotiza.renglon])).toBe(1)
  })

  it("D3. su autor y el administrador sí", async () => {
    const e = await escenario()

    expect((await como(e.cotiza.authId, "update detalle_cotizacion set precio = 90 where id = $1", [e.deCotiza.renglon])).rowCount).toBe(1)
    expect((await como(e.a.authId, "delete from detalle_cotizacion where id = $1", [e.deCotiza.renglon])).rowCount).toBe(1)
  })
})

// ── LO QUE QUEDA ──────────────────────────────────────────

describe("SEC-3b: privilegios, función y políticas", () => {
  it("A1. anon no tiene escritura sobre las cuatro tablas", async () => {
    const { rows } = await db.query(
      `select t, has_table_privilege('anon', 'public.' || t, 'INSERT')
               or has_table_privilege('anon', 'public.' || t, 'UPDATE')
               or has_table_privilege('anon', 'public.' || t, 'DELETE') as escribe
         from unnest(array['clientes', 'proveedores', 'cotizaciones', 'detalle_cotizacion']) t`
    )

    expect(rows.filter((r) => r.escribe).map((r) => r.t)).toEqual([])
  })

  it("A2. usuario_actual() devuelve el usuario de quien llama y anon no la ejecuta", async () => {
    const e = await escenario()

    expect((await como(e.cotiza.authId, "select public.usuario_actual() as id")).rows[0].id).toBe(e.cotiza.usuario)
    expect((await como(e.inactivo.authId, "select public.usuario_actual() as id")).rows[0].id).toBe(null)
    await expect(como(null, "select public.usuario_actual()")).rejects.toMatchObject(RECHAZO)
  })

  it("A3. quedan exactamente estas políticas", async () => {
    const { rows } = await db.query(
      `select tablename || ':' || policyname || ':' || cmd as p from pg_policies
        where schemaname = 'public' and tablename in ('clientes', 'proveedores', 'cotizaciones', 'detalle_cotizacion')
        order by 1`
    )

    expect(rows.map((r) => r.p)).toEqual([
      "clientes:clientes_alta:INSERT",
      "clientes:clientes_cambio:UPDATE",
      "clientes:clientes_lectura:SELECT",
      "cotizaciones:cotizaciones_alta:INSERT",
      "cotizaciones:cotizaciones_baja:DELETE",
      "cotizaciones:cotizaciones_cambio:UPDATE",
      "cotizaciones:cotizaciones_lectura:SELECT",
      "detalle_cotizacion:detalle_cotizacion_alta:INSERT",
      "detalle_cotizacion:detalle_cotizacion_baja:DELETE",
      "detalle_cotizacion:detalle_cotizacion_cambio:UPDATE",
      "detalle_cotizacion:detalle_cotizacion_lectura:SELECT",
      "proveedores:proveedores_alta:INSERT",
      "proveedores:proveedores_baja:DELETE",
      "proveedores:proveedores_cambio:UPDATE",
      "proveedores:proveedores_lectura:SELECT",
    ])
  })
})
