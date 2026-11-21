-- SyncFinanzas — Importancia 1–5 de los fondos (la misma regla que las metas).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la importancia de un fondo se pueda guardar:
-- sin esta columna la app sigue funcionando (todos los fondos quedan en 3 y
-- nada se fija arriba de Inicio), pero cambiar la importancia no se guarda
-- y la app lo avisa («La importancia se guardará cuando se ejecute el SQL
-- pendiente»).
--
-- Qué agrega: la columna importance en funds, de 1 a 5, con defecto 3.
-- Con 5, el fondo se fija arriba de Inicio (igual que una meta en 5:
-- tarjeta dorada, lo primero de Inicio); con menos de 5, queda en la
-- lista de Fondos de Inicio. Desempate entre dos 5: más avanzado primero,
-- luego el más antiguo.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.funds
  ADD COLUMN IF NOT EXISTS importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5);
