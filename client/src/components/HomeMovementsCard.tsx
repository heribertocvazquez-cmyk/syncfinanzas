import { MonthPicker } from "./MonthPicker";
import {
  homeMovsToggleLabel,
  showHomeMovsToggle,
  visibleHomeMovements,
} from "../lib/movementsList";

// Tarjeta Movimientos de Inicio: título, selector de mes compacto (icono
// pequeño de calendario + mes corto), lista del mes y, abajo, solo el
// texto «Ver» en blanco, centrado, para ver todos los movimientos del
// mes («Ver menos» para volver a los 5 primeros). Los botones + Gasto /
// + Ingreso quedan como estaban, abajo de la tarjeta.
// Las filas ya vienen formateadas desde App.tsx (título, detalle, importe),
// porque el título y los nombres de categoría y cuenta se resuelven allí.
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
  rows: HomeMovRow[];
  hasAnyMovements: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
  onNewMovement: (type: "expense" | "income") => void;
}) {
  const visible = visibleHomeMovements(p.rows, p.showAll);
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 mt-4 md:mt-6">
      <div className="relative flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display font-bold text-lg">Movimientos</h2>
        <MonthPicker value={p.month} onChange={p.onMonthChange} />
      </div>
      {!p.hasAnyMovements ? (
        <p className="text-sm text-[var(--dim)] mt-2">
          Sin movimientos todavía.
        </p>
      ) : p.rows.length === 0 ? (
        <p className="text-sm text-[var(--dim)] mt-2">
          Sin movimientos en {p.monthLabel}.
        </p>
      ) : (
        <>
          {visible.map((r) => (
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
          {showHomeMovsToggle(p.rows.length) && (
            <div className="flex justify-center mt-3">
              <button
                type="button"
                aria-label={
                  p.showAll
                    ? "Ver menos movimientos"
                    : "Ver todos los movimientos del mes"
                }
                className="text-sm font-semibold text-white"
                onClick={p.onToggleShowAll}
              >
                {homeMovsToggleLabel(p.showAll)}
              </button>
            </div>
          )}
        </>
      )}
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
    </div>
  );
}
