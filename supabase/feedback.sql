-- SyncFinanzas — Opiniones de testers (segunda etapa).
-- Ejecute este archivo en Supabase (SQL Editor) DESPUÉS de haber ejecutado
-- supabase/schema.sql. Crea la tabla tester_feedback, donde se guardan las
-- opiniones enviadas desde el formulario público (?feedback=1).
-- La lectura NO es pública: solo el servidor (service_role) lee la tabla y
-- la muestra al administrador del hogar en la pestaña Hogar.

CREATE TABLE IF NOT EXISTS tester_feedback (
  id serial PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT now(),
  nombre text,
  correo text,
  calificacion_general integer NOT NULL,
  facilidad_uso integer NOT NULL,
  que_funciono text,
  que_fallo text,
  sugerencia text,
  modulo text,
  dispositivo text
);

-- Las calificaciones son de 1 a 5 estrellas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tester_feedback_calificacion_check') THEN
    ALTER TABLE public.tester_feedback ADD CONSTRAINT tester_feedback_calificacion_check CHECK (calificacion_general BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tester_feedback_facilidad_check') THEN
    ALTER TABLE public.tester_feedback ADD CONSTRAINT tester_feedback_facilidad_check CHECK (facilidad_uso BETWEEN 1 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tester_feedback_created ON tester_feedback(created_at DESC);

-- Seguridad por filas (RLS):
--  - INSERT público: cualquier tester puede enviar su opinión sin cuenta.
--  - SELECT denegado para el público: nadie puede leer las opiniones desde
--    el navegador. Solo el servidor, con la clave service_role (que no pasa
--    por RLS), las lee y las muestra al administrador del hogar.
ALTER TABLE public.tester_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_insert_public ON public.tester_feedback;
CREATE POLICY feedback_insert_public ON public.tester_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS feedback_select_denied ON public.tester_feedback;
CREATE POLICY feedback_select_denied ON public.tester_feedback
  AS RESTRICTIVE FOR SELECT USING (false);
