import { describe, it, expect } from "vitest"

import {
  MENSAJE_CON_ABONOS,
  esDelMismoDiaEnHonduras,
  mensajeDeRechazo,
  puedeVerAnular,
  razonParaNoAnular,
  textoDelTratamiento,
} from "./anulacion"
import { getSaleBalance } from "./salesUtils"

/*
  Lo que la pantalla enseña sobre anular. La base decide (anular_venta());
  esto solo evita ofrecer lo que la base va a rechazar y dice por qué.
*/

const CAMION_1 = "u-camion-1"
const CAMION_2 = "u-camion-2"

const venta = (extra = {}) => ({
  id: "v-1",
  invoiceNumber: "VTA-000009",
  status: "pagada",
  paymentType: "contado",
  isoDate: "2026-10-24T15:00:00Z",
  locationId: CAMION_1,
  origin: "en_linea",
  isFiscal: false,
  payments: [],
  ...extra,
})

const ADMIN = { esAdmin: true, puedeAnular: true, ubicacionId: null }
const VENDEDOR = { esAdmin: false, puedeAnular: true, ubicacionId: CAMION_1 }
const MISMO_DIA = new Date("2026-10-24T20:00:00Z")

describe("quién ve el botón «Anular»", () => {
  it("el administrador, en cualquier ubicación", () => {
    expect(puedeVerAnular(venta({ locationId: CAMION_2 }), ADMIN)).toBe(true)
  })

  it("el vendedor con los permisos, en su ubicación", () => {
    expect(puedeVerAnular(venta(), VENDEDOR)).toBe(true)
  })

  it.each([
    ["sin los permisos", { ...VENDEDOR, puedeAnular: false }, venta()],
    ["en otra ubicación", VENDEDOR, venta({ locationId: CAMION_2 })],
    ["sin ubicación asignada", { ...VENDEDOR, ubicacionId: null }, venta()],
    ["si la venta ya está anulada", ADMIN, venta({ status: "anulada" })],
  ])("nadie más: %s", (_, quien, laVenta) => {
    expect(puedeVerAnular(laVenta, quien)).toBe(false)
  })
})

describe("el mismo día, en hora de Honduras", () => {
  it("las 00:00 y las 23:59 de un mismo día de Honduras son el mismo día, aunque en UTC no", () => {
    // 2026-10-24 00:00 en Honduras = 06:00 UTC; 23:59 = 05:59 UTC del día 25.
    expect(esDelMismoDiaEnHonduras("2026-10-24T06:00:00Z", new Date("2026-10-25T05:59:00Z"))).toBe(true)
  })

  it("las 23:59:59 de ayer en Honduras no son hoy, aunque en UTC ya lo sean", () => {
    expect(esDelMismoDiaEnHonduras("2026-10-24T05:59:59Z", new Date("2026-10-24T06:00:01Z"))).toBe(false)
  })
})

describe("por qué no se puede anular", () => {
  it("una venta vigente del día, de contado y sin abonos, se puede anular", () => {
    expect(razonParaNoAnular(venta(), VENDEDOR, MISMO_DIA)).toBeNull()
    expect(razonParaNoAnular(venta(), ADMIN, MISMO_DIA)).toBeNull()
  })

  it("una de conciliación solo la anula el administrador", () => {
    expect(razonParaNoAnular(venta({ origin: "conciliacion" }), VENDEDOR, MISMO_DIA)).toMatch(/solo un administrador/)
    expect(razonParaNoAnular(venta({ origin: "conciliacion" }), ADMIN, MISMO_DIA)).toBeNull()
  })

  it("el vendedor no anula una venta de otro día; el administrador sí", () => {
    const deAyer = venta({ isoDate: "2026-10-23T15:00:00Z" })

    expect(razonParaNoAnular(deAyer, VENDEDOR, MISMO_DIA)).toMatch(/mismo día/)
    expect(razonParaNoAnular(deAyer, ADMIN, MISMO_DIA)).toBeNull()
  })

  it.each([
    ["una factura fiscal", venta({ isFiscal: true }), /fiscales/],
    ["una venta antigua sin ubicación", venta({ locationId: null }), /sin ubicación/],
    ["una venta con abonos", venta({ paymentType: "credito", payments: [{ id: "a", amount: 10 }] }), /abonos registrados/],
  ])("%s, ni siquiera el administrador", (_, laVenta, razon) => {
    expect(razonParaNoAnular(laVenta, ADMIN, MISMO_DIA)).toMatch(razon)
  })

  it("el mensaje de las ventas con abonos es el acordado", () => {
    expect(MENSAJE_CON_ABONOS).toBe(
      "Esta venta tiene abonos registrados y no puede anularse mediante el procedimiento actual. Contacta con el administrador."
    )
  })
})

describe("mensajes y textos", () => {
  it("un rechazo de la base se muestra con su texto, y el de abonos con el acordado", () => {
    expect(mensajeDeRechazo({ motivo: "fuera-de-plazo", message: "Solo puedes anular ventas del mismo día." })).toBe(
      "Solo puedes anular ventas del mismo día."
    )
    expect(mensajeDeRechazo({ motivo: "con-abonos", message: "texto del servidor" })).toBe(MENSAJE_CON_ABONOS)
    expect(mensajeDeRechazo({})).toBe("No se pudo anular la venta.")
  })

  it("el tratamiento del dinero se dice en palabras", () => {
    expect(textoDelTratamiento("reembolso_pendiente")).toBe("Reembolso pendiente")
    expect(textoDelTratamiento("no_cobrado")).toBe("No se cobró, error de registro")
    expect(textoDelTratamiento("credito_sin_abonos")).toMatch(/no entró dinero/)
  })
})

describe("saldo de una venta anulada", () => {
  it("una venta a crédito anulada ya no se debe", () => {
    const credito = venta({ paymentType: "credito", total: 230 })

    expect(getSaleBalance({ ...credito, status: "pendiente" })).toBe(230)
    expect(getSaleBalance({ ...credito, status: "anulada" })).toBe(0)
  })
})
