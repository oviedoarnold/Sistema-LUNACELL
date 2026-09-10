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

  /*
    Marca el alta en curso. Sin esto el botón admite un segundo clic
    mientras la base todavía responde, y el cliente se da de alta dos veces.
  */
  const [guardando, setGuardando] = useState(false)

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

  /*
    addClient consulta la base y devuelve el cliente ya creado, con el
    identificador que le asignó PostgreSQL. Hay que esperarlo.

    Antes no se esperaba, y lo que quedaba seleccionado era la promesa: un
    objeto que pasa cualquier comprobación que solo mire si hay algo, pero
    cuyo .id es undefined. Al facturar al crédito el identificador viajaba
    como null y la venta la rechazaba la restricción credito_exige_cliente
    ya en la base, con el cajero habiendo capturado todo. El try/catch
    tampoco servía: un rechazo asíncrono no se atrapa alrededor de una
    llamada sin await.

    El modal se cierra y el éxito se anuncia solo después de que la base
    confirmó. Si falla, lo capturado sigue ahí para reintentar.
  */
  const guardarNuevo = async () => {
    if (guardando) return

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

    setGuardando(true)

    try {
      const nuevo = await addClient({
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
    } finally {
      setGuardando(false)
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
    guardando,

    seleccionar,
    escribirBusqueda,
    soltar,

    abrirAlta,
    cerrarAlta,
    guardarNuevo,
  }
}
