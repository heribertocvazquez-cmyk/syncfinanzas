// Compatibilidad con la interfaz que usaba @hatch/space-sdk en la versión
// de Muse, reimplementada sobre Supabase. `server/src/actions.ts` conserva
// su estructura (defineAction + handler(ctx, args)) y este archivo sustituye
// las tres piezas de la plataforma que no existen fuera de Muse:
//   ctx.db        -> Drizzle sobre Postgres de Supabase
//   ctx.blobs     -> Supabase Storage (bucket privado "comprobantes")
//   ctx.inference -> Visión por IA (OpenAI, opcional; ver abajo)
// Además: rateLimit persistente en Postgres (en Muse era un mapa en memoria,
// que no sobrevive entre instancias serverless).

import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "./db";
import * as schema from "./schema";
import { supabaseAdmin } from "./supabase";

export { z };

export interface AuthUser {
  id: string;
  email: string;
}

export interface Ctx {
  db: Db;
  user: AuthUser;
  /** URL pública de la aplicación (para los enlaces de invitación por
   *  correo). Vacía en pruebas locales sin APP_URL ni origen. */
  appUrl: string;
  /** Hogar del usuario autenticado, resuelto por el despachador. null si aún
   *  no pertenece a ningún hogar (está en el registro inicial). */
  householdId: number | null;
  /** Rol del usuario en ese hogar: admin (creador) o member. */
  userRole: "admin" | "member" | null;
  blobs: {
    put: (key: string, bytes: Buffer, opts: { contentType: string }) => Promise<void>;
    getUrl: (key: string) => Promise<string>;
    list: (prefix: string) => Promise<{ key: string }[]>;
    delete: (key: string) => Promise<void>;
  };
  inference: {
    complete: <T>(
      prompt: string,
      opts: { schema: z.ZodType<T>; images: { dataBase64: string; mimeType: string; caption: string }[] },
    ) => Promise<T>;
  };
  invalidateQueries: () => void;
}

export interface ActionDef {
  description?: string;
  request: z.ZodTypeAny;
  response?: z.ZodTypeAny;
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
}

export type ActionsModule = Record<string, ActionDef>;

export function defineAction<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny | undefined>(
  def: {
    description?: string;
    request: TReq;
    response?: TRes;
    handler: (ctx: Ctx, args: z.infer<TReq>) => Promise<unknown>;
  },
): {
  description?: string;
  request: TReq;
  response?: TRes;
  handler: (ctx: Ctx, args: z.infer<TReq>) => Promise<unknown>;
} {
  return def;
}

/** Límite de peticiones persistente: tabla rate_limits (clave, conteo,
 *  vencimiento). Se comparte entre instancias serverless. */
export async function rateLimitDb(key: string, max: number, windowMs: number): Promise<void> {
  const db = getDb();
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning();
  const row = rows[0];
  if (!row) return;
  if (row.resetAt.getTime() <= now.getTime()) {
    // Ventana vencida: reiniciar el conteo.
    await db.update(schema.rateLimits).set({ count: 1, resetAt }).where(sql`${schema.rateLimits.key} = ${key}`);
    return;
  }
  if (row.count > max) {
    throw new Error("Se alcanzó el límite de peticiones permitido para esta operación. Espere un momento e inténtelo de nuevo.");
  }
}

const BUCKET = "comprobantes";

/** Archivos en Supabase Storage (bucket privado). Solo el servidor, con la
 *  clave service_role, sube, firma y borra. El navegador nunca recibe más
 *  que una URL firmada de 1 hora. */
export const blobs = {
  async put(key: string, bytes: Buffer, opts: { contentType: string }): Promise<void> {
    const { error } = await supabaseAdmin().storage.from(BUCKET).upload(key, bytes, {
      contentType: opts.contentType,
      upsert: false,
    });
    if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  },
  async getUrl(key: string): Promise<string> {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(key, 3600);
    if (error || !data) throw new Error(`No se pudo generar la URL del archivo: ${error?.message ?? "desconocido"}`);
    return data.signedUrl;
  },
  async list(prefix: string): Promise<{ key: string }[]> {
    // Supabase lista por carpeta: el prefijo "receipts/3/" -> carpeta "receipts/3".
    const folder = prefix.replace(/\/$/, "");
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).list(folder, { limit: 1000 });
    if (error) return [];
    return (data ?? [])
      .filter((f) => f.id !== null)
      .map((f) => ({ key: `${folder}/${f.name}` }));
  },
  async delete(key: string): Promise<void> {
    await supabaseAdmin().storage.from(BUCKET).remove([key]);
  },
};

/** Lectura automática de comprobantes con visión por IA.
 *  En Muse la hacía la inferencia de la plataforma. Fuera de Muse no existe
 *  un servicio gratuito equivalente, así que esta versión usa la API de
 *  OpenAI (modelo gpt-4o-mini) SOLO si está configurada OPENAI_API_KEY.
 *  Sin la clave, la acción devuelve un error claro y la aplicación sigue
 *  funcionando: la foto se puede adjuntar como comprobante visual y el gasto
 *  se registra manualmente. No se inventa ninguna lectura. */
export const inference = {
  async complete<T>(
    prompt: string,
    opts: { schema: z.ZodType<T>; images: { dataBase64: string; mimeType: string; caption: string }[] },
  ): Promise<T> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "La lectura automática del comprobante no está configurada en este despliegue (falta la clave del servicio de visión). Adjunte la fotografía como comprobante y registre el gasto manualmente.",
      );
    }
    const image = opts.images[0];
    if (!image) throw new Error("No se recibió ninguna fotografía para leer.");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${prompt}\n\nResponda ÚNICAMENTE con un objeto JSON con estas claves: store (texto o null), date (texto YYYY-MM-DD o null), items (lista de {name, amount}), total (número), suggestedCategory (texto o null). No invente productos ni importes que no aparezcan en la imagen.` },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error("El servicio de lectura del comprobante no respondió. Inténtelo de nuevo.");
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("No se pudo leer ningún producto ni el total del comprobante.");
    const parsed: unknown = JSON.parse(content);
    return opts.schema.parse(parsed);
  },
};

/** Construye el contexto de una acción para un usuario autenticado. */
export function buildCtx(user: AuthUser, householdId: number | null, userRole: "admin" | "member" | null, appUrl = ""): Ctx {
  return {
    db: getDb(),
    user,
    appUrl,
    householdId,
    userRole,
    blobs,
    inference,
    invalidateQueries: () => {},
  };
}
