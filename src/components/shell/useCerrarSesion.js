import { useNavigate } from "react-router-dom"
import Swal from "sweetalert2"

import { useAuth } from "../../hooks/useAuth"
import { useSinConexion } from "../../hooks/useSinConexion"

/*
  Cerrar sesión desde cualquier lugar del panel: la barra lateral y, en el
  teléfono, la barra superior. Las dos llaman a esto, así que la salida y
  su aviso son siempre los mismos.

  Con ventas guardadas solo en el teléfono, cerrar sesión no las borra,
  pero se avisa: se envían cuando ese usuario vuelva a entrar con
  conexión, y sin conexión no podrá volver a entrar hasta que vuelva.
*/
export function useCerrarSesion() {
  const { logout } = useAuth()
  const sinConexion = useSinConexion()
  const navigate = useNavigate()

  const confirmarSalida = async () => {
    const sinConfirmar = sinConexion?.sinConfirmar || 0

    if (sinConfirmar === 0) return true

    const sinServidor = sinConexion.conexion !== "en_linea"
    const respuesta = await Swal.fire({
      icon: "warning",
      title: "Hay ventas sin sincronizar",
      text: `Tienes ${sinConfirmar} ${sinConfirmar === 1 ? "venta guardada" : "ventas guardadas"} solo en este teléfono. No se borran: se enviarán cuando vuelvas a entrar con tu usuario y haya conexión.${sinServidor ? " Sin conexión no podrás volver a entrar hasta que vuelva." : ""} Si vas a entregar el teléfono, guarda antes un respaldo cifrado.`,
      showCancelButton: true,
      confirmButtonText: "Cerrar sesión igual",
      cancelButtonText: "Volver",
    })

    return respuesta.isConfirmed
  }

  return async () => {
    if (!(await confirmarSalida())) return

    await logout()
    navigate("/login")
  }
}

// Lo que se muestra de la cuenta en sesión, igual en las dos barras.
export function datosDeLaCuenta(user) {
  const iniciales = user?.name
    ? user.name
        .split(" ")
        .map((parte) => parte[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "US"

  return {
    iniciales,
    nombre: user?.name || "Usuario",
    rol: user?.role === "admin" ? "Administrador" : "Vendedor",
  }
}
