// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { precargarArchivosDelBuild } from "../vite.config.js"

/*
  La lista de precarga del service worker se escribe en la carpeta de salida
  de ESA compilación: dist/ en producción, dist-pruebas/ en el entorno de
  pruebas. Antes se escribía siempre en dist/, y el build de pruebas salía
  con la lista vacía: una instalación nueva no abría sin red.
*/
let raiz

beforeEach(() => {
  raiz = mkdtempSync(path.join(tmpdir(), "lunacell-build-"))
})

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true })
})

function compilarEn(carpeta) {
  const salida = path.join(raiz, carpeta)
  mkdirSync(salida, { recursive: true })
  writeFileSync(path.join(salida, "sw.js"), "const ARCHIVOS_DEL_BUILD = []\n")

  const plugin = precargarArchivosDelBuild()
  plugin.configResolved({ root: raiz, build: { outDir: carpeta, ssr: false } })
  plugin.writeBundle({ dir: salida }, { "assets/index-abc.js": {}, "assets/index-abc.css": {}, "index.html": {} })

  return readFileSync(path.join(salida, "sw.js"), "utf8")
}

describe("lista de precarga del service worker", () => {
  it("se escribe en dist-pruebas cuando se compila el entorno de pruebas", () => {
    const sw = compilarEn("dist-pruebas")

    expect(sw).toContain('"/assets/index-abc.js"')
    expect(sw).toContain('"/assets/index-abc.css"')
    expect(sw).not.toContain('"/index.html"')
  })

  it("se sigue escribiendo en dist en producción", () => {
    expect(compilarEn("dist")).toContain('"/assets/index-abc.js"')
  })

  it("no toca la compilación de servidor del prerender", () => {
    const plugin = precargarArchivosDelBuild()
    plugin.configResolved({ root: raiz, build: { outDir: "dist-prerender", ssr: "src/prerender/login.jsx" } })

    expect(() => plugin.writeBundle({ dir: path.join(raiz, "dist-prerender") }, {})).not.toThrow()
  })
})
