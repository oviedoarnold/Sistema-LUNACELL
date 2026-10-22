import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  actualizarUbicacion,
  cambiarEstadoUbicacion,
  crearUbicacion,
  resumenParaDesactivarSinConexion,
} from "./ubicaciones"
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

/*
  Ventas sin conexión por ubicación: la marca vende_sin_conexion se cambia
  desde la pantalla de Ubicaciones. La base ya decide quién puede (0027) y
  dónde (0030); esta capa solo envía el cambio cuando lo hay, sin pisar
  nada más, y avisa si la ubicación cambió mientras se editaba.
*/
describe("actualizarUbicacion · ventas sin conexión", () => {
  const ANTERIOR = { id: "u1", name: "Camión 01", type: "camion", active: true, offline: false }

  const filaGuardada = (falso) => falso.datos.ubicaciones.find((u) => u.id === "u1")

  /*
    Como en la base, la marca existe siempre y empieza en false. Se anota
    cada update para comprobar qué columnas se enviaron.
  */
  const montar = (fallarEn = {}) => {
    const falso = crearSupabaseFalso({
      tablas: { ubicaciones: [{ ...UBICACION, vende_sin_conexion: false }] },
      fallarEn,
    })
    const consultar = falso.from.getMockImplementation()
    falso.enviados = []
    falso.from.mockImplementation((tabla) => {
      const constructor = consultar(tabla)
      const update = constructor.update
      constructor.update = (registro) => {
        falso.enviados.push(registro)
        return update(registro)
      }
      return constructor
    })
    globalThis.__supabaseFalso = falso
    return falso
  }

  it("si la marca no cambió, no la envía", async () => {
    const falso = montar()

    await actualizarUbicacion("u1", { ...ANTERIOR, name: "Camión 1" }, "e1", ANTERIOR)

    expect(filaGuardada(falso).nombre).toBe("Camión 1")
    expect(falso.enviados[0]).not.toHaveProperty("vende_sin_conexion")
  })

  it("sin la ubicación anterior no envía la marca aunque venga en el formulario", async () => {
    const falso = montar()

    await actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1")

    expect(falso.enviados[0]).not.toHaveProperty("vende_sin_conexion")
    expect(filaGuardada(falso).vende_sin_conexion).toBe(false)
  })

  it("si cambió, la envía junto con el nombre y el tipo, y nada más", async () => {
    const falso = montar()

    await actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1", ANTERIOR)

    expect(falso.enviados[0]).toEqual({ empresa_id: "e1", nombre: "Camión 01", tipo: "camion", vende_sin_conexion: true })
    expect(filaGuardada(falso)).toEqual({ ...UBICACION, empresa_id: "e1", vende_sin_conexion: true })
  })

  it("si la ubicación cambió mientras se editaba, no guarda una configuración vieja", async () => {
    const falso = montar()
    filaGuardada(falso).activa = false

    await expect(actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1", ANTERIOR)).rejects.toThrow(
      "La ubicación cambió mientras la editabas. Cierra el formulario y vuelve a abrirla."
    )
    expect(filaGuardada(falso).vende_sin_conexion).toBe(false)
  })

  it("42501 al cambiar la marca: solo un administrador puede", async () => {
    montar({ ubicaciones: { update: { code: "42501", message: "Solo un administrador decide si una ubicación vende sin conexión" } } })

    await expect(actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1", ANTERIOR)).rejects.toThrow(
      "Solo un administrador puede cambiar si una ubicación vende sin conexión."
    )
  })

  it("23514 de la 0030: solo camiones y bodegas", async () => {
    montar({
      ubicaciones: {
        update: {
          code: "23514",
          message: 'new row for relation "ubicaciones" violates check constraint "ubicaciones_sin_conexion_solo_camion_o_bodega"',
        },
      },
    })

    await expect(actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1", ANTERIOR)).rejects.toThrow(
      "Solo los camiones y las bodegas pueden vender sin conexión."
    )
  })

  it("23514 de la 0027: una ubicación fiscal no vende sin conexión", async () => {
    montar({
      ubicaciones: {
        update: {
          code: "23514",
          message: 'new row for relation "ubicaciones" violates check constraint "ubicaciones_sin_conexion_no_fiscal"',
        },
      },
    })

    await expect(actualizarUbicacion("u1", { ...ANTERIOR, offline: true }, "e1", ANTERIOR)).rejects.toThrow(
      "Una ubicación que emite factura fiscal no puede vender sin conexión."
    )
  })

  it("crear nunca envía la marca: las ubicaciones nuevas nacen sin ventas sin conexión", async () => {
    const falso = montar()

    await crearUbicacion({ name: "Camión 03", type: "camion", offline: true }, "e1")

    const creada = falso.datos.ubicaciones.find((u) => u.nombre === "Camión 03")
    expect(creada.vende_sin_conexion).not.toBe(true)
  })
})

describe("resumenParaDesactivarSinConexion", () => {
  const AHORA = new Date("2026-10-22T12:00:00Z")

  const montarResumen = (tablas = {}, fallarEn = {}) => {
    globalThis.__supabaseFalso = crearSupabaseFalso({
      tablas: {
        ubicaciones: [{ ...UBICACION, vende_sin_conexion: true }],
        ventas_por_conciliar: [],
        ventas: [],
        usuarios: [],
        ...tablas,
      },
      fallarEn,
    })
  }

  it("cuenta lo que el servidor sabe de esa ubicación y de nada más", async () => {
    montarResumen({
      ventas_por_conciliar: [
        { id: "c1", ubicacion_id: "u1", estado: "pendiente" },
        { id: "c2", ubicacion_id: "u1", estado: "aplicada" },
        { id: "c3", ubicacion_id: "otra", estado: "pendiente" },
      ],
      ventas: [
        { id: "v1", ubicacion_id: "u1", origen: "sin_conexion", dispositivo: "tel-a", recibida_en: "2026-10-21T10:00:00Z" },
        { id: "v2", ubicacion_id: "u1", origen: "sin_conexion", dispositivo: "tel-a", recibida_en: "2026-10-22T09:00:00Z" },
        { id: "v3", ubicacion_id: "u1", origen: "sin_conexion", dispositivo: "tel-b", recibida_en: "2026-10-20T09:00:00Z" },
        { id: "v4", ubicacion_id: "u1", origen: "sin_conexion", dispositivo: "tel-c", recibida_en: "2026-10-01T09:00:00Z" },
        { id: "v5", ubicacion_id: "u1", origen: "en_linea", dispositivo: null, recibida_en: null },
        { id: "v6", ubicacion_id: "otra", origen: "sin_conexion", dispositivo: "tel-z", recibida_en: "2026-10-22T11:00:00Z" },
      ],
      usuarios: [
        { id: "us1", ubicacion_id: "u1", activo: true },
        { id: "us2", ubicacion_id: "u1", activo: false },
        { id: "us3", ubicacion_id: "otra", activo: true },
      ],
    })

    const resumen = await resumenParaDesactivarSinConexion("u1", { ahora: AHORA })

    expect(resumen).toEqual({
      porConciliar: 1,
      ultimaRecibida: "2026-10-22T09:00:00Z",
      telefonosUltimos7Dias: 2,
      usuariosAsignados: 1,
    })
  })

  it("sin ventas sin conexión, la última recibida es null, no una fecha inventada", async () => {
    montarResumen()

    const resumen = await resumenParaDesactivarSinConexion("u1", { ahora: AHORA })

    expect(resumen).toEqual({ porConciliar: 0, ultimaRecibida: null, telefonosUltimos7Dias: 0, usuariosAsignados: 0 })
  })

  it("si una consulta falla, lanza: nunca devuelve ceros que no comprobó", async () => {
    montarResumen({}, { ventas_por_conciliar: { message: "Failed to fetch" } })

    await expect(resumenParaDesactivarSinConexion("u1", { ahora: AHORA })).rejects.toThrow(
      "No se pudo comprobar el estado de las ventas sin conexión de esta ubicación."
    )
  })
})
