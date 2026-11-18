import { useEffect, useState } from "react";
import { MONTH_SHORT_ES } from "../lib/movementsList";
import {
  countActiveFilters,
  DEFAULT_MOVEMENTS_FILTER,
} from "../lib/movementsFilter";
import type {
  MovementsFilterType,
  MovementsFilterValue,
} from "../lib/movementsFilter";

// Embudo de filtros del módulo Movimientos: solo se ve el icono; al
// tocarlo se abre el panel, donde se elige qué ver: cuenta, fecha
// (mes), tipo, concepto y subcategoría. La ventanita sigue el patrón
// del MonthPicker: compacta, se cierra con Escape o al tocar fuera, y
// con «Cerrar». A diferencia del MonthPicker, elegir una opción no
// cierra el panel —así se pueden poner varios filtros a la vez—; el
// panel se cierra con Escape, al tocar fuera o con «Cerrar».
// La fecha usa la misma rejilla de meses del MonthPicker (año ‹ ›,
// 3 columnas, «Ver el mes actual»), más «Todos los meses». No se
// incrusta el componente MonthPicker: su ventanita es absoluta y
// anidarla dentro de este panel la sacaría de sitio; la rejilla aquí
// va dentro del panel y se desplaza con él.
// `defaultOpen` solo existe para poder probar el panel en un render
// estático; la app no lo usa.

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
const btnPrimary =
  "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

const TYPE_CHIPS: [MovementsFilterType, string][] = [
  ["all", "Todos"],
  ["income", "Ingresos"],
  ["expense", "Gastos"],
  ["transfer", "Transferencias"],
  ["debt_payment", "Pagos de deuda"],
];

function todayMonth(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  if (!ym) return "";
  const [y = 2026, m = 1] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
}

export function MovementsFilter({
  value,
  onChange,
  accounts,
  subcategories,
  monthsWithMovements,
  defaultOpen,
}: {
  value: MovementsFilterValue;
  onChange: (v: MovementsFilterValue) => void;
  accounts: { id: number; name: string }[];
  subcategories: string[];
  /** Meses «YYYY-MM» con movimientos; la rejilla solo habilita esos. */
  monthsWithMovements?: Set<string> | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [year, setYear] = useState(
    () => Number(value.month.slice(0, 4)) || new Date().getFullYear(),
  );
  const active = countActiveFilters(value);
  const currentMonth = todayMonth();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);

  // Al abrir, el año es siempre el del mes elegido (no el de la última visita).
  useEffect(() => {
    if (open)
      setYear(Number(value.month.slice(0, 4)) || new Date().getFullYear());
  }, [open, value.month]);

  const pickMonth = (m: number) => {
    onChange({ ...value, month: `${year}-${String(m + 1).padStart(2, "0")}` });
  };

  return (
    <div className="relative">
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Filtrar movimientos"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="relative w-10 h-10 rounded-full border border-[var(--border)] flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <svg
            aria-hidden="true"
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {active > 0 && (
            <span
              aria-label={`${active} filtros activos`}
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-[11px] font-bold flex items-center justify-center"
            >
              {active}
            </span>
          )}
        </button>
      </div>
      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Filtrar movimientos"
            className="absolute right-0 top-full mt-2 z-50 w-[min(320px,100%)] max-h-[80vh] overflow-y-auto rounded-2xl border border-[var(--gold)] bg-[var(--surface)] p-4 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-display font-bold text-base">
                Filtrar movimientos
              </p>
              <button
                type="button"
                className="text-[13px] font-bold underline disabled:opacity-50"
                disabled={active === 0}
                onClick={() => onChange(DEFAULT_MOVEMENTS_FILTER)}
              >
                Limpiar filtros
              </button>
            </div>

            <div>
              <p className="text-[13px] font-bold mb-1">Cuenta</p>
              <select
                aria-label="Filtrar por cuenta"
                className={inputCls}
                value={value.account}
                onChange={(e) =>
                  onChange({ ...value, account: e.target.value })
                }
              >
                <option value="all">Todas</option>
                {accounts.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
                <option value="none">Sin cuenta</option>
              </select>
            </div>

            <div>
              <p className="text-[13px] font-bold mb-1">Fecha</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  aria-pressed={value.month === ""}
                  onClick={() => onChange({ ...value, month: "" })}
                  className={`rounded-full px-3.5 py-2 text-[13px] font-bold ${value.month === "" ? "bg-[var(--accent)] text-[var(--accent-text)]" : "border border-[var(--border)]"}`}
                >
                  Todos los meses
                </button>
                {value.month !== currentMonth && (
                  <button
                    type="button"
                    className="text-[13px] font-bold underline"
                    onClick={() =>
                      onChange({ ...value, month: currentMonth })
                    }
                  >
                    Ver el mes actual
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-3">
                <button
                  type="button"
                  aria-label={`Año anterior, ${year - 1}`}
                  onClick={() => setYear((y) => y - 1)}
                  className="w-9 h-9 rounded-full border border-[var(--border)] font-bold text-lg leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  ‹
                </button>
                <span className="font-display text-2xl font-extrabold text-[var(--gold-text)]">
                  {year}
                </span>
                <button
                  type="button"
                  aria-label={`Año siguiente, ${year + 1}`}
                  onClick={() => setYear((y) => y + 1)}
                  className="w-9 h-9 rounded-full border border-[var(--border)] font-bold text-lg leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {MONTH_SHORT_ES.map((label, m) => {
                  const ym = `${year}-${String(m + 1).padStart(2, "0")}`;
                  const selected = ym === value.month;
                  const enabled =
                    !monthsWithMovements ||
                    monthsWithMovements.has(ym) ||
                    selected;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-label={`${label} de ${year}`}
                      aria-pressed={selected}
                      aria-disabled={!enabled}
                      disabled={!enabled}
                      onClick={() => pickMonth(m)}
                      className={`rounded-xl py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${selected ? "bg-[#E8B84A] text-[#13262E]" : "bg-[var(--surface2)]"} ${enabled ? "" : "opacity-40"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--dim)] mt-2">
                {value.month
                  ? `Mes: ${monthLabel(value.month)}`
                  : "Todos los meses"}
              </p>
            </div>

            <div>
              <p className="text-[13px] font-bold mb-1">Tipo</p>
              <div
                className="flex gap-2 flex-wrap"
                role="group"
                aria-label="Mostrar movimientos por tipo"
              >
                {TYPE_CHIPS.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={`Mostrar ${l}`}
                    aria-pressed={value.type === v}
                    onClick={() => onChange({ ...value, type: v })}
                    className={`rounded-full px-3.5 py-2 text-[13px] font-bold ${value.type === v ? "bg-[var(--accent)] text-[var(--accent-text)]" : "border border-[var(--border)]"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-bold mb-1">Concepto</p>
              <input
                aria-label="Buscar movimientos"
                placeholder="Buscar concepto…"
                className={inputCls}
                value={value.search}
                onChange={(e) =>
                  onChange({ ...value, search: e.target.value })
                }
              />
            </div>

            <div>
              <p className="text-[13px] font-bold mb-1">Subcategoría</p>
              <select
                aria-label="Filtrar por subcategoría"
                className={inputCls}
                value={value.subcategory}
                onChange={(e) =>
                  onChange({ ...value, subcategory: e.target.value })
                }
              >
                <option value="all">Todas</option>
                {subcategories.map((sb) => (
                  <option key={sb} value={sb}>
                    {sb}
                  </option>
                ))}
                <option value="">Sin subcategoría</option>
              </select>
            </div>

            <button
              type="button"
              className={`${btnPrimary} w-full`}
              onClick={() => setOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
