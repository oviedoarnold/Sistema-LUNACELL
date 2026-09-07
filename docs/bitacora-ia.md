# Bitácora de uso de IA

Código de verificación: `LEARN-CAP-50768C03`

Este proyecto se desarrolló con asistencia de IA. Los dos casos siguientes son
commits reales del repositorio y se pueden verificar contra el historial.

---

## Caso 1 — La IA propuso lo que pedí; yo corregí el alcance

**Commit:** `41c0ef1`
**Título:** `feat(sales): permite abonos en facturas a credito`
**Verificar:** `git show 41c0ef1`

### Qué pedí

Poder registrar abonos sobre las facturas, ver el saldo restante y que al completarse
el pago la factura pasara de pendiente a cancelada. Lo pedí explícitamente **para las
facturas de contado**.

### Qué propuso la IA

Antes de escribir código, revisó el modelo de datos y señaló una contradicción: en
`SalesContext.jsx` y `POS.jsx` las ventas de contado se crean con
`status: "pagada"` y sin fecha de vencimiento. Nacen saldadas. No tienen saldo que
abonar, y nunca están en estado "pendiente", así que la transición
"pendiente → cancelada" que yo describía era imposible para ellas.

Propuso tres alternativas: limitarlo a crédito, cambiar el POS para que una venta de
contado pudiera registrarse con pago parcial, o habilitar el botón según el saldo sin
importar el tipo.

### Qué decidí y por qué

**Rechacé el alcance que yo mismo había pedido** y elegí limitarlo a las ventas a
crédito. El principio que lo justifica es que **el modelo de datos manda sobre la
petición**: pedir abonos sobre facturas que por definición nacen pagadas habría
producido un botón que nunca tendría nada que cobrar, o me habría obligado a cambiar
el significado de "contado" en todo el sistema para acomodar un caso que en la
práctica no existe en una ferretería.

Lo valioso no fue que la IA escribiera el código, sino que **verificara la premisa
antes de obedecer**. Si hubiera implementado lo pedido al pie de la letra, habría
entregado una funcionalidad inútil que además habría ensuciado el modelo.

---

## Caso 2 — La IA propuso un cambio mínimo; se amplió al descubrir un riesgo

**Commit:** `860325b`
**Título:** `fix(auth): mantiene la sesion al refrescar y cierra las rutas por permiso`
**Verificar:** `git show 860325b`

### Qué pedí

Arreglar que al recargar la página el sistema expulsara al login aunque la sesión
fuera válida. Añadí una condición: que no se rompieran las restricciones de usuario.

### Qué propuso la IA

Identificó la causa —la sesión se restauraba dentro de un `useEffect`, así que el
primer render veía al usuario como nulo y `ProtectedRoute` ya había redirigido— y
propuso moverla al inicializador del estado. Un cambio de pocas líneas.

Al revisar la condición que puse, encontró algo que yo no sabía: **solo `/settings`
verificaba permisos**. Las otras siete rutas estaban abiertas; el menú simplemente
ocultaba las pestañas. El bug del refresco estaba tapando el hueco por accidente,
porque cualquier URL escrita a mano rebotaba al login.

### Qué decidí y por qué

Acepté ampliar el cambio para cerrar las ocho rutas, y **rechacé la primera propuesta
de redirección**, que mandaba al dashboard: un usuario sin permiso de dashboard habría
entrado en un bucle infinito. Se cambió por redirigir a la primera sección que el
usuario sí tenga, con una pantalla de aviso para quien no tenga ninguna.

El principio es que **corregir un bug no debe abrir otro**. Entregar solo el arreglo
del refresco habría sido cumplir lo pedido y empeorar el producto: habría dejado el
inventario, los clientes y la configuración accesibles con solo teclear una URL.

---

## Nota sobre el método

En ambos casos la IA no se limitó a generar código: leyó el código existente,
contrastó la petición contra él y **avisó cuando la petición no encajaba**. Las dos
decisiones finales fueron mías. También verificó su propio trabajo manejando la
aplicación en un navegador real —no solo corriendo pruebas— antes de dar por
terminado cada cambio.

Las limitaciones que la IA declaró explícitamente y que quedaron documentadas:

- Que el control de acceso en `localStorage` no contiene a un usuario técnico
  determinado, solo separa funciones entre empleados de confianza.
- Que la normativa del SAR sobre el CAI debe confirmarse con un contador y no darse
  por buena a partir de lo que ella afirmara.
