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
  Pulsa "Agregar" en la fila del catálogo. El nombre del producto aparece
  también en el carrito, así que se toma la primera aparición —el catálogo
  se dibuja antes— y se busca el botón dentro de esa fila.
*/
export const agregarProducto = (nombre) => {
  const fila = screen.getAllByText(nombre)[0].closest("div").parentElement

  fireEvent.click(within(fila).getAllByRole("button", { name: /agregar/i })[0])
}

const DATOS_DEL_CLIENTE = {
  nombre: "Taller Nuevo",
  rtn: "0801199912345",
  telefono: "9999-1111",
  direccion: "San Pedro Sula",
}

/*
  Rellena el formulario de alta. Los valores por omisión sirven para las
  pruebas a las que solo les importa que el cliente quede creado; las que
  comprueban un dato concreto pasan el suyo.
*/
export const llenarAltaDeCliente = (datos = {}) => {
  const { nombre, rtn, telefono, direccion } = { ...DATOS_DEL_CLIENTE, ...datos }
  const modal = modalDeCliente()

  const escribir = (etiqueta, valor) =>
    fireEvent.change(modal.getByLabelText(etiqueta), { target: { value: valor } })

  escribir(/^nombre$/i, nombre)
  escribir(/^rtn/i, rtn)
  escribir(/^teléfono$/i, telefono)
  escribir(/^dirección$/i, direccion)
}

export const guardarCliente = () =>
  fireEvent.click(screen.getByRole("button", { name: /guardar cliente/i }))

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
