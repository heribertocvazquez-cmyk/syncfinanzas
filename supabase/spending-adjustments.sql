-- SyncFinanzas — Ajuste automático de gastos para llegar a la meta.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de proponer o aceptar un ajuste de gastos. Sin este
-- archivo, la app sigue funcionando normal: al revisar un ajuste aparece un
-- aviso de que falta ejecutar este archivo; nada se rompe y no se pierde
-- ningún dato. La tabla notifications NO se modifica: los avisos del ajuste
-- usan la misma tabla (supabase/notifications.sql), y si esa tabla aún no
-- existe, los avisos simplemente no se crean hasta que se ejecute ese archivo.
--
-- Qué agrega: la tabla spending_adjustments, con una propuesta por meta y
-- mes. Nada se aplica solo: la propuesta se crea, se avisa con la campanita
-- ANTES de mover nada, y solo se aplica si el usuario la acepta.
--   kind: recorte (una categoría se pasó de su presupuesto y se recorta de
--     otras con margen) o sobrante (un mes se gastó menos y el sobrante puede
--     ir al fondo de la meta).
--   status: propuesto | aplicado | rechazado.
--   over_category_name / over_amount: qué categoría se pasó y cuánto.
--   cuts: JSON con los recortes [{categoryId, name, amount, newBudget}] o,
--     en un sobrante, los montos a mover [{categoryId, name, amount}].
--   new_monthly_amount / new_months: si la aportación a la meta cambia, es
--     poco y repartida en los meses que quedan; extended_months es el plazo
--     nuevo si hubo que alargar la meta para cubrir todo.
--   covers_all: 1 si el ajuste cubre gastos fijos, presupuestos y la
--     aportación a la meta sin dejar nada sin cubrir; 0 si no alcanza.
--
-- Seguridad: RLS activado con política de denegación total, igual que en el
-- esquema principal. Solo el servidor (Vercel Functions) con service_role
-- accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS spending_adjustments (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  goal_id INTEGER NOT NULL REFERENCES goals(id),
  month TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'propuesto',
  over_category_id INTEGER,
  over_category_name TEXT NOT NULL DEFAULT '',
  over_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  cuts TEXT NOT NULL DEFAULT '[]',
  new_monthly_amount DOUBLE PRECISION,
  new_months INTEGER,
  extended_months INTEGER NOT NULL DEFAULT 0,
  covers_all INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spending_adjustments_household ON spending_adjustments(household_id);
CREATE INDEX IF NOT EXISTS idx_spending_adjustments_goal_month ON spending_adjustments(goal_id, month, status);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.spending_adjustments ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='spending_adjustments' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.spending_adjustments AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
