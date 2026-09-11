import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../../test/auth"

import { PERMISSIONS } from "../../context/permissions"

/*
  La barra lateral sustituyó a la fila de pestañas de la cabecera. Estas
  pruebas son las que cubrían aquella navegación —permisos, usuario en
  sesión y cierre de sesión— más lo que el armazón nuevo añade: los
  grupos, el módulo activo y el cajón de móvil.

  Lo que se comprueba de los permisos no es el filtro en sí, que vive en
  AuthContext y ya tiene sus pruebas, sino que la barra pregunta por él y
  respeta la respuesta.
*/

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

beforeEach(() => {
  vi.resetModules()
})

async function montarSidebar({
  rol = "vendedor",
  secciones = [],
  ruta = "/dashboard",
  abierto = false,
} = {}) {
  montarSupabaseFalso({
    usuarios: [usuarioDePrueba({ rol, nombre: "María Vendedora" })],
    permisos: permisosDe("u-1", secciones),
    sesionInicial: sesionDe("auth-1"),
  })

  /*
    Se importan después de resetModules: con el registro reiniciado, un
    contexto importado arriba es otro objeto distinto del que consume el
    componente, y el proveedor no lo alcanzaría.
  */
  const { AuthProvider } = await import("../../context/AuthContext")
  const Sidebar = (await import("./Sidebar")).default

  const onCerrar = vi.fn()

  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route
            path={ruta}
            element={<Sidebar abierto={abierto} onCerrar={onCerrar} />}
          />
          <Route path="/login" element={<h1>Pantalla de login</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )

  await screen.findByText("María Vendedora")

  return { onCerrar }
}

const enlaces = () =>
  screen.queryAllByRole("link").map((a) => a.getAttribute("href"))

const TODOS = Object.values(PERMISSIONS)

describe("Sidebar · permisos", () => {
  it("el administrador ve los nueve módulos", async () => {
    await montarSidebar({ rol: "admin", secciones: TODOS })

    expect(enlaces()).toEqual([
      "/dashboard",
      "/pos",
      "/quotes",
      "/products",
      "/locations",
      "/clients",
      "/suppliers",
      "/sales-history",
      "/settings",
    ])
  })

  it("el vendedor solo ve las secciones habilitadas", async () => {
    await montarSidebar({
      secciones: [PERMISSIONS.DASHBOARD, PERMISSIONS.POS],
    })

    expect(enlaces()).toEqual(["/dashboard", "/pos"])
  })

  it("no muestra ninguna sección a un usuario sin permisos", async () => {
    await montarSidebar({ secciones: [] })

    expect(enlaces()).toEqual([])
  })

  /*
    Un encabezado de grupo sin nada debajo hace pensar que algo no cargó.
  */
  it("oculta el encabezado de un grupo cuyos módulos no están permitidos", async () => {
    await montarSidebar({ secciones: [PERMISSIONS.DASHBOARD] })

    expect(screen.getByText("Principal")).toBeInTheDocument()
    expect(screen.queryByText("Comercial")).not.toBeInTheDocument()
    expect(screen.queryByText("Inventario")).not.toBeInTheDocument()
    expect(screen.queryByText("Administración")).not.toBeInTheDocument()
  })

  it("muestra solo los grupos con algún módulo permitido", async () => {
    await montarSidebar({
      secciones: [PERMISSIONS.DASHBOARD, PERMISSIONS.SUPPLIERS],
    })

    expect(screen.getByText("Principal")).toBeInTheDocument()
    expect(screen.getByText("Comercial")).toBeInTheDocument()
    expect(screen.queryByText("Operación")).not.toBeInTheDocument()
  })
})

describe("Sidebar · módulo activo", () => {
  it("marca el módulo de la ruta actual", async () => {
    await montarSidebar({ rol: "admin", secciones: TODOS, ruta: "/products" })

    const activo = screen.getByRole("link", { name: /inventario/i })

    expect(activo).toHaveClass("is-activo")
    expect(activo).toHaveAttribute("aria-current", "page")
  })

  it("no marca los demás módulos", async () => {
    await montarSidebar({ rol: "admin", secciones: TODOS, ruta: "/products" })

    const otro = screen.getByRole("link", { name: /clientes/i })

    expect(otro).not.toHaveClass("is-activo")
    expect(otro).not.toHaveAttribute("aria-current")
  })
})

describe("Sidebar · usuario y sesión", () => {
  it("muestra el nombre del usuario en sesión", async () => {
    await montarSidebar()

    expect(screen.getByText("María Vendedora")).toBeInTheDocument()
  })

  it("muestra el rol", async () => {
    await montarSidebar({ rol: "admin", secciones: TODOS })

    expect(screen.getByText("Administrador")).toBeInTheDocument()
  })

  it("cerrar sesión lleva al login", async () => {
    await montarSidebar()

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }))

    await waitFor(() =>
      expect(screen.getByText("Pantalla de login")).toBeInTheDocument()
    )
  })

  it("cerrar sesión avisa a Supabase", async () => {
    await montarSidebar()

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }))

    await waitFor(() =>
      expect(globalThis.__supabaseFalso.auth.signOut).toHaveBeenCalled()
    )
  })
})

describe("Sidebar · cajón", () => {
  it("cerrado no lleva la clase de abierto", async () => {
    await montarSidebar({ abierto: false })

    expect(screen.getByLabelText("Navegación principal")).not.toHaveClass(
      "is-abierto"
    )
  })

  it("abierto la lleva", async () => {
    await montarSidebar({ abierto: true })

    expect(screen.getByLabelText("Navegación principal")).toHaveClass(
      "is-abierto"
    )
  })

  it("el botón de cerrar avisa al armazón", async () => {
    const { onCerrar } = await montarSidebar({ abierto: true })

    fireEvent.click(screen.getByRole("button", { name: /cerrar menú/i }))

    expect(onCerrar).toHaveBeenCalled()
  })

  /*
    En móvil el cajón tapa el contenido: si no se cerrara al elegir un
    módulo, el usuario llegaría a la página sin poder verla.
  */
  it("elegir un módulo cierra el cajón", async () => {
    const { onCerrar } = await montarSidebar({
      rol: "admin",
      secciones: TODOS,
      abierto: true,
    })

    fireEvent.click(screen.getByRole("link", { name: /clientes/i }))

    expect(onCerrar).toHaveBeenCalled()
  })
})
