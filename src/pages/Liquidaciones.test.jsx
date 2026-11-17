import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
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

    fireEvent.change(screen.getByLabelText("Ubicación que entrega"), { target: { value: "store" } })

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
    await waitFor(() => expect(llamadas.control).toBe(2))
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
