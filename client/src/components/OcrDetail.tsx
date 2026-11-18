import { fmtDate, money2 } from "../lib/format";
import type { ReceiptRead } from "../lib/smart";

// Detalle leído del comprobante (solo lectura, no se guarda): lo que el
// lector propio encontró en el ticket para que la persona lo revise antes
// de guardar. Si la suma de artículos no cuadra con el total, el total
// queda marcado «Por revisar». Antes vivía en App.tsx; se mueve aquí
// porque el detalle de tanda también lo muestra (revisión del comprobante
// de pago de tanda).
export function OcrDetail({ detail }: { detail: ReceiptRead }) {
  return (
    <div className="mt-2 border border-[var(--border)] rounded-xl p-3 bg-[var(--surface2)]">
      <p className="text-sm font-bold">Detalle leído del comprobante</p>
      <p className="text-xs text-[var(--dim)]">Solo para revisar; no se guarda con el movimiento.</p>
      <dl className="mt-2 space-y-1 text-sm">
        {detail.store && <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Comercio</dt><dd className="font-semibold text-right">{detail.store}</dd></div>}
        {detail.date && <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Fecha del ticket</dt><dd className="font-semibold text-right">{fmtDate(detail.date)}</dd></div>}
        {detail.rfc && <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">RFC</dt><dd className="font-semibold text-right">{detail.rfc}</dd></div>}
        {detail.payment && <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Forma de pago</dt><dd className="font-semibold text-right">{detail.payment}</dd></div>}
        {detail.subtotal != null && <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Subtotal</dt><dd className="font-semibold text-right">{money2(detail.subtotal)}</dd></div>}
        <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Total</dt><dd className="font-semibold text-right">{money2(detail.total ?? 0)}{detail.sumsMatch === false && <span className="ml-1 font-bold text-[var(--red)]">· Por revisar</span>}</dd></div>
      </dl>
      {detail.items.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-bold text-[var(--dim)]">Artículos ({detail.items.length})</p>
          <ul className="mt-1 space-y-1 text-sm">
            {detail.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-2"><span className="min-w-0">{it.name}</span><b className="whitespace-nowrap shrink-0">{money2(it.amount)}</b></li>
            ))}
          </ul>
          {detail.itemsSum != null && detail.total != null && (
            <p className={`text-xs mt-2 ${detail.sumsMatch ? "text-[var(--green)]" : "font-bold text-[var(--red)]"}`}>
              {detail.sumsMatch
                ? `Los artículos suman ${money2(detail.itemsSum)} y cuadran con el total.`
                : `Los artículos suman ${money2(detail.itemsSum)} y el total leído es ${money2(detail.total)}. No cuadra: revise el total antes de guardar.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
