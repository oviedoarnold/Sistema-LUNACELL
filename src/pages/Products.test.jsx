import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, act, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { EVENTO_VENTAS_SINCRONIZADAS } from "../lib/sinConexion/eventos"
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

/*
  Por omisión el usuario trabaja en la bodega, que tiene todo el stock: los
  estados de la pantalla son los de la ubicación a la vista.
*/
const BODEGA = { id: "bodega", name: "Lunacell Bodega", type: "bodega" }

const EN_LA_BODEGA = [
  { locationId: "bodega", productId: "p1", quantity: 20 },
  { locationId: "bodega", productId: "p2", quantity: 3 },
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
      ubicaciones: [BODEGA],
      existencias: EN_LA_BODEGA,
      ubicacionOperativa: "bodega",
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

  it("marca con existencias el producto con suficiente en la ubicación a la vista", async () => {
    await renderProducts()
    expect(screen.getByText("Con existencias")).toBeInTheDocument()
  })

  it("el administrador ve lo disponible en su ubicación y, aparte, el stock total", async () => {
    await renderProducts()
    expect(screen.getByRole("columnheader", { name: "Disponible en Lunacell Bodega" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Stock total" })).toBeInTheDocument()
    expect(screen.getByText(/la suma de todas las ubicaciones/)).toBeInTheDocument()
  })

  it("muestra el precio con separador de miles, como el resto del sistema", async () => {
    await renderProducts([{ ...PRODUCTOS[0], price: 1500 }])
    expect(screen.getByText("L 1,500.00")).toBeInTheDocument()
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
    renderProducts(PRODUCTOS, { ubicaciones: UBICACIONES, existencias: EXISTENCIAS, ubicacionOperativa: null })

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

/*
  0035: el costo es confidencial. Lo ve y lo cambia solo el administrador,
  que lo pide aparte con costos_de_productos(). Quien lleva el inventario
  tiene la misma pantalla con el precio de venta y sin rastro del costo.
*/
describe("Products: el costo solo para el administrador", () => {
  const editar = async (nombre) => {
    const fila = screen.getByText(nombre).closest("tr")

    await act(async () => {
      fireEvent.click(within(fila).getByRole("button", { name: /editar/i }))
    })
  }

  const guardar = () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /guardar producto/i }))
    })

  const comoInventario = { rolDelUsuario: "vendedor", permisosDelUsuario: ["products", "inventory-own"] }

  it("el administrador ve la columna de costo con el valor que da la base", async () => {
    await renderProducts()

    expect(screen.getByRole("columnheader", { name: "Costo" })).toBeInTheDocument()

    const fila = screen.getByText("Martillo de uña").closest("tr")
    expect(await within(fila).findByText("L 120.00")).toBeInTheDocument()
  })

  it("el administrador corrige el costo desde el formulario", async () => {
    const { falso } = await renderProducts()
    await within(screen.getByText("Martillo de uña").closest("tr")).findByText("L 120.00")

    await editar("Martillo de uña")
    fireEvent.change(screen.getByLabelText(/^costo$/i), { target: { value: "130" } })
    await guardar()

    expect(falso.datos.productos.find((p) => p.id === "p1").costo).toBe(130)
  })

  it("quien lleva el inventario ve el precio de venta y ningún costo", async () => {
    const { falso } = await renderProducts(PRODUCTOS, comoInventario)

    expect(screen.queryByRole("columnheader", { name: "Costo" })).not.toBeInTheDocument()
    expect(screen.getByText("L 180.00")).toBeInTheDocument()
    expect(screen.queryByText("L 120.00")).not.toBeInTheDocument()
    expect(falso.rpc).not.toHaveBeenCalledWith("costos_de_productos")
  })

  it("su formulario no tiene costo, y guardar no lo toca", async () => {
    const { falso } = await renderProducts(PRODUCTOS, comoInventario)

    await editar("Martillo de uña")
    expect(screen.queryByLabelText(/^costo$/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^precio de venta$/i), { target: { value: "190" } })
    await guardar()

    expect(falso.datos.productos.find((p) => p.id === "p1")).toMatchObject({ precio: 190, costo: 120 })
  })

  it("si la base niega los costos, el administrador no ve ni guarda uno inventado", async () => {
    const { falso } = await renderProducts(PRODUCTOS, { fallarEn: { costos_de_productos: { code: "42501" } } })

    const fila = screen.getByText("Martillo de uña").closest("tr")
    expect(within(fila).getByText("—")).toBeInTheDocument()

    await editar("Martillo de uña")
    expect(screen.queryByLabelText(/^costo$/i)).not.toBeInTheDocument()
    await guardar()

    expect(falso.datos.productos.find((p) => p.id === "p1").costo).toBe(120)
  })
})

/*
  Inventario por ubicación, con el caso real después del traslado entre
  Lunacell Bodega y Ruta local. Lo principal es lo disponible en la ubicación
  a la vista; el stock total, aparte y solo para quien puede ver todas.
*/
describe("Products: inventario de la ubicación del usuario", () => {
  const RUTA = { id: "ruta", name: "Ruta local", type: "camion" }

  // El stock del catálogo es el total de la empresa.
  const CATALOGO = [
    { id: "aur", code: "AUR-01", name: "Auriculares Iphone", category: "Audio", price: 150, costPrice: 90, stock: 39, minStock: 5, supplierId: "" },
    { id: "cubo", code: "CUB-01", name: "Cubo Iphone", category: "Cargadores", price: 120, costPrice: 70, stock: 42, minStock: 5, supplierId: "" },
    { id: "parl", code: "PAR-01", name: "Parlante inalámbrico", category: "Audio", price: 600, costPrice: 400, stock: 9, minStock: 5, supplierId: "" },
    { id: "vid", code: "VID-01", name: "Vidrio privado caja", category: "Protectores", price: 80, costPrice: 30, stock: 99, minStock: 5, supplierId: "" },
    { id: "carg", code: "CAR-01", name: "Cargador rápido", category: "Cargadores", price: 200, costPrice: 120, stock: 5, minStock: 2, supplierId: "" },
  ]

  const EN_BODEGA = [
    { locationId: "bodega", productId: "aur", quantity: 29 },
    { locationId: "bodega", productId: "cubo", quantity: 27 },
    { locationId: "bodega", productId: "parl", quantity: 7 },
    { locationId: "bodega", productId: "vid", quantity: 69 },
  ]

  // El cargador está agotado en la bodega y tiene 5 en la ruta.
  const EN_RUTA = [
    { locationId: "ruta", productId: "aur", quantity: 10 },
    { locationId: "ruta", productId: "cubo", quantity: 15 },
    { locationId: "ruta", productId: "parl", quantity: 2 },
    { locationId: "ruta", productId: "vid", quantity: 30 },
    { locationId: "ruta", productId: "carg", quantity: 5 },
  ]

  const comoAdmin = (ubicacionOperativa = "bodega") => ({
    ubicaciones: [BODEGA, RUTA],
    existencias: [...EN_BODEGA, ...EN_RUTA],
    ubicacionOperativa,
  })

  // Lo que la base le devuelve a un vendedor con inventory-own: solo su ubicación.
  const comoVendedorDe = (ubicacion, existencias) => ({
    rolDelUsuario: "vendedor",
    permisosDelUsuario: ["products", "inventory-own"],
    ubicaciones: [ubicacion],
    existencias,
    ubicacionOperativa: ubicacion.id,
  })

  const fila = (producto) => screen.getByText(producto).closest("tr")

  const estadoDe = (producto) => within(fila(producto)).queryByText(/^(Agotado|Stock bajo|Con existencias)$/)?.textContent ?? null
  const selector = () => screen.queryByLabelText(/cambiar de ubicación/i)
  const cambiarA = (id) => fireEvent.change(selector(), { target: { value: id } })

  it("abre automáticamente en la ubicación asignada", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    expect(screen.getByText(/Ubicación actual:/)).toHaveTextContent("Ubicación actual: Lunacell Bodega (tu ubicación)")
    expect(selector()).toHaveValue("bodega")
  })

  it("el administrador de Bodega ve lo de Bodega y, aparte, el stock total", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    expect(screen.getByRole("columnheader", { name: "Disponible en Lunacell Bodega" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Stock total" })).toBeInTheDocument()
    expect(within(fila("Auriculares Iphone")).getByText("29 u.")).toBeInTheDocument()
    expect(within(fila("Auriculares Iphone")).getByText("39 u.")).toBeInTheDocument()
    expect(within(fila("Cubo Iphone")).getByText("27 u.")).toBeInTheDocument()
    expect(within(fila("Parlante inalámbrico")).getByText("7 u.")).toBeInTheDocument()
    expect(within(fila("Vidrio privado caja")).getByText("69 u.")).toBeInTheDocument()
  })

  it("el administrador que cambia a Ruta local ve lo de la ruta en el acto", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    cambiarA("ruta")

    expect(screen.getByRole("columnheader", { name: "Disponible en Ruta local" })).toBeInTheDocument()
    expect(screen.getByText(/Ubicación actual:/)).toHaveTextContent("Ubicación actual: Ruta local.")
    expect(within(fila("Auriculares Iphone")).getByText("10 u.")).toBeInTheDocument()
    expect(within(fila("Cubo Iphone")).getByText("15 u.")).toBeInTheDocument()
    expect(within(fila("Parlante inalámbrico")).getByText("2 u.")).toBeInTheDocument()
    expect(within(fila("Vidrio privado caja")).getByText("30 u.")).toBeInTheDocument()
    expect(within(fila("Auriculares Iphone")).getByText("39 u.")).toBeInTheDocument()
  })

  it("el vendedor de Bodega ve 29, 27, 7 y 69, sin selector ni stock total", async () => {
    await renderProducts(CATALOGO, comoVendedorDe(BODEGA, EN_BODEGA))

    expect(within(fila("Auriculares Iphone")).getByText("29 u.")).toBeInTheDocument()
    expect(within(fila("Cubo Iphone")).getByText("27 u.")).toBeInTheDocument()
    expect(within(fila("Parlante inalámbrico")).getByText("7 u.")).toBeInTheDocument()
    expect(within(fila("Vidrio privado caja")).getByText("69 u.")).toBeInTheDocument()
    expect(selector()).not.toBeInTheDocument()
  })

  it("el vendedor de Ruta local ve 10, 15, 2 y 30", async () => {
    await renderProducts(CATALOGO, comoVendedorDe(RUTA, EN_RUTA))

    expect(screen.getByRole("columnheader", { name: "Disponible en Ruta local" })).toBeInTheDocument()
    expect(within(fila("Auriculares Iphone")).getByText("10 u.")).toBeInTheDocument()
    expect(within(fila("Cubo Iphone")).getByText("15 u.")).toBeInTheDocument()
    expect(within(fila("Parlante inalámbrico")).getByText("2 u.")).toBeInTheDocument()
    expect(within(fila("Vidrio privado caja")).getByText("30 u.")).toBeInTheDocument()
  })

  it("el vendedor sin permiso global no ve el stock de la empresa en ninguna parte", async () => {
    await renderProducts(CATALOGO, comoVendedorDe(BODEGA, EN_BODEGA))

    expect(screen.queryByRole("columnheader", { name: "Stock total" })).not.toBeInTheDocument()
    expect(screen.queryByText(/la suma de todas las ubicaciones/)).not.toBeInTheDocument()

    for (const total of ["39 u.", "42 u.", "9 u.", "99 u."]) expect(screen.queryByText(total)).not.toBeInTheDocument()

    // Tampoco en la ayuda del ajuste.
    await act(async () => {
      fireEvent.click(within(fila("Auriculares Iphone")).getByRole("button", { name: /editar/i }))
    })

    expect(screen.getByText(/hoy hay 29 en lunacell bodega\./i)).toBeInTheDocument()
    expect(screen.queryByText(/en todas las ubicaciones/i)).not.toBeInTheDocument()
  })

  it("agotado en la ubicación aunque haya unidades en otra", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    expect(estadoDe("Cargador rápido")).toBe("Agotado")
    expect(within(fila("Cargador rápido")).getByText("0 u.")).toBeInTheDocument()
    expect(within(fila("Cargador rápido")).getByText("5 u.")).toBeInTheDocument()

    cambiarA("ruta")

    expect(estadoDe("Cargador rápido")).toBe("Con existencias")
  })

  it("el stock bajo y su alerta son los de la ubicación", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    expect(estadoDe("Parlante inalámbrico")).toBe("Con existencias")
    expect(screen.getByText(/1 producto con stock bajo \(1 agotado\)/)).toBeInTheDocument()

    cambiarA("ruta")

    expect(estadoDe("Parlante inalámbrico")).toBe("Stock bajo")
    expect(screen.getByText(/1 producto con stock bajo$/)).toBeInTheDocument()
    expect(screen.getByText("Parlante inalámbrico · 2")).toBeInTheDocument()
  })

  it("una sesión nueva vuelve a abrir en la ubicación asignada", async () => {
    const { unmount } = await renderProducts(CATALOGO, comoAdmin())

    cambiarA("ruta")
    unmount()

    await renderProducts(CATALOGO, comoAdmin())

    expect(selector()).toHaveValue("bodega")
    expect(within(fila("Auriculares Iphone")).getByText("29 u.")).toBeInTheDocument()
  })

  it("sin ubicación asignada avisa y no usa el stock global", async () => {
    await renderProducts(CATALOGO, { ...comoVendedorDe(BODEGA, []), ubicaciones: [], ubicacionOperativa: null })

    expect(screen.getByRole("note")).toHaveTextContent(/No tienes una ubicación asignada\. Pide al administrador/)
    expect(screen.queryByText("39 u.")).not.toBeInTheDocument()
    expect(estadoDe("Auriculares Iphone")).toBeNull()
    expect(screen.queryByText(/con stock bajo/)).not.toBeInTheDocument()
  })

  it("el administrador sin ubicación elige una; no se asume la bodega", async () => {
    await renderProducts(CATALOGO, comoAdmin(null))

    expect(screen.getByRole("note")).toHaveTextContent(/elige una para ver sus existencias/)
    expect(selector()).toHaveValue("")
    expect(screen.queryByText("29 u.")).not.toBeInTheDocument()

    cambiarA("ruta")

    expect(screen.queryByRole("note")).not.toBeInTheDocument()
    expect(within(fila("Auriculares Iphone")).getByText("10 u.")).toBeInTheDocument()
  })

  it("al sincronizar ventas vuelve a pedir las existencias", async () => {
    const { falso } = await renderProducts(CATALOGO, comoAdmin())

    falso.datos.inventario_ubicacion.find((c) => c.ubicacion_id === "bodega" && c.producto_id === "aur").cantidad = 28

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_VENTAS_SINCRONIZADAS, { detail: { registradas: 1 } }))
    })

    expect(await within(fila("Auriculares Iphone")).findByText("28 u.")).toBeInTheDocument()
  })

  it("el ajuste propone la ubicación que se está mirando", async () => {
    await renderProducts(CATALOGO, comoAdmin())

    cambiarA("ruta")

    await act(async () => {
      fireEvent.click(within(fila("Cubo Iphone")).getByRole("button", { name: /editar/i }))
    })

    expect(screen.getByLabelText(/^ubicación del ajuste$/i)).toHaveValue("ruta")
    expect(screen.getByText(/hoy hay 15 en ruta local \(42 en todas las ubicaciones\)/i)).toBeInTheDocument()
  })
})
