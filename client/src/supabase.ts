// Cliente de Supabase para el navegador: SOLO Auth y sesión.
// La clave anónima (VITE_SUPABASE_ANON_KEY) es pública por diseño de
// Supabase, pero con RLS en denegación total no permite leer ni escribir
// ninguna tabla: todos los datos pasan por /api/actions en el servidor.
//
// Sesión por cookie (punto 10 de la auditoría): el token ya NO se guarda
// en localStorage. El servidor emite al entrar una cookie httpOnly +
// Secure + SameSite=Lax y la renueva; por eso este cliente no persiste la
// sesión (persistSession: false) ni la renueva solo. Solo se conserva para
// el restablecimiento de contraseña: el enlace por correo trae el token en
// el hash de la URL y detectSessionInUrl lo lee en memoria para que
// updateUser pueda cambiar la contraseña; al recargar, esa sesión en
// memoria se descarta y hay que iniciar sesión normal.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Configure las variables de entorno en Vercel (ver README).");
}

// Señal de recuperación capturada ANTES de crear el cliente. La pantalla
// «Elija una contraseña nueva» solo aparecía si el hash de la URL traía
// «type=recovery» cuando AuthGate montaba, pero la librería de Supabase
// borra ese hash al leerlo (`window.location.hash = ''` en
// `_getSessionFromURL`) y en un teléfono lento el montaje llega después
// de esa lectura: el enlace por correo abría el inicio de sesión normal
// (verificado por Heriberto en su teléfono 2026-11-24). Se lee el hash
// aquí, en la evaluación del módulo, antes de que el cliente exista, y
// AuthGate decide con este valor en vez de leer el hash al montar.
export const initialRecoverySignal: boolean = (() => {
  try {
    return window.location.hash.includes("type=recovery");
  } catch {
    return false;
  }
})();

/** Lee las credenciales de recuperación de un hash de URL
 *  («#access_token=...&refresh_token=...&type=recovery»). Devuelve null
 *  si el hash no es de recuperación o le faltan las credenciales: un
 *  cambio de hash normal nunca debe cambiar de modo. Se usa en el
 *  listener de `hashchange` de AuthGate (red 4): el enlace puede llegar
 *  después de la carga, cuando la app ya está abierta. */
export function parseRecoveryHash(hash: string): { access_token: string; refresh_token: string } | null {
  try {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    if (params.get("type") !== "recovery") return null;
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return null;
    return { access_token, refresh_token };
  } catch {
    return null;
  }
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
});

// Limpieza de la sesión anterior: la versión anterior guardaba el token en
// localStorage (claves sb-*-auth-token de Supabase). Como la sesión ahora
// vive en la cookie del servidor, esas claves viejas se borran para que el
// token no quede guardado en el dispositivo.
try {
  for (const store of [localStorage, sessionStorage]) {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) store.removeItem(k);
    }
  }
} catch {
  // Sin almacenamiento disponible: nada que limpiar.
}
