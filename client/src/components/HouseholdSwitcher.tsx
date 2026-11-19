// Selector «Cambiar de hogar»: lista los hogares del usuario para cambiar
// el hogar activo. Solo se pinta con más de un hogar (con un solo hogar no
// hay nada que cambiar y no se muestra nada nuevo). Al elegir un hogar, la
// app recarga todo (Inicio, movimientos, tandas, etc.) con los datos de
// ese hogar.
import type { HouseholdLike } from "../lib/activeHousehold";

export function HouseholdSwitcher(p: {
  households: HouseholdLike[];
  activeId: number;
  onPick: (id: number) => void;
}) {
  if (p.households.length <= 1) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-bold tracking-widest text-[var(--dim)]">CAMBIAR DE HOGAR</p>
      <ul className="mt-1 space-y-0.5">
        {p.households.map((h) => {
          const active = h.id === p.activeId;
          return (
            <li key={h.id}>
              <button
                type="button"
                aria-label={`Cambiar al hogar ${h.name}`}
                aria-current={active ? "true" : undefined}
                onClick={() => p.onPick(h.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[15px] font-bold ${active ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text)]"}`}
              >
                <span className="flex-1 min-w-0 truncate">{h.name}</span>
                {active && <span className="text-[11px] font-semibold opacity-80 shrink-0">Actual</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
