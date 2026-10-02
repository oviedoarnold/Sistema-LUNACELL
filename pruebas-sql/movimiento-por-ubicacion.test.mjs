/*
  Entradas y ajustes por ubicación, contra PostgreSQL de verdad.

  Lo que se afirma aquí es la invariante de INV-3.2.1: cada entrada o
  ajuste mueve la celda de SU ubicación y deja el mismo número escrito en
  el libro, de modo que la suma de las celdas de un producto es siempre la
  suma de sus movimientos. Un doble en memoria no puede comprobarlo: no
  tiene candados, ni transacciones, ni el check que impide el negativo.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import {
  levantarBase,
  comoUsuario,
  comoDueno,
  esperarBloqueo,
} from "./arnes.mjs"
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

/*
  Una empresa con su administrador, dos ubicaciones activas, una
  desactivada, un producto activo y otro descontinuado. Sin existencias:
  cada caso carga las que necesita a través del RPC o sembrándolas.
*/
async function escenario() {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  /*
    Todo en dos sentencias y no fila por fila. Se devuelve el nombre junto
    al id porque el orden del RETURNING no está garantizado.
  */
  const idPorNombre = ({ rows }) =>
    Object.fromEntries(rows.map((fila) => [fila.nombre, fila.id]))

  const ubicaciones = idPorNombre(
    await db.query(
      `insert into ubicaciones (empresa_id, nombre, tipo, activa)
       select $1, u.nombre, u.tipo, u.activa
         from (values ('Bodega Principal', 'bodega', true),
                      ('Lunacell Store', 'tienda', true),
                      ('Camión fuera de servicio', 'camion', false))
              as u (nombre, tipo, activa)
       returning id, nombre`,
      [empresa]
    )
  )

  const productos = idPorNombre(
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo, activo)
       select $1, 'C-' || substr(md5(random()::text), 1, 8), p.nombre, 100, 10, p.activo
         from (values ('Cargador', true), ('Descontinuado', false))
              as p (nombre, activo)
       returning id, nombre`,
      [empresa]
    )
  )

  return {
    empresa,
    usuario,
    authId,
    bodega: ubicaciones["Bodega Principal"],
    tienda: ubicaciones["Lunacell Store"],
    cerrada: ubicaciones["Camión fuera de servicio"],
    cargador: productos.Cargador,
    descontinuado: productos.Descontinuado,
  }
}

/* Llama al RPC haciéndose pasar por ese usuario y devuelve lo que responde. */
async function mover(authId, { producto, ubicacion, tipo, cantidad, motivo }) {
  await comoUsuario(db, authId)

  try {
    const r = await db.query(
      "select registrar_movimiento_ubicacion($1, $2, $3, $4, $5) as res",
      [producto, ubicacion, tipo, cantidad, motivo ?? ""]
    )

    return r.rows[0].res
  } finally {
    await comoDueno(db)
  }
}

const existencia = async (ubicacion, producto) => {
  const r = await db.query(
    `select cantidad from inventario_ubicacion
      where ubicacion_id = $1 and producto_id = $2`,
    [ubicacion, producto]
  )

  return r.rows[0]?.cantidad ?? null
}

/* Lo que dice el libro de ese producto, sumando todos sus movimientos. */
const libro = async (producto) => {
  const r = await db.query(
    `select coalesce(sum(cantidad), 0)::int as total
       from movimientos_inventario where producto_id = $1`,
    [producto]
  )

  return r.rows[0].total
}

/* Lo que dicen las celdas de ese producto, sumando todas sus ubicaciones. */
const celdas = async (producto) => {
  const r = await db.query(
    `select coalesce(sum(cantidad), 0)::int as total
       from inventario_ubicacion where producto_id = $1`,
    [producto]
  )

  return r.rows[0].total
}

// ── LO QUE FUNCIONA ───────────────────────────────────────

describe("entradas y ajustes", () => {
  it("1. una entrada inicial crea la celda y su movimiento con ubicación", async () => {
    const e = await escenario()

    const res = await mover(e.authId, {
      producto: e.cargador,
      ubicacion: e.bodega,
      tipo: "entrada",
      cantidad: 20,
    })

    expect(res.existencia_anterior).toBe(0)
    expect(res.existencia_nueva).toBe(20)
    expect(await existencia(e.bodega, e.cargador)).toBe(20)

    const m = await db.query(
      `select empresa_id, usuario_id, ubicacion_id, tipo, cantidad, motivo, venta_id
         from movimientos_inventario where id = $1`,
      [res.movimiento_id]
    )

    expect(m.rows[0]).toMatchObject({
      empresa_id: e.empresa,
      usuario_id: e.usuario,
      ubicacion_id: e.bodega,
      tipo: "entrada",
      cantidad: 20,
      motivo: "Existencia inicial",
      venta_id: null,
    })
  })

  it("2. una entrada adicional suma sobre la celda que ya existe", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 20 })
    const res = await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 5 })

    expect(res.existencia_anterior).toBe(20)
    expect(res.existencia_nueva).toBe(25)
    expect(await existencia(e.bodega, e.cargador)).toBe(25)
    expect(
      await contar(db, "inventario_ubicacion", "producto_id = $1", [e.cargador])
    ).toBe(1)
  })

  it("3. un ajuste positivo suma y queda como ajuste", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 10 })
    const res = await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "ajuste", cantidad: 3 })

    expect(res.existencia_nueva).toBe(13)

    const m = await db.query(
      "select tipo, cantidad, motivo from movimientos_inventario where id = $1",
      [res.movimiento_id]
    )

    expect(m.rows[0]).toEqual({
      tipo: "ajuste",
      cantidad: 3,
      motivo: "Ajuste manual desde inventario",
    })
  })

  it("4. un ajuste negativo resta y se anota en negativo", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 10 })
    const res = await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "ajuste", cantidad: -4 })

    expect(res.existencia_nueva).toBe(6)
    expect(await existencia(e.bodega, e.cargador)).toBe(6)

    const m = await db.query(
      "select cantidad from movimientos_inventario where id = $1",
      [res.movimiento_id]
    )

    expect(m.rows[0].cantidad).toBe(-4)
  })

  it("5. un ajuste puede dejar la celda exactamente en cero", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 4 })
    const res = await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "ajuste", cantidad: -4 })

    expect(res.existencia_nueva).toBe(0)
  })

  it("6. el motivo escrito por el usuario se conserva", async () => {
    const e = await escenario()

    const res = await mover(e.authId, {
      producto: e.cargador,
      ubicacion: e.bodega,
      tipo: "entrada",
      cantidad: 2,
      motivo: "Conteo físico",
    })

    const m = await db.query(
      "select motivo from movimientos_inventario where id = $1",
      [res.movimiento_id]
    )

    expect(m.rows[0].motivo).toBe("Conteo físico")
  })

  /*
    Cada ubicación tiene su propia existencia: cargar la tienda no toca la
    bodega. Es lo que distingue esta fase de un traslado, que movería de
    una a otra.
  */
  it("7. mover una ubicación no toca la existencia de otra", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 20 })
    await mover(e.authId, { producto: e.cargador, ubicacion: e.tienda, tipo: "entrada", cantidad: 3 })

    expect(await existencia(e.bodega, e.cargador)).toBe(20)
    expect(await existencia(e.tienda, e.cargador)).toBe(3)
  })
})

// ── LOS RECHAZOS ──────────────────────────────────────────

describe("los rechazos", () => {
  it("8. un ajuste que dejaría negativo se rechaza con LI003 y dice cuánto hay", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 3 })

    const intento = mover(e.authId, {
      producto: e.cargador,
      ubicacion: e.bodega,
      tipo: "ajuste",
      cantidad: -5,
    })

    await expect(intento).rejects.toMatchObject({ code: "LI003" })
    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "ajuste", cantidad: -5 })
    ).rejects.toThrow(/hay 3, el ajuste quita 5/i)

    expect(await existencia(e.bodega, e.cargador)).toBe(3)
  })

  it("9. una ubicación desactivada se rechaza con LI001", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.cerrada, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "LI001" })
  })

  it("10. un tipo desconocido se rechaza con LI002", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "traslado", cantidad: 1 })
    ).rejects.toMatchObject({ code: "LI002" })
  })

  it("11. una cantidad de cero se rechaza con LI002", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "ajuste", cantidad: 0 })
    ).rejects.toMatchObject({ code: "LI002" })
  })

  it("12. una entrada negativa se rechaza con LI002", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: -3 })
    ).rejects.toMatchObject({ code: "LI002" })
  })

  it("13. sin producto o sin ubicación se rechaza con LI002", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: null, ubicacion: e.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "LI002" })

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: null, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "LI002" })
  })

  it("14. un producto inactivo se rechaza con LI004", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, { producto: e.descontinuado, ubicacion: e.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "LI004" })
  })

  it("15. un producto que no existe se rechaza con LI004", async () => {
    const e = await escenario()

    await expect(
      mover(e.authId, {
        producto: "00000000-0000-0000-0000-000000000000",
        ubicacion: e.bodega,
        tipo: "entrada",
        cantidad: 1,
      })
    ).rejects.toMatchObject({ code: "LI004" })
  })
})

// ── AISLAMIENTO ENTRE EMPRESAS ────────────────────────────

describe("aislamiento entre empresas", () => {
  it("16. una ubicación de otra empresa se rechaza con 42501", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      mover(mia.authId, { producto: mia.cargador, ubicacion: ajena.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "42501" })

    expect(await existencia(ajena.bodega, mia.cargador)).toBe(null)
  })

  it("17. un producto de otra empresa se rechaza con 42501", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      mover(mia.authId, { producto: ajena.cargador, ubicacion: mia.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "42501" })

    expect(
      await contar(db, "movimientos_inventario", "producto_id = $1", [ajena.cargador])
    ).toBe(0)
  })

  it("18. el movimiento queda siempre en la empresa de quien lo registra", async () => {
    const mia = await escenario()
    await escenario()

    const res = await mover(mia.authId, {
      producto: mia.cargador,
      ubicacion: mia.bodega,
      tipo: "entrada",
      cantidad: 1,
    })

    const m = await db.query(
      "select empresa_id from movimientos_inventario where id = $1",
      [res.movimiento_id]
    )
    const c = await db.query(
      "select empresa_id from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2",
      [mia.bodega, mia.cargador]
    )

    expect(m.rows[0].empresa_id).toBe(mia.empresa)
    expect(c.rows[0].empresa_id).toBe(mia.empresa)
  })
})

// ── PERMISOS ──────────────────────────────────────────────

describe("quién puede ejecutarla", () => {
  it("19. la ejecutan authenticated y service_role; anon no", async () => {
    const r = await db.query(
      `select rol, has_function_privilege(
                rol,
                'registrar_movimiento_ubicacion(uuid,uuid,text,integer,text)',
                'EXECUTE'
              ) as puede
         from unnest(array['anon', 'authenticated', 'service_role']) as rol`
    )

    expect(Object.fromEntries(r.rows.map((f) => [f.rol, f.puede]))).toEqual({
      anon: false,
      authenticated: true,
      service_role: true,
    })
  })

  /*
    PostgreSQL concede EXECUTE a PUBLIC al crear la función, y cualquier
    rol nuevo lo heredaría. El ACL no debe conservar esa concesión.
  */
  it("20. PUBLIC no conserva el EXECUTE que PostgreSQL da por omisión", async () => {
    const r = await db.query(
      `select exists (
                select 1 from aclexplode(p.proacl) a where a.grantee = 0
              ) as publico
         from pg_proc p
        where p.oid = 'registrar_movimiento_ubicacion(uuid,uuid,text,integer,text)'::regprocedure`
    )

    expect(r.rows[0].publico).toBe(false)
  })

  it("21. un usuario sin el permiso products se rechaza con 42501", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      permisos: ["pos", "inventory-all"],
    })

    await expect(
      mover(v.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "42501" })

    expect(await existencia(e.bodega, e.cargador)).toBe(null)
  })

  /*
    G1: con el permiso de Productos se puede cargar cualquier ubicación
    activa de la empresa, no solo la propia. Este vendedor opera desde la
    tienda y carga la bodega.
  */
  it("22. con el permiso products se puede mover cualquier ubicación activa, no solo la propia", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.tienda,
      permisos: ["products"],
    })

    const res = await mover(v.authId, {
      producto: e.cargador,
      ubicacion: e.bodega,
      tipo: "entrada",
      cantidad: 7,
    })

    expect(res.existencia_nueva).toBe(7)

    const m = await db.query(
      "select usuario_id from movimientos_inventario where id = $1",
      [res.movimiento_id]
    )

    expect(m.rows[0].usuario_id).toBe(v.usuario)
  })

  it("23. un usuario inactivo no puede mover inventario", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      permisos: ["products"],
      activo: false,
    })

    await expect(
      mover(v.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 1 })
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("24. sin sesión no hay empresa y no se puede mover nada", async () => {
    const e = await escenario()

    await comoUsuario(db, null)

    await expect(
      db.query(
        "select registrar_movimiento_ubicacion($1, $2, 'entrada', 1)",
        [e.cargador, e.bodega]
      )
    ).rejects.toThrow()

    await comoDueno(db)
  })

  /*
    La 0014 revocó la escritura directa de inventario_ubicacion. Esta fase
    no la abre: el único camino sigue siendo una función.
  */
  it("25. authenticated sigue sin poder escribir la celda directamente", async () => {
    const e = await escenario()

    await comoUsuario(db, e.authId)

    try {
      await expect(
        db.query(
          `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
           values ($1, $2, $3, 5)`,
          [e.empresa, e.bodega, e.cargador]
        )
      ).rejects.toThrow(/permission denied/i)
    } finally {
      await comoDueno(db)
    }
  })
})

// ── ATOMICIDAD ────────────────────────────────────────────

describe("o entra todo o no entra nada", () => {
  /*
    La celda se crea en cero antes de validar el negativo. Si el ajuste se
    rechaza, esa celda tiene que desaparecer con la transacción: si
    quedara, la vista mostraría un cero que nadie registró.
  */
  it("26. un rechazo sobre una celda nueva no deja celda ni movimiento", async () => {
    const e = await escenario()

    const movAntes = await contar(db, "movimientos_inventario")

    await expect(
      mover(e.authId, { producto: e.cargador, ubicacion: e.tienda, tipo: "ajuste", cantidad: -1 })
    ).rejects.toMatchObject({ code: "LI003" })

    expect(await existencia(e.tienda, e.cargador)).toBe(null)
    expect(await contar(db, "movimientos_inventario")).toBe(movAntes)
  })

  /*
    El caso difícil: la celda ya se actualizó y lo que falla es escribir el
    movimiento. Se provoca con una restricción puesta solo para la prueba.
    Si la función no fuera atómica, la celda quedaría movida sin rastro en
    el libro, que es exactamente el descuadre que esta fase viene a
    impedir.
  */
  it("27. si falla el movimiento, la celda no se mueve", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 10 })

    await db.query(
      `alter table movimientos_inventario
         add constraint prueba_motivo_prohibido check (motivo <> 'falla a propósito')`
    )

    try {
      await expect(
        mover(e.authId, {
          producto: e.cargador,
          ubicacion: e.bodega,
          tipo: "ajuste",
          cantidad: -4,
          motivo: "falla a propósito",
        })
      ).rejects.toThrow(/prueba_motivo_prohibido/)
    } finally {
      await db.query(
        "alter table movimientos_inventario drop constraint prueba_motivo_prohibido"
      )
    }

    expect(await existencia(e.bodega, e.cargador)).toBe(10)
    expect(await libro(e.cargador)).toBe(10)
  })
})

// ── CONCURRENCIA REAL ─────────────────────────────────────

/*
  Dos sesiones del mismo usuario, cada una en su transacción.

  A hace su parte y se queda sin confirmar. B sale después, y la prueba no
  sigue hasta que PostgreSQL confirme, en pg_stat_activity, que B está
  DETENIDA esperando el candado de A: si la función no serializara, esa
  espera agotaría su tiempo y el caso fallaría. Después A confirma y se
  devuelve lo que respondió B, que confirma si entró y deshace si no.
*/
async function mientrasLaOtraEspera(authId, { primera, segunda }) {
  const a = await base.conectar()
  const b = await base.conectar()

  try {
    await comoUsuario(a, authId)
    await comoUsuario(b, authId)

    const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid

    await a.query("begin")
    await b.query("begin")

    await primera(a)

    // El rechazo de B se recoge aquí mismo para que no quede suelto.
    const deB = segunda(b).then(
      (respuesta) => ({ respuesta }),
      (error) => ({ error })
    )

    /* La observadora es `db`: un rol sin privilegios no ve la espera ajena. */
    expect(await esperarBloqueo(db, pidB)).toMatch(/^Lock\//)

    await a.query("commit")

    const resultado = await deB

    await b.query(resultado.error ? "rollback" : "commit")

    return resultado
  } finally {
    await a.end()
    await b.end()
  }
}

const ajustar = (cantidad, e) => (sesion) =>
  sesion.query(
    "select registrar_movimiento_ubicacion($1, $2, 'ajuste', $3)",
    [e.cargador, e.bodega, cantidad]
  )

describe("concurrencia", () => {
  /*
    Dos ajustes de −7 sobre 10, a la vez. Al soltarse el candado, B relee
    la celda —ahora 3— y rechaza. Si leyera el valor viejo, dejaría −4.
  */
  it("28. dos ajustes de −7 sobre 10: solo uno entra", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 10 })

    const { error } = await mientrasLaOtraEspera(e.authId, {
      primera: ajustar(-7, e),
      segunda: ajustar(-7, e),
    })

    expect(error?.message).toMatch(/hay 3, el ajuste quita 7/i)
    expect(await existencia(e.bodega, e.cargador)).toBe(3)
    expect(await libro(e.cargador)).toBe(3)
  })

  /*
    Un ajuste y una venta sobre la misma celda usan el mismo candado. Si no
    lo compartieran, la venta podría leer 10 mientras el ajuste deja 3, y
    vender 7 que ya no están.
  */
  it("29. un ajuste y una venta simultáneos sobre la misma celda se ordenan", async () => {
    const e = await escenario()

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [
      e.bodega,
      e.usuario,
    ])
    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 10 })

    const { error } = await mientrasLaOtraEspera(e.authId, {
      primera: ajustar(-7, e),
      segunda: (sesion) =>
        sesion.query("select registrar_venta_ubicacion($1::jsonb) as res", [
          JSON.stringify([{ producto_id: e.cargador, cantidad: 7 }]),
        ]),
    })

    expect(error?.message).toMatch(/hay 3, se piden 7/i)
    expect(await existencia(e.bodega, e.cargador)).toBe(3)
  })

  /*
    La celda que todavía no existe es el caso que el `on conflict` cubre:
    dos entradas simultáneas a una ubicación vacía no pueden fallar por la
    llave primaria ni perder una de las dos sumas.
  */
  it("30. dos entradas simultáneas a una celda nueva suman las dos", async () => {
    const e = await escenario()

    const entrar = (cantidad) => (sesion) =>
      sesion.query(
        "select registrar_movimiento_ubicacion($1, $2, 'entrada', $3)",
        [e.cargador, e.tienda, cantidad]
      )

    const { error } = await mientrasLaOtraEspera(e.authId, {
      primera: entrar(4),
      segunda: entrar(6),
    })

    expect(error).toBeUndefined()
    expect(await existencia(e.tienda, e.cargador)).toBe(10)
  })
})

// ── LA INVARIANTE ─────────────────────────────────────────

describe("el libro y las celdas dicen lo mismo", () => {
  it("31. tras entradas, ajustes y rechazos en dos ubicaciones, la suma coincide", async () => {
    const e = await escenario()

    const pasos = [
      { ubicacion: e.bodega, tipo: "entrada", cantidad: 20 },
      { ubicacion: e.tienda, tipo: "entrada", cantidad: 5 },
      { ubicacion: e.bodega, tipo: "ajuste", cantidad: -3 },
      { ubicacion: e.tienda, tipo: "ajuste", cantidad: 2 },
      { ubicacion: e.tienda, tipo: "ajuste", cantidad: -50 }, // se rechaza
      { ubicacion: e.bodega, tipo: "entrada", cantidad: 1 },
    ]

    for (const paso of pasos) {
      await mover(e.authId, { producto: e.cargador, ...paso }).catch(() => {})
    }

    expect(await existencia(e.bodega, e.cargador)).toBe(18)
    expect(await existencia(e.tienda, e.cargador)).toBe(7)
    expect(await celdas(e.cargador)).toBe(25)
    expect(await libro(e.cargador)).toBe(25)

    /* Y ningún movimiento de esta fase queda sin ubicación. */
    expect(
      await contar(
        db,
        "movimientos_inventario",
        "producto_id = $1 and ubicacion_id is null",
        [e.cargador]
      )
    ).toBe(0)
  })

  /*
    Lo que lee el catálogo —productos_con_stock, la suma del libro— sigue
    viendo lo cargado por ubicación. Es la otra mitad de la invariante:
    el stock global se deriva, no se escribe aparte.
  */
  it("32. el stock global del catálogo refleja lo cargado por ubicación", async () => {
    const e = await escenario()

    await mover(e.authId, { producto: e.cargador, ubicacion: e.bodega, tipo: "entrada", cantidad: 8 })
    await mover(e.authId, { producto: e.cargador, ubicacion: e.tienda, tipo: "entrada", cantidad: 2 })

    const r = await db.query(
      "select stock from productos_con_stock where id = $1",
      [e.cargador]
    )

    expect(Number(r.rows[0].stock)).toBe(10)
  })
})
