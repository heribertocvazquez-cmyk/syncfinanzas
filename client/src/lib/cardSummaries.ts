// Resúmenes de las tarjetas plegables, en funciones puras para poder
// probarlas en Node. Decisión de Heriberto 2026-11-18: cada tarjeta
// agrupada muestra su total sin abrirla — una línea compacta, siempre
// visible, calculada con los mismos datos que la tarjeta ya muestra
// (misma regla de visibilidad, mismos filtros). Las líneas se pintan con
// el slot `above` de CollapsibleCard (bajo el título, arriba del control
// «Ver»); las que ya tenían su total en `below` lo conservan ahí.
// Los movimientos reversados y las reversiones quedan fuera de los
// totales, igual que en la línea de conteos del módulo Movimientos.

/** Totales del mes: ingresos y salidas, sin reversados ni reversiones. */
export function sumMonthMovements(
  movs: {
    type: string;
    amount: number;
    isReversed?: boolean;
    reversalOfId?: number | null;
  }[],
): { income: number; expense: number; count: number } {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const m of movs) {
    if (m.isReversed || m.reversalOfId != null) continue;
    count++;
    if (m.type === "income") income += m.amount;
    else expense += m.amount;
  }
  return { income, expense, count };
}

/** Total de los presupuestos añadidos y lo gastado de ellos. */
export function sumBudgets(
  budgets: { amount: number; spent: number }[],
): { total: number; spent: number; count: number } {
  let total = 0;
  let spent = 0;
  for (const b of budgets) {
    total += b.amount;
    spent += b.spent;
  }
  return { total, spent, count: budgets.length };
}

/** Total ahorrado y objetivo de las metas. */
export function sumGoals(
  goals: { savedAmount: number; targetAmount: number }[],
): { saved: number; target: number; count: number } {
  let saved = 0;
  let target = 0;
  for (const g of goals) {
    saved += g.savedAmount;
    target += g.targetAmount;
  }
  return { saved, target, count: goals.length };
}

/** Historial de arqueos: cuántos hay, cuántos con diferencia y la
 * diferencia neta (negativa = falta, positiva = sobra). */
export function sumCashCounts(
  counts: { totalDiff: number }[],
): { total: number; withDiff: number; netDiff: number } {
  let withDiff = 0;
  let netDiff = 0;
  for (const c of counts) {
    if (c.totalDiff !== 0) withDiff++;
    netDiff += c.totalDiff;
  }
  return { total: counts.length, withDiff, netDiff };
}

/** Total a repartir entre los adultos del hogar. */
export function sumContributions(
  contributions: { shouldPay: number }[],
): { total: number; count: number } {
  let total = 0;
  for (const c of contributions) total += c.shouldPay;
  return { total, count: contributions.length };
}

/** Invitaciones al hogar: totales por estado. */
export function invitationCounts(
  invitations: { status: string }[],
): { total: number; pending: number; accepted: number; rejected: number } {
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  for (const iv of invitations) {
    if (iv.status === "pending") pending++;
    else if (iv.status === "accepted") accepted++;
    else if (iv.status === "rejected") rejected++;
  }
  return { total: invitations.length, pending, accepted, rejected };
}

/** Multas de una tanda: importe pendiente y pagado. */
export function tandaFinesSummary(
  fines: { amount: number; status: string }[],
): { total: number; pendingAmount: number; paidAmount: number; pendingCount: number; paidCount: number } {
  let pendingAmount = 0;
  let paidAmount = 0;
  let pendingCount = 0;
  let paidCount = 0;
  for (const f of fines) {
    if (f.status === "pagada") {
      paidAmount += f.amount;
      paidCount++;
    } else {
      pendingAmount += f.amount;
      pendingCount++;
    }
  }
  return { total: fines.length, pendingAmount, paidAmount, pendingCount, paidCount };
}

/** Pase de lista de la ronda actual: cuántos pagaron, van atrasados o
 * siguen pendientes. Los participantes excluidos no cuentan. */
export function tandaMeetingSummary(
  items: { participantId: number; status: string }[],
  participants: { id: number; excluded?: number }[],
): { paid: number; late: number; pending: number; total: number } {
  let paid = 0;
  let late = 0;
  let pending = 0;
  let total = 0;
  for (const it of items) {
    const pt = participants.find((p) => p.id === it.participantId);
    if (pt?.excluded === 1) continue;
    total++;
    if (it.status === "paid") paid++;
    else if (it.status === "late") late++;
    else pending++;
  }
  return { paid, late, pending, total };
}

/** Calendario de entregas de una tanda: periodos, cuántos ya tienen
 * receptor y cuántas entregas confirmó el organizador. */
export function tandaCalendarSummary(
  calendar: { index: number; receiverName?: string | null }[],
  deliveries: { quincenaIndex: number; organizerConfirmed?: number }[],
): { periods: number; assigned: number; confirmed: number } {
  let assigned = 0;
  let confirmed = 0;
  for (const c of calendar) {
    if (c.receiverName) assigned++;
    if (
      deliveries.some(
        (d) => d.quincenaIndex === c.index && d.organizerConfirmed === 1,
      )
    ) {
      confirmed++;
    }
  }
  return { periods: calendar.length, assigned, confirmed };
}

/** Pagos por participante de una tanda, en todos los periodos: cuántos
 * pagos están verificados, cuántos pagados sin verificar y cuántos
 * pendientes. El total es periodos × participantes. */
export function tandaPaymentsSummary(
  calendar: { index: number }[],
  participants: { id: number }[],
  payments: {
    participantId: number;
    quincenaIndex: number;
    status: string;
    verified?: number;
  }[],
): { verified: number; unverified: number; pending: number; total: number } {
  let verified = 0;
  let unverified = 0;
  let pending = 0;
  for (const c of calendar) {
    for (const pt of participants) {
      const pay = payments.find(
        (p) => p.participantId === pt.id && p.quincenaIndex === c.index,
      );
      if (pay?.status === "paid" && pay.verified === 1) verified++;
      else if (pay?.status === "paid") unverified++;
      else pending++;
    }
  }
  return { verified, unverified, pending, total: calendar.length * participants.length };
}

/** Pagos pendientes en todas las tandas (para «Mis tandas» de Personal). */
export function tandaPendingCount(
  tandas: { payments: { status: string }[] }[],
): number {
  let n = 0;
  for (const td of tandas) {
    for (const p of td.payments) if (p.status !== "paid") n++;
  }
  return n;
}

/** Guías por segmento: cuántas guías hay en cuántos segmentos. */
export function guideCounts(
  groups: { tabs: unknown[] }[],
): { guides: number; segments: number } {
  let guides = 0;
  for (const g of groups) guides += g.tabs.length;
  return { guides, segments: groups.length };
}

/** Categorías de un lado: cuántas categorías y subcategorías tiene. */
export function categoryCounts(
  categories: { kind: string; subcategories: string[] }[],
  kind: string,
): { count: number; subCount: number } {
  let count = 0;
  let subCount = 0;
  for (const c of categories) {
    if (c.kind !== kind) continue;
    count++;
    subCount += c.subcategories.length;
  }
  return { count, subCount };
}
