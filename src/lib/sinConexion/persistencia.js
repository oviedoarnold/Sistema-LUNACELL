/*
  Pide al navegador que no borre el almacén local cuando le falte espacio.

  Chrome y Android lo conceden a una PWA instalada o muy usada; Safari no
  lo garantiza. Se pide al habilitar la venta sin conexión y el resultado
  se muestra, porque un «denegado» significa que el respaldo cifrado es más
  importante todavía. Nunca lanza.
*/
export async function pedirAlmacenamientoPersistente(storage = globalThis.navigator?.storage) {
  if (typeof storage?.persist !== "function") return "no_disponible"

  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) return "concedido"

    return (await storage.persist()) ? "concedido" : "denegado"
  } catch {
    return "no_disponible"
  }
}
