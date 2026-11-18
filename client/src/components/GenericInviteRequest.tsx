// Formulario del invitado con enlace genérico: solicita entrar al hogar.
// No acepta nada directamente: la entrada la da la aprobación del
// administrador. Muestra el estado de la solicitud (pendiente, aprobada,
// rechazada, ya integrante).
import { useState } from "react";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]";
const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

export type JoinRequestStatus = "none" | "pending" | "approved" | "rejected" | "member";

export function GenericInviteRequest(p: {
  householdName: string | null;
  status: JoinRequestStatus;
  busy: boolean;
  error: string | null;
  onRequest: (firstName: string, lastName: string) => void;
  onAcceptApproved: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [formError, setFormError] = useState("");

  const request = () => {
    if (!first.trim()) {
      setFormError("Escriba su nombre para solicitar entrar al hogar.");
      return;
    }
    setFormError("");
    p.onRequest(first.trim(), last.trim());
  };

  if (p.status === "member") {
    return (
      <p className="text-sm text-[var(--green)]">
        Ya es integrante del hogar{p.householdName ? ` “${p.householdName}”` : ""}.
      </p>
    );
  }
  if (p.status === "pending") {
    return (
      <>
        <p className="text-sm">
          <b>Su solicitud está pendiente de aprobación.</b>
        </p>
        <p className="text-sm text-[var(--dim)]">
          El administrador del hogar debe aprobarla. Cuando lo haga, podrá entrar al hogar sin crear uno nuevo.
        </p>
      </>
    );
  }
  if (p.status === "approved") {
    return (
      <>
        <p className="text-sm">
          <b>Su solicitud fue aprobada.</b>
        </p>
        <p className="text-sm text-[var(--dim)]">Acepte la invitación para entrar al hogar.</p>
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} onClick={p.onAcceptApproved} disabled={p.busy}>
            Aceptar y entrar al hogar
          </button>
        </div>
        {p.error && <p className="text-sm text-[var(--red)]">{p.error}</p>}
      </>
    );
  }
  return (
    <>
      {p.status === "rejected" && <p className="text-sm text-[var(--red)]">Su solicitud fue rechazada. Puede solicitarlo de nuevo.</p>}
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
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} onClick={request} disabled={p.busy}>
          {p.busy ? "Enviando…" : "Solicitar entrar al hogar"}
        </button>
      </div>
      {(formError || p.error) && <p className="text-sm text-[var(--red)]">{formError || p.error}</p>}
    </>
  );
}
