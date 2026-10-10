/*
  USR-1 contra PostgreSQL de verdad: alta de empleados, acceso por nombre
  de usuario, bloqueo por intentos, desbloqueo, restablecimiento y cambio
  obligatorio de contraseña.

  Lo que hace Supabase Auth (crear la identidad, comprobar la contraseña)
  ocurre en la Edge Function `acceso`. Aquí se prueba la mitad que vive en
  la base y que la función usa con service_role:

  - acceso_reservar_intento() / acceso_registrar_resultado(): cada
    comprobación de contraseña ocupa un lugar ANTES de hacerse, bajo
    candado; fallidos más en curso nunca pasan de 5, así que ni muchas
    solicitudes simultáneas evaden el límite. A los 5 fallidos queda
    bloqueado 15 minutos, y un acierto que llega con el bloqueo puesto no
    se acepta.
  - registrar_empleado(): valida al administrador, su empresa y al
    empleado, en una sola transacción.
  - validar_restablecimiento() / confirmar_restablecimiento(): primero se
    valida sin cambiar nada; solo después de que Auth confirma la nueva
    contraseña se exige el cambio, se desbloquea y se audita.
  - desbloquear_usuario(): la llama el administrador desde el navegador; la
    función valida todo y deja auditoría.
  - debe_cambiar_contrasena: mientras esté activo, las funciones de las que
    depende toda la RLS tratan al usuario como si no tuviera empresa.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, esperarBloqueo } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, contar } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

const como = (authId, consulta, valores) => consultarComo(db, authId, consulta, valores)

/* Como la Edge Function: con service_role. */
async function comoServicio(consulta, valores = [], cliente = db) {
  await cliente.query("set role service_role")

  try {
    return await cliente.query(consulta, valores)
  } finally {
    await cliente.query("reset role")
  }
}

const RECHAZO = { code: "42501" }
let serie = 0

const reservar = async (identificador, cliente = db) =>
  (await comoServicio("select * from public.acceso_reservar_intento($1)", [identificador], cliente)).rows[0]

const resultado = async (reserva, exito, cliente = db) =>
  (await comoServicio("select public.acceso_registrar_resultado($1, $2) as aceptado", [reserva, exito], cliente)).rows[0]
    .aceptado

/* Un intento completo con la contraseña equivocada, como lo hace la Edge Function. */
async function fallar(identificador) {
  const intento = await reservar(identificador)
  expect(intento.permitido).toBe(true)
  await resultado(intento.reserva, false)
}

/* N conexiones de verdad, cada una con su sesión de PostgreSQL. */
async function enParalelo(cantidad, hacer) {
  const conexiones = await Promise.all(Array.from({ length: cantidad }, () => base.conectar()))

  try {
    return await Promise.all(conexiones.map((cliente, i) => hacer(cliente, i)))
  } finally {
    await Promise.all(conexiones.map((c) => c.end()))
  }
}

const bloqueo = async (usuario) =>
  (await db.query("select intentos, bloqueado_hasta from bloqueos_de_acceso where usuario_id = $1", [usuario])).rows[0]

async function cuentaAuth(correo) {
  return (await db.query("insert into auth.users (email) values ($1) returning id", [correo])).rows[0].id
}

/*
  Empresa A: su administrador, un segundo administrador y un vendedor del
  Camión 01 con nombre de usuario. Ubicaciones: bodega, Camión 01 y Camión 02,
  cada una con existencia del mismo producto. Empresa B: su administrador.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")
  const n = ++serie

  const ubicacion = async (nombre, tipo) =>
    (
      await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id", [
        a.empresa,
        nombre,
        tipo,
      ])
    ).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const ubicacionB = (
    await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Bodega B', 'bodega') returning id", [
      b.empresa,
    ])
  ).rows[0].id

  const producto = (
    await db.query(
      "insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Cargador', 100, 60) returning id",
      [a.empresa, `U-${n}`]
    )
  ).rows[0].id

  for (const [ubicacionId, cantidad] of [[bodega, 20], [camion1, 5], [camion2, 7]]) {
    await db.query(
      "insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, $4)",
      [a.empresa, ubicacionId, producto, cantidad]
    )
  }

  const chofer = await crearVendedor(db, { empresa: a.empresa, ubicacion: camion1, permisos: ["pos", "inventory-own"] })
  const usuarioChofer = `camion01.${n}`
  const correoChofer = (await db.query("select email from auth.users where id = $1", [chofer.authId])).rows[0].email
  await db.query("update usuarios set nombre_usuario = $1 where id = $2", [usuarioChofer, chofer.usuario])

  const admin2 = await crearVendedor(db, { empresa: a.empresa })
  await db.query("update usuarios set rol = 'admin' where id = $1", [admin2.usuario])

  return { a, b, n, bodega, camion1, camion2, ubicacionB, producto, chofer, usuarioChofer, correoChofer, admin2 }
}

// ── BLOQUEO POR INTENTOS ──────────────────────────────────

describe("USR-1 bloqueo por intentos fallidos", () => {
  it("B1. cinco intentos fallidos bloquean; el sexto no se permite", async () => {
    const e = await escenario()

    for (let i = 1; i <= 5; i++) await fallar(e.usuarioChofer)

    const sexto = await reservar(e.usuarioChofer)

    expect(sexto).toMatchObject({ permitido: false, reserva: null })
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).not.toBeNull()
  })

  it("B2. un acierto antes del límite limpia el contador", async () => {
    const e = await escenario()

    for (let i = 1; i <= 4; i++) await fallar(e.usuarioChofer)
    const intento = await reservar(e.usuarioChofer)

    expect(await resultado(intento.reserva, true)).toBe(true)
    expect((await bloqueo(e.chofer.usuario)).intentos).toBe(0)
  })

  it("B3. el bloqueo expira a los 15 minutos", async () => {
    const e = await escenario()

    for (let i = 1; i <= 5; i++) await fallar(e.usuarioChofer)
    const { bloqueado_hasta } = await bloqueo(e.chofer.usuario)
    const minutos = (new Date(bloqueado_hasta) - Date.now()) / 60000

    expect(minutos).toBeGreaterThan(14)
    expect(minutos).toBeLessThanOrEqual(15)

    // Pasaron los 15 minutos.
    await db.query("update bloqueos_de_acceso set bloqueado_hasta = now() - interval '1 second' where usuario_id = $1", [
      e.chofer.usuario,
    ])

    const nuevo = await reservar(e.usuarioChofer)
    expect(nuevo.permitido).toBe(true)
    await resultado(nuevo.reserva, false)
    expect(await bloqueo(e.chofer.usuario)).toMatchObject({ intentos: 1, bloqueado_hasta: null })
  })

  it("B4. doce solicitudes simultáneas: solo cinco llegan a comprobar la contraseña", async () => {
    const e = await escenario()

    const intentos = await enParalelo(12, (cliente) => reservar(e.usuarioChofer, cliente))
    const permitidos = intentos.filter((i) => i.permitido)

    expect(permitidos).toHaveLength(5)

    // Las cinco fallan a la vez: queda bloqueado y nadie más pasa.
    await enParalelo(5, (cliente, i) => resultado(permitidos[i].reserva, false, cliente))

    expect((await bloqueo(e.chofer.usuario)).intentos).toBe(5)
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).not.toBeNull()
    expect((await reservar(e.usuarioChofer)).permitido).toBe(false)
  })

  it("B5. con fallidos previos, las solicitudes simultáneas solo usan los lugares que quedan", async () => {
    const e = await escenario()
    for (let i = 1; i <= 3; i++) await fallar(e.usuarioChofer)

    const intentos = await enParalelo(6, (cliente) => reservar(e.usuarioChofer, cliente))

    expect(intentos.filter((i) => i.permitido)).toHaveLength(2)
  })

  it("B6. la reserva se toma bajo candado: la segunda sesión espera a la primera", async () => {
    const e = await escenario()
    const [primera, segunda] = [await base.conectar(), await base.conectar()]

    try {
      for (const c of [primera, segunda]) await c.query("set role service_role")
      const pid = (await segunda.query("select pg_backend_pid() as pid")).rows[0].pid

      await primera.query("begin")
      await primera.query("select * from public.acceso_reservar_intento($1)", [e.usuarioChofer])

      const deLaSegunda = segunda.query("select * from public.acceso_reservar_intento($1)", [e.usuarioChofer])
      const espera = await esperarBloqueo(db, pid)

      await primera.query("commit")

      expect(espera).toMatch(/^Lock/)
      expect((await deLaSegunda).rows[0].permitido).toBe(true)
    } finally {
      await primera.end()
      await segunda.end()
    }
  })

  it("B7. un acierto que llega cuando ya hay bloqueo no se acepta ni lo levanta", async () => {
    const e = await escenario()
    const pendiente = await reservar(e.usuarioChofer)

    // Mientras se comprobaba la contraseña, la cuenta quedó bloqueada.
    await db.query("update bloqueos_de_acceso set intentos = 5, bloqueado_hasta = now() + interval '15 minutes' where usuario_id = $1", [
      e.chofer.usuario,
    ])

    expect(await resultado(pendiente.reserva, true)).toBe(false)
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).not.toBeNull()
  })

  it("B8. una reserva se usa una sola vez", async () => {
    const e = await escenario()
    for (let i = 1; i <= 2; i++) await fallar(e.usuarioChofer)
    const intento = await reservar(e.usuarioChofer)

    expect(await resultado(intento.reserva, false)).toBe(false)
    expect(await resultado(intento.reserva, true)).toBe(false)
    expect((await bloqueo(e.chofer.usuario)).intentos).toBe(3)
  })

  it("B9. una reserva abandonada vence y libera su lugar", async () => {
    const e = await escenario()
    for (let i = 1; i <= 5; i++) await reservar(e.usuarioChofer)

    expect((await reservar(e.usuarioChofer)).permitido).toBe(false)

    await db.query("update reservas_de_acceso set creada_en = now() - interval '3 minutes' where usuario_id = $1", [
      e.chofer.usuario,
    ])

    expect((await reservar(e.usuarioChofer)).permitido).toBe(true)
  })

  it("B10. resuelve por correo y por nombre de usuario; nunca devuelve el correo si no se permite", async () => {
    const e = await escenario()

    const porCorreo = await reservar(e.correoChofer.toUpperCase())
    expect(porCorreo).toMatchObject({ usuario_id: e.chofer.usuario, email: e.correoChofer, permitido: true })

    const inexistente = await reservar("nadie.existe")
    expect(inexistente).toEqual({ usuario_id: null, email: null, permitido: false, reserva: null })

    await db.query("update usuarios set activo = false where id = $1", [e.chofer.usuario])
    expect(await reservar(e.usuarioChofer)).toEqual({ usuario_id: null, email: null, permitido: false, reserva: null })
  })
})

// ── DESBLOQUEO ────────────────────────────────────────────

describe("USR-1 desbloqueo por el administrador", () => {
  const bloquear = async (e) => {
    for (let i = 1; i <= 5; i++) await fallar(e.usuarioChofer)
  }

  it("D1. el administrador desbloquea al instante, limpia el contador y deja auditoría", async () => {
    const e = await escenario()
    await bloquear(e)

    await como(e.a.authId, "select public.desbloquear_usuario($1)", [e.chofer.usuario])

    expect(await bloqueo(e.chofer.usuario)).toEqual({ intentos: 0, bloqueado_hasta: null })
    expect((await reservar(e.usuarioChofer)).permitido).toBe(true)
    expect(
      await contar(db, "auditoria_accesos", "usuario_id = $1 and administrador_id = $2 and accion = 'desbloqueo'", [
        e.chofer.usuario,
        e.a.usuario,
      ])
    ).toBe(1)
  })

  it("D2. un empleado no puede desbloquearse a sí mismo ni a otro", async () => {
    const e = await escenario()
    await bloquear(e)

    await expect(como(e.chofer.authId, "select public.desbloquear_usuario($1)", [e.chofer.usuario])).rejects.toMatchObject(
      RECHAZO
    )
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).not.toBeNull()
  })

  it("D3. el administrador de otra empresa no desbloquea", async () => {
    const e = await escenario()
    await bloquear(e)

    await expect(como(e.b.authId, "select public.desbloquear_usuario($1)", [e.chofer.usuario])).rejects.toMatchObject(
      RECHAZO
    )
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).not.toBeNull()
  })

  it("D4. desbloquear no reactiva a un usuario desactivado", async () => {
    const e = await escenario()
    await bloquear(e)
    await db.query("update usuarios set activo = false where id = $1", [e.chofer.usuario])

    await como(e.a.authId, "select public.desbloquear_usuario($1)", [e.chofer.usuario])

    expect((await db.query("select activo from usuarios where id = $1", [e.chofer.usuario])).rows[0].activo).toBe(false)
    expect((await reservar(e.usuarioChofer)).permitido).toBe(false)
  })

  it("D5. nadie toca los bloqueos ni la auditoría directamente desde el navegador", async () => {
    const e = await escenario()
    await bloquear(e)

    await expect(
      como(e.a.authId, "update bloqueos_de_acceso set bloqueado_hasta = null where usuario_id = $1", [e.chofer.usuario])
    ).rejects.toMatchObject(RECHAZO)
    await expect(
      como(e.a.authId, "insert into auditoria_accesos (empresa_id, usuario_id, accion) values ($1, $2, 'desbloqueo')", [
        e.a.empresa,
        e.chofer.usuario,
      ])
    ).rejects.toMatchObject(RECHAZO)
    // Leer sí: el administrador de la empresa ve el bloqueo; el empleado, no.
    expect((await como(e.a.authId, "select 1 from bloqueos_de_acceso where usuario_id = $1", [e.chofer.usuario])).rowCount).toBe(1)
    expect((await como(e.chofer.authId, "select 1 from bloqueos_de_acceso")).rowCount).toBe(0)
    expect((await como(e.b.authId, "select 1 from bloqueos_de_acceso where usuario_id = $1", [e.chofer.usuario])).rowCount).toBe(0)
  })
})

// ── ALTA DE EMPLEADOS ─────────────────────────────────────

describe("USR-1 alta de empleados (desde la Edge Function)", () => {
  const ALTA = "select public.registrar_empleado($1, $2, $3, $4, $5, $6, $7, $8, $9) as id"

  it("A1. registra al empleado con su rol, permisos y ubicación, y le exige cambiar la contraseña", async () => {
    const e = await escenario()
    const correo = `nuevo${e.n}@prueba.local`
    const authId = await cuentaAuth(correo)

    const id = (
      await comoServicio(ALTA, [e.a.authId, authId, "Ana Pérez", `ana.${e.n}`, correo, "vendedor", ["pos", "inventory-own"], e.camion2, true])
    ).rows[0].id

    const fila = (await db.query("select * from usuarios where id = $1", [id])).rows[0]
    expect(fila).toMatchObject({ empresa_id: e.a.empresa, auth_id: authId, nombre_usuario: `ana.${e.n}`, rol: "vendedor", ubicacion_id: e.camion2, debe_cambiar_contrasena: true, activo: true })
    expect((await db.query("select array_agg(seccion order by seccion) s from permisos_usuario where usuario_id = $1", [id])).rows[0].s).toEqual(["inventory-own", "pos"])
    expect(await contar(db, "auditoria_accesos", "usuario_id = $1 and accion = 'creacion'", [id])).toBe(1)
  })

  it("A2. solo un administrador activo de la empresa da de alta", async () => {
    const e = await escenario()
    const authId = await cuentaAuth(`x${e.n}@prueba.local`)

    await expect(
      comoServicio(ALTA, [e.chofer.authId, authId, "X", `x.${e.n}`, `x${e.n}@prueba.local`, "vendedor", [], null, true])
    ).rejects.toMatchObject(RECHAZO)
  })

  it("A3. no asigna una ubicación de otra empresa", async () => {
    const e = await escenario()
    const authId = await cuentaAuth(`y${e.n}@prueba.local`)

    await expect(
      comoServicio(ALTA, [e.a.authId, authId, "Y", `y.${e.n}`, `y${e.n}@prueba.local`, "vendedor", ["pos"], e.ubicacionB, true])
    ).rejects.toThrow(/ubicación/i)
  })

  it("A4. el nombre de usuario es único en todo LUNACELL y tiene formato", async () => {
    const e = await escenario()
    const authId = await cuentaAuth(`z${e.n}@prueba.local`)

    await expect(
      comoServicio(ALTA, [e.b.authId, authId, "Z", e.usuarioChofer, `z${e.n}@prueba.local`, "vendedor", [], null, true])
    ).rejects.toMatchObject({ code: "23505" })
    await expect(
      comoServicio(ALTA, [e.a.authId, authId, "Z", "Con Espacios", `z${e.n}@prueba.local`, "vendedor", [], null, true])
    ).rejects.toMatchObject({ code: "23514" })
  })

  it("A5. validar_alta_empleado avisa antes de crear la identidad", async () => {
    const e = await escenario()

    await expect(
      comoServicio("select public.validar_alta_empleado($1, $2, $3, $4)", [e.a.authId, e.usuarioChofer, `w${e.n}@prueba.local`, null])
    ).rejects.toThrow(/nombre de usuario/i)
    expect(
      (await comoServicio("select public.validar_alta_empleado($1, $2, $3, $4) as empresa", [e.a.authId, `libre.${e.n}`, `w${e.n}@prueba.local`, e.camion1])).rows[0].empresa
    ).toBe(e.a.empresa)
  })
})

// ── RESTABLECER Y CAMBIAR ─────────────────────────────────

describe("USR-1 restablecer y cambiar contraseña", () => {
  const VALIDAR = "select public.validar_restablecimiento($1, $2) as auth_id"
  const CONFIRMAR = "select public.confirmar_restablecimiento($1, $2, $3)"
  const debeCambiar = async (usuario) =>
    (await db.query("select debe_cambiar_contrasena from usuarios where id = $1", [usuario])).rows[0].debe_cambiar_contrasena

  it("R1. validar no cambia nada: si Auth falla después, el empleado sigue vendiendo", async () => {
    const e = await escenario()

    const authId = (await comoServicio(VALIDAR, [e.a.authId, e.chofer.usuario])).rows[0].auth_id

    expect(authId).toBe(e.chofer.authId)
    expect(await debeCambiar(e.chofer.usuario)).toBe(false)
    expect(await contar(db, "auditoria_accesos", "usuario_id = $1", [e.chofer.usuario])).toBe(0)
    expect((await como(e.chofer.authId, "select public.empresa_del_usuario() as x")).rows[0].x).toBe(e.a.empresa)
    expect((await como(e.chofer.authId, "select 1 from inventario_ubicacion")).rowCount).toBe(1)
  })

  it("R2. confirmar, después de que Auth guardó la temporal, exige cambiarla, desbloquea y audita", async () => {
    const e = await escenario()
    for (let i = 1; i <= 5; i++) await fallar(e.usuarioChofer)

    await comoServicio(CONFIRMAR, [e.a.authId, e.chofer.usuario, true])

    expect(await debeCambiar(e.chofer.usuario)).toBe(true)
    expect((await bloqueo(e.chofer.usuario)).bloqueado_hasta).toBeNull()
    expect(await contar(db, "auditoria_accesos", "usuario_id = $1 and accion = 'restablecimiento'", [e.chofer.usuario])).toBe(1)
  })

  it("R3. ni un empleado ni el administrador de otra empresa validan o confirman", async () => {
    const e = await escenario()

    for (const quien of [e.chofer.authId, e.b.authId]) {
      await expect(comoServicio(VALIDAR, [quien, e.chofer.usuario])).rejects.toMatchObject(RECHAZO)
      await expect(comoServicio(CONFIRMAR, [quien, e.chofer.usuario, true])).rejects.toMatchObject(RECHAZO)
    }
    expect(await debeCambiar(e.chofer.usuario)).toBe(false)
  })

  it("R4. el cambio de contraseña confirmado por el servidor levanta la exigencia, y repetirlo no daña", async () => {
    const e = await escenario()
    await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [e.chofer.usuario])

    await comoServicio("select public.acceso_contrasena_cambiada($1)", [e.chofer.authId])
    await comoServicio("select public.acceso_contrasena_cambiada($1)", [e.chofer.authId])

    expect(await debeCambiar(e.chofer.usuario)).toBe(false)
  })
})

// ── CAMBIO OBLIGATORIO: BLOQUEO EN EL SERVIDOR ────────────

describe("USR-1 sin cambiar la contraseña no se opera", () => {
  it("C1. el vendedor del Camión 01 no ve ni vende nada hasta cambiarla; después, solo su camión", async () => {
    const e = await escenario()
    await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [e.chofer.usuario])

    // Antes: ni empresa, ni existencias, ni ventas (RPC SECURITY DEFINER incluida).
    expect((await como(e.chofer.authId, "select public.empresa_del_usuario() as x")).rows[0].x).toBeNull()
    expect((await como(e.chofer.authId, "select public.ubicacion_del_usuario() as x")).rows[0].x).toBeNull()
    expect((await como(e.chofer.authId, "select public.usuario_tiene_permiso('pos') as x")).rows[0].x).toBe(false)
    expect((await como(e.chofer.authId, "select 1 from inventario_ubicacion")).rowCount).toBe(0)
    await expect(
      como(e.chofer.authId, "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', null)", [
        JSON.stringify([{ producto_id: e.producto, cantidad: 1 }]),
      ])
    ).rejects.toThrow()
    // Su propio perfil sí: el frontend lo necesita para pedirle el cambio.
    expect((await como(e.chofer.authId, "select debe_cambiar_contrasena from usuarios where auth_id = auth.uid()")).rows[0].debe_cambiar_contrasena).toBe(true)

    await comoServicio("select public.acceso_contrasena_cambiada($1)", [e.chofer.authId])

    // Después: su ubicación, sus permisos (y ninguno más) y solo la existencia de su camión.
    expect((await como(e.chofer.authId, "select public.ubicacion_del_usuario() as x")).rows[0].x).toBe(e.camion1)
    const permisos = (
      await como(
        e.chofer.authId,
        "select public.usuario_tiene_permiso('pos') as pos, public.usuario_tiene_permiso('inventory-own') as propio, public.usuario_tiene_permiso('settings') as ajustes, public.usuario_tiene_permiso('products') as productos"
      )
    ).rows[0]
    expect(permisos).toEqual({ pos: true, propio: true, ajustes: false, productos: false })
    const visibles = (await como(e.chofer.authId, "select ubicacion_id, cantidad from inventario_ubicacion")).rows
    expect(visibles).toEqual([{ ubicacion_id: e.camion1, cantidad: 5 }])
  })

  it("C2. un administrador que debe cambiarla tampoco administra", async () => {
    const e = await escenario()
    await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [e.a.usuario])

    expect((await como(e.a.authId, "select public.usuario_es_admin() as x")).rows[0].x).toBe(false)
    await expect(como(e.a.authId, "select public.desbloquear_usuario($1)", [e.chofer.usuario])).rejects.toMatchObject(RECHAZO)
    await expect(
      comoServicio("select public.validar_restablecimiento($1, $2)", [e.a.authId, e.chofer.usuario])
    ).rejects.toMatchObject(RECHAZO)
  })
})

// ── USUARIOS: SIN BORRADO, ÚLTIMO ADMIN, PERMISOS ─────────

describe("USR-1 usuarios: sin borrado, último administrador y permisos", () => {
  it("U1. nadie borra usuarios desde la aplicación; se desactivan", async () => {
    const e = await escenario()

    await expect(como(e.a.authId, "delete from usuarios where id = $1", [e.chofer.usuario])).rejects.toMatchObject(RECHAZO)
    expect((await como(e.a.authId, "update usuarios set activo = false where id = $1", [e.chofer.usuario])).rowCount).toBe(1)
  })

  it("U2. el navegador no crea usuarios ni toca su identidad, usuario o exigencia de cambio", async () => {
    const e = await escenario()

    await expect(
      como(e.a.authId, "insert into usuarios (empresa_id, email, nombre) values ($1, 'x@y.z', 'X')", [e.a.empresa])
    ).rejects.toMatchObject(RECHAZO)
    for (const columna of ["debe_cambiar_contrasena = false", "nombre_usuario = 'otro'", "auth_id = null", "email = 'a@b.c'"]) {
      await expect(como(e.a.authId, `update usuarios set ${columna} where id = $1`, [e.chofer.usuario])).rejects.toMatchObject(RECHAZO)
    }
  })

  it("U3. la empresa no se queda sin administrador activo", async () => {
    const e = await escenario()

    // Con dos administradores, uno puede dejar de serlo.
    expect((await como(e.a.authId, "update usuarios set activo = false where id = $1", [e.admin2.usuario])).rowCount).toBe(1)
    // Con uno solo, no se desactiva ni pierde el rol.
    await expect(como(e.a.authId, "update usuarios set activo = false where id = $1", [e.a.usuario])).rejects.toThrow(/administrador/i)
    await expect(como(e.a.authId, "update usuarios set rol = 'vendedor' where id = $1", [e.a.usuario])).rejects.toThrow(/administrador/i)
    await expect(db.query("delete from usuarios where id = $1", [e.a.usuario])).rejects.toThrow(/administrador/i)
  })

  it("U4. guardar permisos es todo o nada", async () => {
    const e = await escenario()

    await expect(
      como(e.a.authId, "select public.guardar_permisos_usuario($1, $2)", [e.chofer.usuario, ["pos", "no-existe"]])
    ).rejects.toThrow()
    expect((await db.query("select array_agg(seccion order by seccion) s from permisos_usuario where usuario_id = $1", [e.chofer.usuario])).rows[0].s).toEqual(["inventory-own", "pos"])

    await como(e.a.authId, "select public.guardar_permisos_usuario($1, $2)", [e.chofer.usuario, ["pos", "quotes", "pos"]])
    expect((await db.query("select array_agg(seccion order by seccion) s from permisos_usuario where usuario_id = $1", [e.chofer.usuario])).rows[0].s).toEqual(["pos", "quotes"])
  })

  it("U5. un empleado no se da permisos", async () => {
    const e = await escenario()

    await expect(
      como(e.chofer.authId, "select public.guardar_permisos_usuario($1, $2)", [e.chofer.usuario, ["settings"]])
    ).rejects.toMatchObject(RECHAZO)
  })
})

// ── CAMINOS CERRADOS ──────────────────────────────────────

describe("USR-1 caminos cerrados", () => {
  it("K1. crear una cuenta con el correo de un invitado ya no lo vincula", async () => {
    const e = await escenario()
    await db.query("insert into usuarios (empresa_id, email, nombre) values ($1, $2, 'Invitado')", [e.a.empresa, `inv${e.n}@prueba.local`])

    await cuentaAuth(`inv${e.n}@prueba.local`)

    expect(await contar(db, "usuarios", "email = $1 and auth_id is null", [`inv${e.n}@prueba.local`])).toBe(1)
  })

  it("K2. solo service_role ejecuta las funciones de la Edge Function", async () => {
    const e = await escenario()
    const llamadas = [
      ["select * from public.acceso_reservar_intento($1)", [e.usuarioChofer]],
      ["select public.acceso_registrar_resultado(gen_random_uuid(), true)", []],
      ["select public.acceso_contrasena_cambiada($1)", [e.chofer.authId]],
      ["select public.validar_restablecimiento($1, $2)", [e.a.authId, e.chofer.usuario]],
      ["select public.confirmar_restablecimiento($1, $2, true)", [e.a.authId, e.chofer.usuario]],
      ["select public.validar_alta_empleado($1, $2, $3, $4)", [e.a.authId, "q.q", "q@q.q", null]],
      ["select public.vincular_usuario_invitado()", []],
    ]

    for (const [consulta, valores] of llamadas) {
      for (const quien of [null, e.a.authId]) {
        await expect(como(quien, consulta, valores)).rejects.toMatchObject(RECHAZO)
      }
    }
  })

  it("K3. anon no escribe en usuarios ni en permisos", async () => {
    const { rows } = await db.query(
      `select t, has_table_privilege('anon', 'public.' || t, 'INSERT')
               or has_table_privilege('anon', 'public.' || t, 'UPDATE')
               or has_table_privilege('anon', 'public.' || t, 'DELETE') as escribe
         from unnest(array['usuarios', 'permisos_usuario', 'bloqueos_de_acceso', 'reservas_de_acceso', 'auditoria_accesos']) t`
    )

    expect(rows.filter((r) => r.escribe).map((r) => r.t)).toEqual([])
  })
})
