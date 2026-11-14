-- SyncFinanzas — Esquema de base de datos para Supabase (Postgres).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada
-- (CREATE TABLE IF NOT EXISTS). No contiene datos reales ni claves.
--
-- Seguridad: RLS activado en TODAS las tablas con política de denegación
-- total. La aplicación solo accede a la base desde el servidor (Vercel
-- Functions) con la clave service_role, que no está sujeta a RLS. Ni la
-- clave anónima ni los usuarios autenticados pueden leer ni escribir
-- directamente en las tablas: todo pasa por /api/actions, que valida la
-- sesión y la membresía del hogar en cada operación.

CREATE TABLE IF NOT EXISTS households (
  id SERIAL PRIMARY KEY,
  owner_user_id UUID,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  cutoff_day INTEGER NOT NULL DEFAULT 1,
  contribution_rule TEXT NOT NULL DEFAULT 'equal',
  approval_rule TEXT NOT NULL DEFAULT 'unanimous',
  approval_threshold DOUBLE PRECISION NOT NULL DEFAULT 1500,
  mode TEXT NOT NULL DEFAULT 'familiar',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_members (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  user_id UUID NOT NULL,
  profile_id INTEGER,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  user_id UUID,
  name TEXT NOT NULL,
  email TEXT,
  kind TEXT NOT NULL DEFAULT 'adult',
  dependent_type TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  monthly_income DOUBLE PRECISION NOT NULL DEFAULT 0,
  fixed_commitments DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'bank',
  visibility TEXT NOT NULL DEFAULT 'shared',
  initial_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_profile_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  subcategories TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS movements (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  concept TEXT NOT NULL,
  account_id INTEGER,
  to_account_id INTEGER,
  category_id INTEGER,
  subcategory TEXT,
  date TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'shared',
  profile_id INTEGER,
  receipt_blob_key TEXT,
  reversal_of_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  category_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'shared'
);

CREATE TABLE IF NOT EXISTS funds (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  target_amount DOUBLE PRECISION,
  visibility TEXT NOT NULL DEFAULT 'shared',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_movements (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  fund_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  account_id INTEGER
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL,
  saved_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_date TEXT,
  visibility TEXT NOT NULL DEFAULT 'shared',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreements (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreement_votes (
  id SERIAL PRIMARY KEY,
  agreement_id INTEGER NOT NULL REFERENCES agreements(id),
  profile_id INTEGER NOT NULL,
  vote TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patrimony_items (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  value DOUBLE PRECISION NOT NULL,
  owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  email TEXT NOT NULL,
  invited_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tandas (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  amount_per_quincena DOUBLE PRECISION NOT NULL,
  start_date TEXT NOT NULL,
  organizer_profile_id INTEGER,
  organizer_name TEXT,
  frequency TEXT NOT NULL DEFAULT 'quincenal',
  cadence_days INTEGER NOT NULL DEFAULT 15,
  draw_mode TEXT NOT NULL DEFAULT 'random',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tanda_participants (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  email TEXT,
  draw_order INTEGER,
  card_last4 TEXT,
  joined_date TEXT
);

CREATE TABLE IF NOT EXISTS tanda_payments (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  participant_id INTEGER NOT NULL,
  quincena_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  proof_blob_key TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tanda_invitations (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  email TEXT NOT NULL,
  invited_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizer_ratings (
  id SERIAL PRIMARY KEY,
  tanda_id INTEGER NOT NULL REFERENCES tandas(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  rater_name TEXT NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitation_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'household',
  email TEXT NOT NULL,
  household_id INTEGER REFERENCES households(id),
  tanda_id INTEGER REFERENCES tandas(id),
  invitation_id INTEGER,
  tanda_invitation_id INTEGER,
  invited_name TEXT,
  inviter_name TEXT,
  created_by_user_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_lockouts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para las consultas por hogar (todas las lecturas filtran por hogar).
CREATE INDEX IF NOT EXISTS idx_profiles_household ON profiles(household_id);
CREATE INDEX IF NOT EXISTS idx_accounts_household ON accounts(household_id);
CREATE INDEX IF NOT EXISTS idx_categories_household ON categories(household_id);
CREATE INDEX IF NOT EXISTS idx_movements_household ON movements(household_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON movements(date);
CREATE INDEX IF NOT EXISTS idx_budgets_household ON budgets(household_id);
CREATE INDEX IF NOT EXISTS idx_funds_household ON funds(household_id);
CREATE INDEX IF NOT EXISTS idx_goals_household ON goals(household_id);
CREATE INDEX IF NOT EXISTS idx_agreements_household ON agreements(household_id);
CREATE INDEX IF NOT EXISTS idx_patrimony_household ON patrimony_items(household_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_tandas_household ON tandas(household_id);
CREATE INDEX IF NOT EXISTS idx_tanda_participants_tanda ON tanda_participants(tanda_id);
CREATE INDEX IF NOT EXISTS idx_tanda_payments_tanda ON tanda_payments(tanda_id);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_hash ON invitation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_email ON invitation_tokens(email);
CREATE INDEX IF NOT EXISTS idx_activity_household ON activity_log(household_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON household_members(user_id);

-- RLS: denegación total por defecto. Solo el servidor (service_role) accede.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'households','household_members','profiles','accounts','categories','movements',
    'budgets','funds','fund_movements','goals','agreements','agreement_votes',
    'patrimony_items','invitations','invitation_tokens','tandas','tanda_participants','tanda_payments',
    'tanda_invitations','organizer_ratings','activity_log','rate_limits','auth_lockouts')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='deny_all') THEN
      EXECUTE format('CREATE POLICY deny_all ON public.%I AS RESTRICTIVE USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END $$;

-- Bucket privado para comprobantes (fotos de gastos y de pagos de tanda).
-- El navegador nunca sube directamente: solo el servidor, con service_role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes', 'comprobantes', false)
ON CONFLICT (id) DO NOTHING;
