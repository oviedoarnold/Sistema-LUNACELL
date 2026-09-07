-- Evita que un documento se emita dos veces.
--
-- Hoy, un doble clic en "Generar factura" emite dos facturas, consume dos
-- correlativos y descarga el inventario dos veces. Bloquear el botón tapa
-- el caso común, pero no el que de verdad duele: la factura se guarda, la
-- respuesta se pierde en la red, y el cajero —que no vio nada— vuelve a
-- cobrar. En un sistema que maneja dinero eso no puede depender de la
-- suerte de la conexión.
--
-- La solución es que el intento traiga su propia identidad. El navegador
-- genera una clave por operación, no por clic: si la misma operación se
-- reintenta, llega la misma clave, y la restricción única deja pasar solo
-- la primera. La segunda choca, y la aplicación devuelve el documento que
-- ya existía en vez de crear otro.
--
-- La clave es única por empresa y no globalmente: dos ferreterías podrían
-- generar la misma sin que eso signifique nada.

alter table ventas
  add column if not exists clave_idempotencia text;

alter table cotizaciones
  add column if not exists clave_idempotencia text;

alter table abonos
  add column if not exists clave_idempotencia text;

/*
  El índice es parcial: solo cubre las filas que traen clave. Los
  documentos que ya existían no la tienen, y exigirla habría obligado a
  inventarles una.
*/
create unique index if not exists ventas_clave_idempotencia
  on ventas (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

create unique index if not exists cotizaciones_clave_idempotencia
  on cotizaciones (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

create unique index if not exists abonos_clave_idempotencia
  on abonos (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

