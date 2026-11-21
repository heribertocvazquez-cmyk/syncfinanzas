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
  // max: 1: una sola conexión por instancia serverless. Vercel congela la
  // instancia tras responder y los temporizadores de cierre no corren, así
  // que cada conexión abierta se queda ocupando un lugar en el pooler de
  // Supabase; con más conexiones por instancia el pool se agota y las
  // peticiones siguientes esperan una conexión libre para siempre. Las
  // consultas de getOverview se encolan en esa única conexión.
  // max_pipeline: 0: NUNCA mandar una segunda consulta mientras otra está
  // en vuelo. Con el valor por defecto (100), postgres.js entrelaza en
  // pipeline las consultas concurrentes de la misma conexión y, contra
  // Supavisor en modo transacción, la respuesta al `Describe` de una
  // consulta con parámetros puede perderse al liberar el backend: la
  // conexión queda cuñada para siempre y todo lo posterior se cuelga
  // (colgamiento de /api/actions, diagnosticado 2026-11-21, v2).
  // El código no usa transacciones, así que desactivar el pipelining es
  // seguro aquí; si algún día se añade una, debe ir en un pool separado.
  // options statement_timeout: se envía, pero Supavisor en modo transacción
  // IGNORA silenciosamente los `options` de inicio de libpq, así que el
  // límite de 15 s NO está en vigor (el límite efectivo es el defecto del
  // clúster, ~2 min). El límite real debe fijarse en el rol con
  // `ALTER ROLE postgres SET statement_timeout = '15s'` (paso aparte).
  // `max_pipeline` y `options` existen en tiempo de ejecución en
  // postgres 3.4.5 (se leen en node_modules/postgres/src/index.js), pero
  // los tipos que trae el paquete no los declaran: la aserción evita un
  // falso error de typecheck sin cambiar el comportamiento.
  client = postgres(url, { prepare: false, max: 1, max_pipeline: 0, ssl: "require", connect_timeout: 10, idle_timeout: 10, max_lifetime: 60 * 5, options: "-c statement_timeout=15000" } as Parameters<typeof postgres>[1] & { max_pipeline: number; options: string });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

/** NO llamar por petición (ni en el `finally` de ningún endpoint).
 *  Con Fluid Compute varias peticiones concurrentes comparten el único
 *  cliente de la instancia caliente (`max: 1`): cerrar el cliente por
 *  petición dejaba consultas huérfanas y por eso se dejó de llamar en
 *  2026-11-21 (v. 2c4e9cf). OJO: ese cierre NO era la causa del
 *  colgamiento de /api/actions — quitarlo no lo arregló. La causa fue
 *  la cuña de pipelining (ver `max_pipeline: 0` en getDb, arriba). Esta
 *  función se conserva solo por si algún día hace falta cerrar el
 *  cliente de forma explícita fuera del camino de las peticiones. */
export async function closeDb(): Promise<void> {
  const c = client;
  client = null;
  dbInstance = null;
  if (c) {
    // El cierre no debe retrasar la respuesta: si la conexión está atascada,
    // se abandona a los 2 s y el runtime la desecha con la instancia.
    try { await Promise.race([c.end(), new Promise((r) => setTimeout(r, 2000))]); } catch { /* ya cerrada */ }
  }
}
