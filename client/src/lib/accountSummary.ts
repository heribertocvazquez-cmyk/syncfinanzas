// Resumen de una cuenta: cómo nace su saldo y cómo se descuenta
// (módulo Cuentas y «Dónde está su dinero»). Las aportaciones sin cuenta
// no se asignan a ninguna cuenta. Funciones puras para poder probarlas
// en Node y en render.

export type AccountSummarySetAside = {
  fundId: number;
  name: string;
  /** Neto que el fondo tomó de la cuenta (aportes menos retiros):
   *  positivo = salió de la cuenta; negativo = volvió a ella. */
  amount: number;
};

export type AccountSummary = {
  accountId: number;
  initialBalance: number;
  income: number;
  expense: number;
  transfersIn: number;
  transfersOut: number;
  setAsides: AccountSummarySetAside[];
  balance: number;
};

export type AccountSummaryRow = {
  key: string;
  label: string;
  amount: number;
  /** 1 = suma al saldo; -1 = resta del saldo. */
  sign: 1 | -1;
};

/** Filas del resumen, en orden: cómo nace el saldo, cómo se descuenta,
 *  y al final el saldo de la cuenta. Las filas en $0 no se muestran
 *  (salvo el saldo). */
export function accountSummaryRows(s: AccountSummary): AccountSummaryRow[] {
  const rows: AccountSummaryRow[] = [];
  if (Math.round(s.initialBalance * 100) !== 0)
    rows.push({
      key: "initial",
      label: "Saldo inicial",
      amount: s.initialBalance,
      sign: 1,
    });
  if (Math.round(s.income * 100) !== 0)
    rows.push({ key: "income", label: "Ingresos", amount: s.income, sign: 1 });
  if (Math.round(s.expense * 100) !== 0)
    rows.push({ key: "expense", label: "Gastos", amount: s.expense, sign: -1 });
  if (Math.round(s.transfersIn * 100) !== 0)
    rows.push({
      key: "transfersIn",
      label: "Transferencias recibidas",
      amount: s.transfersIn,
      sign: 1,
    });
  if (Math.round(s.transfersOut * 100) !== 0)
    rows.push({
      key: "transfersOut",
      label: "Transferencias enviadas",
      amount: s.transfersOut,
      sign: -1,
    });
  for (const a of s.setAsides) {
    if (Math.round(a.amount * 100) === 0) continue;
    rows.push(
      a.amount > 0
        ? {
            key: `fund-${a.fundId}`,
            label: `Apartado a ${a.name}`,
            amount: a.amount,
            sign: -1,
          }
        : {
            key: `fund-${a.fundId}`,
            label: `Devolución de ${a.name}`,
            amount: -a.amount,
            sign: 1,
          },
    );
  }
  rows.push({
    key: "balance",
    label: "Saldo de la cuenta",
    amount: s.balance,
    sign: 1,
  });
  return rows;
}

/** Comprobación: las filas (sin contar la fila del saldo) deben sumar
 *  el saldo de la cuenta. */
export function accountSummaryBalances(s: AccountSummary): boolean {
  const sum = accountSummaryRows(s)
    .filter((r) => r.key !== "balance")
    .reduce((t, r) => t + r.sign * r.amount, 0);
  return Math.round(sum * 100) === Math.round(s.balance * 100);
}
