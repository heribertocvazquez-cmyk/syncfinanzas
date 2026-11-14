// Envío de invitaciones por correo (Resend, plan gratuito: 100 correos/día).
// Solo se usa en el servidor (Vercel Functions). Una sola variable:
//   RESEND_API_KEY — clave de Resend (https://resend.com/api-keys).
// Remitente: RESEND_FROM si está configurado (por ejemplo, con dominio
// propio verificado); por defecto, onboarding@resend.dev, que Resend
// permite usar sin dominio verificado (solo para pruebas y piloto).
// Sin RESEND_API_KEY no se envía nada y no se falla en silencio: las
// acciones devuelven emailSent=false y la interfaz muestra el enlace de
// invitación para copiarlo como respaldo.
const RESEND_URL = "https://api.resend.com/emails";

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function mailFrom(): string {
  return process.env.RESEND_FROM || "SyncFinanzas <onboarding@resend.dev>";
}

export interface InviteMail {
  to: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  bodyText: string;
  inviteUrl: string;
  buttonLabel?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function inviteEmailHtml(m: InviteMail): string {
  const buttonLabel = m.buttonLabel ?? "Abrir invitación";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(m.subject)}</title></head><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2b33;background:#f4f6f5;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e2e8e6;"><p style="color:#c5962c;font-weight:bold;letter-spacing:1px;font-size:12px;margin:0 0 8px;">SYNCFINANZAS · FINANZAS DEL HOGAR</p><h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(m.heading)}</h1>${m.bodyHtml}<p style="margin:24px 0;"><a href="${escapeHtml(m.inviteUrl)}" style="display:inline-block;background:#0e2f3d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;">${escapeHtml(buttonLabel)}</a></p><p style="font-size:13px;color:#5b6b72;">Si el botón no funciona, copie y pegue este enlace en su navegador:<br><a href="${escapeHtml(m.inviteUrl)}">${escapeHtml(m.inviteUrl)}</a></p><p style="font-size:13px;color:#5b6b72;">Este enlace es personal, de un solo uso y tiene una vigencia de 7 días. Si usted no esperaba esta invitación, puede ignorar este correo.</p><p style="font-size:12px;color:#8a979d;margin-top:24px;">SyncFinanzas — Finanzas del hogar, claras y compartidas.</p></div></body></html>`;
}

export async function sendInviteEmail(m: InviteMail): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: "RESEND_API_KEY no está configurada en este despliegue." };
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mailFrom(),
        to: [m.to],
        subject: m.subject,
        html: inviteEmailHtml(m),
        text: `${m.heading}\n\n${m.bodyText}\n\nAbrir invitación: ${m.inviteUrl}\n\nEste enlace es personal, de un solo uso y tiene una vigencia de 7 días.`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, error: `Resend respondió ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "No se pudo enviar el correo." };
  }
}
