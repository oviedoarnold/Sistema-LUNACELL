/*
  Estado vacío.

  Un icono discreto, qué pasa y, si se puede hacer algo al respecto, el
  botón para hacerlo. Nada de ilustraciones grandes ni de mensajes
  técnicos: quien llega aquí necesita saber si le falta cargar datos o
  si su búsqueda no encontró nada.
*/
function EmptyState({ Icono, titulo, descripcion, children }) {
  return (
    <div className="empty-state">
      {Icono && <Icono aria-hidden="true" />}

      <strong>{titulo}</strong>

      {descripcion && <span className="empty-state-texto">{descripcion}</span>}

      {children && <div className="empty-state-accion">{children}</div>}
    </div>
  )
}

export default EmptyState
