-- SyncFinanzas — Posposición del aviso de sugerencia de presupuesto.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la posposición se pueda guardar: sin esta
-- tabla la app sigue funcionando (el aviso con sus dos botones aparece
-- igual), pero al pulsar «No por ahora» y guardar, la app avisa que la
-- posposición se guardará cuando se ejecute este SQL.
--
-- Qué agrega: la tabla budget_suggestion_snoozes, con una fila por hogar,
-- categoría y mes: «Avísame de nuevo cuando el total del mes llegue a $X».
-- Cuando el total del mes de una categoría sin presupuesto cruza el umbral
-- del hogar, el aviso pregunta si se crea un presupuesto; si se responde
-- «No por ahora», se guarda aquí el monto a partir del cual se vuelve a
-- preguntar. Mientras el total sea menor, no se crea aviso nuevo ni por
-- gasto nuevo ni al abrir la campanilla. Cada mes la regla empieza de
-- cero (la posposición es por mes). Si la categoría ya tiene presupuesto,
-- no hay sugerencia ni posposición.
--
-- Seguridad: RLS activado con política de denegación total, igual que en
-- el esquema principal y en notifications.sql. Solo el servidor (Vercel
-- Functions) con service_role accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS budget_suggestion_snoozes (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,
  next_threshold DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, category_id, month)
);

CREATE INDEX IF NOT EXISTS idx_budget_suggestion_snoozes_household_month ON budget_suggestion_snoozes(household_id, month);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.budget_suggestion_snoozes ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='budget_suggestion_snoozes' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.budget_suggestion_snoozes AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
