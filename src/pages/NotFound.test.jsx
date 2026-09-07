import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  sesionDe,
} from "../test/auth"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

beforeEach(() => {
  vi.resetModules()
})

async function renderNotFound({ conSesion = false } = {}) {
  montarSupabaseFalso(
    conSesion
      ? { usuarios: [usuarioDePrueba()], sesionInicial: sesionDe("auth-1") }
      : {}
  )

  const { AuthProvider } = await import("../context/AuthContext")
  const NotFound = (await import("./NotFound")).default

  render(
    <AuthProvider>
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    </AuthProvider>
  )
}

describe("NotFound", () => {
  it("muestra el código 404", async () => {
    await renderNotFound()
    expect(screen.getByText("404")).toBeInTheDocument()
  })

  it("explica qué pasó sin tecnicismos", async () => {
    await renderNotFound()
    expect(screen.getByText(/esta página no existe/i)).toBeInTheDocument()
  })

  it("sin sesión ofrece volver al inicio", async () => {
    await renderNotFound()

    expect(
      await screen.findByRole("link", { name: /ir al inicio/i })
    ).toHaveAttribute("href", "/")
  })

  it("con sesión ofrece volver al panel", async () => {
    await renderNotFound({ conSesion: true })

    await waitFor(async () =>
      expect(
        screen.getByRole("link", { name: /volver al panel/i })
      ).toHaveAttribute("href", "/dashboard")
    )
  })
})
