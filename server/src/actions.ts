import { defineAction, rateLimitDb, z, type ActionsModule, type Ctx } from "./space-shim.js";
import {
  mpCreateOrder,
  mpExternalReference,
  mpGetOrder,
  mpMarkPaidFromReference,
  parseMpExternalReference,
  requireMpToken,
} from "./mercadopago.js";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import * as schema from "./schema.js";
import { supabaseAdmin } from "./supabase.js";
import { issueInviteToken, inviteUrl, markToken, markTokensForInvitation, resolveInviteToken, tokenIsUsable, type InviteKind } from "./invites.js";
import { mailConfigured, sendInviteEmail } from "./mail.js";

const vis = z.enum(["private", "shared"]);
const okRes = z.object({ ok: z.literal(true), id: z.number().optional() });
type Ok = z.infer<typeof okRes>;

// ---- Seguridad (checklist aplicado: validación en el servidor, permisos por hogar,
// límites de peticiones, registro de actividad; sin claves ni secretos en el código) ----
// Límite de peticiones por operación, en memoria del proceso: frena abusos y errores en
// cadena. Las operaciones costosas (lectura automática con IA) tienen el límite más estricto.
async function rateLimit(key: string, max: number, windowMs: number) {
  await rateLimitDb(key, max, windowMs);
}
// Registro de actividad (auditoría): nunca debe bloquear la operación principal.
async function logActivity(ctx: Ctx, householdId: number, action: string, detail: string) {
  try { const db = ctx.db; await db.insert(schema.activityLog).values({ householdId, action, detail: detail.slice(0, 300) }); } catch { /* sin registro antes que sin operación */ }
}

// ---- Avisos dentro de la app (campanita + insignia del icono) ----
// Un aviso por integrante del hogar (user_id destinatario). Nunca bloquea
// la operación principal: si la tabla aún no existe (falta correr
// supabase/notifications.sql), la inserción falla en silencio y la app
// sigue funcionando sin avisos.
type NotifInput = { type: "nuevo_integrante" | "gasto_umbral" | "presupuesto_excedido" | "presupuesto_80" | "gasto_anomalo" | "suscripcion_sube" | "tarjeta_corte" | "tarjeta_pago" | "plan_aporte" | "plan_mes_sin_aporte" | "plan_en_riesgo" | "meta_cumplida" | "ajuste_gasto" | "ajuste_sobrante"; title: string; body: string; amount?: number | null; target: string };
async function notifyHousehold(ctx: Ctx, householdId: number, n: NotifInput, excludeUserId?: string | null) {
  try {
    const members = await ctx.db.select().from(schema.householdMembers).where(eq(schema.householdMembers.householdId, householdId));
    const targets = members.filter(m => m.userId !== excludeUserId);
    if (targets.length === 0) return;
    await ctx.db.insert(schema.notifications).values(targets.map(m => ({ householdId, userId: m.userId, type: n.type, title: n.title, body: n.body, amount: n.amount ?? null, target: n.target, isRead: 0 })));
  } catch { /* tabla aún no creada: la operación principal sigue */ }
}
const moneyShort = (n: number) => `$${Math.round(n * 100) / 100}`;
// Revisa si un gasto nuevo debe avisar: (b) supera el límite del hogar
// (umbral) y (c) cruza el presupuesto de su categoría en el mes. El aviso
// de presupuesto solo se crea al cruzar el límite (antes por debajo o
// igual, después por encima), para no repetirlo en cada gasto posterior.
async function checkMovementAlerts(ctx: Ctx, args: { householdId: number; movementId: number; type: string; amount: number; categoryId: number | null; visibility: string; date: string }) {
  try {
    if (args.type !== "expense" && args.type !== "debt_payment") return;
    const db = ctx.db;
    const hh = await db.select().from(schema.households).where(eq(schema.households.id, args.householdId)).limit(1);
    const threshold = hh[0]?.approvalThreshold ?? 0;
    if (threshold > 0 && args.amount > threshold) {
      await notifyHousehold(ctx, args.householdId, { type: "gasto_umbral", title: "Gasto mayor que el límite", body: `Un gasto de ${moneyShort(args.amount)} superó el límite de ${moneyShort(threshold)}.`, amount: args.amount, target: "movimientos" });
    }
    if (args.categoryId) {
      const month = args.date.slice(0, 7);
      const movs = await db.select().from(schema.movements).where(eq(schema.movements.householdId, args.householdId));
      const reversedIds = new Set(movs.filter(m => m.reversalOfId != null).map(m => m.reversalOfId as number));
      const active = movs.filter(m => m.reversalOfId == null && !reversedIds.has(m.id));
      const cat = await db.select().from(schema.categories).where(eq(schema.categories.id, args.categoryId)).limit(1);
      const catName = cat[0]?.name ?? "la categoría";
      const budgets = await db.select().from(schema.budgets).where(eq(schema.budgets.householdId, args.householdId));
      const mine = budgets.filter(b => b.categoryId === args.categoryId && b.month === month);
      for (const b of mine) {
        // Un presupuesto es el límite de su categoría en el mes: cuentan
        // todos los gastos de esa categoría (compartidos y privados),
        // porque el gasto del día y otros gastos privados también se
        // descuentan del presupuesto.
        const spent = (excludeId: number | null) => active.filter(m => m.id !== excludeId && m.categoryId === b.categoryId && m.date.startsWith(b.month) && (m.type === "expense" || m.type === "debt_payment")).reduce((s, m) => s + m.amount, 0);
        const after = spent(null);
        const before = spent(args.movementId);
        // (c1) Presupuesto al 80%: solo al cruzar ese nivel, para no repetir.
        if (b.amount > 0) {
          const pctBefore = before / b.amount;
          const pctAfter = after / b.amount;
          if (pctBefore <= 0.8 && pctAfter > 0.8 && pctAfter <= 1) {
            await notifyHousehold(ctx, args.householdId, { type: "presupuesto_80", title: "Presupuesto al 80%", body: `El gasto de ${catName} llegó a ${moneyShort(after)}, el 80% de su presupuesto de ${moneyShort(b.amount)}.`, amount: after, target: "presupuestos" });
          }
        }
        // (c2) Presupuesto excedido: solo al cruzarlo.
        if (before <= b.amount && after > b.amount) {
          await notifyHousehold(ctx, args.householdId, { type: "presupuesto_excedido", title: "Presupuesto excedido", body: `El gasto de ${catName} llegó a ${moneyShort(after)} y superó su presupuesto de ${moneyShort(b.amount)}.`, amount: after, target: "presupuestos" });
        }
      }
      // (d) Gasto anómalo: más del doble del promedio mensual de los últimos
      // 3 meses completos en esa categoría y al menos $500. Una sola vez
      // por mes y categoría.
      const prevMonths = [ymAdd(month, -1), ymAdd(month, -2), ymAdd(month, -3)];
      const prevTotals = prevMonths.map(ym => active.filter(m => m.categoryId === args.categoryId && m.date.startsWith(ym) && (m.type === "expense" || m.type === "debt_payment")).reduce((s, m) => s + m.amount, 0));
      const monthsWithData = prevTotals.filter(t => t > 0).length;
      if (monthsWithData > 0) {
        const avg = prevTotals.reduce((s, t) => s + t, 0) / monthsWithData;
        if (avg > 0 && args.amount > 2 * avg && args.amount >= 500) {
          if (!(await planNotifExists(ctx, args.householdId, "gasto_anomalo", month, catName))) {
            await notifyHousehold(ctx, args.householdId, { type: "gasto_anomalo", title: "Gasto fuera de lo usual", body: `Un gasto de ${moneyShort(args.amount)} en ${catName} es más del doble de su promedio mensual (${moneyShort(avg)}). Revise que esté bien registrado.`, amount: args.amount, target: "movimientos" });
          }
        }
      }
      // (e) Suscripción que sube: mismo concepto que el mes pasado y más
      // cara (al menos 5% y $20 más). Una sola vez por mes y concepto.
      const mvRows = await db.select().from(schema.movements).where(eq(schema.movements.id, args.movementId)).limit(1);
      const concept = mvRows[0]?.concept ?? "";
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const conceptN = norm(concept);
      if (conceptN.length >= 3) {
        const prevYm = ymAdd(month, -1);
        const prev = active.filter(m => m.id !== args.movementId && m.type === args.type && m.date.startsWith(prevYm) && norm(m.concept) === conceptN).sort((a, b) => b.date.localeCompare(a.date));
        const last = prev[0];
        if (last && args.amount >= last.amount * 1.05 && args.amount - last.amount >= 20) {
          if (!(await planNotifExists(ctx, args.householdId, "suscripcion_sube", month, concept))) {
            await notifyHousehold(ctx, args.householdId, { type: "suscripcion_sube", title: "Suscripción que subió de precio", body: `${concept} subió de ${moneyShort(last.amount)} a ${moneyShort(args.amount)}. Revise si quiere conservarlo.`, amount: args.amount, target: "movimientos" });
          }
        }
      }
    }
    // Si un gasto cruzó un presupuesto, se propone el ajuste de gastos solo:
    // se avisa con la campanita antes de mover nada y nada se aplica sin
    // que el usuario lo acepte en Metas.
    await maybeAutoProposeRecorte(ctx, args.householdId);
  } catch { /* los avisos nunca bloquean el registro del gasto */ }
}

// Avisos periódicos sin banco: corte y pago de tarjetas de crédito. El
// cliente llama a checkPeriodicAlerts una vez por día. Un aviso por tarjeta
// y evento al mes, sin repetir. Nunca bloquea la app: si la tabla
// notifications aún no existe (falta correr el SQL), no pasa nada.
async function checkPeriodicAlerts(ctx: Ctx, householdId: number): Promise<{ created: number }> {
  let created = 0;
  try {
    const db = ctx.db;
    const now = new Date();
    const curMonth = ymOf(now);
    const day = now.getDate();
    const hh = await db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1);
    const cutoffDay = hh[0]?.cutoffDay ?? 1;
    const accounts = await db.select().from(schema.accounts).where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.type, "credit")));
    if (accounts.length === 0) return { created: 0 };
    const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
    const clampCut = (y: number, m: number) => Math.min(cutoffDay, daysInMonth(y, m));
    for (const acc of accounts) {
      const y = now.getFullYear(), m = now.getMonth() + 1;
      // Días hasta el próximo corte.
      let daysToCut: number;
      if (day <= clampCut(y, m)) daysToCut = clampCut(y, m) - day;
      else {
        const nm = m === 12 ? 1 : m + 1;
        const ny = m === 12 ? y + 1 : y;
        daysToCut = (daysInMonth(y, m) - day) + clampCut(ny, nm);
      }
      if (daysToCut <= 3) {
        if (!(await planNotifExists(ctx, householdId, "tarjeta_corte", curMonth, acc.name))) {
          await notifyHousehold(ctx, householdId, { type: "tarjeta_corte", title: "Se acerca el corte de su tarjeta", body: `${acc.name}: el corte es el día ${cutoffDay} de cada mes. Revise sus cargos antes del corte.`, target: "cuentas" });
          created++;
        }
      }
      // Días desde el último corte (para recordar el pago).
      let lastCutYm = curMonth;
      if (day < clampCut(y, m)) lastCutYm = ymAdd(curMonth, -1);
      const { y: ly, m: lm } = ymParts(lastCutYm);
      const lastCut = new Date(ly, lm - 1, Math.min(cutoffDay, daysInMonth(ly, lm)));
      const daysSinceCut = Math.floor((now.getTime() - lastCut.getTime()) / 86400000);
      if (daysSinceCut >= 0 && daysSinceCut <= 3) {
        if (!(await planNotifExists(ctx, householdId, "tarjeta_pago", curMonth, acc.name))) {
          await notifyHousehold(ctx, householdId, { type: "tarjeta_pago", title: "Ya pasó el corte de su tarjeta", body: `${acc.name}: el corte fue el día ${cutoffDay}. Revise su estado de cuenta y anote la fecha límite de pago.`, target: "cuentas" });
          created++;
        }
      }
    }
  } catch { /* los avisos nunca bloquean la app */ }
  return { created };
}

// ---- Plan de ahorro para una meta ----
// El plan se arma con la información financiera real del hogar: ingreso
// mensual, compromisos fijos y gasto promedio de los últimos 3 meses
// completos. El dinero se aparta en un fondo separado ligado a la meta
// (goal_plans.fund_id) y el avance de la meta es el saldo de ese fondo.
// Meses en formato YYYY-MM; las fechas de movimientos son YYYY-MM-DD.
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const ymParts = (ym: string) => { const [y = 2026, m = 1] = ym.split("-").map(Number); return { y, m }; };
// ---- Arqueo de cuentas (auditoría) ----
// Saldos que dice la app, con la misma lógica que getOverview: movimientos
// activos (sin reversiones ni reversados), saldo inicial más movimientos por
// cuenta, y el efectivo como los movimientos sin cuenta (unassignedNet).
// El servidor calcula estos saldos: el cliente solo anota lo contado.
// Restante del sueldo para el renglón de efectivo del arqueo: ingreso
// registrado menos lo gastado en el mes en curso. En Personal es el sueldo
// del perfil; en Familiar, el ingreso conjunto de los adultos. Si no hay
// ingreso registrado, no hay restante que comparar y el efectivo se arquea
// como antes, contra los movimientos sin cuenta.
function salaryRemainingFor(mode: string, adults: { monthlyIncome: number }[], monthExpense: number) {
  const income = mode === "personal" ? (adults[0]?.monthlyIncome ?? 0) : adults.reduce((s, p) => s + p.monthlyIncome, 0);
  const salaryIncome = Math.round(income * 100) / 100;
  const salarySpent = Math.round(monthExpense * 100) / 100;
  return { salaryIncome, salarySpent, salaryRemaining: Math.round((salaryIncome - salarySpent) * 100) / 100, hasSalaryIncome: salaryIncome > 0 ? 1 : 0 };
}
async function appBalancesForHousehold(db: Ctx["db"], householdId: number) {
  const accountsR = await db.select().from(schema.accounts).where(eq(schema.accounts.householdId, householdId));
  const movsR = await db.select().from(schema.movements).where(eq(schema.movements.householdId, householdId));
  const fundMovsR = await db.select().from(schema.fundMovements).where(eq(schema.fundMovements.householdId, householdId));
  const hhR = await db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1);
  const profsR = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, householdId));
  const reversedIds = new Set(movsR.filter(m => m.reversalOfId != null).map(m => m.reversalOfId as number));
  const activeMovs = movsR.filter(m => m.reversalOfId == null && !reversedIds.has(m.id));
  const rows = accountsR.map(a => {
    let bal = a.initialBalance;
    for (const m of activeMovs) {
      if (m.accountId === a.id) {
        if (m.type === "income") bal += m.amount;
        else if (m.type === "expense" || m.type === "debt_payment") bal -= m.amount;
        else if (m.type === "transfer") bal -= m.amount;
      }
      if (m.toAccountId === a.id && m.type === "transfer") bal += m.amount;
    }
    for (const fm of fundMovsR) {
      const anyFm = fm as unknown as { accountId?: number | null };
      if (anyFm.accountId === a.id) { if (fm.type === "contribution") bal -= fm.amount; else bal += fm.amount; }
    }
    return { accountId: a.id, accountName: a.name, appBalance: Math.round(bal * 100) / 100 };
  });
  const cashApp = Math.round(activeMovs.filter(m => m.accountId == null).reduce((s, m) => s + (m.type === "income" ? m.amount : (m.type === "expense" || m.type === "debt_payment") ? -m.amount : 0), 0) * 100) / 100;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthExpense = activeMovs.filter(m => m.date.startsWith(currentMonth) && (m.type === "expense" || m.type === "debt_payment")).reduce((s, m) => s + m.amount, 0);
  const salaryInfo = salaryRemainingFor(hhR[0]?.mode ?? "familiar", profsR.filter(p => p.kind === "adult"), monthExpense);
  return { rows, cashApp, ...salaryInfo };
}
// Solo el administrador hace el arqueo en modo Familiar. En modo Personal
// el único perfil es el dueño (administrador), así que no se restringe.
async function requireCashCountAdmin(ctx: Ctx, householdId: number) {
  const hh = await ctx.db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1);
  if (!hh[0]) throw new Error("No se encontró el hogar indicado.");
  if (hh[0].mode === "familiar" && ctx.userRole !== "admin") throw new Error("Solo el administrador del hogar puede hacer el arqueo de cuentas.");
}
// Dueño de la app: solo su cuenta puede ver la lista global de usuarios de
// la app y las opiniones de los testers. Se verifica por correo y por id de
// usuario en el servidor; ser administrador del hogar no basta.
const APP_OWNER_EMAIL = "heribertocvazquez@gmail.com";
const APP_OWNER_USER_ID = "88531f08-8ec9-4486-87d1-0f6a5d67b06d";
function isAppOwner(ctx: Ctx): boolean {
  return ctx.user.id === APP_OWNER_USER_ID || (ctx.user.email || "").trim().toLowerCase() === APP_OWNER_EMAIL;
}
const monthDiff = (fromYm: string, toYm: string) => { const a = ymParts(fromYm); const b = ymParts(toYm); return (b.y - a.y) * 12 + (b.m - a.m); };
const ymAdd = (ym: string, n: number) => { const { y, m } = ymParts(ym); return ymOf(new Date(y, m - 1 + n, 1)); };
const monthLabelEs = (ym: string) => { const { y, m } = ymParts(ym); return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" }); };
// ¿Ya existe un aviso de este tipo para esta meta desde el mes indicado?
// La tabla notifications no guarda la meta: se busca por el nombre dentro
// del texto, que siempre lo incluye. Si la tabla aún no existe, devuelve
// falso y el aviso se intenta crear (y falla en silencio, como los demás).
async function planNotifExists(ctx: Ctx, householdId: number, type: string, sinceYm: string, goalName: string) {
  try {
    const rows = await ctx.db.select().from(schema.notifications).where(and(eq(schema.notifications.householdId, householdId), eq(schema.notifications.type, type as NotifInput["type"]), gte(schema.notifications.createdAt, new Date(`${sinceYm}-01T00:00:00.000Z`))));
    return rows.some(r => r.body.includes(goalName));
  } catch { return false; }
}
// Revisa todos los planes aceptados del hogar y crea los avisos que toquen:
// (a) se acerca la fecha de la aportación del mes, (b) un mes pasó sin
// aportar, (c) el plan está en riesgo de no llegar a la fecha, (d) la meta
// se cumplió. Cada aviso se crea una sola vez por mes y meta. Nunca bloquea
// la operación principal: si la tabla goal_plans o notifications aún no
// existe (falta correr el SQL), no pasa nada y la app sigue funcionando.
async function checkGoalPlanAlerts(ctx: Ctx, householdId: number) {
  try {
    const db = ctx.db;
    const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, householdId));
    if (plans.length === 0) return;
    const goals = await db.select().from(schema.goals).where(eq(schema.goals.householdId, householdId));
    const fundMovs = await db.select().from(schema.fundMovements).where(eq(schema.fundMovements.householdId, householdId));
    const now = new Date();
    const curMonth = ymOf(now);
    const day = now.getDate();
    for (const plan of plans) {
      const goal = goals.find(g => g.id === plan.goalId);
      if (!goal || plan.status === "cancelado") continue;
      const saved = goal.savedAmount;
      // (d) Meta cumplida: una sola vez; al crearla, el plan queda "cumplido".
      if (saved >= goal.targetAmount && plan.status !== "cumplido") {
        if (!(await planNotifExists(ctx, householdId, "meta_cumplida", plan.startMonth, goal.name))) {
          await notifyHousehold(ctx, householdId, { type: "meta_cumplida", title: "Meta cumplida", body: `La meta ${goal.name} llegó a ${moneyShort(goal.targetAmount)}. Ya puede usar ese ahorro.`, amount: goal.targetAmount, target: "metas" });
        }
        await db.update(schema.goalPlans).set({ status: "cumplido" }).where(eq(schema.goalPlans.id, plan.id));
        continue;
      }
      if (plan.status === "cumplido") continue;
      // Aportes netos del fondo por mes (aportes menos retiros).
      const byMonth = new Map<string, number>();
      for (const fm of fundMovs) {
        if (fm.fundId !== plan.fundId) continue;
        const ym = fm.date.slice(0, 7);
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + (fm.type === "contribution" ? fm.amount : -fm.amount));
      }
      const monthly = plan.monthlyAmount;
      // (b) Meses pasados sin aportar: un aviso por mes y meta.
      for (let k = monthDiff(plan.startMonth, curMonth) - 1; k >= 0; k--) {
        const ym = ymAdd(plan.startMonth, k);
        if ((byMonth.get(ym) ?? 0) < monthly) {
          const label = monthLabelEs(ym);
          if (!(await planNotifExists(ctx, householdId, "plan_mes_sin_aporte", ym, goal.name))) {
            await notifyHousehold(ctx, householdId, { type: "plan_mes_sin_aporte", title: "Aportación pendiente", body: `No se registró la aportación de ${label} para la meta ${goal.name}. Aporte ${moneyShort(monthly)} para ponerse al corriente.`, amount: monthly, target: "metas" });
          }
        }
      }
      // (a) Se acerca la fecha de la aportación de este mes: 3 días antes o el mismo día.
      const thisMonth = byMonth.get(curMonth) ?? 0;
      if (thisMonth < monthly && day >= Math.max(1, plan.dueDay - 3) && day <= plan.dueDay) {
        if (!(await planNotifExists(ctx, householdId, "plan_aporte", curMonth, goal.name))) {
          const falta = Math.round((monthly - thisMonth) * 100) / 100;
          await notifyHousehold(ctx, householdId, { type: "plan_aporte", title: "Aportación de la meta", body: `La aportación de ${monthLabelEs(curMonth)} para la meta ${goal.name} es de ${moneyShort(monthly)}. Faltan ${moneyShort(falta)} y toca el día ${plan.dueDay}.`, amount: monthly, target: "metas" });
        }
      }
      // (c) Plan en riesgo: con el ritmo actual, la meta se cumpliría después de la fecha objetivo.
      if (goal.targetDate) {
        const monthsSinceStart = Math.max(1, monthDiff(plan.startMonth, curMonth) + 1);
        const pace = saved / monthsSinceStart;
        if (pace > 0 && saved < goal.targetAmount) {
          const remainingMonths = Math.ceil((goal.targetAmount - saved) / pace);
          const projectedYm = ymAdd(curMonth, remainingMonths);
          const targetYm = goal.targetDate.slice(0, 7);
          if (projectedYm > targetYm) {
            if (!(await planNotifExists(ctx, householdId, "plan_en_riesgo", ymAdd(curMonth, -1), goal.name))) {
              await notifyHousehold(ctx, householdId, { type: "plan_en_riesgo", title: "Plan de ahorro en riesgo", body: `Con el ritmo actual, la meta ${goal.name} se cumpliría después de ${monthLabelEs(targetYm)}. Aporte más o revise el plan.`, amount: monthly, target: "metas" });
              await db.update(schema.goalPlans).set({ status: "en_riesgo" }).where(eq(schema.goalPlans.id, plan.id));
            }
          } else if (plan.status === "en_riesgo") {
            await db.update(schema.goalPlans).set({ status: "aceptado" }).where(eq(schema.goalPlans.id, plan.id));
          }
        }
      }
    }
    // Cerca de fin de mes, si se gastó menos de lo planeado, se propone
    // mover el sobrante al fondo de la meta. También se avisa antes de
    // mover nada y solo se aplica si el usuario lo acepta en Metas.
    await maybeAutoProposeSobrante(ctx, householdId);
  } catch { /* los avisos nunca bloquean la operación principal */ }
}
// El avance de la meta es el saldo de su fondo: después de cada aporte o
// retiro al fondo del plan, el ahorro de la meta se pone igual al saldo.
async function syncGoalSavedFromFund(ctx: Ctx, householdId: number, fundId: number) {
  try {
    const db = ctx.db;
    const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, householdId));
    const plan = plans.find(p => p.fundId === fundId);
    if (!plan) return;
    const movs = await db.select().from(schema.fundMovements).where(eq(schema.fundMovements.fundId, fundId));
    const balance = Math.round(movs.reduce((s, m) => s + (m.type === "contribution" ? m.amount : -m.amount), 0) * 100) / 100;
    await db.update(schema.goals).set({ savedAmount: Math.max(0, balance) }).where(eq(schema.goals.id, plan.goalId));
  } catch { /* la sincronización nunca bloquea el aporte */ }
}

// ---- Ajuste automático de gastos para llegar a la meta ----
// Cuando una categoría se pasa de su presupuesto del mes, el ajuste toma el
// excedente de otras categorías con margen (las de mayor holgura primero),
// para que la aportación a la meta casi no cambie. Si la aportación tiene
// que cambiar, cambia poco y repartida en los meses que quedan del plan, no
// de golpe. Al final todo queda cubierto: gastos fijos, presupuestos y la
// aportación; si no alcanza, se propone alargar el plazo de la meta en vez
// de dejar algo sin cubrir. Si un mes se gasta menos, el sobrante queda
// como propuesta aparte para moverlo al fondo de la meta. Nada de esto
// mueve dinero: solo calcula. La propuesta se guarda y se avisa con la
// campanita ANTES de mover nada, y solo se aplica si el usuario la acepta
// (y puede cambiar de dónde se recorta).
type AdjustmentCut = { budgetId: number; categoryId: number; name: string; slack: number; cut: number; newBudget: number };
type AdjustmentComputation = {
  goalId: number; goalName: string; month: string;
  overruns: { budgetId: number; categoryId: number; name: string; budget: number; spent: number; over: number }[];
  totalOver: number;
  cuts: AdjustmentCut[];
  totalCut: number;
  uncovered: number;
  income: number; fixedCommitments: number; budgetsTotal: number; adjustedBudgetsTotal: number;
  monthlyAmount: number; monthsLeft: number;
  newMonthlyAmount: number; monthlyDelta: number;
  extendedMonths: number;
  affordable: number;
  coversAll: boolean;
  surplus: { budgetId: number; categoryId: number; name: string; slack: number }[];
  totalSurplus: number;
};
type AdjustmentBase = {
  goalId: number; goalName: string; month: string;
  overruns: { budgetId: number; categoryId: number; name: string; budget: number; spent: number; over: number }[];
  totalOver: number;
  slacks: { budgetId: number; categoryId: number; name: string; budget: number; spent: number; slack: number }[];
  income: number; fixedCommitments: number; budgetsTotal: number;
  monthlyAmount: number; monthsLeft: number; remaining: number;
  planId: number; startMonth: string;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
// Carga los números del mes en curso para una meta con plan: presupuestos
// contra gasto real (con la misma regla de visibilidad que los avisos de
// presupuesto), ingreso y compromisos fijos. Devuelve null si la meta no
// tiene plan aceptado o si ya está completa.
async function loadAdjustmentBase(ctx: Ctx, householdId: number, goalId: number): Promise<AdjustmentBase | null> {
  const db = ctx.db;
  const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, householdId));
  const plan = plans.find(p => p.goalId === goalId && (p.status === "aceptado" || p.status === "en_riesgo"));
  if (!plan) return null;
  const goals = await db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).limit(1);
  const goal = goals[0];
  if (!goal) return null;
  const remaining = round2(goal.targetAmount - goal.savedAmount);
  if (remaining <= 0) return null;
  const now = new Date();
  const curYm = ymOf(now);
  const budgets = await db.select().from(schema.budgets).where(eq(schema.budgets.householdId, householdId));
  const movs = await db.select().from(schema.movements).where(eq(schema.movements.householdId, householdId));
  const reversedIds = new Set(movs.filter(m => m.reversalOfId != null).map(m => m.reversalOfId as number));
  const active = movs.filter(m => m.reversalOfId == null && !reversedIds.has(m.id));
  const isExpense = (m: { type: string }) => m.type === "expense" || m.type === "debt_payment";
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.householdId, householdId));
  const catName = (id: number) => cats.find(c => c.id === id)?.name ?? "Sin categoría";
  const monthBudgets = budgets.filter(b => b.month === curYm);
  const spentFor = (b: { categoryId: number; visibility: string }) => round2(active.filter(m => m.categoryId === b.categoryId && m.date.startsWith(curYm) && isExpense(m)).reduce((s, m) => s + m.amount, 0));
  const overruns = monthBudgets.map(b => { const spent = spentFor(b); return { budgetId: b.id, categoryId: b.categoryId, name: catName(b.categoryId), budget: b.amount, spent, over: round2(spent - b.amount) }; }).filter(r => r.over > 0).sort((a, b) => b.over - a.over);
  const totalOver = round2(overruns.reduce((s, r) => s + r.over, 0));
  const slacks = monthBudgets.map(b => { const spent = spentFor(b); return { budgetId: b.id, categoryId: b.categoryId, name: catName(b.categoryId), budget: b.amount, spent, slack: round2(b.amount - spent) }; }).filter(s => s.slack > 0).sort((a, b) => b.slack - a.slack);
  const profiles = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, householdId));
  const adults = profiles.filter(p => p.kind === "adult");
  const incomeProfiles = adults.reduce((s, p) => s + p.monthlyIncome, 0);
  const fixedCommitments = adults.reduce((s, p) => s + p.fixedCommitments, 0);
  const fullMonths: string[] = [];
  for (let k = 3; k >= 1; k--) fullMonths.push(ymAdd(curYm, -k));
  const avgIncomeMovs = Math.round(fullMonths.reduce((s, ym) => s + active.filter(m => m.date.startsWith(ym) && m.type === "income").reduce((t, m) => t + m.amount, 0), 0) / fullMonths.length * 100) / 100;
  const income = incomeProfiles > 0 ? round2(incomeProfiles) : avgIncomeMovs;
  const budgetsTotal = round2(monthBudgets.reduce((s, b) => s + b.amount, 0));
  const monthsElapsed = Math.max(0, monthDiff(plan.startMonth, curYm));
  const monthsLeft = Math.max(1, plan.months - monthsElapsed);
  return { goalId, goalName: goal.name, month: curYm, overruns, totalOver, slacks, income, fixedCommitments, budgetsTotal, monthlyAmount: plan.monthlyAmount, monthsLeft, remaining, planId: plan.id, startMonth: plan.startMonth };
}
// Con unos recortes dados, calcula el resto: lo que falta por cubrir, lo
// máximo que se puede aportar al mes sin dejar nada sin cubrir, si la
// aportación cambia (poco y repartida en los meses que quedan) y si hay que
// alargar el plazo. Puro cálculo, sin escribir nada.
function deriveAdjustment(base: AdjustmentBase, cuts: AdjustmentCut[]): AdjustmentComputation {
  const totalCut = round2(cuts.reduce((s, c) => s + c.cut, 0));
  const uncovered = round2(base.totalOver - totalCut);
  const adjustedBudgetsTotal = round2(base.budgetsTotal - totalCut);
  const affordable = Math.max(0, round2(base.income - base.fixedCommitments - adjustedBudgetsTotal));
  const surplus = base.slacks.map(s => ({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: round2(s.slack - (cuts.find(c => c.budgetId === s.budgetId)?.cut ?? 0)) })).filter(s => s.slack > 0);
  const totalSurplus = round2(surplus.reduce((s, x) => s + x.slack, 0));
  // Lo que falta por cubrir se reparte en los meses que quedan: la
  // aportación sube poco, no de golpe.
  let newMonthlyAmount = base.monthlyAmount;
  let extendedMonths = 0;
  if (uncovered > 0) newMonthlyAmount = Math.ceil((base.remaining + uncovered) / base.monthsLeft);
  let coversAll = newMonthlyAmount <= affordable;
  if (!coversAll && affordable > 0) {
    // Alargar el plazo: con lo que se puede aportar al mes, ¿en cuántos
    // meses se llega? La aportación baja a lo que cabe en el mes.
    extendedMonths = Math.max(base.monthsLeft, Math.ceil((base.remaining + uncovered) / affordable));
    newMonthlyAmount = Math.ceil((base.remaining + uncovered) / extendedMonths);
    coversAll = newMonthlyAmount <= affordable;
  }
  const monthlyDelta = round2(newMonthlyAmount - base.monthlyAmount);
  return { goalId: base.goalId, goalName: base.goalName, month: base.month, overruns: base.overruns, totalOver: base.totalOver, cuts, totalCut, uncovered, income: base.income, fixedCommitments: base.fixedCommitments, budgetsTotal: base.budgetsTotal, adjustedBudgetsTotal, monthlyAmount: base.monthlyAmount, monthsLeft: base.monthsLeft, newMonthlyAmount, monthlyDelta, extendedMonths, affordable, coversAll, surplus, totalSurplus };
}
async function computeSpendingAdjustment(ctx: Ctx, householdId: number, goalId: number): Promise<AdjustmentComputation | null> {
  const base = await loadAdjustmentBase(ctx, householdId, goalId);
  if (!base) return null;
  // Recortes por defecto: de la categoría con más margen primero; el
  // presupuesto nuevo nunca baja de lo ya gastado.
  const cuts: AdjustmentCut[] = [];
  let remainingOver = base.totalOver;
  for (const s of base.slacks) {
    if (remainingOver <= 0) break;
    const cut = Math.min(s.slack, remainingOver);
    cuts.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: s.slack, cut: round2(cut), newBudget: round2(s.budget - cut) });
    remainingOver = round2(remainingOver - cut);
  }
  return deriveAdjustment(base, cuts);
}
function adjustmentNote(comp: AdjustmentComputation, kind: "recorte" | "sobrante"): string {
  if (kind === "sobrante") return `Sobrante del mes en ${comp.surplus.map(s => s.name).join(", ")}.`;
  if (!comp.coversAll) return `No alcanza para cubrir todo: faltan ${moneyShort(comp.uncovered)} aun con los recortes. Se propone alargar el plazo de la meta.`;
  if (comp.extendedMonths > 0) return `El plazo de la meta se alarga a ${comp.extendedMonths} meses para que todo quede cubierto.`;
  if (comp.monthlyDelta > 0) return `La aportación sube ${moneyShort(comp.monthlyDelta)} al mes, repartida en los ${comp.monthsLeft} meses que quedan.`;
  return "La aportación a la meta no cambia.";
}
function adjustmentCutsJson(comp: AdjustmentComputation, kind: "recorte" | "sobrante"): string {
  return JSON.stringify(kind === "recorte"
    ? comp.cuts.map(c => ({ budgetId: c.budgetId, categoryId: c.categoryId, name: c.name, amount: c.cut, newBudget: c.newBudget }))
    : comp.surplus.map(s => ({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, amount: s.slack })));
}
// Aviso claro del ajuste, ANTES de mover nada: cuánto se pasó, de qué
// categorías se recorta y cuánto de cada una, qué se mantiene igual (la
// aportación a la meta) y qué pasa si no se acepta.
async function notifyAdjustmentProposal(ctx: Ctx, householdId: number, comp: AdjustmentComputation, kind: "recorte" | "sobrante") {
  if (kind === "recorte") {
    const cutsText = comp.cuts.map(c => `${moneyShort(c.cut)} de ${c.name}`).join(", ");
    const aporteText = comp.extendedMonths > 0
      ? `Su aportación a la meta cambia a ${moneyShort(comp.newMonthlyAmount)} al mes y el plazo se alarga a ${comp.extendedMonths} meses.`
      : comp.monthlyDelta > 0
        ? `Su aportación a la meta sube a ${moneyShort(comp.newMonthlyAmount)} al mes.`
        : `Su aportación a la meta sigue igual: ${moneyShort(comp.monthlyAmount)} al mes.`;
    const cubreText = comp.coversAll
      ? "Con este ajuste, sus gastos fijos, sus presupuestos y su aportación quedan cubiertos."
      : "Aun con este ajuste no alcanza para cubrir todo: se propone alargar el plazo de la meta.";
    await notifyHousehold(ctx, householdId, { type: "ajuste_gasto", title: "Ajuste de gastos propuesto", body: `En ${monthLabelEs(comp.month)}, ${comp.overruns[0]?.name ?? "una categoría"} se pasó ${moneyShort(comp.totalOver)} de su presupuesto. Para llegar a su meta ${comp.goalName} sin gastar de más, se propone recortar ${cutsText}. ${aporteText} ${cubreText} Nada se mueve sin que usted lo acepte: revise el ajuste en Metas. Si no lo acepta, la meta se atrasará.`, amount: comp.totalOver, target: "metas" });
  } else {
    const parts = comp.surplus.map(s => `${moneyShort(s.slack)} de ${s.name}`).join(", ");
    await notifyHousehold(ctx, householdId, { type: "ajuste_sobrante", title: "Sobrante para su meta", body: `Este mes gastó menos de lo planeado: sobran ${parts}. Puede mover ${moneyShort(comp.totalSurplus)} al fondo de su meta ${comp.goalName} para llegar antes. Nada se mueve sin que usted lo acepte: revise el ajuste en Metas.`, amount: comp.totalSurplus, target: "metas" });
  }
}
// Guarda (o actualiza) la propuesta pendiente de una meta y un mes. Si ya
// hay una propuesta pendiente, se actualizan los números en silencio, sin
// avisar de nuevo: el aviso ya existe y los números nuevos se ven en Metas.
// Si el usuario ya la rechazó este mes, no se vuelve a proponer solo
// (allowAfterRejection solo lo usa la propuesta manual). Nunca bloquea la
// operación principal: si la tabla aún no existe, devuelve null.
async function saveAdjustmentProposal(ctx: Ctx, householdId: number, comp: AdjustmentComputation, kind: "recorte" | "sobrante", notify: boolean, allowAfterRejection = false): Promise<number | null> {
  try {
    const db = ctx.db;
    const existing = await db.select().from(schema.spendingAdjustments).where(and(eq(schema.spendingAdjustments.householdId, householdId), eq(schema.spendingAdjustments.goalId, comp.goalId), eq(schema.spendingAdjustments.month, comp.month), eq(schema.spendingAdjustments.kind, kind)));
    const pending = existing.find(e => e.status === "propuesto");
    const values = {
      overCategoryId: kind === "recorte" ? (comp.overruns[0]?.categoryId ?? null) : (comp.surplus[0]?.categoryId ?? null),
      overCategoryName: kind === "recorte" ? (comp.overruns[0]?.name ?? "") : (comp.surplus[0]?.name ?? ""),
      overAmount: kind === "recorte" ? comp.totalOver : comp.totalSurplus,
      cuts: adjustmentCutsJson(comp, kind),
      newMonthlyAmount: kind === "recorte" ? comp.newMonthlyAmount : null,
      newMonths: kind === "recorte" && comp.extendedMonths > 0 ? comp.extendedMonths : null,
      extendedMonths: kind === "recorte" ? comp.extendedMonths : 0,
      coversAll: comp.coversAll ? 1 : 0,
      note: adjustmentNote(comp, kind),
    };
    if (pending) {
      await db.update(schema.spendingAdjustments).set(values).where(eq(schema.spendingAdjustments.id, pending.id));
      return pending.id;
    }
    if (existing.some(e => e.status === "rechazado") && !allowAfterRejection) return null;
    const [row] = await db.insert(schema.spendingAdjustments).values({ householdId, goalId: comp.goalId, month: comp.month, kind, status: "propuesto", ...values }).returning({ id: schema.spendingAdjustments.id });
    if (row && notify) await notifyAdjustmentProposal(ctx, householdId, comp, kind);
    return row?.id ?? null;
  } catch { return null; }
}
// Cuando un gasto cruza un presupuesto, se propone el ajuste solo. Nunca
// bloquea el registro del gasto.
async function maybeAutoProposeRecorte(ctx: Ctx, householdId: number) {
  try {
    const plans = await ctx.db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, householdId));
    for (const plan of plans) {
      if (plan.status !== "aceptado" && plan.status !== "en_riesgo") continue;
      const comp = await computeSpendingAdjustment(ctx, householdId, plan.goalId);
      if (!comp || comp.totalOver <= 0) continue;
      await saveAdjustmentProposal(ctx, householdId, comp, "recorte", true, false);
    }
  } catch { /* el ajuste automático nunca bloquea el registro del gasto */ }
}
// Cerca de fin de mes, si se gastó menos de lo planeado y no hay excedente
// que cubrir, se propone mover el sobrante al fondo de la meta.
async function maybeAutoProposeSobrante(ctx: Ctx, householdId: number) {
  try {
    if (new Date().getDate() < 25) return;
    const plans = await ctx.db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, householdId));
    for (const plan of plans) {
      if (plan.status !== "aceptado" && plan.status !== "en_riesgo") continue;
      const comp = await computeSpendingAdjustment(ctx, householdId, plan.goalId);
      if (!comp || comp.totalOver > 0 || comp.totalSurplus < 100) continue;
      await saveAdjustmentProposal(ctx, householdId, comp, "sobrante", true, false);
    }
  } catch { /* el ajuste automático nunca bloquea nada */ }
}
type StoredCut = { budgetId?: number | null; categoryId?: number | null; name: string; amount: number; newBudget?: number | null };
function parseAdjustmentCuts(raw: string): StoredCut[] {
  try { const v = JSON.parse(raw) as StoredCut[]; return Array.isArray(v) ? v.filter(c => c && typeof c.amount === "number" && c.amount > 0) : []; } catch { return []; }
}

// ---- Invitaciones por correo con enlace directo ----
// El correo se envía desde el servidor con Resend (plan gratuito). Si
// RESEND_API_KEY no está configurada, no se envía nada y la acción devuelve
// emailSent=false con el enlace para copiarlo como respaldo: nunca se falla
// en silencio ni se promete un correo que no salió.
async function inviterDisplayName(ctx: Ctx, householdId: number | null): Promise<string> {
  try {
    if (householdId == null) return ctx.user.email.split("@")[0] || "SyncFinanzas";
    const profs = await ctx.db.select().from(schema.profiles).where(eq(schema.profiles.householdId, householdId));
    const mine = profs.find(p => p.userId === ctx.user.id) || profs.find(p => p.role === "admin");
    if (mine) return `${mine.name} ${mine.lastName || ""}`.trim();
  } catch { /* nombre de respaldo */ }
  return ctx.user.email.split("@")[0] || "SyncFinanzas";
}

// ---- Permisos de tanda (Tandas v3): los roles se cumplen en el servidor.
// El cliente oculta los botones que no corresponden al rol, pero la
// autoridad es el servidor: cada acción de tanda verifica el rol de quien
// la llama antes de tocar nada.
// Mapeo usuario → participante: el perfil del hogar (profiles.userId =
// ctx.user.id) y la fila de participante por correo (tandaParticipants.email
// = ctx.user.email); también cuentan los campos organizerProfileId /
// treasurerProfileId / substituteProfileId de la tanda. Un participante
// excluido por votación ya no puede actuar (salvo el administrador del
// hogar). En modo Personal el único usuario es administrador, así que nada
// cambia para él.
type TandaRole = "organizador" | "tesorero" | "suplente" | "participante";
const TANDA_ROLE_RANK: Record<TandaRole, number> = { organizador: 3, tesorero: 2, suplente: 2, participante: 1 };
type TandaAccess = { tanda: typeof schema.tandas.$inferSelect; isAdmin: boolean; rank: number; participantId: number | null; profileId: number | null; isParticipant: boolean };
async function tandaAccess(ctx: Ctx, tandaId: number): Promise<TandaAccess> {
  const db = ctx.db;
  const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, tandaId)).limit(1);
  const td = tdRows[0];
  if (!td) throw new Error("Tanda no encontrada");
  if (ctx.householdId != null && ctx.householdId !== td.householdId) throw new Error("No pertenece a este hogar.");
  const isAdmin = ctx.userRole === "admin";
  const profs = await db.select().from(schema.profiles).where(and(eq(schema.profiles.householdId, td.householdId), eq(schema.profiles.userId, ctx.user.id)));
  const profileId = profs[0]?.id ?? null;
  const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, tandaId));
  const email = ctx.user.email.trim().toLowerCase();
  const mine = email.length > 0 ? parts.find(p => (p.email || "").trim().toLowerCase() === email) ?? null : null;
  const excluded = !!mine && mine.excluded === 1;
  let rank = 0;
  let participantId: number | null = null;
  if (!excluded) {
    if (mine) { rank = TANDA_ROLE_RANK[(mine.role as TandaRole) || "participante"]; participantId = mine.id; }
    if (profileId != null) {
      // El organizador, tesorero o suplente designados al crear la tanda
      // conservan su rol aunque su fila de participante diga otra cosa.
      if (td.organizerProfileId === profileId) rank = Math.max(rank, 3);
      else if (td.treasurerProfileId === profileId) rank = Math.max(rank, 2);
      else if (td.substituteProfileId === profileId) rank = Math.max(rank, 2);
    }
  }
  return { tanda: td, isAdmin, rank, participantId, profileId, isParticipant: participantId != null };
}
// Exige un nivel mínimo de rol en la tanda (3 organizador, 2 tesorero o
// suplente, 1 participante). El administrador del hogar siempre puede.
function requireTandaRank(acc: TandaAccess, minRank: number) {
  if (!acc.isAdmin && acc.rank < minRank) throw new Error("No tiene permiso para esta acción.");
}
function requireTandaParticipant(acc: TandaAccess) {
  if (!acc.isAdmin && !acc.isParticipant) throw new Error("No tiene permiso para esta acción.");
}
function requireTandaHousehold(acc: TandaAccess, householdId: number) {
  if (acc.tanda.householdId !== householdId) throw new Error("La tanda no pertenece a este hogar.");
}

type InviteSendResult = { emailSent: boolean; emailConfigured: boolean; inviteUrl: string; tokenId: number };

async function sendInviteForToken(
  ctx: Ctx,
  kind: InviteKind,
  args: { email: string; householdId?: number | null; tandaId?: number | null; invitationId?: number | null; tandaInvitationId?: number | null; invitedName?: string | null },
  mail: { subject: string; heading: string; bodyHtml: string; bodyText: string },
): Promise<InviteSendResult> {
  const inviterName = await inviterDisplayName(ctx, args.householdId ?? null);
  const issued = await issueInviteToken(ctx.db, {
    kind,
    email: args.email,
    householdId: args.householdId ?? null,
    tandaId: args.tandaId ?? null,
    invitationId: args.invitationId ?? null,
    tandaInvitationId: args.tandaInvitationId ?? null,
    invitedName: args.invitedName ?? null,
    inviterName,
    createdByUserId: ctx.user.id,
  });
  const url = inviteUrl(ctx.appUrl, issued.raw);
  const configured = mailConfigured();
  let sent = false;
  if (configured) {
    const res = await sendInviteEmail({ to: args.email.trim().toLowerCase(), subject: mail.subject, heading: mail.heading, bodyHtml: mail.bodyHtml, bodyText: mail.bodyText, inviteUrl: url });
    sent = res.sent;
    if (!sent) await logActivity(ctx, args.householdId ?? 0, "Correo de invitación no enviado", res.error ?? "El servicio de correo no respondió.");
  }
  return { emailSent: sent, emailConfigured: configured, inviteUrl: url, tokenId: issued.id };
}

const INCOME_CATS: [string, string[]][] = [
  ["Salario", ["Nómina", "Bono", "Aguinaldo"]],
  ["Negocio", ["Ventas", "Servicios", "Comisiones"]],
  ["Inversión", ["Dividendos", "Intereses", "Rentas financieras"]],
  ["Renta", ["Renta de inmueble", "Renta temporal"]],
  ["Pensión", ["Pensión", "Jubilación"]],
  ["Apoyo familiar", ["Remesa", "Apoyo"]],
  ["Otro ingreso", ["Venta de artículo", "Reembolso", "Otro"]],
];
const EXPENSE_CATS: [string, string[]][] = [
  ["Alimentación", ["Súper", "Restaurante", "Café", "Delivery"]],
  ["Vivienda", ["Renta/Hipoteca", "Mantenimiento", "Predial"]],
  ["Transporte", ["Gasolina", "Transporte público", "Taxi/App", "Mantenimiento auto"]],
  ["Salud", ["Consulta", "Farmacia", "Seguro médico", "Dental"]],
  ["Educación", ["Colegiatura", "Cursos", "Libros", "Útiles"]],
  ["Servicios", ["Luz", "Agua", "Internet", "Teléfono", "Gas"]],
  ["Entretenimiento", ["Cine", "Streaming", "Salidas", "Deporte"]],
  ["Ropa", ["Ropa", "Calzado", "Accesorios"]],
  ["Mascotas", ["Alimento", "Veterinario", "Accesorios"]],
  ["Deudas", ["Tarjeta", "Préstamo", "Crédito"]],
  ["Impuestos", ["SAT", "Tenencia", "Otros impuestos"]],
  ["Viajes", ["Hospedaje", "Vuelos", "Comida en viaje"]],
  ["Cuidado personal", ["Salón", "Gimnasio", "Productos"]],
  ["Otro gasto", ["Regalos", "Donación", "Otro"]],
];

export const Actions = {
  getOverview: defineAction({
    description: "Returns the full household state with computed totals that always reconcile.",
    request: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
    response: z.object({
      household: z.object({ id: z.number(), name: z.string(), currency: z.string(), cutoffDay: z.number(), contributionRule: z.string(), approvalRule: z.string(), approvalThreshold: z.number(), mode: z.string() }).nullable(),
      profiles: z.array(z.object({ id: z.number(), name: z.string(), lastName: z.string().nullable(), role: z.string(), email: z.string().nullable(), kind: z.string(), dependentType: z.string().nullable(), monthlyIncome: z.number(), fixedCommitments: z.number(), capacity: z.number() })), invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), status: z.string(), householdName: z.string() })),
      accounts: z.array(z.object({ id: z.number(), name: z.string(), type: z.string(), visibility: z.string(), initialBalance: z.number(), balance: z.number(), ownerProfileId: z.number().nullable() })),
      categories: z.array(z.object({ id: z.number(), name: z.string(), kind: z.string(), isSystem: z.number(), isActive: z.number(), subcategories: z.array(z.string()) })),
      movements: z.array(z.object({ id: z.number(), type: z.string(), amount: z.number(), concept: z.string(), accountId: z.number().nullable(), toAccountId: z.number().nullable(), categoryId: z.number().nullable(), subcategory: z.string().nullable(), date: z.string(), visibility: z.string(), profileId: z.number().nullable(), receiptUrl: z.string().nullable(), reversalOfId: z.number().nullable(), isReversed: z.boolean(), mine: z.boolean() })),
      budgets: z.array(z.object({ id: z.number(), categoryId: z.number(), month: z.string(), amount: z.number(), visibility: z.string(), spent: z.number(), remaining: z.number(), pct: z.number() })),
      funds: z.array(z.object({ id: z.number(), name: z.string(), targetAmount: z.number().nullable(), visibility: z.string(), balance: z.number() })),
      fundMovements: z.array(z.object({ id: z.number(), fundId: z.number(), type: z.string(), amount: z.number(), date: z.string(), note: z.string().nullable() })),
      goals: z.array(z.object({ id: z.number(), name: z.string(), targetAmount: z.number(), savedAmount: z.number(), targetDate: z.string().nullable(), visibility: z.string(), pct: z.number() })),
      goalPlans: z.array(z.object({ goalId: z.number(), monthlyAmount: z.number(), months: z.number(), startMonth: z.string(), dueDay: z.number(), fundId: z.number().nullable(), status: z.string(), fundBalance: z.number(), contributedThisMonth: z.number(), expectedByNow: z.number(), onTrack: z.boolean(), monthsLeft: z.number(), projectedDate: z.string().nullable(), atRisk: z.boolean() })),
      spendingAdjustments: z.array(z.object({ id: z.number(), goalId: z.number(), goalName: z.string(), month: z.string(), kind: z.string(), status: z.string(), overCategoryName: z.string(), overAmount: z.number(), cuts: z.array(z.object({ budgetId: z.number().nullable(), categoryId: z.number().nullable(), name: z.string(), amount: z.number(), newBudget: z.number().nullable() })), newMonthlyAmount: z.number().nullable(), newMonths: z.number().nullable(), extendedMonths: z.number(), coversAll: z.boolean(), note: z.string(), createdAt: z.string() })),
      agreements: z.array(z.object({ id: z.number(), title: z.string(), description: z.string(), status: z.string(), votes: z.array(z.object({ profileId: z.number(), vote: z.string() })) })),
      patrimony: z.array(z.object({ id: z.number(), name: z.string(), kind: z.string(), category: z.string(), value: z.number(), owner: z.string().nullable() })),
      personal: z.object({ salary: z.number(), monthSpent: z.number(), remaining: z.number(), todaySpent: z.number(), todayCount: z.number(), byCategory: z.array(z.object({ categoryId: z.number().nullable(), name: z.string(), total: z.number(), pct: z.number() })), todayMovements: z.array(z.object({ id: z.number(), concept: z.string(), amount: z.number(), categoryId: z.number().nullable(), date: z.string() })) }),
      tandas: z.array(z.object({ id: z.number(), name: z.string(), participantCount: z.number(), amountPerQuincena: z.number(), startDate: z.string(), potPerQuincena: z.number(), organizerName: z.string().nullable(), organizerProfileId: z.number().nullable(), frequency: z.string(), cadenceDays: z.number(), drawMode: z.string(), coverageRule: z.string(), fineAmount: z.number(), meetingDay: z.string(), treasurerProfileId: z.number().nullable(), treasurerName: z.string().nullable(), substituteProfileId: z.number().nullable(), substituteName: z.string().nullable(), turnsLocked: z.number(), organizerRating: z.object({ avg: z.number(), count: z.number() }), ratings: z.array(z.object({ id: z.number(), raterName: z.string(), stars: z.number(), comment: z.string().nullable() })), invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), status: z.string() })), participants: z.array(z.object({ id: z.number(), name: z.string(), email: z.string().nullable(), drawOrder: z.number().nullable(), cardLast4: z.string().nullable(), joinedDate: z.string().nullable(), role: z.string(), excluded: z.number(), stats: z.object({ paidCount: z.number(), dueCount: z.number(), onTimePct: z.number(), avgDaysEarly: z.number(), seniorityDays: z.number(), score: z.number(), streak: z.number() }) })), calendar: z.array(z.object({ index: z.number(), date: z.string(), receiverName: z.string().nullable(), receiverId: z.number().nullable(), amount: z.number() })), payments: z.array(z.object({ participantId: z.number(), quincenaIndex: z.number(), status: z.string(), reminderSent: z.number(), paidDate: z.string().nullable(), proofUrl: z.string().nullable(), verified: z.number(), fineAmount: z.number() })), fines: z.array(z.object({ id: z.number(), participantId: z.number(), quincenaIndex: z.number(), amount: z.number(), reason: z.string(), status: z.string() })), votes: z.array(z.object({ id: z.number(), targetParticipantId: z.number(), voterName: z.string(), vote: z.string(), reason: z.string().nullable() })), deliveries: z.array(z.object({ quincenaIndex: z.number(), receiverId: z.number().nullable(), organizerConfirmed: z.number(), receiverConfirmed: z.number() })), fundEntries: z.array(z.object({ id: z.number(), participantId: z.number().nullable(), kind: z.string(), amount: z.number(), note: z.string().nullable() })), balances: z.object({ aportacion: z.number(), fondo: z.number(), multasPendientes: z.number(), multasCobradas: z.number() }), attendance: z.object({ index: z.number(), date: z.string(), receiverName: z.string().nullable(), receiverId: z.number().nullable(), amount: z.number(), items: z.array(z.object({ participantId: z.number(), name: z.string(), status: z.string(), paidDate: z.string().nullable(), proofUrl: z.string().nullable(), verified: z.number(), fineAmount: z.number() })) }) })),
      summary: z.object({
        totalBalance: z.number(), totalInFunds: z.number(), availableFree: z.number(),
        openingBalance: z.number(), priorMonthsNet: z.number(), fundsFromAccounts: z.number(), fundsReserved: z.number(),
        monthIncome: z.number(), monthExpense: z.number(), monthNet: z.number(),
        sharedExpenseMonth: z.number(), unassignedNet: z.number(), totalAssets: z.number(), totalLiabilities: z.number(), netWorth: z.number(),
        salaryIncome: z.number(), salarySpent: z.number(), salaryRemaining: z.number(), hasSalaryIncome: z.number(),
        currentMonth: z.string(),
        contributions: z.array(z.object({ profileId: z.number(), name: z.string(), shouldPay: z.number(), capacity: z.number(), income: z.number(), pctShare: z.number() })),
        contributionsNote: z.string(), monthlySeries: z.array(z.object({ month: z.string(), label: z.string(), income: z.number(), expense: z.number() })),
      }),
      activity: z.array(z.object({ id: z.number(), action: z.string(), detail: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db;
      // Mes que muestra el tablero: por defecto el mes en curso; el cliente
      // puede pedir otro mes con el selector de mes y año. Todas las cifras
      // del mes (dona, gráfica, movimientos del mes, presupuestos, reparto)
      // se calculan sobre ese mes. Lo de "hoy" (gasto del día, planes de
      // ahorro, tandas) sigue usando la fecha real.
      const now = new Date();
      const currentMonth = args.month ?? `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      const [viewYear = 2026, viewMonthNum = 1] = currentMonth.split("-").map(Number);
      // Seguridad multiusuario: en la versión de Muse había un solo hogar por
      // espacio y se tomaba "el primero de la base". Fuera de Muse hay muchos
      // hogares; el hogar es siempre el del usuario autenticado (ctx.householdId,
      // resuelto por el despachador desde household_members). Sin membresía no
      // se devuelve ningún hogar.
      const hhRows = ctx.householdId == null ? [] : await db.select().from(schema.households).where(eq(schema.households.id, ctx.householdId)).limit(1);
      const hh = hhRows[0];
      if (!hh) {
        return {
          household: null, profiles: [], invitations: [], accounts: [], categories: [], movements: [], budgets: [], funds: [], fundMovements: [], goals: [], goalPlans: [], spendingAdjustments: [], agreements: [], patrimony: [],
          personal: { salary: 0, monthSpent: 0, remaining: 0, todaySpent: 0, todayCount: 0, byCategory: [], todayMovements: [] }, tandas: [], activity: [], summary: { totalBalance: 0, totalInFunds: 0, availableFree: 0, openingBalance: 0, priorMonthsNet: 0, fundsFromAccounts: 0, fundsReserved: 0, monthIncome: 0, monthExpense: 0, monthNet: 0, sharedExpenseMonth: 0, unassignedNet: 0, totalAssets: 0, totalLiabilities: 0, netWorth: 0, salaryIncome: 0, salarySpent: 0, salaryRemaining: 0, hasSalaryIncome: 0, currentMonth, contributions: [], contributionsNote: "Crea tu hogar para empezar.", monthlySeries: [] },
        };
      }
      const hid = hh.id;
      // Consultas en secuencia, NO en Promise.all: con una sola conexión
      // Postgres (max: 1, pooler de Supabase en modo transacción), lanzar
      // 17 consultas a la vez atasca la conexión y la petición se cuelga
      // hasta agotar el tiempo de la función. En secuencia cada una tarda
      // milisegundos y el total sigue por debajo de 1 s.
      const profilesR = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, hid));
      const accountsR = await db.select().from(schema.accounts).where(eq(schema.accounts.householdId, hid));
      const catsR = await db.select().from(schema.categories).where(eq(schema.categories.householdId, hid));
      const movsR = await db.select().from(schema.movements).where(eq(schema.movements.householdId, hid)).orderBy(desc(schema.movements.date), desc(schema.movements.id));
      const budgetsR = await db.select().from(schema.budgets).where(eq(schema.budgets.householdId, hid));
      const fundsR = await db.select().from(schema.funds).where(eq(schema.funds.householdId, hid));
      const fundMovsR = await db.select().from(schema.fundMovements).where(eq(schema.fundMovements.householdId, hid)).orderBy(desc(schema.fundMovements.date));
      const goalsR = await db.select().from(schema.goals).where(eq(schema.goals.householdId, hid));
      const agR = await db.select().from(schema.agreements).where(eq(schema.agreements.householdId, hid)).orderBy(desc(schema.agreements.id));
      const votesR = await db.select().from(schema.agreementVotes);
      const patrR = await db.select().from(schema.patrimonyItems).where(eq(schema.patrimonyItems.householdId, hid));
      const tandasR = await db.select().from(schema.tandas).where(eq(schema.tandas.householdId, hid)).orderBy(desc(schema.tandas.id));
      const tandaPartsR = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.householdId, hid));
      const tandaPaysR = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.householdId, hid));
      const invsR = await db.select().from(schema.invitations).where(eq(schema.invitations.householdId, hid));
      const tandaInvsR = await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.householdId, hid)).orderBy(desc(schema.tandaInvitations.id));
      const orgRatingsR = await db.select().from(schema.organizerRatings).where(eq(schema.organizerRatings.householdId, hid)).orderBy(desc(schema.organizerRatings.id));
      // Tandas v3: las tablas nuevas existen solo si Heriberto ya ejecutó
      // supabase/tandas-v3.sql. Si aún no, se devuelven listas vacías y la
      // tanda se ve como antes, sin romper getOverview.
      const safeRows = async <T>(fn: () => Promise<T[]>): Promise<T[]> => { try { return await fn(); } catch { return []; } };
      const tandaFinesR = await safeRows(() => db.select().from(schema.tandaFines).where(eq(schema.tandaFines.householdId, hid)));
      const tandaVotesR = await safeRows(() => db.select().from(schema.tandaVotes).where(eq(schema.tandaVotes.householdId, hid)));
      const tandaDeliveriesR = await safeRows(() => db.select().from(schema.tandaDeliveries).where(eq(schema.tandaDeliveries.householdId, hid)));
      const tandaFundEntriesR = await safeRows(() => db.select().from(schema.tandaFundEntries).where(eq(schema.tandaFundEntries.householdId, hid)));
      // Plan de ahorro por meta: la tabla existe solo si Heriberto ya
      // ejecutó supabase/goal-plans.sql. Si aún no, la lista sale vacía y
      // las metas se ven como antes, sin romper getOverview. Los planes se
      // leen más abajo, después de revisar los avisos, porque esa revisión
      // puede cambiar su estado (cumplido/en riesgo).

      // Reversiones: un movimiento reversado y su reversión se anulan entre sí; ninguno de los dos
      // se considera en saldos, totales, presupuestos, gráficas ni reparto. Ambos quedan visibles
      // en la lista de Movimientos con su marca, como rastro de auditoría (no se borra nada).
      const reversedIds = new Set(movsR.filter(m=>m.reversalOfId!=null).map(m=>m.reversalOfId as number));
      const activeMovs = movsR.filter(m=>m.reversalOfId==null && !reversedIds.has(m.id));

      // Privacidad a nivel de servidor (punto 5 de la auditoría): un
      // integrante ve solo los movimientos Compartidos y los suyos propios;
      // el admin del hogar ve todos. Los totales y agregados del hogar
      // (saldos, Disponible, dona por categoría, serie mensual, presupuestos)
      // se calculan con TODOS los movimientos, porque no revelan conceptos;
      // lo que se filtra son las filas que viajan al navegador (lista de
      // movimientos y movimientos del día), incluidos sus comprobantes.
      const myProfileIds = new Set(profilesR.filter(p=>p.userId===ctx.user.id).map(p=>p.id));
      const canSeeMovement = (m: { visibility: string; profileId: number | null }): boolean =>
        ctx.userRole === "admin" || m.visibility === "shared" || (m.profileId != null && myProfileIds.has(m.profileId));

      // account balances
      const accounts = accountsR.map(a => {
        let bal = a.initialBalance;
        for (const m of activeMovs) {
          if (m.accountId === a.id) {
            if (m.type === "income") bal += m.amount;
            else if (m.type === "expense" || m.type === "debt_payment") bal -= m.amount;
            else if (m.type === "transfer") bal -= m.amount;
          }
          if (m.toAccountId === a.id && m.type === "transfer") bal += m.amount;
        }
        for (const fm of fundMovsR) {
          // fund movements linked via movements? we store accountId in fundMovements - need to fetch raw: fundMovsR has no accountId in select? it does in schema but type may include
          const anyFm = fm as unknown as { accountId?: number | null };
          if (anyFm.accountId === a.id) {
            if (fm.type === "contribution") bal -= fm.amount; else bal += fm.amount;
          }
        }
        return { id: a.id, name: a.name, type: a.type, visibility: a.visibility, initialBalance: a.initialBalance, balance: Math.round(bal*100)/100, ownerProfileId: a.ownerProfileId ?? null };
      });
      const unassignedNet = Math.round(activeMovs.filter(m=>m.accountId==null).reduce((s,m)=> s + (m.type==="income"? m.amount : (m.type==="expense"||m.type==="debt_payment")? -m.amount : 0),0)*100)/100;
      const totalBalance = accounts.reduce((s,a)=>s+a.balance,0) + unassignedNet;

      const funds = fundsR.map(f => {
        const bal = fundMovsR.filter(x=>x.fundId===f.id).reduce((s,x)=> s + (x.type==="contribution"? x.amount : -x.amount),0);
        return { id: f.id, name: f.name, targetAmount: f.targetAmount ?? null, visibility: f.visibility, balance: Math.round(bal*100)/100 };
      });
      const totalInFunds = funds.reduce((s,f)=>s+f.balance,0);

      // Serie mensual: termina en el mes que muestra el tablero, no
      // necesariamente en el mes real.
      const viewDate = new Date(viewYear, (viewMonthNum || 1) - 1, 1);
      const monthMovs = activeMovs.filter(m=>m.date.startsWith(currentMonth));
      const monthIncome = monthMovs.filter(m=>m.type==="income").reduce((s,m)=>s+m.amount,0);
      const monthExpense = monthMovs.filter(m=>m.type==="expense"||m.type==="debt_payment").reduce((s,m)=>s+m.amount,0);
      // Conciliación Disponible vs Neto del mes. El Total no es solo el mes
      // en curso: arrastra el saldo inicial de las cuentas y el neto de los
      // meses anteriores, y ya no trae el dinero que salió de las cuentas
      // hacia los fondos. Disponible solo descuenta el dinero apartado en
      // fondos que sigue dentro de las cuentas (aportaciones sin cuenta,
      // como el saldo inicial de una meta o el sobrante del mes): restar
      // todos los fondos otra vez contaría dos veces lo que salió de una
      // cuenta, porque la aportación ya descuenta su saldo.
      const openingBalance = accountsR.reduce((s,a)=>s+a.initialBalance,0);
      const priorMonthsNet = activeMovs.filter(m=>!m.date.startsWith(currentMonth)).reduce((s,m)=> s + (m.type==="income"? m.amount : (m.type==="expense"||m.type==="debt_payment")? -m.amount : 0),0);
      const fundsFromAccounts = fundMovsR.reduce((s,fm)=>{ const accId = (fm as unknown as { accountId?: number | null }).accountId; if (accId==null) return s; return s + (fm.type==="contribution"? fm.amount : -fm.amount); },0);
      const fundsReserved = totalInFunds - Math.max(0, fundsFromAccounts);
      const availableFree = totalBalance - fundsReserved;
      const sharedExpenseMonth = monthMovs.filter(m=>(m.type==="expense"||m.type==="debt_payment") && m.visibility==="shared").reduce((s,m)=>s+m.amount,0);
      // also include shared budgets if no movements? Use max(sharedExpense, ? ) - keep sharedExpense as base, but if budgets shared total >0 and expense 0, note
      const sharedBudgetsTotal = budgetsR.filter(b=>b.month===currentMonth && b.visibility==="shared").reduce((s,b)=>s+b.amount,0);
      const baseForContributions = sharedExpenseMonth > 0 ? sharedExpenseMonth : sharedBudgetsTotal;

      // Un presupuesto es el límite de su categoría en el mes: cuentan todos
      // los gastos de esa categoría (compartidos y privados), porque el gasto
      // del día y otros gastos privados también se descuentan del presupuesto.
      const budgets = budgetsR.map(b=>{
        const spent = activeMovs.filter(m=>m.categoryId===b.categoryId && m.date.startsWith(b.month) && (m.type==="expense"||m.type==="debt_payment")).reduce((s,m)=>s+m.amount,0);
        const useSpent = Math.round(spent*100)/100;
        return { id: b.id, categoryId: b.categoryId, month: b.month, amount: b.amount, visibility: b.visibility, spent: useSpent, remaining: Math.round((b.amount-useSpent)*100)/100, pct: b.amount>0? Math.round(useSpent/b.amount*100) : 0 };
      });

      const adults = profilesR.filter(p=>p.kind==="adult");
      const totalIncomeAdults = adults.reduce((s,p)=>s+p.monthlyIncome,0);
      let contributionsNote = "";
      if (baseForContributions === 0) contributionsNote = "El reparto es $0 porque en el mes en curso no existe gasto compartido ni presupuesto compartido. Registre un gasto con visibilidad Compartida o cree un presupuesto compartido.";
      else if (adults.length===0) contributionsNote = "Es necesario crear los perfiles de los adultos en la sección Perfiles para repartir el gasto compartido.";
      else if (hh.contributionRule==="proportional" && totalIncomeAdults===0) contributionsNote = "La regla vigente es Proporcional al ingreso, pero los perfiles registran un ingreso de $0. Actualice el ingreso neto mensual en la sección Perfiles para calcular el reparto.";
      else contributionsNote = hh.contributionRule==="equal" ? `Reparto en partes iguales entre ${adults.length} adulto(s), sobre $${baseForContributions.toLocaleString("es-MX")} de gasto o presupuesto compartido del mes.` : `Reparto proporcional al ingreso, sobre $${baseForContributions.toLocaleString("es-MX")} del mes.`;

      const contributions = adults.map(p=>{
        const capacity = Math.max(0, p.monthlyIncome - p.fixedCommitments);
        let share = 0; let pctShare = 0;
        if (baseForContributions>0 && adults.length>0) {
          if (hh.contributionRule==="equal") { share = baseForContributions/adults.length; pctShare = 100/adults.length; }
          else if (totalIncomeAdults>0) { pctShare = p.monthlyIncome/totalIncomeAdults*100; share = baseForContributions * (p.monthlyIncome/totalIncomeAdults); }
        }
        return { profileId: p.id, name: p.name, shouldPay: Math.round(share*100)/100, capacity: Math.round(capacity*100)/100, income: p.monthlyIncome, pctShare: Math.round(pctShare*10)/10 };
      });

      // Restante del sueldo para el renglón de efectivo del arqueo.
      const salaryInfo = salaryRemainingFor(hh.mode, adults, monthExpense);



      // ---- Monthly series (last 6 months) + movement receipt URLs ----
      const monthLabel = (ym:string)=>{ const [yy=2026,mm=1]=ym.split("-").map(Number); return new Date(yy,(mm||1)-1,1).toLocaleDateString("es-MX",{month:"short"}); };
      const monthlySeries: {month:string;label:string;income:number;expense:number}[] = [];
      for (let k=5;k>=0;k--){ const d=new Date(viewDate.getFullYear(), viewDate.getMonth()-k, 1); const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; const ms=activeMovs.filter(m=>m.date.startsWith(ym)); monthlySeries.push({ month: ym, label: monthLabel(ym), income: Math.round(ms.filter(m=>m.type==="income").reduce((s,m)=>s+m.amount,0)*100)/100, expense: Math.round(ms.filter(m=>m.type==="expense"||m.type==="debt_payment").reduce((s,m)=>s+m.amount,0)*100)/100 }); }
      const movementsOut: {id:number;type:string;amount:number;concept:string;accountId:number|null;toAccountId:number|null;categoryId:number|null;subcategory:string|null;date:string;visibility:string;profileId:number|null;receiptUrl:string|null;reversalOfId:number|null;isReversed:boolean;mine:boolean}[] = [];
      // Solo viajan las filas que el usuario puede ver (ver canSeeMovement):
      // los movimientos privados de otros integrantes no salen del servidor.
      // «mine» marca si el movimiento es del propio usuario (su perfil está
      // entre los perfiles de su cuenta): el cliente usa ese dato para no
      // esconder un movimiento propio guardado con otro perfil de la misma
      // cuenta, que los totales sí cuentan.
      for (const m of movsR.filter(canSeeMovement)) { let url: string|null = null; if (m.receiptBlobKey) { try { url = await ctx.blobs.getUrl(m.receiptBlobKey); } catch { url = null; } } movementsOut.push({ id:m.id, type:m.type, amount:m.amount, concept:m.concept, accountId:m.accountId??null, toAccountId:m.toAccountId??null, categoryId:m.categoryId??null, subcategory:m.subcategory??null, date:m.date, visibility:m.visibility, profileId:m.profileId??null, receiptUrl: url, reversalOfId: m.reversalOfId ?? null, isReversed: reversedIds.has(m.id), mine: m.profileId!=null && myProfileIds.has(m.profileId) }); }

      // ---- Personal mode ----
      const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const ownerAdult = profilesR.find(p=>p.kind==="adult");
      const incomeMovsMonth = monthMovs.filter(m=>m.type==="income").reduce((s,m)=>s+m.amount,0);
      const salary = ownerAdult && ownerAdult.monthlyIncome>0 ? ownerAdult.monthlyIncome : incomeMovsMonth;
      const personalSpentMovs = monthMovs.filter(m=>m.type==="expense"||m.type==="debt_payment");
      const monthSpentP = personalSpentMovs.reduce((s,m)=>s+m.amount,0);
      const catTotals = new Map<string,{categoryId:number|null;name:string;total:number}>();
      for (const m of personalSpentMovs) {
        const name = catsR.find(c=>c.id===m.categoryId)?.name || "Sin categoría";
        const key = String(m.categoryId ?? "none");
        const cur = catTotals.get(key) || { categoryId: m.categoryId ?? null, name, total: 0 };
        cur.total += m.amount; catTotals.set(key, cur);
      }
      const byCategory = Array.from(catTotals.values()).sort((a,b)=>b.total-a.total).map(c=>({ categoryId: c.categoryId, name: c.name, total: Math.round(c.total*100)/100, pct: monthSpentP>0? Math.round(c.total/monthSpentP*100):0 }));
      const todayMovs = activeMovs.filter(m=>m.date===todayStr && (m.type==="expense"||m.type==="debt_payment"));
      const personal = { salary: Math.round(salary*100)/100, monthSpent: Math.round(monthSpentP*100)/100, remaining: Math.round((salary-monthSpentP)*100)/100, todaySpent: Math.round(todayMovs.reduce((s,m)=>s+m.amount,0)*100)/100, todayCount: todayMovs.length, byCategory, todayMovements: todayMovs.filter(canSeeMovement).map(m=>({ id:m.id, concept:m.concept, amount:m.amount, categoryId:m.categoryId??null, date:m.date })) };

      // ---- Tandas v2: organizador con estrellas, invitados, comprobantes y cumplimiento ----
      const addDays = (iso:string, days:number) => { const [y=2026,mo=1,d=1]=iso.split("-").map(Number); const dt=new Date(y,(mo||1)-1,(d||1)+days); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; };
      const dayDiff = (a:string, b:string) => { const [ay=2026,am=1,ad=1]=a.split("-").map(Number); const [by=2026,bm=1,bd=1]=b.split("-").map(Number); return Math.round((new Date(ay,(am||1)-1,ad||1).getTime()-new Date(by,(bm||1)-1,bd||1).getTime())/86400000); };
      const dueDateOf = (tdStart:string, cadence:number, idx:number) => addDays(tdStart, idx*cadence);
      // Historial de cumplimiento por nombre en TODO el espacio (todas las tandas del mismo organizador/espacio)
      const statsForName = (name:string) => {
        const key = name.trim().toLowerCase();
        const myParts = tandaPartsR.filter(x=>x.name.trim().toLowerCase()===key);
        const myIds = new Set(myParts.map(x=>x.id));
        const myPays = tandaPaysR.filter(x=>myIds.has(x.participantId));
        let dueCount = 0; let paidCount = 0; let onTime = 0; let earlySum = 0; let earlyN = 0;
        for (const td2 of tandasR) {
          const cadence = td2.cadenceDays || 15;
          for (let i=0;i<td2.participantCount;i++) { if (dueDateOf(td2.startDate, cadence, i) <= todayStr) dueCount += myParts.filter(x=>x.tandaId===td2.id).length; }
        }
        for (const pay of myPays) {
          if (pay.status !== "paid") continue;
          paidCount++;
          const td2 = tandasR.find(x=>x.id===pay.tandaId); if (!td2 || !pay.paidDate) continue;
          const due = dueDateOf(td2.startDate, td2.cadenceDays || 15, pay.quincenaIndex);
          const diff = dayDiff(due, pay.paidDate); // >0 pagó con anticipación; 0, el día del vencimiento
          if (diff >= 0) onTime++;
          earlySum += diff; earlyN++;
        }
        const joinedDates = myParts.map(x=>x.joinedDate).filter((d): d is string => !!d).sort();
        const seniorityDays = joinedDates[0] ? Math.max(0, dayDiff(todayStr, joinedDates[0])) : 0;
        const onTimePct = paidCount>0 ? Math.round(onTime/paidCount*100) : 100;
        const avgDaysEarly = earlyN>0 ? Math.round((earlySum/earlyN)*10)/10 : 0;
        // Racha: rondas vencidas consecutivas pagadas a tiempo, desde la más reciente hacia atrás.
        let streak = 0;
        {
          const rounds: { due: string; onTime: boolean }[] = [];
          for (const td2 of tandasR) {
            const cadence = td2.cadenceDays || 15;
            for (let i=0;i<td2.participantCount;i++) {
              const due = dueDateOf(td2.startDate, cadence, i);
              if (due > todayStr) continue;
              const pay = myPays.find(x=>x.tandaId===td2.id && x.quincenaIndex===i);
              rounds.push({ due, onTime: !!pay && pay.status==="paid" && !!pay.paidDate && dayDiff(due, pay.paidDate) >= 0 });
            }
          }
          rounds.sort((a,b)=> b.due.localeCompare(a.due));
          for (const r of rounds) { if (!r.onTime) break; streak++; }
        }
        const base = dueCount===0 ? 70 : (paidCount/Math.max(1,dueCount))*70;
        const onTimeComp = paidCount>0 ? (onTime/paidCount)*20 : 10;
        const seniorityComp = Math.min(10, seniorityDays/3);
        const score = Math.max(5, Math.min(100, Math.round(base + onTimeComp + seniorityComp)));
        return { paidCount, dueCount, onTimePct, avgDaysEarly, seniorityDays, score, streak };
      };
      const tandas = await Promise.all(tandasR.map(async td=>{
        const parts = tandaPartsR.filter(x=>x.tandaId===td.id);
        const ordered = [...parts].sort((a,b)=>(a.drawOrder??999)-(b.drawOrder??999));
        const cadence = td.cadenceDays || 15;
        const calendar = Array.from({length: td.participantCount}, (_,i)=>{
          const recv = ordered.find(x=>x.drawOrder===i+1) || null;
          return { index: i, date: addDays(td.startDate, i*cadence), receiverName: recv? recv.name : null, receiverId: recv? recv.id : null, amount: Math.round(td.amountPerQuincena*td.participantCount*100)/100 };
        });
        const orgName = td.organizerName || profilesR.find(p=>p.id===td.organizerProfileId)?.name || profilesR.find(p=>p.role==="admin")?.name || null;
        const orgKey = (orgName||"").trim().toLowerCase();
        const orgTandaIds = new Set(tandasR.filter(x=>((x.organizerName || profilesR.find(p=>p.id===x.organizerProfileId)?.name || profilesR.find(p=>p.role==="admin")?.name || "").trim().toLowerCase())===orgKey).map(x=>x.id));
        const ratingsAll = orgRatingsR.filter(r=>orgTandaIds.has(r.tandaId));
        const organizerRating = { avg: ratingsAll.length? Math.round(ratingsAll.reduce((s,r)=>s+r.stars,0)/ratingsAll.length*10)/10 : 0, count: ratingsAll.length };
        const paysOut: {participantId:number;quincenaIndex:number;status:string;reminderSent:number;paidDate:string|null;proofUrl:string|null;verified:number;fineAmount:number}[] = [];
        for (const x of tandaPaysR.filter(x=>x.tandaId===td.id)) { let url: string|null = null; if (x.proofBlobKey) { try { url = await ctx.blobs.getUrl(x.proofBlobKey); } catch { url = null; } } paysOut.push({ participantId: x.participantId, quincenaIndex: x.quincenaIndex, status: x.status, reminderSent: x.reminderSent, paidDate: x.paidDate ?? null, proofUrl: url, verified: x.verified ?? 0, fineAmount: x.fineAmount ?? 0 }); }
        // ---- Tandas v3: roles, saldos separados, multas, votos, entregas y pase de lista ----
        const treasurerName = profilesR.find(p=>p.id===(td as unknown as { treasurerProfileId?: number | null }).treasurerProfileId)?.name ?? null;
        const substituteName = profilesR.find(p=>p.id===(td as unknown as { substituteProfileId?: number | null }).substituteProfileId)?.name ?? null;
        const finesOut = tandaFinesR.filter(x=>x.tandaId===td.id).map(x=>({ id: x.id, participantId: x.participantId, quincenaIndex: x.quincenaIndex, amount: x.amount, reason: x.reason, status: x.status }));
        const votesOut = tandaVotesR.filter(x=>x.tandaId===td.id).map(x=>({ id: x.id, targetParticipantId: x.targetParticipantId, voterName: x.voterName, vote: x.vote, reason: x.reason ?? null }));
        const deliveriesOut = tandaDeliveriesR.filter(x=>x.tandaId===td.id).map(x=>({ quincenaIndex: x.quincenaIndex, receiverId: x.receiverId ?? null, organizerConfirmed: x.organizerConfirmed ?? 0, receiverConfirmed: x.receiverConfirmed ?? 0 }));
        const fundEntriesOut = tandaFundEntriesR.filter(x=>x.tandaId===td.id).map(x=>({ id: x.id, participantId: x.participantId ?? null, kind: x.kind, amount: x.amount, note: x.note ?? null }));
        const paidCountT = paysOut.filter(x=>x.status==="paid").length;
        const balances = {
          aportacion: Math.round(paidCountT * td.amountPerQuincena * 100) / 100,
          fondo: Math.round(fundEntriesOut.filter(x=>x.kind==="fondo").reduce((s,x)=>s+x.amount,0)*100)/100,
          multasPendientes: Math.round(finesOut.filter(x=>x.status==="pendiente").reduce((s,x)=>s+x.amount,0)*100)/100,
          multasCobradas: Math.round(fundEntriesOut.filter(x=>x.kind==="multa").reduce((s,x)=>s+x.amount,0)*100)/100,
        };
        const elapsedDays = Math.max(0, dayDiff(todayStr, td.startDate));
        const attIndex = Math.min(td.participantCount - 1, Math.floor(elapsedDays / cadence));
        const attCal = calendar[attIndex] || { index: 0, date: td.startDate, receiverName: null, receiverId: null, amount: Math.round(td.amountPerQuincena*td.participantCount*100)/100 };
        const attendance = {
          index: attIndex, date: attCal.date, receiverName: attCal.receiverName, receiverId: attCal.receiverId, amount: attCal.amount,
          items: parts.map(pt=>{
            const pay = paysOut.find(x=>x.participantId===pt.id && x.quincenaIndex===attIndex);
            let status = pay?.status || "pending";
            if (status === "pending" && attCal.date < todayStr) status = "late";
            return { participantId: pt.id, name: pt.name, status, paidDate: pay?.paidDate ?? null, proofUrl: pay?.proofUrl ?? null, verified: pay?.verified ?? 0, fineAmount: pay?.fineAmount ?? 0 };
          }),
        };
        return { id: td.id, name: td.name, participantCount: td.participantCount, amountPerQuincena: td.amountPerQuincena, startDate: td.startDate, potPerQuincena: Math.round(td.amountPerQuincena*td.participantCount*100)/100, organizerName: orgName, organizerProfileId: td.organizerProfileId ?? null, frequency: td.frequency || "quincenal", cadenceDays: cadence, drawMode: td.drawMode || "random", coverageRule: (td as unknown as { coverageRule?: string }).coverageRule || "fondo", fineAmount: (td as unknown as { fineAmount?: number }).fineAmount ?? 0, meetingDay: (td as unknown as { meetingDay?: string }).meetingDay || "", treasurerProfileId: (td as unknown as { treasurerProfileId?: number | null }).treasurerProfileId ?? null, treasurerName, substituteProfileId: (td as unknown as { substituteProfileId?: number | null }).substituteProfileId ?? null, substituteName, turnsLocked: (td as unknown as { turnsLocked?: number }).turnsLocked ?? 0, organizerRating, ratings: orgRatingsR.filter(r=>r.tandaId===td.id).map(r=>({ id: r.id, raterName: r.raterName, stars: r.stars, comment: r.comment ?? null })), invitations: tandaInvsR.filter(i=>i.tandaId===td.id).map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, status: i.status })), participants: parts.map(x=>({ id: x.id, name: x.name, email: x.email ?? null, drawOrder: x.drawOrder ?? null, cardLast4: x.cardLast4 ?? null, joinedDate: x.joinedDate ?? null, role: (x as unknown as { role?: string }).role || "participante", excluded: (x as unknown as { excluded?: number }).excluded ?? 0, stats: statsForName(x.name) })), calendar, payments: paysOut, fines: finesOut, votes: votesOut, deliveries: deliveriesOut, fundEntries: fundEntriesOut, balances, attendance };
      }));

      // ---- Plan de ahorro por meta: avance y ritmo, calculados del fondo ligado ----
      // Los avisos del plan se revisan en cada carga; si toca avisar, el aviso
      // se crea aquí (con su control de duplicados). Después se releen los
      // planes, porque la revisión pudo cambiar su estado (cumplido/en riesgo).
      await checkGoalPlanAlerts(ctx, hid);
      const goalPlansFresh = await safeRows(() => db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, hid)));
      const curYm = ymOf(now);
      const curDay = now.getDate();
      const goalPlansOut = goalPlansFresh.map(plan => {
        const goal = goalsR.find(g => g.id === plan.goalId);
        const fms = fundMovsR.filter(f => f.fundId === plan.fundId);
        const fundBalance = Math.round(fms.reduce((s, f) => s + (f.type === "contribution" ? f.amount : -f.amount), 0) * 100) / 100;
        const contributedThisMonth = Math.round(fms.filter(f => f.date.startsWith(curYm)).reduce((s, f) => s + (f.type === "contribution" ? f.amount : -f.amount), 0) * 100) / 100;
        const monthsElapsed = Math.max(0, monthDiff(plan.startMonth, curYm));
        const dueThisMonth = curDay >= plan.dueDay ? 1 : 0;
        const expectedByNow = Math.round(plan.monthlyAmount * (monthsElapsed + dueThisMonth) * 100) / 100;
        const saved = goal?.savedAmount ?? fundBalance;
        const onTrack = saved >= expectedByNow;
        const remaining = Math.max(0, (goal?.targetAmount ?? 0) - saved);
        const monthsSinceStart = Math.max(1, monthsElapsed + 1);
        const pace = saved / monthsSinceStart;
        const monthsLeft = remaining <= 0 ? 0 : pace > 0 ? Math.ceil(remaining / pace) : plan.months;
        const projectedDate = remaining <= 0 ? curYm : ymAdd(curYm, monthsLeft);
        const atRisk = !!goal?.targetDate && remaining > 0 && pace > 0 && projectedDate > goal.targetDate.slice(0, 7);
        return { goalId: plan.goalId, monthlyAmount: plan.monthlyAmount, months: plan.months, startMonth: plan.startMonth, dueDay: plan.dueDay, fundId: plan.fundId ?? null, status: plan.status, fundBalance, contributedThisMonth, expectedByNow, onTrack, monthsLeft, projectedDate, atRisk };
      });

      // ---- Ajustes de gastos propuestos (pendientes y los resueltos del mes): se muestran en Metas. Si la tabla aún no existe, la lista sale vacía.
      const adjustmentsFresh = await safeRows(() => db.select().from(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.householdId, hid)).orderBy(desc(schema.spendingAdjustments.id)).limit(20));
      const spendingAdjustmentsOut = adjustmentsFresh.map(a => {
        const cuts = parseAdjustmentCuts(a.cuts);
        return { id: a.id, goalId: a.goalId, goalName: goalsR.find(g => g.id === a.goalId)?.name ?? "", month: a.month, kind: a.kind, status: a.status, overCategoryName: a.overCategoryName, overAmount: a.overAmount, cuts: cuts.map(c => ({ budgetId: c.budgetId ?? null, categoryId: c.categoryId ?? null, name: c.name, amount: c.amount, newBudget: c.newBudget ?? null })), newMonthlyAmount: a.newMonthlyAmount ?? null, newMonths: a.newMonths ?? null, extendedMonths: a.extendedMonths, coversAll: a.coversAll === 1, note: a.note, createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(Number(a.createdAt)).toISOString() };
      });

      const totalAssets = patrR.filter(x=>x.kind==="asset").reduce((s,x)=>s+x.value,0);
      const totalLiabilities = patrR.filter(x=>x.kind==="liability").reduce((s,x)=>s+x.value,0);
      const activityR = await db.select().from(schema.activityLog).where(eq(schema.activityLog.householdId, hid)).orderBy(desc(schema.activityLog.id)).limit(30);

      return {
        household: { id: hh.id, name: hh.name, currency: hh.currency, cutoffDay: hh.cutoffDay, contributionRule: hh.contributionRule, approvalRule: hh.approvalRule, approvalThreshold: hh.approvalThreshold, mode: hh.mode },
        profiles: profilesR.map(p=>({ id: p.id, name: p.name, lastName: p.lastName ?? null, role: p.role, email: p.email ?? null, kind: p.kind, dependentType: p.dependentType ?? null, monthlyIncome: p.monthlyIncome, fixedCommitments: p.fixedCommitments, capacity: Math.max(0, p.monthlyIncome - p.fixedCommitments) })),
        accounts,
        categories: catsR.map(c=>{ let subs: string[]=[]; try{ subs=JSON.parse(c.subcategories) as string[] }catch{ subs=[] } return { id:c.id, name:c.name, kind:c.kind, isSystem:c.isSystem, isActive:c.isActive, subcategories: subs }; }),
        movements: movementsOut,
        budgets,
        funds,
        fundMovements: fundMovsR.map(f=>({ id:f.id, fundId:f.fundId, type:f.type, amount:f.amount, date:f.date, note:f.note??null })),
        goals: goalsR.map(g=>({ id:g.id, name:g.name, targetAmount:g.targetAmount, savedAmount:g.savedAmount, targetDate:g.targetDate??null, visibility:g.visibility, pct: g.targetAmount>0? Math.min(100, Math.round(g.savedAmount/g.targetAmount*100)):0 })),
        goalPlans: goalPlansOut,
        spendingAdjustments: spendingAdjustmentsOut,
        agreements: agR.map(a=>({ id:a.id, title:a.title, description:a.description, status:a.status, votes: votesR.filter(v=>v.agreementId===a.id).map(v=>({ profileId:v.profileId, vote:v.vote })) })),
        personal, tandas, invitations: invsR.map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, status: i.status, householdName: hh.name })),
        patrimony: patrR.map(p=>({ id:p.id, name:p.name, kind:p.kind, category:p.category, value:p.value, owner:p.owner??null })),
        activity: activityR.map(a=>({ id: a.id, action: a.action, detail: a.detail, createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(Number(a.createdAt)).toISOString() })),
        summary: {
          totalBalance: Math.round(totalBalance*100)/100, totalInFunds: Math.round(totalInFunds*100)/100, availableFree: Math.round(availableFree*100)/100, openingBalance: Math.round(openingBalance*100)/100, priorMonthsNet: Math.round(priorMonthsNet*100)/100, fundsFromAccounts: Math.round(fundsFromAccounts*100)/100, fundsReserved: Math.round(fundsReserved*100)/100,
          monthIncome: Math.round(monthIncome*100)/100, monthExpense: Math.round(monthExpense*100)/100, monthNet: Math.round((monthIncome-monthExpense)*100)/100,
          sharedExpenseMonth: Math.round(baseForContributions*100)/100, unassignedNet, totalAssets, totalLiabilities, netWorth: totalAssets-totalLiabilities, currentMonth,
          salaryIncome: salaryInfo.salaryIncome, salarySpent: salaryInfo.salarySpent, salaryRemaining: salaryInfo.salaryRemaining, hasSalaryIncome: salaryInfo.hasSalaryIncome,
          contributions, contributionsNote, monthlySeries,
        },
      };
    },
  }),

  createHousehold: defineAction({
    description: "Creates the household and seeds default categories.",
    request: z.object({ mode: z.enum(["personal","familiar"]).default("familiar"), name: z.string().min(1).max(120), currency: z.string().default("MXN"), cutoffDay: z.number().int().min(1).max(28).default(1), contributionRule: z.enum(["equal","proportional"]).default("equal"), approvalRule: z.enum(["unanimous","majority"]).default("unanimous"), approvalThreshold: z.number().min(0).max(100_000_000).default(1500), ownerName: z.string().min(1).max(80), ownerLastName: z.string().max(80).default(""), ownerIncome: z.number().min(0).max(100_000_000).default(0) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      if (ctx.householdId != null) throw new Error("Ya pertenece a un hogar. Para crear otro hogar, primero debe salir del actual.");
      const [hh] = await db.insert(schema.households).values({ ownerUserId: ctx.user.id, name: args.name, currency: args.currency, cutoffDay: args.cutoffDay, contributionRule: args.contributionRule, approvalRule: args.approvalRule, approvalThreshold: args.approvalThreshold, mode: args.mode }).returning({ id: schema.households.id });
      if (!hh) throw new Error("No se pudo crear el hogar");
      const [owner] = await db.insert(schema.profiles).values({ householdId: hh.id, userId: ctx.user.id, name: args.ownerName, lastName: args.ownerLastName || null, role: "admin", kind: "adult", monthlyIncome: args.ownerIncome, fixedCommitments: 0 }).returning({ id: schema.profiles.id });
      await db.insert(schema.householdMembers).values({ householdId: hh.id, userId: ctx.user.id, profileId: owner?.id ?? null, role: "admin" });
      await logActivity(ctx, hh.id, "Hogar creado", `${args.name} · modo ${args.mode}`);
      const cats: { householdId:number; name:string; kind:"income"|"expense"; isSystem:number; isActive:number; subcategories:string }[] = [];
      for (const [name, subs] of INCOME_CATS) cats.push({ householdId: hh.id, name, kind: "income", isSystem: 1, isActive: 1, subcategories: JSON.stringify(subs) });
      for (const [name, subs] of EXPENSE_CATS) cats.push({ householdId: hh.id, name, kind: "expense", isSystem: 1, isActive: 1, subcategories: JSON.stringify(subs) });
      for (const c of cats) await db.insert(schema.categories).values(c);
      ctx.invalidateQueries();
      return { ok: true, id: hh.id };
    },
  }),

  updateHousehold: defineAction({
    description: "Updates household rules and settings.",
    request: z.object({ id: z.number(), name: z.string().min(1), currency: z.string(), cutoffDay: z.number().int().min(1).max(28), contributionRule: z.enum(["equal","proportional"]), approvalRule: z.enum(["unanimous","majority"]), approvalThreshold: z.number().min(0), mode: z.enum(["personal","familiar"]).default("familiar") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      await db.update(schema.households).set({ name: args.name, currency: args.currency, cutoffDay: args.cutoffDay, contributionRule: args.contributionRule, approvalRule: args.approvalRule, approvalThreshold: args.approvalThreshold, mode: args.mode }).where(eq(schema.households.id, args.id));
      ctx.invalidateQueries(); return { ok: true, id: args.id };
    },
  }),

  saveProfile: defineAction({
    description: "Creates or updates a profile (adult or dependent).",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), lastName: z.string().optional(), role: z.enum(["admin","member"]).optional(), email: z.string().optional(), kind: z.enum(["adult","dependent"]), dependentType: z.string().optional(), monthlyIncome: z.number().min(0).default(0), fixedCommitments: z.number().min(0).default(0) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db; if (args.role === "admin" && ctx.userRole !== "admin") throw new Error("Solo el administrador del hogar puede asignar el rol de administrador.");
      if (args.id) { await db.update(schema.profiles).set({ name: args.name, lastName: args.lastName||null, ...(args.role?{role:args.role}:{}) , email: args.email||null, kind: args.kind, dependentType: args.dependentType||null, monthlyIncome: args.monthlyIncome, fixedCommitments: args.fixedCommitments }).where(eq(schema.profiles.id, args.id)); ctx.invalidateQueries(); return { ok: true, id: args.id }; }
      const [r] = await db.insert(schema.profiles).values({ householdId: args.householdId, name: args.name, lastName: args.lastName||null, role: args.role||"member", email: args.email||null, kind: args.kind, dependentType: args.dependentType||null, monthlyIncome: args.monthlyIncome, fixedCommitments: args.fixedCommitments }).returning({ id: schema.profiles.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  deleteProfile: defineAction({ description: "Deletes a profile.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.profiles).where(eq(schema.profiles.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  saveAccount: defineAction({
    description: "Creates or updates an account.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), type: z.enum(["bank","cash","credit","investment","loan"]), visibility: vis, initialBalance: z.number(), ownerProfileId: z.number().nullable().optional() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; if(args.id){ await db.update(schema.accounts).set({name:args.name,type:args.type,visibility:args.visibility,initialBalance:args.initialBalance,ownerProfileId:args.ownerProfileId??null}).where(eq(schema.accounts.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.accounts).values({householdId:args.householdId,name:args.name,type:args.type,visibility:args.visibility,initialBalance:args.initialBalance,ownerProfileId:args.ownerProfileId??null}).returning({id:schema.accounts.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteAccount: defineAction({ description: "Deletes an account.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.accounts).where(eq(schema.accounts.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  saveCategory: defineAction({
    description: "Creates or updates a category with subcategories.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), kind: z.enum(["income","expense"]), subcategories: z.array(z.string()).default([]), isActive: z.number().default(1) }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const subs=JSON.stringify(args.subcategories); if(args.id){ await db.update(schema.categories).set({name:args.name,kind:args.kind,subcategories:subs,isActive:args.isActive}).where(eq(schema.categories.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.categories).values({householdId:args.householdId,name:args.name,kind:args.kind,subcategories:subs,isSystem:0,isActive:1}).returning({id:schema.categories.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),

  addSubcategory: defineAction({
    description: "Adds a new subcategory to an existing category (from the movement form or the Categories tab). If it already exists, it is reused without duplicating.",
    request: z.object({ categoryId: z.number(), name: z.string().min(1).max(60) }),
    response: z.object({ ok: z.literal(true), subcategories: z.array(z.string()), added: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; subcategories: string[]; added: boolean }> {
      const db = ctx.db;
      const rows = await db.select().from(schema.categories).where(eq(schema.categories.id, args.categoryId));
      const cat = rows[0]; if (!cat) throw new Error("Categoría no encontrada.");
      let subs: string[] = []; try { subs = JSON.parse(cat.subcategories) as string[]; } catch { subs = []; }
      const name = args.name.trim();
      const exists = subs.some(s=>s.toLowerCase()===name.toLowerCase());
      if (!exists) { subs.push(name); await db.update(schema.categories).set({ subcategories: JSON.stringify(subs) }).where(eq(schema.categories.id, args.categoryId)); }
      ctx.invalidateQueries(); return { ok: true, subcategories: subs, added: !exists };
    },
  }),
  removeSubcategory: defineAction({
    description: "Removes a subcategory from a category. Movements already recorded keep their subcategory text.",
    request: z.object({ categoryId: z.number(), name: z.string().min(1) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const rows = await db.select().from(schema.categories).where(eq(schema.categories.id, args.categoryId));
      const cat = rows[0]; if (!cat) throw new Error("Categoría no encontrada.");
      let subs: string[] = []; try { subs = JSON.parse(cat.subcategories) as string[]; } catch { subs = []; }
      subs = subs.filter(s=>s.toLowerCase()!==args.name.trim().toLowerCase());
      await db.update(schema.categories).set({ subcategories: JSON.stringify(subs) }).where(eq(schema.categories.id, args.categoryId));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  scanReceipt: defineAction({
    description: "Reads a purchase receipt photo with AI (store, date, itemized products with amounts, and total) and creates one expense movement per product automatically, attaching the photo as proof to each. Nothing is typed manually by the user.",
    request: z.object({ householdId: z.number(), image: z.object({ dataBase64: z.string(), mimeType: z.string() }), categoryId: z.number().nullable().optional(), visibility: vis.default("shared"), profileId: z.number().nullable().optional(), accountId: z.number().nullable().optional() }),
    response: z.object({ ok: z.literal(true), created: z.number(), store: z.string().nullable(), totalDetected: z.number(), items: z.array(z.object({ name: z.string(), amount: z.number() })) }),
    async handler(ctx, args): Promise<{ ok: true; created: number; store: string | null; totalDetected: number; items: { name: string; amount: number }[] }> {
      await rateLimit("scanReceipt", 10, 60_000);
      if (args.image.dataBase64.length > 12_000_000) throw new Error("La fotografía es demasiado grande para la lectura automática (máximo aproximado de 9 MB).");
      if (args.image.mimeType !== "image/jpeg" && args.image.mimeType !== "image/png") throw new Error("Para la lectura automática, la fotografía debe enviarse en formato JPG o PNG.");
      const receiptSchema = z.object({
        store: z.string().nullable(),
        date: z.string().nullable(),
        items: z.array(z.object({ name: z.string(), amount: z.number() })),
        total: z.number(),
        suggestedCategory: z.string().nullable(),
      });
      const read = await ctx.inference.complete("Lea el comprobante de compra de la imagen y extraiga con precisión: el nombre de la tienda o comercio, la fecha de la compra tal como aparece impresa (si no es legible, deje el campo vacío), cada producto comprado con su importe individual, el importe total del comprobante y la categoría de gasto que mejor describe la compra (por ejemplo: Alimentación, Transporte, Salud, Servicios, Entretenimiento). No invente productos ni importes que no aparezcan en la imagen.", {
        schema: receiptSchema,
        images: [{ dataBase64: args.image.dataBase64, mimeType: args.image.mimeType, caption: "Fotografía del comprobante de compra" }],
      });
      const db = ctx.db;
      const key = `receipts/${args.householdId}/${Date.now()}-${Math.floor(Math.random()*1e9)}`;
      await ctx.blobs.put(key, Buffer.from(args.image.dataBase64, "base64"), { contentType: args.image.mimeType });
      const nowD = new Date(); const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
      const dateOk = read.date && /^\d{4}-\d{2}-\d{2}$/.test(read.date) ? read.date : todayStr;
      let categoryId = args.categoryId ?? null;
      if (!categoryId && read.suggestedCategory) {
        const cats = await db.select().from(schema.categories).where(eq(schema.categories.householdId, args.householdId));
        const sug = read.suggestedCategory.toLowerCase();
        const match = cats.find(c=>c.kind==="expense" && (c.name.toLowerCase()===sug || sug.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(sug)));
        categoryId = match?.id ?? null;
      }
      const items = read.items.filter(i=>i.name.trim() && i.amount>0);
      const finalItems = items.length>0 ? items : (read.total>0 ? [{ name: read.store || "Compra registrada desde el comprobante", amount: read.total }] : []);
      if (finalItems.length===0) throw new Error("No se pudo leer ningún producto ni el total del comprobante. Verifique que la fotografía sea nítida e inténtelo de nuevo.");
      const store = (read.store || "").trim();
      let totalCreated = 0;
      for (const it of finalItems) {
        const concept = store ? `${store} — ${it.name.trim()}` : it.name.trim();
        const [created] = await db.insert(schema.movements).values({ householdId: args.householdId, type: "expense", amount: Math.round(it.amount*100)/100, concept, accountId: args.accountId ?? null, toAccountId: null, categoryId, subcategory: null, date: dateOk, visibility: args.visibility, profileId: args.profileId ?? null, receiptBlobKey: key }).returning({ id: schema.movements.id });
        if (created?.id) await checkMovementAlerts(ctx, { householdId: args.householdId, movementId: created.id, type: "expense", amount: Math.round(it.amount*100)/100, categoryId, visibility: args.visibility, date: dateOk });
        totalCreated += it.amount;
      }
      await logActivity(ctx, args.householdId, "Comprobante leído automáticamente", `Se crearon ${finalItems.length} gasto(s)${store?` de ${store}`:""} por un total de $${Math.round(totalCreated*100)/100}.`);
      ctx.invalidateQueries();
      return { ok: true, created: finalItems.length, store: store || null, totalDetected: Math.round(totalCreated*100)/100, items: finalItems.map(i=>({ name: i.name.trim(), amount: Math.round(i.amount*100)/100 })) };
    },
  }),

  saveMovement: defineAction({
    description: "Creates or updates a movement (income, expense, transfer, debt payment).",
    request: z.object({ id: z.number().optional(), householdId: z.number(), type: z.enum(["income","expense","transfer","debt_payment"]), amount: z.number().positive().max(100_000_000), concept: z.string().min(1).max(200), accountId: z.number().nullable().optional(), toAccountId: z.number().nullable().optional(), categoryId: z.number().nullable().optional(), subcategory: z.string().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), visibility: vis, profileId: z.number().nullable().optional(), receipt: z.object({ dataBase64: z.string().max(16_000_000), mimeType: z.string() }).optional() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; let receiptBlobKey: string|null|undefined = undefined;
      if (args.receipt) { const okTypes=["image/jpeg","image/png","image/webp"]; if (!okTypes.includes(args.receipt.mimeType)) throw new Error("La foto del comprobante debe estar en formato JPG, PNG o WebP."); const key=`receipts/${args.householdId}/${Date.now()}-${Math.floor(Math.random()*1e9)}`; const bytes=Buffer.from(args.receipt.dataBase64,"base64"); await ctx.blobs.put(key, bytes, { contentType: args.receipt.mimeType }); receiptBlobKey=key; }
      // Permisos por hogar: toda referencia (cuenta, categoría, perfil) debe pertenecer al mismo
      // hogar del movimiento; una referencia de otro hogar se rechaza en el servidor.
      if (args.accountId) { const r = await db.select().from(schema.accounts).where(eq(schema.accounts.id, args.accountId)); if (!r[0] || r[0].householdId !== args.householdId) throw new Error("La cuenta indicada no pertenece a este hogar."); }
      if (args.toAccountId) { const r = await db.select().from(schema.accounts).where(eq(schema.accounts.id, args.toAccountId)); if (!r[0] || r[0].householdId !== args.householdId) throw new Error("La cuenta destino no pertenece a este hogar."); }
      if (args.categoryId) { const r = await db.select().from(schema.categories).where(eq(schema.categories.id, args.categoryId)); if (!r[0] || r[0].householdId !== args.householdId) throw new Error("La categoría indicada no pertenece a este hogar."); }
      if (args.profileId) { const r = await db.select().from(schema.profiles).where(eq(schema.profiles.id, args.profileId)); if (!r[0] || r[0].householdId !== args.householdId) throw new Error("El perfil indicado no pertenece a este hogar."); }
      if (args.id) { const r = await db.select().from(schema.movements).where(eq(schema.movements.id, args.id)); if (!r[0] || r[0].householdId !== args.householdId) throw new Error("El movimiento indicado no pertenece a este hogar."); if (r[0].reversalOfId != null) throw new Error("Una reversión no puede editarse; forma parte del registro de auditoría."); }
      const vals={householdId:args.householdId,type:args.type,amount:args.amount,concept:args.concept,accountId:args.accountId??null,toAccountId:args.toAccountId??null,categoryId:args.categoryId??null,subcategory:args.subcategory||null,date:args.date,visibility:args.visibility,profileId:args.profileId??null, ...(receiptBlobKey!==undefined?{receiptBlobKey}:{})}; if(args.id){ await db.update(schema.movements).set(vals).where(eq(schema.movements.id,args.id)); await logActivity(ctx, args.householdId, "Movimiento editado", `${args.concept} · $${args.amount}`); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.movements).values(vals).returning({id:schema.movements.id}); await logActivity(ctx, args.householdId, "Movimiento registrado", `${args.concept} · $${args.amount}`); if(r?.id) await checkMovementAlerts(ctx, { householdId: args.householdId, movementId: r.id, type: args.type, amount: args.amount, categoryId: args.categoryId ?? null, visibility: args.visibility, date: args.date }); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteMovement: defineAction({ description: "Deletes a movement.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const rows=await db.select().from(schema.movements).where(eq(schema.movements.id,args.id)); const row=rows[0]; if(row && row.reversalOfId!=null) throw new Error("Una reversión no puede eliminarse por separado; forma parte del registro de auditoría. Si elimina el movimiento original, su reversión se elimina junto con él."); await db.delete(schema.movements).where(eq(schema.movements.reversalOfId,args.id)); await db.delete(schema.movements).where(eq(schema.movements.id,args.id)); if(row) await logActivity(ctx, row.householdId, "Movimiento eliminado", `${row.concept} · $${row.amount}`); ctx.invalidateQueries(); return {ok:true}; } }),

  reverseMovement: defineAction({
    description: "Reverses a movement (income, expense, transfer or debt payment) by creating a linked counter-movement of the opposite effect on today's date. The original and its reversal both remain visible, marked, and neither counts toward balances, totals, budgets or charts. A movement can be reversed only once, and a reversal cannot itself be reversed.",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.literal(true), id: z.number().optional(), reversalId: z.number().optional() }),
    async handler(ctx, args): Promise<{ ok: true; id?: number; reversalId?: number }> {
      await rateLimit("reverseMovement", 60, 60_000);
      const db = ctx.db;
      const rows = await db.select().from(schema.movements).where(eq(schema.movements.id, args.id));
      const orig = rows[0];
      if (!orig) throw new Error("Movimiento no encontrado.");
      if (orig.reversalOfId != null) throw new Error("Este movimiento es la reversión de otro registro y no puede reversarse a su vez.");
      const existing = await db.select().from(schema.movements).where(eq(schema.movements.reversalOfId, args.id));
      if (existing[0]) throw new Error("Este movimiento ya fue reversado; la reversión quedó registrada y no es posible reversarlo dos veces.");
      const nowD = new Date(); const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
      // Efecto contrario según el tipo: ingreso↔gasto; un pago de deuda se compensa con un ingreso
      // a la misma cuenta; una transferencia se compensa con otra en sentido inverso.
      let revType: "income"|"expense"|"transfer" = "expense";
      let revAccountId = orig.accountId ?? null; let revToAccountId: number|null = null;
      if (orig.type === "income") revType = "expense";
      else if (orig.type === "expense") revType = "income";
      else if (orig.type === "debt_payment") revType = "income";
      else if (orig.type === "transfer") { revType = "transfer"; revAccountId = orig.toAccountId ?? null; revToAccountId = orig.accountId ?? null; }
      const [r] = await db.insert(schema.movements).values({ householdId: orig.householdId, type: revType, amount: orig.amount, concept: `Reversión de: ${orig.concept}`, accountId: revAccountId, toAccountId: revToAccountId, categoryId: orig.categoryId ?? null, subcategory: orig.subcategory ?? null, date: todayStr, visibility: orig.visibility, profileId: orig.profileId ?? null, receiptBlobKey: null, reversalOfId: orig.id }).returning({ id: schema.movements.id });
      await logActivity(ctx, orig.householdId, "Movimiento reversado", `${orig.concept} · $${orig.amount}`);
      ctx.invalidateQueries();
      return { ok: true, id: orig.id, reversalId: r?.id };
    },
  }),

  saveBudget: defineAction({
    description: "Creates or updates a monthly budget.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), categoryId: z.number(), month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number().min(0), visibility: vis }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; if(args.id){ await db.update(schema.budgets).set({categoryId:args.categoryId,month:args.month,amount:args.amount,visibility:args.visibility}).where(eq(schema.budgets.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } // Un solo presupuesto por categoría y mes: si ya existe, se actualiza
    // su monto en lugar de crear una segunda tarjeta con el mismo gasto.
    const existing = await db.select().from(schema.budgets).where(and(eq(schema.budgets.householdId,args.householdId),eq(schema.budgets.categoryId,args.categoryId),eq(schema.budgets.month,args.month))).limit(1); if(existing[0]){ await db.update(schema.budgets).set({amount:args.amount,visibility:args.visibility}).where(eq(schema.budgets.id,existing[0].id)); ctx.invalidateQueries(); return {ok:true,id:existing[0].id}; } const [r]=await db.insert(schema.budgets).values({householdId:args.householdId,categoryId:args.categoryId,month:args.month,amount:args.amount,visibility:args.visibility}).returning({id:schema.budgets.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteBudget: defineAction({ description: "Deletes a budget.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.budgets).where(eq(schema.budgets.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  saveFund: defineAction({
    description: "Creates a fund (virtual envelope).",
    request: z.object({ householdId: z.number(), name: z.string().min(1), targetAmount: z.number().nullable().optional(), visibility: vis }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const [r]=await db.insert(schema.funds).values({householdId:args.householdId,name:args.name,targetAmount:args.targetAmount??null,visibility:args.visibility}).returning({id:schema.funds.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteFund: defineAction({ description: "Deletes a fund.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.fundMovements).where(eq(schema.fundMovements.fundId,args.id)); await db.delete(schema.funds).where(eq(schema.funds.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),
  addFundMovement: defineAction({
    description: "Adds a contribution or withdrawal to a fund. Not an income/expense.",
    request: z.object({ householdId: z.number(), fundId: z.number(), type: z.enum(["contribution","withdrawal"]), amount: z.number().positive(), date: z.string(), note: z.string().optional(), accountId: z.number().nullable().optional() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const [r]=await db.insert(schema.fundMovements).values({householdId:args.householdId,fundId:args.fundId,type:args.type,amount:args.amount,date:args.date,note:args.note||null,accountId:args.accountId??null} as never).returning({id:schema.fundMovements.id});
    // Si el fondo es de un plan de ahorro, el avance de la meta es el saldo del fondo.
    await syncGoalSavedFromFund(ctx, args.householdId, args.fundId);
    await checkGoalPlanAlerts(ctx, args.householdId);
    ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),

  saveGoal: defineAction({
    description: "Creates or updates a savings goal.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), targetAmount: z.number().positive(), savedAmount: z.number().min(0).default(0), targetDate: z.string().optional(), visibility: vis }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const vals={householdId:args.householdId,name:args.name,targetAmount:args.targetAmount,savedAmount:args.savedAmount,targetDate:args.targetDate||null,visibility:args.visibility}; if(args.id){ await db.update(schema.goals).set(vals).where(eq(schema.goals.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.goals).values(vals).returning({id:schema.goals.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteGoal: defineAction({ description: "Deletes a goal.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; try { await db.delete(schema.goalPlans).where(eq(schema.goalPlans.goalId,args.id)); } catch { /* tabla aún no creada: no había plan */ } try { await db.delete(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.goalId,args.id)); } catch { /* tabla aún no creada: no había ajustes */ } await db.delete(schema.goals).where(eq(schema.goals.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),
  addGoalSaving: defineAction({ description: "Adds savings to a goal.", request: z.object({ id: z.number(), amount: z.number(), accountId: z.number().nullable().optional() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const rows=await db.select().from(schema.goals).where(eq(schema.goals.id,args.id)); const g=rows[0]; if(!g) throw new Error("Meta no encontrada"); if(args.accountId){ const ar=await db.select().from(schema.accounts).where(eq(schema.accounts.id,args.accountId)); if(!ar[0]||ar[0].householdId!==g.householdId) throw new Error("La cuenta indicada no pertenece a este hogar."); } await db.update(schema.goals).set({savedAmount: Math.max(0, g.savedAmount+args.amount)}).where(eq(schema.goals.id,args.id));
    // Si la meta tiene plan con fondo, el abono también entra al fondo, para que el avance de la meta y el saldo del fondo sean el mismo.
    try {
      const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.goalId, args.id));
      const plan = plans[0];
      if (plan?.fundId && args.amount !== 0) {
        const now = new Date(); const today = `${ymOf(now)}-${String(now.getDate()).padStart(2, "0")}`;
        await db.insert(schema.fundMovements).values({ householdId: g.householdId, fundId: plan.fundId, type: args.amount > 0 ? "contribution" : "withdrawal", amount: Math.abs(args.amount), date: today, note: `Aporte a la meta ${g.name}`, accountId: args.accountId ?? null } as never);
        await syncGoalSavedFromFund(ctx, g.householdId, plan.fundId);
      }
    } catch { /* sin plan con fondo: el abono queda solo en la meta */ }
    await checkGoalPlanAlerts(ctx, g.householdId);
    ctx.invalidateQueries(); return {ok:true,id:args.id}; } }),

  analyzeGoalPlan: defineAction({
    description: "Arma el plan de ahorro de una meta con la información financiera real del hogar: calcula el aporte mensual, revisa si alcanza con el ingreso, los compromisos fijos y el gasto promedio de los últimos 3 meses completos, y si no alcanza propone de qué categoría recortar o alargar el plazo. No guarda nada.",
    request: z.object({ householdId: z.number(), goalId: z.number().optional(), name: z.string().min(1), targetAmount: z.number().positive(), savedAmount: z.number().min(0).default(0), targetDate: z.string().optional(), months: z.number().int().min(1).max(120).optional() }),
    response: z.object({
      monthlyAmount: z.number(), months: z.number(), targetDate: z.string().nullable(), dueDay: z.number(),
      income: z.number(), fixedCommitments: z.number(), avgMonthlyExpense: z.number(), surplus: z.number(), feasible: z.boolean(),
      cutSuggestions: z.array(z.object({ categoryId: z.number().nullable(), name: z.string(), avgMonthly: z.number(), suggestedCut: z.number() })),
      extendedMonths: z.number(), extendedMonthly: z.number(), remaining: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db;
      const hhRows = await db.select().from(schema.households).where(eq(schema.households.id, args.householdId)).limit(1);
      const hh = hhRows[0];
      if (!hh) throw new Error("No se encontró el hogar indicado.");
      const now = new Date();
      const curYm = ymOf(now);
      const remaining = Math.max(0, Math.round((args.targetAmount - args.savedAmount) * 100) / 100);
      let months = args.months ?? 0;
      if (!months) months = args.targetDate ? Math.max(1, monthDiff(curYm, args.targetDate.slice(0, 7))) : 6;
      const monthlyAmount = remaining <= 0 ? 0 : Math.ceil(remaining / months);
      // Ingreso y compromisos: de los perfiles adultos; si no hay ingreso
      // registrado, se usa el ingreso promedio de los movimientos.
      const profiles = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
      const adults = profiles.filter(p => p.kind === "adult");
      const incomeProfiles = adults.reduce((s, p) => s + p.monthlyIncome, 0);
      const fixedCommitments = adults.reduce((s, p) => s + p.fixedCommitments, 0);
      const movs = await db.select().from(schema.movements).where(eq(schema.movements.householdId, args.householdId));
      const reversedIds = new Set(movs.filter(m => m.reversalOfId != null).map(m => m.reversalOfId as number));
      const active = movs.filter(m => m.reversalOfId == null && !reversedIds.has(m.id));
      // Últimos 3 meses completos (sin el mes en curso).
      const fullMonths: string[] = [];
      for (let k = 3; k >= 1; k--) fullMonths.push(ymAdd(curYm, -k));
      const isExpense = (m: { type: string }) => m.type === "expense" || m.type === "debt_payment";
      const avgMonthlyExpense = Math.round(fullMonths.reduce((s, ym) => s + active.filter(m => m.date.startsWith(ym) && isExpense(m)).reduce((t, m) => t + m.amount, 0), 0) / fullMonths.length * 100) / 100;
      const avgIncomeMovs = Math.round(fullMonths.reduce((s, ym) => s + active.filter(m => m.date.startsWith(ym) && m.type === "income").reduce((t, m) => t + m.amount, 0), 0) / fullMonths.length * 100) / 100;
      const income = incomeProfiles > 0 ? Math.round(incomeProfiles * 100) / 100 : avgIncomeMovs;
      const surplus = Math.max(0, Math.round((income - fixedCommitments - avgMonthlyExpense) * 100) / 100);
      const feasible = monthlyAmount <= surplus;
      // Si no alcanza: de qué categoría recortar, con el gasto promedio mensual.
      const cutSuggestions: { categoryId: number | null; name: string; avgMonthly: number; suggestedCut: number }[] = [];
      if (!feasible) {
        const cats = await db.select().from(schema.categories).where(eq(schema.categories.householdId, args.householdId));
        const totals = new Map<number, number>();
        for (const m of active) {
          if (!isExpense(m) || m.categoryId == null) continue;
          if (!fullMonths.some(ym => m.date.startsWith(ym))) continue;
          totals.set(m.categoryId, (totals.get(m.categoryId) ?? 0) + m.amount);
        }
        const ranked = Array.from(totals.entries())
          .map(([categoryId, total]) => ({ categoryId, name: cats.find(c => c.id === categoryId)?.name ?? "Sin categoría", avgMonthly: Math.round(total / fullMonths.length * 100) / 100 }))
          .filter(c => c.avgMonthly > 0)
          .sort((a, b) => b.avgMonthly - a.avgMonthly);
        let needed = Math.round((monthlyAmount - surplus) * 100) / 100;
        for (const c of ranked.slice(0, 3)) {
          if (needed <= 0) break;
          const cut = Math.min(c.avgMonthly, needed);
          cutSuggestions.push({ ...c, suggestedCut: Math.round(cut * 100) / 100 });
          needed = Math.round((needed - cut) * 100) / 100;
        }
      }
      // Alargar el plazo: con el sobrante mensual, ¿en cuántos meses se llega?
      let extendedMonths = 0; let extendedMonthly = 0;
      if (!feasible && surplus > 0 && remaining > 0) {
        extendedMonths = Math.ceil(remaining / surplus);
        extendedMonthly = Math.ceil(remaining / extendedMonths);
      }
      return {
        monthlyAmount, months, targetDate: args.targetDate ?? null, dueDay: hh.cutoffDay,
        income, fixedCommitments, avgMonthlyExpense, surplus, feasible,
        cutSuggestions, extendedMonths, extendedMonthly, remaining,
      };
    },
  }),

  acceptGoalPlan: defineAction({
    description: "Guarda el plan de ahorro aceptado para una meta: crea (o reusa) un fondo separado con el nombre de la meta, donde se aparta el dinero, y registra el aporte mensual, el plazo y el día de pago. Si la meta ya tenía ahorro, ese saldo pasa al fondo como saldo inicial.",
    request: z.object({ householdId: z.number(), goalId: z.number(), monthlyAmount: z.number().positive(), months: z.number().int().min(1).max(120), dueDay: z.number().int().min(1).max(28).default(1) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const goals = await db.select().from(schema.goals).where(eq(schema.goals.id, args.goalId)).limit(1);
      const goal = goals[0];
      if (!goal || goal.householdId !== args.householdId) throw new Error("Meta no encontrada.");
      let plans: (typeof schema.goalPlans.$inferSelect)[];
      try { plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.householdId, args.householdId)); }
      catch { throw new Error("Para guardar el plan, primero ejecute supabase/goal-plans.sql en el SQL Editor de Supabase."); }
      const existing = plans.find(p => p.goalId === args.goalId);
      const now = new Date();
      const curYm = ymOf(now);
      const today = `${curYm}-${String(now.getDate()).padStart(2, "0")}`;
      let fundId = existing?.fundId ?? null;
      if (!fundId) {
        const [fund] = await db.insert(schema.funds).values({ householdId: args.householdId, name: `Meta: ${goal.name}`, targetAmount: goal.targetAmount, visibility: goal.visibility }).returning({ id: schema.funds.id });
        if (!fund) throw new Error("No se pudo crear el fondo de la meta.");
        fundId = fund.id;
        // El ahorro que la meta ya tenía pasa al fondo como saldo inicial.
        if (goal.savedAmount > 0) {
          await db.insert(schema.fundMovements).values({ householdId: args.householdId, fundId, type: "contribution", amount: goal.savedAmount, date: today, note: "Saldo inicial de la meta", accountId: null } as never);
        }
      }
      let planId: number;
      if (existing) {
        await db.update(schema.goalPlans).set({ monthlyAmount: args.monthlyAmount, months: args.months, dueDay: args.dueDay, fundId, status: "aceptado" }).where(eq(schema.goalPlans.id, existing.id));
        planId = existing.id;
      } else {
        const [row] = await db.insert(schema.goalPlans).values({ householdId: args.householdId, goalId: args.goalId, monthlyAmount: args.monthlyAmount, months: args.months, startMonth: curYm, dueDay: args.dueDay, fundId, status: "aceptado" }).returning({ id: schema.goalPlans.id });
        if (!row) throw new Error("No se pudo guardar el plan.");
        planId = row.id;
      }
      await logActivity(ctx, args.householdId, "Plan de ahorro aceptado", `${goal.name} · ${moneyShort(args.monthlyAmount)}/mes durante ${args.months} meses`);
      ctx.invalidateQueries();
      return { ok: true, id: planId };
    },
  }),

  cancelGoalPlan: defineAction({
    description: "Quita el plan de ahorro de una meta. El fondo y el dinero apartado se conservan como un fondo normal.",
    request: z.object({ householdId: z.number(), goalId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const goals = await db.select().from(schema.goals).where(eq(schema.goals.id, args.goalId)).limit(1);
      const goal = goals[0];
      if (!goal || goal.householdId !== args.householdId) throw new Error("Meta no encontrada.");
      try { await db.delete(schema.goalPlans).where(eq(schema.goalPlans.goalId, args.goalId)); } catch { /* tabla aún no creada: no había plan */ }
      try { await db.delete(schema.spendingAdjustments).where(and(eq(schema.spendingAdjustments.goalId, args.goalId), eq(schema.spendingAdjustments.status, "propuesto"))); } catch { /* tabla aún no creada: no había ajustes */ }
      await logActivity(ctx, args.householdId, "Plan de ahorro cancelado", goal.name);
      ctx.invalidateQueries();
      return { ok: true, id: args.goalId };
    },
  }),

  analyzeSpendingAdjustment: defineAction({
    description: "Calcula el ajuste de gastos de una meta para el mes en curso: qué categoría se pasó de su presupuesto, de qué categorías con margen se puede recortar, si la aportación a la meta cambia (poco y repartida) o si hay que alargar el plazo, y si queda sobrante para la meta. No guarda nada.",
    request: z.object({ householdId: z.number(), goalId: z.number() }),
    response: z.object({
      goalId: z.number(), goalName: z.string(), month: z.string(),
      overruns: z.array(z.object({ budgetId: z.number(), categoryId: z.number(), name: z.string(), budget: z.number(), spent: z.number(), over: z.number() })),
      totalOver: z.number(),
      cuts: z.array(z.object({ budgetId: z.number(), categoryId: z.number(), name: z.string(), slack: z.number(), cut: z.number(), newBudget: z.number() })),
      totalCut: z.number(), uncovered: z.number(),
      income: z.number(), fixedCommitments: z.number(), budgetsTotal: z.number(), adjustedBudgetsTotal: z.number(),
      monthlyAmount: z.number(), monthsLeft: z.number(), newMonthlyAmount: z.number(), monthlyDelta: z.number(), extendedMonths: z.number(), affordable: z.number(), coversAll: z.boolean(),
      surplus: z.array(z.object({ budgetId: z.number(), categoryId: z.number(), name: z.string(), slack: z.number() })),
      totalSurplus: z.number(),
    }),
    async handler(ctx, args) {
      let comp: AdjustmentComputation | null;
      try { comp = await computeSpendingAdjustment(ctx, args.householdId, args.goalId); }
      catch { throw new Error("Para usar el ajuste de gastos, primero ejecute supabase/spending-adjustments.sql en el SQL Editor de Supabase."); }
      if (!comp) throw new Error("Esta meta aún no tiene plan de ahorro. Primero arme el plan en Metas.");
      return comp;
    },
  }),

  proposeSpendingAdjustment: defineAction({
    description: "Guarda la propuesta de ajuste de gastos de una meta y avisa con la campanita antes de mover nada. El usuario puede cambiar de dónde se recorta: los montos se validan contra el margen real de cada categoría.",
    request: z.object({ householdId: z.number(), goalId: z.number(), kind: z.enum(["recorte", "sobrante"]), cuts: z.array(z.object({ budgetId: z.number(), amount: z.number().min(0) })).optional() }),
    response: z.object({ ok: z.literal(true), id: z.number().nullable() }),
    async handler(ctx, args) {
      let comp: AdjustmentComputation | null;
      try { comp = await computeSpendingAdjustment(ctx, args.householdId, args.goalId); }
      catch { throw new Error("Para usar el ajuste de gastos, primero ejecute supabase/spending-adjustments.sql en el SQL Editor de Supabase."); }
      if (!comp) throw new Error("Esta meta aún no tiene plan de ahorro. Primero arme el plan en Metas.");
      if (args.kind === "recorte" && comp.totalOver <= 0) throw new Error("Este mes ninguna categoría se pasó de su presupuesto. No hace falta un ajuste.");
      if (args.kind === "sobrante" && comp.totalSurplus <= 0) throw new Error("Este mes no hay sobrante en ninguna categoría.");
      if (args.cuts && args.cuts.length > 0) {
        // El usuario cambió los recortes: se validan contra el margen real y se recalcula todo.
        const base = await loadAdjustmentBase(ctx, args.householdId, args.goalId);
        if (!base) throw new Error("Esta meta aún no tiene plan de ahorro.");
        if (args.kind === "recorte") {
          const edited: AdjustmentCut[] = [];
          for (const c of args.cuts) {
            const s = base.slacks.find(x => x.budgetId === c.budgetId);
            if (!s) throw new Error("Una de las categorías del ajuste ya no tiene presupuesto este mes.");
            const amount = Math.min(round2(c.amount), s.slack);
            if (amount <= 0) continue;
            edited.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: s.slack, cut: amount, newBudget: round2(s.budget - amount) });
          }
          comp = deriveAdjustment(base, edited);
        } else {
          const items = [];
          for (const c of args.cuts) {
            const s = base.slacks.find(x => x.budgetId === c.budgetId);
            if (!s) throw new Error("Una de las categorías del ajuste ya no tiene presupuesto este mes.");
            const amount = Math.min(round2(c.amount), s.slack);
            if (amount > 0) items.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: amount });
          }
          comp = { ...comp, surplus: items, totalSurplus: round2(items.reduce((s, x) => s + x.slack, 0)) };
        }
      }
      const id = await saveAdjustmentProposal(ctx, args.householdId, comp, args.kind, true, true);
      if (id == null) throw new Error("Para usar el ajuste de gastos, primero ejecute supabase/spending-adjustments.sql en el SQL Editor de Supabase.");
      await logActivity(ctx, args.householdId, "Ajuste de gastos propuesto", `${comp.goalName} · ${args.kind === "recorte" ? `se pasó ${moneyShort(comp.totalOver)}` : `sobran ${moneyShort(comp.totalSurplus)}`}`);
      ctx.invalidateQueries();
      return { ok: true as const, id };
    },
  }),

  acceptSpendingAdjustment: defineAction({
    description: "Aplica una propuesta de ajuste de gastos ya aceptada por el usuario: recorta los presupuestos indicados (nunca por debajo de lo ya gastado), ajusta la aportación mensual del plan si hace falta (poco y repartida) o alarga su plazo, o mueve el sobrante al fondo de la meta.",
    request: z.object({ id: z.number(), cuts: z.array(z.object({ budgetId: z.number(), amount: z.number().min(0) })).optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      let rows: (typeof schema.spendingAdjustments.$inferSelect)[];
      try { rows = await db.select().from(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.id, args.id)); }
      catch { throw new Error("Para usar el ajuste de gastos, primero ejecute supabase/spending-adjustments.sql en el SQL Editor de Supabase."); }
      const prop = rows[0];
      if (!prop) throw new Error("No se encontró la propuesta de ajuste.");
      if (prop.status !== "propuesto") throw new Error("Esta propuesta ya se resolvió.");
      const goals = await db.select().from(schema.goals).where(eq(schema.goals.id, prop.goalId)).limit(1);
      const goalName = goals[0]?.name ?? "la meta";
      // El usuario cambió los recortes al aceptar: se validan contra el
      // margen real de cada categoría y se guardan antes de aplicar.
      if (args.cuts && args.cuts.length > 0) {
        const base = await loadAdjustmentBase(ctx, prop.householdId, prop.goalId);
        if (base) {
          if (prop.kind === "recorte") {
            const edited: AdjustmentCut[] = [];
            for (const c of args.cuts) {
              const s = base.slacks.find(x => x.budgetId === c.budgetId);
              if (!s) continue;
              const amount = Math.min(round2(c.amount), s.slack);
              if (amount <= 0) continue;
              edited.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: s.slack, cut: amount, newBudget: round2(s.budget - amount) });
            }
            const derived0 = deriveAdjustment(base, edited);
            const cutsJson = adjustmentCutsJson(derived0, "recorte");
            await db.update(schema.spendingAdjustments).set({ cuts: cutsJson, newMonthlyAmount: derived0.newMonthlyAmount, newMonths: derived0.extendedMonths > 0 ? derived0.extendedMonths : null, extendedMonths: derived0.extendedMonths, coversAll: derived0.coversAll ? 1 : 0, note: adjustmentNote(derived0, "recorte") }).where(eq(schema.spendingAdjustments.id, prop.id));
            prop.cuts = cutsJson;
          } else {
            const items = [];
            for (const c of args.cuts) {
              const s = base.slacks.find(x => x.budgetId === c.budgetId);
              if (!s) continue;
              const amount = Math.min(round2(c.amount), s.slack);
              if (amount > 0) items.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, amount });
            }
            const cutsJson = JSON.stringify(items);
            await db.update(schema.spendingAdjustments).set({ cuts: cutsJson }).where(eq(schema.spendingAdjustments.id, prop.id));
            prop.cuts = cutsJson;
          }
        }
      }
      const storedCuts = parseAdjustmentCuts(prop.cuts);
      if (prop.kind === "recorte") {
        // Se recalcula con los números de hoy y con los recortes de la
        // propuesta, con tope en el margen real, para que ningún presupuesto
        // quede por debajo de lo ya gastado. Si la propuesta es de un mes
        // pasado, se aplican los recortes guardados tal como quedaron.
        const curYm = ymOf(new Date());
        const base = prop.month === curYm ? await loadAdjustmentBase(ctx, prop.householdId, prop.goalId) : null;
        let derived: AdjustmentComputation | null = null;
        let toApply: { budgetId: number; name: string; newBudget: number; cut: number }[] = [];
        if (base) {
          const clamped: AdjustmentCut[] = [];
          for (const c of storedCuts) {
            const s = base.slacks.find(x => x.budgetId === c.budgetId);
            if (!s) continue;
            const amount = Math.min(round2(c.amount), s.slack);
            if (amount <= 0) continue;
            clamped.push({ budgetId: s.budgetId, categoryId: s.categoryId, name: s.name, slack: s.slack, cut: amount, newBudget: round2(s.budget - amount) });
          }
          derived = deriveAdjustment(base, clamped);
          toApply = clamped.map(c => ({ budgetId: c.budgetId, name: c.name, newBudget: c.newBudget, cut: c.cut }));
        } else {
          toApply = storedCuts.filter(c => c.budgetId != null && c.newBudget != null).map(c => ({ budgetId: c.budgetId as number, name: c.name, newBudget: c.newBudget as number, cut: c.amount }));
        }
        if (toApply.length === 0) throw new Error("Los recortes de esta propuesta ya no aplican: los presupuestos cambiaron. Revise el ajuste de nuevo en Metas.");
        const applied: string[] = [];
        for (const c of toApply) {
          const bRows = await db.select().from(schema.budgets).where(eq(schema.budgets.id, c.budgetId));
          const b = bRows[0];
          if (!b || b.householdId !== prop.householdId || b.month !== prop.month) continue;
          await db.update(schema.budgets).set({ amount: c.newBudget }).where(eq(schema.budgets.id, b.id));
          applied.push(`${c.name}: ${moneyShort(c.cut)}`);
        }
        // Aportación del plan: solo si el recálculo dice que todo queda
        // cubierto; si no alcanza, los recortes se aplican igual, pero la
        // aportación no se toca.
        if (derived?.coversAll) {
          const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.goalId, prop.goalId));
          const plan = plans[0];
          if (plan) {
            const patch: { monthlyAmount?: number; months?: number } = {};
            if (derived.newMonthlyAmount !== plan.monthlyAmount) patch.monthlyAmount = derived.newMonthlyAmount;
            if (derived.extendedMonths > 0) {
              const elapsed = Math.max(0, monthDiff(plan.startMonth, derived.month));
              patch.months = elapsed + derived.extendedMonths;
              // La fecha objetivo de la meta se mueve al nuevo plazo, para que el plan no quede en riesgo contra su propia fecha.
              const targetYm = ymAdd(derived.month, derived.extendedMonths);
              const [ty = 2026, tm = 1] = targetYm.split("-").map(Number);
              const lastDay = new Date(ty, tm, 0).getDate();
              await db.update(schema.goals).set({ targetDate: `${targetYm}-${String(lastDay).padStart(2, "0")}` }).where(eq(schema.goals.id, prop.goalId));
            }
            if (Object.keys(patch).length > 0) await db.update(schema.goalPlans).set(patch).where(eq(schema.goalPlans.id, plan.id));
          }
        }
        await db.update(schema.spendingAdjustments).set({ status: "aplicado" }).where(eq(schema.spendingAdjustments.id, prop.id));
        await logActivity(ctx, prop.householdId, "Ajuste de gastos aplicado", `${goalName} · ${applied.join(", ") || "sin recortes"}`);
        const aporteText = derived?.coversAll
          ? (derived.extendedMonths > 0
            ? ` Su aportación a la meta queda en ${moneyShort(derived.newMonthlyAmount)} al mes y el plazo se alarga a ${derived.extendedMonths} meses.`
            : derived.monthlyDelta > 0
              ? ` Su aportación a la meta queda en ${moneyShort(derived.newMonthlyAmount)} al mes.`
              : ` Su aportación a la meta sigue igual.`)
          : " La aportación a la meta no se tocó porque aun así no alcanza para cubrir todo.";
        await notifyHousehold(ctx, prop.householdId, { type: "ajuste_gasto", title: "Ajuste aplicado", body: `Se aplicó el ajuste de gastos para la meta ${goalName}: ${applied.join(", ") || "sin recortes"}.${aporteText} Sus gastos fijos, sus presupuestos y su aportación quedaron revisados en Metas.`, amount: prop.overAmount, target: "metas" });
      } else {
        const plans = await db.select().from(schema.goalPlans).where(eq(schema.goalPlans.goalId, prop.goalId));
        const plan = plans[0];
        if (!plan?.fundId) throw new Error("La meta ya no tiene fondo para recibir el sobrante.");
        const base = await loadAdjustmentBase(ctx, prop.householdId, prop.goalId);
        let total = 0;
        const moved: string[] = [];
        for (const c of storedCuts) {
          const s = base?.slacks.find(x => x.budgetId === c.budgetId);
          const amount = s ? Math.min(round2(c.amount), s.slack) : round2(c.amount);
          if (amount <= 0) continue;
          total = round2(total + amount);
          moved.push(`${c.name} ${moneyShort(amount)}`);
        }
        if (total <= 0) throw new Error("El sobrante de esta propuesta ya es $0.");
        const now = new Date();
        const today = `${ymOf(now)}-${String(now.getDate()).padStart(2, "0")}`;
        await db.insert(schema.fundMovements).values({ householdId: prop.householdId, fundId: plan.fundId, type: "contribution", amount: total, date: today, note: `Sobrante del mes: ${moved.join(", ")}`, accountId: null } as never);
        await syncGoalSavedFromFund(ctx, prop.householdId, plan.fundId);
        await db.update(schema.spendingAdjustments).set({ status: "aplicado" }).where(eq(schema.spendingAdjustments.id, prop.id));
        await logActivity(ctx, prop.householdId, "Sobrante enviado a la meta", `${goalName} · ${moneyShort(total)}`);
        await notifyHousehold(ctx, prop.householdId, { type: "ajuste_sobrante", title: "Sobrante enviado a la meta", body: `Se movieron ${moneyShort(total)} al fondo de su meta ${goalName} (${moved.join(", ")}). Su meta ahora está más cerca.`, amount: total, target: "metas" });
        await checkGoalPlanAlerts(ctx, prop.householdId);
      }
      ctx.invalidateQueries();
      return { ok: true, id: prop.id };
    },
  }),

  rejectSpendingAdjustment: defineAction({
    description: "Rechaza una propuesta de ajuste de gastos. No se mueve nada.",
    request: z.object({ id: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      let rows: (typeof schema.spendingAdjustments.$inferSelect)[];
      try { rows = await db.select().from(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.id, args.id)); }
      catch { throw new Error("Para usar el ajuste de gastos, primero ejecute supabase/spending-adjustments.sql en el SQL Editor de Supabase."); }
      const prop = rows[0];
      if (!prop) throw new Error("No se encontró la propuesta de ajuste.");
      if (prop.status !== "propuesto") throw new Error("Esta propuesta ya se resolvió.");
      await db.update(schema.spendingAdjustments).set({ status: "rechazado" }).where(eq(schema.spendingAdjustments.id, prop.id));
      const goals = await db.select().from(schema.goals).where(eq(schema.goals.id, prop.goalId)).limit(1);
      await logActivity(ctx, prop.householdId, "Ajuste de gastos rechazado", goals[0]?.name ?? "");
      ctx.invalidateQueries();
      return { ok: true, id: prop.id };
    },
  }),

  saveAgreement: defineAction({
    description: "Creates an agreement proposal.",
    request: z.object({ householdId: z.number(), title: z.string().min(1), description: z.string().default("") }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const [r]=await db.insert(schema.agreements).values({householdId:args.householdId,title:args.title,description:args.description,status:"proposal"}).returning({id:schema.agreements.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  voteAgreement: defineAction({
    description: "Votes on an agreement and auto-updates its status by household rule.",
    request: z.object({ agreementId: z.number(), profileId: z.number(), vote: z.enum(["approve","reject"]), householdId: z.number() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const existing=await db.select().from(schema.agreementVotes).where(eq(schema.agreementVotes.agreementId,args.agreementId)); const mine=existing.find(v=>v.profileId===args.profileId); if(mine){ await db.update(schema.agreementVotes).set({vote:args.vote}).where(eq(schema.agreementVotes.id,mine.id)); } else { await db.insert(schema.agreementVotes).values({agreementId:args.agreementId,profileId:args.profileId,vote:args.vote}); }
      const votes=await db.select().from(schema.agreementVotes).where(eq(schema.agreementVotes.agreementId,args.agreementId));
      const profiles=await db.select().from(schema.profiles).where(eq(schema.profiles.householdId,args.householdId)); const adults=profiles.filter(p=>p.kind==="adult"); const hhRows=await db.select().from(schema.households).where(eq(schema.households.id,args.householdId)); const rule=hhRows[0]?.approvalRule||"unanimous";
      const approves=votes.filter(v=>v.vote==="approve").length; const rejects=votes.filter(v=>v.vote==="reject").length;
      let status:"proposal"|"approved"|"rejected"="proposal";
      if(rule==="unanimous"){ if(rejects>0) status="rejected"; else if(adults.length>0 && approves>=adults.length) status="approved"; } else { const need=Math.floor(adults.length/2)+1; if(approves>=need) status="approved"; else if(rejects>=need) status="rejected"; }
      await db.update(schema.agreements).set({status}).where(eq(schema.agreements.id,args.agreementId));
      ctx.invalidateQueries(); return {ok:true,id:args.agreementId}; },
  }),
  deleteAgreement: defineAction({ description: "Deletes an agreement.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.agreementVotes).where(eq(schema.agreementVotes.agreementId,args.id)); await db.delete(schema.agreements).where(eq(schema.agreements.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  savePatrimony: defineAction({
    description: "Creates or updates a patrimony item (asset or liability). Totals are computed, never typed.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), kind: z.enum(["asset","liability"]), category: z.string().default(""), value: z.number().min(0), owner: z.string().optional() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const vals={householdId:args.householdId,name:args.name,kind:args.kind,category:args.category,value:args.value,owner:args.owner||null}; if(args.id){ await db.update(schema.patrimonyItems).set(vals).where(eq(schema.patrimonyItems.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.patrimonyItems).values(vals).returning({id:schema.patrimonyItems.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deletePatrimony: defineAction({ description: "Deletes a patrimony item.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.patrimonyItems).where(eq(schema.patrimonyItems.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),



  createInvitation: defineAction({
    description: "Creates a pending household invitation by email and sends it by email with a direct link (single-use token, 7 days). Reuses an existing pending one instead of erroring (no 409). If email sending is not configured, returns the invite link to copy as a fallback.",
    request: z.object({ householdId: z.number(), email: z.string().email(), invitedName: z.string().optional() }),
    response: z.object({ ok: z.literal(true), id: z.number().optional(), reused: z.boolean(), emailSent: z.boolean(), emailConfigured: z.boolean(), inviteUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; id?: number; reused: boolean; emailSent: boolean; emailConfigured: boolean; inviteUrl: string }> {
      await rateLimit("createInvitation", 20, 60_000);
      const db = ctx.db;
      const email = args.email.trim().toLowerCase();
      const hhRows = await db.select().from(schema.households).where(eq(schema.households.id, args.householdId)).limit(1);
      const householdName = hhRows[0]?.name || "su hogar";
      const existing = await db.select().from(schema.invitations).where(eq(schema.invitations.householdId, args.householdId));
      const pending = existing.find(i=>i.email.toLowerCase()===email && i.status==="pending");
      if (pending) {
        const sent = await sendInviteForToken(ctx, "household", { email, householdId: args.householdId, invitationId: pending.id, invitedName: pending.invitedName ?? args.invitedName }, {
          subject: `Invitación para unirse al hogar ${householdName} en SyncFinanzas`,
          heading: `Usted fue invitado a unirse al hogar ${householdName}`,
          bodyHtml: `<p>Usted recibió una invitación para unirse al hogar <b>${householdName}</b> en SyncFinanzas, la aplicación para administrar las finanzas del hogar con claridad.</p><p>Al aceptar, ingresará directamente a ese hogar como integrante, sin crear uno nuevo y sin errores. Podrá consultar los movimientos compartidos y registrar los suyos, con sus movimientos privados visibles solo para usted.</p>`,
          bodyText: `Usted recibió una invitación para unirse al hogar ${householdName} en SyncFinanzas. Al aceptar, ingresará directamente a ese hogar como integrante, sin crear uno nuevo.`,
        });
        ctx.invalidateQueries(); return { ok: true, id: pending.id, reused: true, ...sent };
      }
      const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
      if (profs.some(pr=>(pr.email||"").toLowerCase()===email)) throw new Error("Esa persona ya es integrante de este hogar.");
      const [r] = await db.insert(schema.invitations).values({ householdId: args.householdId, email, invitedName: args.invitedName || null, status: "pending" }).returning({ id: schema.invitations.id });
      await logActivity(ctx, args.householdId, "Invitación al hogar creada", email);
      const sent = await sendInviteForToken(ctx, "household", { email, householdId: args.householdId, invitationId: r?.id ?? null, invitedName: args.invitedName }, {
        subject: `Invitación para unirse al hogar ${householdName} en SyncFinanzas`,
        heading: `Usted fue invitado a unirse al hogar ${householdName}`,
        bodyHtml: `<p>Usted recibió una invitación para unirse al hogar <b>${householdName}</b> en SyncFinanzas, la aplicación para administrar las finanzas del hogar con claridad.</p><p>Al aceptar, ingresará directamente a ese hogar como integrante, sin crear uno nuevo y sin errores. Podrá consultar los movimientos compartidos y registrar los suyos, con sus movimientos privados visibles solo para usted.</p>`,
        bodyText: `Usted recibió una invitación para unirse al hogar ${householdName} en SyncFinanzas. Al aceptar, ingresará directamente a ese hogar como integrante, sin crear uno nuevo.`,
      });
      ctx.invalidateQueries(); return { ok: true, id: r?.id, reused: false, ...sent };
    },
  }),
  findInvitations: defineAction({
    description: "Finds pending invitations for an email across households, with the inviting household name. Includes tanda invitations, so someone invited to a tanda can find it by email even if they lost the link.",
    request: z.object({ email: z.string().email() }),
    response: z.object({ invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), householdId: z.number(), householdName: z.string(), kind: z.enum(["household", "tanda"]), tandaId: z.number().nullable(), tandaName: z.string().nullable() })) }),
    async handler(ctx, args) {
      await rateLimit("findInvitations", 20, 60_000);
      const db = ctx.db;
      const email = args.email.trim().toLowerCase();
      const all = await db.select().from(schema.invitations);
      const mine = all.filter(i=>i.email.toLowerCase()===email && i.status==="pending");
      const tAll = await db.select().from(schema.tandaInvitations);
      const tMine = tAll.filter(i=>i.email.toLowerCase()===email && i.status==="pending");
      const hhs = await db.select().from(schema.households);
      const tds = await db.select().from(schema.tandas);
      return { invitations: [
        ...mine.map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, householdId: i.householdId, householdName: hhs.find(h=>h.id===i.householdId)?.name || "Hogar", kind: "household" as const, tandaId: null as number | null, tandaName: null as string | null })),
        ...tMine.map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, householdId: i.householdId, householdName: hhs.find(h=>h.id===i.householdId)?.name || "Hogar", kind: "tanda" as const, tandaId: i.tandaId, tandaName: tds.find(t=>t.id===i.tandaId)?.name ?? null })),
      ] };
    },
  }),
  resolveInvite: defineAction({
    description: "Resolves an invite link token (public preview after login): returns the invitation kind, invited email, inviter and household/tanda names, and the invitation ids needed to accept or reject. Never reveals the token itself.",
    request: z.object({ token: z.string().min(10) }),
    response: z.object({
      ok: z.literal(true),
      kind: z.enum(["household", "tanda", "general"]),
      email: z.string(),
      invitedName: z.string().nullable(),
      inviterName: z.string().nullable(),
      householdId: z.number().nullable(),
      householdName: z.string().nullable(),
      tandaId: z.number().nullable(),
      tandaName: z.string().nullable(),
      invitationId: z.number().nullable(),
      tandaInvitationId: z.number().nullable(),
      expiresAt: z.string(),
      usable: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db;
      const t = await resolveInviteToken(db, args.token.trim());
      if (!t) throw new Error("El enlace de invitación no es válido. Solicite una invitación nueva.");
      let householdName: string | null = null;
      let tandaName: string | null = null;
      if (t.householdId != null) {
        const hh = await db.select().from(schema.households).where(eq(schema.households.id, t.householdId)).limit(1);
        householdName = hh[0]?.name ?? null;
      }
      if (t.tandaId != null) {
        const td = await db.select().from(schema.tandas).where(eq(schema.tandas.id, t.tandaId)).limit(1);
        tandaName = td[0]?.name ?? null;
      }
      return {
        ok: true as const,
        kind: t.kind,
        email: t.email,
        invitedName: t.invitedName,
        inviterName: t.inviterName,
        householdId: t.householdId,
        householdName,
        tandaId: t.tandaId,
        tandaName,
        invitationId: t.invitationId,
        tandaInvitationId: t.tandaInvitationId,
        expiresAt: t.expiresAt.toISOString(),
        usable: tokenIsUsable(t),
      };
    },
  }),
  createGeneralInvitation: defineAction({
    description: "Invites someone by email to create their own personal SyncFinanzas account (no household yet). Sends the invite email with a direct link; the invitee signs up with the invited email and then creates their own personal space.",
    request: z.object({ email: z.string().email(), invitedName: z.string().optional() }),
    response: z.object({ ok: z.literal(true), id: z.number().optional(), emailSent: z.boolean(), emailConfigured: z.boolean(), inviteUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; id?: number; emailSent: boolean; emailConfigured: boolean; inviteUrl: string }> {
      await rateLimit(`createGeneralInvitation:${ctx.user.id}`, 20, 60_000);
      const email = args.email.trim().toLowerCase();
      const sent = await sendInviteForToken(ctx, "general", { email, invitedName: args.invitedName }, {
        subject: "Invitación para crear su cuenta personal en SyncFinanzas",
        heading: "Usted fue invitado a crear su cuenta personal en SyncFinanzas",
        bodyHtml: `<p>Usted recibió una invitación para crear su cuenta personal en <b>SyncFinanzas</b>, la aplicación para administrar sus finanzas con claridad: su sueldo, sus gastos del día y la distribución de su dinero por categoría, además de sus tandas con invitados.</p><p>Al abrir la invitación, creará su cuenta con este correo y luego su espacio personal, sin crear un hogar de otra persona por error.</p>`,
        bodyText: "Usted recibió una invitación para crear su cuenta personal en SyncFinanzas. Al abrir la invitación, creará su cuenta con este correo y luego su espacio personal.",
      });
      return { ok: true, id: sent.tokenId, emailSent: sent.emailSent, emailConfigured: sent.emailConfigured, inviteUrl: sent.inviteUrl };
    },
  }),
  acceptGeneralInvite: defineAction({
    description: "Marks a general (personal account) invite token as accepted. Only the invited email can accept it. The invitee then creates their own personal space; no household is created or joined by this action.",
    request: z.object({ token: z.string().min(10) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const t = await resolveInviteToken(db, args.token.trim());
      if (!t || t.kind !== "general") throw new Error("El enlace de invitación no es válido. Solicite una invitación nueva.");
      if (!tokenIsUsable(t)) throw new Error("Esta invitación ya fue utilizada o venció. Solicite una invitación nueva.");
      if (t.email.toLowerCase() !== ctx.user.email.toLowerCase()) throw new Error("Esta invitación fue enviada a otro correo electrónico. Inicie sesión con el correo invitado.");
      await markToken(db, t.id, "accepted");
      return { ok: true };
    },
  }),
  resendInvitation: defineAction({
    description: "Resends an invitation by email with a fresh single-use link. The previous pending token is marked as replaced and stops working. No 409 error.",
    request: z.object({ kind: z.enum(["household", "tanda", "general"]), invitationId: z.number() }),
    response: z.object({ ok: z.literal(true), emailSent: z.boolean(), emailConfigured: z.boolean(), inviteUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; emailSent: boolean; emailConfigured: boolean; inviteUrl: string }> {
      await rateLimit(`resendInvitation:${ctx.user.id}`, 20, 60_000);
      const db = ctx.db;
      if (args.kind === "household") {
        const rows = await db.select().from(schema.invitations).where(eq(schema.invitations.id, args.invitationId));
        const inv = rows[0]; if (!inv) throw new Error("Invitación no encontrada.");
        if (inv.status !== "pending") throw new Error("Esta invitación ya fue respondida.");
        const hh = await db.select().from(schema.households).where(eq(schema.households.id, inv.householdId)).limit(1);
        const sent = await sendInviteForToken(ctx, "household", { email: inv.email, householdId: inv.householdId, invitationId: inv.id, invitedName: inv.invitedName }, {
          subject: `Invitación para unirse al hogar ${hh[0]?.name || "su hogar"} en SyncFinanzas`,
          heading: `Usted fue invitado a unirse al hogar ${hh[0]?.name || "su hogar"}`,
          bodyHtml: `<p>Usted recibió una invitación para unirse al hogar <b>${hh[0]?.name || "su hogar"}</b> en SyncFinanzas.</p><p>Al aceptar, ingresará directamente a ese hogar como integrante, sin crear uno nuevo y sin errores.</p>`,
          bodyText: `Usted recibió una invitación para unirse al hogar ${hh[0]?.name || "su hogar"} en SyncFinanzas. Al aceptar, ingresará directamente a ese hogar como integrante.`,
        });
        await logActivity(ctx, inv.householdId, "Invitación al hogar reenviada", inv.email);
        return { ok: true, ...sent };
      }
      if (args.kind === "tanda") {
        const rows = await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.id, args.invitationId));
        const inv = rows[0]; if (!inv) throw new Error("Invitación de tanda no encontrada.");
        if (inv.status !== "pending") throw new Error("Esta invitación ya fue respondida.");
        const acc = await tandaAccess(ctx, inv.tandaId); requireTandaRank(acc, 3);
        const td = await db.select().from(schema.tandas).where(eq(schema.tandas.id, inv.tandaId)).limit(1);
        const sent = await sendInviteForToken(ctx, "tanda", { email: inv.email, householdId: inv.householdId, tandaId: inv.tandaId, tandaInvitationId: inv.id, invitedName: inv.invitedName }, {
          subject: `Invitación para participar en la tanda ${td[0]?.name || ""} en SyncFinanzas`,
          heading: `Usted fue invitado a participar en la tanda ${td[0]?.name || ""}`,
          bodyHtml: `<p>Usted recibió una invitación para participar en la tanda <b>${td[0]?.name || ""}</b> en SyncFinanzas.</p><p>Al aceptar, se incorporará como participante visible para todos, con el calendario de entregas y los comprobantes verificados.</p>`,
          bodyText: `Usted recibió una invitación para participar en la tanda ${td[0]?.name || ""} en SyncFinanzas. Al aceptar, se incorporará como participante visible.`,
        });
        await logActivity(ctx, inv.householdId, "Invitación de tanda reenviada", inv.email);
        return { ok: true, ...sent };
      }
      const rows = await db.select().from(schema.invitationTokens).where(eq(schema.invitationTokens.id, args.invitationId));
      const tok = rows[0]; if (!tok || tok.kind !== "general") throw new Error("Invitación no encontrada.");
      if (tok.createdByUserId !== ctx.user.id) throw new Error("Solo la persona que envió la invitación puede reenviarla.");
      if (tok.status !== "pending") throw new Error("Esta invitación ya fue respondida.");
      const sent = await sendInviteForToken(ctx, "general", { email: tok.email, invitedName: tok.invitedName }, {
        subject: "Invitación para crear su cuenta personal en SyncFinanzas",
        heading: "Usted fue invitado a crear su cuenta personal en SyncFinanzas",
        bodyHtml: `<p>Usted recibió una invitación para crear su cuenta personal en <b>SyncFinanzas</b>.</p><p>Al abrir la invitación, creará su cuenta con este correo y luego su espacio personal.</p>`,
        bodyText: "Usted recibió una invitación para crear su cuenta personal en SyncFinanzas. Al abrir la invitación, creará su cuenta con este correo y luego su espacio personal.",
      });
      return { ok: true, ...sent };
    },
  }),
  respondInvitation: defineAction({
    description: "Accepts or rejects a pending invitation. Accepting creates the person's member profile INSIDE the inviting household (never a new household) with their chosen first and last name.",
    request: z.object({ id: z.number(), accept: z.boolean(), firstName: z.string().optional(), lastName: z.string().optional() }),
    response: z.object({ ok: z.literal(true), profileId: z.number().optional(), householdId: z.number().optional() }),
    async handler(ctx, args): Promise<{ ok: true; profileId?: number; householdId?: number }> {
      const db = ctx.db;
      const rows = await db.select().from(schema.invitations).where(eq(schema.invitations.id, args.id));
      const inv = rows[0]; if (!inv) throw new Error("Invitación no encontrada.");
      if (inv.status !== "pending") throw new Error("Esta invitación ya fue respondida.");
      if (inv.email.toLowerCase() !== ctx.user.email.toLowerCase()) throw new Error("Esta invitación fue enviada a otro correo electrónico. Inicie sesión con el correo invitado.");
      if (!args.accept) { await db.update(schema.invitations).set({ status: "rejected" }).where(eq(schema.invitations.id, args.id)); await markTokensForInvitation(db, inv.id, null, "rejected"); await logActivity(ctx, inv.householdId, "Invitación al hogar rechazada", inv.email); ctx.invalidateQueries(); return { ok: true, householdId: inv.householdId }; }
      const first = (args.firstName || inv.invitedName || "").trim();
      if (!first) throw new Error("Escriba su nombre para ingresar al hogar. El nombre lo define usted; no se deriva de su correo electrónico.");
      const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, inv.householdId));
      const already = profs.find(pr=>(pr.email||"").toLowerCase()===inv.email.toLowerCase());
      let profileId = already?.id;
      if (!already) {
        const [r] = await db.insert(schema.profiles).values({ householdId: inv.householdId, userId: ctx.user.id, name: first, lastName: (args.lastName||"").trim() || null, role: "member", email: inv.email, kind: "adult", monthlyIncome: 0, fixedCommitments: 0 }).returning({ id: schema.profiles.id });
        profileId = r?.id;
      }
      await db.update(schema.invitations).set({ status: "accepted" }).where(eq(schema.invitations.id, args.id));
      await markTokensForInvitation(db, inv.id, null, "accepted");
      if (profileId) {
        await db.update(schema.profiles).set({ userId: ctx.user.id }).where(eq(schema.profiles.id, profileId));
        const existingMember = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.householdId, inv.householdId));
        if (!existingMember.some(m => m.userId === ctx.user.id)) {
          await db.insert(schema.householdMembers).values({ householdId: inv.householdId, userId: ctx.user.id, profileId, role: "member" });
        }
      }
      await logActivity(ctx, inv.householdId, "Invitación al hogar aceptada", `${first} · ${inv.email}`);
      await notifyHousehold(ctx, inv.householdId, { type: "nuevo_integrante", title: "Nuevo integrante en el hogar", body: `${first} se unió al hogar.`, target: "hogar" }, ctx.user.id);
      ctx.invalidateQueries(); return { ok: true, profileId, householdId: inv.householdId };
    },
  }),
  deleteInvitation: defineAction({ description: "Deletes an invitation record (admin housekeeping).", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await markTokensForInvitation(db, args.id, null, "revoked"); await db.delete(schema.invitations).where(eq(schema.invitations.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  updatePersonalSalary: defineAction({
    description: "Sets the monthly salary/income used by Personal mode.",
    request: z.object({ householdId: z.number(), salary: z.number().min(0) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
      const adult = profs.find(p=>p.kind==="adult") || profs[0];
      if (!adult) throw new Error("Primero cree su perfil en la sección Perfiles.");
      await db.update(schema.profiles).set({ monthlyIncome: args.salary }).where(eq(schema.profiles.id, adult.id));
      ctx.invalidateQueries(); return { ok: true, id: adult.id };
    },
  }),

  saveTanda: defineAction({
    description: "Creates a tanda with name, participant count, amount per period, start date, organizer and collection frequency (semanal/quincenal/mensual). Works from Personal or Familiar mode.",
    request: z.object({ householdId: z.number(), name: z.string().min(1), participantCount: z.number().int().min(2).max(30), amountPerQuincena: z.number().positive(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), organizerProfileId: z.number().nullable().optional(), organizerName: z.string().optional(), frequency: z.enum(["semanal","quincenal","mensual"]).default("quincenal"), drawMode: z.enum(["random","weighted"]).default("random"), coverageRule: z.enum(["fondo","prorroga","reparto"]).default("fondo"), fineAmount: z.number().min(0).default(0), meetingDay: z.string().default(""), treasurerProfileId: z.number().nullable().optional(), substituteProfileId: z.number().nullable().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const cadenceDays = args.frequency==="semanal" ? 7 : args.frequency==="mensual" ? 30 : 15;
      let orgName = (args.organizerName||"").trim() || null;
      if (!orgName && args.organizerProfileId) { const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.id, args.organizerProfileId)); orgName = profs[0] ? `${profs[0].name} ${profs[0].lastName||""}`.trim() : null; }
      const [r] = await db.insert(schema.tandas).values({ householdId: args.householdId, name: args.name, participantCount: args.participantCount, amountPerQuincena: args.amountPerQuincena, startDate: args.startDate, organizerProfileId: args.organizerProfileId ?? null, organizerName: orgName, frequency: args.frequency, cadenceDays, drawMode: args.drawMode, coverageRule: args.coverageRule, fineAmount: args.fineAmount, meetingDay: args.meetingDay, treasurerProfileId: args.treasurerProfileId ?? null, substituteProfileId: args.substituteProfileId ?? null, turnsLocked: 0 }).returning({ id: schema.tandas.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  deleteTanda: defineAction({ description: "Deletes a tanda and its participants and payments.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const acc = await tandaAccess(ctx, args.id); requireTandaRank(acc, 3); const tinvs=await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.tandaId,args.id)); for (const iv of tinvs) await markTokensForInvitation(db, null, iv.id, "revoked"); await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId,args.id)); await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId,args.id)); await db.delete(schema.tandaInvitations).where(eq(schema.tandaInvitations.tandaId,args.id)); await db.delete(schema.organizerRatings).where(eq(schema.organizerRatings.tandaId,args.id)); try { await db.delete(schema.tandaFines).where(eq(schema.tandaFines.tandaId,args.id)); await db.delete(schema.tandaVotes).where(eq(schema.tandaVotes.tandaId,args.id)); await db.delete(schema.tandaDeliveries).where(eq(schema.tandaDeliveries.tandaId,args.id)); await db.delete(schema.tandaFundEntries).where(eq(schema.tandaFundEntries.tandaId,args.id)); } catch { /* tablas v3 aún no creadas */ } await db.delete(schema.tandas).where(eq(schema.tandas.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  addTandaParticipant: defineAction({
    description: "Adds a participant to a tanda, optionally registering a SIMULATED card requirement as last-4-digits only. No real card data is accepted or stored.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), name: z.string().min(1), email: z.string().email().optional(), cardLast4: z.string().regex(/^\d{4}$/, "Deben ser exactamente los últimos 4 dígitos").optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaRank(acc, 3); requireTandaHousehold(acc, args.householdId);
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const existing = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      if (existing.length >= td.participantCount) throw new Error(`La tanda ya tiene sus ${td.participantCount} participantes.`);
      const nowD = new Date(); const joined = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
      const [r] = await db.insert(schema.tandaParticipants).values({ householdId: args.householdId, tandaId: args.tandaId, name: args.name, email: args.email?.trim().toLowerCase() || null, cardLast4: args.cardLast4 || null, joinedDate: joined }).returning({ id: schema.tandaParticipants.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  removeTandaParticipant: defineAction({ description: "Removes a participant from a tanda.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const prows = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.id,args.id)); const pr = prows[0]; if (!pr) throw new Error("Participante no encontrado"); const acc = await tandaAccess(ctx, pr.tandaId); requireTandaRank(acc, 3); await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.participantId,args.id)); await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),
  setParticipantCard: defineAction({
    description: "Registers or updates a participant's SIMULATED card last-4-digits only.",
    request: z.object({ id: z.number(), cardLast4: z.string().regex(/^\d{4}$/, "Deben ser exactamente los últimos 4 dígitos") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> { const db = ctx.db; const prows = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.id, args.id)); const pr = prows[0]; if (!pr) throw new Error("Participante no encontrado"); const acc = await tandaAccess(ctx, pr.tandaId); if (!acc.isAdmin && acc.rank < 3 && acc.participantId !== args.id) throw new Error("No tiene permiso para esta acción."); await db.update(schema.tandaParticipants).set({ cardLast4: args.cardLast4 }).where(eq(schema.tandaParticipants.id, args.id)); ctx.invalidateQueries(); return { ok: true, id: args.id }; },
  }),

  drawTanda: defineAction({
    description: "Runs the sorteo and assigns each participant a number 1..N. Mode 'random' is pure chance; mode 'weighted' favors reliable participants using their real payment history in this space: on-time payment rate, how early they pay, and seniority with the organizer. The chosen mode is saved on the tanda.",
    request: z.object({ tandaId: z.number(), mode: z.enum(["random","weighted"]).optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaRank(acc, 3);
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      if (parts.length < 2) throw new Error("Se necesitan al menos 2 participantes para el sorteo.");
      if ((td as unknown as { turnsLocked?: number }).turnsLocked === 1) throw new Error("Los turnos ya están fijados. El sorteo no se puede repetir.");
      const mode = args.mode || td.drawMode || "random";
      let orderedParts: typeof parts;
      if (mode === "weighted") {
        // Puntaje real desde el historial de pagos de TODO el espacio, por nombre.
        const allParts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.householdId, td.householdId));
        const allPays = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.householdId, td.householdId));
        const allTandas = await db.select().from(schema.tandas).where(eq(schema.tandas.householdId, td.householdId));
        const nowD = new Date(); const todayS = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
        const addD = (iso:string, days:number) => { const [y=2026,mo=1,d=1]=iso.split("-").map(Number); const dt=new Date(y,(mo||1)-1,(d||1)+days); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; };
        const dDiff = (a:string, b:string) => { const [ay=2026,am=1,ad=1]=a.split("-").map(Number); const [by=2026,bm=1,bd=1]=b.split("-").map(Number); return Math.round((new Date(ay,(am||1)-1,ad||1).getTime()-new Date(by,(bm||1)-1,bd||1).getTime())/86400000); };
        const scoreFor = (name:string) => {
          const key = name.trim().toLowerCase();
          const mine = allParts.filter(x=>x.name.trim().toLowerCase()===key);
          const ids = new Set(mine.map(x=>x.id));
          const pays = allPays.filter(x=>ids.has(x.participantId));
          let due = 0; let paid = 0; let onTime = 0;
          for (const t2 of allTandas) { const cad = t2.cadenceDays || 15; for (let i=0;i<t2.participantCount;i++) { if (addD(t2.startDate, i*cad) <= todayS) due += mine.filter(x=>x.tandaId===t2.id).length; } }
          for (const pay of pays) { if (pay.status!=="paid") continue; paid++; const t2 = allTandas.find(x=>x.id===pay.tandaId); if (t2 && pay.paidDate && dDiff(addD(t2.startDate,(t2.cadenceDays||15)*pay.quincenaIndex), pay.paidDate) >= 0) onTime++; }
          const joined = mine.map(x=>x.joinedDate).filter((d): d is string => !!d).sort();
          const seniority = joined[0] ? Math.max(0, dDiff(todayS, joined[0])) : 0;
          const base = due===0 ? 70 : (paid/Math.max(1,due))*70;
          return Math.max(5, Math.min(100, Math.round(base + (paid>0 ? (onTime/paid)*20 : 10) + Math.min(10, seniority/3))));
        };
        // Muestreo ponderado sin reemplazo (Efraimidis–Spirakis): mayor puntaje = más probabilidad de número temprano.
        orderedParts = parts.map(p=>({ p, key: Math.pow(Math.random(), 1/Math.max(5, scoreFor(p.name))) })).sort((a,b)=>b.key-a.key).map(x=>x.p);
      } else {
        const shuffled = [...parts];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = shuffled[i]!; shuffled[i] = shuffled[j]!; shuffled[j] = tmp; }
        orderedParts = shuffled;
      }
      for (let idx = 0; idx < orderedParts.length; idx++) { const part = orderedParts[idx]; if (part) await db.update(schema.tandaParticipants).set({ drawOrder: idx + 1 }).where(eq(schema.tandaParticipants.id, part.id)); }
      await db.update(schema.tandas).set({ drawMode: mode, turnsLocked: 1 }).where(eq(schema.tandas.id, args.tandaId));
      ctx.invalidateQueries(); return { ok: true, id: args.tandaId };
    },
  }),

  setTandaPayment: defineAction({
    description: "Marks a participant's payment for one period as paid or pending, optionally attaching the deposit/transfer proof photo (stored as a blob, key only in DB). Marking paid with a proof still requires organizer verification before it displays as verified. No real charge is made.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), status: z.enum(["paid","pending","late"]), paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), proof: z.object({ dataBase64: z.string(), mimeType: z.string() }).optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId);
      // Su propio pago lo marca el participante; el pago de otro solo lo
      // registra el tesorero, el suplente, el organizador o el administrador.
      if (!acc.isAdmin && acc.rank < 2 && acc.participantId !== args.participantId) throw new Error("No tiene permiso para esta acción.");
      let proofBlobKey: string | undefined = undefined;
      if (args.proof) { if (args.proof.dataBase64.length > 16_000_000) throw new Error("El comprobante es demasiado grande (máximo aproximado de 12 MB)."); const okTypes=["image/jpeg","image/png","image/webp"]; if (!okTypes.includes(args.proof.mimeType)) throw new Error("El comprobante debe ser JPG, PNG o WebP."); const key=`tanda-proofs/${args.householdId}/${Date.now()}-${Math.floor(Math.random()*1e9)}`; const bytes=Buffer.from(args.proof.dataBase64,"base64"); await ctx.blobs.put(key, bytes, { contentType: args.proof.mimeType }); proofBlobKey=key; }
      const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = rows.find(r=>r.participantId===args.participantId && r.quincenaIndex===args.quincenaIndex);
      const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
      // Fecha de pago leída del comprobante (opcional): si viene y es válida
      // se guarda; si no, se conserva la anterior o se usa hoy.
      const paidDateArg = args.paidDate && !Number.isNaN(new Date(args.paidDate + "T00:00:00").getTime()) ? args.paidDate : null;
      const status = proofBlobKey ? "paid" as const : args.status;
      if (mine) { await db.update(schema.tandaPayments).set({ status, paidDate: status==="paid"? (paidDateArg ?? mine.paidDate ?? todayStr) : null, ...(proofBlobKey?{ proofBlobKey, verified: 0 }:{}), ...(status==="pending"?{ verified: 0 }:{}) }).where(eq(schema.tandaPayments.id, mine.id)); ctx.invalidateQueries(); return { ok: true, id: mine.id }; }
      const [r] = await db.insert(schema.tandaPayments).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, status, paidDate: status==="paid"? (paidDateArg ?? todayStr) : null, proofBlobKey: proofBlobKey ?? null, verified: 0 }).returning({ id: schema.tandaPayments.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  // ---- Pago de tanda con Mercado Pago (Checkout Pro, API de Orders,
  // PRUEBA) ----
  // El integrante paga su turno en el checkout y el dinero cae en la
  // cuenta del organizador (la que posee el Access Token de prueba). La
  // orden se crea con el importe exacto del pago de la tanda; el pago
  // solo se marca pagado después de leer en Mercado Pago que está
  // aprobado (aquí o por el webhook). Sin la clave de prueba en el
  // despliegue, devuelve un error claro y la app sigue funcionando.
  createMercadoPagoOrder: defineAction({
    description: "Crea una orden de pago en Mercado Pago (Checkout Pro, API de Orders, PRUEBA) para un pago de tanda pendiente: el integrante paga su turno en el checkout y el dinero cae en la cuenta del organizador. Solo quien paga o el organizador pueden crearla. Sin la clave de prueba en el despliegue devuelve un error claro.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0) }),
    response: z.object({ ok: z.literal(true), orderId: z.string(), checkoutUrl: z.string(), amount: z.number(), externalReference: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; orderId: string; checkoutUrl: string; amount: number; externalReference: string }> {
      await rateLimit("createMercadoPagoOrder", 10, 60_000);
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId);
      // Su propio pago lo crea el participante; el de otro solo el
      // organizador o el administrador del hogar.
      if (!acc.isAdmin && acc.rank < 3 && acc.participantId !== args.participantId) throw new Error("No tiene permiso para esta acción.");
      const td = acc.tanda;
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      const part = parts.find((p) => p.id === args.participantId);
      if (!part) throw new Error("Participante no encontrado en esta tanda.");
      const pays = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = pays.find((r) => r.participantId === args.participantId && r.quincenaIndex === args.quincenaIndex);
      if (mine?.status === "paid") throw new Error("Ese pago ya está registrado como pagado.");
      const amount = td.amountPerQuincena;
      if (!(amount > 0)) throw new Error("La tanda no tiene un importe de pago válido.");
      const token = requireMpToken();
      const payerEmail = (part.email || "").trim() || ctx.user.email;
      const externalReference = mpExternalReference(args.tandaId, args.quincenaIndex, ctx.user.id);
      const { orderId, checkoutUrl } = await mpCreateOrder(token, { amount, externalReference, title: `Tanda ${td.name} ronda ${args.quincenaIndex + 1}`, payerEmail });
      return { ok: true, orderId, checkoutUrl, amount, externalReference };
    },
  }),
  checkMercadoPagoOrder: defineAction({
    description: "Consulta en Mercado Pago el estado de una orden creada para un pago de tanda y, solo si el pago está aprobado y el importe coincide con el de la tanda, marca ese pago como pagado (el organizador aún lo verifica). Es el respaldo cuando el webhook no llegó.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), orderId: z.string().min(1) }),
    response: z.object({ ok: z.literal(true), status: z.string(), paid: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; status: string; paid: boolean }> {
      await rateLimit("checkMercadoPagoOrder", 10, 60_000);
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId);
      if (!acc.isAdmin && acc.rank < 3 && acc.participantId !== args.participantId) throw new Error("No tiene permiso para esta acción.");
      const token = requireMpToken();
      const order = await mpGetOrder(token, args.orderId);
      // La orden debe ser la de este pago de tanda (misma tanda y mismo
      // periodo); si no, no se marca nada.
      const ref = parseMpExternalReference(order.externalReference ?? "");
      if (!ref || ref.tandaId !== args.tandaId || ref.quincenaIndex !== args.quincenaIndex) throw new Error("Esa orden no corresponde a este pago.");
      if (!order.approved) return { ok: true, status: order.status, paid: false };
      const res = await mpMarkPaidFromReference({
        tandaId: args.tandaId,
        quincenaIndex: args.quincenaIndex,
        participantId: args.participantId,
        payerEmail: order.payerEmail ?? order.approved.payerEmail,
        payerUserId: ref.userId,
        paidDate: order.approved.paidDate,
        approvedAmount: order.approved.amount,
      });
      if (res.marked) await logActivity(ctx, args.householdId, "Pago de tanda por Mercado Pago", `Tanda ${args.tandaId} · periodo ${args.quincenaIndex + 1}`);
      return { ok: true, status: order.status, paid: res.marked || res.reason === "already_paid" };
    },
  }),
  verifyTandaPayment: defineAction({
    description: "Organizer verifies (or removes verification of) a tanda payment after reviewing its proof: verified=1 marks the payment as verified in the interface.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), verified: z.boolean() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaRank(acc, 2);
      const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = rows.find(r=>r.participantId===args.participantId && r.quincenaIndex===args.quincenaIndex);
      const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
      if (mine) { await db.update(schema.tandaPayments).set({ verified: args.verified?1:0, ...(args.verified?{ status: "paid" as const, paidDate: mine.paidDate || todayStr }:{}) }).where(eq(schema.tandaPayments.id, mine.id)); await logActivity(ctx, args.householdId, args.verified?"Pago de tanda verificado":"Verificación de pago retirada", `Tanda ${args.tandaId} · periodo ${args.quincenaIndex+1}`); ctx.invalidateQueries(); return { ok: true, id: mine.id }; }
      if (!args.verified) throw new Error("Ese pago aún no ha sido registrado.");
      const [r] = await db.insert(schema.tandaPayments).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, status: "paid", paidDate: todayStr, verified: 1 }).returning({ id: schema.tandaPayments.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  createTandaInvitation: defineAction({
    description: "Invites someone by email to a specific tanda and sends the invite email with a direct link (single-use token, 7 days). Invitees can view the tanda, its participants and its calendar in the application. Reuses an existing pending invitation instead of erroring.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), email: z.string().email(), invitedName: z.string().optional() }),
    response: z.object({ ok: z.literal(true), id: z.number().optional(), reused: z.boolean(), emailSent: z.boolean(), emailConfigured: z.boolean(), inviteUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; id?: number; reused: boolean; emailSent: boolean; emailConfigured: boolean; inviteUrl: string }> {
      await rateLimit("createTandaInvitation", 30, 60_000);
      const db = ctx.db;
      const email = args.email.trim().toLowerCase();
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaRank(acc, 3);
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); if (!tdRows[0]) throw new Error("Tanda no encontrada");
      const tandaName = tdRows[0].name;
      const mail = {
        subject: `Invitación para participar en la tanda ${tandaName} en SyncFinanzas`,
        heading: `Usted fue invitado a participar en la tanda ${tandaName}`,
        bodyHtml: `<p>Usted recibió una invitación para participar en la tanda <b>${tandaName}</b> en SyncFinanzas.</p><p>Al aceptar, se incorporará como participante visible para todos, con el calendario de entregas, los comprobantes verificados y la calificación del organizador.</p>`,
        bodyText: `Usted recibió una invitación para participar en la tanda ${tandaName} en SyncFinanzas. Al aceptar, se incorporará como participante visible para todos.`,
      };
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      if (parts.some(p=>(p.email||"").toLowerCase()===email)) throw new Error("Esa persona ya participa en esta tanda.");
      const existing = await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.tandaId, args.tandaId));
      const pending = existing.find(i=>i.email.toLowerCase()===email && i.status==="pending");
      if (pending) {
        const sent = await sendInviteForToken(ctx, "tanda", { email, householdId: args.householdId, tandaId: args.tandaId, tandaInvitationId: pending.id, invitedName: pending.invitedName ?? args.invitedName }, mail);
        ctx.invalidateQueries(); return { ok: true, id: pending.id, reused: true, emailSent: sent.emailSent, emailConfigured: sent.emailConfigured, inviteUrl: sent.inviteUrl };
      }
      const [r] = await db.insert(schema.tandaInvitations).values({ householdId: args.householdId, tandaId: args.tandaId, email, invitedName: args.invitedName || null, status: "pending" }).returning({ id: schema.tandaInvitations.id });
      const sent = await sendInviteForToken(ctx, "tanda", { email, householdId: args.householdId, tandaId: args.tandaId, tandaInvitationId: r?.id ?? null, invitedName: args.invitedName }, mail);
      ctx.invalidateQueries(); return { ok: true, id: r?.id, reused: false, emailSent: sent.emailSent, emailConfigured: sent.emailConfigured, inviteUrl: sent.inviteUrl };
    },
  }),
  respondTandaInvitation: defineAction({
    description: "Accepts or rejects a tanda invitation. Accepting adds the person as a visible participant of that tanda with the name they choose (never taken from their email), and also brings them into the tanda's household (member profile + membership), like accepting a household invitation: without membership they would never see the tanda.",
    request: z.object({ id: z.number(), accept: z.boolean(), name: z.string().optional() }),
    response: z.object({ ok: z.literal(true), participantId: z.number().optional(), tandaId: z.number().optional(), householdId: z.number().optional() }),
    async handler(ctx, args): Promise<{ ok: true; participantId?: number; tandaId?: number; householdId?: number }> {
      const db = ctx.db;
      const rows = await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.id, args.id));
      const inv = rows[0]; if (!inv) throw new Error("Invitación de tanda no encontrada.");
      if (inv.status !== "pending") throw new Error("Esta invitación ya fue respondida.");
      if (inv.email.toLowerCase() !== ctx.user.email.toLowerCase()) throw new Error("Esta invitación de tanda fue enviada a otro correo electrónico. Inicie sesión con el correo invitado.");
      if (!args.accept) { await db.update(schema.tandaInvitations).set({ status: "rejected" }).where(eq(schema.tandaInvitations.id, args.id)); await markTokensForInvitation(db, null, inv.id, "rejected"); ctx.invalidateQueries(); return { ok: true, tandaId: inv.tandaId }; }
      const name = (args.name || inv.invitedName || "").trim();
      if (!name) throw new Error("Escriba el nombre con el que participará en la tanda.");
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, inv.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, inv.tandaId));
      let participantId = parts.find(p=>(p.email||"").toLowerCase()===inv.email.toLowerCase())?.id;
      if (!participantId) {
        if (parts.length >= td.participantCount) throw new Error("La tanda ya está llena.");
        const nowD = new Date(); const joined = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
        const [r] = await db.insert(schema.tandaParticipants).values({ householdId: inv.householdId, tandaId: inv.tandaId, name, email: inv.email, joinedDate: joined }).returning({ id: schema.tandaParticipants.id });
        participantId = r?.id;
      }
      await db.update(schema.tandaInvitations).set({ status: "accepted" }).where(eq(schema.tandaInvitations.id, args.id));
      await markTokensForInvitation(db, null, inv.id, "accepted");
      // Al aceptar, la persona entra al hogar de la tanda (perfil de
      // integrante + membresía), igual que al aceptar una invitación al
      // hogar: sin membresía nunca vería la tanda, porque el hogar se
      // resuelve desde household_members.
      const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, inv.householdId));
      const already = profs.find(pr=>(pr.email||"").toLowerCase()===inv.email.toLowerCase());
      let profileId = already?.id;
      if (!already) {
        const [firstWord, ...rest] = name.split(/\s+/);
        const first = firstWord || name;
        const [r] = await db.insert(schema.profiles).values({ householdId: inv.householdId, userId: ctx.user.id, name: first, lastName: rest.join(" ") || null, role: "member", email: inv.email, kind: "adult", monthlyIncome: 0, fixedCommitments: 0 }).returning({ id: schema.profiles.id });
        profileId = r?.id;
      }
      if (profileId) {
        await db.update(schema.profiles).set({ userId: ctx.user.id }).where(eq(schema.profiles.id, profileId));
        const existingMember = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.householdId, inv.householdId));
        if (!existingMember.some(m => m.userId === ctx.user.id)) {
          await db.insert(schema.householdMembers).values({ householdId: inv.householdId, userId: ctx.user.id, profileId, role: "member" });
        }
      }
      await logActivity(ctx, inv.householdId, "Nuevo participante en la tanda", `${name} · ${td.name}`);
      await notifyHousehold(ctx, inv.householdId, { type: "nuevo_integrante", title: "Nuevo participante en la tanda", body: `${name} se unió a la tanda ${td.name}.`, target: "tandas" }, ctx.user.id);
      ctx.invalidateQueries(); return { ok: true, participantId, tandaId: inv.tandaId, householdId: inv.householdId };
    },
  }),
  rateOrganizer: defineAction({
    description: "Rates a tanda organizer 1-5 stars for trust/administration. Ratings aggregate across all tandas of the same organizer in the space.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), raterName: z.string().min(1), stars: z.number().int().min(1).max(5), comment: z.string().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaParticipant(acc);
      // La calificación queda a nombre del participante que califica.
      let raterName = args.raterName.trim();
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      const myPart = acc.participantId != null ? parts.find(p=>p.id===acc.participantId) : null;
      if (myPart) raterName = myPart.name;
      else if (acc.profileId != null) { const pr = await db.select().from(schema.profiles).where(eq(schema.profiles.id, acc.profileId)); if (pr[0]) raterName = `${pr[0].name} ${pr[0].lastName || ""}`.trim(); }
      const [r] = await db.insert(schema.organizerRatings).values({ householdId: args.householdId, tandaId: args.tandaId, raterName, stars: args.stars, comment: args.comment?.trim() || null }).returning({ id: schema.organizerRatings.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  sendTandaReminder: defineAction({
    description: "Marks a payment reminder as sent for a pending tanda payment (in-app record, no external message is sent).",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaRank(acc, 2);
      const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = rows.find(r=>r.participantId===args.participantId && r.quincenaIndex===args.quincenaIndex);
      if (mine) { await db.update(schema.tandaPayments).set({ reminderSent: 1 }).where(eq(schema.tandaPayments.id, mine.id)); ctx.invalidateQueries(); return { ok: true, id: mine.id }; }
      const [r] = await db.insert(schema.tandaPayments).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, status: "pending", reminderSent: 1 }).returning({ id: schema.tandaPayments.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),

  // ---- Tandas v3 ("modo Compartamos"): roles, multas, votaciones,
  // confirmación doble de entrega y fondos separados. Sin intereses.
  setTandaRole: defineAction({
    description: "Assigns a group role to a tanda participant: organizador, tesorero, suplente or participante. Only one tesorero and one suplente per tanda.",
    request: z.object({ tandaId: z.number(), participantId: z.number(), role: z.enum(["organizador","tesorero","suplente","participante"]) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaRank(acc, 3);
      // Sincroniza los campos organizador/tesorero/suplente de la tanda con
      // los roles de las filas de participante, para que las dos fuentes no
      // se contradigan al resolver el rol de alguien.
      const profileIdFor = async (participantId: number): Promise<number | null> => {
        const prs = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.id, participantId));
        const email = (prs[0]?.email || "").trim().toLowerCase();
        if (!email) return null;
        const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, acc.tanda.householdId));
        return profs.find(p => (p.email || "").trim().toLowerCase() === email)?.id ?? null;
      };
      const syncRoleField = async (participantId: number, role: TandaRole) => {
        const pid = await profileIdFor(participantId);
        if (pid == null) return;
        const td = acc.tanda;
        if (role === "organizador" && td.organizerProfileId !== pid) await db.update(schema.tandas).set({ organizerProfileId: pid }).where(eq(schema.tandas.id, args.tandaId));
        if (role === "tesorero" && td.treasurerProfileId !== pid) await db.update(schema.tandas).set({ treasurerProfileId: pid }).where(eq(schema.tandas.id, args.tandaId));
        if (role === "suplente" && td.substituteProfileId !== pid) await db.update(schema.tandas).set({ substituteProfileId: pid }).where(eq(schema.tandas.id, args.tandaId));
        if (role === "participante") {
          if (td.organizerProfileId === pid) await db.update(schema.tandas).set({ organizerProfileId: null }).where(eq(schema.tandas.id, args.tandaId));
          if (td.treasurerProfileId === pid) await db.update(schema.tandas).set({ treasurerProfileId: null }).where(eq(schema.tandas.id, args.tandaId));
          if (td.substituteProfileId === pid) await db.update(schema.tandas).set({ substituteProfileId: null }).where(eq(schema.tandas.id, args.tandaId));
        }
      };
      if (args.role === "tesorero" || args.role === "suplente") {
        const others = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
        for (const o of others) { if (o.id !== args.participantId && o.role === args.role) { await db.update(schema.tandaParticipants).set({ role: "participante" }).where(eq(schema.tandaParticipants.id, o.id)); await syncRoleField(o.id, "participante"); } }
      }
      await db.update(schema.tandaParticipants).set({ role: args.role }).where(eq(schema.tandaParticipants.id, args.participantId));
      await syncRoleField(args.participantId, args.role);
      ctx.invalidateQueries(); return { ok: true, id: args.participantId };
    },
  }),
  addTandaFine: defineAction({
    description: "Applies a fine to a participant for one period (retardo or falta). The amount defaults to the tanda's configured fine.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), amount: z.number().positive().optional(), reason: z.enum(["retardo","falta"]).default("retardo") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaRank(acc, 2);
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const amount = args.amount ?? td.fineAmount ?? 0;
      if (amount <= 0) throw new Error("Esta tanda no tiene multa configurada. Escriba el monto de la multa.");
      const [r] = await db.insert(schema.tandaFines).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, amount, reason: args.reason, status: "pendiente" }).returning({ id: schema.tandaFines.id });
      await logActivity(ctx, args.householdId, "Multa de tanda aplicada", `Tanda ${args.tandaId} · periodo ${args.quincenaIndex+1} · $${amount.toLocaleString("es-MX")}`);
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  payTandaFine: defineAction({
    description: "Marks a tanda fine as paid and records it in the separate fines balance.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), fineId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const rows = await db.select().from(schema.tandaFines).where(eq(schema.tandaFines.id, args.fineId)); const f = rows[0]; if (!f) throw new Error("Multa no encontrada");
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId);
      // La multa la paga el propio multado, o la cobra el tesorero, el
      // suplente, el organizador o el administrador.
      if (!acc.isAdmin && acc.rank < 2 && acc.participantId !== f.participantId) throw new Error("No tiene permiso para esta acción.");
      if (f.status === "pagada") return { ok: true, id: f.id };
      await db.update(schema.tandaFines).set({ status: "pagada" }).where(eq(schema.tandaFines.id, args.fineId));
      await db.insert(schema.tandaFundEntries).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: f.participantId, kind: "multa", amount: f.amount, note: `Pago de multa · periodo ${f.quincenaIndex+1}` });
      ctx.invalidateQueries(); return { ok: true, id: f.id };
    },
  }),
  voteExcludeParticipant: defineAction({
    description: "Votes to exclude a participant from a tanda. When more than half of the active participants vote to exclude, the participant is excluded and stops appearing in the attendance list.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), targetParticipantId: z.number(), voterName: z.string().min(1), vote: z.enum(["excluir","no"]).default("excluir"), reason: z.string().optional() }),
    response: z.object({ ok: z.literal(true), excluded: z.boolean(), votesFor: z.number(), votesTotal: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; excluded: boolean; votesFor: number; votesTotal: number }> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaParticipant(acc);
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      const target = parts.find(p=>p.id===args.targetParticipantId); if (!target) throw new Error("Participante no encontrado");
      // El voto queda a nombre del participante que vota (no del texto libre
      // del cliente), para que nadie vote haciéndose pasar por otro.
      let voterName = args.voterName.trim();
      const myPart = acc.participantId != null ? parts.find(p=>p.id===acc.participantId) : null;
      if (myPart) voterName = myPart.name;
      else if (acc.profileId != null) { const pr = await db.select().from(schema.profiles).where(eq(schema.profiles.id, acc.profileId)); if (pr[0]) voterName = `${pr[0].name} ${pr[0].lastName || ""}`.trim(); }
      const existing = await db.select().from(schema.tandaVotes).where(eq(schema.tandaVotes.tandaId, args.tandaId));
      const mine = existing.find(v=>v.targetParticipantId===args.targetParticipantId && v.voterName.trim().toLowerCase()===voterName.toLowerCase());
      if (mine) { await db.update(schema.tandaVotes).set({ vote: args.vote, reason: args.reason?.trim() || null }).where(eq(schema.tandaVotes.id, mine.id)); }
      else { await db.insert(schema.tandaVotes).values({ householdId: args.householdId, tandaId: args.tandaId, targetParticipantId: args.targetParticipantId, voterName, vote: args.vote, reason: args.reason?.trim() || null }); }
      const votes = await db.select().from(schema.tandaVotes).where(eq(schema.tandaVotes.tandaId, args.tandaId));
      const forVotes = votes.filter(v=>v.targetParticipantId===args.targetParticipantId && v.vote==="excluir").length;
      const active = parts.filter(p=>!p.excluded).length;
      const excluded = forVotes > Math.floor(active / 2);
      if (excluded && !target.excluded) { await db.update(schema.tandaParticipants).set({ excluded: 1 }).where(eq(schema.tandaParticipants.id, args.targetParticipantId)); await logActivity(ctx, args.householdId, "Participante excluido de la tanda por votación", `Tanda ${args.tandaId} · ${target.name}`); }
      ctx.invalidateQueries(); return { ok: true, excluded, votesFor: forVotes, votesTotal: active };
    },
  }),
  confirmTandaDelivery: defineAction({
    description: "Double confirmation that a tanda pot was delivered for one period: the organizer confirms delivery and the receiver confirms receipt. Both confirmations are recorded separately.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), quincenaIndex: z.number().int().min(0), receiverId: z.number().nullable().optional(), by: z.enum(["organizador","receptor"]) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId);
      if (args.by === "organizador") requireTandaRank(acc, 2);
      // Recepción: solo quien recibe ese periodo (o el administrador).
      else if (!acc.isAdmin && acc.participantId !== args.receiverId) throw new Error("No tiene permiso para esta acción.");
      const now = new Date();
      const rows = await db.select().from(schema.tandaDeliveries).where(eq(schema.tandaDeliveries.tandaId, args.tandaId));
      const mine = rows.find(r=>r.quincenaIndex===args.quincenaIndex);
      if (mine) {
        await db.update(schema.tandaDeliveries).set(args.by==="organizador" ? { organizerConfirmed: 1, organizerConfirmedAt: now } : { receiverConfirmed: 1, receiverConfirmedAt: now }).where(eq(schema.tandaDeliveries.id, mine.id));
        ctx.invalidateQueries(); return { ok: true, id: mine.id };
      }
      const [r] = await db.insert(schema.tandaDeliveries).values({ householdId: args.householdId, tandaId: args.tandaId, quincenaIndex: args.quincenaIndex, receiverId: args.receiverId ?? null, organizerConfirmed: args.by==="organizador" ? 1 : 0, receiverConfirmed: args.by==="receptor" ? 1 : 0, organizerConfirmedAt: args.by==="organizador" ? now : null, receiverConfirmedAt: args.by==="receptor" ? now : null }).returning({ id: schema.tandaDeliveries.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  addTandaFundEntry: defineAction({
    description: "Records a separate-balance movement for a tanda: aportación, fondo solidario or multa payment. Balances are shown separately in the tanda view.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number().nullable().optional(), kind: z.enum(["aportacion","fondo","multa"]), amount: z.number().positive(), note: z.string().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const acc = await tandaAccess(ctx, args.tandaId); requireTandaHousehold(acc, args.householdId); requireTandaRank(acc, 2);
      const [r] = await db.insert(schema.tandaFundEntries).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId ?? null, kind: args.kind, amount: args.amount, note: args.note?.trim() || null }).returning({ id: schema.tandaFundEntries.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),

  resetAllData: defineAction({
    description: "Deletes the household completely and returns the user to the very beginning: permanently deletes every record of the household (movements and their reversals, accounts, budgets, funds and their movements, goals, agreements and their votes, patrimony, tandas with their participants, payments, invitations and organizer ratings, household invitations, all profiles, all categories, the activity log and the in-app notifications), the stored receipt and tanda-proof photo files, the household memberships and the household itself. The user keeps only their login session and lands again on the onboarding screen to choose Personal or Familiar mode. Irreversible.",
    request: z.object({ householdId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      await rateLimit("resetAllData", 5, 60_000);
      const db = ctx.db;
      const hid = args.householdId;
      const hhRows = await db.select().from(schema.households).where(eq(schema.households.id, hid));
      if (!hhRows[0]) throw new Error("No se encontró el hogar indicado.");

      // Los votos de acuerdos no llevan householdId: se eliminan por cada acuerdo del hogar.
      const ags = await db.select().from(schema.agreements).where(eq(schema.agreements.householdId, hid));
      for (const a of ags) await db.delete(schema.agreementVotes).where(eq(schema.agreementVotes.agreementId, a.id));

      await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.householdId, hid));
      try { await db.delete(schema.tandaFines).where(eq(schema.tandaFines.householdId, hid)); await db.delete(schema.tandaVotes).where(eq(schema.tandaVotes.householdId, hid)); await db.delete(schema.tandaDeliveries).where(eq(schema.tandaDeliveries.householdId, hid)); await db.delete(schema.tandaFundEntries).where(eq(schema.tandaFundEntries.householdId, hid)); } catch { /* tablas v3 aún no creadas */ }
      await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.householdId, hid));
      await db.delete(schema.tandaInvitations).where(eq(schema.tandaInvitations.householdId, hid));
      await db.delete(schema.organizerRatings).where(eq(schema.organizerRatings.householdId, hid));
      await db.delete(schema.tandas).where(eq(schema.tandas.householdId, hid));
      await db.delete(schema.movements).where(eq(schema.movements.householdId, hid));
      try { await db.delete(schema.goalPlans).where(eq(schema.goalPlans.householdId, hid)); } catch { /* tabla aún no creada */ }
      try { await db.delete(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.householdId, hid)); } catch { /* tabla aún no creada */ }
      try { const ccs = await db.select({ id: schema.cashCounts.id }).from(schema.cashCounts).where(eq(schema.cashCounts.householdId, hid)); for (const c of ccs) await db.delete(schema.cashCountLines).where(eq(schema.cashCountLines.countId, c.id)); await db.delete(schema.cashCounts).where(eq(schema.cashCounts.householdId, hid)); } catch { /* tablas aún no creadas */ }
      await db.delete(schema.fundMovements).where(eq(schema.fundMovements.householdId, hid));
      await db.delete(schema.funds).where(eq(schema.funds.householdId, hid));
      await db.delete(schema.budgets).where(eq(schema.budgets.householdId, hid));
      await db.delete(schema.goals).where(eq(schema.goals.householdId, hid));
      await db.delete(schema.agreements).where(eq(schema.agreements.householdId, hid));
      await db.delete(schema.patrimonyItems).where(eq(schema.patrimonyItems.householdId, hid));
      await db.delete(schema.accounts).where(eq(schema.accounts.householdId, hid));
      await db.delete(schema.invitations).where(eq(schema.invitations.householdId, hid));
      await db.delete(schema.invitationTokens).where(eq(schema.invitationTokens.householdId, hid));
      await db.delete(schema.categories).where(eq(schema.categories.householdId, hid));
      await db.delete(schema.activityLog).where(eq(schema.activityLog.householdId, hid));
      // Los avisos del hogar (tabla notifications, FK a households): se
      // borran antes del hogar, o el borrado del hogar falla con 23503.
      // Si la tabla aún no existe (falta correr notifications.sql), el
      // reinicio sigue igual que antes: sin avisos que borrar.
      try { await db.delete(schema.notifications).where(eq(schema.notifications.householdId, hid)); } catch { /* tabla aún no creada */ }

      // Las fotografías guardadas (comprobantes de movimientos y comprobantes de pago de tandas)
      // también se eliminan: el reinicio es completo, sin archivos huérfanos.
      for (const prefix of [`receipts/${hid}/`, `tanda-proofs/${hid}/`]) {
        try { const metas = await ctx.blobs.list(prefix); for (const m of metas) { try { await ctx.blobs.delete(m.key); } catch { /* el archivo ya no existía */ } } } catch { /* sin archivos que eliminar */ }
      }

      // Al final se borra el hogar completo: todos los perfiles, la membresía
      // y el hogar. El usuario conserva solo su sesión y vuelve a la pantalla
      // inicial para elegir de nuevo Personal o Familiar.
      await db.delete(schema.profiles).where(eq(schema.profiles.householdId, hid));
      await db.delete(schema.householdMembers).where(eq(schema.householdMembers.householdId, hid));
      await db.delete(schema.households).where(eq(schema.households.id, hid));

      ctx.invalidateQueries();
      return { ok: true, id: hid };
    },
  }),

  loadDemo: defineAction({
    description: "Loads clearly-labeled demo data into an empty household so the user can see the app full. Deletable by creating real data.",
    request: z.object({ householdId: z.number() }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const movs=await db.select().from(schema.movements).where(eq(schema.movements.householdId,args.householdId)); if(movs.length>0) throw new Error("La demo solo se carga en un hogar sin movimientos.");
      const profs=await db.select().from(schema.profiles).where(eq(schema.profiles.householdId,args.householdId)); const p0=profs[0]; if(!p0) throw new Error("Primero cree un perfil.");
      let p1Id=p0.id; const adults=profs.filter(p=>p.kind==="adult"); if(adults.length<2){ const [np]=await db.insert(schema.profiles).values({householdId:args.householdId,name:"Pareja (demo)",kind:"adult",monthlyIncome:28000,fixedCommitments:6000}).returning({id:schema.profiles.id}); if(np) p1Id=np.id; await db.update(schema.profiles).set({monthlyIncome:35000,fixedCommitments:8000}).where(eq(schema.profiles.id,p0.id)); } else { p1Id=adults[1]!.id; }
      void p1Id;
      const [acc]=await db.insert(schema.accounts).values({householdId:args.householdId,name:"Cuenta conjunta (demo)",type:"bank",visibility:"shared",initialBalance:18500}).returning({id:schema.accounts.id});
      const [acc2]=await db.insert(schema.accounts).values({householdId:args.householdId,name:"Efectivo (demo)",type:"cash",visibility:"shared",initialBalance:1200}).returning({id:schema.accounts.id});
      if(!acc||!acc2) throw new Error("Demo: cuentas");
      const cats=await db.select().from(schema.categories).where(eq(schema.categories.householdId,args.householdId));
      const cat=(n:string)=>cats.find(c=>c.name===n)?.id??null;
      const today=new Date(); const ym=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`; const d=(day:number)=>`${ym}-${String(Math.min(day,28)).padStart(2,"0")}`;
      const demoMovs=[
        {type:"income" as const,amount:35000,concept:"Nómina (demo)",accountId:acc.id,categoryId:cat("Salario"),subcategory:"Nómina",date:d(1),visibility:"shared" as const,profileId:p0.id,householdId:args.householdId,toAccountId:null},
        {type:"income" as const,amount:28000,concept:"Nómina pareja (demo)",accountId:acc.id,categoryId:cat("Salario"),subcategory:"Nómina",date:d(1),visibility:"shared" as const,profileId:p1Id,householdId:args.householdId,toAccountId:null},
        {type:"expense" as const,amount:8500,concept:"Renta (demo)",accountId:acc.id,categoryId:cat("Vivienda"),subcategory:"Renta/Hipoteca",date:d(3),visibility:"shared" as const,profileId:p0.id,householdId:args.householdId,toAccountId:null},
        {type:"expense" as const,amount:4200,concept:"Súper (demo)",accountId:acc.id,categoryId:cat("Alimentación"),subcategory:"Súper",date:d(5),visibility:"shared" as const,profileId:p0.id,householdId:args.householdId,toAccountId:null},
        {type:"expense" as const,amount:950,concept:"Luz + internet (demo)",accountId:acc.id,categoryId:cat("Servicios"),subcategory:"Luz",date:d(6),visibility:"shared" as const,profileId:p0.id,householdId:args.householdId,toAccountId:null},
        {type:"expense" as const,amount:600,concept:"Gasolina (demo)",accountId:acc2.id,categoryId:cat("Transporte"),subcategory:"Gasolina",date:d(7),visibility:"private" as const,profileId:p0.id,householdId:args.householdId,toAccountId:null},
      ];
      for(const m of demoMovs) await db.insert(schema.movements).values(m);
      const alim=cat("Alimentación"); if(alim) await db.insert(schema.budgets).values({householdId:args.householdId,categoryId:alim,month:ym,amount:6000,visibility:"shared"});
      const viv=cat("Vivienda"); if(viv) await db.insert(schema.budgets).values({householdId:args.householdId,categoryId:viv,month:ym,amount:9000,visibility:"shared"});
      const [fund]=await db.insert(schema.funds).values({householdId:args.householdId,name:"Fondo de emergencia (demo)",targetAmount:50000,visibility:"shared"}).returning({id:schema.funds.id});
      if(fund) await db.insert(schema.fundMovements).values({householdId:args.householdId,fundId:fund.id,type:"contribution",amount:8000,date:d(2),note:"Apartado demo"} as never);
      await db.insert(schema.goals).values({householdId:args.householdId,name:"Vacaciones (demo)",targetAmount:30000,savedAmount:7500,targetDate:`${today.getFullYear()+1}-06-15`,visibility:"shared"});
      await db.insert(schema.patrimonyItems).values({householdId:args.householdId,name:"Departamento (demo)",kind:"asset",category:"Inmueble",value:850000,owner:"Compartido"});
      await db.insert(schema.patrimonyItems).values({householdId:args.householdId,name:"Auto (demo)",kind:"asset",category:"Vehículo",value:180000,owner:"Compartido"});
      await db.insert(schema.patrimonyItems).values({householdId:args.householdId,name:"Hipoteca (demo)",kind:"liability",category:"Crédito",value:420000,owner:"Compartido"});
      await db.insert(schema.agreements).values({householdId:args.householdId,title:"Gastos mayores a $1,500 se aprueban entre los dos (demo)",description:"Regla de ejemplo de la versión demo.",status:"proposal"});
      ctx.invalidateQueries(); return {ok:true};
    },
  }),

  // Opiniones de los testers (segunda etapa): solo el administrador del hogar
  // las revisa, en la pestaña Hogar. Lee la tabla tester_feedback (creada con
  // supabase/feedback.sql). Sin edición ni borrado por ahora. El despachador
  // (api/actions.ts) ya exige membresía por householdId y rol de administrador.
  listTesterFeedback: defineAction({
    description: "Lists the testers' feedback for the app owner, newest first.",
    request: z.object({ householdId: z.number() }),
    response: z.object({ feedback: z.array(z.object({ id: z.number(), createdAt: z.string(), nombre: z.string().nullable(), correo: z.string().nullable(), calificacionGeneral: z.number(), facilidadUso: z.number(), queFunciono: z.string().nullable(), queFallo: z.string().nullable(), sugerencia: z.string().nullable(), modulo: z.string().nullable(), dispositivo: z.string().nullable() })) }),
    async handler(ctx) {
      if (!isAppOwner(ctx)) throw new Error("Solo el dueño de la app puede revisar las opiniones de los testers.");
      const rows = await ctx.db.select().from(schema.testerFeedback).orderBy(desc(schema.testerFeedback.createdAt)).limit(100);
      return { feedback: rows.map(r => ({ id: r.id, createdAt: r.createdAt.toISOString(), nombre: r.nombre, correo: r.correo, calificacionGeneral: r.calificacionGeneral, facilidadUso: r.facilidadUso, queFunciono: r.queFunciono, queFallo: r.queFallo, sugerencia: r.sugerencia, modulo: r.modulo, dispositivo: r.dispositivo })) };
    },
  }),
  // Registro de usuarios de la app (para revisar cuántos usuarios hay):
  // consulta los usuarios de Supabase Auth desde el servidor (clave de
  // servicio, paginado) y los combina con los perfiles de la app para el
  // nombre. Solo el dueño de la app puede consultarlo. Un usuario sin perfil
  // aparece igual, con su correo y sus fechas: lo que se cuenta es quién ha
  // entrado a la app, no solo quién está en un hogar.
  listAppUsers: defineAction({
    description: "Lists the app users from Supabase Auth, newest first, with registration date and last sign-in.",
    request: z.object({ householdId: z.number().optional() }),
    response: z.object({ total: z.number(), users: z.array(z.object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable(), createdAt: z.string(), lastSignInAt: z.string().nullable() })) }),
    async handler(ctx) {
      if (!isAppOwner(ctx)) throw new Error("Solo el dueño de la app puede revisar los usuarios de la app.");
      const admin = supabaseAdmin();
      const all: { id: string; email?: string | null; created_at: string; last_sign_in_at?: string | null; user_metadata?: Record<string, unknown> }[] = [];
      let page = 1;
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw new Error("No se pudo consultar los usuarios de la app.");
        const users = data.users ?? [];
        all.push(...users);
        if (users.length < 100 || page >= 100) break;
        page++;
      }
      const ids = all.map(u => u.id);
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const rows = await ctx.db.select().from(schema.profiles).where(inArray(schema.profiles.userId, ids));
        for (const r of rows) if (r.userId && r.name) names.set(r.userId, r.name);
      }
      const users = all.map(u => ({
        id: u.id,
        name: names.get(u.id) ?? (typeof u.user_metadata?.name === "string" ? (u.user_metadata.name as string) : null),
        email: u.email ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
      })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { total: users.length, users };
    },
  }),
  // Arqueo de cuentas (auditoría): recuento de lo que dice la app contra
  // lo contado en físico, por cada cuenta y en efectivo. El arqueo solo
  // muestra la diferencia; nunca cambia los saldos. Las líneas se guardan
  // con el saldo que decía la app al momento del arqueo. Solo el
  // administrador hace el arqueo en modo Familiar (lo verifica también el
  // despachador por membresía). Si falta correr supabase/cash-counts.sql,
  // guardar avisa y la lista sale vacía, sin romper la app.
  saveCashCount: defineAction({
    description: "Guarda un arqueo de cuentas: compara lo contado en físico con el saldo que dice la app, por cada cuenta y en efectivo, y guarda la diferencia sin cambiar los saldos. El renglón de efectivo compara el restante del sueldo (ingreso registrado menos lo gastado en el mes) con lo contado en físico; si no hay ingreso registrado, se compara contra el saldo en efectivo según la app.",
    request: z.object({ householdId: z.number(), lines: z.array(z.object({ accountId: z.number().nullable(), counted: z.number().min(0).max(999999999) })).min(1).max(100), note: z.string().max(200).default("") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      await rateLimit("saveCashCount", 10, 60_000);
      const db = ctx.db;
      await requireCashCountAdmin(ctx, args.householdId);
      const balances = await appBalancesForHousehold(db, args.householdId);
      const byId = new Map(balances.rows.map(r => [r.accountId, r]));
      const seen = new Set<string>();
      const lines = args.lines.map(l => {
        const key = l.accountId == null ? "cash" : `acc-${l.accountId}`;
        if (seen.has(key)) throw new Error("Una cuenta aparece dos veces en el arqueo.");
        seen.add(key);
        const appBalance = l.accountId == null ? (balances.hasSalaryIncome ? balances.salaryRemaining : balances.cashApp) : byId.get(l.accountId)?.appBalance;
        if (appBalance == null) throw new Error("Una de las cuentas no pertenece a este hogar.");
        const counted = Math.round(l.counted * 100) / 100;
        return { accountId: l.accountId, accountName: l.accountId == null ? (balances.hasSalaryIncome ? "Efectivo (restante del sueldo)" : "Efectivo") : byId.get(l.accountId)!.accountName, appBalance, countedAmount: counted, difference: Math.round((counted - appBalance) * 100) / 100 };
      });
      const totalApp = Math.round(lines.reduce((s, l) => s + l.appBalance, 0) * 100) / 100;
      const totalCounted = Math.round(lines.reduce((s, l) => s + l.countedAmount, 0) * 100) / 100;
      const totalDiff = Math.round((totalCounted - totalApp) * 100) / 100;
      let countId: number;
      try {
        const [row] = await db.insert(schema.cashCounts).values({ householdId: args.householdId, createdByName: await inviterDisplayName(ctx, args.householdId), note: args.note || "", totalApp, totalCounted, totalDiff }).returning({ id: schema.cashCounts.id });
        if (!row) throw new Error("No se pudo guardar el arqueo.");
        countId = row.id;
        await db.insert(schema.cashCountLines).values(lines.map(l => ({ countId, accountId: l.accountId, accountName: l.accountName, appBalance: l.appBalance, countedAmount: l.countedAmount, difference: l.difference })));
      } catch (e) {
        if (e instanceof Error && /does not exist/i.test(e.message)) throw new Error("Para guardar el arqueo, primero ejecute supabase/cash-counts.sql en el SQL Editor de Supabase.");
        throw e;
      }
      await logActivity(ctx, args.householdId, "Arqueo de cuentas", `Diferencia total ${moneyShort(totalDiff)}`);
      ctx.invalidateQueries();
      return { ok: true, id: countId };
    },
  }),
  listCashCounts: defineAction({
    description: "Lists the saved cash counts (arqueos de efectivo) for the household, newest first, with their lines.",
    request: z.object({ householdId: z.number() }),
    response: z.object({ counts: z.array(z.object({ id: z.number(), createdAt: z.string(), createdByName: z.string(), note: z.string(), totalApp: z.number(), totalCounted: z.number(), totalDiff: z.number(), lines: z.array(z.object({ accountId: z.number().nullable(), accountName: z.string(), appBalance: z.number(), countedAmount: z.number(), difference: z.number() })) })) }),
    async handler(ctx, args) {
      await requireCashCountAdmin(ctx, args.householdId);
      try {
        const counts = await ctx.db.select().from(schema.cashCounts).where(eq(schema.cashCounts.householdId, args.householdId)).orderBy(desc(schema.cashCounts.createdAt)).limit(50);
        if (counts.length === 0) return { counts: [] };
        const lines = await ctx.db.select().from(schema.cashCountLines).where(inArray(schema.cashCountLines.countId, counts.map(c => c.id)));
        return { counts: counts.map(c => ({ id: c.id, createdAt: c.createdAt.toISOString(), createdByName: c.createdByName, note: c.note, totalApp: c.totalApp, totalCounted: c.totalCounted, totalDiff: c.totalDiff, lines: lines.filter(l => l.countId === c.id).map(l => ({ accountId: l.accountId, accountName: l.accountName, appBalance: l.appBalance, countedAmount: l.countedAmount, difference: l.difference })) })) };
      } catch { return { counts: [] }; }
    },
  }),
  // Avisos dentro de la app (campanita + insignia del icono): cada usuario
  // ve solo sus propios avisos. Si la tabla aún no existe (falta correr
  // supabase/notifications.sql), la lista sale vacía y nada se rompe.
  listNotifications: defineAction({
    description: "Lists the current user's notifications for the household, newest first, with the unread count.",
    request: z.object({ householdId: z.number() }),
    response: z.object({ notifications: z.array(z.object({ id: z.number(), type: z.string(), title: z.string(), body: z.string(), amount: z.number().nullable(), target: z.string(), isRead: z.number(), createdAt: z.string() })), unreadCount: z.number() }),
    async handler(ctx, args) {
      try {
        const rows = await ctx.db.select().from(schema.notifications).where(and(eq(schema.notifications.householdId, args.householdId), eq(schema.notifications.userId, ctx.user.id))).orderBy(desc(schema.notifications.createdAt)).limit(100);
        return { notifications: rows.map(r => ({ id: r.id, type: r.type, title: r.title, body: r.body, amount: r.amount ?? null, target: r.target, isRead: r.isRead, createdAt: r.createdAt.toISOString() })), unreadCount: rows.filter(r => !r.isRead).length };
      } catch { return { notifications: [], unreadCount: 0 }; }
    },
  }),
  markNotificationRead: defineAction({
    description: "Marks one of the current user's notifications as read.",
    request: z.object({ id: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      try { await ctx.db.update(schema.notifications).set({ isRead: 1 }).where(and(eq(schema.notifications.id, args.id), eq(schema.notifications.userId, ctx.user.id))); } catch { /* tabla aún no creada */ }
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  markAllNotificationsRead: defineAction({
    description: "Marks all of the current user's notifications in the household as read.",
    request: z.object({ householdId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      try { await ctx.db.update(schema.notifications).set({ isRead: 1 }).where(and(eq(schema.notifications.householdId, args.householdId), eq(schema.notifications.userId, ctx.user.id))); } catch { /* tabla aún no creada */ }
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  // ---- Reglas de auto-categorización y avisos periódicos ----
  listCategoryRules: defineAction({
    description: "Lists the household's auto-categorisation rules (if the concept contains the word, the category is filled automatically). Returns an empty list if the table has not been created yet.",
    request: z.object({ householdId: z.number() }),
    response: z.object({ rules: z.array(z.object({ id: z.number(), keyword: z.string(), categoryId: z.number(), categoryName: z.string(), isActive: z.number() })) }),
    async handler(ctx, args) {
      try {
        const rows = await ctx.db.select().from(schema.categoryRules).where(eq(schema.categoryRules.householdId, args.householdId)).orderBy(schema.categoryRules.id);
        const cats = await ctx.db.select().from(schema.categories).where(eq(schema.categories.householdId, args.householdId));
        return { rules: rows.map(r => ({ id: r.id, keyword: r.keyword, categoryId: r.categoryId, categoryName: cats.find(c => c.id === r.categoryId)?.name ?? "Sin categoría", isActive: r.isActive })) };
      } catch { return { rules: [] }; }
    },
  }),
  saveCategoryRule: defineAction({
    description: "Creates or updates an auto-categorisation rule (keyword → category). If the table has not been created, it explains that supabase/category-rules.sql must be run first.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), keyword: z.string().min(1).max(60), categoryId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const keyword = args.keyword.trim();
      if (!keyword) throw new Error("Escriba la palabra o frase de la regla.");
      const cats = await db.select().from(schema.categories).where(eq(schema.categories.householdId, args.householdId));
      if (!cats.some(c => c.id === args.categoryId)) throw new Error("La categoría no pertenece a este hogar.");
      try {
        if (args.id) {
          const rows = await db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, args.id)).limit(1);
          if (!rows[0] || rows[0].householdId !== args.householdId) throw new Error("Regla no encontrada.");
          await db.update(schema.categoryRules).set({ keyword, categoryId: args.categoryId }).where(eq(schema.categoryRules.id, args.id));
          ctx.invalidateQueries(); return { ok: true, id: args.id };
        }
        const [row] = await db.insert(schema.categoryRules).values({ householdId: args.householdId, keyword, categoryId: args.categoryId, isActive: 1 }).returning({ id: schema.categoryRules.id });
        if (!row) throw new Error("No se pudo guardar la regla.");
        ctx.invalidateQueries(); return { ok: true, id: row.id };
      } catch (e) {
        if (String(e).includes("does not exist")) throw new Error("Para guardar reglas, primero ejecute supabase/category-rules.sql en el SQL Editor de Supabase.");
        throw e;
      }
    },
  }),
  deleteCategoryRule: defineAction({
    description: "Deletes an auto-categorisation rule of the household.",
    request: z.object({ id: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      try { await ctx.db.delete(schema.categoryRules).where(eq(schema.categoryRules.id, args.id)); } catch { /* tabla aún no creada: no había reglas */ }
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  importMovements: defineAction({
    description: "Imports movements from a CSV file (already reviewed on screen). Duplicates (same date, concept, amount and type as an existing active movement) are skipped. No alerts are created on import.",
    request: z.object({ householdId: z.number(), movements: z.array(z.object({ type: z.enum(["income", "expense", "transfer", "debt_payment"]), amount: z.number().positive().max(100000000), concept: z.string().min(1).max(200), categoryId: z.number().nullable().optional(), subcategory: z.string().max(60).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), visibility: z.enum(["shared", "private"]).default("shared"), accountId: z.number().nullable().optional() })).min(1).max(500) }),
    response: z.object({ ok: z.boolean(), imported: z.number(), skipped: z.number(), total: z.number() }),
    async handler(ctx, args) {
      await rateLimit("importMovements", 5, 60_000);
      const db = ctx.db;
      const cats = await db.select().from(schema.categories).where(eq(schema.categories.householdId, args.householdId));
      const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.householdId, args.householdId));
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const existing = await db.select().from(schema.movements).where(eq(schema.movements.householdId, args.householdId));
      const reversedIds = new Set(existing.filter(m => m.reversalOfId != null).map(m => m.reversalOfId as number));
      const keys = new Set(existing.filter(m => m.reversalOfId == null && !reversedIds.has(m.id)).map(m => `${m.date}|${norm(m.concept)}|${m.amount}|${m.type}`));
      let imported = 0, skipped = 0;
      const values: { householdId: number; type: string; amount: number; concept: string; accountId: number | null; toAccountId: number | null; categoryId: number | null; subcategory: string | null; date: string; visibility: string; profileId: string | null }[] = [];
      for (const mv of args.movements) {
        const key = `${mv.date}|${norm(mv.concept)}|${Math.round(mv.amount * 100) / 100}|${mv.type}`;
        if (keys.has(key)) { skipped++; continue; }
        keys.add(key);
        values.push({ householdId: args.householdId, type: mv.type, amount: Math.round(mv.amount * 100) / 100, concept: mv.concept.trim(), accountId: mv.accountId != null && accs.some(a => a.id === mv.accountId) ? mv.accountId : null, toAccountId: null, categoryId: mv.categoryId != null && cats.some(c => c.id === mv.categoryId) ? mv.categoryId : null, subcategory: mv.subcategory || null, date: mv.date, visibility: mv.visibility, profileId: null });
        imported++;
      }
      if (values.length > 0) {
        await db.insert(schema.movements).values(values as never);
        await logActivity(ctx, args.householdId, "Movimientos importados", `${values.length} movimiento(s) desde CSV`);
      }
      ctx.invalidateQueries();
      return { ok: true, imported, skipped, total: args.movements.length };
    },
  }),
  checkPeriodicAlerts: defineAction({
    description: "Creates the periodic card alerts that apply today (cut-off in 3 days or less, payment after the cut-off). One per card and event per month; returns how many were created.",
    request: z.object({ householdId: z.number() }),
    response: z.object({ created: z.number() }),
    async handler(ctx, args) {
      return checkPeriodicAlerts(ctx, args.householdId);
    },
  }),
} satisfies ActionsModule;
