-- División de un gasto entre categorías (2026-11-26, segunda mejora del
-- benchmark v2): un gasto se registra como una fila de movimiento por
-- parte (mismo concepto, fecha, cuenta, visibilidad y perfil; cada parte
-- con su categoría y su propio importe) y todas las partes comparten
-- movements.split_group_id, el identificador del grupo.
--
-- Sin esta columna, la app sigue funcionando: los gastos se guardan como
-- hoy (una sola categoría por gasto) y la división no se ofrece; el
-- cliente avisa que la división se guardará cuando se ejecute este SQL.
-- Nunca en silencio.
--
-- Sin clave foránea a propósito: el grupo es solo una etiqueta que une
-- las partes; borrar una parte no deja al resto en un estado inválido
-- (el servidor borra el grupo completo junto).
--
-- Idempotente: se puede correr más de una vez sin error.
ALTER TABLE movements ADD COLUMN IF NOT EXISTS split_group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_movements_split_group ON movements (split_group_id);
