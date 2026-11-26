// Formato de dinero y fechas (MX) y fecha de hoy en ISO. Antes vivían en
// App.tsx; se mueven aquí para que los componentes de Tandas (detalle,
// lista, tarjeta de Inicio) los usen sin importar App.
import { isHouseholdCurrency, type HouseholdCurrency } from "./currency";

// Moneda del hogar (alcance A, 2026-11-26): money()/money2() formatean
// con la moneda del hogar cargado. App la fija al cargar el resumen
// (setHouseholdCurrency) y el valor por defecto es MXN, así los hogares
// que ya existen y las pantallas sin hogar se ven igual que hoy. No hay
// conversión: solo cambia el símbolo con que se muestra el importe.
let householdCurrency: HouseholdCurrency = "MXN";
export function setHouseholdCurrency(c: unknown) {
  if (isHouseholdCurrency(c)) householdCurrency = c;
}
export function getHouseholdCurrency(): HouseholdCurrency {
  return householdCurrency;
}
export const money = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: householdCurrency, maximumFractionDigits: 0 });
export const money2 = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: householdCurrency });
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
