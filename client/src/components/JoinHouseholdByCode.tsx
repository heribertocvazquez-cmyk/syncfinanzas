// Formulario para solicitar entrar a un hogar con su código (Hogar):
// la persona escribe el código, ve a qué hogar pertenece y solicita
// entrar. No acepta nada directamente: la entrada la da la aprobación
// del administrador. Muestra el estado de la solicitud (pendiente,
// aprobada, rechazada, ya integrante). El código por sí solo no da acceso
// a nada del hogar.
import { useState } from "react";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost = "rounded-full border border-[var(--border)] bg-[var(--surface)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

export type JoinRequestStatus = "none" | "pending" | "approved" | "rejected" | "member";

export type JoinByCodeApi = {
  requestHouseholdJoinByCode: (args: { code: string; firstName: string; lastName?: string }) => Promise<{ id: number; reused: boolean; householdName: string | null }>;
  getJoinRequestStatusByCode: (args: { code: string }) => Promise<{ status: JoinRequestStatus; householdName: string | null }>;
};

export function JoinHouseholdByCode(p: {
  api: JoinByCodeApi;
  defaultFirstName?: string;
  defaultLastName?: string;
}) {
  const [code, setCode] = useState("");
  const [first, setFirst] = useState(p.defaultFirstName ?? "");
  const [last, setLast] = useState(p.defaultLastName ?? "");
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [status, setStatus] = useState<JoinRequestStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const lookup = async () => {
    const c = code.trim();
    if (c.length < 6) {
      setError("Escriba el código del hogar (6 caracteres).");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await p.api.getJoinRequestStatusByCode({ code: c });
      setHouseholdName(r.householdName);
      setStatus(r.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo revisar el código.");
      setStatus(null);
      setHouseholdName(null);
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    if (!first.trim()) {
      setFormError("Escriba su nombre para solicitar entrar al hogar.");
      return;
    }
    setBusy(true);
    setError("");
    setFormError("");
    setNotice("");
    try {
      const r = await p.api.requestHouseholdJoinByCode({ code: code.trim(), firstName: first.trim(), lastName: last.trim() || undefined });
      setHouseholdName(r.householdName);
      setStatus("pending");
      setNotice(r.reused ? "Ya tenía una solicitud pendiente para este hogar." : "Solicitud enviada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCode("");
    setHouseholdName(null);
    setStatus(null);
    setError("");
    setFormError("");
    setNotice("");
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-2">
      <h3 className="font-display font-bold text-lg">Solicitar entrar a un hogar</h3>
      <p className="text-sm text-[var(--dim)]">
        Si tiene el código de un hogar, escríbalo para solicitar entrar. El administrador del hogar debe aprobar su
        solicitud; el código por sí solo no le da acceso a los datos del hogar.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input
          aria-label="Código del hogar para solicitar entrar"
          placeholder="Código · 6 caracteres"
          className={inputCls + " flex-1 min-w-[160px] uppercase font-mono tracking-[0.2em]"}
          value={code}
          maxLength={12}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="button" className={btnPrimary} onClick={() => void lookup()} disabled={busy || code.trim().length < 6}>
          {busy ? "Buscando…" : "Buscar hogar"}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      {status && householdName && (
        <div className="text-sm space-y-2 border border-[var(--border)] rounded-2xl p-3">
          <p>
            Hogar <b>“{householdName}”</b>
          </p>
          {status === "member" && <p className="text-[var(--green)]">Ya es integrante de este hogar.</p>}
          {status === "pending" && (
            <>
              <p>
                <b>Su solicitud está pendiente de aprobación.</b>
              </p>
              <p className="text-[var(--dim)]">El administrador del hogar debe aprobarla. Cuando lo haga, podrá entrar al hogar.</p>
            </>
          )}
          {status === "approved" && (
            <>
              <p>
                <b>Su solicitud fue aprobada.</b>
              </p>
              <p className="text-[var(--dim)]">Acepte la invitación desde su cuenta para entrar al hogar.</p>
            </>
          )}
          {(status === "none" || status === "rejected") && (
            <>
              {status === "rejected" && <p className="text-[var(--red)]">Su solicitud fue rechazada. Puede solicitarlo de nuevo.</p>}
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="Su nombre para solicitar entrar al hogar"
                  placeholder="Nombre"
                  className={inputCls}
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                />
                <input
                  aria-label="Su apellido para solicitar entrar al hogar"
                  placeholder="Apellido"
                  className={inputCls}
                  value={last}
                  onChange={(e) => setLast(e.target.value)}
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button type="button" className={btnPrimary} onClick={() => void request()} disabled={busy}>
                  {busy ? "Enviando…" : "Solicitar entrar al hogar"}
                </button>
              </div>
              {formError && <p className="text-sm text-[var(--red)]">{formError}</p>}
            </>
          )}
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnGhost} onClick={() => void lookup()} disabled={busy}>
              Consultar el estado
            </button>
            <button type="button" className="text-xs underline" onClick={reset}>
              Usar otro código
            </button>
          </div>
          {notice && <p className="text-sm text-[var(--green)]">{notice}</p>}
        </div>
      )}
    </div>
  );
}
