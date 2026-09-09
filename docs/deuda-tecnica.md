# Deuda técnica

Lo que sabemos que está mal y decidimos no arreglar todavía, con el motivo.
La lista existe para que la decisión sea explícita: una duplicación
conocida y anotada es distinta de una que nadie vio.

Cuando algo de aquí se resuelva, se borra de la lista.

---

## Duplicación entre `POS.jsx` y `Quotes.jsx`

**Tamaño:** 4 bloques, ~219 líneas duplicadas.

| Bloque | POS.jsx | Quotes.jsx |
|---|---|---|
| Alta de cliente y su modal | 129-172 · 281-349 · 1322-1372 | 193-236 · 334-425 · 1604-1655 |
| Carrito: agregar, cambiar cantidad, quitar | 179-233 | 233-286 |

**Qué está duplicado.** Las dos pantallas resuelven lo mismo dos veces:
`clientForm`, `saveNewClient`, `handleSelectClient`, `openNewClientModal`,
`addToCart`, `changeQuantity`, `removeFromCart`, y unas 150 líneas de JSX
del modal de cliente prácticamente idénticas.

**Por qué duele.** No es el recuento de líneas: es que cualquier cambio en
el alta de cliente hay que hacerlo dos veces, y olvidar una no rompe nada
visible. La factura y la cotización empiezan a comportarse distinto sin que
nadie lo note.

**Por qué no se arregló aún.** Vive dentro de dos componentes de 1.412 y
1.687 líneas. Hacerlo bien es extraer `<ModalDeCliente>` y un hook
`useCarrito`, y eso toca las dos pantallas que facturan: es una fase propia,
con su validación manual, no algo que se cuele en una rama de higiene.

**Cuándo conviene hacerlo.** Antes de tocar el POS para el inventario por
ubicación. Esa fase va a modificar justo el carrito y la validación de
existencias, y hacerlo sobre código duplicado significa hacerlo dos veces.

---

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

Al cerrar la rama `refactor/sonarqube-duplicacion` el proyecto quedó en
**5 clones · 238 líneas · 1,18%**, que son exactamente los dos casos de
arriba. Ninguno aparece en el informe de *New Code* de SonarQube porque
ambos son código heredado.
