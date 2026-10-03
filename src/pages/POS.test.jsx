import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import SalesProvider from "../context/SalesContext"
import { renderizarPantalla } from "../test/pantallas"
import {
  CAMPOS_DEL_CLIENTE,
  abrirClienteNuevo as abrirAltaDeCliente,
  agregarProducto as agregar,
  filasDelCarrito,
  guardarCliente,
  llenarAltaDeCliente,
  modalDeCliente,
  paso,
  quitarDelCarrito,
} from "../test/carrito"
import POS from "./POS"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 2, minStock: 1 },
]

const CLIENTES = [
  { id: "c1", name: "Ferremax", rtn: "0801199912345", phone: "9999-0000", address: "SPS", email: "" },
]

/*
  Desde INV-3.3 la venta descuenta de la ubicación operativa del usuario.
  Por omisión la bodega tiene lo mismo que el catálogo; un caso puede
  dejarle menos para ver el rechazo del servidor.
*/
const existenciasEnBodega = (cambios = {}) =>
  PRODUCTOS.map((p) => ({
    locationId: "bodega",
    productId: p.id,
    quantity: cambios[p.id] ?? p.stock,
  }))

function renderPOS({ saleDraft = null, existencias = existenciasEnBodega() } = {}) {
  const entrada = saleDraft
    ? [{ pathname: "/pos", state: { saleDraft } }]
    : ["/pos"]

  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <SalesProvider>
            <MemoryRouter initialEntries={entrada}>
              <POS />
            </MemoryRouter>
          </SalesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      clientes: CLIENTES,
      ubicaciones: [{ id: "bodega", name: "Lunacell Bodega", type: "bodega" }],
      existencias,
      ubicacionOperativa: "bodega",
      esperar: ["ventas"],
    }
  )
}

/*
  Un borrador llega desde una cotización ya armada y entra al carrito sin
  pasar por el catálogo, así que sus cantidades pueden no corresponderse
  con lo que hay hoy. Es la única forma real de llegar a la validación
  previa a facturar con el carrito ya excedido.
*/
const borradorDeCotizacion = (cantidad) => ({
  quoteId: "q1",
  quoteNumber: "COT-00001",
  clientId: null,
  clientName: "",
  rtn: "",
  cart: [
    {
      id: "p2",
      code: "C-001",
      name: "Cemento gris",
      category: "Construcción",
      price: 250,
      quantity: cantidad,
    },
  ],
})

const totales = () => screen.getByText("Total").closest("div").parentElement

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), {
    target: { value: texto },
  })

const abrirClienteNuevo = () => abrirAltaDeCliente(/nombre/i)

const quitar = quitarDelCarrito


describe("POS: catálogo", () => {
  it("lista los productos disponibles", async () => {
    await renderPOS()

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
  })

  it("filtra por nombre", async () => {
    await renderPOS()
    buscar("martillo")

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.queryByText("Cemento gris")).not.toBeInTheDocument()
  })

  it("filtra por código", async () => {
    await renderPOS()
    buscar("C-001")

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })
})

describe("POS: carrito", () => {
  it("arranca con el total en cero", async () => {
    await renderPOS()
    expect(screen.getAllByText("L 0.00").length).toBeGreaterThan(0)
  })

  it("agrega un producto y calcula el total con impuesto", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 27.00")
    expect(totales()).toHaveTextContent("L 207.00")
  })

  it("descuenta del disponible lo que ya está en el carrito", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    expect(screen.getByText(/9 disp/i)).toBeInTheDocument()
  })

  it("acumula al agregar el mismo producto dos veces", async () => {
    await renderPOS()
    agregar("Martillo de uña")
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 414.00")
  })

  it("sube la cantidad desde el carrito", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    paso("Martillo de uña", "+")

    expect(totales()).toHaveTextContent("L 414.00")
  })

  it("baja la cantidad desde el carrito", async () => {
    await renderPOS()
    agregar("Martillo de uña")
    paso("Martillo de uña", "+")

    paso("Martillo de uña", "−")

    expect(totales()).toHaveTextContent("L 207.00")
  })

  /*
    El tope es la existencia del producto. Sin esto se podría facturar
    mercadería que no está, y la venta fallaría recién al guardarse.
  */
  it("no deja subir la cantidad por encima de la existencia", async () => {
    await renderPOS()
    agregar("Cemento gris")
    paso("Cemento gris", "+")

    paso("Cemento gris", "+")

    expect(totales()).toHaveTextContent("L 575.00")
  })

  it("quita un producto del carrito", async () => {
    await renderPOS()
    agregar("Martillo de uña")

    quitar("Martillo de uña")

    expect(filasDelCarrito()).toHaveLength(0)
    expect(totales()).toHaveTextContent("L 0.00")
  })
})

describe("POS: alta de cliente", () => {
  it("abre el formulario de cliente nuevo", async () => {
    await renderPOS()

    abrirClienteNuevo()

    expect(
      screen.getByRole("heading", { name: /nuevo cliente/i })
    ).toBeInTheDocument()
  })

  it("el formulario pide nombre, RTN, teléfono, correo y dirección", async () => {
    await renderPOS()

    abrirClienteNuevo()

    const modal = modalDeCliente()

    CAMPOS_DEL_CLIENTE.forEach((campo) =>
      expect(modal.getByLabelText(campo)).toBeInTheDocument()
    )
  })

  it("arrastra al formulario lo que ya se había escrito", async () => {
    await renderPOS()

    fireEvent.change(screen.getByPlaceholderText(/nombre/i), {
      target: { value: "Taller Nuevo" },
    })
    abrirClienteNuevo()

    expect(modalDeCliente().getByLabelText(/^nombre$/i)).toHaveValue("Taller Nuevo")
  })

  it("exige nombre, teléfono y dirección", async () => {
    const { falso } = await renderPOS()

    abrirClienteNuevo()
    guardarCliente()

    expect(falso.datos.clientes).toHaveLength(1)
  })

  /*
    addClient es asíncrona: devuelve el cliente ya creado, con el
    identificador que le asignó la base. Antes no se esperaba y lo que
    quedaba seleccionado era la promesa, así que el RTN del comprador
    —que cuelga del cliente elegido— se quedaba vacío.
  */
  it("deja seleccionado el cliente que devolvió la base", async () => {
    await renderPOS()

    abrirClienteNuevo()
    llenarAltaDeCliente()
    guardarCliente()

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/nombre/i)).toHaveValue("Taller Nuevo")
    )
  })

  it("hereda el RTN del cliente recién creado", async () => {
    await renderPOS()

    abrirClienteNuevo()
    llenarAltaDeCliente()
    guardarCliente()

    await waitFor(() =>
      expect(screen.getByLabelText(/rtn del comprador/i)).toHaveValue(
        "0801199912345"
      )
    )
  })

  it("guarda el cliente una sola vez", async () => {
    const { falso } = await renderPOS()

    abrirClienteNuevo()
    llenarAltaDeCliente()
    guardarCliente()

    await waitFor(() => expect(falso.datos.clientes).toHaveLength(2))
  })
})

describe("POS: venta a crédito con un cliente recién creado", () => {
  /*
    El caso que el defecto rompía de verdad. Con la promesa seleccionada,
    clientId salía undefined, viajaba como null y la restricción
    credito_exige_cliente rechazaba la venta ya en la base.
  */
  it("emite la factura con el identificador real del cliente", async () => {
    // Arrange
    const { falso } = await renderPOS()

    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))

    abrirClienteNuevo()
    llenarAltaDeCliente({ nombre: "Constructora Nueva" })
    guardarCliente()

    await waitFor(() => expect(falso.datos.clientes).toHaveLength(2))

    const creado = falso.datos.clientes.find(
      (c) => c.nombre === "Constructora Nueva"
    )

    agregar("Martillo de uña")

    // Act
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

    // Assert
    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    const venta = falso.datos.ventas[0]

    expect(venta.forma_pago).toBe("credito")
    expect(venta.cliente_id).toBe(creado.id)
    expect(venta.cliente_id).toBeTruthy()
  })
})

describe("POS: forma de pago", () => {
  it("arranca en contado", async () => {
    await renderPOS()

    const contado = screen.getByRole("button", { name: /contado/i })

    expect(contado).toBeInTheDocument()
  })

  it("al elegir crédito pide fecha de vencimiento", async () => {
    await renderPOS()

    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))

    expect(screen.getByText(/fecha.*(pago|vencimiento)/i)).toBeInTheDocument()
  })
})

describe("POS: cliente", () => {
  it("permite escribir el nombre del comprador", async () => {
    await renderPOS()

    const campo = screen.getByPlaceholderText(/nombre/i)

    fireEvent.change(campo, { target: { value: "Ferremax" } })

    expect(campo).toHaveValue("Ferremax")
  })

  it("ofrece capturar el RTN del comprador", async () => {
    await renderPOS()
    expect(screen.getByText(/RTN del comprador/i)).toBeInTheDocument()
  })
})

/*
  La última comprobación de existencias antes de emitir. Es distinta de la
  del carrito: aquí las cantidades ya están puestas y lo que se revisa es
  si siguen siendo servibles contra el catálogo actual.
*/
describe("POS: validación previa a facturar", () => {
  const verVistaPrevia = () =>
    fireEvent.click(screen.getByRole("button", { name: /vista previa/i }))

  const avisoDeExistencias = () =>
    Swal.fire.mock.calls.find(
      ([opciones]) => opciones?.title === "Stock insuficiente"
    )

  it("no deja continuar si el carrito pide más de lo que hay", async () => {
    // Arrange: la cotización pedía 5 y del cemento solo quedan 2
    await renderPOS({ saleDraft: borradorDeCotizacion(5) })
    Swal.fire.mockClear()

    // Act
    verVistaPrevia()

    // Assert
    await waitFor(() => expect(avisoDeExistencias()).toBeTruthy())
    expect(
      screen.queryByText(/vista previa de factura/i)
    ).not.toBeInTheDocument()
  })

  it("dice cuántas unidades quedan de verdad", async () => {
    await renderPOS({ saleDraft: borradorDeCotizacion(5) })
    Swal.fire.mockClear()

    verVistaPrevia()

    await waitFor(() => expect(avisoDeExistencias()).toBeTruthy())
    expect(avisoDeExistencias()[0].text).toContain("solo tiene 2 unidades")
  })

  it("deja continuar cuando la existencia alcanza", async () => {
    await renderPOS({ saleDraft: borradorDeCotizacion(2) })
    Swal.fire.mockClear()

    verVistaPrevia()

    await waitFor(() =>
      expect(screen.getByText(/vista previa de factura/i)).toBeInTheDocument()
    )
    expect(avisoDeExistencias()).toBeUndefined()
  })
})

/*
  El catálogo todavía muestra el stock global, pero quien decide es la
  existencia de la ubicación que vende. Si el servidor rechaza, el cajero
  ve el motivo tal cual —cuánto hay y dónde— y no se emite nada.
*/
describe("POS: venta registrada por el servidor", () => {
  const generarFactura = () =>
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

  const avisoDeError = () =>
    Swal.fire.mock.calls.find(([opciones]) => opciones?.icon === "error")

  it("emite la factura con el número que devuelve el servidor", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    generarFactura()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    expect(falso.datos.ventas[0].numero_factura).toMatch(/^VTA-\d{6}$/)
    expect(falso.datos.ventas[0].ubicacion_id).toBe("bodega")
  })

  it("si la ubicación no alcanza, muestra el motivo del servidor y no emite", async () => {
    const { falso } = await renderPOS({ existencias: existenciasEnBodega({ p1: 0 }) })
    Swal.fire.mockClear()

    agregar("Martillo de uña")
    generarFactura()

    await waitFor(() => expect(avisoDeError()).toBeTruthy())

    expect(avisoDeError()[0].text).toMatch(/no hay suficiente «martillo de uña» en lunacell bodega/i)
    expect(falso.datos.ventas).toHaveLength(0)
  })
})
