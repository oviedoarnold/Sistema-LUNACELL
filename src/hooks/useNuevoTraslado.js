import { useRef, useState } from "react"
import Swal from "sweetalert2"

import { registrarTraslado } from "../lib/api/traslados"
import {
  agregarAlTraslado,
  cantidadValida,
  escribirCantidad,
  quitarDelTraslado,
  resumenDelTraslado,
  revalidarParaOrigen,
  sumarAlRenglon,
} from "../utils/carritoDeTraslado"
import { claveDeIdempotencia } from "../utils/ids"

/*
  El estado del formulario «Nuevo traslado»: de dónde, hacia dónde, qué
  productos, cuántos y la observación.

  Vive en la pantalla y no en la ventana, así que cerrarla no borra lo
  preparado. Registrar es UNA llamada a registrar_traslado(), la misma de
  siempre: quién puede, desde dónde y si alcanza lo decide la base. Aquí
  solo se evita ofrecer o pedir lo que la pantalla ya sabe que no se puede:

  - quien ve todas las ubicaciones elige cualquier origen activo, y se le
    propone su ubicación operativa;
  - quien solo ve la suya traslada DESDE ella, hacia cualquier otra.
*/
export function useNuevoTraslado({
  veTodas,
  propia,
  ubicacionesActivas,
  existencias,
  nombreUbicacion,
  nombreProducto,
  alRegistrar,
}) {
  const [origenElegido, setOrigenElegido] = useState("")
  const [destino, setDestino] = useState("")
  const [carrito, setCarrito] = useState([])
  const [nota, setNota] = useState("")
  const [aviso, setAviso] = useState("")
  const [guardando, setGuardando] = useState(false)

  // Un intento de traslado, no un clic: se renueva solo cuando se registra.
  const [clave, setClave] = useState(claveDeIdempotencia)

  // El estado se pinta en el render siguiente; dos clics seguidos no lo verían.
  const enviando = useRef(false)

  const origenes = veTodas ? ubicacionesActivas : ubicacionesActivas.filter((u) => u.id === propia)

  /*
    Quien solo ve su ubicación no elige: el origen es la suya. Quien ve
    todas parte de su ubicación operativa, si está activa, y puede cambiarla.
  */
  const propuesto = origenes.some((u) => u.id === propia) ? propia : ""
  const origen = veTodas ? origenElegido || propuesto : origenes[0]?.id || ""
  const sinOrigen = !veTodas && !origen

  const destinos = ubicacionesActivas.filter((u) => u.id !== origen)

  /*
    Lo que se puede trasladar sale de la existencia de la UBICACIÓN de
    origen, nunca del stock global: un producto con 20 en total y 0 en este
    camión no se ofrece. Si la existencia cambia entre esta lectura y el
    traslado, registrar_traslado lo rechaza igual (LT005).
  */
  const disponiblesEn = (ubicacion) =>
    ubicacion ? existencias.filter((e) => e.locationId === ubicacion && e.quantity > 0) : []

  const disponibles = disponiblesEn(origen)
  const sinExistencias = Boolean(origen) && disponibles.length === 0

  const disponible = (productId) => disponibles.find((e) => e.productId === productId)?.quantity ?? 0

  /*
    Otro origen es otra referencia: lo elegido se vuelve a medir contra la
    existencia del origen nuevo y se dice qué se retiró o se ajustó.
  */
  const pasarAOrigen = (nuevoOrigen) => {
    const nuevos = disponiblesEn(nuevoOrigen)
    const enNuevo = (productId) => nuevos.find((e) => e.productId === productId)?.quantity ?? 0
    const { carrito: revisado, retirados, ajustados } = revalidarParaOrigen(carrito, enNuevo)

    setCarrito(revisado)

    const partes = []
    if (retirados.length > 0) {
      partes.push(`se retiró ${retirados.map((id) => nombreProducto(id)).join(", ")}, sin existencia en ${nombreUbicacion(nuevoOrigen)}`)
    }
    if (ajustados.length > 0) {
      partes.push(`se ajustó a lo disponible ${ajustados.map((id) => nombreProducto(id)).join(", ")}`)
    }

    setAviso(partes.length > 0 ? `Cambió el origen: ${partes.join("; ")}.` : "")
  }

  const cambiarOrigen = (valor) => {
    setOrigenElegido(valor)
    if (valor === destino) setDestino("")
    pasarAOrigen(valor)
  }

  // Origen ↔ destino, solo para quien puede elegir el origen y con los dos elegidos.
  const puedeIntercambiar = veTodas && Boolean(origen) && Boolean(destino)

  const intercambiar = () => {
    if (!puedeIntercambiar) return

    const anterior = origen
    setOrigenElegido(destino)
    setDestino(anterior)
    pasarAOrigen(destino)
  }

  const agregar = (productId) => {
    const { carrito: nuevo, agregado } = agregarAlTraslado(carrito, productId, disponible(productId))

    setCarrito(nuevo)
    setAviso(
      agregado
        ? ""
        : `Ya están todas las unidades disponibles de ${nombreProducto(productId)} (${disponible(productId)} en ${nombreUbicacion(origen)}).`
    )

    return agregado
  }

  const sumar = (productId, cambio) => setCarrito((actual) => sumarAlRenglon(actual, productId, cambio, disponible(productId)))
  const escribir = (productId, texto) => setCarrito((actual) => escribirCantidad(actual, productId, texto))
  const quitar = (productId) => {
    setCarrito((actual) => quitarDelTraslado(actual, productId))
    setAviso("")
  }

  const resumen = resumenDelTraslado(carrito)
  const cantidadesValidas = carrito.every((r) => cantidadValida(r.cantidad, disponible(r.productId)))

  const puedeEnviar =
    !guardando && Boolean(origen) && Boolean(destino) && origen !== destino && carrito.length > 0 && cantidadesValidas

  // Las comprobaciones de siempre, por si algo llega aquí sin pasar por el botón.
  const enviar = async () => {
    if (enviando.current) return

    const items = carrito.map((r) => ({ productId: r.productId, qty: Number(r.cantidad) }))

    if (!origen || !destino) {
      Swal.fire({ icon: "warning", title: "Faltan datos", text: "Elige el origen y el destino del traslado." })
      return
    }

    if (items.length === 0 || items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) {
      Swal.fire({
        icon: "warning",
        title: "Revisa los productos",
        text: "Cada producto necesita una cantidad entera mayor que cero.",
      })
      return
    }

    const excedidos = items.filter((i) => i.qty > disponible(i.productId))

    if (excedidos.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Cantidad mayor que la disponible",
        text: excedidos
          .map((i) => `${nombreProducto(i.productId)}: hay ${disponible(i.productId)} en ${nombreUbicacion(origen)}, pides ${i.qty}.`)
          .join(" "),
      })
      return
    }

    enviando.current = true
    setGuardando(true)

    try {
      await registrarTraslado({ origenId: origen, destinoId: destino, items, nota: nota.trim() }, { clave })

      setClave(claveDeIdempotencia())
      setCarrito([])
      setNota("")
      setAviso("")

      await alRegistrar()

      // Desde la 0056 el destino lo suma al confirmar la recepción.
      Swal.fire({ icon: "success", title: "Traslado enviado", text: `Queda pendiente de recepción en ${nombreUbicacion(destino)}.` })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se pudo trasladar", text: problema.message })
    } finally {
      enviando.current = false
      setGuardando(false)
    }
  }

  return {
    origen,
    origenes,
    destino,
    destinos,
    sinOrigen,
    sinExistencias,
    disponibles,
    disponible,
    carrito,
    resumen,
    nota,
    aviso,
    guardando,
    puedeEnviar,
    puedeIntercambiar,
    puedeElegirOrigen: veTodas,
    estaEnviando: () => enviando.current,
    cambiarOrigen,
    setDestino,
    intercambiar,
    agregar,
    sumar,
    escribir,
    quitar,
    setNota,
    enviar,
  }
}
