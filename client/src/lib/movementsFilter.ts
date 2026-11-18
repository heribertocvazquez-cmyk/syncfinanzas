// Filtros del módulo Movimientos, en funciones puras para poder
// probarlos en Node. El embudo del módulo solo muestra el icono; el
// panel elige qué ver: cuenta, fecha (mes), tipo, concepto y
// subcategoría. El valor por defecto es «todo sin filtrar»: los
// movimientos se ven todos, como hoy.

export type MovementsFilterType =
  | "all"
  | "income"
  | "expense"
  | "transfer"
  | "debt_payment";

export type MovementsFilterValue = {
  type: MovementsFilterType;
  /** "all" = todas las cuentas; String(id) = una cuenta; "none" = sin cuenta. */
  account: string;
  /** "" = todos los meses; "YYYY-MM" = un mes. */
  month: string;
  search: string;
  /** "all" = todas; nombre = una subcategoría; "" = sin subcategoría. */
  subcategory: string;
};

export const DEFAULT_MOVEMENTS_FILTER: MovementsFilterValue = {
  type: "all",
  account: "all",
  month: "",
  search: "",
  subcategory: "all",
};

/** Cuántos filtros difieren del valor por defecto (para el distintivo del embudo). */
export function countActiveFilters(f: MovementsFilterValue): number {
  let n = 0;
  if (f.type !== "all") n += 1;
  if (f.account !== "all") n += 1;
  if (f.month !== "") n += 1;
  if (f.search.trim() !== "") n += 1;
  if (f.subcategory !== "all") n += 1;
  return n;
}

export function isDefaultMovementsFilter(f: MovementsFilterValue): boolean {
  return countActiveFilters(f) === 0;
}

export type FilterableMovement = {
  type: string;
  accountId: number | null;
  date: string;
  concept: string;
  subcategory: string | null | undefined;
};

/**
 * Aplica todos los filtros a la vez. No toca reversados: igual que hoy,
 * los movimientos reversados y las reversiones siguen en la lista (solo
 * se marcan), y los totales de Entradas/Salidas los excluyen aparte.
 */
export function filterMovements<T extends FilterableMovement>(
  movs: T[],
  f: MovementsFilterValue,
): T[] {
  const q = f.search.trim().toLowerCase();
  return movs.filter((m) => {
    if (f.type !== "all" && m.type !== f.type) return false;
    if (f.account === "none") {
      if (m.accountId != null) return false;
    } else if (f.account !== "all" && m.accountId !== Number(f.account)) {
      return false;
    }
    if (f.month !== "" && !m.date.startsWith(f.month)) return false;
    if (q && !m.concept.toLowerCase().includes(q)) return false;
    if (f.subcategory !== "all" && (m.subcategory || "") !== f.subcategory)
      return false;
    return true;
  });
}
