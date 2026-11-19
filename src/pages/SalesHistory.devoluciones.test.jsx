import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { EMPRESA, EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import SalesHistory from "./SalesHistory"

/*
  Devoluciones en el historial (0052): quién ve el botón, cómo se ve una
  venta con devoluciones, que el ajuste del crédito no cuente como abonado y
  que una venta con devoluciones ya no se ofrezca a anular. Lo que de verdad
  decide está en la base (pruebas-sql/devoluciones-de-ventas.test.mjs).
*/

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const CAMION_1 = "ubic-camion-1"
const CAMION_2 = "ubic-camion-2"
const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const venta = (extra = {}) => ({
  id: "V-1",
  invoiceNumber: "VTA-000030",
  isoDate: new Date().toISOString(),
  timestamp: Date.now(),
  clientName: "Taller Central",
  items: [{ productId: "p1", name: "Cargador", qty: 2, quantity: 2, price: 100, subtotal: 200 }],
  subtotal: 200,
  tax: 30,
  total: 230,
  paymentType: "contado",
  status: "pagada",
  locationId: CAMION_1,
  company: empresa,
  ...extra,
})

const DEVOLUCION = {
  id: "dv-1",
  empresa_id: EMPRESA,
  venta_id: "V-1",
  devuelto_en: "2026-11-19T15:00:00Z",
  motivo: "No era el modelo",
  valor: 115,
  cargo: 0,
  ajuste_credito: 115,
  a_favor: 0,
  usuario_nombre: "Arnold",
}

function renderHistory(ventas, { rol = "admin", permisos = [], ubicacion = null, devoluciones = [] } = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>
          <SalesHistory />
        </SalesProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      ventas,
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ubicacionOperativa: ubicacion,
      tablasExtra: { devoluciones_de_venta: devoluciones },
      esperar: ["ventas"],
    }
  )
}

const filaDe = (numero) => screen.getByText(numero, { exact: false }).closest(".sale-card")
const boton = (numero, nombre) => within(filaDe(numero)).queryByRole("button", { name: `${nombre} ${numero}` })

describe("quién ve «Devoluciones»", () => {
  const dos = [venta(), venta({ id: "V-2", invoiceNumber: "VTA-000031", locationId: CAMION_2 })]

  it("el administrador, en ventas de cualquier ubicación, pero no en las anuladas", async () => {
    await renderHistory([...dos, venta({ id: "V-3", invoiceNumber: "VTA-000032", status: "anulada" })])

    expect(boton("VTA-000030", "Devoluciones de")).toBeInTheDocument()
    expect(boton("VTA-000031", "Devoluciones de")).toBeInTheDocument()
    expect(boton("VTA-000032", "Devoluciones de")).toBeNull()
  })

  it("el vendedor con «Registrar devoluciones», solo en las de su ubicación y sin límite de día", async () => {
    const vieja = venta({ id: "V-4", invoiceNumber: "VTA-000033", isoDate: "2026-01-02T15:00:00Z", timestamp: Date.parse("2026-01-02T15:00:00Z") })
    await renderHistory([...dos, vieja], { rol: "vendedor", permisos: ["sales-history", "sales-return"], ubicacion: CAMION_1 })

    expect(boton("VTA-000030", "Devoluciones de")).toBeInTheDocument()
    expect(boton("VTA-000033", "Devoluciones de")).toBeInTheDocument()
    expect(boton("VTA-000031", "Devoluciones de")).toBeNull()
  })

  it("sin el permiso no lo ve, salvo para consultar una venta que ya tiene devoluciones", async () => {
    await renderHistory(dos, { rol: "contador", permisos: ["sales-history", "sales-return"], devoluciones: [DEVOLUCION] })

    expect(boton("VTA-000030", "Devoluciones de")).toBeInTheDocument()
    expect(boton("VTA-000031", "Devoluciones de")).toBeNull()
  })
})

describe("una venta con devoluciones", () => {
  it("muestra lo devuelto y el ajuste del crédito no cuenta como abonado, pero sí rebaja el saldo", async () => {
    const credito = venta({
      paymentType: "credito",
      status: "pendiente",
      // El ajuste es un abono con devolucion_id, como lo deja la base.
      payments: [
        { id: "a1", amount: 50 },
        { id: "a2", amount: 115, devolucionId: "dv-1" },
      ],
    })
    await renderHistory([credito], { devoluciones: [DEVOLUCION] })

    const fila = filaDe("VTA-000030")
    expect(fila).toHaveTextContent("Devuelto L 115.00")
    expect(fila).toHaveTextContent("Abonado L 50.00")
    expect(fila).toHaveTextContent("Resta L 65.00")
  })

  it("ya no se ofrece a anular: dice que se registre la devolución de lo que falta", async () => {
    await renderHistory([venta()], { devoluciones: [DEVOLUCION] })

    fireEvent.click(boton("VTA-000030", "Anular"))

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Esta venta ya tiene devoluciones registradas")
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeDisabled()
  })
})
