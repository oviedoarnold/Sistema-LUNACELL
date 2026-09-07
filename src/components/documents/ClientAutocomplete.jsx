import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

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

  return (
    <div ref={rootRef}>
      <div className="field">
        <label htmlFor="clientautocomplete-opcional">
          {label}

          {!required && (
            <span
              style={{
                fontWeight: 400,
              }}
            >
              {" "}
              (opcional)
            </span>
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

          {open && (
            <div className="client-dropdown">
              {matches.map((client) => (
                <div
                  key={client.id}
                  className="client-dropdown-item"
                  onMouseDown={(event) =>
                    event.preventDefault()
                  }
                  onClick={() =>
                    handleSelectClient(client)
                  }
                >
                  <b>{client.name}</b>

                  <div className="sub">
                    {[
                      client.phone,
                      client.address,
                      client.rtn
                        ? `RTN: ${client.rtn}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}

              {matches.length === 0 &&
                value.trim() && (
                  <div
                    className="client-dropdown-item"
                    style={{
                      cursor: "default",
                    }}
                  >
                    <span className="sub">
                      No se encontraron clientes registrados.
                    </span>
                  </div>
                )}

              {onCreateNew && (
                <div
                  className="client-dropdown-add"
                  onMouseDown={(event) =>
                    event.preventDefault()
                  }
                  onClick={handleCreateClient}
                >
                  ＋ Registrar cliente nuevo
                </div>
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
            title="Quitar cliente"
          >
            ×
          </button>
        </div>
      )}
      
    </div>
  )
  
}

export default ClientAutocomplete
