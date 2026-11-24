// Visor de los documentos legales de SyncFinanzas (borradores 2026-11-16)
// y del apartado «Versión de prueba». Los textos se muestran íntegros,
// sin reescribir; solo se les da formato (títulos, listas, negritas).
// Se usa en la puerta de aceptación al iniciar y en Configuración →
// Documentos legales, para volver a leerlos sin volver a aceptar.
import type { ReactNode } from "react";
import { LEGAL_DOCS, LEGAL_TEST_NOTICE, type LegalDoc } from "../lib/legalDocs";

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p,
  );
}

/** Formato mínimo y seguro del markdown de los borradores: títulos,
 *  citas, listas y negritas. Sin HTML inyectado: todo se pinta como
 *  elementos React. */
export function LegalMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc ml-5 space-y-1">
        {items.map((it, i) => (
          <li key={i}>{renderInline(it)}</li>
        ))}
      </ul>,
    );
  };
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith("- ")) {
      list.push(t.slice(2));
      return;
    }
    flushList();
    if (!t) return;
    if (t.startsWith("## ")) {
      blocks.push(
        <h3 key={idx} className="font-display font-bold text-base mt-4 first:mt-0">
          {renderInline(t.slice(3))}
        </h3>,
      );
    } else if (t.startsWith("# ")) {
      blocks.push(
        <h2 key={idx} className="font-display font-bold text-lg">
          {renderInline(t.slice(2))}
        </h2>,
      );
    } else if (t.startsWith("> ")) {
      blocks.push(
        <p key={idx} className="text-sm text-[var(--dim)] border-l-2 border-[var(--gold)] pl-3 my-2">
          {renderInline(t.slice(2))}
        </p>,
      );
    } else {
      blocks.push(
        <p key={idx} className="text-sm mt-2 first:mt-0">
          {renderInline(t)}
        </p>,
      );
    }
  });
  flushList();
  return <>{blocks}</>;
}

function LegalDocCard({ doc }: { doc: LegalDoc }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <h3 className="font-display font-bold text-lg">{doc.title}</h3>
      <p className="text-xs font-semibold text-[var(--dim)] mt-1">{doc.badge}</p>
      <div className="mt-3 max-h-72 overflow-y-auto pr-1">
        <LegalMarkdown text={doc.body} />
      </div>
    </div>
  );
}

/** Los 3 borradores legales y el apartado «Versión de prueba», para leer.
 *  `acceptedAt` (ISO) muestra cuándo se aceptaron, si ya hay aceptación. */
export function LegalDocumentsView({ acceptedAt }: { acceptedAt?: string | null }) {
  const acceptedLabel = (() => {
    if (!acceptedAt) return null;
    try {
      return new Date(acceptedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    } catch {
      return null;
    }
  })();
  return (
    <div className="space-y-4">
      {acceptedLabel && (
        <p className="text-sm text-[var(--dim)]" role="status">
          Usted aceptó estos documentos el {acceptedLabel}.
        </p>
      )}
      {LEGAL_DOCS.map((doc) => (
        <LegalDocCard key={doc.id} doc={doc} />
      ))}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="font-display font-bold text-lg">{LEGAL_TEST_NOTICE.title}</h3>
        <p className="text-xs font-semibold text-[var(--dim)] mt-1">{LEGAL_TEST_NOTICE.badge}</p>
        <div className="mt-3">
          <LegalMarkdown text={LEGAL_TEST_NOTICE.body} />
        </div>
      </div>
    </div>
  );
}
