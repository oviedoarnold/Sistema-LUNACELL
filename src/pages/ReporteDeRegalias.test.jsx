import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"

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
  22. El reporte de regalías (0054 y 0055). Qué filas, si llega el costo y el
  precio guardado lo decide reporte_de_regalias() en la base
  (pruebas-sql/regalias.test.mjs y regalias-precio.test.mjs); aquí se
  comprueba que la pantalla muestre lo que llega, no invente el costo y no
  confunda un precio sin registrar con un cero.
*/

const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "tienda" }
const RUTA = { id: "ruta", name: "Ruta local", type: "camion" }

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

const regalia = (id, ventaId, cantidad, { precio = 150, ubicacion = "bodega" } = {}) => ({
  id,
  empresa_id: EMPRESA,
  venta_id: ventaId,
  cliente_id: "c1",
  producto_id: "p1",
  nombre: "Cargador",
  codigo: "C-1",
  cantidad,
  ubicacion_id: ubicacion,
  usuario_nombre: "Vendedora Bodega",
  motivo: "otro",
  detalle_motivo: "Aniversario",
  costo_unitario: 37,
  precio_unitario: precio,
  creado_en: new Date().toISOString(),
})

const DOS = [regalia("r1", "V-1", 1), regalia("r2", "V-2", 2)]

const renderReporte = (rol, permisos = [], regalias = DOS) =>
  renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <ReporteDeRegalias />
      </LocationsProvider>
    </AuthProvider>,
    {
      empresa: EMPRESA_PRUEBA,
      ubicaciones: [BODEGA, RUTA],
      ubicacionOperativa: "bodega",
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ventas: [venta("V-1", "VTA-000001", "pagada"), venta("V-2", "VTA-000002", "anulada")],
      tablasExtra: { regalias_venta: regalias },
    }
  )

// La cifra de una tarjeta del resumen, por su etiqueta.
const tarjeta = (etiqueta) => screen.getByText(etiqueta).closest("article")
const cifra = (etiqueta) => within(tarjeta(etiqueta)).getByText((_, el) => el?.classList.contains("value")).textContent
const encabezados = (tabla) => within(tabla).getAllByRole("columnheader").map((c) => c.textContent)
const filasDe = (tabla) => within(tabla).getAllByRole("row").slice(1, -1)
const totales = (tabla) => within(tabla).getAllByRole("row").at(-1)

describe("22. reporte de regalías", () => {
  it("el administrador ve el título, las tres tarjetas, costo, precio y valor comercial, y la fila de totales", async () => {
    const { falso } = await renderReporte("admin")
    const tabla = await screen.findByRole("table")

    expect(falso.rpc).toHaveBeenCalledWith("reporte_de_regalias", expect.objectContaining({ p_ubicacion: null }))
    expect(screen.getByRole("heading", { name: "Reporte de regalías" })).toBeInTheDocument()
    expect(screen.getByText("Detalle de productos entregados como regalía.")).toBeInTheDocument()

    expect([cifra("Regalías"), cifra("Unidades entregadas"), cifra("Valor comercial total")]).toEqual(["2", "3", "L 450.00"])
    expect(tarjeta("Valor comercial total")).toHaveTextContent("A precio de venta, sin ISV")
    expect(screen.queryByText(/costo total/i)).toBeNull()

    expect(encabezados(tabla).slice(-3)).toEqual(["Costo unitario", "Precio de venta unitario", "Valor comercial"])
    expect(filasDe(tabla).map((f) => f.textContent)).toEqual([
      expect.stringContaining("VTA-000001Pagada"),
      expect.stringContaining("VTA-000002Anulada · regalía no restituida"),
    ])
    expect(filasDe(tabla)[1]).toHaveTextContent(/L 37\.00L 150\.00L 300\.00$/)
    expect(filasDe(tabla)[0]).toHaveTextContent("Otro: Aniversario")
    expect(totales(tabla).textContent).toBe("Totales3L 450.00")
  })

  it("el vendedor con historial ve precio y valor comercial, pero ni el costo ni su columna", async () => {
    await renderReporte("vendedor", ["sales-history"])
    const tabla = await screen.findByRole("table")

    expect(within(tabla).queryByRole("columnheader", { name: /costo/i })).toBeNull()
    expect(encabezados(tabla).slice(-2)).toEqual(["Precio de venta unitario", "Valor comercial"])
    expect(filasDe(tabla)[1]).toHaveTextContent(/L 150\.00L 300\.00$/)
    expect(tabla).not.toHaveTextContent("L 37.00")
    expect(cifra("Valor comercial total")).toBe("L 450.00")
    expect(screen.queryByLabelText("Ubicación")).toBeNull()
  })

  it("una regalía sin precio registrado dice «No registrado» y queda fuera del valor, con su nota", async () => {
    await renderReporte("admin", [], [regalia("r1", "V-1", 1), regalia("r2", "V-2", 2, { precio: null })])
    const tabla = await screen.findByRole("table")

    expect(filasDe(tabla)[1]).toHaveTextContent(/No registradoNo registrado$/)
    expect([cifra("Regalías"), cifra("Unidades entregadas"), cifra("Valor comercial total")]).toEqual(["2", "3", "L 150.00"])
    expect(tarjeta("Valor comercial total")).toHaveTextContent("No incluye 1 regalía sin precio registrado")
    expect(totales(tabla).textContent).toBe("Totales3L 150.00")
  })

  it("si ninguna tiene precio, el valor comercial dice «No registrado», no L 0.00", async () => {
    await renderReporte("admin", [], [regalia("r1", "V-1", 1, { precio: null }), regalia("r2", "V-2", 2, { precio: null })])
    const tabla = await screen.findByRole("table")

    expect(cifra("Valor comercial total")).toBe("No registrado")
    expect(tarjeta("Valor comercial total")).toHaveTextContent("Ninguna regalía del período tiene precio registrado")
    expect(totales(tabla).textContent).toBe("Totales3No registrado")
    expect(tabla).not.toHaveTextContent("L 0.00")
  })

  it("un precio registrado en cero se muestra L 0.00 y cuenta como registrado", async () => {
    await renderReporte("admin", [], [regalia("r1", "V-1", 2, { precio: 0 })])
    const tabla = await screen.findByRole("table")

    expect(filasDe(tabla)[0]).toHaveTextContent(/L 37\.00L 0\.00L 0\.00$/)
    expect(cifra("Valor comercial total")).toBe("L 0.00")
    expect(tarjeta("Valor comercial total")).toHaveTextContent("A precio de venta, sin ISV")
  })

  it("al filtrar por ubicación, las tarjetas y los totales cuentan solo lo filtrado", async () => {
    const { falso } = await renderReporte("admin", [], [regalia("r1", "V-1", 1), regalia("r2", "V-2", 2, { ubicacion: "ruta", precio: 80 })])

    await screen.findByRole("table")
    expect([cifra("Regalías"), cifra("Unidades entregadas"), cifra("Valor comercial total")]).toEqual(["2", "3", "L 310.00"])

    fireEvent.change(screen.getByLabelText("Ubicación"), { target: { value: "ruta" } })

    await waitFor(() => expect(falso.rpc).toHaveBeenLastCalledWith("reporte_de_regalias", expect.objectContaining({ p_ubicacion: "ruta" })))
    await waitFor(() => expect(cifra("Regalías")).toBe("1"))
    expect([cifra("Unidades entregadas"), cifra("Valor comercial total")]).toEqual(["2", "L 160.00"])
    expect(totales(screen.getByRole("table")).textContent).toBe("Totales2L 160.00")
  })

  it("sin regalías en el período no muestra tarjetas ni tabla", async () => {
    await renderReporte("admin", [], [])

    expect(await screen.findByText("Sin regalías")).toBeInTheDocument()
    expect(screen.queryByText("Valor comercial total")).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
