/*
  Un servidor simulado con las reglas de sincronizar_venta_sin_conexion que
  importan al teléfono (la RPC real se prueba contra PostgreSQL en
  pruebas-sql/ventas-sin-conexion.test.mjs):

  - idempotencia por clave: reenviar la misma venta devuelve la misma;
  - la existencia de la ubicación es UNA para todos los dispositivos: el
    que llega tarde a la última unidad queda en conciliación;
  - la venta de otro usuario es OF002.

  Se le pueden inyectar fallos para probar la red caída, la sesión vencida
  o una respuesta que se pierde después de registrar.
*/
export function crearServidorFalso({ existencias = {}, sesion = "auth-vendedor" } = {}) {
  const stock = { ...existencias }
  const porClave = new Map()
  const fallos = []
  let numero = 0
  const recibidas = []

  const servidor = {
    sesion,
    recibidas,
    stock,
    registradas: () => [...porClave.values()].filter((r) => r.estado === "registrada"),
    enConciliacion: () => [...porClave.values()].filter((r) => r.estado === "en_conciliacion"),

    // Un fallo para la próxima llamada: { tipo: "red" | "sesion" | "OF003" | "temporal" | "respuesta_perdida" }.
    fallarProxima(fallo) {
      fallos.push(fallo)
    },

    async enviar(venta) {
      recibidas.push(venta.clave)
      const fallo = fallos.shift()

      if (fallo?.tipo === "red") throw new TypeError("Failed to fetch")
      if (fallo?.tipo === "sesion") return { data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 }
      if (fallo?.tipo === "temporal") return { data: null, error: { code: "40001", message: "could not serialize" }, status: 500 }
      if (fallo?.tipo === "OF003") return { data: null, error: { code: "OF003", message: "La clave ya se usó" }, status: 400 }
      if (venta.usuarioAuth !== servidor.sesion) return { data: null, error: { code: "OF002", message: "otro usuario" }, status: 400 }

      const previa = porClave.get(venta.clave)
      if (previa) {
        return {
          data: previa.estado === "registrada"
            ? { estado: "ya_registrada", venta_id: previa.venta_id, numero_factura: previa.numero_factura }
            : { estado: "ya_en_conciliacion", conciliacion_id: previa.conciliacion_id, motivo: previa.motivo },
          error: null,
          status: 200,
        }
      }

      const alcanza = venta.renglones.every((r) => (stock[r.producto_id] ?? 0) >= r.cantidad)
      let registro

      if (alcanza) {
        venta.renglones.forEach((r) => (stock[r.producto_id] -= r.cantidad))
        numero += 1
        registro = { estado: "registrada", venta_id: `venta-${numero}`, numero_factura: `VTA-${String(numero).padStart(6, "0")}` }
      } else {
        registro = { estado: "en_conciliacion", conciliacion_id: `conc-${porClave.size + 1}`, motivo: "existencia-insuficiente" }
      }

      porClave.set(venta.clave, registro)

      // El servidor registró, pero la respuesta no llegó al teléfono.
      if (fallo?.tipo === "respuesta_perdida") throw new TypeError("Failed to fetch")

      return { data: { ...registro }, error: null, status: 200 }
    },
  }

  return servidor
}
