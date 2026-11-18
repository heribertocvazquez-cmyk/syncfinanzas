import type { BalanceGroup } from "../lib/balanceBreakdown";

const money2 = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const money = (n: number) =>
  n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });

const btnGhost =
  "rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold";

export type MoneyLocationModalProps = {
  monthLabel: string;
  availableFree: number;
  totalBalance: number;
  fundsReserved: number;
  groups: BalanceGroup[];
  unassignedNet: number;
  openingBalance: number;
  priorMonthsNet: number;
  monthNet: number;
  fundsFromAccounts: number;
  onClose: () => void;
};

/**
 * Pop-up «Dónde está su dinero»: el Disponible desglosado por dónde está
 * el dinero y qué cuenta tiene ese saldo, separado por tipo de cuenta.
 * Se cierra con la ×, con «Cerrar» o tocando fuera. También guarda las
 * líneas de cómo se forma el Total, que antes se desplegaban sobre la
 * tarjeta del resumen.
 */
export function MoneyLocationModal(p: MoneyLocationModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Dónde está su dinero"
      onClick={p.onClose}
    >
      <div
        className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--dim)]">
              DISPONIBLE · {p.monthLabel.toUpperCase()}
            </p>
            <p className="font-display font-bold text-lg leading-tight">
              Dónde está su dinero
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar dónde está su dinero"
            onClick={p.onClose}
            className="shrink-0 w-8 h-8 rounded-full bg-[var(--surface2)] border border-[var(--border)] text-xl leading-none font-bold"
          >
            ×
          </button>
        </div>
        <p className="font-display text-3xl font-extrabold mt-2">
          {money2(p.availableFree)}
        </p>
        <p className="text-sm text-[var(--dim)] mt-1">
          Total {money2(p.totalBalance)} − fondos apartados{" "}
          {money2(p.fundsReserved)}.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          {p.groups.map((g) => (
            <div key={g.key}>
              <div className="flex justify-between gap-2">
                <span className="font-bold">{g.label}</span>
                <b className="whitespace-nowrap">{money2(g.subtotal)}</b>
              </div>
              {g.accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex justify-between gap-2 pl-3 text-[var(--dim)]"
                >
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="whitespace-nowrap">{money2(a.balance)}</span>
                </div>
              ))}
            </div>
          ))}
          {Math.round(p.unassignedNet * 100) !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="font-bold">Sin cuenta</span>
              <b className="whitespace-nowrap">{money2(p.unassignedNet)}</b>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-2">
            <span className="text-[var(--dim)]">Total en cuentas</span>
            <b className="whitespace-nowrap">{money2(p.totalBalance)}</b>
          </div>
          {Math.round(p.fundsReserved * 100) !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">Fondos apartados</span>
              <b className="whitespace-nowrap">−{money2(p.fundsReserved)}</b>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-2">
            <span className="font-bold">Disponible</span>
            <b className="whitespace-nowrap">{money2(p.availableFree)}</b>
          </div>
        </div>

        <p className="font-display font-bold text-base mt-5">Cómo se forma</p>
        <div className="mt-2 text-sm space-y-1">
          {p.openingBalance !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">Saldo inicial</span>
              <b className="whitespace-nowrap">{money(p.openingBalance)}</b>
            </div>
          )}
          {p.priorMonthsNet !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">Meses anteriores</span>
              <b className="whitespace-nowrap">{money(p.priorMonthsNet)}</b>
            </div>
          )}
          {p.monthNet !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">Neto del mes</span>
              <b className="whitespace-nowrap">{money(p.monthNet)}</b>
            </div>
          )}
          {p.fundsFromAccounts !== 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">
                {p.fundsFromAccounts > 0
                  ? "Salidas a fondos"
                  : "Entradas desde fondos"}
              </span>
              <b className="whitespace-nowrap">
                {p.fundsFromAccounts > 0
                  ? `−${money(p.fundsFromAccounts)}`
                  : `+${money(-p.fundsFromAccounts)}`}
              </b>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-1">
            <span className="text-[var(--dim)]">Total</span>
            <b className="whitespace-nowrap">{money2(p.totalBalance)}</b>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            className={btnGhost + " flex-1"}
            onClick={p.onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
