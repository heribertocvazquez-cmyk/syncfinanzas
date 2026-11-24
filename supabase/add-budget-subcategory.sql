-- SyncFinanzas — Subcategoría en presupuestos y «nacer como nuevo».
-- Cómo aplicarlo: en Supabase, abra SQL Editor > New query, pegue TODO este
-- archivo y pulse Run. Puede ejecutarse dos veces sin duplicar nada.
-- Debe ejecutarse ANTES de que la subcategoría y la elección de gastos
-- previos se puedan guardar: sin estas columnas la app sigue funcionando
-- (los presupuestos se crean como hoy, por categoría y contando el mes
-- completo), pero al crear un presupuesto por subcategoría o «como nuevo»,
-- la app avisa visiblemente que esos datos se guardarán cuando se ejecute
-- este SQL.
--
-- Qué agrega a la tabla budgets (una fila por categoría —o subcategoría—
-- y mes):
--   subcategory: texto de la subcategoría, o NULL cuando el presupuesto
--     cubre TODA la categoría (comportamiento de siempre).
--   include_prior_expenses: TRUE (valor por defecto) = el presupuesto
--     cuenta los gastos del mes completo, como hoy. FALSE = nace «como
--     nuevo»: solo cuentan los gastos registrados desde su creación.
--   created_at: momento en que se creó el presupuesto; es el corte del
--     «como nuevo» (un gasto fechado el mismo día pero capturado antes
--     de crear el presupuesto no se cuenta, porque su fecha de captura
--     es anterior).
-- Los presupuestos viejos quedan con subcategory NULL,
-- include_prior_expenses TRUE y created_at en el momento de correr este
-- SQL: se comportan exactamente como hoy.
--
-- Seguridad: son columnas de una tabla que ya existe; no cambia el RLS
-- ni los permisos. Solo el servidor (Vercel Functions) con service_role
-- accede a la base; todo pasa por /api/actions.

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS include_prior_expenses BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_budgets_household_category_month_subcategory
  ON budgets(household_id, category_id, month, subcategory);
