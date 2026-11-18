import { CollapsibleCard } from "./CollapsibleCard";
import { TandaCard, type Tanda } from "./TandaCard";
import { tandaPendingCount } from "../lib/cardSummaries";
import { btnPrimary } from "../lib/uiShared";

// Tarjeta «Mis tandas» de Inicio (decisión de Heriberto 2026-11-18): solo
// aparece cuando hay al menos 1 tanda; sin tandas no se pinta nada en
// Inicio. Cada tanda es una fila táctil que abre su detalle en el módulo
// Tandas; el botón de abajo entra al módulo.
export function HomeTandasCard({
  tandas,
  onOpenDetail,
  onGoTandas,
}: {
  tandas: Tanda[];
  onOpenDetail: (id: number) => void;
  onGoTandas: () => void;
}) {
  if (tandas.length === 0) return null;
  return (
    <CollapsibleCard
      title={<h2 className="font-display font-bold text-lg">Mis tandas</h2>}
      above={
        <p className="text-sm text-[var(--dim)] mt-1">
          {tandas.length} {tandas.length === 1 ? "tanda" : "tandas"} · {tandaPendingCount(tandas)} pagos pendientes
        </p>
      }
      below={
        <button type="button" aria-label="Ir a Tandas desde Inicio" className={btnPrimary + " mt-3"} onClick={onGoTandas}>
          Ir a Tandas
        </button>
      }
    >
      <div className="space-y-3 mt-3">
        {tandas.map((td) => (
          <TandaCard key={td.id} td={td} onOpen={() => onOpenDetail(td.id)} />
        ))}
      </div>
    </CollapsibleCard>
  );
}
