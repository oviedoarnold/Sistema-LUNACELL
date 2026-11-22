import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import SalesProvider from "../context/SalesContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla, EMPRESA_PRUEBA } from "../test/pantallas"
import { agregarProducto as agregar } from "../test/carrito"
import POS from "./POS"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Regalías en el POS (0054): productos sin cargo para el cliente de la venta.
  No cambian el total ni los medios; salen de la misma ubicación y se
  registran en la misma llamada que la venta.
*/

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 100, stock: 10 },
  { id: "p2", code: "V-001", name: "Vidrio privado", category: "Accesorios", price: 50, stock: 2 },
]

const CLIENTES = [{ id: "c1", name: "Ferremax", rtn: "0801199912345", phone: "9999-0000", address: "SPS", email: "" }]
const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "tienda" }
const PERMISOS = ["pos", "clients", "sales-history", "inventory-own"]

function renderPOS({ permisos = [...PERMISOS, "regalias"], ubicacion = BODEGA, fallarEn = {}, conUbicaciones = false } = {}) {
  const pantalla = (
    <MemoryRouter initialEntries={["/pos"]}>
      <POS />
    </MemoryRouter>
  )

  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <SalesProvider>{conUbicaciones ? <LocationsProvider>{pantalla}</LocationsProvider> : pantalla}</SalesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      clientes: CLIENTES,
      ubicaciones: [ubicacion],
      existencias: PRODUCTOS.map((p) => ({ locationId: ubicacion.id, productId: p.id, quantity: p.stock })),
      ubicacionOperativa: ubicacion.id,
      rolDelUsuario: "vendedor",
      permisosDelUsuario: permisos,
      empresa: EMPRESA_PRUEBA,
      fallarEn,
      esperar: ["ventas"],
    }
  )
}

const seccion = () => screen.queryByRole("region", { name: /regalías/i })
const botonAgregarRegalia = () => within(seccion()).getByRole("button", { name: /agregar regalía/i })
const facturar = () => screen.getByRole("button", { name: /generar factura/i })
const elegirEfectivo = () => fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }))

async function elegirCliente(nombre = "Ferremax") {
  fireEvent.focus(screen.getByPlaceholderText(/nombre/i))
  fireEvent.click(screen.getByText(nombre))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function regalar(nombre) {
  fireEvent.click(botonAgregarRegalia())
  const ventana = screen.getByRole("dialog", { name: /agregar regalía/i })

  fireEvent.click(within(ventana).getByRole("button", { name: `Agregar ${nombre} como regalía` }))
  fireEvent.click(within(ventana).getByRole("button", { name: "Listo" }))
}

const elegirMotivo = (motivo) => fireEvent.change(screen.getByLabelText("Motivo de la regalía"), { target: { value: motivo } })
const llamadasA = (falso, nombre) => falso.rpc.mock.calls.filter(([n]) => n === nombre)
const existencia = (falso, producto) => falso.datos.inventario_ubicacion.find((c) => c.producto_id === producto).cantidad

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("POS · regalías: quién y cuándo", () => {
  it("sin el permiso «Autorizar regalías» no aparece la sección", async () => {
    await renderPOS({ permisos: PERMISOS })

    expect(seccion()).toBeNull()
  })

  it("con el permiso y sin cliente registrado, el botón está desactivado y dice por qué", async () => {
    await renderPOS()

    expect(botonAgregarRegalia()).toBeDisabled()
    expect(within(seccion()).getByText(/elige un cliente registrado/i)).toBeInTheDocument()
  })

  it("23. en una ubicación que emite factura fiscal no se agregan, y lo dice", async () => {
    await renderPOS({ ubicacion: { ...BODEGA, fiscal: true }, conUbicaciones: true })
    await elegirCliente()

    await waitFor(() => expect(within(seccion()).getByText(/no se registran en facturas fiscales/i)).toBeInTheDocument())
    expect(botonAgregarRegalia()).toBeDisabled()
  })
})

describe("POS · regalías: la venta", () => {
  it("2, 4 y 17. vende y regala en una sola llamada: el total no cambia y la factura dice SIN CARGO", async () => {
    const { falso } = await renderPOS()
    await elegirCliente()

    agregar("Martillo de uña")
    const totalAntes = document.querySelector(".totals").textContent

    regalar("Martillo de uña")
    regalar("Vidrio privado")

    const lista = screen.getByRole("list", { name: "Regalías de la venta" })
    expect(within(lista).getAllByText("Regalía")).toHaveLength(2)
    expect(within(lista).getAllByText("Sin cargo")).toHaveLength(2)
    expect(document.querySelector(".totals").textContent).toBe(totalAntes)

    elegirMotivo("cliente_frecuente")
    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(llamadasA(falso, "registrar_venta_con_regalias")).toHaveLength(1)
    expect(llamadasA(falso, "registrar_venta_con_regalias")[0][1]).toMatchObject({
      p_items: [expect.objectContaining({ producto_id: "p1", cantidad: 1 })],
      p_regalias: [
        { producto_id: "p1", cantidad: 1 },
        { producto_id: "p2", cantidad: 1 },
      ],
      p_motivo_regalia: "cliente_frecuente",
      p_cliente_id: "c1",
    })
    expect(falso.datos.ventas[0]).toMatchObject({ subtotal: 100, total: 115 })
    expect(existencia(falso, "p1")).toBe(8)
    expect(existencia(falso, "p2")).toBe(1)

    const factura = await screen.findByLabelText("Regalías y cortesías")
    expect(within(factura).getByText("REGALÍAS / CORTESÍAS")).toBeInTheDocument()
    expect(within(factura).getAllByText("SIN CARGO")).toHaveLength(2)
    expect(within(factura).getByText("Motivo: Cliente frecuente")).toBeInTheDocument()
  })

  it("una venta sin regalías sigue por el camino de siempre", async () => {
    const { falso } = await renderPOS()
    await elegirCliente()

    agregar("Martillo de uña")
    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(llamadasA(falso, "registrar_venta_con_regalias")).toHaveLength(0)
    expect(llamadasA(falso, "registrar_venta_con_medios")).toHaveLength(1)
  })

  it("sin motivo, o con «Otro» sin describirlo, no registra nada", async () => {
    const { falso } = await renderPOS()
    await elegirCliente()

    agregar("Martillo de uña")
    regalar("Vidrio privado")
    elegirEfectivo()
    fireEvent.click(facturar())

    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Revisa las regalías", text: "Elige el motivo de la regalía." }))

    elegirMotivo("otro")
    fireEvent.click(facturar())
    expect(Swal.fire).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringMatching(/describe el motivo/i) }))

    fireEvent.change(screen.getByLabelText("Describe el motivo"), { target: { value: "Aniversario del cliente" } })
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.regalias_venta).toHaveLength(1))
    expect(falso.datos.regalias_venta[0]).toMatchObject({ motivo: "otro", detalle_motivo: "Aniversario del cliente" })
  })

  it("6. lo que se regala se cuenta junto con lo que se vende: sin existencia restante no se ofrece", async () => {
    await renderPOS()
    await elegirCliente()

    agregar("Vidrio privado")
    fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Vidrio privado" }))
    fireEvent.click(botonAgregarRegalia())

    const ventana = screen.getByRole("dialog", { name: /agregar regalía/i })
    expect(within(ventana).getByRole("button", { name: "Agregar Vidrio privado como regalía" })).toBeDisabled()
    expect(within(ventana).getByRole("button", { name: "Agregar Martillo de uña como regalía" })).toBeEnabled()
  })

  it("si el cliente se quita después, la venta con regalías no se registra", async () => {
    const { falso } = await renderPOS()
    await elegirCliente()

    agregar("Martillo de uña")
    regalar("Vidrio privado")
    elegirMotivo("cortesia_comercial")
    fireEvent.click(screen.getByRole("button", { name: "Quitar a Ferremax" }))
    elegirEfectivo()
    fireEvent.click(facturar())

    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Revisa las regalías" }))
    expect(llamadasA(falso, "registrar_venta_con_regalias")).toHaveLength(0)
  })

  it("la vista previa ya muestra las regalías sin cargo", async () => {
    await renderPOS()
    await elegirCliente()

    agregar("Martillo de uña")
    regalar("Vidrio privado")
    elegirMotivo("compra_volumen")
    elegirEfectivo()
    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }))

    const factura = await screen.findByLabelText("Regalías y cortesías")
    expect(within(factura).getByText("Vidrio privado")).toBeInTheDocument()
    expect(within(factura).getByText("SIN CARGO")).toBeInTheDocument()
  })

  it("25. sin respuesta del servidor solo ofrece reintentar: no la guarda sin conexión dejando fuera las regalías", async () => {
    const { falso } = await renderPOS({ fallarEn: { registrar_venta_con_regalias: { rpc: { message: "Failed to fetch" } } } })
    await elegirCliente()

    agregar("Martillo de uña")
    regalar("Vidrio privado")
    elegirMotivo("cortesia_comercial")
    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "No hubo respuesta del servidor" })))
    const dialogo = Swal.fire.mock.calls.find(([o]) => o.title === "No hubo respuesta del servidor")[0]

    expect(dialogo).toMatchObject({ confirmButtonText: "Reintentar" })
    expect(dialogo.showDenyButton).toBeFalsy()
    expect(falso.datos.ventas).toHaveLength(0)
  })
})
