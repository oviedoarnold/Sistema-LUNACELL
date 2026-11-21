import { describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"

import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import { EVENTO_VENTAS_SINCRONIZADAS } from "../lib/sinConexion/eventos"
import { renderizarPantalla } from "../test/pantallas"
import Inventory from "./Inventory"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  La consulta de existencias por ubicación.

  Lo que se comprueba aquí es la pantalla: que agrupe, busque, distinga el
  cero y no dibuje lo que no recibió. Quién recibe qué lo decide la base, y
  eso se prueba contra PostgreSQL real en
  pruebas-sql/inventario-visibilidad.test.mjs, que es el único sitio donde
  se puede autenticar a un vendedor de verdad.

  La frontera entre las dos cosas es justamente el valor de estas pruebas:
  se siembran las filas que el usuario vería, y se exige que la pantalla
  muestre exactamente eso. Ni una ubicación más.
*/

const UBICACIONES = [
  { id: "u-bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "u-store", name: "Lunacell Store", type: "tienda" },
  { id: "u-c1", name: "Camión 01", type: "camion" },
  { id: "u-c2", name: "Camión 02", type: "camion" },
]

/*
  Los productos entran sin stock inicial para que el único inventario sea
  el de las celdas. aFilaDeProducto siembra un movimiento por el `stock`
  que se le pase, y eso alimenta a productos_con_stock, que no es lo que
  esta pantalla lee.
*/
const PRODUCTOS = [
  { id: "p-cargador", code: "LCCOBERESAM", name: "Cargador", price: 120, costPrice: 80, stock: 0, minStock: 5, supplierId: "" },
  { id: "p-cubo", code: "LCCUBOESAM", name: "Cubo Iphone", price: 100, costPrice: 70, stock: 0, minStock: 5, supplierId: "" },
]

/* Solo las celdas que existen. El cero no se siembra: lo produce la vista. */
const EXISTENCIAS = [
  { locationId: "u-bodega", productId: "p-cargador", quantity: 15 },
  { locationId: "u-c1", productId: "p-cargador", quantity: 3 },
  { locationId: "u-c2", productId: "p-cargador", quantity: 12 },
]

function renderInventory(datos = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <MemoryRouter>
        <Inventory />
      </MemoryRouter>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      ubicaciones: UBICACIONES,
      existencias: EXISTENCIAS,
      esperar: ["existencias_por_ubicacion"],
      ...datos,
    }
  )
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
    target: { value: texto },
  })

/*
  La tabla de todas las ubicaciones: una fila por producto y una columna
  por ubicación. Una ubicación que no llegó para ese producto lleva «—».
*/
const matriz = () => document.querySelector(".inventory-matriz table")

const filaDe = (producto) => within(matriz()).getByText(producto).closest("tr")

const productosVisibles = () =>
  [...matriz().querySelectorAll(".inventory-nombre")].map((n) => n.textContent)

const columnasDeUbicacion = () =>
  [...matriz().querySelectorAll(".inventory-nombre-ubicacion")].map((c) => c.textContent)

const celdasPorUbicacion = (producto) =>
  [...filaDe(producto).querySelectorAll("td.inventory-col-ubicacion")].map((c) => c.textContent)

const ubicacionesDe = (producto) => {
  const celdas = celdasPorUbicacion(producto)

  return columnasDeUbicacion().filter((_, i) => celdas[i] !== "—")
}

/*
  El total y una cantidad pueden coincidir —un producto en una sola
  ubicación tiene el mismo número en su columna y en el total—, así que se
  consultan por su sitio y no por su texto.
*/
const totalDe = (producto) =>
  filaDe(producto).querySelector(".inventory-total strong").textContent

const cantidadesDe = (producto) =>
  [...filaDe(producto).querySelectorAll(".inventory-cantidad")].map(
    (celda) => celda.textContent
  )

describe("Inventory · consulta", () => {
  it("agrupa cada producto con sus ubicaciones", async () => {
    await renderInventory()

    expect(ubicacionesDe("Cargador")).toEqual([
      "Camión 01",
      "Camión 02",
      "Lunacell Bodega",
      "Lunacell Store",
    ])
  })

  it("muestra la cantidad de cada ubicación", async () => {
    await renderInventory()

    expect(cantidadesDe("Cargador")).toEqual(["3", "12", "15"])
  })

  it("muestra el total de lo visible", async () => {
    await renderInventory()

    /* 15 + 3 + 12, más la tienda en cero. */
    expect(totalDe("Cargador")).toBe("30")
  })

  it("muestra el tipo de cada ubicación", async () => {
    await renderInventory()

    const encabezado = within(matriz().querySelector("thead"))

    expect(encabezado.getByText("Bodega")).toBeInTheDocument()
    expect(encabezado.getByText("Tienda")).toBeInTheDocument()
    expect(encabezado.getAllByText("Camión")).toHaveLength(2)
  })

  it("muestra el código del producto", async () => {
    await renderInventory()

    expect(screen.getByText("LCCOBERESAM")).toBeInTheDocument()
  })
})

describe("Inventory · el cero", () => {
  /*
    La tienda no tiene celda para el cargador. Tiene que aparecer, con
    cero: el modelo guarda el cero como ausencia de fila y la consulta lo
    vuelve a convertir en número.
  */
  it("una ubicación sin celda aparece con cero", async () => {
    await renderInventory()

    expect(ubicacionesDe("Cargador")).toContain("Lunacell Store")
  })

  /*
    Y se distingue con palabra, no solo con el número: «0» y «10» se
    parecen demasiado leídos de reojo en una columna, y la diferencia
    decide si se promete una venta.
  */
  it("el cero lleva texto además del número", async () => {
    await renderInventory()

    expect(
      celdasPorUbicacion("Cargador")
    ).toContain("0 · sin existencia")
  })

  it("un producto sin existencia en ninguna parte sale con total cero", async () => {
    await renderInventory()

    expect(celdasPorUbicacion("Cubo Iphone")).toEqual(Array(4).fill("0 · sin existencia"))
    expect(totalDe("Cubo Iphone")).toBe("0")
  })
})

describe("Inventory · la ubicación prohibida no se dibuja", () => {
  /*
    La prueba central de la pantalla.

    Se siembra lo que la base le devolvería a un vendedor con
    inventory-own sobre el Camión 01: solo su camión. La pantalla NO debe
    completar la cuadrícula con la bodega y el otro camión en cero.

    Ese cero sería mentira —hay 15 y 12— y además le diría que esas
    ubicaciones existen. Es el mismo error que la vista de la base evita
    filtrando antes de unir, y que se puede reintroducir aquí en una línea
    cruzando los productos con la lista de ubicaciones.
  */
  it("no inventa las ubicaciones que no recibió", async () => {
    await renderInventory({
      ubicaciones: [UBICACIONES[2]],
      existencias: [
        { locationId: "u-c1", productId: "p-cargador", quantity: 3 },
      ],
    })

    expect(ubicacionesDe("Cargador")).toEqual(["Camión 01"])

    expect(screen.queryByText("Lunacell Bodega")).not.toBeInTheDocument()
    expect(screen.queryByText("Camión 02")).not.toBeInTheDocument()
    expect(screen.queryByText("15")).not.toBeInTheDocument()
    expect(screen.queryByText("12")).not.toBeInTheDocument()
  })

  it("el total es el de lo visible y no el real", async () => {
    await renderInventory({
      ubicaciones: [UBICACIONES[2]],
      existencias: [
        { locationId: "u-c1", productId: "p-cargador", quantity: 3 },
      ],
    })

    expect(cantidadesDe("Cargador")).toEqual(["3"])
    expect(totalDe("Cargador")).toBe("3")
  })

  /*
    Con una sola ubicación visible, el selector no aparece: no hay nada
    entre lo que elegir, y mostrarlo vacío solo invita a pulsarlo.
  */
  it("con una sola ubicación no ofrece el filtro", async () => {
    await renderInventory({
      ubicaciones: [UBICACIONES[2]],
      existencias: [],
    })

    expect(
      screen.queryByLabelText(/cambiar de ubicación/i)
    ).not.toBeInTheDocument()
  })

  it("el selector solo ofrece las ubicaciones recibidas", async () => {
    await renderInventory()

    const selector = screen.getByLabelText(/cambiar de ubicación/i)
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)

    expect(opciones).toEqual([
      "Todas las ubicaciones",
      "Camión 01",
      "Camión 02",
      "Lunacell Bodega",
      "Lunacell Store",
    ])
  })
})

describe("Inventory · búsqueda", () => {
  it("busca por nombre del producto", async () => {
    await renderInventory()

    buscar("cubo")

    expect(productosVisibles()).toEqual(["Cubo Iphone"])
  })

  it("busca por código", async () => {
    await renderInventory()

    buscar("LCCOBER")

    expect(productosVisibles()).toEqual(["Cargador"])
  })

  it("ignora tildes y mayúsculas", async () => {
    await renderInventory()

    buscar("IPHONE")

    expect(productosVisibles()).toContain("Cubo Iphone")
  })

  it("avisa cuando nada coincide", async () => {
    await renderInventory()

    buscar("zzzznoexiste")

    expect(screen.getByText(/ningún producto coincide/i)).toBeInTheDocument()
  })
})

/*
  La tabla de una sola ubicación: una fila por producto, con lo que hay
  allí y, si se puede ver, el total de la empresa.
*/
const tablaDeUbicacion = () => document.querySelector(".inventory-ubicacion table")

const encabezados = () =>
  within(tablaDeUbicacion())
    .getAllByRole("columnheader")
    .map((th) => th.textContent)

// Las cifras de la fila: lo disponible y, si se puede ver, el stock total.
const celdasDe = (producto) =>
  [...within(tablaDeUbicacion()).getByText(producto).closest("tr").querySelectorAll("td.num")]
    .map((td) => td.textContent)

const ubicacionActual = () =>
  document.querySelector(".inventory-ubicacion-actual strong").textContent

const selector = () => screen.getByLabelText(/cambiar de ubicación/i)

describe("Inventory · cambio de ubicación", () => {
  it("al elegir una ubicación muestra lo que hay allí y el total", async () => {
    await renderInventory()

    fireEvent.change(selector(), { target: { value: "u-c2" } })

    expect(ubicacionActual()).toBe("Camión 02")
    expect(encabezados()).toEqual(["Producto", "Código", "Disponible en Camión 02", "Stock total"])
    expect(celdasDe("Cargador")).toEqual(["12", "30"])
    expect(celdasDe("Cubo Iphone")).toEqual(["0 · sin existencia", "0"])
  })

  it("al cambiar otra vez las cantidades cambian en el acto", async () => {
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    expect(celdasDe("Cargador")).toEqual(["15", "30"])

    fireEvent.change(selector(), { target: { value: "u-c1" } })

    expect(ubicacionActual()).toBe("Camión 01")
    expect(celdasDe("Cargador")).toEqual(["3", "30"])
  })

  it("se puede volver a todas", async () => {
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    fireEvent.change(selector(), { target: { value: "" } })

    expect(ubicacionActual()).toBe("todas las que puedes consultar")
    expect(ubicacionesDe("Cargador")).toHaveLength(4)
    expect(tablaDeUbicacion()).toBeNull()
  })

  it("la búsqueda sigue funcionando dentro de una ubicación", async () => {
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    buscar("cubo")

    expect(celdasDe("Cubo Iphone")).toEqual(["0 · sin existencia", "0"])
    expect(within(tablaDeUbicacion()).queryByText("Cargador")).not.toBeInTheDocument()
  })
})

describe("Inventory · se abre en la ubicación del usuario", () => {
  it("el administrador empieza en su ubicación asignada y puede cambiar", async () => {
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    expect(ubicacionActual()).toBe("Lunacell Bodega")
    expect(screen.getByText("tu ubicación")).toBeInTheDocument()
    expect(selector()).toHaveValue("u-bodega")
    expect(encabezados()).toEqual(["Producto", "Código", "Disponible en Lunacell Bodega", "Stock total"])
    expect(celdasDe("Cargador")).toEqual(["15", "30"])
  })

  /*
    Lo que la base le devuelve a un vendedor con inventory-own: solo su
    camión. Sin selector y sin stock total, que sería el de lo visible
    presentado como el de la empresa.
  */
  it("el vendedor ve su ubicación, sin selector ni stock total", async () => {
    await renderInventory({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "u-c1",
      ubicaciones: [UBICACIONES[2]],
    })

    expect(ubicacionActual()).toBe("Camión 01")
    expect(screen.queryByLabelText(/cambiar de ubicación/i)).not.toBeInTheDocument()
    expect(encabezados()).toEqual(["Producto", "Código", "Disponible en Camión 01"])
    expect(celdasDe("Cargador")).toEqual(["3"])
    expect(screen.queryByText(/stock total/i)).not.toBeInTheDocument()
  })

  it("el vendedor con inventario de todas empieza en la suya y ve el total", async () => {
    await renderInventory({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-all"],
      ubicacionOperativa: "u-c1",
    })

    expect(ubicacionActual()).toBe("Camión 01")
    expect(selector()).toHaveValue("u-c1")
    expect(celdasDe("Cargador")).toEqual(["3", "30"])
  })

  it("sin ubicación asignada no asume la bodega y lo dice", async () => {
    await renderInventory()

    expect(screen.getByRole("note")).toHaveTextContent(/no tienes una ubicación asignada/i)
    expect(ubicacionActual()).toBe("todas las que puedes consultar")
    expect(selector()).toHaveValue("")
    expect(screen.queryByText(/disponible en lunacell bodega/i)).not.toBeInTheDocument()
    expect(ubicacionesDe("Cargador")).toHaveLength(4)
  })

  /*
    La base no le devuelve nada a un vendedor sin ubicación. Decirle «no hay
    existencias» sería mentirle: el problema es la asignación.
  */
  it("el vendedor sin ubicación recibe el motivo, no un inventario vacío", async () => {
    await renderInventory({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicaciones: [],
      existencias: [],
    })

    expect(screen.getByRole("note")).toHaveTextContent(/pide al administrador que te asigne una/i)
    expect(screen.queryByText(/todav[íi]a no hay existencias/i)).not.toBeInTheDocument()
    expect(document.querySelector(".inventory-ubicacion-actual")).toBeNull()
  })

  it("si su ubicación no llegó, avisa y no elige otra por él", async () => {
    await renderInventory({ ubicacionOperativa: "u-desactivada" })

    expect(screen.getByRole("note")).toHaveTextContent(/no está entre las que puedes consultar/i)
    expect(selector()).toHaveValue("")
    expect(tablaDeUbicacion()).toBeNull()
  })

  it("al elegir una ubicación el aviso se retira", async () => {
    await renderInventory()

    fireEvent.change(selector(), { target: { value: "u-c1" } })

    expect(screen.queryByRole("note")).not.toBeInTheDocument()
  })
})

describe("Inventory · estados", () => {
  it("avisa cuando no hay nada que mostrar", async () => {
    await renderInventory({
      productos: [],
      ubicaciones: [],
      existencias: [],
      esperar: [],
    })

    expect(
      screen.getByText(/todav[íi]a no hay existencias que mostrar/i)
    ).toBeInTheDocument()
  })

  /*
    Un fallo de la consulta no puede verse como «no hay existencias»: el
    primero se arregla reintentando y el segundo mandando mercadería.
  */
  it("muestra el motivo cuando la consulta falla", async () => {
    await renderInventory({
      esperar: [],
      fallarEn: {
        existencias_por_ubicacion: { message: "connection refused" },
      },
    })

    expect(
      await screen.findByText(/no se pudieron cargar las existencias/i)
    ).toBeInTheDocument()

    expect(
      screen.queryByText(/todav[íi]a no hay existencias que mostrar/i)
    ).not.toBeInTheDocument()
  })

  it("no expone costo, precio ni utilidad", async () => {
    await renderInventory()

    /* Los productos de prueba cuestan 80 y 70, y se venden a 120 y 100. */
    expect(screen.queryByText(/80/)).not.toBeInTheDocument()
    expect(screen.queryByText(/120\.00/)).not.toBeInTheDocument()
    expect(screen.queryByText(/costo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/utilidad/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/margen/i)).not.toBeInTheDocument()
  })
})

/*
  INV-4.1: desde Existencias se llega a Traslados con el mismo permiso que
  protege su ruta. No es una regla nueva: es la de la ruta, preguntada con
  hasPermission().
*/
describe("Existencias: acceso a Traslados", () => {
  const enlace = () => screen.queryByRole("link", { name: /traslados/i })

  it("el administrador ve el enlace a Traslados", async () => {
    await renderInventory()

    expect(enlace()).toHaveAttribute("href", "/inventory/transfers")
  })

  it("quien ve el inventario de su ubicación también lo ve", async () => {
    await renderInventory({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "u-c1",
    })

    expect(enlace()).toBeInTheDocument()
  })

  it("sin permiso de inventario no aparece", async () => {
    await renderInventory({ rolDelUsuario: "vendedor", permisosDelUsuario: ["pos"] })

    expect(enlace()).not.toBeInTheDocument()
  })
})

describe("Inventory · cantidades al día", () => {
  /*
    Una venta sincronizada desde el modo sin conexión ya descontó en el
    servidor: la pantalla vuelve a pedir la existencia sin recargar.
  */
  it("al sincronizar ventas vuelve a pedir las existencias", async () => {
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    expect(celdasDe("Cargador")).toEqual(["15", "30"])

    const celda = globalThis.__supabaseFalso.datos.inventario_ubicacion.find(
      (c) => c.ubicacion_id === "u-bodega" && c.producto_id === "p-cargador"
    )
    celda.cantidad = 14

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_VENTAS_SINCRONIZADAS, { detail: { registradas: 1 } }))
    })

    await waitFor(() => expect(celdasDe("Cargador")).toEqual(["14", "29"]))
  })

  /*
    La elección no se guarda en el navegador: una sesión nueva vuelve a
    abrir en la ubicación del usuario, no en la última que se miró.
  */
  it("una sesión nueva vuelve a abrir en la ubicación del usuario", async () => {
    const { unmount } = await renderInventory({ ubicacionOperativa: "u-bodega" })

    fireEvent.change(selector(), { target: { value: "u-c2" } })
    expect(ubicacionActual()).toBe("Camión 02")

    unmount()
    await renderInventory({ ubicacionOperativa: "u-bodega" })

    expect(ubicacionActual()).toBe("Lunacell Bodega")
  })
})

describe("Inventory · listas largas", () => {
  const MUCHOS = Array.from({ length: 30 }, (_, i) => ({
    id: `p-${String(i).padStart(2, "0")}`,
    code: `COD-${String(i).padStart(2, "0")}`,
    name: `Producto ${String(i).padStart(2, "0")}`,
    category: "Varios",
    price: 10,
    costPrice: 5,
    stock: 0,
    minStock: 1,
    supplierId: "",
  }))

  it("reparte en páginas de 25 y vuelve a la primera al buscar", async () => {
    await renderInventory({ productos: MUCHOS, existencias: [] })

    expect(productosVisibles()).toHaveLength(25)
    expect(screen.getByText("1–25 de 30")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }))

    expect(productosVisibles()).toEqual(["Producto 25", "Producto 26", "Producto 27", "Producto 28", "Producto 29"])

    buscar("Producto 0")

    expect(productosVisibles()).toHaveLength(10)
    expect(screen.queryByRole("navigation", { name: /páginas de existencias/i })).not.toBeInTheDocument()
  })

  /*
    Con más de cinco ubicaciones las columnas no caben: cada producto
    resume en cuántas hay existencia y despliega el detalle.
  */
  it("con muchas ubicaciones, cada producto despliega su detalle", async () => {
    const SEIS = [
      ...UBICACIONES,
      { id: "u-c3", name: "Camión 03", type: "camion" },
      { id: "u-c4", name: "Camión 04", type: "camion" },
    ]

    await renderInventory({ ubicaciones: SEIS })

    expect(columnasDeUbicacion()).toEqual([])
    expect(within(filaDe("Cargador")).getByText("3 de 6")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Ver ubicaciones de Cargador" }))

    const detalle = screen.getByRole("list", { name: "Ubicaciones de Cargador" })

    expect(within(detalle).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Camión 013",
      "Camión 0212",
      "Camión 030 · sin existencia",
      "Camión 040 · sin existencia",
      "Lunacell Bodega15",
      "Lunacell Store0 · sin existencia",
    ])
    expect(screen.getByRole("button", { name: "Ocultar ubicaciones de Cargador" })).toHaveAttribute("aria-expanded", "true")
  })
})
