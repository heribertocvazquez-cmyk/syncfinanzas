import { useEffect, useState } from "react";
import { fmtMonthShort, MONTH_SHORT_ES } from "../lib/movementsList";

// Selector de mes y año (tarjeta Movimientos): el mes elegido es el mes
// que muestra el tablero. La ventanita se cierra al elegir un mes, con
// Escape o al tocar fuera.
// Solo se habilitan los meses de `enabledMonths` (cuando se pasa): los
// meses sin movimientos quedan atenuados y no se pueden elegir, para que
// no se pueda dejar el tablero en blanco. El mes visto siempre queda
// habilitado, aunque ya no tenga movimientos (por ejemplo, si se borraron).
// Anclaje: la ventanita se ancla a la cabecera de la tarjeta Movimientos
// (alineada a su derecha, no al botón). El botón cambia de sitio según haya
// movimientos o no —a la izquierda en la segunda fila con movimientos, a la
// derecha del título sin ellos—, y anclada al botón se salía por un lado o
// por el otro. Anclada a la cabecera, con ancho acotado al ancho de la
// cabecera, cabe completa en los dos casos a 390 px.
// Apilamiento: la ventanita vive dentro del encabezado fijo (sticky z-10)
// de la tarjeta, y sin nada más su z-50 quedaría atrapado en ese contexto:
// la cabecera fija de la tarjeta de abajo (también z-10, posterior en el
// DOM) pintaba por encima y tapaba la rejilla de meses (reporte de
// Heriberto 2026-11-18). Por eso la raíz lleva `data-popover-open` cuando
// la ventanita está abierta: el encabezado de CollapsibleCard sube a z-30
// con `has-[[data-popover-open]]` solo mientras hay un pop-up abierto,
// así la ventanita (z-50) y su fondo (z-40) quedan por encima de los demás
// encabezados fijos (z-10) y de la barra superior (z-20).
// El botón es compacto: un icono pequeño de calendario con el mes corto
// («nov 2026»), sin la píldora grande de antes. `defaultOpen` solo existe
// para poder probar la ventanita en un render estático; la app no lo usa.
function fmtMonth(ym: string | null) {
  if (!ym) return "";
  const [y = 2026, m = 1] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
}
function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function MonthPicker({
  value,
  onChange,
  enabledMonths,
  defaultOpen,
}: {
  value: string;
  onChange: (ym: string) => void;
  /** Meses «YYYY-MM» que se pueden elegir; sin él, todos habilitados. */
  enabledMonths?: Set<string> | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [year, setYear] = useState(
    () => Number(value.slice(0, 4)) || new Date().getFullYear(),
  );
  const todayMonth = todayISO().slice(0, 7);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Al abrir, el año es siempre el del mes visto (no el de la última visita).
  useEffect(() => {
    if (open) setYear(Number(value.slice(0, 4)) || new Date().getFullYear());
  }, [open, value]);
  const pick = (m: number) => {
    onChange(`${year}-${String(m + 1).padStart(2, "0")}`);
    setOpen(false);
  };
  return (
    <div className="shrink-0" data-popover-open={open ? "" : undefined}>
      <button
        type="button"
        aria-label={`Cambiar el mes, actualmente ${fmtMonth(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setYear(Number(value.slice(0, 4)));
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--dim)] px-1 py-1 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <svg
          aria-hidden="true"
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {fmtMonthShort(value)}{" "}
        <svg
          aria-hidden="true"
          className="inline w-3.5 h-3.5 -mt-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Elegir mes y año"
            className="absolute right-0 top-full mt-2 z-50 w-[min(288px,100%)] rounded-2xl border border-[var(--gold)] bg-[var(--surface)] p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
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
                const selected = ym === value;
                const enabled =
                  !enabledMonths || enabledMonths.has(ym) || selected;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-label={`${label} de ${year}`}
                    aria-pressed={selected}
                    aria-disabled={!enabled}
                    disabled={!enabled}
                    autoFocus={selected}
                    onClick={() => pick(m)}
                    className={`rounded-xl py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${selected ? "bg-[#E8B84A] text-[#13262E]" : "bg-[var(--surface2)]"} ${enabled ? "" : "opacity-40"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {value !== todayMonth &&
              (!enabledMonths || enabledMonths.has(todayMonth)) && (
              <button
                type="button"
                className="text-[13px] font-bold underline mt-3"
                onClick={() => {
                  onChange(todayMonth);
                  setOpen(false);
                }}
              >
                Ver el mes actual
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
