import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../test/auth"
import { aFilaDeEmpresa } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

const UBICACIONES = [
  { id: "u-bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "u-c1", name: "Camión 01", type: "camion" },
  { id: "u-retirado", name: "Camión viejo", type: "camion", active: false },
]

const EMPRESA = {
  name: "Ferretería El Yunque",
  address: "San Pedro Sula",
  phone: "2555-0100",
  currency: "L",
  taxRate: 15,
}

const FISCAL_COMPLETO = {
  rtn: "05019012345678",
  cai: "A1B2C3-D4E5F6-A7B8C9-D1E2F3-A4B5C6-D7",
  establecimiento: "000",
  puntoEmision: "001",
  tipoDocumento: "01",
  rangoDesde: 1,
  rangoHasta: 9999,
  fechaLimiteEmision: "2027-12-31",
}

beforeEach(() => {
  vi.resetModules()
})

async function renderSettings({
  empresa = EMPRESA,
  correlativo = 1000,
  ubicaciones = UBICACIONES,
  usuariosExtra = [],
  bloqueos = [],
  listadoCaido = null,
} = {}) {
  const falso = montarSupabaseFalso({
    usuarios: [
      usuarioDePrueba({ rol: "admin", nombre: "Administrador" }),
      ...usuariosExtra,
    ],
    permisos: permisosDe("u-1", ["settings"]),
    sesionInicial: sesionDe("auth-1"),
    tablasExtra: {
      empresas: [
        aFilaDeEmpresa(empresa, { correlativoFactura: correlativo }),
      ],
      productos: [],
      movimientos_inventario: [],
      proveedores: [],
      clientes: [],
      ventas: [],
      detalle_venta: [],
      abonos: [],
      bloqueos_de_acceso: bloqueos,
      /*
        Settings ofrece la ubicación operativa, así que necesita las
        ubicaciones activas de la empresa.
      */
      ubicaciones: ubicaciones.map((u) => ({
        id: u.id,
        empresa_id: "empresa-1",
        nombre: u.name,
        tipo: u.type || "camion",
        activa: u.active !== false,
        creada_en: "2026-01-01",
      })),
    },
  })

  /*
    Solo falla la consulta del listado de usuarios (la que trae permisos);
    el perfil del administrador sí carga. `listadoCaido.activo` se puede
    apagar a mitad de la prueba para simular que la red volvió.
  */
  if (listadoCaido) {
    const original = falso.from.bind(falso)
    falso.from = (nombre) => {
      const consulta = original(nombre)
      if (nombre !== "usuarios") return consulta

      const seleccionar = consulta.select.bind(consulta)
      consulta.select = (columnas) =>
        listadoCaido.activo && String(columnas).includes("permisos_usuario")
          ? { order: () => Promise.resolve({ data: null, error: { code: "PGRST201", message: "ambigua" } }) }
          : seleccionar(columnas)

      return consulta
    }
  }

  const { AuthProvider } = await import("../context/AuthContext")
  const ProductProvider = (await import("../context/ProductContext")).default
  const SalesProvider = (await import("../context/SalesContext")).default
  const LocationsProvider = (await import("../context/LocationsContext")).default
  const Settings = (await import("./Settings")).default

  render(
    <AuthProvider>
      <ProductProvider>
        <LocationsProvider>
          <SalesProvider>
            <Settings />
          </SalesProvider>
        </LocationsProvider>
      </ProductProvider>
    </AuthProvider>
  )

  await screen.findByText(/datos de la empresa/i)

  // El formulario se llena cuando la empresa termina de llegar de la base.
  await waitFor(() => {
    expect(campo("name")).toHaveValue(empresa.name)
  })

  return falso
}

const campo = (nombre) => document.querySelector(`[name="${nombre}"]`)

const escribir = (nombre, valor) =>
  fireEvent.change(campo(nombre), { target: { value: valor } })

describe("Settings: datos de la empresa", () => {
  it("carga los datos guardados en el formulario", async () => {
    await renderSettings()

    expect(campo("name")).toHaveValue("Ferretería El Yunque")
    expect(campo("address")).toHaveValue("San Pedro Sula")
    expect(campo("phone")).toHaveValue("2555-0100")
  })

  it("carga la tasa de ISV", async () => {
    await renderSettings()
    expect(campo("taxRate")).toHaveValue(15)
  })

  it("permite editar el nombre", async () => {
    await renderSettings()
    escribir("name", "Ferretería Nueva")

    expect(campo("name")).toHaveValue("Ferretería Nueva")
  })

  it("deshacer cambios devuelve los valores guardados", async () => {
    await renderSettings()
    escribir("name", "Cambio temporal")

    fireEvent.click(screen.getByRole("button", { name: /deshacer/i }))

    expect(campo("name")).toHaveValue("Ferretería El Yunque")
  })
})

describe("Settings: datos fiscales", () => {
  it("avisa cuando no hay CAI configurado", async () => {
    await renderSettings()

    expect(screen.getByText(/sin datos fiscales/i)).toBeInTheDocument()
  })

  it("muestra los campos fiscales vacíos al inicio", async () => {
    await renderSettings()

    expect(campo("cai")).toHaveValue("")
    expect(campo("rtn")).toHaveValue("")
  })

  it("carga los datos fiscales guardados", async () => {
    await renderSettings({ empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO } })

    expect(campo("cai")).toHaveValue(FISCAL_COMPLETO.cai)
    expect(campo("rtn")).toHaveValue(FISCAL_COMPLETO.rtn)
  })

  it("informa cuántas facturas quedan del rango", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 1000,
    })

    expect(screen.getByText(/quedan 8999 facturas/i)).toBeInTheDocument()
  })

  it("avisa cuando el rango está por agotarse", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 9980,
    })

    expect(screen.getByText(/conviene tramitar/i)).toBeInTheDocument()
  })

  it("avisa cuando el rango ya se agotó", async () => {
    await renderSettings({
      empresa: { ...EMPRESA, fiscal: FISCAL_COMPLETO },
      correlativo: 10500,
    })

    expect(screen.getByText(/se agotó el rango/i)).toBeInTheDocument()
  })

  it("avisa cuando el CAI está vencido", async () => {
    await renderSettings({
      empresa: {
        ...EMPRESA,
        fiscal: { ...FISCAL_COMPLETO, fechaLimiteEmision: "2020-01-01" },
      },
    })

    expect(screen.getByText(/venció el/i)).toBeInTheDocument()
  })

  it("actualiza el aviso al escribir los datos fiscales", async () => {
    await renderSettings()

    escribir("cai", "A1B2C3-D4E5F6")
    escribir("rangoDesde", "1")
    escribir("rangoHasta", "5000")
    escribir("fechaLimiteEmision", "2027-06-30")

    expect(screen.getByText(/rango vigente/i)).toBeInTheDocument()
  })

  it("recuerda confirmar la normativa con un contador", async () => {
    await renderSettings()

    expect(screen.getByText(/contador/i)).toBeInTheDocument()
  })
})

describe("Settings: usuarios", () => {
  it("lista los usuarios registrados", async () => {
    await renderSettings()
    expect(
      (await screen.findAllByText("Administrador")).length
    ).toBeGreaterThan(0)
  })

  it("muestra en la tabla al administrador y a cada empleado", async () => {
    await renderSettings({
      usuariosExtra: [usuarioDePrueba({ id: "u-2", authId: "auth-2", nombre: "Vendedor Camión 01", email: "camion01@ferreteria.test" })],
    })

    const tabla = await screen.findByRole("table", { name: /usuarios/i })

    expect(await within(tabla).findByText("Vendedor Camión 01")).toBeInTheDocument()
    expect(within(tabla).getAllByText("Administrador").length).toBeGreaterThan(0)
    expect(screen.queryByText("No hay usuarios")).not.toBeInTheDocument()
  })

  it("si la lista no se pudo cargar, lo dice y deja reintentar, en vez de decir que no hay usuarios", async () => {
    const listadoCaido = { activo: true }
    await renderSettings({ listadoCaido })

    expect(await screen.findByText(/no se pudieron cargar los usuarios/i)).toBeInTheDocument()
    expect(screen.queryByText("No hay usuarios")).not.toBeInTheDocument()

    listadoCaido.activo = false
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }))

    const tabla = await screen.findByRole("table", { name: /usuarios/i })
    expect((await within(tabla).findAllByText("Administrador")).length).toBeGreaterThan(0)
    expect(screen.queryByText(/no se pudieron cargar los usuarios/i)).not.toBeInTheDocument()
  })

  it("abre el formulario de usuario nuevo", async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    expect(
      screen.getByRole("heading", { name: /nuevo usuario/i })
    ).toBeInTheDocument()
  })

  it("el formulario ofrece elegir los permisos por sección", async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    const modal = document.querySelector(".modal")

    expect(within(modal).getByText("Facturar")).toBeInTheDocument()
    expect(within(modal).getByText("Inventario")).toBeInTheDocument()
  })
})

/*
  USR-1: el administrador crea al empleado con nombre de usuario y correo;
  la contraseña temporal la genera el servidor y se muestra una sola vez.
  Ninguna acción dice que salió bien antes de que el servidor lo confirme.
*/
describe("Settings: alta y acceso de empleados", () => {
  const VENDEDOR = usuarioDePrueba({ id: "u-2", authId: "auth-2", nombre: "Chofer Camión 01", email: "chofer@ferreteria.test" })
  const dialogo = async () => (await import("sweetalert2")).default
  const textosDe = (Swal) => Swal.fire.mock.calls.map(([o]) => JSON.stringify(o)).join("\n")

  const llenarAlta = () => {
    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))
    escribir("username", "camion01")
    fireEvent.change(document.querySelector('.modal [name="name"]'), { target: { value: "Chofer Nuevo" } })
    escribir("email", "nuevo@ferreteria.test")
  }

  it("pide nombre de usuario y correo, y no pide contraseña", async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))
    const modal = document.querySelector(".modal")

    expect(within(modal).getByLabelText(/nombre de usuario/i)).toBeInTheDocument()
    expect(within(modal).getByLabelText(/^correo/i)).toHaveAttribute("type", "email")
    expect(within(modal).queryByLabelText(/contraseña/i)).toBeNull()
  })

  it("crea al empleado con su correo y muestra la contraseña temporal una sola vez", async () => {
    const falso = await renderSettings()
    llenarAlta()

    fireEvent.submit(document.querySelector("#form-usuario"))

    await waitFor(() =>
      expect(falso.functions.invoke).toHaveBeenCalledWith(
        "acceso",
        expect.objectContaining({
          body: expect.objectContaining({ accion: "crear", usuario: "camion01", email: "nuevo@ferreteria.test", nombre: "Chofer Nuevo" }),
        })
      )
    )
    const Swal = await dialogo()
    await waitFor(() => expect(textosDe(Swal)).toContain("Temporal#2026abc"))
    expect(textosDe(Swal).split("Temporal#2026abc")).toHaveLength(2)
  })

  it("si el servidor rechaza el alta, muestra su motivo y no dice que se creó", async () => {
    const falso = await renderSettings()
    falso.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsHttpError", context: { json: async () => ({ error: "Ese nombre de usuario ya está en uso." }) } },
    })
    llenarAlta()

    fireEvent.submit(document.querySelector("#form-usuario"))

    const Swal = await dialogo()
    await waitFor(() => expect(textosDe(Swal)).toContain("Ese nombre de usuario ya está en uso."))
    expect(textosDe(Swal)).not.toMatch(/usuario creado/i)
  })

  it("al editar no se cambian el nombre de usuario ni el correo", async () => {
    await renderSettings({ usuariosExtra: [{ ...VENDEDOR, nombre_usuario: "chofer01" }] })

    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")
    fireEvent.click(within(fila).getByRole("button", { name: /editar/i }))
    const modal = document.querySelector(".modal")

    expect(within(modal).getByLabelText(/nombre de usuario/i)).toHaveAttribute("readonly")
    expect(within(modal).getByLabelText(/^correo/i)).toHaveAttribute("readonly")
  })

  it("no ofrece eliminar usuarios: se desactivan", async () => {
    await renderSettings({ usuariosExtra: [VENDEDOR] })

    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")

    expect(within(fila).queryByRole("button", { name: /eliminar/i })).toBeNull()
    expect(within(fila).getByRole("button", { name: /desactivar/i })).toBeInTheDocument()
  })

  it("desactivar espera al servidor y muestra el error si falla", async () => {
    const falso = await renderSettings({ usuariosExtra: [VENDEDOR] })
    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")
    falso.from.mockImplementationOnce(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { code: "P0001", message: "La empresa no puede quedarse sin un administrador activo." } }) }),
    }))

    fireEvent.click(within(fila).getByRole("button", { name: /desactivar/i }))

    const Swal = await dialogo()
    await waitFor(() => expect(textosDe(Swal)).toContain("La empresa no puede quedarse sin un administrador activo."))
    expect(textosDe(Swal)).not.toMatch(/usuario desactivado/i)
  })

  it("muestra el bloqueo con el tiempo restante y lo desbloquea al confirmar el servidor", async () => {
    const hasta = new Date(Date.now() + 12 * 60000 + 5000).toISOString()
    const falso = await renderSettings({
      usuariosExtra: [VENDEDOR],
      bloqueos: [{ usuario_id: "u-2", intentos: 5, bloqueado_hasta: hasta }],
    })
    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")

    expect(await within(fila).findByText(/bloqueado/i)).toBeInTheDocument()
    expect(within(fila).getByText(/13 min/i)).toBeInTheDocument()

    fireEvent.click(within(fila).getByRole("button", { name: /desbloquear usuario/i }))

    await waitFor(() => expect(falso.rpc).toHaveBeenCalledWith("desbloquear_usuario", { p_usuario: "u-2" }))
    const Swal = await dialogo()
    await waitFor(() => expect(textosDe(Swal)).toMatch(/desbloqueado/i))
  })

  it("sin bloqueo no aparece «Desbloquear usuario»", async () => {
    await renderSettings({ usuariosExtra: [VENDEDOR] })
    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")

    expect(within(fila).queryByRole("button", { name: /desbloquear usuario/i })).toBeNull()
  })

  it("restablecer contraseña, al confirmar, muestra la temporal nueva una sola vez", async () => {
    const falso = await renderSettings({ usuariosExtra: [VENDEDOR] })
    const fila = (await screen.findByText("Chofer Camión 01")).closest("tr")
    const Swal = await dialogo()
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })

    fireEvent.click(within(fila).getByRole("button", { name: /restablecer contraseña/i }))

    await waitFor(() =>
      expect(falso.functions.invoke).toHaveBeenCalledWith("acceso", {
        body: { accion: "restablecer", usuario_id: "u-2", desbloquear: true },
      })
    )
    await waitFor(() => expect(textosDe(Swal)).toContain("Temporal#2026xyz"))
  })
})

/*
  Lo que el administrador configura en INV-2.3: desde dónde trabaja cada
  persona y cuánto inventario alcanza a ver.

  Los permisos no se presentan crudos. Quien reparte accesos no tiene por
  qué saber qué es «inventory-all»; lo que necesita elegir es si esa
  persona ve solo lo suyo o lo de todos.
*/
describe("Settings: inventario y ubicación operativa", () => {
  const abrirFormulario = async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }))

    return document.querySelector(".modal")
  }

  it("ofrece asignar una ubicación operativa", async () => {
    await abrirFormulario()

    expect(
      screen.getByLabelText(/ubicación operativa/i)
    ).toBeInTheDocument()
  })

  /* Una ubicación retirada no es un sitio desde el que nadie trabaje. */
  it("el selector solo ofrece ubicaciones activas", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)

    expect(opciones).toContain("Lunacell Bodega")
    expect(opciones).toContain("Camión 01")
    expect(opciones).not.toContain("Camión viejo")
  })

  it("se puede dejar sin asignar", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)

    expect(within(selector).getByText("Sin asignar")).toBeInTheDocument()
    expect(selector).toHaveValue("")
  })

  it("elegir una ubicación la deja seleccionada", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/ubicación operativa/i)
    fireEvent.change(selector, { target: { value: "u-c1" } })

    expect(selector).toHaveValue("u-c1")
  })

  it("ofrece los tres niveles de consulta en palabras, no en permisos", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    const opciones = within(selector)
      .getAllByRole("option")
      .map((o) => o.textContent)

    expect(opciones).toEqual([
      "No puede consultar existencias",
      "Solo el inventario de su ubicación",
      "El inventario de todas las ubicaciones",
    ])

    for (const opcion of opciones) {
      expect(opcion).not.toMatch(/inventory-/)
    }
  })

  /*
    Un vendedor nuevo nace viendo lo de su ubicación, así que el selector
    tiene que abrirse ya en ese nivel y no en «ninguno».
  */
  it("un vendedor nuevo arranca viendo el inventario de su ubicación", async () => {
    await abrirFormulario()

    expect(
      screen.getByLabelText(/inventario que puede consultar/i)
    ).toHaveValue("propia")
  })

  it("se puede subir a ver todas las ubicaciones", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    fireEvent.change(selector, { target: { value: "todas" } })

    expect(selector).toHaveValue("todas")
  })

  it("y se puede quitar del todo", async () => {
    await abrirFormulario()

    const selector = screen.getByLabelText(/inventario que puede consultar/i)
    fireEvent.change(selector, { target: { value: "ninguno" } })

    expect(selector).toHaveValue("ninguno")
  })

  /*
    Al administrador no se le reparte: los tiene todos por su rol, y un
    selector editable sugeriría que se le pueden quitar.
  */
  it("para un administrador el nivel no se edita", async () => {
    await abrirFormulario()

    fireEvent.change(screen.getByLabelText(/^rol$/i), {
      target: { value: "admin" },
    })

    const selector = screen.getByLabelText(/inventario que puede consultar/i)

    expect(selector).toBeDisabled()
    expect(selector).toHaveValue("todas")
  })
})
