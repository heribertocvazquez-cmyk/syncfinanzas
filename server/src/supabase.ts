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
