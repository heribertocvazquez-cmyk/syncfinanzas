// Formato de dinero y fechas (MX) y fecha de hoy en ISO. Antes vivían en
// App.tsx; se mueven aquí para que los componentes de Tandas (detalle,
// lista, tarjeta de Inicio) los usen sin importar App.
export const money = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const money2 = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
export function fmtDate(iso: string) {
  const [y = 2026, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
