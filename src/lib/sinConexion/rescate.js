/*
  Rescate administrativo: un administrador sube las ventas de un archivo de
  emergencia con rescatar_venta_sin_conexion (0027). Esa RPC nunca crea
  una venta: deja cada una en conciliación, marcada como rescate.

  Lo que se cuida aquí:
  - Cada venta se valida antes de enviarla; una mal formada no viaja.
  - Una venta repetida en el archivo, o ya rescatada en esta sesión, no se
    vuelve a enviar. Si de todos modos llegara dos veces, la RPC es
    idempotente por clave y responde «ya_en_conciliacion».
  - «rechazado» llega como respuesta normal, sin excepción (la RPC lo
    audita y no lanza), y se trata como lo que es: un rechazo.
  - Una respuesta desconocida nunca se toma como éxito.
  - Sin permiso (no es administrador) o sin red se detiene: las demás
    fallarían igual. Las que no se enviaron quedan marcadas «no_enviada».
*/
import { clasificarError } from "./clasificar"

const CLAVE = /^off-[A-Za-z0-9-]{8,150}$/
const DISPOSITIVO = /^[A-Za-z0-9-]{4,64}$/

const textoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== ""
const numeroFinito = (valor) => typeof valor === "number" && Number.isFinite(valor)

function renglonValido(r) {
  return (
    r !== null &&
    typeof r === "object" &&
    textoNoVacio(r.producto_id) &&
    Number.isInteger(r.cantidad) &&
    r.cantidad >= 1 &&
    numeroFinito(r.precio_unitario) &&
    r.precio_unitario >= 0
  )
}

// Null si la venta se puede enviar; si no, por qué no.
export function validarVentaDeRespaldo(venta) {
  if (venta === null || typeof venta !== "object" || Array.isArray(venta)) return "No es una venta."
  if (typeof venta.clave !== "string" || !CLAVE.test(venta.clave)) return "La clave de la venta no es válida."
  if (typeof venta.dispositivo !== "string" || !DISPOSITIVO.test(venta.dispositivo)) {
    return "El identificador del dispositivo no es válido."
  }
  if (!textoNoVacio(venta.usuarioAuth)) return "Falta el vendedor."
  if (!textoNoVacio(venta.ubicacionId)) return "Falta la ubicación."
  if (!textoNoVacio(venta.numeroProvisional) || venta.numeroProvisional.length > 60) {
    return "El número provisional no es válido."
  }
  if (typeof venta.registradaEn !== "string" || Number.isNaN(Date.parse(venta.registradaEn))) {
    return "La fecha de la venta no es válida."
  }
  if (!Array.isArray(venta.renglones) || venta.renglones.length === 0 || venta.renglones.length > 200) {
    return "La venta no tiene renglones."
  }
  if (!venta.renglones.every(renglonValido)) return "Un renglón de la venta no es válido."
  if (!numeroFinito(venta.totalCobrado) || venta.totalCobrado < 0) return "El total cobrado no es válido."
  if (!numeroFinito(venta.tasaIsv) || venta.tasaIsv < 0 || venta.tasaIsv > 100) return "La tasa de impuesto no es válida."
  if (!["contado", "credito"].includes(venta.formaPago)) return "La forma de pago no es válida."
  if (venta.formaPago === "credito" && !textoNoVacio(venta.clienteId)) return "Una venta a crédito necesita un cliente."

  return null
}

const ACEPTADAS = new Set(["en_conciliacion", "ya_en_conciliacion", "ya_registrada"])

function aResultado(venta, respuesta) {
  const base = { clave: venta.clave, numeroProvisional: venta.numeroProvisional, venta }

  if (respuesta.error) {
    return {
      ...base,
      resultado: "error",
      clase: clasificarError(respuesta.error, respuesta.status),
      codigo: respuesta.error.code || null,
      detalle: respuesta.error.message || "Error desconocido del servidor.",
    }
  }

  const data = respuesta.data || {}

  if (ACEPTADAS.has(data.estado)) {
    return {
      ...base,
      resultado: data.estado,
      conciliacionId: data.conciliacion_id ?? null,
      ventaId: data.venta_id ?? null,
      numeroFactura: data.numero_factura ?? null,
      detalle: data.motivo || "",
    }
  }

  if (data.estado === "rechazado") {
    return { ...base, resultado: "rechazado", codigo: data.codigo ?? null, detalle: data.detalle || "El servidor rechazó la venta." }
  }

  return { ...base, resultado: "error", clase: "temporal", codigo: null, detalle: "Respuesta inesperada del servidor." }
}

export async function rescatarVentas(ventas, { enviar, lote, alAvanzar, yaRescatadas = new Set() }) {
  const resultados = []
  const vistas = new Set()
  let detenidoPor = null

  for (const venta of ventas) {
    let resultado

    if (detenidoPor) {
      resultado = { clave: venta?.clave ?? null, numeroProvisional: venta?.numeroProvisional ?? null, venta, resultado: "no_enviada" }
    } else {
      const invalida = validarVentaDeRespaldo(venta)

      if (invalida) {
        resultado = { clave: venta?.clave ?? null, numeroProvisional: venta?.numeroProvisional ?? null, venta, resultado: "invalida", detalle: invalida }
      } else if (vistas.has(venta.clave)) {
        resultado = { clave: venta.clave, numeroProvisional: venta.numeroProvisional, venta, resultado: "repetida_en_archivo" }
      } else if (yaRescatadas.has(venta.clave)) {
        resultado = { clave: venta.clave, numeroProvisional: venta.numeroProvisional, venta, resultado: "ya_rescatada" }
      } else {
        let respuesta
        try {
          respuesta = await enviar(venta, lote)
        } catch (error) {
          respuesta = { data: null, error, status: 0 }
        }

        resultado = aResultado(venta, respuesta)

        if (resultado.clase === "red" || resultado.clase === "sesion") detenidoPor = resultado.clase
      }

      if (venta?.clave) vistas.add(venta.clave)
    }

    resultados.push(resultado)
    alAvanzar?.(resultado, resultados.length, ventas.length)
  }

  return { resultados, detenidoPor }
}

export function resumenDeRescate(resultados) {
  const cuenta = (pred) => resultados.filter(pred).length

  return {
    aceptadas: cuenta((r) => ACEPTADAS.has(r.resultado) || r.resultado === "ya_rescatada"),
    rechazadas: cuenta((r) => r.resultado === "rechazado"),
    invalidas: cuenta((r) => r.resultado === "invalida" || r.resultado === "repetida_en_archivo"),
    errores: cuenta((r) => r.resultado === "error"),
    sinEnviar: cuenta((r) => r.resultado === "no_enviada"),
  }
}
