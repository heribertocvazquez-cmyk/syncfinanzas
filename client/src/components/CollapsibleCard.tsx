import { useState, type ReactNode } from "react";

// Tarjeta plegable compartida (decisión de Heriberto 2026-11-18): todas las
// tarjetas con lista de todos los módulos empiezan CERRADAS y se abren con
// «Ver» / se cierran con «Ver menos», para que las listas no abarquen toda
// la pantalla. Plegada solo se ve el encabezado (title) y el control: solo
// el texto «Ver» en blanco, pequeño, centrado abajo de la tarjeta; al tocar
// «Ver» se despliega todo el contenido y al tocar «Ver menos» se esconde
// por completo.
//
// Uso:
//   <CollapsibleCard title={<h2 …>Título</h2>}>…lista…</CollapsibleCard>
//
// - `above`: contenido siempre visible entre el título y la lista (resumen,
//   formulario que no debe esconderse). `below`: siempre visible debajo del
//   control (totales, botón de acción). Cuando no hay nada que mostrar, NO
//   se usa este envoltorio: se pinta la tarjeta simple con su estado vacío,
//   para que la acción («+ Agregar…») siga visible.
// - `open` + `onToggle`: modo controlado (el estado vive en el padre, como
//   la tarjeta Movimientos de Inicio). Sin ellos, el estado es interno y
//   empieza cerrado (`defaultOpen` lo abre al inicio).
// - `asSection`: sub-sección dentro de una tarjeta mayor (p. ej. las
//   secciones de una tanda): sin marco de tarjeta, solo título y control.
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
  const toggleEl = (
    <div className="flex justify-center mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="text-sm font-semibold text-white"
        onClick={toggle}
      >
        {label}
      </button>
    </div>
  );
  if (p.asSection) {
    return (
      <div className={p.className}>
        {p.title}
        {p.above}
        {open && <div>{p.children}</div>}
        {toggleEl}
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
      {p.title}
      {p.above}
      {open && <div>{p.children}</div>}
      {toggleEl}
      {p.below}
    </div>
  );
}
