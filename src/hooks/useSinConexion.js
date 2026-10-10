import { useContext } from "react"

import { SinConexionContext } from "../context/contexts"

/*
  El estado del modo sin conexión, o null si la pantalla está fuera de su
  proveedor. Con null todo funciona como antes: solo en línea.
*/
export function useSinConexion() {
  return useContext(SinConexionContext)
}
