// Cliente de Supabase para el servidor (Vercel Functions).
// - anon: solo Auth (inicio de sesión / registro). No toca tablas.
// - admin (service_role): base de datos vía RLS-bypass, Storage y Auth Admin.
//   SOLO en el servidor. Nunca se expone al navegador ni se sube a GitHub.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseAnon(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y SUPABASE_ANON_KEY en las variables de entorno.");
  return createClient(url, key);
}

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno (solo servidor).");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Verifica el token JWT del encabezado Authorization y devuelve el usuario.
 *  Devuelve null si no hay token o no es válido. */
export async function getUserFromToken(token: string | null) {
  if (!token) return null;
  const { data, error } = await supabaseAnon().auth.getUser(token);
  if (error || !data.user || !data.user.email) return null;
  return { id: data.user.id, email: data.user.email };
}

// ---- Sesión por cookie segura (punto 10 de la auditoría) ----
// El token ya NO vive en localStorage: el servidor emite al entrar dos
// cookies httpOnly + Secure + SameSite=Lax (acceso, 1 hora; renovación,
// 30 días) y las renueva. El navegador las envía solo en cada petición al
// mismo origen; ningún script de la página puede leerlas.
const ACCESS_COOKIE = "sf_access";
const REFRESH_COOKIE = "sf_refresh";

type CookieRequest = { headers: { cookie?: string; authorization?: string } };
type CookieResponse = { setHeader: (name: string, value: string | string[]) => void };

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function setSessionCookies(res: CookieResponse, accessToken: string, refreshToken: string): void {
  res.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`,
    `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
  ]);
}

export function clearSessionCookies(res: CookieResponse): void {
  res.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
}

/** Resuelve el usuario desde la cookie de sesión. Si el token de acceso
 *  caducó, lo renueva con el token de renovación y emite las cookies nuevas
 *  en la misma respuesta. Devuelve null sin sesión válida. */
export async function resolveSessionUser(req: CookieRequest, res: CookieResponse) {
  const cookies = parseCookies(req.headers.cookie);
  const access = cookies[ACCESS_COOKIE];
  if (access) {
    const user = await getUserFromToken(access);
    if (user) return user;
  }
  const refresh = cookies[REFRESH_COOKIE];
  if (refresh) {
    const { data, error } = await supabaseAnon().auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session && data.user?.email) {
      setSessionCookies(res, data.session.access_token, data.session.refresh_token);
      return { id: data.user.id, email: data.user.email };
    }
  }
  return null;
}

/** Revoca la sesión en Supabase Auth (invalida el token de renovación).
 *  Es un intento, no una garantía: el cierre local (borrar la cookie) es
 *  lo que importa y se hace siempre, aunque esto falle. */
export async function revokeSession(req: CookieRequest): Promise<void> {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const access = cookies[ACCESS_COOKIE];
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!access || !url || !key) return;
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${access}` },
    });
  } catch {
    // El cierre local (borrar la cookie) se hace de todos modos.
  }
}
