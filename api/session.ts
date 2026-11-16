// Sesión actual (Vercel Function, Node).
// GET /api/session: devuelve quién es el usuario a partir de la cookie de
// sesión (httpOnly + Secure + SameSite=Lax). El cliente la usa para saber
// si hay sesión y para el chequeo de dueño de la app, sin leer ningún
// token: el token nunca llega al navegador.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveSessionUser } from "../server/src/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  try {
    const user = await resolveSessionUser(req, res);
    if (!user) return res.status(401).json({ error: "Sesión no válida. Inicie sesión de nuevo." });
    return res.status(200).json({ ok: true, user: { id: user.id, email: user.email } });
  } catch {
    return res.status(401).json({ error: "Sesión no válida. Inicie sesión de nuevo." });
  }
}
