import { CollapsibleCard } from "./CollapsibleCard";
import { MonthPicker } from "./MonthPicker";

// Tarjeta Movimientos de Inicio: título, selector de mes compacto (icono
// pequeño de calendario + mes corto), lista del mes y el texto «Ver» en
// blanco arriba a la derecha del título, dentro del encabezado fijo
// (CollapsibleCard). La lista empieza TOTALMENTE oculta
// (decisión de Heriberto 2026-11-18: las tarjetas con lista empiezan
// cerradas); al tocar «Ver» se despliegan todos los movimientos del mes y
// al tocar «Ver menos» se esconden por completo. Los botones + Gasto /
// + Ingreso quedan como estaban, abajo de la tarjeta, siempre visibles.
// Las filas ya vienen formateadas desde App.tsx (título, detalle, importe),
// porque el título y los nombres de categoría y cuenta se resuelven allí.
// Sin movimientos (o sin movimientos en el mes), la tarjeta es simple, sin
// control «Ver», para que no aparezca un control sin nada que mostrar.
const btnPrimary =
  "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost =
  "rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold";

export type HomeMovRow = {
  key: number | string;
  title: string;
  detail: string;
  amount: string;
  isIncome: boolean;
  struck: boolean;
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
        className={btnGhost + " flex-1"}
        onClick={() => p.onNewMovement("income")}
      >
        + Ingreso
      </button>
    </div>
  );
  const rows = (
    <>
      {p.rows.map((r) => (
        <div
          key={r.key}
          className="flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm"
        >
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
      ))}
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
