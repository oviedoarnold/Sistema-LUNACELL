import { describe, it, expect } from "vitest"

import { versionDeLaCompilacion } from "../../../scripts/versionDeLaCompilacion.mjs"
import { revisarSalud } from "../../../api/_salud.js"

/*
  La versión del JavaScript (vite.config.js) y la que reporta /api/health
  tienen que salir igual del mismo commit: si no, la aplicación creería que
  siempre hay una versión nueva, o que nunca la hay.
*/
describe("la versión de la compilación", () => {
  it.each([
    [{ CF_PAGES_COMMIT_SHA: "d6e27e73ab9c2098e6ef5d47cbfb2be6ca401f09" }, "d6e27e7"],
    [{ VERCEL_GIT_COMMIT_SHA: "90bcdbfd3a45edd371efa4df074c2fe99801c863" }, "90bcdbf"],
    [{}, "local"],
  ])("%j → %s, igual que /api/health", async (entorno, esperada) => {
    const { cuerpo } = await revisarSalud({ version: entorno.CF_PAGES_COMMIT_SHA || entorno.VERCEL_GIT_COMMIT_SHA })

    expect(versionDeLaCompilacion(entorno)).toBe(esperada)
    expect(cuerpo.version).toBe(esperada)
  })
})
