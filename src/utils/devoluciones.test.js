import { describe, it, expect } from "vitest"

import { aDevolucionDeApp, formularioInicial, leerDevolucion, leerReembolso, mediosParaReembolsar, resumenDeDevolucion } from "./devoluciones"

/*
  Lo que la pantalla enseña antes de confirmar una devolución (0052). La base
  calcula y registra las cifras de verdad: está probado en
  pruebas-sql/devoluciones-de-ventas.test.mjs. Aquí se comprueba que la
  pantalla dice lo mismo que ella dirá.
*/

const venta = (extra = {}) => ({
  id: "V-1",
  items: [{ productId: "p1", name: "Cargador", qty: 2, price: 100, subtotal: 200 }],
  subtotal: 200,
  total: 230,
  ...extra,
})

const info = ({ dinero = {}, productos, ...resto } = {}) =>
  aDevolucionDeApp({
    puede_registrar: true,
    productos: productos || [{ producto_id: "p1", nombre: "Cargador", vendido: 2, devuelto: 0, disponible: 2, valor_unitario: 115 }],
    dinero: {
      forma_pago: "contado",
      total: 230,
      cargo_original: 0,
      devuelto: 0,
      cargo_devuelto: 0,
      neto: 230,
      saldo: 0,
      a_favor: 0,
      pendiente: 0,
      medios: [{ medio: "efectivo", cobrado: 230, reembolsado: 0 }],
      ...dinero,
    },
    ubicaciones_para_recibir: [{ id: "u1", nombre: "Camión 01" }],
    ...resto,
  })

const formulario = (datos, cantidades, extra = {}) => ({
  ...formularioInicial(datos),
  motivo: "No le sirvió",
  cantidades,
  ...extra,
})

describe("las cifras de una devolución", () => {
  it("una parte de una venta de contado: precio más ISV, todo a favor del cliente y sin cargo", () => {
    const datos = info()
    const { cifras } = leerDevolucion(datos, venta(), formulario(datos, { p1: "1" }))

    expect(cifras).toEqual({ valor: 115, cargo: 0, ajuste: 0, aFavor: 115, nuevoNeto: 115, nuevoSaldo: 0, esLaUltima: false })
  })

  it("la que devuelve todo lo que quedaba devuelve también el cargo y cierra el céntimo", () => {
    const tres = [{ producto_id: "p1", nombre: "Cable", vendido: 3, devuelto: 1, disponible: 2, valor_unitario: 38.33 }]
    const datos = info({ productos: tres, dinero: { total: 115, cargo_original: 4.5, devuelto: 38.33, neto: 76.67, a_favor: 38.33 } })
    const v = venta({ items: [{ productId: "p1", qty: 3, subtotal: 100 }], subtotal: 100, total: 115 })

    const { cifras } = leerDevolucion(datos, v, formulario(datos, { p1: "2" }))

    expect(cifras).toMatchObject({ valor: 76.67, cargo: 4.5, aFavor: 81.17, nuevoNeto: 0, esLaUltima: true })
  })

  it("a crédito rebaja primero el saldo de la factura y solo el excedente queda a favor", () => {
    const sinAbonos = info({ dinero: { forma_pago: "credito", saldo: 230 } })
    expect(leerDevolucion(sinAbonos, venta(), formulario(sinAbonos, { p1: "1" })).cifras).toMatchObject({ ajuste: 115, aFavor: 0, nuevoSaldo: 115 })

    const casiPagada = info({ dinero: { forma_pago: "credito", saldo: 50 } })
    expect(leerDevolucion(casiPagada, venta(), formulario(casiPagada, { p1: "1" })).cifras).toMatchObject({ ajuste: 50, aFavor: 65, nuevoSaldo: 0 })
  })

  it("el resumen dice cuánto baja la venta, qué vuelve a la existencia y lo que queda a favor", () => {
    const datos = info({ dinero: { forma_pago: "credito", saldo: 50 } })
    const lectura = leerDevolucion(datos, venta(), formulario(datos, { p1: "2" }, { condiciones: { p1: "danado" } }))
    const texto = resumenDeDevolucion(datos, lectura, "L").join(" ")

    expect(texto).toContain("La venta baja L 230.00")
    expect(texto).toContain("Lo devuelto está dañado")
    expect(texto).toContain("El saldo de esta factura baja L 50.00 y queda en L 0.00")
    expect(texto).toContain("Quedan L 180.00 a favor del cliente")
  })
})

describe("lo que no se deja enviar", () => {
  const datos = info()

  it.each([
    ["sin motivo", { motivo: "  ok " }, { p1: "1" }, /motivo/],
    ["más de lo que queda", {}, { p1: "3" }, /entre 0 y 2/],
    ["una cantidad con decimales", {}, { p1: "1.5" }, /entre 0 y 2/],
    ["ningún producto", {}, { p1: "0" }, /al menos un producto/],
    ["sin ubicación", { ubicacionId: "otra" }, { p1: "1" }, /dónde se recibieron/],
  ])("%s", (_caso, extra, cantidades, problema) => {
    const lectura = leerDevolucion(datos, venta(), formulario(datos, cantidades, extra))

    expect(lectura.datos).toBeUndefined()
    expect(lectura.problema).toMatch(problema)
  })

  it("envía solo los productos con cantidad, con su estado y la ubicación elegida", () => {
    expect(leerDevolucion(datos, venta(), formulario(datos, { p1: "2" })).datos).toEqual({
      motivo: "No le sirvió",
      productos: [{ producto_id: "p1", cantidad: 2, condicion: "buen_estado" }],
      ubicacionId: "u1",
    })
  })
})

describe("el reembolso de lo que quedó a favor", () => {
  const mixto = (extra = {}) =>
    info({
      dinero: {
        pendiente: 239,
        medios: [
          { medio: "efectivo", cobrado: 100, reembolsado: 0 },
          { medio: "tarjeta", cobrado: 139, reembolsado: 0 },
        ],
      },
      ...extra,
    })

  it("en contado, cada medio hasta lo que se cobró con él; lo electrónico, solo el administrador", () => {
    expect(mediosParaReembolsar(mixto())).toEqual([{ medio: "efectivo", tope: 100 }])
    expect(mediosParaReembolsar(mixto({ puede_reembolsar_electronico: true }))).toEqual([
      { medio: "efectivo", tope: 100 },
      { medio: "tarjeta", tope: 139 },
    ])
  })

  it("a crédito, cualquier medio hasta el excedente; sin nada pendiente, ninguno", () => {
    const excedente = info({ dinero: { forma_pago: "credito", pendiente: 65, medios: [] }, puede_reembolsar_electronico: true })

    expect(mediosParaReembolsar(excedente).map((m) => [m.medio, m.tope])).toEqual([
      ["efectivo", 65],
      ["transferencia", 65],
      ["tarjeta", 65],
      ["enlace", 65],
    ])
    expect(mediosParaReembolsar(info())).toEqual([])
  })

  it("no deja pasar del tope, ni lo electrónico sin referencia", () => {
    const datos = mixto({ puede_reembolsar_electronico: true })

    expect(leerReembolso(datos, { medio: "efectivo", importe: "100.01", referencia: "" }).problema).toMatch(/hasta L 100.00/)
    expect(leerReembolso(datos, { medio: "efectivo", importe: "0", referencia: "" }).problema).toMatch(/mayor que cero/)
    expect(leerReembolso(datos, { medio: "tarjeta", importe: "139", referencia: " " }).problema).toMatch(/referencia/)
    expect(leerReembolso(datos, { medio: "tarjeta", importe: "139", referencia: "AUT-1" }).datos).toEqual({ medio: "tarjeta", importe: 139, referencia: "AUT-1" })
  })
})
