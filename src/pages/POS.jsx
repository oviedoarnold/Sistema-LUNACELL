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
import SelectorDeMedios, { AvisoDeMedios } from "../components/pagos/SelectorDeMedios"
import { TASA_DE_CARGO, cargoDeCobros, cobrosDelSelector, problemaDelSelector, selectorVacio } from "../utils/mediosDePago"
import { tipoDeUbicacion } from "../lib/api/ubicaciones"
import { usePreciosDeCliente } from "../hooks/usePreciosDeCliente"
import { totalesDe } from "../lib/sinConexion/venta"
import { useClienteDelDocumento } from "../hooks/useClienteDelDocumento"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"
import ComprobanteProvisional from "../components/sinConexion/ComprobanteProvisional"
import EstadoSinConexion from "../components/sinConexion/EstadoSinConexion"
import PrecioDeLinea from "../components/pos/PrecioDeLinea"
import { esPrecioValido, necesitaMotivo, problemaDelPrecioNegociado } from "../utils/preciosNegociados"
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
  const { user, hasPermission, permissions } = useAuth()
  const puedeNegociar = hasPermission(permissions.POS)
  const sinServidor =
    Boolean(sinConexion) &&
    (Boolean(user?.sinConexion) || sinConexion.conexion === "sin_red" || sinConexion.conexion === "sin_servidor")
  const modoSinConexion = sinServidor && Boolean(sinConexion?.ubicacionAutorizada)
  const bloqueadoSinConexion = sinServidor && !modoSinConexion
  const copiaLocal = modoSinConexion ? sinConexion.copia : null
  const mostrarEstado =
    Boolean(sinConexion) &&
    (sinConexion.ubicacionAutorizada ||
      sinConexion.ventas.length > 0 ||
      sinConexion.ventasDeOtrosUsuarios > 0 ||
      sinServidor ||
      sinConexion.actualizacionPendiente)

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
  const tasaDeLaEmpresa = Number(
    modoSinConexion ? copiaLocal?.empresa?.tasaIsv ?? ISV_POR_OMISION : company?.taxRate ?? ISV_POR_OMISION
  )

  /*
    La casilla de ISV nace marcada solo en la tienda, y el vendedor la cambia si
    hace falta. Hasta saber el tipo de la ubicación no se puede facturar: una venta
    de la tienda no debe salir sin ISV por haber pulsado antes de tiempo.
  */
  const ubicacionId = user?.locationId || ""
  const [tipoEnLinea, setTipoEnLinea] = useState()
  const [isvElegido, setIsvElegido] = useState(null)

  useEffect(() => {
    if (!ubicacionId || modoSinConexion) return undefined

    let vigente = true

    void tipoDeUbicacion(ubicacionId).then((tipo) => {
      if (vigente) setTipoEnLinea(tipo)
    })

    return () => {
      vigente = false
    }
  }, [ubicacionId, modoSinConexion])

  const tipoDeMiUbicacion = modoSinConexion ? copiaLocal?.ubicacion?.tipo : tipoEnLinea
  const tipoPendiente = !modoSinConexion && Boolean(ubicacionId) && tipoEnLinea === undefined
  const conIsv = isvElegido ?? tipoDeMiUbicacion === "tienda"
  const tasaISV = conIsv ? tasaDeLaEmpresa : 0

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
  const [medios, setMedios] = useState(selectorVacio)

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
    lineas: lineasDelCarrito,
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

  /*
    El precio de cada producto para este cliente, y primero sus habituales. Las
    líneas del carrito también lo toman de aquí: cambiar de cliente las actualiza
    sin tocar lo que se pidió. Quien decide al facturar es el servidor (0042).
  */
  const {
    precios: preciosDelCliente,
    cargando: preciosCargando,
    fallo: preciosFallo,
  } = usePreciosDeCliente({
    clienteId: selectedClient?.id || null,
    sinConexion: modoSinConexion,
    copia: copiaLocal,
  })

  const catalogoDelCliente = useMemo(() => {
    const conPrecio = productosEnVenta.map((producto) => {
      const especial = preciosDelCliente[producto.id]

      return especial === undefined ? producto : { ...producto, price: especial, precioEspecial: true }
    })

    return [
      ...conPrecio.filter((p) => p.precioEspecial),
      ...conPrecio.filter((p) => !p.precioEspecial),
    ]
  }, [productosEnVenta, preciosDelCliente])

  /*
    El precio negociado vale solo para esta venta y manda sobre los demás. Se escribe
    directo en la línea: se guarda lo escrito y el motivo. Igual al de referencia no
    es una negociación: pasa si al cambiar de cliente coinciden. Lo que no sea un
    precio válido deja la línea con su referencia y no deja facturar.
  */
  const [negociaciones, setNegociaciones] = useState({})

  const cart = useMemo(
    () =>
      lineasDelCarrito.map((linea) => {
        const producto = catalogoDelCliente.find((p) => String(p.id) === String(linea.id))
        const base = producto ? { ...linea, price: producto.price, precioEspecial: Boolean(producto.precioEspecial) } : linea
        const referencia = Number(base.price)
        const negociacion = negociaciones[linea.id]

        if (!negociacion) return { ...base, precioReferencia: referencia }

        const conEscrito = { ...base, precioReferencia: referencia, precioEscrito: negociacion.texto }
        const problema = problemaDelPrecioNegociado(negociacion.texto, referencia, negociacion.motivo)
        const valor = Number(negociacion.texto)

        if (!esPrecioValido(negociacion.texto)) return { ...conEscrito, problemaDePrecio: problema }

        if (valor === referencia) return conEscrito

        return {
          ...conEscrito,
          price: valor,
          negociado: true,
          motivoNegociacion: necesitaMotivo(valor, referencia) ? negociacion.motivo || null : null,
          problemaDePrecio: problema,
        }
      }),
    [lineasDelCarrito, catalogoDelCliente, negociaciones]
  )

  // Un producto que sale del carrito pierde su negociación: al volver, usa su precio.
  const negociacionesSobrantes = Object.keys(negociaciones).filter(
    (id) => !lineasDelCarrito.some((linea) => String(linea.id) === id)
  )

  if (negociacionesSobrantes.length > 0) {
    setNegociaciones(
      Object.fromEntries(Object.entries(negociaciones).filter(([id]) => !negociacionesSobrantes.includes(id)))
    )
  }

  // Un precio no válido o un motivo que falta: la venta no se confirma.
  const precioPendiente = cart.some((linea) => linea.problemaDePrecio)

  const restaurarPrecio = (id) => {
    setNegociaciones((actuales) => Object.fromEntries(Object.entries(actuales).filter(([clave]) => clave !== String(id))))
  }

  const escribirPrecio = (id, texto) => {
    setNegociaciones((actuales) => ({ ...actuales, [id]: { motivo: "", ...actuales[id], texto } }))
  }

  const elegirMotivo = (id, motivo) => {
    setNegociaciones((actuales) => ({ ...actuales, [id]: { ...actuales[id], motivo } }))
  }

  // Al salir del campo: un precio válido queda con dos decimales; el de referencia, sin negociación.
  const terminarPrecio = (linea) => {
    const texto = negociaciones[linea.id]?.texto

    if (texto === undefined || !esPrecioValido(texto)) return

    if (Number(texto) === linea.precioReferencia) {
      restaurarPrecio(linea.id)
      return
    }

    escribirPrecio(linea.id, Number(texto).toFixed(2))
  }

  /*
    Avisa si un producto que ya estaba en el carrito cambió de precio. Se compara
    al terminar de cargar: mientras carga, el precio general es solo de paso.
  */
  const [preciosVistos, setPreciosVistos] = useState({})
  const [avisoDePrecios, setAvisoDePrecios] = useState("")
  const firmaDePrecios = cart.map((l) => `${l.id}:${l.precioReferencia}`).join("|")
  const [firmaVista, setFirmaVista] = useState("")

  if (!preciosCargando && firmaDePrecios !== firmaVista) {
    const cambio = cart.some((l) => preciosVistos[l.id] !== undefined && preciosVistos[l.id] !== l.precioReferencia)

    setFirmaVista(firmaDePrecios)
    setPreciosVistos(Object.fromEntries(cart.map((l) => [l.id, l.precioReferencia])))

    if (cambio) {
      const conservados = cart.some((l) => l.negociado) ? " Se conservan los precios negociados." : ""

      setAvisoDePrecios(
        selectedClient
          ? `Precios actualizados para ${selectedClient.name}.${conservados}`
          : `Precios actualizados: se usan los precios generales.${conservados}`
      )
    }
  }

  const filteredProducts = useMemo(
    () =>
      filterProductsBySearchText(
        catalogoDelCliente,
        search
      ),
    [catalogoDelCliente, search]
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

  /*
    El total que se reparte entre los medios, con la misma fórmula que la base:
    redondeo por línea e ISV sobre el subtotal. Si el precio cambió desde que se
    cargó el catálogo, el servidor lo rechaza en vez de cobrar otro importe.
  */
  const totalACobrar = useMemo(
    () => totalesDe(cart.map((item) => ({ precio_unitario: item.price, cantidad: item.quantity })), tasaISV).total,
    [cart, tasaISV]
  )

  const cobrosDeLaVenta = () => (paymentType === "contado" ? cobrosDelSelector(medios, totalACobrar) : [])

  // Mientras los medios no sumen el total, la venta no se puede confirmar.
  const mediosSinCuadrar =
    paymentType === "contado" && problemaDelSelector(medios, totalACobrar) !== null

  // Lo que tarjeta y enlace suman a lo que paga el comprador.
  const cargo = cargoDeCobros(cobrosDeLaVenta())

  // Productos distintos y unidades son cifras diferentes: dos cargadores son un producto.
  const unidades = cart.reduce((suma, item) => suma + Number(item.quantity), 0)

  const handlePaymentTypeChange = (
    type
  ) => {
    setPaymentType(type)
    setMedios(selectorVacio())
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
    cargo,

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
      ...(item.negociado ? { precioNegociado: item.price, motivoNegociacion: item.motivoNegociacion } : {}),
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
    cobros: cobrosDeLaVenta(),
    conIsv,
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
    cobros: cobrosDeLaVenta(),
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
    setMedios(selectorVacio())
    setIsvElegido(null)
    setAvisoDePrecios("")
    setNegociaciones({})
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
        carrito: cart.map((item) => ({
          productoId: item.id,
          cantidad: Number(item.quantity),
          ...(item.negociado ? { precioNegociado: item.price, motivoNegociacion: item.motivoNegociacion } : {}),
        })),
        formaPago: paymentType,
        clienteId: selectedClient?.id || null,
        nombreCliente: getCustomerName(),
        rtnComprador: buyerRTN.trim() || selectedClient?.rtn || "",
        fechaVencimiento: paymentType === "credito" ? dueDate : null,
        /*
          Si nace de un intento en línea sin respuesta, queda escrito: si el
          vendedor cambia de ubicación antes de sincronizar, no se puede
          comprobar ese intento y un administrador lo revisa en conciliación.
        */
        nota: claveEnLinea ? `Intento en línea sin respuesta: ${claveEnLinea}` : "",
        claveEnLinea,
        cobros: cobrosDeLaVenta(),
        conIsv,
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

    if (paymentType === "contado") {
      const problema = problemaDelSelector(medios, totalACobrar)

      if (problema) {
        Swal.fire({ icon: "warning", title: "Revisa el medio de pago", text: problema })

        return null
      }
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

      /*
        Y la copia para vender sin conexión también: si la conexión se cae
        ahora, lo que se acaba de vender no puede seguir apareciendo como
        disponible.
      */
      void sinConexion?.actualizarCopia({ forzar: true })

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
            {copiaLocal?.preciosDisponibles === false && " La copia no tiene los precios especiales: se usan los generales."}
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
                        {product.precioEspecial && <small className="pos-precio-especial">Precio especial</small>}
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
          <div className="card-pad pos-panel">
            <div className="pos-panel-cuerpo">
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

              <div className="pos-cliente-rtn">
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
                        : "Nombre o buscar cliente..."
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
                </div>
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

              {paymentType === "contado" && (
                <SelectorDeMedios
                  valor={medios}
                  total={totalACobrar}
                  onCambiar={setMedios}
                />
              )}

              <section className="pos-articulos" aria-labelledby="pos-titulo-articulos">
                <div className="pos-articulos-cabecera">
                  <h3 id="pos-titulo-articulos" className="pos-titulo">
                    Artículos facturados
                  </h3>

                  <span className="pos-articulos-cuenta">
                    {cart.length} {cart.length === 1 ? "producto" : "productos"} · {unidades}{" "}
                    {unidades === 1 ? "unidad" : "unidades"}
                  </span>
                </div>

                {avisoDePrecios && cart.length > 0 && (
                  <p className="pos-aviso-precios" role="status">{avisoDePrecios}</p>
                )}

                {preciosFallo && (
                  <p className="pos-aviso-precios is-error" role="alert">
                    No se pudieron cargar los precios de este cliente. Vuelve a elegirlo para facturar.
                  </p>
                )}

                <div className="cart-items">
                  {cart.length === 0 ? (
                    <EmptyState
                      Icono={FaShoppingCart}
                      titulo="Todavía no hay productos"
                      descripcion="Agrega productos de la lista para iniciar la venta."
                    />
                  ) : (
                    cart.map((item, indice) => (
                      <div key={item.id} className="cart-row">
                        {/* Solo se ve aquí: no cambia el orden ni los datos de la factura. */}
                        <span className="pos-linea-numero">{indice + 1}.</span>

                        <div className="name">
                          {item.name}

                          {!puedeNegociar && <small>{formatMoney(item.price)} c/u</small>}

                          {item.negociado && (
                            <small className="pos-precio-especial">
                              Precio negociado · antes{" "}
                              <span className="pos-importe">{formatMoney(item.precioReferencia)}</span>
                              {puedeNegociar && (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="pos-precio-enlace"
                                    aria-label={`Restaurar el precio de ${item.name}`}
                                    onClick={() => restaurarPrecio(item.id)}
                                  >
                                    Restaurar
                                  </button>
                                </>
                              )}
                            </small>
                          )}

                          {!item.negociado && item.precioEspecial && (
                            <small className="pos-precio-especial">Precio especial</small>
                          )}
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

                        {puedeNegociar && (
                          <PrecioDeLinea
                            linea={item}
                            onEscribir={(texto) => escribirPrecio(item.id, texto)}
                            onTerminar={() => terminarPrecio(item)}
                            onMotivo={(motivo) => elegirMotivo(item.id, motivo)}
                          />
                        )}

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
              </section>
            </div>

            <div className="pos-panel-pie">
              <div className="totals">
                <div className="totals-row">
                  <span>Subtotal</span>

                  <span className="v">{formatMoney(subtotal)}</span>
                </div>

                <div className="totals-row">
                  <label className="pos-isv">
                    <input
                      type="checkbox"
                      checked={conIsv}
                      onChange={(event) => setIsvElegido(event.target.checked)}
                    />
                    ISV ({tasaDeLaEmpresa}%)
                  </label>

                  <span className="v">{formatMoney(tax)}</span>
                </div>

                {cargo > 0 && (
                  <div className="totals-row pos-cargo">
                    <span>Cargo por medio de pago ({TASA_DE_CARGO}%)</span>

                    <span className="v">{formatMoney(cargo)}</span>
                  </div>
                )}

                <div className="totals-row grand">
                  <span>Total</span>

                  <span className="v">{formatMoney(total + cargo)}</span>
                </div>
              </div>

              {paymentType === "contado" && (
                <AvisoDeMedios valor={medios} total={totalACobrar} />
              )}

              <div className="pos-acciones">
                <button
                  type="button"
                  className="btn btn-primary btn-lg btn-block"
                  disabled={cart.length === 0 || facturando || !existenciaLista || bloqueadoSinConexion || mediosSinCuadrar || tipoPendiente || preciosCargando || preciosFallo || precioPendiente}
                  onClick={generateSale}
                >
                  {textoDelBotonDeVenta(facturando, modoSinConexion)}
                </button>

                <div className="pos-acciones-secundarias">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={cart.length === 0 || precioPendiente}
                    onClick={openPreview}
                  >
                    Vista previa
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={cart.length === 0}
                    onClick={clearCurrentSale}
                  >
                    Vaciar venta
                  </button>
                </div>
              </div>
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
        confirmDisabled={mediosSinCuadrar}
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
