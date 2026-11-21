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
 *  EXACTAMENTE como en la tarjeta de meta. null sin fecha. */
export function fundMonthsLeft(targetDate: string | null | undefined): number | null {
  if (!targetDate) return null;
  return Math.max(
    1,
    Math.round((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)),
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
