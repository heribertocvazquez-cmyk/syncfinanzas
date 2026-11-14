// Cliente tipado de las acciones del servidor.
// Sustituye a createActionClient de @hatch/space-sdk: hace POST a
// /api/actions con { action, args } y el token de Supabase Auth.
// Los tipos de argumentos y respuestas salen directamente de los esquemas
// zod de server/src/actions.ts (solo tipos: el cliente nunca importa el
// código del servidor).
import type { z } from "zod";
import type { Actions } from "../../server/src/actions";
import { supabase } from "./supabase";

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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Su sesión caducó. Inicie sesión de nuevo.");
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, args }),
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? "No se pudo completar la operación. Inténtelo de nuevo.");
  return json;
}

export const api = new Proxy({} as Api, {
  get(_target, action: string) {
    return (args: unknown) => callAction(action, args);
  },
});
