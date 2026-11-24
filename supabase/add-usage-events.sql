-- SyncFinanzas — Analítica de uso de la prueba (2026-11-24, aprobada por Heriberto).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse para que la analítica registre: sin esta tabla la app
-- sigue funcionando igual, pero ningún evento se guarda (logUsage devuelve
-- saved:false en silencio; la analítica nunca interrumpe el uso de la app).
--
-- Qué agrega: la tabla usage_events, una fila por evento: SOLO el módulo
-- (pantalla) y el botón (nombre de la acción), con fecha y hora, por hogar
-- y por usuario. NUNCA importes, conceptos, cuentas, fotos ni ningún
-- contenido de lo que el usuario guarda: la lista de módulos y acciones
-- permitidas la impone el servidor (server/src/actions.ts, logUsage).
--
-- Quién lo ve: solo el dueño de la app, en la tarjeta «Analítica de uso»
-- (junto a «Usuarios de la app»): botones más usados de todos, por usuario
-- (módulos y botones con conteos, por cuenta o usuario) y el detalle de
-- cada acción (fecha, módulo, botón). Se borra al terminar el piloto.
--
-- Seguridad: RLS activado con política de denegación total, igual que en
-- el esquema principal y en legal_acceptances. Solo el servidor (Vercel
-- Functions) con service_role accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id INTEGER NOT NULL,
  user_id UUID NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_household_idx ON usage_events (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events (user_id, created_at DESC);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='usage_events' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.usage_events AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
