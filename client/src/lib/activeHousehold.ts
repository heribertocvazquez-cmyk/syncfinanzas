// Hogar activo en este dispositivo (selector «Cambiar de hogar»).
//
// El hogar activo es una elección DEL DISPOSITIVO: se guarda en
// localStorage («sf-household») y toda la app carga los datos de ese
// hogar (getOverview con householdId). El problema era que no había
// elección: el despachador siempre tomaba la membresía más antigua, así
// que quien entraba a un segundo hogar (por invitación o por código)
// seguía viendo solo su primer hogar, incluso tras cerrar sesión y
// volver a entrar.
//
// Reglas de resolución (resolveActiveHouseholdId):
//   1. La elección guardada solo vale si el hogar está en las membresías
//      de la cuenta actual (la lista `households` que devuelve
//      getOverview). El servidor además la valida en el despachador
//      (requireMember): si la cuenta no es integrante, la petición se
//      rechaza y la app vuelve al hogar más antiguo.
//   2. La elección se guarda con la cuenta que la hizo (marca
//      «sf-household-user», mismo patrón que el perfil activo): si el
//      dispositivo se usa con otra cuenta, la elección de la anterior no
//      se hereda; la app vuelve al hogar más antiguo de la cuenta actual.
//      Sin marca (o sin sesión cargada aún), la elección se respeta: el
//      servidor valida la membresía de todos modos.
//   3. Sin elección válida, el hogar activo es el primero de la lista
//      (la membresía más antigua), que es el comportamiento actual.
export type HouseholdLike = {
  id: number;
  name: string;
  role: string;
};

export const STORED_HOUSEHOLD_KEY = "sf-household";
export const STORED_HOUSEHOLD_USER_KEY = "sf-household-user";

export function readStoredHousehold(): { id: number | null; user: string | null } {
  try {
    const raw = localStorage.getItem(STORED_HOUSEHOLD_KEY);
    const n = raw ? Number(raw) : NaN;
    const user = localStorage.getItem(STORED_HOUSEHOLD_USER_KEY);
    return { id: Number.isFinite(n) && n > 0 ? n : null, user: user || null };
  } catch {
    return { id: null, user: null };
  }
}

export function writeStoredHousehold(id: number | null, userEmail: string): void {
  try {
    if (id) {
      localStorage.setItem(STORED_HOUSEHOLD_KEY, String(id));
      if (userEmail) localStorage.setItem(STORED_HOUSEHOLD_USER_KEY, userEmail);
      else localStorage.removeItem(STORED_HOUSEHOLD_USER_KEY);
    } else {
      localStorage.removeItem(STORED_HOUSEHOLD_KEY);
      localStorage.removeItem(STORED_HOUSEHOLD_USER_KEY);
    }
  } catch {
    // Sin almacenamiento disponible: la elección vive solo en memoria.
  }
}

export function clearStoredHousehold(): void {
  writeStoredHousehold(null, "");
}

export function resolveActiveHouseholdId(
  households: HouseholdLike[],
  storedId: number | null,
  storedUser: string | null,
  myEmail: string,
): number | null {
  if (storedId == null) return null;
  if (!households.some((h) => h.id === storedId)) return null;
  // La elección de otra cuenta no se hereda; sin sesión cargada aún
  // (myEmail vacío) o sin marca, el servidor valida la membresía.
  if (myEmail !== "" && storedUser != null && storedUser !== myEmail) return null;
  return storedId;
}
