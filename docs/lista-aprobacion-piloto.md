# Lista de aprobación: piloto de Camión 01

Para activar el piloto, cada punto debe quedar marcado y con evidencia (fecha,
quién lo comprobó, enlace o captura). Si falta uno, el piloto no se activa.

> **Estado al 2026-10-22:** el dueño autorizó activar Camión 01 como **piloto
> técnico con datos de prueba** con los puntos que siguen abiertos, y aceptó
> la limitación de la prueba 2 solo para ese piloto. Activado el 2026-10-22 a
> las 02:14 UTC ([registro](piloto-camion-01.md#registro-de-la-activación)).
> Los puntos abiertos siguen siendo requisito para el **uso comercial real**,
> que no está aprobado. Un punto se marca solo con evidencia; lo que no se
> comprobó queda abierto.

## Sistema

- [x] OFF-1.4 integrado en `main`, con CI, pruebas SQL, SonarCloud y Vercel en
      verde. *`main` en `a853257` (PR #56, #55 y #57), desplegado en
      producción; el JS servido es idéntico al build de `main` (2026-10-21).*
- [x] Producción con las migraciones hasta la 0030 registradas, sin
      migraciones pendientes. *La 0030 se registró como `20261021230000`.*
- [x] Ninguna ubicación con `vende_sin_conexion = true` antes de la activación.
      *Verificado el 2026-10-22, antes de activar.*
- [x] Sin ventas por conciliar pendientes ni rescates inesperados (verificación
      de solo lectura de [piloto-camion-01.md](piloto-camion-01.md#14-verificación-de-solo-lectura-durante-el-piloto)).
      *0 y 0 el 2026-10-22, antes de activar.*
- [x] Correlativos y CAI sin cambios desde la última revisión. *Huella md5 de
      `empresas` igual antes y después de la 0030 y de la activación.*

## Pruebas en teléfonos reales

Ver [matriz-validacion-sin-conexion.md](matriz-validacion-sin-conexion.md),
apartado de pruebas manuales.

- [ ] Las pruebas manuales 1 a 12 hechas en el **entorno aislado**, con el
      registro de modelo, sistema y navegador. *Hechas por el dueño en PC,
      Android e iPhone (ver [resultados-piloto.md](resultados-piloto.md)); falta
      el registro de modelo, sistema y navegador. La prueba 2 falla:
      limitación aceptada solo para el piloto técnico.*
- [ ] Al menos un Android con la PWA instalada. *No registrado.*
- [ ] Un iPhone con la PWA instalada, si el piloto usará iPhone. *No
      registrado.*
- [x] Respaldo cifrado generado en el teléfono y rescatado en Windows.
      *Prueba 4, 2026-10-16, con capturas.*
- [ ] Dos teléfonos vendiendo la última unidad, con conciliación resuelta.
      *Solo simulada por HTTP (prueba 6, 7/7); falta en teléfonos.*
- [x] Reinicio del teléfono con ventas pendientes, sin pérdida. *Prueba 3,
      reportada por el dueño.*

## Dispositivos del piloto

- [ ] Teléfonos de Camión 01 identificados (modelo y dueño).
- [ ] PWA instalada y abierta desde el ícono.
- [ ] Fecha y hora automáticas activadas.
- [ ] Al menos 1 GB libre.
- [ ] Almacenamiento persistente concedido, o el riesgo aceptado por escrito si
      el navegador no lo concede.

## Personas y procedimiento

- [ ] El vendedor de Camión 01 leyó la
      [guía de ventas sin conexión](guia-ventas-sin-conexion.md) y practicó
      vender sin red en el entorno aislado.
- [ ] El administrador practicó en el entorno aislado: aplicar, aplicar con
      ajuste, anular y rescatar.
- [x] Hay un procedimiento de cierre diario (sección 10 de la guía del piloto).
- [ ] Contacto y horario de quien atiende las conciliaciones.
- [ ] El procedimiento de reversión (sección 13) está leído y entendido.

## Restricciones confirmadas

- [x] Solo Camión 01. Camión 02 y Bodega, después de evaluar el piloto.
      *Verificado después de activar, el 2026-10-22.*
- [x] **Lunacell Store no se habilita.** Desde la 0030 lo impide la base: solo
      camiones y bodegas pueden vender sin conexión, y la aplicación no puede
      cambiar el tipo de una tienda.
- [ ] Revisión fiscal de Store pendiente y registrada como requisito para
      cualquier activación de Store.
- [x] Migración 0030 (la tienda no vende sin conexión) aplicada en producción
      con autorización y registrada; ver
      [revision-seguridad-y-fiscal.md](revision-seguridad-y-fiscal.md).
      *2026-10-21, aplicada por el dueño en el SQL Editor (versión
      `20261021230000`) y verificada: restricción, función y trigger
      instalados, sin cambios de datos.*
- [x] Tarea de seguridad de dependencias (`react-router-dom`, `npm audit fix`)
      integrada, o su riesgo aceptado por escrito. *`npm audit` sin
      vulnerabilidades el 2026-10-21.*
- [x] Pruebas físicas hechas en el entorno local aislado de
      [entorno-de-pruebas.md](entorno-de-pruebas.md) (Supabase local y Tailscale
      Serve), nunca contra producción.

## Autorización

- [x] Autorización expresa del dueño para ejecutar la activación de la
      sección 12 de la guía del piloto. *2026-10-22, como piloto técnico con
      datos de prueba; no autoriza el uso comercial real.*
- [ ] Fecha de inicio, duración del piloto y criterio para evaluarlo (por
      ejemplo, dos semanas sin ventas perdidas y con todas las conciliaciones
      resueltas). *Inicio: 2026-10-22. Duración y criterio: no definidos.*

## Limitación aceptada para el piloto técnico

En Android e iPhone la app instalada no se vuelve a abrir sin conexión (prueba 2
de [resultados-piloto.md](resultados-piloto.md)). El dueño la aceptó solo para
el piloto técnico con datos de prueba, con este procedimiento: abrir la app con
conexión al empezar y mantenerla abierta. No está resuelta ni aceptada para el
uso comercial real. Iniciar sesión sin Internet no es posible por diseño.

## Prueba final en producción

**Satisfactoria (2026-10-22).** Dos ventas sin conexión hechas por el dueño con el usuario `camion01`, una en
cada uno de dos teléfonos (modelos no indicados), con la app abierta y en modo
avión:

| Documento | Comprobante provisional | Hecha (UTC) | Recibida (UTC) | Venta | Inventario |
|---|---|---|---|---|---|
| VTA-000009 | PROV-90BB-000001 | 2026-10-22 02:26:43 | 02:27:15 | 1 Cargador, contado, L 138.00 con ISV | −1 en Camión 01 |
| VTA-000010 | PROV-038C-000001 | 2026-10-22 03:16:57 | 03:17:10 | 1 Cubo Iphone, contado, L 115.00 con ISV | −1 en Camión 01 |

Verificado en el servidor (solo lectura):

- cada venta llegó una sola vez: sin claves de idempotencia, comprobantes
  provisionales ni números de documento repetidos;
- origen «sin conexión», documento interno (no fiscal), desfase de reloj 0 s;
- Camión 01 quedó con 4 Cargador y 4 Cubo Iphone (de 5 y 5); Bodega sin
  cambios;
- 0 ventas por conciliar y 0 rescates;
- correlativos internos 1 a 10 sin huecos ni repetidos, próximo 11; el
  correlativo fiscal sin cambios;
- Camión 01 sigue habilitado; Camión 02, Bodega y Store, no.

Con esto queda comprobado en producción vender sin conexión con la app abierta
y sincronizar al volver la red. No cambia la limitación de la prueba 2 ni los
puntos abiertos de esta lista, que siguen siendo requisito para el uso
comercial real.
