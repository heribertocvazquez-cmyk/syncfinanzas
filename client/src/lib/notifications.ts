// Avisos visibles en la campanilla, en función pura para poder probarla
// en Node. Regla vigente (orden de Heriberto 2026-11-20 02:26): cuando se
// pulsa una notificación, ya no debe volver a estar ahí — TODA notificación
// leída desaparece del panel, sea del tipo que sea. Antes (rondas 0ed0993,
// 27ff092 y 81844a5) solo se ocultaban las leídas de tres tipos y las demás
// quedaban como historial; esa regla queda reemplazada: las leídas ya no
// se pintan como historial. Las sin leer siguen apareciendo hasta
// pulsarlas; «Marcar todas como leídas» las marca todas y, con esta regla,
// todas desaparecen del panel.

/** Avisos que se pintan en el panel de la campanilla: solo los sin leer. */
export function visibleNotifications<T extends { type: string; target: string; isRead: number }>(
  notifications: T[],
): T[] {
  return notifications.filter((n) => !n.isRead);
}

// Nombre de la tanda que nombra el cuerpo de un aviso, según su tipo.
// Los cuerpos los escribe el servidor (server/src/actions.ts,
// server/src/tandaNotify.ts):
//  - recordatorio_tanda: «Recordatorio de pago de la tanda «Tanda
//    Smoke», periodo 1 (21 nov 2026): el monto es $100.»
//  - nuevo_integrante: «Ren Emille se unió a la tanda Tanda Smoke.»
//  - pago_tanda: «Ren Emille subió el comprobante de su pago de la
//    tanda Tanda Smoke, periodo 1. ...»
// Sin nombre (u otro tipo) devuelve null: el toque cae a la pestaña.
function tandaNameFromNotification(n: { type: string; body: string }): string | null {
  const body = n.body || "";
  if (n.type === "recordatorio_tanda") {
    const m = body.match(/tanda «([^»]+)»/);
    return m ? (m[1] ?? null) : null;
  }
  if (n.type === "nuevo_integrante") {
    const m = body.match(/se unió a la tanda (.+)\.$/);
    return m ? (m[1] ?? null) : null;
  }
  if (n.type === "pago_tanda") {
    const m = body.match(/la tanda (.+?), /);
    return m ? (m[1] ?? null) : null;
  }
  return null;
}

/** Id de la tanda a la que apunta un aviso con destino «tandas», por el
 *  nombre que nombra su cuerpo (la tabla de avisos no guarda tandaId).
 *  Devuelve null si el aviso no nombra ninguna tanda conocida: el toque
 *  cae a la lista de Tandas. */
export function findTandaForNotification<T extends { id: number; name: string }>(
  n: { type: string; target: string; body: string },
  tandas: T[],
): number | null {
  if (n.target !== "tandas") return null;
  const name = tandaNameFromNotification(n);
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return tandas.find((t) => t.name.trim().toLowerCase() === key)?.id ?? null;
}
