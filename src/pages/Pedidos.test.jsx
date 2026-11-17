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

function Direccion() {
  const { pathname, search } = useLocation()

  return <output data-testid="direccion">{pathname + search}</output>
}

async function renderPedidos({ rpcs = {}, rol = "vendedor", permisos = ["pos"], ruta = "/pedidos" } = {}) {
  const llamadas = { bandeja: [], detalle: [], leer: [], facturar: [] }
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
