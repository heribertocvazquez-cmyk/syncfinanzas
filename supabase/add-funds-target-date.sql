-- SyncFinanzas — Fecha límite de los fondos (la misma regla que las metas).
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la fecha límite de un fondo se pueda guardar:
-- sin esta columna la app sigue funcionando (los fondos quedan sin fecha y
-- el formulario la acepta igual), pero la fecha no se guarda y la app lo
-- avisa («La fecha límite se guardará cuando se ejecute el SQL pendiente»).
--
-- Qué agrega: la columna target_date en funds, fecha en texto YYYY-MM-DD
-- (igual que goals.target_date), opcional. Con fecha y meta, la tarjeta del
-- fondo muestra «Meta {fecha} · faltan $X/mes» (meses de 30 días, mínimo 1,
-- como en las metas); con fecha y sin meta, solo «Meta {fecha}».
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.funds
  ADD COLUMN IF NOT EXISTS target_date TEXT;
