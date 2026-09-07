import { createContext } from "react"

/*
  Los objetos de contexto viven aparte de sus
  proveedores para que editar un proveedor no
  invalide el recargado en caliente.
*/
export const AuthContext = createContext(null)
export const ClientsContext = createContext(null)
export const ProductContext = createContext(null)
export const QuotesContext = createContext(null)
export const SalesContext = createContext(null)
