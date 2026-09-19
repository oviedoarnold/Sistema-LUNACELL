/*
  Normalización de texto para buscar.

  Quien busca un camión escribe "camion". Comparar tal cual deja fuera el
  resultado, y en un mostrador eso se lee como que el dato no existe.

  El texto se descompone con la forma NFD de Unicode, que separa cada
  letra de su tilde, y después se quitan las marcas diacríticas. La
  comparación pasa a ser entre letras desnudas: "Camión", "camion" y
  "CAMIÓN" coinciden.

  La ñ se recompone antes de ese barrido. Es una letra del alfabeto, no
  una n con tilde: quien escribe "cañon" no busca "canon", y confundirlas
  devolvería resultados que nadie pidió. Se recompone después de
  descomponer para que dé igual cómo venga escrita en origen, ya sea un
  solo carácter o una n seguida de tilde combinante.
*/

// La tilde combinante, que es lo que NFD deja suelto detrás de la n.
const TILDE_SOBRE_ENE = /ñ/gi

// El resto de marcas diacríticas del bloque de combinantes de Unicode.
const DIACRITICOS = /[̀-ͯ]/g

export function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(TILDE_SOBRE_ENE, "ñ")
    .replace(DIACRITICOS, "")
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
