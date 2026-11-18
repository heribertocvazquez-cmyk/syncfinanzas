import type { Tab } from "../App";

// Cajón lateral del menú (opción elegida por Heriberto): lista de una
// columna, sin subtítulos, con icono y nombre corto. Se mantienen todos
// los módulos. Los grupos son plegables (solo queda abierto el del
// módulo actual) para que el menú se vea corto. Orden fijo de los
// grupos: Mi dinero, Planes y tandas, Ajustes, Desarrollador (solo
// dueño) y Configuración al final, arriba de Mike. Dentro de cada grupo
// los módulos van en orden alfabético (español, sin distinguir acentos),
// SALVO Mi dinero, que va por importancia según Heriberto (2026-11-18):
// Inicio, Personal, Hogar, Cuentas, Movimientos (ver MI_DINERO_ORDER).
// El orden se aplica al pintar (ver orderDrawerTabs). Hogar va en Mi
// dinero; Guía de uso va en Configuración, junto a Vista.
export const DRAWER_GROUPS: { title: string; tabs: Tab[] }[] = [
  { title: "Mi dinero", tabs: ["inicio", "personal", "movimientos", "cuentas", "hogar"] },
  { title: "Planes y tandas", tabs: ["presupuestos", "metas", "fondos", "aportaciones", "tandas"] },
  { title: "Ajustes", tabs: ["patrimonio", "acuerdos", "categorias", "perfiles"] },
];

/** Orden por importancia del grupo Mi dinero, decidido por Heriberto (2026-11-18). */
export const MI_DINERO_ORDER: Tab[] = ["inicio", "personal", "hogar", "cuentas", "movimientos"];

/**
 * Ordena los módulos de un grupo del cajón: Mi dinero va en el orden
 * explícito de MI_DINERO_ORDER; los demás grupos van en orden alfabético
 * (español, sin distinguir acentos). Un módulo no listado en el orden
 * explícito va al final, en su orden original.
 */
export function orderDrawerTabs(
  title: string,
  tabs: Tab[],
  labelOf: (t: Tab) => string,
): Tab[] {
  if (title === "Mi dinero") {
    const rank = new Map<Tab, number>(MI_DINERO_ORDER.map((t, i) => [t, i]));
    return [...tabs].sort(
      (a, b) =>
        (rank.get(a) ?? MI_DINERO_ORDER.length) -
        (rank.get(b) ?? MI_DINERO_ORDER.length),
    );
  }
  const byLabelEs = (a: string, b: string) =>
    a.localeCompare(b, "es", { sensitivity: "base" });
  return [...tabs].sort((a, b) => byLabelEs(labelOf(a), labelOf(b)));
}
