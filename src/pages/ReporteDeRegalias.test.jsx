import { describe, it, expect, vi } from "vitest"
import { screen, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import LocationsProvider from "../context/LocationsContext"
import { EMPRESA, EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import ReporteDeRegalias from "./ReporteDeRegalias"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  22. El reporte de regalías (0054). Qué filas y si llega el costo lo decide
  reporte_de_regalias() en la base (pruebas-sql/regalias.test.mjs); aquí se
  comprueba que la pantalla muestre lo que llega y no invente el costo.
*/

const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "tienda" }

const venta = (id, numero, estado) => ({
  id,
  invoiceNumber: numero,
  isoDate: new Date().toISOString(),
  timestamp: Date.now(),
  clientName: "Ferremax",
  items: [{ productId: "p1", name: "Cargador", qty: 1, quantity: 1, price: 100, subtotal: 100 }],
  subtotal: 100,
  tax: 15,
  total: 115,
  paymentType: "contado",
  status: estado,
  locationId: "bodega",
})

const regalia = (id, ventaId, cantidad) => ({
  id,
  empresa_id: EMPRESA,
  venta_id: ventaId,
  cliente_id: "c1",
  producto_id: "p1",
  nombre: "Cargador",
  codigo: "C-1",
  cantidad,
  ubicacion_id: "bodega",
  usuario_nombre: "Vendedora Bodega",
  motivo: "otro",
  detalle_motivo: "Aniversario",
  costo_unitario: 37,
  creado_en: new Date().toISOString(),
})

const renderReporte = (rol, permisos = []) =>
  renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <ReporteDeRegalias />
      </LocationsProvider>
    </AuthProvider>,
    {
      empresa: EMPRESA_PRUEBA,
      ubicaciones: [BODEGA],
      ubicacionOperativa: "bodega",
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ventas: [venta("V-1", "VTA-000001", "pagada"), venta("V-2", "VTA-000002", "anulada")],
      tablasExtra: { regalias_venta: [regalia("r1", "V-1", 1), regalia("r2", "V-2", 2)] },
    }
  )

describe("22. reporte de regalías", () => {
  it("el administrador ve cada regalía con su factura, su estado y el costo", async () => {
    const { falso } = await renderReporte("admin")

    const tabla = await screen.findByRole("table")
    const filas = within(tabla).getAllByRole("row").slice(1)

    expect(falso.rpc).toHaveBeenCalledWith("reporte_de_regalias", expect.objectContaining({ p_ubicacion: null }))
    expect(screen.getByRole("heading", { name: /2 regalías · 3 unidades · Costo L 111.00/ })).toBeInTheDocument()
    expect(within(tabla).getByRole("columnheader", { name: "Costo unit." })).toBeInTheDocument()
    expect(filas.map((f) => f.textContent)).toEqual([
      expect.stringContaining("VTA-000001Pagada"),
      expect.stringContaining("VTA-000002Anulada · regalía no restituida"),
    ])
    expect(filas[0]).toHaveTextContent("Otro: Aniversario")
  })

  it("el vendedor con historial no ve el costo, ni la columna", async () => {
    await renderReporte("vendedor", ["sales-history"])

    const tabla = await screen.findByRole("table")

    expect(within(tabla).queryByRole("columnheader", { name: /costo/i })).toBeNull()
    expect(screen.getByRole("heading", { name: "2 regalías · 3 unidades" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Ubicación")).toBeNull()
  })
})
