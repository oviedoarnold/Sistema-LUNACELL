# Deuda técnica

Lo que sabemos que está mal y decidimos no arreglar todavía, con el motivo.
La lista existe para que la decisión sea explícita: una duplicación
conocida y anotada es distinta de una que nadie vio.

Cuando algo de aquí se resuelva, se borra de la lista.

---

## SonarCloud no recibe la cobertura de las pruebas

**Estado.** Todo el lado local está hecho y funciona: `npm run coverage`
genera `coverage/lcov.info` con el proveedor v8, el CI lo ejecuta en cada
push y lo publica como artefacto, y `sonar-project.properties` ya apunta a
ese archivo con `sonar.javascript.lcov.reportPaths`. Lo que falta no está
en este repositorio.

**Baseline real, medido.** 80,6 % de sentencias · 74,44 % de ramas ·
79,78 % de funciones · 82,54 % de líneas, sobre 63 archivos. SonarCloud, en
cambio, no tiene ningún dato de cobertura: la métrica sale vacía.

**Por qué.** El proyecto usa **Automatic Analysis**
(`sonar.autoscan.enabled = true`, comprobado contra la API). Ese modo
analiza el repositorio en el servidor de SonarCloud y no tiene acceso a los
artefactos de build, así que no puede leer un lcov. Solo el escáner lo sube,
y el escáner no corre: no existe el secreto `SONAR_TOKEN`.

**Qué haría falta, y por qué no se hizo aquí.** Los dos modos de análisis
son excluyentes. Cambiar exige, en este orden:

1. crear el secreto `SONAR_TOKEN` en el repositorio —es una credencial, la
   genera el propietario en SonarCloud—;
2. desactivar Automatic Analysis en la configuración del proyecto en
   SonarCloud;
3. devolver al workflow el paso del escáner.

Entre el 2 y el 3 el proyecto se queda **sin ningún análisis**, y el análisis
es parte obligatoria de la puerta de calidad. Es un cambio deliberado del
propietario, con una credencial de por medio, no algo que deba ocurrir de
paso en una tarea de saneamiento.

**Qué revela el baseline.** Los archivos sin cubrir que más pesan son los
que ya están excluidos de cobertura a propósito —plantillas de impresión y
generación de PDF— más `App.jsx`, que es solo el árbol de proveedores. No
hace falta una campaña de pruebas para que la integración funcione: lo que
falta es la tubería, no las pruebas.

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

Al cerrar la rama `refactor/pos-quotes-compartidos` el proyecto quedó en
**1 clon · 23 líneas · 0,12%**, que es exactamente el caso de arriba.

La duplicación entre `POS.jsx` y `Quotes.jsx` —219 líneas— se resolvió en
esa rama extrayendo `useCarrito`, `useClienteDelDocumento` y
`ModalDeCliente`. Al unificarlas apareció lo que la duplicación escondía:
las cotizaciones llamaban a sus manejadores del carrito con `item.productId`,
un campo que una línea de carrito no tiene, así que el paso de cantidad y la
papelera no hacían nada. Es el argumento de por qué la duplicación importa
más allá del recuento de líneas.
