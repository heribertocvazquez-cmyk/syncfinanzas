// Cliente de Supabase para el navegador: SOLO Auth y sesión.
// La clave anónima (VITE_SUPABASE_ANON_KEY) es pública por diseño de
// Supabase, pero con RLS en denegación total no permite leer ni escribir
// ninguna tabla: todos los datos pasan por /api/actions en el servidor.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Configure las variables de entorno en Vercel (ver README).");
}

export const supabase = createClient(url, anonKey);
