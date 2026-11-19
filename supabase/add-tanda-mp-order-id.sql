-- SyncFinanzas — Orden de Mercado Pago por pago de tanda.
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
--
-- Qué agrega: la columna mp_order_id en tanda_payments, con el id de la
-- orden de Mercado Pago (ORDTST...) del intento de pago de ese periodo.
-- Sin esta columna la app sigue funcionando: el que paga abre el checkout
-- y el organizador verifica el comprobante con el botón verde «Verificar
-- pago»; con ella, el organizador también ve «Verificar en Mercado Pago»
-- en la fila de un pago abierto de otro participante, aunque la orden se
-- haya creado desde el teléfono del invitado.
--
-- Seguridad: sin RLS que tocar (la tabla ya lo tiene con denegación total);
-- solo el servidor con service_role accede a la base.

ALTER TABLE public.tanda_payments
  ADD COLUMN IF NOT EXISTS mp_order_id TEXT;

-- Verificación: debe devolver una fila con mp_order_id en la lista de
-- columnas de tanda_payments (o 0 filas si la columna ya existía con otro
-- nombre; en ese caso avise antes de seguir).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tanda_payments'
  AND column_name = 'mp_order_id';
