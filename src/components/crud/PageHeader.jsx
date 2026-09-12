/*
  Encabezado de una pantalla administrativa.

  El nombre del módulo ya lo escribe la barra superior, así que aquí no
  se repite: queda la frase que explica qué se está viendo y, a la
  derecha, la acción principal de la página cuando tiene una.

  No trae encabezado propio a propósito. Quien necesite titular algo
  dentro del contenido lo hace en su sección, no aquí.
*/
function PageHeader({ descripcion, children }) {
  return (
    <div className="crud-encabezado">
      {descripcion && <p className="crud-descripcion">{descripcion}</p>}

      {children && <div className="crud-acciones">{children}</div>}
    </div>
  )
}

export default PageHeader
