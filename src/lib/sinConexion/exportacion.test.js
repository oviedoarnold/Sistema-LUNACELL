// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"

import { CARGADOR, CLIENTE, DUENO, copiaDePrueba, sesionDe, ahoraDePrueba, nuevoNavegador } from "./pruebas/ayudas"
import { construirVentaLocal } from "./venta"
import { exportarCifrado, importarCifrado, FORMATO_DE_RESPALDO, ITERACIONES_DEL_RESPALDO } from "./exportacion"
import { guardarCopia } from "./copiaLocal"
import { guardarVenta, ventasDe } from "./cola"
import { aParametrosDeRescate } from "../api/ventasSinConexion"

const venta = () => ({
  ...construirVentaLocal({
    copia: copiaDePrueba(),
    sesion: sesionDe(),
    dispositivo: "dispositivo-de-prueba-0001",
    carrito: [{ productoId: CARGADOR.id, cantidad: 2 }],
    formaPago: "credito",
    clienteId: CLIENTE.id,
    nombreCliente: "Ferremax Secreta",
    fechaVencimiento: "2026-11-10",
    ahora: ahoraDePrueba(),
  }),
  numeroProvisional: "PROV-ABCD-000001",
})

const FRASE = "frase-larga-de-prueba-2026"

describe("exportación de emergencia", () => {
  it("cifra y descifra las ventas sin perder nada", async () => {
    const ventas = [venta(), venta()]

    const archivo = await exportarCifrado(ventas, FRASE)
    const recuperadas = await importarCifrado(archivo, FRASE)

    expect(recuperadas).toEqual(ventas)
  })

  it("el archivo no deja ver los datos del cliente ni las claves", async () => {
    const v = venta()

    const archivo = await exportarCifrado([v], FRASE)

    expect(archivo).not.toContain("Ferremax Secreta")
    expect(archivo).not.toContain(v.clave)
    expect(JSON.parse(archivo)).toMatchObject({ formato: FORMATO_DE_RESPALDO, algoritmo: "AES-GCM", derivacion: "PBKDF2-SHA-256" })
  })

  it("con otra frase no se puede abrir", async () => {
    const archivo = await exportarCifrado([venta()], FRASE)

    await expect(importarCifrado(archivo, "otra-frase-equivocada")).rejects.toThrow(/frase/i)
  })

  it("un archivo alterado no se acepta", async () => {
    const archivo = JSON.parse(await exportarCifrado([venta()], FRASE))
    archivo.datos = archivo.datos.slice(0, -4) + "AAAA"

    await expect(importarCifrado(JSON.stringify(archivo), FRASE)).rejects.toThrow()
  })

  it("exige una frase de al menos 10 caracteres", async () => {
    await expect(exportarCifrado([venta()], "corta")).rejects.toThrow(/10 caracteres/i)
  })

  it("lo exportado se convierte en los parámetros exactos de rescatar_venta_sin_conexion", async () => {
    const v = venta()

    expect(aParametrosDeRescate(v, "lote-1")).toEqual({
      p_clave_idempotencia: v.clave,
      p_usuario_auth: v.usuarioAuth,
      p_ubicacion_id: v.ubicacionId,
      p_dispositivo: v.dispositivo,
      p_numero_provisional: v.numeroProvisional,
      p_registrada_en: v.registradaEn,
      p_reloj_dispositivo: v.registradaEn,
      p_tasa_isv: v.tasaIsv,
      p_renglones: v.renglones,
      p_total_cobrado: v.totalCobrado,
      p_forma_pago: "credito",
      p_cliente_id: CLIENTE.id,
      p_nombre_cliente: "Ferremax Secreta",
      p_rtn_comprador: "",
      p_fecha_vencimiento: "2026-11-10",
      p_nota: "",
      p_lote: "lote-1",
    })
  })
})

/*
  Regresiones: un archivo de emergencia es una entrada externa. Antes de
  derivar la llave (PBKDF2, costoso a propósito) se valida todo lo que el
  archivo declara; un archivo manipulado no puede congelar el navegador.
*/
describe("archivos de emergencia manipulados", () => {
  afterEach(() => vi.restoreAllMocks())

  const legitimo = async () => JSON.parse(await exportarCifrado([venta()], FRASE))
  const sinDerivar = () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey").mockRejectedValue(new Error("no debía derivar"))
    const deriveKey = vi.spyOn(crypto.subtle, "deriveKey").mockRejectedValue(new Error("no debía derivar"))

    return () => {
      expect(importKey).not.toHaveBeenCalled()
      expect(deriveKey).not.toHaveBeenCalled()
    }
  }

  it("los archivos legítimos usan PBKDF2-SHA-256 con 310 000 iteraciones", async () => {
    const archivo = await legitimo()

    expect(ITERACIONES_DEL_RESPALDO).toBe(310000)
    expect(archivo.iteraciones).toBe(310000)
    expect(await importarCifrado(JSON.stringify(archivo), FRASE)).toHaveLength(1)
  })

  it.each([
    ["excesivas", 1e12],
    ["por encima del máximo", 1000001],
    ["negativas", -310000],
    ["cero", 0],
    ["nulas", null],
    ["fraccionarias", 310000.5],
    ["en texto", "310000"],
    ["por debajo del mínimo", 1000],
    ["infinitas", "Infinity"],
  ])("rechaza iteraciones %s sin derivar ninguna llave", async (_caso, iteraciones) => {
    const archivo = await legitimo()
    archivo.iteraciones = iteraciones
    const comprobar = sinDerivar()

    await expect(importarCifrado(JSON.stringify(archivo), FRASE)).rejects.toThrow(/iteraciones/i)
    comprobar()
  })

  it.each([
    ["sal corta", (a) => (a.sal = "AAAA")],
    ["sal no base64", (a) => (a.sal = "%%%%%%%%%%%%%%%%%%%%%%%%")],
    ["iv de otro largo", (a) => (a.iv = a.sal)],
    ["iv ausente", (a) => delete a.iv],
    ["datos vacíos", (a) => (a.datos = "")],
    ["datos no base64", (a) => (a.datos = "esto no es base64!")],
    ["datos de otro tipo", (a) => (a.datos = 12345)],
    ["algoritmo distinto", (a) => (a.algoritmo = "AES-CBC")],
    ["derivación distinta", (a) => (a.derivacion = "PBKDF2-SHA-1")],
    ["formato distinto", (a) => (a.formato = "otro-v9")],
  ])("rechaza un archivo con %s sin derivar ninguna llave", async (_caso, alterar) => {
    const archivo = await legitimo()
    alterar(archivo)
    const comprobar = sinDerivar()

    await expect(importarCifrado(JSON.stringify(archivo), FRASE)).rejects.toThrow(/respaldo/i)
    comprobar()
  })

  it.each([
    ["texto que no es JSON", "{no es json"],
    ["un arreglo", "[]"],
    ["null", "null"],
    ["un número", "42"],
  ])("rechaza %s con un error controlado", async (_caso, texto) => {
    const comprobar = sinDerivar()

    await expect(importarCifrado(texto, FRASE)).rejects.toThrow(/respaldo/i)
    comprobar()
  })

  it("rechaza un archivo demasiado grande antes de leerlo", async () => {
    const comprobar = sinDerivar()
    const enorme = "x".repeat(20 * 1024 * 1024 + 1)

    await expect(importarCifrado(enorme, FRASE)).rejects.toThrow(/demasiado grande/i)
    comprobar()
  })

  it("rechaza un contenido descifrado que no trae una lista de ventas", async () => {
    const frase = FRASE
    const sal = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(frase), "PBKDF2", false, ["deriveKey"])
    const llave = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: 310000 },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    )
    const datos = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, llave, new TextEncoder().encode("{\"ventas\":\"no\"}")))
    const b64 = (b) => btoa(String.fromCharCode(...b))
    const archivo = JSON.stringify({
      formato: FORMATO_DE_RESPALDO, algoritmo: "AES-GCM", derivacion: "PBKDF2-SHA-256",
      iteraciones: 310000, sal: b64(sal), iv: b64(iv), datos: b64(datos),
    })

    await expect(importarCifrado(archivo, frase)).rejects.toThrow(/respaldo/i)
  })

  it("una importación fallida no toca las ventas guardadas en el teléfono", async () => {
    const almacen = await nuevoNavegador().abrir()
    const copia = copiaDePrueba()
    await guardarCopia(almacen, copia)
    await guardarVenta(almacen, construirVentaLocal({
      copia, sesion: sesionDe(), dispositivo: "dispositivo-de-prueba-0001",
      carrito: [{ productoId: CARGADOR.id, cantidad: 1 }], ahora: ahoraDePrueba(),
    }))
    const antes = await ventasDe(almacen, DUENO)
    const archivo = await legitimo()
    archivo.iteraciones = 1e12

    await expect(importarCifrado(JSON.stringify(archivo), FRASE)).rejects.toThrow()
    await expect(importarCifrado(JSON.stringify(await legitimo()), "frase-equivocada-123")).rejects.toThrow(/frase/i)

    expect(await ventasDe(almacen, DUENO)).toEqual(antes)
  })
})
