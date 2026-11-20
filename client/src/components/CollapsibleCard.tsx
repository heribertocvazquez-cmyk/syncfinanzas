import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

// Tarjeta plegable compartida (decisión de Heriberto 2026-11-18): todas las
// tarjetas con lista de todos los módulos empiezan CERRADAS y se abren con
// «+» / se cierran con «−», para que las listas no abarquen toda la
// pantalla. Plegada solo se ve el encabezado (title + resumen `above`).
// El control «+» / «−» va ARRIBA, dentro del encabezado, a la derecha del
// título: solo el símbolo, en el color de texto de la tarjeta. El encabezado queda FIJO (sticky) bajo
// la barra superior de la app mientras se baja por el contenido abierto,
// con fondo sólido de la tarjeta, para que el contenido pase por debajo sin
// transparentarse y el «−» nunca haya que buscarlo abajo (decisión de
// Heriberto 2026-11-18, vista previa aprobada; el símbolo sustituye al
// texto «Ver» / «Ver menos» por decisión de Heriberto 2026-11-18, en
// todas las tarjetas).
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

// Símbolo visible del control (decisión de Heriberto 2026-11-18, en todas
// las tarjetas): «+» cerrada, «−» abierta. El texto «Ver» / «Ver menos»
// se conserva solo en el aria-label, para lectores de pantalla.
export function collapsibleToggleSymbol(open: boolean): "+" | "−" {
  return open ? "−" : "+";
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
  const symbol = collapsibleToggleSymbol(open);
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
  // «+» / «−» arriba a la derecha. Queda pegado (sticky) justo bajo la
  // barra superior de la app — 52 px en móvil / 56 px en escritorio más el
  // área segura del iPhone — con fondo sólido, para que el contenido pase
  // por debajo sin transparentarse. z-10: por debajo de la barra superior
  // (z-20) y por encima del contenido de la tarjeta.
  // Apilamiento de pop-ups: un pop-up abierto dentro del encabezado (el
  // calendario MonthPicker) lleva `data-popover-open` en su raíz; mientras
  // esté abierto, `has-[[data-popover-open]]:z-30` sube ESTE encabezado
  // por encima de los demás encabezados fijos (z-10) y de la barra superior
  // (z-20), para que el pop-up (z-50) y su fondo (z-40) no queden tapados
  // por la cabecera de la tarjeta de abajo (reporte de Heriberto
  // 2026-11-18). Sin pop-up abierto el encabezado sigue en z-10, así que
  // no pinta por encima de la barra superior. El encabezado nunca se
  // solapa con la barra (se pega justo debajo de ella), así que subirlo a
  // z-30 no la tapa.
  const stickyTop =
    "top-[calc(52px+env(safe-area-inset-top,0px))] sm:top-[calc(56px+env(safe-area-inset-top,0px))]";
  // El encabezado es táctil entero (la franja se ve como botón): tocar el
  // título o el resumen también pliega/despliega. Los controles que viven
  // dentro del encabezado (p. ej. el selector de mes de Movimientos)
  // siguen siendo suyos: si el toque cae en un botón, enlace o campo, no
  // se pliega. (Reporte de Heriberto 2026-11-18: los «+» / «−» de Tandas
  // no respondían; el único blanco era el símbolo de 36 px y las
  // secciones vacías no mostraban nada al abrirse.)
  const onTitleClick = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
    toggle();
  };
  const headerEl = (bg: string) => (
    <div className={`sticky ${stickyTop} z-10 has-[[data-popover-open]]:z-30 ${bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 cursor-pointer [touch-action:manipulation]" onClick={onTitleClick}>
          {p.title}
          {p.above}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="text-2xl leading-none font-bold text-[var(--text)] shrink-0 w-11 h-11 flex items-center justify-center [touch-action:manipulation]"
          onClick={toggle}
        >
          {symbol}
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
