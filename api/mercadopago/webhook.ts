// Webhook de Mercado Pago (Checkout Pro, API de Orders) — PRUEBA.
// POST /api/mercadopago/webhook
// Mercado Pago avisa con ?data.id=<id>&type=<orders|payment> y el
// encabezado x-signature. La firma se verifica con MP_TEST_WEBHOOK_SECRET
// (HMAC-SHA256); sin firma válida no se marca nada y se responde 401. El
// aviso solo dice qué cambió: el estado y el importe se leen de la API de
// Mercado Pago y solo entonces se marca pagado el pago de tanda. Si el
// secreto aún no está configurado, se registra y se responde 200 sin
// marcar nada (el pago se puede confirmar desde la app con
// «Verificar pago»). Responder 500 solo ante errores transitorios, para
// que Mercado Pago reintente el aviso.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { closeDb } from "../../server/src/db.js";
import { errorResponse } from "../../server/src/error-response.js";
import {
  mpAccessToken,
  mpGetOrder,
  mpGetPayment,
  mpMarkPaidFromReference,
  mpVerifyWebhookSignature,
  mpWebhookSecret,
  parseMpExternalReference,
} from "../../server/src/mercadopago.js";

function firstStr(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ ok: true, service: "mercadopago-webhook" });
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    const body = (req.body ?? {}) as { data?: { id?: string | number }; type?: string };
    const dataId = firstStr(req.query["data.id"]) ?? (body.data?.id != null ? String(body.data.id) : null);
    const type = firstStr(req.query.type) ?? (typeof body.type === "string" ? body.type : null);
    const requestId = firstStr(req.headers["x-request-id"]) ?? "";
    const signature = firstStr(req.headers["x-signature"]) ?? undefined;
    const secret = mpWebhookSecret();
    if (!secret) {
      console.warn(
        "Mercado Pago webhook: MP_TEST_WEBHOOK_SECRET no configurado; aviso recibido sin verificar, no se marca ningún pago.",
      );
      return res.status(200).json({ ok: true, verified: false, reason: "webhook_secret_not_configured" });
    }
    if (!dataId || !mpVerifyWebhookSignature({ secret, dataId, requestId, signatureHeader: signature })) {
      return res.status(401).json({ error: "Firma del aviso no válida." });
    }
    // Aviso verificado. El cuerpo solo dice qué cambió: se lee el recurso
    // en Mercado Pago antes de decidir nada.
    const token = mpAccessToken();
    if (!token) {
      console.warn(
        "Mercado Pago webhook: MP_TEST_ACCESS_TOKEN no configurado; aviso verificado sin poder consultar el pago.",
      );
      return res.status(200).json({ ok: true, verified: true, reason: "access_token_not_configured" });
    }

    if (type === "payment" || type === "payments") {
      const pay = await mpGetPayment(token, dataId);
      if (pay.status !== "approved") {
        return res.status(200).json({ ok: true, verified: true, paid: false, status: pay.status });
      }
      const ref = parseMpExternalReference(pay.externalReference ?? "");
      if (!ref || pay.amount == null) {
        console.warn("Mercado Pago webhook: pago aprobado sin referencia de tanda válida.");
        return res.status(200).json({ ok: true, verified: true, paid: false, reason: "no_tanda_reference" });
      }
      const result = await mpMarkPaidFromReference({
        tandaId: ref.tandaId,
        quincenaIndex: ref.quincenaIndex,
        payerEmail: pay.payerEmail,
        payerUserId: ref.userId,
        paidDate: pay.paidDate,
        approvedAmount: pay.amount,
      });
      return res
        .status(200)
        .json({ ok: true, verified: true, paid: result.marked || result.reason === "already_paid", reason: result.reason });
    }

    if (type === "orders" || type === "order") {
      const order = await mpGetOrder(token, dataId);
      const ref = parseMpExternalReference(order.externalReference ?? "");
      if (!ref) {
        console.warn("Mercado Pago webhook: orden sin referencia de tanda válida.");
        return res.status(200).json({ ok: true, verified: true, paid: false, reason: "no_tanda_reference" });
      }
      if (!order.approved) {
        return res.status(200).json({ ok: true, verified: true, paid: false, status: order.status });
      }
      const result = await mpMarkPaidFromReference({
        tandaId: ref.tandaId,
        quincenaIndex: ref.quincenaIndex,
        payerEmail: order.payerEmail ?? order.approved.payerEmail,
        payerUserId: ref.userId,
        paidDate: order.approved.paidDate,
        approvedAmount: order.approved.amount,
      });
      return res
        .status(200)
        .json({ ok: true, verified: true, paid: result.marked || result.reason === "already_paid", reason: result.reason });
    }

    // Otros avisos (por ejemplo, pruebas de Mercado Pago): se reciben y no
    // se hace nada con ellos.
    console.log("Mercado Pago webhook: aviso ignorado, tipo:", type ?? "sin tipo");
    return res.status(200).json({ ok: true, verified: true, paid: false, reason: "ignored_type" });
  } catch (err) {
    // Error transitorio (Mercado Pago o base no responden): 500 para que
    // Mercado Pago reintente el aviso. El pago también se puede confirmar
    // desde la app con «Verificar pago».
    errorResponse(res, 500, err, "Mercado Pago webhook error:");
  } finally {
    await closeDb();
  }
}
