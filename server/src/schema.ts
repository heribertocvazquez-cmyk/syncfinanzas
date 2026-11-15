import { doublePrecision, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const households = pgTable("households", {
  id: serial("id").primaryKey(),
  ownerUserId: uuid("owner_user_id"),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("MXN"),
  cutoffDay: integer("cutoff_day").notNull().default(1),
  contributionRule: text("contribution_rule", { enum: ["equal", "proportional"] }).notNull().default("equal"),
  approvalRule: text("approval_rule", { enum: ["unanimous", "majority"] }).notNull().default("unanimous"),
  approvalThreshold: doublePrecision("approval_threshold").notNull().default(1500),
  mode: text("mode", { enum: ["personal", "familiar"] }).notNull().default("familiar"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  userId: uuid("user_id"),
  name: text("name").notNull(),
  email: text("email"),
  kind: text("kind", { enum: ["adult", "dependent"] }).notNull().default("adult"),
  dependentType: text("dependent_type"),
  lastName: text("last_name"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  monthlyIncome: doublePrecision("monthly_income").notNull().default(0),
  fixedCommitments: doublePrecision("fixed_commitments").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["bank", "cash", "credit", "investment", "loan"] }).notNull().default("bank"),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  initialBalance: doublePrecision("initial_balance").notNull().default(0),
  ownerProfileId: integer("owner_profile_id"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["income", "expense"] }).notNull(),
  isSystem: integer("is_system").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  subcategories: text("subcategories").notNull().default("[]"), // JSON array string
});

export const movements = pgTable("movements", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  type: text("type", { enum: ["income", "expense", "transfer", "debt_payment"] }).notNull(),
  amount: doublePrecision("amount").notNull(),
  concept: text("concept").notNull(),
  accountId: integer("account_id"),
  toAccountId: integer("to_account_id"),
  categoryId: integer("category_id"),
  subcategory: text("subcategory"),
  date: text("date").notNull(), // YYYY-MM-DD local calendar date
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  profileId: integer("profile_id"),
  receiptBlobKey: text("receipt_blob_key"),
  reversalOfId: integer("reversal_of_id"), // id del movimiento que esta fila revierte; null si no es una reversión
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  categoryId: integer("category_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  amount: doublePrecision("amount").notNull(),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
});

export const funds = pgTable("funds", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  targetAmount: doublePrecision("target_amount"),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const fundMovements = pgTable("fund_movements", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  fundId: integer("fund_id").notNull(),
  type: text("type", { enum: ["contribution", "withdrawal"] }).notNull(),
  amount: doublePrecision("amount").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  accountId: integer("account_id"),
});

export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  targetAmount: doublePrecision("target_amount").notNull(),
  savedAmount: doublePrecision("saved_amount").notNull().default(0),
  targetDate: text("target_date"),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const agreements = pgTable("agreements", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["proposal", "approved", "rejected"] }).notNull().default("proposal"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const agreementVotes = pgTable("agreement_votes", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull(),
  profileId: integer("profile_id").notNull(),
  vote: text("vote", { enum: ["approve", "reject"] }).notNull(),
});

export const patrimonyItems = pgTable("patrimony_items", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["asset", "liability"] }).notNull(),
  category: text("category").notNull().default(""),
  value: doublePrecision("value").notNull(),
  owner: text("owner"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  email: text("email").notNull(),
  invitedName: text("invited_name"),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
export const tandas = pgTable("tandas", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  participantCount: integer("participant_count").notNull(),
  amountPerQuincena: doublePrecision("amount_per_quincena").notNull(),
  startDate: text("start_date").notNull(),
  organizerProfileId: integer("organizer_profile_id"),
  organizerName: text("organizer_name"),
  frequency: text("frequency", { enum: ["semanal", "quincenal", "mensual"] }).notNull().default("quincenal"),
  cadenceDays: integer("cadence_days").notNull().default(15),
  drawMode: text("draw_mode", { enum: ["random", "weighted"] }).notNull().default("random"),
  // Tandas v3 ("modo Compartamos"): reglas del grupo.
  coverageRule: text("coverage_rule", { enum: ["fondo", "prorroga", "reparto"] }).notNull().default("fondo"),
  fineAmount: doublePrecision("fine_amount").notNull().default(0),
  turnsLocked: integer("turns_locked").notNull().default(0),
  treasurerProfileId: integer("treasurer_profile_id"),
  substituteProfileId: integer("substitute_profile_id"),
  meetingDay: text("meeting_day").notNull().default(""),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
export const tandaParticipants = pgTable("tanda_participants", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  drawOrder: integer("draw_order"),
  cardLast4: text("card_last4"),
  joinedDate: text("joined_date"),
  // Tandas v3: rol en el grupo y exclusión por votación.
  role: text("role", { enum: ["organizador", "tesorero", "suplente", "participante"] }).notNull().default("participante"),
  excluded: integer("excluded").notNull().default(0),
});
export const tandaPayments = pgTable("tanda_payments", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  participantId: integer("participant_id").notNull(),
  quincenaIndex: integer("quincena_index").notNull(),
  status: text("status", { enum: ["paid", "pending", "late"] }).notNull().default("pending"),
  reminderSent: integer("reminder_sent").notNull().default(0),
  paidDate: text("paid_date"),
  proofBlobKey: text("proof_blob_key"),
  verified: integer("verified").notNull().default(0),
  // Tandas v3: multa aplicada a este pago.
  fineAmount: doublePrecision("fine_amount").notNull().default(0),
});
export const tandaInvitations = pgTable("tanda_invitations", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  email: text("email").notNull(),
  invitedName: text("invited_name"),
  status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
export const organizerRatings = pgTable("organizer_ratings", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  raterName: text("rater_name").notNull(),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

// Tandas v3 ("modo Compartamos"): multas, votaciones de exclusión,
// confirmación doble de entrega y fondos separados. Tablas creadas con
// supabase/tandas-v3.sql; RLS con denegación total, solo service_role.
export const tandaFines = pgTable("tanda_fines", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  participantId: integer("participant_id").notNull(),
  quincenaIndex: integer("quincena_index").notNull(),
  amount: doublePrecision("amount").notNull(),
  reason: text("reason", { enum: ["retardo", "falta"] }).notNull().default("retardo"),
  status: text("status", { enum: ["pendiente", "pagada"] }).notNull().default("pendiente"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
export const tandaVotes = pgTable("tanda_votes", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  targetParticipantId: integer("target_participant_id").notNull(),
  voterName: text("voter_name").notNull(),
  vote: text("vote", { enum: ["excluir", "no"] }).notNull().default("excluir"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
export const tandaDeliveries = pgTable("tanda_deliveries", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  quincenaIndex: integer("quincena_index").notNull(),
  receiverId: integer("receiver_id"),
  organizerConfirmed: integer("organizer_confirmed").notNull().default(0),
  receiverConfirmed: integer("receiver_confirmed").notNull().default(0),
  organizerConfirmedAt: timestamp("organizer_confirmed_at", { mode: "date" }),
  receiverConfirmedAt: timestamp("receiver_confirmed_at", { mode: "date" }),
});
export const tandaFundEntries = pgTable("tanda_fund_entries", {
  id: serial("id").primaryKey(),
  tandaId: integer("tanda_id").notNull(),
  householdId: integer("household_id").notNull(),
  participantId: integer("participant_id"),
  kind: text("kind", { enum: ["aportacion", "fondo", "multa"] }).notNull().default("fondo"),
  amount: doublePrecision("amount").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

// Registro de actividad del hogar: auditoría de las operaciones relevantes (altas, bajas,
// reversiones, lecturas de comprobantes, invitaciones, verificaciones de pago). Sin datos
// sensibles: solo el tipo de operación y una descripción breve.
export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

// Enlaces de invitación por correo: solo se guarda el hash SHA-256 del
// token (nunca el token en texto plano). Un solo uso, vigencia de 7 días.
// kind: household (unirse a un hogar), tanda (participar en una tanda) o
// general (crear su cuenta personal en SyncFinanzas).
export const invitationTokens = pgTable("invitation_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  kind: text("kind", { enum: ["household", "tanda", "general"] }).notNull().default("household"),
  email: text("email").notNull(),
  householdId: integer("household_id"),
  tandaId: integer("tanda_id"),
  invitationId: integer("invitation_id"),
  tandaInvitationId: integer("tanda_invitation_id"),
  invitedName: text("invited_name"),
  inviterName: text("inviter_name"),
  createdByUserId: uuid("created_by_user_id"),
  status: text("status", { enum: ["pending", "accepted", "rejected", "replaced", "revoked"] }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const householdMembers = pgTable("household_members", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  userId: uuid("user_id").notNull(),
  profileId: integer("profile_id"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

// Límite de peticiones por operación (sustituye al límite en memoria de la
// versión de Muse, que no sobrevive entre instancias serverless).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { mode: "date" }).notNull(),
});

// Bloqueo de inicio de sesión por correo tras intentos fallidos.
export const authLockouts = pgTable("auth_lockouts", {
  email: text("email").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { mode: "date" }),
  lastAttemptAt: timestamp("last_attempt_at", { mode: "date" }).notNull().defaultNow(),
});

// Opiniones de los testers (segunda etapa): se envían desde el formulario
// público (?feedback=1), sin cuenta. La tabla se crea con
// supabase/feedback.sql; la lectura pública está denegada por RLS y solo el
// servidor (service_role) la lee para el administrador del hogar.
export const testerFeedback = pgTable("tester_feedback", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  nombre: text("nombre"),
  correo: text("correo"),
  calificacionGeneral: integer("calificacion_general").notNull(),
  facilidadUso: integer("facilidad_uso").notNull(),
  queFunciono: text("que_funciono"),
  queFallo: text("que_fallo"),
  sugerencia: text("sugerencia"),
  modulo: text("modulo"),
  dispositivo: text("dispositivo"),
});

// Plan de ahorro para una meta: cuánto aportar al mes, en qué fondo se
// aparta el dinero y en qué estado va el plan. La tabla se crea con
// supabase/goal-plans.sql; RLS con denegación total, solo service_role.
// Un plan por meta (goal_id único). status: aceptado | en_riesgo | cumplido
// | cancelado. start_month es YYYY-MM, due_day el día del mes en que toca
// aportar (por defecto, el día de corte del hogar).
export const goalPlans = pgTable("goal_plans", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  goalId: integer("goal_id").notNull(),
  monthlyAmount: doublePrecision("monthly_amount").notNull(),
  months: integer("months").notNull(),
  startMonth: text("start_month").notNull(),
  dueDay: integer("due_day").notNull().default(1),
  fundId: integer("fund_id"),
  status: text("status", { enum: ["aceptado", "en_riesgo", "cumplido", "cancelado"] }).notNull().default("aceptado"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

// Avisos dentro de la app (campanita con puntito rojo + insignia del icono).
// Se crean en el servidor: nuevo integrante en el hogar, gasto mayor que el
// límite del hogar, presupuesto del mes excedido. La tabla se crea con
// supabase/notifications.sql; RLS con denegación total, solo service_role.
// Un aviso por integrante del hogar (user_id destinatario); isRead 0/1.
// Tipos del plan de ahorro (mismo sistema de avisos): plan_aporte (se
// acerca la fecha de la aportación del mes), plan_mes_sin_aporte (un mes
// pasó sin aportar), plan_en_riesgo (con el ritmo actual no se llega a la
// fecha), meta_cumplida (la meta llegó a su monto).
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  householdId: integer("household_id").notNull(),
  userId: uuid("user_id").notNull(),
  type: text("type", { enum: ["nuevo_integrante", "gasto_umbral", "presupuesto_excedido", "plan_aporte", "plan_mes_sin_aporte", "plan_en_riesgo", "meta_cumplida"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  amount: doublePrecision("amount"),
  target: text("target").notNull().default("inicio"),
  isRead: integer("is_read").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
