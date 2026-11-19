import type { ReactNode } from "react";
import type { Tab } from "../App";

// Cajón lateral del menú: la navegación por módulos, con sus grupos
// plegables (solo queda abierto el del módulo actual). Se extrajo de
// App.tsx para poder probar el orden y los iconos de las filas.
// Hogar lleva casita (decisión de Heriberto 2026-11-18) e Inicio lleva
// un icono de tablero (cuadrícula), no la casita.
const tabIcon = (children: ReactNode) => (
  <svg aria-hidden="true" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
// Icono de cada módulo. Hogar lleva la casita; Inicio lleva un icono de
// tablero (cuadrícula de 2×2), para no repetir la casita.
const TAB_ICONS: Record<Tab, ReactNode> = {
  inicio: tabIcon(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></>),
  hogar: tabIcon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>),
  personal: tabIcon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  movimientos: tabIcon(<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>),
  cuentas: tabIcon(<><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></>),
  presupuestos: tabIcon(<><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>),
  metas: tabIcon(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>),
  fondos: tabIcon(<><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></>),
  aportaciones: tabIcon(<><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>),
  tandas: tabIcon(<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>),
  patrimonio: tabIcon(<><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>),
  acuerdos: tabIcon(<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>),
  categorias: tabIcon(<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>),
  perfiles: tabIcon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>),
  guia: tabIcon(<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>),
  desarrollador: tabIcon(<><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>),
};

/** Icono de la fila de un módulo. */
const rowIcon = (tid: Tab): ReactNode => TAB_ICONS[tid];

export type DrawerMenuTab = { id: Tab; label: string };
export type DrawerMenuSection = { title: string; tabs: DrawerMenuTab[]; config?: boolean };

export function DrawerMenu(p: {
  sections: DrawerMenuSection[];
  currentTab: Tab;
  onNavigate: (tab: Tab) => void;
  openGroups: Record<string, boolean>;
  onToggleGroup: (title: string, open: boolean) => void;
  configOpen: boolean;
  onToggleConfig: () => void;
  vistaOpen: boolean;
  onToggleVista: () => void;
  darkMode: boolean;
  onSetThemeMode: (dark: boolean) => void;
  onFeedback?: () => void;
}) {
  return (
    <nav id="menu-modulos" aria-label="Módulos" className="flex-1 overflow-y-auto px-3 py-3">
      {p.sections.map(sec=>{ if(sec.config){ return (
        <div key="Configuración" className="mt-2 first:mt-0">
          <button type="button" aria-expanded={p.configOpen} onClick={()=>p.onToggleConfig()} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--dim)]">CONFIGURACIÓN</span>
            <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--dim)] transition-transform ${p.configOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {p.configOpen && (
            <ul className="mt-1 space-y-0.5">
              <li>
                <button type="button" aria-label="Ir a Guía de uso" aria-current={p.currentTab==="guia"?"page":undefined} onClick={()=>{p.onNavigate("guia");}} className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold ${p.currentTab==="guia"?"bg-[var(--accent)] text-[var(--accent-text)]":"text-[var(--text)]"}`}>{TAB_ICONS.guia}<span className="flex-1">Guía de uso</span>{p.currentTab==="guia" && <span className="text-[11px] font-semibold opacity-80">Actual</span>}</button>
              </li>
              <li>
                {/* Enviar comentarios: abre el formulario de dudas y mejoras
                    dentro de la app (sin salir al enlace público). */}
                <button type="button" aria-label="Enviar comentarios sobre la app" onClick={()=>{p.onFeedback?.();}} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold text-[var(--text)]">{tabIcon(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>)}<span className="flex-1">Enviar comentarios</span></button>
              </li>
              <li>
                {/* Vista: abre la elección de tema (Claro / Oscuro). */}
                <button type="button" aria-expanded={p.vistaOpen} onClick={()=>p.onToggleVista()} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold">
                  {tabIcon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}
                  <span className="flex-1">Vista</span>
                  <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--dim)] transition-transform ${p.vistaOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {p.vistaOpen && (
                  <ul className="mt-1 space-y-0.5 pl-5">
                    <li>
                      <button type="button" aria-pressed={!p.darkMode} onClick={()=>p.onSetThemeMode(false)} className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold ${!p.darkMode?"bg-[var(--accent)] text-[var(--accent-text)]":"text-[var(--text)]"}`}>{tabIcon(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></>)}<span className="flex-1">Claro</span>{!p.darkMode && <span className="text-[11px] font-semibold opacity-80">Actual</span>}</button>
                    </li>
                    <li>
                      <button type="button" aria-pressed={p.darkMode} onClick={()=>p.onSetThemeMode(true)} className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold ${p.darkMode?"bg-[var(--accent)] text-[var(--accent-text)]":"text-[var(--text)]"}`}>{tabIcon(<><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>)}<span className="flex-1">Oscuro</span>{p.darkMode && <span className="text-[11px] font-semibold opacity-80">Actual</span>}</button>
                    </li>
                  </ul>
                )}
              </li>
            </ul>
          )}
        </div>
      ); }
      const g=sec; const open = p.openGroups[g.title] ?? g.tabs.some(t=>t.id===p.currentTab); return (
        <div key={g.title} className="mt-2 first:mt-0">
          <button type="button" aria-expanded={open} onClick={()=>p.onToggleGroup(g.title, !open)} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--dim)]">{g.title.toUpperCase()}</span>
            <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--dim)] transition-transform ${open?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {open && (
          <ul className="mt-1 space-y-0.5">
            {g.tabs.map(t=>{ const current=p.currentTab===t.id; return (
              <li key={t.id}>
                <button type="button" aria-label={`Ir a ${t.label}`} aria-current={current?"page":undefined} onClick={()=>{p.onNavigate(t.id);}} className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold ${current?"bg-[var(--accent)] text-[var(--accent-text)]":"text-[var(--text)]"}`}>{rowIcon(t.id)}<span className="flex-1">{t.label}</span>{current && <span className="text-[11px] font-semibold opacity-80">Actual</span>}</button>
              </li>
            ); })}
          </ul>
          )}
        </div>
      ); })}
    </nav>
  );
}
