// Sección «Código del hogar» de la tarjeta «Invitaciones al hogar»:
// un código corto (6 caracteres) para compartir con quien deba entrar a
// este hogar. Solo el administrador la ve y la usa. El código se muestra
// solo al crearlo o regenerarlo: en texto plano no se guarda en la base
// (solo su hash), así que no se puede volver a mostrar después. Generar
// uno nuevo invalida el anterior. Quien tiene el código lo escribe en su
// app (Hogar → Solicitar entrar a un hogar) y solicita entrar; el
// administrador aprueba o rechaza cada solicitud. El código por sí solo
// NO da acceso al hogar.
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

/** Mensaje para compartir el código del hogar por WhatsApp (o copiarlo):
 *  el código va primero, seguido de dónde escribirlo. */
export function householdCodeMessage(code: string, householdName: string): string {
  return `El código del hogar ${householdName} en SyncFinanzas es: ${code}\nPara entrar:\n1. Abra SyncFinanzas y entre a Hogar.\n2. Escriba el código en «Solicitar entrar a un hogar».\n3. El administrador debe aprobar su solicitud.`;
}

export type HouseholdCodeApi = {
  createHouseholdCode: (args: { householdId: number; regenerate?: boolean }) => Promise<{ code: string | null; hasActive: boolean; expiresAt: string | null }>;
  getHouseholdCode: (args: { householdId: number }) => Promise<{ hasActive: boolean; expiresAt: string | null }>;
};

export function HouseholdCode(p: {
  householdId: number;
  householdName: string;
  isAdmin: boolean;
  api: HouseholdCodeApi;
  copyLink: (url: string) => void;
  copiedLink: string | null;
}) {
  const [status, setStatus] = useState<{ hasActive: boolean; expiresAt: string | null } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!p.isAdmin) return;
    let alive = true;
    void p.api
      .getHouseholdCode({ householdId: p.householdId })
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
      const r = await p.api.createHouseholdCode({ householdId: p.householdId, regenerate });
      if (r.code) {
        setCode(r.code);
        setStatus({ hasActive: true, expiresAt: r.expiresAt });
        setNotice(regenerate ? "Código nuevo generado. El anterior ya no funciona." : "Código del hogar creado.");
      } else {
        setNotice("Ya hay un código activo. Compártalo desde donde lo guardó, o genere uno nuevo.");
        setStatus({ hasActive: true, expiresAt: r.expiresAt });
      }
      setConfirmRegen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el código.");
    } finally {
      setBusy(false);
    }
  };

  const message = code ? householdCodeMessage(code, p.householdName) : "";

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 space-y-2">
      <h4 className="font-display font-bold">Código del hogar</h4>
      <p className="text-sm text-[var(--dim)]">
        Comparta este código con quien quiera que entre a su hogar. Quien lo tenga lo escribe en su app y solicita
        entrar; usted aprueba cada solicitud. El código por sí solo no da acceso al hogar.
      </p>
      {code && (
        <div className="text-sm space-y-2 border border-[var(--gold)] rounded-2xl p-3 bg-[var(--surface2)]">
          <p className="font-bold">Código del hogar listo</p>
          <p className="font-mono font-bold text-2xl tracking-[0.3em] text-center bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2">{code}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnPrimary + " flex-1"} onClick={() => p.copyLink(message)}>
              {p.copiedLink === message ? "Código copiado" : "Copiar código"}
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
          <p className="text-xs text-[var(--dim)]">Guarde o comparta este código ahora: por seguridad no se vuelve a mostrar.</p>
        </div>
      )}
      {status?.hasActive && !code && (
        <p className="text-sm">
          Ya hay un código activo{status.expiresAt ? ` · vence el ${fmtExpiry(status.expiresAt)}` : ""}.
        </p>
      )}
      {!status?.hasActive && !code && (
        <button type="button" className={btnPrimary} onClick={() => void create(false)} disabled={busy}>
          {busy ? "Creando…" : "Crear código del hogar"}
        </button>
      )}
      {status?.hasActive && !confirmRegen && (
        <button type="button" className={btnGhost} onClick={() => setConfirmRegen(true)} disabled={busy}>
          Generar código nuevo
        </button>
      )}
      {confirmRegen && (
        <div className="text-sm space-y-2 border border-[var(--border)] rounded-2xl p-3">
          <p>¿Generar un código nuevo? El anterior dejará de funcionar.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnPrimary} onClick={() => void create(true)} disabled={busy}>
              {busy ? "Generando…" : "Sí, generar código nuevo"}
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
