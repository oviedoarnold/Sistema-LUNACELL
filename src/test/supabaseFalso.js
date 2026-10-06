import { vi } from "vitest"

/*
  Doble de Supabase para las pruebas.

  Guarda las tablas en memoria y responde a las mismas cadenas de llamadas
  que usa la aplicación. Evita depender de la red y permite provocar casos
  que contra la base real serían difíciles de montar, como una cuenta
  válida que nadie invitó.
*/

/*
  Las fechas se comparan como instantes y no como texto: la base guarda
  "2026-10-01T10:00:00Z" y la consulta puede pedir "2026-10-01T06:00:00.000Z",
  que como texto no se ordenan bien entre sí.
*/
const comoComparable = (valor) => {
  if (typeof valor === "string" && valor.includes("T") && !Number.isNaN(Date.parse(valor))) {
    return Date.parse(valor)
  }

  return valor
}

const COMPARADORES = {
  eq: (a, b) => a === b,
  in: (a, b) => b.includes(a),
  gte: (a, b) => comoComparable(a) >= comoComparable(b),
  lt: (a, b) => comoComparable(a) < comoComparable(b),
  // `or` llega como lista de [columna, valor] y basta con que uno coincida.
  or: (fila, condiciones) => condiciones.some(([c, v]) => fila[c] === v),
}

function aplicarFiltros(filas, filtros) {
  return filas.filter((fila) =>
    filtros.every(([columna, valor, operador = "eq"]) =>
      operador === "or"
        ? COMPARADORES.or(fila, valor)
        : COMPARADORES[operador](fila[columna], valor)
    )
  )
}

/*
  Solo entiende lo que usa la aplicación: "col.eq.valor,col.eq.valor".
  Cualquier otra cosa es un error de la prueba, no un caso a simular.
*/
function leerOr(expresion) {
  return expresion.split(",").map((parte) => {
    const [columna, operador, ...resto] = parte.split(".")

    if (operador !== "eq") throw new Error(`or() no soporta "${parte}"`)

    return [columna, resto.join(".")]
  })
}

const compararPor = (orden) => (a, b) => {
  for (const [columna, ascendente] of orden) {
    const diferencia = String(a[columna]).localeCompare(String(b[columna]))

    if (diferencia !== 0) return ascendente ? diferencia : -diferencia
  }

  return 0
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
  traslados: "traslado_id",
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

  /*
    La existencia por ubicación, igual que en la base: parte de las
    UBICACIONES activas y no de las celdas, así que una ubicación sin celda
    para un producto sale con 0.

    Lo que este doble NO reproduce es la visibilidad: en PostgreSQL la vista
    filtra por usuario_ve_ubicacion(), y eso se prueba contra el motor real
    en pruebas-sql, donde se puede autenticar a alguien. Aquí las filas que
    se siembran SON las que el usuario vería, que es precisamente lo que la
    pantalla tiene que respetar sin añadir ni quitar.
  */
  existencias_por_ubicacion: (datos) => {
    const filas = []

    for (const u of datos.ubicaciones || []) {
      if (u.activa === false) continue

      for (const p of datos.productos || []) {
        if (p.activo === false) continue
        if (p.empresa_id !== u.empresa_id) continue

        const celda = (datos.inventario_ubicacion || []).find(
          (c) => c.ubicacion_id === u.id && c.producto_id === p.id
        )

        filas.push({
          empresa_id: u.empresa_id,
          ubicacion_id: u.id,
          ubicacion: u.nombre,
          ubicacion_tipo: u.tipo,
          producto_id: p.id,
          codigo: p.codigo,
          producto: p.nombre,
          cantidad: celda ? Number(celda.cantidad) : 0,
        })
      }
    }

    return filas
  },
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
  ubicaciones: "creada_en",
}

/*
  Otras columnas con default en el esquema. Misma razón que las fechas: la
  aplicación no las envía porque la base las rellena, y sin esto la fila
  recién insertada vuelve sin ellas. Se agregan solo las que alguna prueba
  necesita; declararlas todas obligaría a mantener aquí una copia del
  esquema.
*/
const VALORES_POR_OMISION = {
  ubicaciones: { activa: true },
}

function valoresPorOmision(tabla) {
  const columna = COLUMNA_DE_FECHA[tabla]

  return {
    ...(columna ? { [columna]: new Date().toISOString() } : {}),
    ...(VALORES_POR_OMISION[tabla] || {}),
  }
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
      orden: [],
      saltar: 0,
      tope: null,
    }

    const ejecutar = () => {
      const vista = VISTAS[nombreTabla]
      const filas = vista ? vista(datos) : datos[nombreTabla] || []

      if (estado.accion === "select") {
        const encontradas = aplicarFiltros(filas, estado.filtros).map((f) =>
          proyectar(f, estado.columnas, datos, nombreTabla)
        )

        if (estado.orden.length > 0) {
          encontradas.sort(compararPor(estado.orden))
        }

        return estado.tope === null
          ? encontradas.slice(estado.saltar)
          : encontradas.slice(estado.saltar, estado.saltar + estado.tope)
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
      in(columna, valores) {
        estado.filtros.push([columna, valores, "in"])
        return constructor
      },
      gte(columna, valor) {
        estado.filtros.push([columna, valor, "gte"])
        return constructor
      },
      lt(columna, valor) {
        estado.filtros.push([columna, valor, "lt"])
        return constructor
      },
      or(expresion) {
        estado.filtros.push([null, leerOr(expresion), "or"])
        return constructor
      },
      // Como PostgREST: se ordena por cada columna en el orden en que se pide.
      order(columna, { ascending = true } = {}) {
        estado.orden.push([columna, ascending])
        return constructor
      },
      limit(cantidad) {
        estado.tope = cantidad
        return constructor
      },
      // Los dos extremos incluidos, igual que range() de supabase-js.
      range(desde, hasta) {
        estado.saltar = desde
        estado.tope = hasta - desde + 1
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
    La venta por ubicación, como registrar_venta_ubicacion() desde la 0017:
    la ubicación sale del usuario de la sesión, los importes del catálogo y
    de la empresa, y el número del contador que corresponde. Escribe la
    venta, su detalle, la salida en el libro y el descuento de la celda, o
    nada.

    No reproduce candados ni RLS: eso se prueba contra el motor real en
    pruebas-sql. Sí reproduce los rechazos con sus códigos, porque son lo
    que la pantalla tiene que traducir.
  */
  const rechazo = (code, message) => ({ data: null, error: { code, message } })

  const redondear = (n) => Math.round(Number(n) * 100) / 100

  const soloDigitos = (valor, ancho) =>
    String(valor ?? "").replace(/\D/g, "").padStart(ancho, "0").slice(-ancho)

  const huellaDe = (forma, cliente, renglones) =>
    `${forma}|${cliente || "-"}|` +
    renglones
      .map((r) => `${r.producto_id}x${r.cantidad}`)
      .sort()
      .join(",")

  const venderEnUbicacion = ({
    p_items,
    p_forma_pago,
    p_cliente_id = null,
    p_nombre_cliente = null,
    p_rtn_comprador = "",
    p_fecha_vencimiento = null,
    p_nota = "",
    p_clave_idempotencia = null,
  }) => {
    const usuario = (datos.usuarios || []).find(
      (u) => u.auth_id === sesion?.user?.id && u.activo !== false
    )

    if (!usuario) {
      return rechazo("42501", "Solo un usuario activo de una empresa puede registrar ventas")
    }

    if (!usuario.ubicacion_id) {
      return rechazo(
        "LV001",
        "No tienes una ubicación operativa asignada. Pide que te asignen desde dónde trabajas antes de facturar."
      )
    }

    const empresa = (datos.empresas || []).find((e) => e.id === usuario.empresa_id)
    const ubicacion = (datos.ubicaciones || []).find(
      (u) => u.id === usuario.ubicacion_id && u.empresa_id === usuario.empresa_id
    )

    if (!empresa || !ubicacion) {
      return rechazo("42501", "La ubicación operativa no pertenece a tu empresa")
    }

    if (ubicacion.activa === false) {
      return rechazo("LV002", `La ubicación «${ubicacion.nombre}» está desactivada y no puede facturar.`)
    }

    if (ubicacion.vende === false) {
      return rechazo("LV008", `La ubicación «${ubicacion.nombre}» no está habilitada para vender.`)
    }

    const forma = p_forma_pago || "contado"

    if (!Array.isArray(p_items) || p_items.length === 0) {
      return rechazo("LV003", "La venta no tiene renglones")
    }

    if (!["contado", "credito"].includes(forma)) {
      return rechazo("LV003", `Forma de pago desconocida: ${forma}`)
    }

    if (forma === "credito" && !p_cliente_id) {
      return rechazo("LV004", "Para una venta a crédito debes seleccionar un cliente registrado")
    }

    // Mismo producto en dos renglones: se suman antes de comprobar nada.
    const agrupado = new Map()

    for (const item of p_items) {
      agrupado.set(
        item.producto_id,
        (agrupado.get(item.producto_id) || 0) + Number(item.cantidad)
      )
    }

    const pedido = [...agrupado].map(([producto_id, cantidad]) => ({ producto_id, cantidad }))

    if (pedido.some((r) => !(r.cantidad > 0))) {
      return rechazo("LV003", "La cantidad de cada producto debe ser mayor que cero")
    }

    if (p_clave_idempotencia) {
      const previa = (datos.ventas || []).find(
        (v) => v.empresa_id === empresa.id && v.clave_idempotencia === p_clave_idempotencia
      )

      if (previa) {
        const renglonesPrevios = (datos.detalle_venta || []).filter(
          (d) => d.venta_id === previa.id
        )

        if (
          huellaDe(previa.forma_pago, previa.cliente_id, renglonesPrevios) !==
          huellaDe(forma, p_cliente_id, pedido)
        ) {
          return rechazo(
            "LV005",
            `La clave ${p_clave_idempotencia} ya se usó para una venta distinta de esta empresa`
          )
        }

        return {
          data: {
            venta_id: previa.id,
            numero_factura: previa.numero_factura,
            correlativo: previa.correlativo,
            ubicacion_id: previa.ubicacion_id,
            es_fiscal: Boolean(previa.es_fiscal),
            subtotal: previa.subtotal,
            isv: previa.isv,
            total: previa.total,
            repetida: true,
          },
          error: null,
        }
      }
    }

    const celdas = datos.inventario_ubicacion || []
    let subtotal = 0

    for (const renglon of pedido) {
      const producto = (datos.productos || []).find(
        (p) => p.id === renglon.producto_id && p.empresa_id === empresa.id && p.activo !== false
      )

      if (!producto) {
        return rechazo("LV006", "Uno de los productos no existe o está inactivo")
      }

      const celda = celdas.find(
        (c) => c.ubicacion_id === ubicacion.id && c.producto_id === renglon.producto_id
      )
      const disponible = celda ? Number(celda.cantidad) : 0

      if (disponible < renglon.cantidad) {
        return rechazo(
          "LV007",
          `No hay suficiente «${producto.nombre}» en ${ubicacion.nombre}: hay ${disponible}, se piden ${renglon.cantidad}`
        )
      }

      renglon.producto = producto
      subtotal += redondear(Number(producto.precio) * renglon.cantidad)
    }

    const tasa = empresa.tasa_isv ?? 15
    subtotal = redondear(subtotal)
    const isv = redondear((subtotal * tasa) / 100)
    const total = redondear(subtotal + isv)

    const fiscal =
      ubicacion.emite_fiscal === true &&
      String(empresa.cai || "").trim() !== "" &&
      Number(empresa.rango_hasta || 0) > 0 &&
      Boolean(empresa.fecha_limite_emision)

    // Cada documento consume su propio contador, y solo si la venta entra.
    const columna = fiscal ? "proximo_correlativo_factura" : "proximo_correlativo_interno"
    const correlativo = Number(empresa[columna] ?? 1)

    empresa[columna] = correlativo + 1

    const numero = fiscal
      ? [
          soloDigitos(empresa.establecimiento, 3),
          soloDigitos(empresa.punto_emision, 3),
          soloDigitos(empresa.tipo_documento, 2),
          soloDigitos(correlativo, 8),
        ].join("-")
      : `VTA-${String(correlativo).padStart(6, "0")}`

    const credito = forma === "credito"

    const venta = {
      id: siguienteId(),
      ...valoresPorOmision("ventas"),
      empresa_id: empresa.id,
      cliente_id: p_cliente_id,
      usuario_id: usuario.id,
      ubicacion_id: ubicacion.id,
      numero_factura: numero,
      correlativo,
      es_fiscal: fiscal,
      nombre_cliente: String(p_nombre_cliente || "").trim() || "Consumidor Final",
      rtn_comprador: p_rtn_comprador || "",
      subtotal,
      isv,
      tasa_isv: tasa,
      total,
      forma_pago: forma,
      fecha_vencimiento: credito ? p_fecha_vencimiento : null,
      estado: credito ? "pendiente" : "pagada",
      cai_emision: fiscal ? empresa.cai || "" : "",
      rango_desde_emision: fiscal ? empresa.rango_desde : null,
      rango_hasta_emision: fiscal ? empresa.rango_hasta : null,
      fecha_limite_emision_emision: fiscal ? empresa.fecha_limite_emision : null,
      nota: p_nota || "",
      clave_idempotencia: p_clave_idempotencia,
    }

    datos.ventas = [...(datos.ventas || []), venta]

    for (const renglon of pedido) {
      const { producto, producto_id, cantidad } = renglon

      datos.detalle_venta = [
        ...(datos.detalle_venta || []),
        {
          id: siguienteId(),
          empresa_id: empresa.id,
          venta_id: venta.id,
          producto_id,
          nombre: producto.nombre,
          codigo: producto.codigo || "",
          cantidad,
          precio: Number(producto.precio),
          subtotal: redondear(Number(producto.precio) * cantidad),
        },
      ]

      datos.inventario_ubicacion = (datos.inventario_ubicacion || []).map((c) =>
        c.ubicacion_id === ubicacion.id && c.producto_id === producto_id
          ? { ...c, cantidad: Number(c.cantidad) - cantidad }
          : c
      )

      datos.movimientos_inventario = [
        ...(datos.movimientos_inventario || []),
        {
          id: siguienteId(),
          ...valoresPorOmision("movimientos_inventario"),
          empresa_id: empresa.id,
          producto_id,
          usuario_id: usuario.id,
          venta_id: venta.id,
          ubicacion_id: ubicacion.id,
          tipo: "salida",
          cantidad: -cantidad,
          motivo: "Venta",
        },
      ]
    }

    return {
      data: {
        venta_id: venta.id,
        numero_factura: numero,
        correlativo,
        ubicacion_id: ubicacion.id,
        es_fiscal: fiscal,
        subtotal,
        isv,
        total,
        repetida: false,
      },
      error: null,
    }
  }

  /*
    El traslado entre ubicaciones, como registrar_traslado() de la 0020:
    descuenta el origen, suma al destino, guarda cabecera y detalle y anota
    la salida y la entrada en el libro, o no hace nada.

    Reproduce los rechazos que la pantalla tiene que traducir. Los permisos
    y los candados se prueban contra el motor real en pruebas-sql.
  */
  const trasladarEntreUbicaciones = ({
    p_origen,
    p_destino,
    p_items,
    p_nota = "",
    p_clave_idempotencia = null,
  }) => {
    const usuario = (datos.usuarios || []).find(
      (u) => u.auth_id === sesion?.user?.id && u.activo !== false
    )

    if (!usuario) {
      return rechazo("42501", "Solo un usuario activo de una empresa puede trasladar inventario")
    }

    if (!p_origen || !p_destino || !Array.isArray(p_items) || p_items.length === 0) {
      return rechazo("LT003", "Los renglones del traslado no son válidos")
    }

    if (p_origen === p_destino) {
      return rechazo("LT001", "El origen y el destino del traslado son la misma ubicación")
    }

    const agrupado = new Map()

    for (const item of p_items) {
      agrupado.set(item.producto_id, (agrupado.get(item.producto_id) || 0) + Number(item.cantidad))
    }

    const pedido = [...agrupado]
      .map(([producto_id, cantidad]) => ({ producto_id, cantidad }))
      .sort((a, b) => String(a.producto_id).localeCompare(String(b.producto_id)))

    const huella = `${p_origen}>${p_destino}|` +
      pedido.map((r) => `${r.producto_id}x${r.cantidad}`).join(",")

    if (p_clave_idempotencia) {
      const previo = (datos.traslados || []).find(
        (t) => t.clave_idempotencia === p_clave_idempotencia
      )

      if (previo) {
        if (previo.huella !== huella) {
          return rechazo("LT006", `La clave ${p_clave_idempotencia} ya se usó para un traslado distinto de esta empresa`)
        }

        return {
          data: { traslado_id: previo.id, origen_id: previo.origen_id, destino_id: previo.destino_id, estado: "aplicado", items: pedido, repetida: true },
          error: null,
        }
      }
    }

    const nombreDe = (id) => (datos.ubicaciones || []).find((u) => u.id === id)?.nombre || id
    const celda = (ubicacion, producto) =>
      (datos.inventario_ubicacion || []).find(
        (c) => c.ubicacion_id === ubicacion && c.producto_id === producto
      )

    for (const r of pedido) {
      const disponible = Number(celda(p_origen, r.producto_id)?.cantidad ?? 0)

      if (disponible < r.cantidad) {
        const producto = (datos.productos || []).find((p) => p.id === r.producto_id)

        return rechazo(
          "LT005",
          `No hay suficiente «${producto?.nombre || r.producto_id}» en ${nombreDe(p_origen)}: hay ${disponible}, se trasladan ${r.cantidad}`
        )
      }
    }

    const traslado = {
      id: siguienteId(),
      empresa_id: usuario.empresa_id,
      origen_id: p_origen,
      destino_id: p_destino,
      usuario_id: usuario.id,
      estado: "aplicado",
      nota: String(p_nota || "").trim(),
      clave_idempotencia: p_clave_idempotencia,
      creado_en: new Date().toISOString(),
      huella,
    }

    datos.traslados = [...(datos.traslados || []), traslado]

    for (const r of pedido) {
      datos.traslado_detalle = [
        ...(datos.traslado_detalle || []),
        { traslado_id: traslado.id, empresa_id: usuario.empresa_id, ...r },
      ]

      if (!celda(p_destino, r.producto_id)) {
        datos.inventario_ubicacion = [
          ...(datos.inventario_ubicacion || []),
          { empresa_id: usuario.empresa_id, ubicacion_id: p_destino, producto_id: r.producto_id, cantidad: 0 },
        ]
      }

      datos.inventario_ubicacion = datos.inventario_ubicacion.map((c) => {
        if (c.producto_id !== r.producto_id) return c
        if (c.ubicacion_id === p_origen) return { ...c, cantidad: Number(c.cantidad) - r.cantidad }
        if (c.ubicacion_id === p_destino) return { ...c, cantidad: Number(c.cantidad) + r.cantidad }
        return c
      })

      const movimiento = (ubicacion_id, tipo, cantidad, motivo) => ({
        id: siguienteId(),
        ...valoresPorOmision("movimientos_inventario"),
        empresa_id: usuario.empresa_id,
        producto_id: r.producto_id,
        usuario_id: usuario.id,
        venta_id: null,
        traslado_id: traslado.id,
        ubicacion_id,
        tipo,
        cantidad,
        motivo,
      })

      datos.movimientos_inventario = [
        ...(datos.movimientos_inventario || []),
        movimiento(p_origen, "traslado_salida", -r.cantidad, `Traslado a ${nombreDe(p_destino)}`),
        movimiento(p_destino, "traslado_entrada", r.cantidad, `Traslado desde ${nombreDe(p_origen)}`),
      ]
    }

    return {
      data: { traslado_id: traslado.id, origen_id: p_origen, destino_id: p_destino, estado: "aplicado", items: pedido, repetida: false },
      error: null,
    }
  }

  /*
    Entradas y ajustes por ubicación, como registrar_movimiento_ubicacion():
    mueve la celda y escribe el movimiento con su ubicación, y rechaza con
    LI003 lo que dejaría la celda en negativo.

    No reproduce permisos, empresa ni candados: eso se prueba contra el
    motor real en pruebas-sql. Aquí basta con que la pantalla vea lo mismo
    que vería después de la llamada.
  */
  const moverInventario = ({
    p_producto_id,
    p_ubicacion_id,
    p_tipo,
    p_cantidad,
    p_motivo,
  }) => {
    const celdas = datos.inventario_ubicacion || []
    const celda = celdas.find(
      (c) => c.ubicacion_id === p_ubicacion_id && c.producto_id === p_producto_id
    )

    const anterior = celda ? Number(celda.cantidad) : 0
    const nueva = anterior + Number(p_cantidad)

    if (nueva < 0) {
      return {
        data: null,
        error: {
          code: "LI003",
          message: `No hay suficiente existencia: hay ${anterior}, el ajuste quita ${Math.abs(p_cantidad)}`,
        },
      }
    }

    const empresaId =
      (datos.productos || []).find((p) => p.id === p_producto_id)?.empresa_id ??
      (datos.empresas || [])[0]?.id ??
      null

    datos.inventario_ubicacion = celda
      ? celdas.map((c) => (c === celda ? { ...c, cantidad: nueva } : c))
      : [
          ...celdas,
          {
            empresa_id: empresaId,
            ubicacion_id: p_ubicacion_id,
            producto_id: p_producto_id,
            cantidad: nueva,
          },
        ]

    const movimiento = {
      id: siguienteId(),
      ...valoresPorOmision("movimientos_inventario"),
      empresa_id: empresaId,
      producto_id: p_producto_id,
      usuario_id: null,
      venta_id: null,
      ubicacion_id: p_ubicacion_id,
      tipo: p_tipo,
      cantidad: Number(p_cantidad),
      motivo: p_motivo || "",
    }

    datos.movimientos_inventario = [
      ...(datos.movimientos_inventario || []),
      movimiento,
    ]

    return {
      data: {
        movimiento_id: movimiento.id,
        producto_id: p_producto_id,
        ubicacion_id: p_ubicacion_id,
        tipo: p_tipo,
        cantidad: Number(p_cantidad),
        existencia_anterior: anterior,
        existencia_nueva: nueva,
      },
      error: null,
    }
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

      if (nombre === "registrar_venta_ubicacion") {
        const falla = fallaDe(nombre, "rpc")

        return Promise.resolve(
          falla ? { data: null, error: falla } : venderEnUbicacion(argumentos)
        )
      }

      if (nombre === "registrar_traslado") {
        const falla = fallaDe(nombre, "rpc")

        return Promise.resolve(
          falla ? { data: null, error: falla } : trasladarEntreUbicaciones(argumentos)
        )
      }

      if (nombre === "registrar_movimiento_ubicacion") {
        const falla = fallaDe(nombre, "rpc")

        return Promise.resolve(
          falla ? { data: null, error: falla } : moverInventario(argumentos)
        )
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
