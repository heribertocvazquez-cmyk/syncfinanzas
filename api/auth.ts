// Inicio de sesión con Supabase Auth (Vercel Function, Node).
// POST /api/auth { mode: "login" | "signup" | "forgot", email, password }
//
// Seguridad (checklist CubePath Labs + contraseñas fuertes):
//  - La contraseña NUNCA se guarda en la base de SyncFinanzas: la guarda y
//    verifica Supabase Auth (hash con sal). Aquí solo se valida su fortaleza.
//  - Fortaleza mínima (servidor y cliente): 12 caracteres, mayúscula,
//    minúscula, número y símbolo.
//  - Bloqueo por intentos: 5 inicios fallidos en 15 minutos bloquean el
//    correo 15 minutos (tabla auth_lockouts). El mensaje de error es el
//    mismo con o sin cuenta, para no revelar si el correo existe.
//  - Límites de peticiones: 10 intentos por correo y minuto.
//  - Las claves (service_role) viven solo en variables de entorno.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../server/src/db.js";
import * as schema from "../server/src/schema.js";
import { rateLimitDb } from "../server/src/space-shim.js";
import { supabaseAnon } from "../server/src/supabase.js";
import { eq } from "drizzle-orm";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function passwordError(password: string): string | null {
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una letra minúscula.";
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir al menos un número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "La contraseña debe incluir al menos un símbolo (por ejemplo: ! ? # $).";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    const body = (req.body ?? {}) as { mode?: string; email?: string; password?: string };
    const mode = body.mode ?? "";
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Escriba un correo electrónico válido." });
    }
    await rateLimitDb(`auth:${email}`, 10, 60_000);

    const db = getDb();
    const lockRows = await db.select().from(schema.authLockouts).where(eq(schema.authLockouts.email, email)).limit(1);
    const lock = lockRows[0];
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((lock.lockedUntil.getTime() - Date.now()) / 60_000));
      return res.status(423).json({
        error: `Demasiados intentos fallidos. Su correo está bloqueado por ${minutes} minuto(s). Inténtelo de nuevo después.`,
      });
    }

    const recordFailure = async () => {
      const attempts = (lock?.attempts ?? 0) + 1;
      const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await db
        .insert(schema.authLockouts)
        .values({ email, attempts, lockedUntil, lastAttemptAt: new Date() })
        .onConflictDoUpdate({
          target: schema.authLockouts.email,
          set: { attempts, lockedUntil, lastAttemptAt: new Date() },
        });
      return lockedUntil;
    };
    const clearFailures = async () => {
      await db.delete(schema.authLockouts).where(eq(schema.authLockouts.email, email));
    };

    if (mode === "forgot") {
      // Se envía el correo de recuperación aunque el correo no exista: el
      // mensaje es el mismo para no revelar si la cuenta existe.
      const origin = (req.headers.origin as string | undefined) ?? "";
      await supabaseAnon().auth.resetPasswordForEmail(email, {
        redirectTo: origin ? `${origin}/` : undefined,
      });
      return res.status(200).json({ ok: true, message: "Si el correo está registrado, recibirá un enlace para restablecer su contraseña." });
    }

    if (mode === "signup") {
      const weak = passwordError(password);
      if (weak) return res.status(400).json({ error: weak });
      const { data, error } = await supabaseAnon().auth.signUp({ email, password });
      if (error) return res.status(400).json({ error: "No se pudo crear la cuenta. Verifique el correo e inténtelo de nuevo." });
      if (!data.session) {
        // Confirmación de correo activada en Supabase: el usuario debe
        // confirmar su correo antes de entrar. En el README se indica cómo
        // desactivarla para el piloto.
        return res.status(200).json({ ok: true, needsConfirmation: true });
      }
      await clearFailures();
      return res.status(200).json({
        ok: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: { id: data.user?.id, email: data.user?.email },
      });
    }

    if (mode === "login") {
      const { data, error } = await supabaseAnon().auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        const lockedUntil = await recordFailure();
        if (lockedUntil) {
          return res.status(423).json({
            error: `Demasiados intentos fallidos. Su correo está bloqueado por ${LOCK_MINUTES} minutos. Inténtelo de nuevo después.`,
          });
        }
        return res.status(401).json({ error: "Correo o contraseña incorrectos." });
      }
      await clearFailures();
      return res.status(200).json({
        ok: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: { id: data.user?.id, email: data.user?.email },
      });
    }

    return res.status(400).json({ error: "Modo no válido." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido.";
    const cause = err instanceof Error ? (err as unknown as { cause?: { message?: string; code?: string } }).cause : undefined;
    console.error("API error:", message, cause);
    return res.status(400).json({ error: message, cause: cause?.message ?? null, code: cause?.code ?? null });
  }
}
