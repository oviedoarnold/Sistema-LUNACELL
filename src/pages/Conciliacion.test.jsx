import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla, EMPRESA } from "../test/pantallas"
import { exportarCifrado } from "../lib/sinConexion/exportacion"
import Conciliacion from "./Conciliacion"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Conciliación y rescate (OFF-1.3) sobre el doble de Supabase, con
  conciliar_venta y rescatar_venta_sin_conexion simuladas como en
  0027/0028.
*/

const CAMION = { id: "camion-01", name: "Camión 01", type: "camion", offline: true }
const VENDEDOR = { id: "u-vendedor", auth_id: "auth-vendedor", nombre: "Chofer Camión", email: "chofer@x.test" }

const porConciliar = (cambios = {}) => ({
  id: "conc-1",
  empresa_id: EMPRESA,
  clave_idempotencia: "off-dispositivo-0001-aaaa",
  huella: "h",
  usuario_id: "u-vendedor",
  usuario_auth: "auth-vendedor",
  ubicacion_id: "camion-01",
  dispositivo: "dispositivo-0001",
  numero_provisional: "PROV-DISP-000001",
  registrada_en: "2026-10-10T10:00:00.000Z",
  reloj_dispositivo: "2026-10-10T10:00:01.000Z",
  recibida_en: "2026-10-10T11:00:00.000Z",
  desfase_segundos: 2,
  forma_pago: "contado",
  cliente_id: null,
  nombre_cliente: "Consumidor Final",
  rtn_comprador: "",
  fecha_vencimiento: null,
  nota: "",
  renglones: [{ producto_id: "p1", codigo: "M-001", nombre: "Martillo de uña", cantidad: 3, precio_unitario: 180 }],
  tasa_isv: 15,
  total_cobrado: 621,
  motivo: "existencia-insuficiente",
  codigo: "LV007",
  detalle: "Solo hay 1 en Camión 01",
  recibida_por: "vendedor",
  rescatada_por: null,
  estado: "pendiente",
  resuelta_en: null,
  resolucion_accion: null,
  resolucion_motivo: null,
  venta_id: null,
  ajuste_movimientos: [],
  ...cambios,
})

let rpcs

async function renderConciliacion({ rol = "admin", tablasExtra = {}, permisos = [] } = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <MemoryRouter initialEntries={["/reconciliation"]}>
          <Conciliacion />
        </MemoryRouter>
      </LocationsProvider>
    </AuthProvider>,
    {
      ubicaciones: [CAMION],
      otrosUsuarios: [VENDEDOR],
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      tablasExtra: { ventas_por_conciliar: [porConciliar()], auditoria_rescates: [], ...tablasExtra },
      rpcsExtra: {
        conciliar_venta: (a) => rpcs.conciliar(a),
        rescatar_venta_sin_conexion: (a) => rpcs.rescatar(a),
      },
    }
  )
}

beforeEach(() => {
  rpcs = {
    conciliar: vi.fn(() => ({
      data: { estado: "aplicada", conciliacion_id: "conc-1", venta_id: "v-9", numero_factura: "INT-00000009", total: 621, ajustes: [41, 42] },
      error: null,
    })),
    rescatar: vi.fn(() => ({ data: { estado: "en_conciliacion", conciliacion_id: "conc-9", motivo: "rescate" }, error: null })),
  }
})

describe("acceso", () => {
  it("quien no es administrador no puede conciliar ni rescatar, aunque tenga Configuración", async () => {
    const { falso } = await renderConciliacion({ rol: "vendedor", permisos: ["settings"] })

    expect(screen.getByText(/solo para administradores/i)).toBeInTheDocument()
    expect(falso.from).not.toHaveBeenCalledWith("ventas_por_conciliar")
  })
})

describe("ventas por conciliar", () => {
  it("lista las pendientes con vendedor, ubicación, total y motivo en palabras", async () => {
    await renderConciliacion()

    const fila = (await screen.findByText("PROV-DISP-000001")).closest("tr")
    expect(within(fila).getByText("Chofer Camión")).toBeInTheDocument()
    expect(within(fila).getByText("Camión 01")).toBeInTheDocument()
    expect(within(fila).getByText(/no había existencia suficiente/i)).toBeInTheDocument()
    expect(within(fila).getByText("Pendiente")).toBeInTheDocument()
  })

  it("el detalle muestra origen, dispositivo, fecha, productos, cantidades y el detalle del servidor", async () => {
    await renderConciliacion()

    fireEvent.click(await screen.findByRole("button", { name: /revisar prov-disp-000001/i }))
    const detalle = screen.getByRole("dialog")

    expect(within(detalle).getByText("Enviada por el vendedor")).toBeInTheDocument()
    expect(within(detalle).getByText("dispositivo-0001")).toBeInTheDocument()
    expect(within(detalle).getByText(/Martillo de uña/)).toBeInTheDocument()
    expect(within(detalle).getByText("3")).toBeInTheDocument()
    expect(within(detalle).getByText(/solo hay 1 en camión 01 \(LV007\)/i)).toBeInTheDocument()
  })

  it("exige el motivo antes de llamar al servidor", async () => {
    await renderConciliacion()
    fireEvent.click(await screen.findByRole("button", { name: /revisar prov-disp-000001/i }))

    fireEvent.click(screen.getByRole("button", { name: /^aplicar$/i }))

    expect(await screen.findByText(/escribe el motivo/i)).toBeInTheDocument()
    expect(rpcs.conciliar).not.toHaveBeenCalled()
  })

  it("aplica con ajuste una sola vez y muestra el documento y los ajustes", async () => {
    await renderConciliacion()
    fireEvent.click(await screen.findByRole("button", { name: /revisar prov-disp-000001/i }))
    fireEvent.change(screen.getByLabelText(/motivo de la decisión/i), { target: { value: "Traslado registrado tarde" } })

    const boton = screen.getByRole("button", { name: /aplicar con ajuste/i })
    fireEvent.click(boton)
    fireEvent.click(boton)

    expect(await screen.findByText(/venta aplicada/i)).toBeInTheDocument()
    expect(screen.getByText(/documento INT-00000009/i)).toBeInTheDocument()
    expect(screen.getByText(/2 ajustes de inventario/i)).toBeInTheDocument()
    expect(rpcs.conciliar).toHaveBeenCalledTimes(1)
    expect(rpcs.conciliar).toHaveBeenCalledWith({
      p_conciliacion: "conc-1",
      p_accion: "aplicar_con_ajuste",
      p_motivo: "Traslado registrado tarde",
    })
    expect(screen.queryByRole("button", { name: /aplicar con ajuste/i })).not.toBeInTheDocument()
  })

  it("si el servidor no lo permite, muestra su motivo y no da nada por hecho", async () => {
    rpcs.conciliar.mockReturnValueOnce({
      data: null,
      error: { code: "CV007", message: "La venta es de una ubicación fiscal: no se registra como documento interno." },
    })
    await renderConciliacion()
    fireEvent.click(await screen.findByRole("button", { name: /revisar prov-disp-000001/i }))
    fireEvent.change(screen.getByLabelText(/motivo de la decisión/i), { target: { value: "Revisión" } })

    fireEvent.click(screen.getByRole("button", { name: /^aplicar$/i }))

    expect(await screen.findByText(/ubicación fiscal/i)).toBeInTheDocument()
    expect(screen.queryByText(/venta aplicada/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^anular$/i })).toBeEnabled()
  })

  it("una ya resuelta muestra la resolución y no ofrece acciones", async () => {
    await renderConciliacion({
      tablasExtra: {
        ventas_por_conciliar: [
          porConciliar({ estado: "anulada", resuelta_en: "2026-10-10T12:00:00Z", resolucion_accion: "anular", resolucion_motivo: "Venta duplicada" }),
        ],
      },
    })

    fireEvent.change(screen.getByLabelText(/mostrar/i), { target: { value: "" } })
    fireEvent.click(await screen.findByRole("button", { name: /revisar prov-disp-000001/i }))

    expect(screen.getByText(/venta duplicada/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^anular$/i })).not.toBeInTheDocument()
  })
})

describe("rescate de un respaldo cifrado", () => {
  const FRASE = "frase-del-camion-2026"

  const ventaDelRespaldo = (n) => ({
    clave: `off-dispositivo-0001-${String(n).padStart(8, "0")}`,
    empresaId: EMPRESA,
    usuarioAuth: "auth-vendedor",
    ubicacionId: "camion-01",
    dispositivo: "dispositivo-0001",
    numeroProvisional: `PROV-DISP-00000${n}`,
    registradaEn: "2026-10-09T15:00:00.000Z",
    renglones: [{ producto_id: "p1", codigo: "M-001", nombre: "Martillo de uña", cantidad: 1, precio_unitario: 180 }],
    tasaIsv: 15,
    totalCobrado: 207,
    formaPago: "contado",
    clienteId: null,
    nombreCliente: "Consumidor Final",
    rtnComprador: "",
    fechaVencimiento: null,
    nota: "",
    estado: "pendiente",
  })

  async function abrirRespaldo(ventas, frase = FRASE) {
    const contenido = await exportarCifrado(ventas, FRASE)
    const archivo = new File([contenido], "respaldo.json", { type: "application/json" })

    fireEvent.click(screen.getByRole("tab", { name: /rescate de respaldo/i }))
    fireEvent.change(screen.getByLabelText(/archivo de respaldo/i), { target: { files: [archivo] } })
    fireEvent.change(screen.getByLabelText(/frase del respaldo/i), { target: { value: frase } })
    fireEvent.click(screen.getByRole("button", { name: /abrir respaldo/i }))
  }

  it("abre el archivo, rescata cada venta con su lote y muestra también las rechazadas", async () => {
    rpcs.rescatar
      .mockReturnValueOnce({ data: { estado: "en_conciliacion", conciliacion_id: "conc-9" }, error: null })
      .mockReturnValueOnce({ data: { estado: "rechazado", codigo: "OF003", detalle: "La clave ya se usó para una venta distinta" }, error: null })
    await renderConciliacion()

    await abrirRespaldo([ventaDelRespaldo(1), ventaDelRespaldo(2)])

    expect(await screen.findByText(/el respaldo trae 2 ventas/i, {}, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /rescatar 2 ventas/i }))

    expect(await screen.findByText(/rescate terminado/i)).toBeInTheDocument()
    expect(rpcs.rescatar).toHaveBeenCalledTimes(2)
    const lotes = rpcs.rescatar.mock.calls.map(([a]) => a.p_lote)
    expect(lotes[0]).toMatch(/^rescate-/)
    expect(new Set(lotes).size).toBe(1)
    expect(screen.getByText("Quedó en conciliación")).toBeInTheDocument()
    expect(screen.getByText("Rechazada por el servidor")).toBeInTheDocument()
    expect(screen.getByText(/OF003 · La clave ya se usó/)).toBeInTheDocument()
  })

  it("no vuelve a enviar lo que ya se rescató en esta sesión", async () => {
    await renderConciliacion()

    await abrirRespaldo([ventaDelRespaldo(3)])
    fireEvent.click(await screen.findByRole("button", { name: /rescatar 1 venta/i }, { timeout: 5000 }))
    expect(await screen.findByText(/rescate terminado/i)).toBeInTheDocument()

    await abrirRespaldo([ventaDelRespaldo(3)])
    fireEvent.click(await screen.findByRole("button", { name: /rescatar 1 venta/i }, { timeout: 5000 }))

    expect(await screen.findByText("Ya se rescató en esta sesión")).toBeInTheDocument()
    expect(rpcs.rescatar).toHaveBeenCalledTimes(1)
  })

  it("con otra frase no abre el archivo ni envía nada", async () => {
    await renderConciliacion()

    await abrirRespaldo([ventaDelRespaldo(4)], "otra-frase-cualquiera")

    expect(await screen.findByText(/la frase es incorrecta/i, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(rpcs.rescatar).not.toHaveBeenCalled()
  })
})

describe("auditoría de rescates", () => {
  it("muestra cada intento, también los rechazados", async () => {
    await renderConciliacion({
      tablasExtra: {
        auditoria_rescates: [
          { id: 1, empresa_id: EMPRESA, lote: "rescate-1", clave: "off-a", dispositivo: "dispositivo-0001", resultado: "rechazado", codigo: "OF001", detalle: "Un renglón no es válido", creado_en: "2026-10-10T10:00:00Z" },
        ],
      },
    })

    fireEvent.click(screen.getByRole("tab", { name: /auditoría de rescates/i }))

    const fila = (await screen.findByText("rescate-1")).closest("tr")
    expect(within(fila).getByText("Rechazada por el servidor")).toBeInTheDocument()
    expect(within(fila).getByText(/OF001 · Un renglón no es válido/)).toBeInTheDocument()
  })
})
