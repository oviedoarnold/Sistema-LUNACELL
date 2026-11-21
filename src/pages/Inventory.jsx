import { Fragment, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  FaBoxOpen,
  FaChevronDown,
  FaChevronUp,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaMapMarkerAlt,
  FaStore,
  FaTruck,
  FaWarehouse,
} from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import Paginacion from "../components/crud/Paginacion"

import { PERMISSIONS } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
import { useRecargaDeExistencias } from "../hooks/useRecargaDeExistencias"
import {
  agruparPorProducto,
  etiquetaDeTipo,
  existenciaDeLaUbicacion,
  filtrarPorTexto,
  ubicacionInicial,
  ubicacionesPresentes,
} from "../utils/inventario"
import { rebanada } from "../utils/paginacion"

/*
  Dónde está la mercadería.

  Esta pantalla contesta una sola pregunta, y por eso no se parece a
  Inventario: «¿dónde hay este producto y cuánto hay en cada sitio?».
  Products administra el catálogo —precios, costos, altas y bajas— y
  muestra un número por producto. Aquí no se edita nada: se mira.

  El recorrido es PRODUCTO → UBICACIONES y no al contrario: una fila por
  producto, con una columna por ubicación (o su detalle desplegable cuando
  son muchas), en páginas para que cien productos no sean una lista
  interminable. Obligar a
  entrar primero a una bodega para después buscar dentro es el camino
  equivocado cuando la pregunta nace en el mostrador, con un cliente
  delante y un código en la mano. El filtro de ubicación está, pero es el
  secundario: sirve para la pregunta inversa sin montar otra pantalla.

  Lo que NO hace esta pantalla, y es deliberado: no cruza los productos con
  la lista de ubicaciones de la empresa. Las ubicaciones que dibuja salen
  de las filas que devolvió la base. Si las completara por su cuenta,
  inventaría un «0» para los camiones que el usuario no tiene permiso de
  ver, y un cero inventado es peor que una ausencia: parece un dato.

  Se abre en la ubicación asignada a quien entra, que es lo que casi
  siempre viene a mirar: lo que tiene él. Las demás que pueda consultar
  quedan en el selector. Sin ubicación asignada no se elige ninguna en su
  lugar: se dice, y se muestran las que puede consultar.
*/

// Más ubicaciones que esto y cada producto lleva su detalle desplegable.
const MAX_COLUMNAS = 5

// Filas por página: con cien productos o más la lista no se hace interminable.
const POR_PAGINA = 25

const ICONO_POR_TIPO = {
  bodega: FaWarehouse,
  tienda: FaStore,
  camion: FaTruck,
  otro: FaMapMarkerAlt,
}

/*
  Por qué no se abre en la ubicación del usuario. Sin lista que mostrar el
  aviso es todo lo que hay; con lista, explica qué se está viendo.
*/
const AVISOS = {
  "sin-ubicacion": {
    conDatos:
      "No tienes una ubicación asignada: se muestran todas las que puedes consultar.",
    sinDatos:
      "No tienes una ubicación asignada. Pide al administrador que te asigne una para ver su inventario.",
  },
  "no-visible": {
    conDatos:
      "Tu ubicación asignada no está entre las que puedes consultar (puede estar desactivada): se muestran las demás.",
    sinDatos:
      "Tu ubicación asignada no está entre las que puedes consultar: puede estar desactivada o te falta el permiso de inventario.",
  },
}

/*
  El cero se distingue con palabra y con tono, no solo con el número: «0» y
  «10» se parecen demasiado leídos de reojo, y la diferencia entre tener y
  no tener es la que decide si se promete una venta.
*/
function Cantidad({ valor }) {
  return valor === 0 ? (
    <span className="inventory-cero">
      0<span className="inventory-cero-texto"> · sin existencia</span>
    </span>
  ) : (
    <strong className="inventory-cantidad">{valor}</strong>
  )
}

function Inventory() {
  const { user, hasPermission } = useAuth()
  const usuarioId = user?.id || ""

  // Lo cargado es de este usuario: con otra sesión deja de valer en el acto.
  const { existencias, cargando, error, recargar } = useExistencias({ clave: usuarioId })

  // Ventas sincronizadas u otros dispositivos: las cantidades se vuelven a pedir solas.
  useRecargaDeExistencias(recargar)

  /*
    El mismo permiso que protege /inventory/transfers, preguntado con la
    misma función que usa la ruta: si un día cambia, cambia en los dos
    sitios a la vez.
  */
  const puedeTrasladar = hasPermission(PERMISSIONS.INVENTORY_OWN)

  /*
    El stock total solo es el de la empresa cuando se ven todas las
    ubicaciones. Con menos, la suma sería la de lo visible presentada como
    total, y se leería como lo que hay en la empresa.
  */
  const puedeVerElTotal = hasPermission(PERMISSIONS.INVENTORY_ALL)

  const [busqueda, setBusqueda] = useState("")

  /*
    La elección se guarda con el usuario que la hizo y solo en memoria,
    nunca en el navegador: una sesión nueva vuelve a abrir en su ubicación.
  */
  const [eleccion, setEleccion] = useState(null)

  /*
    El selector se arma con las ubicaciones que llegaron. Ofrecer una que
    el usuario no puede consultar ya le estaría diciendo que existe.
  */
  const ubicaciones = useMemo(
    () => ubicacionesPresentes(existencias),
    [existencias]
  )

  const inicial = ubicacionInicial(ubicaciones, user?.locationId)

  /*
    Una elección deja de valer si es de otra sesión o si su ubicación ya no
    llega (se desactivó entre una carga y otra): entonces manda la inicial.
  */
  const eligio =
    eleccion !== null &&
    eleccion.usuarioId === usuarioId &&
    (eleccion.locationId === "" ||
      ubicaciones.some((u) => String(u.locationId) === eleccion.locationId))

  const ubicacionElegida = eligio ? eleccion.locationId : String(inicial.locationId)

  const ubicacionActual = ubicaciones.find(
    (u) => String(u.locationId) === ubicacionElegida
  )

  const esLaSuya =
    Boolean(ubicacionActual) &&
    String(ubicacionActual.locationId) === String(user?.locationId)

  const aviso =
    !eligio && inicial.motivo
      ? AVISOS[inicial.motivo][existencias.length > 0 ? "conDatos" : "sinDatos"]
      : ""

  const porTexto = useMemo(
    () => filtrarPorTexto(existencias, busqueda),
    [existencias, busqueda]
  )

  // Una ubicación elegida es una columna; todas, una columna por ubicación.
  const filas = useMemo(
    () =>
      ubicacionActual
        ? existenciaDeLaUbicacion(porTexto, ubicacionActual.locationId)
        : [],
    [porTexto, ubicacionActual]
  )

  const grupos = useMemo(
    () => (ubicacionActual ? [] : agruparPorProducto(porTexto)),
    [porTexto, ubicacionActual]
  )

  // Las columnas de ubicación, por nombre, como el detalle de cada producto.
  const columnas = useMemo(
    () => [...ubicaciones].sort((a, b) => a.locationName.localeCompare(b.locationName, "es")),
    [ubicaciones]
  )

  /*
    Con muchas ubicaciones las columnas ya no caben: cada producto lleva su
    detalle desplegable. En el teléfono pasa siempre (lo decide el CSS).
  */
  const muchasUbicaciones = columnas.length > MAX_COLUMNAS

  const [abiertos, setAbiertos] = useState(() => new Set())
  const alternar = (productId) =>
    setAbiertos((antes) => {
      const despues = new Set(antes)

      if (despues.has(productId)) despues.delete(productId)
      else despues.add(productId)

      return despues
    })

  /*
    La página vuelve a la primera al cambiar la búsqueda o la ubicación: se
    guarda con la clave de lo que se estaba mirando.
  */
  const claveDePagina = `${busqueda}|${ubicacionElegida}`
  const [pagina, setPagina] = useState({ clave: "", n: 1 })
  const paginaActual = pagina.clave === claveDePagina ? pagina.n : 1
  const irA = (n) => setPagina({ clave: claveDePagina, n })

  const totalDeFilas = ubicacionActual ? filas.length : grupos.length
  const filasDeLaPagina = rebanada(filas, paginaActual, POR_PAGINA)
  const gruposDeLaPagina = rebanada(grupos, paginaActual, POR_PAGINA)

  const buscando = Boolean(busqueda.trim()) || eligio
  const sinResultados = totalDeFilas === 0

  /*
    Sin ninguna fila y con el aviso de ubicación, el aviso ya lo explica,
    salvo para quien ve todas: a él sí le falta mercadería registrada.
  */
  const callarVacio = existencias.length === 0 && Boolean(aviso) && !puedeVerElTotal

  // Total y detalle: las dos columnas que acompañan a las de ubicación.
  const columnasDeLaTabla = 2 + (muchasUbicaciones ? 1 : columnas.length) + (puedeVerElTotal ? 1 : 0) + 1

  return (
    <div className="view active crud inventory">
      <PageHeader descripcion="Dónde está la mercadería y cuánta hay en cada bodega, tienda y camión.">
        {puedeTrasladar && (
          <Link className="btn btn-secondary" to="/inventory/transfers">
            <FaExchangeAlt aria-hidden="true" />Traslados
          </Link>
        )}
      </PageHeader>

      {cargando && (
        <p className="crud-cargando" role="status">
          Cargando existencias…
        </p>
      )}

      {error && (
        <EmptyState
          Icono={FaExclamationTriangle}
          titulo="No se pudieron cargar las existencias"
          descripcion={error}
        />
      )}

      {!cargando && !error && (
        <>
          <div className="toolbar">
            <SearchInput
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código o producto..."
              etiqueta="Buscar por código o nombre del producto"
            />

            {ubicaciones.length > 1 && (
              <select
                className="filter-select"
                value={ubicacionElegida}
                onChange={(e) =>
                  setEleccion({ usuarioId, locationId: e.target.value })
                }
                aria-label="Cambiar de ubicación"
              >
                <option value="">Todas las ubicaciones</option>

                {ubicaciones.map((u) => (
                  <option key={u.locationId} value={u.locationId}>
                    {u.locationName}
                  </option>
                ))}
              </select>
            )}

            {ubicaciones.length > 0 && (
              <p className="chip-ubicacion inventory-ubicacion-actual">
                <FaMapMarkerAlt aria-hidden="true" />
                <span>Ubicación actual:</span>
                <strong>
                  {ubicacionActual
                    ? ubicacionActual.locationName
                    : "todas las que puedes consultar"}
                </strong>
                {esLaSuya && <span className="chip-suya inventory-ubicacion-suya">tu ubicación</span>}
              </p>
            )}
          </div>

          {aviso && (
            <p className="inventory-aviso" role="note">
              {aviso}
            </p>
          )}

          {sinResultados && !callarVacio && (
            <EmptyState
              Icono={FaBoxOpen}
              titulo={
                buscando
                  ? "Ningún producto coincide"
                  : "Todavía no hay existencias que mostrar"
              }
              descripcion={
                buscando
                  ? "Prueba con otro código o con parte del nombre."
                  : "Cuando haya mercadería registrada en alguna ubicación aparecerá aquí."
              }
            />
          )}

          {filasDeLaPagina.length > 0 && (
            <div className="table-wrap inventory-ubicacion">
              <table className="tabla-adaptable">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Código</th>
                    <th scope="col" className="num">
                      Disponible en {ubicacionActual.locationName}
                    </th>
                    {puedeVerElTotal && (
                      <th scope="col" className="num">
                        Stock total
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {filasDeLaPagina.map((fila) => (
                    <tr key={fila.productId}>
                      <td>
                        <span className="product-name">{fila.productName}</span>
                      </td>

                      <td data-etiqueta="Código">
                        <span className="inventory-codigo">{fila.code || "—"}</span>
                      </td>

                      <td className="num" data-etiqueta="Disponible">
                        <Cantidad valor={fila.quantity} />
                      </td>

                      {puedeVerElTotal && (
                        <td className="num inventory-stock-total" data-etiqueta="Stock total">{fila.total}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {gruposDeLaPagina.length > 0 && (
            <div className="table-wrap inventory-matriz">
              <table className={muchasUbicaciones ? "inventory-tabla is-compacta" : "inventory-tabla"}>
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col" className="inventory-col-codigo">Código</th>
                    {muchasUbicaciones ? (
                      <th scope="col" className="num inventory-col-ubicacion">Ubicaciones con existencia</th>
                    ) : (
                      columnas.map((u) => {
                        const Icono = ICONO_POR_TIPO[u.locationType] || FaMapMarkerAlt

                        return (
                          <th scope="col" className="num inventory-col-ubicacion" key={u.locationId}>
                            <span className="inventory-encabezado-ubicacion" title={etiquetaDeTipo(u.locationType)}>
                              <Icono aria-hidden="true" />
                              <span className="inventory-nombre-ubicacion">{u.locationName}</span>
                              <span className="solo-lector">{etiquetaDeTipo(u.locationType)}</span>
                            </span>
                          </th>
                        )
                      })
                    )}
                    {puedeVerElTotal && (
                      <th scope="col" className="num">
                        Total
                      </th>
                    )}
                    <th scope="col" className="inventory-col-detalle">
                      <span className="solo-lector">Detalle</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {gruposDeLaPagina.map((grupo) => {
                    const porUbicacion = new Map(grupo.ubicaciones.map((u) => [u.locationId, u.quantity]))
                    const abierto = abiertos.has(grupo.productId)
                    const conExistencia = grupo.ubicaciones.filter((u) => u.quantity > 0).length

                    return (
                      <Fragment key={grupo.productId}>
                        <tr className="inventory-fila">
                          <td>
                            <span className="product-name inventory-nombre">{grupo.productName}</span>
                          </td>

                          <td className="inventory-col-codigo">
                            <span className="inventory-codigo">{grupo.code || "—"}</span>
                          </td>

                          {muchasUbicaciones ? (
                            <td className="num inventory-col-ubicacion">
                              {conExistencia} de {grupo.ubicaciones.length}
                            </td>
                          ) : (
                            columnas.map((u) => (
                              <td className="num inventory-col-ubicacion" key={u.locationId}>
                                {/*
                                  Una ubicación sin fila para este producto no
                                  se rellena con un cero: no llegó, no se dibuja.
                                */}
                                {porUbicacion.has(u.locationId) ? <Cantidad valor={porUbicacion.get(u.locationId)} /> : "—"}
                              </td>
                            ))
                          )}

                          {puedeVerElTotal && (
                            <td className="num inventory-total">
                              <strong>{grupo.total}</strong>
                            </td>
                          )}

                          <td className="inventory-col-detalle">
                            <button
                              type="button"
                              className="btn-icono"
                              aria-expanded={abierto}
                              aria-label={`${abierto ? "Ocultar" : "Ver"} ubicaciones de ${grupo.productName}`}
                              onClick={() => alternar(grupo.productId)}
                            >
                              {abierto ? <FaChevronUp aria-hidden="true" /> : <FaChevronDown aria-hidden="true" />}
                            </button>
                          </td>
                        </tr>

                        {abierto && (
                          <tr className="inventory-detalle">
                            <td colSpan={columnasDeLaTabla}>
                              <ul className="inventory-detalle-lista" aria-label={`Ubicaciones de ${grupo.productName}`}>
                                {grupo.ubicaciones.map((u) => (
                                  <li key={u.locationId}>
                                    <span>{u.locationName}</span>
                                    <Cantidad valor={u.quantity} />
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Paginacion
            pagina={paginaActual}
            total={totalDeFilas}
            porPagina={POR_PAGINA}
            onCambiar={irA}
            etiqueta="Páginas de existencias"
          />
        </>
      )}
    </div>
  )
}

export default Inventory
