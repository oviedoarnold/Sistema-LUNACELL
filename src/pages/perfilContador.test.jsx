import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import QuotesProvider from "../context/QuotesContext"
import SalesProvider from "../context/SalesContext"
import LocationsProvider from "../context/LocationsContext"
import { useAuth } from "../hooks/useAuth"
import { PERMISSIONS, permisosDelRol } from "../context/permissions"
import { EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import Clients from "./Clients"
import Suppliers from "./Suppliers"
import Quotes from "./Quotes"
import Receivables from "./Receivables"
import Transfers from "./Transfers"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El contador consulta (0036). La base le rechaza cualquier escritura; las
  pantallas, además, no le ofrecen los botones que fallarían. Se le dan
  permisos de más —`pos`, `products`, `sales-void`, `settings`— para
  comprobar que no le abren nada aunque alguien se los marque.
*/
const CONTADOR = {
  rolDelUsuario: "contador",
  permisosDelUsuario: [
    "dashboard", "quotes", "clients", "suppliers", "sales-history", "inventory-all",
    "pos", "products", "sales-void", "settings", "locations",
  ],
}

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15, fiscal: {} }

function Permisos() {
  const { hasPermission, soloLectura, isAdmin } = useAuth()

  return (
    <ul>
      {Object.values(PERMISSIONS).map((p) => (
        <li key={p}>{`${p}:${hasPermission(p) ? "sí" : "no"}`}</li>
      ))}
      <li>{`soloLectura:${soloLectura}`}</li>
      <li>{`isAdmin:${isAdmin}`}</li>
    </ul>
  )
}

describe("perfil contador: qué pantallas abre", () => {
  it("solo las de consulta, aunque tenga marcadas otras", async () => {
    await renderizarPantalla(<AuthProvider><Permisos /></AuthProvider>, CONTADOR)

    for (const abierta of ["dashboard", "quotes", "clients", "suppliers", "sales-history", "inventory-all", "inventory-own"]) {
      expect(await screen.findByText(`${abierta}:sí`)).toBeInTheDocument()
    }

    for (const cerrada of ["pos", "products", "sales-void", "settings", "locations"]) {
      expect(screen.getByText(`${cerrada}:no`)).toBeInTheDocument()
    }

    expect(screen.getByText("soloLectura:true")).toBeInTheDocument()
    expect(screen.getByText("isAdmin:false")).toBeInTheDocument()
  })

  it("al guardarlo, solo se le conservan las secciones de consulta", () => {
    expect(permisosDelRol("contador", ["pos", "sales-history", "products", "inventory-all"])).toEqual([
      "sales-history",
      "inventory-all",
    ])
  })
})

describe("perfil contador: las pantallas no ofrecen escribir", () => {
  it("Clientes: ve la lista, sin alta ni edición", async () => {
    await renderizarPantalla(
      <AuthProvider><ClientsProvider><Clients /></ClientsProvider></AuthProvider>,
      { ...CONTADOR, clientes: [{ id: "c1", name: "Ferremax", phone: "9999-0000", address: "SPS" }], esperar: ["clientes"] }
    )

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /nuevo cliente/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /editar/i })).not.toBeInTheDocument()
  })

  it("Proveedores: ve la lista, sin alta, edición ni borrado", async () => {
    await renderizarPantalla(
      <AuthProvider><ProductProvider><Suppliers /></ProductProvider></AuthProvider>,
      { ...CONTADOR, proveedores: [{ id: "s1", name: "Distribuidora" }], esperar: ["proveedores"] }
    )

    expect(screen.getByText("Distribuidora")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /nuevo proveedor|editar|eliminar/i })).not.toBeInTheDocument()
  })

  it("Cotizaciones: ve las guardadas, sin armar, facturar ni eliminar", async () => {
    await renderizarPantalla(
      <AuthProvider>
        <ProductProvider>
          <ClientsProvider>
            <QuotesProvider>
              <MemoryRouter initialEntries={["/quotes"]}>
                <Quotes />
              </MemoryRouter>
            </QuotesProvider>
          </ClientsProvider>
        </ProductProvider>
      </AuthProvider>,
      {
        ...CONTADOR,
        productos: [{ id: "p1", code: "M-001", name: "Martillo", price: 180, stock: 5 }],
        cotizaciones: [{
          id: "Q-1", quoteNumber: "COT-00001", date: "20/08/2026", timestamp: Date.now(),
          clientName: "Ferremax", validity: "2027-06-30", includeTax: true, taxRate: 15,
          items: [{ productId: "p1", id: "p1", name: "Martillo", price: 180, qty: 1, quantity: 1, subtotal: 180 }],
          subtotal: 180, tax: 27, total: 207, company: empresa,
        }],
        esperar: ["cotizaciones"],
      }
    )

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^ver$/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /generar y guardar|facturar|agregar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /eliminar la cotización/i })).not.toBeInTheDocument()
  })

  it("Cuentas por cobrar: ve el detalle, sin abonar", async () => {
    await renderizarPantalla(
      <AuthProvider>
        <ProductProvider>
          <ClientsProvider>
            <SalesProvider>
              <Receivables />
            </SalesProvider>
          </ClientsProvider>
        </ProductProvider>
      </AuthProvider>,
      {
        ...CONTADOR,
        clientes: [{ id: "c1", name: "Arnold Oviedo", phone: "9999", address: "Tegucigalpa" }],
        ventas: [{
          id: "v1", invoiceNumber: "FAC-00001", correlativo: 1, date: "01/01/2026",
          isoDate: "2026-01-01T10:00:00Z", timestamp: Date.parse("2026-01-01T10:00:00Z"),
          clientId: "c1", clientName: "Arnold Oviedo",
          items: [{ productId: "p1", name: "Cargador", qty: 1, quantity: 1, price: 1000, subtotal: 1000 }],
          subtotal: 1000, tax: 0, total: 1000, paymentType: "credito", type: "credito",
          status: "pendiente", dueDate: "2026-02-01", payments: [], company: empresa,
        }],
        esperar: ["ventas", "clientes"],
      }
    )

    expect(screen.getByRole("button", { name: /ver detalle/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /abonar/i })).not.toBeInTheDocument()
  })

  it("Traslados: ve el historial, sin el formulario de traslado", async () => {
    await renderizarPantalla(
      <AuthProvider><ProductProvider><LocationsProvider><Transfers /></LocationsProvider></ProductProvider></AuthProvider>,
      {
        ...CONTADOR,
        productos: [{ id: "p1", code: "C-1", name: "Cargador", price: 120, stock: 10 }],
        ubicaciones: [{ id: "bodega", name: "Bodega", type: "bodega" }, { id: "camion1", name: "Camión 01", type: "camion" }],
        esperar: ["productos_con_stock", "ubicaciones", "existencias_por_ubicacion", "traslados"],
      }
    )

    expect(screen.getByRole("heading", { name: /historial/i })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: /nuevo traslado/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /trasladar/i })).not.toBeInTheDocument()
  })
})
