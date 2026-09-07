import { describe, it, expect, vi } from "vitest"

import {
  revisarImagen,
  subirImagenDeProducto,
  borrarImagenDeProducto,
  FORMATOS_DE_IMAGEN,
  TAMANO_MAXIMO_IMAGEN,
} from "./catalogos"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const archivo = ({ type = "image/jpeg", size = 1024 } = {}) => ({ type, size })

const montarAlmacenamiento = () => {
  const falso = crearSupabaseFalso({ tablas: {} })

  globalThis.__supabaseFalso = falso

  return falso
}

const EMPRESA = "empresa-1"
const PRODUCTO = "producto-1"

describe("revisarImagen", () => {
  it("acepta los formatos que admite el bucket", () => {
    FORMATOS_DE_IMAGEN.forEach((type) => {
      expect(() => revisarImagen(archivo({ type }))).not.toThrow()
    })
  })

  it("rechaza un formato que no es imagen", () => {
    expect(() => revisarImagen(archivo({ type: "application/pdf" }))).toThrow(
      /JPG, PNG o WebP/i
    )
  })

  it("rechaza un formato de imagen que el bucket no acepta", () => {
    expect(() => revisarImagen(archivo({ type: "image/gif" }))).toThrow(
      /JPG, PNG o WebP/i
    )
  })

  it("acepta una imagen justo en el límite de tamaño", () => {
    expect(() =>
      revisarImagen(archivo({ size: TAMANO_MAXIMO_IMAGEN }))
    ).not.toThrow()
  })

  it("rechaza una imagen que pasa el límite", () => {
    expect(() =>
      revisarImagen(archivo({ size: TAMANO_MAXIMO_IMAGEN + 1 }))
    ).toThrow(/máximo es 2 MB/i)
  })

  it("dice cuánto pesaba la imagen rechazada", () => {
    expect(() => revisarImagen(archivo({ size: 5 * 1024 * 1024 }))).toThrow(
      /5\.0 MB/
    )
  })
})

describe("subirImagenDeProducto", () => {
  it("guarda el archivo en la carpeta de la empresa", async () => {
    const falso = montarAlmacenamiento()

    await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    const [ruta] = [...falso.archivos.keys()]

    expect(ruta.startsWith(`productos/${EMPRESA}/`)).toBe(true)
  })

  it("nombra el archivo con el id del producto", async () => {
    const falso = montarAlmacenamiento()

    await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    expect([...falso.archivos.keys()][0]).toContain(PRODUCTO)
  })

  /*
    Sin marca de tiempo, el navegador seguiría mostrando la foto anterior
    desde su caché al reemplazarla.
  */
  it("cambia el nombre entre subidas del mismo producto", async () => {
    montarAlmacenamiento()

    const primera = await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    vi.setSystemTime(new Date(Date.now() + 1000))

    const segunda = await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    expect(primera).not.toBe(segunda)

    vi.useRealTimers()
  })

  it("usa la extensión que corresponde al formato", async () => {
    const falso = montarAlmacenamiento()

    await subirImagenDeProducto(archivo({ type: "image/webp" }), PRODUCTO, EMPRESA)

    expect([...falso.archivos.keys()][0]).toMatch(/\.webp$/)
  })

  it("devuelve la dirección pública del archivo", async () => {
    montarAlmacenamiento()

    const url = await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    expect(url).toContain("/productos/")
    expect(url).toMatch(/^https:\/\//)
  })

  it("no sube nada si el archivo no pasa la revisión", async () => {
    const falso = montarAlmacenamiento()

    await expect(
      subirImagenDeProducto(archivo({ type: "text/plain" }), PRODUCTO, EMPRESA)
    ).rejects.toThrow(/JPG, PNG o WebP/i)

    expect(falso.archivos.size).toBe(0)
  })
})

describe("borrarImagenDeProducto", () => {
  it("borra el archivo que indica la dirección", async () => {
    const falso = montarAlmacenamiento()

    const url = await subirImagenDeProducto(archivo(), PRODUCTO, EMPRESA)

    await borrarImagenDeProducto(url)

    expect(falso.archivos.size).toBe(0)
  })

  it("no hace nada si la dirección está vacía", async () => {
    const falso = montarAlmacenamiento()

    await borrarImagenDeProducto("")

    expect(falso.storage.from).not.toHaveBeenCalled()
  })

  it("no hace nada si la dirección no es de este almacenamiento", async () => {
    const falso = montarAlmacenamiento()

    await borrarImagenDeProducto("https://otro-sitio.test/foto.png")

    expect(falso.storage.from).not.toHaveBeenCalled()
  })
})
