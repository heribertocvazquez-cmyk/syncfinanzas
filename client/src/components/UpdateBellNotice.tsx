// Entrada de actualización en el panel de la campanilla: cuando hay una
// versión nueva en espera, la campanilla muestra este aviso con el botón
// Actualizar. Es la única vía para actualizar: la pancarta superior se
// retiró 2026-11-18 para no duplicar el aviso.
// Si la activación no llega en 15 s, el botón vuelve a servir con
// «Reintentar» y un mensaje visible (2026-11-20: el botón se quedaba en
// «Actualizando…» para siempre cuando ya no había worker en espera).
import { btnPrimary } from "../lib/uiShared";

export function UpdateBellNotice(p: {
  updateAvailable: boolean;
  updateApplying: boolean;
  updateFailed: boolean;
  onUpdate: () => void;
}) {
  if (!p.updateAvailable) return null;
  return (
    <div className="mt-2 rounded-xl border-2 border-[var(--gold)] bg-[var(--surface2)] p-3" role="status">
      <p className="text-sm font-bold">Hay una nueva versión de la app</p>
      <p className="text-sm text-[var(--dim)] mt-0.5">Actualice para ver los últimos cambios. Su cuenta y sus datos no cambian.</p>
      {p.updateFailed && <p className="text-sm mt-2" role="alert">No se pudo aplicar la actualización. Inténtelo de nuevo.</p>}
      <button type="button" className={btnPrimary + " mt-2"} disabled={p.updateApplying} onClick={p.onUpdate}>
        {p.updateApplying ? "Actualizando…" : p.updateFailed ? "Reintentar" : "Actualizar ahora"}
      </button>
    </div>
  );
}
