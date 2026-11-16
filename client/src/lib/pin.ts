// Bloqueo local con PIN de 4 dígitos (solo en este dispositivo).
// No es cifrado de datos: solo pide el PIN al reabrir la app. El PIN se
// guarda como hash SHA-256 en localStorage y el desbloqueo dura la sesión
// del navegador (sessionStorage); al cerrar la pestaña vuelve a pedirlo.

const PIN_HASH_KEY = "sf-pin-hash";
const PIN_UNLOCKED_KEY = "sf-pin-unlocked";

export function pinIsSet(): boolean {
  try { return !!localStorage.getItem(PIN_HASH_KEY); } catch { return false; }
}

export async function pinHash(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`syncfinanzas-pin:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pinCheck(pin: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) return false;
    return (await pinHash(pin)) === stored;
  } catch { return false; }
}

export async function pinSet(pin: string) {
  localStorage.setItem(PIN_HASH_KEY, await pinHash(pin));
  sessionStorage.setItem(PIN_UNLOCKED_KEY, "1");
}

export function pinRemove() {
  try {
    localStorage.removeItem(PIN_HASH_KEY);
    sessionStorage.removeItem(PIN_UNLOCKED_KEY);
  } catch {}
}

export function pinUnlocked(): boolean {
  try { return sessionStorage.getItem(PIN_UNLOCKED_KEY) === "1"; } catch { return false; }
}

export function pinMarkUnlocked() {
  try { sessionStorage.setItem(PIN_UNLOCKED_KEY, "1"); } catch {}
}

export function pinLock() {
  try { sessionStorage.removeItem(PIN_UNLOCKED_KEY); } catch {}
}
