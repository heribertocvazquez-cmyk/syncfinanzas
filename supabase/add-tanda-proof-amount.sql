-- SyncFinanzas — Importe leído del comprobante de pago de tanda.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES del despliegue que trae el pago directo de tanda y
-- el aviso al organizador.
--
-- Qué agrega: la columna proof_amount en tanda_payments, con el importe que
-- el lector propio leyó del comprobante cuando el participante subió su pago.
-- Sin esta columna la app sigue funcionando: el pago con comprobante se
-- guarda y el aviso al organizador se crea con el importe en el texto, pero
-- la pantalla de verificación no puede mostrar los dos montos (pagado vs
-- monto de la tanda) para comparar; con ella, sí.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.tanda_payments
  ADD COLUMN IF NOT EXISTS proof_amount DOUBLE PRECISION;
