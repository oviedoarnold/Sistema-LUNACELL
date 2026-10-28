/*
  SEC-5: la auditoría de rescates y las ventas por conciliar no se
  escriben, cambian ni vacían desde fuera (0034).

  Se levanta la base hasta la 0033, con rescates, conciliaciones y ventas
  de verdad, se comprueba que el defecto existe, y se aplica la 0034
  encima, que es como llega a producción. No puede cambiar ningún dato, y
  la sincronización sin conexión, el rescate y la conciliación tienen que
  seguir funcionando.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { levantarBase, aplicarMigracion, consultarComo } from "./arnes.mjs"
import { crearVendedor } from "./fixtures.mjs"
import { escenarioSinConexion, ventaSinConexion, sincronizar, rescatar, conciliar, fallo } from "./escenario-sin-conexion.mjs"

let base
let db
let esc
let antes

/* Una consulta con el rol de la base de datos indicado; la conexión vuelve a ser del dueño. */
async function comoRol(rol, consulta, valores = []) {
  await db.query("select set_config('request.jwt.claims', '', false)")
  await db.query(`set role ${rol}`)

  try {
    return await db.query(consulta, valores)
  } finally {
    await db.query("reset role")
  }
}

/* Lo mismo, dentro de una transacción que se deshace: para mostrar lo que el rol PODÍA hacer sin dejar rastro. */
async function comoRolSinDejarRastro(rol, consulta, valores = []) {
  await db.query("begin")

  try {
    await db.query(`set local role ${rol}`)
    return await db.query(consulta, valores)
  } finally {
    await db.query("rollback")
  }
}

const insertarFalso = () =>
  [
    `insert into auditoria_rescates (empresa_id, administrador_id, resultado, detalle)
     values ($1, $2, 'en_conciliacion', 'Rescate que nunca ocurrió')`,
    [esc.empresa, esc.admin.usuario],
  ]

/*
  Una venta por conciliar inventada: copia de una existente con otra clave,
  como la crearía quien tuviera INSERT. Lo que hace falta es el privilegio,
  no conocer cada columna.
*/
const insertarPorConciliarFalsa = () => [
  `insert into ventas_por_conciliar
   select * from jsonb_populate_record(null::ventas_por_conciliar,
     (select to_jsonb(v) || jsonb_build_object(
        'id', gen_random_uuid(), 'clave_idempotencia', 'falsa-' || gen_random_uuid(), 'estado', 'pendiente',
        'venta_id', null, 'resuelta_en', null, 'resuelta_por', null, 'resolucion_accion', null, 'resolucion_motivo', null)
        from ventas_por_conciliar v limit 1))`,
  [],
]

/* Resolver una venta pendiente por debajo, sin conciliar_venta(): el disparador de la 0027 lo deja pasar una vez. */
const resolverPorDebajo = () => [
  `update ventas_por_conciliar
      set estado = 'anulada', resuelta_por = $1, resolucion_accion = 'anular', resolucion_motivo = 'Resuelta por debajo'
    where estado = 'pendiente'`,
  [esc.admin.usuario],
]

const privilegios = async (tabla = "auditoria_rescates") =>
  (
    await db.query(
      `select rol,
              has_table_privilege(rol, $1, 'SELECT') as leer,
              has_table_privilege(rol, $1, 'INSERT') as insertar,
              has_table_privilege(rol, $1, 'UPDATE') as cambiar,
              has_table_privilege(rol, $1, 'DELETE') as borrar,
              has_table_privilege(rol, $1, 'TRUNCATE') as vaciar,
              $1 = 'public.auditoria_rescates' and has_sequence_privilege(rol, 'public.auditoria_rescates_id_seq', 'USAGE,SELECT,UPDATE') as secuencia
         from unnest(array['anon', 'authenticated', 'service_role']) as rol order by rol`,
      [`public.${tabla}`]
    )
  ).rows

const auditoria = async () => (await db.query("select * from auditoria_rescates order by id")).rows
const porConciliar = async () => (await db.query("select * from ventas_por_conciliar order by id")).rows

const foto = async () => ({
  auditoria: await auditoria(),
  porConciliar: await porConciliar(),
  ventas: (await db.query("select id, estado, numero_factura, correlativo, total from ventas order by id")).rows,
  abonos: (await db.query("select id, venta_id, monto from abonos order by id")).rows,
  movimientos: (await db.query("select id, tipo, cantidad, ubicacion_id from movimientos_inventario order by id")).rows,
  existencias: (await db.query("select ubicacion_id, producto_id, cantidad from inventario_ubicacion order by 1, 2")).rows,
  permisos: (await db.query("select usuario_id, seccion from permisos_usuario order by usuario_id, seccion")).rows,
  contadores: (
    await db.query("select id, proximo_correlativo_factura, proximo_correlativo_interno, proximo_correlativo_cotizacion from empresas order by id")
  ).rows,
})

/* El bloque de reversión de docs/auditoria-de-rescates-protegida.md, leído del propio documento. */
const bloqueDeReversion = async () => {
  const doc = await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "auditoria-de-rescates-protegida.md"),
    "utf8"
  )

  return doc.match(/```sql\r?\n(begin;[\s\S]*?commit;)\s*```/)[1]
}

const PRIVILEGIOS_DE_LA_0034 = [
  { rol: "anon", leer: false, insertar: false, cambiar: false, borrar: false, vaciar: false, secuencia: false },
  { rol: "authenticated", leer: true, insertar: false, cambiar: false, borrar: false, vaciar: false, secuencia: false },
  { rol: "service_role", leer: true, insertar: false, cambiar: false, borrar: false, vaciar: false, secuencia: false },
]

/* Lo mismo para ventas_por_conciliar, que no tiene secuencia (su id es uuid). */
const PRIVILEGIOS_POR_CONCILIAR = PRIVILEGIOS_DE_LA_0034

beforeAll(async () => {
  base = await levantarBase({ hasta: "0033_anulacion_de_ventas.sql" })
  db = base.admin

  /* Un rescate aplicado, uno pendiente y uno rechazado (cobrado distinto del total). */
  esc = await escenarioSinConexion(db)
  const aplicado = await rescatar(db, esc.admin.authId, ventaSinConexion(esc), "lote-a")
  await conciliar(db, esc.admin.authId, aplicado.conciliacion_id, "aplicar")
  await rescatar(db, esc.admin.authId, ventaSinConexion(esc), "lote-a")
  await rescatar(db, esc.admin.authId, ventaSinConexion(esc, { total_cobrado: 1 }), "lote-b")
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

describe("antes de la 0034: el defecto", () => {
  it("1. service_role puede insertar un rescate falso y vaciar la tabla; nada lo detiene", async () => {
    expect((await privilegios()).find((p) => p.rol === "service_role")).toMatchObject({
      insertar: true,
      cambiar: true,
      borrar: true,
      vaciar: true,
    })

    const [sql, valores] = insertarFalso()
    expect((await comoRolSinDejarRastro("service_role", sql, valores)).rowCount).toBe(1)
    await comoRolSinDejarRastro("service_role", "truncate auditoria_rescates")
    expect((await auditoria()).length).toBe(3)
  })

  it("1b. service_role puede inventar una venta por conciliar, resolver una pendiente sin el administrador y vaciar la tabla", async () => {
    expect((await privilegios("ventas_por_conciliar")).find((p) => p.rol === "service_role")).toMatchObject({
      insertar: true,
      cambiar: true,
      borrar: true,
      vaciar: true,
    })

    expect((await comoRolSinDejarRastro("service_role", ...insertarPorConciliarFalsa())).rowCount).toBe(1)
    expect((await comoRolSinDejarRastro("service_role", ...resolverPorDebajo())).rowCount).toBe(1)
    await comoRolSinDejarRastro("service_role", "truncate ventas_por_conciliar, auditoria_rescates")
    expect((await porConciliar()).map((f) => f.estado).sort()).toEqual(["aplicada", "pendiente"])
  })
})

describe("la 0034 sobre datos existentes", () => {
  beforeAll(async () => {
    antes = await foto()
    await aplicarMigracion(db, "0034_auditoria_de_rescates_protegida.sql")
  })

  it("2. no cambia la auditoría, las conciliaciones, ventas, abonos, inventario, permisos ni contadores", async () => {
    expect(antes.auditoria.length).toBe(3)
    expect(await foto()).toEqual(antes)
  })

  it("3. aplicarla dos veces no rompe nada", async () => {
    await aplicarMigracion(db, "0034_auditoria_de_rescates_protegida.sql")

    expect(await foto()).toEqual(antes)
    expect(await privilegios()).toEqual(PRIVILEGIOS_DE_LA_0034)
    expect(await privilegios("ventas_por_conciliar")).toEqual(PRIVILEGIOS_POR_CONCILIAR)
  })
})

describe("después de la 0034", () => {
  it("4. privilegios: anon nada; authenticated y service_role solo leer; la secuencia, nadie", async () => {
    expect(await privilegios()).toEqual(PRIVILEGIOS_DE_LA_0034)
  })

  it("5. el administrador (authenticated) no inserta, cambia, borra ni vacía directamente", async () => {
    const [sql, valores] = insertarFalso()
    const intentos = [
      [sql, valores],
      ["update auditoria_rescates set detalle = 'cambiado'"],
      ["delete from auditoria_rescates"],
      ["truncate auditoria_rescates"],
      ["select setval('auditoria_rescates_id_seq', 1)"],
    ]

    for (const [consulta, v] of intentos) {
      expect((await fallo(consultarComo(db, esc.admin.authId, consulta, v))).code).toBe("42501")
    }
    expect(await auditoria()).toEqual(antes.auditoria)
  })

  it("6. anon no escribe ni lee", async () => {
    const [sql, valores] = insertarFalso()

    for (const [consulta, v] of [[sql, valores], ["update auditoria_rescates set detalle = 'x'"], ["delete from auditoria_rescates"], ["truncate auditoria_rescates"], ["select * from auditoria_rescates"]]) {
      expect((await fallo(consultarComo(db, null, consulta, v))).code).toBe("42501")
    }
  })

  it("7. service_role no inserta, cambia, borra ni vacía; sí lee", async () => {
    const [sql, valores] = insertarFalso()

    for (const [consulta, v] of [[sql, valores], ["update auditoria_rescates set detalle = 'x'"], ["delete from auditoria_rescates"], ["truncate auditoria_rescates"], ["select setval('auditoria_rescates_id_seq', 1)"]]) {
      expect((await fallo(comoRol("service_role", consulta, v))).code).toBe("42501")
    }
    expect((await comoRol("service_role", "select count(*)::int as n from auditoria_rescates")).rows[0].n).toBe(3)
  })

  it("8. ni el dueño de la base la vacía, la cambia ni la borra", async () => {
    for (const consulta of ["truncate auditoria_rescates", "update auditoria_rescates set detalle = 'x'", "delete from auditoria_rescates"]) {
      const error = await fallo(db.query(consulta))
      expect(error.code).toBe("42501")
      expect(error.message).toMatch(/no se modifica ni se borra/)
    }
    expect(await auditoria()).toEqual(antes.auditoria)
  })

  it("9. el rescate sigue registrando sus intentos, aceptados y rechazados", async () => {
    const aceptado = await rescatar(db, esc.admin.authId, ventaSinConexion(esc), "lote-c")
    const rechazado = await rescatar(db, esc.admin.authId, ventaSinConexion(esc, { total_cobrado: 1 }), "lote-c")
    const nuevas = (await auditoria()).filter((f) => f.lote === "lote-c")

    expect(aceptado.estado).toBe("en_conciliacion")
    expect(rechazado.estado).toBe("rechazado")
    expect(nuevas.map((f) => f.resultado)).toEqual(["en_conciliacion", "rechazado"])
    expect(nuevas[0].conciliacion_id).toBe(aceptado.conciliacion_id)
    expect(nuevas[0].administrador_id).toBe(esc.admin.usuario)
    expect(Number(nuevas[0].id)).toBeGreaterThan(Math.max(...antes.auditoria.map((f) => Number(f.id))))
  })

  it("10. la conciliación de un rescate sigue aplicando la venta", async () => {
    const r = await rescatar(db, esc.admin.authId, ventaSinConexion(esc), "lote-d")
    const aplicada = await conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar")

    expect(aplicada.estado).toBe("aplicada")
    expect((await db.query("select estado from ventas where id = $1", [aplicada.venta_id])).rows[0].estado).toBe("pagada")
  })

  it("11. el administrador sigue leyendo la auditoría de su empresa; el vendedor y otra empresa, no", async () => {
    const leer = async (authId) => (await consultarComo(db, authId, "select count(*)::int as n from auditoria_rescates")).rows[0].n
    const otra = await escenarioSinConexion(db)
    const vendedor = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos", "sales-history"] })

    expect(await leer(esc.admin.authId)).toBe((await auditoria()).length)
    expect(await leer(vendedor.authId)).toBe(0)
    expect(await leer(otra.admin.authId)).toBe(0)
  })

  it("12. lo de la 0032 y la 0033 sigue igual", async () => {
    const r = await db.query(
      `select
         (select relacl::text from pg_class where oid = 'public.anulaciones_venta'::regclass) as anulaciones,
         (select count(*)::int from pg_trigger where tgname in ('anulaciones_venta_inmutable', 'anulaciones_venta_sin_vaciar', 'ventas_anulacion_definitiva')) as disparadores_0033,
         (select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = 'public.empresas'::regclass and p.proname = 'empresas_contadores_solo_por_registro') as disparador_0032`
    )

    expect(r.rows[0]).toEqual({
      anulaciones: "{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}",
      disparadores_0033: 3,
      disparador_0032: 1,
    })
    expect((await fallo(consultarComo(db, esc.admin.authId, "update empresas set proximo_correlativo_interno = 999 where id = $1", [esc.empresa]))).code).toBe("42501")
  })
})

describe("ventas por conciliar después de la 0034", () => {
  it("14. privilegios: anon nada; authenticated y service_role solo leer", async () => {
    expect(await privilegios("ventas_por_conciliar")).toEqual(PRIVILEGIOS_POR_CONCILIAR)
  })

  it("15. ni el administrador, ni anon, ni service_role las inventan, resuelven por debajo, borran ni vacían", async () => {
    const filas = await porConciliar()
    const intentos = [
      insertarPorConciliarFalsa(),
      resolverPorDebajo(),
      ["delete from ventas_por_conciliar", []],
      ["truncate ventas_por_conciliar, auditoria_rescates", []],
    ]

    for (const [consulta, v] of intentos) {
      expect((await fallo(consultarComo(db, esc.admin.authId, consulta, v))).code).toBe("42501")
      expect((await fallo(consultarComo(db, null, consulta, v))).code).toBe("42501")
      expect((await fallo(comoRol("service_role", consulta, v))).code).toBe("42501")
    }
    expect(await porConciliar()).toEqual(filas)
  })

  it("16. ni el dueño de la base las vacía, ni siquiera en cascada", async () => {
    for (const consulta of ["truncate ventas_por_conciliar cascade", "truncate ventas_por_conciliar, auditoria_rescates"]) {
      expect((await fallo(db.query(consulta))).code).toBe("42501")
    }

    /* Lo detiene su propio disparador, no solo el de la auditoría que arrastra la cascada. */
    const error = await fallo(db.query("truncate ventas_por_conciliar cascade"))
    expect(error.message).toMatch(/Las ventas por conciliar no se vacían/)
    expect((await porConciliar()).length).toBeGreaterThan(0)
  })

  it("17. el modo sin conexión sigue igual: una venta normal se registra y una con el reloj desfasado va a conciliación", async () => {
    const otro = await escenarioSinConexion(db)
    const normal = await sincronizar(db, otro.vendedor.authId, ventaSinConexion(otro))
    const desfase = 2 * 3600000
    const desfasada = await sincronizar(
      db,
      otro.vendedor.authId,
      ventaSinConexion(otro, {
        registrada_en: new Date(Date.now() - desfase - 10 * 60000).toISOString(),
        reloj_dispositivo: new Date(Date.now() - desfase).toISOString(),
      })
    )

    expect(normal.estado).toBe("registrada")
    expect(desfasada).toMatchObject({ estado: "en_conciliacion", motivo: "reloj-desfasado" })
    expect((await db.query("select estado from ventas_por_conciliar where id = $1", [desfasada.conciliacion_id])).rows[0].estado).toBe("pendiente")

    /* Y el vendedor sigue viendo la suya desde el teléfono. */
    const ve = await consultarComo(db, otro.vendedor.authId, "select id from ventas_por_conciliar where id = $1", [desfasada.conciliacion_id])
    expect(ve.rows).toHaveLength(1)
  })

  it("18. conciliar_venta sigue anulando una pendiente con su motivo", async () => {
    const r = await rescatar(db, esc.admin.authId, ventaSinConexion(esc), "lote-e")
    const anulada = await conciliar(db, esc.admin.authId, r.conciliacion_id, "anular", "Venta duplicada en el cuaderno")
    const fila = (await db.query("select * from ventas_por_conciliar where id = $1", [r.conciliacion_id])).rows[0]

    expect(anulada.estado).toBe("anulada")
    expect(fila).toMatchObject({ estado: "anulada", resuelta_por: esc.admin.usuario, resolucion_accion: "anular" })
  })
})

describe("reversión", () => {
  it("19. el bloque del documento devuelve los privilegios de antes sin tocar filas, y la 0034 se vuelve a aplicar", async () => {
    const filas = { auditoria: await auditoria(), porConciliar: await porConciliar() }
    const disparadores = () =>
      db.query(
        "select count(*)::int as n from pg_trigger where tgname in ('auditoria_rescates_sin_vaciar', 'ventas_por_conciliar_sin_vaciar')"
      )

    await db.query(await bloqueDeReversion())

    expect((await privilegios()).find((p) => p.rol === "service_role")).toMatchObject({ insertar: true, vaciar: true, secuencia: true })
    expect((await privilegios("ventas_por_conciliar")).find((p) => p.rol === "service_role")).toMatchObject({ insertar: true, cambiar: true, vaciar: true })
    expect((await disparadores()).rows[0].n).toBe(0)
    expect((await db.query("select to_regprocedure('public.ventas_por_conciliar_sin_vaciar()') as f")).rows[0].f).toBeNull()
    expect({ auditoria: await auditoria(), porConciliar: await porConciliar() }).toEqual(filas)

    await aplicarMigracion(db, "0034_auditoria_de_rescates_protegida.sql")
    expect(await privilegios()).toEqual(PRIVILEGIOS_DE_LA_0034)
    expect(await privilegios("ventas_por_conciliar")).toEqual(PRIVILEGIOS_POR_CONCILIAR)
    expect((await disparadores()).rows[0].n).toBe(2)
    expect({ auditoria: await auditoria(), porConciliar: await porConciliar() }).toEqual(filas)
  })
})
