import { useEffect, useState } from "react";
import type { IncExpDetailView } from "../lib/movementsList";
import { accountTotalsLine, groupMovementsByMonthDay } from "../lib/movementsList";

const money2 = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const money = (n: number) =>
  n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
function fmtDate(iso: string) {
  const [y = 2026, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
const btnPrimary =
  "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost =
  "rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold";

/** Un movimiento del detalle de ingresos/gastos (ya filtrado por visibilidad). */
export type IncExpDetailMov = {
  id: number;
  concept: string;
  date: string;
  subcategory: string | null;
  categoryId: number | null;
  accountId: number | null;
  visibility: string;
  amount: number;
};

/** Un grupo por cuenta del detalle (grupos por total descendente). */
export type IncExpDetailGroup = {
  key: string;
  name: string;
  total: number;
  movs: IncExpDetailMov[];
};

export type IncExpDetailModalProps = {
  kind: "income" | "expense";
  label: string;
  movementCount: number;
  accountCount: number;
  total: number;
  hiddenCount: number;
  view: IncExpDetailView;
  onViewChange: (v: IncExpDetailView) => void;
  groups: IncExpDetailGroup[];
  flatMovs: IncExpDetailMov[];
  getCatName: (id: number | null) => string;
  getAccName: (id: number | null) => string;
  onClose: () => void;
  onGoMovements: () => void;
};

/**
 * Detalle «¿De dónde salieron los gastos?» / «¿De dónde vienen los
 * ingresos?»: los movimientos del mes, con un interruptor «Por cuenta» /
 * «Por fecha». Por cuenta (vista por defecto) cada cuenta es un grupo
 * plegable con su total y su conteo; al tocarla se abren sus movimientos
 * en fecha descendente. Por fecha agrupa en dos niveles: mes plegable
 * (total y conteo) → día plegable (total y conteo) → movimientos. Todos
 * los grupos empiezan cerrados, para que el total de cada segmento se vea
 * sin abrirlo. En «Por fecha» arriba se conserva la línea de totales por
 * cuenta, para que no se pierda de dónde salió el dinero.
 */
export function IncExpDetailModal(p: IncExpDetailModalProps) {
  const sign = p.kind === "income" ? "+" : "−";
  // Grupos plegables: empiezan cerrados. Al cambiar de vista vuelven a
  // empezar cerrados. El modal se desmonta al cerrarse, así que cada
  // apertura también empieza cerrada.
  const [openAcc, setOpenAcc] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    setOpenAcc(new Set());
    setOpenMonths(new Set());
    setOpenDays(new Set());
  }, [p.view]);
  const toggleKey = (
    open: Set<string>,
    set: (v: Set<string>) => void,
    key: string,
  ) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set(next);
  };
  // Meses con sus días para la vista «Por fecha»: la lista ya viene
  // filtrada (mes, dirección, sin reversados ni reversiones) y ordenada
  // por fecha descendente.
  const monthGroups = groupMovementsByMonthDay(p.flatMovs);
  // Un renglón de movimiento, igual que antes: en «Por fecha» incluye la
  // cuenta, en «Por cuenta» no (la cuenta es el grupo que lo contiene).
  const movRow = (m: IncExpDetailMov, showAcc: boolean, indent: boolean) => (
    <div
      key={m.id}
      className={`flex justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0 text-sm${indent ? " pl-3" : ""}`}
    >
      <span className="min-w-0">
        {m.concept}
        <span className="text-[var(--dim)] block text-xs">
          {fmtDate(m.date)}
          {m.subcategory ? ` · ${m.subcategory}` : ""} ·{" "}
          {p.getCatName(m.categoryId)}
          {showAcc ? ` · ${p.getAccName(m.accountId)}` : ""} ·{" "}
          {m.visibility === "shared" ? "Compartido" : "Privado"}
        </span>
      </span>
      <b className="shrink-0 whitespace-nowrap">
        {sign}
        {money(m.amount)}
      </b>
    </div>
  );
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label={`${p.kind === "income" ? "Ingresos" : "Gastos"} de ${p.label}`}
      onClick={p.onClose}
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">
              {p.kind === "income" ? "INGRESOS" : "GASTOS"} ·{" "}
              {p.label.toUpperCase()}
            </p>
            <p className="font-display font-bold text-lg leading-tight">
              {p.kind === "income"
                ? "¿De dónde vienen los ingresos?"
                : "¿De dónde salieron los gastos?"}
            </p>
            <p className="text-sm text-[var(--dim)] mt-1">
              {p.movementCount} movimiento(s) · {p.accountCount} cuenta(s)
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar el detalle de ingresos y gastos"
            onClick={p.onClose}
            className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold"
          >
            ×
          </button>
        </div>
        <p className="font-display text-2xl font-extrabold mt-2 whitespace-nowrap">
          {sign}
          {money2(p.total)}
        </p>
        {p.hiddenCount > 0 && (
          <p className="text-xs text-[var(--dim)] mt-1">
            No se muestran {p.hiddenCount} movimiento(s) privado(s) de otros
            integrantes del hogar.
          </p>
        )}
        {p.movementCount > 0 && (
          <div
            className="grid grid-cols-2 gap-1.5 mt-3"
            role="group"
            aria-label="Orden del detalle"
          >
            {(["cuenta", "fecha"] as const).map((v) => (
              <button
                type="button"
                key={v}
                aria-label={
                  v === "cuenta" ? "Ordenar por cuenta" : "Ordenar por fecha"
                }
                aria-pressed={p.view === v}
                onClick={() => p.onViewChange(v)}
                className={`rounded-full py-2 text-[12px] font-bold ${
                  p.view === v
                    ? "bg-[var(--accent)] text-[var(--accent-text)]"
                    : "border border-[var(--border)]"
                }`}
              >
                {v === "cuenta" ? "Por cuenta" : "Por fecha"}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2">
          {p.movementCount === 0 && (
            <p className="text-sm text-[var(--dim)]">
              {p.kind === "income"
                ? "Sin ingresos registrados este mes."
                : "Sin gastos registrados este mes."}
            </p>
          )}
          {p.view === "cuenta" &&
            p.groups.map((g) => {
              const open = openAcc.has(g.key);
              return (
                <div key={g.key} className="mt-3">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? "Cerrar" : "Abrir"} los movimientos de ${g.name}`}
                    onClick={() => toggleKey(openAcc, setOpenAcc, g.key)}
                    className="w-full flex items-center justify-between gap-2 py-2 text-sm text-left"
                  >
                    <span className="font-bold min-w-0">
                      <span className="text-[var(--dim)] font-normal mr-1">
                        {open ? "⌄" : "›"}
                      </span>
                      {g.name}
                      <span className="text-[var(--dim)] font-normal">
                        {" "}
                        · {g.movs.length} movimiento(s)
                      </span>
                    </span>
                    <b className="whitespace-nowrap shrink-0">
                      {money2(g.total)}
                    </b>
                  </button>
                  {open && g.movs.map((m) => movRow(m, false, false))}
                </div>
              );
            })}
          {p.view === "fecha" && p.movementCount > 0 && (
            <div className="mt-3">
              <p className="text-sm text-[var(--dim)]">
                {accountTotalsLine(p.groups, money2)}
              </p>
              {monthGroups.map((mg) => {
                const mOpen = openMonths.has(mg.key);
                return (
                  <div key={mg.key} className="mt-3">
                    <button
                      type="button"
                      aria-expanded={mOpen}
                      aria-label={`${mOpen ? "Cerrar" : "Abrir"} los días de ${mg.label}`}
                      onClick={() =>
                        toggleKey(openMonths, setOpenMonths, mg.key)
                      }
                      className="w-full flex items-center justify-between gap-2 py-2 text-sm text-left"
                    >
                      <span className="font-bold min-w-0">
                        <span className="text-[var(--dim)] font-normal mr-1">
                          {mOpen ? "⌄" : "›"}
                        </span>
                        {mg.label}
                        <span className="text-[var(--dim)] font-normal">
                          {" "}
                          · {mg.count} movimiento(s)
                        </span>
                      </span>
                      <b className="whitespace-nowrap shrink-0">
                        {sign}
                        {money2(mg.total)}
                      </b>
                    </button>
                    {mOpen &&
                      mg.days.map((dg) => {
                        const dOpen = openDays.has(dg.key);
                        return (
                          <div key={dg.key}>
                            <button
                              type="button"
                              aria-expanded={dOpen}
                              aria-label={`${dOpen ? "Cerrar" : "Abrir"} los movimientos del ${dg.label}`}
                              onClick={() =>
                                toggleKey(openDays, setOpenDays, dg.key)
                              }
                              className="w-full flex items-center justify-between gap-2 py-2 pl-3 text-sm text-left"
                            >
                              <span className="font-bold min-w-0">
                                <span className="text-[var(--dim)] font-normal mr-1">
                                  {dOpen ? "⌄" : "›"}
                                </span>
                                {dg.label}
                                <span className="text-[var(--dim)] font-normal">
                                  {" "}
                                  · {dg.count} movimiento(s)
                                </span>
                              </span>
                              <b className="whitespace-nowrap shrink-0">
                                {sign}
                                {money2(dg.total)}
                              </b>
                            </button>
                            {dOpen && dg.movs.map((m) => movRow(m, true, true))}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            className={btnPrimary + " flex-1"}
            onClick={p.onGoMovements}
          >
            Ver todos los movimientos
          </button>
          <button type="button" className={btnGhost} onClick={p.onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
