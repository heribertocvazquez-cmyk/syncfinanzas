import { useState, type ReactNode } from "react";
import type { BalanceGroup } from "../lib/balanceBreakdown";
import {
  accountSummaryRows,
  type AccountSummary,
} from "../lib/accountSummary";
import { fundPct } from "../lib/goalMonth";
import { money, money2 } from "../lib/format";

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
  /** Metas/fondos con su saldo y su meta, para el desglose de lo apartado. */
  funds: {
    id: number;
    name: string;
    balance: number;
    targetAmount: number | null;
  }[];
  /** Resumen de cada cuenta: cómo nace su saldo y cómo se descuenta. */
  accountSummaries: AccountSummary[];
  onClose: () => void;
};

/**
 * Un bolsillo del pop-up (mejora #47 v5, vista previa aprobada por
 * Heriberto 2026-11-24): título + monto en grande + barra de llenado +
 * desglose plegable. Empieza abierto, como en la vista previa: el
 * pop-up existe para mostrar el desglose, no para esconderlo.
 */
function Pocket(p: {
  title: string;
  amount: number;
  pct: number;
  pctLabel: string;
  accent: "accent" | "gold";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bar =
    p.accent === "accent" ? "bg-[var(--accent)]" : "bg-[var(--gold)]";
  const border =
    p.accent === "accent"
      ? "border-[var(--accent)]"
      : "border-[var(--gold)]";
  const titleColor =
    p.accent === "accent"
      ? "text-[var(--accent)]"
      : "text-[var(--gold-text)]";
  const toggle = () => setOpen((v) => !v);
  return (
    <div className={`rounded-2xl border ${border} bg-[var(--surface2)] p-4`}>
      <div
        className="flex items-start justify-between gap-2 cursor-pointer [touch-action:manipulation]"
        onClick={toggle}
      >
        <div className="min-w-0">
          <p className={`font-bold ${titleColor}`}>{p.title}</p>
          <p className="font-display text-2xl font-extrabold mt-1 whitespace-nowrap">
            {money2(p.amount)}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={
            open
              ? `Ocultar desglose de ${p.title}`
              : `Ver desglose de ${p.title}`
          }
          className="text-2xl leading-none font-bold shrink-0 w-11 h-11 flex items-center justify-center [touch-action:manipulation]"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {open ? "−" : "+"}
        </button>
      </div>
      <div
        className="h-2 bg-[var(--surface)] rounded-full mt-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={p.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Porcentaje de ${p.title}`}
      >
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${p.pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--dim)] mt-1">{p.pctLabel}</p>
      {open && <div className="mt-3 space-y-1 text-sm">{p.children}</div>}
    </div>
  );
}

/**
 * Pop-up «Dónde está su dinero» (mejora #47 v5): primero una frase en
 * palabras simples con los tres montos, luego dos bolsillos — «Para
 * gastar hoy» y «Apartado» — cada uno con su monto, su barra y su
 * desglose. Cada cuenta dice cuánto de su saldo ya está apartado y a
 * qué fondo; cada fondo dice su meta, su avance y de qué cuenta salió.
 * Se cierra con la ×, con «Cerrar» o tocando fuera. Al final va
 * «Cómo se forma», sin cambios.
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
  const saldoReal =
    Math.round((p.availableFree + p.totalInFunds) * 100) / 100;
  const pctAvailable =
    saldoReal > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((p.availableFree / saldoReal) * 100),
          ),
        )
      : 0;
  const pctSetAside = saldoReal > 0 ? 100 - pctAvailable : 0;
  const accountNames = new Map<number, string>();
  for (const g of p.groups)
    for (const a of g.accounts) accountNames.set(a.id, a.name);
  // Cuentas de las que salió el dinero de cada fondo (según los
  // apartados de cada resumen de cuenta).
  const fundSources = (fundId: number): string[] => {
    const names: string[] = [];
    for (const s of p.accountSummaries) {
      for (const a of s.setAsides) {
        if (a.fundId === fundId && Math.round(a.amount * 100) > 0) {
          const n = accountNames.get(s.accountId);
          if (n && !names.includes(n)) names.push(n);
        }
      }
    }
    return names;
  };
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
        <p className="font-bold text-[15px] leading-snug mt-3">
          De {money2(saldoReal)} que tiene el hogar,{" "}
          {money2(p.availableFree)} los puede gastar hoy.
          {p.totalInFunds > 0 && (
            <>
              {" "}
              Los otros {money2(p.totalInFunds)} están apartados
              {fundsWithBalance.length > 0 && (
                <>
                  {" "}
                  en {fundsWithBalance.length}{" "}
                  {fundsWithBalance.length === 1 ? "fondo" : "fondos"}
                </>
              )}
              .
            </>
          )}
        </p>

        <div className="mt-4 space-y-3">
          <Pocket
            title="Para gastar hoy"
            amount={p.availableFree}
            pct={pctAvailable}
            pctLabel={`${pctAvailable}% de su dinero`}
            accent="accent"
          >
            <div className="flex justify-between gap-2">
              <span className="text-[var(--dim)]">En cuentas</span>
              <b className="whitespace-nowrap">{money2(p.totalBalance)}</b>
            </div>
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
                  const setAsides = (sum?.setAsides ?? []).filter(
                    (x) => Math.round(x.amount * 100) !== 0,
                  );
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
                            {a.name}{" "}
                            <span aria-hidden="true">
                              {open ? "▾" : "▸"}
                            </span>
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
                      {setAsides.map((x) => (
                        <p
                          key={x.fundId}
                          className="pl-6 text-xs text-[var(--dim)]"
                        >
                          ·{" "}
                          {x.amount > 0
                            ? `${money2(x.amount)} apartado a ${x.name}`
                            : `${money2(-x.amount)} volvió de ${x.name}`}
                        </p>
                      ))}
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
              <div>
                <div className="flex justify-between gap-2">
                  <span className="font-bold">Dinero sin cuenta</span>
                  <b className="whitespace-nowrap">
                    {money2(p.unassignedNet)}
                  </b>
                </div>
                <p className="text-xs text-[var(--dim)]">
                  Movimientos sin cuenta asignada.
                </p>
              </div>
            )}
          </Pocket>

          {Math.round(p.totalInFunds * 100) !== 0 && (
            <Pocket
              title="Apartado"
              amount={p.totalInFunds}
              pct={pctSetAside}
              pctLabel={`${pctSetAside}% de su dinero · en ${fundsWithBalance.length} ${fundsWithBalance.length === 1 ? "fondo" : "fondos"}`}
              accent="gold"
            >
              {fundsWithBalance.map((f) => {
                const pct = f.targetAmount != null ? fundPct(f) : null;
                const sources = fundSources(f.id);
                const parts: string[] = [];
                if (f.targetAmount != null)
                  parts.push(`de ${money2(f.targetAmount)}`);
                if (pct != null) parts.push(`${pct}%`);
                if (sources.length > 0)
                  parts.push(`de ${sources.join(" y ")}`);
                return (
                  <div key={f.id}>
                    <div className="flex justify-between gap-2 text-[var(--dim)]">
                      <span className="min-w-0 truncate">{f.name}</span>
                      <span className="whitespace-nowrap">
                        {money2(f.balance)}
                      </span>
                    </div>
                    {parts.length > 0 && (
                      <p className="pl-3 text-xs text-[var(--dim)]">
                        {parts.join(" · ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </Pocket>
          )}
        </div>

        {unassignedFunds > 0 && (
          <p className="text-xs text-[var(--dim)] mt-3">
            De lo apartado, {money2(unassignedFunds)} no salió de ninguna
            cuenta. Por eso el Saldo real ({money2(saldoReal)}) es mayor que
            el Total en cuentas ({money2(p.totalBalance)}).
          </p>
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
