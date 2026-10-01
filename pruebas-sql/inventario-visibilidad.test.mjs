/*
  Quién ve qué inventario, probado contra PostgreSQL de verdad.

  Esto no se puede comprobar con un doble en memoria por una razón de
  fondo: lo que se afirma aquí es que la BASE niega cosas. Un doble niega
  lo que se le programe negar, así que probar RLS contra un doble es
  probar el doble. Y la mitad de estas pruebas son sobre un vendedor que
  NO debe ver algo, que es justo donde un falso verde no se nota.

  El caso que más importa es el par 7/8: una ubicación que puedo ver y no
  tiene el producto vale 0, y una ubicación que no puedo ver no vale 0,
  no aparece. Es la diferencia entre «no hay» y «no te lo puedo decir»,
  y con un left join sobre RLS es muy fácil convertir la segunda en la
  primera sin darse cuenta.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"

const AQUI = path.dirname(fileURLToPath(import.meta.url))

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
  Una empresa con las cuatro ubicaciones reales de LUNACELL —tres activas
  más una desactivada— y dos productos, uno con existencia repartida y
  otro sin ninguna celda, que es el que descubre el caso del cero.
*/
async function escenario() {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  const ubicacion = async (nombre, tipo, activa = true) =>
    (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo, activa)
         values ($1, $2, $3, $4) returning id`,
        [empresa, nombre, tipo, activa]
      )
    ).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const tienda = await ubicacion("Store", "tienda")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const retirado = await ubicacion("Camión viejo", "camion", false)

  const producto = async (nombre) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, $2, $3, 120, 80) returning id`,
        [empresa, `C-${Math.random().toString(36).slice(2, 10)}`, nombre]
      )
    ).rows[0].id

  const cargador = await producto("Cargador")
  const cubo = await producto("Cubo Iphone")

  const celda = async (ubicacionId, productoId, cantidad) =>
    db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, $4)`,
      [empresa, ubicacionId, productoId, cantidad]
    )

  /* El cargador está repartido; el cubo no tiene ninguna celda. */
  await celda(bodega, cargador, 15)
  await celda(camion1, cargador, 3)
  await celda(camion2, cargador, 12)

  return {
    empresa,
    usuario,
    authId,
    bodega,
    tienda,
    camion1,
    camion2,
    retirado,
    cargador,
    cubo,
  }
}

/*
  El escenario más un vendedor del Camión 01 con los permisos que pida el
  caso, que es la forma de casi todas las pruebas de abajo. Pasar
  `ubicacion: null` sirve para el caso del vendedor sin ubicación
  asignada.
*/
async function conVendedor(permisos, ubicacion = "camion1") {
  const e = await escenario()

  const v = await crearVendedor(db, {
    empresa: e.empresa,
    ubicacion: ubicacion === null ? null : e[ubicacion],
    permisos,
  })

  return { e, v }
}

/* Lo que la vista le muestra a quien esté autenticado ahora mismo. */
async function visibles(conexion, productoId = null) {
  const r = await conexion.query(
    productoId
      ? `select ubicacion, cantidad from existencias_por_ubicacion
          where producto_id = $1 order by ubicacion`
      : `select ubicacion, cantidad from existencias_por_ubicacion
          order by ubicacion`,
    productoId ? [productoId] : []
  )

  return r.rows.map((f) => `${f.ubicacion}=${f.cantidad}`)
}

async function ubicacionesVisibles(conexion) {
  const r = await conexion.query(
    "select distinct ubicacion from existencias_por_ubicacion order by ubicacion"
  )

  return r.rows.map((f) => f.ubicacion)
}

// ── EL ADMINISTRADOR ──────────────────────────────────────

describe("el administrador", () => {
  it("1. ve las cuatro ubicaciones activas de su empresa", async () => {
    const e = await escenario()

    await comoUsuario(db, e.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).toEqual(["Bodega", "Camión 01", "Camión 02", "Store"])
  })

  /*
    Su ubicación operativa no limita lo que consulta: son dos ejes
    distintos y confundirlos sería dejar al dueño viendo solo el camión
    desde el que resulta que está trabajando esa mañana.
  */
  it("2. ve todas aunque su ubicación operativa sea un camión", async () => {
    const e = await escenario()

    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [
      e.camion1,
      e.usuario,
    ])

    await comoUsuario(db, e.authId)
    const vistas = await ubicacionesVisibles(db)
    const operativa = (await db.query("select ubicacion_del_usuario() as u"))
      .rows[0].u
    await comoDueno(db)

    expect(vistas).toEqual(["Bodega", "Camión 01", "Camión 02", "Store"])
    expect(operativa).toBe(e.camion1)
  })

  it("3. nunca ve el inventario de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await comoUsuario(db, mia.authId)
    const filas = await db.query(
      "select count(*)::int as n from existencias_por_ubicacion where empresa_id = $1",
      [ajena.empresa]
    )
    const celdas = await db.query(
      "select count(*)::int as n from inventario_ubicacion where empresa_id = $1",
      [ajena.empresa]
    )
    await comoDueno(db)

    expect(filas.rows[0].n).toBe(0)
    expect(celdas.rows[0].n).toBe(0)
  })
})

// ── EL VENDEDOR ───────────────────────────────────────────

describe("el vendedor", () => {
  it("4. con inventory-own ve solo su ubicación operativa", async () => {
    const { e, v } = await conVendedor(["inventory-own"])

    await comoUsuario(db, v.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).toEqual(["Camión 01"])
  })

  /*
    El caso que da nombre a la fase: ver el Camión 02 no es asunto suyo.
    Se comprueba en la vista y en la tabla, porque son dos puertas.
  */
  it("5. con inventory-own no ve la ubicación de otro", async () => {
    const { e, v } = await conVendedor(["inventory-own"])

    await comoUsuario(db, v.authId)
    const enLaVista = await db.query(
      "select count(*)::int as n from existencias_por_ubicacion where ubicacion_id = $1",
      [e.camion2]
    )
    const enLaTabla = await db.query(
      "select count(*)::int as n from inventario_ubicacion where ubicacion_id = $1",
      [e.camion2]
    )
    await comoDueno(db)

    expect(enLaVista.rows[0].n).toBe(0)
    expect(enLaTabla.rows[0].n).toBe(0)
  })

  it("6. con inventory-all ve todas las activas de su empresa", async () => {
    const { e, v } = await conVendedor(["inventory-all"])

    await comoUsuario(db, v.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).toEqual(["Bodega", "Camión 01", "Camión 02", "Store"])
  })

  it("7. sin ninguno de los dos permisos no ve ninguna existencia", async () => {
    const { e, v } = await conVendedor(["pos", "quotes"])

    await comoUsuario(db, v.authId)
    const vistas = await visibles(db)
    const celdas = await db.query(
      "select count(*)::int as n from inventario_ubicacion"
    )
    await comoDueno(db)

    expect(vistas).toEqual([])
    expect(celdas.rows[0].n).toBe(0)
  })

  /*
    Un vendedor con inventory-own y sin ubicación asignada no ve nada, y
    es lo correcto: «mi ubicación» no existe todavía. La alternativa
    —enseñarle todo— convertiría un dato sin rellenar en un permiso.
  */
  it("8. con inventory-own y sin ubicación operativa no ve nada", async () => {
    const { e, v } = await conVendedor(["inventory-own"], null)

    await comoUsuario(db, v.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).toEqual([])
  })
})

// ── CERO CONTRA PROHIBIDO ─────────────────────────────────

describe("el cero y lo prohibido no se parecen", () => {
  /*
    El cubo no tiene NINGUNA celda. Para quien ve las cuatro ubicaciones,
    tiene que aparecer en las cuatro con 0: el modelo guarda el cero como
    ausencia de fila, y la consulta tiene que volver a convertirlo en un
    número.
  */
  it("9. una ubicación visible sin celda aparece con 0", async () => {
    const e = await escenario()

    await comoUsuario(db, e.authId)
    const filas = await visibles(db, e.cubo)
    await comoDueno(db)

    expect(filas).toEqual([
      "Bodega=0",
      "Camión 01=0",
      "Camión 02=0",
      "Store=0",
    ])
  })

  /*
    Y el contrario, que es el que de verdad protege: el vendedor del
    Camión 01 NO debe ver «Camión 02 = 0». Esa fila sería mentira —hay
    12— y además le estaría contestando una pregunta que no puede hacer.

    Es el error que produce apoyarse solo en RLS: la celda oculta vuelve
    null en el left join y el coalesce la convierte en 0. Por eso la
    vista filtra las ubicaciones ANTES de unirlas.
  */
  it("10. una ubicación prohibida no aparece, ni con 0", async () => {
    const { e, v } = await conVendedor(["inventory-own"])

    await comoUsuario(db, v.authId)
    const delCargador = await visibles(db, e.cargador)
    const delCubo = await visibles(db, e.cubo)
    await comoDueno(db)

    /* Su camión sí, con su cantidad real. Los demás, ni con cero. */
    expect(delCargador).toEqual(["Camión 01=3"])
    expect(delCubo).toEqual(["Camión 01=0"])
  })

  it("11. el total visible suma lo visible y no lo que existe", async () => {
    const { e, v } = await conVendedor(["inventory-own"])

    const total = async (authId) => {
      await comoUsuario(db, authId)
      const r = await db.query(
        `select coalesce(sum(cantidad), 0)::int as t
           from existencias_por_ubicacion where producto_id = $1`,
        [e.cargador]
      )
      await comoDueno(db)

      return r.rows[0].t
    }

    /* 15 + 3 + 12 para quien ve todo; solo sus 3 para el del camión. */
    expect(await total(e.authId)).toBe(30)
    expect(await total(v.authId)).toBe(3)
  })

  it("12. una ubicación inactiva no aparece en la vista", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 7)`,
      [e.empresa, e.retirado, e.cargador]
    )

    await comoUsuario(db, e.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).not.toContain("Camión viejo")
  })

  /*
    Pero su existencia no se pierde: usuario_ve_ubicacion no filtra por
    `activa` a propósito, así que la celda sigue siendo consultable. Si
    la filtrara, desactivar una ubicación haría desaparecer de la vista
    siete unidades que nadie movió.
  */
  it("13. la existencia de una inactiva sigue siendo consultable", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 7)`,
      [e.empresa, e.retirado, e.cargador]
    )

    await comoUsuario(db, e.authId)
    const r = await db.query(
      "select cantidad from inventario_ubicacion where ubicacion_id = $1",
      [e.retirado]
    )
    await comoDueno(db)

    expect(r.rows[0].cantidad).toBe(7)
  })
})

// ── LA UBICACIÓN OPERATIVA ────────────────────────────────

describe("la ubicación operativa", () => {
  it("14. no puede ser de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query("update usuarios set ubicacion_id = $1 where id = $2", [
        ajena.bodega,
        mia.usuario,
      ])
    ).rejects.toThrow(/usuarios_ubicacion_de_mi_empresa|foreign key/i)
  })

  it("15. no puede ser una ubicación inactiva", async () => {
    const e = await escenario()

    await expect(
      db.query("update usuarios set ubicacion_id = $1 where id = $2", [
        e.retirado,
        e.usuario,
      ])
    ).rejects.toThrow(/tiene que estar activa/i)
  })

  /*
    El agujero que importa: desactivar el camión desde el que alguien
    opera lo dejaría con «ver mi ubicación» sobre una ubicación que la
    vista no muestra. Deja de ver su inventario y nada explica por qué.
  */
  it("16. no se puede desactivar una ubicación desde la que alguien opera", async () => {
    const e = await escenario()

    await crearVendedor(db, { empresa: e.empresa, ubicacion: e.camion1, permisos: ["inventory-own"] })

    await expect(
      db.query("update ubicaciones set activa = false where id = $1", [
        e.camion1,
      ])
    ).rejects.toThrow(/ubicación operativa de/i)
  })

  it("17. sí se puede desactivar una desde la que nadie opera", async () => {
    const e = await escenario()

    await db.query("update ubicaciones set activa = false where id = $1", [
      e.tienda,
    ])

    const r = await db.query("select activa from ubicaciones where id = $1", [
      e.tienda,
    ])

    expect(r.rows[0].activa).toBe(false)
  })

  /*
    Cambiar un dato que no es la ubicación no debe tropezar con la
    validación de la ubicación. Sin la comprobación de «solo si cambió»,
    corregir el nombre de alguien quedaría bloqueado por una ubicación
    que se desactivó después de asignársela.
  */
  it("18. editar otro campo del usuario no revalida la ubicación", async () => {
    const { e, v } = await conVendedor(["inventory-own"])

    /* Se desactiva por detrás, sin pasar por el disparador. */
    await db.query("alter table ubicaciones disable trigger ubicaciones_operativa_en_uso")
    await db.query("update ubicaciones set activa = false where id = $1", [
      e.camion1,
    ])
    await db.query("alter table ubicaciones enable trigger ubicaciones_operativa_en_uso")

    await expect(
      db.query("update usuarios set nombre = 'Otro nombre' where id = $1", [
        v.usuario,
      ])
    ).resolves.toBeDefined()
  })

  /*
    El código de error, no solo el mensaje.

    La capa de acceso del frontend decide si un rechazo se le enseña al
    usuario mirando el SQLSTATE: P0001 es lo que PostgreSQL devuelve cuando
    un disparador ejecuta RAISE EXCEPTION, es decir, cuando el texto lo
    escribió alguien para que lo lea una persona.

    Sin esta prueba, cambiar el disparador para que levante un SQLSTATE
    propio dejaría al administrador viendo otra vez un aviso genérico, y
    nada en la suite lo notaría: el rechazo seguiría ocurriendo.
  */
  it("19. el rechazo llega con SQLSTATE P0001 y su motivo", async () => {
    const e = await escenario()

    await crearVendedor(db, {
      empresa: e.empresa,
      ubicacion: e.camion1,
      permisos: ["inventory-own"],
    })

    let fallo
    try {
      await db.query("update ubicaciones set activa = false where id = $1", [
        e.camion1,
      ])
    } catch (problema) {
      fallo = problema
    }

    expect(fallo).toBeDefined()
    expect(fallo.code).toBe("P0001")
    expect(fallo.message).toMatch(/ubicación operativa de/i)
  })

  it("20. inventory-all no cambia la ubicación operativa", async () => {
    const { e, v } = await conVendedor(["inventory-all"])

    await comoUsuario(db, v.authId)
    const operativa = (await db.query("select ubicacion_del_usuario() as u"))
      .rows[0].u
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(operativa).toBe(e.camion1)
    expect(vistas).toHaveLength(4)
  })
})

// ── VER NO ES ESCRIBIR ────────────────────────────────────

describe("ver no concede escribir", () => {
  /*
    Los tres se prueban porque son tres puertas distintas. El update es
    el que más engaña: sin el revoke de la 0014 no falla, afecta cero
    filas y devuelve éxito.
  */
  it("21. inventory-all no permite insertar existencias", async () => {
    const { e, v } = await conVendedor(["inventory-all"])

    await comoUsuario(db, v.authId)
    const intento = db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 99)`,
      [e.empresa, e.tienda, e.cargador]
    )
    await expect(intento).rejects.toThrow(/permission denied|denegado/i)
    await comoDueno(db)
  })

  it("22. inventory-all no permite modificar ni borrar existencias", async () => {
    const { e, v } = await conVendedor(["inventory-all"])

    await comoUsuario(db, v.authId)

    await expect(
      db.query("update inventario_ubicacion set cantidad = 999")
    ).rejects.toThrow(/permission denied|denegado/i)

    await expect(
      db.query("delete from inventario_ubicacion")
    ).rejects.toThrow(/permission denied|denegado/i)

    await comoDueno(db)

    /* Y nada cambió. */
    const r = await db.query(
      "select cantidad from inventario_ubicacion where ubicacion_id = $1",
      [e.bodega]
    )

    expect(r.rows[0].cantidad).toBe(15)
  })

  it("23. tampoco se puede escribir en la vista", async () => {
    const e = await escenario()

    await comoUsuario(db, e.authId)
    await expect(
      db.query("update existencias_por_ubicacion set cantidad = 1")
    ).rejects.toThrow()
    await comoDueno(db)
  })
})

// ── LO QUE LA VISTA NO DICE ───────────────────────────────

describe("la vista no revela lo que no le toca", () => {
  /*
    Saber cuántas unidades lleva un camión no es saber cuánto costaron.
    El costo sigue sin protección propia en el resto del esquema —es un
    problema aparte, de otra fase—, pero esta vista no lo empeora.
  */
  it("24. no expone costo, margen ni utilidad", async () => {
    const r = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'existencias_por_ubicacion'`
    )

    const columnas = r.rows.map((f) => f.column_name)

    expect(columnas).not.toContain("costo")
    expect(columnas).not.toContain("margen")
    expect(columnas).not.toContain("utilidad")
    expect(columnas).not.toContain("precio")

    expect(columnas).toEqual(
      expect.arrayContaining(["ubicacion", "producto", "codigo", "cantidad"])
    )
  })

  it("25. un producto inactivo no aparece", async () => {
    const e = await escenario()

    await db.query("update productos set activo = false where id = $1", [
      e.cargador,
    ])

    await comoUsuario(db, e.authId)
    const r = await db.query(
      "select count(*)::int as n from existencias_por_ubicacion where producto_id = $1",
      [e.cargador]
    )
    await comoDueno(db)

    expect(r.rows[0].n).toBe(0)
  })

  it("26. sin autenticar no se ve nada", async () => {
    await escenario()

    await comoUsuario(db, null)
    const r = await db.query(
      "select count(*)::int as n from existencias_por_ubicacion"
    )
    await comoDueno(db)

    expect(r.rows[0].n).toBe(0)
  })
})

// ── CORRERLA DOS VECES ────────────────────────────────────

describe("la migración se puede volver a correr", () => {
  /*
    El README de migraciones lo promete de todas, y aquí no es gratis:
    la restricción de secciones se borra y se vuelve a crear, y la vista
    y los disparadores se reemplazan. Si alguna de esas piezas no fuera
    idempotente, el fallo aparecería al desplegar y no al escribirla.

    Se ejecuta el archivo de verdad, no una copia de su texto: tenerla
    escrita dos veces ya se desincronizó una vez en INV-1.
  */
  it("27. correrla otra vez no rompe nada y deja lo mismo", async () => {
    const e = await escenario()

    const migracion = fs.readFileSync(
      path.join(
        AQUI,
        "..",
        "supabase",
        "migrations",
        "0015_visibilidad_por_ubicacion.sql"
      ),
      "utf8"
    )

    await expect(db.query(migracion)).resolves.toBeDefined()

    await comoUsuario(db, e.authId)
    const vistas = await ubicacionesVisibles(db)
    await comoDueno(db)

    expect(vistas).toEqual(["Bodega", "Camión 01", "Camión 02", "Store"])

    /* Y la restricción sigue aceptando los dos permisos nuevos. */
    const r = await db.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'permisos_usuario'::regclass and contype = 'c'`
    )

    expect(r.rows[0].def).toContain("inventory-own")
    expect(r.rows[0].def).toContain("inventory-all")
  })
})
