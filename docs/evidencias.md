# Evidencias

Código de verificación: `LEARN-CAP-50768C03`

El requisito pide **mínimo 3 de las 4** capturas. Guarda cada archivo en
`docs/evidencias/` con el nombre indicado.

---

## 1 · Pipeline verde en GitHub Actions

**Dónde:** https://github.com/oviedoarnold/Sistema-Ferreteria/actions

Abre la corrida más reciente de `main`.

**Qué debe verse:** el nombre del commit arriba y la lista de pasos, todos con
palomita verde: *Lint*, *Tests con cobertura*, *Build de producción*,
*SonarCloud*.

**Archivo:** `docs/evidencias/pipeline-verde.png`

> Vale la pena mostrar el paso **SonarCloud en verde**, porque durante varios
> días apareció como `skipped` y es lo que demuestra que el análisis sale del
> pipeline y no del modo automático.

---

## 2 · Tablero de SonarCloud

**Dónde:** https://sonarcloud.io/summary/overall?id=oviedoarnold_Sistema-Ferreteria

**Qué debe verse:** el **Quality Gate en Passed** y las métricas de *Overall
Code*: 0 bugs, 0 vulnerabilidades, code smells, cobertura y duplicación.

**Archivo:** `docs/evidencias/sonarcloud.png`

Valores en el momento de escribir esto:

| Métrica | Valor |
|---|---|
| Quality Gate | OK |
| Bugs | 0 |
| Vulnerabilidades | 0 |
| Code smells | 9 |
| Cobertura | 61,7 % |
| Duplicación | 2,3 % |
| Líneas analizadas | 10.785 |

---

## 3 · PWA instalada en un teléfono real

**Cómo:** abre https://www.oviedoarnold.lat en Chrome desde el teléfono. En el
menú de tres puntos aparece **«Instalar aplicación»** o **«Agregar a pantalla
de inicio»**.

**Qué debe verse:** dos capturas si puedes —

1. El icono del sistema en la pantalla de inicio, junto a las demás apps
2. La aplicación abierta **sin la barra de direcciones del navegador**, que es
   lo que demuestra que corre en modo `standalone`

**Archivo:** `docs/evidencias/pwa-telefono.png`

> Esta captura sirve además para **confirmar algo que no pude verificar**: que
> el service worker se instala de verdad. Chrome en modo headless no persiste
> los service workers, así que quedó comprobado que el archivo se sirve y que
> el código de registro se ejecuta, pero no que el caché `ferreteria-v1` llegue
> a crearse.
>
> **Para comprobarlo:** con la app instalada, activa el modo avión y ábrela. Si
> carga, el service worker funcionó. Esa segunda captura es la evidencia más
> fuerte de las tres.

---

## 4 · Cliente real usando el producto

**Con su permiso.** Una foto del mostrador con el sistema en pantalla, o de la
persona usándolo.

**Archivo:** `docs/evidencias/cliente-usando.png`

> Si prefieres no incluirla, con las tres anteriores ya cumples el mínimo.

---

## Recordatorio sobre la demostración

Las capturas del recorrido guiado **no cuentan como evidencia** para este
requisito, pero si quieres reforzar la entrega, las pantallas que mejor
muestran el producto son:

- El panel con el saldo por cobrar y las alertas de existencias
- El historial con una factura en **Cancelada** y otra en **Vencida**
- El menú de un usuario limitado, donde faltan tres secciones

El recorrido para llegar a esas pantallas está en [demo.md](demo.md).
