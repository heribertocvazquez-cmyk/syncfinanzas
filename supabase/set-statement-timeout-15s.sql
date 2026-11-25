-- B-15 (hardening idea #22): el límite de 15 s por consulta NO está
-- en vigor. server/src/db.ts envía options "-c statement_timeout=15000",
-- pero Supavisor en modo transacción ignora silenciosamente los options
-- de inicio de libpq; el límite efectivo es el defecto del clúster
-- (~2 min). La corrección es fijarlo en el rol, desde el editor SQL
-- de Supabase (no es un cambio de código y no se puede verificar
-- desde la app; se comprueba con la consulta de abajo).
--
-- Cómo correrlo: Supabase → SQL Editor → New query → pegar todo →
-- Run. Es idempotente: correrlo dos veces deja el mismo valor.

ALTER ROLE postgres SET statement_timeout = '15s';

-- Comprobación: debe mostrar statement_timeout=15s en rolconfig.
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'postgres';
