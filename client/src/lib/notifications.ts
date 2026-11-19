// Avisos visibles en la campanilla, en función pura para poder probarla
// en Node. Reglas:
// - Opiniones de testers (reporte de Heriberto 2026-11-18 19:57): una
//   vez revisadas, la notificación «Nueva opinión de tester» ya no debe
//   aparecer. La marca como leída (al abrir la cola o al guardar una
//   evaluación) ya funciona; lo que faltaba es que el panel listaba
//   también las leídas, como historial.
// - Nuevo participante en una tanda (reporte de Heriberto 2026-11-19
//   11:01) y recordatorio de pago de tanda (reporte 2026-11-19 13:49):
//   una vez que ya se vio el aviso, tampoco debe quedarse en la
//   campanilla: al tocarlo se marca leído (openNotif) y al abrir el
//   detalle de la tanda se marcan leídos sus avisos; en ambos casos
//   desaparece del panel. Solo esos tipos con destino «tandas»: el aviso
//   «Nuevo integrante en el hogar» (mismo tipo, destino «hogar») y los
//   demás avisos leídos (pago de tanda, actualización, etc.) siguen
//   visibles como historial, y los avisos sin leer siguen apareciendo.

/** Avisos que se pintan en el panel de la campanilla. */
export function visibleNotifications<T extends { type: string; target: string; isRead: number }>(
  notifications: T[],
): T[] {
  return notifications.filter(
    (n) => !((n.type === "nueva_opinion" || (n.type === "nuevo_integrante" && n.target === "tandas") || (n.type === "recordatorio_tanda" && n.target === "tandas")) && n.isRead),
  );
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
