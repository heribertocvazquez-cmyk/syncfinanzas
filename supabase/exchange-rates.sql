-- Conversión de moneda (alcance B, 2026-11-26): tipos de cambio del BCE
-- (Frankfurter, gratis, sin clave) guardados en Supabase y conversión
-- congelada al registrar cada movimiento.
--
-- Ejecutar en el SQL Editor de Supabase, una sola vez, ANTES de
-- desplegar la versión que usa la conversión. Sin este SQL, la app
-- sigue funcionando exactamente como hoy (alcance A): las cuentas y
-- los movimientos quedan en la moneda del hogar y el cliente avisa
-- cuando algo en otra moneda no se puede guardar.
--
-- Reglas que sostiene este SQL:
-- - movements.amount sigue siendo SIEMPRE el equivalente en la moneda
--   del hogar (invariante): los totales, presupuestos, fondos, tandas
--   y saldos no cambian. Los campos nuevos son solo informativos,
--   salvo transfer_to_amount (lo que recibe la cuenta destino de un
--   traspaso entre cuentas de distinta moneda).
-- - exchange_rates guarda la última tasa consultada por par
--   (base→destino) con su fecha de consulta; el servidor la usa si
--   tiene menos de 24 h y si no, pide una nueva a Frankfurter.
--   fetched_at es cuándo se consultó (para el límite de 24 h);
--   rate_date es la fecha de la tasa misma (la que muestra el aviso).
-- - accounts.currency: la moneda de la cuenta (libre: MXN, USD o EUR,
--   sin importar la moneda del hogar). Sin valor, la cuenta se trata
--   como moneda del hogar.
-- - accounts.initial_balance_original: el saldo inicial tal como se
--   escribió, en la moneda de la cuenta. accounts.initial_balance
--   sigue siendo el equivalente en moneda del hogar.
-- - movements.exchange_rate_date: la fecha de la tasa usada
--   (congelada), para mostrarla en el detalle del movimiento.
-- - fund_movements.original_amount: el importe del aporte o retiro tal
--   como se escribió, en la moneda de la cuenta; fund_movements.amount
--   sigue siendo el equivalente en moneda del hogar.
--
-- Idempotente: se puede correr más de una vez sin error.

create table if not exists public.exchange_rates (
  base_currency text not null,
  target_currency text not null,
  rate double precision not null,
  fetched_at timestamp with time zone not null default now(),
  rate_date text,
  primary key (base_currency, target_currency)
);

-- RLS con denegación total, igual que el resto de las tablas de la app:
-- solo el service_role (el servidor de Vercel) puede leer y escribir.
alter table public.exchange_rates enable row level security;

drop policy if exists exchange_rates_deny_all on public.exchange_rates;
create policy exchange_rates_deny_all
  on public.exchange_rates
  as restrictive for all
  to public
  using (false);

alter table accounts add column if not exists currency text;
alter table accounts add column if not exists initial_balance_original double precision;

alter table movements add column if not exists original_amount double precision;
alter table movements add column if not exists original_currency text;
alter table movements add column if not exists exchange_rate double precision;
alter table movements add column if not exists exchange_rate_date text;
alter table movements add column if not exists transfer_to_amount double precision;

alter table fund_movements add column if not exists original_amount double precision;

create index if not exists idx_movements_original_currency on movements (original_currency);
create index if not exists idx_exchange_rates_target on exchange_rates (target_currency);
