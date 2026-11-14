-- SyncFinanzas — Tandas v3 ("modo Compartamos").
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que funcionen las funciones nuevas de tandas en
-- la app (pase de lista, roles, multas, votaciones, entregas y saldos
-- separados). La app sigue funcionando sin este archivo: las tandas
-- anteriores se ven como siempre y las funciones nuevas aparecen vacías.
--
-- Qué agrega (sin intereses, sin CAT, sin Buró: la tanda sigue siendo
-- ahorro entre conocidos):
--  1. Reglas de la tanda: cobertura si alguien no paga (fondo solidario,
--     prórroga o reparto), multa por retardo o falta, día fijo de reunión,
--     tesorero y suplente, turnos bloqueados tras el sorteo.
--  2. Roles por participante: organizador, tesorero, suplente o participante.
--  3. Estado "atrasado" en los pagos, con multa por pago.
--  4. Multas, votaciones de exclusión, confirmaciones de entrega y
--     movimientos de fondos separados (aportación, fondo solidario, multas).
--
-- Seguridad: RLS activado en las tablas nuevas con política de denegación
-- total, igual que en el esquema principal. Solo el servidor (Vercel
-- Functions) con service_role accede a la base; todo pasa por /api/actions.

-- ---- Columnas nuevas en tandas ----
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS coverage_rule TEXT NOT NULL DEFAULT 'fondo';
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS fine_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS turns_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS treasurer_profile_id INTEGER;
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS substitute_profile_id INTEGER;
ALTER TABLE tandas ADD COLUMN IF NOT EXISTS meeting_day TEXT NOT NULL DEFAULT '';

-- ---- Columnas nuevas en participantes ----
ALTER TABLE tanda_participants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participante';
ALTER TABLE tanda_participants ADD COLUMN IF NOT EXISTS excluded INTEGER NOT NULL DEFAULT 0;

-- ---- Columnas nuevas en pagos ----
ALTER TABLE tanda_payments ADD COLUMN IF NOT EXISTS fine_amount DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ---- Multas por retardo o falta ----
CREATE TABLE IF NOT EXISTS tanda_fines (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  participant_id INTEGER NOT NULL,
  quincena_index INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL DEFAULT 'retardo',
  status TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Votaciones para excluir a un participante ----
CREATE TABLE IF NOT EXISTS tanda_votes (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  target_participant_id INTEGER NOT NULL,
  voter_name TEXT NOT NULL,
  vote TEXT NOT NULL DEFAULT 'excluir',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Confirmación doble de entrega por periodo ----
CREATE TABLE IF NOT EXISTS tanda_deliveries (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  quincena_index INTEGER NOT NULL,
  receiver_id INTEGER,
  organizer_confirmed INTEGER NOT NULL DEFAULT 0,
  receiver_confirmed INTEGER NOT NULL DEFAULT 0,
  organizer_confirmed_at TIMESTAMPTZ,
  receiver_confirmed_at TIMESTAMPTZ,
  UNIQUE (tanda_id, quincena_index)
);

-- ---- Movimientos de fondos separados de la tanda ----
-- kind: aportacion (aportación del periodo), fondo (fondo solidario),
-- multa (pago de una multa).
CREATE TABLE IF NOT EXISTS tanda_fund_entries (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  participant_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'fondo',
  amount DOUBLE PRECISION NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tanda_fines_tanda ON tanda_fines(tanda_id);
CREATE INDEX IF NOT EXISTS idx_tanda_votes_tanda ON tanda_votes(tanda_id);
CREATE INDEX IF NOT EXISTS idx_tanda_deliveries_tanda ON tanda_deliveries(tanda_id);
CREATE INDEX IF NOT EXISTS idx_tanda_fund_entries_tanda ON tanda_fund_entries(tanda_id);

-- ---- RLS: denegación total en las tablas nuevas ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tanda_fines','tanda_votes','tanda_deliveries','tanda_fund_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='deny_all') THEN
      EXECUTE format('CREATE POLICY deny_all ON public.%I AS RESTRICTIVE USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END $$;
