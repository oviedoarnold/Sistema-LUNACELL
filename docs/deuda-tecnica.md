# Deuda técnica

Lo que sabemos que está mal y decidimos no arreglar todavía, con el motivo.
La lista existe para que la decisión sea explícita: una duplicación
conocida y anotada es distinta de una que nadie vio.

Cuando algo de aquí se resuelva, se borra de la lista.

---

## El alta de cliente no espera a que el cliente exista

**Dónde:** `src/hooks/useClienteDelDocumento.js`, función `guardarNuevo`.
Afecta al punto de venta y a las cotizaciones, que comparten ese hook.

**Comportamiento actual.** `addClient` es `async`, pero no se espera:

```js
const nuevo = addClient({ ...formulario })  // devuelve una promesa
setModalAbierto(false)
if (nuevo) seleccionar(nuevo)               // la promesa siempre es truthy
```

Así que `seleccionar` recibe una **promesa**, no un cliente. El estado
`seleccionado` queda siendo esa promesa y `busqueda` se pone en
`undefined`, porque `cliente.name` no existe en una promesa.

**Riesgo.** Un objeto que aparenta ser un cliente pasa las comprobaciones
que solo miran si hay algo: `if (!selectedClient)` no salta, porque una
promesa es *truthy*. El `try/catch` alrededor tampoco sirve: una promesa
rechazada no lanza de forma síncrona, así que un fallo al guardar el
cliente pasa desapercibido y el diálogo de éxito se muestra igual.

**Impacto en ventas a crédito.** Es donde más duele. Al facturar, el
identificador sale de `selectedClient?.id`, que en una promesa es
`undefined` y viaja como `null`. La validación de pantalla no lo detiene
—ve un cliente— y la venta llega a la base, donde la rechaza la
restricción `credito_exige_cliente` de la migración 0001. El cajero
recibe un error al cobrar, después de haber capturado todo, y el mensaje
no explica que el problema fue el cliente que acaba de crear.

En una venta de contado el efecto es menor: se emite a nombre de
"Consumidor Final" en vez de al cliente recién dado de alta.

**Por qué no se corrigió aquí.** Se encontró durante el refactor de
`refactor/pos-quotes-compartidos`, cuyo alcance era no cambiar
comportamiento. Arreglarlo —`await`, hacer `guardarNuevo` asíncrona y
revisar quién la llama— **sí** cambia comportamiento y merece su propia
rama, con su validación manual: hay que comprobar el alta desde las dos
pantallas y una venta a crédito de punta a punta.

**Cuándo conviene hacerlo.** Antes que el inventario por ubicación. Esa
fase toca el punto de venta, y conviene que el camino del cliente esté
sano antes de moverle el suelo.

## Duplicación entre `lib/api/cotizaciones.js` y `lib/api/ventas.js`

**Tamaño:** 1 bloque, 24 líneas · 136 tokens (`cotizaciones.js` 18-41 ↔
`ventas.js` 19-42).

**Qué está duplicado.** La función `fallo()` —que registra el error y lanza
uno con mensaje para el usuario— y `aFechaLocal()`, copiadas literalmente.
`fallo()` está además una tercera vez en `catalogos.js`.

**Por qué duele.** Poco, hoy. El riesgo real es que el día que se quiera
cambiar cómo se reportan los errores de la API —mandarlos a un servicio de
registro, distinguir fallo de red de fallo de permisos— haya que acordarse
de tres sitios.

**Por qué no se arregló aún.** Es pequeña y no estaba en el informe de
SonarQube, que solo mide código nuevo. Meterla en la rama de duplicación
habría ampliado el alcance sin que nadie lo pidiera.

**Cuándo conviene hacerlo.** Es barato: un `lib/api/errores.js` con las dos
funciones y tres imports. Cabe en cualquier rama que ya toque la capa de
API.

---

## Cómo se midió

Con [`jscpd`](https://github.com/kucherenko/jscpd), al mismo umbral que usa
SonarQube para JavaScript (10 líneas, 100 tokens):

```bash
npx jscpd src --min-lines 10 --min-tokens 100 --format "javascript,jsx"
```

Al cerrar la rama `refactor/pos-quotes-compartidos` el proyecto quedó en
**1 clon · 23 líneas · 0,12%**, que es exactamente el caso de arriba.

La duplicación entre `POS.jsx` y `Quotes.jsx` —219 líneas— se resolvió en
esa rama extrayendo `useCarrito`, `useClienteDelDocumento` y
`ModalDeCliente`. Al unificarlas apareció lo que la duplicación escondía:
las cotizaciones llamaban a sus manejadores del carrito con `item.productId`,
un campo que una línea de carrito no tiene, así que el paso de cantidad y la
papelera no hacían nada. Es el argumento de por qué la duplicación importa
más allá del recuento de líneas.
