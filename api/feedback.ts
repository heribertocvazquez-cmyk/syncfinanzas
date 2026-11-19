// Opiniones de testers (segunda etapa + canal de dudas y mejoras):
// POST /api/feedback recibe el formulario público (?feedback=1) sin sesión:
// los testers opinan sin cuenta. Valida con zod, limita peticiones por
// dirección IP y guarda en la tabla tester_feedback con el cliente
// service_role (que no pasa por RLS). La tabla se crea con
// supabase/feedback.sql y las columnas del canal (tipo, descripción,
// estado, respuesta; calificaciones opcionales) con
// supabase/feedback-canal.sql; sin ese segundo archivo, el envío con tipo
// muestra el error formal y la consulta por correo usa solo los campos
// viejos. Nunca devuelve las opiniones: la lectura es solo para el
// administrador, por /api/actions, y la consulta por correo solo devuelve
// los mensajes de ese correo.
// GET /api/feedback?correo=... devuelve los mensajes de ese correo con su
// estado y la respuesta del dueño, para que el tester vea cómo va su duda,
// su error o su mejora. Sin correo, responde el estado del servicio.
// Tras guardar, avisa al dueño de la app en su campanilla (solo a él, no
// a todo el hogar); si el aviso falla, el envío igual queda guardado.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { rateLimitDb } from "../server/src/space-shim.js";
import { errorResponse } from "../server/src/error-response.js";
import { supabaseAdmin } from "../server/src/supabase.js";
import { closeDb } from "../server/src/db.js";

// Dueño de la app: solo él recibe el aviso de cada opinión nueva. Son las
// mismas constantes que en server/src/actions.ts (APP_OWNER_USER_ID y
// APP_OWNER_EMAIL); ser administrador del hogar no basta.
const APP_OWNER_USER_ID = "88531f08-8ec9-4486-87d1-0f6a5d67b06d";

const FEEDBACK_TIPOS = ["duda", "error", "mejora"] as const;
const FEEDBACK_TIPO_LABELS: Record<(typeof FEEDBACK_TIPOS)[number], string> = {
  duda: "Duda",
  error: "Error o corrección",
  mejora: "Mejora",
};

const feedbackBody = z.object({
  nombre: z.string().trim().max(120).optional().nullable(),
  correo: z.string().trim().max(200).email("Escriba un correo válido.").optional().nullable().or(z.literal("")),
  tipo: z.enum(FEEDBACK_TIPOS),
  descripcion: z.string().trim().min(1, "Describa su duda, el error o la mejora.").max(2000),
  calificacionGeneral: z.number().int().min(1, "La calificación general es de 1 a 5.").max(5).optional().nullable(),
  facilidadUso: z.number().int().min(1, "La facilidad de uso es de 1 a 5.").max(5).optional().nullable(),
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

// Aviso al dueño de la app (campanita) cuando llega una opinión nueva.
// Solo al dueño: se buscan sus hogares por membresía y se le crea un aviso
// en cada uno (normalmente uno: «Hogar Heriberto»). Nunca bloquea el envío:
// cualquier fallo se ignora en silencio y la opinión ya quedó guardada.
async function notifyOwner(tipo: string, nombre: string | null, modulo: string | null): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const { data: members } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", APP_OWNER_USER_ID);
    const householdIds = Array.from(new Set((members ?? []).map((m) => m.household_id).filter((id): id is number => typeof id === "number")));
    if (householdIds.length === 0) return;
    const tipoLabel = FEEDBACK_TIPO_LABELS[tipo as (typeof FEEDBACK_TIPOS)[number]] ?? "Opinión";
    await admin.from("notifications").insert(
      householdIds.map((householdId) => ({
        household_id: householdId,
        user_id: APP_OWNER_USER_ID,
        type: "nueva_opinion",
        title: "Nueva opinión de tester",
        body: `${tipoLabel}${nombre ? ` de ${nombre}` : ""}${modulo ? ` · ${modulo}` : ""}. Revísela en Desarrollador.`,
        amount: null,
        target: "desarrollador",
        is_read: 0,
      })),
    );
  } catch {
    // El aviso nunca bloquea el envío de la opinión.
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const correoRaw = typeof req.query?.correo === "string" ? req.query.correo.trim().toLowerCase() : "";
    if (!correoRaw) return res.status(200).json({ ok: true, service: "syncfinanzas-feedback" });
    try {
      // Límite: 10 consultas por hora por dirección IP.
      await rateLimitDb(`feedback-lookup:${clientIp(req)}`, 10, 3_600_000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoRaw)) {
        return res.status(400).json({ error: "Escriba un correo válido." });
      }
      const admin = supabaseAdmin();
      const baseCols = "id,created_at,nombre,correo,modulo,dispositivo,que_funciono,que_fallo,sugerencia,calificacion_general,facilidad_uso";
      const fullCols = `${baseCols},tipo,descripcion,estado,respuesta`;
      let rows: Record<string, unknown>[] | null = null;
      const full = await admin
        .from("tester_feedback")
        .select(fullCols)
        .eq("correo", correoRaw)
        .order("created_at", { ascending: false })
        .limit(20);
      if (full.error) {
        // Columnas del canal aún no creadas (falta feedback-canal.sql):
        // se responde solo con los campos viejos y estado «Por revisar».
        const old = await admin
          .from("tester_feedback")
          .select(baseCols)
          .eq("correo", correoRaw)
          .order("created_at", { ascending: false })
          .limit(20);
        if (old.error) {
          return res.status(400).json({ error: "No se pudo consultar sus mensajes. Inténtelo más tarde." });
        }
        rows = old.data ?? [];
      } else {
        rows = full.data ?? [];
      }
      return res.status(200).json({
        ok: true,
        mensajes: (rows ?? []).map((r) => ({
          id: r.id as number,
          createdAt: r.created_at as string,
          nombre: (r.nombre as string | null) ?? null,
          tipo: (r.tipo as string | null) ?? null,
          descripcion: (r.descripcion as string | null) ?? null,
          estado: (r.estado as string | null) ?? "por_revisar",
          respuesta: (r.respuesta as string | null) ?? null,
          modulo: (r.modulo as string | null) ?? null,
          queFallo: (r.que_fallo as string | null) ?? null,
          sugerencia: (r.sugerencia as string | null) ?? null,
          calificacionGeneral: (r.calificacion_general as number | null) ?? null,
          facilidadUso: (r.facilidad_uso as number | null) ?? null,
        })),
      });
    } catch (err) {
      errorResponse(res, 400, err, "API feedback error:");
    } finally {
      await closeDb();
    }
    return;
  }
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
        correo: v.correo?.trim().toLowerCase() || null,
        tipo: v.tipo,
        descripcion: v.descripcion.trim(),
        calificacion_general: v.calificacionGeneral ?? null,
        facilidad_uso: v.facilidadUso ?? null,
        que_funciono: v.queFunciono?.trim() || null,
        que_fallo: v.queFallo?.trim() || null,
        sugerencia: v.sugerencia?.trim() || null,
        modulo: v.modulo?.trim() || null,
        dispositivo: v.dispositivo?.trim() || null,
      });
    if (error) {
      // La tabla aún no existe (falta ejecutar supabase/feedback.sql o
      // supabase/feedback-canal.sql) o la base no respondió: error formal,
      // sin detalles internos.
      console.error("API feedback error:", error.message);
      return res.status(400).json({ error: "No se pudo guardar su opinión. Inténtelo de nuevo más tarde." });
    }
    // Aviso al dueño en su campanilla; nunca bloquea el envío.
    await notifyOwner(v.tipo, v.nombre?.trim() || null, v.modulo?.trim() || null);
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Punto 11: al cliente solo un mensaje formal y un identificador de
    // error; el mensaje y el código internos quedan en el registro.
    errorResponse(res, 400, err, "API feedback error:");
  } finally {
    await closeDb();
  }
}
