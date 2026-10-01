import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../test/auth"
import { aFilaDeEmpresa } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

const UBICACIONES = [
  { id: "u-bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "u-c1", name: "Camión 01", type: "camion" },
  { id: "u-retirado", name: "Camión viejo", type: "camion", active: false },
]

const EMPRESA = {
  name: "Ferretería El Yunque",
  address: "San Pedro Sula",
  phone: "2555-0100",
  currency: "L",
  taxRate: 15,
}

const FISCAL_COMPLETO = {
  rtn: "05019012345678",
  cai: "A1B2C3-D4E5F6-A7B8C9-D1E2F3-A4B5C6-D7",
  establecimiento: "000",
  puntoEmision: "001",
  tipoDocumento: "01",
  rangoDesde: 1,
  rangoHasta: 9999,
  fechaLimiteEmision: "2027-12-31",
}

beforeEach(() => {
  vi.resetModules()
})

async function renderSettings({
  empresa = EMPRESA,
  correlativo = 1000,
  ubicaciones = UBICACIONES,
} = {}) {
  montarSupabaseFalso({
    usuarios: [
      usuarioDePrueba({ rol: "admin", nombre: "Administrador" }),
    ],
    permisos: permisosDe("u-1", ["settings"]),
    sesionInicial: sesionDe("auth-1"),
    tablasExtra: {
      empresas: [
        aFilaDeEmpresa(empresa, { correlativoFactura: correlativo }),
      ],
      productos: [],
      movimientos_inventario: [],
      proveedores: [],
      clientes: [],
      ventas: [],
      detalle_venta: [],
      abonos: [],
      /*
        Settings ofrece la ubicación operativa, así que necesita las
        ubicaciones activas de la empresa.
      */
      ubicaciones: ubicaciones.map((u) => ({
        id: u.id,
        empresa_id: "empresa-1",
        nombre: u.name,
        tipo: u.type || "camion",
        activa: u.active !== false,
        creada_en: "2026-01-01",
      })),
    },
  })

  const { AuthProvider } = await import("../context/AuthContext")
  const ProductProvider = (await import("../context/ProductContext")).default
  const SalesProvider = (await import("../context/SalesContext")).default
  const LocationsProvider = (await import("../context/LocationsContext")).default
  const Settings = (await import("./Settings")).default

  render(
    <AuthProvider>
      <ProductProvider>
        <LocationsProvider>
          <SalesProvider>
            <Settings />
          </SalesProvider>
        </LocationsProvider>
      </ProductProvider>
    </AuthProvider>
  )

  await screen.findByText(/datos de la empresa/i)

  // El formulario se llena cuando la empresa termina de llegar de la base.
  await waitFor(() => {
    expect(campo("name")).toHaveValue(empresa.name)
  })
}

const campo = (nombre) => document.querySelector(`[name="${nombre}"]`)

const escribir = (nombre, valor) =>
  fireEvent.change(campo(nombre), { target: { value: valor } })

describe("Settings: datos de la empresa", () => {
  it("carga los datos guardados en el formulario", async () => {
    await renderSettings()

    expect(campo("name")).toHaveValue("Ferretería El Yunque")
    expect(campo("address")).toHaveValue("San Pedro Sula")
    expect(campo("phone")).toHaveValue("2555-0100")
  })

  it("carga la tasa de ISV", async () => {
    await renderSettings()
    expect(campo("taxRate")).toHaveValue(15)
  })

  it("permite editar el nombre", async () => {
    await renderSettings()
    escribir("name", "Ferretería Nueva")

    expect(campo("name")).toHaveValue("Ferretería Nueva")
  })

  it("deshacer cambios devuelve los valores guardados", async () => {
    await renderSettings()
    escribir("name", "Cambio temporal")

    fireEvent.click(screen.getByRole("button", { name: /deshacer/i }))

    expect(campo("name")).toHaveValue("Ferretería El Yunque")
  })
})

describe("Settings: datos fiscales", () => {
  it("avisa cuando no hay CAI configurado", async () => {
    await renderSettings()

    expect(screen.getByText(/sin datos fiscales/i)).toBeInTheDocument()
  })

  it("muestra los campos fiscales vacíos al inicio", async () => {
    await renderSettings()

    expect(campo("cai")).toHaveValue("")
    expect(campo("rtn")).toHaveValue("")
  })

  it("carga los datos fiscales guardados", async () => {
    await renderSettings({ empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO } })

    expect(campo("cai")).toHaveValue(FISCAL_COMPLETO.cai)
    expect(campo("rtn")).toHaveValue(FISCAL_COMPLETO.rtn)
  })

  it("informa cuántas facturas quedan del rango", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 1000,
    })

    expect(screen.getByText(/quedan 8999 facturas/i)).toBeInTheDocument()
  })

  it("avisa cuando el rango está por agotarse", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 9980,
    })

    expect(screen.getByText(/conviene tramitar/i)).toBeInTheDocument()
  })

  it("avisa cuando el rango ya se agotó", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 10500,
    })

    expect(screen.getByText(/se agotó el rango/i)).toBeInTheDocument()
  })

  it("avisa cuando el CAI está vencido", async () => {
    await renderSettings({
      empresa: {
        ...EMPRESA,
        fiscal: { ...FISCAL_COMPLETO, fechaLimiteEmision: "2020-01-01" },
      },
    })

    expect(screen.getByText(/venció el/i)).toBeInTheDocument()
  })

  it("actualiza el aviso al escribir los datos fiscales", async () => {
    await renderSettings()

    escribir("cai", "A1B2C3-D4E5F6")
    escribir("rangoDesde", "1")
    escribir("rangoHasta", "5000")
    escribir("fechaLimiteEmision", "2027-06-30")

    expect(screen.getByText(/rango vigente/i)).toBeInTheDocument()
  })

  it("recuerda confirmar la normativa con un contador", async () => {
    await renderSettings()

    expect(screen.getByText(/contador/i)).toBeInTheDocument()
  })
})

describe("Settings: usuarios", () => {
  it("lista los usuarios registrados", async () => {
    await renderSettings()
    expect(
      (await screen.findAllByText("Administrador")).length
    ).toBeGreaterThan(0)
  })

  it("abre el formulario de usuario nuevo", async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    expect(
      screen.getByRole("heading", { name: /nuevo usuario/i })
    ).toBeInTheDocument()
  })

  it("el formulario ofrece elegir los permisos por sección", async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    const modal = document.querySelector(".modal")

    expect(within(modal).getByText("Facturar")).toBeInTheDocument()
    expect(within(modal).getByText("Inventario")).toBeInTheDocument()
  })
})

/*
  Lo que el administrador configura en INV-2.3: desde dónde trabaja cada
  persona y cuánto inventario alcanza a ver.

  Los permisos no se presentan crudos. Quien reparte accesos no tiene por
  qué saber qué es «inventory-all»; lo que necesita elegir es si esa
  persona ve solo lo suyo o lo de todos.
*/
describe("Settings: inventario y ubicación operativa", () => {
  const abrirFormulario = async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    return document.querySelector(".modal")
  }

  it("ofrece asignar una ubicación operativa", async () => {
    await abrirFormulario()

    expect(
      screen.getByLabelText(/ubicación operativa/i)
    ).toBeInTheDocument()
  })

  /* Una ubicación retirada no es un sitio desde el que nadie trabaje. */
  it("el selector solo ofrece ubicaciones activas", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)

    expect(opciones).toContain("Lunacell Bodega")
    expect(opciones).toContain("Camión 01")
    expect(opciones).not.toContain("Camión viejo")
  })

  it("se puede dejar sin asignar", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)

    expect(within(selector).getByText("Sin asignar")).toBeInTheDocument()
    expect(selector).toHaveValue("")
  })

  it("elegir una ubicación la deja seleccionada", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)
    fireEvent.change(selector, { target: { value: "u-c1" } })

    expect(selector).toHaveValue("u-c1")
  })

  it("ofrece los tres niveles de consulta en palabras, no en permisos", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)

    expect(opciones).toEqual([
      "No puede consultar existencias",
      "Solo el inventario de su ubicación",
      "El inventario de todas las ubicaciones",
    ])

    for (const opcion of opciones) {
      expect(opcion).not.toMatch(/inventory-/)
    }
  })

  /*
    Un vendedor nuevo nace viendo lo de su ubicación, así que el selector
    tiene que abrirse ya en ese nivel y no en «ninguno».
  */
  it("un vendedor nuevo arranca viendo el inventario de su ubicación", async () => {
    await abrirFormulario()

    expect(
      screen.getByLabelText(/inventario que puede consultar/i)
    ).toHaveValue("propia")
  })

  it("se puede subir a ver todas las ubicaciones", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    fireEvent.change(selector, { target: { value: "todas" } })

    expect(selector).toHaveValue("todas")
  })

  it("y se puede quitar del todo", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    fireEvent.change(selector, { target: { value: "ninguno" } })

    expect(selector).toHaveValue("ninguno")
  })

  /*
    Al administrador no se le reparte: los tiene todos por su rol, y un
    selector editable sugeriría que se le pueden quitar.
  */
  it("para un administrador el nivel no se edita", async () => {
    await abrirFormulario()

    fireEvent.change(screen.getByLabelText(/^rol$/i), {
      target: { value: "admin" },
    })

    const selector = screen.getByLabelText(/inventario que puede consultar/i)

    expect(selector).toBeDisabled()
    expect(selector).toHaveValue("todas")
  })
})
