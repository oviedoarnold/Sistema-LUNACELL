import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/*
  La aplicación instalada abre directo en el punto de venta. Así, sin red,
  entra al POS con el perfil sin conexión vigente; con red y sin sesión, el
  middleware la manda al login como a cualquier pantalla privada.

  `id` fija la identidad de la aplicación instalada: si faltara, el
  navegador la tomaría de start_url y la trataría como otra aplicación.
*/
const manifiesto = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"))

describe("manifiesto de la aplicación instalada", () => {
  it("abre en el punto de venta", () => {
    expect(manifiesto.start_url).toBe("/pos")
  })

  it("conserva su identidad y su alcance", () => {
    expect(manifiesto.id).toBe("/")
    expect(manifiesto.scope).toBe("/")
  })
})
