-- Gastos recurrentes (primera mejora del benchmark v2, 2026-11-26)
-- Ejecutar en el SQL Editor de Supabase, una sola vez.
-- Una regla es un gasto que se repite (semanal, quincenal o mensual).
-- La app NUNCA registra sola: cuando vence una fecha, crea una
-- ocurrencia pendiente y un aviso en la campana; el usuario confirma
-- en un toque (se crea el movimiento) u omite esa fecha (la regla
-- sigue viva). Una misma fecha nunca genera dos avisos ni dos
-- movimientos: recurring_occurrences tiene UNIQUE (rule_id, due_date).
-- Después de correrlo, las reglas se crean desde «Gastos recurrentes»
-- en el cajón y desde el formulario «Nuevo gasto» («Repetir este
-- gasto»). Sin costos nuevos ni servicios nuevos.

create table if not exists public.recurring_rules (
  id serial primary key,
  household_id integer not null,
  concept text not null,
  amount double precision not null,
  account_id integer not null,
  category_id integer,
  frequency text not null,
  day_of_month integer,
  weekday integer,
  start_date text not null,
  end_date text,
  last_prompted_date text,
  visibility text not null default 'shared',
  is_active integer not null default 1,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create index if not exists recurring_rules_household_idx
  on public.recurring_rules (household_id);

create table if not exists public.recurring_occurrences (
  id serial primary key,
  rule_id integer not null,
  due_date text not null,
  status text not null default 'pending',
  movement_id integer,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  unique (rule_id, due_date)
);

create index if not exists recurring_occurrences_rule_idx
  on public.recurring_occurrences (rule_id);

create index if not exists recurring_occurrences_status_idx
  on public.recurring_occurrences (status);

-- RLS con denegación total, igual que el resto de las tablas de la app:
-- solo el service_role (el servidor de Vercel) puede leer y escribir.
alter table public.recurring_rules enable row level security;

drop policy if exists recurring_rules_deny_all on public.recurring_rules;
create policy recurring_rules_deny_all
  on public.recurring_rules
  as restrictive for all
  to public
  using (false);

alter table public.recurring_occurrences enable row level security;

drop policy if exists recurring_occurrences_deny_all on public.recurring_occurrences;
create policy recurring_occurrences_deny_all
  on public.recurring_occurrences
  as restrictive for all
  to public
  using (false);
