// Enlaces de invitación con token único (un solo uso, vigencia 7 días).
// El token que viaja en el enlace NUNCA se guarda en texto plano: en la
// base solo se guarda su hash SHA-256 (tabla invitation_tokens). Al aceptar
// o rechazar, el token queda marcado y no puede reutilizarse; al reenviar,
// el token anterior queda como "replaced" y se genera uno nuevo.
// Formato del enlace: https://<app>.vercel.app/invite?token=<token>

import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { Db } from "./db";

export type InviteKind = "household" | "tanda" | "general";

export const INVITE_TTL_DAYS = 7;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function inviteUrl(appUrl: string, rawToken: string): string {
  const base = (appUrl || "").replace(/\/$/, "");
  return `${base}/invite?token=${rawToken}`;
}

export interface IssueTokenArgs {
  kind: InviteKind;
  email: string;
  householdId?: number | null;
  tandaId?: number | null;
  invitationId?: number | null;
  tandaInvitationId?: number | null;
  invitedName?: string | null;
  inviterName?: string | null;
  createdByUserId?: string | null;
}

export interface IssuedToken {
  id: number;
  raw: string;
  expiresAt: Date;
}

/** Crea un token nuevo y marca como reemplazados los pendientes anteriores
 *  de la misma invitación (o de la misma invitación general). */
export async function issueInviteToken(db: Db, args: IssueTokenArgs): Promise<IssuedToken> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  if (args.invitationId != null) {
    await db
      .update(schema.invitationTokens)
      .set({ status: "replaced" })
      .where(and(eq(schema.invitationTokens.invitationId, args.invitationId), eq(schema.invitationTokens.status, "pending")));
  }
  if (args.tandaInvitationId != null) {
    await db
      .update(schema.invitationTokens)
      .set({ status: "replaced" })
      .where(and(eq(schema.invitationTokens.tandaInvitationId, args.tandaInvitationId), eq(schema.invitationTokens.status, "pending")));
  }
  if (args.kind === "general" && args.createdByUserId) {
    await db
      .update(schema.invitationTokens)
      .set({ status: "replaced" })
      .where(
        and(
          eq(schema.invitationTokens.kind, "general"),
          eq(schema.invitationTokens.email, args.email.trim().toLowerCase()),
          eq(schema.invitationTokens.status, "pending"),
        ),
      );
  }
  const [row] = await db
    .insert(schema.invitationTokens)
    .values({
      tokenHash: hashToken(raw),
      kind: args.kind,
      email: args.email.trim().toLowerCase(),
      householdId: args.householdId ?? null,
      tandaId: args.tandaId ?? null,
      invitationId: args.invitationId ?? null,
      tandaInvitationId: args.tandaInvitationId ?? null,
      invitedName: args.invitedName ?? null,
      inviterName: args.inviterName ?? null,
      createdByUserId: args.createdByUserId ?? null,
      status: "pending",
      expiresAt,
    })
    .returning({ id: schema.invitationTokens.id });
  if (!row) throw new Error("No se pudo crear el enlace de invitación.");
  return { id: row.id, raw, expiresAt };
}

export interface ResolvedToken {
  id: number;
  kind: InviteKind;
  email: string;
  householdId: number | null;
  tandaId: number | null;
  invitationId: number | null;
  tandaInvitationId: number | null;
  invitedName: string | null;
  inviterName: string | null;
  expiresAt: Date;
  status: string;
}

export async function resolveInviteToken(db: Db, raw: string): Promise<ResolvedToken | null> {
  const rows = await db
    .select()
    .from(schema.invitationTokens)
    .where(eq(schema.invitationTokens.tokenHash, hashToken(raw)))
    .limit(1);
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id,
    kind: t.kind as InviteKind,
    email: t.email,
    householdId: t.householdId ?? null,
    tandaId: t.tandaId ?? null,
    invitationId: t.invitationId ?? null,
    tandaInvitationId: t.tandaInvitationId ?? null,
    invitedName: t.invitedName ?? null,
    inviterName: t.inviterName ?? null,
    expiresAt: t.expiresAt,
    status: t.status,
  };
}

export function tokenIsUsable(t: ResolvedToken): boolean {
  return t.status === "pending" && t.expiresAt.getTime() > Date.now();
}

export async function markToken(db: Db, id: number, status: "accepted" | "rejected" | "replaced" | "revoked"): Promise<void> {
  await db
    .update(schema.invitationTokens)
    .set({ status, usedAt: new Date() })
    .where(eq(schema.invitationTokens.id, id));
}

export async function markTokensForInvitation(
  db: Db,
  invitationId: number | null,
  tandaInvitationId: number | null,
  status: "accepted" | "rejected" | "replaced" | "revoked",
): Promise<void> {
  if (invitationId != null) {
    await db
      .update(schema.invitationTokens)
      .set({ status, usedAt: new Date() })
      .where(and(eq(schema.invitationTokens.invitationId, invitationId), eq(schema.invitationTokens.status, "pending")));
  }
  if (tandaInvitationId != null) {
    await db
      .update(schema.invitationTokens)
      .set({ status, usedAt: new Date() })
      .where(and(eq(schema.invitationTokens.tandaInvitationId, tandaInvitationId), eq(schema.invitationTokens.status, "pending")));
  }
}
