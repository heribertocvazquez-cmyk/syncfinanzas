-- Reasignar a la cuenta de Efectivo los movimientos sin cuenta
-- Ejecutar en el SQL Editor de Supabase, una sola vez.
--
-- Qué hace: toma los movimientos de gasto e ingreso del hogar de Heriberto
-- que hoy no tienen cuenta (account_id null) y les pone la cuenta de
-- Efectivo real. A partir de ahí, esos gastos se descuentan del saldo de
-- Efectivo y esos ingresos entran a Efectivo, como corresponde.
--
-- Qué NO toca:
--   * Ningún movimiento que ya tiene cuenta (Mercado Libre y demás quedan igual).
--   * Transferencias ni pagos de deuda sin cuenta (siguen como «Sin cuenta»).
--   * Movimientos reversados ni reversiones (no se tocan nunca).
--   * No se borra ni se fusiona ninguna cuenta.
--   * Solo afecta al hogar de Heriberto (owner_user_id de su cuenta).
--
-- Si hay dos cuentas de Efectivo, se usa la que ya tiene movimientos
-- (la usada; en empate, la más antigua). Las filas de cuenta no se tocan.
--
-- Consecuencia: después de correrlo, el saldo de Efectivo es
--   saldo inicial + ingresos − gastos (− pagos de deuda).
-- El sueldo ($5,500) es solo una cifra mensual del perfil: nunca entra
-- como movimiento a ninguna cuenta. Si el saldo de Efectivo queda en
-- negativo es porque el sueldo nunca se depositó; eso NO se ajusta aquí.
--
-- Cómo correrlo (en orden):
--   1. Corra el PASO 0 y revise que el hogar y la cuenta de Efectivo sean
--      los correctos, y cuántos movimientos van a cambiar.
--   2. Corra el PASO 1 (el ajuste). Si algo no cuadra, el script se detiene
--      solo con un error y no cambia nada.
--   3. Corra el PASO 2 y confirme que ya no quedan gastos ni ingresos sin
--      cuenta y que el saldo de Efectivo es el esperado.
-- El script se puede correr dos veces: la segunda ya no cambia nada.

-- ============================================================
-- PASO 0 — Verificación ANTES (solo lectura, no cambia nada)
-- ============================================================

-- El hogar de Heriberto (debe salir una sola fila: «Hogar Heriberto»).
select id, name, mode, owner_user_id
from public.households
where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d';

-- Cuentas candidatas a Efectivo en ese hogar, con sus movimientos.
-- La marcada con * es la que usará el ajuste (más movimientos; en empate,
-- la de id menor).
select
  a.id,
  a.name,
  a.type,
  a.initial_balance as saldo_inicial,
  count(m.id) as movimientos,
  case when a.id = (
    select a2.id
    from public.accounts a2
    left join public.movements m2
      on m2.account_id = a2.id
      and m2.household_id = a2.household_id
    where a2.household_id = h.id
      and (lower(a2.name) = 'efectivo' or a2.type = 'cash')
    group by a2.id
    order by count(m2.id) desc, a2.id asc
    limit 1
  ) then '*' else '' end as elegida
from public.households h
join public.accounts a on a.household_id = h.id
left join public.movements m on m.account_id = a.id
where h.owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d'
  and (lower(a.name) = 'efectivo' or a.type = 'cash')
group by h.id, a.id, a.name, a.type, a.initial_balance
order by movimientos desc, a.id asc;

-- Movimientos sin cuenta, por tipo (antes del ajuste).
-- Solo «expense» e «income» van a cambiar; «transfer» y «debt_payment»
-- quedan como están.
select
  type as tipo,
  count(*) as cantidad,
  coalesce(sum(amount), 0) as total
from public.movements
where household_id in (
  select id from public.households
  where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d'
)
  and account_id is null
  and reversal_of_id is null
  and id not in (select reversal_of_id from public.movements where reversal_of_id is not null)
group by type
order by type;

-- ============================================================
-- PASO 1 — El ajuste (con guardas: si algo no cuadra, no cambia nada)
-- ============================================================

do $$
declare
  v_household_id integer;
  v_household_count integer;
  v_efectivo_id integer;
  v_changed integer;
begin
  select count(*) into v_household_count
  from public.households
  where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d';
  if v_household_count <> 1 then
    raise exception 'Se esperaba exactamente 1 hogar para este usuario y hay %. Revise antes de correr el ajuste.', v_household_count;
  end if;
  select id into v_household_id
  from public.households
  where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d';

  select a.id into v_efectivo_id
  from public.accounts a
  left join public.movements m
    on m.account_id = a.id
    and m.household_id = v_household_id
  where a.household_id = v_household_id
    and (lower(a.name) = 'efectivo' or a.type = 'cash')
  group by a.id
  order by count(m.id) desc, a.id asc
  limit 1;
  if v_efectivo_id is null then
    raise exception 'No hay cuenta de Efectivo en el hogar. Cree la cuenta primero y vuelva a correr el script.';
  end if;

  update public.movements
  set account_id = v_efectivo_id
  where household_id = v_household_id
    and account_id is null
    and type in ('expense', 'income')
    and reversal_of_id is null
    and id not in (select reversal_of_id from public.movements where reversal_of_id is not null);
  get diagnostics v_changed = row_count;
  raise notice 'Movimientos reasignados a la cuenta de Efectivo (id %): %', v_efectivo_id, v_changed;
end $$;

-- ============================================================
-- PASO 2 — Verificación DESPUÉS (solo lectura, no cambia nada)
-- ============================================================

-- Ya no debe quedar ningún gasto ni ingreso sin cuenta en el hogar.
-- (Si aparecen «transfer» o «debt_payment», es lo esperado: no se tocan.)
select
  type as tipo,
  count(*) as cantidad,
  coalesce(sum(amount), 0) as total
from public.movements
where household_id in (
  select id from public.households
  where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d'
)
  and account_id is null
  and reversal_of_id is null
  and id not in (select reversal_of_id from public.movements where reversal_of_id is not null)
group by type
order by type;

-- Saldo de la cuenta de Efectivo después del ajuste:
-- saldo inicial + ingresos − gastos − pagos de deuda
-- (sin reversados ni reversiones; el sueldo NO entra aquí).
select
  a.id as cuenta_id,
  a.name as cuenta,
  a.initial_balance as saldo_inicial,
  coalesce(sum(case when m.type = 'income' then m.amount else 0 end), 0) as ingresos,
  coalesce(sum(case when m.type = 'expense' then m.amount else 0 end), 0) as gastos,
  coalesce(sum(case when m.type = 'debt_payment' then m.amount else 0 end), 0) as pago_deuda,
  a.initial_balance
    + coalesce(sum(case when m.type = 'income' then m.amount else 0 end), 0)
    - coalesce(sum(case when m.type = 'expense' then m.amount else 0 end), 0)
    - coalesce(sum(case when m.type = 'debt_payment' then m.amount else 0 end), 0) as saldo_efectivo
from public.accounts a
left join public.movements m
  on m.account_id = a.id
  and m.reversal_of_id is null
  and m.id not in (select reversal_of_id from public.movements where reversal_of_id is not null)
where a.household_id in (
  select id from public.households
  where owner_user_id = '88531f08-8ec9-4486-87d1-0f6a5d67b06d'
)
  and a.id = (
    select a2.id
    from public.accounts a2
    left join public.movements m2
      on m2.account_id = a2.id
      and m2.household_id = a2.household_id
    where a2.household_id = a.household_id
      and (lower(a2.name) = 'efectivo' or a2.type = 'cash')
    group by a2.id
    order by count(m2.id) desc, a2.id asc
    limit 1
  )
group by a.id, a.name, a.initial_balance;
