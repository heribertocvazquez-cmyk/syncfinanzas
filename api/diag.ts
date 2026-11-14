// Diagnóstico temporal de SyncFinanzas: mide por etapas dónde se atasca
// /api/actions (Auth, SELECT 1, membresía, hogar y las 17 consultas en
// paralelo de getOverview) y lo devuelve como JSON. Solo lee datos.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, eq, desc } from "drizzle-orm";
import { getDb, closeDb } from "../server/src/db.js";
import * as schema from "../server/src/schema.js";
import { getUserFromToken } from "../server/src/supabase.js";

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} ${ms}ms`)), ms)),
  ]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  const t0 = Date.now();
  try {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = await withTimeout(Promise.resolve(getUserFromToken(token)), 10000, "auth");
    out.authMs = Date.now() - t0;
    out.user = user ? user.email : null;
    if (!user) return res.status(200).json(out);
    const db = getDb();
    const step = async (label: string, fn: () => Promise<unknown>) => {
      const t = Date.now();
      try {
        const r = await withTimeout(fn(), 12000, label);
        out[label] = { ms: Date.now() - t, ok: true, rows: Array.isArray(r) ? r.length : typeof r };
      } catch (e) {
        out[label] = { ms: Date.now() - t, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };
    await step("select1", () => db.execute(sql`SELECT 1 AS one`));
    let hid: number | null = null;
    const tM = Date.now();
    try {
      const m = await withTimeout(
        db.select().from(schema.householdMembers).where(eq(schema.householdMembers.userId, user.id)).orderBy(schema.householdMembers.id).limit(1),
        12000, "membership",
      );
      out.membership = { ms: Date.now() - tM, ok: true, rows: m.length };
      hid = m[0]?.householdId ?? null;
    } catch (e) {
      out.membership = { ms: Date.now() - tM, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    out.householdId = hid;
    if (hid != null) {
      await step("household", () => db.select().from(schema.households).where(eq(schema.households.id, hid as number)).limit(1));
      const tP = Date.now();
      try {
        const parts = await withTimeout(
          Promise.all([
            db.select().from(schema.profiles).where(eq(schema.profiles.householdId, hid as number)),
            db.select().from(schema.accounts).where(eq(schema.accounts.householdId, hid as number)),
            db.select().from(schema.categories).where(eq(schema.categories.householdId, hid as number)),
            db.select().from(schema.movements).where(eq(schema.movements.householdId, hid as number)).orderBy(desc(schema.movements.date), desc(schema.movements.id)),
            db.select().from(schema.budgets).where(eq(schema.budgets.householdId, hid as number)),
            db.select().from(schema.funds).where(eq(schema.funds.householdId, hid as number)),
            db.select().from(schema.fundMovements).where(eq(schema.fundMovements.householdId, hid as number)).orderBy(desc(schema.fundMovements.date)),
            db.select().from(schema.goals).where(eq(schema.goals.householdId, hid as number)),
            db.select().from(schema.agreements).where(eq(schema.agreements.householdId, hid as number)).orderBy(desc(schema.agreements.id)),
            db.select().from(schema.agreementVotes),
            db.select().from(schema.patrimonyItems).where(eq(schema.patrimonyItems.householdId, hid as number)),
            db.select().from(schema.tandas).where(eq(schema.tandas.householdId, hid as number)).orderBy(desc(schema.tandas.id)),
            db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.householdId, hid as number)),
            db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.householdId, hid as number)),
            db.select().from(schema.invitations).where(eq(schema.invitations.householdId, hid as number)),
            db.select().from(schema.tandaInvitations).where(eq(schema.tandaInvitations.householdId, hid as number)).orderBy(desc(schema.tandaInvitations.id)),
            db.select().from(schema.organizerRatings).where(eq(schema.organizerRatings.householdId, hid as number)).orderBy(desc(schema.organizerRatings.id)),
          ]),
          12000, "parallel17",
        );
        out.parallel17 = { ms: Date.now() - tP, ok: true, rows: parts.map((p) => p.length) };
      } catch (e) {
        out.parallel17 = { ms: Date.now() - tP, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const tS = Date.now();
      try {
        const one = await withTimeout(db.select().from(schema.profiles).where(eq(schema.profiles.householdId, hid as number)), 12000, "sequential1");
        out.sequential1 = { ms: Date.now() - tS, ok: true, rows: one.length };
      } catch (e) {
        out.sequential1 = { ms: Date.now() - tS, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return res.status(200).json(out);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return res.status(200).json(out);
  } finally {
    await closeDb();
  }
}
