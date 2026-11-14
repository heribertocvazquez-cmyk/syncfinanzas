// Diagnóstico temporal de SyncFinanzas: mide por etapas dónde se atasca
// /api/actions (Auth de Supabase y primera consulta Postgres) y lo
// devuelve como JSON. No toca datos ni crea registros.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../server/src/db.js";
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
    let user: { id: string; email: string } | null = null;
    try {
      user = await withTimeout(Promise.resolve(getUserFromToken(token)), 10000, "auth");
      out.authMs = Date.now() - t0;
      out.user = user ? user.email : null;
    } catch (e) {
      out.authMs = Date.now() - t0;
      out.authError = e instanceof Error ? e.message : String(e);
      return res.status(200).json(out);
    }
    if (!user) return res.status(200).json({ ...out, note: "sin usuario" });
    const t1 = Date.now();
    try {
      const db = getDb();
      await withTimeout(db.execute(sql`SELECT 1 AS one`), 10000, "select1");
      out.dbMs = Date.now() - t1;
      out.db = "ok";
    } catch (e) {
      out.dbMs = Date.now() - t1;
      out.dbError = e instanceof Error ? e.message : String(e);
      const cause = (e as { cause?: { message?: string; code?: string } }).cause;
      if (cause) { out.dbCause = cause.message ?? null; out.dbCode = cause.code ?? null; }
    }
    return res.status(200).json(out);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return res.status(200).json(out);
  } finally {
    await closeDb();
  }
}
