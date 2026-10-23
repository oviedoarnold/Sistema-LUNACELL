-- Los números de factura y de documento interno solo los gasta el registro
-- de un documento (A-1).
--
-- siguiente_correlativo() era SECURITY DEFINER y la aplicación la llama para
-- numerar las cotizaciones. Pero `authenticated` podía pedirle también
-- 'factura' o 'interno': cualquier usuario con sesión, aunque no tuviera
-- permiso de facturar, subía el contador sin crear ningún documento y
-- dejaba un hueco en el rango autorizado del CAI.
--
-- Por qué deja de ser SECURITY DEFINER: dentro de una función SECURITY
-- DEFINER, current_user es siempre su dueño, también cuando la llama la
-- aplicación directamente, así que la función no puede saber quién la
-- llamó. Como SECURITY INVOKER sí lo sabe:
-- 1. la aplicación (authenticated, anon) solo puede pedir 'cotizacion';
-- 2. 'factura' e 'interno' los piden registrar_venta_ubicacion() y
--    conciliar_venta(), que son SECURITY DEFINER del dueño de la base:
--    dentro de ellas current_user es ese dueño y la regla 1 no las alcanza;
-- 3. el número de cotización lo entrega siguiente_correlativo_de_cotizacion(),
--    SECURITY DEFINER, porque un vendedor no puede escribir en `empresas`.
--    Solo sabe hacer eso.
-- Mismo criterio que los disparadores de 0027 y 0030: se vigila a la
-- aplicación (authenticated/anon) y no al dueño de la base.
--
-- anon y PUBLIC dejan de poder ejecutarlas: sin sesión nunca sirvieron
-- (empresa_del_usuario() es null).
--
-- Lo que NO cambia: el nombre, los argumentos y el retorno de
-- siguiente_correlativo(), así que ni la aplicación ni las funciones que la
-- llaman se tocan; el search_path; y el candado (el UPDATE ... RETURNING
-- sobre la fila de la empresa sigue serializando a dos pedidos
-- simultáneos). No toca ningún contador ni ningún dato. Idempotente.

create or replace function siguiente_correlativo_de_cotizacion()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := empresa_del_usuario();
  v_numero  bigint;
begin
  if v_empresa is null then
    raise exception 'El usuario no pertenece a ninguna empresa';
  end if;

  update empresas
    set proximo_correlativo_cotizacion = proximo_correlativo_cotizacion + 1
    where id = v_empresa
    returning proximo_correlativo_cotizacion - 1 into v_numero;

  return v_numero;
end;
$$;

create or replace function siguiente_correlativo(p_tipo text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  v_numero  bigint;
begin
  if p_tipo = 'cotizacion' then
    return siguiente_correlativo_de_cotizacion();
  end if;

  if current_user in ('authenticated', 'anon') then
    raise exception 'Los números de factura y de documento interno solo los asigna el registro de la venta'
      using errcode = '42501';
  end if;

  v_empresa := empresa_del_usuario();

  if v_empresa is null then
    raise exception 'El usuario no pertenece a ninguna empresa';
  end if;

  if p_tipo = 'factura' then
    update empresas
      set proximo_correlativo_factura = proximo_correlativo_factura + 1
      where id = v_empresa
      returning proximo_correlativo_factura - 1 into v_numero;

  elsif p_tipo = 'interno' then
    update empresas
      set proximo_correlativo_interno = proximo_correlativo_interno + 1
      where id = v_empresa
      returning proximo_correlativo_interno - 1 into v_numero;

  else
    raise exception 'Tipo de correlativo desconocido: %', p_tipo;
  end if;

  return v_numero;
end;
$$;

revoke execute on function siguiente_correlativo_de_cotizacion() from public, anon;
grant execute on function siguiente_correlativo_de_cotizacion() to authenticated, service_role;

revoke execute on function siguiente_correlativo(text) from public, anon;
grant execute on function siguiente_correlativo(text) to authenticated, service_role;
