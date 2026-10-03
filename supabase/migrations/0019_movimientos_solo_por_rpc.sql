-- El libro de inventario se escribe solo a través de las funciones.
--
-- Hasta INV-3.3 el punto de venta insertaba la salida de cada venta
-- directamente en movimientos_inventario, sin ubicación, y por eso
-- `authenticated` conservaba insert, update y delete sobre la tabla. Ese
-- camino ya no existe: las ventas pasan por registrar_venta_ubicacion() y
-- las entradas y ajustes por registrar_movimiento_ubicacion(), que mueven
-- la celda de inventario_ubicacion y el libro en la misma transacción.
--
-- Mientras el navegador pudiera escribir el libro por su cuenta, la
-- invariante de INV-3.2.1 —para cada producto, la suma de sus celdas es la
-- suma de su libro— dependía de que nadie lo hiciera. Esta migración la
-- deja en manos del motor.
--
-- APLICAR SOLO DESPUÉS de desplegar el frontend de INV-3.3. Con el punto
-- de venta anterior todavía en producción, retirar el insert dejaría de
-- facturar.
--
-- Lo que NO hace: no toca ningún dato. Los doce movimientos históricos sin
-- ubicación se quedan como están; la regla nueva mira solo las filas
-- nuevas.

-- ─────────────────────────────────────────────────────────
-- NADIE ESCRIBE EL LIBRO DESDE FUERA
-- ─────────────────────────────────────────────────────────
/*
  Los tres, y no solo el insert. Un movimiento editado o borrado descuadra
  el libro igual que uno insertado a mano, y el Kardex no se corrige
  reescribiéndolo: se corrige con otro movimiento, que es lo que hace un
  ajuste.

  La lectura no cambia: la política movimientos_inventario_de_mi_empresa
  sigue dejando ver los de la propia empresa.

  `anon` también, aunque RLS ya lo dejaba fuera —la única política es para
  `authenticated`—. Un permiso que no se usa y que solo RLS neutraliza es
  una segunda línea que falta.

  Las funciones SECURITY DEFINER no se ven afectadas: corren como su
  dueño, igual que con inventario_ubicacion desde la 0014. Tampoco las
  acciones referenciales (`on delete set null` de venta_id y usuario_id),
  que PostgreSQL ejecuta con los permisos del dueño de la tabla.
*/
revoke insert, update, delete on movimientos_inventario from authenticated;
revoke insert, update, delete on movimientos_inventario from anon;

-- ─────────────────────────────────────────────────────────
-- TODO MOVIMIENTO NUEVO LLEVA UBICACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Por qué un disparador y no `not null` ni un `check`:

  - `not null` exigiría inventar una ubicación para los doce movimientos
    históricos, y la 0014 ya explicó por qué eso sería inventar historia.

  - Un `check ... not valid` no revisa las filas viejas al crearse, pero sí
    cada vez que una de ellas se actualiza. Y las históricas se actualizan
    solas: borrar una venta o un usuario pone en nulo su venta_id o su
    usuario_id por la llave foránea, y ese UPDATE fallaría contra el check.
    Sería impedir borrar un usuario por un dato que nadie está tocando.

  El disparador mira solo el INSERT: lo que ya existe queda como está, y lo
  que entre desde hoy tiene que decir dónde ocurrió. Hoy solo insertan las
  dos funciones de inventario, y las dos ponen la ubicación siempre; esto
  impide que una tercera se olvide.

  No es SECURITY DEFINER: no necesita leer nada más que la fila que llega.
*/
create or replace function movimientos_exigir_ubicacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ubicacion_id is null then
    raise exception
      'Todo movimiento de inventario nuevo tiene que llevar su ubicación'
      using errcode = '23502';
  end if;

  return new;
end $$;

drop trigger if exists movimientos_con_ubicacion on movimientos_inventario;

create trigger movimientos_con_ubicacion
  before insert on movimientos_inventario
  for each row
  execute function movimientos_exigir_ubicacion();

/*
  Una función de disparador no se puede llamar como RPC, pero PostgreSQL
  le concede EXECUTE a PUBLIC al crearla. Se retira por la misma razón que
  en las demás: no hay motivo para que nadie la tenga.
*/
revoke execute on function movimientos_exigir_ubicacion() from public;
revoke execute on function movimientos_exigir_ubicacion() from anon, authenticated;
