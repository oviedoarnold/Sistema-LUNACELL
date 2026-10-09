/*
  SEC-3a Storage contra PostgreSQL de verdad: las imágenes del catálogo se
  suben, reemplazan y borran solo con el permiso `products`.

  Hasta 0023 las políticas del bucket `productos` solo miraban la carpeta
  de la empresa: cualquier empleado activo —un vendedor con solo `pos`—
  podía subir, reemplazar o borrar las fotos del catálogo. Y como la
  lectura era pública y sin condición, cualquiera, sin iniciar sesión,
  podía LISTAR todos los archivos del bucket.

  Aquí no hay servicio de Storage; se corre el mismo SQL que él corre (ver
  supabase/storage, src/storage/database/pg.ts) y con la misma sesión que
  él arma (src/internal/database/postgres/scope.ts): rol, JWT y operación
  fijados con set_config dentro de una transacción. Así la política se
  evalúa exactamente como en producción.

  Lo que hace el servicio con cada llamada del frontend:
  - upload con upsert: prueba el permiso con INSERT … ON CONFLICT DO
    UPDATE … RETURNING * como el usuario, y escribe después como
    superusuario. Si la prueba falla, responde 403.
  - remove: DELETE … RETURNING * como el usuario. Lo que la RLS no deja
    ver no se borra y no da error: vuelve vacío.
  - list: lee storage.objects como el usuario.
  - URL pública: lee como superusuario, sin RLS. Por eso cerrar el listado
    no la rompe.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFile } from "node:fs/promises"

import { levantarBase } from "./arnes.mjs"
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

const RECHAZO = { code: "42501" }

/*
  Una petición al servicio de Storage: su transacción, con la sesión que él
  arma. authId null = anónimo.
*/
async function enStorage(authId, operacion, hacer) {
  await db.query("begin")

  try {
    await db.query(
      `select set_config('role', $1, true),
              set_config('request.jwt.claim.role', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('request.jwt.claims', $3, true),
              set_config('storage.operation', $4, true),
              set_config('storage.allow_delete_query', 'true', true)`,
      [
        authId ? "authenticated" : "anon",
        authId || "",
        authId ? JSON.stringify({ sub: authId, role: "authenticated" }) : "",
        operacion,
      ]
    )

    const resultado = await hacer()

    await db.query("commit")

    return resultado
  } catch (problema) {
    await db.query("rollback")
    throw problema
  }
}

// El SQL del servicio, tal cual lo arma pg.ts.
const subir = (authId, nombre) =>
  enStorage(authId, "storage.object.upload", () =>
    db.query(
      `insert into storage.objects (name, owner, owner_id, bucket_id, metadata, version)
       values ($1, $2, $3, 'productos', '{}'::jsonb, '1')
       on conflict (bucket_id, name collate "C") where archived_at is null
       do update set metadata = excluded.metadata, version = excluded.version,
                     owner = excluded.owner, owner_id = excluded.owner_id
       returning *`,
      [nombre, authId, authId]
    )
  )

const borrar = (authId, nombres) =>
  enStorage(authId, "storage.object.delete_many", () =>
    db.query(
      `delete from storage.objects
        where bucket_id = 'productos' and name collate "C" = any($1) and archived_at is null
        returning *`,
      [nombres]
    )
  )

const mover = (authId, desde, hacia) =>
  enStorage(authId, "storage.object.move", () =>
    db.query(
      `update storage.objects set name = $2
        where bucket_id = 'productos' and name collate "C" = $1 and archived_at is null
        returning *`,
      [desde, hacia]
    )
  )

const listar = async (authId) =>
  (
    await enStorage(authId, "storage.object.list", () =>
      db.query("select name from storage.objects where bucket_id = 'productos' order by name")
    )
  ).rows.map((f) => f.name)

// La URL pública: el servicio lee como superusuario.
const leerPublica = async (nombre) =>
  (
    await db.query(
      `select o.name from storage.objects o join storage.buckets b on b.id = o.bucket_id
        where b.id = 'productos' and b.public and o.name = $1`,
      [nombre]
    )
  ).rows.length === 1

const existe = (nombre) => contar(db, "storage.objects", "bucket_id = 'productos' and name = $1", [nombre])

let serie = 0
const nombreEn = (empresa) => `${empresa}/producto-${++serie}.webp`

/* Deja una imagen ya guardada, como la habría dejado el servicio. */
async function imagenGuardada(empresa) {
  const nombre = nombreEn(empresa)

  await db.query(
    "insert into storage.objects (bucket_id, name, owner_id, version) values ('productos', $1, 'semilla', '1')",
    [nombre]
  )

  return nombre
}

/*
  Empresa A: su administrador, un vendedor con solo `pos`, uno con
  `products` y uno inactivo con `products`. Empresa B: su administrador.
  Cada empresa con una imagen ya guardada.
*/
async function escenario() {
  const a = await crearEmpresa(db, "Empresa A")
  const b = await crearEmpresa(db, "Empresa B")

  const vendedor = await crearVendedor(db, { empresa: a.empresa, permisos: ["pos"] })
  const catalogo = await crearVendedor(db, { empresa: a.empresa, permisos: ["products"] })
  const inactivo = await crearVendedor(db, { empresa: a.empresa, permisos: ["products"], activo: false })

  return {
    a,
    b,
    vendedor,
    catalogo,
    inactivo,
    fotoA: await imagenGuardada(a.empresa),
    fotoB: await imagenGuardada(b.empresa),
  }
}

// ── SIN `products` NO SE ESCRIBE ──────────────────────────

describe("SEC-3a storage: sin el permiso `products` no se tocan las imágenes", () => {
  it("I1. un vendedor con solo `pos` no sube imágenes", async () => {
    const e = await escenario()
    const nombre = nombreEn(e.a.empresa)

    await expect(subir(e.vendedor.authId, nombre)).rejects.toMatchObject(RECHAZO)
    expect(await existe(nombre)).toBe(0)
  })

  it("I2. no reemplaza una imagen existente subiéndola encima", async () => {
    const e = await escenario()

    await expect(subir(e.vendedor.authId, e.fotoA)).rejects.toMatchObject(RECHAZO)
  })

  it("I3. no la mueve ni la renombra", async () => {
    const e = await escenario()

    const r = await mover(e.vendedor.authId, e.fotoA, `${e.a.empresa}/otro.webp`)

    expect(r.rowCount).toBe(0)
    expect(await existe(e.fotoA)).toBe(1)
  })

  it("I4. no la borra", async () => {
    const e = await escenario()

    const r = await borrar(e.vendedor.authId, [e.fotoA])

    expect(r.rowCount).toBe(0)
    expect(await existe(e.fotoA)).toBe(1)
  })

  it("I5. un usuario inactivo, aunque tenga `products`, no sube", async () => {
    const e = await escenario()

    await expect(subir(e.inactivo.authId, nombreEn(e.a.empresa))).rejects.toMatchObject(RECHAZO)
  })

  it("I6. anon no sube ni borra", async () => {
    const e = await escenario()

    await expect(subir(null, nombreEn(e.a.empresa))).rejects.toMatchObject(RECHAZO)
    expect((await borrar(null, [e.fotoA])).rowCount).toBe(0)
    expect(await existe(e.fotoA)).toBe(1)
  })
})

// ── CON `products`, DENTRO DE LA EMPRESA ──────────────────

describe("SEC-3a storage: con el permiso se administra el catálogo propio", () => {
  it("I7. quien tiene `products` sube una imagen a la carpeta de su empresa", async () => {
    const e = await escenario()
    const nombre = nombreEn(e.a.empresa)

    const r = await subir(e.catalogo.authId, nombre)

    expect(r.rowCount).toBe(1)
    expect(await existe(nombre)).toBe(1)
  })

  it("I8. la reemplaza subiéndola encima (upsert)", async () => {
    const e = await escenario()

    const r = await subir(e.catalogo.authId, e.fotoA)

    expect(r.rowCount).toBe(1)
    expect(await existe(e.fotoA)).toBe(1)
  })

  it("I9. la mueve dentro de su carpeta", async () => {
    const e = await escenario()
    const destino = `${e.a.empresa}/renombrada-${++serie}.webp`

    expect((await mover(e.catalogo.authId, e.fotoA, destino)).rowCount).toBe(1)
    expect(await existe(destino)).toBe(1)
  })

  it("I10. la borra", async () => {
    const e = await escenario()

    expect((await borrar(e.catalogo.authId, [e.fotoA])).rowCount).toBe(1)
    expect(await existe(e.fotoA)).toBe(0)
  })

  it("I11. el administrador sube, reemplaza y borra sin permisos repartidos", async () => {
    const e = await escenario()
    const nombre = nombreEn(e.a.empresa)

    expect((await subir(e.a.authId, nombre)).rowCount).toBe(1)
    expect((await subir(e.a.authId, nombre)).rowCount).toBe(1)
    expect((await borrar(e.a.authId, [nombre])).rowCount).toBe(1)
  })
})

// ── NADA CRUZA DE EMPRESA ─────────────────────────────────

describe("SEC-3a storage: nadie toca las imágenes de otra empresa", () => {
  it("I12. no sube a la carpeta de otra empresa, ni con `products` ni siendo administrador", async () => {
    const e = await escenario()

    await expect(subir(e.catalogo.authId, nombreEn(e.b.empresa))).rejects.toMatchObject(RECHAZO)
    await expect(subir(e.a.authId, nombreEn(e.b.empresa))).rejects.toMatchObject(RECHAZO)
  })

  it("I13. no reemplaza, mueve ni borra una imagen ajena", async () => {
    const e = await escenario()

    await expect(subir(e.catalogo.authId, e.fotoB)).rejects.toMatchObject(RECHAZO)
    expect((await mover(e.a.authId, e.fotoB, `${e.a.empresa}/robada.webp`)).rowCount).toBe(0)
    expect((await borrar(e.a.authId, [e.fotoB])).rowCount).toBe(0)
    expect(await existe(e.fotoB)).toBe(1)
  })

  it("I14. no saca una imagen propia hacia la carpeta de otra empresa", async () => {
    const e = await escenario()

    await expect(mover(e.catalogo.authId, e.fotoA, `${e.b.empresa}/regalada.webp`)).rejects.toMatchObject(RECHAZO)
    expect(await existe(e.fotoA)).toBe(1)
  })
})

// ── LISTADO Y URL PÚBLICA ─────────────────────────────────

describe("SEC-3a storage: el listado se cierra y la URL pública sigue sirviendo", () => {
  it("I15. anon no lista los archivos del bucket", async () => {
    await escenario()

    expect(await listar(null)).toEqual([])
  })

  it("I16. un vendedor sin `products` no lista", async () => {
    const e = await escenario()

    expect(await listar(e.vendedor.authId)).toEqual([])
  })

  it("I17. quien tiene `products` lista solo las de su empresa", async () => {
    const e = await escenario()

    const nombres = await listar(e.catalogo.authId)

    expect(nombres).toContain(e.fotoA)
    expect(nombres.every((n) => n.startsWith(`${e.a.empresa}/`))).toBe(true)
  })

  it("I18. la imagen se sigue sirviendo por su URL pública, sin iniciar sesión", async () => {
    const e = await escenario()

    expect(await leerPublica(e.fotoA)).toBe(true)
    expect(await leerPublica(e.fotoB)).toBe(true)
  })
})

// ── LA MIGRACIÓN ──────────────────────────────────────────

describe("SEC-3a storage: la migración 0024", () => {
  it("I19. deja exactamente estas políticas en storage.objects", async () => {
    const { rows } = await db.query(
      `select policyname, cmd, roles::text as roles from pg_policies
        where schemaname = 'storage' and tablename = 'objects' order by policyname`
    )

    expect(rows).toEqual([
      { policyname: "imagenes_de_producto_borrado", cmd: "DELETE", roles: "{authenticated}" },
      { policyname: "imagenes_de_producto_consulta", cmd: "SELECT", roles: "{authenticated}" },
      { policyname: "imagenes_de_producto_escritura", cmd: "INSERT", roles: "{authenticated}" },
      { policyname: "imagenes_de_producto_reemplazo", cmd: "UPDATE", roles: "{authenticated}" },
    ])
  })

  it("I20. aplicarla no toca ningún archivo ni el bucket", async () => {
    await escenario()
    const foto = async () =>
      (
        await db.query(
          `select (select md5(string_agg(id::text || name || coalesce(owner_id, '') || coalesce(version, ''), ',' order by id)) from storage.objects) as objetos,
                  (select row_to_json(b)::text from storage.buckets b where id = 'productos') as bucket`
        )
      ).rows[0]

    const antes = await foto()
    const sql = await readFile(
      new URL("../supabase/migrations/0024_imagenes_de_producto_por_permiso.sql", import.meta.url),
      "utf8"
    )

    await db.query(sql)

    expect(await foto()).toEqual(antes)
  })
})
