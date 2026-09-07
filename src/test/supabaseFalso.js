import { vi } from "vitest"

/*
  Doble de Supabase para las pruebas.

  Guarda las tablas en memoria y responde a las mismas cadenas de llamadas
  que usa la aplicación. Evita depender de la red y permite provocar casos
  que contra la base real serían difíciles de montar, como una cuenta
  válida que nadie invitó.
*/

function aplicarFiltros(filas, filtros) {
  return filas.filter((fila) =>
    filtros.every(([columna, valor]) => fila[columna] === valor)
  )
}

/*
  Con qué columna apunta una tabla hija a su padre. Va explícito y no
  deducido del plural: "cotizaciones" quitándole la s da "cotizacione",
  y el detalle quedaba sin enlazar sin que nada avisara.
*/
const LLAVE_HACIA = {
  empresas: "empresa_id",
  usuarios: "usuario_id",
  productos: "producto_id",
  clientes: "cliente_id",
  proveedores: "proveedor_id",
  ventas: "venta_id",
  cotizaciones: "cotizacion_id",
}

function llaveHacia(tablaPadre) {
  const llave = LLAVE_HACIA[tablaPadre]

  if (!llave) {
    throw new Error(
      `El doble de Supabase no sabe con qué columna se enlaza ${tablaPadre}.`
    )
  }

  return llave
}

function proyectar(fila, columnas, tablas, tablaPadre) {
  const listaDeColumnas = (columnas || "*")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)

  const salida = listaDeColumnas.includes("*") ? { ...fila } : {}

  for (const parte of listaDeColumnas) {
    if (parte === "*") continue

    const anidada = parte.match(/^(\w+)\s*\(([\s\S]*)\)$/)

    if (anidada) {
      const [, tablaHija, columnasHijas] = anidada
      const llave = llaveHacia(tablaPadre)

      const hijas = (tablas[tablaHija] || []).filter(
        (h) => h[llave] === fila.id
      )

      salida[tablaHija] = hijas.map((h) =>
        proyectar(h, columnasHijas, tablas, tablaHija)
      )

      continue
    }

    salida[parte] = fila[parte]
  }

  return salida
}

/*
  Las vistas de la base se recalculan en cada consulta, igual que en
  PostgreSQL. Así una prueba que registra un movimiento ve el stock nuevo
  sin tener que actualizar dos lugares a mano.
*/
const VISTAS = {
  productos_con_stock: (datos) =>
    (datos.productos || []).map((producto) => ({
      ...producto,
      stock: (datos.movimientos_inventario || [])
        .filter((m) => m.producto_id === producto.id)
        .reduce((suma, m) => suma + Number(m.cantidad), 0),
    })),

  stock_actual: (datos) =>
    VISTAS.productos_con_stock(datos).map((p) => ({
      producto_id: p.id,
      empresa_id: p.empresa_id,
      codigo: p.codigo,
      nombre: p.nombre,
      stock_minimo: p.stock_minimo,
      stock: p.stock,
    })),
}

/*
  Los identificadores se numeran con un contador y no con la hora.

  Antes eran `nuevo-${Date.now()}-${i}`, y dos inserciones dentro del mismo
  milisegundo recibían el mismo id. Lo que se rompía no era la inserción
  sino la lectura posterior: quien buscaba el registro recién creado por su
  id encontraba el anterior, y una prueba de dos facturas seguidas comparaba
  la primera consigo misma. Pasaba solo en máquinas rápidas.
*/
let ultimoId = 0

const siguienteId = () => `fila-${++ultimoId}`

/*
  Columnas que la base rellena sola. El código de la aplicación no las
  envía porque el esquema las declara con default now(); sin esto llegan
  sin fecha y cualquier orden por fecha queda al azar.
*/
const COLUMNA_DE_FECHA = {
  ventas: "fecha",
  cotizaciones: "fecha",
  abonos: "fecha",
  movimientos_inventario: "fecha",
  productos: "creado_en",
  clientes: "creado_en",
  proveedores: "creado_en",
}

function valoresPorOmision(tabla) {
  const columna = COLUMNA_DE_FECHA[tabla]

  return columna ? { [columna]: new Date().toISOString() } : {}
}

export function crearSupabaseFalso({
  tablas = {},
  cuentas = [],
  sesionInicial = null,
  fallarEn = {},
} = {}) {
  const datos = JSON.parse(JSON.stringify(tablas))
  let sesion = sesionInicial
  const suscriptores = []

  /*
    Devuelve el error configurado para esa tabla, si lo hay. Acepta tanto
    { productos: error } como { productos: { insert: error } }, para poder
    romper solo una operacion.
  */
  const fallaDe = (nombreTabla, accion) => {
    const configurada = fallarEn[nombreTabla]

    if (!configurada) return null

    if (configurada.message || configurada.code) return configurada

    return configurada[accion] || null
  }

  const consulta = (nombreTabla) => {
    const estado = {
      accion: "select",
      columnas: "*",
      filtros: [],
      registro: null,
      ordenarPor: null,
      tope: null,
    }

    const ejecutar = () => {
      const vista = VISTAS[nombreTabla]
      const filas = vista ? vista(datos) : datos[nombreTabla] || []

      if (estado.accion === "select") {
        const encontradas = aplicarFiltros(filas, estado.filtros).map((f) =>
          proyectar(f, estado.columnas, datos, nombreTabla)
        )

        if (estado.ordenarPor) {
          encontradas.sort((a, b) =>
            String(a[estado.ordenarPor]).localeCompare(String(b[estado.ordenarPor]))
          )
        }

        return estado.tope === null
          ? encontradas
          : encontradas.slice(0, estado.tope)
      }

      if (estado.accion === "insert") {
        const nuevos = (
          Array.isArray(estado.registro) ? estado.registro : [estado.registro]
        ).map((r) => ({
          id: r.id || siguienteId(),
          ...valoresPorOmision(nombreTabla),
          ...r,
        }))

        datos[nombreTabla] = [...filas, ...nuevos]

        return nuevos
      }

      if (estado.accion === "update") {
        const objetivo = aplicarFiltros(filas, estado.filtros)

        datos[nombreTabla] = filas.map((f) =>
          objetivo.includes(f) ? { ...f, ...estado.registro } : f
        )

        return objetivo.map((f) => ({ ...f, ...estado.registro }))
      }

      if (estado.accion === "delete") {
        const objetivo = aplicarFiltros(filas, estado.filtros)

        datos[nombreTabla] = filas.filter((f) => !objetivo.includes(f))

        return objetivo
      }

      return []
    }

    const constructor = {
      select(columnas) {
        estado.columnas = columnas || "*"
        if (estado.accion === "select") estado.accion = "select"
        return constructor
      },
      insert(registro) {
        estado.accion = "insert"
        estado.registro = registro
        return constructor
      },
      update(registro) {
        estado.accion = "update"
        estado.registro = registro
        return constructor
      },
      delete() {
        estado.accion = "delete"
        return constructor
      },
      eq(columna, valor) {
        estado.filtros.push([columna, valor])
        return constructor
      },
      order(columna) {
        estado.ordenarPor = columna
        return constructor
      },
      limit(cantidad) {
        estado.tope = cantidad
        return constructor
      },
      /*
        fallarEn permite provocar el error que devolveria la base. Sin esto
        no habia forma de comprobar que la aplicacion avisa cuando algo
        falla, que es justo lo que el usuario ve cuando algo se rompe.
      */
      maybeSingle() {
        const falla = fallaDe(nombreTabla, estado.accion)
        if (falla) return Promise.resolve({ data: null, error: falla })

        const filas = ejecutar()
        return Promise.resolve({ data: filas[0] || null, error: null })
      },
      single() {
        const falla = fallaDe(nombreTabla, estado.accion)
        if (falla) return Promise.resolve({ data: null, error: falla })

        const filas = ejecutar()
        return Promise.resolve(
          filas.length
            ? { data: filas[0], error: null }
            : { data: null, error: { message: "sin filas" } }
        )
      },
      then(resolver) {
        const falla = fallaDe(nombreTabla, estado.accion)

        return Promise.resolve(
          falla ? { data: null, error: falla } : { data: ejecutar(), error: null }
        ).then(resolver)
      },
    }

    return constructor
  }

  const avisar = () => {
    suscriptores.forEach((cb) => cb("CAMBIO", sesion))
  }

  /*
    La numeración vive en la base, así que el doble la imita: entrega el
    número guardado y aparta el siguiente.
  */
  const siguienteCorrelativo = (tipo) => {
    const columna =
      tipo === "factura"
        ? "proximo_correlativo_factura"
        : "proximo_correlativo_cotizacion"

    const empresa = (datos.empresas || [])[0]

    if (!empresa) {
      return { data: null, error: { message: "sin empresa" } }
    }

    const numero = empresa[columna]

    empresa[columna] = numero + 1

    return { data: numero, error: null }
  }

  /*
    Almacenamiento en memoria. Guarda las rutas subidas para poder
    comprobar que la imagen queda en la carpeta de su empresa, que es de
    donde sale el aislamiento entre ferreterías.
  */
  const archivos = new Map()

  const cubeta = (nombreCubeta) => ({
    upload: vi.fn((ruta, archivo) => {
      archivos.set(nombreCubeta + "/" + ruta, {
        tipo: archivo?.type || "",
        tamano: archivo?.size || 0,
      })

      return Promise.resolve({ data: { path: ruta }, error: null })
    }),

    remove: vi.fn((rutas) => {
      rutas.forEach((r) => archivos.delete(nombreCubeta + "/" + r))

      return Promise.resolve({ data: [], error: null })
    }),

    getPublicUrl: vi.fn((ruta) => ({
      data: {
        publicUrl:
          "https://ejemplo.supabase.co/storage/v1/object/public/" +
          nombreCubeta +
          "/" +
          ruta,
      },
    })),
  })

  return {
    datos,
    archivos,

    storage: { from: vi.fn(cubeta) },

    from: vi.fn(consulta),

    rpc: vi.fn((nombre, argumentos = {}) => {
      if (nombre === "siguiente_correlativo") {
        return Promise.resolve(siguienteCorrelativo(argumentos.p_tipo))
      }

      return Promise.resolve({
        data: null,
        error: { message: "función desconocida: " + nombre },
      })
    }),

    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: sesion }, error: null })
      ),

      onAuthStateChange: vi.fn((cb) => {
        suscriptores.push(cb)

        return {
          data: {
            subscription: {
              unsubscribe: () => {
                const i = suscriptores.indexOf(cb)
                if (i >= 0) suscriptores.splice(i, 1)
              },
            },
          },
        }
      }),

      signInWithPassword: vi.fn(({ email, password }) => {
        const cuenta = cuentas.find(
          (c) => c.email === email && c.password === password
        )

        if (!cuenta) {
          return Promise.resolve({
            data: { user: null },
            error: { message: "Invalid login credentials" },
          })
        }

        sesion = { user: { id: cuenta.id, email: cuenta.email } }
        avisar()

        return Promise.resolve({ data: { user: sesion.user }, error: null })
      }),

      signOut: vi.fn(() => {
        sesion = null
        avisar()

        return Promise.resolve({ error: null })
      }),
    },
  }
}
