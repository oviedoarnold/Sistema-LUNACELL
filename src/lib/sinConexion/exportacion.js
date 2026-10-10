/*
  Archivo de emergencia: las ventas que no se pudieron sincronizar salen del
  teléfono en un archivo cifrado (por ejemplo, si el teléfono se va a
  reiniciar o se daña la conexión por días). Un administrador lo sube con
  rescatar_venta_sin_conexion; la pantalla de exportar y rescatar llega en
  OFF-1.3.

  - AES-GCM de 256 bits: cifra y además detecta cualquier alteración.
  - La llave sale de una frase con PBKDF2-SHA-256 (310 000 iteraciones,
    recomendación de OWASP) y una sal aleatoria por archivo.
  - La frase no se guarda en ningún lado: sin ella el archivo no se abre.
  - Exportar no borra nada de la cola: las ventas siguen pendientes en el
    teléfono hasta que el servidor confirme cada una.
*/

export const FORMATO_DE_RESPALDO = "lunacell-rescate-v1"

const ITERACIONES = 310000
const LARGO_MINIMO = 10

const codificar = new TextEncoder()
const decodificar = new TextDecoder()

function aBase64(bytes) {
  let texto = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(texto)
}

function deBase64(texto) {
  return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))
}

async function llaveDe(frase, sal, iteraciones) {
  const base = await crypto.subtle.importKey("raw", codificar.encode(frase), "PBKDF2", false, ["deriveKey"])

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function exportarCifrado(ventas, frase, { iteraciones = ITERACIONES } = {}) {
  if (typeof frase !== "string" || frase.length < LARGO_MINIMO) {
    throw new Error(`La frase del respaldo debe tener al menos ${LARGO_MINIMO} caracteres.`)
  }

  const sal = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const llave = await llaveDe(frase, sal, iteraciones)
  const contenido = codificar.encode(JSON.stringify({ ventas }))
  const datos = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, llave, contenido))

  return JSON.stringify({
    formato: FORMATO_DE_RESPALDO,
    algoritmo: "AES-GCM",
    derivacion: "PBKDF2-SHA-256",
    iteraciones,
    sal: aBase64(sal),
    iv: aBase64(iv),
    datos: aBase64(datos),
  })
}

export async function importarCifrado(texto, frase) {
  let archivo
  try {
    archivo = JSON.parse(texto)
  } catch {
    throw new Error("El archivo no es un respaldo de LUNACELL.")
  }

  if (archivo?.formato !== FORMATO_DE_RESPALDO) throw new Error("El archivo no es un respaldo de LUNACELL.")

  let claro
  try {
    const llave = await llaveDe(frase, deBase64(archivo.sal), archivo.iteraciones)
    claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deBase64(archivo.iv) }, llave, deBase64(archivo.datos))
  } catch {
    throw new Error("No se pudo abrir el respaldo: la frase es incorrecta o el archivo fue alterado.")
  }

  return JSON.parse(decodificar.decode(claro)).ventas
}
