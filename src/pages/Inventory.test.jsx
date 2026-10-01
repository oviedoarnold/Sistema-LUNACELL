import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
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
      <Inventory />
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

const bloqueDe = (producto) =>
  screen.getByRole("heading", { name: producto }).closest(".inventory-producto")

const ubicacionesDe = (producto) =>
  within(bloqueDe(producto))
    .getAllByRole("row")
    .slice(1)
    .map((fila) => fila.querySelector(".product-name").textContent)

/*
  El total y una cantidad pueden coincidir —un producto en una sola
  ubicación tiene el mismo número arriba y en su fila—, así que se
  consultan por su sitio y no por su texto.
*/
const totalDe = (producto) =>
  bloqueDe(producto).querySelector(".inventory-total strong").textContent

const cantidadesDe = (producto) =>
  [...bloqueDe(producto).querySelectorAll(".inventory-cantidad")].map(
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

    const cargador = within(bloqueDe("Cargador"))

    expect(cargador.getByText("Bodega")).toBeInTheDocument()
    expect(cargador.getByText("Tienda")).toBeInTheDocument()
    expect(cargador.getAllByText("Camión")).toHaveLength(2)
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
      within(bloqueDe("Cargador")).getByText(/0 · sin existencia/)
    ).toBeInTheDocument()
  })

  it("un producto sin existencia en ninguna parte sale con total cero", async () => {
    await renderInventory()

    const cubo = within(bloqueDe("Cubo Iphone"))

    expect(cubo.getAllByText(/0 · sin existencia/)).toHaveLength(4)
    expect(cubo.getByText("0")).toBeInTheDocument()
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
      screen.queryByLabelText(/filtrar por ubicación/i)
    ).not.toBeInTheDocument()
  })

  it("el selector solo ofrece las ubicaciones recibidas", async () => {
    await renderInventory()

    const selector = screen.getByLabelText(/filtrar por ubicación/i)
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

    expect(screen.getByRole("heading", { name: "Cubo Iphone" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Cargador" })).not.toBeInTheDocument()
  })

  it("busca por código", async () => {
    await renderInventory()

    buscar("LCCOBER")

    expect(screen.getByRole("heading", { name: "Cargador" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Cubo Iphone" })).not.toBeInTheDocument()
  })

  it("ignora tildes y mayúsculas", async () => {
    await renderInventory()

    buscar("IPHONE")

    expect(screen.getByRole("heading", { name: "Cubo Iphone" })).toBeInTheDocument()
  })

  it("avisa cuando nada coincide", async () => {
    await renderInventory()

    buscar("zzzznoexiste")

    expect(screen.getByText(/ningún producto coincide/i)).toBeInTheDocument()
  })
})

describe("Inventory · filtro por ubicación", () => {
  it("deja solo la ubicación elegida, sin cambiar el recorrido", async () => {
    await renderInventory()

    fireEvent.change(screen.getByLabelText(/filtrar por ubicación/i), {
      target: { value: "u-c2" },
    })

    /* Siguen siendo productos con sus ubicaciones; la lista queda en una. */
    expect(ubicacionesDe("Cargador")).toEqual(["Camión 02"])
    expect(cantidadesDe("Cargador")).toEqual(["12"])
    expect(totalDe("Cargador")).toBe("12")
  })

  it("se puede volver a todas", async () => {
    await renderInventory()

    const selector = screen.getByLabelText(/filtrar por ubicación/i)

    fireEvent.change(selector, { target: { value: "u-c2" } })
    fireEvent.change(selector, { target: { value: "" } })

    expect(ubicacionesDe("Cargador")).toHaveLength(4)
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
