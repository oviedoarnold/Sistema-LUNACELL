import { describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react"
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

// Tipo tienda: es la que nace con la casilla de ISV marcada.
const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "tienda" }
const CAMION_01 = { id: "camion-01", name: "Camión 01", type: "camion" }

function renderPOS({
  saleDraft = null,
  productos = PRODUCTOS,
  existencias = existenciasEnBodega(),
  ubicaciones = [BODEGA],
  ubicacionOperativa = "bodega",
  fallarEn = {},
  rolDelUsuario = "admin",
  permisosDelUsuario = [],
} = {}) {
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
      productos,
      clientes: CLIENTES,
      ubicaciones,
      existencias,
      ubicacionOperativa,
      fallarEn,
      rolDelUsuario,
      permisosDelUsuario,
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

const totales = () => document.querySelector(".totals")

// A crédito no hay selector: se cobra con los abonos.
const elegirEfectivo = () => {
  const opcion = screen.queryByRole("radio", { name: "Efectivo" })

  if (opcion) fireEvent.click(opcion)
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), {
    target: { value: texto },
  })

const abrirClienteNuevo = () => abrirAltaDeCliente(/nombre/i)

const quitar = quitarDelCarrito


describe("POS: artículos facturados", () => {
  const numeros = () => [...document.querySelectorAll(".pos-linea-numero")].map((n) => n.textContent)

  const cuenta = () => document.querySelector(".pos-articulos-cuenta")

  it("con el carrito vacío no numera nada y cuenta cero", async () => {
    await renderPOS()

    expect(numeros()).toEqual([])
    expect(cuenta()).toHaveTextContent("0 productos · 0 unidades")
  })

  it("numera desde 1 al agregar, y renumera al eliminar", async () => {
    await renderPOS()

    agregar("Martillo de uña")

    expect(numeros()).toEqual(["1."])
    expect(cuenta()).toHaveTextContent("1 producto · 1 unidad")

    agregar("Cemento gris")

    expect(numeros()).toEqual(["1.", "2."])
    expect(cuenta()).toHaveTextContent("2 productos · 2 unidades")

    quitar("Martillo de uña")

    expect(numeros()).toEqual(["1."])
    expect(document.querySelector(".cart-row")).toHaveTextContent("1.Cemento gris")
    expect(cuenta()).toHaveTextContent("1 producto · 1 unidad")
  })

  it("una línea con varias unidades es un producto: no confunde las dos cifras", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: /agregar una unidad de martillo/i }))

    expect(numeros()).toEqual(["1."])
    expect(cuenta()).toHaveTextContent("1 producto · 2 unidades")
  })

  it("la línea muestra nombre, precio, cantidad, subtotal y eliminar", async () => {
    await renderPOS()

    agregar("Martillo de uña")

    const fila = document.querySelector(".cart-row")

    expect(fila).toHaveTextContent("Martillo de uña")
    expect(within(fila).getByLabelText("Precio de Martillo de uña")).toHaveValue("180.00")
    expect(within(fila).getByText("1")).toBeInTheDocument()
    expect(fila.querySelector(".sub")).toHaveTextContent("L 180.00")
    expect(within(fila).getByTitle(/eliminar/i)).toBeInTheDocument()
  })

  it("la numeración es solo visual: no llega a lo que se envía", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    agregar("Cemento gris")
    elegirEfectivo()
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    const [, argumentos] = falso.rpc.mock.calls.find(([nombre]) => nombre === "registrar_venta_con_medios")

    expect(JSON.stringify(argumentos)).not.toMatch(/numero|linea/i)
  })
})

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

describe("POS: precios por cliente", () => {
  const PRECIOS = [
    { id: "e1", empresa_id: "e-1", cliente_id: "c1", producto_id: "p2", precio: 200 },
    { id: "e2", empresa_id: "e-1", cliente_id: "c2", producto_id: "p2", precio: 225 },
  ]

  const OTRO_CLIENTE = { id: "c2", name: "Taller Díaz", rtn: "", phone: "8888-1111", address: "Choloma", email: "" }

  const elegirCliente = async (nombre) => {
    fireEvent.focus(screen.getByPlaceholderText(/nombre/i))
    fireEvent.click(screen.getByText(nombre))
    await waitFor(() => expect(document.querySelector(".pos-aviso-precios.is-error")).toBeNull())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const renderConPrecios = async () => {
    const r = await renderPOS({ clientes: [...CLIENTES, OTRO_CLIENTE] })

    r.falso.datos.precios_por_cliente = PRECIOS.map((p) => ({ ...p }))

    return r
  }

  const filaDeCatalogo = (nombre) => screen.getAllByText(nombre)[0].closest(".picker-item")
  const nombresDelCatalogo = () => [...document.querySelectorAll(".picker-item strong")].map((n) => n.textContent)
  const facturar = () => screen.getByRole("button", { name: /generar factura/i })

  it("sin cliente registrado usa los precios generales, sin marcas", async () => {
    await renderConPrecios()

    expect(within(filaDeCatalogo("Cemento gris")).getByText("L 250.00")).toBeInTheDocument()
    expect(screen.queryByText(/precio especial/i)).not.toBeInTheDocument()
  })

  it("al elegir un cliente, sus habituales van primero con su precio, sin agregar nada al carrito", async () => {
    await renderConPrecios()
    await elegirCliente("Ferremax")

    expect(nombresDelCatalogo()[0]).toBe("Cemento gris")
    expect(filaDeCatalogo("Cemento gris")).toHaveTextContent("L 200.00")
    expect(filaDeCatalogo("Cemento gris")).toHaveTextContent(/precio especial/i)
    expect(filaDeCatalogo("Martillo de uña")).toHaveTextContent("L 180.00")
    expect(filaDeCatalogo("Martillo de uña")).not.toHaveTextContent(/precio especial/i)
    expect(filasDelCarrito()).toHaveLength(0)
  })

  it("aplica el precio al agregar, y la venta sale con ese precio", async () => {
    const { falso } = await renderConPrecios()

    await elegirCliente("Ferremax")
    agregar("Cemento gris")

    expect(within(filasDelCarrito()[0]).getByLabelText("Precio de Cemento gris")).toHaveValue("200.00")
    expect(filasDelCarrito()[0]).toHaveTextContent(/precio especial/i)
    expect(totales()).toHaveTextContent("L 230.00")

    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(falso.datos.ventas[0]).toMatchObject({ subtotal: 200, total: 230, cliente_id: "c1" })
    expect(falso.datos.detalle_venta[0]).toMatchObject({ precio: 200 })
  })

  it("un cliente sin precios usa el general, y un producto fuera de la lista también", async () => {
    await renderConPrecios()
    await elegirCliente("Ferremax")
    agregar("Martillo de uña")

    expect(within(filasDelCarrito()[0]).getByLabelText("Precio de Martillo de uña")).toHaveValue("180.00")
    expect(filasDelCarrito()[0]).not.toHaveTextContent(/precio especial/i)
  })

  it("al cambiar de cliente recalcula, avisa y actualiza totales", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    expect(totales()).toHaveTextContent("L 287.50")
    expect(screen.queryByText(/precios actualizados/i)).not.toBeInTheDocument()

    await elegirCliente("Ferremax")

    expect(totales()).toHaveTextContent("L 230.00")
    expect(screen.getByText("Precios actualizados para Ferremax.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Quitar a Ferremax" }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(totales()).toHaveTextContent("L 287.50")
    expect(screen.getByText(/se usan los precios generales/i)).toBeInTheDocument()
    expect(filasDelCarrito()).toHaveLength(1)
  })

  it("el cargo del 7 % y el ISV se calculan sobre el precio especial", async () => {
    await renderConPrecios()
    await elegirCliente("Ferremax")
    agregar("Cemento gris")
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }))

    expect(totales().querySelector(".grand")).toHaveTextContent("L 246.10")

    fireEvent.click(screen.getByRole("checkbox", { name: /isv/i }))

    expect(totales().querySelector(".grand")).toHaveTextContent("L 214.00")
  })

  it("si no se pudieron leer los precios, no deja facturar y lo dice", async () => {
    const { falso } = await renderConPrecios()

    falso.datos.precios_por_cliente = null
    falso.from.mockImplementationOnce(() => {
      throw new Error("sin red")
    })

    fireEvent.focus(screen.getByPlaceholderText(/nombre/i))
    fireEvent.click(screen.getByText("Ferremax"))

    expect(await screen.findByText(/no se pudieron cargar los precios/i)).toBeInTheDocument()

    agregar("Cemento gris")
    elegirEfectivo()

    expect(facturar()).toBeDisabled()
  })
})

describe("POS: precio negociado", () => {
  const PRECIOS = [{ id: "e1", empresa_id: "e-1", cliente_id: "c1", producto_id: "p2", precio: 200 }]
  const OTRO = { id: "c2", name: "Taller Díaz", rtn: "", phone: "8888-1111", address: "Choloma", email: "" }

  const renderConPrecios = async (opciones = {}) => {
    const r = await renderPOS({ clientes: [...CLIENTES, OTRO], ...opciones })

    r.falso.datos.precios_por_cliente = PRECIOS.map((p) => ({ ...p }))

    return r
  }

  const elegirCliente = async (nombre) => {
    fireEvent.focus(screen.getByPlaceholderText(/nombre/i))
    fireEvent.click(screen.getByText(nombre))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const fila = () => filasDelCarrito()[0]
  const facturar = () => screen.getByRole("button", { name: /generar factura/i })
  const campo = (producto = "Cemento gris") => screen.getByLabelText(`Precio de ${producto}`)
  const motivo = (producto = "Cemento gris") => screen.queryByLabelText(`Motivo del precio de ${producto}`)

  // Como lo hace el vendedor: entra al campo, borra, escribe y sale.
  const escribir = (producto, valor) => {
    fireEvent.focus(campo(producto))
    fireEvent.change(campo(producto), { target: { value: String(valor) } })
  }

  const negociar = (producto, precio, motivoElegido) => {
    escribir(producto, precio)
    fireEvent.blur(campo(producto))

    if (motivoElegido) fireEvent.change(motivo(producto), { target: { value: motivoElegido } })
  }

  it("el precio de cada línea es un campo editable con el precio vigente", async () => {
    await renderConPrecios()

    agregar("Cemento gris")

    expect(campo()).toHaveAttribute("type", "text")
    expect(campo()).toHaveAttribute("inputmode", "decimal")
    expect(campo()).toHaveValue("250.00")
    expect(screen.queryByRole("button", { name: /modificar precio/i })).not.toBeInTheDocument()
  })

  it("cambia L 180 por L 100 escribiendo en el campo, y recalcula subtotal, ISV y total", async () => {
    await renderConPrecios()

    agregar("Martillo de uña")
    expect(campo("Martillo de uña")).toHaveValue("180.00")

    negociar("Martillo de uña", 100, "mayoreo")

    expect(campo("Martillo de uña")).toHaveValue("100.00")
    expect(fila()).toHaveTextContent("Precio negociado · antes L 180.00")
    expect(fila().querySelector(".sub")).toHaveTextContent("L 100.00")
    expect(totales()).toHaveTextContent("L 15.00")
    expect(totales()).toHaveTextContent("L 115.00")
  })

  it("recalcula mientras se escribe, sin aplicar ni abrir nada", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    escribir("Cemento gris", "300")

    expect(totales()).toHaveTextContent("L 345.00")
    expect(document.querySelector(".modal, [role=dialog]")).toBeNull()
  })

  it("envía el precio y el motivo, y la factura sale con lo negociado", async () => {
    const { falso } = await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    const llamada = falso.rpc.mock.calls.find(([n]) => n === "registrar_venta_con_medios")

    expect(llamada[1].p_items).toEqual([
      { producto_id: "p2", cantidad: 1, precio_negociado: 180, motivo_negociacion: "mayoreo" },
    ])
    expect(falso.datos.ventas[0]).toMatchObject({ subtotal: 180, total: 207 })
    expect(falso.datos.detalle_venta[0]).toMatchObject({ precio: 180, precio_referencia: 250 })
    expect(falso.datos.productos.find((p) => p.id === "p2").precio).toBe(250)
  })

  it("dos productos con precios distintos negociados", async () => {
    const { falso } = await renderConPrecios()

    agregar("Cemento gris")
    agregar("Martillo de uña")
    negociar("Cemento gris", 180, "mayoreo")
    negociar("Martillo de uña", 200)
    elegirEfectivo()

    expect(totales()).toHaveTextContent("L 437.00")

    fireEvent.click(facturar())
    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    const { p_items: items } = falso.rpc.mock.calls.find(([n]) => n === "registrar_venta_con_medios")[1]

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ producto_id: "p2", precio_negociado: 180, motivo_negociacion: "mayoreo" }),
        expect.objectContaining({ producto_id: "p1", precio_negociado: 200, motivo_negociacion: null }),
      ])
    )
  })

  it("a crédito con ISV también va por el flujo autorizado", async () => {
    const { falso } = await renderConPrecios()

    await elegirCliente("Ferremax")
    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))
    await elegirCliente("Ferremax")
    agregar("Cemento gris")
    negociar("Cemento gris", 150, "cliente_frecuente")
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    expect(falso.rpc.mock.calls.some(([n]) => n === "registrar_venta_ubicacion")).toBe(false)
    expect(falso.datos.ventas[0]).toMatchObject({ forma_pago: "credito", total: 172.5 })
  })

  it("sobre un precio especial: la referencia es el especial, y restaurar vuelve a él", async () => {
    await renderConPrecios()
    await elegirCliente("Ferremax")
    agregar("Cemento gris")
    expect(campo()).toHaveValue("200.00")

    negociar("Cemento gris", 180, "promocion")

    expect(fila()).toHaveTextContent("antes L 200.00")
    expect(fila()).not.toHaveTextContent("Precio especial")
    expect(totales()).toHaveTextContent("L 207.00")

    fireEvent.click(screen.getByRole("button", { name: "Restaurar el precio de Cemento gris" }))

    expect(campo()).toHaveValue("200.00")
    expect(fila()).toHaveTextContent("Precio especial")
    expect(fila()).not.toHaveTextContent("Precio negociado")
    expect(totales()).toHaveTextContent("L 230.00")
  })

  it("escribir de nuevo el precio de referencia deja la línea sin negociación", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    negociar("Cemento gris", "250")

    expect(fila()).not.toHaveTextContent("Precio negociado")
    expect(campo()).toHaveValue("250.00")
  })

  it("cambiar la cantidad antes y después conserva el precio negociado", async () => {
    await renderConPrecios()

    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Martillo de uña" }))
    negociar("Martillo de uña", 150, "mayoreo")

    expect(totales()).toHaveTextContent("L 345.00")

    fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Martillo de uña" }))

    expect(campo("Martillo de uña")).toHaveValue("150.00")
    expect(fila().querySelector(".sub")).toHaveTextContent("L 450.00")
    expect(totales()).toHaveTextContent("L 517.50")
  })

  it("cambiar de cliente conserva lo negociado, actualiza la referencia y avisa", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 150, "mayoreo")
    expect(fila()).toHaveTextContent("antes L 250.00")

    await elegirCliente("Ferremax")

    expect(campo()).toHaveValue("150.00")
    expect(fila()).toHaveTextContent("antes L 200.00")
    expect(screen.getByText("Precios actualizados para Ferremax. Se conservan los precios negociados.")).toBeInTheDocument()
    expect(totales()).toHaveTextContent("L 172.50")
  })

  it("negociar por sí solo no muestra el aviso de precios actualizados", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")

    expect(screen.queryByText(/precios actualizados/i)).not.toBeInTheDocument()
  })

  it("el ISV y el cargo del 7 % se calculan sobre lo negociado", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }))

    expect(totales().querySelector(".grand")).toHaveTextContent("L 221.49")

    fireEvent.click(screen.getByRole("checkbox", { name: /isv/i }))

    expect(totales().querySelector(".grand")).toHaveTextContent("L 192.60")
  })

  it("en pago mixto reparte el total negociado", async () => {
    const { falso } = await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    fireEvent.click(screen.getByRole("radio", { name: "Pago mixto" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Efectivo" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Transferencia" }))
    fireEvent.change(screen.getByLabelText(/importe.*efectivo|efectivo/i, { selector: "input[type=number],input[inputmode=decimal]" }), { target: { value: "100" } })

    await waitFor(() => expect(facturar()).toBeEnabled())
    fireEvent.click(facturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))

    const { p_cobros: cobros } = falso.rpc.mock.calls.find(([n]) => n === "registrar_venta_con_medios")[1]

    expect(cobros.reduce((s, c) => s + c.monto, 0)).toBe(207)
  })

  it.each([
    ["cero", "0"],
    ["negativo", "-5"],
    ["vacío", ""],
    ["con tres decimales", "10.123"],
    ["que no es un número", "abc"],
  ])("no acepta un precio %s ni deja facturar", async (_, valor) => {
    await renderConPrecios()

    agregar("Cemento gris")
    elegirEfectivo()
    negociar("Cemento gris", valor)

    expect(screen.getByRole("alert")).toHaveTextContent(/mayor que cero/i)
    expect(campo()).toHaveAttribute("aria-invalid", "true")
    expect(fila()).not.toHaveTextContent("Precio negociado")
    expect(totales()).toHaveTextContent("L 287.50")
    expect(facturar()).toBeDisabled()
    expect(screen.getByRole("button", { name: "Vista previa" })).toBeDisabled()
  })

  it("bajar el precio pide motivo junto a la línea y no deja facturar hasta elegirlo; subirlo, no", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    elegirEfectivo()

    expect(motivo()).not.toBeInTheDocument()

    negociar("Cemento gris", 180)

    expect(motivo()).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/motivo/i)
    expect(facturar()).toBeDisabled()

    fireEvent.change(motivo(), { target: { value: "mayoreo" } })

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(facturar()).toBeEnabled()

    negociar("Cemento gris", 300)

    expect(motivo()).not.toBeInTheDocument()
    expect(fila()).toHaveTextContent("Precio negociado")
    expect(facturar()).toBeEnabled()
  })

  it("se puede volver a cambiar el importe las veces que haga falta", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 300)
    negociar("Cemento gris", 280)
    negociar("Cemento gris", 200, "otro")

    expect(campo()).toHaveValue("200.00")
    expect(totales()).toHaveTextContent("L 230.00")
  })

  it("quitar el producto descarta la negociación: al volver, usa su precio", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Cemento gris de la venta" }))
    agregar("Cemento gris")

    expect(campo()).toHaveValue("250.00")
    expect(fila()).not.toHaveTextContent("Precio negociado")
  })

  it("una venta nueva empieza sin negociaciones", async () => {
    const { falso } = await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    elegirEfectivo()
    fireEvent.click(facturar())
    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    await waitFor(() => expect(filasDelCarrito()).toHaveLength(0))

    agregar("Cemento gris")

    expect(campo()).toHaveValue("250.00")
  })

  it("el rechazo del servidor se muestra y no vacía la venta", async () => {
    await renderConPrecios({ fallarEn: { registrar_venta_con_medios: { rpc: { code: "LN001", message: "Bajar el precio necesita un motivo" } } } })

    agregar("Cemento gris")
    negociar("Cemento gris", 180, "mayoreo")
    elegirEfectivo()
    fireEvent.click(facturar())

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ text: "Bajar el precio necesita un motivo" }))
    )
    expect(fila()).toHaveTextContent("Precio negociado")
  })

  it("el vendedor con permiso de facturar puede escribir el precio", async () => {
    await renderConPrecios({ rolDelUsuario: "vendedor", permisosDelUsuario: ["pos"] })

    agregar("Cemento gris")

    expect(campo()).toBeInTheDocument()
  })

  it("el contador ve el precio, pero no un campo para cambiarlo", async () => {
    await renderConPrecios({ rolDelUsuario: "contador", permisosDelUsuario: ["pos"] })

    agregar("Cemento gris")

    expect(screen.queryByLabelText("Precio de Cemento gris")).not.toBeInTheDocument()
    expect(fila()).toHaveTextContent(/L 250.00 c\/u/)
  })

  it("no muestra costos", async () => {
    await renderConPrecios()

    agregar("Cemento gris")
    negociar("Cemento gris", 180)

    expect(document.querySelector(".cart-card").textContent).not.toMatch(/costo|margen|utilidad/i)
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

    // Facturar espera a que lleguen los precios del cliente recién creado.
    await waitFor(() => expect(screen.getByRole("button", { name: /generar factura/i })).toBeEnabled())

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
  const generarFactura = () => {
    elegirEfectivo()
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))
  }

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

  const rpcDeVenta = (falso) => falso.rpc.mock.calls.find(([nombre]) => nombre === "registrar_venta_con_medios")

  const unico = (nombre) => fireEvent.click(screen.getByRole("radio", { name: nombre }))

  const mixto = () => fireEvent.click(screen.getByRole("radio", { name: "Pago mixto" }))

  const marcar = (nombre) => fireEvent.click(screen.getByRole("checkbox", { name: nombre }))

  const importe = (nombre, valor) => fireEvent.change(screen.getByLabelText(`Importe de ${nombre}`), { target: { value: valor } })

  const referencia = (nombre, valor) => fireEvent.change(screen.getByLabelText(new RegExp(`^Referencia de ${nombre}`)), { target: { value: valor } })

  const botonFacturar = () => screen.getByRole("button", { name: /generar factura/i })

  const clicFacturar = () => fireEvent.click(botonFacturar())

  it("sin elegir el medio de pago no se puede confirmar: nada viene preseleccionado", async () => {
    await renderPOS()

    agregar("Martillo de uña")

    expect(screen.getByRole("radio", { name: "Pago único" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked()
    expect(botonFacturar()).toBeDisabled()
    expect(screen.getByText("Elige el medio de pago.")).toBeInTheDocument()
  })

  it.each([
    ["Efectivo", "efectivo", ""],
    ["Transferencia", "transferencia", "TRF-1"],
    ["Tarjeta", "tarjeta", "AUT-1", 14.49],
    ["Enlace de pago", "enlace", "LNK-1", 14.49],
  ])("pago único con %s: manda el total, sin pedir importe", async (etiqueta, medio, ref, cargo) => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    unico(etiqueta)

    expect(screen.queryByLabelText(`Importe de ${etiqueta}`)).not.toBeInTheDocument()
    expect(totales().querySelector(".grand")).toHaveTextContent(`L ${(207 + (cargo || 0)).toFixed(2)}`)
    expect(screen.queryByText(/importe asignado|pendiente/i)).not.toBeInTheDocument()

    if (ref) {
      expect(botonFacturar()).toBeEnabled()
      referencia(etiqueta, ref)
    } else {
      expect(screen.queryByLabelText(/^referencia/i)).not.toBeInTheDocument()
    }

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio, monto: 207, referencia: ref, ...(cargo ? { cargo } : {}) }])
  })

  it("sin referencia la venta sale igual, sin inventar una", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    unico("Tarjeta")

    expect(screen.getByLabelText(/^Referencia de Tarjeta/)).toHaveValue("")
    expect(screen.getByLabelText(/^Referencia de Tarjeta/)).toHaveAttribute("placeholder", "Opcional")
    expect(botonFacturar()).toBeEnabled()

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio: "tarjeta", monto: 207, referencia: "", cargo: 14.49 }])
  })

  it("en pago mixto tampoco pide referencia", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Transferencia")
    marcar("Enlace de pago")
    importe("Transferencia", "100")
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: "transferencia", monto: 100, referencia: "" },
      { medio: "enlace", monto: 107, referencia: "", cargo: 7.49 },
    ])
  })

  it("en pago único, elegir otro medio reemplaza al anterior y borra su referencia", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    unico("Tarjeta")
    referencia("Tarjeta", "AUT-1")
    unico("Efectivo")

    expect(screen.getByRole("radio", { name: "Tarjeta" })).not.toBeChecked()
    expect(screen.queryByLabelText(/^Referencia de Tarjeta/)).not.toBeInTheDocument()

    unico("Tarjeta")

    expect(screen.getByLabelText(/^Referencia de Tarjeta/)).toHaveValue("")

    unico("Efectivo")
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio: "efectivo", monto: 207, referencia: "" }])
  })

  /* Las seis combinaciones posibles de dos medios entre cuatro. */
  it.each([
    ["Efectivo", "efectivo", "Transferencia", "transferencia"],
    ["Efectivo", "efectivo", "Tarjeta", "tarjeta"],
    ["Efectivo", "efectivo", "Enlace de pago", "enlace"],
    ["Transferencia", "transferencia", "Tarjeta", "tarjeta"],
    ["Transferencia", "transferencia", "Enlace de pago", "enlace"],
    ["Tarjeta", "tarjeta", "Enlace de pago", "enlace"],
  ])("pago mixto con %s y %s: manda los dos, con decimales exactos", async (etiquetaA, medioA, etiquetaB, medioB) => {
    const { falso } = await renderPOS()
    const refDe = (medio) => (medio === "efectivo" ? "" : `REF-${medio}`)
    const conCargo = (medio, cargo) => (medio === "tarjeta" || medio === "enlace" ? { cargo } : {})

    agregar("Martillo de uña")
    mixto()
    marcar(etiquetaA)
    marcar(etiquetaB)
    importe(etiquetaA, "100.10")
    importe(etiquetaB, "106.90")

    if (refDe(medioA)) referencia(etiquetaA, refDe(medioA))
    referencia(etiquetaB, refDe(medioB))

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: medioA, monto: 100.1, referencia: refDe(medioA), ...conCargo(medioA, 7.01) },
      { medio: medioB, monto: 106.9, referencia: refDe(medioB), ...conCargo(medioB, 7.48) },
    ])
  })

  it("en pago mixto un tercer medio queda bloqueado, y se libera al soltar uno", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")

    expect(screen.getByRole("checkbox", { name: "Transferencia" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Enlace de pago" })).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox", { name: "Transferencia" }))

    expect(screen.queryByLabelText("Importe de Transferencia")).not.toBeInTheDocument()

    marcar("Tarjeta")

    expect(screen.getByRole("checkbox", { name: "Transferencia" })).toBeEnabled()
  })

  it("un pago mixto no se confirma con un solo medio, y no pide importe todavía", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")

    expect(screen.queryByLabelText(/^Referencia de Efectivo/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Importe de Efectivo")).not.toBeInTheDocument()
    expect(screen.getByText("Elige 2 medios de pago.")).toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()
  })

  it.each([["Tarjeta"], ["Enlace de pago"]])("en pago mixto, elegir %s calcula el 7 %% sin escribir nada, igual que en pago único", async (medio) => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar(medio)

    expect(screen.queryByLabelText(`Importe de ${medio}`)).not.toBeInTheDocument()
    expect(screen.getByText(/cargo por medio de pago/i).nextSibling).toHaveTextContent("L 14.49")
    expect(totales().querySelector(".grand")).toHaveTextContent("L 221.49")
    expect(screen.queryByText(/importe asignado|pendiente/i)).not.toBeInTheDocument()
  })

  it("al elegir el segundo medio el primero conserva el total, y al escribir se reparte", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Tarjeta")
    marcar("Efectivo")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("207.00")
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("")
    expect(totales().querySelector(".grand")).toHaveTextContent("L 221.49")
    expect(botonFacturar()).toBeDisabled()

    importe("Efectivo", "107")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("100.00")
    expect(totales().querySelector(".grand")).toHaveTextContent("L 214.00")
    expect(botonFacturar()).toBeEnabled()

    marcar("Efectivo")

    expect(screen.queryByLabelText("Importe de Tarjeta")).not.toBeInTheDocument()
    expect(totales().querySelector(".grand")).toHaveTextContent("L 221.49")
  })

  it("un pago mixto exige importe positivo en los dos medios", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Transferencia")
    referencia("Transferencia", "TRF-1")
    importe("Efectivo", "207")

    // Efectivo lleva todo: la cuenta cuadra, pero Transferencia queda en cero.
    expect(screen.getByLabelText("Importe de Transferencia")).toHaveValue("0.00")
    expect(screen.getByText(/baja el otro importe/i)).toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()
  })

  it("en pago mixto basta un importe: el otro se calcula y la venta manda los dos", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Transferencia")

    expect(screen.getByText(/el otro se calcula solo/i)).toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()

    importe("Efectivo", "100")

    expect(screen.getByLabelText("Importe de Transferencia")).toHaveValue("107.00")

    expect(totales().querySelector(".grand")).toHaveTextContent("L 207.00")
    expect(botonFacturar()).toBeEnabled()

    referencia("Transferencia", "TRF-1")
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: "efectivo", monto: 100, referencia: "" },
      { medio: "transferencia", monto: 107, referencia: "TRF-1" },
    ])
  })

  it("escribir sobre el importe calculado cambia cuál se calcula", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "100")
    importe("Tarjeta", "7.50")

    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("199.50")
    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("7.50")
    expect(screen.getByLabelText("Importe de Efectivo").closest(".field")).toHaveClass("medios-de-pago-calculado")
    expect(screen.getByLabelText("Importe de Tarjeta").closest(".field")).not.toHaveClass("medios-de-pago-calculado")
  })

  it("no deja superar el total, ni pegando: el importe se ajusta y lo dice", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Tarjeta", "1,125.00")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("207.00")
    expect(screen.getByText(/se ajustó al total/i)).toBeInTheDocument()
  })

  it("el aviso del ajuste se queda si se sigue tecleando sobre el tope, y se va al corregir", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Tarjeta", "999")
    importe("Tarjeta", "207.009")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("207.00")
    expect(screen.getByText(/se ajustó al total/i)).toBeInTheDocument()

    importe("Tarjeta", "100")

    expect(screen.queryByText(/se ajustó al total/i)).not.toBeInTheDocument()
  })

  /*
    Sin esto, tocar un importe y teclear agrega los dígitos al final, el tope
    los corta y parece que el campo no responde. Se vio en un navegador real.
  */
  it("al entrar a un importe selecciona lo escrito, para que teclear lo reemplace", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "207.00")

    const campo = screen.getByLabelText("Importe de Efectivo")

    fireEvent.focus(campo)

    expect(campo.selectionStart).toBe(0)
    expect(campo.selectionEnd).toBe("207.00".length)
  })

  it("cambiar de modalidad limpia todo: nada oculto ni antiguo viaja", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "100")
    importe("Tarjeta", "107")
    referencia("Tarjeta", "AUT-VIEJA")

    unico("Pago único")

    expect(screen.queryByLabelText(/^importe de/i)).not.toBeInTheDocument()
    expect(screen.getByText("Elige el medio de pago.")).toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()

    unico("Tarjeta")

    expect(screen.getByLabelText(/^Referencia de Tarjeta/)).toHaveValue("")

    referencia("Tarjeta", "AUT-NUEVA")
    mixto()

    expect(screen.getByRole("checkbox", { name: "Tarjeta" })).not.toBeChecked()
    expect(botonFacturar()).toBeDisabled()

    unico("Pago único")
    unico("Efectivo")
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio: "efectivo", monto: 207, referencia: "" }])
  })

  it("al cambiar el total: el importe calculado lo sigue, y si el escrito se pasa bloquea hasta corregir", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    unico("Efectivo")
    agregar("Martillo de uña")

    // Dos martillos: 414.00. El único medio sigue al total.
    expect(totales().querySelector(".grand")).toHaveTextContent("L 414.00")
    expect(botonFacturar()).toBeEnabled()

    mixto()
    marcar("Efectivo")
    marcar("Transferencia")
    referencia("Transferencia", "TRF-1")
    importe("Efectivo", "114")

    expect(screen.getByLabelText("Importe de Transferencia")).toHaveValue("300.00")

    fireEvent.click(screen.getByRole("button", { name: /quitar una unidad de martillo/i }))

    // Bajó a 207.00: el calculado la sigue y sigue cuadrando.
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("114")
    expect(screen.getByLabelText("Importe de Transferencia")).toHaveValue("93.00")
    expect(botonFacturar()).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: /agregar una unidad de martillo/i }))
    importe("Efectivo", "300")
    fireEvent.click(screen.getByRole("button", { name: /quitar una unidad de martillo/i }))

    // El escrito no se cambia solo: si pasa del total, no se puede confirmar.
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("300")
    expect(screen.getByText(/el total bajó/i)).toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()

    importe("Efectivo", "100")

    expect(screen.getByLabelText("Importe de Transferencia")).toHaveValue("107.00")
    expect(botonFacturar()).toBeEnabled()
  })

  it("el total destacado sube con el cargo, y efectivo no lo lleva", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    unico("Efectivo")

    expect(totales().querySelector(".grand")).toHaveTextContent("L 207.00")
    expect(screen.queryByText(/cargo por medio de pago/i)).not.toBeInTheDocument()

    unico("Tarjeta")

    expect(screen.getByText(/cargo por medio de pago \(7%\)/i).nextSibling).toHaveTextContent("L 14.49")
    expect(totales().querySelector(".grand")).toHaveTextContent("L 221.49")
    expect(screen.getAllByText("Total")).toHaveLength(1)

    unico("Transferencia")

    expect(totales().querySelector(".grand")).toHaveTextContent("L 207.00")
  })

  it("en pago mixto el cargo solo va sobre la parte de la tarjeta", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    mixto()
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "107")

    expect(screen.getByText(/cargo por medio de pago/i).nextSibling).toHaveTextContent("L 7.00")
    expect(totales().querySelector(".grand")).toHaveTextContent("L 214.00")

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: "efectivo", monto: 107, referencia: "" },
      { medio: "tarjeta", monto: 100, referencia: "", cargo: 7 },
    ])
  })

  it("la casilla de ISV cambia el total enseguida, y la venta sale sin ISV", async () => {
    const { falso } = await renderPOS()
    const casilla = () => screen.getByRole("checkbox", { name: /isv/i })

    agregar("Martillo de uña")
    expect(casilla()).toBeChecked()
    expect(totales().querySelector(".grand")).toHaveTextContent("L 207.00")

    fireEvent.click(casilla())

    expect(totales().querySelector(".grand")).toHaveTextContent("L 180.00")

    unico("Tarjeta")

    expect(totales().querySelector(".grand")).toHaveTextContent("L 192.60")

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1]).toMatchObject({
      p_con_isv: false,
      p_cobros: [{ medio: "tarjeta", monto: 180, referencia: "", cargo: 12.6 }],
    })
    expect(falso.datos.ventas[0]).toMatchObject({ isv: 0, tasa_isv: 0, total: 180, cargo_por_medio: 12.6 })
  })

  it.each([
    ["una bodega", "bodega"],
    ["un camión", "camion"],
  ])("en %s la casilla de ISV nace desmarcada, y el vendedor puede marcarla", async (_, tipo) => {
    await renderPOS({ ubicaciones: [{ ...BODEGA, type: tipo }] })

    agregar("Martillo de uña")

    const casilla = await screen.findByRole("checkbox", { name: /isv/i })

    await waitFor(() => expect(casilla).not.toBeChecked())
    expect(totales().querySelector(".grand")).toHaveTextContent("L 180.00")

    fireEvent.click(casilla)

    expect(casilla).toBeChecked()
    expect(totales().querySelector(".grand")).toHaveTextContent("L 207.00")
  })

  it("una venta a crédito sin ISV también pasa por la función que lo retira", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("checkbox", { name: /isv/i }))
    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))

    expect(screen.getByRole("checkbox", { name: /isv/i })).not.toBeChecked()
    expect(rpcDeVenta(falso)).toBeUndefined()
  })

  it("el panel muestra un solo total: el cuadre no lo repite", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    unico("Efectivo")

    expect(screen.getAllByText("Total")).toHaveLength(1)
  })

  it("la vista previa tampoco confirma mientras los medios no cuadran", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: /vista previa/i }))

    const confirmar = await screen.findAllByRole("button", { name: /generar factura/i })

    for (const boton of confirmar) expect(boton).toBeDisabled()
  })

  it("a crédito no pide medio de pago y sigue por el camino de siempre", async () => {
    const { falso } = await renderPOS()

    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))

    expect(screen.queryByRole("radio", { name: "Efectivo" })).not.toBeInTheDocument()
    expect(rpcDeVenta(falso)).toBeUndefined()
  })

  /*
    La pantalla ya no deja agregar lo que la ubicación no tiene, así que el
    servidor solo rechaza si la existencia cambia entre la carga y el cobro:
    otra venta se llevó la última unidad. Su validación sigue mandando.
  */
  it("si la ubicación no alcanza, muestra el motivo del servidor y no emite", async () => {
    const { falso } = await renderPOS({ existencias: existenciasEnBodega({ p1: 1 }) })
    Swal.fire.mockClear()

    agregar("Martillo de uña")

    falso.datos.inventario_ubicacion = falso.datos.inventario_ubicacion.map((c) =>
      c.producto_id === "p1" ? { ...c, cantidad: 0 } : c
    )

    generarFactura()

    await waitFor(() => expect(avisoDeError()).toBeTruthy())

    expect(avisoDeError()[0].text).toMatch(/no hay suficiente «martillo de uña» en lunacell bodega/i)
    expect(falso.datos.ventas).toHaveLength(0)
  })
})

/*
  Cada ubicación vende lo suyo. El catálogo trae además un `stock` global
  (la suma de todo el libro de movimientos) que el punto de venta no debe
  usar para nada: aquí vale 10 en los dos productos y las pruebas ponen en
  la ubicación cantidades distintas para notar si se cuela.
*/
describe("POS: existencias de la ubicación operativa", () => {
  const filaDe = (nombre) => screen.getAllByText(nombre)[0].closest(".picker-item")
  const disponibleDe = (nombre) => within(filaDe(nombre)).getByText(/disp\./).textContent
  const botonAgregar = (nombre) => within(filaDe(nombre)).getAllByRole("button", { name: /agregar/i })[0]
  const botonFacturar = () => screen.getByRole("button", { name: /generar factura/i })

  const catalogoCon10 = PRODUCTOS.map((p) => ({ ...p, stock: 10 }))
  const celda = (locationId, productId, quantity) => ({ locationId, productId, quantity })

  it("Camión 01 con 0 y la bodega con 10: muestra 0 disponibles y no deja agregar", async () => {
    await renderPOS({
      productos: catalogoCon10,
      ubicaciones: [BODEGA, CAMION_01],
      existencias: [celda("bodega", "p1", 10), celda("bodega", "p2", 10)],
      ubicacionOperativa: "camion-01",
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["pos", "inventory-own"],
    })

    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("0 disp."))
    expect(disponibleDe("Cemento gris")).toBe("0 disp.")
    expect(botonAgregar("Martillo de uña")).toBeDisabled()
    expect(botonAgregar("Cemento gris")).toBeDisabled()
  })

  it("el administrador de la bodega ve solo lo de la bodega, no el total ni lo de un camión", async () => {
    await renderPOS({
      productos: catalogoCon10,
      ubicaciones: [BODEGA, CAMION_01],
      existencias: [celda("bodega", "p1", 3), celda("camion-01", "p1", 7), celda("bodega", "p2", 2)],
    })

    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("3 disp."))
    expect(disponibleDe("Cemento gris")).toBe("2 disp.")
  })

  it("después de un traslado, cada ubicación ve su propia cantidad", async () => {
    // Se trasladaron 4 martillos de la bodega (tenía 10) al Camión 01.
    const trasLaEntrega = [celda("bodega", "p1", 6), celda("camion-01", "p1", 4)]

    await renderPOS({ ubicaciones: [BODEGA, CAMION_01], existencias: trasLaEntrega, ubicacionOperativa: "camion-01" })
    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("4 disp."))
    cleanup()

    await renderPOS({ ubicaciones: [BODEGA, CAMION_01], existencias: trasLaEntrega, ubicacionOperativa: "bodega" })
    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("6 disp."))
  })

  it("si no se pudo cargar la existencia, lo dice, no muestra el total global y no deja facturar", async () => {
    await renderPOS({
      saleDraft: borradorDeCotizacion(1),
      productos: catalogoCon10,
      fallarEn: { existencias_por_ubicacion: { message: "sin red" } },
    })

    expect(await screen.findByText(/no se pudo cargar la existencia/i)).toBeInTheDocument()
    expect(disponibleDe("Martillo de uña")).toBe("0 disp.")
    expect(screen.queryByText("10 disp.")).not.toBeInTheDocument()
    expect(botonFacturar()).toBeDisabled()
  })

  it("sin ubicación operativa lo dice y no deja facturar", async () => {
    await renderPOS({ saleDraft: borradorDeCotizacion(1), ubicacionOperativa: null })

    expect(await screen.findByText(/no tienes una ubicación operativa/i)).toBeInTheDocument()
    expect(disponibleDe("Martillo de uña")).toBe("0 disp.")
    expect(botonFacturar()).toBeDisabled()
  })

  it("después de vender, la existencia de la ubicación baja en pantalla", async () => {
    const { falso } = await renderPOS({ existencias: [celda("bodega", "p1", 10), celda("bodega", "p2", 2)] })

    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("10 disp."))

    agregar("Martillo de uña")
    elegirEfectivo()
    fireEvent.click(botonFacturar())

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    await waitFor(() => expect(disponibleDe("Martillo de uña")).toBe("9 disp."))
  })

  it("con el catálogo en 10 y la ubicación en 0, la validación previa no deja facturar", async () => {
    await renderPOS({
      saleDraft: borradorDeCotizacion(1),
      productos: catalogoCon10,
      ubicaciones: [BODEGA, CAMION_01],
      existencias: [celda("bodega", "p2", 10)],
      ubicacionOperativa: "camion-01",
    })
    Swal.fire.mockClear()

    elegirEfectivo()
    fireEvent.click(botonFacturar())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())
    expect(Swal.fire.mock.calls[0][0].text).toMatch(/cemento gris solo tiene 0 unidades/i)
  })
})
