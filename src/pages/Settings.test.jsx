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

async function renderSettings({ empresa = EMPRESA, correlativo = 1000 } = {}) {
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
    },
  })

  const { AuthProvider } = await import("../context/AuthContext")
  const ProductProvider = (await import("../context/ProductContext")).default
  const SalesProvider = (await import("../context/SalesContext")).default
  const Settings = (await import("./Settings")).default

  render(
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>
          <Settings />
        </SalesProvider>
      </ProductProvider>
    </AuthProvider>
  )

  await screen.findByText(/datos de la ferretería/i)

  // El formulario se llena cuando la empresa termina de llegar de la base.
  await waitFor(() => {
    expect(campo("name")).toHaveValue(empresa.name)
  })
}

const campo = (nombre) => document.querySelector(`[name="${nombre}"]`)

const escribir = (nombre, valor) =>
  fireEvent.change(campo(nombre), { target: { value: valor } })

describe("Settings: datos de la ferretería", () => {
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
