/*
  SEC-1 y SEC-2 contra PostgreSQL de verdad.

  SEC-1 — Escalada de permisos. La 0003 quiso que solo el administrador
  repartiera permisos, pero la política del bucle de la 0001
  (permisos_usuario_de_mi_empresa, para todo, solo por empresa) siguió
  viva, y las políticas permisivas se suman con OR: cualquier empleado
  podía darse cualquier sección, quitársela a otro o dársela a alguien de
  otra empresa. Y usuario_tiene_permiso() no comparaba la empresa del
  permiso con la del usuario.

  SEC-2 — Escritura directa. ventas, detalle_venta, pagos y abonos se
  escriben solo desde registrar_venta_ubicacion() y registrar_pago_cliente(),
  pero `authenticated` conservaba insert, update y delete: un empleado
  podía cambiar el total de una factura o borrarla.

  Se prueba tanto lo que se cierra como lo que no se rompe: el
  administrador sigue repartiendo permisos, cada uno lee los suyos, un
  permiso legítimo sigue concediendo acceso y las dos funciones siguen
  escribiendo.
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

const tienePermiso = async (authId, seccion) =>
  (await como(authId, "select usuario_tiene_permiso($1) as v", [seccion])).rows[0].v

const seccionesDe = async (usuario) =>
  (
    await db.query(
      "select seccion from permisos_usuario where usuario_id = $1 order by seccion",
      [usuario]
    )
  ).rows.map((r) => r.seccion)

/*
  Dos empresas. En A, su administrador y dos vendedores: uno con `pos` y
  otro con `quotes`. En B, su administrador y un vendedor con `pos`.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")

  const vendedorA = await crearVendedor(db, { empresa: a.empresa, permisos: ["pos"] })
  const otroA = await crearVendedor(db, { empresa: a.empresa, permisos: ["quotes"] })
  const vendedorB = await crearVendedor(db, { empresa: b.empresa, permisos: ["pos"] })

  return { a, b, vendedorA, otroA, vendedorB }
}

/*
  Siembra una fila que el esquema corregido ya no deja crear: un permiso
  de un usuario de B guardado con la empresa A. Se salta la llave foránea
  como lo haría un dato heredado de antes de la corrección.
*/
async function sembrarPermisoInconsistente(usuarioId, empresaId, seccion) {
  await db.query("set session_replication_role = replica")

  try {
    await db.query(
      "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, $3)",
      [usuarioId, empresaId, seccion]
    )
  } finally {
    await db.query("set session_replication_role = origin")
  }
}

// ── SEC-1 ─────────────────────────────────────────────────

describe("SEC-1: solo el administrador reparte permisos", () => {
  it("1. el administrador da, lee y quita permisos dentro de su empresa", async () => {
    const e = await escenario()

    await como(
      e.a.authId,
      "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'inventory-all')",
      [e.vendedorA.usuario, e.a.empresa]
    )
    expect(await seccionesDe(e.vendedorA.usuario)).toEqual(["inventory-all", "pos"])

    const vistos = await como(e.a.authId, "select count(*)::int as n from permisos_usuario")
    expect(vistos.rows[0].n).toBe(3)

    const quitados = await como(
      e.a.authId,
      "delete from permisos_usuario where usuario_id = $1 and seccion = 'inventory-all'",
      [e.vendedorA.usuario]
    )
    expect(quitados.rowCount).toBe(1)
    expect(await seccionesDe(e.vendedorA.usuario)).toEqual(["pos"])
  })

  it("2. un vendedor con solo `pos` no puede darse inventory-all", async () => {
    const e = await escenario()

    await expect(
      como(
        e.vendedorA.authId,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'inventory-all')",
        [e.vendedorA.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "42501" })

    expect(await tienePermiso(e.vendedorA.authId, "inventory-all")).toBe(false)
    expect(await seccionesDe(e.vendedorA.usuario)).toEqual(["pos"])
  })

  it("3. tampoco puede darse settings", async () => {
    const e = await escenario()

    await expect(
      como(
        e.vendedorA.authId,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'settings')",
        [e.vendedorA.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "42501" })

    expect(await tienePermiso(e.vendedorA.authId, "settings")).toBe(false)
  })

  it("4. un vendedor no puede modificar los permisos de otro usuario", async () => {
    const e = await escenario()

    const r = await como(
      e.vendedorA.authId,
      "update permisos_usuario set seccion = 'settings' where usuario_id = $1",
      [e.otroA.usuario]
    )

    expect(r.rowCount).toBe(0)
    expect(await seccionesDe(e.otroA.usuario)).toEqual(["quotes"])
  })

  it("5. un vendedor no puede borrar los permisos de otro usuario", async () => {
    const e = await escenario()

    const r = await como(e.vendedorA.authId, "delete from permisos_usuario where usuario_id = $1", [
      e.otroA.usuario,
    ])

    expect(r.rowCount).toBe(0)
    expect(await seccionesDe(e.otroA.usuario)).toEqual(["quotes"])
  })

  it("6. un vendedor no puede dar permisos a un usuario de otra empresa", async () => {
    const e = await escenario()

    await expect(
      como(
        e.vendedorA.authId,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'inventory-all')",
        [e.vendedorB.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "42501" })

    expect(await tienePermiso(e.vendedorB.authId, "inventory-all")).toBe(false)
    expect(await seccionesDe(e.vendedorB.usuario)).toEqual(["pos"])
  })

  it("7. un vendedor lee solo sus permisos, no el mapa de la empresa", async () => {
    const e = await escenario()

    const r = await como(
      e.vendedorA.authId,
      "select usuario_id, seccion from permisos_usuario order by seccion"
    )

    expect(r.rows).toEqual([{ usuario_id: e.vendedorA.usuario, seccion: "pos" }])
  })

  it("8. usuario_tiene_permiso concede lo legítimo: mismo usuario y misma empresa", async () => {
    const e = await escenario()

    expect(await tienePermiso(e.vendedorA.authId, "pos")).toBe(true)
    expect(await tienePermiso(e.otroA.authId, "quotes")).toBe(true)
    expect(await tienePermiso(e.otroA.authId, "pos")).toBe(false)
    expect(await tienePermiso(e.a.authId, "settings")).toBe(true)
  })

  it("9. un permiso guardado con la empresa equivocada no concede acceso", async () => {
    const e = await escenario()

    await sembrarPermisoInconsistente(e.vendedorB.usuario, e.a.empresa, "inventory-all")

    expect(await tienePermiso(e.vendedorB.authId, "inventory-all")).toBe(false)
  })

  it("10. anon no lee ni escribe permisos", async () => {
    const e = await escenario()

    const vistos = await como(null, "select count(*)::int as n from permisos_usuario")
    expect(vistos.rows[0].n).toBe(0)

    await expect(
      como(
        null,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'pos')",
        [e.vendedorA.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "42501" })

    // Desde 0026 anon ni siquiera tiene el privilegio: el intento es un error.
    await expect(como(null, "delete from permisos_usuario")).rejects.toMatchObject({ code: "42501" })
  })

  it("11. el administrador de A no administra permisos de B", async () => {
    const e = await escenario()

    const vistos = await como(
      e.a.authId,
      "select count(*)::int as n from permisos_usuario where empresa_id = $1",
      [e.b.empresa]
    )
    expect(vistos.rows[0].n).toBe(0)

    const cambiados = await como(
      e.a.authId,
      "update permisos_usuario set seccion = 'settings' where usuario_id = $1",
      [e.vendedorB.usuario]
    )
    expect(cambiados.rowCount).toBe(0)

    await expect(
      como(
        e.a.authId,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'settings')",
        [e.vendedorB.usuario, e.b.empresa]
      )
    ).rejects.toMatchObject({ code: "42501" })

    // Con la empresa propia en la fila, el usuario sigue siendo de B: no entra.
    await expect(
      como(
        e.a.authId,
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'settings')",
        [e.vendedorB.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "23503" })

    expect(await seccionesDe(e.vendedorB.usuario)).toEqual(["pos"])
    expect(await tienePermiso(e.vendedorB.authId, "settings")).toBe(false)
  })

  it("12. un vendedor no puede cambiar ni borrar su propio permiso para elevarse", async () => {
    const e = await escenario()

    const cambiado = await como(
      e.vendedorA.authId,
      "update permisos_usuario set seccion = 'settings' where usuario_id = $1",
      [e.vendedorA.usuario]
    )
    expect(cambiado.rowCount).toBe(0)

    const borrado = await como(
      e.vendedorA.authId,
      "delete from permisos_usuario where usuario_id = $1",
      [e.vendedorA.usuario]
    )
    expect(borrado.rowCount).toBe(0)

    expect(await seccionesDe(e.vendedorA.usuario)).toEqual(["pos"])
  })

  it("13. la estructura no admite un permiso de un usuario guardado con otra empresa", async () => {
    const e = await escenario()

    await expect(
      db.query(
        "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'settings')",
        [e.vendedorB.usuario, e.a.empresa]
      )
    ).rejects.toMatchObject({ code: "23503" })
  })

  it("14. en permisos_usuario quedan solo las políticas del administrador y de lectura propia", async () => {
    const r = await db.query(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'permisos_usuario'
        order by policyname`
    )

    expect(r.rows.map((p) => p.policyname)).toEqual([
      "permisos_admin_escribe",
      "permisos_propios_select",
    ])
  })
})

// ── SEC-2 ─────────────────────────────────────────────────

/*
  Una venta con su renglón, un pago y un abono, sembrados como dueño: es
  lo que ya existe y nadie desde fuera de las funciones debe poder tocar.
*/
async function ventasYCobros() {
  const e = await escenario()
  const clienteId = await crearCliente(db, e.a.empresa)

  const venta = await crearFactura(db, {
    empresa: e.a.empresa,
    clienteId,
    usuario: e.vendedorA.usuario,
    total: 100,
  })

  const detalle = (
    await db.query(
      `insert into detalle_venta (empresa_id, venta_id, nombre, cantidad, precio, subtotal)
       values ($1, $2, 'Cargador', 1, 100, 100) returning id`,
      [e.a.empresa, venta]
    )
  ).rows[0].id

  const pago = (
    await db.query(
      `insert into pagos (empresa_id, cliente_id, usuario_id, monto, saldo_anterior, saldo_posterior)
       values ($1, $2, $3, 50, 100, 50) returning id`,
      [e.a.empresa, clienteId, e.a.usuario]
    )
  ).rows[0].id

  const abono = (
    await db.query(
      `insert into abonos (empresa_id, venta_id, pago_id, monto)
       values ($1, $2, $3, 50) returning id`,
      [e.a.empresa, venta, pago]
    )
  ).rows[0].id

  /*
    Un pago sin abonos, para que borrarlo solo lo pueda impedir el
    permiso y no la llave foránea de abonos.pago_id.
  */
  const pagoSuelto = (
    await db.query(
      `insert into pagos (empresa_id, cliente_id, usuario_id, monto, saldo_anterior, saldo_posterior)
       values ($1, $2, $3, 10, 50, 40) returning id`,
      [e.a.empresa, clienteId, e.a.usuario]
    )
  ).rows[0].id

  return { ...e, clienteId, venta, detalle, pago, abono, pagoSuelto }
}

/*
  Por cada tabla, una escritura de cada clase con datos válidos para la
  empresa propia: si algo la detiene, es el permiso y no un dato mal
  armado.
*/
const ESCRITURAS = {
  ventas: {
    insert: (x) => [
      `insert into ventas (empresa_id, cliente_id, numero_factura, correlativo, nombre_cliente,
                           subtotal, isv, tasa_isv, total, forma_pago, estado)
       values ($1, $2, 'FAC-99999', 99999, 'Cliente', 1, 0, 15, 1, 'contado', 'pagada')`,
      [x.a.empresa, x.clienteId],
    ],
    update: (x) => ["update ventas set total = 1 where id = $1", [x.venta]],
    delete: (x) => ["delete from ventas where id = $1", [x.venta]],
  },
  detalle_venta: {
    insert: (x) => [
      `insert into detalle_venta (empresa_id, venta_id, nombre, cantidad, precio, subtotal)
       values ($1, $2, 'Regalo', 1, 0, 0)`,
      [x.a.empresa, x.venta],
    ],
    update: (x) => ["update detalle_venta set precio = 0, subtotal = 0 where id = $1", [x.detalle]],
    delete: (x) => ["delete from detalle_venta where id = $1", [x.detalle]],
  },
  pagos: {
    insert: (x) => [
      `insert into pagos (empresa_id, cliente_id, monto, saldo_anterior, saldo_posterior)
       values ($1, $2, 50, 50, 0)`,
      [x.a.empresa, x.clienteId],
    ],
    update: (x) => ["update pagos set nota = 'cambiado' where id = $1", [x.pago]],
    delete: (x) => ["delete from pagos where id = $1", [x.pagoSuelto]],
  },
  abonos: {
    insert: (x) => [
      "insert into abonos (empresa_id, venta_id, monto) values ($1, $2, 50)",
      [x.a.empresa, x.venta],
    ],
    update: (x) => ["update abonos set monto = 1 where id = $1", [x.abono]],
    delete: (x) => ["delete from abonos where id = $1", [x.abono]],
  },
}

describe("SEC-2: ventas y cobros no se escriben desde fuera de las funciones", () => {
  for (const [tabla, operaciones] of Object.entries(ESCRITURAS)) {
    for (const [operacion, armar] of Object.entries(operaciones)) {
      it(`${tabla}: ${operacion} directo está prohibido para un vendedor y para el administrador`, async () => {
        const x = await ventasYCobros()
        const [consulta, valores] = armar(x)
        const antes = await contar(db, tabla, "empresa_id = $1", [x.a.empresa])

        for (const authId of [x.vendedorA.authId, x.a.authId]) {
          await expect(como(authId, consulta, valores)).rejects.toMatchObject({ code: "42501" })
        }

        expect(await contar(db, tabla, "empresa_id = $1", [x.a.empresa])).toBe(antes)
      })
    }
  }

  it("lo escrito queda como estaba: total de la venta, renglón, pago y abono", async () => {
    const x = await ventasYCobros()

    for (const authId of [x.vendedorA.authId, x.a.authId]) {
      for (const operaciones of Object.values(ESCRITURAS)) {
        const [consulta, valores] = operaciones.update(x)
        await como(authId, consulta, valores).catch(() => {})
      }
    }

    const r = await db.query(
      `select v.total, d.precio, p.nota, a.monto
         from ventas v, detalle_venta d, pagos p, abonos a
        where v.id = $1 and d.id = $2 and p.id = $3 and a.id = $4`,
      [x.venta, x.detalle, x.pago, x.abono]
    )

    expect(r.rows[0]).toEqual({ total: "100.00", precio: "100.00", nota: "", monto: "50.00" })
  })

  it("authenticated y anon conservan solo la lectura de las cuatro tablas", async () => {
    for (const tabla of Object.keys(ESCRITURAS)) {
      const r = await db.query(
        `select
           has_table_privilege('authenticated', $1, 'SELECT') as lee,
           has_table_privilege('authenticated', $1, 'INSERT') as inserta,
           has_table_privilege('authenticated', $1, 'UPDATE') as actualiza,
           has_table_privilege('authenticated', $1, 'DELETE') as borra,
           has_table_privilege('anon', $1, 'INSERT') as anon_inserta,
           has_table_privilege('anon', $1, 'UPDATE') as anon_actualiza,
           has_table_privilege('anon', $1, 'DELETE') as anon_borra`,
        [`public.${tabla}`]
      )

      expect({ tabla, ...r.rows[0] }).toEqual({
        tabla,
        lee: true,
        inserta: false,
        actualiza: false,
        borra: false,
        anon_inserta: false,
        anon_actualiza: false,
        anon_borra: false,
      })
    }
  })
})

// ── LO QUE NO SE ROMPE ────────────────────────────────────

describe("SEC-1 y SEC-2: los flujos legítimos siguen", () => {
  it("cada empresa sigue leyendo sus ventas y cobros, y no las de otra", async () => {
    const x = await ventasYCobros()

    for (const tabla of Object.keys(ESCRITURAS)) {
      const propia = await como(x.vendedorA.authId, `select count(*)::int as n from ${tabla}`)
      expect(propia.rows[0].n).toBeGreaterThan(0)

      const ajena = await como(x.vendedorB.authId, `select count(*)::int as n from ${tabla}`)
      expect(ajena.rows[0].n).toBe(0)

      const anon = await como(null, `select count(*)::int as n from ${tabla}`)
      expect(anon.rows[0].n).toBe(0)
    }
  })

  it("un vendedor sigue vendiendo con registrar_venta_ubicacion, con renglones e idempotencia", async () => {
    const e = await escenario()

    const tienda = (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Tienda A', 'tienda') returning id`,
        [e.a.empresa]
      )
    ).rows[0].id

    const producto = (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, 'S-' || substr(md5(random()::text), 1, 8), 'Cargador', 100, 10) returning id`,
        [e.a.empresa]
      )
    ).rows[0].id

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 5)`,
      [e.a.empresa, tienda, producto]
    )
    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [tienda, e.vendedorA.usuario])

    const vender = () =>
      como(
        e.vendedorA.authId,
        "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', 'sec-venta-1') as res",
        [JSON.stringify([{ producto_id: producto, cantidad: 2 }])]
      )

    const primera = (await vender()).rows[0].res
    const repetida = (await vender()).rows[0].res

    expect(repetida.venta_id).toBe(primera.venta_id)
    expect(await contar(db, "ventas", "empresa_id = $1", [e.a.empresa])).toBe(1)
    expect(await contar(db, "detalle_venta", "venta_id = $1", [primera.venta_id])).toBe(1)
  })

  it("el administrador sigue cobrando con registrar_pago_cliente: pago, abono y factura pagada", async () => {
    const e = await escenario()
    const clienteId = await crearCliente(db, e.a.empresa)
    const venta = await crearFactura(db, { empresa: e.a.empresa, clienteId, usuario: e.a.usuario, total: 100 })

    const res = (
      await como(e.a.authId, "select registrar_pago_cliente($1, 100, 'sec-pago-1', '') as res", [clienteId])
    ).rows[0].res

    expect(Number(res.monto)).toBe(100)
    expect(await contar(db, "pagos", "cliente_id = $1", [clienteId])).toBe(1)
    expect(await contar(db, "abonos", "venta_id = $1", [venta])).toBe(1)

    const estado = await db.query("select estado from ventas where id = $1", [venta])
    expect(estado.rows[0].estado).toBe("pagada")
  })

  // USR-1 (0026): los usuarios no se borran, se desactivan; la venta conserva a su autor.
  it("el administrador ya no borra un usuario con ventas: la venta conserva su autor", async () => {
    const x = await ventasYCobros()

    await expect(como(x.a.authId, "delete from usuarios where id = $1", [x.vendedorA.usuario])).rejects.toMatchObject({
      code: "42501",
    })

    const venta = await db.query("select usuario_id from ventas where id = $1", [x.venta])
    expect(venta.rows[0].usuario_id).toBe(x.vendedorA.usuario)
  })

  it("un vendedor con inventory-own legítimo sigue viendo su ubicación", async () => {
    const e = await escenario()

    const tienda = (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Tienda propia', 'tienda') returning id`,
        [e.a.empresa]
      )
    ).rows[0].id

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [tienda, e.vendedorA.usuario])
    await db.query(
      "insert into permisos_usuario (usuario_id, empresa_id, seccion) values ($1, $2, 'inventory-own')",
      [e.vendedorA.usuario, e.a.empresa]
    )

    const r = await como(e.vendedorA.authId, "select usuario_ve_ubicacion($1) as v", [tienda])
    expect(r.rows[0].v).toBe(true)
  })
})
