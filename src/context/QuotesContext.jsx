import { useCallback, useContext, useEffect, useMemo, useState } from "react"

import { ProductContext, QuotesContext } from "./contexts"
import { useAuth } from "../hooks/useAuth"

import {
  traerCotizaciones,
  conFormaDeApp,
  crearCotizacion,
  eliminarCotizacion,
  marcarComoVendida,
} from "../lib/api/cotizaciones"

function QuotesProvider({ children }) {
  const { user } = useAuth()
  const { company } = useContext(ProductContext)

  const [filas, setFilas] = useState([])
  const [empresaCargada, setEmpresaCargada] = useState(null)
  const [error, setError] = useState("")

  const empresaId = user?.empresa_id
  const usuarioId = user?.id

  const cargando = Boolean(empresaId) && empresaCargada !== empresaId

  useEffect(() => {
    if (!empresaId) {
      return
    }

    let vigente = true

    traerCotizaciones()
      .then((lista) => {
        if (!vigente) return

        setFilas(lista)
        setError("")
      })
      .catch((problema) => {
        if (vigente) setError(problema.message)
      })
      .finally(() => {
        if (vigente) setEmpresaCargada(empresaId)
      })

    return () => {
      vigente = false
    }
  }, [empresaId])

  /*
    Los datos de la ferretería son encabezado de la cotización impresa, no
    parte de la cotización. Aplicarlos aquí evita recargar el historial
    entero cada vez que cambian, que era donde se perdía una cotización
    recién guardada.
  */
  const quotes = useMemo(
    () => conFormaDeApp(filas, company),
    [filas, company]
  )

  const refrescarCotizaciones = useCallback(async () => {
    setFilas(await traerCotizaciones())
  }, [])

  /*
    El número lo entrega la base junto con el registro, así que la
    cotización guardada se vuelve a leer en vez de armarse aquí.
  */
  const addQuote = useCallback(
    async (cotizacion, clave = null) => {
      const id = await crearCotizacion(cotizacion, { empresaId, usuarioId, clave })
      const lista = await traerCotizaciones()

      setFilas(lista)

      return conFormaDeApp(lista, company).find((q) => q.id === id)
    },
    [empresaId, usuarioId, company]
  )

  const deleteQuote = useCallback(
    async (id) => {
      await eliminarCotizacion(id)
      await refrescarCotizaciones()
    },
    [refrescarCotizaciones]
  )

  const linkQuoteToSale = useCallback(
    async (quoteId, saleId) => {
      await marcarComoVendida(quoteId, saleId)
      await refrescarCotizaciones()
    },
    [refrescarCotizaciones]
  )

  const getQuoteById = useCallback(
    (id) => quotes.find((q) => String(q.id) === String(id)) || null,
    [quotes]
  )

  const value = useMemo(
    () => ({
      quotes,
      cargando,
      error,

      addQuote,
      deleteQuote,
      linkQuoteToSale,
      getQuoteById,
      refrescarCotizaciones,
    }),
    [
      quotes,
      cargando,
      error,
      addQuote,
      deleteQuote,
      linkQuoteToSale,
      getQuoteById,
      refrescarCotizaciones,
    ]
  )

  return (
    <QuotesContext.Provider value={value}>{children}</QuotesContext.Provider>
  )
}

export default QuotesProvider
