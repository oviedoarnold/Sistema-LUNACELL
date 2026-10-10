/*
  El identificador del dispositivo: uno por instalación, guardado en el
  almacén local. Sirve para trazabilidad (qué teléfono registró la venta) y
  para la clave de idempotencia y el número provisional.

  No es una identidad de hardware: el navegador no deja leer el IMEI. Si se
  borran los datos del sitio, el teléfono recibe uno nuevo.
*/

const LLAVE = "dispositivo"

export async function idDelDispositivo(almacen, { generar = () => crypto.randomUUID() } = {}) {
  // Leer y crear en la misma transacción: dos pedidos simultáneos no crean dos.
  return almacen.transaccion(["meta"], "readwrite", async (t) => {
    const actual = await t.leer("meta", LLAVE)
    if (actual?.valor) return actual.valor

    const nuevo = generar()
    await t.poner("meta", { clave: LLAVE, valor: nuevo })

    return nuevo
  })
}

// Cuatro caracteres para el comprobante provisional, sin guiones.
export const codigoCorto = (id) => String(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()
