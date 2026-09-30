# Deuda técnica

Lo que sabemos que está mal y decidimos no arreglar todavía, con el motivo.
La lista existe para que la decisión sea explícita: una duplicación
conocida y anotada es distinta de una que nadie vio.

Cuando algo de aquí se resuelva, se borra de la lista.

---

## Promesas sin gestionar su rechazo (`S9383`) — destino: **E.3**

**Cuatro hallazgos**, todos de la misma regla: *«Promises must be awaited,
end with a call to `.catch`, end with a call to `.then` with a rejection
handler or be explicitly marked as ignored with the `void` operator»*.

| Archivo | Línea | Qué es |
|---|---|---|
| `public/sw.js` | 140 | `cache.put()` dentro del `.then` de un `fetch` |
| `public/sw.js` | 159 | `cache.put("/index.html", …)` sin esperar |
| `src/context/AuthContext.jsx` | 115 | el callback de `onAuthStateChange` llama a `aplicarSesion` |
| `src/context/AuthContext.jsx` | 177 | `traerUsuariosDeLaEmpresa().then(…)` sin `.catch` |

**Por qué importa.** Una promesa que se rechaza sin manejador no rompe la
pantalla, pero se pierde en silencio. En los dos casos del service worker
significa que un fallo al escribir en caché no se entera nadie; en los dos
de `AuthContext`, que un error al aplicar la sesión o al traer los usuarios
de la empresa desaparece sin rastro. Es justo el tipo de fallo que después
cuesta reproducir.

**Por qué no se corrigió en E.2.** `AuthContext` y el service worker están
fuera del alcance que `CLAUDE.md` permite tocar sin autorización: uno es
autenticación y el otro decide qué se sirve sin conexión. Además no es un
cambio cosmético — hay que decidir **qué se hace** con cada error, no solo
callar el aviso: registrarlo, reintentar o ignorarlo explícitamente con
`void` son decisiones distintas y hay que tomarlas una por una.

**Qué pide la corrección.** Para cada uno: decidir el tratamiento del
rechazo y, donde afecte a la sesión o a los usuarios, una prueba que cubra
el camino de error. No vale añadir `.catch(() => {})`: eso silencia el
aviso sin resolver nada.

**Aparecieron el 2026-09-07 según SonarCloud**, pero no figuraban en la
auditoría de E.1: son de una regla que Sonar incorporó después, no de
código nuevo nuestro.

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

## Branding heredado de la plantilla en assets que no son código

**Dónde.** `public/og-image.svg`, `public/404.html`, `public/offline.html`,
`public/icons/icono.svg` y `public/icons.svg`.

**Qué está mal.** Todos vienen del commit inicial, que arrancó el proyecto
desde la base de una ferretería, y siguen con esa identidad: el naranja
`#E8590C`, el carbón `#23272A` y una llave inglesa como símbolo. La imagen
de Open Graph además dice literalmente «de la bodega al camión», que es el
lema de la ferretería, no de LUNACELL.

A eso se suma un defecto de formato: la imagen de Open Graph es un SVG, y
ni el rastreador de Facebook ni el de X renderizan SVG. Hoy cualquier
enlace compartido del sistema sale sin previsualización.

**Por qué no se arregló en la fase de branding.** Esa fase autorizaba
actualizar el branding web «usando los assets actuales y sin ampliar
significativamente el alcance», y documentar lo que exigiera crear o
rediseñar assets. Estos cinco lo exigen:

- La imagen de Open Graph son 1200×630 con maquetación y tipografía
  propias. Reproducirla bien es diseñar una pieza nueva, no reescalar una
  existente, y hay que pasarla a PNG.
- `404.html` y `offline.html` traen su propia paleta, independiente de
  `tokens.css`, y un recuadro de 56 px que hoy solo es un cuadrado naranja
  de relleno. Cambiarle el color deja un cuadrado dorado vacío: hay que
  decidir qué marca va ahí.
- `icono.svg` es la llave inglesa vectorial y `icons.svg` un juego de
  iconos de redes sociales de la plantilla. Ninguno de los dos está
  referenciado desde ningún sitio.

**Qué sí se arregló.** El favicon, los tres iconos de la PWA, el
`theme-color` y los colores del manifiesto, porque salen de reescalar el
símbolo del logo aprobado sobre el negro de marca, sin inventar nada.

**Cuándo conviene hacerlo.** Cuando haya una tarea de diseño. Los dos SVG
sin referencias se pueden borrar en cualquier momento; lo demás necesita
que alguien decida cómo se ve.

---

## El abono por factura suelta no tiene las garantías del pago consolidado — destino: **CxC-2.1**

**Obligatorio antes de la interfaz final de cobros.** No es una mejora que
pueda esperar a que haya tiempo: mientras no se haga, hay dos formas de
cobrarle a un cliente y solo una es segura.

**Dónde.** `crearAbono()` y `ajustarEstadoPorSaldo()` en
[`lib/api/ventas.js`](../src/lib/api/ventas.js), y `addPayment()` en
[`SalesContext.jsx`](../src/context/SalesContext.jsx).

**Qué le falta.** CxC-2 puso el reparto consolidado dentro de PostgreSQL,
con candado, transacción y la deuda calculada en el motor. El camino viejo
—abonar contra una factura concreta, que D4 conserva a propósito— sigue
como estaba, y le faltan cuatro cosas que el nuevo sí tiene:

- **Concurrencia.** No toma ningún candado. Dos cajeros abonando a la vez
  sobre la misma factura validan los dos contra el saldo que tenían en
  pantalla, y los dos pasan. El nuevo RPC bloquea la fila del cliente y las
  de sus facturas; este no bloquea nada.
- **Sobrepago.** Lo comprueba el navegador, en `addPayment`, comparando
  contra la copia en memoria de la venta. La base solo exige `monto > 0`:
  una llamada directa a la API, o una pantalla con datos viejos, puede
  dejar una factura sobrepagada. El pago consolidado lo rechaza dentro de
  la transacción, contra la deuda recién calculada.
- **Atomicidad.** Son dos viajes: primero se inserta el abono y después se
  actualiza el estado de la factura. Si el segundo no llega —la red, el
  navegador que se cierra—, el dinero queda cobrado y la factura sigue
  apareciendo como pendiente. El nuevo hace las dos cosas en una
  transacción.
- **Idempotencia.** Existe la clave y existe el índice único parcial, así
  que un doble clic no duplica. Pero `crearAbono()` devuelve el abono
  guardado **sin comparar la factura ni el monto**: reusar una clave con
  datos distintos no falla, devuelve el abono viejo y lo hace pasar por
  éxito. El nuevo RPC rechaza ese caso explícitamente.

**Por qué no se arregló en CxC-2.** Esa rama traía el reparto consolidado y
su infraestructura de pruebas. Arreglar esto exige tocar `SalesContext` y
la capa de API —código de producción vivo, con pruebas que hoy pasan— y
cambiar cómo se valida un cobro que el mostrador ya usa. Eso no cabe en una
rama cuyo alcance era otro, y meterlo habría mezclado un camino nuevo sin
estrenar con uno en uso.

**Qué habría que hacer.** Un RPC hermano, `registrar_abono_factura(
p_venta_id, p_monto, p_clave_idempotencia, p_nota)`, que es el mismo patrón
ya probado pero sobre una sola factura:

1. derivar empresa y usuario del contexto autenticado, nunca recibirlos;
2. bloquear la fila de la venta con `for update` y comprobar que es de la
   empresa, a crédito y no anulada;
3. calcular su saldo dentro de la transacción;
4. rechazar entero si el monto lo supera;
5. comprobar la clave dentro del candado, y rechazar si viene con otra
   factura u otro monto;
6. insertar el abono con `pago_id` nulo y sus `saldo_anterior` y
   `saldo_posterior`, y actualizar el estado, en la misma transacción.

Después, que `crearAbono()` y `ajustarEstadoPorSaldo()` pasen a ser una
sola llamada a ese RPC, y que `addPayment()` deje de decidir y solo muestre
lo que el motor conteste. Las validaciones del navegador se quedan como
ayuda para el usuario, no como la defensa.

**Cuánto es.** El SQL es pequeño: una versión recortada del RPC que ya
existe. Lo que pesa es lo otro —tocar dos archivos de producción, rehacer
las pruebas de abono de `SalesContext.test.jsx` y añadir las de
concurrencia y sobrepago contra PostgreSQL real, que el arnés de
`pruebas-sql/` ya permite escribir—.

**Por qué antes de la interfaz.** CxC-3 va a poner una pantalla de cobros.
Si desde ahí se puede llegar al camino viejo, la interfaz nueva hará
parecer seguro algo que no lo es, y nadie que la use tendrá forma de
distinguir cuál de los dos caminos tomó su cobro.

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
