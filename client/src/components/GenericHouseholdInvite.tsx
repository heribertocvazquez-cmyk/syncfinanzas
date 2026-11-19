// Sección «Invitar a probar la app» de la tarjeta «Invitaciones al hogar»:
// un solo enlace reutilizable por hogar para compartir por donde se quiera.
// Solo el administrador la ve y la usa. El enlace se muestra solo al
// crearlo o regenerarlo: el token en texto plano no se guarda en la base,
// así que no se puede volver a mostrar después. Generar uno nuevo invalida
// el anterior. El enlace invita a PROBAR LA APP: quien lo abre crea su
// cuenta y empieza con su propio espacio; NO da acceso a este hogar ni
// genera solicitud de entrada. Para entrar a este hogar está el código del
// hogar (HouseholdCode) o la invitación por correo.
import { useEffect, useState } from "react";

const btnPrimary = "rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";
const btnGhost = "rounded-full border border-[var(--border)] bg-[var(--surface)] font-bold px-5 py-2.5 text-sm disabled:opacity-50";

function fmtExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Mensaje para compartir el enlace para probar la app por WhatsApp (o
 *  copiarlo): el enlace va primero, seguido de qué hace quien lo abre. */
export function genericInviteMessage(url: string, householdName: string): string {
  return `${url}\nLe invito a probar SyncFinanzas, la app para llevar el dinero del hogar.\nQuien lo abre crea su cuenta y empieza con su propio espacio. Este enlace no da acceso al hogar ${householdName} ni genera solicitud de entrada.`;
}

export type GenericLinkApi = {
  createGenericHouseholdInvite: (args: { householdId: number; regenerate?: boolean }) => Promise<{ inviteUrl: string | null; hasActive: boolean; reused: boolean; expiresAt: string | null }>;
  getGenericHouseholdInvite: (args: { householdId: number }) => Promise<{ hasActive: boolean; expiresAt: string | null }>;
};

export function GenericHouseholdInvite(p: {
  householdId: number;
  householdName: string;
  isAdmin: boolean;
  api: GenericLinkApi;
  copyLink: (url: string) => void;
  copiedLink: string | null;
}) {
  const [status, setStatus] = useState<{ hasActive: boolean; expiresAt: string | null } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!p.isAdmin) return;
    let alive = true;
    void p.api
      .getGenericHouseholdInvite({ householdId: p.householdId })
      .then((r) => {
        if (alive) setStatus({ hasActive: r.hasActive, expiresAt: r.expiresAt });
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [p.isAdmin, p.householdId, p.api]);

  if (!p.isAdmin) return null;

  const create = async (regenerate: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await p.api.createGenericHouseholdInvite({ householdId: p.householdId, regenerate });
      if (r.inviteUrl) {
        setLink(r.inviteUrl);
        setStatus({ hasActive: true, expiresAt: r.expiresAt });
        setNotice(regenerate ? "Enlace nuevo generado. El anterior ya no funciona." : "Enlace para probar la app creado.");
      } else {
        setNotice("Ya hay un enlace para probar la app activo. Compártalo desde donde lo guardó, o genere uno nuevo.");
        setStatus({ hasActive: true, expiresAt: r.expiresAt });
      }
      setConfirmRegen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el enlace.");
    } finally {
      setBusy(false);
    }
  };

  const message = link ? genericInviteMessage(link, p.householdName) : "";

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 space-y-2">
      <h4 className="font-display font-bold">Invitar a probar la app</h4>
      <p className="text-sm text-[var(--dim)]">
        Un solo enlace para compartir con quien quiera. Quien lo abra crea su cuenta y empieza con su propio espacio;
        este enlace no da acceso a su hogar ni genera solicitudes de entrada.
      </p>
      {link && (
        <div className="text-sm space-y-2 border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
          <p className="font-bold">Enlace para probar la app listo</p>
          <p className="break-all bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2 text-xs">{link}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnPrimary + " flex-1"} onClick={() => p.copyLink(message)}>
              {p.copiedLink === message ? "Invitación copiada" : "Copiar enlace"}
            </button>
            <a
              className={btnGhost + " flex-1 flex items-center justify-center text-center"}
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              Compartir por WhatsApp
            </a>
          </div>
          <p className="text-xs text-[var(--dim)]">Guarde o comparta este enlace ahora: por seguridad no se vuelve a mostrar.</p>
        </div>
      )}
      {status?.hasActive && !link && (
        <p className="text-sm">
          Ya hay un enlace para probar la app activo{status.expiresAt ? ` · vence el ${fmtExpiry(status.expiresAt)}` : ""}.
        </p>
      )}
      {!status?.hasActive && !link && (
        <button type="button" className={btnPrimary} onClick={() => void create(false)} disabled={busy}>
          {busy ? "Creando…" : "Crear enlace para probar la app"}
        </button>
      )}
      {status?.hasActive && !confirmRegen && (
        <button type="button" className={btnGhost} onClick={() => setConfirmRegen(true)} disabled={busy}>
          Generar enlace nuevo
        </button>
      )}
      {confirmRegen && (
        <div className="text-sm space-y-2 border border-[var(--border)] rounded-2xl p-3">
          <p>¿Generar un enlace nuevo? El anterior dejará de funcionar.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnPrimary} onClick={() => void create(true)} disabled={busy}>
              {busy ? "Generando…" : "Sí, generar enlace nuevo"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirmRegen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {notice && <p className="text-sm text-[var(--green)]">{notice}</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
    </div>
  );
}
