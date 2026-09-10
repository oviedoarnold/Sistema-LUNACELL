import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import QuotesProvider from "../context/QuotesContext"
import { renderizarPantalla } from "../test/pantallas"
import { traerCotizaciones, conFormaDeApp } from "../lib/api/cotizaciones"
import Quotes from "./Quotes"

/*
  Guardar una cotización y facturarla, recorriendo la pantalla de verdad.

  El defecto que estas pruebas atrapan: al guardar, la pantalla leía
  `item.productId` de la línea de carrito, campo que una línea no tiene
  —lleva `id`—, así que el renglón se guardaba con producto_id nulo. Al
  releer la cotización ya no había forma de volver a encontrar el producto
  y facturarla avisaba "ya no está en el inventario" de un producto que
  estaba ahí, con existencia.

  Las pruebas que ya existían no lo veían porque inyectaban la cotización
  escrita a mano, con `productId` ya puesto: partían de una fila que la
  aplicación nunca llega a producir. Estas no inventan nada — pulsan
  "Generar y guardar cotización" y después "Facturar"—, que es la única
  forma de recorrer el paso que fallaba.
*/

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

// El Cargador real: mismo identificador, código y existencia que en la base.
const CARGADOR = {
  id: "6d25d3c2-fdad-4216-8318-d2f3fe1d8398",
  code: "11",
  name: "Cargador",
  category: "Accesorios",
  price: 250,
  stock: 7,
  minStock: 5,
}

const PRODUCTOS = [CARGADOR]

/*
  Hace visible el borrador con el que se llega al punto de venta. Sin esto
  la navegación ocurre pero no se puede comprobar qué se llevó.
*/
function SondaDelPuntoDeVenta() {
  const { state } = useLocation()

  return (
    <div data-testid="pos">
      {(state?.saleDraft?.cart || [])
        .map((linea) => String(linea.id))
        .join(",")}
    </div>
  )
}

function renderQuotes() {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <QuotesProvider>
            <MemoryRouter initialEntries={["/quotes"]}>
              <Routes>
                <Route path="/quotes" element={<Quotes />} />
                <Route path="/pos" element={<SondaDelPuntoDeVenta />} />
              </Routes>
            </MemoryRouter>
          </QuotesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { productos: PRODUCTOS, cotizaciones: [], esperar: ["cotizaciones"] }
  )
}

const agregarAlCarrito = (nombre) => {
  const fila = screen.getAllByText(nombre)[0].closest("div").parentElement

  fireEvent.click(within(fila).getAllByRole("button", { name: /agregar/i })[0])
}

const guardarCotizacion = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /generar y guardar cotización/i })
  )

const facturar = () =>
  fireEvent.click(screen.getAllByRole("button", { name: /^facturar$/i })[0])

const avisoDeProblemas = () =>
  Swal.fire.mock.calls.find(
    ([opciones]) => opciones?.title === "Hay productos con problemas"
  )

/*
  Deja una cotización con el producto ya guardada y devuelve el doble de
  la base, para poder mirar la fila que quedó escrita.
*/
const guardarCotizacionCon = async (nombre) => {
  const { falso } = await renderQuotes()

  agregarAlCarrito(nombre)
  guardarCotizacion()

  await waitFor(() =>
    expect(falso.datos.detalle_cotizacion.length).toBeGreaterThan(0)
  )

  return falso
}

describe("guardar una cotización deja el renglón enlazado al producto", () => {
  it("persiste producto_id con el identificador real del producto", async () => {
    // Arrange / Act
    const falso = await guardarCotizacionCon("Cargador")

    // Assert
    const [renglon] = falso.datos.detalle_cotizacion

    expect(renglon.producto_id).toBe("6d25d3c2-fdad-4216-8318-d2f3fe1d8398")
    expect(renglon.producto_id).toBe(CARGADOR.id)
  })

  it("no lo guarda nulo ni indefinido", async () => {
    const falso = await guardarCotizacionCon("Cargador")

    const [renglon] = falso.datos.detalle_cotizacion

    expect(renglon.producto_id).toBeDefined()
    expect(renglon.producto_id).not.toBeNull()
  })

  it("conserva además el nombre y el código de cuando se cotizó", async () => {
    const falso = await guardarCotizacionCon("Cargador")

    const [renglon] = falso.datos.detalle_cotizacion

    expect(renglon.nombre).toBe("Cargador")
    expect(renglon.codigo).toBe("11")
  })

  /*
    Ida y vuelta completa: lo que se guardó tiene que volver con el mismo
    identificador, porque es lo que se usa para reencontrar el producto.
  */
  it("al releer la cotización conserva el identificador real", async () => {
    await guardarCotizacionCon("Cargador")

    const [cotizacion] = conFormaDeApp(await traerCotizaciones(), {})
    const [renglon] = cotizacion.items

    expect(renglon.productId).toBe(CARGADOR.id)
    expect(renglon.id).toBe(CARGADOR.id)
  })
})

describe("facturar una cotización recién guardada", () => {
  /*
    El escenario del usuario: el Cargador existe, está en el catálogo y
    tiene 7 unidades. Facturar no debería avisar de nada.
  */
  it("no dice que el producto ya no está en el inventario", async () => {
    // Arrange
    await guardarCotizacionCon("Cargador")
    Swal.fire.mockClear()

    // Act
    facturar()

    // Assert
    await waitFor(() =>
      expect(screen.getByTestId("pos")).toBeInTheDocument()
    )

    expect(avisoDeProblemas()).toBeUndefined()
  })

  it("no avisa de ningún problema de existencias", async () => {
    await guardarCotizacionCon("Cargador")
    Swal.fire.mockClear()

    facturar()

    await waitFor(() => expect(screen.getByTestId("pos")).toBeInTheDocument())

    const textos = Swal.fire.mock.calls.map(([o]) => o?.text || "").join(" ")

    expect(textos).not.toContain("ya no está en el inventario")
  })

  /*
    Llegar al punto de venta no basta: tiene que llegar con el producto
    identificado, o la venta no sabría qué descargar del inventario.
  */
  it("llega al punto de venta con el producto identificado", async () => {
    await guardarCotizacionCon("Cargador")

    facturar()

    await waitFor(() => expect(screen.getByTestId("pos")).toBeInTheDocument())

    expect(screen.getByTestId("pos")).toHaveTextContent(CARGADOR.id)
  })

  it("el producto conserva su existencia real: la cotización no la toca", async () => {
    const falso = await guardarCotizacionCon("Cargador")

    const existencia = falso.datos.movimientos_inventario
      .filter((m) => m.producto_id === CARGADOR.id)
      .reduce((suma, m) => suma + m.cantidad, 0)

    expect(existencia).toBe(7)
  })
})
