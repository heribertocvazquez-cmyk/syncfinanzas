// Fila de una solicitud de ingreso al hogar (enlace genérico) en la tarjeta
// «Invitaciones al hogar»: quien solicitó no tiene enlace de invitación,
// así que no se le muestra el formulario de aceptación; el administrador
// la aprueba o la rechaza, y cualquier integrante ve que está pendiente.
const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost = "rounded-full border border-[var(--border)] bg-[var(--surface)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

export function JoinRequestRow(p: {
  inv: { id: number; email: string; invitedName: string | null; status: string };
  isAdmin: boolean;
  busy: boolean;
  onRespond: (id: number, accept: boolean) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="py-2.5 text-sm">
      <div className="flex justify-between gap-2 flex-wrap">
        <span>
          <b>{p.inv.email}</b>
          {p.inv.invitedName ? ` · ${p.inv.invitedName}` : ""}
        </span>
        <span className="flex gap-1 flex-wrap">
          <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-[var(--gold)] text-[#13262E]">Solicitud para entrar</span>
          <span
            className={`text-xs font-bold rounded-full px-2 py-0.5 ${
              p.inv.status === "accepted" ? "bg-green-100 text-green-800" : p.inv.status === "rejected" ? "bg-red-100 text-red-800" : "bg-[var(--surface2)]"
            }`}
          >
            {p.inv.status === "accepted" ? "Aceptada" : p.inv.status === "rejected" ? "Rechazada" : "Pendiente"}
          </span>
        </span>
      </div>
      {p.inv.status === "pending" &&
        (p.isAdmin ? (
          <div className="flex gap-2 flex-wrap mt-2 items-center">
            <button
              type="button"
              aria-label={`Aprobar solicitud de ${p.inv.email}`}
              className={btnPrimary}
              onClick={() => p.onRespond(p.inv.id, true)}
              disabled={p.busy}
            >
              Aprobar
            </button>
            <button
              type="button"
              aria-label={`Rechazar solicitud de ${p.inv.email}`}
              className={btnGhost}
              onClick={() => p.onRespond(p.inv.id, false)}
              disabled={p.busy}
            >
              Rechazar
            </button>
            <button type="button" aria-label={`Borrar solicitud de ${p.inv.email}`} className="text-xs underline text-[var(--red)]" onClick={() => p.onDelete(p.inv.id)}>
              Borrar
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--dim)] mt-2">Pendiente de aprobación por el administrador del hogar.</p>
        ))}
    </div>
  );
}
