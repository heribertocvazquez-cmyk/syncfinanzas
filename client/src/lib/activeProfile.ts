// Perfil activo en este dispositivo («Perfil en uso», Perfiles).
//
// El perfil activo es una elección DEL DISPOSITIVO: se guarda en
// localStorage («sf-profile») y la interfaz muestra los botones y los
// movimientos que corresponden a ese perfil. El problema era que esa
// elección no estaba atada a ninguna cuenta: si el dispositivo se usaba
// con otra cuenta (por ejemplo, la invitada acepta en el mismo teléfono
// donde antes entró la organizadora), el perfil activo quedaba siendo el
// de la organizadora — la invitada veía botones de tesorería que no le
// tocan y no veía su botón directo de pago, aunque el servidor sí
// rechazaba las acciones no permitidas.
//
// Reglas de resolución (resolveActiveProfile):
//   1. La elección guardada se respeta cuando es el perfil propio de la
//      cuenta actual, cuando la cuenta no tiene perfil propio vinculado
//      en este hogar, o cuando se eligió deliberadamente con la cuenta
//      actual en este dispositivo (la marca «sf-profile-user», que
//      pickProfile guarda junto con la elección). Esto conserva el uso
//      compartido del dispositivo: con una misma cuenta se puede seguir
//      eligiendo otro perfil para ver como esa persona.
//   2. En cualquier otro caso (elección guardada de otra cuenta, o
//      elección anterior a este arreglo, sin marca) la elección se ignora
//      y el perfil activo pasa a ser el propio de la cuenta
//      (myProfileId, que devuelve getOverview desde profiles.userId).
//   3. Sin perfil propio ni elección válida, se mantiene el orden
//      anterior: administrador, luego adulto.
export type ActiveProfileLike = {
  id: number;
  role: string;
  kind: string;
  email?: string | null;
};

export const STORED_PROFILE_KEY = "sf-profile";
export const STORED_PROFILE_USER_KEY = "sf-profile-user";

export function readStoredProfile(): { id: number | null; user: string | null } {
  try {
    const raw = localStorage.getItem(STORED_PROFILE_KEY);
    const n = raw ? Number(raw) : NaN;
    const user = localStorage.getItem(STORED_PROFILE_USER_KEY);
    return { id: Number.isFinite(n) && n > 0 ? n : null, user: user || null };
  } catch {
    return { id: null, user: null };
  }
}

export function writeStoredProfile(id: number | null, userEmail: string): void {
  try {
    if (id) {
      localStorage.setItem(STORED_PROFILE_KEY, String(id));
      if (userEmail) localStorage.setItem(STORED_PROFILE_USER_KEY, userEmail);
      else localStorage.removeItem(STORED_PROFILE_USER_KEY);
    } else {
      localStorage.removeItem(STORED_PROFILE_KEY);
      localStorage.removeItem(STORED_PROFILE_USER_KEY);
    }
  } catch {
    // Sin almacenamiento disponible: el perfil activo vive solo en memoria.
  }
}

export function resolveActiveProfile<T extends ActiveProfileLike>(
  profiles: T[],
  storedId: number | null,
  myProfileId: number | null,
  myEmail: string,
  pickOwner: string | null,
): T | null {
  const stored = storedId != null ? profiles.find((p) => p.id === storedId) ?? null : null;
  const mine = myProfileId != null ? profiles.find((p) => p.id === myProfileId) ?? null : null;
  if (stored) {
    if (!mine || stored.id === mine.id) return stored;
    // La elección guardada es de otro perfil: solo se respeta si se eligió
    // deliberadamente con la cuenta actual en este dispositivo.
    if (myEmail !== "" && pickOwner != null && pickOwner === myEmail) return stored;
  }
  if (mine) return mine;
  return profiles.find((p) => p.role === "admin") ?? profiles.find((p) => p.kind === "adult") ?? null;
}
