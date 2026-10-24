import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../test/auth"

import { PERMISSIONS } from "../context/permissions"

/*
  El armazón es quien conecta las dos barras: el cajón lo abre la de
  arriba y lo cierra la de al lado, y ninguna es padre de la otra. Estas
  pruebas cubren ese enlace, que es lo único que MainLayout decide.
*/

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

async function montarLayout() {
  montarSupabaseFalso({
    usuarios: [usuarioDePrueba({ rol: "admin", nombre: "Arnold Oviedo" })],
    permisos: permisosDe("u-1", Object.values(PERMISSIONS)),
    sesionInicial: sesionDe("auth-1"),
  })

  const { AuthProvider } = await import("../context/AuthContext")
  const MainLayout = (await import("./MainLayout")).default

  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <MainLayout>
          <p>Contenido de la página</p>
          <IrA />
        </MainLayout>
      </MemoryRouter>
    </AuthProvider>
  )

  await screen.findByText("Arnold Oviedo")
}

/*
  Un cambio de ruta que no pasa por el menú (un botón de la página, el
  botón Atrás del teléfono).
*/
function IrA() {
  const navigate = useNavigate()

  return (
    <button type="button" onClick={() => navigate("/clients")}>
      Ir a otra página
    </button>
  )
}

const armazon = () => document.querySelector(".app-shell")
const abrir = () =>
  fireEvent.click(screen.getByRole("button", { name: /abrir menú/i }))

describe("MainLayout", () => {
  it("monta la navegación, la barra superior y el contenido", async () => {
    await montarLayout()

    expect(screen.getByLabelText("Navegación principal")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument()
  })

  it("arranca con el cajón cerrado", async () => {
    await montarLayout()

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("el botón de menú lo abre", async () => {
    await montarLayout()

    abrir()

    expect(armazon()).toHaveClass("menu-abierto")
  })

  it("el botón de cerrar de la navegación lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(screen.getByRole("button", { name: /cerrar menú/i }))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("pulsar en la capa que tapa el contenido lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(document.querySelector(".app-overlay"))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("Escape lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.keyDown(document, { key: "Escape" })

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("elegir un módulo lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(screen.getByRole("link", { name: /proveedores/i }))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  /*
    Escape no debe seguir escuchándose con el cajón cerrado: la tecla la
    usan también los diálogos de las páginas.
  */
  it("con el cajón cerrado, Escape no cambia nada", async () => {
    await montarLayout()

    fireEvent.keyDown(document, { key: "Escape" })

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  /*
    Con el cajón abierto, la página de atrás no se desplaza: en el teléfono
    el dedo movía el contenido tapado en vez de la lista del menú.
  */
  it("mientras el cajón está abierto, el fondo no se desplaza", async () => {
    await montarLayout()

    expect(document.body).not.toHaveClass("sin-desplazamiento")
    abrir()
    expect(document.body).toHaveClass("sin-desplazamiento")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.body).not.toHaveClass("sin-desplazamiento")
  })

  it("si la ruta cambia por otro camino, el cajón se cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(screen.getByRole("button", { name: /ir a otra página/i }))

    expect(armazon()).not.toHaveClass("menu-abierto")
    expect(document.body).not.toHaveClass("sin-desplazamiento")
  })

  it("la barra superior ofrece la cuenta y Cerrar sesión", async () => {
    await montarLayout()

    fireEvent.click(screen.getByRole("button", { name: /cuenta de arnold oviedo/i }))

    expect(screen.getAllByRole("button", { name: /^cerrar sesión$/i })).toHaveLength(2)
  })

  /*
    En escritorio el cajón no se abre nunca (la barra lateral está fija) y
    nada de lo de arriba interviene: ni el bloqueo ni la capa.
  */
  it("en escritorio, sin abrir el cajón, no bloquea el desplazamiento", async () => {
    await montarLayout()

    expect(armazon()).not.toHaveClass("menu-abierto")
    expect(document.body).not.toHaveClass("sin-desplazamiento")
    expect(screen.getByLabelText("Navegación principal")).toBeInTheDocument()
  })
})
