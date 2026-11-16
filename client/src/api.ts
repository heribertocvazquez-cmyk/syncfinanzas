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
  ) => Promise<
    NonNullable<(typeof Actions)[K]["response"]> extends z.ZodTypeAny
      ? z.infer<NonNullable<(typeof Actions)[K]["response"]>>
      : { ok: true }
  >;
};

async function callAction(action: string, args: unknown): Promise<unknown> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, args }),
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? "No se pudo completar la operación. Inténtelo de nuevo.");
  return json;
}

/** Sesión actual según el servidor (GET /api/session). La usa la pantalla
 *  de acceso y el chequeo de dueño de la app; devuelve null sin sesión. */
export async function fetchSession(): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
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
    return (args: unknown) => callAction(action, args);
  },
});
