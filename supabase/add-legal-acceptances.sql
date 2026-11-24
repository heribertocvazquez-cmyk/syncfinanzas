-- SyncFinanzas — Aceptación de los documentos legales.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la aceptación se pueda guardar: sin esta
-- tabla la app sigue funcionando, pero la puerta de aceptación no puede
-- registrar nada y al aceptar se avisa visiblemente que la aceptación se
-- guardará cuando se ejecute este SQL.
--
-- Qué agrega: la tabla legal_acceptances, con una fila por usuario: quién
-- aceptó, cuándo y QUÉ VERSIÓN de cada documento aceptó (aviso de
-- privacidad, términos y condiciones, política de reembolsos y apartado
-- «Versión de prueba»). Si en el futuro cambia la versión de algún
-- documento, la aceptación vieja ya no vale y la puerta vuelve a aparecer.
--
-- Seguridad: RLS activado con política de denegación total, igual que en
-- el esquema principal y en notifications.sql. Solo el servidor (Vercel
-- Functions) con service_role accede a la base; todo pasa por /api/actions.

CREATE TABLE IF NOT EXISTS legal_acceptances (
  user_id UUID PRIMARY KEY,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  privacy_version TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  refunds_version TEXT NOT NULL,
  notice_version TEXT NOT NULL
);

-- ---- RLS: denegación total ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='legal_acceptances' AND policyname='deny_all') THEN
    EXECUTE 'CREATE POLICY deny_all ON public.legal_acceptances AS RESTRICTIVE USING (false) WITH CHECK (false)';
  END IF;
END $$;
