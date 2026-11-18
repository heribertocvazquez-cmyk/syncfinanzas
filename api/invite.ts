// Vista previa pública de un enlace de invitación: GET /api/invite?token=...
// No exige sesión (el invitado aún no tiene cuenta). Solo devuelve los
// datos necesarios para mostrar la invitación antes de crear la cuenta o
// iniciar sesión: tipo, correo invitado, quién invita y a qué hogar/tanda.
// Nunca devuelve el hash del token ni datos de otros usuarios.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../server/src/db.js";
import * as schema from "../server/src/schema.js";
import { resolveInviteToken, tokenIsUsable, isHouseholdGenericToken } from "../server/src/invites.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) return res.status(400).json({ error: "Falta el token de invitación." });
  try {
    const db = getDb();
    const t = await resolveInviteToken(db, token);
    if (!t) return res.status(404).json({ error: "El enlace de invitación no es válido." });
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
    return res.status(200).json({
      ok: true,
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
      status: t.status,
      generic: isHouseholdGenericToken(t),
    });
  } catch {
    return res.status(400).json({ error: "No se pudo verificar la invitación. Inténtelo de nuevo." });
  } finally {
    await closeDb();
  }
}
