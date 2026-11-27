-- SyncFinanzas — Arreglos de tandas: multas con comprobante, exclusión
-- por id con destino del turno, tarjeta simulada y voto de acuerdo
-- (decisiones de Heriberto 2026-11-26 ~21:27 y ~21:30).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe correrse ANTES del despliegue que usa estas columnas.
--
-- Qué agrega:
--   tandas.kind ('ordinaria' | 'compartamos', por defecto 'ordinaria'):
--     distingue la tanda ordinaria (sin multas) de la tanda Compartamos
--     (grupo formal, con multas). Las tandas que ya existen quedan como
--     ordinarias. El candado de multas solo aplica a las Compartamos.
--   tanda_fines.proof_blob_key / verified / fund_entry_id: el comprobante
--     de la multa, si ya se verificó, y el apunte de fondo creado al
--     verificar (para poder retirarlo). Sin estas columnas la multa no
--     puede pagarse con comprobante.
--   tanda_votes.voter_participant_id / voter_user_id: quién votó, por id
--     (no por nombre): dos personas con el mismo nombre ya no comparten
--     un voto. voterName queda solo como texto visible.
--   tanda_participants.extra_draw_order / replaces_participant_id: el
--     destino del turno de un excluido — (a) un reemplazo que toma su
--     número de sorteo, o (b) un participante activo que recibe ese turno
--     además del suyo.
--
-- Sin estas columnas la app sigue funcionando: las lecturas son tolerantes
-- (la vista muestra las tandas como ordinarias, sin comprobante de multa
-- ni destino de turno); las escrituras nuevas fallan con el error de la
-- base, por eso el SQL va antes del despliegue.
--
-- Seguridad: sin RLS que tocar (las tablas ya lo tienen con denegación
-- total); solo el servidor con service_role accede a la base.

ALTER TABLE public.tandas
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ordinaria';

ALTER TABLE public.tanda_fines
  ADD COLUMN IF NOT EXISTS proof_blob_key TEXT,
  ADD COLUMN IF NOT EXISTS verified INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fund_entry_id INTEGER;

ALTER TABLE public.tanda_votes
  ADD COLUMN IF NOT EXISTS voter_participant_id INTEGER,
  ADD COLUMN IF NOT EXISTS voter_user_id TEXT;

ALTER TABLE public.tanda_participants
  ADD COLUMN IF NOT EXISTS extra_draw_order INTEGER,
  ADD COLUMN IF NOT EXISTS replaces_participant_id INTEGER;

-- Verificación: debe devolver una fila por cada columna nueva.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'tandas' AND column_name = 'kind')
    OR (table_name = 'tanda_fines' AND column_name IN ('proof_blob_key', 'verified', 'fund_entry_id'))
    OR (table_name = 'tanda_votes' AND column_name IN ('voter_participant_id', 'voter_user_id'))
    OR (table_name = 'tanda_participants' AND column_name IN ('extra_draw_order', 'replaces_participant_id'))
  )
ORDER BY table_name, column_name;
