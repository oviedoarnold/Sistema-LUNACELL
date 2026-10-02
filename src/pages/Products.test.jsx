import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, act, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
import Products from "./Products"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, costPrice: 120, stock: 20, minStock: 5, supplierId: "" },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, costPrice: 200, stock: 3, minStock: 10, supplierId: "" },
  { id: "p3", code: "P-001", name: "Brocha 3 pulgadas", category: "Pinturas", price: 45, costPrice: 26, stock: 0, minStock: 5, supplierId: "" },
]

function renderProducts(productos = PRODUCTOS, extra = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <LocationsProvider>
          <Products />
        </LocationsProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      productos,
      esperar: ["productos_con_stock", "ubicaciones", "existencias_por_ubicacion"],
      ...extra,
    }
  )
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
    target: { value: texto },
  })

describe("Products", () => {
  it("lista los productos del inventario", async () => {
    await renderProducts()

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
  })

  it("marca disponible el producto con stock suficiente", async () => {
    await renderProducts()
    expect(screen.getByText("Disponible")).toBeInTheDocument()
  })

  it("marca stock bajo cuando llega al mínimo", async () => {
    await renderProducts()
    expect(screen.getByText("Stock bajo")).toBeInTheDocument()
  })

  it("marca agotado cuando no queda nada", async () => {
    await renderProducts()
    expect(screen.getByText("Agotado")).toBeInTheDocument()
  })

  it("filtra por nombre", async () => {
    await renderProducts()
    buscar("martillo")

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.queryByText("Cemento gris")).not.toBeInTheDocument()
  })

  it("filtra por categoría", async () => {
    await renderProducts()
    buscar("pinturas")

    expect(screen.getByText("Brocha 3 pulgadas")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })

  it("filtra por código", async () => {
    await renderProducts()
    buscar("C-001")

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })

  it("abre el formulario de producto nuevo", async () => {
    await renderProducts()

    fireEvent.click(screen.getByRole("button", { name: /nuevo producto/i }))

    expect(
      screen.getByRole("heading", { name: /nuevo producto/i })
    ).toBeInTheDocument()
  })

  it("ofrece editar cada producto listado", async () => {
    await renderProducts()

    expect(screen.getAllByRole("button", { name: /editar/i })).toHaveLength(3)
  })
})

describe("Products: imagen del producto", () => {
  const abrirNuevo = () =>
    fireEvent.click(screen.getByRole("button", { name: /nuevo producto/i }))

  const escribir = (etiqueta, valor) =>
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

  const elegirImagen = (archivo) =>
    fireEvent.change(document.querySelector("#products-imagen"), {
      target: { files: [archivo] },
    })

  const imagen = () => new File(["x"], "foto.jpg", { type: "image/jpeg" })

  it("muestra una miniatura por producto en el listado", async () => {
    await renderProducts()

    // Ninguno tiene foto en las fixtures, así que aparece su inicial.
    expect(screen.getByText("M")).toBeInTheDocument()
    expect(screen.getByText("C")).toBeInTheDocument()
    expect(screen.getByText("B")).toBeInTheDocument()
  })

  it("el formulario ofrece subir una imagen", async () => {
    await renderProducts()
    abrirNuevo()

    expect(screen.getByRole("button", { name: /subir imagen/i })).toBeInTheDocument()
  })

  it("sube la imagen elegida al guardar el producto", async () => {
    const { falso } = await renderProducts()

    abrirNuevo()
    escribir(/^código$/i, "T-001")
    escribir(/^nombre$/i, "Taladro")
    escribir(/^categoría$/i, "Herramientas")
    elegirImagen(imagen())

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /guardar producto/i }))
    })

    expect(falso.archivos.size).toBe(1)

    // Sin esto la prueba pasaria aunque el guardado fallara.
    expect(falso.datos.productos.map((p) => p.nombre)).toContain("Taladro")
  })

  /*
    La imagen se sube al guardar y no al elegirla: cancelar no debe dejar
    archivos sueltos en el almacenamiento.
  */
  it("cancelar el formulario no sube nada", async () => {
    const { falso } = await renderProducts()

    abrirNuevo()
    elegirImagen(imagen())
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }))

    expect(falso.archivos.size).toBe(0)
  })

  it("guardar sin elegir imagen no sube nada", async () => {
    const { falso } = await renderProducts()

    abrirNuevo()
    escribir(/^código$/i, "T-002")
    escribir(/^nombre$/i, "Serrucho")
    escribir(/^categoría$/i, "Herramientas")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /guardar producto/i }))
    })

    expect(falso.archivos.size).toBe(0)
    expect(falso.datos.productos.map((p) => p.nombre)).toContain("Serrucho")
  })
})

describe("Products: existencia por ubicación", () => {
  const UBICACIONES = [
    { id: "bodega", name: "Lunacell Bodega", type: "bodega" },
    { id: "tienda", name: "Lunacell Store", type: "tienda" },
  ]

  // El Martillo tiene 20 en total; 15 están en la bodega y 5 en la tienda.
  const EXISTENCIAS = [
    { locationId: "bodega", productId: "p1", quantity: 15 },
    { locationId: "tienda", productId: "p1", quantity: 5 },
  ]

  const renderConUbicaciones = () =>
    renderProducts(PRODUCTOS, { ubicaciones: UBICACIONES, existencias: EXISTENCIAS })

  const escribir = (etiqueta, valor) =>
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

  const guardar = () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /guardar producto/i }))
    })

  const llamadasAlRpc = (falso) =>
    falso.rpc.mock.calls.filter(([nombre]) => nombre === "registrar_movimiento_ubicacion")

  const editar = async (nombre) => {
    const fila = screen.getByText(nombre).closest("tr")

    await act(async () => {
      fireEvent.click(within(fila).getByRole("button", { name: /editar/i }))
    })
  }

  const nuevo = (codigo, nombre) => {
    fireEvent.click(screen.getByRole("button", { name: /nuevo producto/i }))
    escribir(/^código$/i, codigo)
    escribir(/^nombre$/i, nombre)
    escribir(/^categoría$/i, "Herramientas")
  }

  it("un producto nuevo con existencia la registra en la ubicación elegida", async () => {
    const { falso } = await renderConUbicaciones()

    nuevo("T-010", "Taladro")
    escribir(/^existencia inicial$/i, "8")
    escribir(/^ubicación de la existencia$/i, "bodega")
    await guardar()

    const [[, argumentos]] = llamadasAlRpc(falso)

    expect(argumentos).toMatchObject({
      p_ubicacion_id: "bodega",
      p_tipo: "entrada",
      p_cantidad: 8,
    })
  })

  it("sin ubicación, una existencia inicial no crea el producto", async () => {
    const { falso } = await renderConUbicaciones()

    nuevo("T-011", "Lijadora")
    escribir(/^existencia inicial$/i, "3")
    await guardar()

    expect(falso.datos.productos.map((p) => p.nombre)).not.toContain("Lijadora")
    expect(llamadasAlRpc(falso)).toHaveLength(0)
  })

  it("un producto nuevo sin existencia no llama al RPC", async () => {
    const { falso } = await renderConUbicaciones()

    nuevo("T-012", "Cincel")
    await guardar()

    expect(falso.datos.productos.map((p) => p.nombre)).toContain("Cincel")
    expect(llamadasAlRpc(falso)).toHaveLength(0)
  })

  /*
    G2: al editar se ve la existencia de la ubicación elegida y, aparte,
    el total. El usuario tiene que saber que corrige la bodega y no los 20.
  */
  it("al editar muestra la existencia de la ubicación elegida y el total aparte", async () => {
    await renderConUbicaciones()
    await editar("Martillo de uña")

    escribir(/^ubicación del ajuste$/i, "bodega")

    expect(
      screen.getByText(/hoy hay 15 en lunacell bodega \(20 en todas las ubicaciones\)/i)
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^nueva existencia en esta ubicación$/i)).toHaveValue(null)
  })

  it("ajustar registra la diferencia contra la existencia de esa ubicación", async () => {
    const { falso } = await renderConUbicaciones()
    await editar("Martillo de uña")

    escribir(/^ubicación del ajuste$/i, "tienda")
    escribir(/^nueva existencia en esta ubicación$/i, "2")
    await guardar()

    const [[, argumentos]] = llamadasAlRpc(falso)

    // En la tienda había 5: el ajuste es −3, no 2 − 20.
    expect(argumentos).toMatchObject({
      p_producto_id: "p1",
      p_ubicacion_id: "tienda",
      p_tipo: "ajuste",
      p_cantidad: -3,
    })
  })

  it("editar sin tocar la existencia no llama al RPC", async () => {
    const { falso } = await renderConUbicaciones()
    await editar("Martillo de uña")

    escribir(/^ubicación del ajuste$/i, "bodega")
    escribir(/^nombre$/i, "Martillo de carpintero")
    await guardar()

    expect(falso.datos.productos.find((p) => p.id === "p1").nombre).toBe(
      "Martillo de carpintero"
    )
    expect(llamadasAlRpc(falso)).toHaveLength(0)
  })

  it("dos clics seguidos en guardar registran la entrada una sola vez", async () => {
    const { falso } = await renderConUbicaciones()

    nuevo("T-013", "Esmeril")
    escribir(/^existencia inicial$/i, "4")
    escribir(/^ubicación de la existencia$/i, "bodega")

    await act(async () => {
      const boton = screen.getByRole("button", { name: /guardar producto/i })
      fireEvent.click(boton)
      fireEvent.click(boton)
    })

    expect(llamadasAlRpc(falso)).toHaveLength(1)
    expect(
      falso.datos.productos.filter((p) => p.nombre === "Esmeril")
    ).toHaveLength(1)
  })
})
