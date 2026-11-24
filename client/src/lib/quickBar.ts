// Atajos del menú rápido (estrellas del cajón, 2026-11-24, aprobado por
// Heriberto): la estrellita NO se muestra siempre; solo sale al mantener
// presionado el botón del menú (~500 ms). Al tocarla, el atajo se fija o
// se quita de la barra en el acto, sin pop-up ni aviso (decisión de
// Heriberto 2026-11-24: «se active solo al presionarlo sin texto o el
// pop Up»).
//
// La elección vive en el dispositivo (localStorage «sf-menu-rapido»),
// como «Texto grande»: cada teléfono tiene su propia barra. Sin nada
// guardado, la barra trae los 3 atajos de hoy: Nuevo, Metas y
// Presupuestos. La barra admite como máximo MAX_QUICK_SHORTCUTS atajos
// (la hamburguesa siempre va primera y no se quita); si está llena,
// tocar otra estrella no hace nada, sin aviso.
import type { Tab } from "../App";

export type QuickShortcutId = Tab | "nuevo-gasto";
export const QUICK_BAR_KEY = "sf-menu-rapido";
export const MAX_QUICK_SHORTCUTS = 4;
export const DEFAULT_QUICK_SHORTCUTS: QuickShortcutId[] = ["nuevo-gasto", "metas", "presupuestos"];

// Todos los módulos que existen (igual que el tipo Tab de App.tsx) más la
// acción Nuevo gasto: solo estos ids se aceptan desde localStorage; lo
// demás se descarta.
const KNOWN_SHORTCUT_IDS: ReadonlySet<string> = new Set([
  "inicio", "personal", "tandas", "movimientos", "cuentas", "categorias",
  "presupuestos", "fondos", "aportaciones", "metas", "acuerdos",
  "patrimonio", "perfiles", "hogar", "seguridad", "guia", "desarrollador",
  "legales", "nuevo-gasto",
]);

export function isKnownQuickShortcutId(x: unknown): x is QuickShortcutId {
  return typeof x === "string" && KNOWN_SHORTCUT_IDS.has(x);
}

/** Lee los atajos guardados; sin nada guardado (o guardado inválido), los 3 de hoy. */
export function readQuickShortcuts(): QuickShortcutId[] {
  try {
    const raw = localStorage.getItem(QUICK_BAR_KEY);
    if (raw === null) return [...DEFAULT_QUICK_SHORTCUTS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_QUICK_SHORTCUTS];
    return [...new Set(parsed.filter(isKnownQuickShortcutId))].slice(0, MAX_QUICK_SHORTCUTS);
  } catch {
    return [...DEFAULT_QUICK_SHORTCUTS];
  }
}

export function writeQuickShortcuts(ids: QuickShortcutId[]): void {
  try {
    localStorage.setItem(QUICK_BAR_KEY, JSON.stringify(ids.slice(0, MAX_QUICK_SHORTCUTS)));
  } catch { /* sin almacenamiento no se puede recordar */ }
}

/** Fija o quita un atajo; si la barra está llena y no está fijado, no cambia nada. */
export function toggleQuickShortcut(ids: QuickShortcutId[], id: QuickShortcutId): QuickShortcutId[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= MAX_QUICK_SHORTCUTS) return ids;
  return [...ids, id];
}
