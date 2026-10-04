/*
  Los traslados entre ubicaciones, contra PostgreSQL de verdad.

  Un traslado mueve existencia de una ubicación a otra: descuenta el
  origen, suma al destino y deja en el libro una salida y una entrada por
  producto, todo ligado a una cabecera. Lo que se afirma aquí es que eso
  ocurre entero o no ocurre, que dos operaciones sobre la misma existencia
  se ordenan sin bloquearse para siempre, y que el stock global no cambia:
  trasladar no crea ni destruye mercadería.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import {
  levantarBase,
  comoUsuario,
  comoDueno,
  enDosSesiones,
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
  Una empresa con su administrador, cuatro ubicaciones como las de
  LUNACELL más una desactivada, dos productos activos y uno descontinuado.

  La existencia inicial entra por registrar_movimiento_ubicacion(), como
  en producción, para que el libro y las celdas partan cuadrados y la
  coherencia que se mide después sea la del traslado.
*/
async function escenario({ enBodega = { cargador: 10, cubo: 6 } } = {}) {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  const porNombre = ({ rows }) =>
    Object.fromEntries(rows.map((fila) => [fila.nombre, fila.id]))

  const u = porNombre(
    await db.query(
      `insert into ubicaciones (empresa_id, nombre, tipo, activa)
       select $1, x.nombre, x.tipo, x.activa
         from (values ('Lunacell Bodega', 'bodega', true),
                      ('Lunacell Store', 'tienda', true),
                      ('Camión 01', 'camion', true),
                      ('Camión 02', 'camion', true),
                      ('Camión retirado', 'camion', false))
              as x (nombre, tipo, activa)
       returning id, nombre`,
      [empresa]
    )
  )

  const p = porNombre(
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo, activo)
       select $1, 'T-' || substr(md5(random()::text), 1, 8), x.nombre, 100, 10, x.activo
         from (values ('Cargador', true), ('Cubo Iphone', true), ('Descontinuado', false))
              as x (nombre, activo)
       returning id, nombre`,
      [empresa]
    )
  )

  const e = {
    empresa,
    usuario,
    authId,
    bodega: u["Lunacell Bodega"],
    store: u["Lunacell Store"],
    camion1: u["Camión 01"],
    camion2: u["Camión 02"],
    retirado: u["Camión retirado"],
    cargador: p.Cargador,
    cubo: p["Cubo Iphone"],
    descontinuado: p.Descontinuado,
  }

  for (const [clave, cantidad] of Object.entries(enBodega)) {
    await como(
      authId,
      "select registrar_movimiento_ubicacion($1, $2, 'entrada', $3)",
      [e[clave], e.bodega, cantidad]
    )
  }

  return e
}

/* Corre una consulta como ese usuario y vuelve a dueño pase lo que pase. */
async function como(authId, sql, valores = []) {
  await comoUsuario(db, authId)

  try {
    return await db.query(sql, valores)
  } finally {
    await comoDueno(db)
  }
}

const renglon = (producto_id, cantidad) => ({ producto_id, cantidad })

const SQL_TRASLADO =
  "select registrar_traslado($1, $2, $3::jsonb, $4, $5) as res"

const argumentos = ({ origen, destino, items, nota = "", clave = null }) => [
  origen,
  destino,
  JSON.stringify(items),
  nota,
  clave,
]

async function trasladar(authId, datos) {
  const r = await como(authId, SQL_TRASLADO, argumentos(datos))

  return r.rows[0].res
}

/* Lo mismo, pero en una sesión que la prueba controla. */
const trasladarEn = (datos) => (sesion) =>
  sesion.query(SQL_TRASLADO, argumentos(datos))

const existencia = async (ubicacion, producto) => {
  const r = await db.query(
    `select cantidad from inventario_ubicacion
      where ubicacion_id = $1 and producto_id = $2`,
    [ubicacion, producto]
  )

  return r.rows[0]?.cantidad ?? null
}

const libro = async (producto) => {
  const r = await db.query(
    `select coalesce(sum(cantidad), 0)::int as total
       from movimientos_inventario where producto_id = $1`,
    [producto]
  )

  return r.rows[0].total
}

const celdas = async (producto) => {
  const r = await db.query(
    `select coalesce(sum(cantidad), 0)::int as total
       from inventario_ubicacion where producto_id = $1`,
    [producto]
  )

  return r.rows[0].total
}

const stockGlobal = async (producto) => {
  const r = await db.query("select stock from productos_con_stock where id = $1", [producto])

  return Number(r.rows[0].stock)
}

// ── EL TRASLADO QUE FUNCIONA ──────────────────────────────

describe("el traslado normal", () => {
  it("1. mueve la existencia de origen a destino y lo deja todo enlazado", async () => {
    const e = await escenario()

    const res = await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 4)],
      nota: "Reposición de vitrina",
    })

    expect(res).toMatchObject({
      origen_id: e.bodega,
      destino_id: e.store,
      estado: "aplicado",
      repetida: false,
      items: [{ producto_id: e.cargador, cantidad: 4 }],
    })

    expect(await existencia(e.bodega, e.cargador)).toBe(6)
    expect(await existencia(e.store, e.cargador)).toBe(4)

    const cabecera = await db.query(
      "select empresa_id, usuario_id, origen_id, destino_id, estado, nota from traslados where id = $1",
      [res.traslado_id]
    )

    expect(cabecera.rows[0]).toEqual({
      empresa_id: e.empresa,
      usuario_id: e.usuario,
      origen_id: e.bodega,
      destino_id: e.store,
      estado: "aplicado",
      nota: "Reposición de vitrina",
    })

    const detalle = await db.query(
      "select producto_id, cantidad from traslado_detalle where traslado_id = $1",
      [res.traslado_id]
    )

    expect(detalle.rows).toEqual([{ producto_id: e.cargador, cantidad: 4 }])

    const movimientos = await db.query(
      `select ubicacion_id, tipo, cantidad, usuario_id, venta_id
         from movimientos_inventario
        where traslado_id = $1
        order by cantidad`,
      [res.traslado_id]
    )

    expect(movimientos.rows).toEqual([
      { ubicacion_id: e.bodega, tipo: "traslado_salida", cantidad: -4, usuario_id: e.usuario, venta_id: null },
      { ubicacion_id: e.store, tipo: "traslado_entrada", cantidad: 4, usuario_id: e.usuario, venta_id: null },
    ])
  })

  it("2. varios productos en un solo traslado", async () => {
    const e = await escenario()

    const res = await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.camion1,
      items: [renglon(e.cargador, 3), renglon(e.cubo, 2)],
    })

    expect(await existencia(e.bodega, e.cargador)).toBe(7)
    expect(await existencia(e.bodega, e.cubo)).toBe(4)
    expect(await existencia(e.camion1, e.cargador)).toBe(3)
    expect(await existencia(e.camion1, e.cubo)).toBe(2)
    expect(
      await contar(db, "movimientos_inventario", "traslado_id = $1", [res.traslado_id])
    ).toBe(4)
  })

  /*
    Dos renglones del mismo producto son un solo movimiento de mercadería:
    se suman antes de comprobar, igual que en la venta. Tratarlos por
    separado comprobaría cada mitad contra la existencia entera.
  */
  it("3. el mismo producto en dos renglones se agrupa en uno", async () => {
    const e = await escenario()

    const res = await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 3), renglon(e.cargador, 2)],
    })

    expect(res.items).toEqual([{ producto_id: e.cargador, cantidad: 5 }])
    expect(
      await contar(db, "traslado_detalle", "traslado_id = $1", [res.traslado_id])
    ).toBe(1)
    expect(await existencia(e.bodega, e.cargador)).toBe(5)
  })

  it("4. crea la existencia del destino cuando no la había", async () => {
    const e = await escenario()

    expect(await existencia(e.camion2, e.cubo)).toBeNull()

    await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.camion2,
      items: [renglon(e.cubo, 6)],
    })

    expect(await existencia(e.camion2, e.cubo)).toBe(6)
    expect(await existencia(e.bodega, e.cubo)).toBe(0)
  })

  it("5. el motivo de cada movimiento dice de dónde viene y a dónde va", async () => {
    const e = await escenario()

    const res = await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 1)],
    })

    const m = await db.query(
      "select tipo, motivo from movimientos_inventario where traslado_id = $1 order by tipo",
      [res.traslado_id]
    )

    expect(m.rows).toEqual([
      { tipo: "traslado_entrada", motivo: "Traslado desde Lunacell Bodega" },
      { tipo: "traslado_salida", motivo: "Traslado a Lunacell Store" },
    ])
  })
})

// ── LOS RECHAZOS ──────────────────────────────────────────

describe("los rechazos", () => {
  it("6. origen igual a destino → LT001", async () => {
    const e = await escenario()

    await expect(
      trasladar(e.authId, { origen: e.bodega, destino: e.bodega, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "LT001" })
  })

  it("7. origen o destino desactivado → LT002", async () => {
    const e = await escenario()

    await expect(
      trasladar(e.authId, { origen: e.bodega, destino: e.retirado, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "LT002" })

    await expect(
      trasladar(e.authId, { origen: e.retirado, destino: e.bodega, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "LT002" })
  })

  it.each([
    ["sin renglones", []],
    ["cantidad cero", [{ cantidad: 0 }]],
    ["cantidad negativa", [{ cantidad: -2 }]],
    ["cantidad con decimales", [{ cantidad: 1.5 }]],
    ["producto que no es un identificador", [{ producto_id: "no-es-uuid", cantidad: 1 }]],
  ])("8. renglones inválidos (%s) → LT003", async (_caso, renglones) => {
    const e = await escenario()

    const items = renglones.map((r) => ({ producto_id: e.cargador, ...r }))

    await expect(
      trasladar(e.authId, { origen: e.bodega, destino: e.store, items })
    ).rejects.toMatchObject({ code: "LT003" })
  })

  it("9. sin origen o sin destino → LT003", async () => {
    const e = await escenario()

    await expect(
      trasladar(e.authId, { origen: null, destino: e.store, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "LT003" })
  })

  it("10. producto inactivo o inexistente → LT004", async () => {
    const e = await escenario()

    await expect(
      trasladar(e.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.descontinuado, 1)] })
    ).rejects.toMatchObject({ code: "LT004" })

    await expect(
      trasladar(e.authId, {
        origen: e.bodega,
        destino: e.store,
        items: [renglon("00000000-0000-0000-0000-000000000000", 1)],
      })
    ).rejects.toMatchObject({ code: "LT004" })
  })

  it("11. existencia insuficiente → LT005, dice cuánto hay y no mueve nada", async () => {
    const e = await escenario()

    const intento = trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 2), renglon(e.cubo, 9)],
    })

    await expect(intento).rejects.toMatchObject({ code: "LT005" })
    await expect(
      trasladar(e.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.cubo, 9)] })
    ).rejects.toThrow(/hay 6, se trasladan 9/i)

    expect(await existencia(e.bodega, e.cargador)).toBe(10)
    expect(await existencia(e.store, e.cargador)).toBeNull()
  })

  it("12. desde una ubicación sin existencia → LT005", async () => {
    const e = await escenario()

    await expect(
      trasladar(e.authId, { origen: e.store, destino: e.bodega, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "LT005" })
  })
})

// ── QUIÉN PUEDE ───────────────────────────────────────────

describe("quién puede trasladar", () => {
  it("13. la ejecutan authenticated y service_role; ni anon ni PUBLIC", async () => {
    const r = await db.query(
      `select rol, has_function_privilege(
                rol,
                'registrar_traslado(uuid,uuid,jsonb,text,text)',
                'EXECUTE'
              ) as puede
         from unnest(array['anon', 'authenticated', 'service_role']) as rol`
    )

    expect(Object.fromEntries(r.rows.map((f) => [f.rol, f.puede]))).toEqual({
      anon: false,
      authenticated: true,
      service_role: true,
    })

    const publico = await db.query(
      `select exists (
                select 1
                  from pg_proc p, aclexplode(p.proacl) a
                 where p.oid = 'registrar_traslado(uuid,uuid,jsonb,text,text)'::regprocedure
                   and a.grantee = 0
              ) as tiene`
    )

    expect(publico.rows[0].tiene).toBe(false)
  })

  it("14. el administrador traslada entre cualquier par de ubicaciones activas", async () => {
    const e = await escenario()

    await trasladar(e.authId, { origen: e.bodega, destino: e.camion2, items: [renglon(e.cargador, 2)] })
    await trasladar(e.authId, { origen: e.camion2, destino: e.store, items: [renglon(e.cargador, 1)] })

    expect(await existencia(e.camion2, e.cargador)).toBe(1)
    expect(await existencia(e.store, e.cargador)).toBe(1)
  })

  it("15. con inventory-all se traslada entre ubicaciones que no son la propia", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.store,
      permisos: ["inventory-all"],
    })

    const res = await trasladar(v.authId, {
      origen: e.bodega,
      destino: e.camion1,
      items: [renglon(e.cargador, 2)],
    })

    const quien = await db.query("select usuario_id from traslados where id = $1", [res.traslado_id])

    expect(quien.rows[0].usuario_id).toBe(v.usuario)
    expect(await existencia(e.camion1, e.cargador)).toBe(2)
  })

  /*
    D3: un vendedor con inventory-own devuelve desde su propio camión a la
    bodega, aunque la bodega no la pueda consultar.
  */
  it("16. con inventory-own se traslada desde la ubicación propia", async () => {
    const e = await escenario()

    await trasladar(e.authId, { origen: e.bodega, destino: e.camion1, items: [renglon(e.cargador, 5)] })

    const v = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.camion1,
      permisos: ["inventory-own"],
    })

    await trasladar(v.authId, { origen: e.camion1, destino: e.bodega, items: [renglon(e.cargador, 2)] })

    expect(await existencia(e.camion1, e.cargador)).toBe(3)
    expect(await existencia(e.bodega, e.cargador)).toBe(7)
  })

  it("17. con inventory-own NO se traslada desde una ubicación ajena → 42501", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.camion1,
      permisos: ["inventory-own"],
    })

    await expect(
      trasladar(v.authId, { origen: e.bodega, destino: e.camion1, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "42501" })

    expect(await existencia(e.bodega, e.cargador)).toBe(10)
  })

  it("18. con inventory-own pero sin ubicación operativa → 42501", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, { empresa: e.empresa, permisos: ["inventory-own"] })

    await expect(
      trasladar(v.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("19. sin permisos de inventario → 42501", async () => {
    const e = await escenario()
    const v = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.bodega,
      permisos: ["pos", "products"],
    })

    await expect(
      trasladar(v.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 1)] })
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("20. sin sesión no hay empresa y no se puede trasladar", async () => {
    const e = await escenario()

    await comoUsuario(db, null)

    await expect(
      db.query(SQL_TRASLADO, argumentos({ origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 1)] }))
    ).rejects.toThrow()

    await comoDueno(db)
  })
})

describe("aislamiento entre empresas", () => {
  it("21. una ubicación de otra empresa → 42501", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      trasladar(mia.authId, { origen: mia.bodega, destino: ajena.store, items: [renglon(mia.cargador, 1)] })
    ).rejects.toMatchObject({ code: "42501" })

    expect(await existencia(ajena.store, mia.cargador)).toBeNull()
  })

  it("22. un producto de otra empresa → 42501", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      trasladar(mia.authId, { origen: mia.bodega, destino: mia.store, items: [renglon(ajena.cargador, 1)] })
    ).rejects.toMatchObject({ code: "42501" })
  })
})

// ── ATOMICIDAD E IDEMPOTENCIA ─────────────────────────────

describe("o entra todo o no entra nada", () => {
  /*
    El caso difícil: el origen ya se descontó y la salida ya se anotó, y lo
    que falla es la entrada del destino. Se provoca con una restricción
    puesta solo para la prueba. Si el traslado no fuera atómico, la bodega
    perdería unidades que la tienda nunca recibió.
  */
  it("23. si falla la entrada en destino no queda nada del traslado", async () => {
    const e = await escenario()

    const cabeceras = await contar(db, "traslados")
    const movimientos = await contar(db, "movimientos_inventario")

    // NOT VALID: las entradas de las pruebas anteriores no cuentan, solo las nuevas.
    await db.query(
      `alter table movimientos_inventario
         add constraint prueba_sin_entradas check (tipo <> 'traslado_entrada') not valid`
    )

    try {
      await expect(
        trasladar(e.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 3)] })
      ).rejects.toThrow(/prueba_sin_entradas/)
    } finally {
      await db.query("alter table movimientos_inventario drop constraint prueba_sin_entradas")
    }

    expect(await contar(db, "traslados")).toBe(cabeceras)
    expect(await contar(db, "movimientos_inventario")).toBe(movimientos)
    expect(await existencia(e.bodega, e.cargador)).toBe(10)
    expect(await existencia(e.store, e.cargador)).toBeNull()
  })
})

describe("idempotencia", () => {
  it("24. la misma clave con el mismo contenido devuelve el mismo traslado y no mueve dos veces", async () => {
    const e = await escenario()
    const datos = {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 2), renglon(e.cubo, 1)],
      clave: "tr-1",
    }

    const primera = await trasladar(e.authId, datos)
    const segunda = await trasladar(e.authId, {
      ...datos,
      items: [renglon(e.cubo, 1), renglon(e.cargador, 2)],
    })

    expect(segunda.traslado_id).toBe(primera.traslado_id)
    expect(segunda.repetida).toBe(true)
    expect(await existencia(e.bodega, e.cargador)).toBe(8)
    expect(await existencia(e.store, e.cargador)).toBe(2)
    expect(await contar(db, "traslados", "empresa_id = $1", [e.empresa])).toBe(1)
  })

  it("25. la misma clave con otro contenido → LT006", async () => {
    const e = await escenario()

    await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 2)],
      clave: "tr-2",
    })

    await expect(
      trasladar(e.authId, {
        origen: e.bodega,
        destino: e.camion1,
        items: [renglon(e.cargador, 2)],
        clave: "tr-2",
      })
    ).rejects.toMatchObject({ code: "LT006" })

    expect(await existencia(e.bodega, e.cargador)).toBe(8)
  })

  it("26. dos reintentos simultáneos con la misma clave mueven una sola vez", async () => {
    const e = await escenario()
    const datos = { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 3)], clave: "tr-3" }

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const resultados = await Promise.allSettled([
        trasladarEn(datos)(a),
        trasladarEn(datos)(b),
      ])

      expect(resultados.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1)
    } finally {
      await a.end()
      await b.end()
    }

    expect(await contar(db, "traslados", "empresa_id = $1", [e.empresa])).toBe(1)
    expect(await existencia(e.bodega, e.cargador)).toBe(7)
    expect(await existencia(e.store, e.cargador)).toBe(3)
  })
})

// ── CONCURRENCIA REAL ─────────────────────────────────────

describe("concurrencia", () => {
  it("27. dos traslados de 7 sobre 10 desde el mismo origen: solo uno entra", async () => {
    const e = await escenario()

    const { error } = await enDosSesiones(base, db, {
      primera: {
        authId: e.authId,
        hacer: trasladarEn({ origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 7)] }),
      },
      segunda: {
        authId: e.authId,
        hacer: trasladarEn({ origen: e.bodega, destino: e.camion1, items: [renglon(e.cargador, 7)] }),
      },
    })

    expect(error?.message).toMatch(/hay 3, se trasladan 7/i)
    expect(await existencia(e.bodega, e.cargador)).toBe(3)
    expect(await existencia(e.camion1, e.cargador)).toBeNull()
  })

  it("28. un traslado y una venta sobre la misma existencia se ordenan", async () => {
    const e = await escenario()

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [e.bodega, e.usuario])

    const { error, espera } = await enDosSesiones(base, db, {
      primera: {
        authId: e.authId,
        hacer: trasladarEn({ origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 7)] }),
      },
      segunda: {
        authId: e.authId,
        hacer: (sesion) =>
          sesion.query("select registrar_venta_ubicacion($1::jsonb)", [
            JSON.stringify([renglon(e.cargador, 7)]),
          ]),
      },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error?.message).toMatch(/hay 3, se piden 7/i)
    expect(await existencia(e.bodega, e.cargador)).toBe(3)
  })

  it("29. un ajuste y un traslado sobre la misma existencia se ordenan", async () => {
    const e = await escenario()

    const { error } = await enDosSesiones(base, db, {
      primera: {
        authId: e.authId,
        hacer: (sesion) =>
          sesion.query("select registrar_movimiento_ubicacion($1, $2, 'ajuste', -7)", [
            e.cargador,
            e.bodega,
          ]),
      },
      segunda: {
        authId: e.authId,
        hacer: trasladarEn({ origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 7)] }),
      },
    })

    expect(error?.message).toMatch(/hay 3, se trasladan 7/i)
    expect(await existencia(e.store, e.cargador)).toBeNull()
  })

  /*
    El caso del deadlock: A→B y B→A a la vez, con dos productos y en orden
    distinto. Si cada traslado bloqueara en el orden en que llegan sus
    renglones, A tomaría (cargador, bodega) y B (cubo, store), y cada uno
    esperaría por el otro para siempre. Con un único orden global
    (producto, ubicación) el segundo espera al primero y los dos entran.
  */
  it("30. A→B y B→A simultáneos con dos productos no se bloquean entre sí", async () => {
    const e = await escenario()

    await trasladar(e.authId, {
      origen: e.bodega,
      destino: e.store,
      items: [renglon(e.cargador, 5), renglon(e.cubo, 3)],
    })

    const { error, espera } = await enDosSesiones(base, db, {
      primera: {
        authId: e.authId,
        hacer: trasladarEn({
          origen: e.bodega,
          destino: e.store,
          items: [renglon(e.cargador, 1), renglon(e.cubo, 1)],
        }),
      },
      segunda: {
        authId: e.authId,
        hacer: trasladarEn({
          origen: e.store,
          destino: e.bodega,
          items: [renglon(e.cubo, 2), renglon(e.cargador, 2)],
        }),
      },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error).toBeUndefined()

    // Bodega: 5 − 1 + 2 = 6 cargadores; 3 − 1 + 2 = 4 cubos.
    expect(await existencia(e.bodega, e.cargador)).toBe(6)
    expect(await existencia(e.bodega, e.cubo)).toBe(4)
    expect(await existencia(e.store, e.cargador)).toBe(4)
    expect(await existencia(e.store, e.cubo)).toBe(2)
  })
})

// ── LA INVARIANTE ─────────────────────────────────────────

describe("el libro y las celdas dicen lo mismo", () => {
  it("31. tras varios traslados y un rechazo, libro y celdas coinciden y el stock global no cambia", async () => {
    const e = await escenario()

    const antes = await stockGlobal(e.cargador)

    const pasos = [
      { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 4)] },
      { origen: e.bodega, destino: e.camion1, items: [renglon(e.cargador, 3)] },
      { origen: e.camion1, destino: e.camion2, items: [renglon(e.cargador, 2)] },
      { origen: e.store, destino: e.bodega, items: [renglon(e.cargador, 50)] }, // se rechaza
      { origen: e.camion2, destino: e.bodega, items: [renglon(e.cargador, 1)] },
    ]

    for (const paso of pasos) {
      await trasladar(e.authId, paso).catch(() => {})
    }

    expect(await existencia(e.bodega, e.cargador)).toBe(4)
    expect(await existencia(e.store, e.cargador)).toBe(4)
    expect(await existencia(e.camion1, e.cargador)).toBe(1)
    expect(await existencia(e.camion2, e.cargador)).toBe(1)
    expect(await celdas(e.cargador)).toBe(10)
    expect(await libro(e.cargador)).toBe(10)
    expect(await stockGlobal(e.cargador)).toBe(antes)
  })
})

// ── LAS TABLAS NUEVAS ─────────────────────────────────────

describe("las tablas de traslados", () => {
  it("32. authenticated y anon no pueden escribirlas directamente", async () => {
    const r = await db.query(
      `select tabla, rol, privilegio
         from unnest(array['traslados', 'traslado_detalle']) as tabla,
              unnest(array['authenticated', 'anon']) as rol,
              unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilegio
        where has_table_privilege(rol, 'public.' || tabla, privilegio)`
    )

    expect(r.rows).toEqual([])
  })

  it("33. un insert directo de un usuario autenticado se rechaza", async () => {
    const e = await escenario()

    await expect(
      como(
        e.authId,
        `insert into traslados (empresa_id, origen_id, destino_id)
         values ($1, $2, $3)`,
        [e.empresa, e.bodega, e.store]
      )
    ).rejects.toThrow(/permission denied/i)
  })

  /*
    Se ve un traslado si se ve su origen o su destino, con la misma regla
    que ya decide qué inventario ve cada quien. El detalle sigue a su
    cabecera.
  */
  it("34. cada quien lee los traslados de las ubicaciones que puede ver", async () => {
    const e = await escenario()

    const alCamion1 = await trasladar(e.authId, { origen: e.bodega, destino: e.camion1, items: [renglon(e.cargador, 2)] })
    const alStore = await trasladar(e.authId, { origen: e.bodega, destino: e.store, items: [renglon(e.cargador, 1)] })

    const delCamion1 = await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.camion1,
      permisos: ["inventory-own"],
    })
    const ajena = await escenario()

    const visibles = async (authId) =>
      (await como(authId, "select id from traslados order by creado_en")).rows.map((f) => f.id)

    expect(await visibles(e.authId)).toEqual([alCamion1.traslado_id, alStore.traslado_id])
    expect(await visibles(delCamion1.authId)).toEqual([alCamion1.traslado_id])
    expect(await visibles(ajena.authId)).toEqual([])

    const detalleVisible = await como(
      delCamion1.authId,
      "select traslado_id from traslado_detalle"
    )

    expect(detalleVisible.rows.map((f) => f.traslado_id)).toEqual([alCamion1.traslado_id])
  })

  it("35. los movimientos históricos no cambian y siguen admitiendo ubicación nula", async () => {
    const r = await db.query(
      `select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'movimientos_inventario'
          and column_name = 'ubicacion_id'`
    )

    expect(r.rows[0].is_nullable).toBe("YES")
  })
})
