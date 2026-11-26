import { useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { MonthPicker } from "./MonthPicker";

// Tarjeta Movimientos de Inicio: título, selector de mes compacto (icono
// pequeño de calendario + mes corto), lista del mes y el símbolo «+» / «−»
// en blanco arriba a la derecha del título, dentro del encabezado fijo
// (CollapsibleCard). La lista empieza TOTALMENTE oculta
// (decisión de Heriberto 2026-11-18: las tarjetas con lista empiezan
// cerradas); al tocar «+» se despliegan todos los movimientos del mes y
// al tocar «−» se esconden por completo. Los botones + Gasto /
// + Ingreso quedan como estaban, abajo de la tarjeta, siempre visibles.
// Las filas ya vienen formateadas desde App.tsx (título, detalle, importe),
// porque el título y los nombres de categoría y cuenta se resuelven allí.
// Sin movimientos (o sin movimientos en el mes), la tarjeta es simple, sin
// símbolo «+», para que no aparezca un control sin nada que mostrar.
const btnPrimary =
  "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
// Las dos acciones son principales (agregar gasto / agregar ingreso):
// las dos llevan la píldora turquesa con texto oscuro como MODO PERSONAL
// (corrección 2026-11-20: la fantasma con borde quedaba vacía, su texto
// heredaba marfil sobre la tarjeta marfil).
const btnAccent = btnPrimary;

export type HomeMovRow = {
  key: number | string;
  title: string;
  detail: string;
  amount: string;
  isIncome: boolean;
  struck: boolean;
  /** Partes de un gasto dividido: se muestran al expandir la fila. */
  subRows?: { title: string; amount: string }[];
};

export function HomeMovementsCard(p: {
  month: string;
  monthLabel: string;
  onMonthChange: (ym: string) => void;
  /** Meses «YYYY-MM» con movimientos; el selector solo habilita esos. */
  monthsWithMovements?: Set<string> | null;
  /** Resumen visible sin abrir la tarjeta, p. ej. «Entradas $5,500 · Salidas $2,576». */
  summary?: string;
  rows: HomeMovRow[];
  hasAnyMovements: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
  onNewMovement: (type: "expense" | "income") => void;
}) {
  const header = (
    <div className="relative flex items-center justify-between gap-2 flex-wrap">
      <h2 className="font-display font-bold text-lg">Movimientos</h2>
      <MonthPicker
        value={p.month}
        onChange={p.onMonthChange}
        enabledMonths={p.monthsWithMovements}
      />
    </div>
  );
  const buttons = (
    <div className="flex gap-2 mt-3">
      <button
        type="button"
        aria-label="Agregar gasto"
        className={btnPrimary + " flex-1 min-h-12 sm:min-h-0"}
        onClick={() => p.onNewMovement("expense")}
      >
        + Gasto
      </button>
      <button
        type="button"
        aria-label="Agregar ingreso"
        className={btnAccent + " flex-1 min-h-12 sm:min-h-0"}
        onClick={() => p.onNewMovement("income")}
      >
        + Ingreso
      </button>
    </div>
  );
  const [expanded, setExpanded] = useState<Set<number | string>>(new Set());
  const rows = (
    <>
      {p.rows.map((r) => {
        const open = expanded.has(r.key);
        return (
          <div key={r.key} className="py-2 border-b border-[var(--border)] last:border-0 text-sm">
            <div className="flex justify-between gap-2">
              <span className="min-w-0">
                {r.title}
                <span className="text-[var(--dim)] block text-[13px]">
                  {r.detail}
                </span>
              </span>
              <b
                className={`text-base whitespace-nowrap ${r.isIncome ? "text-[var(--green)]" : ""} ${r.struck ? "line-through opacity-60" : ""}`}
              >
                {r.amount}
              </b>
            </div>
            {r.subRows && r.subRows.length > 0 && (
              <>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Ocultar" : "Ver"} las ${r.subRows.length} categorías de ${r.title}`}
                  onClick={() => setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.key)) next.delete(r.key);
                    else next.add(r.key);
                    return next;
                  })}
                  className="text-xs font-bold text-[var(--dim)] mt-1"
                >
                  {open ? "▾" : "▸"} {r.subRows.length} categorías
                </button>
                {open && (
                  <div className="mt-1 pl-3 border-l-2 border-[var(--border)]">
                    {r.subRows.map((s, i) => (
                      <div key={i} className="flex justify-between gap-2 py-1 text-[13px]">
                        <span>{s.title}</span>
                        <b className="whitespace-nowrap">{s.amount}</b>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
  if (!p.hasAnyMovements || p.rows.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-4 md:mt-6">
        {header}
        <p className="text-sm text-[var(--dim)] mt-2">
          {!p.hasAnyMovements
            ? "Sin movimientos todavía."
            : `Sin movimientos en ${p.monthLabel}.`}
        </p>
        {buttons}
      </div>
    );
  }
  return (
    <CollapsibleCard
      className="mt-4 md:mt-6"
      open={p.showAll}
      onToggle={p.onToggleShowAll}
      toggleLabel="movimientos del mes"
      title={header}
      above={p.summary ? <p className="text-sm text-[var(--dim)] mt-1">{p.summary}</p> : undefined}
      below={buttons}
    >
      {rows}
    </CollapsibleCard>
  );
}
