// Despachador de acciones de SyncFinanzas (Vercel Function, Node).
// El cliente llama POST /api/actions con { action, args } y la sesión
// viaja en la cookie httpOnly + Secure + SameSite=Lax que emite el
// servidor al entrar. El encabezado Bearer ya no se acepta (M-05).
// Responsabilidades (checklist de seguridad, CubePath Labs):
//  1. Autenticación: el token JWT se verifica con Supabase Auth. Sin token
//     válido no se ejecuta ninguna acción.
//  2. Permisos por hogar: cada acción solo toca el hogar del usuario. El
//     hogar se resuelve desde household_members, nunca desde lo que el
//     cliente afirme. Las operaciones destructivas y de administración
//     (reiniciar todo, editar el hogar, eliminar perfiles o invitaciones)
//     exigen rol de administrador.
//  3. Validación en el servidor: los argumentos se validan con el esquema
//     zod de cada acción antes de ejecutarla.
//  4. Sin claves en el código: las claves viven en variables de entorno.
//  5. Límites de peticiones: los aplica cada acción (tabla rate_limits).
//  6. Registro de actividad: lo escriben las acciones en activity_log.

import { and, eq, inArray } from "drizzle-orm";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Actions, isTandaOnlyMember } from "../server/src/actions.js";
import { getDb } from "../server/src/db.js";
import * as schema from "../server/src/schema.js";
import { buildCtx, rateLimitDb } from "../server/src/space-shim.js";
import { resolveAppUrl } from "../server/src/appUrl.js";
import { errorResponse } from "../server/src/error-response.js";
import { resolveSessionUser } from "../server/src/supabase.js";

type Role = "admin" | "member";

async function membershipFor(db: ReturnType<typeof getDb>, userId: string, householdId: number) {
  const rows = await db
    .select()
    .from(schema.householdMembers)
    .where(and(eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.userId, userId)));
  return rows[0] ?? null;
}

async function firstMembership(db: ReturnType<typeof getDb>, userId: string, userEmail: string) {
  // La membresía más antigua que de verdad abre un hogar: una membresía
  // derivada solo de una invitación de tanda (flujo viejo) no cuenta,
  // porque el invitado nunca pidió entrar a ese hogar.
  const rows = await db
    .select()
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.userId, userId))
    .orderBy(schema.householdMembers.id);
  for (const m of rows) {
    if (await isTandaOnlyMember(db, userId, userEmail, m.householdId)) continue;
    return m;
  }
  return null;
}

// Acciones que un participante de tanda puede ejercer sobre ESA tanda sin
// ser miembro del hogar: el hogar se resuelve desde la tanda y se exige
// membresía real o participación (no excluida) en esa tanda. El rango
// (organizador/tesorero/suplente o participante propio) lo verifica
// después la propia acción con tandaAccess. Las acciones de organizador
// (rango 3: eliminar, sorteo, invitar, roles) NO están aquí: esas exigen
// membresía del hogar.
const TANDA_PARTICIPANT_ACTIONS = new Set(["setTandaPayment", "verifyTandaPayment", "rateOrganizer", "setParticipantCard", "createMercadoPagoOrder", "checkMercadoPagoOrder", "sendTandaReminder", "addTandaFine", "payTandaFine", "verifyTandaFine", "voteExcludeParticipant", "confirmTandaDelivery", "addTandaFundEntry", "markTandaParticipantNotificationsRead"]);

// Acciones que se identifican solo por id: el hogar se resuelve desde la
// fila correspondiente antes de ejecutarlas.
const ID_LOOKUPS: Record<string, { table: "profiles" | "accounts" | "budgets" | "funds" | "goals" | "agreements" | "patrimonyItems" | "invitations" | "tandaInvitations" | "tandas" | "movements" | "categories" | "tandaParticipants" | "notifications" | "categoryRules" | "spendingAdjustments"; idField: "id" | "agreementId" | "tandaId" | "categoryId" | "participantId" }> = {
  deleteProfile: { table: "profiles", idField: "id" },
  deleteAccount: { table: "accounts", idField: "id" },
  deleteBudget: { table: "budgets", idField: "id" },
  deleteFund: { table: "funds", idField: "id" },
  deleteGoal: { table: "goals", idField: "id" },
  addGoalSaving: { table: "goals", idField: "id" },
  setGoalImportance: { table: "goals", idField: "id" },
  setFundImportance: { table: "funds", idField: "id" },
  deleteAgreement: { table: "agreements", idField: "id" },
  deletePatrimony: { table: "patrimonyItems", idField: "id" },
  deleteInvitation: { table: "invitations", idField: "id" },
  cancelTandaInvitation: { table: "tandaInvitations", idField: "id" },
  respondJoinRequest: { table: "invitations", idField: "id" },
  createMercadoPagoOrder: { table: "tandas", idField: "tandaId" },
  checkMercadoPagoOrder: { table: "tandas", idField: "tandaId" },
  deleteTanda: { table: "tandas", idField: "id" },
  deleteMovement: { table: "movements", idField: "id" },
  reverseMovement: { table: "movements", idField: "id" },
  addSubcategory: { table: "categories", idField: "categoryId" },
  removeSubcategory: { table: "categories", idField: "categoryId" },
  drawTanda: { table: "tandas", idField: "tandaId" },
  setTandaRole: { table: "tandas", idField: "tandaId" },
  setParticipantCard: { table: "tandaParticipants", idField: "id" },
  removeTandaParticipant: { table: "tandaParticipants", idField: "id" },
  deleteCategoryRule: { table: "categoryRules", idField: "id" },
  acceptSpendingAdjustment: { table: "spendingAdjustments", idField: "id" },
  rejectSpendingAdjustment: { table: "spendingAdjustments", idField: "id" },
};

// #110: cuando la búsqueda por ID no encuentra la fila, el despachador
// devuelve el 400 formal del manejador (el mismo mensaje que lanzaría el
// handler si llegara a correr), no el 404 genérico. El mensaje por acción
// es el que su handler lanza cuando no encuentra su fila; sin mensaje
// propio, «Registro no encontrado.».
const ID_LOOKUP_NOT_FOUND: Record<string, string> = {
  acceptSpendingAdjustment: "No se encontró la propuesta de ajuste.",
  rejectSpendingAdjustment: "No se encontró la propuesta de ajuste.",
  addGoalSaving: "Meta no encontrada",
  setGoalImportance: "Meta no encontrada.",
  setFundImportance: "Fondo no encontrado.",
  cancelTandaInvitation: "Invitación de tanda no encontrada.",
  respondJoinRequest: "Solicitud no encontrada.",
  addSubcategory: "Categoría no encontrada.",
  removeSubcategory: "Categoría no encontrada.",
  drawTanda: "Tanda no encontrada",
  setParticipantCard: "Participante no encontrado",
  removeTandaParticipant: "Participante no encontrado",
  reverseMovement: "Movimiento no encontrado.",
};

const ADMIN_ONLY = new Set(["resetAllData", "updateHousehold", "deleteProfile", "deleteInvitation", "respondJoinRequest", "createGenericHouseholdInvite", "getGenericHouseholdInvite"]);

async function householdIdForRow(
  db: ReturnType<typeof getDb>,
  table: string,
  id: number,
): Promise<number | null> {
  const byId = async <T extends { id: number; householdId: number }>(
    rows: Promise<T[]>,
  ): Promise<number | null> => {
    const list = await rows;
    return list[0]?.householdId ?? null;
  };
  switch (table) {
    case "profiles":
      return byId(db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).limit(1));
    case "accounts":
      return byId(db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).limit(1));
    case "budgets":
      return byId(db.select().from(schema.budgets).where(eq(schema.budgets.id, id)).limit(1));
    case "funds":
      return byId(db.select({ id: schema.funds.id, householdId: schema.funds.householdId }).from(schema.funds).where(eq(schema.funds.id, id)).limit(1));
    case "goals":
      return byId(db.select().from(schema.goals).where(eq(schema.goals.id, id)).limit(1));
    case "agreements":
      return byId(db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1));
    case "patrimonyItems":
      return byId(db.select().from(schema.patrimonyItems).where(eq(schema.patrimonyItems.id, id)).limit(1));
    case "invitations":
      return byId(db.select().from(schema.invitations).where(eq(schema.invitations.id, id)).limit(1));
    case "tandaInvitations":
      return byId(db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.id, id)).limit(1));
    case "tandas":
      return byId(db.select().from(schema.tandas).where(eq(schema.tandas.id, id)).limit(1));
    case "movements":
      return byId(db.select().from(schema.movements).where(eq(schema.movements.id, id)).limit(1));
    case "categories":
      return byId(db.select().from(schema.categories).where(eq(schema.categories.id, id)).limit(1));
    case "tandaParticipants":
      return byId(db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.id, id)).limit(1));
    case "notifications":
      return byId(db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).limit(1));
    case "categoryRules":
      return byId(db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id)).limit(1));
    case "spendingAdjustments":
      return byId(db.select().from(schema.spendingAdjustments).where(eq(schema.spendingAdjustments.id, id)).limit(1));
    default:
      return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "syncfinanzas" });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    // Sesión por cookie segura (punto 10): el token viaja en la cookie
    // httpOnly + Secure + SameSite=Lax que emite el servidor al entrar, y
    // se renueva sola. El encabezado Bearer ya NO se acepta (M-05):
    // era el puente para las PWA instaladas en la versión anterior, que
    // guardaban el token en localStorage; el cliente actual no lo usa y
    // /api/auth ya no lo devuelve en el cuerpo.
    const user = await resolveSessionUser(req, res);
    if (!user) return res.status(401).json({ error: "Sesión no válida. Inicie sesión de nuevo." });

    const body = (req.body ?? {}) as { action?: string; args?: Record<string, unknown> };
    const actionName = body.action ?? "";
    const action = (Actions as Record<string, { request: { parse: (v: unknown) => unknown }; handler: (ctx: unknown, args: never) => Promise<unknown> }>)[actionName];
    if (!action) return res.status(400).json({ error: "Acción no conocida." });
    const rawArgs = body.args ?? {};

    // Límite global por usuario (M-06): 120 peticiones/min en /api/actions,
    // además de los límites por acción que ya existen. Persistente en
    // Postgres (rate_limits), compartido entre instancias serverless.
    try {
      await rateLimitDb(`global:${user.id}`, 120, 60_000);
    } catch (err) {
      return errorResponse(res, 429, err, "API actions rate limit:");
    }

    // URL pública de la aplicación: es la base de los enlaces de invitación
    // por correo (https://<app>.vercel.app/invite?token=...). Siempre
    // producción (resolveAppUrl): VERCEL_URL en una vista previa es el
    // dominio de esa vista previa y el origen es el dominio que el usuario
    // haya abierto; ninguno sirve para un enlace que recibe otra persona.
    const appUrl = resolveAppUrl(process.env.APP_URL);

    const db = getDb();
    let householdId: number | null = null;
    let role: Role | null = null;

    const requireMember = async (hid: number): Promise<Role> => {
      const m = await membershipFor(db, user.id, hid);
      if (!m) throw new Error("No pertenece a este hogar.");
      // Una membresía derivada solo de una invitación de tanda (flujo
      // viejo) no abre el hogar del invitador: el invitado solo ve ESA
      // tanda en su propio espacio Personal (listMyTandas). Sin esta
      // comprobación, la fila vieja seguiría abriendo el panel completo
      // del hogar (movimientos, cuentas, presupuestos).
      if (await isTandaOnlyMember(db, user.id, user.email, hid)) throw new Error("No pertenece a este hogar.");
      householdId = hid;
      role = m.role as Role;
      return m.role as Role;
    };

    if (actionName === "getOverview") {
      // Selector de hogar: si el cliente pide un hogar concreto, se valida
      // la membresía (nunca se confía en lo que el cliente afirme); sin
      // elección, la membresía más antigua (comportamiento actual).
      if (typeof rawArgs.householdId === "number") {
        await requireMember(rawArgs.householdId);
      } else {
        const m = await firstMembership(db, user.id, user.email);
        if (m) {
          householdId = m.householdId;
          role = m.role as Role;
        }
      }
    } else if (actionName === "createHousehold") {
      const m = await firstMembership(db, user.id, user.email);
      if (m) {
        householdId = m.householdId;
        role = m.role as Role;
      }
      // Si ya pertenece a un hogar, la propia acción lo rechaza.
    } else if (actionName === "findInvitations") {
      if (typeof rawArgs.email !== "string" || rawArgs.email.trim().toLowerCase() !== user.email.toLowerCase()) {
        return res.status(403).json({ error: "Solo puede consultar las invitaciones enviadas a su propio correo." });
      }
    } else if (actionName === "respondInvitation" || actionName === "respondTandaInvitation") {
      // La comprobación del correo invitado la hace la propia acción; al
      // aceptar, respondInvitation crea la membresía del hogar (eso SÍ da
      // acceso) y respondTandaInvitation solo deja al invitado como
      // participante de la tanda, sin membresía. Aquí solo se verifica
      // que la invitación exista; el hogar se resuelve dentro de la acción.
    } else if (actionName === "resolveInvite" || actionName === "acceptGeneralInvite" || actionName === "requestHouseholdJoinByCode" || actionName === "getJoinRequestStatusByCode") {
      // Acciones por token de invitación o código del hogar: el hogar (si lo
      // hay) se resuelve dentro de la acción desde el token o el código; no
      // exigen membresía previa.
    } else if (actionName === "listMyTandas") {
      // Tandas invitadas: no exige membresía de ningún hogar; la propia
      // acción solo devuelve tandas en las que el usuario participa por
      // correo y de cuyo hogar NO es miembro de verdad.
    } else if (actionName === "createGeneralInvitation") {
      // Invitación general (cuenta personal): no pertenece a ningún hogar;
      // solo exige estar autenticado.
    } else if (actionName === "getLegalAcceptance" || actionName === "acceptLegalDocuments") {
      // Aceptación legal por usuario: no pertenece a ningún hogar; solo
      // exige estar autenticado. La propia acción lee/escribe por user.id.
    } else if (actionName === "resendInvitation") {
      const kind = rawArgs.kind as string | undefined;
      const invitationId = rawArgs.invitationId as number | undefined;
      if (kind === "household" && typeof invitationId === "number") {
        const rows = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invitationId)).limit(1);
        if (!rows[0]) return res.status(404).json({ error: "Invitación no encontrada." });
        await requireMember(rows[0].householdId);
      } else if (kind === "tanda" && typeof invitationId === "number") {
        const rows = await db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.id, invitationId)).limit(1);
        if (!rows[0]) return res.status(404).json({ error: "Invitación no encontrada." });
        await requireMember(rows[0].householdId);
      } else if (kind === "general") {
        // La comprobación de autoría (solo quien la envió puede reenviarla)
        // la hace la propia acción desde created_by_user_id.
      } else {
        return res.status(400).json({ error: "Falta el tipo o el identificador de la invitación." });
      }
    } else if (actionName === "listAppUsers") {
      // Registro de usuarios de la app: con hogar, exige membresía (que sea
      // el dueño de la app lo verifica la propia acción); sin hogar, solo
      // quien no pertenece a ningún hogar.
      if (typeof rawArgs.householdId === "number") {
        await requireMember(rawArgs.householdId);
      } else {
        const m = await firstMembership(db, user.id, user.email);
        if (m) return res.status(403).json({ error: "Solo el dueño de la app puede revisar los usuarios de la app." });
      }
    } else if (TANDA_PARTICIPANT_ACTIONS.has(actionName)) {
      // Acciones de participante de tanda: el hogar se resuelve desde la
      // tanda (no desde lo que el cliente afirme) y se permite ser miembro
      // del hogar O participante (no excluido) de ESA tanda. El rango
      // (organizador/tesorero/suplente o participante propio) lo verifica
      // después la propia acción con tandaAccess.
      let tandaId: number | null = null;
      if (typeof rawArgs.tandaId === "number") tandaId = rawArgs.tandaId;
      else if (actionName === "setParticipantCard" && typeof rawArgs.id === "number") {
        const rows = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.id, rawArgs.id)).limit(1);
        tandaId = rows[0]?.tandaId ?? null;
      }
      if (tandaId == null) return res.status(400).json({ error: "Falta el identificador de la tanda." });
      const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, tandaId)).limit(1);
      if (!tdRows[0]) {
        // markTandaParticipantNotificationsRead es tolerante a una tanda
        // borrada: el handler responde ok sin marcar nada. Si el cliente
        // mandó householdId, se resuelve por membresía y se deja que el
        // handler responda ok; las demás acciones de participante siguen
        // con 404 «Tanda no encontrada.».
        if (actionName === "markTandaParticipantNotificationsRead" && typeof rawArgs.householdId === "number") {
          await requireMember(rawArgs.householdId);
        } else {
          return res.status(404).json({ error: "Tanda no encontrada." });
        }
      } else {
        const hid = tdRows[0].householdId;
        const m = await membershipFor(db, user.id, hid);
        if (m && !(await isTandaOnlyMember(db, user.id, user.email, hid))) {
          householdId = hid;
          role = m.role as Role;
        } else {
          const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, tandaId));
          const mine = parts.find(p => (p.email || "").trim().toLowerCase() === user.email.toLowerCase() && (p as unknown as { excluded?: number }).excluded !== 1);
          if (!mine) throw new Error("No pertenece a este hogar.");
          householdId = hid;
          role = "member";
        }
      }
    } else if (actionName === "markNotificationRead" && typeof rawArgs.id === "number") {
      // Marcar un aviso propio como leído: el dueño del aviso puede
      // hacerlo aunque el aviso viva en el hogar de una tanda en la que
      // solo participa (sin membresía); la propia acción ya exige userId
      // = el que llama, así que nadie marca avisos ajenos. Quien no es
      // dueño ni participante de una tanda de ese hogar sigue pasando por
      // requireMember y se rechaza igual que antes.
      // VA ANTES de la rama genérica de householdId: el cliente siempre
      // manda householdId, así que esa rama rechazaría al invitado solo
      // de tanda antes de llegar aquí.
      const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.id, rawArgs.id)).limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Registro no encontrado." });
      const hid = rows[0].householdId;
      if (rows[0].userId === user.id) {
        const m = await membershipFor(db, user.id, hid);
        if (m && !(await isTandaOnlyMember(db, user.id, user.email, hid))) {
          householdId = hid;
          role = m.role as Role;
        } else {
          const tds = await db.select().from(schema.tandas).where(eq(schema.tandas.householdId, hid));
          const parts = tds.length > 0 ? await db.select().from(schema.tandaParticipants).where(inArray(schema.tandaParticipants.tandaId, tds.map(t => t.id))) : [];
          const mine = parts.find(p => (p.email || "").trim().toLowerCase() === user.email.toLowerCase() && (p as unknown as { excluded?: number }).excluded !== 1);
          if (!mine) return res.status(400).json({ error: "No pertenece a este hogar." });
          householdId = hid;
          role = "member";
        }
      } else {
        await requireMember(hid);
      }
    } else if (typeof rawArgs.householdId === "number") {
      await requireMember(rawArgs.householdId);
    } else if (actionName === "updateHousehold" && typeof rawArgs.id === "number") {
      await requireMember(rawArgs.id);
    } else if (ID_LOOKUPS[actionName]) {
      const lookup = ID_LOOKUPS[actionName];
      const idValue = rawArgs[lookup.idField];
      if (typeof idValue !== "number") return res.status(400).json({ error: "Falta el identificador del registro." });
      const hid = await householdIdForRow(db, lookup.table, idValue);
      if (hid == null) return res.status(400).json({ error: ID_LOOKUP_NOT_FOUND[actionName] ?? "Registro no encontrado." });
      await requireMember(hid);
    } else {
      return res.status(400).json({ error: "No se pudo determinar el hogar de esta acción." });
    }

    if (ADMIN_ONLY.has(actionName) && role !== "admin") {
      return res.status(403).json({ error: "Solo el administrador del hogar puede realizar esta operación." });
    }

    const args = action.request.parse(rawArgs);
    const ctx = buildCtx(user, householdId, role, appUrl);
    const result = await action.handler(ctx, args as never);
    return res.status(200).json(result ?? { ok: true });
  } catch (err) {
    // Punto 11: al cliente solo un mensaje formal y un identificador de
    // error; el mensaje y el código internos quedan en el registro.
    errorResponse(res, 400, err, "API actions error:");
  }
}
