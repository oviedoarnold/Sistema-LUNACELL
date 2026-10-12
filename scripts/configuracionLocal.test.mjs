// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, it, expect } from "vitest"

/*
  El Supabase local aplica las migraciones desde [db.seed] (la aplicación
  automática está apagada porque metería las de demostración). Si alguien
  agrega una migración y olvida listarla, el entorno local quedaría con un
  esquema distinto al de producción sin que nadie lo note: esta prueba lo
  impide.
*/
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEMOSTRACION = ["0002_datos_demo.sql", "0006_demo_admin_y_fiscal.sql", "0010_permisos_de_la_cuenta_demo.sql"]

const config = readFileSync(path.join(RAIZ, "supabase", "config.toml"), "utf8")
const listadas = [...(config.match(/sql_paths = \[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1])
const migraciones = readdirSync(path.join(RAIZ, "supabase", "migrations"))
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()

describe("Supabase local", () => {
  it("aplica todas las migraciones de LUNACELL, en orden, sin las de demostración, y después la semilla", () => {
    const esperadas = migraciones.filter((f) => !DEMOSTRACION.includes(f)).map((f) => `migrations/${f}`)

    expect(listadas).toEqual([...esperadas, "seed.sql"])
  })

  it("no aplica las migraciones automáticamente (incluirían las de demostración)", () => {
    // La sección va desde su cabecera hasta la siguiente cabecera de línea propia.
    const seccion = config.replace(/\r\n/g, "\n").split(/^\[db\.migrations\]$/m)[1]?.split(/^\[/m)[0] ?? ""

    expect(seccion).toMatch(/^enabled = false$/m)
  })

  it("usa puertos fuera del rango dinámico de Windows (49152–65535)", () => {
    const puertos = [...config.matchAll(/^(?:port|shadow_port) = (\d+)$/gm)].map((m) => Number(m[1]))

    expect(puertos.length).toBeGreaterThan(0)
    expect(puertos.every((p) => p < 49152)).toBe(true)
  })
})
