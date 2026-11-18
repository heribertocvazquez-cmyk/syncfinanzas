import { fmtDate, money, todayISO } from "../lib/format";
import type { OverviewData } from "../lib/helpDynamic";

// Una tanda creada, en tarjeta compacta: nombre, monto por periodo,
// frecuencia, participantes y próximo turno. Al tocarla se abre su vista
// de detalle (decisión de Heriberto 2026-11-18: el desglose de
// seguimiento vive dentro de la tanda, no en línea en el módulo).
export type Tanda = OverviewData["tandas"][number];

export function tandaFreqLabel(frequency: string) {
  return frequency === "semanal" ? "semana" : frequency === "mensual" ? "mes" : "quincena";
}

export function tandaNextTurn(td: Tanda) {
  return td.calendar.find((c) => c.date >= todayISO()) || td.calendar[td.calendar.length - 1] || null;
}

export function TandaCard({ td, onOpen }: { td: Tanda; onOpen: () => void }) {
  const next = tandaNextTurn(td);
  return (
    <button
      type="button"
      aria-label={`Ver el detalle de la tanda ${td.name}`}
      onClick={onOpen}
      className="w-full text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-display font-bold text-base">{td.name}</span>
          <span className="block text-xs text-[var(--dim)] mt-0.5">
            {money(td.amountPerQuincena)} por {tandaFreqLabel(td.frequency)} · {td.participants.length}/{td.participantCount} participantes
          </span>
          {next ? (
            <span className="block text-sm mt-1">
              Siguiente: <b>{next.receiverName ? `recibe ${next.receiverName}` : "pendiente de sorteo"}</b> · {fmtDate(next.date)} · {money(next.amount)}
            </span>
          ) : (
            <span className="block text-sm mt-1 text-[var(--dim)]">Sin periodos todavía.</span>
          )}
        </span>
        <span aria-hidden="true" className="text-[var(--dim)] text-xl leading-none shrink-0">›</span>
      </span>
    </button>
  );
}
