import { CollapsibleCard } from "./CollapsibleCard";
import { TandaForm, type TandaAdultProfile, type TandaFormValues } from "./TandaForm";
import { TandaCard, type Tanda } from "./TandaCard";
import { TandaDetail, type TandaDetailDeps, type TandaPerms } from "./TandaDetail";
import { Empty } from "../lib/uiShared";

// Módulo Tandas (decisión de Heriberto 2026-11-18): primero la lista de
// tandas creadas como tarjetas compactas; el formulario de creación vive
// agrupado en «Nueva tanda» (plegada cuando ya hay tandas, abierta cuando
// no hay ninguna). El aviso «Tandas con pagos verificados» queda arriba
// como está. Al tocar una tanda se abre su vista de detalle a pantalla
// completa con todo el desglose dentro; en la pantalla principal no queda
// nada del desglose en línea. Al cerrar el detalle se vuelve a la lista.
export function TandasModule(p: {
  tandas: Tanda[];
  detailId: number | null;
  onDetailChange: (id: number | null) => void;
  formValues: TandaFormValues;
  onFormChange: (patch: Partial<TandaFormValues>) => void;
  onFormSubmit: (values: TandaFormValues) => void;
  formPending: boolean;
  organizerName: string;
  adultProfiles: TandaAdultProfile[];
  detailDeps: TandaDetailDeps;
  permsFor: (td: Tanda) => TandaPerms;
  // Invitado sin hogar (2026-11-26): ve sus tandas pero no crea una nueva
  // (crear tanda exige hogar). Sin el formulario, el estado vacío cambia.
  hideForm?: boolean;
}) {
  const detailTd = p.detailId == null ? null : p.tandas.find((td) => td.id === p.detailId) ?? null;
  return (
    <section className="space-y-4 md:space-y-6">
      <div className="bg-amber-50 border-2 border-[var(--gold)] rounded-2xl p-4 sm:p-5 text-amber-900">
        <p className="font-display font-bold text-lg">Tandas con pagos verificados</p>
        <p className="text-sm mt-1">Cada participante sube su comprobante; el organizador lo verifica.</p>
      </div>
      {detailTd ? (
        <>
          <div>
            <button
              type="button"
              aria-label="Volver a la lista de tandas"
              className="rounded-full border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              onClick={() => p.onDetailChange(null)}
            >
              ‹ Volver a Tandas
            </button>
          </div>
          <TandaDetail td={detailTd} p={p.permsFor(detailTd)} deps={p.detailDeps} />
        </>
      ) : (
        <>
          {p.tandas.length > 0 && (
            <div className="space-y-3">
              {p.tandas.map((td) => (
                <TandaCard key={td.id} td={td} onOpen={() => p.onDetailChange(td.id)} />
              ))}
            </div>
          )}
          {!p.hideForm && (
          <CollapsibleCard
            title={<h2 className="font-display font-bold text-lg">Nueva tanda</h2>}
            above={
              <p className="text-sm text-[var(--dim)] mt-1">
                {p.tandas.length === 0 ? "Cree la primera tanda." : `${p.tandas.length} ${p.tandas.length === 1 ? "tanda" : "tandas"} creadas`}
              </p>
            }
            defaultOpen={p.tandas.length === 0}
            toggleLabel="formulario de nueva tanda"
          >
            <div className="mt-3">
              <TandaForm
                values={p.formValues}
                onChange={p.onFormChange}
                onSubmit={p.onFormSubmit}
                pending={p.formPending}
                organizerName={p.organizerName}
                adultProfiles={p.adultProfiles}
              />
            </div>
          </CollapsibleCard>
          )}
          {p.tandas.length === 0 && <Empty title="Sin tandas" body={p.hideForm ? "Aún no tiene tandas." : "Cree la primera."} />}
        </>
      )}
    </section>
  );
}
