# ADR-2: Control de acceso verificado en cada ruta, no solo en el menú

- **Fecha:** 2026-08-28
- **Estado:** Aceptada e implementada
- **Ruta:** `docs/adr/adr-002-permisos-por-ruta.md`
- **Commit:** `860325b`

## Contexto

El sistema permite al administrador crear usuarios y habilitarles secciones una por
una. La implementación original **ocultaba del menú** las pestañas sin permiso, y a
nivel de ruta solo `/settings` verificaba algo.

El hueco quedaba tapado por accidente: un bug de sesión hacía que cualquier URL
escrita directamente rebotara al login, así que nadie notó que las rutas estaban
abiertas.

Al corregir ese bug —la sesión se restauraba dentro de un efecto, así que el primer
render siempre veía al usuario como nulo— **el agujero habría quedado expuesto**:
un vendedor sin permiso de inventario podría escribir `/products` en la barra de
direcciones y entrar.

Se consideraron dos caminos:

| Opción | A favor | En contra |
|---|---|---|
| Arreglar solo la sesión | Cambio mínimo, era lo pedido | Deja las siete rutas abiertas a quien teclee la URL |
| **Arreglar la sesión y cerrar las rutas** | Cierra el hueco antes de exponerlo | Más superficie tocada en un mismo cambio |

## Decisión

Las **ocho rutas privadas exigen su permiso** mediante `ProtectedRoute`, no solo las
que el menú oculta.

Cuando un usuario entra a una ruta que no tiene habilitada, se le redirige a **la
primera página que sí tenga**, recorriendo el mapa `NAV_ROUTES`. No se redirige al
dashboard por omisión, porque un usuario sin permiso de dashboard entraría en un
bucle infinito de redirecciones.

Para el usuario al que el administrador no le habilitó ninguna sección se muestra
una pantalla de aviso con opción de cerrar sesión, en lugar de rebotarlo.

La sesión se recupera de forma síncrona en el inicializador del estado, y el usuario
se **deriva** de la lista de usuarios más el identificador de sesión, en vez de
copiarse a estado y sincronizarse con un efecto.

## Consecuencias

**A favor**

- Escribir una URL prohibida ya no da acceso. Verificado con un usuario limitado
  contra seis rutas: las seis desvían.
- Quitarle un permiso a alguien o desactivarlo surte efecto de inmediato, sin
  esperar a que vuelva a entrar, porque el usuario se deriva y no se copia.
- Recargar la página deja de expulsar al login, que era el bug original.
- Un usuario sin permisos recibe una explicación en vez de un bucle.

**En contra**

- El mapa `NAV_ROUTES` duplica información que también está en el menú del `Navbar`.
  Si se agrega una sección hay que registrarla en los dos lugares, y olvidarlo deja
  la ruta sin protección. Se aceptó a cambio de no reescribir el `Navbar`, que tiene
  iconos y etiquetas que el mapa no necesita.
- La verificación sigue ocurriendo en el navegador. **Un usuario con conocimientos
  técnicos puede editarse los permisos en `localStorage`.** Esta decisión reduce el
  acceso accidental y separa funciones entre empleados; el cierre real depende del
  ADR-1.

## Qué se sacrificó

Se sacrificó el **alcance acotado del cambio**. Lo pedido era arreglar el refresco;
se entregó eso más el cierre de siete rutas. Un cambio más grande es un cambio con
más riesgo de romper algo.

Se aceptó porque entregar solo el arreglo del refresco habría **empeorado la
seguridad del producto**: el bug estaba tapando el hueco, y quitarlo sin cerrarlo
habría dejado el inventario, los clientes y la configuración accesibles con solo
teclear una URL. Corregir un bug no debe abrir otro.
