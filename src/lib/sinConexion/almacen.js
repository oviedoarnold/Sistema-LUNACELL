/*
  El almacén local del modo sin conexión: una base IndexedDB por navegador.

  Guarda lo que no se puede perder si se cierra la pestaña o se reinicia el
  teléfono: las ventas cobradas que el servidor todavía no confirmó, la copia
  local (catálogo, existencias, clientes) y unos pocos datos del dispositivo.

  Tres almacenes:
  - `meta`: pares clave/valor del dispositivo (identificador, secuencia del
    número provisional, candado entre pestañas);
  - `ventas`: la cola, con la clave de idempotencia como llave;
  - `copias`: una copia por empresa, usuario y ubicación.

  Las versiones del esquema solo AGREGAN: una actualización de la
  aplicación nunca borra el almacén de ventas.
*/

export const NOMBRE_DEL_ALMACEN = "lunacell-sin-conexion"
export const VERSION_DEL_ALMACEN = 1

function pedir(solicitud) {
  return new Promise((resolver, rechazar) => {
    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error)
  })
}

function actualizarEsquema(base, versionAnterior) {
  if (versionAnterior < 1) {
    base.createObjectStore("meta", { keyPath: "clave" })

    const ventas = base.createObjectStore("ventas", { keyPath: "clave" })
    ventas.createIndex("por_estado", "estado")
    ventas.createIndex("por_usuario", "usuarioAuth")

    base.createObjectStore("copias", { keyPath: "id" })
  }
}

export function abrirAlmacen({ indexedDB = globalThis.indexedDB, nombre = NOMBRE_DEL_ALMACEN } = {}) {
  if (!indexedDB) {
    return Promise.reject(new Error("Este navegador no permite guardar ventas sin conexión (no hay IndexedDB)."))
  }

  return new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(nombre, VERSION_DEL_ALMACEN)

    solicitud.onupgradeneeded = (evento) => actualizarEsquema(solicitud.result, evento.oldVersion)
    solicitud.onerror = () => rechazar(solicitud.error)
    solicitud.onblocked = () => rechazar(new Error("Cierra las otras pestañas de LUNACELL para actualizar el almacén local."))
    solicitud.onsuccess = () => resolver(envolver(solicitud.result))
  })
}

/*
  Una transacción con ayudas que devuelven promesas. Si `trabajo` lanza, la
  transacción se aborta y no queda nada escrito; si termina, se espera a que
  IndexedDB confirme antes de resolver.
*/
function envolver(base) {
  const transaccion = (almacenes, modo, trabajo) =>
    new Promise((resolver, rechazar) => {
      const tx = base.transaction(almacenes, modo)
      let resultado
      let fallo

      const ayudas = {
        leer: (almacen, llave) => pedir(tx.objectStore(almacen).get(llave)),
        todos: (almacen) => pedir(tx.objectStore(almacen).getAll()),
        porIndice: (almacen, indice, valor) => pedir(tx.objectStore(almacen).index(indice).getAll(valor)),
        poner: (almacen, valor) => pedir(tx.objectStore(almacen).put(valor)),
        agregar: (almacen, valor) => pedir(tx.objectStore(almacen).add(valor)),
        borrar: (almacen, llave) => pedir(tx.objectStore(almacen).delete(llave)),
      }

      tx.oncomplete = () => (fallo ? rechazar(fallo) : resolver(resultado))
      tx.onabort = () => rechazar(fallo || tx.error || new Error("La transacción local se canceló."))
      tx.onerror = () => {}

      Promise.resolve()
        .then(() => trabajo(ayudas))
        .then(
          (valor) => {
            resultado = valor
          },
          (error) => {
            fallo = error
            try {
              tx.abort()
            } catch {
              // Ya terminó: el rechazo llega por oncomplete con `fallo`.
            }
          }
        )
    })

  return {
    version: base.version,
    almacenes: () => [...base.objectStoreNames],
    transaccion,
    leer: (almacen, llave) => transaccion([almacen], "readonly", (t) => t.leer(almacen, llave)),
    todos: (almacen) => transaccion([almacen], "readonly", (t) => t.todos(almacen)),
    cerrar: () => base.close(),
  }
}
