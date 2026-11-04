-- Referencias opcionales: transferencia, tarjeta y enlace ya no exigen número de
-- operación, para que un vendedor que no lo tiene no quede bloqueado.
--
-- Solo cambian dos reglas: la restricción de cobros_por_medio y una comprobación
-- de medios_de_cobro_invalidos(). Esa función la usan la venta, el abono, la
-- sincronización y el rescate, así que todos quedan cubiertos sin tocarlos.
--
-- Se conservan el medio válido, el importe positivo, la suma exacta, que el
-- efectivo no lleve referencia, el largo máximo y el rechazo de una referencia
-- que no sea texto. Las versiones actuales siguen funcionando: mandan referencia.
--
-- Va antes que el frontend que deja de pedirla. Al revés, esas ventas fallarían.

alter table public.cobros_por_medio drop constraint if exists cobros_por_medio_referencia;

alter table public.cobros_por_medio add constraint cobros_por_medio_referencia check (
  (medio = 'efectivo' and referencia = '')
  or (
    medio <> 'efectivo'
    and (referencia = '' or btrim(referencia) <> '')
    and char_length(referencia) <= 120
  )
);

-- Qué tienen de mal formado los medios; null si nada. Nunca lanza.
create or replace function public.medios_de_cobro_invalidos(p_cobros jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cobro      jsonb;
  v_medio      text;
  v_monto      numeric;
  v_referencia text;
  v_vistos     text[] := '{}';
begin
  if jsonb_typeof(p_cobros) is distinct from 'array'
     or jsonb_array_length(p_cobros) not between 1 and 4 then
    return 'Indica entre uno y cuatro medios de pago';
  end if;

  for v_cobro in select * from jsonb_array_elements(p_cobros) loop
    if jsonb_typeof(v_cobro) <> 'object' then
      return 'Un medio de pago no es válido';
    end if;

    v_medio := v_cobro->>'medio';

    if v_medio is null or v_medio not in ('efectivo', 'transferencia', 'tarjeta', 'enlace') then
      return 'Un medio de pago no es válido';
    end if;

    if v_medio = any (v_vistos) then
      return 'Cada medio de pago se indica una sola vez';
    end if;

    v_vistos := v_vistos || v_medio;

    begin
      v_monto := (v_cobro->>'monto')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return 'El importe de un medio de pago no es válido';
    end;

    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) or v_monto >= 10000000000 then
      return 'El importe de un medio de pago no es válido';
    end if;

    if jsonb_typeof(coalesce(v_cobro->'referencia', 'null'::jsonb)) not in ('string', 'null') then
      return 'La referencia de un medio de pago no es válida';
    end if;

    v_referencia := btrim(coalesce(v_cobro->>'referencia', ''));

    if v_medio = 'efectivo' and v_referencia <> '' then
      return 'El efectivo no lleva referencia';
    end if;

    if char_length(v_referencia) > 120 then
      return 'La referencia es demasiado larga';
    end if;
  end loop;

  return null;
end $$;
