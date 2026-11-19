-- SyncFinanzas — Canal de dudas y mejoras de testers.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES del despliegue que trae el canal de dudas y mejoras
-- (botón «Enviar comentarios», tipos de mensaje, aviso al dueño y cola de
-- evaluación con estados y respuesta).
--
-- Qué agrega a la tabla tester_feedback (creada con supabase/feedback.sql):
--  1. tipo: Duda / Error o corrección / Mejora (duda, error, mejora).
--  2. descripcion: el texto de la duda, el error o la mejora.
--  3. estado: estado de la evaluación del dueño (por_revisar, ya_existe,
--     error_confirmado, mejora_aprobada, descartado). Empieza en por_revisar.
--  4. respuesta: la respuesta del dueño al tester (la ve el tester al
--     consultar con su correo).
--  5. Las calificaciones (general y facilidad de uso) pasan a ser opcionales:
--     ya no son obligatorias al enviar una duda, un error o una mejora.
--
-- Sin este archivo la app sigue funcionando: el formulario nuevo no puede
-- guardar el tipo ni la descripción (el envío muestra el error formal), la
-- lista del dueño muestra las opiniones viejas con estado «Por revisar» y
-- la evaluación muestra que falta correr este archivo. Nada se rompe.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene: INSERT público,
-- SELECT denegado; solo el servidor con service_role lee y escribe).

ALTER TABLE public.tester_feedback
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'por_revisar',
  ADD COLUMN IF NOT EXISTS respuesta text;

ALTER TABLE public.tester_feedback
  ALTER COLUMN calificacion_general DROP NOT NULL,
  ALTER COLUMN facilidad_uso DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tester_feedback_tipo_check') THEN
    ALTER TABLE public.tester_feedback ADD CONSTRAINT tester_feedback_tipo_check CHECK (tipo IS NULL OR tipo IN ('duda', 'error', 'mejora'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tester_feedback_estado_check') THEN
    ALTER TABLE public.tester_feedback ADD CONSTRAINT tester_feedback_estado_check CHECK (estado IN ('por_revisar', 'ya_existe', 'error_confirmado', 'mejora_aprobada', 'descartado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tester_feedback_correo ON tester_feedback(correo);
CREATE INDEX IF NOT EXISTS idx_tester_feedback_estado ON tester_feedback(estado);
