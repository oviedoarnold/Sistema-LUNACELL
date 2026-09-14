import { FaSearch } from "react-icons/fa"

/*
  Caja de búsqueda de las pantallas administrativas.

  Es solo presentación: recibe el texto y avisa de los cambios. Qué
  campos se filtran y cómo es asunto de cada página, que para eso conoce
  sus propios datos.

  La lupa es decorativa; quien lee con lector de pantalla se guía por la
  etiqueta, de ahí que sea obligatoria en la práctica.
*/
function SearchInput({ value, onChange, placeholder, etiqueta }) {
  return (
    <div className="search-box">
      <FaSearch aria-hidden="true" />

      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={etiqueta || placeholder}
      />
    </div>
  )
}

export default SearchInput
