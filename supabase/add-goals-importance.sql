-- SyncFinanzas — Importancia 1–5 de las metas (la de 5 se fija arriba de Inicio).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la importancia de una meta se pueda guardar:
-- sin esta columna la app sigue funcionando (todas las metas quedan en 3 y
-- nada se fija arriba), pero cambiar la importancia no se guarda.
--
-- Qué agrega: la columna importance en goals, de 1 a 5, con defecto 3.
-- Con 5, la meta se fija arriba de Inicio (variante A: lo primero de
-- Inicio, arriba del total del ingreso); con menos de 5, queda en su
-- lugar normal. Desempate entre dos 5: más avanzada primero, luego la
-- más antigua.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5);
