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
