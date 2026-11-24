import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ReactNode } from "react";
import type { Tab } from "../App";
import type { QuickShortcutId } from "../lib/quickBar";

// Texto grande (Vista, mejora «Acceso más fácil para mayores»,
// 2026-11-21): la elección vive en el dispositivo (localStorage
// «sf-texto-grande») y se aplica con el atributo data-texto-grande en
// <html>, que lee la variante de theme.css. Sin localStorage no se puede
// recordar y queda el tamaño normal.
export const TEXTO_GRANDE_KEY = "sf-texto-grande";

export function readTextoGrande(): boolean {
  try { return localStorage.getItem(TEXTO_GRANDE_KEY) === "1"; }
  catch { return false; }
}

export function applyTextoGrande(on: boolean): void {
  try {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.textoGrande = on ? "true" : "false";
    }
  } catch { /* sin documento no hay nada que aplicar */ }
}

export function writeTextoGrande(on: boolean): void {
  try {
    if (on) localStorage.setItem(TEXTO_GRANDE_KEY, "1");
    else localStorage.removeItem(TEXTO_GRANDE_KEY);
  } catch { /* sin almacenamiento no se puede recordar */ }
  applyTextoGrande(on);
}

// Cajón lateral del menú: la navegación por módulos, con sus grupos
// plegables (solo queda abierto el del módulo actual). Se extrajo de
// App.tsx para poder probar el orden y los iconos de las filas.
// Hogar lleva casita (decisión de Heriberto 2026-11-18) e Inicio lleva
// un icono de tablero (cuadrícula), no la casita.
const tabIcon = (children: ReactNode) => (
  <svg aria-hidden="true" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
// Icono de cada módulo. Hogar lleva la casita; Inicio lleva un icono de
// tablero (cuadrícula de 2×2), para no repetir la casita. Se exporta para
// que la barra rápida use el mismo icono que el cajón en cada atajo.
export const TAB_ICONS: Record<Tab, ReactNode> = {
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
  seguridad: tabIcon(<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>),
  desarrollador: tabIcon(<><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>),
  legales: tabIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>),
};

/** Icono de la fila de un módulo. */
const rowIcon = (tid: Tab): ReactNode => TAB_ICONS[tid];

export type DrawerMenuTab =
  | { id: Tab; label: string }
  | { action: "nuevo-gasto"; label: string };
export type DrawerMenuSection = { title: string; tabs: DrawerMenuTab[]; config?: boolean };

/** Id del atajo que fija o quita una fila (el módulo, o la acción Nuevo gasto). */
const rowShortcutId = (t: DrawerMenuTab): QuickShortcutId => ("action" in t ? t.action : t.id);

// Estrella chica para fijar o quitar un atajo (16 px, como en la vista
// previa aprobada 2026-11-24): dorada rellena si está fijado, contorno
// apagado si no. Es el mismo trazo de estrella que la de Mike.
function PinStar(p: { pinned: boolean; current: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4 pointer-events-none" viewBox="0 0 24 24" fill={p.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

// Una fila del cajón con su estrellita: la estrella NO se muestra
// siempre; solo sale cuando el botón se mantiene presionado (el padre
// pasa revealed=true tras ~500 ms). Al tocarla se fija o se quita el
// atajo en el acto, sin pop-up ni aviso. Un toque corto navega como
// siempre; el clic que cierra una pulsación larga se ignora (el padre lo
// marca con guardLongPressClick).
function NavRow(p: {
  id: QuickShortcutId;
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  current: boolean;
  pinned: boolean;
  revealed: boolean;
  onNavigate: () => void;
  onTogglePin: (id: QuickShortcutId) => void;
  onPressStart: (id: QuickShortcutId) => (e: ReactPointerEvent) => void;
  onPressMove: (e: ReactPointerEvent) => void;
  onPressEnd: () => void;
  onPressCancel: () => void;
  guardLongPressClick: () => boolean;
}) {
  const starLabel = p.pinned ? `Quitar ${p.label} de la barra rápida` : `Poner ${p.label} en la barra rápida`;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-label={p.ariaLabel}
        aria-current={p.current ? "page" : undefined}
        onPointerDown={p.onPressStart(p.id)}
        onPointerMove={p.onPressMove}
        onPointerUp={p.onPressEnd}
        onPointerCancel={p.onPressCancel}
        onPointerLeave={p.onPressCancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (p.guardLongPressClick()) return; p.onNavigate(); }}
        style={{ WebkitTouchCallout: "none" }}
        className={`min-w-0 flex-1 flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold select-none ${p.current ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text)]"}`}
      >
        {p.icon}
        <span className="flex-1 truncate">{p.label}</span>
        {p.current && <span className="text-[11px] font-semibold opacity-80 shrink-0">Actual</span>}
      </button>
      {(p.revealed || p.pinned) && (
        <button
          type="button"
          aria-label={starLabel}
          aria-pressed={p.pinned}
          onClick={(e) => { e.stopPropagation(); p.onTogglePin(p.id); }}
          className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full ${p.pinned ? "text-amber-400" : p.current ? "text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
        >
          <PinStar pinned={p.pinned} current={p.current} />
        </button>
      )}
    </li>
  );
}

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
  // Texto grande: si App pasa el valor y el cambio, el interruptor es
  // controlado; si no, el menú lo guarda y lo aplica solo (el cajón
  // siempre está montado, así que la preferencia se aplica al cargar).
  textoGrande?: boolean;
  onSetTextoGrande?: (on: boolean) => void;
  onFeedback?: () => void;
  // Atajos del menú rápido (estrellas, 2026-11-24): los atajos fijados y
  // el cambio al tocar una estrella; la fila «Nuevo gasto» abre el
  // formulario de gasto desde el cajón. La estrella de una fila fijada
  // se muestra siempre (dorada), para que se vea cuáles están en el
  // acceso rápido; la de una fila no fijada sale solo al mantenerla
  // presionada ~500 ms. Opcionales con valores por defecto (sin atajos
  // fijados, sin efecto al tocar la estrella) para que el cajón también
  // se pueda pintar solo en las pruebas.
  pinned?: QuickShortcutId[];
  onTogglePin?: (id: QuickShortcutId) => void;
  onNewExpense?: () => void;
}) {
  const [textoGrandeLocal, setTextoGrandeLocal] = useState<boolean>(() => readTextoGrande());
  const textoGrandeActivo = p.textoGrande ?? textoGrandeLocal;
  useEffect(() => { applyTextoGrande(textoGrandeActivo); }, [textoGrandeActivo]);
  const toggleTextoGrande = () => {
    const next = !textoGrandeActivo;
    if (p.onSetTextoGrande) p.onSetTextoGrande(next);
    else { setTextoGrandeLocal(next); writeTextoGrande(next); }
  };
  // Pulsación larga (2026-11-24, decisión de Heriberto): mantener
  // presionado el botón del menú ~500 ms muestra su estrellita chica;
  // un toque corto navega como siempre y un desliz (scroll) la cancela.
  // La estrella queda visible hasta cerrar el cajón o presionar otra
  // fila. El clic que sigue a una pulsación larga se ignora, para no
  // navegar al soltar el dedo.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_PX = 10;
  const [revealedId, setRevealedId] = useState<QuickShortcutId | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const clearPressTimer = () => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const startPress = (id: QuickShortcutId) => (e: ReactPointerEvent) => {
    longPressed.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => { longPressed.current = true; setRevealedId(id); }, LONG_PRESS_MS);
  };
  const movePress = (e: ReactPointerEvent) => {
    const s = pressStart.current;
    if (s && (Math.abs(e.clientX - s.x) > LONG_PRESS_MOVE_PX || Math.abs(e.clientY - s.y) > LONG_PRESS_MOVE_PX)) {
      clearPressTimer(); pressStart.current = null;
    }
  };
  const endPress = () => { clearPressTimer(); pressStart.current = null; };
  const cancelPress = () => { clearPressTimer(); pressStart.current = null; longPressed.current = false; };
  const guardLongPressClick = (): boolean => {
    if (longPressed.current) { longPressed.current = false; return true; }
    return false;
  };
  const navRowProps = (id: QuickShortcutId, label: string, ariaLabel: string, icon: ReactNode, current: boolean, onNavigate: () => void) => ({
    id, label, ariaLabel, icon, current,
    pinned: (p.pinned ?? []).includes(id),
    revealed: revealedId === id,
    onNavigate, onTogglePin: p.onTogglePin ?? (() => {}),
    onPressStart: startPress, onPressMove: movePress, onPressEnd: endPress,
    onPressCancel: cancelPress, guardLongPressClick,
  });
  return (
    <nav id="menu-modulos" aria-label="Módulos" className="flex-1 overflow-y-auto px-3 py-3">
      {p.sections.map(sec=>{ if(sec.config){ return (
        <div key="Configuración" className="mt-2 first:mt-0">
          <button type="button" aria-label={p.configOpen ? "Cerrar Configuración" : "Abrir Configuración"} aria-expanded={p.configOpen} onClick={()=>p.onToggleConfig()} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--dim)]">CONFIGURACIÓN</span>
            <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--dim)] transition-transform ${p.configOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {p.configOpen && (
            <ul className="mt-1 space-y-0.5">
              <NavRow {...navRowProps("guia", "Guía de uso", "Ir a Guía de uso", TAB_ICONS.guia, p.currentTab === "guia", () => { p.onNavigate("guia"); })} />
              <NavRow {...navRowProps("seguridad", "Seguridad", "Ir a Seguridad", TAB_ICONS.seguridad, p.currentTab === "seguridad", () => { p.onNavigate("seguridad"); })} />
              <NavRow {...navRowProps("legales", "Documentos legales", "Ir a Documentos legales", TAB_ICONS.legales, p.currentTab === "legales", () => { p.onNavigate("legales"); })} />
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
                    <li>
                      {/* Texto grande: la letra de toda la app crece un paso. */}
                      <button type="button" role="switch" aria-checked={textoGrandeActivo} aria-label="Texto grande" onClick={toggleTextoGrande} className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold text-[var(--text)]">{tabIcon(<><path d="M5 18 12 6l7 12"/><line x1="8.5" y1="13" x2="15.5" y2="13"/></>)}<span className="flex-1">Texto grande</span><span aria-hidden="true" className={`shrink-0 w-11 h-6 rounded-full p-0.5 flex ${textoGrandeActivo ? "bg-[var(--accent)] justify-end" : "bg-[var(--surface2)] justify-start"}`}><span className="block w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)]" /></span></button>
                    </li>
                    <li>
                      <p className="text-xs text-[var(--dim)] px-2.5 py-1">La letra de toda la app crece un paso.</p>
                    </li>
                  </ul>
                )}
              </li>
            </ul>
          )}
        </div>
      ); }
      const g=sec; const open = p.openGroups[g.title] ?? g.tabs.some(t=>"id" in t && t.id===p.currentTab); return (
        <div key={g.title} className="mt-2 first:mt-0">
          <button type="button" aria-label={open ? `Cerrar grupo ${g.title}` : `Abrir grupo ${g.title}`} aria-expanded={open} onClick={()=>p.onToggleGroup(g.title, !open)} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left">
            <span className="flex-1 text-[11px] font-bold tracking-widest text-[var(--dim)]">{g.title.toUpperCase()}</span>
            <svg aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--dim)] transition-transform ${open?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {open && (
          <ul className="mt-1 space-y-0.5">
            {g.tabs.map(t => {
              const id = rowShortcutId(t);
              const icon = "action" in t
                ? tabIcon(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)
                : rowIcon(t.id);
              const current = "action" in t ? false : p.currentTab === t.id;
              const navigate = "action" in t ? () => { p.onNewExpense?.(); } : () => { p.onNavigate(t.id); };
              return (
                <NavRow key={id} {...navRowProps(id, t.label, "action" in t ? t.label : `Ir a ${t.label}`, icon, current, navigate)} />
              );
            })}
          </ul>
          )}
        </div>
      ); })}
    </nav>
  );
}
