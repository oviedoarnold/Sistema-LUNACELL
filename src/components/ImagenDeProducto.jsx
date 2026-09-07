import { useEffect, useMemo, useRef, useState } from "react"

import { revisarImagen } from "../lib/api/catalogos"

/*
  Cuando un producto no tiene foto no se deja el hueco vacío: se muestra su
  inicial. Un catálogo con recuadros en blanco se lee peor que uno donde
  cada renglón tiene algo, y el cajero ubica el producto por la forma de la
  fila aunque la ferretería nunca suba una sola imagen.
*/
export function MiniaturaDeProducto({ url, nombre, tamano = 40 }) {
  const [fallo, setFallo] = useState(false)

  const estilo = { width: tamano, height: tamano }

  if (!url || fallo) {
    return (
      <div className="miniatura miniatura-vacia" style={estilo} aria-hidden="true">
        {String(nombre || "?").trim().charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <img
      className="miniatura"
      style={estilo}
      src={url}
      alt={nombre}
      loading="lazy"
      onError={() => setFallo(true)}
    />
  )
}

/*
  Deja elegir la foto y la muestra antes de guardar. La imagen elegida no
  se sube todavía: se sube al guardar el producto, para que cancelar el
  formulario no deje archivos sueltos en el almacenamiento.
*/
export function SelectorDeImagen({ urlGuardada, archivo, onElegir, onQuitar, nombre }) {
  const entrada = useRef(null)
  const [error, setError] = useState("")

  const urlDelArchivo = useMemo(
    () => (archivo ? URL.createObjectURL(archivo) : ""),
    [archivo]
  )

  useEffect(() => {
    if (!urlDelArchivo) return

    return () => URL.revokeObjectURL(urlDelArchivo)
  }, [urlDelArchivo])

  const urlMostrada = urlDelArchivo || urlGuardada
  const hayImagen = Boolean(urlMostrada)

  const elegir = (evento) => {
    const elegido = evento.target.files?.[0]

    if (!elegido) return

    try {
      revisarImagen(elegido)
      setError("")
      onElegir(elegido)
    } catch (problema) {
      setError(problema.message)
      onElegir(null)
    }

    // Permite volver a elegir el mismo archivo después de un error.
    evento.target.value = ""
  }

  const quitar = () => {
    setError("")
    onQuitar()
  }

  return (
    <div className="selector-imagen">
      <MiniaturaDeProducto url={urlMostrada} nombre={nombre} tamano={92} />

      <div className="selector-imagen-acciones">
        <input
          ref={entrada}
          id="products-imagen"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={elegir}
          style={{ display: "none" }}
        />

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => entrada.current?.click()}
        >
          {hayImagen ? "Cambiar imagen" : "Subir imagen"}
        </button>

        {hayImagen && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={quitar}
          >
            Quitar
          </button>
        )}

        {error ? (
          <span className="selector-imagen-error">{error}</span>
        ) : (
          <span className="selector-imagen-ayuda">JPG, PNG o WebP · máximo 2 MB</span>
        )}
      </div>
    </div>
  )
}
