// Lógica pura del asistente «Arma su plan financiero»
// (client/src/components/PlanFinancieroWizard.tsx).
//
// El asistente guía en 4 pasos (ingreso → meta → fondo → resumen) y crea
// meta, fondo y presupuestos con las acciones que YA existen
// (saveGoalWithPlan, saveFund, saveBudget). No crea nada hasta el paso 4.
//
// Reglas que se reutilizan, sin duplicarlas:
// - Meses de 30 días y «faltan $X/mes» (fundMonthsLeft, como la tarjeta
//   de meta); por día = ceil(restante/días), por semana = día × 7 sin
//   pasar del restante (como el plan del fondo).
// - El ingreso es VARIABLE: el paso 1 pide lo que entra y lo fijo, y si
//   el mes ya trae movimientos reales, el resumen avisa cuando entraron
//   menos de lo previsto. Jamás se supone un sueldo fijo.
// - La cuenta NO se supone: el resumen pide elegirla (el plan propone
//   el aporte; la cuenta la elige usted). Si no hay cuentas, el asistente
//   lo dice y no crea el plan.
//
// Todo puro y con el «hoy» inyectable, para probarlo en Node.

import {
  fundDaysLeft,
  fundMonthsLeft,
  fundProjected,
  type FundFrequency,
} from "./goalMonth";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fecha local de hoy en YYYY-MM-DD (el input date la compara como texto). */
export function todayStr(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Capacidad del mes: lo que entra menos lo fijo. Nunca negativa. */
export function wizardCapacity(income: number, fixedExpense: number): number {
  return Math.max(0, round2(income - fixedExpense));
}

export type WizardRhythm = {
  /** Lo que falta (meta − ya ahorrado). */
  remaining: number;
  /** Meses de 30 días hasta la fecha límite (mínimo 1). */
  monthsLeft: number;
  /** Días de hoy a la fecha límite. */
  daysLeft: number;
  /** Aporte por día para llegar en la fecha (hacia arriba). */
  perDay: number;
  /** Aporte por semana (día × 7, sin pasar del restante). */
  perWeek: number;
  /** Aporte por mes (fórmula de la meta). */
  perMonth: number;
};

function rhythmFor(target: number, saved: number, targetDate: string, nowMs: number): WizardRhythm {
  const remaining = round2(target - saved);
  const monthsLeft = fundMonthsLeft(targetDate, nowMs) ?? 1;
  const daysLeft = Math.max(0, fundDaysLeft(targetDate, nowMs) ?? 0);
  const perDay = Math.ceil(remaining / Math.max(1, daysLeft));
  const perWeek = Math.min(remaining, perDay * 7);
  const perMonth = Math.ceil(remaining / monthsLeft);
  return { remaining, monthsLeft, daysLeft, perDay, perWeek, perMonth };
}

/** Ritmo de la meta (paso 2), en vivo mientras se escribe. */
export function goalRhythm(input: {
  target: number;
  saved: number;
  targetDate: string;
  nowMs?: number;
}): WizardRhythm {
  return rhythmFor(input.target, input.saved, input.targetDate, input.nowMs ?? Date.now());
}

export type WizardFundRhythm = WizardRhythm & {
  /** Monto del aporte según la frecuencia elegida. */
  chosenAmount: number;
  /** «hoy» / «esta semana» / «este mes», para el botón. */
  chosenLabel: string;
  /** A cuánto se llega en la fecha límite con ese ritmo. */
  projected: number;
};

/** Ritmo del fondo (paso 3), con la frecuencia elegida. */
export function fundRhythm(input: {
  target: number;
  targetDate: string;
  freq: FundFrequency;
  nowMs?: number;
}): WizardFundRhythm {
  const nowMs = input.nowMs ?? Date.now();
  const base = rhythmFor(input.target, 0, input.targetDate, nowMs);
  const chosenAmount =
    input.freq === "dia" ? base.perDay : input.freq === "semana" ? base.perWeek : base.perMonth;
  const chosenLabel =
    input.freq === "dia" ? "hoy" : input.freq === "semana" ? "esta semana" : "este mes";
  return {
    ...base,
    chosenAmount,
    chosenLabel,
    projected: fundProjected(0, chosenAmount, input.freq, base.daysLeft, base.monthsLeft),
  };
}

export type WizardAccount = { id: number; name: string; balance: number };

/** La cuenta con mayor saldo (saldo > 0): solo se SUGIERE, nunca se
 *  supone — el resumen pide elegirla. null si ninguna tiene saldo. */
export function topWizardAccount(accounts: WizardAccount[]): WizardAccount | null {
  const withBalance = accounts.filter((a) => a.balance > 0);
  if (withBalance.length === 0) return null;
  return [...withBalance].sort((a, b) => b.balance - a.balance)[0] ?? null;
}

/** Mes anterior en YYYY-MM («2026-11» → «2026-10»). */
export function prevYm(ym: string): string {
  const [y = 2026, m = 1] = ym.split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type WizardBudgetProposal = {
  categoryId: number;
  name: string;
  /** Gasto del mes pasado en esa categoría, en pesos enteros. */
  suggestedAmount: number;
};

/** Presupuestos propuestos (paso 4): categorías con gasto el mes pasado
 *  (o este mes, si no hay mes pasado) que NO tienen presupuesto este
 *  mes. El monto sugerido es ese gasto. Las 5 de mayor gasto. */
export function proposeBudgets(input: {
  categories: { id: number; name: string }[];
  /** categoryMonthlyTotals de getOverview. */
  totals: { month: string; categoryId: number | null; total: number }[];
  existingBudgets: { categoryId: number; month: string }[];
  currentYm: string;
  limit?: number;
}): WizardBudgetProposal[] {
  const prev = prevYm(input.currentYm);
  const byMonth = (ym: string) =>
    input.totals.filter((t) => t.month === ym && t.categoryId != null && t.total > 0);
  let spend = byMonth(prev);
  if (spend.length === 0) spend = byMonth(input.currentYm);
  const byName = new Map(input.categories.map((c) => [c.id, c.name]));
  const hasBudget = new Set(
    input.existingBudgets
      .filter((b) => b.month === input.currentYm)
      .map((b) => b.categoryId),
  );
  return [...spend]
    .filter((t) => byName.has(t.categoryId as number) && !hasBudget.has(t.categoryId as number))
    .sort((a, b) => b.total - a.total)
    .slice(0, input.limit ?? 5)
    .map((t) => ({
      categoryId: t.categoryId as number,
      name: byName.get(t.categoryId as number) as string,
      suggestedAmount: Math.ceil(t.total),
    }));
}

export type WizardPlanSummary = {
  capacity: number;
  goal: WizardRhythm & { name: string; target: number; saved: number; date: string };
  fund: WizardFundRhythm & { name: string; target: number; date: string; freq: FundFrequency };
  /** Lo que hay que apartar al mes entre meta y fondo. */
  totalPerMonth: number;
  /** true cuando la capacidad cubre el total mensual. */
  affordable: boolean;
  /** Lo que falta al mes cuando no alcanza. */
  shortfall: number;
  /** Lo que queda después de apartar cuando alcanza. */
  leftoverAfter: number;
  /** La cuenta con mayor saldo (solo sugerencia). */
  topAccount: WizardAccount | null;
  /** true cuando el mes ya trae movimientos reales por debajo de lo previsto. */
  realIncomeBelowStated: boolean;
};

/** El resumen del paso 4, con los datos del formulario. */
export function buildPlanSummary(input: {
  income: number;
  fixedExpense: number;
  goal: { name: string; target: number; saved: number; date: string };
  fund: { name: string; target: number; date: string; freq: FundFrequency };
  accounts: WizardAccount[];
  /** Ingreso real del mes en movimientos (0 = sin dato). */
  monthIncome?: number;
  nowMs?: number;
}): WizardPlanSummary {
  const nowMs = input.nowMs ?? Date.now();
  const capacity = wizardCapacity(input.income, input.fixedExpense);
  const goal = {
    ...goalRhythm({ target: input.goal.target, saved: input.goal.saved, targetDate: input.goal.date, nowMs }),
    name: input.goal.name,
    target: input.goal.target,
    saved: input.goal.saved,
    date: input.goal.date,
  };
  const fund = {
    ...fundRhythm({ target: input.fund.target, targetDate: input.fund.date, freq: input.fund.freq, nowMs }),
    name: input.fund.name,
    target: input.fund.target,
    date: input.fund.date,
    freq: input.fund.freq,
  };
  const totalPerMonth = goal.perMonth + fund.perMonth;
  return {
    capacity,
    goal,
    fund,
    totalPerMonth,
    affordable: totalPerMonth <= capacity,
    shortfall: Math.max(0, round2(totalPerMonth - capacity)),
    leftoverAfter: Math.max(0, round2(capacity - totalPerMonth)),
    topAccount: topWizardAccount(input.accounts),
    realIncomeBelowStated:
      (input.monthIncome ?? 0) > 0 && (input.monthIncome ?? 0) < input.income,
  };
}

// ---- Validación por paso: primer error en formal usted, o null. ----

export function validateStep1(income: number, fixedExpense: number): string | null {
  if (!Number.isFinite(income) || income < 0)
    return "Escriba cuánto entra al mes (puede ser $0).";
  if (!Number.isFinite(fixedExpense) || fixedExpense < 0)
    return "Escriba cuánto gasta fijo al mes (puede ser $0).";
  return null;
}

export function validateStep2(
  name: string,
  amount: number,
  saved: number,
  date: string,
  nowMs: number = Date.now(),
): string | null {
  if (!name.trim()) return "Escriba el nombre de la meta.";
  if (!Number.isFinite(amount) || amount <= 0)
    return "Escriba el monto de la meta (mayor que $0).";
  if (!date) return "Elija la fecha límite de la meta.";
  if (date < todayStr(nowMs)) return "La fecha límite debe ser hoy o después.";
  // saveGoalWithPlan exige months ≤ 120 (meses de 30 días).
  if ((fundMonthsLeft(date, nowMs) ?? 1) > 120)
    return "La fecha límite debe ser dentro de 10 años.";
  if (!Number.isFinite(saved) || saved < 0)
    return "Lo ya ahorrado no puede ser negativo.";
  if (saved >= amount) return "Lo ya ahorrado debe ser menor que la meta.";
  return null;
}

export function validateStep3(
  name: string,
  amount: number,
  date: string,
  nowMs: number = Date.now(),
): string | null {
  if (!name.trim()) return "Escriba el nombre del fondo.";
  if (!Number.isFinite(amount) || amount <= 0)
    return "Escriba el monto del fondo (mayor que $0).";
  if (!date) return "Elija la fecha límite del fondo.";
  if (date < todayStr(nowMs)) return "La fecha límite debe ser hoy o después.";
  return null;
}
