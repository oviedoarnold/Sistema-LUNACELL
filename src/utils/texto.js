/*
  Normalización de texto para buscar.

  Quien busca un camión escribe "camion". Comparar tal cual deja fuera el
  resultado, y en un mostrador eso se lee como que el dato no existe.

  Se separa cada letra de su tilde con la forma NFD de Unicode y se
  quitan las marcas diacríticas, así que la comparación pasa a ser entre
  letras desnudas: "Camión" y "camion" coinciden, y también "CAMIÓN".

  La ñ se conserva. Es una letra del alfabeto, no una n con tilde: quien
  escribe "cañon" no está buscando "canon", y confundirlas devolvería
  resultados que nadie pidió.
*/

// Marcas diacríticas del bloque Unicode que NFD deja separadas.
const DIACRITICOS = /[̀-ͯ]/g

// Las dos formas de la ñ y la Ñ, que hay que proteger antes de descomponer.
const ENE = /ñ/g
const ENE_MAYUSCULA = /Ñ/g
const MARCA_ENE = ""

export function normalizarTexto(valor) {
  return String(valor ?? "")
    .replace(ENE, MARCA_ENE)
    .replace(ENE_MAYUSCULA, MARCA_ENE)
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(new RegExp(MARCA_ENE, "g"), "ñ")
    .toLowerCase()
}

/*
  Si el texto buscado aparece dentro del contenido, sin que las tildes ni
  las mayúsculas estorben. Un texto vacío coincide con todo, que es lo que
  espera una caja de búsqueda recién abierta.
*/
export function coincideBusqueda(contenido, textoBuscado) {
  return normalizarTexto(contenido).includes(
    normalizarTexto(textoBuscado).trim()
  )
}
