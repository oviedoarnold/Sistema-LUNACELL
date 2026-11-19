import { describe, it, expect } from "vitest"

import { cifrasDeCancelado, inicial, leerFormulario, mediosQuePuedeDevolver, pendientesQuePuedeCompletar, resumen } from "./cancelacionDePedidos"

/*
  La lógica del formulario de cancelación (0049): qué se envía y cuándo no se
  puede enviar. La base vuelve a comprobarlo todo (pruebas-sql/cancelacion-pedidos).
*/

const cancelacion = (cambios = {}) => ({
  puedeCancelar: true,
  puedeRegistrar: false,
  esAdmin: false,
  productos: [
    { id: "p1", nombre: "Cargador", entregado: 2, buenEstado: 0, danado: 0, pendiente: 2 },
    { id: "p2", nombre: "Cubo", entregado: 1, buenEstado: 1, danado: 0, pendiente: 0 },
  ],
  dinero: [
    { medio: "efectivo", monto: 130, cargo: 0, total: 130, devuelto: 30, pendiente: 100 },
    { medio: "tarjeta", monto: 100, cargo: 1.7, total: 101.7, devuelto: 0, pendiente: 101.7 },
  ],
  ubicacionesParaRecibir: [{ id: "bodega", nombre: "Bodega", otra: false }],
  ubicacionesParaReembolsar: [{ id: "bodega", nombre: "Bodega" }],
  puedeReembolsarElectronico: false,
  ...cambios,
})

const formulario = (c, modo, cambios = {}) => ({ ...inicial(c, modo), ...cambios })

describe("leerFormulario", () => {
  it("cancelar exige el motivo", () => {
    const c = cancelacion()

    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { motivo: " no " })).problema).toMatch(/motivo/)
    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { motivo: "Ya no lo quiere" })).datos).toEqual({
      motivo: "Ya no lo quiere",
      recepcion: null,
      reembolsos: [],
    })
  })

  it("«Todos» recibe lo pendiente de cada producto, con su estado y la ubicación", () => {
    const c = cancelacion()
    const f = formulario(c, "cancelar", { motivo: "Ya no lo quiere", productosModo: "todos", condiciones: { p1: "danado", p2: "buen_estado" } })

    expect(leerFormulario(c, "cancelar", f).datos.recepcion).toEqual({
      ubicacionId: "bodega",
      nota: "",
      productos: [{ productoId: "p1", cantidad: 2, condicion: "danado" }],
    })
  })

  it("«Algunos» toma las cantidades escritas y no deja pasar de lo pendiente ni dejarlo vacío", () => {
    const c = cancelacion()
    const base = { motivo: "Ya no lo quiere", productosModo: "algunos" }

    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { ...base, cantidades: { p1: "1" } })).datos.recepcion.productos).toEqual([
      { productoId: "p1", cantidad: 1, condicion: "buen_estado" },
    ])
    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { ...base, cantidades: { p1: "3" } })).problema).toMatch(/entre 0 y 2/)
    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { ...base, cantidades: { p1: "1.5" } })).problema).toMatch(/entero/)
    expect(leerFormulario(c, "cancelar", formulario(c, "cancelar", { ...base, cantidades: { p1: "0" } })).problema).toMatch(/al menos un producto/)
  })

  it("en otra ubicación (solo el administrador) exige una nota que respalde la recepción", () => {
    const c = cancelacion({ ubicacionesParaRecibir: [{ id: "camion", nombre: "Camión 01", otra: true }] })
    const f = formulario(c, "recibir")

    expect(leerFormulario(c, "recibir", f).problema).toMatch(/Camión 01.*nota/)
    expect(leerFormulario(c, "recibir", { ...f, nota: "Acta de recepción 15" }).datos.recepcion).toMatchObject({ ubicacionId: "camion", nota: "Acta de recepción 15" })
  })

  it("el vendedor solo devuelve efectivo, desde su ubicación, y nunca más de lo pendiente", () => {
    const c = cancelacion()
    const f = formulario(c, "cancelar", { motivo: "Ya no lo quiere", reembolsar: true })

    expect(mediosQuePuedeDevolver(c).map((d) => d.medio)).toEqual(["efectivo"])
    expect(leerFormulario(c, "cancelar", f).datos.reembolsos).toEqual([{ medio: "efectivo", importe: 100, ubicacionId: "bodega", referencia: "" }])
    expect(leerFormulario(c, "cancelar", { ...f, importes: { efectivo: "100.01" } }).problema).toMatch(/más de lo pendiente/)
    expect(leerFormulario(c, "cancelar", { ...f, importes: { efectivo: "10.555" } }).problema).toMatch(/dos decimales/)
    expect(leerFormulario(c, "cancelar", { ...f, importes: { efectivo: "40" } }).datos.reembolsos[0].importe).toBe(40)
  })

  it("el administrador devuelve lo electrónico con referencia, cargo incluido", () => {
    const c = cancelacion({ esAdmin: true, puedeReembolsarElectronico: true })
    const f = formulario(c, "reembolsar", { importes: { efectivo: "", tarjeta: "101.70" } })

    expect(leerFormulario(c, "reembolsar", f).problema).toMatch(/referencia/)
    expect(leerFormulario(c, "reembolsar", { ...f, referencias: { tarjeta: "Reverso 7" } }).datos.reembolsos).toEqual([
      { medio: "tarjeta", importe: 101.7, ubicacionId: null, referencia: "Reverso 7" },
    ])
    expect(leerFormulario(c, "reembolsar", { ...f, importes: { efectivo: "", tarjeta: "" } }).problema).toMatch(/cuánto se le devuelve/)
  })

  it("el resumen dice qué queda pendiente y que la caja no baja hasta devolver", () => {
    const c = cancelacion()
    const { datos } = leerFormulario(c, "cancelar", formulario(c, "cancelar", { motivo: "Ya no lo quiere", productosModo: "algunos", cantidades: { p1: "1" } }))

    expect(resumen(c, "cancelar", datos)).toEqual([
      "El pedido queda cancelado: ya no se puede facturar.",
      "Se reciben 1 unidad(es) en Bodega; solo las de buen estado vuelven a su existencia.",
      "Quedan 1 unidad(es) por recibir.",
      "No se devuelve dinero ahora.",
      "Quedan L 201.70 pendientes de devolver al cliente: no salen de ninguna caja hasta que se devuelvan.",
      "Lo cobrado se conserva tal como se registró y ya no se le debe a la ubicación destino.",
    ])
  })
})

describe("pendientesQuePuedeCompletar", () => {
  it("solo con permiso en un pedido cancelado, y solo lo que quien mira puede hacer", () => {
    expect(pendientesQuePuedeCompletar(cancelacion())).toEqual({ recibir: false, reembolsar: false })
    expect(pendientesQuePuedeCompletar(cancelacion({ puedeRegistrar: true }))).toEqual({ recibir: true, reembolsar: true })
    expect(
      pendientesQuePuedeCompletar(cancelacion({ puedeRegistrar: true, ubicacionesParaReembolsar: [], dinero: [{ medio: "tarjeta", total: 10, devuelto: 0, pendiente: 10 }] }))
    ).toEqual({ recibir: true, reembolsar: false })
    expect(pendientesQuePuedeCompletar(null)).toEqual({ recibir: false, reembolsar: false })
  })
})

describe("C2b: tercera ubicación y bloqueo por liquidación por confirmar", () => {
  const conTercera = (cambios = {}) =>
    cancelacion({
      puedeRegistrar: true,
      puedeReembolsarElectronico: true,
      ubicacionesParaReembolsar: [
        { id: "bodega", nombre: "Bodega", otra: false },
        { id: "camion-01", nombre: "Camión 01", otra: true },
      ],
      ...cambios,
    })

  it("el efectivo desde otra ubicación exige la referencia de la entrega", () => {
    const c = conTercera()
    const desdeCamion = formulario(c, "reembolsar", { desdeId: "camion-01", importes: { efectivo: "100", tarjeta: "" } })

    expect(leerFormulario(c, "reembolsar", desdeCamion).problema).toMatch(/«Camión 01» no es el origen ni el destino: escribe la referencia/)

    expect(leerFormulario(c, "reembolsar", { ...desdeCamion, referencias: { efectivo: " Recibo 80 " } }).datos.reembolsos).toEqual([
      { medio: "efectivo", importe: 100, ubicacionId: "camion-01", referencia: "Recibo 80" },
    ])
  })

  it("desde el origen o el destino, sin referencia, como siempre", () => {
    const c = conTercera()

    expect(leerFormulario(c, "reembolsar", formulario(c, "reembolsar", { importes: { efectivo: "100", tarjeta: "" } })).datos.reembolsos).toEqual([
      { medio: "efectivo", importe: 100, ubicacionId: "bodega", referencia: "" },
    ])
  })

  it("con una liquidación por confirmar no se devuelve efectivo; lo electrónico sí", () => {
    const c = conTercera({ bloqueoDeReembolsos: "LIQ-000003 (por confirmar)" })

    expect(mediosQuePuedeDevolver(c).map((d) => d.medio)).toEqual(["tarjeta"])
    expect(pendientesQuePuedeCompletar(c).reembolsar).toBe(true)
    expect(pendientesQuePuedeCompletar(conTercera({ bloqueoDeReembolsos: "LIQ-000003 (por confirmar)", puedeReembolsarElectronico: false })).reembolsar).toBe(false)
  })

  it("el resumen dice de qué caja sale el efectivo y que la diferencia va a Liquidaciones", () => {
    const c = conTercera()
    const { datos } = leerFormulario(c, "reembolsar", formulario(c, "reembolsar", { desdeId: "camion-01", importes: { efectivo: "100", tarjeta: "" }, referencias: { efectivo: "R" } }))

    expect(resumen(c, "reembolsar", datos)).toContain("El efectivo sale de la caja de Camión 01. Si lo conserva otra ubicación, se lo deberá a Camión 01 en Liquidaciones.")
  })
})

describe("cifrasDeCancelado: un pedido cancelado ya no debe nada", () => {
  const conDinero = (dinero) => ({ cancelacion: { motivo: "x" }, dinero })

  it("cancelado sin pago (PED-000007): nada recibido ni por devolver; el saldo de antes es solo historia", () => {
    expect(cifrasDeCancelado({ total: 90, cobrado: 0, cargo: 0, saldo: 90 }, conDinero([]))).toEqual({
      recibido: 0,
      reembolsado: 0,
      porReembolsar: 0,
      saldoAntes: 90,
      saldoVigente: 0,
    })
  })

  it("cancelado con anticipo y reembolso (PED-000008): lo pagado, lo devuelto y saldo vigente cero", () => {
    expect(
      cifrasDeCancelado(
        { total: 200, cobrado: 50, cargo: 0, saldo: 150 },
        conDinero([{ medio: "efectivo", total: 50, devuelto: 50, pendiente: 0 }])
      )
    ).toEqual({ recibido: 50, reembolsado: 50, porReembolsar: 0, saldoAntes: 150, saldoVigente: 0 })
  })

  it("suma los medios con su cargo y lo que falta devolver, en centavos exactos", () => {
    expect(
      cifrasDeCancelado(
        { total: 230, cobrado: 100.1, cargo: 1.36, saldo: 129.9 },
        conDinero([
          { medio: "efectivo", total: 20.1, devuelto: 20.1, pendiente: 0 },
          { medio: "tarjeta", total: 81.36, devuelto: 0, pendiente: 81.36 },
        ])
      )
    ).toEqual({ recibido: 101.46, reembolsado: 20.1, porReembolsar: 81.36, saldoAntes: 129.9, saldoVigente: 0 })
  })

  it("sin los datos de la cancelación, lo pagado sale del pedido y lo devuelto queda sin saber", () => {
    expect(cifrasDeCancelado({ total: 230, cobrado: 80, cargo: 1.36, saldo: 150 }, null)).toEqual({
      recibido: 81.36,
      reembolsado: null,
      porReembolsar: null,
      saldoAntes: 150,
      saldoVigente: 0,
    })
  })
})
