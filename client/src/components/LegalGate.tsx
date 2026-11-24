// Puerta de aceptación de los documentos legales (2026-11-23).
// Tras registrarse o al primer inicio de sesión, y para las cuentas que ya
// están en vivo sin aceptación registrada, la app muestra los 3 borradores
// legales (aviso de privacidad, términos y condiciones, política de
// reembolsos) y el apartado «Versión de prueba», y un botón de aceptación.
// Sin aceptar, NO se entra al tablero: los hijos (App) ni siquiera se
// montan. La aceptación guarda quién aceptó, cuándo y QUÉ VERSIÓN de cada
// documento (ver server/src/actions.ts, LEGAL_DOC_VERSIONS); si cambia la
// versión de alguno, la aceptación vieja ya no vale y la puerta vuelve a
// aparecer.
// Si falta la tabla (no se ha corrido supabase/add-legal-acceptances.sql),
// la lectura dice no aceptado y al aceptar se avisa VISIBLEMENTE que la
// aceptación se guardará cuando se ejecute el SQL, sin entrar al tablero
// y sin silencio.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { LegalDocumentsView } from "./LegalDocs";

export function LegalGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [acceptNote, setAcceptNote] = useState("");
  const [acceptError, setAcceptError] = useState("");
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

  return (
    <main className="min-h-screen flex items-start justify-center p-4 bg-[var(--bg)] text-[var(--text)]">
      <div className="w-full max-w-2xl py-6">
        <h1 className="font-display font-bold text-2xl">Antes de empezar</h1>
        <p className="text-sm text-[var(--dim)] mt-2">
          Para usar SyncFinanzas, lea los siguientes documentos y acéptelos. Son borradores pendientes de revisión
          de un abogado. Al aceptar, usted acepta el aviso de privacidad, los términos y condiciones, la política de
          reembolsos y el apartado «Versión de prueba».
        </p>
        <div className="mt-4">
          <LegalDocumentsView />
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
        <button
          type="button"
          disabled={accept.isPending}
          className="w-full rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-3 mt-5 disabled:opacity-50"
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? "Guardando…" : "Aceptar los documentos y continuar"}
        </button>
        <p className="text-xs text-[var(--dim)] mt-3">
          Si cambia la versión de alguno de estos documentos, se le pedirá aceptar de nuevo antes de seguir usando
          la app.
        </p>
      </div>
    </main>
  );
}
