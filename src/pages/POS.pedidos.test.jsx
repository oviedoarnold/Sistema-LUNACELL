import { describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import SalesProvider from "../context/SalesContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
import { agregarProducto as agregar } from "../test/carrito"
import POS from "./POS"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Enviar un pedido a otra ubicación desde el POS (0045): Bodega entrega y
  descuenta, Camión 01 o la tienda facturan. Lo que se comprueba aquí es lo que
  viaja al servidor; lo que el servidor hace con ello está en
  pruebas-sql/pedidos-interubicacion.test.mjs.
*/

const PRODUCTOS = [{ id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 }]
const CLIENTES = [{ id: "c1", name: "Ferremax", rtn: "0801199912345", phone: "9999-0000", address: "SPS", email: "" }]

const BODEGA = { id: "bodega", name: "Bodega", type: "bodega" }
const CAMION_01 = { id: "camion-01", name: "Camión 01", type: "camion" }
const TIENDA = { id: "tienda", name: "Tienda", type: "tienda", fiscal: true }
const TALLER = { id: "taller", name: "Taller", type: "otro", sells: false }
const CERRADA = { id: "cerrada", name: "Camión viejo", type: "camion", active: false }

const RESUMEN = {
  pedido_id: "ped-1",
  numero: "PED-000001",
  estado: "pendiente",
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  nombre_cliente: "Ferremax",
  forma_pago: "contado",
  total: 180,
  cobrado: 180,
  saldo: 0,
  repetido: false,
}

async function renderPOS({ ubicaciones = [BODEGA, CAMION_01, TIENDA, TALLER, CERRADA], entregar } = {}) {
  const llamadas = []
  const entregarPedido = (argumentos) => {
    llamadas.push(argumentos)

    return entregar ? entregar(argumentos, llamadas.length) : { data: { ...RESUMEN }, error: null }
  }

  const r = await renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <LocationsProvider>
            <SalesProvider>
              <MemoryRouter initialEntries={["/pos"]}>
                <POS />
              </MemoryRouter>
            </SalesProvider>
          </LocationsProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      clientes: CLIENTES,
      ubicaciones,
      existencias: [{ locationId: "bodega", productId: "p1", quantity: 10 }],
      ubicacionOperativa: "bodega",
      rpcsExtra: { entregar_pedido: entregarPedido },
      esperar: ["ventas", "ubicaciones"],
    }
  )

  return { ...r, llamadas }
}

const enviarPedido = () => fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }))
const elegirDestino = (id) => fireEvent.change(screen.getByLabelText("Ubicación que factura"), { target: { value: id } })
const botonDeEnvio = () => screen.getByRole("button", { name: "Entregar y enviar pedido" })

async function elegirCliente(nombre) {
  fireEvent.focus(screen.getByPlaceholderText(/cliente.../i))
  fireEvent.click(screen.getByText(nombre))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const elegirEfectivo = () => fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }))

async function confirmarEnvio() {
  Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
  fireEvent.click(botonDeEnvio())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("POS: enviar un pedido a otra ubicación", () => {
  it("sin otra ubicación que facture, la opción no aparece y la venta es la de siempre", async () => {
    await renderPOS({ ubicaciones: [BODEGA, TALLER, CERRADA] })

    expect(screen.queryByRole("button", { name: "Enviar pedido" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generar factura" })).toBeInTheDocument()
  })

  it("ofrece solo ubicaciones activas que facturan, distintas de la propia", async () => {
    await renderPOS()

    enviarPedido()

    const opciones = [...screen.getByLabelText("Ubicación que factura").querySelectorAll("option")].map((o) => o.textContent)

    expect(opciones).toEqual(["Elige la ubicación…", "Camión 01", "Tienda · factura fiscal"])
    expect(screen.getByText(/Bodega entrega los productos y descuenta su inventario/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /vista previa/i })).not.toBeInTheDocument()
  })

  it("al contado: envía destino, cliente, productos, medios y la clave; el origen y los importes los pone el servidor", async () => {
    const { llamadas } = await renderPOS()

    enviarPedido()
    elegirDestino("camion-01")
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")
    elegirEfectivo()
    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toEqual({
      p_destino: "camion-01",
      p_cliente_id: "c1",
      p_items: [{ producto_id: "p1", cantidad: 1 }],
      p_forma_pago: "contado",
      p_cobros: [expect.objectContaining({ medio: "efectivo", monto: 180 })],
      p_con_isv: false,
      p_fecha_vencimiento: null,
      p_rtn_comprador: "0801199912345",
      p_nota: "",
      p_clave_idempotencia: expect.any(String),
    })
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Pedido PED-000001 enviado" })))

    // El formulario vuelve a «Vender aquí».
    expect(screen.getByRole("button", { name: "Generar factura" })).toBeInTheDocument()
  })

  it("sin destino o sin cliente registrado no envía nada", async () => {
    const { llamadas } = await renderPOS()

    enviarPedido()
    agregar("Martillo de uña")
    elegirEfectivo()

    expect(botonDeEnvio()).toBeDisabled()

    elegirDestino("camion-01")
    Swal.fire.mockClear()
    fireEvent.click(botonDeEnvio())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Cliente requerido" })))
    expect(llamadas).toHaveLength(0)
  })

  it("si la ubicación que factura emite facturas fiscales, el ISV queda marcado y fijo", async () => {
    const { llamadas } = await renderPOS()

    enviarPedido()
    elegirDestino("tienda")

    const isv = screen.getByRole("checkbox", { name: /ISV/ })

    expect(isv).toBeChecked()
    expect(isv).toBeDisabled()

    await elegirCliente("Ferremax")
    agregar("Martillo de uña")
    elegirEfectivo()
    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({ p_destino: "tienda", p_con_isv: true, p_cobros: [expect.objectContaining({ monto: 207 })] })
  })

  it("a crédito con prima: los medios cubren solo la prima, y el resto queda a crédito", async () => {
    const { llamadas } = await renderPOS()

    enviarPedido()
    elegirDestino("camion-01")
    fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")

    fireEvent.change(screen.getByLabelText(/Prima cobrada aquí/), { target: { value: "50" } })
    elegirEfectivo()

    expect(screen.getByText("Queda a crédito").nextSibling).toHaveTextContent("L 130.00")

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({
      p_forma_pago: "credito",
      p_cobros: [expect.objectContaining({ medio: "efectivo", monto: 50 })],
      p_fecha_vencimiento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it("una prima igual al total no se envía", async () => {
    const { llamadas } = await renderPOS()

    enviarPedido()
    elegirDestino("camion-01")
    fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")
    fireEvent.change(screen.getByLabelText(/Prima cobrada aquí/), { target: { value: "180" } })
    elegirEfectivo()
    Swal.fire.mockClear()
    fireEvent.click(botonDeEnvio())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Prima no válida" })))
    expect(llamadas).toHaveLength(0)
  })

  it("sin respuesta del servidor, reintentar usa la misma clave", async () => {
    const { llamadas } = await renderPOS({
      entregar: (_argumentos, vez) =>
        vez === 1 ? { data: null, error: { message: "Failed to fetch" }, status: 0 } : { data: { ...RESUMEN, repetido: true }, error: null },
    })

    enviarPedido()
    elegirDestino("camion-01")
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")
    elegirEfectivo()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true }).mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(botonDeEnvio())

    await waitFor(() => expect(llamadas).toHaveLength(2))
    expect(llamadas[1].p_clave_idempotencia).toBe(llamadas[0].p_clave_idempotencia)
  })

  it("un rechazo del servidor se muestra con su mensaje y el carrito se conserva", async () => {
    const { llamadas } = await renderPOS({
      entregar: () => ({ data: null, error: { code: "PI007", message: "No hay suficiente «Martillo de uña» en Bodega: hay 0, se piden 1" } }),
    })

    enviarPedido()
    elegirDestino("camion-01")
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")
    elegirEfectivo()
    await confirmarEnvio()

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No se pudo enviar el pedido", text: "No hay suficiente «Martillo de uña» en Bodega: hay 0, se piden 1" })
      )
    )
    expect(llamadas).toHaveLength(1)
    expect(botonDeEnvio()).toBeInTheDocument()
  })
})
