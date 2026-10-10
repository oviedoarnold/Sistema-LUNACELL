// @vitest-environment node
import { describe, it, expect } from "vitest"

import { CARGADOR, CLIENTE, copiaDePrueba, sesionDe, ahoraDePrueba } from "./pruebas/ayudas"
import { construirVentaLocal } from "./venta"
import { exportarCifrado, importarCifrado, FORMATO_DE_RESPALDO } from "./exportacion"
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

    const archivo = await exportarCifrado(ventas, FRASE, { iteraciones: 1000 })
    const recuperadas = await importarCifrado(archivo, FRASE)

    expect(recuperadas).toEqual(ventas)
  })

  it("el archivo no deja ver los datos del cliente ni las claves", async () => {
    const v = venta()

    const archivo = await exportarCifrado([v], FRASE, { iteraciones: 1000 })

    expect(archivo).not.toContain("Ferremax Secreta")
    expect(archivo).not.toContain(v.clave)
    expect(JSON.parse(archivo)).toMatchObject({ formato: FORMATO_DE_RESPALDO, algoritmo: "AES-GCM", derivacion: "PBKDF2-SHA-256" })
  })

  it("con otra frase no se puede abrir", async () => {
    const archivo = await exportarCifrado([venta()], FRASE, { iteraciones: 1000 })

    await expect(importarCifrado(archivo, "otra-frase-equivocada")).rejects.toThrow(/frase/i)
  })

  it("un archivo alterado no se acepta", async () => {
    const archivo = JSON.parse(await exportarCifrado([venta()], FRASE, { iteraciones: 1000 }))
    archivo.datos = archivo.datos.slice(0, -4) + "AAAA"

    await expect(importarCifrado(JSON.stringify(archivo), FRASE)).rejects.toThrow()
  })

  it("exige una frase de al menos 10 caracteres", async () => {
    await expect(exportarCifrado([venta()], "corta", { iteraciones: 1000 })).rejects.toThrow(/10 caracteres/i)
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
