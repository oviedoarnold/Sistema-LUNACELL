import { useCallback, useEffect, useRef, useState } from "react"

import { PERMISSIONS, ROLES } from "../context/permissions"
import { traerPorRecibir } from "../lib/api/traslados"
import { useAlVolverALaApp } from "./useAlVolverALaApp"
import { useAuth } from "./useAuth"

/*
  Los traslados que el usuario puede recibir (0056): el contador del menú,
  el aviso del POS y la sección «Por recibir» de Traslados.

  Como los avisos de pedidos: LUNACELL no tiene tiempo real, así que se
  consulta al abrir, al volver a la aplicación y cada minuto mientras está a
  la vista. Quien envía, confirma o reporta avisa con
  EVENTO_TRASLADOS_CAMBIARON para no esperar al minuto. Si una consulta
  falla, se queda lo último que se supo.

  Solo consulta quien puede recibir: el administrador, o quien tiene
  ubicación operativa y permiso de inventario. Nunca el contador, ni sin
  conexión.
*/
export const EVENTO_TRASLADOS_CAMBIARON = "lunacell:traslados-cambiaron"
export const CADA_CUANTO = 60000

export const avisarCambioDeTraslados = () => window.dispatchEvent(new Event(EVENTO_TRASLADOS_CAMBIARON))

const NINGUNO = []

// Si este usuario puede, en principio, recibir traslados.
export function puedeRecibirTraslados(user, hasPermission) {
  if (!user || user.sinConexion || user.role === ROLES.CONTADOR) return false
  if (user.role === ROLES.ADMIN) return true

  return Boolean(user.locationId) && (hasPermission(PERMISSIONS.INVENTORY_OWN) || hasPermission(PERMISSIONS.INVENTORY_ALL))
}

/*
  Si este usuario puede recibir ESTE traslado, con las mismas reglas que la
  base: el administrador siempre; los demás, en su ubicación y si no lo
  enviaron ellos.
*/
export function puedeRecibirEste(traslado, user, hasPermission) {
  if (!puedeRecibirTraslados(user, hasPermission) || !traslado) return false
  if (user.role === ROLES.ADMIN) return true

  return String(traslado.destinationId) === String(user.locationId) && String(traslado.userId || "") !== String(user.id)
}

/*
  Si el administrador confirmaría como confirmación administrativa: el
  destino no es su ubicación operativa, o lo envió él. La base lo decide
  igual; aquí solo sirve para pedirle la observación antes.
*/
export const esConfirmacionAdministrativa = (traslado, user) =>
  user?.role === ROLES.ADMIN &&
  (String(user.locationId || "") !== String(traslado.destinationId) || String(traslado.userId || "") === String(user.id))

export function useTrasladosPorRecibir() {
  const { user, hasPermission } = useAuth()
  const activo = puedeRecibirTraslados(user, hasPermission)
  const esAdmin = user?.role === ROLES.ADMIN
  const ubicacionId = user?.locationId || ""
  const usuarioId = user?.id || ""
  const clave = `${esAdmin}|${ubicacionId}|${usuarioId}`

  const [estado, setEstado] = useState({ clave: "", traslados: NINGUNO })
  const vigente = useRef(true)

  /*
    Solo vale la respuesta de la última consulta pedida: una antigua que
    llega tarde no devuelve un traslado ya recibido a «por recibir». El
    reloj no encola consultas: si hay una en curso, se salta. Un aviso de
    cambio (EVENTO_TRASLADOS_CAMBIARON) o `recargar` sí consultan siempre.
  */
  const ultima = useRef(0)
  const enCurso = useRef(0)

  const consultar = useCallback(async () => {
    const numero = ++ultima.current
    enCurso.current += 1

    try {
      const traslados = await traerPorRecibir({ esAdmin, ubicacionId, usuarioId })

      if (vigente.current && numero === ultima.current) setEstado({ clave, traslados })
    } catch {
      // Sin conexión o un fallo pasajero: se conserva lo último.
    } finally {
      enCurso.current -= 1
    }
  }, [esAdmin, ubicacionId, usuarioId, clave])

  const consultarSiHaceFalta = useCallback(() => {
    if (enCurso.current === 0) void consultar()
  }, [consultar])

  useEffect(() => {
    vigente.current = true

    if (!activo) return undefined

    const numero = ++ultima.current

    traerPorRecibir({ esAdmin, ubicacionId, usuarioId }).then(
      (traslados) => vigente.current && numero === ultima.current && setEstado({ clave, traslados }),
      () => {}
    )

    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") consultarSiHaceFalta()
    }, CADA_CUANTO)

    window.addEventListener(EVENTO_TRASLADOS_CAMBIARON, consultar)

    return () => {
      vigente.current = false
      window.clearInterval(reloj)
      window.removeEventListener(EVENTO_TRASLADOS_CAMBIARON, consultar)
    }
  }, [activo, consultar, consultarSiHaceFalta, esAdmin, ubicacionId, usuarioId, clave])

  useAlVolverALaApp(consultarSiHaceFalta, { activo })

  const traslados = activo && estado.clave === clave ? estado.traslados : NINGUNO

  return { traslados, cantidad: traslados.length, recargar: consultar }
}
