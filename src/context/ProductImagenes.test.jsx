import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useContext } from "react"

import { AuthProvider } from "./AuthContext"
import ProductProvider from "./ProductContext"
import { ProductContext } from "./contexts"
import { EMPRESA, esperarQueSeAsiente, montarDatos } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const CON_FOTO = {
  id: "p1",
  code: "M-001",
  name: "Martillo",
  category: "Herramientas",
  price: 180,
  stock: 5,
  minStock: 2,
}

const imagen = ({ type = "image/jpeg", size = 1024 } = {}) => ({ type, size })

function Envoltura({ children }) {
  return (
    <AuthProvider>
      <ProductProvider>{children}</ProductProvider>
    </AuthProvider>
  )
}

async function montarInventario(productos = []) {
  const falso = montarDatos({ productos })

  const vista = renderHook(() => useContext(ProductContext), {
    wrapper: Envoltura,
  })

  await waitFor(() => {
    expect(falso.from).toHaveBeenCalledWith("productos_con_stock")
  })

  await waitFor(() => {
    expect(vista.result.current.cargando).toBe(false)
  })

  await esperarQueSeAsiente(falso)

  return { ...vista, falso }
}

const nuevo = {
  code: "T-001",
  name: "Taladro",
  category: "Herramientas",
  price: 1200,
  costPrice: 900,
  stock: 4,
  minStock: 1,
}

describe("imágenes de producto", () => {
  it("guarda el producto sin imagen si no se eligió ninguna", async () => {
    const { result, falso } = await montarInventario()

    await act(async () => {
      await result.current.agregarProducto(nuevo)
    })

    expect(falso.archivos.size).toBe(0)
    expect(falso.datos.productos[0].imagen_url).toBeFalsy()
  })

  it("sube la imagen del producto nuevo y guarda su dirección", async () => {
    const { result, falso } = await montarInventario()

    await act(async () => {
      await result.current.agregarProducto(nuevo, imagen())
    })

    expect(falso.archivos.size).toBe(1)
    expect(falso.datos.productos[0].imagen_url).toContain("/productos/")
  })

  it("guarda la imagen dentro de la carpeta de su empresa", async () => {
    const { result, falso } = await montarInventario()

    await act(async () => {
      await result.current.agregarProducto(nuevo, imagen())
    })

    const [ruta] = [...falso.archivos.keys()]

    expect(ruta.startsWith(`productos/${EMPRESA}/`)).toBe(true)
  })

  it("no sube nada si el archivo no es una imagen admitida", async () => {
    const { result, falso } = await montarInventario()

    await expect(
      result.current.agregarProducto(nuevo, imagen({ type: "application/pdf" }))
    ).rejects.toThrow(/JPG, PNG o WebP/i)

    expect(falso.archivos.size).toBe(0)
  })

  it("no sube una imagen que pasa el límite de tamaño", async () => {
    const { result, falso } = await montarInventario()

    await expect(
      result.current.agregarProducto(nuevo, imagen({ size: 3 * 1024 * 1024 }))
    ).rejects.toThrow(/máximo es 2 MB/i)

    expect(falso.archivos.size).toBe(0)
  })

  it("al cambiar la foto borra la anterior y deja solo la nueva", async () => {
    const { result, falso } = await montarInventario([CON_FOTO])

    await act(async () => {
      await result.current.editarProducto("p1", CON_FOTO, imagen())
    })

    const primera = [...falso.archivos.keys()][0]

    await act(async () => {
      await result.current.editarProducto(
        "p1",
        { ...CON_FOTO, imageUrl: result.current.products[0].imageUrl },
        imagen({ type: "image/png" })
      )
    })

    expect(falso.archivos.size).toBe(1)
    expect([...falso.archivos.keys()][0]).not.toBe(primera)
  })

  it("editar sin tocar la foto la conserva", async () => {
    const { result, falso } = await montarInventario([CON_FOTO])

    await act(async () => {
      await result.current.editarProducto("p1", CON_FOTO, imagen())
    })

    const guardada = result.current.products[0].imageUrl

    await act(async () => {
      await result.current.editarProducto("p1", {
        ...CON_FOTO,
        name: "Martillo de uña",
        imageUrl: guardada,
      })
    })

    expect(falso.archivos.size).toBe(1)
    expect(result.current.products[0].imageUrl).toBe(guardada)
    expect(result.current.products[0].name).toBe("Martillo de uña")
  })

  it("el nombre del archivo cambia entre subidas para que no se vea la foto vieja en caché", async () => {
    const { result, falso } = await montarInventario()

    await act(async () => {
      await result.current.agregarProducto(nuevo, imagen())
    })

    const [ruta] = [...falso.archivos.keys()]

    expect(ruta).toMatch(/-\d{10,}\.jpg$/)
  })
})
