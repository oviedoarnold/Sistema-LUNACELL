import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, within, waitFor } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import ClientsProvider from "../context/ClientsContext"
import { EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import Receivables from "./Receivables"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const CLIENTE = {
  id: "c1",
  name: "Arnold Oviedo",
  rtn: "0801199912345",
  phone: "9999-0000",
  address: "Tegucigalpa",
  email: "",
}

const aCredito = (extra = {}) => ({
  id: "v1",
  invoiceNumber: "FAC-00001",
  correlativo: 1,
  date: "01/01/2026",
  isoDate: "2026-01-01T10:00:00Z",
  timestamp: Date.parse("2026-01-01T10:00:00Z"),
  clientId: "c1",
  clientName: "Arnold Oviedo",
  items: [{ productId: "p1", name: "Cargador", qty: 1, quantity: 1, price: 1000, subtotal: 1000 }],
  subtotal: 1000,
  tax: 0,
  total: 1000,
  paymentType: "credito",
  type: "credito",
  status: "pendiente",
  dueDate: "2026-02-01",
  payments: [],
  company: empresa,
  ...extra,
})

const TRES_FACTURAS = [
  aCredito({ id: "v1", invoiceNumber: "FAC-00001", correlativo: 1, total: 1000 }),
  aCredito({
    id: "v2",
    invoiceNumber: "FAC-00002",
    correlativo: 2,
    total: 2750,
    isoDate: "2026-02-01T10:00:00Z",
    timestamp: Date.parse("2026-02-01T10:00:00Z"),
  }),
  aCredito({
    id: "v3",
    invoiceNumber: "FAC-00003",
    correlativo: 3,
    total: 5000,
    isoDate: "2026-03-01T10:00:00Z",
    timestamp: Date.parse("2026-03-01T10:00:00Z"),
  }),
]

function renderCxC(ventas = TRES_FACTURAS, clientes = [CLIENTE]) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <SalesProvider>
            <Receivables />
          </SalesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { ventas, clientes, esperar: ["ventas", "clientes"] }
  )
}

/* Sustituye el rpc del doble para controlar lo que responde el motor. */
function responderRpc(respuesta) {
  const rpc = vi.fn(() => Promise.resolve(respuesta))

  globalThis.__supabaseFalso.rpc = rpc

  return rpc
}

const filaDe = (nombre) => screen.getByText(nombre).closest("tr")

const abrirCobro = () => {
  fireEvent.click(screen.getByRole("button", { name: /abonar/i }))
}

const escribirMonto = (valor) => {
  fireEvent.change(screen.getByLabelText(/monto del abono/i), {
    target: { value: String(valor) },
  })
}

const confirmar = () => {
  fireEvent.click(screen.getByRole("button", { name: /confirmar abono/i }))
}

const pagoDelServidor = (extra = {}) => ({
  data: {
    pago_id: "p1",
    cliente_id: "c1",
    monto: 4000,
    saldo_anterior: 8750,
    saldo_posterior: 4750,
    fecha: "2026-03-10T10:00:00Z",
    repetido: false,
    aplicaciones: [
      {
        venta_id: "v1",
        numero_factura: "FAC-00001",
        correlativo: 1,
        monto_aplicado: 1000,
        saldo_anterior_factura: 1000,
        saldo_posterior_factura: 0,
      },
      {
        venta_id: "v2",
        numero_factura: "FAC-00002",
        correlativo: 2,
        monto_aplicado: 2750,
        saldo_anterior_factura: 2750,
        saldo_posterior_factura: 0,
      },
      {
        venta_id: "v3",
        numero_factura: "FAC-00003",
        correlativo: 3,
        monto_aplicado: 250,
        saldo_anterior_factura: 5000,
        saldo_posterior_factura: 4750,
      },
    ],
    ...extra,
  },
  error: null,
})

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("la cuenta consolidada en pantalla", () => {
  it("muestra una sola fila por cliente aunque tenga varias facturas", async () => {
    await renderCxC()

    expect(screen.getAllByText("Arnold Oviedo")).toHaveLength(1)
    expect(filaDe("Arnold Oviedo")).toHaveTextContent("3")
    expect(filaDe("Arnold Oviedo")).toHaveTextContent("L 8,750.00")
  })

  it("separa a clientes distintos", async () => {
    await renderCxC(
      [
        aCredito({ id: "v1", clientId: "c1", total: 1000 }),
        aCredito({ id: "v2", clientId: "c2", clientName: "Otro", total: 500 }),
      ],
      [CLIENTE, { ...CLIENTE, id: "c2", name: "Otro" }]
    )

    expect(screen.getByText("Arnold Oviedo")).toBeInTheDocument()
    expect(screen.getByText("Otro")).toBeInTheDocument()
  })

  it("avisa cuando nadie debe nada", async () => {
    await renderCxC([], [CLIENTE])

    expect(screen.getByText(/nadie debe nada/i)).toBeInTheDocument()
  })

  it("el botón Abonar es del cliente, no de una factura", async () => {
    await renderCxC()

    const botones = screen.getAllByRole("button", { name: /abonar/i })

    expect(botones).toHaveLength(1)
    expect(filaDe("Arnold Oviedo")).toContainElement(botones[0])
  })

  it("no hay ninguna acción de abono por factura", async () => {
    await renderCxC()

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }))

    const dialogo = screen.getByRole("dialog")

    expect(
      within(dialogo).queryByRole("button", { name: /abonar/i })
    ).not.toBeInTheDocument()

    expect(
      within(dialogo).queryByRole("textbox")
    ).not.toBeInTheDocument()
  })
})

describe("ver detalle", () => {
  it("lista las facturas del cliente con su saldo", async () => {
    await renderCxC()

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }))

    const dialogo = screen.getByRole("dialog")

    expect(dialogo).toHaveTextContent("FAC-00001")
    expect(dialogo).toHaveTextContent("FAC-00002")
    expect(dialogo).toHaveTextContent("FAC-00003")
    expect(dialogo).toHaveTextContent("L 8,750.00")
  })

  it("las ordena de la más antigua a la más reciente", async () => {
    await renderCxC()

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }))

    const numeros = within(screen.getByRole("dialog"))
      .getAllByText(/FAC-\d+/)
      .map((n) => n.textContent)

    expect(numeros).toEqual(["FAC-00001", "FAC-00002", "FAC-00003"])
  })
})

describe("validación del monto en la pantalla", () => {
  it("rechaza un monto de cero", async () => {
    await renderCxC()
    const rpc = responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(0)
    confirmar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/mayor que cero/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rechaza un monto negativo", async () => {
    await renderCxC()
    const rpc = responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(-50)
    confirmar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/mayor que cero/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rechaza un monto mayor que la deuda mostrada", async () => {
    await renderCxC()
    const rpc = responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(9000)
    confirmar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/no puede superar/i)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("registrar el cobro", () => {
  it("manda solo cliente, monto, clave y nota", async () => {
    await renderCxC()
    const rpc = responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(4000)
    fireEvent.change(screen.getByLabelText(/nota/i), {
      target: { value: "Depósito 881" },
    })
    confirmar()

    await waitFor(() => expect(rpc).toHaveBeenCalled())

    const [funcion, argumentos] = rpc.mock.calls[0]

    expect(funcion).toBe("registrar_pago_cliente")
    expect(Object.keys(argumentos).sort()).toEqual([
      "p_clave_idempotencia",
      "p_cliente_id",
      "p_monto",
      "p_nota",
    ])
    expect(argumentos.p_cliente_id).toBe("c1")
    expect(argumentos.p_monto).toBe(4000)
    expect(argumentos.p_nota).toBe("Depósito 881")
    expect(argumentos.p_clave_idempotencia).toEqual(expect.any(String))
  })

  /*
    La regla de CxC-2: React no decide nada del reparto. Si algún día
    alguien añade la empresa o la lista de facturas a esta llamada, esta
    prueba lo para.
  */
  it("no manda empresa, usuario, saldos ni reparto", async () => {
    await renderCxC()
    const rpc = responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(1000)
    confirmar()

    await waitFor(() => expect(rpc).toHaveBeenCalled())

    const enviado = JSON.stringify(rpc.mock.calls[0][1])

    for (const prohibido of [
      "empresa",
      "usuario",
      "saldo",
      "facturas",
      "aplicaciones",
      "venta_id",
    ]) {
      expect(enviado).not.toContain(prohibido)
    }
  })

  it("registra un pago parcial", async () => {
    await renderCxC()
    responderRpc(
      pagoDelServidor({
        monto: 400,
        saldo_anterior: 8750,
        saldo_posterior: 8350,
        aplicaciones: [
          {
            venta_id: "v1",
            numero_factura: "FAC-00001",
            correlativo: 1,
            monto_aplicado: 400,
            saldo_anterior_factura: 1000,
            saldo_posterior_factura: 600,
          },
        ],
      })
    )

    abrirCobro()
    escribirMonto(400)
    confirmar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())

    const dialogo = Swal.fire.mock.calls[0][0]

    expect(dialogo.icon).toBe("success")
    expect(dialogo.text).toContain("L 400.00")
    expect(dialogo.text).toContain("FAC-00001")
  })

  it("el reparto que se muestra es el que devolvió el servidor", async () => {
    await renderCxC()
    responderRpc(pagoDelServidor())

    abrirCobro()
    escribirMonto(4000)
    confirmar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())

    const texto = Swal.fire.mock.calls[0][0].text

    expect(texto).toContain("FAC-00001: L 1,000.00")
    expect(texto).toContain("FAC-00002: L 2,750.00")
    expect(texto).toContain("FAC-00003: L 250.00")
    expect(texto).toContain("cancelada")
  })

  it("avisa que la cuenta quedó saldada cuando el pago la cubre", async () => {
    await renderCxC()
    responderRpc(
      pagoDelServidor({ monto: 8750, saldo_anterior: 8750, saldo_posterior: 0 })
    )

    abrirCobro()
    escribirMonto(8750)
    confirmar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())

    expect(Swal.fire.mock.calls[0][0].title).toMatch(/cancelada/i)
  })
})

describe("cuando el servidor rechaza", () => {
  it("muestra el sobrepago que detectó el servidor y no felicita", async () => {
    await renderCxC()

    globalThis.__supabaseFalso.rpc = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: {
          code: "LC001",
          message: "El pago de 8750.00 supera la deuda del cliente, que es de 6750.00",
        },
      })
    )

    abrirCobro()
    escribirMonto(8750)
    confirmar()

    expect(await screen.findByRole("alert")).toHaveTextContent(/supera la deuda/i)
    expect(Swal.fire).not.toHaveBeenCalled()
  })

  it("un fallo de red no registra nada ni felicita", async () => {
    await renderCxC()

    globalThis.__supabaseFalso.rpc = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: "08006", message: "connection failure" },
      })
    )

    abrirCobro()
    escribirMonto(1000)
    confirmar()

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(Swal.fire).not.toHaveBeenCalled()
  })
})

describe("la clave de idempotencia", () => {
  it("un reintento del mismo cobro conserva la clave", async () => {
    await renderCxC()

    const rpc = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { code: "08006", message: "connection failure" },
      })
    )
    globalThis.__supabaseFalso.rpc = rpc

    abrirCobro()
    escribirMonto(1000)
    confirmar()
    await screen.findByRole("alert")

    confirmar()
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))

    expect(rpc.mock.calls[0][1].p_clave_idempotencia).toBe(
      rpc.mock.calls[1][1].p_clave_idempotencia
    )
  })

  it("una intención nueva después de un éxito usa otra clave", async () => {
    await renderCxC()
    const rpc = responderRpc(
      pagoDelServidor({ monto: 400, saldo_anterior: 8750, saldo_posterior: 8350 })
    )

    abrirCobro()
    escribirMonto(400)
    confirmar()
    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())

    abrirCobro()
    escribirMonto(400)
    confirmar()
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))

    expect(rpc.mock.calls[0][1].p_clave_idempotencia).not.toBe(
      rpc.mock.calls[1][1].p_clave_idempotencia
    )
  })

  it("avisa sin volver a cobrar cuando el motor reconoce el intento", async () => {
    await renderCxC()
    responderRpc(
      pagoDelServidor({
        monto: 400,
        saldo_anterior: 8750,
        saldo_posterior: 8350,
        repetido: true,
      })
    )

    abrirCobro()
    escribirMonto(400)
    confirmar()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())

    expect(Swal.fire.mock.calls[0][0].title).toMatch(/ya estaba registrado/i)
  })
})
