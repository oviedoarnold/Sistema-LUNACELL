import { useEffect, useId, useRef, useState } from "react"
import { FaEllipsisV, FaSearch } from "react-icons/fa"

import EmptyState from "../crud/EmptyState"
import Paginacion from "../crud/Paginacion"
import SearchInput from "../crud/SearchInput"
import ModalShell from "../forms/ModalShell"
import { PERMISSIONS, ROLES } from "../../context/permissions"
import { coincideBusqueda } from "../../utils/texto"
import { rebanada } from "../../utils/paginacion"

/*
  La lista de usuarios de Configuración.

  Solo presentación: quién aparece lo decide la consulta de siempre, y cada
  acción llama al mismo manejador de antes, con sus confirmaciones. Lo que
  cambia es cómo se ve: una fila compacta por usuario, los permisos en un
  resumen («8 permisos · Ver») en vez de una columna de fichas que estiraba
  la fila, y las acciones en un menú.
*/

const POR_PAGINA = 10

/*
  Grupos solo para leer la lista de permisos: no cambian cómo se guardan ni
  cómo se conceden. Un permiso que no esté aquí cae en «Otros».
*/
const GRUPOS_DE_PERMISOS = [
  ["Ventas", [PERMISSIONS.POS, PERMISSIONS.QUOTES, PERMISSIONS.SALES_HISTORY, PERMISSIONS.SALES_VOID, PERMISSIONS.SALES_RETURN]],
  ["Inventario", [PERMISSIONS.PRODUCTS, PERMISSIONS.PRODUCTS_READ, PERMISSIONS.INVENTORY_OWN, PERMISSIONS.INVENTORY_ALL, PERMISSIONS.LOCATIONS]],
  ["Pedidos", [PERMISSIONS.ORDERS_RESOLVE, PERMISSIONS.ORDERS_CANCEL, PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_MANAGE]],
  ["Clientes", [PERMISSIONS.CLIENTS, PERMISSIONS.SUPPLIERS]],
  ["Reportes", [PERMISSIONS.DASHBOARD]],
  ["Configuración", [PERMISSIONS.SETTINGS]],
]

function agruparPermisos(permisos = []) {
  const conocidos = new Set(GRUPOS_DE_PERMISOS.flatMap(([, ids]) => ids))
  const grupos = GRUPOS_DE_PERMISOS.map(([nombre, ids]) => [nombre, permisos.filter((p) => ids.includes(p))])
  const otros = permisos.filter((p) => !conocidos.has(p))

  return [...grupos, ["Otros", otros]].filter(([, lista]) => lista.length > 0)
}

const CLASE_DEL_ROL = {
  [ROLES.ADMIN]: "badge badge-rol-admin",
  [ROLES.CONTADOR]: "badge badge-rol-contador",
  [ROLES.VENDEDOR]: "badge badge-rol-vendedor",
}

const iniciales = (nombre = "") =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((palabra) => palabra[0].toUpperCase())
    .join("") || "?"

/*
  Menú de acciones de una fila. Escape lo cierra y devuelve el foco al
  botón; pulsar fuera también lo cierra. Las acciones son las de siempre.
*/
function MenuDeAcciones({ nombre, acciones }) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef(null)
  const boton = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!abierto) return undefined

    contenedor.current?.querySelector('[role="menuitem"]')?.focus()

    const alPulsarFuera = (evento) => {
      if (!contenedor.current?.contains(evento.target)) setAbierto(false)
    }

    const alPulsarTecla = (evento) => {
      if (evento.key !== "Escape") return

      evento.stopPropagation()
      setAbierto(false)
      boton.current?.focus()
    }

    document.addEventListener("mousedown", alPulsarFuera)
    document.addEventListener("keydown", alPulsarTecla)

    return () => {
      document.removeEventListener("mousedown", alPulsarFuera)
      document.removeEventListener("keydown", alPulsarTecla)
    }
  }, [abierto])

  return (
    <div className="menu-acciones" ref={contenedor}>
      <button
        ref={boton}
        type="button"
        className="btn-icono"
        aria-label={`Acciones de ${nombre}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? menuId : undefined}
        onClick={() => setAbierto((antes) => !antes)}
      >
        <FaEllipsisV aria-hidden="true" />
      </button>

      {abierto && (
        <ul className="menu-acciones-lista" role="menu" id={menuId} aria-label={`Acciones de ${nombre}`}>
          {acciones.map(([texto, alPulsar]) => (
            <li key={texto} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAbierto(false)
                  alPulsar()
                }}
              >
                {texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PermisosDelUsuario({ usuario, etiquetaDelPermiso, onCerrar }) {
  return (
    <ModalShell
      titulo={`Permisos de ${usuario.name}`}
      onCerrar={onCerrar}
      cerrarAlPulsarFuera
      acciones={
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>
          Cerrar
        </button>
      }
    >
      {agruparPermisos(usuario.permissions).map(([grupo, lista]) => (
        <section className="config-grupo-permisos" key={grupo} aria-label={grupo}>
          <h4>{grupo}</h4>
          <ul>
            {lista.map((permiso) => (
              <li key={permiso}>{etiquetaDelPermiso(permiso)}</li>
            ))}
          </ul>
        </section>
      ))}
    </ModalShell>
  )
}

function TablaDeUsuarios({
  usuarios,
  usuarioEnSesion,
  ubicaciones = [],
  etiquetaDelRol,
  etiquetaDelPermiso,
  minutosDeBloqueo,
  onEditar,
  onActivar,
  onDesbloquear,
  onRestablecer,
}) {
  const [busqueda, setBusqueda] = useState("")
  const [rol, setRol] = useState("")
  const [estado, setEstado] = useState("")
  const [ubicacion, setUbicacion] = useState("")
  const [pagina, setPagina] = useState({ clave: "", n: 1 })
  const [conPermisos, setConPermisos] = useState(null)

  const nombreDeUbicacion = (id) => ubicaciones.find((u) => u.id === id)?.name || ""

  const visibles = usuarios.filter(
    (u) =>
      (!busqueda.trim() || [u.name, u.username, u.email].some((v) => coincideBusqueda(v, busqueda))) &&
      (!rol || u.role === rol) &&
      (!estado || (estado === "activo") === Boolean(u.active)) &&
      (!ubicacion || (ubicacion === "-" ? !u.locationId : u.locationId === ubicacion))
  )

  // La página vuelve a la primera al cambiar cualquier filtro.
  const claveDePagina = [busqueda, rol, estado, ubicacion].join("|")
  const paginaActual = pagina.clave === claveDePagina ? pagina.n : 1
  const filas = rebanada(visibles, paginaActual, POR_PAGINA)

  // Solo las ubicaciones que tiene algún usuario: filtrar por otra no daría nada.
  const ubicacionesConUsuarios = ubicaciones.filter((u) => usuarios.some((x) => x.locationId === u.id))

  return (
    <>
      <div className="toolbar config-filtros">
        <SearchInput
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o usuario..."
          etiqueta="Buscar usuarios por nombre o usuario"
        />

        <select className="filter-select" value={rol} onChange={(e) => setRol(e.target.value)} aria-label="Filtrar por rol">
          <option value="">Rol: todos</option>
          {[ROLES.ADMIN, ROLES.VENDEDOR, ROLES.CONTADOR].map((r) => (
            <option key={r} value={r}>
              {etiquetaDelRol(r)}
            </option>
          ))}
        </select>

        <select className="filter-select" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
          <option value="">Estado: todos</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
        </select>

        <select className="filter-select" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} aria-label="Filtrar por ubicación">
          <option value="">Ubicación: todas</option>
          {ubicacionesConUsuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          <option value="-">Sin ubicación</option>
        </select>
      </div>

      {visibles.length === 0 ? (
        <EmptyState Icono={FaSearch} titulo="Ningún usuario coincide" descripcion="Cambia la búsqueda o los filtros." />
      ) : (
        <div className="table-wrap">
          <table aria-label="Usuarios" className="tabla-adaptable config-tabla-usuarios">
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Ubicación</th>
                <th scope="col">Rol</th>
                <th scope="col">Permisos</th>
                <th scope="col">Estado</th>
                <th scope="col" className="th-acciones">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {filas.map((u) => {
                const esLaSesion = String(u.id) === String(usuarioEnSesion?.id)
                const acciones = [["Editar", () => onEditar(u)]]

                // Sobre la propia cuenta solo se edita, como antes.
                if (!esLaSesion) {
                  acciones.push([u.active ? "Desactivar" : "Activar", () => onActivar(u)])
                  if (u.bloqueadoHasta) acciones.push(["Desbloquear usuario", () => onDesbloquear(u)])
                  acciones.push(["Restablecer contraseña", () => onRestablecer(u)])
                }

                return (
                  <tr key={u.id}>
                    <td>
                      <span className="con-inicial">
                        <span className="inicial is-dorado" aria-hidden="true">
                          {iniciales(u.name)}
                        </span>
                        <span>
                          <strong className="config-usuario-nombre">{u.name}</strong>
                          <span className="config-usuario-id">{u.username ? `@${u.username}` : u.email}</span>
                          {esLaSesion && <span className="config-marca-sesion">Sesión actual</span>}
                          {u.bloqueadoHasta && (
                            <span className="badge badge-out config-bloqueo">
                              <span className="badge-dot" />
                              Bloqueado · quedan {minutosDeBloqueo(u.bloqueadoHasta)} min
                            </span>
                          )}
                        </span>
                      </span>
                    </td>

                    <td data-etiqueta="Ubicación">{nombreDeUbicacion(u.locationId) || "—"}</td>

                    <td data-etiqueta="Rol">
                      <span className={CLASE_DEL_ROL[u.role] || "badge badge-neutral"}>{etiquetaDelRol(u.role)}</span>
                    </td>

                    <td data-etiqueta="Permisos">
                      {u.role === ROLES.ADMIN ? (
                        <span className="sub">Acceso total</span>
                      ) : u.permissions?.length ? (
                        <span className="config-resumen-permisos">
                          {u.permissions.length} {u.permissions.length === 1 ? "permiso" : "permisos"} ·{" "}
                          <button
                            type="button"
                            className="config-ver-permisos"
                            aria-label={`Ver los permisos de ${u.name}`}
                            onClick={() => setConPermisos(u)}
                          >
                            Ver
                          </button>
                        </span>
                      ) : (
                        <span className="sub">Sin permisos</span>
                      )}
                    </td>

                    <td data-etiqueta="Estado">
                      <span className={u.active ? "badge badge-paid" : "badge badge-neutral"}>
                        <span className="badge-dot" />
                        {u.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>

                    <td className="celda-acciones">
                      <MenuDeAcciones nombre={u.name} acciones={acciones} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Paginacion
        pagina={paginaActual}
        total={visibles.length}
        porPagina={POR_PAGINA}
        onCambiar={(n) => setPagina({ clave: claveDePagina, n })}
        etiqueta="Páginas de usuarios"
      />

      {conPermisos && (
        <PermisosDelUsuario usuario={conPermisos} etiquetaDelPermiso={etiquetaDelPermiso} onCerrar={() => setConPermisos(null)} />
      )}
    </>
  )
}

export default TablaDeUsuarios
