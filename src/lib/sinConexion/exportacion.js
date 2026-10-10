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

  Al importar, el archivo es una entrada externa: todo lo que declara
  (formato, algoritmo, iteraciones, sal, iv, datos) se valida ANTES de
  derivar la llave. Un archivo manipulado con, por ejemplo, mil millones de
  iteraciones congelaría el navegador; se rechaza sin calcular nada.
  Importar solo lee: nunca toca la cola del teléfono.
*/

export const FORMATO_DE_RESPALDO = "lunacell-rescate-v1"
export const ITERACIONES_DEL_RESPALDO = 310000

// Margen para subir las iteraciones en el futuro sin aceptar valores que congelen el navegador.
const ITERACIONES_MAXIMAS = 1000000
const LARGO_MINIMO = 10
const LARGO_DE_SAL = 16
const LARGO_DE_IV = 12
const LARGO_DE_ETIQUETA = 16
const TAMANO_MAXIMO = 20 * 1024 * 1024

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const codificar = new TextEncoder()
const decodificar = new TextDecoder()

export class ErrorDeRespaldo extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = "ErrorDeRespaldo"
  }
}

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

const iteracionesValidas = (n) => Number.isInteger(n) && n >= ITERACIONES_DEL_RESPALDO && n <= ITERACIONES_MAXIMAS

function campoBinario(archivo, campo, { largo, minimo = 1 }) {
  const valor = archivo[campo]

  if (typeof valor !== "string" || valor === "" || !BASE64.test(valor)) {
    throw new ErrorDeRespaldo(`El respaldo está dañado: el campo «${campo}» no es válido.`)
  }

  const bytes = deBase64(valor)

  if (largo ? bytes.length !== largo : bytes.length < minimo) {
    throw new ErrorDeRespaldo(`El respaldo está dañado: el campo «${campo}» no tiene el largo esperado.`)
  }

  return bytes
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

export async function exportarCifrado(ventas, frase, { iteraciones = ITERACIONES_DEL_RESPALDO } = {}) {
  if (typeof frase !== "string" || frase.length < LARGO_MINIMO) {
    throw new Error(`La frase del respaldo debe tener al menos ${LARGO_MINIMO} caracteres.`)
  }

  if (!iteracionesValidas(iteraciones)) {
    throw new ErrorDeRespaldo(`Las iteraciones deben estar entre ${ITERACIONES_DEL_RESPALDO} y ${ITERACIONES_MAXIMAS}.`)
  }

  const sal = crypto.getRandomValues(new Uint8Array(LARGO_DE_SAL))
  const iv = crypto.getRandomValues(new Uint8Array(LARGO_DE_IV))
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

// Valida todo lo que declara el archivo, sin ninguna operación criptográfica.
function leerArchivo(texto) {
  if (typeof texto !== "string") throw new ErrorDeRespaldo("El archivo no es un respaldo de LUNACELL.")
  if (texto.length > TAMANO_MAXIMO) throw new ErrorDeRespaldo("El archivo de respaldo es demasiado grande.")

  let archivo
  try {
    archivo = JSON.parse(texto)
  } catch {
    throw new ErrorDeRespaldo("El archivo no es un respaldo de LUNACELL.")
  }

  if (archivo === null || typeof archivo !== "object" || Array.isArray(archivo)) {
    throw new ErrorDeRespaldo("El archivo no es un respaldo de LUNACELL.")
  }

  if (archivo.formato !== FORMATO_DE_RESPALDO || archivo.algoritmo !== "AES-GCM" || archivo.derivacion !== "PBKDF2-SHA-256") {
    throw new ErrorDeRespaldo("El archivo no es un respaldo de LUNACELL compatible.")
  }

  if (!iteracionesValidas(archivo.iteraciones)) {
    throw new ErrorDeRespaldo("El respaldo está dañado: el número de iteraciones no es válido.")
  }

  return {
    iteraciones: archivo.iteraciones,
    sal: campoBinario(archivo, "sal", { largo: LARGO_DE_SAL }),
    iv: campoBinario(archivo, "iv", { largo: LARGO_DE_IV }),
    datos: campoBinario(archivo, "datos", { minimo: LARGO_DE_ETIQUETA + 1 }),
  }
}

export async function importarCifrado(texto, frase) {
  const { iteraciones, sal, iv, datos } = leerArchivo(texto)

  if (typeof frase !== "string" || frase === "") {
    throw new ErrorDeRespaldo("Escribe la frase del respaldo.")
  }

  let claro
  try {
    const llave = await llaveDe(frase, sal, iteraciones)
    claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, llave, datos)
  } catch {
    throw new ErrorDeRespaldo("No se pudo abrir el respaldo: la frase es incorrecta o el archivo fue alterado.")
  }

  let contenido
  try {
    contenido = JSON.parse(decodificar.decode(claro))
  } catch {
    contenido = null
  }

  if (!Array.isArray(contenido?.ventas)) {
    throw new ErrorDeRespaldo("El respaldo está dañado: no contiene una lista de ventas.")
  }

  return contenido.ventas
}
