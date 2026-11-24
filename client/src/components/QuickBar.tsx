// Menú rápido (aprobado por Heriberto 2026-11-24, «Si adelante»):
// barra fija abajo, una sola fila — hamburguesa (abre el mismo cajón que
// el botón del encabezado) + los atajos fijados con las estrellas del
// cajón (2026-11-24: mantener presionado un botón del menú muestra su
// estrellita; tocarla la fija o la quita, sin pop-up ni aviso). Sin nada
// guardado, los atajos son los 3 de hoy: Nuevo gasto, Metas y
// Presupuestos (localStorage «sf-menu-rapido», por dispositivo; ver
// lib/quickBar). Como máximo 4 atajos; la hamburguesa siempre va primera
// y no se quita. Cada atajo usa el mismo icono que su fila del cajón.
// Variante B, solo intuitiva: SIN símbolo «i», SIN leyenda, SIN texto de
// descripción. La barra se oculta mientras el cajón está abierto (el
// cajón es z-50 y el encabezado es el control para cerrarlo); el
// contenido de la app lleva relleno inferior (main: 80 px + área segura)
// para que el scroll no se dañe.
//
// Medidas (corrección 2026-11-24, reporte de Heriberto desde su teléfono):
// la barra mide QUICK_BAR_HEIGHT_PX de alto y flota a
// QUICK_BAR_BOTTOM_PX del borde inferior de la pantalla, más el área
// segura (safe-area-inset-bottom): nunca va pegada al borde. Cada botón
// mide 44 px de alto (mínimo táctil): icono de 20 px + letra de 10 px +
// relleno vertical. App.tsx usa estas constantes para que la estrella de
// Mike quede siempre POR ENCIMA de la barra (ver FAB_BOTTOM_RESERVE_PX).
import type { Tab } from "../App";
import { TAB_ICONS } from "./DrawerMenu";
import type { QuickShortcutId } from "../lib/quickBar";

// Alto real de la barra: botón 44 px (py-1.5 + icono 20 + hueco 2 +
// letra 10) + relleno vertical del contenedor 8 px (py-1).
export const QUICK_BAR_HEIGHT_PX = 52;
// Margen inferior de la barra: flota sobre el borde, no pegada a él.
export const QUICK_BAR_BOTTOM_PX = 12;

function IconPlus() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  );
}

export function QuickBar(p: {
  currentTab: Tab;
  menuOpen: boolean;
  shortcuts: QuickShortcutId[];
  tabLabel: (t: Tab) => string;
  onToggleMenu: () => void;
  onNewExpense: () => void;
  onGoTab: (t: Tab) => void;
}) {
  const tabBtn = (active: boolean) =>
    `min-w-0 flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 ${
      active ? "bg-[var(--surface2)] text-[var(--accent)]" : "text-[var(--text)]"
    }`;
  // Una columna por botón: hamburguesa + un atajo fijado cada uno.
  const cols = 1 + p.shortcuts.length;
  return (
    <nav
      aria-label="Menú rápido"
      className="fixed inset-x-3 z-40 mx-auto max-w-xl"
      style={{ bottom: `calc(${QUICK_BAR_BOTTOM_PX}px + env(safe-area-inset-bottom, 0px))` }}
    >
      <div className="grid items-stretch gap-1 rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] px-1.5 py-1 shadow-2xl" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        <button
          type="button"
          aria-label={p.menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={p.menuOpen}
          onClick={p.onToggleMenu}
          className="flex flex-col items-center justify-center gap-1 rounded-full bg-[var(--accent)] py-2"
        >
          <span aria-hidden="true" className={`block h-[2px] w-4 rounded bg-[var(--accent-text)] transition-transform ${p.menuOpen ? "translate-y-[6px] rotate-45" : ""}`} />
          <span aria-hidden="true" className={`block h-[2px] w-4 rounded bg-[var(--accent-text)] transition-opacity ${p.menuOpen ? "opacity-0" : ""}`} />
          <span aria-hidden="true" className={`block h-[2px] w-4 rounded bg-[var(--accent-text)] transition-transform ${p.menuOpen ? "-translate-y-[6px] -rotate-45" : ""}`} />
        </button>
        {p.shortcuts.map((id) => id === "nuevo-gasto" ? (
          <button key={id} type="button" aria-label="Nuevo gasto" onClick={p.onNewExpense} className={tabBtn(false)}>
            <IconPlus />
            <span className="text-[10px] font-bold leading-none truncate max-w-full">Nuevo gasto</span>
          </button>
        ) : (
          <button
            key={id}
            type="button"
            aria-label={`Ir a ${p.tabLabel(id)}`}
            aria-current={p.currentTab === id ? "page" : undefined}
            onClick={() => p.onGoTab(id)}
            className={tabBtn(p.currentTab === id)}
          >
            {TAB_ICONS[id]}
            <span className="text-[10px] font-bold leading-none truncate max-w-full">{p.tabLabel(id)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
