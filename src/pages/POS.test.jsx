import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react"
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

const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "bodega" }
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
  const casilla = screen.queryByRole("checkbox", { name: "Efectivo" })

  if (casilla) fireEvent.click(casilla)
}

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

  const marcar = (nombre) => fireEvent.click(screen.getByRole("checkbox", { name: nombre }))

  const importe = (nombre, valor) => fireEvent.change(screen.getByLabelText(`Importe de ${nombre}`), { target: { value: valor } })

  const clicFacturar = () => fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

  it("sin elegir el medio de pago no se puede confirmar: nada viene preseleccionado", async () => {
    await renderPOS()

    agregar("Martillo de uña")

    expect(screen.getAllByRole("checkbox").filter((c) => c.checked)).toEqual([])
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()
  })

  it("con un medio manda el total y su referencia", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    marcar("Tarjeta")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("207.00")
    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()
    expect(screen.getByText("Escribe la referencia de Tarjeta.")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Referencia de Tarjeta"), { target: { value: "AUT-1" } })
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio: "tarjeta", monto: 207, referencia: "AUT-1" }])
  })

  it("un pago mixto no se puede confirmar hasta que los importes suman el total", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    marcar("Transferencia")

    // Efectivo conserva el total: sin saldo, Transferencia no admite importe.
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("207.00")
    expect(screen.getByLabelText("Importe de Transferencia")).toBeDisabled()

    importe("Efectivo", "100")
    importe("Transferencia", "100")
    fireEvent.change(screen.getByLabelText("Referencia de Transferencia"), { target: { value: "TRF-1" } })

    const resumen = screen.getByText("Pendiente").closest("dl")

    expect(within(resumen).getByText("Pendiente").nextSibling).toHaveTextContent("7.00")
    expect(within(resumen).getByText("Importe asignado").nextSibling).toHaveTextContent("200.00")
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()

    importe("Transferencia", "107")

    expect(within(resumen).getByText("Pendiente").nextSibling).toHaveTextContent("0.00")

    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: "efectivo", monto: 100, referencia: "" },
      { medio: "transferencia", monto: 107, referencia: "TRF-1" },
    ])
  })

  it("no deja superar el total, ni pegando: el importe se ajusta y lo dice", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "100")
    importe("Tarjeta", "1,125.00")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("107.00")
    expect(screen.getByText(/se ajustó a lo que quedaba pendiente/i)).toBeInTheDocument()
  })

  /*
    Sin esto, tocar un importe y teclear agrega los dígitos al final, el tope
    los corta y parece que el campo no responde. Se vio en un navegador real.
  */
  it("al entrar a un importe selecciona lo escrito, para que teclear lo reemplace", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    marcar("Tarjeta")

    const campo = screen.getByLabelText("Importe de Efectivo")

    fireEvent.focus(campo)

    expect(campo.selectionStart).toBe(0)
    expect(campo.selectionEnd).toBe("207.00".length)
  })

  it("al cambiar el total: con un medio lo sigue, y con varios bloquea hasta corregir", async () => {
    await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    agregar("Martillo de uña")

    // Dos martillos: 414.00. El único medio sigue al total.
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("414.00")

    marcar("Transferencia")
    importe("Efectivo", "300")
    importe("Transferencia", "114")
    fireEvent.change(screen.getByLabelText("Referencia de Transferencia"), { target: { value: "TRF-1" } })
    fireEvent.click(screen.getByRole("button", { name: /quitar una unidad de martillo/i }))

    // Bajó a 207.00: los importes no se cambian solos, y no se puede confirmar.
    expect(screen.getByText("Excedente").nextSibling).toHaveTextContent("207.00")
    expect(screen.getByText(/el total bajó/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()

    importe("Efectivo", "93")

    expect(screen.getByText("Pendiente").nextSibling).toHaveTextContent("0.00")
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeEnabled()
  })

  it("desmarcar borra importe y referencia, y el que queda solo vuelve a llevar el total", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    marcar("Tarjeta")
    importe("Efectivo", "100")
    importe("Tarjeta", "107")
    fireEvent.change(screen.getByLabelText("Referencia de Tarjeta"), { target: { value: "AUT-9" } })

    marcar("Tarjeta")

    expect(screen.queryByLabelText("Importe de Tarjeta")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Importe de Efectivo")).toHaveValue("207.00")

    marcar("Tarjeta")

    expect(screen.getByLabelText("Importe de Tarjeta")).toHaveValue("")

    marcar("Tarjeta")
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([{ medio: "efectivo", monto: 207, referencia: "" }])
  })

  it("con los cuatro medios manda cada importe con decimales exactos", async () => {
    const { falso } = await renderPOS()

    agregar("Martillo de uña")
    marcar("Efectivo")
    marcar("Transferencia")
    marcar("Tarjeta")
    marcar("Enlace de pago")
    importe("Efectivo", "100.10")
    importe("Transferencia", "100.20")
    importe("Tarjeta", "6.60")
    importe("Enlace de pago", "0.10")
    fireEvent.change(screen.getByLabelText("Referencia de Transferencia"), { target: { value: "T" } })
    fireEvent.change(screen.getByLabelText("Referencia de Tarjeta"), { target: { value: "A" } })
    fireEvent.change(screen.getByLabelText("Referencia de Enlace de pago"), { target: { value: "L" } })
    clicFacturar()

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(rpcDeVenta(falso)[1].p_cobros).toEqual([
      { medio: "efectivo", monto: 100.1, referencia: "" },
      { medio: "transferencia", monto: 100.2, referencia: "T" },
      { medio: "tarjeta", monto: 6.6, referencia: "A" },
      { medio: "enlace", monto: 0.1, referencia: "L" },
    ])
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

    expect(screen.queryByRole("checkbox", { name: "Efectivo" })).not.toBeInTheDocument()
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
