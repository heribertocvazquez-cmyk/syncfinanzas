-- SyncFinanzas — Plan de ahorro para una meta.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de guardar un plan de ahorro. Sin este archivo, la
-- app sigue funcionando normal: al pulsar "Aceptar plan" aparece un aviso
-- de que falta ejecutar este archivo; nada se rompe y no se pierde ningún
-- dato. La tabla notifications NO se modifica: los avisos del plan usan la
-- misma tabla (supabase/notifications.sql), y si esa tabla aún no existe,
-- los avisos simplemente no se crean hasta que se ejecute ese archivo.
--
-- Qué agrega: la tabla goal_plans, con un plan por meta (goal_id único):
--   monthly_amount: cuánto aportar al mes.
--   months: plazo del plan en meses.
--   start_month: mes en que empieza el plan (YYYY-MM).
--   due_day: día del mes en que toca aportar (por defecto, el día de corte
--     del hogar).
--   fund_id: fondo separado donde se aparta el dinero de la meta.
--   status: aceptado | en_riesgo | cumplido | cancelado.
--
-- Seguridad: RLS activado con política de denegación total, igual que en el
-- esquema principal. Solo el servidor (Vercel Functions) con service_role
-- accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS goal_plans (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  goal_id INTEGER NOT NULL REFERENCES goals(id),
  monthly_amount DOUBLE PRECISION NOT NULL,
  months INTEGER NOT NULL,
  start_month TEXT NOT NULL,
  due_day INTEGER NOT NULL DEFAULT 1,
  fund_id INTEGER REFERENCES funds(id),
  status TEXT NOT NULL DEFAULT 'aceptado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(goal_id)
);

CREATE INDEX IF NOT EXISTS idx_goal_plans_household ON goal_plans(household_id);
CREATE INDEX IF NOT EXISTS idx_goal_plans_goal ON goal_plans(goal_id);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.goal_plans ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_plans' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.goal_plans AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
