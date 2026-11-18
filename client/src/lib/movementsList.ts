// Reglas de la lista de movimientos, en funciones puras para poder
// probarlas en Node. La lista de Inicio y la del módulo Movimientos
// deben coincidir con los totales del tablero: un movimiento guardado
// siempre aparece en su lista del mes, con un título legible, aunque
// su concepto esté vacío o se haya guardado con otro perfil de la
// misma cuenta.

export type ListMovement = {
  visibility: string;
  profileId: number | null;
  /** Lo marca el servidor: el perfil del movimiento pertenece a la cuenta del usuario. */
  mine?: boolean;
  date: string;
  concept: string;
  categoryId: number | null;
};

/**
 * ¿Se ve este movimiento en la lista? Misma regla que la lista de
 * Movimientos: compartido, propio (según el servidor, no solo según el
 * perfil actual del dispositivo) o sin perfil siendo administrador.
 * Los privados de otros integrantes no se listan; los totales sí los
 * cuentan, porque no revelan conceptos.
 */
export function canSeeMovementRow(
  m: Pick<ListMovement, "visibility" | "profileId" | "mine">,
  me: { id: number; role: string } | null,
): boolean {
  return (
    m.visibility === "shared" ||
    m.mine === true ||
    (me
      ? m.profileId === me.id || (m.profileId === null && me.role === "admin")
      : true)
  );
}

/** Movimientos del mes que muestra el tablero (misma regla que los totales: la fecha empieza por YYYY-MM). */
export function monthMovements<T extends { date: string }>(
  movs: T[],
  month: string,
): T[] {
  return movs.filter((m) => m.date.startsWith(month));
}

/**
 * Título legible de un movimiento en las listas: si el concepto viene
 * vacío, se muestra la categoría y, si tampoco hay, «Gasto sin concepto».
 */
export function movementTitle(
  m: { concept: string; categoryId: number | null },
  categoryName: string | null,
): string {
  if (m.concept?.trim()) return m.concept;
  if (categoryName) return categoryName;
  return "Gasto sin concepto";
}

// --- Cuenta obligatoria y cuenta de Efectivo por defecto ---
// Todos los gastos e ingresos van a una cuenta real: si el usuario no
// elige otra, el formulario usa la cuenta de Efectivo del hogar. Un
// valor vacío nunca cuenta como cuenta elegida: sin cuenta no se avanza
// ni se guarda.

export type CashAccount = { id: number; name: string; type: string };

/**
 * Cuenta de efectivo por defecto para el formulario: la cuenta de
 * Efectivo real del hogar. Si hay varias candidatas (tipo cash o
 * llamadas «Efectivo»), se elige la que ya tiene más movimientos y,
 * en empate, la más antigua (id menor). Sin candidatas devuelve "".
 */
export function defaultCashAccountId(
  accounts: CashAccount[],
  movements: { accountId: number | null }[],
): string {
  const candidates = accounts.filter(
    (a) => a.type === "cash" || a.name.trim().toLowerCase() === "efectivo",
  );
  if (candidates.length === 0) return "";
  const counts = new Map<number, number>();
  for (const m of movements) {
    if (m.accountId != null)
      counts.set(m.accountId, (counts.get(m.accountId) ?? 0) + 1);
  }
  const sorted = [...candidates].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id - b.id,
  );
  const first = sorted[0];
  return first ? String(first.id) : "";
}

/** ¿Hay una cuenta real elegida? Un valor vacío nunca cuenta como lleno. */
export function isAccountSelected(
  accountValue: string | null | undefined,
): boolean {
  return accountValue != null && accountValue !== "";
}

/**
 * Aviso cuando falta la cuenta, según el tipo de movimiento. Devuelve
 * null cuando sí hay una cuenta real elegida.
 */
export function requiredAccountNotice(
  type: "income" | "expense" | "transfer" | "debt_payment",
  accountValue: string | null | undefined,
): string | null {
  if (isAccountSelected(accountValue)) return null;
  if (type === "income")
    return "Seleccione la cuenta donde entra el ingreso.";
  if (type === "transfer")
    return "Seleccione la cuenta de donde sale la transferencia.";
  return "Seleccione la cuenta de donde sale el gasto.";
}

/**
 * Agrupa movimientos por cuenta para el detalle «¿De dónde salieron
 * los gastos?» (y su equivalente de ingresos). Los movimientos sin
 * cuenta van en un solo grupo honesto «Sin cuenta»; cada cuenta real
 * es su propio grupo. Ordenados por total descendente.
 */
export function groupMovementsByAccount<
  T extends { accountId: number | null; amount: number },
>(
  movs: T[],
  accountName: (id: number) => string,
): { key: string; name: string; total: number; movs: T[] }[] {
  const groups = new Map<
    string,
    { name: string; total: number; movs: T[] }
  >();
  for (const m of movs) {
    const key = m.accountId == null ? "sin-cuenta" : `cta-${m.accountId}`;
    const g = groups.get(key) ?? {
      name:
        m.accountId == null ? "Sin cuenta" : accountName(m.accountId),
      total: 0,
      movs: [],
    };
    g.total += m.amount;
    g.movs.push(m);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.total - a.total);
}
