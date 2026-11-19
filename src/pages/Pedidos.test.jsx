import { describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { renderizarPantalla } from "../test/pantallas"
import CampanaDePedidos from "../components/pedidos/CampanaDePedidos"
import { CADA_CUANTO, EVENTO_PEDIDOS_CAMBIARON } from "../hooks/useAvisosDePedidos"
import { hayOperacionEnCurso } from "../lib/actualizacion/bloqueos"
import Pedidos from "./Pedidos"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  La bandeja «Pedidos» y la campanita (0045). Las respuestas son las de las
  funciones de la base; lo que hacen está en pruebas-sql/pedidos-interubicacion.
*/

const fila = (cambios = {}) => ({
  pedido_id: "ped-1",
  numero: "PED-000001",
  estado: "pendiente",
  origen_id: "bodega",
  origen: "Bodega",
  destino_id: "camion-01",
  destino: "Camión 01",
  nombre_cliente: "Ferremax",
  forma_pago: "credito",
  total: 230,
  cobrado: 80,
  saldo: 150,
  entregado_en: "2026-11-16T15:00:00Z",
  entregado_por: "Encargado de Bodega",
  facturado_en: null,
  numero_factura: null,
  leido: false,
  ...cambios,
})

const detalle = (cambios = {}) => ({
  ...fila(),
  subtotal: 200,
  isv: 30,
  tasa_isv: 15,
  cargo: 1.36,
  tasa_cargo: 1.7,
  rtn_comprador: "0801199912345",
  fecha_vencimiento: "2026-12-31",
  nota: "",
  facturado_por: null,
  destino_emite_fiscal: false,
  puede_facturar: true,
  productos: [
    { producto_id: "p1", codigo: "C-1", nombre: "Cargador", cantidad: 2, precio: 90, subtotal: 180, precio_general: 100, precio_especial: null, precio_referencia: 100, motivo_negociacion: "mayoreo", negociado_por: "Encargado", entregado: 2 },
    { producto_id: "p2", codigo: "C-2", nombre: "Cubo", cantidad: 1, precio: 20, subtotal: 20, precio_general: 50, precio_especial: 20, precio_referencia: null, motivo_negociacion: null, negociado_por: null, entregado: 1 },
  ],
  cobros: [{ medio: "tarjeta", monto: 80, cargo: 1.36, tasa: 1.7, referencia: "", ubicacion: "Bodega", fecha: "2026-11-16T15:00:00Z" }],
  eventos: [{ tipo: "entregado", usuario: "Encargado de Bodega", motivo: "", fecha: "2026-11-16T15:00:00Z" }],
  ...cambios,
})

const sinCancelacion = (cambios = {}) => ({
  puede_cancelar: false,
  puede_registrar: false,
  es_admin: false,
  bloqueo_por_liquidacion: null,
  cancelacion: null,
  productos: [{ producto_id: "p1", nombre: "Cargador", entregado: 2, buen_estado: 0, danado: 0, pendiente: 2 }],
  dinero: [{ medio: "efectivo", monto: 80, cargo: 0, total: 80, devuelto: 0, pendiente: 80 }],
  recepciones: [],
  reembolsos: [],
  ubicaciones_para_recibir: [{ id: "camion-01", nombre: "Camión 01", otra: false }],
  ubicaciones_para_reembolsar: [{ id: "camion-01", nombre: "Camión 01" }],
  puede_reembolsar_electronico: false,
  ...cambios,
})

function Direccion() {
  const { pathname, search } = useLocation()

  return <output data-testid="direccion">{pathname + search}</output>
}

async function renderPedidos({ rpcs = {}, rol = "vendedor", permisos = ["pos"], ruta = "/pedidos" } = {}) {
  const llamadas = { bandeja: [], detalle: [], leer: [], facturar: [], rechazar: [], resolver: [], cancelar: [], recibir: [], reembolsar: [] }
  const rpcsExtra = {
    bandeja_de_pedidos: (a) => {
      llamadas.bandeja.push(a)

      return { data: rpcs.bandeja ? rpcs.bandeja(a) : [fila()], error: null }
    },
    detalle_de_pedido: (a) => {
      llamadas.detalle.push(a)

      return { data: rpcs.detalle ? rpcs.detalle(a) : detalle(), error: null }
    },
    marcar_pedido_leido: (a) => {
      llamadas.leer.push(a)

      return { data: true, error: null }
    },
    facturar_pedido: (a) => {
      llamadas.facturar.push(a)

      return rpcs.facturar ? rpcs.facturar(a) : { data: { ...fila({ estado: "facturado", numero_factura: "VTA-000042", venta_id: "v-42" }), ya_facturado: false }, error: null }
    },
    rechazar_pedido: (a) => {
      llamadas.rechazar.push(a)

      return rpcs.rechazar ? rpcs.rechazar(a) : { data: { ...fila({ estado: "por_resolver" }), repetido: false }, error: null }
    },
    resolver_pedido: (a) => {
      llamadas.resolver.push(a)

      if (rpcs.resolver) return rpcs.resolver(a)

      return a.p_decision === "reenviar"
        ? { data: { ...fila({ destino_id: "camion-02", destino: "Camión 02" }), repetido: false }, error: null }
        : { data: { ...fila({ estado: "facturado", destino_id: "bodega", destino: "Bodega", numero_factura: "VTA-000043", venta_id: "v-43" }), repetido: false, ya_facturado: false }, error: null }
    },
    cancelacion_de_pedido: () => ({ data: rpcs.cancelacion ? rpcs.cancelacion() : sinCancelacion(), error: null }),
    cancelar_pedido: (a) => {
      llamadas.cancelar.push(a)

      return rpcs.cancelar ? rpcs.cancelar(a) : { data: { ...fila({ estado: "cancelado" }), repetido: false }, error: null }
    },
    registrar_recepcion_de_pedido: (a) => {
      llamadas.recibir.push(a)

      return { data: { recepcion_id: "r-1", repetido: false }, error: null }
    },
    registrar_reembolso_de_pedido: (a) => {
      llamadas.reembolsar.push(a)

      return { data: { reembolso_id: "d-1", repetido: false }, error: null }
    },
    avisos_de_pedidos: () => ({ data: { pendientes: 0, sin_leer: 0, ultimos: [] }, error: null }),
  }

  const r = await renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>
          <MemoryRouter initialEntries={[ruta]}>
            <Pedidos />
            <Direccion />
          </MemoryRouter>
        </SalesProvider>
      </ProductProvider>
    </AuthProvider>,
    { rolDelUsuario: rol, permisosDelUsuario: permisos, ubicacionOperativa: "camion-01", rpcsExtra, esperar: ["ventas"] }
  )

  await waitFor(() => expect(llamadas.bandeja.length).toBeGreaterThan(0))

  return { ...r, llamadas }
}

const paso = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe("Pedidos: la bandeja", () => {
  it("lista los pendientes recibidos y marca los no leídos", async () => {
    const { llamadas } = await renderPedidos()

    expect(llamadas.bandeja[0]).toEqual({ p_vista: "recibidos", p_estado: "pendiente" })

    const tarjeta = await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" })

    expect(within(tarjeta).getByText("Nuevo")).toBeInTheDocument()
    expect(within(tarjeta).getByText(/Bodega → Camión 01 · Crédito/)).toBeInTheDocument()
  })

  it("filtra por estado y separa recibidos de enviados", async () => {
    const { llamadas } = await renderPedidos()

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "facturado" } })
    await waitFor(() => expect(llamadas.bandeja.at(-1)).toEqual({ p_vista: "recibidos", p_estado: "facturado" }))

    expect(within(screen.getByLabelText("Estado")).getByRole("option", { name: "Por resolver" })).toHaveValue("por_resolver")
    expect(within(screen.getByLabelText("Estado")).queryByRole("option", { name: "Rechazados" })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "por_resolver" } })
    await waitFor(() => expect(llamadas.bandeja.at(-1)).toEqual({ p_vista: "recibidos", p_estado: "por_resolver" }))

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "todos" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviados" }))
    await waitFor(() => expect(llamadas.bandeja.at(-1)).toEqual({ p_vista: "enviados", p_estado: "todos" }))
  })

  it("abrir un pedido muestra lo necesario para facturar y marca el aviso como leído, sin facturar", async () => {
    const { llamadas } = await renderPedidos()

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))

    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    expect(within(ventana).getByText("Cargador")).toBeInTheDocument()
    expect(within(ventana).getByText(/Negociado · antes L 100.00 · Compra al por mayor/)).toBeInTheDocument()
    expect(within(ventana).getByText(/Precio especial · general L 50.00/)).toBeInTheDocument()
    expect(within(ventana).getByText(/entregado en Bodega: 2/)).toBeInTheDocument()
    expect(within(ventana).getByText("Pago parcial recibido en Bodega").nextSibling).toHaveTextContent("L 80.00")
    expect(within(ventana).getByText("Saldo pendiente del cliente").nextSibling).toHaveTextContent("L 150.00")
    expect(within(ventana).queryByText(/prima/i)).not.toBeInTheDocument()
    expect(within(ventana).getByText(/Tarjeta/)).toBeInTheDocument()

    await waitFor(() => expect(llamadas.leer).toEqual([{ p_pedido: "ped-1" }]))
    expect(llamadas.facturar).toHaveLength(0)
  })

  it("la tarjeta muestra el total, lo pagado en origen y lo pendiente", async () => {
    await renderPedidos({
      rpcs: { bandeja: () => [fila(), fila({ pedido_id: "ped-2", numero: "PED-000002", forma_pago: "credito", total: 1000, cobrado: 0, saldo: 1000 })] },
    })

    const conPago = await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" })
    const sinPago = screen.getByRole("button", { name: "Abrir el pedido PED-000002 de Ferremax" })

    expect(within(conPago).getByText("L 230.00")).toBeInTheDocument()
    expect(within(conPago).getByText(/Pagado L 80.00 en Bodega/)).toBeInTheDocument()
    expect(within(conPago).getByText("Pendiente L 150.00")).toBeInTheDocument()
    expect(within(sinPago).getByText(/^Pagado L 0.00$/)).toBeInTheDocument()
    expect(within(sinPago).getByText("Pendiente L 1,000.00")).toBeInTheDocument()
  })

  it("con pago parcial, antes de facturar resume el total, lo pagado y el saldo; la factura es una sola", async () => {
    const { llamadas } = await renderPedidos()

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar" }))

    await waitFor(() => expect(llamadas.facturar).toEqual([{ p_pedido: "ped-1" }]))
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "¿Facturar el pedido PED-000001?",
        text: expect.stringMatching(/^Total del pedido: L 230.00\. Pago recibido en Bodega: L 80.00\. Saldo pendiente del cliente: L 150.00\..*no se cobra otra vez/),
        cancelButtonText: "Volver",
      })
    )
  })

  it("sin anticipo, la confirmación es la breve de siempre", async () => {
    await renderPedidos({
      rpcs: { detalle: () => detalle({ cobrado: 0, saldo: 230, cargo: 0, tasa_cargo: null, cobros: [] }) },
    })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar" }))
    await paso()

    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Se emitirá una factura de Camión 01 por L 230.00 a nombre de Ferremax. El inventario ya salió de Bodega." })
    )
  })

  it("Facturar pide confirmación y llama una sola vez", async () => {
    const { llamadas } = await renderPedidos()

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    // Descartado: no factura.
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar" }))
    await paso()
    expect(llamadas.facturar).toHaveLength(0)

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar" }))

    await waitFor(() => expect(llamadas.facturar).toEqual([{ p_pedido: "ped-1" }]))
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Factura VTA-000042" })))
  })

  it("si otro dispositivo ya lo facturó, lo dice y no emite otra", async () => {
    await renderPedidos({
      rpcs: { facturar: () => ({ data: { ...fila({ estado: "facturado", numero_factura: "VTA-000041", venta_id: "v-41" }), ya_facturado: true }, error: null }) },
    })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar" }))

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ title: "El pedido ya estaba facturado", text: expect.stringContaining("VTA-000041") })
      )
    )
  })

  it("sin permiso para facturarlo, no hay botón", async () => {
    await renderPedidos({ rpcs: { detalle: () => detalle({ puede_facturar: false }) } })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    expect(within(ventana).queryByRole("button", { name: "Facturar" })).not.toBeInTheDocument()
  })

  it("el contador consulta sin marcar avisos", async () => {
    const { llamadas } = await renderPedidos({ rol: "contador", permisos: ["sales-history"], rpcs: { detalle: () => detalle({ puede_facturar: false }) } })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))
    await screen.findByRole("dialog", { name: "Pedido PED-000001" })
    await paso()

    expect(llamadas.leer).toHaveLength(0)
  })

  it("el enlace de la campanita abre el pedido directamente", async () => {
    const { llamadas } = await renderPedidos({ ruta: "/pedidos?pedido=ped-1" })

    await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    expect(llamadas.detalle[0]).toEqual({ p_pedido: "ped-1" })
    await waitFor(() => expect(screen.getByTestId("direccion")).toHaveTextContent(/^\/pedidos$/))
  })
})

// Un pedido que Camión 01 rechazó y que Bodega debe resolver.
const rechazado = (cambios = {}) =>
  detalle({
    estado: "por_resolver",
    puede_facturar: false,
    puede_resolver: true,
    puede_facturar_en_origen: true,
    rechazo: { motivo: "El cliente es de Bodega", usuario: "Vendedor de Camión 01", ubicacion: "Camión 01", fecha: "2026-11-17T15:00:00Z" },
    destinos_para_reenviar: [
      { id: "camion-02", nombre: "Camión 02" },
      { id: "tienda", nombre: "Tienda" },
    ],
    eventos: [
      { tipo: "entregado", usuario: "Encargado de Bodega", motivo: "", fecha: "2026-11-16T15:00:00Z", ubicacion: "Bodega" },
      { tipo: "rechazado", usuario: "Vendedor de Camión 01", motivo: "El cliente es de Bodega", fecha: "2026-11-17T15:00:00Z", ubicacion: "Camión 01", rechazado_en: "Camión 01" },
    ],
    ...cambios,
  })

async function abrirElPedido(opciones) {
  const r = await renderPedidos(opciones)

  fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" }))

  return { ...r, ventana: await screen.findByRole("dialog", { name: "Pedido PED-000001" }) }
}

describe("Pedidos: rechazar (etapa C1)", () => {
  it("el destino ve Facturar y Rechazar; rechazar pide el motivo y lo manda con la clave del intento", async () => {
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { detalle: () => detalle({ puede_rechazar: true }) } })

    expect(within(ventana).getByRole("button", { name: "Facturar" })).toBeEnabled()

    // Descartado: no rechaza.
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }))
    await paso()
    expect(llamadas.rechazar).toHaveLength(0)
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "¿Rechazar el pedido PED-000001?",
        input: "textarea",
        inputLabel: "Motivo del rechazo",
        text: expect.stringContaining("No se devuelve inventario ni dinero"),
      })
    )

    const { inputValidator } = Swal.fire.mock.calls.at(-1)[0]

    expect(inputValidator("  no ")).toBe("Escribe el motivo (al menos 5 caracteres).")
    expect(inputValidator("Corresponde a Bodega")).toBeUndefined()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "  Corresponde a Bodega " })
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }))

    await waitFor(() => expect(llamadas.rechazar).toEqual([{ p_pedido: "ped-1", p_motivo: "Corresponde a Bodega", p_clave_idempotencia: expect.any(String) }]))
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Pedido PED-000001 rechazado" })))
    expect(llamadas.facturar).toHaveLength(0)
  })

  it("sin permiso para rechazar no hay botón", async () => {
    const { ventana } = await abrirElPedido()

    expect(within(ventana).queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument()
  })

  it("sin respuesta del servidor, reintentar usa la misma clave", async () => {
    let intentos = 0
    const { llamadas, ventana } = await abrirElPedido({
      rpcs: {
        detalle: () => detalle({ puede_rechazar: true }),
        rechazar: () => {
          intentos += 1

          return intentos === 1
            ? { data: null, error: { message: "Failed to fetch" }, status: 0 }
            : { data: { ...fila({ estado: "por_resolver" }), repetido: true }, error: null }
        },
      },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "Corresponde a Bodega" }).mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }))

    await waitFor(() => expect(llamadas.rechazar).toHaveLength(2))
    expect(llamadas.rechazar[1].p_clave_idempotencia).toBe(llamadas.rechazar[0].p_clave_idempotencia)
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No hubo respuesta del servidor",
        confirmButtonText: "Reintentar",
        cancelButtonText: "Cerrar sin reintentar",
        text: expect.stringMatching(/Reintentar es seguro.*La operación podría haberse registrado\. Comprueba el historial antes de repetirla\.$/),
      })
    )
  })

  it("sin respuesta, cerrar sin reintentar no vuelve a llamar", async () => {
    const { llamadas, ventana } = await abrirElPedido({
      rpcs: {
        detalle: () => detalle({ puede_rechazar: true }),
        rechazar: () => ({ data: null, error: { message: "Failed to fetch" }, status: 0 }),
      },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "Corresponde a Bodega" }).mockResolvedValueOnce({ isConfirmed: false, isDismissed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }))

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "No hubo respuesta del servidor" })))
    await paso()

    expect(llamadas.rechazar).toHaveLength(1)
    expect(Swal.fire).not.toHaveBeenCalledWith(expect.objectContaining({ cancelButtonText: "Cancelar" }))
  })

  it("con efectivo en una liquidación registrada, lo explica y no deja rechazar", async () => {
    const { ventana } = await abrirElPedido({ rpcs: { detalle: () => detalle({ puede_rechazar: true, bloqueo_por_liquidacion: "LIQ-000003 (por confirmar)" }) } })

    expect(within(ventana).getByText(/ya está en la liquidación LIQ-000003 \(por confirmar\)/)).toBeInTheDocument()
    expect(within(ventana).getByRole("button", { name: "Rechazar" })).toBeDisabled()
    expect(within(ventana).getByRole("button", { name: "Facturar" })).toBeEnabled()
  })

  it("si el servidor lo rechaza, muestra su mensaje y vuelve a cargar el pedido", async () => {
    const { llamadas, ventana } = await abrirElPedido({
      rpcs: {
        detalle: () => detalle({ puede_rechazar: true }),
        rechazar: () => ({ data: null, error: { code: "PI012", message: "El pedido PED-000001 ya está facturado: no se puede rechazar" } }),
      },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "Corresponde a Bodega" })
    fireEvent.click(within(ventana).getByRole("button", { name: "Rechazar" }))

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ icon: "error", title: "No se pudo rechazar", text: expect.stringContaining("ya está facturado") })
      )
    )
    await waitFor(() => expect(llamadas.detalle.length).toBeGreaterThan(1))
  })
})

describe("Pedidos: resolver un rechazo (etapa C1)", () => {
  it("muestra quién lo rechazó y por qué, y las dos decisiones; no ofrece Facturar ni Rechazar", async () => {
    const { ventana } = await abrirElPedido({ rpcs: { detalle: () => rechazado() } })

    expect(within(ventana).getByText("Rechazado por Camión 01")).toBeInTheDocument()
    expect(within(ventana).getAllByText("«El cliente es de Bodega»").length).toBeGreaterThan(0)
    expect(within(ventana).getByText(/Rechazado en Camión 01 · Vendedor de Camión 01/)).toBeInTheDocument()
    expect(within(ventana).getByRole("button", { name: "Enviar a otra ubicación" })).toBeEnabled()
    expect(within(ventana).getByRole("button", { name: "Facturar en Bodega" })).toBeEnabled()
    expect(within(ventana).queryByRole("button", { name: "Facturar" })).not.toBeInTheDocument()
    expect(within(ventana).queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument()
  })

  it("enviar a otra ubicación ofrece solo los destinos que permite el servidor y manda el elegido", async () => {
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { detalle: () => rechazado() } })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "camion-02" })
    fireEvent.click(within(ventana).getByRole("button", { name: "Enviar a otra ubicación" }))

    await waitFor(() =>
      expect(llamadas.resolver).toEqual([
        { p_pedido: "ped-1", p_decision: "reenviar", p_destino: "camion-02", p_nota: "", p_clave_idempotencia: expect.any(String) },
      ])
    )
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "select",
        inputOptions: { "camion-02": "Camión 02", tienda: "Tienda" },
        text: expect.stringContaining("No se descuenta inventario"),
      })
    )
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Pedido enviado a Camión 02" })))
    expect(llamadas.facturar).toHaveLength(0)
  })

  it("facturar en origen confirma con el resumen y emite la única factura", async () => {
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { detalle: () => rechazado() } })

    // Descartado: nada.
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar en Bodega" }))
    await paso()
    expect(llamadas.resolver).toHaveLength(0)
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "¿Facturar el pedido PED-000001 en Bodega?",
        text: expect.stringMatching(
          /Pago recibido en Bodega: L 80.00\. Saldo pendiente del cliente: L 150.00\. Se emitirá una factura de Bodega .*no queda nada que liquidar con Camión 01/
        ),
      })
    )

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(ventana).getByRole("button", { name: "Facturar en Bodega" }))

    await waitFor(() =>
      expect(llamadas.resolver).toEqual([
        { p_pedido: "ped-1", p_decision: "facturar_en_origen", p_destino: null, p_nota: "", p_clave_idempotencia: expect.any(String) },
      ])
    )
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Factura VTA-000043" })))
  })

  it("sin «Facturar» solo puede enviarlo a otra ubicación; sin destinos posibles, tampoco eso", async () => {
    const { ventana } = await abrirElPedido({ rpcs: { detalle: () => rechazado({ puede_facturar_en_origen: false, destinos_para_reenviar: [] }) } })

    expect(within(ventana).queryByRole("button", { name: "Facturar en Bodega" })).not.toBeInTheDocument()
    expect(within(ventana).getByRole("button", { name: "Enviar a otra ubicación" })).toBeDisabled()
  })

  it("quien no puede resolver ve el rechazo sin botones", async () => {
    const { ventana } = await abrirElPedido({ rpcs: { detalle: () => rechazado({ puede_resolver: false, puede_facturar_en_origen: false }) } })

    expect(within(ventana).getByText("Rechazado por Camión 01")).toBeInTheDocument()
    expect(within(ventana).getByText(/espera que Bodega lo resuelva/)).toBeInTheDocument()
    expect(within(ventana).queryByRole("button", { name: "Enviar a otra ubicación" })).not.toBeInTheDocument()
  })

  it("la historia guarda cada envío, los dos rechazos y la factura en origen", async () => {
    const { ventana } = await abrirElPedido({
      rpcs: {
        detalle: () =>
          rechazado({
            estado: "facturado",
            puede_resolver: false,
            puede_facturar_en_origen: false,
            rechazo: null,
            eventos: [
              { tipo: "entregado", usuario: "Encargado", motivo: "", fecha: "2026-11-16T15:00:00Z" },
              { tipo: "rechazado", usuario: "Ruta", motivo: "No es de aquí", fecha: "2026-11-16T16:00:00Z", rechazado_en: "Ruta local" },
              { tipo: "reenviado", usuario: "Encargado", motivo: "", fecha: "2026-11-16T17:00:00Z", desde: "Ruta local", hacia: "Camión 01" },
              { tipo: "rechazado", usuario: "Camión", motivo: "Tampoco", fecha: "2026-11-16T18:00:00Z", rechazado_en: "Camión 01" },
              { tipo: "facturar_en_origen", usuario: "Encargado", motivo: "", fecha: "2026-11-16T19:00:00Z", desde: "Camión 01", hacia: "Bodega" },
              { tipo: "facturado", usuario: "Encargado", motivo: "", fecha: "2026-11-16T19:00:00Z" },
            ],
          }),
      },
    })

    const historia = within(ventana)
      .getAllByRole("listitem")
      .map((li) => li.textContent)

    expect(historia).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Rechazado en Ruta local · Ruta/),
        expect.stringMatching(/^Enviado de Ruta local a Camión 01/),
        expect.stringMatching(/^Rechazado en Camión 01 · Camión/),
        expect.stringMatching(/^Se factura en Bodega \(lo rechazó Camión 01\)/),
      ])
    )
  })

  it("en Enviados, el rechazado que volvió se marca como nuevo y dice quién lo rechazó", async () => {
    await renderPedidos({ rpcs: { bandeja: () => [fila({ estado: "por_resolver", leido: false })] } })

    fireEvent.click(screen.getByRole("button", { name: "Enviados" }))

    const tarjeta = await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" })

    await waitFor(() => expect(within(tarjeta).getByText("Nuevo")).toBeInTheDocument())
    expect(within(tarjeta).getByText(/Bodega → rechazado por Camión 01/)).toBeInTheDocument()
  })

  it("un pedido facturado en su origen lo dice en la tarjeta", async () => {
    await renderPedidos({
      rpcs: { bandeja: () => [fila({ estado: "facturado", destino_id: "bodega", destino: "Bodega", numero_factura: "VTA-000043" })] },
    })

    const tarjeta = await screen.findByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" })

    expect(within(tarjeta).getByText(/Facturado en Bodega · Crédito · VTA-000043/)).toBeInTheDocument()
  })
})

describe("Pedidos: cancelar antes de facturar (etapa C2a)", () => {
  const conPermiso = (cambios = {}) => sinCancelacion({ puede_cancelar: true, ...cambios })

  it("sin permiso no aparece «Cancelar pedido»", async () => {
    const { ventana } = await abrirElPedido()

    expect(within(ventana).queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument()
  })

  it("con una liquidación por confirmar, el botón está desactivado", async () => {
    const { ventana } = await abrirElPedido({ rpcs: { cancelacion: () => conPermiso({ bloqueo_por_liquidacion: "LIQ-000002 (por confirmar)" }) } })

    expect(within(ventana).getByRole("button", { name: "Cancelar pedido" })).toBeDisabled()
  })

  it("un solo formulario: motivo, productos, dinero y resumen; envía todo con una clave", async () => {
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { cancelacion: () => conPermiso() } })

    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar pedido" }))

    const formulario = await screen.findByRole("dialog", { name: "Cancelar el pedido PED-000001" })
    const confirmar = within(formulario).getByRole("button", { name: "Confirmar cancelación" })

    // Sin motivo no se puede confirmar, y lo explica.
    expect(confirmar).toBeDisabled()
    expect(within(formulario).getByRole("alert")).toHaveTextContent("Escribe el motivo")
    expect(hayOperacionEnCurso()).toBe(true)

    fireEvent.change(within(formulario).getByLabelText("Motivo de la cancelación"), { target: { value: "El cliente ya no lo quiere" } })
    fireEvent.click(within(formulario).getByRole("button", { name: "Algunos" }))
    fireEvent.change(within(formulario).getByLabelText("Cantidad de Cargador"), { target: { value: "1" } })
    fireEvent.change(within(formulario).getByLabelText("Estado de Cargador"), { target: { value: "danado" } })
    fireEvent.click(within(formulario).getByRole("button", { name: "Reembolsar ahora" }))
    fireEvent.change(within(formulario).getByLabelText("Se devuelve con Efectivo"), { target: { value: "50" } })

    const resumen = within(formulario).getByRole("region", { name: "Resumen" })

    expect(resumen).toHaveTextContent("El pedido queda cancelado")
    expect(resumen).toHaveTextContent("Quedan 1 unidad(es) por recibir")
    expect(resumen).toHaveTextContent("Se registra la devolución de L 50.00")
    expect(resumen).toHaveTextContent("Quedan L 30.00 pendientes de devolver")

    fireEvent.click(confirmar)

    await waitFor(() =>
      expect(llamadas.cancelar).toEqual([
        {
          p_pedido: "ped-1",
          p_motivo: "El cliente ya no lo quiere",
          p_recepcion: { ubicacion_id: "camion-01", nota: "", productos: [{ producto_id: "p1", cantidad: 1, condicion: "danado" }] },
          p_reembolsos: [{ medio: "efectivo", importe: 50, ubicacion_id: "camion-01", referencia: "" }],
          p_clave_idempotencia: expect.any(String),
        },
      ])
    )
    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Pedido PED-000001 cancelado" })))
    await waitFor(() => expect(hayOperacionEnCurso()).toBe(false))
  })

  it("sin pago no pregunta por dinero; «Ninguno» deja los productos por recibir", async () => {
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { cancelacion: () => conPermiso({ dinero: [] }) } })

    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar pedido" }))

    const formulario = await screen.findByRole("dialog", { name: "Cancelar el pedido PED-000001" })

    expect(within(formulario).queryByRole("region", { name: "Dinero" })).not.toBeInTheDocument()
    expect(within(formulario).getByText("El cliente no pagó nada: no hay dinero que devolver.")).toBeInTheDocument()
    expect(within(formulario).getByRole("button", { name: "Ninguno" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.change(within(formulario).getByLabelText("Motivo de la cancelación"), { target: { value: "Se envió por error" } })
    fireEvent.click(within(formulario).getByRole("button", { name: "Confirmar cancelación" }))

    await waitFor(() => expect(llamadas.cancelar[0]).toMatchObject({ p_recepcion: null, p_reembolsos: [] }))
  })

  it("el vendedor no ve campos para devolver lo electrónico", async () => {
    const { ventana } = await abrirElPedido({
      rpcs: { cancelacion: () => conPermiso({ dinero: [{ medio: "tarjeta", monto: 80, cargo: 1.36, total: 81.36, devuelto: 0, pendiente: 81.36 }] }) },
    })

    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar pedido" }))

    const formulario = await screen.findByRole("dialog", { name: "Cancelar el pedido PED-000001" })

    expect(within(formulario).getByRole("button", { name: "Reembolsar ahora" })).toBeDisabled()
    expect(within(formulario).getByText("Las devoluciones por transferencia, tarjeta o enlace las registra el administrador.")).toBeInTheDocument()
    expect(within(formulario).getByText(/incluye cargo L 1.36/)).toBeInTheDocument()
  })

  it("sin respuesta, reintentar la cancelación usa la misma clave", async () => {
    let intentos = 0
    const { llamadas, ventana } = await abrirElPedido({
      rpcs: {
        cancelacion: () => conPermiso({ dinero: [] }),
        cancelar: () => {
          intentos += 1

          return intentos === 1 ? { data: null, error: { message: "Failed to fetch" }, status: 0 } : { data: { ...fila({ estado: "cancelado" }), repetido: true }, error: null }
        },
      },
    })

    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar pedido" }))

    const formulario = await screen.findByRole("dialog", { name: "Cancelar el pedido PED-000001" })

    fireEvent.change(within(formulario).getByLabelText("Motivo de la cancelación"), { target: { value: "Se envió por error" } })
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(formulario).getByRole("button", { name: "Confirmar cancelación" }))

    await waitFor(() => expect(llamadas.cancelar).toHaveLength(2))
    expect(llamadas.cancelar[1].p_clave_idempotencia).toBe(llamadas.cancelar[0].p_clave_idempotencia)
  })

  it("el pedido cancelado muestra lo pendiente y permite recibir y reembolsar después", async () => {
    const cancelado = sinCancelacion({
      puede_registrar: true,
      cancelacion: { motivo: "El cliente ya no lo quiere", usuario: "Encargado", fecha: "2026-11-17T15:00:00Z", principal: 80, cargo: 0 },
      productos: [{ producto_id: "p1", nombre: "Cargador", entregado: 2, buen_estado: 1, danado: 0, pendiente: 1 }],
      dinero: [{ medio: "efectivo", monto: 80, cargo: 0, total: 80, devuelto: 30, pendiente: 50 }],
      recepciones: [{ ubicacion: "Camión 01", en_otra_ubicacion: false, nota: "", usuario: "Encargado", fecha: "2026-11-17T15:00:00Z", productos: [{ nombre: "Cargador", cantidad: 1, condicion: "buen_estado" }] }],
      reembolsos: [{ medio: "efectivo", importe: 30, ubicacion: "Camión 01", referencia: "", usuario: "Encargado", fecha: "2026-11-17T15:00:00Z" }],
    })
    const { llamadas, ventana } = await abrirElPedido({ rpcs: { detalle: () => detalle({ estado: "cancelado", puede_facturar: false }), cancelacion: () => cancelado } })

    const seccion = within(ventana).getByRole("region", { name: "Cancelación" })

    expect(seccion).toHaveTextContent("«El cliente ya no lo quiere»")
    expect(seccion).toHaveTextContent("Por recibir 1")
    expect(seccion).toHaveTextContent("Por devolver L 50.00")
    expect(seccion).toHaveTextContent("Devuelto L 30.00 con Efectivo desde Camión 01")
    expect(within(ventana).queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument()

    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar productos recibidos" }))

    const recibir = await screen.findByRole("dialog", { name: "Registrar productos recibidos PED-000001" })

    fireEvent.click(within(recibir).getByRole("button", { name: "Registrar recepción" }))
    await waitFor(() =>
      expect(llamadas.recibir).toEqual([
        { p_pedido: "ped-1", p_ubicacion: "camion-01", p_productos: [{ producto_id: "p1", cantidad: 1, condicion: "buen_estado" }], p_nota: "", p_clave_idempotencia: expect.any(String) },
      ])
    )

    const otra = await screen.findByRole("dialog", { name: "Pedido PED-000001" })

    fireEvent.click(within(otra).getByRole("button", { name: "Registrar reembolso" }))

    const reembolsar = await screen.findByRole("dialog", { name: "Registrar reembolso PED-000001" })

    fireEvent.click(within(reembolsar).getByRole("button", { name: "Registrar reembolso" }))
    await waitFor(() =>
      expect(llamadas.reembolsar).toEqual([
        { p_pedido: "ped-1", p_medio: "efectivo", p_importe: 50, p_ubicacion: "camion-01", p_referencia: "", p_clave_idempotencia: expect.stringMatching(/-0$/) },
      ])
    )
  })

  /*
    Los dos pedidos cancelados de producción, simulados: PED-000007 sin pago y
    PED-000008 con anticipo de L 50 ya devuelto. Ninguno debe nada.
  */
  const ped07 = { pedido_id: "ped-7", numero: "PED-000007", estado: "cancelado", total: 90, cobrado: 0, saldo: 90 }
  const ped08 = { pedido_id: "ped-8", numero: "PED-000008", estado: "cancelado", total: 200, cobrado: 50, saldo: 150 }
  const cancelacionDe = (dinero, reembolsos = []) =>
    sinCancelacion({
      cancelacion: { motivo: "El cliente ya no lo quiere", usuario: "Encargado", fecha: "2026-11-17T15:00:00Z", principal: 50, cargo: 0 },
      productos: [{ producto_id: "p1", nombre: "Cargador", entregado: 2, buen_estado: 2, danado: 0, pendiente: 0 }],
      dinero,
      reembolsos,
    })
  const detalleCancelado = (cambios) =>
    detalle({
      ...cambios,
      cargo: 0,
      tasa_cargo: null,
      puede_facturar: false,
      cobros: cambios.cobrado > 0 ? [{ medio: "efectivo", monto: cambios.cobrado, cargo: 0, tasa: null, referencia: "", ubicacion: "Bodega", fecha: "2026-11-16T15:00:00Z" }] : [],
    })
  const renglon = (ventana, texto) => within(ventana).getByText(texto).closest(".totals-row")

  it("las tarjetas de pedidos cancelados no muestran saldo pendiente; las pendientes y facturadas siguen igual", async () => {
    await renderPedidos({
      rpcs: { bandeja: () => [fila(ped07), fila(ped08), fila(), fila({ pedido_id: "ped-6", numero: "PED-000006", estado: "facturado", numero_factura: "VTA-000006", cobrado: 230, saldo: 0 })] },
    })

    const t07 = await screen.findByRole("button", { name: "Abrir el pedido PED-000007 de Ferremax" })
    const t08 = screen.getByRole("button", { name: "Abrir el pedido PED-000008 de Ferremax" })
    const pendiente = screen.getByRole("button", { name: "Abrir el pedido PED-000001 de Ferremax" })
    const facturado = screen.getByRole("button", { name: "Abrir el pedido PED-000006 de Ferremax" })

    expect(within(t07).getByText("Cancelado")).toBeInTheDocument()
    expect(within(t07).getByText("Sin pagos recibidos")).toBeInTheDocument()
    expect(within(t07).getByText("Sin saldo por cobrar")).toBeInTheDocument()
    expect(within(t07).queryByText(/Pendiente L/)).not.toBeInTheDocument()

    expect(within(t08).getByText("Pagado antes de cancelar L 50.00 en Bodega")).toBeInTheDocument()
    expect(within(t08).getByText("Sin saldo por cobrar")).toBeInTheDocument()
    expect(within(t08).queryByText(/L 150.00/)).not.toBeInTheDocument()

    expect(within(pendiente).getByText("Pendiente L 150.00")).toBeInTheDocument()
    expect(within(facturado).queryByText(/Pendiente L|Sin saldo/)).not.toBeInTheDocument()
    expect(within(facturado).getByText(/VTA-000006/)).toBeInTheDocument()
  })

  it("PED-000008: el detalle muestra lo pagado, lo devuelto y saldo vigente cero; el saldo de antes solo como historia", async () => {
    await renderPedidos({
      rpcs: {
        bandeja: () => [fila(ped08)],
        detalle: () => detalleCancelado(ped08),
        cancelacion: () =>
          cancelacionDe(
            [{ medio: "efectivo", monto: 50, cargo: 0, total: 50, devuelto: 50, pendiente: 0 }],
            [{ medio: "efectivo", importe: 50, ubicacion: "Bodega", referencia: "", usuario: "Encargado", fecha: "2026-11-17T16:00:00Z" }]
          ),
      },
    })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000008 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000008" })
    await within(ventana).findByRole("region", { name: "Cancelación" })

    expect(renglon(ventana, "Total original")).toHaveTextContent("L 200.00")
    expect(renglon(ventana, "Pagos recibidos antes de cancelar")).toHaveTextContent("L 50.00")
    expect(renglon(ventana, "Reembolsado al cliente")).toHaveTextContent("L 50.00")
    expect(renglon(ventana, "Reembolso pendiente")).toHaveTextContent("L 0.00")
    expect(renglon(ventana, "Saldo original antes de cancelar")).toHaveTextContent("L 150.00")
    expect(renglon(ventana, "Saldo vigente por cobrar")).toHaveTextContent("L 0.00")
    expect(renglon(ventana, "Saldo vigente por cobrar")).toHaveClass("grand")

    expect(within(ventana).queryByText("Saldo pendiente del cliente")).not.toBeInTheDocument()
    expect(within(ventana).queryByText(/Pago parcial recibido/)).not.toBeInTheDocument()
    expect(within(ventana).queryByText(/vence/)).not.toBeInTheDocument()
    expect(within(ventana).getByText("Crédito")).toBeInTheDocument()
    expect(within(ventana).getByText("Cancelado")).toBeInTheDocument()

    // Lo cobrado y lo devuelto van en secciones con nombres distintos.
    expect(within(ventana).getByRole("heading", { name: "Detalle de los pagos recibidos" })).toBeInTheDocument()
    expect(within(ventana).getByRole("heading", { name: "Reembolsos al cliente" })).toBeInTheDocument()
    expect(within(ventana).queryByRole("heading", { name: "Cobros recibidos en origen" })).not.toBeInTheDocument()
  })

  it("PED-000007: cancelado sin pago, saldo vigente cero y nada que devolver", async () => {
    await renderPedidos({
      rpcs: { bandeja: () => [fila(ped07)], detalle: () => detalleCancelado(ped07), cancelacion: () => cancelacionDe([]) },
    })

    fireEvent.click(await screen.findByRole("button", { name: "Abrir el pedido PED-000007 de Ferremax" }))
    const ventana = await screen.findByRole("dialog", { name: "Pedido PED-000007" })
    await within(ventana).findByRole("region", { name: "Cancelación" })

    expect(renglon(ventana, "Total original")).toHaveTextContent("L 90.00")
    expect(renglon(ventana, "Pagos recibidos antes de cancelar")).toHaveTextContent("L 0.00")
    expect(renglon(ventana, "Reembolso pendiente")).toHaveTextContent("L 0.00")
    expect(renglon(ventana, "Saldo original antes de cancelar")).toHaveTextContent("L 90.00")
    expect(renglon(ventana, "Saldo vigente por cobrar")).toHaveTextContent("L 0.00")
    expect(within(ventana).queryByText("Saldo pendiente del cliente")).not.toBeInTheDocument()
    expect(within(ventana).queryByRole("heading", { name: "Detalle de los pagos recibidos" })).not.toBeInTheDocument()
  })

  it("un pedido pendiente sigue mostrando su saldo y su vencimiento", async () => {
    const { ventana } = await abrirElPedido()

    expect(renglon(ventana, "Total")).toHaveTextContent("L 230.00")
    expect(renglon(ventana, "Saldo pendiente del cliente")).toHaveTextContent("L 150.00")
    expect(within(ventana).getByText(/vence 2026-12-31/)).toBeInTheDocument()
    expect(within(ventana).queryByText("Saldo vigente por cobrar")).not.toBeInTheDocument()
  })

  // C2b (0050): reembolso desde una tercera ubicación, bloqueo por liquidación y obligaciones del pedido.
  const canceladoC2b = (cambios = {}) =>
    sinCancelacion({
      puede_registrar: true,
      es_admin: true,
      puede_reembolsar_electronico: true,
      cancelacion: { motivo: "El cliente ya no lo quiere", usuario: "Administrador", fecha: "2026-11-19T15:00:00Z", principal: 400, cargo: 0 },
      productos: [{ producto_id: "p1", nombre: "Cargador", entregado: 2, buen_estado: 2, danado: 0, pendiente: 0 }],
      dinero: [{ medio: "efectivo", monto: 400, cargo: 0, total: 400, devuelto: 0, pendiente: 400 }],
      ubicaciones_para_reembolsar: [
        { id: "bodega", nombre: "Bodega", otra: false },
        { id: "camion-01", nombre: "Camión 01", otra: false },
        { id: "camion-02", nombre: "Camión 02", otra: true },
      ],
      ...cambios,
    })

  it("el administrador devuelve efectivo desde otra ubicación solo con la referencia de la entrega", async () => {
    const { llamadas, ventana } = await abrirElPedido({
      rpcs: { detalle: () => detalle({ estado: "cancelado", puede_facturar: false }), cancelacion: () => canceladoC2b() },
    })

    fireEvent.click(within(ventana).getByRole("button", { name: "Registrar reembolso" }))

    const formulario = await screen.findByRole("dialog", { name: "Registrar reembolso PED-000001" })

    expect(within(formulario).queryByLabelText("Referencia de la entrega")).not.toBeInTheDocument()
    fireEvent.change(within(formulario).getByLabelText("Sale de la caja de"), { target: { value: "camion-02" } })
    expect(within(formulario).getByRole("option", { name: "Camión 02 (otra ubicación)" })).toBeInTheDocument()
    expect(within(formulario).getByText(/«Camión 02» no es el origen ni el destino/)).toBeInTheDocument()
    expect(within(formulario).getByRole("button", { name: "Registrar reembolso" })).toBeDisabled()

    fireEvent.change(within(formulario).getByLabelText("Referencia de la entrega"), { target: { value: "Recibo 80" } })
    fireEvent.click(within(formulario).getByRole("button", { name: "Registrar reembolso" }))

    await waitFor(() =>
      expect(llamadas.reembolsar).toEqual([
        { p_pedido: "ped-1", p_medio: "efectivo", p_importe: 400, p_ubicacion: "camion-02", p_referencia: "Recibo 80", p_clave_idempotencia: expect.any(String) },
      ])
    )
  })

  it("con una liquidación por confirmar no ofrece devolver efectivo y dice por qué", async () => {
    const { ventana } = await abrirElPedido({
      rpcs: {
        detalle: () => detalle({ estado: "cancelado", puede_facturar: false }),
        cancelacion: () => canceladoC2b({ bloqueo_de_reembolsos: "LIQ-000003 (por confirmar)" }),
      },
    })

    const seccion = within(ventana).getByRole("region", { name: "Cancelación" })

    expect(seccion).toHaveTextContent("El efectivo de este pedido está en LIQ-000003 (por confirmar)")
    expect(within(ventana).queryByRole("button", { name: "Registrar reembolso" })).not.toBeInTheDocument()
  })

  it("el pedido cancelado dice quién le debe a quién entre ubicaciones, y desde dónde se devolvió", async () => {
    const { ventana } = await abrirElPedido({
      rpcs: {
        detalle: () => detalle({ estado: "cancelado", puede_facturar: false }),
        cancelacion: () =>
          canceladoC2b({
            dinero: [{ medio: "efectivo", monto: 400, cargo: 0, total: 400, devuelto: 400, pendiente: 0 }],
            reembolsos: [{ medio: "efectivo", importe: 400, ubicacion: "Camión 02", referencia: "Recibo 80", usuario: "Administrador", fecha: "2026-11-19T16:00:00Z", en_otra_ubicacion: true }],
            obligaciones: [
              { debe: "Bodega", recibe: "Camión 02", monto: 300, por_confirmar: 0, liquidado: 0, pendiente: 300 },
              { debe: "Camión 01", recibe: "Camión 02", monto: 100, por_confirmar: 0, liquidado: 100, pendiente: 0 },
            ],
          }),
      },
    })

    const seccion = within(ventana).getByRole("region", { name: "Cancelación" })

    expect(within(seccion).getByRole("heading", { name: "Entre ubicaciones" })).toBeInTheDocument()
    expect(within(seccion).getByText("Bodega le debe a Camión 02").closest("li")).toHaveTextContent("Pendiente L 300.00")
    expect(within(seccion).getByText("Camión 01 le debe a Camión 02").closest("li")).toHaveTextContent("Liquidado")
    expect(seccion).toHaveTextContent("Devuelto L 400.00 con Efectivo desde Camión 02 (otra ubicación)")
  })

  it("el filtro «Cancelados» pide los pedidos cancelados", async () => {
    const { llamadas } = await renderPedidos()

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "cancelado" } })
    await waitFor(() => expect(llamadas.bandeja.at(-1)).toEqual({ p_vista: "recibidos", p_estado: "cancelado" }))
  })
})

async function renderCampana({ rol = "vendedor", permisos = ["pos"], avisos } = {}) {
  let consultas = 0
  const r = await renderizarPantalla(
    <AuthProvider>
      <MemoryRouter initialEntries={["/pos"]}>
        <Routes>
          <Route path="*" element={<><CampanaDePedidos /><Direccion /></>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
    {
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ubicacionOperativa: "camion-01",
      rpcsExtra: {
        avisos_de_pedidos: () => {
          consultas += 1

          return { data: avisos ? avisos(consultas) : { pendientes: 2, sin_leer: 1, ultimos: [fila(), fila({ pedido_id: "ped-2", numero: "PED-000002", leido: true })] }, error: null }
        },
      },
    }
  )

  await paso()

  return { ...r, consultas: () => consultas }
}

describe("Pedidos: la campanita", () => {
  it("muestra los pendientes, distingue los no leídos y abre el pedido", async () => {
    await renderCampana()

    const campana = await screen.findByRole("button", { name: "Pedidos recibidos: 2 pendientes de facturar, 1 sin leer" })

    expect(campana).toHaveTextContent("2")

    fireEvent.click(campana)
    expect(screen.getByText("Pendientes de facturar: 2")).toBeInTheDocument()
    expect(screen.getAllByText("Nuevo")).toHaveLength(1)

    fireEvent.click(screen.getByText("PED-000001").closest("button"))
    expect(screen.getByTestId("direccion")).toHaveTextContent("/pedidos?pedido=ped-1")
  })

  it("se actualiza cuando cambia un pedido y cada minuto", async () => {
    const intervalo = vi.spyOn(window, "setInterval")
    const { consultas } = await renderCampana({ avisos: (n) => ({ pendientes: n === 1 ? 1 : 0, sin_leer: 0, ultimos: [] }) })

    await screen.findByRole("button", { name: /1 pendiente de facturar/ })
    expect(intervalo).toHaveBeenCalledWith(expect.any(Function), CADA_CUANTO)

    await act(async () => {
      window.dispatchEvent(new Event(EVENTO_PEDIDOS_CAMBIARON))
    })

    await screen.findByRole("button", { name: "Pedidos recibidos: ninguno pendiente" })
    expect(consultas()).toBe(2)
    intervalo.mockRestore()
  })

  it("no aparece para el contador ni para quien no factura", async () => {
    await renderCampana({ rol: "contador", permisos: ["sales-history"] })
    expect(screen.queryByRole("button", { name: /Pedidos recibidos/ })).not.toBeInTheDocument()
  })

  it("no aparece sin permiso de facturar", async () => {
    await renderCampana({ permisos: ["dashboard"] })
    expect(screen.queryByRole("button", { name: /Pedidos recibidos/ })).not.toBeInTheDocument()
  })
})

describe("Pedidos: la campanita avisa los rechazados (etapa C1)", () => {
  it("suma los rechazados por resolver, con quién lo rechazó y el motivo", async () => {
    await renderCampana({
      avisos: () => ({
        pendientes: 1,
        sin_leer: 0,
        por_resolver: 1,
        por_resolver_sin_leer: 1,
        ultimos: [
          fila({ pedido_id: "ped-9", numero: "PED-000009", estado: "por_resolver", motivo: "El cliente es de Bodega", leido: false }),
          fila({ leido: true }),
        ],
      }),
    })

    const campana = await screen.findByRole("button", { name: "Pedidos: 1 pendiente de facturar, 1 rechazado por resolver, 1 sin leer" })

    expect(campana).toHaveTextContent("2")

    fireEvent.click(campana)
    expect(screen.getByText("Rechazados por resolver: 1")).toBeInTheDocument()
    expect(screen.getByText("Por resolver")).toBeInTheDocument()
    expect(screen.getByText(/rechazado por Camión 01/)).toBeInTheDocument()
    expect(screen.getByText("«El cliente es de Bodega»")).toBeInTheDocument()

    fireEvent.click(screen.getByText("PED-000009").closest("button"))
    expect(screen.getByTestId("direccion")).toHaveTextContent("/pedidos?pedido=ped-9")
  })
})
