# Pruebas hechas en producción con datos de prueba

Registro de las operaciones que el dueño hizo **desde la aplicación** en
producción para probar un módulo. No son ventas, cobros ni movimientos
reales: todos los datos operativos actuales de producción son de prueba y se
limpiarán antes de operar de verdad (hallazgo A-3 de la auditoría final).

Existe para que esas operaciones no se confundan con actividad real o
sospechosa al revisar la base. No se modifica ni se borra ninguna de ellas:
este archivo solo las describe.

Para los cambios hechos **a mano** sobre los datos (sin pasar por la
aplicación) está [operaciones-en-produccion.md](operaciones-en-produccion.md).
Para las pruebas del piloto sin conexión,
[resultados-piloto.md](resultados-piloto.md) y la
[guía del piloto](piloto-camion-01.md#prueba-final-en-producción-2026-10-22).

---

## 2026-10-22 · Ventas sin conexión en Camión 01

Dos ventas de prueba, una en cada teléfono, con el usuario `camion01`:
VTA-000009 (PROV-90BB-000001) y VTA-000010 (PROV-038C-000001). El detalle y
su verificación están en la [guía del piloto](piloto-camion-01.md#prueba-final-en-producción-2026-10-22).

## 2026-10-23 · Créditos y abonos

**Quién:** el dueño, con la cuenta de administrador. Confirmó por escrito que
los hizo él para probar el módulo de créditos y abonos, y que no son
operaciones reales.

**Qué se registró:** dos pagos de cliente de L 1,000.00 cada uno, sin
ubicación (los registró el administrador), repartidos por
`registrar_pago_cliente()` entre las facturas a crédito de prueba, de la más
antigua a la más reciente:

| Pago | Hora (UTC) | Monto | Abonos |
|---|---|---|---|
| 1 | 2026-10-23 20:04:35 | L 1,000.00 | 2 |
| 2 | 2026-10-23 20:05:22 | L 1,000.00 | 3 |

**Resultado en las facturas** (lectura del 2026-10-23):

| Factura | Total | Abonado | Saldo | Estado |
|---|---|---|---|---|
| FAC-00002 | L 345.00 | L 345.00 | L 0.00 | pagada |
| FAC-00005 | L 862.50 | L 862.50 | L 0.00 | pagada |
| FAC-00007 | L 517.50 | L 517.50 | L 0.00 | pagada |
| FAC-00008 | L 862.50 | L 275.00 | L 587.50 | pendiente |

Lo abonado suma L 2,000.00, igual a los dos pagos. Las cuatro facturas son de
prueba, anteriores a la 0017.

**Relación con las migraciones 0031 y 0032:** ninguna. Los pagos son
anteriores a las dos (aplicadas a las 21:06 y después de las 22:00 UTC) y no
tocan los contadores de correlativos.
