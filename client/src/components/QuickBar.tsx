// Menú rápido (aprobado por Heriberto 2026-11-24, «Si adelante»):
// barra fija abajo, una sola fila, 4 botones — hamburguesa (abre el mismo
// cajón que el botón del encabezado), Nuevo gasto, Metas y Presupuestos.
// Variante B, solo intuitiva: SIN símbolo «i», SIN leyenda, SIN texto de
// descripción. Los 3 atajos son fijos por ahora (sin personalización);
// la personalización con la estrella viene después, fuera de este cambio.
// La barra se oculta mientras el cajón está abierto (el cajón es z-50 y
// el encabezado es el control para cerrarlo); el contenido de la app
// lleva relleno inferior (main pb-28) para que el scroll no se dañe.
import type { Tab } from "../App";

function IconPlus() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  );
}

function IconGift() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
  );
}

function IconPie() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
  );
}

export function QuickBar(p: {
  currentTab: Tab;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onNewExpense: () => void;
  onGoTab: (t: Tab) => void;
}) {
  const tabBtn = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 rounded-full py-2 ${
      active ? "bg-[var(--surface2)] text-[var(--accent)]" : "text-[var(--text)]"
    }`;
  return (
    <nav
      aria-label="Menú rápido"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="grid grid-cols-4 items-stretch gap-1 rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] px-1.5 py-1.5 shadow-2xl">
        <button
          type="button"
          aria-label={p.menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={p.menuOpen}
          onClick={p.onToggleMenu}
          className="flex flex-col items-center justify-center gap-[5px] rounded-full bg-[var(--accent)] py-3"
        >
          <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--accent-text)] transition-transform ${p.menuOpen ? "translate-y-[7.5px] rotate-45" : ""}`} />
          <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--accent-text)] transition-opacity ${p.menuOpen ? "opacity-0" : ""}`} />
          <span aria-hidden="true" className={`block h-[2.5px] w-5 rounded bg-[var(--accent-text)] transition-transform ${p.menuOpen ? "-translate-y-[7.5px] -rotate-45" : ""}`} />
        </button>
        <button type="button" aria-label="Nuevo gasto" onClick={p.onNewExpense} className={tabBtn(false)}>
          <IconPlus />
          <span className="text-[11px] font-bold leading-none">Nuevo gasto</span>
        </button>
        <button
          type="button"
          aria-label="Ir a Metas"
          aria-current={p.currentTab === "metas" ? "page" : undefined}
          onClick={() => p.onGoTab("metas")}
          className={tabBtn(p.currentTab === "metas")}
        >
          <IconGift />
          <span className="text-[11px] font-bold leading-none">Metas</span>
        </button>
        <button
          type="button"
          aria-label="Ir a Presupuestos"
          aria-current={p.currentTab === "presupuestos" ? "page" : undefined}
          onClick={() => p.onGoTab("presupuestos")}
          className={tabBtn(p.currentTab === "presupuestos")}
        >
          <IconPie />
          <span className="text-[11px] font-bold leading-none">Presupuestos</span>
        </button>
      </div>
    </nav>
  );
}
