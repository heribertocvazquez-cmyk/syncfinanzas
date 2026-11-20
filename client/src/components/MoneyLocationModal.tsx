import { useState } from "react";
import type { BalanceGroup } from "../lib/balanceBreakdown";
import {
  accountSummaryRows,
  type AccountSummary,
} from "../lib/accountSummary";

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
  /** Total apartado en metas/fondos (Saldo real = Disponible + este total). */
  totalInFunds: number;
  /** Metas/fondos con su saldo, para el desglose de lo apartado. */
  funds: { id: number; name: string; balance: number }[];
  /** Resumen de cada cuenta: cómo nace su saldo y cómo se descuenta. */
  accountSummaries: AccountSummary[];
  onClose: () => void;
};

/**
 * Pop-up «Dónde está su dinero»: el Disponible desglosado por dónde está
 * el dinero y qué cuenta tiene ese saldo, separado por tipo de cuenta.
 * Se cierra con la ×, con «Cerrar» o tocando fuera. También guarda las
 * líneas de cómo se forma el Total, que antes se desplegaban sobre la
 * tarjeta del resumen. Cada cuenta se puede abrir para ver su resumen
 * (saldo inicial + ingresos − gastos − apartados = saldo), y al final
 * va la conciliación completa con el Saldo real.
 */
export function MoneyLocationModal(p: MoneyLocationModalProps) {
  const [openAcc, setOpenAcc] = useState<number | null>(null);
  // Lo apartado que no salió de ninguna cuenta (saldo inicial sin
  // cuenta, sobrante del mes, semilla demo): sigue contando en el Saldo
  // real, pero en ningún resumen de cuenta.
  const unassignedFunds = Math.round(
    (p.totalInFunds - p.fundsFromAccounts) * 100,
  ) / 100;
  const fundsWithBalance = p.funds.filter(
    (f) => Math.round(f.balance * 100) !== 0,
  );
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
              {g.accounts.map((a) => {
                const sum = p.accountSummaries.find(
                  (x) => x.accountId === a.id,
                );
                const rows = sum ? accountSummaryRows(sum) : [];
                const open = openAcc === a.id;
                return (
                  <div key={a.id}>
                    {sum ? (
                      <button
                        type="button"
                        aria-label={`Ver resumen de la cuenta ${a.name}`}
                        aria-expanded={open}
                        className="w-full flex justify-between gap-2 pl-3 text-[var(--dim)] text-left"
                        onClick={() => setOpenAcc(open ? null : a.id)}
                      >
                        <span className="min-w-0 truncate">
                          {a.name} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                        </span>
                        <span className="whitespace-nowrap">
                          {money2(a.balance)}
                        </span>
                      </button>
                    ) : (
                      <div className="flex justify-between gap-2 pl-3 text-[var(--dim)]">
                        <span className="min-w-0 truncate">{a.name}</span>
                        <span className="whitespace-nowrap">
                          {money2(a.balance)}
                        </span>
                      </div>
                    )}
                    {open && sum && (
                      <div className="pl-6 mt-1 space-y-0.5 text-[13px]">
                        {rows.map((r) => (
                          <div
                            key={r.key}
                            className="flex justify-between gap-2"
                          >
                            <span
                              className={
                                r.key === "balance"
                                  ? "font-bold"
                                  : "text-[var(--dim)]"
                              }
                            >
                              {r.label}
                            </span>
                            <span className="whitespace-nowrap">
                              {r.sign < 0 ? "−" : ""}
                              {money2(r.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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

        {/* Conciliación completa: lo apartado por meta/fondo y la línea
            inversa Disponible + Apartados = Saldo real. Sin metas ni
            fondos, este bloque no aparece y el detalle queda como hoy. */}
        {Math.round(p.totalInFunds * 100) !== 0 && (
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-bold">Apartados por meta/fondo</span>
              <b className="whitespace-nowrap">{money2(p.totalInFunds)}</b>
            </div>
            {fundsWithBalance.map((f) => (
              <div
                key={f.id}
                className="flex justify-between gap-2 pl-3 text-[var(--dim)]"
              >
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="whitespace-nowrap">{money2(f.balance)}</span>
              </div>
            ))}
            <div className="mt-2 rounded-xl border border-[var(--gold)] bg-[var(--surface2)] px-3 py-2">
              <p className="text-[13px] font-bold">
                Disponible + Apartados = Saldo real
              </p>
              <p className="text-[13px] mt-0.5">
                {money2(p.availableFree)} + {money2(p.totalInFunds)} ={" "}
                <b>{money2(p.availableFree + p.totalInFunds)}</b>
              </p>
            </div>
            {unassignedFunds > 0 && (
              <p className="text-xs text-[var(--dim)]">
                {money(unassignedFunds)} de lo apartado no salió de ninguna
                cuenta (saldo inicial o sobrante del mes).
              </p>
            )}
          </div>
        )}

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
