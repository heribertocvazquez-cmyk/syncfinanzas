// URL pública de producción de SyncFinanzas: es la base de TODOS los
// enlaces de invitación (hogar, tanda, genérico y código) y de los enlaces
// de recuperación de contraseña. Un enlace de invitación debe apuntar
// siempre a producción, sin importar desde qué despliegue se generó.
//
// Por eso aquí NO se usan ni VERCEL_URL ni el origen de la petición:
// VERCEL_URL es la URL del despliegue concreto y en una vista previa vale
// algo como syncfinanzas-<hash>-reshab1.vercel.app (ese fue el enlace que
// recibió una invitada el 2026-11-18), y el origen es el dominio que el
// usuario haya abierto. APP_URL (variable en Vercel) manda cuando está
// configurada; si no, el dominio de producción fijo.
export const PRODUCTION_APP_URL = "https://syncfinanzas.vercel.app";

export function resolveAppUrl(appUrlEnv?: string | null): string {
  const configured = (appUrlEnv ?? "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return PRODUCTION_APP_URL;
}
