// Cifras del mes para metas con plan (ajustes de la calculadora de Rebe):
// «Te queda del mes», «Te falta ahorrar este mes» con compensación entre
// meses, y la meta fijada por importancia 5. Funciones puras para poder
// probarlas en Node y en render.

export type FundMovementLike = {
  fundId: number;
  type: string;
  amount: number;
  date: string;
  note: string | null;
};

export type GoalPlanLike = {
  goalId: number;
  monthlyAmount: number;
  months: number;
  startMonth: string;
  dueDay: number;
  fundId: number | null;
  status: string;
  fundBalance: number;
  contributedThisMonth: number;
  expectedByNow: number;
};

export type GoalLike = {
  id: number;
  name: string;
  targetAmount: number;
  savedAmount: number;
  pct: number;
  importance?: number;
};

export function monthDiffYm(fromYm: string, toYm: string): number {
  const [fy = 2026, fm = 1] = fromYm.split("-").map(Number);
  const [ty = 2026, tm = 1] = toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const isInitialBalance = (f: FundMovementLike) =>
  f.note === "Saldo inicial de la meta";

const netOf = (movs: FundMovementLike[]) =>
  round2(
    movs.reduce(
      (s, f) => s + (f.type === "contribution" ? f.amount : -f.amount),
      0,
    ),
  );

/** Aportes netos del fondo en un mes (aportes menos retiros), sin el
 *  «Saldo inicial de la meta», que no es un aporte del mes. */
export function netFundMovementsInMonth(
  movs: FundMovementLike[],
  fundId: number,
  ym: string,
): number {
  return netOf(
    movs.filter(
      (f) =>
        f.fundId === fundId &&
        f.date.startsWith(ym) &&
        !isInitialBalance(f),
    ),
  );
}

/** Aportes netos del fondo en los meses ANTERIORES al mes dado, sin el
 *  saldo inicial. */
export function priorMonthsNet(
  movs: FundMovementLike[],
  fundId: number,
  currentYm: string,
): number {
  return netOf(
    movs.filter(
      (f) =>
        f.fundId === fundId &&
        f.date.slice(0, 7) < currentYm &&
        !isInitialBalance(f),
    ),
  );
}

/** Excedente de meses anteriores: lo aportado de más respecto a lo
 *  esperado hasta el mes anterior. Nunca negativo. */
export function planPriorSurplus(
  plan: GoalPlanLike,
  movs: FundMovementLike[],
  currentYm: string,
): number {
  if (plan.fundId == null) return 0;
  const monthsElapsed = Math.max(0, monthDiffYm(plan.startMonth, currentYm));
  const expectedBefore = plan.monthlyAmount * monthsElapsed;
  return Math.max(
    0,
    round2(priorMonthsNet(movs, plan.fundId, currentYm) - expectedBefore),
  );
}

/** Lo que falta aportar este mes para estar al corriente, con la
 *  compensación: el excedente de meses anteriores descuenta del aporte
 *  del mes (P-8: el mes 1 dejó $500 de más → el mes 2 faltan $1,000, no
 *  $1,500). Nunca negativo; 0 sin plan activo o si ya se cubrió. */
export function planMonthShortfall(
  plan: GoalPlanLike,
  movs: FundMovementLike[],
  currentYm: string,
): number {
  if (
    plan.status === "cumplido" ||
    plan.status === "cancelado" ||
    plan.fundId == null
  )
    return 0;
  return Math.max(
    0,
    round2(
      plan.monthlyAmount -
        plan.contributedThisMonth -
        planPriorSurplus(plan, movs, currentYm),
    ),
  );
}

/** Total aportado al fondo desde que existe el plan, sin el saldo
 *  inicial: lo que se lleva ahorrado por aportes. */
export function planCumulativeContributed(
  plan: GoalPlanLike,
  movs: FundMovementLike[],
): number {
  if (plan.fundId == null) return 0;
  return netOf(
    movs.filter((f) => f.fundId === plan.fundId && !isInitialBalance(f)),
  );
}

/** Suma del faltante del mes de todos los planes activos. */
export function totalMonthShortfall(
  plans: GoalPlanLike[],
  movs: FundMovementLike[],
  currentYm: string,
): number {
  return round2(
    plans.reduce((s, p) => s + planMonthShortfall(p, movs, currentYm), 0),
  );
}

/** La meta fijada arriba de Inicio: importancia 5; desempate: más
 *  avanzada primero, luego la más antigua. Sin ninguna en 5, null. */
export function pickPinnedGoal<T extends GoalLike>(goals: T[]): T | null {
  const pinned = goals.filter((g) => (g.importance ?? 3) === 5);
  if (pinned.length === 0) return null;
  return [...pinned].sort((a, b) => b.pct - a.pct || a.id - b.id)[0] ?? null;
}

export type FundLike = {
  id: number;
  name: string;
  balance: number;
  targetAmount: number | null;
  importance?: number | null;
};

/** % de avance de un fondo (misma fórmula que la tarjeta de Fondos). */
export function fundPct(f: { balance: number; targetAmount: number | null }): number {
  if (!f.targetAmount) return 0;
  return Math.min(100, Math.round((f.balance / f.targetAmount) * 100));
}

/** Meses que faltan hasta la fecha límite (meses de 30 días, mínimo 1),
 *  EXACTAMENTE como en la tarjeta de meta. null sin fecha. `nowMs` es
 *  inyectable para que las pruebas fijen el «hoy». */
export function fundMonthsLeft(
  targetDate: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!targetDate) return null;
  return Math.max(
    1,
    Math.round((new Date(targetDate).getTime() - nowMs) / (1000 * 60 * 60 * 24 * 30)),
  );
}

/** Cuánto falta aportar al mes para llegar a la meta en la fecha límite
 *  (redondeado hacia arriba), igual que en la tarjeta de meta.
 *  null sin fecha o sin meta. */
export function fundNeedPerMonth(f: {
  balance: number;
  targetAmount: number | null;
  targetDate?: string | null;
}): number | null {
  const monthsLeft = fundMonthsLeft(f.targetDate);
  if (monthsLeft == null || f.targetAmount == null) return null;
  return Math.ceil((f.targetAmount - f.balance) / monthsLeft);
}

/** El fondo fijado arriba de Inicio: importancia 5; desempate: más
 *  avanzado primero, luego el más antiguo. Sin ninguno en 5, null.
 *  Espejo de pickPinnedGoal. */
export function pickPinnedFund<T extends FundLike>(funds: T[]): T | null {
  const pinned = funds.filter((f) => (f.importance ?? 3) === 5);
  if (pinned.length === 0) return null;
  return [...pinned].sort((a, b) => fundPct(b) - fundPct(a) || a.id - b.id)[0] ?? null;
}

// ---- Frecuencia del aporte al fondo (2026-11-21) ----
// Las filas Por día / Por semana / Por mes del plan son un selector: la
// frecuencia elegida cambia el botón de aportar y el cálculo de lo
// esperado y lo proyectado. La elección se guarda EN EL DISPOSITIVO
// (localStorage, una clave por fondo); sin localStorage, vuelve a Por
// día. Sin cambio de servidor y sin SQL.
export type FundFrequency = "dia" | "semana" | "mes";

export function fundFreqKey(fundId: number): string {
  return `sf-fund-freq-${fundId}`;
}

type FundFreqStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;

function defaultFundFreqStorage(): FundFreqStorage {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readFundFrequency(fundId: number, storage: FundFreqStorage = defaultFundFreqStorage()): FundFrequency {
  try {
    const v = storage?.getItem(fundFreqKey(fundId));
    if (v === "dia" || v === "semana" || v === "mes") return v;
  } catch {}
  return "dia";
}

export function writeFundFrequency(fundId: number, freq: FundFrequency, storage: FundFreqStorage = defaultFundFreqStorage()): void {
  try {
    storage?.setItem(fundFreqKey(fundId), freq);
  } catch {}
}

/** Días transcurridos desde la creación del fondo hasta hoy (00:00
 *  local), para lo «Esperado hasta hoy». Criterio: se cuenta desde la
 *  creación, pero si el fondo se creó antes del mes actual, se cuenta
 *  desde el inicio del mes actual (el plan es del mes en curso). Sin
 *  fecha de creación, desde el inicio del mes. 0 si se creó hoy o
 *  después de hoy. */
export function fundElapsedDays(
  createdAt: string | null | undefined,
  currentYm: string,
  nowMs: number = Date.now(),
): number {
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [cy = now.getFullYear(), cm = now.getMonth() + 1] = currentYm.split("-").map(Number);
  const monthStart = new Date(cy, (cm || 1) - 1, 1).getTime();
  let start = monthStart;
  if (createdAt) {
    const c = new Date(createdAt);
    if (!Number.isNaN(c.getTime())) {
      const created = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
      start = Math.max(created, monthStart);
    }
  }
  return Math.max(0, Math.round((today - start) / 86400000));
}

/** A cuánto se llega en la fecha límite si se sigue un ritmo: saldo +
 *  aporte × periodos hasta la fecha. Día: monto-día × días restantes;
 *  semana: monto-semana × ceil(días/7); mes: monto-mes × meses
 *  restantes (fundMonthsLeft). Pura, para poder probar el veredicto
 *  «No llega» con un monto que no cubre. */
export function fundProjected(
  balance: number,
  amount: number,
  freq: FundFrequency,
  daysLeft: number,
  monthsLeft: number,
): number {
  // La fecha límite es hoy (daysLeft 0): hoy mismo aún se puede
  // aportar, así que el día en curso cuenta como 1 periodo.
  const periods = freq === "dia" ? Math.max(1, daysLeft) : freq === "semana" ? Math.ceil(Math.max(1, daysLeft) / 7) : Math.max(1, monthsLeft);
  return round2(balance + amount * periods);
}

// ---- Plan del fondo (2026-11-20) ----
// El fondo no tenía plan: solo decía «faltan $X/mes», sin mirar el
// ingreso ni los gastos, sin ritmo por día/semana y sin decir de dónde
// agarrarlo. El plan se calcula EN EL CLIENTE con los datos que ya trae
// getOverview (ingreso y gasto reales del mes — el ingreso es variable,
// nunca un sueldo fijo supuesto —, lo ya apartado, cuentas y
// presupuestos), sin acción nueva ni SQL. `nowMs` es inyectable para que
// las pruebas fijen el «hoy».

export type FundPlanAccount = { id: number; name: string; balance: number };
export type FundPlanBudget = { name: string; remaining: number };

export type FundSmallStart = {
  /** Monto asequible por día. */
  perDay: number;
  /** Asequible por semana (por día × 7, sin pasar del restante). */
  perWeek: number;
  /** Asequible por mes. */
  perMonth: number;
  /** Cuenta de la que saldría (capacidad 0). null cuando sale de la
   *  capacidad del mes. */
  account: FundPlanAccount | null;
};

export type FundPlanVerdict =
  | "alcanza"
  | "no-alcanza"
  | "sin-base"
  | "alcanzada"
  | null;

export type FundPlan = {
  /** Lo que se puede apartar este mes: ingreso − gasto − lo ya apartado.
   *  Nunca negativo. */
  capacity: number;
  /** false cuando el mes aún no tiene ingresos registrados. */
  hasIncome: boolean;
  /** Lo que falta para la meta (meta − saldo). null sin meta. */
  remaining: number | null;
  /** Días de hoy a la fecha límite. null sin fecha. */
  daysLeft: number | null;
  /** true cuando la fecha límite ya pasó. */
  datePassed: boolean;
  /** Aporte por día para llegar en la fecha (redondeado hacia arriba).
   *  null sin fecha, sin meta, con la fecha pasada o con la meta
   *  alcanzada. */
  perDay: number | null;
  /** Aporte por semana: por día × 7, sin pasar del restante. */
  perWeek: number | null;
  /** Aporte por mes (fundNeedPerMonth, la fórmula de la meta). */
  perMonth: number | null;
  /** Lo que toca apartar este mes: lo menor entre el restante y el
   *  aporte mensual. null sin fecha o sin meta. */
  needThisMonth: number | null;
  verdict: FundPlanVerdict;
  /** Lo que falta cuando no alcanza (necesidad − capacidad). */
  shortfall: number;
  /** Lo que queda después de apartar cuando alcanza (capacidad −
   *  necesidad). */
  leftoverAfter: number;
  /** Inicio chico («Empiece con poco») cuando la necesidad del mes
   *  supera lo que se puede apartar: ritmo asequible. null cuando la
   *  capacidad cubre, sin fecha/meta, con la fecha pasada o con la
   *  meta alcanzada. */
  smallStart: FundSmallStart | null;
  /** Aportado neto a ESTE fondo en el mes actual (aportes − retiros). */
  contributedThisMonth: number;
  /** Días transcurridos desde la creación (o el inicio del mes, lo
   *  último). null sin ritmo. */
  elapsedDays: number | null;
  /** Lo que ya debería llevar aportado a este ritmo (por día × días
   *  transcurridos, con tope en lo restante; con el ritmo asequible
   *  cuando hay inicio chico). null sin ritmo. */
  expectedByNow: number | null;
  /** A cuánto se llega en la fecha límite con cada frecuencia
   *  (fundProjected, con el ritmo asequible cuando hay inicio chico).
   *  null sin ritmo. */
  projected: { dia: number; semana: number; mes: number } | null;
  /** La cuenta con mayor saldo (saldo > 0). null si ninguna tiene. */
  topAccount: FundPlanAccount | null;
  /** Presupuestos con sobrante, los 2 mayores. */
  surplusBudgets: FundPlanBudget[];
};

/** Días enteros de hoy (00:00 local) a la fecha límite. null sin fecha;
 *  negativo cuando ya pasó. */
export function fundDaysLeft(
  targetDate: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!targetDate) return null;
  const [y = 2026, m = 1, d = 1] = targetDate.split("-").map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1).getTime();
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

export function fundPlan(input: {
  fund: {
    id: number;
    balance: number;
    targetAmount: number | null;
    targetDate?: string | null;
    /** Fecha de creación (ISO) del fondo, para lo esperado hasta hoy. */
    createdAt?: string | null;
  };
  monthIncome: number;
  monthExpense: number;
  monthSetAside: number;
  /** fundNeedPerMonth(f), calculado por quien llama. */
  perMonth: number | null;
  fundMovements: FundMovementLike[];
  currentYm: string;
  accounts: FundPlanAccount[];
  surplusBudgets: FundPlanBudget[];
  nowMs?: number;
}): FundPlan {
  const nowMs = input.nowMs ?? Date.now();
  const capacity = Math.max(
    0,
    round2(input.monthIncome - input.monthExpense - input.monthSetAside),
  );
  const hasIncome = input.monthIncome > 0;
  const remaining =
    input.fund.targetAmount == null
      ? null
      : round2(input.fund.targetAmount - input.fund.balance);
  const daysLeft = fundDaysLeft(input.fund.targetDate, nowMs);
  const datePassed = daysLeft != null && daysLeft < 0;
  const perDay =
    remaining != null && remaining > 0 && daysLeft != null && daysLeft >= 0
      ? Math.ceil(remaining / Math.max(1, daysLeft))
      : null;
  const perWeek =
    perDay != null && remaining != null
      ? Math.min(remaining, perDay * 7)
      : null;
  const perMonth =
    remaining != null && remaining > 0 && input.perMonth != null && input.perMonth > 0
      ? input.perMonth
      : null;
  const needThisMonth =
    remaining != null && remaining > 0 && perMonth != null
      ? Math.min(remaining, perMonth)
      : null;
  let verdict: FundPlanVerdict = null;
  if (remaining != null && remaining <= 0) verdict = "alcanzada";
  else if (!hasIncome) verdict = "sin-base";
  else if (needThisMonth != null)
    verdict = capacity >= needThisMonth ? "alcanza" : "no-alcanza";
  const shortfall =
    verdict === "no-alcanza" && needThisMonth != null
      ? round2(needThisMonth - capacity)
      : 0;
  const leftoverAfter =
    verdict === "alcanza" && needThisMonth != null
      ? round2(capacity - needThisMonth)
      : 0;
  const withBalance = input.accounts.filter((a) => a.balance > 0);
  const topAccount =
    withBalance.length === 0
      ? null
      : [...withBalance].sort((a, b) => b.balance - a.balance)[0] ?? null;
  const surplusBudgets = [...input.surplusBudgets]
    .filter((b) => b.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 2);
  const hasRhythm = perDay != null && perWeek != null && perMonth != null && daysLeft != null && remaining != null && remaining > 0;
  // ---- Empiece con poco (2026-11-21) ----
  // Cuando la necesidad del mes supera lo que se puede apartar, el
  // plan no se queda en «No alcanza»: propone el ritmo asequible.
  // Caso A (capacidad > 0): sale de la capacidad del mes, X =
  // floor(capacidad / días restantes), mínimo $1; semana X×7 sin
  // pasar del restante; mes min(capacidad, necesidad).
  // Caso B (capacidad 0): sale de lo ahorrado en la cuenta con mayor
  // saldo, $20/día si la cuenta lo sostiene hasta la fecha; si no,
  // $10/día; nunca más de $50/día. Sin cuenta que lo sostenga, null
  // (la vista muestra que aún no hay con qué empezar).
  let smallStart: FundSmallStart | null = null;
  if (hasRhythm && remaining != null && daysLeft != null && needThisMonth != null) {
    const days = Math.max(1, daysLeft);
    if (verdict === "no-alcanza" && capacity > 0) {
      const d = Math.max(1, Math.floor(capacity / days));
      smallStart = {
        perDay: d,
        perWeek: Math.min(remaining, d * 7),
        perMonth: Math.min(capacity, needThisMonth),
        account: null,
      };
    } else if (capacity === 0 && topAccount != null) {
      let d: number | null = null;
      if (topAccount.balance >= 20 * days) d = 20;
      else if (topAccount.balance >= 10 * days) d = 10;
      if (d != null) {
        d = Math.min(50, d);
        smallStart = {
          perDay: d,
          perWeek: Math.min(remaining, d * 7),
          perMonth: Math.min(remaining, d * Math.min(30, days)),
          account: topAccount,
        };
      }
    }
  }
  // El ritmo efectivo es el asequible cuando hay inicio chico: lo
  // esperado hasta hoy y lo proyectado se calculan con él, para no
  // dejar al usuario «atrasado» frente a un ritmo que no puede pagar.
  const effPerDay = smallStart?.perDay ?? perDay;
  const effPerWeek = smallStart?.perWeek ?? perWeek;
  const effPerMonth = smallStart?.perMonth ?? perMonth;
  const elapsedDays = hasRhythm
    ? fundElapsedDays(input.fund.createdAt ?? null, input.currentYm, nowMs)
    : null;
  const expectedByNow =
    hasRhythm && elapsedDays != null && remaining != null && effPerDay != null
      ? Math.min(remaining, round2(effPerDay * elapsedDays))
      : null;
  const monthsLeft = hasRhythm ? fundMonthsLeft(input.fund.targetDate, nowMs) ?? 1 : 1;
  const projected =
    hasRhythm && daysLeft != null && effPerDay != null && effPerWeek != null && effPerMonth != null
      ? {
          dia: fundProjected(input.fund.balance, effPerDay, "dia", daysLeft, monthsLeft),
          semana: fundProjected(input.fund.balance, effPerWeek, "semana", daysLeft, monthsLeft),
          mes: fundProjected(input.fund.balance, effPerMonth, "mes", daysLeft, monthsLeft),
        }
      : null;
  return {
    capacity,
    hasIncome,
    remaining,
    daysLeft,
    datePassed,
    perDay,
    perWeek,
    perMonth,
    needThisMonth,
    verdict,
    shortfall,
    leftoverAfter,
    smallStart,
    contributedThisMonth: netFundMovementsInMonth(
      input.fundMovements,
      input.fund.id,
      input.currentYm,
    ),
    elapsedDays,
    expectedByNow,
    projected,
    topAccount,
    surplusBudgets,
  };
}

/** La meta a la que apunta el consejo («coquito») de un presupuesto:
 *  una meta CON plan activo (aceptado o en riesgo, con fondo y con algo
 *  por ahorrar: es la única que puede recibir el sobrante por la vía de
 *  proposeSpendingAdjustment). Si hay una fijada (importancia 5) con
 *  plan, esa; si no, la de mayor «Te falta ahorrar este mes»;
 *  desempate: más avanzada, luego la más antigua. Sin ninguna, null
 *  (el consejo invita a crear una meta). */
export function pickTipGoal<T extends GoalLike>(
  goals: T[],
  plans: GoalPlanLike[],
  movs: FundMovementLike[],
  currentYm: string,
): T | null {
  const usable = goals.filter((g) => {
    const p = plans.find((x) => x.goalId === g.id);
    return (
      p &&
      (p.status === "aceptado" || p.status === "en_riesgo") &&
      p.fundId != null &&
      g.targetAmount - g.savedAmount > 0
    );
  });
  if (usable.length === 0) return null;
  const pinned = usable.find((g) => (g.importance ?? 3) === 5);
  if (pinned) return pinned;
  return (
    [...usable].sort((a, b) => {
      const pa = plans.find((x) => x.goalId === a.id)!;
      const pb = plans.find((x) => x.goalId === b.id)!;
      return (
        planMonthShortfall(pb, movs, currentYm) -
          planMonthShortfall(pa, movs, currentYm) ||
        b.pct - a.pct ||
        a.id - b.id
      );
    })[0] ?? null
  );
}
