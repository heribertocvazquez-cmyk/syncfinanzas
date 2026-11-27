// Sección «Acerca de» en Configuración → Documentos legales: crédito de
// diseño, versión viva y enlaces para volver a leer los documentos legales.
// La versión es la misma fuente que usa la tarjeta «Actualizaciones de la
// aplicación» (APP_VERSION). Los enlaces llaman a `onReadDoc` cuando App
// lo pasa (para desplazarse a la tarjeta del documento en la misma
// sección); sin ese callback, el componente se desplaza solo a la tarjeta
// por su id (`doc-privacy`, `doc-terms`, `doc-refunds`). Tono formal de
// usted; sin emojis decorativos; sin ®: SyncFinanzas aún no está registrado
// en el IMPI.
import { APP_VERSION } from "../version";
import { LEGAL_DOCS, type LegalDoc } from "../lib/legalDocs";

export type LegalDocId = LegalDoc["id"];

export function AboutSection({ onReadDoc }: { onReadDoc?: (docId: LegalDocId) => void }) {
  const readDoc = (docId: LegalDocId) => {
    if (onReadDoc) {
      onReadDoc(docId);
      return;
    }
    document.getElementById(`doc-${docId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <h3 className="font-display font-bold text-lg">Acerca de</h3>
      <p className="text-sm mt-2">Diseñada por Ren</p>
      <p className="text-sm text-[var(--dim)] mt-1">Versión: {APP_VERSION}</p>
      <p className="text-sm text-[var(--dim)] mt-1">© 2026 SyncFinanzas. Todos los derechos reservados.</p>
      <p className="text-sm font-bold mt-4">Volver a leer los documentos</p>
      <div className="mt-2 flex flex-col items-start gap-1">
        {LEGAL_DOCS.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className="text-sm font-bold text-left"
            style={{ color: "#00C2B5" }}
            aria-label={`Leer ${doc.title}`}
            onClick={() => readDoc(doc.id)}
          >
            {doc.title}
          </button>
        ))}
      </div>
    </div>
  );
}
