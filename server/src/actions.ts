import { defineAction, rateLimitDb, z, type ActionsModule, type Ctx } from "./space-shim.js";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema.js";
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
    request: z.object({}),
    response: z.object({
      household: z.object({ id: z.number(), name: z.string(), currency: z.string(), cutoffDay: z.number(), contributionRule: z.string(), approvalRule: z.string(), approvalThreshold: z.number(), mode: z.string() }).nullable(),
      profiles: z.array(z.object({ id: z.number(), name: z.string(), lastName: z.string().nullable(), role: z.string(), email: z.string().nullable(), kind: z.string(), dependentType: z.string().nullable(), monthlyIncome: z.number(), fixedCommitments: z.number(), capacity: z.number() })), invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), status: z.string(), householdName: z.string() })),
      accounts: z.array(z.object({ id: z.number(), name: z.string(), type: z.string(), visibility: z.string(), initialBalance: z.number(), balance: z.number(), ownerProfileId: z.number().nullable() })),
      categories: z.array(z.object({ id: z.number(), name: z.string(), kind: z.string(), isSystem: z.number(), isActive: z.number(), subcategories: z.array(z.string()) })),
      movements: z.array(z.object({ id: z.number(), type: z.string(), amount: z.number(), concept: z.string(), accountId: z.number().nullable(), toAccountId: z.number().nullable(), categoryId: z.number().nullable(), subcategory: z.string().nullable(), date: z.string(), visibility: z.string(), profileId: z.number().nullable(), receiptUrl: z.string().nullable(), reversalOfId: z.number().nullable(), isReversed: z.boolean() })),
      budgets: z.array(z.object({ id: z.number(), categoryId: z.number(), month: z.string(), amount: z.number(), visibility: z.string(), spent: z.number(), remaining: z.number(), pct: z.number() })),
      funds: z.array(z.object({ id: z.number(), name: z.string(), targetAmount: z.number().nullable(), visibility: z.string(), balance: z.number() })),
      fundMovements: z.array(z.object({ id: z.number(), fundId: z.number(), type: z.string(), amount: z.number(), date: z.string(), note: z.string().nullable() })),
      goals: z.array(z.object({ id: z.number(), name: z.string(), targetAmount: z.number(), savedAmount: z.number(), targetDate: z.string().nullable(), visibility: z.string(), pct: z.number() })),
      agreements: z.array(z.object({ id: z.number(), title: z.string(), description: z.string(), status: z.string(), votes: z.array(z.object({ profileId: z.number(), vote: z.string() })) })),
      patrimony: z.array(z.object({ id: z.number(), name: z.string(), kind: z.string(), category: z.string(), value: z.number(), owner: z.string().nullable() })),
      personal: z.object({ salary: z.number(), monthSpent: z.number(), remaining: z.number(), todaySpent: z.number(), todayCount: z.number(), byCategory: z.array(z.object({ categoryId: z.number().nullable(), name: z.string(), total: z.number(), pct: z.number() })), todayMovements: z.array(z.object({ id: z.number(), concept: z.string(), amount: z.number(), categoryId: z.number().nullable(), date: z.string() })) }),
      tandas: z.array(z.object({ id: z.number(), name: z.string(), participantCount: z.number(), amountPerQuincena: z.number(), startDate: z.string(), potPerQuincena: z.number(), organizerName: z.string().nullable(), organizerProfileId: z.number().nullable(), frequency: z.string(), cadenceDays: z.number(), drawMode: z.string(), organizerRating: z.object({ avg: z.number(), count: z.number() }), ratings: z.array(z.object({ id: z.number(), raterName: z.string(), stars: z.number(), comment: z.string().nullable() })), invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), status: z.string() })), participants: z.array(z.object({ id: z.number(), name: z.string(), email: z.string().nullable(), drawOrder: z.number().nullable(), cardLast4: z.string().nullable(), joinedDate: z.string().nullable(), stats: z.object({ paidCount: z.number(), dueCount: z.number(), onTimePct: z.number(), avgDaysEarly: z.number(), seniorityDays: z.number(), score: z.number() }) })), calendar: z.array(z.object({ index: z.number(), date: z.string(), receiverName: z.string().nullable(), receiverId: z.number().nullable(), amount: z.number() })), payments: z.array(z.object({ participantId: z.number(), quincenaIndex: z.number(), status: z.string(), reminderSent: z.number(), paidDate: z.string().nullable(), proofUrl: z.string().nullable(), verified: z.number() })) })),
      summary: z.object({
        totalBalance: z.number(), totalInFunds: z.number(), availableFree: z.number(),
        monthIncome: z.number(), monthExpense: z.number(), monthNet: z.number(),
        sharedExpenseMonth: z.number(), unassignedNet: z.number(), totalAssets: z.number(), totalLiabilities: z.number(), netWorth: z.number(),
        currentMonth: z.string(),
        contributions: z.array(z.object({ profileId: z.number(), name: z.string(), shouldPay: z.number(), capacity: z.number(), income: z.number(), pctShare: z.number() })),
        contributionsNote: z.string(), monthlySeries: z.array(z.object({ month: z.string(), label: z.string(), income: z.number(), expense: z.number() })),
      }),
      activity: z.array(z.object({ id: z.number(), action: z.string(), detail: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx) {
      const db = ctx.db;
      // Seguridad multiusuario: en la versión de Muse había un solo hogar por
      // espacio y se tomaba "el primero de la base". Fuera de Muse hay muchos
      // hogares; el hogar es siempre el del usuario autenticado (ctx.householdId,
      // resuelto por el despachador desde household_members). Sin membresía no
      // se devuelve ningún hogar.
      const hhRows = ctx.householdId == null ? [] : await db.select().from(schema.households).where(eq(schema.households.id, ctx.householdId)).limit(1);
      const hh = hhRows[0];
      if (!hh) {
        return {
          household: null, profiles: [], invitations: [], accounts: [], categories: [], movements: [], budgets: [], funds: [], fundMovements: [], goals: [], agreements: [], patrimony: [],
          personal: { salary: 0, monthSpent: 0, remaining: 0, todaySpent: 0, todayCount: 0, byCategory: [], todayMovements: [] }, tandas: [], activity: [], summary: { totalBalance: 0, totalInFunds: 0, availableFree: 0, monthIncome: 0, monthExpense: 0, monthNet: 0, sharedExpenseMonth: 0, unassignedNet: 0, totalAssets: 0, totalLiabilities: 0, netWorth: 0, currentMonth: new Date().toISOString().slice(0,7), contributions: [], contributionsNote: "Crea tu hogar para empezar.", monthlySeries: [] },
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

      // Reversiones: un movimiento reversado y su reversión se anulan entre sí; ninguno de los dos
      // se considera en saldos, totales, presupuestos, gráficas ni reparto. Ambos quedan visibles
      // en la lista de Movimientos con su marca, como rastro de auditoría (no se borra nada).
      const reversedIds = new Set(movsR.filter(m=>m.reversalOfId!=null).map(m=>m.reversalOfId as number));
      const activeMovs = movsR.filter(m=>m.reversalOfId==null && !reversedIds.has(m.id));

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

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      const monthMovs = activeMovs.filter(m=>m.date.startsWith(currentMonth));
      const monthIncome = monthMovs.filter(m=>m.type==="income").reduce((s,m)=>s+m.amount,0);
      const monthExpense = monthMovs.filter(m=>m.type==="expense"||m.type==="debt_payment").reduce((s,m)=>s+m.amount,0);
      const sharedExpenseMonth = monthMovs.filter(m=>(m.type==="expense"||m.type==="debt_payment") && m.visibility==="shared").reduce((s,m)=>s+m.amount,0);
      // also include shared budgets if no movements? Use max(sharedExpense, ? ) - keep sharedExpense as base, but if budgets shared total >0 and expense 0, note
      const sharedBudgetsTotal = budgetsR.filter(b=>b.month===currentMonth && b.visibility==="shared").reduce((s,b)=>s+b.amount,0);
      const baseForContributions = sharedExpenseMonth > 0 ? sharedExpenseMonth : sharedBudgetsTotal;

      const budgets = budgetsR.map(b=>{
        const spent = activeMovs.filter(m=>m.categoryId===b.categoryId && m.date.startsWith(b.month) && (m.type==="expense"||m.type==="debt_payment") && (b.visibility==="shared" ? m.visibility==="shared" || true : true)).reduce((s,m)=>s+m.amount,0);
        // Correct rule: shared budget counts shared movements; private counts all for that cat (simplified: count all matching cat/month, visibility filter: if budget shared only shared movs)
        const spentCorrect = activeMovs.filter(m=> m.categoryId===b.categoryId && m.date.startsWith(b.month) && (m.type==="expense"||m.type==="debt_payment") && (b.visibility==="shared" ? m.visibility==="shared" : m.visibility==="private")).reduce((s,m)=>s+m.amount,0);
        const useSpent = spentCorrect;
        void spent;
        return { id: b.id, categoryId: b.categoryId, month: b.month, amount: b.amount, visibility: b.visibility, spent: Math.round(useSpent*100)/100, remaining: Math.round((b.amount-useSpent)*100)/100, pct: b.amount>0? Math.min(100, Math.round(useSpent/b.amount*100)) : 0 };
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



      // ---- Monthly series (last 6 months) + movement receipt URLs ----
      const monthLabel = (ym:string)=>{ const [yy=2026,mm=1]=ym.split("-").map(Number); return new Date(yy,(mm||1)-1,1).toLocaleDateString("es-MX",{month:"short"}); };
      const monthlySeries: {month:string;label:string;income:number;expense:number}[] = [];
      for (let k=5;k>=0;k--){ const d=new Date(now.getFullYear(), now.getMonth()-k, 1); const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; const ms=activeMovs.filter(m=>m.date.startsWith(ym)); monthlySeries.push({ month: ym, label: monthLabel(ym), income: Math.round(ms.filter(m=>m.type==="income").reduce((s,m)=>s+m.amount,0)*100)/100, expense: Math.round(ms.filter(m=>m.type==="expense"||m.type==="debt_payment").reduce((s,m)=>s+m.amount,0)*100)/100 }); }
      const movementsOut: {id:number;type:string;amount:number;concept:string;accountId:number|null;toAccountId:number|null;categoryId:number|null;subcategory:string|null;date:string;visibility:string;profileId:number|null;receiptUrl:string|null;reversalOfId:number|null;isReversed:boolean}[] = [];
      for (const m of movsR) { let url: string|null = null; if (m.receiptBlobKey) { try { url = await ctx.blobs.getUrl(m.receiptBlobKey); } catch { url = null; } } movementsOut.push({ id:m.id, type:m.type, amount:m.amount, concept:m.concept, accountId:m.accountId??null, toAccountId:m.toAccountId??null, categoryId:m.categoryId??null, subcategory:m.subcategory??null, date:m.date, visibility:m.visibility, profileId:m.profileId??null, receiptUrl: url, reversalOfId: m.reversalOfId ?? null, isReversed: reversedIds.has(m.id) }); }

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
      const personal = { salary: Math.round(salary*100)/100, monthSpent: Math.round(monthSpentP*100)/100, remaining: Math.round((salary-monthSpentP)*100)/100, todaySpent: Math.round(todayMovs.reduce((s,m)=>s+m.amount,0)*100)/100, todayCount: todayMovs.length, byCategory, todayMovements: todayMovs.map(m=>({ id:m.id, concept:m.concept, amount:m.amount, categoryId:m.categoryId??null, date:m.date })) };

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
        const base = dueCount===0 ? 70 : (paidCount/Math.max(1,dueCount))*70;
        const onTimeComp = paidCount>0 ? (onTime/paidCount)*20 : 10;
        const seniorityComp = Math.min(10, seniorityDays/3);
        const score = Math.max(5, Math.min(100, Math.round(base + onTimeComp + seniorityComp)));
        return { paidCount, dueCount, onTimePct, avgDaysEarly, seniorityDays, score };
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
        const paysOut: {participantId:number;quincenaIndex:number;status:string;reminderSent:number;paidDate:string|null;proofUrl:string|null;verified:number}[] = [];
        for (const x of tandaPaysR.filter(x=>x.tandaId===td.id)) { let url: string|null = null; if (x.proofBlobKey) { try { url = await ctx.blobs.getUrl(x.proofBlobKey); } catch { url = null; } } paysOut.push({ participantId: x.participantId, quincenaIndex: x.quincenaIndex, status: x.status, reminderSent: x.reminderSent, paidDate: x.paidDate ?? null, proofUrl: url, verified: x.verified ?? 0 }); }
        return { id: td.id, name: td.name, participantCount: td.participantCount, amountPerQuincena: td.amountPerQuincena, startDate: td.startDate, potPerQuincena: Math.round(td.amountPerQuincena*td.participantCount*100)/100, organizerName: orgName, organizerProfileId: td.organizerProfileId ?? null, frequency: td.frequency || "quincenal", cadenceDays: cadence, drawMode: td.drawMode || "random", organizerRating, ratings: orgRatingsR.filter(r=>r.tandaId===td.id).map(r=>({ id: r.id, raterName: r.raterName, stars: r.stars, comment: r.comment ?? null })), invitations: tandaInvsR.filter(i=>i.tandaId===td.id).map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, status: i.status })), participants: parts.map(x=>({ id: x.id, name: x.name, email: x.email ?? null, drawOrder: x.drawOrder ?? null, cardLast4: x.cardLast4 ?? null, joinedDate: x.joinedDate ?? null, stats: statsForName(x.name) })), calendar, payments: paysOut };
      }));

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
        agreements: agR.map(a=>({ id:a.id, title:a.title, description:a.description, status:a.status, votes: votesR.filter(v=>v.agreementId===a.id).map(v=>({ profileId:v.profileId, vote:v.vote })) })),
        personal, tandas, invitations: invsR.map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, status: i.status, householdName: hh.name })),
        patrimony: patrR.map(p=>({ id:p.id, name:p.name, kind:p.kind, category:p.category, value:p.value, owner:p.owner??null })),
        activity: activityR.map(a=>({ id: a.id, action: a.action, detail: a.detail, createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(Number(a.createdAt)).toISOString() })),
        summary: {
          totalBalance: Math.round(totalBalance*100)/100, totalInFunds: Math.round(totalInFunds*100)/100, availableFree: Math.round((totalBalance-totalInFunds)*100)/100,
          monthIncome: Math.round(monthIncome*100)/100, monthExpense: Math.round(monthExpense*100)/100, monthNet: Math.round((monthIncome-monthExpense)*100)/100,
          sharedExpenseMonth: Math.round(baseForContributions*100)/100, unassignedNet, totalAssets, totalLiabilities, netWorth: totalAssets-totalLiabilities, currentMonth,
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
        await db.insert(schema.movements).values({ householdId: args.householdId, type: "expense", amount: Math.round(it.amount*100)/100, concept, accountId: args.accountId ?? null, toAccountId: null, categoryId, subcategory: null, date: dateOk, visibility: args.visibility, profileId: args.profileId ?? null, receiptBlobKey: key });
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
      const vals={householdId:args.householdId,type:args.type,amount:args.amount,concept:args.concept,accountId:args.accountId??null,toAccountId:args.toAccountId??null,categoryId:args.categoryId??null,subcategory:args.subcategory||null,date:args.date,visibility:args.visibility,profileId:args.profileId??null, ...(receiptBlobKey!==undefined?{receiptBlobKey}:{})}; if(args.id){ await db.update(schema.movements).set(vals).where(eq(schema.movements.id,args.id)); await logActivity(ctx, args.householdId, "Movimiento editado", `${args.concept} · $${args.amount}`); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.movements).values(vals).returning({id:schema.movements.id}); await logActivity(ctx, args.householdId, "Movimiento registrado", `${args.concept} · $${args.amount}`); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
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
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; if(args.id){ await db.update(schema.budgets).set({categoryId:args.categoryId,month:args.month,amount:args.amount,visibility:args.visibility}).where(eq(schema.budgets.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.budgets).values({householdId:args.householdId,categoryId:args.categoryId,month:args.month,amount:args.amount,visibility:args.visibility}).returning({id:schema.budgets.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
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
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const [r]=await db.insert(schema.fundMovements).values({householdId:args.householdId,fundId:args.fundId,type:args.type,amount:args.amount,date:args.date,note:args.note||null,accountId:args.accountId??null} as never).returning({id:schema.fundMovements.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),

  saveGoal: defineAction({
    description: "Creates or updates a savings goal.",
    request: z.object({ id: z.number().optional(), householdId: z.number(), name: z.string().min(1), targetAmount: z.number().positive(), savedAmount: z.number().min(0).default(0), targetDate: z.string().optional(), visibility: vis }),
    response: okRes,
    async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const vals={householdId:args.householdId,name:args.name,targetAmount:args.targetAmount,savedAmount:args.savedAmount,targetDate:args.targetDate||null,visibility:args.visibility}; if(args.id){ await db.update(schema.goals).set(vals).where(eq(schema.goals.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } const [r]=await db.insert(schema.goals).values(vals).returning({id:schema.goals.id}); ctx.invalidateQueries(); return {ok:true,id:r?.id}; },
  }),
  deleteGoal: defineAction({ description: "Deletes a goal.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.goals).where(eq(schema.goals.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),
  addGoalSaving: defineAction({ description: "Adds savings to a goal.", request: z.object({ id: z.number(), amount: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const rows=await db.select().from(schema.goals).where(eq(schema.goals.id,args.id)); const g=rows[0]; if(!g) throw new Error("Meta no encontrada"); await db.update(schema.goals).set({savedAmount: Math.max(0, g.savedAmount+args.amount)}).where(eq(schema.goals.id,args.id)); ctx.invalidateQueries(); return {ok:true,id:args.id}; } }),

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
    description: "Finds pending invitations for an email across households, with the inviting household name.",
    request: z.object({ email: z.string().email() }),
    response: z.object({ invitations: z.array(z.object({ id: z.number(), email: z.string(), invitedName: z.string().nullable(), householdId: z.number(), householdName: z.string() })) }),
    async handler(ctx, args) {
      await rateLimit("findInvitations", 20, 60_000);
      const db = ctx.db;
      const email = args.email.trim().toLowerCase();
      const all = await db.select().from(schema.invitations);
      const mine = all.filter(i=>i.email.toLowerCase()===email && i.status==="pending");
      const hhs = await db.select().from(schema.households);
      return { invitations: mine.map(i=>({ id: i.id, email: i.email, invitedName: i.invitedName ?? null, householdId: i.householdId, householdName: hhs.find(h=>h.id===i.householdId)?.name || "Hogar" })) };
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
    request: z.object({ householdId: z.number(), name: z.string().min(1), participantCount: z.number().int().min(2).max(30), amountPerQuincena: z.number().positive(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), organizerProfileId: z.number().nullable().optional(), organizerName: z.string().optional(), frequency: z.enum(["semanal","quincenal","mensual"]).default("quincenal"), drawMode: z.enum(["random","weighted"]).default("random") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const cadenceDays = args.frequency==="semanal" ? 7 : args.frequency==="mensual" ? 30 : 15;
      let orgName = (args.organizerName||"").trim() || null;
      if (!orgName && args.organizerProfileId) { const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.id, args.organizerProfileId)); orgName = profs[0] ? `${profs[0].name} ${profs[0].lastName||""}`.trim() : null; }
      const [r] = await db.insert(schema.tandas).values({ householdId: args.householdId, name: args.name, participantCount: args.participantCount, amountPerQuincena: args.amountPerQuincena, startDate: args.startDate, organizerProfileId: args.organizerProfileId ?? null, organizerName: orgName, frequency: args.frequency, cadenceDays, drawMode: args.drawMode }).returning({ id: schema.tandas.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  deleteTanda: defineAction({ description: "Deletes a tanda and its participants and payments.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; const tinvs=await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.tandaId,args.id)); for (const iv of tinvs) await markTokensForInvitation(db, null, iv.id, "revoked"); await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId,args.id)); await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId,args.id)); await db.delete(schema.tandaInvitations).where(eq(schema.tandaInvitations.tandaId,args.id)); await db.delete(schema.organizerRatings).where(eq(schema.organizerRatings.tandaId,args.id)); await db.delete(schema.tandas).where(eq(schema.tandas.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),

  addTandaParticipant: defineAction({
    description: "Adds a participant to a tanda, optionally registering a SIMULATED card requirement as last-4-digits only. No real card data is accepted or stored.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), name: z.string().min(1), email: z.string().email().optional(), cardLast4: z.string().regex(/^\d{4}$/, "Deben ser exactamente los últimos 4 dígitos").optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const existing = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      if (existing.length >= td.participantCount) throw new Error(`La tanda ya tiene sus ${td.participantCount} participantes.`);
      const nowD = new Date(); const joined = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,"0")}-${String(nowD.getDate()).padStart(2,"0")}`;
      const [r] = await db.insert(schema.tandaParticipants).values({ householdId: args.householdId, tandaId: args.tandaId, name: args.name, email: args.email?.trim().toLowerCase() || null, cardLast4: args.cardLast4 || null, joinedDate: joined }).returning({ id: schema.tandaParticipants.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  removeTandaParticipant: defineAction({ description: "Removes a participant from a tanda.", request: z.object({ id: z.number() }), response: okRes, async handler(ctx,args): Promise<Ok>{ const db=ctx.db; await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.participantId,args.id)); await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.id,args.id)); ctx.invalidateQueries(); return {ok:true}; } }),
  setParticipantCard: defineAction({
    description: "Registers or updates a participant's SIMULATED card last-4-digits only.",
    request: z.object({ id: z.number(), cardLast4: z.string().regex(/^\d{4}$/, "Deben ser exactamente los últimos 4 dígitos") }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> { const db = ctx.db; await db.update(schema.tandaParticipants).set({ cardLast4: args.cardLast4 }).where(eq(schema.tandaParticipants.id, args.id)); ctx.invalidateQueries(); return { ok: true, id: args.id }; },
  }),

  drawTanda: defineAction({
    description: "Runs the sorteo and assigns each participant a number 1..N. Mode 'random' is pure chance; mode 'weighted' favors reliable participants using their real payment history in this space: on-time payment rate, how early they pay, and seniority with the organizer. The chosen mode is saved on the tanda.",
    request: z.object({ tandaId: z.number(), mode: z.enum(["random","weighted"]).optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)); const td = tdRows[0]; if (!td) throw new Error("Tanda no encontrada");
      const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
      if (parts.length < 2) throw new Error("Se necesitan al menos 2 participantes para el sorteo.");
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
      await db.update(schema.tandas).set({ drawMode: mode }).where(eq(schema.tandas.id, args.tandaId));
      ctx.invalidateQueries(); return { ok: true, id: args.tandaId };
    },
  }),

  setTandaPayment: defineAction({
    description: "Marks a participant's payment for one period as paid or pending, optionally attaching the deposit/transfer proof photo (stored as a blob, key only in DB). Marking paid with a proof still requires organizer verification before it displays as verified. No real charge is made.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), status: z.enum(["paid","pending"]), proof: z.object({ dataBase64: z.string(), mimeType: z.string() }).optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      let proofBlobKey: string | undefined = undefined;
      if (args.proof) { if (args.proof.dataBase64.length > 16_000_000) throw new Error("El comprobante es demasiado grande (máximo aproximado de 12 MB)."); const okTypes=["image/jpeg","image/png","image/webp"]; if (!okTypes.includes(args.proof.mimeType)) throw new Error("El comprobante debe ser JPG, PNG o WebP."); const key=`tanda-proofs/${args.householdId}/${Date.now()}-${Math.floor(Math.random()*1e9)}`; const bytes=Buffer.from(args.proof.dataBase64,"base64"); await ctx.blobs.put(key, bytes, { contentType: args.proof.mimeType }); proofBlobKey=key; }
      const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = rows.find(r=>r.participantId===args.participantId && r.quincenaIndex===args.quincenaIndex);
      const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
      const status = proofBlobKey ? "paid" as const : args.status;
      if (mine) { await db.update(schema.tandaPayments).set({ status, paidDate: status==="paid"? (mine.paidDate || todayStr) : null, ...(proofBlobKey?{ proofBlobKey, verified: 0 }:{}), ...(status==="pending"?{ verified: 0 }:{}) }).where(eq(schema.tandaPayments.id, mine.id)); ctx.invalidateQueries(); return { ok: true, id: mine.id }; }
      const [r] = await db.insert(schema.tandaPayments).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, status, paidDate: status==="paid"? todayStr : null, proofBlobKey: proofBlobKey ?? null, verified: 0 }).returning({ id: schema.tandaPayments.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  verifyTandaPayment: defineAction({
    description: "Organizer verifies (or removes verification of) a tanda payment after reviewing its proof: verified=1 marks the payment as verified in the interface.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0), verified: z.boolean() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
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
    description: "Accepts or rejects a tanda invitation. Accepting adds the person as a visible participant of that tanda with the name they choose (never taken from their email).",
    request: z.object({ id: z.number(), accept: z.boolean(), name: z.string().optional() }),
    response: z.object({ ok: z.literal(true), participantId: z.number().optional(), tandaId: z.number().optional() }),
    async handler(ctx, args): Promise<{ ok: true; participantId?: number; tandaId?: number }> {
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
      ctx.invalidateQueries(); return { ok: true, participantId, tandaId: inv.tandaId };
    },
  }),
  rateOrganizer: defineAction({
    description: "Rates a tanda organizer 1-5 stars for trust/administration. Ratings aggregate across all tandas of the same organizer in the space.",
    request: z.object({ householdId: z.number(), tandaId: z.number(), raterName: z.string().min(1), stars: z.number().int().min(1).max(5), comment: z.string().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const [r] = await db.insert(schema.organizerRatings).values({ householdId: args.householdId, tandaId: args.tandaId, raterName: args.raterName.trim(), stars: args.stars, comment: args.comment?.trim() || null }).returning({ id: schema.organizerRatings.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),
  sendTandaReminder: defineAction({
    description: "Marks a payment reminder as sent for a pending tanda payment (in-app record, no external message is sent).",
    request: z.object({ householdId: z.number(), tandaId: z.number(), participantId: z.number(), quincenaIndex: z.number().int().min(0) }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      const db = ctx.db;
      const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
      const mine = rows.find(r=>r.participantId===args.participantId && r.quincenaIndex===args.quincenaIndex);
      if (mine) { await db.update(schema.tandaPayments).set({ reminderSent: 1 }).where(eq(schema.tandaPayments.id, mine.id)); ctx.invalidateQueries(); return { ok: true, id: mine.id }; }
      const [r] = await db.insert(schema.tandaPayments).values({ householdId: args.householdId, tandaId: args.tandaId, participantId: args.participantId, quincenaIndex: args.quincenaIndex, status: "pending", reminderSent: 1 }).returning({ id: schema.tandaPayments.id });
      ctx.invalidateQueries(); return { ok: true, id: r?.id };
    },
  }),

  resetAllData: defineAction({
    description: "Resets the whole application to its exact initial state: permanently deletes every record of the household (movements and their reversals, accounts, budgets, funds and their movements, goals, agreements and their votes, patrimony, tandas with their participants, payments, invitations and organizer ratings, household invitations, all profiles except the initial one, all categories and the activity log) and also deletes the stored receipt and tanda-proof photo files. The household itself (name, mode and rules) and the initial (administrator) profile's identity (name, last name, email, role) are kept, so the user stays in the same initial profile, but the kept profile's monthly income (personal salary) and fixed commitments are reset to zero, so Personal mode opens at zero like a brand-new session, with the default categories re-seeded. Irreversible.",
    request: z.object({ householdId: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<Ok> {
      await rateLimit("resetAllData", 5, 60_000);
      const db = ctx.db;
      const hid = args.householdId;
      const hhRows = await db.select().from(schema.households).where(eq(schema.households.id, hid));
      if (!hhRows[0]) throw new Error("No se encontró el hogar indicado.");

      // El perfil inicial (el primero creado, el del propietario/administrador) se conserva en su
      // identidad, para que la persona permanezca en su mismo perfil, sin salir de la sesión; su
      // sueldo mensual y compromisos fijos se ponen en cero más abajo.
      const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, hid)).orderBy(asc(schema.profiles.id));
      const keeper = profs.find(p=>p.role==="admin") ?? profs[0];

      // Los votos de acuerdos no llevan householdId: se eliminan por cada acuerdo del hogar.
      const ags = await db.select().from(schema.agreements).where(eq(schema.agreements.householdId, hid));
      for (const a of ags) await db.delete(schema.agreementVotes).where(eq(schema.agreementVotes.agreementId, a.id));

      await db.delete(schema.tandaPayments).where(eq(schema.tandaPayments.householdId, hid));
      await db.delete(schema.tandaParticipants).where(eq(schema.tandaParticipants.householdId, hid));
      await db.delete(schema.tandaInvitations).where(eq(schema.tandaInvitations.householdId, hid));
      await db.delete(schema.organizerRatings).where(eq(schema.organizerRatings.householdId, hid));
      await db.delete(schema.tandas).where(eq(schema.tandas.householdId, hid));
      await db.delete(schema.movements).where(eq(schema.movements.householdId, hid));
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
      for (const p of profs) { if (!keeper || p.id !== keeper.id) await db.delete(schema.profiles).where(eq(schema.profiles.id, p.id)); }

      // El perfil inicial se conserva (nombre, apellido, correo, rol), pero su sueldo mensual y
      // sus compromisos fijos vuelven a cero: de lo contrario el modo Personal seguiría mostrando
      // el sueldo y el restante anteriores al reinicio, en lugar de quedar como una sesión nueva.
      if (keeper) await db.update(schema.profiles).set({ monthlyIncome: 0, fixedCommitments: 0 }).where(eq(schema.profiles.id, keeper.id));

      // Las fotografías guardadas (comprobantes de movimientos y comprobantes de pago de tandas)
      // también se eliminan: el reinicio es completo, sin archivos huérfanos.
      for (const prefix of [`receipts/${hid}/`, `tanda-proofs/${hid}/`]) {
        try { const metas = await ctx.blobs.list(prefix); for (const m of metas) { try { await ctx.blobs.delete(m.key); } catch { /* el archivo ya no existía */ } } } catch { /* sin archivos que eliminar */ }
      }

      // Estado inicial: se restablecen las categorías predeterminadas, igual que al crear el hogar.
      const cats: { householdId:number; name:string; kind:"income"|"expense"; isSystem:number; isActive:number; subcategories:string }[] = [];
      for (const [name, subs] of INCOME_CATS) cats.push({ householdId: hid, name, kind: "income", isSystem: 1, isActive: 1, subcategories: JSON.stringify(subs) });
      for (const [name, subs] of EXPENSE_CATS) cats.push({ householdId: hid, name, kind: "expense", isSystem: 1, isActive: 1, subcategories: JSON.stringify(subs) });
      for (const c of cats) await db.insert(schema.categories).values(c);

      await logActivity(ctx, hid, "Aplicación reiniciada", "Se eliminaron todos los datos y la aplicación volvió a su estado inicial. Se conservaron el hogar y el perfil inicial, con su sueldo mensual y compromisos fijos en cero.");
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
} satisfies ActionsModule;
