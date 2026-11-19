// Avisos visibles en la campanilla, en función pura para poder probarla
// en Node. Regla (reporte de Heriberto 2026-11-18 19:57): una vez que el
// dueño entra a revisar las opiniones de testers, la notificación «Nueva
// opinión de tester» ya no debe aparecer en la campanilla. La marca como
// leída (al abrir la cola o al guardar una evaluación) ya funciona; lo que
// faltaba es que el panel listaba también las leídas, como historial. Por
// eso las opiniones ya leídas se excluyen del listado; los demás avisos
// leídos (pago de tanda, actualización, etc.) siguen visibles como
// historial, y las opiniones sin leer siguen apareciendo.

/** Avisos que se pintan en el panel de la campanilla. */
export function visibleNotifications<T extends { type: string; isRead: number }>(
  notifications: T[],
): T[] {
  return notifications.filter((n) => !(n.type === "nueva_opinion" && n.isRead));
}
