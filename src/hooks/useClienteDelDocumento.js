import { useState } from "react"
import Swal from "sweetalert2"

const FORMULARIO_DE_CLIENTE_VACIO = {
  name: "",
  rtn: "",
  phone: "",
  address: "",
  email: "",
}

/*
  Selección y alta de cliente, compartidas por el punto de venta y las
  cotizaciones.

  Las dos pantallas necesitan lo mismo: un campo de búsqueda que se limpia
  al escribir encima de un cliente ya elegido, y un formulario para dar de
  alta a uno que todavía no existe, que arrastra lo que se venía
  escribiendo.

  alCambiar avisa de la nueva selección —o de null al soltarla— para lo que
  cada pantalla tenga colgado del cliente. Hoy lo usa el punto de venta para
  el RTN del comprador, que las cotizaciones no piden. Es un solo enganche a
  propósito: con dos ya convendría partir el hook.
*/
export function useClienteDelDocumento({
  addClient,
  clienteInicial = null,
  busquedaInicial = "",
  alCambiar = () => {},
}) {
  const [busqueda, setBusqueda] = useState(busquedaInicial)
  const [seleccionado, setSeleccionado] = useState(clienteInicial)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [formulario, setFormulario] = useState(FORMULARIO_DE_CLIENTE_VACIO)

  const seleccionar = (cliente) => {
    setSeleccionado(cliente)
    setBusqueda(cliente.name)
    alCambiar(cliente)
  }

  /*
    Escribir encima de un cliente elegido lo suelta: lo que quedó en el
    campo ya no es ese cliente, y dejarlo seleccionado facturaría a nombre
    de alguien que el usuario acaba de descartar.
  */
  const escribirBusqueda = (valor) => {
    setBusqueda(valor)

    if (seleccionado) {
      setSeleccionado(null)
      alCambiar(null)
    }
  }

  const soltar = () => {
    setSeleccionado(null)
    setBusqueda("")
    alCambiar(null)
  }

  const abrirAlta = () => {
    setFormulario({
      ...FORMULARIO_DE_CLIENTE_VACIO,
      name: busqueda.trim(),
    })

    setModalAbierto(true)
  }

  const cerrarAlta = () => setModalAbierto(false)

  const guardarNuevo = () => {
    const name = formulario.name.trim()
    const phone = formulario.phone.trim()
    const address = formulario.address.trim()

    if (!name || !phone || !address) {
      Swal.fire({
        icon: "warning",
        title: "Faltan datos",
        text: "Nombre, teléfono y dirección son obligatorios.",
      })

      return
    }

    try {
      const nuevo = addClient({
        ...formulario,
        name,
        phone,
        address,
        rtn: formulario.rtn.trim(),
        email: formulario.email.trim(),
      })

      setModalAbierto(false)

      if (nuevo) {
        seleccionar(nuevo)
      }

      Swal.fire({ icon: "success", title: "Cliente guardado" })
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "No se pudo guardar el cliente",
        text: error.message,
      })
    }
  }

  return {
    busqueda,
    setBusqueda,
    seleccionado,
    setSeleccionado,

    formulario,
    setFormulario,
    modalAbierto,

    seleccionar,
    escribirBusqueda,
    soltar,

    abrirAlta,
    cerrarAlta,
    guardarNuevo,
  }
}
