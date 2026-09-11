/*
  Tarjeta de indicador del panel.

  Conserva la clase .stat-card porque el CSS y las pruebas del panel la
  usan para localizar cada cifra; lo que cambia es lo de dentro.

  El icono es decorativo: lo que hay que leer es la etiqueta y el valor,
  asi que se oculta a los lectores de pantalla.
*/
function StatCard({ etiqueta, valor, detalle, Icono, tono = "", children }) {
  return (
    <article className={tono ? `stat-card ${tono}` : "stat-card"}>
      <header className="stat-card-cabecera">
        <span className="label">{etiqueta}</span>

        {Icono && (
          <span className="stat-card-icono" aria-hidden="true">
            <Icono />
          </span>
        )}
      </header>

      <p className="value">{valor}</p>

      {detalle && <p className="sub-val">{detalle}</p>}

      {children}
    </article>
  )
}

export default StatCard
