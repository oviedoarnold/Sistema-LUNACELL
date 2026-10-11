// @vitest-environment node
import { describe, it, expect } from "vitest"

import { revisarConfiguracion, buscarProduccionEnElBuild, REF_PRODUCCION } from "./entornoDePruebas.mjs"

/*
  El modo de pruebas nunca puede apuntar a Supabase en la nube: ni a
  producción ni a ningún otro proyecto (software-2 incluido). Solo al
  Supabase local, directo o por Tailscale Serve.
*/
const config = (url, clave = "sb_publishable_local") => ({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: clave })

describe("configuración del modo de pruebas", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "https://mi-pc.tail1234.ts.net:8443",
    "https://lunacell-pc.mi-red.ts.net",
  ])("acepta el Supabase local: %s", (url) => {
    expect(revisarConfiguracion(config(url))).toEqual([])
  })

  it("rechaza producción, con su nombre", () => {
    const errores = revisarConfiguracion(config(`https://${REF_PRODUCCION}.supabase.co`))

    expect(errores.join(" ")).toMatch(/PRODUCCIÓN/)
  })

  it.each([
    "https://jfddkmjrpyjtsbuvgxgh.supabase.co",
    "https://otro.supabase.co",
    "https://mi-dominio.com",
    "http://192.168.1.20:54321",
    "https://mi-pc.ts.net.engano.com",
  ])("rechaza cualquier otro destino: %s", (url) => {
    expect(revisarConfiguracion(config(url))).not.toEqual([])
  })

  it("exige la URL y la clave publicable", () => {
    expect(revisarConfiguracion({})).toHaveLength(2)
    expect(revisarConfiguracion(config("http://127.0.0.1:54321", ""))).toHaveLength(1)
  })
})

describe("revisión del build de pruebas", () => {
  it("encuentra cualquier mención a Supabase en la nube", () => {
    expect(buscarProduccionEnElBuild([`const u="https://${REF_PRODUCCION}.supabase.co"`])).toBe(true)
    expect(buscarProduccionEnElBuild(['fetch("https://otro.supabase.co/rest/v1")'])).toBe(true)
  })

  it("un build apuntando al local está limpio, aunque supabase-js traiga el literal *.supabase.co", () => {
    expect(buscarProduccionEnElBuild(['const u="https://mi-pc.tail1234.ts.net:8443"'])).toBe(false)
    expect(buscarProduccionEnElBuild(["return t.push(`*.supabase.co`,`*.supabase.in`),t"])).toBe(false)
  })
})
