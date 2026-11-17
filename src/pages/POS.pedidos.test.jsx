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
import { hayOperacionEnCurso } from "../lib/actualizacion/bloqueos"

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
const casilla = () => screen.queryByRole("checkbox", { name: "Hacer pago parcial" })
const marcarPagoParcial = () => fireEvent.click(casilla())
const escribirPago = (monto) => fireEvent.change(screen.getByLabelText("Monto del pago parcial"), { target: { value: monto } })
const fila = (texto) => screen.getByText(texto).closest(".totals-row")

// Bodega envía a Camión 01, a crédito, un martillo (180) a Ferremax.
async function pedidoACredito() {
  enviarPedido()
  elegirDestino("camion-01")
  fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
  await elegirCliente("Ferremax")
  agregar("Martillo de uña")
}

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

  it("a crédito con pago parcial: los medios cubren solo el pago, y el resto queda a crédito", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("50")
    elegirEfectivo()

    expect(fila("Saldo pendiente del crédito")).toHaveTextContent("L 130.00")
    expect(fila("El cliente entrega aquí")).toHaveTextContent("L 50.00")

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({
      p_forma_pago: "credito",
      p_cobros: [expect.objectContaining({ medio: "efectivo", monto: 50 })],
      p_fecha_vencimiento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it("un pago parcial igual al total no se envía", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("180")
    elegirEfectivo()
    Swal.fire.mockClear()
    fireEvent.click(botonDeEnvio())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Pago parcial no válido" })))
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

  it("a crédito sin marcar «Hacer pago parcial»: sin campos de cobro, sin medios y sin cobros", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()

    expect(casilla()).not.toBeChecked()
    expect(screen.queryByLabelText("Monto del pago parcial")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "Efectivo" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Saldo pendiente del crédito/)).not.toBeInTheDocument()

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({ p_forma_pago: "credito", p_cobros: [] })
  })

  it("la casilla solo aparece en pedidos a crédito, no al contado ni en ventas normales", async () => {
    await renderPOS()

    expect(casilla()).toBeNull()

    enviarPedido()
    expect(casilla()).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
    expect(casilla()).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Vender aquí" }))
    expect(casilla()).toBeNull()
  })

  it("muestra dónde se recibe el dinero", async () => {
    await renderPOS()
    await pedidoACredito()
    marcarPagoParcial()

    expect(screen.getByText("Bodega", { selector: "b" }).closest("p")).toHaveTextContent("Se recibe en Bodega")
  })

  it("desmarcar la casilla borra el monto y los medios: no se envía ningún cobro", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("50")
    elegirEfectivo()
    marcarPagoParcial()

    expect(screen.queryByLabelText("Monto del pago parcial")).not.toBeInTheDocument()
    expect(screen.queryByText(/Saldo pendiente del crédito/)).not.toBeInTheDocument()

    // Al volver a marcarla, empieza vacía.
    marcarPagoParcial()
    expect(screen.getByLabelText("Monto del pago parcial")).toHaveValue("")
    marcarPagoParcial()

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0].p_cobros).toEqual([])
  })

  it("marcada pero sin monto, no envía y pide escribirlo o desmarcarla", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    Swal.fire.mockClear()
    fireEvent.click(botonDeEnvio())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Falta el pago parcial" })))
    expect(llamadas).toHaveLength(0)
  })

  it.each([
    ["Transferencia", "transferencia"],
    ["Tarjeta", "tarjeta"],
    ["Enlace de pago", "enlace"],
  ])("pago parcial con %s: viaja solo ese pago, con su medio", async (etiqueta, medio) => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("100")
    fireEvent.click(screen.getByRole("radio", { name: etiqueta }))
    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0].p_cobros).toEqual([expect.objectContaining({ medio, monto: 100 })])
  })

  it("con tarjeta, el 1.70 % se suma a lo que entrega el cliente y no reduce el saldo", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("100")
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }))

    expect(fila("Total del pedido")).toHaveTextContent("L 180.00")
    expect(fila("Pago parcial")).toHaveTextContent("L 100.00")
    expect(screen.getByText(/1\.7 ?%/, { selector: ".totals-row span" }).closest(".totals-row")).toHaveTextContent("L 1.70")
    expect(fila("El cliente entrega aquí")).toHaveTextContent("L 101.70")
    expect(fila("Saldo pendiente del crédito")).toHaveTextContent("L 80.00")

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0].p_cobros).toEqual([expect.objectContaining({ medio: "tarjeta", monto: 100, cargo: 1.7, tasa: 1.7 })])
  })

  it("pago parcial mixto: los dos medios suman el pago parcial", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("100")
    fireEvent.click(screen.getByRole("radio", { name: "Pago mixto" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Efectivo" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Transferencia" }))
    fireEvent.change(screen.getByLabelText("Importe de Efectivo"), { target: { value: "60" } })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fila("Saldo pendiente del crédito")).toHaveTextContent("L 80.00")

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0].p_cobros).toEqual(
      expect.arrayContaining([expect.objectContaining({ medio: "efectivo", monto: 60 }), expect.objectContaining({ medio: "transferencia", monto: 40 })])
    )
  })

  it("mayor que el total: lo dice y no envía", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("200")

    expect(screen.getByRole("alert", { name: "" })).toHaveTextContent("No puede ser mayor que el total del pedido (L 180.00).")

    elegirEfectivo()
    Swal.fire.mockClear()
    fireEvent.click(botonDeEnvio())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(llamadas).toHaveLength(0)
  })

  it("igual al total: avisa y ofrece pasarlo al contado, conservando cliente, productos y medios", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("180")
    elegirEfectivo()

    expect(screen.getByText(/debe enviarse al contado/)).toBeInTheDocument()

    // No cambia solo: hace falta pulsar.
    expect(screen.getByRole("button", { name: /Crédito/ })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Enviar al contado" }))

    expect(screen.getByRole("button", { name: /Contado/ })).toHaveAttribute("aria-pressed", "true")
    expect(casilla()).toBeNull()
    expect(screen.getByRole("radio", { name: "Efectivo" })).toBeChecked()

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({
      p_forma_pago: "contado",
      p_cliente_id: "c1",
      p_cobros: [expect.objectContaining({ medio: "efectivo", monto: 180 })],
      p_fecha_vencimiento: null,
    })
  })

  it("en un pedido, cambiar entre Contado y Crédito conserva el cliente y no deja montos", async () => {
    const { llamadas } = await renderPOS()

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("50")
    elegirEfectivo()

    fireEvent.click(screen.getByRole("button", { name: /Contado/ }))
    expect(screen.getByPlaceholderText(/cliente.../i)).toHaveValue("Ferremax")

    fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
    expect(screen.getByPlaceholderText(/cliente.../i)).toHaveValue("Ferremax")
    expect(casilla()).not.toBeChecked()
    expect(screen.queryByLabelText("Monto del pago parcial")).not.toBeInTheDocument()

    await confirmarEnvio()

    await waitFor(() => expect(llamadas).toHaveLength(1))
    expect(llamadas[0]).toMatchObject({ p_forma_pago: "credito", p_cliente_id: "c1", p_cobros: [] })
  })

  it("un pedido a medio armar, con su pago parcial escrito, no se interrumpe por una actualización", async () => {
    await renderPOS()

    expect(hayOperacionEnCurso()).toBe(false)

    await pedidoACredito()
    marcarPagoParcial()
    escribirPago("50")

    expect(hayOperacionEnCurso()).toBe(true)
  })

  it("en una venta normal, cambiar la forma de pago sigue soltando el cliente, como siempre", async () => {
    await renderPOS()

    await elegirCliente("Ferremax")
    expect(screen.getByPlaceholderText(/cliente.../i)).toHaveValue("Ferremax")

    fireEvent.click(screen.getByRole("button", { name: /Crédito/ }))
    expect(screen.getByPlaceholderText(/cliente.../i)).toHaveValue("")
  })

})
