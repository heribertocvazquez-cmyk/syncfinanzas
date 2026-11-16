-- Reglas de auto-categorización (mejora ligera 4)
-- Ejecutar en el SQL Editor de Supabase, una sola vez.
-- Si el concepto de un movimiento contiene la palabra (keyword), la app
-- pone sola esa categoría. Sin costos nuevos ni servicios nuevos.
-- Después de correrlo, las reglas se crean desde la pestaña Categorías.

create table if not exists public.category_rules (
  id serial primary key,
  household_id integer not null,
  keyword text not null,
  category_id integer not null,
  is_active integer not null default 1,
  created_at timestamp with time zone not null default now()
);

create index if not exists category_rules_household_idx
  on public.category_rules (household_id);

-- RLS con denegación total, igual que el resto de las tablas de la app:
-- solo el service_role (el servidor de Vercel) puede leer y escribir.
alter table public.category_rules enable row level security;

drop policy if exists category_rules_deny_all on public.category_rules;
create policy category_rules_deny_all
  on public.category_rules
  as restrictive for all
  to public
  using (false);
