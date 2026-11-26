import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { MAXIMO_POR_CONSULTA, TAMANO_PAGINA, traerTraslados } from "../lib/api/traslados"
import { useAlVolverALaApp } from "./useAlVolverALaApp"

/*
  El historial de traslados, cargado para la pantalla que lo pide.

  No es un contexto, por la misma razón que useExistencias: lo usa una
  sola pantalla, y cargarlo para todo el que inicia sesión sería pagar por
  adelantado. Se recarga después de cada traslado, para que el que se
  acaba de registrar aparezca sin salir de la pantalla.

  Se recorre por páginas. Cambiar un filtro empieza otra vez desde la
  primera; "cargar más" agrega la siguiente debajo de las que ya están.

  Desde la recepción de traslados (0056) el estado de un traslado cambia
  en OTRO dispositivo: quien recibe confirma desde su teléfono mientras el
  remitente mira esta pantalla. LUNACELL no tiene tiempo real, así que la
  lista se refresca sola cada CADA_CUANTO mientras la pantalla está a la
  vista, y al volver a la app. El refresco es silencioso: vuelve a pedir
  las filas ya cargadas y las reemplaza sin vaciar la tabla, sin
  «Cargando» y sin perder los filtros ni las páginas.
*/
export const CADA_CUANTO = 30000

/*
  Cada estado recuerda para qué filtros se cargó (`clave`). Mientras la
  pantalla pide otros, lo cargado no se muestra: una lista de otros
  filtros presentada como la actual engañaría.
*/
const SIN_CARGAR = {
  clave: null,
  traslados: [],
  hayMas: false,
  siguiente: 0,
  error: "",
  cargandoMas: false,
  errorMas: false,
}

/*
  Una lista vieja presentada como actual es peor que ninguna: nadie la
  distingue. Si la primera página falla, se vacía y se dice por qué.
*/
const primeraPagina = (clave, pagina) => ({
  ...SIN_CARGAR,
  clave,
  traslados: pagina.traslados,
  hayMas: pagina.hayMas,
  siguiente: TAMANO_PAGINA,
})

const fallida = (clave, problema) => ({
  ...SIN_CARGAR,
  clave,
  error: problema.message || "No se pudo cargar el historial de traslados.",
})

/*
  La página siguiente se agrega debajo. Si alguien registró un traslado
  entre una página y otra, todo se corre un lugar y el último de la
  anterior vuelve a llegar: se descarta por id en vez de mostrarse dos
  veces. Nada se pierde, porque la página siguiente nunca empieza después
  de donde debía.
*/
const conPaginaSiguiente = (estado, pagina) => {
  const vistos = new Set(estado.traslados.map((t) => t.id))

  return {
    ...estado,
    traslados: [...estado.traslados, ...pagina.traslados.filter((t) => !vistos.has(t.id))],
    hayMas: pagina.hayMas,
    siguiente: estado.siguiente + TAMANO_PAGINA,
    cargandoMas: false,
    errorMas: false,
  }
}

/*
  Las filas ya cargadas, al día. Se vuelven a pedir de una vez (como mucho
  MAXIMO_POR_CONSULTA) y reemplazan a las de antes en el mismo orden. Una
  fila cargada que ya no entra en lo pedido (un traslado nuevo la empujó
  hacia abajo, o hay más cargadas que el máximo) se conserva al final:
  sigue en orden, porque es más antigua que todo lo pedido, y "cargar más"
  la descarta por id si vuelve a llegar. Nada se pierde ni se duplica, y
  las páginas cargadas (`siguiente`) no cambian.
*/
const refrescada = (estado, pagina, cantidad) => {
  const nuevos = new Set(pagina.traslados.map((t) => t.id))
  const cubreTodo = cantidad >= estado.siguiente

  return {
    ...estado,
    traslados: [...pagina.traslados, ...estado.traslados.filter((t) => !nuevos.has(t.id))],
    hayMas: cubreTodo ? pagina.hayMas : estado.hayMas,
    error: "",
  }
}

/*
  `activo` en falso no consulta: la pantalla lo usa cuando los filtros no
  forman un rango válido, para no pedirle a la base algo sin sentido.

  `pausado` detiene solo el refresco automático, por ejemplo mientras se
  confirma una recepción: esa operación recarga al terminar.

  `alRefrescar` se llama después de cada refresco automático, para que la
  pantalla ponga al día a la vez lo demás que depende de los traslados.
*/
export function useTraslados({ ubicacionId = "", desde = "", hasta = "", activo = true, pausado = false, alRefrescar } = {}) {
  const [estado, setEstado] = useState(SIN_CARGAR)

  const filtros = useMemo(() => ({ ubicacionId, desde, hasta }), [ubicacionId, desde, hasta])
  const clave = activo ? JSON.stringify([ubicacionId, desde, hasta]) : null

  // El estado se pinta en el render siguiente; dos clics seguidos no lo verían.
  const pidiendoMas = useRef(false)

  /*
    Solo vale la respuesta de la ÚLTIMA consulta pedida (carga, recarga,
    refresco o "cargar más"): una respuesta antigua que llega tarde se
    descarta y nunca devuelve a «Pendiente» algo ya recibido.
  */
  const ultima = useRef(0)
  const refrescando = useRef(false)

  // El reloj y el regreso a la app leen lo último sin volver a armarse.
  const actual = useRef(estado)
  const pausa = useRef(pausado)
  const avisar = useRef(alRefrescar)

  useEffect(() => {
    actual.current = estado
    pausa.current = pausado
    avisar.current = alRefrescar
  })

  // La respuesta puede llegar con la pantalla ya cerrada o con otros filtros.
  useEffect(() => {
    if (clave === null) return undefined

    let vigente = true
    const numero = ++ultima.current
    const esLaUltima = () => vigente && numero === ultima.current

    traerTraslados(filtros).then(
      (pagina) => esLaUltima() && setEstado(primeraPagina(clave, pagina)),
      (problema) => esLaUltima() && setEstado(fallida(clave, problema))
    )

    return () => {
      vigente = false
    }
  }, [clave, filtros])

  /*
    Vuelve a pedir las filas ya cargadas, sin vaciar ni mostrar «Cargando».
    Si falla, se conserva lo último que se supo. Sin nada cargado todavía
    (o tras un error en la primera carga) pide la primera página.
  */
  const actualizar = useCallback(async () => {
    if (clave === null) return

    const antes = actual.current
    const numero = ++ultima.current
    const esLaUltima = () => numero === ultima.current

    if (antes.clave !== clave || (antes.error && antes.traslados.length === 0)) {
      try {
        const pagina = await traerTraslados(filtros)

        if (esLaUltima()) setEstado(primeraPagina(clave, pagina))
      } catch (problema) {
        if (esLaUltima()) setEstado((ahora) => (ahora.clave === clave && ahora.traslados.length > 0 ? ahora : fallida(clave, problema)))
      }

      return
    }

    const cantidad = Math.min(Math.max(antes.siguiente, TAMANO_PAGINA), MAXIMO_POR_CONSULTA)

    try {
      const pagina = await traerTraslados(filtros, { cantidad })

      if (esLaUltima()) setEstado((ahora) => (ahora.clave === clave ? refrescada(ahora, pagina, cantidad) : ahora))
    } catch {
      // Sin conexión o un fallo pasajero: se conserva lo último que se supo.
    }
  }, [clave, filtros])

  // Después de una operación de esta pantalla: siempre, y sin perder las páginas.
  const recargar = useCallback(() => actualizar(), [actualizar])

  /*
    El refresco automático no se encola: si ya hay uno en curso, si se está
    cargando la página siguiente o si la pantalla está en pausa, se salta.
  */
  const refrescar = useCallback(async () => {
    if (clave === null || refrescando.current || pidiendoMas.current || pausa.current) return

    refrescando.current = true

    try {
      await actualizar()
    } finally {
      refrescando.current = false
    }

    avisar.current?.()
  }, [clave, actualizar])

  useEffect(() => {
    if (clave === null) return undefined

    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") void refrescar()
    }, CADA_CUANTO)

    return () => window.clearInterval(reloj)
  }, [clave, refrescar])

  useAlVolverALaApp(refrescar, { activo: clave !== null })

  /*
    Si falla, lo ya cargado se queda: perder lo que el usuario estaba
    leyendo por no poder traer lo siguiente sería castigarlo dos veces.
  */
  const cargarMas = useCallback(async () => {
    if (pidiendoMas.current || estado.clave !== clave || !estado.hayMas) return

    pidiendoMas.current = true
    // Un refresco que estuviera en camino ya no vale: no conoce esta página.
    ultima.current += 1
    setEstado((ahora) => ({ ...ahora, cargandoMas: true, errorMas: false }))

    try {
      const pagina = await traerTraslados(filtros, { inicio: estado.siguiente })
      setEstado((ahora) => (ahora.clave === clave ? conPaginaSiguiente(ahora, pagina) : ahora))
    } catch {
      setEstado((ahora) =>
        ahora.clave === clave ? { ...ahora, cargandoMas: false, errorMas: true } : ahora
      )
    } finally {
      pidiendoMas.current = false
    }
  }, [clave, filtros, estado.clave, estado.hayMas, estado.siguiente])

  const vigente = clave !== null && estado.clave === clave

  return {
    traslados: vigente ? estado.traslados : [],
    cargando: clave !== null && !vigente,
    error: vigente ? estado.error : "",
    hayMas: vigente && estado.hayMas,
    cargandoMas: vigente && estado.cargandoMas,
    errorMas: vigente && estado.errorMas,
    cargarMas,
    recargar,
    refrescar,
  }
}

export default useTraslados
