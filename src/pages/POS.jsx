import { useContext, useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import Swal from "sweetalert2"

import {
  FaMoneyBillWave,
  FaPlus,
  FaRegCreditCard,
  FaSearch,
  FaShoppingCart,
  FaTrash,
} from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import { ProductContext } from "../context/contexts"
import { MiniaturaDeProducto } from "../components/ImagenDeProducto"
import { claveDeIdempotencia } from "../utils/ids"
import { SalesContext } from "../context/contexts"
import { ClientsContext } from "../context/contexts"
import InvoiceTemplate from "../components/InvoiceTemplate"
import ClientAutocomplete from "../components/documents/ClientAutocomplete"
import ModalDeCliente from "../components/documents/ModalDeCliente"
import { useCarrito } from "../hooks/useCarrito"
import { useExistenciaDeMiUbicacion } from "../hooks/useExistenciaDeMiUbicacion"
import { useClienteDelDocumento } from "../hooks/useClienteDelDocumento"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"
import ComprobanteProvisional from "../components/sinConexion/ComprobanteProvisional"
import EstadoSinConexion from "../components/sinConexion/EstadoSinConexion"
import PanelDeVentasLocales from "../components/sinConexion/PanelDeVentasLocales"
import { useAuth } from "../hooks/useAuth"
import { useSinConexion } from "../hooks/useSinConexion"

import {
  formatMoney,
  toISODateInDays,
  todayForDisplay,
} from "../utils/format"

import {
  calculateCartTotals,
  filterProductsBySearchText,
  hasEnoughStock,
} from "../utils/cart"

const ISV_POR_OMISION = 15

// Una venta en línea sin respuesta que el cajero decide reintentar.
const REINTENTAR = Symbol("reintentar")

const aProductoDeLaCopia = (p) => ({
  id: p.id,
  code: p.codigo,
  name: p.nombre,
  price: p.precio,
  category: p.categoria,
  imageUrl: "",
})

const aClienteDeLaCopia = (c) => ({
  id: c.id,
  name: c.nombre,
  rtn: c.rtn,
  phone: c.telefono,
  address: c.direccion,
  email: "",
})

/*
  Qué decirle al cajero cuando no hay servidor y la ubicación no puede
  vender sin conexión.
*/
function motivoDelBloqueo(copia) {
  if (copia?.ubicacion?.emiteFiscal) {
    return "Sin conexión con el servidor. Esta ubicación emite facturas fiscales y no vende sin conexión: podrás facturar cuando vuelva la conexión."
  }

  return "Sin conexión con el servidor. Esta ubicación no está habilitada para vender sin conexión: podrás facturar cuando vuelva la conexión."
}

function textoDelBotonDeVenta(facturando, modoSinConexion) {
  if (facturando) return modoSinConexion ? "Guardando…" : "Registrando…"

  return modoSinConexion ? "Guardar venta sin conexión" : "Generar factura"
}

function POS() {
  const { products = [], company } = useContext(ProductContext)
  const { addSale } = useContext(SalesContext)

  /*
    Lo que se puede vender: la existencia de la ubicación operativa del
    usuario, la misma de la que descuenta registrar_venta_ubicacion(). El
    `stock` del catálogo es el total de todas las ubicaciones y aquí no se
    usa para nada.
  */
  const existenciasDeMiUbicacion = useExistenciaDeMiUbicacion()

  /*
    El modo sin conexión (OFF-1.3). Sin su proveedor vale null y la
    pantalla es exactamente la de siempre.

    Sin servidor (o con un perfil todavía sin confirmar) y con la ubicación
    habilitada, se vende con la copia local: productos, precios, clientes y
    existencia tal como se descargaron, menos lo que este teléfono ya vendió
    y el servidor no confirmó. La venta se guarda en el teléfono con un
    comprobante provisional; nunca se presenta como factura.
  */
  const sinConexion = useSinConexion()
  const { user } = useAuth()
  const sinServidor =
    Boolean(sinConexion) &&
    (Boolean(user?.sinConexion) || sinConexion.conexion === "sin_red" || sinConexion.conexion === "sin_servidor")
  const modoSinConexion = sinServidor && Boolean(sinConexion?.ubicacionAutorizada)
  const bloqueadoSinConexion = sinServidor && !modoSinConexion
  const copiaLocal = modoSinConexion ? sinConexion.copia : null
  const mostrarEstado =
    Boolean(sinConexion) &&
    (sinConexion.ubicacionAutorizada || sinConexion.ventas.length > 0 || sinServidor || sinConexion.actualizacionPendiente)

  const productosDeLaCopia = useMemo(() => (copiaLocal?.productos || []).map(aProductoDeLaCopia), [copiaLocal])
  const clientesDeLaCopia = useMemo(() => (copiaLocal?.clientes || []).map(aClienteDeLaCopia), [copiaLocal])
  const productosEnVenta = modoSinConexion ? productosDeLaCopia : products

  const disponibleSinConexion = sinConexion?.disponibleDe
  const existenciaDe = useMemo(
    () => (modoSinConexion ? (producto) => disponibleSinConexion(producto?.id) : existenciasDeMiUbicacion.existenciaDe),
    [modoSinConexion, disponibleSinConexion, existenciasDeMiUbicacion.existenciaDe]
  )
  const existenciaLista = modoSinConexion || existenciasDeMiUbicacion.lista

  const [panelAbierto, setPanelAbierto] = useState(false)
  const [comprobante, setComprobante] = useState(null)

  /*
    La tasa sale de la configuración de la empresa. Tenerla fija aquí
    hacía que cambiarla en Configuración no afectara lo que se cobra.
  */
  const tasaISV = Number(
    modoSinConexion ? copiaLocal?.empresa?.tasaIsv ?? ISV_POR_OMISION : company?.taxRate ?? ISV_POR_OMISION
  )

  /*
    Identifica al intento de cobro, no al clic. Se conserva mientras la
    venta no se haya emitido: si el cajero vuelve a pulsar porque la red
    tardo y no vio respuesta, viaja la misma clave y la base devuelve la
    factura que ya existe en vez de emitir otra. Se renueva al limpiar la
    venta, que es cuando empieza un cobro distinto.
  */
  const [claveDeVenta, setClaveDeVenta] = useState(claveDeIdempotencia)

  const [facturando, setFacturando] = useState(false)
  const { clients: clientesEnLinea = [], addClient } = useContext(ClientsContext)
  const clients = modoSinConexion ? clientesDeLaCopia : clientesEnLinea

  const location = useLocation()
  const navigate = useNavigate()

  const saleDraft = location.state?.saleDraft

  const [search, setSearch] = useState("")
  const [paymentType, setPaymentType] = useState("contado")

  const [buyerRTN, setBuyerRTN] = useState(
    () => saleDraft?.rtn || ""
  )

  const [dueDate, setDueDate] = useState(toISODateInDays(30))

  /*
    El carrito y el alta de cliente son los mismos que en cotizaciones y
    viven en hooks compartidos. Se renombran al vocabulario que ya usaba
    esta pantalla para no reescribir el resto del archivo.
  */
  const {
    lineas: cart,
    cantidadPedida: qtyMap,
    setCantidadPedida: setQtyMap,
    agregar: addToCartWithQty,
    quitar: removeFromCart,
    cambiarCantidad: changeQuantity,
    vaciar: vaciarCarrito,
    disponibleDe: availableStockFor,
  } = useCarrito({
    productos: productosEnVenta,
    lineasIniciales: saleDraft?.cart || [],
    existenciaDe,
  })

  const {
    busqueda: clientSearch,
    seleccionado: selectedClient,
    formulario: clientForm,
    setFormulario: setClientForm,
    modalAbierto: clientModalOpen,
    guardando: guardandoCliente,
    seleccionar: handleSelectClient,
    escribirBusqueda: handleClientSearchChange,
    soltar: handleClearClient,
    abrirAlta: openNewClientModal,
    cerrarAlta: cerrarModalDeCliente,
    guardarNuevo: saveNewClient,
  } = useClienteDelDocumento({
    addClient,
    busquedaInicial: saleDraft?.clientName || "",
    clienteInicial:
      clients.find(
        (candidate) =>
          String(candidate.id) === String(saleDraft?.clientId)
      ) || null,
    // El RTN del comprador acompaña al cliente que se elija.
    alCambiar: (cliente) => setBuyerRTN(cliente?.rtn || ""),
  })

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSale, setPreviewSale] = useState(null)
  const [previewMode, setPreviewMode] = useState("preview")

  /*
    Se limpia el borrador del historial para que recargar la pagina
    no vuelva a cargar la cotizacion ya facturada.
  */
  useEffect(() => {
    if (!saleDraft) return

    navigate("/pos", {
      replace: true,
      state: null,
    })

    Swal.fire({
      icon: "success",
      title: "Cotización cargada",
      text: `Se cargaron los productos de ${saleDraft.quoteNumber}. Revisa antes de facturar.`,
    })
  }, [saleDraft, navigate])

  const filteredProducts = useMemo(
    () =>
      filterProductsBySearchText(
        productosEnVenta,
        search
      ),
    [productosEnVenta, search]
  )

  const {
    subtotal,
    tax,
    total,
  } = useMemo(
    () =>
      calculateCartTotals(
        cart,
        tasaISV
      ),
    [cart, tasaISV]
  )

  const handlePaymentTypeChange = (
    type
  ) => {
    setPaymentType(type)
    handleClearClient()

    if (type === "credito") {
      setDueDate(toISODateInDays(30))
    }
  }

  const validateSale = () => {
    if (bloqueadoSinConexion) {
      Swal.fire({
        icon: "warning",
        title: "No se puede facturar sin conexión",
        text: motivoDelBloqueo(sinConexion?.copia),
      })

      return false
    }

    if (!existenciaLista) {
      Swal.fire({
        icon: "warning",
        title: "No se puede facturar todavía",
        text: existenciasDeMiUbicacion.motivo,
      })

      return false
    }

    if (cart.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "Factura vacía",
        text:
          "Agrega al menos un producto antes de continuar.",
      })

      return false
    }

    for (const item of cart) {
      const product = productosEnVenta.find(
        (candidate) =>
          String(candidate.id) ===
          String(item.id)
      )

      if (!product) {
        Swal.fire({
          icon: "error",
          title:
            "Producto no encontrado",
          text: `${item.name} ya no existe en el inventario.`,
        })

        return false
      }

      const existencia = existenciaDe(product)

      if (
        !hasEnoughStock(
          item.quantity,
          existencia
        )
      ) {
        Swal.fire({
          icon: "warning",
          title:
            "Stock insuficiente",
          text: `${item.name} solo tiene ${existencia} unidades disponibles.`,
        })

        return false
      }
    }

    if (
      paymentType === "credito" &&
      !selectedClient
    ) {
      Swal.fire({
        icon: "warning",
        title: "Cliente requerido",
        text:
          "Para vender al crédito debes seleccionar un cliente registrado.",
      })

      return false
    }

    if (
      paymentType === "credito" &&
      !dueDate
    ) {
      Swal.fire({
        icon: "warning",
        title: "Fecha requerida",
        text:
          "Indica la fecha de vencimiento de la venta a crédito.",
      })

      return false
    }

    return true
  }

  const getCustomerName = () => {
    if (selectedClient) {
      return selectedClient.name
    }

    if (
      paymentType === "contado" &&
      clientSearch.trim()
    ) {
      return clientSearch.trim()
    }

    return "Consumidor Final"
  }

  const buildPreviewSale = () => ({
    invoiceNumber: "VISTA PREVIA",
    date: todayForDisplay(),

    clientId:
      selectedClient?.id || null,

    clientName:
      getCustomerName(),

    client:
      getCustomerName(),

    clientPhone:
      selectedClient?.phone || "",

    clientAddress:
      selectedClient?.address || "",

    rtn:
      buyerRTN.trim() ||
      selectedClient?.rtn ||
      "",

    items: cart.map((item) => ({
      productId: item.id,
      code: item.code,
      name: item.name,
      qty: item.quantity,
      price: item.price,
      subtotal:
        item.price *
        item.quantity,
    })),

    subtotal,
    tax,
    taxRate: tasaISV,
    total,

    paymentType,

    dueDate:
      paymentType === "credito"
        ? dueDate
        : null,

    status:
      paymentType === "credito"
        ? "pendiente"
        : "pagada",
  })

  const buildSalePayload = () => ({
    items: cart.map((item) => ({
      id: item.id,
      productId: item.id,
      qty: item.quantity,
      price: item.price,
    })),

    type: paymentType,
    paymentType,

    clientId:
      selectedClient?.id || null,

    customerName:
      getCustomerName(),

    customer:
      getCustomerName(),

    rtn:
      buyerRTN.trim() ||
      selectedClient?.rtn ||
      "",

    dueDate:
      paymentType === "credito"
        ? dueDate
        : null,

    subtotal,
    tax,
    total,
    note: "",
  })

  /*
    La venta tal como se guardaría sin conexión, para la vista previa del
    comprobante provisional.
  */
  const buildVentaSinConexion = () => ({
    numeroProvisional: "VISTA PREVIA",
    registradaEn: new Date().toISOString(),
    renglones: cart.map((item) => ({
      producto_id: item.id,
      codigo: item.code || "",
      nombre: item.name,
      cantidad: Number(item.quantity),
      precio_unitario: Number(item.price),
    })),
    tasaIsv: tasaISV,
    formaPago: paymentType,
    nombreCliente: getCustomerName(),
    rtnComprador: buyerRTN.trim() || selectedClient?.rtn || "",
    fechaVencimiento: paymentType === "credito" ? dueDate : null,
  })

  const openPreview = () => {
    if (!validateSale()) return

    setPreviewMode("preview")
    setPreviewSale(
      modoSinConexion ? { sinConexion: true, venta: buildVentaSinConexion() } : buildPreviewSale()
    )
    setPreviewOpen(true)
  }

  const clearSaleForm = () => {
    // Termino un cobro: el siguiente es una operacion distinta.
    setClaveDeVenta(claveDeIdempotencia())

    vaciarCarrito()
    setSearch("")
    setPaymentType("contado")
    handleClearClient()
    setDueDate(toISODateInDays(30))
  }

  /*
    Guarda la venta en el teléfono. `claveEnLinea` es la del intento en
    línea que se quedó sin respuesta, si la venta nace de uno: antes de
    enviarla se comprobará si ese intento ya se había registrado.
  */
  const guardarSinConexion = async ({ claveEnLinea = null } = {}) => {
    try {
      const venta = await sinConexion.guardarVentaSinConexion({
        carrito: cart.map((item) => ({ productoId: item.id, cantidad: Number(item.quantity) })),
        formaPago: paymentType,
        clienteId: selectedClient?.id || null,
        nombreCliente: getCustomerName(),
        rtnComprador: buyerRTN.trim() || selectedClient?.rtn || "",
        fechaVencimiento: paymentType === "credito" ? dueDate : null,
        claveEnLinea,
      })

      setPreviewOpen(false)
      setPreviewSale(null)
      setComprobante(venta)
      clearSaleForm()

      Swal.fire({
        icon: "success",
        title: "Venta guardada en este teléfono",
        text: `Comprobante provisional ${venta.numeroProvisional}. Queda pendiente de sincronizar: no es una factura. El número de factura lo asigna el servidor al sincronizar.`,
      })

      return venta
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "No se pudo guardar la venta",
        text: error?.message || "No se pudo guardar la venta en este teléfono.",
      })

      return null
    }
  }

  // Sin respuesta del servidor: la venta pudo haberse registrado o no.
  const preguntarSinRespuesta = async () => {
    const eleccion = await Swal.fire({
      icon: "warning",
      title: "No hubo respuesta del servidor",
      text: "La venta pudo haberse registrado o no. Reintentar es seguro: esta misma venta no se duplica. Si sigues sin conexión, guárdala en este teléfono: antes de enviarla se comprobará si ya se había registrado.",
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: "Reintentar",
      denyButtonText: "Guardar sin conexión",
      cancelButtonText: "Cancelar",
    })

    if (eleccion.isConfirmed) return "reintentar"
    if (eleccion.isDenied) return "guardar"

    return null
  }

  const generateSale = async () => {
    let resultado

    do {
      resultado = await intentarVenta()
    } while (resultado === REINTENTAR)

    return resultado
  }

  const intentarVenta = async () => {
    if (!validateSale()) {
      return null
    }

    if (facturando) {
      return null
    }

    setFacturando(true)

    try {
      if (modoSinConexion) {
        return await guardarSinConexion()
      }

      const createdSale = await addSale(
        buildSalePayload(),
        claveDeVenta,
        { existenciaDe: existenciasDeMiUbicacion.existenciaDe }
      )

      if (!createdSale) {
        throw new Error(
          "SalesContext no devolvió la venta creada."
        )
      }

      const invoiceForDisplay = {
        ...createdSale,

        clientPhone:
          selectedClient?.phone ||
          "",

        clientAddress:
          selectedClient?.address ||
          "",
      }

      setPreviewMode("saved")

      setPreviewSale(
        invoiceForDisplay
      )

      setPreviewOpen(true)

      clearSaleForm()

      // La venta ya descontó en la base: la pantalla tiene que mostrarlo.
      await existenciasDeMiUbicacion.recargar()

      Swal.fire({
        icon: "success",

        title: `Factura ${
          createdSale.invoiceNumber ||
          "generada"
        }`,

        text:
          "La venta fue registrada y el inventario fue actualizado.",
      })

      return createdSale
    } catch (error) {
      if (error?.motivo === "sin-respuesta" && sinConexion?.ubicacionAutorizada) {
        const eleccion = await preguntarSinRespuesta()

        if (eleccion === "reintentar") return REINTENTAR

        if (eleccion === "guardar") {
          void sinConexion.comprobarConexion()
          return await guardarSinConexion({ claveEnLinea: claveDeVenta })
        }

        return null
      }

      Swal.fire({
        icon: "error",

        title:
          "No se pudo registrar la venta",

        text:
          error.message ||
          "Ocurrió un error al generar la factura.",
      })

      return null
    } finally {
      setFacturando(false)
    }
  }

  const confirmPreviewSale = async () => {
    const createdSale =
      await generateSale()

    if (!createdSale) return

    setPreviewMode("saved")
  }

  const clearCurrentSale =
    async () => {
      if (cart.length === 0) {
        return
      }

      const result =
        await Swal.fire({
          icon: "question",

          title:
            "¿Vaciar la venta actual?",

          text:
            "Se quitarán todos los productos del carrito.",

          showCancelButton: true,

          confirmButtonText:
            "Sí, vaciar",

          cancelButtonText:
            "Cancelar",
        })

      if (result.isConfirmed) {
        clearSaleForm()
      }
    }

  return (
    <div className="view active crud pos">
      {/*
        El nombre del módulo lo escribe la barra superior. El h2 que había
        aquí lo repetía justo debajo, que es la duplicación que se venía
        arrastrando; PageHeader deja solo la frase que explica la pantalla,
        igual que en el resto del sistema.
      */}
      <PageHeader descripcion="Arma la venta, revisa el total y genera la factura." />

      {mostrarEstado && (
        <EstadoSinConexion
          estado={sinConexion}
          perfilSinConexion={Boolean(user?.sinConexion)}
          onVerVentas={() => setPanelAbierto(true)}
        />
      )}

      {modoSinConexion && (
        <div className="alert-banner pos-modo-sin-conexion" role="status">
          <span>
            <strong>Modo sin conexión</strong>
            Las ventas se guardan en este teléfono con un comprobante provisional y se envían solas cuando vuelva la
            conexión. Precios y existencias son los de la última copia descargada.
            {!copiaLocal?.clientesDisponibles && " La copia no tiene clientes: solo se puede vender al contado."}
          </span>
        </div>
      )}

      {bloqueadoSinConexion && (
        <div className="alert-banner" role="alert">
          <span>{motivoDelBloqueo(sinConexion?.copia)}</span>
        </div>
      )}

      <div className="bill-grid">
        {/* ── CATÁLOGO ─────────────────────────────────── */}
        <section className="pos-catalogo" aria-labelledby="pos-titulo-catalogo">
          <h2 id="pos-titulo-catalogo" className="pos-titulo">
            Productos
          </h2>

          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar producto para agregar..."
            etiqueta="Buscar producto por nombre o código"
          />

          {/*
            Sin la existencia de la ubicación no se vende: el catálogo
            muestra 0 y aquí se dice por qué. Nunca el total global.
          */}
          {!existenciaLista && !bloqueadoSinConexion && (
            <div className="alert-banner" role="alert">
              <span>{existenciasDeMiUbicacion.motivo}</span>

              {existenciasDeMiUbicacion.error && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => existenciasDeMiUbicacion.recargar()}
                >
                  Reintentar
                </button>
              )}
            </div>
          )}

          <div className="picker-list">
            {filteredProducts.length === 0 ? (
              <EmptyState
                Icono={FaSearch}
                titulo="No se encontraron resultados"
                descripcion="Prueba con otro nombre o código."
              />
            ) : (
              filteredProducts.map((product) => {
                const available = availableStockFor(product)
                const disabled = available <= 0
                const quantity = qtyMap[product.id] ?? 1

                return (
                  <div
                    key={product.id}
                    className={`picker-item${disabled ? " disabled" : ""}`}
                  >
                    <MiniaturaDeProducto
                      url={product.imageUrl}
                      nombre={product.name}
                      tamano={44}
                    />

                    <div className="info">
                      <strong>{product.name}</strong>

                      <span>
                        {product.code || "S/C"} ·{" "}
                        {product.category || "Sin categoría"} ·{" "}
                        <span
                          className={
                            disabled ? "pos-sin-stock" : "pos-con-stock"
                          }
                        >
                          {available} disp.
                        </span>
                      </span>
                    </div>

                    <div className="picker-actions">
                      <span className="price">
                        {formatMoney(product.price)}
                      </span>

                      <input
                        type="number"
                        className="qty-input"
                        min="1"
                        max={Math.max(available, 1)}
                        disabled={disabled}
                        value={quantity}
                        aria-label={`Cantidad de ${product.name}`}
                        onChange={(event) =>
                          setQtyMap((current) => ({
                            ...current,
                            [product.id]: event.target.value,
                          }))
                        }
                      />

                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={disabled}
                        onClick={() => addToCartWithQty(product, quantity)}
                      >
                        <FaPlus aria-hidden="true" />
                        Agregar
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* ── VENTA ACTUAL ─────────────────────────────── */}
        <aside
          className="card cart-card"
          aria-labelledby="pos-titulo-venta"
        >
          <div className="card-pad">
            <h2 id="pos-titulo-venta" className="pos-titulo">
              Venta actual
            </h2>

            {/*
              No es la etiqueta de un campo sino el nombre de un grupo de
              botones. Como <label> no anunciaba nada y dejaba el grupo sin
              nombre, pasa a rotularlo con aria-labelledby.
            */}
            <div
              className="field"
              role="group"
              aria-labelledby="pos-forma-pago"
            >
              <span id="pos-forma-pago" className="rotulo-de-grupo">
                Forma de pago
              </span>

              <div className="pay-toggle">
                <button
                  type="button"
                  className={paymentType === "contado" ? "active" : ""}
                  aria-pressed={paymentType === "contado"}
                  onClick={() => handlePaymentTypeChange("contado")}
                >
                  <FaMoneyBillWave aria-hidden="true" />
                  Contado
                </button>

                <button
                  type="button"
                  className={paymentType === "credito" ? "active" : ""}
                  aria-pressed={paymentType === "credito"}
                  onClick={() => handlePaymentTypeChange("credito")}
                >
                  <FaRegCreditCard aria-hidden="true" />
                  Crédito
                </button>
              </div>
            </div>

            <div className="pos-campo">
              <ClientAutocomplete
                clients={clients}
                label={
                  paymentType === "credito"
                    ? "Cliente requerido para crédito"
                    : "Cliente"
                }
                placeholder={
                  paymentType === "credito"
                    ? "Busca el nombre del cliente..."
                    : "Escribe el nombre o busca un cliente..."
                }
                value={clientSearch}
                selectedClient={selectedClient}
                required={paymentType === "credito"}
                allowFreeText={paymentType === "contado"}
                onChange={handleClientSearchChange}
                onSelect={handleSelectClient}
                onClear={handleClearClient}
                onCreateNew={modoSinConexion ? undefined : openNewClientModal}
              />
            </div>

            {paymentType === "credito" && (
              <div className="field pos-campo">
                <label htmlFor="pos-fecha-de-vencimiento">
                  Fecha de vencimiento
                </label>

                <input
                  id="pos-fecha-de-vencimiento"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            )}

            <div className="field pos-campo">
              <label htmlFor="pos-rtn-del-comprador-opcional">
                RTN del comprador{" "}
                <span className="etiqueta-suave">(opcional)</span>
              </label>

              <input
                id="pos-rtn-del-comprador-opcional"
                type="text"
                maxLength="20"
                placeholder="Ej. 0801-1990-01234"
                value={buyerRTN}
                onChange={(event) => setBuyerRTN(event.target.value)}
              />

              <span className="hint">
                Se imprime en la factura si el cliente lo solicita.
              </span>
            </div>

            <div className="cart-items">
              {cart.length === 0 ? (
                <EmptyState
                  Icono={FaShoppingCart}
                  titulo="Todavía no hay productos"
                  descripcion="Agrega productos de la lista para iniciar la venta."
                />
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="cart-row">
                    <div className="name">
                      {item.name}

                      <small>{formatMoney(item.price)} c/u</small>
                    </div>

                    <div className="stepper">
                      <button
                        type="button"
                        aria-label={`Quitar una unidad de ${item.name}`}
                        onClick={() => changeQuantity(item.id, -1)}
                      >
                        −
                      </button>

                      <span>{item.quantity}</span>

                      <button
                        type="button"
                        aria-label={`Agregar una unidad de ${item.name}`}
                        onClick={() => changeQuantity(item.id, 1)}
                      >
                        +
                      </button>
                    </div>

                    <div className="sub">
                      {formatMoney(item.price * item.quantity)}
                    </div>

                    <button
                      type="button"
                      className="icon-btn danger cart-remove-button"
                      onClick={() => removeFromCart(item.id)}
                      aria-label={`Eliminar ${item.name} de la venta`}
                      title="Eliminar producto"
                    >
                      <FaTrash aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="totals">
              <div className="totals-row">
                <span>Subtotal</span>

                <span className="v">{formatMoney(subtotal)}</span>
              </div>

              <div className="totals-row">
                <span>ISV ({tasaISV}%)</span>

                <span className="v">{formatMoney(tax)}</span>
              </div>

              <div className="totals-row grand">
                <span>Total</span>

                <span className="v">{formatMoney(total)}</span>
              </div>
            </div>

            <div className="pos-acciones">
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={cart.length === 0 || facturando || !existenciaLista || bloqueadoSinConexion}
                onClick={generateSale}
              >
                {textoDelBotonDeVenta(facturando, modoSinConexion)}
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={cart.length === 0}
                onClick={openPreview}
              >
                Vista previa
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={cart.length === 0}
                onClick={clearCurrentSale}
              >
                Vaciar venta
              </button>
            </div>
          </div>
        </aside>
      </div>

      <ModalDeCliente
        abierto={clientModalOpen}
        prefijo="pos"
        formulario={clientForm}
        onCambiar={setClientForm}
        onGuardar={saveNewClient}
        onCerrar={cerrarModalDeCliente}
        guardando={guardandoCliente}
      />

      <DocumentPreviewModal
        open={previewOpen && !!previewSale}
        title={
          previewMode === "saved" ? "Factura" : "Vista previa de factura"
        }
        fileName={
          previewMode === "saved"
            ? `Factura-${previewSale?.invoiceNumber || "venta"}.pdf`
            : "Vista-previa-factura.pdf"
        }
        printTitle="Factura"
        canExport={previewMode === "saved"}
        onConfirm={previewMode === "preview" ? confirmPreviewSale : undefined}
        confirmLabel={modoSinConexion ? "Guardar venta sin conexión" : "Generar factura"}
        onClose={() => {
          setPreviewOpen(false)
          setPreviewSale(null)
        }}
      >
        {previewSale?.sinConexion ? (
          <ComprobanteProvisional venta={previewSale.venta} empresa={copiaLocal?.empresa} vistaPrevia />
        ) : (
          <InvoiceTemplate sale={previewSale} />
        )}
      </DocumentPreviewModal>

      <DocumentPreviewModal
        open={Boolean(comprobante)}
        title="Comprobante provisional"
        fileName={`Comprobante-provisional-${comprobante?.numeroProvisional || "venta"}.pdf`}
        printTitle="Comprobante provisional"
        canExport
        onClose={() => setComprobante(null)}
      >
        <ComprobanteProvisional venta={comprobante} empresa={sinConexion?.copia?.empresa} />
      </DocumentPreviewModal>

      {panelAbierto && sinConexion && (
        <PanelDeVentasLocales
          estado={sinConexion}
          onCerrar={() => setPanelAbierto(false)}
          onVerComprobante={(venta) => {
            setPanelAbierto(false)
            setComprobante(venta)
          }}
        />
      )}
    </div>
  )
}

export default POS
