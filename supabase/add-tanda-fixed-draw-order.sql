-- SyncFinanzas — Número fijo elegido para el sorteo de una tanda.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
--
-- Qué agrega: la columna fixed_draw_order en tanda_participants, con el
-- número que el Organizador elige para el Organizador o el Tesorero ANTES
-- del sorteo (cualquiera del 1 al N, no solo 1 o 10). El sorteo asigna
-- primero esos números fijos y revuelve solo a los demás entre los números
-- libres. Una vez corrido el sorteo los números quedan fijados
-- (turnsLocked) y ya no se pueden cambiar.
-- Sin esta columna la app sigue funcionando: nadie tiene número fijo y el
-- sorteo revuelve a todos como hoy; el selector de número fijo no se ofrece
-- hasta correr este SQL.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.tanda_participants
  ADD COLUMN IF NOT EXISTS fixed_draw_order INTEGER;

-- Verificación: debe devolver una fila con fixed_draw_order en la lista de
-- columnas de tanda_participants.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tanda_participants'
  AND column_name = 'fixed_draw_order';
