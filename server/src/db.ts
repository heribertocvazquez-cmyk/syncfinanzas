// Capa de datos para el despliegue fuera de Muse (Supabase + Vercel).
// Sustituye a @hatch/space-sdk: la base es Postgres de Supabase (Drizzle),
// los archivos van a Supabase Storage y la sesión la da Supabase Auth.
// Ninguna clave real vive aquí: todo llega por variables de entorno.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: Db | null = null;

/** Conexión Postgres (pooler de Supabase, puerto 6543). `prepare: false` es
 *  obligatorio con PgBouncer en modo transacción: sin él, las sentencias
 *  preparadas fallan entre peticiones serverless. */
export function getDb(): Db {
  if (dbInstance) return dbInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable de entorno DATABASE_URL (cadena del pooler de Supabase).");
  // max: 3 porque getOverview lanza ~17 consultas en paralelo (Promise.all):
  // con una sola conexión, una consulta atascada bloquea todas las demás.
  // statement_timeout: ninguna consulta puede colgarse más de 15 s; si lo
  // hace, Postgres la cancela y devuelve un error claro en lugar de dejar
  // la función de Vercel esperando hasta agotar su tiempo.
  client = postgres(url, { prepare: false, max: 3, ssl: "require", connect_timeout: 10, idle_timeout: 10, max_lifetime: 60 * 5, options: "-c statement_timeout=15000" });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

/** Cierra la conexión al final de cada petición serverless. En Vercel cada
 *  invocación puede ser una instancia distinta y las conexiones que quedan
 *  abiertas agotan el pooler de Supabase: las peticiones siguientes se
 *  quedan esperando una conexión libre hasta agotar el tiempo de la función.
 *  Se llama en el `finally` de cada endpoint de la API, después de enviar
 *  la respuesta; la siguiente petición vuelve a crear la conexión. */
export async function closeDb(): Promise<void> {
  const c = client;
  client = null;
  dbInstance = null;
  if (c) { try { await c.end(); } catch { /* ya cerrada */ } }
}
