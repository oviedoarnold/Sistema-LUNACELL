import { screen, fireEvent, within } from "@testing-library/react"

/*
  Ayudantes para manejar el carrito y el alta de cliente desde las pruebas.

  El punto de venta y las cotizaciones montan el mismo carrito y el mismo
  formulario de cliente, así que sus pruebas los manipulan igual. Estaban
  escritos dos veces, que es la misma duplicación que este refactor vino a
  quitar del código.
*/

export const filasDelCarrito = () => [
  ...document.querySelectorAll(".cart-row"),
]

export const filaDelCarrito = (nombre) =>
  filasDelCarrito().find((fila) => fila.textContent.includes(nombre))

/*
  El nombre del producto aparece en el catálogo y en el carrito, así que
  hay que buscar el botón dentro de su fila y no en toda la pantalla.
*/
export const paso = (nombre, signo) =>
  fireEvent.click(
    within(filaDelCarrito(nombre)).getByRole("button", { name: signo })
  )

export const quitarDelCarrito = (nombre) =>
  fireEvent.click(within(filaDelCarrito(nombre)).getByTitle(/eliminar/i))

/*
  Las aserciones sobre el formulario se acotan al modal: la pantalla de
  venta tiene su propio campo de RTN, y sin acotar la consulta encuentra
  dos.
*/
export const modalDeCliente = () =>
  within(document.querySelector(".modal"))

export const abrirClienteNuevo = (buscadorDeCliente) => {
  fireEvent.focus(screen.getByPlaceholderText(buscadorDeCliente))
  fireEvent.click(screen.getByText(/registrar cliente nuevo/i))
}

/*
  Los cinco campos que pide el alta, con el texto de su etiqueta.
*/
export const CAMPOS_DEL_CLIENTE = [
  /^nombre$/i,
  /^rtn/i,
  /^teléfono$/i,
  /^correo$/i,
  /^dirección$/i,
]
