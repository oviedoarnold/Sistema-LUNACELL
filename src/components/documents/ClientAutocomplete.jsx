import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { FaPlus, FaTimes } from "react-icons/fa"

function ClientAutocomplete({
  clients = [],
  label = "Cliente",
  placeholder = "Busca un cliente...",
  value = "",
  selectedClient = null,
  required = false,
  allowFreeText = true,
  onChange,
  onSelect,
  onClear,
  onCreateNew,
}) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase()

    const filteredClients = query
      ? clients.filter((client) => {
          const searchableText = [
            client.name,
            client.phone,
            client.rtn,
            client.address,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()

          return searchableText.includes(query)
        })
      : clients

    return filteredClients.slice(0, 6)
  }, [clients, value])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    )

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      )
    }
  }, [])

  const handleInputChange = (event) => {
    const newValue = event.target.value

    onChange?.(newValue)
    setOpen(true)
  }

  const handleSelectClient = (client) => {
    onSelect?.(client)
    setOpen(false)
  }

  const handleClearClient = () => {
    onClear?.()
    setOpen(false)
  }

  const handleCreateClient = () => {
    setOpen(false)
    onCreateNew?.()
  }

  /*
    Escape cierra la lista, como en cualquier desplegable.

    Se detiene ahí a propósito: si este campo vive dentro de una ventana
    modal, la misma tecla la cerraría también, y quien solo quería salir de
    la lista perdería el formulario entero. Cuando la lista está cerrada el
    evento sigue su camino y la ventana se cierra como siempre.
  */
  const handleKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} onKeyDown={handleKeyDown}>
      <div className="field">
        <label htmlFor="clientautocomplete-opcional">
          {label}

          {!required && (
            <span className="etiqueta-suave"> (opcional)</span>
          )}
        </label>

        <div className="client-autocomplete">
          <input id="clientautocomplete-opcional"
            type="text"
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onChange={handleInputChange}
          />

          {/*
            Cada opción es un <button> de verdad y no un <div> que escucha
            clics. Un div no recibe el foco al tabular, no responde a Enter
            ni a espacio y no se anuncia como algo pulsable: quien no usa
            ratón no podía elegir un cliente.

            Se usa el elemento nativo y no un role inventado porque el
            botón ya trae el foco, el teclado y el anuncio sin que haya que
            escribirlos, y no hay forma de equivocarse al implementarlos.

            El onMouseDown que evita el comportamiento por omisión se
            queda: sin él, el campo pierde el foco antes de que el clic
            llegue a contarse y la lista se cierra sin elegir nada.
          */}
          {open && (
            <div className="client-dropdown">
              {matches.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  className="client-dropdown-item"
                  onMouseDown={(event) =>
                    event.preventDefault()
                  }
                  onClick={() =>
                    handleSelectClient(client)
                  }
                >
                  <b>{client.name}</b>

                  <span className="sub">
                    {[
                      client.phone,
                      client.address,
                      client.rtn
                        ? `RTN: ${client.rtn}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}

              {/*
                Esto no es una opción: es un aviso. No lleva botón porque
                no hay nada que pulsar, y ponerle uno dejaría al teclado
                deteniéndose en algo que no hace nada.
              */}
              {matches.length === 0 &&
                value.trim() && (
                  <p className="client-dropdown-vacio">
                    No se encontraron clientes registrados.
                  </p>
                )}

              {onCreateNew && (
                <button
                  type="button"
                  className="client-dropdown-add"
                  onMouseDown={(event) =>
                    event.preventDefault()
                  }
                  onClick={handleCreateClient}
                >
                  <FaPlus aria-hidden="true" />
                  Registrar cliente nuevo
                </button>
              )}
            </div>
          )}
        </div>

        {!allowFreeText &&
          !selectedClient &&
          value.trim() && (
            <span className="hint">
              Selecciona un cliente de la lista para continuar.
            </span>
          )}
      </div>

      {selectedClient && (
        <div className="selected-client-card">
          <div>
            <b>{selectedClient.name}</b>

            <span>
              {[
                selectedClient.phone,
                selectedClient.address,
                selectedClient.rtn
                  ? `RTN: ${selectedClient.rtn}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          <button
            type="button"
            className="selected-client-clear"
            onClick={handleClearClient}
            aria-label={`Quitar a ${selectedClient.name}`}
            title="Quitar cliente"
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>
      )}
      
    </div>
  )
  
}

export default ClientAutocomplete
