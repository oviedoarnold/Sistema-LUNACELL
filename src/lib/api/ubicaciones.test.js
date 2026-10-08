import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { cambiarEstadoUbicacion, crearUbicacion, actualizarUbicacion } from "./ubicaciones"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Qué mensaje llega cuando la base rechaza un cambio de estado.

  Hasta esta corrección, esta capa tiraba el error de la base y lanzaba uno
  propio: «No se pudo cambiar el estado de la ubicación.» El motivo real
  —escrito en la migración para que lo lea un administrador— solo aparecía
  en la consola del navegador, donde nadie lo mira.

  La distinción es por código y no por texto. Se comprobó contra PostgreSQL
  de verdad qué devuelve cada caso:

    disparador con RAISE EXCEPTION  -> P0001, mensaje para una persona
    clave duplicada                 -> 23505, «duplicate key value violates
                                       unique constraint "..."»

  El segundo no se muestra: no es una frase para nadie y además enseña el
  nombre de un índice.
*/

const UBICACION = {
  id: "u1",
  empresa_id: "e1",
  nombre: "Camión 01",
  tipo: "camion",
  activa: true,
  creada_en: "2026-01-01",
}

/* El mensaje real que escribe el disparador de la migración 0015. */
const DEL_DISPARADOR =
  "No se puede desactivar «Camión 01»: es la ubicación operativa de 1 usuario(s). Cámbiales la ubicación antes."

const GENERICO = "No se pudo cambiar el estado de la ubicación."

const montar = (fallarEn = {}) => {
  const falso = crearSupabaseFalso({
    tablas: { ubicaciones: [{ ...UBICACION }] },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

beforeEach(() => {
  /*
    La capa registra el error en consola antes de lanzarlo, y eso es
    deliberado: el detalle completo sigue estando para quien depure. Se
    silencia aquí para que la salida de las pruebas no parezca rota.
  */
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.__supabaseFalso
})

describe("cambiarEstadoUbicacion · el motivo real llega al usuario", () => {
  /*
    El caso que motivó la corrección. Sin ella, esta prueba falla: el
    mensaje que llegaba era el genérico.
  */
  it("conserva el mensaje cuando la base lo escribió para una persona", async () => {
    montar({
      ubicaciones: { update: { code: "P0001", message: DEL_DISPARADOR } },
    })

    await expect(cambiarEstadoUbicacion("u1", false)).rejects.toThrow(
      DEL_DISPARADOR
    )
  })

  it("el mensaje dice qué hacer, no solo que falló", async () => {
    montar({
      ubicaciones: { update: { code: "P0001", message: DEL_DISPARADOR } },
    })

    await expect(cambiarEstadoUbicacion("u1", false)).rejects.toThrow(
      /cámbiales la ubicación antes/i
    )
  })
})

describe("cambiarEstadoUbicacion · cuándo se usa el aviso genérico", () => {
  it("cuando el error no trae código, por ejemplo si se cayó la red", async () => {
    montar({ ubicaciones: { update: { message: "Failed to fetch" } } })

    await expect(cambiarEstadoUbicacion("u1", false)).rejects.toThrow(GENERICO)
  })

  /*
    Un error del motor que nadie redactó no se enseña. «duplicate key value
    violates unique constraint "ubicaciones_nombre_unico"» no ayuda a quien
    lo lee y filtra el nombre de un índice.
  */
  it("cuando es un error interno del motor, aunque traiga texto", async () => {
    montar({
      ubicaciones: {
        update: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "ubicaciones_nombre_unico"',
        },
      },
    })

    const intento = cambiarEstadoUbicacion("u1", false)

    await expect(intento).rejects.toThrow(GENERICO)
    await expect(intento).rejects.not.toThrow(/unique constraint/)
  })

  it("cuando el código es el correcto pero el mensaje viene vacío", async () => {
    montar({ ubicaciones: { update: { code: "P0001", message: "   " } } })

    await expect(cambiarEstadoUbicacion("u1", false)).rejects.toThrow(GENERICO)
  })
})

describe("cambiarEstadoUbicacion · el camino que funciona", () => {
  it("desactiva sin lanzar nada", async () => {
    const falso = montar()

    await expect(cambiarEstadoUbicacion("u1", false)).resolves.toBeUndefined()

    expect(falso.datos.ubicaciones[0].activa).toBe(false)
  })

  it("vuelve a activar igual", async () => {
    const falso = montar()

    await cambiarEstadoUbicacion("u1", false)
    await cambiarEstadoUbicacion("u1", true)

    expect(falso.datos.ubicaciones[0].activa).toBe(true)
  })

  /*
    Esta corrección no toca ninguna regla: cambia qué se cuenta cuando la
    base dice que no, no cuándo lo dice. La ubicación con existencia sigue
    pudiendo desactivarse, que es de INV-4.
  */
  it("no añade ninguna condición nueva para desactivar", async () => {
    const falso = montar()

    await cambiarEstadoUbicacion("u1", false)

    expect(falso.datos.ubicaciones[0].activa).toBe(false)
    expect(falso.datos.ubicaciones).toHaveLength(1)
  })
})

/*
  SEC-3a: sin `locations`, o al tocar lo fiscal sin ser administrador, la
  base contesta 42501, y el aviso tiene que decir que es una cuestión de
  permiso, no un fallo que se arregla reintentando.
*/
describe("ubicaciones sin permiso", () => {
  const SIN_PERMISO = { code: "42501", message: "new row violates row-level security policy for table \"ubicaciones\"" }

  it("crear dice que falta permiso", async () => {
    montar({ ubicaciones: { insert: SIN_PERMISO } })

    await expect(crearUbicacion({ name: "Camión 02", type: "camion" }, "e1")).rejects.toThrow(
      "No tienes permiso para crear la ubicación."
    )
  })

  it("actualizar dice que falta permiso", async () => {
    montar({ ubicaciones: { update: SIN_PERMISO } })

    await expect(actualizarUbicacion("u1", { name: "Otro", type: "camion" }, "e1")).rejects.toThrow(
      "No tienes permiso para actualizar la ubicación."
    )
  })

  it("cambiar el estado dice que falta permiso", async () => {
    montar({ ubicaciones: { update: SIN_PERMISO } })

    await expect(cambiarEstadoUbicacion("u1", false)).rejects.toThrow(
      "No tienes permiso para cambiar el estado de la ubicación."
    )
  })
})
