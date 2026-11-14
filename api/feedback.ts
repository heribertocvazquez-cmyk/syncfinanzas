// Opiniones de testers (segunda etapa): POST /api/feedback
// Recibe el formulario público (?feedback=1) sin sesión: los testers opinan
// sin cuenta. Valida con zod, limita peticiones por dirección IP y guarda en
// la tabla tester_feedback con el cliente service_role (que no pasa por RLS).
// La tabla se crea con supabase/feedback.sql; sin ese archivo, el endpoint
// responde error y el formulario lo muestra. Nunca devuelve las opiniones:
// la lectura es solo para el administrador, por /api/actions.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { rateLimitDb } from "../server/src/space-shim.js";
import { supabaseAdmin } from "../server/src/supabase.js";
import { closeDb } from "../server/src/db.js";

const feedbackBody = z.object({
  nombre: z.string().trim().max(120).optional().nullable(),
  correo: z.string().trim().max(200).email("Escriba un correo válido.").optional().nullable().or(z.literal("")),
  calificacionGeneral: z.number().int().min(1, "Elija una calificación general de 1 a 5.").max(5),
  facilidadUso: z.number().int().min(1, "Elija la facilidad de uso de 1 a 5.").max(5),
  queFunciono: z.string().trim().max(2000).optional().nullable(),
  queFallo: z.string().trim().max(2000).optional().nullable(),
  sugerencia: z.string().trim().max(2000).optional().nullable(),
  modulo: z.string().trim().max(60).optional().nullable(),
  dispositivo: z.string().trim().max(40).optional().nullable(),
});

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? "").split(",")[0];
  return (first ?? "").trim() || "desconocida";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "syncfinanzas-feedback" });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    // Límite: 10 opiniones por hora por dirección IP.
    await rateLimitDb(`feedback:${clientIp(req)}`, 10, 3_600_000);
    const parsed = feedbackBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ error: first?.message ?? "Revise los datos del formulario." });
    }
    const v = parsed.data;
    const { error } = await supabaseAdmin()
      .from("tester_feedback")
      .insert({
        nombre: v.nombre?.trim() || null,
        correo: v.correo?.trim() || null,
        calificacion_general: v.calificacionGeneral,
        facilidad_uso: v.facilidadUso,
        que_funciono: v.queFunciono?.trim() || null,
        que_fallo: v.queFallo?.trim() || null,
        sugerencia: v.sugerencia?.trim() || null,
        modulo: v.modulo?.trim() || null,
        dispositivo: v.dispositivo?.trim() || null,
      });
    if (error) {
      // La tabla aún no existe (falta ejecutar supabase/feedback.sql) o la
      // base no respondió: error formal, sin detalles internos.
      console.error("API feedback error:", error.message);
      return res.status(400).json({ error: "No se pudo guardar su opinión. Inténtelo de nuevo más tarde." });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar su opinión. Inténtelo de nuevo.";
    console.error("API feedback error:", message);
    return res.status(400).json({ error: message });
  } finally {
    await closeDb();
  }
}
