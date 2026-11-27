import { fmtDate, money, money2 } from "../lib/format";
import { btnGhost } from "../lib/uiShared";

// Tarjeta «Comprobante Verificado» (2026-11-27, diseño aprobado por
// Heriberto): ventana modal que se abre al tocar el chip de un pago
// verificado en el detalle de la tanda. Muestra el monto recibido, la
// fecha de pago, la referencia del pago, quién lo verificó y cuándo, el
// sello circular y la miniatura de la foto del comprobante. La referencia
// se deriva de los ids de la tanda y del pago (#SF-0012-0007); el sello
// va en turquesa, el color de acento de la app. El comprobante es solo
// foto (por decisión de Heriberto no se admite PDF), así que la tarjeta
// muestra la miniatura de la foto, no un icono de PDF. Solo pagos de
// turno, no multas (B5).
export type ComprobanteVerificadoData = {
  tandaName: string;
  participantName: string;
  quincenaIndex: number;
  amountPerQuincena: number;
  paidDate: string | null;
  reference: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
  proofUrl: string | null;
  proofAmount: number | null;
};

export function ComprobanteVerificado({ data, onClose, onViewPhoto }: {
  data: ComprobanteVerificadoData;
  onClose: () => void;
  onViewPhoto: (url: string) => void;
}) {
  // Pagos verificados antes de este cambio: sin quién ni cuándo — la
  // tarjeta muestra «No registrado» y la fecha de pago. No se inventa
  // ningún dato.
  const verifiedBy = data.verifiedByName ?? "No registrado";
  const verifiedAt = data.verifiedAt ?? data.paidDate;
  const shortRef = data.reference.slice(-4);
  const mismatch = data.proofAmount != null && Math.abs(data.proofAmount - data.amountPerQuincena) > 0.51;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Comprobante verificado de ${data.participantName}`}>
      <div className="bg-[var(--surface)] text-[var(--text)] rounded-2xl w-full max-w-md p-4 sm:p-5 space-y-3 border-2 border-dashed border-[var(--gold)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-lg">Comprobante Verificado</h2>
            <p className="text-xs text-[var(--dim)] mt-0.5">{data.tandaName} · {data.participantName} · Periodo {data.quincenaIndex + 1}</p>
          </div>
          <span className="shrink-0 bg-[var(--accent)] text-[var(--accent-text)] text-xs font-bold rounded-full px-2 py-1">✓ Verificado</span>
        </div>
        <p className="text-sm">Pago recibido: <b className="font-display text-2xl whitespace-nowrap">{money(data.amountPerQuincena)}</b></p>
        <div className="space-y-1 text-sm">
          <p className="flex justify-between gap-2"><span className="text-[var(--dim)]">Fecha:</span><b>{data.paidDate ? fmtDate(data.paidDate) : "—"}</b></p>
          <p className="flex justify-between gap-2"><span className="text-[var(--dim)]">Referencia:</span><b>{data.reference}</b></p>
          <p className="flex justify-between gap-2"><span className="text-[var(--dim)]">Verificado por:</span><b>{verifiedBy}</b></p>
          <p className="flex justify-between gap-2"><span className="text-[var(--dim)]">Verificado el:</span><b>{verifiedAt ? fmtDate(verifiedAt) : "—"}</b></p>
        </div>
        {mismatch && <p className="text-xs font-bold text-[var(--red)]">Comprobante {money2(data.proofAmount ?? 0)} · No coincide con el monto</p>}
        <div className="flex items-center gap-3">
          {data.proofUrl && (
            <button type="button" aria-label={`Ampliar la foto del comprobante de ${data.participantName}`} onClick={() => onViewPhoto(data.proofUrl!)} className="shrink-0">
              <img loading="lazy" decoding="async" src={data.proofUrl} alt={`Foto del comprobante de ${data.participantName}`} className="w-16 h-16 object-cover rounded-xl border border-[var(--border)]" />
            </button>
          )}
          <div className="flex-1">
            <div className="mx-auto w-20 h-20 rounded-full border-2 border-[var(--accent)] text-[var(--accent)] flex flex-col items-center justify-center">
              <span className="text-[9px] font-bold tracking-wide">VERIFICADO</span>
              <span className="text-lg font-bold leading-none">✓</span>
              <span className="text-[10px] font-bold">#{shortRef}</span>
            </div>
          </div>
        </div>
        {data.proofUrl && (
          <>
            <button type="button" aria-label={`Ver comprobante de ${data.participantName}`} className={btnGhost} onClick={() => onViewPhoto(data.proofUrl!)}>Ver comprobante</button>
            <p className="text-xs text-[var(--dim)]">Toque la foto para ampliarla.</p>
          </>
        )}
        <button type="button" aria-label="Cerrar comprobante verificado" className={btnGhost + " w-full"} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}
