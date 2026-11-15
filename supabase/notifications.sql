-- SyncFinanzas — Avisos dentro de la app (campanita + insignia del icono).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que funcionen los avisos en la app. La app sigue
-- funcionando sin este archivo: la campanita aparece vacía y no se crea
-- ningún aviso; nada se rompe.
--
-- Qué agrega: la tabla notifications, con un aviso por integrante del hogar
-- (user_id destinatario) en estos casos:
--  1. nuevo_integrante: alguien aceptó la invitación y se unió al hogar.
--  2. gasto_umbral: un gasto superó el límite del hogar (umbral).
--  3. presupuesto_excedido: el gasto del mes cruzó el presupuesto de su
--     categoría (solo al cruzar el límite, no en cada gasto posterior).
--
-- Seguridad: RLS activado con política de denegación total, igual que en el
-- esquema principal. Solo el servidor (Vercel Functions) con service_role
-- accede a la base; todo pasa por /api/actions. Cada usuario ve solo sus
-- propios avisos (el servidor filtra por user_id).

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION,
  target TEXT NOT NULL DEFAULT 'inicio',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_household_user ON notifications(household_id, user_id, created_at DESC);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.notifications AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
