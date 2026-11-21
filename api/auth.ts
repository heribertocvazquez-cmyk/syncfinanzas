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
import { resolveAppUrl } from "../server/src/appUrl.js";
import { clearSessionCookies, revokeSession, setSessionCookies, supabaseAnon } from "../server/src/supabase.js";
import { errorResponse } from "../server/src/error-response.js";
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
    // Cierre de sesión: no exige correo ni contraseña; revoca la sesión en
    // Supabase (si se puede) y borra las cookies. Va antes de la validación
    // de correo, que no aplica aquí.
    if (mode === "logout") {
      await revokeSession(req);
      clearSessionCookies(res);
      return res.status(200).json({ ok: true });
    }
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
      // El enlace debe volver SIEMPRE a la app desplegada. El correo de
      // Supabase se construye sobre la Site URL del panel (si sigue en
      // http://localhost:3000, el enlace abre localhost en el teléfono y
      // falla); el redirectTo solo decide a dónde vuelve tras verificar el
      // token. Por eso no se toma del origen de la petición (una vista
      // previa o el desarrollo local mandarían el enlace a otro lado): se
      // usa APP_URL (documentada en el README) con el dominio de
      // producción como valor fijo si no está configurada.
      const siteUrl = resolveAppUrl(process.env.APP_URL);
      await supabaseAnon().auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/`,
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
      // Sesión por cookie segura (punto 10): el token ya NO se devuelve en
      // el cuerpo ni se guarda en localStorage; el servidor emite las
      // cookies httpOnly + Secure + SameSite=Lax.
      setSessionCookies(res, data.session.access_token, data.session.refresh_token);
      return res.status(200).json({
        ok: true,
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
      // Sesión por cookie segura (punto 10): ver el comentario de arriba.
      setSessionCookies(res, data.session.access_token, data.session.refresh_token);
      return res.status(200).json({
        ok: true,
        user: { id: data.user?.id, email: data.user?.email },
      });
    }

    return res.status(400).json({ error: "Modo no válido." });
  } catch (err) {
    // Punto 11: al cliente solo un mensaje formal y un identificador de
    // error; el mensaje y el código internos quedan en el registro.
    errorResponse(res, 400, err, "API error:");
  }
}
