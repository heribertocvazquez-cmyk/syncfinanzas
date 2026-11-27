// Aviso dirigido al organizador (dueño) de una tanda cuando un participante
// sube el comprobante de su pago. La campanita es por usuario
// (notifications.user_id), así que el aviso va SOLO al dueño de la tanda —
// nunca a todo el hogar — porque es él quien valida el pago comparando el
// importe del comprobante con el monto de la tanda.
//
// Nunca bloquea el pago: si la tabla de avisos aún no existe (falta correr
// supabase/notifications.sql) o el organizador no tiene usuario, no se crea
// nada y el pago sigue. El organizador se resuelve por su perfil
// (organizerProfileId); si ese perfil no tiene usuario, el aviso va al
// administrador del hogar, que es quien puede validar en su lugar.
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import type { Db } from "./db.js";

// Misma tolerancia que la revisión del comprobante en el cliente
// (TandaDetail): un importe leído difiere del monto de la tanda solo si
// se separa más de $0.51.
export const TANDA_PROOF_MISMATCH_TOLERANCE = 0.51;

export type TandaProofNotif = {
  type: "pago_tanda";
  title: string;
  body: string;
  amount: number | null;
  target: "tandas";
};

export function proofAmountsMatch(readAmount: number | null, tandaAmount: number): boolean {
  return readAmount != null && Number.isFinite(readAmount) && Math.abs(readAmount - tandaAmount) <= TANDA_PROOF_MISMATCH_TOLERANCE;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fmtDateEs(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS_ES[(m || 1) - 1]} ${y}`;
}

const money2 = (n: number) => `$${n.toFixed(2)}`;

// Cuerpo del aviso: quién pagó, qué tanda, qué periodo y el monto, con la
// comparación contra el monto de la tanda para que el organizador valide
// sin abrir el comprobante.
export function buildTandaProofNotification(args: {
  payerName: string;
  tandaName: string;
  quincenaIndex: number;
  quincenaDate: string | null;
  readAmount: number | null;
  tandaAmount: number;
}): TandaProofNotif {
  const { payerName, tandaName, quincenaIndex, quincenaDate, readAmount, tandaAmount } = args;
  const period = `periodo ${quincenaIndex + 1}${fmtDateEs(quincenaDate) ? ` (${fmtDateEs(quincenaDate)})` : ""}`;
  const amountLine =
    readAmount == null
      ? "No se pudo leer el importe del comprobante. Revise el comprobante antes de verificar."
      : proofAmountsMatch(readAmount, tandaAmount)
        ? `Importe del comprobante: ${money2(readAmount)}. Coincide con el monto de la tanda (${money2(tandaAmount)}).`
        : `Importe del comprobante: ${money2(readAmount)}. No coincide con el monto de la tanda (${money2(tandaAmount)}). Revise antes de verificar.`;
  return {
    type: "pago_tanda",
    title: "Comprobante de pago de tanda",
    body: `${payerName} subió el comprobante de su pago de la tanda ${tandaName}, ${period}. ${amountLine}`,
    amount: readAmount,
    target: "tandas",
  };
}

// La base que usa esta vía es solo leer perfiles del hogar y crear un
// aviso; se tipa con la base real (solo sus métodos select/insert) y las
// pruebas pasan una base falsa con el mismo uso.
export async function notifyTandaOrganizer(
  db: Pick<Db, "select" | "insert">,
  args: {
    householdId: number;
    organizerProfileId: number | null;
    payerName: string;
    tandaName: string;
    quincenaIndex: number;
    quincenaDate: string | null;
    readAmount: number | null;
    tandaAmount: number;
    excludeUserId?: string | null;
  },
): Promise<{ notifiedUserId: string | null }> {
  try {
    const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
    const org = args.organizerProfileId != null ? profs.find((p) => p.id === args.organizerProfileId) : null;
    const admin = profs.find((p) => p.role === "admin");
    const targetUserId: string | null = org?.userId ?? admin?.userId ?? null;
    if (!targetUserId) return { notifiedUserId: null };
    if (args.excludeUserId && targetUserId === args.excludeUserId) return { notifiedUserId: null };
    const n = buildTandaProofNotification(args);
    await db
      .insert(schema.notifications)
      .values([{ householdId: args.householdId, userId: targetUserId, type: n.type, title: n.title, body: n.body, amount: n.amount, target: n.target, isRead: 0 }]);
    return { notifiedUserId: targetUserId };
  } catch {
    return { notifiedUserId: null };
  }
}

// Aviso al organizador de una tanda cuando alguien sube el comprobante
// de una multa (candado de multas, espejo del de pagos, 2026-11-26). El
// aviso va SOLO al organizador — nunca a todo el hogar — igual que el de
// comprobante de pago, porque es él quien verifica la multa. Nunca
// bloquea el pago de la multa.
export type TandaFineProofNotif = {
  type: "pago_tanda";
  title: string;
  body: string;
  amount: number | null;
  target: "tandas";
};

export function buildTandaFineProofNotification(args: {
  finedName: string;
  tandaName: string;
  quincenaIndex: number;
  fineAmount: number;
}): TandaFineProofNotif {
  return {
    type: "pago_tanda",
    title: "Comprobante de multa de tanda",
    body: `${args.finedName} subió el comprobante de su multa de la tanda ${args.tandaName}, periodo ${args.quincenaIndex + 1}, por ${money2(args.fineAmount)}. Revise el comprobante antes de verificar.`,
    amount: args.fineAmount,
    target: "tandas",
  };
}

export async function notifyTandaOrganizerFine(
  db: Pick<Db, "select" | "insert">,
  args: {
    householdId: number;
    organizerProfileId: number | null;
    finedName: string;
    tandaName: string;
    quincenaIndex: number;
    fineAmount: number;
    excludeUserId?: string | null;
  },
): Promise<{ notifiedUserId: string | null }> {
  try {
    const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
    const org = args.organizerProfileId != null ? profs.find((p) => p.id === args.organizerProfileId) : null;
    const admin = profs.find((p) => p.role === "admin");
    const targetUserId: string | null = org?.userId ?? admin?.userId ?? null;
    if (!targetUserId) return { notifiedUserId: null };
    if (args.excludeUserId && targetUserId === args.excludeUserId) return { notifiedUserId: null };
    const n = buildTandaFineProofNotification(args);
    await db
      .insert(schema.notifications)
      .values([{ householdId: args.householdId, userId: targetUserId, type: n.type, title: n.title, body: n.body, amount: n.amount, target: n.target, isRead: 0 }]);
    return { notifiedUserId: targetUserId };
  } catch {
    return { notifiedUserId: null };
  }
}

// Aviso al organizador de una tanda cuando alguien acepta su invitación
// con otro correo distinto al invitado. El enlace (token) es la
// credencial: quien lo tiene puede aceptar con el correo de su cuenta, y
// el organizador debe saber con qué correo entró realmente la persona
// (la invitación se envió a otro). El aviso va SOLO al organizador —
// nunca a todo el hogar — igual que el de comprobante de pago. Nunca
// bloquea la aceptación: si la tabla de avisos aún no existe (falta
// correr supabase/notifications.sql) o el organizador no tiene usuario,
// no se crea nada y la aceptación sigue.
export type TandaAcceptOtherEmailNotif = {
  type: "aceptacion_otro_correo";
  title: string;
  body: string;
  amount: null;
  target: "tandas";
};

export function buildTandaAcceptOtherEmailNotification(args: {
  acceptorName: string;
  tandaName: string;
  realEmail: string;
  invitedEmail: string;
}): TandaAcceptOtherEmailNotif {
  return {
    type: "aceptacion_otro_correo",
    title: "Invitación aceptada con otro correo",
    body: `${args.acceptorName} aceptó la invitación a la tanda «${args.tandaName}» con ${args.realEmail} (invitación enviada a ${args.invitedEmail}).`,
    amount: null,
    target: "tandas",
  };
}

export async function notifyTandaOrganizerAcceptOtherEmail(
  db: Pick<Db, "select" | "insert">,
  args: {
    householdId: number;
    organizerProfileId: number | null;
    acceptorName: string;
    tandaName: string;
    realEmail: string;
    invitedEmail: string;
    excludeUserId?: string | null;
  },
): Promise<{ notifiedUserId: string | null }> {
  try {
    const profs = await db.select().from(schema.profiles).where(eq(schema.profiles.householdId, args.householdId));
    const org = args.organizerProfileId != null ? profs.find((p) => p.id === args.organizerProfileId) : null;
    const admin = profs.find((p) => p.role === "admin");
    const targetUserId: string | null = org?.userId ?? admin?.userId ?? null;
    if (!targetUserId) return { notifiedUserId: null };
    if (args.excludeUserId && targetUserId === args.excludeUserId) return { notifiedUserId: null };
    const n = buildTandaAcceptOtherEmailNotification(args);
    await db
      .insert(schema.notifications)
      .values([{ householdId: args.householdId, userId: targetUserId, type: n.type, title: n.title, body: n.body, amount: n.amount, target: n.target, isRead: 0 }]);
    return { notifiedUserId: targetUserId };
  } catch {
    return { notifiedUserId: null };
  }
}
