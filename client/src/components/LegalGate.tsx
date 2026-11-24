// Puerta de aceptación de los documentos legales (2026-11-23;
// rediseño 2026-11-24 aprobado por Heriberto, con captura de otra app
// como modelo; corrección suya 07:37: SIN ilustración, solo texto y
// controles).
// Tras registrarse o al primer inicio de sesión, y para las cuentas que ya
// están en vivo sin aceptación registrada, la app muestra «Una última
// cosa»: un botón por documento para leerlo (aviso de privacidad, términos
// y condiciones, política de reembolsos y apartado «Versión de prueba»,
// un documento abierto a la vez) y dos casillas: una para los 3 borradores
// legales y otra para el apartado. «Comenzar» solo se activa con las dos
// marcadas; «Atrás» cierra la sesión (antes la puerta no tenía salida).
// Sin aceptar, NO se entra al tablero: los hijos (App) ni siquiera se
// montan. La aceptación guarda quién aceptó, cuándo y QUÉ VERSIÓN de cada
// documento (ver server/src/actions.ts, LEGAL_DOC_VERSIONS); si cambia la
// versión de alguno, la aceptación vieja ya no vale y la puerta vuelve a
// aparecer. Las casillas corrigen la discrepancia que los términos §6
// anotaban (hablan de casillas; la puerta usaba un solo botón).
// Si falta la tabla (no se ha corrido supabase/add-legal-acceptances.sql),
// la lectura dice no aceptado y al aceptar se avisa VISIBLEMENTE que la
// aceptación se guardará cuando se ejecute el SQL, sin entrar al tablero
// y sin silencio. Los textos de los borradores NO se tocaron.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, signOut } from "../api";
import { LegalMarkdown } from "./LegalDocs";
import { LEGAL_DOCS, LEGAL_TEST_NOTICE } from "../lib/legalDocs";

type OpenDoc = "privacy" | "terms" | "refunds" | "notice" | null;

const DOC_BUTTONS: { id: Exclude<OpenDoc, null>; label: string }[] = [
  { id: "privacy", label: "Aviso de privacidad" },
  { id: "terms", label: "Términos y condiciones" },
  { id: "refunds", label: "Política de reembolsos" },
  { id: "notice", label: "Versión de prueba" },
];

function CheckCard({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          checked ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-[var(--surface2)] border-[var(--border)]"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="var(--accent-text)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="text-sm">{label}</span>
    </label>
  );
}

export function LegalGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [acceptNote, setAcceptNote] = useState("");
  const [acceptError, setAcceptError] = useState("");
  const [openDoc, setOpenDoc] = useState<OpenDoc>(null);
  const [checkDocs, setCheckDocs] = useState(false);
  const [checkNotice, setCheckNotice] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const q = useQuery({
    queryKey: ["legalAcceptance"],
    queryFn: () => api.getLegalAcceptance({}),
    retry: 1,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptLegalDocuments({}),
    onSuccess: (res) => {
      if (res.saved) {
        setAcceptNote("");
        setAcceptError("");
        void qc.invalidateQueries({ queryKey: ["legalAcceptance"] });
      } else {
        setAcceptNote(
          "Su aceptación aún no se pudo guardar: falta ejecutar el SQL de aceptaciones legales en Supabase. En cuanto se ejecute, su aceptación quedará registrada. Por ahora no puede entrar al tablero.",
        );
      }
    },
    onError: (e) => {
      setAcceptError(e instanceof Error ? e.message : "No se pudo guardar su aceptación. Inténtelo de nuevo.");
    },
  });

  if (q.isPending) {
    return <p className="p-6 text-center text-sm text-[var(--dim)]">Cargando SyncFinanzas…</p>;
  }
  if (q.isError) {
    return (
      <main className="min-h-screen flex items-start sm:items-center justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
        <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 mt-8 sm:mt-0">
          <h1 className="font-display font-bold text-2xl">SyncFinanzas</h1>
          <p className="text-sm text-[var(--red)] mt-3" role="alert">
            No se pudo verificar su aceptación de los documentos legales. Revise su conexión e inténtelo de nuevo.
          </p>
          <button
            type="button"
            className="w-full rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-3 mt-4"
            onClick={() => void q.refetch()}
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }
  if (q.data.accepted) return <>{children}</>;

  const canStart = checkDocs && checkNotice;
  const openDocData =
    openDoc === null
      ? null
      : openDoc === "notice"
        ? LEGAL_TEST_NOTICE
        : (LEGAL_DOCS.find((d) => d.id === openDoc) ?? null);

  async function handleBack() {
    setSigningOut(true);
    await signOut();
    window.location.reload();
  }

  return (
    <main className="min-h-screen flex items-start justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
      <div className="w-full max-w-md py-6">
        <h1 className="font-display font-bold text-3xl text-center">Una última cosa</h1>
        <p className="text-sm text-[var(--dim)] text-center mt-3">
          Por favor revise y acepte nuestros términos para continuar.
        </p>
        <p className="text-xs text-[var(--dim)] text-center mt-2">
          Borradores pendientes de revisión de un abogado
        </p>

        <div className="space-y-2.5 mt-6">
          {DOC_BUTTONS.map((b) => (
            <div key={b.id}>
              <button
                type="button"
                aria-expanded={openDoc === b.id}
                onClick={() => setOpenDoc(openDoc === b.id ? null : b.id)}
                className="w-full rounded-full bg-[var(--surface2)] text-[var(--text)] px-5 py-3 text-sm font-bold"
              >
                {b.label} <span aria-hidden="true">›</span>
              </button>
              {openDoc === b.id && openDocData && (
                <div className="mt-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
                  <h3 className="font-display font-bold text-lg">{openDocData.title}</h3>
                  <p className="text-xs font-semibold text-[var(--dim)] mt-1">{openDocData.badge}</p>
                  <div className="mt-3 max-h-72 overflow-y-auto pr-1">
                    <LegalMarkdown text={openDocData.body} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 mt-5">
          <CheckCard
            checked={checkDocs}
            onChange={setCheckDocs}
            label="Acepto el aviso de privacidad, los términos y condiciones y la política de reembolsos"
          />
          <CheckCard
            checked={checkNotice}
            onChange={setCheckNotice}
            label="Acepto el apartado Versión de prueba"
          />
        </div>

        <div className="flex items-center justify-center gap-2 mt-6" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`rounded-full ${i === 3 ? "h-2.5 w-2.5 bg-[var(--text)]" : "h-2 w-2 bg-[var(--dim)] opacity-50"}`}
            />
          ))}
        </div>

        {acceptNote && (
          <p className="text-sm text-[var(--red)] mt-4" role="status">
            {acceptNote}
          </p>
        )}
        {acceptError && (
          <p className="text-sm text-[var(--red)] mt-4" role="alert">
            {acceptError}
          </p>
        )}
        <div className="flex gap-3 mt-5">
          <button
            type="button"
            disabled={signingOut}
            className="flex-1 rounded-full bg-[var(--surface2)] text-[var(--text)] font-bold px-5 py-3 disabled:opacity-50"
            onClick={() => void handleBack()}
          >
            ‹ Atrás
          </button>
          <button
            type="button"
            disabled={!canStart || accept.isPending}
            className="flex-1 rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-3 disabled:opacity-50"
            onClick={() => accept.mutate()}
          >
            {accept.isPending ? "Guardando…" : "Comenzar ✓"}
          </button>
        </div>
        <p className="text-xs text-[var(--dim)] text-center mt-3">
          «Atrás» cierra su sesión. Si cambia la versión de alguno de estos documentos, se le pedirá aceptar de
          nuevo antes de seguir usando la app.
        </p>
      </div>
    </main>
  );
}
