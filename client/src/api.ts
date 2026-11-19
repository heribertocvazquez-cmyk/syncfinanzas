// Cliente tipado de las acciones del servidor.
// Sustituye a createActionClient de @hatch/space-sdk: hace POST a
// /api/actions con { action, args }. La sesión viaja en la cookie segura
// (httpOnly + Secure + SameSite=Lax) que emite el servidor al entrar: el
// navegador la envía solo (credentials: "same-origin") y el cliente nunca
// toca el token.
// Los tipos de argumentos y respuestas salen directamente de los esquemas
// zod de server/src/actions.ts (solo tipos: el cliente nunca importa el
// código del servidor).
import type { z } from "zod";
import type { Actions } from "../../server/src/actions";

export type Api = {
  [K in keyof typeof Actions]: (
    args: z.input<(typeof Actions)[K]["request"]>,
    /** Milisegundos antes de dar la petición por colgada (defecto 30 s). */
    timeoutMs?: number,
  ) => Promise<
    NonNullable<(typeof Actions)[K]["response"]> extends z.ZodTypeAny
      ? z.infer<NonNullable<(typeof Actions)[K]["response"]>>
      : { ok: true }
  >;
};

// Tiempo máximo de una petición de acción (reporte 2026-11-19 16:02):
// sin timeout, una petición que se queda colgada (arranque en frío,
// contención del pooler de Supabase, refresco de Auth lento, sobre todo
// tras la recarga del service worker) dejaba la app en el splash
// «Cargando...» para siempre, sin error ni reintento. Con timeout, la
// petición falla rápido y la app muestra la pantalla de error con
// «Reintentar» en vez de quedarse colgada.
export const API_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("La conexión tardó demasiado. Inténtelo de nuevo.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callAction(action: string, args: unknown, timeoutMs: number = API_TIMEOUT_MS): Promise<unknown> {
  const res = await fetchWithTimeout(
    "/api/actions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, args }),
    },
    timeoutMs,
  );
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? "No se pudo completar la operación. Inténtelo de nuevo.");
  return json;
}

/** Sesión actual según el servidor (GET /api/session). La usa la pantalla
 *  de acceso y el chequeo de dueño de la app; devuelve null sin sesión.
 *  También con timeout (15 s): sin él, la pantalla de acceso se quedaba
 *  en «Cargando SyncFinanzas…» si la petición no resolvía. */
export async function fetchSession(): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetchWithTimeout("/api/session", { credentials: "same-origin" }, 15000);
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { user?: { id: string; email: string } } | null;
    return json?.user ?? null;
  } catch {
    return null;
  }
}

/** Cierra la sesión en el servidor (borra la cookie). */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ mode: "logout" }),
    });
  } catch {
    // Aunque la petición falle, al recargar ya no habrá sesión.
  }
}

export const api = new Proxy({} as Api, {
  get(_target, action: string) {
    return (args: unknown, timeoutMs?: number) => callAction(action, args, timeoutMs);
  },
});
