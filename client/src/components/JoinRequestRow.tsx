// Fila de una solicitud de ingreso al hogar (código del hogar) en la tarjeta
// «Invitaciones al hogar»: quien solicitó no tiene enlace de invitación,
// así que no se le muestra el formulario de aceptación; el administrador
// la aprueba o la rechaza, y cualquier integrante ve que está pendiente.
// Borrar una solicitud pide confirmación en línea (mismo patrón que el
// borrado de movimientos y de invitaciones): solo al confirmar se ejecuta.
import { useState } from "react";
const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost = "rounded-full border border-[var(--border)] bg-[var(--surface)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnDanger = "rounded-full bg-[var(--red)] text-white font-bold px-5 py-2.5 text-sm disabled:opacity-50";

export function JoinRequestRow(p: {
  inv: { id: number; email: string; invitedName: string | null; status: string };
  isAdmin: boolean;
  busy: boolean;
  householdName?: string;
  onRespond: (id: number, accept: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [preview, setPreview] = useState<"approve" | "reject" | null>(null);
  const displayName = p.inv.invitedName || p.inv.email;
  const firstName = (p.inv.invitedName || p.inv.email.split("@")[0] || "La persona").trim().split(/\s+/)[0] || "La persona";
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
          <>
          <div className="flex gap-2 flex-wrap mt-2 items-center">
            <button
              type="button"
              aria-label={`Aprobar solicitud de ${p.inv.email}`}
              className={btnPrimary}
              onClick={() => setPreview("approve")}
              disabled={p.busy}
            >
              Aprobar
            </button>
            <button
              type="button"
              aria-label={`Rechazar solicitud de ${p.inv.email}`}
              className={btnGhost}
              onClick={() => setPreview("reject")}
              disabled={p.busy}
            >
              Rechazar
            </button>
            <button type="button" aria-label={`Borrar solicitud de ${p.inv.email}`} className="text-xs underline text-[var(--red)]" onClick={() => setConfirmDel(!confirmDel)}>
              Borrar
            </button>
          </div>
          {preview && (
            <div aria-label={preview === "approve" ? `Revisión de la aprobación de la solicitud de ${p.inv.email}` : `Revisión del rechazo de la solicitud de ${p.inv.email}`} className="mt-2 border border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
              <p className="font-bold text-sm">{preview === "approve" ? "Revise antes de aprobar" : "Revise antes de rechazar"}</p>
              <div className="mt-2 space-y-1 text-sm">
                <p className="flex justify-between gap-2"><span>Solicitud de</span><b>{displayName}</b></p>
                {p.inv.invitedName && <p className="text-xs text-[var(--dim)]">{p.inv.email}</p>}
                {p.householdName && <p className="flex justify-between gap-2"><span>Hogar</span><b>{p.householdName}</b></p>}
                <p className="flex justify-between gap-2"><span>Estado</span><b>Pendiente</b></p>
              </div>
              <p className="font-bold text-sm mt-3">{preview === "approve" ? "Qué pasa si aprueba:" : "Qué pasa si rechaza:"}</p>
              {preview === "approve" ? (
                <>
                  <p className="text-sm mt-1">{firstName} entra al hogar como integrante.</p>
                  <p className="text-sm mt-1">Podrá ver los movimientos compartidos y registrar los suyos.</p>
                  <p className="text-sm mt-1">El hogar recibe el aviso «Nuevo integrante en el hogar».</p>
                </>
              ) : (
                <>
                  <p className="text-sm mt-1">La solicitud queda como Rechazada.</p>
                  <p className="text-sm mt-1">{firstName} no entra al hogar.</p>
                  <p className="text-sm mt-1">No se le avisa; puede volver a solicitar entrar.</p>
                </>
              )}
              <div className="flex gap-2 mt-3">
                <button type="button" aria-label={preview === "approve" ? `Confirmar la aprobación de la solicitud de ${p.inv.email}` : `Confirmar el rechazo de la solicitud de ${p.inv.email}`} className={preview === "approve" ? btnPrimary : btnDanger} disabled={p.busy} onClick={() => { p.onRespond(p.inv.id, preview === "approve"); setPreview(null); }}>{preview === "approve" ? "Aprobar" : "Rechazar"}</button>
                <button type="button" aria-label={preview === "approve" ? `Cancelar la aprobación de la solicitud de ${p.inv.email}` : `Cancelar el rechazo de la solicitud de ${p.inv.email}`} className={btnGhost} onClick={() => setPreview(null)}>Cancelar</button>
              </div>
            </div>
          )}
          </>
        ) : (
          <p className="text-sm text-[var(--dim)] mt-2">Pendiente de aprobación por el administrador del hogar.</p>
        ))}
      {p.inv.status === "pending" && p.isAdmin && confirmDel && (
        <div className="mt-2 border border-dashed border-[var(--gold)] rounded-xl p-3 bg-[var(--surface2)]">
          <p className="text-xs">¿Está seguro de eliminar esta solicitud?</p>
          <p className="text-xs text-[var(--dim)] mt-1">La persona tendría que volver a solicitar entrar. Esta acción no se puede deshacer.</p>
          <div className="flex gap-2 mt-2">
            <button type="button" aria-label={`Confirmar la eliminación de la solicitud de ${p.inv.email}`} className={btnPrimary} onClick={() => p.onDelete(p.inv.id)}>
              Eliminar
            </button>
            <button type="button" aria-label="Cancelar la eliminación de la solicitud" className={btnGhost} onClick={() => setConfirmDel(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
