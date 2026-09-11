import {
  FaBox,
  FaCashRegister,
  FaCog,
  FaFileAlt,
  FaHistory,
  FaHome,
  FaTruck,
  FaUsers,
  FaWarehouse,
} from "react-icons/fa"

import { PERMISSIONS } from "../../context/permissions"

/*
  El menú del panel: qué módulos hay, cómo se llaman y en qué grupo van.

  Es la única lista de este tipo en el sistema. La barra lateral la dibuja
  y la barra superior saca de ella el título de la página, de modo que el
  nombre de un módulo se escribe una sola vez.

  Los permisos no se deciden aquí: cada entrada nombra el suyo y quien
  dibuja el menú pregunta a hasPermission, igual que hacía la navegación
  anterior. Esto es una lista de presentación, no una regla de acceso.

  Los grupos son solo agrupación visual. Ninguno añade rutas: los nueve
  módulos son exactamente los que ya existen en NAV_ROUTES, y una prueba
  comprueba que las dos listas no se separen.

  No se incluyen módulos que todavía no existen —cuentas por cobrar,
  reportes, traslados, kardex—: un menú con elementos muertos invita a
  pulsarlos.
*/

export const GRUPOS_DEL_MENU = [
  {
    titulo: "Principal",
    modulos: [
      {
        to: "/dashboard",
        label: "Dashboard",
        Icono: FaHome,
        permiso: PERMISSIONS.DASHBOARD,
      },
    ],
  },
  {
    titulo: "Operación",
    modulos: [
      {
        to: "/pos",
        label: "Facturar",
        Icono: FaCashRegister,
        permiso: PERMISSIONS.POS,
      },
      {
        to: "/quotes",
        label: "Cotizar",
        Icono: FaFileAlt,
        permiso: PERMISSIONS.QUOTES,
      },
    ],
  },
  {
    titulo: "Inventario",
    modulos: [
      {
        to: "/products",
        label: "Inventario",
        Icono: FaBox,
        permiso: PERMISSIONS.PRODUCTS,
      },
      {
        to: "/locations",
        label: "Ubicaciones",
        Icono: FaWarehouse,
        permiso: PERMISSIONS.LOCATIONS,
      },
    ],
  },
  {
    titulo: "Comercial",
    modulos: [
      {
        to: "/clients",
        label: "Clientes",
        Icono: FaUsers,
        permiso: PERMISSIONS.CLIENTS,
      },
      {
        to: "/suppliers",
        label: "Proveedores",
        Icono: FaTruck,
        permiso: PERMISSIONS.SUPPLIERS,
      },
    ],
  },
  {
    titulo: "Control",
    modulos: [
      {
        to: "/sales-history",
        label: "Historial",
        Icono: FaHistory,
        permiso: PERMISSIONS.SALES_HISTORY,
      },
    ],
  },
  {
    titulo: "Administración",
    modulos: [
      {
        to: "/settings",
        label: "Configuración",
        Icono: FaCog,
        permiso: PERMISSIONS.SETTINGS,
      },
    ],
  },
]

export const MODULOS_DEL_MENU = GRUPOS_DEL_MENU.flatMap(
  (grupo) => grupo.modulos
)

/*
  El título que muestra la barra superior. Sale de la misma etiqueta del
  menú para que no haya dos nombres para el mismo módulo.
*/
export function tituloDeLaRuta(pathname) {
  const modulo = MODULOS_DEL_MENU.find(
    (candidato) =>
      pathname === candidato.to || pathname.startsWith(`${candidato.to}/`)
  )

  return modulo?.label || ""
}
