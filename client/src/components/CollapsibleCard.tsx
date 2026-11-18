import { useState, type ReactNode } from "react";

// Tarjeta plegable compartida (decisión de Heriberto 2026-11-18): todas las
// tarjetas con lista de todos los módulos empiezan CERRADAS y se abren con
// «Ver» / se cierran con «Ver menos», para que las listas no abarquen toda
// la pantalla. Plegada solo se ve el encabezado (title + resumen `above`).
// El control «Ver» / «Ver menos» va ARRIBA, dentro del encabezado, a la
// derecha del título: solo el texto «Ver» en blanco. El encabezado queda
// FIJO (sticky) bajo la barra superior de la app mientras se baja por el
// contenido abierto, con fondo sólido de la tarjeta, para que el contenido
// pase por debajo sin transparentarse y el «Ver menos» nunca haya que
// buscarlo abajo (decisión de Heriberto 2026-11-18, vista previa aprobada).
//
// Uso:
//   <CollapsibleCard title={<h2 …>Título</h2>}>…lista…</CollapsibleCard>
//
// - `above`: resumen siempre visible dentro del encabezado fijo, bajo el
//   título (p. ej. «Entradas $5,500 · Salidas $2,576»). `below`: siempre
//   visible debajo del contenido (totales, botón de acción). Cuando no hay
//   nada que mostrar, NO se usa este envoltorio: se pinta la tarjeta simple
//   con su estado vacío, para que la acción («+ Agregar…») siga visible.
// - `open` + `onToggle`: modo controlado (el estado vive en el padre, como
//   la tarjeta Movimientos de Inicio). Sin ellos, el estado es interno y
//   empieza cerrado (`defaultOpen` lo abre al inicio).
// - `asSection`: sub-sección dentro de una tarjeta mayor (p. ej. las
//   secciones de una tanda): sin marco de tarjeta, solo título y control; el
//   fondo fijo es el de su contenedor (`surface2`).
// - `tone="gold"`: marco dorado (p. ej. Invitaciones al hogar).
// - `toggleLabel`: sustantivo para el aria-label («Ver movimientos»).
export function collapsibleToggleLabel(open: boolean): "Ver" | "Ver menos" {
  return open ? "Ver menos" : "Ver";
}

export function CollapsibleCard(p: {
  title: ReactNode;
  children: ReactNode;
  above?: ReactNode;
  below?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  asSection?: boolean;
  tone?: "default" | "gold";
  toggleLabel?: string;
  className?: string;
}) {
  const controlled = p.open !== undefined;
  const [innerOpen, setInnerOpen] = useState(p.defaultOpen ?? false);
  const open = controlled ? (p.open as boolean) : innerOpen;
  const label = collapsibleToggleLabel(open);
  const ariaLabel = p.toggleLabel
    ? open
      ? `Ver menos ${p.toggleLabel}`
      : `Ver ${p.toggleLabel}`
    : label;
  const toggle = () => {
    if (controlled) p.onToggle?.();
    else setInnerOpen((v) => !v);
  };
  // Encabezado fijo: título + resumen (`above`) a la izquierda, control
  // «Ver» / «Ver menos» arriba a la derecha. Queda pegado (sticky) justo
  // bajo la barra superior de la app — 52 px en móvil / 56 px en escritorio
  // más el área segura del iPhone — con fondo sólido, para que el contenido
  // pase por debajo sin transparentarse. z-10: por debajo de la barra
  // superior (z-20) y por encima del contenido de la tarjeta.
  const stickyTop =
    "top-[calc(52px+env(safe-area-inset-top,0px))] sm:top-[calc(56px+env(safe-area-inset-top,0px))]";
  const headerEl = (bg: string) => (
    <div className={`sticky ${stickyTop} z-10 ${bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {p.title}
          {p.above}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="text-sm font-semibold text-white shrink-0 pt-1"
          onClick={toggle}
        >
          {label}
        </button>
      </div>
    </div>
  );
  if (p.asSection) {
    return (
      <div className={p.className}>
        {headerEl("bg-[var(--surface2)]")}
        {open && <div>{p.children}</div>}
        {p.below}
      </div>
    );
  }
  const toneCls =
    p.tone === "gold"
      ? "border-2 border-[var(--gold)]"
      : "border border-[var(--border)]";
  return (
    <div
      className={`bg-[var(--surface)] ${toneCls} rounded-2xl p-4 sm:p-5 ${p.className ?? ""}`}
    >
      {headerEl("bg-[var(--surface)]")}
      {open && <div>{p.children}</div>}
      {p.below}
    </div>
  );
}
