// Capa de datos para el despliegue fuera de Muse (Supabase + Vercel).
// Sustituye a @hatch/space-sdk: la base es Postgres de Supabase (Drizzle),
// los archivos van a Supabase Storage y la sesión la da Supabase Auth.
// Ninguna clave real vive aquí: todo llega por variables de entorno.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
  client = postgres(url, { prepare: false, max: 1 });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}
