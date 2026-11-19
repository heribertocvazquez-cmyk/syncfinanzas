// Canal de dudas y mejoras de testers: tipos de mensaje, estados de la
// evaluación del dueño y consulta por correo (el tester ve el estado y la
// respuesta de sus mensajes). Sin correo no hay envío de correos: Resend no
// está configurado y la respuesta se consulta aquí.
export const FEEDBACK_TYPES = ["duda", "error", "mejora"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  duda: "Duda",
  error: "Error o corrección",
  mejora: "Mejora",
};
export const FEEDBACK_TYPE_PLACEHOLDERS: Record<FeedbackType, string> = {
  duda: "Describa su duda: qué no encontró o qué no le quedó claro.",
  error: "Describa el error: qué hizo, qué esperaba y qué pasó.",
  mejora: "Describa la mejora: qué cambiaría o agregaría y para qué.",
};
export const FEEDBACK_STATES = ["por_revisar", "ya_existe", "error_confirmado", "mejora_aprobada", "descartado"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];
export const FEEDBACK_STATE_LABELS: Record<FeedbackState, string> = {
  por_revisar: "Por revisar",
  ya_existe: "Ya existe",
  error_confirmado: "Error confirmado",
  mejora_aprobada: "Mejora aprobada",
  descartado: "Descartado",
};

export type MyFeedbackMessage = {
  id: number;
  createdAt: string;
  nombre: string | null;
  tipo: string | null;
  descripcion: string | null;
  estado: string;
  respuesta: string | null;
  modulo: string | null;
  queFallo: string | null;
  sugerencia: string | null;
  calificacionGeneral: number | null;
  facilidadUso: number | null;
};

/** Consulta los mensajes enviados con un correo (página pública del
 *  formulario). Solo devuelve los de ese correo, con su estado y la
 *  respuesta del dueño. */
export async function fetchMyFeedback(correo: string): Promise<MyFeedbackMessage[]> {
  const res = await fetch(`/api/feedback?correo=${encodeURIComponent(correo.trim().toLowerCase())}`);
  const json = (await res.json().catch(() => null)) as { error?: string; mensajes?: MyFeedbackMessage[] } | null;
  if (!res.ok) throw new Error(json?.error ?? "No se pudo consultar sus mensajes.");
  return json?.mensajes ?? [];
}
