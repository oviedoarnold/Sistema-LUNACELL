import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { IDBFactory } from "fake-indexeddb"

import { AuthContext } from "./contexts"
import { SinConexionProvider } from "./SinConexionContext"
import { useSinConexion } from "../hooks/useSinConexion"
import { abrirAlmacen } from "../lib/sinConexion/almacen"
import { EVENTO_DE_VERSION } from "../lib/sinConexion/almacenDeLaApp"
import { guardarCopia } from "../lib/sinConexion/copiaLocal"
import { guardarVenta } from "../lib/sinConexion/cola"
import { construirVentaLocal } from "../lib/sinConexion/venta"
import { CARGADOR, copiaDePrueba } from "../lib/sinConexion/pruebas/ayudas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return null
  },
  hayConexionConfigurada: false,
}))

/*
  El proveedor del modo sin conexión con un usuario controlado por la
  prueba: lo que se lee del teléfono es siempre del usuario y la ubicación
  en sesión, y nada se envía sin una sesión real del mismo usuario.
*/

const usuario = (cambios = {}) => ({
  id: "u-1",
  empresa_id: "empresa-1",
  authId: "auth-vendedor",
  locationId: "camion-01",
  role: "vendedor",
  permissions: ["pos"],
  ...cambios,
})

function clienteFalso({ sesionDe = "auth-vendedor" } = {}) {
  return {
    auth: { getSession: vi.fn(async () => ({ data: { session: sesionDe ? { user: { id: sesionDe } } : null } })) },
    rpc: vi.fn(async () => ({ data: { estado: "registrada", venta_id: "v-1", numero_factura: "F-1" }, error: null, status: 200 })),
    from: vi.fn(),
  }
}

let navegador

async function venderEnElTelefono({ usuarioAuth = "auth-vendedor", ubicacionId = "camion-01" } = {}) {
  const almacen = await abrirAlmacen({ indexedDB: navegador })
  const copia = copiaDePrueba({ empresaId: "empresa-1", usuarioAuth, ubicacionId })
  await guardarCopia(almacen, copia)
  await guardarVenta(
    almacen,
    construirVentaLocal({
      copia,
      sesion: { empresaId: "empresa-1", usuarioAuth, ubicacionId },
      dispositivo: "dispositivo-0001",
      carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
    })
  )
  almacen.cerrar()
}

function montar({ user = usuario(), cliente = clienteFalso(), ventana = window, comprobarServidor = async () => false } = {}) {
  const auth = { user, hasPermission: () => true, revalidarSesion: vi.fn() }

  const vista = renderHook(() => useSinConexion(), {
    initialProps: { user },
    wrapper: ({ children, user: actual = user }) => (
      <AuthContext.Provider value={{ ...auth, user: actual }}>
        <SinConexionProvider
          abrir={() => abrirAlmacen({ indexedDB: navegador })}
          cliente={cliente}
          comprobarServidor={comprobarServidor}
          descargar={vi.fn(async () => null)}
          ventana={ventana}
        >
          {children}
        </SinConexionProvider>
      </AuthContext.Provider>
    ),
  })

  return vista
}

beforeEach(() => {
  navegador = new IDBFactory()
})

describe("lo guardado en el teléfono es del usuario y la ubicación en sesión", () => {
  it("las ventas de otro usuario del mismo teléfono no se ven ni se cuentan", async () => {
    await venderEnElTelefono({ usuarioAuth: "auth-otro" })

    const vista = montar()

    await waitFor(() => expect(vista.result.current.disponible).toBe(true))
    await waitFor(() => expect(vista.result.current.copia).toBeNull())
    expect(vista.result.current.ventas).toEqual([])
    expect(vista.result.current.pendientes).toBe(0)
  })

  it("las suyas sí, con la copia de su ubicación", async () => {
    await venderEnElTelefono()

    const vista = montar()

    await waitFor(() => expect(vista.result.current.pendientes).toBe(1))
    expect(vista.result.current.copia).toMatchObject({ ubicacionId: "camion-01" })
    expect(vista.result.current.ubicacionAutorizada).toBe(true)
    expect(vista.result.current.disponibleDe(CARGADOR.id)).toBe(9)
  })

  it("si su ubicación cambió, avisa de las ventas que quedaron de la otra y no usa aquella copia", async () => {
    await venderEnElTelefono({ ubicacionId: "camion-01" })

    const vista = montar({ user: usuario({ locationId: "camion-02" }) })

    await waitFor(() => expect(vista.result.current.ventasDeOtraUbicacion).toBe(1))
    expect(vista.result.current.copia).toBeNull()
    expect(vista.result.current.ubicacionAutorizada).toBe(false)
  })
})

describe("cuidados del almacén", () => {
  it("al habilitarse la ubicación pide almacenamiento persistente", async () => {
    await venderEnElTelefono()
    const persist = vi.fn(async () => true)
    const ventana = new EventTarget()
    ventana.navigator = { onLine: false, storage: { persisted: async () => false, persist } }

    const vista = montar({ ventana })

    await waitFor(() => expect(vista.result.current.persistencia).toBe("concedido"))
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it("si otra pestaña abre una versión nueva del almacén, pide recargar", async () => {
    const ventana = new EventTarget()
    ventana.navigator = { onLine: false }

    const vista = montar({ ventana })
    await waitFor(() => expect(vista.result.current.disponible).toBe(true))

    act(() => {
      ventana.dispatchEvent(new Event(EVENTO_DE_VERSION))
    })

    expect(vista.result.current.actualizacionPendiente).toBe(true)
    expect(vista.result.current.disponible).toBe(false)
  })
})

describe("nada se envía sin una sesión real del mismo usuario", () => {
  it("con el perfil sin conexión y sin sesión del servidor, no envía y lo explica", async () => {
    await venderEnElTelefono()
    const cliente = clienteFalso({ sesionDe: null })

    const vista = montar({ user: usuario({ sinConexion: true }), cliente, comprobarServidor: async () => true })
    await waitFor(() => expect(vista.result.current.pendientes).toBe(1))

    await act(() => vista.result.current.sincronizarAhora())

    expect(cliente.rpc).not.toHaveBeenCalled()
    expect(vista.result.current.errorDeSincronizacion).toMatch(/inicia sesión/i)
    expect(vista.result.current.pendientes).toBe(1)
  })

  it("con la sesión de otro usuario tampoco", async () => {
    await venderEnElTelefono()
    const cliente = clienteFalso({ sesionDe: "auth-otro" })

    const vista = montar({ cliente, comprobarServidor: async () => true })
    await waitFor(() => expect(vista.result.current.pendientes).toBe(1))

    await act(() => vista.result.current.sincronizarAhora())

    expect(cliente.rpc).not.toHaveBeenCalled()
    expect(vista.result.current.pendientes).toBe(1)
  })

  it("con su sesión, la envía y queda registrada", async () => {
    await venderEnElTelefono()
    const cliente = clienteFalso()

    const vista = montar({ cliente, comprobarServidor: async () => true })
    await waitFor(() => expect(vista.result.current.disponible).toBe(true))

    await act(() => vista.result.current.sincronizarAhora())

    await waitFor(() => expect(vista.result.current.pendientes).toBe(0))
    expect(cliente.rpc).toHaveBeenCalledWith("sincronizar_venta_sin_conexion", expect.objectContaining({ p_ubicacion_id: "camion-01" }))
    expect(vista.result.current.ventas[0]).toMatchObject({ estado: "registrada", numeroFactura: "F-1" })
  })
})

describe("perfil sin conexión vencido", () => {
  it("no guarda ventas con un perfil sin conexión de más de 7 días", async () => {
    await venderEnElTelefono()
    const vencido = new Date(Date.now() - 8 * 24 * 3600000).toISOString()

    const vista = montar({ user: usuario({ sinConexion: true, confirmadoEn: vencido }) })
    await waitFor(() => expect(vista.result.current.copia).not.toBeNull())

    await expect(
      vista.result.current.guardarVentaSinConexion({ carrito: [{ productoId: CARGADOR.id, cantidad: 1 }] })
    ).rejects.toThrow(/venció/i)
    expect(vista.result.current.pendientes).toBe(1)
  })
})
