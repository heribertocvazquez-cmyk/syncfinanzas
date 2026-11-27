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

// Fecha en formato corto de México (dd/mm/aaaa) para campos que se teclean
// directo: el input nativo type="date" no acepta teclear «01/12/2026»
// (verificado en pantalla 2026-11-26/27) y en el teléfono abre el
// selector. Se teclea el texto y se guarda en ISO.
export function isoToDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function isValidYMD(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}
export function parseDMYToISO(text: string): string | null {
  const t = (text || "").trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (isValidYMD(y, mo, d)) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (isValidYMD(y, mo, d)) return t;
    return null;
  }
  return null;
}
