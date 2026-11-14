// Visor de guías en PDF (sustituye a PdfViewer de @hatch/space-sdk/pdf).
// Usa el visor nativo del navegador dentro de un iframe, con controles en
// español para cambiar de página (fragmento #page=N), descargar el PDF y
// cerrar con la × del modal. Diferencia conocida con la versión de Muse:
// el visor nativo no informa el total de páginas, así que el indicador
// muestra solo la página actual.
import { useState } from "react";

export interface PdfViewerLabels {
  loading: string;
  loadError: string;
  pageError: string;
  previousPage: string;
  nextPage: string;
  pageIndicator: (page: number, total: number) => string;
  navigationAriaLabel: string;
  pageAriaLabel: (page: number, total: number) => string;
}

export function PdfViewer({
  src,
  ariaLabel,
  labels,
}: {
  src: string;
  ariaLabel?: string;
  labels: PdfViewerLabels;
}) {
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <div
        className="flex items-center justify-between gap-2 pb-2"
        role="navigation"
        aria-label={labels.navigationAriaLabel}
      >
        <button
          type="button"
          aria-label={labels.previousPage}
          className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {labels.previousPage}
        </button>
        <p className="text-sm font-semibold" aria-label={labels.pageAriaLabel(page, 0)}>
          Página {page}
        </p>
        <button
          type="button"
          aria-label={labels.nextPage}
          className="rounded-full border px-4 py-2 text-sm font-bold"
          onClick={() => setPage((p) => p + 1)}
        >
          {labels.nextPage}
        </button>
      </div>
      {failed ? (
        <p className="text-sm text-[var(--red)] py-6 text-center">
          {labels.loadError}{" "}
          <a className="underline font-bold" href={src} download>
            Descargar la guía en PDF
          </a>
        </p>
      ) : (
        <iframe
          title={ariaLabel ?? "Guía en PDF"}
          src={`${src}#page=${page}&toolbar=0`}
          className="w-full rounded-2xl border"
          style={{ height: "62vh", background: "#fff" }}
          onError={() => setFailed(true)}
        />
      )}
      <p className="text-center pt-2">
        <a className="text-sm underline font-bold" href={src} download>
          Descargar la guía en PDF
        </a>
      </p>
    </div>
  );
}
