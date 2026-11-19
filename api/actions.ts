// Despachador de acciones de SyncFinanzas (Vercel Function, Node).
// El cliente llama POST /api/actions con { action, args } y el token de
// Supabase Auth en Authorization: Bearer <token>.
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

import { and, eq } from "drizzle-orm";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Actions } from "../server/src/actions.js";
import { getDb, closeDb } from "../server/src/db.js";
import * as schema from "../server/src/schema.js";
import { buildCtx } from "../server/src/space-shim.js";
import { resolveAppUrl } from "../server/src/appUrl.js";
import { errorResponse } from "../server/src/error-response.js";
import { getUserFromToken, resolveSessionUser } from "../server/src/supabase.js";

type Role = "admin" | "member";

async function membershipFor(db: ReturnType<typeof getDb>, userId: string, householdId: number) {
  const rows = await db
    .select()
    .from(schema.householdMembers)
    .where(and(eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.userId, userId)));
  return rows[0] ?? null;
}

async function firstMembership(db: ReturnType<typeof getDb>, userId: string) {
  const rows = await db
    .select()
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.userId, userId))
    .orderBy(schema.householdMembers.id)
    .limit(1);
  return rows[0] ?? null;
}

// Acciones que se identifican solo por id: el hogar se resuelve desde la
// fila correspondiente antes de ejecutarlas.
const ID_LOOKUPS: Record<string, { table: "profiles" | "accounts" | "budgets" | "funds" | "goals" | "agreements" | "patrimonyItems" | "invitations" | "tandas" | "movements" | "categories" | "tandaParticipants" | "notifications" | "categoryRules"; idField: "id" | "agreementId" | "tandaId" | "categoryId" | "participantId" }> = {
  deleteProfile: { table: "profiles", idField: "id" },
  deleteAccount: { table: "accounts", idField: "id" },
  deleteBudget: { table: "budgets", idField: "id" },
  deleteFund: { table: "funds", idField: "id" },
  deleteGoal: { table: "goals", idField: "id" },
  addGoalSaving: { table: "goals", idField: "id" },
  deleteAgreement: { table: "agreements", idField: "id" },
  deletePatrimony: { table: "patrimonyItems", idField: "id" },
  deleteInvitation: { table: "invitations", idField: "id" },
  respondJoinRequest: { table: "invitations", idField: "id" },
  createMercadoPagoOrder: { table: "tandas", idField: "tandaId" },
  checkMercadoPagoOrder: { table: "tandas", idField: "tandaId" },
  deleteTanda: { table: "tandas", idField: "id" },
  deleteMovement: { table: "movements", idField: "id" },
  reverseMovement: { table: "movements", idField: "id" },
  addSubcategory: { table: "categories", idField: "categoryId" },
  removeSubcategory: { table: "categories", idField: "categoryId" },
  drawTanda: { table: "tandas", idField: "tandaId" },
  setParticipantCard: { table: "tandaParticipants", idField: "id" },
  removeTandaParticipant: { table: "tandaParticipants", idField: "id" },
  markNotificationRead: { table: "notifications", idField: "id" },
  deleteCategoryRule: { table: "categoryRules", idField: "id" },
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
      return byId(db.select().from(schema.funds).where(eq(schema.funds.id, id)).limit(1));
    case "goals":
      return byId(db.select().from(schema.goals).where(eq(schema.goals.id, id)).limit(1));
    case "agreements":
      return byId(db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1));
    case "patrimonyItems":
      return byId(db.select().from(schema.patrimonyItems).where(eq(schema.patrimonyItems.id, id)).limit(1));
    case "invitations":
      return byId(db.select().from(schema.invitations).where(eq(schema.invitations.id, id)).limit(1));
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
    // se renueva sola. El encabezado Bearer se sigue aceptando SOLO como
    // puente para las PWA instaladas en la versión anterior, que aún
    // guardan el token en localStorage: cuando actualicen, esa vía deja de
    // usarse y se puede retirar.
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = (await resolveSessionUser(req, res)) ?? (await getUserFromToken(bearer));
    if (!user) return res.status(401).json({ error: "Sesión no válida. Inicie sesión de nuevo." });

    const body = (req.body ?? {}) as { action?: string; args?: Record<string, unknown> };
    const actionName = body.action ?? "";
    const action = (Actions as Record<string, { request: { parse: (v: unknown) => unknown }; handler: (ctx: unknown, args: never) => Promise<unknown> }>)[actionName];
    if (!action) return res.status(400).json({ error: "Acción no conocida." });
    const rawArgs = body.args ?? {};

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
        const m = await firstMembership(db, user.id);
        if (m) {
          householdId = m.householdId;
          role = m.role as Role;
        }
      }
    } else if (actionName === "createHousehold") {
      const m = await firstMembership(db, user.id);
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
      // La comprobación del correo invitado la hace la propia acción, que
      // además crea la membresía al aceptar. Aquí solo se verifica que la
      // invitación exista; el hogar se resuelve dentro de la acción.
    } else if (actionName === "resolveInvite" || actionName === "acceptGeneralInvite" || actionName === "requestHouseholdJoinByCode" || actionName === "getJoinRequestStatusByCode") {
      // Acciones por token de invitación o código del hogar: el hogar (si lo
      // hay) se resuelve dentro de la acción desde el token o el código; no
      // exigen membresía previa.
    } else if (actionName === "createGeneralInvitation") {
      // Invitación general (cuenta personal): no pertenece a ningún hogar;
      // solo exige estar autenticado.
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
        const m = await firstMembership(db, user.id);
        if (m) return res.status(403).json({ error: "Solo el dueño de la app puede revisar los usuarios de la app." });
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
      if (hid == null) return res.status(404).json({ error: "Registro no encontrado." });
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
  } finally {
    await closeDb();
  }
}
