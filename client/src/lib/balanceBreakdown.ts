// Desglose de dónde está el dinero del Disponible, en funciones puras
// para poder probarlas en Node. El Disponible ya no se despliega sobre
// la tarjeta: se abre en un pop-up que dice dónde está el dinero y qué
// cuenta tiene ese saldo, separado por tipo de cuenta (efectivo, bancos,
// tarjetas). Los saldos vienen del servidor (getOverview); aquí solo se
// agrupan y se comprueba que la suma cuadra con el Total.

export type BalanceAccount = {
  id: number;
  name: string;
  /** Tipo del servidor: cash | bank | credit | investment | loan. */
  type: string;
  balance: number;
};

export type BalanceGroup = {
  key: string;
  label: string;
  accounts: { id: number; name: string; balance: number }[];
  subtotal: number;
};

const TYPE_LABELS: Record<string, string> = {
  cash: "Efectivo",
  bank: "Bancaria",
  credit: "Tarjeta de crédito",
  investment: "Inversión",
  loan: "Préstamo",
};

// El efectivo siempre va primero; luego bancos y tarjetas; un tipo nuevo
// que no se conozca queda al final, con su propio grupo.
const TYPE_ORDER: Record<string, number> = {
  cash: 0,
  bank: 1,
  credit: 2,
  investment: 3,
  loan: 4,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Agrupa las cuentas por tipo, en orden fijo (efectivo, bancaria,
 * tarjeta de crédito, inversión, préstamo, otros). Cada grupo lleva
 * sus cuentas y su subtotal. Una cuenta en $0 se muestra igual, con $0.
 */
export function groupAccountsByType(accounts: BalanceAccount[]): BalanceGroup[] {
  const byKey = new Map<string, BalanceGroup>();
  for (const a of accounts) {
    const key = a.type || "other";
    const g =
      byKey.get(key) ??
      ({
        key,
        label: TYPE_LABELS[key] ?? (a.type ? a.type : "Otra cuenta"),
        accounts: [],
        subtotal: 0,
      } as BalanceGroup);
    g.accounts.push({ id: a.id, name: a.name, balance: round2(a.balance) });
    g.subtotal = round2(g.subtotal + a.balance);
    byKey.set(key, g);
  }
  return [...byKey.values()].sort(
    (x, y) =>
      (TYPE_ORDER[x.key] ?? 99) - (TYPE_ORDER[y.key] ?? 99) ||
      x.label.localeCompare(y.label, "es"),
  );
}

export type BalanceBreakdown = {
  groups: BalanceGroup[];
  /** Dinero sin cuenta (movimientos sin cuenta, como transferencias o
   *  pagos de deuda sin cuenta): 0 si no hay. Se muestra como «Sin cuenta». */
  unassignedNet: number;
  /** Suma de los grupos más lo sin cuenta: el Total del Disponible. */
  totalBalance: number;
  fundsReserved: number;
  /** El Disponible: Total menos fondos apartados. */
  availableFree: number;
};

export function buildBalanceBreakdown(input: {
  accounts: BalanceAccount[];
  unassignedNet: number;
  totalBalance: number;
  fundsReserved: number;
  availableFree: number;
}): BalanceBreakdown {
  return {
    groups: groupAccountsByType(input.accounts),
    unassignedNet: round2(input.unassignedNet),
    totalBalance: round2(input.totalBalance),
    fundsReserved: round2(input.fundsReserved),
    availableFree: round2(input.availableFree),
  };
}

/** Suma de comprobación: los grupos más lo sin cuenta deben ser el Total. */
export function breakdownSumsToTotal(b: BalanceBreakdown): boolean {
  const sum = round2(
    b.groups.reduce((s, g) => s + g.subtotal, 0) + b.unassignedNet,
  );
  return sum === b.totalBalance;
}

/** El Disponible debe ser el Total menos los fondos apartados. */
export function breakdownAvailableMatches(b: BalanceBreakdown): boolean {
  return round2(b.totalBalance - b.fundsReserved) === b.availableFree;
}
