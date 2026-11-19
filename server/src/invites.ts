// Enlaces de invitación con token único (un solo uso, vigencia 7 días) y
// código del hogar (6 caracteres, vigencia 1 año).
// El token que viaja en el enlace NUNCA se guarda en texto plano: en la
// base solo se guarda su hash SHA-256 (tabla invitation_tokens). Lo mismo
// vale para el código del hogar: solo se guarda su hash, nunca el código.
// Al aceptar o rechazar, el token queda marcado y no puede reutilizarse;
// al reenviar, el token anterior queda como "replaced" y se genera uno nuevo.
// Formato del enlace: https://<app>.vercel.app/invite?token=<token>

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./db.js";

export type InviteKind = "household" | "tanda" | "general" | "household_code";

export const INVITE_TTL_DAYS = 7;

/** Vigencia del enlace para probar la app: un año. El
 *  enlace se puede regenerar en cualquier momento (el anterior queda
 *  invalidado); un año evita que un enlace compartido en un grupo de
 *  WhatsApp caduque a los pocos días. */
export const GENERIC_HOUSEHOLD_INVITE_TTL_DAYS = 365;

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
  /** Vigencia en días; por defecto INVITE_TTL_DAYS (7). El enlace
   *  genérico del hogar usa GENERIC_HOUSEHOLD_INVITE_TTL_DAYS (365). */
  ttlDays?: number;
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
  const ttlDays = args.ttlDays ?? INVITE_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
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

/** Un token genérico de hogar: kind "household", sin fila de invitación
 *  (invitationId null) y sin correo (email ""). No pertenece a nadie en
 *  particular: solo identifica el hogar para solicitar entrar. El enlace
 *  por sí solo NO da acceso a nada. */
export function isHouseholdGenericToken(t: ResolvedToken): boolean {
  return t.kind === "household" && t.invitationId == null && t.email === "";
}

// ---- Código del hogar ----
// El código es la segunda vía para entrar a un hogar (la primera es la
// invitación por correo del administrador). Es corto (6 caracteres) para
// dictarlo o compartirlo por WhatsApp, sin caracteres que se confundan
// (sin O/0/I/1/L). Vive en invitation_tokens con kind "household_code":
// solo se guarda su hash SHA-256, nunca el código en texto plano; un solo
// código activo por hogar; regenerar invalida el anterior. Sin SQL nuevo:
// kind es TEXT en la base (supabase/schema.sql).

/** Vigencia del código del hogar: un año, igual que el enlace para probar la app. */
export const HOUSEHOLD_CODE_TTL_DAYS = 365;

export const HOUSEHOLD_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const HOUSEHOLD_CODE_LENGTH = 6;

export function generateHouseholdCode(): string {
  let code = "";
  for (let i = 0; i < HOUSEHOLD_CODE_LENGTH; i++) {
    code += HOUSEHOLD_CODE_ALPHABET[randomInt(0, HOUSEHOLD_CODE_ALPHABET.length)];
  }
  return code;
}

/** Normaliza un código escrito por la persona: mayúsculas, sin espacios ni
 *  guiones (se acepta «ab 12-cd» como «AB12CD»). */
export function normalizeHouseholdCode(raw: string): string {
  return (raw || "").toUpperCase().replace(/[\s-]/g, "");
}

/** Un código del hogar: kind "household_code", sin fila de invitación y
 *  sin correo. Solo identifica el hogar para solicitar entrar; el código
 *  por sí solo NO da acceso a nada. */
export function isHouseholdCodeToken(t: ResolvedToken): boolean {
  return t.kind === "household_code" && t.invitationId == null && t.email === "";
}

/** Busca el código activo de un hogar (pendiente y sin vencer), si lo hay.
 *  Solo puede haber uno activo a la vez. */
export async function findHouseholdCodeToken(
  db: Db,
  householdId: number,
): Promise<ResolvedToken | null> {
  const rows = await db
    .select()
    .from(schema.invitationTokens)
    .where(
      and(
        eq(schema.invitationTokens.kind, "household_code"),
        eq(schema.invitationTokens.householdId, householdId),
        eq(schema.invitationTokens.email, ""),
        eq(schema.invitationTokens.status, "pending"),
      ),
    )
    .orderBy(desc(schema.invitationTokens.id));
  const t = rows[0];
  if (!t || t.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: t.id,
    kind: t.kind as InviteKind,
    email: t.email,
    householdId: t.householdId,
    tandaId: t.tandaId,
    invitationId: t.invitationId,
    tandaInvitationId: t.tandaInvitationId,
    invitedName: t.invitedName,
    inviterName: t.inviterName,
    status: t.status as ResolvedToken["status"],
    expiresAt: t.expiresAt,
  };
}

/** Invalida los códigos pendientes de un hogar (al generar uno nuevo, el
 *  anterior deja de funcionar). */
export async function replaceHouseholdCodeTokens(db: Db, householdId: number): Promise<void> {
  const rows = await db
    .select()
    .from(schema.invitationTokens)
    .where(
      and(
        eq(schema.invitationTokens.kind, "household_code"),
        eq(schema.invitationTokens.householdId, householdId),
        eq(schema.invitationTokens.email, ""),
        eq(schema.invitationTokens.status, "pending"),
      ),
    );
  for (const r of rows) await markToken(db, r.id, "replaced");
}

/** Genera el código del hogar y lo guarda solo como hash. El código se
 *  devuelve una sola vez: no se guarda en texto plano, así que no se puede
 *  volver a mostrar después. Si el código generado chocara con otro
 *  existente (probabilidad mínima con 6 caracteres de 32), se reintenta
 *  con uno nuevo. */
export async function issueHouseholdCodeToken(
  db: Db,
  args: { householdId: number; inviterName?: string | null; createdByUserId?: string | null },
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + HOUSEHOLD_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await replaceHouseholdCodeTokens(db, args.householdId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateHouseholdCode();
    const clash = await db
      .select({ id: schema.invitationTokens.id })
      .from(schema.invitationTokens)
      .where(eq(schema.invitationTokens.tokenHash, hashToken(code)))
      .limit(1);
    if (clash[0]) continue;
    await db.insert(schema.invitationTokens).values({
      tokenHash: hashToken(code),
      kind: "household_code",
      email: "",
      householdId: args.householdId,
      tandaId: null,
      invitationId: null,
      tandaInvitationId: null,
      invitedName: null,
      inviterName: args.inviterName ?? null,
      createdByUserId: args.createdByUserId ?? null,
      status: "pending",
      expiresAt,
    });
    return { code, expiresAt };
  }
  throw new Error("No se pudo generar el código del hogar. Inténtelo de nuevo.");
}

/** Busca el enlace para probar la app activo de un hogar (pendiente y sin vencer),
 *  si lo hay. Solo puede haber uno activo a la vez. */
export async function findHouseholdGenericToken(
  db: Db,
  householdId: number,
): Promise<ResolvedToken | null> {
  const rows = await db
    .select()
    .from(schema.invitationTokens)
    .where(
      and(
        eq(schema.invitationTokens.kind, "household"),
        eq(schema.invitationTokens.householdId, householdId),
        eq(schema.invitationTokens.email, ""),
        eq(schema.invitationTokens.status, "pending"),
      ),
    )
    .orderBy(desc(schema.invitationTokens.id));
  const t = rows[0];
  if (!t || t.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: t.id,
    kind: t.kind as InviteKind,
    email: t.email,
    householdId: t.householdId,
    tandaId: t.tandaId,
    invitationId: t.invitationId,
    tandaInvitationId: t.tandaInvitationId,
    invitedName: t.invitedName,
    inviterName: t.inviterName,
    status: t.status as ResolvedToken["status"],
    expiresAt: t.expiresAt,
  };
}

/** Invalida los enlaces genéricos pendientes de un hogar (al generar uno
 *  nuevo, el anterior deja de funcionar). */
export async function replaceHouseholdGenericTokens(db: Db, householdId: number): Promise<void> {
  const rows = await db
    .select()
    .from(schema.invitationTokens)
    .where(
      and(
        eq(schema.invitationTokens.kind, "household"),
        eq(schema.invitationTokens.householdId, householdId),
        eq(schema.invitationTokens.email, ""),
        eq(schema.invitationTokens.status, "pending"),
      ),
    );
  for (const r of rows) await markToken(db, r.id, "replaced");
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
