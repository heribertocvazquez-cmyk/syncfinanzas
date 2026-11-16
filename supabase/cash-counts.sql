-- SyncFinanzas — Arqueo de cuentas (auditoría).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de guardar un arqueo. Sin este archivo, la app
-- sigue funcionando normal: al pulsar "Guardar arqueo" aparece un aviso de
-- que falta ejecutar este archivo; nada se rompe y no se pierde ningún dato.
--
-- Qué agrega: las tablas cash_counts y cash_count_lines.
--   cash_counts: un arqueo guardado (quién lo hizo, nota, totales y fecha).
--     total_app: suma de lo que dice la app en las cuentas contadas.
--     total_counted: suma de lo contado en físico.
--     total_diff: contado menos lo que dice la app (negativo = falta).
--   cash_count_lines: una línea por cuenta y por el efectivo.
--     account_id null = Efectivo (movimientos sin cuenta).
--     account_name: foto del nombre al momento del arqueo.
--     app_balance: saldo que decía la app al guardar el arqueo.
--     counted_amount: lo contado en físico.
--     difference: contado menos saldo de la app.
--
-- El arqueo nunca cambia los saldos: solo muestra la diferencia para
-- revisarla después (historial de arqueos en Cuentas).
--
-- Seguridad: RLS activado con política de denegación total, igual que en el
-- esquema principal. Solo el servidor (Vercel Functions) con service_role
-- accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS cash_counts (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total_app DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_counted DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_diff DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_count_lines (
  id SERIAL PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES cash_counts(id),
  account_id INTEGER REFERENCES accounts(id),
  account_name TEXT NOT NULL,
  app_balance DOUBLE PRECISION NOT NULL,
  counted_amount DOUBLE PRECISION NOT NULL,
  difference DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_counts_household ON cash_counts(household_id);
CREATE INDEX IF NOT EXISTS idx_cash_count_lines_count ON cash_count_lines(count_id);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.cash_counts ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_counts' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.cash_counts AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
  EXECUTE 'ALTER TABLE public.cash_count_lines ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_count_lines' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.cash_count_lines AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
