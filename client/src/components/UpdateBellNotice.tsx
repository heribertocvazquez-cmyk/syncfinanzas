// Entrada de actualización en el panel de la campanilla: cuando hay una
// versión nueva en espera, la campanilla muestra este aviso con el botón
// Actualizar. Es la única vía para actualizar: la pancarta superior se
// retiró 2026-11-18 para no duplicar el aviso.
import { btnPrimary } from "../lib/uiShared";

export function UpdateBellNotice(p: {
  updateAvailable: boolean;
  updateApplying: boolean;
  onUpdate: () => void;
}) {
  if (!p.updateAvailable) return null;
  return (
    <div className="mt-2 rounded-xl border-2 border-[var(--gold)] bg-[var(--surface2)] p-3" role="status">
      <p className="text-sm font-bold">Hay una nueva versión de la app</p>
      <p className="text-sm text-[var(--dim)] mt-0.5">Actualice para ver los últimos cambios. Su cuenta y sus datos no cambian.</p>
      <button type="button" className={btnPrimary + " mt-2"} disabled={p.updateApplying} onClick={p.onUpdate}>
        {p.updateApplying ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </div>
  );
}
