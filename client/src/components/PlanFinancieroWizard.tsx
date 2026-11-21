// Asistente «Arma su plan financiero»: flujo guiado en 4 pasos
// (ingreso → meta → fondo → resumen) que crea meta, fondo y
// presupuestos con las acciones que YA existen (saveGoalWithPlan,
// saveFund, saveBudget). NO crea nada hasta el paso 4: puede cerrarse
// en cualquier paso sin crear nada.
//
// Reglas:
// - Tono formal de usted, sin modismos ni emojis; paleta Marfil (las
//   variables --surface/--accent/--border del tema, como el resto de la
//   app). Modal con el mismo patrón que el detalle de la dona.
// - El ingreso es variable: el paso 1 pide lo que entra y lo fijo; si
//   el mes ya trae movimientos reales por debajo de lo previsto, el
//   resumen avisa. Jamás se supone un sueldo fijo.
// - La cuenta NO se supone: el resumen sugiere la de mayor saldo pero
//   pide elegirla; sin cuentas, el asistente lo dice y no crea el plan.
// - Si algo falla al crear, el resultado dice qué quedó creado y qué
//   falló, y ofrece reintentar solo lo que faltó.

import { useMemo, useState } from "react";
import { money, fmtDate } from "../lib/format";
import { Label, inputCls, btnPrimary, btnGhost } from "../lib/uiShared";
import type { FundFrequency } from "../lib/goalMonth";
import {
  buildPlanSummary,
  fundRhythm,
  goalRhythm,
  proposeBudgets,
  topWizardAccount,
  validateStep1,
  validateStep2,
  validateStep3,
  type WizardBudgetProposal,
  type WizardPlanSummary,
} from "../lib/planWizard";

export type PlanWizardAccount = { id: number; name: string; balance: number };
export type PlanWizardProfile = {
  monthlyIncome: number;
  fixedCommitments: number;
} | null;
export type PlanWizardCategory = { id: number; name: string };
export type PlanWizardCategoryTotal = {
  month: string;
  categoryId: number | null;
  total: number;
};
export type PlanWizardExistingBudget = { categoryId: number; month: string };

export type PlanWizardCreateGoalArgs = {
  householdId: number;
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate?: string;
  visibility: "shared" | "private";
  monthlyAmount: number;
  months: number;
  dueDay: number;
  initialAccountId: number | null;
  importance: number;
};

export type PlanWizardCreateFundArgs = {
  householdId: number;
  name: string;
  targetAmount: number | null;
  targetDate?: string;
  visibility: "shared" | "private";
  importance: number;
};

export type PlanWizardCreateBudgetArgs = {
  householdId: number;
  categoryId: number;
  month: string;
  amount: number;
  visibility: "shared" | "private";
};

export type PlanFinancieroWizardProps = {
  householdId: number;
  /** Mes actual en YYYY-MM (para los presupuestos propuestos). */
  currentYm: string;
  /** Día de corte del hogar: día del aporte mensual de la meta. */
  cutoffDay: number;
  /** Perfil activo (para prellenar ingreso y gasto fijo). */
  profile: PlanWizardProfile;
  accounts: PlanWizardAccount[];
  /** Ingreso real del mes en movimientos (0 = sin dato). */
  monthIncome?: number;
  categories: PlanWizardCategory[];
  /** categoryMonthlyTotals de getOverview. */
  /** Gasto por categoría y mes, tal como lo devuelve getOverview. */
  categoryTotals: PlanWizardCategoryTotal[];
  existingBudgets: PlanWizardExistingBudget[];
  onClose: () => void;
  /** Se llama cuando al menos algo quedó creado (para refrescar). */
  onCreated?: () => void;
  createGoal: (args: PlanWizardCreateGoalArgs) => Promise<unknown>;
  createFund: (args: PlanWizardCreateFundArgs) => Promise<unknown>;
  createBudget: (args: PlanWizardCreateBudgetArgs) => Promise<unknown>;
  /** Inyectable para pruebas (fija el «hoy»). */
  nowMs?: number;
};

type ItemState = {
  state: "pendiente" | "creando" | "creado" | "error";
  message?: string;
};

type CreationReport = {
  goal: ItemStatus;
  fund: ItemStatus;
  budgets: Record<number, ItemStatus>;
};
type ItemStatus = ItemState;

type BudgetSel = { checked: boolean; amount: string };

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "No se pudo crear.");

const STEP_TITLES = ["Su ingreso", "Su meta", "Su fondo", "Su resumen"] as const;

export function PlanFinancieroWizard(p: PlanFinancieroWizardProps) {
  const nowMs = p.nowMs ?? Date.now();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | "done">(1);
  const [income, setIncome] = useState(
    p.profile ? String(p.profile.monthlyIncome) : "",
  );
  const [fixedExpense, setFixedExpense] = useState(
    p.profile ? String(p.profile.fixedCommitments) : "",
  );
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalSaved, setGoalSaved] = useState("0");
  const [goalDate, setGoalDate] = useState("");
  const [fundName, setFundName] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [fundDate, setFundDate] = useState("");
  const [fundFreq, setFundFreq] = useState<FundFrequency>("dia");
  const [accountId, setAccountId] = useState("");
  const [budgetSel, setBudgetSel] = useState<Record<number, BudgetSel>>({});
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState<CreationReport | null>(null);

  const topAccount = useMemo(() => topWizardAccount(p.accounts), [p.accounts]);

  const proposals: WizardBudgetProposal[] = useMemo(
    () =>
      proposeBudgets({
        categories: p.categories,
        totals: p.categoryTotals,
        existingBudgets: p.existingBudgets,
        currentYm: p.currentYm,
      }),
    [p.categories, p.categoryTotals, p.existingBudgets, p.currentYm],
  );

  const selOf = (b: WizardBudgetProposal): BudgetSel =>
    budgetSel[b.categoryId] ?? { checked: true, amount: String(b.suggestedAmount) };

  // «Ya ahorrado» vacío = $0; texto no numérico = NaN (lo rechaza la validación).
  const savedNum = goalSaved.trim() === "" ? 0 : Number(goalSaved);

  // Ritmo en vivo del paso 2 (solo con monto y fecha válidos).
  const goalLive =
    num(goalAmount) > 0 && goalDate
      ? goalRhythm({ target: num(goalAmount), saved: savedNum, targetDate: goalDate, nowMs })
      : null;
  // Ritmo en vivo del paso 3.
  const fundLive =
    num(fundAmount) > 0 && fundDate
      ? fundRhythm({ target: num(fundAmount), targetDate: fundDate, freq: fundFreq, nowMs })
      : null;

  const summary: WizardPlanSummary | null =
    (step === 4 || step === "done") && goalLive && fundLive
      ? buildPlanSummary({
          income: num(income),
          fixedExpense: num(fixedExpense),
          goal: { name: goalName.trim(), target: num(goalAmount), saved: savedNum, date: goalDate },
          fund: { name: fundName.trim(), target: num(fundAmount), date: fundDate, freq: fundFreq },
          accounts: p.accounts,
          monthIncome: p.monthIncome ?? 0,
          nowMs,
        })
      : null;

  const checkedBudgets = proposals.filter((b) => selOf(b).checked);

  const next = () => {
    setError("");
    if (step === 1) {
      const e = validateStep1(num(income), num(fixedExpense));
      if (e) return setError(e);
      setStep(2);
    } else if (step === 2) {
      const e = validateStep2(goalName, num(goalAmount), savedNum, goalDate, nowMs);
      if (e) return setError(e);
      setStep(3);
    } else if (step === 3) {
      const e = validateStep3(fundName, num(fundAmount), fundDate, nowMs);
      if (e) return setError(e);
      setStep(4);
    }
  };

  const freshReport = (): CreationReport => ({
    goal: { state: "pendiente" },
    fund: { state: "pendiente" },
    budgets: Object.fromEntries(
      checkedBudgets.map((b) => [b.categoryId, { state: "pendiente" as const }]),
    ),
  });

  const runCreate = async (retryOnly: boolean) => {
    if (creating || !summary) return;
    if (p.accounts.length === 0) {
      setError("Cree una cuenta en Cuentas para que el plan sepa de dónde saldrá el aporte.");
      return;
    }
    if (!accountId) {
      setError("Elija la cuenta de donde saldrá el aporte.");
      return;
    }
    for (const b of checkedBudgets) {
      if (!(num(selOf(b).amount) > 0)) {
        setError(`Revise el monto del presupuesto de ${b.name} (mayor que $0).`);
        return;
      }
    }
    const rep: CreationReport = retryOnly && report ? report : freshReport();
    setReport({ ...rep, budgets: { ...rep.budgets } });
    setError("");
    setCreating(true);
    const put = (patch: Partial<CreationReport>) => {
      Object.assign(rep, patch);
      setReport({ ...rep, budgets: { ...rep.budgets } });
    };
    const putBudget = (categoryId: number, s: ItemState) => {
      rep.budgets[categoryId] = s;
      setReport({ ...rep, budgets: { ...rep.budgets } });
    };
    const saved = savedNum;
    const dueDay = Math.min(28, Math.max(1, p.cutoffDay || 1));
    if (!retryOnly || rep.goal.state === "error") {
      put({ goal: { state: "creando" } });
      try {
        await p.createGoal({
          householdId: p.householdId,
          name: goalName.trim(),
          targetAmount: num(goalAmount),
          savedAmount: saved,
          targetDate: goalDate || undefined,
          visibility: "shared",
          monthlyAmount: summary.goal.perMonth,
          months: summary.goal.monthsLeft,
          dueDay,
          initialAccountId: saved > 0 ? Number(accountId) : null,
          importance: 3,
        });
        put({ goal: { state: "creado" } });
      } catch (e) {
        put({ goal: { state: "error", message: errMsg(e) } });
      }
    }
    if (!retryOnly || rep.fund.state === "error") {
      put({ fund: { state: "creando" } });
      try {
        await p.createFund({
          householdId: p.householdId,
          name: fundName.trim(),
          targetAmount: num(fundAmount),
          targetDate: fundDate || undefined,
          visibility: "shared",
          importance: 3,
        });
        put({ fund: { state: "creado" } });
      } catch (e) {
        put({ fund: { state: "error", message: errMsg(e) } });
      }
    }
    for (const b of checkedBudgets) {
      const cur = rep.budgets[b.categoryId];
      if (retryOnly && cur && cur.state !== "error") continue;
      putBudget(b.categoryId, { state: "creando" });
      try {
        await p.createBudget({
          householdId: p.householdId,
          categoryId: b.categoryId,
          month: p.currentYm,
          amount: num(selOf(b).amount),
          visibility: "shared",
        });
        putBudget(b.categoryId, { state: "creado" });
      } catch (e) {
        putBudget(b.categoryId, { state: "error", message: errMsg(e) });
      }
    }
    setCreating(false);
    setStep("done");
    const anyCreated =
      rep.goal.state === "creado" ||
      rep.fund.state === "creado" ||
      Object.values(rep.budgets).some((b) => b.state === "creado");
    if (anyCreated) p.onCreated?.();
  };

  const stepNum = step === "done" ? 4 : step;
  const allCreated =
    report != null &&
    report.goal.state === "creado" &&
    report.fund.state === "creado" &&
    Object.values(report.budgets).every((b) => b.state === "creado");
  const hasErrors =
    report != null &&
    (report.goal.state === "error" ||
      report.fund.state === "error" ||
      Object.values(report.budgets).some((b) => b.state === "error"));

  const itemLine = (label: string, s: ItemState) => (
    <p key={label} className="text-sm mt-1">
      {s.state === "creado" ? (
        <span className="text-[var(--green)] font-semibold">✓ {label}: creado.</span>
      ) : s.state === "error" ? (
        <span className="text-[var(--red)] font-semibold">
          ✗ {label}: no se pudo crear{s.message ? ` (${s.message})` : "."}
        </span>
      ) : (
        <span className="text-[var(--dim)]">{label}: pendiente.</span>
      )}
    </p>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Arma su plan financiero"
      onClick={() => {
        if (!creating) p.onClose();
      }}
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">
              PASO {stepNum} DE 4 · {STEP_TITLES[stepNum - 1]?.toUpperCase()}
            </p>
            <h2 className="font-display font-bold text-lg leading-tight">
              Arma su plan financiero
            </h2>
            <div className="flex gap-1.5 mt-2" aria-label={`Paso ${stepNum} de 4`}>
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`w-4 h-4 rounded-full ${i <= stepNum ? "bg-[var(--accent)]" : "bg-[var(--surface2)]"}`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar el asistente sin crear nada"
            onClick={() => {
              if (!creating) p.onClose();
            }}
            disabled={creating}
            className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {step === 1 && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--dim)]">
              Con su ingreso y su gasto fijo le proponemos su meta, su fondo y sus presupuestos.
            </p>
            <div>
              <Label htmlFor="pw-income">¿Cuánto entra al mes? ($)</Label>
              <input
                id="pw-income"
                aria-label="Cuánto entra al mes"
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pw-fixed">¿Cuánto gasta fijo al mes? ($)</Label>
              <input
                id="pw-fixed"
                aria-label="Cuánto gasta fijo al mes"
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={fixedExpense}
                onChange={(e) => setFixedExpense(e.target.value)}
              />
            </div>
            <p className="text-xs text-[var(--dim)]">
              Si su ingreso varía, el plan usa lo que realmente entró este mes.
              {(p.monthIncome ?? 0) > 0 && (
                <> Este mes entraron {money(p.monthIncome as number)} en movimientos reales.</>
              )}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--dim)]">
              Su objetivo grande, con fecha límite y su plan mensual.
            </p>
            <div>
              <Label htmlFor="pw-goal-name">Nombre de la meta</Label>
              <input
                id="pw-goal-name"
                aria-label="Nombre de la meta"
                type="text"
                className={inputCls}
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
                placeholder="P. ej. Enganche Depa"
              />
            </div>
            <div>
              <Label htmlFor="pw-goal-amount">Monto de la meta ($)</Label>
              <input
                id="pw-goal-amount"
                aria-label="Monto de la meta"
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={goalAmount}
                onChange={(e) => setGoalAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pw-goal-saved">Ya ahorrado ($, opcional)</Label>
              <input
                id="pw-goal-saved"
                aria-label="Ya ahorrado para la meta"
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={goalSaved}
                onChange={(e) => setGoalSaved(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pw-goal-date">Fecha límite</Label>
              <input
                id="pw-goal-date"
                aria-label="Fecha límite de la meta"
                type="date"
                className={inputCls}
                value={goalDate}
                onChange={(e) => setGoalDate(e.target.value)}
              />
            </div>
            {goalLive && (
              <p className="text-sm">
                Faltan {money(goalLive.perMonth)}/mes · Llegas en {goalLive.monthsLeft}{" "}
                {goalLive.monthsLeft === 1 ? "mes" : "meses"} · {money(goalLive.perDay)} al día
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--dim)]">
              Su apartado para lo que viene, con fecha límite y su ritmo.
            </p>
            <div>
              <Label htmlFor="pw-fund-name">Nombre del fondo</Label>
              <input
                id="pw-fund-name"
                aria-label="Nombre del fondo"
                type="text"
                className={inputCls}
                value={fundName}
                onChange={(e) => setFundName(e.target.value)}
                placeholder="P. ej. Fondo de emergencia"
              />
            </div>
            <div>
              <Label htmlFor="pw-fund-amount">Monto del fondo ($)</Label>
              <input
                id="pw-fund-amount"
                aria-label="Monto del fondo"
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pw-fund-date">Fecha límite</Label>
              <input
                id="pw-fund-date"
                aria-label="Fecha límite del fondo"
                type="date"
                className={inputCls}
                value={fundDate}
                onChange={(e) => setFundDate(e.target.value)}
              />
            </div>
            <div>
              <p className="text-sm font-bold mb-1">¿Cada cuándo aparta?</p>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Frecuencia del fondo">
                {(["dia", "semana", "mes"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-label={`Aportar por ${f === "dia" ? "día" : f === "semana" ? "semana" : "mes"}`}
                    aria-pressed={fundFreq === f}
                    onClick={() => setFundFreq(f)}
                    className={`rounded-full py-2 text-[12px] font-bold ${
                      fundFreq === f
                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                        : "border border-[var(--border)]"
                    }`}
                  >
                    {f === "dia" ? "Por día" : f === "semana" ? "Por semana" : "Por mes"}
                  </button>
                ))}
              </div>
            </div>
            {fundLive && (
              <p className="text-sm">
                {money(fundLive.perDay)} al día · {money(fundLive.perWeek)} a la semana ·{" "}
                {money(fundLive.perMonth)} al mes · Llega a {money(fundLive.projected)} el{" "}
                {fmtDate(fundDate)}
              </p>
            )}
          </div>
        )}

        {step === 4 && summary && (
          <div className="mt-3 space-y-3">
            <p className="text-sm">
              Capacidad del mes: <b>{money(summary.capacity)}</b>{" "}
              <span className="text-[var(--dim)]">
                ({money(num(income))} que entran − {money(num(fixedExpense))} fijos)
              </span>
            </p>
            {summary.realIncomeBelowStated && (p.monthIncome ?? 0) > 0 && (
              <p className="text-sm text-[var(--gold-text)]">
                Ojo: este mes realmente entraron {money(p.monthIncome as number)}, menos que los{" "}
                {money(num(income))} previstos. Si el ingreso no llega, baje el aporte del mes.
              </p>
            )}
            <div className="rounded-2xl bg-[var(--surface2)] p-3">
              <p className="font-display font-bold text-sm">Su meta: {summary.goal.name}</p>
              <p className="text-sm mt-1">
                {money(summary.goal.target)} · Meta {fmtDate(summary.goal.date)} · Faltan{" "}
                {money(summary.goal.perMonth)}/mes · Llegas en {summary.goal.monthsLeft}{" "}
                {summary.goal.monthsLeft === 1 ? "mes" : "meses"}
              </p>
              <p className="text-xs text-[var(--dim)] mt-1">
                {money(summary.goal.perDay)} al día · {money(summary.goal.perWeek)} a la semana
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--surface2)] p-3">
              <p className="font-display font-bold text-sm">Su fondo: {summary.fund.name}</p>
              <p className="text-sm mt-1">
                {money(summary.fund.target)} · Meta {fmtDate(summary.fund.date)} ·{" "}
                {money(summary.fund.chosenAmount)} {summary.fund.chosenLabel === "hoy" ? "al día" : summary.fund.chosenLabel === "esta semana" ? "a la semana" : "al mes"}
              </p>
              <p className="text-xs text-[var(--dim)] mt-1">
                Con este ritmo llega a {money(summary.fund.projected)} el {fmtDate(summary.fund.date)}
              </p>
            </div>
            <p className="text-sm">
              En total: <b>{money(summary.totalPerMonth)}/mes</b> ·{" "}
              {summary.affordable ? (
                <span className="text-[var(--green)] font-semibold">
                  Sí alcanza: después de apartar le quedan {money(summary.leftoverAfter)}.
                </span>
              ) : (
                <span className="text-[var(--red)] font-semibold">
                  No alcanza este mes: faltan {money(summary.shortfall)}. Revise sus gastos o mueva
                  una fecha.
                </span>
              )}
            </p>
            <div>
              <Label htmlFor="pw-account">¿De dónde se descuenta el aporte?</Label>
              {topAccount && (
                <p className="text-xs text-[var(--dim)] mb-1">
                  Sugerencia: {topAccount.name}, la de mayor saldo.
                </p>
              )}
              {p.accounts.length === 0 ? (
                <p className="text-sm text-[var(--red)]">
                  No tiene cuentas. Cree una en Cuentas para que el plan sepa de dónde saldrá el
                  aporte.
                </p>
              ) : (
                <select
                  id="pw-account"
                  aria-label="Cuenta de donde saldrá el aporte"
                  className={inputCls}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Seleccione la cuenta</option>
                  {p.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({money(a.balance)})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <p className="text-sm font-bold mb-1">Presupuestos sugeridos (opcionales)</p>
              {proposals.length === 0 ? (
                <p className="text-sm text-[var(--dim)]">
                  Sin sugerencias: no hay gasto registrado el mes pasado sin presupuesto.
                </p>
              ) : (
                proposals.map((b) => {
                  const sel = selOf(b);
                  return (
                    <div key={b.categoryId} className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`pw-bud-${b.categoryId}`}
                        aria-label={`Crear presupuesto de ${b.name}`}
                        checked={sel.checked}
                        onChange={(e) =>
                          setBudgetSel((prev) => ({
                            ...prev,
                            [b.categoryId]: { ...sel, checked: e.target.checked },
                          }))
                        }
                        className="w-5 h-5 shrink-0"
                      />
                      <label htmlFor={`pw-bud-${b.categoryId}`} className="text-sm flex-1 min-w-0">
                        {b.name}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Monto del presupuesto de ${b.name}`}
                        className={inputCls + " w-28 text-right"}
                        value={sel.amount}
                        disabled={!sel.checked}
                        onChange={(e) =>
                          setBudgetSel((prev) => ({
                            ...prev,
                            [b.categoryId]: { ...sel, amount: e.target.value },
                          }))
                        }
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {step === "done" && report && (
          <div className="mt-3">
            <p className="font-display font-bold text-base">
              {allCreated ? "Su plan quedó creado." : "El plan quedó a medias."}
            </p>
            {itemLine(`Meta «${goalName.trim()}»`, report.goal)}
            {itemLine(`Fondo «${fundName.trim()}»`, report.fund)}
            {checkedBudgets.map((b) =>
              itemLine(
                `Presupuesto de ${b.name}`,
                report.budgets[b.categoryId] ?? { state: "pendiente" },
              ),
            )}
            {hasErrors && (
              <p className="text-sm text-[var(--dim)] mt-2">
                Lo que no se creó no quedó guardado: puede reintentarlo sin duplicar lo que ya
                quedó creado.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--red)] mt-3" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          {step === "done" ? (
            <>
              {hasErrors && (
                <button
                  type="button"
                  aria-label="Reintentar lo que faltó"
                  className={btnPrimary + " flex-1"}
                  disabled={creating}
                  onClick={() => void runCreate(true)}
                >
                  {creating ? "Creando…" : "Reintentar lo que faltó"}
                </button>
              )}
              <button type="button" className={btnGhost + " flex-1"} onClick={p.onClose}>
                Cerrar
              </button>
            </>
          ) : (
            <>
              {step > 1 && (
                <button
                  type="button"
                  aria-label="Volver al paso anterior"
                  className={btnGhost}
                  disabled={creating}
                  onClick={() => setStep((s) => (s === 2 ? 1 : s === 3 ? 2 : 3))}
                >
                  Atrás
                </button>
              )}
              {step < 4 ? (
                <button
                  type="button"
                  aria-label="Ir al siguiente paso"
                  className={btnPrimary + " flex-1"}
                  onClick={next}
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Crear mi plan"
                  className={btnPrimary + " flex-1"}
                  disabled={creating}
                  onClick={() => void runCreate(false)}
                >
                  {creating ? "Creando…" : "Crear mi plan"}
                </button>
              )}
              <button
                type="button"
                aria-label="Cerrar el asistente sin crear nada"
                className={btnGhost}
                disabled={creating}
                onClick={p.onClose}
              >
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
