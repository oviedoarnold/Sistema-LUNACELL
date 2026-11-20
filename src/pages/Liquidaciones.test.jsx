import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import { ESPERA_ENTRE_RECARGAS } from "../hooks/useAlVolverALaApp"
import { CADA_CUANTO } from "../hooks/useControlDeLiquidaciones"
import { renderizarPantalla } from "../test/pantallas"
import Liquidaciones from "./Liquidaciones"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  La pantalla de liquidaciones (0046). Las respuestas son las de
  control_de_liquidaciones(); los saldos, los repartos y los permisos los
  prueban pruebas-sql/liquidaciones-entre-ubicaciones.
*/

const par = (cambios = {}) => ({
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  efectivo: 410,
  electronico: 100,
  cargo: 1.7,
  por_confirmar: 0,
  liquidado: 0,
  pendiente: 410,
  puede_registrar: true,
  ...cambios,
})

const pedido = (cambios = {}) => ({
  pedido_id: "ped-1",
  numero: "PED-000001",
  estado: "facturado",
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  cliente: "Ferremax",
  forma_pago: "contado",
  entregado_en: "2026-11-16T15:00:00Z",
  numero_factura: "VTA-000023",
  efectivo: 220,
  electronico: 0,
  cargo: 0,
  por_confirmar: 0,
  liquidado: 0,
  pendiente: 220,
  estado_liquidacion: "pendiente",
  medios: [{ medio: "efectivo", monto: 220, cargo: 0, fecha: "2026-11-16T15:00:00Z" }],
  ...cambios,
})

const liquidacion = (cambios = {}) => ({
  id: "liq-1",
  numero: "LIQ-000001",
  estado: "por_confirmar",
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  monto: 100,
  metodo: "entrega_en_efectivo",
  fecha_efectiva: "2026-11-16",
  referencia: "Sobre 12",
  observacion: "",
  registrada_por: "Encargado de Bodega",
  registrada_en: "2026-11-16T18:00:00Z",
  resuelta_por: null,
  resuelta_en: null,
  motivo_rechazo: null,
  puede_resolver: false,
  pedidos: [{ numero: "PED-000001", monto: 100 }],
  ...cambios,
})

const CONTROL = {
  pares: [par()],
  pedidos: [
    pedido(),
    pedido({ pedido_id: "ped-2", numero: "PED-000002", cliente: "Celulares Ana", efectivo: 190, pendiente: 190, numero_factura: "VTA-000024" }),
    pedido({ pedido_id: "ped-3", numero: "PED-000003", estado: "pendiente", numero_factura: null, efectivo: 0, electronico: 100, cargo: 1.7, pendiente: 0, estado_liquidacion: "sin_efectivo", medios: [{ medio: "tarjeta", monto: 100, cargo: 1.7 }] }),
  ],
  liquidaciones: [],
}

async function renderLiquidaciones({ control = CONTROL, rol = "vendedor", permisos = ["settlements-manage"], registrar, resolver } = {}) {
  const llamadas = { control: 0, registrar: [], resolver: [] }
  const rpcsExtra = {
    control_de_liquidaciones: () => {
      llamadas.control += 1

      return { data: typeof control === "function" ? control(llamadas.control) : control, error: null }
    },
    registrar_liquidacion: (a) => {
      llamadas.registrar.push(a)

      return registrar ? registrar(a, llamadas.registrar.length) : { data: { ...liquidacion({ monto: a.p_monto }), registrada_por_nombre: "Encargado", repetida: false }, error: null }
    },
    resolver_liquidacion: (a) => {
      llamadas.resolver.push(a)

      return resolver ? resolver(a) : { data: liquidacion({ estado: a.p_confirmar ? "confirmada" : "rechazada" }), error: null }
    },
  }

  const r = await renderizarPantalla(
    <AuthProvider>
      <MemoryRouter initialEntries={["/liquidaciones"]}>
        <Liquidaciones />
      </MemoryRouter>
    </AuthProvider>,
    { rolDelUsuario: rol, permisosDelUsuario: permisos, ubicacionOperativa: "bodega", rpcsExtra }
  )

  await waitFor(() => expect(llamadas.control).toBeGreaterThan(0))

  return { ...r, llamadas }
}

const resumen = () => screen.getByRole("region", { name: "Resumen" })
const insignia = (contenedor) => contenedor.querySelector(".badge")
const cifra = (contenedor, etiqueta) => within(contenedor).getByText(etiqueta).closest(".liquidaciones-cifra")

describe("Liquidaciones: los saldos", () => {
  it("muestra lo pendiente, lo por confirmar, lo liquidado y lo que está en la cuenta de la empresa", async () => {
    await renderLiquidaciones()

    await screen.findByText("Bodega → Camión 01")

    expect(cifra(resumen(), "Pendiente por liquidar")).toHaveTextContent("L 410.00")
    expect(cifra(resumen(), "En cuenta de la empresa")).toHaveTextContent("L 101.70")
    expect(screen.getByRole("button", { name: "Registrar entrega" })).toBeInTheDocument()
  })

  it("lista los pedidos con su estado de liquidación y su medio", async () => {
    await renderLiquidaciones()

    fireEvent.click(await screen.findByRole("button", { name: "Pedidos" }))

    const tarjeta = screen.getByText("PED-000003").closest(".liquidaciones-tarjeta")

    expect(insignia(tarjeta)).toHaveTextContent("En cuenta de la empresa")
    expect(within(tarjeta).getByText(/Tarjeta L 100.00 \+ L 1.70/)).toBeInTheDocument()
    expect(within(tarjeta).getByText(/Sin facturar/)).toBeInTheDocument()
    expect(insignia(screen.getByText("PED-000001").closest(".liquidaciones-tarjeta"))).toHaveTextContent("Pendiente")
  })

  it("filtra por la ubicación que entrega y la que recibe", async () => {
    await renderLiquidaciones({
      control: { ...CONTROL, pares: [par(), par({ origen_id: "store", origen: "Lunacell Store", pendiente: 50, efectivo: 50, electronico: 0, cargo: 0 })] },
    })

    await screen.findByText("Lunacell Store → Camión 01")

    fireEvent.change(screen.getByLabelText("Ubicación que debe y entrega"), { target: { value: "store" } })

    expect(screen.queryByText("Bodega → Camión 01")).not.toBeInTheDocument()
    expect(cifra(resumen(), "Pendiente por liquidar")).toHaveTextContent("L 50.00")
  })

  it("con solo permiso de consultar no hay botones de registrar ni de confirmar", async () => {
    await renderLiquidaciones({
      permisos: ["settlements-view"],
      control: { ...CONTROL, pares: [par({ puede_registrar: false })], liquidaciones: [liquidacion()] },
    })

    await screen.findByText("Bodega → Camión 01")
    expect(screen.queryByRole("button", { name: "Registrar entrega" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Historial" }))
    expect(insignia(screen.getByText("LIQ-000001").closest(".liquidaciones-tarjeta"))).toHaveTextContent("Pendiente de confirmación")
    expect(screen.queryByRole("button", { name: "Confirmar recepción" })).not.toBeInTheDocument()
  })

  it("esperar confirmación no se pinta como un rechazo: ámbar, verde y rojo", async () => {
    await renderLiquidaciones({
      permisos: ["settlements-view"],
      control: {
        ...CONTROL,
        liquidaciones: [
          liquidacion(),
          liquidacion({ id: "liq-2", numero: "LIQ-000002", estado: "confirmada" }),
          liquidacion({ id: "liq-3", numero: "LIQ-000003", estado: "rechazada", motivo_rechazo: "Faltaron 20 lempiras" }),
        ],
      },
    })

    await screen.findByText("Bodega → Camión 01")
    fireEvent.click(screen.getByRole("button", { name: "Historial" }))

    const clase = (numero) => insignia(screen.getByText(numero).closest(".liquidaciones-tarjeta")).className

    expect(clase("LIQ-000001")).toContain("badge-low")
    expect(clase("LIQ-000002")).toContain("badge-paid")
    expect(clase("LIQ-000003")).toContain("badge-out")
    expect(clase("LIQ-000001")).not.toContain("badge-overdue")
  })

  it("el contador consulta sin botones, aunque la base dijera que puede", async () => {
    await renderLiquidaciones({
      rol: "contador",
      permisos: ["settlements-view"],
      control: { ...CONTROL, liquidaciones: [liquidacion({ puede_resolver: true })] },
    })

    await screen.findByText("Bodega → Camión 01")
    expect(screen.queryByRole("button", { name: "Registrar entrega" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Historial" }))
    expect(screen.queryByRole("button", { name: "Confirmar recepción" })).not.toBeInTheDocument()
  })
})

describe("Liquidaciones: registrar la entrega", () => {
  const abrir = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrega" }))

    return screen.getByRole("dialog", { name: "Registrar entrega de efectivo" })
  }

  it("propone lo pendiente, envía la intención con su clave y recarga los saldos", async () => {
    const { llamadas } = await renderLiquidaciones()
    const ventana = await abrir()

    expect(within(ventana).getByLabelText("Monto")).toHaveValue("410.00")

    fireEvent.change(within(ventana).getByLabelText("Monto"), { target: { value: "150" } })
    fireEvent.change(within(ventana).getByLabelText("Referencia (opcional)"), { target: { value: " Sobre 12 " } })
    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar entrega" }))

    await waitFor(() => expect(llamadas.registrar).toHaveLength(1))

    expect(llamadas.registrar[0]).toMatchObject({
      p_origen: "bodega",
      p_destino: "camion-01",
      p_monto: 150,
      p_metodo: "entrega_en_efectivo",
      p_referencia: "Sobre 12",
      p_pedido: null,
    })
    expect(llamadas.registrar[0].p_clave_idempotencia).toEqual(expect.any(String))
    await waitFor(() => expect(llamadas.control).toBe(2))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("no deja enviar más de lo pendiente, ni del pedido elegido", async () => {
    const { llamadas } = await renderLiquidaciones()
    const ventana = await abrir()

    fireEvent.change(within(ventana).getByLabelText("Monto"), { target: { value: "410.01" } })
    expect(within(ventana).getByText("No puede superar lo pendiente: L 410.00.")).toBeInTheDocument()
    expect(within(ventana).getByRole("button", { name: "Registrar entrega" })).toBeDisabled()

    fireEvent.change(within(ventana).getByLabelText("Pedido"), { target: { value: "ped-2" } })
    expect(within(ventana).getByLabelText("Monto")).toHaveValue("190.00")

    fireEvent.change(within(ventana).getByLabelText("Monto"), { target: { value: "200" } })
    expect(within(ventana).getByText("No puede superar lo pendiente: L 190.00.")).toBeInTheDocument()

    fireEvent.change(within(ventana).getByLabelText("Monto"), { target: { value: "0" } })
    expect(within(ventana).getByRole("button", { name: "Registrar entrega" })).toBeDisabled()
    expect(llamadas.registrar).toHaveLength(0)
  })

  it("sin respuesta del servidor, reintenta con la misma clave", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })

    const { llamadas } = await renderLiquidaciones({
      registrar: (a, n) =>
        n === 1 ? { data: null, error: { message: "Failed to fetch", code: "" }, status: 0 } : { data: { ...liquidacion({ monto: a.p_monto }), repetida: true }, error: null },
    })
    const ventana = await abrir()

    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar entrega" }))

    await waitFor(() => expect(llamadas.registrar).toHaveLength(2))
    expect(llamadas.registrar[1].p_clave_idempotencia).toBe(llamadas.registrar[0].p_clave_idempotencia)
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Esa entrega ya estaba registrada" })))
  })

  it("si la base lo rechaza, dice el motivo y deja la ventana abierta", async () => {
    const { llamadas } = await renderLiquidaciones({
      registrar: () => ({ data: null, error: { message: "El monto (300.00) supera lo pendiente por liquidar (200.00)", code: "LQ002" } }),
    })
    const ventana = await abrir()

    fireEvent.change(within(ventana).getByLabelText("Monto"), { target: { value: "300" } })
    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar entrega" }))

    expect(await within(ventana).findByText(/supera lo pendiente por liquidar/)).toBeInTheDocument()
    expect(llamadas.registrar).toHaveLength(1)
  })
})

describe("Liquidaciones: confirmar o rechazar", () => {
  const conPorConfirmar = { ...CONTROL, liquidaciones: [liquidacion({ puede_resolver: true })] }

  it("avisa de lo que hay por confirmar y confirma la recepción", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })

    const { llamadas } = await renderLiquidaciones({ control: conPorConfirmar })

    expect(await screen.findByText(/Tienes una entrega por confirmar/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Historial" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }))

    await waitFor(() => expect(llamadas.resolver).toEqual([{ p_liquidacion: "liq-1", p_confirmar: true }]))
    // Al abrir, al revisar el estado antes de preguntar y después de confirmar.
    await waitFor(() => expect(llamadas.control).toBe(3))
  })

  it("rechazar pide el motivo y lo envía", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "  Faltaron 20 lempiras  " })

    const { llamadas } = await renderLiquidaciones({ control: conPorConfirmar })

    fireEvent.click(await screen.findByRole("button", { name: "Historial" }))
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))

    await waitFor(() => expect(llamadas.resolver).toEqual([{ p_liquidacion: "liq-1", p_confirmar: false, p_motivo: "Faltaron 20 lempiras" }]))
  })

  it("muestra quién registró, quién resolvió y el motivo de un rechazo", async () => {
    await renderLiquidaciones({
      control: {
        ...CONTROL,
        liquidaciones: [liquidacion({ estado: "rechazada", resuelta_por: "Encargado del camión", resuelta_en: "2026-11-16T19:00:00Z", motivo_rechazo: "Faltaron 20 lempiras" })],
      },
    })

    fireEvent.click(await screen.findByRole("button", { name: "Historial" }))

    const tarjeta = screen.getByText("LIQ-000001").closest(".liquidaciones-tarjeta")

    expect(within(tarjeta).getByText("Rechazada")).toBeInTheDocument()
    expect(within(tarjeta).getByText(/Registró Encargado de Bodega/)).toHaveTextContent("Rechazó Encargado del camión")
    expect(within(tarjeta).getByText("Motivo del rechazo: Faltaron 20 lempiras")).toBeInTheDocument()
    expect(within(tarjeta).getByText(/Entrega en efectivo · .* · Ref. Sobre 12/)).toBeInTheDocument()
  })
})

describe("Liquidaciones: obligaciones en cualquier sentido (etapa C2b)", () => {
  /*
    PED-000009: Bodega cobró L 400 y entregó L 100 a Ruta local; se canceló y
    Camión 01 devolvió los L 400. Bodega le debe L 300 a Camión 01 y Ruta local
    L 100. PED-000010: liquidado completo a Ruta local y devuelto por Bodega:
    Ruta local le devuelve L 400 a Bodega.
  */
  const cancelado = (cambios) =>
    pedido({
      estado: "cancelado",
      numero_factura: null,
      electronico: 0,
      cargo: 0,
      motivo: "cancelacion",
      pedido_origen_id: "bodega",
      pedido_origen: "Bodega",
      pedido_destino_id: "ruta",
      pedido_destino: "Ruta local",
      medios: [{ medio: "efectivo", monto: 400, cargo: 0 }],
      ...cambios,
    })

  const C2B = {
    pares: [
      par({ origen_id: "ruta", origen: "Ruta local", destino_id: "bodega", destino: "Bodega", efectivo: 400, electronico: 0, cargo: 0, pendiente: 400, por_cancelaciones: true }),
      par({ origen_id: "bodega", origen: "Bodega", destino_id: "camion-01", destino: "Camión 01", efectivo: 300, electronico: 0, cargo: 0, pendiente: 300, por_cancelaciones: true, puede_registrar: true }),
    ],
    pedidos: [
      cancelado({ pedido_id: "ped-9", numero: "PED-000009", origen_id: "bodega", origen: "Bodega", destino_id: "camion-01", destino: "Camión 01", efectivo: 300, pendiente: 300 }),
      cancelado({ pedido_id: "ped-9", numero: "PED-000009", origen_id: "ruta", origen: "Ruta local", destino_id: "camion-01", destino: "Camión 01", efectivo: 100, pendiente: 100 }),
      cancelado({ pedido_id: "ped-10", numero: "PED-000010", origen_id: "ruta", origen: "Ruta local", destino_id: "bodega", destino: "Bodega", efectivo: 400, pendiente: 400 }),
    ],
    liquidaciones: [
      liquidacion({
        id: "liq-7",
        numero: "LIQ-000007",
        origen_id: "ruta",
        origen: "Ruta local",
        destino_id: "bodega",
        destino: "Bodega",
        monto: 400,
        contraliquidacion: true,
        pedidos: [{ numero: "PED-000010", monto: 400, motivo: "cancelacion" }],
      }),
    ],
  }

  it("dice quién le debe a quién, en cualquier sentido, y que incluye pedidos cancelados", async () => {
    await renderLiquidaciones({ control: C2B })

    const inversa = (await screen.findByText("Ruta local → Bodega")).closest(".liquidaciones-tarjeta")

    expect(within(inversa).getByText("Ruta local le debe a Bodega · incluye pedidos cancelados")).toBeInTheDocument()
    expect(cifra(inversa, "Total a entregar")).toHaveTextContent("L 400.00")
    expect(screen.getByText("Bodega → Camión 01").closest(".liquidaciones-tarjeta")).toHaveTextContent("Bodega le debe a Camión 01")
  })

  it("un pedido cancelado con dos obligaciones sale dos veces, con su motivo y su ruta real", async () => {
    await renderLiquidaciones({ control: C2B })

    fireEvent.click(await screen.findByRole("button", { name: "Pedidos" }))

    const tarjetas = screen.getAllByText("PED-000009").map((n) => n.closest(".liquidaciones-tarjeta"))

    expect(tarjetas).toHaveLength(2)
    expect(tarjetas[0]).toHaveTextContent("Ferremax · Bodega → Ruta local · Cancelado")
    expect(tarjetas[0]).toHaveTextContent("Pedido cancelado: Camión 01 devolvió al cliente efectivo que conserva Bodega.")
    expect(tarjetas[1]).toHaveTextContent("Pedido cancelado: Camión 01 devolvió al cliente efectivo que conserva Ruta local.")
    expect(cifra(tarjetas[0], "Por la cancelación")).toHaveTextContent("L 300.00")
    expect(cifra(tarjetas[1], "Por la cancelación")).toHaveTextContent("L 100.00")
    expect(screen.queryByText(/Sin facturar/)).not.toBeInTheDocument()
  })

  it("la contraliquidación la registra quien debe, hacia quien recibe", async () => {
    const { llamadas } = await renderLiquidaciones({ control: C2B })

    const inversa = (await screen.findByText("Ruta local → Bodega")).closest(".liquidaciones-tarjeta")

    fireEvent.click(within(inversa).getByRole("button", { name: "Registrar entrega" }))

    const ventana = await screen.findByRole("dialog", { name: "Registrar entrega de efectivo" })

    expect(within(ventana).getByText("Ruta local")).toBeInTheDocument()
    expect(within(ventana).getByRole("option", { name: /PED-000010/ })).toBeInTheDocument()
    expect(within(ventana).queryByRole("option", { name: /PED-000009/ })).not.toBeInTheDocument()

    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar entrega" }))

    await waitFor(() => expect(llamadas.registrar).toHaveLength(1))
    expect(llamadas.registrar[0]).toMatchObject({ p_origen: "ruta", p_destino: "bodega", p_monto: 400 })
  })

  it("en el historial, la contraliquidación se distingue y dice qué pedido cancelado paga", async () => {
    await renderLiquidaciones({ control: C2B })

    fireEvent.click(await screen.findByRole("button", { name: "Historial" }))

    const tarjeta = screen.getByText("LIQ-000007").closest(".liquidaciones-tarjeta")

    expect(within(tarjeta).getByText("Contraliquidación")).toBeInTheDocument()
    expect(within(tarjeta).getByText("Pedidos: PED-000010 (L 400.00, por cancelación)")).toBeInTheDocument()
    expect(within(tarjeta).getByText("Ruta local → Bodega")).toBeInTheDocument()
  })

  it("una liquidación de siempre no lleva la marca de contraliquidación", async () => {
    await renderLiquidaciones({ control: { ...CONTROL, liquidaciones: [liquidacion()] } })

    fireEvent.click(await screen.findByRole("button", { name: "Historial" }))

    expect(screen.queryByText("Contraliquidación")).not.toBeInTheDocument()
    expect(screen.getByText(/Pedidos: PED-000001 \(L 100.00\)$/)).toBeInTheDocument()
  })
})

/*
  Dos dispositivos con la misma liquidación: el administrador la tiene abierta
  en la PC y el vendedor la confirma desde su teléfono. La pantalla del
  administrador tiene que enterarse sola, y una confirmación repetida nunca
  puede presentarse como un movimiento nuevo.
*/
describe("Liquidaciones: al día con otros dispositivos", () => {
  const VENDEDOR = "Vendedor Prueba Camión 01"

  const porConfirmar = {
    ...CONTROL,
    pares: [par({ por_confirmar: 100, pendiente: 310 })],
    liquidaciones: [liquidacion({ puede_resolver: true })],
  }

  // Lo mismo después de que el vendedor confirmara desde otro dispositivo.
  const yaConfirmada = {
    ...CONTROL,
    pares: [par({ liquidado: 100, pendiente: 310 })],
    liquidaciones: [liquidacion({ estado: "confirmada", resuelta_por_nombre: VENDEDOR, resuelta_en: "2026-11-20T21:04:53Z" })],
  }

  // La primera consulta ve la entrega por confirmar; las siguientes, ya confirmada.
  const confirmadaEnOtroDispositivo = (n) => (n === 1 ? porConfirmar : yaConfirmada)

  const dialogo = (titulo) => Swal.fire.mock.calls.map(([opciones]) => opciones).find((o) => o?.title === titulo)
  const verHistorial = async () => fireEvent.click(await screen.findByRole("button", { name: "Historial" }))
  const tarjeta = () => screen.getByText("LIQ-000001").closest(".liquidaciones-tarjeta")
  const comoAdmin = { rol: "admin", permisos: [] }

  beforeEach(() => {
    Swal.fire.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("el administrador y el vendedor ven la misma liquidación por confirmar", async () => {
    await renderLiquidaciones({ control: porConfirmar, ...comoAdmin })
    await verHistorial()

    expect(within(tarjeta()).getByText("Pendiente de confirmación")).toBeInTheDocument()
    expect(within(tarjeta()).getByRole("button", { name: "Confirmar recepción" })).toBeInTheDocument()
  })

  it("si otro dispositivo ya la confirmó, no la ofrece como nueva y actualiza saldos e historial", async () => {
    const { llamadas } = await renderLiquidaciones({ control: confirmadaEnOtroDispositivo, ...comoAdmin })
    await verHistorial()

    fireEvent.click(within(tarjeta()).getByRole("button", { name: "Confirmar recepción" }))

    await waitFor(() => expect(dialogo("Esta liquidación ya fue confirmada")).toBeDefined())

    const aviso = dialogo("Esta liquidación ya fue confirmada")

    expect(aviso.icon).toBe("info")
    expect(aviso.text).toContain(`La confirmó ${VENDEDOR}`)
    expect(aviso.text).toContain("No se registró ningún movimiento nuevo")
    expect(llamadas.resolver).toEqual([])
    expect(dialogo("¿Confirmar LIQ-000001?")).toBeUndefined()

    await waitFor(() => expect(within(tarjeta()).getByText("Confirmada")).toBeInTheDocument())
    expect(within(tarjeta()).queryByRole("button", { name: "Confirmar recepción" })).not.toBeInTheDocument()
    expect(within(tarjeta()).getByText(new RegExp(`Confirmó ${VENDEDOR}`))).toBeInTheDocument()
    expect(screen.queryByText(/Tienes una entrega por confirmar/)).not.toBeInTheDocument()

    // Los L 100 cuentan una sola vez: liquidados, y ya no por confirmar.
    expect(cifra(resumen(), "Liquidado")).toHaveTextContent("L 100.00")
    expect(cifra(resumen(), "Pendiente de confirmación")).toHaveTextContent("L 0.00")
    expect(cifra(resumen(), "Pendiente por liquidar")).toHaveTextContent("L 310.00")
  })

  it("se actualiza al volver a la aplicación", async () => {
    let visibilidad = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidad)

    const { llamadas } = await renderLiquidaciones({ control: confirmadaEnOtroDispositivo, ...comoAdmin })
    await verHistorial()

    expect(within(tarjeta()).getByText("Pendiente de confirmación")).toBeInTheDocument()

    const ahora = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(ahora + ESPERA_ENTRE_RECARGAS + 1000)

    act(() => {
      visibilidad = "hidden"
      document.dispatchEvent(new Event("visibilitychange"))
      visibilidad = "visible"
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await waitFor(() => expect(within(tarjeta()).getByText("Confirmada")).toBeInTheDocument())
    expect(llamadas.control).toBe(2)
  })

  it("se actualiza sola cada cierto tiempo mientras está a la vista, y no si está oculta", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let visibilidad = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidad)

    const { llamadas } = await renderLiquidaciones({ control: confirmadaEnOtroDispositivo, ...comoAdmin })
    await verHistorial()

    visibilidad = "hidden"
    act(() => vi.advanceTimersByTime(CADA_CUANTO))
    expect(llamadas.control).toBe(1)

    visibilidad = "visible"
    act(() => vi.advanceTimersByTime(CADA_CUANTO))

    await waitFor(() => expect(within(tarjeta()).getByText("Confirmada")).toBeInTheDocument())
    expect(llamadas.control).toBe(2)
  })

  it("conserva la pestaña y los filtros al actualizarse", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")

    await renderLiquidaciones({ control: confirmadaEnOtroDispositivo, ...comoAdmin })
    await verHistorial()

    fireEvent.change(screen.getByLabelText("Ubicación que recibe"), { target: { value: "camion-01" } })
    act(() => vi.advanceTimersByTime(CADA_CUANTO))

    await waitFor(() => expect(within(tarjeta()).getByText("Confirmada")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Historial" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Ubicación que recibe")).toHaveValue("camion-01")
  })

  /*
    El estado cambió entre la consulta previa y el clic: decide la base, que
    resuelve una sola vez y responde `repetida`. Es un aviso, no un éxito.
  */
  it("si la confirmaron mientras el diálogo estaba abierto, informa sin decir que confirmó", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })

    const { llamadas } = await renderLiquidaciones({
      control: porConfirmar,
      ...comoAdmin,
      resolver: () => ({
        data: { ...liquidacion({ estado: "confirmada", resuelta_en: "2026-11-20T21:04:53Z" }), resuelta_por_nombre: VENDEDOR, repetida: true },
        error: null,
      }),
    })
    await verHistorial()

    fireEvent.click(within(tarjeta()).getByRole("button", { name: "Confirmar recepción" }))

    await waitFor(() => expect(dialogo("Esta liquidación ya fue confirmada")).toBeDefined())
    expect(llamadas.resolver).toHaveLength(1)
    expect(dialogo("LIQ-000001 confirmada")).toBeUndefined()
    expect(Swal.fire.mock.calls.some(([o]) => o?.icon === "success")).toBe(false)
    expect(dialogo("Esta liquidación ya fue confirmada").text).toContain(`La confirmó ${VENDEDOR}`)

    // Y se vuelve a pedir: al abrir, al revisar antes de preguntar y después de la respuesta.
    await waitFor(() => expect(llamadas.control).toBe(3))
  })

  it("un rechazo repetido también se informa como algo que ya pasó", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "No llegó el sobre" })

    await renderLiquidaciones({
      control: porConfirmar,
      ...comoAdmin,
      resolver: () => ({
        data: { ...liquidacion({ estado: "rechazada", resuelta_en: "2026-11-20T21:04:53Z" }), resuelta_por_nombre: VENDEDOR, repetida: true },
        error: null,
      }),
    })
    await verHistorial()

    fireEvent.click(within(tarjeta()).getByRole("button", { name: "Rechazar" }))

    await waitFor(() => expect(dialogo("Esta liquidación ya fue rechazada")).toBeDefined())
    expect(dialogo("LIQ-000001 rechazada")).toBeUndefined()
  })

  it("si ya se resolvió en el otro sentido, conserva el error LQ004 y actualiza", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "No llegó el sobre" })

    const { llamadas } = await renderLiquidaciones({
      control: porConfirmar,
      ...comoAdmin,
      resolver: () => ({ data: null, error: { code: "LQ004", message: "La liquidación LIQ-000001 ya está confirmada" } }),
    })
    await verHistorial()

    fireEvent.click(within(tarjeta()).getByRole("button", { name: "Rechazar" }))

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ icon: "error", text: "La liquidación LIQ-000001 ya está confirmada" }))
    )
    await waitFor(() => expect(llamadas.control).toBe(3))
  })
})
