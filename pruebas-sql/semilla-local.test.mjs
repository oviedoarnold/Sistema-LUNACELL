/*
  La semilla del entorno local de pruebas (supabase/seed.sql), probada en
  CI contra PostgreSQL real después de todas las migraciones.

  Supabase local trae el esquema `auth` completo y pgcrypto en
  `extensions`. El arnés solo simula lo mínimo de `auth`, así que aquí se
  agregan las columnas y la tabla de identidades que la semilla escribe, y
  pgcrypto: lo justo para que la semilla corra igual que en Supabase local.

  Lo que se comprueba es que el entorno sirve para el piloto y que la
  semilla nunca se pueda correr sobre producción.
*/

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase } from "./arnes.mjs"
import { ventaSinConexion, sincronizar, fallo } from "./escenario-sin-conexion.mjs"

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SEMILLA = path.join(AQUI, "..", "supabase", "seed.sql")

const EMPRESA = "e0000000-0000-4000-8000-000000000001"
const CAMION_01 = "10000000-0000-4000-8000-000000000001"
const VENDEDOR_CAMION_01 = "a0000000-0000-4000-8000-000000000002"
const CARGADOR = { id: "20000000-0000-4000-8000-000000000001", codigo: "PR-001", nombre: "Cargador USB-C (prueba)" }

let base
let db
let semilla

// Lo que Supabase local trae y el arnés no: columnas de auth.users, auth.identities y pgcrypto.
const COMO_SUPABASE_LOCAL = `
  alter table auth.users
    add column if not exists instance_id uuid,
    add column if not exists aud text,
    add column if not exists role text,
    add column if not exists encrypted_password text,
    add column if not exists email_confirmed_at timestamptz,
    add column if not exists raw_app_meta_data jsonb,
    add column if not exists raw_user_meta_data jsonb,
    add column if not exists created_at timestamptz,
    add column if not exists updated_at timestamptz,
    add column if not exists confirmation_token text,
    add column if not exists recovery_token text,
    add column if not exists email_change_token_new text,
    add column if not exists email_change text;

  create table if not exists auth.identities (
    id uuid primary key,
    user_id uuid not null,
    provider_id text not null,
    identity_data jsonb not null,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
  );

  create schema if not exists extensions;
  create extension if not exists pgcrypto schema extensions;
`

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
  semilla = await readFile(SEMILLA, "utf8")

  await db.query(COMO_SUPABASE_LOCAL)
  await db.query(semilla)
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

describe("lo que siembra", () => {
  it("1. una empresa ficticia sin CAI", async () => {
    const { rows } = await db.query("select nombre, cai, tasa_isv from empresas where id = $1", [EMPRESA])

    expect(rows[0]).toMatchObject({ nombre: "LUNACELL PRUEBAS (ficticia)", cai: "" })
    expect(Number(rows[0].tasa_isv)).toBe(15)
  })

  it("2. cuatro ubicaciones de prueba y solo «Camión 01 Pruebas» vende sin conexión; la tienda no", async () => {
    const { rows } = await db.query(
      "select nombre, tipo, vende_sin_conexion, emite_fiscal from ubicaciones where empresa_id = $1 order by nombre",
      [EMPRESA]
    )

    expect(rows).toEqual([
      { nombre: "Bodega Pruebas", tipo: "bodega", vende_sin_conexion: false, emite_fiscal: false },
      { nombre: "Camión 01 Pruebas", tipo: "camion", vende_sin_conexion: true, emite_fiscal: false },
      { nombre: "Camión 02 Pruebas", tipo: "camion", vende_sin_conexion: false, emite_fiscal: false },
      { nombre: "Tienda Pruebas", tipo: "tienda", vende_sin_conexion: false, emite_fiscal: false },
    ])
  })

  it("3. los usuarios de prueba entran por nombre de usuario con la contraseña conocida", async () => {
    const { rows } = await db.query(
      `select u.nombre_usuario, u.rol, u.debe_cambiar_contrasena,
              a.encrypted_password = extensions.crypt('Pruebas-Local-2026', a.encrypted_password) as contrasena_ok,
              exists (select 1 from auth.identities i where i.user_id = a.id and i.provider = 'email') as identidad
         from usuarios u join auth.users a on a.id = u.auth_id
        where u.empresa_id = $1
        order by u.nombre_usuario`,
      [EMPRESA]
    )

    expect(rows.map((r) => r.nombre_usuario)).toEqual(["admin.pruebas", "camion01.pruebas", "camion01b.pruebas", "camion02.pruebas"])
    expect(rows.every((r) => r.contrasena_ok && r.identidad && !r.debe_cambiar_contrasena)).toBe(true)

    const acceso = await db.query("select * from public.acceso_reservar_intento($1)", ["camion01.pruebas"])
    expect(acceso.rows[0]).toMatchObject({ email: "camion01.pruebas@lunacell.local", permitido: true })
  })

  it("4. el vendedor de Camión 01 sincroniza una venta sin conexión de punta a punta", async () => {
    const esc = { vendedor: { authId: VENDEDOR_CAMION_01 }, camion1: CAMION_01, cargador: CARGADOR, tasa: 15 }
    const venta = ventaSinConexion(esc, {
      renglones: [{ producto_id: CARGADOR.id, codigo: CARGADOR.codigo, nombre: CARGADOR.nombre, cantidad: 1, precio_unitario: 150 }],
    })

    const r = await sincronizar(db, VENDEDOR_CAMION_01, venta)
    const existencia = await db.query(
      "select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2",
      [CAMION_01, CARGADOR.id]
    )

    expect(r.estado).toBe("registrada")
    expect(Number(existencia.rows[0].cantidad)).toBe(9)
  })
})

describe("la semilla nunca corre sobre producción", () => {
  it("5. se niega en una base que ya tiene usuarios de Auth", async () => {
    const error = await fallo(db.query(semilla))

    expect(error.message).toMatch(/ya tiene usuarios de Auth/)
  })

  it("6. se niega en una base con las ubicaciones de producción", async () => {
    await db.query("begin")

    try {
      await db.query("delete from auth.identities")
      await db.query("update usuarios set auth_id = null")
      await db.query("delete from auth.users")
      await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Lunacell Store', 'tienda')", [EMPRESA])

      const error = await fallo(db.query(semilla))

      expect(error.message).toMatch(/ubicaciones de producción/)
    } finally {
      await db.query("rollback")
    }
  })
})
