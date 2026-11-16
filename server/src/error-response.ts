// Respuestas de error sin detalles internos (punto 11 de la auditoría).
// El cliente recibe solo un mensaje formal y un identificador de error
// para trazarlo en los registros del servidor; el mensaje y el código
// internos quedan solo en console.error (registros de Vercel).
import { randomUUID } from "node:crypto";
import type { VercelResponse } from "@vercel/node";

/** Errores que lanza el propio código de la app: instancias simples de
 *  Error con un mensaje formal en español ("No pertenece a este hogar.",
 *  "La contraseña debe incluir...", "Se alcanzó el límite..."). Los
 *  errores de la base (Postgres/Drizzle, con `code` o `cause`), de
 *  validación (zod) o de otro tipo no pasan este filtro y se responden
 *  con el mensaje genérico. */
export function isFormalError(err: unknown): boolean {
  return err instanceof Error && err.name === "Error" && !("code" in err) && !("cause" in err);
}

/** Responde el error en el catch general de un endpoint. `status` es el
 *  código HTTP (se conserva el 400 que ya usaban los endpoints). */
export function errorResponse(res: VercelResponse, status: number, err: unknown, logPrefix: string) {
  const errorId = randomUUID().slice(0, 8);
  const message = err instanceof Error ? err.message : "Error desconocido.";
  const cause = err instanceof Error ? (err as unknown as { cause?: { message?: string; code?: string } }).cause : undefined;
  console.error(logPrefix, errorId, message, cause);
  if (isFormalError(err)) return res.status(status).json({ error: message, errorId });
  return res.status(status).json({ error: "No se pudo completar la operación. Inténtelo de nuevo.", errorId });
}
