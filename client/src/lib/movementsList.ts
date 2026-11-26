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
 * Aviso cuando falta la cuenta al aportar a una meta o a un fondo.
 * Devuelve null cuando sí hay una cuenta real elegida.
 */
export function requiredGoalAccountNotice(
  accountValue: string | null | undefined,
): string | null {
  return isAccountSelected(accountValue)
    ? null
    : "Elija la cuenta de donde se descuenta.";
}

/**
 * Aviso cuando falta la cuenta al retirar de una meta o de un fondo.
 * Devuelve null cuando sí hay una cuenta real elegida.
 */
export function requiredGoalReturnAccountNotice(
  accountValue: string | null | undefined,
): string | null {
  return isAccountSelected(accountValue)
    ? null
    : "Elija la cuenta a la que vuelve el dinero.";
}

/**
 * Aviso cuando falta la cuenta del dinero ya ahorrado al crear una meta
 * con ya ahorrado mayor que $0. Devuelve null cuando sí hay una cuenta
 * real elegida.
 */
export function requiredInitialAccountNotice(
  accountValue: string | null | undefined,
): string | null {
  return isAccountSelected(accountValue)
    ? null
    : "Elija la cuenta de donde es ese dinero.";
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

// --- Detalle de ingresos/gastos: «Por cuenta» / «Por fecha» ---
// El detalle agrupa por cuenta (grupos por total descendente, dentro de
// cada grupo por fecha descendente). Con «Por fecha» se ve una sola lista
// cronológica: el movimiento más reciente primero, aunque sea de otra
// cuenta. La vista por defecto es «Por cuenta».

/** Vista del detalle de ingresos/gastos. */
export type IncExpDetailView = "cuenta" | "fecha";

/**
 * Lista plana del detalle, ordenada por fecha descendente (desempate por
 * id descendente, el mismo orden base del detalle). Devuelve una copia:
 * no muta la lista recibida.
 */
export function sortMovementsByDate<T extends { date: string; id: number }>(
  movs: T[],
): T[] {
  return [...movs].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  );
}

/**
 * Línea de resumen por cuenta para la vista «Por fecha», con los mismos
 * totales de los grupos («Efectivo $2,505.50 · Marcado Libre $70.00»),
 * para que la información de dónde salió el dinero no se pierda al
 * aplanar la lista. El formato de importe lo pone quien llama.
 */
export function accountTotalsLine(
  groups: { name: string; total: number }[],
  fmt: (n: number) => string,
): string {
  return groups.map((g) => `${g.name} ${fmt(g.total)}`).join(" · ");
}

// --- Detalle de ingresos/gastos: agrupación por fecha en dos niveles ---
// «Por fecha» agrupa por mes y, dentro de cada mes, por día: mes (total
// y conteo) → día (total y conteo) → movimientos. Meses y días en orden
// descendente; dentro de cada día, los movimientos por fecha descendente
// (desempate por id descendente). Los totales son la suma de los importes
// recibidos: el detalle ya viene filtrado (mes, dirección, sin reversados
// ni reversiones y con visibilidad) desde App.tsx, así que agrupar no
// cambia ningún total.

/** Un mes del detalle «Por fecha», con sus días plegables. */
export type MonthDayGroup<T> = {
  key: string; // YYYY-MM
  label: string; // «nov 2026»
  total: number;
  count: number;
  days: {
    key: string; // YYYY-MM-DD
    label: string; // «17 nov 2026»
    total: number;
    count: number;
    movs: T[];
  }[];
};

/** Día corto en español: «17 nov 2026». Con un valor inválido devuelve el valor tal cual. */
export function fmtDayShort(ymd: string): string {
  const y = ymd.slice(0, 4);
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (!y || !m || m < 1 || m > 12 || !d || d < 1 || d > 31) return ymd;
  return `${d} ${MONTH_SHORT_ES[m - 1]} ${y}`;
};

/**
 * Agrupa movimientos por mes y por día. No muta la lista recibida: los
 * movimientos de cada día son una copia ordenada por fecha descendente.
 */
export function groupMovementsByMonthDay<
  T extends { date: string; amount: number; id: number },
>(movs: T[]): MonthDayGroup<T>[] {
  const months = new Map<string, MonthDayGroup<T>>();
  for (const m of movs) {
    const ym = m.date.slice(0, 7);
    const ymd = m.date.slice(0, 10);
    let month = months.get(ym);
    if (!month) {
      month = { key: ym, label: fmtMonthShort(ym), total: 0, count: 0, days: [] };
      months.set(ym, month);
    }
    month.total += m.amount;
    month.count += 1;
    let day = month.days.find((d) => d.key === ymd);
    if (!day) {
      day = { key: ymd, label: fmtDayShort(ymd), total: 0, count: 0, movs: [] };
      month.days.push(day);
    }
    day.total += m.amount;
    day.count += 1;
    day.movs.push(m);
  }
  const out = [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
  for (const month of out) {
    month.days.sort((a, b) => b.key.localeCompare(a.key));
    for (const day of month.days) day.movs = sortMovementsByDate(day.movs);
  }
  return out;
}

// --- Tarjeta Movimientos de Inicio: mes compacto ---
// El selector de mes de la tarjeta es un icono pequeño de calendario con
// el mes corto («nov 2026»).

/** Meses cortos en español, en orden, para el selector compacto y el calendario del selector. */
export const MONTH_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** Mes corto para el selector compacto: «nov 2026». Con un valor inválido devuelve el valor tal cual. */
export function fmtMonthShort(ym: string): string {
  const y = ym.slice(0, 4);
  const m = Number(ym.slice(5, 7));
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTH_SHORT_ES[m - 1]} ${y}`;
}

// --- Gasto dividido entre categorías ---
// Las partes de un gasto dividido comparten split_group_id (lo pone el
// servidor, supabase/split-movements.sql) y se muestran como UNA sola
// entrada en Movimientos e Inicio: concepto + total + «N categorías ▸»,
// con las partes al expandir. Los totales no se duplican: el total del
// grupo es la suma de sus partes cargadas. Las partes aparecen juntas
// en la lista (misma fecha, ids consecutivos); si un grupo queda partido
// por la paginación, el total es el de las partes cargadas y el refetch
// lo completa.

/** Fila que puede pertenecer a un gasto dividido. */
export type SplittableMovement = {
  id: number;
  splitGroupId?: string | null;
  amount: number;
  concept: string;
  date: string;
  accountId: number | null;
  visibility: string;
  profileId: number | null;
  type: string;
  isReversed: boolean;
  reversalOfId: number | null;
  receiptUrl?: string | null;
};

/** Una entrada agrupada de un gasto dividido. */
export type SplitGroup<T extends SplittableMovement> = {
  key: string;
  groupId: string;
  concept: string;
  total: number;
  date: string;
  accountId: number | null;
  visibility: string;
  profileId: number | null;
  type: string;
  /** Partes en el orden en que venían en la lista (fecha desc., id desc.). */
  parts: T[];
  /** Todas las partes reversadas (el grupo queda fuera de los totales). */
  allReversed: boolean;
  /** La foto del comprobante: va solo en la primera parte del grupo. */
  receiptUrl: string | null;
};

/**
 * Agrupa las partes de cada gasto dividido en una sola entrada, en el
 * lugar de su primera parte. No muta la lista recibida. Las filas sin
 * grupo pasan tal cual.
 */
export function groupSplitMovements<T extends SplittableMovement>(
  movs: T[],
): (T | SplitGroup<T>)[] {
  const out: (T | SplitGroup<T>)[] = [];
  const byGroup = new Map<string, SplitGroup<T>>();
  for (const m of movs) {
    const gid = m.splitGroupId ?? null;
    if (gid == null) {
      out.push(m);
      continue;
    }
    let g = byGroup.get(gid);
    if (!g) {
      g = {
        key: `split-${gid}`,
        groupId: gid,
        concept: m.concept,
        total: 0,
        date: m.date,
        accountId: m.accountId,
        visibility: m.visibility,
        profileId: m.profileId,
        type: m.type,
        parts: [],
        allReversed: true,
        receiptUrl: null,
      };
      byGroup.set(gid, g);
      out.push(g);
    }
    g.parts.push(m);
    g.total = Math.round((g.total + m.amount) * 100) / 100;
    if (!m.isReversed) g.allReversed = false;
    if (g.receiptUrl == null && m.receiptUrl) g.receiptUrl = m.receiptUrl;
  }
  return out;
}

/** ¿Es una entrada agrupada (no una fila suelta)? */
export function isSplitGroup<T extends SplittableMovement>(
  e: T | SplitGroup<T>,
): e is SplitGroup<T> {
  return (e as SplitGroup<T>).parts !== undefined;
}
