# Lista de aprobación: piloto de Camión 01

Para activar el piloto, cada punto debe quedar marcado y con evidencia (fecha,
quién lo comprobó, enlace o captura). Si falta uno, el piloto no se activa.

## Sistema

- [ ] OFF-1.4 integrado en `main`, con CI, pruebas SQL, SonarCloud y Vercel en
      verde.
- [ ] Producción con las 19 migraciones (0001–0029), sin migraciones pendientes.
- [ ] Ninguna ubicación con `vende_sin_conexion = true` antes de la activación.
- [ ] Sin ventas por conciliar pendientes ni rescates inesperados (verificación
      de solo lectura de [piloto-camion-01.md](piloto-camion-01.md#14-verificación-de-solo-lectura-durante-el-piloto)).
- [ ] Correlativos y CAI sin cambios desde la última revisión.

## Pruebas en teléfonos reales

Ver [matriz-validacion-sin-conexion.md](matriz-validacion-sin-conexion.md),
apartado de pruebas manuales.

- [ ] Las pruebas manuales 1 a 12 hechas en el **entorno aislado**, con el
      registro de modelo, sistema y navegador.
- [ ] Al menos un Android con la PWA instalada.
- [ ] Un iPhone con la PWA instalada, si el piloto usará iPhone.
- [ ] Respaldo cifrado generado en el teléfono y rescatado en Windows.
- [ ] Dos teléfonos vendiendo la última unidad, con conciliación resuelta.
- [ ] Reinicio del teléfono con ventas pendientes, sin pérdida.

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
- [ ] Hay un procedimiento de cierre diario (sección 10 de la guía del piloto).
- [ ] Contacto y horario de quien atiende las conciliaciones.
- [ ] El procedimiento de reversión (sección 13) está leído y entendido.

## Restricciones confirmadas

- [ ] Solo Camión 01. Camión 02 y Bodega, después de evaluar el piloto.
- [ ] **Lunacell Store no se habilita.** Hoy tiene `emite_fiscal = false`, así
      que la base no lo impediría: la restricción es de procedimiento hasta la
      revisión fiscal.
- [ ] Revisión fiscal de Store pendiente y registrada como requisito para
      cualquier activación de Store.

## Autorización

- [ ] Autorización expresa del dueño para ejecutar la activación de la
      sección 12 de la guía del piloto.
- [ ] Fecha de inicio, duración del piloto y criterio para evaluarlo (por
      ejemplo, dos semanas sin ventas perdidas y con todas las conciliaciones
      resueltas).
