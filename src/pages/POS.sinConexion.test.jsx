import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { IDBFactory } from "fake-indexeddb"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import SalesProvider from "../context/SalesContext"
import { SinConexionProvider } from "../context/SinConexionContext"
import { abrirAlmacen } from "../lib/sinConexion/almacen"
import { renderizarPantalla, EMPRESA } from "../test/pantallas"
import { agregarProducto as agregar } from "../test/carrito"
import POS from "./POS"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El POS sin conexión de punta a punta (OFF-1.3): el motor real sobre una
  IndexedDB en memoria, la sesión y los datos sobre el doble de Supabase,
  y la RPC de sincronización simulada como la de 0027 (idempotente).

  La conexión la decide la prueba: `conexion.disponible` es lo que
  responde el servidor, y los eventos online/offline del navegador avisan.
*/

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 5 },
]

const CLIENTES = [{ id: "c1", name: "Ferremax", rtn: "0801199912345", phone: "9999-0000", address: "SPS", email: "" }]

const CAMION = { id: "camion-01", name: "Camión 01", type: "camion", offline: true }

const EXISTENCIAS = [
  { locationId: "camion-01", productId: "p1", quantity: 2 },
  { locationId: "camion-01", productId: "p2", quantity: 5 },
]

let conexion
let servidor
let navegador

function servidorDeSincronizacion() {
  const porClave = new Map()
  const estado = { recibidas: [], respuestas: [] }

  estado.rpc = (argumentos) => {
    estado.recibidas.push(argumentos)

    const forzada = estado.respuestas.shift()
    if (forzada) return forzada

    if (!porClave.has(argumentos.p_clave_idempotencia)) {
      const n = porClave.size + 1
      porClave.set(argumentos.p_clave_idempotencia, { venta_id: `v-${n}`, numero_factura: `000-001-01-0000010${n}` })

      return { data: { estado: "registrada", ...porClave.get(argumentos.p_clave_idempotencia) }, error: null, status: 200 }
    }

    return { data: { estado: "ya_registrada", ...porClave.get(argumentos.p_clave_idempotencia) }, error: null, status: 200 }
  }

  return estado
}

async function renderPOS({ ubicacion = CAMION, rpcsExtra = {}, fallarEn = {} } = {}) {
  const resultado = await renderizarPantalla(
    <AuthProvider>
      <SinConexionProvider
        abrir={() => abrirAlmacen({ indexedDB: navegador })}
        comprobarServidor={async () => conexion.disponible}
      >
        <ProductProvider>
          <ClientsProvider>
            <SalesProvider>
              <MemoryRouter initialEntries={["/pos"]}>
                <POS />
              </MemoryRouter>
            </SalesProvider>
          </ClientsProvider>
        </ProductProvider>
      </SinConexionProvider>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      clientes: CLIENTES,
      ubicaciones: [ubicacion],
      existencias: EXISTENCIAS,
      ubicacionOperativa: ubicacion.id,
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["pos", "clients", "inventory-own", "sales-history"],
      fallarEn,
      rpcsExtra: { sincronizar_venta_sin_conexion: (a) => servidor.rpc(a), ...rpcsExtra },
      esperar: ["ventas"],
    }
  )

  return resultado
}

// Con conexión: la copia de la ubicación quedó descargada.
const esperarCopia = () => waitFor(() => expect(screen.getByText(/sin ventas pendientes/i)).toBeInTheDocument())

async function quitarConexion() {
  conexion.disponible = false
  await act(async () => {
    window.dispatchEvent(new Event("offline"))
  })
  await waitFor(() => expect(screen.getAllByText(/^sin conexión$/i).length).toBeGreaterThan(0))
}

async function devolverConexion() {
  conexion.disponible = true
  await act(async () => {
    window.dispatchEvent(new Event("online"))
  })
}

const botonGuardarSinConexion = () => screen.getByRole("button", { name: /guardar venta sin conexión/i })

const filaDelCatalogo = (nombre) => screen.getAllByText(nombre)[0].closest(".picker-item")

beforeEach(() => {
  conexion = { disponible: true }
  servidor = servidorDeSincronizacion()
  navegador = new IDBFactory()
  Swal.fire.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("POS con conexión", () => {
  it("vende en línea como siempre y muestra el estado de la conexión", async () => {
    const { falso } = await renderPOS()
    await esperarCopia()

    expect(screen.getByText(/en línea/i)).toBeInTheDocument()

    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

    await waitFor(() => expect(falso.datos.ventas).toHaveLength(1))
    expect(servidor.recibidas).toEqual([])
    expect(screen.queryByText(/comprobante provisional/i)).not.toBeInTheDocument()
  })
})

describe("POS sin conexión en una ubicación habilitada", () => {
  it("guarda la venta en el teléfono con comprobante provisional, sin llamar al servidor y sin presentarla como factura", async () => {
    const { falso } = await renderPOS()
    await esperarCopia()
    await quitarConexion()

    expect(screen.getByText(/modo sin conexión/i)).toBeInTheDocument()

    agregar("Martillo de uña")
    fireEvent.click(botonGuardarSinConexion())

    await waitFor(() => expect(screen.getByText("COMPROBANTE PROVISIONAL")).toBeInTheDocument())
    expect(screen.getByText(/no es una factura\./i)).toBeInTheDocument()
    expect(screen.getAllByText(/^PROV-[A-Z0-9]{4}-000001$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^CAI$/)).not.toBeInTheDocument()
    expect(falso.datos.ventas).toHaveLength(0)
    expect(falso.rpc).not.toHaveBeenCalledWith("registrar_venta_ubicacion", expect.anything())
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Venta guardada en este teléfono" }))
    await waitFor(() => expect(screen.getByText(/1 venta pendiente de sincronizar/i)).toBeInTheDocument())
  })

  it("descuenta del disponible lo que ya vendió el teléfono y no deja vender de más", async () => {
    await renderPOS()
    await esperarCopia()
    await quitarConexion()

    expect(within(filaDelCatalogo("Martillo de uña")).getByText("2 disp.")).toBeInTheDocument()

    agregar("Martillo de uña")
    agregar("Martillo de uña")
    fireEvent.click(botonGuardarSinConexion())
    await waitFor(() => expect(screen.getByText(/2 ventas? pendientes? de sincronizar|1 venta pendiente/i)).toBeInTheDocument())

    await waitFor(() => expect(within(filaDelCatalogo("Martillo de uña")).getByText("0 disp.")).toBeInTheDocument())
    expect(within(filaDelCatalogo("Martillo de uña")).getByRole("button", { name: /agregar/i })).toBeDisabled()
  })

  it("a crédito solo con un cliente de la copia, y sin dar de alta clientes nuevos", async () => {
    await renderPOS()
    await esperarCopia()
    await quitarConexion()

    fireEvent.click(screen.getByRole("button", { name: /crédito/i }))
    const buscador = screen.getByPlaceholderText(/busca el nombre del cliente/i)
    fireEvent.change(buscador, { target: { value: "Ferre" } })

    expect(screen.queryByRole("button", { name: /nuevo cliente|crear/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /ferremax/i }))
    agregar("Cemento gris")
    fireEvent.click(botonGuardarSinConexion())

    await waitFor(() => expect(screen.getByText("COMPROBANTE PROVISIONAL")).toBeInTheDocument())
    expect(screen.getAllByText("Crédito").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Ferremax").length).toBeGreaterThan(0)
  })

  it("al volver la conexión se sincroniza sola y la venta queda registrada con su factura", async () => {
    await renderPOS()
    await esperarCopia()
    await quitarConexion()

    agregar("Martillo de uña")
    fireEvent.click(botonGuardarSinConexion())
    await waitFor(() => expect(screen.getByText(/1 venta pendiente de sincronizar/i)).toBeInTheDocument())

    await devolverConexion()

    await waitFor(() => expect(servidor.recibidas).toHaveLength(1))
    expect(servidor.recibidas[0]).toMatchObject({ p_ubicacion_id: "camion-01", p_forma_pago: "contado" })
    expect(servidor.recibidas[0].p_clave_idempotencia).toMatch(/^off-/)
    await waitFor(() => expect(screen.getByText(/sin ventas pendientes/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /ventas sin conexión/i }))
    const panel = await screen.findByRole("dialog", { name: /ventas sin conexión de este teléfono/i })
    expect(within(panel).getByText("Registrada")).toBeInTheDocument()
    expect(within(panel).getByText("Factura 000-001-01-00000101")).toBeInTheDocument()
  })

  it("si el servidor la deja en conciliación, se ve en conciliación y no como registrada", async () => {
    servidor.respuestas.push({
      data: { estado: "en_conciliacion", conciliacion_id: "conc-1", motivo: "existencia-insuficiente" },
      error: null,
      status: 200,
    })
    await renderPOS()
    await esperarCopia()
    await quitarConexion()

    agregar("Martillo de uña")
    fireEvent.click(botonGuardarSinConexion())
    await waitFor(() => expect(screen.getByText(/1 venta pendiente de sincronizar/i)).toBeInTheDocument())
    await devolverConexion()

    await waitFor(() => expect(screen.getByText(/1 en conciliación/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /ventas sin conexión/i }))
    const panel = await screen.findByRole("dialog", { name: /ventas sin conexión de este teléfono/i })
    expect(within(panel).getByText("En conciliación")).toBeInTheDocument()
    expect(within(panel).queryByText("Registrada")).not.toBeInTheDocument()
    expect(within(panel).getByText(/no había existencia suficiente/i)).toBeInTheDocument()
  })

  it("exporta un respaldo cifrado sin borrar ni cambiar las ventas", async () => {
    const descargas = []
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      descargas.push(blob)
      return "blob:respaldo"
    })
    globalThis.URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    await renderPOS()
    await esperarCopia()
    await quitarConexion()
    agregar("Martillo de uña")
    fireEvent.click(botonGuardarSinConexion())
    await waitFor(() => expect(screen.getByText(/1 venta pendiente de sincronizar/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /ventas sin conexión/i }))
    fireEvent.click(await screen.findByRole("button", { name: /respaldo cifrado/i }))
    fireEvent.change(screen.getByLabelText(/frase de protección/i), { target: { value: "frase-larga-2026" } })
    fireEvent.change(screen.getByLabelText(/repite la frase/i), { target: { value: "frase-larga-2026" } })
    fireEvent.click(screen.getByRole("button", { name: /generar archivo cifrado/i }))

    await waitFor(() => expect(screen.getByText(/archivo generado/i)).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByText(/las ventas siguen guardadas en este teléfono/i)).toBeInTheDocument()
    expect(descargas).toHaveLength(1)

    const contenido = JSON.parse(await descargas[0].text())
    expect(contenido).toMatchObject({ formato: "lunacell-rescate-v1", algoritmo: "AES-GCM" })
    expect(JSON.stringify(contenido)).not.toContain("Martillo")
    expect(screen.getByText(/1 venta pendiente de sincronizar/i)).toBeInTheDocument()
  })
})

describe("venta en línea que se queda sin respuesta", () => {
  // registrar_venta_ubicacion SÍ registra, pero la respuesta no llega.
  const registrarSinRespuesta = (argumentos, { datos }) => {
    datos.ventas.push({
      id: "v-en-linea",
      empresa_id: EMPRESA,
      numero_factura: "000-001-01-00000077",
      clave_idempotencia: argumentos.p_clave_idempotencia,
      fecha: "2026-10-10T12:00:00.000Z",
      forma_pago: "contado",
      estado: "pagada",
      subtotal: 180,
      isv: 27,
      tasa_isv: 15,
      total: 207,
    })

    return { data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 }
  }

  it("ofrece guardarla en el teléfono; al volver la conexión comprueba que ya existía y no la registra dos veces", async () => {
    await renderPOS({ rpcsExtra: { registrar_venta_ubicacion: registrarSinRespuesta } })
    await esperarCopia()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: false, isDenied: true, isDismissed: false })
    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "No hubo respuesta del servidor" })))
    await waitFor(() => expect(screen.getByText("COMPROBANTE PROVISIONAL")).toBeInTheDocument())

    await devolverConexion()

    await waitFor(() => expect(screen.getByText(/sin ventas pendientes/i)).toBeInTheDocument())
    expect(servidor.recibidas).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: /ventas sin conexión/i }))
    const panel = await screen.findByRole("dialog", { name: /ventas sin conexión de este teléfono/i })
    expect(within(panel).getByText("Factura 000-001-01-00000077")).toBeInTheDocument()
  })

  it("si el cajero elige reintentar, vuelve a enviar la misma venta en línea", async () => {
    let intentos = 0
    const { falso } = await renderPOS({
      rpcsExtra: {
        registrar_venta_ubicacion: (argumentos, contexto) => {
          intentos += 1
          if (intentos === 1) return { data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 }
          contexto.datos.ventas.push({ id: "v-2", empresa_id: EMPRESA, numero_factura: "000-001-01-00000078", fecha: "2026-10-10T12:00:00Z", total: 207, subtotal: 180, isv: 27, tasa_isv: 15, forma_pago: "contado", estado: "pagada" })
          return { data: { venta_id: "v-2", numero_factura: "000-001-01-00000078" }, error: null }
        },
      },
    })
    await esperarCopia()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, isDenied: false, isDismissed: false })
    agregar("Martillo de uña")
    fireEvent.click(screen.getByRole("button", { name: /generar factura/i }))

    await waitFor(() => expect(intentos).toBe(2))
    const claves = falso.rpc.mock.calls.filter(([n]) => n === "registrar_venta_ubicacion").map(([, a]) => a.p_clave_idempotencia)
    expect(new Set(claves).size).toBe(1)
    expect(screen.queryByText("COMPROBANTE PROVISIONAL")).not.toBeInTheDocument()
  })
})

describe("POS sin conexión en una ubicación sin autorización", () => {
  it("no deja vender y explica por qué", async () => {
    const { falso } = await renderPOS({ ubicacion: { ...CAMION, offline: false } })
    await waitFor(() => expect(falso.from).toHaveBeenCalledWith("ubicaciones"))
    await quitarConexion()

    expect(await screen.findByText(/no está habilitada para vender sin conexión/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /guardar venta sin conexión/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()
    // Sin habilitación no se descarga catálogo ni clientes para vender sin conexión.
    expect(falso.from.mock.calls.filter(([t]) => t === "productos_con_stock")).toHaveLength(1)
  })

  it("una ubicación fiscal no vende sin conexión", async () => {
    const { falso } = await renderPOS({ ubicacion: { ...CAMION, offline: false, fiscal: true } })
    await waitFor(() => expect(falso.from).toHaveBeenCalledWith("ubicaciones"))
    await quitarConexion()

    expect(await screen.findByText(/emite facturas fiscales y no vende sin conexión/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generar factura/i })).toBeDisabled()
  })
})
