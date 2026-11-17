// Mercado Pago (Checkout Pro, API de Orders) — PRUEBA (sandbox).
// El Access Token de prueba y el secreto del webhook viven SOLO en
// variables de entorno de Vercel (MP_TEST_ACCESS_TOKEN y
// MP_TEST_WEBHOOK_SECRET). Nunca van en el código ni en el cliente: el
// navegador solo recibe la URL del checkout. Sin la clave de prueba, las
// acciones devuelven un error claro y la app sigue funcionando (el pago se
// puede registrar con comprobante, como siempre).
// El dinero cae en la cuenta que posee el Access Token (la del
// organizador), nunca en una cuenta de SyncFinanzas. Nunca se marca un
// pago como pagado a partir del aviso del webhook solo: el estado y el
// importe se leen siempre de la API de Mercado Pago.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import * as schema from "./schema.js";

const MP_API = "https://api.mercadopago.com";
// Tolerancia al comparar importes (centavos por redondeo), igual que la
// comparación del lector de comprobantes.
const AMOUNT_TOLERANCE = 0.51;

export function mpAccessToken(): string | null {
  return process.env.MP_TEST_ACCESS_TOKEN?.trim() || null;
}

export function mpWebhookSecret(): string | null {
  return process.env.MP_TEST_WEBHOOK_SECRET?.trim() || null;
}

export function requireMpToken(): string {
  const token = mpAccessToken();
  if (!token) {
    throw new Error(
      "El pago con Mercado Pago no está configurado en este despliegue (falta la clave de prueba). El pago se puede registrar con comprobante, como siempre.",
    );
  }
  return token;
}

/** Importe con dos decimales, como lo exige la API de Orders. */
export function mpMoney(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Referencia externa que identifica el pago de tanda en Mercado Pago:
 *  tanda-<id>-ronda-<n>-<usuario>, con n = periodo (1 en adelante). */
export function mpExternalReference(tandaId: number, quincenaIndex: number, userId: string): string {
  return `tanda-${tandaId}-ronda-${quincenaIndex + 1}-${userId}`;
}

export function parseMpExternalReference(
  ref: string,
): { tandaId: number; quincenaIndex: number; userId: string } | null {
  const m = /^tanda-(\d+)-ronda-(\d+)-(.+)$/.exec(ref.trim());
  if (!m) return null;
  const tandaId = Number(m[1]);
  const round = Number(m[2]);
  const userId = m[3] ?? "";
  if (!Number.isInteger(tandaId) || !Number.isInteger(round) || round < 1 || !userId) return null;
  return { tandaId, quincenaIndex: round - 1, userId };
}

function numVal(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function datePart(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function payerEmailOf(obj: Record<string, unknown>): string | null {
  const payer = obj.payer;
  if (payer && typeof payer === "object") {
    const email = (payer as Record<string, unknown>).email;
    if (typeof email === "string" && email.includes("@")) return email;
  }
  return null;
}

async function mpFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body: body ?? {} };
}

/** Crea la orden de pago (POST /v1/orders). Devuelve el id de la orden y
 *  la URL del checkout donde paga el integrante. */
export async function mpCreateOrder(
  token: string,
  args: { amount: number; externalReference: string; title: string; payerEmail: string },
): Promise<{ orderId: string; checkoutUrl: string }> {
  const amount = mpMoney(args.amount);
  const { status, body } = await mpFetch(token, "/v1/orders", {
    method: "POST",
    headers: { "X-Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      type: "online",
      processing_mode: "manual",
      total_amount: amount,
      external_reference: args.externalReference,
      items: [{ title: args.title, unit_price: amount, quantity: 1 }],
      payer: { email: args.payerEmail },
    }),
  });
  if (status !== 201 && status !== 200) {
    console.error("Mercado Pago create order error:", status, typeof body.message === "string" ? body.message : "");
    throw new Error("Mercado Pago no creó la orden de pago. Inténtelo de nuevo.");
  }
  const orderId = typeof body.id === "string" ? body.id : "";
  const checkoutUrl =
    typeof body.checkout_url === "string"
      ? body.checkout_url
      : typeof body.sandbox_init_point === "string"
        ? body.sandbox_init_point
        : typeof body.init_point === "string"
          ? body.init_point
          : "";
  if (!orderId || !checkoutUrl) {
    console.error("Mercado Pago create order: respuesta sin id o sin URL de pago.");
    throw new Error("Mercado Pago no devolvió la orden de pago. Inténtelo de nuevo.");
  }
  return { orderId, checkoutUrl };
}

export type MpApprovedPayment = { amount: number; paidDate: string | null; payerEmail: string | null };
export type MpOrderRead = {
  id: string;
  status: string;
  totalAmount: number | null;
  externalReference: string | null;
  payerEmail: string | null;
  approved: MpApprovedPayment | null;
};

/** Lee una orden (GET /v1/orders/{id}). `approved` solo viene cuando un
 *  pago de la orden está aprobado; si no, es null aunque la orden exista. */
export async function mpGetOrder(token: string, orderId: string): Promise<MpOrderRead> {
  const { status, body } = await mpFetch(token, `/v1/orders/${encodeURIComponent(orderId)}`);
  if (status !== 200) {
    console.error("Mercado Pago get order error:", status);
    throw new Error("No se pudo consultar la orden en Mercado Pago. Inténtelo de nuevo.");
  }
  const totalAmount = numVal(body.total_amount);
  const payments = Array.isArray(body.payments) ? (body.payments as Record<string, unknown>[]) : [];
  let approved: MpApprovedPayment | null = null;
  for (const p of payments) {
    if (String(p.status ?? "") !== "approved") continue;
    const amt = numVal(p.transaction_amount ?? p.amount ?? p.total_amount);
    if (amt == null) continue;
    approved = {
      amount: amt,
      paidDate: datePart(
        typeof p.date_approved === "string" ? p.date_approved : typeof p.date_created === "string" ? p.date_created : null,
      ),
      payerEmail: payerEmailOf(p) ?? payerEmailOf(body),
    };
    break;
  }
  if (!approved && String(body.status ?? "") === "approved" && totalAmount != null) {
    approved = {
      amount: totalAmount,
      paidDate: datePart(typeof body.last_updated_date === "string" ? body.last_updated_date : null),
      payerEmail: payerEmailOf(body),
    };
  }
  return {
    id: typeof body.id === "string" ? body.id : orderId,
    status: String(body.status ?? ""),
    totalAmount,
    externalReference: typeof body.external_reference === "string" ? body.external_reference : null,
    payerEmail: payerEmailOf(body),
    approved,
  };
}

export type MpPaymentRead = {
  id: string;
  status: string;
  amount: number | null;
  externalReference: string | null;
  paidDate: string | null;
  payerEmail: string | null;
};

/** Lee un pago (GET /v1/payments/{id}). */
export async function mpGetPayment(token: string, paymentId: string): Promise<MpPaymentRead> {
  const { status, body } = await mpFetch(token, `/v1/payments/${encodeURIComponent(paymentId)}`);
  if (status !== 200) {
    console.error("Mercado Pago get payment error:", status);
    throw new Error("No se pudo consultar el pago en Mercado Pago. Inténtelo de nuevo.");
  }
  return {
    id: typeof body.id === "string" ? body.id : paymentId,
    status: String(body.status ?? ""),
    amount: numVal(body.transaction_amount ?? body.amount),
    externalReference: typeof body.external_reference === "string" ? body.external_reference : null,
    paidDate: datePart(
      typeof body.date_approved === "string" ? body.date_approved : typeof body.date_created === "string" ? body.date_created : null,
    ),
    payerEmail: payerEmailOf(body),
  };
}

/** Verifica la firma x-signature de un aviso de Mercado Pago
 *  (HMAC-SHA256 del manifiesto `id:<data.id>;request-id:<x-request-id>;
 *  ts:<ts>;` con el secreto del webhook, comparado con el valor v1). */
export function mpVerifyWebhookSignature(args: {
  secret: string;
  dataId: string;
  requestId: string;
  signatureHeader: string | undefined;
}): boolean {
  const header = args.signatureHeader ?? "";
  const parts: Record<string, string> = {};
  for (const p of header.split(",")) {
    const eqAt = p.indexOf("=");
    if (eqAt > 0) parts[p.slice(0, eqAt).trim()] = p.slice(eqAt + 1).trim();
  }
  const ts = parts.ts ?? "";
  const v1 = parts.v1 ?? "";
  if (!ts || !v1) return false;
  const manifest = `id:${args.dataId};request-id:${args.requestId};ts:${ts};`;
  const digest = createHmac("sha256", args.secret).update(manifest).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Marca pagado el pago de tanda de un pago aprobado de Mercado Pago.
 *  Solo se llama DESPUÉS de verificar en la API que el pago está aprobado
 *  y que el importe coincide con el de la tanda. Si el pago ya estaba
 *  pagado no hace nada (idempotente: Mercado Pago puede reintentar el
 *  aviso y la persona puede pulsar «Verificar pago» varias veces). El
 *  pago queda pagado sin verificar, igual que al registrarlo con
 *  comprobante: el organizador aún lo verifica. */
export async function mpMarkPaidFromReference(args: {
  tandaId: number;
  quincenaIndex: number;
  participantId?: number | null;
  payerEmail?: string | null;
  payerUserId?: string | null;
  paidDate?: string | null;
  approvedAmount: number;
}): Promise<{ marked: boolean; reason: string }> {
  const db = getDb();
  const tdRows = await db.select().from(schema.tandas).where(eq(schema.tandas.id, args.tandaId)).limit(1);
  const td = tdRows[0];
  if (!td) return { marked: false, reason: "tanda_not_found" };
  if (Math.abs(args.approvedAmount - td.amountPerQuincena) > AMOUNT_TOLERANCE) {
    return { marked: false, reason: "amount_mismatch" };
  }
  const parts = await db.select().from(schema.tandaParticipants).where(eq(schema.tandaParticipants.tandaId, args.tandaId));
  let participant = args.participantId != null ? (parts.find((p) => p.id === args.participantId) ?? null) : null;
  if (!participant && args.payerEmail) {
    const email = args.payerEmail.trim().toLowerCase();
    participant = parts.find((p) => (p.email || "").trim().toLowerCase() === email) ?? null;
  }
  if (!participant && args.payerUserId) {
    const profs = await db
      .select()
      .from(schema.profiles)
      .where(and(eq(schema.profiles.householdId, td.householdId), eq(schema.profiles.userId, args.payerUserId)));
    const email = profs[0]?.email?.trim().toLowerCase();
    if (email) participant = parts.find((p) => (p.email || "").trim().toLowerCase() === email) ?? null;
  }
  if (!participant) return { marked: false, reason: "participant_not_found" };
  const rows = await db.select().from(schema.tandaPayments).where(eq(schema.tandaPayments.tandaId, args.tandaId));
  const mine = rows.find((r) => r.participantId === participant.id && r.quincenaIndex === args.quincenaIndex);
  if (mine?.status === "paid") return { marked: false, reason: "already_paid" };
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const paidDate =
    args.paidDate && !Number.isNaN(new Date(`${args.paidDate}T00:00:00`).getTime()) ? args.paidDate : todayStr;
  if (mine) {
    await db
      .update(schema.tandaPayments)
      .set({ status: "paid", paidDate, verified: 0 })
      .where(eq(schema.tandaPayments.id, mine.id));
  } else {
    await db.insert(schema.tandaPayments).values({
      householdId: td.householdId,
      tandaId: args.tandaId,
      participantId: participant.id,
      quincenaIndex: args.quincenaIndex,
      status: "paid",
      paidDate,
      proofBlobKey: null,
      verified: 0,
    });
  }
  return { marked: true, reason: "ok" };
}
