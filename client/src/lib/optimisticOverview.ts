// Proyección optimista del resumen (getOverview) tras guardar un
// movimiento: los totales de Inicio y Presupuestos muestran el valor
// nuevo en cuanto el servidor confirma el guardado, sin esperar al
// refetch de getOverview (que tarda ~1-2 s y mientras tanto deja los
// valores viejos en pantalla).
//
// Reglas:
// - Solo se proyecta lo que el servidor ya confirmó (se llama desde
//   onSuccess): si el guardado falla, onSuccess no corre y los totales
//   quedan como estaban.
// - Ajuste por delta, nunca recomputo desde las filas visibles: el
//   resumen trae agregados sobre TODO el historial (gasto compartido del
//   mes, sueldo, saldos) que las filas visibles no cubren.
// - La atribución a presupuestos sigue la misma regla del servidor
//   (computeBudgetSpents en server/src/actions.ts): un gasto cuenta como
//   máximo en un presupuesto. Para un movimiento NUEVO la captura es hoy
//   (exacto). Para un movimiento VIEJO (editar/borrar/reversar) la
//   captura se aproxima con su fecha, y el presupuesto solo se toca si
//   esa aproximación es consistente con el gastado que trae el servidor;
//   si no lo es, ese presupuesto se deja como está y el refetch lo
//   corrige (igual que hoy).
// - La lista paginada de Movimientos (listMovements) NO se toca: se
//   refresca con el refetch, como hoy.
import type { OverviewData } from "./helpDynamic";

export interface SavedMovement {
  id: number;
  type: string;
  amount: number;
  concept: string;
  accountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  subcategory: string | null;
  budgetId: number | null;
  splitGroupId: string | null;
  date: string; // YYYY-MM-DD
  visibility: string;
  profileId: number | null;
}

export type MovementChange =
  | { kind: "create"; movement: SavedMovement }
  | { kind: "edit"; movement: SavedMovement; previous: OverviewMovement }
  | { kind: "delete"; previous: OverviewMovement }
  | { kind: "reverse"; previous: OverviewMovement; reversalId: number | null };

type OverviewMovement = OverviewData["movements"][number];
type Budget = OverviewData["budgets"][number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const isExpenseType = (t: string) => t === "expense" || t === "debt_payment";
const isActive = (m: { reversalOfId: number | null; isReversed: boolean }) =>
  m.reversalOfId == null && !m.isReversed;
const monthOf = (date: string) => date.slice(0, 7);

// El presupuesto al que aplica un movimiento, con la misma regla del
// servidor: la asignación explícita (budget_id) gana si sigue valiendo;
// si no, el presupuesto de subcategoría reclama el gasto sin asignar
// dentro de su ventana; si no, el general. `capture` es la fecha de
// captura del movimiento: hoy para uno nuevo, su fecha como aproximación
// para uno viejo (la captura real no viaja en el resumen).
function budgetForMovement(
  ov: OverviewData,
  mv: { categoryId: number | null; subcategory: string | null; budgetId: number | null | undefined; date: string },
  capture: string,
): Budget | null {
  if (mv.categoryId == null) return null;
  // budgetId -1 es la exclusión explícita («gastos generales»).
  if (mv.budgetId === -1) return null;
  const month = monthOf(mv.date);
  const budgets = ov.budgets ?? [];
  if (mv.budgetId != null) {
    const chosen = budgets.find((b) => b.id === mv.budgetId);
    if (
      chosen &&
      chosen.month === month &&
      chosen.categoryId === mv.categoryId &&
      (chosen.subcategory == null || chosen.subcategory === mv.subcategory)
    )
      return chosen;
  }
  const inWindow = (b: Budget) => {
    if (b.includePriorExpenses) return true;
    if (b.startDate) return capture >= b.startDate;
    // «Como nuevo» sin fecha elegida: el corte es la creación del
    // presupuesto, que no viaja en el resumen; la comprobación de
    // consistencia lo valida antes de tocar el presupuesto.
    return true;
  };
  if (mv.subcategory) {
    const sub = budgets.find(
      (b) => b.month === month && b.categoryId === mv.categoryId && b.subcategory === mv.subcategory,
    );
    if (sub && inWindow(sub)) return sub;
  }
  const gen = budgets.find(
    (b) => b.month === month && b.categoryId === mv.categoryId && b.subcategory == null,
  );
  if (gen && inWindow(gen)) return gen;
  return null;
}

// ¿La atribución por aproximación (captura = fecha) reproduce el gastado
// que trae el servidor para este presupuesto? Solo el mes visible está
// completo en la caché (las filas de otros meses son solo las de hoy y
// los originales de reversiones), así que solo se comprueba ese mes.
// Si no coincide, el presupuesto no se toca: la caché no ve todo lo que
// el servidor contó (p. ej. movimientos privados de otro integrante) y
// adivinar dejaría un total que no corresponde a lo guardado.
function budgetAttributionConsistent(ov: OverviewData, budget: Budget): boolean {
  if (budget.month !== ov.summary.currentMonth) return false;
  let sum = 0;
  for (const m of ov.movements ?? []) {
    if (!isActive(m) || !isExpenseType(m.type) || monthOf(m.date) !== budget.month) continue;
    if (budgetForMovement(ov, m, m.date)?.id === budget.id) sum = r2(sum + m.amount);
  }
  return Math.abs(sum - budget.spent) < 0.005;
}

// Reparto del gasto compartido, con la misma fórmula del servidor: la
// base es el gasto compartido del mes si es mayor que cero; si no, el
// total de presupuestos compartidos del mes.
function recomputeContributions(next: OverviewData) {
  const s = next.summary;
  const viewed = s.currentMonth;
  const sharedBudgetsTotal = (next.budgets ?? [])
    .filter((b) => b.month === viewed && b.visibility === "shared")
    .reduce((acc, b) => acc + b.amount, 0);
  const base = s.sharedExpenseMonth > 0 ? s.sharedExpenseMonth : sharedBudgetsTotal;
  const adults = (next.profiles ?? []).filter((p) => p.kind === "adult");
  const totalIncomeAdults = adults.reduce((acc, p) => acc + p.monthlyIncome, 0);
  const rule = next.household?.contributionRule;
  let note = "";
  if (base === 0)
    note =
      "El reparto es $0 porque en el mes en curso no existe gasto compartido ni presupuesto compartido. Registre un gasto con visibilidad Compartida o cree un presupuesto compartido.";
  else if (adults.length === 0)
    note = "Es necesario crear los perfiles de los adultos en la sección Perfiles para repartir el gasto compartido.";
  else if (rule === "proportional" && totalIncomeAdults === 0)
    note =
      "La regla vigente es Proporcional al ingreso, pero los perfiles registran un ingreso de $0. Actualice el ingreso neto mensual en la sección Perfiles para calcular el reparto.";
  else
    note =
      rule === "equal"
        ? `Reparto en partes iguales entre ${adults.length} adulto(s), sobre $${base.toLocaleString("es-MX")} de gasto o presupuesto compartido del mes.`
        : `Reparto proporcional al ingreso, sobre $${base.toLocaleString("es-MX")} del mes.`;
  s.contributionsNote = note;
  s.contributions = adults.map((p) => {
    const capacity = Math.max(0, p.monthlyIncome - p.fixedCommitments);
    let share = 0;
    let pctShare = 0;
    if (base > 0 && adults.length > 0) {
      if (rule === "equal") {
        share = base / adults.length;
        pctShare = 100 / adults.length;
      } else if (totalIncomeAdults > 0) {
        pctShare = (p.monthlyIncome / totalIncomeAdults) * 100;
        share = base * (p.monthlyIncome / totalIncomeAdults);
      }
    }
    return {
      profileId: p.id,
      name: p.name,
      shouldPay: r2(share),
      capacity: r2(capacity),
      income: p.monthlyIncome,
      pctShare: Math.round(pctShare * 10) / 10,
    };
  });
}

interface EffectCtx {
  viewed: string;
  today: string;
  todayMonth: string;
  canSee: (m: { visibility: string; profileId: number | null }) => boolean;
  catName: (categoryId: number | null) => string;
  ownerAdultIncome: number;
}

// Ajusta todos los agregados por el efecto de un movimiento (sign +1 lo
// suma, -1 lo quita), menos los presupuestos y la lista de movimientos,
// que se tratan aparte.
function applyEffect(next: OverviewData, mv: SavedMovement, sign: 1 | -1, ctx: EffectCtx) {
  const s = next.summary;
  const month = monthOf(mv.date);
  const isExp = isExpenseType(mv.type);
  const isInc = mv.type === "income";
  if (month === ctx.viewed) {
    if (isInc) s.monthIncome = r2(s.monthIncome + sign * mv.amount);
    else if (isExp) s.monthExpense = r2(s.monthExpense + sign * mv.amount);
    s.monthNet = r2(s.monthIncome - s.monthExpense);
    // Restante del sueldo: el ingreso no cambia con un movimiento; el
    // gastado sigue a monthExpense.
    s.salarySpent = r2(s.monthExpense);
    s.salaryRemaining = r2(s.salaryIncome - s.salarySpent);
    if (isExp && mv.visibility === "shared") {
      s.sharedExpenseMonth = r2(s.sharedExpenseMonth + sign * mv.amount);
      recomputeContributions(next);
    }
    const personal = next.personal;
    if (personal) {
      personal.salary = ctx.ownerAdultIncome > 0 ? ctx.ownerAdultIncome : r2(s.monthIncome);
      if (isExp) {
        personal.monthSpent = r2(personal.monthSpent + sign * mv.amount);
        personal.remaining = r2(personal.salary - personal.monthSpent);
        const entry = personal.byCategory.find((c) => c.categoryId === mv.categoryId);
        if (entry) {
          entry.total = r2(entry.total + sign * mv.amount);
          if (entry.total <= 0) personal.byCategory.splice(personal.byCategory.indexOf(entry), 1);
        } else if (sign > 0) {
          personal.byCategory.push({
            categoryId: mv.categoryId,
            name: ctx.catName(mv.categoryId),
            total: r2(mv.amount),
            pct: 0,
          });
        }
        for (const c of personal.byCategory)
          c.pct = personal.monthSpent > 0 ? Math.round((c.total / personal.monthSpent) * 100) : 0;
        personal.byCategory.sort((a, b) => b.total - a.total);
      }
      if (mv.date === ctx.today && isExp) {
        personal.todaySpent = r2(personal.todaySpent + sign * mv.amount);
        personal.todayCount = Math.max(0, personal.todayCount + sign);
        if (sign > 0) {
          if (ctx.canSee(mv))
            personal.todayMovements.push({
              id: mv.id,
              concept: mv.concept,
              amount: mv.amount,
              categoryId: mv.categoryId,
              date: mv.date,
            });
        } else {
          const idx = personal.todayMovements.findIndex((t) => t.id === mv.id);
          if (idx >= 0) personal.todayMovements.splice(idx, 1);
        }
      }
    }
  } else if (isInc) {
    s.priorMonthsNet = r2(s.priorMonthsNet + sign * mv.amount);
  } else if (isExp) {
    s.priorMonthsNet = r2(s.priorMonthsNet - sign * mv.amount);
  }
  // Serie mensual (3 meses hasta el mes visible).
  const seriesEntry = s.monthlySeries?.find((e) => e.month === month);
  if (seriesEntry) {
    if (isInc) seriesEntry.income = r2(seriesEntry.income + sign * mv.amount);
    else if (isExp) seriesEntry.expense = r2(seriesEntry.expense + sign * mv.amount);
  }
  // Gasto por categoría y mes (últimos 6 meses hasta el mes visible o el
  // mes en curso, el mayor de los dos).
  if (isExp && mv.categoryId != null && next.categoryMonthlyTotals) {
    const totals = next.categoryMonthlyTotals;
    const entry = totals.find((t) => t.categoryId === mv.categoryId && t.month === month);
    if (entry) {
      entry.total = r2(entry.total + sign * mv.amount);
      if (entry.total <= 0) totals.splice(totals.indexOf(entry), 1);
    } else if (sign > 0) {
      const end = ctx.viewed > ctx.todayMonth ? ctx.viewed : ctx.todayMonth;
      const months = new Set<string>();
      for (let k = 5; k >= 0; k--) {
        const d = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1 - k, 1);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      if (months.has(month)) totals.push({ categoryId: mv.categoryId, month, total: r2(mv.amount) });
    }
  }
  // Cuentas y saldos (toda la vida del hogar).
  const accDelta = isInc ? mv.amount : isExp ? -mv.amount : mv.type === "transfer" ? -mv.amount : 0;
  if (mv.accountId != null) {
    const acc = next.accounts?.find((a) => a.id === mv.accountId);
    if (acc) acc.balance = r2(acc.balance + sign * accDelta);
    const accSum = next.accountSummaries?.find((a) => a.accountId === mv.accountId);
    if (accSum) {
      accSum.balance = r2(accSum.balance + sign * accDelta);
      if (isInc) accSum.income = r2(accSum.income + sign * mv.amount);
      else if (isExp) accSum.expense = r2(accSum.expense + sign * mv.amount);
      else if (mv.type === "transfer") accSum.transfersOut = r2(accSum.transfersOut + sign * mv.amount);
    }
  }
  if (mv.type === "transfer" && mv.toAccountId != null) {
    const toAcc = next.accounts?.find((a) => a.id === mv.toAccountId);
    if (toAcc) toAcc.balance = r2(toAcc.balance + sign * mv.amount);
    const toSum = next.accountSummaries?.find((a) => a.accountId === mv.toAccountId);
    if (toSum) {
      toSum.balance = r2(toSum.balance + sign * mv.amount);
      toSum.transfersIn = r2(toSum.transfersIn + sign * mv.amount);
    }
  }
  if (mv.accountId == null) {
    if (isInc) s.unassignedNet = r2(s.unassignedNet + sign * mv.amount);
    else if (isExp) s.unassignedNet = r2(s.unassignedNet - sign * mv.amount);
  }
  s.totalBalance = r2((next.accounts ?? []).reduce((acc, a) => acc + a.balance, 0) + s.unassignedNet);
  s.availableFree = r2(s.totalBalance - s.fundsReserved);
}

function applyBudgetDelta(next: OverviewData, budgetId: number, delta: number) {
  const b = next.budgets?.find((x) => x.id === budgetId);
  if (!b) return;
  b.spent = r2(b.spent + delta);
  b.remaining = r2(b.amount - b.spent);
  b.pct = b.amount > 0 ? Math.round((b.spent / b.amount) * 100) : 0;
}

export function applyMovementChange(
  prev: OverviewData,
  change: MovementChange,
  opts: { today: string; myEmail: string },
): OverviewData {
  if (!prev.household) return prev;
  const viewed = prev.summary.currentMonth;
  const today = opts.today;
  const myEmailLower = opts.myEmail.toLowerCase();
  const myProfileIds = new Set(
    (prev.profiles ?? [])
      .filter((p) => p.email && p.email.toLowerCase() === myEmailLower)
      .map((p) => p.id),
  );
  const isAdmin = (prev.profiles ?? []).some((p) => p.id === prev.myProfileId && p.role === "admin");
  const canSee = (m: { visibility: string; profileId: number | null }) =>
    isAdmin || m.visibility === "shared" || (m.profileId != null && myProfileIds.has(m.profileId));
  const catName = (categoryId: number | null) => {
    if (categoryId == null) return "Sin categoría";
    return (prev.categories ?? []).find((c) => c.id === categoryId)?.name ?? "Sin categoría";
  };
  const ownerAdult = (prev.profiles ?? []).find((p) => p.kind === "adult");
  const ctx: EffectCtx = {
    viewed,
    today,
    todayMonth: monthOf(today),
    canSee,
    catName,
    ownerAdultIncome: ownerAdult?.monthlyIncome ?? 0,
  };

  // Qué se quita y qué se pone. Un movimiento reversado o una reversión
  // no cuentan en ningún total: solo mueven la lista.
  let removed: OverviewMovement | null = null;
  let added: SavedMovement | null = null;
  let removedActive = false;
  let addedActive = true;
  let reversalRow: OverviewMovement | null = null;
  let removedHadReversal = false;
  if (change.kind === "create") {
    added = change.movement;
  } else if (change.kind === "edit") {
    removed = change.previous;
    removedActive = isActive(change.previous);
    removedHadReversal = (prev.movements ?? []).some((m) => m.reversalOfId === change.previous.id);
    added = change.movement;
    // Si el original ya tiene reversión, el editado sigue sin contar.
    addedActive = !removedHadReversal;
  } else if (change.kind === "delete") {
    removed = change.previous;
    removedActive = isActive(change.previous);
    removedHadReversal = (prev.movements ?? []).some((m) => m.reversalOfId === change.previous.id);
  } else {
    removed = change.previous;
    removedActive = isActive(change.previous);
    if (removedActive) {
      const revType =
        change.previous.type === "income"
          ? "expense"
          : change.previous.type === "transfer"
            ? "transfer"
            : "income";
      reversalRow = {
        id: change.reversalId ?? -change.previous.id,
        type: revType,
        amount: change.previous.amount,
        concept: `Reversión de: ${change.previous.concept}`,
        accountId:
          change.previous.type === "transfer"
            ? change.previous.toAccountId
            : change.previous.accountId,
        toAccountId:
          change.previous.type === "transfer" ? change.previous.accountId : null,
        categoryId: change.previous.categoryId,
        subcategory: change.previous.subcategory,
        budgetId: null,
        splitGroupId: null,
        date: today,
        visibility: change.previous.visibility,
        profileId: change.previous.profileId,
        receiptUrl: null,
        reversalOfId: change.previous.id,
        isReversed: false,
        mine: change.previous.mine,
      } as OverviewMovement;
    }
  }

  // Copia de lo que se va a tocar (el resto se comparte tal cual).
  const next: OverviewData = {
    ...prev,
    summary: {
      ...prev.summary,
      monthlySeries: prev.summary.monthlySeries?.map((e) => ({ ...e })),
      contributions: prev.summary.contributions?.map((c) => ({ ...c })),
    },
    budgets: (prev.budgets ?? []).map((b) => ({ ...b })),
    accounts: (prev.accounts ?? []).map((a) => ({ ...a })),
    accountSummaries: prev.accountSummaries?.map((a) => ({
      ...a,
      setAsides: a.setAsides?.map((x) => ({ ...x })),
    })),
    movements: (prev.movements ?? []).map((m) => ({ ...m })),
    categoryMonthlyTotals: prev.categoryMonthlyTotals?.map((t) => ({ ...t })),
    personal: prev.personal
      ? {
          ...prev.personal,
          byCategory: prev.personal.byCategory.map((c) => ({ ...c })),
          todayMovements: prev.personal.todayMovements.map((t) => ({ ...t })),
        }
      : prev.personal,
  };

  // 1) Agregados (todo menos presupuestos y la lista).
  if (removed && removedActive) applyEffect(next, removed as SavedMovement, -1, ctx);
  if (added && addedActive) applyEffect(next, added, 1, ctx);

  // 2) Presupuestos: el movimiento nuevo atribuye exacto (captura hoy);
  //    el viejo atribuye por aproximación y solo si es consistente.
  if (removed && isExpenseType(removed.type)) {
    const oldBudget = budgetForMovement(prev, removed, removed.date);
    if (oldBudget && removedActive && budgetAttributionConsistent(prev, oldBudget))
      applyBudgetDelta(next, oldBudget.id, -removed.amount);
  }
  if (added && isExpenseType(added.type)) {
    const capture = change.kind === "create" ? today : removed ? removed.date : today;
    const newBudget = budgetForMovement(prev, added, capture);
    if (newBudget) {
      const trusted =
        change.kind === "create" || budgetAttributionConsistent(prev, newBudget);
      if (trusted) applyBudgetDelta(next, newBudget.id, added.amount);
    }
  }

  // 3) Lista de movimientos del resumen (mes visible, hoy y originales
  //    de reversiones), en el mismo orden del servidor: fecha desc., id
  //    desc.
  const list = next.movements;
  if (change.kind === "create" && added) {
    const row: OverviewMovement = {
      ...added,
      receiptUrl: null,
      reversalOfId: null,
      isReversed: false,
      mine: added.profileId != null && myProfileIds.has(added.profileId),
    } as OverviewMovement;
    if (monthOf(added.date) === viewed || added.date === today) list.push(row);
    if (prev.totalMovements != null) next.totalMovements = prev.totalMovements + 1;
    if (prev.monthsWithMovements && !prev.monthsWithMovements.includes(monthOf(added.date)))
      next.monthsWithMovements = [...prev.monthsWithMovements, monthOf(added.date)].sort().reverse();
  } else if (change.kind === "edit" && added && removed) {
    const idx = list.findIndex((m) => m.id === removed.id);
    const row = list[idx];
    if (idx >= 0 && row) {
      list[idx] = {
        ...row,
        type: added.type,
        amount: added.amount,
        concept: added.concept,
        accountId: added.accountId,
        toAccountId: added.toAccountId,
        categoryId: added.categoryId,
        subcategory: added.subcategory,
        budgetId: added.budgetId,
        splitGroupId: added.splitGroupId ?? null,
        date: added.date,
        visibility: added.visibility,
        profileId: added.profileId,
        mine: added.profileId != null && myProfileIds.has(added.profileId),
      };
    }
    if (prev.monthsWithMovements && !prev.monthsWithMovements.includes(monthOf(added.date)))
      next.monthsWithMovements = [...prev.monthsWithMovements, monthOf(added.date)].sort().reverse();
  } else if (change.kind === "delete" && removed) {
    const idx = list.findIndex((m) => m.id === removed.id);
    if (idx >= 0) list.splice(idx, 1);
    // Borrar un original borra también su reversión (como el servidor).
    if (removedHadReversal) {
      const rIdx = list.findIndex((m) => m.reversalOfId === removed.id);
      if (rIdx >= 0) list.splice(rIdx, 1);
    }
    if (prev.totalMovements != null)
      next.totalMovements = prev.totalMovements - (removedHadReversal ? 2 : 1);
  } else if (change.kind === "reverse" && removed) {
    const idx = list.findIndex((m) => m.id === removed.id);
    const row = list[idx];
    if (idx >= 0 && row) list[idx] = { ...row, isReversed: true };
    if (reversalRow && (monthOf(reversalRow.date) === viewed || reversalRow.date === today))
      list.push(reversalRow);
    if (prev.totalMovements != null) next.totalMovements = prev.totalMovements + 1;
    if (prev.monthsWithMovements && !prev.monthsWithMovements.includes(monthOf(today)))
      next.monthsWithMovements = [...prev.monthsWithMovements, monthOf(today)].sort().reverse();
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  return next;
}
