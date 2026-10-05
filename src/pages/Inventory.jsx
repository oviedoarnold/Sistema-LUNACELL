import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  FaBoxOpen,
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
import StatusBadge from "../components/crud/StatusBadge"

import { PERMISSIONS } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
import {
  agruparPorProducto,
  etiquetaDeTipo,
  filtrarPorTexto,
  filtrarPorUbicacion,
  ubicacionesPresentes,
} from "../utils/inventario"

/*
  Dónde está la mercadería.

  Esta pantalla contesta una sola pregunta, y por eso no se parece a
  Inventario: «¿dónde hay este producto y cuánto hay en cada sitio?».
  Products administra el catálogo —precios, costos, altas y bajas— y
  muestra un número por producto. Aquí no se edita nada: se mira.

  El recorrido es PRODUCTO → UBICACIONES y no al contrario. Obligar a
  entrar primero a una bodega para después buscar dentro es el camino
  equivocado cuando la pregunta nace en el mostrador, con un cliente
  delante y un código en la mano. El filtro de ubicación está, pero es el
  secundario: sirve para la pregunta inversa sin montar otra pantalla.

  Lo que NO hace esta pantalla, y es deliberado: no cruza los productos con
  la lista de ubicaciones de la empresa. Las ubicaciones que dibuja salen
  de las filas que devolvió la base. Si las completara por su cuenta,
  inventaría un «0» para los camiones que el usuario no tiene permiso de
  ver, y un cero inventado es peor que una ausencia: parece un dato.
*/

const ICONO_POR_TIPO = {
  bodega: FaWarehouse,
  tienda: FaStore,
  camion: FaTruck,
  otro: FaMapMarkerAlt,
}

function Inventory() {
  const { existencias, cargando, error } = useExistencias()

  /*
    El mismo permiso que protege /inventory/transfers, preguntado con la
    misma función que usa la ruta: si un día cambia, cambia en los dos
    sitios a la vez.
  */
  const { hasPermission } = useAuth()
  const puedeTrasladar = hasPermission(PERMISSIONS.INVENTORY_OWN)

  const [busqueda, setBusqueda] = useState("")
  const [ubicacionElegida, setUbicacionElegida] = useState("")

  /*
    El selector se arma con las ubicaciones que llegaron. Ofrecer una que
    el usuario no puede consultar ya le estaría diciendo que existe.
  */
  const ubicaciones = useMemo(
    () => ubicacionesPresentes(existencias),
    [existencias]
  )

  const grupos = useMemo(() => {
    const porTexto = filtrarPorTexto(existencias, busqueda)

    return agruparPorProducto(
      filtrarPorUbicacion(porTexto, ubicacionElegida)
    )
  }, [existencias, busqueda, ubicacionElegida])

  const buscando = Boolean(busqueda.trim()) || Boolean(ubicacionElegida)

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
                onChange={(e) => setUbicacionElegida(e.target.value)}
                aria-label="Filtrar por ubicación"
              >
                <option value="">Todas las ubicaciones</option>

                {ubicaciones.map((u) => (
                  <option key={u.locationId} value={u.locationId}>
                    {u.locationName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {grupos.length === 0 && (
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

          <div className="inventory-lista">
            {grupos.map((grupo) => (
              <section className="inventory-producto" key={grupo.productId}>
                <header className="inventory-cabecera">
                  <div>
                    <h3 className="inventory-nombre">{grupo.productName}</h3>

                    {grupo.code && (
                      <span className="inventory-codigo">{grupo.code}</span>
                    )}
                  </div>

                  {/*
                    El total es el de lo visible, no el de lo que existe.
                    Para quien solo ve su camión, «3» significa «3 donde
                    puedo mirar», y decirlo evita que lo lea como el total
                    de la empresa.
                  */}
                  <div className="inventory-total">
                    <strong>{grupo.total}</strong>

                    <span>
                      {ubicaciones.length > 1
                        ? "en las ubicaciones que ves"
                        : "en tu ubicación"}
                    </span>
                  </div>
                </header>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Ubicación</th>
                        <th scope="col">Tipo</th>
                        <th scope="col" className="num">
                          Existencia
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {grupo.ubicaciones.map((u) => (
                        <tr key={u.locationId}>
                          <td>
                            <span className="product-name">
                              {u.locationName}
                            </span>
                          </td>

                          <td>
                            <StatusBadge
                              variante="neutral"
                              Icono={
                                ICONO_POR_TIPO[u.locationType] ||
                                FaMapMarkerAlt
                              }
                            >
                              {etiquetaDeTipo(u.locationType)}
                            </StatusBadge>
                          </td>

                          {/*
                            El cero se distingue con palabra y con tono, no
                            solo con el número: «0» y «10» se parecen
                            demasiado leídos de reojo, y la diferencia entre
                            tener y no tener es la que decide si se promete
                            una venta.
                          */}
                          <td className="num">
                            {u.quantity === 0 ? (
                              <span className="inventory-cero">
                                0 · sin existencia
                              </span>
                            ) : (
                              <strong className="inventory-cantidad">
                                {u.quantity}
                              </strong>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default Inventory
