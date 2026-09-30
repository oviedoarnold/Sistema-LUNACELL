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

## El abono directo sobre una factura se retira — **CxC-2.1 descartado**

**No se va a reparar. Se va a quitar.**

**Dónde.** `crearAbono()` y `ajustarEstadoPorSaldo()` en
[`lib/api/ventas.js`](../src/lib/api/ventas.js), y `addPayment()` en
[`SalesContext.jsx`](../src/context/SalesContext.jsx).

**Qué le falta.** CxC-2 puso el reparto consolidado dentro de PostgreSQL,
con candado, transacción y la deuda calculada en el motor. El camino de
abonar contra una factura concreta se quedó como estaba, y le faltan cuatro
cosas que el nuevo sí tiene:

- **Concurrencia.** No toma ningún candado. Dos cajeros abonando a la vez
  sobre la misma factura validan los dos contra el saldo que tenían en
  pantalla, y los dos pasan.
- **Sobrepago.** Lo comprueba el navegador, comparando contra la copia en
  memoria de la venta. La base solo exige `monto > 0`, así que una llamada
  directa a la API o una pantalla con datos viejos puede dejar una factura
  sobrepagada.
- **Atomicidad.** Son dos viajes: primero se inserta el abono y después se
  actualiza el estado. Si el segundo no llega, el dinero queda cobrado y la
  factura sigue apareciendo como pendiente.
- **Idempotencia.** La clave y el índice único existen, así que un doble
  clic no duplica. Pero `crearAbono()` devuelve el abono guardado **sin
  comparar la factura ni el monto**: reusar una clave con datos distintos
  no falla, devuelve el abono viejo y lo hace pasar por éxito.

**Por qué no se arregla.** Se llegó a escribir el alcance de un arreglo
—un RPC hermano que replicara el patrón sobre una sola factura— y se
descartó por una decisión de arquitectura: **todo cobro nuevo de cuentas
por cobrar entra exclusivamente por `registrar_pago_cliente()`**.

Reparar el camino viejo habría dejado dos vías operativas de cobrar,
ambas seguras pero distintas, y con ellas la pregunta de cuál usar en cada
caso. Quitar la segunda cuesta menos que mantenerla y explica mejor el
sistema: un cliente que paga no paga facturas, paga lo que debe.

**Qué se retira y cuándo.** CxC-3 quita la posibilidad **operativa** de
generar un abono directamente desde una factura: desaparece de la interfaz,
y con ella el camino que no tenía las garantías.

**Qué NO se toca.** La estructura se queda entera, y esto importa porque es
lo que evita confundir "se retira la pantalla" con "se borra el modelo":

- `abonos` sigue existiendo, y sigue siendo **el detalle de aplicación** de
  un pago:

  ```
  pago
    -> abono sobre la factura A
    -> abono sobre la factura B
    -> abono sobre la factura C
  ```

- `venta_id` sigue siendo obligatorio: cada renglón dice a qué factura fue
  su parte.
- **`pago_id` sigue siendo nullable**, por compatibilidad estructural con
  los abonos que se registraron por el camino viejo. **No se endurece a
  `NOT NULL` en esta fase**, y no depende de que hoy no haya ninguno: si
  apareciera uno antes del despliegue, seguiría siendo válido.

**Qué queda pendiente de verdad.** Nada de código en esta entrada. Lo único
que queda es que CxC-3 cumpla su parte y retire el flujo de la interfaz.
Mientras no lo haga, el camino viejo sigue accesible con los cuatro huecos
de arriba, así que **la interfaz de cobros no debe darse por terminada
antes de esa retirada**: dejarla a medias haría parecer seguro un camino
que no lo es.

---

## `getSaleBalance` no mira si la factura está anulada

**Dónde.** [`getSaleBalance`](../src/utils/salesUtils.js) y sus dos
consumidores que suman: el «Saldo por cobrar» de
[`SalesHistory`](../src/pages/SalesHistory.jsx) y el KPI «Por cobrar» de
[`metricas.js`](../src/pages/dashboard/metricas.js).

**Qué está mal.** La función solo distingue crédito de contado. Nunca
consulta `estado`, así que para ella una factura anulada a crédito sigue
debiendo su total menos lo abonado. Las dos pantallas que suman esa función
contarían esa factura dentro de lo que hay por cobrar.

**Por qué no muerde hoy.** Porque no hay ninguna anulada: se comprobó
contra la base y `ventas` tiene 0 filas en estado `anulada`. El defecto
aparecería el día que alguien anule la primera factura a crédito, y
aparecería como dos cifras que no cuadran entre sí.

**Por qué nació así.** La función es anterior a que las ventas pudieran
anularse. Cuando se añadió el estado `anulada` al esquema, nadie volvió
sobre el cálculo del saldo.

**Cómo se descubrió.** Escribiendo la cuenta consolidada de CxC-3. Esa
pantalla necesitaba excluir las anuladas, y al buscar dónde hacerlo se vio
que el helper compartido no lo hacía.

**Qué NO hereda el defecto.** Cuentas por Cobrar. Su
[`cuentasPorCobrar`](../src/utils/cuentasPorCobrar.js) filtra el estado por
su cuenta antes de sumar, así que la cuenta del cliente ya es correcta.
El filtro se puso ahí y no dentro de `getSaleBalance` a propósito: tocar el
helper cambiaría también el panel, y eso no cabía en una rama cuyo alcance
era la pantalla de cobros.

**Qué habría que hacer.** Añadir el estado a la condición de
`getSaleBalance` —una venta anulada arrastra saldo cero, igual que una de
contado— y comprobar de paso las pruebas del panel y del historial, que hoy
no cubren el caso. Es pequeño; lo que pide es tocar tres archivos a la vez
y mirar que las tres cifras sigan cuadrando.

**Cuándo conviene.** Antes de que se anule la primera factura a crédito en
producción, o en cualquier rama que ya toque el cálculo de saldos.

---

## `ModalDeCliente` no se anuncia como diálogo ni cierra con Escape

**Dónde.** [`ModalDeCliente.jsx`](../src/components/documents/ModalDeCliente.jsx).

**Qué le falta.** Dibuja su propia ventana —capa, caja, cabecera, cuerpo,
pie— en vez de apoyarse en
[`ModalShell`](../src/components/forms/ModalShell.jsx), que es el armazón
que el resto del sistema usa. Al no hacerlo, se queda sin las cuatro cosas
que ese armazón trae:

- no lleva `role="dialog"` ni `aria-modal`, así que un lector de pantalla no
  anuncia que se abrió una ventana;
- no toma su nombre del título, aunque lo muestre;
- no cierra con Escape;
- no mueve el foco al abrirse ni lo devuelve al cerrarse.

**Cómo se descubrió.** Validando F.2 en el navegador. Al comprobar que
«Registrar cliente nuevo» seguía abriendo el formulario, la ventana apareció
correctamente pero el conteo de `[role=dialog]` dio cero.

**Por qué Sonar no lo marca.** Sus reglas de accesibilidad miran elementos
no interactivos con manejadores de interacción, y aquí no hay ninguno: el
problema es lo que falta, no lo que sobra. Por eso no salió con los tres
`S6848` que F.2 corrigió.

**Impacto.** Quien abre el formulario con el teclado entra en una ventana
que no se anuncia y de la que no se sale con Escape. Se puede completar y
guardar con Tab, así que no bloquea; molesta.

**Por qué no se arregló en F.2.** Esa fase tenía autorizada la deuda
documentada de `ClientAutocomplete` y `DocumentPreviewModal`, y esta no
estaba en la lista. `ModalDeCliente` lo consumen facturar y cotizar, así que
tocarlo vuelve a ser un cambio compartido que merece su propia revisión.

**Qué habría que hacer.** Pasarlo a `ModalShell`, que ya resuelve las cuatro
cosas y es lo que usan las demás ventanas del sistema. El cuerpo del
formulario no cambia; lo que se sustituye es el armazón de alrededor.

**Cuándo.** En cualquier rama que ya toque los componentes de documentos.
Se comprobó y es la única que queda: `DocumentPreviewModal` también dibuja
su propia ventana, pero F.2 ya le dio el rol, el nombre y el Escape que le
faltaban, así que esta entrada cubre un solo archivo.

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
