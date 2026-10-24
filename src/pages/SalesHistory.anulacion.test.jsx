import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within, waitFor } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { EMPRESA, EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import SalesHistory from "./SalesHistory"

/*
  A-5 en el historial: quién ve «Anular», cómo se ve una venta anulada, que
  no sume a las cifras y que el historial se actualice después de anular.
  Quién puede anular de verdad lo decide la base (pruebas-sql).
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
  invoiceNumber: "VTA-000009",
  isoDate: new Date().toISOString(),
  timestamp: Date.now(),
  clientName: "Consumidor Final",
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

const anulada = venta({ id: "V-2", invoiceNumber: "VTA-000010", status: "anulada", total: 500 })

const REGISTRO = {
  id: "an-1",
  empresa_id: EMPRESA,
  venta_id: "V-2",
  anulada_en: "2026-10-24T15:00:00Z",
  motivo: "Se registró dos veces por error",
  usuario_nombre: "Chofer Camión 01",
  usuario_rol: "vendedor",
  tratamiento_dinero: "reembolso_pendiente",
  estado_anterior: "pagada",
}

function renderHistory(ventas, { rol = "admin", permisos = [], ubicacion = null, anulaciones = [], anular } = {}) {
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
      tablasExtra: { anulaciones_venta: anulaciones },
      rpcsExtra: anular ? { anular_venta: anular } : {},
      esperar: ["ventas"],
    }
  )
}

const filaDe = (numero) => screen.getByText(numero, { exact: false }).closest(".sale-card")
const botonAnular = (numero) => within(filaDe(numero)).queryByRole("button", { name: `Anular ${numero}` })

describe("una venta anulada en el historial", () => {
  it("se sigue viendo, con «Anulada», quién la anuló, cuándo, el motivo y el dinero", async () => {
    await renderHistory([venta(), anulada], { anulaciones: [REGISTRO] })

    const fila = filaDe("VTA-000010")
    expect(within(fila).getByText("Anulada")).toBeInTheDocument()
    expect(fila).toHaveTextContent("por Chofer Camión 01 (vendedor)")
    expect(fila).toHaveTextContent("Se registró dos veces por error")
    expect(fila).toHaveTextContent("Reembolso pendiente")
    expect(botonAnular("VTA-000010")).toBeNull()
  })

  it("no suma al total vendido, a los conteos ni al saldo por cobrar", async () => {
    const creditoAnulado = venta({ id: "V-3", invoiceNumber: "VTA-000011", paymentType: "credito", status: "anulada", total: 1000 })
    await renderHistory([venta(), anulada, creditoAnulado])

    expect(screen.getByText("L 230.00", { selector: ".historial-total-valor" })).toBeInTheDocument()
    expect(screen.getByText("Ventas contado").closest(".stat-card")).toHaveTextContent("1")
    expect(screen.getByText("Ventas crédito").closest(".stat-card")).toHaveTextContent("0")
    expect(screen.getByText("Saldo por cobrar").closest("div")).toHaveTextContent("L 0.00")
  })

  it("el filtro «Anuladas» deja solo las anuladas", async () => {
    await renderHistory([venta(), anulada])

    fireEvent.change(screen.getByRole("combobox", { name: /filtrar/i }), { target: { value: "anuladas" } })

    expect(screen.getByText("VTA-000010", { exact: false })).toBeInTheDocument()
    expect(screen.queryByText("VTA-000009", { exact: false })).toBeNull()
  })
})

describe("quién ve «Anular»", () => {
  it("el administrador, en ventas de cualquier ubicación", async () => {
    await renderHistory([venta(), venta({ id: "V-4", invoiceNumber: "VTA-000012", locationId: CAMION_2 })])

    expect(botonAnular("VTA-000009")).toBeInTheDocument()
    expect(botonAnular("VTA-000012")).toBeInTheDocument()
  })

  it("el vendedor con «Historial» y «Anular ventas», solo en su ubicación", async () => {
    await renderHistory([venta(), venta({ id: "V-4", invoiceNumber: "VTA-000012", locationId: CAMION_2 })], {
      rol: "vendedor",
      permisos: ["sales-history", "sales-void"],
      ubicacion: CAMION_1,
    })

    expect(botonAnular("VTA-000009")).toBeInTheDocument()
    expect(botonAnular("VTA-000012")).toBeNull()
  })

  it("el vendedor sin «Anular ventas» no lo ve", async () => {
    await renderHistory([venta()], { rol: "vendedor", permisos: ["sales-history"], ubicacion: CAMION_1 })

    expect(botonAnular("VTA-000009")).toBeNull()
  })
})

describe("anular desde el historial", () => {
  it("una venta que no se puede anular explica por qué y no deja confirmar", async () => {
    await renderHistory([venta({ paymentType: "credito", status: "pendiente", payments: [{ id: "a1", amount: 50 }] })])

    fireEvent.click(botonAnular("VTA-000009"))

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Esta venta tiene abonos registrados")
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeDisabled()
  })

  it("al confirmar llama a la base y el historial muestra la venta anulada", async () => {
    const anular = vi.fn((argumentos, { datos }) => {
      const fila = datos.ventas.find((v) => v.id === argumentos.p_venta_id)
      fila.estado = "anulada"
      datos.anulaciones_venta.push({ ...REGISTRO, venta_id: fila.id, motivo: argumentos.p_motivo, usuario_nombre: "Arnold", usuario_rol: "admin" })

      return { data: { estado: "anulada", venta_id: fila.id, numero_factura: fila.numero_factura }, error: null }
    })
    await renderHistory([venta()], { anular })

    fireEvent.click(botonAnular("VTA-000009"))
    fireEvent.change(screen.getByLabelText(/motivo de la anulación/i), { target: { value: "Cliente desistió de la compra" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }))

    await waitFor(() => expect(within(filaDe("VTA-000009")).getByText("Anulada")).toBeInTheDocument())
    expect(anular).toHaveBeenCalledWith(
      {
        p_venta_id: "V-1",
        p_motivo: "Cliente desistió de la compra",
        p_tratamiento_dinero: "reembolso_pendiente",
        p_clave_idempotencia: "anular-V-1",
      },
      expect.anything()
    )
    expect(filaDe("VTA-000009")).toHaveTextContent("Cliente desistió de la compra")
    expect(botonAnular("VTA-000009")).toBeNull()
  })
})
