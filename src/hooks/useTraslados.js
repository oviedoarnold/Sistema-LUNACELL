import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { TAMANO_PAGINA, traerTraslados } from "../lib/api/traslados"

/*
  El historial de traslados, cargado para la pantalla que lo pide.

  No es un contexto, por la misma razón que useExistencias: lo usa una
  sola pantalla, y cargarlo para todo el que inicia sesión sería pagar por
  adelantado. Se recarga después de cada traslado, para que el que se
  acaba de registrar aparezca sin salir de la pantalla.

  Se recorre por páginas. Cambiar un filtro empieza otra vez desde la
  primera; "cargar más" agrega la siguiente debajo de las que ya están.
*/

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
  `activo` en falso no consulta: la pantalla lo usa cuando los filtros no
  forman un rango válido, para no pedirle a la base algo sin sentido.
*/
export function useTraslados({ ubicacionId = "", desde = "", hasta = "", activo = true } = {}) {
  const [estado, setEstado] = useState(SIN_CARGAR)

  const filtros = useMemo(() => ({ ubicacionId, desde, hasta }), [ubicacionId, desde, hasta])
  const clave = activo ? JSON.stringify([ubicacionId, desde, hasta]) : null

  // El estado se pinta en el render siguiente; dos clics seguidos no lo verían.
  const pidiendoMas = useRef(false)

  // La respuesta puede llegar con la pantalla ya cerrada o con otros filtros.
  useEffect(() => {
    if (clave === null) return undefined

    let vigente = true

    traerTraslados(filtros).then(
      (pagina) => vigente && setEstado(primeraPagina(clave, pagina)),
      (problema) => vigente && setEstado(fallida(clave, problema))
    )

    return () => {
      vigente = false
    }
  }, [clave, filtros])

  const recargar = useCallback(async () => {
    if (clave === null) return

    try {
      setEstado(primeraPagina(clave, await traerTraslados(filtros)))
    } catch (problema) {
      setEstado(fallida(clave, problema))
    }
  }, [clave, filtros])

  /*
    Si falla, lo ya cargado se queda: perder lo que el usuario estaba
    leyendo por no poder traer lo siguiente sería castigarlo dos veces.
  */
  const cargarMas = useCallback(async () => {
    if (pidiendoMas.current || estado.clave !== clave || !estado.hayMas) return

    pidiendoMas.current = true
    setEstado((actual) => ({ ...actual, cargandoMas: true, errorMas: false }))

    try {
      const pagina = await traerTraslados(filtros, { inicio: estado.siguiente })
      setEstado((actual) => (actual.clave === clave ? conPaginaSiguiente(actual, pagina) : actual))
    } catch {
      setEstado((actual) =>
        actual.clave === clave ? { ...actual, cargandoMas: false, errorMas: true } : actual
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
  }
}

export default useTraslados
