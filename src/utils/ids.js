let contadorDeRespaldo = 0

function hexAleatorio(bytes) {
  const valores = new Uint8Array(bytes)

  crypto.getRandomValues(valores)

  return Array.from(valores, (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

/*
  Math.random no sirve para identificadores: es predecible y en un
  mostrador con varias cajas dos ventas simultáneas podrían chocar.
  Se usa la fuente criptográfica del navegador.
*/
export function sufijoAleatorio(bytes = 6) {
  if (typeof crypto === "undefined") {
    contadorDeRespaldo += 1

    return `${Date.now().toString(36)}${contadorDeRespaldo.toString(36)}`
  }

  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, bytes * 2)
  }

  return hexAleatorio(bytes)
}

export function crearId(prefijo) {
  return `${prefijo}-${Date.now().toString(36)}-${sufijoAleatorio()}`
}

/*
  Identifica un intento de operación, no un clic.

  El navegador la genera una vez por operación y la reenvía tal cual si hay
  que reintentar. La base tiene una restricción única sobre ella, así que
  el segundo intento choca en vez de emitir un documento nuevo: es lo único
  que protege cuando la factura se guardó pero la respuesta se perdió en el
  camino y el cajero, que no vio nada, vuelve a cobrar.
*/
export function claveDeIdempotencia() {
  return `${Date.now().toString(36)}-${sufijoAleatorio(8)}`
}
