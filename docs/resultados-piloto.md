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
| 2 | Cerrar y reabrir sin red | — | — | Sin registrar | No reportada por separado. |
| 3 | Reiniciar el teléfono | No indicado | No indicado | OK | Reportado por el dueño: reinicio con una venta pendiente, sin pérdida. Fecha no indicada. |
| 4 | Respaldo cifrado y rescate en la PC | Teléfono: no indicado (la captura parece de iPhone, sin confirmar). PC: no indicado | No indicado | OK | 2026-10-16. Capturas entregadas. Ver el detalle abajo. |
| 5 | Sincronización automática al volver la red | PC, iPhone y Android (modelos y versiones no indicados) | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 6 | Última unidad en dos teléfonos y conciliación | Sin teléfonos: por HTTP contra el Supabase local | No aplica | OK (7/7) | 2026-10-14. La ejecutó Claude Code simulando dos teléfonos; no es una prueba física. Conciliación PROV-TEL2-000901 aplicada («No había existencia suficiente en el servidor»). |
| 7 | Más de 1 hora sin red y reconexión | No indicado | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 8 | Cierre de sesión con pendientes | No indicado | No indicado | OK | Reportado por el dueño: cierre de sesión con ventas pendientes y reingreso **con conexión**. Fecha no indicada. Ver «Reingreso sin conexión». |
| 9 | Wifi sin Internet (portal cautivo) | No indicado | No indicado | OK | Reportado por el dueño. Fecha no indicada. |
| 10 | Varias pestañas en la PC | No indicado | No indicado | OK con observación | Reportado por el dueño: aprobada con una observación que no se describió. Falta anotarla. |
| 11 | Cambio de ubicación con pendientes | — | — | Sin registrar | Ver «Ubicación asignada por el administrador». |
| 12 | Crédito a cliente existente | — | — | Sin registrar | No reportada. |
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

## Observaciones

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

Esto **no reemplaza** la prueba 11 de la
[matriz](matriz-validacion-sin-conexion.md#pruebas-manuales-pendientes-b).
Esa prueba consiste en que un administrador cambie la ubicación de un vendedor
que tiene ventas sin sincronizar, y en comprobar que esas ventas llegan a
conciliación con el motivo «ubicación cambiada».

## Lo que falta para cerrar este registro

- Pruebas 2, 11 y 12, sin hacer o sin reportar.
- La observación de la prueba 10.
- Para cada prueba física: fecha, modelo, sistema y navegador, y si la PWA
  estaba instalada. La [lista de aprobación](lista-aprobacion-piloto.md) lo
  exige.
- La prueba 6 en teléfonos reales, si la lista de aprobación la exige como
  prueba física («Dos teléfonos vendiendo la última unidad»).
