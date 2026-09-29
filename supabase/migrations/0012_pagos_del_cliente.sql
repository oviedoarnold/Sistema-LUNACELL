-- Pagos del cliente: la cabecera del dinero que entra.
--
-- Hoy un abono pertenece a una factura y nada más. Eso obliga al cajero a
-- repartir a mano el pago de un cliente que debe cuatro facturas, y deja
-- dos errores que después nadie puede detectar: repartir mal, y dar por
-- abierta una factura que ya estaba cubierta.
--
-- Lo que falta no es una pantalla, es una entidad. Un cliente que paga no
-- paga facturas: paga lo que debe. Esta migración crea el lugar donde vive
-- ese hecho.
--
-- El reparto queda por ENCIMA de lo que ya existe, no lo sustituye. El
-- saldo de una factura sigue siendo su total menos la suma de sus abonos,
-- exactamente como hasta ahora, porque el abono no deja de apuntar a su
-- factura: gana además un padre. De ahí que abonos.pago_id sea nullable y
-- que venta_id siga siendo obligatorio.
--
--   pago  →  varios abonos  →  cada abono pertenece a una factura
--
-- Esta migración crea SOLO la estructura. El reparto FIFO es una función
-- con candado de fila y llega en su propia rama; aquí no hay ni RPC, ni
-- vista de saldos, ni nada que el frontend pueda llamar todavía.

create table if not exists pagos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas (id) on delete cascade,

  -- Obligatorio: un pago consolidado sin cliente no significa nada, y la
  -- base ya garantiza que toda venta a crédito tiene uno (el check
  -- credito_exige_cliente sobre ventas).
  --
  -- Se restringe el borrado en vez de anularlo como hace ventas. Anularlo
  -- chocaría con el not null, y borrar en cascada destruiría el registro
  -- de un dinero que de verdad entró. Un cliente que pagó no se puede
  -- borrar sin decidir antes qué pasa con su historial de pagos.
  --
  -- La referencia lleva la empresa dentro a propósito; el porqué está
  -- abajo, junto al índice que la hace posible.
  cliente_id  uuid not null,

  -- Quién lo registró. Se anula si la cuenta desaparece, igual que en
  -- ventas y abonos: el pago sobrevive a la baja del empleado.
  usuario_id  uuid references usuarios (id) on delete set null,

  monto       numeric(12,2) not null check (monto > 0),

  -- El saldo del cliente antes y después. No es información redundante que
  -- se pueda recalcular: es lo que permite reconstruir el estado de la
  -- cuenta tal como estaba en el momento del cobro, aunque después se
  -- anule una factura o se registre otro pago.
  saldo_anterior   numeric(12,2) not null check (saldo_anterior >= 0),
  saldo_posterior  numeric(12,2) not null check (saldo_posterior >= 0),

  -- Un pago no se borra: se marca. Reversarlo será escribir renglones que
  -- compensan, nunca un delete, porque el dinero entró y eso no deja de
  -- ser cierto porque después se corrija.
  estado      text not null default 'aplicado'
                check (estado in ('aplicado', 'revertido')),

  fecha       timestamptz not null default now(),
  nota        text not null default '',

  clave_idempotencia text,

  /*
    Las tres columnas de dinero tienen que contar la misma historia. Y de
    esta igualdad, junto al check de que el saldo posterior no sea
    negativo, sale gratis la regla que el negocio pidió: si el monto
    supera lo que el cliente debe, el saldo posterior daría negativo y la
    fila no entra.

    El sobrepago queda así prohibido por la estructura y no solo por la
    función que reparta. Una función se puede reescribir mal; esto no
    depende de que nadie se acuerde.
  */
  constraint pagos_saldo_coherente
    check (saldo_posterior = saldo_anterior - monto)
);

/*
  Mismo patrón de idempotencia que ventas, cotizaciones y abonos: el
  intento trae su clave, el índice deja pasar solo al primero y el segundo
  recibe el pago que ya existía en vez de cobrar dos veces.

  Parcial por la misma razón que los otros tres: las filas sin clave no
  compiten entre sí.
*/
/*
  El cliente se referencia junto a la empresa, no solo por su id.

  Se probó contra el motor: con una llave simple, un usuario autenticado
  podía insertar un pago de SU empresa apuntando al cliente de otra. RLS no
  lo detiene porque solo mira pagos.empresa_id, y la llave simple solo
  exige que el cliente exista. El resultado sería una cuenta consolidada
  construida sobre un cliente que no es de la empresa.

  Emparejar las dos columnas lo vuelve imposible en el motor. Hace falta
  un índice único sobre el par en clientes: PostgreSQL solo acepta apuntar
  a columnas cubiertas por una restricción única. Como id ya es la clave
  primaria, el par es único de por sí y el índice no restringe nada nuevo.

  ventas.cliente_id tiene hoy esta misma debilidad. Se deja anotada y no se
  toca aquí: es una tabla que esta rama no vino a cambiar.
*/
create unique index if not exists clientes_id_empresa on clientes (id, empresa_id);

/*
  Si una corrida anterior de esta misma migración dejó la llave simple, se
  retira: la compuesta la cubre entera y mantener las dos haría el mismo
  trabajo dos veces. No toca datos, solo la restricción.
*/
alter table pagos drop constraint if exists pagos_cliente_id_fkey;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'pagos_cliente_de_mi_empresa'
       and conrelid = 'pagos'::regclass
  ) then
    alter table pagos
      add constraint pagos_cliente_de_mi_empresa
      foreign key (cliente_id, empresa_id) references clientes (id, empresa_id)
      on delete restrict;
  end if;
end $$;

create unique index if not exists pagos_clave_idempotencia
  on pagos (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

-- El historial de un cliente y la lista por fecha son las dos lecturas
-- que la pantalla hará siempre.
create index if not exists idx_pagos_cliente on pagos (cliente_id);
create index if not exists idx_pagos_empresa_fecha on pagos (empresa_id, fecha desc);

/*
  Hace falta para la llave compuesta de abonos de más abajo: PostgreSQL
  solo acepta apuntar a columnas con una restricción única que las cubra.
*/
create unique index if not exists pagos_id_empresa on pagos (id, empresa_id);

-- ─────────────────────────────────────────────────────────
-- EL ABONO GANA UN PADRE
-- ─────────────────────────────────────────────────────────
/*
  pago_id es el renglón del reparto: de este pago, tanto fue a esta
  factura.

  Nullable a propósito, y no por conveniencia de la migración. El abono
  contra una factura suelta se conserva como vía válida para corregir
  casos puntuales, así que un abono sin pago_id no es un dato viejo a
  limpiar: es una forma legítima de cobrar que seguirá existiendo. Por eso
  tampoco hay backfill: no habría con qué rellenarlo ni sentido en
  inventarlo.

  Se restringe el borrado del pago: sus renglones no pueden quedar
  huérfanos ni desaparecer con él. Es la misma decisión que el estado
  'revertido', vista desde la base.
*/
alter table abonos
  add column if not exists pago_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'abonos_pago_id_fkey'
       and conrelid = 'abonos'::regclass
  ) then
    alter table abonos
      add constraint abonos_pago_id_fkey
      foreign key (pago_id) references pagos (id) on delete restrict;
  end if;
end $$;

/*
  Y la llave compuesta: un abono solo puede colgar de un pago de su misma
  empresa.

  RLS ya lo impide para cualquier consulta del navegador, pero la función
  que repartirá el dinero será SECURITY DEFINER y por definición pasa por
  encima de RLS. Si algún día se escribe con un error, esto lo detiene en
  el motor. Es barato y cierra la única puerta que quedaba entre empresas.
*/
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'abonos_pago_de_mi_empresa'
       and conrelid = 'abonos'::regclass
  ) then
    alter table abonos
      add constraint abonos_pago_de_mi_empresa
      foreign key (pago_id, empresa_id) references pagos (id, empresa_id);
  end if;
end $$;

create index if not exists idx_abonos_pago on abonos (pago_id);

-- ─────────────────────────────────────────────────────────
-- POLÍTICA DE ACCESO
-- ─────────────────────────────────────────────────────────
-- Mismo aislamiento que el resto del esquema: la empresa se resuelve en el
-- motor con empresa_del_usuario(), nunca llega desde el navegador.

alter table pagos enable row level security;

drop policy if exists pagos_de_mi_empresa on pagos;

create policy pagos_de_mi_empresa on pagos
  for all
  to authenticated
  using (empresa_id = empresa_del_usuario())
  with check (empresa_id = empresa_del_usuario());
