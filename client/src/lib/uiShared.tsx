import type { ReactNode } from "react";

// Piezas de interfaz compartidas (antes vivían en App.tsx): estrellas de
// calificación, etiqueta de formulario, clases de campos y botones, y la
// tarjeta de estado vacío. Los componentes de Tandas (detalle, lista,
// tarjeta de Inicio) las usan sin importar App.
export function Stars({ value, size }: { value: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`text-[var(--gold-text)] ${size || "text-base"}`} role="img" aria-label={`${value} de 5 estrellas`}>
      {"★★★★★".slice(0, full)}
      {"☆☆☆☆☆".slice(0, 5 - full)}
    </span>
  );
}
export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold tracking-wide text-[var(--dim)] block mb-1">
      {children}
    </label>
  );
}
export const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
export const btnPrimary =
  "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
export const btnGold =
  "rounded-full bg-[var(--gold)] text-[#13262E] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
export const btnDanger =
  "rounded-full bg-[var(--red)] text-white font-bold px-5 py-2.5 text-sm disabled:opacity-50";
export const btnGhost =
  "rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold";
export function Empty({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="border border-dashed border-[var(--border)] rounded-2xl p-4 sm:p-5 text-center">
      <p className="font-display font-bold text-lg">{title}</p>
      <p className="text-sm text-[var(--dim)] mt-1">{body}</p>
      {action && (
        <button type="button" aria-label={action.label} className={btnPrimary + " mt-3"} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
