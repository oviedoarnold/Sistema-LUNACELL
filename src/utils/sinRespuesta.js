/*
  Lo que se dice cuando el servidor no respondió a una operación: pudo haberse
  registrado o no. «Cancelar» haría pensar que se deshizo, así que el botón
  dice lo que de verdad hace —cerrar sin volver a intentarlo— y el aviso pide
  comprobar antes de repetirla. Reintentar sigue siendo seguro: cada pantalla
  reusa su clave de idempotencia.
*/
export const CERRAR_SIN_REINTENTAR = "Cerrar sin reintentar"

export const COMPROBAR_ANTES_DE_REPETIR = "La operación podría haberse registrado. Comprueba el historial antes de repetirla."

// El texto del diálogo: lo que explica cada pantalla y, al final, el aviso común.
export const textoSinRespuesta = (explicacion) => `${explicacion} ${COMPROBAR_ANTES_DE_REPETIR}`
