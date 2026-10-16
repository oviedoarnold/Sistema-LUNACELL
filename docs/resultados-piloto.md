# Resultados de las pruebas manuales del piloto

Registro según la plantilla de [entorno-local.md](entorno-local.md#8-registrar-los-resultados),
en el entorno local de pruebas (Supabase local, Tailscale Serve, datos
ficticios, sin CAI fiscal real). Nada se probó contra producción.

Lo que la persona que probó no indicó queda como **no indicado**: no se
completa por suposición. «Reportado por el dueño» significa que el resultado
viene de su informe, sin captura entregada.

```
Fecha: ver cada prueba  Persona: el dueño del proyecto  Commit de LUNACELL: 66c5023 (build servido por pruebas:servir, compilado el 2026-10-14)

| # | Prueba | Dispositivo (modelo / sistema / navegador) | PWA instalada | Resultado (OK / FALLA) | Observaciones y capturas |
|---|--------|--------------------------------------------|---------------|------------------------|--------------------------|
| 1 | Ventas en modo avión con comprobante PROV | PC, iPhone y Android (modelos y versiones no indicados) | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 2 | Cerrar y reabrir sin red | No indicado | No indicado | **FALLA (en diagnóstico)** | Reportado por el dueño, 2026-10-16: con una venta pendiente, cerró la app y sin red no pudo volver a abrirla («necesito tener conexión»). La venta no se perdió: al volver la conexión entró y se subió sin problema. Ver «Prueba 2: diagnóstico». |
| 3 | Reiniciar el teléfono | No indicado | No indicado | OK | Reportado por el dueño: reinicio con una venta pendiente, sin pérdida. Fecha no indicada. |
| 4 | Respaldo cifrado y rescate en la PC | Teléfono: no indicado (la captura parece de iPhone, sin confirmar). PC: no indicado | No indicado | OK | 2026-10-16. Capturas entregadas. Ver el detalle abajo. |
| 5 | Sincronización automática al volver la red | PC, iPhone y Android (modelos y versiones no indicados) | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 6 | Última unidad en dos teléfonos y conciliación | Sin teléfonos: por HTTP contra el Supabase local | No aplica | OK (7/7) | 2026-10-14. La ejecutó Claude Code simulando dos teléfonos; no es una prueba física. Conciliación PROV-TEL2-000901 aplicada («No había existencia suficiente en el servidor»). |
| 7 | Más de 1 hora sin red y reconexión | No indicado | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 8 | Cierre de sesión con pendientes | No indicado | No indicado | OK | Reportado por el dueño: cierre de sesión con ventas pendientes y reingreso **con conexión**. Fecha no indicada. Ver «Reingreso sin conexión». |
| 9 | Wifi sin Internet (portal cautivo) | No indicado | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 10 | Varias pestañas en la PC | No indicado | No indicado | OK con observación | Reportado por el dueño: aprobada con una observación que no se describió. Falta anotarla. |
| 11 | Cambio de ubicación con pendientes | Teléfono: no indicado (la captura parece de iPhone, sin confirmar) | No indicado | OK | 2026-10-16. Capturas entregadas. Ver el detalle abajo. |
| 12 | Crédito a cliente existente | No indicado | No indicado | OK | Reportado por el dueño, 2026-10-16: venta a crédito a un cliente existente, con conexión y sin conexión; al volver la conexión se envió sin problemas. Capturas: no entregadas. |
| 13 | Venta de otro dispositivo visible al volver a la app | No indicado (dos dispositivos del dueño) | No indicado | OK | La venta hecha en un dispositivo apareció en el historial del segundo y las existencias se actualizaron al regresar a la aplicación, sin recarga manual. Fecha no indicada. Capturas: no entregadas. |
```

## Detalle de la prueba 4: respaldo cifrado y rescate

Según las capturas entregadas el 2026-10-16:

- Venta `PROV-8A7C-000003`, Camión 01 Pruebas, «Vendedor Camión 01 (teléfono
  1)», contado, Consumidor Final: 1 Protector de pantalla (prueba) PR-004,
  L 80.00; total cobrado L 92.00 (ISV 15 %).
- Hecha sin conexión el 16/10/2026 a las 9:34:43 a. m. y recibida por el
  servidor desde el respaldo a las 9:55:12 a. m.
  - Motivo: «Subida por un administrador desde un respaldo cifrado».
  - Origen: «Rescatada por un administrador».
- Resuelta por el administrador a las 9:59:53 a. m. con **Aplicar**.
- En el teléfono, al volver la conexión, la venta muestra «Aplicada en
  conciliación: ya está en los libros del servidor». No aparece duplicada:
  junto a ella solo están las facturas VTA-000016 y VTA-000011, ya registradas
  antes.

Las capturas muestran una sola venta en el respaldo. No se reportaron la prueba
con una frase incorrecta ni el segundo intento de rescate: no se dan por hechas.

## Detalle de la prueba 11: cambio de ubicación con pendientes

Según las capturas entregadas el 2026-10-16:

- Al cambiar la ubicación del usuario, Configuración avisó antes: «Camión 01
  Pruebas vende sin conexión. Si Vendedor Camión 01 (teléfono 1) tiene ventas
  sin sincronizar en su teléfono, al llegar quedarán en conciliación…».
- Venta `PROV-8A7C-000006`, hecha el 16/10/2026 a las 3:22:38 p. m. y recibida
  a las 3:25:33 p. m. (reloj del teléfono con -1 s de diferencia).
  - Contado, Consumidor Final, 2 Protector de pantalla (prueba) PR-004 a
    L 80.00. Total cobrado: L 184.00 (ISV 15 %).
  - Origen: «Enviada por el vendedor».
  - Motivo: «El vendedor ya no estaba asignado a esa ubicación».
- En el teléfono quedó «En conciliación», con ese motivo.
- El administrador la resolvió y quedó **Aplicada**. Las capturas no muestran
  si se usó «Aplicar» o «Aplicar con ajuste».

## Observaciones

### Prueba 2: diagnóstico

Lo esperado según la matriz es que, sin red, la app reabra y entre al POS con
las ventas pendientes. No ocurrió. Falta saber qué pantalla apareció, en qué
teléfono, y si la app se abrió desde el ícono instalado o desde el navegador.

Hallazgo en el entorno de pruebas, confirmado el 2026-10-16: el build de
`pruebas:compilar` (`dist-pruebas/`) sale **sin la lista de precarga del
service worker** (`ARCHIVOS_DEL_BUILD = []`) y **sin `login.html`**. Los dos
pasos de `vite.config.js` que los generan escriben siempre en `dist/`. El build
de producción (`dist/`) sí los tiene.

Puede ser la causa de la falla, o no: el service worker también guarda los
archivos cuando se usan con conexión. No se da por resuelta hasta corregir el
build de pruebas y repetir la prueba.

### Reingreso sin conexión después de cerrar sesión

Después de cerrar sesión, no se puede volver a entrar sin conexión. **Es el
comportamiento diseñado, no un fallo:**

- al cerrar sesión, LUNACELL borra el perfil sin conexión del teléfono
  (`olvidarPerfil` en `src/context/AuthContext.jsx`);
- la [guía de ventas sin conexión](guia-ventas-sin-conexion.md#lo-que-no-debes-hacer)
  lo advierte: «No cierres sesión con ventas pendientes si no tienes conexión:
  no podrás volver a entrar hasta que regrese»;
- las ventas pendientes no se borran y se envían al volver a entrar con
  conexión, como se comprobó en la prueba 8.

### Ubicación asignada por el administrador

El dueño confirmó que el vendedor no puede cambiar su ubicación desde su sesión:
el administrador la asigna al crear la cuenta, y al entrar el vendedor trabaja
en esa ubicación. No se entregó evidencia.

La prueba 11 (el administrador cambia la ubicación de un vendedor con ventas
sin sincronizar) se hizo aparte; ver su detalle.

## Lo que falta para cerrar este registro

- La prueba 2: corregir el build de pruebas y repetirla.
- La observación de la prueba 10.
- Para cada prueba física: fecha, modelo, sistema y navegador, y si la PWA
  estaba instalada. La [lista de aprobación](lista-aprobacion-piloto.md) lo
  exige.
- La prueba 6 en teléfonos reales, si la lista de aprobación la exige como
  prueba física («Dos teléfonos vendiendo la última unidad»).
