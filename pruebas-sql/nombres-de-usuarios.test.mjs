/*
  nombres_de_usuarios() contra PostgreSQL de verdad.

  El historial de traslados necesita el nombre de quien hizo cada uno, y
  la política de usuarios —con razón— no deja a un vendedor leer las filas
  de sus compañeros: traen correo, rol, estado, ubicación e invitación.
  La función entrega solo id y nombre, solo de la propia empresa y solo de
  los ids que se le piden.

  Se prueba lo que entrega y, sobre todo, lo que no: otra empresa, otras
  columnas, anónimos, listas desmedidas y ningún efecto sobre los datos ni
  sobre las políticas de usuarios.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

const FIRMA = "public.nombres_de_usuarios(uuid[])"

/* Llama a la función como ese usuario (null = anónimo) y vuelve a dueño. */
async function nombres(authId, ids) {
  await comoUsuario(db, authId)

  try {
    return (await db.query("select * from public.nombres_de_usuarios($1::uuid[])", [ids])).rows
  } finally {
    await comoDueno(db)
  }
}

const porId = (filas) => Object.fromEntries(filas.map((f) => [f.id, f.nombre]))

/*
  Empresa A: su administrador, un vendedor y una compañera inactiva.
  Empresa B: su administrador y un vendedor.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")
  const vendedorA = await crearVendedor(db, { empresa: a.empresa, permisos: ["inventory-own"] })
  const inactivaA = await crearVendedor(db, { empresa: a.empresa, activo: false })
  const vendedorB = await crearVendedor(db, { empresa: b.empresa })

  const nombre = async (id) =>
    (await db.query("select nombre from usuarios where id = $1", [id])).rows[0].nombre

  return {
    a,
    b,
    vendedorA,
    inactivaA,
    vendedorB,
    nombreAdminA: await nombre(a.usuario),
    nombreVendedorA: await nombre(vendedorA.usuario),
    nombreInactivaA: await nombre(inactivaA.usuario),
  }
}

describe("nombres_de_usuarios: lo que entrega", () => {
  it("1. el administrador obtiene id y nombre de otro usuario de su empresa", async () => {
    const e = await escenario()

    expect(await nombres(e.a.authId, [e.vendedorA.usuario])).toEqual([
      { id: e.vendedorA.usuario, nombre: e.nombreVendedorA },
    ])
  })

  it("2. un vendedor obtiene el nombre de otro usuario de su empresa", async () => {
    const e = await escenario()

    expect(await nombres(e.vendedorA.authId, [e.a.usuario])).toEqual([
      { id: e.a.usuario, nombre: e.nombreAdminA },
    ])
  })

  it("3. no entrega usuarios de otra empresa, ni mezclados con los propios", async () => {
    const e = await escenario()

    expect(await nombres(e.vendedorA.authId, [e.vendedorB.usuario, e.b.usuario])).toEqual([])
    expect(porId(await nombres(e.vendedorA.authId, [e.a.usuario, e.vendedorB.usuario]))).toEqual({
      [e.a.usuario]: e.nombreAdminA,
    })
  })

  it("4. un id que no existe simplemente no aparece", async () => {
    const e = await escenario()

    const filas = await nombres(e.vendedorA.authId, [
      "00000000-0000-0000-0000-000000000000",
      e.a.usuario,
    ])

    expect(porId(filas)).toEqual({ [e.a.usuario]: e.nombreAdminA })
  })

  it("5. una lista vacía devuelve 0 filas, y una nula también", async () => {
    const e = await escenario()

    expect(await nombres(e.vendedorA.authId, [])).toEqual([])
    expect(await nombres(e.vendedorA.authId, null)).toEqual([])
  })

  it("6. ids repetidos no repiten filas", async () => {
    const e = await escenario()

    const filas = await nombres(e.vendedorA.authId, [e.a.usuario, e.a.usuario, e.a.usuario])

    expect(filas).toEqual([{ id: e.a.usuario, nombre: e.nombreAdminA }])
  })

  it("7. más de 100 ids es un error controlado; 100 exactos se aceptan", async () => {
    const e = await escenario()
    const muchos = (n) => Array.from({ length: n }, () => e.a.usuario)

    await expect(nombres(e.vendedorA.authId, muchos(101))).rejects.toMatchObject({
      code: "22023",
    })
    expect(await nombres(e.vendedorA.authId, muchos(100))).toHaveLength(1)
  })

  it("8. una compañera inactiva sigue teniendo nombre: el historial es historia", async () => {
    const e = await escenario()

    expect(await nombres(e.vendedorA.authId, [e.inactivaA.usuario])).toEqual([
      { id: e.inactivaA.usuario, nombre: e.nombreInactivaA },
    ])
  })

  it("9. quien está inactivo no obtiene nombres", async () => {
    const e = await escenario()

    expect(await nombres(e.inactivaA.authId, [e.a.usuario, e.vendedorA.usuario])).toEqual([])
  })

  it("18. cada empresa ve solo lo suyo, en las dos direcciones", async () => {
    const e = await escenario()
    const todos = [e.a.usuario, e.vendedorA.usuario, e.b.usuario, e.vendedorB.usuario]

    expect(Object.keys(porId(await nombres(e.vendedorA.authId, todos))).sort()).toEqual(
      [e.a.usuario, e.vendedorA.usuario].sort()
    )
    expect(Object.keys(porId(await nombres(e.vendedorB.authId, todos))).sort()).toEqual(
      [e.b.usuario, e.vendedorB.usuario].sort()
    )
  })
})

describe("nombres_de_usuarios: quién puede llamarla", () => {
  it("10. anon no puede ejecutarla", async () => {
    const e = await escenario()

    await expect(nombres(null, [e.a.usuario])).rejects.toMatchObject({ code: "42501" })

    const r = await db.query("select has_function_privilege('anon', $1, 'EXECUTE') as puede", [FIRMA])
    expect(r.rows[0].puede).toBe(false)
  })

  it("11. authenticated y service_role sí", async () => {
    const r = await db.query(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
              has_function_privilege('service_role', $1, 'EXECUTE') as servicio`,
      [FIRMA]
    )

    expect(r.rows[0]).toEqual({ autenticado: true, servicio: true })
  })

  it("12. PUBLIC no conserva EXECUTE", async () => {
    const r = await db.query(
      `select coalesce(bool_or(a.grantee = 0), false) as publico
         from pg_proc p, aclexplode(p.proacl) a
        where p.oid = $1::regprocedure and a.privilege_type = 'EXECUTE'`,
      [FIRMA]
    )

    expect(r.rows[0].publico).toBe(false)
  })
})

describe("nombres_de_usuarios: cómo está hecha", () => {
  const definicion = async () =>
    (
      await db.query(
        `select p.prosecdef, p.provolatile, p.proconfig, pg_get_userbyid(p.proowner) as dueno,
                pg_get_function_result(p.oid) as retorno, p.prosrc
           from pg_proc p where p.oid = $1::regprocedure`,
        [FIRMA]
      )
    ).rows[0]

  it("13, 14 y 15. SECURITY DEFINER, STABLE y search_path vacío", async () => {
    const d = await definicion()

    expect(d.prosecdef).toBe(true)
    expect(d.provolatile).toBe("s")
    expect(d.proconfig).toEqual(['search_path=""'])
  })

  it("16. devuelve solo id y nombre", async () => {
    const d = await definicion()
    expect(d.retorno).toBe("TABLE(id uuid, nombre text)")

    const e = await escenario()
    const filas = await nombres(e.vendedorA.authId, [e.a.usuario])
    expect(Object.keys(filas[0]).sort()).toEqual(["id", "nombre"])
  })

  it("17. no escribe: ningún DML en el cuerpo y los usuarios quedan igual", async () => {
    const d = await definicion()
    expect(d.prosrc).not.toMatch(/\b(insert|update|delete|truncate|merge)\b/i)

    const e = await escenario()
    const antes = (await db.query("select md5(string_agg(u::text, '|' order by u.id)) as h from usuarios u")).rows[0].h
    await nombres(e.vendedorA.authId, [e.a.usuario, e.vendedorB.usuario])
    const despues = (await db.query("select md5(string_agg(u::text, '|' order by u.id)) as h from usuarios u")).rows[0].h

    expect(despues).toBe(antes)
  })

  it("19. las políticas de usuarios no cambian y un vendedor sigue viendo solo su fila", async () => {
    const r = await db.query(
      `select policyname, cmd, qual from pg_policies
        where schemaname = 'public' and tablename = 'usuarios' order by policyname`
    )
    expect(r.rows.map((p) => `${p.policyname}:${p.cmd}`)).toEqual([
      "usuarios_admin:ALL",
      "usuarios_select:SELECT",
    ])

    const e = await escenario()
    await comoUsuario(db, e.vendedorA.authId)
    try {
      const visibles = await db.query("select id from usuarios")
      expect(visibles.rows.map((u) => u.id)).toEqual([e.vendedorA.usuario])
    } finally {
      await comoDueno(db)
    }
  })
})
